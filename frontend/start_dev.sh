#!/bin/bash

# 进入项目目录
cd /android/claude/translatepdfonline/frontend

# 清理可能残留的端口占用（可选）
fuser -k 3000/tcp # 假设你的 dev 环境使用 3000 端口，请根据实际调整

# 以后台方式启动，并将日志输出到文件
# 使用 nohup 确保终端关闭后进程不被杀掉
nohup pnpm run dev > dev.log 2>&1 &

echo "服务已在后台启动，日志记录在 dev.log 中"
echo "进程 ID (PID): $!"
