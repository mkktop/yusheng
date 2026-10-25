import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const directory = mkdtempSync(join(tmpdir(), 'yusheng-regression-'))
after(() => rmSync(directory, { recursive: true, force: true }))
await build({ entryPoints: ['src/connection.ts', 'src/llm.ts', 'src/audio.ts', 'src/settings.ts', 'src/server.ts', 'src/tts.ts', 'src/protocol.ts','src/interaction.ts','src/surface.ts'], outdir: directory, bundle: true, platform: 'node', format: 'esm', outExtension: { '.js': '.mjs' }, external: ['bufferutil','utf-8-validate'], banner: { js: "import { createRequire as __regCreateRequire } from 'node:module'; const require = __regCreateRequire(import.meta.url);" }, logLevel: 'silent' })
const load = name => import(pathToFileURL(join(directory, `${name}.mjs`)))
const { VoiceConnection } = await load('connection')
const { AgentBridge } = await load('llm')
const { AudioSender } = await load('audio')
const { VoiceServer } = await load('server')
const { synthesizeStream } = await load('tts')
const { abortable } = await load('protocol')
const { support, cue, component, interactionTools } = await load('interaction')
const { SurfaceStore } = await load('surface')
const { DEFAULT_SETTINGS, SettingsStore, maskSettings } = await load('settings')
const tick = () => new Promise(resolve => setTimeout(resolve, 10))
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
async function until(fn, ms = 2000) {
  const start = Date.now()
  while (!fn()) { if (Date.now() - start > ms) throw new Error('condition timed out'); await tick() }
}
function harness(extra = {}, version = 2, capabilities = ['audio.framed', 'playback', 'response.stop', 'conversation.select']) {
  const messages = [], binary = [], handles = []
  const bridge = {
    sessionId: (id, preset) => `voice-${id}${preset ? `-p-${preset}` : ''}`, release() {},
    turn: async (_id, _text, cb) => {
      const done = deferred(); handles.push({ ...done, cb, text:_text })
      return { sessionId: 'voice-device', done: done.promise, cancel() {} }
    },
  }
  const socket = { readyState: 1, bufferedAmount: 0, send(value) { Buffer.isBuffer(value) ? binary.push(value) : messages.push(JSON.parse(value)) }, close() { this.readyState = 3 } }
  const c = new VoiceConnection(socket, { settings: () => ({ ...DEFAULT_SETTINGS, maxTurnSeconds: 2 }), bridge, log() {}, allowConversation: (id, conv) => conv.startsWith(`${id}-`), ...extra })
  const send = m => c.handleMessage(JSON.stringify(m))
  if (version) send({ type: 'hello', version, deviceId: 'device', capabilities })
  const start = (text = 'hello', requestId = 'r1') => { send({ type: 'query', requestId, text }); return messages.findLast(m => m.type === 'turn.start') }
  return { c, socket, messages, binary, handles, send, start }
}

test('reject unsupported versions, anonymous devices, malformed messages and audio', () => {
  const h = harness({}, 0)
  for (const m of [{type:'hello',version:999,deviceId:'x'}, {type:'hello',version:2,deviceId:''}, null, [], {type:'hello',version:2,deviceId:'x',audio:{input:{encoding:'opus'}}}]) h.send(m)
  assert.deepEqual(h.messages.map(m => m.code), ['unsupported_version','bad_device_id','bad_message','bad_message','unsupported_audio'])
  h.c.handleClosed()
})

test('already cancelled operations still observe late provider rejections', async () => {
  const controller=new AbortController();controller.abort()
  await assert.rejects(abortable(Promise.reject(new Error('provider failure')),controller.signal))
  await tick()
})

