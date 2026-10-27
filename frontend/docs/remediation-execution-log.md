# TranslatePDFOnline 整改执行日志

> 用途：对[项目整改总表](./project-seo-gsc-remediation-plan.md)中的每一步保留“修改前证据 → 变更 → 部署 → 生产验证 → GSC 验证”。  
> 建立日期：2026-10-21  
> 规则：一项任务一条记录；未达到验收条件时，不得标记为“已完成”。

## 状态规范

| 状态             | 使用条件                                        |
| ---------------- | ----------------------------------------------- |
| 计划中           | 已定义范围和验收条件，尚未执行                  |
| 执行中           | 正在修改或验证                                  |
| 等待部署         | 本地验证通过，尚未进入目标环境                  |
| 等待生产         | develop 已验证，尚未发布到生产环境              |
| 等待外部刷新     | 代码和生产验证完成，但依赖 Google 重抓/报表刷新 |
| 需站点所有者操作 | 需要 GSC / GCP / Cloudflare 等账号内操作        |
| 已完成           | 所有验收条件和证据均齐全                        |
| 已回滚           | 变更撤回，并记录原因和回滚验证                  |

## 已执行记录

### EXEC-001 — 修复前 GSC 官方 API 基线

- 日期：2026-10-21
- 关联任务：SEO-001、SEO-004、SEO-005
- 状态：已完成
- 范围：domain property `sc-domain:translatepdfonline.com`；权限 `siteFullUser`。
- 操作：使用服务账号调用官方 Sites、Sitemaps、URL Inspection、Search Analytics API。
- 结果：检查 213 个 URL；154 PASS；59 非 PASS；API 错误 0。
- 非 PASS 构成：52 个 `Crawled - currently not indexed`、6 个 `Alternate page with proper canonical tag`、1 个 `Duplicate, Google chose different canonical than user`。
- Search Analytics：最近完整 28 天 21 点击、当时 1,268 展示；最近完整 90 天 57 点击、9,609 展示。近期展示会因数据新鲜度调整。
- 脱敏产物：`/tmp/translatepdfonline-gsc-2026-10-21-live-api`。
- 结论：修复前基线建立，不能据此代表修复后状态。

### EXEC-002 — 技术 SEO 与公开配置修复

- 日期：2026-10-21
- 关联任务：SEO-001、SEO-004、SEO-005
- 状态：已完成
- 提交：`bf2a3192`（`fix: harden SEO indexing and public config`）。
- 主要变更：统一 canonical/`hreflang`/语言路径；收敛 sitemap；调整 robots/noindex；阻止敏感服务端配置进入公开输出；增加 SEO 测试。
- 本地验证：构建和相关自动测试通过。
- 回滚点：提交的父提交；如回滚，必须重新检查 sitemap、robots、canonical 与公开配置，不能只看构建成功。

### EXEC-003 — develop 环境部署与验证

- 日期：2026-10-21
- 关联任务：部署验证
- 状态：已完成
- 分支 / 提交：`develop` / `bf2a3192`。
- Cloudflare：开发 Web Worker 与开发队列 Worker 构建均成功。
- 验证：开发环境 canonical、robots、sitemap、语言路径和敏感配置检查通过后，才进入生产分支。

### EXEC-004 — 生产部署核对

- 日期：2026-10-21
- 关联任务：部署验证、ENG-002
- 状态：已完成（分支命名整改仍待执行）
- 实际生产分支：`master`，不是 `main`。
- 远端状态：`origin/master` 与 `origin/develop` 均指向 `bf2a3192`。
- Cloudflare：生产 Web Worker 与生产队列 Worker 构建成功；生产部署时间约为 2026-10-21 05:49 UTC。
- 结论：用户所说的“main 已推送”在当前仓库实际对应 `master`；代码已进入生产，但需统一后续口径。

### EXEC-005 — 生产站 HTTP 与 sitemap 全量审计

