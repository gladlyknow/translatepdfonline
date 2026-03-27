'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/shared/lib/utils';
import type { UILang } from '@/shared/lib/translate-api';

const LANGS: { value: UILang; labelKey: string }[] = [
  { value: 'en', labelKey: 'en' },
  { value: 'zh', labelKey: 'zh' },
  { value: 'es', labelKey: 'es' },
  { value: 'fr', labelKey: 'fr' },
  { value: 'it', labelKey: 'it' },
  { value: 'el', labelKey: 'el' },
  { value: 'ja', labelKey: 'ja' },
  { value: 'ko', labelKey: 'ko' },
  { value: 'de', labelKey: 'de' },
  { value: 'ru', labelKey: 'ru' },
];

type Props = {
  value: UILang | '';
  onChange: (v: UILang | '') => void;
  label?: string;
  placeholderKey?: 'selectSourceLang' | 'selectTargetLang';
  compact?: boolean;
  /** 深色 Hero：浅色标签与半透明控件 */
  tone?: 'default' | 'darkHero';
};

export function LanguageSelector({
  value,
  onChange,
  label,
  placeholderKey,
  compact = false,
  tone = 'default',
}: Props) {
  const tLang = useTranslations('translate.languages');
  const tTranslate = useTranslations('translate.translate');
  const darkHero = tone === 'darkHero';
  return (
    <div className={`flex min-w-0 flex-col gap-0.5 ${compact ? 'w-full max-w-[130px]' : ''}`}>
      {label && (
        <label
          className={`font-medium ${compact ? 'text-xs' : 'text-sm'} ${
            darkHero
              ? 'text-zinc-200'
              : 'text-zinc-600 dark:text-zinc-400'
          }`}
        >
          {label}
        </label>
      )}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as UILang | '')}
        className={
          darkHero
            ? cn(
                'translate-funnel-lang-select',
                compact
                  ? 'min-h-[36px] rounded-lg px-2.5 py-1.5 text-sm'
                  : 'min-h-[44px] rounded-lg px-3 py-2 text-base'
              )
            : compact
              ? 'min-h-[36px] rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800'
              : 'min-h-[44px] rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base dark:border-zinc-600 dark:bg-zinc-800'
        }
      >
        <option value="">
          {placeholderKey ? tTranslate(placeholderKey) : ''}
        </option>
        {LANGS.map(({ value: v, labelKey }) => (
          <option key={v} value={v}>
            {tLang(labelKey)}
          </option>
        ))}
      </select>
    </div>
  );
}
