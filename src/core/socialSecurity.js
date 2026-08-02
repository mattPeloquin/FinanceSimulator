// Social Security timing — deterministic educational model.
//
// Units: REAL / today's dollars everywhere. Benefits are constant in
// purchasing power (no COLA inflation modeling); this matches Withdraw.
//
// This is NOT an SSA manual. Rules are simplified for exploration:
//   - Own retired-worker benefit with standard early / delayed factors vs FRA
//   - Spousal add-on ≈ max(0, 50% × other PIA − own PIA) with a simple early haircut
//   - Survivor: when one person's planning end age is earlier, the survivor
//     receives max(own, deceased’s benefit at death) for remaining years
// No restricted application, file-and-suspend, or GPO/WEP.

import { ILLUSTRATIVE_BEND_POINTS } from '../data/ssBendPoints.js';
import { buildCashflowSeries, remapAgeCashflowToYears } from '../state/cashflowSeries.js';

export const CLAIM_AGE_MIN = 62;
export const CLAIM_AGE_MAX = 70;
export const DEFAULT_END_AGES = [80, 85, 90, 95];

/**
 * Full Retirement Age in years (fractional months as /12) from birth year.
 * Simplified: uses the common 66 / 66+months / 67 schedule.
 */
export function fraFromBirthYear(birthYear) {
  const y = Number(birthYear);
  if (!Number.isFinite(y)) return 67;
  if (y <= 1937) return 65;
  if (y <= 1954) {
    // 1938–1954: FRA rises from 65+2mo toward 66+something; approximate with 66.
    if (y <= 1942) return 65 + (y - 1937) * (2 / 12);
    if (y <= 1954) return 66;
  }
  if (y === 1955) return 66 + 2 / 12;
  if (y === 1956) return 66 + 4 / 12;
  if (y === 1957) return 66 + 6 / 12;
  if (y === 1958) return 66 + 8 / 12;
  if (y === 1959) return 66 + 10 / 12;
  return 67;
}

/**
 * Convert a Primary Insurance Amount (monthly at FRA) into the monthly benefit
 * at a chosen claim age using educational early-reduction / delayed-retirement
 * credit factors. Claim ages are in whole years for this explorer.
 *
 * Early (before FRA): ~5/9 of 1% per month for first 36 months, then 5/12 of 1%.
 * Delayed (after FRA): 2/3 of 1% per month (8% per year) up to age 70.
 *
 * @param {number} piaMonthly - PIA in real $/month at FRA
 * @param {number} claimAge - whole years, typically 62–70
 * @param {number} fra - full retirement age in years (may be fractional)
 * @returns {number} monthly benefit in real $
 */
export function ownBenefitAtClaimAge(piaMonthly, claimAge, fra) {
  const pia = Math.max(0, Number(piaMonthly) || 0);
  const claim = Number(claimAge);
  const full = Number(fra) || 67;
  if (!Number.isFinite(claim) || pia <= 0) return 0;

  // Months early or late relative to FRA (positive = early).
  const monthsFromFra = Math.round((full - claim) * 12);

  if (monthsFromFra === 0) return pia;

  if (monthsFromFra > 0) {
    // Claiming early reduces the benefit.
    const first36 = Math.min(36, monthsFromFra);
    const beyond = Math.max(0, monthsFromFra - 36);
    const reduction = first36 * (5 / 9) / 100 + beyond * (5 / 12) / 100;
    return pia * Math.max(0, 1 - reduction);
  }

  // Claiming late earns delayed retirement credits (capped at age 70).
  const monthsLate = Math.min(-monthsFromFra, Math.round((70 - full) * 12));
  const credit = monthsLate * (2 / 3) / 100;
  return pia * (1 + credit);
}

/**
 * Simplified spousal add-on on top of own benefit.
 * Educational formula: max(0, 0.5 × otherPIA − ownPIA), then apply a simple
 * early haircut if the recipient claims before their FRA
 * (about 25/36 of 1% per month early — a coarse stand-in for spousal reduction).
 *
 * @returns {number} monthly spousal add-on in real $ (0 if none)
 */
