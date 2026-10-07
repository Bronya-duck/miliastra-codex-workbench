import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';

const statuses = ['planned', 'in_progress', 'needs_verification', 'blocked', 'verified', 'cancelled'];
const statusNames = { planned: '已规划', in_progress: '制作中', needs_verification: '待验证', blocked: '受阻', verified: '已验证', cancelled: '已取消' };
const skillNames = ['qx-plan', 'qx-docs', 'qx-build', 'qx-lua', 'qx-debug', 'qx-ui'];
const startMarker = '<!-- miliastra-project:start -->';
const endMarker = '<!-- miliastra-project:end -->';
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const now = () => new Date().toISOString();
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const samePath = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;

function strings(value, field) {
  assert(Array.isArray(value) && value.every(nonempty), `${field} 必须是非空字符串组成的数组`);
  return [...new Set(value)];
}

function safeFile(file) {
  if (fs.existsSync(file)) assert(!fs.lstatSync(file).isSymbolicLink(), `拒绝写入或读取符号链接：${file}`);
}

function locations(root) {
  assert(nonempty(root) && path.isAbsolute(root), '--root 必须是已存在项目的绝对目录');
  const resolved = fs.realpathSync(root);
  assert(fs.statSync(resolved).isDirectory(), '项目根路径不是目录');
  const directory = path.join(resolved, '.miliastra');
  if (fs.existsSync(directory)) {
    assert(fs.statSync(directory).isDirectory(), '.miliastra 不是目录');
    assert(samePath(fs.realpathSync(directory), directory), '.miliastra 必须位于本项目中，不能指向其它目录');
  }
  const database = path.join(directory, 'project.sqlite');
  const summary = path.join(directory, 'PROGRESS.md');
  safeFile(database);
  return { root: resolved, directory, database, summary };
}

function open(loc, readOnly = false) {
  const db = new DatabaseSync(loc.database, { readOnly });
  db.exec('PRAGMA busy_timeout = 5000');
  return db;
}

function stateFrom(db, loc) {
  const row = db.prepare('SELECT body FROM project_state WHERE id = 1').get();
  assert(row, '数据库缺少项目状态');
  const state = JSON.parse(row.body);
  assert(state.schema_version === 1, '不支持此项目数据库版本');
  assert(samePath(state.project_root, loc.root), '数据库属于其它项目目录；请先核对项目位置，不能直接写入');
  return state;
}

function historyFrom(db, stageId, all = false) {
  const query = db.prepare(`SELECT * FROM events ORDER BY revision DESC${stageId || all ? '' : ' LIMIT 20'}`).all();
  const events = query.reverse().map(row => ({ revision: row.revision, at: row.at, kind: row.kind, stage_id: row.stage_id, payload: JSON.parse(row.payload) }));
  return stageId ? events.filter(event => event.stage_id === stageId || (event.kind === 'plan' && event.payload.stages?.some(stage => stage.id === stageId))) : events;
}

