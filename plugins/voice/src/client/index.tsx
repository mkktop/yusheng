// 浏览器半边：在左侧边栏「全局面板」注册「语声语音」设置入口（位于「自动化任务」上方）。
// 注册模式与官方面板（插件页 order 0 / 自动化任务 order 10）一致：
//   1) ctx.slots.inject("main", ...)            —— 面板内容组件（按 key 寻址）
//   2) ctx.slots.inject("sidebar.panellist", …) —— 左侧按钮（图标组件 + order）
// 面板通过语音服务自带的 REST（CORS + 令牌）读写设置，不依赖官方 settings
// 表单通道（该通道在非回环访问下不持久化）。

import { useEffect, useMemo, useRef, useState } from 'react'

const PANEL_ID = 'dsh-yusheng-voice'
const DEFAULT_PORT = 8090
/** api.minimax.cn t2a_v2 官方模型枚举（speech-2.8 最新，turbo 为低延迟档） */
const TTS_MODELS = [
  'speech-2.8-turbo', 'speech-2.8-hd',
  'speech-2.6-turbo', 'speech-2.6-hd',
  'speech-02-turbo', 'speech-02-hd',
  'speech-01-turbo', 'speech-01-hd',
]

/** minimax 系统音色（官方音色表中文部分；其他语种/复刻音色仍可通过设置 REST 写入） */
const VOICE_GROUPS: Array<{ label: string; voices: Array<[string, string]> }> = [
  {
    label: '中文（普通话）',
    voices: [
      ['female-shaonv', '少女音色'], ['female-yujie', '御姐音色'], ['female-chengshu', '成熟女性音色'],
      ['female-tianmei', '甜美女性音色'], ['female-shaonv-jingpin', '少女音色·beta'], ['female-yujie-jingpin', '御姐音色·beta'],
      ['female-chengshu-jingpin', '成熟女性音色·beta'], ['female-tianmei-jingpin', '甜美女性音色·beta'],
      ['male-qn-qingse', '青涩青年音色'], ['male-qn-jingying', '精英青年音色'], ['male-qn-badao', '霸道青年音色'],
      ['male-qn-daxuesheng', '青年大学生音色'], ['male-qn-qingse-jingpin', '青涩青年音色·beta'], ['male-qn-jingying-jingpin', '精英青年音色·beta'],
      ['male-qn-badao-jingpin', '霸道青年音色·beta'], ['male-qn-daxuesheng-jingpin', '青年大学生音色·beta'],
      ['clever_boy', '聪明男童'], ['cute_boy', '可爱男童'], ['lovely_girl', '萌萌女童'], ['cartoon_pig', '卡通猪小琪'],
      ['bingjiao_didi', '病娇弟弟'], ['junlang_nanyou', '俊朗男友'], ['chunzhen_xuedi', '纯真学弟'],
      ['lengdan_xiongzhang', '冷淡学长'], ['badao_shaoye', '霸道少爷'], ['tianxin_xiaoling', '甜心小玲'],
      ['qiaopi_mengmei', '俏皮萌妹'], ['wumei_yujie', '妩媚御姐'], ['diadia_xuemei', '嗲嗲学妹'], ['danya_xuejie', '淡雅学姐'],
      ['Chinese (Mandarin)_Reliable_Executive', '沉稳高管'], ['Chinese (Mandarin)_News_Anchor', '新闻女声'],
      ['Chinese (Mandarin)_Mature_Woman', '傲娇御姐'], ['Chinese (Mandarin)_Unrestrained_Young_Man', '不羁青年'],
      ['Arrogant_Miss', '嚣张小姐'], ['Robot_Armor', '机械战甲'], ['Chinese (Mandarin)_Kind-hearted_Antie', '热心大婶'],
      ['Chinese (Mandarin)_HK_Flight_Attendant', '港普空姐'], ['Chinese (Mandarin)_Humorous_Elder', '搞笑大爷'],
      ['Chinese (Mandarin)_Gentleman', '温润男声'], ['Chinese (Mandarin)_Warm_Bestie', '温暖闺蜜'],
      ['Chinese (Mandarin)_Male_Announcer', '播报男声'], ['Chinese (Mandarin)_Sweet_Lady', '甜美女声'],
      ['Chinese (Mandarin)_Southern_Young_Man', '南方小哥'], ['Chinese (Mandarin)_Wise_Women', '阅历姐姐'],
      ['Chinese (Mandarin)_Gentle_Youth', '温润青年'], ['Chinese (Mandarin)_Warm_Girl', '温暖少女'],
      ['Chinese (Mandarin)_Kind-hearted_Elder', '花甲奶奶'], ['Chinese (Mandarin)_Cute_Spirit', '憨憨萌兽'],
      ['Chinese (Mandarin)_Radio_Host', '电台男主播'], ['Chinese (Mandarin)_Lyrical_Voice', '抒情男声'],
      ['Chinese (Mandarin)_Straightforward_Boy', '率真弟弟'], ['Chinese (Mandarin)_Sincere_Adult', '真诚青年'],
      ['Chinese (Mandarin)_Gentle_Senior', '温柔学姐'], ['Chinese (Mandarin)_Stubborn_Friend', '嘴硬竹马'],
      ['Chinese (Mandarin)_Crisp_Girl', '清脆少女'], ['Chinese (Mandarin)_Pure-hearted_Boy', '清澈邻家弟弟'],
      ['Chinese (Mandarin)_Soft_Girl', '柔和少女'],
    ],
  },
  {
    label: '中文（粤语）',
    voices: [
      ['Cantonese_ProfessionalHost（F)', '专业女主持'], ['Cantonese_GentleLady', '温柔女声'],
      ['Cantonese_ProfessionalHost（M)', '专业男主持'], ['Cantonese_PlayfulMan', '活泼男声'],
      ['Cantonese_CuteGirl', '可爱女孩'], ['Cantonese_KindWoman', '善良女声'],
    ],
  },
]

