# BabelDOC FC（阿里云函数计算）

将 BabelDOC 翻译逻辑以 HTTP 服务形式部署到阿里云函数计算（FC），与 ECS 上的 Celery Worker 解耦。

## 接口

- `POST /translate`：请求体 JSON
  - `source_pdf_url`: 源 PDF 的 presigned GET URL（R2）
  - `source_lang`, `target_lang`: 语言代码（如 zh, en, es）
  - `page_range`: 可选，如 "1-10"
  - `output_object_key`: 结果 PDF 写入 R2 的 key
  - `task_id`: 可选，日志用
- 返回 `{"output_object_key": "..."}`

## 环境变量

- `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL`, `DEEPSEEK_MODEL`：翻译 API
- `R2_BUCKET_NAME`, `R2_ENDPOINT_URL`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`：结果上传 R2
- `BABELDOC_FC_SECRET`：可选，与 ECS 的 `BABELDOC_FC_SECRET` 一致时，请求头需带 `X-Fc-Secret`
- `BABELDOC_PATH`：可选，BabelDOC 根目录（否则自动解析为 `../tmp/BabelDOC` 或 `./BabelDOC`）

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
