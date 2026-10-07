import path from 'node:path';
import { DATA } from './paths.mjs';
import { fetchCatalogs, compareCatalogs } from './catalog.mjs';
import { readJson, writeJson, exists } from './io.mjs';

export function beijingDay(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
}
export async function inspectUpdate(manifest, { dataDirectory = DATA, fetcher = fetchCatalogs, now = new Date() } = {}) {
  const file = path.join(dataDirectory,process.env.MILIASTRA_OFFLINE==='1'?'update-check-offline.json':'update-check.json');
  const day = beijingDay(now);
  const prior = await exists(file) ? await readJson(file).catch(() => null) : null;
  if (prior?.day === day && prior.snapshot_id === manifest.snapshot_id) return prior;
  let result;
  try {
    const fresh = await fetcher();
    const delta = compareCatalogs(manifest.expected_documents,fresh.documents);
    result = { day,snapshot_id:manifest.snapshot_id,checked_at:now.toISOString(),status:delta.has_changes?'updates_available':'up_to_date',
      added:delta.added.map(({id,title})=>({id,title})),changed:delta.changed.map(({id,title})=>({id,title})),removed:delta.removed.map(({id,title})=>({id,title})),
      notice:delta.has_changes?'官方目录有变化。当前快照继续可用；用户明确要求更新后运行本地 sync 命令。':'官方目录与当前快照一致；仅对比目录元数据，未替换正文或图片。' };
  } catch(error) { result = {day,snapshot_id:manifest.snapshot_id,checked_at:now.toISOString(),status:'check_failed',error:error.message,notice:'更新检查暂时失败，当前本地资料仍可查询。'}; }
  await writeJson(file,result).catch((error)=>{result.cache_warning=error.message;});
  return result;
}

export class UpdateNotifier {
  constructor(manifest,options={}) { this.manifest=manifest; this.options=options; this.sent=new Set(); this.pending=null; }
  async notification() {
    const day=beijingDay(this.options.now || new Date());
    if (this.sent.has(day)) return undefined;
    this.pending ||= inspectUpdate(this.manifest,this.options).finally(()=>{this.pending=null;});
    const result=await this.pending;
    if (this.sent.has(day)) return undefined;
    return result;
  }
  delivered(result) { if (result) this.sent.add(result.day); }
}
