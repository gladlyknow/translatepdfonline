'use client';

import { useEffect } from 'react';

const DATA_ID = 'third-party-configs';

export function serializeInlineJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function getEmbeddedConfigs(): Record<string, string> | null {
  if (typeof document === 'undefined') return null;
  const el = document.getElementById(DATA_ID);
  if (!el) return null;
  try {
    return JSON.parse(el.textContent || '{}');
  } catch {
    return null;
  }
}

/**
 * 客户端异步加载第三方营销/分析脚本。
 * 使用 requestIdleCallback 延迟到页面完全渲染后执行，不阻塞 FCP/LCP。
 */
export function ThirdPartyScripts() {
  useEffect(() => {
    if (typeof requestIdleCallback === 'undefined') {
      const id = setTimeout(() => injectScripts(), 500);
      return () => clearTimeout(id);
    }
    const id = requestIdleCallback(() => injectScripts());
    return () => cancelIdleCallback(id);
  }, []);

  return null;
}

function injectScripts() {
  const configs = getEmbeddedConfigs();
  if (!configs || !Object.keys(configs).length) return;

  // Google Analytics
  if (configs.google_analytics_id) {
    const analyticsId = configs.google_analytics_id.trim();
    const analyticsUrl = new URL('https://www.googletagmanager.com/gtag/js');
    analyticsUrl.searchParams.set('id', analyticsId);
    const gtag = document.createElement('script');
    gtag.src = analyticsUrl.toString();
    gtag.async = true;
    document.head.appendChild(gtag);
    const init = document.createElement('script');
    init.textContent = `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config',${JSON.stringify(analyticsId)});`;
    document.head.appendChild(init);
  }

  // Microsoft Clarity
  if (configs.clarity_id) {
    const clarityId = configs.clarity_id.trim();
    const s = document.createElement('script');
    s.textContent = `(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement("script");t.src="https://www.clarity.ms/tag/"+i;t.async=1;y=l.getElementsByTagName("script")[0];y.parentNode.insertBefore(t,y);})(window,document,"clarity","script",${JSON.stringify(clarityId)});`;
    document.head.appendChild(s);
  }

  // Plausible
  if (configs.plausible_domain && configs.plausible_src) {
    try {
      const plausibleUrl = new URL(configs.plausible_src);
      if (plausibleUrl.protocol === 'https:') {
        const s = document.createElement('script');
        s.src = plausibleUrl.toString();
        s.setAttribute('data-domain', configs.plausible_domain.trim());
        s.defer = true;
        document.head.appendChild(s);
      }
    } catch {
      // Ignore invalid analytics URLs instead of injecting untrusted markup.
    }
  }
}

/** 服务端组件：将配置序列化为客户端可读的 script 标签 */
export function ThirdPartyConfigTag({
  configs,
}: {
  configs: Record<string, string>;
}) {
  return (
    <script
      id={DATA_ID}
      type="application/json"
      dangerouslySetInnerHTML={{ __html: serializeInlineJson(configs) }}
    />
  );
}
