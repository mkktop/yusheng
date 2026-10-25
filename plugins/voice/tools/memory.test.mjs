import {test,after} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {build} from 'esbuild'
const root=mkdtempSync(join(tmpdir(),'voice-memory-v2-'))
after(()=>rmSync(root,{recursive:true,force:true}))
await build({entryPoints:['src/memory-store.ts','src/clients.ts','src/settings.ts','src/client-memory.ts'],outdir:join(root,'lib'),bundle:true,platform:'node',format:'esm',outExtension:{'.js':'.mjs'},logLevel:'silent'})
const load=name=>import(pathToFileURL(join(root,'lib',name+'.mjs')))
const {MemoryStore,extractMemory}=await load('memory-store'),{ClientStore}=await load('clients'),{DEFAULT_SETTINGS}=await load('settings'),{memoryContext,memoryTool}=await load('client-memory')
function store(name){return new MemoryStore(join(root,name+'.json'))}
function clients(name){const c=new ClientStore(join(root,name),()=>DEFAULT_SETTINGS);c.ensure('a');c.ensure('b');return c}

test('v1 facts migrate without changing identity or existing conversation namespace',()=>{
 const s=store('legacy'),original={revision:4,updatedAt:123,items:[{id:'legacy-id',text:'喜欢长途骑行',createdAt:123}]}
 writeFileSync(s.path,JSON.stringify(original));const doc=s.read()
 assert.equal(doc.schemaVersion,2);assert.equal(doc.barrier,0);assert.equal(doc.items[0].id,'legacy-id');assert.equal(doc.items[0].source.actor,'migration')
 assert.deepEqual(JSON.parse(readFileSync(s.path)),original,'reading must not rewrite or back up private data')
 const next=s.upsert({text:'喜欢长途骑行'});assert.equal(next.revision,4)
 s.upsert({text:'周末常去公园',key:'preference.weekend'});assert.equal(JSON.parse(readFileSync(s.path)).schemaVersion,2)
 assert.equal(s.read().items[0].id,'legacy-id')
 writeFileSync(s.path,JSON.stringify({...s.read(),schemaVersion:9}));assert.throws(()=>s.read(),/unsupported/)
})

test('direct requests have conservative extraction and stable topic corrections',()=>{
 assert.equal(extractMemory('我喜欢咖啡'),undefined)
 assert.equal(extractMemory('我喜欢咖啡',true).key,'preference.drink.coffee')
 for(const text of ['假设我喜欢咖啡','他说我喜欢咖啡','我喜欢咖啡吗','请记住我喜欢咖啡吗','请记住如果我喜欢咖啡怎么办','请记住密码是 abcdef123456'])assert.equal(extractMemory(text,true),undefined,text)
 const c=clients('observed');assert.equal(c.observe('a','我喜欢咖啡','main','t1'),undefined)
 c.observe('a','请记住，我喜欢咖啡','main','t2');const first=c.memory('a').items[0],epoch=c.contextEpoch('a')
 assert.equal(first.key,'preference.drink.coffee');assert.equal(first.source.turnId,'t2');assert.equal(first.source.actor,'user')
 c.observe('a','请记住，我现在不喝咖啡','main','t3')
 const doc=c.memory('a');assert.equal(doc.items.length,1);assert.equal(doc.items[0].id,first.id);assert.match(doc.items[0].text,/不喝咖啡/);assert.notEqual(c.contextEpoch('a'),epoch)
 assert.equal(c.memory('b').items.length,0);assert.equal(doc.events.at(-1).operation,'update')
 c.update('a',{memoryPolicy:'adaptive'});c.observe('a','我住在杭州','main','t4');assert.equal(c.memory('a').items[1].key,'profile.location')
 c.update('a',{memoryPolicy:'off'});assert.equal(c.observe('a','请记住我的名字是小林','main','t5'),undefined)
})

test('metadata validates, revisions prevent lost edits and duplicate text is idempotent',()=>{
 const s=store('revisions'),first=s.upsert({text:'我喜欢咖啡',key:'preference.drink.coffee',kind:'preference',importance:4,expiresAt:Date.now()+86400000},{actor:'settings'})
 assert.equal(s.upsert({text:'我喜欢咖啡。',key:'preference.drink.coffee'}).revision,first.revision)
 const before=readFileSync(s.path,'utf8')
 for(const input of [{text:'新事实',revision:0},{text:'新事实',importance:6},{text:'新事实',key:'../a'},{text:'新事实',expiresAt:0},{text:'新事实',id:'missing'},{text:'密码是: abcdefgh123456'},{text:'sk-'+ 'a'.repeat(32)}])assert.throws(()=>s.upsert(input))
 assert.equal(readFileSync(s.path,'utf8'),before)
 const second=s.upsert({text:'我不再喝咖啡',id:first.items[0].id,revision:first.revision})
 assert.equal(second.items.length,1);assert.equal(second.items[0].key,'preference.drink.coffee');assert.equal(second.items[0].source.actor,'assistant')
 assert.throws(()=>s.forget(second.items[0].id,first.revision),{code:'memory_conflict'})
 assert.throws(()=>s.replace('旧编辑内容',undefined),{code:'bad_memory'})
})

