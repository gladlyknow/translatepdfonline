// 注意：Disallow 只阻止抓取，不能阻止索引。已被 Google 收录的登录/账户页
// （settings、activity、auth 等）必须靠页面内的 meta noindex 清理，
// 因此这些路径从 Disallow 移除，让 Googlebot 能抓取到 noindex 标签。
// 仅保留从未被收录且绝无索引价值的路径（API、后台、聊天）。
const DISALLOW = [
  '/api/',
  '/admin/',
  '/chat',
  '/chat/',
  '/src/',
  '/docs/src/',
  '/translate/',
];

function buildRobotsTxt(sitemapUrl: string): string {
  const agents = ['*', 'Googlebot', 'Googlebot-Image', 'Bingbot'];
  const lines: string[] = [];
  for (const agent of agents) {
    lines.push(`User-agent: ${agent}`);
    lines.push('Allow: /');
    for (const path of DISALLOW) {
      lines.push(`Disallow: ${path}`);
    }
    lines.push('');
  }
  lines.push(`Sitemap: ${sitemapUrl}`);
  lines.push('');
  return lines.join('\n');
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const host = url.host;
  const protocol = host.startsWith('localhost') || host.includes(':') ? 'http' : 'https';
  const base = `${protocol}://${host}`;

  return new Response(buildRobotsTxt(`${base}/sitemap.xml`), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}

export const revalidate = 3600;
