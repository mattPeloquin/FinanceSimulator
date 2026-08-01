// House Equity comparison engine — nominal internal, real display.
//
// Framing: access home equity as early as useful. Strategies share a mortgage
// runway until `accessYear`, then diverge (simplified RM, private RM, HELOC,
// cash-out & invest, sell & rent). Residual equity is reported but not ranked.
//
// Units:
//   • Loan balances, credit lines, payments, sale proceeds, rent: NOMINAL $.
//   • Home appreciation: expected REAL % + CRN shock, converted with inflation.
//   • Metrics, charts, and cashflow contract: REAL / today's $.
//   • UI money fields arrive as dollars (params.js converts from $000s).

import { createRng, deriveSeed } from './rng.js';
import { sampleRealPortfolioReturn, allocationFromConfig, ALLOCATION_ENGINE_KEYS } from './accumulation.js';
import { buildAllocationOverTimeSeries, renormalizeAllocation } from './allocation.js';
import { percentileValue, median } from './statistics.js';
import {
  createEmptyCashflowSeries,
  deflateNominalSeries,
  normalizeCashflowSeries,
} from '../state/cashflowSeries.js';
import { HECM_MCA_LIMIT, sizeHecmProceeds } from '../data/hecmPlf.js';

/** Fixed σ for real home-appreciation shocks (documented in feature help). */
export const HOME_APPRECIATION_SHOCK_STD = 0.02;

/** Strategy ids — always compared together. */
export const STRATEGY_IDS = Object.freeze([
  'simplifiedRm',
  'privateRm',
  'heloc',
  'cashOutInvest',
  'sellAndRent',
]);

export const STRATEGY_LABELS = Object.freeze({
  // Id kept as simplifiedRm for session stability; proceeds use HUD PLFs.
  simplifiedRm: 'Calibrated HECM (PLF)',
  privateRm: 'Private RM',
  heloc: 'HELOC',
  cashOutInvest: 'Cash-out & invest',
  sellAndRent: 'Sell & rent',
});

/**
 * Annual mortgage payment for a fully amortizing loan (nominal).
 * @param {number} balance
 * @param {number} annualRate decimal
 * @param {number} termYears
 */
export function amortizingAnnualPayment(balance, annualRate, termYears) {
  const bal = Math.max(0, Number(balance) || 0);
  const years = Math.max(0, Number(termYears) || 0);
  if (bal <= 0 || years <= 0) return 0;
  const r = Number(annualRate) || 0;
  if (r <= 0) return bal / years;
  const n = years;
  const factor = (1 + r) ** n;
  return bal * (r * factor) / (factor - 1);
}

/**
 * Advance a mortgage one year: pay annual payment, accrue interest, reduce principal.
 * @returns {{ balance: number, payment: number, interest: number, principal: number }}
 */
export function advanceMortgageYear(balance, annualRate, annualPayment) {
  const bal = Math.max(0, Number(balance) || 0);
  if (bal <= 0) {
    return { balance: 0, payment: 0, interest: 0, principal: 0 };
  }
  const rate = Math.max(0, Number(annualRate) || 0);
  const interest = bal * rate;
  const payment = Math.min(bal + interest, Math.max(0, Number(annualPayment) || 0));
  const principal = Math.min(bal, Math.max(0, payment - interest));
  return {
    balance: Math.max(0, bal - principal),
    payment,
    interest,
    principal,
  };
}

/**
 * Net cash to household from selling the home (nominal).
 * Educational — not a tax-prep engine.
 */
export function computeSaleNetProceeds({
  homeValue,
  mortgageBalance = 0,
  basis = 0,
  exclusion = 250_000,
  cgRate = 0.15,
  commissionPct = 0.05,
  otherClosingPct = 0.02,
} = {}) {
  const gross = Math.max(0, Number(homeValue) || 0);
  const mortgagePayoff = Math.min(gross, Math.max(0, Number(mortgageBalance) || 0));
  const commission = Math.max(0, Number(commissionPct) || 0);
  const other = Math.max(0, Number(otherClosingPct) || 0);
  const closingCosts = gross * (commission + other);
  const costBasis = Math.max(0, Number(basis) || 0);
  const excl = Math.max(0, Number(exclusion) || 0);
  const taxableGain = Math.max(0, gross - costBasis - excl);
  const rate = Math.max(0, Math.min(1, Number(cgRate) || 0));
  const cgTax = taxableGain * rate;
  const netToHousehold = gross - closingCosts - mortgagePayoff - cgTax;
  return {
    gross,
    closingCosts,
    mortgagePayoff,
    taxableGain,
    cgTax,
    netToHousehold,
  };
}

