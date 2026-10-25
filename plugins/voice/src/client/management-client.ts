export type Connection = { mode: 'host'; baseUrl: string } | { mode: 'external'; baseUrl: string; token: string }

export function hostManagementUrl() {
  return new URL('api/yusheng-voice/manage', document.baseURI).href
}

export async function request(connection: Connection, path: string, method = 'GET', body?: unknown) {
  const host = connection.mode === 'host'
  const response = await fetch(host ? connection.baseUrl : connection.baseUrl + path, {
    method: host ? 'POST' : method,
    credentials: host ? 'same-origin' : 'omit',
    headers: host ? { 'content-type': 'application/json' } : { 'content-type': 'application/json', 'x-voice-token': connection.token },
    ...(host ? { body: JSON.stringify({ path, method, ...(body === undefined ? {} : { body }) }) } : body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(path.startsWith('/test/') ? 65000 : 12000),
  })
  if (host && response.status === 401) throw new Error('dsh 登录已失效，请重新登录 dsh 后重试。')
  if (host && response.status === 403) throw new Error('当前 dsh 登录无管理权限，或请求来源未获允许。')
  let data: any
  try { data = await response.json() }
  catch { throw new Error(host ? `无法读取管理接口（HTTP ${response.status}），请确认插件已升级并重启 dsh。` : `服务响应格式不正确（HTTP ${response.status}）。`) }
  if (!response.ok) throw new Error(data.message ?? data.error ?? `请求失败（${response.status}）`)
  return data
}
