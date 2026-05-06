import { getCloudflareContext } from '@opennextjs/cloudflare';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '@/core/db';
import { documents, translationTasks } from '@/config/db/schema';
import { getTranslateAuth } from '../../translate/auth';
import {
  dispatchPendingOcrJobs,
  enqueueOcrTask,
  sendOcrPipelineQueueMessage,
} from '@/shared/lib/ocr-queue';
import { isCloudflareWorker } from '@/shared/lib/env';
import { isSupportedUiLang } from '@/shared/lib/translate-langs';
import {
  estimateTranslatedPages,
  getTranslateCreditsPerPage,
  intersectPageRangeWithDocument,
  isTranslateCreditsEnabled,
  normalizePageRangeInput,
  parseTranslatePageRange,
} from '@/shared/lib/translate-billing';
import { getRemainingCredits } from '@/shared/models/credit';
import { ensureDocumentPageCount } from '@/shared/lib/document-page-count';

export async function POST(req: Request) {
  try {
    const { userId, anonId } = await getTranslateAuth();
    const body = await req.json();
    const documentId = String(body.document_id || '').trim();
    const sourceLang = String(body.source_lang || 'en')
      .trim()
      .toLowerCase();
    const rawTargetLang = String(body.target_lang || '')
      .trim()
      .toLowerCase();
    const targetLang = rawTargetLang || sourceLang;
    if (!documentId) {
      return Response.json({ detail: 'document_id required' }, { status: 400 });
    }
    if (!isSupportedUiLang(sourceLang)) {
      return Response.json(
        { detail: 'Unsupported source_lang' },
        { status: 400 }
      );
    }
    if (rawTargetLang && !isSupportedUiLang(rawTargetLang)) {
      return Response.json(
        { detail: 'Unsupported target_lang' },
        { status: 400 }
      );
    }
    const where = userId
      ? eq(documents.userId, userId)
      : eq(documents.anonId, anonId);
    const [doc] = await db()
      .select()
      .from(documents)
      .where(and(eq(documents.id, documentId), where))
      .limit(1);
    if (!doc) {
      return Response.json({ detail: 'Document not found' }, { status: 404 });
    }

    let pageRange: string | null = normalizePageRangeInput(body.page_range);
    const sourceSliceObjectKey =
      typeof body.source_slice_object_key === 'string'
        ? body.source_slice_object_key.trim()
        : null;

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
    if (sourceSliceObjectKey && !pageRange) {
      return Response.json(
        {
          detail: 'page_range is required when source_slice_object_key is set.',
          code: 'page_range_required',
        },
        { status: 400 }
      );
    }
    if (pageRange && !sourceSliceObjectKey) {
      return Response.json(
        {
          detail:
            'When page_range is set, upload a sliced PDF and pass source_slice_object_key.',
          code: 'slice_required',
        },
        { status: 400 }
      );
    }
    if (sourceSliceObjectKey) {
      const expectedPrefix = `slices/${documentId}/`;
      if (!sourceSliceObjectKey.startsWith(expectedPrefix)) {
        return Response.json(
          { detail: 'Invalid source_slice_object_key', code: 'invalid_slice_key' },
          { status: 400 }
        );
      }
    }

    let pageRangeUserInputDb: string | null = null;
    let pageRangeAdjusted = false;

    const billingOn = isTranslateCreditsEnabled();
    const needResolvedPages = billingOn || Boolean(pageRange);

    let resolvedPageCount: number | null = doc.pageCount ?? null;
    let pageCountMeta: {
      source: string;
      latencyMs: number;
      attempts: number;
    } | null = null;

    if (needResolvedPages && (resolvedPageCount == null || resolvedPageCount < 1)) {
      const pageCountResult = await ensureDocumentPageCount({
        documentId: doc.id,
        objectKey: doc.objectKey,
        knownPageCount: doc.pageCount ?? null,
        reason: pageRange ? 'ocr_page_range' : 'ocr_precheck',
      });
      resolvedPageCount = pageCountResult.pageCount;
      pageCountMeta = {
        source: pageCountResult.source,
        latencyMs: pageCountResult.latencyMs,
        attempts: pageCountResult.attempts,
      };
    }

    if (pageRange) {
      if (resolvedPageCount == null || resolvedPageCount < 1) {
        return Response.json(
          {
            detail:
              'Document page count is still being prepared. Please retry in a few seconds.',
            code: 'document_pages_required_for_billing',
          },
          { status: 400 }
        );
      }
      const hit = intersectPageRangeWithDocument(pageRange, resolvedPageCount);
      if (!hit.ok) {
        return Response.json(
          {
            detail: 'Page range does not overlap this document.',
            code: 'page_range_no_overlap',
            document_page_count: resolvedPageCount,
          },
          { status: 400 }
        );
      }
      pageRange = hit.effectiveRange;
      pageRangeUserInputDb = hit.userInputToStore;
      pageRangeAdjusted = hit.adjusted;
    }

    console.log(
      '[ocr/precheck] page_count',
      JSON.stringify({
        document_id: doc.id,
        page_count_value: resolvedPageCount,
        page_count_ready: resolvedPageCount != null && resolvedPageCount > 0,
        page_count_source: pageCountMeta?.source ?? 'document_row',
        page_count_fill_latency_ms: pageCountMeta?.latencyMs ?? 0,
        page_count_attempts: pageCountMeta?.attempts ?? 0,
        page_range: pageRange,
      })
    );

    let creditsEstimated: number | null = null;
    if (billingOn) {
      if (!userId) {
        return Response.json(
          {
            detail: 'Sign in is required to start OCR when credits billing is enabled.',
            code: 'translate_login_required',
          },
          { status: 401 }
        );
      }
      if (resolvedPageCount == null || resolvedPageCount < 1) {
        return Response.json(
          {
            detail:
              'Document page count is still being prepared. Please retry in a few seconds.',
            code: 'document_pages_required_for_billing',
          },
          { status: 400 }
        );
      }
      const estimatedPages = pageRange
        ? estimateTranslatedPages(pageRange, resolvedPageCount)
        : resolvedPageCount;
      const creditsPerPage = getTranslateCreditsPerPage();
      creditsEstimated = estimatedPages * creditsPerPage;
      const balance = await getRemainingCredits(userId);
      if (balance < creditsEstimated) {
        console.warn(
          '[ocr/precheck] blocked_insufficient_credits',
          JSON.stringify({
            document_id: doc.id,
            estimated_pages: estimatedPages,
            credits_per_page: creditsPerPage,
            need: creditsEstimated,
            have: balance,
            reason: 'insufficient_credits',
          })
        );
        return Response.json(
          {
            detail: `Insufficient credits: need ${creditsEstimated}, have ${balance}.`,
            code: 'insufficient_credits',
            need: creditsEstimated,
            have: balance,
            estimated_pages: estimatedPages,
            credits_per_page: creditsPerPage,
          },
          { status: 402 }
        );
      }
    }
    const taskId = nanoid(21);
    await db().insert(translationTasks).values({
      id: taskId,
      userId: userId ?? null,
      anonId: userId ? null : anonId,
      documentId: doc.id,
      sourceLang,
      targetLang,
      pageRange,
      pageRangeUserInput: pageRangeUserInputDb,
      sourceSliceObjectKey: sourceSliceObjectKey ?? undefined,
      status: 'queued',
      preprocessWithOcr: true,
      progressPercent: 5,
      progressStage: 'ocr_submit_created',
      fcNextAttemptAt: new Date(),
      fcDispatchAttemptCount: 0,
      creditsEstimated,
    });
    await enqueueOcrTask(taskId);
    console.log(
      '[ocr] submit_and_enqueue_ok',
      JSON.stringify({ task_id: taskId, document_id: doc.id, source_lang: sourceLang, target_lang: targetLang })
    );

    const queuedOnCf = await sendOcrPipelineQueueMessage(taskId);
    if (!queuedOnCf.ok) {
      const running = dispatchPendingOcrJobs(
        Math.min(
          2,
          Math.max(1, parseInt(process.env.OCR_DISPATCH_BATCH_SIZE || '2', 10) || 2)
        )
      );
      if (isCloudflareWorker) {
        try {
          const ctx = getCloudflareContext() as unknown as {
            ctx?: { waitUntil?: (p: Promise<unknown>) => void };
          };
          if (ctx?.ctx?.waitUntil) {
            ctx.ctx.waitUntil(running);
          } else {
            void running;
          }
        } catch {
          void running;
        }
      } else {
        void running;
      }
    }

    return Response.json({
      task_id: taskId,
      page_range_effective: pageRange,
      page_range_adjusted: pageRangeAdjusted,
      page_range_user_input: pageRangeUserInputDb,
      document_page_count: resolvedPageCount,
    });
  } catch (e) {
    return Response.json(
      { detail: e instanceof Error ? e.message : 'Create OCR task failed' },
      { status: 500 }
    );
  }
}
