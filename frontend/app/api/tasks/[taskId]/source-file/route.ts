import { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
const authSecret =
  process.env.AUTH_SECRET ||
  (process.env.NODE_ENV === "development" ? "dev-auth-secret-local-only" : undefined);
const STREAM_FETCH_TIMEOUT_MS = 120_000;

/**
 * 流式代理 GET /api/tasks/:taskId/source-file，用于预览时加载源 PDF 切片（仅任务涉及页），
 * 转发 Range 头以支持分片加载。从 NextAuth session 注入后端 Bearer token，使后端能识别登录用户。
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;
  const backendUrl = `${apiBase}/api/tasks/${taskId}/source-file`;

  const headers = new Headers();
  const cookie = req.headers.get("cookie");
  if (cookie) headers.set("cookie", cookie);
  let auth = req.headers.get("authorization");
  if (!auth && authSecret) {
    const token = await getToken({ req, secret: authSecret });
    const backendToken = token?.backend_access_token;
    if (typeof backendToken === "string") auth = `Bearer ${backendToken}`;
  }
  if (auth) headers.set("authorization", auth);
  const range = req.headers.get("range");
  if (range) headers.set("Range", range);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), STREAM_FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(backendUrl, {
      method: "GET",
      headers,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      return new Response(res.body, {
        status: res.status,
        statusText: res.statusText,
        headers: {
          "Content-Type": res.headers.get("Content-Type") || "application/json",
        },
      });
    }

    const contentType = res.headers.get("Content-Type") || "application/pdf";
    const contentDisposition = res.headers.get("Content-Disposition");
    const contentRange = res.headers.get("Content-Range");
    const acceptRanges = res.headers.get("Accept-Ranges");
    const contentLength = res.headers.get("Content-Length");

    const outHeaders = new Headers();
    outHeaders.set("Content-Type", contentType);
    if (contentDisposition) outHeaders.set("Content-Disposition", contentDisposition);
    if (contentRange) outHeaders.set("Content-Range", contentRange);
    if (acceptRanges) outHeaders.set("Accept-Ranges", acceptRanges);
    if (contentLength) outHeaders.set("Content-Length", contentLength);
    // 允许浏览器缓存分片，减少 PDF.js 按页/按范围请求时的重复请求
    outHeaders.set("Cache-Control", "private, max-age=300");

    return new Response(res.body, {
      status: res.status,
      headers: outHeaders,
    });
  } catch (e) {
    clearTimeout(timeoutId);
    if (e instanceof Error && e.name === "AbortError") {
      return new Response(
        JSON.stringify({ detail: "Request timeout while streaming file" }),
        { status: 504, headers: { "Content-Type": "application/json" } }
      );
    }
    throw e;
  }
}
