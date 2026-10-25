# dsh-yusheng-voice — 语声语音后端

dsh（DeepSeek Harness）插件：语音交互系统的后端服务。设备通过 WebSocket 接入，
语音识别与合成走 **minimax 新版开放平台 api.minimax.cn**（`asr-1.0` / `t2a_v2` 流式，
仅需 Bearer API Key，**无需 GroupId**），对话在宿主 dsh 进程内直接驱动**会话**调用
LLM（每个客户端独立保存模型选择，提供方凭据由宿主管理）。
设置面板入口挂在 dsh 网页**左侧边栏「全局面板」**（「语声语音」按钮，位于「自动化任务」上方）。

## 0.5 每个客户端独立

设置页先选择客户端，再调整该客户端的名称、性格、声音、ASR/TTS 密钥、模型和会话模式；客户端离线时也能编辑，也可先添加客户端再接入。

- 独立身份：每个 `deviceId` 配一个绑定它的设备令牌，不能借同一令牌声明其他客户端。重连使用原 ID 和令牌。旧兼容令牌首次绑定一个客户端后固定归属；已部署实例升级前应明确填写 `legacyDeviceId`，避免由首个连接抢占。
- 独立配置：创建时复制一次新客户端默认模板，并固定当时的 dsh 模型选择。之后修改模板、网页默认模型或其他客户端配置不会改变已有客户端。提供方账号仍由 dsh 管理。
- 两层记忆：长期偏好和事实存于独立的 `memory.json`，可在「记忆与会话」中编辑，或让助手调用只绑定当前客户端的 `voice_memory` 工具；聊天上下文则按客户端、对话名称、模式、上下文代次独立续接。两个客户端都叫 `main` 的对话不会合并。
- 独立界面：智能 UI 的组件、操作与消费状态也按客户端和上下文代次隔离。重新开始上下文只影响所选客户端，保留长期记忆和配置，并可撤销上次重置。进行中的轮次需先结束。

数据目录（文件 0600、客户端目录 0700）：

```text
$DSH_HOME/yusheng-voice/
  settings.json                 # 服务凭据、接入策略及新客户端默认模板
  clients/<deviceId>/
    profile.json                # 独立配置、模型、人设及当前上下文代次
    memory.json                 # 有版本号的长期记忆；并发编辑冲突返回 409
    sessions.json               # 本客户端的实际 dsh 会话映射
    conversations.json          # 本客户端的会话目录
    ui.json                     # 本客户端的智能 UI 状态
    workspace/                  # 新建会话的默认工作目录
```

dsh 的会话日志仍由宿主集中存储，通过独立的会话 ID 和客户端索引引用。旧历史只有在原归属登记可证明、映射无歧义时才续接；不会把同一历史复制给多个客户端。旧全局索引保留供迁移核对。恢复的旧会话沿用其原工作目录。

这里实现配置、记忆和会话的应用层隔离。当前 agent 仍具有宿主 `danger-full-access` 权限，工作目录不是操作系统沙箱；具有 Shell/文件工具权限的 agent 能访问宿主文件。若面向互不信任的用户，还需独立进程/容器、文件系统边界和分离的账号凭据。

## 0.4.1 自动沿用 dsh 登录

登录 dsh 后打开「语声语音」即可自动加载、编辑和保存设置，无需填写语音服务的管理令牌，也不要求任何设备在线。页面的「管理状态」表示当前设置是否同步；「在线设备」单独显示设备数量。登录失效时明确提示重新登录，网络恢复或登录恢复后可重试同步。

面板使用同源 `POST /api/yusheng-voice/manage`，注册于 dsh Connection 的 owner-only 精确 Fetch 路由。Host/Origin 信任检查、签名登录 cookie 和 owner 权限均由 dsh 执行；插件只接受有限的管理操作，32KiB 请求上限，服务端在本地携带 adminToken 调用既有 REST，adminToken 不下发给浏览器。该路由不会直接注册到无需认证的 webServer。

「外部服务器」中保留独立地址和管理令牌输入，供连接其他语音服务使用。独立的 8090 REST 仍要求 adminToken，设备令牌不能管理设置。支持以网页文档基址解析 API 地址，适配 dsh 部署的子路径。

