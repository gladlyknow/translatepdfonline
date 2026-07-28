#!/bin/bash
#=============================================================================
# PageSpeed 优化循环编排脚本
#=============================================================================
#
# 概述：
#   编排「检测 → Claude 分析修复 → 部署 → 再检测」循环，直到所有
#   PageSpeed 评分 ≥ 90。达标后可推送到生产环境。
#
# 工作流程:
#   ┌─────────────────────────────────────────────────────────┐
#   │ 1. pagespeed-check.sh → 获取评分 + 详细问题              │
#   │ 2. 全部 ≥ 90? → Yes → 达标，退出                         │
#   │ 3. 将检测结果写入 /tmp/psi-result.json                   │
#   │ 4. Claude 读取结果 → 创建 plan → 执行代码修复             │
#   │ 5. 脚本继续：记录 CF 时间戳 → git push develop            │
#   │ 6. CF API 轮询等待新版本部署上线                          │
#   │ 7. 回到步骤 1                                            │
#   └─────────────────────────────────────────────────────────┘
#
# 本脚本与 Claude 协作：
#   脚本负责：检测、部署、循环控制
#   Claude 负责：解读结果、制定修复方案、修改代码
#
# 用法:
#   # 单次检测（输出到 /tmp/psi-result.json 供 Claude 分析）
#   ./scripts/pagespeed-loop.sh --check-only ...
#
#   # 检测 + 部署（Claude 修复完成后运行）
#   ./scripts/pagespeed-loop.sh --deploy-only ...
#
#   # 完整循环（Claude 驱动，每次迭代自动修复）
#   ./scripts/pagespeed-loop.sh --url "https://translatepdfonline-dev.gladlyknow.workers.dev"
#
#   # 或使用默认 URL（dev 环境）：
#   ./scripts/pagespeed-loop.sh
#
#   # 达标后自动推送生产：
#   ./scripts/pagespeed-loop.sh --push-prod
#
# 依赖:
#   curl, jq, git
#   scripts/pagespeed-check.sh
#   环境变量: GOOGLE_SPEED_API_KEY, CLOUDFLARE_API_KEY, CF_ACCOUNT_ID
#   可选变量: PSI_DEV_URL (默认 https://translatepdfonline-dev.gladlyknow.workers.dev)
#             PSI_PROD_URL (默认 https://www.translatepdfonline.com)
#
#=============================================================================

set -euo pipefail

#-----------------------------------------------------------------------------
# 颜色
#-----------------------------------------------------------------------------
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

# 日志文件
LOG_DIR="${TMPDIR:-/tmp}"
LOG_FILE="${LOG_DIR}/pagespeed-loop-$(date +%Y%m%d-%H%M%S).log"

info()    { echo -e "${BLUE}ℹ${NC}  $*";  echo "[$(date '+%H:%M:%S')] INFO  $*" >> "$LOG_FILE"; }
success() { echo -e "${GREEN}✅${NC} $*"; echo "[$(date '+%H:%M:%S')] OK    $*" >> "$LOG_FILE"; }
warn()    { echo -e "${YELLOW}⚠${NC}  $*"; echo "[$(date '+%H:%M:%S')] WARN  $*" >> "$LOG_FILE"; }
error()   { echo -e "${RED}❌${NC} $*" >&2; echo "[$(date '+%H:%M:%S')] ERROR $*" >> "$LOG_FILE"; }
header()  { echo -e "\n${BOLD}${CYAN}═══ $* ═══${NC}\n"; echo "[$(date '+%H:%M:%S')] === $* ===" >> "$LOG_FILE"; }

#-----------------------------------------------------------------------------
# 配置
#-----------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECK_SCRIPT="${SCRIPT_DIR}/pagespeed-check.sh"
RESULT_FILE="/tmp/psi-result.json"

