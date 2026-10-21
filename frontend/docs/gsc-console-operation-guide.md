# Google Search Console 控制台操作手册

> 适用站点：`translatepdfonline.com`  
> 目标属性：`sc-domain:translatepdfonline.com`  
> 建立日期：2026-10-21  
> 配套总表：[project-seo-gsc-remediation-plan.md](./project-seo-gsc-remediation-plan.md)  
> 执行日志：[remediation-execution-log.md](./remediation-execution-log.md)

## 1. 操作目标和当前基线

本手册的目的不是“让所有警告数字立即归零”，而是确认 Google 已重新抓取当前生产版本，并把技术问题、内容问题和正常 canonical 合并分别处理。

当前基线：

- 生产提交：`bf2a3192`。
- 实际生产分支：`master`。
- 生产部署时间：约 2026-10-21 05:49 UTC。
- 在线 sitemap：172 个 URL。
- 生产 HTTP 审计：172/172 返回 200、允许索引、HTML 语言正确、自引用 canonical 正确。
- GSC URL Inspection API：131 PASS、41 非 PASS、0 API 错误。
- 41 个非 PASS：37 个 `Crawled - currently not indexed`，4 个 `Alternate page with proper canonical tag`。
- 172 个 URL 的 `lastCrawlTime` 均早于本次部署，所以 GSC 尚未验证当前页面版本。

