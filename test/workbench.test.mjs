import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectInit, projectPlan, projectCheckpoint, projectContext, projectHandoff, projectFile } from '../runtime/workbench/project.mjs';
import { validateLayout, previewHtml, saveLayoutPreview } from '../runtime/workbench/layout.mjs';
import { readProject } from '../plugin/skills/qx-plan/scripts/project-db.mjs';
const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const scratch = path.join(root, '.local/workbench-tests');
fs.mkdirSync(scratch, { recursive: true });
const fresh = () => fs.mkdtempSync(path.join(scratch, 'run-'));
const example = () => JSON.parse(fs.readFileSync(path.join(root, 'examples/layout.json'), 'utf8'));
const stage = (id, depends_on = []) => ({ id, title: id, goal: '验证按钮行为', skills: ['qx-ui'], depends_on, steps: ['试玩'], deliverables: ['ui.lua'], acceptance: ['点击只执行一次'], unknowns: [], fallback: '', sources: [] });
function plan(root, stages = [stage('P2')]) {
  projectInit(root, '试用', false);
  projectPlan(root, { expected_revision: 0, summary: '计划', goal: '收集玩法', basis: { origin: 'goal', text: '原创测试需求' }, stages });
}
const check = (method = 'editor_playtest') => [{ criterion: '点击只执行一次', result: 'passed', method, evidence: '隔离测试模拟记录，不代表真实关卡证据' }];

test('接续上下文在未初始化时只读，交接不发送消息', () => {
  const project = fresh();
  assert.equal(projectContext(project).initialized, false);
  assert.deepEqual(fs.readdirSync(project), []);
  plan(project);
  const result = projectHandoff(project, 'P2');
  assert.equal(result.sent_to_other_chat, false);
  assert.match(result.resume_prompt, /project_context/);
  assert.equal(readProject(project).state.revision, 1);
});

test('结构校验定位父子循环、缺父级、错误坐标和依赖引用', () => {
  const layout = example();
  assert.equal(validateLayout(layout).valid, true);
  layout.controls[0].parent = 'HUD';
  assert.ok(validateLayout(layout).errors.some(error => error.code === 'parent_cycle'));
  layout.controls[0].parent = null;
  layout.controls[1].parent = 'Missing';
  assert.ok(validateLayout(layout).errors.some(error => error.code === 'missing_parent'));
  layout.controls[1].parent = 'Root';
  layout.controls[1].position.space = 'canvas';
  assert.ok(validateLayout(layout).errors.some(error => error.code === 'coordinate'));
  layout.controls[1].position.space = 'parent-center';
  layout.dependencies.push({ from: 'Help', to: 'NotAControl', kind: 'event', description: '错误引用' });
  assert.ok(validateLayout(layout).errors.some(error => error.code === 'dependency'));
});

test('各设备位置可计算，隐藏父级影响子级，不把透明度当交互隔离', () => {
  const result = validateLayout(example());
  const pc = result.devices.find(device => device.device === 'pc').rectangles;
  assert.equal(pc.find(control => control.id === 'Help').center_x, 1045);
  assert.equal(pc.find(control => control.id === 'Close').active, false);
  assert.equal(result.editor_verified, false);
  assert.ok(result.warnings.some(warning => warning.code === 'provenance'));
  const touch = result.devices.find(device => device.device === 'touch').rectangles;
  assert.equal(touch.find(control => control.id === 'Help').height, 80);
});

test('畸形输入返回结构错误；不会冒充已验证引擎或遗漏重叠警告', () => {
  for (const controls of [[null], [5], [{ id: 'a' }]]) {
    assert.equal(validateLayout({ schema_version: 1, title: '坏数据', controls }).valid, false);
  }
  const layout = example();
  const twin = structuredClone(layout.controls.find(control => control.id === 'Help'));
  twin.id = 'HelpTwin'; twin.name = 'HelpTwin'; layout.controls.push(twin);
  assert.ok(validateLayout(layout).warnings.some(warning => warning.code === 'interactive_overlap'));
});

test('HTML 文本安全且无外部资源，设备与隐藏切换可供检查', () => {
  const layout = example();
  layout.title = '</script><img src=x onerror=alert(1)>';
  const html = previewHtml(layout);
  assert.ok(!html.includes('</script><img src=x'));
  assert.ok(!/<script[^>]+src=|<link[^>]+href=|<img[^>]+src=/i.test(html));
  assert.match(html, /device/); assert.match(html, /control\[hidden\]/);
});

