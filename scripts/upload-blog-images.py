#!/usr/bin/env python3
"""
Upload placeholder blog images to Cloudflare R2.
Generates labeled placeholder PNGs, then uploads to the /blog/ path in the bucket.

Usage:
  python3 scripts/upload-blog-images.py               # reads scripts/.env.r2
  python3 scripts/upload-blog-images.py --env FILE     # reads FILE

The .env.r2 file format (one KEY=VALUE per line):
  R2_ENDPOINT=https://xxx.r2.cloudflarestorage.com
  R2_ACCESS_KEY_ID=xxx
  R2_SECRET_ACCESS_KEY=xxx
  R2_BUCKET=translatepdfonline
"""

import os
import sys
import subprocess
import tempfile
import shutil
from pathlib import Path


def load_env(env_path: str):
    """Parse KEY=VALUE env file, export to os.environ."""
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                key, _, val = line.partition("=")
                os.environ[key.strip()] = val.strip()


# Resolve .env.r2 path relative to this script
SCRIPT_DIR = Path(__file__).resolve().parent
ENV_FILE = SCRIPT_DIR / ".env.r2"

# Allow override via CLI: python3 upload-blog-images.py --env /path/to/.env
if "--env" in sys.argv:
    idx = sys.argv.index("--env")
    ENV_FILE = Path(sys.argv[idx + 1])
    sys.argv.pop(idx)  # remove --env
    sys.argv.pop(idx)  # remove its value

if ENV_FILE.exists():
    load_env(str(ENV_FILE))
elif not os.environ.get("R2_ENDPOINT"):
    print(f"Env file not found: {ENV_FILE}")
    print("Create it or set R2_ENDPOINT/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY in environment.")
    sys.exit(1)

# ---- Config ----

BUCKET = os.environ.get("R2_BUCKET", "translatepdfonline")
ENDPOINT_URL = os.environ["R2_ENDPOINT"]
ACCESS_KEY = os.environ["R2_ACCESS_KEY_ID"]
SECRET_KEY = os.environ["R2_SECRET_ACCESS_KEY"]

R2_PREFIX = "blog"  # target path inside the bucket

# Each entry: (filename, label_text, width, height, bg_color)
IMAGES = [
    (
        "insert-photo-word.jpg",
        "Insert Photo in Word\nInsert > Pictures > This Device",
        1200,
        800,
        "#e8f0fe",
    ),
    (
        "text-wrapping-word.jpg",
        "Text Wrapping Options\nSquare · Tight · Through · Top & Bottom · Behind · In Front",
        1200,
        800,
        "#fef3e2",
    ),
    (
        "caption-photo-word.jpg",
        "Add Caption\nRight-click → Insert Caption",
        1200,
        800,
        "#e8f5e9",
    ),
    (
        "compress-photos-word.jpg",
        "Compress Pictures\nReduce File Size for All Images",
        800,
        600,
        "#fce4ec",
    ),
    (
        "photo-collage-word.jpg",
        "Photo Sheet Layout\nArrange Multiple Photos on One Page",
        1200,
        900,
        "#f3e5f5",
    ),
    (
        "photo-to-word-conversion.jpg",
        "Photo → Editable Word\nAI OCR Converts Phone Photos to .docx",
        1400,
        900,
        "#e0f2f1",
    ),
]


def check_env():
    missing = []
    for v in ["R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"]:
        if not os.environ.get(v):
            missing.append(v)
    if missing:
        print(f"Missing environment variables: {', '.join(missing)}")
        print("Run: source ~/.bashrc")
        sys.exit(1)


def check_convert():
    if not shutil.which("convert"):
        print("ImageMagick 'convert' not found. Install: apt install imagemagick")
        sys.exit(1)


def generate_images(tmpdir: str) -> list[tuple[str, str]]:
    """Generate placeholder PNGs with ImageMagick. Returns list of (filename, local_path)."""
    results = []
    for filename, label, width, height, bg_color in IMAGES:
        out_path = os.path.join(tmpdir, filename)
        label_escaped = label.replace("'", "'\\''")
        cmd = [
            "convert",
            "-size",
            f"{width}x{height}",
            f"xc:{bg_color}",
            "-gravity",
            "Center",
            "-pointsize",
            "48",
            "-fill",
            "#333333",
            "-annotate",
            "0",
            label,
            out_path,
        ]
        subprocess.run(cmd, check=True)
        results.append((filename, out_path))
        print(f"  Generated: {filename} ({width}x{height})")
    return results


def upload_to_r2(local_path: str, object_key: str):
    """Upload a single file to R2 using boto3."""
    import boto3

    s3 = boto3.client(
        "s3",
        endpoint_url=ENDPOINT_URL,
        aws_access_key_id=ACCESS_KEY,
        aws_secret_access_key=SECRET_KEY,
        region_name="auto",
    )

    content_type = "image/jpeg" if object_key.endswith(".jpg") else "image/png"
    s3.upload_file(
        local_path,
        BUCKET,
        object_key,
        ExtraArgs={
            "ContentType": content_type,
            "CacheControl": "public, max-age=31536000, immutable",
        },
    )
    public_url = f"https://storage.translatepdfonline.com/blob/{object_key}"
    print(f"  ✓ Uploaded: {object_key}")
    print(f"    URL: {public_url}")


def main():
    check_env()
    check_convert()

    print(f"Bucket: {BUCKET}")
    print(f"Endpoint: {ENDPOINT_URL}")
    print(f"R2 prefix: {R2_PREFIX}/")
    print()

    tmpdir = tempfile.mkdtemp(prefix="blog-images-")
    try:
        print("Generating placeholder images...")
        images = generate_images(tmpdir)
        print()

        print("Uploading to R2...")
        for filename, local_path in images:
            object_key = f"{R2_PREFIX}/{filename}"
            upload_to_r2(local_path, object_key)
        print()

        print("Done. All images uploaded to R2 /blog/ prefix.")
        print()
        print("Verify at: https://storage.translatepdfonline.com/blob/blog/")
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


if __name__ == "__main__":
    main()
