// Frequency-domain tools for the vibration and the sound: an FFT, Welch power spectra,
// spectrograms, log-spaced band "fingerprints" and the measures read from them. Pure: no DOM.

/** In-place radix-2 FFT of (re, im); length a power of two. */
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci;
        const xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

const hannCache = new Map();
function hann(n) {
  if (!hannCache.has(n)) hannCache.set(n, Float64Array.from({ length: n }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n)));
  return hannCache.get(n);
}

/** One windowed segment's one-sided power spectral density (units²/Hz), mean removed. */
function segmentPsd(x, start, nfft, rate, scale, out) {
  const w = hann(nfft);
  const re = new Float64Array(nfft), im = new Float64Array(nfft);
  let mean = 0;
  for (let i = 0; i < nfft; i++) mean += x[start + i];
  mean /= nfft;
  let wss = 0;
  for (let i = 0; i < nfft; i++) {
    re[i] = (x[start + i] - mean) * scale * w[i];
    wss += w[i] * w[i];
  }
  fft(re, im);
  const bins = nfft / 2 + 1;
  for (let k = 0; k < bins; k++) {
    let p = (re[k] * re[k] + im[k] * im[k]) / (rate * wss);
    if (k > 0 && k < nfft / 2) p *= 2;
    out[k] += p;
  }
}

/**
 * Welch's averaged power spectral density of x[start, end) sampled at `rate`: Hann windows of
 * `nfft` (a power of two), half overlapping. A stretch shorter than nfft is one zero-padded
 * window. Returns {freqs, psd, segments} or null for fewer than 16 samples.
 */
export function welch(x, rate, { nfft = 256, start = 0, end = x.length, scale = 1 } = {}) {
  start = Math.max(0, Math.floor(start));
  end = Math.min(x.length, Math.floor(end));
  const n = end - start;
  if (n < 16) return null;
  const bins = nfft / 2 + 1;
  const psd = new Float64Array(bins);
  let segments = 0;
  if (n < nfft) {
    const padded = new Float64Array(nfft);
    for (let i = 0; i < n; i++) padded[i] = x[start + i];
    // The mean must come off the real samples only; segmentPsd's would include the padding
    let mean = 0;
    for (let i = 0; i < n; i++) mean += padded[i];
    mean /= n;
    for (let i = 0; i < n; i++) padded[i] -= mean;
    segmentPsd(padded, 0, nfft, rate, scale * Math.sqrt(nfft / n), psd);
    segments = 1;
  } else {
    const hop = nfft / 2;
    for (let s = start; s + nfft <= end; s += hop) {
      segmentPsd(x, s, nfft, rate, scale, psd);
      segments++;
    }
  }
  for (let k = 0; k < bins; k++) psd[k] /= segments;
  return { freqs: Float64Array.from({ length: bins }, (_, k) => (k * rate) / nfft), psd, segments };
}

/** Several spectra averaged, each weighted by its segment count. Same frequencies required. */
export function averageSpectra(list) {
  const valid = list.filter(Boolean);
  if (!valid.length) return null;
  const psd = new Float64Array(valid[0].psd.length);
  let segments = 0;
  for (const s of valid) {
    for (let k = 0; k < psd.length; k++) psd[k] += s.psd[k] * s.segments;
    segments += s.segments;
  }
  for (let k = 0; k < psd.length; k++) psd[k] /= segments;
  return { freqs: valid[0].freqs, psd, segments };
}

/**
 * A spectrogram: dB power of Hann-windowed frames of `nfft` every `hop` samples over x[start,
 * end). Returns {db: Float32Array(frames * bins), frames, bins, t0Index, hop, nfft} where frame i
 * is centred on sample t0Index + i*hop + nfft/2.
 */
