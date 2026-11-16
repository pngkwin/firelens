// Synthesizes the 30 s soundtrack: 120 BPM, D minor, one beat grid from t = 0.
// Usage: node music.cjs <out.wav>
// Cuts land on these times (seconds); soft transition swells resolve into them.
const fs = require("fs");
const SR = 48000, DUR = 30, N = SR * DUR, BPM = 120, BEAT = 60 / BPM, BAR = 4 * BEAT;
const CUTS = [3, 6, 11, 16, 20, 24, 27];
const L = new Float32Array(N), R = new Float32Array(N);

const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
// i - VI - III - VII in D minor, one chord per bar (2 s): Dm Bb F C
const CHORDS = [[50, 53, 57], [46, 50, 53], [53, 57, 60], [48, 52, 55]];
const chordAt = (t) => CHORDS[Math.floor(t / BAR) % 4];

let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
const add = (i, l, r) => { if (i >= 0 && i < N) { L[i] += l; R[i] += r; } };
// Section envelope: sparse hook, build, full groove, resolve.
const energy = (t) => (t < 3 ? 0.35 : t < 6 ? 0.6 : t < 27 ? 1 : Math.max(0, 1 - (t - 27) / 3));

// Pad: detuned saws through a one-pole low-pass, chord per bar, slow attack.
{
  const lp = [0, 0];
  for (let i = 0; i < N; i++) {
    const t = i / SR, ch = chordAt(t), bt = t % BAR;
    const env = Math.min(1, bt / 0.35) * (t > 28.5 ? Math.max(0, (30 - t) / 1.5) : 1);
    let s = 0;
    for (const m of ch) for (const d of [-0.07, 0.07]) { const ph = (t * hz(m + 12) * (1 + d / 100)) % 1; s += 2 * ph - 1; }
    s *= 0.035 * env;
    const cut = 0.04 + 0.05 * energy(t);
    lp[0] += cut * (s - lp[0]); lp[1] += cut * (lp[0] - lp[1]);
    add(i, lp[1] * 0.9, lp[1] * 1.1);
  }
}
// Bass: root on every beat from 3 s, sine + soft harmonic, short decay.
for (let b = 0; b * BEAT < DUR; b++) {
  const t0 = b * BEAT; if (t0 < 3 || t0 >= 29.5) continue;
  const f = hz(chordAt(t0)[0] - 12), len = BEAT * 0.9;
  for (let k = 0; k < len * SR; k++) {
    const t = k / SR, env = Math.min(1, t / 0.01) * Math.exp(-t * 3.2);
    const s = (Math.sin(2 * Math.PI * f * t) + 0.25 * Math.sin(4 * Math.PI * f * t)) * 0.16 * env * energy(t0);
    add(Math.round(t0 * SR) + k, s, s);
  }
}
// Kick on beats 1 and 3 from 6 s, every beat 11 to 27 s.
for (let b = 0; b * BEAT < DUR; b++) {
  const t0 = b * BEAT; if (t0 < 6 || t0 >= 27) continue;
  if (t0 < 11 && b % 2) continue;
  for (let k = 0; k < 0.28 * SR; k++) {
    const t = k / SR, f = 48 + 90 * Math.exp(-t * 30);
    const s = Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 9) * 0.32;
    add(Math.round(t0 * SR) + k, s, s);
  }
}
// Hats: soft high-passed noise on off-beat eighths from 11 s.
{
  let prev = 0;
  for (let e = 0; e * BEAT / 2 < DUR; e++) {
    const t0 = e * BEAT / 2; if (t0 < 11 || t0 >= 27 || e % 2 === 0) continue;
    for (let k = 0; k < 0.05 * SR; k++) {
      const n = rnd(), hp = n - prev; prev = n;
      const s = hp * Math.exp(-(k / SR) * 70) * 0.03;
      add(Math.round(t0 * SR) + k, s * 0.8, s * 1.2);
    }
  }
}
// Arp: sixteenth plucks over the chord, two octaves up, from 6 s, panned.
for (let s16 = 0; s16 * BEAT / 4 < DUR; s16++) {
  const t0 = s16 * BEAT / 4; if (t0 < 6 || t0 >= 27.5) continue;
  if (t0 < 11 && s16 % 2) continue; // eighths before the groove
  const ch = chordAt(t0), m = ch[s16 % 3] + 24 + (s16 % 6 >= 3 ? 12 : 0), f = hz(m);
  const pan = 0.5 + 0.3 * Math.sin(s16 * 0.7);
  for (let k = 0; k < 0.22 * SR; k++) {
    const t = k / SR, env = Math.min(1, t / 0.003) * Math.exp(-t * 16);
    const v = (Math.sin(2 * Math.PI * f * t) + 0.2 * Math.sin(6 * Math.PI * f * t)) * 0.045 * env;
    add(Math.round(t0 * SR) + k, v * (1 - pan), v * pan);
  }
}
// Transition swells: filtered noise rising into each cut, plus a low D thump on it.
for (const c of CUTS) {
  let lp = 0;
  for (let k = 0; k < 0.6 * SR; k++) {
    const t = k / 0.6 / SR, a = 0.001 + 0.012 * t;
    lp += a * (rnd() - lp);
    const s = lp * t * t * 0.35;
    add(Math.round((c - 0.6) * SR) + k, s, s);
  }
  for (let k = 0; k < 0.5 * SR; k++) {
    const t = k / SR, s = Math.sin(2 * Math.PI * hz(38) * t) * Math.exp(-t * 6) * 0.12;
    add(Math.round(c * SR) + k, s, s);
  }
}
// Final ring: D minor add9 bell on the end card at 27 s.
for (const m of [74, 77, 81, 76]) {
  const f = hz(m);
  for (let k = 0; k < 3 * SR; k++) {
    const t = k / SR, env = Math.min(1, t / 0.005) * Math.exp(-t * 1.4);
    const v = Math.sin(2 * Math.PI * f * t) * 0.03 * env;
    add(Math.round(27 * SR) + k, v, v);
  }
}

// Soft-clip, normalize to -1 dBFS, 10 ms fade at both ends, write 16-bit WAV.
let peak = 0;
for (let i = 0; i < N; i++) { L[i] = Math.tanh(L[i] * 1.2); R[i] = Math.tanh(R[i] * 1.2); peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i])); }
const g = 0.89 / peak, buf = Buffer.alloc(44 + N * 4), F = 0.01 * SR;
buf.write("RIFF", 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write("WAVEfmt ", 8); buf.writeUInt32LE(16, 16);
buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28);
buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36); buf.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) {
  const f = Math.min(1, i / F, (N - 1 - i) / F);
  buf.writeInt16LE(Math.round(L[i] * g * f * 32767), 44 + i * 4);
  buf.writeInt16LE(Math.round(R[i] * g * f * 32767), 46 + i * 4);
}
fs.writeFileSync(process.argv[2], buf);
console.log("wrote", process.argv[2], "peak gain", g.toFixed(2));
