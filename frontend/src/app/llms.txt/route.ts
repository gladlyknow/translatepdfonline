/**
 * GET /llms.txt — 按 llmstxt.org 标准提供项目结构化描述供 LLM 读取。
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const host = url.host;
  const protocol = host.startsWith('localhost') || host.includes(':') ? 'http' : 'https';
  const base = `${protocol}://${host}`;

  const content = `# TranslatePDFOnline — AI-Powered PDF Translation

> An online platform for translating PDF documents while preserving original layout. Supports 10 languages including English, Chinese, Spanish, French, German, Italian, Japanese, Korean, Russian, and Greek.

## Core Features

- **OCR PDF Translation**: Upload scanned/image-based PDFs, automatic OCR → translate → export translated PDF with preserved formatting.
- **10 Language Support**: Full bidirectional translation between all supported languages (zh, en, es, fr, it, el, ja, ko, de, ru).
- **Credit-based Billing**: Pay per page. New users receive free trial credits.

## REST API

- **POST /api/v1/translate** — Translate a PDF programmatically using an API key.
  - Authentication: Bearer token (\`Authorization: Bearer <key>\`) or \`X-API-Key\` header.
  - Request body: \`{ "document_id": "...", "source_lang": "en", "target_lang": "zh", "page_range": "1-10" }\`
  - Response: \`{ "task_id": "...", "status": "queued" }\`
  - Rate limit: 60 requests/minute per API key.

## Tools

- PDF to Text: ${base}/pdf-to-text
- Image to Text: ${base}/image-to-text
- JPG to Word: ${base}/jpg-to-word
- Photo to Word: ${base}/photo-to-word
- PDF to Word: ${base}/pdf-to-word-doc
- Contract Comparison: ${base}/contract-comparison

## Pricing

- Pay-per-page: 10 credits/page.
- Subscription plans: monthly, quarterly, semi-annual, annual.
- Free trial credits for new users.

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
