// Run on GM800. Device credentials are read in place, never printed.
import {readFileSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {homedir} from 'node:os'
import assert from 'node:assert/strict'
const settings=JSON.parse(readFileSync(join(process.env.DSH_HOME??join(homedir(),'.dsh'),'yusheng-voice/settings.json'),'utf8'))
const report={at:new Date().toISOString(),version:'0.3.0',checks:[]},path=process.env.VOICE_INTERACTION_REPORT??'/tmp/yusheng-interaction-report.json'
const delay=ms=>new Promise(r=>setTimeout(r,ms))
async function check(name,fn){const start=Date.now();try{const details=await fn();report.checks.push({name,ok:true,durationMs:Date.now()-start,...details});console.log('PASS',name,JSON.stringify(details??{}))}catch(e){report.checks.push({name,ok:false,error:e.message,durationMs:Date.now()-start});console.log('FAIL',name,e.message)}writeFileSync(path,JSON.stringify(report,null,2)+'\n',{mode:0o600})}
async function connect(deviceId='validation-interaction',capabilities=['turns','audio.framed','playback','presentation.state','presentation.cue','ui.render']){
  const ws=new WebSocket('ws://127.0.0.1:8090/voice?token='+encodeURIComponent(settings.token)),messages=[],frames=[];ws.binaryType='arraybuffer'
  ws.onmessage=e=>typeof e.data==='string'?messages.push(JSON.parse(e.data)):frames.push(Buffer.from(e.data))
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=()=>reject(new Error('connect failed'))})
  const send=m=>ws.send(JSON.stringify(m)),wait=async(fn,ms=120000)=>{const start=Date.now();while(!fn()){if(Date.now()-start>ms)throw new Error('timeout');if(ws.readyState!==1)throw new Error('connection closed');await delay(20)}return fn()}
  send({type:'hello',version:2,deviceId,capabilities})
  await wait(()=>messages.find(m=>m.type==='welcome')??messages.find(m=>m.type==='error'));assert.equal(messages[0].type,'welcome')
  return {ws,messages,frames,send,wait,close:()=>ws.close()}
}
let card,snapshot
if(process.argv.includes('--restart-read')) {
  await check('UI component and agent session survive host restart and remain actionable',async()=>{
    const state=JSON.parse(readFileSync('/tmp/yusheng-ui-restart-state.json','utf8')),c=await connect(state.deviceId)
    try {
      const snapshot=await c.wait(()=>c.messages.find(m=>m.type==='ui.snapshot')),component=snapshot.components.find(c=>c.id===state.component.id)
      assert.equal(component.instanceId,state.component.instanceId);assert.equal(component.revision,state.component.revision)
      c.send({type:'ui.action',requestId:'after-restart',componentId:component.id,instanceId:component.instanceId,revision:component.revision,actionId:'continue'})
      const end=await c.wait(()=>c.messages.find(m=>m.type==='turn.end'));assert.equal(end.reason,'completed')
      assert.equal(c.messages.find(m=>m.type==='session')?.sessionId,state.sessionId)
      const text=c.messages.filter(m=>m.type==='llm'&&m.state==='delta').map(m=>m.text).join('');assert.match(text,/界面重启验证通过/)
      return {instancePreserved:true,sessionPreserved:true,text}
    }finally{c.close()}
  })
  process.exit(report.checks.some(c=>!c.ok)?1:0)
}
await check('public reference client and SDK are served',async()=>{
  for(const route of ['/demo','/voice-client.js','/demo-client.js'])assert.equal((await fetch('http://127.0.0.1:8090'+route,{signal:AbortSignal.timeout(5000)})).status,200)
})
await check('real agent emits expression/gesture synchronized with audio and renders choices',async()=>{
  const c=await connect()
  try {
    c.send({type:'query',requestId:'present',text:'请使用 voice_present 工具，expression=happy，gesture=nod，timing=next_sentence。然后使用 voice_ui 工具 operation=render，component 的 id=interactive-test，type=choices，title=交互测试，actions 包含一个 id=confirm、label=确认测试、prompt=请仅回复「按钮闭环成功」，不要调用任何工具 的按钮。最后只说「请选择」。不要调用 shell，不要创建文件。'})
    const end=await c.wait(()=>c.messages.find(m=>m.type==='turn.end'&&m.requestId==='present'))
    assert.equal(end.reason,'completed',JSON.stringify(c.messages.filter(m=>m.type==='error')))
    const cue=c.messages.find(m=>m.type==='presentation.cue'),render=c.messages.find(m=>m.type==='ui.render'&&m.component.id==='interactive-test')
    assert.ok(cue,JSON.stringify(c.messages.filter(m=>m.type==='llm')));assert.equal(cue.expression,'happy');assert.equal(cue.gesture,'nod');assert.ok(Number.isSafeInteger(cue.sampleOffset));assert.equal(cue.streamId,end.streamId)
    assert.ok(render,'agent did not render choices');card=render.component;assert.equal(card.type,'choices');assert.equal('prompt'in card.actions[0],false)
    assert.ok(c.messages.some(m=>m.type==='presentation.state'&&m.state==='speaking'))
    const audioEnd=c.messages.find(m=>m.type==='audio.end'&&m.turnId===end.turnId)
    c.send({type:'playback',turnId:end.turnId,streamId:end.streamId,state:'ended',playedSamples:audioEnd.samples})
    await c.wait(()=>c.messages.find(m=>m.type==='presentation.state'&&m.state==='idle'&&m.sequence>cue.sequence))
    return {expression:cue.expression,gesture:cue.gesture,sampleOffset:cue.sampleOffset,component:card.type,revision:card.revision,audioFrames:c.frames.length}
  }finally{c.close()}
})
await delay(200)
await check('UI survives reconnect; validated button click drives agent once',async()=>{
  assert.ok(card,'initial UI unavailable');const c=await connect()
  try {
    snapshot=await c.wait(()=>c.messages.find(m=>m.type==='ui.snapshot'))
    const restored=snapshot.components.find(x=>x.id===card.id);assert.equal(restored.instanceId,card.instanceId)
    const click={type:'ui.action',requestId:'click',componentId:card.id,instanceId:card.instanceId,revision:card.revision,actionId:'confirm'}
    c.send({...click,text:'forged prompt'});await c.wait(()=>c.messages.find(m=>m.code==='bad_ui_action'))
    c.send(click);const end=await c.wait(()=>c.messages.find(m=>m.type==='turn.end'&&m.requestId==='click'))
    assert.equal(end.reason,'completed',JSON.stringify(c.messages.filter(m=>m.type==='error')))
    const text=c.messages.filter(m=>m.type==='llm'&&m.state==='delta').map(m=>m.text).join('');assert.match(text,/按钮闭环成功/)
    const ends=c.messages.filter(m=>m.type==='turn.end').length;c.send(click)
    await c.wait(()=>c.messages.filter(m=>m.type==='turn.end').length>ends);assert.equal(c.messages.filter(m=>m.type==='turn.start'&&m.requestId==='click').length,1)
    c.send({...click,requestId:'stale'});await c.wait(()=>c.messages.find(m=>m.requestId==='stale'&&m.code==='stale_ui'))
    return {restored:true,buttonResult:text,duplicateExecuted:false}
  }finally{c.close()}
})
await check('real agent updates a progress component by revision and creates a typed form',async()=>{
  const c=await connect('validation-interaction-form')
  try {
    c.send({type:'query',requestId:'form',text:'请调用 voice_ui：先渲染 id=progress-test,type=progress,title=进度,value=0.25，再将同一组件 value 更新为0.75。接着渲染 id=form-test,type=form,title=填写计划，fields 包含一个 id=name,label=名字,type=text,required=true 的字段；actions 只有一个 id=submit,label=提交,prompt=请仅回复表单收到，不要调用任何工具。最后只说请填写。禁止调用 shell。'})
    const end=await c.wait(()=>c.messages.find(m=>m.type==='turn.end'&&m.requestId==='form'));assert.equal(end.reason,'completed')
    const updates=c.messages.filter(m=>m.type==='ui.render'&&m.component.id==='progress-test').map(m=>m.component)
    assert.ok(updates.length>=2);assert.equal(updates.at(-1).value,.75);assert.ok(updates.at(-1).revision>updates[0].revision)
    const form=c.messages.find(m=>m.type==='ui.render'&&m.component.id==='form-test')?.component;assert.ok(form)
    c.send({type:'ui.action',requestId:'bad-form',componentId:form.id,instanceId:form.instanceId,revision:form.revision,actionId:'submit',values:{}})
    await c.wait(()=>c.messages.find(m=>m.code==='bad_ui_values'))
    c.send({type:'ui.action',requestId:'good-form',componentId:form.id,instanceId:form.instanceId,revision:form.revision,actionId:'submit',values:{name:'小明'}})
    const result=await c.wait(()=>c.messages.find(m=>m.type==='turn.end'&&m.requestId==='good-form'));assert.equal(result.reason,'completed')
    return {progressRevisions:updates.map(c=>c.revision),formSubmitted:true}
  }finally{c.close()}
})
await check('voice-only v2 clients stay compatible and cannot submit UI actions',async()=>{
  const c=await connect('validation-interaction-voice',['turns','audio.framed'])
  try{assert.equal(c.messages.some(m=>m.type==='ui.snapshot'||m.type==='presentation.state'),false);c.send({type:'ui.sync'});await c.wait(()=>c.messages.find(m=>m.code==='unsupported_capability'));return {compatible:true}}finally{c.close()}
})
await check('prepare live interactive component for host restart',async()=>{
  const deviceId=`validation-ui-restart-${Date.now()}`,c=await connect(deviceId)
  try {
    c.send({type:'query',requestId:'seed-restart',text:'请调用 voice_ui 展示一张 choices 组件，id=restart-ui，title=重启恢复验证，expiresInMs=600000。仅一个按钮 id=continue,label=继续,prompt=请仅回复界面重启验证通过，不要调用任何工具。然后只说请点击。禁止调用 shell。'})
    const end=await c.wait(()=>c.messages.find(m=>m.type==='turn.end'));assert.equal(end.reason,'completed')
    const component=c.messages.find(m=>m.type==='ui.render'&&m.component.id==='restart-ui')?.component;assert.ok(component)
    const sessionId=c.messages.find(m=>m.type==='session')?.sessionId
    writeFileSync('/tmp/yusheng-ui-restart-state.json',JSON.stringify({deviceId,component,sessionId}),{mode:0o600})
    return {prepared:true,componentId:component.id,sessionId}
  }finally{c.close()}
})
console.log('REPORT',path);process.exit(report.checks.some(c=>!c.ok)?1:0)
