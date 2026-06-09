import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";

const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        const res = await fetch(`${apiBase}/api/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: credentials.email as string,
            password: credentials.password as string,
          }),
        });
        if (!res.ok) return null;
        const data = await res.json();
        const user = data.user ?? { id: data.sub, email: data.email };
        return {
          id: user.id,
          email: user.email,
          name: user.name ?? user.email,
          access_token: data.access_token,
        };
      },
    }),
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    }),
  ],
  session: {
    strategy: "jwt",
    maxAge: 7 * 24 * 60 * 60,
  },
  callbacks: {
    async jwt({ token, user, account }) {
      if (user) {
        if (account?.provider === "google" && user.email) {
          try {
            const res = await fetch(`${apiBase}/api/auth/ensure-user`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ email: user.email, name: user.name ?? user.email }),
            });
            if (res.ok) {
              const data = await res.json();
              token.sub = data.id;
              token.backend_access_token = data.access_token;
            }
          } catch {
            // keep token.sub as default
          }
        } else {
          token.sub = user.id;
          token.backend_access_token = (user as { access_token?: string }).access_token;
        }
        token.email = user.email;
        token.image = (user as { image?: string | null }).image ?? undefined;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub ?? "";
        session.user.image = (token.image as string | undefined) ?? null;
      }
      (session as { backend_access_token?: string }).backend_access_token = token.backend_access_token as string | undefined;
      return session;
    },
  },
  pages: {
    signIn: "/",
  },
  // 生产必须配置 AUTH_SECRET；开发未配置时使用回退值（仅限本地）
  secret: process.env.AUTH_SECRET || (process.env.NODE_ENV === "development" ? "dev-auth-secret-local-only" : undefined),
  trustHost: true,
});