test('ranked recall selects Chinese and English matches, omits expired facts and bounds context',()=>{
 const s=store('ranking')
 for(let i=0;i<40;i++)s.upsert({text:'无关日常事项第'+i+'项',key:'other.'+i})
 const relevant=s.upsert({text:'我现在不喝咖啡',key:'preference.drink.coffee',kind:'preference'}).items.at(-1)
 s.upsert({text:'用户昵称是小林',key:'profile.name',kind:'profile'})
 s.record({conversationId:'travel',sessionId:'session1',epoch:'e1',user:'上次杭州旅行要去哪里',assistant:'讨论了西湖和植物园'})
 s.record({conversationId:'work',sessionId:'session2',epoch:'e1',user:'数据库迁移计划',assistant:'先备份再验证索引'})
 const recall=s.recall('现在喝咖啡吗');assert.ok(recall.items.some(i=>i.id===relevant.id));assert.ok(recall.items.every(i=>i.kind==='profile'||i.id===relevant.id));assert.equal(recall.episodes.length,0)
 assert.equal(s.recall('coffee').items.some(i=>i.id===relevant.id),true)
 const travel=s.recall('杭州旅行');assert.equal(travel.episodes.length,1);assert.equal(travel.episodes[0].conversationId,'travel')
 const raw=s.read();raw.items.find(i=>i.id===relevant.id).expiresAt=1;writeFileSync(s.path,JSON.stringify(raw))
 assert.equal(s.recall('咖啡').items.some(i=>i.id===relevant.id),false)
 const huge={items:Array.from({length:30},(_,i)=>({id:'id'+i,text:'界'.repeat(1000),kind:'fact',source:{actor:'user'}})),episodes:[]}
 const before=huge.items.length;assert.ok(memoryContext(huge).length<6500);assert.equal(huge.items.length,before)
})

test('forget and correction cut old contexts, purge recall excerpts, and preserve other clients',()=>{
 const c=clients('forgetting');c.remember('a','只属于 A 的敏感往事');c.remember('b','只属于 B 的事实');const original=c.contextEpoch('a'),other=c.contextEpoch('b')
 c.record('a',{conversationId:'main',sessionId:'old-a',epoch:original,user:'只属于 A 的敏感往事',assistant:'我记住了'});assert.equal(c.memory('a').episodes.length,1)
 c.resetContext('a');assert.equal(c.view('a').canRestore,true)
 const doc=c.memory('a');c.forget('a',doc.items[0].id,doc.revision,{actor:'settings'})
 assert.equal(c.memory('a').episodes.length,0);assert.equal(c.memory('a').items.length,0);assert.notEqual(c.contextEpoch('a'),original);assert.equal(c.view('a').canRestore,false)
 assert.throws(()=>c.resetContext('a',true),{code:'no_archive'})
 c.record('a',{conversationId:'main',sessionId:'late-old-a',epoch:original,user:'只属于 A 的敏感往事',assistant:'延迟返回的旧轮'})
 assert.equal(c.memory('a').episodes.length,0);assert.equal(c.contextEpoch('b'),other);assert.equal(c.memory('b').items.length,1)
 assert.equal(readFileSync(join(c.directory('a'),'memory.json'),'utf8').includes('敏感往事'),false,'audit must not retain forgotten text')
 c.resetContext('a');const fresh=c.contextEpoch('a');c.resetContext('a',true);assert.notEqual(c.contextEpoch('a'),fresh);assert.notEqual(c.contextEpoch('a'),original)
})

test('history excerpts are bounded, excluded for credentials, and disabled by recording policy',()=>{
 const s=store('episodes')
 for(let i=0;i<140;i++)s.record({conversationId:'main',sessionId:'s',epoch:'e',user:'讨论出行安排 '+i,assistant:'答'.repeat(900)})
 assert.equal(s.read().episodes.length,128);assert.equal(s.read().episodes[0].assistant.length,720)
 s.record({conversationId:'main',sessionId:'s',epoch:'e',user:'密码是 abcdefgh123456',assistant:'收到'});assert.equal(s.read().episodes.at(-1).user.includes('密码'),false)
 const c=clients('policy');c.update('a',{memoryPolicy:'off'});c.record('a',{conversationId:'main',sessionId:'s',epoch:c.contextEpoch('a'),user:'普通问题',assistant:'普通回答'});assert.equal(c.memory('a').episodes.length,0)
})

test('memory tool restricts operation fields, disabled writes, identity and cancellation',async()=>{
 const s=store('tools'),access={read:()=>s.read(),recall:(q,n)=>s.recall(q,n),remember:(text,options)=>s.upsert({text,...options}),forget:id=>s.forget(id)},controller=new AbortController(),exec={signal:controller.signal}
 const tool=memoryTool(access,()=>{}),disabled=memoryTool({...access,policy:'off'},()=>{})
 await assert.rejects(disabled.execute({operation:'remember',text:'新事实'},exec),{code:'memory_disabled'})
 await tool.execute({operation:'remember',text:'喜欢绿茶',key:'preference.drink.tea',kind:'preference'},exec)
 const result=JSON.parse((await tool.execute({operation:'read',query:'绿茶',limit:3},exec)).result);assert.equal(result.items.length,1)
 for(const args of [{operation:'read',clientId:'other'},{operation:'read',limit:100},{operation:'forget',id:result.items[0].id,text:'额外数据'},{operation:'remember',text:'新事实',query:'不允许'}])await assert.rejects(tool.execute(args,exec),{code:'bad_memory'})
 controller.abort();await assert.rejects(tool.execute({operation:'read'},exec));assert.equal(s.read().items.length,1)
})