export function spousalAddonMonthly(ownPia, otherPia, claimAge, fra) {
  const raw = Math.max(0, 0.5 * Math.max(0, otherPia) - Math.max(0, ownPia));
  if (raw <= 0) return 0;
  const monthsEarly = Math.max(0, Math.round(((Number(fra) || 67) - Number(claimAge)) * 12));
  if (monthsEarly <= 0) return raw;
  const reduction = monthsEarly * (25 / 36) / 100;
  return raw * Math.max(0, 1 - reduction);
}

/**
 * Estimate PIA from an age→annual-earnings history using illustrative bend points.
 * AIME ≈ average of highest 35 years of real annual earnings / 12.
 * PIA ≈ 90% of AIME up to bend1/12 + 32% to bend2/12 + 15% above (monthly bends).
 *
 * @param {Array<{ age: number, earnings: number }>} earningsGrid - real $/year
 * @param {{ bend1?: number, bend2?: number }} [bendPoints] - annual thresholds
 * @returns {{ aime: number, piaMonthly: number, yearsUsed: number }}
 */
export function estimatePiaFromEarnings(earningsGrid, bendPoints = ILLUSTRATIVE_BEND_POINTS) {
  const earnings = (Array.isArray(earningsGrid) ? earningsGrid : [])
    .map((row) => Math.max(0, Number(row?.earnings) || 0))
    .filter((e) => e > 0)
    .sort((a, b) => b - a);

  // SSA uses up to 35 highest years; pad missing years with zeros.
  while (earnings.length < 35) earnings.push(0);
  const top35 = earnings.slice(0, 35);
  const yearsUsed = top35.filter((e) => e > 0).length;
  const averageAnnual = top35.reduce((s, e) => s + e, 0) / 35;
  const aime = averageAnnual / 12;

  const bend1Monthly = (bendPoints.bend1 || ILLUSTRATIVE_BEND_POINTS.bend1) / 12;
  const bend2Monthly = (bendPoints.bend2 || ILLUSTRATIVE_BEND_POINTS.bend2) / 12;

  // Three-bracket PIA formula (educational).
  let piaMonthly = 0;
  const first = Math.min(aime, bend1Monthly);
  piaMonthly += 0.9 * first;
  const second = Math.min(Math.max(0, aime - bend1Monthly), bend2Monthly - bend1Monthly);
  piaMonthly += 0.32 * second;
  const third = Math.max(0, aime - bend2Monthly);
  piaMonthly += 0.15 * third;

  return { aime, piaMonthly, yearsUsed };
}

/**
 * Build annual household benefit cashflows (real $) from claim through end age.
 *
 * Person shape: { piaMonthly, claimAge, fra, endAge, label? }
 * When `couple` is false / personB omitted, only person A is modeled.
 *
 * Survivor rule (simplified): if A’s endAge < B’s endAge, for ages after A’s
 * death B receives max(B’s own+spousal package at that time, A’s benefit at
 * death). Symmetric when B dies first.
 *
 * @returns {{ years: number[], annual: number[], byPerson: object, lifetime: number }}
 */
