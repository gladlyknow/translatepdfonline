import { getCloudflareContext } from '@opennextjs/cloudflare';
import { eq, and } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '@/core/db';
import { documents, translationTasks } from '@/config/db/schema';
import { getTranslateAuth } from './auth';
import { getAllConfigs } from '@/shared/models/config';
import { createPresignedGet, isR2Configured } from '@/shared/lib/translate-r2';
import { isCloudflareWorker } from '@/shared/lib/env';
import {
  getWorkerBindingMeta,
  getWorkerBindingString,
  getWorkerEnvDebugKeyHints,
} from '@/shared/lib/worker-env';
import { getRemainingCredits } from '@/shared/models/credit';
import {
  estimateTranslatedPages,
  getTranslateCreditsPerPage,
  intersectPageRangeWithDocument,
  isTranslateCreditsEnabled,
  parseTranslatePageRange,
} from '@/shared/lib/translate-billing';
import { invokeTranslateFcForTask } from './invoke-fc';

/** 日志用：不输出完整预签名 URL（含凭证 query）。 */
function summarizeUrlForLog(url: string) {
  try {
    const u = new URL(url);
    return {
      protocol: u.protocol,
      host: u.host,
      pathname_prefix: u.pathname.length > 96 ? `${u.pathname.slice(0, 96)}…` : u.pathname,
      search_param_keys: [...new Set([...u.searchParams.keys()])].slice(0, 20),
      char_length: url.length,
    };
  } catch {
    return { parse_error: true, char_length: url.length };
  }
}

/** Postgres 42703 / Drizzle 嵌套 cause（含中文「字段不存在」） */
function isPgMissingColumnError(e: unknown): boolean {
  let cur: unknown = e;
  for (let i = 0; i < 8 && cur != null; i++) {
    if (typeof cur === 'object' && cur !== null && 'code' in cur) {
      const code = String((cur as { code?: unknown }).code);
      if (code === '42703') return true;
    }
    const message =
      cur instanceof Error
        ? cur.message
        : typeof cur === 'object' &&
            cur !== null &&
            'message' in cur &&
            typeof (cur as { message: unknown }).message === 'string'
          ? (cur as { message: string }).message
          : '';
    if (
      /42703|字段不存在|does not exist|undefined column|unknown column/i.test(
        message
      )
    ) {
      return true;
    }
    cur =
      cur instanceof Error
        ? cur.cause
        : typeof cur === 'object' &&
            cur !== null &&
            'cause' in cur
          ? (cur as { cause: unknown }).cause
          : undefined;
  }
  return false;
}

/** 统一页范围字符（减号、空白），避免复制粘贴的 Unicode 横线导致解析失败 */
function normalizePageRangeInput(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw)
    .trim()
    .replace(/\u2013|\u2014|\u2212/g, '-')
    .replace(/\s+/g, '');
  return s === '' ? null : s;
}

function summarizeFcEndpoint(fcUrl: string) {
  try {
    const u = new URL(fcUrl);
    return {
      host: u.host,
      pathname: u.pathname,
      href_length: fcUrl.length,
    };
  } catch {
    return { raw: fcUrl.slice(0, 120) };
  }
}

type ScanPrecheckResult = {
  likelyScanned: boolean;
  reason: string;
  confidence: 'low' | 'medium' | 'high';
};

/**
 * 轻量扫描件预判（不调用外部 OCR / FC）：
 * - 主要依据单页平均体积（扫描图像页通常显著更大）
 * - 辅助依据文件名关键词
 * 仅在高置信场景阻断，避免误拦截普通文本 PDF。
 */
function detectLikelyScannedPdf(params: {
  filename: string | null | undefined;
  sizeBytes: number | null | undefined;
  pageCount: number | null | undefined;
  pageRange: string | null;
}): ScanPrecheckResult {
  const filename = (params.filename || '').toLowerCase();
  const sizeBytes = Number(params.sizeBytes || 0);
  const pageCount = Number(params.pageCount || 0);
  const range = params.pageRange?.trim() || '';

  const hasScanHintInName =
    /scan|scanned|ocr|image-only|图片|扫描|影印/.test(filename);

  let effectivePages = pageCount > 0 ? pageCount : 0;
  if (range) {
    const hit = parseTranslatePageRange(range);
    if (hit) {
      effectivePages = Math.max(1, hit[1] - hit[0] + 1);
    }
  }
  if (effectivePages <= 0) {
    return {
      likelyScanned: false,
      reason: 'page_count_unknown',
      confidence: 'low',
    };
  }

  const avgBytesPerPage = sizeBytes / Math.max(1, effectivePages);
  const hugeImagePages = avgBytesPerPage >= 900 * 1024;
  const mediumImagePages = avgBytesPerPage >= 600 * 1024;
  const veryLargeFile = sizeBytes >= 30 * 1024 * 1024;

  if (hugeImagePages && (effectivePages >= 2 || hasScanHintInName)) {
    return {
      likelyScanned: true,
      reason: 'avg_page_size_very_high',
      confidence: 'high',
    };
  }
  if (mediumImagePages && veryLargeFile && hasScanHintInName) {
    return {
      likelyScanned: true,
      reason: 'filename_scan_hint_and_large_image_pdf',
      confidence: 'medium',
    };
  }
  return {
    likelyScanned: false,
    reason: 'not_enough_scan_signals',
    confidence: 'low',
  };
}

