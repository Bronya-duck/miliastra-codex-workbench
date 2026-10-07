import fs from 'node:fs';
import path from 'node:path';
import { checkRelease, repositoryRoot } from './check-release.mjs';
const result = checkRelease();
if (!result.passed) throw new Error('发布检查未通过：' + result.issues.join('; '));
const pkg = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8'));
const output = path.join(repositoryRoot, 'dist', pkg.name + '-' + pkg.version + '-' + Date.now());
fs.mkdirSync(output, { recursive: true });
for (const item of result.files) {
  const destination = path.join(output, item.file);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(path.join(repositoryRoot, item.file), destination, fs.constants.COPYFILE_EXCL);
}
fs.writeFileSync(path.join(output, 'SOURCE-MANIFEST.json'), JSON.stringify({ version: pkg.version, exported_at: new Date().toISOString(), ...result }, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ exported: true, path: output, files: result.file_count, bytes: result.total_bytes }));
