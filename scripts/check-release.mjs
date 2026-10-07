import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const repositoryRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const roots = ['plugin', 'runtime', 'scripts', 'test', 'docs', 'examples', '.agents/plugins', '.github/workflows'];
const files = ['README.md', 'AGENTS.md', 'LICENSE', 'NOTICE.md', 'CONTRIBUTING.md', 'SECURITY.md', 'package.json', 'package-lock.json', 'cli.mjs', '.gitignore', '.gitattributes'];
const excluded = new Set(['node_modules', 'data', '.local', 'dist', 'reports', '.git', '.miliastra']);
const allowed = /\.(mjs|json|md|yaml|yml|example)$/;
const forbidden = /\.(sqlite(?:-wal|-shm)?|onnx|log|env)$/i;
export function checkRelease(root = repositoryRoot) {
  const included = [], issues = [];
  function visit(relative) {
    if (relative === 'plugin/.mcp.json' || relative.split('/').some(part => excluded.has(part))) return;
    const location = path.join(root, relative);
    if (!fs.existsSync(location)) return;
    const stat = fs.lstatSync(location);
    if (stat.isSymbolicLink()) { issues.push('发布源不允许链接：' + relative); return; }
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(location).sort()) visit(relative + '/' + entry);
      return;
    }
    if (forbidden.test(relative) || path.basename(relative).startsWith('.env')) { issues.push('私有文件位于发布目录：' + relative); return; }
    if (!allowed.test(relative) && !files.includes(relative)) { issues.push('未识别发布文件类型：' + relative); return; }
    const bytes = fs.readFileSync(location);
    const content = bytes.toString('utf8');
    if (/[CD]:[\\/]+(?:Users|GenshinBase|node1)(?:[\\/]|\b)/i.test(content)) issues.push('发现机器路径：' + relative);
    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bgh[pousr]_[A-Za-z0-9]{30,}\b|\bsk-[A-Za-z0-9]{30,}\b/.test(content)) issues.push('疑似凭据：' + relative);
    included.push({ file: relative, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  for (const relative of [...files, ...roots]) visit(relative);
  for (const required of [...files, 'plugin/.mcp.json.example', 'plugin/.codex-plugin/plugin.json', '.agents/plugins/marketplace.json']) if (!included.some(item => item.file === required)) issues.push('缺少交付文件：' + required);
  for (const name of ['qx-plan', 'qx-docs', 'qx-build', 'qx-ui', 'qx-lua', 'qx-debug']) for (const suffix of ['SKILL.md', 'agents/openai.yaml']) {
    if (!included.some(item => item.file === 'plugin/skills/' + name + '/' + suffix)) issues.push('技能文件缺失：' + name + '/' + suffix);
  }
  for (const name of ['package.json', 'runtime/package.json']) {
    const location = path.join(root, name);
    if (!fs.existsSync(location)) continue;
    const pkg = JSON.parse(fs.readFileSync(location, 'utf8'));
    const lock = JSON.parse(fs.readFileSync(path.join(path.dirname(location), 'package-lock.json'), 'utf8'));
    const dependencies = value => JSON.stringify(Object.entries(value || {}).sort(([a], [b]) => a.localeCompare(b)));
    if (pkg.name !== lock.name || pkg.version !== lock.version || dependencies(pkg.dependencies) !== dependencies(lock.packages[''].dependencies)) issues.push('锁文件与包不一致：' + name);
  }
  return { passed: issues.length === 0, issues, file_count: included.length, total_bytes: included.reduce((sum, item) => sum + item.bytes, 0), files: included.sort((a,b) => a.file.localeCompare(b.file)), excluded: [...excluded, 'plugin/.mcp.json'] };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = checkRelease();
    console.log(JSON.stringify(process.argv.includes('--list') ? result : { ...result, files: undefined }, null, 2));
    if (!result.passed) process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
