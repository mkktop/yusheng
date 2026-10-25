# 验证记录

## 0.3.0：设置面板视觉与交互优化

2026-10-25 重做 dsh 内的「语声语音」设置面板：接入宿主明暗主题，增加运行概览、可折叠连接配置和「声音与对话 / 设备管理 / 连接诊断」分类；宽屏并排显示声音和对话设置，窄屏自动堆叠。语速、音量、音调支持滑块与精确数值；底部固定显示待保存数量、撤销和保存反馈。

浏览器使用实际 React 组件和本地模拟 REST 服务验证了错误令牌提示、连接成功自动收起、修改与保存、独立设备签发/撤销及脱敏显示、三项诊断的加载/结果状态，以及浅色、深色和 390px 容器布局。模拟凭据仅用于本地验证，未调用真实供应商接口。效果图：[深色设置面板](validation/settings-dark.png)。

`npm test`：36 项回归测试及 HTTP/WS 冒烟全部通过；构建产物语法检查与 `git diff --check` 通过。新版面板已通过 MeatShell 同步到 GM800，设备上的 `lib/client.js` SHA-256 与本地一致：`b9f0f693978114a79c665a11ce0066476a27b124cb25e8cf93fbf4504cacb4d7`。升级前备份：`/opt/yusheng-backups/voice-before-settings-20261025-100331.tgz`。

## 0.3.0：形象与智能 UI

2026-10-25 已部署 GM800，服务正常运行，最终 `lib/index.js`、`lib/client.js`、`lib/voice-client.js`、`lib/demo-client.js` 的 SHA-256 均与本地一致。原设备/管理凭据保持不变，总轮次期限保持 180 秒。

`npm test` 的 36 项测试与 HTTP/WS 冒烟全部通过。新增覆盖：客户端能力限制、会话作用域工具注册/释放、表情动作播放时钟调度、取消后清理、UI 状态持久化和过期、实例/版本防重放、点击去重、表单类型和值域校验、跨设备/对话/预设隔离，以及纯语音兼容。

真实 agent（MiniMax-M3.1-Flash）验证通过：表情 happy＋动作 nod 在语音采样位置 0 触发；生成 choices，点击后正确返回“按钮闭环成功”；重复点击没有重新执行；进度组件更新版本并到达 0.75；表单拒绝缺少必填项的提交，合法提交继续驱动 agent。宿主重启后，组件 instanceId/revision、agent sessionId 均保持不变，点击仍返回“界面重启验证通过”。

报告：[真实交互链路](validation/yusheng-interaction-report.json)、[界面跨宿主重启](validation/yusheng-ui-restart-report.json)。

浏览器参考客户端通过本地模拟服务验证了实际连接、表情状态、音频播放、选项点击、表单提交及刷新恢复。模拟场景截图：[界面预览](validation/avatar-ui-preview.png)。模拟服务只使用静音 PCM 与固定回复，不访问外部 API；真实模型能力由上述 GM800 测试单独验证。参考界面在本机直连 GM800 的 `/demo` 返回 HTTP 200。

升级前插件备份：`/opt/yusheng-backups/voice-before-ui-20261025-093306.tgz`。接入方式、协议边界和复测命令见 [INTERACTION.md](INTERACTION.md)。

最终宿主构建 SHA-256：`3ea2f59d0a7958863d83694587d47bc76933964a1a972d38c66ba73175cfe384`。

最终设置面板构建 SHA-256：`53b46e234a1d2acb98d964bb51bc6802ed05cf9fc77d988fb71798793bf1a1d7`。

最终浏览器 SDK SHA-256：`e12ac22353d64d939fed5a3632b0dca0be69832d569cc2283b150ba46bc43d4d`。

最终参考客户端 SHA-256：`0fdd81a105c7fa930be4d47d23ac16c61f5b99a53b70f204ef71e8abaa5df900`。

## 0.2.0：语音基础链路

