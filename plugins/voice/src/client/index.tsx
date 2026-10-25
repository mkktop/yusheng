// 浏览器半边：在左侧边栏「全局面板」注册「语声语音」设置入口（位于「自动化任务」上方）。
// 注册模式与官方面板（插件页 order 0 / 自动化任务 order 10）一致：
//   1) ctx.slots.inject("main", ...)            —— 面板内容组件（按 key 寻址）
//   2) ctx.slots.inject("sidebar.panellist", …) —— 左侧按钮（图标组件 + order）
// 面板通过语音服务自带的 REST（CORS + 令牌）读写设置，不依赖官方 settings
// 表单通道（该通道在非回环访问下不持久化）。

import { VoiceSettingsPanel } from './settings-panel.js'

const PANEL_ID = 'dsh-yusheng-voice'

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
