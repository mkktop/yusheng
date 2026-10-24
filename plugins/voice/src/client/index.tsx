// 浏览器半边：在左侧边栏「全局面板」注册「语声语音」设置入口（位于「自动化任务」上方）。
// 注册模式与官方面板（插件页 order 0 / 自动化任务 order 10）一致：
//   1) ctx.slots.inject("main", ...)            —— 面板内容组件（按 key 寻址）
//   2) ctx.slots.inject("sidebar.panellist", …) —— 左侧按钮（图标组件 + order）
// 面板通过语音服务自带的 REST（CORS + 令牌）读写设置，不依赖官方 settings
// 表单通道（该通道在非回环访问下不持久化）。

import { useEffect, useMemo, useRef, useState } from 'react'

const PANEL_ID = 'dsh-yusheng-voice'
const DEFAULT_PORT = 8090

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
    const textKeys = ['minimaxGroupId', 'asrModel', 'ttsModel', 'ttsVoice', 'promptPrefix', 'agentPreset', 'token']
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
  const status: any = state.status
  const defaultPresetName = (status?.presets ?? []).find((preset: any) => preset.isDefault)?.name || (status?.presets ?? []).find((preset: any) => preset.isDefault)?.id || 'standard'
  const hasKey = s.hasMinimaxApiKey === true
  const sectionTitle: Record<string, string | number> = { margin: '18px 0 8px', fontSize: 12, fontWeight: 600, letterSpacing: 1, color: '#8b96a8', textTransform: 'uppercase' }
  const button: Record<string, string | number> = { padding: '6px 14px', borderRadius: 6, border: 0, background: '#2f6fd0', color: '#fff', fontSize: 13, cursor: 'pointer' }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '24px 28px 48px', fontSize: 13, lineHeight: 1.7, color: '#e6e9ef' }}>
      <h2 style={{ margin: '0 0 4px', fontSize: 16 }}>语声语音</h2>
      <p style={{ margin: '0 0 8px', color: '#8b96a8', fontSize: 12 }}>
        minimax {s.asrModel || 'asr-1.0'} 识别 · {s.ttsModel || 'speech-01-turbo'} 合成 · dsh 会话对话
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

      <div style={sectionTitle}>MiniMax 凭据（国内版）</div>
      <input
        style={fieldStyle()}
        type="password"
        placeholder={hasKey ? 'API Key 已配置（留空保持不变）' : 'API Key（语音识别与合成共用）'}
        value={state.form.minimaxApiKey ?? ''}
        onChange={(event) => setForm('minimaxApiKey', event.target.value)}
      />
      <input
        style={fieldStyle()}
        placeholder="GroupId（t2a_v2 必填）"
        value={state.form.minimaxGroupId ?? String(s.minimaxGroupId ?? '')}
        onChange={(event) => setForm('minimaxGroupId', event.target.value)}
      />

      <div style={sectionTitle}>语音参数</div>
      <input style={fieldStyle()} placeholder="ASR 模型（asr-1.0）" value={state.form.asrModel ?? String(s.asrModel ?? '')} onChange={(event) => setForm('asrModel', event.target.value)} />
      <input style={fieldStyle()} placeholder="TTS 模型（speech-01-turbo）" value={state.form.ttsModel ?? String(s.ttsModel ?? '')} onChange={(event) => setForm('ttsModel', event.target.value)} />
      <input style={fieldStyle()} placeholder="音色（female-shaonv）" value={state.form.ttsVoice ?? String(s.ttsVoice ?? '')} onChange={(event) => setForm('ttsVoice', event.target.value)} />
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
