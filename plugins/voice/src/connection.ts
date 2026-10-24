// 每设备连接的状态机：hello → listen(start/stop | 二进制 PCM) → ASR →
// dsh 会话一轮（实时增量）→ 切句 → TTS 流式下发 → tts stop。
// 辅助触发：query（文本直达 LLM+TTS）、speak（纯 TTS）、abort（全链路打断）。

import { Buffer } from 'node:buffer'
import { transcribePcm, AsrError } from './asr.js'
import { synthesizeStream, TtsError, TTS_FRAME_BYTES } from './tts.js'
import { SentenceSlicer, type AgentBridge, type TurnHandle } from './llm.js'
import type { VoiceSettings } from './settings.js'

export const PROTOCOL_VERSION = 1
export const SAMPLE_RATE_IN = 16_000
export const SAMPLE_RATE_OUT = 24_000

/** 单次拾音时长上限 */
const MAX_CAPTURE_MS = 120_000
/** 收尾兜底上限：覆盖尾句合成 + 已入队音频按实时节奏发完（TTS 卡死时止损） */
const DRAIN_MS = 30_000

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    if (typeof timer.unref === 'function') timer.unref()
  })

interface PacedSender {
  push(chunk: Buffer): void
  /** 等待已入队帧全部按节奏发完（stop/连接关闭立即返回）。 */
  finish(): Promise<void>
  stop(): void
}

/** 以 40ms 帧节奏下发 PCM：先预缓冲若干帧，再按实时率发送。 */
function createPacedSender(ws: { readyState: number; send(data: Buffer): void }): PacedSender {
  const PREBUFFER_FRAMES = 6
  const TICK_MS = 40
  let frames: Buffer[] = []
  let timer: ReturnType<typeof setInterval> | undefined
  let closed = false
  let finishing = false
  let waiters: Array<() => void> = []

  const stopTimer = () => {
    if (timer !== undefined) {
      clearInterval(timer)
      timer = undefined
    }
  }
  const wake = () => {
    const pending = waiters.splice(0)
    for (const resolve of pending) resolve()
  }
  const start = () => {
    if (timer !== undefined || closed) return
    timer = setInterval(() => {
      if (closed || ws.readyState !== 1) {
        stopTimer()
        if (finishing) wake()
        return
      }
      const frame = frames.shift()
      if (frame === undefined) {
        stopTimer()
        if (finishing) wake()
        return
      }
      ws.send(frame)
    }, TICK_MS)
    if (typeof timer.unref === 'function') timer.unref()
  }

  return {
    push(chunk: Buffer) {
      if (closed) return
      let offset = 0
      while (offset < chunk.length) {
        const end = Math.min(offset + TTS_FRAME_BYTES, chunk.length)
        frames.push(chunk.subarray(offset, end))
        offset = end
      }
      if (frames.length >= PREBUFFER_FRAMES && timer === undefined) start()
    },
    async finish() {
      if (closed) return
      finishing = true
      if (frames.length === 0 && timer === undefined) return
      start()
      await new Promise<void>((resolve) => waiters.push(resolve))
    },
    stop() {
      closed = true
      stopTimer()
      frames = []
      wake()
    },
  }
}

/** 顺序句子队列：生产者 push，消费者 await next()，close 后排空返回 null。 */
class SentenceQueue {
  private pending: string[] = []
  private closed = false
  private waiters: Array<() => void> = []

  push(sentence: string) {
    if (this.closed || sentence === '') return
    this.pending.push(sentence)
    this.wake()
  }

  close() {
    this.closed = true
    this.wake()
  }

  private wake() {
    while (this.waiters.length > 0) {
      const resolve = this.waiters.shift()
      if (resolve !== undefined) resolve()
    }
  }

  async next(): Promise<string | null> {
    while (true) {
      const sentence = this.pending.shift()
      if (sentence !== undefined) return sentence
      if (this.closed) return null
      await new Promise<void>((resolve) => this.waiters.push(resolve))
    }
  }
}

