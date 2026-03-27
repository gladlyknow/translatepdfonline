'use client';

import { useEffect, useState } from 'react';

import { envConfigs } from '@/config';
import { Brand as BrandType } from '@/shared/types/blocks/common';

export function Copyright({ brand }: { brand: BrandType }) {
  const [currentYear, setCurrentYear] = useState<number | null>(null);

  useEffect(() => {
    setCurrentYear(new Date().getFullYear());
  }, []);

  const displayYear = Math.max(currentYear ?? 2026, 2026);

  return (
    <div className={`text-muted-foreground text-sm`}>
      © {displayYear}{' '}
      <a
        href={brand?.url || envConfigs.app_url}
        target={brand?.target || ''}
        className="text-foreground font-medium underline decoration-foreground/25 underline-offset-2 transition-colors hover:decoration-foreground"
      >
        {brand?.title || envConfigs.app_name}
      </a>
      , All rights reserved
    </div>
  );
}
