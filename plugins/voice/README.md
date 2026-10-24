# dsh-yusheng-voice — 语声语音后端

dsh（DeepSeek Harness）插件：语音交互系统的后端服务。设备通过 WebSocket 接入，
语音识别与合成走 **minimax 国内版**（`asr-1.0` / `t2a_v2` 流式），对话在宿主
dsh 进程内直接驱动**会话**调用模型（与网页端同一默认模型与凭据，无需另配 Key）。
设置面板入口挂在 dsh 网页**左侧边栏「全局面板」**（「语声语音」按钮，位于「自动化任务」上方）。

## 架构

```
语音设备 ──WS(PCM 16k + JSON)──▶ yusheng-voice（dsh web 宿主进程内）
                                   ① listen stop → 整段 PCM → minimax ASR
                                   ② 文本 → agents 会话（进程内，实时增量流）
                                   ③ 增量切句 → minimax TTS 流式 → PCM 24k 下发
浏览器设置面板 ──REST(CORS+token)──▶ 同端口的 /status /settings /token /test/*
```

- **无 Opus、无服务端 VAD**：断句与唤醒由客户端负责（`listen start/stop`），
  音频裸 PCM 进出，运行时零外部依赖（`ws` 已打包进产物）。
- **每设备一个持久 dsh 会话**（`voice-<deviceId>`），断线重连自动续接上下文。
- **打断**：`abort` 即时停止下发并本地取消，后台任由本轮自然收敛。

## 安装（服务器上）

```sh
dsh plugin --profile web add "link:<本目录绝对路径>"
```

重启 Harness 后监听 `0.0.0.0:8090`（host/port 可在 profile 用户层覆盖插件行 config，
用户层 config 需重述本包 cordis.patch.yml 行的全部字段）。浏览器 Ctrl+F5，主页
左侧边栏 →「语声语音」（全局面板，自动化任务上方）配置 minimax 凭据并生成接入令牌。

设置持久化于 `$DSH_HOME/yusheng-voice/settings.json`（0600），密钥不会写进 profile 配置。

## WebSocket 语音协议 v1

端点：`ws://<host>:8090/voice?token=<令牌>`（令牌在设置面板生成；未配置时开放）

音频格式：上行 **PCM 16kHz 16bit mono 小端**，下行 **PCM 24kHz 16bit mono 小端**（40ms 帧）。

### 客户端 → 服务端

| 消息 | 说明 |
|---|---|
| `{"type":"hello","version":1,"deviceId":"esp-01","deviceName":"客厅"}` | 握手；deviceId 规范化后作为会话标识 |
| `{"type":"listen","state":"start"}` | 开始拾音（清空缓冲） |
| `{"type":"listen","state":"stop"}` | 结束拾音，触发一轮：ASR → 会话 → TTS |
| 二进制帧 | 拾音中的 PCM，任意分片长度；单次上限 120 秒 |
| `{"type":"query","text":"…"}` | 文本直达：跳过 ASR，会话 → TTS |
| `{"type":"speak","text":"…"}` | 纯 TTS 播报，不进会话 |
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
| `{"type":"tts","state":"stop","reason":"completed\|cancelled\|error\|aborted\|too_short\|empty_asr\|done"}` | 本轮结束 |
| 二进制帧 | TTS 音频 PCM（24kHz 16bit mono） |
| `{"type":"error","code":"…","message":"…"}` | 错误（asr_*/tts_*/llm_error/busy/… 后可继续使用） |
| `{"type":"pong","time":…}` | 心跳回应 |

一轮时序：`listen stop` →（可选 `stt`）→ `llm start` → `llm delta…` → `tts start`
→ (`tts sentence_start` + 音频帧)… → `llm end` → `tts stop`。`speak`/`query` 分别省略头部/ASR。
忙线时新的 `listen`/`query`/`speak` 返回 `busy`，需先 `abort`。

## REST（设置面板用，令牌同 WS）

`GET /status` · `GET /settings`（密钥脱敏）· `PUT /settings` · `POST /token` ·
`POST /test/asr` · `POST /test/tts` · `POST /test/llm` —— 均支持 `?token=` 或 `x-voice-token` 头。

## 测试客户端

```sh
node tools/test-client.mjs ws://<host>:8090/voice --token <令牌> speak "你好。"
node tools/test-client.mjs ws://<host>:8090/voice --token <令牌> query "介绍一下你自己"
```

返回音频写入 `out-*.pcm`（`ffplay -f s16le -ar 24000 -ch_layout mono out-*.pcm` 播放）。

## 开发

```sh
npm install && npm run build   # 产出 lib/index.js + lib/client.js（esbuild）
```

宿主半边改 `src/`，浏览器半边改 `src/client/`；`link:` 安装的包文件变更后
profile HMR 会自动重组（浏览器侧需硬刷新）。

## 安全边界

- 仅面向局域网；本插件不提供 TLS，跨公网请放 HTTPS 反代。
- 未配置令牌时端点开放（日志会告警）；面板可一键生成。
- 密钥只存于服务器本地设置文件（0600），REST 永不回传，日志不落密钥。

## 验证过的版本

- dsh 0.2.1-rc.2（GM800，ARM64，Node 22）。
