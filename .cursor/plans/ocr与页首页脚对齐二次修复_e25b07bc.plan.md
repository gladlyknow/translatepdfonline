---
name: OCR与页首页脚对齐二次修复
overview: 基于你的新反馈，按“保真优先且严格对齐 onlinepdftranslator 流程”修复 OCR/Translate 的控件位置、导航一致性、登录积分显示与 OCR 队列 export/download 阶段 exceededCpu 根因，先做 UI 对齐，再按参考项目重建导出链路并验收。
todos:
  - id: nav-home-upload-consistency
    content: 统一首页与业务页导航，确保首页独立显示 Upload 且顺序一致
    status: completed
  - id: sidebar-pages-bottom
    content: 将 OCR/Translate 的 Pages 控件组下沉到左栏最底并移除重复翻页入口
    status: completed
  - id: ocr-workbench-toolbar-visibility
    content: 修复 OCR 工具栏靠上固定与未选块可见性，保证文本/字体控件可操作
    status: completed
  - id: credits-session-sync
    content: 修复登录积分显示链路，统一会话与 credits 状态机
    status: completed
  - id: ocr-export-cpu-hardening
    content: 严格参照 onlinepdftranslator 的 OCR export/download 流程治理 export_outputs exceededCpu（不采用其它路径）
    status: completed
  - id: regression-verify-all
    content: 完成类型检查、UI 回归、队列阶段回归并输出验收结果
    status: completed
isProject: false
---

# OCR / Header / Workbench 二次修复计划（保真优先）

## 目标
- 将 `Pages` 控件组固定到 OCR/Translate 左侧工具栏最下方。
- 统一首页与业务页导航，确保首页也出现 `Upload` 且与业务 IA 一致。
- 修复 OCR 登录后积分不显示（已登录却出现 `Sign in to see your credit balance` / `...`）。
- 落实 OCR workbench 控件“靠上固定、可见、可操作”，并压缩语言/提交区体积。
- 在不牺牲导出保真的前提下，定位并缓解 `export_outputs` 的 `exceededCpu`。

## 根因结论（当前）
- OCR CPU 超时主因是 `export_outputs` 在队列 Worker 内执行高成本 PDF 合成（`pdf-lib + fontkit + 子集字体 + 文本测量`），与日志中 `stage=export_outputs` 前后出现 `exceededCpu` 一致。
- 首页未出现 `Upload` 的主因是首页导航数据里已存在 `url=/upload` 但标题不是 Upload，导致注入逻辑不会追加 Upload 项；因此首页 IA 与业务壳层导航不一致（你给的线上页也可见此差异：[translatepdfonline-dev](https://translatepdfonline-dev.gladlyknow.workers.dev/)）。
- `Pages` 未在最下方是区块顺序问题（OCR/Translate 左侧栏 JSX 顺序 + workbench 顶部翻页条与侧栏并存）。
- 登录积分显示异常是“侧栏只看 app context user/credits”，而不是统一会话来源，且 credits 拉取失败场景缺少明确状态。

## 实施步骤

### 1) 统一首页与业务页导航（含 Upload）
- 调整首页导航数据与渲染策略，保证明确独立的 `Upload` 项。
- 对齐顺序到业务壳层：`Translate PDF / PDF Translate / PDF OCR / Upload / Pricing / Docs / History`（按页面可见性控制）。
- 校验 `/`、`/upload`、`/translate`、`/ocrtranslator` 四页一致性。

### 2) OCR/Translate 左栏重排：Pages 固定最下方
- 将 `Pages` 控件组移到左栏末尾，并保持“始终可达”。
- 合并/压缩语言+提交区（缩略样式，减少纵向占用）。
- 删除与 `Pages` 重复的顶部翻页入口（避免双入口冲突），统一用同一状态源驱动页码联动。

### 3) OCR workbench 控件集可见性与固定性修复
- 保持 `parse-result-editor-toolbar` 置于左侧固定区，且靠上显示。
- 改善“未选块”状态：不再表现为“像没显示”，提供明显可操作提示与弱禁用策略。
- 确保 `Open Text edit / Open Font settings` 能稳定滚动并聚焦到对应 section。

### 4) 已登录积分显示修复
- 统一积分显示数据来源（会话态 + app context 同步），避免“已登录却显示未登录文案”。
- 增加 credits 加载状态机（loading / loaded / failed），消除长期 `...` 不可判读状态。
- 页面进入与任务完成后做一次可信刷新，并记录失败原因（仅脱敏日志）。

### 5) OCR `export_outputs` exceededCpu（严格对齐 `onlinepdftranslator`）
- 处理原则：仅采用 `D:/imppro/onlinepdftranslator` 已验证的 OCR 流程、export 与 download 设计；不引入其它替代方案。
- 对齐方式：
  - 对照参考项目中 OCR 阶段切分与 export 触发路径，重建 `translatepdfonline` 的同构流程（同队列内/同调度语义）。
  - 对照参考项目中导出与下载产物组织方式（对象写入顺序、状态推进、下载可用时机），统一 `export_outputs -> completed` 的收敛条件。
  - 保留当前生产约束（单队列、可恢复重试、前端 10s 轮询 + cron fallback）并确保与参考流程兼容。
- 观测与验证：
  - 增加与参考流程一致的关键日志点（导出开始、导出完成、产物可下载、阶段推进耗时）。
  - 对同体量文档回归验证 `export_outputs` 不再触发 `exceededCpu`，且下载链路与参考项目行为一致。

### 6) 验证与回归
- 静态：`pnpm tsc --noEmit` + 改动文件 lint。
- 页面回归：
  - 首页导航含 `Upload`，并与业务页一致。
  - OCR/Translate：`Pages` 在左栏最下方且可控页首/页尾、可翻页。
  - OCR：登录后积分可见且可跳转购买。
  - OCR workbench：文本/字体控件首屏可见且固定，不随 JSON 列表滚动。
- 队列回归：同体量文档下 `export_outputs` 不再出现 `exceededCpu`，并可见分段耗时日志用于追踪。