import { promises as fs } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { DATA, MODEL_DIR, MODEL_FILES, MODEL_REVISION, contentUrl } from './paths.mjs';
import { readJson, writeJson, exists, fetchBytes, hash, pool } from './io.mjs';
import { fetchCatalogs } from './catalog.mjs';
import { parseOfficialHtml, localMarkdown, deriveNodes, splitSections } from './documents.mjs';
import { chunkSections, embed, getModel } from './embedding.mjs';

const log = (message) => process.stderr.write(message + '\n');
export async function prepareModel() {
  await fs.mkdir(MODEL_DIR, { recursive: true });
  for (const file of MODEL_FILES) {
    const destination = path.join(MODEL_DIR, file);
    if (await exists(destination)) continue;
    log(`Model download: ${file}`);
    const url = `https://huggingface.co/Xenova/bge-small-zh-v1.5/resolve/${MODEL_REVISION}/${file}`;
    const { bytes } = await fetchBytes(url, { timeoutMs: 180000 });
    await fs.mkdir(path.dirname(destination), { recursive: true });
    const temporary = destination + '.partial';
    await fs.writeFile(temporary, bytes);
    await fs.rename(temporary, destination);
  }
  const files = await Promise.all(MODEL_FILES.map(async (file) => ({ file, sha256: hash(await fs.readFile(path.join(MODEL_DIR,file))) })));
  await writeJson(path.join(MODEL_DIR,'manifest.json'), { repository: 'Xenova/bge-small-zh-v1.5', revision: MODEL_REVISION, files });
  const vector = await embed('千星奇域节点图编辑器', true);
  if (vector.length !== 512 || !vector.every(Number.isFinite)) throw new Error('Embedding model failed 512-dimensional smoke test');
  log('Local q8 model ready: 512 dimensions');
}

export async function validateSnapshot(directory, manifest, { requireIndex = true, dataDirectory = DATA } = {}) {
  const issues = [];
  const ids = new Set(manifest.expected_documents.map((entry) => entry.id));
  const loaded = new Set(manifest.documents.map((entry) => entry.id));
  for (const id of ids) if (!loaded.has(id)) issues.push(`Missing document ${id}`);
  for (const id of loaded) if (!ids.has(id)) issues.push(`Unexpected current document ${id}`);
  for (const doc of manifest.documents) {
    try {
      const html = await fs.readFile(path.join(directory,doc.html_path));
      const markdown = await fs.readFile(path.join(directory,doc.markdown_path));
      const body = await fs.readFile(path.join(directory,doc.body_path));
      if (hash(html) !== doc.html_sha256 || hash(markdown) !== doc.markdown_sha256 || hash(body) !== doc.body_sha256) issues.push(`Document hash mismatch ${doc.id}`);
      for (const image of doc.images) if (!manifest.assets[image.id]) issues.push(`Missing image metadata ${image.id}`);
    } catch (error) { issues.push(`${doc.id}: ${error.message}`); }
  }
  const mediaChecks=new Map();
  await pool(Object.values(manifest.assets),4,async(asset)=>{
    try {
      if(!mediaChecks.has(asset.local_path))mediaChecks.set(asset.local_path,(async()=>{
        const bytes=await fs.readFile(path.join(dataDirectory,asset.local_path));
        const metadata=await sharp(bytes,{animated:false,limitInputPixels:200000000}).metadata();
        if(!metadata.width || !metadata.height)throw new Error('Missing image dimensions');
        // Decode pixels as well as headers. Deduplicate checks for identical originals.
        await sharp(bytes,{animated:false,limitInputPixels:200000000}).resize({width:64,height:64,fit:'inside',withoutEnlargement:true}).png().toBuffer();
        return hash(bytes);
      })());
      if(await mediaChecks.get(asset.local_path)!==asset.sha256)issues.push(`Image hash mismatch ${asset.id}`);
    } catch (error) { issues.push(`${asset.id}: ${error.message}`); }
  });
  if (requireIndex) {
    try {
      const index = await readJson(path.join(directory,'index.json'));
      const chunkIds = new Set(index.chunks.map((chunk) => chunk.document_id));
      for (const id of ids) if (!chunkIds.has(id)) issues.push(`Document not indexed ${id}`);
      const stats = await fs.stat(path.join(directory,'vectors.bin'));
      if (stats.size !== index.chunks.length * 512 * 4 || index.dimensions !== 512 || index.model_revision !== MODEL_REVISION) issues.push('Incomplete or incompatible vectors');
    } catch (error) { issues.push(`Index: ${error.message}`); }
  }
  return { complete: issues.length === 0 && manifest.failures.length === 0, expected: ids.size, documents: loaded.size, images: Object.keys(manifest.assets).length, failures: manifest.failures, issues };
}