function atomicText(file, content) {
  safeFile(file);
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, content, { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function renderSummary(state) {
  const lines = [
    `# ${state.project_name} · 千星制作进度`, '',
    '此文件由项目数据库生成；修改数据库后可重新生成。项目记录不替代官方文档。', '',
    `数据库版本：${state.revision}；记录更新时间：${state.updated_at}`, '',
    `目标：${state.goal || '尚未提供总玩法'}`, '',
    '## 当前约束', '', ...state.constraints.map(item => `- ${item}`), '',
    '## 制作阶段', '',
  ];
  for (const stage of state.stages) {
    lines.push(`### ${stage.id} ${stage.title} · ${statusNames[stage.status]}`, '',
      `目标：${stage.goal}`, `依赖：${stage.depends_on.join('、') || '无'}`, '',
      '制作步骤：', '', ...stage.steps.map((item, index) => `${index + 1}. ${item}`), '',
      '验收：', '', ...stage.acceptance.map(item => {
        const check = stage.checks.find(check => check.criterion === item);
        return `- ${check?.result === 'passed' ? '[x]' : '[ ]'} ${item}${check ? `（${check.result}：${check.evidence}）` : ''}`;
      }), '', `实际结果：${stage.summary || '尚未执行'}`, '',
      ...stage.artifacts.map(item => `- 产物：${item}`),
      ...stage.unknowns.map(item => `- 待验证：${item}`),
      ...stage.findings.map(item => `- ${item.basis}：${item.statement}；依据：${item.reference}`),
      ...stage.sources.map(item => `- 官方资料：${JSON.stringify(item)}`), '',
      `替代方案：${stage.fallback || '尚未提出'}`, `下一步：${stage.next_action || '按阶段计划继续'}`, '',
    );
  }
  lines.push('## 用户计划依据', '', ...state.bases.flatMap(basis => [`${basis.origin} · revision ${basis.revision}`, '', basis.text, '']));
  return `${lines.join('\n')}\n`;
}

function summaryResult(loc, state) {
  try { atomicText(loc.summary, renderSummary(state)); return { summary_path: loc.summary }; }
  catch (error) { return { summary_path: loc.summary, summary_error: error.message }; }
}

export function initialize(root, name) {
  const loc = locations(root);
  if (fs.existsSync(loc.database)) return { ...readProject(root), created: false };
  fs.mkdirSync(loc.directory, { recursive: true });
  const db = open(loc);
  let state;
  try {
    db.exec('BEGIN IMMEDIATE');
    db.exec('CREATE TABLE IF NOT EXISTS project_state (id INTEGER PRIMARY KEY CHECK (id = 1), body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS events (revision INTEGER PRIMARY KEY, at TEXT NOT NULL, kind TEXT NOT NULL, stage_id TEXT, payload TEXT NOT NULL)');
    if (db.prepare('SELECT id FROM project_state WHERE id = 1').get()) {
      db.exec('COMMIT');
      return { ...readProject(root), created: false };
    }
    const at = now();
    state = { schema_version: 1, project_id: randomUUID(), project_name: nonempty(name) ? name : path.basename(loc.root), project_root: loc.root, revision: 0, created_at: at, updated_at: at, goal: '', constraints: [], bases: [], stages: [] };
    db.prepare('INSERT INTO project_state VALUES (1, ?)').run(JSON.stringify(state));
    db.prepare('INSERT INTO events VALUES (0, ?, ?, NULL, ?)').run(at, 'init', JSON.stringify({ project_name: state.project_name }));
    db.exec('COMMIT');
  } catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; }
  finally { db.close(); }
  return { initialized: true, created: true, committed: true, database_path: loc.database, revision: 0, ...summaryResult(loc, state) };
}

export function readProject(root, { stageId, history = false } = {}) {
  const loc = locations(root);
  if (!fs.existsSync(loc.database)) return { initialized: false, database_path: loc.database };
  const db = open(loc, true);
  try {
    const state = stateFrom(db, loc);
    if (stageId) assert(state.stages.some(stage => stage.id === stageId), `不存在阶段 ${stageId}`);
    return { initialized: true, database_path: loc.database, summary_path: loc.summary, state: stageId ? { ...state, stages: state.stages.filter(stage => stage.id === stageId) } : state, events: historyFrom(db, stageId, history), total_events: db.prepare('SELECT COUNT(*) AS count FROM events').get().count };
  } finally { db.close(); }
}

function sources(value) {
  assert(Array.isArray(value) && value.every(item => object(item) && nonempty(item.document_id) && nonempty(item.snapshot_id)), 'sources 的每项须有 document_id 与 snapshot_id');
  return value;
}

function normalizeStage(input) {
  assert(object(input) && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(input.id), '阶段 ID 需为 1–64 位字母、数字、点、下划线或连字符');
  assert(nonempty(input.title) && nonempty(input.goal), '阶段须有 title 与 goal');
  const result = { id: input.id, title: input.title, goal: input.goal };
  for (const key of ['skills', 'depends_on', 'steps', 'deliverables', 'acceptance', 'unknowns']) result[key] = strings(input[key] ?? [], key);
  assert(result.acceptance.length > 0, '每段至少一个可观察验收条件');
  const modes = input.acceptance_modes ?? Object.fromEntries(result.acceptance.map(criterion => [criterion, 'editor']));
  assert(object(modes) && Object.keys(modes).every(criterion => result.acceptance.includes(criterion)) && result.acceptance.every(criterion => ['editor', 'static'].includes(modes[criterion])), 'acceptance_modes 须逐项对应验收，并为 editor 或 static');
  result.acceptance_modes = modes;
  assert(result.skills.every(skill => skillNames.includes(skill)), '阶段引用了未知技能');
  assert(input.fallback === undefined || typeof input.fallback === 'string', 'fallback 必须为字符串');
  result.fallback = input.fallback ?? '';
  result.sources = sources(input.sources ?? []);
  return result;
}

function validateDependencies(stages) {
  const byId = new Map(stages.map(stage => [stage.id, stage]));
  const visiting = new Set(), visited = new Set();
  function visit(id) {
    assert(byId.has(id), `依赖阶段 ${id} 不存在`);
    assert(!visiting.has(id), '阶段依赖不能形成循环');
    if (visited.has(id)) return;
    visiting.add(id);
    byId.get(id).depends_on.forEach(visit);
    visiting.delete(id); visited.add(id);
  }
  stages.forEach(stage => visit(stage.id));
}

function invalidateDependents(state, id) {
  const pending = [id], visited = new Set();
  while (pending.length) {
    const changed = pending.shift();
    if (visited.has(changed)) continue;
    visited.add(changed);
    for (const stage of state.stages.filter(stage => stage.depends_on.includes(changed))) {
      if (!['planned', 'cancelled'].includes(stage.status)) {
        stage.status = 'needs_verification'; stage.checks = [];
        stage.next_action = `前置阶段 ${changed} 有变化，重新核验依赖及本阶段验收`;
      }
      pending.push(stage.id);
    }
  }
}

function transact(root, input, kind, mutate) {
  assert(object(input) && Number.isSafeInteger(input.expected_revision) && input.expected_revision >= 0, '必须提供读取到的 expected_revision');
  assert(nonempty(input.summary), '每次提交须提供 summary');
  const loc = locations(root);
  assert(fs.existsSync(loc.database), '先用 init 启用本项目数据库');
  const db = open(loc);
  let state;
  try {
    db.exec('BEGIN IMMEDIATE');
    state = stateFrom(db, loc);
    assert(state.revision === input.expected_revision, `版本冲突：当前 revision=${state.revision}，先 read 并合并结果`);
    mutate(state);
    state.revision++; state.updated_at = now();
    db.prepare('UPDATE project_state SET body = ? WHERE id = 1').run(JSON.stringify(state));
    db.prepare('INSERT INTO events VALUES (?, ?, ?, ?, ?)').run(state.revision, state.updated_at, kind, input.stage_id ?? null, JSON.stringify(input));
    db.exec('COMMIT');
  } catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; }
  finally { db.close(); }
  return { initialized: true, committed: true, database_path: loc.database, revision: state.revision, ...summaryResult(loc, state) };
}

