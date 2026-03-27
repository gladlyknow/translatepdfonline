#!/usr/bin/env node
/**
 * Ensure .next/standalone/.next/server/pages-manifest.json exists.
 * App Router-only projects don't generate this file, but OpenNext's
 * Cloudflare adapter expects it to exist. We create an empty manifest
 * so the build can proceed.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const manifestPath = path.join(
  root,
  '.next',
  'standalone',
  '.next',
  'server',
  'pages-manifest.json'
);

if (!fs.existsSync(manifestPath)) {
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, '{}', 'utf8');
  console.log('Created empty pages-manifest.json for OpenNext (app-router only).');
} else {
  console.log('pages-manifest.json already exists, skip creating.');
}

