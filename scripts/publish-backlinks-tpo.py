#!/usr/bin/env python3
"""CDP 批量外链内容发布 — translatepdfonline.com 15 内容平台"""

import asyncio, json, os, re, sys
from datetime import datetime
from playwright.async_api import async_playwright

# ── 配置 ──
CDP_URL = os.environ.get("CDP_URL", "http://localhost:9223")
IDENTITY = {
    "name": "Jordan Chen",
    "email": "jordan@translatepdfonline.com",
    "url": "https://www.translatepdfonline.com",
}

# ── 15 平台发布任务 ──
# 每个平台: platform_key, url, title, content_file, editor_type, sheet_row, needs_login
PLATFORM_JOBS = [
    # --- 匿名/无需登录平台 ---
    {
        "platform": "write.as",
        "url": "https://write.as/new",
        "title": "Academic PDF Translation: What Researchers Actually Need in 2026",
        "file": "content/backlinks/writeas-academic-pdf-translator-20260804.md",
        "editor": "markdown",  # write.as uses Markdown editor
        "sheet_row": 2,  # 1-indexed row in Google Sheet
        "needs_login": False,
    },
    {
        "platform": "telegra.ph",
        "url": "https://telegra.ph/",
        "title": "7 PDF Translation Tools Compared in 2026",
        "file": "content/backlinks/telegraph-pdf-tools-comparison-20260804.md",
        "editor": "richtext",  # telegra.ph has rich text editor with title+body
        "sheet_row": 3,
        "needs_login": False,
    },
    {
        "platform": "rentry.co",
        "url": "https://rentry.co/",
        "title": "",  # rentry uses first line as title in markdown
        "file": "content/backlinks/rentry-ocr-pipeline-tech-20260804.md",
        "editor": "markdown",
        "sheet_row": 4,
        "needs_login": False,
    },
    {
        "platform": "bin.disroot.org",
        "url": "https://bin.disroot.org/",
        "title": "",
        "file": "content/backlinks/bindisroot-smb-pdf-translation-cost-20260804.md",
        "editor": "textarea",
        "sheet_row": 6,
        "needs_login": False,
    },
    {
        "platform": "pastebin.com",
        "url": "https://pastebin.com/",
        "title": "AI Translation in Academic Publishing: 2026 Status Report",
        "file": "content/backlinks/pastebin-academic-ai-translation-2026-20260804.md",
        "editor": "pastebin",  # pastebin has title + textarea + options
        "sheet_row": 8,
        "needs_login": False,
    },
    {
        "platform": "paste.ee",
        "url": "https://paste.ee/",
        "title": "",
        "file": "content/backlinks/pasteee-scanned-pdf-to-word-20260804.md",
        "editor": "textarea",
        "sheet_row": 9,
        "needs_login": False,
    },
    {
        "platform": "controlc.com",
        "url": "https://controlc.com/",
        "title": "PDF Translation: Machine vs Human Cost Comparison 2026",
        "file": "content/backlinks/controlc-cost-comparison-20260804.md",
        "editor": "pastebin",
        "sheet_row": 10,
        "needs_login": False,
    },
    {
        "platform": "pad.riseup.net",
        "url": "https://pad.riseup.net/",
        "title": "",
        "file": "content/backlinks/padriseup-de-guide-20260804.md",
        "editor": "etherpad",
        "sheet_row": 11,
        "needs_login": False,
    },
    {
        "platform": "privatebin.net",
        "url": "https://privatebin.net/",
        "title": "",
        "file": "content/backlinks/privatebin-fr-guide-20260804.md",
        "editor": "textarea",
        "sheet_row": 13,
        "needs_login": False,
    },
    # --- 需登录平台 ---
    {
        "platform": "bearblog.dev",
        "url": "https://bearblog.dev/dashboard/",
        "title": "Cross-Border Contracts and PDF Translation",
        "file": "content/backlinks/bearblog-contract-translation-gdpr-20260804.md",
        "editor": "markdown",
        "sheet_row": 5,
        "needs_login": True,
    },
    {
        "platform": "protectedtext.com",
        "url": "https://www.protectedtext.com/",
        "title": "",
        "file": "content/backlinks/protectedtext-norwegian-pdf-translation-20260804.md",
        "editor": "textarea",
        "sheet_row": 7,
        "needs_login": True,  # protectedtext requires creating a site first
    },
    {
        "platform": "etherpad.wikimedia.org",
        "url": "https://etherpad.wikimedia.org/",
        "title": "",
        "file": "content/backlinks/etherpad-ja-guide-20260804.md",
        "editor": "etherpad",
        "sheet_row": 12,
        "needs_login": False,
    },
    {
        "platform": "dev.to",
        "url": "https://dev.to/new",
        "title": "The Architecture of Modern PDF Translation",
        "file": "content/backlinks/devto-architecture-deep-dive-20260804.md",
        "editor": "markdown",
        "sheet_row": 14,
        "needs_login": True,
    },
    {
        "platform": "maomu.com",
        "url": "https://maomu.com/",
        "title": "PDF在线翻译怎么选？2026年7款工具横评",
        "file": "content/backlinks/maomu-zh-comparison-20260804.md",
        "editor": "markdown",
        "sheet_row": 15,
        "needs_login": True,  # Chinese community, likely needs account
    },
    {
        "platform": "cryptpad.fr",
        "url": "https://cryptpad.fr/",
        "title": "",
        "file": "content/backlinks/cryptpad-es-guide-20260804.md",
        "editor": "richtext",
        "sheet_row": 16,
        "needs_login": False,  # cryptpad allows anonymous pads
    },
]


