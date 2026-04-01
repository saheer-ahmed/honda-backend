// src/context/AuthContext.jsx
import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { authApi, api } from '../lib/api';
import { connectSocket, disconnectSocket, setDriverStatus } from '../lib/socket';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user,    setUser]    = useState(() => {
    try { return JSON.parse(localStorage.getItem('honda_user') || 'null'); } catch { return null; }
  });
  const [loading, setLoading] = useState(true);

  // Verify token on mount
  useEffect(() => {
    const { access } = api.getTokens();
    if (!access) { setLoading(false); return; }

    authApi.me()
      .then(u => { setUser(u); localStorage.setItem('honda_user', JSON.stringify(u)); })
      .catch(() => { api.clearTokens(); setUser(null); })
      .finally(() => setLoading(false));
  }, []);

  // Init socket when logged in
  useEffect(() => {
    if (user) {
      const sock = connectSocket();
      if (user.role === 'driver') {
        sock?.on('connect', () => setDriverStatus('online'));
      }
    }
    return () => {};
  }, [user?.id]);

  const login = useCallback(async (credentials) => {
    const data = await authApi.login(credentials);
    api.saveTokens(data);
    setUser(data.user);
    localStorage.setItem('honda_user', JSON.stringify(data.user));
    connectSocket();
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    const { refresh } = api.getTokens();
    try {
      if (user?.role === 'driver') setDriverStatus('offline');
      await authApi.logout({ refreshToken: refresh });
    } catch {}
    disconnectSocket();
    api.clearTokens();
    localStorage.removeItem('honda_user');
    setUser(null);
  }, [user]);

  const updateUser = useCallback((partial) => {
    setUser(u => {
      const updated = { ...u, ...partial };
      localStorage.setItem('honda_user', JSON.stringify(updated));
      return updated;
    });
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, updateUser, isAuthenticated: !!user }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};
