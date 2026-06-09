---
name: PDF导出与Workbench一致修复
overview: "当前 6 页变 12 页和背景异常的主因是快照打印样式把固定页高改成了 `min-height + overflow: visible`，同时按块追加 `min-height` 导致内容跨页外溢。修复方向是恢复“每个快照 section 严格一页”约束，并把“防截断”从扩容改成块内 fit（缩放到恰好装满框）。"
todos:
  - id: rollback-page-overflow-model
    content: 回滚 snapshot 页容器 min-height/overflow:visible 与按块 min-height 扩容逻辑
    status: completed
  - id: fit-in-box-text-math
    content: layout-fit 脚本实现文本/公式块 shrink+grow 临界 fit，固定框内最大体积
    status: completed
  - id: fit-in-box-table
    content: 为 table 类型补充安全字号 fit，避免截断且不改盒尺寸
    status: completed
  - id: verify-page-count-and-truncation
    content: 验证 Workbench 页数=PDF 页数，且文本/表格/公式无截断
    status: completed
isProject: false
---

# PDF 导出与 Workbench 一致修复计划

## 问题结论

- 现象变严重（`6页 -> 12页`、背景不一致）与最近改动直接相关：
  - [`parse-result-export-snapshot.ts`](D:/imppro/translatepdfonline/frontend/src/shared/ocr-workbench/parse-result-export-snapshot.ts) 中把 `.snapshot-page-wrap` 改成了 `min-height + overflow: visible`，导致页内容可外溢。
  - 同文件新增 `applySnapshotLayoutMinHeightsFromSource` 给每个块加 `min-height`，进一步推高内容高度，触发跨页。
- 截断与跨页本质是两类问题：
  - **跨页**：页容器失去固定高度裁剪边界。
  - **截断**：块内文字未被稳定 fit 到框内，PDF 渲染与 Workbench 度量有微差。

## 目标

- 导出 PDF 与 Workbench 页数一致（每个快照页对应 1 个 PDF 页）。
- 文本/表格/公式不截断。
- 每个布局框内内容尽量占满（最大体积）但不溢出。

## 实施步骤

1. 恢复“单快照页 = 单 PDF 页”约束（先止血）
- 文件：[`parse-result-export-snapshot.ts`](D:/imppro/translatepdfonline/frontend/src/shared/ocr-workbench/parse-result-export-snapshot.ts)
- 调整：
  - 删除 `applySnapshotLayoutMinHeightsFromSource` 调用与实现。
  - `@media print` 中 `.snapshot-page-wrap` 恢复为固定 `height: calc(var(--page-h) * var(--print-scale))` 与 `overflow: hidden`。
  - 移除本轮新增的全局 `pre,code` 强制换行样式（避免改变 Workbench 原样排版）。
- 结果：先保证页数、背景、分页行为回到可控一致状态。

2. 将“防截断”改为“框内 fit”，而不是增高块
- 文件：[`parse-result-export-layout-fit-script.ts`](D:/imppro/translatepdfonline/frontend/src/shared/ocr-workbench/parse-result-export-layout-fit-script.ts)
- 调整：
  - `fitTextLayout` 改成两阶段：
    - 若溢出：先缩小直到不溢出。
    - 不溢出后再小步放大，直到临界点回退 1 步（最大体积）。
  - 保持 `:scope > .parse-result-rich-host` 为优先目标，确保真正作用于内容容器。
  - 保留双 pass（`runFitOnce` + `requestAnimationFrame`）等待字体稳定。
- 结果：文本/公式在“固定框”内尽量放大且不截断。

3. 对表格类型补齐同样的“最大体积 fit”策略
- 文件：[`parse-result-export-layout-fit-script.ts`](D:/imppro/translatepdfonline/frontend/src/shared/ocr-workbench/parse-result-export-layout-fit-script.ts)
- 调整：
  - 将 `table` 从完全跳过改为安全 fit：只调整字号/行高，不改盒尺寸。
  - 保守阈值（步长更小、最小字号保护）避免表格结构跳变。
- 结果：表格不截断且尽量占满框。

4. 统一打印背景与分页视觉
- 文件：[`parse-result-export-snapshot.ts`](D:/imppro/translatepdfonline/frontend/src/shared/ocr-workbench/parse-result-export-snapshot.ts)
- 调整：
  - 打印态强制白底：`body{background:#fff}` 保持。
  - 保持每页 section 的 `break-after/page-break-after` 与最后一页例外逻辑不变，避免再次出现“半页残留 + 空白追加页”。

5. 验收与回归
- 代码检查：`pnpm exec tsc --noEmit`。
- 功能验证（同一任务）
  - Workbench 页数与 PDF 页数一致。
  - 重点查看长段落、表格、公式块底部与右侧边界无截断。
  - 背景一致（不计水印）。

## 风险与兜底

- 若某些文档字体加载慢导致个别页仍有临界截断，可在 fit 脚本末尾增加一次“仅对仍溢出块再 shrink 一轮”的最终兜底（不改分页模型）。