Google 官方说明，抓取可能需要几天到几周，重复提交同一 URL 不会加速抓取，请求抓取也不保证收录。参考：[Ask Google to recrawl your URLs](https://developers.google.com/search/docs/crawling-indexing/ask-google-to-recrawl)。

## 2. 操作前准备

### 2.1 账号和属性

1. 打开 [Google Search Console](https://search.google.com/search-console)。
2. 点击左上角属性选择器。
3. 选择域名属性 `translatepdfonline.com`，不要选择旧的 `https://www.translatepdfonline.com/` URL-prefix 属性。
4. 进入“设置 → 用户和权限”，确认当前人工账号拥有“所有者”或“完整用户”权限。
5. 确认 API 服务账号仍有 `Full user` 权限；完成密钥轮换后再用只读 API 复测。

若左上角显示的不是域名属性，立即停止。不同属性中的 sitemap、网页索引和性能数据不能直接混合比较。

### 2.2 建立本次操作记录

在[执行日志](./remediation-execution-log.md)中新建一条记录，至少填写：

- 操作日期和北京时间。
- 操作账号。
- 当前生产提交和部署时间。
- GSC 属性名。
- 操作前 sitemap 状态截图。
- 每个 URL 的存储结果、实时测试结果和 `lastCrawlTime`。
- 是否点击“请求编入索引”。
- 下一次复查日期。

截图和导出文件不能包含服务账号私钥、OAuth 令牌、用户文件或后台敏感信息。

## 3. 第一步：重新提交当前 sitemap

### 3.1 控制台点击路径

1. 左侧导航点击“编入索引 → 站点地图”（英文界面为 `Indexing → Sitemaps`）。
2. 在“添加新的站点地图”输入框中填写 `sitemap.xml`。
3. 确认预览的完整地址为 `https://translatepdfonline.com/sitemap.xml`。
4. 点击“提交”。
5. 不要先删除已有 sitemap。重新提交同一个地址即可让 Google 重新读取。

### 3.2 提交后应看到什么

预期结果：

- 状态为“成功”。
- 类型为 Sitemap。
- “上次读取时间”更新，或进入待处理状态后稍后更新。
- 已发现网页数量最终接近在线 sitemap 的 172；短期内保留旧数字属于刷新延迟。
- 错误数和警告数为 0。

注意：Search Console API 的 `contents[].indexed` 已被 Google 标记为 deprecated / do not use。即使接口显示 `indexed=0`，也不能解释为整个站点 0 个页面被索引。参考：[Sitemap API 字段定义](https://developers.google.com/webmaster-tools/v1/sitemaps)。

### 3.3 异常处理

| 控制台结果              | 操作                                                                                    |
| ----------------------- | --------------------------------------------------------------------------------------- |
| 无法获取                | 先在无登录浏览器打开 sitemap，确认 200 和 XML；再检查 Cloudflare、防火墙、robots 和超时 |
| 格式错误                | 不要重复提交；保存具体错误，回到 sitemap 生成逻辑修复并重新部署                         |
| 仍显示 213              | 记录“等待刷新”；D1/D3 复查，不删除 sitemap                                              |
| 已发现 URL 明显少于 172 | 下载当前 XML，与控制台读取时间比较；确认不是缓存或读取旧版本                            |
| 已发现 URL 多于 172     | 检查是否还有旧 sitemap、sitemap index 或历史子 sitemap                                  |

## 4. 第二步：URL Inspection 实时测试

### 4.1 本轮 URL 分组

#### A 组：现在可以实时测试，通过后请求一次索引

这些 URL 的主要问题是历史 canonical 信号，当前生产输出已经通过现场验证：

1. `https://translatepdfonline.com/docs/upload`
2. `https://translatepdfonline.com/docs/ocr-workbench`
3. `https://translatepdfonline.com/ko/docs`

#### B 组：现在可以实时测试，但内容修复前暂不请求索引

1. `https://translatepdfonline.com/contract-comparison`
2. `https://translatepdfonline.com/es/jpg-to-word`
3. `https://translatepdfonline.com/fr/pdf-to-text`
4. `https://translatepdfonline.com/it/jpg-to-word`
5. `https://translatepdfonline.com/ja/pdf-to-text`
6. `https://translatepdfonline.com/ocrtranslator`

B 组存在内容质量、metadata 或场景化不足。先保存实时测试证据，完成内容整改并部署后再请求一次索引，避免让 Google 先抓取仍需修改的版本。

### 4.2 每个 URL 的详细操作

1. 把完整 HTTPS apex URL 粘贴到 GSC 顶部的“检查网站中的任何网址”输入框。
2. 等待“从 Google 索引中检索数据”。这里显示的是 Google 已保存的版本，不是实时页面。
3. 展开“网页索引”或“页面索引”详情并记录：
   - 页面是否已编入索引。
   - `coverageState` / 未编入索引原因。
   - 上次抓取时间。
   - 抓取工具类型。
   - 是否允许抓取。
   - 网页抓取是否成功。
   - 是否允许编入索引。
   - 用户声明的规范网页。
   - Google 选择的规范网页。
   - 已知 sitemap 和引荐网页。
4. 点击右上角“测试实际网址”（`TEST LIVE URL`）。
5. 等待实时测试完成。
6. 展开实时测试详情，确认：
   - URL 可供 Google 使用。
   - 页面抓取成功。
   - robots.txt 允许抓取。
   - 未检测到 noindex。
   - 用户 canonical 为当前 apex URL。
7. 如果 A 组实时测试全部通过，点击一次“请求编入索引”。
8. 记录请求日期和控制台返回结果。
9. 如果实时测试失败，不要点击请求索引；保存失败详情，先修生产页面。

### 4.3 正确理解“存储结果”和“实时测试”

| 组合                       | 含义                 | 处理                                                  |
| -------------------------- | -------------------- | ----------------------------------------------------- |
| 存储结果失败、实时测试成功 | Google 仍保存旧版本  | 请求一次索引，然后等待 `lastCrawlTime` 更新           |
| 存储结果成功、实时测试成功 | 页面技术状态正常     | 不需要反复请求；转向内容和搜索表现                    |
| 存储结果成功、实时测试失败 | 生产刚出现回归       | 不请求索引，立即修复线上问题                          |
| 存储结果失败、实时测试失败 | 当前页面仍有真实问题 | 根据 fetch、robots、noindex、canonical 的具体错误修复 |

Google 官方将 `lastCrawlTime` 定义为主抓取工具最后一次抓取该 URL 的时间，因此本项目必须以它是否晚于生产部署时间作为关键验收依据。参考：[URL Inspection API 字段说明](https://developers.google.com/webmaster-tools/v1/urlInspection.index/UrlInspectionResult)。

## 5. 第三步：导出“网页索引”问题 URL

官方 API不能枚举“网页索引”报告中的全部示例 URL，因此需要从控制台导出。

### 5.1 操作路径

1. 左侧导航点击“编入索引 → 网页”（`Indexing → Pages`）。
2. 先记录顶部的“已编入索引”和“未编入索引”总数及数据更新时间。
3. 向下进入“网页未编入索引的原因”。
4. 点击 `Crawled - currently not indexed` 原因组。
5. 点击右上角“导出”，优先选择 CSV；若选择 Excel，需要后续另行转为 CSV。
6. 返回原因列表，打开 `Alternate page with proper canonical tag` 并导出。
7. 如果出现新的 `Duplicate`、`Excluded by noindex`、`Redirect`、`Not found`、`Soft 404`、`Blocked by robots` 或 `Server error`，每组分别导出。
8. 将文件保存在仓库外的私有审计目录，不提交 Git。

控制台导出的通常是示例 URL，不保证代表全部历史 URL。后续要把导出文件与当前 172 个 sitemap URL 做交集和差集，不能只看报告顶部总数。

### 5.2 导出后的分类

每个 URL 只能选择一个处置：

- 恢复并争取索引。
- 单跳永久重定向到真正替代页。
- 保留 noindex 并退出 sitemap。
- 保留 404/410 并移除所有发现入口。
- 接受 Google 选择的备用 canonical。
- 当前无需改代码，等待重新抓取。

不得为了减少报错，把有价值页面随意 noindex；也不得为了增加索引数，把隐私政策、登录页、参数页和低价值模板页强行加入 sitemap。

## 6. 第四步：何时点击“验证修复”

1. 只有问题组中的共同根因已经部署并通过生产检查时，才点击“验证修复”。
2. 打开对应原因组，若控制台提供“验证修复”按钮，点击后记录开始日期。
3. canonical 备用页如果本来就是预期合并，不需要为“数字归零”发起验证。
4. `Crawled - currently not indexed` 若主要是内容质量问题，应先完成目标页面的内容升级，不要只改更新时间后验证。
5. 验证失败时，打开失败详情，检查失败 URL 是否属于当前 sitemap；旧 URL 和当前 URL 分开处理。

验证状态含义：

- “已开始”：Google 正在抽样检查。
- “看起来不错”：初步样本通过，仍需等待完整结果。
- “已通过”：该原因组本轮验证完成，不代表所有页面都会获得排名。
- “失败”：至少有抽样 URL 仍存在该问题；回到 URL 级证据，不要直接再次点击。

## 7. 第五步：搜索结果表现检查

### 7.1 基础报表

1. 左侧点击“效果 → 搜索结果”（`Performance → Search results`）。
2. 搜索类型选择 Web。
3. 日期先选择“最近 28 天”，再选择“比较 → 与上一周期比较”。
4. 打开“总点击次数、总展示次数、平均点击率、平均排名”四个指标。
5. 分别查看“查询、网页、国家/地区、设备、日期”。
6. 导出 CSV，保存查询日期和筛选条件。

### 7.2 本项目固定观察项

- 查询：`translate pdf`、`jpg to word`、`convert jpg to word`、`pdf translator`、`translate pdf to english`。
- 页面：`/`、`/jpg-to-word`、`/pdf-to-text`、`/ocrtranslator` 及表现较好的俄语/希腊语页面。
- 主机：历史 `https://www.translatepdfonline.com/...` 展示是否持续下降。
- 国家：美国、印度、菲律宾、德国、俄罗斯、墨西哥、西班牙、意大利、日本、韩国。
- 设备：当前绝大多数展示来自桌面端，但移动端必须单独观察 CTR 和排名。

不要仅以平均排名做决策。页面/查询数量少时波动很大，要同时看展示量、点击、CTR、国家和意图是否匹配。

## 8. 第六步：其他必须检查的 GSC 区域

### 8.1 HTTPS 和 Core Web Vitals

1. 打开“体验 → 核心网页指标”。
2. 分别检查移动设备和桌面设备。
3. 导出 Poor / Need improvement URL 分组。
4. 打开“HTTPS”报告，确认没有非 HTTPS URL 问题。

GSC CWV 是真实用户汇总数据，不能用一次 Lighthouse 测试直接替代。若没有足够数据，记录“数据不足”，再使用 PSI 作为实验室补充。

### 8.2 增强功能和结构化数据

1. 查看 GSC 是否出现 FAQ、Software app、文章或无法解析的结构化数据报告。
2. 对报错 URL先使用 Rich Results Test，再检查页面可见内容是否与 JSON-LD 一致。
3. 结构化数据通过并不保证展示富结果。Google 要求标记内容真实、与可见内容一致且完整。参考：[结构化数据通用规范](https://developers.google.com/search/docs/appearance/structured-data/sd-policies)。

### 8.3 手动操作和安全问题

1. 打开“安全性和手动操作 → 手动操作”，确认“未检测到问题”。
2. 打开“安全性和手动操作 → 安全问题”，确认“未检测到问题”。
3. 每月记录一次结果；若出现问题，优先级立即提升为 P0。

## 9. D1 / D3 / D7 / D14 复查表

| 检查日 | 必做项                                                    | 通过标准                                           |
| ------ | --------------------------------------------------------- | -------------------------------------------------- |
| D1     | sitemap 读取时间、A 组 URL stored/live 结果、API 全量审计 | 无新技术错误；至少记录 Google 是否开始重抓         |
| D3     | 重跑 172 URL API，对比 PASS 和 `lastCrawlTime`            | 部分 URL 抓取时间晚于部署；canonical 类开始下降    |
| D7     | 导出 Pages 原因组，按页面模板聚类                         | 技术问题为 0；剩余项可以归因到内容或预期合并       |
| D14    | 稳定期结论、Search Analytics 对比                         | 每个非 PASS URL 都有明确处置；不存在无人负责的 URL |

每次复查都创建新的报告目录，不覆盖上一次结果。

## 10. 禁止操作

- 不使用 Google Indexing API 提交普通网页。
- 不连续多次点击“请求编入索引”。
- 不删除一个成功 sitemap 后再重建同地址。
- 不把 Sitemap API 的 `indexed` 字段当成站点收录总数。
- 不把实时测试通过当成已经收录。
- 不把 GSC 历史 `www` 展示直接视为当前 canonical 仍错误。
- 不使用“临时移除”处理正常 canonical、重复页面或长期下线；临时移除不是永久删除方案。
- 不在内容尚未修正时请求 Google 重抓所有 37 个未收录页面。

## 11. GSC 问题关闭标准

同时满足以下条件后，才能将本轮 GSC 技术问题标记为“已解决”：

1. 代表 URL 的 `lastCrawlTime` 晚于 2026-10-21 05:49 UTC。
2. sitemap 已重新读取，0 error、0 warning，提交规模与当前 XML 可解释地一致。
3. 错误 canonical、双 locale、noindex 冲突、重定向链、抓取失败、5xx 均为 0。
4. 4 个历史 canonical 备用页已消失，或 Google/user canonical 一致且该备用关系是明确接受的。
5. 37 个未收录 URL 都已分配到“内容增强、canonical 合并、noindex、删除或继续观察”之一。
6. 执行日志具有提交、部署、生产和 GSC 四层证据。
