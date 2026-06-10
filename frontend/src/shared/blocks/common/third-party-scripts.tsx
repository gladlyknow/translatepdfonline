'use client';

import { useEffect } from 'react';

const DATA_ID = 'third-party-configs';

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
    const gtag = document.createElement('script');
    gtag.src = `https://www.googletagmanager.com/gtag/js?id=${configs.google_analytics_id}`;
    gtag.async = true;
    document.head.appendChild(gtag);
    const init = document.createElement('script');
    init.textContent = `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${configs.google_analytics_id}');`;
    document.head.appendChild(init);
  }

  // Microsoft Clarity
  if (configs.clarity_id) {
    const s = document.createElement('script');
    s.textContent = `(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement("script");t.src="https://www.clarity.ms/tag/"+i;t.async=1;y=l.getElementsByTagName("script")[0];y.parentNode.insertBefore(t,y);})(window,document,"clarity","script","${configs.clarity_id}");`;
    document.head.appendChild(s);
  }

  // Plausible
  if (configs.plausible_domain && configs.plausible_src) {
    const s = document.createElement('script');
    s.src = configs.plausible_src;
    s.setAttribute('data-domain', configs.plausible_domain);
    s.defer = true;
    document.head.appendChild(s);
  }
}

/** 服务端组件：将配置序列化为客户端可读的 script 标签 */
export function ThirdPartyConfigTag({ configs }: { configs: Record<string, string> }) {
  return (
    <script
      id={DATA_ID}
      type="application/json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(configs) }}
    />
  );
}
