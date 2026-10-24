import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { API } from '../config/api';

interface UserData {
  id: string;
  email: string;
  nombre: string;
  rolId: string | null;
  rolNombre: string | null;
  almacenId: string | null;
  clienteId: string | null;
  isSuperAdmin: boolean;
  permisos: string[];
}

interface AuthContextType {
  user: UserData | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  loginOtp: (email: string, code: string) => Promise<void>;
  requestOtp: (email: string) => Promise<{ success: boolean; message: string }>;
  logout: () => void;
  hasPermission: (modulo: string) => boolean;
}

const AuthContext = createContext<AuthContextType>({
  user: null, token: null, loading: true,
  login: async () => {}, loginOtp: async () => {},
  requestOtp: async () => ({ success: false, message: '' }),
  logout: () => {}, hasPermission: () => false,
});

export function useAuth() { return useContext(AuthContext); }

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserData | null>(null);
  const [token, setToken] = useState<string | null>(() => {
    const saved = localStorage.getItem('wms_token') || localStorage.getItem('token');
    if (!saved || saved === 'demo-token') {
      localStorage.removeItem('wms_token');
      localStorage.removeItem('token');
      return null;
    }
    return saved;
  });
  const [loading, setLoading] = useState(true);

  function clearSession() {
    localStorage.removeItem('wms_token');
    localStorage.removeItem('token');
    setToken(null);
    setUser(null);
  }

  useEffect(() => {
    if (token) {
      verifyToken(token);
    } else {
      clearSession();
      setLoading(false);
    }
  }, []);

  async function verifyToken(t: string) {
    if (!t || t === 'demo-token') {
      clearSession();
      setLoading(false);
      return;
    }
    try {
      const res = await fetch(`${API}/auth/me`, {
        headers: { Authorization: `Bearer ${t}` },
      });
      if (res.ok) {
        const userData = await res.json();
        setUser(userData);
      } else {
        // Token inválido, expirado o rechazado por backend (HTTP 401/403)
        clearSession();
      }
    } catch {
      // Error de red o servidor no disponible: limpiar sesión por seguridad
      clearSession();
    } finally {
      setLoading(false);
    }
  }

  async function login(email: string, password: string) {
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim(), password }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || 'Error de autenticación');
    }
    const data = await res.json();
    localStorage.setItem('wms_token', data.token);
    localStorage.setItem('token', data.token);
    setToken(data.token);
    setUser(data.user);
  }

  async function loginOtp(email: string, code: string) {
    const res = await fetch(`${API}/auth/otp/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim(), code: code.trim() }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || 'Código OTP inválido');
    }
    const data = await res.json();
    localStorage.setItem('wms_token', data.token);
    localStorage.setItem('token', data.token);
    setToken(data.token);
    setUser(data.user);
  }

  async function requestOtp(email: string) {
    const res = await fetch(`${API}/auth/otp/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim() }),
    });
    return res.json();
  }

  function logout() {
    clearSession();
  }

  function hasPermission(modulo: string) {
    if (!user) return false;
    if (user.isSuperAdmin) return true;
    return user.permisos?.includes(modulo) ?? false;
  }

  return (
    <AuthContext.Provider value={{ user, token, loading, login, loginOtp, requestOtp, logout, hasPermission }}>
      {children}
    </AuthContext.Provider>
  );
}
