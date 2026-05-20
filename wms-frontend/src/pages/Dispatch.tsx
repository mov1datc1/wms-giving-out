import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { API } from '../config/api';
import {
  Truck, RefreshCw, CheckCircle, Clock, Send, MapPin, Package, Store, Hash,
  ThumbsUp, ThumbsDown, X, Eye, ChevronDown, Plane, Navigation, UserCheck,
  PackageCheck, AlertTriangle, BarChart3, ArrowRight, FileText
} from 'lucide-react';

type TabKey = 'approvals' | 'ready' | 'transit' | 'delivered';

export function Dispatch() {
  const { token, user } = useAuth();
  const [allOrders, setAllOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>('approvals');
  const [dispatchModal, setDispatchModal] = useState<any>(null);
  const [dispatchForm, setDispatchForm] = useState({ tipoTransporte: '', paqueteria: '', numeroGuia: '', vehiculoPlaca: '' });
  const [rejectModal, setRejectModal] = useState<any>(null);
  const [rejectMotivo, setRejectMotivo] = useState('');
  const [deliveryModal, setDeliveryModal] = useState<any>(null);
  const [deliveryForm, setDeliveryForm] = useState({ nombreReceptor: '', notasEntrega: '' });
  const [detailModal, setDetailModal] = useState<any>(null);
  const headers: any = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    try {
      const res = await fetch(`${API}/orders`, { headers });
      if (res.ok) setAllOrders(await res.json());
    } catch (err) { console.error(err); }
    setLoading(false);
  }

  // --- Computed lists ---
  const pendingApprovals = allOrders.filter(o => ['SOLICITADO', 'PENDIENTE_APROBACION'].includes(o.estado));
  const readyOrders = allOrders.filter(o => ['APROBADO', 'EN_PICKING', 'CONSOLIDADO'].includes(o.estado));
  const transitOrders = allOrders.filter(o => o.estado === 'DESPACHADO');
  const deliveredOrders = allOrders.filter(o => o.estado === 'ENTREGADO');

  // --- Actions ---
  async function approveOrder(id: string) {
    try {
      await fetch(`${API}/orders/${id}/approve`, {
        method: 'POST', headers,
        body: JSON.stringify({ usuario: user?.email || 'admin' }),
      });
      loadData();
    } catch (err) { console.error(err); }
  }

  async function rejectOrder() {
    if (!rejectModal || !rejectMotivo) return;
    try {
      await fetch(`${API}/orders/${rejectModal.id}/reject`, {
        method: 'POST', headers,
        body: JSON.stringify({ usuario: user?.email || 'admin', motivo: rejectMotivo }),
      });
      setRejectModal(null); setRejectMotivo('');
      loadData();
    } catch (err) { console.error(err); }
  }

  async function dispatchOrder() {
    if (!dispatchModal) return;
    try {
      await fetch(`${API}/orders/${dispatchModal.id}/dispatch`, {
        method: 'POST', headers,
        body: JSON.stringify({ despachador: user?.email || 'admin', ...dispatchForm }),
      });
      setDispatchModal(null);
      setDispatchForm({ tipoTransporte: '', paqueteria: '', numeroGuia: '', vehiculoPlaca: '' });
      loadData();
    } catch (err) { console.error(err); }
  }

  async function confirmDelivery() {
    if (!deliveryModal) return;
    try {
      await fetch(`${API}/orders/${deliveryModal.id}/confirm-delivery`, {
        method: 'POST', headers,
        body: JSON.stringify({
          usuario: user?.email || 'admin',
          nombreReceptor: deliveryForm.nombreReceptor,
          notasEntrega: deliveryForm.notasEntrega,
        }),
      });
      setDeliveryModal(null);
      setDeliveryForm({ nombreReceptor: '', notasEntrega: '' });
      loadData();
    } catch (err) { console.error(err); }
  }

  // --- Helpers ---
  const estadoBadge = (estado: string) => {
    const map: any = {
      SOLICITADO: { cls: 'info', icon: <Clock size={11} />, label: 'Solicitado' },
      APROBADO: { cls: 'success', icon: <ThumbsUp size={11} />, label: 'Aprobado' },
      EN_PICKING: { cls: 'warning', icon: <Package size={11} />, label: 'En Picking' },
      CONSOLIDADO: { cls: 'info', icon: <PackageCheck size={11} />, label: 'Consolidado' },
      DESPACHADO: { cls: 'warning', icon: <Truck size={11} />, label: 'En Tránsito' },
      ENTREGADO: { cls: 'success', icon: <CheckCircle size={11} />, label: 'Entregado' },
      RECHAZADO: { cls: 'error', icon: <ThumbsDown size={11} />, label: 'Rechazado' },
    };
    const b = map[estado] || { cls: 'default', icon: null, label: estado };
    return <span className={`badge badge-${b.cls}`}>{b.icon} {b.label}</span>;
  };

  const totalUds = (o: any) => o.lineas?.reduce((s: number, l: any) => s + l.cantidadSolicitada, 0) || 0;
  const daysSinceDespacho = (o: any) => o.fechaDespacho ? Math.floor((Date.now() - new Date(o.fechaDespacho).getTime()) / 86400000) : 0;

  const tabConfig: { key: TabKey; icon: any; label: string; count: number }[] = [
    { key: 'approvals', icon: <ThumbsUp size={15} />, label: 'Aprobaciones', count: pendingApprovals.length },
    { key: 'ready', icon: <PackageCheck size={15} />, label: 'Por Enviar', count: readyOrders.filter(o => o.estado === 'CONSOLIDADO').length },
    { key: 'transit', icon: <Truck size={15} />, label: 'En Tránsito', count: transitOrders.length },
    { key: 'delivered', icon: <CheckCircle size={15} />, label: 'Entregados', count: deliveredOrders.length },
  ];

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Despacho & Envíos</h1>
          <p className="page-subtitle">
            {pendingApprovals.length} por aprobar · {readyOrders.filter(o => o.estado === 'CONSOLIDADO').length} por enviar · {transitOrders.length} en tránsito · {deliveredOrders.length} entregados
          </p>
        </div>
        <button className="btn btn-secondary" onClick={loadData}><RefreshCw size={16} /> Actualizar</button>
      </div>

      {/* KPI Ribbon */}
      <div className="stats-grid" style={{ marginBottom: 20 }}>
        {tabConfig.map(t => (
          <div key={t.key} className="stat-card" style={{ cursor: 'pointer', outline: tab === t.key ? '2px solid var(--primary)' : 'none', transition: 'all 0.2s' }}
            onClick={() => setTab(t.key)}>
            <div className="stat-icon" style={{
              background: t.key === 'approvals' ? 'rgba(245,158,11,0.15)' : t.key === 'ready' ? 'rgba(99,102,241,0.15)' : t.key === 'transit' ? 'rgba(14,165,233,0.15)' : 'rgba(16,185,129,0.15)',
              color: t.key === 'approvals' ? '#f59e0b' : t.key === 'ready' ? '#6366f1' : t.key === 'transit' ? '#0ea5e9' : '#10b981'
            }}>{t.icon}</div>
            <div className="stat-info"><span className="stat-value">{t.count}</span><span className="stat-label">{t.label}</span></div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
          {tabConfig.map(t => (
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

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-secondary)' }}><RefreshCw className="animate-spin" size={24} /> Cargando...</div>
      ) : (
        <div style={{ display: 'grid', gap: 14 }}>

          {/* =============================== */}
          {/* TAB: APPROVALS                  */}
          {/* =============================== */}
          {tab === 'approvals' && (
            <>
              {pendingApprovals.length === 0 && <EmptyState text="No hay pedidos pendientes de aprobación" />}
              {pendingApprovals.map((o, i) => (
                <div key={o.id} className="card animate-fade-in" style={{ animationDelay: `${i * 0.04}s`, borderLeft: '4px solid var(--orange)' }}>
                  <div style={{ padding: '18px 22px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                          <span style={{ fontWeight: 700, fontSize: 16 }}>{o.codigo}</span>
                          {estadoBadge(o.estado)}
                        </div>
                        <div style={{ display: 'flex', gap: 16, fontSize: 13, color: 'var(--text-secondary)', flexWrap: 'wrap' }}>
                          <span><Package size={13} /> {o.cliente?.nombreComercial}</span>
                          {o.endCustomer && <span><Store size={13} /> {o.endCustomer.nombre}</span>}
                          {o.endCustomer?.ciudad && <span><MapPin size={13} /> {o.endCustomer.ciudad}</span>}
                          <span>{o.lineas?.length} líneas · {totalUds(o)} uds</span>
                        </div>
                        {o.notas && <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-tertiary)', fontStyle: 'italic' }}>📝 {o.notas}</div>}
                        {o.solicitadoPor && <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text-tertiary)' }}>Solicitado por: {o.solicitadoPor}</div>}
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button className="btn btn-primary" onClick={() => approveOrder(o.id)}><ThumbsUp size={16} /> Aprobar</button>
                        <button className="btn" style={{ background: 'var(--error)', color: 'white' }} onClick={() => setRejectModal(o)}><ThumbsDown size={16} /> Rechazar</button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </>
          )}

          {/* =============================== */}
          {/* TAB: READY TO SHIP              */}
          {/* =============================== */}
          {tab === 'ready' && (
            <>
              {readyOrders.length === 0 && <EmptyState text="No hay órdenes por enviar. Los pedidos aparecen aquí después de ser aprobados y completar el picking." />}
              {readyOrders.map((o, i) => (
                <div key={o.id} className="card animate-fade-in" style={{
                  animationDelay: `${i * 0.04}s`,
                  borderLeft: `4px solid ${o.estado === 'CONSOLIDADO' ? 'var(--primary)' : o.estado === 'EN_PICKING' ? 'var(--orange)' : 'var(--teal)'}`,
                }}>
                  <div style={{ padding: '18px 22px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                          <span style={{ fontWeight: 700, fontSize: 16 }}>{o.codigo}</span>
                          {estadoBadge(o.estado)}
                        </div>
                        <div style={{ display: 'flex', gap: 16, fontSize: 13, color: 'var(--text-secondary)', flexWrap: 'wrap' }}>
                          <span><Package size={13} /> {o.cliente?.nombreComercial}</span>
                          {o.endCustomer && <span><Store size={13} /> {o.endCustomer.nombre}</span>}
                          {o.endCustomer?.ciudad && <span><MapPin size={13} /> {o.endCustomer.ciudad}</span>}
                          <span>{o.lineas?.length} líneas · {totalUds(o)} uds</span>
                        </div>
                        {/* Pipeline status */}
                        <div style={{ marginTop: 12 }}>
                          <ProgressPipeline estado={o.estado} />
                        </div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
                        {o.estado === 'CONSOLIDADO' ? (
                          <button className="btn btn-primary" onClick={() => setDispatchModal(o)}><Send size={16} /> Despachar</button>
                        ) : o.estado === 'EN_PICKING' ? (
                          <span style={{ fontSize: 12, color: 'var(--orange)', fontWeight: 600 }}>⏳ Esperando picking...</span>
                        ) : (
                          <span style={{ fontSize: 12, color: 'var(--teal)', fontWeight: 600 }}>⏳ Pendiente picking</span>
                        )}
                        <button className="btn btn-ghost btn-sm" onClick={() => setDetailModal(o)}><Eye size={14} /> Detalle</button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </>
          )}

          {/* =============================== */}
          {/* TAB: IN TRANSIT                  */}
          {/* =============================== */}
          {tab === 'transit' && (
            <>
              {transitOrders.length === 0 && <EmptyState text="No hay envíos en tránsito" />}
              {transitOrders.map((o, i) => (
                <div key={o.id} className="card animate-fade-in" style={{ animationDelay: `${i * 0.04}s`, borderLeft: '4px solid #0ea5e9' }}>
                  <div style={{ padding: '18px 22px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                          <span style={{ fontWeight: 700, fontSize: 16 }}>{o.codigo}</span>
                          <span className="badge badge-warning"><Truck size={11} /> En Tránsito</span>
                          {daysSinceDespacho(o) >= 3 && <span className="badge badge-error"><AlertTriangle size={11} /> +{daysSinceDespacho(o)} días</span>}
                        </div>
                        <div style={{ display: 'flex', gap: 16, fontSize: 13, color: 'var(--text-secondary)', flexWrap: 'wrap' }}>
                          <span><Package size={13} /> {o.cliente?.nombreComercial}</span>
                          {o.endCustomer && <span><Store size={13} /> {o.endCustomer.nombre} · {o.endCustomer.ciudad}</span>}
                          <span>{totalUds(o)} uds</span>
                        </div>
                        {/* Shipping details */}
                        <div style={{ marginTop: 10, display: 'flex', gap: 16, fontSize: 12, color: 'var(--text-tertiary)', flexWrap: 'wrap' }}>
                          {o.tipoTransporte && <span>📦 {o.tipoTransporte.replace('_', ' ')}</span>}
                          {o.paqueteria && <span>🚚 {o.paqueteria}</span>}
                          {o.numeroGuia && <span>📋 Guía: <strong>{o.numeroGuia}</strong></span>}
                          {o.vehiculoPlaca && <span>🚛 Placa: {o.vehiculoPlaca}</span>}
                          {o.fechaDespacho && <span>📅 Despachado: {new Date(o.fechaDespacho).toLocaleDateString('es-MX')}</span>}
                          {o.despachador && <span>👤 {o.despachador.split('@')[0]}</span>}
                        </div>

                        {/* Transit progress */}
                        <div style={{ marginTop: 12 }}>
                          <TransitTimeline despachado={true} enRuta={true} entregado={false} />
                        </div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <button className="btn btn-success" onClick={() => setDeliveryModal(o)}>
                          <UserCheck size={16} /> Confirmar Entrega
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => setDetailModal(o)}><Eye size={14} /> Ver Detalle</button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </>
          )}

          {/* =============================== */}
          {/* TAB: DELIVERED                   */}
          {/* =============================== */}
          {tab === 'delivered' && (
            <>
              {deliveredOrders.length === 0 && <EmptyState text="No hay pedidos entregados aún" />}
              {deliveredOrders.map((o, i) => (
                <div key={o.id} className="card animate-fade-in" style={{ animationDelay: `${i * 0.04}s`, borderLeft: '4px solid var(--emerald)' }}>
                  <div style={{ padding: '18px 22px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                          <span style={{ fontWeight: 700, fontSize: 16 }}>{o.codigo}</span>
                          <span className="badge badge-success"><CheckCircle size={11} /> Entregado</span>
                        </div>
                        <div style={{ display: 'flex', gap: 16, fontSize: 13, color: 'var(--text-secondary)', flexWrap: 'wrap' }}>
                          <span><Package size={13} /> {o.cliente?.nombreComercial}</span>
                          {o.endCustomer && <span><Store size={13} /> {o.endCustomer.nombre}</span>}
                          <span>{totalUds(o)} uds</span>
                        </div>
                        <div style={{ marginTop: 8, display: 'flex', gap: 16, fontSize: 12, color: 'var(--text-tertiary)', flexWrap: 'wrap' }}>
                          {o.nombreReceptor && <span>✍️ Recibió: <strong>{o.nombreReceptor}</strong></span>}
                          {o.fechaEntrega && <span>📅 Entrega: {new Date(o.fechaEntrega).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>}
                          {o.paqueteria && <span>🚚 {o.paqueteria}</span>}
                          {o.numeroGuia && <span>📋 Guía: {o.numeroGuia}</span>}
                          {o.notasEntrega && <span>📝 {o.notasEntrega}</span>}
                        </div>
                        <div style={{ marginTop: 10 }}>
                          <TransitTimeline despachado={true} enRuta={true} entregado={true} />
                        </div>
                      </div>
                      <button className="btn btn-ghost btn-sm" onClick={() => setDetailModal(o)}><Eye size={14} /> Ver Detalle</button>
                    </div>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {/* ===== REJECT MODAL ===== */}
      {rejectModal && (
        <div className="modal-overlay" onClick={() => setRejectModal(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 500 }}>
            <div className="modal-header">
              <h2><ThumbsDown size={20} /> Rechazar Pedido {rejectModal.codigo}</h2>
              <button className="btn btn-ghost btn-sm" onClick={() => setRejectModal(null)}><X size={18} /></button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Motivo de rechazo <span className="required">*</span></label>
                <textarea className="form-input" rows={3} placeholder="Explica por qué se rechaza este pedido..." value={rejectMotivo} onChange={e => setRejectMotivo(e.target.value)} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setRejectModal(null)}>Cancelar</button>
              <button className="btn" style={{ background: 'var(--error)', color: 'white' }} disabled={!rejectMotivo} onClick={rejectOrder}>Confirmar Rechazo</button>
            </div>
          </div>
        </div>
      )}

      {/* ===== DISPATCH MODAL ===== */}
      {dispatchModal && (
        <div className="modal-overlay" onClick={() => setDispatchModal(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 600 }}>
            <div className="modal-header">
              <h2><Send size={20} /> Despachar {dispatchModal.codigo}</h2>
              <button className="btn btn-ghost btn-sm" onClick={() => setDispatchModal(null)}><X size={18} /></button>
            </div>
            <div className="modal-body">
              {dispatchModal.endCustomer && (
                <div className="card" style={{ padding: '14px 18px', marginBottom: 16, background: 'var(--bg-secondary)' }}>
                  <div style={{ fontWeight: 600, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}><Store size={14} /> {dispatchModal.endCustomer.nombre}</div>
                  {dispatchModal.endCustomer.calle && <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{dispatchModal.endCustomer.calle}, {dispatchModal.endCustomer.ciudad}, {dispatchModal.endCustomer.estado}</div>}
                </div>
              )}
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Tipo de Transporte</label>
                  <select className="form-select form-select-full" value={dispatchForm.tipoTransporte} onChange={e => setDispatchForm(f => ({ ...f, tipoTransporte: e.target.value }))}>
                    <option value="">Seleccionar...</option>
                    <option value="PAQUETERIA">Paquetería</option>
                    <option value="MENSAJERIA">Mensajería</option>
                    <option value="VEHICULO_PROPIO">Vehículo Propio</option>
                    <option value="CLIENTE_RECOGE">Cliente Recoge</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Paquetería</label>
                  <select className="form-select form-select-full" value={dispatchForm.paqueteria} onChange={e => setDispatchForm(f => ({ ...f, paqueteria: e.target.value }))}>
                    <option value="">Seleccionar...</option>
                    <option value="DHL">DHL</option>
                    <option value="FEDEX">FedEx</option>
                    <option value="ESTAFETA">Estafeta</option>
                    <option value="PAQUETEXPRESS">PaquetExpress</option>
                    <option value="REDPACK">RedPack</option>
                    <option value="OTRO">Otro</option>
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label"><Hash size={14} /> Número de Guía</label>
                  <input className="form-input" placeholder="Ingresa el número de guía" value={dispatchForm.numeroGuia} onChange={e => setDispatchForm(f => ({ ...f, numeroGuia: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label"><Truck size={14} /> Placa del Vehículo</label>
                  <input className="form-input" placeholder="ABC-123-X" value={dispatchForm.vehiculoPlaca} onChange={e => setDispatchForm(f => ({ ...f, vehiculoPlaca: e.target.value }))} />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setDispatchModal(null)}>Cancelar</button>
              <button className="btn btn-primary" onClick={dispatchOrder}><Send size={16} /> Confirmar Despacho</button>
            </div>
          </div>
        </div>
      )}

      {/* ===== DELIVERY CONFIRMATION MODAL ===== */}
      {deliveryModal && (
        <div className="modal-overlay" onClick={() => setDeliveryModal(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 550 }}>
            <div className="modal-header">
              <h2><UserCheck size={20} /> Confirmar Entrega — {deliveryModal.codigo}</h2>
              <button className="btn btn-ghost btn-sm" onClick={() => setDeliveryModal(null)}><X size={18} /></button>
            </div>
            <div className="modal-body">
              {deliveryModal.endCustomer && (
                <div className="card" style={{ padding: '14px 18px', marginBottom: 16, background: 'var(--bg-secondary)' }}>
                  <div style={{ fontWeight: 600, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}><Store size={14} /> {deliveryModal.endCustomer.nombre}</div>
                  {deliveryModal.endCustomer.calle && (
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                      {deliveryModal.endCustomer.calle}, {deliveryModal.endCustomer.ciudad}
                    </div>
                  )}
                </div>
              )}
              {deliveryModal.paqueteria && (
                <div style={{ marginBottom: 16, display: 'flex', gap: 12, fontSize: 13, color: 'var(--text-secondary)' }}>
                  <span>🚚 {deliveryModal.paqueteria}</span>
                  {deliveryModal.numeroGuia && <span>📋 Guía: <strong>{deliveryModal.numeroGuia}</strong></span>}
                </div>
              )}
              <div className="form-group">
                <label className="form-label">Nombre de quien recibe <span className="required">*</span></label>
                <input className="form-input" placeholder="Nombre de la persona que recibe el envío" value={deliveryForm.nombreReceptor} onChange={e => setDeliveryForm(f => ({ ...f, nombreReceptor: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Notas de entrega</label>
                <textarea className="form-input" rows={2} placeholder="Observaciones sobre la entrega (daños, faltantes, etc.)" value={deliveryForm.notasEntrega} onChange={e => setDeliveryForm(f => ({ ...f, notasEntrega: e.target.value }))} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setDeliveryModal(null)}>Cancelar</button>
              <button className="btn btn-success" disabled={!deliveryForm.nombreReceptor} onClick={confirmDelivery}>
                <CheckCircle size={16} /> Confirmar Entrega
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== DETAIL MODAL ===== */}
      {detailModal && (
        <div className="modal-overlay" onClick={() => setDetailModal(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 700 }}>
            <div className="modal-header">
              <h2><FileText size={20} /> Detalle — {detailModal.codigo}</h2>
              <button className="btn btn-ghost btn-sm" onClick={() => setDetailModal(null)}><X size={18} /></button>
            </div>
            <div className="modal-body" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                <InfoCard label="Depositante" value={detailModal.cliente?.nombreComercial} />
                <InfoCard label="Destino (Ship-To)" value={detailModal.endCustomer?.nombre || 'N/A'} />
                <InfoCard label="Estado" value={detailModal.estado} />
                <InfoCard label="Prioridad" value={detailModal.prioridad === 1 ? 'Urgente' : detailModal.prioridad === 2 ? 'Alta' : 'Normal'} />
                {detailModal.paqueteria && <InfoCard label="Paquetería" value={detailModal.paqueteria} />}
                {detailModal.numeroGuia && <InfoCard label="Guía" value={detailModal.numeroGuia} />}
                {detailModal.despachador && <InfoCard label="Despachado por" value={detailModal.despachador} />}
                {detailModal.nombreReceptor && <InfoCard label="Recibió" value={detailModal.nombreReceptor} />}
              </div>

              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>Líneas del pedido</div>
              <div style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)' }}>
                <table className="data-table" style={{ fontSize: 13 }}>
                  <thead><tr><th>SKU</th><th>Producto</th><th>Solicitado</th><th>Asignado</th></tr></thead>
                  <tbody>
                    {detailModal.lineas?.map((l: any, j: number) => (
                      <tr key={j}>
                        <td><code style={{ fontSize: 11 }}>{l.sku?.codigo}</code></td>
                        <td>{l.sku?.descripcion}</td>
                        <td style={{ fontWeight: 600 }}>{l.cantidadSolicitada}</td>
                        <td style={{ fontWeight: 700, color: l.cantidadAsignada >= l.cantidadSolicitada ? 'var(--emerald)' : 'var(--orange)' }}>{l.cantidadAsignada}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {detailModal.notas && (
                <div style={{ marginTop: 12, padding: 12, background: 'var(--bg-secondary)', borderRadius: 8, fontSize: 13 }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>📝 Notas</div>
                  {detailModal.notas}
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setDetailModal(null)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ===== Helper Components =====

function EmptyState({ text }: { text: string }) {
  return (
    <div className="card">
      <div style={{ padding: 50, textAlign: 'center', color: 'var(--text-tertiary)' }}>{text}</div>
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ padding: '10px 14px', background: 'var(--bg-secondary)', borderRadius: 8 }}>
      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 }}>{label}</div>
      <div style={{ fontWeight: 600, fontSize: 14 }}>{value}</div>
    </div>
  );
}

function ProgressPipeline({ estado }: { estado: string }) {
  const steps = [
    { key: 'APROBADO', label: 'Aprobado', icon: <ThumbsUp size={12} /> },
    { key: 'EN_PICKING', label: 'Picking', icon: <Package size={12} /> },
    { key: 'CONSOLIDADO', label: 'Consolidado', icon: <PackageCheck size={12} /> },
  ];
  const order = ['APROBADO', 'EN_PICKING', 'CONSOLIDADO'];
  const idx = order.indexOf(estado);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      {steps.map((step, i) => (
        <div key={step.key} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 20,
            fontSize: 11, fontWeight: 600,
            background: i <= idx ? 'var(--primary)' : 'var(--bg-secondary)',
            color: i <= idx ? 'white' : 'var(--text-tertiary)',
            transition: 'all 0.3s',
          }}>
            {step.icon} {step.label}
          </div>
          {i < steps.length - 1 && <ArrowRight size={12} style={{ color: i < idx ? 'var(--primary)' : 'var(--border)' }} />}
        </div>
      ))}
    </div>
  );
}

function TransitTimeline({ despachado, enRuta, entregado }: { despachado: boolean; enRuta: boolean; entregado: boolean }) {
  const steps = [
    { active: despachado, label: 'Despachado', icon: <Send size={12} /> },
    { active: enRuta, label: 'En Tránsito', icon: <Truck size={12} /> },
    { active: entregado, label: 'Entregado', icon: <CheckCircle size={12} /> },
  ];

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
      {steps.map((step, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 4, padding: '4px 12px', borderRadius: 20,
            fontSize: 11, fontWeight: 600,
            background: step.active ? (i === 2 ? 'var(--emerald)' : '#0ea5e9') : 'var(--bg-secondary)',
            color: step.active ? 'white' : 'var(--text-tertiary)',
            transition: 'all 0.3s',
          }}>
            {step.icon} {step.label}
          </div>
          {i < steps.length - 1 && (
            <div style={{
              width: 20, height: 2,
              background: step.active ? (i === 1 && entregado ? 'var(--emerald)' : '#0ea5e9') : 'var(--border)',
              transition: 'all 0.3s',
            }} />
          )}
        </div>
      ))}
    </div>
  );
}
