import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { checkRelease, repositoryRoot } from '../scripts/check-release.mjs';

test('发布清单只含源码，私有配置与数据库不导出，发布目录泄露会拒绝', () => {
  const baseline = checkRelease();
  assert.equal(baseline.passed, true, baseline.issues.join('\n'));
  assert.ok(!baseline.files.some(item => /node_modules|\.miliastra|\.mcp\.json$|\.sqlite|\.onnx/.test(item.file)));
  const base = path.join(repositoryRoot, '.local/release-tests');
  fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, 'run-'));
  for (const item of baseline.files) {
    const target = path.join(root, item.file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(repositoryRoot, item.file), target);
  }
  fs.writeFileSync(path.join(root, 'plugin/.mcp.json'), 'private machine configuration');
  fs.mkdirSync(path.join(root, 'data'), { recursive: true });
  fs.writeFileSync(path.join(root, 'data/private.sqlite'), 'private');
  assert.equal(checkRelease(root).passed, true);
  fs.writeFileSync(path.join(root, 'plugin/private.sqlite'), 'must reject');
  assert.ok(checkRelease(root).issues.some(item => item.includes('私有文件')));
  fs.writeFileSync(path.join(root, 'docs/accidental.md'), ['C:', '\\', 'Users', '\\', 'Person'].join(''));
  assert.ok(checkRelease(root).issues.some(item => item.includes('机器路径')));
});
