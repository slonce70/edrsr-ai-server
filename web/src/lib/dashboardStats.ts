export type JobStats = {
  total: number;
  completed: number;
  error: number;
  active: number;
};

function safe(n: number) {
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function computeJobStats(input: {
  total: number;
  completed: number;
  error: number;
}): JobStats {
  const total = safe(input.total);
  const completed = safe(input.completed);
  const error = safe(input.error);
  return {
    total,
    completed,
    error,
    active: Math.max(0, total - completed - error),
  };
}
