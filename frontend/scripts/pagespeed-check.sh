#!/bin/bash
#=============================================================================
# PageSpeed Insights API 检测脚本
# 版本: 1.0.0
#=============================================================================
#
# 概述：
#   使用 Google PageSpeed Insights API v5 对目标 URL 进行性能检测。
#   支持 mobile / desktop 双策略，覆盖 Performance / Accessibility /
#   Best Practices / SEO 四项分类评分。
#
#   仅依赖 curl + jq，零 npm/pip 依赖，复制到任意项目即可使用。
#
#-----------------------------------------------------------------------------
#
# [1] API 开通步骤
# ─────────────────
#   1. 前往 https://console.cloud.google.com/apis/
#   2. 点击 "＋ ENABLE APIS AND SERVICES"
#   3. 搜索 "PageSpeed Insights API" → 点击启用
#   4. 进入 https://console.cloud.google.com/apis/credentials
#   5. 点击 "＋ CREATE CREDENTIALS" → "API key"
#   6. 复制生成的 API Key
#   7. (可选) 在 Credentials 页面限制 Key：
#      - Application restrictions: 按需选择 HTTP referrers
#      - API restrictions: 仅勾选 "PageSpeed Insights API"
#
#-----------------------------------------------------------------------------
#
# [2] 环境变量配置
# ─────────────────
#   将以下内容添加到 ~/.bashrc 或项目的 .env 文件中：
#
#     export GOOGLE_SPEED_API_KEY="your-api-key-here"
#
#   脚本会自动读取该环境变量。也可通过 --key 参数直接传入。
#
#-----------------------------------------------------------------------------
#
# [3] 使用方式
# ─────────────
#   # 基础检测（可读报告）
#   ./pagespeed-check.sh "https://example.com"
#
#   # 指定策略
#   ./pagespeed-check.sh --strategy mobile "https://example.com"
#   ./pagespeed-check.sh --strategy both "https://example.com"
#
#   # JSON 输出（供脚本消费，含可读摘要）
#   ./pagespeed-check.sh --json "https://example.com"
#
#   # 纯 JSON 输出（无摘要，适合管道/CI）
#   ./pagespeed-check.sh --json-only "https://example.com"
#
#   # 指定 API Key
#   ./pagespeed-check.sh --key "AIzaSy..." "https://example.com"
#
#   # 自定义阈值（默认 90）
#   ./pagespeed-check.sh --threshold 80 "https://example.com"
#
#-----------------------------------------------------------------------------
#
# [4] 检测逻辑说明
# ─────────────────
#   调用 Google PSI API v5:
#     GET https://pagespeedonline.googleapis.com/pagespeedonline/v5/runPagespeed
#       ?url={URL}
#       &key={API_KEY}
#       &strategy={MOBILE|DESKTOP}
#       &category=PERFORMANCE
#       &category=ACCESSIBILITY
#       &category=BEST_PRACTICES
#       &category=SEO
#
#   返回两类数据：
#   - Field Data (loadingExperience):   Chrome UX Report 真实用户数据 (CrUX)
#   - Lab Data  (lighthouseResult):     Lighthouse 模拟审计数据
#
#   脚本从 lighthouseResult 提取：
#     categories.{name}.score    → 0-1 浮点数，×100 = 百分比评分
#     audits.{metric}            → FCP/LCP/TBT/CLS/Speed Index 等指标
#     audits (type=opportunity)  → 优化建议（可节省的资源量）
#     audits (type=diagnostic)   → 诊断信息
#
#-----------------------------------------------------------------------------
#
# [5] 评分标准
# ─────────────
#   Lighthouse 评分 (0-100):
#     90-100  🟢 Good
#     50-89   🟡 Needs Improvement
#     0-49    🔴 Poor
#
#   Core Web Vitals 阈值:
#     LCP (Largest Contentful Paint):  Good ≤ 2500ms, Poor > 4000ms
#     INP (Interaction to Next Paint): Good ≤ 200ms,  Poor > 500ms
#     CLS (Cumulative Layout Shift):   Good ≤ 0.1,    Poor > 0.25
#     FCP (First Contentful Paint):    Good ≤ 1800ms, Poor > 3000ms
#     TBT (Total Blocking Time):       Good ≤ 200ms,  Poor > 600ms
#
#-----------------------------------------------------------------------------
#
# [6] 注意事项 / 配额 / Key 安全性
# ──────────────────────────────────
#   - 免费使用，无需绑定信用卡
#   - 每日配额：约 25,000 次/天（Google 未公开确切数值）
#   - 每秒限制：约 1 QPS（查询每秒），脚本内置重试机制
#   - API Key 可嵌入 URL 中，Google 官方说明 "safe for embedding in URLs"
#   - 如果遇到 429 ( rate limit)，脚本会自动等待 60 秒后重试
#   - API 调用失败时自动重试 3 次（指数退避）
#   - 结果可能因测试地理位置、网络状况略有波动
#   - Field Data (CrUX) 需要 URL 有足够流量才可用，新站点通常无此数据
#
#-----------------------------------------------------------------------------
#
# [7] 输出格式说明
# ─────────────────
#   --summary (默认)：可读彩色报告
#     ==============================================
#       PageSpeed Insights 检测结果
#       URL: https://example.com
#       策略: mobile
#     ==============================================
#     📊 综合评分:
#       Performance:     89/100  ❌ (< 90)
#       Accessibility:   92/100  ✅
#       Best Practices: 100/100  ✅
#       SEO:            100/100  ✅
#     📈 核心指标: ...
#
#   --json：在 summary 输出后追加机器可读 JSON
#   --json-only：仅输出 JSON
#
#-----------------------------------------------------------------------------
#
# [8] 错误码说明
# ───────────────
#   0  全部评分 ≥ 阈值
#   1  存在评分 < 阈值
#   2  API 调用失败 / 网络错误 / 缺少依赖
#
#-----------------------------------------------------------------------------
#
# [9] 复用方式
# ─────────────
#   1. 复制本脚本到目标项目：
#        cp scripts/pagespeed-check.sh /path/to/other-project/scripts/
#   2. 确保 GOOGLE_SPEED_API_KEY 环境变量已设置
#   3. 直接使用：
#        ./scripts/pagespeed-check.sh "https://my-other-project.com"
#
#   无需安装任何依赖（curl + jq 系统预装）。
#
#=============================================================================

