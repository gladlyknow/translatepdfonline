import { canonicalSiteOrigin } from '@/config/seo-routes';

/**
 * GET /llms.txt — 按 llmstxt.org 标准提供项目结构化描述供 LLM 读取。
 */
export async function GET(request: Request) {
  void request;
  const base = canonicalSiteOrigin;

  const content = `# TranslatePDFOnline — PDF Translation and OCR Tools

> An online platform for translating text-based and scanned PDF documents. The translation workflow uses layout-aware, best-effort formatting where the document and export format support it. The interface currently supports English, Chinese, Spanish, French, German, Italian, Japanese, Korean, Russian, and Greek.

## Core Features

- **OCR PDF Translation**: Upload a scanned or image-based PDF, recognize its text, review the result, translate it, and export an available output format. Formatting quality varies with scan quality, fonts, tables, handwriting, and page complexity.
- **10 Interface Languages**: The public interface and localized guides currently cover zh, en, es, fr, it, el, ja, ko, de, and ru. Available source and target languages are shown in the product before a job starts.
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

- Processing uses credits. The current rate is shown before processing; plan details and any introductory credits are shown on the pricing page.

## Product Boundaries

- Sign-in is required before document processing.
- Password-protected files, handwriting, low-resolution scans, unusual fonts, and complex tables may require preprocessing or manual review.
- Layout and formatting preservation are best effort, not guaranteed for every PDF.
- Uploaded and generated objects are normally scheduled for deletion after approximately seven days, subject to the published privacy policy and legal requirements.

## Links

- Home: ${base}
- OCR Translator: ${base}/ocrtranslator
- Pricing: ${base}/pricing
- API Documentation: ${base}/docs/api
- Privacy Policy: ${base}/privacy-policy
- Terms of Service: ${base}/terms-of-service
- Blog: ${base}/blog
`;

  return new Response(content, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
