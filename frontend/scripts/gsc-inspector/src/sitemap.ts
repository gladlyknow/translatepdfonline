// ============================================================
// Sitemaps API client
// Reference: https://developers.google.com/webmaster-tools/v3/sitemaps
// ============================================================

import { getAccessToken } from './auth.js';
import type { SitemapListResponse } from './types.js';

const API_BASE = 'https://www.googleapis.com/webmasters/v3';

/**
 * List all Search Console sites the authenticated account has access to.
 * Useful for debugging: verifies which GSC properties the Service Account can see.
 */
export async function listSites(): Promise<
  Array<{ siteUrl: string; permissionLevel: string }>
> {
  const token = await getAccessToken();

  const resp = await fetch(`${API_BASE}/sites`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Sites API error (HTTP ${resp.status}): ${text}`);
  }

  const data = await resp.json();
  return (data.siteEntry || []).map((entry: { siteUrl: string; permissionLevel: string }) => ({
    siteUrl: entry.siteUrl,
    permissionLevel: entry.permissionLevel,
  }));
}

/**
 * List all sitemaps submitted for a site.
 */
export async function listSitemaps(
  siteUrl: string
): Promise<SitemapListResponse> {
  const token = await getAccessToken();

  const resp = await fetch(
    `${API_BASE}/sites/${encodeURIComponent(siteUrl)}/sitemaps`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Sitemaps API error (HTTP ${resp.status}): ${text}`);
  }

  return resp.json() as Promise<SitemapListResponse>;
}

/**
 * Fetch a sitemap XML and extract all <url><loc> values.
 * Handles both regular sitemaps and sitemap index files.
 */
export async function extractUrlsFromSitemap(
  sitemapUrl: string
): Promise<string[]> {
  const urls: string[] = [];

  const resp = await fetch(sitemapUrl, {
    headers: {
      'User-Agent': 'gsc-inspector/1.0 (+https://translatepdfonline.com)',
      Accept: 'application/xml, text/xml',
    },
  });

  if (!resp.ok) {
    console.error(`  [WARN] Failed to fetch sitemap: ${sitemapUrl} (HTTP ${resp.status})`);
    return urls;
  }

  const text = await resp.text();

  // Check if it's a sitemap index (contains <sitemapindex>)
  if (/<sitemapindex[^>]*>/i.test(text)) {
    // Extract nested sitemap URLs
    const nestedMatches = text.matchAll(/<loc>([^<]+)<\/loc>/gi);
    const nestedUrls: string[] = [];
    for (const m of nestedMatches) {
      nestedUrls.push(m[1]);
    }

    // Recursively extract from each nested sitemap
    for (const nu of nestedUrls) {
      const nested = await extractUrlsFromSitemap(nu);
      urls.push(...nested);
    }
    return urls;
  }

  // Regular sitemap — extract <url><loc> values
  const matches = text.matchAll(/<loc>([^<]+)<\/loc>/gi);
  for (const m of matches) {
    urls.push(m[1]);
  }

  return urls;
}