test('ASR cancellation never starts an agent or sends stale results', async () => {
  const result = deferred(); let calls = 0, signal
  const h = harness({ transcribe: async (_pcm, options) => { signal = options.signal; return result.promise }, bridge: { sessionId: () => 'voice-device', release(){}, turn: async () => { calls++; throw new Error('must not execute') } } })
  h.send({type:'listen',state:'start',requestId:'r1'}); h.c.handleBinary(Buffer.alloc(16000)); h.send({type:'listen',state:'stop'})
  h.send({type:'abort'}); const count = h.messages.length; result.resolve('stale'); await tick()
  assert.equal(signal.aborted, true); assert.equal(calls, 0); assert.equal(h.messages.length, count)
  assert.equal(h.messages.filter(m => m.type === 'turn.end').length, 1)
  h.c.handleClosed()
})

test('old completion cannot clear the new turn or admit a third', async () => {
  const h = harness(); h.start(); await until(() => h.handles.length === 1)
  h.send({type:'abort'}); h.start('second','r2'); await until(() => h.handles.length === 2)
  h.handles[0].resolve({kind:'cancelled'}); await tick()
  assert.equal(h.c.describe().state, 'busy')
  h.start('third','r3'); assert.equal(h.messages.at(-1).code, 'busy')
  assert.equal(h.messages.filter(m => m.type === 'turn.end').length, 1)
  h.c.handleClosed(); h.handles[1].resolve({kind:'completed'})
})

test('TTS failure ends the turn as error, never success', async () => {
  const h = harness({ synthesize: async function* () { throw Object.assign(new Error('tts broken'),{code:'tts_broken'}) } })
  h.start(); await until(() => h.handles.length)
  h.handles[0].cb.onTextDelta('你好。'); h.handles[0].resolve({kind:'completed'})
  await until(() => h.messages.some(m => m.type === 'turn.end'))
  assert.equal(h.messages.find(m => m.type === 'turn.end').reason, 'error')
  assert.equal(h.messages.some(m => m.reason === 'completed'), false)
  h.c.handleClosed()
})

test('turn deadline includes ASR and hung synthesis', async () => {
  for (const input of ['listen','speak']) {
    const never = new Promise(() => {})
    const h = harness({ settings: () => ({...DEFAULT_SETTINGS,maxTurnSeconds:.04}), transcribe: () => never, synthesize: async function* () { await never } })
    if (input === 'listen') { h.send({type:'listen',state:'start',requestId:'r'}); h.c.handleBinary(Buffer.alloc(16000)); h.send({type:'listen',state:'stop'}) }
    else h.send({type:'speak',text:'hi',requestId:'r'})
    await until(() => h.messages.some(m => m.type === 'turn.end'))
    assert.equal(h.messages.find(m => m.type === 'turn.end').reason, 'timeout'); assert.equal(h.c.describe().state, 'ready')
    h.c.handleClosed()
  }
})

test('duplicate requests are replayed without executing again; conflicts rejected', async () => {
  const h = harness(); h.start(); await until(() => h.handles.length)
  h.start(); assert.equal(h.messages.at(-1).type,'request.duplicate')
  h.handles[0].resolve({kind:'completed'}); await until(() => h.messages.some(m => m.type === 'turn.end'))
  h.start(); assert.equal(h.messages.at(-1).type,'turn.end'); assert.equal(h.handles.length,1)
  h.start('different'); assert.equal(h.messages.at(-1).code,'request_conflict'); h.c.handleClosed()
})

test('busy capture, stale cancellation and invalid PCM do not damage state', () => {
  const h = harness(); h.send({type:'listen',state:'start',requestId:'r'})
  h.start('wrong','r2'); assert.equal(h.messages.at(-1).code,'busy')
  h.send({type:'turn.cancel',turnId:'other'}); assert.equal(h.messages.at(-1).code,'stale_turn')
  assert.equal(h.c.describe().state,'listening')
  h.c.handleBinary(Buffer.alloc(16001)); h.send({type:'listen',state:'stop'})
  assert.equal(h.messages.find(m => m.type === 'turn.end').reason,'error'); h.c.handleClosed()
})

