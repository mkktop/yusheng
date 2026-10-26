import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { TTS_MODELS, VOICE_GROUPS } from './catalog.js'
import css from './settings.css'
import { PersonaSettings } from './persona-settings.js'
import { VOICE_PRESET_ID } from '../persona.js'
import { request, hostManagementUrl, type Connection } from './management-client.js'
import { ClientMemoryPanel } from './client-memory-panel.js'

type Tab = 'voice' | 'persona' | 'memory' | 'devices' | 'diagnostics'
type Phase = 'idle' | 'connecting' | 'connected' | 'error'
type TestKind = 'asr' | 'tts' | 'llm'
interface TestEntry { busy:boolean; result?:any }
interface Notice { tone:'success'|'error'; text:string }
const NUMBERS=['ttsSpeed','ttsVol','ttsPitch','maxTurnSeconds']
const TESTS=[{id:'asr' as const,name:'语音识别',description:'检查 MiniMax 识别服务与凭据。',button:'测试识别',icon:'mic'}, {id:'llm' as const,name:'对话能力',description:'通过 dsh 会话验证模型调用。',button:'测试对话',icon:'sparkles'}, {id:'tts' as const,name:'语音合成',description:'检查当前已保存的声音配置。',button:'测试合成',icon:'volume'}]

function Icon({name,size=16,spin=false}:{name:string;size?:number;spin?:boolean}) {
  const paths:Record<string,ReactNode>={
    mic:<><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/></>,
    wave:<><path d="M3 10v4M7 6v12M12 3v18M17 7v10M21 10v4"/></>,
    plug:<><rect x="5" y="7" width="14" height="10" rx="3"/><path d="M8 3v4M16 3v4M12 17v4M9 11h.01M15 11h.01"/></>,
    sparkles:<><path d="m12 3 2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6L12 3ZM20 2v4M18 4h4"/></>,
    device:<><rect x="4" y="3" width="16" height="14" rx="3"/><path d="M8 21h8M12 17v4M8 7h8M8 11h4"/></>,
    shield:<><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/></>,
    check:<path d="m5 12 4 4L19 6"/>,
    refresh:<><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 12-1l2 2M4 16l2 2a7 7 0 0 0 12-1"/></>,
    arrow:<><path d="M7 17 17 7M7 7h10v10"/></>,
    chevron:<path d="m9 5 7 7-7 7"/>,
    copy:<><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M15 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></>,
    eye:<><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></>,
    hidden:<><path d="m3 3 18 18M10 5a11 11 0 0 1 2 0c6.5 0 10 7 10 7a21 21 0 0 1-4 5M6 6a22 22 0 0 0-4 6s3.5 7 10 7a13 13 0 0 0 5-1M10 10a3 3 0 0 0 4 4"/></>,
    trash:<><path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/></>,
    clock:<><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    volume:<><path d="m11 4-6 5H2v6h3l6 5V4ZM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14"/></>,
    info:<><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/></>,
    close:<path d="m6 6 12 12M6 18 18 6"/>,
  }
  return <svg className={spin?'ys-spin':undefined} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[name]??paths.info}</svg>
}

function Badge({tone,children}:{tone?:string;children:ReactNode}) {return <span className="ys-badge" data-tone={tone}><i className="ys-dot"/>{children}</span>}
function Card({icon,title,description,action,children}:{icon:string;title:string;description:string;action?:ReactNode;children:ReactNode}) {
  return <section className="ys-card"><div className="ys-card-header"><span className="ys-card-symbol"><Icon name={icon} size={18}/></span><div className="ys-card-heading"><h2>{title}</h2><p>{description}</p></div>{action}</div><div className="ys-card-body">{children}</div></section>
}
function SecretField({id,label,value,onChange,placeholder,disabled,readOnly,onCopy,help,maxLength=256}:{id:string;label:string;value:string;onChange?:(value:string)=>void;placeholder?:string;disabled?:boolean;readOnly?:boolean;onCopy?:()=>void;help?:ReactNode;maxLength?:number}) {
  const [visible,setVisible]=useState(false)
  return <div className="ys-field"><label className="ys-label" htmlFor={id}>{label}</label><div className="ys-control"><input id={id} className={'ys-input'+(readOnly?' ys-mono':'')} type={visible?'text':'password'} autoComplete="off" spellCheck={false} value={value} onChange={e=>onChange?.(e.target.value)} placeholder={placeholder} disabled={disabled} readOnly={readOnly} maxLength={maxLength}/><button type="button" className="ys-btn ys-btn-icon" aria-label={(visible?'隐藏':'显示')+label} title={(visible?'隐藏':'显示')+label} disabled={disabled||!value} onClick={()=>setVisible(!visible)}><Icon name={visible?'hidden':'eye'}/></button>{onCopy&&<button type="button" className="ys-btn ys-btn-icon" aria-label={'复制'+label} title={'复制'+label} onClick={onCopy} disabled={disabled||!value}><Icon name="copy"/></button>}</div>{help&&<div className="ys-field-help">{help}</div>}</div>
}

function normalizeUrl(raw:string) {
  const url=new URL(raw.trim())
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw new Error('请填写完整的 HTTP 或 HTTPS 服务地址，不包含令牌或查询参数。')
  return url.toString().replace(/\/+$/,'')
}

