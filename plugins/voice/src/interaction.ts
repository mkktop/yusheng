// Declarative, transport-independent client presentation contract. No HTML or executable payloads.
import { identifier, VoiceError } from './protocol.js'
import { Buffer } from 'node:buffer'

export const EXPRESSIONS = ['neutral', 'happy', 'sad', 'surprised', 'thinking', 'confused', 'calm'] as const
export const GESTURES = ['nod', 'shake', 'wave', 'point', 'celebrate'] as const
export const COMPONENTS = ['card', 'choices', 'progress', 'form'] as const
export interface PresentationSupport { expressions: string[]; gestures: string[]; components: string[] }
export interface Cue {
  expression?: string; gesture?: string; durationMs: number; intensity: number
  timing: 'now' | 'next_sentence'
}
export interface UIAction { id: string; label: string; prompt: string }
export interface FormField {
  id: string; label: string; type: 'text' | 'number' | 'boolean' | 'select'; required: boolean
  options?: Array<{ value: string; label: string }>; min?: number; max?: number
}
export interface UIComponent {
  id: string; type: 'card' | 'choices' | 'progress' | 'form'; title: string; text?: string
  rows?: Array<{ label: string; value: string }>; actions?: UIAction[]; fields?: FormField[]
  value?: number; expiresInMs: number
}
export interface PublicComponent extends Omit<UIComponent, 'actions' | 'expiresInMs'> {
  actions?: Array<{ id: string; label: string }>
  revision: number; expiresAt: number; disabled: boolean
  instanceId: string
}
export type ClientEffect = { kind: 'cue'; cue: Cue } | { kind: 'render'; component: UIComponent } | { kind: 'remove'; componentId: string }

function object(value: unknown, allowed: string[]): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new VoiceError('bad_interaction', '参数必须是对象')
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new VoiceError('bad_interaction', `不支持字段 ${key}`)
  return value as Record<string, any>
}
function text(value: unknown, max: number, optional = false): string | undefined {
  if (optional && value === undefined) return
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new VoiceError('bad_interaction', `文本必须为 1–${max} 字符`)
  return value
}
function id(value: unknown): string {
  if (!identifier(value)) throw new VoiceError('bad_interaction', 'ID 必须为 1–64 位字母、数字、下划线或连字符')
  return value
}
function number(value: unknown, min: number, max: number, fallback?: number): number {
  if (value === undefined && fallback !== undefined) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new VoiceError('bad_interaction', `数值必须在 ${min}–${max} 之间`)
  return value
}
function list<T>(value: unknown, max: number, parse: (item: unknown) => T): T[] {
  if (!Array.isArray(value) || !value.length || value.length > max) throw new VoiceError('bad_interaction', `数组需包含 1–${max} 项`)
  return value.map(parse)
}
function unique(items: Array<{ id: string }>) {
  if (new Set(items.map(item => item.id)).size !== items.length) throw new VoiceError('bad_interaction', '存在重复 ID')
}

export function support(value: unknown): PresentationSupport {
  const source = value === undefined ? {} : object(value, ['expressions', 'gestures', 'components'])
  const names = (v: unknown, defaults: readonly string[]) => v === undefined ? [...defaults] : (Array.isArray(v) && v.length === 0 ? [] : [...new Set(list(v, 32, id))])
  const components = names(source.components, COMPONENTS)
  if (components.some(name => !(COMPONENTS as readonly string[]).includes(name))) throw new VoiceError('bad_interaction', '未知 UI 组件类型')
  return { expressions: names(source.expressions, EXPRESSIONS), gestures: names(source.gestures, GESTURES), components }
}

export function cue(value: unknown, supported: PresentationSupport): Cue {
  const source = object(value, ['expression', 'gesture', 'durationMs', 'intensity', 'timing'])
  if (!source.expression && !source.gesture) throw new VoiceError('bad_interaction', '至少指定表情或动作')
  if (source.expression !== undefined && !supported.expressions.includes(source.expression)) throw new VoiceError('unsupported_presentation', '客户端不支持该表情')
  if (source.gesture !== undefined && !supported.gestures.includes(source.gesture)) throw new VoiceError('unsupported_presentation', '客户端不支持该动作')
  if (source.timing !== undefined && !['now', 'next_sentence'].includes(source.timing)) throw new VoiceError('bad_interaction', 'timing 必须为 now 或 next_sentence')
  return { ...(source.expression ? { expression: source.expression } : {}), ...(source.gesture ? { gesture: source.gesture } : {}), durationMs: number(source.durationMs, 100, 10_000, 1800), intensity: number(source.intensity, 0, 1, .7), timing: source.timing ?? 'now' }
}

