import path from 'node:path';
import { DATA, MODEL_NAME, MODEL_REVISION } from './paths.mjs';

let modelPromise;
export function getModel() {
  return modelPromise ||= (async () => {
    const { env, pipeline } = await import('@huggingface/transformers');
    env.allowRemoteModels = false;
    env.localModelPath = path.join(DATA, 'models') + path.sep;
    const extractor = await pipeline('feature-extraction', MODEL_NAME, { device: 'cpu', dtype: 'q8', local_files_only: true });
    return { extractor, tokenizer: extractor.tokenizer, revision: MODEL_REVISION };
  })().catch((error) => { modelPromise = undefined; throw error; });
}
export async function embed(text, query = false) {
  const { extractor } = await getModel();
  const result = await extractor(query ? '为这个句子生成表示以用于检索相关文章：' + text : text, { pooling: 'cls', normalize: true });
  return Float32Array.from(result.data);
}
export async function chunkSections(document, sections) {
  const { tokenizer } = await getModel();
  const output = [];
  for (const section of sections) {
    const prefix = `${document.title}\n${section.heading}\n`;
    let start = 0;
    while (start < section.text.length) {
      let low = start + 1, high = Math.min(section.text.length, start + 2400), end = low;
      while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        const count = tokenizer.encode(prefix + section.text.slice(start, middle)).length;
        if (count <= 480) { end = middle; low = middle + 1; } else high = middle - 1;
      }
      const text = section.text.slice(start, end);
      output.push({ document_id: document.id, heading: section.heading, text, embedding_text: prefix + text, start: section.start + start, end: section.start + end, image_ids: [...new Set([...text.matchAll(/miliastra-image:(img_[a-f0-9]+)/g)].map((match) => match[1]))] });
      if (end === section.text.length) break;
      start = Math.max(start + 1, end - 100);
    }
  }
  return output;
}
