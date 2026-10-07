import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { previewHtml } from '../runtime/workbench/layout.mjs';

// Small in-memory DOM harness: executes the generated script, never starts a browser.
class Element {
  constructor(tag) {
    this.tag = tag; this.children = []; this.listeners = {}; this.style = {}; this.dataset = {};
    this.textContent = ''; this.value = ''; this.checked = false; this.hidden = false;
  }
  append(child) { this.children.push(child); if (this.tag === 'select' && !this.value) this.value = child.value; }
  replaceChildren() { this.children = []; }
  addEventListener(type, callback) { this.listeners[type] = callback; }
  dispatch(type, event = {}) { this.listeners[type]?.({ stopPropagation() {}, ...event }); }
}
test('生成脚本在内存 DOM 中切换设备、隐藏控件并检查选中属性与依赖', () => {
  const layout = JSON.parse(fs.readFileSync(new URL('../examples/layout.json', import.meta.url), 'utf8'));
  const html = previewHtml(layout);
  const elements = new Map();
  for (const id of ['model','title','tree','device','hidden','zoom','viewport','canvas','selected','properties','dependencies','messages']) elements.set(id, new Element(id === 'device' ? 'select' : 'div'));
  elements.get('model').textContent = html.match(/<script type="application\/json" id="model">([\s\S]*?)<\/script>/)[1];
  elements.get('zoom').value = '0.5';
  const document = { getElementById: id => elements.get(id), createElement: tag => new Element(tag) };
  const script = html.match(/<script>\n([\s\S]*?)<\/script>/)[1];
  vm.runInNewContext(script, { document }, { timeout: 1000 });
  const find = (element, id) => element.dataset.controlId === id ? element : element.children.map(child => find(child, id)).find(Boolean);
  assert.equal(elements.get('device').children.length, 2);
  assert.equal(find(elements.get('canvas'), 'Modal').hidden, true);
  assert.equal(find(elements.get('canvas'), 'Help').style.height, '60px');
  elements.get('device').value = 'touch'; elements.get('device').dispatch('input');
  assert.equal(find(elements.get('canvas'), 'Help').style.height, '80px');
  elements.get('hidden').checked = true; elements.get('hidden').dispatch('input');
  assert.equal(find(elements.get('canvas'), 'Modal').hidden, false);
  find(elements.get('canvas'), 'Close').dispatch('click');
  assert.equal(JSON.parse(elements.get('properties').textContent).id, 'Close');
  assert.ok(elements.get('dependencies').children.some(row => row.textContent.includes('Modal')));
  const countButton = elements.get('tree').children.find(button => button.textContent === 'Count');
  countButton.onclick();
  assert.equal(JSON.parse(elements.get('properties').textContent).id, 'Count');
});
