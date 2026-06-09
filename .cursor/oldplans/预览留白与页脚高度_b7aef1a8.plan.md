---
name: 预览留白与页脚高度
overview: 通过让 benefits 预览区按图片真实宽高比「宽度撑满、高度随图」消除 object-contain + 固定比例盒子的内侧留白；将默认主题页脚各垂直间距统一按约 2/3 缩放以降低整体高度。
todos:
  - id: accordion-intrinsic
    content: features-accordion：预览改为 w-full + img h-auto（LazyImage 传 width/height、去 aspect-ratio 主路径），max-h 挂在 img 上等比缩放
    status: completed
  - id: verify-png-json
    content: 可选：核对 dense_PDFs / landing-page 真实像素与 index.json 中 width/height 一致
    status: completed
  - id: footer-scale
    content: footer.tsx：py / space-y / gap 等垂直相关间距 ×2/3（calc 或等价 rem）
    status: completed
isProject: false
---

# 预览留白 + 页脚高度（约 2/3）

## 1. Benefits 预览仍有空白的原因与改法

**现状**（`[frontend/src/themes/default/blocks/features-accordion.tsx](frontend/src/themes/default/blocks/features-accordion.tsx)`）：外层用 `style={{ aspectRatio: W/H }}`（来自 JSON）+ `max-h-*`，内层 `LazyImage` 为 `object-contain`。只要出现任一情况，**内侧仍会有灰/白条**：

- JSON 里的 `width`/`height` 与 `[frontend/public/imgs/features/*.png](frontend/public/imgs/features)` 实际像素比不一致；
- `max-height` 与 `aspect-ratio` 同时作用时，部分浏览器下「宽 100%、高被夹断」导致盒子比例 ≠ 图片比例，`contain` 只能在左右或上下留空。

**推荐改法（优先，避免回到「巨字裁切」）**：**去掉「固定比例 + contain 填满盒子」模型**，改为 **整列宽度下按图片固有比例排版**：

- 预览外层容器：`w-full min-w-0 overflow-hidden rounded-2xl …`，**不再**对预览根节点设 `aspectRatio`（或仅作无图时的占位）。
- `LazyImage`：**关闭 `responsive`**，并传入当前项的 `width`/`height`（与现有 JSON 一致），图片类名为 `**w-full h-auto max-w-full**`（必要时加 `**max-h-[min(72vw,28rem)] sm:max-h-[30rem]**` 在 **img** 上，超限则整体等比缩小，仍不留左右死空白）。
- 若某项缺 `width`/`height`：保留 `responsive + contain` 作为回退，或给默认比例占位。

**可选校验（一次性）**：用本地工具对 `dense_PDFs.png`、`landing-page.png` 读真实宽高，若与 `[frontend/src/config/locale/messages/en/pages/index.json](frontend/src/config/locale/messages/en/pages/index.json)` 中 `benefits.items[].image` 不一致，**更正 JSON**，避免布局与文件不符。

**若仍希望「盒子总高固定」且几乎无内侧留白**：只能倾向 `**object-cover` + `object-left`（或 center）**——会牺牲边缘内容，需你接受轻微裁切后再调。

---

## 2. 页脚高度调整为「约当前 2/3」

**范围**：默认主题 `[frontend/src/themes/default/blocks/footer.tsx](frontend/src/themes/default/blocks/footer.tsx)`（`[FooterWithTranslateBehavior](frontend/src/themes/default/blocks/FooterWithTranslateBehavior.tsx)` 仅包一层，**不必改**折叠条高度，除非你希望翻译页那条也同比变矮）。

**做法**：对影响垂直占位的间距统一乘以 **2/3**（用 `calc` 或就近 Tailwind 档位），避免只改 `py` 而 `space-y`/`gap` 仍很大：


| 当前                                 | 建议（×2/3）                                            |
| ---------------------------------- | --------------------------------------------------- |
| `py-8`                             | `py-[calc(theme(spacing.8)*2/3)]` 或 `py-[1.333rem]` |
| `container` 上 `space-y-8`          | `space-y-[calc(theme(spacing.8)*2/3)]`              |
| 主栅格 `gap-12`                       | `gap-[calc(theme(spacing.12)*2/3)]`（即 3rem×2/3）     |
| 品牌列 `md:space-y-6`                 | `md:space-y-[calc(theme(spacing.6)*2/3)]`           |
| 导航 `gap-6`                         | `gap-[calc(theme(spacing.6)*2/3)]`                  |
| 中部 `gap-4` / `sm:gap-8`、底栏 `gap-8` | 同样按 `*2/3` 写成 `calc(...)`                           |


若项目 Tailwind 版本对 `theme()` 在任意值里支持不佳，可改为 **纯 rem 的 calc**（例如 `spacing.8` → `2rem`）以保证构建稳定。

---

## 3. 验证

- 首页 benefits：切换三个折叠项，预览在**第一列全宽**下应无明显左右留白（条纹列仍为独立 3.75rem，不属于「图内空白」）。
- 各语言 `pages/index.json` 中 benefits 若缺 `width`/`height`，回退路径需肉眼看是否可接受。
- 页脚：对比改前改后总高度约 **2/3**（桌面 + 移动端断点各看一眼）。

