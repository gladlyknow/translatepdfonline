#!/usr/bin/env python3
"""
Capture real screenshots of translatepdfonline.com pages via headless Chrome,
then upload to Cloudflare R2 blog/ prefix.

Usage:
  python3 scripts/capture-and-upload.py
"""

import os
import sys
import subprocess
import tempfile
import shutil
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent

# ---- Load R2 env ----
ENV_FILE = SCRIPT_DIR / ".env.r2"
if ENV_FILE.exists():
    with open(ENV_FILE) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                os.environ[k.strip()] = v.strip()

import boto3

BUCKET = os.environ["R2_BUCKET"]
ENDPOINT = os.environ["R2_ENDPOINT"]
ACCESS_KEY = os.environ["R2_ACCESS_KEY_ID"]
SECRET_KEY = os.environ["R2_SECRET_ACCESS_KEY"]

# ---- Screenshot targets ----
# (filename, url, viewport_width, viewport_height, clip_y_offset)
PAGES = [
    ("photo-to-word-hero.jpg", "https://www.translatepdfonline.com/photo-to-word", 1280, 900),
    ("image-to-text-hero.jpg", "https://www.translatepdfonline.com/image-to-text", 1280, 900),
    ("jpg-to-word-hero.jpg", "https://www.translatepdfonline.com/jpg-to-word", 1280, 900),
    ("pdf-to-word-doc-hero.jpg", "https://www.translatepdfonline.com/pdf-to-word-doc", 1280, 900),
    ("homepage-hero.jpg", "https://www.translatepdfonline.com", 1440, 900),
]


def capture_screenshot(url: str, out_path: str, width: int, height: int):
    """Use headless Chrome to capture a full-page or viewport screenshot."""
    # Use --virtual-time-budget to wait for fonts/images to load
    cmd = [
        "google-chrome",
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        f"--window-size={width},{height}",
        "--hide-scrollbars",
        f"--screenshot={out_path}",
        "--virtual-time-budget=8000",  # wait up to 8s for rendering
        url,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    if result.returncode != 0:
        print(f"  WARN: Chrome exited {result.returncode}")
        print(f"  stderr: {result.stderr[:500]}")
    if os.path.exists(out_path):
        size_kb = os.path.getsize(out_path) / 1024
        print(f"  OK: {os.path.basename(out_path)} ({size_kb:.0f} kB)")
        return True
    else:
        print(f"  FAIL: no output at {out_path}")
        return False


def upload_to_r2(local_path: str, filename: str):
    """Upload a file to R2 blog/ prefix."""
    s3 = boto3.client(
        "s3",
        endpoint_url=ENDPOINT,
        aws_access_key_id=ACCESS_KEY,
        aws_secret_access_key=SECRET_KEY,
        region_name="auto",
    )
    object_key = f"blog/{filename}"
    s3.upload_file(
        local_path, BUCKET, object_key,
        ExtraArgs={
            "ContentType": "image/jpeg",
            "CacheControl": "public, max-age=31536000, immutable",
        },
    )
    print(f"  ✓ Uploaded: blog/{filename}")
    print(f"    URL: https://storage.translatepdfonline.com/blob/blog/{filename}")


def main():
    print("Capturing translatepdfonline.com pages...\n")

    tmpdir = tempfile.mkdtemp(prefix="tpo-screenshots-")
    try:
        for filename, url, width, height in PAGES:
            print(f"[{filename}]")
            print(f"  URL: {url} ({width}x{height})")
            local = os.path.join(tmpdir, filename)
            ok = capture_screenshot(url, local, width, height)
            if ok:
                upload_to_r2(local, filename)
            print()

        print("Done. All screenshots captured and uploaded.")
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


if __name__ == "__main__":
    main()
