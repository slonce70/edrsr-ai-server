/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { getWsUrl } from '../lib/config';
import { framesToReplay } from './wsSubscriptions';
import { useAuth } from './AuthContext';

type JobUpdatePayload = Record<string, unknown> & { id?: string; type?: string };

type WebSocketContextValue = {
  clientId: string | null;
  status: 'disconnected' | 'connecting' | 'connected';
  subscribe: (jobId: string, workspaceId?: string | null) => void;
  unsubscribe: (jobId: string) => void;
  onJobUpdate: (handler: (payload: JobUpdatePayload) => void) => () => void;
};

const WebSocketContext = createContext<WebSocketContextValue | null>(null);

export function WebSocketProvider({ children }: { children: React.ReactNode }) {
  const { accessToken } = useAuth();
  const [clientId, setClientId] = useState<string | null>(null);
  const [status, setStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const wsRef = useRef<WebSocket | null>(null);
  const listenersRef = useRef(new Set<(payload: JobUpdatePayload) => void>());
  const subscriptionsRef = useRef(new Map<string, string | null>());
  const sentRef = useRef(new Set<string>());
  const retryDelayRef = useRef(2000);
  const reconnectRef = useRef<number | null>(null);
  const connectRef = useRef<(() => void) | null>(null);

  const notify = useCallback((payload: JobUpdatePayload) => {
    listenersRef.current.forEach((handler) => handler(payload));
  }, []);

  const cleanupSocket = useCallback(() => {
    if (reconnectRef.current) {
      window.clearTimeout(reconnectRef.current);
      reconnectRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setStatus('disconnected');
  }, []);

  const connect = useCallback(() => {
    if (!accessToken) return;
    if (wsRef.current && wsRef.current.readyState <= 1) return;

    const wsUrl = getWsUrl();
    if (!wsUrl) return;

    setStatus('connecting');
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.addEventListener('open', () => {
      retryDelayRef.current = 2000;
      setStatus('connected');
      ws.send(JSON.stringify({ type: 'auth', token: accessToken }));
      sentRef.current.clear();
      for (const frame of framesToReplay(subscriptionsRef.current)) {
        ws.send(JSON.stringify(frame));
        sentRef.current.add(frame.jobId);
      }
    });

    ws.addEventListener('message', (event) => {
      try {
        const message = JSON.parse(String(event.data));
        if (message.type === 'clientId') {
          setClientId(message.payload || null);
          return;
        }
        if (message.type === 'JOB_UPDATE') {
          notify(message.payload || {});
        }
      } catch {
        // ignore
      }
    });

    ws.addEventListener('close', () => {
      setStatus('disconnected');
      wsRef.current = null;
      sentRef.current.clear();
      if (!accessToken) return;
      const delay = retryDelayRef.current;
      retryDelayRef.current = Math.min(30000, Math.floor(retryDelayRef.current * 1.5));
      reconnectRef.current = window.setTimeout(() => {
        connectRef.current?.();
      }, delay);
    });

    ws.addEventListener('error', () => {
      ws.close();
    });
  }, [accessToken, notify]);

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  useEffect(() => {
    if (!accessToken) {
      const timer = window.setTimeout(() => {
        cleanupSocket();
        setClientId(null);
      }, 0);
      return () => window.clearTimeout(timer);
    }

    const connectTimer = window.setTimeout(() => {
      connect();
    }, 0);

    return () => {
      window.clearTimeout(connectTimer);
      window.setTimeout(() => {
        cleanupSocket();
      }, 0);
    };
  }, [accessToken, connect, cleanupSocket]);

  const subscribe = useCallback((jobId: string, workspaceId?: string | null) => {
    subscriptionsRef.current.set(jobId, workspaceId ?? null);
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (sentRef.current.has(jobId)) return;
    ws.send(JSON.stringify({ type: 'subscribe', jobId, workspaceId: workspaceId || undefined }));
    sentRef.current.add(jobId);
  }, []);

  const unsubscribe = useCallback((jobId: string) => {
    const workspaceId = subscriptionsRef.current.get(jobId) ?? undefined;
    subscriptionsRef.current.delete(jobId);
    sentRef.current.delete(jobId);
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'unsubscribe', jobId, workspaceId: workspaceId || undefined }));
  }, []);

  const onJobUpdate = useCallback((handler: (payload: JobUpdatePayload) => void) => {
    listenersRef.current.add(handler);
    return () => listenersRef.current.delete(handler);
  }, []);

  const value = useMemo<WebSocketContextValue>(
    () => ({
      clientId,
      status,
      subscribe,
      unsubscribe,
      onJobUpdate,
    }),
    [clientId, status, subscribe, unsubscribe, onJobUpdate]
  );

  return <WebSocketContext.Provider value={value}>{children}</WebSocketContext.Provider>;
}

export function useWebSocket() {
  const ctx = useContext(WebSocketContext);
  if (!ctx) throw new Error('useWebSocket must be used inside WebSocketProvider');
  return ctx;
}
