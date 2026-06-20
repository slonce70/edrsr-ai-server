/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { apiRequest } from '../lib/api';
import { activeCount as computeActiveCount } from '../lib/overviewStats';
import type { Overview } from '../types/api';
import { useAuth } from './AuthContext';
import { useWebSocket } from './WebSocketContext';
import { useWorkspace } from './WorkspaceContext';

type OverviewResponse = {
  success: boolean;
  overview: Overview;
};

// At most one overview refresh per this window when WS updates stream in.
const REFRESH_THROTTLE_MS = 4000;

type OverviewContextValue = {
  overview: Overview | null;
  activeCount: number;
  refresh: () => void;
};

const OverviewContext = createContext<OverviewContextValue | null>(null);

// Lightweight, non-critical provider feeding the persistent active-jobs chip.
// It fetches /overview once on mount (and on workspace change) and refreshes —
// throttled — whenever a WS job-status update arrives. All fetches are guarded:
// aborted on unmount and errors swallowed silently (the chip is best-effort).
export function OverviewProvider({ children }: { children: React.ReactNode }) {
  const { accessToken } = useAuth();
  const { activeWorkspaceId } = useWorkspace();
  const { onJobUpdate } = useWebSocket();
  const [overview, setOverview] = useState<Overview | null>(null);

  const tokenRef = useRef(accessToken);
  const workspaceRef = useRef(activeWorkspaceId);
  const lastFetchRef = useRef(0);
  const pendingRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  // Keep the latest auth/workspace available to the stable doFetch callback
  // without forcing it to re-create (which would reset the throttle timers).
  useEffect(() => {
    tokenRef.current = accessToken;
    workspaceRef.current = activeWorkspaceId;
  }, [accessToken, activeWorkspaceId]);

  const doFetch = useCallback(async () => {
    const token = tokenRef.current;
    if (!token) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    lastFetchRef.current = Date.now();
    try {
      const res = await apiRequest<OverviewResponse>('/overview', {
        token,
        workspaceId: workspaceRef.current || undefined,
        signal: controller.signal,
      });
      if (!mountedRef.current) return;
      setOverview(res?.overview ?? null);
    } catch {
      // Non-critical chip: ignore aborts and network errors silently.
    }
  }, []);

  // Refresh, throttled to at most once per REFRESH_THROTTLE_MS. Calls that land
  // inside the window are coalesced into a single trailing fetch.
  const refresh = useCallback(() => {
    const elapsed = Date.now() - lastFetchRef.current;
    if (elapsed >= REFRESH_THROTTLE_MS) {
      void doFetch();
      return;
    }
    if (pendingRef.current != null) return;
    pendingRef.current = window.setTimeout(() => {
      pendingRef.current = null;
      void doFetch();
    }, REFRESH_THROTTLE_MS - elapsed);
  }, [doFetch]);

  // Initial fetch + refetch when auth or workspace changes.
  useEffect(() => {
    mountedRef.current = true;
    if (accessToken) void doFetch();
    else setOverview(null);
    return () => {
      // Allow refetch on the next effect run; cleanup of timers/aborts handled below.
    };
  }, [accessToken, activeWorkspaceId, doFetch]);

  // Refresh on any WS job-status update.
  useEffect(() => {
    return onJobUpdate(() => {
      refresh();
    });
  }, [onJobUpdate, refresh]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
      if (pendingRef.current != null) {
        window.clearTimeout(pendingRef.current);
        pendingRef.current = null;
      }
    };
  }, []);

  const activeCount = useMemo(
    () => (overview ? computeActiveCount(overview.statusCounts) : 0),
    [overview]
  );

  const value = useMemo<OverviewContextValue>(
    () => ({ overview, activeCount, refresh }),
    [overview, activeCount, refresh]
  );

  return <OverviewContext.Provider value={value}>{children}</OverviewContext.Provider>;
}

export function useOverview() {
  const ctx = useContext(OverviewContext);
  if (!ctx) throw new Error('useOverview must be used inside OverviewProvider');
  return ctx;
}
