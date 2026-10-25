// 进程内 dsh 会话驱动：参照官方 headless runner（@deepseek-ai/dsh-headless）
// 的公开模式 —— agents.create / agents.resume + agent.followup(用户消息) +
// agent/assistant-stream 实时增量 + agent.whenIdle 等待收敛 + sessions.flush。
// 运行在 web 宿主进程内，直接复用 web 配置的默认模型与凭据。

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, realpathSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { dirname } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { abortable, VoiceError } from './protocol.js'
import { interactionTools, type ClientEffect, type PresentationSupport } from './interaction.js'
import { voiceSystemPrompt, voicePersonaContext, type VoicePersona } from './persona.js'
import { memoryContext, memoryTool, type MemoryAccess } from './client-memory.js'

interface ClientScope { clientId:string; conversation:string; epoch:string; cwd:string; indexPath:string; model?:{provider:string;model:string}; legacy:boolean }

export interface TurnCallbacks {
  onActivity?(event: { state: string; toolCallId?: string; name?: string }): void
  onClientEffect?(effect: ClientEffect): unknown
  /** 收到一段实时文本增量（已过滤非文本帧） */
  onTextDelta(text: string): void
  /** 本轮收敛（completed 或 error）；cancelled 为 true 表示本地已放弃等待 */
  onEnd(result: { kind: 'completed' | 'error' | 'cancelled'; text: string; error?: string }): void
}

export interface TurnHandle {
  sessionId: string
  /** Abort the host agent, immediately detach callbacks; keep its lease until actually idle. */
  cancel(): void
  /** 等待本轮结束（含取消） */
  done: Promise<{ kind: 'completed' | 'error' | 'cancelled'; text: string; error?: string }>
}

/** 按标点把增量文本切成可合成句子；feed() 返回成句文本，flush() 返回剩余。 */
export class SentenceSlicer {
  private buffer = ''
  private static readonly MAJOR = new Set(['。', '！', '？', '!', '?', '；', ';', '\n'])
  private static readonly MINOR = new Set(['，', ',', '、', '：', ':', '）', ')', '"', '”'])
  private static readonly MINOR_FLUSH_LEN = 24
  private static readonly HARD_FLUSH_LEN = 160

  feed(delta: string): string[] {
    this.buffer += delta
    return this.drain(false)
  }

  flush(): string {
    const rest = this.buffer.trim()
    this.buffer = ''
    return rest
  }

  private drain(final: boolean): string[] {
    const out: string[] = []
    let index = 0
    while (index < this.buffer.length) {
      const ch = this.buffer[index]
      index += 1
      if (SentenceSlicer.MAJOR.has(ch) || (SentenceSlicer.MINOR.has(ch) && index >= SentenceSlicer.MINOR_FLUSH_LEN) || index >= SentenceSlicer.HARD_FLUSH_LEN) {
        const sentence = this.buffer.slice(0, index).trim()
        this.buffer = this.buffer.slice(index)
        if (sentence !== '') out.push(sentence)
        index = 0
      }
    }
    if (final) {
      const rest = this.buffer.trim()
      this.buffer = ''
      if (rest !== '') out.push(rest)
    }
    return out
  }
}

interface AnyAgent {
  session: { seq: number; id?: string }
  options?: { provider?: string; model?: string }
  followup(message: unknown): unknown
  whenIdle(): Promise<unknown>
  status?: string
  abort?: (reason?: unknown) => unknown
  cancel?: (cause: { kind: 'user' }) => void
  ctx?: any
}