export function buildBenefitCashflow(personA, personB = null, { startAge = null } = {}) {
  const a = normalizePerson(personA, 'A');
  const b = personB ? normalizePerson(personB, 'B') : null;

  const householdEnd = Math.max(a.endAge, b ? b.endAge : a.endAge);
  const firstClaim = Math.min(a.claimAge, b ? b.claimAge : a.claimAge);
  const fromAge = startAge != null ? startAge : firstClaim;

  // Monthly own (+ spousal) packages at claim, constant in real dollars thereafter.
  const aOwn = ownBenefitAtClaimAge(a.piaMonthly, a.claimAge, a.fra);
  const bOwn = b ? ownBenefitAtClaimAge(b.piaMonthly, b.claimAge, b.fra) : 0;
  const aSpousal = b
    ? spousalAddonMonthly(a.piaMonthly, b.piaMonthly, a.claimAge, a.fra)
    : 0;
  const bSpousal = b
    ? spousalAddonMonthly(b.piaMonthly, a.piaMonthly, b.claimAge, b.fra)
    : 0;
  const aMonthly = aOwn + aSpousal;
  const bMonthly = bOwn + bSpousal;

  const years = [];
  const annual = [];
  const byPerson = { A: [], B: b ? [] : null };
  let lifetime = 0;

  for (let age = fromAge; age <= householdEnd; age++) {
    let aPay = 0;
    let bPay = 0;

    const aAlive = age <= a.endAge;
    const bAlive = b ? age <= b.endAge : false;

    if (aAlive && age >= a.claimAge) aPay = aMonthly * 12;
    if (b && bAlive && age >= b.claimAge) bPay = bMonthly * 12;

    // Survivor: after one dies, the living spouse may step up to the deceased's benefit.
    if (b) {
      if (!aAlive && bAlive && age > a.endAge) {
        // A has died; B gets max(own package, A's package at death).
        const survivorMonthly = Math.max(bMonthly, aMonthly);
        bPay = survivorMonthly * 12;
        aPay = 0;
      } else if (aAlive && !bAlive && age > b.endAge) {
        const survivorMonthly = Math.max(aMonthly, bMonthly);
        aPay = survivorMonthly * 12;
        bPay = 0;
      }
    }

    const total = aPay + bPay;
    years.push(age);
    annual.push(total);
    byPerson.A.push(aPay);
    if (b) byPerson.B.push(bPay);
    lifetime += total;
  }

  return {
    years,
    annual,
    byPerson,
    lifetime,
    meta: {
      aMonthly,
      bMonthly,
      aOwn,
      bOwn,
      aSpousal,
      bSpousal,
    },
  };
}

function normalizePerson(p, label) {
  return {
    label: p?.label || label,
    piaMonthly: Math.max(0, Number(p?.piaMonthly) || 0),
    claimAge: clampClaimAge(p?.claimAge),
    fra: Number(p?.fra) || 67,
    endAge: Math.max(CLAIM_AGE_MIN, Math.min(120, Number(p?.endAge) || 90)),
  };
}

export function clampClaimAge(age) {
  const n = Number(age);
  if (!Number.isFinite(n)) return CLAIM_AGE_MIN;
  return Math.max(CLAIM_AGE_MIN, Math.min(CLAIM_AGE_MAX, Math.round(n)));
}

/**
 * Evaluate one claim strategy across an end-age strip.
 * @param {object} personA
 * @param {object|null} personB
 * @param {number[]} endAges
 * @returns {{ id, label, claimA, claimB, byEndAge: Record<number, { lifetime }>, cashflowAt: Function }}
 */
export function evaluateStrategy(strategy, personA, personB, endAges = DEFAULT_END_AGES) {
  const claimA = clampClaimAge(strategy.claimA ?? personA.claimAge);
  const claimB = personB
    ? clampClaimAge(strategy.claimB ?? personB.claimAge)
    : null;

  const byEndAge = {};
  for (const endAge of endAges) {
    // Strip always forces both persons to the same end age so rankings are
    // comparable. Per-person planning ends are used only for the primary view.
    const ranked = buildBenefitCashflow(
      { ...personA, claimAge: claimA, endAge },
      personB ? { ...personB, claimAge: claimB, endAge } : null,
    );
    byEndAge[endAge] = {
      lifetime: ranked.lifetime,
      cashflow: ranked,
    };
  }

  return {
    id: strategy.id || `${claimA}-${claimB ?? 'x'}`,
    label: strategy.label || (claimB != null ? `A@${claimA} / B@${claimB}` : `Claim @ ${claimA}`),
    claimA,
    claimB,
    byEndAge,
  };
}

/**
 * Named strategy set + optional user custom strategies.
 */
