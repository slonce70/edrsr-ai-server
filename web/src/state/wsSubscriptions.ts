export type SubscribeFrame = {
  type: 'subscribe';
  jobId: string;
  workspaceId?: string;
};

/**
 * Build the list of `subscribe` frames to (re)send for the current set of
 * desired subscriptions. Used both for replay on (re)connect and as the
 * single source of truth for frame shape. A null/empty workspaceId is omitted.
 */
export function framesToReplay(subs: Map<string, string | null>): SubscribeFrame[] {
  const frames: SubscribeFrame[] = [];
  for (const [jobId, workspaceId] of subs) {
    frames.push({ type: 'subscribe', jobId, workspaceId: workspaceId || undefined });
  }
  return frames;
}
