import { retryOcrTaskFromFailedStage } from '@/shared/lib/ocr-queue';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await params;
    const ok = await retryOcrTaskFromFailedStage(taskId);
    if (!ok) {
      return Response.json(
        { detail: 'Task is not retryable from failed stage' },
        { status: 400 }
      );
    }
    return Response.json({ ok: true, task_id: taskId });
  } catch (e) {
    return Response.json(
      { detail: e instanceof Error ? e.message : 'Retry OCR task failed' },
      { status: 500 }
    );
  }
}

