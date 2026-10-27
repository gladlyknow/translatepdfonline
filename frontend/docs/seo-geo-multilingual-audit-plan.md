# SEO / GEO / 多语言场景化审计与执行计划

> 首次审计：2026-10-21；最新复查：2026-10-27
> 最近一次 GSC/API 生产基线：`master` / `9cd4f298`；当前内容候选：`origin/develop` / `cb9f167a`（Cloudflare dev 已验证）
> 范围：仓库、172 个生产 sitemap URL、GSC API、Search Analytics、多语言内容与结构化数据  
> GSC 操作：[gsc-console-operation-guide.md](./gsc-console-operation-guide.md)  
> 总整改表：[project-seo-gsc-remediation-plan.md](./project-seo-gsc-remediation-plan.md)

## 1. 审计结论

技术 SEO 的基础框架已经可用，但内容质量与多语言发布流程尚未达到稳定扩张条件。当前最值得优先处理的不是继续批量新增页面，而是修正功能事实、OCR Translator 页面语义、多语言英文残留、合同对比页意图错位和品牌实体可信度。

### 1.1 已通过项

- 172/172 sitemap URL 返回 200。
- 172/172 当前允许索引并使用 apex 自引用 canonical。
- HTML `lang`、`hreflang`、x-default 和 sitemap 语言组合基础检查通过。
- HTTP apex 与 HTTPS `www` 各自单跳 301 到 HTTPS apex，路径和查询参数保留；HTTP+`www` 组合仍为两跳，已列入 EDGE-001。
- 172 页 title 全部存在。
- 172 页 Twitter Card 均存在。
- 页面中的 JSON-LD 均能解析，没有语法错误。
- Googlebot、OAI-SearchBot、ChatGPT-User 请求首页均返回 200；当前 robots 通配规则允许它们访问公开内容。
- 当前生产页未发现服务端敏感配置泄露。

### 1.2 核心问题摘要

