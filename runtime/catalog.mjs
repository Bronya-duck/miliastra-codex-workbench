import { SOURCES, catalogUrl, officialUrl } from './paths.mjs';
import { fetchBytes, hash } from './io.mjs';

const CLIENT_IDS = new Set(['mhlz2lrly3dq','mh3qqq9xc102','mhv38jig94kk','mhdbkf04v6y8','mh265urgupye','mhd4fxr5v6la','mhfkrr0i7gds','mhucb6reudwm','mhbgxf0nynww','mhtakr07vej4']);
export function enumerateCatalog(items, category, ancestors = []) {
  if (!Array.isArray(items)) throw new Error(`Invalid ${category} catalog`);
  const output = [];
  for (const item of items) {
    const trail = [...ancestors, String(item.title || '')];
    if (item.real_id) {
      const id = String(item.real_id);
      if (!/^mh[a-z0-9]+$/i.test(id)) throw new Error(`Unexpected official document ID: ${id}`);
      output.push({ id, title: String(item.title || id), category, ancestors, updated_at: String(item.updated_at || ''), official_url: officialUrl(category, id), client_lua: CLIENT_IDS.has(id) || /客户端控件|客户端脚本/i.test(trail.join('/')) });
    }
    if (item.children?.length) output.push(...enumerateCatalog(item.children, category, trail));
  }
  return output;
}
export async function fetchCatalogs() {
  const catalogs = await Promise.all(SOURCES.map(async (category) => {
    const { bytes } = await fetchBytes(catalogUrl(category), { timeoutMs: 15000 });
    const raw = JSON.parse(bytes.toString('utf8'));
    return { category, raw, entries: enumerateCatalog(raw, category) };
  }));
  const byId = new Map();
  for (const catalog of catalogs) for (const entry of catalog.entries) {
    const previous = byId.get(entry.id);
    if (previous) {
      previous.catalog_locations.push({ category: entry.category, ancestors: entry.ancestors });
      previous.client_lua ||= entry.client_lua;
    } else byId.set(entry.id, { ...entry, catalog_locations: [{ category: entry.category, ancestors: entry.ancestors }] });
  }
  const documents = [...byId.values()].sort((a,b) => a.id.localeCompare(b.id));
  if (!documents.length) throw new Error('Official catalogs contained no documents');
  return { catalogs, documents, fingerprint: hash(JSON.stringify(documents)) };
}
export function compareCatalogs(before, after) {
  const old = new Map(before.map((entry) => [entry.id, entry]));
  const fresh = new Map(after.map((entry) => [entry.id, entry]));
  const added = after.filter((entry) => !old.has(entry.id));
  const removed = before.filter((entry) => !fresh.has(entry.id));
  const changed = after.filter((entry) => {
    const entryBefore = old.get(entry.id);
    return entryBefore && (entry.updated_at !== entryBefore.updated_at || entry.title !== entryBefore.title || entry.category !== entryBefore.category || JSON.stringify(entry.ancestors) !== JSON.stringify(entryBefore.ancestors));
  });
  return { added, changed, removed, has_changes: Boolean(added.length || changed.length || removed.length) };
}
