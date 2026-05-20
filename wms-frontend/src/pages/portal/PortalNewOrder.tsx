import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { API } from '../../config/api';
import { ShoppingCart, Plus, Trash2, Store, ArrowLeft, CheckCircle, Package } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface OrderLine {
  skuId: string; skuCode: string; skuDesc: string; uom: string;
  cantidadSolicitada: number; available: number;
}

export function PortalNewOrder() {
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const [endCustomers, setEndCustomers] = useState<any[]>([]);
  const [skus, setSkus] = useState<any[]>([]);
  const [endCustomerId, setEndCustomerId] = useState('');
  const [fechaCompromiso, setFechaCompromiso] = useState('');
  const [prioridad, setPrioridad] = useState(5);
  const [notas, setNotas] = useState('');
  const [lines, setLines] = useState<OrderLine[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const headers: any = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    try {
      const [ecRes, skuRes] = await Promise.all([
        fetch(`${API}/end-customers?clienteId=${user?.clienteId}`, { headers }),
        fetch(`${API}/skus?clienteId=${user?.clienteId}`, { headers }),
      ]);
      if (ecRes.ok) setEndCustomers(await ecRes.json());
      if (skuRes.ok) setSkus(await skuRes.json());
    } catch (err) { console.error(err); }
  }

  function addLine() {
    if (skus.length === 0) return;
    setLines([...lines, { skuId: '', skuCode: '', skuDesc: '', uom: '', cantidadSolicitada: 1, available: 0 }]);
  }

  function updateLine(idx: number, skuId: string) {
    const sku = skus.find(s => s.id === skuId);
    if (!sku) return;
    const updated = [...lines];
    updated[idx] = { ...updated[idx], skuId, skuCode: sku.codigo, skuDesc: sku.descripcion, uom: sku.uomBase };
    setLines(updated);
  }

  function updateQty(idx: number, qty: number) {
    const updated = [...lines];
    updated[idx] = { ...updated[idx], cantidadSolicitada: Math.max(1, qty) };
    setLines(updated);
  }

  function removeLine(idx: number) {
    setLines(lines.filter((_, i) => i !== idx));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setSuccess('');

    if (!endCustomerId) { setError('Selecciona un destino de entrega'); return; }
    if (lines.length === 0) { setError('Agrega al menos una línea'); return; }
    if (lines.some(l => !l.skuId)) { setError('Selecciona un producto en todas las líneas'); return; }

    setSubmitting(true);
    try {
      const body = {
        clienteId: user?.clienteId,
        endCustomerId,
        fechaCompromiso: fechaCompromiso ? new Date(fechaCompromiso) : undefined,
        prioridad,
        notas,
        estado: 'SOLICITADO',
        solicitadoPor: user?.email,
        usuario: user?.email,
        lineas: lines.map(l => ({
          skuId: l.skuId, cantidadSolicitada: l.cantidadSolicitada, uom: l.uom,
        })),
      };

      const res = await fetch(`${API}/orders`, { method: 'POST', headers, body: JSON.stringify(body) });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'Error al crear pedido');
      }
      const order = await res.json();
      setSuccess(`✅ Pedido ${order.codigo} creado exitosamente. Giving Out lo revisará pronto.`);
      setLines([]); setEndCustomerId(''); setNotas(''); setFechaCompromiso('');
      setTimeout(() => navigate('/portal/pedidos'), 3000);
    } catch (err: any) { setError(err.message); }
    setSubmitting(false);
  }

  const totalItems = lines.reduce((sum, l) => sum + l.cantidadSolicitada, 0);

  return (
    <div className="page-container">
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/portal/pedidos')}><ArrowLeft size={18} /></button>
          <div>
            <h1 className="page-title">Nuevo Pedido</h1>
            <p className="page-subtitle">Crea un pedido para que Giving Out lo prepare y despache</p>
          </div>
        </div>
      </div>

      {success && (
        <div className="card animate-fade-in" style={{ marginBottom: 20, padding: '20px 24px', borderLeft: '4px solid var(--emerald)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <CheckCircle size={24} style={{ color: 'var(--emerald)' }} />
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{success}</div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>Redirigiendo a tus pedidos...</div>
            </div>
          </div>
        </div>
      )}

      {!success && (
        <form onSubmit={handleSubmit}>
          {/* Header Info */}
          <div className="card" style={{ marginBottom: 20 }}>
            <div style={{ padding: '20px 24px' }}>
              <h3 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 700 }}><Store size={16} /> Información del Pedido</h3>
              <div className="form-row">
                <div className="form-group" style={{ flex: 2 }}>
                  <label className="form-label">Destino de Entrega (Ship-To) <span className="required">*</span></label>
                  <select className="form-select form-select-full" value={endCustomerId} onChange={e => setEndCustomerId(e.target.value)} required>
                    <option value="">Seleccionar destino...</option>
                    {endCustomers.map(ec => (
                      <option key={ec.id} value={ec.id}>{ec.nombre} — {ec.ciudad}{ec.calle ? `, ${ec.calle}` : ''}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Fecha Compromiso</label>
                  <input type="date" className="form-input" value={fechaCompromiso} onChange={e => setFechaCompromiso(e.target.value)} />
                </div>
                <div className="form-group" style={{ maxWidth: 120 }}>
                  <label className="form-label">Prioridad</label>
                  <select className="form-select form-select-full" value={prioridad} onChange={e => setPrioridad(Number(e.target.value))}>
                    <option value={1}>🔴 Urgente</option>
                    <option value={3}>🟡 Alta</option>
                    <option value={5}>🟢 Normal</option>
                    <option value={8}>⚪ Baja</option>
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Notas u observaciones</label>
                <textarea className="form-input" rows={2} placeholder="Instrucciones especiales, ventana de entrega, etc." value={notas} onChange={e => setNotas(e.target.value)} />
              </div>
            </div>
          </div>

          {/* Order Lines */}
          <div className="card" style={{ marginBottom: 20 }}>
            <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}><Package size={16} /> Productos ({lines.length} líneas · {totalItems} uds)</h3>
              <button type="button" className="btn btn-primary btn-sm" onClick={addLine}><Plus size={14} /> Agregar Producto</button>
            </div>
            <div style={{ padding: '12px 24px' }}>
              {lines.length === 0 ? (
                <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-tertiary)' }}>
                  Agrega productos a tu pedido con el botón "Agregar Producto"
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ color: 'var(--text-tertiary)', fontSize: 11, textTransform: 'uppercase' as const }}>
                      <th style={{ textAlign: 'left', padding: '8px 0', width: '50%' }}>Producto</th>
                      <th style={{ textAlign: 'center', padding: '8px 0' }}>UoM</th>
                      <th style={{ textAlign: 'center', padding: '8px 0', width: 120 }}>Cantidad</th>
                      <th style={{ width: 40 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line, idx) => (
                      <tr key={idx} style={{ borderTop: '1px solid var(--border)' }}>
                        <td style={{ padding: '8px 0' }}>
                          <select className="form-select form-select-full" value={line.skuId} onChange={e => updateLine(idx, e.target.value)} style={{ fontSize: 13 }}>
                            <option value="">Seleccionar producto...</option>
                            {skus.map(s => (
                              <option key={s.id} value={s.id}>{s.descripcion} ({s.codigo})</option>
                            ))}
                          </select>
                        </td>
                        <td style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>{line.uom || '—'}</td>
                        <td style={{ padding: '8px 12px' }}>
                          <input type="number" className="form-input" min={1} value={line.cantidadSolicitada}
                            onChange={e => updateQty(idx, parseInt(e.target.value) || 1)}
                            style={{ textAlign: 'center', fontSize: 14, fontWeight: 700 }} />
                        </td>
                        <td>
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeLine(idx)} style={{ color: 'var(--error)' }}>
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {error && <div style={{ padding: '12px 16px', background: 'rgba(239,68,68,0.1)', borderRadius: 8, color: 'var(--error)', fontSize: 14, marginBottom: 16 }}>{error}</div>}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
            <button type="button" className="btn btn-ghost" onClick={() => navigate('/portal/pedidos')}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={submitting || lines.length === 0}>
              <ShoppingCart size={16} /> {submitting ? 'Enviando...' : `Solicitar Pedido (${lines.length} líneas)`}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
