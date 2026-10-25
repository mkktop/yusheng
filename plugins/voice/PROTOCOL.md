# 语声语音协议 v2

端点：`ws(s)://<host>:<port>/voice?token=<设备令牌>`。WebSocket 有序可靠传输；输入二进制始终是 PCM 16kHz / s16le / mono，输出为 24kHz。服务端不接受隐式重采样或未实现的编码。

## 握手与能力协商

```json
{
  "type": "hello",
  "version": 2,
  "deviceId": "speaker-01",
  "deviceName": "客厅",
  "capabilities": ["turns", "audio.framed", "playback", "response.stop", "conversation.select", "agent.activity"],
  "audio": {
    "input": {"encoding": "pcm_s16le", "sampleRate": 16000, "channels": 1},
    "output": {"encoding": "pcm_s16le", "sampleRate": 24000, "channels": 1}
  }
}
```

`deviceId` 必须是 1–48 位 ASCII 字母、数字、下划线或连字符。v2 不做有损规范化。独立设备令牌绑定这个 ID；兼容令牌也固定绑定一个客户端（未绑定时首次握手写入归属），不能作为多客户端共享凭据。同设备同时仅允许一个连接，第二个返回 `device_in_use`。连接后 10 秒内必须完成握手。

`welcome` 返回 `version`、`connectionId`、`conversationId`、`sessionId`、`capabilities`（双方交集）、`supportedCapabilities` 和确认后的 `audio` 格式。未知能力被忽略，未知协议版本返回 `unsupported_version`。`audio.output.framing` 为 `ysv2` 或 `raw`，以服务端返回值为准。

`sessionId` 是当前登记的宿主会话 ID；首次执行可能因旧日志损坏而采用替补 ID，此时以该轮的 `session` 事件为准。

## 身份、轮次与去重

- `connectionId`：本次连接身份，重连改变。
- `conversationId`：当前客户端内部的持久对话名称，默认等于设备 ID；会话由客户端 ID、对话名称、模式及上下文代次共同隔离。
- `requestId`：客户端为每次新输入提供的 1–128 字符 ID。
- `turnId`：服务端在接受输入时生成，每轮唯一。
- `streamId`：连接内递增的 uint32 下行音频流 ID，跨连接不保证唯一。

轮次事件带上述关联字段。每个接受的输入恰好产生一次 `turn.end`，主动断线时无法保证客户端收到终结事件。客户端必须按 `connectionId`、`turnId`、`streamId` 丢弃旧输出。

同连接保存最近 256 个输入的去重记录。重发相同 `requestId` 和输入，进行中返回 `request.duplicate`，已完成则重放 `turn.end`，不会重放音频或重新执行工具。不同内容复用 ID 返回 `request_conflict`。这是连接内去重，不承诺断线后的幂等执行；不要自动重试可能已有副作用的任务。

## 输入与控制

| 消息 | 含义 |
|---|---|
| `{"type":"query","requestId":"q1","text":"你好"}` | 文本 → agent → 音频；最多 4000 字符 |
| `{"type":"speak","requestId":"s1","text":"欢迎回来"}` | 纯播报；最多 1000 字符，不修改对话 |
| `{"type":"listen","state":"start","requestId":"a1"}` | 接受一轮并开始收集音频 |
| 二进制 PCM | 拾音期间发送；总量最多 120 秒，最多 4096 个非空分片 |
| `{"type":"listen","state":"stop","turnId":"…"}` | 提交输入；`turnId` 可省略，提供时必须匹配 |
| `{"type":"turn.cancel","turnId":"…"}` | 终止本轮输入、播报和 agent 执行；`abort` 为兼容别名 |
| `{"type":"response.stop","turnId":"…"}` | 仅停止语音输出，agent 继续运行，文本与进度继续返回 |
| `{"type":"conversation.select","conversationId":"speaker-01-work"}` | 空闲时切换持久对话 |
| `{"type":"ping","time":123}` | 返回 `pong`，用于应用层测延迟 |

取消不能撤销已经执行的工具副作用。宿主取消后若尚未真正空闲，后续输入可能收到 `session_busy`，请稍后用新请求 ID 重试。服务端在宿主完成收尾前一直保留会话互斥锁，避免串流。

0.5 起，对话名称仅在当前客户端内有效，总长不超过 64，只允许字母、数字、下划线和连字符。不同客户端都使用 `main` 也不会共享上下文；无需设备 ID 前缀。切换对话名称不会切换客户端配置或长期记忆。`conversation.select`、`response.stop`、`playback`、`agent.activity` 需要事先协商对应能力。

所有阶段共享 `maxTurnSeconds` 总期限，从输入接受时开始计时，包含拾音、ASR、会话准备、工具执行、合成和音频发送。客户端应尽早发送录音结束消息。

## 输出与完成语义

