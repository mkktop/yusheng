import test from 'node:test'
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { VoiceConnection } from '../src/connection.js'
import { AgentBridge } from '../src/llm.js'
import { synthesizeStream } from '../src/tts.js'
import { DEFAULT_SETTINGS, SettingsStore } from '../src/settings.js'
import { VoiceServer } from '../src/server.js'
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'

function deferred<T = any>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise<void>((r) => setImmediate(r))
}
const completed = { kind: 'completed', text: '' }
function controlledBridge() {
  const turns: any[] = []
  return {
    turns,
    releases: 0,
    release() {
      this.releases++
    },
    sessionIdFor(device: string, preset = '') {
      return `voice-${device}${preset ? `-p-${preset}` : ''}`
    },
    async turn(device: string, text: string, callbacks: any, preset: string, signal: AbortSignal) {
      const result = deferred()
      const turn = { device, text, callbacks, preset, signal, result, cancels: 0 }
      turns.push(turn)
      return {
        done: result.promise,
        cancel() {
          turn.cancels++
        },
      }
    },
  }
}
function connection(t: any, bridge: any = controlledBridge(), settings: any = {}) {
  const messages: any[] = []
  const socket = {
    readyState: 1,
    bufferedAmount: 0,
    send(data: string | Buffer) {
      messages.push(Buffer.isBuffer(data) ? Buffer.from(data) : JSON.parse(data))
    },
    close(code: number, reason: string) {
      messages.push({ close: code, reason })
      this.readyState = 3
    },
  }
  const conn = new VoiceConnection(socket, {
    bridge,
    settings: () => ({ ...DEFAULT_SETTINGS, promptPrefix: '', ...settings }),
    log() {},
  })
  t.after(() => conn.handleClosed())
  const send = (message: any) => conn.handleMessage(JSON.stringify(message))
  return { conn, socket, messages, send, bridge }
}
function hello(c: any, extra: any = {}) {
  c.send({ type: 'hello', version: 1, deviceId: 'test', ...extra })
}
const stops = (c: any) => c.messages.filter((m: any) => m.type === 'tts' && m.state === 'stop')
const audio = (c: any) => Buffer.concat(c.messages.filter(Buffer.isBuffer))
const realFetch = globalThis.fetch
function mockFetch(t: any, fn: any) {
  globalThis.fetch = fn
  t.after(() => {
    globalThis.fetch = realFetch
  })
}
function audioResponse(chunks: Buffer[], terminalAudio = Buffer.alloc(0), newline = true) {
  const events = chunks.map((chunk) => ({ data: { audio: chunk.toString('hex'), status: 1 } }))
  events.push({ data: { audio: terminalAudio.toString('hex'), status: 2 } })
  return new Response(events.map((e) => 'data: ' + JSON.stringify(e)).join('\n\n') + (newline ? '\n\n' : ''))
}
function replyingBridge(text = '你好。') {
  return {
    release() {},
    sessionIdFor: (id: string) => `voice-${id}`,
    async turn(_id: string, _prompt: string, callbacks: any) {
      callbacks.onTextDelta(text)
      return { done: Promise.resolve(completed), cancel() {} }
    },
  }
}

// Public protocol: validation, correlation, and capture state.
test('hello validates version/deviceId and can recover with a valid handshake', (t) => {
  const c = connection(t)
  hello(c, { version: 999 })
  assert.equal(c.messages.at(-1).code, 'unsupported_version')
  hello(c, { deviceId: '中文' })
  assert.equal(c.messages.at(-1).code, 'invalid_device_id')
  hello(c, { deviceId: 'Smoke Test!!', requestId: 'hello-1' })
  assert.equal(c.messages.at(-1).deviceId, 'smoke-test')
  assert.equal(c.messages.at(-1).requestId, 'hello-1')
  assert.equal(c.messages.at(-1).audioFormat, 'pcm_s16le')
})

