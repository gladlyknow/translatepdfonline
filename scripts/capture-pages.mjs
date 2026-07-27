#!/usr/bin/env node
/**
 * Capture screenshots of translatepdfonline.com pages using Playwright,
 * then upload to Cloudflare R2 blog/ prefix via S3 API.
 *
 * Usage: node scripts/capture-pages.mjs
 */

import { chromium } from 'playwright';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---- Load R2 env from .env.r2 or ~/.bashrc ----
function loadEnv() {
  // Try project .env.r2 first
  const envFile = resolve(__dirname, '.env.r2');
  if (existsSync(envFile)) {
    const lines = readFileSync(envFile, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq > 0) process.env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
    }
  }
}

loadEnv();

const BUCKET = process.env.R2_BUCKET || 'translatepdfonline';
const ENDPOINT = process.env.R2_ENDPOINT;
const ACCESS_KEY = process.env.R2_ACCESS_KEY_ID;
const SECRET_KEY = process.env.R2_SECRET_ACCESS_KEY;

if (!ENDPOINT || !ACCESS_KEY || !SECRET_KEY) {
  console.error('Missing R2 credentials. Set R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY.');
  process.exit(1);
}

const s3 = new S3Client({
  region: 'auto',
  endpoint: ENDPOINT,
  credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
  forcePathStyle: true,
});

const PAGES = [
  ['photo-to-word-hero.jpg', 'https://www.translatepdfonline.com/photo-to-word', 1280, 900],
  ['image-to-text-hero.jpg', 'https://www.translatepdfonline.com/image-to-text', 1280, 900],
  ['jpg-to-word-hero.jpg', 'https://www.translatepdfonline.com/jpg-to-word', 1280, 900],
  ['pdf-to-word-doc-hero.jpg', 'https://www.translatepdfonline.com/pdf-to-word-doc', 1280, 900],
  ['homepage-hero.jpg', 'https://www.translatepdfonline.com', 1440, 900],
];

async function captureAndUpload(filename, url, width, height) {
  console.log(`[${filename}] ${url} (${width}x${height})`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    const screenshot = await page.screenshot({ type: 'jpeg', quality: 85, fullPage: false });
    const sizeKb = (screenshot.length / 1024).toFixed(0);
    console.log(`  Captured: ${sizeKb} kB`);

    // Upload to R2
    const cmd = new PutObjectCommand({
      Bucket: BUCKET,
      Key: `blog/${filename}`,
      Body: screenshot,
      ContentType: 'image/jpeg',
      CacheControl: 'public, max-age=31536000, immutable',
    });
    await s3.send(cmd);
    console.log(`  ✓ Uploaded: blog/${filename}`);
    console.log(`    URL: https://storage.translatepdfonline.com/blob/blog/${filename}`);
    return true;
  } catch (err) {
    console.error(`  ERROR: ${err.message}`);
    return false;
  } finally {
    await browser.close();
  }
}

async function main() {
  console.log('Capturing translatepdfonline.com pages with Playwright...\n');
  for (const [filename, url, w, h] of PAGES) {
    await captureAndUpload(filename, url, w, h);
    console.log();
  }
  console.log('Done.');
}

main().catch(console.error);