/** 每设备一个持久 agent 的驱动器；宿主 ctx 注入 agents/sessions 服务。 */
export class AgentBridge {
  private ctx: any
  private agents: any
  private sessions: any
  private agentsBySession = new Map<string, AnyAgent>()
  /** 已应用全开权限预设的 agent（permissionPresets.set 幂等，此集合只为省重复解析） */
  private accessApplied = new WeakSet<AnyAgent>()
  private preparing = new Map<string, Promise<AnyAgent>>()
  private leases = new Set<string>()
  private agentLeases = new WeakSet<AnyAgent>()
  private prefixedSessions = new Set<string>()
  private selections = new WeakMap<AnyAgent, { current: any; assembled: any }>()
  private selectionApi?: Promise<any>
  /** cacheKey → 实际采用的会话 id（原始派生 id 的会话损坏降级后，记住替补避免每次重连都丢上下文） */
  private adoptedByCacheKey = new Map<string, string>()
  private adoptionPath: string | undefined
  private cwdPromise: Promise<string> | undefined
  private clientScopes = new Map<string,ClientScope>()
  private clientIndexes = new Map<string,{clientId:string;entries:Record<string,string>;prefixed:string[]}>()
  private legacyOwner?: (conversation:string)=>string|undefined

  configureLegacyOwner(resolve:(conversation:string)=>string|undefined) {this.legacyOwner=resolve}
  clientScope(clientId:string,conversation:string,epoch:string,options:Omit<ClientScope,'clientId'|'conversation'|'epoch'>) {
    const key='c-'+createHash('sha256').update(JSON.stringify([clientId,conversation,epoch])).digest('hex').slice(0,48)
    this.clientScopes.set(key,{clientId,conversation,epoch,...options})
    if(!this.clientIndexes.has(options.indexPath)){
      const raw=existsSync(options.indexPath)?JSON.parse(readFileSync(options.indexPath,'utf8')):{clientId,entries:{},prefixed:[]}
      if(raw?.clientId!==clientId||!raw.entries||typeof raw.entries!=='object'||Array.isArray(raw.entries)||!Array.isArray(raw.prefixed))throw new Error('invalid client session index')
      this.clientIndexes.set(options.indexPath,raw)
      for(const id of raw.prefixed)if(typeof id==='string')this.prefixedSessions.add(id)
    }
    return key
  }
  private scopedAdoption(deviceKey:string,preset:string) {
    const scope=this.clientScopes.get(deviceKey)
    if(!scope)return
    const key=this.cacheKey(deviceKey,preset)
    if(this.adoptedByCacheKey.has(key))return
    const localKey=JSON.stringify([scope.conversation,scope.epoch,preset]),stored=this.clientIndexes.get(scope.indexPath)!.entries[localKey]
    if(typeof stored==='string'){this.adoptedByCacheKey.set(key,stored);return}
    if(!scope.legacy||scope.epoch!=='legacy'||this.legacyOwner?.(scope.conversation)!==scope.clientId)return
    const old=this.adoptedByCacheKey.get(this.cacheKey(scope.conversation,preset))
    if(!old)return
    // Ambiguous legacy aliases are not safe to adopt, even within the same client.
    for(const [alias,id] of this.adoptedByCacheKey)if(id===old){
      const parts=JSON.parse(alias)
      if(!this.clientScopes.has(parts[0])&&(this.legacyOwner?.(parts[0])!==scope.clientId||parts[0]!==scope.conversation||parts[1]!==preset))return
    }
    this.recordAdoption(key,old)
  }

  private warn(message: string) {
    if (typeof this.ctx.logger?.warn === 'function') this.ctx.logger.warn(`yusheng-voice: ${message}`)
    else console.warn(`yusheng-voice: ${message}`)
  }

