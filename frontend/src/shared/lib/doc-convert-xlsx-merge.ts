/**
 * doc-convert-xlsx-merge.ts
 *
 * 百度 doc_convert API 在将多页 PDF 转为 Excel 时，返回的是一个普通 ZIP 容器：
 *   BaiduOCRConverter_Excel_xxx/page-1.xlsx
 *   BaiduOCRConverter_Excel_xxx/page-2.xlsx
 *   ...
 *
 * 每个 page-N.xlsx 是有效的单页 OOXML 文件，但外层容器不是标准 Excel 格式。
 * Excel/WPS 无法直接打开这个外层 ZIP。
 *
 * 本模块负责：检测百度嵌套 ZIP 格式 → 解包 → 合并为标准多 Sheet 单文件 XLSX。
 * 零外部依赖，仅使用平台原生 API (Node.js zlib / Workers DecompressionStream)。
 */

// ---------------------------------------------------------------------------
// CRC32
// ---------------------------------------------------------------------------

const CRC32_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c;
  }
  return table;
})();

function crc32(data: Uint8Array, prev = 0): number {
  let c = prev ^ -1;
  for (let i = 0; i < data.length; i++) {
    c = CRC32_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ -1) >>> 0;
}

// ---------------------------------------------------------------------------
// Platform-adaptive DEFLATE
// ---------------------------------------------------------------------------

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  // Node.js: 优先使用 zlib.inflateRawSync（ZIP 使用 raw DEFLATE，不用 zlib wrapper）
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const zlib = require('node:zlib');
    return zlib.inflateRawSync(data);
  } catch {
    // Cloudflare Workers / browser: 使用 DecompressionStream
    if (typeof DecompressionStream !== 'undefined') {
      const blob = new Blob([data as BlobPart]);
      const ds = new DecompressionStream('deflate' as any);
      const stream = blob.stream().pipeThrough(ds);
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }
    throw new Error('No DEFLATE decompressor available');
  }
}

function deflateRawSync(data: Uint8Array): Uint8Array {
  // Node.js
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const zlib = require('node:zlib');
  return zlib.deflateRawSync(data, { level: 6 });
}

// ---------------------------------------------------------------------------
// Minimal ZIP reader
// ---------------------------------------------------------------------------

interface ZipEntry {
  filename: string;
  compressedSize: number;
  uncompressedSize: number;
  compressionMethod: number; // 0=stored, 8=deflated
  crc: number;
  /** byte offset of the local file header */
  headerOffset: number;
  /** byte offset of the file data (right after header + filename + extra) */
  dataOffset: number;
}

function readU16LE(buf: Uint8Array, off: number): number {
  return buf[off] | (buf[off + 1] << 8);
}

function readU32LE(buf: Uint8Array, off: number): number {
  return (
    buf[off] +
    (buf[off + 1] << 8) +
    (buf[off + 2] << 16) +
    (buf[off + 3] << 24)
  );
}

function findZipEntries(buffer: Uint8Array): ZipEntry[] {
  const entries: ZipEntry[] = [];
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let offset = 0;

  while (offset < buffer.length - 4) {
    const sig = view.getUint32(offset, true);
    if (sig !== 0x04034b50) {
      offset++;
      continue;
    }

    const filenameLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);
    const compMethod = view.getUint16(offset + 8, true);
    const crc = view.getUint32(offset + 14, true);
    const compSize = view.getUint32(offset + 18, true);
    const uncompSize = view.getUint32(offset + 22, true);

    const headerSize = 30 + filenameLen + extraLen;
    const filename = new TextDecoder().decode(
      buffer.subarray(offset + 30, offset + 30 + filenameLen)
    );

    entries.push({
      filename,
      compressedSize: compSize,
      uncompressedSize: uncompSize,
      compressionMethod: compMethod,
      crc,
      headerOffset: offset,
      dataOffset: offset + headerSize,
    });

    offset += headerSize + compSize;
  }

  return entries;
}

function readStoredEntry(
  buffer: Uint8Array,
  entry: ZipEntry
): Uint8Array {
  return buffer.subarray(
    entry.dataOffset,
    entry.dataOffset + entry.compressedSize
  );
}

