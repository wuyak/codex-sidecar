import unittest

from codex_sidecar.config import SidecarConfig
from codex_sidecar.control.watcher_hot_updates import apply_watcher_hot_updates


class _TranslatorA:
    def translate(self, text: str) -> str:
        return "a:" + str(text)


class _TranslatorB:
    def translate(self, text: str) -> str:
        return "b:" + str(text)


class _FakeWatcher:
    def __init__(self) -> None:
        self.calls = []

    def set_translate_mode(self, mode: str) -> None:
        self.calls.append(("set_translate_mode", mode))

    def set_translator(self, tr) -> None:
        self.calls.append(("set_translator", tr))

    def set_watch_max_sessions(self, n: int) -> None:
        self.calls.append(("set_watch_max_sessions", int(n)))

    def set_replay_last_lines(self, n: int) -> None:
        self.calls.append(("set_replay_last_lines", int(n)))

    def set_poll_interval_s(self, s: float) -> None:
        self.calls.append(("set_poll_interval_s", float(s)))

    def set_file_scan_interval_s(self, s: float) -> None:
        self.calls.append(("set_file_scan_interval_s", float(s)))

    def set_follow_picker_config(self, *, follow_codex_process: bool, codex_process_regex: str, only_follow_when_process: bool) -> None:
        self.calls.append(
            (
                "set_follow_picker_config",
                bool(follow_codex_process),
                str(codex_process_regex),
                bool(only_follow_when_process),
            )
        )


def _cfg(**overrides) -> SidecarConfig:
    base = {
        "config_home": "/tmp/sidecar-config",
        "watch_codex_home": "/tmp/codex-home",
        "translate_mode": "auto",
        "translator_provider": "openai",
        "watch_max_sessions": 3,
        "replay_last_lines": 200,
        "poll_interval": 0.5,
        "file_scan_interval": 2.0,
        "follow_codex_process": False,
        "codex_process_regex": "codex",
        "only_follow_when_process": True,
    }
    base.update(overrides)
    return SidecarConfig.from_dict(base)


class TestWatcherHotUpdates(unittest.TestCase):
    def test_noop_when_not_running(self) -> None:
        w = _FakeWatcher()
        apply_watcher_hot_updates(
            watcher=w,  # type: ignore[arg-type]
            running=False,
            cfg=_cfg(translate_mode="manual"),
            prev_translate_mode="auto",
            prev_provider="openai",
            touched_translator=False,
            build_translator=lambda _cfg: _TranslatorA(),
            build_translator_fallback=lambda _cfg: _TranslatorB(),
        )
        self.assertEqual(w.calls, [])

    def test_translate_mode_change_triggers_set_translate_mode(self) -> None:
        w = _FakeWatcher()
        apply_watcher_hot_updates(
            watcher=w,  # type: ignore[arg-type]
            running=True,
            cfg=_cfg(translate_mode="manual"),
            prev_translate_mode="auto",
            prev_provider="openai",
            touched_translator=False,
            build_translator=lambda _cfg: _TranslatorA(),
            build_translator_fallback=lambda _cfg: _TranslatorB(),
        )
        names = [c[0] for c in w.calls]
        self.assertIn("set_translate_mode", names)
        # Always-apply runtime settings
        self.assertIn("set_watch_max_sessions", names)
        self.assertIn("set_replay_last_lines", names)
        self.assertIn("set_poll_interval_s", names)
        self.assertIn("set_file_scan_interval_s", names)
        self.assertIn("set_follow_picker_config", names)

    def test_provider_change_triggers_set_translator(self) -> None:
        w = _FakeWatcher()
        apply_watcher_hot_updates(
            watcher=w,  # type: ignore[arg-type]
            running=True,
            cfg=_cfg(translator_provider="nvidia"),
            prev_translate_mode="auto",
            prev_provider="openai",
            touched_translator=False,
            build_translator=lambda _cfg: _TranslatorA(),
            build_translator_fallback=lambda _cfg: _TranslatorB(),
        )
        tr_calls = [c for c in w.calls if c[0] == "set_translator"]
        self.assertEqual(len(tr_calls), 1)
        self.assertTrue(hasattr(tr_calls[0][1], "translate"))

    def test_touched_translator_triggers_rebuild_even_if_provider_same(self) -> None:
        w = _FakeWatcher()
        apply_watcher_hot_updates(
            watcher=w,  # type: ignore[arg-type]
            running=True,
            cfg=_cfg(translator_provider="openai"),
            prev_translate_mode="auto",
            prev_provider="openai",
            touched_translator=True,
            build_translator=lambda _cfg: _TranslatorA(),
            build_translator_fallback=lambda _cfg: _TranslatorB(),
        )
        tr_calls = [c for c in w.calls if c[0] == "set_translator"]
        self.assertEqual(len(tr_calls), 1)

    def test_fallback_translator_used_when_builder_returns_none(self) -> None:
        w = _FakeWatcher()
        apply_watcher_hot_updates(
            watcher=w,  # type: ignore[arg-type]
            running=True,
            cfg=_cfg(translator_provider="http"),
            prev_translate_mode="auto",
            prev_provider="openai",
            touched_translator=True,
            build_translator=lambda _cfg: None,
            build_translator_fallback=lambda _cfg: _TranslatorB(),
        )
        tr_calls = [c for c in w.calls if c[0] == "set_translator"]
        self.assertEqual(len(tr_calls), 1)
        self.assertIsInstance(tr_calls[0][1], _TranslatorB)


if __name__ == "__main__":
    unittest.main()

