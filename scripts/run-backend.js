#!/usr/bin/env node
const { spawn } = require("child_process");
const path = require("path");

const root = path.join(__dirname, "..");
const python = path.join(root, ".venv", "Scripts", "python.exe");

// 启动 uvicorn，并监听项目根目录下的 .env / .env.local 变化自动重载
const args = [
  "-m",
  "uvicorn",
  "app.main:app",
  "--reload",
  "--host",
  "0.0.0.0",
  "--reload-include",
  "../.env",
  "--reload-include",
  "../.env.local",
];

const proc = spawn(python, args, {
  cwd: path.join(root, "backend"),
  stdio: "inherit",
});
proc.on("exit", (code) => process.exit(code || 0));