async function readDeflatedEntry(
  buffer: Uint8Array,
  entry: ZipEntry
): Promise<Uint8Array> {
  const compressed = readStoredEntry(buffer, entry);
  return inflateRaw(compressed);
}

async function readZipEntry(
  buffer: Uint8Array,
  entry: ZipEntry
): Promise<Uint8Array> {
  if (entry.compressionMethod === 0) {
    return readStoredEntry(buffer, entry);
  }
  return readDeflatedEntry(buffer, entry);
}

// ---------------------------------------------------------------------------
// Minimal ZIP writer
// ---------------------------------------------------------------------------

interface ZipFileDef {
  name: string;
  data: Uint8Array;
}

function buildZip(files: ZipFileDef[]): Uint8Array<ArrayBuffer> {
  // Calculate sizes
  const localHeaders: Array<{
    header: Uint8Array;
    compressed: Uint8Array;
    crc: number;
    uncompSize: number;
    compSize: number;
    offset: number;
  }> = [];

  let offset = 0;

  for (const file of files) {
    const uncompSize = file.data.length;
    const compressed = deflateRawSync(file.data);
    const compSize = compressed.length;
    const c = crc32(file.data);
    const nameBytes = new TextEncoder().encode(file.name);

    // Local file header
    const header = new Uint8Array(30 + nameBytes.length);
    const dv = new DataView(header.buffer);
    dv.setUint32(0, 0x04034b50, true); // signature
    dv.setUint16(4, 20, true); // version needed (2.0)
    dv.setUint16(6, 0, true); // flags
    dv.setUint16(8, 8, true); // compression: deflate
    dv.setUint16(10, 0, true); // mod time
    dv.setUint16(12, 0, true); // mod date
    dv.setUint32(14, c, true); // crc32
    dv.setUint32(18, compSize, true);
    dv.setUint32(22, uncompSize, true);
    dv.setUint16(26, nameBytes.length, true);
    dv.setUint16(28, 0, true); // extra field length
    header.set(nameBytes, 30);

    localHeaders.push({
      header,
      compressed,
      crc: c,
      uncompSize,
      compSize,
      offset,
    });

    offset += header.length + compSize;
  }

  // Central directory
  const cdParts: Uint8Array[] = [];
  let cdOffset = offset;

  for (let i = 0; i < files.length; i++) {
    const lh = localHeaders[i];
    const nameBytes = new TextEncoder().encode(files[i].name);
    const cd = new Uint8Array(46 + nameBytes.length);
    const dv = new DataView(cd.buffer);
    dv.setUint32(0, 0x02014b50, true); // signature
    dv.setUint16(4, 20, true); // version made by
    dv.setUint16(6, 20, true); // version needed
    dv.setUint16(8, 0, true); // flags
    dv.setUint16(10, 8, true); // compression: deflate
    dv.setUint16(12, 0, true); // mod time
    dv.setUint16(14, 0, true); // mod date
    dv.setUint32(16, lh.crc, true);
    dv.setUint32(20, lh.compSize, true);
    dv.setUint32(24, lh.uncompSize, true);
    dv.setUint16(28, nameBytes.length, true);
    dv.setUint16(30, 0, true); // extra field length
    dv.setUint16(32, 0, true); // file comment length
    dv.setUint16(34, 0, true); // disk number start
    dv.setUint16(36, 0, true); // internal file attributes
    dv.setUint32(38, 0, true); // external file attributes
    dv.setUint32(42, lh.offset, true); // relative offset of local header
    cd.set(nameBytes, 46);
    cdParts.push(cd);
  }

  const cdSize = cdParts.reduce((s, p) => s + p.length, 0);
  const cdCount = files.length;

  // EOCD
  const eocd = new Uint8Array(22);
  const eocdDv = new DataView(eocd.buffer);
  eocdDv.setUint32(0, 0x06054b50, true);
  eocdDv.setUint16(4, 0, true); // disk number
  eocdDv.setUint16(6, 0, true); // disk with CD
  eocdDv.setUint16(8, cdCount, true); // entries on this disk
  eocdDv.setUint16(10, cdCount, true); // total entries
  eocdDv.setUint32(12, cdSize, true);
  eocdDv.setUint32(16, cdOffset, true);
  eocdDv.setUint16(20, 0, true); // comment length

  // Assemble
  const parts: Uint8Array[] = [];
  let totalLen = 0;
  for (const lh of localHeaders) {
    parts.push(lh.header);
    totalLen += lh.header.length;
    parts.push(lh.compressed);
    totalLen += lh.compressed.length;
  }
  for (const cd of cdParts) {
    parts.push(cd);
    totalLen += cd.length;
  }
  parts.push(eocd);
  totalLen += eocd.length;

  const result = new Uint8Array(totalLen);
  let pos = 0;
  for (const p of parts) {
    result.set(p, pos);
    pos += p.length;
  }
  return result;
}

