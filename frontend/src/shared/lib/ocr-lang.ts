/**
 * 语言代码规范化，用于判断「是否需要翻译」及选用哪份 Markdown。
 * 避免 zh / zh-CN / zh-Hans 等与 en / en-US 被误判为不同语种而重复翻译或跳过翻译。
 */
export function canonicalLangCode(raw: string): string {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return '';
  if (s.startsWith('zh')) return 'zh';
  if (s.startsWith('en')) return 'en';
  if (s.startsWith('ja')) return 'ja';
  if (s.startsWith('ko')) return 'ko';
  const base = s.split(/[-_]/)[0];
  return base || s;
}

/**
 * 仅当用户主动选了 target_lang 才进入 DeepSeek 翻译。
 * 不再比较 source vs target：source 在 OCR 任务中可能未选（空串），
 * 或被默认成与 target 相同的值（旧逻辑会误跳过翻译，见 task=9uVc8JKu0KuKuqdnlKHXX）。
 */
export function languagesNeedTranslation(_sourceLang: string, targetLang: string): boolean {
  return Boolean(canonicalLangCode(targetLang));
}
