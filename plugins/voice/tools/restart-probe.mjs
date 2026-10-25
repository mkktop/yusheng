// Run `write`, restart dsh, then run `read`. No credentials are printed or copied.
import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'

const mode=process.argv[2]
assert.ok(['write','read'].includes(mode),'usage: node tools/restart-probe.mjs write|read')
const path=process.env.VOICE_RESTART_STATE??'/tmp/yusheng-restart-state.json'
const settings=JSON.parse(readFileSync(process.env.VOICE_SETTINGS??join(process.env.DSH_HOME??join(homedir(),'.dsh'),'yusheng-voice/settings.json'),'utf8'))
const state=mode==='read'?JSON.parse(readFileSync(path,'utf8')):{deviceId:`validation-restart-${Date.now()}`,marker:'星河七十九'}
const messages=[]
const ws=new WebSocket(`ws://127.0.0.1:8090/voice?token=${encodeURIComponent(settings.token)}`)
ws.onmessage=ev=>{if(typeof ev.data==='string')messages.push(JSON.parse(ev.data))}
const until=async fn=>{const start=Date.now();while(!fn()){if(Date.now()-start>60000)throw new Error('probe timeout');await new Promise(r=>setTimeout(r,20))}return fn()}
try {
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=()=>reject(new Error('probe connection failed'))})
  ws.send(JSON.stringify({type:'hello',version:2,deviceId:state.deviceId,capabilities:['turns']}))
  await until(()=>messages.find(m=>m.type==='welcome')??messages.find(m=>m.type==='error'))
  assert.equal(messages[0].type,'welcome')
  ws.send(JSON.stringify({type:'query',requestId:`restart-${mode}`,text:mode==='write'?`请记住口令是${state.marker}，只回复已记住。`:'之前让你记住的口令是什么？只说口令。'}))
  const end=await until(()=>messages.find(m=>m.type==='turn.end'))
  assert.equal(end.reason,'completed',JSON.stringify(messages.filter(m=>m.type==='error')))
  const sessionId=messages.find(m=>m.type==='session')?.sessionId
  const text=messages.filter(m=>m.type==='llm'&&m.state==='delta').map(m=>m.text).join('')
  if(mode==='write'){state.sessionId=sessionId;writeFileSync(path,JSON.stringify(state),{mode:0o600})}
  else {assert.equal(sessionId,state.sessionId,'restart unexpectedly switched sessions');assert.ok(text.includes(state.marker),text)}
  const result={mode,ok:true,sessionId,text}
  if(mode==='read')writeFileSync('/tmp/yusheng-restart-report.json',JSON.stringify(result,null,2)+'\n',{mode:0o600})
  console.log(JSON.stringify(result))
}finally{ws.close()}
