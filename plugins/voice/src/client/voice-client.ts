import type { PublicComponent, PresentationSupport } from '../interaction.js'

export const DEFAULT_PRESENTATION:PresentationSupport={expressions:['neutral','happy','sad','surprised','thinking','confused','calm'],gestures:['nod','shake','wave','point','celebrate'],components:['card','choices','progress','form']}
export const CLIENT_CAPABILITIES=['turns','audio.framed','playback','playback.flow','agent.activity','response.stop','conversation.select','presentation.state','presentation.cue','ui.render']
const RATE=24000
const requestId=()=>`${Date.now().toString(36)}-${Array.from(crypto.getRandomValues(new Uint32Array(3)),v=>v.toString(36)).join('-')}`
type Frame={source:AudioBufferSourceNode;start:number;offset:number;samples:number}
type Stream={id:number;turnId:string;received:number;played:number;sequence:number;nextTime:number;frames:Frame[];total?:number;closed:boolean;cues:any[]}

/** Reference browser transport/player. Applications own their avatar assets and visual design. */
export class VoiceClient extends EventTarget {
  private ws?:WebSocket
  private audio?:AudioContext
  private streams=new Map<number,Stream>()
  private timers=new Map<number,Set<ReturnType<typeof setTimeout>>>()
  private interval?:ReturnType<typeof setInterval>
  private heartbeat?:ReturnType<typeof setInterval>
  private currentTurn?:string
  private epoch=0
  private clockOffset=0
  busy=false
  connected=false
  private emit(type:string,detail:any){this.dispatchEvent(new CustomEvent(type,{detail}))}
  private send(message:unknown){if(this.ws?.readyState!==WebSocket.OPEN)throw new Error('语音连接尚未就绪');this.ws.send(JSON.stringify(message))}

  async connect(endpoint:string,token:string,deviceId:string,presentation=DEFAULT_PRESENTATION) {
    this.disconnect()
    const epoch=++this.epoch
    this.audio=new AudioContext();await this.audio.resume()
    if(epoch!==this.epoch)return
    const url=new URL(endpoint);url.searchParams.set('token',token)
    if(!['ws:','wss:'].includes(url.protocol))throw new Error('请输入 ws:// 或 wss:// 地址')
    const socket=this.ws=new WebSocket(url);socket.binaryType='arraybuffer'
    let welcome=false
    const ready=new Promise<void>((resolve,reject)=>{
      const timer=setTimeout(()=>{reject(new Error('握手超时'));socket.close()},10000)
      socket.onopen=()=>{if(epoch===this.epoch)socket.send(JSON.stringify({type:'hello',version:2,deviceId,capabilities:CLIENT_CAPABILITIES,presentation}))}
      socket.onerror=()=>{clearTimeout(timer);reject(new Error('连接失败，请检查地址与设备令牌'))}
      socket.onclose=()=>{
        clearTimeout(timer);if(!welcome)reject(new Error('握手未完成'))
        if(epoch!==this.epoch)return
        this.connected=false;this.busy=false;clearInterval(this.interval);clearInterval(this.heartbeat);this.clearAudio(false);this.emit('connection',{connected:false})
      }
      socket.onmessage=event=>{
        if(epoch!==this.epoch)return
        try {
          if(typeof event.data!=='string'){this.binary(event.data);return}
          const m=JSON.parse(event.data)
          if(m.type==='welcome'){clearTimeout(timer);welcome=true;this.connected=true;this.clockOffset=typeof m.serverTime==='number'?m.serverTime-Date.now():0;resolve();this.emit('connection',{connected:true})}
          if(m.type==='error'&&!welcome){clearTimeout(timer);reject(new Error(m.message));socket.close()}
          this.message(m)
        } catch(error){this.emit('client.error',{message:error instanceof Error?error.message:String(error)});this.disconnect()}
      }
    })
    try {await ready}catch(e){if(epoch===this.epoch)this.disconnect();throw e}
    if(epoch!==this.epoch)return
    this.interval=setInterval(()=>{for(const stream of this.streams.values())this.feedback(stream)},250)
    this.heartbeat=setInterval(()=>this.send({type:'ping',time:Date.now()}),15000)
  }
  disconnect() {
    ++this.epoch;clearInterval(this.interval);clearInterval(this.heartbeat)
    this.clearAudio(false);this.ws?.close();this.ws=undefined;void this.audio?.close().catch(()=>{});this.audio=undefined
    this.connected=false;this.busy=false;this.currentTurn=undefined;this.emit('connection',{connected:false})
  }
  query(text:string){this.clearAudio(true);this.send({type:'query',requestId:requestId(),text})}
  speak(text:string){this.clearAudio(true);this.send({type:'speak',requestId:requestId(),text})}
  listenStart(){this.clearAudio(true);this.send({type:'listen',state:'start',requestId:requestId()})}
  sendAudio(pcm:ArrayBuffer|Uint8Array){if(this.ws?.readyState!==WebSocket.OPEN)throw new Error('未连接');this.ws.send(pcm)}
  listenStop(){this.send({type:'listen',state:'stop',turnId:this.currentTurn})}
  cancel(){this.send({type:'turn.cancel',turnId:this.currentTurn});this.clearAudio(true)}
  stopSpeech(){this.send({type:'response.stop',turnId:this.currentTurn});this.clearAudio(true)}
  selectConversation(conversationId:string){this.clearAudio(true);this.send({type:'conversation.select',conversationId})}
  syncUI(){this.send({type:'ui.sync'})}
  serverNow(){return Date.now()+this.clockOffset}
  action(component:PublicComponent,actionId:string,values:Record<string,unknown>={}) {
    this.clearAudio(true);this.send({type:'ui.action',requestId:requestId(),componentId:component.id,instanceId:component.instanceId,revision:component.revision,actionId,values})
  }
  dismiss(component:PublicComponent){this.send({type:'ui.dismiss',componentId:component.id,revision:component.revision,instanceId:component.instanceId})}