/**
 * Draw CRN home real-appreciation shock for a path/year.
 * @param {number} baseSeed
 * @param {number} pathIndex
 * @param {number} yearIndex
 * @param {number} [std]
 */
export function drawHomeAppreciationShock(baseSeed, pathIndex, yearIndex, std = HOME_APPRECIATION_SHOCK_STD) {
  const rng = createRng(deriveSeed(baseSeed >>> 0, pathIndex * 4096 + yearIndex * 17 + 7));
  return rng.normal() * (Number(std) || HOME_APPRECIATION_SHOCK_STD);
}

/**
 * Inflation + optional portfolio return for one year.
 * Market mode uses sampleRealPortfolioReturn; constant mode uses fixed rates + light inflation noise.
 */
function sampleYearMarket(params, pathCtx, yearIndex, yearAlloc) {
  const { returnMode, constantRealReturn, expectedInflation, marketParams, seed, pathIndex } = params;
  if (returnMode === 'market' && marketParams) {
    const sampled = sampleRealPortfolioReturn(
      marketParams,
      pathCtx.rng,
      yearAlloc || pathCtx.defaultAlloc,
      yearIndex,
      pathCtx.sampleState,
    );
    return {
      realReturn: sampled.realReturn,
      inflation: sampled.inflation,
      portfolioReturn: sampled.portfolioReturn,
    };
  }
  // Constant real portfolio return; inflation = expected ± light CRN noise.
  const infRng = createRng(deriveSeed(seed >>> 0, pathIndex * 2048 + yearIndex * 3 + 11));
  const inflation = Math.max(
    -0.05,
    (Number(expectedInflation) || 0.025) + infRng.normal() * 0.005,
  );
  const realReturn = Number(constantRealReturn) || 0;
  const portfolioReturn = (1 + realReturn) * (1 + inflation) - 1;
  return { realReturn, inflation, portfolioReturn };
}

function nominalHomeGrowth(expectedRealAppreciation, homeShock, inflation) {
  return (1 + (Number(expectedRealAppreciation) || 0) + (Number(homeShock) || 0))
    * (1 + (Number(inflation) || 0)) - 1;
}

/**
 * Shared path context for one MC path (RNG + sampling state).
 */
function createPathContext(params, pathIndex) {
  const seed = (params.seed >>> 0) || 0;
  const rng = createRng(deriveSeed(seed, pathIndex));
  const defaultAlloc = renormalizeAllocation(
    params.allocation || allocationFromConfig({}, ALLOCATION_ENGINE_KEYS),
  );
  const allocationSeries = params.allocationSeries
    || buildAllocationOverTimeSeries(
      params.allocationOverTimeTiers || [],
      Math.max(1, params.numYears | 0),
      defaultAlloc,
      params.allocationKeys || ALLOCATION_ENGINE_KEYS,
    );
  return {
    rng,
    sampleState: { bootIndex: null, lnPrevZ: null },
    defaultAlloc,
    allocationSeries,
    pathIndex,
  };
}

/**
 * Advance home + existing mortgage for one runway/access year (no strategy draws).
 */
function stepHouseholdYear(state, params, pathCtx, yearIndex) {
  const yearAlloc = pathCtx.allocationSeries[yearIndex] || pathCtx.defaultAlloc;
  const market = sampleYearMarket(params, pathCtx, yearIndex, yearAlloc);
  const homeShock = drawHomeAppreciationShock(
    params.seed,
    pathCtx.pathIndex,
    yearIndex,
    params.homeShockStd,
  );
  const growth = nominalHomeGrowth(
    params.expectedRealAppreciation,
    homeShock,
    market.inflation,
  );
  state.homeValue = Math.max(0, state.homeValue * (1 + growth));
  const mort = advanceMortgageYear(
    state.mortgageBalance,
    params.existingMortgageRate,
    state.mortgagePayment,
  );
  state.mortgageBalance = mort.balance;
  state.inflationByYear[yearIndex] = market.inflation;
  return { market, mortgagePayment: mort.payment };
}

/**
 * Simulate the shared runway years 0..accessYear-1.
 * Mutates `state` and fills cashflowNominal[0..accessYear-1].
 */
