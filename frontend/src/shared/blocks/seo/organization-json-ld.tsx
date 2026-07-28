/** Prevent `</script>`-style breaks inside inline JSON-LD. */
function safeJsonLdStringify(payload: unknown): string {
  return JSON.stringify(payload).replace(/</g, '\\u003c');
}

export function OrganizationJsonLd() {
  const payload = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'TranslatePDFOnline',
    url: 'https://www.translatepdfonline.com',
    logo: 'https://www.translatepdfonline.com/brand/logo.webp',
    description:
      'Free online PDF translation service that preserves original document layout.',
    sameAs: [
      'https://www.translatepdfonline.com',
    ],
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

export function WebSiteJsonLd() {
  const payload = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'TranslatePDFOnline',
    url: 'https://www.translatepdfonline.com',
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate:
          'https://www.translatepdfonline.com/search?q={search_term_string}',
      },
      'query-input': 'required name=search_term_string',
    },
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
