/**
 * 工具栏点击会抢走焦点；execCommand 需要可编辑区内有选区。
 * 在 LayoutText 内于 mouseup/keyup 时保存 Range，执行格式命令前恢复。
 */
let savedRange: Range | null = null;
let toolbarInteracting = false;
let guardReleaseTimer: ReturnType<typeof setTimeout> | null = null;

export function beginToolbarSelectionGuard(): void {
  toolbarInteracting = true;
  if (guardReleaseTimer != null) {
    clearTimeout(guardReleaseTimer);
  }
  // 兜底释放：某些浏览器交互路径不会触发预期 mouseup/blur
  guardReleaseTimer = setTimeout(() => {
    toolbarInteracting = false;
    guardReleaseTimer = null;
  }, 600);
}

export function endToolbarSelectionGuard(): void {
  toolbarInteracting = false;
  if (guardReleaseTimer != null) {
    clearTimeout(guardReleaseTimer);
    guardReleaseTimer = null;
  }
}

export function saveLayoutEditableSelection(opts?: { force?: boolean }): void {
  const root = document.querySelector('[data-layout-editable="true"]');
  if (!root) return;
  if (toolbarInteracting && !opts?.force) return;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const r = sel.getRangeAt(0);
  if (!root.contains(r.commonAncestorContainer)) return;
  if (r.collapsed) {
    // 折叠选区不覆盖已有有效选区，避免“第一次可用、第二次失效”
    return;
  }
  savedRange = r.cloneRange();
}

export function restoreLayoutEditableSelection(): boolean {
  const root = document.querySelector('[data-layout-editable="true"]');
  if (!root || !savedRange) return false;
  try {
    if (!root.contains(savedRange.commonAncestorContainer)) return false;
    const sel = window.getSelection();
    if (!sel) return false;
    sel.removeAllRanges();
    sel.addRange(savedRange);
    return true;
  } catch {
    return false;
  }
}
