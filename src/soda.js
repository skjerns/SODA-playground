// Slope Order Dynamic Analysis (SODA), after Wittkuhn & Schuck (2021) and the
// description in Kern et al. (2026). SODA regresses, at each measurement time
// point, the decoded class probabilities onto the state's position in a target
// sequence — yielding one regression slope per time point. With overlapping,
// time-lagged sequential reactivations the slope dynamic is biphasic: an
// "onset" period followed by an "offset" period. Slopes are conventionally
// inverted (x -1) to match Wittkuhn & Schuck.
//
// This is intentionally simple linear regression (no matrix library needed):
// slope_t = cov(position, proba_t) / var(position).

import { RNG } from './rng.js';

/** positions[s] = rank of state s within the target `sequence`. */
export function positionsFromSequence(sequence, nStates) {
  const pos = new Array(nStates).fill(0);
  for (let rank = 0; rank < sequence.length; rank++) pos[sequence[rank]] = rank;
  return pos;
}

/**
 * Per-time-point regression slope of probabilities onto positions.
 * @param {number[][]} probas (nT x nStates)
 * @param {number[]} positions length nStates
 * @param {{invert?:boolean, normalize?:boolean}} opts
 *   normalize: divide each class by its mean over time (as in the fMRI pipeline)
 *   invert: multiply slopes by -1 (Wittkuhn & Schuck convention)
 * @returns {number[]} slope per time point
 */
export function computeSlopes(probas, positions, opts = {}) {
  const { invert = true, normalize = true } = opts;
  const nT = probas.length;
  const nS = probas[0].length;

  let P = probas;
  if (normalize) {
    const mean = new Array(nS).fill(0);
    for (let t = 0; t < nT; t++) for (let s = 0; s < nS; s++) mean[s] += probas[t][s];
    for (let s = 0; s < nS; s++) mean[s] /= nT;
    P = probas.map((row) => row.map((v, s) => (mean[s] > 1e-12 ? v / mean[s] : v)));
  }

  const x = positions;
  const xbar = x.reduce((a, b) => a + b, 0) / nS;
  let sxx = 0;
  for (const xi of x) sxx += (xi - xbar) ** 2;

  const sign = invert ? -1 : 1;
  const slopes = new Array(nT);
  for (let t = 0; t < nT; t++) {
    let ybar = 0;
    for (let s = 0; s < nS; s++) ybar += P[t][s];
    ybar /= nS;
    let sxy = 0;
    for (let s = 0; s < nS; s++) sxy += (x[s] - xbar) * (P[t][s] - ybar);
    slopes[t] = sxx > 0 ? (sign * sxy) / sxx : 0;
  }
  return slopes;
}

/**
 * Average the slope time series in a window around each event onset.
 * @returns {{mean:number[], se:number[], len:number, pre:number}}
 *   index k corresponds to sample offset (k - pre) relative to onset.
 */
export function epochMean(slopes, onsets, pre, post) {
  const len = pre + post + 1;
  const sum = new Array(len).fill(0);
  const sumsq = new Array(len).fill(0);
  const cnt = new Array(len).fill(0);
  for (const o of onsets) {
    for (let k = 0; k < len; k++) {
      const idx = o - pre + k;
      if (idx >= 0 && idx < slopes.length) {
        sum[k] += slopes[idx];
        sumsq[k] += slopes[idx] * slopes[idx];
        cnt[k]++;
      }
    }
  }
  const mean = new Array(len);
  const se = new Array(len);
  for (let k = 0; k < len; k++) {
    mean[k] = cnt[k] ? sum[k] / cnt[k] : 0;
    const varK = cnt[k] ? sumsq[k] / cnt[k] - mean[k] * mean[k] : 0;
    se[k] = cnt[k] > 1 ? Math.sqrt(Math.max(0, varK) / cnt[k]) : 0;
  }
  return { mean, se, len, pre };
}

/**
 * Full SODA analysis with a sequence-shuffle permutation null.
 * @returns {{times:number[], mean:number[], se:number[], permMeans:number[][],
 *            onsetIdx:number, eventSpanSamp:number}}
 *   times in ms relative to onset; permMeans[0] is the true (unshuffled) curve.
 */
export function runSoda(probas, sequence, onsets, opts) {
  const {
    nStates, sfreq, eventSpanSamp, breadthSamp,
    invert = true, normalize = true, nShuf = 100, rng = new RNG(0),
  } = opts;

  // window: a little before onset through the full span + decay
  const half = Math.max(1, Math.round(breadthSamp / 2));
  const pre = Math.max(half, Math.round(eventSpanSamp / 2) + half);
  const post = Math.max(2 * half, eventSpanSamp + 2 * half);

  const truePos = positionsFromSequence(sequence, nStates);
  const trueSlopes = computeSlopes(probas, truePos, { invert, normalize });
  const trueEpoch = epochMean(trueSlopes, onsets, pre, post);

  // permutation null: shuffle the position labels
  const permMeans = [trueEpoch.mean];
  const seen = new Set([truePos.join(',')]);
  let guard = 0;
  while (permMeans.length < nShuf && guard < nShuf * 50) {
    guard++;
    const perm = rng.permutation(nStates);
    const key = perm.join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    const slopes = computeSlopes(probas, perm, { invert, normalize });
    permMeans.push(epochMean(slopes, onsets, pre, post).mean);
  }

  const times = new Array(trueEpoch.len);
  for (let k = 0; k < trueEpoch.len; k++) times[k] = ((k - pre) / sfreq) * 1000;

  return { times, mean: trueEpoch.mean, se: trueEpoch.se, permMeans, onsetIdx: pre, eventSpanSamp };
}
