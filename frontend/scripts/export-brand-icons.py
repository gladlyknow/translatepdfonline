#!/usr/bin/env python3
"""
从与 public/favicon.svg 一致的视觉（圆角、对角渐变、白字 T）栅格化为 PNG。
仅使用 Python 标准库，无需 Pillow/sharp。

运行（在 frontend 目录）: pnpm run brand:icons
或: python scripts/export-brand-icons.py
"""

from __future__ import annotations

import struct
import zlib
from pathlib import Path

# 与 favicon.svg 中 linearGradient 一致
C0 = (0x0F, 0x17, 0x2A)  # #0f172a
C1 = (0x03, 0x69, 0xA1)  # #0369a1
WHITE = (0xFF, 0xFF, 0xFF)
# viewBox 32×32 上 rx=9
RX_RATIO = 9 / 32


def _in_round_rect(x: float, y: float, w: int, h: int, r: float) -> bool:
    if x < 0 or y < 0 or x >= w or y >= h:
        return False
    if r <= 0:
        return True
    r = min(r, w / 2, h / 2)
    if r <= x < w - r:
        return True
    if r <= y < h - r:
        return True
    corners = [(r, r), (w - r, r), (r, h - r), (w - r, h - r)]
    for cx, cy in corners:
        dx, dy = x - cx, y - cy
        if dx * dx + dy * dy <= r * r + 0.25:
            return True
    return False


def _gradient_rgb(x: float, y: float, w: int, h: int) -> tuple[int, int, int]:
    # 对角 t：等价于 SVG x1=0,y1=0 -> x2=100%,y2=100%
    t = ((x / max(w - 1, 1)) + (y / max(h - 1, 1))) / 2
    t = max(0.0, min(1.0, t))
    return (
        int(C0[0] + (C1[0] - C0[0]) * t),
        int(C0[1] + (C1[1] - C0[1]) * t),
        int(C0[2] + (C1[2] - C0[2]) * t),
    )


def _draw_t(px: int, py: int, w: int, h: int) -> bool:
    """与 32×32 上约 15px 字重、竖条居中 T 近似。"""
    s = w / 32.0
    cx = w / 2.0
    # 横条
    bar_w = max(6, int(10 * s))
    bar_h = max(2, int(3 * s))
    top_y = max(1, int(8 * s))
    if top_y <= py < top_y + bar_h and cx - bar_w / 2 <= px < cx + bar_w / 2:
        return True
    # 竖条
    stem_w = max(2, int(4 * s))
    stem_top = top_y + bar_h
    stem_bot = min(h - 2, int(22 * s))
    if stem_top <= py <= stem_bot and cx - stem_w / 2 <= px < cx + stem_w / 2:
        return True
    return False


def render_rgba(size: int) -> bytes:
    w = h = size
    r = max(2.0, RX_RATIO * size)
    rows = []
    for y in range(h):
        row = [0]
        for x in range(w):
            if not _in_round_rect(x + 0.5, y + 0.5, w, h, r):
                row.extend([0, 0, 0, 0])
                continue
            if _draw_t(x, y, w, h):
                row.extend([*WHITE, 255])
            else:
                rgb = _gradient_rgb(float(x), float(y), w, h)
                row.extend([*rgb, 255])
        rows.append(bytes(row))
    return b"".join(rows)


def png_bytes_rgba(width: int, height: int, rgba: bytes) -> bytes:
    def chunk(chunk_type: bytes, data: bytes) -> bytes:
        length = struct.pack(">I", len(data))
        crc = struct.pack(">I", zlib.crc32(chunk_type + data) & 0xFFFFFFFF)
        return length + chunk_type + data + crc

    signature = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    raw = b""
    stride = width * 4
    for y in range(height):
        raw += b"\x00" + rgba[y * stride : (y + 1) * stride]
    compressed = zlib.compress(raw, level=9)
    return (
        signature
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", compressed)
        + chunk(b"IEND", b"")
    )


def write_png_rgba(path: Path, width: int, height: int, rgba: bytes) -> None:
    png = png_bytes_rgba(width, height, rgba)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(png)


def write_favicon_ico(path: Path, png_32: bytes) -> None:
    """Windows Vista+ 支持 ICO 内嵌 PNG，与标签页 /favicon.ico 请求一致。"""
    if len(png_32) < 8 or png_32[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("expected PNG bytes")
    # ICONDIR + single ICONDIRENTRY + raw PNG
    offset = 6 + 16
    icondir = struct.pack("<HHH", 0, 1, 1)
    # 宽/高 32；PNG 嵌入时 planes=1 bitcount=32（部分浏览器亦接受 0,0）
    entry = struct.pack(
        "<BBBBHHII",
        32,
        32,
        0,
        0,
        1,
        32,
        len(png_32),
        offset,
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(icondir + entry + png_32)


def main() -> None:
    root = Path(__file__).resolve().parent.parent
    brand_dir = root / "public" / "brand"
    sizes = [
        (root / "public" / "logo.png", 512),
        (brand_dir / "logo-32.png", 32),
        (brand_dir / "logo-64.png", 64),
        (brand_dir / "logo-180.png", 180),
        (brand_dir / "logo-512.png", 512),
    ]
    for path, size in sizes:
        rgba = render_rgba(size)
        write_png_rgba(path, size, size, rgba)
        rel = path.relative_to(root)
        print(f"wrote {rel.as_posix()}")

    rgba_32 = render_rgba(32)
    png_32 = png_bytes_rgba(32, 32, rgba_32)
    ico_path = root / "public" / "favicon.ico"
    write_favicon_ico(ico_path, png_32)
    print(f"wrote {ico_path.relative_to(root).as_posix()}")

    print("Done.")


if __name__ == "__main__":
    main()