export function defaultNamedStrategies(personA, personB) {
  const fraA = Math.round(personA.fra || 67);
  const fraB = personB ? Math.round(personB.fra || 67) : fraA;
  if (!personB) {
    return [
      { id: 'early', label: 'Claim at 62', claimA: 62 },
      { id: 'fra', label: `Claim at FRA (${fraA})`, claimA: fraA },
      { id: 'delay70', label: 'Claim at 70', claimA: 70 },
    ];
  }
  return [
    { id: 'both-early', label: 'Both at 62', claimA: 62, claimB: 62 },
    { id: 'both-fra', label: 'Both at FRA', claimA: fraA, claimB: fraB },
    { id: 'both-70', label: 'Both at 70', claimA: 70, claimB: 70 },
    {
      id: 'split',
      label: 'Split (higher earner @ 70)',
      claimA: personA.piaMonthly >= personB.piaMonthly ? 70 : 62,
      claimB: personA.piaMonthly >= personB.piaMonthly ? 62 : 70,
    },
  ];
}

/**
 * Claim-age grid: yearly 62–70 for A (and B when couple).
 * @returns {{ cells: Array<{ claimA, claimB, byEndAge }>, claimAges: number[] }}
 */
export function evaluateClaimGrid(personA, personB, endAges = DEFAULT_END_AGES) {
  const claimAges = [];
  for (let age = CLAIM_AGE_MIN; age <= CLAIM_AGE_MAX; age++) claimAges.push(age);

  const cells = [];
  if (!personB) {
    for (const claimA of claimAges) {
      cells.push(evaluateStrategy(
        { id: `grid-${claimA}`, label: `@${claimA}`, claimA },
        personA,
        null,
        endAges,
      ));
    }
  } else {
    for (const claimA of claimAges) {
      for (const claimB of claimAges) {
        cells.push(evaluateStrategy(
          { id: `grid-${claimA}-${claimB}`, label: `${claimA}/${claimB}`, claimA, claimB },
          personA,
          personB,
          endAges,
        ));
      }
    }
  }
  return { cells, claimAges };
}

/**
 * For each end age, rank strategies by lifetime benefits and note the winner.
 * Also detect ranking flips across the strip.
 */
export function summarizeEndAgeStrip(strategies, endAges = DEFAULT_END_AGES) {
  const byEndAge = {};
  let previousWinner = null;
  const flips = [];

  for (const endAge of endAges) {
    const ranked = [...strategies]
      .map((s) => ({
        id: s.id,
        label: s.label,
        lifetime: s.byEndAge[endAge]?.lifetime ?? 0,
      }))
      .sort((a, b) => b.lifetime - a.lifetime);

    const winner = ranked[0] || null;
    byEndAge[endAge] = { ranked, winner };
    if (previousWinner && winner && previousWinner.id !== winner.id) {
      flips.push({
        endAge,
        from: previousWinner,
        to: winner,
      });
    }
    previousWinner = winner;
  }

  return { byEndAge, flips };
}

/**
 * Break-even: for two strategies, find the earliest end age (integer) where
 * the later-claim strategy's cumulative lifetime exceeds the earlier one.
 * Uses a fine scan from min claim to max end age at the primary (first) strip end.
 */
export function breakEvenEndAge(earlyStrategy, lateStrategy, personA, personB, {
  scanFrom = 70,
  scanTo = 100,
} = {}) {
  let crossover = null;
  for (let endAge = scanFrom; endAge <= scanTo; endAge++) {
    const early = evaluateStrategy(earlyStrategy, personA, personB, [endAge]);
    const late = evaluateStrategy(lateStrategy, personA, personB, [endAge]);
    const eLife = early.byEndAge[endAge].lifetime;
    const lLife = late.byEndAge[endAge].lifetime;
    if (lLife >= eLife) {
      crossover = { endAge, earlyLifetime: eLife, lateLifetime: lLife };
      break;
    }
  }
  return crossover;
}

