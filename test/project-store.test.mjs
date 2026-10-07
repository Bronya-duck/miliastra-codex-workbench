import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initialize, readProject, savePlan, recordStage, bindProject, refreshSummary } from '../plugin/skills/qx-plan/scripts/project-db.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.local/project-db-tests');
fs.mkdirSync(root, { recursive: true });
const suite = fs.mkdtempSync(path.join(root, 'run-'));
const makeProject = name => { const directory = path.join(suite, name); fs.mkdirSync(directory); return directory; };
const stage = (id = 'P1', depends_on = []) => ({ id, title: `阶段 ${id}`, goal: '按钮点击驱动计数', skills: ['qx-lua'], depends_on, steps: ['保存脚本', '试玩'], deliverables: ['button.lua'], acceptance: ['点击一次计数加一', '退出无报错'], unknowns: ['尚未试玩'], fallback: '人工挂载脚本', sources: [] });
const plan = (revision = 0, stages = [stage()]) => ({ expected_revision: revision, summary: '根据用户计划细分', goal: '双人合作收集', basis: { origin: 'user_plan', text: '1. 点击收集\n2. 双人协作' }, stages });
// Synthetic evidence exercises state transitions, not a claim of actual gameplay.
const pass = (revision, id = 'P1') => ({ expected_revision: revision, stage_id: id, status: 'verified', summary: '模拟编辑器实测记录', checks: [{ criterion: '点击一次计数加一', result: 'passed', method: 'editor_playtest', evidence: '模拟观察记录：点击三次分别显示 1、2、3' }, { criterion: '退出无报错', result: 'passed', method: 'editor_playtest', evidence: '模拟退出观察及 test.log' }] });

test('只读查询不存在的库不会创建任何文件', () => {
  const project = makeProject('read-only');
  assert.equal(readProject(project).initialized, false);
  assert.deepEqual(fs.readdirSync(project), []);
});

test('初始化幂等，项目相互隔离，原计划持久保留', () => {
  const a = makeProject('project-a'), b = makeProject('project-b');
  initialize(a, '收集玩法'); initialize(b, '生存玩法');
  savePlan(a, plan());
  assert.equal(initialize(a, '新的名字').created, false);
  const state = readProject(a).state;
  assert.equal(state.project_name, '收集玩法');
  assert.equal(state.revision, 1);
  assert.equal(state.bases[0].text, '1. 点击收集\n2. 双人协作');
  assert.equal(state.stages[0].status, 'planned');
  assert.equal(readProject(b).state.stages.length, 0);
  assert.notEqual(state.project_id, readProject(b).state.project_id);
});

test('编写代码和部分测试不能标记整个阶段已验证，拒绝写入不改变库', () => {
  const project = makeProject('verification'); initialize(project); savePlan(project, plan());
  recordStage(project, { expected_revision: 1, stage_id: 'P1', status: 'needs_verification', summary: '代码已保存，尚未试玩', artifacts: ['button.lua'], checks: [{ criterion: '点击一次计数加一', result: 'not_run', evidence: '尚未试玩' }] });
  const before = readProject(project);
  assert.throws(() => recordStage(project, { expected_revision: 2, stage_id: 'P1', status: 'verified', summary: '写完代码即完成' }), /通过证据/);
  assert.throws(() => recordStage(project, { ...pass(2), checks: pass(2).checks.slice(0, 1) }), /通过证据/);
  assert.deepEqual(readProject(project), before);
  recordStage(project, pass(2));
  assert.equal(readProject(project).state.stages[0].status, 'verified');
});

test('旧 revision 和未知阶段被拒绝，失败原因保留在记录中', () => {
  const project = makeProject('conflict'); initialize(project); savePlan(project, plan());
  recordStage(project, { expected_revision: 1, stage_id: 'P1', status: 'blocked', summary: '脚本未映射，试玩无响应', findings: [{ statement: '本次未完成映射', basis: 'failed', reference: '用户提供的测试截图' }], next_action: '完成映射后复测' });
  assert.throws(() => recordStage(project, pass(1)), /版本冲突/);
  assert.throws(() => recordStage(project, { expected_revision: 2, stage_id: 'missing', summary: '结果' }), /不存在阶段/);
  const state = readProject(project).state;
  assert.equal(state.revision, 2);
  assert.equal(state.stages[0].status, 'blocked');
  assert.match(readProject(project, { stageId: 'P1' }).events.find(event => event.kind === 'record').payload.summary, /未映射/);
});

