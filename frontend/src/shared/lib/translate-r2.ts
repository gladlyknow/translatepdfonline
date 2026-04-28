/**
 * R2 presigned URLs for translate (Route A).
 *
 * Resolution order (each field filled from first non-empty source), except in
 * **Queues consumer** (`tryGetAlsCfEnv()`): only DB `r2_*` rows via `loadConfigsFromDatabase()`.
 * General Worker / Node:
 * 1) Env: R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT / R2_ENDPOINT_URL
 * 2) DB admin settings: r2_bucket_name, r2_access_key, r2_secret_key, r2_endpoint
 *
 * For local dev: R2_PUBLIC_URL or NEXT_PUBLIC_R2_PUBLIC_URL for GET without signing (Node only).
 * In Cloudflare Worker uses aws4fetch (no Node fs); in Node uses @aws-sdk (dynamic import).
 */

import { AwsClient } from 'aws4fetch';
import { getAllConfigs, loadConfigsFromDatabase } from '@/shared/models/config';
import { isCloudflareWorker } from './env';
import { tryGetAlsCfEnv } from '@/shared/lib/worker-runtime-env';

export type TranslateR2S3Credentials = {
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint: string;
  /** 记录最终配置来源，便于排查 Cloudflare 运行时读取链路 */
  source?: 'db' | 'env' | 'mixed';
};

/** Env-only (Worker secrets / .env). */
function getR2EnvFromProcess(): TranslateR2S3Credentials {
  const endpoint = (
    process.env.R2_ENDPOINT_URL ||
    process.env.R2_ENDPOINT ||
    ''
  )
    .trim()
    .replace(/\/$/, '');
  return {
    bucket: (process.env.R2_BUCKET ?? '').trim(),
    accessKeyId: (process.env.R2_ACCESS_KEY_ID ?? '').trim(),
    secretAccessKey: (process.env.R2_SECRET_ACCESS_KEY ?? '').trim(),
    endpoint,
  };
}

function getR2EnvFromDb(c: Record<string, unknown>): TranslateR2S3Credentials {
  return {
    bucket: String(c.r2_bucket_name ?? '').trim(),
    accessKeyId: String(c.r2_access_key ?? '').trim(),
    secretAccessKey: String(c.r2_secret_key ?? '').trim(),
    endpoint: String(c.r2_endpoint ?? '')
      .trim()
      .replace(/\/$/, ''),
  };
}

function normalizeHttpsEndpoint(raw: string): string {
  const s = String(raw || '').trim().replace(/\/$/, '');
  if (!s) return '';
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:' || !u.host) return '';
    return `${u.protocol}//${u.host}${u.pathname}`.replace(/\/$/, '');
  } catch {
    return '';
  }
}

function summarizeR2Key(key: string): string {
  const s = String(key || '').trim();
  if (!s) return '(empty)';
  return s.length > 96 ? `${s.slice(0, 96)}...` : s;
}

/**
 * Full S3-compatible R2 config for signing. Merges Worker env with DB `r2_*` settings
 * (same keys as admin / storage.ts) so production can rely on DB-only R2 config.
 */