def log(msg, level="INFO"):
    ts = datetime.now().strftime("%H:%M:%S")
    p = {"INFO": "📋", "OK": "✅", "FAIL": "❌", "WARN": "⚠️", "SKIP": "⏭️", "PAUSE": "⏸️"}.get(level, "•")
    print(f"{p} [{ts}] {msg}", flush=True)


# ── Google Sheet ──
def init_sheet():
    import re as _re
    with open(os.path.expanduser("~/.bashrc")) as f:
        content = f.read()
    match = _re.search(r"export GOOGLE_SERVICE_ACCOUNT_KEY='(\{.+?\})'", content, re.DOTALL)
    key_data = json.loads(match.group(1))
    from google.oauth2 import service_account
    import gspread
    creds = service_account.Credentials.from_service_account_info(
        key_data, scopes=["https://www.googleapis.com/auth/spreadsheets"]
    )
    gc = gspread.authorize(creds)
    sh = gc.open_by_key("1pW4uSCCah23yW8F4BvTrb0qQySzFa5GNGgSeKDiBfWM")
    return sh.worksheet("无需登录外链")


def update_sheet(ws, row_num, status, public_url, angle_tag):
    """回写 Google Sheet 对应行"""
    now_str = datetime.now().strftime("%Y%m%d")
    platform = PLATFORM_JOBS[row_num - 2]["platform"]  # offset from header
    try:
        # Col B: 网站类型
        ws.update_cell(row_num, 2, "content_publish")
        # Col C: 备注 (角度+日期)
        ws.update_cell(row_num, 3, f"{angle_tag} - {now_str}")
        # Col D: 发外链项目名称及时间
        ws.update_cell(row_num, 4, f"{platform}-{now_str}")
        # Col E: 发送内容 (角度标签 + 正文前400字)
        content = open(PLATFORM_JOBS[row_num - 2]["file"]).read()
        preview = content[content.index("# ") + 2:].split("\n")[0][:50] if "# " in content else content[:50]
        ws.update_cell(row_num, 5, f"[{angle_tag}] {preview}...")
        # Col F: 返回内容 (公开URL)
        ws.update_cell(row_num, 6, public_url)
        # Col K: 状态
        ws.update_cell(row_num, 11, status)
        log(f"Sheet row {row_num} 已更新: {status}", "OK")
    except Exception as e:
        log(f"Sheet 回写失败: {e}", "FAIL")