test('response.stop leaves agent running and preserves text events', async () => {
  const h = harness(); const turn = h.start(); await until(() => h.handles.length)
  h.send({type:'response.stop',turnId:turn.turnId})
  assert.equal(h.c.describe().state,'busy')
  h.handles[0].cb.onTextDelta('继续完成任务。'); h.handles[0].resolve({kind:'completed'})
  await until(() => h.messages.some(m => m.type === 'turn.end'))
  assert.equal(h.messages.find(m => m.type === 'turn.end').responseStopped,true)
  assert.equal(h.messages.some(m => m.type === 'llm' && m.text === '继续完成任务。'),true)
  assert.equal(h.binary.length,0); h.c.handleClosed()
})

test('framed PCM preserves arbitrary chunks and validates playback receipts', async () => {
  const pcm = Buffer.alloc(2000, 7)
  const h = harness({ synthesize: async function* () { yield pcm.subarray(0,3); yield pcm.subarray(3,1923); yield pcm.subarray(1923) } })
  h.send({type:'speak',text:'test',requestId:'r'})
  await until(() => h.messages.some(m => m.type === 'turn.end'))
  const end = h.messages.find(m => m.type === 'turn.end')
  assert.deepEqual(Buffer.concat(h.binary.map(frame => frame.subarray(24))),pcm)
  assert.equal(h.binary[0].subarray(0,4).toString(),'YSV2')
  assert.equal(h.binary[1].readUInt32LE(8),1); assert.equal(h.binary[1].readDoubleLE(12),960)
  h.send({type:'playback',turnId:end.turnId,streamId:end.streamId,state:'ended',playedSamples:1001})
  assert.equal(h.messages.at(-1).code,'bad_playback')
  h.send({type:'playback',turnId:end.turnId,streamId:end.streamId,state:'ended',playedSamples:1000})
  assert.equal(h.messages.at(-1).type,'playback.ack'); h.c.handleClosed()
})

test('slow socket applies producer backpressure and cancellation wakes it', async () => {
  const controller = new AbortController(), frames = []
  const socket = { readyState:1, bufferedAmount:1024*1024, send:x=>frames.push(x) }
  const sender = new AudioSender(socket,controller.signal,1,false)
  let settled = false
  const producer = sender.push(Buffer.alloc(48000*7)).finally(() => { settled = true })
  await tick(); assert.equal(settled,false); assert.equal(frames.length,0)
  controller.abort(); await assert.rejects(producer)
})

test('negotiated playback flow pauses and resumes audio without dropping frames', async () => {
  const controller=new AbortController(),frames=[];let buffered=60000
  const sender=new AudioSender({readyState:1,bufferedAmount:0,send:x=>frames.push(x)},controller.signal,7,false,()=>buffered)
  await sender.push(Buffer.alloc(1920));const done=sender.finish()
  await tick();assert.equal(frames.length,0);buffered=0;await done
  assert.equal(frames.length,1);controller.abort()
})

test('stopping speech does not disguise a later agent failure', async () => {
  const h=harness(),turn=h.start();await until(()=>h.handles.length)
  h.send({type:'response.stop',turnId:turn.turnId});h.handles[0].resolve({kind:'error',error:'agent failed'})
  await until(()=>h.messages.some(m=>m.type==='turn.end'))
  assert.equal(h.messages.find(m=>m.type==='turn.end').reason,'error');h.c.handleClosed()
})

test('conversation selection is idle-only and keeps actual preset session identity', () => {
  const h = harness({ settings:()=>({...DEFAULT_SETTINGS,agentPreset:'work'}) })
  assert.equal(h.messages[0].sessionId,'voice-device-p-work')
  h.send({type:'conversation.select',conversationId:'device-next'})
  assert.equal(h.messages.at(-1).type,'conversation.selected')
  h.send({type:'conversation.select',conversationId:'other'})
  assert.equal(h.messages.at(-1).code,'bad_conversation'); h.c.handleClosed()
})

