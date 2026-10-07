import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
export const DATA = process.env.MILIASTRA_DATA_DIR || path.join(ROOT, 'data');
export const MODEL_NAME = 'bge-small-zh-v1.5';
export const MODEL_REVISION = '75c43b069aac4d136ba6bc1122f995fedcfd2781';
export const MODEL_DIR = path.join(DATA, 'models', MODEL_NAME);
export const MODEL_FILES = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json', 'onnx/model_quantized.onnx'];
export const SOURCES = ['knowledge', 'course', 'faq'];
export function catalogUrl(category) {
  return `https://act-webstatic.mihoyo.com/ugc-tutorial/${category}/cn/zh-cn/catalog.json?game_biz=hk4eugc_cn&lang=zh-cn`;
}
export function contentUrl(category, id) {
  return `https://act-webstatic.mihoyo.com/ugc-tutorial/${category}/cn/zh-cn/${id}/content.html?v=1016`;
}
export function officialUrl(category, id) {
  const middle = category === 'knowledge' ? '' : `${category}/`;
  return `https://act.mihoyo.com/ys/ugc/tutorial/${middle}detail/${id}`;
}
