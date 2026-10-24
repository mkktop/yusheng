// 协议 v1：每轮独立上下文；终止后所有迟到回调均失效。
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { transcribePcm, AsrError } from './asr.js'
import { synthesizeStream, TtsError, TTS_FRAME_BYTES } from './tts.js'
import { SentenceSlicer, type AgentBridge, type TurnHandle } from './llm.js'
import { abortable } from './async.js'
import type { VoiceSettings } from './settings.js'

export const PROTOCOL_VERSION = 1
export const SAMPLE_RATE_IN = 16_000
export const SAMPLE_RATE_OUT = 24_000
const MAX_CAPTURE_BYTES = SAMPLE_RATE_IN * 2 * 120
const SOCKET_HIGH_WATER = 256 * 1024

type StopReason = 'completed' | 'done' | 'cancelled' | 'aborted' | 'error' | 'timeout' | 'too_short' | 'empty_asr'
type ConnState = 'init' | 'ready' | 'listening' | 'busy' | 'closed'

export interface VoiceSocket {
  readyState: number
  bufferedAmount?: number
  send(data: string | Buffer): void
  close(code: number, reason: string): void
}

class PipelineError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message)
  }
}

interface PacedSender {
  push(chunk: Buffer): void
  finish(): Promise<void>
  stop(): void
}

/** 连续拼接网络分片为 40ms PCM 帧，避免每个小分片都消耗 40ms；限制积压。 */
function createPacedSender(ws: VoiceSocket, maxBytes: number): PacedSender {
  const frames: Buffer[] = []
  let head = 0
  let tail = Buffer.alloc(0)
  let queuedBytes = 0
  let timer: ReturnType<typeof setInterval> | undefined
  let closed = false
  let finishing = false
  let failure: Error | undefined
  let waiters: Array<{ resolve(): void; reject(error: Error): void }> = []
  const wake = () => {
    for (const waiter of waiters.splice(0)) {
      if (failure !== undefined) waiter.reject(failure)
      else waiter.resolve()
    }
  }
  const stopTimer = () => {
    if (timer !== undefined) clearInterval(timer)
    timer = undefined
  }
  const start = () => {
    if (timer !== undefined || closed) return
    timer = setInterval(() => {
      if (closed) return
      if (ws.readyState !== 1) {
        failure = new PipelineError('connection_closed', '音频连接已关闭')
        stopTimer()
        wake()
        return
      }
      // 慢客户端先排空 WS 缓冲；整轮 deadline 负责最终止损。
      if ((ws.bufferedAmount ?? 0) > SOCKET_HIGH_WATER) return
      const frame = frames[head]
      if (frame === undefined) {
        stopTimer()
        if (finishing) wake()
        return
      }
      try {
        ws.send(frame)
      } catch (error) {
        failure = error instanceof Error ? error : new Error(String(error))
        stopTimer()
        wake()
        return
      }
      queuedBytes -= frame.length
      head += 1
      if (head >= 256) {
        frames.splice(0, head)
        head = 0
      }
    }, 40)
    timer.unref?.()
  }
  return {
    push(chunk) {
      if (closed) return
      if (failure !== undefined) throw failure
      if (queuedBytes + tail.length + chunk.length > maxBytes)
        throw new PipelineError('audio_overflow', '待播放音频超过本轮缓冲上限')
      const data = tail.length === 0 ? chunk : Buffer.concat([tail, chunk])
      let offset = 0
      while (offset + TTS_FRAME_BYTES <= data.length) {
        frames.push(data.subarray(offset, offset + TTS_FRAME_BYTES))
        queuedBytes += TTS_FRAME_BYTES
        offset += TTS_FRAME_BYTES
      }
      tail = Buffer.from(data.subarray(offset))
      if (frames.length - head >= 6) start()
    },
    async finish() {
      if (failure !== undefined) throw failure
      if (closed) return
      if (tail.length % 2 !== 0) throw new PipelineError('bad_audio', 'TTS PCM 字节数未按 16bit 样本对齐')
      finishing = true
      if (tail.length > 0) {
        frames.push(tail)
        queuedBytes += tail.length
        tail = Buffer.alloc(0)
      }
      if (head === frames.length && timer === undefined) return
      start()
      await new Promise<void>((resolve, reject) => waiters.push({ resolve, reject }))
    },
    stop() {
      closed = true
      stopTimer()
      frames.length = 0
      tail = Buffer.alloc(0)
      wake()
    },
  }
}

