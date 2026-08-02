// Named Lifetime Plan Easy Mode presets.

/**
 * @returns {{ id: string, name: string, description: string, patch: object }[]}
 */
export function getPlanPresets() {
  const year = new Date().getFullYear();
  return [
    {
      id: 'working-years',
      name: 'Working Years',
      description: 'Focus on the accumulation window — next 25 years from today.',
      patch: {
        planStartYear: year,
        planEndYear: year + 25,
        birthYearA: 1975,
        birthYearB: null,
        refreshSims: 200,
      },
    },
    {
      id: 'early-retirement',
      name: 'Early Retirement',
      description: 'Broader horizon covering claim ages and early retirement cashflows.',
      patch: {
        planStartYear: year,
        planEndYear: year + 40,
        birthYearA: 1965,
        birthYearB: 1967,
        refreshSims: 200,
      },
    },
    {
      id: 'late-retirement',
      name: 'Late Retirement',
      description: 'Longer late-life window with an older household anchor.',
      patch: {
        planStartYear: year,
        planEndYear: year + 35,
        birthYearA: 1955,
        birthYearB: 1957,
        refreshSims: 200,
      },
    },
  ];
}
