import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { Knowledge } from './knowledge.mjs';
import { UpdateNotifier } from './updates.mjs';
import { readJson } from './io.mjs';
import { DATA } from './paths.mjs';
import path from 'node:path';
import { registerWorkbenchTools } from './workbench/tools.mjs';

const server=new McpServer({name:'miliastra-codex-workbench',version:'0.4.0'});
registerWorkbenchTools(server);
let knowledgePromise;
let notifier;
let loadedSnapshot;
async function knowledge() {
  const pointer=await readJson(path.join(DATA,'active.json'));
  if (pointer.snapshot_id!==loadedSnapshot) { knowledgePromise=undefined; loadedSnapshot=pointer.snapshot_id; }
  return knowledgePromise ||= Knowledge.load().then((value)=>{notifier=new UpdateNotifier(value.manifest);return value;}).catch((error)=>{knowledgePromise=undefined;throw error;});
}
const requiredList=z.array(z.string().trim().min(1)).min(1).max(20);
const optionalKeywords=z.array(z.string().trim().min(1)).max(20).optional();
function register(name,description,inputSchema,execute) {
  server.registerTool(name,{description,inputSchema,annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}},async(args)=>{
    try {
      const kb=await knowledge();
      const activeNotifier=notifier;
      // Checks never modify the active snapshot; run concurrently with the local query.
      const updatePromise=activeNotifier.notification();
      const result=await execute(kb,args);
      // A network check cannot hold an offline query beyond this short deadline.
      const update=await Promise.race([updatePromise,new Promise((resolve)=>{const timer=setTimeout(()=>resolve(undefined),1200);timer.unref();})]);
      activeNotifier.delivered(update);
      if(result?.images && result?.metadata) return {content:[{type:'text',text:JSON.stringify({result:result.metadata,update_check:update},null,2)},...result.images]};
      return {content:[{type:'text',text:JSON.stringify({result,update_check:update},null,2)}]};
    }catch(error){return {isError:true,content:[{type:'text',text:JSON.stringify({error:error.message,action:'资料准备问题请运行 doctor；不能把工具错误解释为没有文档。'})}]};}
  });
}
register('get_node_info','查询千星奇域节点的完整说明、参数、归属端和官方来源。支持节点名模糊匹配和批量；组件和系统请查文档。',{names:requiredList},(kb,args)=>kb.getNodes(args.names));
register('list_documents','列出全部当前中文官方文档标题；可按关键词过滤。省略 keywords 或传 [] 均列出全部。',{keywords:optionalKeywords},(kb,args)=>kb.listDocuments(args.keywords));
register('get_document','按标题或文档 ID 获取完整官方正文、图片 ID/本地原件和官方链接。匹配超过5篇时返回候选标题，请收窄关键词。',{titles:requiredList},(kb,args)=>kb.getDocuments(args.titles));
register('rag_search','本地中文 BGE 向量语义检索官方原文片段和关联图片。相似度表示相关性；重要结论需获取全文，图中信息需实际识图。',{queries:requiredList,top_k:z.number().int().min(1).max(20).optional(),scope:z.enum(['all','general','client']).optional()},(kb,args)=>kb.search(args.queries,args.top_k,args.scope));
register('list_client_documents','列出客户端控件和 Lua 脚本官方资料，包含最新客户端脚本教程。省略 keywords 或 [] 列出全部客户端资料。',{keywords:optionalKeywords},(kb,args)=>kb.listDocuments(args.keywords,true));
register('get_client_document','获取客户端控件和 Lua 脚本官方资料全文及图片。按标题或 ID 查询，最多5篇匹配返回全文。',{titles:requiredList},(kb,args)=>kb.getDocuments(args.titles,true));
register('get_document_image','实际读取本地官方原图并返回可识别的图片内容。支持局部放大；SVG转PNG；GIF默认最多5个代表帧，可指定帧。',{image_id:z.string().regex(/^img_[a-f0-9]{24}$/),crop:z.object({x:z.number().int().min(0),y:z.number().int().min(0),width:z.number().int().min(1),height:z.number().int().min(1)}).optional(),frame_indices:z.array(z.number().int().min(0)).min(1).max(8).optional()},(kb,args)=>kb.getImage(args.image_id,args));
await server.connect(new StdioServerTransport());