升级时更新宿主和浏览器构建，重启 dsh 后强制刷新页面。自动沿用登录态需要提供 `connection.fetch.register` 的 dsh Web 宿主。

## 0.4 语声助手与人设

插件安装配置新增真正的 dsh 会话模式「语声助手」（`yusheng-assistant`），保留 Shell、文件、搜索、网页、任务调度、技能和上下文压缩能力，采用适合语音的表达与执行规则，不依赖网页提问工具。此模式随插件配置加载，不改变 dsh 的全局默认模式；新安装的语音服务默认选用它。旧配置中明确选择的模式保持不变，可在面板中切换。

设置面板的「助手人设」可配置助手名称、对用户的称呼、角色、温暖/活泼/沉稳/专业/自定义性格、补充描述、回答长度及表情动作风格，并提供风格示意。人设保存在服务器，0.5 起仅对当前所选客户端生效；名称用于对话中的自称，客户端仍负责唤醒和录音。

每轮在当前 agent 的作用域中注册系统提示，覆盖当前模式的人设部分，并通过宿主运行时快照明确当前名称、称呼及偏好，避免恢复的旧自我介绍覆盖新配置。保留工具和运行上下文；本轮结束或取消收尾后释放，其他网页会话不受影响。保存后下一轮即更新，当前轮使用开始时的配置快照；改名或改性格不新建会话。切换会话模式仍按原机制使用独立历史，切回可继续原对话。自定义文本按字面量处理，`{{...}}` 不会被当成宿主模板变量。

旧版内置的首轮口语约束自动迁移为新的默认表达规则，用户自定义的补充要求保留。`promptPrefix` 现在是每轮系统提示中的补充要求，不再只添加到首轮用户消息。

升级时需同步 `cordis.patch.yml` 与构建文件，然后重启 dsh，使专用模式声明生效。

## 0.3 形象与智能 UI

新增客户端能力 `presentation.state`、`presentation.cue` 和 `ui.render`。dsh agent 可通过会话工具 `voice_present`、`voice_ui` 驱动表情动作、卡片、选项按钮、进度和表单；点击回传经校验后继续驱动同一对话，UI 状态支持重连和宿主重启恢复。

参考客户端：`http://<host>:8090/demo`（填写设备令牌）。浏览器 SDK：`/voice-client.js`；完整接入、同步和组件定义见 [INTERACTION.md](INTERACTION.md)。v1 与纯语音 v2 客户端保持兼容。

## 0.2 升级说明

协议 v2 与 v1 并行支持，详见 [完整协议](PROTOCOL.md)。修复 ASR 打断后继续执行、旧轮覆盖新轮、同会话并发串流、无效超时和合成失败仍报告成功的问题。音频队列有容量限制，支持背压和播放回执。

独立 REST 使用 `adminToken`，设备令牌只可连接语音 WS。首次升级自动生成管理令牌并保存在服务器 `settings.json`（不会在 REST 或日志输出），旧设备令牌保持有效。0.4.1 起 dsh 内的设置面板自动沿用登录状态，外部管理才需填写服务地址和管理令牌。可为每台设备签发绑定 ID 的独立令牌。

## 架构

```
语音设备 ──WS(PCM 16k + JSON)──▶ yusheng-voice（dsh web 宿主进程内）
                                   ① listen stop → 整段 PCM → minimax ASR
                                   ② 文本 → agents 会话（进程内，实时增量流）
                                   ③ 增量切句 → minimax TTS 流式 → PCM 24k 下发
浏览器设置面板 ──dsh 登录态──▶ /api/yusheng-voice/manage ──本地 REST──▶ 语音服务
外部管理工具 ──REST(CORS+adminToken)──▶ 语音服务的 /status /settings /token /test/*
```

- **无 Opus、无服务端 VAD**：断句与唤醒由客户端负责（`listen start/stop`），
  音频裸 PCM 进出，运行时零外部依赖（`ws` 已打包进产物）。
- **每客户端独立的持久 dsh 会话**：由客户端 ID、对话名称、上下文代次的散列和模式共同派生。断线和重启续接；损坏日志采用独立替补 ID 并持久记录。
- **dsh 会话模式可选**：切换模式使用对应的独立历史，切回可继续原对话；所有历史均位于当前客户端范围内。
- **打断**：`abort` / `turn.cancel` 终止本轮 ASR、音频和宿主 agent，旧轮不能继续发送事件或覆盖新轮；`response.stop` 只停止语音，agent 继续执行。宿主完全空闲前保持会话互斥锁。

