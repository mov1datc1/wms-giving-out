import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { API } from '../config/api';
import {
  Package, Users, ClipboardList, AlertTriangle, TrendingUp,
  ArrowDownLeft, ArrowUpRight, RefreshCw, BarChart3, Boxes
} from 'lucide-react';

interface DashboardStats {
  totalSkus: number;
  totalClients: number;
  totalLots: number;
  totalOrders: number;
  pendingOrders: number;
  activeAlerts: number;
  totalUnidades: number;
  recentMovements: any[];
}

interface InventorySummary {
  totalUnidades: number;
  totalReservado: number;
  totalSkus: number;
  totalLotes: number;
  porCliente: { nombre: string; unidades: number; skus: number }[];
}

export function Dashboard() {
  const { user, token } = useAuth();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [summary, setSummary] = useState<InventorySummary | null>(null);
  const [orders, setOrders] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [statsRes, summaryRes, ordersRes, alertsRes] = await Promise.all([
        fetch(`${API}/dashboard/stats`, { headers }),
        fetch(`${API}/inventory/summary`, { headers }),
        fetch(`${API}/orders?estado=PENDIENTE`, { headers }),
        fetch(`${API}/alerts`, { headers }).catch(() => ({ ok: false, json: () => [] })),
      ]);
      if (statsRes.ok) setStats(await statsRes.json());
      if (summaryRes.ok) setSummary(await summaryRes.json());
      if (ordersRes.ok) setOrders(await ordersRes.json());
      try { const a = alertsRes.ok ? await (alertsRes as any).json() : []; setAlerts(Array.isArray(a) ? a : []); } catch { setAlerts([]); }
    } catch (err) { console.error('Dashboard load error:', err); }
    setLoading(false);
  }

  const statCards = [
    { label: 'SKUs Activos', value: stats?.totalSkus ?? '—', icon: Package, color: 'var(--teal)' },
    { label: 'Clientes', value: stats?.totalClients ?? '—', icon: Users, color: 'var(--emerald)' },
    { label: 'Unidades Stock', value: stats?.totalUnidades?.toLocaleString() ?? '—', icon: Boxes, color: 'var(--cyan)' },
    { label: 'Lotes Activos', value: stats?.totalLots ?? '—', icon: BarChart3, color: 'var(--purple)' },
    { label: 'Pedidos Pendientes', value: stats?.pendingOrders ?? '—', icon: ClipboardList, color: 'var(--orange)' },
    { label: 'Alertas Activas', value: stats?.activeAlerts ?? '—', icon: AlertTriangle, color: 'var(--rose)' },
  ];

  if (loading) {
    return (
      <div className="page-container">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 400, color: 'var(--text-secondary)' }}>
          <RefreshCw className="animate-spin" size={24} style={{ marginRight: 12 }} /> Cargando dashboard...
        </div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">Bienvenido, {user?.nombre} · {new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
        </div>
        <button className="btn btn-secondary" onClick={loadData}>
          <RefreshCw size={16} /> Actualizar
        </button>
      </div>

      {/* Stat Cards */}
      <div className="stats-grid">
        {statCards.map((card, i) => (
          <div key={i} className="stat-card animate-fade-in" style={{ animationDelay: `${i * 0.05}s` }}>
            <div className="stat-icon" style={{ background: `${card.color}20`, color: card.color }}>
              <card.icon size={22} />
            </div>
            <div className="stat-info">
              <span className="stat-value">{card.value}</span>
              <span className="stat-label">{card.label}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Two columns */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginTop: 24 }}>
        {/* Inventory by Client */}
        <div className="card animate-fade-in" style={{ animationDelay: '0.3s' }}>
          <div className="card-header">
            <h3><TrendingUp size={18} /> Inventario por Cliente</h3>
          </div>
          <div className="card-body">
            {summary?.porCliente?.length ? summary.porCliente.map((c, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: i < summary.porCliente.length - 1 ? '1px solid var(--border)' : 'none' }}>
                <div>
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{c.nombre}</div>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{c.skus} SKUs activos</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 700, fontSize: 18, color: 'var(--teal)' }}>{c.unidades.toLocaleString()}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>unidades</div>
                </div>
              </div>
            )) : (
              <p style={{ color: 'var(--text-tertiary)', padding: 20, textAlign: 'center' }}>Sin inventario activo</p>
            )}
            {summary && (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16, padding: '12px 16px', background: 'var(--bg-secondary)', borderRadius: 8 }}>
                <span style={{ color: 'var(--text-secondary)' }}>Total reservado:</span>
                <span style={{ fontWeight: 600, color: 'var(--orange)' }}>{summary.totalReservado?.toLocaleString() || 0} uds</span>
              </div>
            )}
          </div>
        </div>

        {/* Alerts */}
        <div className="card animate-fade-in" style={{ animationDelay: '0.35s' }}>
          <div className="card-header">
            <h3><AlertTriangle size={18} /> Alertas Activas</h3>
          </div>
          <div className="card-body">
            {alerts.length > 0 ? alerts.slice(0, 6).map((alert: any, i: number) => (
              <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '10px 0', borderBottom: i < Math.min(alerts.length, 6) - 1 ? '1px solid var(--border)' : 'none' }}>
                <span className={`badge badge-${alert.prioridad === 'CRITICA' ? 'danger' : alert.prioridad === 'ALTA' ? 'warning' : 'info'}`}>
                  {alert.prioridad}
                </span>
                <div>
                  <div style={{ fontWeight: 500, fontSize: 13 }}>{alert.titulo}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{alert.detalle}</div>
                </div>
              </div>
            )) : (
              <p style={{ color: 'var(--text-tertiary)', padding: 20, textAlign: 'center' }}>✅ Sin alertas pendientes</p>
            )}
          </div>
        </div>
      </div>

      {/* Recent Movements */}
      <div className="card animate-fade-in" style={{ marginTop: 20, animationDelay: '0.4s' }}>
        <div className="card-header">
          <h3><RefreshCw size={18} /> Movimientos Recientes</h3>
        </div>
        <div className="card-body" style={{ padding: 0 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Tipo</th>
                <th>SKU</th>
                <th>Cantidad</th>
                <th>Ubicación</th>
                <th>Usuario</th>
                <th>Fecha</th>
              </tr>
            </thead>
            <tbody>
              {stats?.recentMovements?.length ? stats.recentMovements.map((m: any, i: number) => (
                <tr key={i}>
                  <td>
                    <span className={`badge badge-${m.tipoMovimiento === 'ENTRADA' ? 'success' : m.tipoMovimiento === 'SALIDA' ? 'danger' : 'info'}`}>
                      {m.tipoMovimiento === 'ENTRADA' ? <><ArrowDownLeft size={12}/> Entrada</> : m.tipoMovimiento === 'SALIDA' ? <><ArrowUpRight size={12}/> Salida</> : m.tipoMovimiento}
                    </span>
                  </td>
                  <td style={{ fontWeight: 500 }}>{m.sku?.descripcion || m.skuId}</td>
                  <td style={{ fontWeight: 600 }}>{m.cantidad}</td>
                  <td>{m.toLocation?.codigo || m.fromLocation?.codigo || '—'}</td>
                  <td>{m.usuario?.split('@')[0]}</td>
                  <td style={{ color: 'var(--text-tertiary)', fontSize: 13 }}>{new Date(m.fechaHora).toLocaleDateString('es-MX')}</td>
                </tr>
              )) : (
                <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-tertiary)', padding: 24 }}>Sin movimientos recientes</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pending Orders */}
      {orders.length > 0 && (
        <div className="card animate-fade-in" style={{ marginTop: 20, animationDelay: '0.45s' }}>
          <div className="card-header">
            <h3><ClipboardList size={18} /> Pedidos Pendientes</h3>
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Cliente</th>
                  <th>Destinatario</th>
                  <th>Prioridad</th>
                  <th>Estado</th>
                  <th>Compromiso</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o: any, i: number) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 600 }}>{o.codigo}</td>
                    <td>{o.cliente?.nombreComercial}</td>
                    <td>{o.destinatario}</td>
                    <td><span className={`badge badge-${o.prioridad === 1 ? 'danger' : o.prioridad === 2 ? 'warning' : 'info'}`}>P{o.prioridad}</span></td>
                    <td><span className="badge badge-warning">{o.estado}</span></td>
                    <td>{new Date(o.fechaCompromiso).toLocaleDateString('es-MX')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
