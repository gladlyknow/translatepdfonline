/**
 * 为静态导出生成 /register、/login、/privacy 的落地页：按浏览器语言重定向到 /zh|en|es/... 。
 * 输出到 public/register/index.html 等，构建时会被 next 复制到 out/，实现多语言适配。
 */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const locales = ["zh", "en", "es"];
const defaultLocale = "en";

const paths = ["register", "login", "privacy"];

function scriptFor(pagePath) {
  return `
  function pickLocale() {
    var lang = (navigator.language || navigator.userLanguage || '').toLowerCase();
    var list = navigator.languages || [lang];
    for (var i = 0; i < list.length; i++) {
      var l = String(list[i]).toLowerCase().split('-')[0];
      if (l === 'zh') return 'zh';
      if (l === 'es') return 'es';
      if (l === 'en') return 'en';
    }
    if (lang.indexOf('zh') === 0) return 'zh';
    if (lang.indexOf('es') === 0) return 'es';
    return 'en';
  }
  var locale = pickLocale();
  var segment = '${pagePath}';
  var target = '/' + locale + '/' + segment;
  window.location.replace(target);
`;
}

function htmlFor(pagePath) {
  const fallback = "/" + defaultLocale + "/" + pagePath;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="0;url=${fallback}">
  <title>Redirect</title>
</head>
<body>
  <p>Redirecting…</p>
  <script>${scriptFor(pagePath).trim()}</script>
</body>
</html>
`;
}

function main() {
  for (const p of paths) {
    const dir = path.join(root, "public", p);
    const file = path.join(dir, "index.html");
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, htmlFor(p), "utf8");
      console.log("Wrote " + file);
    } catch (e) {
      console.error("Failed to write " + file + ": " + e.message);
      process.exit(1);
    }
  }
}

main();
