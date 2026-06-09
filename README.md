## translatepdfonline

Online PDF translation platform (zh/en/es) with:

- Next.js frontend deployed via Cloudflare Pages, GitHub repo: `https://github.com/gladlyknow/translatepdfonline`
- **Current translation path (see docs):** Next.js API + PostgreSQL + Cloudflare R2 + **阿里云函数计算 `babeldoc_fc`**（FC 回调 Next 更新任务）。详见 [frontend/docs/PROJECT_SETUP_AND_FC.md](frontend/docs/PROJECT_SETUP_AND_FC.md)。
- **Optional / legacy:** FastAPI backend, Redis, Celery workers, and BabelDOC on a configurable server（根目录若保留 `backend/` 可参考；与 FC 主线并存时需以实际部署为准）。

### 文档入口（存档）

| 说明 | 链接 |
|------|------|
| **全项目文档地图、MDX 说明、根链接勘误** | [doc/ARCHIVE_INDEX.md](doc/ARCHIVE_INDEX.md) |
| 技术索引（设计长文 + 前端 docs） | [doc/README.md](doc/README.md) |
| 需求摘要 | [doc/REQUIREMENTS.md](doc/REQUIREMENTS.md) |
| 技术总览（含架构图） | [doc/TECHNICAL_OVERVIEW.md](doc/TECHNICAL_OVERVIEW.md) |
| 环境变量与 Cloudflare | [frontend/docs/environment-variables.md](frontend/docs/environment-variables.md) |
| Next ↔ FC 契约 | [frontend/docs/translate-fc-contract.md](frontend/docs/translate-fc-contract.md) |

### 根 README 原 `doc/*.md` 链接已迁移

以下主题请使用 **新路径**（旧文件名在 `doc/` 根下不存在）：

- **翻译一直显示 "Translating" / Worker**：见 [doc/technical/worker-health-check.md](doc/technical/worker-health-check.md)（若未跑 Celery，以 FC 流程文档为准）。
- **预览、轮询、漏句**：[doc/technical/preview-polling-translation.md](doc/technical/preview-polling-translation.md)
- **指纹、下载限制、限流**：[doc/technical/guest-fingerprint-download-ratelimit.md](doc/technical/guest-fingerprint-download-ratelimit.md)
- **译文 R2、分片预览、UX**：[doc/technical/preview-r2-and-ux-updates.md](doc/technical/preview-r2-and-ux-updates.md)

### Local backend setup (Python) — 可选

若使用仓库内 **FastAPI** 路线：
 
```bash
cd backend
python -m venv .venv
pip install -r requirements.txt
uvicorn app.main:app --reload
```



Configuration is provided via environment variables (see **project root** `.env` / `.env.local`; backend and Celery workers load from the same root):

- `DATABASE_URL`
- `REDIS_URL`
- `JWT_SECRET`
- `APP_SECRET`
- **`DEEPSEEK_API_KEY`** — Required for translation. Set a valid key in the project root `.env`. If translation fails with **401** or "api key ... is invalid", check that this key is correct and not expired.
- **`DEEPSEEK_MODEL`** — Model ID for DeepSeek API. Use an official model name such as `deepseek-chat` (recommended) or `deepseek-reasoner`. Do not use invalid IDs like `deepseek-v3`, or the API will return 400 "Model Not Exist".

> 仓库内若曾引用 `在线翻译网站-技术需求细化-中英西.md`，该文件未纳入本仓库；需求见 [doc/REQUIREMENTS.md](doc/REQUIREMENTS.md) 与 [doc/technical/online-pdf-translate-site-spec_4e7a7b0f.plan.md](doc/technical/online-pdf-translate-site-spec_4e7a7b0f.plan.md)。
