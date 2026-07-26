# Multi-Feature Roadmap: SOR Plan + SOR Lab

This is the working plan for evolving the Finance Simulator from a single tool ("SOR Plan")
into one app hosting multiple features, starting with "SOR Lab". It is the source of truth
for the phases below. This file is scaffolding, not permanent documentation — delete it
after the last phase ships (permanent conventions move to `.cursor/rules/` in Phase 1).

## How to use this file

Each phase runs in a fresh chat. Kick off a phase with a prompt like:

> Read `.cursor/plans/multi-feature.md`, execute Phase N, and update the
> Status / decisions log at the bottom with what was done and any decisions made.

Tests must be green and SOR Plan behavior unchanged at every phase boundary. Decisions
made mid-phase that affect later phases MUST be appended to the log — that log is the
only context the next phase's chat will have besides the code itself.

## Context & constraints

- One SPA, one single-file build (`vite-plugin-singlefile` → `dist/index.html`); client-side
  only, no backend (see `.cursor/rules/single-file-architecture.mdc`).
- These are **features, not apps**: the user switches between them with tabs; there is no
  per-feature runtime isolation. Background jobs keep running when the user switches tabs
  (workers live as long as the page).
- All existing project rules apply: Tailwind-only styling, heavily commented financial math,
  Vitest for math/logic, Playwright e2e smoke-first, keep the repo root clean.

## Naming & namespaces

- **App**: "Finance Simulator"; app-wide code/namespace prefix is **`fs`**.
- **Features** (canonical id → display name):
  - `sor-plan` → "SOR Plan" (the current simulator)
  - `sor-lab` → "SOR Lab" (sensitivity/tornado analysis, Phase 4)
  - Future features may be unrelated to SOR (reverse mortgage, SS timing, Roth conversions).
    Nothing outside the two SOR features may assume the SOR scenario model.
- **Identifiers**: kebab-case everywhere — folders `src/features/<feature-id>/`, DOM feature
  roots `id="feature-<feature-id>"`, new element ids prefixed `<feature-id>-...`.
- **Storage**:
  - localStorage: `fs:<feature-id>:<key>` for feature state (e.g. `fs:sor-plan:autosave`);
    `fs:app:<key>` for app-wide prefs (theme, active tab, ui prefs).
  - Boundary rule: anything that references feature-specific UI belongs to the feature
    namespace even if it lives in `uiPrefs` today — accordion/open-section state, report
    band, chart view prefs are all `fs:sor-plan:*`. Only theme, active tab, and other
    genuinely cross-feature prefs are `fs:app:*`. When in doubt, feature namespace.
  - IndexedDB: single `fs-sessions` database, one `sessions` object store, records keyed
    by `[feature, name]`.
  - Export envelope: `type: "fs-scenario"` plus a `feature` field; import keeps accepting
    legacy `sor-scenario` files as the only carry-over path for old data.
- **Share links are feature-aware and self-contained**: the payload carries the feature id,
  the feature's state, and snapshot copies of any cross-feature data it depends on (e.g. a
  SOR Lab link embeds the referenced SOR Plan scenarios). On open, the app switches to that
  feature and silently imports embedded dependencies as named sessions in the owning feature,
  auto-renaming on name collisions (e.g. "My Plan (2)"); the recipient's existing sessions
  are never overwritten. The same rule applies to file export/import.
- **Clean break**: no migration of legacy `sor:*` localStorage keys or the `sor-sessions`
  IndexedDB database — old data is ignored (an optional one-time cleanup delete is fine).
  Existing users lose saved sessions unless they export before upgrading and import after;
  note this in the README/release notes (Phase 2 exit task).
- **Legacy share links** (pre-`fs` URL format) are also a clean break: the app ignores the
  old share param and just opens fresh — no decode attempt, no error message. Legacy
  `sor-scenario` *file* import is the only backward-compat path.

## Locked decisions

- Selector is a **tab bar under the title** in the header partial, with a busy/progress badge
  per tab; active tab persisted in `fs:app:*` prefs.
- Truly shared code stays in `src/core`, `src/ui`, `src/state`, `src/workers`;
  feature-specific code lives under `src/features/<feature-id>/` (logic, ui, partials).
- **Per-feature named sessions** via a session-store abstraction generalizing
  `src/state/persistence.js`; the header session controls bind to the active feature's store.
