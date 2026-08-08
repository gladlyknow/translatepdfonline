#!/bin/bash
# 启动指纹 Chrome 实例 (CDP 端口 9222)
# 带反检测 flags，绕过 CDN/WAF

set -e

# 自动检测 DISPLAY
if [ -z "$DISPLAY" ]; then
    for d in :10.0 :10 :0.0 :0 :1.0 :1; do
        if xdpyinfo -display "$d" >/dev/null 2>&1; then
            export DISPLAY="$d"
            echo "🔍 自动检测 DISPLAY=$DISPLAY"
            break
        fi
    done
fi

CHROME="/usr/bin/google-chrome"
PORT=9222
PROFILE_DIR="/tmp/chrome-fingerprint-profile"

# 检查是否已经在运行
if ss -tlnp 2>/dev/null | grep -q ":${PORT}"; then
    echo "⚠️ 端口 ${PORT} 已被占用"
    ss -tlnp | grep ":${PORT}"
    echo ""
    echo "如需重启，请先结束占用进程："
    echo "  kill \$(ss -tlnp | grep ':${PORT}' | grep -oP 'pid=\K\d+')"
    exit 1
fi

echo "🚀 启动指纹 Chrome..."
echo "   端口: ${PORT}"
echo "   配置目录: ${PROFILE_DIR}"
echo ""

# 确保 profile 目录存在
mkdir -p "${PROFILE_DIR}"

# 启动 Chrome with 反检测 flags
"${CHROME}" \
    --remote-debugging-port="${PORT}" \
    --user-data-dir="${PROFILE_DIR}" \
    --no-sandbox \
    --disable-gpu \
    --disable-blink-features=AutomationControlled \
    --disable-features=IsolateOrigins,site-per-process \
    --disable-infobars \
    --disable-dev-shm-usage \
    --disable-web-security \
    --disable-features=TranslateUI \
    --disable-component-extensions-with-background-pages \
    --disable-client-side-phishing-detection \
    --disable-default-apps \
    --disable-extensions \
    --disable-hang-monitor \
    --disable-popup-blocking \
    --disable-prompt-on-repost \
    --disable-sync \
    --enable-features=NetworkService,NetworkServiceInProcess \
    --force-color-profile=srgb \
    --metrics-recording-only \
    --no-first-run \
    --password-store=basic \
    --use-mock-keychain \
    --window-size=1920,1080 \
    --hide-scrollbars \
    --mute-audio \
    about:blank &

CHROME_PID=$!
echo "Chrome PID: ${CHROME_PID}"

# 等待 CDP 就绪
echo "⏳ 等待 CDP 就绪..."
for i in $(seq 1 30); do
    if curl -s --max-time 2 "http://localhost:${PORT}/json/version" > /dev/null 2>&1; then
        echo "✅ CDP 就绪 (${i}s)"
        curl -s "http://localhost:${PORT}/json/version" | python3 -c "import sys,json;d=json.load(sys.stdin);print(f'   Browser: {d.get(\"Browser\",\"?\")}');print(f'   User-Agent: {d.get(\"User-Agent\",\"?\")[:80]}')"
        echo ""
        echo "连接方式:"
        echo "  cdp_url = \"http://localhost:${PORT}\""
        echo ""
        echo "结束 Chrome: kill ${CHROME_PID}"
        exit 0
    fi
    sleep 1
done

echo "❌ CDP 启动超时"
kill ${CHROME_PID} 2>/dev/null
exit 1
