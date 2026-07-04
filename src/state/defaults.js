// Default starting values for a new simulation scenario.
//
// HOW TO USE
// - Edit values here to change what the app loads on a fresh visit.
// - Currency fields are in thousands ($000s), matching the form labels.
// - If you already have an autosaved session, clear browser storage or use a
//   private window to see your changes on first load.
// - Each field below has inline comments for valid options and limits.

export const SCENARIO_DEFAULTS = {

  // Years to simulate. Valid range: 1–100 (enforced at run time).
  numYears: 35,

  // Monte Carlo paths to run. Valid range: 1–100,000. More = smoother stats, slower run.
  numSimulations: 10000,

  // Optional fixed seed for reproducible results. Empty string = random each run.
  randomSeed: '',

  // Half-width (% of all runs) averaged around each percentile card/path.
  // Valid UI range: 0–5. Engine clamps to ±10% of all runs.
  // 0 = show a single run at that rank; higher = smoother, less noisy curves.
  smoothWindowPct: 1,

  // Expected length of consecutive-year runs (resampling) or AR(1) smoothing
  // strength (log-normal). Valid UI range: 1–6. 1 = fully independent years.
  blockSize: 3,

  // Jitter strength for Smoothed Historical only: % of each asset's target stdDev.
  // Valid UI range: 0–100. 0 = no jitter; 35 = moderate smoothing (default).
  scaledHistoricalSmoothing: 35,

  // Mode selectors (radio buttons)

  // How returns are generated. Options:
  //   'resampling'       — sample real historical years (with year-to-year persistence)
  //   'scaledHistorical' — Smoothed Historical: resample real years, rescaled + jittered
  //   'lognormal'        — draw from mean/std-dev profiles (requires fields below)
  distMethod: 'resampling',

  // How withdrawals are chosen. Options:
  //   'base'     — fixed base amount plus optional front-loading / go-go years
  //   'specific' — paste a year-by-year list (see specificWithdrawals)
  withdrawalStrategy: 'base',

  // Historical range

  // First year included when sampling history or computing profiles.
  // Must be within built-in history (1900–2025) and ≤ endYear.
  startYear: 1960,

  // Last year included. Must be within built-in history (1900–2025) and ≥ startYear.
  endYear: 2025,

  // Asset allocation (%). All six fields must sum to exactly 100.

  usLgGrowthAllocation: 25,
  usLgValueAllocation: 25,
  usSmMidAllocation: 15,
  exUsAllocation: 15,
  bondAllocation: 5,
  cashAllocation: 15,

  // Portfolio & withdrawal ($000s unless noted)

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

  // Staged minimum withdrawals ($000s). Intermediate tiers need a year count;
  // the last tier applies to all remaining years. Empty = no floor.
  withdrawalFloors: [{ amount: 100 }],

  // Front-loading (only when withdrawalStrategy is 'base')

  // Annual real % change applied to the whole withdrawal (negative = decline).
  spendChangePct: -2,

  // Flat bonus added to withdrawal during the first goGoYears ($000s).
  goGoBonus: 50,

  // Number of early years that receive goGoBonus.
  goGoYears: 15,

  // Year-by-year withdrawal list. Used when withdrawalStrategy is 'specific'.
  // Paste-friendly text; negative = deposit. Leave empty when using 'base'.
  specificWithdrawals: '',

  // Dynamic adjustments

  // Master toggle for market-return and balance-based withdrawal adjustments.
  enableDynamicAdjustments: true,

  // Low market-return anchor (%). Triggers must increase: low < med < high.
  dynLowRet: -15,
  dynLowBal: 1000,
  dynLowAdj: -50,

  // Expected market-return anchor (%).
  dynMedRet: 5,
  dynMedBal: 3000,
  dynMedAdj: 0,

  // High market-return anchor (%).
  dynHighRet: 20,
  dynHighBal: 5000,
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
  // When enabled, clicking "Run" searches for spending settings that hit the
  // targets below instead of just simulating whatever is currently typed in.

  // Master toggle for Goal Seek mode.
  goalSeekMode: false,

  // Balance ($000s) the search tries to leave behind at the end of the
  // horizon (on top of never running out of money along the way).
  goalSeekTargetEndingBalance: 0,

  // Minimum acceptable success rate (%) for the searched plan.
  goalSeekDesiredSuccessPct: 90,

  // Max lifetime spending shortfall vs. plan (%) the search allows in bad
  // markets. 0 = guardrail cuts effectively off; higher = bigger plan, more
  // belt-tightening allowed. Minimum-withdrawal tiers still protect essentials.
  goalSeekRiskTolerancePct: 20,

  // When false, Goal Seek keeps the typed base withdrawal fixed and searches
  // only the other included levers. Default true = base is searched like before.
  goalSeekIncludeBaseWithdrawal: true,

  // Which additional levers the search is allowed to tune (checkboxes).
  goalSeekIncludeGoGoYears: false,
  goalSeekIncludeMarketAdjustments: false,
  goalSeekIncludeBalanceOverrides: false,
};