function host() {
  const listeners = new Map(), idle = deferred(), agents = new Map(), inputs = []
  let created = 0, cancelled = 0
  const agent = { session:{seq:20}, status:'idle', followup:m=>inputs.push(m), whenIdle:()=>idle.promise, cancel(){ cancelled++ } }
  const services = { agents:{ get:id=>agents.get(id), create:async ({sessionId})=>{created++;agents.set(sessionId,agent);return {agent}} }, sessions:{flush:async()=>{}}, agentDefaultModel:{currentSelection:()=>undefined} }
  const ctx = { get:n=>services[n], on:(name,fn)=>{const set=listeners.get(name)??new Set();listeners.set(name,set);set.add(fn);return ()=>set.delete(fn)} }
  const emit = (name,data)=>{for(const fn of listeners.get(name)??[])fn({agent,...data})}
  return { ctx,agent,idle,inputs,emit, count:()=>({created,cancelled,listeners:[...listeners.values()].reduce((n,s)=>n+s.size,0)}) }
}

test('session lease is claimed before async creation; cancellation detaches but retains lease', async () => {
  const h = host(), b = new AgentBridge(h.ctx), text = []
  const pending = b.turn('device','one',{onTextDelta:x=>text.push(x),onEnd(){}})
  await assert.rejects(b.turn('device','two',{onTextDelta(){},onEnd(){}}),{code:'session_busy'})
  const turn = await pending
  h.emit('agent/assistant-stream',{frame:{chunk:{type:'text-delta',text:'one'}}})
  assert.deepEqual(text,['one']); turn.cancel(); assert.equal((await turn.done).kind,'cancelled')
  assert.equal(h.count().cancelled,1); assert.equal(h.count().listeners,0)
  await assert.rejects(b.turn('device','three',{onTextDelta(){},onEnd(){}}),{code:'session_busy'})
  h.idle.resolve(); await tick(); assert.equal(h.count().created,1)
})

test('abort during agent preparation prevents followup', async () => {
  const h = host(), ready = deferred(), controller = new AbortController()
  const original = h.ctx.get('agents').create
  h.ctx.get('agents').create = async args=>{await ready.promise;return original(args)}
  const b = new AgentBridge(h.ctx)
  const result = b.turn('device','must not run',{onTextDelta(){},onEnd(){}},'',{signal:controller.signal})
  controller.abort(); ready.resolve(); await assert.rejects(result); assert.equal(h.inputs.length,0)
})

test('host child join false means quiescent, true means recheck parent', async () => {
  const h=host(); let joins=0
  const original=h.ctx.get
  h.ctx.get=name=>name==='subagents'?{waitForChildren:async()=>++joins===1}:original(name)
  h.idle.resolve()
  const turn=await new AgentBridge(h.ctx).turn('child-test','hello',{onTextDelta(){},onEnd(){}})
  const result=await Promise.race([turn.done,new Promise((_,reject)=>setTimeout(()=>reject(new Error('failed to settle')),500))])
  assert.equal(result.kind,'completed');assert.equal(joins,2)
})

test('host model selection is installed once and refreshed for every new turn', async () => {
  const h=host(),original=h.ctx.get;let model='one',ref,installed=0
  h.agent.ctx={};h.ctx.effect=()=>{}
  h.ctx.get=name=>name==='agentDefaultModel'?{currentSelection:()=>({provider:'p',model})}:original(name)
  const b=new AgentBridge(h.ctx)
  b.selectionApi=Promise.resolve({installModelSelection(_ctx,selection){installed++;ref=selection;return ()=>{}}})
  h.idle.resolve();await(await b.turn('device','one',{onTextDelta(){},onEnd(){}})).done
  assert.equal(ref.current.model,'one');model='two'
  await(await b.turn('device','two',{onTextDelta(){},onEnd(){}})).done
  assert.equal(ref.current.model,'two');assert.equal(installed,1)
})

