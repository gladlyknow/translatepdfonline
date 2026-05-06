"""Unit tests for text_layer_gate (run: python -m unittest babeldoc_fc.test_text_layer_gate)."""
from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock

from babeldoc_fc.text_layer_gate import (
    InsufficientTextLayerForTranslationError,
    effective_pages_for_gate,
    enforce_text_layer_after_translate,
)


class _FakeResult:
    def __init__(self, **kw):
        for k, v in kw.items():
            setattr(self, k, v)


class TestEffectivePages(unittest.TestCase):
    def test_range_caps_to_doc_pages(self):
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
            p = Path(f.name)
        try:
            p.write_bytes(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
            n = effective_pages_for_gate(p, "1-99")
            self.assertGreaterEqual(n, 1)
        finally:
            p.unlink(missing_ok=True)


class TestEnforceGate(unittest.TestCase):
    def setUp(self):
        self._prev = {
            k: os.environ.pop(k, None)
            for k in (
                "BABELDOC_INSUFFICIENT_TEXT_CHECK",
                "BABELDOC_MIN_VALID_CHARS_TOTAL",
                "BABELDOC_MIN_VALID_CHARS_PER_PAGE",
            )
        }

    def tearDown(self):
        for k, v in self._prev.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    def test_disabled_skips(self):
        os.environ["BABELDOC_INSUFFICIENT_TEXT_CHECK"] = "0"
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
            p = Path(f.name)
        try:
            p.write_bytes(b"%PDF-1.4\n")
            enforce_text_layer_after_translate(
                _FakeResult(total_valid_character_count=0), p, None
            )
        finally:
            p.unlink(missing_ok=True)

    def test_zero_chars_raises(self):
        os.environ["BABELDOC_INSUFFICIENT_TEXT_CHECK"] = "1"
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
            p = Path(f.name)
        try:
            p.write_bytes(b"%PDF-1.4\n")
            with self.assertRaises(InsufficientTextLayerForTranslationError):
                enforce_text_layer_after_translate(
                    _FakeResult(
                        total_valid_character_count=0,
                        paragraph_extractable_total=0,
                        paragraph_llm_total=0,
                        paragraph_llm_ok=0,
                        paragraph_llm_fallback=0,
                    ),
                    p,
                    None,
                )
        finally:
            p.unlink(missing_ok=True)

    def test_multi_page_low_chars_raises(self):
        os.environ["BABELDOC_INSUFFICIENT_TEXT_CHECK"] = "1"
        os.environ["BABELDOC_MIN_VALID_CHARS_PER_PAGE"] = "100"
        pdf = MagicMock(spec=Path)
        pdf.__str__ = lambda _: "x.pdf"  # type: ignore[method-assign]
        with unittest.mock.patch(
            "babeldoc_fc.text_layer_gate._pdf_num_pages", return_value=10
        ):
            with self.assertRaises(InsufficientTextLayerForTranslationError):
                enforce_text_layer_after_translate(
                    _FakeResult(
                        total_valid_character_count=50,
                        paragraph_extractable_total=20,
                        paragraph_llm_total=10,
                        paragraph_llm_ok=9,
                        paragraph_llm_fallback=1,
                    ),
                    pdf,
                    None,
                )

    def test_llm_ok_ratio_raises(self):
        os.environ["BABELDOC_INSUFFICIENT_TEXT_CHECK"] = "1"
        pdf = MagicMock(spec=Path)
        with unittest.mock.patch(
            "babeldoc_fc.text_layer_gate._pdf_num_pages", return_value=1
        ):
            with self.assertRaises(InsufficientTextLayerForTranslationError):
                enforce_text_layer_after_translate(
                    _FakeResult(
                        total_valid_character_count=500,
                        paragraph_extractable_total=5,
                        paragraph_llm_total=5,
                        paragraph_llm_ok=1,
                        paragraph_llm_fallback=4,
                    ),
                    pdf,
                    None,
                )


if __name__ == "__main__":
    unittest.main()
