# 设计资源（由 `tmp/images` 同步）

本目录中的文件由仓库内 **`tmp/images`** 复制而来，作为站点可引用的**正式静态路径**（`/brand/local/<文件名>`）。

- 请勿在代码中引用 `tmp/` 路径；`tmp` 仅作临时或设计稿存放，可随时清理。
- **顶栏 Logo**、**OG/分享略图** 使用根目录固定文件名（与 `src/config/index.ts` 默认一致）：
  - `/brand/logo-t-pdf.jpeg` ← 源稿 `tmp/images/LOGO_T-PDF.jpeg`
  - `/brand/t-pdf-preview.jpeg` ← 源稿 `tmp/images/T-PDF.jpeg`
- 更新设计稿后：将新文件拷入 `tmp/images`，再执行与部署脚本相同的复制步骤（或手动覆盖 `local/` 与上述两个根文件）。
