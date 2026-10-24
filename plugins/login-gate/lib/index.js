// dsh-login-gate — 远程访问登录门。
//
// 官方 WebUI 的准入链路是「进程 launch token 换签名 cookie」：入口 URL 携带进程级
// 一次性 token，首次 GET /?token=… 换发绑定 Host 的 HMAC 签名 cookie（HttpOnly、
// SameSite=Strict，默认 30 天），后续 /api 与 index 都只认 cookie。官方没有给其他
// 设备用的入口——token 只打印在服务器控制台。
//
// 本插件注册一个无需认证即可访问的登录路由（默认 /login）：验证密码后把浏览器
// 303 重定向到 connection.authenticatedUrl('/')，由官方交换发 cookie。不自建会话、
// 不接触签名密钥、不改官方任何行为；插件卸载后只剩官方 token 入口。
//
// 仅适用于 web profile（依赖 webServer 与 connection 两个服务；桌面端走 file:// 无鉴权）。

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

const SCRYPT_KEYLEN = 32
const BODY_LIMIT = 8192
const ATTEMPT_TABLE_LIMIT = 4096
const CONFIG_KEYS = new Set([
  'username', 'password', 'passwordEnv', 'passwordHash',
  'loginPath', 'maxAttempts', 'attemptWindowMinutes', 'lockoutMinutes',
])
const READABLE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'

function clampInt(value, min, max, fallback) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return fallback
  return parsed
}

/** 解析 `scrypt$<salt b64url>$<hash b64url>` 形式的存储哈希。 */
function parsePasswordHash(value) {
  const parts = String(value).split('$')
  if (parts.length !== 3 || parts[0] !== 'scrypt') {
    throw new Error('login-gate: passwordHash must be "scrypt$<salt>$<hash>" (base64url)')
  }
  const salt = Buffer.from(parts[1], 'base64url')
  const expected = Buffer.from(parts[2], 'base64url')
  if (salt.length < 8 || salt.length > 64 || expected.length !== SCRYPT_KEYLEN) {
    throw new Error('login-gate: passwordHash has invalid salt/hash lengths')
  }
  return { salt, expected }
}

/**
 * 把配置解析成统一的 {salt, expected} 凭据。优先级：passwordHash > password >
 * passwordEnv。都缺省返回 null（由调用方生成临时密码并告警）。
 */
function resolveCredentials(config) {
  if (config.passwordHash !== undefined && config.passwordHash !== '') {
    return parsePasswordHash(config.passwordHash)
  }
  let plain = ''
  if (typeof config.password === 'string' && config.password !== '') {
    plain = config.password
  } else if (typeof config.passwordEnv === 'string' && config.passwordEnv !== '') {
    const fromEnv = process.env[config.passwordEnv]
    if (typeof fromEnv === 'string') plain = fromEnv
  }
  if (plain === '') return null
  if (plain.length > 256) throw new Error('login-gate: password must be at most 256 characters')
  const salt = randomBytes(16)
  return { salt, expected: scryptSync(plain, salt, SCRYPT_KEYLEN) }
}

