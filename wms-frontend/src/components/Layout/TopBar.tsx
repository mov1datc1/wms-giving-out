import { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { API } from '../../config/api';
import {
  Search, Bell, LogOut, ChevronRight, CheckCheck, Trash2, X,
  ShoppingBag, AlertTriangle, PackageCheck, RefreshCw, CheckCircle2,
  Building2, Package, ClipboardList, Loader2
} from 'lucide-react';

interface NotificationItem {
  id: string;
  title: string;
  message: string;
  type: 'ORDER' | 'ALERT' | 'RECEIPT' | 'CYCLE';
  route: string;
  timestamp: string;
  read: boolean;
}

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
  const { user, token, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const pageName = routeNames[location.pathname] || 'Página';

  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Global Search State
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{ clients: any[]; skus: any[]; receipts: any[] } | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const searchTimeoutRef = useRef<any>(null);

  const headers: any = { Authorization: `Bearer ${token}` };

  const initials = user?.nombre
    ? user.nombre.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
    : '??';

  useEffect(() => {
    loadNotifications();
    const interval = setInterval(loadNotifications, 30000);
    return () => clearInterval(interval);
  }, []);

  // Close dropdowns on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowSearchDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function handleSearchChange(val: string) {
    setSearchQuery(val);
    if (!val.trim()) {
      setSearchResults(null);
      setShowSearchDropdown(false);
      return;
    }
    setShowSearchDropdown(true);
    setIsSearching(true);

    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`${API}/global-search?q=${encodeURIComponent(val.trim())}`, { headers });
        if (res.ok) {
          const data = await res.json();
          setSearchResults(data);
        }
      } catch (err) {
        console.error('Error in global search:', err);
      } finally {
        setIsSearching(false);
      }
    }, 250);
  }

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setShowSearchDropdown(false);
    navigate(`/recepcion?search=${encodeURIComponent(searchQuery.trim())}`);
  }

  function handleSelectResult(route: string) {
    setShowSearchDropdown(false);
    navigate(route);
  }

  async function loadNotifications() {
    try {
      const readIds: string[] = JSON.parse(localStorage.getItem('wms_read_notifs') || '[]');
      const dismissedIds: string[] = JSON.parse(localStorage.getItem('wms_dismissed_notifs') || '[]');

      const [alertsRes, ordersRes, ccRes] = await Promise.all([
        fetch(`${API}/alerts`, { headers }),
        fetch(`${API}/orders?estado=EN_PROGRESO`, { headers }),
        fetch(`${API}/cycle-counts?estado=EN_PROGRESO`, { headers }),
      ]);

      const items: NotificationItem[] = [];

      if (ordersRes.ok) {
        const orders = await ordersRes.json();
        orders.slice(0, 5).forEach((o: any) => {
          const id = `order-${o.id}`;
          items.push({
            id,
            title: `Nuevo Pedido ${o.codigo}`,
            message: `Cliente: ${o.cliente?.nombreComercial || 'General'} · ${o.lineas?.length || 1} producto(s)`,
            type: 'ORDER',
            route: '/despacho',
            timestamp: new Date(o.createdAt || Date.now()).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }),
            read: readIds.includes(id),
          });
        });
      }

      if (alertsRes.ok) {
        const alerts = await alertsRes.json();
        alerts.filter((a: any) => !a.resuelta).slice(0, 5).forEach((a: any) => {
          const id = `alert-${a.id}`;
          items.push({
            id,
            title: `Alerta: ${a.titulo}`,
            message: `Prioridad ${a.prioridad} · ${a.detalle}`,
            type: 'ALERT',
            route: '/alertas',
            timestamp: new Date(a.createdAt || Date.now()).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }),
            read: readIds.includes(id),
          });
        });
      }

      if (ccRes.ok) {
        const counts = await ccRes.json();
        counts.slice(0, 3).forEach((c: any) => {
          const id = `cc-${c.id}`;
          items.push({
            id,
            title: `Conteo Cíclico en Progreso`,
            message: `${c.codigo} (${c.nombre}) · ${c.lineas?.length || 0} líneas a verificar`,
            type: 'CYCLE',
            route: '/conteo-ciclico',
            timestamp: new Date(c.createdAt || Date.now()).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }),
            read: readIds.includes(id),
          });
        });
      }

      // Filter out dismissed items
      const activeNotifs = items.filter(item => !dismissedIds.includes(item.id));
      setNotifications(activeNotifs);
    } catch (err) {
      console.error('Error loading notifications:', err);
    }
  }

  function markAsRead(id: string) {
    const readIds: string[] = JSON.parse(localStorage.getItem('wms_read_notifs') || '[]');
    if (!readIds.includes(id)) {
      readIds.push(id);
      localStorage.setItem('wms_read_notifs', JSON.stringify(readIds));
    }
    setNotifications(prev => prev.map(item => item.id === id ? { ...item, read: true } : item));
  }

  function handleNotificationClick(item: NotificationItem) {
    markAsRead(item.id);
    setIsOpen(false);
    navigate(item.route);
  }

  function dismissNotification(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    const dismissedIds: string[] = JSON.parse(localStorage.getItem('wms_dismissed_notifs') || '[]');
    if (!dismissedIds.includes(id)) {
      dismissedIds.push(id);
      localStorage.setItem('wms_dismissed_notifs', JSON.stringify(dismissedIds));
    }
    setNotifications(prev => prev.filter(item => item.id !== id));
  }

  function markAllAsRead() {
    const allIds = notifications.map(n => n.id);
    localStorage.setItem('wms_read_notifs', JSON.stringify(allIds));
    setNotifications(prev => prev.map(item => ({ ...item, read: true })));
  }

  function clearAllNotifications() {
    const allIds = notifications.map(n => n.id);
    const dismissedIds: string[] = JSON.parse(localStorage.getItem('wms_dismissed_notifs') || '[]');
    const updated = Array.from(new Set([...dismissedIds, ...allIds]));
    localStorage.setItem('wms_dismissed_notifs', JSON.stringify(updated));
    setNotifications([]);
  }

  const unreadCount = notifications.filter(n => !n.read).length;

  const renderIcon = (type: NotificationItem['type']) => {
    switch (type) {
      case 'ORDER': return <ShoppingBag size={17} color="#2563eb" />;
      case 'ALERT': return <AlertTriangle size={17} color="#ef4444" />;
      case 'CYCLE': return <RefreshCw size={17} color="#f59e0b" />;
      default: return <PackageCheck size={17} color="#0d9488" />;
    }
  };

  const renderBg = (type: NotificationItem['type']) => {
    switch (type) {
      case 'ORDER': return 'rgba(37, 99, 235, 0.1)';
      case 'ALERT': return 'rgba(239, 68, 68, 0.1)';
      case 'CYCLE': return 'rgba(245, 158, 11, 0.1)';
      default: return 'rgba(13, 148, 136, 0.1)';
    }
  };

  return (
    <header className="topbar">
      <div className="topbar-left">
        <div className="topbar-breadcrumb">
          Giving Out <ChevronRight size={14} /> <span>{pageName}</span>
        </div>
      </div>

      <div className="topbar-right">
        {/* TOPBAR GLOBAL SEARCH */}
        <div style={{ position: 'relative' }} ref={searchRef}>
          <form onSubmit={handleSearchSubmit} className="topbar-search" style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <button 
              type="submit" 
              style={{ background: 'transparent', border: 'none', padding: 0, display: 'flex', alignItems: 'center', cursor: 'pointer', color: 'var(--text-muted)' }}
              title="Buscar en el sistema (Enter)"
            >
              {isSearching ? <Loader2 size={15} className="spin" style={{ color: '#2dd4bf' }} /> : <Search size={15} />}
            </button>
            <input 
              placeholder="Buscar SKU, lote, cliente..." 
              value={searchQuery}
              onChange={e => handleSearchChange(e.target.value)}
              onFocus={() => {
                if (searchQuery.trim()) setShowSearchDropdown(true);
              }}
              style={{ width: '100%', background: 'transparent', border: 'none', outline: 'none', color: '#f8fafc', paddingLeft: 8 }}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => { setSearchQuery(''); setSearchResults(null); setShowSearchDropdown(false); }}
                style={{ background: 'transparent', border: 'none', padding: 2, display: 'flex', alignItems: 'center', cursor: 'pointer', color: '#94a3b8' }}
              >
                <X size={14} />
              </button>
            )}
          </form>

          {/* SEARCH DROPDOWN POPUP */}
          {showSearchDropdown && (
            <div style={{
              position: 'absolute',
              top: 'calc(100% + 8px)',
              right: 0,
              width: 380,
              maxWidth: '92vw',
              background: '#FFFFFF',
              border: '1px solid #E2E8F0',
              borderRadius: 10,
              boxShadow: '0 12px 32px rgba(0,0,0,0.12)',
              zIndex: 9999,
              overflow: 'hidden',
              fontSize: 13,
              color: '#0F172A'
            }}>
              {isSearching ? (
                <div style={{ padding: '20px', textAlign: 'center', color: '#64748B', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                  <Loader2 size={16} className="spin" style={{ color: '#0D9488' }} /> Buscando "{searchQuery}"...
                </div>
              ) : searchResults && (searchResults.clients.length > 0 || searchResults.skus.length > 0 || searchResults.receipts.length > 0) ? (
                <div style={{ maxHeight: 380, overflowY: 'auto' }}>
                  {/* CLIENTES / DEPOSITANTES */}
                  {searchResults.clients.length > 0 && (
                    <div style={{ padding: '6px 0', borderBottom: '1px solid #F1F5F9' }}>
                      <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#0284C7', padding: '4px 14px 6px', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Building2 size={12} /> Depositantes / Clientes
                      </div>
                      {searchResults.clients.map(c => (
                        <div 
                          key={c.id} 
                          onClick={() => handleSelectResult(`/recepcion?search=${encodeURIComponent(c.nombreComercial)}`)}
                          style={{ padding: '8px 14px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                          onMouseEnter={e => e.currentTarget.style.background = '#F8FAFC'}
                          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                        >
                          <div>
                            <div style={{ fontWeight: 700, color: '#0F172A' }}>{c.nombreComercial}</div>
                            <div style={{ fontSize: 11, color: '#64748B' }}>Código: {c.codigo} {c.giro ? `· ${c.giro}` : ''}</div>
                          </div>
                          <span style={{ fontSize: 11, color: '#0284C7', fontWeight: 600 }}>Ver Recepciones →</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* PREVIOS DE RECEPCIÓN */}
                  {searchResults.receipts.length > 0 && (
                    <div style={{ padding: '6px 0', borderBottom: '1px solid #F1F5F9' }}>
                      <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#0D9488', padding: '4px 14px 6px', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <ClipboardList size={12} /> Previos de Recepción
                      </div>
                      {searchResults.receipts.map(r => (
                        <div 
                          key={r.id} 
                          onClick={() => handleSelectResult(`/recepcion?search=${encodeURIComponent(r.codigo)}`)}
                          style={{ padding: '8px 14px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                          onMouseEnter={e => e.currentTarget.style.background = '#F8FAFC'}
                          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                        >
                          <div>
                            <div style={{ fontWeight: 700, color: '#0D9488', display: 'flex', alignItems: 'center', gap: 6 }}>
                              {r.codigo}
                              {(() => {
                                const norm = String(r.estado || '').toUpperCase();
                                const isArribo = norm === 'PENDIENTE_ARRIBO' || norm === 'PENDIENTE';
                                const isConteo = norm === 'EN_PROCESO_CONTEO' || norm === 'EN_PROCESO' || norm === 'COMPLETO';
                                const isCerrada = norm === 'CERRADA' || norm === 'CERRADO';
                                const label = isArribo ? 'Pendiente Arribo' : isConteo ? 'En Conteo' : isCerrada ? 'Cerrada' : r.estado;
                                const color = isArribo ? '#0284C7' : isConteo ? '#D97706' : isCerrada ? '#059669' : '#64748B';
                                const bg = isArribo ? '#E0F2FE' : isConteo ? '#FEF3C7' : isCerrada ? '#D1FAE5' : '#F1F5F9';
                                return (
                                  <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: bg, color, fontWeight: 700 }}>
                                    {label}
                                  </span>
                                );
                              })()}
                            </div>
                            <div style={{ fontSize: 11, color: '#64748B' }}>
                              {r.cliente?.nombreComercial} {r.facturaRespaldo ? `· Factura: ${r.facturaRespaldo}` : ''}
                            </div>
                          </div>
                          <span style={{ fontSize: 11, color: '#0D9488', fontWeight: 600 }}>Abrir Previo →</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* SKUS */}
                  {searchResults.skus.length > 0 && (
                    <div style={{ padding: '6px 0' }}>
                      <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#7C3AED', padding: '4px 14px 6px', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Package size={12} /> Productos / SKUs
                      </div>
                      {searchResults.skus.map(s => (
                        <div 
                          key={s.id} 
                          onClick={() => handleSelectResult(`/inventario?search=${encodeURIComponent(s.codigo)}`)}
                          style={{ padding: '8px 14px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                          onMouseEnter={e => e.currentTarget.style.background = '#F8FAFC'}
                          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                        >
                          <div>
                            <div style={{ fontWeight: 700, color: '#0F172A' }}>{s.codigo}</div>
                            <div style={{ fontSize: 11, color: '#64748B' }}>{s.descripcion} · {s.cliente?.nombreComercial}</div>
                          </div>
                          <span style={{ fontSize: 11, color: '#7C3AED', fontWeight: 600 }}>Inventario →</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <div 
                    onClick={handleSearchSubmit}
                    style={{ padding: '10px 14px', background: '#F8FAFC', textAlign: 'center', fontSize: 12, fontWeight: 700, color: '#0284C7', cursor: 'pointer', borderTop: '1px solid #E2E8F0' }}
                  >
                    Buscar "{searchQuery}" en Recepción ↵
                  </div>
                </div>
              ) : searchQuery.length >= 2 ? (
                <div style={{ padding: '24px 16px', textAlign: 'center', color: '#64748B' }}>
                  <div style={{ fontWeight: 600, color: '#0F172A', marginBottom: 4 }}>Presiona Enter para filtrar</div>
                  <div style={{ fontSize: 11 }}>Buscará coincidencias de "{searchQuery}" en recepciones.</div>
                </div>
              ) : null}
            </div>
          )}
        </div>

        {/* NOTIFICATION BUTTON & DROPDOWN CONTAINER */}
        <div style={{ position: 'relative' }} ref={dropdownRef}>
          <button
            className="topbar-icon-btn"
            title="Notificaciones"
            onClick={() => setIsOpen(prev => !prev)}
            style={{ borderColor: isOpen ? 'var(--accent-primary)' : undefined }}
          >
            <Bell size={17} />
            {unreadCount > 0 && (
              <span className="topbar-notification-badge">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>

          {/* DROPDOWN PANEL */}
          {isOpen && (
            <div className="notifications-dropdown">
              <div className="notifications-header">
                <div className="notifications-title">
                  <Bell size={16} /> Notificaciones
                  {unreadCount > 0 && (
                    <span style={{
                      background: 'rgba(239,68,68,0.1)',
                      color: '#ef4444',
                      fontSize: 11,
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: 12,
                    }}>
                      {unreadCount} sin leer
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {unreadCount > 0 && (
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={markAllAsRead}
                      title="Marcar todas como leídas"
                      style={{ fontSize: 11, padding: '4px 8px', height: 'auto', minHeight: 0 }}
                    >
                      <CheckCheck size={14} style={{ marginRight: 4 }} /> Leídas
                    </button>
                  )}
                  {notifications.length > 0 && (
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={clearAllNotifications}
                      title="Limpiar todas"
                      style={{ fontSize: 11, padding: '4px 8px', height: 'auto', minHeight: 0, color: 'var(--text-muted)' }}
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </div>

              <div className="notifications-body">
                {notifications.map((item) => (
                  <div
                    key={item.id}
                    className={`notification-item ${!item.read ? 'unread' : ''}`}
                    onClick={() => handleNotificationClick(item)}
                  >
                    <div
                      className="notification-icon-wrapper"
                      style={{ background: renderBg(item.type) }}
                    >
                      {renderIcon(item.type)}
                    </div>
                    <div className="notification-content">
                      <div className="notification-item-title">{item.title}</div>
                      <div className="notification-item-msg">{item.message}</div>
                      <div className="notification-item-time">🕒 {item.timestamp}</div>
                    </div>
                    <button
                      className="notification-dismiss-btn"
                      onClick={(e) => dismissNotification(e, item.id)}
                      title="Quitar notificación"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}

                {notifications.length === 0 && (
                  <div style={{ padding: '36px 20px', textAlign: 'center', color: 'var(--text-tertiary)' }}>
                    <CheckCircle2 size={32} style={{ opacity: 0.3, marginBottom: 8 }} />
                    <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-secondary)' }}>
                      ¡Sin notificaciones pendientes!
                    </div>
                    <div style={{ fontSize: 12, marginTop: 2 }}>Estás al día con la operación del almacén</div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

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
