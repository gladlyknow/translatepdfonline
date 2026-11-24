# TranslatePDFOnline 项目整改总表（SEO / GEO / GSC / 产品）

> 文档性质：长期维护的整改事实源（Living Document）  
> 首次建立：2026-10-21  
> 最后更新：2026-11-24
> 当前生产提交：`6ef2b1c8`（`master`、`develop` 与远端当前一致）
> 当前整改候选：本地 `develop` 工作树，尚未提交或部署
> 生产分支：`master`（仓库当前没有 `main` 远端分支）  
> 开发分支：`develop`  
> 逐步执行记录：[remediation-execution-log.md](./remediation-execution-log.md)
> GSC 控制台操作：[gsc-console-operation-guide.md](./gsc-console-operation-guide.md)  
> SEO/GEO/多语言专项计划：[seo-geo-multilingual-audit-plan.md](./seo-geo-multilingual-audit-plan.md)

## 0. 2026-11-24 最新状态（覆盖下方历史基线）

### 0.1 GSC 官方 API 基线

| 指标                     | 2026-11-02 | 2026-11-24 | 变化 |
| ------------------------ | ---------: | ---------: | ---: |
| sitemap URL / Inspection |        172 |        172 |    0 |
| PASS                     |        153 |        128 |  -25 |
| 非 PASS                  |         19 |         44 |  +25 |
| API 错误                 |          0 |          0 |    0 |
| sitemap error / warning  |      0 / 0 |      0 / 0 |    0 |

- 44 个非 PASS 全部为 Google 原文 `Crawled - currently not indexed`，没有新的 canonical、robots、404、重定向或服务器错误类型。
- 30 个 URL 从 PASS 变为非 PASS：其中 19 个有新的抓取时间，属于抓取后重新评估；11 个没有新的抓取时间，只能标记为 Google 存储状态波动，不能据此立即改代码。
- 5 个旧问题已恢复：`/docs/ocr-workbench`、`/es/pdf-to-md`、`/fr/pdf-to-text`、`/it`、`/it/pdf-to-word-doc`。
- 44 个 URL 的生产现场检查最终全部通过：HTTP 200、可索引、自引用 canonical、单 H1、位于 sitemap。一次 `/es/docs/pdf-to-text` 并发检查发生瞬时网络失败，单独复核后为 200、单 H1、canonical 正确。
- Sitemap API 为 `submitted=172`、0 error、0 warning，最近下载时间为 `2026-11-15T00:16:25.665Z`。弃用的 `indexed=0` 仍不得解释为全站 0 收录。
- Search Analytics 最近完整 28 天（2026-10-25 至 2026-11-21）为 28 点击、2,155 展示、1.30% CTR；最近完整 90 天为 69 点击、6,815 展示、1.01% CTR。时间窗不同，不把它与旧窗口直接归因为本次代码效果。
- 脱敏报告：`/tmp/translatepdfonline-gsc-2026-11-24-current`；完整性校验通过，172 URL = 172 Inspection，无敏感值。

### 0.2 本批执行范围

1. 修复 27 份本地化指南中的 117 个无 locale 内链，并增加自动合同，避免非英语文档返回默认语言集群。
2. 移除顶部促销条和语言建议在 hydration 后插入高度、移动全局 header 的逻辑；促销条首屏稳定渲染，语言建议改为不占文档流的右下浮层。
3. 收紧 `llms.txt`：把绝对版式保留改为 layout-aware / best effort，并公开登录、复杂文档、保留期等产品边界。
4. 增加 ESLint 9 flat config，修复条件调用 Hooks 等正确性问题；历史 `any` 不在本批一次性重构，但不再阻止 lint 工具运行。
5. 当前不批量扩写 44 页，也不反复请求索引；先部署可验证的结构修复，再以新抓取时间和语言集群表现决定下一批内容。

### 0.3 当前 GSC 处置原则

