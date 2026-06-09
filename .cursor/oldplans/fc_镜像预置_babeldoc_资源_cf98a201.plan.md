---
name: FC 镜像预置 BabelDOC 资源
overview: 当前 [docker/prewarm_babeldoc_cache.py](docker/prewarm_babeldoc_cache.py) 只调用 `get_doclayout_onnx_model_path()`，运行时仍会按需从 Hugging Face/GitHub 下载字体等。BabelDOC 上游已提供 `babeldoc.assets.assets.warmup()`，可在镜像构建阶段一次性写入 `/root/.cache/babeldoc`，无需改 FC 业务逻辑（[babeldoc_fc/run_translate.py](babeldoc_fc/run_translate.py) 的 `ignore_cache=True` 仅作用于 LLM 翻译缓存）。
todos:
  - id: prewarm-script-warmup
    content: 将 docker/prewarm_babeldoc_cache.py 改为调用 babeldoc.assets.assets.warmup()，失败时 exit(1)，更新注释
    status: completed
  - id: dockerfile-comment-optional
    content: （可选）在 Dockerfile.babeldoc-fc(.gpu) 的 RUN prewarm 旁注明构建需外网
    status: completed
isProject: false
---

# FC 镜像构建时预置 BabelDOC 全部资源

## 现状结论


| 环节                                                                                                                                      | 行为                                                                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| [docker/Dockerfile.babeldoc-fc](docker/Dockerfile.babeldoc-fc) / [docker/Dockerfile.babeldoc-fc.gpu](docker/Dockerfile.babeldoc-fc.gpu) | `RUN python docker/prewarm_babeldoc_cache.py`                                                                                           |
| [docker/prewarm_babeldoc_cache.py](docker/prewarm_babeldoc_cache.py)                                                                    | **仅** `get_doclayout_onnx_model_path()`（DocLayout ONNX）                                                                                 |
| BabelDOC [tmp/BabelDOC/babeldoc/assets/assets.py](tmp/BabelDOC/babeldoc/assets/assets.py)                                               | `warmup()` → `async_warmup()`：tiktoken `gpt-4o`、DocLayout ONNX、RapidOCR 表格检测 ONNX、`download_all_fonts_async`、`download_all_cmaps_async` |


因此：**并非**「无法打进镜像」，而是当前预热线程不完整；你日志里 ONNX 后仍批量下字体，正是因为构建阶段没跑字体/cmap 等预取。

FC 业务层 [babeldoc_fc/main.py](babeldoc_fc/main.py) / [babeldoc_fc/run_translate.py](babeldoc_fc/run_translate.py) **不必**为「是否下载」写分支；缓存路径由 BabelDOC 常量 `[CACHE_FOLDER = Path.home() / ".cache" / "babeldoc"](tmp/BabelDOC/babeldoc/const.py)` 决定，镜像内 `root` 用户与 FC 日志中的 `/root/.cache/babeldoc` 一致。

## 推荐实现

### 1. 重写 `docker/prewarm_babeldoc_cache.py`

- 在安装好 `tmp/BabelDOC` 的前提下执行：

```python
from babeldoc.assets.assets import warmup
warmup()
```

- 补充 INFO 日志（开始/成功）。
- **建议**：任一步失败时 `**sys.exit(1)`**，让 `docker build` 失败，避免推上线后仍是「冷启动狂下载」的坏镜像；若需在弱网 CI 上可选跳过，可通过构建参数分支（可选，默认严格）。
- 删除或缩短原脚本中「仅 doclayout、字体仍首次下载」的注释，改为说明：构建期调用官方 `warmup()` 全量预热。

### 2. Dockerfile 无需改路径（仅确认顺序不变）

两个 Dockerfile 均已：**先** `pip install -e tmp/BabelDOC`，**再** `COPY` 脚本并 `RUN python .../prewarm_babeldoc_cache.py`。保持该顺序即可。

可选：在 Dockerfile 中增加简短注释：`RUN` 步骤需构建机访问 Hugging Face / GitHub（与 BabelDOC 上游 CDN 一致）。

### 3. 不修改 `babeldoc_fc` 逻辑（除非后续要优化）

- `run_translate.py` 里 `ignore_cache=True` 是 **OpenAITranslator** 的 LLM 缓存，与 ONNX/字体磁盘缓存无关，**无需改动**。

### 4. 风险与运维说明（写入脚本注释或内部文档即可）

- **镜像体积**会明显增大（全量 `EMBEDDING_FONT_METADATA` + 两个 ONNX + tiktoken 缓存）。
- **构建时间**变长，且必须在能访问外网的环境执行 `docker build`（或自建镜像仓库基础层已含缓存）。
- BabelDOC 升级后若变更 `offline_assets` 校验和，需重新构建镜像以刷新缓存。

## 可选替代（本计划不采用，除非你要减小构建对外网依赖）

- 使用 `generate_offline_assets_package` 在可联网机器生成 zip，再在 Dockerfile 里 `COPY` + `restore_offline_assets_package`：适合内网构建，但需维护 zip 产物与版本对齐，复杂度高。

## 验证建议

- 本地 `docker build -f docker/Dockerfile.babeldoc-fc -t babeldoc-fc:test .` 成功后，进入容器检查 `/root/.cache/babeldoc/fonts/`、`.../models/` 等目录非空。
- 再跑一条与线上一致的翻译请求，日志中不应再出现大段「font not found, downloading from github」。

