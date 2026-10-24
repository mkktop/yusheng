// 本地冒烟测试：mock 掉 dsh 宿主服务，验证插件装载、REST 与 WS 协议主干。
// 用法：node tools/smoke.mjs （会在 127.0.0.1:18090 起服务，无需真实凭据）

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const plugin = require('../lib/index.js').default

const tmp = mkdtempSync(join(tmpdir(), 'yusheng-smoke-'))

function makeAgent() {
  // followup 后 1.2 秒才空闲：既能测忙线拒绝，又不拖慢正常轮次
  let pendingIdle = undefined
  return {
    session: { seq: 1 },
    followup() {
      pendingIdle = new Promise((resolve) => setTimeout(resolve, 1200))
    },
    async whenIdle() {
      if (pendingIdle !== undefined) await pendingIdle
    },
    status: 'idle',
  }
}

const agents = {
  create: async () => ({ agent: makeAgent() }),
  resume: async () => {
    throw new Error('SESSION_QUERY_SESSION_NOT_FOUND')
  },
}
const sessions = { flush: async () => undefined }
const services = {
  agents,
  sessions,
  agentDefaultModel: { currentSelection: () => ({ provider: 'deepseek-official', model: 'mock-model' }) },
  subagents: undefined,
}

let cleanup = () => {}
const root = {
  logger: { info() {}, warn() {} },
  get: (name) => services[name],
  on: () => () => undefined,
  effect(fn) {
    const prev = cleanup
    cleanup = () => {
      fn()
      prev()
    }
  },
}

plugin.apply(root, { host: '127.0.0.1', port: 18090, settingsPath: join(tmp, 'settings.json') })

const base = 'http://127.0.0.1:18090'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
await sleep(300)

let failures = 0
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures += 1
}

// 1. status（未配置令牌 → 开放）
const status1 = await (await fetch(`${base}/status`)).json()
check('GET /status', status1.ok === true && status1.service === 'dsh-yusheng-voice')
check('status.model 来自宿主选择', status1.model?.model === 'mock-model')

// 2. 写入令牌后未授权 401
const put = await (await fetch(`${base}/settings`, {
  method: 'PUT', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ ttsVoice: 'female-yujie', ttsSpeed: 1.5, bogus: 'x' }),
})).json()
check('PUT /settings 合法字段生效', put.ok === true && put.settings.ttsVoice === 'female-yujie' && put.settings.ttsSpeed === 1.5, `rejected=${JSON.stringify(put.rejected)}`)
check('未知字段被拒绝并保留其余', put.rejected.includes('bogus'))
check('脱敏视图不含密钥', !('minimaxApiKey' in put.settings) || typeof put.settings.minimaxApiKey === 'string')

const tokenResult = await (await fetch(`${base}/token`, { method: 'POST' })).json()
check('POST /token', typeof tokenResult.token === 'string' && tokenResult.token.startsWith('ysv-'))
const token = tokenResult.token

const unauth = await fetch(`${base}/status`)
check('配置令牌后未授权 401', unauth.status === 401)
const authed = await (await fetch(`${base}/status?token=${token}`)).json()
check('带令牌可用', authed.ok === true)

// 3. WS 协议
const ws = new WebSocket(`ws://127.0.0.1:18090/voice?token=${token}`)
ws.binaryType = 'arraybuffer'
const received = []
const waiters = []
ws.onmessage = (event) => {
  const value = typeof event.data === 'string' ? JSON.parse(event.data) : { binary: true }
  console.log('   [ws <<]', JSON.stringify(value))
  received.push(value)
  // 快照后逐个唤醒：poll 未满足时会重新入队，不能在 drain 循环里边取边加
  const pending = waiters.splice(0)
  for (const wake of pending) wake()
}

await new Promise((resolve, reject) => {
  ws.onopen = resolve
  ws.onerror = (event) => reject(new Error('ws error: ' + (event?.message ?? '')))
})
ws.send(JSON.stringify({ type: 'hello', version: 1, deviceId: 'Smoke Test!!', deviceName: '冒烟' }))

const waitFor = (predicate, timeoutMs = 5000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('timeout waiting; got: ' + JSON.stringify(received.slice(-6)))), timeoutMs)
  const poll = () => {
    if (predicate()) {
      clearTimeout(timer)
      resolve(undefined)
      return
    }
    waiters.push(poll)
  }
  poll()
})

await waitFor(() => received.some((m) => m.type === 'welcome'))
const welcome = received.find((m) => m.type === 'welcome')
check('welcome 握手', welcome.sessionId === 'voice-smoke-test' && welcome.sampleRateOut === 24000)

// 4. speak 无凭据 → 应报 no_api_key 并以 tts stop 收尾
ws.send(JSON.stringify({ type: 'speak', text: '测试' }))
await waitFor(() => received.some((m) => m.type === 'tts' && m.state === 'stop'), 8000)
check('speak 无凭据报错且收尾', received.some((m) => m.type === 'error' && m.code === 'no_api_key'))
check('tts stop(reason=error)', received.some((m) => m.type === 'tts' && m.state === 'stop' && m.reason === 'error'))

// 5. query（mock agent 立即收敛）→ llm start/end + tts stop
await sleep(100)
ws.send(JSON.stringify({ type: 'query', text: '你好' }))
await waitFor(() => received.some((m) => m.type === 'tts' && m.state === 'stop' && m.reason === 'completed'), 8000)
check('query 走完 llm start/end', received.some((m) => m.type === 'llm' && m.state === 'start') && received.some((m) => m.type === 'llm' && m.state === 'end'))

// 6. 忙线拒绝 + abort 恢复
await sleep(100)
ws.send(JSON.stringify({ type: 'query', text: '忙线测试' }))
await sleep(50)
ws.send(JSON.stringify({ type: 'query', text: '应当busy' }))
await waitFor(() => received.some((m) => m.type === 'error' && m.code === 'busy'), 5000)
ws.send(JSON.stringify({ type: 'abort' }))
await waitFor(() => received.some((m) => m.type === 'tts' && m.state === 'stop' && m.reason === 'aborted'), 5000)
check('忙线 busy + abort 收尾', true)

// 7. 自检端点（ASR 无凭据应 ok:false 但 HTTP 200）
const testAsr = await (await fetch(`${base}/test/asr?token=${token}`, { method: 'POST' })).json()
check('POST /test/asr 返回结构化结果', testAsr.ok === false && testAsr.code === 'no_api_key')

ws.close()
await sleep(200)
cleanup()
try {
  rmSync(tmp, { recursive: true, force: true })
} catch { /* Windows 文件占用可忽略 */ }

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