export function spectrogram(x, { nfft = 256, hop = 64, start = 0, end = x.length, scale = 1 } = {}) {
  start = Math.max(0, Math.floor(start));
  end = Math.min(x.length, Math.floor(end));
  const bins = nfft / 2 + 1;
  const frames = Math.max(0, Math.floor((end - start - nfft) / hop) + 1);
  const db = new Float32Array(frames * bins);
  const w = hann(nfft);
  const re = new Float64Array(nfft), im = new Float64Array(nfft);
  let wsum = 0;
  for (let i = 0; i < nfft; i++) wsum += w[i];
  for (let f = 0; f < frames; f++) {
    const s = start + f * hop;
    let mean = 0;
    for (let i = 0; i < nfft; i++) mean += x[s + i];
    mean /= nfft;
    for (let i = 0; i < nfft; i++) {
      re[i] = (x[s + i] - mean) * scale * w[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 0; k < bins; k++) {
      // Amplitude of a sine at this bin, in dB re 1
      const amp = (2 * Math.hypot(re[k], im[k])) / wsum;
      db[f * bins + k] = 20 * Math.log10(amp + 1e-9);
    }
  }
  return { db, frames, bins, t0Index: start, hop, nfft };
}

/** `n` log-spaced band edges from lo to hi (Hz). */
export function logEdges(lo, hi, n) {
  return Array.from({ length: n + 1 }, (_, i) => lo * (hi / lo) ** (i / n));
}

/** Mean power in each band between consecutive edges, in dB (10·log10). Empty bands: null. */
export function bandsDb(spec, edges) {
  const out = [];
  for (let b = 0; b + 1 < edges.length; b++) {
    let sum = 0, n = 0;
    for (let k = 0; k < spec.freqs.length; k++) {
      if (spec.freqs[k] >= edges[b] && spec.freqs[k] < edges[b + 1]) { sum += spec.psd[k]; n++; }
    }
    out.push(n ? 10 * Math.log10(sum / n + 1e-20) : null);
  }
  // A band too narrow for any bin takes its neighbours' level, so the fingerprint has no holes
  for (let b = 0; b < out.length; b++) {
    if (out[b] !== null) continue;
    const left = out.slice(0, b).reverse().find((v) => v !== null);
    const right = out.slice(b + 1).find((v) => v !== null);
    out[b] = left ?? right ?? null;
  }
  return out;
}

/** Frequency of the largest power between lo and hi (Hz), refined by a parabola through its
 *  neighbours in log power. null if no bins there. */
export function peakFrequency(spec, lo, hi) {
  let best = -1;
  for (let k = 0; k < spec.freqs.length; k++) {
    const f = spec.freqs[k];
    if (f < lo || f > hi) continue;
    if (best < 0 || spec.psd[k] > spec.psd[best]) best = k;
  }
  if (best < 0) return null;
  if (best > 0 && best < spec.psd.length - 1) {
    const a = Math.log(spec.psd[best - 1] + 1e-30), b = Math.log(spec.psd[best] + 1e-30), c = Math.log(spec.psd[best + 1] + 1e-30);
    const d = a - 2 * b + c;
    const shift = d < 0 ? (0.5 * (a - c)) / d : 0;
    return spec.freqs[best] + Math.max(-0.5, Math.min(0.5, shift)) * (spec.freqs[1] - spec.freqs[0]);
  }
  return spec.freqs[best];
}

/** Power-weighted mean frequency between lo and hi (Hz). */
export function centroid(spec, lo, hi) {
  let num = 0, den = 0;
  for (let k = 0; k < spec.freqs.length; k++) {
    const f = spec.freqs[k];
    if (f < lo || f > hi) continue;
    num += f * spec.psd[k];
    den += spec.psd[k];
  }
  return den > 0 ? num / den : null;
}

/** Total power between lo and hi (units²): the integral of the PSD. */
export function bandPower(spec, lo, hi) {
  const df = spec.freqs[1] - spec.freqs[0];
  let sum = 0;
  for (let k = 0; k < spec.freqs.length; k++) if (spec.freqs[k] >= lo && spec.freqs[k] <= hi) sum += spec.psd[k] * df;
  return sum;
}

/** How alike two dB fingerprints' shapes are, 0..1: the cosine similarity of their linear
 *  powers, each normalised to unit total (so overall loudness, i.e. pressure, doesn't count). */
export function similarity(dbA, dbB) {
  const lin = (db) => {
    const p = db.map((v) => (v === null ? 0 : 10 ** (v / 10)));
    const sum = p.reduce((s, v) => s + v, 0) || 1;
    return p.map((v) => v / sum);
  };
  const a = lin(dbA), b = lin(dbB);
  let ab = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { ab += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i]; }
  return aa && bb ? ab / Math.sqrt(aa * bb) : 0;
}
