import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const directory = mkdtempSync(join(tmpdir(), 'yusheng-regression-'))
after(() => rmSync(directory, { recursive: true, force: true }))
await build({ entryPoints: ['src/connection.ts', 'src/llm.ts', 'src/audio.ts', 'src/settings.ts', 'src/server.ts', 'src/tts.ts', 'src/protocol.ts','src/interaction.ts','src/surface.ts','src/persona.ts','src/management.ts','src/client/management-client.ts','src/clients.ts','src/client-memory.ts'], outdir: directory, bundle: true, platform: 'node', format: 'esm', outExtension: { '.js': '.mjs' }, external: ['bufferutil','utf-8-validate'], banner: { js: "import { createRequire as __regCreateRequire } from 'node:module'; const require = __regCreateRequire(import.meta.url);" }, logLevel: 'silent' })
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
const { DEFAULT_PERSONA, VOICE_PRESET_ID, voiceSystemPrompt } = await load('persona')
const { registerManagement, handleManagement, MANAGEMENT_PATH } = await load('management')
const { request: managementClient, hostManagementUrl } = await load('client/management-client')
const { ClientStore } = await load('clients')
const { memoryTool } = await load('client-memory')
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
  const c = new VoiceConnection(socket, { settings: () => ({ ...DEFAULT_SETTINGS, agentPreset:'', maxTurnSeconds: 2 }), bridge, log() {}, allowConversation: (id, conv) => conv.startsWith(`${id}-`), ...extra })
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
  const h=host(),original=h.ctx.get;let model='one',ref,installed=0,removed=0
  const disposers=[];h.agent.ctx={};h.ctx.effect=initialize=>disposers.push(initialize())
  h.ctx.get=name=>name==='agentDefaultModel'?{currentSelection:()=>({provider:'p',model})}:original(name)
  const b=new AgentBridge(h.ctx)
  b.selectionApi=Promise.resolve({installModelSelection(_ctx,selection){installed++;ref=selection;return ()=>{removed++}}})
  h.idle.resolve();await(await b.turn('device','one',{onTextDelta(){},onEnd(){}})).done
  assert.equal(ref.current.model,'one');model='two'
  await(await b.turn('device','two',{onTextDelta(){},onEnd(){}})).done
  assert.equal(ref.current.model,'two');assert.equal(installed,1)
  assert.equal(removed,0);for(const stop of disposers)stop();assert.equal(removed,1)
})

test('voice persona updates the same durable conversation through scoped system sections', async () => {
  const h=host(),sections=new Set(),seen=[],contexts=[],b=new AgentBridge(h.ctx)
  b.selectionApi=Promise.resolve({installModelSelection(){return()=>{}}})
  h.agent.ctx={get:name=>name==='systemPrompt'?{section(section){sections.add(section);seen.push(section);return()=>sections.delete(section)},context(context){sections.add(context);contexts.push(context);return()=>sections.delete(context)}}:undefined}
  h.idle.resolve()
  const first={...DEFAULT_PERSONA,assistantName:'小榆',userTitle:'小林',personalityNotes:'保留字面量 {{unknown}}'}
  const cb={onTextDelta(){},onEnd(){}}
  await(await b.turn('persona-device','记住口令',cb,'',{persona:first,promptPrefix:'请认真倾听'})).done
  assert.equal(sections.size,0);assert.match(seen[0].text,/小榆/);assert.match(seen[0].text,/小林/);assert.match(seen[0].text,/\{\{unknown\}\}/)
  assert.equal(seen[0].interpolate,false);assert.equal(seen[0].name,'deployment:persona-prefix')
  assert.equal(contexts[0].required,true);assert.equal(contexts[0].interpolate,false);assert.match(contexts[0].text,/小榆/)
  await(await b.turn('persona-device','口令是什么',cb,'',{persona:{...first,assistantName:'小霁',personality:'professional'}})).done
  assert.match(seen[1].text,/小霁/);assert.match(seen[1].text,/专业干练/);assert.equal(seen[1].text.includes('小榆'),false)
  assert.match(contexts[1].text,/小霁/);assert.equal(contexts[1].text.includes('小榆'),false)
  assert.deepEqual(h.inputs.map(m=>m.content[0].text),['记住口令','口令是什么']);assert.equal(h.count().created,1);assert.equal(sections.size,0)
  assert.match(voiceSystemPrompt(first),/没有可用的客户端表现工具/)
  assert.match(voiceSystemPrompt(first,'',{expressions:['happy']},true),/voice_present/)
})

