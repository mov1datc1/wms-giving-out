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
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('wms_token'));
  const [loading, setLoading] = useState(true);

  useEffect(() => { token ? verifyToken(token) : setLoading(false); }, []);

  async function verifyToken(t: string) {
    // Demo mode — restore demo user from token
    if (t === 'demo-token') {
      setUser({
        id: 'demo-001', email: 'demo@givingout.mx', nombre: 'Jonathan Palacios',
        rolId: 'R-01', rolNombre: 'Super Admin',
        almacenId: 'WH-001', clienteId: null, isSuperAdmin: true,
        permisos: ['dashboard','depositantes','clientes-finales','recepcion','inventario','ubicaciones','picking','despacho','etiquetado','trazabilidad','conteo-ciclico','maestros','alertas','admin'],
      });
      setLoading(false);
      return;
    }
    try {
      const res = await fetch(`${API}/auth/me`, { headers: { Authorization: `Bearer ${t}` } });
      if (res.ok) { setUser(await res.json()); }
      else { localStorage.removeItem('wms_token'); setToken(null); }
    } catch { localStorage.removeItem('wms_token'); setToken(null); }
    setLoading(false);
  }

  async function login(email: string, password: string) {
    try {
      const res = await fetch(`${API}/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) { const err = await res.json(); throw new Error(err.message || 'Error de autenticación'); }
      const data = await res.json();
      localStorage.setItem('wms_token', data.token); setToken(data.token); setUser(data.user);
    } catch (err: any) {
      // Demo mode fallback — works without backend
      if (err.message?.includes('Failed to fetch') || err.message?.includes('NetworkError')) {
        const demoUser: UserData = {
          id: 'demo-001', email, nombre: 'Jonathan Palacios',
          rolId: 'R-01', rolNombre: 'Super Admin',
          almacenId: 'WH-001', clienteId: null, isSuperAdmin: true,
          permisos: ['dashboard','depositantes','clientes-finales','recepcion','inventario','ubicaciones','picking','despacho','etiquetado','trazabilidad','conteo-ciclico','maestros','alertas','admin'],
        };
        localStorage.setItem('wms_token', 'demo-token'); setToken('demo-token'); setUser(demoUser);
        return;
      }
      throw err;
    }
  }

  async function loginOtp(email: string, code: string) {
    const res = await fetch(`${API}/auth/otp/verify`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code }),
    });
    if (!res.ok) { const err = await res.json(); throw new Error(err.message || 'Código OTP inválido'); }
    const data = await res.json();
    localStorage.setItem('wms_token', data.token); setToken(data.token); setUser(data.user);
  }

  async function requestOtp(email: string) {
    const res = await fetch(`${API}/auth/otp/request`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    return res.json();
  }

  function logout() { localStorage.removeItem('wms_token'); setToken(null); setUser(null); }
  function hasPermission(modulo: string) { if (!user) return false; if (user.isSuperAdmin) return true; return user.permisos.includes(modulo); }

  return (
    <AuthContext.Provider value={{ user, token, loading, login, loginOtp, requestOtp, logout, hasPermission }}>
      {children}
    </AuthContext.Provider>
  );
}
