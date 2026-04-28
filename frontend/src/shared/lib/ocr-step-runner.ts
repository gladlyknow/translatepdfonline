export async function runOcrStage<T>(params: {
  taskId: string;
  stage: string;
  fn: () => Promise<T>;
  onStart?: () => Promise<void> | void;
  onSuccess?: (out: T) => Promise<void> | void;
  onError?: (error: unknown) => Promise<void> | void;
}): Promise<T> {
  await params.onStart?.();
  try {
    const out = await params.fn();
    await params.onSuccess?.(out);
    return out;
  } catch (error) {
    await params.onError?.(error);
    throw error;
  }
}
