# SODA Replay Playground

An interactive, browser-only applet to **simulate** simple neural replay and
**evaluate** it with **Slope Order Dynamic Analysis (SODA)** — the fMRI replay
detection method of [Wittkuhn & Schuck (2021)](https://www.nature.com/articles/s41467-021-21970-2),
as discussed in Kern et al. (2026). It is the companion to the
[TDLM Replay Playground](../TDLM-playground/); the two share the same simulation
engine and UI, so you can compare how the methods behave on identical data.

Everything runs client-side — no server, no build step.

## How SODA works

At **each measurement time point**, SODA regresses the decoded class
probabilities onto each state's **position in a target sequence**, producing one
regression slope per time point (conventionally inverted ×−1). With slow,
overlapping, time-lagged sequential reactivations the slope dynamic is
**biphasic**: an **onset** period followed by an **offset** period. SODA was
built for sluggish, overlapping signals (fMRI), so — unlike TDLM — it tolerates
sampling rates far below the replay speed, as long as the reactivations overlap.

`src/soda.js`:
- `computeSlopes(probas, positions, {invert, normalize})` — per-time-point slope
  (`cov(position, proba_t) / var(position)`); `normalize` divides each class by
  its mean over time, as in the fMRI pipeline.
- `epochMean(slopes, onsets, pre, post)` — averages the slope time series in a
  window around each event onset (± SE).
- `runSoda(...)` — full analysis with a **sequence-shuffle permutation** null.

## Panels

- **Decoded probabilities** (left): one broad, overlapping trace per state.
- **SODA slope dynamic** (right): the mean inverted slope around event onset, with
  a ±SE band (blue) and a sequence-shuffle permutation null band (grey). Dotted
  lines mark the sequence onset (t=0) and offset (t = sequence span).

## Presets

A **Presets (Fig. 6)** dropdown reproduces the SODA examples from Kern et al.
Figure 6 (right): A) largely overlapping replay (pronounced onset+offset),
B) only first & last item replayed (≈ full replay), C) single first item (onset
only), D) single last item (offset only), E) mixed-up order (onset/offset still
visible), F) little overlap (endpoint superposition dominates). The hypothesised
sequence is decoupled from the actual **reactivation order**, and per-state
**magnitude** controls which items reactivate. Editing any control reverts the
dropdown to "custom".

## Run locally

```bash
python3 -m http.server 8000   # or: npm run serve
# open http://localhost:8000
```

`ml-matrix` and `plotly` are vendored in `vendor/`.

## Tests

```bash
cp vendor/ml-matrix.umd.js tools/ml-matrix.cjs   # CJS copy for Node require()
node tools/soda_test.mjs    # slope sign, biphasic onset/offset, permutation null
node tools/dom_test.mjs     # controls + presets (DOM shim)
node tools/app_test.mjs     # full app pipeline (DOM + Plotly stub)
```

## Layout

```
index.html          page + vendored library <script> tags
styles.css
src/
  app.js            wiring: controls -> sim -> SODA -> plots
  controls.js       parameter sidebar (global + per-state, sliders, presets)
  sim.js            generateProbas(): synthesise probability time series
  soda.js           computeSlopes + epochMean + runSoda (+ permutation null)
  linalg.js         small helpers (zeros, etc.) shared with the simulation
  rng.js            seedable PRNG + gaussian/shuffle
  plots.js          Plotly rendering of the two panels
vendor/             ml-matrix.umd.js, plotly.min.js
tools/              Node test suites
```
