// Named House Equity Easy Mode presets.
// Money patch fields are $000s; rate fields are percents (Plan convention).

/**
 * @returns {{ id: string, name: string, description: string, patch: object }[]}
 */
export function getHouseEquityPresets() {
  return [
    {
      id: 'access-now',
      name: 'Access Now',
      description: 'Leverage immediately (access year 0); LOC-style calibrated HECM; modest spend target.',
      patch: {
        accessYear: 0,
        homeValue: 800,
        costBasis: 350,
        existingMortgageBalance: 200,
        existingMortgageRate: 4,
        existingMortgageTermYears: 15,
        annualSpendTarget: 30,
        numYears: 25,
        simplifiedRmMode: 'loc',
        simplifiedRmRate: 6,
        annualRent: 36,
      },
    },
    {
      id: 'cash-out-invest',
      name: 'Cash-Out & Invest',
      description: 'Wait a few years, then refinance and invest the cash-out proceeds.',
      patch: {
        accessYear: 5,
        homeValue: 900,
        costBasis: 400,
        existingMortgageBalance: 250,
        existingMortgageRate: 4.5,
        existingMortgageTermYears: 20,
        annualSpendTarget: 0,
        cashOutLtv: 70,
        cashOutRate: 6.5,
        cashOutTermYears: 30,
        numYears: 25,
        annualRent: 40,
      },
    },
    {
      id: 'sell-rent-bridge',
      name: 'Sell & Rent Bridge',
      description: 'Keep paying the mortgage for several years, then sell, invest net proceeds, and rent.',
      patch: {
        accessYear: 7,
        homeValue: 850,
        costBasis: 300,
        existingMortgageBalance: 180,
        existingMortgageRate: 3.8,
        existingMortgageTermYears: 12,
        annualSpendTarget: 0,
        annualRent: 42,
        realRentGrowth: 0,
        saleCommissionPct: 5,
        saleOtherClosingPct: 2,
        numYears: 25,
      },
    },
  ];
}