export async function resolveTranslateR2S3Env(): Promise<TranslateR2S3Credentials | null> {
  const fromEnv = getR2EnvFromProcess();
  const envNormalized: TranslateR2S3Credentials = {
    ...fromEnv,
    endpoint: normalizeHttpsEndpoint(fromEnv.endpoint),
  };

  /** 独立 Queues consumer：仅用 DB `r2_*`，不合并 Worker env，避免 env 掩盖未配置的数据库项。 */
  if (tryGetAlsCfEnv()) {
    try {
      const c = await loadConfigsFromDatabase();
      const raw = getR2EnvFromDb(c as Record<string, unknown>);
      const dbOnly = {
        ...raw,
        endpoint: normalizeHttpsEndpoint(raw.endpoint),
      };
      const bucket = String(dbOnly.bucket || '').trim();
      const accessKeyId = String(dbOnly.accessKeyId || '').trim();
      const secretAccessKey = String(dbOnly.secretAccessKey || '').trim();
      const endpoint = normalizeHttpsEndpoint(String(dbOnly.endpoint || ''));
      if (!(bucket && accessKeyId && secretAccessKey && endpoint)) {
        return null;
      }
      return {
        bucket,
        accessKeyId,
        secretAccessKey,
        endpoint,
        source: 'db',
      };
    } catch {
      return null;
    }
  }

  let dbNormalized: TranslateR2S3Credentials | null = null;
  try {
    const c = await getAllConfigs();
    const raw = getR2EnvFromDb(c as Record<string, unknown>);
    dbNormalized = { ...raw, endpoint: normalizeHttpsEndpoint(raw.endpoint) };
  } catch {
    // DB 读取失败时走 fallback
  }

  // Cloudflare 运行时要求：优先使用数据库配置；本地 Node 保持 env 优先。
  const primary = isCloudflareWorker ? dbNormalized : envNormalized;
  const fallback = isCloudflareWorker ? envNormalized : dbNormalized;

  const bucket = String(primary?.bucket || fallback?.bucket || '').trim();
  const accessKeyId = String(primary?.accessKeyId || fallback?.accessKeyId || '').trim();
  const secretAccessKey = String(
    primary?.secretAccessKey || fallback?.secretAccessKey || ''
  ).trim();
  const endpoint = normalizeHttpsEndpoint(
    String(primary?.endpoint || fallback?.endpoint || '')
  );

  if (!(bucket && accessKeyId && secretAccessKey && endpoint)) {
    return null;
  }

  const source: TranslateR2S3Credentials['source'] =
    bucket === primary?.bucket &&
    accessKeyId === primary?.accessKeyId &&
    secretAccessKey === primary?.secretAccessKey &&
    endpoint === primary?.endpoint
      ? isCloudflareWorker
        ? 'db'
        : 'env'
      : 'mixed';

  return { bucket, accessKeyId, secretAccessKey, endpoint, source };
}

/** Public R2 base URL (e.g. https://pub-xxx.r2.dev) for local dev to avoid S3 API connection timeout. */
export function getR2PublicBaseUrl(): string {
  const url = (
    process.env.R2_PUBLIC_URL ||
    process.env.NEXT_PUBLIC_R2_PUBLIC_URL ||
    ''
  ).trim();
  return url.replace(/\/+$/, '');
}

/** 将 R2 key 编码为公网 URL 路径（保留 /，对中文等编码），与浏览器可访问的 URL 一致。 */
export function encodeR2KeyForPublicUrl(key: string): string {
  return key.split('/').map((s) => encodeURIComponent(s)).join('/');
}

/**
 * True if translate R2 flows can run: full S3 signing config (env and/or DB), or Node-only public read URL.
 */
export async function isR2Configured(): Promise<boolean> {
  const creds = await resolveTranslateR2S3Env();
  const hasS3 = creds != null;
  const hasPublicRead = Boolean(getR2PublicBaseUrl());
  return hasS3 || (!isCloudflareWorker && hasPublicRead);
}

/** Worker-only: presigned PUT via aws4fetch (no @aws-sdk/fs). */
async function createPresignedPutWorker(
  creds: TranslateR2S3Credentials,
  key: string,
  contentType: string,
  expiresInSeconds: number
): Promise<string> {
  const { bucket, accessKeyId, secretAccessKey, endpoint } = creds;
  const client = new AwsClient({
    service: 's3',
    region: 'auto',
    accessKeyId,
    secretAccessKey,
  });
  const url = `${endpoint}/${bucket}/${key}?X-Amz-Expires=${expiresInSeconds}`;
  const signed = await client.sign(
    new Request(url, { method: 'PUT', headers: { 'Content-Type': contentType } }),
    { aws: { signQuery: true } }
  );
  return signed.url;
}

