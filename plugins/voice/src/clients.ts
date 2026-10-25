import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DEFAULT_SETTINGS, maskSettings, mergeSettings, type VoiceSettings } from './settings.js'
import { identifier, VoiceError } from './protocol.js'

export const CLIENT_FIELDS = ['assistantName','userTitle','assistantRole','personality','personalityNotes','replyStyle','presentationStyle','minimaxApiKey','asrModel','ttsModel','ttsVoice','ttsSpeed','ttsVol','ttsPitch','promptPrefix','agentPreset','maxTurnSeconds','llmProvider','llmModel'] as const
export interface ClientProfile { id:string; label:string; createdAt:number; updatedAt:number; memoryEpoch:string; legacyHistory:boolean; previousEpochs:string[]; config:VoiceSettings }
export interface MemoryItem { id:string; text:string; createdAt:number }
export interface ClientMemory { revision:number; updatedAt:number; items:MemoryItem[] }
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
    const profile=this.profile(id),masked=maskSettings(this.settings(id))
    return {deviceId:id,label:profile.label,settings:{...Object.fromEntries(CLIENT_FIELDS.filter(key=>key!=='minimaxApiKey').map(key=>[key,masked[key]])),minimaxApiKey:'',hasMinimaxApiKey:masked.hasMinimaxApiKey},memory:this.memory(id),conversations:this.conversations(id).map(c=>({...c,archived:c.epoch!==profile.memoryEpoch})),canRestore:profile.previousEpochs.length>0}
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
  memory(id:string):ClientMemory {
    this.profile(id)
    const path=join(this.directory(id),'memory.json')
    if(!existsSync(path))return {revision:0,updatedAt:0,items:[]}
    const doc=JSON.parse(readFileSync(path,'utf8'))
    if(!Number.isSafeInteger(doc?.revision)||!Array.isArray(doc.items)||doc.items.length>32||doc.items.some((i:any)=>!identifier(i.id)||typeof i.text!=='string'||i.text.length>1000)||doc.items.reduce((n:number,i:any)=>n+i.text.length,0)>8000)throw new Error('invalid client memory; refusing to reset it')
    return doc
  }
  private saveMemory(id:string,previous:ClientMemory,items:MemoryItem[]) {
    if(items.length>32||items.reduce((n,i)=>n+i.text.length,0)>8000)throw new VoiceError('memory_full','长期记忆最多 32 条、共 8000 字，请整理后再保存')
    const next={revision:previous.revision+1,updatedAt:Date.now(),items};write(join(this.directory(id),'memory.json'),next);return next
  }
  replaceMemory(id:string,text:unknown,revision:unknown) {
    if(typeof text!=='string'||text.length>8032)throw new VoiceError('bad_memory','记忆内容格式或长度不正确')
    const old=this.memory(id)
    if(revision!==old.revision)throw new VoiceError('memory_conflict','记忆已被更新，请重新加载后再保存')
    const lines=[...new Set(text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean))]
    if(lines.some(s=>s.length>1000))throw new VoiceError('bad_memory','每条记忆最多 1000 字')
    return this.saveMemory(id,old,lines.map(text=>old.items.find(i=>i.text===text)??{id:randomUUID(),text,createdAt:Date.now()}))
  }
  remember(id:string,text:unknown) {
    if(typeof text!=='string'||!text.trim()||text.length>1000)throw new VoiceError('bad_memory','记忆需为 1–1000 字的文本')
    const value=text.trim().replace(/\s*\n\s*/g,' '),old=this.memory(id)
    return old.items.some(i=>i.text===value)?old:this.saveMemory(id,old,[...old.items,{id:randomUUID(),text:value,createdAt:Date.now()}])
  }
  forget(id:string,itemId:unknown) {
    const old=this.memory(id)
    if(typeof itemId!=='string'||!old.items.some(i=>i.id===itemId))throw new VoiceError('memory_missing','当前客户端没有这条记忆')
    return this.saveMemory(id,old,old.items.filter(i=>i.id!==itemId))
  }
  conversations(id:string):Array<{conversationId:string;preset:string;sessionId:string;updatedAt:number;epoch:string}> {
    const path=join(this.directory(id),'conversations.json')
    if(!existsSync(path))return []
    const rows=JSON.parse(readFileSync(path,'utf8'));if(!Array.isArray(rows)||rows.length>256)throw new Error('invalid client conversation index');return rows
  }
  touch(id:string,conversationId:string,preset:string,sessionId:string) {
    const profile=this.profile(id),rows=this.conversations(id),key=(r:any)=>r.conversationId===conversationId&&r.preset===preset&&r.epoch===profile.memoryEpoch
    const next=rows.filter(r=>!key(r));next.push({conversationId,preset,sessionId,updatedAt:Date.now(),epoch:profile.memoryEpoch})
    if(next.length>256)next.splice(0,next.length-256)
    write(join(this.directory(id),'conversations.json'),next)
  }
  resetContext(id:string,restore=false) {
    const p=this.profile(id),previous=[...p.previousEpochs],epoch=restore?previous.pop():randomUUID()
    if(!epoch)throw new VoiceError('no_archive','没有可恢复的对话归档')
    if(!restore)previous.push(p.memoryEpoch)
    write(join(this.directory(id),'profile.json'),{...p,memoryEpoch:epoch,previousEpochs:previous.slice(-16),updatedAt:Date.now()})
    return this.view(id)
  }
}
