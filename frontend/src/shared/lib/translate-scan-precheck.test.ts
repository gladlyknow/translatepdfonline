import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  decideScanIntercept,
  normalizeScanBlockMode,
  scanFromMetadata,
  scanFromPdfHeadBytes,
} from './translate-scan-precheck';

describe('normalizeScanBlockMode', () => {
  it('defaults unknown or empty to balanced', () => {
    assert.equal(normalizeScanBlockMode(undefined), 'balanced');
    assert.equal(normalizeScanBlockMode(''), 'balanced');
    assert.equal(normalizeScanBlockMode('typo'), 'balanced');
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
    assert.equal(r.decision, 'normal_pdf');
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

  it('balanced blocks suspected + strong binary', () => {
    const suspected = scanFromMetadata({
      filename: 'doc.pdf',
      sizeBytes: 40 * 1024 * 1024,
      pageCount: 20,
      pageRange: null,
    });
    assert.equal(suspected.decision, 'suspected_scan');
    const body =
      '/Subtype /Image\n'.repeat(15) +
      ' 3 Tr\n'.repeat(6) +
      '/MCID BDC\n'.repeat(15) +
      '(cid:1)'.repeat(500);
    const bin = scanFromPdfHeadBytes(pdfHeaderWithBody(body));
    const d = decideScanIntercept({
      mode: 'balanced',
      preprocessWithOcr: false,
      metadata: suspected,
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

  it('balanced intercepts many raw (cid: tokens even when metadata is normal', () => {
    const normal = scanFromMetadata({
      filename: 'paper.pdf',
      sizeBytes: 2_936_805,
      pageCount: 7,
      pageRange: '1-2',
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
});
