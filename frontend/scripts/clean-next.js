#!/usr/bin/env node
/**
 * 删除 .next 目录，用于解决 Windows 上 EPERM（.next/trace 被占用）导致的构建失败。
 * 构建前请先停止 dev 服务器，再执行 pnpm run build:clean 或本脚本。
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const nextDir = path.join(root, '.next');

if (fs.existsSync(nextDir)) {
  try {
    fs.rmSync(nextDir, { recursive: true, maxRetries: 3 });
    console.log('Removed .next directory.');
  } catch (e) {
    console.error('Failed to remove .next:', e.message);
    console.error('请先关闭 dev 服务器 (pnpm dev) 或其它占用 .next 的进程后重试。');
    process.exit(1);
  }
} else {
  console.log('.next not found, nothing to clean.');
}
