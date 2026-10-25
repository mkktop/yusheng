import { DEFAULT_PERSONA, PERSONALITIES, REPLY_STYLES, PRESENTATION_STYLES, VOICE_PRESET_ID } from '../persona.js'

export function PersonaSettings({ value, onChange, preset }: { value: (key: string, fallback?: string) => string; onChange: (key: string, value: string) => void; preset?: { broken?: boolean; problem?: string } }) {
  const name = value('assistantName', DEFAULT_PERSONA.assistantName)
  const title = value('userTitle')
  const personality = PERSONALITIES.find(p => p.id === value('personality', DEFAULT_PERSONA.personality)) ?? PERSONALITIES[0]
  const reply = value('replyStyle', DEFAULT_PERSONA.replyStyle)
  const movement = value('presentationStyle', DEFAULT_PERSONA.presentationStyle)
  const notes = value('personalityNotes')
  return <div className="ys-persona-layout">
    <section className="ys-card"><div className="ys-card-header"><div className="ys-card-heading"><h2>定义你的助手</h2><p>从名字到交流方式，让每一次对话更合拍。</p></div></div><div className="ys-card-body">
      <div className="ys-grid">
        <label className="ys-field"><span className="ys-label">助手名称</span><input className="ys-input" required maxLength={32} value={name} placeholder="例如 语声、小语" onChange={e => onChange('assistantName', e.target.value)}/><p className="ys-field-help">助手在对话中使用的名字。</p></label>
        <label className="ys-field"><span className="ys-label">如何称呼你 <span className="ys-label-meta">选填</span></span><input className="ys-input" maxLength={32} value={title} placeholder="例如 小林、陈先生" onChange={e => onChange('userTitle', e.target.value)}/><p className="ys-field-help">留空时使用自然称呼。</p></label>
      </div>
      <label className="ys-field" style={{marginTop:20}}><span className="ys-label">助手角色 <span className="ys-label-meta">{value('assistantRole', DEFAULT_PERSONA.assistantRole).length} / 200</span></span><textarea className="ys-textarea ys-role" required rows={2} maxLength={200} value={value('assistantRole', DEFAULT_PERSONA.assistantRole)} placeholder="例如：陪我聊天、查询信息，帮助安排日常事务的伙伴。" onChange={e => onChange('assistantRole', e.target.value)}/></label>
      <div className="ys-separator"/>
      <div className="ys-label" id="ys-personality-label">性格模板</div>
      <div className="ys-personality-options" role="group" aria-labelledby="ys-personality-label">{PERSONALITIES.map(item => <button className="ys-personality-option" key={item.id} type="button" aria-pressed={personality.id === item.id} onClick={() => onChange('personality', item.id)}><span className="ys-personality-name"><i className="ys-personality-radio"/>{item.name}</span><span className="ys-personality-description">{item.description}</span></button>)}</div>
      <label className="ys-field" style={{marginTop:20}}><span className="ys-label">{personality.id === 'custom' ? '自定义性格描述' : '补充性格偏好'} <span className="ys-label-meta">{notes.length} / 2000</span></span><textarea className="ys-textarea" rows={3} maxLength={2000} value={notes} placeholder="例如：有一点幽默感，尊重我的节奏；工作时直接一些，闲聊时轻松一些。" onChange={e => onChange('personalityNotes', e.target.value)}/><p className="ys-field-help">可以补充语气、喜好和交流习惯；切换模板会保留这段描述。</p></label>
      <div className="ys-separator"/>
      <div className="ys-grid">
        <label className="ys-field"><span className="ys-label">回答长度</span><select className="ys-select" value={reply} onChange={e => onChange('replyStyle', e.target.value)}>{REPLY_STYLES.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><p className="ys-field-help">{REPLY_STYLES.find(item => item.id === reply)?.description}</p></label>
        <label className="ys-field"><span className="ys-label">表情动作风格</span><select className="ys-select" value={movement} onChange={e => onChange('presentationStyle', e.target.value)}>{PRESENTATION_STYLES.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><p className="ys-field-help">在支持形象的客户端生效。</p></label>
      </div>
    </div></section>
    <aside className="ys-stack">
      <section className="ys-card ys-persona-preview"><div className="ys-persona-preview-label">风格示意</div><div className="ys-persona-avatar" aria-hidden="true">{name.trim().slice(0,1) || '语'}</div><h2>{name.trim() || '你的助手'}</h2><p className="ys-persona-caption">{personality.name} · {REPLY_STYLES.find(item => item.id === reply)?.name}</p><div className="ys-persona-bubble">{title.trim() ? `${title.trim()}，` : '你好，'}我叫{name.trim() || '语声'}。{personality.sample}</div><p className="ys-field-help">示意文案会随名字和性格更新，实际回答由模型生成。音色可在「声音与对话」中单独调整。</p></section>
      <section className="ys-card ys-persona-guidance"><h2>语声助手模式</h2><p>为语音交流优化，支持工具执行、持续对话和客户端界面互动。</p>{value('agentPreset', VOICE_PRESET_ID) === VOICE_PRESET_ID ? <span className="ys-inline-status" data-tone={preset?.broken?'error':undefined}>{preset?.broken?'当前模式不可用':preset?'✓ 已选择专用模式':'等待模式就绪'}</span> : <button className="ys-btn" type="button" disabled={!preset||preset.broken} onClick={() => onChange('agentPreset', VOICE_PRESET_ID)}>选用语声助手</button>}{preset?.problem&&<p style={{overflowWrap:'anywhere'}}>{preset.problem}</p>}<div className="ys-separator"/><p>保存后从下一轮对话开始使用新的人设，正在进行的回答保持当前配置，对话历史会继续保留。这些设置只作用于当前客户端，其他客户端不会随之改变。</p></section>
    </aside>
  </div>
}
