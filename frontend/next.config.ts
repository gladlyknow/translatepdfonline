import type { NextConfig } from "next";
import path from "path";
import { fileURLToPath } from "url";
import createNextIntlPlugin from "next-intl/plugin";

const frontendRoot = path.dirname(fileURLToPath(import.meta.url));
const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";

const nextConfig: NextConfig = {
  experimental: {
    proxyClientMaxBodySize: "50mb",
  },
  turbopack: {
    root: frontendRoot,
  },
  async rewrites() {
    // 只把后端 API 代理到 FastAPI；NextAuth 的 /api/auth/session、callback 等由 Next.js 处理，不代理
    // Next.js 不允许 source 中使用嵌套捕获组，因此逐条列出后端路径
    const backendAuthPaths = [
      "auth/login",
      "auth/send-code",
      "auth/verify-register",
      "auth/ensure-user",
      "auth/google/login",
      "auth/google/callback",
    ];
    const authRewrites = backendAuthPaths.map((p) => ({
      source: `/api/${p}`,
      destination: `${apiBase}/api/${p}`,
    }));
    return [
      ...authRewrites,
      { source: "/api/documents", destination: `${apiBase}/api/documents` },
      { source: "/api/documents/:path*", destination: `${apiBase}/api/documents/:path*` },
      { source: "/api/upload/:path*", destination: `${apiBase}/api/upload/:path*` },
      // 不代理 /api/tasks/:id/file，由 app/api/tasks/[taskId]/file/route.ts 流式代理（长超时），避免 socket hang up
      { source: "/api/tasks", destination: `${apiBase}/api/tasks` },
      { source: "/api/tasks/:id/view", destination: `${apiBase}/api/tasks/:id/view` },
      { source: "/api/tasks/:id/events", destination: `${apiBase}/api/tasks/:id/events` },
      { source: "/api/tasks/:id/files/:filename", destination: `${apiBase}/api/tasks/:id/files/:filename` },
      { source: "/api/tasks/:id/cancel", destination: `${apiBase}/api/tasks/:id/cancel` },
      { source: "/api/tasks/:id", destination: `${apiBase}/api/tasks/:id` },
      { source: "/api/translate", destination: `${apiBase}/api/translate` },
      { source: "/api/user", destination: `${apiBase}/api/user` },
      { source: "/api/user/:path*", destination: `${apiBase}/api/user/:path*` },
    ];
  },
};

export default withNextIntl(nextConfig);
