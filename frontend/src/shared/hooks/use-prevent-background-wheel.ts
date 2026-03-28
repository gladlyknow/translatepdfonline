'use client';

import { type RefObject, useEffect } from 'react';

/**
 * 工作台内存在 aside / PDF 等 `overflow: auto` 区域时，Radix Dialog 的 scroll lock 往往锁不住。
 * 在 document 捕获阶段拦截 wheel，仅允许在弹窗/抽屉或可选容器内滚动。
 */
export function usePreventBackgroundWheel(
  active: boolean,
  allowInsideRef: RefObject<HTMLElement | null> | null
) {
  useEffect(() => {
    if (!active || typeof document === 'undefined') return;

    const isAllowedTarget = (t: EventTarget | null) => {
      if (!(t instanceof Element)) return false;
      if (t.closest('[data-slot="dialog-content"]')) return true;
      if (t.closest('[data-slot="drawer-content"]')) return true;
      const allow = allowInsideRef?.current;
      return Boolean(allow && allow.contains(t));
    };

    const onWheel = (e: WheelEvent) => {
      if (isAllowedTarget(e.target)) return;
      e.preventDefault();
    };

    const onTouchMove = (e: TouchEvent) => {
      if (isAllowedTarget(e.target)) return;
      e.preventDefault();
    };

    document.addEventListener('wheel', onWheel, { capture: true, passive: false });
    document.addEventListener('touchmove', onTouchMove, {
      capture: true,
      passive: false,
    });
    return () => {
      document.removeEventListener('wheel', onWheel, { capture: true });
      document.removeEventListener('touchmove', onTouchMove, {
        capture: true,
      });
    };
  }, [active, allowInsideRef]);
}
