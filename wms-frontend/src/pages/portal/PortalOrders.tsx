import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { API } from '../../config/api';
import {
  ShoppingCart, RefreshCw, Clock, CheckCircle, Send, ThumbsDown, ThumbsUp,
  Package, Store, MapPin, ChevronDown, ChevronUp, Truck, UserCheck, ScanLine
} from 'lucide-react';

export function PortalOrders() {
  const { token, user } = useAuth();
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('all');
  const headers: any = { Authorization: `Bearer ${token}` };

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    try {
      const res = await fetch(`${API}/orders?clienteId=${user?.clienteId}`, { headers });
      if (res.ok) setOrders(await res.json());
    } catch (err) { console.error(err); }
    setLoading(false);
  }

  const estadoInfo = (estado: string) => {
    const map: any = {
      SOLICITADO: { cls: 'info', icon: <Clock size={12} />, label: 'Solicitado', desc: 'Pedido recibido, pendiente de revisión', step: 1 },
      PENDIENTE_APROBACION: { cls: 'warning', icon: <Clock size={12} />, label: 'En Revisión', desc: 'Giving Out está validando tu pedido', step: 1 },
      APROBADO: { cls: 'success', icon: <ThumbsUp size={12} />, label: 'Aprobado', desc: 'Tu pedido fue aprobado, pronto inicia la preparación', step: 2 },
      EN_PICKING: { cls: 'warning', icon: <ScanLine size={12} />, label: 'En Preparación', desc: 'Tu pedido está siendo preparado en almacén', step: 3 },
      CONSOLIDADO: { cls: 'info', icon: <Package size={12} />, label: 'Listo para Envío', desc: 'Tu pedido está embalado y listo para enviarse', step: 4 },
      DESPACHADO: { cls: 'warning', icon: <Truck size={12} />, label: 'En Tránsito', desc: 'Tu pedido fue despachado y está en camino', step: 5 },
      ENTREGADO: { cls: 'success', icon: <CheckCircle size={12} />, label: 'Entregado', desc: 'Tu pedido fue entregado exitosamente', step: 6 },
      RECHAZADO: { cls: 'error', icon: <ThumbsDown size={12} />, label: 'Rechazado', desc: 'Tu pedido fue rechazado', step: 0 },
      CANCELADO: { cls: 'error', icon: <ThumbsDown size={12} />, label: 'Cancelado', desc: 'Tu pedido fue cancelado', step: 0 },
    };
    return map[estado] || { cls: 'default', icon: null, label: estado, desc: '', step: 0 };
  };

  const filtered = orders.filter(o => {
    if (filter === 'all') return true;
    if (filter === 'active') return ['SOLICITADO', 'PENDIENTE_APROBACION', 'APROBADO', 'EN_PICKING', 'CONSOLIDADO', 'DESPACHADO'].includes(o.estado);
    if (filter === 'delivered') return o.estado === 'ENTREGADO';
    if (filter === 'rejected') return o.estado === 'RECHAZADO' || o.estado === 'CANCELADO';
    return true;
  });

  const activeCount = orders.filter(o => ['SOLICITADO', 'PENDIENTE_APROBACION', 'APROBADO', 'EN_PICKING', 'CONSOLIDADO', 'DESPACHADO'].includes(o.estado)).length;
  const deliveredCount = orders.filter(o => o.estado === 'ENTREGADO').length;
  const transitCount = orders.filter(o => o.estado === 'DESPACHADO').length;

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Mis Pedidos</h1>
          <p className="page-subtitle">{orders.length} pedidos · {activeCount} activos · {transitCount} en tránsito · {deliveredCount} entregados</p>
        </div>
        <button className="btn btn-secondary" onClick={loadData}><RefreshCw size={16} /> Actualizar</button>
      </div>

      {/* Filter chips */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {[
          { key: 'all', label: `Todos (${orders.length})` },
          { key: 'active', label: `Activos (${activeCount})` },
          { key: 'delivered', label: `Entregados (${deliveredCount})` },
          { key: 'rejected', label: `Rechazados` },
        ].map(f => (
          <button key={f.key}
            className={`btn btn-sm ${filter === f.key ? 'btn-primary' : 'btn-ghost'}`}
            style={{ borderRadius: 20, fontSize: 12, padding: '6px 14px' }}
            onClick={() => setFilter(f.key)}
          >{f.label}</button>
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-secondary)' }}>Cargando pedidos...</div>
      ) : filtered.length === 0 ? (
        <div className="card"><div style={{ padding: 60, textAlign: 'center', color: 'var(--text-tertiary)' }}>
          <ShoppingCart size={40} style={{ marginBottom: 12, opacity: 0.4 }} /><br />
          {filter === 'all' ? 'No tienes pedidos aún. Crea uno desde "Nuevo Pedido".' : 'No hay pedidos con este filtro.'}
        </div></div>
      ) : (
        <div style={{ display: 'grid', gap: 14 }}>
          {filtered.map((o, i) => {
            const info = estadoInfo(o.estado);
            const borderColor = info.cls === 'success' ? 'var(--emerald)' : info.cls === 'warning' ? 'var(--orange)' : info.cls === 'error' ? 'var(--error)' : 'var(--primary)';
            return (
              <div key={o.id} className="card animate-fade-in" style={{ animationDelay: `${i * 0.04}s`, borderLeft: `4px solid ${borderColor}` }}>
                <div style={{ padding: '20px 24px' }}>
                  {/* Header */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                        <span style={{ fontWeight: 700, fontSize: 16 }}>{o.codigo}</span>
                        <span className={`badge badge-${info.cls}`}>{info.icon} {info.label}</span>
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>{info.desc}</div>
                      <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--text-tertiary)', flexWrap: 'wrap' }}>
                        {o.endCustomer && <span><Store size={12} /> {o.endCustomer.nombre}</span>}
                        {o.endCustomer?.ciudad && <span><MapPin size={12} /> {o.endCustomer.ciudad}</span>}
                        <span>{o.lineas?.length} líneas · {o.lineas?.reduce((s: number, l: any) => s + l.cantidadSolicitada, 0)} uds</span>
                        <span>Creado: {new Date(o.createdAt).toLocaleDateString('es-MX')}</span>
                      </div>
                    </div>
                    <button className="btn btn-ghost btn-sm" onClick={() => setExpanded(expanded === o.id ? null : o.id)}>
                      {expanded === o.id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </button>
                  </div>

                  {/* Progress Timeline — always visible for active orders */}
                  {info.step > 0 && (
                    <div style={{ marginTop: 14 }}>
                      <OrderTimeline step={info.step} />
                    </div>
                  )}

                  {/* Rejection reason */}
                  {o.estado === 'RECHAZADO' && o.motivoRechazo && (
                    <div style={{ marginTop: 10, padding: '10px 14px', background: 'rgba(239,68,68,0.08)', borderRadius: 8, fontSize: 13, color: 'var(--error)', border: '1px solid rgba(239,68,68,0.2)' }}>
                      <strong>Motivo de rechazo:</strong> {o.motivoRechazo}
                    </div>
                  )}

                  {/* Shipping info */}
                  {(o.estado === 'DESPACHADO' || o.estado === 'ENTREGADO') && (
                    <div style={{ marginTop: 10, padding: '10px 14px', background: 'var(--bg-secondary)', borderRadius: 8 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                        Información de Envío
                      </div>
                      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13, color: 'var(--text-primary)' }}>
                        {o.paqueteria && <span>🚚 {o.paqueteria}</span>}
                        {o.numeroGuia && <span>📋 Guía: <strong>{o.numeroGuia}</strong></span>}
                        {o.tipoTransporte && <span>📦 {o.tipoTransporte.replace(/_/g, ' ')}</span>}
                        {o.vehiculoPlaca && <span>🚛 Placa: {o.vehiculoPlaca}</span>}
                        {o.fechaDespacho && <span>📅 Despachado: {new Date(o.fechaDespacho).toLocaleDateString('es-MX')}</span>}
                      </div>
                      {o.estado === 'ENTREGADO' && (
                        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)', display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13 }}>
                          {o.nombreReceptor && <span>✍️ Recibió: <strong>{o.nombreReceptor}</strong></span>}
                          {o.fechaEntrega && <span>📅 Entrega: {new Date(o.fechaEntrega).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>}
                          {o.notasEntrega && <span>📝 {o.notasEntrega}</span>}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Expanded line details */}
                  {expanded === o.id && (
                    <div style={{ marginTop: 14, padding: 14, background: 'var(--bg-secondary)', borderRadius: 8 }}>
                      <h4 style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>Detalle de Productos</h4>
                      <div style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                          <thead>
                            <tr style={{ background: 'var(--bg-primary)' }}>
                              <th style={{ textAlign: 'left', padding: '8px 12px', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-tertiary)', letterSpacing: 0.5 }}>Producto</th>
                              <th style={{ textAlign: 'left', padding: '8px 12px', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-tertiary)', letterSpacing: 0.5 }}>SKU</th>
                              <th style={{ textAlign: 'right', padding: '8px 12px', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-tertiary)', letterSpacing: 0.5 }}>Solicitado</th>
                              <th style={{ textAlign: 'right', padding: '8px 12px', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-tertiary)', letterSpacing: 0.5 }}>Asignado</th>
                            </tr>
                          </thead>
                          <tbody>
                            {o.lineas?.map((l: any) => (
                              <tr key={l.id} style={{ borderTop: '1px solid var(--border)' }}>
                                <td style={{ padding: '8px 12px', fontWeight: 500 }}>{l.sku?.descripcion}</td>
                                <td style={{ padding: '8px 12px' }}><code style={{ fontSize: 11 }}>{l.sku?.codigo}</code></td>
                                <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600 }}>{l.cantidadSolicitada}</td>
                                <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 700, color: l.cantidadAsignada >= l.cantidadSolicitada ? 'var(--emerald)' : l.cantidadAsignada > 0 ? 'var(--orange)' : 'var(--text-tertiary)' }}>
                                  {l.cantidadAsignada}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {o.notas && (
                        <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-tertiary)' }}>
                          📝 Notas: {o.notas}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ===== Order Progress Timeline Component =====
function OrderTimeline({ step }: { step: number }) {
  const steps = [
    { num: 1, label: 'Solicitado', icon: <Clock size={11} /> },
    { num: 2, label: 'Aprobado', icon: <ThumbsUp size={11} /> },
    { num: 3, label: 'Preparando', icon: <ScanLine size={11} /> },
    { num: 4, label: 'Listo', icon: <Package size={11} /> },
    { num: 5, label: 'Enviado', icon: <Truck size={11} /> },
    { num: 6, label: 'Entregado', icon: <CheckCircle size={11} /> },
  ];

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0, overflowX: 'auto' }}>
      {steps.map((s, i) => (
        <div key={s.num} style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 20,
            fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
            background: s.num <= step
              ? (s.num === step ? (step === 6 ? '#10b981' : '#0ea5e9') : 'rgba(14,165,233,0.15)')
              : 'var(--bg-secondary)',
            color: s.num <= step
              ? (s.num === step ? 'white' : '#0ea5e9')
              : 'var(--text-tertiary)',
            transition: 'all 0.3s',
          }}>
            {s.icon} {s.label}
          </div>
          {i < steps.length - 1 && (
            <div style={{
              width: 16, height: 2,
              background: s.num < step ? '#0ea5e9' : 'var(--border)',
              transition: 'all 0.3s',
            }} />
          )}
        </div>
      ))}
    </div>
  );
}