export interface ConnectionDeps {
  settings(): VoiceSettings
  bridge: AgentBridge
  log: (level: 'info' | 'warn', message: string) => void
}

type ConnState = 'init' | 'ready' | 'listening' | 'busy'

export class VoiceConnection {
  private deps: ConnectionDeps
  private ws: { readyState: number; send(data: string): void; close(code: number, reason: string): void }
  private state: ConnState = 'init'
  deviceId = ''
  deviceName = ''
  private pcmChunks: Buffer[] = []
  private pcmBytes = 0
  private turnCount = 0
  private activeTurn: TurnHandle | undefined
  private activeTtsAbort: AbortController | undefined
  private activeSender: PacedSender | undefined

  constructor(ws: VoiceConnection['ws'], deps: ConnectionDeps) {
    this.ws = ws
    this.deps = deps
  }

  describe(): { deviceId: string; deviceName: string; state: ConnState } {
    return { deviceId: this.deviceId, deviceName: this.deviceName, state: this.state }
  }

  private sendJson(value: Record<string, unknown>) {
    if (this.ws.readyState !== 1) return
    this.ws.send(JSON.stringify(value))
  }

  private sendError(code: string, message: string) {
    this.sendJson({ type: 'error', code, message })
  }

  /** 文本消息入口。 */
  handleMessage(raw: string) {
    let message: any
    try {
      message = JSON.parse(raw)
    } catch {
      this.sendError('bad_json', '消息不是合法 JSON')
      return
    }
    switch (message?.type) {
      case 'hello':
        this.handleHello(message)
        return
      case 'listen':
        this.handleListen(message)
        return
      case 'query':
        this.handleQuery(message)
        return
      case 'speak':
        this.handleSpeak(message)
        return
      case 'abort':
        this.handleAbort()
        return
      case 'ping':
        this.sendJson({ type: 'pong', time: typeof message.time === 'number' ? message.time : Date.now() })
        return
      default:
        this.sendError('unknown_type', `未知消息 type：${String(message?.type)}`)
    }
  }

  private requireReady(): boolean {
    if (this.state === 'init') {
      this.sendError('no_hello', '请先发送 hello')
      return false
    }
    return true
  }

  private requireIdle(): boolean {
    if (this.state === 'busy') {
      this.sendError('busy', '上一轮尚未结束，先发送 abort')
      return false
    }
    return true
  }

  private handleHello(message: any) {
    if (this.state !== 'init') {
      this.sendError('already_hello', 'hello 只能发送一次')
      return
    }
    this.deviceId = sanitizeDeviceId(message.deviceId)
    this.deviceName = typeof message.deviceName === 'string' ? message.deviceName.slice(0, 64) : ''
    this.state = 'ready'
    this.sendJson({
      type: 'welcome',
      version: PROTOCOL_VERSION,
      sessionId: `voice-${this.deviceId}`,
      sampleRateIn: SAMPLE_RATE_IN,
      sampleRateOut: SAMPLE_RATE_OUT,
    })
    this.deps.log('info', `device connected: ${this.deviceId || '(anonymous)'} ${this.deviceName}`)
  }

  private handleListen(message: any) {
    if (!this.requireReady()) return
    if (message?.state === 'start') {
      if (!this.requireIdle()) return
      this.state = 'listening'
      this.pcmChunks = []
      this.pcmBytes = 0
      return
    }
    if (message?.state === 'stop') {
      if (this.state !== 'listening') {
        this.sendError('not_listening', '当前没有处于拾音状态')
        return
      }
      const pcm = Buffer.concat(this.pcmChunks)
      this.pcmChunks = []
      this.pcmBytes = 0
      if (pcm.length < SAMPLE_RATE_IN * 2 * 0.3) {
        this.state = 'ready'
        this.sendJson({ type: 'tts', state: 'stop', reason: 'too_short' })
        return
      }
      void this.runVoiceTurn(pcm)
      return
    }
    this.sendError('bad_listen_state', 'listen.state 必须是 start 或 stop')
  }

