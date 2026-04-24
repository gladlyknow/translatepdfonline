import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * OCR 导出的 pdf-lib 回退字体加载：
 * - 优先读取 PDF_CJK_FONT_PATH（自定义路径）
 * - 其次读取常见系统字体
 * - 最后读取仓库内 public/fonts/NotoSansSC-Regular.otf（如存在）
 */
export function tryLoadOcrPdfCjkFontBytes(): Uint8Array | null {
  const fromEnv = process.env.PDF_CJK_FONT_PATH?.trim();
  if (fromEnv && existsSync(fromEnv)) {
    try {
      return new Uint8Array(readFileSync(fromEnv));
    } catch {
      // ignore and continue fallback
    }
  }

  const winCandidates = [
    'C:\\Windows\\Fonts\\simhei.ttf',
    'C:\\Windows\\Fonts\\simfang.ttf',
    'C:\\Windows\\Fonts\\msyh.ttf',
  ];
  const posixCandidates = [
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.otf',
    '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.otf',
    '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc',
    '/System/Library/Fonts/Supplemental/Songti.ttc',
    '/System/Library/Fonts/PingFang.ttc',
  ];
  const candidates = process.platform === 'win32' ? winCandidates : posixCandidates;
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      return new Uint8Array(readFileSync(p));
    } catch {
      // keep trying
    }
  }

  const repoFallback = join(process.cwd(), 'public', 'fonts', 'NotoSansSC-Regular.otf');
  if (existsSync(repoFallback)) {
    try {
      return new Uint8Array(readFileSync(repoFallback));
    } catch {
      // no-op
    }
  }
  return null;
}
