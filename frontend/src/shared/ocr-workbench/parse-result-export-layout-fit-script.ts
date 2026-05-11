/**
 * 打印/PDF 前收缩字号，避免 Chromium 对 scrollport / overflow:hidden 裁切与画布不一致。
 * `rootCssSelector` 使用 `.pr-layout`（自建 HTML）或 `[data-layout-id]`（Workbench 快照）。
 *
 * Workbench 的 `fitReadOnlyText` 作用在 **子级 `.parse-result-rich-host`**；快照会把该层的
 * `font-size` 等写成内联样式，若只改外层 `[data-layout-id]`，内联字号不继承，溢出仍被裁切。
 * 因此优先对 `:scope > .parse-result-rich-host` 做 fit，无则回退到布局根（与 `.pr-layout` 单根结构兼容）。
 */
export function buildLayoutFitInlineScript(rootCssSelector: string): string {
  const rootSelJson = JSON.stringify(rootCssSelector);
  return `<script>
(() => {
  const ROOT_SEL = ${rootSelJson};
  const MIN_FONT = 8;
  const MAX_STEPS = 40;
  /** 与快照 min-height slack 对齐，缓冲 Chromium PDF 与屏幕子像素/行高差 */
  const OVERFLOW_SLACK_PX = 6;
  function isOverflow(el) {
    return (
      el.scrollHeight > el.clientHeight + OVERFLOW_SLACK_PX ||
      el.scrollWidth > el.clientWidth + OVERFLOW_SLACK_PX
    );
  }
  function resolveFitTarget(layoutRoot) {
    const host = layoutRoot.querySelector(':scope > .parse-result-rich-host');
    return host instanceof HTMLElement ? host : layoutRoot;
  }
  function fitTextLayout(layoutRoot) {
    const kind = (layoutRoot.getAttribute('data-layout-type') || '').toLowerCase();
    if (kind === 'image' || kind === 'table') return;
    const el = resolveFitTarget(layoutRoot);
    if (!isOverflow(el)) return;
    const cs = window.getComputedStyle(el);
    let fontSize = Number.parseFloat(cs.fontSize || '') || 12;
    let lineHeight = Number.parseFloat(cs.lineHeight || '') || fontSize * 1.4;
    let steps = 0;
    while (steps < MAX_STEPS && isOverflow(el) && fontSize > MIN_FONT) {
      fontSize -= 0.5;
      lineHeight = Math.max(fontSize * 1.15, lineHeight - 0.35);
      el.style.fontSize = fontSize.toFixed(2) + 'px';
      el.style.lineHeight = lineHeight.toFixed(2) + 'px';
      steps += 1;
    }
  }
  function runFitOnce() {
    const layouts = Array.from(document.querySelectorAll(ROOT_SEL));
    for (const one of layouts) fitTextLayout(one);
    for (const one of layouts) fitTextLayout(one);
  }
  function runFit() {
    runFitOnce();
    requestAnimationFrame(() => {
      runFitOnce();
      window.__prLayoutFitDone = true;
    });
  }
  window.__prLayoutFitDone = false;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', runFit, { once: true });
  } else {
    runFit();
  }
})();
</script>`;
}
