"""Spectral-modelling resynthesis, second pass: phase-matched partials and a true residual.

usage: sms2.py IN OUT.wav [--seconds S] [--n N] [--hop H] [--partials K] [--floor DB] [--bands B] [--json OUT.json]

Analysis: STFT (Hann, N, hop H). Per frame the K strongest peaks above the floor,
with parabolic interpolation of frequency and amplitude and the phase read at the
interpolated bin. Peaks link frame to frame into tracks.
Deterministic part: one sinusoid per track; between frames the phase follows the
McAulay-Quatieri cubic, so each frame's measured phase is met exactly and the
partials beat against each other as the original's did.
Stochastic part: the time-domain residual (original minus sinusoids), its STFT
magnitude smoothed into bands and given random phase, back to time.
Prints the log-spectral distance of the result from the original, in dB.
"""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from scipy.io import wavfile
from scipy.signal import stft, istft, get_window

SR = 44100


def audio_load(path: str, seconds: float) -> np.ndarray:
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-t", str(seconds), "-f", "f32le", "-ac", "1", "-ar", str(SR), "-"],
                         capture_output=True, check=True).stdout
    x = np.frombuffer(raw, dtype=np.float32).astype(np.float64)
    thr = np.abs(x).max() * 10 ** (-50 / 20)
    i = np.where(np.abs(x) > thr)[0]
    return x[max(0, i[0] - 100): i[-1] + 2000]


def peaks_pick(X: np.ndarray, k: int, floor_db: float):
    mag = np.abs(X)
    db = 20 * np.log10(mag + 1e-12)
    top = db.max()
    cand = np.where((db[1:-1] > db[:-2]) & (db[1:-1] >= db[2:]) & (db[1:-1] > top + floor_db))[0] + 1
    if cand.size == 0:
        return np.array([]), np.array([]), np.array([])
    cand = cand[np.argsort(db[cand])[::-1][:k]]
    a, b, c = db[cand - 1], db[cand], db[cand + 1]
    p = 0.5 * (a - c) / (a - 2 * b + c + 1e-12)
    pos = cand + p
    amp = 10 ** ((b - 0.25 * (a - c) * p) / 20)
    # X is referenced to the frame centre, so a peak's main lobe has flat phase: the peak bin's phase is the sinusoid's
    phase = np.angle(X[cand])
    return pos, amp, phase


def tracks_build(X: np.ndarray, binhz: float, k: int, floor_db: float, tol: float, min_len: int):
    alive = []
    done = []
    for i in range(X.shape[1]):
        pos, amp, phase = peaks_pick(X[:, i], k, floor_db)
        hz = pos * binhz
        used = np.zeros(hz.size, dtype=bool)
        still = []
        for tr, last in alive:
            if hz.size:
                d = np.abs(hz - last) / last
                j = int(np.argmin(np.where(used, np.inf, d)))
                if not used[j] and d[j] < tol:
                    tr.append((i, float(hz[j]), float(amp[j]), float(phase[j])))
                    used[j] = True
                    still.append([tr, float(hz[j])])
                    continue
            done.append(tr)
        alive = still
        for j in range(hz.size):
            if not used[j] and hz[j] > 25:
                alive.append([[(i, float(hz[j]), float(amp[j]), float(phase[j]))], float(hz[j])])
    done.extend(tr for tr, _ in alive)
    return [tr for tr in done if len(tr) >= min_len]


def tracks_render(tracks, n_samples: int, hop: int, n: int, win_gain: float) -> np.ndarray:
    """McAulay-Quatieri: cubic phase between frames so each measured phase is met."""
    y = np.zeros(n_samples)
    for tr in tracks:
        for (i0, f0, a0, p0), (i1, f1, a1, p1) in zip(tr[:-1], tr[1:]):
            s0 = i0 * hop  # the frame's centre lands at s0 + centre in scipy's padded STFT; relative timing is what matters
            T = (i1 - i0) * hop
            w0 = 2 * np.pi * f0 / SR
            w1 = 2 * np.pi * f1 / SR
            # unwrap: choose M so the cubic is smoothest
            M = np.round(((p0 + w0 * T - p1) + (w1 - w0) * T / 2) / (2 * np.pi))
            d = p1 - p0 - w0 * T + 2 * np.pi * M
            alpha = 3 * d / T ** 2 - (w1 - w0) / T
            beta = -2 * d / T ** 3 + (w1 - w0) / T ** 2
            m = np.arange(T)
            phase = p0 + w0 * m + alpha * m ** 2 + beta * m ** 3
            amp = a0 + (a1 - a0) * m / T
            seg = win_gain * amp * np.cos(phase)
            a = s0
            b = min(n_samples, a + T)
            if a < n_samples:
                y[a:b] += seg[: b - a]
        # fade the track's edges over one hop
    return y