export type CreatePresignedGetOptions = {
  /** 参与签名的 S3 查询参数，如 attachment 可触发浏览器下载而非内联打开 */
  responseContentDisposition?: string;
};

/** Worker-only: presigned GET via aws4fetch. */
async function createPresignedGetWorker(
  creds: TranslateR2S3Credentials,
  key: string,
  expiresInSeconds: number,
  options?: CreatePresignedGetOptions
): Promise<string> {
  const { bucket, accessKeyId, secretAccessKey, endpoint } = creds;
  const client = new AwsClient({
    service: 's3',
    region: 'auto',
    accessKeyId,
    secretAccessKey,
  });
  const base = `${endpoint}/${bucket}/${key}`;
  const u = new URL(base);
  u.searchParams.set('X-Amz-Expires', String(expiresInSeconds));
  if (options?.responseContentDisposition) {
    u.searchParams.set(
      'response-content-disposition',
      options.responseContentDisposition
    );
  }
  const signed = await client.sign(new Request(u.toString()), {
    aws: { signQuery: true },
  });
  return signed.url;
}

export async function createPresignedPut(
  key: string,
  contentType: string,
  expiresInSeconds = 600
): Promise<string> {
  const creds = await resolveTranslateR2S3Env();
  if (!creds) throw new Error('R2 not configured');
  console.log(
    '[r2/presign_put] config_resolved',
    JSON.stringify({
      source: creds.source ?? 'unknown',
      endpoint_host: (() => {
        try {
          return new URL(creds.endpoint).host;
        } catch {
          return '(invalid)';
        }
      })(),
      bucket: creds.bucket,
      key: summarizeR2Key(key),
      worker: isCloudflareWorker,
    })
  );
  if (isCloudflareWorker) {
    return createPresignedPutWorker(creds, key, contentType, expiresInSeconds);
  }
  const { PutObjectCommand, S3Client } = await import('@aws-sdk/client-s3');
  const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
  const { bucket, accessKeyId, secretAccessKey, endpoint } = creds;
  const client = new S3Client({
    region: 'auto',
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
  });
  type SignUrl = (client: unknown, command: unknown, opts: { expiresIn: number }) => Promise<string>;
  return (getSignedUrl as SignUrl)(client, command, { expiresIn: expiresInSeconds });
}

export async function createPresignedGet(
  key: string,
  expiresInSeconds = 3600,
  options?: CreatePresignedGetOptions
): Promise<string> {
  const creds = await resolveTranslateR2S3Env();
  if (creds) {
    console.log(
      '[r2/presign_get] config_resolved',
      JSON.stringify({
        source: creds.source ?? 'unknown',
        endpoint_host: (() => {
          try {
            return new URL(creds.endpoint).host;
          } catch {
            return '(invalid)';
          }
        })(),
        bucket: creds.bucket,
        key: summarizeR2Key(key),
        worker: isCloudflareWorker,
      })
    );
  }
  if (isCloudflareWorker) {
    if (!creds) throw new Error('R2 not configured');
    return createPresignedGetWorker(creds, key, expiresInSeconds, options);
  }
  const publicBase = getR2PublicBaseUrl();
  if (publicBase) {
    // 公网直链无签名，无法带 response-content-disposition（浏览器可能仍内联打开）
    return `${publicBase}/${encodeR2KeyForPublicUrl(key)}`;
  }
  if (!creds) throw new Error('R2 not configured');
  const { GetObjectCommand, S3Client } = await import('@aws-sdk/client-s3');
  const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
  const { bucket, accessKeyId, secretAccessKey, endpoint } = creds;
  const client = new S3Client({
    region: 'auto',
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
    ...(options?.responseContentDisposition
      ? { ResponseContentDisposition: options.responseContentDisposition }
      : {}),
  });
  type SignUrl = (client: unknown, command: unknown, opts: { expiresIn: number }) => Promise<string>;
  return (getSignedUrl as SignUrl)(client, command, { expiresIn: expiresInSeconds });
}

