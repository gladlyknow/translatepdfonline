#!/usr/bin/env bash
#
# perf-test.sh — Lighthouse 性能测试一键脚本
#
# 用法:
#   URL=https://www.translatepdfonline.com bash scripts/perf-test.sh
#   URL=https://translatepdfonline-dev.gladlyknow.workers.dev bash scripts/perf-test.sh
#   或通过 npm scripts: pnpm perf:test:prod / pnpm perf:test:dev
#
# 输出: tmp/perf-reports/<timestamp>/
#   - mobile.json / mobile.html
#   - desktop.json / desktop.html
#   - summary.txt       (终端可读摘要)

set -euo pipefail

TARGET_URL="${URL:-https://www.translatepdfonline.com}"
REPORT_DIR="tmp/perf-reports/$(date +%Y%m%d_%H%M%S)"
mkdir -p "$REPORT_DIR"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}═════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  Lighthouse 性能测试${NC}"
echo -e "${CYAN}  目标: ${TARGET_URL}${NC}"
echo -e "${CYAN}  时间: $(date '+%Y-%m-%d %H:%M:%S')${NC}"
echo -e "${CYAN}═════════════════════════════════════════════════════════${NC}"
echo ""

# ─── Mobile (默认，无需 --preset) ──────────────────────────
echo -e "${YELLOW}[1/2] 测试 Mobile...${NC}"
npx lighthouse "$TARGET_URL" \
  --chrome-flags="--headless --no-sandbox" \
  --output=json \
  --output=html \
  --output-path="${REPORT_DIR}/mobile" \
  --only-categories=performance 2>&1 | tail -3

MOBILE_SCORE=$(python3 -c "
import json
try:
    with open('${REPORT_DIR}/mobile.report.json') as f:
        data = json.load(f)
    score = data['categories']['performance']['score']
    print(f'{score*100:.0f}')
except: print('?')
" 2>/dev/null)

echo -e "${GREEN}  Mobile 性能分数: ${MOBILE_SCORE:-?}/100${NC}"
echo ""

# ─── Desktop ──────────────────────────────────────────────
echo -e "${YELLOW}[2/2] 测试 Desktop...${NC}"
npx lighthouse "$TARGET_URL" \
  --chrome-flags="--headless --no-sandbox" \
  --output=json \
  --output=html \
  --output-path="${REPORT_DIR}/desktop" \
  --preset=desktop \
  --only-categories=performance 2>&1 | tail -3

DESKTOP_SCORE=$(python3 -c "
import json
try:
    with open('${REPORT_DIR}/desktop.report.json') as f:
        data = json.load(f)
    score = data['categories']['performance']['score']
    print(f'{score*100:.0f}')
except: print('?')
" 2>/dev/null)

echo -e "${GREEN}  Desktop 性能分数: ${DESKTOP_SCORE:-?}/100${NC}"
echo ""

# ─── 摘要 ─────────────────────────────────────────────────
SUMMARY="${REPORT_DIR}/summary.txt"

python3 -c "
import json, os

def extract_metrics(report_dir, strategy):
    path = os.path.join(report_dir, f'{strategy}.report.json')
    if not os.path.exists(path):
        return None
    with open(path) as f:
        data = json.load(f)
    cats = data['categories']
    audits = data['audits']
    return {
        'score': cats['performance']['score'] * 100,
        'fcp':  audits.get('first-contentful-paint', {}).get('displayValue', '?'),
        'lcp':  audits.get('largest-contentful-paint', {}).get('displayValue', '?'),
        'tbt':  audits.get('total-blocking-time', {}).get('displayValue', '?'),
        'cls':  audits.get('cumulative-layout-shift', {}).get('displayValue', '?'),
        'si':   audits.get('speed-index', {}).get('displayValue', '?'),
    }

mobile = extract_metrics('${REPORT_DIR}', 'mobile')
desktop = extract_metrics('${REPORT_DIR}', 'desktop')

lines = []
lines.append('═══════════════════════════════════════════════')
lines.append('  Lighthouse 性能摘要')
lines.append('  目标: ${TARGET_URL}')
lines.append('═══════════════════════════════════════════════')
lines.append('')

for label, m in [('Mobile', mobile), ('Desktop', desktop)]:
    if not m:
        lines.append(f'{label}: 数据缺失')
        continue
    lines.append(f'  [{label}]')
    lines.append(f'    性能分数: {m[\"score\"]:.0f}/100')
    lines.append(f'    FCP:  {m[\"fcp\"]}')
    lines.append(f'    LCP:  {m[\"lcp\"]}')
    lines.append(f'    TBT:  {m[\"tbt\"]}')
    lines.append(f'    CLS:  {m[\"cls\"]}')
    lines.append(f'    SI:   {m[\"si\"]}')
    lines.append('')

# 判断是否达标
if mobile:
    lines.append('  达标检查 (Mobile):')
    checks = [
        ('LCP < 2.5s', 'largest-contentful-paint', 'numericValue', lambda v: v < 2500),
        ('FCP < 1.8s', 'first-contentful-paint', 'numericValue', lambda v: v < 1800),
        ('TBT < 200ms', 'total-blocking-time', 'numericValue', lambda v: v < 200),
        ('CLS < 0.1', 'cumulative-layout-shift', 'numericValue', lambda v: v < 0.1),
        ('SI < 3.4s', 'speed-index', 'numericValue', lambda v: v < 3400),
    ]
    for label, audit_key, field, check in checks:
        val = mobile.get(audit_key, {})
        if val:
            ok = check(val.get(field, float('inf')))
            mark = '✅' if ok else '❌'
            lines.append(f'    {mark} {label} ({val.get(\"displayValue\", \"?\")})')

text = '\n'.join(lines)
print(text)

with open('${SUMMARY}', 'w') as f:
    f.write(text + '\n')
"

echo ""
echo -e "${CYAN}═════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  报告已保存到: ${REPORT_DIR}/${NC}"
echo -e "${CYAN}    mobile.report.html   — Mobile 详细报告${NC}"
echo -e "${CYAN}    desktop.report.html  — Desktop 详细报告${NC}"
echo -e "${CYAN}    summary.txt          — 摘要${NC}"
echo -e "${CYAN}═════════════════════════════════════════════════════════${NC}"