  constructor(ctx: any, adoptionPath?: string) {
    this.ctx = ctx
    this.agents = ctx.get('agents')
    this.sessions = ctx.get('sessions')
    if (this.agents === undefined) throw new Error('yusheng-voice: profile 未提供 agents 服务')
    if (this.sessions === undefined) throw new Error('yusheng-voice: profile 未提供 sessions 服务')
    this.adoptionPath = adoptionPath
    try {
      if (adoptionPath !== undefined && existsSync(adoptionPath)) {
        const raw = JSON.parse(readFileSync(adoptionPath, 'utf8'))
        if (raw && typeof raw === 'object') {
          if (Array.isArray(raw._voicePrefixed)) for (const id of raw._voicePrefixed) if (typeof id === 'string') this.prefixedSessions.add(id)
          for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
            if (typeof value === 'string' && value !== '') {
              const legacy = key.split('::')
              this.adoptedByCacheKey.set(key.startsWith('[') ? key : this.cacheKey(legacy[0], legacy[1] ?? ''), value)
            }
          }
        }
      }
    } catch {
      /* 边车损坏则忽略，按派生 id 探测 */
    }
  }

  private recordAdoption(cacheKey: string, sessionId: string) {
    if (this.adoptedByCacheKey.get(cacheKey) === sessionId) return
    this.adoptedByCacheKey.set(cacheKey, sessionId)
    this.persistIndex(cacheKey)
  }

  private persistIndex(cacheKey?:string) {
    const parts=cacheKey?JSON.parse(cacheKey):undefined,scope=parts&&this.clientScopes.get(parts[0])
    const path = scope?.indexPath??this.adoptionPath
    if (path === undefined) return
    try {
      let entries:any
      if(scope){
        const local=this.clientIndexes.get(path)!
        local.entries[JSON.stringify([scope.conversation,scope.epoch,parts[1]])]=this.adoptedByCacheKey.get(cacheKey!)!
        local.prefixed=[...new Set(Object.values(local.entries).filter(id=>this.prefixedSessions.has(id)))]
        entries=local
      }else entries = { ...Object.fromEntries([...this.adoptedByCacheKey].filter(([key])=>!this.clientScopes.has(JSON.parse(key)[0]))), _voicePrefixed: [...this.prefixedSessions] }
      mkdirSync(dirname(path), { recursive: true })
      const temporary = `${path}.${randomUUID()}.tmp`
      writeFileSync(temporary, JSON.stringify(entries, null, 2) + '\n', { mode: 0o600 })
      renameSync(temporary, path)
    } catch (error) {
      this.warn(`session index persistence failed: ${String(error)}`)
      if(scope)throw new Error('cannot persist client session index')
    }
  }

  /** 默认模型选择（与 web 界面一致）。 */
  currentModel(): { provider: string; model: string } | undefined {
    const selection = this.ctx.get('agentDefaultModel')?.currentSelection?.()
    if (selection && typeof selection.provider === 'string' && typeof selection.model === 'string') {
      return { provider: selection.provider, model: selection.model }
    }
    return undefined
  }

  /** 与 headless runner 相同的 cwd 解析：经挂载的 fs 服务取规范绝对路径。 */
  private resolveCwd(): Promise<string> {
    this.cwdPromise ??= (async () => {
      try {
        const fs = this.ctx.get('fs')
        if (fs !== undefined) {
          const resolved = await fs.resolve('.')
          const processed = fs.processPath(resolved)
          if (typeof processed === 'string' && processed.length > 0) return processed
        }
      } catch {
        /* fs 服务不可用则退回进程 cwd */
      }
      return process.cwd()
    })()
    return this.cwdPromise
  }

  /**
   * 会话 id 按所选 preset 派生：默认模式沿用 voice-<device>，
   * 指定模式用 voice-<device>-p-<preset>。切换模式即开新会话（预设首轮后
   * 锁定），切回默认则无缝恢复原对话。
   */
  private static sessionIdFor(deviceKey: string, presetId: string): string {
    const preset = /^[a-z0-9_-]+$/.test(presetId) ? presetId : presetId === '' ? '' : `id-${createHash('sha256').update(presetId).digest('hex').slice(0, 16)}`
    return preset === '' ? `voice-${deviceKey}` : `voice-${deviceKey}-p-${preset}`
  }

  sessionId(deviceKey: string, presetId = ''): string {
    this.scopedAdoption(deviceKey,presetId)
    const key = this.cacheKey(deviceKey, presetId)
    return this.adoptedByCacheKey.get(key) ?? AgentBridge.sessionIdFor(deviceKey, presetId)
  }

  private cacheKey(deviceKey: string, presetId: string) { return JSON.stringify([deviceKey, presetId]) }

  /** 枚举可用的 dsh 会话模式（agent preset）；服务缺失返回 undefined。 */
  async listPresets(): Promise<Array<{ id: string; name?: string; isDefault: boolean; broken?: boolean; problem?: string }> | undefined> {
    const presets = this.ctx.get('agentPresets')
    if (presets === undefined) return undefined
    try {
      const inventory = typeof presets.list === 'function' ? await presets.list() : await presets.compositionInventory()
      return inventory.map((record: any) => ({
        id: String(record.id),
        name: typeof record.name === 'string' ? record.name : undefined,
        isDefault: record.isDefault === true || record.id === presets.defaultId,
        broken: record.broken ? true : undefined,
        ...(record.broken ? { problem: String(record.broken).slice(0, 2000) } : {}),
      }))
    } catch {
      return undefined
    }
  }

  /**
   * 与官方 headless runner 等价的模型选择注入（installModelSelection 的内联复刻，
   * 避免跨包加载 @deepseek-ai/dsh-agent）：在 agent 上下文挂 system-prompt/assemble
   * 钩子，把当前默认模型的 provider/model 提供为提示词变量。
   */
  private modelSetup(deviceKey?:string): { agentOptions: { provider: string; model: string }; setup: (agentCtx: any, agent: AnyAgent) => Promise<void> } | undefined {
    const scope=deviceKey&&this.clientScopes.get(deviceKey)
    const selection = scope?scope.model:this.currentModel()
    if(scope&&(!selection?.provider||!selection?.model))throw new VoiceError('no_client_model','请为此客户端配置对话提供方与模型')
    if (selection === undefined || typeof selection.provider !== 'string' || typeof selection.model !== 'string') {
      return undefined
    }
    const agentOptions = { provider: selection.provider, model: selection.model }
    const setup = async (agentCtx: any, agent: AnyAgent) => { await this.installSelection(agentCtx, agent) }
    return { agentOptions, setup }
  }

  private async installSelection(agentCtx: any, agent: AnyAgent) {
    if (this.selections.has(agent) || !agentCtx) return
    const ref = { current: this.currentModel(), assembled: undefined as any }
    // Resolve from the running dsh entry point so link-installed plugins reuse the host's exact API.
    this.selectionApi ??= (async () => {
      const resolver = createRequire(realpathSync(process.argv[1]))
      return import(pathToFileURL(resolver.resolve('@deepseek-ai/dsh-agent')).href)
    })()
    const api = await this.selectionApi
    if (typeof api.installModelSelection !== 'function') throw new Error('dsh installModelSelection API unavailable')
    const stop = api.installModelSelection(agentCtx, ref)
    this.ctx.effect?.(() => stop, 'yusheng-voice: model selection')
    this.selections.set(agent, ref)
  }

  async agentFor(deviceKey: string, presetId: string): Promise<AnyAgent> {
    const cacheKey = this.cacheKey(deviceKey, presetId)
    const pending = this.preparing.get(cacheKey)
    if (pending) return pending
    const operation = this.prepareAgent(deviceKey, presetId, cacheKey)
    this.preparing.set(cacheKey, operation)
    try { return await operation } finally { this.preparing.delete(cacheKey) }
  }

  private async prepareAgent(deviceKey: string, presetId: string, cacheKey: string): Promise<AnyAgent> {
    this.scopedAdoption(deviceKey,presetId)
    const cached = this.agentsBySession.get(cacheKey)
    if (cached !== undefined) return cached
    const presets = this.ctx.get('agentPresets')
    if (presetId && presets) {
      const inventory = await this.listPresets()
      if (!inventory) throw new VoiceError('preset_unavailable', '无法读取 dsh 会话模式')
      const selected = inventory.find((item: any) => item.id === presetId)
      if (!selected || selected.broken) throw new VoiceError('invalid_preset', `指定的会话模式不存在或不可用${selected?.problem ? '：'+selected.problem : ''}`)
    }
    const cwd = this.clientScopes.get(deviceKey)?.cwd??await this.resolveCwd()
    const model = this.modelSetup(deviceKey)

    // 与 headless runner 相同的次序：先查进程内在实例，再探测持久会话，存在才 resume，
    // 不存在才 create——盲目 resume→create 会对已存在会话撞 "already exists"。
    // 候选顺序：上次实际采用的 id（边车记录）优先于派生 id；原始会话损坏降级后，
    // 重连/重启都回到替补会话，保持上下文。
    const derived = AgentBridge.sessionIdFor(deviceKey, presetId)
    const candidates: string[] = []
    const adopted = this.adoptedByCacheKey.get(cacheKey)
    if (adopted !== undefined && adopted !== derived) candidates.push(adopted)
    candidates.push(derived)
    const existed = new Set<string>()

    let agent: AnyAgent | undefined
    for (const sessionId of candidates) {
      try {
        const live = this.agents.get?.(sessionId)
        if (live !== undefined) {
          agent = live
          this.recordAdoption(cacheKey, sessionId)
          break
        }
      } catch {
        /* get 不可用则跳过 */
      }
      const query = this.ctx.get('sessionQuery')
      if (query === undefined) break
      let persisted = false
      try {
        await query.observeSession(sessionId)
        persisted = true
      } catch (error) {
        const message = String(error?.message ?? '')
        const notFound = error?.code === 'SESSION_QUERY_SESSION_NOT_FOUND' || message.includes('SESSION_QUERY_SESSION_NOT_FOUND') || message.toLowerCase().includes('not found')
        if (notFound) continue
        // 损坏/校验失败等：记录仍在磁盘上，按"存在但可能无法接管"处理
        persisted = true
        this.warn(`observeSession("${sessionId}") failed: ${error instanceof Error ? error.message : String(error)}`)
      }
      if (!persisted) continue
      existed.add(sessionId)
      try {
        const resumed = await this.agents.resume({ resumeSessionId: sessionId, ...(model ?? {}) })
        agent = resumed?.agent ?? resumed
        this.recordAdoption(cacheKey, sessionId)
        break
      } catch (error) {
        this.warn(`resume("${sessionId}") failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    let created = false
    if (agent === undefined) {
      // 派生 id 已被占用（损坏/无法接管）时换新 id 起话，避免 "already exists" 卡死
      const createId = existed.has(derived) ? `${derived}-r${randomUUID().slice(0, 8)}` : derived
      const createdAgent = await this.agents.create({ sessionId: createId, meta: { cwd }, ...(model ?? {}) })
      agent = createdAgent?.agent ?? createdAgent
      created = true
      this.recordAdoption(cacheKey, createId)
    }
    // 会话模式仅对全新会话生效（preset 首轮后锁定）；无效模式在准备前拒绝。
    // 未指定模式时应用 profile 默认 preset：裸 agents.create 只装配基础工具
    // （如 working_directory），缺 shell 等工具会导致模型为完成任务反复空转。
    if (created) {
      const presets = this.ctx.get('agentPresets')
      if (presets !== undefined) {
        let toApply = presetId
        if (toApply === '') {
          try {
            const inventory = await this.listPresets()
            const def = (inventory ?? []).find((record: any) => record.isDefault === true)
            if (def !== undefined) toApply = String(def.id)
          } catch {
            /* 拿不到清单则跳过（保持裸装配） */
          }
        }
        if (toApply !== '') {
          try {
            await presets.select(agent, toApply)
          } catch (error) {
            throw new VoiceError('preset_failed', `无法应用会话模式 ${toApply}: ${error instanceof Error ? error.message : String(error)}`)
          }
        }
      }
    }
    this.applyFullAccess(agent)
    await this.installSelection(agent.ctx, agent)
    this.agentsBySession.set(cacheKey, agent)
    return agent
  }

  /**
   * 语音会话全开权限：应用 danger-full-access 预设（沙箱全访问 + 审批策略 never，
   * 不再有升权等待）。语音设备无人交互，默认 workspace-write + ask 会让需要
   * 升权的工具调用永久挂起等审批。set 幂等：已是当前预设时不追加事件。
   */
  private applyFullAccess(agent: AnyAgent) {
    if (this.accessApplied.has(agent)) return
    this.accessApplied.add(agent)
    const presets = this.ctx.get('permissionPresets')
    if (presets === undefined || typeof presets.set !== 'function') return
    try {
      presets.set(agent.session, 'danger-full-access')
    } catch (error) {
      this.warn(`cannot apply danger-full-access preset: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /** 释放缓存引用（连接关闭时调用；会话日志持久化，下次可 resume）。 */
  release(deviceKey: string) {
    for (const key of this.agentsBySession.keys()) if (JSON.parse(key)[0] === deviceKey && !this.leases.has(key)) this.agentsBySession.delete(key)
  }

  /** 提交一轮用户消息并跟踪该 agent 的实时文本增量直至收敛。 */
  async turn(deviceKey: string, text: string, callbacks: TurnCallbacks, presetId = '', options: { signal?: AbortSignal; promptPrefix?: string; persona?: VoicePersona; memory?:MemoryAccess; capabilities?: string[]; presentation?: PresentationSupport } = {}): Promise<TurnHandle> {
    const key = this.cacheKey(deviceKey, presetId)
    options.signal?.throwIfAborted()
    if (this.leases.has(key)) throw new VoiceError('session_busy', '会话仍在执行或取消收尾，请稍后重试')
    this.leases.add(key)
    let agent: AnyAgent
    try {
      // Preparation may persist a session; finish it before releasing this lease even after cancellation.
      agent = await this.agentFor(deviceKey, presetId)
      options.signal?.throwIfAborted()
      if (this.agentLeases.has(agent) || (agent.status !== undefined && agent.status !== 'idle')) throw new VoiceError('session_busy', '宿主会话尚未空闲')
    } catch (e) { this.leases.delete(key); throw e }
    this.agentLeases.add(agent)
    const selection = this.selections.get(agent)
    if (selection) selection.current = this.clientScopes.get(deviceKey)?.model??this.currentModel()
    let cancelled = false, failure: unknown, fullText = ''
    const stops: Array<() => void> = []
    const toolStops: Array<() => void> = []
    const promptStops: Array<() => void> = []
    let hasPresentationTools=false
    const detach = () => { for (const stop of stops.splice(0)) stop() }
    const local = new AbortController()
    const cancel = () => {
      if (cancelled) return
      cancelled = true; detach(); local.abort()
      try {
        if (agent.cancel) agent.cancel({ kind: 'user' })
        else Promise.resolve(agent.abort?.('yusheng-voice: cancelled')).catch(() => undefined)
      } catch { /* retain lease until the host actually settles */ }
    }
    options.signal?.addEventListener('abort', cancel, { once: true })
    stops.push(this.ctx.on('agent/assistant-stream', ({ agent: subject, frame }: any) => {
      if (subject !== agent || cancelled) return
      const chunk = frame?.chunk
      if (chunk?.type === 'tool-call-delta' && chunk.name) callbacks.onActivity?.({ state: 'tool', toolCallId: String(chunk.id).slice(0, 128), name: String(chunk.name).slice(0, 128) })
      if (chunk?.type === 'text-delta' && typeof chunk.text === 'string' && chunk.text) {
        fullText = (fullText + chunk.text).slice(-64_000)
        callbacks.onTextDelta(chunk.text)
      }
    }))
    stops.push(this.ctx.on('agent/error', ({ agent: subject, error }: any) => { if (subject === agent) failure = error }))
    stops.push(this.ctx.on('agent/status', ({ agent: subject, status }: any) => { if (subject === agent && !cancelled) callbacks.onActivity?.({ state: status }) }))
    const execution = (async () => {
      try {
        if(options.memory){
          const tools=agent.ctx?.get('tools'),prompt=agent.ctx?.get('systemPrompt')
          if(!tools?.register||!prompt?.context)throw new VoiceError('memory_unavailable','宿主不提供客户端记忆工具接口')
          toolStops.push(tools.register(memoryTool(options.memory,exec=>{
            if(exec.agent!==agent)throw new VoiceError('wrong_agent','记忆工具仅供当前客户端会话使用')
            if(cancelled)throw new VoiceError('cancelled','本轮已取消')
            options.signal?.throwIfAborted()
          })))
          promptStops.push(prompt.context({name:'yusheng:client-memory',order:260,required:true,interpolate:false,text:()=>memoryContext(options.memory!.read())}))
        }
        if(callbacks.onClientEffect && options.presentation) {
          const tools=agent.ctx?.get('tools')
          if(!tools?.register)throw new VoiceError('client_tools_unavailable','宿主不提供会话工具注册接口')
          const definitions=interactionTools(options.presentation,options.capabilities??[],callbacks.onClientEffect,exec=>{
            if(exec.agent!==agent)throw new VoiceError('wrong_agent','表现工具仅供当前语音会话使用')
            if(cancelled)throw new VoiceError('cancelled','本轮已取消')
            options.signal?.throwIfAborted()
          })
          for(const definition of definitions)toolStops.push(tools.register(definition))
          hasPresentationTools=definitions.length>0
        }
        if (options.persona) {
          const prompt = agent.ctx?.get('systemPrompt')
          if (!prompt?.section || !prompt?.context) throw new VoiceError('persona_unavailable', '宿主不提供会话系统提示与运行时上下文接口，无法应用助手人设')
          // A child agent scope shadows the selected preset's persona, including a complete persona.
          // Dispose only after the host turn settles so cancellation cannot affect another request.
          promptStops.push(prompt.section({ name: 'deployment:persona-prefix', order: 0, interpolate: false,
            text: voiceSystemPrompt(options.persona, options.promptPrefix, options.presentation, hasPresentationTools) }))
          promptStops.push(prompt.context({ name: 'yusheng:persona', order: 250, required: true, interpolate: false,
            text: voicePersonaContext(options.persona) }))
        }
        // Prefix is per persistent conversation, not per WebSocket connection.
        const sessionId = this.sessionId(deviceKey, presetId)
        const first = !this.prefixedSessions.has(sessionId)
        const style = !options.persona && first && options.promptPrefix?.trim() ? `${options.promptPrefix.trim()}\n\n` : ''
        const client = !options.persona && hasPresentationTools ? `客户端能力：${JSON.stringify(options.presentation)}。可使用 voice_present 表达表情动作，voice_ui 展示界面（仅已注册的工具可用）。界面操作会作为后续用户消息返回。\n\n` : ''
        const prompt = `${style}${client}${style||client?'用户说：':''}${text}`
        // UserMessage is an identified role-bearing durable value, not a bare prompt.
        await agent.followup({ id: randomUUID(), role: 'user', content: [{ type: 'text', text: prompt }], source: { kind: 'user' } })
        if (first) { this.prefixedSessions.add(sessionId); this.persistIndex(key) }
        while (true) {
          await agent.whenIdle()
          if (cancelled) break
          const children = this.ctx.get('subagents')
          const joined = children?.waitForChildren ? await children.waitForChildren(agent) : false
          // Host returns false when there was no child work; true means recheck the parent.
          if (!joined && (agent.status === undefined || agent.status === 'idle')) break
        }
        await this.sessions.flush(agent.session)
        if (failure !== undefined) throw failure
        return { kind: 'completed' as const, text: fullText }
      } catch (e) {
        return { kind: 'error' as const, text: fullText, error: e instanceof Error ? e.message : String(e) }
      } finally {
        detach(); options.signal?.removeEventListener('abort', cancel)
        for(const stop of [...toolStops.splice(0), ...promptStops.splice(0)]) {
          try { await stop() } catch(error) { this.warn(`cannot dispose turn contribution: ${error instanceof Error ? error.message : String(error)}`) }
        }
        this.leases.delete(key); this.agentLeases.delete(agent)
        // Retain only active agents locally; host owns their actual lifecycle.
        this.agentsBySession.delete(key)
      }
    })()
    const done = abortable(execution, local.signal).catch(() => ({ kind: 'cancelled' as const, text: fullText })).then(result => { callbacks.onEnd(result); return result })
    return { sessionId: this.sessionId(deviceKey, presetId), cancel, done }
  }
}