test('prefix marker and fallback session survive reconnect and bridge restart', async () => {
  const h = host(), path = join(directory,'sessions.json')
  writeFileSync(path,JSON.stringify({device:'voice-device-fallback'}))
  h.ctx.get('agents').get = id => id === 'voice-device-fallback' ? h.agent : undefined
  const b = new AgentBridge(h.ctx,path)
  assert.equal(b.sessionId('device'),'voice-device-fallback')
  h.idle.resolve()
  const cb = {onTextDelta(){},onEnd(){}}
  await (await b.turn('device','one',cb,'',{promptPrefix:'voice style'})).done
  const resumed = new AgentBridge(h.ctx,path)
  await (await resumed.turn('device','two',cb,'',{promptPrefix:'voice style'})).done
  assert.equal(h.inputs[0].content[0].text.includes('voice style'),true)
  assert.equal(h.inputs[1].content[0].text,'two')
  for(const message of h.inputs) {assert.equal(message.role,'user');assert.match(message.id,/^[a-f0-9-]{36}$/)}
})

test('settings separate credentials, persist atomically, validate input and fail closed', () => {
  const path=join(directory,'settings.json'), store=new SettingsStore(path), s=store.get()
  assert.ok(s.adminToken.length>24); assert.notEqual(s.token,s.adminToken)
  const token=store.issueDevice('dev'); assert.equal(store.get().deviceTokens.dev,token)
  const masked=maskSettings({...store.get(),minimaxApiKey:'secret'})
  assert.equal(JSON.stringify(masked).includes('secret'),false); assert.equal('adminToken' in masked,false)
  assert.throws(()=>store.update(null)); assert.deepEqual(store.update({adminToken:'bad',deviceTokens:{}}).rejected,['adminToken','deviceTokens'])
  store.revokeDevice('dev'); assert.equal(store.get().deviceTokens.dev,undefined)
  const copy=new SettingsStore(path); assert.equal(copy.get().adminToken,s.adminToken)
  writeFileSync(path,'null'); assert.throws(()=>new SettingsStore(path),/refusing to reset credentials/)
})

test('v1 remains raw PCM and legacy completion events', async () => {
  const h = harness({ synthesize:async function*(){yield Buffer.alloc(200)} },1)
  h.send({type:'speak',text:'hello'}); await until(()=>h.messages.some(m=>m.type==='tts'&&m.state==='stop'))
  assert.equal(h.binary[0].length,200); assert.equal(h.messages.some(m=>m.type==='turn.end'),false)
  assert.equal(h.messages.at(-1).reason,'done'); h.c.handleClosed()
})

test('real HTTP/WS server isolates admin/device credentials, ownership, revocation and shutdown', async () => {
  const store = new SettingsStore(join(directory,'server-settings.json'))
  const server = new VoiceServer(store,{sessionId:id=>`voice-${id}`,currentModel:()=>undefined,listPresets:async()=>[],release(){}},{host:'127.0.0.1',port:0,assetsRoot:process.cwd()},()=>{})
  await server.start()
  const base = `http://127.0.0.1:${server.httpServer.address().port}`
  const headers = {'x-voice-token':store.get().adminToken,'content-type':'application/json'}
  const peers = []
  const open = token => new Promise((resolve,reject)=>{
    const socket=new WebSocket(`${base.replace('http','ws')}/voice?token=${token}`),messages=[]
    peers.push(socket)
    socket.onmessage=ev=>messages.push(JSON.parse(ev.data))
    socket.onopen=()=>resolve({socket,messages,send:m=>socket.send(JSON.stringify(m))}); socket.onerror=reject
  })
  try {
    assert.equal((await fetch(base+'/status')).status,401)
    assert.match(await(await fetch(base+'/demo')).text(),/智能界面/)
    assert.match(await(await fetch(base+'/voice-client.js')).text(),/VoiceClient/)
    assert.equal((await fetch(base+'/status',{headers:{'x-voice-token':store.get().token}})).status,401)
    assert.equal((await fetch(base+'/settings',{method:'PUT',headers,body:'null'})).status,400)
    assert.equal((await fetch(base+'/settings',{method:'PUT',headers,body:JSON.stringify({promptPrefix:'x'.repeat(40000)})})).status,413)
    assert.equal((await fetch(base+'/status',{headers:{...headers,origin:'https://unrelated.example'}})).status,403)
    const issued = await (await fetch(base+'/devices',{method:'POST',headers,body:JSON.stringify({deviceId:'bound'})})).json()
    assert.ok(issued.token)
    const wrong=await open(issued.token); wrong.send({type:'hello',version:2,deviceId:'other'})
    await until(()=>wrong.messages.length); assert.equal(wrong.messages[0].code,'device_in_use')
    wrong.socket.close()
    const first=await open(issued.token); first.send({type:'hello',version:2,deviceId:'bound'})
    await until(()=>first.messages.length); assert.equal(first.messages[0].type,'welcome')
    const second=await open(issued.token); second.send({type:'hello',version:2,deviceId:'bound'})
    await until(()=>second.messages.length); assert.equal(second.messages[0].code,'device_in_use')
    let revoked=false; first.socket.onclose=()=>{revoked=true}
    await fetch(base+'/devices/bound',{method:'DELETE',headers}); await until(()=>revoked)
    assert.equal(store.get().deviceTokens.bound,undefined)
    const legacy=await open(store.get().token); legacy.send({type:'hello',version:1,deviceId:'legacy'})
    await until(()=>legacy.messages.length); assert.equal(legacy.messages[0].type,'welcome')
    let closed=false; legacy.socket.onclose=()=>{closed=true}; server.stop(); await until(()=>closed)
  } finally { for(const socket of peers)socket.close(); server.stop() }
})

