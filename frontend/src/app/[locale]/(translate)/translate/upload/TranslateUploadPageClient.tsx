'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useRouter, usePathname } from '@/core/i18n/navigation';

import { HistoryPanel } from '@/shared/components/translate/HistoryPanel';
import { TranslateLandingSections } from '@/shared/components/translate/TranslateLandingSections';
import type { UILang } from '@/shared/lib/translate-api';

export function TranslateUploadPageClient() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [sourceLang, setSourceLang] = useState<UILang | ''>('');
  const [targetLang, setTargetLang] = useState<UILang | ''>('');
  const [lastUploadedFile, setLastUploadedFile] = useState<{
    name: string;
    size: number;
  } | null>(null);

  useEffect(() => {
    const scrollToHistoryAnchor = () => {
      if (typeof window === 'undefined') return;
      if (window.location.hash !== '#translate-history') return;
      const el = document.getElementById('translate-history');
      if (!el) return;
      setTimeout(() => {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 80);
    };
    scrollToHistoryAnchor();
    window.addEventListener('hashchange', scrollToHistoryAnchor);
    return () => {
      window.removeEventListener('hashchange', scrollToHistoryAnchor);
    };
  }, []);

  const handleUploaded = useCallback(
    (documentId: string, filename: string, sizeBytes: number) => {
      setLastUploadedFile({ name: filename, size: sizeBytes });
      router.push(
        `/translate?document=${encodeURIComponent(documentId)}`
      );
    },
    [router]
  );

  const handleSelectTaskFromHistory = useCallback(
    (taskId: string) => {
      router.push(`/translate?task=${encodeURIComponent(taskId)}`);
    },
    [router]
  );

  const handleRequireSignInForUpload = useCallback(() => {
    const qs = searchParams.toString();
    const redirectTo = qs ? `${pathname}?${qs}` : pathname;
    router.push(`/sign-in?redirect=${encodeURIComponent(redirectTo)}`);
  }, [searchParams, pathname, router]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto">
      <TranslateLandingSections
        onUploaded={handleUploaded}
        initialFile={lastUploadedFile}
        sourceLang={sourceLang}
        targetLang={targetLang}
        onSourceLangChange={setSourceLang}
        onTargetLangChange={setTargetLang}
        onRequireSignIn={handleRequireSignInForUpload}
        funnelToolbar={
          <div id="translate-history" className="scroll-mt-24">
            <HistoryPanel onSelectTask={handleSelectTaskFromHistory} />
          </div>
        }
      />
    </div>
  );
}
