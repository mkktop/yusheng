import { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { identifier, VoiceError } from './protocol.js'

export type MemoryKind = 'profile' | 'preference' | 'fact' | 'event'
export interface MemorySource { actor:'user'|'assistant'|'settings'|'migration'; conversationId?:string; turnId?:string }
export interface MemoryItem {
  id:string; text:string; kind:MemoryKind; key?:string; importance:number
  createdAt:number; updatedAt:number; expiresAt?:number; source:MemorySource
}
export interface MemoryEvent { id:string; at:number; operation:'create'|'update'|'forget'|'clear'; memoryId?:string; actor:MemorySource['actor']; revision:number; fields?:string[] }
export interface MemoryEpisode { id:string; at:number; conversationId:string; sessionId:string; epoch:string; user:string; assistant:string }
export interface ClientMemory {
  schemaVersion:2; revision:number; updatedAt:number; barrier:number
  items:MemoryItem[]; events:MemoryEvent[]; episodes:MemoryEpisode[]
}
export interface MemoryRecall { revision:number; total:number; items:MemoryItem[]; episodes:MemoryEpisode[] }
export interface MemoryInput { text:unknown; id?:unknown; key?:unknown; kind?:unknown; importance?:unknown; expiresAt?:unknown; revision?:unknown }
const KINDS = new Set(['profile','preference','fact','event'])
export const MEMORY_LIMITS = { items:256, characters:64000, itemCharacters:1000, episodes:128, events:128, contextCharacters:3200 }
const empty = ():ClientMemory=>({schemaVersion:2,revision:0,updatedAt:0,barrier:0,items:[],events:[],episodes:[]})
const fail = (message:string):never=>{throw new VoiceError('bad_memory',message)}
const normalized=(text:string)=>text.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu,'')
export function sensitiveMemory(text:string) {return /\b(?:sk-|ysa-|ysd-|ysv-)[A-Za-z0-9_-]{16,}/i.test(text)||/(?:api[ _-]?key|password|secret|token|密码|密钥|令牌)\s*(?:[:：=是为]\s*)+\S{6,}/i.test(text)}

/** Conservative, direct-user facts only. Common topics receive stable keys for corrections. */
export function extractMemory(input:string,adaptive=false):Omit<MemoryInput,'text'>&{text:string}|undefined {
  const value=input.trim(),match=/^(?:请(?:帮我)?(?:记住|记下)|帮我记住|记住|记一下)\s*[：:,，]?\s*(.+)$/s.exec(value)
  if(!match&&!adaptive)return
  const text=(match?.[1]??value).trim().replace(/[。.!！]+$/,'')
  if(!text||text.length>1000||/(?:吗|么|呢)$/.test(text)||/[?？]|(?:是否|假如|假设|如果|举例|比如|他说|她说|不要记|别记|不用记)/.test(text)||sensitiveMemory(text))return
  let key:string|undefined,kind:MemoryKind='fact'
  if(/^我(?:现在)?(?:叫|的名字是)/.test(text)){key='profile.name';kind='profile'}
  else if(/^我(?:现在)?住在/.test(text)){key='profile.location';kind='profile'}
  else if(/^(?:以后)?(?:请)?(?:叫我|称呼我为?)/.test(text)){key='profile.address';kind='profile'}
  else if(/^(?:我)?(?:希望|喜欢|想要)?(?:你)?(?:以后|回答|回复|说话)/.test(text)&&/(?:简短|简洁|详细|展开|精简)/.test(text)){key='preference.response.length';kind='preference'}
  else if(/^我(?:现在|以后|已经|不再|再也)?(?:不|很|更|最|不太|不再|再也不)?(?:喜欢|爱喝|喝|吃|爱吃|讨厌)/.test(text)){
    const topic=/(?:咖啡|coffee)/i.test(text)?'coffee':/(?:绿茶|红茶|茶|tea)/i.test(text)?'tea':undefined
    if(topic){key='preference.drink.'+topic;kind='preference'}
    else kind='preference'
  }
  if(!match&&!key)return
  return {text,key,kind,importance:kind==='profile'?4:3}
}

