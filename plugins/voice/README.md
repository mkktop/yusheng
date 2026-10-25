# dsh-yusheng-voice — 语声语音后端

dsh（DeepSeek Harness）插件：语音交互系统的后端服务。设备通过 WebSocket 接入，
语音识别与合成走 **minimax 新版开放平台 api.minimax.cn**（`asr-1.0` / `t2a_v2` 流式，
仅需 Bearer API Key，**无需 GroupId**），对话在宿主 dsh 进程内直接驱动**会话**调用
LLM（跟随 profile 的默认模型选择）。
设置面板入口挂在 dsh 网页**左侧边栏「全局面板」**（「语声语音」按钮，位于「自动化任务」上方）。

## 0.3 形象与智能 UI

新增客户端能力 `presentation.state`、`presentation.cue` 和 `ui.render`。dsh agent 可通过会话工具 `voice_present`、`voice_ui` 驱动表情动作、卡片、选项按钮、进度和表单；点击回传经校验后继续驱动同一对话，UI 状态支持重连和宿主重启恢复。

参考客户端：`http://<host>:8090/demo`（填写设备令牌）。浏览器 SDK：`/voice-client.js`；完整接入、同步和组件定义见 [INTERACTION.md](INTERACTION.md)。v1 与纯语音 v2 客户端保持兼容。

## 0.2 升级说明

协议 v2 与 v1 并行支持，详见 [完整协议](PROTOCOL.md)。修复 ASR 打断后继续执行、旧轮覆盖新轮、同会话并发串流、无效超时和合成失败仍报告成功的问题。音频队列有容量限制，支持背压和播放回执。

REST 现使用独立 `adminToken`，设备令牌只可连接语音 WS。首次升级自动生成管理令牌并保存在服务器 `settings.json`（不会在 REST 或日志输出），旧设备令牌保持有效。打开设置面板，填写服务地址和管理令牌后连接。可为每台设备签发绑定 ID 的独立令牌。

## 架构

```
语音设备 ──WS(PCM 16k + JSON)──▶ yusheng-voice（dsh web 宿主进程内）
                                   ① listen stop → 整段 PCM → minimax ASR
                                   ② 文本 → agents 会话（进程内，实时增量流）
                                   ③ 增量切句 → minimax TTS 流式 → PCM 24k 下发
浏览器设置面板 ──REST(CORS+adminToken)──▶ 同端口的 /status /settings /token /test/*
```

- **无 Opus、无服务端 VAD**：断句与唤醒由客户端负责（`listen start/stop`），
  音频裸 PCM 进出，运行时零外部依赖（`ws` 已打包进产物）。
- **每设备一个持久 dsh 会话**（`voice-<deviceId>`）：断线重连、宿主重启均自动
  续接上下文；历史会话损坏时自动降级换新会话 id 并记录（见「会话与上下文」）。
- **dsh 会话模式可选**：设置面板「dsh 会话模式」下拉（跟随默认 + 按部署实际
  注册的预设列出）。预设首轮后锁定，会话 id 按模式派生
  （`voice-<deviceId>-p-<preset>`）：切换模式下一轮自动开新会话，切回原模式
  即恢复原对话。
- **打断**：`abort` / `turn.cancel` 终止本轮 ASR、音频和宿主 agent，旧轮不能继续发送事件或覆盖新轮；`response.stop` 只停止语音，agent 继续执行。宿主完全空闲前保持会话互斥锁。

## 安装（服务器上）

```sh
dsh plugin --profile web add "link:<本目录绝对路径>"
```

重启 Harness 后监听 `0.0.0.0:8090`（host/port 可在 profile 用户层覆盖插件行
config，用户层 config 需重述本包 cordis.patch.yml 行的全部字段）。浏览器
Ctrl+F5，主页左侧边栏 →「语声语音」（全局面板，自动化任务上方）填写服务器 settings.json 中的 adminToken 后，配置 minimax
凭据和设备接入令牌。

设置持久化于 `$DSH_HOME/yusheng-voice/settings.json`（0600），密钥不会写进
profile 配置，也不会出现在日志与 REST 返回中。

## LLM 模型与凭据

- 对话模型 = 宿主 profile 的**默认模型**（`agentDefaultModel` 服务，网页模型
  选择器同源）。在网页里切换默认模型，语音对话随之切换；无需重启。
- LLM 凭据按 provider 走 dsh 的凭据体系。使用第三方 provider（如
  `llm-pi-ai` 的 `minimax-cn`）时，API Key 由 provider 配置的
  `apiKeyEnv` 环境变量提供——给 systemd 服务加 drop-in 即可（见「部署实录」）。
- 语音侧（ASR/TTS）的 minimax Key 与 LLM 的 Key 互不相关：前者存本插件设置
  文件，后者交给 dsh。

## 设置项一览（GET/PUT /settings 的字段）

