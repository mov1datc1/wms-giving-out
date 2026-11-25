import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { API } from '../../config/api';
import {
  ShoppingCart, RefreshCw, Clock, CheckCircle, ThumbsDown, ThumbsUp,
  Package, Store, MapPin, ChevronDown, ChevronUp, Truck, UserCheck, ScanLine,
  Calendar, Lock, Plus, FileText
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { formatCalendarDate } from '../../utils/dateUtils';
import {
  PORTAL_FOCUS_THROTTLE_MS,
  PORTAL_POLL_INTERVAL_MS,
  PortalOrderIconKey,
  filterPortalOrders,
  getPortalLineAssignedQty,
  getPortalOrderCounts,
  getPortalOrderStatusMeta,
  getPortalRejectionBanner,
  getPortalTimelineState,
} from '../../utils/portalOrderTracking';

function renderStatusIcon(iconKey: PortalOrderIconKey, size = 12) {
  switch (iconKey) {
    case 'clock': return <Clock size={size} />;
    case 'thumbsUp': return <ThumbsUp size={size} />;
    case 'scanLine': return <ScanLine size={size} />;
    case 'package': return <Package size={size} />;
    case 'truck': return <Truck size={size} />;
    case 'checkCircle': return <CheckCircle size={size} />;
    case 'thumbsDown': return <ThumbsDown size={size} />;
    default: return null;
  }
}

export function PortalOrders() {
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('all');

  const inFlightRef = useRef(false);
  const lastFetchAtRef = useRef(0);

  const loadData = useCallback(async (opts: { silent?: boolean; initial?: boolean } = {}) => {
    if (!token || inFlightRef.current) return;
    inFlightRef.current = true;

    if (opts.initial) {
      setLoading(true);
    } else if (!opts.silent) {
      setRefreshing(true);
    }

    try {
      const res = await fetch(`${API}/orders?clienteId=${user?.clienteId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setOrders(await res.json());
        lastFetchAtRef.current = Date.now();
      }
    } catch (err) {
      console.error(err);
    } finally {
      inFlightRef.current = false;
      if (opts.initial) setLoading(false);
      if (!opts.silent) setRefreshing(false);
    }
  }, [token, user?.clienteId]);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }

    loadData({ initial: true });

    const refreshIfStale = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastFetchAtRef.current < PORTAL_FOCUS_THROTTLE_MS) return;
      loadData({ silent: true });
    };

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        loadData({ silent: true });
      }
    }, PORTAL_POLL_INTERVAL_MS);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refreshIfStale();
      }
    };

    const handleWindowFocus = () => {
      refreshIfStale();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleWindowFocus);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleWindowFocus);
    };
  }, [token, loadData]);

  const filtered = filterPortalOrders(orders, filter);
  const { total, activeCount, reservedCount, deliveredCount, rejectedCount } = getPortalOrderCounts(orders);

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Mis Pedidos de Salida</h1>
          <p className="page-subtitle">{total} pedidos registrados · {activeCount} activos ({reservedCount} con stock reservado)</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" onClick={() => navigate('/portal/nuevo-pedido')}>
            <Plus size={16} /> Nuevo Pedido
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => loadData({ silent: false })}
            disabled={refreshing}
          >
            <RefreshCw size={16} className={refreshing ? 'animate-spin' : undefined} /> Actualizar
          </button>
        </div>
      </div>

      {/* Filter chips */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {[
          { key: 'all', label: `Todos (${total})` },
          { key: 'active', label: `Activos (${activeCount})` },
          { key: 'delivered', label: `Entregados (${deliveredCount})` },
          { key: 'rejected', label: `Cancelados / Rechazados (${rejectedCount})` },
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
            const info = getPortalOrderStatusMeta(o.estado);
            const timeline = getPortalTimelineState(o.estado);
            const rejectionBanner = getPortalRejectionBanner(o);
            const isDispatched = info.isDispatched;
            const hasReservedStock = info.hasReservedStock;

            return (
              <div key={o.id} className="card animate-fade-in" style={{ animationDelay: `${i * 0.03}s` }}>
                <div style={{ padding: '20px 24px' }}>
                  {/* Header */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
                    <div style={{ flex: 1, minWidth: 260 }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 700, fontSize: 16 }}>{o.codigo}</span>
                        <span className={`badge badge-${info.cls}`}>{renderStatusIcon(info.iconKey, 12)} {info.label}</span>
                        {hasReservedStock && (
                          <span className="badge badge-default" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <Lock size={11} /> Stock Reservado
                          </span>
                        )}
                        {isDispatched && (
                          <span className="badge badge-success" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <CheckCircle size={11} /> Salida Concluida (0 reservadas)
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
                            <Calendar size={12} /> Cita: {formatCalendarDate(o.fechaCompromiso)} {o.horaCompromiso ? `(${o.horaCompromiso} hrs)` : ''}
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
                  {timeline.visible && (
                    <div style={{ marginTop: 14 }}>
                      <OrderTimeline estado={o.estado} />
                    </div>
                  )}

                  {/* Rejection / Cancellation reason */}
                  {rejectionBanner.visible && (
                    <div style={{ marginTop: 12, padding: '10px 14px', background: 'var(--danger-soft)', borderRadius: 8, fontSize: 13, color: 'var(--danger)', border: '1px solid rgba(239,68,68,0.25)' }}>
                      <strong>{rejectionBanner.label}:</strong> {rejectionBanner.reason}
                    </div>
                  )}

                  {/* Shipping info */}
                  {isDispatched && (
                    <div style={{ marginTop: 12, padding: '12px 14px', background: 'var(--bg-secondary)', borderRadius: 8, border: '1px solid var(--border)' }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--primary)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Truck size={14} color="var(--primary)" /> Información de Transporte & Despacho
                      </div>
                      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13 }}>
                        <span>Fletera: <strong>{o.fletera || o.paqueteria || 'Transporte Directo'}</strong></span>
                        {o.choferNombre && <span>Operador: <strong>{o.choferNombre}</strong></span>}
                        {o.vehiculoPlaca && <span>Placas: <strong style={{ fontFamily: 'monospace' }}>{o.vehiculoPlaca}</strong></span>}
                        {o.selloSeguridad && <span>Sello: <strong style={{ fontFamily: 'monospace' }}>{o.selloSeguridad}</strong></span>}
                        {o.numeroGuia && <span>Guía: <strong>{o.numeroGuia}</strong></span>}
                        {o.fechaDespacho && <span>Despachado: <strong>{formatCalendarDate(o.fechaDespacho)}</strong></span>}
                      </div>
                      {o.estado === 'ENTREGADO' && (
                        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)', display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13 }}>
                          {o.nombreReceptor && <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><UserCheck size={14} color="var(--emerald)" /> Recibió: <strong>{o.nombreReceptor}</strong></span>}
                          {o.fechaEntrega && <span>Fecha Entrega: <strong>{formatCalendarDate(o.fechaEntrega)}</strong></span>}
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
                        {hasReservedStock && (
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
                            {o.lineas?.map((l: any) => {
                              const assignedQty = getPortalLineAssignedQty(o.estado, l);
                              return (
                                <tr key={l.id} style={{ borderBottom: '1px solid var(--border)' }}>
                                  <td style={{ padding: '10px 12px', fontWeight: 500 }}>{l.sku?.descripcion}</td>
                                  <td style={{ padding: '10px 12px' }}><code style={{ fontSize: 12 }}>{l.sku?.codigo}</code></td>
                                  <td style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 600 }}>{l.cantidadSolicitada}</td>
                                  <td style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 700, color: assignedQty > 0 ? 'var(--emerald)' : 'var(--text-tertiary)' }}>
                                    {assignedQty}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      {o.notas && (
                        <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                          <FileText size={13} /> Instrucciones: {o.notas}
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
function OrderTimeline({ estado }: { estado: string }) {
  const timeline = getPortalTimelineState(estado);
  if (!timeline.visible) return null;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0, overflowX: 'auto', padding: '4px 0' }}>
      {timeline.steps.map((s, i) => (
        <div key={s.num} style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 20,
            fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
            background: s.status === 'active'
              ? 'var(--primary)'
              : s.status === 'completed'
                ? 'rgba(13,148,136,0.15)'
                : 'var(--bg-secondary)',
            color: s.status === 'active'
              ? 'white'
              : s.status === 'completed'
                ? 'var(--primary)'
                : 'var(--text-tertiary)',
            transition: 'all 0.3s',
          }}>
            {renderStatusIcon(s.iconKey, 11)} {s.label}
          </div>
          {i < timeline.steps.length - 1 && (
            <div style={{
              width: 16, height: 2,
              background: s.connectorActive ? 'var(--primary)' : 'var(--border)',
              transition: 'all 0.3s',
            }} />
          )}
        </div>
      ))}
    </div>
  );
}