DEFAULT_THRESHOLD=90
DEFAULT_MAX_ITERATIONS=5
DEFAULT_WORKER_NAME="translatepdfonline-dev"
CF_API_BASE="https://api.cloudflare.com/client/v4/accounts"

#-----------------------------------------------------------------------------
# 依赖检查
#-----------------------------------------------------------------------------
check_deps() {
  local missing=()
  for cmd in curl jq git; do
    command -v "$cmd" &>/dev/null || missing+=("$cmd")
  done
  [ -x "$CHECK_SCRIPT" ] || { error "找不到 $CHECK_SCRIPT"; exit 2; }

  if [ ${#missing[@]} -gt 0 ]; then
    error "缺少: ${missing[*]}"; exit 2
  fi

  for var in GOOGLE_SPEED_API_KEY CLOUDFLARE_API_KEY CF_ACCOUNT_ID; do
    [ -n "${!var:-}" ] || { error "未设置 $var"; exit 2; }
  done
}

#-----------------------------------------------------------------------------
# CF API
#-----------------------------------------------------------------------------
get_worker_modified_on() {
  curl -s --max-time 30 \
    -H "Authorization: Bearer ${CLOUDFLARE_API_KEY}" \
    "${CF_API_BASE}/${CF_ACCOUNT_ID}/workers/scripts" \
    | jq -r ".result[] | select(.id == \"$1\") | .modified_on // \"unknown\""
}

wait_for_cf_deploy() {
  local name="$1" before="$2"
  local max_wait=900 interval=60 elapsed=0

  header "等待 CF 部署: ${name}"
  info "部署前 modified_on: ${before}"

  while [ $elapsed -lt $max_wait ]; do
    local cur
    cur=$(get_worker_modified_on "$name" 2>/dev/null || echo "error")

    if [ "$cur" != "$before" ] && [ -n "$cur" ] && [ "$cur" != "unknown" ] && [ "$cur" != "error" ]; then
      success "CF 部署完成 (${elapsed}s)"
      info "  ${before} → ${cur}"
      break
    fi

    local min=$((elapsed / 60))
    echo "  ⏳ 部署中... (${min} 分钟)"
    sleep $interval
    elapsed=$((elapsed + interval))
  done

  [ $elapsed -ge $max_wait ] && { error "CF 部署超时"; return 1; }

  info "等待 30s CF 边缘缓存传播..."
  sleep 30
}

#-----------------------------------------------------------------------------
# PSI 检测
#-----------------------------------------------------------------------------
run_check() {
  local url="$1" threshold="$2"

  info "运行 PageSpeed Insights (mobile + desktop)..."
  "$CHECK_SCRIPT" --strategy both --json-only --threshold "$threshold" "$url" 2>> "$LOG_FILE"
}

# 打印评分摘要
print_scores() {
  local json="$1"
  echo ""
  echo -e "${BOLD}────────── mobile ──────────${NC}"
  echo "$json" | jq -r '
    .mobile.scores | to_entries[] |
    "  \(.key): \(.value)/100"
  '
  echo -e "${BOLD}────────── desktop ─────────${NC}"
  echo "$json" | jq -r '
    .desktop.scores | to_entries[] |
    "  \(.key): \(.value)/100"
  '
  echo ""
}

# 检查是否全部达标
all_pass() {
  local json="$1" threshold="$2"

  for s in mobile desktop; do
    for c in performance accessibility best_practices seo; do
      local score
      score=$(echo "$json" | jq -r ".${s}.scores.${c} // 0")
      if [ "$score" -lt "$threshold" ] 2>/dev/null; then
        return 1
      fi
    done
  done
  return 0
}

# 输出优化建议
print_issues() {
  local json="$1"

  echo -e "${BOLD}────────── 待修复问题 ──────────${NC}"
  echo ""
  echo -e "${YELLOW}Mobile 优化建议:${NC}"
  echo "$json" | jq -r '
    .mobile.opportunities[:8][] | "  • \(.title) — \(.savings // "N/A")"
  ' 2>/dev/null || echo "  (无)"
  echo ""
  echo -e "${YELLOW}Desktop 优化建议:${NC}"
  echo "$json" | jq -r '
    .desktop.opportunities[:8][] | "  • \(.title) — \(.savings // "N/A")"
  ' 2>/dev/null || echo "  (无)"
  echo ""
}

#-----------------------------------------------------------------------------
# Git 操作
#-----------------------------------------------------------------------------
git_deploy() {
  local msg="$1"

  # 检查变更
  if git diff --quiet && git diff --cached --quiet; then
    warn "无代码变更，跳过部署"
    return 2
  fi

  echo ""
  info "变更文件:"
  git diff --stat --cached 2>/dev/null || git diff --stat
  echo ""

  git add -A
  git commit -m "$msg" 2>/dev/null || info "commit 跳过（可能已提交）"

  if [ "$DRY_RUN" = true ]; then
    warn "[DRY-RUN] 跳过 git push origin develop"
    info "[DRY-RUN] 模拟 CF 部署 5s..."
    sleep 5
    return 0
  fi

  info "git push origin develop ..."
  git push origin develop
  return 0
}

#-----------------------------------------------------------------------------
# 参数
#-----------------------------------------------------------------------------
usage() {
  sed -n '/^# 用法:/,/^$/p' "$0" | head -20
  exit 0
}

parse_args() {
  TARGET_URL=""
  PROD_URL=""
  THRESHOLD="$DEFAULT_THRESHOLD"
  MAX_ITERATIONS="$DEFAULT_MAX_ITERATIONS"
  WORKER_NAME="$DEFAULT_WORKER_NAME"
  PUSH_PROD=false
  CHECK_ONLY=false
  DEPLOY_ONLY=false
  DRY_RUN=false
  ITERATION=0  # 从外部传入当前迭代数

  while [ $# -gt 0 ]; do
    case "$1" in
      --url)            TARGET_URL="$2"; shift 2 ;;
      --prod-url)       PROD_URL="$2"; shift 2 ;;
      --threshold)      THRESHOLD="$2"; shift 2 ;;
      --max-iterations) MAX_ITERATIONS="$2"; shift 2 ;;
      --worker-name)    WORKER_NAME="$2"; shift 2 ;;
      --iteration)      ITERATION="$2"; shift 2 ;;
      --push-prod)      PUSH_PROD=true; shift ;;
      --check-only)     CHECK_ONLY=true; shift ;;
      --deploy-only)    DEPLOY_ONLY=true; shift ;;
      --dry-run)        DRY_RUN=true; shift ;;
      --help|-h)        usage ;;
      *) error "未知选项: $1"; usage; exit 2 ;;
    esac
  done

  # URL 默认值：可通过 --url / --prod-url 覆盖，也可用环境变量 PSI_DEV_URL / PSI_PROD_URL
  [ -z "$TARGET_URL" ] && TARGET_URL="${PSI_DEV_URL:-https://translatepdfonline-dev.gladlyknow.workers.dev}"
  [ -z "$PROD_URL" ] && PROD_URL="${PSI_PROD_URL:-https://www.translatepdfonline.com}"
  [ "$DRY_RUN" = true ] && warn "=== DRY-RUN 模式 ==="
}

