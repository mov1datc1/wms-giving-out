import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import {
  LayoutDashboard, Package, MapPin, ClipboardCheck, PackageOpen,
  Truck, Users, Database, Tag, BarChart3, Shield, ClipboardList,
  ShoppingCart, Clock, Building
} from 'lucide-react';
import { useState, useEffect } from 'react';

const menuSections = [
  {
    label: 'General',
    items: [
      { path: '/', icon: LayoutDashboard, label: 'Dashboard', modulo: 'dashboard' },
    ],
  },
  {
    label: 'Comercial',
    items: [
      { path: '/clientes', icon: Users, label: 'Clientes', modulo: 'clientes' },
      { path: '/proveedores', icon: Building, label: 'Proveedores', modulo: 'clientes' },
      { path: '/comercial', icon: ShoppingCart, label: 'Cotizaciones', modulo: 'comercial' },
    ],
  },
  {
    label: 'Operativa',
    items: [
      { path: '/recepcion', icon: ClipboardCheck, label: 'Recepción', modulo: 'recepcion' },
      { path: '/inventario', icon: Package, label: 'Inventario', modulo: 'inventario' },
      { path: '/ubicaciones', icon: MapPin, label: 'Ubicaciones', modulo: 'ubicaciones' },
      { path: '/picking', icon: PackageOpen, label: 'Picking', modulo: 'picking' },
      { path: '/despacho', icon: Truck, label: 'Despacho', modulo: 'despacho' },
      { path: '/etiquetado', icon: Tag, label: 'Etiquetado', modulo: 'etiquetado' },
      { path: '/trazabilidad', icon: BarChart3, label: 'Trazabilidad', modulo: 'trazabilidad' },
      { path: '/conteo-ciclico', icon: ClipboardList, label: 'Conteo Cíclico', modulo: 'conteo-ciclico' },
    ],
  },
  {
    label: 'Administración',
    items: [
      { path: '/maestros', icon: Database, label: 'Datos Maestros', modulo: 'maestros' },
      { path: '/alertas', icon: Clock, label: 'Alertas', modulo: 'alertas' },
      { path: '/admin', icon: Shield, label: 'Admin Panel', modulo: 'admin' },
    ],
  },
];

export function Sidebar() {
  const { hasPermission } = useAuth();
  const location = useLocation();
  const [clock, setClock] = useState('');

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setClock(now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-logo">
          <div className="sidebar-logo-icon">📦</div>
          <div className="sidebar-logo-text">
            <div className="sidebar-logo-title">Giving Out</div>
            <div className="sidebar-logo-subtitle">Warehouse Management</div>
          </div>
        </div>
      </div>

      <nav className="sidebar-nav">
        {menuSections.map((section) => {
          const visibleItems = section.items.filter(item => hasPermission(item.modulo));
          if (visibleItems.length === 0) return null;

          return (
            <div className="sidebar-section" key={section.label}>
              <div className="sidebar-section-label">{section.label}</div>
              {visibleItems.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  className={({ isActive }) =>
                    `sidebar-link ${isActive || (item.path === '/' && location.pathname === '/') ? 'active' : ''}`
                  }
                  end={item.path === '/'}
                >
                  <item.icon className="sidebar-link-icon" size={18} />
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </div>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <div className="sidebar-clock">
          <Clock size={12} />
          {clock}
        </div>
        <div className="sidebar-version">WMS v1.0.0 · Giving Out</div>
      </div>
    </aside>
  );
}