  private handleQuery(message: any) {
    if (!this.requireReady() || !this.requireIdle()) return
    const text = typeof message?.text === 'string' ? message.text.trim().slice(0, 4000) : ''
    if (text === '') {
      this.sendError('empty_text', 'query.text 不能为空')
      return
    }
    void this.runLlmTurn(text)
  }

  private handleSpeak(message: any) {
    if (!this.requireReady() || !this.requireIdle()) return
    const text = typeof message?.text === 'string' ? message.text.trim().slice(0, 1000) : ''
    if (text === '') {
      this.sendError('empty_text', 'speak.text 不能为空')
      return
    }
    void this.runSpeakOnly(text)
  }

  handleAbort() {
    this.cancelActive()
    if (this.state === 'listening') {
      this.pcmChunks = []
      this.pcmBytes = 0
    }
    if (this.state !== 'init') this.state = 'ready'
    this.sendJson({ type: 'tts', state: 'stop', reason: 'aborted' })
  }

  /** 二进制帧入口（拾音中累积 PCM）。 */
  handleBinary(data: Buffer) {
    if (this.state !== 'listening') return
    const maxBytes = (SAMPLE_RATE_IN * 2 * MAX_CAPTURE_MS) / 1000
    if (this.pcmBytes + data.length > maxBytes) {
      this.sendError('too_long', '单次拾音超过 120 秒上限')
      this.state = 'ready'
      this.pcmChunks = []
      this.pcmBytes = 0
      return
    }
    this.pcmChunks.push(data)
    this.pcmBytes += data.length
  }

  handleClosed() {
    this.cancelActive()
    if (this.deviceId !== '') this.deps.bridge.release(this.deviceId)
  }

  private cancelActive() {
    this.activeTtsAbort?.abort()
    this.activeTtsAbort = undefined
    this.activeSender?.stop()
    this.activeSender = undefined
    this.activeTurn?.cancel()
    this.activeTurn = undefined
  }

  private ttsOptions(signal: AbortSignal) {
    const s = this.deps.settings()
    return {
      apiKey: s.minimaxApiKey,
      model: s.ttsModel,
      voiceId: s.ttsVoice,
      speed: s.ttsSpeed,
      vol: s.ttsVol,
      pitch: s.ttsPitch,
      signal,
    }
  }

  /** 合成一句并把 PCM 送入节奏发送器；返回是否完整成功（中断/失败为 false）。 */
  private async speakSentence(sentence: string, signal: AbortSignal, sender: PacedSender, ttsStarted: { value: boolean }): Promise<boolean> {
    if (sentence === '' || signal.aborted) return false
    if (!ttsStarted.value) {
      ttsStarted.value = true
      this.sendJson({ type: 'tts', state: 'start' })
    }
    this.sendJson({ type: 'tts', state: 'sentence_start', text: sentence })
    try {
      for await (const chunk of synthesizeStream(sentence, this.ttsOptions(signal))) {
        if (signal.aborted) return false
        sender.push(chunk)
      }
      return true
    } catch (error) {
      if (signal.aborted) return false
      if (error instanceof TtsError) {
        this.deps.log('warn', `tts failed: ${error.code} ${error.message}`)
        this.sendError(error.code, error.message)
      } else {
        this.sendError('tts_failed', error instanceof Error ? error.message : String(error))
      }
      return false
    }
  }

  /** 完整语音轮：ASR → LLM 流式 → TTS。 */
  private async runVoiceTurn(pcm: Buffer) {
    this.state = 'busy'
    const settings = this.deps.settings()
    let text: string
    try {
      text = await transcribePcm(pcm, { apiKey: settings.minimaxApiKey, model: settings.asrModel })
    } catch (error) {
      if (error instanceof AsrError) this.sendError(error.code, error.message)
      else this.sendError('asr_failed', error instanceof Error ? error.message : String(error))
      this.sendJson({ type: 'tts', state: 'stop', reason: 'error' })
      this.state = 'ready'
      return
    }
    this.sendJson({ type: 'stt', text })
    if (text === '') {
      this.sendJson({ type: 'tts', state: 'stop', reason: 'empty_asr' })
      this.state = 'ready'
      return
    }
    await this.runLlmPipeline(text)
  }