验证日期：2026-10-25（Asia/Shanghai）。修改已通过 MeatShell 保存的 GM800 连接部署到 `/opt/yusheng-voice`，服务 `gm800-dsh.service` 正常运行；线上构建文件与本地 SHA-256 一致。

## 本地

`npm test` 自动构建，再执行 23 项回归测试与原有 HTTP/WS 冒烟测试，全部通过。回归覆盖 ASR/准备阶段取消、轮次竞态、会话互斥、宿主子 agent 等待语义、模型选择、持久化消息身份、合成失败与截断、总期限、去重、音频帧对齐、网络与播放背压、鉴权隔离、令牌撤销和服务关闭。

本地运行环境：Windows / Node 24.22.0。源代码测试使用临时构建，冒烟验证提交的 `lib/` 构建产物。

## GM800

设备环境：ARM64 / Node 22.23.3；真实使用设备已配置的 MiniMax ASR/TTS 与 dsh 默认模型 `minimax-cn / MiniMax-M3.1-Flash`。未导出或记录设备凭据。

完整报告：[语音链路](validation/yusheng-final-report.json)、[宿主重启续接](validation/yusheng-restart-report.json)。

9 项真实链路测试加 1 项跨重启续接验证全部通过：

1. REST 管理/设备凭据分离，服务声明 v1/v2。
2. v1 客户端真实 TTS，保持裸 PCM 输出。
3. v2 agent 实际执行工具、下发带头音频、接收播放回执，并在断线重连后保留口令。
4. 真实 ASR → agent → TTS。
5. ASR 中途打断不会再启动旧轮 agent，下一轮正常播报。
6. 实际取消 agent 工具任务，收尾后下一轮正常执行。
7. 约 53.0 秒的长语音完整发送，未触发原先 30 秒截断。
8. 客户端反馈播放积压后暂停发送，缓冲恢复后继续完成。
9. 临时设置 15 秒总期限，长工具任务按期超时并取消；测试后恢复为 180 秒。
10. 用全新对话保存口令，重启 dsh 后实际会话 ID 不变，正确恢复口令。

语音输入采用真实 TTS 音频重采样后回送真实 ASR，验证的是设备上的服务链路。未测量物理麦克风、扬声器、回声消除或噪声环境效果。延迟数值是单次记录，不作为稳定性能基准。

## 部署与迁移

- 升级前插件备份：`/opt/yusheng-backups/voice-20261025-085846.tgz`。
- 升级前配置备份：`/opt/yusheng-backups/settings-20261025-085846.json`，仅保留在设备，权限 0600。
- MiniMax API Key 保持原值。
- GM800 原先没有配置设备令牌。升级后自动生成共享设备 `token` 和管理 `adminToken`，均保存在 `/root/.dsh/yusheng-voice/settings.json`。客户端需配置设备令牌，设置面板需填写管理令牌；管理令牌不提供给设备。
- v1 的消息和裸 PCM 格式继续兼容；无令牌访问已关闭。
- 旧版缺少身份字段的损坏历史仍保留原文件，沿用替补会话机制；新版提交的消息携带 `id` 和 `role`，已实测跨宿主重启恢复。

最终宿主构建 `lib/index.js` SHA-256：`39d550b1b5a71b92e770451d189f5e26278ecfbfffe3688b9783b5422309b5fb`。

最终界面构建 `lib/client.js` SHA-256：`15c42512b1fa71fa044f3bf954caac72e2be81169ebe420ab5ccf336f49413d9`。

## 复测

```sh
npm test
# 以下在设备上运行，凭据直接读本地 settings.json
VOICE_LONG_TEST=1 node tools/device-test.mjs
node tools/restart-probe.mjs write
# 正常重启 dsh 并等待语音端口就绪
node tools/restart-probe.mjs read
```

实现边界和后续协议演进见 [PROTOCOL.md](PROTOCOL.md)。当前仍为客户端断句、整段 ASR 与 PCM 编码，没有声称实现服务端 VAD、流式 ASR、Opus、后台任务或多模态 UI。
