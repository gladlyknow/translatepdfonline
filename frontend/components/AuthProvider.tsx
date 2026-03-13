"use client";

import { SessionContext, SessionProvider } from "next-auth/react";

/** 静态部署时无 NextAuth API，不请求 /api/auth/session，避免 404。提供与 useSession 兼容的“未登录”上下文。 */
const staticSessionValue = {
  data: null as null,
  status: "unauthenticated" as const,
  update: (async () => null) as () => Promise<null>,
};

/** 开发/非静态部署用 NextAuth SessionProvider；静态部署用只读“未登录”上下文，不请求同源 /api/auth/session。 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const isStaticDeploy = process.env.NEXT_PUBLIC_STATIC_DEPLOY === "1";
  if (isStaticDeploy) {
    return (
      <SessionContext.Provider value={staticSessionValue}>
        {children}
      </SessionContext.Provider>
    );
  }
  return <SessionProvider>{children}</SessionProvider>;
}
