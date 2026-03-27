'use client';

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';

import { Highlighter } from '@/shared/components/ui/highlighter';

/** translateDark 首页 Hero：浅色用较深 sky，深色用亮 sky，避免仅用单一 hex 对比度不足 */
export function TranslateHeroHighlighter({
  children,
}: {
  children: React.ReactNode;
}) {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const color =
    mounted && resolvedTheme === 'dark' ? '#38bdf8' : '#0284c7';

  return (
    <Highlighter action="underline" color={color}>
      {children}
    </Highlighter>
  );
}