  /** query 入口：文本 → LLM 流式 → TTS。 */
  private async runLlmTurn(text: string) {
    this.state = 'busy'
    try {
      await this.runLlmPipeline(text)
    } catch (error) {
      this.sendError('llm_error', error instanceof Error ? error.message : String(error))
      this.sendJson({ type: 'tts', state: 'stop', reason: 'error' })
      this.state = 'ready'
    }
  }

  private async runLlmPipeline(userText: string) {
    const settings = this.deps.settings()
    this.turnCount += 1
    const prompt = this.turnCount === 1 && settings.promptPrefix.trim() !== ''
      ? `${settings.promptPrefix.trim()}\n\n用户说：${userText}`
      : userText

    const ttsAbort = new AbortController()
    const sender = createPacedSender(this.ws)
    const queue = new SentenceQueue()
    const ttsStarted = { value: false }
    this.activeTtsAbort = ttsAbort
    this.activeSender = sender

    // 句子级串行合成：避免并发 TTS 请求音频互相穿插
    const pump = (async () => {
      while (!ttsAbort.signal.aborted) {
        const sentence = await queue.next()
        if (sentence === null) break
        await this.speakSentence(sentence, ttsAbort.signal, sender, ttsStarted)
      }
    })().catch(() => undefined)

    let outcome: { kind: 'completed' | 'error' | 'cancelled'; error?: string }
    try {
      this.sendJson({ type: 'llm', state: 'start' })
      const slicer = new SentenceSlicer()
      const turn = await this.deps.bridge.turn(this.deviceId, prompt, {
        onTextDelta: (delta) => {
          if (ttsAbort.signal.aborted) return
          this.sendJson({ type: 'llm', state: 'delta', text: delta })
          for (const sentence of slicer.feed(delta)) queue.push(sentence)
        },
        onEnd: () => {
          /* 结果经 done 聚合 */
        },
      }, settings.agentPreset)
      this.activeTurn = turn
      outcome = await turn.done
      if (!ttsAbort.signal.aborted && outcome.kind !== 'cancelled') {
        const rest = slicer.flush()
        if (rest !== '') queue.push(rest)
      }
    } catch (error) {
      outcome = { kind: 'error', error: error instanceof Error ? error.message : String(error) }
    } finally {
      this.activeTurn = undefined
    }

    if (outcome.kind === 'error') {
      this.sendError('llm_error', outcome.error ?? 'dsh 会话出错')
    }
    this.sendJson({ type: 'llm', state: 'end' })

    queue.close()
    await Promise.race([Promise.all([pump, sender.finish()]), sleep(DRAIN_MS)])

    ttsAbort.abort()
    sender.stop()
    this.activeSender = undefined
    this.activeTtsAbort = undefined
    this.sendJson({ type: 'tts', state: 'stop', reason: outcome.kind })
    this.state = 'ready'
  }

  /** speak 入口：纯 TTS（不走 LLM），用于测试与播报。 */
  private async runSpeakOnly(text: string) {
    this.state = 'busy'
    const ttsAbort = new AbortController()
    const sender = createPacedSender(this.ws)
    const ttsStarted = { value: false }
    this.activeTtsAbort = ttsAbort
    this.activeSender = sender
    const ok = await this.speakSentence(text, ttsAbort.signal, sender, ttsStarted)
    // 等已入队帧按实时节奏发完再收尾（兜底防 TTS/发送卡死）
    await Promise.race([sender.finish(), sleep(DRAIN_MS)])
    const aborted = ttsAbort.signal.aborted
    ttsAbort.abort()
    sender.stop()
    this.activeSender = undefined
    this.activeTtsAbort = undefined
    this.sendJson({ type: 'tts', state: 'stop', reason: aborted ? 'aborted' : ok ? 'done' : 'error' })
    this.state = 'ready'
  }
}

export function sanitizeDeviceId(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48)
}
