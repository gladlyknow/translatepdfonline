# `doc/technical/` — 设计文档存档副本

本目录下的 `.md` 文件由 **`.cursor/plans/doc/`** 同步复制而来（便于不依赖 `.cursor` 是否提交即可阅读）。**权威索引与勘误**见上级目录：

- [../ARCHIVE_INDEX.md](../ARCHIVE_INDEX.md) — 全项目文档地图（含 MDX、前端 docs、本目录）  
- [../README.md](../README.md) — 技术文档入口

同目录内相对链接（如 `preview-polling-translation.md`）在本文件夹内有效。

**仅在本目录补写、未在 plans 中的文件：**

- [worker-health-check.md](./worker-health-check.md) — Worker 健康检查说明（根 README 曾引用但未落盘的 `doc/worker-health-check.md` 由本文件承接）
- [ocr-workbench-parse-result.md](./ocr-workbench-parse-result.md) — 百度 OCR 提交参数、parse_result 响应与 Workbench 消费矩阵