test('未验证的前置阶段不能推进；重新修改前置产物会撤回依赖验证', () => {
  const project = makeProject('dependencies'); initialize(project); savePlan(project, plan(0, [stage('P1'), stage('P2', ['P1'])]));
  assert.throws(() => recordStage(project, { expected_revision: 1, stage_id: 'P2', status: 'in_progress', summary: '继续下一段' }), /依赖阶段/);
  recordStage(project, pass(1, 'P1')); recordStage(project, pass(2, 'P2'));
  recordStage(project, { expected_revision: 3, stage_id: 'P1', changes_made: true, status: 'needs_verification', summary: '修改按钮代码，需要复测' });
  const state = readProject(project).state;
  assert.equal(state.stages[0].status, 'needs_verification');
  assert.equal(state.stages[1].status, 'needs_verification');
  assert.deepEqual(state.stages[1].checks, []);
  assert.match(state.stages[1].next_action, /前置阶段/);
  assert.equal(readProject(project, { stageId: 'P2' }).events.find(event => event.kind === 'record').payload.status, 'verified');
});

test('重规划合并旧段，修改验收使历史完成状态重新待验证', () => {
  const project = makeProject('replan'); initialize(project); savePlan(project, plan(0, [stage('P1'), stage('P2', ['P1'])]));
  recordStage(project, pass(1));
  const revised = stage(); revised.acceptance.push('支持重复开启界面');
  savePlan(project, { expected_revision: 2, summary: '按用户新增要求扩展验收', basis: { origin: 'revision', text: '支持重复开启界面' }, stages: [revised] });
  const state = readProject(project).state;
  assert.equal(state.stages.length, 2);
  assert.equal(state.stages[0].status, 'needs_verification');
  assert.equal(state.bases.length, 2);
  assert.equal(state.bases[0].text, '1. 点击收集\n2. 双人协作');
  assert.equal(readProject(project, { stageId: 'P1' }).events.filter(event => event.kind === 'plan').length, 2);
});

test('补充资料保留原有验证；修改产物不能复用旧验证', () => {
  const project = makeProject('recorded-evidence'); initialize(project); savePlan(project, plan());
  recordStage(project, pass(1));
  recordStage(project, { expected_revision: 2, stage_id: 'P1', summary: '补充官方接口说明', findings: [{ statement: '控件可设置位置', basis: 'official', reference: 'API 文档与当前快照' }] });
  assert.equal(readProject(project).state.stages[0].status, 'verified');
  assert.throws(() => recordStage(project, { expected_revision: 3, stage_id: 'P1', changes_made: true, status: 'verified', summary: '代码改过但未复测' }), /通过证据/);
  recordStage(project, { expected_revision: 3, stage_id: 'P1', changes_made: true, summary: '已修改代码，未复测' });
  assert.equal(readProject(project).state.stages[0].status, 'needs_verification');
  assert.deepEqual(readProject(project).state.stages[0].checks, []);
});

test('循环、重复 ID、未知依赖和缺少原始计划均不落库', () => {
  const project = makeProject('invalid-plans'); initialize(project);
  assert.throws(() => savePlan(project, plan(0, [stage('P1', ['P2']), stage('P2', ['P1'])])), /循环/);
  assert.throws(() => savePlan(project, plan(0, [stage('P1'), stage('P1')])), /重复/);
  assert.throws(() => savePlan(project, plan(0, [stage('P1', ['P9'])])), /不存在/);
  assert.throws(() => savePlan(project, { expected_revision: 0, summary: '计划', stages: [stage()] }), /总目标/);
  assert.equal(readProject(project).state.revision, 0);
  assert.equal(readProject(project).total_events, 1);
});

