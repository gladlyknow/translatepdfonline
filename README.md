## translatepdfonline

Online PDF translation platform (zh/en/es) with:

- Next.js frontend deployed via Cloudflare Pages, GitHub repo: `https://github.com/gladlyknow/translatepdfonline`
- FastAPI backend running on a configurable server (initially Aliyun Hong Kong)
- PostgreSQL, Redis, Celery-based async workers, and BabelDOC/MinerU integration

### Local backend setup (Python)

```bash
cd backend
python -m venv .venv  # you already created a venv at project root; this is just a reference
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

For detailed system and API design, see `在线翻译网站-技术需求细化-中英西.md`.  
Technical docs index: see [doc/README.md](doc/README.md).  
**翻译一直显示 "Translating" / 如何运行与检查 Worker**：见 [doc/worker-health-check.md](doc/worker-health-check.md) 的「如何运行 Worker」「如何确认 Worker 是否在跑」两节。  
Preview rules, polling/SSE, deduplication, list/漏句: [doc/preview-polling-translation.md](doc/preview-polling-translation.md).  
Fingerprint binding, download restriction, rate limiting, Google login: [doc/guest-fingerprint-download-ratelimit.md](doc/guest-fingerprint-download-ratelimit.md).  
Preview/R2/UX updates (translation PDF on R2, source slice, Range, frontend redesign, collapse): [doc/preview-r2-and-ux-updates.md](doc/preview-r2-and-ux-updates.md).

