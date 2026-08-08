#!/usr/bin/env python3
"""CDP 批量外链提交 — 6 个博客站点"""

import asyncio, json, os, re, sys
from playwright.async_api import async_playwright
from datetime import datetime
from google.oauth2 import service_account
import gspread

CDP_URL = "http://localhost:9222"
IDENTITY = {"author": "Alex Morgan", "email": "alex@seedaudioprompts.com", "url": "https://seedaudioprompts.com"}

JOBS = [
    {
        "url": "https://blogs.urz.uni-halle.de/startklar/quellen-und-verweise/comment-page-1/",
        "pid": "63",
        "site": "blogs.urz.uni-halle.de",
        "short": "uni-halle",
        "angle": "教育/有声书",
        "comment": ("Great resource on academic sourcing! In education, we're seeing AI tools transform how students engage with materials. "
                    "I've been using Seed Audio Prompts (seedaudioprompts.com) to convert study notes into audio — it supports 30+ languages "
                    "and produces surprisingly natural voiceovers. Might be an interesting addition to your digital toolkit discussion.")
    },
    {
        "url": "https://blog.myesr.org/espanol/los-casos-de-dr-pepe-caso-de-torax-12/",
        "pid": "6853",
        "site": "blog.myesr.org",
        "short": "myesr",
        "angle": "教育/多语言",
        "comment": ("Excelente caso clínico, muy didáctico. En el ámbito de la educación médica, las herramientas de texto a voz con IA "
                    "están facilitando el aprendizaje multilingüe. He estado usando Seed Audio Prompts (seedaudioprompts.com) para crear "
                    "materiales de estudio en audio en varios idiomas — útil para residentes que prefieren aprender escuchando. ¡Gracias por compartir!")
    },
    {
        "url": "https://blogs.deusto.es/innovandis/llegando-al-nivel-pro-con-lxs-20g-e",
        "pid": "2584",
        "site": "blogs.deusto.es",
        "short": "deusto",
        "angle": "视频旁白/多语言",
        "comment": ("Interesante artículo sobre innovación tecnológica. Hablando de herramientas emergentes, la generación de voz con IA "
                    "está cambiando la creación de contenido. Seed Audio Prompts (seedaudioprompts.com) permite generar locuciones "
                    "en más de 30 idiomas directamente desde texto — ideal para proyectos educativos multimedia. Una herramienta que "
                    "vale la pena explorar en el contexto de la innovación digital.")
    },
    {
        "url": "https://pixel77.com/typography-rules-technique/",
        "pid": "33737",
        "site": "pixel77.com (typography)",
        "short": "pixel77-typo",
        "angle": "播客制作",
        "comment": ("Excellent breakdown of typography principles! As designers, we're always looking for tools that streamline our workflow. "
                    "Beyond visual design, I've found AI audio tools incredibly useful — Seed Audio Prompts (seedaudioprompts.com) "
                    "turns scripts into professional voiceovers for design presentations and podcast intros. The voice quality across 30+ "
                    "languages is impressive. Great complement to the visual work we do!")
    },
    {
        "url": "https://pixel77.com/fonts-for-posters/",
        "pid": "633637",
        "site": "pixel77.com (fonts)",
        "short": "pixel77-fonts",
        "angle": "多语言内容",
        "comment": ("Great font collection for poster design! Speaking of creative tools, I recently discovered Seed Audio Prompts "
                    "(seedaudioprompts.com) for adding voiceovers to design presentations. It generates broadcast-quality audio from text "
                    "in 30+ languages — perfect for multilingual design pitches. Thanks for the typography inspiration!")
    },
    {
        "url": "https://www.madrimasd.org/blogs/matematicas/2024/02/11/150483",
        "pid": "150483",
        "site": "madrimasd.org",
        "short": "madrimasd",
        "angle": "有声书/教育",
        "comment": ("Una iniciativa fantástica para celebrar las matemáticas. En educación STEM, las herramientas de audio con IA "
                    "están abriendo nuevas formas de aprendizaje. Seed Audio Prompts (seedaudioprompts.com) convierte apuntes y "
                    "explicaciones matemáticas en audio de calidad profesional en 30+ idiomas — muy útil para estudiantes con "
                    "diferentes estilos de aprendizaje. ¡Enhorabuena por el workshop!")
    },
]