test('绑定保留既有项目指引，不重复追加，并支持 AGENTS.override.md', () => {
  const project = makeProject('binding'); initialize(project);
  const file = path.join(project, 'AGENTS.override.md');
  fs.writeFileSync(file, '# 原有规则\n\n只读现有场景。\n', 'utf8');
  assert.equal(bindProject(project).changed, true);
  assert.equal(bindProject(project).changed, false);
  const content = fs.readFileSync(file, 'utf8');
  assert.ok(content.startsWith('# 原有规则\n\n只读现有场景。\n'));
  assert.equal(content.match(/miliastra-project:start/g).length, 1);
  assert.equal(fs.existsSync(path.join(project, 'AGENTS.md')), false);
});

test('SQLite 是唯一状态来源，摘要丢失可重建', () => {
  const project = makeProject('summary'); initialize(project); savePlan(project, plan());
  const output = path.join(project, '.miliastra', 'PROGRESS.md');
  fs.unlinkSync(output);
  assert.equal(readProject(project).state.revision, 1);
  assert.equal(refreshSummary(project).refreshed, true);
  assert.match(fs.readFileSync(output, 'utf8'), /已规划/);
  assert.match(fs.readFileSync(output, 'utf8'), /1\. 点击收集/);
});

test('旧版绑定只升级所属块，保留前后规则并保持幂等', () => {
  const project = makeProject('binding-upgrade'); initialize(project);
  const file = path.join(project, 'AGENTS.md');
  const prefix = '# 个人规则\r\n不要移动既有控件。\r\n\r\n';
  const suffix = '\r\n\r\n## 其它项目规范\r\n保留原编号。\r\n';
  fs.writeFileSync(file, `${prefix}<!-- miliastra-project:start -->\n旧版 qx-build / qx-lua 指引\n<!-- miliastra-project:end -->${suffix}`, 'utf8');
  assert.equal(bindProject(project).changed, true);
  const content = fs.readFileSync(file, 'utf8');
  assert.ok(content.startsWith(prefix)); assert.ok(content.endsWith(suffix));
  assert.match(content, /qx-ui/);
  assert.equal(bindProject(project).changed, false);
  assert.equal(readProject(project).state.revision, 0);
});

test('异常绑定标记拒绝覆盖原文件', () => {
  const project = makeProject('binding-invalid'); initialize(project);
  const file = path.join(project, 'AGENTS.md');
  for (const content of [
    '<!-- miliastra-project:start -->不完整',
    '<!-- miliastra-project:end --><!-- miliastra-project:start -->',
    '<!-- miliastra-project:start --><!-- miliastra-project:end --><!-- miliastra-project:start --><!-- miliastra-project:end -->',
  ]) {
    fs.writeFileSync(file, content, 'utf8');
    assert.throws(() => bindProject(project), /指引块/);
    assert.equal(fs.readFileSync(file, 'utf8'), content);
  }
});

test('界面阶段与布局产物可跨读取复用，修改后重验且保留旧版本', () => {
  const project = makeProject('ui-contract'); initialize(project);
  const uiStage = { ...stage(), skills: ['qx-build', 'qx-ui', 'qx-lua'] };
  savePlan(project, plan(0, [uiStage]));
  const source = { document_id: 'mhnapxrumtzy', snapshot_id: 'test-snapshot', image_ids: ['test-image'] };
  recordStage(project, { expected_revision: 1, stage_id: 'P1', summary: '布局设计已保存，未试玩', artifacts: ['button.lua', '.miliastra/layouts/P1/layout-r2.md'], sources: [source] });
  const first = readProject(project, { stageId: 'P1' }).state.stages[0];
  assert.deepEqual(first.skills, ['qx-build', 'qx-ui', 'qx-lua']);
  assert.equal(first.status, 'planned'); assert.deepEqual(first.sources, [source]);
  recordStage(project, pass(2));
  recordStage(project, { expected_revision: 3, stage_id: 'P1', changes_made: true, summary: '调整布局方案，待重验', artifacts: [...first.artifacts, '.miliastra/layouts/P1/layout-r4.md'] });
  const after = readProject(project, { stageId: 'P1', history: true });
  assert.equal(after.state.stages[0].status, 'needs_verification');
  assert.deepEqual(after.state.stages[0].artifacts, ['button.lua', '.miliastra/layouts/P1/layout-r2.md', '.miliastra/layouts/P1/layout-r4.md']);
  assert.deepEqual(after.events.find(event => event.revision === 2).payload.artifacts, first.artifacts);
});

test.after(() => { console.log(`独立测试项目保留于 ${suite}`); });
