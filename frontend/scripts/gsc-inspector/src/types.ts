// ============================================================
// Google Search Console API type definitions
// Reference: https://developers.google.com/webmaster-tools
// ============================================================

/** Service Account JSON key (downloaded from GCP IAM) */
export interface ServiceAccountKey {
  type: 'service_account';
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  client_id: string;
  auth_uri: string;
  token_uri: string;
  auth_provider_x509_cert_url: string;
  client_x509_cert_url: string;
  universe_domain: string;
}

/** OAuth2 token response */
export interface OAuthTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

// ---- URL Inspection API ----

export interface UrlInspectionRequest {
  inspectionUrl: string;
  siteUrl: string;
  languageCode?: string;
}

export interface UrlInspectionResult {
  inspectionResultLink: string;
  inspectionResult: {
    inspectedUrl: string;
    indexStatusResult?: {
      verdict?: 'PASS' | 'FAIL' | 'NEUTRAL';
      coverageState?: string;
      robotsTxtState?: string;
      indexingState?: string;
      pageFetchState?: string;
      lastCrawlTime?: string;
      userCanonical?: string;
      googleCanonical?: string;
      crawledAs?: string;
      richResultsInfo?: {
        detectedItem?: Array<{
          name: string;
          items: Array<{ name: string; verdict: string }>;
        }>;
      };
    };
    mobileUsabilityResult?: {
      verdict?: 'PASS' | 'FAIL';
    };
  };
}

// ---- Search Analytics API ----

export interface SearchAnalyticsRequest {
  startDate: string;
  endDate: string;
  dimensions?: Array<'query' | 'page' | 'country' | 'device' | 'searchAppearance'>;
  dimensionFilterGroups?: Array<{
    groupType: 'and' | 'or';
    filters: Array<{
      dimension: string;
      operator: 'equals' | 'notEquals' | 'contains' | 'notContains';
      expression: string;
    }>;
  }>;
  rowLimit?: number;
  startRow?: number;
  aggregationType?: 'auto' | 'byPage' | 'byProperty';
}

export interface SearchAnalyticsRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface SearchAnalyticsResponse {
  rows?: SearchAnalyticsRow[];
  responseAggregationType?: string;
}

// ---- Sitemaps API ----

export interface SitemapItem {
  path: string;
  lastSubmitted: string;
  isPending: boolean;
  isSitemapsIndex: boolean;
  lastDownloaded?: string;
  warnings?: string;
  errors?: string;
  contents?: Array<{
    type: string;
    submitted: string;
    indexed?: string;
  }>;
}

export interface SitemapListResponse {
  sitemap?: SitemapItem[];
}

// ---- CLI output helpers ----

export interface CliInspectResult {
  url: string;
  indexStatus: string;
  coverageState: string;
  robotsTxtState: string;
  pageFetchState: string;
  lastCrawlTime: string;
  userCanonical: string;
  issue: string;
}

/**
 * Clean Google API enum values for display.
 * Strips common prefixes: "INDEXING_STATE_", "ROBOTS_TXT_STATE_", "PAGE_FETCH_STATE_",
 * "VERDICT_" and translates UNSPECIFIED to "UNKNOWN".
 */
export function cleanEnum(val: string | undefined): string {
  if (!val) return '-';
  return val
    .replace(/^INDEXING_STATE_/, '')
    .replace(/^ROBOTS_TXT_STATE_/, '')
    .replace(/^PAGE_FETCH_STATE_/, '')
    .replace(/^VERDICT_/, '')
    .replace(/^UNSPECIFIED$/, 'UNKNOWN');
}

/** Summarize an inspection result into a human-readable issue label */
export function summarizeIssue(r: UrlInspectionResult): string {
  const idx = r.inspectionResult.indexStatusResult;
  if (!idx) return 'NO_DATA';

  const indexing = idx.indexingState || '';
  const robots = idx.robotsTxtState || '';
  const fetchState = idx.pageFetchState || '';
  const coverage = idx.coverageState || '';

  // If all states are unspecified, Google hasn't crawled this URL yet
  const allUnknown =
    (!indexing || indexing === 'INDEXING_STATE_UNSPECIFIED') &&
    (!robots || robots === 'ROBOTS_TXT_STATE_UNSPECIFIED') &&
    (!fetchState || fetchState === 'PAGE_FETCH_STATE_UNSPECIFIED');
  if (allUnknown) return 'NOT_CRAWLED_BY_GOOGLE';

  const issues: string[] = [];

  // robots.txt blocking
  if (robots === 'DISALLOWED') {
    // Indexed despite robots.txt block is extra bad
    if (indexing === 'INDEXING_ALLOW') {
      issues.push('INDEXED_DESPITE_ROBOTS_BLOCK');
    } else {
      issues.push('BLOCKED_BY_ROBOTS');
    }
  }

  // Page fetch problems
  if (fetchState === 'NOT_FOUND' || fetchState === 'SOFT_404') {
    issues.push('404_NOT_FOUND');
  } else if (fetchState === 'SERVER_ERROR' || fetchState === 'REDIRECT_ERROR') {
    issues.push(`FETCH_${cleanEnum(fetchState)}`);
  } else if (fetchState === 'ACCESS_DENIED') {
    issues.push('ACCESS_DENIED');
  } else if (fetchState && fetchState !== 'SUCCESSFUL' && fetchState !== 'PAGE_FETCH_STATE_UNSPECIFIED') {
    issues.push(`FETCH_${cleanEnum(fetchState)}`);
  }

  // Indexing issues (INDEXING_ALLOW = normal, NOT_INDEXED = problem)
  if (indexing === 'NOT_INDEXED') {
    issues.push('NOT_INDEXED');
  }

  // Coverage anomalies (not in sitemap, duplicate, etc.)
  if (coverage && !coverage.includes('indexed') && !coverage.includes('Indexed') &&
      coverage !== 'URL is unknown to Google') {
    issues.push(`COVERAGE:${coverage}`);
  }

  return issues.length > 0 ? issues.join(', ') : 'OK';
}
