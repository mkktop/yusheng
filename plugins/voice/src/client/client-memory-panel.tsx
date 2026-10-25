import { useEffect, useRef, useState } from 'react'
import { request, type Connection } from './management-client.js'
import type { ClientMemory, MemoryItem, MemoryRecall } from '../memory-store.js'

const KINDS:Record<string,string>={profile:'个人资料',preference:'偏好习惯',fact:'长期事实',event:'阶段事项'}
const ACTORS:Record<string,string>={user:'用户明确表达',assistant:'助手记忆工具',settings:'设置页',migration:'旧版迁移'}
const OPS:Record<string,string>={create:'新增',update:'更新',forget:'遗忘',clear:'清空'}
type Draft={id?:string;text:string;key:string;kind:string;importance:number;expiry:string;revision:number}
const time=(value:number)=>new Date(value).toLocaleString('zh-CN',{hour12:false})
export function ClientMemoryPanel({clientId,connection,snapshot,conversations,canRestore,policy='explicit',disabled,onDirty,onRefresh}:{clientId:string;connection:Connection;snapshot:ClientMemory;conversations:any[];canRestore:boolean;policy?:string;disabled:boolean;onDirty:(value:boolean)=>void;onRefresh:()=>Promise<void>}) {
  const [draft,setDraft]=useState<Draft|null>(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[confirm,setConfirm]=useState('')
  const [query,setQuery]=useState(''),[recall,setRecall]=useState<MemoryRecall|null>(null),[section,setSection]=useState('facts'),[shown,setShown]=useState(12),[mode,setMode]=useState(policy)
  const alive=useRef(true),latestRevision=useRef(snapshot.revision),previousPolicy=useRef(policy),locked=!!draft||busy||mode!==policy
  latestRevision.current=snapshot.revision
  useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[])
  useEffect(()=>{onDirty(locked)},[locked])
  useEffect(()=>{const previous=previousPolicy.current;setMode(current=>current===previous?policy:current);previousPolicy.current=policy},[policy])
  // Any mutation, including an agent write observed by polling, invalidates displayed search results.
  useEffect(()=>setRecall(null),[snapshot.revision,snapshot.barrier])
  async function operation(body:Record<string,unknown>,message:string) {
    if(disabled||busy)return
    setBusy(true);setNotice('')
    try{const result=await request(connection,`/clients/${clientId}/memory`,'POST',body);if(!alive.current)return;setDraft(null);setConfirm('');setNotice(message+(result.contextChanged?' 下一轮使用新上下文，其余事实保留。':''));await onRefresh()}
    catch(error){if(alive.current)setNotice(error instanceof Error?error.message:String(error))}
    finally{if(alive.current)setBusy(false)}
  }
  function edit(item?:MemoryItem) {setConfirm('');setNotice('');setDraft({id:item?.id,text:item?.text??'',key:item?.key??'',kind:item?.kind??'fact',importance:item?.importance??3,expiry:item?.expiresAt?'keep':'never',revision:snapshot.revision})}
  async function save(event:any) {
    event.preventDefault();if(!draft)return
    const expiresAt=draft.expiry==='keep'?undefined:draft.expiry==='never'?null:Date.now()+({day:86400000,week:604800000,month:2592000000}[draft.expiry]??0)
    await operation({operation:'upsert',revision:draft.revision,...(draft.id?{id:draft.id}:{}),text:draft.text,key:draft.key,kind:draft.kind,importance:draft.importance,...(expiresAt===undefined?{}:{expiresAt})},'此客户端的记忆已保存。')
  }
  async function search() {
    if(disabled||busy)return;setBusy(true);setNotice('')
    try{const result=await request(connection,`/clients/${clientId}/memory`,'POST',{operation:'search',query,limit:12});if(alive.current){if(result.recall.revision===latestRevision.current)setRecall(result.recall);else{setRecall(null);setNotice('记忆已更新，请重新检索。')}}}
    catch(error){if(alive.current)setNotice(error instanceof Error?error.message:String(error))}
    finally{if(alive.current)setBusy(false)}
  }
  async function savePolicy() {
    if(disabled||busy||mode===policy)return;setBusy(true)
    try{const result=await request(connection,`/clients/${clientId}/settings`,'PUT',{memoryPolicy:mode});if(result.rejected?.length)throw new Error('记忆记录方式未保存');if(alive.current){await onRefresh();setNotice('此客户端的记录方式已保存。')}}
    catch(error){if(alive.current)setNotice(error instanceof Error?error.message:String(error))}
    finally{if(alive.current)setBusy(false)}
  }
  async function context(operation:'reset'|'restore') {
    if(disabled||busy||draft)return;setBusy(true)
    try{await request(connection,`/clients/${clientId}/context/${operation}`,'POST');if(alive.current){setConfirm('');setNotice(operation==='reset'?'已开始新的对话，长期事实保留。':'已恢复上次对话。');await onRefresh()}}
    catch(error){if(alive.current)setNotice(error instanceof Error?error.message:String(error))}
    finally{if(alive.current)setBusy(false)}
  }
  const items=[...snapshot.items].sort((a,b)=>(b.updatedAt??b.createdAt)-(a.updatedAt??a.createdAt))
  const filtered=items.filter(i=>!query||i.text.toLowerCase().includes(query.toLowerCase())||i.key?.includes(query.toLowerCase()))
  return <div className="ys-stack">
    <section className="ys-card"><div className="ys-card-header"><div className="ys-card-heading"><h2>记忆与回忆</h2><p>独立保存此客户端的事实，按问题检索相关记忆与对话摘录。</p></div><span className="ys-label-meta">{items.length} / 256 条</span></div><div className="ys-card-body">
      <div className="ys-memory-policy"><label className="ys-field"><span className="ys-label">自动记录方式</span><select className="ys-select" value={mode} disabled={disabled||busy||!!draft} onChange={e=>setMode(e.target.value)}><option value="explicit">明确要求时记录事实</option><option value="adaptive">同时记录明确的常见偏好</option><option value="off">关闭新增记忆</option></select></label><button className="ys-btn" type="button" disabled={disabled||busy||mode===policy} onClick={()=>void savePolicy()}>保存记录方式</button>{mode!==policy&&<button className="ys-btn ys-btn-quiet" type="button" disabled={busy} onClick={()=>setMode(policy)}>撤销</button>}</div>
      <p className="ys-field-help">常见的直接表达由服务端记录，助手也可使用记忆工具更正事实。开启记录时保留最近 128 轮的简短对话摘录；关闭后停止新增事实和摘录，已有内容仍可检索或遗忘。</p>
      <div className="ys-memory-nav" role="group" aria-label="记忆视图">{[['facts','长期事实'],['recall','对话回忆'],['events','修改记录']].map(([id,title])=><button type="button" key={id} className={'ys-btn '+(section===id?'ys-btn-primary':'ys-btn-quiet')} aria-pressed={section===id} onClick={()=>setSection(id)}>{title}</button>)}</div>
      {notice&&<p className="ys-memory-notice" role="status">{notice}</p>}
      {section!=='events'&&<div className="ys-memory-search"><label className="ys-field"><span className="ys-label">{section==='facts'?'查找记忆':'想回忆什么'}</span><input className="ys-input" value={query} maxLength={4000} placeholder="例如：咖啡偏好、上次旅行计划" onChange={e=>{setQuery(e.target.value);setRecall(null)}} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();void search()}}}/></label><button className="ys-btn" type="button" disabled={disabled||busy} onClick={()=>void search()}>{busy?'处理中…':'检索相关内容'}</button>{section==='facts'&&<button className="ys-btn ys-btn-primary" type="button" disabled={disabled||busy||!!draft} onClick={()=>edit()}>新增记忆</button>}</div>}
      {section==='facts'&&<>
        {draft&&<form className="ys-memory-editor" onSubmit={save}><h3>{draft.id?'编辑记忆':'新增记忆'}</h3><label className="ys-field"><span className="ys-label">记忆内容</span><textarea className="ys-textarea" required maxLength={1000} rows={3} value={draft.text} disabled={busy} onChange={e=>setDraft({...draft,text:e.target.value})}/></label><div className="ys-grid"><label className="ys-field"><span className="ys-label">分类</span><select className="ys-select" value={draft.kind} disabled={busy} onChange={e=>setDraft({...draft,kind:e.target.value})}>{Object.entries(KINDS).map(([id,label])=><option value={id} key={id}>{label}</option>)}</select></label><label className="ys-field"><span className="ys-label">重要程度</span><select className="ys-select" value={draft.importance} disabled={busy} onChange={e=>setDraft({...draft,importance:Number(e.target.value)})}>{[1,2,3,4,5].map(n=><option value={n} key={n}>{n===1?'低':n===3?'普通':n===5?'高':n}</option>)}</select></label><label className="ys-field"><span className="ys-label">主题键 <span className="ys-label-meta">选填</span></span><input className="ys-input ys-mono" maxLength={96} pattern="[a-z0-9][a-z0-9._:\-]{0,95}" value={draft.key} placeholder="preference.drink.coffee" disabled={busy} onChange={e=>setDraft({...draft,key:e.target.value})}/></label><label className="ys-field"><span className="ys-label">保留时间</span><select className="ys-select" value={draft.expiry} disabled={busy} onChange={e=>setDraft({...draft,expiry:e.target.value})}>{draft.expiry==='keep'&&<option value="keep">保留现有到期时间</option>}<option value="never">长期保留</option><option value="day">一天</option><option value="week">一周</option><option value="month">一个月</option></select></label></div><p className="ys-field-help">同一主题键更新同一条事实。更正内容会从下一轮切换上下文，防止旧说法再次带入。</p>{draft.revision!==snapshot.revision&&<p role="alert" className="ys-field-help">服务端记忆已有更新；请保留需要的文字，取消编辑后重新打开最新记录。</p>}<div className="ys-row"><button className="ys-btn ys-btn-primary" disabled={disabled||busy} type="submit">保存记忆</button><button className="ys-btn ys-btn-quiet" disabled={busy} type="button" onClick={()=>setDraft(null)}>取消编辑</button></div></form>}
        {(recall?.items??filtered).slice(0,shown).map(item=><article className="ys-memory-item" key={item.id}><div className="ys-row ys-between"><div className="ys-row"><span className="ys-badge">{KINDS[item.kind]??'长期事实'}</span>{item.expiresAt&&<span className="ys-label-meta">{item.expiresAt<=Date.now()?'已到期':time(item.expiresAt)+' 到期'}</span>}</div><div className="ys-row"><button className="ys-btn ys-btn-quiet" type="button" aria-label={'编辑记忆 '+item.text} disabled={disabled||busy||!!draft} onClick={()=>edit(item)}>编辑</button><button className="ys-btn ys-btn-quiet ys-btn-danger" type="button" aria-label={'遗忘记忆 '+item.text} disabled={disabled||busy||!!draft} onClick={()=>setConfirm(item.id)}>遗忘</button></div></div><p className="ys-memory-text">{item.text}</p><p className="ys-field-help">{ACTORS[item.source?.actor]??'旧版迁移'} · {time(item.updatedAt??item.createdAt)}{item.key?' · '+item.key:''}{item.source?.conversationId?' · 对话 '+item.source.conversationId:''}</p>{confirm===item.id&&<div className="ys-memory-confirm"><p>遗忘此条事实并清除检索摘录；下一轮开始新上下文，其余事实保留。宿主原始聊天日志和备份仍保留。</p><div className="ys-row"><button className="ys-btn ys-btn-danger" type="button" disabled={busy} onClick={()=>void operation({operation:'forget',id:item.id,revision:snapshot.revision},'此条记忆已遗忘。')}>确认遗忘</button><button className="ys-btn ys-btn-quiet" type="button" disabled={busy} onClick={()=>setConfirm('')}>取消</button></div></div>}</article>)}
        {!filtered.length&&!recall?.items.length&&<p className="ys-field-help">{query?'没有匹配的事实，可尝试检索相关对话。':'尚未保存长期事实。可以手动新增，或对助手说“请记住……” 。'}</p>}
        {!recall&&filtered.length>shown&&<button className="ys-btn ys-btn-quiet" type="button" onClick={()=>setShown(shown+12)}>查看更多记忆</button>}
      </>}
      {section==='recall'&&<div className="ys-stack">{recall?<><p className="ys-field-help">找到 {recall.items.length} 条相关事实、{recall.episodes.length} 段对话摘录。摘录可能不完整，不能视为已确认的事实。</p>{recall.items.map(i=><article className="ys-memory-item" key={i.id}><span className="ys-badge">相关事实</span><p className="ys-memory-text">{i.text}</p></article>)}{recall.episodes.map(e=><article className="ys-memory-item" key={e.id}><p className="ys-field-help">{time(e.at)} · 对话 {e.conversationId}</p><p className="ys-memory-text">你：{e.user}</p><p className="ys-memory-text">助手：{e.assistant}</p></article>)}</>:<p className="ys-field-help">输入关键词，检索此客户端升级后保存的对话摘录。它们最多保留最近 128 轮，不能代替完整聊天记录。</p>}</div>}
      {section==='events'&&<div>{(snapshot.events??[]).slice(-24).reverse().map(event=><div className="ys-memory-item" key={event.id}><p>{OPS[event.operation]}记忆 · {ACTORS[event.actor]}</p><p className="ys-field-help">{time(event.at)} · 版本 {event.revision}{event.memoryId?' · '+event.memoryId.slice(0,8):''}</p></div>)}{!snapshot.events?.length&&<p className="ys-field-help">尚无修改记录。记录保留操作、来源和时间，不保留被删除或替换的事实原文。</p>}</div>}
      <details className="ys-help" style={{marginTop:20}}><summary>清空此客户端的记忆</summary><p className="ys-field-help">清空全部长期事实和检索摘录，下轮使用新上下文，其他客户端保留。宿主原始聊天日志与备份不会删除。</p>{confirm==='clear'?<div className="ys-row"><button type="button" className="ys-btn ys-btn-danger" disabled={disabled||busy||!!draft} onClick={()=>void operation({operation:'clear',revision:snapshot.revision},'此客户端的记忆已清空。')}>确认清空全部记忆</button><button type="button" className="ys-btn ys-btn-quiet" onClick={()=>setConfirm('')}>取消</button></div>:<button type="button" className="ys-btn ys-btn-danger" disabled={disabled||busy||!!draft} onClick={()=>setConfirm('clear')}>清空事实与回忆</button>}</details>
    </div></section>
    <section className="ys-card"><div className="ys-card-header"><div className="ys-card-heading"><h2>对话上下文</h2><p>此客户端的会话独立保存。重新开始会保留长期事实与可检索摘录。</p></div></div><div className="ys-card-body">
      {conversations.slice(-8).reverse().map((c,i)=><div className="ys-device" key={i}><div className="ys-device-info"><div className="ys-device-name">{c.conversationId}</div><p className="ys-device-detail">{c.preset||'默认模式'} · {time(c.updatedAt)}</p></div><span className="ys-badge">{c.archived?'已归档':'当前上下文'}</span></div>)}
      {!conversations.length&&<p className="ys-field-help">首次对话后会自动建立上下文。</p>}
      <div className="ys-row" style={{marginTop:16,flexWrap:'wrap'}}>{confirm==='context'?<><button className="ys-btn" type="button" disabled={disabled||busy||!!draft} onClick={()=>void context('reset')}>确认重新开始</button><button className="ys-btn ys-btn-quiet" type="button" onClick={()=>setConfirm('')}>取消</button></>:<button className="ys-btn" type="button" disabled={disabled||busy||!!draft} onClick={()=>setConfirm('context')}>重新开始对话上下文</button>}{canRestore&&<button className="ys-btn ys-btn-quiet" type="button" disabled={disabled||busy||!!draft} onClick={()=>void context('restore')}>撤销上次重置</button>}</div><p className="ys-field-help">更正或遗忘事实后，旧上下文不再恢复，避免旧内容重新进入对话。</p>
    </div></section>
  </div>
}