| 字段 | 类型 / 范围 | 默认 | 说明 |
|---|---|---|---|
| `minimaxApiKey` | string ≤256 | 空 | minimax 开放平台 API Key（ASR/TTS 共用）；GET 时脱敏为 `hasMinimaxApiKey` 布尔 |
| `asrModel` | string ≤64 | `asr-1.0` | 语音识别模型 |
| `ttsModel` | string ≤64 | `speech-2.8-turbo` | 合成模型；面板下拉：2.8/2.6/02/01 系 × turbo/hd |
| `ttsVoice` | string ≤128 | `female-shaonv` | 音色 id；面板下拉为官方系统音色表中文部分（普通话 58 + 粤语 6），自定义/复刻 id 可经 PUT 写入 |
| `ttsSpeed` / `ttsVol` / `ttsPitch` | 0.5–2 / 0–10 / −12–12 | 1 / 1 / 0 | 合成语速、音量、音调 |
| `promptPrefix` | string ≤4000 | 口语化约束 | 每个持久对话**首轮**用户消息前附加的提示词；留空不包装 |
| `agentPreset` | string ≤64 | 空 | dsh 会话模式（agent preset id）；空 = 跟随默认 |
| `token` | string ≤128 | 自动生成 | 共享兼容设备令牌；空 = 禁用共享接入。`POST /token` 轮换 |
| `adminToken` | 服务端自动生成 | 随机 | REST 管理凭据，只可在服务器文件中读取；PUT 不允许修改 |
| `deviceTokens` | 服务端维护 | 空映射 | POST /devices 签发、DELETE /devices/:id 撤销；PUT 不允许直接修改 |
| `allowedOrigins` | string[] ≤32 | [] | CORS 允许的完整 Origin；空列表仅允许同主机网页（可不同端口） |
| `maxTurnSeconds` | 15–600 | 180 | 单轮最长等待秒数，超时本地取消并按打断收尾 |

PUT 提交任意字段子集，未知字段拒收（响应 `rejected` 数组点名）；**传空串等于
清除该字段**（密钥想保持不变就不要提交它）。

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

- 会话 id：默认模式 `voice-<deviceId>`；指定模式 `voice-<deviceId>-p-<preset>`。
- 续接次序（与官方 headless 一致）：进程内在实例 → `sessionQuery` 探测持久
  会话 → `agents.resume`；均不可用时才 `create`。
- **损坏会话自动降级**：历史会话校验失败（如中断轮残留）时记警告并换新 id
  起新话，实际采用的 id 记录在 `$DSH_HOME/yusheng-voice/sessions.json`，
  之后重连/重启都回到该会话，不再反复丢上下文。
- 每轮结束 `sessions.flush` 持久化；每个持久对话首轮附加 `promptPrefix`，重连不会重复。提交宿主的消息携带 UUID `id` 和 `role:user`，满足日志恢复校验。
- **权限全开**：语音会话创建时应用 `danger-full-access` 预设（沙箱全访问 +
  审批策略 never）。语音设备无人交互，默认 workspace-write + ask 会让需要
  升权的工具调用（如沙箱外执行命令）永久挂起等审批。网页交互会话不受影响。
- 新建会话会应用 profile 默认 agent preset（保证完整工具集）——裸
  `agents.create` 只有 `working_directory` 等基础工具，模型会为完成任务空转。

## REST（仅管理端，使用 adminToken：优先 x-voice-token 头，也兼容 ?token=）

| 路由 | 说明 |
|---|---|
| `GET /status` | `{ok, service, version, protocol, endpoint, uptimeSec, tokenConfigured, model:{provider,model}, presets:[{id,name?,isDefault,broken?}], hasMinimaxApiKey, clients:[{deviceId,deviceName,state}], settings:<脱敏>}`；presets 有 ~10s 缓存，冷启动首次可能为 null |
| `GET /settings` | `{ok, settings:<脱敏视图>}`（密钥只见布尔） |
| `PUT /settings` | body 为字段子集 JSON；`{ok, rejected:[…], settings:<脱敏>}` |
| `POST /token` | 重新生成令牌：`{ok, token}` |
| `POST /test/tts` | 用当前设置合成「你好。」：`{ok, durationMs, bytes, message}` |
| `POST /test/asr` | 1s 静音走真实 ASR：`{ok, durationMs, text}` 或 `{ok:false, code, message}` |
| `POST /test/llm` | 固定自检会话跑一轮：`{ok, durationMs, kind, gotDelta, error?, message}` |

CORS：默认只接受同主机网页（允许不同端口）；可经 allowedOrigins 配置精确允许列表。设备令牌无 REST 权限。

新增 `POST /devices`，body 为 `{deviceId}`，返回一次新设备令牌；`DELETE /devices/<deviceId>` 撤销。令牌轮换或撤销会关闭旧连接。

## 测试客户端

```sh
node tools/test-client.mjs ws://<host>:8090/voice --token <令牌> speak "你好。"
node tools/test-client.mjs ws://<host>:8090/voice --token <令牌> query "介绍一下你自己"
node tools/test-client.mjs ws://<host>:8090/voice --token <令牌> listen 问句16k.pcm
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
- 首次启动自动生成管理与共享设备令牌。配置损坏或凭据不能持久化时拒绝启动，不会回退为开放服务。
- 管理令牌和设备令牌分离；推荐独立设备令牌。共享兼容令牌属于受信设备权限，无法替代多用户身份体系。
- 密钥只存于服务器本地设置文件（0600），REST 永不回传，日志不落密钥。
- **语音会话以 danger-full-access 运行**（用户决策：无人值守不能等审批），
  意味着对话模型可在宿主机上全权执行命令——部署时请自行权衡，如需收紧可
  改回 workspace-write + 自动应答器。

## 兼容性

v1 设备无需升级即可使用；设置面板需填写新管理令牌。v2 示例：

```sh
node tools/test-client.mjs ws://<host>:8090/voice --token <设备令牌> --version 2 --device esp-01 query "你好"
```

当前保留整段 ASR 与 PCM 编码；流式 ASR、服务端 VAD、后台任务和多模态 UI 的实现边界见 PROTOCOL.md。

## 验证过的版本

- dsh 0.2.1-rc.2（GM800，ARM64，Node 22）；minimax api.minimax.cn
  （asr-1.0 / speech-2.8-turbo / MiniMax-M3.1-Flash）全链路实测通过。
