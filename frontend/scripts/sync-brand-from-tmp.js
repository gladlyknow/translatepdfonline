/**
 * 将仓库根目录下 tmp/images 中的设计资源同步到 public/brand：
 * - 全部文件 → public/brand/local/
 * - LOGO_T-PDF.jpeg → public/brand/logo-t-pdf.jpeg
 * - T-PDF.jpeg → public/brand/t-pdf-preview.jpeg
 *
 * 用法（在 frontend 目录）：pnpm run brand:sync-from-tmp
 */
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const srcDir = path.join(repoRoot, 'tmp', 'images');
const destLocal = path.join(__dirname, '..', 'public', 'brand', 'local');
const destLogo = path.join(__dirname, '..', 'public', 'brand', 'logo-t-pdf.jpeg');
const destPreview = path.join(__dirname, '..', 'public', 'brand', 't-pdf-preview.jpeg');

function main() {
  if (!fs.existsSync(srcDir)) {
    console.error(`[brand:sync-from-tmp] 源目录不存在: ${srcDir}`);
    process.exit(1);
  }

  fs.mkdirSync(destLocal, { recursive: true });

  const names = fs.readdirSync(srcDir);
  for (const name of names) {
    const from = path.join(srcDir, name);
    if (!fs.statSync(from).isFile()) continue;
    fs.copyFileSync(from, path.join(destLocal, name));
  }

  const logoSrc = path.join(srcDir, 'LOGO_T-PDF.jpeg');
  const previewSrc = path.join(srcDir, 'T-PDF.jpeg');
  if (fs.existsSync(logoSrc)) {
    fs.copyFileSync(logoSrc, destLogo);
  } else {
    console.warn('[brand:sync-from-tmp] 跳过 logo：缺少 LOGO_T-PDF.jpeg');
  }
  if (fs.existsSync(previewSrc)) {
    fs.copyFileSync(previewSrc, destPreview);
  } else {
    console.warn('[brand:sync-from-tmp] 跳过预览图：缺少 T-PDF.jpeg');
  }

  console.log(
    `[brand:sync-from-tmp] 已同步 ${names.length} 个文件 → public/brand/local/，并更新 logo / t-pdf-preview（若源存在）。`
  );
}

main();
