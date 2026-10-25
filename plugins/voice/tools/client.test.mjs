import {test} from 'node:test'
import assert from 'node:assert/strict'
import {VoiceClient} from '../lib/voice-client.js'
const delay=ms=>new Promise(r=>setTimeout(r,ms))
let socket,audio
class Socket {
  static OPEN=1
  readyState=1;sent=[]
  constructor(){socket=this;queueMicrotask(()=>this.onopen?.())}
  send(raw){const m=JSON.parse(raw);this.sent.push(m);if(m.type==='hello')queueMicrotask(()=>this.message({type:'welcome',version:2,serverTime:Date.now()+1000}))}
  message(m){this.onmessage?.({data:JSON.stringify(m)})}
  binary(data){this.onmessage?.({data})}
  close(){this.readyState=3;this.onclose?.()}
}
class Audio {
  currentTime=0;destination={};sources=[]
  constructor(){audio=this}
  async resume(){}async close(){}
  createBuffer(_channels,samples){const values=new Float32Array(samples);return {getChannelData:()=>values}}
  createBufferSource(){const s={connect(){},disconnect(){},stop(){this.stopped=true},start(time){this.time=time},onended:null};this.sources.push(s);return s}
}
function frame(stream=1,sequence=0,offset=0){const bytes=new ArrayBuffer(24+1920),v=new DataView(bytes);v.setUint32(0,0x59535632,false);v.setUint32(4,stream,true);v.setUint32(8,sequence,true);v.setFloat64(12,offset,true);v.setUint32(20,1920,true);return bytes}
async function setup(fn){const oldSocket=globalThis.WebSocket,oldAudio=globalThis.AudioContext;globalThis.WebSocket=Socket;globalThis.AudioContext=Audio;const client=new VoiceClient();try{await client.connect('ws://127.0.0.1/voice','test-token','test-device');await fn(client)}finally{client.disconnect();globalThis.WebSocket=oldSocket;globalThis.AudioContext=oldAudio}}

test('browser client negotiates presentation and schedules cues on the audio playback clock',async()=>setup(async c=>{
  assert.ok(socket.sent[0].capabilities.includes('ui.render'));assert.ok(c.serverNow()-Date.now()>=990)
  const cues=[];c.addEventListener('cue',e=>cues.push(e.detail))
  socket.message({type:'turn.start',turnId:'t'});socket.message({type:'audio.start',turnId:'t',streamId:1,framing:'ysv2'})
  socket.message({type:'presentation.cue',turnId:'t',streamId:1,cueId:'cue',timing:'next_sentence',sampleOffset:0,expression:'happy'})
  assert.equal(cues.length,0);socket.binary(frame());assert.equal(cues.length,0)
  await delay(65);assert.equal(cues.length,1)
  socket.message({type:'audio.end',streamId:1,reason:'completed',samples:960});audio.currentTime=.1;audio.sources[0].onended()
  assert.equal(socket.sent.at(-1).state,'ended');assert.equal(socket.sent.at(-1).playedSamples,960)
}))

test('browser client cancels pending synchronized actions and clears scheduled audio',async()=>setup(async c=>{
  const cues=[];c.addEventListener('cue',e=>cues.push(e.detail))
  socket.message({type:'turn.start',turnId:'t'});socket.message({type:'audio.start',turnId:'t',streamId:1,framing:'ysv2'})
  socket.message({type:'presentation.cue',streamId:1,timing:'next_sentence',sampleOffset:0});socket.binary(frame())
  c.cancel();await delay(65)
  assert.equal(cues.length,0);assert.equal(audio.sources[0].stopped,true)
  assert.equal(socket.sent.some(m=>m.type==='playback'&&m.state==='cleared'),true)
}))

test('browser client rejects malformed frame order and closes the connection',async()=>setup(async c=>{
  const errors=[];c.addEventListener('client.error',e=>errors.push(e.detail))
  socket.message({type:'audio.start',turnId:'t',streamId:1,framing:'ysv2'});socket.binary(frame(1,2,0))
  assert.equal(errors.length,1);assert.equal(c.connected,false)
}))

test('browser UI actions contain server component identity and values, never action prompts',async()=>setup(async c=>{
  c.action({id:'x',revision:2,instanceId:'instance'},'submit',{name:'小明'})
  const m=socket.sent.at(-1);assert.equal(m.type,'ui.action');assert.equal(m.revision,2);assert.equal(m.instanceId,'instance');assert.deepEqual(m.values,{name:'小明'});assert.equal('prompt'in m,false)
}))
