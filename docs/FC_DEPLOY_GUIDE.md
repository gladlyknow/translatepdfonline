# 阿里云函数计算（FC）创建与部署详细指南

本文档从零开始说明如何创建并部署 BabelDOC FC 函数：从镜像构建、推送到阿里云 ACR，到在函数计算控制台创建函数、配置 HTTP 触发器与环境变量，最后验证并供 ECS 调用。

---

## 一、前置准备

### 1.1 阿里云资源

- **阿里云账号**：已开通 **函数计算（FC）**、**容器镜像服务 ACR**。
- **地域**：选定一个地域（如 **华东1（杭州）** `cn-hangzhou`），FC 与 ACR 建议同地域，便于拉取镜像且延迟更低。
- **ACR 命名空间**：用于存放 BabelDOC FC 镜像。若没有，可在 ACR 控制台创建个人/企业版实例及命名空间。

### 1.2 本地/构建环境

- **Docker**：已安装 Docker，能执行 `docker build`、`docker push`。
- **GPU 版镜像**：若选择 GPU 函数，需在支持 **NVIDIA GPU + CUDA** 的环境构建 GPU 镜像，或在阿里云云效等支持 GPU 的构建环境中构建。
- **项目代码**：已克隆本仓库，且目录中包含 `babeldoc_fc/`、`tmp/BabelDOC/`、`docker/`（含 `Dockerfile.babeldoc-fc` 与 `Dockerfile.babeldoc-fc.gpu`）。

### 1.3 需提前准备的配置信息

在创建函数前准备好以下内容，用于环境变量（见第四节）：

| 用途 | 变量/信息 | 说明 |
|------|-----------|------|
| 翻译 API | DeepSeek API Key | 在 DeepSeek 控制台获取 |
| R2 存储 | R2 桶名、Endpoint、Access Key ID、Secret Access Key | 与 ECS 使用同一 R2 桶 |
| 鉴权 | BABELDOC_FC_SECRET | 自定义一组长字符串，FC 与 ECS 保持一致 |

---

## 二、选择 CPU 版或 GPU 版

| 类型 | 适用场景 | 函数类型 | Dockerfile | 说明 |
|------|----------|----------|------------|------|
| **CPU 版** | 成本优先、流量不大 | Web 函数（或自定义容器） | `docker/Dockerfile.babeldoc-fc` | 无需 GPU，冷启动后纯 CPU 推理 |
| **GPU 版** | 需要加速 OCR/排版推理 | **GPU 函数** | `docker/Dockerfile.babeldoc-fc.gpu` | 使用 CUDA 11.8 + onnxruntime-gpu，DocLayout 走 GPU |

后续步骤中会分别标注「仅 CPU」或「仅 GPU」的差异。

---

## 三、构建并推送镜像

### 3.1 在项目根目录执行构建

**CPU 版：**

```bash
# 进入项目根目录（包含 babeldoc_fc、tmp/BabelDOC、docker 的目录）
cd /path/to/translatepdfonline

docker build -f docker/Dockerfile.babeldoc-fc -t babeldoc-fc:latest .
```

**GPU 版：**

```bash
cd /path/to/translatepdfonline

docker build -f docker/Dockerfile.babeldoc-fc.gpu -t babeldoc-fc:gpu .
```

构建可能需数分钟（会安装 BabelDOC 及依赖）。若 GPU 版在无 GPU 的机器上构建，可能仅构建层、不运行 GPU 相关逻辑，最终运行需在 FC GPU 实例上。

### 3.2 登录阿里云 ACR

