import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { initialize, readProject, savePlan, recordStage, bindProject } from '../../plugin/skills/qx-plan/scripts/project-db.mjs';
import { DATA } from '../paths.mjs';

const assert = (ok, message) => { if (!ok) throw new Error(message); };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export function projectFile(root, file) {
  assert(path.isAbsolute(root), 'project_root 必须为绝对目录');
  const base = fs.realpathSync(root);
  assert(typeof file === 'string' && file.length > 0 && !path.isAbsolute(file), '项目产物使用项目内相对路径');
  const resolved = path.resolve(base, file);
  const relative = path.relative(base, resolved);
  assert(relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative), '产物必须在本项目内');
  let ancestor = resolved;
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  const real = fs.realpathSync(ancestor);
  const realRelative = path.relative(base, real);
  assert(realRelative !== '..' && !realRelative.startsWith('..' + path.sep) && !path.isAbsolute(realRelative), '拒绝指向项目外的产物链接');
  return resolved;
}

export function artifactInfo(root, file) {
  try {
    const location = projectFile(root, file);
    const stat = fs.statSync(location);
    assert(stat.isFile(), '产物不是文件');
    assert(stat.size <= 32 * 1024 * 1024, '单个记录产物超过 32 MiB，请记录精简证据文件');
    return { file, sha256: digest(fs.readFileSync(location)), bytes: stat.size, state: 'readable' };
  } catch (error) { return { file, state: 'unavailable', reason: error.message }; }
}

function activeDocuments() {
  try {
    const pointer = JSON.parse(fs.readFileSync(path.join(DATA, 'active.json'), 'utf8'));
    const manifest = JSON.parse(fs.readFileSync(path.resolve(DATA, pointer.directory, 'manifest.json'), 'utf8'));
    return { snapshot_id: pointer.snapshot_id, documents: new Map(manifest.documents.map(doc => [doc.id, doc])) };
  } catch { return null; }
}

export function projectContext(root, { stageId } = {}) {
  const result = readProject(root, { stageId });
  if (!result.initialized) return { ...result, next_action: '用户启用项目时调用 project_init；知识查询无需启用项目' };
  // Load all stages to audit dependency freshness even when the caller asks for one.
  const state = stageId ? readProject(root).state : result.state;
  const active = activeDocuments();
  const stages = state.stages.map(stage => {
    const artifacts = stage.artifacts.map(file => {
      const info = artifactInfo(root, file);
      const recorded = stage.artifact_hashes?.find(item => item.file === file);
      return { ...info, state: info.state === 'unavailable' ? info.state : !recorded ? 'untracked' : recorded.sha256 === info.sha256 ? 'unchanged' : 'changed' };
    });
    const sources = stage.sources.map(source => ({ ...source, freshness: !active ? 'knowledge_not_prepared' : !active.documents.has(source.document_id) ? 'document_removed' : source.snapshot_id === active.snapshot_id || (source.body_sha256 && source.body_sha256 === active.documents.get(source.document_id).body_sha256) ? 'active' : 'version_changed' }));
    const drift = artifacts.some(item => ['changed', 'unavailable'].includes(item.state));
    return { ...stage, recorded_status: stage.status, effective_status: stage.status === 'verified' && drift ? 'needs_verification' : stage.status, artifacts, sources, artifact_drift: drift };
  });
  const byId = new Map(stages.map(stage => [stage.id, stage]));
  let changed;
  do {
    changed = false;
    for (const stage of stages) if (stage.effective_status === 'verified' && stage.depends_on.some(id => byId.get(id)?.effective_status !== 'verified')) {
      stage.effective_status = 'needs_verification'; changed = true;
    }
  } while (changed);
  for (const stage of stages) {
    stage.unverified_dependencies = stage.depends_on.filter(id => byId.get(id)?.effective_status !== 'verified');
    stage.can_implement = !stage.unverified_dependencies.length && !['cancelled', 'blocked'].includes(stage.status);
  }
  return { initialized: true, project_id: state.project_id, project_name: state.project_name, project_root: state.project_root,
    revision: state.revision, goal: state.goal, constraints: state.constraints, original_bases: state.bases,
    knowledge_snapshot: active?.snapshot_id ?? null, database_path: result.database_path,
    stages: stageId ? stages.filter(stage => stage.id === stageId) : stages,
    stage_overview: stages.map(stage => ({ id: stage.id, title: stage.title, recorded_status: stage.recorded_status, effective_status: stage.effective_status, depends_on: stage.depends_on, can_implement: stage.can_implement })),
    read_only: true, note: '状态差异是只读审计，不会自动改库；验证证据须来自实际执行或用户实测报告。' };
}

export function projectInit(root, name, bind = true) {
  const result = initialize(root, name);
  return { ...result, binding: bind ? bindProject(root) : undefined };
}
export function projectPlan(root, input) { return savePlan(root, input); }

export function projectCheckpoint(root, input) {
  const context = projectContext(root);
  assert(context.initialized, '先启用项目数据库');
  assert(input.expected_revision === context.revision, `版本冲突：当前 revision=${context.revision}，先 project_context 合并`);
  const stage = context.stages.find(item => item.id === input.stage_id);
  assert(stage, '阶段不存在');
  const submitted = { ...input };
  if (['verified', 'in_progress'].includes(input.status)) assert(stage.unverified_dependencies.length === 0, `依赖未验证或产物已变化：${stage.unverified_dependencies.join(', ')}`);
  const files = input.artifacts ?? stage.artifacts.map(item => item.file);
  const metadata = files.map(file => {
    projectFile(root, file); // Reject escape paths even for a non-verified checkpoint.
    return artifactInfo(root, file);
  });
  if (input.status === 'verified') assert(metadata.every(item => item.state === 'readable'), '存在缺失或不可读产物，不能标记 verified');
  const hashes = metadata.filter(item => item.state === 'readable').map(({ file, sha256, bytes }) => ({ file, sha256, bytes }));
  const oldHashes = readProject(root, { stageId: stage.id }).state.stages[0].artifact_hashes ?? [];
  if (stage.artifact_drift || (oldHashes.length && JSON.stringify(oldHashes) !== JSON.stringify(hashes))) submitted.changes_made = true;
  submitted.artifact_hashes = hashes;
  const result = recordStage(root, submitted);
  return { ...result, artifact_audit: metadata, editor_operated: false };
}

export function projectHandoff(root, stageId) {
  const context = projectContext(root, { stageId });
  assert(context.initialized, '项目尚未启用');
  const target = stageId ? context.stages[0] : context.stages.find(stage => stage.effective_status !== 'verified' && stage.recorded_status !== 'cancelled');
  assert(target, '没有待续做阶段');
  const prompt = [`在项目 ${context.project_root} 使用千星 Codex 工坊继续 ${target.id}：${target.title}。`,
    `先调用 project_context（本次记录 revision ${context.revision}），合并当前文件变化后按最新结果续做。`,
    `本段目标：${target.goal}；当前有效状态：${target.effective_status}。`,
    `前置依赖：${target.depends_on.join('、') || '无'}；未验证依赖：${target.unverified_dependencies.join('、') || '无'}。`,
    `阶段技能：${target.skills.join('、')}。读取已登记的布局、脚本和失败记录，沿用已有名称与路径。`,
    `下一步：${target.next_action || target.steps[0] || '核对阶段验收'}。`,
    '只实施当前用户授权的步骤；当前记录不授予编辑器操作权限。每段后 project_checkpoint，验收注明方法与实际证据。'].join('\n');
  return { revision: context.revision, stage_id: target.id, can_implement: target.can_implement, context, resume_prompt: prompt, sent_to_other_chat: false };
}
