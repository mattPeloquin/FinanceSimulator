// Named Accumulation presets (feature-local; never write back to Plan risk presets).

/** @typedef {import('./session.js').AccumulationState} AccumulationState */

const BALANCED_MIX = {
  usLgGrowthAllocation: 25,
  usLgValueAllocation: 25,
  usSmMidAllocation: 10,
  exUsAllocation: 15,
  bondAllocation: 20,
  cashAllocation: 5,
};

const AGGRESSIVE_MIX = {
  usLgGrowthAllocation: 30,
  usLgValueAllocation: 25,
  usSmMidAllocation: 15,
  exUsAllocation: 20,
  bondAllocation: 8,
  cashAllocation: 2,
};

/**
 * @returns {{ id: string, name: string, description: string, patch: Partial<AccumulationState> }[]}
 */
export function getAccumulationPresets() {
  return [
    {
      id: 'steady-saver',
      name: 'Steady Saver',
      description: 'Balanced mix, steady real contributions for two decades.',
      patch: {
        numYears: 20,
        afterTaxDragRate: 0.15,
        allocation: { ...BALANCED_MIX },
        allocationOverTimeTiers: [{ ...BALANCED_MIX }],
        sleeves: {
          ira: {
            startBalance: 50,
            contributionTiers: [
              { amount: 7, growthPct: 2, years: 10 },
              { amount: 7, growthPct: 2 },
            ],
          },
          roth: {
            startBalance: 25,
            contributionTiers: [
              { amount: 5, growthPct: 2, years: 10 },
              { amount: 5, growthPct: 2 },
            ],
          },
          afterTax: {
            startBalance: 20,
            basis: 20,
            contributionTiers: [
              { amount: 3, growthPct: 1, years: 10 },
              { amount: 3, growthPct: 1 },
            ],
          },
        },
        events: [],
      },
    },
    {
      id: 'aggressive-builder',
      name: 'Aggressive Builder',
      description: 'Higher equity and front-loaded contributions.',
      patch: {
        numYears: 25,
        afterTaxDragRate: 0.15,
        allocation: { ...AGGRESSIVE_MIX },
        allocationOverTimeTiers: [
          { ...AGGRESSIVE_MIX, years: 15 },
          {
            usLgGrowthAllocation: 20,
            usLgValueAllocation: 20,
            usSmMidAllocation: 10,
            exUsAllocation: 15,
            bondAllocation: 30,
            cashAllocation: 5,
          },
        ],
        sleeves: {
          ira: {
            startBalance: 40,
            contributionTiers: [
              { amount: 10, growthPct: 3, years: 8 },
              { amount: 8, growthPct: 1 },
            ],
          },
          roth: {
            startBalance: 30,
            contributionTiers: [
              { amount: 7, growthPct: 3, years: 8 },
              { amount: 6, growthPct: 1 },
            ],
          },
          afterTax: {
            startBalance: 15,
            basis: 15,
            contributionTiers: [
              { amount: 5, growthPct: 2, years: 8 },
              { amount: 4, growthPct: 0 },
            ],
          },
        },
        events: [],
      },
    },
    {
      id: 'catch-up',
      name: 'Catch-Up',
      description: 'Shorter horizon with larger annual savings.',
      patch: {
        numYears: 12,
        afterTaxDragRate: 0.18,
        allocation: { ...BALANCED_MIX },
        allocationOverTimeTiers: [{ ...BALANCED_MIX }],
        sleeves: {
          ira: {
            startBalance: 80,
            contributionTiers: [{ amount: 12, growthPct: 0 }],
          },
          roth: {
            startBalance: 40,
            contributionTiers: [{ amount: 8, growthPct: 0 }],
          },
          afterTax: {
            startBalance: 30,
            basis: 30,
            contributionTiers: [{ amount: 6, growthPct: 0 }],
          },
        },
        events: [
          { amount: -40, startYear: 6, years: 1 },
        ],
      },
    },
  ];
}
