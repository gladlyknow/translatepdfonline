'use client';

import dynamic from 'next/dynamic';

const NextTopLoader = dynamic(() => import('nextjs-toploader'), { ssr: false });

export default function NextTopLoaderClient() {
  return (
    <NextTopLoader
      color="#0369a1"
      initialPosition={0.08}
      crawlSpeed={200}
      height={2}
      crawl={true}
      showSpinner={false}
      easing="ease"
      speed={200}
      shadow={false}
    />
  );
}
