import * as cheerio from 'cheerio';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { hash } from './io.mjs';
import path from 'node:path';

export function localMarkdown(parsed,document,assets,dataDirectory) {
  const body=parsed.markdown.replace(/miliastra-image:(img_[a-f0-9]+)/g,(_,id)=>path.join(dataDirectory,assets[id].local_path).replaceAll('\\','/'));
  const pictures=[...new Map(parsed.images.map(image=>[image.id,image])).values()];
  const references=pictures.map(image=>`- ${image.id}：[本地原图](${path.join(dataDirectory,assets[image.id].local_path).replaceAll('\\','/')}) · [官方原图](${image.url})`);
  return body+`\n---\n\n资料来源：[${document.title}](${document.official_url})；文档 ID：${document.id}；官方更新时间：${document.updated_at || '未提供'}。\n`+(references.length?'\n### 引用图片来源\n\n'+references.join('\n')+'\n':'');
}

export function parseOfficialHtml(html, entry, pageUrl) {
  const $ = cheerio.load(html);
  $('script,style,noscript,template').remove();
  const images = [];
  $('img').each((index, element) => {
    const image = $(element);
    const original = image.attr('src') || image.attr('data-src');
    if (!original) throw new Error(`Image without source in ${entry.id}`);
    const url = new URL(original, pageUrl);
    if (url.protocol !== 'https:') throw new Error(`Non-HTTPS official image in ${entry.id}: ${url}`);
    const imageId = 'img_' + hash(url.href).slice(0, 24);
    const nearestHeading = image.parents().addBack().map((_, parent) => $(parent).prevAll('h1,h2,h3,h4,h5,h6').first().text()).get().find(Boolean) || entry.title;
    const context = image.parent().text().trim().slice(0, 1000);
    images.push({ id: imageId, url: url.href, ordinal: index + 1, alt: image.attr('alt') || '', heading: nearestHeading, context });
    image.attr('src', `miliastra-image:${imageId}`);
  });
  const videos = [];
  $('video source,video,iframe').each((_, element) => {
    const original = $(element).attr('src');
    if (original) videos.push(new URL(original, pageUrl).href);
  });
  // GFM retains tables without TH headers as HTML. Strip editor-only attributes
  // before either conversion route so table cells, rather than styles, are indexed.
  $('table,table *').each((_,element)=>{
    for(const name of Object.keys(element.attribs || {})) {
      if(['rowspan','colspan'].includes(name) && Number(element.attribs[name])>1)continue;
      if(['src','alt','href'].includes(name))continue;
      $(element).removeAttr(name);
    }
  });
  const converter = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', emDelimiter: '*', strongDelimiter: '**' });
  converter.use(gfm);
  converter.addRule('completeComplexTables', {
    filter: (node) => node.nodeName === 'TABLE' && [...node.querySelectorAll('[rowspan],[colspan]')].some((cell)=>Number(cell.getAttribute('rowspan'))>1 || Number(cell.getAttribute('colspan'))>1),
    replacement: (_, node) => {
      const copy=node.cloneNode(true);
      // Preserve merged cells and content. Editor IDs and styling remain in source.html.
      for(const element of [copy,...copy.querySelectorAll('*')]) for(const attribute of [...element.attributes]) {
        if(!['rowspan','colspan','src','alt','href'].includes(attribute.name)) element.removeAttribute(attribute.name);
      }
      return '\n\n' + copy.outerHTML + '\n\n';
    },
  });
  converter.addRule('videoReferences', {
    filter: ['video','iframe'],
    replacement: (_, node) => {
      const source = node.getAttribute('src') || node.querySelector('source')?.getAttribute('src');
      return source ? `\n\n[官方视频](${new URL(source,pageUrl).href})\n\n` : '';
    },
  });
  const body = converter.turndown($('body').html() || $.html()).trim();
  if (!body) throw new Error(`Empty official article ${entry.id}`);
  return { markdown: `# ${entry.title}\n\n${body}\n`, images, videos: [...new Set(videos)] };
}