/** Get object body from R2 (for server-side PDF slice extraction). */
export async function getObjectBody(key: string): Promise<Uint8Array> {
  const creds = await resolveTranslateR2S3Env();
  if (isCloudflareWorker) {
    if (!creds) throw new Error('R2 not configured');
    const url = await createPresignedGetWorker(creds, key, 3600);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`R2 get failed: ${res.status}`);
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  }
  const publicBase = getR2PublicBaseUrl();
  if (publicBase) {
    const url = `${publicBase}/${encodeR2KeyForPublicUrl(key)}`;
    const timeoutMs = 90_000; // 单次 90 秒，配合重试提高成功率

    const isTimeoutError = (e: unknown): boolean => {
      const err = e as Error & { cause?: { code?: string }; code?: string };
      return (
        err?.name === 'AbortError' ||
        err?.cause?.code === 'UND_ERR_CONNECT_TIMEOUT' ||
        (typeof err?.message === 'string' && err.message.includes('timeout'))
      );
    };

    const doFetch = async (): Promise<Uint8Array> => {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw new Error(`R2 get failed: ${res.status}`);
      const buf = await res.arrayBuffer();
      return new Uint8Array(buf);
    };

    const maxAttempts = 3;
    let lastErr: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await doFetch();
      } catch (e) {
        lastErr = e;
        if (!isTimeoutError(e) || attempt === maxAttempts) break;
      }
    }
    if (isTimeoutError(lastErr)) {
      throw new Error('Storage connection timed out. Check network or try again later.');
    }
    throw lastErr;
  }
  if (!creds) throw new Error('R2 not configured');
  const { GetObjectCommand, S3Client } = await import('@aws-sdk/client-s3');
  const { bucket, accessKeyId, secretAccessKey, endpoint } = creds;
  const client = new S3Client({
    region: 'auto',
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });

  const s3TimeoutMs = 90_000;
  const isTimeoutError = (e: unknown): boolean => {
    const err = e as Error & { name?: string };
    return err?.name === 'AbortError' || (typeof err?.message === 'string' && err.message.includes('timeout'));
  };

  const doGet = async (): Promise<Uint8Array> => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), s3TimeoutMs);
    try {
      const res = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: key }),
        { abortSignal: controller.signal }
      );
      const body = res.Body;
      if (!body) throw new Error('Empty object body');
      const chunks: Uint8Array[] = [];
      for await (const chunk of body as AsyncIterable<Uint8Array>) {
        chunks.push(chunk);
      }
      const total = chunks.reduce((acc, c) => acc + c.length, 0);
      const out = new Uint8Array(total);
      let offset = 0;
      for (const c of chunks) {
        out.set(c, offset);
        offset += c.length;
      }
      return out;
    } finally {
      clearTimeout(timeoutId);
    }
  };

  const maxAttempts = 3;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await doGet();
    } catch (e) {
      lastErr = e;
      if (!isTimeoutError(e) || attempt === maxAttempts) break;
    }
  }
  if (isTimeoutError(lastErr)) {
    throw new Error('Storage connection timed out. Check network or try again later.');
  }
  throw lastErr;
}