class SentenceQueue {
  private pending: string[] = []
  private closed = false
  private wake: (() => void) | undefined
  push(text: string) {
    if (!this.closed && text !== '') {
      this.pending.push(text)
      this.wake?.()
    }
  }
  close() {
    this.closed = true
    this.wake?.()
  }
  async next(): Promise<string | null> {
    while (this.pending.length === 0 && !this.closed)
      await new Promise<void>((resolve) => {
        this.wake = resolve
      })
    return this.pending.shift() ?? null
  }
}

interface TurnContext {
  id: string
  requestId?: string
  controller: AbortController
  settings: VoiceSettings
  timer?: ReturnType<typeof setTimeout>
  sender: PacedSender
  handle?: TurnHandle
  ttsStarted: boolean
  sessionId: string
}

export interface ConnectionDeps {
  settings(): VoiceSettings
  bridge: AgentBridge
  log: (level: 'info' | 'warn', message: string) => void
  /** 服务端在握手时接管同 deviceId 的旧连接。 */
  claimDevice?(deviceId: string, connection: VoiceConnection): void
}

export class VoiceConnection {
  private state: ConnState = 'init'
  deviceId = ''
  deviceName = ''
  private pcmChunks: Buffer[] = []
  private pcmBytes = 0
  private captureRequestId: string | undefined
  private captureTimer: ReturnType<typeof setTimeout> | undefined
  private active: TurnContext | undefined

  constructor(
    private ws: VoiceSocket,
    private deps: ConnectionDeps,
  ) {}

  describe() {
    return { deviceId: this.deviceId, deviceName: this.deviceName, state: this.state }
  }

  private sendJson(value: Record<string, unknown>) {
    if (this.ws.readyState !== 1 || this.state === 'closed') return
    try {
      this.ws.send(JSON.stringify(value))
    } catch {
      this.handleClosed()
    }
  }
  private sendError(code: string, message: string, requestId?: string) {
    this.sendJson({ type: 'error', code, message, requestId })
  }
  private current(turn: TurnContext) {
    return this.active === turn && !turn.controller.signal.aborted && this.state !== 'closed'
  }
  private emit(turn: TurnContext, value: Record<string, unknown>) {
    if (this.current(turn)) this.sendJson({ ...value, turnId: turn.id, requestId: turn.requestId })
  }

  handleMessage(raw: string) {
    if (this.state === 'closed') return
    let message: any
    try {
      message = JSON.parse(raw)
    } catch {
      this.sendError('bad_json', '消息不是合法 JSON')
      return
    }
    if (message === null || typeof message !== 'object' || Array.isArray(message)) {
      this.sendError('bad_json', '消息必须是 JSON 对象')
      return
    }
    if (
      message.requestId !== undefined &&
      (typeof message.requestId !== 'string' || message.requestId.length === 0 || message.requestId.length > 128)
    ) {
      this.sendError('bad_request_id', 'requestId 必须是 1–128 字符的字符串')
      return
    }
    switch (message.type) {
      case 'hello':
        this.handleHello(message)
        break
      case 'listen':
        this.handleListen(message)
        break
      case 'query':
      case 'speak':
        this.handleText(message)
        break
      case 'abort':
        this.handleAbort(message.turnId, message.requestId)
        break
      case 'ping':
        this.sendJson({
          type: 'pong',
          time: typeof message.time === 'number' ? message.time : Date.now(),
          requestId: message.requestId,
        })
        break
      default:
        this.sendError('unknown_type', `未知消息 type：${String(message.type)}`, message.requestId)
    }
  }