export function headingText(value) {
  return value.replace(/\\([.()])/g,'$1').replace(/[*_`]/g, '').replace(/^(?:\d+[.、]\s*|[（(]?\d+[)）]\s*)+/, '').replace(/\s+/g, ' ').trim();
}
export function splitSections(markdown) {
  const sections = [];
  let start = 0, position = 0, fence = '', headings = [];
  for (const line of markdown.split(/(?<=\n)/)) {
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      if (!fence) fence = fenceMatch[1][0];
      else if (fenceMatch[1][0] === fence) fence = '';
    }
    const match = !fence && line.match(/^(#{1,6})\s+(.+)/);
    if (match) {
      if (position > start) sections.push({ start, end: position, heading: headings.join(' / '), text: markdown.slice(start, position) });
      headings = headings.slice(0, match[1].length - 1);
      headings[match[1].length - 1] = headingText(match[2]);
      start = position;
    }
    position += line.length;
  }
  if (position > start) sections.push({ start, end: position, heading: headings.join(' / '), text: markdown.slice(start, position) });
  return sections;
}

export function deriveNodes(documents, bodies) {
  const groups = ['执行节点','事件节点','流程控制节点','查询节点','运算节点','其它节点'];
  const merged = new Map();
  for (const document of documents) {
    if (document.category !== 'knowledge' || !groups.some((group) => document.title.includes(group))) continue;
    const markdown = bodies.get(document.id);
    let mainTitle = document.title, current = null, fenced = false;
    const locations=document.catalog_locations?.length?document.catalog_locations:[{ancestors:document.ancestors || []}];
    const paths=locations.map(location=>location.ancestors || []);
    const catalogClient=paths.some(ancestors=>ancestors.includes('客户端节点'));
    const catalogServer=paths.some(ancestors=>ancestors.some(title=>/^(?:服务器|服务端)节点$/.test(title)));
    const verified=catalogClient || catalogServer;
    const side=catalogClient && catalogServer?'both':catalogClient?'client':catalogServer?'server':'unknown';
    const sideBasis=verified?'官方目录：'+paths.map(ancestors=>ancestors.join(' / ')).join('；'):'官方目录未提供可核实归属端；需查阅正文确认';
    const flush = () => {
      if (!current || !current.lines.join('\n').trim()) return;
      const content = current.lines.join('\n').trim();
      const key = current.title + '\n' + content.replace(/\s+/g, ' ');
      const source = { document_id: document.id, title: document.title, official_url: document.official_url, main_title: current.mainTitle, side, side_basis:sideBasis,side_verified:verified,graph_type:verified?(catalogServer&&!catalogClient?'实体节点图':paths.find(ancestors=>ancestors.includes('客户端节点'))?.at(-1)):undefined };
      const previous = merged.get(key);
      if (previous) {
        previous.sources.push(source);
        const sides = new Set(previous.sources.map((source) => source.side));
        previous.side = sides.has('both') || (sides.has('client') && sides.has('server')) ? 'both' : sides.has('unknown') ? 'unknown' : side;
      } else merged.set(key, { title: current.title, main_title: current.mainTitle, side, content, sources: [source], image_ids: [...new Set([...content.matchAll(/miliastra-image:(img_[a-f0-9]+)/g)].map((match) => match[1]))] });
    };
    for (const line of markdown.split('\n')) {
      if (/^\s*(`{3,}|~{3,})/.test(line)) fenced = !fenced;
      if (!fenced && line.startsWith('# ')) { flush(); current = null; mainTitle = headingText(line.slice(2)); }
      else if (!fenced && line.startsWith('## ')) { flush(); current = { title: headingText(line.slice(3)), mainTitle, lines: [] }; }
      else if (current) current.lines.push(line);
    }
    flush();
  }
  return [...merged.values()];
}