## 安装（服务器上）

```sh
dsh plugin --profile web add "link:<本目录绝对路径>"
```

重启 Harness 后监听 `0.0.0.0:8090`（host/port 可在 profile 用户层覆盖插件行
config，用户层 config 需重述本包 cordis.patch.yml 行的全部字段）。浏览器
Ctrl+F5，主页左侧边栏 →「语声语音」（全局面板，自动化任务上方）会自动沿用 dsh 登录并加载设置，可直接配置 minimax
凭据和设备接入令牌。连接其他语音服务时，展开「外部服务器」填写该服务器的地址和 adminToken。

服务设置持久化于 `$DSH_HOME/yusheng-voice/settings.json`，客户端设置位于相邻的 `clients/<deviceId>/profile.json`（均为 0600），密钥不会写进
dsh 安装清单，也不会出现在日志与 REST 返回中。

## LLM 模型与凭据

- 新客户端首次创建时复制宿主默认模型，之后使用客户端自己的 `llmProvider` / `llmModel`。在设置页「声音与对话」修改它，下一轮生效；不会随网页默认模型改变。
- LLM 凭据按 provider 走 dsh 的凭据体系。使用第三方 provider（如
  `llm-pi-ai` 的 `minimax-cn`）时，API Key 由 provider 配置的
  `apiKeyEnv` 环境变量提供——给 systemd 服务加 drop-in 即可（见「部署实录」）。
- 语音侧（ASR/TTS）的 minimax Key 与 LLM 的 Key 互不相关：前者存本插件设置
  文件，后者交给 dsh；客户端可分别保存自己的语音服务密钥。

## 设置项一览

声音、模型、人设和时限字段通过 `GET/PUT /clients/:id/settings` 配置。`/settings` 只修改新客户端默认模板及服务接入策略，已有客户端不继承后续变化。

| 字段 | 类型 / 范围 | 默认 | 说明 |
|---|---|---|---|
| `minimaxApiKey` | string ≤256 | 空 | minimax 开放平台 API Key（ASR/TTS 共用）；GET 时脱敏为 `hasMinimaxApiKey` 布尔 |
| `asrModel` | string ≤64 | `asr-1.0` | 语音识别模型 |
| `ttsModel` | string ≤64 | `speech-2.8-turbo` | 合成模型；面板下拉：2.8/2.6/02/01 系 × turbo/hd |
| `ttsVoice` | string ≤128 | `female-shaonv` | 音色 id；面板下拉为官方系统音色表中文部分（普通话 58 + 粤语 6），自定义/复刻 id 可经 PUT 写入 |
| `ttsSpeed` / `ttsVol` / `ttsPitch` | 0.5–2 / 0–10 / −12–12 | 1 / 1 / 0 | 合成语速、音量、音调 |
| `assistantName` | 非空 string ≤32 | 语声 | 助手在对话中的名字 |
| `userTitle` | string ≤32 | 空 | 对用户的称呼；空则自然称呼“你” |
| `assistantRole` | 非空 string ≤200 | 语音助手 | 角色定位，不赋予未提供的工具或能力 |
| `personality` | warm / lively / calm / professional / custom | warm | 性格模板 |
| `personalityNotes` | string ≤2000 | 空 | 补充或自定义性格描述 |
| `replyStyle` | concise / natural / detailed | concise | 默认回答长度；用户明确要求可覆盖 |
| `presentationStyle` | restrained / natural / expressive | natural | 支持形象的客户端上的表情动作风格 |
| `promptPrefix` | string ≤4000 | 空 | 每轮系统提示中的补充对话要求 |
| `agentPreset` | string ≤64 | `yusheng-assistant` | dsh 会话模式；空 = 跟随默认，升级保留旧选择 |
| `llmProvider` / `llmModel` | string ≤128 | 首次复制宿主模型 | 客户端自己的模型选择，需成对填写 |
| `token` | string ≤128 | 自动生成 | 服务级兼容接入令牌，固定绑定一个客户端；空 = 禁用。`POST /token` 轮换 |
| `legacyDeviceId` | 服务端维护 | 空 | 兼容接入绑定的 ID；不能通过通用设置 API 修改 |
| `adminToken` | 服务端自动生成 | 随机 | REST 管理凭据，只可在服务器文件中读取；PUT 不允许修改 |
| `deviceTokens` | 服务端维护 | 空映射 | POST /devices 签发、DELETE /devices/:id 撤销；PUT 不允许直接修改 |
| `allowedOrigins` | string[] ≤32 | [] | CORS 允许的完整 Origin；空列表仅允许同主机网页（可不同端口） |
| `maxTurnSeconds` | 15–600 | 180 | 单轮最长等待秒数，超时本地取消并按打断收尾 |

