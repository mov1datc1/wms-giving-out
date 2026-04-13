import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { API } from '../config/api';
import {
  ClipboardList, Search, RefreshCw, Check, Clock, AlertCircle,
  ChevronDown, ChevronUp, Plus, X, Package, MapPin, Truck, Calendar
} from 'lucide-react';

interface ReceptionForm {
  proveedorId: string;
  skuId: string;
  cantidad: number;
  lote: string;
  tieneVencimiento: boolean;
  fechaVencimiento: string;
  tipoHu: string;
  ubicacionId: string;
  notas: string;
}

const emptyForm: ReceptionForm = {
  proveedorId: '', skuId: '', cantidad: 0, lote: '',
  tieneVencimiento: true, fechaVencimiento: '', tipoHu: 'CAJA',
  ubicacionId: '', notas: '',
};

export function Receiving() {
  const { token, user } = useAuth();
  const [receipts, setReceipts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterEstado, setFilterEstado] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<ReceptionForm>({ ...emptyForm });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [formSuccess, setFormSuccess] = useState('');

  // Catalogs
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [skus, setSkus] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [warehouse, setWarehouse] = useState<any>(null);
  const [suggestedLocations, setSuggestedLocations] = useState<any[]>([]);

  const headers: any = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [receiptsRes, suppliersRes, skusRes, locationsRes, warehousesRes] = await Promise.all([
        fetch(`${API}/receipts`, { headers }),
        fetch(`${API}/suppliers`, { headers }),
        fetch(`${API}/skus`, { headers }),
        fetch(`${API}/locations`, { headers }),
        fetch(`${API}/warehouses`, { headers }),
      ]);
      if (receiptsRes.ok) setReceipts(await receiptsRes.json());
      if (suppliersRes.ok) setSuppliers(await suppliersRes.json());
      if (skusRes.ok) setSkus(await skusRes.json());
      if (locationsRes.ok) setLocations(await locationsRes.json());
      if (warehousesRes.ok) {
        const whs = await warehousesRes.json();
        if (whs.length > 0) setWarehouse(whs[0]);
      }
    } catch (err) { console.error(err); }
    setLoading(false);
  }

  // When SKU changes, suggest locations based on its client's giro
  function onSkuChange(skuId: string) {
    setForm(f => ({ ...f, skuId, ubicacionId: '' }));
    if (!skuId) { setSuggestedLocations([]); return; }

    const sku = skus.find(s => s.id === skuId);
    if (!sku) return;

    // Auto-detect if product needs expiry based on SKU settings
    setForm(f => ({ ...f, tieneVencimiento: sku.requiereCaducidad || false }));

    // Suggest locations based on client giro
    const giro = sku.cliente?.giro;
    const preferredZone = giro === 'ROPA' ? 'ALM-A' : giro === 'COMIDA' ? 'ALM-B' : null;

    const free = locations
      .filter(l => l.estado === 'LIBRE' && l.tipoUbicacion === 'ESTANTERIA' && l.activo)
      .sort((a: any, b: any) => {
        const aPreferred = preferredZone && a.zona?.codigo === preferredZone ? 0 : 1;
        const bPreferred = preferredZone && b.zona?.codigo === preferredZone ? 0 : 1;
        if (aPreferred !== bPreferred) return aPreferred - bPreferred;
        return (b.capacidadUnits || 0) - (a.capacidadUnits || 0);
      });

    setSuggestedLocations(free);
    // Pre-select best location
    if (free.length > 0) {
      setForm(f => ({ ...f, ubicacionId: free[0].id }));
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    setFormSuccess('');

    if (!form.proveedorId || !form.skuId || !form.cantidad || !form.ubicacionId) {
      setFormError('Completa todos los campos obligatorios');
      return;
    }

    const selectedSku = skus.find(s => s.id === form.skuId);
    if (selectedSku?.requiereLote && !form.lote) {
      setFormError('Este producto requiere número de lote');
      return;
    }
    if (form.tieneVencimiento && !form.fechaVencimiento) {
      setFormError('Indica la fecha de vencimiento o desactiva el switch');
      return;
    }

    const supplier = suppliers.find(s => s.id === form.proveedorId);

    setSubmitting(true);
    try {
      const res = await fetch(`${API}/reception`, {
        method: 'POST', headers,
        body: JSON.stringify({
          skuId: form.skuId,
          clienteId: selectedSku?.clienteId,
          cantidad: Number(form.cantidad),
          lote: form.lote || undefined,
          fechaVencimiento: form.tieneVencimiento ? form.fechaVencimiento : undefined,
          tipoHu: form.tipoHu,
          ubicacionId: form.ubicacionId,
          almacenId: warehouse?.id,
          proveedor: supplier?.nombre || 'Proveedor',
          usuario: user?.email || 'admin@givingout.com',
          notas: form.notas || `Recepción de ${supplier?.nombre}`,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'Error al registrar recepción');
      }

      const result = await res.json();
      setFormSuccess(`✅ ${result.message}`);
      setForm({ ...emptyForm });
      setSuggestedLocations([]);
      loadData();
      setTimeout(() => { setShowForm(false); setFormSuccess(''); }, 2500);
    } catch (err: any) {
      setFormError(err.message || 'Error al procesar la recepción');
    }
    setSubmitting(false);
  }

  const filtered = receipts.filter(r => {
    const matchSearch = !search || r.codigo?.toLowerCase().includes(search.toLowerCase()) || r.cliente?.nombreComercial?.toLowerCase().includes(search.toLowerCase()) || r.ocReferencia?.toLowerCase().includes(search.toLowerCase());
    const matchEstado = !filterEstado || r.estado === filterEstado;
    return matchSearch && matchEstado;
  });

  const estadoBadge = (estado: string) => estado === 'COMPLETO' ? 'success' : estado === 'EN_PROCESO' ? 'warning' : estado === 'PENDIENTE' ? 'info' : 'default';
  const estadoIcon = (estado: string) => {
    switch (estado) {
      case 'COMPLETO': return <Check size={14} />;
      case 'EN_PROCESO': return <Clock size={14} />;
      case 'PENDIENTE': return <AlertCircle size={14} />;
      default: return <Package size={14} />;
    }
  };

  const selectedSku = skus.find(s => s.id === form.skuId);
  const selectedLocation = locations.find(l => l.id === form.ubicacionId);

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Recepción</h1>
          <p className="page-subtitle">{receipts.length} recepciones · {receipts.filter(r => r.estado === 'PENDIENTE').length} pendientes</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" onClick={() => { setShowForm(true); setFormError(''); setFormSuccess(''); setForm({ ...emptyForm }); setSuggestedLocations([]); }}>
            <Plus size={16} /> Nueva Recepción
          </button>
          <button className="btn btn-secondary" onClick={loadData}><RefreshCw size={16} /> Actualizar</button>
        </div>
      </div>

      {/* ==================== RECEPTION FORM MODAL ==================== */}
      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2><Truck size={20} /> Registrar Recepción de Mercancía</h2>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowForm(false)}><X size={18} /></button>
            </div>

            <form onSubmit={handleSubmit} className="modal-body">
              {/* Row 1: Supplier */}
              <div className="form-group">
                <label className="form-label">Proveedor <span className="required">*</span></label>
                <select className="form-select form-select-full" value={form.proveedorId} onChange={e => setForm(f => ({ ...f, proveedorId: e.target.value }))} required>
                  <option value="">Seleccionar proveedor...</option>
                  {suppliers.map(s => (
                    <option key={s.id} value={s.id}>{s.nombre} ({s.codigo})</option>
                  ))}
                </select>
              </div>

              {/* Row 2: SKU + Quantity */}
              <div className="form-row">
                <div className="form-group" style={{ flex: 2 }}>
                  <label className="form-label">Producto / SKU <span className="required">*</span></label>
                  <select className="form-select form-select-full" value={form.skuId} onChange={e => onSkuChange(e.target.value)} required>
                    <option value="">Seleccionar producto...</option>
                    {skus.map(s => (
                      <option key={s.id} value={s.id}>
                        {s.codigo} — {s.descripcion}{s.talla ? ` (${s.talla})` : ''}{s.color ? ` — ${s.color}` : ''} [{s.cliente?.nombreComercial}]
                      </option>
                    ))}
                  </select>
                  {selectedSku && (
                    <div className="form-hint">
                      {selectedSku.requiereLote && <span className="badge badge-info" style={{ marginRight: 4 }}>Req. Lote</span>}
                      {selectedSku.requiereCaducidad && <span className="badge badge-warning" style={{ marginRight: 4 }}>Req. Caducidad</span>}
                      <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                        Cliente: {selectedSku.cliente?.nombreComercial} · UoM: {selectedSku.uomBase} · {selectedSku.descripcionEmpaque || ''}
                      </span>
                    </div>
                  )}
                </div>
                <div className="form-group">
                  <label className="form-label">Cantidad <span className="required">*</span></label>
                  <input className="form-input" type="number" min="1" placeholder="0" value={form.cantidad || ''} onChange={e => setForm(f => ({ ...f, cantidad: parseInt(e.target.value) || 0 }))} required />
                </div>
              </div>

              {/* Row 3: Lot + Expiry with switch + HU type */}
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Número de Lote {selectedSku?.requiereLote && <span className="required">*</span>}</label>
                  <input className="form-input" placeholder="Ej: LOT-2026-001" value={form.lote} onChange={e => setForm(f => ({ ...f, lote: e.target.value }))} required={selectedSku?.requiereLote} />
                </div>
                <div className="form-group">
                  <label className="form-label" style={{ justifyContent: 'space-between' }}>
                    <span>Fecha Vencimiento {form.tieneVencimiento && <span className="required">*</span>}</span>
                    <label className="toggle-switch" title={form.tieneVencimiento ? 'Con vencimiento' : 'Sin vencimiento'}>
                      <input type="checkbox" checked={form.tieneVencimiento} onChange={e => setForm(f => ({ ...f, tieneVencimiento: e.target.checked, fechaVencimiento: e.target.checked ? f.fechaVencimiento : '' }))} />
                      <span className="toggle-slider"></span>
                      <span className="toggle-label">{form.tieneVencimiento ? 'Sí' : 'N/A'}</span>
                    </label>
                  </label>
                  {form.tieneVencimiento ? (
                    <input className="form-input" type="date" value={form.fechaVencimiento} onChange={e => setForm(f => ({ ...f, fechaVencimiento: e.target.value }))} required />
                  ) : (
                    <div className="form-input" style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}>Sin vencimiento (ej. ropa)</div>
                  )}
                </div>
                <div className="form-group">
                  <label className="form-label">Tipo HU</label>
                  <select className="form-select form-select-full" value={form.tipoHu} onChange={e => setForm(f => ({ ...f, tipoHu: e.target.value }))}>
                    <option value="CAJA">Caja</option>
                    <option value="PALLET">Pallet</option>
                    <option value="CONTENEDOR">Contenedor</option>
                    <option value="BOLSA">Bolsa</option>
                    <option value="OTRO">Otro</option>
                  </select>
                </div>
              </div>

              {/* Row 4: Location suggestion */}
              <div className="form-group">
                <label className="form-label"><MapPin size={14} /> Ubicación Destino <span className="required">*</span></label>
                {suggestedLocations.length > 0 && (
                  <div className="location-suggestion">
                    <div className="suggestion-header">
                      📍 Ubicaciones sugeridas para <strong>{selectedSku?.cliente?.giro || 'producto'}</strong> ({suggestedLocations.length} disponibles) — La mejor ya está preseleccionada
                    </div>
                    <div className="location-grid">
                      {suggestedLocations.slice(0, 12).map(loc => (
                        <div
                          key={loc.id}
                          className={`location-chip ${form.ubicacionId === loc.id ? 'selected' : ''}`}
                          onClick={() => setForm(f => ({ ...f, ubicacionId: loc.id }))}
                        >
                          <div className="location-chip-code">{loc.codigo}</div>
                          <div className="location-chip-zone">{loc.zona?.nombre || loc.zona?.codigo}</div>
                          {loc.capacidadUnits && <div className="location-chip-cap">Cap: {loc.capacidadUnits}</div>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {suggestedLocations.length === 0 && form.skuId && (
                  <div className="location-suggestion" style={{ borderColor: 'var(--danger)' }}>
                    <div className="suggestion-header" style={{ color: 'var(--danger)', background: 'var(--danger-soft)' }}>
                      ⚠️ No hay ubicaciones libres. Libere espacios despachando pedidos primero.
                    </div>
                  </div>
                )}
                {!form.skuId && (
                  <div style={{ padding: '10px 12px', background: 'var(--bg-secondary)', borderRadius: 8, fontSize: 13, color: 'var(--text-muted)' }}>
                    Selecciona un producto para ver ubicaciones sugeridas
                  </div>
                )}
                {selectedLocation && (
                  <div style={{ marginTop: 8, padding: '8px 12px', background: 'rgba(13,148,136,0.06)', borderRadius: 8, fontSize: 13, border: '1px solid rgba(13,148,136,0.15)' }}>
                    ✅ <strong>{selectedLocation.codigo}</strong> — {selectedLocation.zona?.nombre} · {selectedLocation.tipoUbicacion} · {selectedLocation.temperatura}
                  </div>
                )}
              </div>

              {/* Notes */}
              <div className="form-group">
                <label className="form-label">Notas</label>
                <input className="form-input" placeholder="Observaciones adicionales..." value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} />
              </div>

              {formError && <div className="form-message form-error-msg">{formError}</div>}
              {formSuccess && <div className="form-message form-success-msg">{formSuccess}</div>}

              <div className="modal-footer">
                <button type="button" className="btn btn-ghost" onClick={() => setShowForm(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary" disabled={submitting || !!formSuccess}>
                  {submitting ? <><RefreshCw size={14} className="animate-spin" /> Procesando...</> : <><Package size={16} /> Registrar Recepción</>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Summary stats */}
      <div className="stats-grid" style={{ marginBottom: 20 }}>
        {['PENDIENTE', 'EN_PROCESO', 'COMPLETO', 'CERRADO'].map(estado => {
          const count = receipts.filter(r => r.estado === estado).length;
          return (
            <div key={estado} className="stat-card" style={{ cursor: 'pointer', opacity: filterEstado && filterEstado !== estado ? 0.5 : 1 }} onClick={() => setFilterEstado(filterEstado === estado ? '' : estado)}>
              <div className="stat-info"><span className="stat-value">{count}</span><span className="stat-label">{estado.replace('_', ' ')}</span></div>
            </div>
          );
        })}
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 12, padding: '16px 20px' }}>
          <div className="search-box" style={{ flex: 1 }}>
            <Search size={16} />
            <input placeholder="Buscar por código, cliente, OC..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-secondary)' }}><RefreshCw className="animate-spin" size={24} /> Cargando recepciones...</div>
      ) : (
        <div className="card">
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Cliente</th>
                  <th>Proveedor</th>
                  <th>OC Ref.</th>
                  <th>Líneas</th>
                  <th>Estado</th>
                  <th>Fecha</th>
                  <th>Recibido por</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => (
                  <>
                    <tr key={r.id} className="animate-fade-in" style={{ animationDelay: `${i * 0.03}s`, cursor: 'pointer' }} onClick={() => setExpanded(expanded === r.id ? null : r.id)}>
                      <td style={{ fontWeight: 700 }}>{r.codigo}</td>
                      <td><span className="badge badge-info">{r.cliente?.nombreComercial}</span></td>
                      <td>{r.proveedor?.nombre || r.proveedorNombre || '—'}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{r.ocReferencia || '—'}</td>
                      <td style={{ fontWeight: 600 }}>{r.lineas?.length || 0}</td>
                      <td><span className={`badge badge-${estadoBadge(r.estado)}`}>{estadoIcon(r.estado)} {r.estado.replace('_', ' ')}</span></td>
                      <td style={{ fontSize: 13 }}>{new Date(r.fechaRecepcion).toLocaleDateString('es-MX')}</td>
                      <td style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{r.recibidoPor?.split('@')[0] || '—'}</td>
                      <td>{expanded === r.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</td>
                    </tr>
                    {expanded === r.id && r.lineas?.map((line: any, j: number) => (
                      <tr key={`${r.id}-${j}`} style={{ background: 'var(--bg-secondary)' }}>
                        <td></td>
                        <td colSpan={2} style={{ fontWeight: 500, fontSize: 13 }}>{line.sku?.codigo} — {line.sku?.descripcion}{line.sku?.talla ? ` (${line.sku.talla})` : ''}</td>
                        <td></td>
                        <td>
                          <div style={{ fontSize: 13 }}>
                            <span style={{ color: 'var(--text-tertiary)' }}>Esp:</span> <strong>{line.cantidadEsperada}</strong> →
                            <span style={{ color: 'var(--text-tertiary)' }}> Rec:</span> <strong style={{ color: line.cantidadRecibida >= (line.cantidadEsperada || 0) ? 'var(--emerald)' : 'var(--orange)' }}>{line.cantidadRecibida}</strong>
                          </div>
                        </td>
                        <td><span className={`badge badge-${estadoBadge(line.estado)}`}>{line.estado}</span></td>
                        <td colSpan={3} style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{line.loteAsignado ? `Lote: ${line.loteAsignado}` : ''}</td>
                      </tr>
                    ))}
                  </>
                ))}
                {filtered.length === 0 && <tr><td colSpan={9} style={{ textAlign: 'center', padding: 40, color: 'var(--text-tertiary)' }}>Sin recepciones</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
