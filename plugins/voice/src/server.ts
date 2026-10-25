// 语音服务：自带端口的 HTTP（设置/状态/自检 REST）+ WebSocket（/voice 协议）。
// 独立于 dsh web 的 3080 端口，令牌鉴权 + CORS（供右侧栏设置面板跨源调用）。

import { Buffer } from 'node:buffer'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { WebSocketServer, type WebSocket } from 'ws'
import { AgentBridge } from './llm.js'
import { VoiceConnection, PROTOCOL_VERSION } from './connection.js'
import { maskSettings, type SettingsStore } from './settings.js'
import { transcribePcm, AsrError } from './asr.js'
import { synthesizeStream, TtsError, TTS_SAMPLE_RATE } from './tts.js'
import { identifier, SUPPORTED_VERSIONS } from './protocol.js'
import { SurfaceStore } from './surface.js'
import { ClientStore } from './clients.js'
import { VoiceError } from './protocol.js'
import type { MemoryAccess } from './client-memory.js'

const VERSION = '0.6.0'
const BODY_LIMIT = 32 * 1024
const WS_PATH = '/voice'

export interface ServerConfig {
  host: string
  port: number
  assetsRoot?:string
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
  private heartbeat?: ReturnType<typeof setInterval>
  private identities = new Map<VoiceConnection, { token: string; deviceId?: string; legacy?:boolean }>()
  private devices = new Map<string, VoiceConnection>()
  private conversationOwners: Record<string, string> = Object.create(null)
  private ownersPath: string
  private surface:SurfaceStore
  private clientStore:ClientStore
  private clientSurfaces=new Map<string,SurfaceStore>()
  private presetsCache: { at: number; value: Array<{ id: string; name?: string; isDefault: boolean; broken?: boolean }> | undefined } = { at: 0, value: undefined }

