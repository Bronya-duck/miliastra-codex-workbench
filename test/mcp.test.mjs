import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '../runtime/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from '../runtime/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';
const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const scratch = path.join(root, '.local/mcp-tests');
fs.mkdirSync(scratch, { recursive: true });

test('真实 stdio MCP 暴露14个工具，空知识库仍可完成计划、预览和接续', async t => {
  const project = fs.mkdtempSync(path.join(scratch, 'run-'));
  const client = new Client({ name: 'workbench-integration-test', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'runtime/server.mjs')],
    cwd: path.join(root, 'runtime'), env: { ...process.env, MILIASTRA_DATA_DIR: path.join(project, 'empty-knowledge') }, stderr: 'pipe' });
  t.after(() => client.close());
  await client.connect(transport);
  const list = await client.listTools();
  assert.equal(list.tools.length, 14);
  assert.equal(list.tools.find(tool => tool.name === 'project_context').annotations.readOnlyHint, true);
  assert.equal(list.tools.find(tool => tool.name === 'layout_preview').annotations.readOnlyHint, false);
  const invoke = async (name, args) => {
    const response = await client.callTool({ name, arguments: args });
    assert.ok(!response.isError, JSON.stringify(response));
    return JSON.parse(response.content[0].text).result;
  };
  assert.equal((await invoke('project_init', { project_root: project, name: '隔离测试' })).created, true);
  assert.equal((await invoke('project_context', { project_root: project })).revision, 0);
  await invoke('project_plan', { project_root: project, input: { expected_revision: 0, summary: '隔离设计计划', goal: '界面设计', basis: { origin: 'goal', text: '原创隔离界面需求' }, stages: [{
    id: 'P2', title: '界面', goal: '布局结构', steps: ['生成合同'], depends_on: [], skills: ['qx-ui'],
    deliverables: ['合同'], acceptance: ['结构有效'], acceptance_modes: { '结构有效': 'static' }, unknowns: [], sources: [], fallback: '',
  }] } });
  const layout = JSON.parse(fs.readFileSync(path.join(root, 'examples/layout.json'), 'utf8'));
  assert.equal((await invoke('layout_validate', { layout })).valid, true);
  const preview = await invoke('layout_preview', { project_root: project, stage_id: 'P2', expected_revision: 1, layout });
  assert.equal(preview.revision, 2); assert.ok(fs.existsSync(preview.preview_path));
  const checkpoint = await invoke('project_checkpoint', { project_root: project, input: { expected_revision: 2, stage_id: 'P2', status: 'verified', summary: '实际结构检查，未运行编辑器',
    checks: [{ criterion: '结构有效', result: 'passed', method: 'static_check', evidence: 'layout_validate 与保存合同通过结构校验' }] } });
  assert.equal(checkpoint.revision, 3);
  const handoff = await invoke('project_handoff', { project_root: project, stage_id: 'P2' });
  assert.equal(handoff.sent_to_other_chat, false);
  const unavailable = await client.callTool({ name: 'list_documents', arguments: {} });
  assert.equal(unavailable.isError, true);
  assert.equal((await invoke('project_context', { project_root: project })).revision, 3);
});
