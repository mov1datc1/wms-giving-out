import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { API } from '../../config/api';
import { Package, ShoppingCart, Clock, TrendingUp, Store, AlertCircle, Plus } from 'lucide-react';
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
        setOrders(all.slice(0, 5));
      }
    } catch (err) { console.error(err); }
    setLoading(false);
  }

  const estadoBadge = (estado: string) => {
    const map: any = {
      SOLICITADO: 'info', PENDIENTE_APROBACION: 'warning', APROBADO: 'success',
      EN_PICKING: 'info', CONSOLIDADO: 'warning', DESPACHADO: 'success',
      ENTREGADO: 'success', RECHAZADO: 'error',
    };
    return <span className={`badge badge-${map[estado] || 'default'}`}>{estado.replace(/_/g, ' ')}</span>;
  };

  if (loading) return <div style={{ textAlign: 'center', padding: 80, color: 'var(--text-secondary)' }}>Cargando...</div>;

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Bienvenido, {user?.nombre}</h1>
          <p className="page-subtitle">Portal de Depositante · {new Date().toLocaleDateString('es-MX', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
        </div>
        <button className="btn btn-primary" onClick={() => navigate('/portal/nuevo-pedido')}>
          <Plus size={16} /> Nuevo Pedido
        </button>
      </div>

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 24 }}>
        <div className="card animate-fade-in" style={{ padding: '20px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--primary-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary)' }}><Package size={20} /></div>
            <div>
              <div style={{ fontSize: 24, fontWeight: 700 }}>{stats?.totalSkus || 0}</div>
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>SKUs en Almacén</div>
            </div>
          </div>
        </div>
        <div className="card animate-fade-in" style={{ padding: '20px 24px', animationDelay: '0.1s' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--teal-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--teal)' }}><TrendingUp size={20} /></div>
            <div>
              <div style={{ fontSize: 24, fontWeight: 700 }}>{stats?.totalUnidades || 0}</div>
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Unidades Totales</div>
            </div>
          </div>
        </div>
        <div className="card animate-fade-in" style={{ padding: '20px 24px', animationDelay: '0.2s' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--orange-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--orange)' }}><ShoppingCart size={20} /></div>
            <div>
              <div style={{ fontSize: 24, fontWeight: 700 }}>{orders.length}</div>
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Pedidos Activos</div>
            </div>
          </div>
        </div>
        <div className="card animate-fade-in" style={{ padding: '20px 24px', animationDelay: '0.3s' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--purple-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--purple)' }}><Clock size={20} /></div>
            <div>
              <div style={{ fontSize: 24, fontWeight: 700 }}>{orders.filter(o => ['SOLICITADO', 'PENDIENTE_APROBACION'].includes(o.estado)).length}</div>
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Pendientes</div>
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        {/* Recent Orders */}
        <div className="card animate-fade-in" style={{ animationDelay: '0.4s' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}><ShoppingCart size={16} /> Pedidos Recientes</h3>
          </div>
          <div style={{ padding: '8px 20px' }}>
            {orders.length === 0 ? (
              <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-tertiary)' }}>No tienes pedidos aún</div>
            ) : (
              orders.map((o, i) => (
                <div key={o.id} style={{ padding: '10px 0', borderBottom: i < orders.length - 1 ? '1px solid var(--border)' : 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{o.codigo}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                      {o.endCustomer?.nombre || 'Sin destino'} · {o.lineas?.length} líneas
                    </div>
                  </div>
                  {estadoBadge(o.estado)}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Inventory Summary */}
        <div className="card animate-fade-in" style={{ animationDelay: '0.5s' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}><Package size={16} /> Inventario Resumen</h3>
          </div>
          <div style={{ padding: '8px 20px' }}>
            {(stats?.lotes?.length || 0) === 0 ? (
              <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-tertiary)' }}>Sin inventario activo</div>
            ) : (
              stats.lotes.slice(0, 6).map((lot: any, i: number) => (
                <div key={lot.id} style={{ padding: '10px 0', borderBottom: i < 5 ? '1px solid var(--border)' : 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{lot.sku?.descripcion}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{lot.sku?.codigo} · {lot.ubicacion?.codigo || 'Sin ubicación'}</div>
                  </div>
                  <div style={{ fontWeight: 700, color: 'var(--primary)' }}>{lot.cantidadDisponible} {lot.sku?.uomBase}</div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
