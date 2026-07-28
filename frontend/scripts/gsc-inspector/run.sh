#!/bin/bash
# Helper: source GOOGLE_SERVICE_ACCOUNT_KEY from .bashrc and run gsc-inspector
# Usage: bash scripts/gsc-inspector/run.sh inspect --site ... --urls ...

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Extract and export the env var from .bashrc (bypasses non-interactive guard)
eval "$(sed -n "/^export GOOGLE_SERVICE_ACCOUNT_KEY=/,/^}'$/p" /home/glmusr/.bashrc)"

cd "$PROJECT_DIR"
exec npx tsx scripts/gsc-inspector/src/index.ts "$@"