export function simulateRunwayYears(state, params, pathCtx) {
  const accessYear = Math.max(0, Math.min(params.numYears | 0, params.accessYear | 0));
  // Index 0 = start of horizon (today), before any year elapses.
  recordResidual(state, 0);
  for (let y = 0; y < accessYear; y++) {
    const { mortgagePayment } = stepHouseholdYear(state, params, pathCtx, y);
    state.cashflowNominal[y] = -mortgagePayment;
    recordResidual(state, y + 1);
  }
  return state;
}

function initPathState(params) {
  const numYears = Math.max(1, params.numYears | 0);
  const balance = Math.max(0, Number(params.existingMortgageBalance) || 0);
  const term = Math.max(0, Number(params.existingMortgageTermYears) || 0);
  const rate = Math.max(0, Number(params.existingMortgageRate) || 0);
  const payment = amortizingAnnualPayment(balance, rate, term);
  return {
    homeValue: Math.max(0, Number(params.homeValue) || 0),
    mortgageBalance: balance,
    mortgagePayment: payment,
    portfolio: 0,
    creditLine: 0,
    drawnBalance: 0,
    sold: false,
    cashflowNominal: new Array(numYears).fill(0),
    portfolioNominalByYear: new Array(numYears + 1).fill(0),
    residualEquityNominalByYear: new Array(numYears + 1).fill(0),
    inflationByYear: new Array(numYears).fill(0),
    spendMetFlags: new Array(numYears).fill(false),
  };
}

function recordResidual(state, yearEndIndex) {
  // Residual home equity after liens (0 once sold).
  const equity = state.sold
    ? 0
    : Math.max(0, state.homeValue - state.mortgageBalance - state.drawnBalance);
  state.residualEquityNominalByYear[yearEndIndex] = equity;
  state.portfolioNominalByYear[yearEndIndex] = state.portfolio;
}

/**
 * Open a reverse-mortgage style line at access and run tenure/LOC draws.
 */
function simulateRmStrategy(params, pathCtx, kind) {
  const state = initPathState(params);
  const numYears = params.numYears | 0;
  const accessYear = Math.max(0, Math.min(numYears, params.accessYear | 0));
  simulateRunwayYears(state, params, pathCtx);

  if (accessYear >= numYears) {
    return finalizePath(state, params, accessYear);
  }

  // Access event: size the line from current home / liens.
  const ageAtAccess = (Number(params.currentAge) || 65) + accessYear;
  const lineGrowth = kind === 'simplifiedRm'
    ? Math.max(0, Number(params.simplifiedRmLineGrowth) || 0.03)
    : Math.max(0, Number(params.privateRmLineGrowth) || 0.04);
  const rmRate = kind === 'simplifiedRm'
    ? Math.max(0, Number(params.simplifiedRmRate) || 0.06)
    : Math.max(0, Number(params.privateRmRate) || 0.07);
  const mode = kind === 'simplifiedRm'
    ? (params.simplifiedRmMode === 'tenure' ? 'tenure' : 'loc')
    : (params.privateRmMode === 'tenure' ? 'tenure' : 'loc');

  let afterLien;
  if (kind === 'simplifiedRm') {
    // Calibrated HECM proceeds: MCA × published PLF − 2% initial MIP − other fee − lien.
    // Tenure/LOC draws below stay educational (not a full HECM payment engine).
    // Other fee = user % × MCA (closing/origination drag on top of fixed MIP).
    const feePct = Math.max(0, Number(params.simplifiedRmFeePct) || 0);
    const mca = Math.min(Math.max(0, state.homeValue), HECM_MCA_LIMIT);
    afterLien = sizeHecmProceeds({
      homeValue: state.homeValue,
      age: ageAtAccess,
      expectedRate: rmRate,
      mortgageBalance: state.mortgageBalance,
      otherFeeAmount: feePct * mca,
    }).netAvailable;
  } else {
    const proceedsPct = Math.max(0, Math.min(0.9, Number(params.privateRmProceedsPct) || 0.5));
    const feePct = Math.max(0, Number(params.privateRmFeePct) || 0.03);
    const netEquity = Math.max(0, state.homeValue - state.mortgageBalance);
    const principalLimit = netEquity * proceedsPct;
    const fees = principalLimit * feePct;
    // Pay off existing mortgage from the limit; remainder is the starting credit line.
    afterLien = Math.max(0, principalLimit - fees - state.mortgageBalance);
  }
  state.mortgageBalance = 0;
  state.mortgagePayment = 0;
  state.creditLine = afterLien;
  state.drawnBalance = 0;

  // Immediate liquidity: optional initial draw of available line (counts as access).
  const spendTargetReal = Math.max(0, Number(params.annualSpendTarget) || 0);
  let tenureDraw = 0;
  if (mode === 'tenure') {
    const yearsLeft = Math.max(1, numYears - accessYear);
    tenureDraw = state.creditLine / yearsLeft;
  }

  for (let y = accessYear; y < numYears; y++) {
    const { market } = stepHouseholdYear(state, params, pathCtx, y);
    // Credit line grows; outstanding balance accrues interest (reduces net available).
    state.creditLine *= 1 + lineGrowth;
    state.drawnBalance *= 1 + rmRate;
    const available = Math.max(0, state.creditLine - state.drawnBalance);

    // Convert this year's real spend target to nominal using cumulative inflation so far.
    let deflator = 1;
    for (let i = 0; i < y; i++) deflator *= 1 + (state.inflationByYear[i] || 0);
    const spendNominal = spendTargetReal * deflator;

    const draw = mode === 'tenure'
      ? Math.min(available, tenureDraw)
      : Math.min(available, spendNominal);
    state.drawnBalance += draw;
    state.cashflowNominal[y] = draw;
    state.spendMetFlags[y] = spendTargetReal <= 0 || draw + 1e-6 >= spendNominal;
    recordResidual(state, y + 1);
    void market;
  }

  return finalizePath(state, params, accessYear);
}