- **Background jobs**: a shared job manager generalizing the `currentWorker` /
  `terminateWorkers()` pattern currently in `src/main.js`; jobs survive tab switches;
  results deliver to the owning feature; tabs show a busy/progress badge.
- **SOR Lab / tornado analysis**:
  - Output metric is user-selectable, defaulting to success rate.
  - Each tornado bar has built-in sensible low/high perturbation presets per parameter,
    overridable by the user.
  - The Lab references saved SOR Plan sessions **live** (no imported copies) — except in
    share links/exports, which embed snapshots (see above).
  - All tornado bars use **common random numbers** (same seed / same sampled market paths,
    via `src/core/rng.js`) so Monte Carlo noise doesn't swamp the sensitivity signal.

## API sketches (anchor points, not contracts)

Later phases build on modules earlier phases create. These sketches exist so each phase's
chat lands on compatible shapes; refine freely but record deviations in the log.

```javascript
// Feature registry (Phase 1) — shared module, e.g. src/state/features.js
registerFeature({
  id: 'sor-plan',          // canonical kebab-case id
  title: 'SOR Plan',       // tab label
  rootId: 'feature-sor-plan',
  init(ctx) {},            // called once at boot; ctx gives sessions/jobs handles
  onActivate() {},         // tab shown — render deferred results, resize charts
  onDeactivate() {},       // tab hidden
});
setActiveFeature(id); getActiveFeature(); setFeatureBadge(id, { busy, progress });

// Session store (Phase 2) — generalizes src/state/persistence.js
sessions.list(feature);                  // -> [{ name, description, updatedAt }]
sessions.load(feature, name);            // -> payload (migrated to current schema)
sessions.save(feature, name, payload, description);
sessions.delete(feature, name);
sessions.importWithRename(feature, name, payload); // -> final name ("My Plan (2)")

// Job manager (Phase 2) — generalizes currentWorker/terminateWorkers in main.js
const job = jobs.start(feature, {
  createWorker,            // () => Worker (inline worker factory)
  params,
  onProgress(pct, note) {},// also drives the tab badge for that feature
  onDone(result) {},       // feature decides when/how to render (see hidden-tab pitfall)
  onError(err) {},
});
job.cancel(); jobs.cancelAll(feature); jobs.isBusy(feature);
```

## Phases

Each phase is a fresh chat, independently shippable, with all tests green at the end.
"Tests green" means specifically: `npm test` (full Vitest suite) passes, the full
Playwright suite `npx playwright test` passes (not just the spec you touched), and
`npm run build` completes. Run all three before declaring a phase done.

### Phase 1 — Shell & naming foundation

No new analysis features; zero SOR Plan behavior change beyond storage key names.

- Feature registry module (shared): id, display name, root element id, badge state.
- Tab bar in `src/partials/header.html` rendered from the registry (only SOR Plan exists
  until Phase 4; a single tab is fine). Fix the title typo "Finanace Simulator" while here.
- Wrap the existing input/results UI in a `#feature-sor-plan` root in `index.html`.
- Move app-wide prefs (theme, ui prefs, active tab) to `fs:app:*` — clean-break key switch,
  including the inline theme bootstrap script at the top of `index.html`.
- Rename SOR autosave/stash localStorage keys to `fs:sor-plan:*` (clean break, no migration).
- Tests: Vitest for the registry and key scheme; extend the Playwright smoke spec for tab
  presence and that the app still runs end to end.
- Exit tasks:
  - Add `.cursor/rules/multi-feature-architecture.mdc` capturing the permanent conventions
    (feature folders, id/namespace scheme, shared-vs-feature boundaries, session/job rules).

Done when: app looks and behaves as before (modulo new storage keys), tab bar renders,
all unit + e2e tests pass, the new rule file exists.

### Phase 2 — Shared infrastructure (sessions, jobs, links)

- Session store abstraction over the new `fs-sessions` IndexedDB database, keyed by
  `[feature, name]`; SOR Plan is the first consumer; drop the `sor-sessions` DB (clean break).
- Header session controls (select/save/reset/copy/delete/new/link/export/import) bind to the
  active feature's store through the abstraction.
- Export/import and share-link envelope become feature-aware: feature id + feature state +
  dependency-snapshot slots; on open/import, silently import embedded dependencies as named
  sessions with collision auto-rename. Keep accepting legacy `sor-scenario` export files.
  Keep the share payload compressed — multi-scenario embeds grow the URL (see Risks).
