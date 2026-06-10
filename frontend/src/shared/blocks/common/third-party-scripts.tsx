'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { getAllConfigs } from '@/shared/models/config';
import { getAdsService } from '@/shared/services/ads';
import { getAffiliateService } from '@/shared/services/affiliate';
import { getAnalyticsService } from '@/shared/services/analytics';
import { getCustomerService } from '@/shared/services/customer_service';

/**
 * 客户端异步加载第三方营销/分析脚本。
 * 避免在服务端布局中阻塞页面渲染。
 */
export function ThirdPartyScripts() {
  const [headNodes, setHeadNodes] = useState<ReactNode[]>([]);
  const [bodyNodes, setBodyNodes] = useState<ReactNode[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const configs = await getAllConfigs();

        const [ads, analytics, affiliate, customer] = await Promise.all([
          getAdsService(configs),
          getAnalyticsService(configs),
          getAffiliateService(configs),
          getCustomerService(configs),
        ]);

        if (cancelled) return;

        const head: ReactNode[] = [];
        const body: ReactNode[] = [];

        for (const svc of [ads, analytics, affiliate, customer]) {
          const h = svc.getHeadScripts?.();
          if (h) head.push(h);
          const b = svc.getBodyScripts?.();
          if (b) body.push(b);
        }

        setHeadNodes(head);
        setBodyNodes(body);
      } catch {
        // 第三方脚本加载失败不应影响页面功能
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  return (
    <>
      {headNodes}
      {bodyNodes}
    </>
  );
}