export async function activateSnapshot(stage, manifest, dataDirectory = DATA) {
  if (manifest.status !== 'complete') throw new Error('Only a complete validated snapshot can be activated');
  const snapshots = path.join(dataDirectory,'snapshots');
  await fs.mkdir(snapshots,{recursive:true});
  const destination = path.join(snapshots,manifest.snapshot_id);
  await fs.rename(stage,destination);
  await writeJson(path.join(dataDirectory,'active.json'), { snapshot_id:manifest.snapshot_id, directory: path.relative(dataDirectory,destination), activated_at:new Date().toISOString() });
  return destination;
}

export async function buildSnapshotIndex(stage,manifest,save=()=>writeJson(path.join(stage,'manifest.json'),manifest),{dataDirectory=DATA}={}) {
  await getModel();
  const bodies = new Map(await Promise.all(manifest.documents.map(async (doc) => [doc.id,await fs.readFile(path.join(stage,doc.body_path),'utf8')])));
  const nodes = deriveNodes(manifest.documents,bodies);
  await writeJson(path.join(stage,'nodes.json'),nodes);
  const chunks = [];
  for (const doc of manifest.documents) chunks.push(...await chunkSections(doc,splitSections(bodies.get(doc.id))));
  const index = { dimensions:512,model_revision:MODEL_REVISION,chunks:chunks.map(({embedding_text,...chunk},row) => ({...chunk,row})) };
  await writeJson(path.join(stage,'index.json'),index);
  manifest.status = 'indexing'; await save();
  const buildHash = hash(JSON.stringify(chunks.map((chunk) => chunk.embedding_text)) + MODEL_REVISION);
  const buildPath = path.join(stage,'embedding-progress.json');
  const progress = await exists(buildPath) ? await readJson(buildPath) : null;
  let embedded = progress?.hash === buildHash ? progress.count : 0;
  const vectorPath = path.join(stage,'vectors.bin');
  if (!await exists(vectorPath) || (await fs.stat(vectorPath)).size < embedded * 512 * 4) embedded = 0;
  const vectors = await fs.open(vectorPath,embedded ? 'r+' : 'w');
  log(`Indexing ${chunks.length} chunks; ${nodes.length} nodes; resuming at ${embedded}`);
  try {
    for (let row=embedded;row<chunks.length;row++) {
      const vector = await embed(chunks[row].embedding_text);
      if (vector.length !== 512 || !vector.every(Number.isFinite)) throw new Error(`Invalid embedding at chunk ${row}`);
      const buffer = Buffer.allocUnsafe(512 * 4);
      for (let column=0;column<512;column++) buffer.writeFloatLE(vector[column],column*4);
      await vectors.write(buffer,0,buffer.length,row*buffer.length);
      if ((row+1)%100===0 || row+1===chunks.length) {
        await vectors.sync();
        await writeJson(buildPath,{hash:buildHash,count:row+1});
        log(`Vectors ${row+1}/${chunks.length}`);
      }
    }
    await vectors.truncate(chunks.length * 512 * 4);
  } finally { await vectors.close(); }
  const coverage = await validateSnapshot(stage,manifest,{dataDirectory});
  coverage.nodes = nodes.length; coverage.chunks = chunks.length;
  coverage.document_status=manifest.documents.map(doc=>({document_id:doc.id,title:doc.title,body:'verified',images:'verified',image_references:doc.images.length,index:chunks.some(chunk=>chunk.document_id===doc.id)?'verified':'missing',chunks:chunks.filter(chunk=>chunk.document_id===doc.id).length}));
  await writeJson(path.join(stage,'coverage.json'),coverage);
  if (!coverage.complete) throw new Error(`Snapshot failed validation: ${JSON.stringify(coverage)}`);
  manifest.status = 'complete'; manifest.completed_at = new Date().toISOString(); await save();
  return coverage;
}

