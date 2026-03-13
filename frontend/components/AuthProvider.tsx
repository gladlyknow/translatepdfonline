"use client";

import { SessionProvider } from "next-auth/react";

/** 开发与普通 build 下始终渲染 SessionProvider，供 useSession 使用。静态导出构建时由 setRequestLocale 等避免 headers()，SessionProvider 可正常参与预渲染。 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
