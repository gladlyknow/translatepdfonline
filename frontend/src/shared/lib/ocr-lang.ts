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

export function languagesNeedTranslation(sourceLang: string, targetLang: string): boolean {
  const src = canonicalLangCode(sourceLang);
  const tgt = canonicalLangCode(targetLang);
  if (!src || !tgt) return false;
  return src !== tgt;
}
