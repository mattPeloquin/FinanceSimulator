# 📈 Personal Finance Simulator

**[▶ Run the simulator now](https://mattpeloquin.github.io/FinanceSimulator/dist/index.html)** — open it in your browser, no install required.

Welcome to the Sequence-of-Returns Finance Simulator! This is a powerful, interactive tool that helps you visualize your financial future, plan for retirement, and understand the risks associated with the stock market.


## Why is this so easy to deploy?

This entire simulator is engineered to bundle into a **single, self-contained HTML file**.

- **No Servers Needed:** You don't need a database or backend server to run this.
- **Run Anywhere:** Once built, you can literally double-click the final `index.html` file and it will run perfectly in your browser.
- **Host for Free:** You can drag and drop your built file onto free hosting platforms (like GitHub Pages, Netlify, or Vercel) and have your own live website in seconds.

---


## Setting Up Your Dev Environment

You don't need to be a software engineer to modify this app! You just need a few basic tools installed on your computer.

### Step 1: Install the basics

1. **Node.js**: Download and install the LTS version from [nodejs.org](https://nodejs.org/). This runs the background tools needed to build the project.
2. **Cursor**: Download and install [Cursor](https://cursor.sh/), an AI-powered code editor that will essentially write the code for you.



### Step 2: Get the project running

1. Open the **Cursor** app.
2. Go to `File > Open Folder` and select the folder containing this project.
3. Open the Terminal inside Cursor by clicking `Terminal > New Terminal` in the top menu (or pressing `Ctrl + ``).
4. In the terminal window, type:
  ```bash
   npm install
  ```
   *Press Enter. This downloads the necessary project files (it may take a minute).*
5. Once that finishes, type:
  ```bash
   npm run dev
  ```
   *Press Enter. This starts up your local preview. You'll see a web link (usually* `http://localhost:5173`*). Click it or copy it into your browser (or Ctrl-Click the link in the terminal) to see the app running live!*

---



## Extending the Code

You do not need to know how to code to add new features to this app. Instead, you can use **Vibe Coding**—where you use natural language to tell an AI what you want, and the AI handles the complex syntax and logic.

### Changing the app's colors

To tweak the look of the app (backgrounds, text, accent buttons, chart colors, and more), edit **`themeTokens`** at the top of `src/ui/theme.js`. Those values flow automatically into the page, charts, and dark mode — no need to hunt through dozens of files.

### Changing the default starting values

To change what the simulator loads with on a fresh visit (starting balance, withdrawal amount, asset mix, year range, persistence slider, and more), edit **`SCENARIO_DEFAULTS`** in `src/state/defaults.js`. Each field has inline comments explaining valid options and limits. Currency amounts in that file are in thousands ($000s), matching the form labels. If you already have an autosaved session in your browser, clear it or use a private window to see your new defaults on first load.

### How to Vibe Code with Cursor

Cursor has a built-in AI assistant. You essentially act as the "Product Manager," and Cursor acts as your "Programmer."

1. **Use the Composer (Ctrl+I / Cmd+I)**
  - Press `Ctrl + I` (or `Cmd + I` on Mac) to open the AI Composer.
  - Simply type what you want to achieve in plain English.
  - *Example:* "Make the background of the app dark mode," or "Add a new text input for 'Annual Inflation Rate' next to the starting balance."
  - The AI will generate the code across multiple files. Simply click **Accept All** to apply it.
2. **Use the Chat Panel (Ctrl+L / Cmd+L)**
  - If you want to ask questions or figure out how something works, open the Chat panel.
  - *Example:* "How do the charts in this project work? I want to change the line color from red to blue."
  - The AI will read your files and give you the exact steps or code snippets you need.
3. **Handling Errors? Just ask the AI!**
  - If you add a feature and the screen goes blank, don't panic! 
  - Just copy whatever error you see in the terminal or on the screen, paste it into the Cursor chat, and say: "I got this error, please fix it." The AI will figure out what went wrong and fix it.
4. **Trust the Tests**
  - This project has automated tests to make sure things don't break. If you add a new feature, you can tell Cursor: "I just added an inflation input. Run the tests and fix any issues caused by my changes."



### Building Your Final Version

Once you've vibe-coded your app to perfection and want to share it with the world, open the terminal and type:

```bash
npm run build
```

This will bundle your entire app into a single `index.html` file located in the `dist` folder. You can now send that file to anyone or drag-and-drop it onto a web host! Happy building!

---



## How the Simulator Works (Logical Design & Flow)

This section explains what actually happens "under the hood" when you press **Run Simulation** — from your inputs, through the math, to the charts on screen. It's useful background reading if you want to vibe-code changes to the engine or the visuals.

### The big picture

```mermaid
flowchart TD
    A["1. Your Inputs<br/>(the 'Scenario')"] --> B["2. Build Simulation Parameters"]
    B --> C["3. Background Worker<br/>runs thousands of simulations"]
    C --> D["4. Rank & Summarize<br/>(percentiles, success rate)"]
    D --> E["5. Regenerate the ~200 paths<br/>that will actually be drawn"]
    E --> F["6. Render Results<br/>(metric cards + charts)"]
```





### Step 1: Your inputs become a "Scenario"

Everything you type into the form — starting balance, yearly withdrawal, asset mix, year range, dynamic adjustment rules — is collected into one flat object called a **scenario** (`src/state/scenario.js`). This single object is the source of truth for the whole app:

- It is **autosaved** to your browser's local storage as you type, so refreshing the page never loses your work.
- It can be saved as a **named session** (stored in your browser via IndexedDB), or **exported/imported** as a JSON file to share with others. Use **New** to start a fresh scenario (your current named session is saved automatically first). **Save** updates the current session (name and optional description). **Copy** duplicates your current values under a new name without changing the original. The description appears below the session controls when set.
- Money fields are entered in thousands of dollars ($000s) and converted to real dollars just before the math runs.

The **historical data** (`src/data/historicalData.js`) is a built-in table of yearly returns from 1900 onward for six asset classes (US large growth, US large value, US small/mid, international, bonds, cash) plus inflation. When you change the year range, the app instantly recomputes the average return and volatility "profiles" for that window, redraws the mini history charts, and refreshes the pool of years available for resampling (`src/core/history.js`). If you've typed your own numbers into the profile fields, the app keeps them and shows an "Overwrite from history" link instead of replacing your edits.

> **A note on the data:** the built-in numbers are good-faith approximations assembled for illustration — the early decades especially are rounded reconstructions, since precise style-level index data doesn't exist that far back. They're great for exploring risk, but don't treat any single year as an exact historical fact.



### Step 2: Turning the scenario into engine-ready parameters

When you click **Run Simulation**, the scenario is validated (allocation must total 100%, year range must be valid, etc.) and converted into a `params` object the math engine understands: percentages become decimals, $000s become dollars, and the pool of historical years for your chosen range is attached. If you left the random seed blank, a random one is picked — but entering the same seed twice will reproduce the exact same results.

### Step 3: The simulation engine (runs off-screen in a Web Worker)

The heavy math runs inside a **Web Worker** (`src/workers/simulation.worker.js`) — a background thread — so the page never freezes, and a progress bar updates as it goes. The progress bar also shows how many CPU cores are being used. Changed your mind mid-run? A **Cancel** button under the progress bar stops the simulation instantly.

On multi-core machines, the worker can split each Monte Carlo run across several cores at once (Goal Seek benefits too, since it runs many smaller simulations while searching). Open **Advanced simulation settings** and use **Core Usage** to choose **Low** (1 core), **Medium** (3 cores: 1 master + 2 sub-workers), or **High** (up to 6 cores: 1 master + 5 sub-workers). Lower settings leave more of your computer free for other apps; higher settings finish faster.

**Uncertain end date:** next to **Years to simulate (endpoint)**, you can optionally enter **+ years** and **− years** to model a retirement horizon that might run shorter or longer. Each simulation picks its own timeline inside that range (treated as very likely bounds). Leave both at **0** for a fixed horizon.

The same panel has **Withdrawal Success Metric** — choose **Auto** (recommended: total withdrawal for a fixed horizon, median per year when a range is set), or force **total lifetime withdrawal** or **median withdrawal per year**. Results show both metrics; the one you pick drives ranking, on-plan scoring, and the 3D chart coloring. **Plan Risk Tolerance** sets how far below plan a run can fall and still count as "on plan" in the results and 3D chart (Goal Seek uses its own **Risk Tolerance** when enabled).

The core engine (`src/core/simulation.js`) simulates one "possible future" at a time. For each simulated year it:

1. **Picks the market's returns and inflation** using one of three methods you choose:
  - **Historical resampling:** grabs real years from your chosen range in consecutive runs that average the length you set on the slider, wrapping from the last year back to the first so every year in the range is used equally. That keeps crash-then-recovery patterns from actual history without rigid block boundaries.
  - **Smoothed historical:** uses the same real year-to-year sequences as resampling (same streaks, correlations, and crash patterns), but rescales each asset to the mean and volatility you set in the Return Assumptions panel, and adds a touch of smoothing so results aren't limited to only the exact historical years in your range. Good when you want history's shape with different forward-looking assumptions.
  - **Log-normal model:** draws statistically generated returns based on the mean/volatility profiles, using the historical **correlation between asset classes** (so stocks and bonds still move together the way they did in real life) and year-to-year smoothing controlled by the same block/smoothing slider (expected persistence, not a fixed block length).
2. **Grows the portfolio** by that year's inflation-adjusted (real) return, weighted by your asset allocation.
3. **Figures out this year's withdrawal**, starting from your base plan (or a pasted year-by-year list), then applying staged **Spending Over Time** tiers (each tier sets an annual real change % that compounds continuously and an optional extra withdrawal for a set number of years), dynamic adjustments based on market performance and balance triggers (a live mini chart next to those inputs shows the market-return curve you've configured), and a smooth balance-based spending scale (spending gradually ramps down as the balance falls below your floor, and ramps up without limit as it grows past your ceiling — another mini chart shows that curve). If you're using the Base + Spending Over Time strategy, optional staged minimum-withdrawal tiers (each tier can run for a set number of years; the last tier covers all remaining years) then act as a final safety net, raising that year's withdrawal up to the floor if everything above would otherwise leave it lower — the Spending Over Time schedule chart reflects tiers directly in its curve so you can see exactly when the floor takes over. With a **Specific List**, you can add the same kind of staged tiers as a **percentage of each year's typed amount** (e.g. 80% means adjustments can't cut that year below 80% of what you entered) — the schedule chart shows the floor as a dashed line. Your typed amounts are still the plan; the percentage minimum is only a backstop in bad markets. Negative list values are deposits and are never overridden by a minimum. **Gifting** (available under both strategies) lets you stage extra gift withdrawals over time — each tier sets a gift amount and a portfolio balance threshold. Set Gift to 0 on early tiers to defer gifting to later years. A gift is added only in years when your balance after the regular withdrawal or deposit still exceeds that threshold *and* that year's spending fully met your plan (guardrails didn't cut it short). The schedule chart shows a thin dotted gift ceiling above your planned withdrawal.
4. **Subtracts the withdrawal** and records whether the portfolio ran out of money (the "depletion year").

This is repeated for every year in your horizon, and the whole thing is repeated for every simulation (10,000 by default).

**A clever memory trick:** the engine uses a *seeded* random number generator (`src/core/rng.js`), where each simulation gets its own predictable seed. That means the engine only needs to keep four summary numbers per simulation (final balance, total withdrawn, average return, depletion year) — it can throw away the year-by-year details and **perfectly regenerate any individual path later** just by re-running it with the same seed. That's how 10,000 simulations stay fast and memory-light.

### Step 4: Ranking and summarizing the outcomes

Once all simulations finish, the worker (`src/core/statistics.js`) computes:

- **Success Rate (not depleted)** — the share of futures where your portfolio never ran out of money.
- **Success Rate (on plan)** — a separate metric shown next to it: the share of futures whose withdrawals reached at least your acceptable shortfall below the planned schedule (default: within 5%; adjustable under **Advanced simulation settings** → **Plan Risk Tolerance**). When **Withdrawal Success Metric** is set to median per year, this compares each run's median yearly withdrawal to the planned median instead of lifetime totals.
- **Median end balance** and either **median total withdrawn** or **median withdrawal per year** across all runs (depending on the metric you chose), with the other metric shown underneath.
- A **ranking of every simulation** by your chosen withdrawal metric, used to identify the 10th through 60th percentile outcomes ("cautionary" through "above average"). Each percentile card is actually a *smoothed average of a small band of neighboring runs* (controlled by the smoothing input), so results don't jump around noisily between runs.
- A **histogram** of average annual real returns across all simulations, with summary cards above it (mean, median, worst, best, and spread) and colored reference bars for the median, P5, P95, and mean ± one standard deviation. A second histogram below it shows the same stats for every individual year real return used in the simulation.

### Step 5: Visualizing the results

Only the paths that will actually appear on screen are regenerated in full year-by-year detail (using the seed trick above):

- The **7 percentile paths** (5th–60th) for the timeline charts.
- About **200 paths sampled evenly between the 5th and 60th percentile** for the 3D chart.

The worker then sends this compact, chart-ready package back to the page for display in cards and charts  (`src/ui/results.js` and `src/ui/charts/`).


### Goal Seek: let the simulator find your plan for you

Instead of guessing at a withdrawal amount and checking whether it works, **Goal Seek** flips the process around: tell it what you want (a target amount left over at the end, how confident you want to be, and how much belt-tightening you're willing to accept), and it searches for the highest sustainable spending plan that gets you there.

To use it:

1. Turn on the **Goal Seek** switch near the bottom of the form (above the Run button).
2. Enter a **Target Ending Balance** (how much you'd like left over, on top of never running out), a **Desired Success %** (how sure you want to be that the plan works), and a **Risk Tolerance** (how much of your planned lifetime spending you're willing to give up in bad markets — 0% means stay on plan; higher values allow a bigger headline plan with more guardrail belt-tightening when markets are rough).
3. Under **Base Annual Withdrawal**, leave **Include in search** checked (default) to let Goal Seek find the best base amount, or uncheck it to keep your typed base fixed and search only the other levers — you'll need at least one other "Include in search" lever checked. If the goal isn't reachable at your fixed base, the simulator will say so.
   - Using the **Specific List** strategy instead? Goal Seek always keeps every year's typed amount exactly as you entered it and searches only the **Market adjustment** and **Balance adjustment** levers below — check at least one of those.
4. Optionally, check **Include in search** on any other settings you'd like Goal Seek to tune:
   - **Spending Over Time** — the first tier's extra withdrawal (annual change % and years stay as you typed). When this is checked, Goal Seek switches its goal: instead of maximizing your lifetime total, it maximizes how much you can spend **per year during the first tier's years**, so it favors more aggressive front-loading.
   - **Market adjustment** — the market-triggered spending adjustments (Low/Expected/High) *and* the balance thresholds that override them.
   - **Balance adjustment** — the Floor/Ceiling Balance thresholds *and* their Max Cut / Boost Rate. The search can trade guardrail cuts for a higher sustainable withdrawal when your risk tolerance allows it, and use boosts to spend more when markets are good.
5. Click **Find Best Plan** (the Run button relabels itself while Goal Seek is on). The simulator will try many combinations behind the scenes and, when it finishes, fill in the winning numbers directly into your inputs and show the full results for that plan.

**All withdrawal amounts are in today's dollars:** the base annual withdrawal and every other spending field represent constant purchasing power — the simulator adjusts for inflation automatically, so you don't need to build raises into your numbers.

**Minimum withdrawals still protect essentials:** under the Base + Spending Over Time strategy, staged minimum-withdrawal tiers (set above the spending schedule, whose chart curve rises to meet them automatically) are a hard per-year floor — Goal Seek's risk tolerance only governs how far below the *full planned schedule* lifetime spending is allowed to fall in bad markets, not how low any single year can go. With a **Specific List**, optional percentage minimum tiers work the same way as a backstop (each year's floor is a % of what you typed) — Goal Seek keeps your list fixed and only tunes the Market and Balance adjustment levers, but any percentage minimums you set still apply during the search.

If your target is impossible to reach (e.g. the ending balance is unrealistically high for your starting balance and horizon), the simulator will tell you so instead of showing a misleading answer — try lowering the target or the desired success percentage.

Turn the switch back off any time to return to typing in your own numbers and running a normal simulation — the values Goal Seek found stay right where you'd expect.

**Heads up on run time:** checking any of the "Include in search" boxes makes Goal Seek try substantially more combinations than a plain search (each candidate setting is tested by temporarily re-solving your withdrawal amount around it, so it can see the true payoff of a guardrail or a bonus before deciding whether it's worth it). Expect a full search with everything checked to take noticeably longer than Run Simulation — the progress bar will keep you posted.

**Tuning search speed vs. accuracy:** open **Advanced simulation settings** near the top of the form and scroll to **Goal Seek: Simulations per Search Step** — how many simulations Goal Seek runs to score each candidate plan while it's searching. Lower it for a much faster search (useful while you're experimenting with the targets), or raise it if you want the search itself to be more precise. Either way, the final plan Goal Seek lands on is always double-checked using your full **Number of Simulations**, so the result you see is never less accurate than a normal run.

### Where to look when vibe-coding


| You want to change…                 | Look in…                                                                                            |
| ----------------------------------- | --------------------------------------------------------------------------------------------------- |
| The math of growth/withdrawals      | `src/core/simulation.js`, `src/core/withdrawal.js`                                                  |
| Goal Seek's search logic            | `src/core/goalSeek.js`                                                                               |
| The historical dataset              | `src/data/historicalData.js`                                                                        |
| An input field or its default value | `src/state/scenario.js` (the `FIELDS` list) and the matching form partial in `src/partials/inputs/` |
| A chart's look or behavior          | `src/ui/charts/` (one file per chart)                                                               |
| The summary numbers shown           | `src/workers/simulation.worker.js` and `src/core/statistics.js`                                     |
| Saving/loading sessions             | `src/state/persistence.js`                                                                          |


