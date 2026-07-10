# Risk preset levels

The five JSON files here back the "Risk Level" slider (conservative → aggressive)
shown under Starting Portfolio. **All financial values are tunable** — edit the
JSON and rebuild; no code changes needed. `balanced.json` doubles as the app's
out-of-the-box defaults (see `src/state/defaults.js`).

Each file has two sections:

- `scenario` — applied verbatim when the slider moves. Only keys listed in
  `PRESET_SCENARIO_KEYS` (`index.js`) are allowed; a unit test enforces this.
  Allocations must sum to 100 and market triggers must satisfy low < med < high.
- `derived` — formula parameters for values computed from the user's starting
  balance and horizon (see `computeDerivedPresetValues` in `index.js`):
  - `minWithdrawalLifetimePctOfStart` — total minimum spending across the
    horizon as % of start; annual floor = that × start ÷ years. Higher on
    Conservative (steadier cash flow), lower on Aggressive (willing to cut)
  - `gifting.amountPctOfStart` / `.balanceMultipleOfStart` — first gifting tier
  - `spending.changePct` — annual real change % on the first two spending tiers
  - `spending.firstTierYearsFractionOfHorizon` — first tier years = fraction × horizon
  - `balanceTriggerMultiples.low/med/high` — dynamic-adjustment balance triggers = multiple × start
  - `targetEndingBalancePctOfStart` — Goal Seek target ending balance = % of start;
    also writes `glideTarget` to the same value so the Glide-path Target field
    tracks Easy Mode before a search runs
  - `glideRate` (in `scenario`) — glide-path spend timing (-4 = later … 0 = sooner);
    Conservative is one tick later, Aggressive one tick sooner, the middle three at -2

The spending plan itself (base withdrawal, adjustment amounts, glide path,
first-tier extra) is deliberately absent: every level enables all Goal Seek
levers, and clicking Run finds the best plan for the level's success target
and risk tolerance.
