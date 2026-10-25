import {fixtureToken} from './device-fixtures.mjs'
// Run on the dsh host: credentials stay in the host settings file and are never logged.
import { readFileSync, writeFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { homedir } from 'node:os'

const settings=JSON.parse(readFileSync(process.env.VOICE_SETTINGS ?? join(process.env.DSH_HOME ?? join(homedir(),'.dsh'),'yusheng-voice/settings.json'),'utf8'))
const base=process.env.VOICE_URL ?? 'http://127.0.0.1:8090'
const report={at:new Date().toISOString(),checks:[]}
const output=process.env.VOICE_REPORT??'/tmp/yusheng-device-report.json'
const headers={'x-voice-token':settings.adminToken,'content-type':'application/json'}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))
async function check(name,fn) {
  const began=Date.now()
  try { const details=await fn(); report.checks.push({name,ok:true,durationMs:Date.now()-began,...details}); console.log('PASS',name,JSON.stringify(details??{})) }
  catch(e){report.checks.push({name,ok:false,error:e.message,durationMs:Date.now()-began}); console.log('FAIL',name,e.message)}
  writeFileSync(output,JSON.stringify(report,null,2)+'\n',{mode:0o600})
}
async function connect(version=2,deviceId='device-validation') {
  const ws=new WebSocket(`${base.replace(/^http/,'ws')}/voice?token=${encodeURIComponent(await fixtureToken(deviceId))}`)
  ws.binaryType='arraybuffer'
  const messages=[],audio=[]
  let firstAudioAt
  ws.onmessage=ev=>{
    if(typeof ev.data==='string')messages.push({...JSON.parse(ev.data),receivedAt:Date.now()})
    else {const frame=Buffer.from(ev.data);audio.push(version===2?frame.subarray(24):frame);firstAudioAt??=Date.now()}
  }
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=()=>reject(new Error('websocket connect failed'))})
  const send=m=>ws.send(JSON.stringify(m))
  const wait=async(fn,ms=180000)=>{const began=Date.now();while(!fn()){if(Date.now()-began>ms)throw new Error('protocol timeout');if(ws.readyState!==1)throw new Error('connection closed');await delay(20)}return fn()}
  send({type:'hello',version,deviceId,capabilities:['turns','audio.framed','playback','playback.flow','agent.activity','response.stop','conversation.select']})
  await wait(()=>messages.find(m=>m.type==='welcome')??messages.find(m=>m.type==='error'),10000)
  assert.equal(messages[0].type,'welcome',messages[0].message)
  return {ws,messages,audio,send,wait,close:()=>ws.close(),firstAudio:()=>firstAudioAt}
}
let sourceAudio
await check('REST credentials separated and protocol advertised',async()=>{
  const status=await(await fetch(base+'/status',{headers,signal:AbortSignal.timeout(5000)})).json()
  assert.equal(status.version,JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')).version);assert.deepEqual(status.supportedProtocols,[1,2]);assert.equal(status.hasMinimaxApiKey,true)
  assert.equal((await fetch(base+'/status',{headers:{'x-voice-token':settings.token}})).status,401)
  assert.equal((await fetch(base+'/status')).status,401)
  return {version:status.version,model:status.model}
})
await check('v1 real MiniMax TTS raw PCM',async()=>{
  const c=await connect(1,'validation-v1')
  try {const began=Date.now();c.send({type:'speak',text:'请只回复你好。'});await c.wait(()=>c.messages.find(m=>m.type==='tts'&&m.state==='stop'))
    assert.equal(c.messages.at(-1).reason,'done',JSON.stringify(c.messages.filter(m=>m.type==='error')));sourceAudio=Buffer.concat(c.audio);assert.ok(sourceAudio.length>1000)
    return {bytes:sourceAudio.length,firstAudioMs:c.firstAudio()-began}
  }finally{c.close()}
})
await check('v2 real agent tool execution, framed audio, playback and persistent context',async()=>{
  const id='validation-agent',c=await connect(2,id),marker='青柠四十二'
  try {
    const began=Date.now();c.send({type:'query',requestId:'tool',text:`请使用 shell 工具执行 printf yusheng_voice_ok，然后用中文说测试通过。顺便记住口令是${marker}。`})
    await c.wait(()=>c.messages.find(m=>m.type==='turn.end'&&m.requestId==='tool'))
    const end=c.messages.find(m=>m.type==='turn.end'&&m.requestId==='tool')
    assert.equal(end.reason,'completed',JSON.stringify(c.messages.filter(m=>m.type==='error')));assert.ok(c.audio.length)
    assert.ok(c.messages.some(m=>m.type==='agent.activity'&&m.state==='tool'),'no tool activity')
    const audioEnd=c.messages.find(m=>m.type==='audio.end'&&m.turnId===end.turnId)
    c.send({type:'playback',turnId:end.turnId,streamId:end.streamId,state:'ended',playedSamples:audioEnd.samples})
    await c.wait(()=>c.messages.find(m=>m.type==='playback.ack'))
    c.close();await delay(200)
    const next=await connect(2,id)
    try {next.send({type:'query',requestId:'memory',text:'刚才让你记住的口令是什么？只说口令。'});await next.wait(()=>next.messages.find(m=>m.type==='turn.end'))
      assert.equal(next.messages.find(m=>m.type==='turn.end').reason,'completed',JSON.stringify(next.messages.filter(m=>m.type==='error')))
      const text=next.messages.filter(m=>m.type==='llm'&&m.state==='delta').map(m=>m.text).join('');assert.ok(text.includes(marker),text)
      return {firstAudioMs:c.firstAudio()-began,toolEvents:c.messages.filter(m=>m.type==='agent.activity'&&m.state==='tool').length,bytes:Buffer.concat(c.audio).length,sessionId:c.messages.find(m=>m.type==='session')?.sessionId,memory:true}
    }finally{next.close()}
  }finally{c.close()}
})
await check('real ASR to agent to TTS',async()=>{
  assert.ok(sourceAudio,'TTS source unavailable')
  const samples=Math.floor(sourceAudio.length/2/1.5),pcm=Buffer.alloc(samples*2)
  for(let i=0;i<samples;i++){const pos=i*1.5,left=Math.floor(pos),right=Math.min(left+1,sourceAudio.length/2-1),fraction=pos-left;pcm.writeInt16LE(Math.round(sourceAudio.readInt16LE(left*2)*(1-fraction)+sourceAudio.readInt16LE(right*2)*fraction),i*2)}
  const c=await connect(2,'validation-asr')
  try {c.send({type:'listen',state:'start',requestId:'asr'});for(let i=0;i<pcm.length;i+=3200)c.ws.send(pcm.subarray(i,i+3200));c.send({type:'listen',state:'stop'})
    await c.wait(()=>c.messages.find(m=>m.type==='turn.end'));assert.equal(c.messages.find(m=>m.type==='turn.end').reason,'completed',JSON.stringify(c.messages.filter(m=>m.type==='error')))
    const stt=c.messages.find(m=>m.type==='stt');assert.ok(stt?.text.includes('你好'),stt?.text);assert.ok(c.audio.length)
    return {recognized:stt.text,outputBytes:Buffer.concat(c.audio).length}
  }finally{c.close()}
})
await check('ASR abort suppresses stale events while next turn succeeds',async()=>{
  const c=await connect(2,'validation-abort-asr')
  try {c.send({type:'listen',state:'start',requestId:'old'});c.ws.send(Buffer.alloc(64000));c.send({type:'listen',state:'stop'})
    c.send({type:'abort'});c.send({type:'speak',text:'下一轮正常。',requestId:'new'})
    await c.wait(()=>c.messages.find(m=>m.type==='turn.end'&&m.requestId==='new'));await delay(1000)
    const old=c.messages.filter(m=>m.requestId==='old')
    assert.equal(old.filter(m=>m.type==='turn.end').length,1);assert.equal(old.some(m=>m.type==='stt'||m.type==='llm'),false)
    assert.equal(c.messages.find(m=>m.type==='turn.end'&&m.requestId==='new').reason,'done')
    return {oldEvents:old.length,newTurn:true}
  }finally{c.close()}
})
await check('real agent cancel settles and releases conversation lease',async()=>{
  const c=await connect(2,'validation-cancel-agent')
  try {c.send({type:'query',requestId:'cancel',text:'请使用 shell 执行 sleep 8，然后回复已完成。'})
    await c.wait(()=>c.messages.find(m=>m.type==='agent.activity'&&m.state==='tool'),30000)
    const turn=c.messages.find(m=>m.type==='turn.start');c.send({type:'turn.cancel',turnId:turn.turnId})
    await c.wait(()=>c.messages.find(m=>m.type==='turn.end'&&m.requestId==='cancel'));assert.equal(c.messages.find(m=>m.type==='turn.end'&&m.requestId==='cancel').reason,'aborted')
    await delay(1000)
    let successful=false
    for(let i=0;i<15&&!successful;i++){
      const requestId=`after-${i}`;c.send({type:'query',requestId,text:'只回复取消测试通过。'})
      await c.wait(()=>c.messages.find(m=>m.type==='turn.end'&&m.requestId===requestId))
      const end=c.messages.find(m=>m.type==='turn.end'&&m.requestId===requestId)
      successful=end.reason==='completed'
      if(!successful){assert.ok(c.messages.some(m=>m.type==='error'&&m.requestId===requestId&&m.code==='session_busy'));await delay(500)}
    }
    assert.equal(successful,true);assert.equal(c.messages.filter(m=>m.type==='turn.end'&&m.requestId==='cancel').length,1)
    return {cancelled:true,nextTurn:true}
  }finally{c.close()}
})
if(process.env.VOICE_LONG_TEST==='1')await check('long real TTS exceeds former 30 second drain limit',async()=>{
  const c=await connect(2,'validation-long')
  try {c.send({type:'speak',requestId:'long',text:'语音交互应该自然流畅，每一段内容都要完整播放，不能因为固定的排空时间而被截断。'.repeat(7)})
    await c.wait(()=>c.messages.find(m=>m.type==='turn.end'));const end=c.messages.find(m=>m.type==='turn.end');assert.equal(end.reason,'done',JSON.stringify(c.messages.filter(m=>m.type==='error')))
    const seconds=Buffer.concat(c.audio).length/48000;assert.ok(seconds>30,`audio ${seconds}s does not cover long drain`)
    return {audioSeconds:seconds,bytes:Buffer.concat(c.audio).length}
  }finally{c.close()}
})
await check('client playback flow pauses and resumes real audio',async()=>{
  const c=await connect(2,'validation-flow')
  try {
    c.send({type:'speak',requestId:'flow',text:'这是一段用于验证播放缓冲控制的语音，客户端可以暂停接收节奏，然后继续完整播放。'})
    await c.wait(()=>Buffer.concat(c.audio).length>144000)
    const start=c.messages.find(m=>m.type==='turn.start'),buffered=Buffer.concat(c.audio).length/2
    c.send({type:'playback',turnId:start.turnId,streamId:start.streamId,state:'progress',playedSamples:0,bufferedSamples:buffered})
    await c.wait(()=>c.messages.find(m=>m.type==='playback.ack'))
    await delay(100);const paused=c.audio.length;await delay(250);assert.equal(c.audio.length,paused,'audio did not pause')
    c.send({type:'playback',turnId:start.turnId,streamId:start.streamId,state:'progress',playedSamples:buffered,bufferedSamples:0})
    await c.wait(()=>c.messages.find(m=>m.type==='turn.end'));assert.equal(c.messages.find(m=>m.type==='turn.end').reason,'done')
    assert.ok(c.audio.length>paused);return {paused:true,resumed:true,samples:Buffer.concat(c.audio).length/2}
  }finally{c.close()}
})
await check('real turn deadline cancels long tool work and restores settings',async()=>{
  const c=await connect(2,'validation-timeout'),original=(await(await fetch(base+'/clients/validation-timeout/settings',{headers})).json()).settings.maxTurnSeconds
  try {
    const update=await(await fetch(base+'/clients/validation-timeout/settings',{method:'PUT',headers,body:JSON.stringify({maxTurnSeconds:15})})).json();assert.equal(update.ok,true)
    c.send({type:'query',requestId:'timeout',text:'请使用 shell 执行 sleep 25，命令结束后才回复完成。'})
    await c.wait(()=>c.messages.find(m=>m.type==='turn.end'),30000)
    const end=c.messages.find(m=>m.type==='turn.end');assert.equal(end.reason,'timeout',JSON.stringify(c.messages.filter(m=>m.type==='error')))
    assert.ok(end.durationMs>=14900&&end.durationMs<20000)
    return {reason:end.reason,durationMs:end.durationMs}
  }finally{await fetch(base+'/clients/validation-timeout/settings',{method:'PUT',headers,body:JSON.stringify({maxTurnSeconds:original})});c.close()}
})
writeFileSync(output,JSON.stringify(report,null,2)+'\n',{mode:0o600})
console.log('REPORT',output)
process.exit(report.checks.some(x=>!x.ok)?1:0)
