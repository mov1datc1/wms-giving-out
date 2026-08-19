import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { API } from '../../config/api';
import {
  Package, ShoppingCart, Clock, TrendingUp, Store, AlertCircle, Plus,
  CheckCircle2, AlertTriangle, ArrowRight, Calendar, Building2
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export function PortalDashboard() {
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState<any>(null);
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const headers: any = { Authorization: `Bearer ${token}` };

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [invRes, ordRes] = await Promise.all([
        fetch(`${API}/clients/${user?.clienteId}/inventory`, { headers }),
        fetch(`${API}/orders?clienteId=${user?.clienteId}`, { headers }),
      ]);
      if (invRes.ok) setStats(await invRes.json());
      if (ordRes.ok) {
        const all = await ordRes.json();
        setOrders(all.slice(0, 6));
      }
    } catch (err) { console.error(err); }
    setLoading(false);
  }

  const estadoBadge = (estado: string) => {
    const map: any = {
      SOLICITADO: 'info',
      PENDIENTE_APROBACION: 'warning',
      APROBADO: 'success',
      EN_PICKING: 'warning',
      CONSOLIDADO: 'info',
      DESPACHADO: 'success',
      ENTREGADO: 'success',
      RECHAZADO: 'error',
      CANCELADO: 'default',
    };
    return <span className={`badge badge-${map[estado] || 'default'}`}>{estado.replace(/_/g, ' ')}</span>;
  };

  if (loading) return <div style={{ textAlign: 'center', padding: 80, color: 'var(--text-secondary)' }}>Cargando portal...</div>;

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Bienvenido, {user?.nombre || 'Depositante'}</h1>
          <p className="page-subtitle">Portal de Operaciones 3PL · Giving Out WMS 360+</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" onClick={() => navigate('/portal/inventario')}>
            <Package size={15} /> Ver Inventario
          </button>
          <button className="btn btn-primary" onClick={() => navigate('/portal/nuevo-pedido')}>
            <Plus size={16} /> Nuevo Pedido
          </button>
        </div>
      </div>

      {/* KPI Ribbon con 4 estados de transparencia */}
      <div className="stats-grid" style={{ marginBottom: 24 }}>
        <div className="stat-card animate-fade-in" style={{ cursor: 'pointer' }} onClick={() => navigate('/portal/inventario')}>
          <div className="stat-icon" style={{ background: 'rgba(13,148,136,0.1)', color: 'var(--primary)' }}>
            <Package size={20} />
          </div>
          <div className="stat-info">
            <span className="stat-value">{stats?.totalFisico || stats?.totalUnidades || 0}</span>
            <span className="stat-label">Total Físico en Bodega</span>
          </div>
        </div>

        <div className="stat-card animate-fade-in" style={{ cursor: 'pointer', animationDelay: '0.05s' }} onClick={() => navigate('/portal/inventario')}>
          <div className="stat-icon" style={{ background: 'rgba(16,185,129,0.1)', color: 'var(--emerald)' }}>
            <CheckCircle2 size={20} />
          </div>
          <div className="stat-info">
            <span className="stat-value" style={{ color: 'var(--emerald)' }}>{stats?.totalDisponible || 0}</span>
            <span className="stat-label">Stock Disponible (Ventas)</span>
          </div>
        </div>

        <div className="stat-card animate-fade-in" style={{ cursor: 'pointer', animationDelay: '0.1s' }} onClick={() => navigate('/portal/pedidos')}>
          <div className="stat-icon" style={{ background: 'rgba(99,102,241,0.1)', color: 'var(--accent-secondary)' }}>
            <Clock size={20} />
          </div>
          <div className="stat-info">
            <span className="stat-value" style={{ color: 'var(--accent-secondary)' }}>{stats?.totalReservado || 0}</span>
            <span className="stat-label">Reservado en Trámite</span>
          </div>
        </div>

        <div className="stat-card animate-fade-in" style={{ cursor: 'pointer', animationDelay: '0.15s' }} onClick={() => navigate('/portal/inventario')}>
          <div className="stat-icon" style={{ background: 'rgba(245,158,11,0.1)', color: 'var(--warning)' }}>
            <AlertTriangle size={20} />
          </div>
          <div className="stat-info">
            <span className="stat-value" style={{ color: 'var(--warning)' }}>{stats?.totalCuarentena || 0}</span>
            <span className="stat-label">Cuarentena / Merma</span>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 20 }}>
        {/* Recent Orders */}
        <div className="card animate-fade-in" style={{ animationDelay: '0.2s' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
              <ShoppingCart size={16} style={{ color: 'var(--primary)' }} />
              Pedidos Recientes
            </h3>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('/portal/pedidos')}>
              Ver todos <ArrowRight size={13} />
            </button>
          </div>
          <div style={{ padding: '8px 20px' }}>
            {orders.length === 0 ? (
              <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-tertiary)' }}>No tienes pedidos activos aún.</div>
            ) : (
              orders.map((o, i) => (
                <div key={o.id} style={{ padding: '12px 0', borderBottom: i < orders.length - 1 ? '1px solid var(--border)' : 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{o.codigo}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                      {o.endCustomer?.nombre || 'Sin destino'} · {o.lineas?.length || 0} productos
                    </div>
                    {o.fechaCompromiso && (
                      <div style={{ fontSize: 11, color: 'var(--primary)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Calendar size={11} /> Cita: {new Date(o.fechaCompromiso).toLocaleDateString('es-MX')} {o.horaCompromiso ? `· ${o.horaCompromiso} hrs` : ''}
                      </div>
                    )}
                  </div>
                  {estadoBadge(o.estado)}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Inventory Summary */}
        <div className="card animate-fade-in" style={{ animationDelay: '0.25s' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Package size={16} style={{ color: 'var(--primary)' }} />
              Existencias por Producto
            </h3>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('/portal/inventario')}>
              Explorar <ArrowRight size={13} />
            </button>
          </div>
          <div style={{ padding: '8px 20px' }}>
            {(stats?.lotes?.length || 0) === 0 ? (
              <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-tertiary)' }}>Sin inventario registrado</div>
            ) : (
              stats.lotes.slice(0, 5).map((lot: any, i: number) => {
                const disp = Math.max(0, (lot.cantidadDisponible || 0) - (lot.cantidadReservada || 0));

                return (
                  <div key={lot.id} style={{ padding: '12px 0', borderBottom: i < 4 ? '1px solid var(--border)' : 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{lot.sku?.descripcion}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                        {lot.sku?.codigo} · Ubic: {lot.ubicacion?.codigo || 'En Almacén'}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: 700, color: 'var(--emerald)', fontSize: 14 }}>
                        {disp} {lot.sku?.uomBase || 'PZA'}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>disponibles</div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
