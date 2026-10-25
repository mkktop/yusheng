# 0.6.0 结构化记忆与相关回忆（2026-10-25）

已部署到 GM800 `/opt/yusheng-voice`，原“木偶”配置与会话保留。升级前插件与完整客户端数据分别备份到 `/opt/yusheng-backups/voice-before-memory-v2-20261025-201146.tgz`、`data-before-memory-v2-20261025-201146.tgz`（0600，留在设备本地）。回滚到 0.5 时需同时恢复兼容的数据备份。

本地 `npm test`：60 项测试与 smoke 全部通过。新增旧格式迁移、结构化字段校验、主题键更新、版本冲突、相关性排序和到期排除、摘录容量、记录策略、敏感内容拒收、记忆工具字段校验、遗忘屏障、旧轮次写入拦截、ASR 迟到输入拦截和 owner 管理路由。

GM800 真实模型、语音链路的 9 项检查全部通过（[记忆报告](validation/yusheng-memory-report.json)）：

1. 两个客户端独立配置记录方式并保存不同偏好。
2. “请记住我喜欢咖啡”由规则自动保存，来源为 user，含主题键并正常合成语音。
3. “现在不喝咖啡”更新原事实 ID，切断旧上下文，另一客户端的茶偏好保留。
4. 在新会话中通过问答摘录找回之前讨论的周末植物园安排。
5. 遗忘后事实和检索摘录删除，旧版本编辑 409，新会话不带回旧偏好；另一客户端保留。
6. 关闭记录后，真实模型对“请记住……”的回答没有新增事实或摘录。
7. 两个真实语音轮次分别保存自己的重启验证口令。
8. 宿主重启后，双方名字、原会话 ID、各自口令和来源元数据恢复，未读到另一客户端口令。
9. 测试凭据撤销、档案归档，不留在正常客户端列表。

同源管理 7 项真实鉴权检查通过（[管理报告](validation/yusheng-management-0.6-report.json)）。设置页使用真实存储/API 的本地预览验证编辑原记录、来源变化、检索、操作记录、切换客户端及离线编辑；[截图](validation/memory-v2-preview.png) 中是模拟客户端数据。

最终部署散列与本地一致：

- `lib/index.js`: `d9992a06344445588448e7e23583b26b640a1dbcba72d5cd2ad7333e2c02bcc2`
- `lib/client.js`: `19d7ff76399a04ae021b81a70021b73c73cd21d1cd61aac0cec671bd3767607c`

设备复测：`node tools/memory-device-test.mjs write`，正常重启并等待端口就绪后执行 `node tools/memory-device-test.mjs read`；工具读取设备本地凭据，不把令牌或 cookie 写入报告。

边界：规则抽取和关键词召回覆盖有限；摘录只是有长度上限的问答片段，不是完整历史的语义索引。更正/遗忘会清除当前客户端全部检索摘录，保留其他长期事实；宿主原始日志和备份仍保留。文件的原子写入与 fsync 已实现，未做物理断电试验或长期大规模检索评测。详见 [MEMORY.md](MEMORY.md)。

以下为此前版本的历史验证记录。

# 0.5.0 每客户端配置与记忆隔离（2026-10-25）

已部署至 GM800 `/opt/yusheng-voice`，`gm800-dsh.service`。升级前备份为 `/opt/yusheng-backups/voice-before-client-isolation-20261025-165816.tgz` 及同时间的设置备份（仅设备本地、0600）。

- 本地 `npm test`：51 项测试及 smoke 全部通过。新增独立配置和模型快照、独立密钥、客户端命名空间、同名对话防串线、可证明归属的旧历史迁移、长期记忆版本冲突、工具 agent 绑定及取消后拒绝使用、上下文重置和恢复、令牌冒用拦截。
- GM800 真实双客户端：分别设置名称和语速，使用同一 `main` 对话名称，真实模型调用 `voice_memory` 分别保存不同口令并生成语音。确认会话 ID 不同，双方 API 记录和实际回答中均没有另一个客户端的口令。
- 重连和宿主重启后，两边继续恢复各自的名字、原会话 ID 和口令。单独重置 A 保留其长期记忆，撤销后回到原会话；B 不受影响。
- 同源登录管理 7 项真实检查通过：无需 adminToken 头即可读写所选客户端；缺失/过期登录、设备令牌、跨源访问、任意目标和超限请求被拒绝。见 [管理报告](validation/yusheng-management-0.5-report.json)。
- 原 `gm800-gui` 的助手“木偶”及 `voice-gm800-gui-p-yusheng-assistant` 历史保留，原令牌固定绑定该身份。测试专用凭据已撤销，测试档案移动至设备 `validation-archive/`，不进入正常客户端选择列表。
- 设置页使用实际 React 组件和模拟 API 验证客户端切换、离线编辑、人设和记忆保存、未保存修改的切换保护。截图是模拟数据预览；真实模型链路证据见 [隔离报告](validation/yusheng-isolation-report.json)。

复测（在设备上；读原地凭据，不写入报告）：

```sh
node tools/isolation-device-test.mjs write
# 正常重启 dsh，等待语音端口就绪
node tools/isolation-device-test.mjs read
node tools/management-device-test.mjs
```

新建会话工作目录独立；历史日志仍由 dsh 集中保存。此版本提供应用层数据隔离，当前全访问 Shell/文件工具不构成敌对多租户的操作系统沙箱，详见 README。

以下为之前版本的历史验证记录，构建散列和数量对应各次记录。

# 验证记录

## 0.4.1：设置页自动复用 dsh 登录

