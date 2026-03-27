import { eq } from 'drizzle-orm';
import { db } from '@/core/db';
import { documents, translationTasks } from '@/config/db/schema';
import {
  consumeCredits,
  CreditTransactionScene,
} from '@/shared/models/credit';
import {
  getTranslateCreditsPerPage,
  isTranslateBillingRequireFcPageCount,
  isTranslateCreditsEnabled,
  pickFcPageCountFromCallback,
  resolveBillablePagesFromCallback,
} from '@/shared/lib/translate-billing';
import { verifyTranslateFcCallbackRequest } from '../fc-auth';

/** FC 未传 error_code 时，根据 error_message 归一化（与 babeldoc_fc 一致） */
function deriveErrorCodeFromCallbackBody(body: {
  error_code?: unknown;
  error_message?: unknown;
}): string | null {
  const raw = body.error_code;
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  const msg =
    typeof body.error_message === 'string' ? body.error_message : '';
  const low = msg.toLowerCase();
  if (
    low.includes('no paragraphs') ||
    low.includes('contains no paragraphs') ||
    low.includes('extracttexterror')
  ) {
    return 'no_paragraphs';
  }
  return null;
}

export async function POST(req: Request) {
  try {
    const authed = await verifyTranslateFcCallbackRequest(req);
    if (!authed) {
      return Response.json({ detail: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const taskId = body.task_id;
    const status = body.status; // 'completed' | 'failed'
    const outputObjectKey = body.output_object_key ?? null;
    const errorMessage = body.error_message ?? null;
    const errorCode = deriveErrorCodeFromCallbackBody(body);
    if (!taskId) {
      return Response.json({ detail: 'task_id required' }, { status: 400 });
    }

    const [taskPreview] = await db()
      .select()
      .from(translationTasks)
      .where(eq(translationTasks.id, taskId));
    if (!taskPreview) {
      return Response.json({ detail: 'Task not found' }, { status: 404 });
    }

    const [docRow] = await db()
      .select({ pageCount: documents.pageCount })
      .from(documents)
      .where(eq(documents.id, taskPreview.documentId));
    const documentPageCount = docRow?.pageCount ?? null;

    await db().transaction(async (tx: any) => {
      const [task] = await tx
        .select()
        .from(translationTasks)
        .where(eq(translationTasks.id, taskId))
        .for('update');

      if (!task) {
        throw new Error('Task not found');
      }

      const completed = status === 'completed';
      let creditConsumeId = task.creditConsumeId;
      let creditsCharged = task.creditsCharged;
      let billingError: string | null = task.billingError;

      // 仅成功完成时扣积分；status=failed 不进入本分支，不会 consumeCredits
      if (
        completed &&
        isTranslateCreditsEnabled() &&
        task.userId &&
        !creditConsumeId
      ) {
        const fcPages = pickFcPageCountFromCallback(body);
        const requireFc = isTranslateBillingRequireFcPageCount();
        if (requireFc && fcPages == null) {
          billingError =
            'Billing skipped: TRANSLATE_BILLING_REQUIRE_FC_PAGE_COUNT is set but callback has no translated_page_count/page_count/pages';
          creditsCharged = 0;
          console.warn(
            '[translate/callback] billing_strict_no_fc_pages',
            JSON.stringify({ task_id: taskId })
          );
        } else {
          const pages = resolveBillablePagesFromCallback(
            body,
            task.pageRange,
            documentPageCount
          );
          if (fcPages == null && !requireFc) {
            console.log(
              '[translate/callback] billing_used_fallback_pages',
              JSON.stringify({
                task_id: taskId,
                used_fallback: true,
                resolved_pages: pages,
              })
            );
          }
          const cost = pages * getTranslateCreditsPerPage();
          try {
            const consumed = await consumeCredits({
              userId: task.userId,
              credits: cost,
              scene: CreditTransactionScene.TRANSLATE,
              description: `PDF translate task ${taskId}`,
              metadata: JSON.stringify({
                taskId,
                pages,
                cost,
                fc_pages: fcPages,
              }),
              tx,
            });
            creditConsumeId = consumed.id;
            creditsCharged = cost;
            billingError = null;
          } catch (e) {
            billingError = (e instanceof Error ? e.message : String(e)).slice(
              0,
              500
            );
            creditsCharged = 0;
          }
        }
      }

      await tx
        .update(translationTasks)
        .set({
          status: completed ? 'completed' : 'failed',
          outputObjectKey: outputObjectKey ?? task.outputObjectKey,
          errorCode: errorCode ?? task.errorCode,
          errorMessage: errorMessage ?? task.errorMessage,
          progressPercent: 100,
          updatedAt: new Date(),
          ...(completed
            ? {
                creditConsumeId: creditConsumeId ?? null,
                creditsCharged: creditsCharged ?? null,
                billingError: billingError ?? null,
              }
            : {}),
        })
        .where(eq(translationTasks.id, taskId));
    });

    return Response.json({ ok: true });
  } catch (e) {
    console.error('translate callback failed:', e);
    return Response.json(
      { detail: e instanceof Error ? e.message : 'Callback failed' },
      { status: 500 }
    );
  }
}