export const inject = ['slots']

export function apply(ctx: any) {
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID }, VoiceSettingsPanel))

  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    // 官方排位：插件 0、自动化任务 10、任务 20；取 5 恰好位于自动化任务上方
    order: 5,
    label: '语声语音',
  }, VoicePanelIcon))
}

function VoicePanelIcon(props: any) {
  const size = typeof props?.size === 'number' ? props.size : 18
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false"
    >
      <rect x="9" y="2.5" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <line x1="12" y1="18" x2="12" y2="21.5" />
      <line x1="8.5" y1="21.5" x2="15.5" y2="21.5" />
    </svg>
  )
}

// ---- 设置面板 ----

interface PanelState {
  baseUrl: string
  token: string
  status: any
  settings: any
  loadError: string
  form: Record<string, string>
  saving: boolean
  savedAt: string
  testing: Record<string, { busy: boolean; result?: any }>
}

function fieldStyle(extra?: Record<string, string | number>): Record<string, string | number> {
  return {
    width: '100%', boxSizing: 'border-box', padding: '6px 9px', marginBottom: 4,
    borderRadius: 6, border: '1px solid #34405280', background: '#10151f',
    color: 'inherit', fontSize: 13, fontFamily: 'inherit', ...extra,
  }
}

function VoiceSettingsPanel() {
  const [state, setState] = useState<PanelState>({
    baseUrl: `http://${typeof location !== 'undefined' ? location.hostname : '127.0.0.1'}:${DEFAULT_PORT}`,
    token: '',
    status: undefined,
    settings: undefined,
    loadError: '',
    form: {},
    saving: false,
    savedAt: '',
    testing: {},
  })
  const tokenRef = useRef('')
  tokenRef.current = state.token

  const api = useMemo(() => {
    const call = async (path: string, init?: RequestInit) => {
      const token = tokenRef.current
      const url = new URL(state.baseUrl + path)
      if (token !== '') url.searchParams.set('token', token)
      const response = await fetch(url.toString(), {
        ...init,
        headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
      })
      return response.json()
    }
    return {
      get: (path: string) => call(path),
      post: (path: string) => call(path, { method: 'POST' }),
      put: (path: string, body: unknown) => call(path, { method: 'PUT', body: JSON.stringify(body) }),
    }
  }, [state.baseUrl])

  const refresh = async () => {
    try {
      const [status, settingsResponse] = await Promise.all([api.get('/status'), api.get('/settings')])
      if (settingsResponse?.ok) {
        setState((prev) => ({
          ...prev,
          status,
          settings: settingsResponse.settings,
          token: typeof settingsResponse.settings?.token === 'string' ? settingsResponse.settings.token : prev.token,
          loadError: '',
        }))
      } else {
        setState((prev) => ({ ...prev, loadError: '设置读取失败：' + String(settingsResponse?.message ?? '未知错误') }))
      }
    } catch (error) {
      setState((prev) => ({ ...prev, loadError: `无法连接语音服务（${prev.baseUrl}）：${String(error)}` }))
    }
  }

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), 5000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api])

  const setForm = (key: string, value: string) => {
    setState((prev) => ({ ...prev, form: { ...prev.form, [key]: value } }))
  }

  const save = async () => {
    setState((prev) => ({ ...prev, saving: true }))
    const current: any = state.settings ?? {}
    const form = state.form
    const patch: Record<string, unknown> = {}
    const textKeys = ['asrModel', 'ttsModel', 'ttsVoice', 'promptPrefix', 'agentPreset', 'token']
    for (const key of textKeys) {
      if (typeof form[key] === 'string' && form[key] !== String(current[key] ?? '')) patch[key] = form[key]
    }
    // 密钥：留空不提交（不清除）；输入了才覆盖
    if (typeof form.minimaxApiKey === 'string' && form.minimaxApiKey !== '') patch.minimaxApiKey = form.minimaxApiKey
    for (const key of ['ttsSpeed', 'ttsVol', 'ttsPitch', 'maxTurnSeconds']) {
      if (typeof form[key] === 'string' && form[key] !== '' && Number.isFinite(Number(form[key]))) patch[key] = Number(form[key])
    }
    try {
      const result = await api.put('/settings', patch)
      setState((prev) => ({
        ...prev,
        saving: false,
        savedAt: result?.ok ? '已保存 ' + new Date().toLocaleTimeString() : '保存失败：' + String(result?.message ?? ''),
        settings: result?.settings ?? prev.settings,
        form: { ...prev.form, minimaxApiKey: '' },
      }))
    } catch (error) {
      setState((prev) => ({ ...prev, saving: false, savedAt: '保存失败：' + String(error) }))
    }
  }

  const regenerateToken = async () => {
    try {
      const result = await api.post('/token')
      if (result?.ok) {
        setState((prev) => ({ ...prev, token: result.token }))
        void refresh()
      }
    } catch {
      /* 状态刷新会带回错误 */
    }
  }

  const runTest = async (kind: 'asr' | 'tts' | 'llm') => {
    setState((prev) => ({ ...prev, testing: { ...prev.testing, [kind]: { busy: true } } }))
    try {
      const result = await api.post(`/test/${kind}`)
      setState((prev) => ({ ...prev, testing: { ...prev.testing, [kind]: { busy: false, result } } }))
    } catch (error) {
      setState((prev) => ({ ...prev, testing: { ...prev.testing, [kind]: { busy: false, result: { ok: false, message: String(error) } } } }))
    }
  }

  const s: any = state.settings ?? {}
  const currentTtsModel = String(s.ttsModel ?? 'speech-2.8-turbo')
  const ttsModelOptions = TTS_MODELS.includes(currentTtsModel) ? TTS_MODELS : [currentTtsModel, ...TTS_MODELS]
  const currentTtsVoice = String(s.ttsVoice ?? 'female-shaonv')
  const knownVoiceIds = new Set(VOICE_GROUPS.flatMap((group) => group.voices.map(([id]) => id)))
  const status: any = state.status
  const defaultPresetName = (status?.presets ?? []).find((preset: any) => preset.isDefault)?.name || (status?.presets ?? []).find((preset: any) => preset.isDefault)?.id || 'standard'
  const hasKey = s.hasMinimaxApiKey === true
  const sectionTitle: Record<string, string | number> = { margin: '18px 0 8px', fontSize: 12, fontWeight: 600, letterSpacing: 1, color: '#8b96a8', textTransform: 'uppercase' }
  const button: Record<string, string | number> = { padding: '6px 14px', borderRadius: 6, border: 0, background: '#2f6fd0', color: '#fff', fontSize: 13, cursor: 'pointer' }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '24px 28px 48px', fontSize: 13, lineHeight: 1.7, color: '#e6e9ef' }}>
      <h2 style={{ margin: '0 0 4px', fontSize: 16 }}>语声语音</h2>
      <p style={{ margin: '0 0 8px', color: '#8b96a8', fontSize: 12 }}>
        minimax {s.asrModel || 'asr-1.0'} 识别 · {s.ttsModel || 'speech-2.8-turbo'} 合成 · dsh 会话对话
      </p>

      {state.loadError !== '' && (
        <p style={{ ...fieldStyle({ display: 'block' }), color: '#ff8f8f', border: '1px solid #5c2f2f', background: '#1f1416' }}>{state.loadError}</p>
      )}

      <div style={sectionTitle}>运行状态</div>
      <div style={{ color: '#aab4c6' }}>
        <div>{status ? (status.ok ? `在线 · 已运行 ${Math.floor((status.uptimeSec ?? 0) / 60)} 分钟` : '状态异常') : '…'}</div>
        <div>模型：{status?.model ? `${status.model.provider} / ${status.model.model}` : '未知'}</div>
        <div>设备连接：{status?.clients?.length ?? 0} 个</div>
        <div style={{ wordBreak: 'break-all' }}>接入端点：<code>{`ws://${typeof location !== 'undefined' ? location.hostname : '127.0.0.1'}:${DEFAULT_PORT}/voice`}</code></div>
      </div>

      <div style={sectionTitle}>MiniMax 凭据（api.minimax.cn）</div>
      <input
        style={fieldStyle()}
        type="password"
        placeholder={hasKey ? 'API Key 已配置（留空保持不变）' : 'API Key（语音识别与合成共用）'}
        value={state.form.minimaxApiKey ?? ''}
        onChange={(event) => setForm('minimaxApiKey', event.target.value)}
      />
      <p style={{ margin: '0 0 4px', color: '#8b96a8', fontSize: 11 }}>
        Key 在新版开放平台「账户管理 › 接口密钥」获取；新版 API 无需 GroupId。
      </p>

      <div style={sectionTitle}>语音参数</div>
      <input style={fieldStyle()} placeholder="ASR 模型（asr-1.0）" value={state.form.asrModel ?? String(s.asrModel ?? '')} onChange={(event) => setForm('asrModel', event.target.value)} />
      <label style={{ display: 'block' }}>
        <span style={{ display: 'block', color: '#8b96a8', fontSize: 11, margin: '4px 0 3px' }}>TTS 模型</span>
        <select style={fieldStyle()} value={state.form.ttsModel ?? currentTtsModel} onChange={(event) => setForm('ttsModel', event.target.value)}>
          {ttsModelOptions.map((model) => (
            <option key={model} value={model}>{model}</option>
          ))}
        </select>
      </label>
      <label style={{ display: 'block' }}>
        <span style={{ display: 'block', color: '#8b96a8', fontSize: 11, margin: '4px 0 3px' }}>音色</span>
        <select style={fieldStyle()} value={state.form.ttsVoice ?? currentTtsVoice} onChange={(event) => setForm('ttsVoice', event.target.value)}>
          {!knownVoiceIds.has(currentTtsVoice) && <option value={currentTtsVoice}>{currentTtsVoice}（自定义）</option>}
          {VOICE_GROUPS.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.voices.map(([id, name]) => (
                <option key={id} value={id}>{name}（{id}）</option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <div style={{ display: 'flex', gap: 8 }}>
        {([['ttsSpeed', '语速', '0.5–2'], ['ttsVol', '音量', '0–10'], ['ttsPitch', '音调', '−12–12']] as const).map(([key, label, range]) => (
          <label key={key} style={{ flex: 1, display: 'block' }}>
            <span style={{ display: 'block', color: '#8b96a8', fontSize: 11, margin: '4px 0 3px' }}>{label}（{range}）</span>
            <input style={fieldStyle({ marginBottom: 4 })} type="number" value={state.form[key] ?? String(s[key] ?? (key === 'ttsPitch' ? 0 : 1))} onChange={(event) => setForm(key, event.target.value)} />
          </label>
        ))}
      </div>

      <div style={sectionTitle}>dsh 会话模式</div>
      <select
        style={fieldStyle()}
        value={state.form.agentPreset ?? String(s.agentPreset ?? '')}
        onChange={(event) => setForm('agentPreset', event.target.value)}
      >
        <option value="">跟随默认（{defaultPresetName}）</option>
        {(status?.presets ?? []).map((preset: any) => (
          <option key={preset.id} value={preset.id}>
            {preset.name || preset.id}{preset.isDefault ? '（默认）' : ''}{preset.broken ? '（异常）' : ''}
          </option>
        ))}
      </select>
      <p style={{ margin: '0 0 4px', color: '#8b96a8', fontSize: 11 }}>
        模式在会话首轮后锁定：切换后下一轮将开启新会话（上下文重置），切回原模式可恢复原对话。
      </p>

      <div style={sectionTitle}>提示词前缀（首轮生效）</div>
      <textarea
        style={fieldStyle({ height: 84, resize: 'vertical' })}
        value={state.form.promptPrefix ?? String(s.promptPrefix ?? '')}
        onChange={(event) => setForm('promptPrefix', event.target.value)}
      />

      <div style={sectionTitle}>接入安全</div>
      {state.token === '' ? (
        <p style={{ color: '#ffb36b', margin: '0 0 8px' }}>未配置令牌：语音端点与设置接口当前对局域网开放，建议立即生成。</p>
      ) : (
        <div style={{ wordBreak: 'break-all', color: '#aab4c6', marginBottom: 8 }}>令牌：<code>{state.token}</code></div>
      )}
      <button style={button} onClick={() => void regenerateToken()}>{state.token === '' ? '生成接入令牌' : '重新生成令牌'}</button>

      <div style={sectionTitle}>连通性自检</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {(['asr', 'tts', 'llm'] as const).map((kind) => {
          const entry = state.testing[kind]
          return (
            <button key={kind} style={button} disabled={entry?.busy} onClick={() => void runTest(kind)}>
              {entry?.busy ? '测试中…' : `测试 ${kind.toUpperCase()}`}
            </button>
          )
        })}
      </div>
      {(['asr', 'tts', 'llm'] as const).map((kind) => {
        const entry = state.testing[kind]
        if (entry === undefined || entry.busy) return null
        const result = entry.result ?? {}
        return (
          <p key={kind} style={{ margin: '6px 0 0', color: result.ok ? '#7fd18b' : '#ff8f8f', fontSize: 12 }}>
            {kind.toUpperCase()}：{result.ok === true ? `通过（${result.durationMs ?? '?'}ms）` : `失败 — ${String(result.message ?? result.code ?? '未知错误')}`}
          </p>
        )
      })}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 22 }}>
        <button style={{ ...button, background: state.saving ? '#4a5568' : '#2f6fd0' }} disabled={state.saving} onClick={() => void save()}>
          {state.saving ? '保存中…' : '保存设置'}
        </button>
        {state.savedAt !== '' && <span style={{ color: '#8b96a8', fontSize: 12 }}>{state.savedAt}</span>}
      </div>
      <p style={{ color: '#66707f', fontSize: 11, marginTop: 14 }}>
        服务端口由 profile 配置（cordis.patch.yml，默认 {DEFAULT_PORT}）；设置持久化在服务器 $DSH_HOME/yusheng-voice/settings.json。
      </p>
    </div>
  )
}
