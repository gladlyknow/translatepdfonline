# FC 纯 CPU 部署清单

用于从零部署或从 GPU 迁到纯 CPU 时的快速核对。详细步骤见 [FC_DEPLOY_GUIDE.md](FC_DEPLOY_GUIDE.md)。

---

## 1. GitHub Secrets（构建镜像用）

在仓库 **Settings → Secrets and variables → Actions** 中配置（与 GPU 构建共用同一套即可）：

| Secret | 说明 |
|--------|------|
| `REGISTRY` | 完整镜像前缀，如 `registry.cn-hangzhou.aliyuncs.com/<命名空间>/babeldoc-fc`（不含 `:tag`） |
| `ALIBABA_CLOUD_USERNAME` | ACR 登录用户名（阿里云账号或 RAM 子账号，见 ACR 控制台「访问凭证」） |
| `ALIBABA_CLOUD_PASSWORD` | ACR 登录密码 |

---

## 2. 镜像与 ACR

- **ACR 地址**：与 `REGISTRY` 一致，例如 `registry.cn-hangzhou.aliyuncs.com/<命名空间>/babeldoc-fc`
- **镜像 tag**：使用 `latest`（或回滚时用 `sha-<commit>`）
- 通过 **GitHub Actions**（`.github/workflows/build-babeldoc-fc.yml`）推送到 ACR，或本地按 FC_DEPLOY_GUIDE 第三节构建并推送

---

## 3. FC 创建要点（纯 CPU）

| 项 | 要求 |
|----|------|
| 函数类型 | **Web 函数**（自定义容器），**不选 GPU 函数** |
| 镜像 | ACR 的 CPU 镜像，如 `registry.cn-hangzhou.aliyuncs.com/<命名空间>/babeldoc-fc:latest` |
| 内存 | ≥ 2048 MB（建议 2048–4096） |
| 超时 | 600 秒（10 分钟） |
| 实例并发 | 1 |
| GPU | **不勾选、不配置** |
| 环境变量 | `DEEPSEEK_API_KEY`、`DEEPSEEK_BASE_URL`（可选）、`DEEPSEEK_MODEL`（可选）、`R2_BUCKET_NAME`、`R2_ENDPOINT_URL`、`R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY`、`BABELDOC_FC_SECRET` |
| 触发器 | 创建 **HTTP 触发器**，得到公网 URL；确保 POST 能到达容器内 `/translate` |

---

## 4. ECS 三变量

在 ECS 后端环境变量中设置（详见 [DEPLOYMENT.md](../DEPLOYMENT.md)）：

| 变量 | 值 |
|------|-----|
| `BABELDOC_USE_FC` | `true` |
| `BABELDOC_FC_URL` | FC HTTP 触发器完整 URL，以 `/translate` 结尾且 POST 可达 |
| `BABELDOC_FC_SECRET` | 与 FC 内 `BABELDOC_FC_SECRET` 相同 |

配置后 **重启 Celery Worker**。

---

## 5. 验证步骤

1. **健康检查**：`GET <FC 触发器基础 URL>/health` 返回 **200**。
2. **端到端**：前端发起一次翻译任务，在 ECS Worker 日志中确认已调用 FC，任务状态为 **completed**。

---

## 简要检查清单（勾选）

- [ ] GitHub Secrets 已配置：`REGISTRY`、`ALIBABA_CLOUD_USERNAME`、`ALIBABA_CLOUD_PASSWORD`
- [ ] GitHub Actions 成功构建并推送 `babeldoc-fc:latest` 到 ACR
- [ ] FC 函数类型为 **Web 函数（自定义容器）**，未选 GPU
- [ ] FC 镜像为 ACR CPU 镜像（如 `.../babeldoc-fc:latest`）
- [ ] FC 内存 ≥ 2048 MB，超时 ≥ 600 秒
- [ ] FC 环境变量已填：DEEPSEEK_*、R2_*、BABELDOC_FC_SECRET
- [ ] HTTP 触发器已创建，`BABELDOC_FC_URL` 以 `/translate` 结尾且 POST 可达
- [ ] ECS 已配置 `BABELDOC_USE_FC`、`BABELDOC_FC_URL`、`BABELDOC_FC_SECRET`，并重启 Worker
- [ ] `GET .../health` 返回 200，且一次端到端翻译任务成功完成
