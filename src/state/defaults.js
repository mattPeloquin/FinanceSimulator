// Default starting values for a new simulation scenario.
//
// HOW TO USE
// - The app's out-of-the-box values are BASE_DEFAULTS below overlaid with the
//   "Balanced" risk preset (src/state/presets/balanced.json) — the middle
//   position of the Risk Level slider. Slider-controlled values live only in
//   the preset JSON (and its derived formulas); BASE_DEFAULTS must not
//   duplicate them. Edit whichever file owns the value you want to change.
// - Currency fields are in thousands ($000s), matching the form labels.
// - If you already have an autosaved session, clear browser storage or use a
//   private window to see your changes on first load.
// - Each field below has inline comments for valid options and limits.

import balanced from './presets/balanced.json';
import { computeDerivedPresetValues, DEFAULT_PRESET_LEVEL } from './presets/index.js';

// Non-preset starting values only. Slider-controlled keys (PRESET_SCENARIO_KEYS,
// PRESET_DERIVED_SCALAR_KEYS) must not appear here — they come from balanced.json
// via the SCENARIO_DEFAULTS composition below. spendingOverTimeTiers is the one
// exception: the list shape and first-tier "extra" are Goal Seek seeds; the
// preset overwrites changePct / years (and pins the second tier's extra to 0).
export const BASE_DEFAULTS = {

  // Years to simulate (endpoint / target horizon). Valid range: 1–100.
  numYears: 30,

  // Optional Monte Carlo range: years above/below the endpoint treated as
  // 2-sigma bounds (0 = fixed horizon). Each run draws a whole-year horizon
  // inside [numYears - minus, numYears + plus].
  horizonPlusYears: 5,
  horizonMinusYears: 5,

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

  // Starting portfolio balance ($000s). Blank on first load — enter a positive
  // amount before running. Easy Mode rescales derived values once set.
  startBalance: '',

  // Base annual withdrawal. Used when withdrawalStrategy is 'base' ($000s).
  // Filled by Easy Mode (Goal Seek off) or Goal Seek when attached.
  baseWithdrawal: 0,

  // Balance ($000s) below which spending scale begins cutting withdrawals.
  floorBalance: 0,

  // Spending scale at/below floorBalance, as % of target (e.g. 50 = half).
  floorPenalty: 50,

  // Balance ($000s) above which spending scale begins boosting withdrawals.
  ceilingBalance: 0,

  // Spending scale at/above ceilingBalance, as % bonus (e.g. 50 = +50%).
  ceilingBonus: 50,

  // (glideTarget — Glide-path Target — comes from the risk preset's derived
  // target ending balance, kept in lockstep with goalSeekTargetEndingBalance.)

  // Share (%) of the surplus above the glide path withdrawn each year.
  glideFraction: 50,

  // (glideRate — Spend Timing — comes from the risk preset.)

  // Front-loading (only when withdrawalStrategy is 'base')

  // Staged spending-over-time tiers: annual real % change, extra withdrawal,
  // and year count. Intermediate tiers need a year count; the last tier
  // applies to all remaining years. changePct / years are seeds the risk
  // preset overwrites; tier-0 extra is filled by Easy Mode (Goal Seek off) or
  // Goal Seek when attached.
  spendingOverTimeTiers: [
    { changePct: 0, extra: 0, years: 1 },
    { changePct: 0, extra: 0 },
  ],

  // Later target mixes for Adjust allocation over time. Always at least one
  // tier (the last covers remaining years). Seeded to match the Balanced
  // static mix so a fresh plan starts flat until the user edits a target.
  allocationOverTimeTiers: [
    {
      usLgGrowthAllocation: 25,
      usLgValueAllocation: 25,
      usSmMidAllocation: 10,
      exUsAllocation: 15,
      bondAllocation: 5,
      cashAllocation: 20,
    },
  ],

  // One-time or recurring major cash events (Base strategy only). Each entry:
  // signed amount ($000s), 1-based start year, optional consecutive years
  // (blank = one-time). Positive = inflow; negative = extra payment out.
  majorEvents: [],

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
  // (dyn*Ret) and the no-cut balance threshold (dynNoCutBal) come from the
  // risk preset.
  dynLowAdj: 0,
  dynMedAdj: 0,
  dynHighAdj: 0,

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

  // Goal Seek mode — on by default for new users. Independent of Easy Mode:
  // toggling it does not detach the Risk Level slider. Search targets and
  // lever checkboxes come from the risk preset.
  goalSeekMode: true,

  // Number of simulations run for each candidate the search evaluates.
  // Lower = faster search but noisier success-rate estimates; higher = slower
  // but more accurate.
  goalSeekNumSimulations: 1000,

  // How aggressively to use CPU cores during simulation runs.
  // Options: 'low' (1 core), 'med' (3 cores), 'high' (up to 8 cores).
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
    startThousands: 0,
    numYears: BASE_DEFAULTS.numYears,
    withdrawalFloors: [],
    giftingTiers: [],
    spendingOverTimeTiers: BASE_DEFAULTS.spendingOverTimeTiers,
  }),
};
