import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { API } from '../config/api';
import {
  GitBranch, Search, RefreshCw, Package, ArrowRight, MapPin,
  Calendar, User, Filter, ArrowDown, ArrowUp, Truck
} from 'lucide-react';

const TIPO_ICONS: Record<string, { icon: string; color: string; bg: string }> = {
  ENTRADA: { icon: '📥', color: 'var(--emerald)', bg: 'rgba(16,185,129,0.1)' },
  SALIDA: { icon: '📤', color: 'var(--danger)', bg: 'var(--danger-soft)' },
  TRASIEGO: { icon: '🔄', color: 'var(--info)', bg: 'var(--info-soft)' },
  AJUSTE_ENTRADA: { icon: '📊+', color: 'var(--teal)', bg: 'rgba(13,148,136,0.1)' },
  AJUSTE_SALIDA: { icon: '📊−', color: 'var(--orange)', bg: 'var(--warning-soft)' },
  PICKING: { icon: '📦', color: 'var(--purple)', bg: 'rgba(99,102,241,0.1)' },
};

export function Traceability() {
  const { token } = useAuth();
  const [movements, setMovements] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterTipo, setFilterTipo] = useState('');
  const [filterCliente, setFilterCliente] = useState('');
  const [clients, setClients] = useState<any[]>([]);
  const [skus, setSkus] = useState<any[]>([]);
  const headers: any = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [movRes, cliRes, skuRes] = await Promise.all([
        fetch(`${API}/inventory/movements`, { headers }),
        fetch(`${API}/clients`, { headers }),
        fetch(`${API}/skus`, { headers }),
      ]);
      if (movRes.ok) setMovements(await movRes.json());
      if (cliRes.ok) setClients(await cliRes.json());
      if (skuRes.ok) setSkus(await skuRes.json());
    } catch (err) { console.error(err); }
    setLoading(false);
  }

  const filtered = movements.filter(m => {
    const matchSearch = !search ||
      m.sku?.descripcion?.toLowerCase().includes(search.toLowerCase()) ||
      m.motivo?.toLowerCase().includes(search.toLowerCase()) ||
      m.usuario?.toLowerCase().includes(search.toLowerCase());
    const matchTipo = !filterTipo || m.tipoMovimiento === filterTipo;
    const matchCliente = !filterCliente || m.clienteId === filterCliente;
    return matchSearch && matchTipo && matchCliente;
  });

  // Group by date
  const grouped: Record<string, any[]> = {};
  filtered.forEach(m => {
    const date = new Date(m.fechaHora).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    if (!grouped[date]) grouped[date] = [];
    grouped[date].push(m);
  });

  const tipos = [...new Set(movements.map(m => m.tipoMovimiento))];
  const totalEntradas = movements.filter(m => m.tipoMovimiento === 'ENTRADA' || m.tipoMovimiento === 'AJUSTE_ENTRADA').reduce((s, m) => s + m.cantidad, 0);
  const totalSalidas = movements.filter(m => m.tipoMovimiento === 'SALIDA' || m.tipoMovimiento === 'AJUSTE_SALIDA').reduce((s, m) => s + m.cantidad, 0);

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Trazabilidad</h1>
          <p className="page-subtitle">{movements.length} movimientos · Historial completo de operaciones</p>
        </div>
        <button className="btn btn-secondary" onClick={loadData}><RefreshCw size={16} /> Actualizar</button>
      </div>

      {/* Summary stats */}
      <div className="stats-grid" style={{ marginBottom: 20 }}>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(16,185,129,0.1)', color: 'var(--emerald)' }}><ArrowDown size={20} /></div>
          <div className="stat-info"><span className="stat-value">{totalEntradas.toLocaleString()}</span><span className="stat-label">Uds Ingresadas</span></div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}><ArrowUp size={20} /></div>
          <div className="stat-info"><span className="stat-value">{totalSalidas.toLocaleString()}</span><span className="stat-label">Uds Despachadas</span></div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'var(--info-soft)', color: 'var(--info)' }}><GitBranch size={20} /></div>
          <div className="stat-info"><span className="stat-value">{movements.length}</span><span className="stat-label">Movimientos</span></div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(99,102,241,0.1)', color: 'var(--purple)' }}><User size={20} /></div>
          <div className="stat-info"><span className="stat-value">{new Set(movements.map(m => m.usuario)).size}</span><span className="stat-label">Operadores</span></div>
        </div>
      </div>

      {/* Filters */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 12, padding: '16px 20px', alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="search-box" style={{ flex: 1, minWidth: 200 }}>
            <Search size={16} />
            <input placeholder="Buscar por producto, motivo, usuario..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <select className="form-select" style={{ minWidth: 150 }} value={filterTipo} onChange={e => setFilterTipo(e.target.value)}>
            <option value="">Todos los tipos</option>
            {tipos.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select className="form-select" style={{ minWidth: 150 }} value={filterCliente} onChange={e => setFilterCliente(e.target.value)}>
            <option value="">Todos los clientes</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.nombreComercial}</option>)}
          </select>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-secondary)' }}><RefreshCw className="animate-spin" size={24} /> Cargando...</div>
      ) : (
        <div className="traceability-timeline">
          {Object.entries(grouped).map(([date, items]) => (
            <div key={date} className="timeline-day">
              <div className="timeline-date">
                <Calendar size={14} />
                <span>{date}</span>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>({items.length} mov.)</span>
              </div>
              <div className="timeline-items">
                {items.map((m: any, i: number) => {
                  const cfg = TIPO_ICONS[m.tipoMovimiento] || TIPO_ICONS.ENTRADA;
                  const client = clients.find(c => c.id === m.clienteId);
                  return (
                    <div key={m.id} className="timeline-item animate-fade-in" style={{ animationDelay: `${i * 0.03}s` }}>
                      <div className="timeline-dot" style={{ background: cfg.bg, color: cfg.color }}>
                        <span style={{ fontSize: 16 }}>{cfg.icon}</span>
                      </div>
                      <div className="timeline-content">
                        <div className="timeline-header">
                          <span className={`badge badge-${m.tipoMovimiento.includes('ENTRADA') ? 'success' : m.tipoMovimiento.includes('SALIDA') ? 'danger' : m.tipoMovimiento === 'TRASIEGO' ? 'info' : 'warning'}`}>
                            {m.tipoMovimiento}
                          </span>
                          <span className="timeline-qty" style={{ color: m.tipoMovimiento.includes('SALIDA') ? 'var(--danger)' : 'var(--emerald)' }}>
                            {m.tipoMovimiento.includes('SALIDA') ? '−' : '+'}{m.cantidad} uds
                          </span>
                          <span className="timeline-time">
                            {new Date(m.fechaHora).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <div className="timeline-product">
                          <Package size={13} />
                          <strong>{m.sku?.descripcion || 'Producto'}</strong>
                        </div>
                        <div className="timeline-details">
                          {m.motivo && <span className="timeline-detail">{m.motivo}</span>}
                        </div>
                        <div className="timeline-meta">
                          <span><User size={11} /> {m.usuario}</span>
                          {client && <span>🏢 {client.nombreComercial}</span>}
                          {m.toLocationId && <span><MapPin size={11} /> Ubicación asignada</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="card"><div style={{ padding: 60, textAlign: 'center', color: 'var(--text-tertiary)' }}>
              <GitBranch size={32} style={{ opacity: 0.3, marginBottom: 12 }} />
              <div>Sin movimientos registrados</div>
            </div></div>
          )}
        </div>
      )}
    </div>
  );
}
