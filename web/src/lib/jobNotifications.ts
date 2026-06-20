import { ACTIVE_STATUS_KEYS } from './overviewStats';

// Pure tracking logic for the global "analysis finished" notification.
//
// We only want to toast for a job the user is plausibly waiting on THIS session.
// Since the overview endpoint only returns counts (no job ids), we seed the
// tracked set from live WS updates: any update showing an ACTIVE status marks
// the job as tracked. When a tracked job transitions to `completed`, we emit a
// single notify (and drop it from the set so it cannot double-fire). Jobs that
// were already completed when first seen are never tracked, so they never toast.

const ACTIVE_STATUSES: ReadonlySet<string> = new Set(ACTIVE_STATUS_KEYS);

export type JobEvent = {
  id?: string;
  status?: string;
  title?: string;
};

export type JobNotifyState = {
  // Job ids observed in an active state during this session.
  tracked: Set<string>;
};

export type JobNotification = {
  jobId: string;
  title: string;
};

export type ReduceResult = {
  state: JobNotifyState;
  notify?: JobNotification;
};

export function createJobNotifyState(): JobNotifyState {
  return { tracked: new Set<string>() };
}

export function reduceJobEvent(state: JobNotifyState, event: JobEvent): ReduceResult {
  const jobId = typeof event.id === 'string' ? event.id : '';
  const status = typeof event.status === 'string' ? event.status : '';
  if (!jobId || !status) return { state };

  if (ACTIVE_STATUSES.has(status)) {
    // Mutating the existing Set is fine here — the state object is owned by the
    // caller's ref. We return the same reference for a simple, allocation-free
    // reducer that is still trivial to unit test.
    state.tracked.add(jobId);
    return { state };
  }

  if (status === 'completed' && state.tracked.has(jobId)) {
    state.tracked.delete(jobId);
    return { state, notify: { jobId, title: typeof event.title === 'string' ? event.title : '' } };
  }

  return { state };
}
