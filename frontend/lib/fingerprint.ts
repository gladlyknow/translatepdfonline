/**
 * 浏览器指纹（FingerprintJS 开源版），用于与后端临时账号绑定，防清 Cookie 白嫖。
 * 仅在同源使用，不用于跨站追踪。
 */
let cached: string | null = null;

export async function getFingerprint(): Promise<string> {
  if (cached) return cached;
  const FingerprintJS = (await import("@fingerprintjs/fingerprintjs")).default;
  const fp = await FingerprintJS.load();
  const result = await fp.get();
  cached = result.visitorId;
  return cached;
}
