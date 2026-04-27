'use client';

import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { History } from 'lucide-react';
import { Link, useRouter } from '@/core/i18n/navigation';
import { SignUser } from '@/shared/blocks/sign/sign-user';
import type { UserNav } from '@/shared/types/blocks/common';

import { cacheBustedPublicPath, envConfigs } from '@/config';
import { useTranslateHeaderAppearance } from '@/shared/contexts/translate-header-appearance';
import { useTranslateHistoryDrawerOptional } from '@/shared/contexts/translate-history-drawer';
import { useTranslateShellChromeOptional } from '@/shared/contexts/translate-shell-chrome';

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
  const router = useRouter();
  const historyDrawer = useTranslateHistoryDrawerOptional();
  const shellChrome = useTranslateShellChromeOptional();
  const { appearance } = useTranslateHeaderAppearance();
  const onDark = appearance === 'onDark';
  const logoSrc = cacheBustedPublicPath(envConfigs.app_logo);

  if (shellChrome?.headerCollapsed) {
    return null;
  }

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
              ? 'relative flex h-9 w-9 shrink-0 overflow-hidden rounded-lg ring-1 ring-white/15'
              : 'relative flex h-9 w-9 shrink-0 overflow-hidden rounded-lg shadow-sm ring-1 ring-zinc-200 dark:ring-white/15'
          }
        >
          <Image
            src={logoSrc}
            alt=""
            width={36}
            height={36}
            className="object-contain"
            priority
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
          href="/translate"
          title={t('navPdfTranslate')}
          className={
            onDark
              ? 'rounded-md px-2 py-1.5 text-sm font-medium text-zinc-100 hover:bg-white/10 hover:text-white'
              : 'rounded-md px-2 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100'
          }
        >
          {t('navPdfTranslate')}
        </Link>
        <Link
          href="/ocrtranslator"
          title={t('navPdfOcr')}
          className={
            onDark
              ? 'rounded-md px-2 py-1.5 text-sm font-medium text-zinc-100 hover:bg-white/10 hover:text-white'
              : 'rounded-md px-2 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100'
          }
        >
          {t('navPdfOcr')}
        </Link>
        <Link
          href="/upload"
          title={t('navUpload')}
          className={
            onDark
              ? 'rounded-md px-2 py-1.5 text-sm font-medium text-zinc-100 hover:bg-white/10 hover:text-white'
              : 'rounded-md px-2 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100'
          }
        >
          {t('navUpload')}
        </Link>
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
        <button
          type="button"
          title={t('historyNav')}
          onClick={() => {
            if (historyDrawer) {
              historyDrawer.openHistory();
            } else {
              router.push('/upload#translate-history');
            }
          }}
          className={
            onDark
              ? 'inline-flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-zinc-100 hover:bg-white/10 hover:text-white'
              : 'inline-flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100'
          }
        >
          <span
            className={
              onDark
                ? 'flex h-7 w-7 items-center justify-center rounded-md bg-white/10 text-sky-200'
                : 'flex h-7 w-7 items-center justify-center rounded-md bg-sky-50 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300'
            }
            aria-hidden
          >
            <History className="size-4" />
          </span>
          {t('historyNav')}
        </button>
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