- 日期：2026-10-21
- 关联任务：SEO-001、SEO-004、SEO-005
- 状态：已完成
- 在线 sitemap：172 个 `<loc>`；双 locale alternate 0。
- 全量页面结果：172/172 返回 200，且 `robots=index, follow`、HTML `lang` 正确、自引用 apex canonical 正确。
- 重定向：HTTP apex 和 `www` 深层链接均单跳 301 到 HTTPS apex，并保留路径与查询参数。
- robots：公开页面允许抓取，API、后台、账号、聊天等内部路径禁止抓取。
- 安全检查：页面公开配置中的敏感字段命中 0。
- 结论：当前生产输出的技术条件通过。

### EXEC-006 — 生产部署后 GSC 官方 API 审计

- 日期：2026-10-21
- 关联任务：SEO-001、SEO-003、SEO-004、SEO-005
- 状态：等待外部刷新
- 生成时间：2026-10-21 06:00:46 UTC。
- URL Inspection：172 个 URL；131 PASS；41 非 PASS；API 错误 0。
- 非 PASS 构成：37 个 `Crawled - currently not indexed`，4 个 `Alternate page with proper canonical tag`。
- 关键证据：172 个 URL 的 `lastCrawlTime` 全部早于本次生产部署；部署后重抓数 0。
- Sitemap API：`submitted=213` 仍是旧快照；同时返回 `indexed=0`、0 error、0 warning，但官方已将 `indexed` 字段标记为 deprecated / do not use，因此不能把它解读为 0 个页面被索引。
- Search Analytics：最近完整 28 天 21 点击 / 1,301 展示 / 1.61% CTR；最近完整 90 天 57 点击 / 9,609 展示 / 0.59% CTR。
- 报告校验：172 URL 与 172 Inspection 一致；报告中无敏感值。
- 脱敏产物：`/tmp/translatepdfonline-gsc-2026-10-21-after-main-bf2a3192`。
- 结论：生产修复有效，但 Google 尚未检查新版本；GSC 不能标记“完全解决”。
- 下一检查：D1 / D3 / D7 / D14。

### EXEC-007 — 建立整改总表与执行日志

- 日期：2026-10-21
- 关联任务：项目治理
- 状态：已完成
- 变更：新增 `project-seo-gsc-remediation-plan.md` 和本日志。
- 覆盖：问题清单、优先级、验收条件、41 个 GSC URL、18 个退出 sitemap 的 URL、产品扩展波次、GSC 复查计划和逐步记录模板。
- 验证：Markdown 差异检查、内部链接和问题 ID 检查通过后完成。

### EXEC-008 — SEO / GEO / 多语言内容层全量审计

- 日期：2026-10-21
- 关联任务：SEO-002、SEO-003、SEO-006、SEO-007、SEO-008、CNT-001、CNT-003、CNT-004、I18N-001、I18N-002、GEO-002、GEO-003、GEO-004
- 状态：已完成
- 范围：仓库内容、172 个生产 sitemap URL、结构化数据、GSC Search Analytics、多语言 JSON/MDX。
- 生产结果：172/172 返回 200；title 缺失 0；description 缺失 4；H1 数量异常 12；og:title 缺失 3；Twitter Card 缺失 0；JSON-LD 解析错误 0。
- 多语言结果：9 个非英语合同对比页存在可见英文模块；9 个非英语首页缺页面级 metadata；德/西/俄 pricing 结构仍与当前英文不一致。
- 内容事实：26 个文件存在 no-signup/no-account 类陈述，和 54 处登录要求冲突；14 个 locale 文件仍提到实际未支持的 Norwegian。
- 内链：公开内容存在 53 处 `www` 绝对链接。
- GEO 抓取：Googlebot、OAI-SearchBot、ChatGPT-User 访问首页均返回 200。
- Search Analytics：优先意图仍为 PDF 翻译、JPG to Word、PDF to Text；优先市场以美国、印度、菲律宾、德国、俄罗斯、西班牙等为主。
- 结论：技术 SEO 基础通过；内容事实、OCR 页语义、多语言本地化和实体可信度进入 P0/P1 整改。

### EXEC-009 — 建立 GSC 控制台手册和场景化本地化计划

