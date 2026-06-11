export type FAQItem = {
  question: string;
  answer: string;
};

/** Prevent `</script>`-style breaks inside inline JSON-LD. */
function safeJsonLdStringify(payload: unknown): string {
  return JSON.stringify(payload).replace(/</g, '\\u003c');
}

export function HomeFaqJsonLd({ items }: { items?: FAQItem[] | null }) {
  const list = (items || []).filter(
    (x): x is FAQItem & { question: string; answer: string } =>
      typeof x?.question === 'string' && typeof x?.answer === 'string'
  );
  if (!list.length) return null;

  const payload = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: list.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.answer,
      },
    })),
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: safeJsonLdStringify(payload),
      }}
    />
  );
}
