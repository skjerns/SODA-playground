// Plotly rendering for the SODA playground:
//   left  — decoded probability time series, one trace per state
//   right — mean SODA slope dynamic around event onset, with a sequence-shuffle
//           permutation null band; the characteristic onset/offset biphasic shape
//
// Plotly is loaded as a global by vendor/plotly.min.js.

const Plotly = globalThis.Plotly;

const PALETTE = [
  '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd',
  '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf',
  '#393b79', '#637939', '#8c6d31', '#843c39', '#7b4173',
];
export const stateColor = (s) => PALETTE[s % PALETTE.length];

const FONT = { family: 'system-ui, sans-serif', size: 13 };

/** Draw the raw probability time series. `onsets` (sample indices) drawn as markers. */
export function drawProbas(divId, probas, times, sfreq, onsets = []) {
  const nStates = probas[0].length;
  const traces = [];
  for (let s = 0; s < nStates; s++) {
    traces.push({
      x: times,
      y: probas.map((row) => row[s]),
      type: 'scatter',
      mode: 'lines',
      name: `state ${s}`,
      line: { color: stateColor(s), width: 1.3 },
      hovertemplate: `state ${s}<br>%{x:.0f} ms<br>%{y:.3f}<extra></extra>`,
    });
  }
  const shapes = onsets.map((idx) => ({
    type: 'line',
    x0: (idx / sfreq) * 1000, x1: (idx / sfreq) * 1000,
    y0: 0, y1: 1, yref: 'paper',
    line: { color: 'rgba(0,0,0,0.35)', width: 1, dash: 'dot' },
  }));

  const layout = {
    title: { text: 'Decoded probabilities', font: { ...FONT, size: 15 } },
    xaxis: { title: 'time (ms)', zeroline: false },
    yaxis: { title: 'probability', zeroline: false },
    shapes,
    margin: { l: 55, r: 15, t: 40, b: 45 },
    font: FONT,
    legend: { orientation: 'h', y: -0.18 },
    showlegend: true,
  };
  Plotly.react(divId, traces, layout, { responsive: true, displaylogo: false });
}

function quantileSorted(arr, p) {
  if (!arr.length) return 0;
  const idx = (arr.length - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return arr[lo] + (arr[hi] - arr[lo]) * (idx - lo);
}

/**
 * Draw the mean SODA slope dynamic with a permutation null band.
 * @param soda {times, mean, se, permMeans, eventSpanSamp} from runSoda
 * @param opts {sfreq, invert, showPerm}
 */
export function drawSlopes(divId, soda, opts = {}) {
  const { times, mean, se, permMeans, eventSpanSamp } = soda;
  const { sfreq = 100, invert = true, showPerm = true } = opts;
  const nPerm = permMeans.length;

  const traces = [];

  // pointwise 2.5–97.5% permutation null band
  if (showPerm && nPerm > 2) {
    const lo = new Array(times.length), hi = new Array(times.length);
    for (let k = 0; k < times.length; k++) {
      const col = [];
      for (let p = 1; p < nPerm; p++) col.push(permMeans[p][k]);
      col.sort((a, b) => a - b);
      lo[k] = quantileSorted(col, 0.025);
      hi[k] = quantileSorted(col, 0.975);
    }
    traces.push({ x: times, y: hi, mode: 'lines', line: { width: 0 }, showlegend: false, hoverinfo: 'skip' });
    traces.push({
      x: times, y: lo, mode: 'lines', line: { width: 0 }, fill: 'tonexty',
      fillcolor: 'rgba(120,120,120,0.18)', name: '95% null', hoverinfo: 'skip',
    });
  }

  // SE band around the true mean
  const meHi = mean.map((m, k) => m + se[k]);
  const meLo = mean.map((m, k) => m - se[k]);
  traces.push({ x: times, y: meHi, mode: 'lines', line: { width: 0 }, showlegend: false, hoverinfo: 'skip' });
  traces.push({
    x: times, y: meLo, mode: 'lines', line: { width: 0 }, fill: 'tonexty',
    fillcolor: 'rgba(31,119,180,0.25)', showlegend: false, hoverinfo: 'skip',
  });
  traces.push({
    x: times, y: mean, mode: 'lines', line: { color: '#1f77b4', width: 2.5 },
    name: 'SODA slope', hovertemplate: '%{x:.0f} ms<br>slope %{y:.4f}<extra></extra>',
  });

  // legend proxy for the null band
  if (showPerm && nPerm > 2) {
    traces.push({ x: [null], y: [null], mode: 'lines', line: { color: '#888', width: 6 }, name: '95% null', opacity: 0.4 });
  }

  const eventSpanMs = (eventSpanSamp / sfreq) * 1000;
  const shapes = [
    { type: 'line', x0: 0, x1: 0, y0: 0, y1: 1, yref: 'paper', line: { color: 'rgba(0,0,0,0.45)', width: 1, dash: 'dot' } },
    { type: 'line', x0: eventSpanMs, x1: eventSpanMs, y0: 0, y1: 1, yref: 'paper', line: { color: 'rgba(0,0,0,0.25)', width: 1, dash: 'dot' } },
  ];
  const annotations = [
    { x: 0, y: 1, yref: 'paper', yanchor: 'bottom', xanchor: 'left', text: ' onset', showarrow: false, font: { size: 11, color: '#555' } },
    { x: eventSpanMs, y: 1, yref: 'paper', yanchor: 'bottom', xanchor: 'left', text: ' offset', showarrow: false, font: { size: 11, color: '#555' } },
  ];

  const layout = {
    title: { text: 'SODA slope dynamic', font: { ...FONT, size: 15 } },
    xaxis: { title: 'time from onset (ms)', zeroline: false, gridcolor: 'rgba(0,0,0,0.08)' },
    yaxis: { title: invert ? 'slope (inverted)' : 'slope', zeroline: true, zerolinecolor: 'rgba(0,0,0,0.3)' },
    shapes, annotations,
    margin: { l: 60, r: 15, t: 40, b: 45 },
    font: FONT,
    legend: { orientation: 'h', y: -0.18 },
  };
  Plotly.react(divId, traces, layout, { responsive: true, displaylogo: false });
}
