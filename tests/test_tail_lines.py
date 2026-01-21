import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from codex_sidecar.watch.tail_lines import read_tail_lines


class TestTailLines(unittest.TestCase):
    def test_read_tail_lines_basic(self) -> None:
        with TemporaryDirectory() as td:
            p = Path(td) / "x.txt"
            p.write_bytes(b"a\nb\nc\n")
            out = read_tail_lines(p, last_lines=2)
            self.assertEqual(out, [b"b", b"c"])

    def test_read_tail_lines_no_trailing_newline(self) -> None:
        with TemporaryDirectory() as td:
            p = Path(td) / "x.txt"
            p.write_bytes(b"a\nb\nc")
            out = read_tail_lines(p, last_lines=2)
            self.assertEqual(out, [b"b", b"c"])

    def test_read_tail_lines_bounded(self) -> None:
        # Ensure max_bytes bounding does not crash and returns something reasonable.
        with TemporaryDirectory() as td:
            p = Path(td) / "x.txt"
            p.write_bytes((b"x" * 2000) + b"\n" + (b"y" * 2000) + b"\n" + b"tail\n")
            out = read_tail_lines(p, last_lines=1, max_bytes=1024)
            self.assertTrue(out)


if __name__ == "__main__":
    unittest.main()

