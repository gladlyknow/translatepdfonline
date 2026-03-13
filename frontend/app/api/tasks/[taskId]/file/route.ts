import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";

const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
const authSecret =
  process.env.AUTH_SECRET ||
  (process.env.NODE_ENV === "development" ? "dev-auth-secret-local-only" : undefined);
/** 流式代理 PDF 时拉取后端的超时；后端有 R2 时会 302 直连 R2 不经过此代理 */
const STREAM_FETCH_TIMEOUT_MS = 300_000; // 5 分钟，仅无 R2 重定向时兜底

/**
 * 流式代理 GET /api/tasks/:taskId/file，拉取后端时使用较长超时并正确转发流，
 * 避免 Next 默认 rewrite 代理在大 PDF 流时出现 socket hang up / ECONNRESET。
 * 从 NextAuth session 注入后端 Bearer token，使后端能识别登录用户（NextAuth v5 JWE 后端无法解码）。
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;
  const { searchParams } = new URL(req.url);
  const disposition = searchParams.get("disposition") || "inline";
  const backendUrl = `${apiBase}/api/tasks/${taskId}/file?disposition=${encodeURIComponent(disposition)}`;

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
      redirect: "manual",
    });
    clearTimeout(timeoutId);

    if (res.status === 302) {
      const location = res.headers.get("Location");
      if (location) {
        return new Response(null, {
          status: 302,
          headers: { Location: location },
        });
      }
    }

    if (res.status === 403) {
      const body = await res.json().catch(() => ({ detail: "login_required_to_download" }));
      return NextResponse.json(body, { status: 403 });
    }
    if (res.status === 404) {
      const body = await res.json().catch(() => ({ detail: "file_not_found" }));
      return NextResponse.json(
        { ...body, download_error: true, taskId },
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

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
    // 允许浏览器缓存分片，减少 PDF.js 翻页时的重复请求
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
