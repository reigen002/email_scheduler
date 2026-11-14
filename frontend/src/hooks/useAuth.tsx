'use client';

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { User } from '@/types';
import { authApi } from '@/lib/api';

interface AuthContextValue {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (token: string, user: User) => void;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Restore only a session that the backend still accepts.
  useEffect(() => {
    const storedToken = localStorage.getItem('auth_token');
    let active = true;
    const profile = storedToken ? authApi.me() : Promise.resolve(null);
    profile.then(freshUser => {
      if (!active) return;
      if (freshUser) {
        setToken(storedToken);
        setUser(freshUser);
        localStorage.setItem('auth_user', JSON.stringify(freshUser));
      }
    }).catch(() => {
      if (active) {
        localStorage.removeItem('auth_token');
        localStorage.removeItem('auth_user');
      }
    }).finally(() => { if (active) setIsLoading(false); });
    return () => { active = false; };
  }, []);

  const login = useCallback((newToken: string, newUser: User) => {
    localStorage.setItem('auth_token', newToken);
    localStorage.setItem('auth_user', JSON.stringify(newUser));
    setToken(newToken);
    setUser(newUser);
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // Ignore errors — always clear local state
    }
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_user');
    setToken(null);
    setUser(null);
    window.location.href = '/login';
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const freshUser = await authApi.me();
      setUser(freshUser);
      localStorage.setItem('auth_user', JSON.stringify(freshUser));
    } catch {
      // Token expired or invalid — log out
      await logout();
    }
  }, [logout]);

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoading,
        isAuthenticated: !!user && !!token,
        login,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