  private requireReady(requestId?: string): boolean {
    if (this.state === 'init') {
      this.sendError('no_hello', '请先发送 hello', requestId)
      return false
    }
    return this.state !== 'closed'
  }
  private requireIdle(requestId?: string): boolean {
    if (this.state !== 'ready') {
      this.sendError('busy', '上一轮或拾音尚未结束，先发送 abort', requestId)
      return false
    }
    return true
  }

  private sessionId(settings = this.deps.settings()) {
    return this.deps.bridge.sessionIdFor(this.deviceId, settings.agentPreset)
  }

  private handleHello(message: any) {
    if (this.state !== 'init') {
      this.sendError('already_hello', 'hello 只能发送一次', message.requestId)
      return
    }
    if (message.version !== PROTOCOL_VERSION) {
      this.sendError('unsupported_version', '仅支持协议 version=1', message.requestId)
      return
    }
    const deviceId = sanitizeDeviceId(message.deviceId)
    if (deviceId === '') {
      this.sendError('invalid_device_id', 'deviceId 规范化后不能为空', message.requestId)
      return
    }
    this.deviceId = deviceId
    this.deviceName = typeof message.deviceName === 'string' ? message.deviceName.slice(0, 64) : ''
    this.deps.claimDevice?.(deviceId, this)
    this.state = 'ready'
    this.sendJson({
      type: 'welcome',
      version: PROTOCOL_VERSION,
      sessionId: this.sessionId(),
      deviceId,
      sampleRateIn: SAMPLE_RATE_IN,
      sampleRateOut: SAMPLE_RATE_OUT,
      audioFormat: 'pcm_s16le',
      channels: 1,
      capabilities: ['turn-id', 'request-id', 'abort', 'query', 'speak'],
      requestId: message.requestId,
    })
    this.deps.log('info', `device connected: ${deviceId} ${this.deviceName}`)
  }

  private clearCapture() {
    if (this.captureTimer !== undefined) clearTimeout(this.captureTimer)
    this.captureTimer = undefined
    this.pcmChunks = []
    this.pcmBytes = 0
    this.captureRequestId = undefined
  }

  private handleListen(message: any) {
    if (!this.requireReady(message.requestId)) return
    if (message.state === 'start') {
      if (!this.requireIdle(message.requestId)) return
      this.clearCapture()
      this.state = 'listening'
      this.captureRequestId = message.requestId
      // 字节上限之外也限制真实拾音时间，避免空闲连接永远占着 listening。
      this.captureTimer = setTimeout(() => {
        if (this.state !== 'listening') return
        this.sendError('too_long', '单次拾音超过 120 秒上限', this.captureRequestId)
        this.sendJson({ type: 'tts', state: 'stop', reason: 'timeout', requestId: this.captureRequestId })
        this.clearCapture()
        this.state = 'ready'
      }, 120_000)
      this.captureTimer.unref?.()
      return
    }
    if (message.state === 'stop') {
      if (this.state !== 'listening') {
        this.sendError('not_listening', '当前没有处于拾音状态', message.requestId)
        return
      }
      const pcm = Buffer.concat(this.pcmChunks)
      const requestId = message.requestId ?? this.captureRequestId
      this.clearCapture()
      this.launch('listen', requestId, async (turn) => {
        if (pcm.length < SAMPLE_RATE_IN * 2 * 0.3) return 'too_short'
        if (pcm.length % 2 !== 0) throw new PipelineError('bad_audio', '上行 PCM 字节数必须按 16bit 样本对齐')
        const text = await transcribePcm(pcm, {
          apiKey: turn.settings.minimaxApiKey,
          model: turn.settings.asrModel,
          signal: turn.controller.signal,
        })
        if (!this.current(turn)) return 'cancelled'
        this.emit(turn, { type: 'stt', text })
        return text === '' ? 'empty_asr' : this.runLlmPipeline(turn, text)
      })
      return
    }
    this.sendError('bad_listen_state', 'listen.state 必须是 start 或 stop', message.requestId)
  }

