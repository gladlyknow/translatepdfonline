#!/usr/bin/env tsx
// ============================================================
// GSC Inspector CLI — Google Search Console crawl error checker
//
// Usage:
//   tsx src/index.ts inspect --site <siteUrl> --urls <url1,url2,...>
//   tsx src/index.ts inspect --site <siteUrl> --file <urls.txt>
//   tsx src/index.ts search-analytics --site <siteUrl> --days 30
//   tsx src/index.ts list-sitemap-urls --site <siteUrl>
//   tsx src/index.ts inspect-from-sitemap --site <siteUrl>
//
// Output: terminal table (default) or JSON file with --output
// ============================================================

import * as fs from 'node:fs';
import * as path from 'node:path';
import { inspectUrl, inspectUrlsBatch } from './inspect.js';
import { querySearchAnalytics } from './search-analytics.js';
import { listSites, listSitemaps, extractUrlsFromSitemap } from './sitemap.js';
import { getAccessToken } from './auth.js';
import { summarizeIssue, cleanEnum } from './types.js';
import type { UrlInspectionResult, SearchAnalyticsResponse } from './types.js';

// ---- CLI argument parser ----

interface CliArgs {
  command: string;
  site?: string;
  urls?: string[];
  file?: string;
  output?: string;
  days?: number;
  languageCode?: string;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = {
    command: args[0] || 'help',
    urls: [],
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--site':
      case '-s':
        result.site = args[++i];
        break;
      case '--urls':
      case '-u':
        result.urls = args[++i]?.split(',').map((u) => u.trim()).filter(Boolean);
        break;
      case '--file':
      case '-f':
        result.file = args[++i];
        break;
      case '--output':
      case '-o':
        result.output = args[++i];
        break;
      case '--days':
      case '-d':
        result.days = parseInt(args[++i] || '30', 10);
        break;
      case '--lang':
        result.languageCode = args[++i];
        break;
    }
  }

  return result;
}

// ---- Main dispatcher ----

async function main(): Promise<void> {
  const args = parseArgs();

  if (args.command === 'help' || args.command === '--help' || args.command === '-h') {
    printHelp();
    return;
  }

  // Try to get an access token early to fail fast on auth issues
  try {
    await getAccessToken();
  } catch (err) {
    console.error('AUTH ERROR:', err instanceof Error ? err.message : err);
    process.exit(1);
  }

  switch (args.command) {
    case 'inspect':
      await cmdInspect(args);
      break;
    case 'search-analytics':
      await cmdSearchAnalytics(args);
      break;
    case 'list-sites':
      await cmdListSites(args);
      break;
    case 'list-sites':
      await cmdListSites(args);
      break;
    case 'list-sitemap-urls':
      await cmdListSitemapUrls(args);
      break;
    case 'inspect-from-sitemap':
      await cmdInspectFromSitemap(args);
      break;
    default:
      console.error(`Unknown command: ${args.command}`);
      printHelp();
      process.exit(1);
  }
}

// ---- Command implementations ----

