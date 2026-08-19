import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { API } from '../../config/api';
import {
  ShoppingCart, Plus, Trash2, Store, ArrowLeft, CheckCircle, Package,
  Clock, Calendar, AlertTriangle, Building2, Layers, ShieldCheck
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface OrderLine {
  skuId: string;
  skuCode: string;
  skuDesc: string;
  uom: string;
  cantidadSolicitada: number;
  available: number;
  reserved: number;
}

export function PortalNewOrder() {
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const [endCustomers, setEndCustomers] = useState<any[]>([]);
  const [skus, setSkus] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [inventoryLots, setInventoryLots] = useState<any[]>([]);
  
  const [endCustomerId, setEndCustomerId] = useState('');
  const [almacenOrigenId, setAlmacenOrigenId] = useState('');
  const [fechaCompromiso, setFechaCompromiso] = useState('');
  const [horaCompromiso, setHoraCompromiso] = useState('09:00');
  const [prioridad, setPrioridad] = useState(3);
  const [notas, setNotas] = useState('');
  const [lines, setLines] = useState<OrderLine[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const headers: any = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    try {
      const [ecRes, skuRes, whRes, invRes] = await Promise.all([
        fetch(`${API}/end-customers?clienteId=${user?.clienteId}`, { headers }),
        fetch(`${API}/skus?clienteId=${user?.clienteId}`, { headers }),
        fetch(`${API}/warehouses`, { headers }),
        fetch(`${API}/clients/${user?.clienteId}/inventory`, { headers }),
      ]);
      if (ecRes.ok) setEndCustomers(await ecRes.json());
      if (skuRes.ok) setSkus(await skuRes.json());
      if (whRes.ok) {
        const whs = await whRes.json();
        setWarehouses(whs);
        if (whs.length > 0 && !almacenOrigenId) {
          setAlmacenOrigenId(whs[0].id);
        }
      }
      if (invRes.ok) {
        const invData = await invRes.json();
        setInventoryLots(invData.lotes || []);
      }
    } catch (err) { console.error(err); }
  }

  // Calcular stock disponible en vivo por SKU y Almacén seleccionado
  function getSkuStockInfo(skuId: string, whId: string) {
    if (!skuId) return { available: 0, reserved: 0, total: 0 };
    
    let matchingLots = inventoryLots.filter(l => l.skuId === skuId && l.estadoCalidad === 'LIBERADO');
    if (whId) {
      matchingLots = matchingLots.filter(l => l.ubicacion?.almacen?.id === whId || !l.ubicacion?.almacen?.id);
    }

    let available = 0;
    let reserved = 0;
    let total = 0;

    for (const lot of matchingLots) {
      const disp = lot.cantidadDisponible || 0;
      const res = lot.cantidadReservada || 0;
      total += disp;
      reserved += res;
      available += Math.max(0, disp - res);
    }

    return { available, reserved, total };
  }

  function addLine() {
    if (skus.length === 0) return;
    setLines([...lines, { skuId: '', skuCode: '', skuDesc: '', uom: '', cantidadSolicitada: 1, available: 0, reserved: 0 }]);
  }

  function updateLine(idx: number, skuId: string) {
    const sku = skus.find(s => s.id === skuId);
    if (!sku) return;
    const stockInfo = getSkuStockInfo(skuId, almacenOrigenId);
    const updated = [...lines];
    updated[idx] = {
      ...updated[idx],
      skuId,
      skuCode: sku.codigo,
      skuDesc: sku.descripcion,
      uom: sku.uomBase || 'PZA',
      available: stockInfo.available,
      reserved: stockInfo.reserved,
      cantidadSolicitada: stockInfo.available > 0 ? 1 : 0
    };
    setLines(updated);
  }

  function updateQty(idx: number, qty: number) {
    const updated = [...lines];
    updated[idx] = { ...updated[idx], cantidadSolicitada: Math.max(0, qty) };
    setLines(updated);
  }

  function removeLine(idx: number) {
    setLines(lines.filter((_, i) => i !== idx));
  }

  // Cuando cambia el almacén, refrescar la disponibilidad en todas las líneas existentes
  function handleWarehouseChange(newWhId: string) {
    setAlmacenOrigenId(newWhId);
    const updated = lines.map(line => {
      if (!line.skuId) return line;
      const stockInfo = getSkuStockInfo(line.skuId, newWhId);
      return {
        ...line,
        available: stockInfo.available,
        reserved: stockInfo.reserved,
      };
    });
    setLines(updated);
  }

  const hasStockErrors = lines.some(l => l.skuId && l.cantidadSolicitada > l.available);
  const totalItems = lines.reduce((sum, l) => sum + l.cantidadSolicitada, 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setSuccess('');

    if (!endCustomerId) { setError('Selecciona un destino de entrega (Ship-To)'); return; }
    if (!fechaCompromiso) { setError('La fecha de compromiso de entrega es obligatoria para programar el transporte'); return; }
    if (!horaCompromiso) { setError('La hora de compromiso / cita es obligatoria'); return; }
    if (lines.length === 0) { setError('Agrega al menos un producto a tu pedido'); return; }
    if (lines.some(l => !l.skuId)) { setError('Selecciona un producto en todas las líneas'); return; }
    if (lines.some(l => l.cantidadSolicitada <= 0)) { setError('La cantidad solicitada debe ser mayor a 0'); return; }
    if (hasStockErrors) { setError('Uno o más productos exceden el stock disponible libre. Ajusta las cantidades antes de enviar.'); return; }

    setSubmitting(true);
    try {
      const body = {
        clienteId: user?.clienteId,
        endCustomerId,
        almacenOrigenId: almacenOrigenId || undefined,
        fechaCompromiso: new Date(fechaCompromiso),
        horaCompromiso,
        prioridad,
        notas,
        estado: 'SOLICITADO',
        solicitadoPor: user?.email,
        usuario: user?.email,
        lineas: lines.map(l => ({
          skuId: l.skuId,
          cantidadSolicitada: l.cantidadSolicitada,
          uom: l.uom,
        })),
      };

      const res = await fetch(`${API}/orders`, { method: 'POST', headers, body: JSON.stringify(body) });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'Error al crear pedido');
      }
      const order = await res.json();
      setSuccess(`✅ Pedido ${order.codigo} creado y stock reservado automáticamente (${lines.length} productos). Giving Out lo revisará de inmediato.`);
      setLines([]); setEndCustomerId(''); setNotas(''); setFechaCompromiso('');
      setTimeout(() => navigate('/portal/pedidos'), 3000);
    } catch (err: any) { setError(err.message); }
    setSubmitting(false);
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/portal/pedidos')}><ArrowLeft size={18} /></button>
          <div>
            <h1 className="page-title">Nuevo Pedido de Salida</h1>
            <p className="page-subtitle">Solicitud con selección de almacén, cita de transporte y reserva automática de existencias</p>
          </div>
        </div>
      </div>

      {success && (
        <div className="card animate-fade-in" style={{ marginBottom: 20, padding: '20px 24px', borderLeft: '4px solid var(--emerald)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <CheckCircle size={24} style={{ color: 'var(--emerald)' }} />
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{success}</div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>Redirigiendo a tus pedidos en curso...</div>
            </div>
          </div>
        </div>
      )}

      {!success && (
        <form onSubmit={handleSubmit}>
          {/* Header Info */}
          <div className="card" style={{ marginBottom: 20 }}>
            <div style={{ padding: '20px 24px' }}>
              <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--primary)', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Store size={15} /> 1. Destino, Cita de Entrega & Almacén
              </div>
              
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, marginBottom: 14 }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Cliente Final / Destino (Ship-To) <span className="required">*</span></label>
                  <select 
                    className="form-select form-select-full" 
                    value={endCustomerId} 
                    onChange={e => setEndCustomerId(e.target.value)} 
                    required
                  >
                    <option value="">Seleccionar destino...</option>
                    {endCustomers.map(ec => (
                      <option key={ec.id} value={ec.id}>{ec.nombre} — {ec.ciudad}{ec.calle ? `, ${ec.calle}` : ''}</option>
                    ))}
                  </select>
                </div>

                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Almacén de Origen <span className="required">*</span></label>
                  <select 
                    className="form-select form-select-full" 
                    value={almacenOrigenId} 
                    onChange={e => handleWarehouseChange(e.target.value)} 
                    required
                  >
                    {warehouses.map(w => (
                      <option key={w.id} value={w.id}>
                        {w.nombre} ({w.codigo}) — Stock Disponible Activo
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">
                    <Calendar size={13} style={{ marginRight: 4, display: 'inline' }} />
                    Fecha Compromiso / Cita <span className="required">*</span>
                  </label>
                  <input 
                    type="date" 
                    className="form-input" 
                    value={fechaCompromiso} 
                    onChange={e => setFechaCompromiso(e.target.value)} 
                    required 
                  />
                </div>

                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">
                    <Clock size={13} style={{ marginRight: 4, display: 'inline' }} />
                    Hora de Cita / Entrega <span className="required">*</span>
                  </label>
                  <input 
                    type="time" 
                    className="form-input" 
                    value={horaCompromiso} 
                    onChange={e => setHoraCompromiso(e.target.value)} 
                    required 
                  />
                </div>

                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Prioridad de Despacho</label>
                  <select className="form-select form-select-full" value={prioridad} onChange={e => setPrioridad(Number(e.target.value))}>
                    <option value={1}>🔴 Urgente (Mismo día)</option>
                    <option value={2}>🟠 Alta (24h)</option>
                    <option value={3}>🟢 Normal (Ventana programada)</option>
                  </select>
                </div>
              </div>

              <div className="form-group" style={{ marginTop: 14, marginBottom: 0 }}>
                <label className="form-label">Instrucciones especiales de entrega / observaciones</label>
                <textarea 
                  className="form-input" 
                  rows={2} 
                  placeholder="Número de cita, rampa de acceso, ventana horaria de descarga..." 
                  value={notas} 
                  onChange={e => setNotas(e.target.value)} 
                />
              </div>
            </div>
          </div>

          {/* Order Lines */}
          <div className="card" style={{ marginBottom: 20 }}>
            <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Package size={16} style={{ color: 'var(--primary)' }} />
                  2. Productos del Pedido ({lines.length} líneas · {totalItems} piezas solicitadas)
                </h3>
                <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                  Las piezas solicitadas quedarán reservadas de inmediato para asegurar tu disponibilidad.
                </span>
              </div>
              <button type="button" className="btn btn-primary btn-sm" onClick={addLine}>
                <Plus size={14} /> Agregar Producto
              </button>
            </div>

            <div style={{ padding: '16px 24px' }}>
              {lines.length === 0 ? (
                <div style={{ padding: 36, textAlign: 'center', color: 'var(--text-tertiary)' }}>
                  <Package size={36} style={{ margin: '0 auto 10px', opacity: 0.3 }} />
                  <div>No has agregado productos a este pedido.</div>
                  <div style={{ fontSize: 12, marginTop: 4 }}>Presiona el botón "Agregar Producto" para iniciar tu solicitud.</div>
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ color: 'var(--text-tertiary)', fontSize: 11, textTransform: 'uppercase' as const, borderBottom: '1px solid var(--border)' }}>
                      <th style={{ textAlign: 'left', padding: '10px 8px', width: '40%' }}>Producto / SKU</th>
                      <th style={{ textAlign: 'center', padding: '10px 8px', width: '25%' }}>Disponibilidad Libre</th>
                      <th style={{ textAlign: 'center', padding: '10px 8px', width: '20%' }}>Cantidad a Solicitar</th>
                      <th style={{ width: 40 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line, idx) => {
                      const isOverStock = line.skuId && line.cantidadSolicitada > line.available;

                      return (
                        <tr key={idx} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ padding: '12px 8px' }}>
                            <select 
                              className="form-select form-select-full" 
                              value={line.skuId} 
                              onChange={e => updateLine(idx, e.target.value)} 
                              style={{ fontSize: 13 }}
                              required
                            >
                              <option value="">Seleccionar producto...</option>
                              {skus.map(s => (
                                <option key={s.id} value={s.id}>{s.descripcion} ({s.codigo})</option>
                              ))}
                            </select>
                          </td>

                          <td style={{ textAlign: 'center', padding: '12px 8px' }}>
                            {line.skuId ? (
                              <div>
                                <span className={`badge badge-${line.available > 0 ? 'success' : 'error'}`} style={{ fontSize: 12, fontWeight: 700 }}>
                                  {line.available} {line.uom} disponibles
                                </span>
                                {line.reserved > 0 && (
                                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>
                                    ({line.reserved} reservadas en otros pedidos)
                                  </div>
                                )}
                              </div>
                            ) : (
                              <span style={{ color: 'var(--text-tertiary)' }}>—</span>
                            )}
                          </td>

                          <td style={{ padding: '12px 8px' }}>
                            <input 
                              type="number" 
                              className="form-input" 
                              min={1} 
                              max={line.available || undefined}
                              value={line.cantidadSolicitada}
                              onChange={e => updateQty(idx, parseInt(e.target.value) || 0)}
                              style={{ 
                                textAlign: 'center', 
                                fontSize: 14, 
                                fontWeight: 700,
                                borderColor: isOverStock ? 'var(--error)' : undefined
                              }} 
                            />
                            {isOverStock && (
                              <div style={{ fontSize: 11, color: 'var(--error)', fontWeight: 600, marginTop: 4, textAlign: 'center' }}>
                                ⚠️ Excede disponible (Max: {line.available})
                              </div>
                            )}
                          </td>

                          <td style={{ textAlign: 'center', padding: '12px 4px' }}>
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeLine(idx)} style={{ color: 'var(--error)' }}>
                              <Trash2 size={15} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {error && (
            <div style={{ padding: '12px 16px', background: 'rgba(239,68,68,0.1)', borderRadius: 8, color: 'var(--error)', fontSize: 13, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <AlertTriangle size={16} />
              <span>{error}</span>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
            <button type="button" className="btn btn-ghost" onClick={() => navigate('/portal/pedidos')}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={submitting || lines.length === 0 || hasStockErrors}>
              <ShoppingCart size={16} /> {submitting ? 'Reservando stock y enviando...' : `Confirmar y Solicitar Pedido (${lines.length} productos)`}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
