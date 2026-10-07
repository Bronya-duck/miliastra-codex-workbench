import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '../runtime/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from '../runtime/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';
const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const client = new Client({ name: 'workbench-diagnostic', version: '0.4.0' });
try {
  const args = process.argv.slice(2);
  const configIndex = args.indexOf('--config');
  const configFile = configIndex === -1 ? path.join(root, 'plugin/.mcp.json') : path.resolve(args[configIndex + 1]);
  const config = JSON.parse(fs.readFileSync(configFile, 'utf8')).mcpServers.miliastra;
  const transport = new StdioClientTransport({ ...config, env: { ...process.env, ...config.env, ...(args.includes('--offline') ? { MILIASTRA_OFFLINE: '1' } : {}) }, stderr: 'pipe' });
  await client.connect(transport);
  const toolList = await client.listTools();
  const invoke = async (name, input) => {
    const response = await client.callTool({ name, arguments: input });
    if (response.isError) throw new Error(name + ': ' + response.content[0].text);
    return { result: JSON.parse(response.content[0].text).result, image_count: response.content.filter(block => block.type === 'image').length };
  };
  const documents = (await invoke('list_documents', {})).result;
  const lua = (await invoke('get_client_document', { titles: ['mhbgxf0nynww'] })).result[0];
  if (lua.status !== 'ok') throw new Error('客户端脚本资料尚未准备');
  const doc = lua.documents[0];
  const image = doc.images.find(item => item.frames > 1) || doc.images[0];
  const reading = image ? await invoke('get_document_image', { image_id: image.id }) : null;
  const search = (await invoke('rag_search', { queries: ['按钮点击事件与客户端脚本'], scope: 'client', top_k: 3 })).result;
  const report = {
    passed: toolList.tools.length === 14 && documents.total > 0 && search[0].results.length > 0,
    network_blocked_by_runtime: args.includes('--offline'),
    tools: toolList.tools.map(tool => tool.name), document_count: documents.total,
    lua_document: { id: doc.document_id, snapshot_id: doc.snapshot_id, characters: doc.content.length },
    image: image ? { id: image.id, original_frames: image.frames, returned_frames: reading.image_count } : null,
    search_hits: search[0].results.map(item => ({ id: item.document_id, title: item.title, similarity: item.similarity })),
  };
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
} catch (error) { console.error(JSON.stringify({ passed: false, error: error.message, action: '先 configure 并准备资料；检查 MCP 配置和 doctor。' })); process.exitCode = 1; }
finally { await client.close(); }