test('预览创建可追溯合同与HTML并原子登记，错误布局不改数据库', () => {
  const project = fresh(); plan(project);
  const broken = example(); broken.controls[1].parent = 'Missing';
  assert.equal(saveLayoutPreview(project, 'P2', 1, broken).committed, false);
  assert.equal(readProject(project).state.revision, 1);
  const result = saveLayoutPreview(project, 'P2', 1, example());
  assert.equal(result.revision, 2);
  assert.ok(fs.existsSync(result.preview_path));
  const state = readProject(project).state.stages[0];
  assert.equal(state.status, 'planned');
  assert.equal(state.artifact_hashes.length, 2);
  assert.equal(projectContext(project).stages[0].artifacts[0].state, 'unchanged');
});

test('产物内容漂移使本段与依赖段有效状态需重验，只读不篡改记录', () => {
  const project = fresh(); plan(project, [stage('P1'), stage('P2', ['P1'])]);
  fs.writeFileSync(path.join(project, 'ui.lua'), 'before');
  projectCheckpoint(project, { expected_revision: 1, stage_id: 'P1', status: 'verified', summary: '模拟验收', artifacts: ['ui.lua'], checks: check() });
  projectCheckpoint(project, { expected_revision: 2, stage_id: 'P2', status: 'verified', summary: '模拟验收', checks: check() });
  fs.writeFileSync(path.join(project, 'ui.lua'), 'changed');
  const context = projectContext(project, { stageId: 'P2' });
  assert.equal(context.stages[0].effective_status, 'needs_verification');
  assert.equal(context.stages[0].recorded_status, 'verified');
  assert.equal(context.stages[0].can_implement, false);
  assert.equal(readProject(project).state.revision, 3);
  assert.throws(() => projectCheckpoint(project, { expected_revision: 3, stage_id: 'P2', status: 'verified', summary: '复验', checks: check() }), /依赖未验证/);
});

test('静态检查不通过运行验收；纯设计阶段可以明示 static', () => {
  const project = fresh(); plan(project);
  assert.throws(() => projectCheckpoint(project, { expected_revision: 1, stage_id: 'P2', status: 'verified', summary: '仅检查代码', checks: check('static_check') }), /编辑器试玩/);
  const spec = stage('P2'); spec.acceptance_modes = { '点击只执行一次': 'static' };
  projectPlan(project, { expected_revision: 1, summary: '测试专用结构验收', stages: [spec] });
  projectCheckpoint(project, { expected_revision: 2, stage_id: 'P2', status: 'verified', summary: '模拟静态检查', checks: check('static_check') });
  assert.equal(readProject(project).state.revision, 3);
});

test('产物逃逸、缺失和旧revision拒绝写入，原库保持可用', () => {
  const project = fresh(); plan(project);
  assert.throws(() => projectFile(project, '../outside.lua'), /本项目/);
  assert.throws(() => projectCheckpoint(project, { expected_revision: 1, stage_id: 'P2', summary: '越界', artifacts: ['../outside.lua'] }), /本项目/);
  assert.throws(() => projectCheckpoint(project, { expected_revision: 1, stage_id: 'P2', status: 'verified', summary: '缺产物', artifacts: ['missing.lua'], checks: check() }), /缺失/);
  assert.throws(() => projectCheckpoint(project, { expected_revision: 0, stage_id: 'P2', summary: '冲突' }), /版本冲突/);
  assert.equal(readProject(project).state.revision, 1);
});

test('预览事务竞争保留待登记文件，旧库与另一提交仍可用', () => {
  const project = fresh(); plan(project);
  const write = fs.writeFileSync;
  let raced = false;
  fs.writeFileSync = function(file, ...args) {
    const result = write.call(this, file, ...args);
    if (!raced && String(file).endsWith('.html')) {
      raced = true;
      projectCheckpoint(project, { expected_revision: 1, stage_id: 'P2', summary: '另一提交', next_action: '保留并行任务结果' });
    }
    return result;
  };
  let result;
  try { result = saveLayoutPreview(project, 'P2', 1, example()); }
  finally { fs.writeFileSync = write; }
  assert.equal(result.committed, false);
  assert.equal(result.pending_artifacts.length, 2);
  assert.ok(fs.existsSync(result.preview_path));
  assert.equal(readProject(project).state.revision, 2);
  assert.equal(readProject(project).state.stages[0].next_action, '保留并行任务结果');
  projectCheckpoint(project, { expected_revision: 2, stage_id: 'P2', summary: '合并待登记产物', artifacts: result.pending_artifacts });
  assert.equal(projectContext(project).stages[0].artifacts[0].state, 'unchanged');
});

test('缺少目标阶段不生成文件，畸形设备和覆盖返回错误', () => {
  const project = fresh(); plan(project);
  const layout = example(); layout.stage_id = 'Missing';
  assert.throws(() => saveLayoutPreview(project, 'Missing', 1, layout), /阶段/);
  assert.ok(!fs.existsSync(path.join(project, '.miliastra/layouts')));
  const malformed = example(); malformed.canvas.devices = [null];
  assert.equal(validateLayout(malformed).valid, false);
});
