# public/imgs 引用审计（strict_reference_only）

审计范围：

- 静态资源目录：`public/imgs/**`
- 扫描文件：`src`、`content`、`docs`、`scripts`、`public` 下文本文件
- 规则：仅将“全仓无路径引用且非动态约定路径”标记为删除候选

## 结论摘要

- 总图片数：45
- 已引用：28
- 未引用候选：17（可删除）

## 明确保留（有引用）

- `imgs/cases/**`：被 `showcases` 多语言配置引用，不能删除
- `imgs/features/1.png` ~ `4.png`、`landing-page_new.png`、`dense_PDFs.png` 等：被首页/文案配置引用
- `imgs/avatars/1.png` ~ `6.png`：被 `social-avatars` 组件引用

## 删除候选（本次执行删除）

- `imgs/avatars/7.png`
- `imgs/avatars/8.png`
- `imgs/avatars/9.png`
- `imgs/avatars/10.png`
- `imgs/avatars/11.png`
- `imgs/avatars/12.png`
- `imgs/avatars/13.png`
- `imgs/features/5.png`
- `imgs/features/6.png`
- `imgs/features/admin.png`
- `imgs/features/admin-settings.png`
- `imgs/logos/nextjs.svg`
- `imgs/logos/react.svg`
- `imgs/logos/shadcn.svg`
- `imgs/logos/supabase.svg`
- `imgs/logos/tailwindcss.svg`
- `imgs/logos/vercel.svg`