test('TTS handles unterminated final lines, recap tails and truncated/malformed streams', async () => {
  const original=globalThis.fetch
  const event=(audio,status)=>'data: '+JSON.stringify({data:{audio,status}})
  try {
    for (const [payload,expected] of [[event('01020304',1)+'\n\n'+event('010203040506',2),'010203040506'],[event('01020304',1)+'\n\n'+event('05060708090a',2),'0102030405060708090a']]) {
      globalThis.fetch=async()=>new Response(payload,{headers:{'content-type':'text/event-stream'}})
      const chunks=[]; for await(const chunk of synthesizeStream('hi',{apiKey:'mock'}))chunks.push(chunk)
      assert.equal(Buffer.concat(chunks).toString('hex'),expected)
    }
    for(const payload of ['data: broken\n',event('0102',1)+'\n',event('abc',2)+'\n']) {
      globalThis.fetch=async()=>new Response(payload)
      await assert.rejects(async()=>{for await(const _ of synthesizeStream('hi',{apiKey:'mock'})){} })
    }
  } finally {globalThis.fetch=original}
})

const interactionCaps=['audio.framed','playback','presentation.state','presentation.cue','ui.render']
const choices=()=>component({id:'plan',type:'choices',title:'下一步',actions:[{id:'chat',label:'聊一聊',prompt:'用户选择轻松聊天，请问一个简单的问题。'}]},support(undefined))

test('client manifests and declarative effects reject unsupported or executable fields',()=>{
  const s=support({expressions:['happy'],gestures:[],components:['choices']})
  assert.throws(()=>cue({expression:'sad'},s));assert.throws(()=>cue({expression:'happy',script:'alert(1)'},s))
  assert.throws(()=>component({id:'x',type:'card',title:'x'},s))
  assert.throws(()=>component({...choices(),html:'<script>x</script>'},support(undefined)))
  assert.throws(()=>component({id:'x',type:'choices',title:'x',actions:[{id:'a',label:'a',prompt:'a'},{id:'a',label:'b',prompt:'b'}]},s))
  const tools=interactionTools(s,['presentation.cue','ui.render'],()=>({}),()=>{})
  assert.equal('gesture' in tools[0].parameters.properties,false)
})

