import type { VoiceServer } from './server.js'

export const MANAGEMENT_PATH = '/api/yusheng-voice/manage'
const LIMIT = 32 * 1024
const OPERATIONS = new Set(['GET /status', 'GET /settings', 'PUT /settings', 'GET /clients', 'POST /devices', 'POST /token', 'POST /test/asr', 'POST /test/tts', 'POST /test/llm'])

function clientOperation(method:string,path:string) {
  if(method==='GET')return /^\/clients\/[A-Za-z0-9_-]{1,48}(?:\/(settings|memory|conversations))?$/.test(path)
  if(method==='PUT')return /^\/clients\/[A-Za-z0-9_-]{1,48}\/(settings|memory)$/.test(path)
  return method==='POST'&&/^\/clients\/[A-Za-z0-9_-]{1,48}\/(memory|context\/(reset|restore)|test\/(asr|tts|llm))$/.test(path)
}

function reply(status: number, error: string, message: string) {
  return Response.json({ ok: false, error, message }, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...(status === 413 ? { connection: 'close' } : {}) } })
}

/** Registered on dsh's authenticated, owner-only exact Fetch transport. Never register on webServer. */
export function registerManagement(ctx: any, server: VoiceServer) {
  return ctx.connection.fetch.register({
    path: MANAGEMENT_PATH, methods: ['POST'], requestBody: 'buffered',
    fetch: (request: Request) => handleManagement(request, server),
  })
}

export async function handleManagement(request: Request, server: VoiceServer): Promise<Response> {
  if (request.method !== 'POST') return reply(405, 'method_not_allowed', '请使用 POST 请求管理接口。')
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return reply(415, 'json_required', '管理请求必须使用 JSON。')
  if (Number(request.headers.get('content-length')) > LIMIT) return reply(413, 'too_large', '管理请求过大。')
  const reader = request.body?.getReader(), chunks: Uint8Array[] = []
  let size = 0
  try {
    if (reader) while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      // Cancelling a Node-backed request stream also destroys its response socket.
      // Send the bounded 413 response and close gracefully instead of resetting the connection.
      if (size > LIMIT) return reply(413, 'too_large', '管理请求过大。')
      chunks.push(value)
    }
  } catch { return reply(400, 'bad_body', '无法读取管理请求。') }
  finally { reader?.releaseLock() }
  let envelope: any
  try { envelope = JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  catch { return reply(400, 'bad_json', '管理请求格式不正确。') }
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope) || Object.keys(envelope).some(key => !['path','method','body'].includes(key))) return reply(400, 'bad_request', '管理请求格式不正确。')
  const { path, method, body } = envelope
  if (typeof path !== 'string' || typeof method !== 'string' || (!OPERATIONS.has(`${method} ${path}`) && !clientOperation(method,path) && !(method === 'DELETE' && /^\/devices\/[A-Za-z0-9_-]{1,48}$/.test(path)))) return reply(400, 'unsupported_operation', '不支持的管理操作。')
  if ((method === 'GET' || method === 'DELETE') && body !== undefined) return reply(400, 'bad_request', '此操作不接受请求内容。')
  try { return await server.managementRequest(path, method, body, request.signal) }
  catch { return reply(503, 'voice_unavailable', '语音服务暂时不可用，请稍后重试。') }
}