function simulateHelocStrategy(params, pathCtx) {
  const state = initPathState(params);
  const numYears = params.numYears | 0;
  const accessYear = Math.max(0, Math.min(numYears, params.accessYear | 0));
  simulateRunwayYears(state, params, pathCtx);

  if (accessYear >= numYears) return finalizePath(state, params, accessYear);

  const ltv = Math.max(0, Math.min(1, Number(params.helocLtv) || 0.75));
  const helocRate = Math.max(0, Number(params.helocRate) || 0.08);
  state.drawnBalance = 0;

  for (let y = accessYear; y < numYears; y++) {
    const { market, mortgagePayment } = stepHouseholdYear(state, params, pathCtx, y);
    // Max line tracks home value and first mortgage.
    const maxLine = Math.max(0, state.homeValue * ltv - state.mortgageBalance);
    state.drawnBalance *= 1 + helocRate;
    if (state.drawnBalance > maxLine) state.drawnBalance = maxLine;
    const available = Math.max(0, maxLine - state.drawnBalance);

    let deflator = 1;
    for (let i = 0; i < y; i++) deflator *= 1 + (state.inflationByYear[i] || 0);
    const spendNominal = Math.max(0, Number(params.annualSpendTarget) || 0) * deflator;
    const draw = Math.min(available, spendNominal);
    state.drawnBalance += draw;
    // Interest-only carry is already in drawnBalance growth; cashflow = draw − first-mortgage payment.
    state.cashflowNominal[y] = draw - mortgagePayment;
    state.spendMetFlags[y] = (Number(params.annualSpendTarget) || 0) <= 0
      || draw + 1e-6 >= spendNominal;
    recordResidual(state, y + 1);
    void market;
  }

  return finalizePath(state, params, accessYear);
}

