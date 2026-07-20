/**
 * 为本地图片生成响应式 srcset。
 * 命名约定：`foo.webp` → `foo-672.webp 672w, foo.webp 1000w, foo-1344.webp 1344w`。
 * 外部 URL 或不符合命名约定的路径返回 undefined。
 */
export function responsiveSrcset(src: string): string | undefined {
  if (!src || src.startsWith('http')) return undefined;
  const m = src.match(/^(.*?)(\.\w+)$/);
  if (!m) return undefined;
  return `${m[1]}-672${m[2]} 672w, ${src} 1000w, ${m[1]}-1344${m[2]} 1344w`;
}

/**
 * 返回图片的 -672 宽度变体 URL（适用于显示宽度 ≤ 672px 的区域）。
 * 外部 URL 原样返回。
 */
export function smallImageVariant(src: string): string {
  if (!src || src.startsWith('http')) return src;
  const m = src.match(/^(.*?)(\.\w+)$/);
  if (!m) return src;
  return `${m[1]}-672${m[2]}`;
}