PUT 提交任意字段子集，未知或无效字段拒收（响应 `rejected` 数组点名）；助手名称、角色不能清空，枚举字段需取表中值。其他文本字段可用空串清除（密钥想保持不变就不要提交它）。

## WebSocket 语音协议 v1

端点：`ws://<host>:8090/voice?token=<令牌>`（设备令牌在设置面板管理；未配置时拒绝接入）

音频格式：上行 **PCM 16kHz 16bit mono 小端**，下行 **PCM 24kHz 16bit mono
小端**（约 40ms 帧节奏下发）。

### 客户端 → 服务端

| 消息 | 说明 |
|---|---|
| `{"type":"hello","version":1,"deviceId":"esp-01","deviceName":"客厅"}` | 握手；deviceId 规范化（小写、`[a-z0-9_-]`、≤48）后作为会话标识 |
| `{"type":"listen","state":"start"}` | 开始拾音（清空缓冲） |
| `{"type":"listen","state":"stop"}` | 结束拾音，触发一轮：ASR → 会话 → TTS |
| 二进制帧 | 拾音中的 PCM，任意分片长度；单次上限 120 秒（超出报 `too_long`） |
| `{"type":"query","text":"…"}` | 文本直达：跳过 ASR，会话 → TTS（≤4000 字） |
| `{"type":"speak","text":"…"}` | 纯 TTS 播报，不进会话（≤1000 字） |
| `{"type":"abort"}` | 打断当前轮：停发音频、取消等待 |
| `{"type":"ping","time":…}` | 心跳 |

### 服务端 → 客户端

| 消息 | 说明 |
|---|---|
| `{"type":"welcome","version":1,"sessionId":"voice-…","sampleRateIn":16000,"sampleRateOut":24000}` | 握手成功 |
| `{"type":"stt","text":"…"}` | 识别结果（随后进入会话轮） |
| `{"type":"llm","state":"start"}` / `{"state":"delta","text":"…"}`（多次）/ `{"state":"end"}` | 会话轮文本流 |
| `{"type":"tts","state":"start"}` | 本轮音频开始（首句合成前） |
| `{"type":"tts","state":"sentence_start","text":"…"}` | 一句音频即将下发 |
| `{"type":"tts","state":"stop","reason":"…"}` | 本轮结束。reason：`completed`（会话轮正常）/ `done`（speak 正常）/ `cancelled`（超时取消）/ `aborted` / `error` / `too_short`（拾音 <0.3s）/ `empty_asr` |
| 二进制帧 | TTS 音频 PCM（24kHz 16bit mono） |
| `{"type":"error","code":"…","message":"…"}` | 错误；连接可继续使用 |
| `{"type":"pong","time":…}` | 心跳回应 |

一轮时序：`listen stop` →（可选 `stt`）→ `llm start` → `llm delta…` → `tts
start` → (`tts sentence_start` + 音频帧)… → `llm end` → `tts stop`。
`speak`/`query` 分别省略头部/ASR 环节。忙线时新的 `listen`/`query`/`speak`
返回 `busy`，需先 `abort`。`tts stop` 一定在所有音频帧之后到达，客户端以它
作为播放收尾依据即可。

### 常见错误码

