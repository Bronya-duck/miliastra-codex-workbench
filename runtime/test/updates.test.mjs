import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { syncKnowledge,validateSnapshot } from '../sync.mjs';
import { readJson,writeJson,hash,exists } from '../io.mjs';
import { MODEL_REVISION } from '../paths.mjs';

async function fixture(t) {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'miliastra-update-test-'));
  t.after(async()=>{const absolute=path.resolve(directory);if(absolute.startsWith(path.resolve(os.tmpdir())+path.sep+'miliastra-update-test-'))await fs.rm(absolute,{recursive:true,force:true});});
  await writeJson(path.join(directory,'active.json'),{snapshot_id:'existing',directory:'snapshots/existing'});
  await fs.mkdir(path.join(directory,'snapshots','existing'),{recursive:true});await fs.writeFile(path.join(directory,'snapshots','existing','sentinel.txt'),'existing usable content');
  return directory;
}
const doc=(id,title,updated_at)=>({id,title,updated_at,category:'course',official_url:`https://act.mihoyo.com/ys/ugc/tutorial/course/detail/${id}`,client_lua:false,ancestors:[]});
function catalogs(documents) {return {documents,catalogs:[{category:'course',raw:documents}],fingerprint:hash(JSON.stringify(documents))};}
async function fixtureIndex(stage,manifest,save,{dataDirectory}) {
  const chunks=[];
  for(const document of manifest.documents){const text=await fs.readFile(path.join(stage,document.body_path),'utf8');chunks.push({document_id:document.id,row:chunks.length,start:0,end:text.length,text,heading:document.title,image_ids:[]});}
  const vectors=Buffer.alloc(chunks.length*512*4);for(let row=0;row<chunks.length;row++)vectors.writeFloatLE(1,row*512*4);
  await writeJson(path.join(stage,'index.json'),{dimensions:512,model_revision:MODEL_REVISION,chunks});await writeJson(path.join(stage,'nodes.json'),[]);await fs.writeFile(path.join(stage,'vectors.bin'),vectors);
  const coverage=await validateSnapshot(stage,manifest,{dataDirectory});assert.equal(coverage.complete,true,JSON.stringify(coverage));manifest.status='complete';await save();return {...coverage,chunks:chunks.length,nodes:0};
}

test('catalog, image, and index failures preserve the usable active snapshot',async(t)=>{
  const directory=await fixture(t),before=await fs.readFile(path.join(directory,'active.json'),'utf8');
  const options={dataDirectory:directory,prepare:false,indexBuilder:fixtureIndex};
  await assert.rejects(syncKnowledge({...options,catalogFetcher:async()=>{throw new Error('catalog network failure');}}),/catalog network failure/);
  assert.equal(await fs.readFile(path.join(directory,'active.json'),'utf8'),before);assert.equal(await exists(path.join(directory,'sync.lock')),false);
  const fresh=catalogs([doc('mh1','新教程','1')]);
  await assert.rejects(syncKnowledge({...options,catalogFetcher:async()=>fresh,byteFetcher:async(url)=>{if(url.endsWith('image.png'))throw new Error('image network failure');return {bytes:Buffer.from('<h1>新教程</h1><p>完整正文</p><img src="image.png">')};}}),/Collection incomplete/);
  assert.equal(await fs.readFile(path.join(directory,'active.json'),'utf8'),before);
  await assert.rejects(syncKnowledge({...options,catalogFetcher:async()=>fresh,byteFetcher:async()=>({bytes:Buffer.from('<h1>新教程</h1><p>完整正文</p>')}),indexBuilder:async()=>{throw new Error('embedding failure');}}),/embedding failure/);
  assert.equal(await fs.readFile(path.join(directory,'active.json'),'utf8'),before);assert.equal(await fs.readFile(path.join(directory,'snapshots','existing','sentinel.txt'),'utf8'),'existing usable content');
});

test('explicit sync stages added, modified, and removed docs before activation',async(t)=>{
  const directory=await fixture(t);let current=catalogs([doc('mh1','原教程','1')]);let body='第一版';
  const options={dataDirectory:directory,prepare:false,indexBuilder:fixtureIndex,catalogFetcher:async()=>current,byteFetcher:async()=>({bytes:Buffer.from(`<h1>教程</h1><p>${body}</p>`)})};
  await syncKnowledge(options);const first=await readJson(path.join(directory,'active.json'));
  current=catalogs([doc('mh1','更新教程','2'),doc('mh2','新增教程','2')]);body='第二版新增内容';
  await syncKnowledge(options);const second=await readJson(path.join(directory,'active.json'));assert.notEqual(first.snapshot_id,second.snapshot_id);
  const changed=await readJson(path.join(directory,second.directory,'manifest.json'));assert.equal(changed.documents.length,2);assert.match(await fs.readFile(path.join(directory,second.directory,changed.documents[0].markdown_path),'utf8'),/第二版新增内容/);
  current=catalogs([doc('mh2','新增教程','3')]);body='删除后的当前内容';await syncKnowledge(options);
  const third=await readJson(path.join(directory,'active.json'));const final=await readJson(path.join(directory,third.directory,'manifest.json'));assert.deepEqual(final.documents.map(item=>item.id),['mh2']);
  assert.ok(await exists(path.join(directory,first.directory,'manifest.json')));assert.equal(await exists(path.join(directory,'sync.lock')),false);
});