test('server UI state persists, hides action prompts, consumes once and separates device/conversation/preset',()=>{
  const path=join(directory,'ui.json'),store=new SurfaceStore(path),key=SurfaceStore.key('a','a','')
  const card=store.render(key,choices(),'origin')
  assert.equal('prompt' in card.actions[0],false)
  assert.deepEqual(new SurfaceStore(path).snapshot(key),[card])
  assert.deepEqual(store.snapshot(SurfaceStore.key('b','a','')),[])
  assert.deepEqual(store.snapshot(SurfaceStore.key('a','a','work')),[])
  const action=store.prepare(key,card.id,card.revision,card.instanceId,'chat',{})
  assert.match(action.text,/用户选择轻松聊天/)
  assert.equal(action.consume().disabled,true)
  assert.throws(()=>store.prepare(key,card.id,card.revision,card.instanceId,'chat',{}))
  const next=store.render(key,choices(),'next');assert.ok(next.revision>card.revision);assert.notEqual(next.instanceId,card.instanceId)
  assert.throws(()=>store.prepare(key,next.id,next.revision,card.instanceId,'chat',{}))
})

test('form values are typed, bounded and restricted to declared fields',()=>{
  const s=new SurfaceStore(),key='form',form=component({id:'form',type:'form',title:'计划',fields:[{id:'name',label:'名字',type:'text',required:true},{id:'count',label:'数量',type:'number',min:1,max:5},{id:'mode',label:'模式',type:'select',options:[{label:'慢',value:'slow'}]}],actions:[{id:'submit',label:'提交',prompt:'处理用户填写的计划。'}]},support(undefined))
  const c=s.render(key,form,'t')
  const prepare=v=>s.prepare(key,c.id,c.revision,c.instanceId,'submit',v)
  assert.throws(()=>prepare({}));assert.throws(()=>prepare({name:'x',count:6}));assert.throws(()=>prepare({name:'x',count:'2'}));assert.throws(()=>prepare({name:'x',mode:'fast'}));assert.throws(()=>prepare({name:'x',extra:'inject'}))
  assert.match(prepare({name:'小明',count:2,mode:'slow'}).text,/小明/)
})

test('UI expires and old instance cannot act after expired scope is reclaimed',()=>{
  const store=new SurfaceStore(),original=Date.now,now=Date.now()
  try {
    const c=store.render('first',choices(),'t')
    Date.now=()=>now+400000
    assert.deepEqual(store.snapshot('first'),[])
    assert.throws(()=>store.prepare('first',c.id,c.revision,c.instanceId,'chat',{}))
    store.render('second',choices(),'t');const fresh=store.render('first',choices(),'t2')
    assert.throws(()=>store.prepare('first',fresh.id,fresh.revision,c.instanceId,'chat',{}))
  }finally{Date.now=original}
})

test('agent effects become synchronized cue and UI events, then validated clicks start a new turn',async()=>{
  const h=harness({synthesize:async function*(){yield Buffer.alloc(1920)}},2,interactionCaps)
  const turn=h.start();await until(()=>h.handles.length)
  const cb=h.handles[0].cb
  const card=cb.onClientEffect({kind:'render',component:choices()})
  const rendered=h.messages.find(m=>m.type==='ui.render').component
  assert.equal(card.componentId,'plan');assert.equal(rendered.disabled,false)
  cb.onClientEffect({kind:'cue',cue:cue({expression:'happy',gesture:'nod',timing:'next_sentence'},support(undefined))})
  assert.equal(h.messages.some(m=>m.type==='presentation.cue'),false)
  cb.onTextDelta('你好。');h.handles[0].resolve({kind:'completed'})
  await until(()=>h.messages.some(m=>m.type==='turn.end'))
  const effect=h.messages.find(m=>m.type==='presentation.cue');assert.equal(effect.sampleOffset,0);assert.equal(effect.turnId,turn.turnId)
  const click={type:'ui.action',requestId:'click',componentId:'plan',instanceId:rendered.instanceId,revision:rendered.revision,actionId:'chat',values:{}}
  h.send({...click,text:'客户端任意指令'});assert.equal(h.messages.at(-1).code,'bad_ui_action')
  h.send(click);await until(()=>h.handles.length===2);assert.match(h.handles[1].text,/用户选择轻松聊天/)
  h.handles[1].resolve({kind:'completed'});await until(()=>h.messages.some(m=>m.type==='turn.end'&&m.requestId==='click'))
  h.send(click);assert.equal(h.handles.length,2);assert.equal(h.messages.at(-1).type,'turn.end')
  h.send({...click,requestId:'again'});assert.equal(h.messages.at(-1).code,'stale_ui');h.c.handleClosed()
})

