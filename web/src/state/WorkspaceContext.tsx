/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../lib/api';
import { useAuth } from './AuthContext';

const STORAGE_KEY = 'edrsr-ai-workspace';

export type Workspace = {
  id: string;
  name: string;
  owner_user_id?: string | null;
  role?: string | null;
  member_count?: number | null;
};

type WorkspaceResponse = {
  success: boolean;
  workspaces: Workspace[];
  active_workspace_id?: string | null;
};

type WorkspaceContextValue = {
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  isLoading: boolean;
  error: string | null;
  setActiveWorkspaceId: (id: string | null) => void;
  refreshWorkspaces: () => Promise<void>;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const { accessToken } = useAuth();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshWorkspaces = useCallback(async () => {
    if (!accessToken) return;
    setIsLoading(true);
    setError(null);
    try {
      const data = await apiRequest<WorkspaceResponse>('/workspaces', { token: accessToken });
      const list = data.workspaces || [];
      setWorkspaces(list);

      const stored =
        typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null;
      const storedValid = stored && list.some((ws) => ws.id === stored) ? stored : null;
      const fallback = data.active_workspace_id || list[0]?.id || null;
      const nextActive = storedValid || fallback;
      setActiveWorkspaceId(nextActive || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load workspaces');
      setWorkspaces([]);
      setActiveWorkspaceId(null);
    } finally {
      setIsLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken) {
      setWorkspaces([]);
      setActiveWorkspaceId(null);
      return;
    }
    refreshWorkspaces();
  }, [accessToken, refreshWorkspaces]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (activeWorkspaceId) {
      window.localStorage.setItem(STORAGE_KEY, activeWorkspaceId);
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }, [activeWorkspaceId]);

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      workspaces,
      activeWorkspaceId,
      isLoading,
      error,
      setActiveWorkspaceId,
      refreshWorkspaces,
    }),
    [workspaces, activeWorkspaceId, isLoading, error, refreshWorkspaces]
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace must be used inside WorkspaceProvider');
  return ctx;
}
