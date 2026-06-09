---
name: 译文杂质/上下线/下载404（仅用BabelDOC+去水印）
overview: 仅使用 tmp/BabelDOC（不再使用 BabelDOC-main）；去除水印；解决译文杂质、预览丢上下线、下载 404。
todos: []
isProject: false
---

# 译文杂质、上下线丢失与下载 404 修复计划（更新版）

## 用户明确要求

1. **不再使用 BabelDOC-main**：只使用新下载的 BabelDOC 源码路径 `D:\imppro\translatepdfonline\tmp\BabelDOC`（即项目内 `tmp/BabelDOC`）。
2. **水印去除**：项目中译文 PDF 不得带水印，需确保调用 BabelDOC 时使用无水印模式。

---

## 问题根因简述

| 问题 | 根因 |
|------|------|
| 杂质 + 丢了上下线 | 适配器当前指向 `tmp/BabelDOC-main`；若改为 `tmp/BabelDOC`，则 **tmp/BabelDOC** 的 pdf_creater 仅在 debug 时渲染曲线，默认不渲染，导致译文无上下线；杂质可能来自边带图形未过滤。 |
| 预览丢上下线 | 预览即展示磁盘上的译文 PDF；生成时曲线未渲染则预览自然缺上下线。 |
| 下载 404 | 后端与 Worker 的 output 路径或用户校验等导致未找到文件或 404。 |

---

## 1. 只使用 tmp/BabelDOC，不再使用 BabelDOC-main

- **[backend/app/babeldoc_adapter.py](backend/app/babeldoc_adapter.py)**  
  - 将 `BABELDOC_PATH` 改为 **仅** `PROJECT_ROOT / "tmp" / "BabelDOC"`（删除对 `BabelDOC-main` 的引用与回退）。  
  - 若需可配置，可用环境变量如 `BABELDOC_PATH`，默认值为 `tmp/BabelDOC`；**不再**使用 `BabelDOC-main`。  
  - Import 失败时的错误提示改为：如 `"BabelDOC not installed. Run: pip install -e tmp/BabelDOC"`。

---

## 2. 水印去除（保持并明确）

- 当前 [babeldoc_adapter.py](backend/app/babeldoc_adapter.py) 已传入 `watermark_output_mode=WatermarkOutputMode.NoWatermark`（约第 129 行）。  
- **实施时**：在构建 `TranslationConfig` 时**必须保持** `watermark_output_mode=WatermarkOutputMode.NoWatermark`，不改为 `Watermarked` 或 `Both`，确保译文 PDF 无水印。

---

## 3. 译文 PDF：既有上下线又减杂质（修改 tmp/BabelDOC）

修改 **tmp/BabelDOC** 下的 [babeldoc/format/pdf/document_il/backend/pdf_creater.py](tmp/BabelDOC/babeldoc/format/pdf/document_il/backend/pdf_creater.py)（**不**改 BabelDOC-main）：

- **默认渲染曲线**：不要仅在 `curve.debug_info or translation_config.debug` 时渲染；改为**始终**将 `page.pdf_curve` 与 `formula_curves` 纳入候选，再按边带规则过滤，以保留标题上下线。
- **边带杂质过滤**：只过滤**完全落在页面顶端/底端极窄带**内的曲线（如 `margin_ratio` 约 0.05～0.06），避免误伤标题区上下线；参考 BabelDOC-main 中曾有过的 cropbox + bbox 判断逻辑，在 tmp/BabelDOC 的 pdf_creater 中增加该过滤。

---

## 4. 下载 404 修复（后端）

在 [backend/app/routes/tasks.py](backend/app/routes/tasks.py) 的 `_get_task_primary_file_impl` 中：

- 当 `stored_path` 存在且文件存在且 `task.status == "completed"` 时，优先直接使用该路径返回，避免因 `allowed_base` 等校验导致 404。  
- 在最终 404 前，若存在 `stored_path` 再试一次 `FileResponse(stored_path)`；并打日志（task_id、stored_path、output_dir、user_id vs task.user_id）便于区分“文件未找到”与“无权限”。

---

## 5. 实施顺序建议

1. **适配器**：BABELDOC_PATH 仅指向 `tmp/BabelDOC`，错误提示更新；确认 `watermark_output_mode=NoWatermark` 保持不变。  
2. **tmp/BabelDOC/pdf_creater**：默认渲染曲线 + 顶/底约 5%～6% 窄带过滤。  
3. **后端 file 接口**：放宽 stored_path 使用、404 前再试、补日志。  
4. **验证**：新跑翻译 → 预览有上下线、无杂质、无水印 → 下载不再 404。

---

## 涉及文件

- [backend/app/babeldoc_adapter.py](backend/app/babeldoc_adapter.py)：BabelDOC 路径仅用 `tmp/BabelDOC`；保持 `WatermarkOutputMode.NoWatermark`。  
- **tmp/BabelDOC/babeldoc/format/pdf/document_il/backend/pdf_creater.py**：默认渲染曲线 + 边带过滤。  
- [backend/app/routes/tasks.py](backend/app/routes/tasks.py)：`_get_task_primary_file_impl` 放宽路径、404 前再试、日志。