#-----------------------------------------------------------------------------
# 主逻辑
#-----------------------------------------------------------------------------
main() {
  # 初始化日志
  : > "$LOG_FILE"
  echo "PageSpeed Loop 开始于 $(date)" > "$LOG_FILE"
  echo "脚本: $0" >> "$LOG_FILE"
  echo "----------------------------------------" >> "$LOG_FILE"

  check_deps
  parse_args "$@"

  # ---- 仅部署模式（Claude 修复后） ----
  if [ "$DEPLOY_ONLY" = true ]; then
    local commit_msg="perf: PageSpeed 优化 (第 ${ITERATION} 轮)"

    header "部署第 ${ITERATION} 轮修复"
    local before
    before=$(get_worker_modified_on "$WORKER_NAME")

    if ! git_deploy "$commit_msg"; then
      exit 0  # 无变更
    fi

    wait_for_cf_deploy "$WORKER_NAME" "$before"

    # 部署后重新检测
    local result
    result=$(run_check "$TARGET_URL" "$THRESHOLD")
    echo "$result" > "$RESULT_FILE"
    print_scores "$result"

    if all_pass "$result" "$THRESHOLD"; then
      success "🎉 全部达标！"
      echo "$result"
      exit 0
    else
      print_issues "$result"
      exit 1
    fi
  fi

  # ---- 仅检测模式 ----
  if [ "$CHECK_ONLY" = true ]; then
    header "PageSpeed 检测"
    local result
    result=$(run_check "$TARGET_URL" "$THRESHOLD")
    echo "$result" > "$RESULT_FILE"
    print_scores "$result"

    if all_pass "$result" "$THRESHOLD"; then
      success "🎉 全部达标！"
      exit 0
    else
      print_issues "$result"
      info "检测结果已保存到: ${RESULT_FILE}"
      exit 1
    fi
  fi

  # ---- 完整循环模式 ----
  header "PageSpeed 优化循环"
  echo "  目标:     ${CYAN}${TARGET_URL}${NC}"
  echo "  阈值:     ${THRESHOLD}"
  echo "  最大轮数: ${MAX_ITERATIONS}"
  echo "  Worker:   ${WORKER_NAME}"
  echo ""

  local iter=$ITERATION

  while [ "$iter" -lt "$MAX_ITERATIONS" ]; do
    iter=$((iter + 1))
    header "第 ${iter}/${MAX_ITERATIONS} 轮"

    # 1. 检测
    local result
    result=$(run_check "$TARGET_URL" "$THRESHOLD")
    echo "$result" > "$RESULT_FILE"
    print_scores "$result"

    # 2. 判断
    if all_pass "$result" "$THRESHOLD"; then
      success "══════════════════════════════════════"
      success "  🎉 全部达标！评分 ≥ ${THRESHOLD}"
      success "══════════════════════════════════════"

      if [ "$PUSH_PROD" = true ] && [ -n "$PROD_URL" ]; then
        echo ""
        read -rp "  推送到生产环境? [y/N] " yn
        if [ "$yn" = "y" ] || [ "$yn" = "Y" ]; then
          # 记录 prod 部署前状态
          local prod_worker="translatepdfonline"
          local prod_before
          prod_before=$(get_worker_modified_on "$prod_worker")

          git checkout master && git merge develop --no-edit && git push origin master
          git checkout develop

          wait_for_cf_deploy "$prod_worker" "$prod_before"

          header "生产环境验证"
          run_check "$PROD_URL" "$THRESHOLD" | jq '.mobile.scores, .desktop.scores'
        fi
      fi
      exit 0
    fi

    # 3. 输出问题供 Claude 分析
    print_issues "$result"
    echo -e "${CYAN}检测结果已保存到: ${RESULT_FILE}${NC}"
    echo ""
    echo -e "${BOLD}请 Claude 根据以上结果创建 plan 并修复代码。${NC}"
    echo -e "修复完成后执行: ${GREEN}$0 --deploy-only --url \"${TARGET_URL}\" --iteration ${iter}${NC}"
    echo ""
    exit 1
  done

  warn "达到最大循环次数 (${MAX_ITERATIONS})，仍有未达标项"
  echo "" >> "$LOG_FILE"
  echo "----------------------------------------" >> "$LOG_FILE"
  echo "PageSpeed Loop 结束: 未达标 exit=1" >> "$LOG_FILE"
  echo "日志文件: $LOG_FILE" >> "$LOG_FILE"
  echo "检测结果: $RESULT_FILE" >> "$LOG_FILE"
  exit 1
}

main "$@"
