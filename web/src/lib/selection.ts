// Immutable helpers over a Set<string> used for per-page row selection.
// Every mutating helper returns a fresh Set so React state updates stay pure.

export function toggle(set: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(set);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  return next;
}

export function selectAll(set: ReadonlySet<string>, ids: string[]): Set<string> {
  const next = new Set(set);
  ids.forEach((id) => next.add(id));
  return next;
}

export function clear(): Set<string> {
  return new Set<string>();
}

export function isAllSelected(set: ReadonlySet<string>, ids: string[]): boolean {
  if (ids.length === 0) return false;
  return ids.every((id) => set.has(id));
}

export function intersect(set: ReadonlySet<string>, validIds: string[]): Set<string> {
  const valid = new Set(validIds);
  const next = new Set<string>();
  set.forEach((id) => {
    if (valid.has(id)) next.add(id);
  });
  return next;
}
