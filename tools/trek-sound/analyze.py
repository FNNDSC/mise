"""Measure a sound: spectrogram, pitch track, envelope, tremolo, flatness.

usage: analyze.py OUT_DIR FILE [FILE...]

For each file writes OUT_DIR/<stem>.png (spectrogram, pitch, envelope) and
prints one JSON line of numbers a synthesizer can be set from.
"""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from scipy.signal import stft

SR = 44100


def audio_load(path: Path) -> np.ndarray:
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-f", "f32le", "-ac", "1", "-ar", str(SR), "-"],
        capture_output=True, check=True).stdout
    x = np.frombuffer(raw, dtype=np.float32).astype(np.float64)
    # trim leading/trailing silence below -50 dB
    thr = np.max(np.abs(x)) * 10 ** (-50 / 20) if x.size else 0
    idx = np.where(np.abs(x) > thr)[0]
    if idx.size:
        x = x[max(0, idx[0] - 200): idx[-1] + 200]
    return x


def pitch_track(f: np.ndarray, S: np.ndarray, fmin=40.0, fmax=6000.0) -> np.ndarray:
    """Fundamental per frame; NaN where the frame is quiet or noise-like.

    Two readings per frame: the harmonic product spectrum (good when the
    fundamental is present) and the spacing of the harmonic comb, read off the
    autocorrelation of the magnitude spectrum (good when it is not). The comb
    reading wins when it is clear; a frame whose spectrum is flat is unvoiced.
    """
    out = np.full(S.shape[1], np.nan)
    mag = np.abs(S)
    df = f[1] - f[0]
    frame_energy = mag.sum(axis=0)
    gate = 0.03 * frame_energy.max()
    band = (f >= fmin) & (f <= fmax)
    for i in range(S.shape[1]):
        m = mag[:, i]
        if frame_energy[i] < gate:
            continue
        # flatness: geometric over arithmetic mean; noise is near 1, a tone near 0
        lm = m[band] + 1e-12
        flat = np.exp(np.mean(np.log(lm))) / np.mean(lm)
        if flat > 0.35:
            continue
        # comb spacing from the spectrum's autocorrelation
        mm = m[band] - m[band].mean()
        ac = np.correlate(mm, mm, mode="full")[mm.size - 1:]
        # skip the autocorrelation's own peak at lag 0: search from its first zero crossing
        neg = np.where(ac < 0)[0]
        lo = max(int(fmin / df), int(neg[0]) if neg.size else 1)
        hi = min(ac.size - 1, int(3000 / df))
        if hi <= lo:
            continue
        k = lo + int(np.argmax(ac[lo:hi]))
        comb_hz = k * df
        comb_strength = ac[k] / (ac[0] + 1e-12)
        # harmonic product spectrum
        hps = m.copy()
        for h in (2, 3):
            d = m[::h]
            hps[: d.size] *= d
        hps[~band] = 0
        hps_hz = f[int(np.argmax(hps))]
        if comb_strength > 0.25:
            out[i] = comb_hz
        else:
            out[i] = hps_hz
    return out