test('malformed control messages are rejected without changing connection state', (t) => {
  const c = connection(t)
  for (const raw of ['{', 'null', '[]', '42']) {
    c.conn.handleMessage(raw)
    assert.equal(c.messages.at(-1).code, 'bad_json')
  }
  c.send({ type: 'query', text: 'x' })
  assert.equal(c.messages.at(-1).code, 'no_hello')
  hello(c)
  c.send({ type: 'query', text: 'x', requestId: 123 })
  assert.equal(c.messages.at(-1).code, 'bad_request_id')
  c.send({ type: 'query', text: 'x'.repeat(4001), requestId: 'large' })
  assert.equal(c.messages.at(-1).code, 'text_too_long')
  assert.equal(c.messages.at(-1).requestId, 'large')
  assert.equal(c.bridge.turns.length, 0)
})

test('recording rejects query/speak/repeated start rather than losing captured audio', (t) => {
  const c = connection(t)
  hello(c)
  c.send({ type: 'listen', state: 'start', requestId: 'record-1' })
  c.conn.handleBinary(Buffer.alloc(100))
  for (const msg of [
    { type: 'query', text: 'x' },
    { type: 'speak', text: 'x' },
    { type: 'listen', state: 'start' },
  ]) {
    c.send(msg)
    assert.equal(c.messages.at(-1).code, 'busy')
  }
  assert.equal(c.conn.describe().state, 'listening')
  c.send({ type: 'abort' })
  assert.equal(c.messages.at(-1).requestId, 'record-1')
  assert.equal(c.conn.describe().state, 'ready')
})

test('short capture emits exactly one correlated terminal message', async (t) => {
  const c = connection(t)
  hello(c)
  c.send({ type: 'listen', state: 'start', requestId: 'short' })
  c.conn.handleBinary(Buffer.alloc(100))
  c.send({ type: 'listen', state: 'stop' })
  await flush()
  assert.equal(stops(c).length, 1)
  assert.equal(stops(c)[0].reason, 'too_short')
  assert.equal(stops(c)[0].requestId, 'short')
  assert.equal(stops(c)[0].turnId, c.messages.find((m) => m.type === 'turn').turnId)
})

test('capture byte overflow releases the recording state', (t) => {
  const c = connection(t)
  hello(c)
  c.send({ type: 'listen', state: 'start' })
  c.conn.handleBinary(Buffer.alloc(16000 * 2 * 120 + 1))
  assert(c.messages.some((m) => m.code === 'too_long'))
  assert.equal(stops(c).length, 1)
  assert.equal(c.conn.describe().state, 'ready')
})

test('capture wall-clock timeout also works when no PCM arrives', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const c = connection(t)
  hello(c)
  c.send({ type: 'listen', state: 'start', requestId: 'silent' })
  t.mock.timers.tick(120000)
  assert.equal(c.conn.describe().state, 'ready')
  assert.equal(stops(c)[0].reason, 'timeout')
  assert.equal(stops(c)[0].requestId, 'silent')
})

// Cancellation: do not allow stale work to touch the new request.
test('abort during ASR cancels its signal and never submits late recognition', async (t) => {
  const response = deferred<Response>()
  let signal: AbortSignal | undefined
  mockFetch(t, async (_url: any, init: any) => {
    signal = init.signal
    return response.promise
  })
  const c = connection(t, undefined, { minimaxApiKey: 'mock' })
  hello(c)
  c.send({ type: 'listen', state: 'start' })
  c.conn.handleBinary(Buffer.alloc(16000))
  c.send({ type: 'listen', state: 'stop' })
  c.send({ type: 'abort' })
  const count = c.messages.length
  assert.equal(signal?.aborted, true)
  response.resolve(new Response(JSON.stringify({ text: 'cancelled recording' })))
  await flush()
  assert.equal(c.bridge.turns.length, 0)
  assert.equal(c.messages.length, count)
})

test('disconnect during ASR also prevents late model submission', async (t) => {
  const response = deferred<Response>()
  mockFetch(t, async () => response.promise)
  const c = connection(t, undefined, { minimaxApiKey: 'mock' })
  hello(c)
  c.send({ type: 'listen', state: 'start' })
  c.conn.handleBinary(Buffer.alloc(16000))
  c.send({ type: 'listen', state: 'stop' })
  c.conn.handleClosed()
  response.resolve(new Response(JSON.stringify({ text: 'late' })))
  await flush()
  assert.equal(c.bridge.turns.length, 0)
  assert.equal(c.conn.describe().state, 'closed')
  assert.equal(c.bridge.releases, 1)
})

