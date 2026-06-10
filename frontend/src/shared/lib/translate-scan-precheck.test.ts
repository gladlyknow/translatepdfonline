import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  decideScanIntercept,
  normalizeScanBlockMode,
  scanFromMetadata,
  scanFromPdfHeadBytes,
} from './translate-scan-precheck';

describe('normalizeScanBlockMode', () => {
  it('defaults unknown or empty to strict', () => {
    assert.equal(normalizeScanBlockMode(undefined), 'strict');
    assert.equal(normalizeScanBlockMode(''), 'strict');
    assert.equal(normalizeScanBlockMode('typo'), 'strict');
  });

  it('accepts known modes', () => {
    assert.equal(normalizeScanBlockMode('balanced'), 'balanced');
    assert.equal(normalizeScanBlockMode('WARN'), 'warn');
    assert.equal(normalizeScanBlockMode(' aggressive '), 'aggressive');
  });
});

describe('scanFromMetadata', () => {
  it('flags high confidence when huge pages + large file + name hint', () => {
    const r = scanFromMetadata({
      filename: 'scan_meeting_notes.pdf',
      sizeBytes: 35 * 1024 * 1024,
      pageCount: 10,
      pageRange: null,
    });
    assert.equal(r.decision, 'high_confidence_scan');
    assert.equal(r.softMetadataOnly, false);
    assert.ok(r.avgBytesPerPage >= 900 * 1024);
  });

  it('returns normal for small text-like PDF', () => {
    const r = scanFromMetadata({
      filename: 'paper.pdf',
      sizeBytes: 120 * 1024,
      pageCount: 5,
      pageRange: null,
    });
    assert.equal(r.decision, 'normal_pdf');
    assert.equal(r.softMetadataOnly, false);
  });

  it('uses full document page count for avg (not page_range span)', () => {
    const r = scanFromMetadata({
      filename: 'paper.pdf',
      sizeBytes: 2_936_805,
      pageCount: 7,
      pageRange: '1-2',
    });
    assert.equal(r.pagesForAvgSize, 7);
    assert.ok(Math.abs(r.avgBytesPerPage - 2_936_805 / 7) < 1);
    assert.equal(r.decision, 'suspected_scan');
    assert.equal(r.softMetadataOnly, true);
    assert.ok(r.reasonCodes.includes('avg_page_elevated_soft_scan_risk'));
  });
});

function pdfHeaderWithBody(body: string): Uint8Array {
  const head = `%PDF-1.4\n${body}`;
  return new Uint8Array([...head].map((c) => c.charCodeAt(0)));
}

describe('scanFromPdfHeadBytes', () => {
  it('counts image subtypes and Tj operators', () => {
    const chunks: string[] = [];
    for (let i = 0; i < 12; i++) {
      chunks.push('/Subtype /Image\n');
    }
    chunks.push(' BT /F1 12 Tf 100 700 Td (Hi) Tj ET ');
    const buf = pdfHeaderWithBody(chunks.join(''));
    const s = scanFromPdfHeadBytes(buf);
    assert.ok(s.imageSubtypeCount >= 10);
    assert.ok(s.tjOperatorCount >= 1);
  });

  it('counts cid tokens', () => {
    const body = '(cid:1)(cid:2)(cid:3) Tj ';
    const buf = pdfHeaderWithBody(body.repeat(200));
    const s = scanFromPdfHeadBytes(buf);
    assert.ok(s.cidTokenCount >= 200);
  });
});

