import type { UILang } from '@/shared/lib/translate-api';

export const SUPPORTED_UI_LANGS: UILang[] = [
  'en',
  'zh',
  'es',
  'fr',
  'it',
  'el',
  'ja',
  'ko',
  'de',
  'ru',
];

export const SUPPORTED_UI_LANG_SET = new Set<UILang>(SUPPORTED_UI_LANGS);

export function toSupportedUiLang(raw: string | null | undefined): UILang | '' {
  const low = String(raw || '').trim().toLowerCase();
  return SUPPORTED_UI_LANG_SET.has(low as UILang) ? (low as UILang) : '';
}

export function isSupportedUiLang(raw: string | null | undefined): raw is UILang {
  return SUPPORTED_UI_LANG_SET.has(String(raw || '').trim().toLowerCase() as UILang);
}
