# TranslatePDFOnline 项目整改总表（SEO / GEO / GSC / 产品）

> 文档性质：长期维护的整改事实源（Living Document）  
> 首次建立：2026-10-21  
> 最后更新：2026-10-27
> 当前生产提交：`c49263ef`（包含内容修复 `2c9e859f`）
> 当前整改候选：`develop` / `31613085`，OCR 内容集群本地验证通过，待推送和 Cloudflare dev 部署
> 生产分支：`master`（仓库当前没有 `main` 远端分支）  
> 开发分支：`develop`  
> 逐步执行记录：[remediation-execution-log.md](./remediation-execution-log.md)
> GSC 控制台操作：[gsc-console-operation-guide.md](./gsc-console-operation-guide.md)  
> SEO/GEO/多语言专项计划：[seo-geo-multilingual-audit-plan.md](./seo-geo-multilingual-audit-plan.md)

## 1. 当前结论

### 1.1 一句话结论

上一批技术与内容修复已经进入生产。2026-10-27 的 GSC 官方 API 显示 PASS 从 131 增至 134、非 PASS 从 41 降至 38；当前 sitemap 快照也已从 213 刷新为 172，且 0 error、0 warning。**Google Search Console 问题尚未完全解决**：仍有 36 个“已抓取但尚未编入索引”和 2 个历史 canonical 状态，但 38 个页面的实时技术检查全部通过，因此后续重点已经从 canonical/robots 转为内容差异化和 Google 重抓验证。本轮已按内容集群扩充 10 种语言的 OCR 页面与指南，提交 `31613085` 待部署。

### 1.2 三层状态必须分开判断

| 证据层    | 当前状态                                                                                            | 结论                             |
| --------- | --------------------------------------------------------------------------------------------------- | -------------------------------- |
| 代码层    | `c49263ef` 已存在于生产与开发分支；`31613085` 完成第一批 OCR 内容集群扩充                           | 生产基线完成；新批次等待部署     |
| 生产站层  | 38 个当前非 PASS URL 全部返回 200、`index,follow`、单 H1、自引用 canonical；当前 sitemap 为 172 URL | 未发现新的技术索引故障           |
| Google 层 | GSC URL Inspection：134 PASS、38 非 PASS；4 个旧问题恢复、1 个新问题出现，部分页面重抓后仍未收录    | 有实际改善；内容质量整改继续执行 |

### 1.3 本轮基线

| 指标              | 修复前 2026-10-21 | 部署后 2026-10-21 | 复查 2026-10-27 | 解释                                                         |
| ----------------- | ----------------: | ----------------: | --------------: | ------------------------------------------------------------ |
| 审计 URL 数       |               213 |               172 |             172 | 当前提交集合保持稳定                                         |
| PASS              |               154 |               131 |             134 | 在相同 172 URL 口径下增加 3 个净 PASS                        |
| 非 PASS           |                59 |                41 |              38 | 当前为 36 个“已抓取但尚未编入索引”与 2 个 canonical 备用状态 |
| API 错误          |                 0 |                 0 |               0 | 三次审计均完整执行                                           |
| Sitemap submitted |               213 |               213 |             172 | GSC 已在 2026-10-21 重新读取新 sitemap                       |
| 线上技术检查      |        未作为基线 |      172/172 通过 |      38/38 通过 | 当前非 PASS 页没有状态码、robots、canonical 或 H1 技术故障   |

