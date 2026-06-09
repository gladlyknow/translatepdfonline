# 需求文档（精炼存档）

> 摘录自项目规划长文，便于评审与迭代对齐。**完整原文与历史决策**见 [doc/technical/online-pdf-translate-site-spec_4e7a7b0f.plan.md](./technical/online-pdf-translate-site-spec_4e7a7b0f.plan.md)、[doc/technical/translatepdfonline-next-steps_9ab66596.plan.md](./technical/translatepdfonline-next-steps_9ab66596.plan.md) 及 [ARCHIVE_INDEX.md](./ARCHIVE_INDEX.md) 所列其它文档。

---

## 1. 产品目标

- 面向全球用户的 **在线 PDF 翻译** 服务（多语言 UI 与多语言对翻译能力扩展）。
- 用户可 **上传 PDF**、选择语言与 **页范围**、获得尽量 **保留版式** 的译文 PDF。
- 浏览器内 **原文/译文对照预览**（含历史任务再次打开与预览，见站点 FAQ 与翻译页 **History**）。
- 商业化：**免费额度 + 超额付费（积分/订阅，与 Creem 等支付集成）**；具体数值以环境与配置为准。

---

## 2. 用户与场景（摘要）

| 角色 | 核心能力（概念层） |
|------|-------------------|
| 访客 | 浏览营销站、文档、条款；能力边界以当前上线配置为准 |
| 注册用户 | 登录后上传、创建翻译任务、预览、下载、查看历史任务 |
| 付费用户 | 更高配额/并发等（以定价与后台配置为准） |

---

## 3. 功能范围（模块级）

1. **账号与认证**：OAuth（如 Google/GitHub）、邮箱等（实现细节见 [auth-and-registration.md](./technical/auth-and-registration.md)）。
2. **上传与存储**：直传对象存储（R2）、预签名、任务与元数据入库。
3. **预览**：源 PDF 与译文 PDF 在线预览；大文件性能与分片策略见 [preview-r2-and-ux-updates.md](./technical/preview-r2-and-ux-updates.md)。
4. **翻译执行**：由 **babeldoc_fc（阿里云 FC）** 执行流水线，Next 侧调度与回调（契约见 [translate-fc-contract.md](../frontend/docs/translate-fc-contract.md)）。
5. **计费**：页数/积分、回调字段、严格模式等以代码与 `frontend/docs` 为准。
6. **合规**：隐私政策、服务条款（`frontend/content/pages`）；数据保留期见 FAQ 与文档说明。

---

## 4. 非功能需求（摘要）

- **安全**：HTTPS、鉴权、对象访问控制；密钥仅存环境变量/Secret。
- **可用性**：FC 429/503 与重试、任务排队（见契约文档）。
- **可维护性**：环境变量与迁移脚本记录在 `frontend/docs/` 与 `doc/ARCHIVE_INDEX.md`。

---

## 5. 与根 README 中「Python 后端」的关系

根 [README.md](../README.md) 仍描述 **FastAPI + Celery + Redis** 路线，可与 **仅 Next + FC** 的部署并存为文档遗产。以 **[PROJECT_SETUP_AND_FC.md](../frontend/docs/PROJECT_SETUP_AND_FC.md)** 为当前主线实现依据；若实际仍运行 Celery，需结合 [worker-health-check.md](./technical/worker-health-check.md) 与运维文档。