| code | 场景 |
|---|---|
| `no_hello` / `already_hello` | 握手次序不对 |
| `busy` | 上一轮未结束 |
| `not_listening` / `bad_listen_state` / `too_long` | 拾音状态机 |
| `empty_text` / `bad_json` / `unknown_type` | 请求格式 |
| `no_api_key` | minimax Key 未配置 |
| `network` / `http_<状态>` / `api_<业务码>` | minimax ASR/TTS 调用失败（ASR 前缀亦可 `asr_failed`、TTS `tts_failed`/`stream`） |
| `llm_error` | dsh 会话轮失败（含模型凭据缺失，message 有具体指引） |

## 会话与上下文

- 新会话 ID 含完整客户端命名空间散列和模式；`welcome` 或本轮 `session` 是权威 ID。旧已验证归属的会话保留原 ID。
- 续接次序（与官方 headless 一致）：进程内在实例 → `sessionQuery` 探测持久
  会话 → `agents.resume`；均不可用时才 `create`。
- **损坏会话自动降级**：历史会话校验失败（如中断轮残留）时记警告并换新 id
  起新话，实际采用的 id 记录在 `$DSH_HOME/yusheng-voice/clients/<deviceId>/sessions.json`，
  之后重连/重启都回到该会话，不再反复丢上下文。
- 每轮结束 `sessions.flush` 持久化；人设和 `promptPrefix` 每轮通过会话系统提示更新，不混入用户消息。提交宿主的消息携带 UUID `id` 和 `role:user`，满足日志恢复校验。
- **权限全开**：语音会话创建时应用 `danger-full-access` 预设（沙箱全访问 +
  审批策略 never）。语音设备无人交互，默认 workspace-write + ask 会让需要
  升权的工具调用（如沙箱外执行命令）永久挂起等审批。网页交互会话不受影响。
- 新建会话会应用 profile 默认 agent preset（保证完整工具集）——裸
  `agents.create` 只有 `working_directory` 等基础工具，模型会为完成任务空转。

## REST（仅管理端，使用 adminToken：优先 x-voice-token 头，也兼容 ?token=）

以下是语音服务独立端口的 API。dsh 内置面板通过上述已登录的管理入口在服务器内调用它们，浏览器无需接触 adminToken。

| 路由 | 说明 |
|---|---|
| `GET /status` | `{ok, service, version, protocol, endpoint, uptimeSec, tokenConfigured, model:{provider,model}, presets:[{id,name?,isDefault,broken?}], hasMinimaxApiKey, clients:[{deviceId,deviceName,state}], settings:<脱敏>}`；presets 有 ~10s 缓存，冷启动首次可能为 null |
| `GET /settings` | 新客户端默认模板和服务接入设置，`scope: new-client-template`，密钥只见布尔 |
| `PUT /settings` | body 为字段子集 JSON；`{ok, rejected:[…], settings:<脱敏>}` |
| `GET /clients` | 全部客户端元数据、接入凭据是否已配置；包括离线客户端 |
| `GET /clients/:id` | 此客户端脱敏配置、长期记忆、会话目录及是否可撤销重置 |
| `GET/PUT /clients/:id/settings` | 此客户端配置，不接受服务凭据和接入策略字段 |
| `GET/PUT /clients/:id/memory` | PUT `{text,revision}`；每行一条、最多 32 条共 8000 字，每条最多 1000 字；版本冲突 409 |
| `GET /clients/:id/conversations` | 此客户端会话目录 |
| `POST /clients/:id/context/reset` | 归档旧上下文并开始新代次，保留长期记忆；此客户端忙碌时 409 |
| `POST /clients/:id/context/restore` | 撤销上次重置并回到原上下文，最多保留 16 次重置记录 |
| `POST /clients/:id/test/asr`、`tts`、`llm` | 用此客户端自己的配置测试；LLM 自检隔离于正常聊天 |
| `POST /token` | 更换固定兼容客户端的令牌；如已有独立令牌，替换该身份的独立令牌，关闭旧连接 |
| `POST /test/tts` | 用当前设置合成「你好。」：`{ok, durationMs, bytes, message}` |
| `POST /test/asr` | 1s 静音走真实 ASR：`{ok, durationMs, text}` 或 `{ok:false, code, message}` |
| `POST /test/llm` | 固定自检会话跑一轮：`{ok, durationMs, kind, gotDelta, error?, message}` |

CORS：默认只接受同主机网页（允许不同端口）；可经 allowedOrigins 配置精确允许列表。设备令牌无 REST 权限。

