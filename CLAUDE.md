# CLAUDE.md — SODA Replay Playground

Guidance for AI agents continuing development of this project. Read this fully
before editing.

## What this is

A **static, browser-only** applet that simulates simple neural replay and
evaluates it with **SODA (Slope Order Dynamic Analysis)** — the fMRI replay
detection method of Wittkuhn & Schuck (2021), as discussed in Kern et al.
(2026). No build step, no server, no framework: plain ES modules + two vendored
libraries. It is the companion to the **TDLM Replay Playground** and shares the
same simulation engine and UI framework.

- **Live:** https://skjerns.github.io/SODA-playground/
- **Repo:** https://github.com/skjerns/SODA-playground (owner `skjerns`)
- **Sibling:** ../TDLM-playground (https://skjerns.github.io/TDLM-playground/) —
  same author, same `sim.js`/`rng.js`/`controls.js` lineage. Cross-linked via
  relative `../` in each `index.html` header (works between project sites on
  `skjerns.github.io`).

The user (`skjerns` = Simon Kern) is the author of the TDLM-Python package and
the paper the presets come from. Python env: conda env `default` (Python 3.14),
already on PATH.

## Architecture / file map

```
index.html          page shell; loads vendor libs as plain <script> (sets globals),
                    then src/app.js as <script type=module>
styles.css          all styling (light theme, responsive 2-col at >820px)
src/
  app.js            wiring: getParams -> generateProbas -> runSoda -> draw*; debounced
  controls.js       the sidebar. Declarative GROUPS schema + dynamic oscillations +
                    presets. Exposes initControls(container, onChange) -> {getParams}
  sim.js            generateProbas(params) -> {probas, times, onsets, sequence}
  soda.js           SODA math: computeSlopes, epochMean, runSoda, positionsFromSequence
  linalg.js         tiny helpers (zeros, etc.); mostly a leftover from the TDLM port,
                    sim.js only uses zeros(). ml-matrix is NOT needed by SODA math.
  rng.js            seedable PRNG (mulberry32) + gaussian/shuffle/permutation
  plots.js          Plotly rendering: drawProbas + drawSlopes
vendor/
  ml-matrix.umd.js  loaded but only linalg.js touches it; kept for parity with TDLM
  plotly.min.js     ~4.5 MB, vendored (CSP-free, offline-capable)
tools/
  soda_test.mjs     unit + behaviour tests for soda.js
  dom_test.mjs      controls.js logic via a minimal DOM shim
  app_test.mjs      full app.js pipeline with DOM + Plotly stubs
  ml-matrix.cjs     GITIGNORED. CJS copy of the vendor lib for Node require() in tests
.github/workflows/pages.yml   GitHub Actions -> Pages deploy on push to main
```

`package.json` has `"type": "module"` so `.js` are ESM (that's why the Node test
harnesses are `.mjs` and load the vendor lib from a `.cjs` copy via `createRequire`).

## The SODA algorithm (`src/soda.js`)

At **every time point**, regress the decoded class probabilities onto each
state's **position in the target sequence**; one regression slope per time point.
With slow, overlapping, time-lagged sequential reactivations the slope dynamic is
**biphasic**: an **onset** period then an **offset** period. Conventionally the
slope is inverted (×−1) to match Wittkuhn & Schuck.

- `positionsFromSequence(sequence, nStates)` → `positions[s]` = rank of state `s`
  in `sequence`.
- `computeSlopes(probas, positions, {invert=true, normalize=true})` → slope per
  time point = `cov(position, proba_t) / var(position)`. `normalize` divides each
  class by its **mean over time** (the fMRI-pipeline normalization) — this is
  SODA's normalization and is DIFFERENT from the sim's row-normalize (see gotcha).
- `epochMean(slopes, onsets, pre, post)` → averages the slope series in a window
  around each event onset; returns `{mean, se, len, pre}`. Index `k` maps to
  sample offset `k - pre` relative to onset.
- `runSoda(probas, sequence, onsets, opts)` → `{times(ms from onset), mean, se,
  permMeans, onsetIdx, eventSpanSamp}`. Window auto-sized from `eventSpanSamp` and
  `breadthSamp`. `permMeans[0]` is the true (unshuffled) curve; the rest are a
  **sequence-shuffle** null (random position labelings).

Inverted-slope convention used here: **onset period = positive peak, offset
period = negative trough** (soda_test asserts this on a clean overlapping run:
~+2.07 onset / −2.06 offset).

## Simulation model (`src/sim.js`) — shared with TDLM

`generateProbas(params)` builds a `(n_samples × n_states)` probability series:
baseline + per-state Gaussian noise, then reactivation **bumps** along a
sequence, plus optional oscillations, then optional clipping/normalize.

Key parameter semantics (all times in **samples** inside sim.js; the UI converts
from ms):
- **breadth** = the bump's **full temporal extent in samples**. The Gaussian is
  hard-truncated at ±2σ (so σ = breadth/4, half-extent = breadth/2, zero outside).
  At breadth = 1 sample the bump is a single time point. Don't reintroduce the
  old "breadth = σ, spread ±4σ" behaviour.
- **reactivationOrder** = the ACTUAL insertion order of bumps, decoupled from
  `sequence` (which defines the hypothesised order SODA/TDLM tests). `null`/blank
  ⇒ use `sequence`. This is how backward/scrambled presets work against a fixed
  forward hypothesis.
- **per-state magnitude** = 0 for a state ⇒ that item never reactivates (used by
  the "only first & last", "single first/last item" presets).
- **event onsets are deterministic** (evenly spaced; single event centred) so
  changing unrelated params never moves the replay.
- **clipZero** (default on), **clipOne** (default OFF for SODA — overlapping broad
  bumps sum > 1 and clipping would distort the gradient), **normalize** (row sum
  to 1) — SODA sets sim `normalize:false` and does its own class-mean normalize.

## Controls (`src/controls.js`)

Declarative `GROUPS` schema. Each item: `{key,label,type,def,min,max,step,...}`.
- `type`: `int`|`num` (numeric), `check`, `text`.
- Numeric renders as a **slider + editable readout**, unless `noslider:true`
  (counts/rates: n_states, sfreq, duration, permutations).
- `perState:true` adds a `⋯` toggle revealing an n_states mini-grid; blank cell ⇒
  use global. Read back via `perStateArr` (blank/NaN ⇒ null ⇒ global).
- `unit:'ms'` ⇒ the control steps on the **sample grid** (`step = 1000/sfreq`),
  min raised to one sample, snapped when sfreq changes (`retime:true` on sfreq).
- `rebuild:true` (n_states) ⇒ rebuilds per-state grids AND regenerates the
  `sequence` field to `0..n-1` AND rebuilds oscillation per-state grids.

`getParams()` returns `{simParams, sodaParams}`.
`sodaParams = {sfreq, nShuf, invert, normalize, showPerm}`.

**Presets** = `PRESETS` array (Kern et al. Fig. 6 *right*, "SODA examples"). Each
is `{id,label,desc,values,perState?}`; applied on top of `resetDefaults()` via
`applyPreset`. `FIG6_BASE` holds the shared broad-overlap base. Editing any
control reverts the dropdown to "custom" (`markCustom`, runs immediately while the
recompute is debounced). Current presets:
- A largely overlapping (base) · B first&last only (`magnitude:[1,0,0,0,1]`) ·
  C single first (`[1,0,0,0,0]`) · D single last (`[0,0,0,0,1]`) ·
  E mixed-up (`reactivationOrder:'0,3,2,1,4'`) · F little overlap (`breadth:60, lag:160`).
If you change preset params, re-validate behaviour (see "validating presets").

## Plots (`src/plots.js`)

`Plotly` is a global (from the vendored script). `drawProbas` = one line per
state (uses `scatter`, NOT `scattergl` — WebGL hangs in headless/software GL).
`drawSlopes` = mean slope curve + ±SE band + pointwise 2.5–97.5% permutation null
band, with dotted onset (t=0) / offset (t=eventSpan) markers.

## Testing

There is **no Node in the environment by default**. Download a standalone build
(it lives in `/tmp` and is wiped between sessions/days — re-fetch when missing):

```bash
cd /tmp && curl -sL https://nodejs.org/dist/v20.18.1/node-v20.18.1-linux-x64.tar.xz -o node.tar.xz && tar xf node.tar.xz
NODE=/tmp/node-v20.18.1-linux-x64/bin/node
cd <project> && cp vendor/ml-matrix.umd.js tools/ml-matrix.cjs   # gitignored CJS copy
$NODE tools/soda_test.mjs && $NODE tools/dom_test.mjs && $NODE tools/app_test.mjs
$NODE --check src/*.js    # syntax
```

Test-harness gotcha: the DOM shims must default `<input>.value` to `''` (real
browsers do) — otherwise blank per-state cells read as `NaN` instead of null. The
shims already do this in `createElement`.

Validating presets (after editing PRESETS): drive `initControls` with the DOM
shim, `select.value=id; select.dispatch('change')`, `getParams()`, run
`generateProbas`+`runSoda`, and check onset-period max / offset-period min. See
the throwaway scripts pattern used during development (build a shim `F` class, set
`globalThis.document`, import modules).

No headless-browser screenshots: Firefox `--screenshot` hangs on this machine
(fails even on a trivial page). Rely on the Node suites; for a real visual check
serve with `python3 -m http.server` and open in a browser.

## Deployment

- `gh` is authenticated as **skjerns**; **git protocol is SSH**. SSH pushes may
  include `.github/workflows/*` even though the token lacks the `workflow` scope
  (that restriction only applies to HTTPS-token pushes). If `gh` API calls 401,
  the token/keyring lapsed — ask the user to re-auth (`!gh auth login`); don't try
  to fix it yourself.
- Pages uses the **Actions workflow** source: enabled once via
  `gh api -X POST repos/skjerns/SODA-playground/pages -f build_type=workflow`.
- To ship a change: commit, `git push origin main`, the workflow redeploys
  (~20–60s). Verify with `gh run list -R skjerns/SODA-playground --workflow=pages.yml`
  and `curl -s -o /dev/null -w '%{http_code}' https://skjerns.github.io/SODA-playground/`.
- Commit trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## Known caveats / design notes

- **Permutation null is inherently broad.** Because a single replay event is
  deterministic, shuffling position labels yields curves of similar peak
  magnitude, so the true curve exceeds the null only modestly (pointwise it still
  does at onset/offset times). The biphasic shape + ±SE band is the primary
  signal; don't "fix" this — it's faithful to single-condition SODA.
- **SODA `normalize` ≠ sim `normalize`.** `simParams.normalize` is forced `false`;
  SODA's class-mean normalization happens in `computeSlopes`.
- **linalg.js / ml-matrix** are vestigial for SODA (carried over from the TDLM
  copy). Safe to keep; only remove if you also drop the vendor script and any
  `zeros()` usage.
- Keep code style consistent with the sibling TDLM project; the two are meant to
  stay structurally parallel so fixes port between them.

## Good first tasks / extension ideas

- Add a numeric onset/offset-period statistic (mean slope per period) + its
  permutation p-value, shown in the status line.
- Optional per-event overlay (spaghetti) in the slope panel.
- A "compare with TDLM" toggle or shared-seed deep link between the two apps.
- Frequency analysis of the slope dynamic to estimate replay speed (paper Fig 1F).
