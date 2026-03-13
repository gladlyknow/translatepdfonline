"use client";

import { useState, useEffect } from "react";
import { SessionProvider } from "next-auth/react";

/** 仅客户端挂载后再渲染 SessionProvider，避免静态导出时 prerender 阶段调用 headers() 报错 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <>{children}</>;
  return <SessionProvider>{children}</SessionProvider>;
}
