// 语音协议测试客户端（Node 22+，使用内置 WebSocket）。
//
// 用法：
//   node tools/test-client.mjs ws://192.168.10.97:8090/voice --token <令牌> speak "你好，语声。"
//   node tools/test-client.mjs ws://…/voice --token <令牌> query "介绍一下你自己"
//   node tools/test-client.mjs ws://…/voice --token <令牌> listen 说一段话生成的16k单声道PCM.pcm
//
// 行为：连接 → hello → 执行命令 → 打印所有 JSON 消息 → 收到的音频写入 out-<时间戳>.pcm
// （24kHz 16bit mono，可用 ffplay -f s16le -ar 24000 -ch_layout mono out-*.pcm 播放）

import { writeFileSync, readFileSync } from 'node:fs'

const args = process.argv.slice(2)
const url = args.shift()
if (url === undefined) {
  console.error('usage: node tools/test-client.mjs ws://host:8090/voice [--token TOKEN] (speak|query) "文本" | listen <file.pcm>')
  process.exit(2)
}
const tokenIndex = args.indexOf('--token')
const token = tokenIndex >= 0 ? args.splice(tokenIndex, 2)[1] : ''
function option(name, fallback) { const index=args.indexOf(name); return index >= 0 ? args.splice(index,2)[1] : fallback }
const version=Number(option('--version','1'))
const deviceId=option('--device','test-client')
const conversationId=option('--conversation',undefined)
const [command, ...rest] = args

const wsUrl = token !== '' ? `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}` : url
const ws = new WebSocket(wsUrl)
// Node 内置 WebSocket 只认 blob（默认）/arraybuffer；blob 路径在 onmessage 里转
ws.binaryType = 'arraybuffer'

const audioChunks = []
let llmText = ''
let stopped = false
let exitCode = 0
let activeTurn
const startedAt = Date.now()

// Allow the maximum 120s capture plus 600s turn deadline and connection overhead.
const finishTimer = setTimeout(() => { exitCode=1; reallyDone('timeout 750s') }, 750_000)

function reallyDone(reason) {
  if (stopped) return
  stopped = true
  clearTimeout(finishTimer)
  try {
    ws.close()
  } catch { /* noop */ }
  const audio = Buffer.concat(audioChunks)
  if (audio.length > 0) {
    const file = `out-${Date.now()}.pcm`
    writeFileSync(file, audio)
    console.log(`audio: ${audio.length} bytes -> ${file} (24kHz s16le mono)`)
  }
  console.log(`llm text: ${JSON.stringify(llmText)}`)
  console.log(`done (${reason}, ${(Date.now() - startedAt) / 1000 | 0}s)`)
  process.exit(exitCode)
}

ws.onopen = () => {
  ws.send(JSON.stringify({ type: 'hello', version, deviceId, deviceName: 'test-client', conversationId, ...(version===2?{capabilities:['turns','audio.framed','agent.activity']}: {}) }))
}

ws.onmessage = async (event) => {
  const data = event.data
  if (data instanceof Blob) {
    audioChunks.push(Buffer.from(await data.arrayBuffer()))
    return
  }
  if (Buffer.isBuffer(data) || data instanceof ArrayBuffer || Array.isArray(data)) {
    const frame=Buffer.isBuffer(data) ? data : Buffer.from(data)
    audioChunks.push(version===2 && frame.subarray(0,4).toString()==='YSV2' ? frame.subarray(24) : frame)
    return
  }
  let message
  try {
    message = JSON.parse(String(data))
  } catch {
    console.log('bad message:', String(data).slice(0, 200))
    return
  }
  if (message.type === 'llm' && message.state === 'delta') llmText += message.text ?? ''
  if (message.type === 'welcome') {
    console.log('welcome:', JSON.stringify(message))
    if (command === 'speak' || command === 'query') {
      ws.send(JSON.stringify({ type: command, text: rest.join(' '), requestId:'cli-1' }))
    } else if (command === 'listen') {
      const file = rest[0]
      if (file === undefined) {
        console.error('listen 需要 PCM 文件参数')
        process.exit(2)
      }
      const pcm = readFileSync(file)
      ws.send(JSON.stringify({ type: 'listen', state: 'start', requestId:'cli-1' }))
      const CHUNK = 3200 // 100ms
      let offset = 0
      const timer = setInterval(() => {
        if (offset >= pcm.length) {
          clearInterval(timer)
          ws.send(JSON.stringify({ type: 'listen', state: 'stop' }))
          return
        }
        ws.send(pcm.subarray(offset, offset + CHUNK))
        offset += CHUNK
      }, 100)
    } else {
      console.error('unknown command:', command)
      process.exit(2)
    }
    return
  }
  console.log('<<', JSON.stringify(message))
  if (message.type==='turn.start') activeTurn=message.turnId
  if (message.type==='error') { exitCode=1; if(!activeTurn)reallyDone(message.code) }
  if ((version===1 && message.type==='tts' && message.state==='stop') || (version===2 && message.type==='turn.end')) {
    if(!['done','completed'].includes(message.reason))exitCode=1
    reallyDone(message.reason)
  }
}

ws.onerror = (event) => {
  console.error('ws error:', event?.message ?? event)
  exitCode=1
}

ws.onclose = (event) => {
  console.log(`closed: code=${event.code} reason=${event.reason}`)
  if(!stopped)exitCode=1
  reallyDone('closed')
}
