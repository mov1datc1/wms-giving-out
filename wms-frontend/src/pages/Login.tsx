import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Package, Mail, Lock, Eye, EyeOff, ArrowRight } from 'lucide-react';

export function Login() {
  const { login, user } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Redirect if already logged in
  if (user) return <Navigate to="/" replace />;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
    } catch (err: any) {
      setError(err.message || 'Error de autenticación');
    }
    setLoading(false);
  }

  return (
    <div className="login-page">
      <div className="login-bg-shapes">
        <div className="login-shape login-shape-1" />
        <div className="login-shape login-shape-2" />
        <div className="login-shape login-shape-3" />
      </div>

      <div className="login-card animate-slide-up">
        <div className="login-header">
          <div className="login-logo">
            <div className="login-logo-icon">
              <Package size={28} />
            </div>
          </div>
          <h1 className="login-title">Giving Out</h1>
          <p className="login-subtitle">Sistema de Gestión de Almacén</p>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          <div className="login-field">
            <label>Email</label>
            <div className="login-input-wrap">
              <Mail size={17} />
              <input
                type="email" placeholder="correo@givingout.com"
                value={email} onChange={e => setEmail(e.target.value)}
                required autoFocus
              />
            </div>
          </div>

          <div className="login-field">
            <label>Contraseña</label>
            <div className="login-input-wrap">
              <Lock size={17} />
              <input
                type={showPw ? 'text' : 'password'} placeholder="Ingresa tu contraseña"
                value={password} onChange={e => setPassword(e.target.value)}
                required
              />
              <button type="button" className="login-eye" onClick={() => setShowPw(!showPw)}>
                {showPw ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
          </div>

          {error && <div className="login-error">{error}</div>}

          <button type="submit" className="login-btn" disabled={loading}>
            {loading ? 'Verificando...' : 'Iniciar Sesión'}
            {!loading && <ArrowRight size={17} />}
          </button>
        </form>

        <div className="login-footer">
          <p>MOVIDA TCI · Tepotzotlán, Estado de México</p>
        </div>
      </div>
    </div>
  );
}
