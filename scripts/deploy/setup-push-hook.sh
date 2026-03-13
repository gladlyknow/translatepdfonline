#!/bin/bash
# 在服务器上一次性执行：配置 git，使每次 push 后自动部署（pip/alembic/重启服务/nginx）
# 用法：cd /data/translatepdfonline && bash scripts/deploy/setup-push-hook.sh
set -e
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

if [ ! -d ".git" ]; then
  echo "错误：当前目录不是 git 仓库根目录（未找到 .git）"
  exit 1
fi

echo "允许向当前分支 push 并自动更新工作区..."
git config receive.denyCurrentBranch updateInstead

echo "安装 post-receive 钩子..."
cp -f scripts/deploy/post-receive .git/hooks/post-receive
chmod +x .git/hooks/post-receive

echo "Hook 已配置完成。之后在本机执行 git push backend master 将自动部署。"
