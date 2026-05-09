/**
 * 打印/PDF 前在静态 HTML 上收缩根节点字号，避免 Chromium 对 scrollport 裁切导致与画布不一致。
 * `rootCssSelector` 使用 `.pr-layout`（自建 HTML）或 `[data-layout-id]`（Workbench 快照）。
 */
export function buildLayoutFitInlineScript(rootCssSelector: string): string {
  const rootSelJson = JSON.stringify(rootCssSelector);
  return `<script>
(() => {
  const ROOT_SEL = ${rootSelJson};
  const MIN_FONT = 7;
  const MAX_STEPS = 30;
  function isOverflow(el) {
    return el.scrollHeight > el.clientHeight + 0.8 || el.scrollWidth > el.clientWidth + 0.8;
  }
  function fitTextLayout(el) {
    const kind = (el.getAttribute('data-layout-type') || '').toLowerCase();
    if (kind === 'image' || kind === 'table') return;
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
  function runFit() {
    const layouts = Array.from(document.querySelectorAll(ROOT_SEL));
    for (const one of layouts) {
      fitTextLayout(one);
    }
    window.__prLayoutFitDone = true;
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