export async function syncKnowledge({ prepare = false,dataDirectory=DATA,catalogFetcher=fetchCatalogs,byteFetcher=fetchBytes,indexBuilder=buildSnapshotIndex } = {}) {
  await fs.mkdir(dataDirectory,{recursive:true});
  const lockPath = path.join(dataDirectory,'sync.lock');
  let lock;
  try { lock = await fs.open(lockPath,'wx'); }
  catch { throw new Error('Another sync is running (data/sync.lock). Remove this lock only after checking no sync process is running.'); }
  await lock.writeFile(JSON.stringify({pid:process.pid,started_at:new Date().toISOString()}));
  try {
    const modelTask = prepare ? prepareModel() : Promise.resolve();
    // Attach a handler immediately while article downloads are in progress.
    const modelOutcome = modelTask.then(() => ({ok:true}), (error) => ({ok:false,error}));
    const fresh = await catalogFetcher();
    const stage = path.join(dataDirectory,'staging',fresh.fingerprint.slice(0,24));
    const manifestPath = path.join(stage,'manifest.json');
    await fs.mkdir(path.join(stage,'documents'),{recursive:true});
    let manifest = await exists(manifestPath) ? await readJson(manifestPath) : {
      snapshot_id: new Date().toISOString().replace(/[-:.]/g,'').replace('Z','') + '-' + fresh.fingerprint.slice(0,8),
      created_at:new Date().toISOString(), status:'collecting', catalog_fingerprint:fresh.fingerprint,
      expected_documents:fresh.documents, documents:[], assets:{}, failures:[], language:'zh-cn', source:'official-current',
    };
    manifest.failures = [];
    for (const catalog of fresh.catalogs) await writeJson(path.join(stage,`catalog-${catalog.category}.json`),catalog.raw);
    let checkpoint = Promise.resolve();
    const save = () => checkpoint = checkpoint.then(() => writeJson(manifestPath,manifest));
    await save();
    const completed = new Map(manifest.documents.map((document) => [document.id,document]));
    const imageTasks = new Map();
    const extension = { png:'png', jpeg:'jpg', webp:'webp', gif:'gif', svg:'svg', avif:'avif', tiff:'tiff', heif:'heif' };
    async function loadImage(image) {
      if (manifest.assets[image.id] && await exists(path.join(dataDirectory,manifest.assets[image.id].local_path))) return manifest.assets[image.id];
      if (imageTasks.has(image.id)) return await imageTasks.get(image.id);
      const task = (async () => {
        const { bytes,type,etag,modified } = await byteFetcher(image.url,{timeoutMs:90000});
        const metadata = await sharp(bytes,{animated:false,limitInputPixels:200000000}).metadata();
        if (!metadata.width || !metadata.height || !extension[metadata.format]) throw new Error(`Unsupported image ${image.url}: ${type}`);
        const sha256 = hash(bytes);
        const localPath = `assets/${sha256}.${extension[metadata.format]}`;
        await fs.mkdir(path.join(dataDirectory,'assets'),{recursive:true});
        const destination = path.join(dataDirectory,localPath);
        if (!await exists(destination)) await fs.writeFile(destination,bytes);
        const asset = { id:image.id, official_url:image.url, local_path:localPath, sha256, format:metadata.format, mime:type.split(';')[0], width:metadata.width, height:metadata.height, frames:metadata.pages || 1, delays:metadata.delay || [], etag, modified, fetched_at:new Date().toISOString() };
        manifest.assets[image.id] = asset;
        return asset;
      })();
      imageTasks.set(image.id,task);
      return await task;
    }
    let count = 0;
    await pool(fresh.documents,6,async (entry) => {
      try {
        const prior = completed.get(entry.id);
        if (prior && await exists(path.join(stage,prior.markdown_path)) && await exists(path.join(stage,prior.html_path))) return;
        const htmlUrl = contentUrl(entry.category,entry.id);
        const { bytes } = await byteFetcher(htmlUrl);
        const parsed = parseOfficialHtml(bytes.toString('utf8'),entry,htmlUrl);
        for (const image of parsed.images) await loadImage(image);
        const idDirectory = path.join(stage,'documents',entry.id);
        await fs.mkdir(idDirectory,{recursive:true});
        await fs.writeFile(path.join(idDirectory,'source.html'),bytes);
        const body = localMarkdown(parsed,entry,manifest.assets,dataDirectory);
        // Keep image IDs in the indexing body; full Markdown has usable local image links.
        await fs.writeFile(path.join(idDirectory,'body.md'),parsed.markdown);
        await fs.writeFile(path.join(idDirectory,'document.md'),body);
        const document = { ...entry, fetched_at:new Date().toISOString(), html_url:htmlUrl,
          html_path:`documents/${entry.id}/source.html`, body_path:`documents/${entry.id}/body.md`, markdown_path:`documents/${entry.id}/document.md`,
          html_sha256:hash(bytes), markdown_sha256:hash(body), body_sha256:hash(parsed.markdown), images:parsed.images, videos:parsed.videos };
        completed.set(entry.id,document);
        manifest.documents = [...completed.values()].sort((a,b) => a.id.localeCompare(b.id));
      } catch (error) { manifest.failures.push({document_id:entry.id,title:entry.title,error:error.message,cause:error.cause?.code}); log(`FAILED ${entry.title}: ${error.message}`); }
      finally { count++; if (count % 10 === 0 || count === fresh.documents.length) { log(`Articles ${count}/${fresh.documents.length}; ready ${completed.size}; unique image URLs ${Object.keys(manifest.assets).length}`); await save(); } }
    });
    await save();
    const collected = await validateSnapshot(stage,manifest,{requireIndex:false,dataDirectory});
    await writeJson(path.join(stage,'coverage.json'),collected);
    if (!collected.complete) throw new Error(`Collection incomplete: ${JSON.stringify(collected).slice(0,5000)}`);
    const outcome = await modelOutcome;
    if (!outcome.ok) throw outcome.error;
    const coverage = await indexBuilder(stage,manifest,save,{dataDirectory});
    const destination = await activateSnapshot(stage,manifest,dataDirectory);
    log(`Activated ${manifest.snapshot_id}: ${coverage.documents} documents / ${coverage.images} image URLs / ${coverage.chunks} chunks / ${coverage.nodes} nodes`);
    return {directory:destination,...coverage};
  } finally { await lock.close(); await fs.unlink(lockPath); }
}
