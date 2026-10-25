import { VoiceClient, renderSurface } from '../src/client/voice-client.js'
const $=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T
const client=new VoiceClient(),avatar=$('avatar')
renderSurface($('surface'),client)
$<HTMLInputElement>('endpoint').value=`${location.protocol==='https:'?'wss:':'ws:'}//${location.host}/voice`
let expressionTimer:ReturnType<typeof setTimeout>,gestureTimer:ReturnType<typeof setTimeout>
const reset=()=>{clearTimeout(expressionTimer);clearTimeout(gestureTimer);avatar.dataset.expression='neutral';delete avatar.dataset.gesture}
const error=(e:unknown)=>{$('error').textContent=e instanceof Error?e.message:String(e)}
function buttons(){
  $<HTMLButtonElement>('send').disabled=!client.connected||client.busy
  $<HTMLButtonElement>('cancel').disabled=!client.connected||!client.busy
  $<HTMLButtonElement>('stop').disabled=!client.connected||!client.busy
}
client.addEventListener('connection',()=>{$('connection').textContent=client.connected?'已连接':'尚未连接';if(!client.connected){reset();avatar.dataset.state='idle';$('state').textContent='空闲'}buttons()})
client.addEventListener('client.error',(event:Event)=>error((event as CustomEvent).detail.message))
client.addEventListener('reset',reset)
client.addEventListener('cue',(event:Event)=>{
  const cue=(event as CustomEvent).detail
  if(cue.expression){clearTimeout(expressionTimer);avatar.dataset.expression=cue.expression;expressionTimer=setTimeout(()=>avatar.dataset.expression='neutral',cue.durationMs)}
  if(cue.gesture){clearTimeout(gestureTimer);delete avatar.dataset.gesture;void avatar.getBoundingClientRect();avatar.dataset.gesture=cue.gesture;gestureTimer=setTimeout(()=>delete avatar.dataset.gesture,cue.durationMs)}
})
client.addEventListener('event',(event:Event)=>{
  const m=(event as CustomEvent).detail
  if(m.type==='presentation.state'){avatar.dataset.state=m.state;$('state').textContent=({idle:'空闲',listening:'倾听',thinking:'思考',speaking:'说话',error:'遇到问题'} as Record<string,string>)[m.state]??m.state}
  if(m.type==='turn.start'){$('transcript').textContent='';$('error').textContent=''}
  if(m.type==='llm'&&m.state==='delta')$('transcript').textContent+=m.text
  if(m.type==='error')error(m.message)
  if(!['pong','playback.ack'].includes(m.type)){const log=$('events');log.textContent=(log.textContent+`${m.type}${m.state?' · '+m.state:''}\n`).split('\n').slice(-80).join('\n')}
  buttons()
})
$('connect').onclick=async()=>{try{$<HTMLButtonElement>('connect').disabled=true;$('error').textContent='';await client.connect($<HTMLInputElement>('endpoint').value,$<HTMLInputElement>('token').value,$<HTMLInputElement>('device').value)}catch(e){error(e)}finally{$<HTMLButtonElement>('connect').disabled=false}}
$('disconnect').onclick=()=>client.disconnect()
$('send').onclick=()=>{try{client.query($<HTMLTextAreaElement>('query').value)}catch(e){error(e)}}
$('cancel').onclick=()=>{try{client.cancel()}catch(e){error(e)}}
$('stop').onclick=()=>{try{client.stopSpeech()}catch(e){error(e)}}
window.addEventListener('pagehide',()=>client.disconnect())
