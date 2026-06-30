'use client';

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import Image from 'next/image';
import { Link } from '@/core/i18n/navigation';

const FALLBACKS: Record<string, string> = {
  exploreMoreHeading: 'Explore More Document Tools',
  explorePdfToText: 'PDF OCR & Text Extraction',
  explorePdfToTextDesc: 'Extract text from PDF documents with AI-powered OCR.',
  exploreImageToText: 'AI Image to Text Converter',
  exploreImageToTextDesc: 'Convert images to editable, searchable text.',
  explorePdfTranslate: 'AI PDF Translation Tool',
  explorePdfTranslateDesc: 'Translate PDF documents while keeping original layout.',
};

export default function RelatedCompareLinks() {
  const t = useTranslations('pages.contract-comparison');

  const pt = useCallback(
    (key: string) => {
      if (t.has(key)) return t(key as any);
      return FALLBACKS[key] || key;
    },
    [t]
  );

  const LINKS = [
    {
      slug: 'pdf-to-text',
      icon: 'pdf.png',
      label: pt('explorePdfToText'),
      desc: pt('explorePdfToTextDesc'),
    },
    {
      slug: 'image-to-text',
      icon: 'generalocr.svg',
      label: pt('exploreImageToText'),
      desc: pt('exploreImageToTextDesc'),
    },
    {
      slug: 'upload',
      icon: 'pdf.png',
      label: pt('explorePdfTranslate'),
      desc: pt('explorePdfTranslateDesc'),
    },
  ];

  return (
    <section className="mt-10 border-t pt-8">
      <h2 className="text-lg font-semibold text-center mb-4 text-foreground">{pt('exploreMoreHeading')}</h2>
      <div className="flex flex-wrap justify-center gap-3">
        {LINKS.map((link) => (
          <Link
            key={link.slug}
            href={`/${link.slug}`}
            className="inline-flex items-center gap-3 rounded-lg border bg-card px-4 py-3 text-sm hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            <Image
              src={`/brand/icons/${link.icon}`}
              alt=""
              width={32}
              height={32}
              className="size-8 shrink-0"
            />
            <div className="flex flex-col items-start">
              <span className="font-medium text-foreground">{link.label}</span>
              <span className="text-xs text-muted-foreground mt-0.5">{link.desc}</span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
