import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { enumerateCatalog,compareCatalogs } from '../catalog.mjs';
import { parseOfficialHtml,deriveNodes,splitSections } from '../documents.mjs';
import { Knowledge } from '../knowledge.mjs';
import { inspectUpdate,UpdateNotifier,beijingDay } from '../updates.mjs';
import { activateSnapshot } from '../sync.mjs';
import { writeJson,readJson } from '../io.mjs';

async function fixture(t) {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'miliastra-test-'));
  t.after(async()=>{const absolute=path.resolve(directory);if(absolute.startsWith(path.resolve(os.tmpdir())+path.sep+'miliastra-test-'))await fs.rm(absolute,{recursive:true,force:true});});
  return directory;
}
const entry={id:'mh123',title:'执行节点',category:'knowledge',official_url:'https://example.test/doc',updated_at:'2026-10-04',client_lua:false};

test('catalog includes all real IDs regardless of article_type, and discovers client courses',()=>{
  const entries=enumerateCatalog([{real_id:'mh1',title:'节点图',article_type:8,children:[{real_id:'mh2',title:'客户端脚本——新教程'}]},{title:'目录',children:[{real_id:'mh3',title:'FAQ'}]}],'course');
  assert.deepEqual(entries.map((item)=>item.id),['mh1','mh2','mh3']);
  assert.equal(entries[1].client_lua,true);
});
test('catalog diff detects additions, edits and removals',()=>{
  const delta=compareCatalogs([{id:'mh1',title:'旧',updated_at:'1'},{id:'mh2',title:'删除'}],[{id:'mh1',title:'新',updated_at:'2'},{id:'mh3',title:'新增'}]);
  assert.deepEqual([delta.added[0].id,delta.changed[0].id,delta.removed[0].id],['mh3','mh1','mh2']);
});
test('full article conversion retains redacted topics, code, complex tables, relative media',()=>{
  const article=parseOfficialHtml('<h1>执行节点</h1><h2>发送客户端脚本信号</h2><pre><code>local x = "官方API"\n-- # code heading</code></pre><table><tr><td rowspan="2">参数</td><td>值</td></tr><tr><td>1</td></tr></table><img src="../diagram.png"><video><source src="demo.mp4"></video>',entry,'https://example.test/a/content.html');
  assert.match(article.markdown,/发送客户端脚本信号/);assert.match(article.markdown,/local x/);assert.match(article.markdown,/rowspan="2"/);
  assert.equal(article.images[0].url,'https://example.test/diagram.png');assert.equal(article.videos[0],'https://example.test/a/demo.mp4');
});
test('tables without TH retain cell text without embedding editor styling',()=>{
  const article=parseOfficialHtml('<table id="editor-id" style="width:100%"><tr><td rowspan="1" data-colwidth="245">参数名</td><td colspan="1">目标实体</td></tr></table>',entry,'https://example.test/a/content.html');
  assert.match(article.markdown,/参数名/);assert.match(article.markdown,/目标实体/);assert.doesNotMatch(article.markdown,/editor-id|data-colwidth|style=|rowspan="1"/);
});
test('node extraction ignores code headings, merges known sides and retains every source',()=>{
  const first={...entry,ancestors:['节点介绍','服务器节点']},second={...entry,id:'mh456',ancestors:['节点介绍','客户端节点']};
  const body='# 执行节点\n## 嘲讽目标\n参数表\n```lua\n## 不是节点\n```\n';
  const nodes=deriveNodes([first,second],new Map([[first.id,body],[second.id,body]]));
  assert.equal(nodes.length,1);assert.equal(nodes[0].side,'both');assert.equal(nodes[0].sources.length,2);assert.match(nodes[0].content,/不是节点/);
  const sections=splitSections(body);assert.equal(sections.length,2);
});
test('official catalog ancestry identifies client graph type without external mapping',()=>{
  const document={...entry,id:'mh277t9fl4tm',ancestors:['节点介绍','客户端节点','造物状态决策节点图']};
  const nodes=deriveNodes([document],new Map([[document.id,'# 一、通用\n## 1\\. 切换自身执行状态\n节点参数\n']]));
  assert.equal(nodes[0].title,'切换自身执行状态');assert.equal(nodes[0].side,'client');assert.equal(nodes[0].sources[0].side_verified,true);assert.equal(nodes[0].sources[0].graph_type,'造物状态决策节点图');
});
test('document interface distinguishes exact, too many, not found and empty keyword listing',async(t)=>{
  const directory=await fixture(t);
  const docs=Array.from({length:7},(_,index)=>({...entry,id:`mh${index}`,title:`控件 ${index}`,markdown_path:`${index}.md`,images:[],videos:[],client_lua:index===0}));
  await Promise.all(docs.map((doc)=>fs.writeFile(path.join(directory,doc.markdown_path),`# ${doc.title}\n全文`)));
  const kb=new Knowledge(directory,{snapshot_id:'test',documents:docs,assets:{}},[],{chunks:[]},new Float32Array());
  assert.equal(kb.listDocuments([]).total,7);assert.equal(kb.listDocuments(undefined,true).total,1);
  assert.equal((await kb.getDocuments(['控件']))[0].status,'too_many');
  assert.equal((await kb.getDocuments(['mh0']))[0].documents[0].document_id,'mh0');
  assert.equal((await kb.getDocuments(['不存在']))[0].status,'not_found');
  await assert.rejects(kb.getDocuments([]));
});
test('semantic results respect scope and report sources and image IDs',async(t)=>{
  const directory=await fixture(t);
  const docs=[{...entry,id:'mh1',markdown_path:'one.md',images:[]},{...entry,id:'mh2',markdown_path:'two.md',client_lua:true,images:[]}];
  const vector=new Float32Array(512);vector[0]=1;
  const vectors=new Float32Array(1024);vectors[0]=1;vectors[512]=0.5;
  const chunks=docs.map((doc,row)=>({document_id:doc.id,heading:'章节',text:'相关原文',start:0,end:4,row,image_ids:row?['img_test']:[]}));
  const kb=new Knowledge(directory,{snapshot_id:'test',documents:docs},[],{chunks},vectors,{embedding:async()=>vector});
  const result=await kb.search(['自然语言'],5,'client');assert.equal(result[0].results.length,1);assert.equal(result[0].results[0].document_id,'mh2');assert.equal(result[0].results[0].similarity,0.5);
  await assert.rejects(kb.search(['x'],0));
});
test('original image rendering produces readable PNG and rejects out-of-bounds crops',async(t)=>{
  const directory=await fixture(t);await fs.mkdir(path.join(directory,'assets'));
  const id='img_'+'a'.repeat(24), file='assets/test.svg';
  await fs.writeFile(path.join(directory,file),'<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="red"/></svg>');
  const doc={...entry,images:[{id,ordinal:1}],markdown_path:'x.md'};
  const kb=new Knowledge(directory,{snapshot_id:'test',documents:[doc],assets:{[id]:{id,local_path:file,format:'svg',width:80,height:40,frames:1,delays:[]}}},[],{chunks:[]},new Float32Array(),{dataDirectory:directory});
  const image=await kb.getImage(id,{crop:{x:5,y:5,width:20,height:10}});
  const metadata=await sharp(Buffer.from(image.images[0].data,'base64')).metadata();assert.equal(metadata.width,20);assert.equal(metadata.height,10);
  await assert.rejects(kb.getImage(id,{crop:{x:100,y:0,width:1,height:1}}));
});
test('failed snapshot or update never replaces active pointer; update notification waits for delivery',async(t)=>{
  const directory=await fixture(t);const pointer={snapshot_id:'old',directory:'snapshots/old'};await writeJson(path.join(directory,'active.json'),pointer);
  await assert.rejects(activateSnapshot(path.join(directory,'missing'),{status:'indexing',snapshot_id:'bad'},directory));
  const manifest={snapshot_id:'old',expected_documents:[{id:'mh1',title:'旧',updated_at:'1'}]};
  const failed=await inspectUpdate(manifest,{dataDirectory:directory,fetcher:async()=>{throw new Error('offline');},now:new Date('2026-10-04T10:00:00Z')});assert.equal(failed.status,'check_failed');
  assert.deepEqual(await readJson(path.join(directory,'active.json')),pointer);
  const notify=new UpdateNotifier(manifest,{dataDirectory:directory,fetcher:async()=>({documents:[]}),now:new Date('2026-10-05T10:00:00Z')});
  const first=await notify.notification();assert.ok(await notify.notification());notify.delivered(first);assert.equal(await notify.notification(),undefined);
  assert.equal(beijingDay(new Date('2026-10-04T16:01:00Z')),'2026-10-05');
});