set -euo pipefail

#-----------------------------------------------------------------------------
# 配置默认值
#-----------------------------------------------------------------------------
DEFAULT_STRATEGY="mobile"
DEFAULT_THRESHOLD=90
DEFAULT_TIMEOUT=120

# PSI API 地址
PSI_API_BASE="https://pagespeedonline.googleapis.com/pagespeedonline/v5/runPagespeed"

# 日志文件
LOG_DIR="${TMPDIR:-/tmp}"
LOG_FILE="${LOG_DIR}/pagespeed-check-$(date +%Y%m%d-%H%M%S).log"

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

#-----------------------------------------------------------------------------
# 辅助函数
#-----------------------------------------------------------------------------

# 打印带颜色的消息
info()    { echo -e "${BLUE}ℹ${NC}  $*"; echo "[$(date '+%H:%M:%S')] INFO  $*" >> "$LOG_FILE"; }
success() { echo -e "${GREEN}✅${NC} $*"; echo "[$(date '+%H:%M:%S')] OK    $*" >> "$LOG_FILE"; }
warn()    { echo -e "${YELLOW}⚠${NC}  $*"; echo "[$(date '+%H:%M:%S')] WARN  $*" >> "$LOG_FILE"; }
error()   { echo -e "${RED}❌${NC} $*" >&2; echo "[$(date '+%H:%M:%S')] ERROR $*" >> "$LOG_FILE"; }

