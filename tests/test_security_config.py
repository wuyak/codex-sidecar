import unittest


from codex_sidecar.security import MASK, redact_sidecar_config, restore_masked_secrets_in_patch


class TestSecurityConfig(unittest.TestCase):
    def test_redact_sidecar_config(self) -> None:
        cfg = {
            "translator_provider": "openai",
            "translator_config": {
                "openai": {"base_url": "https://secret.example/v1", "api_key": "sk-test-123", "model": "gpt"},
                "nvidia": {"base_url": "https://integrate.api.nvidia.com/v1", "api_key": "nvapi-xyz", "model": "m"},
                "http": {
                    "selected": "默认",
                    "profiles": [{"name": "默认", "url": "http://127.0.0.1:9000/translate", "token": "tok-1", "timeout_s": 3}],
                },
            },
        }
        red = redact_sidecar_config(cfg)
        self.assertEqual(red["translator_config"]["openai"]["base_url"], MASK)
        self.assertEqual(red["translator_config"]["openai"]["api_key"], MASK)
        self.assertEqual(red["translator_config"]["nvidia"]["api_key"], MASK)
        self.assertEqual(red["translator_config"]["nvidia"]["base_url"], "https://integrate.api.nvidia.com/v1")
        self.assertEqual(red["translator_config"]["http"]["profiles"][0]["token"], MASK)

    def test_restore_masked_secrets_in_patch(self) -> None:
        current = {
            "translator_config": {
                "openai": {"base_url": "https://secret.example/v1", "api_key": "sk-test-123", "model": "gpt"},
                "nvidia": {"base_url": "https://integrate.api.nvidia.com/v1", "api_key": "nvapi-xyz", "model": "m"},
                "http": {
                    "selected": "默认",
                    "profiles": [
                        {"name": "默认", "url": "http://127.0.0.1:9000/translate", "token": "tok-1", "timeout_s": 3},
                        {"name": "备用", "url": "http://127.0.0.1:9001/translate", "token": "tok-2", "timeout_s": 3},
                    ],
                },
            }
        }
        patch = {
            "translator_provider": "openai",
            "translator_config": {
                "openai": {"base_url": MASK, "api_key": MASK, "model": "gpt-new"},
                "nvidia": {"api_key": MASK},
                "http": {"profiles": [{"name": "备用", "url": "http://x", "token": MASK}]},
            },
        }
        restored = restore_masked_secrets_in_patch(patch, current_cfg=current)
        self.assertEqual(restored["translator_config"]["openai"]["base_url"], "https://secret.example/v1")
        self.assertEqual(restored["translator_config"]["openai"]["api_key"], "sk-test-123")
        self.assertEqual(restored["translator_config"]["openai"]["model"], "gpt-new")
        self.assertEqual(restored["translator_config"]["nvidia"]["api_key"], "nvapi-xyz")
        self.assertEqual(restored["translator_config"]["http"]["profiles"][0]["token"], "tok-2")


if __name__ == "__main__":
    unittest.main()