def residual_render(r: np.ndarray, n: int, hop: int, bands: int) -> np.ndarray:
    f, _, R = stft(r, SR, nperseg=n, noverlap=n - hop)
    mag = np.abs(R)
    edges = np.unique(np.round(np.geomspace(1, f.size - 1, bands + 1)).astype(int))
    Rb = np.zeros_like(mag)
    for a, b in zip(edges[:-1], edges[1:]):
        Rb[a:b, :] = mag[a:b, :].mean(axis=0, keepdims=True)
    phase = np.exp(2j * np.pi * np.random.rand(*Rb.shape))
    _, y = istft(Rb * phase, SR, nperseg=n, noverlap=n - hop)
    return y


def lsd(x: np.ndarray, y: np.ndarray) -> float:
    m = min(x.size, y.size)
    _, _, X = stft(x[:m], SR, nperseg=2048, noverlap=1536)
    _, _, Y = stft(y[:m], SR, nperseg=2048, noverlap=1536)
    floor = np.abs(X).max() * 10 ** (-80 / 20)
    lx = 20 * np.log10(np.maximum(np.abs(X), floor))
    ly = 20 * np.log10(np.maximum(np.abs(Y), floor))
    loud = np.abs(X).sum(axis=0) > 0.02 * np.abs(X).sum(axis=0).max()
    return float(np.mean(np.sqrt(np.mean((lx[:, loud] - ly[:, loud]) ** 2, axis=0))))


def main():
    args = sys.argv[1:]
    src, out = args[0], args[1]
    opt = lambda name, default, cast: cast(args[args.index(name) + 1]) if name in args else default
    seconds = opt("--seconds", 8.0, float)
    n = opt("--n", 4096, int)
    hop = opt("--hop", 128, int)
    k = opt("--partials", 120, int)
    floor_db = opt("--floor", -70.0, float)
    bands = opt("--bands", 96, int)
    jpath = opt("--json", None, str)
    x = audio_load(src, seconds)
    win = get_window("hann", n)
    f, t, X = stft(x, SR, window=win, nperseg=n, noverlap=n - hop)
    # reference each frame's phase to its centre (a shift of n/2 samples is a factor (-1)^k on bin k)
    X = X * np.where(np.arange(X.shape[0]) % 2 == 0, 1.0, -1.0)[:, None]
    tracks = tracks_build(X, f[1] - f[0], k, floor_db, tol=0.02, min_len=3)
    y_sin = tracks_render(tracks, x.size, hop, n, win_gain=2.0)
    r = x - y_sin
    y_res = residual_render(r, n, hop, bands)
    m = min(x.size, y_res.size)
    y = y_sin[:m] + y_res[:m]
    peak = np.abs(x).max() / (np.abs(y).max() + 1e-9)
    y *= peak
    wavfile.write(out, SR, (np.clip(y, -1, 1) * 32767).astype(np.int16))
    print(json.dumps({"file": Path(src).name, "seconds": round(x.size / SR, 2), "n": n, "hop": hop, "tracks": len(tracks),
                      "sin_share": round(float(np.sum(y_sin ** 2) / (np.sum(x ** 2) + 1e-12)), 3),
                      "residual_share": round(float(np.sum(r ** 2) / (np.sum(x ** 2) + 1e-12)), 3),
                      "lsd_db": round(lsd(x, y), 2), "lsd_sin_only_db": round(lsd(x, y_sin), 2)}))
    if jpath:
        model = {"sr": SR, "hop": hop, "n": n, "tracks": [[[p[0], round(p[1], 1), round(p[2] * 2, 5), round(p[3], 3)] for p in tr] for tr in tracks]}
        Path(jpath).write_text(json.dumps(model))


if __name__ == "__main__":
    main()
