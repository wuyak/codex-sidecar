import unittest

from codex_sidecar.watch.translation_pump_items import collect_ids, collect_pairs


class TestTranslationPumpItems(unittest.TestCase):
    def test_collect_pairs_filters_invalid(self) -> None:
        batch = [
            {"id": "a", "text": " x "},
            {"id": "b", "text": ""},
            {"id": "", "text": "y"},
            {"id": "c", "text": "  "},
            {"id": "d", "text": "ok"},
            "not-a-dict",
            {"id": None, "text": "z"},
        ]
        self.assertEqual(collect_pairs(batch), [("a", " x "), ("d", "ok")])

    def test_collect_ids_filters_invalid(self) -> None:
        batch = [{"id": "a"}, {"id": ""}, {"id": None}, "x", {"id": "b"}]
        self.assertEqual(collect_ids(batch), ["a", "b"])


if __name__ == "__main__":
    unittest.main()

