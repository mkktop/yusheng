import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DEFAULT_SETTINGS, maskSettings, mergeSettings, type VoiceSettings } from './settings.js'
import { identifier, VoiceError } from './protocol.js'
import { MemoryStore, type MemoryInput, type MemorySource, type MemoryEpisode } from './memory-store.js'
export type { ClientMemory, MemoryItem } from './memory-store.js'

export const CLIENT_FIELDS = ['assistantName','userTitle','assistantRole','personality','personalityNotes','replyStyle','presentationStyle','minimaxApiKey','asrModel','ttsModel','ttsVoice','ttsSpeed','ttsVol','ttsPitch','promptPrefix','agentPreset','maxTurnSeconds','llmProvider','llmModel','memoryPolicy'] as const
export interface ClientProfile { id:string; label:string; createdAt:number; updatedAt:number; memoryEpoch:string; legacyHistory:boolean; previousEpochs:string[]; contextBarrier?:number; config:VoiceSettings }
type Model = {provider:string;model:string}

function write(path:string,value:unknown) {
  const temporary=path+'.'+randomUUID()+'.tmp'
  writeFileSync(temporary,JSON.stringify(value,null,2)+'\n',{mode:0o600});renameSync(temporary,path)
}
function pick(config:VoiceSettings) {return Object.fromEntries(CLIENT_FIELDS.map(key=>[key,config[key]])) as unknown as VoiceSettings}

