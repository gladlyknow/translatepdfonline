#!/usr/bin/env python3
"""
Upload TranslatePDFOnline blog intro images to Cloudflare R2.
Generates labeled placeholder PNGs, then uploads to /blog/ path in the bucket.

Usage:
  python3 scripts/upload-tpo-blog-images.py
"""

import os
import sys
import subprocess
import tempfile
import shutil
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
ENV_FILE = SCRIPT_DIR / ".env.r2"

if "--env" in sys.argv:
    idx = sys.argv.index("--env")
    ENV_FILE = Path(sys.argv[idx + 1])

def load_env(env_path: str):
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                key, _, val = line.partition("=")
                os.environ[key.strip()] = val.strip()

if ENV_FILE.exists():
    load_env(str(ENV_FILE))

BUCKET = os.environ.get("R2_BUCKET", "translatepdfonline")
ENDPOINT_URL = os.environ["R2_ENDPOINT"]
ACCESS_KEY = os.environ["R2_ACCESS_KEY_ID"]
SECRET_KEY = os.environ["R2_SECRET_ACCESS_KEY"]
R2_PREFIX = "blog"

IMAGES = [
    ("tpo-hero.jpg", "TranslatePDFOnline — Free AI PDF Translation\nOCR + 10 Languages + Developer API", 1400, 800, "#1a1a2e"),
    ("tpo-workflow.jpg", "Upload → OCR → Translate → Export PDF\nCloudflare Workers + Baidu OCR + DeepSeek + Puppeteer", 1400, 800, "#16213e"),
    ("tpo-languages.jpg", "10 Languages: EN · ZH · ES · FR · IT · EL · JA · KO · DE · RU\nFull Bidirectional Translation", 1200, 700, "#0f3460"),
    ("tpo-tools.jpg", "Document Tools Suite\nPDF to Text · Image to Text · JPG to Word · PDF to Word · Contract Compare", 1400, 800, "#533483"),
    ("tpo-ocr-workflow.jpg", "OCR Translator Pipeline\nScanned PDF → Baidu OCR → DeepSeek AI → Puppeteer PDF Export", 1400, 800, "#e94560"),
    ("tpo-api.jpg", "REST API v1\nPOST /api/v1/translate · Bearer Token · Rate Limiting · Usage Tracking", 1400, 800, "#0f3460"),
]

def check_env():
    missing = []
    for v in ["R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"]:
        if not os.environ.get(v):
            missing.append(v)
    if missing:
        print(f"Missing env vars: {', '.join(missing)}")
        print("Create scripts/.env.r2 or pass --env FILE")
        sys.exit(1)

def check_convert():
    if not shutil.which("convert"):
        print("ImageMagick 'convert' not found. Install: apt install imagemagick")
        sys.exit(1)

def generate_images(tmpdir: str):
    results = []
    for filename, label, width, height, bg in IMAGES:
        out_path = os.path.join(tmpdir, filename)
        label_escaped = label.replace("'", "'\\''")
        cmd = [
            "convert", "-size", f"{width}x{height}", f"xc:{bg}",
            "-gravity", "Center", "-pointsize", "48", "-fill", "white",
            "-annotate", "0", label, out_path,
        ]
        subprocess.run(cmd, check=True)
        results.append((filename, out_path))
        print(f"  Generated: {filename} ({width}x{height})")
    return results

def upload_to_r2(local_path: str, object_key: str):
    import boto3
    s3 = boto3.client(
        "s3", endpoint_url=ENDPOINT_URL,
        aws_access_key_id=ACCESS_KEY, aws_secret_access_key=SECRET_KEY,
        region_name="auto",
    )
    s3.upload_file(local_path, BUCKET, object_key, ExtraArgs={
        "ContentType": "image/jpeg",
        "CacheControl": "public, max-age=31536000, immutable",
    })
    print(f"  Uploaded: {object_key}")
    print(f"  URL: https://storage.translatepdfonline.com/blob/{object_key}")

def main():
    check_env()
    check_convert()
    print(f"Bucket: {BUCKET}\nR2 prefix: {R2_PREFIX}/\n")

    tmpdir = tempfile.mkdtemp(prefix="tpo-blog-")
    try:
        print("Generating images...")
        images = generate_images(tmpdir)
        print(f"\nUploading to R2...")
        for filename, local_path in images:
            upload_to_r2(local_path, f"{R2_PREFIX}/{filename}")
        print(f"\nDone. {len(images)} images uploaded.")
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)

if __name__ == "__main__":
    main()
