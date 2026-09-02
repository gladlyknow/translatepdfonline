function safeJsonLdStringify(payload: unknown): string {
  return JSON.stringify(payload).replace(/</g, '\\u003c');
}

export type SoftwareAppProps = {
  name?: string;
  description?: string;
  applicationCategory?: string;
  operatingSystem?: string;
  price?: string;
  priceCurrency?: string;
  url?: string;
};

export function SoftwareApplicationJsonLd({
  name = 'Contract Comparison Tool',
  description = 'AI-powered contract comparison for CLM — compare PDF, Word, and scanned documents with page-level precision.',
  applicationCategory = 'BusinessApplication',
  operatingSystem = 'Web',
  price = '0',
  priceCurrency = 'USD',
  url,
}: SoftwareAppProps = {}) {
  // 注意：不输出 aggregateRating —— 无真实评价来源的硬编码评分会被
  // Google 判为结构化数据造假，存在处罚风险
  const payload: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name,
    applicationCategory,
    description,
    operatingSystem,
    offers: {
      '@type': 'Offer',
      price,
      priceCurrency,
    },
  };
  if (url) {
    payload.url = url;
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(payload) }}
    />
  );
}
