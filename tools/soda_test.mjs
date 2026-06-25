// Unit + behaviour tests for the SODA computation.
//   1. slope sign on a hand-built example (no library/RNG dependence)
//   2. a full overlapping forward replay yields a biphasic onset->offset curve
//   3. shuffling the sequence destroys the structure (null ~ 0)

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
globalThis.mlMatrix = require(join(here, 'ml-matrix.cjs'));

const { computeSlopes, positionsFromSequence, runSoda } = await import(join(root, 'src/soda.js'));
const { generateProbas } = await import(join(root, 'src/sim.js'));
const { RNG } = await import(join(root, 'src/rng.js'));

let fail = 0;
const expect = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) fail++; };

// --- 1. hand-built slope sign ---------------------------------------------
// positions [0,1,2,3,4]; probabilities increasing with position -> positive raw
// slope -> inverted slope negative.
const positions = positionsFromSequence([0, 1, 2, 3, 4], 5);
const rising = [[0.1, 0.2, 0.3, 0.4, 0.5]]; // proba increases with position
const sUninv = computeSlopes(rising, positions, { invert: false, normalize: false });
const sInv = computeSlopes(rising, positions, { invert: true, normalize: false });
expect(sUninv[0] > 0, `rising-with-position -> positive raw slope (${sUninv[0].toFixed(3)})`);
expect(Math.abs(sInv[0] + sUninv[0]) < 1e-12, 'invert flips the sign exactly');

// --- 2. overlapping forward replay -> biphasic onset/offset ----------------
const msToSamp = (ms, sf) => Math.max(1, Math.round((ms / 1000) * sf));
const sfreq = 100;
const sim = {
  nStates: 5, nSamples: 1500, sfreq, baseline: 0,
  noise: { global: 0.02, perState: null },
  magnitude: { global: 1, perState: null }, magnitudeModifier: 1,
  breadth: { global: msToSamp(240, sfreq), perState: null },
  lag: msToSamp(120, sfreq), sequence: [0, 1, 2, 3, 4], reactivationOrder: null,
  nEvents: 10, jitter: 0, oscillations: [], clipZero: true, clipOne: false, seed: 1,
};
const { probas, onsets, sequence } = generateProbas(sim);
const eventSpanSamp = (sequence.length - 1) * sim.lag;
const soda = runSoda(probas, sequence, onsets, {
  nStates: 5, sfreq, eventSpanSamp, breadthSamp: sim.breadth.global,
  invert: true, normalize: true, nShuf: 80, rng: new RNG(2),
});

// onset index is soda.onsetIdx (time 0). Inverted convention: onset period
// positive, offset period negative. Find min before/after the offset marker.
const onsetK = soda.onsetIdx;
const offsetK = onsetK + eventSpanSamp;
const early = soda.mean.slice(onsetK, offsetK);          // onset period
const late = soda.mean.slice(offsetK, soda.mean.length); // offset period
const maxEarly = Math.max(...early);
const minLate = Math.min(...late);
console.log(`  onset-period max = ${maxEarly.toFixed(4)}, offset-period min = ${minLate.toFixed(4)}`);
expect(maxEarly > 0, 'onset period has a positive (inverted) slope peak');
expect(minLate < 0, 'offset period has a negative (inverted) slope trough');
expect(maxEarly > Math.abs(minLate) * 0.2 && minLate < -maxEarly * 0.2, 'curve is clearly biphasic');

// --- 3. permutation null is centred near zero ------------------------------
const permPeak = soda.permMeans.slice(1).map((c) => Math.max(...c.map(Math.abs)));
const meanPermPeak = permPeak.reduce((a, b) => a + b, 0) / permPeak.length;
const truePeak = Math.max(...soda.mean.map(Math.abs));
expect(truePeak > meanPermPeak, `true peak ${truePeak.toFixed(3)} > mean shuffled peak ${meanPermPeak.toFixed(3)}`);

console.log('\n' + (fail ? `${fail} CHECK(S) FAILED` : 'SODA TEST PASSED'));
process.exit(fail ? 1 : 0);