export function savePlan(root, input) {
  return transact(root, input, 'plan', state => {
    assert(Array.isArray(input.stages) && input.stages.length > 0, 'plan 须包含至少一个阶段');
    const specs = input.stages.map(normalizeStage);
    assert(new Set(specs.map(stage => stage.id)).size === specs.length, '本次计划中的阶段 ID 重复');
    if (input.goal !== undefined) { assert(nonempty(input.goal), 'goal 不能为空'); state.goal = input.goal; }
    if (input.constraints !== undefined) state.constraints = strings(input.constraints, 'constraints');
    if (input.basis !== undefined) {
      assert(object(input.basis) && ['goal', 'user_plan', 'revision'].includes(input.basis.origin) && nonempty(input.basis.text), 'basis 须有 origin 与原始 text');
      state.bases.push({ ...input.basis, revision: state.revision + 1 });
    }
    assert(state.goal && state.bases.length, '首次计划须保存总目标 goal 与原始依据 basis');
    const changes = [];
    for (const spec of specs) {
      const index = state.stages.findIndex(stage => stage.id === spec.id);
      if (index < 0) state.stages.push({ ...spec, status: 'planned', summary: '', artifacts: [], findings: [], checks: [], next_action: '', plan_note: input.summary });
      else {
        const old = state.stages[index];
        const changed = ['goal', 'steps', 'deliverables', 'acceptance', 'acceptance_modes', 'depends_on'].some(key => !equal(old[key], spec[key]));
        state.stages[index] = { ...old, ...spec, plan_note: input.summary };
        if (changed) {
          changes.push(spec.id);
          if (!['planned', 'cancelled'].includes(old.status)) {
            state.stages[index].status = 'needs_verification'; state.stages[index].checks = [];
            state.stages[index].next_action = '阶段方案发生变化，按新验收重新验证';
          }
        }
      }
    }
    validateDependencies(state.stages);
    changes.forEach(id => invalidateDependents(state, id));
  });
}