- 日期：2026-10-21
- 关联任务：项目治理、SEO/GEO、多语言
- 状态：已完成
- 交付：`gsc-console-operation-guide.md`、`seo-geo-multilingual-audit-plan.md`。
- GSC 手册：包含 sitemap、URL Inspection、实时测试、请求索引、Pages 导出、验证修复、Search Analytics、CWV、结构化数据、D1/D3/D7/D14 和关闭标准。
- 多语言计划：使用“用户—文档—场景—痛点—能力—限制—CTA”brief，要求事实核对和母语审校，禁止逐句直译和关键词替换。
- 下一步：先执行安全密钥轮换和 GSC sitemap/代表 URL 操作，再启动 Phase A 功能事实清理。

### EXEC-010 — `/docs/upload` 重定向与 GSC 状态专项核验

- 日期：2026-10-21
- 关联任务：SEO-001、SEO-004、SEO-005
- 状态：等待外部刷新
- 本次范围：`https://www.translatepdfonline.com/docs/upload` 与 apex 规范 URL。
- 修改前证据：GSC 显示 `www` URL“网页会自动重定向”，最后抓取时间为 2026-08-12 20:39:17；引荐来源包含多语言 `/docs/upload` 页面。
- 现场验证：`www` URL 单跳 301 到 `https://translatepdfonline.com/docs/upload`；apex 返回 200、允许索引、使用 apex 自引用 canonical，并包含在当前 sitemap。
- 判断：`www` URL 不应独立收录，“网页会自动重定向”是预期状态；需要检查的是 apex URL。当前 GSC 抓取早于修复部署，不能以历史状态否定现有代码。
- 代码处置：本项不需要为 `www` URL取消重定向；本批同时清理公开内容中的 `www` 绝对内链，减少继续产生旧主机信号。
- GSC 后续：站点所有者在 domain property 中重新提交 sitemap，对 apex URL 执行实时测试并请求一次收录；D1/D3/D7/D14 复查 `lastCrawlTime`。
- 验收结论：代码/现场条件通过，Google 层等待重抓。

### EXEC-011 — SEO / GEO / 多语言 P0 内容整改批次

- 日期：2026-10-21
- 关联任务：CNT-FACT、CNT-001、CNT-003、CNT-004、CNT-005、SEO-002、SEO-006、SEO-007、SEO-008、I18N-001、I18N-002、GEO-004
- 状态：等待外部刷新
- 本次范围：产品事实基线、10 个 locale 的 OCR/首页/工具/定价内容、合同对比页、博客、docs、legal 内链和 SEO 内容契约。
- 明确不包含：Google 重抓结果、母语人工审校、品牌 About/Methodology/Security 页面、业务漏斗埋点、PDF 压缩/合并功能、de/es/ru pricing 旧 schema 完整迁移。
- 修改前证据：OCR 10 个 locale 无服务端 H1；9 个首页无页面级 metadata；4 个 docs description 为空；博客双 H1/OG 不完整；`www` 内链、Norwegian、免登录、固定赠送积分、固定费率和合同 CLM 夸大陈述仍存在。
- 变更内容：
  - 新建 `product-facts.md`，锁定语言、登录、积分、费率、格式、大小、保留和规范域名。
  - 为 OCR Translator 增加独立 locale metadata、服务端 H1、场景和限制模块。
  - 补 9 个首页 metadata；补 docs description；修博客双 H1、OG/Twitter 和 BlogPosting。
  - 合同对比页改为真实“两份文档差异定位 + 人工复核”场景，移除 CLM、认证和未经验证的效率承诺。
  - 清除公开内容中的 Norwegian、免登录、无条件赠送积分和 `www` 内链；非英语关联模块完成本地化。
  - 顶部注册赠送横幅读取后台开关和数量；关闭或数量无效时不显示。
  - pricing 每页积分在服务端按当前运行时配置注入，静态内容不再写死 10。
  - 新增 SEO 内容合同，阻止上述事实错误回归。
