// Cancellable turn orchestration; v1 clients keep raw PCM and legacy events.
import { Buffer } from 'node:buffer'
import { transcribePcm } from './asr.js'
import { synthesizeStream } from './tts.js'
import { SentenceSlicer, type AgentBridge, type TurnHandle } from './llm.js'
import type { VoiceSettings } from './settings.js'
import { AudioSender, type VoiceSocket } from './audio.js'
import { abortable, AUDIO_FORMAT, CAPABILITIES, identifier, newId, SAMPLE_RATE_IN, SAMPLE_RATE_OUT, VoiceError } from './protocol.js'
import { support, type ClientEffect, type Cue, type PresentationSupport } from './interaction.js'
import { SurfaceStore } from './surface.js'
import type { MemoryAccess } from './client-memory.js'
export { PROTOCOL_VERSION, SAMPLE_RATE_IN, SAMPLE_RATE_OUT } from './protocol.js'

class SentenceQueue {
  private pending: string[] = []
  private size = 0
  private closed = false
  private wake?: () => void
  push(text: string) {
    if (!text || this.closed) return
    if (this.size + text.length > 32_000) throw new VoiceError('output_overflow', '待播报文本超过缓冲上限')
    this.pending.push(text); this.size += text.length; this.wake?.()
  }
  close() { this.closed = true; this.wake?.() }
  async next(): Promise<string | undefined> {
    while (!this.pending.length && !this.closed) await new Promise<void>(resolve => { this.wake = resolve })
    const text = this.pending.shift()
    if (text) this.size -= text.length
    return text
  }
}

interface TurnContext {
  id: string; requestId?: string; streamId: number; conversationId: string
  scopeKey:string; epoch?:string
  settings: VoiceSettings; controller: AbortController; response: AbortController
  timer: ReturnType<typeof setTimeout>; captureTimer?: ReturnType<typeof setTimeout>
  handle?: TurnHandle; sender?: AudioSender; queue?: SentenceQueue
  ended: boolean; ttsStarted: boolean; audioEnded: boolean; responseStopped: boolean
  llmStarted: boolean; llmEnded: boolean; startedAt: number; pcm: Buffer[]; pcmBytes: number
  asrMs?: number; firstTextMs?: number
  bufferedSamples?: number
  pendingCues: Array<{ cueId:string; cue:Cue }>
  effectCount:number
}

export interface ConnectionDeps {
  settings(deviceId?:string): VoiceSettings
  bridge: Pick<AgentBridge, 'turn' | 'release' | 'sessionId'>
  log: (level: 'info' | 'warn', message: string) => void
  claimDevice?: (deviceId: string) => boolean
  allowConversation?: (deviceId: string, conversationId: string) => boolean
  transcribe?: typeof transcribePcm
  synthesize?: typeof synthesizeStream
  surface?: SurfaceStore
  scope?: (deviceId:string,conversationId:string,preset:string)=>string
  memory?: (deviceId:string,conversationId?:string,turnId?:string)=>MemoryAccess
  epoch?: (deviceId:string)=>string
  surfaceForDevice?: (deviceId:string)=>SurfaceStore
  onSession?: (deviceId:string,conversationId:string,preset:string,sessionId:string,epoch?:string)=>void
}

type ConnState = 'init' | 'ready' | 'listening' | 'busy' | 'closed'
export class VoiceConnection {
  private state: ConnState = 'init'
  private version = 1
  private capabilities = new Set<string>()
  private conversationId = ''
  private memoryEpoch?:string
  private active?: TurnContext
  private streamNumber = 0
  private requests = new Map<string, { fingerprint: string; end?: Record<string, unknown> }>()
  private playback = new Map<number, { turnId: string; samples: number; played: number; ended: boolean }>()
  private presentation:PresentationSupport = support(undefined)
  private surface:SurfaceStore
  private presentationSequence=0
  private waitingPlayback?:number
  readonly connectionId = newId()
  deviceId = ''
  deviceName = ''
  constructor(private ws: VoiceSocket, private deps: ConnectionDeps) {this.surface=deps.surface??new SurfaceStore()}
  describe() { return { connectionId: this.connectionId, deviceId: this.deviceId, deviceName: this.deviceName, conversationId: this.conversationId, state: this.state, version: this.version, turnId: this.active?.id } }