/**
 * Lifetime after-tax benefits under one policy-shock path (for MC summaries).
 */
export function shockedLifetime(annualBenefits, taxRate, benefitMultiplier) {
  let total = 0;
  for (let i = 0; i < annualBenefits.length; i++) {
    const cut = benefitMultiplier(i);
    total += Math.max(0, annualBenefits[i]) * cut * (1 - taxRate);
  }
  return total;
}

/**
 * Run the full deterministic SS timing analysis.
 */
export function runDeterministicSsAnalysis(input) {
  const endAges = Array.isArray(input.endAges) && input.endAges.length
    ? input.endAges.map((n) => Math.round(Number(n))).filter((n) => n >= 70 && n <= 120)
    : [...DEFAULT_END_AGES];

  const personA = {
    piaMonthly: Number(input.personA?.piaMonthly) || 0,
    fra: Number(input.personA?.fra) || fraFromBirthYear(input.personA?.birthYear),
    claimAge: clampClaimAge(input.personA?.claimAge ?? 67),
    planningEndAge: input.personA?.planningEndAge != null
      ? Number(input.personA.planningEndAge)
      : null,
    label: input.personA?.label || 'Person A',
  };

  let personB = null;
  if (input.couple && input.personB) {
    personB = {
      piaMonthly: Number(input.personB?.piaMonthly) || 0,
      fra: Number(input.personB?.fra) || fraFromBirthYear(input.personB?.birthYear),
      claimAge: clampClaimAge(input.personB?.claimAge ?? 67),
      planningEndAge: input.personB?.planningEndAge != null
        ? Number(input.personB.planningEndAge)
        : null,
      label: input.personB?.label || 'Person B',
    };
  }

  const named = defaultNamedStrategies(personA, personB);
  const custom = Array.isArray(input.customStrategies) ? input.customStrategies : [];
  const strategyDefs = [...named, ...custom];

  const strategies = strategyDefs.map((s) =>
    evaluateStrategy(s, personA, personB, endAges));

  const strip = summarizeEndAgeStrip(strategies, endAges);
  const grid = evaluateClaimGrid(personA, personB, endAges);

  // Break-even between both-early and both-70 (or single early vs 70).
  const earlyDef = strategyDefs.find((s) => s.id === 'both-early' || s.id === 'early');
  const lateDef = strategyDefs.find((s) => s.id === 'both-70' || s.id === 'delay70');
  const breakEven = earlyDef && lateDef
    ? breakEvenEndAge(earlyDef, lateDef, personA, personB)
    : null;

  return {
    personA,
    personB,
    endAges,
    strategies,
    strip,
    grid,
    breakEven,
  };
}

/**
 * Build a cashflow series from a deterministic SS result (benefit streams).
 *
 * @param {object} deterministic - from runDeterministicSsAnalysis
 * @param {{
 *   startAge?: number,
 *   primaryEnd?: number,
 *   sessionName?: string|null,
 * }} [opts]
 */
export function buildSsCashflowSeries(deterministic, opts = {}) {
  const startAge = Number(opts.startAge) || 62;
  const endAges = Array.isArray(deterministic?.endAges) ? deterministic.endAges : DEFAULT_END_AGES;
  const primaryEnd = Number(opts.primaryEnd)
    || endAges[endAges.length - 2]
    || endAges[endAges.length - 1]
    || 90;
  const numYears = Math.max(1, primaryEnd - startAge + 1);
  /** @type {Record<string, number[]>} */
  const annualByStrategy = {};
  for (const strategy of deterministic?.strategies || []) {
    const flow = strategy?.byEndAge?.[primaryEnd]?.cashflow;
    if (!flow) continue;
    annualByStrategy[strategy.id] = remapAgeCashflowToYears(flow, startAge, numYears);
  }
  return buildCashflowSeries({
    sourceFeature: 'ss-timing',
    startAge,
    sessionName: opts.sessionName ?? null,
    numYears,
    annualByStrategy,
  });
}
