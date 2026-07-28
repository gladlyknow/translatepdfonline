// ============================================================
// Search Analytics API client
// Reference: https://developers.google.com/webmaster-tools/v3/searchanalytics/query
// ============================================================

import { getAccessToken } from './auth.js';
import type { SearchAnalyticsRequest, SearchAnalyticsResponse } from './types.js';

const API_BASE = 'https://www.googleapis.com/webmasters/v3';

/**
 * Query the Search Analytics API for performance data.
 *
 * Useful dimensions: 'page' (find underperforming pages), 'query' (find queries
 * with high impressions but low clicks — possible index issues).
 *
 * Example — find pages with high impressions but zero clicks (potential crawl issues):
 * ```
 * querySearchAnalytics(siteUrl, {
 *   startDate: '2026-07-01',
 *   endDate: '2026-07-28',
 *   dimensions: ['page'],
 *   dimensionFilterGroups: [{
 *     groupType: 'and',
 *     filters: [{ dimension: 'clicks', operator: 'equals', expression: '0' }]
 *   }],
 *   rowLimit: 100,
 * })
 * ```
 */
export async function querySearchAnalytics(
  siteUrl: string,
  params: SearchAnalyticsRequest
): Promise<SearchAnalyticsResponse> {
  const token = await getAccessToken();

  const resp = await fetch(
    `${API_BASE}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
    }
  );

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(
      `Search Analytics API error (HTTP ${resp.status}): ${text}`
    );
  }

  return resp.json() as Promise<SearchAnalyticsResponse>;
}