  private send(value: Record<string, unknown>, turn?: TurnContext) {
    if (this.state === 'closed' || this.ws.readyState !== 1 || (turn && !this.current(turn))) return
    const envelope = this.version === 2 ? { ...value, connectionId: this.connectionId, ...(turn ? { turnId: turn.id, requestId: turn.requestId, conversationId: turn.conversationId, streamId: turn.streamId } : {}) } : value
    try { this.ws.send(JSON.stringify(envelope)) } catch { this.handleClosed() }
  }
  private error(code: string, message: string, turn?: TurnContext, requestId?: unknown) {
    this.send({ type: 'error', code, message, ...(this.version === 2 && typeof requestId === 'string' ? { requestId } : {}) }, turn)
  }
  private event(type: string, data: Record<string, unknown>, turn?: TurnContext) { if (this.version === 2) this.send({ type, ...data }, turn) }
  private current(turn: TurnContext) { return this.active === turn && !turn.ended && !turn.controller.signal.aborted }

  handleMessage(raw: string) {
    if (this.state === 'closed') return
    let m: any
    try {
      if (Buffer.byteLength(raw) > 32 * 1024) throw new VoiceError('message_too_large', '控制消息超过 32KiB')
      m = JSON.parse(raw)
      if (!m || typeof m !== 'object' || Array.isArray(m)) throw new VoiceError('bad_message', '消息必须是 JSON 对象')
      if (m.type === 'hello') { this.hello(m); return }
      if (m.type === 'ping') { this.send({ type: 'pong', time: typeof m.time === 'number' ? m.time : Date.now() }); return }
      if (this.state === 'init') throw new VoiceError('no_hello', '请先发送 hello')
      switch (m.type) {
        case 'abort': case 'turn.cancel': this.handleAbort(m); break
        case 'response.stop': this.stopResponse(m); break
        case 'playback': this.handlePlayback(m); break
        case 'conversation.select': this.selectConversation(m); break
        case 'ui.action': this.uiAction(m); break
        case 'ui.dismiss': this.uiDismiss(m); break
        case 'ui.sync': this.uiSnapshot(); break
        case 'listen': this.listen(m); break
        case 'query': case 'speak': this.text(m); break
        default: throw new VoiceError('unknown_type', `未知消息 type：${String(m.type).slice(0, 64)}`)
      }
    } catch (e) {
      this.error(e instanceof VoiceError ? e.code : 'bad_json', e instanceof VoiceError ? e.message : '消息不是合法 JSON', undefined, m?.requestId)
    }
  }

