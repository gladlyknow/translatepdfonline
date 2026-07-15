'use client';

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';

import { ExploreMoreLinks } from '@/shared/blocks/explore-more-links';

const FALLBACKS: Record<string, string> = {
  exploreMoreHeading: 'Explore More Document Tools',
  explorePdfToText: 'PDF OCR & Text Extraction',
  explorePdfToTextDesc: 'Extract text from PDF documents with AI-powered OCR.',
  exploreImageToText: 'AI Image to Text Converter',
  exploreImageToTextDesc: 'Convert images to editable, searchable text.',
  explorePdfTranslate: 'AI PDF Translation Tool',
  explorePdfTranslateDesc: 'Translate PDF documents while keeping original layout.',
  exploreJpgToWord: 'JPG to Word Converter',
  exploreJpgToWordDesc: 'Convert JPG photos to editable Word (.docx) with AI OCR.',
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
    {
      slug: 'jpg-to-word',
      icon: 'generalocr.svg',
      label: pt('exploreJpgToWord'),
      desc: pt('exploreJpgToWordDesc'),
    },
  ];

  return (
    <ExploreMoreLinks
      heading={pt('exploreMoreHeading')}
      links={LINKS.map((l) => ({
        href: `/${l.slug}`,
        icon: l.icon,
        label: l.label,
        desc: l.desc,
      }))}
    />
  );
}