async function cmdInspect(args: CliArgs): Promise<void> {
  const site = args.site || process.env.GSC_SITE_URL;
  if (!site) {
    console.error('ERROR: --site is required (or set GSC_SITE_URL env var)');
    process.exit(1);
  }

  // Collect URLs from --urls flag and/or --file flag
  const urls = new Set<string>();
  if (args.urls) {
    for (const u of args.urls) urls.add(u);
  }
  if (args.file) {
    const content = fs.readFileSync(args.file, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        urls.add(trimmed);
      }
    }
  }

  if (urls.size === 0) {
    console.error('ERROR: No URLs provided. Use --urls or --file.');
    process.exit(1);
  }

  const urlList = [...urls];
  console.log(`\n🔍 Inspecting ${urlList.length} URL(s) on site "${site}"...\n`);

  const results = await inspectUrlsBatch(site, urlList, args.languageCode, {
    onProgress: (done, total, url) => {
      process.stderr.write(`  [${done}/${total}] ${url}\r`);
    },
  });

  console.log(''); // newline after progress

  // Render results
  const rows = results.map((r, i) => {
    if (!r) return { url: urlList[i], indexStatus: 'ERROR', coverageState: '-', robotsTxtState: '-', pageFetchState: '-', lastCrawlTime: '-', userCanonical: '-', issue: 'API_ERROR' };
    const idx = r.inspectionResult.indexStatusResult;
    return {
      url: r.inspectionResult.inspectedUrl || urlList[i],
      indexStatus: cleanEnum(idx?.indexingState) || cleanEnum(idx?.verdict) || '-',
      coverageState: idx?.coverageState || '-',
      robotsTxtState: cleanEnum(idx?.robotsTxtState),
      pageFetchState: cleanEnum(idx?.pageFetchState),
      lastCrawlTime: formatDate(idx?.lastCrawlTime),
      userCanonical: idx?.userCanonical || '-',
      issue: summarizeIssue(r),
    };
  });

  printTable(rows, [
    { key: 'url', label: 'URL', width: 60 },
    { key: 'indexStatus', label: 'Index', width: 14 },
    { key: 'robotsTxtState', label: 'Robots.txt', width: 14 },
    { key: 'pageFetchState', label: 'Fetch', width: 16 },
    { key: 'lastCrawlTime', label: 'Last Crawl', width: 22 },
    { key: 'issue', label: 'Issue', width: 30 },
  ]);

  // Summary stats
  const withIssues = rows.filter((r) => r.issue !== 'OK' && r.issue !== 'API_ERROR');
  const apiErrors = rows.filter((r) => r.issue === 'API_ERROR');

  console.log(`\n📊 Summary: ${rows.length} checked, ${withIssues.length} with issues, ${apiErrors.length} API errors`);
  if (withIssues.length > 0) {
    const byIssue = new Map<string, number>();
    for (const r of withIssues) {
      for (const issue of r.issue.split(', ')) {
        byIssue.set(issue, (byIssue.get(issue) || 0) + 1);
      }
    }
    for (const [issue, count] of [...byIssue.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${issue}: ${count}`);
    }
  }

  // Save to JSON if requested
  await maybeSaveJson(args.output, rows);
}

async function cmdSearchAnalytics(args: CliArgs): Promise<void> {
  const site = args.site || process.env.GSC_SITE_URL;
  if (!site) {
    console.error('ERROR: --site is required');
    process.exit(1);
  }

  const days = args.days || 30;
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const dateStr = (d: Date) => d.toISOString().slice(0, 10);

  console.log(`\n📈 Querying search analytics for "${site}" (${dateStr(startDate)} → ${dateStr(endDate)})...\n`);

  // Query top pages by clicks (to identify underperforming pages)
  const result: SearchAnalyticsResponse = await querySearchAnalytics(site, {
    startDate: dateStr(startDate),
    endDate: dateStr(endDate),
    dimensions: ['page'],
    rowLimit: 100,
  });

  const rows = result.rows || [];
  if (rows.length === 0) {
    console.log('  No data returned.');
    return;
  }

  const formatted = rows.map((r) => ({
    page: r.keys[0],
    clicks: r.clicks,
    impressions: r.impressions,
    ctr: (r.ctr * 100).toFixed(2) + '%',
    position: r.position.toFixed(1),
  }));

  // Sort by impressions desc (high impressions + low clicks = potential issue)
  formatted.sort((a, b) => b.impressions - a.impressions);

  printTable(formatted, [
    { key: 'page', label: 'Page', width: 70 },
    { key: 'clicks', label: 'Clicks', width: 8 },
    { key: 'impressions', label: 'Impr.', width: 8 },
    { key: 'ctr', label: 'CTR', width: 8 },
    { key: 'position', label: 'Pos.', width: 6 },
  ]);

  console.log(`\n📊 Top ${rows.length} pages by impressions.`);
  console.log('💡 Tip: Pages with high impressions but low/zero clicks may have index issues.');

  await maybeSaveJson(args.output, formatted);
}

async function cmdListSites(_args: CliArgs): Promise<void> {
  console.log('\n📋 Listing GSC sites accessible by this Service Account...\n');

  const sites = await listSites();

  if (sites.length === 0) {
    console.log('  No sites found. The Service Account may not have access to any GSC property.');
    console.log('  Check: https://search.google.com/search-console → Settings → Users and permissions');
    return;
  }

  printTable(
    sites.map((s) => ({ siteUrl: s.siteUrl, permission: s.permissionLevel })),
    [
      { key: 'siteUrl', label: 'Site URL (use with --site)', width: 55 },
      { key: 'permission', label: 'Permission', width: 20 },
    ]
  );

  console.log(`\n📊 ${sites.length} site(s) found.`);
  console.log('💡 Tip: Use the exact siteUrl value with --site in other commands.');
}

async function cmdListSitemapUrls(args: CliArgs): Promise<void> {
  const site = args.site || process.env.GSC_SITE_URL;
  if (!site) {
    console.error('ERROR: --site is required');
    process.exit(1);
  }

  console.log(`\n🗺️  Listing sitemaps for "${site}"...\n`);

  const sitemaps = await listSitemaps(site);
  if (!sitemaps.sitemap || sitemaps.sitemap.length === 0) {
    console.log('  No sitemaps found.');
    return;
  }

  for (const sm of sitemaps.sitemap) {
    console.log(`  📄 ${sm.path}`);
    console.log(`     Submitted: ${sm.lastSubmitted}, Pending: ${sm.isPending}, Index: ${sm.isSitemapsIndex}`);
    if (sm.errors) console.log(`     ❌ Errors: ${sm.errors}`);
    if (sm.warnings) console.log(`     ⚠️  Warnings: ${sm.warnings}`);

    // Extract URLs from this sitemap
    const urls = await extractUrlsFromSitemap(sm.path);
    console.log(`     🔗 ${urls.length} URLs extracted`);
    for (const u of urls.slice(0, 10)) {
      console.log(`        ${u}`);
    }
    if (urls.length > 10) {
      console.log(`        ... and ${urls.length - 10} more`);
    }
    console.log('');

    await maybeSaveJson(args.output, urls);
  }
}

async function cmdInspectFromSitemap(args: CliArgs): Promise<void> {
  const site = args.site || process.env.GSC_SITE_URL;
  if (!site) {
    console.error('ERROR: --site is required');
    process.exit(1);
  }

  console.log(`\n🗺️  Extracting URLs from sitemaps for "${site}"...\n`);

  const sitemaps = await listSitemaps(site);
  if (!sitemaps.sitemap || sitemaps.sitemap.length === 0) {
    console.log('  No sitemaps found.');
    return;
  }

  const allUrls = new Set<string>();
  for (const sm of sitemaps.sitemap) {
    console.log(`  Fetching: ${sm.path}`);
    const urls = await extractUrlsFromSitemap(sm.path);
    for (const u of urls) allUrls.add(u);
  }

  console.log(`\n  Total unique URLs: ${allUrls.size}`);

  if (allUrls.size === 0) return;

  // Limit to avoid hitting daily quota
  const MAX_URLS = 500;
  const urlList = [...allUrls].slice(0, MAX_URLS);
  if (allUrls.size > MAX_URLS) {
    console.log(`  ⚠️  Limiting to first ${MAX_URLS} URLs (daily quota: 2000).`);
  }

  console.log(`\n🔍 Inspecting ${urlList.length} URLs...\n`);

  const results = await inspectUrlsBatch(site, urlList, args.languageCode, {
    onProgress: (done, total, url) => {
      process.stderr.write(`  [${done}/${total}] ${url}\r`);
    },
  });

  console.log('');

  const rows = results.map((r, i) => {
    if (!r) return { url: urlList[i], indexStatus: 'ERROR', robotsTxtState: '-', pageFetchState: '-', lastCrawlTime: '-', issue: 'API_ERROR' };
    const idx = r.inspectionResult.indexStatusResult;
    return {
      url: r.inspectionResult.inspectedUrl || urlList[i],
      indexStatus: idx?.indexingState || idx?.verdict || '-',
      robotsTxtState: idx?.robotsTxtState || '-',
      pageFetchState: idx?.pageFetchState || '-',
      lastCrawlTime: formatDate(idx?.lastCrawlTime),
      issue: summarizeIssue(r),
    };
  });

  // Filter only URLs with issues
  const problemRows = rows.filter((r) => r.issue !== 'OK' && r.issue !== 'API_ERROR');

  if (problemRows.length > 0) {
    console.log(`\n⚠️  ${problemRows.length} URLs with issues:\n`);
    printTable(problemRows, [
      { key: 'url', label: 'URL', width: 70 },
      { key: 'indexStatus', label: 'Index', width: 14 },
      { key: 'robotsTxtState', label: 'Robots.txt', width: 14 },
      { key: 'pageFetchState', label: 'Fetch', width: 16 },
      { key: 'issue', label: 'Issue', width: 30 },
    ]);
  } else {
    console.log('\n✅ All inspected URLs are OK.');
  }

  console.log(`\n📊 Summary: ${rows.length} checked, ${problemRows.length} with issues, ${rows.filter(r => r.issue === 'API_ERROR').length} API errors`);

  await maybeSaveJson(args.output, { all: rows, problems: problemRows });
}

// ---- Helpers ----

function printHelp(): void {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║               GSC Inspector — Usage Guide                    ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  Commands:                                                   ║
║                                                              ║
║  inspect               Check URL indexing/crawl status       ║
║    --site, -s          GSC site URL (required)               ║
║    --urls, -u          Comma-separated URLs to check         ║
║    --file, -f          File with one URL per line            ║
║    --lang              Language code (e.g. en, zh)           ║
║    --output, -o        Save results as JSON file             ║
║                                                              ║
║  search-analytics       Query search performance data        ║
║    --site, -s          GSC site URL (required)               ║
║    --days, -d          Days to query (default: 30)           ║
║    --output, -o        Save results as JSON file             ║
║                                                              ║
║  list-sitemap-urls      Extract URLs from submitted sitemaps ║
║    --site, -s          GSC site URL (required)               ║
║    --output, -o        Save URLs as JSON file                ║
║                                                              ║
║  inspect-from-sitemap   Sitemap URLs → batch inspect         ║
║    --site, -s          GSC site URL (required)               ║
║    --output, -o        Save results as JSON file             ║
║                                                              ║
║  Environment:                                                ║
║    GOOGLE_SERVICE_ACCOUNT_KEY   Service Account JSON key     ║
║    GSC_SITE_URL                 Default site URL (optional)  ║
║                                                              ║
║  Examples:                                                   ║
║    tsx src/index.ts inspect -s sc_domain:example.com \\      ║
║      -u "https://example.com/page1,https://..."              ║
║                                                              ║
║    tsx src/index.ts inspect -s sc_domain:example.com \\      ║
║      -f urls.txt -o results.json                             ║
║                                                              ║
║    cat urls.txt | while read url; do                         ║
║      tsx src/index.ts inspect -s sc_domain:example.com \\    ║
║        -u "$url"                                             ║
║    done                                                      ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
`);
}

function printTable(
  rows: Record<string, unknown>[],
  cols: { key: string; label: string; width: number }[]
): void {
  // Header
  const header = cols.map((c) => c.label.padEnd(c.width).slice(0, c.width)).join(' │ ');
  const sep = cols.map((c) => '─'.repeat(c.width)).join('─┼─');

  console.log(`  ${header}`);
  console.log(`  ${sep}`);

  // Rows
  for (const row of rows) {
    const cells = cols.map((c) => {
      const val = String(row[c.key] ?? '-');
      return val.padEnd(c.width).slice(0, c.width);
    });
    console.log(`  ${cells.join(' │ ')}`);
  }
}

function formatDate(d: string | undefined): string {
  if (!d) return '-';
  try {
    return new Date(d).toISOString().replace('T', ' ').slice(0, 19);
  } catch {
    return d;
  }
}

async function maybeSaveJson(
  filePath: string | undefined,
  data: unknown
): Promise<void> {
  if (!filePath) return;
  const abs = path.resolve(filePath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`\n💾 Saved to: ${abs}`);
}

// ---- Entry ----

main().catch((err) => {
  console.error('\n❌ FATAL:', err instanceof Error ? err.message : err);
  process.exit(1);
});
