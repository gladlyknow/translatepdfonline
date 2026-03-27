import path from 'path';
import { fileURLToPath } from 'url';
import bundleAnalyzer from '@next/bundle-analyzer';
import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare';
import { createMDX } from 'fumadocs-mdx/next';
import createNextIntlPlugin from 'next-intl/plugin';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const withMDX = createMDX();

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
});

const withNextIntl = createNextIntlPlugin({
  requestConfig: './src/core/i18n/request.ts',
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: process.env.VERCEL ? undefined : 'standalone',
  reactStrictMode: false,
  devIndicators: false,
  pageExtensions: ['ts', 'tsx', 'js', 'jsx', 'md', 'mdx'],
  // Monorepo: use frontend as tracing root so Next does not pick repo root lockfile (silences "multiple lockfiles" on Cloudflare).
  outputFileTracingRoot: path.join(__dirname),
  // OpenNext Cloudflare will copy full packages listed here into the workerd bundle
  // when they expose a "workerd" export condition. `@libsql/client` does, and without
  // this the OpenNext bundler can fail to resolve it.
  serverExternalPackages: ['@libsql/client', '@libsql/isomorphic-ws'],
  images: {
    // OpenNext on Cloudflare Workers: `/_next/image` expects env.IMAGES (Cloudflare Images).
    // Without that binding, requests log "env.IMAGES binding is not defined". Unoptimized serves
    // /public and remote images without the optimizer route (fine for logos/marketing).
    unoptimized: true,
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    qualities: [60, 70, 75],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*',
      },
    ],
  },
  async redirects() {
    return [];
  },
  async headers() {
    return [
      {
        source: '/imgs/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
    ];
  },
  turbopack: {
    resolveAlias: {
      // fs: {
      //   browser: './empty.ts', // We recommend to fix code imports before using this method
      // },
    },
  },
  experimental: {
    // Disable mdxRs for Vercel deployment compatibility with fumadocs-mdx
    ...(process.env.VERCEL ? {} : { mdxRs: true }),
  },
};

export default withBundleAnalyzer(withNextIntl(withMDX(nextConfig)));

/**
 * OpenNext + wrangler.toml 含 `[[hyperdrive]]` 时，本地 `next dev` 会走 Wrangler 代理并 **要求**
 * `WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE`（绑定名 HYPERDRIVE）。
 * 若未手动设置，则用 **直连** `DATABASE_URL` 兜底，避免本地无法启动。
 * 注意：`.env.development` 里请使用 Neon/Supabase 等直连串，不要用 *.hyperdrive.cloudflare.com。
 */
if (
  process.env.NODE_ENV === 'development' &&
  !process.env.WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE &&
  process.env.DATABASE_URL?.trim()
) {
  process.env.WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE =
    process.env.DATABASE_URL.trim();
}

initOpenNextCloudflareForDev();