# ── CDP 发布 ──
async def detect_obstacles(page):
    """检测反爬/验证码/登录 — 更全面的检测"""
    c = (await page.content()).lower()
    # Cloudflare / 反爬拦截
    anti_bot_patterns = [
        "just a moment", "checking your browser", "access denied",
        "403 forbidden", "verifying you are human", "please wait while we verify",
        "ddos protection", "enable javascript", "please enable cookies",
        "are you a human", "verify you are a human",
    ]
    if any(s in c for s in anti_bot_patterns):
        return "anti_bot"
    # 验证码: selector + text patterns
    captcha_selectors = [
        ".g-recaptcha", "iframe[src*='recaptcha']", "iframe[src*='hcaptcha']",
        ".cf-turnstile", "iframe[src*='challenges.cloudflare']",
        "#captcha", ".captcha", "img[src*='captcha']",
    ]
    for sel in captcha_selectors:
        el = await page.query_selector(sel)
        if el:
            return "captcha"
    # Text-based captcha detection
    captcha_texts = ["captcha", "verify you are not a robot", "security check", "complete the challenge"]
    if any(t in c[:3000] for t in captcha_texts):
        return "captcha"
    return None


async def wait_page_ready(page, timeout=30):
    """智能等待页面加载完成"""
    try:
        await page.wait_for_load_state("domcontentloaded", timeout=timeout * 1000)
    except:
        pass
    # 等待网络静默 (最多等 15s)
    try:
        await page.wait_for_load_state("networkidle", timeout=15000)
    except:
        pass
    # 额外等待动态内容渲染
    await asyncio.sleep(5)


async def fill_markdown(page, job):
    """填写 Markdown 编辑器 (write.as, rentry, bearblog, dev.to, maomu)"""
    content = open(job["file"]).read()
    # 尝试常见 Markdown 编辑器的 textarea
    selectors = [
        "textarea#body", "textarea[name='body']", "textarea#content",
        "textarea[name='content']", "textarea.editor", "textarea#post_content",
        "textarea",  # fallback
    ]
    for sel in selectors:
        el = await page.query_selector(sel)
        if el:
            await el.click()
            await el.fill(content)
            log(f"Markdown 填充到: {sel}", "OK")
            return True
    # CodeMirror: use evaluate to set value
    cm = await page.query_selector(".CodeMirror")
    if cm:
        await page.evaluate(f"document.querySelector('.CodeMirror').CodeMirror.setValue(`{content}`)")
        log("Markdown 填充到 CodeMirror", "OK")
        return True
    return False


async def fill_richtext(page, job):
    """填写富文本编辑器 (telegra.ph, cryptpad)"""
    title = job["title"]
    content = open(job["file"]).read()
    # telegra.ph: has title input + contenteditable body
    title_el = await page.query_selector("input[placeholder*='itle'], input[name='title'], #title")
    if not title_el:
        title_el = await page.query_selector("header input, h1 input")
    if title_el and title:
        await title_el.click()
        await title_el.fill(title)
        log(f"标题已填写: {title[:60]}", "OK")
    # Body: contenteditable
    body = await page.query_selector("[contenteditable='true'], #editor, .editor, div[role='textbox']")
    if body:
        await body.click()
        # Convert markdown to plain text for rich text editors
        plain = re.sub(r'#+ ', '', content)
        plain = re.sub(r'\*\*(.+?)\*\*', r'\1', plain)
        plain = re.sub(r'\[(.+?)\]\(.+?\)', r'\1', plain)
        plain = re.sub(r'^\s*[-*]\s', '• ', plain, flags=re.MULTILINE)
        await body.fill(plain)
        log("富文本内容已填写", "OK")
        return True
    return False


async def fill_textarea(page, job):
    """填写纯文本 textarea (pastebin类)"""
    content = open(job["file"]).read()
    el = await page.query_selector("textarea")
    if el:
        await el.click()
        await el.fill(content)
        log("Textarea 已填写", "OK")
        return True
    return False


async def fill_pastebin(page, job):
    """填写 pastebin 风格表单 (pastebin.com, controlc.com)"""
    content = open(job["file"]).read()
    title = job["title"]
    # Title field
    if title:
        title_el = await page.query_selector("input[name='paste_name'], input[name='title'], #paste-name, #post-title")
        if title_el:
            await title_el.click()
            await title_el.fill(title)
            log(f"标题: {title[:60]}", "OK")
    # Body
    for sel in ["textarea#paste_code", "textarea[name='paste_code']", "textarea#postform-text", "textarea"]:
        el = await page.query_selector(sel)
        if el:
            await el.click()
            await el.fill(content)
            log(f"内容填充到: {sel}", "OK")
            return True
    return False