# 检查依赖
check_dependencies() {
  local missing=()

  if ! command -v curl &>/dev/null; then
    missing+=("curl")
  fi
  if ! command -v jq &>/dev/null; then
    missing+=("jq")
  fi

  if [ ${#missing[@]} -gt 0 ]; then
    error "缺少依赖: ${missing[*]}"
    echo ""
    echo "安装方式:"
    echo "  sudo apt install ${missing[*]}"
    exit 2
  fi
}

# 获取评分对应的颜色和图标
score_icon() {
  local score=$(printf "%.0f" "$1" 2>/dev/null || echo "0")
  if [ "$score" -ge 90 ]; then
    echo -e "${GREEN}✅${NC}"
  elif [ "$score" -ge 50 ]; then
    echo -e "${YELLOW}⚠${NC}"
  else
    echo -e "${RED}❌${NC}"
  fi
}

score_label() {
  local score=$(printf "%.0f" "$1" 2>/dev/null || echo "0")
  if [ "$score" -ge 90 ]; then
    echo -e "${GREEN}Good${NC}"
  elif [ "$score" -ge 50 ]; then
    echo -e "${YELLOW}Needs Improvement${NC}"
  else
    echo -e "${RED}Poor${NC}"
  fi
}

metric_label() {
  local value="$1"
  local good="$2"
  local poor="$3"
  local unit="$4"

  if [ "$value" = "N/A" ] || [ -z "$value" ]; then
    echo "N/A"
    return
  fi

  local num=$(echo "$value" | grep -oE '[0-9]+\.?[0-9]*' | head -1)
  if [ -z "$num" ]; then
    echo "$value"
    return
  fi

  local is_good=$(echo "$num <= $good" | bc -l 2>/dev/null || echo "0")
  local is_poor=$(echo "$num > $poor" | bc -l 2>/dev/null || echo "0")

  if [ "$is_poor" = "1" ]; then
    echo -e "${RED}${value}${NC}"
  elif [ "$is_good" = "1" ]; then
    echo -e "${GREEN}${value}${NC}"
  else
    echo -e "${YELLOW}${value}${NC}"
  fi
}

#-----------------------------------------------------------------------------
# API 调用
#-----------------------------------------------------------------------------

# 调用 PSI API，返回原始 JSON
call_psi_api() {
  local url="$1"
  local strategy="$2"
  local api_key="$3"
  local attempt=1
  local max_attempts=3

  # 构造 URL
  local api_url="${PSI_API_BASE}?url=$(jq -rn --arg url "${url}" '$url|@uri' 2>/dev/null || echo "${url}")"
  api_url="${api_url}&key=${api_key}"
  api_url="${api_url}&strategy=$(echo "$strategy" | tr '[:lower:]' '[:upper:]')"
  api_url="${api_url}&category=PERFORMANCE"
  api_url="${api_url}&category=ACCESSIBILITY"
  api_url="${api_url}&category=BEST_PRACTICES"
  api_url="${api_url}&category=SEO"

  while [ $attempt -le $max_attempts ]; do
    local response
    local http_code

    response=$(curl -s -w "\n%{http_code}" \
      --max-time "$DEFAULT_TIMEOUT" \
      "$api_url" 2>/dev/null) || true

    http_code=$(echo "$response" | tail -1)
    local body=$(echo "$response" | sed '$d')

    # 检查 HTTP 状态
    if [ "$http_code" = "200" ]; then
      echo "$body"
      return 0
    elif [ "$http_code" = "429" ]; then
      warn "PSI API 限流 (429)，等待 60 秒后重试..."
      sleep 60
    elif [ "$http_code" = "403" ]; then
      error "PSI API 认证失败 (403)，请检查 GOOGLE_SPEED_API_KEY"
      echo "$body" >&2
      return 1
    else
      warn "PSI API 返回 HTTP $http_code，重试 $attempt/$max_attempts..."
      sleep $((2 ** attempt))
    fi

    attempt=$((attempt + 1))
  done

  error "PSI API 调用失败，已重试 $max_attempts 次"
  return 1
}

#-----------------------------------------------------------------------------
# 结果解析
#-----------------------------------------------------------------------------

# 解析各项评分，输出 "category score" 格式
parse_scores() {
  local json="$1"
  local categories=("performance" "accessibility" "best-practices" "seo")

  for cat in "${categories[@]}"; do
    local score
    score=$(echo "$json" | jq -r ".lighthouseResult.categories[\"${cat}\"].score // \"null\"")
    if [ "$score" = "null" ]; then
      echo "${cat} N/A"
    else
      # score 是 0-1 的浮点数
      local pct=$(echo "$score * 100" | bc -l 2>/dev/null | awk '{printf "%.0f", $0}')
      echo "${cat} ${pct}"
    fi
  done
}

# 解析核心 Web Vitals 指标
parse_metrics() {
  local json="$1"

  echo "$json" | jq -r '
    def get_metric($key; $fallback):
      (.lighthouseResult.audits[$key] // {}) as $audit
      | if $audit.numericValue then
          ($audit.numericValue | tostring)
        else
          $fallback
        end;

    def get_display($key; $fallback):
      (.lighthouseResult.audits[$key] // {}) as $audit
      | if $audit.displayValue then
          $audit.displayValue
        else
          $fallback
        end;

    {
      fcp: { value: get_metric("first-contentful-paint"; "N/A"), display: get_display("first-contentful-paint"; "N/A") },
      lcp: { value: get_metric("largest-contentful-paint"; "N/A"), display: get_display("largest-contentful-paint"; "N/A") },
      tbt: { value: get_metric("total-blocking-time"; "N/A"), display: get_display("total-blocking-time"; "N/A") },
      cls: { value: get_metric("cumulative-layout-shift"; "N/A"), display: get_display("cumulative-layout-shift"; "N/A") },
      si:  { value: get_metric("speed-index"; "N/A"), display: get_display("speed-index"; "N/A") },
      tti: { value: get_metric("interactive"; "N/A"), display: get_display("interactive"; "N/A") }
    }
  '
}

# 解析优化机会（Opportunities）
parse_opportunities() {
  local json="$1"

  echo "$json" | jq -r '
    [.lighthouseResult.audits | to_entries[]
     | select(.value.details != null)
     | select(.value.details.type == "opportunity")
     | select(.value.score != null and .value.score < 1)
     | {
         title: .value.title,
         description: .value.description,
         score: .value.score,
         displayValue: .value.displayValue,
         numericValue: .value.numericValue
       }]
    | sort_by(.numericValue)
    | reverse
    | .[:10]
  '
}

# 解析诊断信息（Diagnostics）
parse_diagnostics() {
  local json="$1"

  echo "$json" | jq -r '
    [.lighthouseResult.audits | to_entries[]
     | select(.value.details != null)
     | select(.value.details.type == "diagnostic")
     | select(.value.score != null and .value.score < 1)
     | {
         title: .value.title,
         description: .value.description,
         displayValue: .value.displayValue
       }]
    | sort_by(.title)
  '
}

# 解析 Field Data (CrUX)
parse_field_data() {
  local json="$1"

  echo "$json" | jq -r '
    .loadingExperience // {} | .metrics // {} | {
      FIRST_CONTENTFUL_PAINT_MS: (.FIRST_CONTENTFUL_PAINT_MS // {}),
      LARGEST_CONTENTFUL_PAINT_MS: (.LARGEST_CONTENTFUL_PAINT_MS // {}),
      INTERACTION_TO_NEXT_PAINT: (.INTERACTION_TO_NEXT_PAINT // {}),
      CUMULATIVE_LAYOUT_SHIFT_SCORE: (.CUMULATIVE_LAYOUT_SHIFT_SCORE // {}),
      EXPERIMENTAL_TIME_TO_FIRST_BYTE: (.EXPERIMENTAL_TIME_TO_FIRST_BYTE // {})
    }
  '
}

#-----------------------------------------------------------------------------
# 输出格式化
#-----------------------------------------------------------------------------

print_summary() {
  local url="$1"
  local strategy="$2"
  local threshold="$3"
  local json="$4"

  echo ""
  echo -e "${BOLD}=============================================${NC}"
  echo -e "${BOLD}  PageSpeed Insights 检测结果${NC}"
  echo -e "${BOLD}  URL: ${CYAN}${url}${NC}"
  echo -e "${BOLD}  策略: ${strategy}${NC}"
  echo -e "${BOLD}  时间: $(date '+%Y-%m-%d %H:%M:%S')${NC}"
  echo -e "${BOLD}=============================================${NC}"
  echo ""

  # ---- 综合评分 ----
  echo -e "${BOLD}📊 综合评分 (Lab Data):${NC}"
  echo ""

  local all_pass=true
  local categories=("performance" "accessibility" "best-practices" "seo")
  local cat_names=("Performance" "Accessibility" "Best Practices" "SEO")

  for i in "${!categories[@]}"; do
    local cat="${categories[$i]}"
    local name="${cat_names[$i]}"
    local score
    score=$(echo "$json" | jq -r ".lighthouseResult.categories[\"${cat}\"].score // \"null\"")

    if [ "$score" = "null" ]; then
      printf "  %-22s ${YELLOW}N/A${NC}\n" "${name}:"
    else
      local pct=$(echo "$score * 100" | bc -l 2>/dev/null | awk '{printf "%.0f", $0}')
      local icon=$(score_icon "$pct")

      if [ "$pct" -lt "$threshold" ]; then
        all_pass=false
        printf "  %-22s %3s/100  ${icon} ${RED}(< ${threshold})${NC}\n" "${name}:" "$pct"
      else
        printf "  %-22s %3s/100  ${icon}\n" "${name}:" "$pct"
      fi
    fi
  done

  echo ""

  # ---- 核心 Web Vitals (Lab) ----
  echo -e "${BOLD}📈 核心指标 (Lab Data):${NC}"
  echo ""

  local fcp=$(echo "$json" | jq -r '.lighthouseResult.audits["first-contentful-paint"].displayValue // "N/A"')
  local lcp=$(echo "$json" | jq -r '.lighthouseResult.audits["largest-contentful-paint"].displayValue // "N/A"')
  local tbt=$(echo "$json" | jq -r '.lighthouseResult.audits["total-blocking-time"].displayValue // "N/A"')
  local cls=$(echo "$json" | jq -r '.lighthouseResult.audits["cumulative-layout-shift"].displayValue // "N/A"')
  local si=$(echo "$json" | jq -r '.lighthouseResult.audits["speed-index"].displayValue // "N/A"')

  printf "  %-8s %s\n" "FCP:" "$(echo "$fcp" | tr -d '\n')"
  printf "  %-8s %s\n" "LCP:" "$(echo "$lcp" | tr -d '\n')"
  printf "  %-8s %s\n" "TBT:" "$(echo "$tbt" | tr -d '\n')"
  printf "  %-8s %s\n" "CLS:" "$(echo "$cls" | tr -d '\n')"
  printf "  %-8s %s\n" "SpeedIdx:" "$(echo "$si" | tr -d '\n')"

  echo ""

  # ---- Field Data ----
  local has_field=$(echo "$json" | jq -r '.loadingExperience.metrics // {} | keys | length')
  if [ "$has_field" -gt 0 ] 2>/dev/null; then
    echo -e "${BOLD}📡 真实用户数据 (Field Data / CrUX):${NC}"
    echo ""

    local ffcp=$(echo "$json" | jq -r '.loadingExperience.metrics.FIRST_CONTENTFUL_PAINT_MS.percentile // -1')
    local flcp=$(echo "$json" | jq -r '.loadingExperience.metrics.LARGEST_CONTENTFUL_PAINT_MS.percentile // -1')
    local finp=$(echo "$json" | jq -r '.loadingExperience.metrics.INTERACTION_TO_NEXT_PAINT.percentile // -1')
    local fcls=$(echo "$json" | jq -r '.loadingExperience.metrics.CUMULATIVE_LAYOUT_SHIFT_SCORE.percentile // -1')

    [ "$ffcp" != "-1" ] && printf "  %-8s %.0f ms (75th percentile)\n" "FCP:" "$ffcp"
    [ "$flcp" != "-1" ] && printf "  %-8s %.0f ms (75th percentile)\n" "LCP:" "$flcp"
    [ "$finp" != "-1" ] && printf "  %-8s %.0f ms (75th percentile)\n" "INP:" "$finp"
    [ "$fcls" != "-1" ] && printf "  %-8s %.3f (75th percentile)\n" "CLS:" "$fcls"

    echo ""
  fi

  # ---- 优化建议 ----
  echo -e "${BOLD}🔧 优化建议 (Opportunities):${NC}"
  echo ""

  local opp_count=$(echo "$json" | jq -r '[.lighthouseResult.audits | to_entries[] | select(.value.details != null) | select(.value.details.type == "opportunity") | select(.value.score != null and .value.score < 1)] | length')
  if [ "$opp_count" -gt 0 ] 2>/dev/null; then
    echo "$json" | jq -r '
      [.lighthouseResult.audits | to_entries[]
       | select(.value.details != null)
       | select(.value.details.type == "opportunity")
       | select(.value.score != null and .value.score < 1)
       | {title: .value.title, displayValue: .value.displayValue}]
      | sort_by(.title)
      | .[] | "  • \(.title) — \(.displayValue // "N/A")"
    ' 2>/dev/null
  else
    echo "  (无)"
  fi

  echo ""

  # ---- 总评 ----
  echo -e "${BOLD}─────────────────────────────────────────────${NC}"
  if [ "$all_pass" = true ]; then
    success "达标！全部评分 ≥ ${threshold}"
  else
    local fail_count=0
    for cat in "${categories[@]}"; do
      local s
      s=$(echo "$json" | jq -r ".lighthouseResult.categories[\"${cat}\"].score // 0")
      local pct=$(echo "$s * 100" | bc -l 2>/dev/null | awk '{printf "%.0f", $0}')
      if [ "$pct" -lt "$threshold" ] 2>/dev/null; then
        fail_count=$((fail_count + 1))
      fi
    done
    warn "未达标：${fail_count} 项评分 < ${threshold}，需要优化"
  fi
  echo ""
}

#-----------------------------------------------------------------------------
# 参数解析
#-----------------------------------------------------------------------------

usage() {
  cat <<EOF
用法: $0 [选项] <URL>

选项:
  --strategy <mobile|desktop|both>  检测策略 (默认: mobile)
  --key <API_KEY>                   Google API Key (默认: \$GOOGLE_SPEED_API_KEY)
  --threshold <N>                   达标阈值 (默认: 90)
  --json                            附加输出 JSON
  --json-only                       仅输出 JSON
  --help, -h                        显示帮助

环境变量:
  GOOGLE_SPEED_API_KEY    Google PageSpeed Insights API Key

退出码:
  0  全部评分 ≥ 阈值
  1  存在评分 < 阈值
  2  API 错误 / 缺少依赖

示例:
  $0 "https://example.com"
  $0 --strategy mobile "https://example.com"
  $0 --strategy both --json "https://example.com"
  $0 --json-only "https://example.com" | jq .

完整文档: 见脚本头部注释
EOF
  exit 0
}

parse_args() {
  STRATEGY="$DEFAULT_STRATEGY"
  API_KEY="${GOOGLE_SPEED_API_KEY:-}"
  THRESHOLD="$DEFAULT_THRESHOLD"
  OUTPUT_MODE="summary"  # summary | json | json-only
  TARGET_URL=""

  while [ $# -gt 0 ]; do
    case "$1" in
      --strategy)
        STRATEGY="$2"
        shift 2
        ;;
      --key)
        API_KEY="$2"
        shift 2
        ;;
      --threshold)
        THRESHOLD="$2"
        shift 2
        ;;
      --json)
        OUTPUT_MODE="json"
        shift
        ;;
      --json-only)
        OUTPUT_MODE="json-only"
        shift
        ;;
      --help|-h)
        usage
        ;;
      --*)
        error "未知选项: $1"
        usage
        exit 2
        ;;
      -*)
        error "未知选项: $1"
        usage
        exit 2
        ;;
      *)
        TARGET_URL="$1"
        shift
        ;;
    esac
  done

  # 验证参数
  if [ -z "$TARGET_URL" ]; then
    error "缺少 URL 参数"
    echo ""
    usage
    exit 2
  fi

  if [ -z "$API_KEY" ]; then
    error "未设置 GOOGLE_SPEED_API_KEY 环境变量，且未通过 --key 传入"
    echo ""
    echo "设置方式:"
    echo "  export GOOGLE_SPEED_API_KEY=\"your-key-here\""
    echo ""
    echo "API Key 获取步骤见脚本头部注释 [1]"
    exit 2
  fi

  # 标准化 strategy
  case "$STRATEGY" in
    mobile|MOBILE) STRATEGY="mobile" ;;
    desktop|DESKTOP) STRATEGY="desktop" ;;
    both|BOTH) STRATEGY="both" ;;
    *)
      error "无效 strategy: $STRATEGY (可选: mobile, desktop, both)"
      exit 2
      ;;
  esac
}

