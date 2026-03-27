#!/usr/bin/env node
const { spawn } = require("child_process");
const path = require("path");

const root = path.join(__dirname, "..");
const python = path.join(root, ".venv", "Scripts", "python.exe");

// 启动 Celery worker，使用 solo 池以兼容 Windows 环境；-n 指定唯一节点名，避免 DuplicateNodenameWarning
// -u 使 Python 标准输出/错误无缓冲，便于在 concurrently 下看到实时日志
const args = [
  "-u",
  "-m",
  "celery",
  "-A",
  "app.celery_app.celery_app",
  "worker",
  "-n",
  "worker1@%h",
  "-l",
  "info",
  "-P",
  "solo",
];

const proc = spawn(python, args, {
  cwd: path.join(root, "backend"),
  stdio: "inherit",
  env: { ...process.env, PYTHONUNBUFFERED: "1" },
});

proc.on("exit", (code) => process.exit(code || 0));

