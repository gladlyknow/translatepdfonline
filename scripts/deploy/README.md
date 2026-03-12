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

### 2. 数据库迁移

```bash
cd /data/translatepdfonline/backend
../.venv/bin/alembic upgrade head
# 若无迁移历史：../.venv/bin/python scripts/create_tables.py
```

### 3. 安装 systemd 服务并启动

```bash
cp /data/translatepdfonline/scripts/deploy/translatepdfonline-api.service /etc/systemd/system/
cp /data/translatepdfonline/scripts/deploy/translatepdfonline-celery.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable translatepdfonline-api translatepdfonline-celery
systemctl start translatepdfonline-api translatepdfonline-celery
systemctl status translatepdfonline-api translatepdfonline-celery
```

### 4. 校验

```bash
curl -s http://127.0.0.1:8000/health
# 应返回 {"status":"ok", ...}
```

### 5. 推送后自动部署（可选）

若已按计划完成 git 初始化并配置 `receive.denyCurrentBranch updateInstead`：

```bash
cp /data/translatepdfonline/scripts/deploy/post-receive /data/translatepdfonline/.git/hooks/post-receive
chmod +x /data/translatepdfonline/.git/hooks/post-receive
```

之后本机 `git push backend master` 将自动执行 pip install、alembic、重启两个服务。