function simulateCashOutInvest(params, pathCtx) {
  const state = initPathState(params);
  const numYears = params.numYears | 0;
  const accessYear = Math.max(0, Math.min(numYears, params.accessYear | 0));
  simulateRunwayYears(state, params, pathCtx);

  if (accessYear >= numYears) return finalizePath(state, params, accessYear);

  const cashOutLtv = Math.max(0, Math.min(0.95, Number(params.cashOutLtv) || 0.7));
  const newRate = Math.max(0, Number(params.cashOutRate) || 0.065);
  const newTerm = Math.max(1, Number(params.cashOutTermYears) || 30);
  const closingPct = Math.max(0, Number(params.cashOutClosingPct) || 0.02);

  // Access year: grow home/mortgage first, then refinance.
  const { market } = stepHouseholdYear(state, params, pathCtx, accessYear);
  const newLoan = state.homeValue * cashOutLtv;
  const closingCosts = newLoan * closingPct;
  const payoff = state.mortgageBalance;
  const netCash = Math.max(0, newLoan - payoff - closingCosts);
  state.mortgageBalance = newLoan;
  state.mortgagePayment = amortizingAnnualPayment(newLoan, newRate, newTerm);
  state.portfolio = netCash;
  state.cashflowNominal[accessYear] = netCash - state.mortgagePayment;
  state.spendMetFlags[accessYear] = netCash > 0;
  // Apply first year of portfolio growth after funding.
  state.portfolio *= 1 + market.portfolioReturn;
  recordResidual(state, accessYear + 1);

  for (let y = accessYear + 1; y < numYears; y++) {
    const yearAlloc = pathCtx.allocationSeries[y] || pathCtx.defaultAlloc;
    const mkt = sampleYearMarket(params, pathCtx, y, yearAlloc);
    state.inflationByYear[y] = mkt.inflation;
    const homeShock = drawHomeAppreciationShock(
      params.seed,
      pathCtx.pathIndex,
      y,
      params.homeShockStd,
    );
    state.homeValue *= 1 + nominalHomeGrowth(
      params.expectedRealAppreciation,
      homeShock,
      mkt.inflation,
    );
    const mort = advanceMortgageYear(
      state.mortgageBalance,
      newRate,
      state.mortgagePayment,
    );
    state.mortgageBalance = mort.balance;
    state.portfolio *= 1 + mkt.portfolioReturn;
    state.cashflowNominal[y] = -mort.payment;
    state.spendMetFlags[y] = true;
    recordResidual(state, y + 1);
  }

  return finalizePath(state, params, accessYear);
}

function simulateSellAndRent(params, pathCtx) {
  const state = initPathState(params);
  const numYears = params.numYears | 0;
  const accessYear = Math.max(0, Math.min(numYears, params.accessYear | 0));
  simulateRunwayYears(state, params, pathCtx);

  if (accessYear >= numYears) return finalizePath(state, params, accessYear);

  // Access year: appreciate through the year, then sell.
  const { market } = stepHouseholdYear(state, params, pathCtx, accessYear);
  const sale = computeSaleNetProceeds({
    homeValue: state.homeValue,
    mortgageBalance: state.mortgageBalance,
    basis: params.costBasis,
    exclusion: params.cgExclusion,
    cgRate: params.longTermCgRate,
    commissionPct: params.saleCommissionPct,
    otherClosingPct: params.saleOtherClosingPct,
  });
  state.portfolio = Math.max(0, sale.netToHousehold);
  state.mortgageBalance = 0;
  state.mortgagePayment = 0;
  state.homeValue = 0;
  state.sold = true;
  state.cashflowNominal[accessYear] = sale.netToHousehold;
  state.spendMetFlags[accessYear] = sale.netToHousehold > 0;
  state.portfolio *= 1 + market.portfolioReturn;
  recordResidual(state, accessYear + 1);

  const rentToday = Math.max(0, Number(params.annualRent) || 0);
  const rentRealGrowth = Number(params.realRentGrowth) || 0;

  for (let y = accessYear + 1; y < numYears; y++) {
    const yearAlloc = pathCtx.allocationSeries[y] || pathCtx.defaultAlloc;
    const mkt = sampleYearMarket(params, pathCtx, y, yearAlloc);
    state.inflationByYear[y] = mkt.inflation;
    // Rent starts as today’s dollars; escalate with cumulative inflation and real growth.
    let cumInf = 1;
    for (let i = 0; i < y; i++) cumInf *= 1 + (state.inflationByYear[i] || 0);
    const rentNominal = rentToday * cumInf * ((1 + rentRealGrowth) ** y);
    state.portfolio *= 1 + mkt.portfolioReturn;
    state.cashflowNominal[y] = -rentNominal;
    state.spendMetFlags[y] = true;
    recordResidual(state, y + 1);
  }

  return finalizePath(state, params, accessYear);
}

