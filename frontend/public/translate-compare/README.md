# Translate page — Before / After compare assets

Place **real marketing screenshots** here for the funnel slider:

| File        | Purpose                          |
| ----------- | -------------------------------- |
| `before.svg` / `before.png` | Source PDF preview (or English original) |
| `after.svg` / `after.png`   | Translated output preview                |

The UI loads **`/translate-compare/before.svg`** and **`/translate-compare/after.svg`** by default (`BeforeAfterPdfCompare.tsx`). To use PNGs, update the `beforeSrc` / `afterSrc` props or change the component to point at `before.png` / `after.png`.

Recommended: same aspect ratio (e.g. 16:10), similar crop, ~800–1200px wide WebP/PNG for performance.