- Shared job manager module: start/progress/cancel per feature; refactor the run-simulation
  and goal-seek paths in `src/main.js` onto it; loading/progress UI scoped per feature;
  busy/progress badge on tabs; jobs keep running when the user switches tabs and results
  render into the owning feature when it is next visible.
  - Pitfall: do NOT render Chart.js charts into a hidden (`display:none`) feature root —
    they size to zero. Either defer rendering until the feature's `onActivate`, or render
    and call `chart.resize()` on activation. Cover this in the e2e test (switch away
    during a run, switch back, assert charts have nonzero size).
- Tests: Vitest for session store (namespacing, collision rename, legacy import) and job
  manager; e2e: a run started in SOR Plan survives a tab switch (needs at least a hidden
  or stub second tab to switch to) and sessions round-trip through the new store.
- Exit tasks: README touch-up — clean-break note for existing users (export/import to carry
  data over).

Done when: sessions live in `fs-sessions`, links/exports use the new envelope, simulation
and goal-seek run through the job manager, all tests pass.

### Phase 3 — SOR Plan refactor into the feature structure

Staged to avoid churn; each step lands independently with tests green and zero behavior change.

- **3a**: Move SOR partials from `src/partials/` (inputs, results) to
  `src/features/sor-plan/partials/` and update the handlebars `partialDirectory` list in
  `vite.config.js`. Shared partials (dialogs, loading, header) stay in `src/partials/shared/`.
- **3b**: Decompose `src/main.js` (~1,000 lines) into `src/features/sor-plan/` modules
  (inputs wiring, run orchestration, session glue, results rendering) behind a thin app
  bootstrap `src/main.js` that initializes the shell (theme, tabs, dialogs, job manager)
  and each registered feature.
- **3c**: Move SOR-specific state/ui under the feature: risk presets (`src/state/presets/`),
  results/report UI, SOR charts. Decide and record in the log what stays shared — the
  scenario model (`src/state/scenario.js`) likely stays shared since SOR Lab consumes it;
  chart theme/setup (`src/ui/charts/chartTheme.js`, `chartSetup.js`) stay shared.

Done when: `src/features/sor-plan/` owns all SOR-specific code, `src/main.js` is a thin
bootstrap, imports updated, all tests pass, no visible change. Update the architecture rule
file if boundaries shifted.

### Phase 4 — SOR Lab (tornado MVP)

- `src/features/sor-lab/` scaffold: partials + logic + ui, registered as the second tab.
- Scenario picker over saved SOR Plan sessions (live references via the session store).
- Metric selector (default success rate), parameter list with built-in low/high presets
  and per-parameter override.
- Sensitivity runner: build perturbed sim params via `buildSimParams`, run through the job
  manager + `src/workers/parallelPool.js`, with common random numbers across all bars.
- Tornado chart: horizontal bars, Chart.js, themed via the shared chart theme.
- Lab sessions saved under the `sor-lab` namespace in `fs-sessions`.
- Lab share links/exports embed snapshots of referenced SOR Plan scenarios via the Phase 2
  dependency-snapshot mechanism; sanity-check link length against practical URL limits
  (file export is the fallback for oversized payloads).
- Tests: Vitest for perturbation building, common-random-number plumbing, and metric
  extraction; one Playwright smoke for a Lab run.
- Exit tasks: README update — the "one tool, several features" story, brief SOR Lab blurb
  (inline help in the app carries the detail).
- Open items to finalize at phase start: exact parameter list, preset low/high ranges,
  metric list beyond success rate.
- Design note: scenario-vs-scenario comparison is a likely follow-on — keep the Lab data
  model open to referencing multiple scenarios rather than baking in a single-scenario
  assumption.

Done when: user can pick a saved scenario, run a tornado analysis that survives tab
switches, see ranked sensitivity bars, save/share the analysis, all tests pass.

## Risks to keep in mind

- **DOM id collisions**: partials use global element ids. New feature elements must use the
  `<feature-id>-` prefix; existing SOR ids are renamed only opportunistically during Phase 3.
- **URL length**: links embedding multiple dependency snapshots grow the URL. Keep the share
  payload compressed (Phase 2) and check Lab link length in Phase 4; file export is the
  fallback for oversized payloads.
