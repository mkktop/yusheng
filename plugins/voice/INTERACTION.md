# 客户端形象与智能 UI（0.3）

协议仍为 v2，新增可选能力。纯语音客户端和 v1 无需实现这些能力。

## 接入与参考客户端

打开 `http(s)://<语音服务>/demo`，填写设备 ID 和设备令牌即可使用参考客户端。设置面板也提供入口。设备令牌绑定 ID 时须填写匹配的 ID。网页和 SDK 是公开静态资源，不包含凭据；建立语音连接仍需设备鉴权。

参考客户端带 SVG 形象、语音播放、同步动作、卡片/选项/进度/表单渲染。它提供交互参考，应用可以替换自己的模型、动画与 UI 样式。

浏览器 SDK：`/voice-client.js`，包内导出 `dsh-yusheng-voice/voice-client`。源码：[voice-client.ts](src/client/voice-client.ts)。

```js
import { VoiceClient, renderSurface, DEFAULT_PRESENTATION } from '/voice-client.js'

const client = new VoiceClient()
const disposeUI = renderSurface(document.querySelector('#surface'), client)
client.addEventListener('cue', ({ detail }) => {
  // 在实际播放到达对应采样位置时触发；映射到自己的动画系统。
  avatar.setExpression(detail.expression, detail.durationMs)
  avatar.playGesture(detail.gesture, detail.intensity)
})
client.addEventListener('event', ({ detail }) => {
  if (detail.type === 'presentation.state') avatar.setState(detail.state)
  if (detail.type === 'llm' && detail.state === 'delta') appendTranscript(detail.text)
})
// 由用户点击连接按钮调用，以启动浏览器音频播放。
await client.connect('wss://example.com/voice', deviceToken, 'speaker-01', DEFAULT_PRESENTATION)
client.query('请开心地点头，并展示两个可点击的建议。')
```

SDK 的 `event` 是收到网络事件的时间；`cue` 才是已经按播放时钟调度后的动画时间。不要同时根据两者执行同一个动作。SDK 在取消、停止语音、切换对话、断开连接时清理旧音频和已排队动作，并按实际播放位置报告反馈。

SDK 还提供 `speak`、`listenStart`、`sendAudio`、`listenStop`、`cancel`、`stopSpeech`、`selectConversation`、`syncUI`、`action`、`dismiss`、`disconnect`。录音采集、16kHz 重采样、客户端 VAD 和回声消除由接入应用负责。

## 握手声明

```json
{
  "type": "hello",
  "version": 2,
  "deviceId": "speaker-01",
  "capabilities": ["turns", "audio.framed", "playback", "presentation.state", "presentation.cue", "ui.render"],
  "presentation": {
    "expressions": ["neutral", "happy", "thinking", "confused"],
    "gestures": ["nod", "wave"],
    "components": ["card", "choices", "progress", "form"]
  }
}
```

表情和动作 ID 可由客户端自定义，各最多 32 项，每项 1–64 位 ASCII 字母、数字、下划线或连字符。仅已声明的名称会提供给模型。组件类型限于上述四种，不能任意声明新类型。

省略 `presentation` 时使用参考集合：

- 表情：`neutral/happy/sad/surprised/thinking/confused/calm`。
- 动作：`nod/shake/wave/point/celebrate`。
- 组件：`card/choices/progress/form`。

数组传 `[]` 表示不支持该类内容。`welcome` 回显实际清单并返回 `serverTime`（UTC 毫秒），可用于修正客户端对组件过期时间的估算。能力只按客户端声明启用；服务端不会把 UI 发送给未协商的设备。

## 形象状态与表现

`presentation.state` 由服务端自动生成，包含 `state` 和连接内递增 `sequence`：

| 状态 | 场景 |
|---|---|
| `idle` | 空闲；有播放反馈的客户端完整播放后才回到空闲 |
| `listening` | 收集录音 |
| `thinking` | ASR、agent 或工具执行中 |
| `speaking` | 开始发送实际语音帧 |
| `error` | 已接受的轮次失败 |

支持 `presentation.cue` 时，agent 会在自己的会话作用域得到 `voice_present` 工具。参数：

```json
{"expression":"happy","gesture":"nod","durationMs":1800,"intensity":0.7,"timing":"next_sentence"}
```

至少一个表情或动作；时长 100–10000ms，强度 0–1。`timing` 为 `now` 或 `next_sentence`，默认 `now`。

网络事件 `presentation.cue` 包含 `cueId`、上述参数、`sequence` 和当前轮次/流关联字段。`now` 立即执行；`next_sentence` 在接下来一句音频首帧发送前发布，并给出 `sampleOffset`。客户端应等实际播放到这个采样位置再执行。网络接收时刻不能代表播放时刻。

一个轮次最多排队 16 个等待下一句的动作，没有后续语音时这些动作会丢弃。`presentation.reset` 表示清除旧动作和临时表情；取消本轮、停止播报、切换对话会触发。表情动作提示不进入 TTS 文本。

## Agent 的界面工具

