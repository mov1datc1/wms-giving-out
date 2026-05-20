import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { API } from '../config/api';
import {
  Package, Search, RefreshCw, ChevronDown, ChevronUp, Clock, CheckCircle,
  ScanLine, MapPin, Box, ArrowRight, AlertCircle, X, Layers, BarChart3, Target
} from 'lucide-react';

export function Picking() {
  const { token, user } = useAuth();
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<'queue' | 'active' | 'done'>('queue');
  const [pickingModal, setPickingModal] = useState<any>(null);
  const [pickingLines, setPickingLines] = useState<any[]>([]);
  const headers: any = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    try {
      const res = await fetch(`${API}/orders`, { headers });
      if (res.ok) {
        const all = await res.json();
        setOrders(all.filter((o: any) => ['APROBADO', 'EN_PICKING', 'CONSOLIDADO'].includes(o.estado)));
      }
    } catch (err) { console.error(err); }
    setLoading(false);
  }

  async function startPicking(order: any) {
    try {
      await fetch(`${API}/orders/${order.id}/status`, {
        method: 'PUT', headers,
        body: JSON.stringify({ estado: 'EN_PICKING', usuario: user?.email })
      });
      loadData();
      openPickingPanel(order);
    } catch (err) { console.error(err); }
  }

  async function openPickingPanel(order: any) {
    setPickingModal(order);
    setPickingLines(
      order.lineas?.map((l: any) => ({
        ...l,
        cantidadPickeada: l.cantidadAsignada || 0,
        estado: l.cantidadAsignada >= l.cantidadSolicitada ? 'COMPLETO' : 'PENDIENTE',
      })) || []
    );
  }

  function updateLineQty(lineIdx: number, qty: number) {
    setPickingLines(prev => prev.map((l, i) =>
      i === lineIdx ? {
        ...l,
        cantidadPickeada: Math.max(0, Math.min(qty, l.cantidadSolicitada)),
        estado: qty >= l.cantidadSolicitada ? 'COMPLETO' : qty > 0 ? 'PARCIAL' : 'PENDIENTE',
      } : l
    ));
  }

  function pickAll(lineIdx: number) {
    const line = pickingLines[lineIdx];
    updateLineQty(lineIdx, line.cantidadSolicitada);
  }

  async function confirmPicking() {
    if (!pickingModal) return;
    try {
      // Update each line's cantidadAsignada
      for (const line of pickingLines) {
        if (line.cantidadPickeada > 0) {
          await fetch(`${API}/orders/${pickingModal.id}/status`, {
            method: 'PUT', headers,
            body: JSON.stringify({ estado: 'EN_PICKING', usuario: user?.email })
          });
        }
      }

      const allComplete = pickingLines.every(l => l.cantidadPickeada >= l.cantidadSolicitada);
      if (allComplete) {
        await fetch(`${API}/orders/${pickingModal.id}/status`, {
          method: 'PUT', headers,
          body: JSON.stringify({ estado: 'CONSOLIDADO', usuario: user?.email })
        });
      }

      setPickingModal(null);
      loadData();
    } catch (err) { console.error(err); }
  }

  const queueOrders = orders.filter(o => o.estado === 'APROBADO');
  const activeOrders = orders.filter(o => o.estado === 'EN_PICKING');
  const doneOrders = orders.filter(o => o.estado === 'CONSOLIDADO');
  const currentTab = tab === 'queue' ? queueOrders : tab === 'active' ? activeOrders : doneOrders;

  const filtered = currentTab.filter(o => {
    if (!search) return true;
    const s = search.toLowerCase();
    return o.codigo?.toLowerCase().includes(s) ||
      o.cliente?.nombreComercial?.toLowerCase().includes(s) ||
      o.endCustomer?.nombre?.toLowerCase().includes(s);
  });

  const totalLineas = (o: any) => o.lineas?.reduce((s: number, l: any) => s + l.cantidadSolicitada, 0) || 0;
  const totalAsignado = (o: any) => o.lineas?.reduce((s: number, l: any) => s + l.cantidadAsignada, 0) || 0;
  const pctProgress = (o: any) => { const t = totalLineas(o); return t ? Math.round((totalAsignado(o) / t) * 100) : 0; };

  const prioridadLabel = (p: number) => p === 1 ? '🔴 Urgente' : p === 2 ? '🟡 Alta' : '🟢 Normal';

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Picking</h1>
          <p className="page-subtitle">
            {queueOrders.length} en cola · {activeOrders.length} en proceso · {doneOrders.length} consolidados
          </p>
        </div>
        <button className="btn btn-secondary" onClick={loadData}><RefreshCw size={16} /> Actualizar</button>
      </div>

      {/* KPI Ribbon */}
      <div className="stats-grid" style={{ marginBottom: 20 }}>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(99,102,241,0.15)', color: '#6366f1' }}><Layers size={20} /></div>
          <div className="stat-info"><span className="stat-value">{queueOrders.length}</span><span className="stat-label">En Cola</span></div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(245,158,11,0.15)', color: '#f59e0b' }}><ScanLine size={20} /></div>
          <div className="stat-info"><span className="stat-value">{activeOrders.length}</span><span className="stat-label">En Picking</span></div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(16,185,129,0.15)', color: '#10b981' }}><CheckCircle size={20} /></div>
          <div className="stat-info"><span className="stat-value">{doneOrders.length}</span><span className="stat-label">Consolidados</span></div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(14,165,233,0.15)', color: '#0ea5e9' }}><BarChart3 size={20} /></div>
          <div className="stat-info"><span className="stat-value">{orders.reduce((s, o) => s + totalLineas(o), 0)}</span><span className="stat-label">Unidades Totales</span></div>
        </div>
      </div>

      {/* Tabs */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
          {[
            { key: 'queue' as const, icon: <Layers size={15} />, label: 'Cola de Picking', count: queueOrders.length },
            { key: 'active' as const, icon: <ScanLine size={15} />, label: 'En Proceso', count: activeOrders.length },
            { key: 'done' as const, icon: <CheckCircle size={15} />, label: 'Consolidados', count: doneOrders.length },
          ].map(t => (
            <button
              key={t.key}
              className="btn btn-ghost"
              style={{
                flex: 1, borderBottom: tab === t.key ? '2px solid var(--primary)' : 'none',
                borderRadius: 0, fontWeight: tab === t.key ? 700 : 400,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}
              onClick={() => setTab(t.key)}
            >
              {t.icon} {t.label} {t.count > 0 && <span className="sidebar-badge">{t.count}</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Search */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ padding: '12px 16px' }}>
          <div className="search-box"><Search size={16} /><input placeholder="Buscar pedido, depositante, destino..." value={search} onChange={e => setSearch(e.target.value)} /></div>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-secondary)' }}><RefreshCw className="animate-spin" size={24} /> Cargando pedidos...</div>
      ) : (
        <div style={{ display: 'grid', gap: 14 }}>
          {filtered.map((o, i) => (
            <div key={o.id} className="card animate-fade-in" style={{
              animationDelay: `${i * 0.04}s`,
              borderLeft: `4px solid ${
                o.estado === 'CONSOLIDADO' ? 'var(--emerald)' :
                o.estado === 'EN_PICKING' ? 'var(--orange)' : 'var(--primary)'
              }`
            }}>
              <div style={{ padding: '18px 22px' }}>
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <span style={{ fontWeight: 700, fontSize: 16 }}>{o.codigo}</span>
                    <span className={`badge badge-${o.estado === 'CONSOLIDADO' ? 'success' : o.estado === 'EN_PICKING' ? 'warning' : 'info'}`}>
                      {o.estado === 'CONSOLIDADO' ? '✅ Consolidado' : o.estado === 'EN_PICKING' ? '🔄 En Picking' : '⏳ En Cola'}
                    </span>
                    <span className="badge badge-default" style={{ fontSize: 11 }}>{prioridadLabel(o.prioridad)}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {o.estado === 'APROBADO' && (
                      <button className="btn btn-primary" onClick={() => startPicking(o)}>
                        <ScanLine size={16} /> Iniciar Picking
                      </button>
                    )}
                    {o.estado === 'EN_PICKING' && (
                      <button className="btn btn-warning" onClick={() => openPickingPanel(o)}>
                        <Target size={16} /> Continuar Picking
                      </button>
                    )}
                    {o.estado === 'CONSOLIDADO' && (
                      <span style={{ fontSize: 13, color: 'var(--emerald)', fontWeight: 600 }}>✅ Listo para despacho</span>
                    )}
                  </div>
                </div>

                {/* Info row */}
                <div style={{ display: 'flex', gap: 20, fontSize: 13, color: 'var(--text-secondary)', flexWrap: 'wrap', marginBottom: 10 }}>
                  <span><Package size={13} /> {o.cliente?.nombreComercial}</span>
                  {o.endCustomer && <span><MapPin size={13} /> {o.endCustomer.nombre}{o.endCustomer.ciudad ? ` · ${o.endCustomer.ciudad}` : ''}</span>}
                  <span>{o.lineas?.length} líneas · {totalLineas(o)} uds</span>
                  {o.fechaCompromiso && <span><Clock size={13} /> {new Date(o.fechaCompromiso).toLocaleDateString('es-MX')}</span>}
                </div>

                {/* Progress */}
                {o.estado === 'EN_PICKING' && (
                  <div style={{ marginTop: 4 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                      <span style={{ color: 'var(--text-tertiary)' }}>Progreso: {totalAsignado(o)} / {totalLineas(o)} uds</span>
                      <span style={{ fontWeight: 700, color: pctProgress(o) === 100 ? 'var(--emerald)' : 'var(--orange)' }}>{pctProgress(o)}%</span>
                    </div>
                    <div className="progress-bar"><div className="progress-fill" style={{ width: `${pctProgress(o)}%` }}></div></div>
                  </div>
                )}

                {/* Expandable lines */}
                <details style={{ marginTop: 10 }}>
                  <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <ChevronDown size={12} /> Ver líneas del pedido
                  </summary>
                  <div style={{ marginTop: 10, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)' }}>
                    <table className="data-table" style={{ fontSize: 13 }}>
                      <thead><tr><th>SKU</th><th>Producto</th><th>Solicitado</th><th>Pickeado</th><th>Estado</th></tr></thead>
                      <tbody>
                        {o.lineas?.map((l: any, j: number) => (
                          <tr key={j}>
                            <td><code style={{ fontSize: 11 }}>{l.sku?.codigo}</code></td>
                            <td>{l.sku?.descripcion}</td>
                            <td style={{ fontWeight: 600 }}>{l.cantidadSolicitada}</td>
                            <td style={{ fontWeight: 700, color: l.cantidadAsignada >= l.cantidadSolicitada ? 'var(--emerald)' : 'var(--orange)' }}>
                              {l.cantidadAsignada}
                            </td>
                            <td>
                              {l.cantidadAsignada >= l.cantidadSolicitada ?
                                <span style={{ color: 'var(--emerald)', display: 'flex', alignItems: 'center', gap: 4 }}><CheckCircle size={14} /> Completo</span> :
                                l.cantidadAsignada > 0 ?
                                  <span style={{ color: 'var(--orange)', display: 'flex', alignItems: 'center', gap: 4 }}><Clock size={14} /> Parcial</span> :
                                  <span style={{ color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', gap: 4 }}><AlertCircle size={14} /> Pendiente</span>
                              }
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="card">
              <div style={{ padding: 50, textAlign: 'center', color: 'var(--text-tertiary)' }}>
                {tab === 'queue' ? 'No hay pedidos aprobados pendientes de picking' :
                 tab === 'active' ? 'No hay pedidos en proceso de picking' :
                 'No hay pedidos consolidados'}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ===== PICKING MODAL ===== */}
      {pickingModal && (
        <div className="modal-overlay" onClick={() => setPickingModal(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 750 }}>
            <div className="modal-header">
              <h2><ScanLine size={20} /> Picking — {pickingModal.codigo}</h2>
              <button className="btn btn-ghost btn-sm" onClick={() => setPickingModal(null)}><X size={18} /></button>
            </div>
            <div className="modal-body" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
              {/* Order info */}
              <div style={{ display: 'flex', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
                <div className="card" style={{ flex: 1, minWidth: 200, padding: '14px 18px', background: 'var(--bg-secondary)' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Depositante</div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{pickingModal.cliente?.nombreComercial}</div>
                </div>
                <div className="card" style={{ flex: 1, minWidth: 200, padding: '14px 18px', background: 'var(--bg-secondary)' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Destino (Ship-To)</div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{pickingModal.endCustomer?.nombre || 'N/A'}</div>
                  {pickingModal.endCustomer?.calle && <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{pickingModal.endCustomer.calle}, {pickingModal.endCustomer.ciudad}</div>}
                </div>
              </div>

              {/* Lines */}
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, display: 'flex', justifyContent: 'space-between' }}>
                <span>Líneas de Picking ({pickingLines.length})</span>
                <span style={{ color: pickingLines.every(l => l.estado === 'COMPLETO') ? 'var(--emerald)' : 'var(--orange)' }}>
                  {pickingLines.filter(l => l.estado === 'COMPLETO').length} / {pickingLines.length} completas
                </span>
              </div>

              {pickingLines.map((line, idx) => (
                <div key={idx} style={{
                  padding: '14px 18px', marginBottom: 10, borderRadius: 10,
                  border: `2px solid ${line.estado === 'COMPLETO' ? 'var(--emerald)' : line.estado === 'PARCIAL' ? 'var(--orange)' : 'var(--border)'}`,
                  background: line.estado === 'COMPLETO' ? 'rgba(16,185,129,0.05)' : 'transparent',
                  transition: 'all 0.3s ease',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                        <code style={{ fontSize: 12, color: 'var(--primary)', fontWeight: 700 }}>{line.sku?.codigo}</code>
                        <span style={{ fontSize: 14, fontWeight: 600 }}>{line.sku?.descripcion}</span>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                        Solicitado: <span style={{ fontWeight: 700 }}>{line.cantidadSolicitada}</span> uds
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                        <span style={{ fontSize: 10, color: 'var(--text-tertiary)', marginBottom: 4 }}>PICKEADO</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <button className="btn btn-ghost btn-sm" style={{ width: 28, height: 28, padding: 0, borderRadius: '50%', border: '1px solid var(--border)' }}
                            onClick={() => updateLineQty(idx, line.cantidadPickeada - 1)}>−</button>
                          <input
                            type="number"
                            value={line.cantidadPickeada}
                            onChange={e => updateLineQty(idx, parseInt(e.target.value) || 0)}
                            style={{
                              width: 65, height: 36, textAlign: 'center', fontWeight: 700, fontSize: 16,
                              border: `2px solid ${line.estado === 'COMPLETO' ? 'var(--emerald)' : 'var(--border)'}`,
                              borderRadius: 8, background: 'var(--bg-primary)', color: 'var(--text-primary)',
                            }}
                          />
                          <button className="btn btn-ghost btn-sm" style={{ width: 28, height: 28, padding: 0, borderRadius: '50%', border: '1px solid var(--border)' }}
                            onClick={() => updateLineQty(idx, line.cantidadPickeada + 1)}>+</button>
                        </div>
                      </div>
                      <button
                        className={`btn btn-sm ${line.estado === 'COMPLETO' ? 'btn-success' : 'btn-primary'}`}
                        style={{ height: 36, minWidth: 80 }}
                        onClick={() => pickAll(idx)}
                        disabled={line.estado === 'COMPLETO'}
                      >
                        {line.estado === 'COMPLETO' ? <><CheckCircle size={14} /> OK</> : <><ArrowRight size={14} /> Completar</>}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="modal-footer" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <button className="btn btn-ghost" onClick={() => setPickingModal(null)}>Cerrar (guardar parcial)</button>
              {pickingLines.every(l => l.estado === 'COMPLETO') ? (
                <button className="btn btn-success" style={{ fontWeight: 700 }} onClick={confirmPicking}>
                  <CheckCircle size={16} /> Consolidar Pedido
                </button>
              ) : (
                <button className="btn btn-primary" onClick={confirmPicking}>
                  <Package size={16} /> Guardar Progreso ({pickingLines.filter(l => l.estado === 'COMPLETO').length}/{pickingLines.length})
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
