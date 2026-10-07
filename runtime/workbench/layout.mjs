import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { projectContext, projectCheckpoint, projectFile } from './project.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const identifier = value => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(value);
const text = value => typeof value === 'string' && value.trim().length > 0;
const external = value => typeof value === 'string' && /^(var|signal|script|asset):[^\s]+$/.test(value);
const overlayFields = ['position', 'size', 'anchors', 'render', 'appearance', 'state', 'properties'];

export function deviceControls(layout, device) {
  return layout.controls.map(control => {
    const override = control.overrides?.[device] || {};
    const result = { ...control };
    for (const key of overlayFields) if (override[key] !== undefined) result[key] = { ...(control[key] || {}), ...override[key] };
    return result;
  });
}

export function geometry(layout, device) {
  const controls = deviceControls(layout, device);
  const byId = new Map(controls.map(control => [control.id, control]));
  const rectangles = new Map();
  function resolve(id) {
    if (rectangles.has(id)) return rectangles.get(id);
    const control = byId.get(id);
    const parent = control.parent ? resolve(control.parent) : null;
    const x = (parent?.center_x || 0) + control.position.x;
    const y = (parent?.center_y || 0) + control.position.y;
    const rectangle = { id, parent: control.parent, center_x: x, center_y: y,
      x: x - control.size.width / 2, y: y - control.size.height / 2,
      width: control.size.width, height: control.size.height,
      active: (parent?.active ?? true) && (control.state?.active ?? true),
      visible: (parent?.visible ?? true) && (control.state?.visible ?? true),
      interactable: control.state?.interactable ?? false,
      order: control.render.order, scope: control.render.scope };
    rectangles.set(id, rectangle);
    return rectangle;
  }
  controls.forEach(control => resolve(control.id));
  return [...rectangles.values()];
}

