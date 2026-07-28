#!/usr/bin/env bash
#=============================================================================
# R2 过期文件清理（一次性）
#
# 用法:
#   source ~/.bashrc && ./scripts/r2-cleanup-expired.sh
#
# 功能:
#   1. 列出 translatepdfonline/uploads/ 下所有对象
#   2. 删除 7 天前修改的对象
#   3. 设置 R2 生命周期规则作为长期保障
#=============================================================================
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'
info()    { echo -e "${BLUE}ℹ${NC}  $*"; }
success() { echo -e "${GREEN}✅${NC} $*"; }
warn()    { echo -e "${YELLOW}⚠${NC}  $*"; }
error()   { echo -e "${RED}❌${NC} $*" >&2; }

header()  { echo -e "\n${BOLD}═══ $* ═══${NC}\n"; }

# Env check
[ -n "${CLOUDFLARE_API_KEY:-}" ] || { error "未设置 CLOUDFLARE_API_KEY"; exit 2; }
[ -n "${CF_ACCOUNT_ID:-}" ] || { error "未设置 CF_ACCOUNT_ID"; exit 2; }
[ -n "${R2_ACCESS_KEY_ID:-}" ] || { error "未设置 R2_ACCESS_KEY_ID"; exit 2; }
[ -n "${R2_SECRET_ACCESS_KEY:-}" ] || { error "未设置 R2_SECRET_ACCESS_KEY"; exit 2; }
[ -n "${R2_ENDPOINT:-}" ] || R2_ENDPOINT="https://2fa0a0b26ad57eca148c4291fdb96f84.r2.cloudflarestorage.com"
BUCKET="${R2_BUCKET:-translatepdfonline}"
CUTOFF_DAYS="${CUTOFF_DAYS:-7}"
DRY_RUN="${DRY_RUN:-true}"

main() {
  header "R2 过期文件清理"
  info "Bucket: ${BUCKET}"
  info "Endpoint: ${R2_ENDPOINT}"
  info "前缀: uploads/"
  info "保留天数: ${CUTOFF_DAYS}"
  [ "$DRY_RUN" = true ] && warn "DRY-RUN 模式：仅列出，不实际删除"
  echo ""

  # 使用项目已有的 Node.js + @aws-sdk 列出和删除对象
  info "列出 uploads/ 下的对象..."

  node -e "
const { S3Client, ListObjectsV2Command, DeleteObjectCommand } = require('@aws-sdk/client-s3');

const client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT || '$R2_ENDPOINT',
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
  forcePathStyle: true,
});

const BUCKET = process.env.R2_BUCKET || '$BUCKET';
const CUTOFF_DAYS = parseInt(process.env.CUTOFF_DAYS || '$CUTOFF_DAYS', 10);
const DRY_RUN = process.env.DRY_RUN !== 'false';
const CUTOFF = new Date(Date.now() - CUTOFF_DAYS * 24 * 60 * 60 * 1000);

async function main() {
  // List all objects under uploads/
  const objects = [];
  let continuationToken;
  do {
    const cmd = new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: 'uploads/',
      MaxKeys: 1000,
      ContinuationToken: continuationToken,
    });
    const res = await client.send(cmd);
    if (res.Contents) objects.push(...res.Contents);
    continuationToken = res.NextContinuationToken;
  } while (continuationToken);

  console.log('总对象数:', objects.length);
  console.log('');

  // Filter expired
  const expired = objects.filter(o => o.LastModified && o.LastModified < CUTOFF);
  const active = objects.filter(o => !o.LastModified || o.LastModified >= CUTOFF);

  console.log('活跃 (< ' + CUTOFF_DAYS + ' 天):', active.length);
  console.log('过期 (>= ' + CUTOFF_DAYS + ' 天):', expired.length);
  console.log('');

  if (expired.length > 0) {
    let totalBytes = expired.reduce((sum, o) => sum + (o.Size || 0), 0);
    console.log('过期文件清单 (' + expired.length + ' 个, ' + (totalBytes / 1024 / 1024).toFixed(2) + ' MB):');
    expired.forEach(o => {
      const age = Math.round((Date.now() - o.LastModified.getTime()) / (24 * 60 * 60 * 1000));
      const kb = ((o.Size || 0) / 1024).toFixed(1);
      console.log('  ' + o.LastModified.toISOString().slice(0, 10) + '  ' + age + 'd  ' + kb.padStart(8) + ' KB  ' + o.Key);
    });
    console.log('');

    if (DRY_RUN) {
      console.log('[DRY-RUN] 要实际删除，设置: export DRY_RUN=false && bash scripts/r2-cleanup-expired.sh');
    } else {
      console.log('开始删除 ' + expired.length + ' 个过期对象...');
      let deleted = 0;
      for (const obj of expired) {
        try {
          await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: obj.Key }));
          deleted++;
          if (deleted % 10 === 0) console.log('  已删除:', deleted + '/' + expired.length);
        } catch (e) {
          console.error('  删除失败:', obj.Key, e.message);
        }
      }
      console.log('');
      console.log('✅ 成功删除:', deleted + '/' + expired.length);
    }
  } else {
    console.log('无过期文件。');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
" 2>&1
}

main "$@"
