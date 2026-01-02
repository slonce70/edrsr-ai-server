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
import { useAuth } from './AuthContext';

type JobUpdatePayload = Record<string, unknown> & { id?: string; type?: string };

type WebSocketContextValue = {
  clientId: string | null;
  status: 'disconnected' | 'connecting' | 'connected';
  subscribe: (jobId: string) => void;
  onJobUpdate: (handler: (payload: JobUpdatePayload) => void) => () => void;
};

const WebSocketContext = createContext<WebSocketContextValue | null>(null);

export function WebSocketProvider({ children }: { children: React.ReactNode }) {
  const { accessToken } = useAuth();
  const [clientId, setClientId] = useState<string | null>(null);
  const [status, setStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const wsRef = useRef<WebSocket | null>(null);
  const listenersRef = useRef(new Set<(payload: JobUpdatePayload) => void>());
  const retryDelayRef = useRef(2000);
  const reconnectRef = useRef<number | null>(null);
  const connectRef = useRef<() => void>();

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

  const subscribe = useCallback((jobId: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'subscribe', jobId }));
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
      onJobUpdate,
    }),
    [clientId, status, subscribe, onJobUpdate]
  );

  return <WebSocketContext.Provider value={value}>{children}</WebSocketContext.Provider>;
}

export function useWebSocket() {
  const ctx = useContext(WebSocketContext);
  if (!ctx) throw new Error('useWebSocket must be used inside WebSocketProvider');
  return ctx;
}