2026-10-25 已部署 GM800。设置面板默认通过 dsh 的 owner-only Connection Fetch 路由自动读取和保存配置，不再要求重复填写 adminToken；外部服务入口保留独立令牌认证。界面将原“服务状态 / 未连接”改为“管理状态 / 已同步”等明确提示，设备在线数独立显示，配置不依赖设备在线。

`npm test` 的 44 项回归测试与 HTTP/WS 冒烟全部通过。新增验证：零语音连接时仍能通过管理入口读写并落盘，管理令牌不返回浏览器，设备签发/撤销可正常转发；非法路径、URL、方法和过大请求被拒绝；浏览器使用同源 cookie，外部模式才发送 x-voice-token；文档基址的子路径解析及登录失效提示。

GM800 的 7 项真实管理链路验证全部通过，报告：[自动管理接口验证](validation/yusheng-management-report.json)。测试通过官方 launch token 交换签名 cookie，仅在进程内使用，不记录凭据：

1. 不发送语音管理令牌，仅用 dsh 登录 cookie 读取状态与设置，adminToken 不出现在响应中。
2. 沿用同一登录保存设置并验证落盘，保持现有助手名称和其他配置，原凭据未变。
3. 无登录、无效登录 cookie、单独设备令牌均返回 401。
4. 带有效登录但使用无关 Origin 返回 403。
5. 任意 URL 和未允许的方法返回 400，不转发为任意代理。
6. 超过 32KiB 的管理操作返回 413。
7. 独立 8090 REST 仍对匿名/设备令牌返回 401，管理令牌正常返回 200。

浏览器使用实际 React 组件与模拟服务验证：打开即自动加载；在线设备为 0 时修改语速并成功保存；刷新后无需认证操作即加载已保存值；登录失效明确提示重新登录；外部服务器令牌入口仍能使用；390px 窄屏显示正常。模拟管理请求不含 x-voice-token，保存仅发送 ttsSpeed。截图为模拟数据：[自动管理设置页](validation/native-management-preview.png)。

部署前备份：`/opt/yusheng-backups/voice-before-native-management-20261025-160710.tgz`，对应配置备份保留在设备同目录（0600）。服务为 active，当前构建 SHA-256 与本地一致：

- `lib/index.js`：`92ac82edbd377fba6dcdab7a9b0d3259bf4695573f39ef92deb5b6da0a977a85`
- `lib/client.js`：`b29977b4622436d1d877ac7895bce71a38747b74eca39123c71a850a34a761c5`

设备复测：`node tools/management-device-test.mjs`。测试需要读取当前 systemd 进程的启动日志来完成官方登录交换，不输出 launch token、cookie 或语音凭据。

## 0.4.0：语声助手模式与可配置人设

2026-10-25 已部署到 GM800，并为语音服务选用 `yusheng-assistant`（语声助手）模式，保持 dsh 全局默认模式不变。助手默认名称为“语声”，性格为温暖体贴，回答简短利落，表情动作自然适度；测试中的临时名称、称呼及性格均已恢复，原有设备/管理/供应商凭据及 180 秒轮次期限保持不变。

`npm test` 的 41 项测试与 HTTP/WS 冒烟全部通过。新增覆盖人设字段校验和落盘、旧配置迁移、当前 agent 的系统提示与必需运行时快照、每轮热更新、取消与异常清理、失效模式拒绝，以及释放异常不遗留会话互斥锁。另修正宿主 effect 的初始化/清理用法，避免刚安装的模型选择钩子立即被释放。

真实 GM800 + MiniMax-M3.1-Flash + MiniMax TTS 验证通过：

1. 专用 dsh 会话模式注册成功且可用。
2. 助手按配置自称“小榆”，并称呼用户“小林”，有真实合成音频输出。
3. 保存新名称“小霁”、称呼“阿辰”和专业干练性格后，下一轮使用新配置，仍记得口令“星河四十二”，实际 sessionId 不变。
4. 专用模式真实执行 Shell `printf yusheng_persona_ok`，反馈成功。
5. 宿主重启后恢复同一个持久会话，按当前配置自称“语声”，仍能正确返回口令。恢复测试特意使用包含旧自我介绍的历史，验证当前人设的宿主运行时快照可以覆盖旧身份信息。

报告：[人设与工具验证](validation/yusheng-persona-report.json)、[重启后人设与记忆恢复](validation/yusheng-persona-recovery-report.json)。测试走真实 agent 与 TTS 服务，音频由测试客户端接收，未测量物理麦克风或扬声器效果。

浏览器以实际 React 组件和本地模拟 REST 服务检查：名称、称呼、性格模板及补充描述实时预览；保存仅提交修改项；切换自定义性格保留描述；明暗主题和 390px 窄屏布局。界面截图使用模拟数据：[助手人设设置](validation/persona-settings-dark.png)。

升级前备份：`/opt/yusheng-backups/voice-before-persona-20261025-152027.tgz`；原配置备份仅保留在设备上的 `settings-before-persona-20261025-152027.json`（0600）。服务当前正常，已连接的 GM800 客户端处于 ready 状态。设备与本地 SHA-256 一致：

- `lib/index.js`：`0fa338a5116b4d5c3d0c7dcb9a854bc7d857caee6da47d9f9c566a79c054d726`
- `lib/client.js`：`058f9159ec0261a06026b357d473286f34bdfdcd8a45c286aa37e6ac4cfe8c03`
- `cordis.patch.yml`：`5357df64fa29a09915b456ba8be0762349549d39b744b5e88ecefa986e5686fa`

复测：在设备执行 `node tools/persona-device-test.mjs`，正常重启 dsh 并等待服务就绪，再执行 `node tools/persona-device-test.mjs --restart-read`。脚本会恢复测试前的人设配置，报告不含凭据。

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
