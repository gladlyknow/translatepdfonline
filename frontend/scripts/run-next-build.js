#!/usr/bin/env node
/**
 * Run Next.js build with more memory and forward all output (stdio: inherit).
 * During build, Miniflare needs a valid Hyperdrive URL; we temporarily set a
 * placeholder so build succeeds, then restore wrangler.toml (dev/preview keep your real URL).
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const wranglerPath = path.join(root, 'wrangler.toml');
// Miniflare validates postgres URL must have user:password (no real connection during build)
const PLACEHOLDER_URL = 'postgres://_build:_build@localhost:5432/_build_placeholder';

let originalWrangler = null;
if (fs.existsSync(wranglerPath)) {
  originalWrangler = fs.readFileSync(wranglerPath, 'utf8');
  let patched = originalWrangler;
  if (originalWrangler.includes('[[hyperdrive]]')) {
    if (/localConnectionString\s*=\s*["']/.test(originalWrangler)) {
      patched = originalWrangler.replace(
        /localConnectionString\s*=\s*["'][^"']*["']/,
        `localConnectionString = "${PLACEHOLDER_URL}"`
      );
    } else {
      patched = originalWrangler.replace(
        /(binding\s*=\s*"HYPERDRIVE")\s*\n/,
        `$1\nlocalConnectionString = "${PLACEHOLDER_URL}"\n`
      );
    }
  }
  if (patched !== originalWrangler) {
    fs.writeFileSync(wranglerPath, patched);
  } else {
    originalWrangler = null;
  }
}

const nextBin = path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next');
const result = spawnSync(
  process.execPath,
  ['--max-old-space-size=4096', nextBin, 'build'],
  { stdio: 'inherit', cwd: root }
);

if (originalWrangler != null) {
  fs.writeFileSync(wranglerPath, originalWrangler);
}

process.exit(result.status ?? 1);