interface PanelProps {initialEndpoint?:string;initialManagementUrl?:string;autoConnect?:boolean}
export function VoiceSettingsPanel(props:PanelProps={}) {
  const [selection,setSelection]=useState<{id:string;connection:Connection}|null>(null)
  return <SettingsWorkspace key={selection?.id??'initial'} {...props} initialClientId={selection?.id} initialConnection={selection?.connection} onSelectClient={(id,connection)=>setSelection({id,connection})}/>
}
function SettingsWorkspace({initialEndpoint,initialManagementUrl,autoConnect=true,initialClientId,initialConnection,onSelectClient}:PanelProps&{initialClientId?:string;initialConnection?:Connection;onSelectClient:(id:string,connection:Connection)=>void}) {
  const [endpoint,setEndpoint]=useState(initialEndpoint??`http://${typeof location!=='undefined'?location.hostname:'127.0.0.1'}:8090`)
  const [adminToken,setAdminToken]=useState(initialConnection?.mode==='external'?initialConnection.token:'')
  const [session,setSession]=useState<Connection|null>(null)
  const [phase,setPhase]=useState<Phase>(autoConnect?'connecting':'idle')
  const [managementMode,setManagementMode]=useState<'host'|'external'>(initialConnection?.mode??(autoConnect?'host':'external'))
  const [connectionOpen,setConnectionOpen]=useState(!autoConnect)
  const [connectionError,setConnectionError]=useState('')
  const [status,setStatus]=useState<any>(null)
  const [settings,setSettings]=useState<any>(null)
  const [serverSettings,setServerSettings]=useState<any>(null)
  const [profiles,setProfiles]=useState<any[]>([])
  const [selectedClientId,setSelectedClientId]=useState(initialClientId??'')
  const selectedId=useRef(initialClientId??'')
  const [clientView,setClientView]=useState<any>(null)
  const [memoryDirty,setMemoryDirty]=useState(false)
  const [clientLabel,setClientLabel]=useState('')
  const [tab,setTab]=useState<Tab>('voice')
  const [form,setForm]=useState<Record<string,string>>({})
  const [customVoice,setCustomVoice]=useState(false)
  const [saving,setSaving]=useState(false)
  const [savedAt,setSavedAt]=useState('')
  const [notice,setNotice]=useState<Notice|null>(null)
  const [deviceId,setDeviceId]=useState('')
  const [deviceBusy,setDeviceBusy]=useState('')
  const [issued,setIssued]=useState<{deviceId:string;token:string}|null>(null)
  const [tests,setTests]=useState<Partial<Record<TestKind,TestEntry>>>({})
  const [refreshing,setRefreshing]=useState(false)
  const [copied,setCopied]=useState('')
  const alive=useRef(true),epoch=useRef(0),active=useRef<Connection|null>(null),polling=useRef(false),copyTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),testing=useRef(new Set<TestKind>())
  const dataVersion=useRef(0)
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;++epoch.current;clearTimeout(copyTimer.current)}},[])
  const current=(generation:number)=>alive.current&&epoch.current===generation

  async function load(connection:Connection) {
    const [state,config,inventory]=await Promise.all([request(connection,'/status'),request(connection,'/settings'),request(connection,'/clients')])
    if(!state.ok||!config.ok||!inventory.ok)throw new Error(config.message??state.message??'服务返回了异常状态')
    const clients:any[]=inventory.clients??[]
    const id=clients.some(p=>p.deviceId===selectedId.current)?selectedId.current:state.clients?.find((online:any)=>clients.some(p=>p.deviceId===online.deviceId))?.deviceId??clients[0]?.deviceId??''
    const view=id?await request(connection,'/clients/'+id):null
    return {state,server:config.settings,profiles:clients,id,view,config:view?.settings??null}
  }
  function applyInventory(data:any) {
    setStatus(data.state);setServerSettings(data.server);setProfiles(data.profiles);setSelectedClientId(data.id);selectedId.current=data.id;setClientView(data.view)
  }
  async function refresh(quiet=false) {
    const connection=active.current,generation=epoch.current,revision=dataVersion.current
    if(!connection||polling.current)return
    polling.current=true;if(!quiet)setRefreshing(true)
    try {const data=await load(connection);if(current(generation)){applyInventory(data);if(revision===dataVersion.current)setSettings(data.config);setPhase('connected');setConnectionError('')}}
    catch(e){if(current(generation)){setPhase('error');setConnectionError(e instanceof Error?e.message:String(e))}}
    finally{polling.current=false;if(current(generation))setRefreshing(false)}
  }
  useEffect(()=>{if(!session||phase==='connecting')return;const timer=setInterval(()=>void refresh(true),5000);return()=>clearInterval(timer)},[session,phase])
  async function establish(connection:Connection) {
    if(saving||deviceBusy)return
    const generation=++epoch.current
    active.current=connection;setSession(connection);setManagementMode(connection.mode);setPhase('connecting');setConnectionError('');setNotice(null);setRefreshing(false);testing.current.clear()
    try {
      const data=await load(connection)
      if(!current(generation))return
      applyInventory(data);setSettings(data.config);if(!data.id)setTab('devices');setPhase('connected');setConnectionOpen(false);setForm({});setTests({});setIssued(null);setSavedAt('')
      if(connection.mode==='host')setAdminToken('');else setEndpoint(connection.baseUrl)
    }catch(e){if(current(generation)){setPhase('error');setConnectionError(e instanceof Error?e.message:String(e))}}
  }
  async function connect(event?:any) {
    event?.preventDefault();if(phase==='connecting')return
    try{if(!adminToken.trim())throw new Error('请填写外部服务的管理令牌。');await establish({mode:'external',baseUrl:normalizeUrl(endpoint),token:adminToken.trim()})}
    catch(e){setConnectionError(e instanceof Error?e.message:String(e))}
  }
  async function connectHost(){await establish({mode:'host',baseUrl:initialManagementUrl??hostManagementUrl()})}
  useEffect(()=>{if(initialConnection)void establish(initialConnection);else if(autoConnect)void connectHost()},[autoConnect,initialManagementUrl])
  const setField=(key:string,value:string)=>setForm(previous=>({...previous,[key]:value}))
  const value=(key:string,fallback='')=>form[key]??String(settings?.[key]??fallback)
  const dirtyKeys=Object.keys(form).filter(key=>key==='minimaxApiKey'?form[key]!=='':NUMBERS.includes(key)?form[key]===''||Number(form[key])!==Number(settings?.[key]):form[key]!==String(settings?.[key]??''))
  const connected=phase==='connected',editable=connected&&!!selectedClientId,dirty=dirtyKeys.length>0
  async function save(event:any) {
    event.preventDefault();if(!active.current||!editable||!dirty||saving)return
    if(!event.currentTarget.reportValidity())return
    const generation=epoch.current,submitted={...form},patch:Record<string,unknown>={}
    for(const key of dirtyKeys)patch[key]=NUMBERS.includes(key)?Number(form[key]):form[key]
    for(const [key,min,max,label] of [['ttsSpeed',.5,2,'语速'],['ttsVol',0,10,'音量'],['ttsPitch',-12,12,'音调'],['maxTurnSeconds',15,600,'单轮最长等待']] as const) {
      if(key in patch && (form[key]==='' || !Number.isFinite(patch[key]) || Number(patch[key])<min || Number(patch[key])>max)) {setTab('voice');setNotice({tone:'error',text:label+'应在 '+min+' 到 '+max+' 之间。'});return}
    }
    for(const key of ['assistantName','assistantRole'])if(key in patch && !String(patch[key]).trim()){setTab('persona');setNotice({tone:'error',text:key==='assistantName'?'请填写助手名称。':'请填写助手角色。'});return}
    setSaving(true);setNotice(null)
    try {
      const result=await request(active.current,'/clients/'+selectedClientId+'/settings','PUT',patch)
      if(!current(generation))return
      if(!result.ok)throw new Error(result.message??'保存失败')
      ++dataVersion.current
      const rejected:string[]=result.rejected??[]
      setSettings(result.settings);setForm(previous=>Object.fromEntries(Object.entries(previous).filter(([key,v])=>rejected.includes(key)||submitted[key]!==v)))
      setSavedAt(new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}))
      setNotice(rejected.length?{tone:'error',text:`部分设置未保存：${rejected.join('、')}`}:{tone:'success',text:'此客户端设置已保存，下一轮使用新配置。'})
    }catch(e){if(current(generation))setNotice({tone:'error',text:e instanceof Error?e.message:String(e)})}
    finally{if(current(generation))setSaving(false)}
  }
  async function runTest(kind:TestKind) {
    if(!active.current||!editable||testing.current.has(kind))return
    testing.current.add(kind)
    const generation=epoch.current
    setTests(previous=>({...previous,[kind]:{busy:true}}))
    try {const result=await request(active.current,`/clients/${selectedClientId}/test/${kind}`,'POST');if(current(generation))setTests(previous=>({...previous,[kind]:{busy:false,result}}))}
    catch(e){if(current(generation))setTests(previous=>({...previous,[kind]:{busy:false,result:{ok:false,message:e instanceof Error?e.message:String(e)}}}))}
    finally{if(current(generation))testing.current.delete(kind)}
  }
  async function deviceAction(kind:'issue'|'revoke'|'rotate',id='') {
    if(!active.current||!connected||deviceBusy)return
    const generation=epoch.current;setDeviceBusy(kind==='revoke'?id:kind);setNotice(null)
    try {
      const result=await request(active.current,kind==='issue'?'/devices':kind==='rotate'?'/token':`/devices/${encodeURIComponent(id)}`,kind==='revoke'?'DELETE':'POST',kind==='issue'?{deviceId:id,label:clientLabel||id}:undefined)
      if(!current(generation))return
      if(!result.ok)throw new Error(result.message??result.error??'操作失败')
      ++dataVersion.current
      if(kind==='issue'){setIssued({deviceId:result.deviceId,token:result.token});setDeviceId('');setClientLabel('');setServerSettings((previous:any)=>({...previous,devices:[...new Set([...(previous?.devices??[]),result.deviceId])]}))}
      if(kind==='revoke'){setIssued(previous=>previous?.deviceId===id?null:previous);setServerSettings((previous:any)=>({...previous,devices:(previous?.devices??[]).filter((device:string)=>device!==id)}))}
      if(kind==='rotate')setServerSettings((previous:any)=>({...previous,token:result.token}))
      setNotice({tone:'success',text:kind==='issue'?`已为 ${id} 签发设备令牌。`:kind==='rotate'?'兼容客户端令牌已更换，该客户端需重新配置。':`已撤销 ${id} 的接入令牌。`})
      await refresh(true)
    }catch(e){if(current(generation))setNotice({tone:'error',text:e instanceof Error?e.message:String(e)})}
    finally{if(current(generation))setDeviceBusy('')}
  }
  async function copy(text:string,label:string) {
    try {
      if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(text)
      else {const input=document.createElement('textarea'),focused=document.activeElement as HTMLElement|null;input.value=text;input.style.cssText='position:fixed;left:-9999px;opacity:0';document.body.append(input);input.select();let ok=false;try{ok=document.execCommand('copy')}finally{input.remove();focused?.focus()}if(!ok)throw new Error('复制不可用')}
      setCopied(label+'已复制');clearTimeout(copyTimer.current);copyTimer.current=setTimeout(()=>setCopied(''),2500)
    }catch{setNotice({tone:'error',text:'无法自动复制，请显示内容后手动复制。'})}
  }
  const s=settings??{},clients:any[]=status?.clients??[],devices:string[]=profiles.map(p=>p.deviceId)
  const ttsModel=value('ttsModel','speech-2.8-turbo'),ttsVoice=value('ttsVoice','female-shaonv')
  const modelOptions=TTS_MODELS.includes(ttsModel)?TTS_MODELS:[ttsModel,...TTS_MODELS]
  const knownVoices=new Set(VOICE_GROUPS.flatMap(group=>group.voices.map(([id])=>id)))
  const preset=value('agentPreset'),presets:any[]=status?.presets??[],defaultPreset=presets.find(p=>p.isDefault)
  const selectedPresetMissing=preset&&!presets.some(p=>p.id===preset)
  const phaseLabel=phase==='connected'?(managementMode==='host'?'已同步':'已认证'):phase==='error'&&connectionError.includes('登录已失效')?'需重新登录':({idle:'待认证',connecting:'加载配置中',connected:'已同步',error:'同步失败'} as const)[phase]
  let serviceUrl=session?.mode==='external'?session.baseUrl:endpoint
  if(managementMode==='host'&&status?.endpoint)try{const url=new URL(status.endpoint);url.protocol=url.protocol==='wss:'?'https:':'http:';url.hostname=location.hostname;url.pathname='';url.search='';url.hash='';serviceUrl=url.toString().replace(/\/+$/,'')}catch{/* use the configured fallback */}
  const websocket=serviceUrl.replace(/^http/,'ws').replace(/\/+$/,'')+'/voice'
  const testStatus=(kind:TestKind)=>tests[kind]?.busy?'检查中':tests[kind]?.result?.ok===true?'检查通过':tests[kind]?.result?.ok===false?'检查失败':'尚未检查'
  const diagnosticBusy=Object.values(tests).some(entry=>entry?.busy)
  function tabKey(event:any) {
    const tabs:Tab[]=['voice','persona','memory','devices','diagnostics'],index=tabs.indexOf(tab)
    const next=event.key==='ArrowRight'?tabs[(index+1)%tabs.length]:event.key==='ArrowLeft'?tabs[(index+tabs.length-1)%tabs.length]:event.key==='Home'?tabs[0]:event.key==='End'?tabs[tabs.length-1]:undefined
    if(next){event.preventDefault();setTab(next);document.getElementById(`ys-tab-${next}`)?.focus()}
  }

  const saveBar = <footer className="ys-footer"><span className="ys-footer-copy" role="status"><Icon name={dirty?'info':'check'} size={13}/>{!connected?'正在等待管理配置同步':!selectedClientId?'请先创建或选择一个客户端':dirty?`${dirtyKeys.length} 项更改尚未保存`:savedAt?`已保存 · ${savedAt}`:'所有设置已同步'}</span><div className="ys-footer-actions"><button className="ys-btn ys-btn-quiet" type="button" disabled={!dirty||saving} onClick={()=>{setForm({});setNotice(null)}}>撤销更改</button><button className="ys-btn ys-btn-primary" type="submit" disabled={!editable||!dirty||saving}><Icon name={saving?'refresh':'check'} size={14} spin={saving}/>{saving?'保存中…':'保存设置'}</button></div></footer>

  return <div className="ys-settings" role="region" aria-label="语声语音设置" tabIndex={0}><style>{css}</style><div className="ys-wrap">
    <header className="ys-header"><div className="ys-title"><span className="ys-brand"><Icon name="mic" size={25}/></span><div><h1>语声语音</h1><p className="ys-subtitle">管理声音、对话与设备连接</p></div></div><div className="ys-header-actions"><button type="button" className="ys-btn ys-btn-icon" aria-label="刷新状态" title="刷新状态" disabled={!session||refreshing||phase==='connecting'} onClick={()=>void refresh()}><Icon name="refresh" spin={refreshing}/></button><a className="ys-btn" href={serviceUrl.replace(/\/+$/,'')+'/demo'} target="_blank" rel="noopener noreferrer" title="打开形象与智能 UI 客户端"><span>打开客户端</span><Icon name="arrow" size={14}/></a></div></header>

    <div className="ys-overview" aria-label="运行概览"><div className="ys-stat"><div className="ys-stat-label"><Icon name="plug" size={13}/>管理状态</div><div className="ys-stat-value"><Badge tone={connected?'success':phase==='error'?'error':undefined}>{phaseLabel}</Badge></div><p className="ys-stat-detail">{connected?`语音服务已运行 ${Math.floor((status?.uptimeSec??0)/60)} 分钟`:managementMode==='host'?'自动复用 dsh 登录状态':'验证外部服务的管理令牌'}</p></div><div className="ys-stat"><div className="ys-stat-label"><Icon name="sparkles" size={13}/>当前客户端模型</div><div className="ys-stat-value" title={settings?.llmModel}>{connected?(selectedClientId?settings?.llmModel||'尚未配置':'请选择客户端'):'等待配置加载'}</div><p className="ys-stat-detail">{selectedClientId?settings?.llmProvider||'为此客户端选择模型':'每个客户端独立保存模型'}</p></div><div className="ys-stat"><div className="ys-stat-label"><Icon name="device" size={13}/>在线设备</div><div className="ys-stat-value">{connected?clients.length:'—'} <span className="ys-label-meta">台</span></div><p className="ys-stat-detail">{connected?`${devices.length} 台设备已注册`:'配置同步后显示在线数量'}</p></div></div>

    <section className="ys-connection" aria-label="管理连接" data-collapsed={!connectionOpen}>
      <div className="ys-connection-top"><span className="ys-connection-icon"><Icon name="shield" size={18}/></span><div className="ys-connection-copy"><strong>{managementMode==='host'?'使用 dsh 登录状态':'外部服务管理'}</strong><p>{managementMode==='host'?'配置自动同步，无需单独填写管理令牌。':session?.mode==='external'?session.baseUrl:'填写目标服务器的管理凭据。'}</p></div>{managementMode==='external'&&<button type="button" className="ys-btn ys-btn-quiet" disabled={saving||!!deviceBusy||phase==='connecting'} onClick={()=>void connectHost()}>使用当前 dsh</button>}<button type="button" className="ys-btn ys-btn-quiet" aria-expanded={connectionOpen} aria-controls="ys-connection-fields" onClick={()=>setConnectionOpen(!connectionOpen)}>{connectionOpen?'收起':managementMode==='host'?'外部服务器':'连接设置'}<Icon name="chevron" size={12}/></button></div>
      {connectionOpen&&<div id="ys-connection-fields" className="ys-connection-body"><p className="ys-field-help" style={{marginTop:0,marginBottom:14}}>仅连接其他语音服务器时需要以下配置。当前 dsh 的设置自动使用登录状态。</p><form className="ys-connect-grid" onSubmit={connect}><label className="ys-field"><span className="ys-label">外部服务地址</span><input className="ys-input ys-mono" type="url" required value={endpoint} placeholder="http://服务器地址:8090" onChange={e=>setEndpoint(e.target.value)} disabled={phase==='connecting'}/></label><SecretField id="ys-admin-token" label="外部服务管理令牌" value={adminToken} onChange={setAdminToken} placeholder="填写目标服务器的 adminToken" disabled={phase==='connecting'} maxLength={512}/><button className="ys-btn ys-btn-primary" disabled={phase==='connecting'||saving||!!deviceBusy} type="submit"><Icon name={phase==='connecting'?'refresh':'plug'} spin={phase==='connecting'}/>{phase==='connecting'?'认证中…':'连接外部服务'}</button></form><details className="ys-help"><summary><Icon name="chevron" size={10}/>在哪里找到外部服务的管理令牌？</summary><p>在目标服务器的 <code className="ys-code">settings.json</code> 中读取 <code className="ys-code">adminToken</code>。它用于设置管理，与客户端使用的设备令牌不同。</p></details></div>}
    </section>

    {connectionError&&<div className="ys-note" data-tone="error" role="alert"><Icon name="info"/><div className="ys-note-content">{connectionError}</div><button type="button" className="ys-btn ys-btn-quiet" onClick={()=>managementMode==='host'?void refresh():setConnectionOpen(true)}>{managementMode==='host'?'重试加载':'检查认证'}</button></div>}
    {notice&&<div className="ys-note" data-tone={notice.tone} role={notice.tone==='error'?'alert':'status'}><Icon name={notice.tone==='success'?'check':'info'}/><div className="ys-note-content">{notice.text}</div><button type="button" className="ys-btn ys-btn-icon ys-btn-quiet" aria-label="关闭操作提示" onClick={()=>setNotice(null)}><Icon name="close" size={13}/></button></div>}
    {copied&&<div className="ys-note" role="status"><Icon name="check"/>{copied}</div>}

    <section className="ys-client-selection" aria-label="当前客户端">
      <label className="ys-field"><span className="ys-label">当前客户端</span><select className="ys-select" aria-label="选择要配置的客户端" value={selectedClientId} disabled={!connected||saving||!!deviceBusy||dirty||memoryDirty||diagnosticBusy} onChange={e=>{if(active.current)onSelectClient(e.target.value,active.current)}}>{!profiles.length&&<option value="">还没有客户端</option>}{profiles.map(p=><option key={p.deviceId} value={p.deviceId}>{p.label||p.deviceId} · {p.deviceId}{clients.some(c=>c.deviceId===p.deviceId)?' · 在线':' · 离线'}</option>)}</select></label>
      <div className="ys-client-scope"><strong>{selectedClientId?'正在配置：'+(profiles.find(p=>p.deviceId===selectedClientId)?.label||selectedClientId):'先创建一个独立客户端'}</strong><p>{dirty||memoryDirty?'请先保存或撤销当前修改，再切换客户端。':'声音、人设、模型、长期记忆和对话上下文仅属于所选客户端；离线时也可配置。'}</p></div>
      <button className="ys-btn" type="button" disabled={!connected||saving||!!deviceBusy} onClick={()=>setTab('devices')}>添加客户端</button>
    </section>

    <nav className="ys-tabs" role="tablist" aria-label="语音设置分类" onKeyDown={tabKey}>{([{id:'voice',label:'声音与对话',icon:'wave'},{id:'persona',label:'助手人设',icon:'sparkles'},{id:'memory',label:'记忆与会话',icon:'clock'},{id:'devices',label:'客户端管理',icon:'device'},{id:'diagnostics',label:'连接诊断',icon:'shield'}] as const).map(item=><button key={item.id} type="button" className="ys-tab" id={`ys-tab-${item.id}`} role="tab" aria-selected={tab===item.id} aria-controls={`ys-panel-${item.id}`} tabIndex={tab===item.id?0:-1} onClick={()=>setTab(item.id)}><Icon name={item.icon} size={14}/>{item.label}{item.id==='devices'&&devices.length>0&&<span className="ys-count">{devices.length}</span>}</button>)}</nav>

    {tab==='voice'&&<div id="ys-panel-voice" role="tabpanel" aria-labelledby="ys-tab-voice"><form onSubmit={save}><fieldset disabled={!editable||saving}><div className="ys-voice-grid">
      <Card icon="wave" title="声音设置" description="选择识别与合成模型，调整助手的声音。" action={<button className="ys-btn ys-btn-quiet" type="button" onClick={()=>void runTest('tts')} disabled={!editable||tests.tts?.busy}><Icon name={tests.tts?.busy?'refresh':'volume'} size={14} spin={tests.tts?.busy}/>{tests.tts?.busy?'检查中':'检查合成'}</button>}>
        <div className="ys-grid"><label className="ys-field"><span className="ys-label">识别模型 <span className="ys-label-meta">ASR</span></span><input className="ys-input" value={value('asrModel','asr-1.0')} onChange={e=>setField('asrModel',e.target.value)} maxLength={64} placeholder="asr-1.0"/></label><label className="ys-field"><span className="ys-label">合成模型 <span className="ys-label-meta">TTS</span></span><select className="ys-select" value={ttsModel} onChange={e=>setField('ttsModel',e.target.value)}>{modelOptions.map(model=><option key={model} value={model}>{/^speech-/.test(model)?model.replace('speech-','Speech ').replace('-turbo',' · Turbo').replace('-hd',' · HD'):model||'使用默认模型'}</option>)}</select></label></div>
        <div style={{marginTop:20}}><div className="ys-row ys-between" style={{marginBottom:7}}><label className="ys-label" htmlFor="ys-voice" style={{margin:0}}>音色</label><button type="button" className="ys-btn ys-btn-quiet" style={{minHeight:0,padding:'0 2px',fontSize:11}} onClick={()=>setCustomVoice(!customVoice)}>{customVoice?'收起自定义音色':'使用自定义音色'}</button></div><select id="ys-voice" className="ys-select" value={ttsVoice} onChange={e=>setField('ttsVoice',e.target.value)}>{!knownVoices.has(ttsVoice)&&<option value={ttsVoice}>{ttsVoice||'默认音色'} · 自定义</option>}{VOICE_GROUPS.map(group=><optgroup key={group.label} label={group.label}>{group.voices.map(([id,name])=><option key={id} value={id}>{name}</option>)}</optgroup>)}</select>{customVoice&&<label className="ys-field ys-custom"><span className="ys-label">自定义音色 ID</span><input className="ys-input ys-mono" value={ttsVoice} maxLength={128} placeholder="填写自定义或复刻音色 ID" onChange={e=>setField('ttsVoice',e.target.value)}/></label>}<p className="ys-field-help">{ttsVoice} · Turbo 更适合即时语音，HD 侧重合成质量。</p></div>
        <div className="ys-separator"/>
        <div className="ys-sliders">{([{key:'ttsSpeed',label:'语速',min:.5,max:2,step:.05,default:'1',left:'更慢',right:'更快'},{key:'ttsVol',label:'音量',min:0,max:10,step:.1,default:'1',left:'更轻',right:'更响'},{key:'ttsPitch',label:'音调',min:-12,max:12,step:1,default:'0',left:'低沉',right:'明亮'}] as const).map(control=><div key={control.key}><div className="ys-slider-top"><label htmlFor={`ys-range-${control.key}`}>{control.label}</label><input className="ys-number" type="number" required min={control.min} max={control.max} step={control.step} aria-label={control.label+'数值'} value={value(control.key,control.default)} onChange={e=>setField(control.key,e.target.value)}/></div><input id={`ys-range-${control.key}`} type="range" min={control.min} max={control.max} step={control.step} value={value(control.key,control.default)||control.default} onChange={e=>setField(control.key,e.target.value)}/><div className="ys-slider-captions"><span>{control.left}</span><span>{control.right}</span></div></div>)}</div>
        <div className="ys-separator"/>
        <SecretField id="ys-minimax-key" label="MiniMax API Key" value={form.minimaxApiKey??''} onChange={v=>setField('minimaxApiKey',v)} placeholder={s.hasMinimaxApiKey?'API Key 已配置，留空保持不变':'填写 ASR / TTS 共用的 API Key'} help={<span>来自 api.minimax.cn 的接口密钥。{s.hasMinimaxApiKey&&<span className="ys-inline-status" style={{marginLeft:5}}><Icon name="check" size={12}/>已配置</span>}</span>}/>
        {tests.tts&&<div className="ys-field-help" role="status"><span className="ys-inline-status" data-tone={tests.tts.result?.ok===false?'error':undefined}><Icon name={tests.tts.busy?'refresh':tests.tts.result?.ok?'check':'info'} spin={tests.tts.busy} size={12}/>{testStatus('tts')}{tests.tts.result?.durationMs!==undefined?` · ${tests.tts.result.durationMs}ms`:''}</span>{tests.tts.result?.ok===false&&<span> · {tests.tts.result.message??tests.tts.result.code}</span>}</div>}
      </Card>

      <Card icon="sparkles" title="对话设置" description="为当前客户端选择模型、工具模式和对话规则。"><div className="ys-grid" style={{marginBottom:20}}><label className="ys-field"><span className="ys-label">对话提供方</span><input className="ys-input" value={value('llmProvider')} maxLength={128} placeholder="例如 minimax-cn" onChange={e=>setField('llmProvider',e.target.value)}/></label><label className="ys-field"><span className="ys-label">对话模型</span><input className="ys-input" value={value('llmModel')} maxLength={128} placeholder="填写此提供方的模型 ID" onChange={e=>setField('llmModel',e.target.value)}/></label></div><p className="ys-field-help" style={{marginBottom:18}}>此客户端独立使用这组模型选择。提供方的账号由 dsh 管理。</p><div className="ys-grid"><label className="ys-field"><span className="ys-label">会话模式</span><select className="ys-select" value={preset} onChange={e=>setField('agentPreset',e.target.value)}><option value="">跟随默认{defaultPreset?` · ${defaultPreset.name??defaultPreset.id}`:''}</option>{selectedPresetMissing&&<option value={preset}>{preset===VOICE_PRESET_ID?'语声助手 · 推荐':preset+' · 当前模式'}</option>}{presets.map(p=><option key={p.id} value={p.id} disabled={p.broken} title={p.problem}>{p.id===VOICE_PRESET_ID?'语声助手':p.name??p.id}{p.id===VOICE_PRESET_ID?' · 推荐':''}{p.isDefault?' · 默认':''}{p.broken?' · 不可用':''}</option>)}</select><p className="ys-field-help">切换模式后使用对应上下文，切回可继续原对话。</p></label><label className="ys-field"><span className="ys-label">单轮最长等待 <span className="ys-label-meta"><Icon name="clock" size={12}/></span></span><div className="ys-control ys-timeout"><input className="ys-input" type="number" required min={15} max={600} step={1} value={value('maxTurnSeconds','180')} onChange={e=>setField('maxTurnSeconds',e.target.value)}/><span className="ys-unit">秒</span></div><p className="ys-field-help">覆盖识别、工具执行、合成与音频发送。</p></label></div><div style={{marginTop:21}}><label className="ys-label" htmlFor="ys-prompt">补充对话要求 <span className="ys-label-meta">{value('promptPrefix').length} / 4000</span></label><textarea id="ys-prompt" className="ys-textarea" maxLength={4000} rows={4} value={value('promptPrefix')} placeholder="例如：用简洁、自然的中文回答，适合语音交互。" onChange={e=>setField('promptPrefix',e.target.value)}/><p className="ys-field-help">作为每轮对话的补充要求；名称与性格请在「助手人设」中设置。</p></div></Card>
    </div></fieldset>{saveBar}</form></div>}

    {tab==='persona'&&<div id="ys-panel-persona" role="tabpanel" aria-labelledby="ys-tab-persona"><form onSubmit={save}><fieldset disabled={!connected||saving}><PersonaSettings value={value} onChange={setField} preset={presets.find(p=>p.id===VOICE_PRESET_ID)}/></fieldset>{saveBar}</form></div>}

    {<div hidden={tab!=='memory'} id="ys-panel-memory" role="tabpanel" aria-labelledby="ys-tab-memory">{selectedClientId&&session&&clientView?<ClientMemoryPanel key={selectedClientId} clientId={selectedClientId} connection={session} snapshot={clientView.memory} conversations={clientView.conversations} canRestore={clientView.canRestore} disabled={!editable||saving||dirty||!!deviceBusy} onDirty={setMemoryDirty} onRefresh={()=>refresh()}/>:<div className="ys-empty">请先创建或选择客户端。</div>}</div>}

    {tab==='devices'&&<div id="ys-panel-devices" role="tabpanel" aria-labelledby="ys-tab-devices" className="ys-stack"><Card icon="device" title="独立客户端" description="创建独立配置和记忆档案，为每个客户端签发绑定 ID 的令牌。" action={<Badge>{devices.length} 台</Badge>}><form className="ys-device-form" onSubmit={e=>{e.preventDefault();void deviceAction('issue',deviceId)}}><label className="ys-field"><span className="ys-label">客户端 ID</span><input id="ys-client-id" className="ys-input ys-mono" value={deviceId} onChange={e=>setDeviceId(e.target.value)} maxLength={48} required pattern="[a-zA-Z0-9_-]{1,48}" placeholder="例如 speaker-living-room" disabled={!connected||!!deviceBusy}/></label><label className="ys-field"><span className="ys-label">客户端名称 <span className="ys-label-meta">选填</span></span><input className="ys-input" value={clientLabel} onChange={e=>setClientLabel(e.target.value)} maxLength={64} placeholder="例如 客厅音箱" disabled={!connected||!!deviceBusy}/></label><button className="ys-btn ys-btn-primary" type="submit" disabled={!connected||!!deviceBusy}><Icon name={deviceBusy==='issue'?'refresh':'shield'} spin={deviceBusy==='issue'} size={14}/>{deviceBusy==='issue'?'签发中…':devices.includes(deviceId)?'更新客户端令牌':'创建客户端并签发令牌'}</button></form><p className="ys-field-help">ID 支持字母、数字、下划线和连字符，最长 48 位。不同客户端必须使用不同 ID 和令牌；相同 ID 的重连会恢复原配置与记忆。</p>
      {issued&&<div className="ys-token" role="status"><SecretField key={issued.token} id="ys-issued-token" label={`${issued.deviceId} 的新令牌`} value={issued.token} readOnly onCopy={()=>void copy(issued.token,'设备令牌')} help="将此令牌填写到对应设备的连接配置。关闭面板后可重新签发。"/></div>}
      {devices.length>0?<div className="ys-devices">{devices.map(id=>{const client=clients.find(c=>c.deviceId===id);return <div className="ys-device" key={id}><span className="ys-device-symbol"><Icon name="device" size={17}/></span><div className="ys-device-info"><div className="ys-device-name">{profiles.find(p=>p.deviceId===id)?.label||id}</div><p className="ys-device-detail">{id} · {profiles.find(p=>p.deviceId===id)?.credentialConfigured?'独立接入身份':'接入已停用'}</p></div><button type="button" className="ys-btn ys-btn-quiet" disabled={saving||dirty||memoryDirty||!!deviceBusy} onClick={()=>{if(active.current)onSelectClient(id,active.current)}}>配置</button><Badge tone={client?'success':undefined}>{client?client.state==='listening'?'正在倾听':client.state==='busy'?'处理中':'在线':'未连接'}</Badge><button type="button" className="ys-btn ys-btn-icon ys-btn-quiet ys-btn-danger" aria-label={`撤销 ${id} 的令牌`} title="撤销设备令牌" disabled={!connected||!!deviceBusy} onClick={()=>void deviceAction('revoke',id)}><Icon name={deviceBusy===id?'refresh':'trash'} spin={deviceBusy===id} size={14}/></button></div>})}</div>:<div className="ys-empty"><Icon name="device" size={23}/><div>还没有创建客户端</div><p>填写客户端 ID，创建第一套独立配置与记忆。</p></div>}</Card>
      <details className="ys-advanced"><summary><Icon name="shield" size={16}/>兼容客户端接入<Icon name="chevron" size={12}/></summary><div className="ys-advanced-body"><p>旧接入令牌现在只绑定一个兼容客户端，不能用于其他客户端。新客户端请在上方签发独立令牌。更换后该兼容客户端需重新配置。</p><SecretField key={serverSettings?.token??'empty'} id="ys-shared-token" label="兼容客户端令牌" value={serverSettings?.token??''} readOnly disabled={!connected} placeholder="兼容接入未启用" onCopy={()=>void copy(serverSettings?.token,'兼容令牌')}/><div className="ys-row ys-between" style={{marginTop:13}}><span className="ys-field-help" style={{margin:0}}>与设置管理使用的 adminToken 相互独立。</span><button type="button" className="ys-btn" disabled={!connected||!!deviceBusy} onClick={()=>void deviceAction('rotate')}><Icon name="refresh" size={13} spin={deviceBusy==='rotate'}/>{deviceBusy==='rotate'?'更换中…':'更换兼容令牌'}</button></div></div></details>
      {clients.some(c=>c.deviceId&&!devices.includes(c.deviceId))&&<Card icon="plug" title="其他在线连接" description="客户端正在初始化独立档案。">{clients.filter(c=>!devices.includes(c.deviceId)).map((c,i)=><div className="ys-device" key={c.connectionId??i}><span className="ys-device-symbol"><Icon name="device" size={17}/></span><div className="ys-device-info"><div className="ys-device-name">{c.deviceName||c.deviceId||'等待握手'}</div><p className="ys-device-detail">{c.deviceId||'连接初始化中'}</p></div><Badge tone="success">在线</Badge></div>)}</Card>}
    </div>}

    {tab==='diagnostics'&&<div id="ys-panel-diagnostics" role="tabpanel" aria-labelledby="ys-tab-diagnostics"><div className="ys-diag-intro"><div><h2>检查语音链路</h2><p>逐项验证识别、对话和合成服务是否可用。</p></div><button type="button" className="ys-btn" disabled={!editable||diagnosticBusy} onClick={()=>void Promise.all(TESTS.map(t=>runTest(t.id)))}><Icon name="refresh" size={14} spin={diagnosticBusy}/>{diagnosticBusy?'检查中…':'运行全部检查'}</button></div><div className="ys-diagnostics">{TESTS.map(test=>{const entry=tests[test.id],result=entry?.result;return <section className="ys-card ys-diagnostic" key={test.id}><span className="ys-diagnostic-symbol"><Icon name={test.icon} size={18}/></span><h3>{test.name}</h3><p className="ys-diagnostic-description">{test.description}</p><button type="button" className="ys-btn" disabled={!editable||entry?.busy} onClick={()=>void runTest(test.id)}>{entry?.busy?<><Icon name="refresh" size={13} spin/>检查中…</>:test.button}</button><div className="ys-diagnostic-result" role="status"><i className="ys-dot" style={{background:result?.ok===true?'var(--ys-green)':result?.ok===false?'var(--ys-red)':undefined}}/>{testStatus(test.id)}{result?.durationMs!==undefined&&<span className="ys-label-meta">· {result.durationMs}ms</span>}</div>{result&&<p className="ys-diagnostic-message">{result.ok?'服务调用正常':String(result.message??result.error??result.code??'请检查凭据与服务连接。')}</p>}</section>})}</div><div className="ys-card" style={{marginTop:20,padding:20}}><div className="ys-row ys-between"><div><div className="ys-label">设备接入端点</div><code className="ys-mono" style={{overflowWrap:'anywhere'}}>{websocket}</code></div><button type="button" className="ys-btn ys-btn-icon" aria-label="复制设备接入端点" title="复制设备接入端点" onClick={()=>void copy(websocket,'接入端点')}><Icon name="copy" size={14}/></button></div><p className="ys-field-help">支持协议 v1 / v2。音频输入 16kHz，输出 24kHz，PCM 单声道。</p></div><p className="ys-field-help" style={{marginTop:15}}>检查使用已保存的配置。测试对话会调用当前默认模型。</p></div>}
    <p className="ys-bottom-note">设置保存在语音服务器，编辑后需点击保存。当前 dsh 自动使用登录状态；外部管理令牌仅保留在当前面板内存中。</p>
  </div></div>
}
