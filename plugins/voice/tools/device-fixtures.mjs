// Device-side validation fixtures: credentials remain on the host; never use the user's GUI identity.
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {homedir} from 'node:os'
const path=process.env.VOICE_SETTINGS??join(process.env.DSH_HOME??join(homedir(),'.dsh'),'yusheng-voice/settings.json')
export async function fixtureToken(deviceId){
  if(!/^(?:validation-[A-Za-z0-9_-]+|device-validation)$/.test(deviceId))throw new Error('only validation client identities are permitted')
  const config=JSON.parse(readFileSync(path,'utf8'))
  if(Object.hasOwn(config.deviceTokens??{},deviceId))return config.deviceTokens[deviceId]
  const r=await fetch((process.env.VOICE_URL??'http://127.0.0.1:8090')+'/devices',{method:'POST',headers:{'x-voice-token':config.adminToken,'content-type':'application/json'},body:JSON.stringify({deviceId,label:'验证客户端 '+deviceId}),signal:AbortSignal.timeout(10000)})
  if(r.status!==200)throw new Error('cannot create validation client')
  return (await r.json()).token
}
