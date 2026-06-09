# 品牌 PNG 导出

这些 PNG 由 **`scripts/export-brand-icons.py`** 生成，视觉与 **`public/favicon.svg`**（圆角 + 对角渐变 + 白字 T）一致，与顶栏 / 页脚 `BrandLogo` 所用矢量标统一。

| 文件 | 用途 |
|------|------|
| `logo-32.png` | 小尺寸 UI、缩略图 |
| `logo-64.png` | 中等尺寸列表、分享预览 |
| `logo-180.png` | Apple Touch Icon、PWA 等 |
| `logo-512.png` | 应用商店、高清展示 |

根目录 **`/logo.png`**（512×512）由同一脚本覆盖，用于默认 `app_logo`、部分 OG/邮件等。  
**Apple Touch** 使用 **`/brand/logo-180.png`**（见 `layout.tsx` / `seo.ts`）。  
**`/favicon.ico`** 亦由该脚本写入（内嵌 32×32 PNG），与 **`favicon.svg`** 视觉一致，避免浏览器仍用旧模板图标。

重新生成（仅需 Python 3，无第三方库）：

```bash
cd frontend && pnpm run brand:icons
# 或: python scripts/export-brand-icons.py
```

## 来自 `tmp/images` 的素材

设计稿在仓库 **`tmp/images`** 时，可同步到本站可访问路径（勿在代码里引用 `tmp/`）：

```bash
cd frontend && pnpm run brand:sync-from-tmp
```

详见 **`local/README.md`**（`public/brand/local/` 下为同步副本；根目录 `logo-t-pdf.jpeg` / `t-pdf-preview.jpeg` 由脚本一并更新）。
