import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectInit, projectPlan, projectHandoff } from '../runtime/workbench/project.mjs';
import { saveLayoutPreview } from '../runtime/workbench/layout.mjs';
const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const demoDirectory = path.join(root, '.local/demo');
fs.mkdirSync(demoDirectory, { recursive: true });
const project = fs.mkdtempSync(path.join(demoDirectory, 'run-'));
projectInit(project, '双人收集 · 隔离演示');
const layout = JSON.parse(fs.readFileSync(path.join(root, 'examples/layout.json'), 'utf8'));
projectPlan(project, { expected_revision: 0, summary: '根据原创示例登记布局阶段', goal: '双人合作收集玩法的界面方案',
  basis: { origin: 'goal', text: '界面显示数量和时间，包含帮助按钮与可关闭面板。' },
  constraints: ['仅隔离演示，不操作游戏编辑器'], stages: [{
    id: 'P2', title: '界面布局', goal: '设计 HUD 与帮助面板', skills: ['qx-ui', 'qx-lua'], depends_on: [],
    steps: ['查官方属性', '保存布局合同和预览', '人工配置后试玩'], deliverables: ['布局 JSON', '离线预览'],
    acceptance: ['画面与输入适配通过'], unknowns: ['未验证实际输入和宿主'], fallback: '先验证单按钮', sources: [],
  }] });
const result = saveLayoutPreview(project, 'P2', 1, layout);
const handoff = projectHandoff(project, 'P2');
fs.writeFileSync(path.join(project, 'RESUME.md'), handoff.resume_prompt + '\n');
console.log(JSON.stringify({ ...result, resume_file: path.join(project, 'RESUME.md') }, null, 2));
