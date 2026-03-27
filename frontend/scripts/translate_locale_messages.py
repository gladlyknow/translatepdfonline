#!/usr/bin/env python3
"""
Translate all messages/en JSON strings into target locales (deduped per locale).
Usage: pip install deep-translator && python scripts/translate_locale_messages.py [--locale es]

Skips: translate/languages.json
"""
from __future__ import annotations

import argparse
import json
import re
import time
from pathlib import Path

try:
    from deep_translator import GoogleTranslator
except ImportError:
    raise SystemExit("Run: pip install deep-translator")

ROOT = Path(__file__).resolve().parent.parent
EN = ROOT / "src" / "config" / "locale" / "messages" / "en"

LOCALES = {
    "es": "es",
    "fr": "fr",
    "it": "it",
    "el": "el",
    "ja": "ja",
    "ko": "ko",
    "de": "de",
    "ru": "ru",
}

SKIP_REL = {"translate/languages.json"}

SKIP_PATTERN = re.compile(
    r"^[\s\d$.,/\-:%]+$|@|https?://|\.(png|jpg|jpeg|svg|webp|ico|pdf)(\?|$)|"
    r"^[a-z0-9][a-z0-9_.-]*$|^[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]+)*$",
)

# Single-token paths and API routes (do not send to machine translation)
PURE_PATH = re.compile(r"^/[\w./\-?&=%]*$", re.I)


def should_translate(s: str) -> bool:
    s = s.strip()
    if len(s) < 2:
        return False
    if PURE_PATH.match(s):
        return False
    if "<a " in s.lower() or "href=" in s.lower():
        return False
    if SKIP_PATTERN.search(s):
        return False
    if s in {"USD", "Creem"}:
        return False
    letters = sum(c.isalpha() for c in s)
    if letters < 2:
        return False
    return True


def collect_strings(obj, out: set[str]) -> None:
    if isinstance(obj, dict):
        for v in obj.values():
            collect_strings(v, out)
    elif isinstance(obj, list):
        for v in obj:
            collect_strings(v, out)
    elif isinstance(obj, str) and should_translate(obj):
        out.add(obj)


def apply_map(obj, m: dict[str, str]):
    if isinstance(obj, dict):
        return {k: apply_map(v, m) for k, v in obj.items()}
    if isinstance(obj, list):
        return [apply_map(v, m) for v in obj]
    if isinstance(obj, str) and obj in m:
        return m[obj]
    return obj


def translate_all(
    texts: list[str], dest: str, delay: float = 0.08, retries: int = 2
) -> dict[str, str]:
    tr = GoogleTranslator(source="en", target=dest)
    out: dict[str, str] = {}
    for i, t in enumerate(texts):
        last_err: Exception | None = None
        for attempt in range(retries + 1):
            try:
                out[t] = tr.translate(t)
                last_err = None
                break
            except Exception as e:
                last_err = e
                time.sleep(delay * (attempt + 1) * 2)
        if last_err is not None:
            print(f"    fail: {t[:48]}... | {last_err}")
            out[t] = t
        time.sleep(delay)
        if (i + 1) % 50 == 0:
            print(f"    {i + 1}/{len(texts)}")
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--locale", choices=list(LOCALES.keys()))
    ap.add_argument("--delay", type=float, default=0.08)
    ap.add_argument("--retries", type=int, default=2, help="Retries per string on API errors")
    args = ap.parse_args()
    targets = {args.locale: LOCALES[args.locale]} if args.locale else LOCALES

    files = [f for f in sorted(EN.rglob("*.json")) if f.relative_to(EN).as_posix() not in SKIP_REL]

    all_strings: set[str] = set()
    file_data: list[tuple[Path, dict]] = []
    for f in files:
        data = json.loads(f.read_text(encoding="utf-8"))
        collect_strings(data, all_strings)
        file_data.append((f, data))

    print(f"Unique translatable strings (en): {len(all_strings)}")

    for loc, gcode in targets.items():
        print(f"\n=== Translating -> {loc} ({gcode}) ===")
        mapping = translate_all(
            sorted(all_strings), gcode, delay=args.delay, retries=args.retries
        )
        out_root = ROOT / "src" / "config" / "locale" / "messages" / loc
        for f, data in file_data:
            rel = f.relative_to(EN).as_posix()
            new_data = apply_map(data, mapping)
            dest = out_root / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_text(
                json.dumps(new_data, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            print(f"  wrote {rel}")
        print(f"  done {loc}")


if __name__ == "__main__":
    main()