test('old completion/deltas cannot reset or cancel a new round', async (t) => {
  const c = connection(t)
  hello(c)
  c.send({ type: 'query', text: 'old', requestId: 'old' })
  await flush()
  const old = c.messages.find((m) => m.type === 'turn').turnId
  c.send({ type: 'abort', turnId: old })
  c.send({ type: 'query', text: 'new', requestId: 'new' })
  await flush()
  const count = c.messages.length
  c.bridge.turns[0].callbacks.onTextDelta('stale text。')
  c.bridge.turns[0].result.resolve({ kind: 'cancelled', text: '' })
  await flush()
  assert.equal(c.messages.length, count)
  assert.equal(c.conn.describe().state, 'busy')
  c.send({ type: 'abort', turnId: old })
  assert.equal(c.messages.at(-1).code, 'unknown_turn')
  assert.equal(c.conn.describe().state, 'busy')
  c.send({ type: 'abort' })
  assert.equal(c.bridge.turns[1].cancels, 1)
  assert.equal(stops(c).length, 2)
  c.bridge.turns[1].result.resolve(completed)
})

test('abort while turn creation is pending cancels the late handle', async (t) => {
  const creation = deferred()
  let cancels = 0
  const bridge = { ...replyingBridge(), turn: () => creation.promise }
  const c = connection(t, bridge)
  hello(c)
  c.send({ type: 'query', text: 'pending' })
  c.send({ type: 'abort' })
  const count = c.messages.length
  creation.resolve({
    done: Promise.resolve(completed),
    cancel() {
      cancels++
    },
  })
  await flush()
  assert.equal(cancels, 1)
  assert.equal(c.messages.length, count)
})

test('configured deadline cancels stalled model exactly once and permits a new request', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  const c = connection(t, undefined, { maxTurnSeconds: 15 })
  hello(c)
  c.send({ type: 'query', text: 'stalled', requestId: 'stall' })
  await flush()
  t.mock.timers.tick(15000)
  await flush()
  assert.equal(c.conn.describe().state, 'ready')
  assert.equal(c.bridge.turns[0].cancels, 1)
  assert.equal(stops(c).length, 1)
  assert.equal(stops(c)[0].reason, 'timeout')
  assert(c.messages.some((m) => m.code === 'turn_timeout' && m.requestId === 'stall'))
  c.send({ type: 'query', text: 'next' })
  await flush()
  assert.equal(c.bridge.turns.length, 2)
  c.bridge.turns[0].result.resolve(completed)
  await flush()
  assert.equal(c.conn.describe().state, 'busy')
  c.bridge.turns[1].result.resolve(completed)
  await flush()
})

test('stalled TTS is stopped by the same whole-turn deadline', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  let signal: AbortSignal | undefined
  const pending = deferred<Response>()
  mockFetch(t, async (_url: any, init: any) => {
    signal = init.signal
    return pending.promise
  })
  const c = connection(t, replyingBridge(), { minimaxApiKey: 'mock', maxTurnSeconds: 15 })
  hello(c)
  c.send({ type: 'query', text: 'x' })
  await flush()
  t.mock.timers.tick(15000)
  await flush()
  assert.equal(signal?.aborted, true)
  assert.equal(stops(c)[0].reason, 'timeout')
  pending.reject(new Error('late network failure'))
  await flush()
  assert.equal(stops(c).length, 1)
})

// PCM and error outcomes.
test('TTS failure cannot be reported as a successful completed round', async (t) => {
  const c = connection(t, replyingBridge())
  hello(c)
  c.send({ type: 'query', text: 'hello' })
  await flush()
  assert(c.messages.some((m) => m.type === 'error' && m.code === 'no_api_key'))
  assert.equal(stops(c).length, 1)
  assert.equal(stops(c)[0].reason, 'error')
})

