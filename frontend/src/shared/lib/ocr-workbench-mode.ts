export type OcrWorkbenchSearchParams = Record<
  string,
  string | string[] | undefined
>;

const WORKBENCH_STATE_PARAMS = ['task', 'document'] as const;

function hasQueryValue(value: string | string[] | undefined): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => item.trim().length > 0);
  }

  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * The OCR route doubles as an indexable landing page and an application shell.
 * Task/document URLs must reserve the viewport for the workbench instead of
 * rendering the surrounding SEO content above and below it.
 */
export function isOcrWorkbenchMode(
  searchParams: OcrWorkbenchSearchParams
): boolean {
  return WORKBENCH_STATE_PARAMS.some((key) => hasQueryValue(searchParams[key]));
}
