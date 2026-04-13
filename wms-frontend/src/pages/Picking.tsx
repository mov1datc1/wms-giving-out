import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { API } from '../config/api';
import { ShoppingCart, Search, RefreshCw, ChevronDown, ChevronUp, AlertTriangle, Clock, CheckCircle, Package, Truck } from 'lucide-react';

export function Picking() {
  const { token } = useAuth();
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterEstado, setFilterEstado] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    try {
      const res = await fetch(`${API}/orders`, { headers });
      if (res.ok) setOrders(await res.json());
    } catch (err) { console.error(err); }
    setLoading(false);
  }

  async function updateStatus(id: string, estado: string) {
    try {
      await fetch(`${API}/orders/${id}/status`, { method: 'PUT', headers, body: JSON.stringify({ estado, usuario: 'admin@givingout.com' }) });
      loadData();
    } catch (err) { console.error(err); }
  }

  const filtered = orders.filter(o => {
    const matchSearch = !search || o.codigo?.toLowerCase().includes(search.toLowerCase()) || o.cliente?.nombreComercial?.toLowerCase().includes(search.toLowerCase()) || o.destinatario?.toLowerCase().includes(search.toLowerCase());
    const matchEstado = !filterEstado || o.estado === filterEstado;
    return matchSearch && matchEstado;
  });

  const prioridadLabel = (p: number) => p === 1 ? 'Urgente' : p === 2 ? 'Alta' : 'Normal';
  const prioridadColor = (p: number) => p === 1 ? 'danger' : p === 2 ? 'warning' : 'info';
  const estadoBadge = (e: string) => {
    switch (e) {
      case 'PENDIENTE': return 'info';
      case 'CONFIRMADO': return 'default';
      case 'EN_PICKING': return 'warning';
      case 'CONSOLIDADO': return 'info';
      case 'DESPACHADO': return 'success';
      case 'ENTREGADO': return 'success';
      case 'CANCELADO': return 'danger';
      default: return 'default';
    }
  };

  const totalLineas = (o: any) => o.lineas?.reduce((s: number, l: any) => s + l.cantidadSolicitada, 0) || 0;
  const totalAsignado = (o: any) => o.lineas?.reduce((s: number, l: any) => s + l.cantidadAsignada, 0) || 0;
  const pctProgress = (o: any) => { const t = totalLineas(o); return t ? Math.round((totalAsignado(o) / t) * 100) : 0; };

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Picking & Pedidos</h1>
          <p className="page-subtitle">{orders.length} órdenes · {orders.filter(o => o.estado === 'EN_PICKING').length} en picking</p>
        </div>
        <button className="btn btn-secondary" onClick={loadData}><RefreshCw size={16}/> Actualizar</button>
      </div>

      {/* Status summary */}
      <div className="stats-grid" style={{ marginBottom: 20 }}>
        {['PENDIENTE', 'CONFIRMADO', 'EN_PICKING', 'DESPACHADO'].map(estado => {
          const count = orders.filter(o => o.estado === estado).length;
          return (
            <div key={estado} className="stat-card" style={{ cursor: 'pointer', opacity: filterEstado && filterEstado !== estado ? 0.5 : 1 }} onClick={() => setFilterEstado(filterEstado === estado ? '' : estado)}>
              <div className="stat-info"><span className="stat-value">{count}</span><span className="stat-label">{estado.replace('_', ' ')}</span></div>
            </div>
          );
        })}
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 12, padding: '16px 20px' }}>
          <div className="search-box" style={{ flex: 1 }}><Search size={16}/><input placeholder="Buscar pedido, cliente, destino..." value={search} onChange={e => setSearch(e.target.value)}/></div>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-secondary)' }}><RefreshCw className="animate-spin" size={24}/> Cargando pedidos...</div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {filtered.map((o, i) => (
            <div key={o.id} className="card animate-fade-in" style={{ animationDelay: `${i * 0.04}s` }}>
              <div style={{ padding: '16px 20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    <span style={{ fontWeight: 700, fontSize: 15 }}>{o.codigo}</span>
                    <span className={`badge badge-${prioridadColor(o.prioridad)}`}>{prioridadLabel(o.prioridad)}</span>
                    <span className={`badge badge-${estadoBadge(o.estado)}`}>{o.estado.replace('_', ' ')}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {o.estado === 'PENDIENTE' && <button className="btn btn-sm btn-primary" onClick={() => updateStatus(o.id, 'CONFIRMADO')}>Confirmar</button>}
                    {o.estado === 'CONFIRMADO' && <button className="btn btn-sm btn-warning" onClick={() => updateStatus(o.id, 'EN_PICKING')}>Iniciar Picking</button>}
                    {o.estado === 'EN_PICKING' && <button className="btn btn-sm btn-success" onClick={() => updateStatus(o.id, 'CONSOLIDADO')}>Consolidar</button>}
                    <button className="btn btn-ghost btn-sm" onClick={() => setExpanded(expanded === o.id ? null : o.id)}>
                      {expanded === o.id ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}
                    </button>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 24, marginTop: 10, flexWrap: 'wrap', fontSize: 13, color: 'var(--text-secondary)' }}>
                  <span><Package size={13}/> {o.cliente?.nombreComercial}</span>
                  <span><Truck size={13}/> {o.destinatario}</span>
                  <span><Clock size={13}/> {new Date(o.fechaCompromiso).toLocaleDateString('es-MX')}</span>
                  <span style={{ fontWeight: 600 }}>{totalLineas(o)} uds · {o.lineas?.length || 0} líneas</span>
                </div>

                {/* Progress bar */}
                {o.estado !== 'DESPACHADO' && o.estado !== 'CANCELADO' && (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                      <span style={{ color: 'var(--text-tertiary)' }}>Progreso picking</span>
                      <span style={{ fontWeight: 600, color: 'var(--teal)' }}>{pctProgress(o)}%</span>
                    </div>
                    <div className="progress-bar"><div className="progress-fill" style={{ width: `${pctProgress(o)}%` }}></div></div>
                  </div>
                )}

                {expanded === o.id && (
                  <div style={{ marginTop: 12, padding: 12, background: 'var(--bg-secondary)', borderRadius: 8 }}>
                    <table className="data-table" style={{ fontSize: 13 }}>
                      <thead><tr><th>SKU</th><th>Descripción</th><th>Solicitado</th><th>Asignado</th><th>Estado</th></tr></thead>
                      <tbody>
                        {o.lineas?.map((l: any, j: number) => (
                          <tr key={j}>
                            <td><code>{l.sku?.codigo}</code></td>
                            <td>{l.sku?.descripcion}</td>
                            <td style={{ fontWeight: 600 }}>{l.cantidadSolicitada}</td>
                            <td style={{ fontWeight: 600, color: l.cantidadAsignada >= l.cantidadSolicitada ? 'var(--emerald)' : 'var(--orange)' }}>{l.cantidadAsignada}</td>
                            <td>{l.cantidadAsignada >= l.cantidadSolicitada ? <CheckCircle size={14} color="var(--emerald)"/> : <Clock size={14} color="var(--orange)"/>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {o.direccionEntrega && <p style={{ marginTop: 8, fontSize: 12, color: 'var(--text-tertiary)' }}>📍 {o.direccionEntrega}</p>}
                  </div>
                )}
              </div>
            </div>
          ))}
          {filtered.length === 0 && <div className="card"><div style={{ padding: 40, textAlign: 'center', color: 'var(--text-tertiary)' }}>Sin pedidos</div></div>}
        </div>
      )}
    </div>
  );
}