def analyze(path: Path, out_dir: Path, window=None) -> dict:
    x = audio_load(path)
    if window is not None:
        a, b = window
        x = x[int(a * SR): int(b * SR)]
    dur = x.size / SR
    nper = 2048
    f, t, S = stft(x, SR, nperseg=nper, noverlap=nper - 256)
    mag = np.abs(S) + 1e-9
    db = 20 * np.log10(mag / mag.max())

    # envelope (RMS per 5 ms)
    hop = int(SR * 0.005)
    n = x.size // hop
    env = np.sqrt(np.mean(x[: n * hop].reshape(n, hop) ** 2, axis=1))
    et = np.arange(n) * hop / SR
    peak = env.max() + 1e-12
    env_n = env / peak
    i_peak = int(np.argmax(env_n))
    above = np.where(env_n > 0.1)[0]
    attack = et[i_peak]
    last = et[above[-1]] if above.size else dur
    # tremolo: dominant modulation of the envelope between 2 and 60 Hz
    trem_hz = None
    trem_depth = None
    if n > 40:
        e = env_n - np.convolve(env_n, np.ones(21) / 21, mode="same")
        spec = np.abs(np.fft.rfft(e * np.hanning(n)))
        fr = np.fft.rfftfreq(n, hop / SR)
        sel = (fr >= 2) & (fr <= 60)
        if sel.any() and spec[sel].max() > 0:
            k = np.argmax(spec[sel])
            trem_hz = float(fr[sel][k])
            trem_depth = float(min(1.0, 2 * spec[sel][k] / (n / 2) / (env_n.mean() + 1e-9)))

    # pitch
    p = pitch_track(f, S)
    voiced = ~np.isnan(p)
    pv = p[voiced]
    tv = t[voiced]
    # spectral centroid and flatness over the loud part
    loud = mag.sum(axis=0) > 0.1 * mag.sum(axis=0).max()
    cent = float((f[:, None] * mag[:, loud]).sum() / mag[:, loud].sum()) if loud.any() else None
    gm = np.exp(np.mean(np.log(mag[:, loud]), axis=0))
    am = np.mean(mag[:, loud], axis=0)
    flat = float(np.mean(gm / am)) if loud.any() else None

    harmonics = None
    if pv.size:
        i_loud = int(np.argmax(mag.sum(axis=0)))
        f0 = p[i_loud] if not np.isnan(p[i_loud]) else float(np.nanmedian(pv))
        amps = []
        for h in range(1, 9):
            k = int(round(h * f0 / (f[1] - f[0])))
            if k + 2 < mag.shape[0]:
                amps.append(float(mag[k - 2: k + 3, i_loud].max()))
        if amps and max(amps) > 0:
            harmonics = [round(a / max(amps), 2) for a in amps]
    info = {
        "file": path.name,
        "harmonics_1_to_8": harmonics,
        "dur_s": round(dur, 3),
        "attack_s": round(float(attack), 3),
        "decay_to_10pct_s": round(float(last), 3),
        "voiced_share": round(float(voiced.mean()), 2),
        "pitch_start_hz": round(float(pv[: max(1, pv.size // 10)].mean()), 1) if pv.size else None,
        "pitch_end_hz": round(float(pv[-max(1, pv.size // 10):].mean()), 1) if pv.size else None,
        "pitch_min_hz": round(float(pv.min()), 1) if pv.size else None,
        "pitch_max_hz": round(float(pv.max()), 1) if pv.size else None,
        "centroid_hz": round(cent, 1) if cent else None,
        "flatness": round(flat, 3) if flat is not None else None,
        "tremolo_hz": round(trem_hz, 1) if trem_hz else None,
        "tremolo_depth": round(trem_depth, 2) if trem_depth else None,
    }

    fig, ax = plt.subplots(3, 1, figsize=(11, 8), sharex=True, gridspec_kw={"height_ratios": [3, 1.4, 1]})
    fmax_plot = 8000
    sel = f <= fmax_plot
    ax[0].pcolormesh(t, f[sel], db[sel], vmin=-70, vmax=0, shading="auto", cmap="magma")
    ax[0].plot(tv, pv, ".", color="cyan", ms=2)
    ax[0].set_ylabel("Hz")
    ax[0].set_title(f"{path.name}  ({dur:.2f} s)")
    if pv.size:
        ax[1].plot(tv, pv, ".", ms=3, color="tab:blue")
        ax[1].set_yscale("log")
    ax[1].set_ylabel("pitch Hz")
    ax[1].grid(True, which="both", alpha=0.3)
    ax[2].plot(et, env_n, color="tab:orange")
    ax[2].set_ylabel("env")
    ax[2].set_xlabel("s")
    ax[2].grid(True, alpha=0.3)
    fig.tight_layout()
    fig.savefig(out_dir / (path.stem + ("" if window is None else f"_{window[0]}-{window[1]}") + ".png"), dpi=90)
    plt.close(fig)
    return info


def main() -> None:
    out_dir = Path(sys.argv[1])
    out_dir.mkdir(parents=True, exist_ok=True)
    args = sys.argv[2:]
    window = None
    if args and args[0] == "--window":
        a, b = args[1].split(":")
        window = (float(a), float(b))
        args = args[2:]
    for arg in args:
        try:
            print(json.dumps(analyze(Path(arg), out_dir, window)))
        except Exception as e:  # keep going through a bad file
            print(json.dumps({"file": Path(arg).name, "error": str(e)}))


if __name__ == "__main__":
    main()
