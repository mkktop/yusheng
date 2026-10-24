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
const [command, ...rest] = args

const wsUrl = token !== '' ? `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}` : url
const ws = new WebSocket(wsUrl)
ws.binaryType = 'nodebuffer'

const audioChunks = []
let llmText = ''
let stopped = false
const startedAt = Date.now()

const finishTimer = setTimeout(() => reallyDone('timeout 120s'), 120_000)

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
  process.exit(0)
}

ws.onopen = () => {
  ws.send(JSON.stringify({ type: 'hello', version: 1, deviceId: 'test-client', deviceName: 'test-client' }))
}

ws.onmessage = (event) => {
  const data = event.data
  if (Buffer.isBuffer(data) || data instanceof ArrayBuffer || Array.isArray(data)) {
    audioChunks.push(Buffer.isBuffer(data) ? data : Buffer.from(data))
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
      ws.send(JSON.stringify({ type: command, text: rest.join(' ') }))
    } else if (command === 'listen') {
      const file = rest[0]
      if (file === undefined) {
        console.error('listen 需要 PCM 文件参数')
        process.exit(2)
      }
      const pcm = readFileSync(file)
      ws.send(JSON.stringify({ type: 'listen', state: 'start' }))
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
  if ((message.type === 'tts' && message.state === 'stop') || message.type === 'error') {
    // 等 40ms 帧节奏发送收尾
    setTimeout(() => reallyDone(message.reason ?? message.type), 2500)
  }
}

ws.onerror = (event) => {
  console.error('ws error:', event?.message ?? event)
}

ws.onclose = (event) => {
  console.log(`closed: code=${event.code} reason=${event.reason}`)
  reallyDone('closed')
}
