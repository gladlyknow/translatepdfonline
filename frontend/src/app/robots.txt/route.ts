const DISALLOW = [
  '/api/',
  '/admin/',
  '/settings/',
  '/activity/',
  '/sign-in',
  '/sign-up',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
  '/no-permission',
  '/chat',
  '/chat/',
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
      'Cache-Control': 'public, max-age=0, must-revalidate',
    },
  });
}

export const dynamic = 'force-dynamic';
