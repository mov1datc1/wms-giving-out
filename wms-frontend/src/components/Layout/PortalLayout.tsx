import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { LayoutDashboard, Package, ShoppingCart, Plus, LogOut, Clock, Store } from 'lucide-react';
import { useState, useEffect } from 'react';

const portalMenu = [
  { path: '/portal', icon: LayoutDashboard, label: 'Mi Dashboard' },
  { path: '/portal/inventario', icon: Package, label: 'Mi Inventario' },
  { path: '/portal/pedidos', icon: ShoppingCart, label: 'Mis Pedidos' },
  { path: '/portal/nuevo-pedido', icon: Plus, label: 'Nuevo Pedido' },
];

export function PortalLayout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [clock, setClock] = useState('');

  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="app-layout">
      <aside className="sidebar portal-sidebar">
        <div className="sidebar-header">
          <div className="sidebar-logo">
            <div className="sidebar-logo-icon"><Store size={22} /></div>
            <div className="sidebar-logo-text">
              <div className="sidebar-logo-title">Portal Cliente</div>
              <div className="sidebar-logo-subtitle">Giving Out 3PL</div>
            </div>
          </div>
        </div>

        <nav className="sidebar-nav">
          <div className="sidebar-section">
            <div className="sidebar-section-label">Mi Operación</div>
            {portalMenu.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) =>
                  `sidebar-link ${isActive || (item.path === '/portal' && location.pathname === '/portal') ? 'active' : ''}`
                }
                end={item.path === '/portal'}
              >
                <item.icon className="sidebar-link-icon" size={18} />
                <span>{item.label}</span>
              </NavLink>
            ))}
          </div>
        </nav>

        <div className="sidebar-footer">
          <div className="portal-user-info">
            <div style={{ fontSize: 13, fontWeight: 600 }}>{user?.nombre}</div>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{user?.rolNombre}</div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => { logout(); navigate('/login'); }} style={{ marginTop: 8, width: '100%' }}>
            <LogOut size={14} /> Cerrar Sesión
          </button>
          <div className="sidebar-clock" style={{ marginTop: 8 }}>
            <Clock size={12} /> {clock}
          </div>
        </div>
      </aside>
      <div className="app-main">
        <div className="app-content">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
