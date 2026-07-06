// Maps the user's "core usage" preference to an actual worker count.
// Kept separate from the worker pool so UI and tests can share the same logic.

export function resolveNumCores(parallelCores, hardwareConcurrency) {
  const available = Math.max(1, hardwareConcurrency || 4);
  const MAX_SUB_WORKERS = 5;
  const cappedAvailable = Math.min(MAX_SUB_WORKERS, available - 1); // -1 to leave room for the master worker

  switch (parallelCores) {
    case 'low':
      // 1 means it runs synchronously on the master worker without spawning sub-workers
      return 1;
    case 'med':
      return Math.min(MAX_SUB_WORKERS, Math.max(1, Math.min(2, cappedAvailable)));
    case 'high':
    default:
      return Math.max(1, cappedAvailable);
  }
}
