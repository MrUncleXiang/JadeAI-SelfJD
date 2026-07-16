'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { useFingerprint } from '@/hooks/use-fingerprint';
import { useRuntimeConfig } from './runtime-config-provider';

export interface AuthUser {
  id: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  authType: 'password' | 'oauth' | 'fingerprint';
  username: string | null;
  role: 'admin' | 'user';
}

interface CurrentUserResponse {
  id: string;
  username: string | null;
  email: string | null;
  displayName: string;
  avatarUrl: string | null;
  authType: 'password' | 'oauth' | 'fingerprint';
  role: 'admin' | 'user';
}

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  signIn: () => void;
  signOut: () => Promise<void> | void;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { fingerprint, isLoading: fingerprintLoading } = useFingerprint();
  const { authEnabled } = useRuntimeConfig();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [sessionLoading, setSessionLoading] = useState(authEnabled);

  const refresh = useCallback(async () => {
    if (!authEnabled) return;
    setSessionLoading(true);
    try {
      const response = await fetch('/api/me', {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      if (!response.ok) {
        setUser(null);
        return;
      }
      const current = await response.json() as CurrentUserResponse;
      setUser({
        id: current.id,
        username: current.username,
        name: current.displayName,
        email: current.email,
        avatarUrl: current.avatarUrl,
        authType: current.authType,
        role: current.role,
      });
    } catch {
      setUser(null);
    } finally {
      setSessionLoading(false);
    }
  }, [authEnabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<AuthContextValue>(() => {
    if (authEnabled) {
      return {
        user,
        isLoading: sessionLoading,
        isAuthenticated: Boolean(user),
        signIn: () => window.location.assign('/login'),
        signOut: async () => {
          try {
            await fetch('/api/auth/logout', {
              method: 'POST',
              credentials: 'same-origin',
            });
          } finally {
            setUser(null);
            window.location.assign('/');
          }
        },
        refresh,
      };
    }

    const fingerprintUser: AuthUser | null = fingerprint
      ? {
          id: `fp_${fingerprint}`,
          name: 'Anonymous User',
          email: null,
          avatarUrl: null,
          authType: 'fingerprint',
          username: null,
          role: 'user',
        }
      : null;
    return {
      user: fingerprintUser,
      isLoading: fingerprintLoading,
      isAuthenticated: Boolean(fingerprintUser),
      signIn: () => {},
      signOut: () => {},
      refresh: async () => {},
    };
  }, [authEnabled, fingerprint, fingerprintLoading, refresh, sessionLoading, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthContext(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
