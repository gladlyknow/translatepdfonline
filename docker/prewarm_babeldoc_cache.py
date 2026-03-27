#!/usr/bin/env python3
"""
镜像构建阶段将 BabelDOC 所需资源写入 ~/.cache/babeldoc（与运行时 FC 容器内路径一致）。

调用 BabelDOC 官方 warmup()：tiktoken(gpt-4o)、DocLayout ONNX、RapidOCR 表格检测 ONNX、
全量嵌入字体、cmap 等。避免冷启动时长时间访问 Hugging Face/GitHub，降低首请求超时
（Invocation canceled by client）概率。

要求：执行 docker build 的环境能访问外网（HF/GitHub/CDN）。失败时退出码 1，避免推送
未预热的镜像。
"""
from __future__ import annotations

import logging
import sys

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("prewarm_babeldoc_cache")


def main() -> int:
    logger.info("BabelDOC warmup: downloading models, fonts, cmaps, tiktoken cache...")
    try:
        from babeldoc.assets.assets import warmup

        warmup()
    except Exception as e:
        logger.exception("BabelDOC warmup failed: %s", e)
        return 1
    logger.info("BabelDOC warmup finished successfully.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