test('cancelled voice persona stays scoped until host settlement and is removed on failure', async () => {
  for(const failure of [false,true]){
    const h=host(),sections=new Set(),b=new AgentBridge(h.ctx)
    b.selectionApi=Promise.resolve({installModelSelection(){return()=>{}}})
    const register=section=>{sections.add(section);return()=>sections.delete(section)}
    h.agent.ctx={get:name=>name==='systemPrompt'?{section:register,context:register}:undefined}
    if(failure)h.agent.followup=()=>{throw new Error('provider rejected')}
    const turn=await b.turn('persona-device','hello',{onTextDelta(){},onEnd(){}},'',{persona:DEFAULT_PERSONA})
    if(failure){assert.equal((await turn.done).kind,'error');assert.equal(sections.size,0)}
    else {assert.equal(sections.size,2);turn.cancel();assert.equal((await turn.done).kind,'cancelled');assert.equal(sections.size,2);h.idle.resolve();await until(()=>sections.size===0)}
  }
})

test('preset roster uses display API and rejects string diagnostics before creating an agent', async () => {
  const h=host(),original=h.ctx.get,b=new AgentBridge(h.ctx)
  h.ctx.get=name=>name==='agentPresets'?{defaultId:'good',list:async()=>[{id:'good'},{id:'broken',broken:'missing dependency'}]}:original(name)
  assert.deepEqual(await b.listPresets(),[{id:'good',name:undefined,isDefault:true,broken:undefined},{id:'broken',name:undefined,isDefault:false,broken:true,problem:'missing dependency'}])
  await assert.rejects(b.agentFor('device','broken'),{code:'invalid_preset'});assert.equal(h.count().created,0)
})

test('a failing persona disposer cannot strand the conversation lease', async () => {
  const h=host(),b=new AgentBridge(h.ctx),warnings=[]
  b.selectionApi=Promise.resolve({installModelSelection(){return()=>{}}})
  h.ctx.logger={warn:message=>warnings.push(message)}
  h.agent.ctx={get:name=>name==='systemPrompt'?{section(){return()=>{throw new Error('scope already disposed')}},context(){return()=>{}}}:undefined}
  h.idle.resolve();const cb={onTextDelta(){},onEnd(){}}
  assert.equal((await(await b.turn('device','one',cb,'',{persona:DEFAULT_PERSONA})).done).kind,'completed')
  assert.equal((await(await b.turn('device','two',cb,'',{persona:DEFAULT_PERSONA})).done).kind,'completed')
  assert.equal(warnings.length,2)
})

