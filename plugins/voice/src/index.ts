// dsh-yusheng-voice —— 语音交互后端宿主插件。
//
// 形态参照 login-gate：独立 bundle（cordis.patch.yml insert 本插件行），
// apply() 内注入 profile 提供的核心服务并启动自带端口的语音服务。
// 会话驱动参照官方 headless runner 的公开模式（agents/sessions +
// agent/assistant-stream），运行在 web 宿主进程内，复用其模型与凭据。

import { dirname, resolve } from 'node:path'
import { AgentBridge } from './llm.js'
import { VoiceServer } from './server.js'
import { SettingsStore, defaultSettingsPath } from './settings.js'

const CONFIG_KEYS = new Set(['host', 'port', 'settingsPath'])

function clampPort(value: unknown): number {
  const n = Number(value)
  if (!Number.isInteger(n) || n < 1 || n > 65535) return 8090
  return n
}

export default {
  name: 'yusheng-voice',
  inject: ['agentDefaultModel', 'agents', 'sessions', 'sessionQuery'],
  apply(root: any, config: any = {}) {
    const unknown = Object.keys(config).filter((key) => !CONFIG_KEYS.has(key))
    if (unknown.length > 0) {
      throw new Error(`yusheng-voice: unknown config fields: ${unknown.join(', ')}`)
    }
    const host = typeof config.host === 'string' && config.host !== '' ? config.host : '0.0.0.0'
    const port = clampPort(config.port)
    const settingsPath = typeof config.settingsPath === 'string' && config.settingsPath !== ''
      ? config.settingsPath
      : defaultSettingsPath()

    const store = new SettingsStore(settingsPath)
    const log = (level: 'info' | 'warn', message: string) => {
      try {
        root.logger?.[level]?.(`yusheng-voice: ${message}`)
      } catch {
        /* logger 不可用时静默 */
      }
    }

    const bridge = new AgentBridge(root, resolve(dirname(settingsPath), 'sessions.json'))
    const server = new VoiceServer(store, bridge, { host, port }, log)

    root.effect(() => server.stop(), 'yusheng-voice: server')

    server
      .start()
      .then(() => {
        if (store.get().token === '') {
          log('warn', `token 未配置，语音端点与设置接口当前开放；请尽快在设置面板生成令牌（设置文件 ${settingsPath}）`)
        }
      })
      .catch((error: unknown) => {
        log('warn', `voice server failed to start on ${host}:${port}: ${error instanceof Error ? error.message : String(error)}`)
      })
  },
}
