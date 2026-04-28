import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** 标签页用：优先同品牌小图，避免把超大 logo-copy.png 打进 SVG（数百 KB）。需与 logo-copy 完全一致时可改为 logo-copy.png 并重新运行。 */
const pngPath = path.join(__dirname, '..', 'public', 'brand', 'logo-512.png');
const outPath = path.join(__dirname, '..', 'public', 'brand', 'favicon-rounded.svg');

const buf = fs.readFileSync(pngPath);
const b64 = buf.toString('base64');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 64 64">
  <defs>
    <clipPath id="favicon-rounded-clip">
      <rect width="64" height="64" rx="14" ry="14"/>
    </clipPath>
  </defs>
  <g clip-path="url(#favicon-rounded-clip)">
    <image width="64" height="64" preserveAspectRatio="xMidYMid slice"
      href="data:image/png;base64,${b64}"
      xlink:href="data:image/png;base64,${b64}"/>
  </g>
</svg>`;

fs.writeFileSync(outPath, svg, 'utf8');
console.log('wrote', outPath, 'png bytes', buf.length);