- 本地验证：locale JSON 全量解析通过；`pnpm test:seo` 13/13；`pnpm exec tsc --noEmit` 通过；`pnpm build` 通过，203/203 静态页面生成成功。
- 实际 HTML 抽查：`/zh/ocrtranslator`、`/fr/ocrtranslator`、`/zh/pricing`、`/ru/contract-comparison` 均只有 1 个 H1；title/canonical 存在；可见正文无未替换 `{creditsPerPage}`，无抽样免登录陈述。
- 工具链备注：独立 ESLint 命令因仓库缺少 ESLint 9 配置而无法启动；生产构建内置 lint/type 阶段与 TypeScript 检查通过。新增 ENG-003 跟踪，不伪报 lint 通过。
- 分支 / 提交：实现提交 `2c9e859f`，记录提交 `c49263ef`；截至 2026-10-27 均已进入 `origin/develop` 与 `origin/master`。
- Cloudflare 部署证据：dev Worker 于 2026-10-21 07:57:31 UTC 生成新部署并切换流量；部署前最后版本时间为 05:48:38 UTC。
- dev 验证：`/zh/ocrtranslator`、`/fr/ocrtranslator`、`/ru/contract-comparison`、`/zh/pricing` 均返回新内容、自引用 dev canonical 和单一 H1；OCR title 已独立；无可见 `{creditsPerPage}`、免登录承诺或旧 CLM 营销定位。俄语页保留“本工具不替代 CLM 或法律复核”的限制说明，属于事实边界而非能力宣称。
- 生产验证：2026-10-27 对当前 38 个非 PASS URL 全量检查，全部返回 200、`index,follow`、单 H1、自引用 canonical；生产已包含本批内容修复。
- GSC 验证：PASS 从 131 增至 134；`/es/docs/ocr-workbench`、`/ja/pdf-to-text` 在生产修改后重抓并恢复；仍有页面需要内容扩充或继续重抓。
- 验收结论：代码与生产层完成，Google 层等待后续抓取；不能把剩余未收录全部归因为本批失败。
- 回滚方式：回滚本批独立提交；不得回滚上一批 canonical/sitemap/robots 安全修复。
- 下一动作：继续按单一内容模板分批整改，并执行 GSC D1/D3/D7/D14。

### EXEC-012 — 2026-10-27 GSC 官方 API 复查

- 日期：2026-10-27
- 关联任务：SEO-001、SEO-003、SEO-004、SEO-005
- 状态：已完成
- 本次范围：domain property `sc-domain:translatepdfonline.com`；当前 sitemap 的 172 个 URL；Search Analytics 最近完整 28/90 天。
- 明确不包含：GSC“网页索引”界面全部历史 URL；本次没有控制台写操作，也没有调用 Google Indexing API。
- 官方 API 权限：`siteFullUser`。
- Sitemap API：`submitted=172`、`indexed=0`、0 error、0 warning、`lastDownloaded=2026-10-21T06:59:18.394Z`；`indexed` 为弃用字段，不作为全站收录数。
- URL Inspection：172 个 URL；134 PASS；38 非 PASS；API 错误 0。
- 非 PASS 构成：36 个 `Crawled - currently not indexed`；2 个 `Alternate page with proper canonical tag`。
- 相对 2026-10-21：恢复 `/docs/ocr-workbench`、`/docs/upload`、`/es/docs/ocr-workbench`、`/ja/pdf-to-text`；新增 `/de/docs/ocr-workbench`。
- 重抓后仍未收录：`/de/pdf-to-text`、`/es/docs`、`/fr/docs`、`/it`、`/it/pricing`、`/ja`，因此不能继续统一标记为“只需等待”。
- Search Analytics：2026-09-27 至 2026-10-24 为 17 点击 / 1,187 展示 / 1.43% CTR；2026-07-27 至 2026-10-24 为 57 点击 / 9,734 展示 / 0.59% CTR。
- 线上技术关联：38/38 非 PASS URL 返回 200、`index,follow`、单 H1、自引用 canonical；技术故障 0。
- 脱敏报告：`/tmp/translatepdfonline-gsc-2026-10-27-after-production-c49263ef-retry`；校验 172 URL = 172 Inspection，且无敏感值。
- 验收结论：上批修复带来净改善；SEO-005 的 sitemap 刷新已完成；剩余任务以内容质量、母语复核和重抓验证为主。
- 下一动作：按一个模板一个批次扩充内容，先处理 OCR 集群，再处理多语言 docs 首页。

