// 设置存储：运行期可在设置面板热编辑，持久化为 JSON（0600）。
// cordis config 只提供监听地址与设置文件路径（见 cordis.patch.yml）。

import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { homedir } from 'node:os'
import { DEFAULT_PERSONA, PERSONA_ENUMS, PERSONA_TEXT_LIMITS, VOICE_PRESET_ID, type VoicePersona } from './persona.js'

export interface VoiceSettings extends VoicePersona {
  llmProvider: string
  llmModel: string
  /** The compatibility credential is bound to exactly one client. */
  legacyDeviceId: string
  /** minimax API Key（api.minimax.cn，ASR 与 TTS 共用） */
  minimaxApiKey: string
  /** ASR 模型，当前枚举 asr-1.0 */
  asrModel: string
  /** TTS 模型，如 speech-2.8-turbo / speech-2.6-hd */
  ttsModel: string
  /** TTS 音色 id */
  ttsVoice: string
  /** TTS 语速 0.5–2 */
  ttsSpeed: number
  /** TTS 音量 0–10 */
  ttsVol: number
  /** TTS 音调 -12–12 */
  ttsPitch: number
  /** 每轮系统提示中的补充对话要求；留空不附加 */
  promptPrefix: string
  /** dsh 会话模式（agent preset id）；空 = 跟随 profile 默认 */
  agentPreset: string
  /** 共享设备接入令牌；空 = 禁用共享接入 */
  token: string
  /** REST 管理凭据，与设备凭据分离；只在轮换时返回。 */
  adminToken: string
  deviceTokens: Record<string, string>
  allowedOrigins: string[]
  /** 单轮最长等待秒数（超时本地取消下发） */
  maxTurnSeconds: number
}

const LEGACY_DEFAULT_PREFIX =
  '你是语音助手。始终用简短、口语化的中文回答（通常不超过三句话），不要使用 Markdown、代码块或列表。'