def log(msg, level="INFO"):
    ts = datetime.now().strftime("%H:%M:%S")
    p = {"INFO":"📋","OK":"✅","FAIL":"❌","WARN":"⚠️","SKIP":"⏭️","PAUSE":"⏸️"}.get(level,"•")
    print(f"{p} [{ts}] {msg}", flush=True)

# Init Google Sheets
key_data = json.loads(os.environ['GOOGLE_SERVICE_ACCOUNT_KEY'])
creds = service_account.Credentials.from_service_account_info(key_data, scopes=['https://www.googleapis.com/auth/spreadsheets'])
gc = gspread.authorize(creds)
sh = gc.open_by_key('1pW4uSCCah23yW8F4BvTrb0qQySzFa5GNGgSeKDiBfWM')
ws = sh.worksheet('无需登录外链')
vals = ws.get_all_values()
headers = vals[0]

def update_sheet(keyword, status, detail, comment_text="", angle=""):
    vals = ws.get_all_values()
    for i, row in enumerate(vals):
        if keyword.lower() in str(row).lower():
            r = i + 1
            now_str = datetime.now().strftime('%Y%m%d')
            if len(headers) > 3: ws.update_cell(r, 4, f"{keyword}-{now_str}")
            if len(headers) > 4: ws.update_cell(r, 5, f"[{angle}] {comment_text[:400]}")
            if len(headers) > 5: ws.update_cell(r, 6, detail)
            sc = next((j+1 for j,h in enumerate(headers) if h.strip()=='状态'), None)
            if sc: ws.update_cell(r, sc, status)
            return True
    return False