export function component(value: unknown, supported: PresentationSupport): UIComponent {
  const s = object(value, ['id','type','title','text','rows','actions','fields','value','expiresInMs'])
  if (!supported.components.includes(s.type)) throw new VoiceError('unsupported_component', '客户端不支持该组件')
  const result: UIComponent = { id: id(s.id), type: s.type, title: text(s.title, 120)!, expiresInMs: number(s.expiresInMs, 10_000, 1_800_000, 300_000) }
  const body = text(s.text, 2000, true)
  if (body !== undefined) result.text = body
  if (s.rows !== undefined) result.rows = list(s.rows, 12, item => { const r=object(item,['label','value']);return {label:text(r.label,80)!,value:text(r.value,256)!} })
  if (s.actions !== undefined) {
    result.actions = list(s.actions, 8, item => { const a=object(item,['id','label','prompt']); return {id:id(a.id),label:text(a.label,80)!,prompt:text(a.prompt,1000)!} })
    unique(result.actions)
  }
  if (s.fields !== undefined) {
    result.fields = list(s.fields, 8, item => {
      const f=object(item,['id','label','type','required','options','min','max'])
      if (!['text','number','boolean','select'].includes(f.type) || (f.required !== undefined && typeof f.required !== 'boolean')) throw new VoiceError('bad_interaction','无效表单字段')
      const field:FormField={id:id(f.id),label:text(f.label,80)!,type:f.type,required:f.required??false}
      if (f.type==='select') {
        field.options=list(f.options,12,item=>{const o=object(item,['value','label']);return {value:text(o.value,80)!,label:text(o.label,80)!}})
        if (new Set(field.options.map(o=>o.value)).size!==field.options.length)throw new VoiceError('bad_interaction','选项值重复')
      } else if (f.options!==undefined)throw new VoiceError('bad_interaction','只有 select 支持 options')
      if(f.min!==undefined)field.min=number(f.min,-1e9,1e9)
      if(f.max!==undefined)field.max=number(f.max,-1e9,1e9)
      if((f.min!==undefined||f.max!==undefined)&&f.type!=='number')throw new VoiceError('bad_interaction','只有 number 支持范围')
      if(field.min!==undefined&&field.max!==undefined&&field.min>field.max)throw new VoiceError('bad_interaction','数值范围颠倒')
      return field
    }); unique(result.fields)
  }
  if (s.type==='progress') {
    if(s.value!==undefined)result.value=number(s.value,0,1)
    if(s.actions!==undefined||s.fields!==undefined||s.rows!==undefined)throw new VoiceError('bad_interaction','进度组件不包含表单或操作')
  } else if(s.value!==undefined)throw new VoiceError('bad_interaction','只有 progress 支持 value')
  if(s.type==='choices' && !result.actions?.length)throw new VoiceError('bad_interaction','选项组件必须提供 actions')
  if(s.type==='form' && (!result.fields?.length || result.actions?.length!==1))throw new VoiceError('bad_interaction','表单需字段和一个提交操作')
  if(s.type!=='form' && s.fields!==undefined)throw new VoiceError('bad_interaction','只有 form 支持 fields')
  if(Buffer.byteLength(JSON.stringify(result),'utf8')>12*1024)throw new VoiceError('bad_interaction','组件超过 12KiB 大小上限')
  return result
}