  private handleText(message: any) {
    if (!this.requireReady(message.requestId) || !this.requireIdle(message.requestId)) return
    const limit = message.type === 'query' ? 4000 : 1000
    const text = typeof message.text === 'string' ? message.text.trim() : ''
    if (text === '') {
      this.sendError('empty_text', `${message.type}.text 不能为空`, message.requestId)
      return
    }
    if (text.length > limit) {
      this.sendError('text_too_long', `文本超过 ${limit} 字符上限`, message.requestId)
      return
    }
    this.launch(message.type, message.requestId, async (turn) => {
      if (message.type === 'query') return this.runLlmPipeline(turn, text)
      await this.speakSentence(turn, text)
      await turn.sender.finish()
      return 'done'
    })
  }

  private launch(kind: string, requestId: string | undefined, run: (turn: TurnContext) => Promise<StopReason>) {
    const settings = { ...this.deps.settings() }
    const turn: TurnContext = {
      id: randomUUID(),
      requestId,
      controller: new AbortController(),
      settings,
      sender: createPacedSender(this.ws, SAMPLE_RATE_OUT * 2 * settings.maxTurnSeconds),
      ttsStarted: false,
      sessionId: this.sessionId(settings),
    }
    this.active = turn
    this.state = 'busy'
    turn.timer = setTimeout(() => {
      this.finish(turn, 'timeout', { code: 'turn_timeout', message: `本轮超过 ${settings.maxTurnSeconds} 秒上限` })
    }, settings.maxTurnSeconds * 1000)
    turn.timer.unref?.()
    this.emit(turn, { type: 'turn', state: 'start', kind, sessionId: turn.sessionId })
    void (async () => {
      try {
        this.finish(turn, await abortable(run(turn), turn.controller.signal))
      } catch (error) {
        if (!this.current(turn)) return
        const code =
          error instanceof PipelineError || error instanceof AsrError || error instanceof TtsError
            ? error.code
            : 'internal_error'
        this.finish(turn, 'error', { code, message: error instanceof Error ? error.message : String(error) })
      }
    })()
  }

  /** 终止只有一个出口；先使上下文失效，再取消依赖，旧任务不会碰到下一轮。 */
  private finish(turn: TurnContext, reason: StopReason, error?: { code: string; message: string }) {
    if (this.active !== turn) return
    this.active = undefined
    if (turn.timer !== undefined) clearTimeout(turn.timer)
    turn.controller.abort()
    turn.sender.stop()
    if (reason !== 'completed' && reason !== 'done') turn.handle?.cancel()
    if (this.state !== 'closed') this.state = 'ready'
    if (error !== undefined) this.sendJson({ type: 'error', ...error, turnId: turn.id, requestId: turn.requestId })
    this.sendJson({ type: 'tts', state: 'stop', reason, turnId: turn.id, requestId: turn.requestId })
  }

  handleAbort(turnId?: unknown, requestId?: string) {
    if (!this.requireReady(requestId)) return
    if (turnId !== undefined && (typeof turnId !== 'string' || this.active?.id !== turnId)) {
      this.sendError('unknown_turn', 'turnId 不是当前活动轮次', requestId)
      return
    }
    if (this.active !== undefined) {
      this.finish(this.active, 'aborted')
      return
    }
    const captureId = this.captureRequestId
    this.clearCapture()
    this.state = 'ready'
    this.sendJson({ type: 'tts', state: 'stop', reason: 'aborted', requestId: requestId ?? captureId })
  }

  handleBinary(data: Buffer) {
    if (this.state !== 'listening') return
    if (this.pcmBytes + data.length > MAX_CAPTURE_BYTES) {
      this.sendError('too_long', '单次拾音超过 120 秒上限', this.captureRequestId)
      this.sendJson({ type: 'tts', state: 'stop', reason: 'error', requestId: this.captureRequestId })
      this.clearCapture()
      this.state = 'ready'
      return
    }
    this.pcmChunks.push(data)
    this.pcmBytes += data.length
  }

