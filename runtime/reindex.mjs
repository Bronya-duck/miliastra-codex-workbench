import { promises as fs } from 'node:fs';
import path from 'node:path';
import { DATA } from './paths.mjs';
import { readJson,writeJson,hash,inside } from './io.mjs';
import { parseOfficialHtml,localMarkdown } from './documents.mjs';
import { buildSnapshotIndex,activateSnapshot } from './sync.mjs';

// Rebuild derived files from existing raw HTML. Never fetch official sources.
export async function reindex() {
  const lockPath=path.join(DATA,'sync.lock');
  const lock=await fs.open(lockPath,'wx').catch(()=>{throw new Error('A sync/reindex lock already exists');});
  await lock.writeFile(JSON.stringify({pid:process.pid,started_at:new Date().toISOString()}));
  try {
    const pointer=await readJson(path.join(DATA,'active.json'));
    const current=inside(DATA,pointer.directory);
    const manifest=await readJson(path.join(current,'manifest.json'));
    manifest.snapshot_id=new Date().toISOString().replace(/[-:.]/g,'').replace('Z','')+'-'+manifest.catalog_fingerprint.slice(0,8);
    manifest.rebuilt_from=pointer.snapshot_id;manifest.status='collecting';manifest.failures=[];
    const stage=path.join(DATA,'staging',manifest.snapshot_id);
    await fs.cp(current,stage,{recursive:true});
    await writeJson(path.join(stage,'manifest.json'),manifest);
    for(const doc of manifest.documents) {
      const raw=await fs.readFile(path.join(stage,doc.html_path),'utf8');
      const parsed=parseOfficialHtml(raw,doc,doc.html_url);
      const markdown=localMarkdown(parsed,doc,manifest.assets,DATA);
      await fs.writeFile(path.join(stage,doc.body_path),parsed.markdown);
      await fs.writeFile(path.join(stage,doc.markdown_path),markdown);
      doc.body_sha256=hash(parsed.markdown);doc.markdown_sha256=hash(markdown);doc.images=parsed.images;doc.videos=parsed.videos;
    }
    const coverage=await buildSnapshotIndex(stage,manifest);
    return {directory:await activateSnapshot(stage,manifest),...coverage};
  } finally {await lock.close();await fs.unlink(lockPath);}
}
