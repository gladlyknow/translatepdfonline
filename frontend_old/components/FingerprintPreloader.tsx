"use client";

import { useEffect } from "react";
import { getFingerprint } from "@/lib/fingerprint";

/**
 * 在应用加载时预加载浏览器指纹，确保首次 API 请求前指纹已就绪，
 * 防止创建未绑定指纹的临时用户（清 Cookie 后可绕过配额限制）。
 */
export function FingerprintPreloader() {
  useEffect(() => {
    getFingerprint().catch(() => {
      // 静默失败，后续请求会由后端返回 fingerprint_required
    });
  }, []);
  return null;
}