支持 `ui.render` 时，agent 得到 `voice_ui`，仅注册在该语音 agent 作用域内，收尾后释放；其他会话不能借用它发送界面。

```json
{
  "operation": "render",
  "component": {
    "id": "next-step",
    "type": "choices",
    "title": "想先做什么？",
    "text": "选一个方向，我们继续。",
    "actions": [
      {"id":"chat","label":"轻松聊聊","prompt":"用户选择轻松聊天，请问一个简单的问题。"},
      {"id":"plan","label":"安排今天","prompt":"帮助用户安排今天，先问最重要的一件事。"}
    ],
    "expiresInMs": 300000
  }
}
```

更新同一个 `id` 即替换组件，由服务端分配新 `revision`、`instanceId` 和 `expiresAt`。删除用 `{"operation":"remove","componentId":"next-step"}`。

| 类型 | 字段 |
|---|---|
| `card` | `title`、可选 `text`、`rows:[{label,value}]`、`actions` |
| `choices` | `title`、可选 `text/rows`、至少一个 `actions` |
| `progress` | `title`、可选 `text`、0–1 的 `value`；省略 value 为不确定进度 |
| `form` | `title`、可选 `text/rows`、`fields`、一个提交 action |

表单字段为 `{id,label,type,required?}`，type 为 `text/number/boolean/select`。number 可设置 min/max；select 必须提供 `options:[{value,label}]`。required 布尔字段表示需要勾选。

组件 ID、字段 ID、action ID 均为 1–64 位 ASCII 字母、数字、下划线或连字符。title ≤120 字符，text ≤2000；rows ≤12，actions ≤8，fields ≤8，select 选项 ≤12。单组件 UTF-8 序列化最多 12KiB。

服务端只发送文本和结构化数据。HTML、脚本、任意组件名称、外部资源或可执行回调均不在本版契约中。参考渲染器使用 `textContent` 与原生控件。

## UI 事件与点击闭环

- `ui.render`：包含 `component`，这是可渲染公开视图；action 只含 id 和 label，不含模型提供的 prompt。
- `ui.snapshot`：完整替换当前视图的 `components`，握手/切换对话时发送；客户端也可发 `{"type":"ui.sync"}` 请求。
- `ui.remove`：包含 `componentId`、新的 `revision`，可能含取消原因。
- `ui.action.accepted`：点击已被接受，包含 componentId/actionId 及新轮次关联字段。

客户端回传：

```json
{
  "type":"ui.action",
  "requestId":"click-unique-001",
  "componentId":"next-step",
  "instanceId":"服务端返回的 UUID",
  "revision":12,
  "actionId":"plan",
  "values":{}
}
```

操作仅在当前轮结束后接受，忙碌返回 `busy` 且不消费组件。服务器校验设备/对话/模式归属、实例、版本、有效期、action 和表单值，原子禁用该组件，然后用服务器保存的 prompt 和已校验值作为新用户消息驱动 agent。客户端不能提交 `text`、`prompt` 等替代操作指令。

组件的一次成功提交会禁用其中所有操作，避免多选竞态和重复执行。同连接相同 requestId 的重试遵循 v2 去重规则；换请求 ID 或重连后重放旧组件操作会返回 `stale_ui`。接受后的轮次仍可能取消或失败，不会自动重试有副作用的工作；agent 可重新渲染组件允许再次操作。

关闭组件：`{"type":"ui.dismiss","componentId":"…","instanceId":"…","revision":12}`。关闭仅移除界面，不取消 agent 任务。

## 生命周期与限制

0.5 起 UI 存于 `clients/<deviceId>/ui.json`（0600），按客户端＋对话＋agent preset＋上下文代次隔离。旧共享 UI 文件仅按可证明的客户端归属迁移，保留原文件；重置上下文后不会复用旧界面。未过期组件及已消费状态可以跨连接、跨宿主重启恢复。过期时间默认 5 分钟，最短 10 秒，最长 30 分钟。每个视图最多 16 个组件，最多 256 个视图，总存储最多 4MiB；组件快照最多约 200KiB。

取消、超时、错误或未完成轮次断线会撤销该轮创建/更新的 UI，避免留下可点击的旧结果；已完成轮次的 UI 保留到过期、关闭或更新。更新被取消后不会恢复更早的组件版本。表单值只作为新的用户消息进入宿主对话，UI 状态文件不会保存提交的值。

每轮最多 64 次界面或表现操作。自定义完整应用、嵌套布局、任意网页嵌入、长期后台任务和模型自行修改前端代码不属于本版协议。客户端可继续扩展自己的渲染和动画系统，通过后续能力协商演进。

## 验证入口

```sh
npm test
node tools/demo-preview.mjs                     # 本地模拟，不访问外部 API
node tools/interaction-device-test.mjs          # 设备真实 agent/语音/UI 闭环
# 真实测试会保存待恢复组件，再正常重启 dsh，待端口就绪后运行：
VOICE_INTERACTION_REPORT=/tmp/yusheng-ui-restart-report.json node tools/interaction-device-test.mjs --restart-read
```