### EXEC-013 — 多语言 OCR 内容集群扩充

- 日期：2026-10-27
- 关联任务：SEO-003、SEO-006、CNT-002、GEO-003、GEO-004
- 状态：等待生产
- 本次范围：10 个 locale 的 `/ocrtranslator` 可见内容与 FAQ JSON-LD；10 份 `/docs/ocr-workbench` 指南；SEO 内容合同。
- 明确不包含：新 OCR 功能、费率调整、压缩/合并空壳页、第二个内容模板、生产请求收录、人工母语终审。
- 修改前证据：GSC 新增 `/de/docs/ocr-workbench` 未收录；`/es/ocrtranslator`、`/ja/ocrtranslator`、`/ru/ocrtranslator` 仍未收录；原 OCR 指南仅约 42–96 个空格分词，页面可见语义区仅有简介、场景和限制三个短模块。
- 场景 brief：扫描论文、供应商文件、技术手册与纸质档案；任务为“识别 → 校对 → 翻译 → 导出”，并明确复杂表格、手写、低清扫描、特殊字体和加密 PDF 的边界。
- 变更内容：新增 4 步工作流、校对清单、PDF/Markdown/HTML 输出说明、登录与约 7 天保留边界、4 组 FAQ、产品事实复核日期和指南内链；指南补充准备、逐步操作、导出、故障边界与隐私说明。
- 多语言原则：10 个语言分别按对应文档场景写作；产品事实一致，但问法、例子和语序不复用英文原句；未引入固定积分、免登录、无限能力或完美版式承诺。
- 自动合同：新增每个 locale 的 workflow/review/outputs/privacy/FAQ/复核日期/指南长度和导出格式检查。
- 本地验证：JSON 全部可解析；`pnpm test:seo` 14/14；`pnpm exec tsc --noEmit` 通过；`pnpm build` 通过，203/203 静态页面生成成功；`git diff --check` 通过。
- 实现提交：`31613085`（`feat: expand multilingual OCR content`）。
- Cloudflare 部署证据：`35bd27aa` 推送 `origin/develop` 后自动触发；dev 队列 Worker 构建于 2026-10-27 02:22:14 UTC 成功，dev Web Worker 构建于 02:23:56 UTC 成功。
- dev 验证：10 个 `/ocrtranslator` 与 10 个 `/docs/ocr-workbench` 共 20/20 返回 200、自引用 dev canonical、单 H1；新语言内容和指南标记存在；页面包含 FAQ JSON-LD；无未替换翻译键。
- 生产验证：未执行；当前不宣称 GSC 已改善。
- GSC 验证：生产部署后对 `/de/docs/ocr-workbench`、`/es/ocrtranslator`、`/ja/ocrtranslator`、`/ru/ocrtranslator` 实时测试并各请求一次收录；D1/D3/D7/D14 复查。
- 回滚方式：独立回滚 `31613085`；不会影响既有 canonical、sitemap、robots 和 OCR 功能代码。
- 下一动作：人工抽样语言自然度后合入生产；生产部署完成前不执行请求收录。

### EXEC-014 — OCR 任务工作台被 SEO 内容下推