本次 GSC Sitemap API 返回 `submitted=172`、`indexed=0`、0 error、0 warning，`lastDownloaded=2026-10-21T06:59:18.394Z`。Google 官方已把 `contents[].indexed` 标记为 deprecated / do not use，因此 `indexed=0` 仍不能解释为“站点 0 个页面被索引”。后续继续以当前 sitemap、URL Inspection 明细和 GSC Pages 导出为判断依据。参考：[Search Console Sitemap API 字段定义](https://developers.google.com/webmaster-tools/v1/sitemaps)。

### 1.4 Search Analytics 现状

| 时间窗                                     | 点击 |  展示 |   CTR | 备注            |
| ------------------------------------------ | ---: | ----: | ----: | --------------- |
| 最近完整 28 天（2026-09-27 至 2026-10-24） |   17 | 1,187 | 1.43% | 页面维度 59 行  |
| 最近完整 90 天（2026-07-27 至 2026-10-24） |   57 | 9,734 | 0.59% | 页面维度 135 行 |

主要机会词仍处于较低排名：`translate pdf`、`jpg to word`、`convert jpg to word`、`pdf translator`、`translate pdf to english` 等。历史数据中仍存在 `www` URL 的展示，应观察 canonical/重定向修复后是否持续衰减，不应删除历史数据或把它当成当前线上输出。

## 2. 审计范围和证据

本结论基于以下四类证据：

1. 仓库与分支：本地和远端分支指向、提交内容、构建配置。
2. Cloudflare 部署：生产 Web Worker、生产队列 Worker、开发 Web Worker、开发队列 Worker 的构建检查均成功。
3. 生产 HTTP：重定向、状态码、robots、canonical、`hreflang`、HTML `lang`、站点地图、安全配置泄露检查。
4. GSC 官方 API：站点权限、Sitemap、URL Inspection 和 Search Analytics。

本次只执行了 GSC 读取和诊断，没有代替站点所有者执行“重新提交站点地图”“请求编入索引”或“验证修复”等控制台写操作。

临时审计产物（不提交仓库，机器重启后可能失效）：

- 修复前：`/tmp/translatepdfonline-gsc-2026-10-21-live-api`
- 生产部署后：`/tmp/translatepdfonline-gsc-2026-10-21-after-main-bf2a3192`
- 2026-10-27 复查：`/tmp/translatepdfonline-gsc-2026-10-27-after-production-c49263ef-retry`
- 最新报告完整性验证：通过，172 个 URL、172 条 Inspection、无敏感值写入报告。

## 3. 已确认问题总表

状态定义：`已完成`、`执行中`、`待执行`、`等待外部刷新`、`需站点所有者操作`、`待验证`。

| ID       | 优先级 | 问题                                                    | 证据与影响                                                                                                                 | 处理要求 / 验收标准                                                                                       | 状态                                       |
| -------- | ------ | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| SEC-001  | P0     | GSC 服务账号密钥需要轮换                                | 密钥曾在诊断过程的工具输出中暴露；即使未进入 Git，也不能继续视为安全                                                       | 在 Google Cloud 撤销旧密钥、创建新密钥、更新本地/部署密钥；验证 GSC API 可读；确认 Git 历史与产物不含密钥 | 需站点所有者操作                           |
| SEO-001  | P0     | GSC 仍有 38 个非 PASS URL                               | 36 个“已抓取但尚未编入索引”，2 个 canonical 备用页；较 10 月 21 日净减少 3 个                                              | 对重抓后仍未收录页面执行内容聚类整改；部署后按 D1/D3/D7/D14 复查                                          | 执行中                                     |
| CNT-001  | P0     | 多语言营销口径存在过时或未经验证的声明                  | 多语言内容曾包含“No sign-up”、固定赠送、语言数量、Norwegian 和产品能力冲突，可能造成失实、转化损失和 GEO 可信度下降        | 建立功能事实表；所有语言逐项对齐实际产品；自动测试阻止免登录、固定赠送、不支持语言和 `www` 内链回归       | 已完成；持续合同测试                       |
| CNT-005  | P0     | 动态积分和费率被静态文案写死                            | 顶部横幅固定承诺注册送 30 积分，pricing/API docs/FAQ 固定写 10 积分/页，但实际由后台和运行时配置决定                       | 横幅只在赠送开启且数量有效时显示；费率从运行时配置注入；静态内容不再保证固定值                            | 已完成                                     |
| SEO-002  | P0     | 9 个非英语首页缺少页面级 metadata                       | 非英语 `pages/index.json` 原先缺 `metadata.title`、`description`，依赖通用回退，搜索意图不够精准                           | 9 个语言补齐独立、自然、本地化 metadata；构建和页面检查通过；不得机械直译或堆词                           | 已完成                                     |
| SEO-006  | P0     | OCR Translator 缺独立 metadata 和服务端 H1              | 独立 metadata、H1 已进入生产；GSC 仍有西/日/俄 OCR 页面未收录，当前正文偏薄                                                | `31613085` 扩充 10 个 locale 的流程、校对、输出、隐私、FAQ 与指南；部署后复查                             | 执行中，等待部署                           |
| CNT-004  | P0     | 合同对比页超出真实产品能力定位                          | 原内容使用完整 CLM、企业认证、Top 10 和未经证实的效率承诺                                                                  | 聚焦两份文档差异对比；移除未经证实能力；明确人工复核边界                                                  | 已完成                                     |
| I18N-001 | P1     | 德/西/俄 pricing 文案仍是旧数据结构                     | 当前通过英文现行结构回退并 noindex/退出站点地图避免错误曝光；本批已将所有 locale 的每页费率改为运行时注入                  | 继续重写三种语言 pricing 结构；通过键集合自动校验；页面内容、价格、功能与实际系统一致后才允许 index       | 执行中                                     |
| SEO-003  | P1     | 36 个“已抓取但尚未编入索引”仍有内容同质化风险           | 38 个非 PASS 页实时技术核验全部通过；`/de/pdf-to-text`、`/es/docs`、`/fr/docs`、`/it`、`/it/pricing`、`/ja` 重抓后仍未收录 | 按一个模板一个批次扩充真实场景、步骤、限制、输出和 FAQ；首批 OCR 集群已完成本地实现                       | 执行中                                     |
| SEO-004  | P1     | 2 个 canonical 历史状态尚未刷新                         | `/docs/ocr-workbench` 与 `/docs/upload` 已恢复；当前仅 `/contract-comparison`、`/ko/docs` 保留旧状态                       | 保持当前 200、自引用 canonical 和单跳主机重定向；请求重抓后观察                                           | 等待外部刷新                               |
| SEO-005  | P1     | GSC Sitemap 快照曾显示 213 个 URL                       | 2026-10-27 API 已显示 `submitted=172`、0 error、0 warning                                                                  | 保持现有 sitemap；只有内容/路由变更后重新提交，不删除成功记录                                             | 已完成                                     |
| SEO-007  | P1     | docs/blog 标签和结构不完整                              | 4 个 docs description、博客双 H1 与 OG/BlogPosting 已修复并进入生产                                                        | 保持合同测试；新文档发布时强制 description 与单 H1                                                        | 已完成                                     |
| SEO-008  | P1     | 公开内容曾包含 `www` 绝对内链                           | 已归一化为 apex，并有自动测试防止回归                                                                                      | 持续执行内容合同                                                                                          | 已完成                                     |
| I18N-002 | P1     | 非英语合同对比页曾有英文残留                            | 关联内容已本地化并进入生产                                                                                                 | 继续母语抽样复核                                                                                          | 已完成；待母语复核                         |
| CNT-002  | P1     | 多语言 docs/工具页存在模板化和价值不足风险              | 非 PASS URL 大量集中在同一类模板；OCR 页面与指南内容体量最薄                                                               | 每页增加该语言真实场景、步骤、输入限制、输出、常见错误和 FAQ；OCR 内容集群首批已完成                      | 执行中                                     |
| PROD-001 | P1     | PDF 工具覆盖面不足                                      | 当前偏翻译/OCR/转换，缺少压缩、合并、拆分、旋转/整理等高频基础需求                                                         | 按“功能可用 → 隐私/质量验收 → 内容完善 → 允许索引 → 加入 sitemap”顺序上线，禁止先发布空壳 SEO 页面        | 待执行                                     |
| GEO-001  | P1     | GEO 内容缺少稳定的事实、实体和出处体系                  | 当前指南混入未经复核的搜索量和能力描述；AI 答案引用需要清晰事实、作者/组织、更新时间和可验证来源                           | 建立品牌/功能事实页、编辑规范、更新日期、来源策略；结构化数据必须与可见内容一致                           | 待执行                                     |
| MEAS-001 | P1     | SEO 流量尚未形成“落地页 → 上传 → 完成 → 付费”的统一漏斗 | GSC 只有搜索曝光/点击，不能解释业务结果                                                                                    | 定义并核对分析事件；按 landing page、locale、query cluster 形成周报；明确转化率而非只看收录数             | 待验证                                     |
| ENG-001  | P2     | GSC 审计尚未形成定期回归                                | 已有 CLI，但当前主要依赖人工触发                                                                                           | 每周只读全量审计并保存脱敏摘要；新增异常数、canonical 漂移、站点地图差异触发告警                          | 待执行                                     |
| ENG-002  | P2     | “main / master”口径不一致                               | 用户操作描述为 main，但远端实际生产分支是 `master`，容易推错或误判部署                                                     | Cloudflare、README、交付文档统一写明生产分支；若迁移到 main，需一次性同步仓库默认分支和 CF 构建配置       | 待执行                                     |
| ENG-003  | P2     | ESLint 9 缺少可执行配置                                 | `pnpm lint` / 独立 ESLint 命令找不到 `eslint.config.js`、`.mjs` 或 `.cjs`；生产构建内置检查和 TypeScript 仍通过            | 增加兼容 ESLint 9 的配置并在 CI 固定执行；修复前不得把“lint 未执行”写成“lint 通过”                         | 待执行                                     |
| PERF-001 | P2     | 前端首屏资源偏大，需要独立性能基线                      | 构建输出中根路由首载约 376 KB，部分聊天页面约 512 KB；尚无本轮真实用户 CWV 结论                                            | 先采集移动/桌面 PSI 与真实 CWV，再按 route bundle、第三方脚本、图片、字体拆解；以 LCP/INP/CLS 验收        | 待验证                                     |

## 4. 已完成的技术修复

提交 `bf2a3192` 已完成并部署：

- 收敛可索引路由，站点地图只发布满足条件的页面和语言组合。
- 修复双重语言路径、`hreflang` 和 canonical 生成逻辑。
- apex / `www` / HTTP 归一化为 HTTPS apex，路径和查询参数保留。
- 对内容不完整的 blog、API docs、部分 pricing 页面执行 noindex 或退出站点地图。
- 收紧 robots 规则，避免 API、管理后台、账号、聊天等内部路由进入索引。
- 防止服务端敏感配置进入公共页面输出。
- 增加 sitemap 和第三方脚本相关自动测试。

生产验收结果：

- 当前站点地图 `<loc>`：172。
- 172/172 页面：HTTP 200、`index, follow`、HTML 语言正确、自引用 canonical 正确。
- 双重 locale alternate：0。
- 页面公开输出中的敏感配置命中：0。
- HTTP 和 `www` 深层 URL：单跳 301，路径与查询参数均保留。
- 生产/开发 Web 与队列的四项 Cloudflare 检查：全部成功。

## 5. 产品内容与市场缺口

当前项目已经覆盖 PDF 翻译、PDF 转文字、图片转文字、JPG/图片转 Word、PDF 转 Word/Excel/Markdown、OCR 翻译、合同对比等方向，但缺少完整的 PDF 基础处理链。

市场交叉验证：Smallpdf、iLovePDF、Adobe Acrobat 的官方工具目录都把“压缩、合并、拆分、PDF 与图片转换、页面整理/旋转”作为核心工具，并进一步覆盖水印、页码、保护/解锁、编辑、表单和签名。参考：[Smallpdf 工具目录](https://smallpdf.com/pdf-tools)、[iLovePDF 工具目录](https://www.ilovepdf.com/)、[Adobe Acrobat 在线工具](https://www.adobe.com/acrobat/online.html)。

### 5.1 产品波次

| 波次   | 建议工具                                                | 选择原因                                                       | 上线前置条件                                                            |
| ------ | ------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Wave 1 | PDF 压缩、PDF 合并、PDF 拆分、旋转/重排/删除/提取页面   | 三家头部产品共同覆盖；任务明确、可形成内部工具链和高意图落地页 | 真实处理能力、文件大小/页数限制、失败恢复、删除策略、安全说明、质量测试 |
| Wave 2 | PDF 转 JPG、JPG 转 PDF、加水印、添加页码、保护/解锁 PDF | 补齐格式转换和文档交付场景；可与现有 OCR/Word/Excel 页互链     | 密码与加密边界、版权/隐私文案、输出一致性、多语言帮助内容               |
| Wave 3 | 填写/签名、编辑/批注、裁剪/脱敏、扫描/OCR               | 复杂度和合规风险更高，但能提升用户留存与商业价值               | 明确是否本地/云处理、签名法律边界、审计与日志策略、浏览器兼容性         |

### 5.2 新页面发布闸门

任何新工具页面都按以下状态推进：

`规划中（无公开页） → 内测（鉴权或 noindex） → 功能 Beta（noindex） → 功能/内容/隐私验收 → index,follow → 加入 sitemap → GSC 验证`

必须同时满足以下条件才能进入 sitemap：

1. 核心任务可以从上传到下载完整执行，不是等待名单或伪功能。
2. 标题、描述、H1、正文、FAQ 与真实功能一致。
3. 有独特的使用说明、限制、失败处理和输出示例，而非替换关键词的模板页。
4. canonical、`hreflang`、结构化数据、robots、状态码通过自动测试。
5. 说明文件保存时间、删除策略、是否上传到第三方以及用户责任。
6. 至少完成英文和目标语言的人工质量抽检。

## 6. 分阶段精细执行计划

### Phase 0：安全与口径锁定（当天）

| 任务     | 操作                                                                                 | 验证与完成条件                                                   |
| -------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| SEC-001  | 撤销曾暴露的 GCP 服务账号旧密钥，创建新密钥，更新本地安全存储和需要使用它的部署环境  | 旧密钥失效；新密钥能只读访问 GSC；仓库、Git 历史和审计产物无密钥 |
| ENG-002  | 明确当前生产分支为 `master`，核对 Cloudflare 生产分支设置；决定是否未来迁移到 `main` | 文档、仓库默认分支、CF 设置三者一致；禁止只改其中一处            |
| CNT-FACT | 新建“产品功能事实表”：注册要求、免费额度、语言、输出格式、数据保留、第三方处理、价格 | 产品负责人确认；后续页面只引用事实表，不自由发挥                 |

### Phase 1：GSC 稳定期（部署后第 0–14 天）

| 时间 | 操作                                                                                                                                                                                                | 目标 / 验收                                                                                                                                                                                                 |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D0   | 在 GSC 的 domain property 中重新提交现有 `/sitemap.xml`，不要删除属性或历史 sitemap 记录                                                                                                            | GSC 显示新的读取时间；无解析错误                                                                                                                                                                            |
| D0   | URL Inspection 实时测试代表 URL：`/contract-comparison`、`/docs/upload`、`/docs/ocr-workbench`、`/ko/docs`，以及高价值的 `/es/jpg-to-word`、`/fr/pdf-to-text`、`/it/jpg-to-word`、`/ja/pdf-to-text` | 实时测试看到 200、可索引、apex canonical；当前只对内容已通过的 docs 代表 URL 请求索引，`/contract-comparison` 和高价值工具页完成内容整改后再请求。Google 明确说明重复请求不会加快抓取，且请求抓取不保证收录 |
| D1   | 运行只读 GSC 全量审计                                                                                                                                                                               | 保存 PASS/非 PASS、最后抓取时间和新问题数                                                                                                                                                                   |
| D3   | 重复审计并比较 D1                                                                                                                                                                                   | 至少出现部分部署后抓取；若为 0，继续等待，不反复改代码                                                                                                                                                      |
| D7   | 按状态和模板分组复核                                                                                                                                                                                | canonical 类应开始减少；内容类仍未收录的进入 Phase 3                                                                                                                                                        |
| D14  | 形成稳定期结论                                                                                                                                                                                      | 技术型问题为 0；无新增错误；剩余 URL 有明确的内容整改或 noindex 决策                                                                                                                                        |

GSC 关闭标准：不能只看部署成功。必须至少满足：

- 代表 URL 的最近抓取时间晚于 `2026-10-21 05:49 UTC` 的生产部署时间。
- 不再出现由错误 canonical、双 locale、noindex 冲突、重定向链或 5xx 引起的问题。
- 当前 sitemap 与 GSC 读取口径一致或有可解释的刷新延迟。
- 剩余未收录 URL 已逐条做“增强内容 / 合并 canonical / noindex / 删除”的明确决定。

### Phase 2：内容事实与国际化结构（第 1 周）

1. 完成 CNT-FACT，以实际代码、价格配置和业务规则为证据。
2. 全局检索并修正“No sign-up”、语言数量、Norwegian、导出能力、免费/隐私承诺等陈述。
3. 为 9 个非英语首页补齐本地化 metadata；标题优先表达任务，不机械堆叠同义词。
4. 重写德语、西班牙语、俄语 pricing 数据，使其与英文当前键结构一致。
5. 新增 i18n 合同测试：页面级 metadata 必填、键集合差异为 0、不得静默回退到英文 pricing。
6. 每个目标语言抽样检查首页、主工具页、pricing、docs，记录审阅人和日期。

验收：构建、类型、SEO 测试、i18n 合同测试通过；可见内容与事实表一致；不完整页面继续 noindex。

### Phase 3：37 个“已抓取但尚未编入索引”页面（第 1–2 周）

1. 按 `locale × 页面模板 × 搜索意图` 聚类，而不是 37 页逐页盲改。
2. 优先级按“已有展示/点击 → 商业价值 → 内容完善成本”排序。
3. 对每个聚类对比标题、H1、正文、FAQ、示例和内部链接，识别仅翻译或高度重复部分。
4. 增加目标市场真实使用场景、输入/输出示例、错误处理、限制、隐私说明和相关工具链。
5. 每轮只修改一个聚类，部署后保留前后快照，等待重抓，不在等待期连续改写同一 URL。
6. 两轮后仍无展示且无独立价值的页面，选择 canonical 合并或 noindex/退出 sitemap。

验收：每个 URL 有明确决策、内容差异证据、部署记录和 GSC 后续结果；不以“页面字数增加”作为唯一完成标准。

### Phase 4：PDF 工具产品扩展（第 2–6 周）

建议按功能闭环而非页面数量交付：

1. Sprint A：压缩 + 合并。
2. Sprint B：拆分 + 页面旋转/重排/删除/提取。
3. Sprint C：PDF ↔ JPG + 水印/页码。
4. Sprint D：保护/解锁；再评估编辑、签名和表单。

每个 Sprint 都包括后端处理、前端交互、限制与错误、隐私说明、英语内容、本地化计划、自动测试、性能测试、SEO 发布闸门和 GSC 观察，不允许把“新增路由”当作工具完成。

### Phase 5：GEO 与权威性建设（第 3–8 周，和 Phase 4 并行）

1. 建立 About/品牌事实、隐私处理、支持渠道、更新时间和编辑责任。
2. 为工具页增加可直接回答问题的短定义、步骤、输入/输出限制、FAQ；答案必须与可见功能一致。
3. 使用与页面内容一致的 SoftwareApplication、FAQ、Breadcrumb 等结构化数据；不能标记页面上不存在的内容。
4. 为核心工作流制作原创对比/测试材料，例如不同压缩档位、OCR 语言效果、表格提取边界，并公开方法。
5. 外链工作以产品目录、教育/文档场景合作、原创研究引用为主，禁止批量低质目录和购买链接。
6. `llms.txt` 只做辅助发现，不把它当成排名或引用保证。

### Phase 6：度量与例行回归（持续）

周报最少包含：

- 当前 sitemap URL 数、HTTP/可索引通过数。
- GSC PASS、各非 PASS 状态、新增/恢复 URL、最近抓取是否晚于部署。
- 自然搜索点击、展示、CTR、平均排名，按页面/查询/国家/设备拆分。
- `www` 历史展示占比和 canonical 异常趋势。
- 自然落地页的上传开始、处理成功、下载、注册和付费转化（完成 MEAS-001 后）。
- 新工具从 noindex 到 index 的闸门状态。

## 7. 单任务执行模板

后续每执行一步，都必须先在[执行日志](./remediation-execution-log.md)新增记录，并按以下顺序填写：

1. `任务 ID / 日期 / 执行人 / 当前状态`。
2. 问题与预期结果，明确本次只处理什么。
3. 修改前证据：URL、GSC 状态、文件、截图或报告路径。
4. 变更内容与影响范围。
5. 本地验证：测试、构建、静态检查。
6. 部署证据：分支、提交、Cloudflare 构建和时间。
7. 生产验证：状态码、HTML 标签、功能结果。
8. GSC 验证：最近抓取时间、coverage、canonical、Search Analytics。
9. 验收结论：完成 / 回滚 / 等待外部刷新 / 进入下一任务。
10. 后续动作和检查日期。

没有达到验收条件时不得写“已完成”；Google 尚未重抓时统一写“等待外部刷新”。

## 8. 当前 38 个 GSC 非 PASS URL

### 8.1 2026-10-27 官方 API 当前状态

`Alternate page with proper canonical tag`（2）：

- `/contract-comparison`
- `/ko/docs`

`Crawled - currently not indexed`（36）：

- 德语（7）：`/de/contract-comparison`、`/de/docs`、`/de/docs/image-to-text`、`/de/docs/ocr-workbench`、`/de/docs/pdf-to-text`、`/de/image-to-text`、`/de/pdf-to-text`
- 西语（8）：`/es`、`/es/contract-comparison`、`/es/docs`、`/es/docs/pdf-to-text`、`/es/jpg-to-word`、`/es/ocrtranslator`、`/es/pdf-to-excel`、`/es/pdf-to-md`
- 法语（4）：`/fr/contract-comparison`、`/fr/docs`、`/fr/jpg-to-word`、`/fr/pdf-to-text`
- 意大利语（8）：`/it`、`/it/docs`、`/it/docs/contract-comparison`、`/it/jpg-to-word`、`/it/pdf-to-excel`、`/it/pdf-to-md`、`/it/pdf-to-word-doc`、`/it/pricing`
- 日语（5）：`/ja`、`/ja/contract-comparison`、`/ja/docs`、`/ja/ocrtranslator`、`/ja/pricing`
- 俄语（4）：`/ru/docs`、`/ru/docs/upload`、`/ru/ocrtranslator`、`/ru/pdf-to-excel`

相对 2026-10-21：

- 已恢复：`/docs/ocr-workbench`、`/docs/upload`、`/es/docs/ocr-workbench`、`/ja/pdf-to-text`。
- 新出现：`/de/docs/ocr-workbench`。
- 重抓后仍未收录：`/de/pdf-to-text`、`/es/docs`、`/fr/docs`、`/it`、`/it/pricing`、`/ja`。
- 38/38 当前线上页面技术核验通过；没有需要再次修改 canonical、robots 或状态码的证据。

### 8.2 2026-10-21 历史基线（41）

以下表格保留为上一次审计基线，不代表当前数量；当时各 URL 的抓取均发生在对应生产修复前。

|   # | URL 路径                       | coverageState                            | 最后抓取（UTC） | 当前处置                                       |
| --: | ------------------------------ | ---------------------------------------- | --------------- | ---------------------------------------------- |
|   1 | `/contract-comparison`         | Alternate page with proper canonical tag | 2026-08-10      | 保持当前 apex 自引用 canonical，等待重抓       |
|   2 | `/de/contract-comparison`      | Crawled - currently not indexed          | 2026-10-08      | 内容聚类整改候选                               |
|   3 | `/de/docs`                     | Crawled - currently not indexed          | 2026-08-27      | 内容聚类整改候选                               |
|   4 | `/de/docs/image-to-text`       | Crawled - currently not indexed          | 2026-10-11      | 内容聚类整改候选                               |
|   5 | `/de/docs/pdf-to-text`         | Crawled - currently not indexed          | 2026-10-11      | 内容聚类整改候选                               |
|   6 | `/de/image-to-text`            | Crawled - currently not indexed          | 2026-10-11      | 内容聚类整改候选                               |
|   7 | `/de/pdf-to-text`              | Crawled - currently not indexed          | 2026-10-14      | 内容聚类整改候选                               |
|   8 | `/docs/ocr-workbench`          | Alternate page with proper canonical tag | 2026-08-01      | 检查历史 `www` 信号，等待重抓                  |
|   9 | `/docs/upload`                 | Alternate page with proper canonical tag | 2026-08-12      | 检查历史 `www` 信号，等待重抓                  |
|  10 | `/es`                          | Crawled - currently not indexed          | 2026-08-04      | 首页 metadata + 内容质量                       |
|  11 | `/es/contract-comparison`      | Crawled - currently not indexed          | 2026-08-26      | 内容聚类整改候选                               |
|  12 | `/es/docs`                     | Crawled - currently not indexed          | 2026-10-13      | 内容聚类整改候选                               |
|  13 | `/es/docs/ocr-workbench`       | Crawled - currently not indexed          | 2026-10-16      | 内容聚类整改候选                               |
|  14 | `/es/docs/pdf-to-text`         | Crawled - currently not indexed          | 2026-10-06      | 内容聚类整改候选                               |
|  15 | `/es/jpg-to-word`              | Crawled - currently not indexed          | 2026-08-30      | 高价值代表 URL，优先实时测试                   |
|  16 | `/es/ocrtranslator`            | Crawled - currently not indexed          | 2026-10-18      | 内容聚类整改候选                               |
|  17 | `/es/pdf-to-excel`             | Crawled - currently not indexed          | 2026-08-27      | 内容聚类整改候选                               |
|  18 | `/es/pdf-to-md`                | Crawled - currently not indexed          | 2026-08-27      | 内容聚类整改候选                               |
|  19 | `/fr/contract-comparison`      | Crawled - currently not indexed          | 2026-08-27      | 内容聚类整改候选                               |
|  20 | `/fr/docs`                     | Crawled - currently not indexed          | 2026-10-13      | 内容聚类整改候选                               |
|  21 | `/fr/jpg-to-word`              | Crawled - currently not indexed          | 2026-10-17      | 内容聚类整改候选                               |
|  22 | `/fr/pdf-to-text`              | Crawled - currently not indexed          | 2026-10-14      | 高价值代表 URL，优先实时测试                   |
|  23 | `/it`                          | Crawled - currently not indexed          | 2026-10-20      | 首页 metadata + 内容质量                       |
|  24 | `/it/docs`                     | Crawled - currently not indexed          | 2026-09-16      | 内容聚类整改候选                               |
|  25 | `/it/docs/contract-comparison` | Crawled - currently not indexed          | 2026-10-17      | 内容聚类整改候选                               |
|  26 | `/it/jpg-to-word`              | Crawled - currently not indexed          | 2026-10-19      | 高价值代表 URL，优先实时测试                   |
|  27 | `/it/pdf-to-excel`             | Crawled - currently not indexed          | 2026-09-07      | 内容聚类整改候选                               |
|  28 | `/it/pdf-to-md`                | Crawled - currently not indexed          | 2026-10-18      | 内容聚类整改候选                               |
|  29 | `/it/pdf-to-word-doc`          | Crawled - currently not indexed          | 2026-10-09      | 内容聚类整改候选                               |
|  30 | `/it/pricing`                  | Crawled - currently not indexed          | 2026-10-20      | 先核对价格事实和本地化内容                     |
|  31 | `/ja`                          | Crawled - currently not indexed          | 2026-10-18      | 首页 metadata + 内容质量                       |
|  32 | `/ja/contract-comparison`      | Crawled - currently not indexed          | 2026-10-08      | 内容聚类整改候选                               |
|  33 | `/ja/docs`                     | Crawled - currently not indexed          | 2026-09-26      | 内容聚类整改候选                               |
|  34 | `/ja/ocrtranslator`            | Crawled - currently not indexed          | 2026-10-18      | 内容聚类整改候选                               |
|  35 | `/ja/pdf-to-text`              | Crawled - currently not indexed          | 2026-10-16      | 高价值代表 URL，优先实时测试                   |
|  36 | `/ja/pricing`                  | Crawled - currently not indexed          | 2026-09-05      | 先核对价格事实和本地化内容                     |
|  37 | `/ko/docs`                     | Alternate page with proper canonical tag | 2026-07-01      | 历史 canonical 曾落到 `/ko`，等待重抓          |
|  38 | `/ru/docs`                     | Crawled - currently not indexed          | 2026-09-04      | 内容聚类整改候选                               |
|  39 | `/ru/docs/upload`              | Crawled - currently not indexed          | 2026-08-28      | 内容聚类整改候选                               |
|  40 | `/ru/ocrtranslator`            | Crawled - currently not indexed          | 2026-07-01      | 内容聚类整改候选                               |
|  41 | `/ru/pdf-to-excel`             | Crawled - currently not indexed          | 2026-08-12      | 历史 `www` canonical，等待重抓后再判定内容问题 |

## 9. 已从当前 sitemap 移除的 18 个历史非 PASS URL

这些 URL 不再属于当前 172 个提交集合，不应与“当前仍需争取索引”的 41 个 URL 混为一谈：

- `/de/blog`、`/de/docs/api`、`/de/privacy-policy`
- `/es/pricing`、`/es/privacy-policy`、`/es/terms-of-service`
- `/fr/privacy-policy`、`/fr/terms-of-service`
- `/it/blog`、`/it/privacy-policy`、`/it/terms-of-service`
- `/ja/docs/api`、`/ja/privacy-policy`、`/ja/terms-of-service`
- `/ru/docs/api`、`/ru/pricing`、`/ru/privacy-policy`、`/ru/terms-of-service`

移出 sitemap 不等于从互联网删除。后续必须逐页决定：保持 noindex、补齐内容后重新发布、canonical 合并，或返回符合语义的 404/410；不得仅为了减少 GSC 报错而隐藏有价值页面。

## 10. 数据限制与后续取证

- URL Inspection API 只能检查给定 URL，不能直接枚举 GSC Pages 报告中的全部示例 URL。
- 若需覆盖全部 Pages 问题 URL，应从 GSC 页面索引报告导出 CSV，并与当前 sitemap、路由和 API 结果做差集。
- Search Analytics 是聚合数据，近期天数可能因数据新鲜度出现小幅变化；报告必须记录查询时间窗和执行时间。
- “已抓取但尚未编入索引”不是单一技术错误。只有在 Google 重抓当前版本后，才能区分刷新延迟、内容质量、重复内容或搜索需求不足。
- 市场工具列表只用于定义产品覆盖差距，不等于关键词量或商业优先级；实际 Sprint 还需结合搜索数据、处理成本、合规和转化验证。

## 11. 下一个推荐执行顺序

1. `SEC-001`：立即轮换 GCP 服务账号密钥。
2. 将 OCR 内容集群提交 `31613085` 推送到 `develop`，等待 Cloudflare dev 构建后抽查 10 个 locale 的可见正文和 FAQ JSON-LD。
3. 生产发布后，对 `/de/docs/ocr-workbench`、`/es/ocrtranslator`、`/ja/ocrtranslator`、`/ru/ocrtranslator` 做实时测试，并各请求一次收录。
4. 第二个内容模板处理多语言 docs 首页，优先覆盖已重抓仍未收录的 `/es/docs`、`/fr/docs`，同时增强德/意/日/俄 docs 首页的任务导航和场景差异。
5. 第三个内容模板处理意大利语、日语首页；pricing 单独处理，不与首页批次混合。
6. `I18N-001`：完成德/西/俄 pricing 现行 schema，再统一整改意大利语和日语 pricing 内容。
7. 每次生产部署后按 D1/D3/D7/D14 复跑 GSC，记录 `lastCrawlTime`，只在新抓取后判断内容批次效果。
8. Wave 1 的 PDF 压缩、PDF 合并必须先做真实功能闭环，再发布可索引内容页；当前不创建空壳 SEO 页面。

## 12. 2026-10-21 SEO / GEO / 多语言追加审计

追加的 172 页内容层审计发现：

- OCR Translator 的 10 个 locale 服务端 HTML 都没有 H1，并与首页共用 metadata。
- 4 个多语言 PDF to Text docs 缺 description。
- 两篇本地博客产生双 H1，3 篇生产博客缺 og:title。
- 9 个非英语合同对比页仍显示英文关联工具说明。
- 公开内容还有 53 处 `www` 绝对内链。
- 26 个内容文件出现“无需注册/无需账号”类陈述，同时产品内容有 54 处明确登录要求。
- 14 个 locale 内容文件提到 Norwegian，但实际支持语言配置不包含 Norwegian。
- 合同对比页面大量使用完整 CLM、Top 10、企业认证等超出实际文档对比能力的陈述。

详细证据、优先级、场景化翻译规范和执行批次以 [SEO / GEO / 多语言场景化审计与执行计划](./seo-geo-multilingual-audit-plan.md) 为准。GSC 控制台的逐步点击操作以 [GSC 控制台操作手册](./gsc-console-operation-guide.md) 为准。
