// Named Social Security Easy Mode presets.

/**
 * @returns {{ id: string, name: string, description: string, patch: object }[]}
 */
export function getSsTimingPresets() {
  return [
    {
      id: 'both-delay',
      name: 'Both Delay to 70',
      description: 'Couple; higher PIAs; both claim at 70 to maximize delayed credits.',
      patch: {
        couple: true,
        personA: {
          label: 'Person A',
          birthYear: 1960,
          currentAge: 62,
          piaMonthly: 2800,
          claimAge: 70,
          planningEndAge: null,
        },
        personB: {
          label: 'Person B',
          birthYear: 1962,
          currentAge: 60,
          piaMonthly: 1800,
          claimAge: 70,
          planningEndAge: null,
        },
        bridge: {
          enabled: true,
          startBalance: 400000,
          annualSpend: 0,
        },
      },
    },
    {
      id: 'both-early',
      name: 'Both Claim Early',
      description: 'Couple claims at 62 — useful baseline for opportunity-cost comparisons.',
      patch: {
        couple: true,
        personA: {
          label: 'Person A',
          birthYear: 1960,
          currentAge: 62,
          piaMonthly: 2800,
          claimAge: 62,
          planningEndAge: null,
        },
        personB: {
          label: 'Person B',
          birthYear: 1962,
          currentAge: 60,
          piaMonthly: 1800,
          claimAge: 62,
          planningEndAge: null,
        },
        bridge: {
          enabled: true,
          startBalance: 400000,
          annualSpend: 0,
        },
      },
    },
    {
      id: 'split-delay',
      name: 'Split (higher earner delays)',
      description: 'Higher earner waits until 70; lower earner claims at 62.',
      patch: {
        couple: true,
        personA: {
          label: 'Person A',
          birthYear: 1960,
          currentAge: 62,
          piaMonthly: 3000,
          claimAge: 70,
          planningEndAge: null,
        },
        personB: {
          label: 'Person B',
          birthYear: 1962,
          currentAge: 60,
          piaMonthly: 1400,
          claimAge: 62,
          planningEndAge: null,
        },
        bridge: {
          enabled: true,
          startBalance: 350000,
          annualSpend: 0,
        },
      },
    },
  ];
}
