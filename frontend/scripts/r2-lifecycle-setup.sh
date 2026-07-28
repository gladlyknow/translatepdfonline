#!/usr/bin/env bash
# R2 lifecycle 规则设置脚本
# 用法: bash scripts/r2-lifecycle-setup.sh
# 自动从 ~/.bashrc 读取凭据
set -euo pipefail

# 从 ~/.bashrc 自动读取
eval "$(grep -E '^(export )?(CLOUDFLARE_API_KEY|CF_ACCOUNT_ID|GOOGLE_SPEED_API_KEY|R2_ACCESS_KEY_ID|R2_SECRET_ACCESS_KEY|R2_ENDPOINT)=' ~/.bashrc | sed 's/^export //')"

[ -n "${CLOUDFLARE_API_KEY:-}" ] || { echo "❌ 未在 ~/.bashrc 中找到 CLOUDFLARE_API_KEY"; exit 2; }
[ -n "${CF_ACCOUNT_ID:-}" ] || { echo "❌ 未在 ~/.bashrc 中找到 CF_ACCOUNT_ID"; exit 2; }

echo "设置 translatepdfonline R2 bucket 生命周期规则..."

curl -s -X PUT \
  "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/r2/buckets/translatepdfonline/lifecycle" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
  "rules": [
    {
      "id": "Default Multipart Abort Rule",
      "enabled": true,
      "conditions": {},
      "abortMultipartUploadsTransition": {
        "condition": { "type": "Age", "maxAge": 604800 }
      }
    },
    {
      "id": "delete-expired-uploads",
      "enabled": true,
      "prefix": "uploads/",
      "conditions": {},
      "deleteObjectsTransition": {
        "condition": { "type": "Age", "maxAge": 604800 }
      }
    },
    {
      "id": "delete-expired-slices",
      "enabled": true,
      "prefix": "slices/",
      "conditions": {},
      "deleteObjectsTransition": {
        "condition": { "type": "Age", "maxAge": 2592000 }
      }
    }
  ]
}' | jq .

echo ""
echo "验证规则..."
curl -s \
  "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/r2/buckets/translatepdfonline/lifecycle" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_KEY}" | jq '.result.rules[] | {id, enabled, prefix}'
