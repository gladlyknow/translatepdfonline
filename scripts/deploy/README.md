# 后端部署脚本（47.253.190.94，/data/translatepdfonline）

虚拟环境使用**项目根** `.venv`（`/data/translatepdfonline/.venv`）。

若服务器上尚无 `scripts/deploy/`，请先从本机 push 或 rsync 同步代码后再执行下列命令。

## 一、在服务器上执行（按顺序）

### 1. 依赖安装（已创建 .venv 和 .env 后）

```bash
cd /data/translatepdfonline
source .venv/bin/activate
pip install -U pip
pip install -r backend/requirements.txt
pip install gunicorn
```

### 2. 数据库连接与权限测试（可选）

若迁移报错 `permission denied for schema public`，先确认连接的是否为目标库及当前用户权限：

```bash
cd /data/translatepdfonline/backend
../.venv/bin/python scripts/test_db_connection.py
```

脚本会打印：当前用户、数据库名、主机、以及 public 的 USAGE/CREATE 权限和一次建表测试。若 CREATE 为 False 或建表失败，需用高权限用户在库内执行 `GRANT USAGE, CREATE ON SCHEMA public TO <应用用户名>;` 等。

### 3. 数据库迁移

**首次建库**（库里还没有 `users`、`translation_tasks` 等表）时，须先建表再跑迁移：

```bash
cd /data/translatepdfonline/backend
# 1) 用当前模型创建所有表（users, wallets, documents, translation_tasks）
../.venv/bin/python scripts/create_tables.py
# 2) 再执行迁移（0002、0003… 会加列等，IF NOT EXISTS 兼容已存在列）
../.venv/bin/alembic upgrade head
```

**若表已存在**（例如之前跑过 create_tables 或从别处导入了 schema），直接：

```bash
../.venv/bin/alembic upgrade head
```

说明：baseline 迁移（20260304_0001）是空操作，不建表；0002 及以后假定 `users`、`translation_tasks` 等已存在，故新库必须先执行 `create_tables.py`。

### 4. 安装 systemd 服务并启动

```bash
cp /data/translatepdfonline/scripts/deploy/translatepdfonline-api.service /etc/systemd/system/
cp /data/translatepdfonline/scripts/deploy/translatepdfonline-celery.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable translatepdfonline-api translatepdfonline-celery
systemctl start translatepdfonline-api translatepdfonline-celery
systemctl status translatepdfonline-api translatepdfonline-celery
```

### 5. 校验

```bash
curl -s http://127.0.0.1:8000/health
# 应返回 {"status":"ok", ...}
```

**若 Celery 报 exit code 2 或不断重启**：在服务器上先看详细日志，再前台跑一次 Worker 看 Python 报错：

```bash
# 最近 80 行日志
journalctl -u translatepdfonline-celery -n 80 --no-pager
# 前台运行（同一套环境），便于看到完整 traceback
cd /data/translatepdfonline/backend
PROJECT_ROOT=/data/translatepdfonline ../.venv/bin/celery -A app.celery_app worker -l info
```

常见原因：`REDIS_URL` 未配置或不可达、`.env` 未被加载（确认 `PROJECT_ROOT` 与项目根一致）、或依赖/导入错误。

**Celery 报 Redis MISCONF（无法持久化 RDB）**：Redis 配置了落盘但写不进去（磁盘满或权限）。临时恢复可执行：`redis-cli config set stop-writes-on-bgsave-error no`。若 Redis 设置了密码（报 NOAUTH），从 `.env` 的 `REDIS_URL` 里取出密码后执行：`redis-cli -a '你的密码' config set stop-writes-on-bgsave-error no`。长期应检查磁盘空间与 Redis 数据目录权限。

**API 访问挂起（curl 127.0.0.1:8000/health 无响应）**：多为 worker 被占满或请求在 worker 内阻塞。处理：`systemctl restart translatepdfonline-api`，并用 `curl http://127.0.0.1:8000/health` 测。部署里已为 gunicorn 增加 `-w 2` 和 `--timeout 15`。若仍无响应，可先停服务后在前台启动看日志：`cd /data/translatepdfonline/backend && /data/translatepdfonline/.venv/bin/gunicorn -k uvicorn.workers.UvicornWorker app.main:app -b 0.0.0.0:8000 -w 1`，另开终端执行 `curl http://127.0.0.1:8000/health`，观察是否有报错或超时。

### 6. Nginx 配置（可选，与 4 二选一或先 4 后更新）

仓库内 [scripts/deploy/translatepdfonline.conf](translatepdfonline.conf) 已包含 HTTP/HTTPS 与反向代理。SSL 证书需放在服务器 `/data/config/translatepdfonline.pem`、`/data/config/translatepdfonline.key`。

**首次或单独更新 Nginx：**

```bash
cp /data/translatepdfonline/scripts/deploy/translatepdfonline.conf /etc/nginx/conf.d/translatepdfonline.conf
nginx -t && systemctl reload nginx
```

推送后自动部署（见下）也会执行上述复制并 `reload nginx`。

### 7. 配置 Hook：每次 push 自动部署

在服务器上**执行一次**以下命令即可启用“push 后自动部署”：

```bash
cd /data/translatepdfonline
bash scripts/deploy/setup-push-hook.sh
```

若报错 `set: invalid option` 或 `\r: command not found`，多半是脚本被存成了 Windows 换行符（CRLF）。先去掉 `\r` 再执行：

```bash
sed -i 's/\r$//' scripts/deploy/setup-push-hook.sh scripts/deploy/post-receive
bash scripts/deploy/setup-push-hook.sh
```

该脚本会：设置 `receive.denyCurrentBranch updateInstead`、将 [post-receive](post-receive) 复制到 `.git/hooks/post-receive` 并设为可执行。仓库已通过 `.gitattributes` 强制 `*.sh` 与 deploy 脚本使用 LF，推送更新后即可避免再次出现 CRLF。

之后在本机执行 `git push backend master` 将自动：pip install、alembic upgrade head、重启 API/Celery、覆盖并重载 Nginx 配置。