test('invalid ASR success response is a failure rather than empty recognition', async (t) => {
  mockFetch(t, async () => new Response('{}'))
  const c = connection(t, undefined, { minimaxApiKey: 'mock' })
  hello(c)
  c.send({ type: 'listen', state: 'start' })
  c.conn.handleBinary(Buffer.alloc(16000))
  c.send({ type: 'listen', state: 'stop' })
  await flush()
  assert(c.messages.some((m) => m.code === 'bad_asr_response'))
  assert.equal(stops(c)[0].reason, 'error')
  assert.equal(c.bridge.turns.length, 0)
})

test('model error produces a structured failure and releases state', async (t) => {
  const c = connection(t)
  hello(c)
  c.send({ type: 'query', text: 'x' })
  await flush()
  c.bridge.turns[0].result.resolve({ kind: 'error', error: 'credentials missing' })
  await flush()
  assert(c.messages.some((m) => m.code === 'llm_error' && m.message === 'credentials missing'))
  assert.equal(stops(c)[0].reason, 'error')
  assert.equal(c.conn.describe().state, 'ready')
})

test('35-second response drains completely instead of truncating at 30 seconds', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  const pcm = Buffer.alloc(48000 * 35, 1)
  mockFetch(t, async () => audioResponse([], pcm))
  const c = connection(t, replyingBridge(), { minimaxApiKey: 'mock' })
  hello(c)
  c.send({ type: 'query', text: 'long', requestId: 'long' })
  await flush()
  t.mock.timers.tick(30000)
  await flush()
  assert.equal(c.conn.describe().state, 'busy')
  assert.equal(stops(c).length, 0)
  t.mock.timers.tick(5080)
  await flush()
  assert.deepEqual(audio(c), pcm)
  assert.equal(stops(c)[0].reason, 'completed')
  assert.equal(stops(c)[0].requestId, 'long')
  assert.equal(c.messages.at(-1).state, 'stop')
})

test('arbitrary small/odd network chunks retain byte order and 40ms framing', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  const chunks = [Buffer.alloc(1, 1), Buffer.alloc(299, 2), Buffer.alloc(1620, 3)]
  mockFetch(t, async () => audioResponse(chunks))
  const c = connection(t, replyingBridge(), { minimaxApiKey: 'mock' })
  hello(c)
  c.send({ type: 'query', text: 'x' })
  await flush()
  t.mock.timers.tick(80)
  await flush()
  assert.deepEqual(audio(c), Buffer.concat(chunks))
  assert.equal(c.messages.filter(Buffer.isBuffer).length, 1)
  assert.equal(stops(c)[0].reason, 'completed')
})

test('slow socket pauses audio and resumes without losing data', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  const pcm = Buffer.alloc(1920, 1)
  mockFetch(t, async () => audioResponse([], pcm))
  const c = connection(t, replyingBridge(), { minimaxApiKey: 'mock' })
  c.socket.bufferedAmount = 300000
  hello(c)
  c.send({ type: 'query', text: 'x' })
  await flush()
  t.mock.timers.tick(1000)
  assert.equal(audio(c).length, 0)
  c.socket.bufferedAmount = 0
  t.mock.timers.tick(80)
  await flush()
  assert.deepEqual(audio(c), pcm)
  assert.equal(stops(c)[0].reason, 'completed')
})

test('abort discards queued PCM and never sends audio after terminal stop', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  mockFetch(t, async () => audioResponse([], Buffer.alloc(48000 * 10, 1)))
  const c = connection(t, replyingBridge(), { minimaxApiKey: 'mock' })
  hello(c)
  c.send({ type: 'query', text: 'x' })
  await flush()
  t.mock.timers.tick(400)
  c.send({ type: 'abort' })
  const length = c.messages.length
  t.mock.timers.tick(20000)
  await flush()
  assert.equal(c.messages.length, length)
  assert.equal(stops(c).length, 1)
  assert.equal(stops(c)[0].reason, 'aborted')
})

test('empty, malformed and prematurely closed TTS cannot produce completed', async (t) => {
  const invalid = [
    'data: {"data":{"status":2}}\n\n',
    'data: {not-json}\n\n',
    'data: {"data":{"status":2,"audio":"xx"}}\n\n',
    'data: {"data":{"status":1,"audio":"0102"}}\n\n',
  ]
  for (const stream of invalid) {
    mockFetch(t, async () => new Response(stream))
    const c = connection(t, replyingBridge(), { minimaxApiKey: 'mock' })
    hello(c)
    c.send({ type: 'query', text: 'x' })
    await flush()
    assert.equal(stops(c)[0].reason, 'error')
  }
})

