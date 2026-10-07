import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';

let networkConfigured = false;
function configureNetwork() {
  if (networkConfigured) return;
  networkConfigured = true;
  if (process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy) setGlobalDispatcher(new EnvHttpProxyAgent());
}

export const hash = (value) => createHash('sha256').update(value).digest('hex');
export async function readJson(file) { return JSON.parse(await fs.readFile(file, 'utf8')); }
export async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(value, null, 2) + '\n');
  await fs.rename(temporary, file);
}
export async function exists(file) { try { await fs.access(file); return true; } catch { return false; } }
export async function fetchBytes(url, { timeoutMs = 45000, retries = 3 } = {}) {
  if (process.env.MILIASTRA_OFFLINE === '1') throw new Error('Network disabled for offline verification');
  configureNetwork();
  let lastError;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { 'User-Agent': 'MiliastraPersonalKnowledge/0.1', Accept: '*/*' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length) throw new Error(`Empty response: ${url}`);
      return { bytes, type: response.headers.get('content-type') || '', etag: response.headers.get('etag'), modified: response.headers.get('last-modified') };
    } catch (error) {
      lastError = error;
      if (attempt + 1 < retries) await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    }
  }
  throw lastError;
}
export async function pool(items, concurrency, work) {
  let cursor = 0;
  return await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await work(items[index], index);
    }
  }));
}
export function inside(directory, relative) {
  const resolved = path.resolve(directory, relative);
  if (resolved !== path.resolve(directory) && !resolved.startsWith(path.resolve(directory) + path.sep)) throw new Error('Path escapes knowledge directory');
  return resolved;
}
