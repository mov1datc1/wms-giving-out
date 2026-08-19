import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { API } from '../../config/api';
import {
  ShoppingCart, RefreshCw, Clock, CheckCircle, Send, ThumbsDown, ThumbsUp,
  Package, Store, MapPin, ChevronDown, ChevronUp, Truck, UserCheck, ScanLine,
  Calendar, Lock, Building2, Plus
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export function PortalOrders() {
  const { token, user } = useAuth();
  const navigate = useNavigate();
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
      SOLICITADO: { cls: 'info', icon: <Clock size={12} />, label: 'Solicitado', desc: 'Pedido recibido con stock reservado. Pendiente de validación.', step: 1 },
      PENDIENTE_APROBACION: { cls: 'warning', icon: <Clock size={12} />, label: 'En Revisión', desc: 'Giving Out está validando tu pedido', step: 1 },
      APROBADO: { cls: 'success', icon: <ThumbsUp size={12} />, label: 'Aprobado', desc: 'Pedido aprobado. Stock formalmente reservado para preparación.', step: 2 },
      EN_PICKING: { cls: 'warning', icon: <ScanLine size={12} />, label: 'En Preparación', desc: 'Tu pedido está siendo recolectado en racks', step: 3 },
      CONSOLIDADO: { cls: 'info', icon: <Package size={12} />, label: 'Listo para Envío', desc: 'Tu pedido está embalado y etiquetado para el transporte', step: 4 },
      DESPACHADO: { cls: 'warning', icon: <Truck size={12} />, label: 'En Tránsito', desc: 'Tu pedido fue despachado y va en camino', step: 5 },
      ENTREGADO: { cls: 'success', icon: <CheckCircle size={12} />, label: 'Entregado', desc: 'Tu pedido fue recibido de conformidad en destino', step: 6 },
      RECHAZADO: { cls: 'error', icon: <ThumbsDown size={12} />, label: 'Rechazado', desc: 'Tu pedido fue cancelado o rechazado (stock liberado)', step: 0 },
      CANCELADO: { cls: 'default', icon: <ThumbsDown size={12} />, label: 'Cancelado', desc: 'Tu pedido fue cancelado (stock liberado)', step: 0 },
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
          <h1 className="page-title">Mis Pedidos de Salida</h1>
          <p className="page-subtitle">{orders.length} pedidos registrados · {activeCount} activos con stock reservado</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" onClick={() => navigate('/portal/nuevo-pedido')}>
            <Plus size={16} /> Nuevo Pedido
          </button>
          <button className="btn btn-secondary" onClick={loadData}><RefreshCw size={16} /> Actualizar</button>
        </div>
      </div>

      {/* Filter chips */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {[
          { key: 'all', label: `Todos (${orders.length})` },
          { key: 'active', label: `Activos (${activeCount})` },
          { key: 'delivered', label: `Entregados (${deliveredCount})` },
          { key: 'rejected', label: `Cancelados / Rechazados` },
        ].map(f => (
          <button 
            key={f.key}
            className={`btn btn-sm ${filter === f.key ? 'btn-primary' : 'btn-ghost'}`}
            style={{ borderRadius: 20, fontSize: 12, padding: '6px 14px' }}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-secondary)' }}>
          <RefreshCw className="animate-spin" size={24} /> Cargando pedidos...
        </div>
      ) : filtered.length === 0 ? (
        <div className="card">
          <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-tertiary)' }}>
            <ShoppingCart size={40} style={{ margin: '0 auto 12px', opacity: 0.3 }} />
            <div>{filter === 'all' ? 'No tienes pedidos registrados aún.' : 'No hay pedidos con el filtro seleccionado.'}</div>
            <button className="btn btn-primary btn-sm" onClick={() => navigate('/portal/nuevo-pedido')} style={{ marginTop: 14 }}>
              Crear mi primer pedido
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 14 }}>
          {filtered.map((o, i) => {
            const info = estadoInfo(o.estado);
            const isLocked = ['APROBADO', 'EN_PICKING', 'CONSOLIDADO', 'DESPACHADO'].includes(o.estado);

            return (
              <div key={o.id} className="card animate-fade-in" style={{ animationDelay: `${i * 0.03}s` }}>
                <div style={{ padding: '20px 24px' }}>
                  {/* Header */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
                    <div style={{ flex: 1, minWidth: 260 }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 700, fontSize: 16 }}>{o.codigo}</span>
                        <span className={`badge badge-${info.cls}`}>{info.icon} {info.label}</span>
                        {isLocked && (
                          <span className="badge badge-default" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <Lock size={11} /> Stock Reservado
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>{info.desc}</div>
                      
                      <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--text-tertiary)', flexWrap: 'wrap' }}>
                        {o.endCustomer && <span><Store size={12} /> Destino: <strong>{o.endCustomer.nombre}</strong></span>}
                        {o.endCustomer?.ciudad && <span><MapPin size={12} /> {o.endCustomer.ciudad}</span>}
                        <span><Package size={12} /> {o.lineas?.length || 0} líneas ({o.lineas?.reduce((s: number, l: any) => s + l.cantidadSolicitada, 0)} piezas)</span>
                        {o.fechaCompromiso && (
                          <span style={{ color: 'var(--primary)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <Calendar size={12} /> Cita: {new Date(o.fechaCompromiso).toLocaleDateString('es-MX')} {o.horaCompromiso ? `(${o.horaCompromiso} hrs)` : ''}
                          </span>
                        )}
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => setExpanded(expanded === o.id ? null : o.id)}>
                        {expanded === o.id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </button>
                    </div>
                  </div>

                  {/* Progress Timeline */}
                  {info.step > 0 && (
                    <div style={{ marginTop: 14 }}>
                      <OrderTimeline step={info.step} />
                    </div>
                  )}

                  {/* Rejection reason */}
                  {o.estado === 'RECHAZADO' && o.motivoRechazo && (
                    <div style={{ marginTop: 12, padding: '10px 14px', background: 'rgba(239,68,68,0.08)', borderRadius: 8, fontSize: 13, color: 'var(--error)', border: '1px solid rgba(239,68,68,0.2)' }}>
                      <strong>Motivo de rechazo:</strong> {o.motivoRechazo}
                    </div>
                  )}

                  {/* Shipping info */}
                  {(o.estado === 'DESPACHADO' || o.estado === 'ENTREGADO') && (
                    <div style={{ marginTop: 12, padding: '10px 14px', background: 'var(--bg-secondary)', borderRadius: 8, border: '1px solid var(--border)' }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--primary)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                        🚚 Información de Transporte & Despacho
                      </div>
                      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13 }}>
                        {o.paqueteria && <span>Transporte: <strong>{o.paqueteria}</strong></span>}
                        {o.numeroGuia && <span>Guía / Rastreo: <strong>{o.numeroGuia}</strong></span>}
                        {o.vehiculoPlaca && <span>Placa: <strong>{o.vehiculoPlaca}</strong></span>}
                        {o.fechaDespacho && <span>Despachado: <strong>{new Date(o.fechaDespacho).toLocaleDateString('es-MX')}</strong></span>}
                      </div>
                      {o.estado === 'ENTREGADO' && (
                        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)', display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13 }}>
                          {o.nombreReceptor && <span>✍️ Recibió: <strong>{o.nombreReceptor}</strong></span>}
                          {o.fechaEntrega && <span>Fecha Entrega: <strong>{new Date(o.fechaEntrega).toLocaleDateString('es-MX')}</strong></span>}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Expanded line details */}
                  {expanded === o.id && (
                    <div style={{ marginTop: 14, padding: 14, background: 'var(--bg-secondary)', borderRadius: 8, border: '1px solid var(--border)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                        <h4 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)' }}>
                          Detalle de Productos Solicitados
                        </h4>
                        {isLocked && (
                          <span style={{ fontSize: 11, color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', gap: 4 }}>
                            <Lock size={11} /> Bloqueado para modificación en piso
                          </span>
                        )}
                      </div>

                      <div style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)', background: 'var(--bg-card)' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                          <thead>
                            <tr style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}>
                              <th style={{ textAlign: 'left', padding: '8px 12px', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>Producto</th>
                              <th style={{ textAlign: 'left', padding: '8px 12px', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>SKU</th>
                              <th style={{ textAlign: 'center', padding: '8px 12px', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>Solicitado</th>
                              <th style={{ textAlign: 'center', padding: '8px 12px', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>Reservado/Asignado</th>
                            </tr>
                          </thead>
                          <tbody>
                            {o.lineas?.map((l: any) => (
                              <tr key={l.id} style={{ borderBottom: '1px solid var(--border)' }}>
                                <td style={{ padding: '10px 12px', fontWeight: 500 }}>{l.sku?.descripcion}</td>
                                <td style={{ padding: '10px 12px' }}><code style={{ fontSize: 12 }}>{l.sku?.codigo}</code></td>
                                <td style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 600 }}>{l.cantidadSolicitada}</td>
                                <td style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 700, color: 'var(--emerald)' }}>
                                  {l.cantidadAsignada || l.cantidadSolicitada}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {o.notas && (
                        <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-tertiary)' }}>
                          📝 Instrucciones: {o.notas}
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
    <div style={{ display: 'flex', alignItems: 'center', gap: 0, overflowX: 'auto', padding: '4px 0' }}>
      {steps.map((s, i) => (
        <div key={s.num} style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 20,
            fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
            background: s.num <= step
              ? (s.num === step ? 'var(--primary)' : 'rgba(13,148,136,0.15)')
              : 'var(--bg-secondary)',
            color: s.num <= step
              ? (s.num === step ? 'white' : 'var(--primary)')
              : 'var(--text-tertiary)',
            transition: 'all 0.3s',
          }}>
            {s.icon} {s.label}
          </div>
          {i < steps.length - 1 && (
            <div style={{
              width: 16, height: 2,
              background: s.num < step ? 'var(--primary)' : 'var(--border)',
              transition: 'all 0.3s',
            }} />
          )}
        </div>
      ))}
    </div>
  );
}