  replace() {
    this.sendError('device_replaced', '同一 deviceId 已在另一连接接入')
    this.handleClosed()
    this.ws.close(4001, 'device_replaced')
  }

  handleClosed() {
    if (this.state === 'closed') return
    this.state = 'closed'
    this.clearCapture()
    if (this.active !== undefined) this.finish(this.active, 'aborted')
    if (this.deviceId !== '') this.deps.bridge.release(this.deviceId)
  }

  private async speakSentence(turn: TurnContext, text: string) {
    if (!this.current(turn)) return
    if (!turn.ttsStarted) {
      turn.ttsStarted = true
      this.emit(turn, { type: 'tts', state: 'start' })
    }
    // 此事件表示开始合成；客户端按 PCM 队列播放，不能据此计算播放进度。
    this.emit(turn, { type: 'tts', state: 'sentence_start', text })
    const s = turn.settings
    let bytes = 0
    for await (const chunk of synthesizeStream(text, {
      apiKey: s.minimaxApiKey,
      model: s.ttsModel,
      voiceId: s.ttsVoice,
      speed: s.ttsSpeed,
      vol: s.ttsVol,
      pitch: s.ttsPitch,
      signal: turn.controller.signal,
    })) {
      if (!this.current(turn)) return
      bytes += chunk.length
      turn.sender.push(chunk)
    }
    if (this.current(turn) && bytes === 0) throw new PipelineError('empty_tts', 'TTS 未返回音频')
  }

  private async runLlmPipeline(turn: TurnContext, text: string): Promise<StopReason> {
    const queue = new SentenceQueue()
    const signal = turn.controller.signal
    const onAbort = () => queue.close()
    signal.addEventListener('abort', onAbort, { once: true })
    const pump = (async () => {
      while (this.current(turn)) {
        const sentence = await queue.next()
        if (sentence === null || !this.current(turn)) return
        await this.speakSentence(turn, sentence)
      }
    })()
    const model = (async () => {
      const slicer = new SentenceSlicer()
      this.emit(turn, { type: 'llm', state: 'start', sessionId: turn.sessionId })
      let handle: TurnHandle
      try {
        handle = await this.deps.bridge.turn(
          this.deviceId,
          text,
          {
            onTextDelta: (delta) => {
              if (!this.current(turn)) return
              this.emit(turn, { type: 'llm', state: 'delta', text: delta })
              for (const sentence of slicer.feed(delta)) queue.push(sentence)
            },
            onEnd() {},
          },
          turn.settings.agentPreset,
          signal,
          turn.settings.promptPrefix,
        )
      } catch (error) {
        throw new PipelineError('llm_error', error instanceof Error ? error.message : String(error))
      }
      if (!this.current(turn)) {
        handle.cancel()
        return 'cancelled' as const
      }
      turn.handle = handle
      if (handle.sessionId !== undefined && handle.sessionId !== turn.sessionId) {
        turn.sessionId = handle.sessionId
        this.emit(turn, { type: 'session', sessionId: handle.sessionId })
      }
      const outcome = await abortable(handle.done, signal)
      if (!this.current(turn)) return 'cancelled' as const
      if (outcome.kind === 'error') throw new PipelineError('llm_error', outcome.error ?? 'dsh 会话出错')
      if (outcome.kind === 'completed') queue.push(slicer.flush())
      this.emit(turn, { type: 'llm', state: 'end' })
      queue.close()
      return outcome.kind
    })()
    try {
      const [outcome] = await Promise.all([model, pump])
      if (outcome === 'cancelled') return 'cancelled'
      await turn.sender.finish()
      return 'completed'
    } finally {
      queue.close()
      signal.removeEventListener('abort', onAbort)
    }
  }
}

export function sanitizeDeviceId(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}
