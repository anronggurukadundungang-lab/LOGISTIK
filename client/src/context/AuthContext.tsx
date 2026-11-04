import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, setCsrfToken } from '../lib/api';
import type { Department, User } from '../types';

interface AuthContextValue {
  user: User | null;
  departments: Department[];
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  can: (permission: string) => boolean;
  canAny: (...permissions: string[]) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);

  const loadMe = useCallback(async () => {
    try {
      const result = await api.get<{ user: User; departments: Department[] }>('/auth/me');
      setCsrfToken(result.user.csrfToken);
      setUser(result.user);
      setDepartments(result.departments);
    } catch {
      setUser(null);
      setDepartments([]);
      setCsrfToken('');
    }
  }, []);

  useEffect(() => {
    loadMe().finally(() => setLoading(false));
  }, [loadMe]);

  useEffect(() => {
    const handler = () => {
      setUser(null);
      setDepartments([]);
      setCsrfToken('');
    };
    window.addEventListener('auth:expired', handler);
    return () => window.removeEventListener('auth:expired', handler);
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const result = await api.post<{ user: User }>('/auth/login', { username, password });
    setCsrfToken(result.user.csrfToken);
    const me = await api.get<{ user: User; departments: Department[] }>('/auth/me');
    setUser(me.user);
    setDepartments(me.departments);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      setUser(null);
      setDepartments([]);
      setCsrfToken('');
    }
  }, []);

  const can = useCallback((permission: string) => Boolean(user?.permissions.includes(permission)), [user]);
  const canAny = useCallback(
    (...permissions: string[]) => permissions.some((permission) => user?.permissions.includes(permission)),
    [user],
  );

  const value = useMemo(
    () => ({ user, departments, loading, login, logout, refresh: loadMe, can, canAny }),
    [user, departments, loading, login, logout, loadMe, can, canAny],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth harus dipakai di dalam AuthProvider');
  return context;
}