- 有新抓取且仍未收录的 19 个 URL：进入内容/集群整改候选；部署本批后再做一次实时测试和请求收录。
- 状态变化但没有新抓取的 11 个 URL：不改代码，等待新抓取或 GSC 页面索引导出补证。
- 其余长期未收录 URL：确认未重复提交后仅请求一次，并按 D1/D3/D7/D14 记录 `lastCrawlTime`。
- 官方 API 不能枚举“网页索引”界面的所有历史 URL；仍需从 GSC 导出 CSV 后补充审计。

## 1. 当前结论

### 1.1 一句话结论

上一批技术与内容修复已经进入生产。2026-10-27 的 GSC 官方 API 显示 PASS 从 131 增至 134、非 PASS 从 41 降至 38；当前 sitemap 快照也已从 213 刷新为 172，且 0 error、0 warning。**Google Search Console 问题尚未完全解决**：仍有 36 个“已抓取但尚未编入索引”和 2 个历史 canonical 状态，但 38 个页面的实时技术检查全部通过，因此后续重点已经从 canonical/robots 转为内容差异化和 Google 重抓验证。本轮已按内容集群扩充 10 种语言的 OCR 页面与指南，提交 `31613085` 已在 Cloudflare dev 完成 20/20 页面验收，等待生产发布。

### 1.2 三层状态必须分开判断

| 证据层    | 当前状态                                                                                            | 结论                             |
| --------- | --------------------------------------------------------------------------------------------------- | -------------------------------- |
| 代码层    | `c49263ef` 为生产基线；`origin/develop` 已包含 `31613085`，Cloudflare dev 的 20 个目标页面验收通过  | 生产基线完成；新批次等待生产     |
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

