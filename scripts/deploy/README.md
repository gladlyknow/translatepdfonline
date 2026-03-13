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

```bash
cd /data/translatepdfonline/backend
../.venv/bin/alembic upgrade head
# 若无迁移历史：../.venv/bin/python scripts/create_tables.py
```

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

### 6. 推送后自动部署（可选）

若已按计划完成 git 初始化并配置 `receive.denyCurrentBranch updateInstead`：

```bash
cp /data/translatepdfonline/scripts/deploy/post-receive /data/translatepdfonline/.git/hooks/post-receive
chmod +x /data/translatepdfonline/.git/hooks/post-receive
```

之后本机 `git push backend master` 将自动执行 pip install、alembic、重启两个服务。