  private message(m:any) {
    if(m.type==='turn.start'){this.currentTurn=m.turnId;this.busy=true}
    if(m.type==='audio.start') {
      if(m.framing!=='ysv2')throw new Error('参考客户端需要 audio.framed')
      this.streams.set(m.streamId,{id:m.streamId,turnId:m.turnId,received:0,played:0,sequence:0,nextTime:0,frames:[],closed:false,cues:[]})
    }
    if(m.type==='presentation.cue') {
      if(m.timing==='now')this.emit('cue',m)
      else {
        const stream=this.streams.get(m.streamId)
        if(stream&&!stream.closed){stream.cues.push(m);this.scheduleCues(stream)}
      }
    }
    if(m.type==='presentation.reset'){this.clearCueTimers();this.emit('reset',m)}
    if(m.type==='audio.end') {
      const stream=this.streams.get(m.streamId)
      if(stream){stream.total=m.samples;if(!['completed','done'].includes(m.reason))this.clearStream(stream,true);else this.feedback(stream)}
    }
    if(m.type==='turn.end') {
      if(m.turnId===this.currentTurn){this.currentTurn=undefined;this.busy=false}
      if(!['completed','done'].includes(m.reason)) {const stream=this.streams.get(m.streamId);if(stream)this.clearStream(stream,true)}
    }
    if(m.type==='conversation.selected'){this.clearAudio(true);this.emit('reset',m)}
    this.emit('event',m)
  }
  private binary(data:ArrayBuffer) {
    const view=new DataView(data)
    if(view.byteLength<24||view.getUint32(0,false)!==0x59535632)throw new Error('无效音频帧头')
    const id=view.getUint32(4,true),sequence=view.getUint32(8,true),offset=view.getFloat64(12,true),bytes=view.getUint32(20,true),stream=this.streams.get(id)
    if(!stream||stream.closed)return // Cancelled streams may still have in-flight frames.
    if(bytes!==view.byteLength-24||bytes%2||sequence!==stream.sequence||offset!==stream.received||!Number.isSafeInteger(offset))throw new Error('音频帧序号或采样位置不连续')
    const audio=this.audio!
    const buffer=audio.createBuffer(1,bytes/2,RATE),samples=buffer.getChannelData(0)
    for(let i=0;i<samples.length;i++)samples[i]=view.getInt16(24+i*2,true)/32768
    const source=audio.createBufferSource();source.buffer=buffer;source.connect(audio.destination)
    const frame={source,start:Math.max(stream.nextTime,audio.currentTime+.04),offset,samples:samples.length}
    stream.frames.push(frame);stream.nextTime=frame.start+samples.length/RATE;stream.received+=samples.length;stream.sequence++
    source.onended=()=>{stream.played=Math.max(stream.played,offset+samples.length);stream.frames=stream.frames.filter(f=>f!==frame);source.disconnect();this.feedback(stream)}
    source.start(frame.start);this.scheduleCues(stream)
  }
  private scheduleCues(stream:Stream) {
    for(const cue of [...stream.cues]) {
      const frame=stream.frames.find(f=>cue.sampleOffset>=f.offset&&cue.sampleOffset<f.offset+f.samples)
      if(!frame)continue
      const timers=this.timers.get(stream.id)??new Set();this.timers.set(stream.id,timers)
      const timer=setTimeout(()=>{timers.delete(timer);if(!stream.closed)this.emit('cue',cue)},Math.max(0,(frame.start+(cue.sampleOffset-frame.offset)/RATE-this.audio!.currentTime)*1000))
      timers.add(timer);stream.cues=stream.cues.filter(c=>c!==cue)
    }
  }
  private played(stream:Stream) {
    let samples=stream.played
    for(const frame of stream.frames)if(this.audio!.currentTime>=frame.start)samples=Math.max(samples,frame.offset+Math.min(frame.samples,Math.floor((this.audio!.currentTime-frame.start)*RATE)))
    return Math.min(samples,stream.received)
  }
  private feedback(stream:Stream) {
    if(stream.closed||!this.connected)return
    const played=this.played(stream)
    const ended=stream.total!==undefined&&played===stream.total
    this.send({type:'playback',turnId:stream.turnId,streamId:stream.id,state:ended?'ended':'progress',playedSamples:played,bufferedSamples:stream.received-played})
    if(ended){stream.closed=true;stream.cues=[];this.prune()}
  }
  private clearStream(stream:Stream,notify:boolean) {
    if(stream.closed)return
    const played=this.played(stream);stream.closed=true
    for(const f of stream.frames){f.source.onended=null;try{f.source.stop();f.source.disconnect()}catch{}}
    stream.frames=[];stream.cues=[];for(const timer of this.timers.get(stream.id)??[])clearTimeout(timer);this.timers.delete(stream.id)
    if(notify&&this.connected)this.send({type:'playback',turnId:stream.turnId,streamId:stream.id,state:'cleared',playedSamples:played,bufferedSamples:0})
    this.prune()
  }
  private clearAudio(notify:boolean){for(const stream of this.streams.values())this.clearStream(stream,notify);this.clearCueTimers()}
  private clearCueTimers(){for(const timers of this.timers.values())for(const timer of timers)clearTimeout(timer);this.timers.clear()}
  private prune(){for(const [id,s] of this.streams)if(s.closed)this.streams.delete(id)}
}

