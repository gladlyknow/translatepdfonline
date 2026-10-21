import { canonicalSiteOrigin } from '@/config/seo-routes';

/**
 * GET /llms.txt — 按 llmstxt.org 标准提供项目结构化描述供 LLM 读取。
 */
export async function GET(request: Request) {
  void request;
  const base = canonicalSiteOrigin;

  const content = `# TranslatePDFOnline — AI-Powered PDF Translation

> An online platform for translating PDF documents while preserving original layout. Supports 10 languages including English, Chinese, Spanish, French, German, Italian, Japanese, Korean, Russian, and Greek.

## Core Features

- **OCR PDF Translation**: Upload scanned/image-based PDFs, automatic OCR → translate → export translated PDF with preserved formatting.
- **10 Language Support**: Full bidirectional translation between all supported languages (zh, en, es, fr, it, el, ja, ko, de, ru).
- **Account-based Processing**: Users sign in to process documents, manage credits, and access available job history.
- **Data Retention**: Uploaded and generated objects are normally scheduled for deletion after approximately seven days, subject to the published policy and legal requirements.

## REST API

- **POST /api/v1/translate** — Translate a PDF programmatically using an API key.
  - Authentication: Bearer token (\`Authorization: Bearer <key>\`) or \`X-API-Key\` header.
  - Request body: \`{ "document_id": "...", "source_lang": "en", "target_lang": "zh", "page_range": "1-10" }\`
  - Response: \`{ "task_id": "...", "status": "queued" }\`

## Tools

- PDF to Text: ${base}/pdf-to-text
- Image to Text: ${base}/image-to-text
- JPG to Word: ${base}/jpg-to-word
- Photo to Word: ${base}/photo-to-word
- PDF to Word: ${base}/pdf-to-word-doc
- PDF to Excel: ${base}/pdf-to-excel
- PDF to Markdown: ${base}/pdf-to-md
- Contract Comparison: ${base}/contract-comparison

## Pricing

- Processing uses credits. Current plan details and any introductory credits are shown on the pricing page.

## Links

- Home: ${base}
- OCR Translator: ${base}/ocrtranslator
- Pricing: ${base}/pricing
- API Documentation: ${base}/docs/api
- Blog: ${base}/blog
`;

  return new Response(content, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
