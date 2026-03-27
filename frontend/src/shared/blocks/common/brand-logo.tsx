import Image from 'next/image';

import { Link } from '@/core/i18n/navigation';
import { Brand as BrandType } from '@/shared/types/blocks/common';

export function BrandLogo({ brand }: { brand: BrandType }) {
  const logoSrc = brand.logo?.src ?? '';
  const isSvg = logoSrc.endsWith('.svg');
  const unoptimized = isSvg || logoSrc.startsWith('http');

  return (
    <Link
      href={brand.url || ''}
      target={brand.target || '_self'}
      className={`flex items-center space-x-3 ${brand.className ?? ''}`}
    >
      {brand.logo && (
        <span
          className="relative flex h-8 w-8 shrink-0 overflow-hidden rounded-[9px] ring-1 ring-black/10 dark:ring-white/15"
          aria-hidden={brand.title ? true : undefined}
        >
          <Image
            src={brand.logo.src}
            alt={brand.title ? '' : brand.logo.alt || ''}
            width={32}
            height={32}
            className="h-full w-full object-cover"
            unoptimized={unoptimized}
          />
        </span>
      )}
      {brand.title && (
        <span className="text-lg font-medium text-foreground">{brand.title}</span>
      )}
    </Link>
  );
}
