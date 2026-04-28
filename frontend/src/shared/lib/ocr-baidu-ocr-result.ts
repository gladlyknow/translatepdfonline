export const PADDLE_VL_LAYOUT_TYPES = [
  'abstract',
  'algorithm',
  'aside_text',
  'chart',
  'content',
  'display_formula',
  'doc_title',
  'figure_title',
  'footer',
  'footer_image',
  'footnote',
  'formula_number',
  'header',
  'header_image',
  'image',
  'inline_formula',
  'number',
  'paragraph_title',
  'reference',
  'reference_content',
  'seal',
  'table',
  'text',
  'vertical_text',
] as const;

export interface BaiduPaddleVlQueryResponse {
  task_status?: string;
  taskStatus?: string;
  task_state?: string;
  taskState?: string;
  status?: string;
  result?: unknown;
  data?: unknown;
}

export interface BaiduPaddleVlResultWithUrl {
  parse_result_url?: string;
  pages?: unknown[];
  ret?: Record<string, unknown>;
  [key: string]: unknown;
}

export function extractOcrDocument(root: unknown): Record<string, unknown> {
  if (root === null || root === undefined) return { pages: [] };
  if (typeof root === 'string') {
    const s = root.trim();
    if (!s || s === 'null') return { pages: [] };
    try {
      return extractOcrDocument(JSON.parse(s));
    } catch {
      return { pages: [], _unparsedResult: s.slice(0, 500) };
    }
  }
  if (typeof root !== 'object') return { pages: [] };
  const r = root as Record<string, unknown>;
  if (Array.isArray(r.pages)) return r;
  const purl = r.parse_result_url;
  if (typeof purl === 'string' && /^https?:\/\//i.test(purl)) return r;
  if ('result' in r && r.result !== undefined) {
    const inner = extractOcrDocument(r.result);
    if (Array.isArray(inner.pages) && inner.pages.length > 0) return inner;
    if (typeof inner.parse_result_url === 'string' && /^https?:\/\//i.test(inner.parse_result_url)) {
      return inner;
    }
  }
  const ret = r.ret as Record<string, unknown> | undefined;
  if (ret && Array.isArray(ret.pages)) return ret;
  const data = r.data as Record<string, unknown> | undefined;
  if (data && Array.isArray(data.pages)) return data;
  const pr = r.parse_result as Record<string, unknown> | undefined;
  if (pr && Array.isArray(pr.pages)) return pr;
  return { pages: [], _normalizedFromKeys: Object.keys(r) };
}

async function fetchBaiduParseResultDocument(
  rawUrl: string,
  opts?: { authorizationHeader?: string; accessToken?: string }
): Promise<unknown> {
  const base = rawUrl.trim();
  const configs: Array<{ url: string; headers?: Record<string, string> }> = [];
  if (opts?.accessToken) {
    try {
      const u = new URL(base);
      if (!u.searchParams.get('access_token')) u.searchParams.set('access_token', opts.accessToken);
      configs.push({ url: u.toString() });
    } catch {}
  }
  configs.push({ url: base });
  if (opts?.authorizationHeader) {
    configs.push({ url: base, headers: { Authorization: opts.authorizationHeader } });
  }
  const seen = new Set<string>();
  let lastStatus: number | null = null;
  let lastSnippet = '';
  for (const c of configs) {
    const dedupe = `${c.url}\n${JSON.stringify(c.headers || {})}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    const res = await fetch(c.url, {
      method: 'GET',
      headers: { Accept: 'application/json, */*', ...c.headers },
      redirect: 'follow',
    });
    lastStatus = res.status;
    if (res.ok) return (await res.json()) as unknown;
    lastSnippet = (await res.text().catch(() => '')).slice(0, 400);
  }
  throw new Error(
    `parse_result_url failed: HTTP ${lastStatus ?? '?'}${lastSnippet ? ` — ${lastSnippet}` : ''}`
  );
}

export async function resolveBaiduOcrPayload(
  data: unknown,
  opts?: { authorizationHeader?: string; accessToken?: string }
): Promise<Record<string, unknown>> {
  let node: unknown = data;
  if (node && typeof node === 'object' && 'task_status' in (node as object) && 'result' in (node as object)) {
    node = (node as BaiduPaddleVlQueryResponse).result;
  }
  if (node === null || node === undefined) return { pages: [] };
  if (typeof node === 'string') {
    const s = node.trim();
    if (!s || s === 'null') return { pages: [] };
    try {
      node = JSON.parse(s);
    } catch {
      return { pages: [], _parseError: s.slice(0, 200) };
    }
  }
  if (typeof node !== 'object' || node === null) return { pages: [] };
  const o = node as BaiduPaddleVlResultWithUrl;
  const url = o.parse_result_url;
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
    const json = await fetchBaiduParseResultDocument(url, opts);
    return extractOcrDocument(json);
  }
  return extractOcrDocument(node);
}
