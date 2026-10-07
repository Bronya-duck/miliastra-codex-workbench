import fs from 'node:fs';
import path from 'node:path';
import { projectInit, projectContext, projectPlan, projectCheckpoint, projectHandoff } from './runtime/workbench/project.mjs';
import { validateLayout, previewHtml, saveLayoutPreview } from './runtime/workbench/layout.mjs';
const [area, command, ...args] = process.argv.slice(2);
const options = {};
for (let index = 0; index < args.length; index += 2) {
  if (!['--root', '--name', '--stage', '--input', '--output', '--revision'].includes(args[index]) || !args[index + 1]) throw new Error('参数无效');
  options[args[index].slice(2)] = args[index + 1];
}
const input = () => JSON.parse(fs.readFileSync(path.resolve(options.input), 'utf8').replace(/^\uFEFF/, ''));
try {
  let result;
  if (area === 'project') {
    if (command === 'init') result = projectInit(path.resolve(options.root), options.name);
    else if (command === 'context') result = projectContext(path.resolve(options.root), { stageId: options.stage });
    else if (command === 'plan') result = projectPlan(path.resolve(options.root), input());
    else if (command === 'checkpoint') result = projectCheckpoint(path.resolve(options.root), input());
    else if (command === 'handoff') result = projectHandoff(path.resolve(options.root), options.stage);
  } else if (area === 'layout') {
    const layout = input();
    if (command === 'validate') {
      result = validateLayout(layout);
      if (!result.valid) process.exitCode = 1;
    } else if (command === 'preview') {
      if (options.root) result = saveLayoutPreview(path.resolve(options.root), options.stage || layout.stage_id, Number(options.revision), layout);
      else {
        const destination = path.resolve(options.output);
        fs.writeFileSync(destination, previewHtml(layout));
        result = { preview_path: destination, editor_verified: false };
      }
    }
  }
  if (!result) throw new Error('Usage: node cli.mjs project init|context|plan|checkpoint|handoff --root <project> ... | layout validate|preview --input <json> ...');
  if (result.committed === false) process.exitCode = 1;
  console.log(JSON.stringify(result, null, 2));
} catch (error) { console.error(JSON.stringify({ committed: false, error: error.message })); process.exitCode = 1; }
