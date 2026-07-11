# Risk preset levels

The five JSON files here back the "Risk Level" slider (conservative → aggressive)
shown under Starting Portfolio. **All financial values are tunable** — edit the
JSON and rebuild; no code changes needed. `balanced.json` doubles as the app's
out-of-the-box preset configuration (see `src/state/defaults.js`).

Each file has two sections:

- `scenario` — applied verbatim when the slider moves. Only keys listed in
  `PRESET_SCENARIO_KEYS` (`index.js`) are allowed; a unit test enforces this.
  Allocations must sum to 100 and market triggers must satisfy low < med < high.
  Goal Seek's on/off toggle lives in `BASE_DEFAULTS`, not here — toggling it
  does not detach Easy Mode.
- `derived` — formula parameters for values computed from the user's starting
  balance and horizon (see `computeDerivedPresetValues` in `index.js`):
  - `minWithdrawalLifetimePctOfStart` — total minimum spending across the
    horizon as % of start; annual floor = that × start ÷ years. Higher on
    Conservative (steadier cash flow), lower on Aggressive (willing to cut)
  - `gifting.amountPctOfStart` / `.balanceMultipleOfStart` — first gifting tier
  - `spending.changePct` — annual real change % on the first two spending tiers
  - `spending.firstTierYearsFractionOfHorizon` — first tier years = fraction × horizon
  - `noCutBalanceMultipleOfStart` — "no cut while ahead" threshold = multiple × start;
    market-driven cuts are skipped while the balance is above it
  - `targetEndingBalancePctOfStart` — Goal Seek target ending balance = % of start;
    also writes `glideTarget` to the same value so the Glide-path Target field
    tracks Easy Mode before a search runs
  - `glideRate` (in `scenario`) — glide-path spend timing (-4 = later … 0 = sooner);
    Conservative is one tick later, Aggressive one tick sooner, the middle three at -2
  - `maxConsecutiveMinWithdrawals` / `minWithdrawalPlanRecoveryYears` (in
    `scenario`) — after this many years in a row at the minimum, spending returns
    to the plan for that many years. Steps up from Conservative (2 / 2) to
    Aggressive (4 / 2) — higher risk levels tolerate longer belt-tightening;
    either 0 turns the feature off
  - **Spending plan (Easy Mode + Goal Seek off):** `baseWithdrawalPctOfStart`
    (4.0–6.0% in 0.5 steps), `floorBalanceMultipleOfStart` /
    `ceilingBalanceMultipleOfStart`, `floorPenalty`, `ceilingBonus`,
    `dynAdjPctOfBase.low/med/high` (% of base withdrawal), `spendingExtraPctOfBase`
    (tier-0 go-go extra as % of base), `glideFraction`

When **Use easy mode** is on and **Goal Seek** is off, the slider fills the full
spending plan from those derived keys. With Goal Seek on, the slider configures
the search (success target, levers, allocations, triggers) and Goal Seek finds
the plan on **Find Best Plan**.
