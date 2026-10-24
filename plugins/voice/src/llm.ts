// 进程内 dsh 会话驱动：参照官方 headless runner（@deepseek-ai/dsh-headless）
// 的公开模式 —— agents.create / agents.resume + agent.followup(用户消息) +
// agent/assistant-stream 实时增量 + agent.whenIdle 等待收敛 + sessions.flush。
// 运行在 web 宿主进程内，直接复用 web 配置的默认模型与凭据。

export interface TurnCallbacks {
  /** 收到一段实时文本增量（已过滤非文本帧） */
  onTextDelta(text: string): void
  /** 本轮收敛（completed 或 error）；cancelled 为 true 表示本地已放弃等待 */
  onEnd(result: { kind: 'completed' | 'error' | 'cancelled'; text: string; error?: string }): void
}

export interface TurnHandle {
  /** 本地取消：停止等待与回调（后台任由其自然收敛） */
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
  session: { seq: number }
  followup(message: unknown): unknown
  whenIdle(): Promise<unknown>
  status?: string
  abort?: (reason?: unknown) => unknown
}

/** 每设备一个持久 agent 的驱动器；宿主 ctx 注入 agents/sessions 服务。 */
export class AgentBridge {
  private ctx: any
  private agents: any
  private sessions: any
  private agentsBySession = new Map<string, AnyAgent>()
  private cwdPromise: Promise<string> | undefined

  constructor(ctx: any) {
    this.ctx = ctx
    this.agents = ctx.get('agents')
    this.sessions = ctx.get('sessions')
    if (this.agents === undefined) throw new Error('yusheng-voice: profile 未提供 agents 服务')
    if (this.sessions === undefined) throw new Error('yusheng-voice: profile 未提供 sessions 服务')
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

  private static sessionIdFor(deviceKey: string): string {
    return `voice-${deviceKey}`
  }

  /**
   * 与官方 headless runner 等价的模型选择注入（installModelSelection 的内联复刻，
   * 避免跨包加载 @deepseek-ai/dsh-agent）：在 agent 上下文挂 system-prompt/assemble
   * 钩子，把当前默认模型的 provider/model 提供为提示词变量。
   */
  private modelSetup(): { agentOptions: { provider: string; model: string }; setup: (agentCtx: any) => void } | undefined {
    const selection = this.ctx.get('agentDefaultModel')?.currentSelection?.()
    if (selection === undefined || typeof selection.provider !== 'string' || typeof selection.model !== 'string') {
      return undefined
    }
    const agentOptions = { provider: selection.provider, model: selection.model }
    const setup = (agentCtx: any) => {
      agentCtx.on('system-prompt/assemble', async (_assembly: unknown, _context: unknown, next: () => Promise<any>) => {
        const assembled = await next()
        return {
          ...assembled,
          variables: { ...(assembled?.variables ?? {}), provider: selection.provider, model: selection.model },
        }
      })
    }
    return { agentOptions, setup }
  }

  async agentFor(deviceKey: string): Promise<AnyAgent> {
    const cached = this.agentsBySession.get(deviceKey)
    if (cached !== undefined) return cached
    const sessionId = AgentBridge.sessionIdFor(deviceKey)
    const cwd = await this.resolveCwd()
    const model = this.modelSetup()
    let agent: AnyAgent | undefined
    try {
      const resumed = await this.agents.resume({ resumeSessionId: sessionId, ...(model ?? {}) })
      agent = resumed?.agent ?? resumed
    } catch {
      agent = undefined
    }
    if (agent === undefined) {
      const created = await this.agents.create({ sessionId, meta: { cwd }, ...(model ?? {}) })
      agent = created?.agent ?? created
    }
    this.agentsBySession.set(deviceKey, agent)
    return agent
  }

  /** 释放缓存引用（连接关闭时调用；会话日志持久化，下次可 resume）。 */
  release(deviceKey: string) {
    this.agentsBySession.delete(deviceKey)
  }

  /** 提交一轮用户消息并跟踪该 agent 的实时文本增量直至收敛。 */
  async turn(deviceKey: string, text: string, callbacks: TurnCallbacks): Promise<TurnHandle> {
    const agent = await this.agentFor(deviceKey)
    let cancelled = false
    let failure: { error: unknown } | undefined

    const stopStream = this.ctx.on('agent/assistant-stream', ({ agent: subject, frame }: any) => {
      if (subject !== agent || cancelled) return
      const chunk = frame?.chunk
      if (chunk?.type === 'text-delta' && typeof chunk.text === 'string' && chunk.text !== '') {
        callbacks.onTextDelta(chunk.text)
      }
    })
    const stopErrors = this.ctx.on('agent/error', ({ agent: subject, error }: any) => {
      if (subject === agent) failure = { error }
    })

    const done = (async () => {
      try {
        agent.followup({
          content: [{ type: 'text', text }],
          source: { kind: 'user' },
        })
        while (!cancelled) {
          await agent.whenIdle()
          const subagents = this.ctx.get('subagents')
          const settled = subagents?.waitForChildren ? await subagents.waitForChildren(agent) : true
          if (!settled && agent.status !== 'idle') continue
          break
        }
        await this.sessions.flush(agent.session).catch(() => undefined)
        if (cancelled) {
          const result = { kind: 'cancelled' as const, text: '' }
          callbacks.onEnd(result)
          return result
        }
        if (failure !== undefined) {
          const error = failure.error instanceof Error ? failure.error.message : String(failure.error)
          const result = { kind: 'error' as const, text: '', error }
          callbacks.onEnd(result)
          return result
        }
        const result = { kind: 'completed' as const, text: '' }
        callbacks.onEnd(result)
        return result
      } finally {
        stopStream()
        stopErrors()
      }
    })()

    return {
      cancel: () => {
        if (cancelled) return
        cancelled = true
        try {
          agent.abort?.('yusheng-voice: user aborted')
        } catch {
          /* 旧版 agent 无 abort API 时仅本地放弃 */
        }
      },
      done,
    }
  }
}