describe('decideScanIntercept', () => {
  const smallMeta = scanFromMetadata({
    filename: 'a.pdf',
    sizeBytes: 50_000,
    pageCount: 2,
    pageRange: null,
  });

  it('skips when preprocessWithOcr', () => {
    const suspected = scanFromMetadata({
      filename: 'doc.pdf',
      sizeBytes: 40 * 1024 * 1024,
      pageCount: 20,
      pageRange: null,
    });
    assert.equal(suspected.decision, 'suspected_scan');
    const d = decideScanIntercept({
      mode: 'aggressive',
      preprocessWithOcr: true,
      metadata: suspected,
      binary: scanFromPdfHeadBytes(pdfHeaderWithBody('/Subtype /Image\n'.repeat(20))),
    });
    assert.equal(d.intercept, false);
  });

  it('strict blocks only metadata high confidence', () => {
    const high = scanFromMetadata({
      filename: 'scan_report_scanned.pdf',
      sizeBytes: 35 * 1024 * 1024,
      pageCount: 10,
      pageRange: null,
    });
    assert.equal(high.decision, 'high_confidence_scan');
    const d = decideScanIntercept({
      mode: 'strict',
      preprocessWithOcr: false,
      metadata: high,
      binary: null,
    });
    assert.equal(d.intercept, true);
    const d2 = decideScanIntercept({
      mode: 'strict',
      preprocessWithOcr: false,
      metadata: smallMeta,
      binary: scanFromPdfHeadBytes(pdfHeaderWithBody('/Subtype /Image\n'.repeat(30))),
    });
    assert.equal(d2.intercept, false);
  });

  it('balanced blocks hard suspected metadata (high page avg) without binary', () => {
    const suspected = scanFromMetadata({
      filename: 'doc.pdf',
      sizeBytes: 40 * 1024 * 1024,
      pageCount: 20,
      pageRange: null,
    });
    assert.equal(suspected.decision, 'suspected_scan');
    assert.equal(suspected.softMetadataOnly, false);
    const d = decideScanIntercept({
      mode: 'balanced',
      preprocessWithOcr: false,
      metadata: suspected,
      binary: null,
    });
    assert.equal(d.intercept, true);
  });

  it('balanced does not intercept soft-only metadata without binary signals', () => {
    const m = scanFromMetadata({
      filename: 'report.pdf',
      sizeBytes: 2_936_805,
      pageCount: 7,
      pageRange: '1-2',
    });
    assert.equal(m.decision, 'suspected_scan');
    assert.equal(m.softMetadataOnly, true);
    const d = decideScanIntercept({
      mode: 'balanced',
      preprocessWithOcr: false,
      metadata: m,
      binary: null,
    });
    assert.equal(d.intercept, false);
  });

  it('balanced still intercepts soft-only metadata when CID sample is heavy', () => {
    const m = scanFromMetadata({
      filename: 'report.pdf',
      sizeBytes: 2_936_805,
      pageCount: 7,
      pageRange: '1-2',
    });
    assert.equal(m.softMetadataOnly, true);
    const body = '(cid:12)'.repeat(80);
    const bin = scanFromPdfHeadBytes(pdfHeaderWithBody(body));
    assert.ok(bin.cidTokenCount >= 18);
    const d = decideScanIntercept({
      mode: 'balanced',
      preprocessWithOcr: false,
      metadata: m,
      binary: bin,
    });
    assert.equal(d.intercept, true);
  });

  it('warn never intercepts', () => {
    const high = scanFromMetadata({
      filename: 'scan_x_scanned.pdf',
      sizeBytes: 35 * 1024 * 1024,
      pageCount: 10,
      pageRange: null,
    });
    const d = decideScanIntercept({
      mode: 'warn',
      preprocessWithOcr: false,
      metadata: high,
      binary: null,
    });
    assert.equal(d.intercept, false);
  });

  it('balanced intercepts many raw (cid: tokens when metadata still normal', () => {
    const normal = scanFromMetadata({
      filename: 'paper.pdf',
      sizeBytes: 800 * 1024,
      pageCount: 20,
      pageRange: null,
    });
    assert.equal(normal.decision, 'normal_pdf');
    const body = '(cid:12)'.repeat(80);
    const bin = scanFromPdfHeadBytes(pdfHeaderWithBody(body));
    assert.ok(bin.cidTokenCount >= 18);
    const d = decideScanIntercept({
      mode: 'balanced',
      preprocessWithOcr: false,
      metadata: normal,
      binary: bin,
    });
    assert.equal(d.intercept, true);
  });

  it('balanced does NOT block high CID with enough text operators (normal CJK PDF)', () => {
    const normal = scanFromMetadata({
      filename: 'paper.pdf',
      sizeBytes: 2_000_000,
      pageCount: 10,
      pageRange: null,
    });
    assert.equal(normal.decision, 'normal_pdf');
    // 模拟带嵌入 CJK 字体的正常 PDF：有 CID token + 有大量文字算子
    const parts: string[] = [];
    for (let i = 0; i < 40; i++) parts.push('(cid:12)');
    for (let i = 0; i < 30; i++) parts.push(' BT /F1 12 Tf 100 700 Td (Hello) Tj ET ');
    const body = parts.join('\n');
    const bin = scanFromPdfHeadBytes(pdfHeaderWithBody(body));
    assert.ok(bin.cidTokenCount >= 18, 'should have enough CID tokens');
    assert.ok(bin.tjOperatorCount >= 24, 'should have enough text operators');
    const d = decideScanIntercept({
      mode: 'balanced',
      preprocessWithOcr: false,
      metadata: normal,
      binary: bin,
    });
    assert.equal(d.intercept, false, 'normal PDF with text ops should not be blocked');
  });
});