| ID       | 优先级 | 问题                                                    | 证据与影响                                                                                                          | 处理要求 / 验收标准                                                                                   | 状态                 |
| -------- | ------ | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------- |
| SEC-001  | P0     | GSC 服务账号密钥需要轮换且本地密钥文件权限过宽          | `glmusr.env` 未进入 Git，但当前为 `0644 root:root`；本次进程无权改为 0600；旧密钥是否已撤销也无法由可读 API 证明    | 文件所有者执行 `chmod 600`；在 Google Cloud 撤销旧密钥、创建新密钥并更新安全存储；确认 Git 历史无密钥 | 需站点所有者操作     |
| SEO-001  | P0     | GSC 当前有 44 个非 PASS URL                             | 2026-11-24 为 128 PASS / 44 个 `Crawled - currently not indexed`；44 页现场技术条件通过                             | 先部署本批内链/性能/事实边界修复；按新抓取与状态波动分组，D1/D3/D7/D14 复查                           | 执行中               |
| CNT-001  | P0     | 多语言营销口径存在过时或未经验证的声明                  | 多语言内容曾包含“No sign-up”、固定赠送、语言数量、Norwegian 和产品能力冲突，可能造成失实、转化损失和 GEO 可信度下降 | 建立功能事实表；所有语言逐项对齐实际产品；自动测试阻止免登录、固定赠送、不支持语言和 `www` 内链回归   | 已完成；持续合同测试 |
| CNT-005  | P0     | 动态积分和费率被静态文案写死                            | 顶部横幅固定承诺注册送 30 积分，pricing/API docs/FAQ 固定写 10 积分/页，但实际由后台和运行时配置决定                | 横幅只在赠送开启且数量有效时显示；费率从运行时配置注入；静态内容不再保证固定值                        | 已完成               |
| SEO-002  | P0     | 9 个非英语首页缺少页面级 metadata                       | 非英语 `pages/index.json` 原先缺 `metadata.title`、`description`，依赖通用回退，搜索意图不够精准                    | 9 个语言补齐独立、自然、本地化 metadata；构建和页面检查通过；不得机械直译或堆词                       | 已完成               |
| SEO-006  | P0     | OCR Translator 缺独立 metadata 和服务端 H1              | 独立 metadata/H1 与扩充内容已进入生产，10 个页面和 10 份指南现场验证通过；西/日/俄仍是旧抓取状态                    | 对四个代表 URL 做 GSC 实时测试和一次请求收录；按 D1/D3/D7/D14 比较 `lastCrawlTime`                    | 等待外部刷新         |
| CNT-004  | P0     | 合同对比页超出真实产品能力定位                          | 原内容使用完整 CLM、企业认证、Top 10 和未经证实的效率承诺                                                           | 聚焦两份文档差异对比；移除未经证实能力；明确人工复核边界                                              | 已完成               |
| I18N-001 | P1     | 德/西/俄 pricing 文案仍是旧数据结构                     | 当前通过英文现行结构回退并 noindex/退出站点地图避免错误曝光；本批已将所有 locale 的每页费率改为运行时注入           | 继续重写三种语言 pricing 结构；通过键集合自动校验；页面内容、价格、功能与实际系统一致后才允许 index   | 执行中               |
| SEO-003  | P1     | 44 个未收录页存在语言集群和模板同质化风险               | 30 个页面从 PASS 转为非 PASS；19 个确认发生新抓取，11 个仅状态变化；德/法/日集群受影响较多                          | 修复 117 个跨语言内链；按模板和 locale 分批评估，不再平均扩写 172 页                                  | 执行中               |
| SEO-004  | P1     | 历史 canonical 类型问题已清零                           | 2026-11-24 的 44 个问题全部为 `Crawled - currently not indexed`，没有 canonical 类型问题                            | 保持 canonical、hreflang 和 sitemap 合同；如类型重新出现再单独处置                                    | 已完成；持续监测     |
| SEO-005  | P1     | GSC Sitemap 快照曾显示 213 个 URL                       | 2026-10-27 API 已显示 `submitted=172`、0 error、0 warning                                                           | 保持现有 sitemap；只有内容/路由变更后重新提交，不删除成功记录                                         | 已完成               |
| SEO-007  | P1     | docs/blog 标签和结构不完整                              | 4 个 docs description、博客双 H1 与 OG/BlogPosting 已修复并进入生产                                                 | 保持合同测试；新文档发布时强制 description 与单 H1                                                    | 已完成               |
| SEO-008  | P1     | 公开内容曾包含 `www` 绝对内链                           | 已归一化为 apex，并有自动测试防止回归                                                                               | 持续执行内容合同                                                                                      | 已完成               |
| EDGE-001 | P2     | HTTP+`www` 组合仍产生两次 301                           | `http://www.../docs/upload?probe=...` 依次跳到 HTTPS `www` 和 HTTPS apex；路径/查询保留且最终 200                   | 在 Cloudflare 用一条组合 Redirect Rule 直接跳到 HTTPS apex；变更前记录现有规则并测试回滚              | 待执行               |
| I18N-002 | P1     | 非英语合同对比页曾有英文残留                            | 关联内容已本地化并进入生产                                                                                          | 继续母语抽样复核                                                                                      | 已完成；待母语复核   |
| CNT-002  | P1     | 多语言 docs/工具页存在模板化和价值不足风险              | OCR 内容已进入生产；旧 docs 首页有错误入口、未来承诺、游客暗示和不稳定技术栈描述                                    | docs 首页已按任务/步骤/限制/隐私重构并通过 dev；生产后继续处理仍未收录的工具模板                      | 执行中               |
| PROD-001 | P1     | PDF 工具覆盖面不足                                      | 当前偏翻译/OCR/转换，缺少压缩、合并、拆分、旋转/整理等高频基础需求                                                  | 按“功能可用 → 隐私/质量验收 → 内容完善 → 允许索引 → 加入 sitemap”顺序上线，禁止先发布空壳 SEO 页面    | 待执行               |
| GEO-001  | P1     | GEO 内容缺少稳定的事实、实体和出处体系                  | 首页与 Organization 事实口径已在 dev 修正，但仍缺少 About/Team/Methodology/Security 与原创测试证据                  | 先用真实组织资料和可复现实验建设品牌/方法/安全/样例页；结构化数据必须与可见内容一致，禁止虚构权威信号 | 执行中               |
| MEAS-001 | P1     | SEO 流量尚未形成“落地页 → 上传 → 完成 → 付费”的统一漏斗 | GSC 只有搜索曝光/点击，不能解释业务结果                                                                             | 定义并核对分析事件；按 landing page、locale、query cluster 形成周报；明确转化率而非只看收录数         | 待验证               |
| ENG-001  | P2     | GSC 审计尚未形成定期回归                                | 已有 CLI，但当前主要依赖人工触发                                                                                    | 每周只读全量审计并保存脱敏摘要；新增异常数、canonical 漂移、站点地图差异触发告警                      | 待执行               |
| ENG-002  | P2     | “main / master”口径不一致                               | 用户操作描述为 main，但远端实际生产分支是 `master`，容易推错或误判部署                                              | Cloudflare、README、交付文档统一写明生产分支；若迁移到 main，需一次性同步仓库默认分支和 CF 构建配置   | 待执行               |
| ENG-003  | P2     | ESLint 9 缺少可执行配置                                 | 已增加 flat config；当前 lint 0 error，仍有 309 个历史 warning，需要分批清理并纳入 CI                               | 维持 Hooks 等正确性规则为 error；按模板清理 warning，不用一次性大改掩盖风险                           | 部分完成             |
| PERF-001 | P2     | 首页移动端 CLS 与首屏资源偏大                           | PSI 移动端 CLS 0.298；顶部两个组件在 hydration 后插入高度并移动 header；首页首载约 376 KB                           | 本批先移除通知组件的后插入占位；部署后重测 CLS，再拆消息包、上下文和第三方脚本                        | 执行中               |
| I18N-003 | P1     | 本地化指南存在 117 个无 locale 内链                     | 27 份德/希/西/法/意/日/韩/俄/中文指南把用户送回默认语言页面，削弱语言内容集群                                       | 全部改为当前 locale 路径；SEO 合同扫描所有本地化 MDX，错误数必须为 0                                  | 本地已完成，待部署   |
| GEO-005  | P1     | `llms.txt` 使用绝对版式保留表述                         | 原文使用 preserving original layout / preserved formatting，强于可验证产品边界                                      | 改为 layout-aware、best effort，并列出登录、复杂文档、输出和保留期边界；合同测试防回归                | 本地已完成，待部署   |

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
- HTTP apex 与 HTTPS `www` 深层 URL 各自单跳 301 到 HTTPS apex，路径与查询参数均保留；HTTP+`www` 组合两跳问题另见 EDGE-001。
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
2. 对 docs 首页批次 `cb9f167a` 做产品事实与母语抽样；通过后合入生产，不把 dev 验证误写成 GSC 已改善。
3. 在 GSC 对 `/es`、`/it`、`/ja` 及 `/de/docs/ocr-workbench`、`/es/ocrtranslator`、`/ja/ocrtranslator`、`/ru/ocrtranslator` 做实时测试，每个代表 URL 只请求一次收录；重新提交现有 sitemap，但不要先删除成功记录。
4. docs 首页生产发布后，优先检查 `/es/docs`、`/fr/docs`、`/it/docs`、`/ja/docs`，按 D1/D3/D7/D14 记录 `lastCrawlTime` 和状态变化。
5. `I18N-001`：完成德/西/俄 pricing 现行 schema，再统一整改意大利语和日语 pricing 内容。
6. `EDGE-001`：在 Cloudflare 把 HTTP+`www` 两跳收敛为直达 HTTPS apex 的单跳，并验证路径与查询参数。
7. 使用真实组织资料、处理方法、安全边界与可复现实验建设 About/Methodology/Security/Examples；在证据准备前不创建虚构的权威页面。
8. 为首页约 376 KB 首载资源建立移动/桌面 PSI 与真实 CWV 基线，再按 bundle、第三方脚本、图片和字体拆解；不以构建体积单独代替用户指标。
9. 每次生产部署后按 D1/D3/D7/D14 复跑 GSC，只在新抓取后判断内容批次效果。
10. Wave 1 的 PDF 压缩、PDF 合并必须先做真实功能闭环，再发布可索引内容页；当前不创建空壳 SEO 页面。

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