export function formValues(fields: FormField[] = [], value: unknown): Record<string, string | number | boolean> {
  const source=object(value??{},fields.map(f=>f.id)), result:Record<string,string|number|boolean>=Object.create(null)
  for(const field of fields) {
    const v=Object.hasOwn(source,field.id)?source[field.id]:undefined
    if(v===undefined||v==='') {if(field.required)throw new VoiceError('bad_ui_values',`${field.label} 为必填项`);continue}
    if(field.type==='number')result[field.id]=number(v,field.min??-1e9,field.max??1e9)
    else if(field.type==='boolean'){if(typeof v!=='boolean')throw new VoiceError('bad_ui_values','布尔字段类型错误');if(field.required&&!v)throw new VoiceError('bad_ui_values',`${field.label} 需要勾选`);result[field.id]=v}
    else { const parsed=text(v,256)!;if(field.type==='select'&&!field.options!.some(o=>o.value===parsed))throw new VoiceError('bad_ui_values','选择了不存在的选项');result[field.id]=parsed }
  }
  return result
}

const string = (maxLength = 128) => ({type:'string',maxLength})
export function interactionTools(supported: PresentationSupport, capabilities: string[], emit: (effect: ClientEffect) => unknown, valid: (exec:any) => void) {
  const output={schema:{type:'object',properties:{ok:{type:'boolean'},result:{type:'string'}},required:['ok','result'],additionalProperties:false},render:(_args:unknown,value:unknown)=>[{type:'text',text:JSON.stringify(value)}]}
  const tool=(name:string,description:string,properties:unknown,required:string[],execute:(args:any)=>unknown)=>({name,description,parameters:{type:'object',properties,required,additionalProperties:false},output,async execute(args:unknown,exec:any){valid(exec);exec.signal.throwIfAborted();return {ok:true,result:JSON.stringify(execute(args))}}})
  const tools=[]
  if(capabilities.includes('presentation.cue')&&(supported.expressions.length||supported.gestures.length))tools.push(tool('voice_present','Control this voice client avatar. Emit a supported expression/gesture; next_sentence synchronizes with the first audio of your next spoken sentence. Do not put animation instructions in spoken text.',{
    ...(supported.expressions.length?{expression:{type:'string',enum:supported.expressions}}:{}),...(supported.gestures.length?{gesture:{type:'string',enum:supported.gestures}}:{}),durationMs:{type:'number',minimum:100,maximum:10000},intensity:{type:'number',minimum:0,maximum:1},timing:{type:'string',enum:['now','next_sentence']},
  },[],args=>emit({kind:'cue',cue:cue(args,supported)})))
  if(capabilities.includes('ui.render')&&supported.components.length)tools.push(tool('voice_ui','Render or update a declarative client component by id. Server owns revision and expiry. Actions use server-stored prompt text and submit a new user turn after the current turn ends. Use card, choices, progress or form. Text is plain text. Remove with operation=remove and componentId.',{
    operation:{type:'string',enum:['render','remove']},componentId:string(64),component:{type:'object',properties:{id:string(64),type:{type:'string',enum:supported.components},title:string(120),text:string(2000),value:{type:'number',minimum:0,maximum:1},expiresInMs:{type:'number',minimum:10000,maximum:1800000},rows:{type:'array',maxItems:12,items:{type:'object',properties:{label:string(80),value:string(256)},required:['label','value'],additionalProperties:false}},actions:{type:'array',maxItems:8,items:{type:'object',properties:{id:string(64),label:string(80),prompt:string(1000)},required:['id','label','prompt'],additionalProperties:false}},fields:{type:'array',maxItems:8,items:{type:'object',properties:{id:string(64),label:string(80),type:{type:'string',enum:['text','number','boolean','select']},required:{type:'boolean'},min:{type:'number'},max:{type:'number'},options:{type:'array',maxItems:12,items:{type:'object',properties:{value:string(80),label:string(80)},required:['value','label'],additionalProperties:false}}},required:['id','label','type'],additionalProperties:false}}},required:['id','type','title'],additionalProperties:false},
  },['operation'],args=>{
    const s=object(args,['operation','componentId','component'])
    if(s.operation==='remove'){if(s.component!==undefined)throw new VoiceError('bad_interaction','remove 不接受 component');return emit({kind:'remove',componentId:id(s.componentId)})}
    if(s.operation!=='render'||s.componentId!==undefined)throw new VoiceError('bad_interaction','render 需要 component')
    return emit({kind:'render',component:component(s.component,supported)})
  }))
  return tools
}