async def fill_etherpad(page, job):
    """填写 Etherpad 编辑器"""
    content = open(job["file"]).read()
    # Etherpad uses an iframe with contenteditable body
    iframe = await page.query_selector("iframe")
    if iframe:
        frame = await iframe.content_frame()
        body = await frame.query_selector("body")
        if body:
            await body.click()
            # Strip markdown for plain text
            plain = re.sub(r'#+ ', '', content)
            plain = re.sub(r'\*\*(.+?)\*\*', r'\1', plain)
            plain = re.sub(r'\[(.+?)\]\(.+?\)', r'\1', plain)
            await body.fill(plain)
            log("Etherpad 内容已填写", "OK")
            return True
    # Direct body fallback
    body = await page.query_selector("body[contenteditable]")
    if body:
        await body.click()
        await body.fill(content)
        return True
    return False


async def submit_and_capture(page, job):
    """提交并捕获公开链接"""
    platform = job["platform"]
    # 尝试各种发布按钮
    submit_selectors = [
        "button:has-text('Publish')", "button:has-text('Post')", "button:has-text('Save')",
        "button:has-text('Submit')", "button:has-text('Create')", "button:has-text('Send')",
        "input[type='submit']", "button[type='submit']",
        "button:has-text('publicar')", "button:has-text('publicer')",
    ]
    for sel in submit_selectors:
        btn = await page.query_selector(sel)
        if btn:
            await btn.click()
            log(f"点击了: {sel}", "OK")
            break
    else:
        await page.keyboard.press("Control+Enter")
        log("尝试 Ctrl+Enter 提交", "OK")
    await asyncio.sleep(5)
    # 提取公开链接
    url = page.url
    # 如果 URL 包含哈希或 slug，提取
    if "write.as" in platform and "/new" not in url:
        pass  # URL is the published post
    elif "telegra.ph" in platform:
        # telegra.ph redirects to the published article
        pass
    elif "rentry.co" in platform:
        # rentry shows the published URL
        pass
    return url


