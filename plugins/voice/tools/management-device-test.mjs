// Run on GM800. Uses the host's official launch-token -> signed-cookie exchange in memory.
// Neither launch tokens, cookies, nor admin/device credentials are printed or written to reports.
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'

const path=process.env.VOICE_SETTINGS??join(process.env.DSH_HOME??join(homedir(),'.dsh'),'yusheng-voice/settings.json')
const credentials=JSON.parse(readFileSync(path,'utf8'))
const pid=execFileSync('systemctl',['show','-p','MainPID','--value','gm800-dsh.service'],{encoding:'utf8'}).trim()
let cookie='',base=''
for(let attempt=0;attempt<20&&!cookie;attempt++){
  const journal=execFileSync('journalctl',['-u','gm800-dsh.service','_PID='+pid,'-n','60','--no-pager'],{encoding:'utf8'})
  const launches=[...journal.matchAll(/dsh web: (https?:\/\/[^\s]+\?token=[^\s]+)/g)]
  if(launches.length){
    const launch=launches.at(-1)[1];base=new URL(launch).origin
    const exchanged=await fetch(launch,{redirect:'manual',signal:AbortSignal.timeout(10000)})
    cookie=exchanged.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ')
  }
  if(!cookie)await new Promise(resolve=>setTimeout(resolve,500))
}
assert.ok(cookie,'dsh did not issue its signed cookie')
const report={at:new Date().toISOString(),checks:[]}
const output=process.env.VOICE_REPORT??'/tmp/yusheng-management-report.json'
async function call(path='/status',method='GET',body,options={}){
  return fetch(base+'/api/yusheng-voice/manage',{method:'POST',headers:{'content-type':'application/json',origin:base,...(options.cookie===false?{}:{cookie}),...options.headers},body:options.raw??JSON.stringify({path,method,...(body===undefined?{}:{body})}),signal:AbortSignal.timeout(12000)})
}
async function check(name,fn){const start=Date.now();try{const details=await fn();report.checks.push({name,ok:true,durationMs:Date.now()-start,...details});console.log('PASS',name,JSON.stringify(details??{}))}catch(error){report.checks.push({name,ok:false,durationMs:Date.now()-start,error:error.message});console.log('FAIL',name,error.message)}writeFileSync(output,JSON.stringify(report,null,2)+'\n',{mode:0o600})}

await check('dsh signed login cookie reads voice settings without an admin header',async()=>{
  const response=await call();assert.equal(response.status,200);const text=await response.text();assert.equal(text.includes(credentials.adminToken),false)
  const status=JSON.parse(text);assert.equal(status.ok,true);assert.equal(status.version,JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')).version)
  const settings=await(await call('/settings')).json();assert.equal(settings.ok,true);assert.equal('adminToken' in settings.settings,false)
  return{version:status.version,onlineClients:status.clients.length,assistantName:settings.settings.assistantName,adminCredentialExposed:false}
})
await check('dsh owner can save settings through the same login session',async()=>{
  const inventory=await(await call('/clients')).json();const clientId=inventory.clients[0]?.deviceId;assert.ok(clientId);const clientSettings='/clients/'+clientId+'/settings'
  const current=await(await call(clientSettings)).json()
  const response=await call(clientSettings,'PUT',{assistantName:current.settings.assistantName});assert.equal(response.status,200)
  const saved=await response.json();assert.deepEqual(saved.rejected,[]);assert.equal(saved.settings.assistantName,current.settings.assistantName)
  const disk=JSON.parse(readFileSync(path,'utf8'));assert.equal(JSON.parse(readFileSync(join(dirname(path),'clients',clientId,'profile.json'),'utf8')).config.assistantName,current.settings.assistantName)
  assert.equal(disk.adminToken,credentials.adminToken);assert.equal(disk.token,credentials.token);assert.equal(disk.minimaxApiKey,credentials.minimaxApiKey);assert.deepEqual(disk.deviceTokens,credentials.deviceTokens)
  return{persisted:true,credentialsPreserved:true}
})
await check('missing login, expired login and device tokens cannot use the dsh management route',async()=>{
  assert.equal((await call('/settings','GET',undefined,{cookie:false})).status,401)
  const badCookie=cookie.split('; ').map(item=>item.split('=')[0]+'=invalid-test-session').join('; ')
  assert.equal((await call('/settings','GET',undefined,{headers:{cookie:badCookie}})).status,401)
  assert.equal((await call('/settings','GET',undefined,{cookie:false,headers:{'x-voice-token':credentials.token}})).status,401)
  return{missing:401,expired:401,deviceToken:401}
})
await check('cross-origin access is refused even with a valid login cookie',async()=>{
  assert.equal((await call('/settings','GET',undefined,{headers:{origin:'http://unrelated.example'}})).status,403)
  return{crossOrigin:403}
})
await check('unsupported destinations and operations are refused',async()=>{
  assert.equal((await call('http://127.0.0.1:22','GET')).status,400)
  assert.equal((await call('/settings','PATCH',{})).status,400)
  return{unsupported:400}
})
await check('oversized operations return a bounded error response',async()=>{
  assert.equal((await call('/settings','GET',undefined,{raw:'x'.repeat(32769)})).status,413)
  return{oversized:413}
})
await check('standalone REST continues to require its independent admin token',async()=>{
  const direct=process.env.VOICE_URL??'http://127.0.0.1:8090'
  assert.equal((await fetch(direct+'/settings')).status,401)
  assert.equal((await fetch(direct+'/settings',{headers:{'x-voice-token':credentials.token}})).status,401)
  assert.equal((await fetch(direct+'/settings',{headers:{'x-voice-token':credentials.adminToken}})).status,200)
  return{anonymous:401,device:401,admin:200}
})
process.exitCode=report.checks.some(check=>!check.ok)?1:0