export function validateLayout(layout) {
  const errors = [], warnings = [];
  const error = (code, detail) => errors.push({ code, detail });
  const warn = (code, detail) => { if (warnings.length < 100) warnings.push({ code, detail }); };
  if (!object(layout)) return { valid: false, errors: [{ code: 'schema', detail: '布局必须为对象' }], warnings };
  if (layout.schema_version !== 1) error('schema', 'schema_version 必须为 1');
  if (!text(layout.title)) error('title', '需要布局标题');
  const canvas = layout.canvas;
  if (!object(canvas) || !finite(canvas.width) || !finite(canvas.height) || canvas.width <= 0 || canvas.height <= 0 || canvas.width > 10000 || canvas.height > 10000 || canvas.origin !== 'bottom-left' || canvas.unit !== 'ui') error('canvas', '画布需为正数 UI 单位，左下原点，最大 10000×10000');
  const devices = canvas?.devices ?? [{ id: 'pc', width: canvas?.width, height: canvas?.height }];
  if (!Array.isArray(devices) || !devices.length || devices.length > 8 || devices.some(device => !object(device) || !identifier(device.id) || !finite(device.width) || !finite(device.height) || device.width <= 0 || device.height <= 0 || device.width > 10000 || device.height > 10000) || new Set(devices.map(device => device.id)).size !== devices.length) error('devices', '设备须有唯一 id 和有效画布尺寸，最多 8 种');
  if (!Array.isArray(layout.controls) || !layout.controls.length || layout.controls.length > 250) return { valid: false, errors: [...errors, { code: 'controls', detail: '需要 1–250 个控件' }], warnings };
  const byId = new Map();
  for (const control of layout.controls) {
    if (!object(control)) { error('control', '控件须为对象'); continue; }
    if (!identifier(control.id) || byId.has(control.id)) error('id', '控件 id 无效或重复：' + control.id);
    else byId.set(control.id, control);
    if (!text(control.name) || !text(control.type)) error('identity', '需明确编辑器名称和官方控件类型：' + control.id);
    if (control.parent !== null && !identifier(control.parent)) error('parent', '父级须为控件 id，根用 null：' + control.id);
    if (control.overrides !== undefined && (!object(control.overrides) || Object.entries(control.overrides).some(([device, override]) => !Array.isArray(devices) || !devices.some(item => object(item) && item.id === device) || !object(override) || Object.keys(override).some(key => !overlayFields.includes(key))))) error('override', '设备覆盖只修改布局/属性，不修改 id、类型或父级：' + control.id);
  }
  for (const control of byId.values()) if (control.parent && !byId.has(control.parent)) error('missing_parent', '缺少父级：' + control.id + ' → ' + control.parent);
  const visited = new Set(), visiting = new Set();
  function visit(id) {
    if (visiting.has(id)) { error('parent_cycle', '父子结构形成循环：' + id); return; }
    if (visited.has(id)) return;
    visiting.add(id);
    const parent = byId.get(id)?.parent;
    if (parent && byId.has(parent)) visit(parent);
    visiting.delete(id); visited.add(id);
  }
  byId.forEach((_, id) => visit(id));
  if (Array.isArray(devices) && layout.controls.every(object) && devices.every(object)) for (const device of devices) {
    for (const control of deviceControls(layout, device.id)) {
      const label = control.id + ' [' + device.id + ']';
      if (!object(control.position) || !finite(control.position.x) || !finite(control.position.y) || control.position.space !== (control.parent ? 'parent-center' : 'canvas')) error('coordinate', '位置基准错误：' + label);
      if (!object(control.size) || !finite(control.size.width) || !finite(control.size.height) || control.size.width <= 0 || control.size.height <= 0 || control.size.width > 20000 || control.size.height > 20000) error('size', '宽高须为有效正数：' + label);
      if (!object(control.render) || !text(control.render.scope) || !Number.isSafeInteger(control.render.order)) error('render', '需明确排序范围 scope 与整数 order：' + label);
      if (control.state !== undefined && (!object(control.state) || Object.values(control.state).some(value => typeof value !== 'boolean'))) error('state', '激活、可见、交互状态须为布尔值：' + label);
      const appearance = control.appearance || {};
      if (appearance.text !== undefined && typeof appearance.text !== 'string') error('text', '预览文本须为字符串：' + label);
      if (control.properties !== undefined && !object(control.properties)) error('properties', '官方配置属性须为对象：' + label);
      if (!object(appearance) || (appearance.opacity !== undefined && (!finite(appearance.opacity) || appearance.opacity < 0 || appearance.opacity > 1)) || (appearance.font_size !== undefined && (!finite(appearance.font_size) || appearance.font_size < 1 || appearance.font_size > 300))) error('appearance', '透明度/字号无效：' + label);
      if (appearance.bg_color !== undefined && !/^#[a-f0-9]{6}([a-f0-9]{2})?$/i.test(appearance.bg_color)) error('color', '预览颜色使用 #RRGGBB 或 #RRGGBBAA：' + label);
      if (appearance.text_color !== undefined && !/^#[a-f0-9]{6}([a-f0-9]{2})?$/i.test(appearance.text_color)) error('color', '文字颜色无效：' + label);
      if (control.anchors !== undefined) {
        const anchors = control.anchors;
        if (!object(anchors) || ['min', 'max', 'pivot'].some(key => !Array.isArray(anchors[key]) || anchors[key].length !== 2 || anchors[key].some(value => !finite(value) || value < 0 || value > 1))) error('anchor', '锚点/中心须为两个 0–1 数值：' + label);
        else if (['min', 'max', 'pivot'].some(key => anchors[key].some(value => value !== 0.5))) warn('preview_approximation', '预览仅精确支持固定中心锚点/枢轴；此控件需编辑器核对：' + label);
      }
      if (control.properties && Object.keys(control.properties).some(key => /scale|rotation|裁剪|遮罩|缩放|旋转/i.test(key))) warn('preview_approximation', '预览不模拟引擎变换与裁剪，属性仍在检查器展示：' + label);
    }
  }
  const dependencies = layout.dependencies ?? [];
  if (!Array.isArray(dependencies) || dependencies.some(edge => !object(edge) || !byId.has(edge.from) || (!byId.has(edge.to) && !external(edge.to)) || !['data', 'event', 'lifecycle', 'layout', 'resource'].includes(edge.kind) || !text(edge.description))) error('dependency', '依赖须有已存在控件、控件/var:/signal:/script:/asset: 目标、类型与说明');
  if (!Array.isArray(layout.sources) || !layout.sources.length) warn('provenance', '未附官方资料来源；结构通过不代表属性/API 已获官方核实');
  if (Array.isArray(layout.sources) && layout.sources.some(source => !object(source) || !text(source.document_id) || !text(source.snapshot_id) || !/^https:\/\//.test(source.official_url || ''))) error('source', '官方来源须有文档 ID、快照和 HTTPS 地址');
  const views = [];
  if (!errors.length) for (const device of devices) {
    const rectangles = geometry(layout, device.id);
    for (const rect of rectangles) {
      if (rect.x < 0 || rect.y < 0 || rect.x + rect.width > device.width || rect.y + rect.height > device.height) warn('outside_canvas', rect.id + ' 在 ' + device.id + ' 超出画布');
      const parent = rect.parent && rectangles.find(item => item.id === rect.parent);
      if (parent && parent.scope !== rect.scope) warn('cross_scope', '跨排序范围的前后关系需实测：' + rect.id + ' → ' + parent.id);
    }
    const active = rectangles.filter(rect => rect.active && rect.visible && rect.interactable);
    for (let i = 0; i < active.length; i++) for (let j = i + 1; j < active.length; j++) {
      const a = active[i], b = active[j];
      if (a.parent === b.parent && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height) warn('interactive_overlap', '同级交互区域重叠：' + a.id + ' / ' + b.id + ' [' + device.id + ']');
    }
    views.push({ device: device.id, canvas: { width: device.width, height: device.height }, rectangles });
  }
  return { valid: errors.length === 0, errors, warnings, control_count: byId.size, devices: views, editor_verified: false };
}

export function previewHtml(layout, validation = validateLayout(layout)) {
  if (!validation.valid) throw new Error('布局结构校验失败：' + JSON.stringify(validation.errors));
  const model = JSON.stringify({ layout, validation }).replaceAll('<', '\\u003c').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
  return [
    '<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>千星 Codex 工坊 · 布局检查器</title>',
    '<style>body{margin:0;background:#101521;color:#edf2fc;font:14px system-ui,sans-serif}header{padding:18px 24px;border-bottom:1px solid #34405c}h1{font-size:21px;margin:0 0 8px}p{margin:8px 0;color:#b6c2d8}main{display:grid;grid-template-columns:240px minmax(300px,1fr) 340px;gap:16px;padding:18px}section{background:#1b2233;border:1px solid #364259;border-radius:10px;padding:14px;min-width:0}button,select,input{font:inherit;background:#2b3853;color:#fff;border:1px solid #506283;border-radius:5px;padding:7px;margin:3px;cursor:pointer}button.selected{background:#526eda}.tree{display:block;text-align:left;width:calc(100% - 6px)}#viewport{position:relative;width:100%;min-height:380px;overflow:auto;background:#111827;border:1px solid #40506a;border-radius:8px}#canvas{position:absolute;left:0;top:0;transform-origin:top left;background:radial-gradient(ellipse at center,#35455b,#111822);overflow:hidden}.control{position:absolute;box-sizing:border-box;border:1px dashed #536481;display:flex;align-items:center;justify-content:center;white-space:pre-wrap;text-align:center;overflow:hidden;cursor:pointer}.control:hover,.control.selected{outline:3px solid #89b5ff;outline-offset:-3px}.control[hidden]{display:none}.control.ghost{border-color:#ffbd5c}pre{font-size:12px;white-space:pre-wrap;word-break:break-word;max-height:65vh;overflow:auto}.badge{color:#ffd39a}label{display:inline-block;margin-right:12px}#messages{max-height:170px;overflow:auto;font-size:12px;color:#ffce8a}@media(max-width:1000px){main{grid-template-columns:180px 1fr}#inspector{grid-column:1/-1}}@media(max-width:650px){main{display:block}section{margin-bottom:12px}}</style>',
    '<header><h1 id="title"></h1><p>离线方案预览。位置使用 UI 单位；引擎输入、实际排序、锚点变换与玩法效果请在编辑器验证。</p><span class="badge">静态结构检查 ≠ 关卡试玩通过</span></header>',
    '<main><section><h3>控件结构</h3><div id="tree"></div></section>',
    '<section><label>设备<select id="device"></select></label><label><input type="checkbox" id="hidden">展示隐藏控件</label><label>缩放<input type="range" id="zoom" min="0.2" max="1" step="0.05" value="0.5"></label><div id="viewport"><div id="canvas"></div></div><h3>结构检查</h3><div id="messages"></div></section>',
    '<section id="inspector"><h3 id="selected">选择控件查看配置</h3><pre id="properties"></pre><h3>依赖关系</h3><div id="dependencies"></div></section></main>',
    '<script type="application/json" id="model">' + model + '</script>',
    '<script>',
    'const model=JSON.parse(document.getElementById("model").textContent),layout=model.layout;',
    'let selected=layout.controls[0].id;',
    'const byId=new Map(layout.controls.map(c=>[c.id,c]));',
    'document.getElementById("title").textContent=layout.title;',
    'for(const d of model.validation.devices){const option=document.createElement("option");option.value=d.device;option.textContent=d.device+" · "+d.canvas.width+"×"+d.canvas.height;document.getElementById("device").append(option)}',
    'function merged(c,device){const o=c.overrides?.[device]||{},r={...c};for(const key of ["position","size","anchors","render","appearance","state","properties"])if(o[key])r[key]={...(c[key]||{}),...o[key]};return r}',
    'function select(id){selected=id;render()}',
    'function inspect(control){document.getElementById("selected").textContent=control.id+" · "+control.name;document.getElementById("properties").textContent=JSON.stringify(control,null,2);const dep=document.getElementById("dependencies");dep.replaceChildren();for(const edge of layout.dependencies||[])if(edge.from===control.id||edge.to===control.id){const row=document.createElement("p");row.textContent=edge.from+" → "+edge.to+" ["+edge.kind+"] "+edge.description;dep.append(row)}}',
    'function render(){const device=document.getElementById("device").value,view=model.validation.devices.find(d=>d.device===device),zoom=Number(document.getElementById("zoom").value),showHidden=document.getElementById("hidden").checked,canvas=document.getElementById("canvas");canvas.replaceChildren();canvas.style.width=view.canvas.width+"px";canvas.style.height=view.canvas.height+"px";canvas.style.transform="scale("+zoom+")";document.getElementById("viewport").style.height=Math.max(280,view.canvas.height*zoom)+"px";const nodes=new Map();',
    'function create(id){if(nodes.has(id))return nodes.get(id);const c=merged(byId.get(id),device),rect=view.rectangles.find(r=>r.id===id),parent=c.parent?create(c.parent):canvas,node=document.createElement("div");node.className="control"+(selected===id?" selected":"")+(!rect.active||!rect.visible?" ghost":"");node.dataset.controlId=id;node.title=c.id+" · "+c.type;node.style.width=c.size.width+"px";node.style.height=c.size.height+"px";node.style.left=(c.parent?"calc(50% + "+(c.position.x-c.size.width/2)+"px)":(c.position.x-c.size.width/2)+"px");node.style.bottom=(c.parent?"calc(50% + "+(c.position.y-c.size.height/2)+"px)":(c.position.y-c.size.height/2)+"px");node.style.zIndex=c.render.order;node.style.opacity=c.appearance?.opacity??1;node.style.backgroundColor=c.appearance?.bg_color||"transparent";node.style.color=c.appearance?.text_color||"#edf2fc";node.style.fontSize=(c.appearance?.font_size||20)+"px";node.hidden=(!rect.active||!rect.visible)&&!showHidden;node.textContent=c.appearance?.text||"";node.addEventListener("click",e=>{e.stopPropagation();select(id)});parent.append(node);nodes.set(id,node);return node}',
    'for(const c of layout.controls)create(c.id);const tree=document.getElementById("tree");tree.replaceChildren();function branch(parent,depth){for(const c of layout.controls.filter(x=>x.parent===parent).sort((a,b)=>a.render.order-b.render.order)){const b=document.createElement("button");b.className="tree"+(c.id===selected?" selected":"");b.style.paddingLeft=(8+depth*12)+"px";b.textContent=c.id;b.onclick=()=>select(c.id);tree.append(b);branch(c.id,depth+1)}}branch(null,0);inspect(merged(byId.get(selected),device));}',
    'const messages=document.getElementById("messages");for(const warning of model.validation.warnings){const p=document.createElement("p");p.textContent=warning.code+": "+warning.detail;messages.append(p)}if(!model.validation.warnings.length)messages.textContent="结构检查通过；编辑器验收尚未执行。";',
    'for(const id of ["device","hidden","zoom"])document.getElementById(id).addEventListener("input",render);render();',
    '</script></html>',
  ].join('\n');
}

export function saveLayoutPreview(root, stageId, expectedRevision, layout) {
  const context = projectContext(root, { stageId });
  if (!context.initialized || context.revision !== expectedRevision) throw new Error('项目尚未启用或 revision 冲突；先读取 project_context');
  const stage = context.stages[0];
  if (!stage) throw new Error('阶段不存在；先登记制作计划');
  if (layout.stage_id !== stageId) throw new Error('布局 stage_id 与当前阶段不一致');
  const validation = validateLayout(layout);
  if (!validation.valid) return { committed: false, validation };
  const unique = randomUUID();
  const relativeBase = '.miliastra/layouts/' + stageId + '/layout-r' + (expectedRevision + 1) + '-' + unique;
  const jsonPath = projectFile(root, relativeBase + '.json');
  const htmlPath = projectFile(root, relativeBase + '.html');
  fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
  fs.writeFileSync(jsonPath, JSON.stringify(layout, null, 2) + '\n', { flag: 'wx' });
  fs.writeFileSync(htmlPath, previewHtml(layout, validation), { flag: 'wx' });
  const sources = [...stage.sources];
  for (const source of layout.sources || []) if (!sources.some(item => item.document_id === source.document_id && item.snapshot_id === source.snapshot_id)) sources.push(source);
  let result;
  try { result = projectCheckpoint(root, {
    expected_revision: expectedRevision, stage_id: stageId,
    status: stage.recorded_status === 'verified' ? 'needs_verification' : stage.recorded_status,
    summary: '布局合同与离线交互预览已保存；仅结构检查，未执行编辑器试玩。',
    changes_made: true,
    artifacts: [...stage.artifacts.map(item => item.file), relativeBase + '.json', relativeBase + '.html'],
    sources,
    next_action: '读取布局合同，按官方属性配置；在编辑器验证适配、排序与输入遮挡。',
  }); } catch (error) {
    return { committed: false, error: error.message, layout_path: jsonPath, preview_path: htmlPath,
      pending_artifacts: [relativeBase + '.json', relativeBase + '.html'], validation,
      action: '产物已保留，数据库未提交；读取 project_context 后合并并用 project_checkpoint 登记。', engine_simulated: false };
  }
  return { ...result, layout_path: jsonPath, preview_path: htmlPath, validation, engine_simulated: false };
}
