import { languagesNeedTranslation } from '@/shared/lib/ocr-lang';
import { getObjectBody, r2ObjectExists } from '@/shared/lib/translate-r2';

export function ocrParseResultSourceKey(taskId: string): string {
  return `translations/${taskId}/ocr-parse-result.json`;
}

/** 源语言 ≠ 目标语言时，翻译后的版面 JSON（Workbench / PDF 优先读此文件） */
export function ocrParseResultTargetKey(taskId: string): string {
  return `translations/${taskId}/ocr-parse-result-target.json`;
}

/** 与 `getOcrParseResultBodyForRead` 使用同一套规则，供 presign / 日志与 GET 对齐 */
export async function resolveOcrParseResultReadKey(
  taskId: string,
  sourceLang: string,
  targetLang: string
): Promise<{ key: string; variant: 'target' | 'source' }> {
  if (languagesNeedTranslation(sourceLang, targetLang)) {
    if (await r2ObjectExists(ocrParseResultTargetKey(taskId))) {
      return { key: ocrParseResultTargetKey(taskId), variant: 'target' };
    }
  }
  return { key: ocrParseResultSourceKey(taskId), variant: 'source' };
}

/** 读取用于展示/导出的 parse JSON：需要翻译且目标文件存在时用 target，否则源文件 */
export async function getOcrParseResultBodyForRead(
  taskId: string,
  sourceLang: string,
  targetLang: string
): Promise<Uint8Array> {
  const { key } = await resolveOcrParseResultReadKey(taskId, sourceLang, targetLang);
  return getObjectBody(key);
}

export async function resolveOcrParseResultSaveKey(params: {
  taskId: string;
  sourceLang: string;
  targetLang: string;
}): Promise<string> {
  const { taskId, sourceLang, targetLang } = params;
  if (!languagesNeedTranslation(sourceLang, targetLang)) {
    return ocrParseResultSourceKey(taskId);
  }
  if (await r2ObjectExists(ocrParseResultTargetKey(taskId))) {
    return ocrParseResultTargetKey(taskId);
  }
  return ocrParseResultSourceKey(taskId);
}
