#!/usr/bin/env bash
#
# optimize-images.sh — 将 public/ 中的大型 PNG/JPG 转换为 WebP，并更新代码引用
#
# 用法: bash scripts/optimize-images.sh [--dry-run]

set -euo pipefail

DRY_RUN=false
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
  echo ">>> DRY RUN 模式，不实际修改文件 <<<"
fi

PUBLIC_DIR="public"

# 需要转换的图片列表（路径 + 期望最大宽度）
declare -A IMAGES
IMAGES=(
  # cases — showcase 图片，超大型 PNG
  ["imgs/cases/1.png"]="1200"
  ["imgs/cases/2.png"]="1200"
  ["imgs/cases/3.png"]="1200"
  ["imgs/cases/4.png"]="1200"
  ["imgs/cases/5.png"]="1200"
  ["imgs/cases/6.png"]="1200"
  ["imgs/cases/7.png"]="1200"
  ["imgs/cases/8.png"]="1200"
  ["imgs/cases/9.png"]="1200"
  # features — 功能截图
  ["imgs/features/dense_PDFs.png"]="800"
  ["imgs/features/landing-page_new.png"]="1000"
  ["imgs/features/user-billing.png"]="800"
  ["imgs/features/page_range.png"]="600"
  ["imgs/features/upload_pdf.png"]="600"
  ["imgs/features/choose_language_target.png"]="600"
  ["imgs/features/choose_language_source.png"]="600"
  ["imgs/features/history.png"]="600"
  ["imgs/features/download.png"]="600"
  # brand — logo，大型 PNG
  ["brand/logo-512.png"]="512"
  ["brand/logo-copy.png"]="512"
  ["brand/logo-180.png"]="180"
  ["brand/logo-64.png"]="64"
  # bg
  ["imgs/bg/tree.jpg"]="1920"
)

convert_one() {
  local input="$1"
  local max_width="$2"
  local output="${input%.*}.webp"
  local input_path="${PUBLIC_DIR}/${input}"
  local output_path="${PUBLIC_DIR}/${output}"

  if [[ ! -f "$input_path" ]]; then
    echo "  ⚠ 跳过（文件不存在）: $input_path"
    return 1
  fi

  local original_size
  original_size=$(stat -c%s "$input_path" 2>/dev/null || echo 0)

  if $DRY_RUN; then
    echo "  [DRY RUN] 将转换: $input → $output (resize ${max_width}px, ${original_size} bytes)"
    return 0
  fi

  # 使用 ImageMagick 或 ffmpeg 转换
  if command -v magick &>/dev/null; then
    magick "$input_path" -resize "${max_width}x" -quality 82 "$output_path"
  elif command -v convert &>/dev/null; then
    convert "$input_path" -resize "${max_width}x" -quality 82 "$output_path"
  elif command -v ffmpeg &>/dev/null; then
    ffmpeg -y -i "$input_path" -vf "scale=${max_width}:-1" -quality 82 "$output_path" 2>/dev/null
  else
    echo "  ❌ 无可用图片处理工具 (imagemagick/ffmpeg)"
    return 1
  fi

  local new_size
  new_size=$(stat -c%s "$output_path" 2>/dev/null || echo 0)
  local reduction=$(( 100 - (new_size * 100 / (original_size > 0 ? original_size : 1)) ))
  echo "  ✅ $input → $output: $(numfmt --to=iec $original_size 2>/dev/null || echo ${original_size}) → $(numfmt --to=iec $new_size 2>/dev/null || echo ${new_size}) (减少 ${reduction}%)"
}

update_refs() {
  local old_ext="$1"  # .png 或 .jpg
  local new_ext=".webp"

  if $DRY_RUN; then
    echo "  [DRY RUN] 将在 src/ 中替换: ${old_ext} → ${new_ext} (仅 imgs/ 和 brand/ 路径)"
    return 0
  fi

  # 只替换 public 资源路径（以 /imgs/ 或 /brand/ 开头），不修改 http 远程 URL
  local count
  count=$(grep -rl "\"/imgs/.*\${old_ext}\"\|\"/brand/.*\${old_ext}\"" src/ 2>/dev/null | wc -l)
  if [[ $count -gt 0 ]]; then
    find src/ -type f \( -name "*.json" -o -name "*.tsx" -o -name "*.ts" \) \
      -exec sed -i "s|\"/imgs/\(.*\)${old_ext}\"|\"/imgs/\1${new_ext}\"|g" {} \; \
      -exec sed -i "s|\"/brand/\(.*\)${old_ext}\"|\"/brand/\1${new_ext}\"|g" {} \;
    echo "  ✅ 已更新 $count 个文件中的引用 (${old_ext} → ${new_ext})"
  else
    echo "  ℹ 无需更新引用"
  fi
}

echo "═══════════════════════════════════════════"
echo "  图片优化：PNG/JPEG → WebP"
echo "═══════════════════════════════════════════"
echo ""

# 转换图片
converted=0
for img in "${!IMAGES[@]}"; do
  if convert_one "$img" "${IMAGES[$img]}"; then
    ((converted++)) || true
  fi
done

echo ""
echo "已转换: $converted 张图片"
echo ""

# 更新代码中的引用
echo "更新代码引用..."
update_refs ".png"
update_refs ".jpg"

echo ""
echo "═══════════════════════════════════════════"
echo "  完成！"
echo "  注意: 原始 PNG/JPG 文件保留在 public/ 中"
echo "  如需删除原始文件以减小部署体积，运行:"
echo "    find public/ -name '*.png' -delete"
echo "    find public/ -name '*.jpg' -delete"
echo "═══════════════════════════════════════════"
