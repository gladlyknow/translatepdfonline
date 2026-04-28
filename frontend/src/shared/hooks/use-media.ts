'use client';

import { useEffect, useState } from 'react';

/**
 * 移动优先：`matchMedia` 仅在客户端存在，首帧须与 SSR 一致（false），否则窄屏下会与桌面版 SSR HTML 不一致引发 hydration 报错。
 */
export function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const matchMedia = window.matchMedia(query);
    const sync = () => setMatches(matchMedia.matches);
    sync();

    matchMedia.addEventListener('change', sync);

    return () => {
      matchMedia.removeEventListener('change', sync);
    };
  }, [query]);

  return matches;
}