| ID       | 优先级 | 已确认问题                                                          | 证据                                                                                                                           | 影响                                                    |
| -------- | ------ | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| CNT-001  | P0     | 功能和营销陈述互相冲突                                              | 26 个内容文件存在“无需注册/无需账号”等说法；页面文案同时有 54 处明确要求登录；免费额度、输出格式和版式保留表述也不统一         | 失实承诺、跳出率、品牌可信度和 GEO 引用风险             |
| CNT-003  | P0     | 页面宣称支持 Norwegian，但实际配置只有 10 种语言且不含 Norwegian    | 14 个 locale 内容文件仍包含 Norwegian/挪威语相关关键词或 FAQ；`SUPPORTED_UI_LANGS` 不含 `no`                                   | 用户无法完成承诺任务，属于事实性错误                    |
| SEO-006  | P0     | OCR Translator 的 10 个语言页面没有服务端 H1，并与首页共用 metadata | 10/10 `/ocrtranslator` 页面 H1=0；9 个非英语版本与各自首页 title/description 重复，英语也使用 common 回退                      | 页面主题不清、重复信号、当前已有展示但 CTR 为 0         |
| I18N-002 | P0     | 9 个非英语合同对比页显示英文关联工具模块                            | 生产页面可见三个英文描述；locale JSON 中每种语言仍有 8–11 个有意义字符串与英文完全相同                                         | Google 依赖可见文本判断语言；混合语言影响体验和语言识别 |
| CNT-004  | P0     | 合同对比页搜索意图和真实产品能力错位                                | 页面大量定位“CLM / contract management software / enterprise security certifications / Top 10”，实际核心功能是两份文档差异对比 | 搜索优先内容、事实风险、可能解释该模板的收录不稳定      |
| CNT-005  | P0     | 注册赠送积分和每页计费被写成固定值                                  | 10 个 locale 顶部横幅固定承诺注册送 30 积分；pricing、API docs 和工具 FAQ 固定写每页 10 积分，但运行时配置可关闭赠送或调整费率 | 价格/促销事实漂移、投诉风险、搜索摘要和 GEO 引用失真    |
| SEO-002  | P0     | 9 个非英语首页缺页面级 metadata                                     | 除英文外，`pages/index.json` 均缺 title/description/keywords，回退到 common                                                    | 首页无法按市场和场景表达独特意图                        |
| SEO-007  | P1     | 文档和博客基础标签不完整                                            | 4 个 `/docs/pdf-to-text` description 为空；两篇博客有两个 H1；3 篇博客缺 og:title；大量 descriptions 过短或过长                | 搜索摘要、内容层级和分享预览质量不稳定                  |
| SEO-008  | P1     | 公开内容仍有 53 处 `www` 绝对链接                                   | blog、docs、terms/privacy 多语言内容仍指向 `https://www...`                                                                    | 每次内链多一次重定向，继续产生历史主机信号              |
| I18N-001 | P1     | 德/西/俄 pricing 仍使用旧结构                                       | 相对当前英文结构分别缺 9 个键、多 7 个旧键；目前这三个语言 pricing 已退出 sitemap                                              | 无法安全恢复索引，维护时容易静默英文回退                |
| SEO-003  | P1     | 36 个页面“已抓取但尚未编入索引”                                     | 2026-10-27 10:07 UTC GSC API 状态；集中在多语言工具与 docs                                                                     | 需要重抓后区分刷新延迟和内容同质化                      |
| GEO-002  | P1     | 品牌实体信息仍不完整                                                | dev 已修正 Organization 描述和公开外部资料，但仍没有独立 About/Team/Methodology/Security 页面                                  | 搜索和生成式系统仍缺少稳定的主体、责任人和事实来源      |
| GEO-003  | P1     | GEO 可引用内容缺少原创证据                                          | 工具页以通用营销和 FAQ 为主，缺少测试方法、样例、准确率边界、版本和数据来源                                                    | 难以被 AI 回答选作具体证据或引用                        |
| GEO-004  | P1     | `llms.txt` 是静态手写事实，缺少合同测试                             | 当前内容声明 10 语言、API、保留时间等；事实变化时可能与产品脱节                                                                | GEO 事实漂移；`llms.txt` 本身不保证被引用               |
| MEAS-001 | P1     | SEO 到业务结果的漏斗未形成                                          | 有 GA/Clarity/Plausible 配置能力，但代码中未确认统一的上传、完成、下载、注册、购买 SEO 归因事件                                | 无法判断“收录/点击”是否带来有效业务                     |
| SEO-009  | P2     | 仍投入大量维护成本到 meta keywords                                  | 所有语言维护长关键词串，合同页还保留英文堆词                                                                                   | Google 明确不使用 meta keywords，挤占真正内容研究时间   |
| PERF-001 | P2     | 页面性能仍缺真实基线                                                | 现有构建首载偏大；本轮未取得足够 GSC CWV 结论                                                                                  | 可能影响移动体验和抓取效率，需要先测后改                |