在 [容器镜像服务控制台](https://cr.console.aliyun.com) 找到你的 **实例**（个人版或企业版），在「访问凭证」中设置或查看登录密码，然后执行：

```bash
# 将 <region> 换为实际地域，如 cn-hangzhou；<registry> 换为实例公网/内网地址
docker login --username=<你的阿里云账号> registry.<region>.aliyuncs.com
```

按提示输入密码。

### 3.3 打标签并推送

将本地镜像打上 ACR 地址的标签并推送。**请将下面 `registry.cn-hangzhou.aliyuncs.com/your-ns/babeldoc-fc` 替换为你自己的 ACR 地址（地域 + 命名空间 + 仓库名）。**

**CPU 版：**

```bash
docker tag babeldoc-fc:latest registry.cn-hangzhou.aliyuncs.com/your-ns/babeldoc-fc:latest
docker push registry.cn-hangzhou.aliyuncs.com/your-ns/babeldoc-fc:latest
```

**GPU 版：**

```bash
docker tag babeldoc-fc:gpu registry.cn-hangzhou.aliyuncs.com/your-ns/babeldoc-fc:gpu
docker push registry.cn-hangzhou.aliyuncs.com/your-ns/babeldoc-fc:gpu
```

推送完成后，在 ACR 控制台「镜像仓库」中应能看到对应 tag。

---

## 四、在函数计算控制台创建函数

### 4.1 进入创建页

1. 登录 [阿里云函数计算控制台](https://fcnext.console.aliyun.com)。
2. 选择**地域**（与 ACR 一致，如 **华东1（杭州）**）。
3. 左侧菜单选择 **函数** → **创建函数**（或 **函数及镜像** → **创建**，视控制台版本而定）。

### 4.2 选择函数类型与运行时

- **CPU 版**：在「选择函数类型」中选 **Web 函数**（或「自定义容器」/「请求处理程序」中选「自定义容器」的等价入口）。  
  - 若界面为「事件函数 / Web 函数 / 任务函数 / GPU 函数」四选一，则选 **Web 函数**。
- **GPU 版**：选 **GPU 函数**。

在下一步或同一页中：

- **运行时 / 运行环境**：选择 **自定义容器**（或「自定义镜像」）。
- **镜像地址**：填上一步推送的 ACR 镜像地址，例如：
  - CPU：`registry.cn-hangzhou.aliyuncs.com/your-ns/babeldoc-fc:latest`
  - GPU：`registry.cn-hangzhou.aliyuncs.com/your-ns/babeldoc-fc:gpu`
- 若需**私有镜像**：在 ACR 中设为私有后，在 FC 侧配置 **镜像拉取账号**（ACR 命名空间 + 账号 + 密码），或使用 FC 与 ACR 的关联角色自动拉取（按控制台提示操作）。

### 4.3 基本信息

- **函数名称**：如 `babeldoc`（将出现在 URL 路径中，可自定）。
- **所属服务**：选择已有服务或新建一个（如 `default` 或 `translate`），服务用于隔离环境与权限。

### 4.4 规格与资源（重要）

| 配置项 | 建议值 | 说明 |
|--------|--------|------|
| **内存** | ≥ 2048 MB | BabelDOC 与 ONNX 模型较吃内存，建议不低于 2GB。 |
| **超时时间** | 600 秒（10 分钟） | 单次翻译可能较久，避免中途被 FC 杀死。 |
| **实例并发** | 1 | 单实例一次处理一个请求，避免内存不足；若需更高并发可调大并观察。 |
| **GPU**（仅 GPU 函数） | 按需选择 | 在控制台可选 GPU 卡型与显存（如 T4、A10 等），按业务与成本选择。 |

### 4.5 环境变量

在函数配置的 **环境变量** 中新增以下项（键值对，具体值替换为你的实际配置）：

| 键 | 必填 | 值说明 |
|----|------|--------|
| `DEEPSEEK_API_KEY` | 是 | DeepSeek API Key，用于翻译接口。 |
| `DEEPSEEK_BASE_URL` | 否 | 默认 `https://api.deepseek.com`，若用代理或自建可改。 |
| `DEEPSEEK_MODEL` | 否 | 默认 `deepseek-chat`。 |
| `R2_BUCKET_NAME` | 是 | R2 桶名（与 ECS 一致）。 |
| `R2_ENDPOINT_URL` | 是 | R2 S3 兼容 endpoint，如 `https://<account_id>.r2.cloudflarestorage.com`。 |
| `R2_ACCESS_KEY_ID` | 是 | R2 Access Key ID。 |
| `R2_SECRET_ACCESS_KEY` | 是 | R2 Secret Access Key。 |
| `BABELDOC_FC_SECRET` | 建议 | 与 ECS 配置相同，用于校验请求头 `X-Fc-Secret`。 |
| `BABELDOC_PATH` | 否 | 镜像内 BabelDOC 根目录，默认 `/code/tmp/BabelDOC` 一般无需设置。 |

填写完成后保存。

### 4.6 创建并等待就绪

点击 **创建**。创建成功后，函数会出现在函数列表中；若使用自定义容器，首次调用可能需拉取镜像，会有一定冷启动时间。

---

## 五、创建 HTTP 触发器并获取调用 URL

### 5.1 添加触发器

1. 进入刚创建的函数详情页。
2. 打开 **触发器** 或 **触发方式** 页签，点击 **创建触发器**。
3. 选择 **HTTP 触发器**（或「HTTP 请求」）。
4. 配置建议：
   - **请求方法**：勾选 **POST**（至少包含 POST，GET 可用于健康检查）。
   - **认证方式**：可选「匿名」或按需配置「JWT」等（本方案主要靠请求头 `X-Fc-Secret` 鉴权）。
   - **路径**：若支持配置路径，可设为 `/translate` 或 `/*`（由网关转发到容器内 `/translate`，视 FC 版本而定）。

保存后，触发器会生成一个 **公网访问地址**。

### 5.2 得到完整调用 URL

FC 的 HTTP 触发器地址通常带路径前缀，例如：

```text
https://<account_id>.<region>.fc.aliyuncs.com/2016-08-15/proxy/<服务名>/<函数名>/translate
```

或：

```text
https://<account_id>.<region>.fcapp.aliyun.com/2016-08-15/proxy/<服务名>/<函数名>/translate
```

- **用于翻译的 URL**：必须是 **POST** 请求能到达容器内 `POST /translate` 的地址，且路径末尾为 **`/translate`**（若控制台生成的路径没有 `/translate`，需在 ECS 配置的 `BABELDOC_FC_URL` 中手动加上）。
- 将该 URL 记下来，在 ECS 环境变量中配置为 **BABELDOC_FC_URL**（见 [DEPLOYMENT.md](../DEPLOYMENT.md) 后端环境变量一节）。

---

## 六、验证部署

### 6.1 健康检查（GET）

使用触发器提供的 **基础 URL**（不一定是 `/translate`，可能是根路径或 `/health` 由网关转发到容器的 `/health`）：

```bash
# 将 <BASE_URL> 换为触发器地址；若网关把根路径转发到容器，则 /health 可访问
curl -s -o /dev/null -w "%{http_code}" "https://<BASE_URL>/health"
```

若返回 **200**，说明容器内 FastAPI 已启动且 `/health` 正常。

### 6.2 翻译接口（POST）说明

`POST /translate` 需要 JSON 请求体（由 ECS 的 babeldoc_client 调用，此处仅作说明）：

- `source_pdf_url`：R2 源 PDF 的 presigned GET URL。
- `source_lang` / `target_lang`：语言代码。
- `page_range`：可选，如 `"1-10"`。
- `output_object_key`：结果 PDF 在 R2 中的 key。
- `task_id`：可选。

请求头需带 **X-Fc-Secret**（与 FC 环境变量 `BABELDOC_FC_SECRET` 一致），否则若 FC 配置了该密钥会返回 403。

实际联调时，在 ECS 上配置好 `BABELDOC_FC_URL`、`BABELDOC_FC_SECRET`、`BABELDOC_USE_FC=true` 后，通过前端发起一次翻译任务，在 Worker 日志中确认已调用 FC 且任务状态变为 completed，即表示从创建到部署全流程打通。

---

## 七、部署后：ECS 侧配置

在 **后端（ECS）** 上配置以下环境变量，使 Celery Worker 通过 FC 执行翻译：

| 变量名 | 值 |
|--------|-----|
| `BABELDOC_USE_FC` | `true` |
| `BABELDOC_FC_URL` | 第五节得到的完整 `/translate` URL |
| `BABELDOC_FC_SECRET` | 与 FC 内 `BABELDOC_FC_SECRET` 相同 |

并确保 R2、数据库、Redis 等已按 [DEPLOYMENT.md](../DEPLOYMENT.md) 配置。重启 Worker 后即可使用 FC 进行翻译。

---

## 八、简要检查清单

- [ ] ACR 中已推送镜像（CPU 或 GPU 对应 tag）。
- [ ] FC 函数已创建，运行时为 **自定义容器**，镜像地址正确。
- [ ] 内存 ≥ 2048 MB，超时 ≥ 600 秒；GPU 函数已选 GPU 规格。
- [ ] 环境变量已填：DEEPSEEK_*、R2_*、BABELDOC_FC_SECRET。
- [ ] 已创建 **HTTP 触发器**，并拿到完整 **BABELDOC_FC_URL**（以 `/translate` 结尾）。
- [ ] `GET .../health` 返回 200。
- [ ] ECS 已配置 `BABELDOC_USE_FC`、`BABELDOC_FC_URL`、`BABELDOC_FC_SECRET`，且能成功跑通一次翻译任务。

---

## 九、常见问题

| 现象 | 可能原因 | 处理 |
|------|----------|------|
| 创建/调用时报镜像拉取失败 | ACR 私有镜像未授权、网络不通 | 在 FC 配置镜像拉取凭证；FC 与 ACR 同地域、同 VPC 更稳。 |
| 调用超时 | 内存或超时设置过小、冷启动慢 | 内存调至 ≥2GB，超时 ≥600s；考虑预留实例减少冷启动。 |
| 返回 403 | 未带或错误的 `X-Fc-Secret` | 确认 ECS 与 FC 的 `BABELDOC_FC_SECRET` 一致，且 babeldoc_client 请求头带 `X-Fc-Secret`。 |
| FC 内报 R2/DeepSeek 错误 | 环境变量未配或错误 | 在函数配置中逐项核对 R2_*、DEEPSEEK_*。 |
| GPU 函数报 CUDA 相关错 | 镜像与 FC GPU 环境不兼容 | 使用项目提供的 `Dockerfile.babeldoc-fc.gpu`（CUDA 11.8），并确认 FC 实例已分配 GPU。 |

更多故障排查可参考 [DEPLOYMENT.md](../DEPLOYMENT.md) 第八节。
