# BabelDOC FC（阿里云函数计算）

将 BabelDOC 翻译逻辑以 HTTP 服务形式部署到阿里云函数计算（FC），与 ECS 上的 Celery Worker 解耦。

## 接口

- `POST /translate`：请求体 JSON
  - `source_pdf_url`: 源 PDF 的 presigned GET URL（R2）
  - `source_lang`, `target_lang`: 语言代码（如 zh, en, es）
  - `page_range`: 可选，如 "1-10"
  - `output_object_key`: 结果 PDF 写入 R2 的 key
  - `task_id`: 可选，日志用
  - `callback_url`: 成功时 `status=completed`；若译后语言层门闸命中「建议 OCR」场景，JSON 会多 **`suggest_try_ocr: true`**（仍上传结果 PDF，Next 侧存 `post_complete_hint` 并展示柔和提示，不当作 `failed`）。
- 返回 `{"output_object_key": "..."}`

## 环境变量

- `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL`, `DEEPSEEK_MODEL`：翻译 API
- `R2_BUCKET_NAME`, `R2_ENDPOINT_URL`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`：结果上传 R2
- `BABELDOC_FC_SECRET`：可选，与 ECS 的 `BABELDOC_FC_SECRET` 一致时，请求头需带 `X-Babeldoc-Secret`（勿用 `X-Fc-*`，阿里云 FC 会过滤）
- `BABELDOC_PATH`：可选，BabelDOC 根目录（否则自动解析为 `../tmp/BabelDOC` 或 `./BabelDOC`）
- `BABELDOC_SKIP_SCANNED_DETECTION`：可选，设为 `1`/`true` 时关闭 BabelDOC 内置扫描检测（与旧版一致，扫描件仍可能译完）；**默认不设置**则开启检测，命中扫描 PDF 时失败回调 `error_code=scan_detected_use_ocr`，前端引导 OCR。
- **译后语言层门闸**（BabelDOC 已成功写出 PDF 后执行；可抽取文本过少或（在低字符量前提下）LLM fallback 占比过高时 **建议 OCR**）：命中时 **仍返回 HTTP 200**、结果上传 R2，成功回调带 **`suggest_try_ocr: true`**；不再对该类情况回调 `failed`。关闭门闸仍用 `BABELDOC_INSUFFICIENT_TEXT_CHECK=0`。其它硬错误（无输出 PDF、下载失败等）仍为 `failed`。
  - `BABELDOC_INSUFFICIENT_TEXT_CHECK`：默认开启；设为 `0`/`false`/`off` 关闭整段门闸。
  - `BABELDOC_MIN_VALID_CHARS_TOTAL`：单页时 `total_valid_character_count` 下限（默认 `8`）。
  - `BABELDOC_MIN_VALID_CHARS_PER_PAGE`：`pages>=2` 时页均可抽取字符下限（默认 `85`）。
  - `BABELDOC_MIN_EXTRACTABLE_PARAS_PER_PAGE`：`paragraph_extractable_total` 与**所选页数**比（默认 `0.2`；`range_pages>=2` 时用）。
  - `BABELDOC_MIN_EXTRACTABLE_PARAS_PER_DOC_PAGE`：**只译 1 页**（`range_pages==1`）且整份 PDF 页数 ≥ `BABELDOC_MIN_DOC_PAGES_FOR_PARTIAL_SPARSE`（默认 `3`）时，若 `extractable < doc_pages × 本比例`（默认 `0.22`）则判失败（多页扫描只开 1 页仍过稀）。
  - `BABELDOC_MIN_DOC_PAGES_FOR_PARTIAL_SPARSE`：见上，默认 `3`。
  - `BABELDOC_MIN_LLM_TOTAL_FOR_FALLBACK_RATIO`：参与 fallback 占比判定的最小批次数（默认 `3`）。
  - `BABELDOC_MIN_FALLBACK_RATIO`：`fallback_batches / total_batches` ≥ 本值且 **`total_valid_character_count` &lt; `BABELDOC_FALLBACK_GATE_MAX_VALID_CHARS`**（默认 `480`）时判失败；字符量已高则视为正常 PDF 的 LLM/JSON 抖动，不拦。
  - `BABELDOC_FALLBACK_GATE_MAX_VALID_CHARS`：见上，默认 `480`；调低则更激进、调高更保守。

## 本地运行（从项目根目录）

需先安装 BabelDOC（与 backend 共用）：

```bash
pip install -e tmp/BabelDOC
pip install -r babeldoc_fc/requirements.txt
```

然后：

```bash
PYTHONPATH=. uvicorn babeldoc_fc.main:app --host 0.0.0.0 --port 9000
```

门闸单测（项目根目录）：

```bash
python -m unittest babeldoc_fc.test_text_layer_gate -v
```

成功回调 `suggest_try_ocr` 的 payload 单测（需已安装 `fastapi`/`httpx`，与 FC 镜像一致）：

```bash
python -m unittest babeldoc_fc.test_notify_callback -v
```

**手工验收**：Postgres 执行 `frontend/docs/migrations/translation_tasks_post_complete_hint.sql` 后，跑一次 FC 译后触发门闸的 PDF，确认 HTTP 200、R2 有结果、`POST /api/translate/callback` 收到 `completed` + `suggest_try_ocr`，任务 `post_complete_hint=suggest_try_ocr` 且已扣积分；翻译页 completed 下出现 OCR 提示条。OCR 页填写 `1-1` 发起任务，请求体含 `source_slice_object_key`，`ocr-queue` 使用切片 key。

或指定 BabelDOC 路径：

```bash
BABELDOC_PATH=tmp/BabelDOC PYTHONPATH=. uvicorn babeldoc_fc.main:app --host 0.0.0.0 --port 9000
```

## 部署到阿里云 FC

- **CPU 版**：使用 `docker/Dockerfile.babeldoc-fc` 构建镜像（项目根执行 `docker build -f docker/Dockerfile.babeldoc-fc -t babeldoc-fc:latest .`）。创建 FC 时选 **Web 函数**（或自定义容器）+ HTTP 触发器。
- **GPU 版**：使用 `docker/Dockerfile.babeldoc-fc.gpu` 构建镜像（项目根执行 `docker build -f docker/Dockerfile.babeldoc-fc.gpu -t babeldoc-fc:gpu .`）。创建 FC 时选 **GPU 函数**，镜像基于 CUDA 11.8，BabelDOC DocLayout 会使用 `CUDAExecutionProvider` 加速。
- 配置 HTTP 触发器、超时（建议 600s）、内存（建议 ≥2GB）；GPU 函数另需在控制台选择 GPU 规格。
- **FC 从创建到部署的逐步指南**（镜像构建、ACR 推送、控制台创建、HTTP 触发器、验证）：[docs/FC_DEPLOY_GUIDE.md](../docs/FC_DEPLOY_GUIDE.md)。
- **完整部署流程**（前端 → 后端 → FC、环境变量、故障排查）：见项目根目录 [DEPLOYMENT.md](../DEPLOYMENT.md)。
