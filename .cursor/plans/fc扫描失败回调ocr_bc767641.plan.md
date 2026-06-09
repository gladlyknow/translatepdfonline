---
name: FC扫描失败回调OCR
overview: 在 babeldoc_fc 启用 BabelDOC 内置扫描检测（关闭 skip_scanned_detection），将 ScannedPDFError 等映射为 error_code=scan_detected_use_ocr 并随失败回调到 Next；前端翻译页已能根据任务 failed + error_code 展示 OCR 引导，仅需核对回调与轮询字段。
todos:
  - id: fc-enable-scan
    content: run_translate：skip_scanned_detection=False 或 env 开关
    status: completed
  - id: fc-error-code
    content: main._error_code_for_babeldoc_failure：ScannedPDFError → scan_detected_use_ocr
    status: completed
  - id: verify-callback-ui
    content: 核对 callback 入库字段与翻译页 failed 展示/OCR CTA
    status: completed
isProject: false
---

# FC：遇扫描 PDF 时回调失败 + 前端 OCR 提示

## 现状

- [`babeldoc_fc/run_translate.py`](d:/imppro/translatepdfonline/babeldoc_fc/run_translate.py) 中 **`skip_scanned_detection=True`**，BabelDOC 的 **`ScannedPDFError`** 不会抛出，扫描件仍会译完并回调 **completed**。
- [`babeldoc_fc/main.py`](d:/imppro/translatepdfonline/babeldoc_fc/main.py) 的 **`_error_code_for_babeldoc_failure`** 仅识别 `no_paragraphs` 类文案，**未**识别 `Scanned PDF` / `ScannedPDFError`，扫描失败时 **`error_code` 常为 null**。
- Next [`callback/route.ts`](d:/imppro/translatepdfonline/frontend/src/app/api/translate/callback/route.ts) 会从 body 写库；[`invoke-fc.ts`](d:/imppro/translatepdfonline/frontend/src/app/api/translate/invoke-fc.ts) 已对 **`scan_detected_use_ocr`** 做任务失败处理；翻译页 [`TranslatePageClient`](d:/imppro/translatepdfonline/frontend/src/app/[locale]/(translate)/translate/TranslatePageClient.tsx) 已有 **`scan_detected_use_ocr` / OCR 跳转** 的 UI 逻辑。

## 目标行为

1. FC 内 BabelDOC 判为扫描 PDF 时 **中止翻译**，不向 R2 写成功产物（或写失败路径一致）。
2. 对 Next **callback** `status=failed`，并带 **`error_code: scan_detected_use_ocr`**（及可读 `error_message`）。
3. 前端：任务轮询到 **failed + 该 error_code** 时，展示 **提示 + 建议去 OCR**（与现有 i18n/按钮一致，一般无需大改）。

## 实现要点（执行阶段）

1. **`run_translate_local`**：`TranslationConfig` 将 **`skip_scanned_detection` 改为 `False`**，或通过 env **`BABELDOC_SKIP_SCANNED_DETECTION`**（默认 `0`/`false` 即检测开启）便于灰度。
2. **`_error_code_for_babeldoc_failure`**：对异常类型或 `str(exc).lower()` 增加 **`scannedpdf` / `scanned pdf` / `scanned pdf detected`** 等分支，返回 **`scan_detected_use_ocr`**（与 Worker/前端 key 一致）。
3. **确认 BabelDOC 抛错类名**：在 `tmp/BabelDOC` 中 `ScannedPDFError` 的 import 路径，必要时 **`except ScannedPDFError`** 单独分支，避免仅靠字符串。
4. **回调**：`main.py` 在 `except` 里已调用 `_notify_callback(..., error_code=ec)`；保证 **`ec` 非 null** 即可。
5. **回归**：本地/FC 用已知扫描样张跑一次，确认 DB `translation_tasks.error_code`、翻译页失败卡与 OCR 入口。

## 与 Worker 预检的关系

- Worker **预拦**减少无效 FC；FC **兜底**捕获漏网扫描件。二者可同时保留；若担心「FC 与 Worker 双重标准」，可在文档中说明：**Worker 启发式；FC 为 BabelDOC 真实检测**。
