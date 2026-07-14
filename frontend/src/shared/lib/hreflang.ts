import { envConfigs } from '@/config';
import { defaultLocale, locales } from '@/config/locale';

/**
 * 构建某个页面 path 在指定 locale 下的完整 URL（遵循 localePrefix: 'as-needed'）。
 * @param path 页面相对路径，如 '/'、'/pdf-to-text'
 * @param loc locale 代码
 */
export function localeUrl(path: string, loc: string): string {
  const base = (envConfigs.app_url || '').replace(/\/+$/, '');
  const cleanPath = path === '/' ? '' : path.startsWith('/') ? path : `/${path}`;
  if (loc === defaultLocale) {
    return `${base}${cleanPath || '/'}`;
  }
  return `${base}/${loc}${cleanPath}`;
}

/**
 * 为某个页面 path 生成 canonical + 各 locale 的 hreflang 映射（含 x-default）。
 * 用于 metadata.alternates，使每个页面输出指向「该页」各语言版本的 hreflang，
 * 而非统一指向首页。
 */
export function buildAlternates(path: string, locale: string): {
  canonical: string;
  languages: Record<string, string>;
} {
  const canonical = localeUrl(path || '/', locale);
  const languages: Record<string, string> = {};
  for (const loc of locales) {
    languages[loc] = localeUrl(path || '/', loc);
  }
  languages['x-default'] = localeUrl(path || '/', defaultLocale);
  return { canonical, languages };
}
