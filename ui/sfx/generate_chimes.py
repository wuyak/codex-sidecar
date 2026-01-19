"""
Generate small, soothing notification chimes for the sidecar UI.

Design goals:
- Local assets only (no CDN, no build)
- Short, non-intrusive "phone notification" feel (not clicky UI SFX)
- Tiny files (mono, 16-bit PCM WAV)

License:
This generator and its produced WAV files are intended to be CC0 (public domain).
"""

import math
import wave
from pathlib import Path
from typing import Iterable, List, Tuple


SR = 44_100


def _env(n: int, attack_s: float, release_s: float) -> List[float]:
    a = max(1, int(SR * max(0.001, attack_s)))
    r = max(1, int(SR * max(0.001, release_s)))
    out = [1.0] * n
    for i in range(min(a, n)):
        out[i] = (i + 1) / a
    for i in range(min(r, n)):
        k = n - 1 - i
        if k < 0:
            break
        out[k] *= (i + 1) / r
    return out


def _tone(freq_hz: float, dur_s: float, *, gain: float = 0.22) -> List[float]:
    n = max(1, int(SR * max(0.02, dur_s)))
    e = _env(n, attack_s=0.01, release_s=0.12)
    out: List[float] = []
    for i in range(n):
        t = i / SR
        # Soft bell-ish timbre: fundamental + a few harmonics.
        s = (
            1.00 * math.sin(2.0 * math.pi * freq_hz * t)
            + 0.35 * math.sin(2.0 * math.pi * (freq_hz * 2.01) * t)
            + 0.18 * math.sin(2.0 * math.pi * (freq_hz * 3.00) * t)
        )
        out.append((s / 1.60) * e[i] * gain)
    return out


def _silence(dur_s: float) -> List[float]:
    n = max(1, int(SR * max(0.001, dur_s)))
    return [0.0] * n


def _sequence(seq: List[Tuple[float, float]]) -> List[float]:
    out: List[float] = []
    for freq, dur in seq:
        if freq <= 0.0:
            out.extend(_silence(dur))
        else:
            out.extend(_tone(freq, dur))
    return out


def _write_wav(path: Path, data: List[float]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    # 16-bit PCM mono
    frames = bytearray()
    for v in data:
        x = max(-1.0, min(1.0, float(v)))
        s = int(round(x * 32767.0))
        frames.extend(int(s).to_bytes(2, "little", signed=True))
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(SR)
        wf.writeframes(frames)


def main() -> None:
    root = Path(__file__).resolve().parent
    out_dir = root / "builtin"

    # Simple, soothing chimes (C major-ish), 0.45–0.85s total.
    presets = {
        "chime-soft-1.wav": _sequence([(523.25, 0.62)]),  # C5
        "chime-soft-2.wav": _sequence([(659.25, 0.58)]),  # E5
        "chime-soft-3.wav": _sequence([(783.99, 0.55)]),  # G5
        "chime-gentle-up.wav": _sequence([(523.25, 0.28), (659.25, 0.34), (783.99, 0.34)]),
        "chime-gentle-down.wav": _sequence([(783.99, 0.30), (659.25, 0.34), (523.25, 0.36)]),
        "chime-double.wav": _sequence([(659.25, 0.26), (659.25, 0.26)]),
        "chime-alert-soft.wav": _sequence([(523.25, 0.22), (0.0, 0.10), (523.25, 0.32)]),
        "chime-alert-warm.wav": _sequence([(440.00, 0.26), (0.0, 0.10), (523.25, 0.34)]),
    }

    for name, data in presets.items():
        _write_wav(out_dir / name, data)


if __name__ == "__main__":
    main()