export function recordStage(root, input) {
  return transact(root, input, 'record', state => {
    const stage = state.stages.find(stage => stage.id === input.stage_id);
    assert(stage, `不存在阶段 ${input.stage_id}`);
    const previousStatus = stage.status;
    if (input.status !== undefined) { assert(statuses.includes(input.status), '未知阶段状态'); stage.status = input.status; }
    assert(input.changes_made === undefined || typeof input.changes_made === 'boolean', 'changes_made 须为 boolean');
    if (input.changes_made) {
      stage.checks = [];
      if (input.status === undefined && stage.status === 'verified') stage.status = 'needs_verification';
    }
    if (input.artifacts !== undefined) stage.artifacts = strings(input.artifacts, 'artifacts');
    if (input.artifact_hashes !== undefined) {
      assert(Array.isArray(input.artifact_hashes) && input.artifact_hashes.every(item => object(item) && nonempty(item.file) && /^[a-f0-9]{64}$/.test(item.sha256) && Number.isSafeInteger(item.bytes) && item.bytes >= 0), 'artifact_hashes 须包含 file、SHA-256 和 bytes');
      stage.artifact_hashes = input.artifact_hashes;
    }
    if (input.sources !== undefined) {
      for (const source of sources(input.sources)) if (!stage.sources.some(old => equal(old, source))) stage.sources.push(source);
    }
    if (input.next_action !== undefined) { assert(typeof input.next_action === 'string', 'next_action 须为字符串'); stage.next_action = input.next_action; }
    if (input.findings !== undefined) {
      assert(Array.isArray(input.findings) && input.findings.every(item => object(item) && nonempty(item.statement) && nonempty(item.reference) && ['official', 'tested', 'hypothesis', 'failed'].includes(item.basis)), 'findings 须有 statement、basis 与 reference');
      for (const finding of input.findings) if (!stage.findings.some(old => equal(old, finding))) stage.findings.push(finding);
    }
    if (input.checks !== undefined) {
      assert(Array.isArray(input.checks) && input.checks.every(item => object(item) && stage.acceptance.includes(item.criterion) && ['passed', 'failed', 'not_run'].includes(item.result) && nonempty(item.evidence)), 'checks 须对应验收条件，并有 result 与 evidence');
      assert(new Set(input.checks.map(item => item.criterion)).size === input.checks.length, '验收条件重复');
      assert(input.checks.every(item => item.method === undefined || ['editor_playtest', 'user_report', 'log_review', 'static_check'].includes(item.method)), '未知验证方法');
      stage.checks = input.checks;
    }
    if (['in_progress', 'verified'].includes(stage.status)) {
      assert(stage.depends_on.every(id => state.stages.find(dep => dep.id === id)?.status === 'verified'), '依赖阶段尚未全部验证，不能开始依赖它的制作或标记完成');
    }
    if (stage.status === 'verified') {
      const needsNewEvidence = input.status === 'verified' || input.changes_made;
      assert((!needsNewEvidence || input.checks !== undefined) && stage.acceptance.every(criterion => stage.checks.some(check => check.criterion === criterion && check.result === 'passed')), 'verified 须提交全部验收条件的实际通过证据');
      if (needsNewEvidence) for (const check of stage.checks) {
        const mode = stage.acceptance_modes?.[check.criterion] ?? 'editor';
        assert(nonempty(check.method) && (mode === 'static' || ['editor_playtest', 'user_report'].includes(check.method)), `验收 ${check.criterion} 需要 ${mode === 'editor' ? '编辑器试玩或用户明确实测报告' : '注明验证方法'}；静态检查不证明关卡运行`);
      }
    }
    stage.summary = input.summary;
    if (input.changes_made || (previousStatus === 'verified' && stage.status !== 'verified')) invalidateDependents(state, stage.id);
  });
}

