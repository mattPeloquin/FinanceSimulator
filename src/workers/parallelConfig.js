// Maps the user's "core usage" preference to an actual worker count.
// Kept separate from the worker pool so UI and tests can share the same logic.

export function resolveNumCores(parallelCores, hardwareConcurrency) {
  const available = Math.max(1, hardwareConcurrency || 4);
  switch (parallelCores) {
    case 'low':
      return 1;
    case 'med':
      return Math.max(1, Math.floor(available / 2));
    case 'high':
    default:
      return available;
  }
}
