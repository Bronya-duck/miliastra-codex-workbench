import path from 'node:path';
import { promises as fs } from 'node:fs';
import { DATA, MODEL_DIR } from './paths.mjs';
import { readJson } from './io.mjs';
import { syncKnowledge, prepareModel, validateSnapshot } from './sync.mjs';

try {
  const command = process.argv[2];
  if (command === 'setup' || command === 'sync') console.log(JSON.stringify(await syncKnowledge({prepare:true}),null,2));
  else if (command === 'reindex') console.log(JSON.stringify(await (await import('./reindex.mjs')).reindex(),null,2));
  else if (command === 'model') await prepareModel();
  else if (command === 'doctor') {
    const pointer = await readJson(path.join(DATA,'active.json'));
    const directory = path.resolve(DATA,pointer.directory);
    const manifest = await readJson(path.join(directory,'manifest.json'));
    const report = await validateSnapshot(directory,manifest);
    const model = await readJson(path.join(MODEL_DIR,'manifest.json'));
    for (const entry of model.files) {
      const {hash} = await import('./io.mjs');
      if (hash(await fs.readFile(path.join(MODEL_DIR,entry.file))) !== entry.sha256) report.issues.push(`Model file hash mismatch ${entry.file}`);
    }
    report.complete &&= report.issues.length === 0;
    console.log(JSON.stringify({...report,snapshot_id:pointer.snapshot_id,node:process.version,model_revision:model.revision},null,2));
    if (!report.complete) process.exitCode=1;
  } else throw new Error('Usage: node cli.mjs setup | sync | reindex | model | doctor');
} catch(error) { console.error(error.stack); process.exitCode=1; }