/** Safe reference renderer: textContent and native controls only. Returns its disposer. */
export function renderSurface(container:HTMLElement,client:VoiceClient) {
  const components=new Map<string,PublicComponent>(),nodes=new Map<string,HTMLElement>(),expiry=new Map<string,ReturnType<typeof setTimeout>>()
  const remove=(id:string)=>{components.delete(id);nodes.get(id)?.remove();nodes.delete(id);clearTimeout(expiry.get(id));expiry.delete(id)}
  const disabled=(node:HTMLElement,c:PublicComponent)=>{for(const input of node.querySelectorAll<HTMLInputElement|HTMLButtonElement|HTMLSelectElement>('button,input,select'))input.disabled=input.classList.contains('voice-dismiss')?!client.connected:!client.connected||client.busy||c.disabled||c.expiresAt<=client.serverNow()}
  const render=(c:PublicComponent)=>{
    if(c.expiresAt<=client.serverNow()){remove(c.id);return}
    const previous=components.get(c.id);if(previous&&previous.revision>c.revision)return
    remove(c.id);components.set(c.id,c)
    const card=document.createElement('article');card.className='voice-card';card.dataset.componentId=c.id
    const heading=document.createElement('h3');heading.textContent=c.title;card.append(heading)
    if(c.text){const body=document.createElement('p');body.textContent=c.text;card.append(body)}
    if(c.rows){const rows=document.createElement('dl');for(const row of c.rows){const label=document.createElement('dt'),value=document.createElement('dd');label.textContent=row.label;value.textContent=row.value;rows.append(label,value)}card.append(rows)}
    if(c.type==='progress'){const progress=document.createElement('progress');progress.max=1;if(c.value!==undefined)progress.value=c.value;progress.setAttribute('aria-label',c.title);card.append(progress)}
    const form=document.createElement('form'),inputs=new Map<string,HTMLInputElement|HTMLSelectElement>()
    for(const field of c.fields??[]){
      const label=document.createElement('label');label.textContent=field.label
      let input:HTMLInputElement|HTMLSelectElement
      if(field.type==='select'){const select=document.createElement('select'),empty=document.createElement('option');empty.value='';empty.textContent='请选择';select.append(empty);for(const option of field.options!){const o=document.createElement('option');o.value=option.value;o.textContent=option.label;select.append(o)}input=select}
      else {const entry=document.createElement('input');entry.type=field.type==='boolean'?'checkbox':field.type==='number'?'number':'text';entry.maxLength=256;if(field.min!==undefined)entry.min=String(field.min);if(field.max!==undefined)entry.max=String(field.max);if(field.type==='number')entry.step='any';input=entry}
      input.required=field.required;input.name=field.id;inputs.set(field.id,input);label.append(input);form.append(label)
    }
    const error=document.createElement('p');error.className='voice-error';error.setAttribute('role','status')
    const invoke=(actionId:string)=>{
      try {if(!form.reportValidity())return;const values:Record<string,unknown>=Object.create(null)
        for(const field of c.fields??[]){const input=inputs.get(field.id)!;if(field.type==='boolean')values[field.id]=(input as HTMLInputElement).checked;else if(input.value!=='')values[field.id]=field.type==='number'?Number(input.value):input.value}
        client.action(c,actionId,values);for(const button of form.querySelectorAll('button'))button.disabled=true
      }catch(e){error.textContent=e instanceof Error?e.message:String(e)}
    }
    for(const action of c.actions??[]){const button=document.createElement('button');button.textContent=action.label;button.type=c.type==='form'?'submit':'button';if(c.type!=='form')button.onclick=()=>invoke(action.id);form.append(button)}
    form.onsubmit=event=>{event.preventDefault();if(c.actions?.[0])invoke(c.actions[0].id)}
    card.append(form,error)
    const close=document.createElement('button');close.textContent='关闭';close.className='voice-dismiss';close.onclick=()=>{try{client.dismiss(c)}catch(e){error.textContent=String(e)}};card.append(close)
    container.append(card);nodes.set(c.id,card);disabled(card,c)
    expiry.set(c.id,setTimeout(()=>remove(c.id),Math.max(0,c.expiresAt-client.serverNow())))
  }
  const event=(e:Event)=>{
    const m=(e as CustomEvent).detail
    if(m.type==='ui.snapshot'){for(const id of [...components.keys()])remove(id);for(const c of m.components)render(c)}
    if(m.type==='ui.render')render(m.component)
    if(m.type==='ui.remove'){const current=components.get(m.componentId);if(!current||m.revision>=current.revision)remove(m.componentId)}
    if(m.type==='error')for(const node of nodes.values())node.querySelector<HTMLElement>('.voice-error')!.textContent=m.message
    for(const [id,c] of components)disabled(nodes.get(id)!,c)
  }
  const connection=()=>{for(const [id,c] of components)disabled(nodes.get(id)!,c)}
  client.addEventListener('event',event);client.addEventListener('connection',connection)
  return ()=>{client.removeEventListener('event',event);client.removeEventListener('connection',connection);for(const id of [...components.keys()])remove(id)}
}
