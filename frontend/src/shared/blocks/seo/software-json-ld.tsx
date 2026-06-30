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
  ratingValue?: string;
  ratingCount?: string;
  url?: string;
};

export function SoftwareApplicationJsonLd({
  name = 'Contract Comparison Tool',
  description = 'AI-powered contract comparison for CLM — compare PDF, Word, and scanned documents with page-level precision.',
  applicationCategory = 'BusinessApplication',
  operatingSystem = 'Web',
  price = '0',
  priceCurrency = 'USD',
  ratingValue = '4.8',
  ratingCount = '127',
  url,
}: SoftwareAppProps = {}) {
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
    aggregateRating: {
      '@type': 'AggregateRating',
      ratingValue,
      ratingCount,
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