function finalizePath(state, params, accessYear) {
  const numYears = params.numYears | 0;
  const cashflowReal = deflateNominalSeries(state.cashflowNominal, state.inflationByYear);

  // Deflate portfolio / residual equity point series (start-of-path = year 0 today's $).
  const portfolioReal = new Array(numYears + 1);
  const residualReal = new Array(numYears + 1);
  portfolioReal[0] = state.portfolioNominalByYear[0] || 0;
  residualReal[0] = state.residualEquityNominalByYear[0] || 0;
  let deflator = 1;
  for (let y = 0; y < numYears; y++) {
    deflator *= 1 + (state.inflationByYear[y] || 0);
    portfolioReal[y + 1] = (state.portfolioNominalByYear[y + 1] || 0) / deflator;
    residualReal[y + 1] = (state.residualEquityNominalByYear[y + 1] || 0) / deflator;
  }

  let cumulative = 0;
  const cumulativeRealByYear = new Array(numYears);
  let extracted = 0;
  for (let y = 0; y < numYears; y++) {
    cumulative += cashflowReal[y];
    cumulativeRealByYear[y] = cumulative;
    if (cashflowReal[y] > 0) extracted += cashflowReal[y];
  }

  // Time-to-liquidity: first year at/after access with positive cash to household.
  let timeToLiquidity = null;
  for (let y = accessYear; y < numYears; y++) {
    if (cashflowReal[y] > 0) {
      timeToLiquidity = y;
      break;
    }
  }

  let met = 0;
  let counted = 0;
  for (let y = accessYear; y < numYears; y++) {
    counted += 1;
    if (state.spendMetFlags[y]) met += 1;
  }

  return {
    cashflowNominal: state.cashflowNominal,
    cashflowReal,
    cumulativeRealByYear,
    cumulativeRealCash: cumulative,
    totalRealCashExtracted: extracted,
    timeToLiquidity,
    spendMetFraction: counted > 0 ? met / counted : 1,
    portfolioReal,
    residualEquityReal: residualReal,
    endingResidualEquityReal: residualReal[numYears] || 0,
    endingPortfolioReal: portfolioReal[numYears] || 0,
    inflationByYear: state.inflationByYear,
  };
}

/**
 * Simulate one strategy for one MC path.
 */
export function simulateHouseEquityPath(params, strategyId, pathIndex) {
  const pathCtx = createPathContext(params, pathIndex);
  switch (strategyId) {
    case 'simplifiedRm':
      return simulateRmStrategy(params, pathCtx, 'simplifiedRm');
    case 'privateRm':
      return simulateRmStrategy(params, pathCtx, 'privateRm');
    case 'heloc':
      return simulateHelocStrategy(params, pathCtx);
    case 'cashOutInvest':
      return simulateCashOutInvest(params, pathCtx);
    case 'sellAndRent':
      return simulateSellAndRent(params, pathCtx);
    default:
      throw new Error(`Unknown house-equity strategy: ${strategyId}`);
  }
}

function pctBundle(values, p = [0.1, 0.5, 0.9]) {
  const sorted = values.slice().sort((a, b) => a - b);
  return {
    p10: percentileValue(sorted, p[0]),
    p50: percentileValue(sorted, p[1]),
    p90: percentileValue(sorted, p[2]),
  };
}

/**
 * Full House Equity Monte Carlo comparison across all five strategies.
 * @param {object} input
 * @param {{ onProgress?: Function }} [opts]
 */