function terms(text:string) {
  const out=new Set<string>(),clean=text.normalize('NFKC').toLowerCase()
  for(const word of clean.match(/[a-z0-9_]{2,}/g)??[])out.add(word)
  for(const run of clean.match(/[\p{Script=Han}]+/gu)??[])for(let i=0;i<run.length-1;i++)out.add(run.slice(i,i+2))
  for(const stop of ['什么','一下','之前','我的','你的','记住','记忆','请问','告诉','现在','可以','这个','那个'])out.delete(stop)
  return out
}
function overlap(query:Set<string>,text:string) {const values=terms(text);let score=0;for(const word of query)if(values.has(word))score+=word.length>2?2:1;return score}

/** One atomic document keeps facts, recall excerpts and the forgetting barrier consistent. */
export class MemoryStore {
  constructor(readonly path:string) {}
  read():ClientMemory {
    if(!existsSync(this.path))return empty()
    const raw=JSON.parse(readFileSync(this.path,'utf8'))
    if(!Number.isSafeInteger(raw?.revision)||raw.revision<0||!Array.isArray(raw.items))throw new Error('invalid client memory; refusing to reset it')
    if(raw.schemaVersion!==undefined&&raw.schemaVersion!==2)throw new Error('unsupported client memory schema')
    const legacy=raw.schemaVersion===undefined
    if(!legacy&&(!Array.isArray(raw.events)||!Array.isArray(raw.episodes)||!Number.isSafeInteger(raw.barrier)||raw.barrier<0))throw new Error('invalid client memory metadata')
    const doc:ClientMemory={...empty(),...raw,schemaVersion:2,items:raw.items.map((item:any)=>legacy?{...item,kind:'fact',importance:3,updatedAt:item.createdAt,source:{actor:'migration'}}:item)}
    if(doc.items.length>MEMORY_LIMITS.items||doc.items.some(i=>!identifier(i.id)||typeof i.text!=='string'||!i.text||i.text.length>1000||!KINDS.has(i.kind)||!Number.isFinite(i.createdAt)||!Number.isFinite(i.updatedAt)||!Number.isInteger(i.importance)||i.importance<1||i.importance>5||!this.validSource(i.source)||(i.key!==undefined&&!this.validKey(i.key))||(i.expiresAt!==undefined&&!Number.isFinite(i.expiresAt)))||doc.items.reduce((sum,i)=>sum+i.text.length,0)>MEMORY_LIMITS.characters)throw new Error('invalid client memory facts')
    if(new Set(doc.items.map(i=>i.id)).size!==doc.items.length||new Set(doc.items.filter(i=>i.key).map(i=>i.key)).size!==doc.items.filter(i=>i.key).length)throw new Error('duplicate memory identity')
    if(doc.events.length>128||doc.episodes.length>128||doc.events.some(e=>!identifier(e.id)||!['create','update','forget','clear'].includes(e.operation)||!Number.isFinite(e.at)||!Number.isSafeInteger(e.revision))||doc.episodes.some(e=>!identifier(e.id)||typeof e.user!=='string'||e.user.length>480||typeof e.assistant!=='string'||e.assistant.length>720||typeof e.epoch!=='string'||!identifier(e.conversationId)||typeof e.sessionId!=='string'||!Number.isFinite(e.at)))throw new Error('invalid client memory history')
    return doc
  }
  private validKey(key:unknown):key is string {return typeof key==='string'&&/^[a-z0-9][a-z0-9._:-]{0,95}$/.test(key)}
  private validSource(source:any):source is MemorySource {return source&&['user','assistant','settings','migration'].includes(source.actor)&&(source.conversationId===undefined||identifier(source.conversationId))&&(source.turnId===undefined||identifier(source.turnId,128))}
  private checkRevision(doc:ClientMemory,revision:unknown) {if(revision!==undefined&&revision!==doc.revision)throw new VoiceError('memory_conflict','记忆已被更新，请重新加载后再保存')}
  private save(doc:ClientMemory) {
    if(doc.items.length>MEMORY_LIMITS.items||doc.items.reduce((sum,i)=>sum+i.text.length,0)>MEMORY_LIMITS.characters)throw new VoiceError('memory_full','长期记忆最多 256 条、共 64000 字，请整理后再保存')
    const temporary=this.path+'.'+randomUUID()+'.tmp';let fd:number|undefined
    try{
      fd=openSync(temporary,'wx',0o600);writeFileSync(fd,JSON.stringify(doc,null,2)+'\n');fsyncSync(fd);closeSync(fd);fd=undefined;renameSync(temporary,this.path)
      // Linux persists the rename too; Windows does not permit opening a directory this way.
      if(process.platform!=='win32'){const directory=openSync(dirname(this.path),'r');try{fsyncSync(directory)}finally{closeSync(directory)}}
    }catch(error){if(fd!==undefined)closeSync(fd);try{unlinkSync(temporary)}catch{}throw error}
    return doc
  }
  private event(doc:ClientMemory,operation:MemoryEvent['operation'],source:MemorySource,memoryId?:string,fields?:string[]) {
    doc.events.push({id:randomUUID(),at:Date.now(),operation,actor:source.actor,memoryId,revision:doc.revision+1,fields});doc.events=doc.events.slice(-128)
  }
  private commit(doc:ClientMemory) {doc.revision++;doc.updatedAt=Date.now();return this.save(doc)}
  private text(value:unknown) {
    if(typeof value!=='string'||!value.trim()||value.length>1000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))fail('记忆需为 1–1000 字的文本')
    const text=(value as string).trim().replace(/\s*\n\s*/g,' ')
    if(sensitiveMemory(text))throw new VoiceError('sensitive_memory','不保存密码、密钥或接入令牌，请使用专门的凭据设置')
    return text
  }
  upsert(input:MemoryInput,source:MemorySource={actor:'assistant'}) {
    const doc=this.read();this.checkRevision(doc,input.revision)
    let text=this.text(input.text);const inferred=extractMemory('请记住'+text);let key=input.key===undefined?inferred?.key:input.key===''?undefined:input.key
    if(key!==undefined&&!this.validKey(key))fail('主题键只允许小写字母、数字和 . _ : -，最长 96 字')
    if(input.id!==undefined&&(typeof input.id!=='string'||!doc.items.some(i=>i.id===input.id)))throw new VoiceError('memory_missing','当前客户端没有这条记忆')
    const previous=input.id?doc.items.find(i=>i.id===input.id):key?doc.items.find(i=>i.key===key):doc.items.find(i=>normalized(i.text)===normalized(text))
    if(input.id&&input.key===undefined)key=previous?.key??key
    if(previous&&normalized(previous.text)===normalized(text))text=previous.text
    if(key&&doc.items.some(i=>i.key===key&&i.id!==previous?.id))throw new VoiceError('memory_key_conflict','此主题已有记忆，请编辑已有记录')
    const kind=input.kind??previous?.kind??inferred?.kind??'fact',importance=input.importance??previous?.importance??3
    if(!KINDS.has(kind as string)||!Number.isInteger(importance)||Number(importance)<1||Number(importance)>5)fail('记忆分类或重要程度不正确')
    const expiresAt=input.expiresAt===null?undefined:input.expiresAt??previous?.expiresAt
    if(expiresAt!==undefined&&(typeof expiresAt!=='number'||!Number.isFinite(expiresAt)||expiresAt<=Date.now()))fail('到期时间必须晚于当前时间')
    const item:MemoryItem={id:previous?.id??randomUUID(),text,kind:kind as MemoryKind,key:key as string|undefined,importance:Number(importance),createdAt:previous?.createdAt??Date.now(),updatedAt:Date.now(),expiresAt:expiresAt as number|undefined,source}
    const fields=(['text','kind','key','importance','expiresAt'] as const).filter(k=>previous?.[k]!==item[k])
    if(previous&&!fields.length)return doc
    doc.items=doc.items.filter(i=>i.id!==item.id);doc.items.push(item);this.event(doc,previous?'update':'create',source,item.id,fields)
    // A correction must not be contradicted by an older retrieved conversation excerpt.
    if(previous&&previous.text!==text){doc.episodes=[];doc.barrier++}
    return this.commit(doc)
  }
  forget(id:unknown,revision?:unknown,source:MemorySource={actor:'assistant'}) {
    const doc=this.read();this.checkRevision(doc,revision)
    if(typeof id!=='string'||!doc.items.some(i=>i.id===id))throw new VoiceError('memory_missing','当前客户端没有这条记忆')
    doc.items=doc.items.filter(i=>i.id!==id);doc.episodes=[];doc.barrier++;this.event(doc,'forget',source,id)
    return this.commit(doc)
  }
  clear(revision:unknown,source:MemorySource={actor:'settings'}) {
    const doc=this.read();this.checkRevision(doc,revision);doc.items=[];doc.episodes=[];doc.barrier++;this.event(doc,'clear',source);return this.commit(doc)
  }
  replace(text:unknown,revision:unknown) {
    if(typeof text!=='string'||text.length>8032)fail('批量文本最多 8032 字；大量记忆请逐条编辑')
    const doc=this.read();if(!Number.isSafeInteger(revision))fail('请提供当前记忆版本');this.checkRevision(doc,revision)
    const lines=[...new Set((text as string).split(/\r?\n/).map(s=>s.trim()).filter(Boolean))].map(s=>this.text(s)),old=doc.items
    doc.items=lines.map(text=>old.find(i=>i.text===text)??{id:randomUUID(),text,kind:'fact',importance:3,createdAt:Date.now(),updatedAt:Date.now(),source:{actor:'settings'}}) as MemoryItem[]
    for(const i of old)if(!doc.items.some(n=>n.id===i.id))this.event(doc,'forget',{actor:'settings'},i.id)
    for(const i of doc.items)if(!old.some(n=>n.id===i.id))this.event(doc,'create',{actor:'settings'},i.id)
    if(old.some(i=>!doc.items.some(n=>n.id===i.id))){doc.barrier++;doc.episodes=[]}
    return this.commit(doc)
  }
  observe(text:string,source:MemorySource,adaptive=false) {const input=extractMemory(text,adaptive);return input?this.upsert(input,source):undefined}
  record(episode:Omit<MemoryEpisode,'id'|'at'>) {
    if(typeof episode.user!=='string'||typeof episode.assistant!=='string'||!episode.user.trim()||!episode.assistant.trim())return
    if(sensitiveMemory(episode.user)||sensitiveMemory(episode.assistant))return
    const doc=this.read();doc.episodes.push({...episode,id:randomUUID(),at:Date.now(),user:episode.user.slice(0,480),assistant:episode.assistant.slice(0,720)});doc.episodes=doc.episodes.slice(-128)
    // Excerpts are retrieval data, not a fact edit; do not invalidate an owner's fact editor revision.
    this.save(doc)
  }
  recall(query:string,limit=12):MemoryRecall {
    const doc=this.read(),now=Date.now(),wanted=terms(query),active=doc.items.filter(i=>!i.expiresAt||i.expiresAt>now)
    const ranked=active.map(item=>({item,match:overlap(wanted,item.text+' '+(item.key??'')),score:0})).map(r=>({...r,score:r.match*10+r.item.importance+(r.item.kind==='profile'?3:0)+1/(1+(now-r.item.updatedAt)/86400000)})).sort((a,b)=>b.score-a.score)
    const matched=ranked.filter(r=>r.match>0||r.item.kind==='profile'),pool=matched.length?matched:ranked.slice(0,4)
    let size=0;const items:MemoryItem[]=[]
    for(const {item} of pool){if(items.length>=Math.min(32,Math.max(1,limit)))break;if(size+item.text.length>2200)continue;items.push(item);size+=item.text.length}
    const episodes:MemoryEpisode[]=[]
    for(const row of doc.episodes.map(item=>({item,score:overlap(wanted,item.user+' '+item.assistant)})).filter(r=>r.score>0).sort((a,b)=>b.score-a.score||b.item.at-a.item.at)){
      if(episodes.length>=3)break;const item={...row.item,user:row.item.user.slice(0,200),assistant:row.item.assistant.slice(0,300)}
      if(size+item.user.length+item.assistant.length>MEMORY_LIMITS.contextCharacters)continue;episodes.push(item);size+=item.user.length+item.assistant.length
    }
    return {revision:doc.revision,total:active.length,items,episodes}
  }
}