test('TTS terminal recap deduplicates prefix and retains newly appended tail', async (t) => {
  mockFetch(t, async () => audioResponse([Buffer.from('01020304', 'hex')], Buffer.from('010203040506', 'hex'), false))
  const chunks = []
  for await (const chunk of synthesizeStream('x', { apiKey: 'mock' })) chunks.push(chunk)
  assert.equal(Buffer.concat(chunks).toString('hex'), '010203040506')
})

test('successful voice capture preserves WAV bytes and completes STT -> LLM -> PCM', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  const input = Buffer.alloc(16000, 7)
  const output = Buffer.alloc(1920, 3)
  let uploaded: Buffer | undefined
  mockFetch(t, async (url: string, options: any) => {
    if (url.includes('speech_to_text')) {
      uploaded = Buffer.from(await options.body.get('file').arrayBuffer())
      return new Response(JSON.stringify({ text: '你好' }))
    }
    return audioResponse([], output)
  })
  const c = connection(t, replyingBridge(), { minimaxApiKey: 'mock' })
  hello(c)
  c.send({ type: 'listen', state: 'start', requestId: 'voice' })
  c.conn.handleBinary(input.subarray(0, 333))
  c.conn.handleBinary(input.subarray(333))
  c.send({ type: 'listen', state: 'stop' })
  await flush()
  t.mock.timers.tick(80)
  await flush()
  assert.equal(uploaded?.subarray(0, 4).toString(), 'RIFF')
  assert.deepEqual(uploaded?.subarray(44), input)
  assert(c.messages.some((m) => m.type === 'stt' && m.text === '你好' && m.requestId === 'voice'))
  assert(c.messages.some((m) => m.type === 'llm' && m.state === 'delta'))
  assert.deepEqual(audio(c), output)
  assert.equal(stops(c)[0].reason, 'completed')
})

test('speak sends PCM and reports done without entering the agent', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  const pcm = Buffer.alloc(1920, 5)
  mockFetch(t, async () => audioResponse([], pcm))
  const c = connection(t, undefined, { minimaxApiKey: 'mock' })
  hello(c)
  c.send({ type: 'speak', text: 'announcement' })
  await flush()
  t.mock.timers.tick(80)
  await flush()
  assert.equal(c.bridge.turns.length, 0)
  assert.deepEqual(audio(c), pcm)
  assert.equal(stops(c)[0].reason, 'done')
})

test('audio buffering limit and socket send failure terminate with error', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  mockFetch(t, async () => audioResponse([], Buffer.alloc(48000 * 16)))
  const large = connection(t, replyingBridge(), { minimaxApiKey: 'mock', maxTurnSeconds: 15 })
  hello(large)
  large.send({ type: 'query', text: 'too much queued audio' })
  await flush()
  assert(large.messages.some((m) => m.code === 'audio_overflow'))
  assert.equal(stops(large)[0].reason, 'error')
  mockFetch(t, async () => audioResponse([], Buffer.alloc(1920)))
  const failed = connection(t, replyingBridge(), { minimaxApiKey: 'mock' })
  const originalSend = failed.socket.send.bind(failed.socket)
  failed.socket.send = (data) => {
    if (Buffer.isBuffer(data)) throw new Error('socket send failed')
    originalSend(data)
  }
  hello(failed)
  failed.send({ type: 'query', text: 'x' })
  await flush()
  t.mock.timers.tick(40)
  await flush()
  assert.equal(stops(failed)[0].reason, 'error')
})

