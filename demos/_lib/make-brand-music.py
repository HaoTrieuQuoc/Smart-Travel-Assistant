"""
Synthesises royalty-free background music for the STA intro/outro (no downloads, no samples).
Soft pad + bell arpeggio + light reverb, stereo 48 kHz WAV.

    python demos/_lib/make-brand-music.py [outdir]     # writes intro.wav (5.4 s) and outro.wav (7.0 s)
"""
import os
import sys
import wave

import numpy as np

SR = 48000
RNG = np.random.default_rng(7)


def t_axis(dur):
    return np.arange(int(dur * SR)) / SR


def place(buf, sig, t0, pan=0.0):
    """Add a mono signal into the stereo buffer at t0 seconds with constant-power pan (-1..1)."""
    i0 = int(t0 * SR)
    n = min(len(sig), buf.shape[0] - i0)
    if n <= 0:
        return
    ang = (pan + 1) * np.pi / 4
    buf[i0:i0 + n, 0] += sig[:n] * np.cos(ang)
    buf[i0:i0 + n, 1] += sig[:n] * np.sin(ang)


def bell(freq, dur=2.2, amp=0.5):
    t = t_axis(dur)
    sig = np.zeros_like(t)
    for k, (mult, a, decay) in enumerate([(1.0, 1.0, 1.6), (2.0, 0.35, 2.6), (3.01, 0.2, 3.6), (4.17, 0.1, 5.0)]):
        sig += a * np.sin(2 * np.pi * freq * mult * t) * np.exp(-decay * t)
    attack = np.minimum(1, t / 0.006)
    return amp * sig * attack


def pad(freqs, dur, amp=0.12, attack=1.0, release=1.0):
    t = t_axis(dur)
    sig = np.zeros_like(t)
    for f in freqs:
        for det in (-0.35, 0.0, 0.35):  # slight detune = warmth
            sig += np.sin(2 * np.pi * (f + det) * t + RNG.uniform(0, 6.28))
        sig += 0.25 * np.sin(2 * np.pi * f * 2 * t)  # soft octave
    sig /= max(1, len(freqs))
    env = np.minimum(1, t / attack) * np.minimum(1, (dur - t) / release)
    return amp * sig * env


def sub_swell(dur=0.9, amp=0.35):
    t = t_axis(dur)
    f = 90 * np.exp(-1.8 * t) + 42
    phase = 2 * np.pi * np.cumsum(f) / SR
    return amp * np.sin(phase) * np.exp(-3.2 * t) * np.minimum(1, t / 0.02)


def reverb(stereo, wet=0.30, tail=1.6):
    n = int(tail * SR)
    out = np.zeros_like(stereo)
    for ch in range(2):
        ir = RNG.standard_normal(n) * np.exp(-3.0 * np.arange(n) / SR * 1.2)
        ir[:int(0.012 * SR)] *= np.linspace(0, 1, int(0.012 * SR))
        ir /= np.sqrt(np.sum(ir ** 2))
        size = stereo.shape[0] + n
        fft = 1 << (size - 1).bit_length()
        conv = np.fft.irfft(np.fft.rfft(stereo[:, ch], fft) * np.fft.rfft(ir, fft), fft)[:stereo.shape[0]]
        out[:, ch] = conv
    return (1 - wet) * stereo + wet * out


def finish(stereo, dur, fade_start, fade_len):
    t = t_axis(dur)
    env = np.clip((dur - t) / fade_len, 0, 1) if fade_start is None else np.clip(1 - (t - fade_start) / fade_len, 0, 1)
    stereo *= env[:, None] * np.minimum(1, t / 0.05)[:, None]
    peak = np.max(np.abs(stereo)) or 1
    return stereo * (0.7 / peak)  # about -3 dBFS peak; loudness is normalised again at encode time


def save(path, stereo):
    pcm = (np.clip(stereo, -1, 1) * 32767).astype(np.int16)
    with wave.open(path, 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def intro(dur=5.4):
    b = np.zeros((int(dur * SR), 2))
    place(b, pad([130.81, 196.00, 329.63, 493.88, 587.33], dur, amp=0.16, attack=1.2, release=1.2), 0)       # Cmaj9 pad
    place(b, pad([65.41], dur, amp=0.22, attack=0.6, release=1.2), 0)                                            # bass C2
    place(b, sub_swell(), 0.28)                                                                                  # logo pop hit
    for t0, f, pan in [(0.38, 523.25, -0.4), (0.62, 659.25, -0.15), (0.86, 783.99, 0.15), (1.10, 987.77, 0.35), (1.40, 1318.51, 0.0)]:
        place(b, bell(f, 2.6, 0.42), t0, pan)                                                                    # rising arpeggio
    place(b, bell(783.99, 2.0, 0.22), 2.25, -0.3)
    place(b, bell(1046.5, 2.2, 0.20), 2.95, 0.3)
    place(b, bell(1318.51, 1.6, 0.14), 3.7, 0.0)
    return finish(reverb(b), dur, 4.5, 0.9)


def outro(dur=7.0):
    b = np.zeros((int(dur * SR), 2))
    place(b, pad([174.61, 220.00, 261.63, 329.63, 392.00], 3.8, amp=0.16, attack=0.9, release=0.9), 0)           # Fmaj9-ish
    place(b, pad([130.81, 196.00, 329.63, 392.00, 523.25], dur - 3.0, amp=0.17, attack=0.9, release=1.4), 3.0)   # resolves to C
    place(b, pad([87.31], 3.6, amp=0.22, attack=0.6, release=0.8), 0)
    place(b, pad([65.41], dur - 3.1, amp=0.22, attack=0.6, release=1.4), 3.1)
    place(b, sub_swell(0.9, 0.28), 0.18)
    for t0, f, pan in [(0.30, 1046.5, 0.3), (0.58, 880.0, 0.1), (0.86, 783.99, -0.15), (1.14, 659.25, -0.35), (1.50, 523.25, 0.0)]:
        place(b, bell(f, 2.4, 0.38), t0, pan)                                                                    # descending arpeggio
    for f, pan in [(523.25, -0.3), (659.25, -0.1), (783.99, 0.1), (1046.5, 0.3)]:
        place(b, bell(f, 3.4, 0.30), 3.25, pan)                                                                  # resolution chord
    place(b, bell(1318.51, 2.0, 0.14), 4.4, 0.0)
    return finish(reverb(b, wet=0.34, tail=1.8), dur, 6.0, 1.0)


if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', 'slack-demo', 'brand')
    os.makedirs(out, exist_ok=True)
    save(os.path.join(out, 'intro.wav'), intro())
    save(os.path.join(out, 'outro.wav'), outro())
    print('wrote intro.wav and outro.wav to', os.path.abspath(out))