export const DEFAULT_SETTINGS: VoiceSettings = {
  ...DEFAULT_PERSONA,
  llmProvider: '',
  llmModel: '',
  legacyDeviceId: '',
  minimaxApiKey: '',
  asrModel: 'asr-1.0',
  ttsModel: 'speech-2.8-turbo',
  ttsVoice: 'female-shaonv',
  ttsSpeed: 1,
  ttsVol: 1,
  ttsPitch: 0,
  promptPrefix: '',
  agentPreset: VOICE_PRESET_ID,
  token: '',
  adminToken: '',
  deviceTokens: {},
  allowedOrigins: [],
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
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('settings patch must be an object')
  const next: VoiceSettings = { ...current }
  const rejected: string[] = []
  const strings: Array<[keyof VoiceSettings, number]> = [
    ['minimaxApiKey', 256],
    ['asrModel', 64],
    ['ttsModel', 64],
    ['ttsVoice', 128],
    ['promptPrefix', 4000],
    ['agentPreset', 64],
    ['llmProvider', 128],
    ['llmModel', 128],
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
  for (const [key, max] of Object.entries(PERSONA_TEXT_LIMITS)) {
    if (!Object.hasOwn(patch, key)) continue
    const v = patch[key]
    if (typeof v !== 'string' || v.length > max || (key !== 'personalityNotes' && /[\u0000-\u001f\u007f]/.test(v)) || ((key === 'assistantName' || key === 'assistantRole') && !v.trim())) rejected.push(key)
    else (next as any)[key] = v.trim()
  }
  for (const [key, choices] of Object.entries(PERSONA_ENUMS)) {
    if (!Object.hasOwn(patch, key)) continue
    if (choices.some(choice => choice.id === patch[key])) (next as any)[key] = patch[key]
    else rejected.push(key)
  }
  for (const [key, min, max] of [['ttsSpeed', .5, 2], ['ttsVol', 0, 10], ['ttsPitch', -12, 12], ['maxTurnSeconds', 15, 600]] as const) {
    if (!Object.hasOwn(patch, key)) continue
    const value = patch[key]
    if (typeof value !== 'number' || !Number.isFinite(value)) { rejected.push(key); continue }
    next[key] = key === 'maxTurnSeconds' ? Math.round(clampNumber(value, min, max, current[key])) : clampNumber(value, min, max, current[key])
  }
  if ('allowedOrigins' in patch) {
    if (Array.isArray(patch.allowedOrigins) && patch.allowedOrigins.length <= 32 && patch.allowedOrigins.every(x => {
      try { return typeof x === 'string' && new URL(x).origin === x && /^https?:/.test(x) } catch { return false }
    })) next.allowedOrigins = [...patch.allowedOrigins]
    else rejected.push('allowedOrigins')
  }
  if ('adminToken' in patch) rejected.push('adminToken')
  if ('deviceTokens' in patch) rejected.push('deviceTokens')
  if ('legacyDeviceId' in patch) rejected.push('legacyDeviceId')
  for (const key of Object.keys(patch)) {
    if (!Object.hasOwn(DEFAULT_SETTINGS, key)) rejected.push(key)
  }
  return { settings: next, rejected }
}

/** 面板可见的脱敏视图：密钥只报有无，其余原样。 */
export function maskSettings(s: VoiceSettings): Record<string, unknown> {
  return {
    ...Object.fromEntries([...Object.keys(PERSONA_TEXT_LIMITS), ...Object.keys(PERSONA_ENUMS)].map(key => [key, (s as any)[key]])),
    minimaxApiKey: '',
    hasMinimaxApiKey: s.minimaxApiKey !== '',
    asrModel: s.asrModel,
    ttsModel: s.ttsModel,
    ttsVoice: s.ttsVoice,
    ttsSpeed: s.ttsSpeed,
    ttsVol: s.ttsVol,
    ttsPitch: s.ttsPitch,
    promptPrefix: s.promptPrefix,
    agentPreset: s.agentPreset,
    llmProvider: s.llmProvider,
    llmModel: s.llmModel,
    legacyDeviceId: s.legacyDeviceId,
    token: s.token,
    adminTokenConfigured: !!s.adminToken,
    devices: Object.keys(s.deviceTokens),
    allowedOrigins: s.allowedOrigins,
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
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('settings must be an object')
        if (raw && typeof raw === 'object') {
          const { settings } = mergeSettings(DEFAULT_SETTINGS, raw as Record<string, unknown>)
          // Replace only the old built-in first-turn style. Custom instructions remain intact.
          if (!Object.hasOwn(raw, 'assistantName') && raw.promptPrefix === LEGACY_DEFAULT_PREFIX) settings.promptPrefix = ''
          this.data = settings
          if (typeof raw.legacyDeviceId === 'string' && /^[a-zA-Z0-9_-]{1,48}$/.test(raw.legacyDeviceId)) this.data.legacyDeviceId = raw.legacyDeviceId
          if (typeof raw.adminToken === 'string' && raw.adminToken.length >= 24) this.data.adminToken = raw.adminToken
          if (raw.deviceTokens && typeof raw.deviceTokens === 'object' && !Array.isArray(raw.deviceTokens)) {
            this.data.deviceTokens = Object.fromEntries(Object.entries(raw.deviceTokens).filter(([id, token]) => /^[a-zA-Z0-9_-]{1,48}$/.test(id) && typeof token === 'string' && token.length >= 24)) as Record<string, string>
          }
        }
      }
    } catch (error) {
      throw new Error(`yusheng-voice: cannot read settings; refusing to reset credentials: ${String(error)}`)
    }
    if (!this.data.adminToken) {
      this.data = { ...this.data, adminToken: `ysa-${randomBytes(32).toString('base64url')}`, token: this.data.token || `ysv-${randomBytes(24).toString('base64url')}` }
      this.save(this.data)
    }
  }

  get(): VoiceSettings {
    return { ...this.data, deviceTokens: { ...this.data.deviceTokens }, allowedOrigins: [...this.data.allowedOrigins] }
  }

  update(patch: Record<string, unknown>): { settings: VoiceSettings; rejected: string[] } {
    const merged = mergeSettings(this.data, patch)
    this.save(merged.settings)
    this.data = merged.settings
    return merged
  }

  regenerateToken(): string {
    const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
    const bytes = randomBytes(24)
    let token = 'ysv-'
    for (const b of bytes) token += alphabet[b % alphabet.length]
    // Rotating the compatibility credential switches this one identity back from its issued token.
    const deviceTokens={...this.data.deviceTokens};if(this.data.legacyDeviceId)delete deviceTokens[this.data.legacyDeviceId]
    const next = { ...this.data, token, deviceTokens }
    this.save(next); this.data = next
    return token
  }

  issueDevice(id: string): string {
    if (!/^[a-zA-Z0-9_-]{1,48}$/.test(id)) throw new Error('invalid deviceId')
    if (Object.keys(this.data.deviceTokens).length >= 256 && !Object.hasOwn(this.data.deviceTokens, id)) throw new Error('device limit reached')
    const token = `ysd-${randomBytes(32).toString('base64url')}`
    const next = { ...this.data, ...(this.data.legacyDeviceId===id?{token:''}:{}), deviceTokens: { ...this.data.deviceTokens, [id]: token } }
    this.save(next); this.data = next; return token
  }

  revokeDevice(id: string) {
    const deviceTokens = { ...this.data.deviceTokens }; delete deviceTokens[id]
    const next = { ...this.data, deviceTokens, ...(this.data.legacyDeviceId===id?{token:''}:{}) }; this.save(next); this.data = next
  }

  claimLegacy(id:string) {
    if(!/^[a-zA-Z0-9_-]{1,48}$/.test(id)||!this.data.token||Object.hasOwn(this.data.deviceTokens,id))return false
    if(this.data.legacyDeviceId)return this.data.legacyDeviceId===id
    const next={...this.data,legacyDeviceId:id};this.save(next);this.data=next;return true
  }

  private save(data: VoiceSettings) {
    const temporary = `${this.path}.${randomBytes(8).toString('hex')}.tmp`
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      writeFileSync(temporary, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 })
      renameSync(temporary, this.path)
    } catch (error) {
      try { unlinkSync(temporary) } catch { /* best effort temporary cleanup */ }
      throw new Error(`cannot persist voice settings: ${String(error)}`)
    }
  }
}
