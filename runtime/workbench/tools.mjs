import { z } from 'zod';
import { projectInit, projectContext, projectPlan, projectCheckpoint, projectHandoff } from './project.mjs';
import { validateLayout, saveLayoutPreview } from './layout.mjs';

export function registerWorkbenchTools(server) {
  const root = z.string().min(1).describe('用户实际制作项目的绝对根目录，不是插件源码目录');
  const stage = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/);
  const payload = z.record(z.unknown());
  function register(name, description, inputSchema, readOnly, execute) {
    server.registerTool(name, { description, inputSchema, annotations: {
      readOnlyHint: readOnly, destructiveHint: false, idempotentHint: readOnly, openWorldHint: false,
    } }, async args => {
      try { return { content: [{ type: 'text', text: JSON.stringify({ result: await execute(args) }, null, 2) }] }; }
      catch (error) { return { isError: true, content: [{ type: 'text', text: JSON.stringify({ committed: false, error: error.message, action: '读 project_context 核对最新 revision；错误不代表关卡能力不存在。' }) }] }; }
    });
  }
  register('project_init', '用户启用制作项目时，创建或复用本项目 SQLite 并绑定自有指引；不操作编辑器、不下载官方资料。',
    { project_root: root, name: z.string().optional(), bind: z.boolean().optional() }, false,
    args => projectInit(args.project_root, args.name, args.bind ?? true));
  register('project_context', '开始或继续阶段时读取目标、依赖、当前产物哈希、有效状态和官方来源版本；产物变更会提示重验，纯读取不改库。资料尚未准备也可用。',
    { project_root: root, stage_id: stage.optional() }, true,
    args => projectContext(args.project_root, { stageId: args.stage_id }));
  register('project_plan', '保存原始总玩法和分段计划；input 使用 expected_revision、summary、basis、stages。验收默认 editor，纯设计条件可显式设 acceptance_modes 为 static。',
    { project_root: root, input: payload }, false,
    args => projectPlan(args.project_root, args.input));
  register('project_checkpoint', '阶段结束时事务记录产物、来源、失败与验收，自动保存项目内产物哈希；verified 须完整证据并标 method，静态检查不能通过 editor 验收。',
    { project_root: root, input: payload }, false,
    args => projectCheckpoint(args.project_root, args.input));
  register('project_handoff', '返回当前阶段上下文和可复制到新 Codex 聊天的续做提示；核对依赖与产物变更；不会发送消息或操作编辑器。',
    { project_root: root, stage_id: stage.optional() }, true,
    args => projectHandoff(args.project_root, args.stage_id));
  register('layout_validate', '校验结构化布局的父子树、坐标、设备覆盖、依赖引用、层次和交互重叠，返回按控件 ID 定位的问题；此检查不验证引擎/API 实际支持。',
    { layout: payload }, true, args => validateLayout(args.layout));
  register('layout_preview', '在已启用项目保存布局 JSON 和离线交互 HTML：控件树、逐项属性、坐标、设备切换、隐藏状态和层次；事务登记产物并重验受影响阶段，不执行编辑器操作。',
    { project_root: root, stage_id: stage, expected_revision: z.number().int().nonnegative(), layout: payload }, false,
    args => saveLayoutPreview(args.project_root, args.stage_id, args.expected_revision, args.layout));
}