// ---------------------------------------------------------------------------
// XLSX merge logic
// ---------------------------------------------------------------------------

const BAIDU_PAGE_RE =
  /^BaiduOCRConverter_Excel_[^/]+\/page-(\d+)\.xlsx$/;

function sortPageEntries(entries: ZipEntry[]): ZipEntry[] {
  return entries
    .filter((e) => BAIDU_PAGE_RE.test(e.filename))
    .sort((a, b) => {
      const na = parseInt(a.filename.match(/page-(\d+)/)![1], 10);
      const nb = parseInt(b.filename.match(/page-(\d+)/)![1], 10);
      return na - nb;
    });
}

/** 从 inner XLSX 中提取 XML 字符串 */
function xmlStr(data: Uint8Array): string {
  return new TextDecoder().decode(data);
}

function xmlBytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/** 解析 sharedStrings.xml 中的 <si> 元素，返回数组和包装 XML */
function parseSharedStrings(raw: string): {
  prefix: string; // <sst ...> 之前的内容 + <sst ...>
  siList: string[]; // 每个 <si>...</si> 的完整 XML
  suffix: string; // </sst>
} {
  // 提取 <si>...</si> 内容（支持 <si> 内可能包含嵌套标签）
  const siList: string[] = [];
  let depth = 0;
  let start = -1;
  // 找到 <sst 的开始
  const sstStart = raw.indexOf('<sst');
  const sstEnd = raw.indexOf('>', sstStart);
  const prefix = raw.slice(0, sstEnd + 1);
  const sstClose = raw.lastIndexOf('</sst>');
  const suffix = raw.slice(sstClose);
  const inner = raw.slice(sstEnd + 1, sstClose);

  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === '<') {
      if (inner[i + 1] === '/') {
        // closing tag
        const closeTagEnd = inner.indexOf('>', i);
        const tagName = inner.slice(i + 2, closeTagEnd);
        if (tagName === 'si') {
          depth--;
          if (depth === 0 && start >= 0) {
            siList.push(inner.slice(start, closeTagEnd + 1));
            start = -1;
          }
        }
        i = closeTagEnd;
      } else {
        // opening or self-closing tag
        const tagEnd = inner.indexOf('>', i);
        const tagStr = inner.slice(i + 1, tagEnd);
        const tagName = tagStr.split(/\s/)[0].replace('/', '');
        if (tagName === 'si') {
          if (!tagStr.endsWith('/')) {
            depth++;
            if (start < 0) start = i;
          }
        }
        i = tagEnd;
      }
    }
  }

  return { prefix, siList, suffix };
}

/** 合并多个 sharedStrings，返回合并后的 XML 和各页的偏移量 */
function mergeSharedStrings(
  sstBodies: string[]
): { merged: string; offsets: number[] } {
  const allSi: string[] = [];
  const offsets: number[] = [];

  for (const body of sstBodies) {
    const { siList } = parseSharedStrings(body);
    offsets.push(allSi.length);
    allSi.push(...siList);
  }

  // 用第一页的 prefix/suffix 模板重建
  const { prefix, suffix } = parseSharedStrings(sstBodies[0]);
  const count = allSi.length;
  const uniqueCount = count; // 保守处理：不跨页去重
  // 改写 sst 属性
  const mergedPrefix = prefix.replace(
    /\bcount="[^"]*"/,
    `count="${count}"`
  ).replace(
    /\buniqueCount="[^"]*"/,
    `uniqueCount="${uniqueCount}"`
  );
  const merged = mergedPrefix + allSi.join('') + suffix;
  return { merged, offsets };
}

