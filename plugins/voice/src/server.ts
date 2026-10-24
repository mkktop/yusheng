// 语音服务：自带端口的 HTTP（设置/状态/自检 REST）+ WebSocket（/voice 协议）。
// 独立于 dsh web 的 3080 端口，令牌鉴权 + CORS（供右侧栏设置面板跨源调用）。

import { Buffer } from 'node:buffer'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import { AgentBridge } from './llm.js'
import { VoiceConnection, PROTOCOL_VERSION } from './connection.js'
import { maskSettings, type SettingsStore } from './settings.js'
import { transcribePcm, AsrError } from './asr.js'
import { synthesizeStream, TtsError, TTS_SAMPLE_RATE } from './tts.js'

const VERSION = '0.1.0'
const BODY_LIMIT = 32 * 1024
const WS_PATH = '/voice'

export interface ServerConfig {
  host: string
  port: number
}

export class VoiceServer {
  private store: SettingsStore
  private bridge: AgentBridge
  private config: ServerConfig
  private log: (level: 'info' | 'warn', message: string) => void
  private httpServer: ReturnType<typeof createServer> | undefined
  private wss: WebSocketServer | undefined
  private connections = new Set<VoiceConnection>()
  private startedAt = 0

  constructor(store: SettingsStore, bridge: AgentBridge, config: ServerConfig, log: (level: 'info' | 'warn', message: string) => void) {
    this.store = store
    this.bridge = bridge
    this.config = config
    this.log = log
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const httpServer = createServer((req, res) => this.handleRest(req, res))
      const wss = new WebSocketServer({ noServer: true })

      httpServer.on('upgrade', (req, socket, head) => {
        const url = parseUrl(req)
        if (url?.pathname !== WS_PATH) {
          socket.destroy()
          return
        }
        if (!this.authorize(url)) {
          socket.write('HTTP/1.1 401 Unauthorized\r\nconnection: close\r\n\r\n')
          socket.destroy()
          return
        }
        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit('connection', ws, req)
        })
      })

      wss.on('connection', (ws: WebSocket) => {
        const connection = new VoiceConnection(ws as unknown as { readyState: number; send(data: never): void; close(code: number, reason: string): void }, {
          settings: () => this.store.get(),
          bridge: this.bridge,
          log: this.log,
        })
        this.connections.add(connection)
        ws.on('message', (data: Buffer, isBinary: boolean) => {
          if (isBinary) {
            connection.handleBinary(data)
          } else {
            connection.handleMessage(data.toString('utf8'))
          }
        })
        ws.on('close', () => {
          this.connections.delete(connection)
          connection.handleClosed()
        })
        ws.on('error', () => {
          /* close 会随后触发 */
        })
      })

      httpServer.once('error', reject)
      httpServer.listen(this.config.port, this.config.host, () => {
        this.httpServer = httpServer
        this.wss = wss
        this.startedAt = Date.now()
        const tokenState = this.store.get().token === '' ? 'OPEN (token 未配置)' : 'token'
        this.log('info', `listening on ws://${this.config.host}:${this.config.port}${WS_PATH} (${tokenState})`)
        resolve()
      })
    })
  }

  stop() {
    for (const connection of this.connections) connection.handleClosed()
    this.connections.clear()
    this.wss?.close()
    this.httpServer?.close()
    this.wss = undefined
    this.httpServer = undefined
  }

  private authorize(url: URL): boolean {
    const token = this.store.get().token
    if (token === '') return true // 引导模式：面板会提示生成令牌
    const provided = url.searchParams.get('token') ?? ''
    return provided === token
  }

  // ---- REST ----

  private static applyCors(req: IncomingMessage, res: ServerResponse) {
    const origin = req.headers.origin
    if (typeof origin === 'string' && origin !== '') res.setHeader('access-control-allow-origin', origin)
    res.setHeader('access-control-allow-methods', 'GET, POST, PUT, OPTIONS')
    res.setHeader('access-control-allow-headers', 'content-type, x-voice-token')
    res.setHeader('access-control-max-age', '600')
  }

  private tokenOf(req: IncomingMessage, url: URL): string {
    return (req.headers['x-voice-token'] as string | undefined) ?? url.searchParams.get('token') ?? ''
  }

  private handleRest(req: IncomingMessage, res: ServerResponse) {
    VoiceServer.applyCors(req, res)
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }
    const url = parseUrl(req)
    if (url === undefined) {
      res.writeHead(400).end()
      return
    }
    const token = this.store.get().token
    if (token !== '' && this.tokenOf(req, url) !== token) {
      json(res, 401, { ok: false, error: 'unauthorized', message: '令牌不正确（面板右上可见当前令牌）' })
      return
    }
    const route = `${req.method} ${url.pathname}`
    switch (route) {
      case 'GET /status':
        this.handleStatus(res)
        return
      case 'GET /settings':
        json(res, 200, { ok: true, settings: maskSettings(this.store.get()) })
        return
      case 'PUT /settings':
        void this.handlePutSettings(req, res)
        return
      case 'POST /token':
        json(res, 200, { ok: true, token: this.store.regenerateToken() })
        return
      case 'POST /test/asr':
        void this.handleTestAsr(res)
        return
      case 'POST /test/tts':
        void this.handleTestTts(res)
        return
      case 'POST /test/llm':
        void this.handleTestLlm(res)
        return
      default:
        json(res, 404, { ok: false, error: 'not_found' })
    }
  }

  private handleStatus(res: ServerResponse) {
    const settings = this.store.get()
    const model = this.bridge.currentModel()
    json(res, 200, {
      ok: true,
      service: 'dsh-yusheng-voice',
      version: VERSION,
      protocol: PROTOCOL_VERSION,
      endpoint: `ws://${this.config.host}:${this.config.port}${WS_PATH}`,
      uptimeSec: Math.round((Date.now() - this.startedAt) / 1000),
      tokenConfigured: settings.token !== '',
      model,
      hasMinimaxApiKey: settings.minimaxApiKey !== '',
      hasMinimaxGroupId: settings.minimaxGroupId !== '',
      clients: [...this.connections].map((c) => c.describe()),
      settings: maskSettings(settings),
    })
  }

  private async handlePutSettings(req: IncomingMessage, res: ServerResponse) {
    const body = await readBody(req)
    if (body === null) {
      json(res, 413, { ok: false, error: 'too_large' })
      return
    }
    let patch: Record<string, unknown>
    try {
      patch = JSON.parse(body === '' ? '{}' : body)
    } catch {
      json(res, 400, { ok: false, error: 'bad_json' })
      return
    }
    const { settings, rejected } = this.store.update(patch)
    this.log('info', `settings updated${rejected.length > 0 ? ` (rejected: ${rejected.join(', ')})` : ''}`)
    json(res, 200, { ok: true, rejected, settings: maskSettings(settings) })
  }

  /** 1 秒静音 WAV 走一遍真实 ASR 调用验证凭据与连通性。 */
  private async handleTestAsr(res: ServerResponse) {
    const settings = this.store.get()
    const started = Date.now()
    const silence = Buffer.alloc(TTS_SAMPLE_RATE * 2, 0) // 任意内容即可验证凭据
    try {
      const text = await transcribePcm(silence.subarray(0, 16000 * 2), { apiKey: settings.minimaxApiKey, model: settings.asrModel })
      json(res, 200, { ok: true, durationMs: Date.now() - started, note: 'ASR 调用成功', text })
    } catch (error) {
      const code = error instanceof AsrError ? error.code : 'asr_failed'
      const message = error instanceof Error ? error.message : String(error)
      json(res, 200, { ok: false, durationMs: Date.now() - started, code, message })
    }
  }

  /** 合成「你好」验证 TTS 凭据与连通性（不回传音频）。 */
  private async handleTestTts(res: ServerResponse) {
    const settings = this.store.get()
    const started = Date.now()
    let bytes = 0
    try {
      for await (const chunk of synthesizeStream('你好。', {
        apiKey: settings.minimaxApiKey,
        groupId: settings.minimaxGroupId,
        model: settings.ttsModel,
        voiceId: settings.ttsVoice,
        speed: settings.ttsSpeed,
        vol: settings.ttsVol,
        pitch: settings.ttsPitch,
        signal: AbortSignal.timeout(20_000),
      })) {
        bytes += chunk.length
      }
      json(res, 200, { ok: bytes > 0, durationMs: Date.now() - started, bytes, message: bytes > 0 ? 'TTS 合成成功' : '未收到音频数据' })
    } catch (error) {
      const code = error instanceof TtsError ? error.code : 'tts_failed'
      const message = error instanceof Error ? error.message : String(error)
      json(res, 200, { ok: false, durationMs: Date.now() - started, code, message })
    }
  }

  /** 复用固定自检会话跑一轮「回复 OK」，验证 dsh 会话链路与模型凭据。 */
  private async handleTestLlm(res: ServerResponse) {
    const started = Date.now()
    let gotDelta = false
    try {
      const turn = await this.bridge.turn('selftest', 'Reply with exactly: OK', {
        onTextDelta: () => {
          gotDelta = true
        },
        onEnd: () => undefined,
      })
      const outcome = await turn.done
      json(res, 200, {
        ok: outcome.kind === 'completed',
        durationMs: Date.now() - started,
        kind: outcome.kind,
        gotDelta,
        error: outcome.error,
        message: outcome.kind === 'completed' ? 'dsh 会话调用成功' : (outcome.error ?? outcome.kind),
      })
    } catch (error) {
      json(res, 200, {
        ok: false,
        durationMs: Date.now() - started,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }
}

function parseUrl(req: IncomingMessage): URL | undefined {
  const raw = req.url
  if (typeof raw !== 'string') return undefined
  const host = typeof req.headers.host === 'string' ? req.headers.host : 'localhost'
  try {
    return new URL(raw, `http://${host}`)
  } catch {
    return undefined
  }
}

function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    let size = 0
    let settled = false
    const finish = (value: string | null) => {
      if (!settled) {
        settled = true
        resolve(value)
      }
    }
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > BODY_LIMIT) {
        req.destroy()
        finish(null)
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => finish(Buffer.concat(chunks).toString('utf8')))
    req.on('error', () => finish(null))
  })
}

function json(res: ServerResponse, status: number, payload: unknown) {
  const body = JSON.stringify(payload)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(body)
}