test('persona settings validate, persist, migrate older config and preserve credentials', () => {
  const path=join(directory,'persona-settings.json'),store=new SettingsStore(path),before=store.get()
  assert.equal(before.agentPreset,VOICE_PRESET_ID)
  const update=store.update({assistantName:' 小榆 ',assistantRole:'生活助手',userTitle:'小林',personality:'lively',personalityNotes:'带一点幽默',replyStyle:'natural',presentationStyle:'expressive'})
  assert.deepEqual(update.rejected,[]);assert.equal(update.settings.assistantName,'小榆')
  assert.equal(maskSettings(update.settings).personalityNotes,'带一点幽默')
  const invalid=store.update({assistantName:'  ',assistantRole:'',userTitle:'line\nbreak',personality:'invalid',replyStyle:'invalid',presentationStyle:null,personalityNotes:'x'.repeat(2001)})
  assert.deepEqual(new Set(invalid.rejected),new Set(['assistantName','assistantRole','userTitle','personality','replyStyle','presentationStyle','personalityNotes']))
  const loaded=new SettingsStore(path).get();assert.equal(loaded.assistantName,'小榆');assert.equal(loaded.adminToken,before.adminToken);assert.equal(loaded.token,before.token)
  const old={...loaded,agentPreset:''};for(const key of Object.keys(DEFAULT_PERSONA))delete old[key]
  writeFileSync(path,JSON.stringify(old));const migrated=new SettingsStore(path).get()
  assert.equal(migrated.assistantName,'语声');assert.equal(migrated.agentPreset,'');assert.equal(migrated.adminToken,before.adminToken)
  old.promptPrefix='你是语音助手。始终用简短、口语化的中文回答（通常不超过三句话），不要使用 Markdown、代码块或列表。'
  writeFileSync(path,JSON.stringify(old));assert.equal(new SettingsStore(path).get().promptPrefix,'')
  old.promptPrefix='保留我的自定义要求';writeFileSync(path,JSON.stringify(old));assert.equal(new SettingsStore(path).get().promptPrefix,old.promptPrefix)
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
    const special=await(await fetch(base+'/devices',{method:'POST',headers,body:JSON.stringify({deviceId:'constructor'})})).json()
    const specialPeer=await open(special.token);specialPeer.send({type:'hello',version:2,deviceId:'constructor'})
    await until(()=>specialPeer.messages.length);assert.equal(specialPeer.messages[0].type,'welcome')
    let specialClosed=false;specialPeer.socket.onclose=()=>{specialClosed=true}
    await fetch(base+'/devices/constructor',{method:'DELETE',headers});await until(()=>specialClosed)
    const inventory=await(await fetch(base+'/clients',{headers})).json()
    assert.equal(inventory.clients.find(c=>c.deviceId==='constructor').credentialConfigured,false)
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

test('dsh management uses the owner-only carrier and manages settings with zero voice clients', async () => {
  const store=new SettingsStore(join(directory,'native-management.json'))
  const server=new VoiceServer(store,{currentModel:()=>undefined,listPresets:async()=>[]},{host:'127.0.0.1',port:0},()=>{})
  let route,disposed=false
  const stop=registerManagement({connection:{fetch:{register:value=>{route=value;return()=>{disposed=true}}}}},server)
  assert.equal(route.path,MANAGEMENT_PATH);assert.deepEqual(route.methods,['POST']);assert.equal(route.requestBody,'buffered')
  const call=(path,method='GET',body)=>route.fetch(new Request('http://dsh.internal'+MANAGEMENT_PATH,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({path,method,...(body===undefined?{}:{body})})}))
  await server.start()
  try{
    const status=await(await call('/status')).json();assert.equal(status.clients.length,0);assert.ok(new URL(status.endpoint).port!=='0')
    const raw=await(await call('/settings')).text();assert.equal(raw.includes(store.get().adminToken),false)
    const saved=await(await call('/settings','PUT',{assistantName:'原生管理测试'})).json()
    assert.equal(saved.settings.assistantName,'原生管理测试');assert.deepEqual(saved.rejected,[])
    assert.equal(new SettingsStore(store.path).get().assistantName,'原生管理测试')
    const device=await(await call('/devices','POST',{deviceId:'native-device'})).json();assert.ok(device.token)
    assert.equal((await call('/devices/native-device','DELETE')).status,200);assert.equal(store.get().deviceTokens['native-device'],undefined)
    const rejected=await(await call('/settings','PUT',{adminToken:'override'})).json();assert.deepEqual(rejected.rejected,['adminToken'])
    const base=`http://127.0.0.1:${server.httpServer.address().port}`
    assert.equal((await fetch(base+'/settings')).status,401)
    assert.equal((await fetch(base+'/settings',{headers:{'x-voice-token':store.get().token}})).status,401)
  }finally{server.stop();await stop()}
  assert.equal(disposed,true);assert.equal((await call('/settings')).status,503)
})

test('native management refuses arbitrary URLs, paths, methods and oversized envelopes', async () => {
  let calls=0
  const server={managementRequest:async()=>{calls++;return Response.json({ok:true})}}
  const call=(envelope,headers={'content-type':'application/json'})=>handleManagement(new Request('http://dsh.internal'+MANAGEMENT_PATH,{method:'POST',headers,body:typeof envelope==='string'?envelope:JSON.stringify(envelope)}),server)
  for(const envelope of [null,[],{path:'http://example.invalid',method:'GET'},{path:'/demo',method:'GET'},{path:'/settings?token=x',method:'GET'},{path:'/settings',method:'PATCH'},{path:'/settings',method:'GET',body:{}},{path:'/devices/../settings',method:'DELETE'},{path:'/devices/a%2fb',method:'DELETE'},{path:'/settings',method:'GET',url:'http://example.invalid'}])assert.equal((await call(envelope)).status,400)
  assert.equal((await call('{')).status,400)
  assert.equal((await call('{}',{'content-type':'text/plain'})).status,415)
  assert.equal((await call('x'.repeat(32769))).status,413)
  assert.equal((await call('{}',{'content-type':'application/json','content-length':'40000'})).status,413)
  assert.equal(calls,0)
})

test('settings client reuses dsh cookies and only external mode transmits an admin token', async () => {
  const original=globalThis.fetch,document=globalThis.document,calls=[]
  try{
    globalThis.document={baseURI:'https://host.example/nested/dsh/'}
    assert.equal(hostManagementUrl(),'https://host.example/nested/dsh/api/yusheng-voice/manage')
    globalThis.fetch=async(url,options)=>{calls.push({url,options});return Response.json({ok:true})}
    await managementClient({mode:'host',baseUrl:hostManagementUrl()},'/settings','PUT',{assistantName:'小语'})
    assert.equal(calls[0].options.credentials,'same-origin');assert.equal(calls[0].options.method,'POST')
    assert.equal('x-voice-token' in calls[0].options.headers,false)
    assert.deepEqual(JSON.parse(calls[0].options.body),{path:'/settings',method:'PUT',body:{assistantName:'小语'}})
    await managementClient({mode:'external',baseUrl:'https://external.example',token:'test-admin-token'},'/status')
    assert.equal(calls[1].url,'https://external.example/status');assert.equal(calls[1].options.credentials,'omit')
    assert.equal(calls[1].options.headers['x-voice-token'],'test-admin-token');assert.equal('body' in calls[1].options,false)
    for(const [status,pattern] of [[401,/登录已失效/],[403,/无管理权限/],[404,/确认插件已升级/]]){
      globalThis.fetch=async()=>new Response('not json',{status})
      await assert.rejects(managementClient({mode:'host',baseUrl:hostManagementUrl()},'/settings'),pattern)
    }
  }finally{globalThis.fetch=original;if(document===undefined)delete globalThis.document;else globalThis.document=document}
})

test('client configurations are independent snapshots, including model, credentials and persona',()=>{
  const store=new SettingsStore(join(directory,'client-template.json'))
  store.update({assistantName:'初始助手',minimaxApiKey:'initial-secret'})
  const clients=new ClientStore(join(directory,'profiles'),()=>store.get(),()=>({provider:'p',model:'m'}))
  clients.ensure('a','客户端 A');clients.ensure('b','客户端 B')
  const changed=clients.update('a',{assistantName:'小甲',ttsSpeed:1.5,minimaxApiKey:'a-secret',llmProvider:'pa',llmModel:'ma',token:'bad',adminToken:'bad'})
  assert.deepEqual(changed.rejected,['token','adminToken']);assert.equal(changed.settings.assistantName,'小甲')
  assert.equal(JSON.stringify(changed).includes('a-secret'),false)
  store.update({assistantName:'新模板',minimaxApiKey:'new-template-secret',ttsSpeed:2})
  assert.equal(clients.settings('b').assistantName,'初始助手');assert.equal(clients.settings('b').minimaxApiKey,'initial-secret');assert.equal(clients.settings('b').ttsSpeed,1)
  assert.equal(clients.settings('a').llmModel,'ma');assert.equal(clients.settings('b').llmModel,'m')
  clients.ensure('c');assert.equal(clients.settings('c').assistantName,'新模板')
  const reloaded=new ClientStore(clients.root,()=>store.get());assert.equal(reloaded.settings('a').assistantName,'小甲');assert.equal(reloaded.settings('b').minimaxApiKey,'initial-secret')
  assert.throws(()=>clients.directory('../a'));assert.throws(()=>clients.profile('missing'))
})

test('client long-term memory persists, rejects stale edits, and cannot forget another client fact',async()=>{
  const clients=new ClientStore(join(directory,'memories'),()=>DEFAULT_SETTINGS)
  clients.ensure('a');clients.ensure('b')
  const doc=clients.remember('a','喜欢青柠 {{literal}}'),id=doc.items[0].id
  assert.equal(clients.memory('b').items.length,0);assert.equal(clients.remember('a','喜欢青柠 {{literal}}').revision,doc.revision)
  assert.throws(()=>clients.forget('b',id),{code:'memory_missing'});assert.equal(clients.memory('a').items[0].id,id)
  clients.replaceMemory('a','喜欢绿茶',doc.revision)
  assert.throws(()=>clients.replaceMemory('a','旧编辑',doc.revision),{code:'memory_conflict'})
  assert.equal(new ClientStore(clients.root,()=>DEFAULT_SETTINGS).memory('a').items[0].text,'喜欢绿茶')
  const tool=memoryTool({read:()=>clients.memory('b'),remember:text=>clients.remember('b',text),forget:item=>clients.forget('b',item)},()=>{})
  await assert.rejects(tool.execute({operation:'read',clientId:'a'},{signal:new AbortController().signal}),{code:'bad_memory'})
  await tool.execute({operation:'remember',text:'客户端 B 喜欢蓝色'},{signal:new AbortController().signal})
  assert.equal(clients.memory('a').items.length,1);assert.match(clients.memory('b').items[0].text,/客户端 B/)
})

test('opaque client scopes prevent identity collisions and pin each client model independently',async()=>{
  const agents=new Map(),refs=new Map(),created=[],inputs=[];let globalModel='global-one'
  const services={agents:{get:id=>agents.get(id),create:async options=>{
    const agent={session:{id:options.sessionId,seq:0},ctx:{},status:'idle',followup:message=>inputs.push({id:options.sessionId,message,model:refs.get(agent)?.current}),whenIdle:async()=>{}}
    created.push(options);agents.set(options.sessionId,agent);return {agent}
  }},sessions:{flush:async()=>{}},agentDefaultModel:{currentSelection:()=>({provider:'global',model:globalModel})}}
  const ctx={get:name=>services[name],on:()=>()=>{},effect:()=>{}},bridge=new AgentBridge(ctx)
  bridge.selectionApi=Promise.resolve({installModelSelection(_ctx,ref){const agent=[...agents.values()].find(a=>a.ctx===_ctx);refs.set(agent,ref);return()=>{}}})
  const clients=new ClientStore(join(directory,'scope-profiles'),()=>DEFAULT_SETTINGS)
  clients.ensure('a');clients.ensure('a-p-work')
  const bind=(id,model)=>bridge.clientScope(id,'main',clients.profile(id).memoryEpoch,{cwd:join(clients.directory(id),'workspace'),indexPath:join(clients.directory(id),'sessions.json'),model:{provider:id,model},legacy:false})
  const a=bind('a','model-a'),b=bind('a-p-work','model-b'),cb={onTextDelta(){},onEnd(){}}
  assert.notEqual(a,b);assert.notEqual(bridge.sessionId(a,'work'),bridge.sessionId(b,''))
  await(await bridge.turn(a,'甲',cb)).done;globalModel='global-two';await(await bridge.turn(b,'乙',cb)).done;await(await bridge.turn(a,'再来',cb)).done
  assert.equal(inputs[0].model.model,'model-a');assert.equal(inputs[1].model.model,'model-b');assert.equal(inputs[2].model.model,'model-a')
  assert.equal(created.length,2);assert.notEqual(created[0].meta.cwd,created[1].meta.cwd)
  assert.equal(JSON.parse(readFileSync(join(clients.directory('a'),'sessions.json'))).clientId,'a')
})

test('client memory tools stay bound to their agent and refresh the runtime snapshot',async()=>{
  const h=host(),b=new AgentBridge(h.ctx),tools=new Map(),contexts=[],facts=[]
  b.selectionApi=Promise.resolve({installModelSelection(){return()=>{}}})
  h.agent.ctx={get:name=>name==='tools'?{register(def){tools.set(def.name,def);return()=>tools.delete(def.name)}}:name==='systemPrompt'?{context(c){contexts.push(c);return()=>{}}}:undefined}
  const memory={read:()=>({revision:facts.length,items:facts}),remember:text=>{facts.push({id:'one',text});return memory.read()},forget:()=>memory.read()}
  const turn=await b.turn('memory-device','保存偏好',{onTextDelta(){},onEnd(){}},'',{memory})
  const tool=tools.get('voice_memory'),exec={agent:h.agent,signal:new AbortController().signal}
  assert.ok(tool);assert.equal(h.inputs[0].content[0].text,'保存偏好')
  await assert.rejects(tool.execute({operation:'remember',text:'其他会话写入'},{...exec,agent:{}}),{code:'wrong_agent'})
  assert.equal(facts.length,0);await tool.execute({operation:'remember',text:'当前客户端偏好'},exec)
  assert.match(contexts[0].text(),/当前客户端偏好/);assert.equal(contexts[0].required,true)
  turn.cancel();assert.equal((await turn.done).kind,'cancelled');assert.ok(tools.has('voice_memory'))
  await assert.rejects(tool.execute({operation:'read'},exec),{code:'cancelled'})
  h.idle.resolve();await until(()=>tools.size===0)
})

test('legacy history adoption requires a proven owner and does not rewrite the legacy index',()=>{
  const legacyPath=join(directory,'legacy-client-index.json'),original=JSON.stringify({'["old-a","mode"]':'existing-a','["old-b","mode"]':'existing-b'})
  writeFileSync(legacyPath,original)
  const h=host(),bridge=new AgentBridge(h.ctx,legacyPath),clients=new ClientStore(join(directory,'migration-profiles'),()=>DEFAULT_SETTINGS)
  clients.ensure('a','',true);clients.ensure('b','',true)
  bridge.configureLegacyOwner(conv=>conv==='old-a'?'a':conv==='old-b'?'b':undefined)
  const bind=(id,conv)=>bridge.clientScope(id,conv,'legacy',{cwd:clients.directory(id),indexPath:join(clients.directory(id),'sessions.json'),model:{provider:'p',model:'m'},legacy:true})
  const a=bind('a','old-a'),spoof=bind('b','old-a'),b=bind('b','old-b')
  assert.equal(bridge.sessionId(a,'mode'),'existing-a');assert.equal(bridge.sessionId(b,'mode'),'existing-b');assert.notEqual(bridge.sessionId(spoof,'mode'),'existing-a')
  assert.equal(readFileSync(legacyPath,'utf8'),original)
  const colliding=new AgentBridge(h.ctx,legacyPath);writeFileSync(legacyPath,JSON.stringify({'["old-a","mode"]':'same-id','["old-b","mode"]':'same-id'}))
  const unsafe=new AgentBridge(h.ctx,legacyPath);unsafe.configureLegacyOwner(conv=>conv==='old-a'?'a':'b')
  const scope=unsafe.clientScope('a','old-a','legacy',{cwd:clients.directory('a'),indexPath:join(clients.directory('a'),'unsafe-sessions.json'),model:{provider:'p',model:'m'},legacy:true})
  assert.notEqual(unsafe.sessionId(scope,'mode'),'same-id')
})

test('client context reset and restoration preserve long-term memory and other client history',()=>{
  const clients=new ClientStore(join(directory,'reset-profiles'),()=>DEFAULT_SETTINGS)
  clients.ensure('a');clients.ensure('b');clients.remember('a','长期偏好');clients.remember('b','其他客户端偏好')
  const a=clients.profile('a').memoryEpoch,b=clients.profile('b').memoryEpoch
  clients.touch('a','main','work','session-a');clients.touch('b','main','work','session-b')
  clients.resetContext('a');assert.notEqual(clients.profile('a').memoryEpoch,a);assert.equal(clients.profile('b').memoryEpoch,b)
  assert.equal(clients.memory('a').items[0].text,'长期偏好');assert.equal(clients.view('a').conversations[0].archived,true)
  clients.resetContext('a',true);assert.equal(clients.profile('a').memoryEpoch,a);assert.equal(clients.view('a').conversations[0].archived,false)
  assert.equal(clients.conversations('b')[0].sessionId,'session-b')
})

test('real client-bound HTTP/WS flow isolates same-named conversations and legacy credentials',async()=>{
  const store=new SettingsStore(join(directory,'isolated-server/settings.json'))
  const handles=[],bridge={currentModel:()=>({provider:'p',model:'m'}),listPresets:async()=>[],sessionId:key=>'session-'+key,release(){},turn:async()=>{const d=deferred();handles.push(d);return{sessionId:'busy',done:d.promise,cancel(){d.resolve({kind:'cancelled'})}}}}
  const server=new VoiceServer(store,bridge,{host:'127.0.0.1',port:0},()=>{});await server.start()
  const base=`http://127.0.0.1:${server.httpServer.address().port}`,headers={'x-voice-token':store.get().adminToken,'content-type':'application/json'},sockets=[]
  const api=async(path,method='GET',body)=>{const r=await fetch(base+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:r.status,data:await r.json()}}
  const open=async(token,id,conversation='main')=>{const socket=new WebSocket(base.replace('http','ws')+'/voice?token='+token),messages=[];sockets.push(socket);socket.onmessage=e=>{if(typeof e.data==='string')messages.push(JSON.parse(e.data))};await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject});socket.send(JSON.stringify({type:'hello',version:2,deviceId:id,conversationId:conversation,capabilities:['turns']}));await until(()=>messages.length);return{socket,messages}}
  try{
    const a=(await api('/devices','POST',{deviceId:'a'})).data,b=(await api('/devices','POST',{deviceId:'b'})).data
    await api('/clients/a/settings','PUT',{assistantName:'甲'});await api('/clients/b/settings','PUT',{assistantName:'乙'})
    const wrong=await open(a.token,'b');assert.equal(wrong.messages[0].type,'error');wrong.socket.close()
    const ca=await open(a.token,'a'),cb=await open(b.token,'b');assert.equal(ca.messages[0].type,'welcome');assert.equal(cb.messages[0].type,'welcome');assert.notEqual(ca.messages[0].sessionId,cb.messages[0].sessionId)
    await api('/settings','PUT',{assistantName:'模板已改变'});assert.equal((await api('/clients/a')).data.settings.assistantName,'甲');assert.equal((await api('/clients/b')).data.settings.assistantName,'乙')
    await api('/clients/a/memory','PUT',{text:'A 的私有记忆',revision:0});assert.equal((await api('/clients/b')).data.memory.items.length,0)
    assert.equal((await api('/clients/a/memory','PUT',{text:'覆盖',revision:0})).status,409)
    const legacy=await open(store.get().token,'legacy');assert.equal(legacy.messages[0].type,'welcome')
    const legacyWrong=await open(store.get().token,'another');assert.equal(legacyWrong.messages[0].type,'error');legacyWrong.socket.close()
    cb.socket.send(JSON.stringify({type:'query',text:'等待',requestId:'busy'}));await until(()=>handles.length)
    assert.equal((await api('/clients/b/context/reset','POST')).status,409)
    assert.equal((await api('/clients/a/context/reset','POST')).status,200);await until(()=>ca.socket.readyState!==1)
    assert.equal(cb.socket.readyState,1);assert.equal((await api('/clients/a')).data.memory.items.length,1)
  }finally{for(const socket of sockets)socket.close();for(const d of handles)d.resolve({kind:'cancelled'});server.stop()}
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
