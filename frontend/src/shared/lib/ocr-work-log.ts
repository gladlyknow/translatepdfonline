/**
 * OCR pipeline visibility logs for dev/ops troubleshooting.
 */
export function ocrWorkLog(taskId: string, phase: string, detail?: unknown): void {
  const prefix = `[ocr-task:${taskId}]`;
  if (detail !== undefined) {
    console.log(`${prefix} ${phase}`, detail);
  } else {
    console.log(`${prefix} ${phase}`);
  }
}

export function ocrMetricLog(metric: string, fields: Record<string, unknown>): void {
  console.info('[ocr-metric]', {
    metric,
    at: new Date().toISOString(),
    ...fields,
  });
}