- **`dist/index.html` is committed**: each phase's build diff shows there; bundle growth is
  visible and expected.
- **Feature boundaries**: SOR Lab must consume scenarios only through `scenario.js` /
  session-store interfaces — never reach into SOR Plan's DOM or module state. This is what
  keeps a future, less-integrated feature cheap to add.

## Status / decisions log

(Each phase's chat appends dated entries here: what shipped, and any decisions that affect
later phases.)

- 2026-07-26 — Plan created. No phases started.
- 2026-07-26 — Plan hardened: legacy share links are a silent clean break (open fresh, no
  decode); added app-vs-feature state boundary rule, API sketches, hidden-tab Chart.js
  pitfall, and explicit verification commands.
- 2026-07-26 — **Phase 1 shipped.** Feature registry (`src/state/features.js`) + tab bar
  under the title (SOR Plan only); `#feature-sor-plan` wraps inputs/results; title typo
  fixed ("Finance Simulator"). Storage clean-break:
  - `fs:app:prefs` — theme + activeFeature (`src/state/appPrefs.js`)
  - `fs:sor-plan:ui` — report band / accordions / chart view prefs (`uiPrefs.js`)
  - `fs:sor-plan:autosave` / `fs:sor-plan:unsaved-stash`
  - No migration of legacy `sor:*` keys. Share/export UI snapshots still carry `theme`;
    `applyUiPrefs` routes theme into app prefs and feature chrome into `fs:sor-plan:ui`.
  - Key helpers in `src/state/storageKeys.js`.
  Rule file added: `.cursor/rules/multi-feature-architecture.mdc` (also listed in
  `CLAUDE.md`). Vitest: registry + key scheme + appPrefs; smoke e2e asserts tab +
  feature root. Verification: `npm test`, `npx playwright test`, `npm run build` green.
  Note for Phase 2: IndexedDB still `sor-sessions` / export type still `sor-scenario`
  until that phase.
- 2026-07-26 — **Phase 2 shipped.** Shared infrastructure:
  - Sessions: `src/state/sessions.js` → IndexedDB `fs-sessions`, keyPath `[feature, name]`;
    legacy `sor-sessions` deleted on boot (no migrate). Header binds to active feature.
  - Export/share: `type: "fs-scenario"` + `feature` + `state` + `dependencies[]`;
    legacy `sor-scenario` *files* still import; legacy uncompressed share `?s=` silently
    ignored (strip param, open fresh). Share payload gzip via `CompressionStream`.
  - Jobs: `src/state/jobs.js` — per-feature start/progress/cancel; sim + goal-seek on it;
    tab busy/progress badges; results deferred until SOR Plan `onActivate` (Chart.js).
  - Permanent empty **SOR Lab** tab (`#feature-sor-lab`) for tab-switch e2e / Phase 4.
  - README clean-break note (export before upgrade). Vitest: sessions, jobs, share;
    e2e: tab-switch mid-run + nonzero chart size. Verification: `npm test`,
    `npx playwright test`, `npm run build`.
- 2026-07-26 — **Phase 3 shipped.** SOR Plan refactored into feature structure
  (zero intentional UX change):
  - **3a**: Partials → `src/features/sor-plan/partials/{inputs,results}/`; header →
    `src/partials/shared/`; Vite Handlebars `partialDirectory` includes feature tree.
  - **3b**: Thin `src/main.js` bootstrap; Plan modules
    `src/features/sor-plan/{index,run,session,history}.js`; Lab stub
    `src/features/sor-lab/index.js`; shared header chrome `src/ui/sessionChrome.js`
    with per-feature adapters. `initFeatures` is async so Plan init can await
    session list refresh before chrome binds.
  - **3c**: Plan UI under `src/features/sor-plan/ui/` (inputs, riskPreset, results,
    report, sectionSummaries, SOR charts). Shared remain: `scenario.js` /
    `defaults.js` / **`presets/`** (intentional: core + Lab need them), `uiPrefs.js`,
    `chartTheme` / `chartSetup` / `returnColors`, dialogs/theme/format/applyUiPrefs.
  - Architecture rule updated for the shared-vs-feature table. htmlhint covers
    `src/features/**/partials/**`. Verification: `npm test`, `npx playwright test`,
    `npm run build` green.
