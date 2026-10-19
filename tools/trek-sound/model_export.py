"""Exports a compact resynthesis model of a clip for the browser player.

usage: model_export.py IN OUT.json [--seconds S] [--name NAME] [--source LABEL]

Analysis as sms2 (4096-point Hann, 128-sample hop, phase-matched partials, true
residual). Then:
  partials: tracks quieter than -46 dB below the clip's loudest partial, or
            shorter than three frames, are dropped; the rest are resampled to a
            512-sample grid (11.6 ms) and quantized (0.1 Hz, four digits);
  noise:    the residual's STFT magnitude summed into 32 log-spaced bands per
            11.6 ms frame, as the RMS amplitude each band should carry.
The player drives one sine oscillator per track and one band-pass noise
voice per band from these curves. No phase is kept: the ear does not need it
for playback, only the analysis did, to find the residual.
"""
import json
import sys
from pathlib import Path

import numpy as np
from scipy.signal import stft, get_window

sys.path.insert(0, str(Path(__file__).parent))
from sms2 import SR, audio_load, tracks_build, tracks_render  # noqa: E402

N, HOP, K, FLOOR_DB = 4096, 128, 120, -70.0
STEP = 4                     # frames per exported frame: 4 x 128 = 512 samples
BANDS = 32
BAND_LO, BAND_HI = 60.0, 16000.0


def main():
    args = sys.argv[1:]
    src, out = args[0], args[1]
    opt = lambda name, default, cast: cast(args[args.index(name) + 1]) if name in args else default
    seconds = opt("--seconds", 4.5, float)
    name = opt("--name", Path(src).stem, str)
    source = opt("--source", Path(src).name, str)
    x = audio_load(src, seconds)
    if x.size < 2 * N:
        x = np.concatenate([x, np.zeros(2 * N - x.size)])
    win = get_window("hann", N)
    f, t, X = stft(x, SR, window=win, nperseg=N, noverlap=N - HOP)
    X = X * np.where(np.arange(X.shape[0]) % 2 == 0, 1.0, -1.0)[:, None]
    tracks = tracks_build(X, f[1] - f[0], K, FLOOR_DB, tol=0.02, min_len=3)
    y_sin = tracks_render(tracks, x.size, HOP, N, win_gain=2.0)
    r = x - y_sin

    # partials, pruned and thinned
    loudest = max(max(p[2] for p in tr) for tr in tracks) if tracks else 1.0
    keep = [tr for tr in tracks if max(p[2] for p in tr) >= loudest * 10 ** (-46 / 20)]
    keep.sort(key=lambda tr: -sum(p[2] ** 2 for p in tr))
    energies = np.array([sum(p[2] ** 2 for p in tr) for tr in keep])
    covered = np.cumsum(energies) / (energies.sum() + 1e-12)
    n_keep = int(np.searchsorted(covered, 0.995)) + 1
    keep = keep[:min(1200, max(n_keep, 1))]
    frame_sec = STEP * HOP / SR
    exported = []
    for tr in keep:
        fr = np.array([p[0] for p in tr], dtype=float)
        hz = np.array([p[1] for p in tr])
        amp = np.array([p[2] for p in tr]) * 2.0        # scipy's STFT peak is half the sine's amplitude
        g0 = int(np.floor(fr[0] / STEP))
        g1 = int(np.ceil(fr[-1] / STEP))
        grid = np.arange(g0, g1 + 1) * STEP
        if grid.size < 2:
            grid = np.array([fr[0], fr[-1]])
        hz_g = np.interp(grid, fr, hz)
        amp_g = np.interp(grid, fr, amp, left=0.0, right=0.0)
        exported.append([g0, [round(float(v), 1) for v in hz_g], [float(f"{v:.3g}") for v in amp_g]])

    # the residual as band amplitudes per exported frame
    fr_, _, R = stft(r, SR, nperseg=2048, noverlap=2048 - STEP * HOP)
    _, _, O = stft(x, SR, nperseg=2048, noverlap=2048 - STEP * HOP)
    mag = np.abs(R) * 2.0                                 # same peak-to-amplitude scaling
    omag = np.abs(O) * 2.0
    gate = omag.max() * 10 ** (-60 / 20)
    edges = np.geomspace(BAND_LO, BAND_HI, BANDS + 1)
    centres = np.sqrt(edges[:-1] * edges[1:])
    frames = []
    for i in range(mag.shape[1]):
        row = []
        for a, b in zip(edges[:-1], edges[1:]):
            sel = (fr_ >= a) & (fr_ < b)
            # no more than the original carries in this band, and nothing where the original is silent
            ov = float(np.sqrt(np.mean(omag[sel, i] ** 2))) if sel.any() else 0.0
            v = min(float(np.sqrt(np.mean(mag[sel, i] ** 2))), ov) if (sel.any() and ov > gate) else 0.0
            row.append(float(f"{v:.3g}"))
        frames.append(row)
    # trailing silence off
    while frames and max(frames[-1]) < 1e-5 and len(frames) > 2:
        frames.pop()

    model = {
        "name": name, "source": source, "sr": SR, "frame": round(frame_sec, 6),
        "frames": max(len(frames), max((e[0] + len(e[1]) for e in exported), default=0)),
        "peak": float(f"{float(np.abs(x).max()):.3g}"),
        "tracks": exported,
        "noise": {"centres": [round(float(c), 1) for c in centres], "q": 4.5, "frames": frames},
    }
    Path(out).write_text(json.dumps(model, separators=(",", ":")))
    print(json.dumps({"name": name, "seconds": round(x.size / SR, 2), "tracks_all": len(tracks), "tracks_kept": len(exported),
                      "frames": model["frames"], "bytes": Path(out).stat().st_size,
                      "residual_share": round(float(np.sum(r ** 2) / (np.sum(x ** 2) + 1e-12)), 3),
                      "rms_x": round(float(np.sqrt(np.mean(x ** 2))), 4), "rms_sin": round(float(np.sqrt(np.mean(y_sin ** 2))), 4), "rms_res": round(float(np.sqrt(np.mean(r ** 2))), 4)}))


if __name__ == "__main__":
    main()