  private hello(m: any) {
    if (this.state !== 'init') throw new VoiceError('already_hello', 'hello 只能发送一次')
    if (![1, 2].includes(m.version)) throw new VoiceError('unsupported_version', '支持的协议版本为 1、2')
    const device = m.version === 1 ? sanitizeDeviceId(m.deviceId) : m.deviceId
    const presentation = support(m.presentation)
    if (!identifier(device, 48)) throw new VoiceError('bad_device_id', 'deviceId 必须为 1–48 位字母、数字、下划线或连字符')
    if (m.capabilities !== undefined && (!Array.isArray(m.capabilities) || m.capabilities.length > 32 || m.capabilities.some((x: unknown) => typeof x !== 'string'))) throw new VoiceError('bad_capabilities', 'capabilities 必须是字符串数组')
    if (m.audio !== undefined) {
      for (const [direction, rate] of [['input', SAMPLE_RATE_IN], ['output', SAMPLE_RATE_OUT]] as const) {
        const audio = m.audio?.[direction]
        if (audio && (audio.encoding !== 'pcm_s16le' || audio.sampleRate !== rate || audio.channels !== 1)) throw new VoiceError('unsupported_audio', '仅支持单声道 PCM s16le，输入 16kHz、输出 24kHz')
      }
    }
    const conversation = m.conversationId ?? device
    if (!identifier(conversation) || (conversation !== device && !this.deps.allowConversation?.(device, conversation))) throw new VoiceError('bad_conversation', '对话标识不合法或不属于此客户端')
    if (this.deps.claimDevice && !this.deps.claimDevice(device)) throw new VoiceError('device_in_use', '此设备已有连接，请关闭旧连接后重试')
    this.deviceId = device; this.deviceName = typeof m.deviceName === 'string' ? m.deviceName.slice(0, 64) : ''
    if(this.deps.surfaceForDevice)this.surface=this.deps.surfaceForDevice(device)
    this.version = m.version; this.conversationId = conversation
    this.capabilities = new Set((m.version===2?m.capabilities??[]:[]).filter((x: string) => (CAPABILITIES as readonly string[]).includes(x)))
    this.presentation=presentation
    this.state = 'ready'
    const config=this.deps.settings(device),scope=this.scope(conversation,config.agentPreset)
    this.send({ type: 'welcome', version: this.version, sessionId: this.deps.bridge.sessionId(scope, config.agentPreset), sampleRateIn: SAMPLE_RATE_IN, sampleRateOut: SAMPLE_RATE_OUT,
      ...(this.version === 2 ? { conversationId: conversation, serverTime:Date.now(), capabilities: [...this.capabilities], supportedCapabilities: CAPABILITIES, presentation:this.presentation, audio: { input: { ...AUDIO_FORMAT, sampleRate: SAMPLE_RATE_IN }, output: { ...AUDIO_FORMAT, sampleRate: SAMPLE_RATE_OUT, framing: this.capabilities.has('audio.framed') ? 'ysv2' : 'raw' } } } : {}) })
    this.memoryEpoch=this.deps.epoch?.(this.deviceId);this.avatarState('idle');if(this.capabilities.has('ui.render'))this.uiSnapshot()
    this.deps.log('info', `device connected: ${device}`)
  }

