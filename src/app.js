// Wires controls -> simulate probas -> run SODA -> redraw both plots.

import { initControls } from './controls.js';
import { generateProbas } from './sim.js';
import { runSoda } from './soda.js';
import { RNG } from './rng.js';
import { drawProbas, drawSlopes } from './plots.js';

const sidebar = document.getElementById('controls');
const status = document.getElementById('status');

let pending = false;

function recompute() {
  const t0 = performance.now();
  const { simParams, sodaParams } = controls.getParams();

  // 1) simulate probability time series
  const { probas, times, onsets, sequence } = generateProbas(simParams);

  // 2) run SODA: per-time-point slope of probabilities onto sequence position,
  //    epoched around onsets, with a sequence-shuffle permutation null
  const eventSpanSamp = (sequence.length - 1) * simParams.lag;
  const soda = runSoda(probas, sequence, onsets, {
    nStates: simParams.nStates,
    sfreq: simParams.sfreq,
    eventSpanSamp,
    breadthSamp: simParams.breadth.global,
    invert: sodaParams.invert,
    normalize: sodaParams.normalize,
    nShuf: sodaParams.nShuf,
    rng: new RNG(simParams.seed + 1),
  });

  // 3) draw
  drawProbas('plot-probas', probas, times, simParams.sfreq, onsets);
  drawSlopes('plot-seq', soda, {
    sfreq: simParams.sfreq,
    invert: sodaParams.invert,
    showPerm: sodaParams.showPerm,
  });

  const ms = (performance.now() - t0).toFixed(0);
  status.textContent =
    `${simParams.nSamples} samples · ${simParams.nStates} states · ` +
    `${soda.permMeans.length} perms · ${onsets.length} events · ${ms} ms`;
}

// run on the next frame so the spinner/status can paint first
function scheduleRecompute() {
  if (pending) return;
  pending = true;
  status.textContent = 'computing…';
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      try {
        recompute();
      } catch (err) {
        console.error(err);
        status.textContent = 'error: ' + err.message;
      } finally {
        pending = false;
      }
    });
  });
}

const controls = initControls(sidebar, scheduleRecompute);
scheduleRecompute();