export function bindProject(root) {
  const existing = readProject(root);
  assert(existing.initialized, '先初始化项目数据库再绑定指引');
  const loc = locations(root);
  const override = path.join(loc.root, 'AGENTS.override.md');
  const file = fs.existsSync(override) ? override : path.join(loc.root, 'AGENTS.md');
  safeFile(file);
  const content = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const hasStart = content.includes(startMarker), hasEnd = content.includes(endMarker);
  assert(hasStart === hasEnd, '已有千星项目指引块不完整，请核对后再绑定');
  const block = `${startMarker}\n## 千星奇域制作记录\n\n本项目已启用千星 Codex 工坊。千星任务先用 miliastra MCP 的 project_context 读取本项目 .miliastra/project.sqlite，核对有效依赖、产物变化和失败记录，再按需要使用 qx-plan、qx-docs、qx-build、qx-ui、qx-lua、qx-debug；各技能可自主查本地官方资料。总玩法或计划表以 qx-plan 保存；qx-build 涉及界面时结合 qx-ui 的完整控件树、依赖、属性、坐标和排序，生成布局合同与预览；qx-lua 复用相同 ID 和宿主。每段后 project_checkpoint 保存产物哈希、来源、失败与下一步，验收标明实际方法；静态检查不能证明玩法试玩通过。跨聊天用 project_handoff 生成续做提示。MCP 不可用时以 qx-plan 附带 project-db.mjs 读取并核对实际文件。官方资料仅明确更新时下载。数据库记录不授予编辑器操作权限，按当前会话授权执行；计划模式只读并输出待提交记录，回到可写模式再补录。\n${endMarker}`;
  let updated;
  if (hasStart) {
    const start = content.indexOf(startMarker), end = content.indexOf(endMarker);
    assert(end > start && content.indexOf(startMarker, start + startMarker.length) < 0 && content.indexOf(endMarker, end + endMarker.length) < 0, '已有千星项目指引块重复或顺序异常，请核对后再绑定');
    updated = `${content.slice(0, start)}${block}${content.slice(end + endMarker.length)}`;
  } else updated = `${content}${content && !content.endsWith('\n') ? '\n' : ''}${content ? '\n' : ''}${block}\n`;
  if (updated === content) return { bound: true, changed: false, instructions_path: file, database_path: loc.database };
  atomicText(file, updated);
  return { bound: true, changed: true, instructions_path: file, database_path: loc.database };
}

export function refreshSummary(root) {
  const result = readProject(root);
  assert(result.initialized, '项目数据库尚未初始化');
  return { refreshed: true, revision: result.state.revision, ...summaryResult(locations(root), result.state) };
}

function argumentsFrom(argv) {
  const [command, ...args] = argv;
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    assert(['--root', '--name', '--input', '--stage', '--history'].includes(key), `未知参数 ${key}`);
    if (key === '--history') options.history = true;
    else { assert(args[index + 1] && !args[index + 1].startsWith('--'), `${key} 缺少值`); options[key.slice(2)] = args[++index]; }
  }
  return { command, options };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const { command, options } = argumentsFrom(process.argv.slice(2));
    let result;
    if (command === 'init') result = initialize(options.root, options.name);
    else if (command === 'read') result = readProject(options.root, { stageId: options.stage, history: options.history });
    else if (command === 'bind') result = bindProject(options.root);
    else if (command === 'refresh') result = refreshSummary(options.root);
    else if (['plan', 'record'].includes(command)) {
      assert(nonempty(options.input) && path.isAbsolute(options.input), '--input 须为 UTF-8 JSON 文件的绝对路径');
      const input = JSON.parse(fs.readFileSync(options.input, 'utf8').replace(/^\uFEFF/, ''));
      result = command === 'plan' ? savePlan(options.root, input) : recordStage(options.root, input);
    } else throw new Error('命令：init | read | bind | plan | record | refresh；必须传 --root <绝对项目目录>');
    console.log(JSON.stringify(result, null, 2));
  } catch (error) { console.error(JSON.stringify({ committed: false, error: error.message })); process.exitCode = 1; }
}