  private requestSeen(m:any):boolean {
    const requestId = m.requestId
    const fingerprint = this.fingerprint(m)
    if (this.version === 2) {
      if (typeof requestId !== 'string' || !requestId.length || requestId.length > 128) throw new VoiceError('bad_request_id', 'requestId 必须为 1–128 字符')
      const previous = this.requests.get(requestId)
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw new VoiceError('request_conflict', 'requestId 已用于不同请求')
        this.send(previous.end ?? { type: 'request.duplicate', requestId, turnId: this.active?.id }); return true
      }
    }
    return false
  }
  private fingerprint(m:any) {return JSON.stringify([m.type,m.text??'',this.conversationId,m.componentId,m.instanceId,m.revision,m.actionId,m.values&&typeof m.values==='object'?Object.fromEntries(Object.entries(m.values).sort(([a],[b])=>a.localeCompare(b))):m.values])}
  private begin(m: any, listening = false): TurnContext | undefined {
    if(this.requestSeen(m))return
    const requestId=m.requestId, fingerprint=this.fingerprint(m)
    if (this.active) throw new VoiceError('busy', '上一轮尚未结束，先发送 abort')
    const settings={...this.deps.settings(this.deviceId)}
    const turn: TurnContext = { id: newId(), requestId, streamId: ++this.streamNumber, conversationId: this.conversationId, scopeKey:this.scope(this.conversationId,settings.agentPreset), epoch:this.deps.epoch?.(this.deviceId), settings, controller: new AbortController(), response: new AbortController(), timer: undefined as any, ended: false, ttsStarted: false, audioEnded: false, responseStopped: false, llmStarted: false, llmEnded: false, startedAt: Date.now(), pcm: [], pcmBytes: 0, pendingCues:[], effectCount:0 }
    this.active = turn; this.state = listening ? 'listening' : 'busy'
    if (this.version === 2) {
      this.requests.set(requestId, { fingerprint })
      if (this.requests.size > 256) this.requests.delete(this.requests.keys().next().value!)
    }
    turn.timer = setTimeout(() => { this.error('turn_timeout', '本轮超过最长等待时间', turn); this.finish(turn, 'timeout') }, turn.settings.maxTurnSeconds * 1000)
    if (listening) turn.captureTimer = setTimeout(() => { this.error('too_long', '拾音超过 120 秒上限', turn); this.finish(turn, 'too_long') }, 120_000)
    this.event('turn.start', { input: m.type, state: listening ? 'listening' : 'processing' }, turn)
    this.waitingPlayback=undefined;this.avatarState(listening?'listening':'thinking',turn)
    return turn
  }

  private listen(m: any) {
    if (m.state === 'start') { this.begin(m, true); return }
    if (m.state !== 'stop') throw new VoiceError('bad_listen_state', 'listen.state 必须是 start 或 stop')
    const turn = this.active
    if (!turn || this.state !== 'listening') throw new VoiceError('not_listening', '当前没有处于拾音状态')
    if (m.turnId !== undefined && m.turnId !== turn.id) throw new VoiceError('stale_turn', '轮次不匹配')
    const pcm = Buffer.concat(turn.pcm); turn.pcm = []; turn.pcmBytes = 0
    clearTimeout(turn.captureTimer); this.state = 'busy'
    if (pcm.length % 2) { this.error('bad_audio', 'PCM 数据未对齐 16 位采样', turn); this.finish(turn, 'error'); return }
    if (pcm.length < SAMPLE_RATE_IN * 2 * .3) { this.finish(turn, 'too_short'); return }
    this.launch(turn, async () => {
      this.event('turn.state', { state: 'transcribing' }, turn)
      this.avatarState('thinking',turn)
      const asrStarted = Date.now()
      const text = await abortable((this.deps.transcribe ?? transcribePcm)(pcm, { apiKey: turn.settings.minimaxApiKey, model: turn.settings.asrModel, signal: turn.controller.signal }), turn.controller.signal)
      if (!this.current(turn)) return
      turn.asrMs = Date.now() - asrStarted
      this.send({ type: 'stt', text, ...(this.version === 2 ? { final: true } : {}) }, turn)
      if (!text) { this.finish(turn, 'empty_asr'); return }
      await this.pipeline(turn, text)
    })
  }

  private text(m: any) {
    const limit = m.type === 'speak' ? 1000 : 4000
    if (typeof m.text !== 'string' || !m.text.trim()) throw new VoiceError('empty_text', `${m.type}.text 不能为空`)
    if (m.text.length > limit) throw new VoiceError('text_too_long', `文本超过 ${limit} 字符`)
    const turn = this.begin(m)
    if (!turn) return
    this.launch(turn, async () => {
      if (m.type === 'query') await this.pipeline(turn, m.text.trim())
      else {
        turn.sender = this.createSender(turn)
        try {
          await this.sentence(turn, m.text.trim(), 0)
          if (!turn.responseStopped) await abortable(turn.sender.finish(), turn.controller.signal)
        } catch (e) { if (!turn.responseStopped) throw e }
        this.finish(turn, turn.responseStopped ? 'stopped' : 'done')
      }
    })
  }
  private launch(turn: TurnContext, fn: () => Promise<void>) {
    void fn().catch((e: any) => {
      if (!this.current(turn)) return
      this.error(typeof e?.code === 'string' ? e.code : 'turn_failed', e instanceof Error ? e.message : String(e), turn)
      this.finish(turn, 'error')
    })
  }

  private createSender(turn: TurnContext) {
    return new AudioSender(this.ws, turn.response.signal, turn.streamId, this.version === 2 && this.capabilities.has('audio.framed'), () => this.capabilities.has('playback.flow') ? turn.bufferedSamples ?? 0 : 0)
  }

  private async sentence(turn: TurnContext, text: string, sentenceIndex: number) {
    if (!this.current(turn) || turn.response.signal.aborted) return
    if (!turn.ttsStarted) {
      turn.ttsStarted = true; this.send({ type: 'tts', state: 'start' }, turn)
      this.event('audio.start', { format: { ...AUDIO_FORMAT, sampleRate: SAMPLE_RATE_OUT }, framing: this.capabilities.has('audio.framed') ? 'ysv2' : 'raw' }, turn)
    }
    const sender = turn.sender!, offset = sender.queuedSamples, s = turn.settings
    let marked = false, bytes = 0
    for await (const chunk of (this.deps.synthesize ?? synthesizeStream)(text, { apiKey: s.minimaxApiKey, model: s.ttsModel, voiceId: s.ttsVoice, speed: s.ttsSpeed, vol: s.ttsVol, pitch: s.ttsPitch, signal: turn.response.signal })) {
      if (!this.current(turn) || turn.response.signal.aborted) return
      if (!marked && chunk.length) {
        marked = true
        sender.mark(() => {
          if(!this.current(turn))return
          this.avatarState('speaking',turn)
          for(const pending of turn.pendingCues.splice(0))this.event('presentation.cue',{...pending.cue,cueId:pending.cueId,sampleOffset:offset,sequence:++this.presentationSequence},turn)
          this.send({ type: 'tts', state: 'sentence_start', text, ...(this.version === 2 ? { sentenceIndex, sampleOffset: offset } : {}) }, turn)
        })
      }
      bytes += chunk.length; await sender.push(chunk)
    }
    if (!turn.response.signal.aborted && !bytes) throw new VoiceError('empty_audio', '合成服务未返回音频')
    if (!turn.response.signal.aborted) sender.flushSentence()
  }

  private async pipeline(turn: TurnContext, text: string) {
    if(turn.epoch!==this.deps.epoch?.(this.deviceId))throw new VoiceError('memory_context_changed','记忆上下文已更新，请重新说一次，避免恢复旧内容')
    const memory=this.deps.memory?.(this.deviceId,turn.conversationId,turn.id)
    memory?.observe?.(text)
    turn.epoch=this.deps.epoch?.(this.deviceId);turn.scopeKey=this.scope(turn.conversationId,turn.settings.agentPreset)
    if(this.memoryEpoch!==turn.epoch){this.memoryEpoch=turn.epoch;this.resetPresentation('memory_changed',turn);if(this.capabilities.has('ui.render'))this.uiSnapshot()}
    const queue = turn.queue = new SentenceQueue(), slicer = new SentenceSlicer()
    turn.sender = this.createSender(turn)
    turn.response.signal.addEventListener('abort', () => queue.close(), { once: true })
    const pump = (async () => {
      let index = 0
      while (!turn.response.signal.aborted) {
        const sentence = await queue.next()
        if (sentence === undefined) break
        await this.sentence(turn, sentence, index++)
      }
    })().catch((e: any) => {
      if (turn.responseStopped || !this.current(turn)) return
      this.error(typeof e?.code === 'string' ? e.code : 'tts_failed', e instanceof Error ? e.message : String(e), turn)
      this.finish(turn, 'error')
    })
    turn.llmStarted = true; this.send({ type: 'llm', state: 'start' }, turn)
    this.event('turn.state', { state: 'thinking' }, turn)
    const handle = await abortable(this.deps.bridge.turn(turn.scopeKey, text, {
      onTextDelta: delta => {
        if (!this.current(turn)) return
        turn.firstTextMs ??= Date.now() - turn.startedAt
        this.send({ type: 'llm', state: 'delta', text: delta }, turn)
        if (!turn.response.signal.aborted) {
          try { for (const sentence of slicer.feed(delta)) queue.push(sentence) }
          catch (e) { this.error('output_overflow', String(e), turn); this.finish(turn, 'error') }
        }
      }, onEnd: () => undefined,
      onActivity: activity => { if (this.capabilities.has('agent.activity')) this.event('agent.activity', activity, turn) },
      ...(this.version===2&&(this.capabilities.has('presentation.cue')||this.capabilities.has('ui.render'))?{onClientEffect:(effect:ClientEffect)=>this.clientEffect(turn,effect)}:{}),
    }, turn.settings.agentPreset, { signal: turn.controller.signal, promptPrefix: turn.settings.promptPrefix, persona: turn.settings, memory, capabilities:[...this.capabilities], presentation:this.presentation }), turn.controller.signal)
    if (!this.current(turn)) { handle.cancel(); return }
    turn.handle = handle; this.event('session', { sessionId: handle.sessionId }, turn)
    this.deps.onSession?.(this.deviceId,turn.conversationId,turn.settings.agentPreset,handle.sessionId,turn.epoch)
    const outcome = await abortable(handle.done, turn.controller.signal)
    if (!this.current(turn)) return
    turn.handle = undefined; turn.llmEnded = true; this.send({ type: 'llm', state: 'end' }, turn)
    if (outcome.kind === 'error') throw new VoiceError('llm_error', outcome.error ?? 'dsh 会话出错')
    if (outcome.kind === 'cancelled') { this.finish(turn, 'cancelled'); return }
    if (!turn.response.signal.aborted) queue.push(slicer.flush())
    queue.close(); await abortable(pump, turn.controller.signal)
    if (!this.current(turn)) return
    if (!turn.responseStopped) {
      try { await abortable(turn.sender.finish(), turn.controller.signal) }
      catch (e) { if (!turn.responseStopped) throw e }
    }
    memory?.record?.({conversationId:turn.conversationId,sessionId:handle.sessionId,epoch:turn.epoch??'',user:text,assistant:outcome.text})
    this.finish(turn, 'completed')
  }

  handleBinary(data: Buffer) {
    const turn = this.active
    if (!turn || this.state !== 'listening') { this.error('not_listening', '当前没有处于拾音状态'); return }
    if (turn.pcmBytes + data.length > SAMPLE_RATE_IN * 2 * 120 || turn.pcm.length >= 4096) {
      this.error('too_long', '拾音超过时长或分片数量上限', turn); this.finish(turn, 'too_long'); return
    }
    if (data.length) { turn.pcm.push(Buffer.from(data)); turn.pcmBytes += data.length }
  }
  handleAbort(m: any = {}) {
    const turn = this.active
    if (turn && m.turnId !== undefined && m.turnId !== turn.id) throw new VoiceError('stale_turn', '轮次不匹配')
    if (turn) this.finish(turn, 'aborted')
    else if (this.version === 1) this.send({ type: 'tts', state: 'stop', reason: 'aborted' })
    else this.event('cancel.ack', { turnId: m.turnId ?? null, active: false })
  }
  private stopResponse(m: any) {
    if (this.version !== 2 || !this.capabilities.has('response.stop')) throw new VoiceError('unsupported_capability', '需要协商 response.stop')
    const turn = this.active
    if (!turn || turn.id !== m.turnId) throw new VoiceError('stale_turn', '轮次不匹配')
    turn.responseStopped = true; turn.response.abort(); turn.queue?.close(); this.audioEnd(turn, 'stopped')
    turn.pendingCues=[];this.resetPresentation('stopped',turn);this.avatarState('thinking',turn)
  }
  private audioEnd(turn: TurnContext, reason: string) {
    if (turn.audioEnded) return
    turn.audioEnded = true
    const samples = turn.sender?.sentSamples ?? 0, previous = this.playback.get(turn.streamId)
    this.playback.set(turn.streamId, { turnId: turn.id, samples, played: previous?.played ?? 0, ended: false })
    if (this.playback.size > 32) this.playback.delete(this.playback.keys().next().value!)
    this.event('audio.end', { reason, samples }, turn)
  }
  private finish(turn: TurnContext, reason: string) {
    if (!this.current(turn)) return
    if (turn.llmStarted && !turn.llmEnded) { turn.llmEnded = true; this.send({ type: 'llm', state: 'end' }, turn) }
    this.audioEnd(turn, reason)
    if(!['completed','done'].includes(reason)) {
      try {for(const removed of this.surface.invalidateTurn(this.surfaceKey(turn),turn.id))this.event('ui.remove',{...removed,reason},turn)}
      catch(e){this.deps.log('warn',`cannot invalidate UI: ${String(e)}`)}
      this.resetPresentation(reason,turn)
    }
    if(['completed','done'].includes(reason)&&turn.sender?.sentSamples&&!turn.responseStopped&&this.capabilities.has('playback'))this.waitingPlayback=turn.streamId
    else this.avatarState(reason==='error'?'error':'idle',turn)
    turn.pendingCues=[]
    this.send({ type: 'tts', state: 'stop', reason: this.version === 1 && reason === 'timeout' ? 'cancelled' : reason }, turn)
    const end = { type: 'turn.end', turnId: turn.id, requestId: turn.requestId, conversationId: turn.conversationId, streamId: turn.streamId, reason, responseStopped: turn.responseStopped, durationMs: Date.now() - turn.startedAt, metrics: { asrMs: turn.asrMs, firstTextMs: turn.firstTextMs, firstAudioMs: turn.sender?.firstSentAt ? turn.sender.firstSentAt - turn.startedAt : undefined, audioSamples: turn.sender?.sentSamples ?? 0 } }
    this.event('turn.end', end, turn)
    if (turn.requestId && this.requests.has(turn.requestId)) this.requests.get(turn.requestId)!.end = end
    turn.ended = true; clearTimeout(turn.timer); clearTimeout(turn.captureTimer)
    turn.controller.abort(new VoiceError(reason, `turn ${reason}`)); turn.response.abort(); turn.queue?.close()
    turn.handle?.cancel(); turn.pcm = []
    if (this.active === turn) { this.active = undefined; if (this.state !== 'closed') this.state = 'ready' }
    this.deps.log('info', `turn ${turn.id}: ${reason} (${Date.now() - turn.startedAt}ms)`)
  }
  private handlePlayback(m: any) {
    if (this.version !== 2 || !this.capabilities.has('playback')) throw new VoiceError('unsupported_capability', '需要协商 playback')
    const record = this.playback.get(m.streamId), active = this.active?.streamId === m.streamId ? this.active : undefined
    const available = active?.sender?.sentSamples ?? record?.samples
    if (available === undefined || m.turnId !== (record?.turnId ?? active?.id) || !Number.isSafeInteger(m.playedSamples) || m.playedSamples < (record?.played ?? 0) || m.playedSamples > available || !['progress', 'ended', 'cleared'].includes(m.state)) throw new VoiceError('bad_playback', '播放回执的轮次、位置或状态无效')
    if (m.state === 'ended' && (!(active?.audioEnded ?? !!record) || m.playedSamples !== available)) throw new VoiceError('bad_playback', '音频发送完成且全部播放后才能报告 ended')
    if (m.bufferedSamples !== undefined) {
      if (!this.capabilities.has('playback.flow') || !Number.isSafeInteger(m.bufferedSamples) || m.bufferedSamples < 0 || m.bufferedSamples > available - m.playedSamples) throw new VoiceError('bad_playback', '播放缓冲位置无效或未协商 playback.flow')
      if (active) active.bufferedSamples = m.bufferedSamples
    }
    if (record?.ended && (m.state === 'progress' || m.playedSamples !== record.played)) throw new VoiceError('bad_playback', '播放流已结束')
    this.playback.set(m.streamId, { turnId: m.turnId, samples: available, played: m.playedSamples, ended: m.state !== 'progress' })
    this.event('playback.ack', { turnId: m.turnId, streamId: m.streamId, playedSamples: m.playedSamples, state: m.state })
    if(m.state!=='progress'&&this.waitingPlayback===m.streamId&&!this.active){this.waitingPlayback=undefined;this.avatarState('idle')}
  }
  private selectConversation(m: any) {
    if (this.version !== 2 || !this.capabilities.has('conversation.select')) throw new VoiceError('unsupported_capability', '需要协商 conversation.select')
    if (this.active) throw new VoiceError('busy', '请先结束当前轮')
    if (!identifier(m.conversationId) || (m.conversationId !== this.deviceId && !this.deps.allowConversation?.(this.deviceId, m.conversationId))) throw new VoiceError('bad_conversation', '对话不属于此设备')
    this.conversationId = m.conversationId
    const config=this.deps.settings(this.deviceId)
    this.event('conversation.selected', { conversationId: this.conversationId, sessionId: this.deps.bridge.sessionId(this.scope(this.conversationId,config.agentPreset), config.agentPreset) })
    this.waitingPlayback=undefined;this.resetPresentation('conversation_changed');this.avatarState('idle');if(this.capabilities.has('ui.render'))this.uiSnapshot()
  }

  private avatarState(state:string,turn?:TurnContext) {if(this.capabilities.has('presentation.state'))this.event('presentation.state',{state,sequence:++this.presentationSequence},turn)}
  private resetPresentation(reason:string,turn?:TurnContext) {if(this.capabilities.has('presentation.state')||this.capabilities.has('presentation.cue'))this.event('presentation.reset',{reason},turn)}
  private scope(conversation:string,preset:string) {return this.deps.scope?.(this.deviceId,conversation,preset)??conversation}
  private surfaceKey(turn?:TurnContext) {return SurfaceStore.key(this.deviceId,turn?.conversationId??this.conversationId,turn?.settings.agentPreset??this.deps.settings(this.deviceId).agentPreset,(turn?.epoch??this.deps.epoch?.(this.deviceId)))}
  private requireUI() {if(this.version!==2||!this.capabilities.has('ui.render'))throw new VoiceError('unsupported_capability','需要协商 ui.render')}
  private uiSnapshot() {
    this.requireUI()
    this.event('ui.snapshot',{conversationId:this.conversationId,components:this.surface.snapshot(this.surfaceKey()).filter(c=>this.presentation.components.includes(c.type))})
  }
  private clientEffect(turn:TurnContext,effect:ClientEffect) {
    if(!this.current(turn))throw new VoiceError('cancelled','轮次已结束')
    if(++turn.effectCount>64)throw new VoiceError('presentation_overflow','单轮最多 64 个表现或界面操作')
    if(effect.kind==='cue') {
      if(!this.capabilities.has('presentation.cue')||turn.responseStopped)throw new VoiceError('unsupported_presentation','表现输出不可用')
      if(turn.pendingCues.length>=16)throw new VoiceError('presentation_overflow','等待音频的动作过多')
      const cueId=newId()
      if(effect.cue.timing==='next_sentence')turn.pendingCues.push({cueId,cue:effect.cue})
      else this.event('presentation.cue',{...effect.cue,cueId,sequence:++this.presentationSequence},turn)
      return {cueId,status:effect.cue.timing==='now'?'sent':'scheduled'}
    }
    this.requireUI()
    if(effect.kind==='render') {
      const component=this.surface.render(this.surfaceKey(turn),effect.component,turn.id)
      this.event('ui.render',{component},turn);return {componentId:component.id,revision:component.revision,instanceId:component.instanceId}
    }
    const revision=this.surface.remove(this.surfaceKey(turn),effect.componentId)
    if(revision!==undefined)this.event('ui.remove',{componentId:effect.componentId,revision},turn)
    return {removed:revision!==undefined}
  }
  private uiAction(m:any) {
    this.requireUI()
    if(Object.keys(m).some(k=>!['type','requestId','componentId','instanceId','revision','actionId','values'].includes(k)))throw new VoiceError('bad_ui_action','不接受客户端提供的操作文本')
    if(this.requestSeen(m))return
    if(this.active)throw new VoiceError('busy','请等待当前轮结束后操作')
    if(!identifier(m.componentId)||!identifier(m.actionId)||typeof m.instanceId!=='string'||!Number.isSafeInteger(m.revision))throw new VoiceError('bad_ui_action','操作身份无效')
    const prepared=this.surface.prepare(this.surfaceKey(),m.componentId,m.revision,m.instanceId,m.actionId,m.values)
    const turn=this.begin(m)
    if(!turn)return
    try {this.event('ui.render',{component:prepared.consume()},turn)}catch(e){this.error('stale_ui',String(e),turn);this.finish(turn,'error');return}
    this.event('ui.action.accepted',{componentId:m.componentId,actionId:m.actionId},turn)
    this.launch(turn,()=>this.pipeline(turn,prepared.text))
  }
  private uiDismiss(m:any) {
    this.requireUI()
    if(!identifier(m.componentId)||!Number.isSafeInteger(m.revision)||typeof m.instanceId!=='string')throw new VoiceError('bad_ui_action','组件身份无效')
    const revision=this.surface.remove(this.surfaceKey(),m.componentId,m.revision,m.instanceId)
    if(revision!==undefined)this.event('ui.remove',{componentId:m.componentId,revision})
  }
  handleClosed() {
    if (this.state === 'closed') return
    this.state = 'closed'
    if (this.active) this.finish(this.active, 'disconnected')
    this.playback.clear()
  }
  close(code = 1001, reason = 'server shutdown') { this.handleClosed(); this.ws.close(code, reason) }
}

export function sanitizeDeviceId(value: unknown): string {
  return typeof value === 'string' ? value.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) : ''
}
