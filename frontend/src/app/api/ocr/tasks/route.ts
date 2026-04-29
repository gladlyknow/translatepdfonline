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
  getTranslateCreditsPerPage,
  isTranslateCreditsEnabled,
} from '@/shared/lib/translate-billing';
import { getRemainingCredits } from '@/shared/models/credit';

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
    let creditsEstimated: number | null = null;
    if (isTranslateCreditsEnabled()) {
      if (!userId) {
        return Response.json(
          {
            detail: 'Sign in is required to start OCR when credits billing is enabled.',
            code: 'translate_login_required',
          },
          { status: 401 }
        );
      }
      if (doc.pageCount == null || doc.pageCount < 1) {
        return Response.json(
          {
            detail:
              'Document page count is unknown. Open the document preview first, then try OCR again.',
            code: 'document_pages_required_for_billing',
          },
          { status: 400 }
        );
      }
      const estimatedPages = doc.pageCount;
      const creditsPerPage = getTranslateCreditsPerPage();
      creditsEstimated = estimatedPages * creditsPerPage;
      const balance = await getRemainingCredits(userId);
      if (balance < creditsEstimated) {
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

    return Response.json({ task_id: taskId });
  } catch (e) {
    return Response.json(
      { detail: e instanceof Error ? e.message : 'Create OCR task failed' },
      { status: 500 }
    );
  }
}