#-----------------------------------------------------------------------------
# 主逻辑
#-----------------------------------------------------------------------------

main() {
  # 初始化日志文件
  : > "$LOG_FILE"
  echo "PageSpeed Check 开始于 $(date)" > "$LOG_FILE"
  echo "脚本路径: $0" >> "$LOG_FILE"
  echo "----------------------------------------" >> "$LOG_FILE"

  check_dependencies
  parse_args "$@"
  echo "[$(date '+%H:%M:%S')] URL=$TARGET_URL strategy=$STRATEGY threshold=$THRESHOLD" >> "$LOG_FILE"

  local strategies=()
  if [ "$STRATEGY" = "both" ]; then
    strategies=("mobile" "desktop")
  else
    strategies=("$STRATEGY")
  fi

  local all_json="{}"
  local global_all_pass=true
  local first=true

  for strat in "${strategies[@]}"; do
    if [ "$first" != true ] && [ "$OUTPUT_MODE" != "json-only" ]; then
      echo ""
      echo -e "${CYAN}─────────────────────────────────────────────${NC}"
      echo ""
    fi
    first=false

    # 调用 API
    local json
    if ! json=$(call_psi_api "$TARGET_URL" "$strat" "$API_KEY"); then
      error "API 调用失败"
      exit 2
    fi

    # 验证响应
    local api_success
    api_success=$(echo "$json" | jq -r '.lighthouseResult // empty | type')
    if [ "$api_success" != "object" ]; then
      error "PSI API 返回无效数据"
      echo "$json" | jq '.error // "未知错误"' 2>/dev/null || echo "$json"
      exit 2
    fi

    # 输出
    case "$OUTPUT_MODE" in
      summary)
        print_summary "$TARGET_URL" "$strat" "$THRESHOLD" "$json"
        ;;
      json)
        print_summary "$TARGET_URL" "$strat" "$THRESHOLD" "$json"
        echo -e "${BOLD}📄 JSON 输出:${NC}"
        echo "$json" | jq '{
          url,
          strategy: "'"$strat"'",
          timestamp: .analysisUTCTimestamp,
          scores: {
            performance: (.lighthouseResult.categories.performance.score * 100 | floor),
            accessibility: (.lighthouseResult.categories.accessibility.score * 100 | floor),
            best_practices: (.lighthouseResult.categories["best-practices"].score * 100 | floor),
            seo: (.lighthouseResult.categories.seo.score * 100 | floor)
          }
        }'
        ;;
      json-only)
        # 构建合并的 JSON 输出
        local result_json
        result_json=$(echo "$json" | jq -c '{
          url,
          strategy: "'"$strat"'",
          timestamp: .analysisUTCTimestamp,
          scores: {
            performance: (.lighthouseResult.categories.performance.score * 100 | floor),
            accessibility: (.lighthouseResult.categories.accessibility.score * 100 | floor),
            best_practices: (.lighthouseResult.categories["best-practices"].score * 100 | floor),
            seo: (.lighthouseResult.categories.seo.score * 100 | floor)
          },
          metrics: {
            fcp: (.lighthouseResult.audits["first-contentful-paint"].displayValue // "N/A"),
            lcp: (.lighthouseResult.audits["largest-contentful-paint"].displayValue // "N/A"),
            tbt: (.lighthouseResult.audits["total-blocking-time"].displayValue // "N/A"),
            cls: (.lighthouseResult.audits["cumulative-layout-shift"].displayValue // "N/A"),
            speed_index: (.lighthouseResult.audits["speed-index"].displayValue // "N/A")
          },
          opportunities: [
            .lighthouseResult.audits | to_entries[]
            | select(.value.details != null)
            | select(.value.details.type == "opportunity")
            | select(.value.score != null and .value.score < 1)
            | {title: .value.title, savings: .value.displayValue}
          ],
          pass: (
            (.lighthouseResult.categories.performance.score * 100 >= '"$THRESHOLD"') and
            (.lighthouseResult.categories.accessibility.score * 100 >= '"$THRESHOLD"') and
            (.lighthouseResult.categories["best-practices"].score * 100 >= '"$THRESHOLD"') and
            (.lighthouseResult.categories.seo.score * 100 >= '"$THRESHOLD"')
          )
        }')

        if [ "${#strategies[@]}" -eq 1 ]; then
          echo "$result_json" | jq .
        else
          if [ "$strat" = "mobile" ]; then
            echo "{\"mobile\": $result_json,"
          else
            echo " \"desktop\": $result_json}"
          fi
        fi
        ;;
    esac

    # 判断单项是否通过
    local perf_score=$(echo "$json" | jq -r '.lighthouseResult.categories.performance.score * 100 | floor')
    local a11y_score=$(echo "$json" | jq -r '.lighthouseResult.categories.accessibility.score * 100 | floor')
    local bp_score=$(echo "$json" | jq -r '.lighthouseResult.categories["best-practices"].score * 100 | floor')
    local seo_score=$(echo "$json" | jq -r '.lighthouseResult.categories.seo.score * 100 | floor')

    if [ "$perf_score" -lt "$THRESHOLD" ] 2>/dev/null || \
       [ "$a11y_score" -lt "$THRESHOLD" ] 2>/dev/null || \
       [ "$bp_score" -lt "$THRESHOLD" ] 2>/dev/null || \
       [ "$seo_score" -lt "$THRESHOLD" ] 2>/dev/null; then
      global_all_pass=false
    fi
  done

  # 退出码
  echo "" >> "$LOG_FILE"
  echo "----------------------------------------" >> "$LOG_FILE"
  echo "PageSpeed Check 结束: exit=$([ "$global_all_pass" = true ] && echo 0 || echo 1)" >> "$LOG_FILE"
  echo "日志文件: $LOG_FILE" >> "$LOG_FILE"
  if [ "$global_all_pass" = true ]; then
    exit 0
  else
    exit 1
  fi
}

main "$@"