Google 明确说明页面语言主要根据可见文本判断，而不是仅依赖 `lang`，只翻译模板或混合多种语言会造成不良体验。参考：[Managing multilingual sites](https://developers.google.com/search/docs/specialty/international/managing-multi-regional-sites)。

### 1.3 2026-10-21 develop 整改历史状态

以下表格保留 2026-10-21 当时状态；截至 2026-10-27，`2c9e859f` 已进入生产，不再属于“等待生产”：

| 范围                                             | 本地状态             | 验证结果                                                                            | 部署后仍需完成                                          |
| ------------------------------------------------ | -------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------- |
| CNT-001 / CNT-003 / CNT-004                      | dev 已验证，等待生产 | 清除免登录、固定赠送、Norwegian、CLM/认证/效率夸大文案；内容合同测试通过            | 抽样生产 HTML；Google 重抓后复查摘要与收录              |
| CNT-005                                          | dev 已验证，等待生产 | 顶部赠送横幅按后台开关和数量显示；pricing 每页费率在服务端使用当前运行时配置注入    | 生产环境确认后台开启/关闭两种状态；核对实际费率         |
| SEO-002 / SEO-006 / SEO-007 / SEO-008            | dev 已验证，等待生产 | 首页 metadata、OCR 独立 metadata/H1、docs 描述、博客 H1/OG、apex 内链合同测试通过   | 生产后重新审计 172 URL                                  |
| I18N-002                                         | dev 已验证，等待生产 | 10 个合同对比页改为真实文档差异场景；非英语关联卡片已本地化                         | 母语审校；生产后检查可见文本与 JSON-LD                  |
| I18N-001                                         | 部分完成             | 旧结构 locale 继续 noindex/退出 sitemap；费率不再硬编码，运行时安全回退英文当前结构 | 重写 de/es/ru 当前 pricing schema，完成后再评估恢复索引 |
| SEO-003 / GEO-002 / GEO-003 / GEO-004 / MEAS-001 | 未关闭               | 已有计划但不属于本批全部完成范围                                                    | 按后续 Phase C–E 执行                                   |

本地验证：JSON 全量解析通过、SEO 内容合同测试 13/13、TypeScript 检查通过、Next.js 生产构建通过，203/203 静态页面生成完成；代表 locale 页面实际 HTML 均为单 H1，且未暴露费率占位符。独立 ESLint 命令因仓库缺少 ESLint 9 配置而无法运行，已列为工程任务，不归因于本次页面代码。

### 1.4 2026-10-27 GSC 复查与第一批内容扩充

- GSC 官方 API：172 URL、134 PASS、38 非 PASS、API 错误 0；上次为 131 PASS、41 非 PASS。
- Sitemap API：`submitted=172`、0 error、0 warning，旧的 213 URL 快照已刷新。
- 恢复页面：`/docs/ocr-workbench`、`/docs/upload`、`/es/docs/ocr-workbench`、`/ja/pdf-to-text`。
- 新问题：`/de/docs/ocr-workbench`；该页实时技术条件正常，但正文体量明显偏薄。
- 38 个非 PASS URL 的线上检查全部通过 200、`index,follow`、单 H1 和自引用 canonical，因此没有新的技术 SEO 修复依据。
- 已重抓仍未收录页面包括 `/de/pdf-to-text`、`/es/docs`、`/fr/docs`、`/it`、`/it/pricing`、`/ja`，确认内容质量整改应继续。
- 第一批按“一个模板一个批次”扩充 OCR 集群：10 个 `/ocrtranslator` 页面新增 4 步工作流、校对项、输出、隐私、FAQ 和复核日期；10 份 OCR 指南补充场景、操作、故障边界与导出说明。
- 实现提交：`31613085`；SEO 内容合同 14/14、TypeScript、Next.js 生产构建和 203/203 静态页面生成均通过；Cloudflare dev 的 10 个 OCR 页面和 10 份指南 20/20 验收通过。
- 下一批：多语言 docs 首页；功能尚未完成的 PDF 压缩/合并页面继续禁止公开索引。

### 1.5 2026-10-27 十种语言首页整改

- 修改前英文 H1 会把当前标题和不属于标题的旧高亮词拼接；轮播版五步流程同时保留了第二套网格 DOM。
- 十种语言首页存在免费、纯浏览器处理、绝对版式保留、游客处理和 `8+` 语言等失实或过时口径；FAQ 为 13 项，同义关键词重复多于用户决策信息。
- 提交 `c8b0b2de` 已修复 H1 与重复 DOM，并按每种语言的文档场景重写 metadata、首屏、能力、限制、登录/积分、后端处理、保留期、OCR 和 6 项 FAQ；实际支持语言数统一为 10。
- Organization JSON-LD 已改为有边界的产品描述，并关联网站公开的 X、GitHub 资料；图片的泛化 alt 会回退到本地化标题。
- 自动合同增加首页高风险声明、H1 高亮、FAQ 数量、语言数、步骤互斥、图片 alt 与 Organization 检查。
- 本地验证：SEO 合同 18/18、TypeScript、生产构建、203/203 静态页面均通过；Cloudflare dev 两项构建成功。
- dev 现场：10/10 locale 的 title/H1 与本地内容一致，单 H1，五步各出现一次，FAQ JSON-LD 6 项，旧英文 Free H1 不再出现。
- 后续状态：该批已随 `9cd4f298` 进入生产，现场验证通过；`/es`、`/it`、`/ja` 尚未抓取新版本，详见 1.6。

### 1.6 `9cd4f298` 生产部署与 GSC 新基线

- `master`、生产 Web Worker 与生产队列 Worker 均已成功；10 个首页、20 个 OCR 页面/指南和真实 OCR 任务 URL 完成现场验收。
- 首页 10/10 为正确单 H1，五步各出现一次，FAQ JSON-LD 为 6 项；OCR 任务态为 `noindex,nofollow` 且不再显示落地页营销区。
- sitemap 保持 172 个 apex URL，robots 指向正确 sitemap，OAI-SearchBot 未被屏蔽。
- GSC 官方 API（2026-10-27T10:07:23.991Z）：172 URL、134 PASS、36 个 `Crawled - currently not indexed`、2 个备用 canonical、0 API 错误。
- 数量与上次一致；只有 4 个 URL 的 `lastCrawlTime` 更新，首页和 OCR 代表 URL 均未抓取本次 10:01 UTC 后版本。因此当前结论是等待 Google 重抓，不是新内容失败。
- 新发现 EDGE-001：`http://www...` 会经过 HTTPS `www` 再到 apex，共两次 301。路径和查询参数完整，最终 200；应在 Cloudflare 用一条组合重定向规则收敛。
- 脱敏报告：`/tmp/translatepdfonline-gsc-2026-10-27-after-production-9cd4f298`，完整性与敏感值检查通过。

### 1.7 十种语言 docs 首页任务导航重构

- GSC 中 `/es/docs`、`/fr/docs` 已在 2026-10-25 重抓后仍未收录；旧首页同时存在错误入口 `/translate/upload`、语言扩展承诺、游客会话暗示和未稳定纳入产品事实的技术栈描述。
- 提交 `cb9f167a` 将 10 个 locale 的 `/docs` 重写为任务导航：翻译/OCR、PDF 提取、图片识别、版本对比、统一操作步骤、输入限制、输出复核、后端处理、隐私与约 7 天保留。
- 每种语言使用带 locale 的产品、指南和法律链接，明确实际 10 种语言、登录要求和动态积分，不把英文逐句替换成目标语言。
- 产品事实表增加实际 `/ocrtranslator` 入口及浏览器界面/后端处理边界；SEO 合同阻止旧路由、`www`、未来语言和不稳定实现词回归。
- 本地验证：SEO 合同 19/19、TypeScript、生产构建、203/203 静态页面通过；Cloudflare dev 两项构建成功，10/10 docs 首页单 H1、6 个任务区块和本地化链接均通过。
- 当前边界：本批尚未进入生产，不宣称 `/es/docs`、`/fr/docs` 的 GSC 状态已改善。

## 2. 生产页面量化结果

### 2.1 172 页现场内容审计

| 项目                     |      结果 |
| ------------------------ | --------: |
| HTTP 200                 | 172 / 172 |
| 缺 title                 |         0 |
| 缺 description           |         4 |
| H1 数量不等于 1          |        12 |
| 缺 og:title              |         3 |
| 缺 Twitter Card          |         0 |
| JSON-LD 解析错误         |         0 |
| 可见英文残留的非英语页面 |         9 |

结构化数据覆盖：

- Organization：10 个语言首页。
- WebSite：10 个语言首页。
- FAQPage：91 页。
- SoftwareApplication：10 个合同对比页。
- BlogPosting：3 篇博客。

结构化数据数量不是排名目标。Google 要求 JSON-LD 与可见内容一致、相关、完整，并且不保证标记后一定展示富结果。参考：[General structured data guidelines](https://developers.google.com/search/docs/appearance/structured-data/sd-policies)。

### 2.2 Search Analytics 对内容优先级的影响

最近完整 90 天主要市场展示来自美国、印度、菲律宾、英国、俄罗斯、德国、土耳其、越南、墨西哥、西班牙等；目前桌面展示远多于移动端。

主要查询：

- `translate pdf`
- `jpg to word`
- `convert jpg to word`
- `pdf translator`
- `translate pdf to english`
- `jpg to word converter`
- `translate pdf online free`

因此第一批不应平均修改 172 页，而应优先：

1. 英文首页。
2. 英文 `/jpg-to-word`。
3. 英文 `/pdf-to-text`。
4. `/ocrtranslator` 的英语和全部 locale 语义层。
5. 已有展示的俄语、希腊语、德语和西班牙语重点页。

## 3. SEO 信息架构计划

### 3.1 页面集群

| 集群         | 当前/计划页面                                | 用户任务                    | 处理原则                                                     |
| ------------ | -------------------------------------------- | --------------------------- | ------------------------------------------------------------ |
| PDF 翻译     | 首页、OCR Translator、上传/翻译流程          | 翻译文字型或扫描 PDF        | 首页解释价值；OCR 页专注扫描件工作流；内部功能页不抢首页意图 |
| OCR 提取     | PDF to Text、Image to Text、docs             | 从扫描件/图片提取可编辑文字 | 清楚区分“提取”和“翻译”，说明支持输入与输出                   |
| 文档转换     | JPG/Photo/PDF → Word、PDF → Excel/Markdown   | 将不可编辑内容变成具体格式  | 每页按真实文档场景写内容，不复制通用“AI OCR”段落             |
| 文档比较     | Contract Comparison、docs                    | 比较两份合同/文档差异       | 不伪装成完整 CLM；聚焦版本审阅和差异定位                     |
| PDF 基础工具 | 压缩、合并、拆分、页面管理等计划页面         | 直接处理 PDF 文件           | 功能验收前 noindex 且不进 sitemap                            |
| 信任与方法   | About、Privacy、Terms、Methodology、Security | 判断服务是否可信            | 提供主体、联系方式、处理流程、保留时间、限制和更新时间       |

### 3.2 页面唯一性最低要求

每个可索引工具页必须拥有：

1. 唯一 title、description 和 H1。
2. 明确的目标用户和文档场景。
3. 真实输入格式、大小/页数限制和登录要求。
4. 实际处理步骤，而不是同义关键词段落。
5. 输出格式和不可保证的边界。
6. 一份该任务特有的示例。
7. 与用户问题匹配的 FAQ。
8. 相关工具内链，但锚文本和描述必须本地化。
9. 数据处理和文件保留说明。
10. 最后验证日期和产品版本/事实来源。

## 4. GEO 策略

### 4.1 不把 GEO 当成特殊标签工程

Google 明确说明，进入 AI Overviews / AI Mode 没有额外技术要求，不需要特殊 AI 文件或特殊 schema；仍然依赖可索引、可抓取、内部链接、文本内容、页面体验和与可见内容一致的结构化数据。参考：[AI features and your website](https://developers.google.com/search/docs/appearance/ai-features)。

本项目的 GEO 工作重点应是：

- 提供可以直接回答问题的短结论。
- 让结论可由真实功能、测试或政策验证。
- 明确主体、作者、更新日期和方法。
- 对输入、输出、限制、成本和隐私给出精确值或清楚的动态来源。
- 公开原创示例、对比测试和失败边界。
- 让公开页面对 Googlebot、Bingbot、OAI-SearchBot 可访问。

当前 OAI-SearchBot 和 ChatGPT-User 访问首页均为 200，robots 通配规则允许公开页面。OpenAI 官方建议不要阻断 OAI-SearchBot，以便公开内容能够被发现、展示和引用。参考：[OpenAI Publishers and Developers FAQ](https://help.openai.com/en/articles/12627856)。

### 4.2 GEO 内容模块

每个核心工具页建议新增以下可见模块：

- “适合什么文档”：列出 3 个真实场景。
- “输入与输出”：格式、大小、页数、语言、输出文件。
- “工作原理”：3–5 步，不泄露安全敏感实现。
- “结果边界”：扫描质量、复杂表格、字体、手写、密码 PDF 等。
- “隐私与保留”：链接到当前政策，并显示政策更新时间。
- “实测示例”：测试文件类型、页数、耗时区间、结果截图和测试日期。
- “常见问题”：回答成本、登录、语言、格式、失败和删除。

### 4.3 品牌实体和出处

新增或完善：

1. About：产品目的、运营主体、团队/责任角色、联系方式。
2. Methodology：OCR/翻译/转换如何测试，哪些指标可公开。
3. Security & Data Processing：上传、传输、处理方、保留和删除。
4. Authors / Reviewers：博客和指南显示作者角色、审核人、更新时间。
5. Organization JSON-LD：使用真实 logo、url、联系点和真实外部 profile；没有真实 profile 时不要伪造 `sameAs`。
6. BlogPosting：补 `mainEntityOfPage`、publisher、author URL 等真实字段。
7. `llms.txt`：从统一事实配置生成或增加合同测试，不能手工维护另一套产品事实。

## 5. 多语言必须按场景本地化

### 5.1 定义

场景化本地化不是把英文句子逐句替换成目标语言，而是保持同一产品事实，根据目标用户的文档类型、任务、风险、搜索表达和语气重写内容。

每个 locale 的内容 brief 必须回答：

1. 谁在使用？
2. 他手里是什么文档？
3. 他在什么场景下使用？
4. 最大阻碍是什么？
5. 产品实际能完成什么？
6. 哪些情况不能承诺？
7. 用户下一步应该做什么？

### 5.2 语言场景矩阵

以下是内容方向，不是未经母语审核即可直接发布的最终文案：

| locale | 第一场景                 | 第二场景                 | 文案侧重点                                     | 需避免                                   |
| ------ | ------------------------ | ------------------------ | ---------------------------------------------- | ---------------------------------------- |
| en     | 研究论文/课程材料翻译    | 跨国团队报告与手册       | 清楚说明 text PDF 与 scanned PDF 两条流程      | “perfect”“fully preserves”绝对承诺       |
| zh     | 外文论文和技术资料转中文 | 跨境合同/产品说明书理解  | 强调扫描件识别、版式“尽可能保留”、文件删除时间 | 把简中、繁中、港澳台法律场景混成一个市场 |
| de     | 技术手册与供应商文件     | 学术 PDF、合同版本核对   | 精确、限制清晰、数据处理透明                   | 无变音符的机器式德语和不支持的挪威语词   |
| es     | 学术资料与跨境业务文件   | 扫描发票/报告提取        | 使用中性西语；先覆盖西班牙和拉美共同表达       | 把西班牙税务/法律术语泛化到整个西语市场  |
| fr     | 学术/专业文档            | 扫描件 OCR 与跨境资料    | 用清楚的法语工作流，避免英语模块               | 同一页面混用 France/Québec 特有制度词    |
| it     | 商务合同和供应商文档     | 学术/技术 PDF            | 强调可编辑输出和人工复核                       | 直译英语 CLM 营销词、缺少重音的机器文本  |
| el     | 学术材料和旅游/商务文件  | 扫描表格与说明           | 短句、准确术语、真实格式限制                   | 无重音希腊语和英文关键词堆叠             |
| ja     | 海外论文/技术规格书      | 英文合同、扫描资料       | 礼貌、步骤明确、强调最终人工确认               | 过度口语化、保证字体/表格 100% 保留      |
| ko     | 해외 논문/기술 자료      | 계약서 버전 및 스캔 문서 | 작업 결과와 크레딧/로그인 조건을 먼저说明      | 英文关联工具描述和不自然直译             |
| ru     | 技术手册/学术 PDF        | 合同、图片型文件         | 清楚区分 OCR、翻译、Word/Excel 输出            | 无法完成的“无需注册”和不支持语言承诺     |

### 5.3 页面场景模板

以“PDF 转文字”为例，所有语言保留相同事实字段，但正文按场景改写：

```text
用户：研究人员 / 财务人员 / 学生 / 法务人员
输入：扫描论文 / 发票 / 课堂资料 / 合同 PDF
任务：提取可编辑文字，而不是翻译或只看预览
痛点：无法复制、表格错位、扫描质量低
真实能力：OCR 后编辑和导出当前确实支持的格式
限制：模糊图片、复杂表格、手写、加密 PDF
信任：登录要求、积分、文件保留、删除方式
CTA：上传一个符合限制的 PDF 开始提取
```

禁止直接复制以下做法：

- 把英文关键词列表翻译后塞入 metadata。
- 所有语言使用相同 FAQ，只替换语言名称。
- 为了覆盖关键词虚构 Norwegian、无账号、无限表格、企业认证等能力。
- 用不可见、低透明度或与任务重复的小段落专门放关键词。
- 在不同语言保留英文关联工具卡片。

### 5.4 翻译生产流程

1. **事实锁定**：产品负责人确认功能事实表。
2. **场景 brief**：每个语言/页面先写目标用户、文档、任务、限制。
3. **关键词研究**：使用 GSC 实际查询和目标市场表达；不把搜索量写成未经来源的固定数字。
4. **本地化初稿**：允许 AI 辅助，但必须以 brief 和术语表为约束。
5. **功能核对**：开发/产品核对登录、费用、格式、语言、大小、保留时间。
6. **语言审核**：母语或专业审校检查自然度、术语和文化语境。
7. **页面 QA**：title、description、H1、正文、FAQ、按钮、错误提示全部检查。
8. **索引闸门**：未完成审核保持 noindex 或不进入 sitemap。
9. **上线复核**：检查 HTML 可见文本和 JSON-LD，不只检查 JSON 文件。
10. **GSC 观察**：部署后记录抓取时间、状态、展示、CTR 和查询变化。

### 5.5 自动化合同

新增 CI 检查：

- 所有 indexable locale 页面必须有独立 title、description、H1。
- locale JSON 键集合与英文/事实 schema 一致。
- 非英语内容不能出现白名单外的完整英文句子。
- 不支持语言名称不能出现在能力声明中。
- “无需注册”和“登录 required”不能同时出现在同一功能的内容集合。
- 所有内部绝对链接使用 apex，或改为 locale-aware 相对链接。
- frontmatter description 不能为空。
- 博客正文不能再包含第二个 H1。
- sitemap URL 的服务端 HTML 必须有且只有一个 H1。

## 6. 分阶段执行计划

### Phase A：事实与高风险陈述（第 0–2 天）

| 顺序 | 任务                | 文件/范围                                                    | 验收                                                         |
| ---: | ------------------- | ------------------------------------------------------------ | ------------------------------------------------------------ |
|   A1 | 建立产品功能事实表  | 新建内部事实文档；代码配置、价格、登录、格式、语言、保留时间 | 产品/开发共同确认，每个事实有代码或后台来源                  |
|   A2 | 清理 Norwegian      | common、首页 FAQ、SEO 指南和其他 14 个 locale 文件           | UI/metadata/FAQ 不再承诺 Norwegian；自动测试阻止回归         |
|   A3 | 清理 no-signup 冲突 | 26 个内容文件，对照实际登录流程                              | 每个工具只保留真实的“可免费试用/需登录/积分”说明             |
|   A4 | 重写合同对比定位    | 10 个 `contract-comparison.json` 和对应 docs                 | 聚焦文档版本比较；删除虚构 CLM、认证、Top 10 和企业能力      |
|   A5 | 标记旧 SEO 指南     | `seo-geo-guidelines.md`、`seo-backlink-strategy.md`          | 删除未经验证搜索量、虚构案例和不支持能力，或明确标记不可执行 |

回滚条件：如果事实无法确认，相关页面保持现状但立即 noindex，不用猜测性文案替换。

### Phase B：技术 On-page 修复（第 2–4 天）

| 顺序 | 任务                                        | 文件/URL                                         | 验收                                                                |
| ---: | ------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------- |
|   B1 | 为 OCR Translator 增加 SSR 语义区           | `ocrtranslator/page.tsx`、10 个 translate locale | 服务端 HTML 含唯一 H1、简短说明、输入/输出/限制；工作台功能不受影响 |
|   B2 | 为 OCR Translator 建独立 metadata namespace | 10 个 locale                                     | 与首页不重复；按扫描件 OCR 翻译意图本地化                           |
|   B3 | 补 4 个 docs description                    | es/fr/it/zh `pdf-to-text.*.mdx`                  | 生产 meta description 非空且与可见摘要一致                          |
|   B4 | 修博客双 H1                                 | 两个本地 Markdown 正文                           | 模板 H1 保留，正文从 H2 开始；172 页 H1 检查全部等于 1              |
|   B5 | 补 BlogPosting/OG                           | 博客 metadata 和 JSON-LD                         | 3 篇博客 OG 完整，publisher/author/url 使用真实信息                 |
|   B6 | 归一化 53 个 `www` 内链                     | blog/docs/legal 多语言内容                       | 公开内部链接不再经过主机重定向                                      |
|   B7 | 修首页 metadata 与 pricing schema           | 9 个首页、de/es/ru pricing                       | 语言键合同通过；不完整 pricing 继续 noindex                         |

### Phase C：第一批场景化内容（第 4–10 天）

优先顺序：

1. 英文首页、JPG to Word、PDF to Text、OCR Translator。
2. 俄语 Photo to Word / 首页 / JPG to Word。
3. 希腊语 Photo to Word / PDF to Text / JPG to Word。
4. 德语首页和核心翻译页。
5. 西语、意大利语、日语、韩语重点页。
6. 法语、中文其余核心页。

每一批只处理一个页面模板，并按以下步骤记录：

1. GSC 查询和页面基线。
2. 目标用户/文档/任务 brief。
3. 英文事实母版或共享事实字段。
4. 各市场场景化本地化。
5. 功能和母语审核。
6. CI、构建、页面 HTML 测试。
7. develop 部署和验证。
8. production 部署和验证。
9. URL Inspection 实时测试。
10. 一次请求索引和 D1/D3/D7/D14 复查。

### Phase D：GEO 实体与原创证据（第 2–3 周）

| 任务 | 交付物                              | 验收                                                                               |
| ---- | ----------------------------------- | ---------------------------------------------------------------------------------- |
| D1   | About / Methodology / Security 页面 | 主体、责任角色、联系、更新日期和事实可验证                                         |
| D2   | 原创样例库                          | 至少覆盖文字 PDF、扫描 PDF、表格、图片、合同；公开测试条件和边界                   |
| D3   | 作者/审核机制                       | 博客和指南显示真实作者角色、审核人和更新时间                                       |
| D4   | 结构化数据整理                      | Organization、WebSite、SoftwareApplication、BlogPosting、Breadcrumb 与可见内容一致 |
| D5   | `llms.txt` 合同测试                 | 语言、API、定价、保留时间与统一事实源一致                                          |
| D6   | AI crawler 回归                     | Googlebot、Bingbot、OAI-SearchBot 对公开页 200，私有/API 路由继续受控              |

### Phase E：监测和扩张（持续）

1. 每周 GSC API 对比。
2. 每周记录 PASS、非 PASS、新增问题、最近抓取时间。
3. 每周按页面和 locale 查看展示、点击、CTR、排名。
4. 建立自然搜索业务漏斗事件。
5. 一个模板验证有效后，再扩展到下一语言或新工具。
6. PDF 压缩/合并等新工具必须完成功能和内容闸门后才能 index。

## 7. 逐任务验收模板

每项修改至少保留以下证据：

```text
任务 ID：
目标页面 / locale：
用户场景：
修改前 GSC 数据：
修改前可见内容与功能事实：
本次事实来源：
本地化 brief：
修改文件：
自动测试：
人工语言审核：
develop 部署：
production 部署：
实时 HTTP / HTML：
URL Inspection live test：
Request indexing 日期：
D1 / D3 / D7 / D14：
最终结论：完成 / 回滚 / 等待重抓 / 继续内容整改
```

## 8. 完成标准

本轮 SEO/GEO/多语言整改不能以“文案已翻译”结束，必须满足：

- 功能事实统一且无不支持能力。
- 172 个可索引 URL 的服务端 HTML 均有唯一 title、description、H1 和 canonical。
- 非英语页面没有非必要英文正文。
- OCR Translator 不再与首页 metadata 重复。
- 合同对比页不再冒充完整 CLM 产品。
- 结构化数据与可见内容一致。
- 核心页面有真实场景、限制、示例和更新时间。
- Google 已抓取部署后的版本。
- GSC 技术型问题为 0；内容型未收录页均有明确处置。
- 能看到自然搜索从落地页到业务结果的完整漏斗。

Google建议以有帮助、可靠、以用户为先的内容为目标，而不是为了搜索流量批量生成主题和自动化内容。参考：[Creating helpful, reliable, people-first content](https://developers.google.com/search/docs/fundamentals/creating-helpful-content)。Google 也明确说明 `meta keywords` 不影响索引和排名，本项目后续不再以维护关键词 meta 为主要 SEO 工作。参考：[Google 支持的 meta tags](https://developers.google.com/search/docs/crawling-indexing/special-tags)。