async def submit_one(job):
    url = job['url']
    log(f"\n{'='*55}")
    log(f"站点: {job['site']}")
    log(f"角度: {job['angle']}")
    log(f"{'='*55}")

    pw = await async_playwright().start()
    try:
        browser = await pw.chromium.connect_over_cdp(CDP_URL)
        page = browser.contexts[0].pages[0] if browser.contexts[0].pages else await browser.contexts[0].new_page()

        log(f"导航...")
        await page.goto(url, wait_until="domcontentloaded", timeout=30000)
        await asyncio.sleep(3)
        c = (await page.content()).lower()

        # ── 检测障碍 ──
        if any(s in c for s in ["just a moment", "checking your browser", "access denied"]):
            log("⚠️ 反爬拦截！标记需人工处理", "PAUSE")
            update_sheet(job['short'], "需人工处理-反爬", "CDP检测到反爬拦截", job['comment'], job['angle'])
            input("请在 Chrome 窗口处理后按 Enter 继续（或 Ctrl+C 跳过）...")
            return False

        captcha = await page.query_selector(".g-recaptcha, iframe[src*='recaptcha'], iframe[src*='hcaptcha'], .cf-turnstile")
        if captcha:
            log("⚠️ 验证码！标记需人工处理", "PAUSE")
            update_sheet(job['short'], "需人工处理-验证码", "CDP检测到验证码", job['comment'], job['angle'])
            input("请在 Chrome 窗口完成验证码后按 Enter 继续（或 Ctrl+C 跳过）...")
            # Reload page state
            await asyncio.sleep(2)

        pwd = await page.query_selector("input[type='password']")
        if pwd and "comment" not in (await page.content()).lower()[:500]:
            log("⚠️ 登录要求！标记需人工处理", "PAUSE")
            update_sheet(job['short'], "需人工处理-登录", "CDP检测到密码输入框", job['comment'], job['angle'])
            input("请登录后按 Enter 继续（或 Ctrl+C 跳过）...")
            await page.goto(url, wait_until="domcontentloaded", timeout=30000)
            await asyncio.sleep(2)

        if "comments are closed" in c or "commenting is closed" in c:
            log("评论已关闭", "SKIP")
            update_sheet(job['short'], "评论已关闭", "页面标记评论已关闭")
            return False

        # ── 填写表单 ──
        log("填写 WordPress 评论表单...")
        for fid, val in [("#author", IDENTITY["author"]), ("#email", IDENTITY["email"]),
                          ("#url", IDENTITY["url"]), ("#comment", job["comment"])]:
            sel = f"{fid}, input[name='{fid[1:]}'], textarea[name='{fid[1:]}']"
            el = await page.query_selector(sel)
            if el:
                await el.click()
                await el.fill(val)
        log(f"✅ 已填写 (角度: {job['angle']})", "OK")

        # ── 倒计时 → 用户可在 Chrome 窗口查看 ──
        log("", "WARN")
        log("="*50, "WARN")
        log("3 秒后自动提交，请检查 Chrome 窗口!", "WARN")
        log("="*50, "WARN")
        for i in range(3, 0, -1):
            print(f"  {i}...", flush=True)
            await asyncio.sleep(1)

        # ── 提交 ──
        submit = await page.query_selector("#submit, input[type='submit'][name='submit']")
        if submit:
            await submit.click()
        else:
            await page.keyboard.press("Enter")
        log("已提交", "OK")

        await asyncio.sleep(5)

        # ── 结果 ──
        result_url = page.url
        result_content = (await page.content()).lower()

        if "unapproved" in result_url or "comment-" in result_url:
            cid = re.search(r'unapproved=(\d+)', result_url)
            cid2 = re.search(r'#comment-(\d+)', result_url)
            comment_id = cid.group(1) if cid else (cid2.group(1) if cid2 else "?")
            log(f"✅ 待审核! comment-{comment_id}", "OK")
            update_sheet(job['short'], "待审核", f"comment-{comment_id}", job['comment'], job['angle'])
            return True
        elif "error" in result_content or "wp-comments-post.php" in result_url:
            log("提交可能失败", "FAIL")
            update_sheet(job['short'], "失败", f"异常: {result_url[:100]}", job['comment'], job['angle'])
            return False
        elif "duplicate" in result_content:
            log("重复评论", "SKIP")
            update_sheet(job['short'], "重复", "检测到重复评论")
            return False
        else:
            log("提交完成(状态未知)", "OK")
            update_sheet(job['short'], "待审核", "提交完成,状态未知", job['comment'], job['angle'])
            return True

    except Exception as e:
        log(f"异常: {e}", "FAIL")
        return False
    finally:
        await pw.stop()

async def main():
    log("="*55)
    log("CDP 批量外链提交 — 6 个博客站点")
    log("="*55)

    results = {"success": 0, "human_needed": 0, "failed": 0, "skipped": 0}

    # Allow starting from specific index
    start = 0
    if len(sys.argv) > 1:
        try: start = int(sys.argv[1]) - 1
        except: pass

    for i, job in enumerate(JOBS):
        if i < start:
            continue
        log(f"\n{'▼'*40}")
        log(f"[{i+1}/{len(JOBS)}]", "INFO")
        ok = await submit_one(job)
        if ok: results["success"] += 1
        else: results["failed"] += 1
        if i < len(JOBS) - 1:
            log(f"\n⏳ 等待 10 秒...")
            await asyncio.sleep(10)

    log(f"\n{'='*55}")
    log(f"本轮完成!", "OK")
    log(f"  ✅ 成功: {results['success']}")
    log(f"  ❌ 失败: {results['failed']}")
    log(f"  📊 总计: {len(JOBS)}")
    log(f"{'='*55}")

if __name__ == "__main__":
    asyncio.run(main())
