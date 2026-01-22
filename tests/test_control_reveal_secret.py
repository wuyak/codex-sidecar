import unittest

from codex_sidecar.control.reveal_secret import reveal_secret


class TestRevealSecret(unittest.TestCase):
    def test_openai_fields(self) -> None:
        cfg = {"translator_config": {"openai": {"api_key": "sk-xxx", "base_url": "http://x"}}}
        r1 = reveal_secret(cfg, "openai", "api_key")
        self.assertEqual(r1.get("ok"), True)
        self.assertEqual(r1.get("value"), "sk-xxx")

        r2 = reveal_secret(cfg, "openai", "base_url")
        self.assertEqual(r2.get("ok"), True)
        self.assertEqual(r2.get("value"), "http://x")

    def test_openai_legacy_layout(self) -> None:
        # legacy: translator_config itself stores openai keys
        cfg = {"translator_config": {"api_key": "sk-legacy", "base_url": "http://legacy"}}
        r1 = reveal_secret(cfg, "openai", "api_key")
        self.assertEqual(r1.get("ok"), True)
        self.assertEqual(r1.get("value"), "sk-legacy")

    def test_nvidia_api_key(self) -> None:
        cfg = {"translator_config": {"nvidia": {"api_key": "nv-xxx"}}}
        r = reveal_secret(cfg, "nvidia", "api_key")
        self.assertEqual(r.get("ok"), True)
        self.assertEqual(r.get("value"), "nv-xxx")

    def test_http_token_profiles_and_fallback(self) -> None:
        cfg = {
            "translator_config": {
                "http": {
                    "selected": "p1",
                    "profiles": [
                        {"name": "p1", "token": "t1"},
                        {"name": "p2", "token": "t2"},
                    ],
                }
            }
        }
        r1 = reveal_secret(cfg, "http", "token")
        self.assertEqual(r1.get("ok"), True)
        self.assertEqual(r1.get("profile"), "p1")
        self.assertEqual(r1.get("value"), "t1")

        r2 = reveal_secret(cfg, "http", "token", profile="missing")
        self.assertEqual(r2.get("ok"), True)
        self.assertEqual(r2.get("profile"), "missing")
        self.assertEqual(r2.get("value"), "")

    def test_http_legacy_token(self) -> None:
        cfg = {"translator_config": {"http": {"token": "tok"}}}
        r = reveal_secret(cfg, "http", "token", profile="p1")
        self.assertEqual(r.get("ok"), True)
        self.assertEqual(r.get("value"), "tok")


if __name__ == "__main__":
    unittest.main()
