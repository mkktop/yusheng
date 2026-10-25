import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { Buffer } from 'node:buffer'
import { newId, VoiceError } from './protocol.js'
import { formValues, type UIComponent, type PublicComponent } from './interaction.js'

interface Entry { component:UIComponent; revision:number; expiresAt:number; disabled:boolean; turnId:string; instanceId:string }
interface Scope { revision:number; components:Record<string,Entry> }

/** Server-owned UI state. Click prompts never come from clients. Atomic consumption prevents replay. */
export class SurfaceStore {
  private scopes: Record<string,Scope> = Object.create(null)
  constructor(private path?:string) {
    if(path && existsSync(path)) {
      const raw=JSON.parse(readFileSync(path,'utf8'))
      if(!raw || typeof raw!=='object' || Array.isArray(raw) || Buffer.byteLength(JSON.stringify(raw))>4*1024*1024)throw new Error('invalid voice UI registry')
      this.scopes=raw
    }
  }
  static key(deviceId:string,conversationId:string,preset:string) {return JSON.stringify([deviceId,conversationId,preset])}
  private view(entry:Entry):PublicComponent {
    const {actions,expiresInMs,...component}=entry.component
    return {...component,...(actions?{actions:actions.map(({id,label})=>({id,label}))}:{}),revision:entry.revision,expiresAt:entry.expiresAt,disabled:entry.disabled,instanceId:entry.instanceId}
  }
  snapshot(key:string):PublicComponent[] {return Object.values(this.scopes[key]?.components??{}).filter(e=>e.expiresAt>Date.now()).map(e=>this.view(e))}
  private save(key:string,scope:Scope) {
    const next={...this.scopes,[key]:scope}
    // Drop expired scopes while preserving revision counters for scopes still in use.
    for(const [k,s] of Object.entries(next))if(k!==key && Object.values(s.components).every(e=>e.expiresAt<=Date.now()))delete next[k]
    const data=JSON.stringify(next)
    if(Object.keys(next).length>256||Buffer.byteLength(data)>4*1024*1024)throw new VoiceError('ui_overflow','UI 状态超过容量上限')
    if(this.path) {mkdirSync(dirname(this.path),{recursive:true});const temp=`${this.path}.${newId()}.tmp`;writeFileSync(temp,data,{mode:0o600});renameSync(temp,this.path)}
    this.scopes=next
  }
  render(key:string,component:UIComponent,turnId:string):PublicComponent {
    const original=this.scopes[key]??{revision:0,components:{}}
    const components=Object.fromEntries(Object.entries(original.components).filter(([,e])=>e.expiresAt>Date.now()))
    if(!Object.hasOwn(components,component.id)&&Object.keys(components).length>=16)throw new VoiceError('ui_overflow','单个对话最多保留 16 个组件')
    const entry={component:structuredClone(component),revision:original.revision+1,expiresAt:Date.now()+component.expiresInMs,disabled:false,turnId,instanceId:newId()}
    components[component.id]=entry;this.save(key,{revision:entry.revision,components})
    return this.view(entry)
  }
  remove(key:string,id:string,revision?:number,instanceId?:string):number|undefined {
    const scope=this.scopes[key],entry=scope&&Object.hasOwn(scope.components,id)?scope.components[id]:undefined
    if(!entry)return
    if(revision!==undefined&&entry.revision!==revision)throw new VoiceError('stale_ui','组件已更新')
    if(instanceId!==undefined&&entry.instanceId!==instanceId)throw new VoiceError('stale_ui','组件实例已变化')
    const components={...scope.components};delete components[id]
    const next=scope.revision+1;this.save(key,{revision:next,components});return next
  }
  invalidateTurn(key:string,turnId:string):Array<{componentId:string;revision:number}> {
    const scope=this.scopes[key]
    if(!scope)return []
    const removed=[] as Array<{componentId:string;revision:number}>,components={...scope.components}
    let revision=scope.revision
    for(const [id,e] of Object.entries(components))if(e.turnId===turnId){delete components[id];removed.push({componentId:id,revision:++revision})}
    if(removed.length)this.save(key,{revision,components})
    return removed
  }
  prepare(key:string,id:string,revision:number,instanceId:string,actionId:string,values:unknown) {
    const entry=this.scopes[key]?.components[id]
    if(!entry||entry.expiresAt<=Date.now()||entry.revision!==revision||entry.instanceId!==instanceId||entry.disabled)throw new VoiceError('stale_ui','组件已过期、更新或被提交')
    const action=entry.component.actions?.find(a=>a.id===actionId)
    if(!action)throw new VoiceError('bad_ui_action','操作不存在')
    const parsed=formValues(entry.component.fields,values)
    const text=`用户在客户端选择了「${entry.component.title}」中的「${action.label}」。\n${action.prompt}${Object.keys(parsed).length?`\n用户提交的数据：${JSON.stringify(parsed)}`:''}`
    return {text,consume:()=>{
      const current=this.scopes[key]
      if(current?.components[id]!==entry)throw new VoiceError('stale_ui','组件已更新')
      const changed={...entry,disabled:true,revision:current.revision+1}
      this.save(key,{revision:changed.revision,components:{...current.components,[id]:changed}})
      return this.view(changed)
    }}
  }
}