// Actual AgentBridge: cancellation is prompt, but queue release waits for real idle.
function host() {
  const listeners = new Map<string, Set<any>>()
  const runs: any[] = []
  const agent = {
    session: { seq: 1 },
    aborts: 0,
    status: 'idle',
    followup(message: any) {
      runs.push({ message, idle: deferred() })
      this.status = 'busy'
    },
    whenIdle() {
      return runs.at(-1).idle.promise
    },
    abort() {
      this.aborts++
    },
  }
  let flushes = 0
  const services: any = {
    agents: { get: () => agent },
    sessions: {
      flush: async () => {
        flushes++
      },
    },
  }
  const ctx = {
    get: (name: string) => services[name],
    on(name: string, cb: any) {
      const set = listeners.get(name) ?? new Set()
      listeners.set(name, set)
      set.add(cb)
      return () => set.delete(cb)
    },
  }
  const emit = (text: string) => {
    for (const cb of listeners.get('agent/assistant-stream') ?? [])
      cb({ agent, frame: { chunk: { type: 'text-delta', text } } })
  }
  const bridge = new AgentBridge(ctx)
  return { agent, runs, bridge, listeners, emit, flushes: () => flushes }
}

test('cancel resolves immediately; next request waits for actual idle and receives no old delta', async () => {
  const h = host()
  const a: string[] = [],
    b: string[] = []
  const first = await h.bridge.turn('same', 'first', { onTextDelta: (text) => a.push(text), onEnd() {} })
  h.emit('first response')
  first.cancel()
  assert.equal((await first.done).kind, 'cancelled')
  assert.equal(h.agent.aborts, 1)
  const next = h.bridge.turn('same', 'second', { onTextDelta: (text) => b.push(text), onEnd() {} })
  await flush()
  h.emit('old late text')
  assert.equal(h.runs.length, 1)
  assert.deepEqual(b, [])
  h.runs[0].idle.resolve(undefined)
  const second = await next
  h.emit('second response')
  assert.deepEqual(a, ['first response'])
  assert.deepEqual(b, ['second response'])
  h.runs[1].idle.resolve(undefined)
  assert.equal((await second.done).kind, 'completed')
  assert.equal(h.flushes(), 2)
  assert.equal(h.listeners.get('agent/assistant-stream')?.size, 0)
})

test('cancelling a queued turn cannot let a third turn jump ahead of active work', async () => {
  const h = host()
  const callbacks = { onTextDelta() {}, onEnd() {} }
  const first = await h.bridge.turn('same', 'first', callbacks)
  const controller = new AbortController()
  const second = h.bridge.turn('same', 'second', callbacks, '', controller.signal)
  controller.abort()
  await assert.rejects(second)
  const third = h.bridge.turn('same', 'third', callbacks)
  await flush()
  assert.equal(h.runs.length, 1)
  h.runs[0].idle.resolve(undefined)
  await first.done
  const last = await third
  assert.equal(h.runs.length, 2)
  assert.equal(h.runs[1].message.content[0].text, 'third')
  h.runs[1].idle.resolve(undefined)
  await last.done
})

test('abort during agent creation never submits a followup', async () => {
  const creation = deferred()
  let submitted = 0
  const services: any = {
    agents: { create: () => creation.promise },
    sessions: { flush: async () => {} },
  }
  const bridge = new AgentBridge({ get: (key: string) => services[key], on: () => () => {} })
  const controller = new AbortController()
  const turn = bridge.turn('new', 'x', { onTextDelta() {}, onEnd() {} }, '', controller.signal)
  await flush()
  controller.abort()
  creation.resolve({
    session: { seq: 1 },
    followup() {
      submitted++
    },
    whenIdle: async () => {},
  })
  await assert.rejects(turn)
  assert.equal(submitted, 0)
})

test('sessionId reflects preset/adoption and voice prefix applies consistently per turn', async () => {
  const h = host()
  assert.equal(h.bridge.sessionIdFor('test', 'helper'), 'voice-test-p-helper')
  const callbacks = { onTextDelta() {}, onEnd() {} }
  for (const text of ['first', 'second']) {
    const turn = await h.bridge.turn('same', text, callbacks, '', undefined, 'Be concise.')
    assert.equal(h.runs.at(-1).message.content[0].text, `Be concise.\n\n用户说：${text}`)
    h.runs.at(-1).idle.resolve(undefined)
    await turn.done
  }
})

