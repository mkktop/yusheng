// Local UI preview with deterministic agent effects and silent audio. No external API calls.
import {build} from 'esbuild'
import {mkdtempSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {pathToFileURL} from 'node:url'
const directory=mkdtempSync(join(tmpdir(),'yusheng-preview-'))
await build({entryPoints:['src/server.ts','src/settings.ts'],outdir:directory,bundle:true,platform:'node',format:'esm',outExtension:{'.js':'.mjs'},external:['bufferutil','utf-8-validate'],banner:{js:"import {createRequire as __previewRequire} from 'node:module';const require=__previewRequire(import.meta.url);"},logLevel:'silent'})
const {VoiceServer}=await import(pathToFileURL(join(directory,'server.mjs'))),{SettingsStore}=await import(pathToFileURL(join(directory,'settings.mjs')))
const store=new SettingsStore(join(directory,'settings.json'));store.update({token:'demo-local-device',minimaxApiKey:'preview-only'})
globalThis.fetch=async()=>new Response('data: '+JSON.stringify({data:{audio:Buffer.alloc(48000).toString('hex'),status:2}})+'\n\n',{headers:{'content-type':'text/event-stream'}})
const bridge={sessionId:id=>`voice-${id}`,currentModel:()=>({provider:'preview',model:'deterministic'}),listPresets:async()=>[],release(){},async turn(id,text,cb,_preset,options){
  let cancelled=false
  const done=(async()=>{
    if(options.signal.aborted)return {kind:'cancelled'}
    if(cb.onClientEffect){
      cb.onClientEffect({kind:'cue',cue:{expression:'happy',gesture:'nod',durationMs:1800,intensity:.7,timing:'next_sentence'}})
      cb.onClientEffect({kind:'render',component:text.includes('用户在客户端选择')?{id:'plan-form',type:'form',title:'安排一个小目标',text:'填写后交给助手继续处理。',fields:[{id:'goal',type:'text',label:'今天的小目标',required:true}],actions:[{id:'submit',label:'交给助手',prompt:'根据用户的小目标给出简短建议。'}],expiresInMs:300000}:{id:'next',type:'choices',title:'今天想做什么？',text:'点击选项将继续驱动同一个对话。',actions:[{id:'chat',label:'轻松聊天',prompt:'开始轻松聊天。'},{id:'plan',label:'安排今天',prompt:'帮我安排今天。'}],expiresInMs:300000}})
    }
    cb.onTextDelta(text.includes('用户在客户端选择')?'收到你的选择，填一个小目标试试。':'你好，选一个方向，我们继续聊。')
    return {kind:cancelled?'cancelled':'completed'}
  })()
  return {sessionId:`voice-${id}`,cancel(){cancelled=true},done}
}}
const server=new VoiceServer(store,bridge,{host:'127.0.0.1',port:18091,assetsRoot:process.cwd()},()=>{})
await server.start();console.log('Preview: http://127.0.0.1:18091/demo — device token: demo-local-device (mock only)')
process.on('SIGINT',()=>{server.stop();process.exit(0)})