- 日期：2026-10-27
- 关联任务：SEO-006、产品可用性回归
- 状态：等待部署
- 本次范围：`/ocrtranslator` 的普通落地页、`task` 任务恢复态和 `document` 文档恢复态；所有会跳转到该工作台的入口。
- 明确不包含：OCR 识别/翻译算法、任务数据、编辑器功能、营销内容删除、生产发布。
- 修改前证据：生产 URL `/ocrtranslator?task=...` 在工作台上方继续显示 “Translate scanned PDFs with OCR / Useful for / Before you start”，截图中工作台整体被下推约一个首屏内容区高度。
- 根因：`page.tsx` 无条件在 `OcrTranslatePageClient` 前后渲染落地页 SEO 内容；固定视口的 OCR shell 未区分内容浏览态与任务操作态。
- 同类入口审计：`/pdf-to-text`、`/image-to-text`、`/upload` 和历史任务均跳转到同一个 `/ocrtranslator?task=...`，因此共享本次修复；`/translate` 仅重定向到 OCR 路由；其他转换页未使用相同 `task` 工作台结构，未发现同类下推问题。
- 变更内容：服务器读取查询参数；仅非空 `task` 或 `document` 进入工作台模式，并移除首屏、FAQ JSON-LD 和底部说明，同时输出 `noindex,nofollow`；普通 `/ocrtranslator` 及仅含语言预选参数的 URL 保留完整 SEO/GEO 内容和原 canonical。
- 本地验证：SEO 合同 15/15；TypeScript 通过；生产构建通过并生成 203/203 静态页面，OCR 路由按请求动态渲染；浏览器验证普通页 H1 存在、`task`/`document` 工作台 H1 不存在、工具区直接位于主内容顶部。
- 回滚方式：回滚本次独立提交；不影响 OCR API、任务状态或文档数据。
- 下一动作：推送 `develop`，等待 Cloudflare dev 构建后复查普通态、任务态、文档态和多语言任务态。

## 待执行队列

| 顺序 | 任务 ID  | 下一步                                   | 状态             | 负责人 | 目标时间  |
| ---: | -------- | ---------------------------------------- | ---------------- | ------ | --------- |
|    1 | SEC-001  | 撤销旧 GCP 服务账号密钥并更换安全存储    | 需站点所有者操作 | 待指定 | 立即      |
|    2 | EXEC-014 | 部署并验证 OCR 工作台任务态布局          | 等待部署         | Codex  | D0        |
|    3 | EXEC-013 | 审核 OCR dev 内容并决定生产发布          | 等待生产         | 待指定 | D0–D1     |
|    4 | CNT-FACT | 产品负责人复核已建立的功能事实表         | 待验证           | 待指定 | D0–D1     |
|    5 | SEO-003  | 第二批处理多语言 docs 首页模板           | 计划中           | 待指定 | 第 1 周   |
|    6 | I18N-001 | 完成德/西/俄 pricing 现行 schema 本地化  | 执行中           | 待指定 | 第 1 周   |
|    7 | SEO-001  | OCR 生产部署后运行 D1/D3/D7/D14 GSC 审计 | 等待外部刷新     | 待指定 | 见计划    |
|    8 | SEO-004  | 实时测试两个剩余 canonical 历史状态 URL  | 需站点所有者操作 | 待指定 | D1        |
|    9 | ENG-003  | 增加 ESLint 9 配置并纳入 CI              | 计划中           | 待指定 | 第 1 周   |
|   10 | PROD-001 | 设计并实现 PDF 压缩、PDF 合并 MVP        | 计划中           | 待指定 | 第 2–4 周 |

## 新记录模板

复制本节，为每个独立任务建立记录：

```text
### EXEC-NNN — 标题

- 日期：YYYY-MM-DD
- 执行人：
- 关联任务：
- 状态：计划中 / 执行中 / 等待部署 / 等待外部刷新 / 需站点所有者操作 / 已完成 / 已回滚
- 本次范围：
- 明确不包含：
- 修改前证据：
- 变更内容：
- 影响文件 / URL：
- 本地验证：
- 分支 / 提交：
- Cloudflare 部署证据：
- 生产验证：
- GSC 验证（含 lastCrawlTime）：
- 验收结论：
- 回滚方式：
- 下一动作 / 日期：
```

## 每次提交前检查

- [ ] 本次任务边界明确，没有顺带发布未完成页面。
- [ ] 修改前证据已保存且不含密钥、令牌、用户数据。
- [ ] 文案与产品事实表一致。
- [ ] 本地测试、构建、格式检查通过。
- [ ] 新页面在功能和内容验收前保持 noindex，且不进入 sitemap。
- [ ] Cloudflare 目标分支与环境正确。
- [ ] 生产 URL 的状态码、robots、canonical、`hreflang`、语言和功能已检查。
- [ ] GSC 判断记录最近抓取时间，没有把旧抓取结果归因于新代码。
- [ ] 完成/等待/回滚状态与证据一致。