// Real HTTP/WS server: newest duplicate connection takes over and old close cannot evict it.
test('real WS duplicate device takeover cancels old turn and leaves replacement registered', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'yusheng-ws-test-'))
  const bridge: any = { ...controlledBridge(), currentModel: () => undefined, listPresets: async () => [] }
  const server = new VoiceServer(
    new SettingsStore(join(dir, 'settings.json')),
    bridge,
    { host: '127.0.0.1', port: 0 },
    () => {},
  )
  await server.start()
  const port = (server as any).httpServer.address().port
  const sockets: WebSocket[] = []
  t.after(() => {
    for (const ws of sockets) ws.close()
    server.stop()
    rmSync(dir, { recursive: true, force: true })
  })
  async function connect() {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/voice`)
    const messages: any[] = []
    ws.addEventListener('message', (event) => {
      if (typeof event.data === 'string') messages.push(JSON.parse(event.data))
    })
    sockets.push(ws)
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener('open', () => resolve(), { once: true })
      ws.addEventListener('error', reject, { once: true })
    })
    ws.send(JSON.stringify({ type: 'hello', version: 1, deviceId: 'shared' }))
    return { ws, messages }
  }
  async function until(predicate: () => boolean) {
    const deadline = Date.now() + 3000
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error('WS condition timeout')
      await new Promise((r) => setTimeout(r, 5))
    }
  }
  const first = await connect()
  await until(() => first.messages.some((m) => m.type === 'welcome'))
  first.ws.send(JSON.stringify({ type: 'query', text: 'first' }))
  await until(() => bridge.turns.length === 1)
  const replacement = await connect()
  await until(() => replacement.messages.some((m) => m.type === 'welcome') && first.ws.readyState === 3)
  assert(first.messages.some((m) => m.code === 'device_replaced'))
  assert.equal(bridge.turns[0].signal.aborted, true)
  assert.equal((server as any).devices.size, 1)
  const status = (await (await fetch(`http://127.0.0.1:${port}/status`)).json()) as any
  assert.equal(status.clients.length, 1)
  const malformed = await fetch(`http://127.0.0.1:${port}/settings`, { method: 'PUT', body: 'null' })
  assert.equal(malformed.status, 400)
  replacement.ws.send(JSON.stringify({ type: 'ping', time: 123 }))
  await until(() => replacement.messages.some((m) => m.type === 'pong' && m.time === 123))
  bridge.turns[0].result.resolve(completed)
})

test(
  'CLI consumes a real WS round, saves exact PCM, and exits nonzero on TTS failure',
  { timeout: 5000 },
  async (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'yusheng-cli-test-'))
    const store = new SettingsStore(join(dir, 'settings.json'))
    store.update({ minimaxApiKey: 'mock' })
    const bridge: any = { ...replyingBridge(), currentModel: () => undefined, listPresets: async () => [] }
    const server = new VoiceServer(store, bridge, { host: '127.0.0.1', port: 0 }, () => {})
    await server.start()
    t.after(() => {
      server.stop()
      rmSync(dir, { recursive: true, force: true })
    })
    const port = (server as any).httpServer.address().port
    const pcm = Buffer.alloc(1920, 6)
    mockFetch(t, async () => audioResponse([], pcm))
    const run = () =>
      new Promise<{ code: number | null; output: string }>((resolve, reject) => {
        const child = spawn(
          process.execPath,
          [join(process.cwd(), 'tools/test-client.mjs'), `ws://127.0.0.1:${port}/voice`, 'speak', 'test'],
          { cwd: dir },
        )
        t.after(() => child.kill())
        let output = ''
        child.stdout.on('data', (data) => {
          output += data
        })
        child.stderr.on('data', (data) => {
          output += data
        })
        child.once('error', reject)
        child.once('close', (code) => resolve({ code, output }))
      })
    const success = await run()
    assert.equal(success.code, 0, success.output)
    const files = readdirSync(dir).filter((file) => file.endsWith('.pcm'))
    assert.equal(files.length, 1)
    assert.deepEqual(readFileSync(join(dir, files[0])), pcm)
    store.update({ minimaxApiKey: '' })
    const failure = await run()
    assert.equal(failure.code, 1, failure.output)
    assert(failure.output.includes('no_api_key'))
  },
)
