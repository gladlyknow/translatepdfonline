'use client';

import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import {
  BookOpen,
  CloudDownload,
  History,
  Languages,
  Upload,
} from 'lucide-react';

import { UploadDropzone } from '@/shared/components/translate/UploadDropzone';
import {
  TranslateLanguagePickers,
} from '@/shared/components/translate/TranslationForm';
import { BeforeAfterPdfCompare } from '@/shared/components/translate/BeforeAfterPdfCompare';
import type { UILang } from '@/shared/lib/translate-api';

type Props = {
  onUploaded: (
    documentId: string,
    filename: string,
    sizeBytes: number,
    file?: File
  ) => void;
  initialFile: { name: string; size: number } | null;
  sourceLang: UILang | '';
  targetLang: UILang | '';
  onSourceLangChange: (v: UILang | '') => void;
  onTargetLangChange: (v: UILang | '') => void;
  onRequireSignIn?: () => void;
  /** 漏斗顶栏（例如上传页的 History） */
  funnelToolbar?: ReactNode;
  /** Hero 标题下方的快捷入口行 */
  heroActions?: ReactNode;
  /** 上传完成后的后续动作 */
  postUploadActions?: ReactNode;
};

export function TranslateLandingSections({
  onUploaded,
  initialFile,
  sourceLang,
  targetLang,
  onSourceLangChange,
  onTargetLangChange,
  onRequireSignIn,
  funnelToolbar,
  heroActions,
  postUploadActions,
}: Props) {
  const t = useTranslations('translate.home');
  const { resolvedTheme } = useTheme();
  const [themeMounted, setThemeMounted] = useState(false);

  useEffect(() => {
    setThemeMounted(true);
  }, []);

  const isDarkFunnel = themeMounted && resolvedTheme === 'dark';

  const trustItems = [
    t('trustDeepSeek'),
    t('trustPdf2zh'),
    t('trustLatex'),
    t('trustMultilang'),
  ];

  const stepIconClass =
    'flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-slate-900 to-sky-700 text-white shadow-[0_4px_14px_0_rgba(3,105,161,0.3)] ring-1 ring-white/15 dark:from-slate-800 dark:to-sky-600 dark:shadow-[0_4px_18px_0_rgba(56,189,248,0.18)] dark:ring-white/10';

  const steps = [
    { icon: Upload, title: t('step1Title'), desc: t('step1Desc') },
    { icon: BookOpen, title: t('step2Title'), desc: t('step2Desc') },
    { icon: Languages, title: t('step3Title'), desc: t('step3Desc') },
    { icon: CloudDownload, title: t('step4Title'), desc: t('step4Desc') },
    { icon: History, title: t('step5Title'), desc: t('step5Desc') },
  ];

  const formatPills = [
    t('formatPdf'),
    t('formatAcademic'),
    t('formatManual'),
    t('formatBook'),
  ];

  const seoKeywords = [
    t('seoKeyword1'),
    t('seoKeyword2'),
    t('seoKeyword3'),
    t('seoKeyword4'),
    t('seoKeyword5'),
  ];

  return (
    <>
      {/* Hero + 信任条：浅色默认，深色 dark: */}
      <section className="relative overflow-hidden bg-gradient-to-b from-slate-50 via-sky-50/30 to-zinc-100 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
        <div
          className="pointer-events-none absolute inset-0 opacity-30 dark:hidden"
          style={{
            backgroundImage:
              'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(14,165,233,0.22), transparent)',
          }}
          aria-hidden
        />
        <div
          className="pointer-events-none absolute inset-0 hidden opacity-40 dark:block"
          style={{
            backgroundImage:
              'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(56,189,248,0.25), transparent)',
          }}
          aria-hidden
        />

        <div className="relative z-[1] mx-auto flex w-full max-w-4xl flex-col items-center px-4 pb-10 pt-8 sm:pb-14 sm:pt-12">
          {funnelToolbar ? (
            <div className="mb-6 flex w-full flex-wrap items-center justify-end gap-2">
              {funnelToolbar}
            </div>
          ) : null}
          <h1 className="text-center text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-4xl md:text-[2.35rem] md:leading-tight">
            {t('heroTitle')}
          </h1>
          <p className="mt-4 max-w-2xl text-center text-base text-zinc-600 dark:text-zinc-300 sm:text-lg">
            {t('heroSubtitle')}
          </p>
          {heroActions ? (
            <div className="mt-4 flex w-full justify-center">{heroActions}</div>
          ) : null}

          <div className="mt-10 w-full">
            <UploadDropzone
              onUploaded={onUploaded}
              initialFile={initialFile}
              variant="hero"
              heroTone={isDarkFunnel ? 'dark' : 'light'}
              onRequireSignIn={onRequireSignIn}
            />
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              {formatPills.map((label) => (
                <span
                  key={label}
                  className="rounded-full border border-zinc-200 bg-white/80 px-3 py-1 text-xs font-medium text-zinc-700 backdrop-blur-sm dark:border-white/15 dark:bg-white/5 dark:text-zinc-200"
                >
                  {label}
                </span>
              ))}
            </div>
            <p className="mt-4 text-center text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-500">
              {t('uploadFileNotice')}
            </p>
          </div>

          <div className="mt-6 w-full">
            <TranslateLanguagePickers
              sourceLang={sourceLang}
              targetLang={targetLang}
              onSourceLangChange={onSourceLangChange}
              onTargetLangChange={onTargetLangChange}
              appearance={isDarkFunnel ? 'funnelDark' : 'default'}
            />
          </div>
          {postUploadActions ? (
            <div className="mt-4 flex w-full justify-center">{postUploadActions}</div>
          ) : null}

          <div className="mt-12 w-full">
            <BeforeAfterPdfCompare imageFit="contain" />
          </div>

          <div className="mt-12 w-full border-t border-zinc-200 pt-8 dark:border-white/10">
            <p className="mb-4 text-center text-xs font-medium uppercase tracking-wider text-zinc-500">
              {t('trustBarLabel')}
            </p>
            <ul className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-sm text-zinc-700 dark:text-zinc-300">
              {trustItems.map((item) => (
                <li key={item} className="font-medium">
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* 与首页「如何翻译 PDF」相同的五步说明；图标 slate→sky 渐变与全站主 CTA 一致 */}
      <section className="border-t border-zinc-200 bg-zinc-50 py-14 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="mx-auto max-w-6xl px-4">
          <h2 className="text-center text-xl font-semibold text-zinc-900 dark:text-zinc-50 sm:text-2xl">
            {t('stepsSectionTitle')}
          </h2>
          <p className="mx-auto mt-2 max-w-2xl text-center text-sm text-zinc-600 dark:text-zinc-400">
            {t('stepsSectionDescription')}
          </p>
          <div className="mt-10 grid grid-cols-1 gap-8 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3 xl:grid-cols-5">
            {steps.map(({ icon: Icon, title, desc }) => (
              <div
                key={title}
                className="flex flex-col items-center text-center sm:items-start sm:text-left"
              >
                <span className={stepIconClass}>
                  <Icon className="h-6 w-6" aria-hidden strokeWidth={2} />
                </span>
                <h3 className="mt-4 text-base font-semibold text-zinc-900 dark:text-zinc-100">
                  {title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                  {desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SEO 文案 — 可见标题与段落 */}
      <section className="border-t border-zinc-200 bg-white py-14 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto max-w-3xl px-4 text-zinc-800 dark:text-zinc-200">
          <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50 sm:text-2xl">
            {t('seoTitle')}
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            {t('seoP1')}
          </p>
          <p className="mt-4 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            {t('seoP2')}
          </p>
          <h3 className="mt-8 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {t('seoKeywordsHeading')}
          </h3>
          <ul className="mt-3 flex flex-wrap gap-2">
            {seoKeywords.map((kw) => (
              <li
                key={kw}
                className="rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
              >
                {kw}
              </li>
            ))}
          </ul>
        </div>
      </section>
    </>
  );
}
