'use client';

import { useTranslations } from 'next-intl';
import { FileText } from 'lucide-react';
import { Link } from '@/core/i18n/navigation';
import { SignUser } from '@/shared/blocks/sign/sign-user';
import type { UserNav } from '@/shared/types/blocks/common';

import { useTranslateHeaderAppearance } from '@/shared/contexts/translate-header-appearance';

/**
 * 翻译页专用顶栏：品牌区（T + PDF）链首页、Pricing / Docs / History、登录与用户菜单
 */
export function TranslateShellHeader({
  userNav,
  variant = 'translate',
}: {
  userNav?: UserNav;
  variant?: 'translate' | 'ocr';
}) {
  const t = useTranslations('translate.shell');
  const brand = variant === 'ocr' ? t('brandShortOcr') : t('brandShort');
  const historyHref =
    variant === 'ocr'
      ? '/ocrtranslator#translate-history'
      : '/translate/upload#translate-history';
  const { appearance } = useTranslateHeaderAppearance();
  const onDark = appearance === 'onDark';

  return (
    <header
      className={
        onDark
          ? 'flex h-14 shrink-0 items-center justify-between border-b border-white/10 bg-slate-950/90 px-4 backdrop-blur-md sm:px-6'
          : 'flex h-14 shrink-0 items-center justify-between border-b border-zinc-200/90 bg-white/95 px-4 backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-950/95 sm:px-6'
      }
    >
      <Link
        href="/"
        title={brand}
        className={
          onDark
            ? 'flex items-center gap-2 text-zinc-100'
            : 'flex items-center gap-2 text-zinc-900 dark:text-zinc-100'
        }
      >
        <span
          className={
            onDark
              ? 'flex h-9 w-9 items-center justify-center rounded-lg bg-[#0f172a] text-lg font-bold tracking-tight text-white ring-1 ring-white/10'
              : 'flex h-9 w-9 items-center justify-center rounded-lg bg-white text-lg font-bold tracking-tight text-sky-700 shadow-sm ring-1 ring-zinc-200 dark:bg-[#1e3a5f] dark:text-white dark:shadow-none dark:ring-white/15'
          }
        >
          T
        </span>
        <span
          className={
            onDark
              ? 'flex items-center gap-1 rounded-md border border-white/15 bg-white/10 px-1.5 py-1'
              : 'flex items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-1.5 py-1 dark:border-zinc-700 dark:bg-zinc-900'
          }
        >
          <FileText
            className={
              onDark
                ? 'h-5 w-5 text-sky-200'
                : 'h-5 w-5 text-[#0f172a] dark:text-blue-300'
            }
            aria-hidden
          />
        </span>
        <span className="hidden flex-col items-start sm:flex">
          <span className="text-sm font-semibold leading-tight">{brand}</span>
          {variant === 'ocr' ? (
            <span
              className={
                onDark
                  ? 'text-[10px] font-medium leading-tight text-zinc-400'
                  : 'text-[10px] font-medium leading-tight text-zinc-500 dark:text-zinc-400'
              }
            >
              {t('brandSubtitleOcr')}
            </span>
          ) : null}
        </span>
      </Link>

      <nav className="flex items-center gap-1 sm:gap-4" aria-label={t('navAria')}>
        <Link
          href="/pricing"
          title={t('pricing')}
          className={
            onDark
              ? 'rounded-md px-2 py-1.5 text-sm font-medium text-zinc-100 hover:bg-white/10 hover:text-white'
              : 'rounded-md px-2 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100'
          }
        >
          {t('pricing')}
        </Link>
        <Link
          href="/docs"
          className={
            onDark
              ? 'rounded-md px-2 py-1.5 text-sm font-medium text-zinc-100 hover:bg-white/10 hover:text-white'
              : 'rounded-md px-2 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100'
          }
        >
          {t('docs')}
        </Link>
        <Link
          href={historyHref}
          title={t('historyNav')}
          className={
            onDark
              ? 'rounded-md px-2 py-1.5 text-sm font-medium text-zinc-100 hover:bg-white/10 hover:text-white'
              : 'rounded-md px-2 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100'
          }
        >
          {t('historyNav')}
        </Link>
        <div className="ml-1 shrink-0">
          <SignUser
            signButtonSize="sm"
            userNav={userNav}
            signInButtonClassName={
              onDark
                ? 'border-white/20 text-zinc-100 hover:bg-white/10 hover:text-white'
                : undefined
            }
          />
        </div>
      </nav>
    </header>
  );
}
