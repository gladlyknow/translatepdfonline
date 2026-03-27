import { getAllConfigs } from '@/shared/models/config';
import {
  getWorkerBindingMeta,
  getWorkerBindingString,
} from '@/shared/lib/worker-env';

/**
 * 与 POST /api/translate 调用 FC 时相同的 Secret 解析（Worker 绑定 + DB 兜底）。
 */
export async function resolveTranslateFcSecret(): Promise<string> {
  const s1 = getWorkerBindingMeta('TRANSLATE_FC_SECRET');
  const s2 = getWorkerBindingMeta('BABELDOC_FC_SECRET');
  let secret = s1.value || s2.value || '';
  if (!secret) {
    const configs = await getAllConfigs();
    secret = String(configs.translate_fc_secret ?? '').trim();
  }
  return secret;
}

/**
 * 校验 FC 回调请求：头名称与 invoke 时一致，值为 scheme + secret（scheme 常为空）。
 */
export async function verifyTranslateFcCallbackRequest(req: Request): Promise<boolean> {
  const secret = await resolveTranslateFcSecret();
  if (!secret) {
    console.warn(
      '[translate/callback] FC secret not configured; skipping auth (set TRANSLATE_FC_SECRET to enforce)'
    );
    return true;
  }
  const authHeader =
    getWorkerBindingString('TRANSLATE_FC_AUTH_HEADER') || 'X-Babeldoc-Secret';
  const authScheme = getWorkerBindingString('TRANSLATE_FC_AUTH_SCHEME') || '';
  const expected = authScheme + secret;
  const received = req.headers.get(authHeader) ?? '';
  return received === expected;
}
