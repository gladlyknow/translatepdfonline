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
    // 优化包导入，减少 bundle 大小
    optimizePackageImports: [
      'lucide-react',
      '@radix-ui/react-icons',
      'react-icons',
      '@tabler/icons-react',
    ],
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // 客户端 chunk 分割策略：将大型 vendor 库分离
      config.optimization.splitChunks = {
        ...config.optimization.splitChunks,
        cacheGroups: {
          // PDF 相关（仅 translate 页异步使用）
          pdfjs: {
            test: /[\\/]node_modules[\\/](pdfjs-dist|react-pdf|@pdf-lib)[\\/]/,
            name: 'vendor-pdf',
            chunks: 'async',
            priority: 30,
          },
          // 动画库（仅 features-media/flow 等异步 block 使用）
          // 用 chunks:'async' 避免被动态 import context 提为 entry 级依赖，
          // 否则首页会保守加载 vendor-animation（framer-motion ~50KB）。
          framerMotion: {
            test: /[\\/]node_modules[\\/](framer-motion|motion)[\\/]/,
            name: 'vendor-animation',
            chunks: 'async',
            priority: 25,
          },
          // 文档框架（仅文档/MDX 异步页面使用）
          fumadocs: {
            test: /[\\/]node_modules[\\/](fumadocs|next-mdx-remote|shiki|rehype|remark)[\\/]/,
            name: 'vendor-docs',
            chunks: 'async',
            priority: 20,
          },
          // UI 组件库
          radixUI: {
            test: /[\\/]node_modules[\\/]@radix-ui[\\/]/,
            name: 'vendor-radix',
            chunks: 'all',
            priority: 15,
          },
          // 关键工具库：被几乎所有首屏组件使用，分离避免混入异步重型依赖。
          // chunks:'all' 从初始+异步 chunk 共同提取，确保首屏不额外加载异步依赖。
          vendorCritical: {
            test: /[\\/]node_modules[\\/](class-variance-authority|clsx|tailwind-merge|lucide-react|@radix-ui\/react-slot)[\\/]/,
            name: 'vendor-critical',
            chunks: 'all',
            priority: 12,
            minChunks: 2,
          },
          // 通用 vendor：完全禁用。将共享 node_modules 提升到单一 chunk
          // 会使首页加载大量未使用 JS。改为让各异步 chunk 自行内联依赖，
          // 首页仅加载其实际需要的代码。
          // vendor: {
          //   test: /[\\/]node_modules[\\/]/,
          //   name: 'vendor-common',
          //   chunks: 'async',
          //   priority: 10,
          //   minChunks: 2,
          // },
        },
      };
    }
    return config;
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
