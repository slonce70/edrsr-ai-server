/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { DEV_AUTH_ENABLED } from '../lib/config';
import {
  clearStoredDevSession,
  createDevSession,
  getStoredDevSession,
  storeDevSession,
} from '../lib/dev-auth';
import { supabase } from '../lib/supabaseClient';
import { setUnauthorizedHandler } from '../lib/authBridge';

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  accessToken: string | null;
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<{ error?: string } | null>;
  signUp: (email: string) => Promise<{ error?: string } | null>;
  sendMagicLink: (email: string) => Promise<{ error?: string } | null>;
  resetPassword: (email: string) => Promise<{ error?: string } | null>;
  updatePassword: (password: string) => Promise<{ error?: string } | null>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const initialDevSession = DEV_AUTH_ENABLED ? getStoredDevSession() : null;
  const [session, setSession] = useState<Session | null>(initialDevSession);
  const [user, setUser] = useState<User | null>(initialDevSession?.user ?? null);
  const [isLoading, setIsLoading] = useState(!DEV_AUTH_ENABLED);

  useEffect(() => {
    if (DEV_AUTH_ENABLED) {
      return () => {};
    }

    let active = true;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!active) return;
        setSession(data.session);
        setUser(data.session?.user ?? null);
        setIsLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setIsLoading(false);
      });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!active) return;
      setSession(next);
      setUser(next?.user ?? null);
      setIsLoading(false);
    });

    // Bridge api.ts 401s to a single refresh-and-retry; sign out locally if the
    // session cannot be refreshed so dead-token pollers stop firing.
    setUnauthorizedHandler(async () => {
      const { data } = await supabase.auth.refreshSession();
      if (data.session?.access_token) return data.session.access_token;
      await supabase.auth.signOut({ scope: 'local' });
      return null;
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
      setUnauthorizedHandler(null);
    };
  }, []);

  const value = useMemo<AuthContextValue>(() => {
    return {
      session,
      user,
      accessToken: session?.access_token ?? null,
      isLoading,
      signIn: async (email, password) => {
        if (DEV_AUTH_ENABLED) {
          if (!email.trim()) return { error: 'Email is required' };
          if (!password.trim()) return { error: 'Password is required' };
          const nextSession = createDevSession(email);
          storeDevSession(nextSession);
          setSession(nextSession);
          setUser(nextSession.user ?? null);
          return null;
        }
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) return { error: error.message };
        return null;
      },
      signUp: async (email) => {
        if (DEV_AUTH_ENABLED) {
          return { error: 'Sign up is disabled in local dev auth mode' };
        }
        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: { shouldCreateUser: true, emailRedirectTo: window.location.origin },
        });
        if (error) return { error: error.message };
        return null;
      },
      sendMagicLink: async (email) => {
        if (DEV_AUTH_ENABLED) {
          return { error: 'Magic links are disabled in local dev auth mode' };
        }
        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) return { error: error.message };
        return null;
      },
      resetPassword: async (email) => {
        if (DEV_AUTH_ENABLED) {
          return { error: 'Password reset is disabled in local dev auth mode' };
        }
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset`,
        });
        if (error) return { error: error.message };
        return null;
      },
      updatePassword: async (password) => {
        if (DEV_AUTH_ENABLED) {
          return { error: 'Password updates are disabled in local dev auth mode' };
        }
        const { error } = await supabase.auth.updateUser({ password });
        if (error) return { error: error.message };
        return null;
      },
      signOut: async () => {
        if (DEV_AUTH_ENABLED) {
          clearStoredDevSession();
          setSession(null);
          setUser(null);
          return;
        }
        await supabase.auth.signOut({ scope: 'local' });
      },
    };
  }, [session, user, isLoading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}
