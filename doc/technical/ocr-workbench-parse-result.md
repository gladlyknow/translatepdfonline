# OCR Workbench 与百度 parse_result 契约

实现入口：[`frontend/src/shared/lib/ocr-translate.ts`](../../frontend/src/shared/lib/ocr-translate.ts)（提交）、[`frontend/src/shared/ocr-workbench/`](../../frontend/src/shared/ocr-workbench/)（展示）。

## 提交参数（Body）

| 参数 | 产品默认 | 说明 |
|------|----------|------|
| `file_url` / `file_name` | 必传 | R2 预签名 URL + 文件名 |
| `merge_tables` | `true` | 跨页表格 `merge_table` |
| `relevel_titles` | `true`（`BAIDU_OCR_RELEVEL_TITLES`） | `paragraph_title` → `layouts[].sub_type` |
| `return_span_boxes` | `true`（`BAIDU_OCR_RETURN_SPAN_BOXES`） | `layouts[].span_boxes` 含 `location` |
| `analysis_chart` | `false`（`BAIDU_OCR_ANALYSIS_CHART`） | 图表描述 |
| `recognize_seal` | `false`（`BAIDU_OCR_RECOGNIZE_SEAL`） | 印章 |

仅**新提交**的 OCR 任务带齐上述字段；历史 R2 JSON 需重跑 OCR。

## 响应字段与 Workbench 消费

| 字段 | Workbench |
|------|-----------|
| `pages[].layouts[].position` [x,y,w,h] | 画布绝对定位（无效 position 跳过绘制） |
| `polygon` | 可选蓝色 SVG 叠加（工具栏开关） |
| `span_boxes[].location` | 可选绿色虚线框叠加 |
| `sub_type` | `paragraph_title` / `doc_title` 角标 |
| `vertical_text` | `writing-mode: vertical-rl` |
| 极薄无文本 layout | 装饰线段渲染 |
| `pages[].text` | 画布上方可展开「整页纯文本」 |
| 侧栏 JSON | 归一化后的当前页；工具栏可下载**原始** HTTP JSON |

## 画布能力边界

画布为**版面还原预览**，不等价于上游全量矢量输出：非矩形装饰主要依赖 `polygon` 叠加与薄框线段，而非 `layout.text` 自动画线。
