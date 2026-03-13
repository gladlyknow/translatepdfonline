import type { NextConfig } from "next";
import path from "path";
import { fileURLToPath } from "url";
import createNextIntlPlugin from "next-intl/plugin";

const frontendRoot = path.dirname(fileURLToPath(import.meta.url));
const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

/** 仅在做静态导出构建时启用（如 Cloudflare Pages）。开发或普通 build 不设置则保留 middleware 与 API 路由。 */
const outputExport = process.env.OUTPUT_EXPORT === "1";

const nextConfig: NextConfig = {
  ...(outputExport ? { output: "export" as const } : {}),
  experimental: {
    proxyClientMaxBodySize: "50mb",
  },
  turbopack: {
    root: frontendRoot,
  },
};

export default withNextIntl(nextConfig);
