import { promises as fs } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { DATA, MODEL_REVISION } from './paths.mjs';
import { readJson, inside } from './io.mjs';
import { embed } from './embedding.mjs';

export function matchRank(query,target) {
  const needle=query.toLowerCase().trim(), text=target.toLowerCase();
  if (needle===text) return 0;
  if (text.includes(needle)) return 1;
  let cursor=0;
  for (const character of text) if (character===needle[cursor]) cursor++;
  return cursor===needle.length ? 2 : Infinity;
}
export function requireQueries(values,field) {
  if (!Array.isArray(values) || !values.length || values.length>20 || values.some((value)=>typeof value!=='string' || !value.trim())) throw new Error(`${field} requires 1–20 non-empty strings`);
}
export function requireKeywords(values) {
  if (values!==undefined && (!Array.isArray(values) || values.length>20 || values.some((value)=>typeof value!=='string' || !value.trim()))) throw new Error('keywords must contain non-empty strings, or be omitted/[]');
}

export class Knowledge {
  constructor(directory,manifest,nodes,index,vectors,{embedding=embed,dataDirectory=DATA}={}) {
    this.directory=directory; this.manifest=manifest; this.nodes=nodes; this.index=index; this.vectors=vectors; this.embedding=embedding; this.dataDirectory=dataDirectory;
    this.documents=new Map(manifest.documents.map((doc)=>[doc.id,doc]));
  }
  static async load(dataDirectory=DATA) {
    const pointer=await readJson(path.join(dataDirectory,'active.json'));
    const directory=inside(dataDirectory,pointer.directory);
    const [manifest,nodes,index,bytes]=await Promise.all([readJson(path.join(directory,'manifest.json')),readJson(path.join(directory,'nodes.json')),readJson(path.join(directory,'index.json')),fs.readFile(path.join(directory,'vectors.bin'))]);
    if (manifest.status!=='complete' || manifest.snapshot_id!==pointer.snapshot_id || index.model_revision!==MODEL_REVISION || index.dimensions!==512 || bytes.length!==index.chunks.length*512*4) throw new Error('Active knowledge snapshot is incomplete or incompatible; run doctor');
    const vectors=new Float32Array(index.chunks.length*512);
    for(let i=0;i<vectors.length;i++) vectors[i]=bytes.readFloatLE(i*4);
    return new Knowledge(directory,manifest,nodes,index,vectors,{dataDirectory});
  }
  source(document) {
    return { document_id:document.id,title:document.title,official_url:document.official_url,updated_at:document.updated_at,fetched_at:document.fetched_at,body_sha256:document.body_sha256,snapshot_id:this.manifest.snapshot_id,local_path:path.join(this.directory,document.markdown_path),client_lua:document.client_lua };
  }
  imageReferences(document) {
    return document.images.map((reference)=>({...reference,...this.manifest.assets[reference.id],local_path:path.join(this.dataDirectory,this.manifest.assets[reference.id].local_path)}));
  }
  getNodes(names) {
    requireQueries(names,'names');
    return names.map((query)=>{
      const matches=this.nodes.map((node)=>({node,rank:matchRank(query,node.title)})).filter(({rank})=>Number.isFinite(rank)).sort((a,b)=>a.rank-b.rank);
      const selected=matches.some(({rank})=>rank===0)?matches.filter(({rank})=>rank===0):matches;
      if(selected.length>20)return {query,status:'too_many',total:selected.length,matches:selected.map(({node})=>({title:node.title,main_title:node.main_title,side:node.side,image_ids:node.image_ids,sources:node.sources.map(source=>({...source,...this.source(this.documents.get(source.document_id))}))})),message:'匹配过多；请按候选节点的完整名称收窄查询。'};
      return {query,matches:selected.map(({node})=>({...node,sources:node.sources.map((source)=>({...source,...this.source(this.documents.get(source.document_id)),main_title:source.main_title,side:source.side,side_basis:source.side_basis}))})),message:selected.length?undefined:'未找到匹配节点；可改用文档全文或语义搜索'};
    });
  }
  listDocuments(keywords,clientOnly=false) {
    requireKeywords(keywords);
    const candidates=[...this.documents.values()].filter((doc)=>!clientOnly || doc.client_lua);
    if (!keywords?.length) return {total:candidates.length,documents:candidates.map((doc)=>this.source(doc))};
    return keywords.map((keyword)=>{const documents=candidates.filter((doc)=>Number.isFinite(matchRank(keyword,doc.title)) || Number.isFinite(matchRank(keyword,doc.id))).map((doc)=>this.source(doc));return {keyword,total:documents.length,documents};});
  }
  async getDocuments(titles,clientOnly=false) {
    requireQueries(titles,'titles');
    const candidates=[...this.documents.values()].filter((doc)=>!clientOnly || doc.client_lua);
    return await Promise.all(titles.map(async(query)=>{
      const ranked=candidates.map((doc)=>({doc,rank:Math.min(matchRank(query,doc.title),matchRank(query,doc.id))})).filter(({rank})=>Number.isFinite(rank)).sort((a,b)=>a.rank-b.rank);
      const selected=ranked.some(({rank})=>rank===0)?ranked.filter(({rank})=>rank===0):ranked;
      if (!selected.length) return {query,status:'not_found',matches:[]};
      if (selected.length>5) return {query,status:'too_many',matches:selected.map(({doc})=>this.source(doc)),message:'请用精确标题或文档 ID 获取全文'};
      return {query,status:'ok',documents:await Promise.all(selected.map(async({doc})=>({...this.source(doc),content:await fs.readFile(inside(this.directory,doc.markdown_path),'utf8'),images:this.imageReferences(doc),videos:doc.videos})))};
    }));
  }
  async search(queries,topK=5,scope='all') {
    requireQueries(queries,'queries');
    if (!Number.isInteger(topK)||topK<1||topK>20) throw new Error('top_k must be an integer from 1 to 20');
    if (!['all','general','client'].includes(scope)) throw new Error('scope must be all, general or client');
    return await Promise.all(queries.map(async(query)=>{
      const vector=await this.embedding(query,true);
      if (vector.length!==512) throw new Error('Embedding vector dimension mismatch');
      const scores=[];
      for(let row=0;row<this.index.chunks.length;row++) {
        const chunk=this.index.chunks[row], document=this.documents.get(chunk.document_id);
        if ((scope==='client'&&!document.client_lua)||(scope==='general'&&document.client_lua)) continue;
        let similarity=0;
        for(let column=0;column<512;column++) similarity+=vector[column]*this.vectors[row*512+column];
        scores.push({row,similarity});
      }
      scores.sort((a,b)=>b.similarity-a.similarity);
      // Keep complementary sections, while avoiding five overlapping windows from one section.
      const selected=[], seen=new Set();
      for(const candidate of scores) {
        const chunk=this.index.chunks[candidate.row];
        const key=chunk.document_id+'|'+chunk.heading;
        if (seen.has(key)) continue;
        seen.add(key);selected.push(candidate);if(selected.length===topK)break;
      }
      return {query,scope,retrieval:'local-bge-q8-cosine',total_results:selected.length,results:selected.map(({row,similarity})=>{
        const chunk=this.index.chunks[row],doc=this.documents.get(chunk.document_id);
        const ids=chunk.image_ids.length?chunk.image_ids:doc.images.filter((image)=>chunk.heading.includes(image.heading)).map((image)=>image.id);
        return {...this.source(doc),heading:chunk.heading,similarity:Number(similarity.toFixed(5)),text_snippet:chunk.text,image_ids:[...new Set(ids)],character_range:[chunk.start,chunk.end]};
      })};
    }));
  }
  async getImage(imageId,{crop,frame_indices}={}) {
    const asset=this.manifest.assets[imageId];
    if (!asset) throw new Error(`Unknown image ID ${imageId}`);
    const local=inside(this.dataDirectory,asset.local_path);
    const frames=asset.frames>1;
    let indices=frame_indices;
    if(indices!==undefined && (!Array.isArray(indices)||!indices.length||indices.length>8||indices.some((index)=>!Number.isInteger(index)||index<0||index>=asset.frames))) throw new Error(`frame_indices must contain 1–8 frame indices from 0 to ${asset.frames-1}`);
    if(crop && (!['x','y','width','height'].every((key)=>Number.isInteger(crop[key]))||crop.x<0||crop.y<0||crop.width<1||crop.height<1||crop.x+crop.width>asset.width||crop.y+crop.height>asset.height)) throw new Error('Crop is outside the original image');
    indices ||= frames ? [...new Set(Array.from({length:Math.min(asset.frames,5)},(_,index)=>Math.round(index*(asset.frames-1)/(Math.min(asset.frames,5)-1))))] : [0];
    const references= [...this.documents.values()].filter((doc)=>doc.images.some((image)=>image.id===imageId)).map((doc)=>({source:this.source(doc),contexts:doc.images.filter((image)=>image.id===imageId)}));
    const descriptions=[];
    const images=[];
    for(const index of indices) {
      let renderer=sharp(local,{page:index,pages:1,density:asset.format==='svg'?144:72,limitInputPixels:200000000});
      // SVG density changes coordinates; use the documented original viewport for crops.
      if(asset.format==='svg') renderer=renderer.resize(asset.width,asset.height);
      if(crop)renderer=renderer.extract({left:crop.x,top:crop.y,width:crop.width,height:crop.height});
      const png=await renderer.png().toBuffer();
      images.push({type:'image',data:png.toString('base64'),mimeType:'image/png'});
      descriptions.push({frame:index,time_ms:asset.delays.slice(0,index).reduce((sum,delay)=>sum+delay,0)});
    }
    return {metadata:{...asset,local_path:local,references,rendered_frames:descriptions,crop,notice:frames?'GIF 原件完整保留；当前返回选定帧，若不足以说明行为请读取其他帧。':undefined},images};
  }
}
