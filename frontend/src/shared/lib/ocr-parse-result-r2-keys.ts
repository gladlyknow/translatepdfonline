import { languagesNeedTranslation } from '@/shared/lib/ocr-lang';
import { getObjectBody } from '@/shared/lib/translate-r2';

export function ocrParseResultSourceKey(taskId: string): string {
  return `translations/${taskId}/ocr-parse-result.json`;
}

/** 源语言 ≠ 目标语言时，翻译后的版面 JSON（Workbench / PDF 优先读此文件） */
export function ocrParseResultTargetKey(taskId: string): string {
  return `translations/${taskId}/ocr-parse-result-target.json`;
}

/** 读取用于展示/导出的 parse JSON：需要翻译且目标文件存在时用 target，否则源文件 */
export async function getOcrParseResultBodyForRead(
  taskId: string,
  sourceLang: string,
  targetLang: string
): Promise<Uint8Array> {
  if (languagesNeedTranslation(sourceLang, targetLang)) {
    try {
      return await getObjectBody(ocrParseResultTargetKey(taskId));
    } catch {
      /* 翻译尚未写入或失败，回退 OCR 原文 */
    }
  }
  return getObjectBody(ocrParseResultSourceKey(taskId));
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
  try {
    await getObjectBody(ocrParseResultTargetKey(taskId));
    return ocrParseResultTargetKey(taskId);
  } catch {
    return ocrParseResultSourceKey(taskId);
  }
}
