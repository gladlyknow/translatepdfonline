import { retryOcrTaskFromFailedStage } from '@/shared/lib/ocr-queue';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await params;
    const result = await retryOcrTaskFromFailedStage(taskId);
    if (!result.ok) {
      return Response.json(
        { detail: 'Task is not retryable from failed stage' },
        { status: 400 }
      );
    }
    return Response.json({
      ok: true,
      task_id: taskId,
      resume_stage: result.resumeStage ?? null,
    });
  } catch (e) {
    return Response.json(
      { detail: e instanceof Error ? e.message : 'Retry OCR task failed' },
      { status: 500 }
    );
  }
}

