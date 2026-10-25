import { useEffect, useRef, useState } from 'react'
import { request, type Connection } from './management-client.js'

interface Memory {revision:number;updatedAt:number;items:Array<{id:string;text:string}>}
export function ClientMemoryPanel({clientId,connection,snapshot,conversations,canRestore,disabled,onDirty,onRefresh}:{clientId:string;connection:Connection;snapshot:Memory;conversations:any[];canRestore:boolean;disabled:boolean;onDirty:(value:boolean)=>void;onRefresh:()=>Promise<void>}) {
  const [base,setBase]=useState(snapshot),[draft,setDraft]=useState<string|undefined>(),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[confirm,setConfirm]=useState(false)
  const alive=useRef(true)
  useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[])
  const saved=base.items.map(i=>i.text).join('\n'),text=draft??saved,dirty=text!==saved
  useEffect(()=>{onDirty(dirty)},[dirty])
  useEffect(()=>{if(!dirty)setBase(snapshot)},[snapshot,dirty])
  async function save() {
    if(disabled||busy||!dirty)return
    setBusy(true);setNotice('')
    try{const result=await request(connection,`/clients/${clientId}/memory`,'PUT',{text,revision:base.revision});if(!alive.current)return;setBase(result.memory);setDraft(undefined);setNotice('此客户端的长期记忆已保存。');await onRefresh()}
    catch(error){if(alive.current)setNotice(error instanceof Error?error.message:String(error))}
    finally{if(alive.current)setBusy(false)}
  }
  async function context(operation:'reset'|'restore') {
    if(disabled||busy||dirty)return
    setBusy(true);setNotice('')
    try{await request(connection,`/clients/${clientId}/context/${operation}`,'POST');if(!alive.current)return;setConfirm(false);setNotice(operation==='reset'?'此客户端已开始新的对话上下文，长期记忆已保留。':'此客户端已恢复上次对话上下文。');await onRefresh()}
    catch(error){if(alive.current)setNotice(error instanceof Error?error.message:String(error))}
    finally{if(alive.current)setBusy(false)}
  }
  return <div className="ys-stack">
    <section className="ys-card"><div className="ys-card-header"><div className="ys-card-heading"><h2>此客户端的长期记忆</h2><p>只为当前客户端保存偏好和事实，跨对话、断线和重启继续使用。</p></div><span className="ys-label-meta">{base.items.length} / 32 条</span></div><div className="ys-card-body">
      <label className="ys-label" htmlFor="ys-client-memory">记忆内容 <span className="ys-label-meta">每行一条，最多 8000 字</span></label><textarea id="ys-client-memory" className="ys-textarea" rows={8} maxLength={8032} value={text} disabled={disabled||busy} onChange={e=>setDraft(e.target.value)} placeholder="例如：喜欢简洁的回答。\n也可以在对话中告诉助手“请记住……”。"/>
      <p className="ys-field-help">助手可以通过专用记忆工具保存或忘记当前客户端的事实。其他客户端读不到这份记忆。</p>
      {dirty&&snapshot.revision!==base.revision&&<p className="ys-field-help" role="alert">服务端已有新的记忆。请先合并内容，或撤销本地修改后加载最新版本。</p>}
      <div className="ys-row ys-between" style={{marginTop:18}}><span className="ys-field-help" role="status">{notice|| (dirty?'长期记忆有未保存的更改':'长期记忆已同步')}</span><div className="ys-row"><button className="ys-btn ys-btn-quiet" type="button" disabled={busy||!dirty} onClick={()=>{setDraft(undefined);setBase(snapshot);setNotice('')}}>撤销修改</button><button className="ys-btn ys-btn-primary" type="button" disabled={disabled||busy||!dirty} onClick={()=>void save()}>{busy?'处理中…':'保存记忆'}</button></div></div>
    </div></section>
    <section className="ys-card"><div className="ys-card-header"><div className="ys-card-heading"><h2>对话上下文</h2><p>当前客户端的聊天历史与会话模式独立保存。</p></div></div><div className="ys-card-body">
      {conversations.length?<div className="ys-devices" style={{marginTop:0}}>{conversations.slice(-12).reverse().map((c,i)=><div className="ys-device" key={i}><div className="ys-device-info"><div className="ys-device-name">{c.conversationId}</div><p className="ys-device-detail">{c.preset||'默认模式'} · {new Date(c.updatedAt).toLocaleString('zh-CN')}</p></div><span className="ys-badge">{c.archived?'已归档':'当前上下文'}</span></div>)}</div>:<p className="ys-field-help">此客户端尚未开始对话。首次交互后会自动保存上下文。</p>}
      <div className="ys-separator"/><p className="ys-field-help">重新开始只影响此客户端的对话上下文，长期记忆、人设和其他客户端均保留。原上下文会归档，可撤销上次重置。</p>
      <div className="ys-row" style={{marginTop:14,flexWrap:'wrap'}}>{confirm?<><span className="ys-field-help">确认重新开始此客户端的对话？</span><button className="ys-btn" type="button" disabled={disabled||busy||dirty} onClick={()=>void context('reset')}>确认重新开始</button><button className="ys-btn ys-btn-quiet" type="button" onClick={()=>setConfirm(false)}>取消</button></>:<button className="ys-btn" type="button" disabled={disabled||busy||dirty} onClick={()=>setConfirm(true)}>重新开始对话上下文</button>}{canRestore&&!confirm&&<button className="ys-btn ys-btn-quiet" type="button" disabled={disabled||busy||dirty} onClick={()=>void context('restore')}>撤销上次重置</button>}</div>
    </div></section>
  </div>
}