/** 更新 sheet XML 中共享字符串索引（加上 offset） */
function shiftSharedStringIndices(
  sheetXml: string,
  offset: number
): string {
  if (offset === 0) return sheetXml;
  // 匹配 <c ... t="s"><v>N</v></c> 模式
  return sheetXml.replace(
    /(<c[^>]*\st="s"[^>]*>\s*<v>)(\d+)(<\/v>\s*<\/c>)/g,
    (_match, pre, numStr, post) => {
      const newVal = parseInt(numStr, 10) + offset;
      return pre + newVal + post;
    }
  );
}

/** 从 inner XLSX 的文件列表中根据路径获取内容 */
function getInnerFile(
  files: Map<string, Uint8Array>,
  path: string
): Uint8Array | undefined {
  return files.get(path);
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

/**
 * 检测并合并百度 doc_convert Excel 嵌套 ZIP。
 * - 若 buffer 不是百度嵌套格式 → 原样返回
 * - 若只有 1 页 → 直接返回 inner XLSX
 * - 多页 → 合并为标准多 Sheet XLSX
 */
export async function unwrapNestedExcelZip(
  buffer: Uint8Array<ArrayBuffer>
): Promise<Uint8Array<ArrayBuffer>> {
  // 1. 快速检测：是否以 PK 开头
  if (buffer.length < 4) return buffer;
  if (
    buffer[0] !== 0x50 ||
    buffer[1] !== 0x4b ||
    buffer[2] !== 0x03 ||
    buffer[3] !== 0x04
  ) {
    return buffer;
  }

  // 2. 解析外层 ZIP
  const outerEntries = findZipEntries(buffer);
  const pageEntries = sortPageEntries(outerEntries);

  // 3. 非百度嵌套格式 → 原样返回（已经是标准 XLSX 或单页）
  if (pageEntries.length === 0) return buffer;

  // 4. 提取所有 inner XLSX 的文件映射
  const pageFiles: Array<Map<string, Uint8Array>> = [];
  for (const entry of pageEntries) {
    const innerBytes = await readZipEntry(buffer, entry);
    const innerEntries = findZipEntries(innerBytes);
    const fileMap = new Map<string, Uint8Array>();
    for (const ie of innerEntries) {
      fileMap.set(
        ie.filename,
        await readZipEntry(innerBytes, ie)
      );
    }
    pageFiles.push(fileMap);
  }

  // 5. 单页：直接返回 inner XLSX 的原始 buffer
  if (pageFiles.length === 1) {
    const innerMap = pageFiles[0];
    // 重建单页 XLSX
    const singleFiles: ZipFileDef[] = [];
    for (const [name, data] of innerMap) {
      singleFiles.push({ name, data });
    }
    return buildZip(singleFiles);
  }

  // 6. 多页合并
  try {
    return mergeMultipleXlsxPages(pageFiles);
  } catch (e) {
    console.error(
      '[doc-convert/xlsx-merge] merge failed, falling back to raw buffer:',
      e
    );
    return buffer;
  }
}

// ---------------------------------------------------------------------------
// 多页合并实现
// ---------------------------------------------------------------------------

function mergeMultipleXlsxPages(
  pageFiles: Array<Map<string, Uint8Array>>
): Uint8Array<ArrayBuffer> {
  const base = pageFiles[0];
  const sheetCount = pageFiles.length;

  // --- 收集每页的 sheet XML 和 shared strings ---
  const sheetXmls: string[] = [];
  const sstBodies: string[] = [];

  for (let i = 0; i < pageFiles.length; i++) {
    const files = pageFiles[i];
    const sheetData = files.get('xl/worksheets/sheet1.xml');
    if (!sheetData) {
      throw new Error(`page-${i + 1}.xlsx missing xl/worksheets/sheet1.xml`);
    }
    sheetXmls.push(xmlStr(sheetData));

    const sstData = files.get('xl/sharedStrings.xml');
    if (sstData) {
      sstBodies.push(xmlStr(sstData));
    }
  }

  // --- 合并 sharedStrings ---
  const { merged: mergedSst, offsets } = mergeSharedStrings(sstBodies);

  // --- 对页面 2+ 的 sheet XML 调整共享字符串索引 ---
  const adjustedSheetXmls = sheetXmls.map((xml, i) =>
    shiftSharedStringIndices(xml, offsets[i])
  );

  // --- 构建输出文件列表 ---
  const outputFiles: ZipFileDef[] = [];

  // 从 page-1 复制不变化的文件
  const COPY_FROM_BASE = new Set([
    '_rels/.rels',
    'docProps/core.xml',
    'xl/styles.xml',
    'xl/theme/theme1.xml',
  ]);
  // [Content_Types].xml 和 docProps/app.xml 需要在后面重新生成/修改，不从 base 复制

  for (const [name, data] of base) {
    if (COPY_FROM_BASE.has(name)) {
      outputFiles.push({ name, data });
    }
  }

  // --- 写入每个 sheet ---
  for (let i = 0; i < sheetCount; i++) {
    const sheetNum = i + 1;
    outputFiles.push({
      name: `xl/worksheets/sheet${sheetNum}.xml`,
      data: xmlBytes(adjustedSheetXmls[i]),
    });
  }

  // --- sharedStrings ---
  outputFiles.push({
    name: 'xl/sharedStrings.xml',
    data: xmlBytes(mergedSst),
  });

  // --- xl/_rels/workbook.xml.rels ---
  const wbRelsParts: string[] = [];
  wbRelsParts.push(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  );
  for (let i = 0; i < sheetCount; i++) {
    wbRelsParts.push(
      `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
    );
  }
  // 保留 theme 和 styles 关系（rId 在 sheet 后面）
  wbRelsParts.push(
    `<Relationship Id="rId${sheetCount + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>`,
    `<Relationship Id="rId${sheetCount + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`,
    '</Relationships>'
  );
  outputFiles.push({
    name: 'xl/_rels/workbook.xml.rels',
    data: xmlBytes(wbRelsParts.join('')),
  });

  // --- xl/workbook.xml ---
  const sheetsXml: string[] = [];
  for (let i = 0; i < sheetCount; i++) {
    sheetsXml.push(
      `<sheet name="Page${i + 1}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`
    );
  }
  const workbookXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<fileVersion appName="xl" lastEdited="4" lowestEdited="4" rupBuild="4505"/>` +
    `<workbookPr defaultThemeVersion="124226"/>` +
    `<bookViews><workbookView xWindow="240" yWindow="15" windowWidth="16095" windowHeight="9660"/></bookViews>` +
    `<sheets>${sheetsXml.join('')}</sheets>` +
    `<calcPr calcId="152511"/>` +
    `</workbook>`;
  outputFiles.push({
    name: 'xl/workbook.xml',
    data: xmlBytes(workbookXml),
  });

  // --- [Content_Types].xml ---
  const ctParts: string[] = [];
  ctParts.push(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>',
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>',
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
    '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>',
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>',
    '<Override PartName="/xl/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>'
  );
  for (let i = 0; i < sheetCount; i++) {
    ctParts.push(
      `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    );
  }
  ctParts.push('</Types>');
  outputFiles.push({
    name: '[Content_Types].xml',
    data: xmlBytes(ctParts.join('')),
  });

  // --- docProps/app.xml --- 更新工作表数量
  const appData = base.get('docProps/app.xml');
  if (appData) {
    let appXml = xmlStr(appData);
    // 更新 HeadingPairs 中的工作表数量
    appXml = appXml.replace(
      /<vt:i4>\d+<\/vt:i4>\s*<\/vt:variant>\s*<\/vt:vector>\s*<\/HeadingPairs>/,
      `<vt:i4>${sheetCount}</vt:i4></vt:variant></vt:vector></HeadingPairs>`
    );
    // 更新 TitlesOfParts 中的工作表名称
    const titleParts: string[] = [];
    for (let i = 0; i < sheetCount; i++) {
      titleParts.push(`<vt:lpstr>Page${i + 1}</vt:lpstr>`);
    }
    // 替换 TitlesOfParts 里的 vt:vector size
    appXml = appXml.replace(
      /<vt:vector size="\d+" baseType="lpstr">[\s\S]*?<\/vt:vector>/,
      `<vt:vector size="${sheetCount}" baseType="lpstr">${titleParts.join('')}</vt:vector>`
    );
    outputFiles.push({
      name: 'docProps/app.xml',
      data: xmlBytes(appXml),
    });
  }

  return buildZip(outputFiles);
}
