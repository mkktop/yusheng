import {fixtureToken} from './device-fixtures.mjs'
// Run on the dsh device. Credentials are read in place and never written to reports.
import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'

const config=JSON.parse(readFileSync(process.env.VOICE_SETTINGS??join(process.env.DSH_HOME??join(homedir(),'.dsh'),'yusheng-voice/settings.json'),'utf8'))
const base=process.env.VOICE_URL??'http://127.0.0.1:8090'
const output=process.env.VOICE_REPORT??'/tmp/yusheng-persona-report.json',statePath='/tmp/yusheng-persona-state.json'
const readback=process.argv.includes('--restart-read')
const selectedClientId=readback?JSON.parse(readFileSync(statePath,'utf8')).deviceId:'validation-persona-'+Date.now().toString(36)
await fixtureToken(selectedClientId)
const clientSettingsPath='/clients/'+selectedClientId+'/settings'
const report=readback?JSON.parse(readFileSync(output,'utf8')):{at:new Date().toISOString(),checks:[]}
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))
async function api(path,patch){const response=await fetch(base+path,{method:patch?'PUT':'GET',headers:{'x-voice-token':config.adminToken,'content-type':'application/json'},...(patch?{body:JSON.stringify(patch)}:{}),signal:AbortSignal.timeout(12000)});assert.equal(response.status,200);return response.json()}
async function patch(value){const result=await api(clientSettingsPath,value);assert.deepEqual(result.rejected,[]);return result.settings}
async function check(name,fn){const start=Date.now();try{const details=await fn();report.checks.push({name,ok:true,durationMs:Date.now()-start,...details});console.log('PASS',name,JSON.stringify(details??{}))}catch(error){report.checks.push({name,ok:false,durationMs:Date.now()-start,error:error.message});console.log('FAIL',name,error.message)}writeFileSync(output,JSON.stringify(report,null,2)+'\n',{mode:0o600})}
async function connect(deviceId){
  const ws=new WebSocket(base.replace(/^http/,'ws')+'/voice?token='+encodeURIComponent(await fixtureToken(deviceId))),messages=[];let frames=0
  ws.onmessage=event=>{if(typeof event.data==='string')messages.push(JSON.parse(event.data));else frames++}
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=()=>reject(new Error('WebSocket failed'))})
  const send=value=>ws.send(JSON.stringify(value)),wait=async(predicate,timeout=100000)=>{const start=Date.now();while(!predicate()){if(Date.now()-start>timeout)throw new Error('turn timed out');if(ws.readyState!==1)throw new Error('connection closed');await pause(20)}return predicate()}
  send({type:'hello',version:2,deviceId,capabilities:['turns','audio.framed','agent.activity']})
  await wait(()=>messages.find(m=>m.type==='welcome'));const sessionId=messages[0].sessionId
  return {sessionId,close:()=>ws.close(),async query(text,id){const before=messages.length,audioBefore=frames;send({type:'query',text,requestId:id});const end=await wait(()=>messages.find(m=>m.type==='turn.end'&&m.requestId===id));assert.equal(end.reason,'completed',JSON.stringify(messages.slice(before).filter(m=>m.type==='error')));const turn=messages.slice(before);return{text:turn.filter(m=>m.type==='llm'&&m.state==='delta').map(m=>m.text).join(''),sessionId:turn.find(m=>m.type==='session')?.sessionId,toolCalled:turn.some(m=>m.type==='agent.activity'&&m.state==='tool'),audioFrames:frames-audioBefore}}}
}

if(readback){
  await check('persona and conversation context survive host restart',async()=>{
    const state=JSON.parse(readFileSync(statePath,'utf8')),current=(await api(clientSettingsPath)).settings,c=await connect(state.deviceId)
    try{const result=await c.query('请说出你现在的名字，再说出我让你记住的口令。只回答这两项。','after-restart');assert.equal(result.sessionId,state.sessionId);assert.ok(result.text.includes(current.assistantName),result.text);assert.ok(result.text.includes(state.marker),result.text);return{...result,name:current.assistantName,sessionPreserved:true}}finally{c.close()}
  })
}else{
  const before=(await api(clientSettingsPath)).settings
  const keys=['assistantName','userTitle','assistantRole','personality','personalityNotes','replyStyle','presentationStyle','promptPrefix','agentPreset']
  const restore=Object.fromEntries(keys.map(key=>[key,before[key]])),deviceId=selectedClientId,marker='星河四十二'
  let c
  try{
    await check('dedicated voice preset is registered and selected',async()=>{let status;for(let i=0;i<10;i++){status=await api('/status');if(status.presets?.some(p=>p.id==='yusheng-assistant'))break;await pause(500)}const preset=status.presets?.find(p=>p.id==='yusheng-assistant');assert.ok(preset);assert.equal(preset.broken,undefined);assert.equal(before.agentPreset,'yusheng-assistant');return{version:status.version,preset:preset.id}})
    await check('real model uses configured assistant name and user title',async()=>{
      await patch({assistantName:'小榆',userTitle:'小林',personality:'warm',replyStyle:'concise',personalityNotes:'称呼用户时使用设置中的称呼。'})
      c=await connect(deviceId);const result=await c.query(`请按当前人设介绍自己的名字，并按设置称呼我。记住口令是${marker}，简短回答。`,'identity')
      assert.ok(result.text.includes('小榆'),result.text);assert.ok(result.text.includes('小林'),result.text);assert.ok(result.audioFrames>0)
      writeFileSync(statePath,JSON.stringify({deviceId,marker,sessionId:result.sessionId}),'utf8');return result
    })
    await check('saved personality changes take effect next turn without losing memory',async()=>{
      assert.ok(c);await patch({assistantName:'小霁',userTitle:'阿辰',personality:'professional',personalityNotes:'称呼用户时使用设置中的称呼。'})
      const result=await c.query('请告诉我你现在的名字和对我的称呼，再说出我刚才让你记住的口令。','updated')
      assert.ok(result.text.includes('小霁'),result.text);assert.ok(result.text.includes('阿辰'),result.text);assert.ok(result.text.includes(marker),result.text);assert.equal(result.sessionId,c.sessionId);return{...result,sessionPreserved:true}
    })
    await check('voice preset retains real shell tools',async()=>{
      assert.ok(c);const result=await c.query('请使用 shell 工具执行 printf yusheng_persona_ok，并根据真实输出简短告诉我是否成功。','tool')
      assert.equal(result.toolCalled,true);assert.match(result.text,/成功|通过|yusheng_persona_ok/);return result
    })
  }finally{
    c?.close();await patch(restore)
    const after=JSON.parse(readFileSync(process.env.VOICE_SETTINGS??join(process.env.DSH_HOME??join(homedir(),'.dsh'),'yusheng-voice/settings.json'),'utf8'))
    assert.equal(after.adminToken,config.adminToken);assert.equal(after.token,config.token);assert.equal(after.minimaxApiKey,config.minimaxApiKey)
  }
}
process.exitCode=report.checks.some(check=>!check.ok)?1:0
