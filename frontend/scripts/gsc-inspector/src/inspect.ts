// ============================================================
// URL Inspection API client
// Reference: https://developers.google.com/webmaster-tools/v1/urlInspection.index/inspect
// ============================================================

import { getAccessToken } from './auth.js';
import type { UrlInspectionRequest, UrlInspectionResult } from './types.js';

const API_BASE = 'https://searchconsole.googleapis.com/v1';

/**
 * Inspect a single URL's indexing status.
 * Rate limit: 600 QPM per project, 2000/day per property.
 */
export async function inspectUrl(
  siteUrl: string,
  inspectionUrl: string,
  languageCode?: string
): Promise<UrlInspectionResult> {
  const token = await getAccessToken();

  const body: UrlInspectionRequest = {
    inspectionUrl,
    siteUrl,
  };
  if (languageCode) {
    body.languageCode = languageCode;
  }

  const resp = await fetch(`${API_BASE}/urlInspection/index:inspect`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(
      `URL Inspection API error (HTTP ${resp.status}) for "${inspectionUrl}": ${text}`
    );
  }

  return resp.json() as Promise<UrlInspectionResult>;
}

/**
 * Batch-inspect multiple URLs with built-in rate limiting.
 * Respects 600 QPM limit by inserting 100ms delays between requests.
 * Results maintain the same order as input URLs.
 * Failed inspections yield null instead of throwing, so the batch continues.
 */
export async function inspectUrlsBatch(
  siteUrl: string,
  urls: string[],
  languageCode?: string,
  opts?: { onProgress?: (done: number, total: number, url: string) => void }
): Promise<Array<UrlInspectionResult | null>> {
  const results: Array<UrlInspectionResult | null> = [];
  const total = urls.length;

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    try {
      opts?.onProgress?.(i + 1, total, url);
      const result = await inspectUrl(siteUrl, url, languageCode);
      results.push(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`\n  [WARN] Skipping "${url}": ${msg}`);
      results.push(null);
    }

    // Rate limit: 600 QPM = 10 QPS, so ~100ms between requests is safe.
    // For large batches, we add a small delay.
    if (i < urls.length - 1) {
      await sleep(110);
    }
  }

  return results;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