| 事件 | 说明 |
|---|---|
| `turn.start` | 输入已接受；包含 `input` 和初始 `state` |
| `turn.state` | `transcribing` / `thinking` |
| `stt` | 最终识别结果：`text`、`final:true`；当前 ASR 为整段识别 |
| `llm` | `state:start/delta/end`；delta 包含可见文本，不包含 reasoning 文本 |
| `session` | 本轮实际采用的 `sessionId` |
| `agent.activity` | 宿主 `running/idle` 状态；工具调用含 `state:tool`、`toolCallId`、`name`，不发送工具参数 |
| `tts start` / `audio.start` | 开始合成音频；格式与流身份在事件中给出 |
| `tts sentence_start` | 对应句子首个音频片段即将发送；含 `text`、`sentenceIndex`、`sampleOffset` |
| 二进制 | PCM，或协商后的 YSV2 头加 PCM |
| `audio.end` | 本流发送结束：`reason`、实际已发 `samples`；不代表设备已播放完 |
| `tts stop` | 兼容客户端的轮次收尾，必定在该轮最后一帧之后 |
| `turn.end` | 整轮终结，包含 `reason`、`responseStopped`、`durationMs`、`metrics` |
| `error` | `code`、`message`，轮内错误带关联 ID；随后会有 `turn.end` |

`reason`：`completed`（agent 完成）、`done`（纯播报完成）、`stopped`（纯播报被停止）、`aborted`、`cancelled`、`timeout`、`error`、`too_short`、`too_long`、`empty_asr`、`disconnected`。合成失败、截断、超时不会报告成功。停止语音而 agent 成功时仍为 `completed`，同时 `responseStopped:true`。

`metrics` 包含可用的 `asrMs`、`firstTextMs`、`firstAudioMs` 和 `audioSamples`。首文本/首音频时间从输入接受时计算，缺失阶段不提供该字段。

`llm end` 只代表 agent 文本阶段结束，音频可能仍在排队。`audio.end` 只代表帧已提交到传输层，客户端按自己的播放时钟播放。句子样本位置用于字幕同步，不能把事件到达时间视为实际播放时间。

## YSV2 二进制帧

只在协商 `audio.framed` 后启用下行帧头；v1 和未协商能力的 v2 客户端仍收到裸 PCM。每条 WebSocket 二进制消息包含 24 字节头和音频正文，数值为小端：

| 偏移 | 长度 | 内容 |
|---|---|---|
| 0 | 4 | ASCII `YSV2` |
| 4 | 4 | uint32 `streamId` |
| 8 | 4 | uint32 `sequence`，从 0 开始 |
| 12 | 8 | float64 `sampleOffset`，非负安全整数，以单声道采样数计 |
| 20 | 4 | uint32 PCM 正文的字节长度 |
| 24 | 可变 | PCM s16le / 24kHz / mono |

通常每帧 1920 字节音频（40ms），句尾可短于一帧；服务商分块会重新对齐。校验长度、序号与样本偏移后再入播放队列。

## 播放反馈

```json
{"type":"playback","turnId":"…","streamId":1,"state":"progress","playedSamples":24000}
```

`state` 为 `progress`、`ended`、`cleared`。位置必须单调递增、不超过已发送样本数；只有收到 `audio.end` 且完整播放后才能报告 `ended`。清空播放队列时报告 `cleared`。服务端返回 `playback.ack`，保留最近 32 条流记录。

额外协商 `playback.flow` 后，可在 `progress` 中提供 `bufferedSamples`（本流当前播放队列长度，不能大于已发送减已播放的样本数）。超过 2 秒时服务端暂停下发；客户端应持续更新，降至阈值内自动恢复。暂停时仍需发心跳与缓冲反馈，整轮超时继续计时。未协商或不提供此字段时仅使用网络背压和实时发送节奏。

反馈仅记录播放位置，不会自动改写 dsh 历史或声称撤销了未听到的内容。客户端收到取消/停止事件时需主动清空本地缓冲，服务端无法收回已发送的 PCM。

## 边界与后续扩展

控制消息最多 32KiB，单条 WS 消息最多 256KiB，最多 64 个连接。音频生产队列约 5 秒，socket 积压超过 256KiB 时暂停生产；待合成文本最多 32000 字符。拥塞由整轮期限兜底，不再固定 30 秒截断长播报。

0.3 增加了形象状态、同步表情动作和声明式卡片/选项/进度/表单及交互回传，见 [形象与智能 UI 协议](INTERACTION.md)。新增能力为 `presentation.state`、`presentation.cue`、`ui.render`；现有语音消息保持兼容。

当前提供客户端断句、整段 ASR、增量文本和流式 TTS。服务端 VAD、流式 ASR、Opus、跨连接音频回放、长期后台任务队列和审批交互尚未实现。后续可增加能力与事件；改变现有字段或音频格式需要新协议版本。上行控制消息仍限制为 32KiB；UI 快照为较大的下行控制消息，单次最多约 200KiB。

## 客户端数据边界（0.5）

WebSocket 不接受客户端自选长期记忆路径或其他客户端 ID。身份由绑定令牌和 hello 一致性校验确定，服务端为该身份装配独立设置、模型、事实记忆、会话和 UI 存储。agent 的 `voice_memory` 工具不含跨客户端选择参数。配置和记忆的管理仍需要 dsh owner 登录或 adminToken，设备令牌不能调用管理 REST。重置上下文会关闭所选客户端连接，重连后进入新代次；其他客户端连接保持。

这是应用层隔离。当前宿主全访问工具权限的边界与部署要求见 README「0.5 每个客户端独立」。
