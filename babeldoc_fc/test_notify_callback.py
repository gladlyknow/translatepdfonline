"""Callback payload: completed + suggest_try_ocr."""
from __future__ import annotations

import importlib.util
import unittest
from unittest.mock import MagicMock, patch


def _has_fastapi() -> bool:
    return importlib.util.find_spec("fastapi") is not None


@unittest.skipUnless(_has_fastapi(), "fastapi not installed (pip install -r babeldoc_fc/requirements.txt)")
class TestNotifyCallbackPayload(unittest.TestCase):
    def test_completed_includes_suggest_try_ocr(self):
        from babeldoc_fc import main

        mock_post = MagicMock()
        mock_post.return_value.status_code = 200
        mock_client = MagicMock()
        mock_client.__enter__.return_value.post = mock_post
        mock_client.__exit__.return_value = None

        with patch.object(main.httpx, "Client", return_value=mock_client):
            ok = main._notify_callback(
                "http://example.com/cb",
                "task_1",
                "completed",
                output_object_key="out.pdf",
                translated_page_count=2,
                suggest_try_ocr=True,
            )
        self.assertTrue(ok)
        _args, kwargs = mock_post.call_args
        body = kwargs["json"]
        self.assertEqual(body["status"], "completed")
        self.assertEqual(body["suggest_try_ocr"], True)
        self.assertEqual(body["translated_page_count"], 2)

    def test_completed_omits_suggest_when_false(self):
        from babeldoc_fc import main

        mock_post = MagicMock()
        mock_post.return_value.status_code = 200
        mock_client = MagicMock()
        mock_client.__enter__.return_value.post = mock_post
        mock_client.__exit__.return_value = None

        with patch.object(main.httpx, "Client", return_value=mock_client):
            main._notify_callback(
                "http://example.com/cb",
                "task_1",
                "completed",
                output_object_key="out.pdf",
                translated_page_count=1,
                suggest_try_ocr=False,
            )
        _args, kwargs = mock_post.call_args
        body = kwargs["json"]
        self.assertNotIn("suggest_try_ocr", body)


if __name__ == "__main__":
    unittest.main()
