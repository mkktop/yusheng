// 一次性延迟测量：query 发出 → 首个 llm delta → tts start → 首帧音频 → tts stop
const url = process.argv[2] || 'ws://192.168.10.97:8090/voice'
const text = process.argv[3] || '一句话介绍今天的安排'
const t0 = Date.now()
const ts = {}
const mark = (k) => { ts[k] ??= Date.now() - t0 }
const audio = []
const ws = new WebSocket(url)
ws.binaryType = 'arraybuffer'
ws.onopen = () => ws.send(JSON.stringify({ type: 'hello', version: 1, deviceId: 'latency-probe', deviceName: 'probe' }))
ws.onmessage = async (ev) => {
  const d = ev.data
  if (d instanceof Blob) { if (!ts.firstAudio) { ts.firstAudio = Date.now() - t0 }; audio.push(Buffer.from(await d.arrayBuffer()).length); return }
  if (d instanceof ArrayBuffer) { if (!ts.firstAudio) { ts.firstAudio = Date.now() - t0 }; audio.push(d.byteLength); return }
  try {
    const m = JSON.parse(String(d))
    if (m.type === 'welcome') { mark('welcome'); ws.send(JSON.stringify({ type: 'query', text })) }
    if (m.type === 'llm' && m.state === 'start') mark('llmStart')
    if (m.type === 'llm' && m.state === 'delta' && !ts.firstDelta) mark('firstDelta')
    if (m.type === 'tts' && m.state === 'start') mark('ttsStart')
    if (m.type === 'error') console.error('server error:', JSON.stringify(m))
    if (m.type === 'llm' && m.state === 'end') mark('llmEnd')
    if (m.type === 'tts' && m.state === 'stop') {
      mark('ttsStop')
      const total = audio.reduce((a, b) => a + b, 0)
      console.log(JSON.stringify({ text, reason: m.reason, ...ts, audioSec: +(total / 48000).toFixed(2), audioBytes: total }))
      ws.close()
      process.exit(0)
    }
  } catch { /* ignore */ }
}
setTimeout(() => { console.log(JSON.stringify({ timeout: true, ...ts })); process.exit(1) }, 90_000)