/** 与前端 UILang / LanguageSelector 一致；FC 内可再规范化（如 zh → zh_cn） */
const ALLOWED_TRANSLATE_LANGS = new Set([
  'en',
  'zh',
  'es',
  'fr',
  'it',
  'el',
  'ja',
  'ko',
  'de',
  'ru',
]);

export async function POST(req: Request) {
  try {
    const { userId, anonId } = await getTranslateAuth();
    const body = await req.json();
    const documentId = body.document_id;
    const sourceLang = String(body.source_lang ?? 'en')
      .trim()
      .toLowerCase();
    const targetLang = String(body.target_lang ?? 'zh')
      .trim()
      .toLowerCase();
    if (
      !ALLOWED_TRANSLATE_LANGS.has(sourceLang) ||
      !ALLOWED_TRANSLATE_LANGS.has(targetLang)
    ) {
      return Response.json(
        {
          detail: 'Unsupported source_lang or target_lang',
          code: 'invalid_language',
        },
        { status: 400 }
      );
    }
    let pageRange = normalizePageRangeInput(body.page_range);
    if (pageRange != null && !parseTranslatePageRange(pageRange)) {
      return Response.json(
        {
          detail:
            'Invalid page_range. Use a single page (e.g. 5) or a range (e.g. 1-10).',
          code: 'invalid_page_range',
        },
        { status: 400 }
      );
    }
    const sourceSliceObjectKey = body.source_slice_object_key ?? null;
    const preprocessWithOcr = Boolean(body.preprocess_with_ocr);
    if (!documentId) {
      return Response.json(
        { detail: 'document_id required' },
        { status: 400 }
      );
    }
    const where = userId
      ? eq(documents.userId, userId)
      : eq(documents.anonId, anonId);
    const [doc] = await db()
      .select()
      .from(documents)
      .where(and(eq(documents.id, documentId), where));
    if (!doc) {
      return Response.json({ detail: 'Document not found' }, { status: 404 });
    }

    const docPages = doc.pageCount ?? null;
    let pageRangeUserInputDb: string | null = null;
    let pageRangeAdjusted = false;
    if (pageRange != null && docPages != null && docPages > 0) {
      const hit = intersectPageRangeWithDocument(pageRange, docPages);
      if (!hit.ok) {
        return Response.json(
          {
            detail: `The selected page range does not overlap with this document (${docPages} page(s)).`,
            code: 'page_range_no_overlap',
            document_page_count: docPages,
          },
          { status: 400 }
        );
      }
      pageRange = hit.effectiveRange;
      pageRangeUserInputDb = hit.userInputToStore;
      pageRangeAdjusted = hit.adjusted;
    }

    const scanPrecheck = detectLikelyScannedPdf({
      filename: doc.filename,
      sizeBytes: doc.sizeBytes,
      pageCount: doc.pageCount,
      pageRange,
    });
    if (scanPrecheck.likelyScanned) {
      console.log(
        '[translate] scan_precheck_blocked',
        JSON.stringify({
          document_id: documentId,
          page_range: pageRange,
          page_count: doc.pageCount ?? null,
          file_size_bytes: doc.sizeBytes ?? null,
          scan_reason: scanPrecheck.reason,
          confidence: scanPrecheck.confidence,
        })
      );
      return Response.json(
        {
          detail:
            'This PDF looks like a scanned/image document. Please use OCR Translator to avoid unnecessary BabelDOC FC retries.',
          code: 'scan_detected_use_ocr',
          document_id: documentId,
          ocr_redirect_url: '/ocrtranslator',
          scan_reason: scanPrecheck.reason,
          confidence: scanPrecheck.confidence,
        },
        { status: 409 }
      );
    }

    if (isTranslateCreditsEnabled()) {
      if (!userId) {
        return Response.json(
          {
            detail:
              'Sign in is required to start translation when credits billing is enabled.',
            code: 'translate_login_required',
          },
          { status: 401 }
        );
      }
      const hasPageRange =
        pageRange != null && String(pageRange).trim() !== '';
      if (
        !hasPageRange &&
        (doc.pageCount == null || doc.pageCount < 1)
      ) {
        return Response.json(
          {
            detail:
              'Document page count is unknown. Enter a page range (e.g. 1-10) or wait until the file is processed, then try again.',
            code: 'document_pages_required_for_billing',
          },
          { status: 400 }
        );
      }
      const perPage = getTranslateCreditsPerPage();
      const estPages = estimateTranslatedPages(
        pageRange,
        doc.pageCount ?? null
      );
      const creditsNeeded = estPages * perPage;
      const balance = await getRemainingCredits(userId);
      if (balance < creditsNeeded) {
        return Response.json(
          {
            detail: `Insufficient credits: need ${creditsNeeded}, have ${balance}.`,
            code: 'insufficient_credits',
            need: creditsNeeded,
            have: balance,
            estimated_pages: estPages,
            credits_per_page: perPage,
          },
          { status: 402 }
        );
      }
    }

    const taskId = nanoid(21);
    let sourcePdfUrl: string | null = null;
    if (await isR2Configured()) {
      const key = sourceSliceObjectKey || doc.objectKey;
      try {
        const t0 = Date.now();
        sourcePdfUrl = await createPresignedGet(key, 3600);
        console.log(
          '[translate] presign_source_pdf ok',
          JSON.stringify({
            task_id: taskId,
            object_key: key,
            duration_ms: Date.now() - t0,
            url_summary: sourcePdfUrl ? summarizeUrlForLog(sourcePdfUrl) : null,
          })
        );
      } catch (presignErr) {
        console.error(
          '[translate] presign_source_pdf failed',
          JSON.stringify({
            task_id: taskId,
            object_key: key,
            error:
              presignErr instanceof Error ? presignErr.message : String(presignErr),
          })
        );
      }
    } else {
      console.warn(
        '[translate] presign skipped: R2 not configured (isR2Configured=false)',
        JSON.stringify({ task_id: taskId })
      );
    }
    const perPageForRow = isTranslateCreditsEnabled()
      ? getTranslateCreditsPerPage()
      : null;
    const estPagesForRow = isTranslateCreditsEnabled()
      ? estimateTranslatedPages(pageRange, doc.pageCount ?? null)
      : null;
    const creditsEstimated =
      perPageForRow != null && estPagesForRow != null
        ? estPagesForRow * perPageForRow
        : null;

    try {
      await db().insert(translationTasks).values({
        id: taskId,
        userId: userId ?? null,
        anonId: userId ? null : anonId,
        documentId,
        sourceLang,
        targetLang,
        pageRange,
        pageRangeUserInput: pageRangeUserInputDb,
        status: 'queued',
        sourceSliceObjectKey,
        preprocessWithOcr,
        creditsEstimated: creditsEstimated ?? undefined,
      });
    } catch (insertErr) {
      const msg =
        insertErr instanceof Error ? insertErr.message : String(insertErr);
      console.error('[translate] insert translation_tasks failed:', insertErr);
      if (isPgMissingColumnError(insertErr)) {
        return Response.json(
          {
            detail:
              'translation_tasks 表缺少列（常见于未跑迁移）。请在 Postgres 中依次执行：frontend/docs/migrations/translation_tasks_billing.sql，再执行 translation_tasks_fc_dispatch.sql，然后重试。',
            code: 'schema_migration_required',
          },
          { status: 503 }
        );
      }
      return Response.json(
        { detail: msg || 'Failed to create translation task' },
        { status: 500 }
      );
    }

    // Dashboard 变量在 Worker 上挂在 getCloudflareContext().env；仅读 process.env 在 OpenNext 打包后常为空的。
    const u1 = getWorkerBindingMeta('TRANSLATE_FC_URL');
    const u2 = getWorkerBindingMeta('BABELDOC_FC_URL');
    const envFcUrl = u1.value || u2.value;
    const envFcUrlTrace = u1.value
      ? `TRANSLATE_FC_URL@${u1.from}`
      : u2.value
        ? `BABELDOC_FC_URL@${u2.from}`
        : '';

    const s1 = getWorkerBindingMeta('TRANSLATE_FC_SECRET');
    const s2 = getWorkerBindingMeta('BABELDOC_FC_SECRET');
    const envFcSecret = s1.value || s2.value;
    const envFcSecretTrace = s1.value
      ? `TRANSLATE_FC_SECRET@${s1.from}`
      : s2.value
        ? `BABELDOC_FC_SECRET@${s2.from}`
        : '';

    let FC_URL = envFcUrl;
    let FC_SECRET = envFcSecret;
    let translateFcUrlInDb = false;
    let translateFcSecretInDb = false;
    if (!FC_URL || !FC_SECRET) {
      const configs = await getAllConfigs();
      translateFcUrlInDb = Boolean(String(configs.translate_fc_url ?? '').trim());
      translateFcSecretInDb = Boolean(String(configs.translate_fc_secret ?? '').trim());
      if (!FC_URL) FC_URL = String(configs.translate_fc_url ?? '').trim();
      if (!FC_SECRET) FC_SECRET = String(configs.translate_fc_secret ?? '').trim();
    }

    const fcUrlResolvedTrace = envFcUrlTrace
      ? envFcUrlTrace
      : FC_URL
        ? 'translate_fc_url@database'
        : 'none';
    const fcSecretResolvedTrace = envFcSecretTrace
      ? envFcSecretTrace
      : FC_SECRET
        ? 'translate_fc_secret@database'
        : 'none';

    console.log(
      '[translate] fc_env',
      JSON.stringify({
        task_id: taskId,
        fc_url_trace: fcUrlResolvedTrace,
        fc_secret_trace: fcSecretResolvedTrace,
        fc_url_configured: Boolean(FC_URL),
      })
    );

    if (!FC_URL?.trim()) {
      const hint = getWorkerEnvDebugKeyHints();
      console.warn(
        '[translate] FC skipped: no FC URL. Fix: (1) 部署用 `npx wrangler deploy --keep-vars` 保留控制台变量。(2) 或在后台 General → PDF translate (FC) 填 URL。(3) 变量须为「运行时」非仅 Build。',
        JSON.stringify({
          ...hint,
          translate_fc_url_in_database: translateFcUrlInDb,
          translate_fc_secret_in_database: translateFcSecretInDb,
        })
      );
    } else if (!sourcePdfUrl) {
      console.warn(
        '[translate] FC skipped: no source_pdf_url (R2 not configured or presigned GET failed). task_id=',
        taskId
      );
    } else {
      const authHeaderName =
        getWorkerBindingString('TRANSLATE_FC_AUTH_HEADER') || 'X-Babeldoc-Secret';
      const { value: publicAppUrl } = getWorkerBindingMeta('NEXT_PUBLIC_APP_URL');
      const base =
        publicAppUrl ||
        (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '') ||
        'http://localhost:3000';
      const callbackUrl = `${base}/api/translate/callback`;
      const fcEndpoint = summarizeFcEndpoint(FC_URL);
      console.log(
        '[translate] fc.request',
        JSON.stringify({
          phase: 'start',
          task_id: taskId,
          document_id: documentId,
          fc_endpoint: fcEndpoint,
          callback_url: callbackUrl,
          auth_header_name: authHeaderName,
          secret_configured: Boolean(FC_SECRET),
          includes_page_range: Boolean(pageRange && String(pageRange).trim()),
          source_pdf_url: summarizeUrlForLog(sourcePdfUrl),
          worker_runtime: isCloudflareWorker,
        })
      );

      const fcDispatchPromise = invokeTranslateFcForTask(taskId);
      if (isCloudflareWorker) {
        try {
          const ctx = getCloudflareContext() as unknown as {
            ctx?: { waitUntil?: (p: Promise<unknown>) => void };
          };
          if (ctx?.ctx?.waitUntil) {
            ctx.ctx.waitUntil(fcDispatchPromise);
            console.log(
              '[translate] fc.wait_until_registered',
              JSON.stringify({ task_id: taskId })
            );
          } else {
            void fcDispatchPromise;
            console.warn(
              '[translate] fc.wait_until_missing',
              JSON.stringify({
                task_id: taskId,
                hint: 'FC subrequest may be cancelled; use Cron dispatch-pending',
              })
            );
          }
        } catch (ctxErr) {
          void fcDispatchPromise;
          console.warn(
            '[translate] fc.get_cloudflare_context_failed',
            JSON.stringify({
              task_id: taskId,
              error:
                ctxErr instanceof Error ? ctxErr.message : String(ctxErr),
            })
          );
        }
      } else {
        void fcDispatchPromise;
        console.log(
          '[translate] fc.note_non_worker',
          JSON.stringify({
            task_id: taskId,
            hint: 'Node/local: FC invoke without waitUntil; use Cron if needed',
          })
        );
      }
    }
    const successBody: Record<string, unknown> = {
      task_id: taskId,
      page_range_effective: pageRange,
      page_range_adjusted: pageRangeAdjusted,
    };
    if (docPages != null && docPages > 0) {
      successBody.document_page_count = docPages;
    }
    if (pageRangeAdjusted && pageRangeUserInputDb) {
      successBody.page_range_user_input = pageRangeUserInputDb;
    }
    return Response.json(successBody);
  } catch (e) {
    console.error('create translate task failed:', e);
    return Response.json(
      { detail: e instanceof Error ? e.message : 'Create failed' },
      { status: 500 }
    );
  }
}