新增 `POST /devices`，body 为 `{deviceId,label?}`，返回一次新设备令牌；`DELETE /devices/<deviceId>` 撤销接入，保留配置和记忆。令牌轮换或撤销会关闭旧连接。

## 测试客户端

```sh
node tools/test-client.mjs ws://<host>:8090/voice --token <令牌> --device <绑定的ID> speak "你好。"
node tools/test-client.mjs ws://<host>:8090/voice --token <令牌> --device <绑定的ID> query "介绍一下你自己"
node tools/test-client.mjs ws://<host>:8090/voice --token <令牌> --device <绑定的ID> listen 问句16k.pcm
```

返回音频写入 `out-*.pcm`（`ffplay -f s16le -ar 24000 -ch_layout mono out-*.pcm`
播放）；`listen` 的输入须为 16kHz 16bit mono PCM。

## 部署实录（GM800 / systemd）

1. `tar` 上传解包到 `/opt/yusheng-voice`（`link:` 安装指向该目录），改完
   `npm run build` 后重传 `lib/` 并 `systemctl restart gm800-dsh.service`。
   **冷启动约 25–30 秒**才完成端口绑定，`is-active` ≠ 可用，验证请等 30s。
2. LLM provider（minimax-chat 用例）——profile `cordis.patch.yml`：
   ```yaml
   - id: llm-pi-ai
     name: "@deepseek-ai/dsh-llm-pi-ai"
     config:
       providers:
         minimax-cn:
           apiKeyEnv: MINIMAX_CN_API_KEY
           models:
             - id: MiniMax-M3.1-Flash
               name: MiniMax-M3.1-Flash
               contextWindow: 1000000
               maxTokens: 524288
               input: [text, image]
   ```
3. Key 环境变量——systemd drop-in
   `/etc/systemd/system/gm800-dsh.service.d/minimax-env.conf`（0600）：
   `Environment=MINIMAX_CN_API_KEY=…`，然后 `systemctl daemon-reload`。
4. 默认模型切到 minimax——profile 补丁追加（即网页模型选择器的落盘内容）：
   ```yaml
   - id: agent-default-model
     name: "@deepseek-ai/dsh-agent-default-model"
     config:
       provider: minimax-cn
       model: MiniMax-M3.1-Flash
   ```

## 开发

```sh
npm install && npm run build   # 产出 lib/index.js + lib/client.js（esbuild）
npm test                      # 构建 + 回归测试 + HTTP/WS 冒烟
node tools/device-test.mjs     # 在设备上用本地 settings.json 测真实链路
VOICE_LONG_TEST=1 node tools/device-test.mjs # 加测 >30 秒长播报
```

宿主半边改 `src/`，浏览器半边改 `src/client/`；`link:` 安装的包文件变更后
profile HMR 会自动重组（浏览器侧需硬刷新）。

## 安全边界

- 仅面向局域网；本插件不提供 TLS，跨公网请放 HTTPS 反代。
- 首次启动自动生成管理与单客户端兼容设备令牌。配置损坏或凭据不能持久化时拒绝启动，不会回退为开放服务。
- 管理令牌和设备令牌分离；每个客户端使用绑定 ID 的令牌。单客户端兼容令牌也不能越过绑定身份。
- 密钥只存于服务器本地设置文件（0600），REST 永不回传，日志不落密钥。
- **语音会话以 danger-full-access 运行**（用户决策：无人值守不能等审批），
  意味着对话模型可在宿主机上全权执行命令——部署时请自行权衡，如需收紧可
  改回 workspace-write + 自动应答器。

## 兼容性

v1 音频消息保持兼容；原兼容令牌固定绑定原客户端。dsh 内设置面板沿用登录状态。v2 示例：

```sh
node tools/test-client.mjs ws://<host>:8090/voice --token <设备令牌> --version 2 --device esp-01 query "你好"
```

当前保留整段 ASR 与 PCM 编码；流式 ASR、服务端 VAD、后台任务和多模态 UI 的实现边界见 PROTOCOL.md。

## 验证过的版本

- dsh 0.2.1-rc.2（GM800，ARM64，Node 22）；minimax api.minimax.cn
  （asr-1.0 / speech-2.8-turbo / MiniMax-M3.1-Flash）全链路实测通过。
