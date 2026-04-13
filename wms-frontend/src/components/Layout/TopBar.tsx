import { useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { Search, Bell, LogOut, ChevronRight } from 'lucide-react';

const routeNames: Record<string, string> = {
  '/': 'Dashboard',
  '/inventario': 'Inventario',
  '/ubicaciones': 'Ubicaciones',
  '/recepcion': 'Recepción',
  '/picking': 'Picking',
  '/despacho': 'Despacho',
  '/trazabilidad': 'Trazabilidad',
  '/maestros': 'Datos Maestros',
  '/etiquetado': 'Etiquetado',
  '/admin': 'Administración',
  '/conteo-ciclico': 'Conteo Cíclico',
  '/clientes': 'Clientes',
  '/comercial': 'Cotizaciones',
  '/alertas': 'Alertas',
};

export function TopBar() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const pageName = routeNames[location.pathname] || 'Página';

  const initials = user?.nombre
    ? user.nombre.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
    : '??';

  return (
    <header className="topbar">
      <div className="topbar-left">
        <div className="topbar-breadcrumb">
          Giving Out <ChevronRight size={14} /> <span>{pageName}</span>
        </div>
      </div>

      <div className="topbar-right">
        <div className="topbar-search">
          <Search size={15} style={{ color: 'var(--text-muted)' }} />
          <input placeholder="Buscar SKU, lote, cliente..." />
        </div>

        <button className="topbar-icon-btn" title="Notificaciones">
          <Bell size={17} />
          <span className="topbar-notification-dot" />
        </button>

        <div className="topbar-user" onClick={logout} title="Cerrar sesión">
          <div className="topbar-avatar">{initials}</div>
          <div>
            <div className="topbar-user-name">{user?.nombre || 'Usuario'}</div>
            <div className="topbar-user-role">{user?.rolNombre || 'Sin rol'}</div>
          </div>
          <LogOut size={15} style={{ color: 'var(--text-muted)', marginLeft: 4 }} />
        </div>
      </div>
    </header>
  );
}