function generateReadablePassword(length = 12) {
  const bytes = randomBytes(length)
  let out = ''
  for (const byte of bytes) out += READABLE_ALPHABET[byte % READABLE_ALPHABET.length]
  return out
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = []
    let size = 0
    let settled = false
    const finish = (value) => { if (!settled) { settled = true; resolve(value) } }
    req.on('data', (chunk) => {
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

/** 恒时字符串比较（长度不等直接失败，不泄露时序）。 */
function constantTimeEqual(a, b) {
  const left = Buffer.from(String(a), 'utf8')
  const right = Buffer.from(String(b), 'utf8')
  return left.length === right.length && timingSafeEqual(left, right)
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[ch])
}

function renderPage({ usernameRequired, error, lockedMinutesLeft, loginPath = '/login' }) {
  const errorBlock = error
    ? `<p class="error">${escapeHtml(error)}</p>`
    : (lockedMinutesLeft
      ? `<p class="error">尝试次数过多，已锁定，请约 ${lockedMinutesLeft} 分钟后再试。</p>`
      : '<p class="hint">请输入访问密码</p>')
  const usernameField = usernameRequired
    ? '<input class="input" type="text" name="username" autocomplete="username" autocapitalize="none" required>'
    : ''
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; form-action 'self'">
<title>登录 · dsh</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
         background: #10141c; color: #e6e9ef; font: 15px/1.6 system-ui, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
  .card { width: min(92vw, 340px); padding: 32px 28px; border-radius: 14px;
          background: #1a212c; border: 1px solid #2c3646; box-shadow: 0 12px 40px rgba(0,0,0,.45); }
  h1 { margin: 0 0 6px; font-size: 18px; }
  .sub { margin: 0 0 18px; color: #8b96a8; font-size: 13px; }
  .input { width: 100%; box-sizing: border-box; margin: 0 0 12px; padding: 10px 12px; border-radius: 8px;
           border: 1px solid #34405280; background: #10151f; color: inherit; font-size: 15px; }
  .input:focus { outline: 2px solid #3d6dbe; border-color: transparent; }
  button { width: 100%; padding: 10px 12px; border: 0; border-radius: 8px; background: #2f6fd0;
           color: #fff; font-size: 15px; cursor: pointer; }
  button:hover { background: #3a7ae2; }
  .error { color: #ff8f8f; font-size: 13px; margin: 0 0 14px; }
  .hint { color: #8b96a8; font-size: 13px; margin: 0 0 14px; }
</style>
</head>
<body>
  <main class="card">
    <h1>DeepSeek Harness</h1>
    <p class="sub">WebUI 远程访问 · 登录</p>
    ${errorBlock}
    <form method="post" action="${loginPath}">
      ${usernameField}
      <input class="input" type="password" name="password" autocomplete="current-password" required autofocus>
      <button type="submit">登录</button>
    </form>
  </main>
</body>
</html>
`
}

function pruneAttempts(table, now) {
  if (table.size <= ATTEMPT_TABLE_LIMIT) return
  const entries = [...table.entries()].sort((a, b) => a[1].firstAt - b[1].firstAt)
  for (const [key] of entries.slice(0, entries.length - ATTEMPT_TABLE_LIMIT)) table.delete(key)
  for (const [key, record] of table) {
    if (record.lockedUntil < now && now - record.firstAt > 3 * 24 * 60 * 60 * 1000) table.delete(key)
  }
}

/** 轻量栅栏：显式跨站点标记一律拒；带 Origin 时必须与 Host 同源（防 DNS 重绑定的表单投递）。 */
function fenceRejected(req) {
  if (req.headers['sec-fetch-site'] === 'cross-site') return true
  const origin = req.headers.origin
  const host = req.headers.host
  if (typeof origin !== 'string' || typeof host !== 'string') return false
  try {
    return new URL(origin).host !== new URL(`http://${host}`).host
  } catch {
    return true
  }
}

export default {
  name: 'login-gate',
  apply(root, config = {}) {
    const unknown = Object.keys(config).filter((key) => !CONFIG_KEYS.has(key))
    if (unknown.length > 0) {
      throw new Error(`login-gate: unknown config fields: ${unknown.join(', ')}`)
    }
    const loginPath = typeof config.loginPath === 'string' && /^\/[A-Za-z0-9._-]+$/.test(config.loginPath)
      ? config.loginPath
      : '/login'
    const username = typeof config.username === 'string' ? config.username.slice(0, 64) : ''
    const maxAttempts = clampInt(config.maxAttempts, 1, 100, 5)
    const windowMs = clampInt(config.attemptWindowMinutes, 1, 1440, 10) * 60_000
    const lockoutMs = clampInt(config.lockoutMinutes, 1, 1440, 10) * 60_000

    let credentials = resolveCredentials(config)
    if (credentials === null) {
      const generated = generateReadablePassword()
      const salt = randomBytes(16)
      credentials = { salt, expected: scryptSync(generated, salt, SCRYPT_KEYLEN) }
      root.logger.warn(
        `login-gate: no password configured (password / passwordEnv / passwordHash); ` +
        `generated temporary password: ${generated} — set config.password in the profile user layer and reload.`,
      )
    }
    const state = {
      credentials,
      usernameRequired: username !== '',
      username,
      loginPath,
      maxAttempts,
      windowMs,
      lockoutMs,
    }
    const attempts = new Map()

    root.inject(['webServer', 'connection'], (ctx) => {
      ctx.effect(() => ctx.webServer.register({
        kind: 'exact',
        path: loginPath,
        handler: (req, res) => handleLogin(ctx, req, res, state, attempts),
      }), 'login-gate: route')
    })
  },
}

async function handleLogin(ctx, req, res, state, attempts) {
  const noStore = { 'cache-control': 'no-store' }
  if (!['GET', 'HEAD', 'POST'].includes(req.method)) {
    res.writeHead(405, { allow: 'GET, HEAD, POST', ...noStore })
    res.end()
    return
  }
  if (fenceRejected(req)) {
    res.writeHead(403, noStore)
    res.end('forbidden')
    return
  }
  const key = req.socket.remoteAddress ?? 'unknown'
  const now = Date.now()
  const record = attempts.get(key)
  const lockedMinutesLeft = record !== undefined && record.lockedUntil > now
    ? Math.max(1, Math.ceil((record.lockedUntil - now) / 60_000))
    : 0

  if (req.method === 'GET' || req.method === 'HEAD') {
    // 已持有效官方 cookie 的访问直接回应用本体，不再要密码。
    if (typeof ctx.connection.requestRejection === 'function'
      && ctx.connection.requestRejection(req) === undefined) {
      res.writeHead(303, { location: '/', ...noStore })
      res.end()
      return
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...noStore })
    res.end(req.method === 'HEAD' ? undefined : renderPage({
      usernameRequired: state.usernameRequired,
      error: '',
      lockedMinutesLeft,
      loginPath: state.loginPath,
    }))
    return
  }

  // POST：验证表单。
  if (lockedMinutesLeft > 0) {
    // 锁定期返回 200 + 友好页：Chrome 对 423 会用自带错误页（「当前无法使用此页面」）
    // 替换响应体，用户看不到锁定原因和剩余时间。
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...noStore })
    res.end(renderPage({ usernameRequired: state.usernameRequired, error: '', lockedMinutesLeft, loginPath: state.loginPath }))
    return
  }
  const body = await readBody(req)
  let password = ''
  let user = ''
  if (body !== null) {
    const form = new URLSearchParams(body)
    password = (form.get('password') ?? '').slice(0, 256)
    user = (form.get('username') ?? '').slice(0, 256)
  }
  const usernameOk = !state.usernameRequired || (user !== '' && constantTimeEqual(user, state.username))
  const passwordOk = password !== ''
    && timingSafeEqual(scryptSync(password, state.credentials.salt, SCRYPT_KEYLEN), state.credentials.expected)
  if (usernameOk && passwordOk) {
    attempts.delete(key)
    const host = req.headers.host
    // 用请求自身的 Host 构造基础 URL：官方交换按该权威签发 cookie，浏览器后续请求同权威。
    const base = `http://${host !== undefined ? host : '127.0.0.1'}/`
    res.writeHead(303, {
      location: ctx.connection.authenticatedUrl(base),
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
    })
    res.end()
    return
  }

  const current = record ?? { count: 0, firstAt: now, lockedUntil: 0 }
  if (now - current.firstAt > state.windowMs) {
    current.count = 0
    current.firstAt = now
  }
  current.count += 1
  if (current.count >= state.maxAttempts) {
    current.lockedUntil = now + state.lockoutMs
    current.count = 0
  }
  attempts.set(key, current)
  pruneAttempts(attempts, now)
  const locked = current.lockedUntil > now
    ? Math.max(1, Math.ceil((current.lockedUntil - now) / 60_000))
    : 0
  res.writeHead(401, { 'content-type': 'text/html; charset=utf-8', 'retry-after': '30', ...noStore })
  res.end(renderPage({
    usernameRequired: state.usernameRequired,
    error: locked ? '' : '密码不正确，请重试。',
    lockedMinutesLeft: locked,
    loginPath: state.loginPath,
  }))
}