export function runHouseEquityAnalysis(input, { onProgress } = {}) {
  const numYears = Math.max(1, Math.min(60, input.numYears | 0 || 25));
  const numSimulations = Math.max(1, input.numSimulations | 0 || 500);
  const accessYear = Math.max(0, Math.min(numYears, input.accessYear | 0));
  const seed = (input.seed >>> 0) || 0;

  const params = {
    ...input,
    numYears,
    numSimulations,
    accessYear,
    seed,
    homeShockStd: Number.isFinite(Number(input.homeShockStd))
      ? Number(input.homeShockStd)
      : HOME_APPRECIATION_SHOCK_STD,
    allocationSeries: input.allocationSeries || null,
  };

  /** @type {Record<string, object>} */
  const byStrategy = {};

  let step = 0;
  const totalSteps = STRATEGY_IDS.length * numSimulations;

  for (const strategyId of STRATEGY_IDS) {
    const paths = [];
    const extracted = [];
    const cumulative = [];
    const ttl = [];
    const sustain = [];
    const residual = [];
    const portfolioEnd = [];
    const cashPathMatrix = [];

    for (let i = 0; i < numSimulations; i++) {
      const path = simulateHouseEquityPath(params, strategyId, i);
      paths.push(path);
      extracted.push(path.totalRealCashExtracted);
      cumulative.push(path.cumulativeRealCash);
      if (path.timeToLiquidity != null) ttl.push(path.timeToLiquidity);
      sustain.push(path.spendMetFraction);
      residual.push(path.endingResidualEquityReal);
      portfolioEnd.push(path.endingPortfolioReal);
      cashPathMatrix.push(path.cumulativeRealByYear);
      step += 1;
      if (onProgress && (step % 32 === 0 || step === totalSteps)) {
        onProgress(step / totalSteps, `Simulating ${STRATEGY_LABELS[strategyId]}…`);
      }
    }

    // Median path by cumulative real cash (for cashflow export + charts).
    const cumSortedIdx = cumulative
      .map((v, i) => ({ v, i }))
      .sort((a, b) => a.v - b.v);
    const medianPath = paths[cumSortedIdx[Math.floor(cumSortedIdx.length / 2)].i];

    // Percentile bands for cumulative cash path.
    const cumP10 = new Array(numYears);
    const cumP50 = new Array(numYears);
    const cumP90 = new Array(numYears);
    for (let y = 0; y < numYears; y++) {
      const col = cashPathMatrix.map((row) => row[y]);
      const band = pctBundle(col);
      cumP10[y] = band.p10;
      cumP50[y] = band.p50;
      cumP90[y] = band.p90;
    }

    const portP = pctBundle(portfolioEnd);
    const hasPortfolio = strategyId === 'cashOutInvest' || strategyId === 'sellAndRent';

    byStrategy[strategyId] = {
      id: strategyId,
      label: STRATEGY_LABELS[strategyId],
      extracted: pctBundle(extracted),
      cumulativeCash: pctBundle(cumulative),
      timeToLiquidity: {
        p50: ttl.length ? median(ttl) : null,
        mean: ttl.length ? ttl.reduce((a, b) => a + b, 0) / ttl.length : null,
      },
      spendMetFraction: pctBundle(sustain).p50,
      residualEquity: pctBundle(residual),
      portfolioEnding: hasPortfolio ? portP : null,
      cumulativeCashPath: { p10: cumP10, p50: cumP50, p90: cumP90 },
      medianPath: {
        cashflowReal: medianPath.cashflowReal,
        cumulativeRealByYear: medianPath.cumulativeRealByYear,
        portfolioReal: medianPath.portfolioReal,
        residualEquityReal: medianPath.residualEquityReal,
      },
    };
  }

  // Rank by median cumulative real cash (early access favored when cash comes sooner
  // because cumulative sums reward earlier positive flows over the same horizon).
  const ranking = STRATEGY_IDS
    .map((id) => ({
      id,
      label: STRATEGY_LABELS[id],
      score: byStrategy[id].cumulativeCash.p50,
      extractedP50: byStrategy[id].extracted.p50,
      timeToLiquidityP50: byStrategy[id].timeToLiquidity.p50,
      residualP50: byStrategy[id].residualEquity.p50,
      spendMet: byStrategy[id].spendMetFraction,
    }))
    .sort((a, b) => b.score - a.score);

  const years = Array.from({ length: numYears }, (_, i) => i);
  /** @type {Record<string, { annual: number[] }>} */
  const seriesByStrategy = {};
  for (const id of STRATEGY_IDS) {
    seriesByStrategy[id] = {
      annual: byStrategy[id].medianPath.cashflowReal.slice(),
    };
  }

  const cashflowSeries = normalizeCashflowSeries(createEmptyCashflowSeries({
    sourceFeature: 'house-equity',
    sessionName: null,
    startAge: Number(input.currentAge) || 0,
    years,
    seriesByStrategy,
  }));

  return {
    meta: {
      numYears,
      numSimulations,
      accessYear,
      seed,
      returnMode: input.returnMode === 'market' ? 'market' : 'constant',
      homeShockStd: params.homeShockStd,
    },
    strategies: STRATEGY_IDS.map((id) => ({ id, label: STRATEGY_LABELS[id] })),
    byStrategy,
    ranking,
    comparisonBars: {
      cumulativeCash: STRATEGY_IDS.map((id) => ({
        id,
        label: STRATEGY_LABELS[id],
        ...byStrategy[id].cumulativeCash,
      })),
      timeToLiquidity: STRATEGY_IDS.map((id) => ({
        id,
        label: STRATEGY_LABELS[id],
        p50: byStrategy[id].timeToLiquidity.p50,
      })),
      extracted: STRATEGY_IDS.map((id) => ({
        id,
        label: STRATEGY_LABELS[id],
        ...byStrategy[id].extracted,
      })),
    },
    cashflowSeries,
  };
}

export { ALLOCATION_ENGINE_KEYS, allocationFromConfig };
