// Named Roth Convert Easy Mode presets.
// Money patch fields are $000s (Plan convention).

/**
 * @returns {{ id: string, name: string, description: string, patch: object }[]}
 */
export function getRothConvertPresets() {
  return [
    {
      id: 'fill-22',
      name: 'Fill 22% Band',
      description: 'Convert each year up to the illustrative 22% tier; pay tax from taxable.',
      patch: {
        fillTierRate: 0.22,
        annualConversionCap: 0,
        taxPayment: 'fromTaxable',
        ratePremium: 0.02,
        taxNoiseStd: 0.03,
        tradBalance: 800,
        rothBalance: 100,
        taxableBalance: 200,
        taxableBasis: 150,
        otherTaxableIncome: 40,
        numYears: 20,
      },
    },
    {
      id: 'aggressive',
      name: 'Aggressive Convert',
      description: 'Fill toward the 24% band with higher rate-premium (pessimistic future taxes).',
      patch: {
        fillTierRate: 0.24,
        annualConversionCap: 0,
        taxPayment: 'fromTaxable',
        ratePremium: 0.05,
        taxNoiseStd: 0.04,
        tradBalance: 1200,
        rothBalance: 50,
        taxableBalance: 250,
        taxableBasis: 180,
        otherTaxableIncome: 30,
        numYears: 15,
      },
    },
    {
      id: 'baseline-focus',
      name: 'Minimal / Baseline Focus',
      description: 'Modest Trad balance and low premium — useful to see when $0 conversion wins.',
      patch: {
        fillTierRate: 0.22,
        annualConversionCap: 25,
        taxPayment: 'fromTaxable',
        ratePremium: 0,
        taxNoiseStd: 0.02,
        tradBalance: 400,
        rothBalance: 200,
        taxableBalance: 100,
        taxableBasis: 80,
        otherTaxableIncome: 60,
        numYears: 25,
      },
    },
  ];
}
