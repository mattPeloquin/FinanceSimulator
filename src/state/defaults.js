// Default starting values for a new simulation scenario.
//
// HOW TO USE
// - The app's out-of-the-box values are BASE_DEFAULTS below overlaid with the
//   "Balanced" risk preset (src/state/presets/balanced.json) — the middle
//   position of the Risk Level slider. Slider-controlled values (return
//   method, Goal Seek settings, allocations, market/balance triggers, minimum
//   withdrawal, gifting, spending timeline) live in balanced.json; everything
//   else lives here. Edit whichever file owns the value you want to change.
// - Currency fields are in thousands ($000s), matching the form labels.
// - If you already have an autosaved session, clear browser storage or use a
//   private window to see your changes on first load.
// - Each field below has inline comments for valid options and limits.

import balanced from './presets/balanced.json';
import { computeDerivedPresetValues, DEFAULT_PRESET_LEVEL } from './presets/index.js';

const BASE_DEFAULTS = {

  // Years to simulate (endpoint / target horizon). Valid range: 1–100.
  numYears: 35,

  // Optional Monte Carlo range: years above/below the endpoint treated as
  // 2-sigma bounds (0 = fixed horizon). Each run draws a whole-year horizon
  // inside [numYears - minus, numYears + plus].
  horizonPlusYears: 0,
  horizonMinusYears: 0,

  // Monte Carlo paths to run. Valid range: 1–100,000. More = smoother stats, slower run.
  numSimulations: 10000,

  // Optional fixed seed for reproducible results. Empty string = random each run.
  randomSeed: '',

  // Half-width (% of all runs) averaged around each percentile card/path.
  // Valid UI range: 0–5. Engine clamps to ±10% of all runs.
  // 0 = show a single run at that rank; higher = smoother, less noisy curves.
  smoothWindowPct: 1,

  // How runs are ranked and scored against the plan. Options:
  //   'auto'         — total for fixed horizon, mean/yr when range is enabled (default)
  //   'total'        — lifetime total withdrawn
  //   'meanYearly'   — mean withdrawal per year (total ÷ horizon; horizon-independent)
  //   'medianYearly' — median withdrawal per year (horizon-independent)
  withdrawalMetric: 'auto',

  // Expected length of consecutive-year runs (resampling) or AR(1) smoothing
  // strength (log-normal). Valid UI range: 1–6. 1 = fully independent years.
  blockSize: 3,

  // Jitter strength for Smoothed Historical only: % of each asset's target stdDev.
  // Valid UI range: 0–100. 0 = no jitter; 35 = moderate smoothing (default).
  scaledHistoricalSmoothing: 35,

  // Risk Level slider (simple-use mode)

  // Slider position 0 (Conservative) – 4 (Aggressive). See src/state/presets/.
  presetLevel: DEFAULT_PRESET_LEVEL,

  // Whether the slider drives the preset-controlled settings. Manually editing
  // a preset-controlled field flips this off ("detach") and keeps your values.
  presetActive: true,

  // Mode selectors (radio buttons)

  // How withdrawals are chosen. Options:
  //   'base'     — fixed base amount plus optional front-loading / go-go years
  //   'specific' — paste a year-by-year list (see specificWithdrawals)
  // (distMethod — how returns are generated — comes from the risk preset.)
  withdrawalStrategy: 'base',

  // Historical range

  // First year included when sampling history or computing profiles.
  // Must be within built-in history (see minAvailableYear–maxAvailableYear in
  // historicalData.js) and ≤ endYear.
  startYear: 1960,

  // Last year included. Must be within built-in history and ≥ startYear.
  endYear: 2025,

  // Portfolio & withdrawal ($000s unless noted)
  // (Asset allocation percentages come from the risk preset.)

  // Starting portfolio balance ($000s).
  startBalance: 3000,

  // Base annual withdrawal. Used when withdrawalStrategy is 'base' ($000s).
  baseWithdrawal: 150,

  // Balance ($000s) below which spending scale begins cutting withdrawals.
  floorBalance: 2000,

  // Spending scale at/below floorBalance, as % of target (e.g. 50 = half).
  floorPenalty: 50,

  // Balance ($000s) above which spending scale begins boosting withdrawals.
  ceilingBalance: 4000,

  // Spending scale at/above ceilingBalance, as % bonus (e.g. 50 = +50%).
  ceilingBonus: 50,

  // Glide-path spend-down target ($000s). Blank = disabled (engine behaves as
  // today). When set, each year recycles part of any balance above the glide
  // path — the balance that still funds the remaining plan and lands on this
  // target at the horizon. 0 is a valid "land on zero" target. Lives in the
  // Dynamic Adjustments & Guardrails section, so its enable toggle gates this
  // lever too.
  glideTarget: '',

  // Share (%) of the surplus above the glide path withdrawn each year.
  glideFraction: 50,

  // Spend Timing (%/yr, -4..0): the assumed real return used to discount the
  // glide path. More negative = "later" — the glide path sits higher, so early
  // retirement stays invested and surplus is recycled in the later years
  // (helps plans that would otherwise dip to minimum withdrawals
  // mid-retirement). 0 = "sooner", the most aggressive setting; positive
  // values are excluded because they lose on both lifetime spending and
  // success rate (spending recycled early forfeits compounding).
  glideRate: -2,

  // Front-loading (only when withdrawalStrategy is 'base')

  // Staged spending-over-time tiers: annual real % change, extra withdrawal,
  // and year count. Intermediate tiers need a year count; the last tier
  // applies to all remaining years. The changePct and first-tier years below
  // are placeholders — the risk preset overlay fills them in; the first-tier
  // extra (50) is the starting point Goal Seek tunes from.
  spendingOverTimeTiers: [
    { changePct: -2, extra: 50, years: 15 },
    { changePct: -2, extra: 0 },
  ],

  // Year-by-year withdrawal list. Used when withdrawalStrategy is 'specific'.
  // Paste-friendly text; negative = deposit. Leave empty when using 'base'.
  specificWithdrawals: '',

  // Staged minimums as % of each year's Specific List amount.
  // Intermediate tiers need a year count; last tier covers remaining years.
  // Empty = no floor (typed amounts used as-is).
  specificWithdrawalFloors: [],

  // Dynamic adjustments

  // Master toggle for market-return and balance-based withdrawal adjustments.
  enableDynamicAdjustments: true,

  // Adjustment amounts ($000s) at each market anchor. The return triggers
  // (dyn*Ret) and balance triggers (dyn*Bal) come from the risk preset.
  dynLowAdj: -50,
  dynMedAdj: 0,
  dynHighAdj: 50,

  // Log-normal profiles (% mean / std-dev)
  // Used only when distMethod is 'lognormal'. null = auto-filled from the
  // selected historical range on first load ("Update From History").

  usLgGrowthMean: null,
  usLgGrowthStdDev: null,
  usLgValueMean: null,
  usLgValueStdDev: null,
  usSmMidMean: null,
  usSmMidStdDev: null,
  exUsMean: null,
  exUsStdDev: null,
  bondReturnMean: null,
  bondReturnStdDev: null,
  cashReturnMean: null,
  cashReturnStdDev: null,
  inflationMean: null,
  inflationStdDev: null,

  // Goal Seek mode
  // The master toggle, targets, and lever checkboxes come from the risk preset.

  // Number of simulations run for each candidate the search evaluates.
  // Lower = faster search but noisier success-rate estimates; higher = slower
  // but more accurate.
  goalSeekNumSimulations: 1000,

  // How aggressively to use CPU cores during simulation runs.
  // Options: 'low' (1 core), 'med' (3 cores), 'high' (up to 6 cores).
  parallelCores: 'high',
};

// Out-of-the-box scenario = base values + the Balanced preset's static keys +
// its balance/horizon-derived values (minimum withdrawal, gifting, balance
// triggers, target ending balance, spending timeline) computed at the default
// starting portfolio and horizon. This keeps balanced.json the single source
// of every slider-controlled default while defaultScenario() stays complete.
export const SCENARIO_DEFAULTS = {
  ...BASE_DEFAULTS,
  ...balanced.scenario,
  ...computeDerivedPresetValues(balanced, {
    startThousands: BASE_DEFAULTS.startBalance,
    numYears: BASE_DEFAULTS.numYears,
    withdrawalFloors: [],
    giftingTiers: [],
    spendingOverTimeTiers: BASE_DEFAULTS.spendingOverTimeTiers,
  }),
};
