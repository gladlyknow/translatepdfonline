import { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

const authSecret =
  process.env.AUTH_SECRET ||
  (process.env.NODE_ENV === "development" ? "dev-auth-secret-local-only" : undefined);

/**
 * 返回后端可验证的 Bearer token。
 * NextAuth v5 的 JWT 为 JWE 加密，后端无法解码；Credentials/Google 登录时已将后端的 access_token 存入 session.backend_access_token，此处优先返回该值供 API 请求使用。
 */
export async function GET(req: NextRequest) {
  const token = await getToken({ req, secret: authSecret });
  const backendToken = token?.backend_access_token;
  if (typeof backendToken === "string") {
    return Response.json({ token: backendToken });
  }
  return Response.json({ token: null }, { status: 200 });
}
