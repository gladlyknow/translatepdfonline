'use client';

import { useCallback, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useRouter, usePathname } from '@/core/i18n/navigation';

import { TranslateLandingSections } from '@/shared/components/translate/TranslateLandingSections';
import type { UILang } from '@/shared/lib/translate-api';

export function UploadPageClient() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [sourceLang, setSourceLang] = useState<UILang | ''>('');
  const [targetLang, setTargetLang] = useState<UILang | ''>('');
  const [lastUploadedFile, setLastUploadedFile] = useState<{
    name: string;
    size: number;
  } | null>(null);

  const handleUploaded = useCallback(
    async (_documentId: string, filename: string, sizeBytes: number) => {
      setLastUploadedFile({ name: filename, size: sizeBytes });
    },
    []
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
      />
    </div>
  );
}
