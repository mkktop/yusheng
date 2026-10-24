// 设置存储：运行期可在设置面板热编辑，持久化为 JSON（0600）。
// cordis config 只提供监听地址与设置文件路径（见 cordis.patch.yml）。

import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { homedir } from 'node:os'

export interface VoiceSettings {
  /** minimax 国内版 API Key（ASR 与 TTS 共用） */
  minimaxApiKey: string
  /** minimax 国内版 GroupId（t2a_v2 需要） */
  minimaxGroupId: string
  /** ASR 模型，国内版当前枚举 asr-1.0 */
  asrModel: string
  /** TTS 模型，如 speech-01-turbo / speech-02-hd */
  ttsModel: string
  /** TTS 音色 id */
  ttsVoice: string
  /** TTS 语速 0.5–2 */
  ttsSpeed: number
  /** TTS 音量 0–10 */
  ttsVol: number
  /** TTS 音调 -12–12 */
  ttsPitch: number
  /** 首轮系统化提示前缀（口语化约束等），留空则不包装 */
  promptPrefix: string
  /** dsh 会话模式（agent preset id）；空 = 跟随 profile 默认 */
  agentPreset: string
  /** 设备接入令牌；空 = 未配置（接口开放，面板会提示生成） */
  token: string
  /** 单轮最长等待秒数（超时本地取消下发） */
  maxTurnSeconds: number
}

const DEFAULT_PREFIX =
  '你是语音助手。始终用简短、口语化的中文回答（通常不超过三句话），不要使用 Markdown、代码块或列表。'

export const DEFAULT_SETTINGS: VoiceSettings = {
  minimaxApiKey: '',
  minimaxGroupId: '',
  asrModel: 'asr-1.0',
  ttsModel: 'speech-01-turbo',
  ttsVoice: 'female-shaonv',
  ttsSpeed: 1,
  ttsVol: 1,
  ttsPitch: 0,
  promptPrefix: DEFAULT_PREFIX,
  agentPreset: '',
  token: '',
  maxTurnSeconds: 180,
}

export function defaultSettingsPath(): string {
  const home = process.env.DSH_HOME ?? resolve(homedir(), '.dsh')
  return resolve(home, 'yusheng-voice', 'settings.json')
}

function isPlainString(v: unknown, max: number): v is string {
  return typeof v === 'string' && v.length <= max
}

function clampNumber(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

/** 校验并合并一次面板提交；未出现在提交里的键保持原值。 */
export function mergeSettings(current: VoiceSettings, patch: Record<string, unknown>): { settings: VoiceSettings; rejected: string[] } {
  const next: VoiceSettings = { ...current }
  const rejected: string[] = []
  const strings: Array<[keyof VoiceSettings, number]> = [
    ['minimaxApiKey', 256],
    ['minimaxGroupId', 64],
    ['asrModel', 64],
    ['ttsModel', 64],
    ['ttsVoice', 128],
    ['promptPrefix', 4000],
    ['agentPreset', 64],
    ['token', 128],
  ]
  for (const [key, max] of strings) {
    if (!(key in patch)) continue
    const v = patch[key]
    if (v === null || v === '') {
      ;(next as any)[key] = ''
    } else if (isPlainString(v, max)) {
      ;(next as any)[key] = v
    } else {
      rejected.push(key)
    }
  }
  if ('ttsSpeed' in patch) next.ttsSpeed = clampNumber(patch.ttsSpeed, 0.5, 2, current.ttsSpeed)
  if ('ttsVol' in patch) next.ttsVol = clampNumber(patch.ttsVol, 0, 10, current.ttsVol)
  if ('ttsPitch' in patch) next.ttsPitch = clampNumber(patch.ttsPitch, -12, 12, current.ttsPitch)
  if ('maxTurnSeconds' in patch) next.maxTurnSeconds = Math.round(clampNumber(patch.maxTurnSeconds, 15, 600, current.maxTurnSeconds))
  for (const key of Object.keys(patch)) {
    if (!(key in DEFAULT_SETTINGS)) rejected.push(key)
  }
  return { settings: next, rejected }
}

/** 面板可见的脱敏视图：密钥只报有无，其余原样。 */
export function maskSettings(s: VoiceSettings): Record<string, unknown> {
  return {
    minimaxApiKey: '',
    hasMinimaxApiKey: s.minimaxApiKey !== '',
    minimaxGroupId: s.minimaxGroupId,
    asrModel: s.asrModel,
    ttsModel: s.ttsModel,
    ttsVoice: s.ttsVoice,
    ttsSpeed: s.ttsSpeed,
    ttsVol: s.ttsVol,
    ttsPitch: s.ttsPitch,
    promptPrefix: s.promptPrefix,
    agentPreset: s.agentPreset,
    token: s.token,
    maxTurnSeconds: s.maxTurnSeconds,
  }
}

export class SettingsStore {
  path: string
  private data: VoiceSettings

  constructor(path: string) {
    this.path = path
    this.data = { ...DEFAULT_SETTINGS }
    try {
      if (existsSync(path)) {
        const raw = JSON.parse(readFileSync(path, 'utf8'))
        if (raw && typeof raw === 'object') {
          const { settings } = mergeSettings(DEFAULT_SETTINGS, raw as Record<string, unknown>)
          this.data = settings
        }
      }
    } catch (error) {
      // 损坏的设置文件按默认值起步，不阻塞插件启动
      console.warn(`[yusheng-voice] settings file unreadable, starting from defaults: ${String(error)}`)
    }
  }

  get(): VoiceSettings {
    return this.data
  }

  update(patch: Record<string, unknown>): { settings: VoiceSettings; rejected: string[] } {
    const merged = mergeSettings(this.data, patch)
    this.data = merged.settings
    this.save()
    return merged
  }

  regenerateToken(): string {
    const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
    const bytes = randomBytes(24)
    let token = 'ysv-'
    for (const b of bytes) token += alphabet[b % alphabet.length]
    this.data = { ...this.data, token }
    this.save()
    return token
  }

  private save() {
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      writeFileSync(this.path, JSON.stringify(this.data, null, 2) + '\n', { mode: 0o600 })
      try {
        chmodSync(this.path, 0o600)
      } catch {
        // Windows / 某些文件系统不支持 chmod
      }
    } catch (error) {
      console.warn(`[yusheng-voice] cannot persist settings: ${String(error)}`)
    }
  }
}