/** Upload bytes to R2 (for slice PDFs). */
export async function putObject(
  key: string,
  body: Uint8Array,
  contentType = 'application/pdf'
): Promise<void> {
  const creds = await resolveTranslateR2S3Env();
  if (!creds) throw new Error('R2 not configured');
  if (isCloudflareWorker) {
    const { bucket, accessKeyId, secretAccessKey, endpoint } = creds;
    const client = new AwsClient({
      service: 's3',
      region: 'auto',
      accessKeyId,
      secretAccessKey,
    });
    const url = `${endpoint}/${bucket}/${key}`;
    const req = new Request(url, {
      method: 'PUT',
      body: new Blob([body as BlobPart], { type: contentType }),
      headers: { 'Content-Type': contentType },
    });
    const signed = await client.sign(req);
    const res = await fetch(signed);
    if (!res.ok) throw new Error(`R2 put failed: ${res.status}`);
    return;
  }
  const { PutObjectCommand, S3Client } = await import('@aws-sdk/client-s3');
  const { bucket, accessKeyId, secretAccessKey, endpoint } = creds;
  const client = new S3Client({
    region: 'auto',
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );
}

/** 删除 R2 对象（用于导出删除等；404 视为成功）。 */
export async function deleteObject(key: string): Promise<void> {
  const creds = await resolveTranslateR2S3Env();
  if (!creds) throw new Error('R2 not configured');
  if (isCloudflareWorker) {
    const { bucket, accessKeyId, secretAccessKey, endpoint } = creds;
    const client = new AwsClient({
      service: 's3',
      region: 'auto',
      accessKeyId,
      secretAccessKey,
    });
    const url = `${endpoint}/${bucket}/${key}`;
    const signed = await client.sign(new Request(url, { method: 'DELETE' }));
    const res = await fetch(signed);
    if (res.status === 404) return;
    if (!res.ok) throw new Error(`R2 delete failed: ${res.status}`);
    return;
  }
  const { DeleteObjectCommand, S3Client } = await import('@aws-sdk/client-s3');
  const { bucket, accessKeyId, secretAccessKey, endpoint } = creds;
  const client = new S3Client({
    region: 'auto',
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });
  try {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  } catch (e) {
    const err = e as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (
      err?.name === 'NotFound' ||
      err?.$metadata?.httpStatusCode === 404
    ) {
      return;
    }
    throw e;
  }
}

export type R2HeadResult = {
  ok: boolean;
  /** Response Content-Length when present */
  contentLength: number | null;
};

/**
 * S3 HeadObject：用于判断切片是否已存在、读取对象大小（避免在 Worker 内整本加载大 PDF）。
 */
export async function r2HeadObject(key: string): Promise<R2HeadResult> {
  const creds = await resolveTranslateR2S3Env();
  if (!creds) throw new Error('R2 not configured');
  if (isCloudflareWorker) {
    const { bucket, accessKeyId, secretAccessKey, endpoint } = creds;
    const client = new AwsClient({
      service: 's3',
      region: 'auto',
      accessKeyId,
      secretAccessKey,
    });
    const url = `${endpoint}/${bucket}/${key}`;
    const signed = await client.sign(new Request(url, { method: 'HEAD' }), {
      aws: { signQuery: true },
    });
    const res = await fetch(signed.url, { method: 'HEAD' });
    if (res.status === 404) {
      return { ok: false, contentLength: null };
    }
    if (!res.ok) {
      throw new Error(`R2 head failed: ${res.status}`);
    }
    const cl = res.headers.get('content-length');
    return {
      ok: true,
      contentLength: cl != null && cl !== '' ? parseInt(cl, 10) : null,
    };
  }
  const { HeadObjectCommand, S3Client } = await import('@aws-sdk/client-s3');
  const { bucket, accessKeyId, secretAccessKey, endpoint } = creds;
  const client = new S3Client({
    region: 'auto',
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });
  try {
    const out = await client.send(
      new HeadObjectCommand({ Bucket: bucket, Key: key })
    );
    const n = out.ContentLength;
    return {
      ok: true,
      contentLength: typeof n === 'number' && Number.isFinite(n) ? n : null,
    };
  } catch (e) {
    const err = e as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (
      err?.name === 'NotFound' ||
      err?.$metadata?.httpStatusCode === 404
    ) {
      return { ok: false, contentLength: null };
    }
    throw e;
  }
}

export async function r2ObjectExists(key: string): Promise<boolean> {
  const h = await r2HeadObject(key);
  return h.ok;
}