# ── 主流程 ──
async def publish_one(job, ws):
    log(f"\n{'='*55}")
    log(f"平台: {job['platform']} (行 {job['sheet_row']})")
    log(f"标题: {job['title'][:80] if job['title'] else '(无标题)'}")
    log(f"{'='*55}")
    angle = job.get("angle", job["platform"])
    pw = await async_playwright().start()
    try:
        browser = await pw.chromium.connect_over_cdp(CDP_URL)
        page = browser.contexts[0].pages[0] if browser.contexts[0].pages else await browser.contexts[0].new_page()

        # ── 导航 + 智能等待 ──
        log("导航 (等待页面完全加载)...")
        try:
            await page.goto(job["url"], wait_until="domcontentloaded", timeout=30000)
        except Exception as e:
            log(f"导航超时: {e}", "WARN")
        await wait_page_ready(page, timeout=30)
        log("页面加载完成", "OK")

        # ── 障碍检测 (加载后) ──
        obs = await detect_obstacles(page)
        if obs:
            log(f"⚠️ 检测到障碍: {obs}", "PAUSE")
            update_sheet(ws, job["sheet_row"], f"需人工处理-{obs}", "", f"障碍:{obs}")
            input(f"🖐️ 请在 Chrome 窗口处理 [{obs}] 后按 Enter 继续 (Ctrl+C 跳过)...")
            await wait_page_ready(page, timeout=15)

        # ── 登录检测 ──
        login_indicators = ["log in", "sign in", "login", "sign up", "register", "create account"]
        c = (await page.content()).lower()
        needs_login_now = any(ind in c[:3000] for ind in login_indicators)
        if needs_login_now:
            log("⚠️ 检测到登录要求", "PAUSE")
            update_sheet(ws, job["sheet_row"], "需登录", "", "需要登录")
            input("🖐️ 请登录后按 Enter 继续 (Ctrl+C 跳过)...")
            try:
                await page.goto(job["url"], wait_until="domcontentloaded", timeout=30000)
            except:
                pass
            await wait_page_ready(page, timeout=15)
            # 重新检测障碍
            obs = await detect_obstacles(page)
            if obs:
                log(f"⚠️ 登录后仍有障碍: {obs}", "PAUSE")
                update_sheet(ws, job["sheet_row"], f"需人工处理-{obs}", "", f"登录后障碍:{obs}")
                input(f"🖐️ 请处理后按 Enter 继续 (Ctrl+C 跳过)...")
                await wait_page_ready(page, timeout=15)

        # ── 填写内容 ──
        editor_type = job["editor"]
        filled = False
        if editor_type == "markdown":
            filled = await fill_markdown(page, job)
        elif editor_type == "richtext":
            filled = await fill_richtext(page, job)
        elif editor_type == "etherpad":
            filled = await fill_etherpad(page, job)
        elif editor_type == "pastebin":
            filled = await fill_pastebin(page, job)
        elif editor_type == "textarea":
            filled = await fill_textarea(page, job)
        if not filled:
            log("⚠️ 未找到编辑器！", "WARN")
            log("请在 Chrome 窗口手动粘贴内容，然后按 Enter...", "WARN")
            input()
        else:
            log("内容已填写", "OK")

        # ── 提交前再检测障碍 (填写后可能出现验证码) ──
        await asyncio.sleep(2)
        obs2 = await detect_obstacles(page)
        if obs2:
            log(f"⚠️ 提交前检测到障碍: {obs2}", "PAUSE")
            update_sheet(ws, job["sheet_row"], f"需人工处理-{obs2}", "", f"提交前障碍:{obs2}")
            input(f"🖐️ 请在 Chrome 窗口处理 [{obs2}] 后按 Enter 继续 (Ctrl+C 跳过)...")

        # ── 人工提交 ──
        log("=" * 50, "WARN")
        log("🖐️ 请在 Chrome 窗口检查内容，手动点击发布/提交按钮!", "WARN")
        log("=" * 50, "WARN")
        input("🖐️ 发布完成后按 Enter 继续 (Ctrl+C 跳过)...")
        await asyncio.sleep(3)
        result_url = page.url
        log(f"结果 URL: {result_url}", "OK")
        update_sheet(ws, job["sheet_row"], "已发布", result_url, job["platform"])

        return True
    except Exception as e:
        log(f"异常: {e}", "FAIL")
        update_sheet(ws, job["sheet_row"], "失败", str(e)[:200], job["platform"])
        input(f"🖐️ 发生异常 [{e}]，请检查 Chrome 窗口后按 Enter 继续...")
        return False
    finally:
        await pw.stop()


async def main():
    log("=" * 55)
    log("CDP 批量外链内容发布 — translatepdfonline.com")
    log(f"共 {len(PLATFORM_JOBS)} 个平台")
    log("=" * 55)
    ws = init_sheet()
    log("Google Sheet 已连接", "OK")
    # 可选: 从特定索引开始
    start = 0
    if len(sys.argv) > 1:
        try:
            start = int(sys.argv[1]) - 1
        except:
            pass
    results = {"success": 0, "failed": 0, "skipped": 0}
    # 从后往前遍历
    total = len(PLATFORM_JOBS)
    for idx in range(total - 1, -1, -1):
        job = PLATFORM_JOBS[idx]
        if idx < start:
            continue
        log(f"\n{'▼'*40}")
        log(f"[{total - idx}/{total}] {job['platform']}", "INFO")
        ok = await publish_one(job, ws)
        if ok:
            results["success"] += 1
        else:
            results["failed"] += 1
        if idx > 0:
            log("\n⏳ 等待 15 秒...")
            await asyncio.sleep(15)
    log(f"\n{'='*55}")
    log("批量发布完成!", "OK")
    log(f"  ✅ 成功: {results['success']}")
    log(f"  ❌ 失败: {results['failed']}")
    log(f"  📊 总计: {len(PLATFORM_JOBS)}")
    log(f"{'='*55}")


if __name__ == "__main__":
    asyncio.run(main())
