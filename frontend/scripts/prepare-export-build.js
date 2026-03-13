/**
 * 静态导出构建前暂时移走 app/api，构建完成后恢复。
 * output: export 不支持 API 路由，但开发时需要 /api/auth；故仅在 OUTPUT_EXPORT=1 的构建中排除 api。
 * 使用：在 Cloudflare 等处设置 OUTPUT_EXPORT=1，构建命令用 npm run build:export。
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const apiDir = path.join(root, "app", "api");
const apiBak = path.join(root, "app", "api.bak");

function main() {
  const isExport = process.env.OUTPUT_EXPORT === "1";
  if (!isExport) {
    spawnSync("npx", ["next", "build"], { stdio: "inherit", env: process.env, cwd: root });
    process.exit(process.exitCode ?? 0);
    return;
  }

  const hadApi = fs.existsSync(apiDir);
  if (hadApi) {
    try {
      fs.cpSync(apiDir, apiBak, { recursive: true });
      fs.rmSync(apiDir, { recursive: true, maxRetries: 3 });
    } catch (e) {
      console.error("Backup/remove app/api failed (close IDE or other locks?):", e.message);
      process.exit(1);
    }
  }

  const result = spawnSync("npx", ["next", "build"], {
    stdio: "inherit",
    env: { ...process.env, OUTPUT_EXPORT: "1" },
    cwd: root,
  });

  if (hadApi) {
    try {
      if (fs.existsSync(apiDir)) fs.rmSync(apiDir, { recursive: true, maxRetries: 3 });
      fs.cpSync(apiBak, apiDir, { recursive: true });
      fs.rmSync(apiBak, { recursive: true });
    } catch (e) {
      console.error("Restore app/api failed:", e.message);
    }
  }

  process.exit(result.status ?? 0);
}

main();