test('cancelled turn removes its interactive components and queued cues',async()=>{
  const h=harness({},2,interactionCaps);h.start();await until(()=>h.handles.length)
  h.handles[0].cb.onClientEffect({kind:'render',component:choices()})
  h.handles[0].cb.onClientEffect({kind:'cue',cue:cue({expression:'happy',timing:'next_sentence'},support(undefined))})
  h.send({type:'abort'})
  assert.equal(h.messages.some(m=>m.type==='ui.remove'&&m.componentId==='plan'),true)
  assert.equal(h.messages.some(m=>m.type==='presentation.cue'),false)
  h.handles[0].cb.onTextDelta('旧轮');h.handles[0].resolve({kind:'cancelled'});await tick()
  assert.equal(h.messages.filter(m=>m.type==='turn.end').length,1);h.c.handleClosed()
})

test('UI snapshots survive reconnect, and busy clicks are not consumed',async()=>{
  const surface=new SurfaceStore(),h=harness({surface},2,interactionCaps)
  h.start();await until(()=>h.handles.length);h.handles[0].cb.onClientEffect({kind:'render',component:choices()});h.handles[0].resolve({kind:'completed'})
  await until(()=>h.messages.some(m=>m.type==='turn.end'));h.c.handleClosed()
  const next=harness({surface},2,interactionCaps),c=next.messages.find(m=>m.type==='ui.snapshot').components[0]
  next.start();await until(()=>next.handles.length)
  const click={type:'ui.action',requestId:'click',componentId:c.id,revision:c.revision,instanceId:c.instanceId,actionId:'chat'}
  next.send(click);assert.equal(next.messages.at(-1).code,'busy')
  next.handles[0].resolve({kind:'completed'});await until(()=>next.messages.some(m=>m.type==='turn.end'))
  next.send(click);await until(()=>next.handles.length===2);next.c.handleClosed();next.handles[1].resolve({kind:'cancelled'})
})

test('voice-only clients do not register presentation tools or receive UI state',async()=>{
  const h=harness();h.start();await until(()=>h.handles.length)
  assert.equal(h.handles[0].cb.onClientEffect,undefined)
  h.send({type:'ui.sync'});assert.equal(h.messages.at(-1).code,'unsupported_capability');h.c.handleClosed();h.handles[0].resolve({kind:'cancelled'})
  assert.equal(h.messages.some(m=>m.type==='ui.snapshot'||m.type==='presentation.state'),false)
})

test('presentation tools use agent-scoped registry and dispose after settlement',async()=>{
  const h=host(),definitions=new Map();let disposed=0
  h.agent.ctx={get:name=>name==='tools'?{register:def=>{definitions.set(def.name,def);return()=>{definitions.delete(def.name);disposed++}}}:undefined}
  const bridge=new AgentBridge(h.ctx);bridge.selectionApi=Promise.resolve({installModelSelection(){return()=>{}}})
  const effects=[],turn=await bridge.turn('surface','hello',{onTextDelta(){},onEnd(){},onClientEffect:e=>{effects.push(e);return {sent:true}}},'',{presentation:support(undefined),capabilities:['presentation.cue','ui.render']})
  assert.deepEqual([...definitions.keys()],['voice_present','voice_ui'])
  const exec={agent:h.agent,signal:new AbortController().signal}
  await definitions.get('voice_present').execute({expression:'happy'},exec)
  await assert.rejects(definitions.get('voice_present').execute({expression:'happy'},{...exec,agent:{}}))
  assert.equal(effects.length,1);h.idle.resolve();await turn.done;assert.equal(disposed,2);assert.equal(definitions.size,0)
})
