import { getCloudflareContext } from '@opennextjs/cloudflare';
import { eq, and } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '@/core/db';
import { documents, translationTasks } from '@/config/db/schema';
import { getTranslateAuth } from './auth';
import { getAllConfigs } from '@/shared/models/config';
import {
  createPresignedGet,
  getObjectByteRange,
  isR2Configured,
} from '@/shared/lib/translate-r2';
import {
  decideScanIntercept,
  mergeBinaryScanSignals,
  normalizeScanBlockMode,
  scanFromMetadata,
  scanFromPdfHeadBytes,
} from '@/shared/lib/translate-scan-precheck';
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
  normalizePageRangeInput,
  parseTranslatePageRange,
} from '@/shared/lib/translate-billing';
import { isSupportedUiLang } from '@/shared/lib/translate-langs';
import { ensureDocumentPageCount } from '@/shared/lib/document-page-count';
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
    if (!isSupportedUiLang(sourceLang) || !isSupportedUiLang(targetLang)) {
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

    /** 扣费预估用页数：全文翻译时会在下方 billing 分支尝试 ensureDocumentPageCount 填充 */
    let docPageCountResolved = doc.pageCount ?? null;

    const scanMetadata = scanFromMetadata({
      filename: doc.filename,
      sizeBytes: doc.sizeBytes,
      pageCount: doc.pageCount,
      pageRange,
    });

    const scanBlockMode = normalizeScanBlockMode(
      getWorkerBindingString('SCAN_BLOCK_MODE') || process.env.SCAN_BLOCK_MODE
    );

    let binarySignals = null as ReturnType<typeof scanFromPdfHeadBytes> | null;
    let pdfHeadFetch: 'ok' | 'skipped' | 'failed' = 'skipped';
    if (!preprocessWithOcr && (await isR2Configured())) {
      const rawHeadMax = Number(process.env.SCAN_PDF_HEAD_MAX_BYTES);
      const parsedHeadMax =
        Number.isFinite(rawHeadMax) && rawHeadMax >= 64 * 1024
          ? rawHeadMax
          : 1024 * 1024;
      const headMax = Math.min(parsedHeadMax, 4 * 1024 * 1024);
      const objectKey = (sourceSliceObjectKey || doc.objectKey || '').trim();
      if (objectKey) {
        try {
          const head = await getObjectByteRange(objectKey, 0, headMax - 1);
          const isPdfHeader =
            head.length >= 5 &&
            head[0] === 0x25 &&
            head[1] === 0x50 &&
            head[2] === 0x44 &&
            head[3] === 0x46 &&
            head[4] === 0x2d;
          if (isPdfHeader) {
            binarySignals = scanFromPdfHeadBytes(head);
            pdfHeadFetch = 'ok';
            const totalSize = Number(doc.sizeBytes || 0);
            const tailMax = 512 * 1024;
            if (totalSize > head.length && totalSize > tailMax) {
              try {
                const tailStart = Math.max(0, totalSize - tailMax);
                const tail = await getObjectByteRange(
                  objectKey,
                  tailStart,
                  totalSize - 1
                );
                if (tail.length > 0) {
                  binarySignals = mergeBinaryScanSignals(
                    binarySignals,
                    scanFromPdfHeadBytes(tail)
                  );
                }
              } catch (tailErr) {
                console.warn(
                  '[translate] scan_pdf_tail_fetch_failed',
                  JSON.stringify({
                    document_id: documentId,
                    error:
                      tailErr instanceof Error
                        ? tailErr.message
                        : String(tailErr),
                  })
                );
              }
            }
          } else {
            pdfHeadFetch = 'failed';
          }
        } catch (e) {
          pdfHeadFetch = 'failed';
          console.warn(
            '[translate] scan_pdf_head_fetch_failed',
            JSON.stringify({
              document_id: documentId,
              object_key_hint: objectKey.length > 80 ? `${objectKey.slice(0, 80)}…` : objectKey,
              error: e instanceof Error ? e.message : String(e),
            })
          );
        }
      }
    }

    const scanDecision = decideScanIntercept({
      mode: scanBlockMode,
      preprocessWithOcr,
      metadata: scanMetadata,
      binary: binarySignals,
    });

    if (
      scanMetadata.decision !== 'normal_pdf' ||
      binarySignals != null ||
      scanBlockMode !== 'off'
    ) {
      console.log(
        '[translate] scan_precheck_v2',
        JSON.stringify({
          document_id: documentId,
          page_range: pageRange,
          page_count: doc.pageCount ?? null,
          pages_for_avg_size: scanMetadata.pagesForAvgSize,
          file_size_bytes: doc.sizeBytes ?? null,
          metadata_decision: scanMetadata.decision,
          scan_block_mode: scanBlockMode,
          intercept: scanDecision.intercept,
          reason_codes: scanDecision.reasonCodes,
          confidence: scanMetadata.confidence,
          pdf_head_fetch: pdfHeadFetch,
          binary_sample_bytes: binarySignals?.sampleBytes ?? null,
          strong_binary_count: scanDecision.signals?.strong_binary_count ?? null,
        })
      );
    }

    if (scanDecision.intercept) {
      return Response.json(
        {
          detail:
            'This PDF looks like a scanned/image document. Please use OCR Translator to avoid unnecessary BabelDOC FC retries.',
          code: 'scan_detected_use_ocr',
          document_id: documentId,
          target_lang: targetLang,
          ocr_redirect_url: '/ocrtranslator',
          decision: scanMetadata.decision,
          reason_codes: scanDecision.reasonCodes,
          confidence: scanMetadata.confidence,
          signals: scanDecision.signals ?? undefined,
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
        (docPageCountResolved == null || docPageCountResolved < 1)
      ) {
        const fill = await ensureDocumentPageCount({
          documentId: doc.id,
          objectKey: doc.objectKey,
          knownPageCount: doc.pageCount ?? null,
          reason: 'translate_billing_precheck',
        });
        if (fill.pageCount != null && fill.pageCount > 0) {
          docPageCountResolved = fill.pageCount;
        }
      }
      if (
        !hasPageRange &&
        (docPageCountResolved == null || docPageCountResolved < 1)
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
        docPageCountResolved
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
      ? estimateTranslatedPages(pageRange, docPageCountResolved)
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
              'translation_tasks 表缺少列（常见于未跑迁移）。请在 Postgres 中依次执行：frontend/docs/migrations/translation_tasks_billing.sql，再执行 translation_tasks_fc_dispatch.sql、translation_tasks_fc_fetch_hang_retry.sql，然后重试。',
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