  constructor(store: SettingsStore, bridge: AgentBridge, config: ServerConfig, log: (level: 'info' | 'warn', message: string) => void) {
    this.store = store
    this.bridge = bridge
    this.config = config
    this.log = log
    this.ownersPath = resolve(dirname(store.path), 'conversations.json')
    this.surface = new SurfaceStore(resolve(dirname(store.path),'ui.json'))
    if (existsSync(this.ownersPath)) {
      const raw = JSON.parse(readFileSync(this.ownersPath, 'utf8'))
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid conversation registry')
      this.conversationOwners = Object.assign(Object.create(null), raw)
    }
    this.clientStore=new ClientStore(resolve(dirname(store.path),'clients'),()=>store.get(),()=>bridge.currentModel())
    this.bridge.configureLegacyOwner?.(conversation=>this.conversationOwners[conversation])
    for(const id of [...Object.keys(store.get().deviceTokens),store.get().legacyDeviceId].filter(Boolean))this.ensureClient(id)
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const httpServer = createServer((req, res) => { void this.handleRest(req, res).catch(e => { this.log('warn', `REST failed: ${e instanceof Error ? e.message : String(e)}`); if (!res.headersSent) json(res, 500, { ok: false, error: 'internal_error' }); else res.end() }) })
      const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024, perMessageDeflate: false })
      this.httpServer = httpServer; this.wss = wss
      httpServer.requestTimeout = 15_000; httpServer.headersTimeout = 15_000

      httpServer.on('upgrade', (req, socket, head) => {
        const url = parseUrl(req)
        if (url?.pathname !== WS_PATH) {
          socket.destroy()
          return
        }
        if (!this.authorize(url) || !this.originAllowed(req) || this.connections.size >= 64) {
          socket.write('HTTP/1.1 401 Unauthorized\r\nconnection: close\r\n\r\n')
          socket.destroy()
          return
        }
        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit('connection', ws, req)
        })
      })

      const alive = new WeakSet<WebSocket>()
      wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
        // The upgrade URL is rechecked against current settings on every application message.
        const connection = new VoiceConnection(ws, {
          settings: id => id?this.clientStore.settings(id):this.store.get(),
          bridge: this.bridge,
          surface: this.surface,
          log: this.log,
          claimDevice: deviceId => {
            const identity = this.identities.get(connection)
            if (!identity || (identity.deviceId && identity.deviceId !== deviceId) || this.devices.has(deviceId) || !this.claimConversation(deviceId, deviceId)) return false
            if(identity.legacy){if(!this.store.claimLegacy(deviceId))return false;identity.deviceId=deviceId}
            this.ensureClient(deviceId)
            this.devices.set(deviceId, connection); return true
          },
          allowConversation: (deviceId, conversationId) => this.claimConversation(deviceId, conversationId),
          scope:(deviceId,conversationId,preset)=>this.scopeFor(deviceId,conversationId,preset),
          memory:(deviceId,conversationId,turnId)=>this.memoryFor(deviceId,conversationId,turnId),
          epoch:deviceId=>this.clientStore.contextEpoch(deviceId),
          surfaceForDevice:deviceId=>{
            let surface=this.clientSurfaces.get(deviceId)
            if(!surface){const path=join(this.clientStore.directory(deviceId),'ui.json');surface=this.clientStore.profile(deviceId).legacyHistory?this.surface.migrateClient(deviceId,path):new SurfaceStore(path);this.clientSurfaces.set(deviceId,surface)}
            return surface
          },
          onSession:(id,conversation,preset,session,epoch)=>this.clientStore.touch(id,conversation,preset,session,epoch),
        })
        this.connections.add(connection)
        this.identities.set(connection, this.authorize(parseUrl(req)!)!)
        alive.add(ws)
        const helloTimer = setTimeout(() => { if (connection.describe().state === 'init') connection.close(1008, 'hello timeout') }, 10_000)
        ws.on('pong', () => alive.add(ws))
        ws.on('message', (data: Buffer, isBinary: boolean) => {
          const identity = this.identities.get(connection)
          if (!identity || !this.validIdentity(identity)) { connection.close(1008, 'credential revoked'); return }
          if (isBinary) {
            connection.handleBinary(data)
          } else {
            connection.handleMessage(data.toString('utf8'))
          }
        })
        ws.on('close', () => {
          this.connections.delete(connection)
          clearTimeout(helloTimer)
          this.identities.delete(connection)
          if (this.devices.get(connection.deviceId) === connection) this.devices.delete(connection.deviceId)
          connection.handleClosed()
        })
        ws.on('error', () => {
          /* close 会随后触发 */
        })
      })

      this.heartbeat = setInterval(() => {
        for (const ws of wss.clients) {
          if (!alive.has(ws)) { ws.terminate(); continue }
          alive.delete(ws); ws.ping()
        }
      }, 30_000)
      this.heartbeat.unref()

      httpServer.once('error', reject)
      httpServer.listen(this.config.port, this.config.host, () => {
        this.httpServer = httpServer
        this.wss = wss
        this.startedAt = Date.now()
        const tokenState = this.store.get().token === '' ? 'registered devices only' : 'device token'
        this.log('info', `listening on ws://${this.config.host}:${this.config.port}${WS_PATH} (${tokenState})`)
        resolve()
      })
    })
  }

  stop() {
    clearInterval(this.heartbeat)
    for (const connection of this.connections) connection.close()
    for (const ws of this.wss?.clients ?? []) ws.terminate()
    this.connections.clear()
    this.wss?.close()
    this.httpServer?.close()
    this.wss = undefined
    this.httpServer = undefined
  }

  /** Only the authenticated dsh owner route calls this; the admin credential stays server-side. */
  async managementRequest(path: string, method: string, body?: unknown, signal?: AbortSignal): Promise<Response> {
    const address = this.httpServer?.address()
    if (!address || typeof address === 'string') throw new Error('voice listener unavailable')
    const host = address.address === '0.0.0.0' ? '127.0.0.1' : address.address === '::' ? '::1' : address.address
    const base = `http://${host.includes(':') ? `[${host}]` : host}:${address.port}`
    const response = await fetch(base + path, {
      method, headers: { 'content-type': 'application/json', 'x-voice-token': this.store.get().adminToken },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(65000)]) : AbortSignal.timeout(65000),
    })
    return new Response(await response.text(), { status: response.status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } })
  }

  private authorize(url: URL): { token: string; deviceId?: string; legacy?:boolean } | undefined {
    const settings = this.store.get()
    const provided = url.searchParams.get('token') ?? ''
    if (secureEqual(provided, settings.token)) return { token: provided, legacy:true, ...(settings.legacyDeviceId?{deviceId:settings.legacyDeviceId}:{}) }
    for (const [deviceId, token] of Object.entries(settings.deviceTokens)) if (secureEqual(provided, token)) return { token: provided, deviceId }
    return undefined
  }

  private validIdentity(identity: { token: string; deviceId?: string; legacy?:boolean }): boolean {
    const settings = this.store.get()
    return identity.legacy?secureEqual(identity.token,settings.token)&&(!identity.deviceId||identity.deviceId===settings.legacyDeviceId):secureEqual(identity.token, identity.deviceId ? settings.deviceTokens[identity.deviceId] : '')
  }

  private originAllowed(req: IncomingMessage): boolean {
    const origin = req.headers.origin
    if (!origin) return true
    const allowed = this.store.get().allowedOrigins
    if (allowed.length) return allowed.includes(origin)
    try { return new URL(origin).hostname === new URL(`http://${req.headers.host}`).hostname && /^https?:/.test(origin) } catch { return false }
  }

  private claimConversation(deviceId: string, conversationId: string): boolean {
    return identifier(deviceId,48)&&identifier(conversationId)
  }
  private ensureClient(id:string,label='') {return this.clientStore.ensure(id,label,Object.values(this.conversationOwners).includes(id))}
  private memoryFor(id:string,conversationId?:string,turnId?:string):MemoryAccess {
    let epoch=this.clientStore.contextEpoch(id)
    const source={actor:'assistant' as const,conversationId,turnId}
    const guard=()=>{if(epoch!==this.clientStore.contextEpoch(id))throw new VoiceError('memory_context_changed','记忆上下文已更新，请在下一轮再修改记忆，避免恢复旧内容')}
    return {
      policy:this.clientStore.settings(id).memoryPolicy,
      read:()=>this.clientStore.memory(id),recall:(query,limit)=>this.clientStore.recall(id,query,limit),
      remember:(text,options)=>{guard();if(this.clientStore.settings(id).memoryPolicy==='off')throw new VoiceError('memory_disabled','此客户端已关闭新增记忆');return this.clientStore.remember(id,text,options,source)},
      forget:item=>{guard();return this.clientStore.forget(id,item,undefined,source)},
      observe:text=>{const result=this.clientStore.observe(id,text,conversationId!,turnId!);epoch=this.clientStore.contextEpoch(id);return result},
      record:episode=>this.clientStore.record(id,episode),
    }
  }
  private scopeFor(id:string,conversation:string,_preset:string,diagnostic=false) {
    const p=this.clientStore.profile(id),conversationKey=diagnostic?'diagnostic:'+conversation:conversation
    const options={cwd:join(this.clientStore.directory(id),'workspace'),indexPath:join(this.clientStore.directory(id),'sessions.json'),model:{provider:p.config.llmProvider,model:p.config.llmModel},legacy:!diagnostic&&p.legacyHistory}
    return this.bridge.clientScope?.(id,conversationKey,this.clientStore.contextEpoch(id),options)??'c-'+createHash('sha256').update(JSON.stringify([id,conversationKey,this.clientStore.contextEpoch(id)])).digest('hex').slice(0,48)
  }

  // ---- REST ----

  private static applyCors(req: IncomingMessage, res: ServerResponse) {
    const origin = req.headers.origin
    if (typeof origin === 'string' && origin !== '') res.setHeader('access-control-allow-origin', origin)
    res.setHeader('access-control-allow-methods', 'GET, POST, PUT, DELETE, OPTIONS')
    res.setHeader('vary', 'Origin')
    res.setHeader('access-control-allow-headers', 'content-type, x-voice-token')
    res.setHeader('access-control-max-age', '600')
  }

  private tokenOf(req: IncomingMessage, url: URL): string {
    const header = req.headers['x-voice-token']
    return (typeof header === 'string' ? header : undefined) ?? url.searchParams.get('token') ?? ''
  }

  private async handleRest(req: IncomingMessage, res: ServerResponse) {
    if (!this.originAllowed(req)) { json(res, 403, { ok: false, error: 'origin_denied' }); return }
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
    const assets:Record<string,[string,string]>={'/demo':['examples/avatar-client.html','text/html; charset=utf-8'],'/demo-client.js':['lib/demo-client.js','text/javascript; charset=utf-8'],'/voice-client.js':['lib/voice-client.js','text/javascript; charset=utf-8']}
    if(req.method==='GET'&&Object.hasOwn(assets,url.pathname)) {
      const [path,type]=assets[url.pathname]
      res.writeHead(200,{'content-type':type,'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"})
      res.end(readFileSync(resolve(this.config.assetsRoot??fileURLToPath(new URL('..',import.meta.url)),path)));return
    }
    const token = this.store.get().adminToken
    if (!secureEqual(this.tokenOf(req, url), token)) {
      json(res, 401, { ok: false, error: 'unauthorized', message: '请填写服务器 settings.json 中的 adminToken；设备令牌不具备管理权限' })
      return
    }
    const route = `${req.method} ${url.pathname}`
    if(url.pathname==='/clients'||url.pathname.startsWith('/clients/')){await this.handleClientRoute(req,res,url);return}
    switch (route) {
      case 'GET /status':
        this.refreshPresets()
        this.handleStatus(res)
        return
      case 'GET /settings':
        json(res, 200, { ok: true, scope:'new-client-template', settings: maskSettings(this.store.get()) })
        return
      case 'PUT /settings':
        await this.handlePutSettings(req, res)
        return
      case 'POST /token':
        json(res, 200, { ok: true, token: this.store.regenerateToken() })
        this.closeRevoked()
        return
      case 'POST /devices': {
        const body = await readBody(req)
        if (body === null) { json(res, 413, { ok: false, error: 'too_large' }); return }
        let patch: any
        try { patch = JSON.parse(body) } catch { json(res, 400, { ok: false, error: 'bad_json' }); return }
        if (!identifier(patch?.deviceId, 48)) { json(res, 400, { ok: false, error: 'bad_device_id' }); return }
        if(patch.label!==undefined&&(typeof patch.label!=='string'||patch.label.length>64)){json(res,400,{ok:false,error:'bad_label'});return}
        this.ensureClient(patch.deviceId,patch.label)
        const deviceToken = this.store.issueDevice(patch.deviceId)
        this.closeRevoked(); json(res, 200, { ok: true, deviceId: patch.deviceId, token: deviceToken }); return
      }
      case 'POST /test/asr':
        await this.handleTestAsr(res)
        return
      case 'POST /test/tts':
        await this.handleTestTts(res)
        return
      case 'POST /test/llm':
        await this.handleTestLlm(res)
        return
      default:
        if (req.method === 'DELETE' && url.pathname.startsWith('/devices/')) {
          this.store.revokeDevice(decodeURIComponent(url.pathname.slice('/devices/'.length))); this.closeRevoked()
          json(res, 200, { ok: true }); return
        }
        json(res, 404, { ok: false, error: 'not_found' })
    }
  }

  private handleStatus(res: ServerResponse) {
    const settings = this.store.get()
    const model = this.bridge.currentModel()
    const presets = this.presetsCache.value
    const address = this.httpServer?.address()
    const port = address && typeof address !== 'string' ? address.port : this.config.port
    json(res, 200, {
      ok: true,
      service: 'dsh-yusheng-voice',
      version: VERSION,
      protocol: PROTOCOL_VERSION,
      supportedProtocols: SUPPORTED_VERSIONS,
      endpoint: `ws://${this.config.host.includes(':') ? `[${this.config.host}]` : this.config.host}:${port}${WS_PATH}`,
      uptimeSec: Math.round((Date.now() - this.startedAt) / 1000),
      tokenConfigured: settings.token !== '',
      model,
      presets,
      hasMinimaxApiKey: settings.minimaxApiKey !== '',
      clients: [...this.connections].map((c) => c.describe()),
      settings: maskSettings(settings),
      clientProfiles:this.clientStore.list(),
      isolation:'client',
    })
  }

  /** 预设列表短暂缓存：compositionInventory 含逐项诊断，不宜每次状态轮询都跑。 */
  private refreshPresets() {
    if (Date.now() - this.presetsCache.at < 10_000 && this.presetsCache.value !== undefined) return
    this.presetsCache.at = Date.now()
    void this.bridge.listPresets().then((value) => {
      if (value !== undefined) this.presetsCache.value = value
    }).catch(() => undefined)
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
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('invalid object')
    } catch {
      json(res, 400, { ok: false, error: 'bad_json' })
      return
    }
    const { settings, rejected } = this.store.update(patch)
    this.closeRevoked()
    this.log('info', `settings updated${rejected.length > 0 ? ` (rejected: ${rejected.join(', ')})` : ''}`)
    json(res, 200, { ok: true, rejected, settings: maskSettings(settings) })
  }

  /** 1 秒静音 WAV 走一遍真实 ASR 调用验证凭据与连通性。 */
  private async handleTestAsr(res: ServerResponse,settings = this.store.get()) {
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
  private async handleTestTts(res: ServerResponse,settings = this.store.get()) {
    const started = Date.now()
    let bytes = 0
    try {
      for await (const chunk of synthesizeStream('你好。', {
        apiKey: settings.minimaxApiKey,
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
  private async handleTestLlm(res: ServerResponse,settings=this.store.get(),scope='selftest') {
    const started = Date.now()
    let gotDelta = false
    try {
      const turn = await this.bridge.turn(scope, 'Reply with exactly: OK', {
        onTextDelta: () => {
          gotDelta = true
        },
        onEnd: () => undefined,
      }, settings.agentPreset, { signal: AbortSignal.timeout(30_000), persona: settings, promptPrefix: settings.promptPrefix })
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

  private async handleClientRoute(req:IncomingMessage,res:ServerResponse,url:URL) {
    try {
      if(url.pathname==='/clients'&&req.method==='GET'){json(res,200,{ok:true,clients:this.clientStore.list().map(c=>({...c,credentialConfigured:Object.hasOwn(this.store.get().deviceTokens,c.deviceId)||(!!this.store.get().token&&this.store.get().legacyDeviceId===c.deviceId)}))});return}
      const match=/^\/clients\/([A-Za-z0-9_-]{1,48})(?:\/(settings|memory|conversations|context\/(?:reset|restore)|test\/(?:asr|tts|llm)))?$/.exec(url.pathname)
      if(!match||!this.clientStore.exists(match[1])){json(res,404,{ok:false,error:'client_not_found',message:'客户端不存在，请先创建客户端'});return}
      const [,id,resource]=match,settings=this.clientStore.settings(id)
      if(req.method==='POST'&&resource==='memory'){
        const body=await readBody(req);if(body===null){json(res,413,{ok:false,error:'too_large'});return}
        let data:any;try{data=JSON.parse(body)}catch{throw new VoiceError('bad_json','请求不是合法 JSON')}
        if(!data||typeof data!=='object'||Array.isArray(data))throw new VoiceError('bad_memory','记忆操作格式不正确')
        const {operation,revision,...input}=data
        const allowed=operation==='upsert'?['text','id','key','kind','importance','expiresAt']:operation==='forget'?['id']:operation==='search'?['query','limit']:operation==='clear'?[]:undefined
        if(!allowed||Object.keys(input).some(key=>!allowed.includes(key)))throw new VoiceError('bad_memory','记忆操作参数不正确')
        if(operation==='search'){
          if(typeof input.query!=='string'||input.query.length>4000||input.limit!==undefined&&(!Number.isInteger(input.limit)||input.limit<1||input.limit>32))throw new VoiceError('bad_memory','检索参数不正确')
          json(res,200,{ok:true,recall:this.clientStore.recall(id,input.query,input.limit)});return
        }
        if(!Number.isSafeInteger(revision))throw new VoiceError('bad_memory','请提供当前记忆版本')
        const before=this.clientStore.memory(id).barrier
        const memory=operation==='upsert'?this.clientStore.remember(id,input.text,{...input,revision},{actor:'settings'}):operation==='forget'?this.clientStore.forget(id,input.id,revision,{actor:'settings'}):this.clientStore.clearMemory(id,revision)
        json(res,200,{ok:true,memory,contextChanged:memory.barrier!==before});return
      }
      if(req.method==='GET'){
        if(!resource){json(res,200,{ok:true,...this.clientStore.view(id)});return}
        if(resource==='settings'){json(res,200,{ok:true,deviceId:id,settings:this.clientStore.view(id).settings});return}
        if(resource==='memory'){json(res,200,{ok:true,deviceId:id,memory:this.clientStore.memory(id)});return}
        if(resource==='conversations'){json(res,200,{ok:true,deviceId:id,conversations:this.clientStore.conversations(id)});return}
      }
      if(req.method==='PUT'&&(resource==='settings'||resource==='memory')){
        const body=await readBody(req);if(body===null){json(res,413,{ok:false,error:'too_large'});return}
        let patch:any;try{patch=JSON.parse(body)}catch{throw new VoiceError('bad_json','请求不是合法 JSON')}
        if(!patch||typeof patch!=='object'||Array.isArray(patch))throw new VoiceError('bad_request','请求需为 JSON 对象')
        if(resource==='settings'){json(res,200,{ok:true,deviceId:id,...this.clientStore.update(id,patch)});return}
        if(Object.keys(patch).some(k=>!['text','revision'].includes(k)))throw new VoiceError('bad_memory','记忆参数不正确')
        json(res,200,{ok:true,deviceId:id,memory:this.clientStore.replaceMemory(id,patch.text,patch.revision)});return
      }
      if(req.method==='POST'&&resource?.startsWith('context/')){
        if([...this.connections].some(c=>c.deviceId===id&&['busy','listening'].includes(c.describe().state))){json(res,409,{ok:false,error:'client_busy',message:'请等待此客户端当前轮次结束后再重置对话'});return}
        const view=this.clientStore.resetContext(id,resource==='context/restore')
        for(const c of this.connections)if(c.deviceId===id)c.close(1000,'client context changed')
        json(res,200,{ok:true,...view});return
      }
      if(req.method==='POST'&&resource?.startsWith('test/')){
        if(resource==='test/asr')await this.handleTestAsr(res,settings)
        else if(resource==='test/tts')await this.handleTestTts(res,settings)
        else await this.handleTestLlm(res,settings,this.scopeFor(id,'health',settings.agentPreset,true))
        return
      }
      json(res,404,{ok:false,error:'not_found'})
    }catch(error){
      if(error instanceof VoiceError){json(res,error.code==='memory_conflict'?409:400,{ok:false,error:error.code,message:error.message});return}
      throw error
    }
  }

  private closeRevoked() {
    for (const [connection, identity] of this.identities) if (!this.validIdentity(identity)) connection.close(1008, 'credential revoked')
  }
}

function secureEqual(provided: string | undefined, expected: string | undefined): boolean {
  if (typeof provided!=='string'||typeof expected!=='string'||!provided||!expected) return false
  const a = Buffer.from(provided), b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
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
      if (settled) return
      size += chunk.length
      if (size > BODY_LIMIT) {
        chunks.length = 0
        finish(null)
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => finish(Buffer.concat(chunks).toString('utf8')))
    req.on('error', () => finish(null))
    req.on('aborted', () => finish(null))
  })
}

function json(res: ServerResponse, status: number, payload: unknown) {
  const body = JSON.stringify(payload)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(body)
}