/** Each authenticated client owns a directory. Defaults are copied once, never inherited live. */
export class ClientStore {
  constructor(readonly root:string,private template:()=>VoiceSettings,private model:()=>Model|undefined=()=>undefined) {
    mkdirSync(root,{recursive:true,mode:0o700})
  }
  directory(id:string) {
    if(!identifier(id,48))throw new VoiceError('bad_device_id','客户端 ID 格式不正确')
    const directory=join(this.root,id)
    if(existsSync(directory)&&(!lstatSync(directory).isDirectory()||lstatSync(directory).isSymbolicLink()))throw new Error('invalid client directory')
    return directory
  }
  exists(id:string) {return existsSync(join(this.directory(id),'profile.json'))}
  ensure(id:string,label='',legacyHistory=false):ClientProfile {
    const directory=this.directory(id)
    if(this.exists(id))return this.profile(id)
    if(this.ids().length>=256)throw new VoiceError('client_limit','客户端数量达到上限')
    mkdirSync(directory,{recursive:true,mode:0o700});mkdirSync(join(directory,'workspace'),{recursive:true,mode:0o700})
    const config=pick(this.template()),model=this.model()
    if(!config.llmProvider&&!config.llmModel&&model){config.llmProvider=model.provider;config.llmModel=model.model}
    const now=Date.now(),profile:ClientProfile={id,label:label.trim().slice(0,64)||id,createdAt:now,updatedAt:now,memoryEpoch:legacyHistory?'legacy':randomUUID(),legacyHistory,previousEpochs:[],config}
    write(join(directory,'profile.json'),profile);return structuredClone(profile)
  }
  private ids() {return readdirSync(this.root).filter(id=>identifier(id,48)&&this.exists(id))}
  profile(id:string):ClientProfile {
    const raw=JSON.parse(readFileSync(join(this.directory(id),'profile.json'),'utf8'))
    if(raw?.id!==id||!raw.config||typeof raw.memoryEpoch!=='string'||!Array.isArray(raw.previousEpochs)||typeof raw.label!=='string')throw new Error('invalid client profile; refusing to reset it')
    const {settings,rejected}=mergeSettings(DEFAULT_SETTINGS,raw.config)
    if(rejected.length)throw new Error('invalid client settings; refusing to reset them')
    return {...raw,config:pick(settings)}
  }
  list() {return this.ids().map(id=>{const p=this.profile(id);return {deviceId:id,label:p.label,createdAt:p.createdAt,updatedAt:p.updatedAt,hasMemory:this.memory(id).items.length>0,conversationCount:this.conversations(id).length}}).sort((a,b)=>a.createdAt-b.createdAt)}
  settings(id:string):VoiceSettings {return {...DEFAULT_SETTINGS,...this.profile(id).config,deviceTokens:{},allowedOrigins:[]}}
  view(id:string) {
    const profile=this.profile(id),masked=maskSettings(this.settings(id)),memory=this.memory(id),epoch=memory.barrier?profile.memoryEpoch+'.m'+memory.barrier:profile.memoryEpoch
    return {deviceId:id,label:profile.label,settings:{...Object.fromEntries(CLIENT_FIELDS.filter(key=>key!=='minimaxApiKey').map(key=>[key,masked[key]])),minimaxApiKey:'',hasMinimaxApiKey:masked.hasMinimaxApiKey},memory,conversations:this.conversations(id).map(c=>({...c,archived:c.epoch!==epoch})),canRestore:profile.previousEpochs.length>0&&(profile.contextBarrier??0)===memory.barrier}
  }
  update(id:string,patch:Record<string,unknown>) {
    const p=this.profile(id),allowed=Object.fromEntries(Object.entries(patch).filter(([key])=>(CLIENT_FIELDS as readonly string[]).includes(key)))
    const {settings,rejected}=mergeSettings({...DEFAULT_SETTINGS,...p.config},allowed)
    for(const key of Object.keys(patch))if(!(CLIENT_FIELDS as readonly string[]).includes(key))rejected.push(key)
    if(Boolean(settings.llmProvider)!==Boolean(settings.llmModel)){
      for(const key of ['llmProvider','llmModel'] as const)if(key in patch)rejected.push(key)
      settings.llmProvider=p.config.llmProvider;settings.llmModel=p.config.llmModel
    }
    write(join(this.directory(id),'profile.json'),{...p,config:pick(settings),updatedAt:Date.now()})
    return {settings:this.view(id).settings,rejected:[...new Set(rejected)]}
  }
  private memories(id:string) {this.profile(id);return new MemoryStore(join(this.directory(id),'memory.json'))}
  memory(id:string) {return this.memories(id).read()}
  recall(id:string,query:string,limit?:number) {return this.memories(id).recall(query,limit)}
  remember(id:string,text:unknown,options:Omit<MemoryInput,'text'>={},source:MemorySource={actor:'assistant'}) {return this.memories(id).upsert({text,...options},source)}
  forget(id:string,itemId:unknown,revision?:unknown,source?:MemorySource) {return this.memories(id).forget(itemId,revision,source)}
  clearMemory(id:string,revision:unknown) {return this.memories(id).clear(revision)}
  replaceMemory(id:string,text:unknown,revision:unknown) {return this.memories(id).replace(text,revision)}
  observe(id:string,text:string,conversationId:string,turnId:string) {
    const policy=this.settings(id).memoryPolicy
    if(policy==='off')return
    return this.memories(id).observe(text,{actor:'user',conversationId,turnId},policy==='adaptive')
  }
  record(id:string,episode:Omit<MemoryEpisode,'id'|'at'>) {if(this.settings(id).memoryPolicy!=='off'&&episode.epoch===this.contextEpoch(id))this.memories(id).record(episode)}
  contextEpoch(id:string) {const epoch=this.profile(id).memoryEpoch,barrier=this.memory(id).barrier;return barrier?epoch+'.m'+barrier:epoch}
  conversations(id:string):Array<{conversationId:string;preset:string;sessionId:string;updatedAt:number;epoch:string}> {
    const path=join(this.directory(id),'conversations.json')
    if(!existsSync(path))return []
    const rows=JSON.parse(readFileSync(path,'utf8'));if(!Array.isArray(rows)||rows.length>256)throw new Error('invalid client conversation index');return rows
  }
  touch(id:string,conversationId:string,preset:string,sessionId:string,epoch=this.contextEpoch(id)) {
    const profile=this.profile(id),rows=this.conversations(id),key=(r:any)=>r.conversationId===conversationId&&r.preset===preset&&r.epoch===epoch
    const next=rows.filter(r=>!key(r));next.push({conversationId,preset,sessionId,updatedAt:Date.now(),epoch})
    if(next.length>256)next.splice(0,next.length-256)
    write(join(this.directory(id),'conversations.json'),next)
  }
  resetContext(id:string,restore=false) {
    const p=this.profile(id),barrier=this.memory(id).barrier,previous=(p.contextBarrier??0)===barrier?[...p.previousEpochs]:[],epoch=restore?previous.pop():randomUUID()
    if(!epoch)throw new VoiceError('no_archive','没有可恢复的对话归档')
    if(!restore)previous.push(p.memoryEpoch)
    write(join(this.directory(id),'profile.json'),{...p,memoryEpoch:epoch,contextBarrier:barrier,previousEpochs:previous.slice(-16),updatedAt:Date.now()})
    return this.view(id)
  }
}
