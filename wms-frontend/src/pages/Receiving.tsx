import { useEffect, useState, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { API } from '../config/api';
import {
  ClipboardList, Search, RefreshCw, Check, Clock, AlertCircle,
  ChevronDown, ChevronUp, Plus, X, Package, MapPin, Truck, UploadCloud, FileSpreadsheet
} from 'lucide-react';
import * as XLSX from 'xlsx';

interface PrevioForm {
  clienteId: string;
  proveedorId: string;
  origen: string;
  lineaTransporte: string;
  placa: string;
  nombreChofer: string;
  notas: string;
}

interface ProcessLineForm {
  cantidadConforme: number;
  cantidadNoConforme: number;
  ubicacionConformeId: string;
  ubicacionNoConformeId: string;
  lote: string;
  fechaVencimiento: string;
  tipoHu: string;
}

export function Receiving() {
  const { token, user } = useAuth();
  const [receipts, setReceipts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterEstado, setFilterEstado] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  // Catalogs
  const [clients, setClients] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [skus, setSkus] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [warehouse, setWarehouse] = useState<any>(null);

  // Forms State
  const [showNewPrevio, setShowNewPrevio] = useState(false);
  const [newPrevio, setNewPrevio] = useState<PrevioForm>({
    clienteId: '', proveedorId: '', origen: 'NACIONAL',
    lineaTransporte: '', placa: '', nombreChofer: '', notas: ''
  });
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [showProcess, setShowProcess] = useState<string | null>(null); // receiptId
  const [processLineId, setProcessLineId] = useState<string | null>(null);
  const [processForm, setProcessForm] = useState<ProcessLineForm>({
    cantidadConforme: 0, cantidadNoConforme: 0,
    ubicacionConformeId: '', ubicacionNoConformeId: '',
    lote: '', fechaVencimiento: '', tipoHu: 'CAJA'
  });

  const [submitting, setSubmitting] = useState(false);
  const [formMsg, setFormMsg] = useState({ type: '', text: '' });

  const headers: any = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [receiptsRes, clientsRes, suppliersRes, skusRes, locationsRes, warehousesRes] = await Promise.all([
        fetch(`${API}/receipts`, { headers }),
        fetch(`${API}/clients`, { headers }),
        fetch(`${API}/suppliers`, { headers }),
        fetch(`${API}/skus`, { headers }),
        fetch(`${API}/locations`, { headers }),
        fetch(`${API}/warehouses`, { headers }),
      ]);
      if (receiptsRes.ok) setReceipts(await receiptsRes.json());
      if (clientsRes.ok) setClients(await clientsRes.json());
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

  // --- NUEVO PREVIO ---
  async function handleCreatePrevio(e: React.FormEvent) {
    e.preventDefault();
    setFormMsg({ type: '', text: '' });
    if (!newPrevio.clienteId || !file) {
      setFormMsg({ type: 'error', text: 'Cliente y Archivo Excel son obligatorios' });
      return;
    }

    setSubmitting(true);
    try {
      // 1. Read Excel
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json(ws) as any[];

      // 2. Match SKUs
      const lineas: any[] = [];
      for (const row of data) {
        const codigo = row.Codigo || row.SKU || row.codigo || row.sku;
        const cantidad = Number(row.Cantidad || row.cantidad) || 0;
        if (!codigo || cantidad <= 0) continue;

        const sku = skus.find(s => s.codigo === String(codigo) && s.clienteId === newPrevio.clienteId);
        if (sku) {
          lineas.push({ skuId: sku.id, cantidadEsperada: cantidad });
        }
      }

      if (lineas.length === 0) {
        throw new Error('No se encontraron SKUs válidos en el archivo para este cliente.');
      }

      // 3. Create Receipt
      const payload = {
        clienteId: newPrevio.clienteId,
        proveedorId: newPrevio.proveedorId || undefined,
        origen: newPrevio.origen,
        lineaTransporte: newPrevio.lineaTransporte,
        placa: newPrevio.placa,
        nombreChofer: newPrevio.nombreChofer,
        notas: newPrevio.notas,
        archivoPrevioUrl: file.name, // Mock
        lineas
      };

      const res = await fetch(`${API}/receipts`, {
        method: 'POST', headers, body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error((await res.json()).message || 'Error al crear Previo');

      setFormMsg({ type: 'success', text: 'Previo de Recibo cargado exitosamente' });
      loadData();
      setTimeout(() => { setShowNewPrevio(false); setFile(null); setFormMsg({ type: '', text: '' }); }, 2000);
    } catch (err: any) {
      setFormMsg({ type: 'error', text: err.message });
    }
    setSubmitting(false);
  }

  // --- PROCESAR RECEPCION ---
  async function handleProcessLine(e: React.FormEvent, receiptId: string, lineId: string) {
    e.preventDefault();
    setFormMsg({ type: '', text: '' });
    
    if (processForm.cantidadConforme <= 0 && processForm.cantidadNoConforme <= 0) {
      setFormMsg({ type: 'error', text: 'Debes ingresar al menos una cantidad' });
      return;
    }
    if (processForm.cantidadConforme > 0 && !processForm.ubicacionConformeId) {
      setFormMsg({ type: 'error', text: 'Selecciona ubicación para Conforme' });
      return;
    }
    if (processForm.cantidadNoConforme > 0 && !processForm.ubicacionNoConformeId) {
      setFormMsg({ type: 'error', text: 'Selecciona ubicación para No Conforme' });
      return;
    }

    const rec = receipts.find(r => r.id === receiptId);
    const line = rec?.lineas.find((l: any) => l.id === lineId);
    
    setSubmitting(true);
    try {
      const res = await fetch(`${API}/reception`, {
        method: 'POST', headers,
        body: JSON.stringify({
          receiptLineId: lineId,
          skuId: line.skuId,
          clienteId: rec.clienteId,
          cantidadConforme: processForm.cantidadConforme,
          cantidadNoConforme: processForm.cantidadNoConforme,
          ubicacionConformeId: processForm.ubicacionConformeId,
          ubicacionNoConformeId: processForm.ubicacionNoConformeId,
          lote: processForm.lote || undefined,
          fechaVencimiento: processForm.fechaVencimiento || undefined,
          tipoHu: processForm.tipoHu,
          almacenId: warehouse?.id,
          proveedor: rec.proveedor?.nombre,
          usuario: user?.email || 'admin',
          notas: `Recepción de Previo ${rec.codigo}`
        })
      });

      if (!res.ok) throw new Error((await res.json()).message || 'Error al procesar');
      
      setFormMsg({ type: 'success', text: 'Ingreso registrado correctamente' });
      loadData();
      setTimeout(() => { setProcessLineId(null); setFormMsg({ type: '', text: '' }); }, 1500);
    } catch (err: any) {
      setFormMsg({ type: 'error', text: err.message });
    }
    setSubmitting(false);
  }

  // Helpers
  const filtered = receipts.filter(r => {
    const matchSearch = !search || r.codigo?.toLowerCase().includes(search.toLowerCase()) || r.cliente?.nombreComercial?.toLowerCase().includes(search.toLowerCase());
    const matchEstado = !filterEstado || r.estado === filterEstado;
    return matchSearch && matchEstado;
  });

  const getSuggestedLocations = (sku: any, isConforme: boolean) => {
    // Para simplificar, buscamos ubicaciones libres. Si es No Conforme, buscamos en zonas de Cuarentena si existen.
    return locations.filter(l => l.estado === 'LIBRE' && l.activo).slice(0, 10);
  };

  const estadoBadge = (estado: string) => estado === 'COMPLETO' ? 'success' : estado === 'EN_PROCESO' ? 'warning' : estado === 'PENDIENTE' ? 'info' : 'default';

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Previos de Recibo (Recepción)</h1>
          <p className="page-subtitle">Cola de recepciones pendientes y procesadas</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" onClick={() => { setShowNewPrevio(true); setFormMsg({ type: '', text: '' }); }}>
            <UploadCloud size={16} /> Cargar Previo
          </button>
          <button className="btn btn-secondary" onClick={loadData}><RefreshCw size={16} /> Actualizar</button>
        </div>
      </div>

      {/* --- MODAL CARGAR PREVIO --- */}
      {showNewPrevio && (
        <div className="modal-overlay" onClick={() => setShowNewPrevio(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 600 }}>
            <div className="modal-header">
              <h2><FileSpreadsheet size={20} /> Cargar Nuevo Previo de Recibo</h2>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowNewPrevio(false)}><X size={18} /></button>
            </div>
            <form onSubmit={handleCreatePrevio} className="modal-body">
              <div className="form-row">
                <div className="form-group" style={{ flex: 2 }}>
                  <label className="form-label">Depositante (Cliente) <span className="required">*</span></label>
                  <select className="form-select form-select-full" value={newPrevio.clienteId} onChange={e => setNewPrevio({ ...newPrevio, clienteId: e.target.value })} required>
                    <option value="">Seleccionar...</option>
                    {clients.map(c => <option key={c.id} value={c.id}>{c.nombreComercial}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Origen</label>
                  <select className="form-select form-select-full" value={newPrevio.origen} onChange={e => setNewPrevio({ ...newPrevio, origen: e.target.value })}>
                    <option value="NACIONAL">Nacional</option>
                    <option value="IMPORTACION">Importación</option>
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Línea de Transporte</label>
                  <input className="form-input" placeholder="Ej. Castores" value={newPrevio.lineaTransporte} onChange={e => setNewPrevio({ ...newPrevio, lineaTransporte: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">Placa</label>
                  <input className="form-input" placeholder="Ej. 123-ABC" value={newPrevio.placa} onChange={e => setNewPrevio({ ...newPrevio, placa: e.target.value })} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group" style={{ flex: 2 }}>
                  <label className="form-label">Nombre Chofer / Contacto</label>
                  <input className="form-input" placeholder="Nombre completo" value={newPrevio.nombreChofer} onChange={e => setNewPrevio({ ...newPrevio, nombreChofer: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">Proveedor (Opcional)</label>
                  <select className="form-select form-select-full" value={newPrevio.proveedorId} onChange={e => setNewPrevio({ ...newPrevio, proveedorId: e.target.value })}>
                    <option value="">Ninguno</option>
                    {suppliers.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Archivo Excel (Plantilla) <span className="required">*</span></label>
                <div style={{ border: '2px dashed var(--border)', padding: 20, textAlign: 'center', borderRadius: 8 }}>
                  <input type="file" accept=".xlsx, .xls" ref={fileInputRef} style={{ display: 'none' }} onChange={e => setFile(e.target.files?.[0] || null)} />
                  {file ? (
                    <div>
                      <FileSpreadsheet size={32} style={{ color: 'var(--teal)' }} />
                      <p style={{ margin: '8px 0', fontWeight: 600 }}>{file.name}</p>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFile(null)}>Cambiar archivo</button>
                    </div>
                  ) : (
                    <div>
                      <UploadCloud size={32} style={{ color: 'var(--text-tertiary)' }} />
                      <p style={{ margin: '8px 0', color: 'var(--text-secondary)' }}>Sube el archivo de Excel con el previo.</p>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => fileInputRef.current?.click()}>Seleccionar Archivo</button>
                    </div>
                  )}
                </div>
              </div>
              {formMsg.text && <div className={`form-message ${formMsg.type === 'error' ? 'form-error-msg' : 'form-success-msg'}`}>{formMsg.text}</div>}
              <div className="modal-footer">
                <button type="button" className="btn btn-ghost" onClick={() => setShowNewPrevio(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>{submitting ? 'Procesando...' : 'Cargar Previo'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- COLA DE PREVIOS --- */}
      <div className="stats-grid" style={{ marginBottom: 20 }}>
        {['PENDIENTE', 'EN_PROCESO', 'COMPLETO'].map(estado => {
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
            <Search size={16} /><input placeholder="Buscar previo..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="card">
        <table className="data-table">
          <thead>
            <tr>
              <th>Código</th>
              <th>Fecha</th>
              <th>Depositante</th>
              <th>Transporte / Chofer</th>
              <th>Líneas</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(r => (
              <React.Fragment key={r.id}>
                <tr style={{ cursor: 'pointer', background: expanded === r.id ? 'var(--bg-secondary)' : '' }} onClick={() => setExpanded(expanded === r.id ? null : r.id)}>
                  <td style={{ fontWeight: 700 }}>{r.codigo}</td>
                  <td>{new Date(r.fechaRecepcion).toLocaleDateString('es-MX')}</td>
                  <td><span className="badge badge-info">{r.cliente?.nombreComercial}</span></td>
                  <td>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{r.lineaTransporte || '—'} {r.placa ? `(${r.placa})` : ''}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{r.nombreChofer || '—'}</div>
                  </td>
                  <td style={{ fontWeight: 600 }}>{r.lineas?.length || 0}</td>
                  <td><span className={`badge badge-${estadoBadge(r.estado)}`}>{r.estado.replace('_', ' ')}</span></td>
                  <td>{expanded === r.id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</td>
                </tr>
                {expanded === r.id && (
                  <tr>
                    <td colSpan={7} style={{ padding: 0 }}>
                      <div style={{ padding: 20, background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}>
                        <h4 style={{ margin: '0 0 12px' }}>Detalle de Líneas</h4>
                        <table className="data-table" style={{ background: 'var(--bg-card)', borderRadius: 8 }}>
                          <thead>
                            <tr>
                              <th>SKU</th>
                              <th>Esp</th>
                              <th>Conforme</th>
                              <th>No Conf.</th>
                              <th>Estado</th>
                              <th>Acción</th>
                            </tr>
                          </thead>
                          <tbody>
                            {r.lineas.map((l: any) => (
                              <React.Fragment key={l.id}>
                                <tr>
                                  <td>{l.sku?.codigo} <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{l.sku?.descripcion}</span></td>
                                  <td style={{ fontWeight: 600 }}>{l.cantidadEsperada}</td>
                                  <td style={{ color: 'var(--emerald)', fontWeight: 600 }}>{l.cantidadRecibida}</td>
                                  <td style={{ color: 'var(--orange)', fontWeight: 600 }}>{l.cantidadDanada}</td>
                                  <td><span className={`badge badge-${estadoBadge(l.estado)}`}>{l.estado}</span></td>
                                  <td>
                                    {l.estado !== 'COMPLETO' && (
                                      <button className="btn btn-primary btn-sm" onClick={() => {
                                        setProcessLineId(l.id);
                                        setProcessForm({
                                          ...processForm,
                                          cantidadConforme: (l.cantidadEsperada || 0) - l.cantidadRecibida - l.cantidadDanada,
                                          cantidadNoConforme: 0
                                        });
                                      }}>Ingresar</button>
                                    )}
                                  </td>
                                </tr>
                                {/* FORMULARIO DE INGRESO DUAL INLINE */}
                                {processLineId === l.id && (
                                  <tr>
                                    <td colSpan={6} style={{ padding: 16, background: 'rgba(37,99,235,0.05)' }}>
                                      <form onSubmit={(e) => handleProcessLine(e, r.id, l.id)}>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                                          {/* CONFORME */}
                                          <div style={{ border: '1px solid var(--border)', padding: 12, borderRadius: 8, background: 'var(--bg-card)' }}>
                                            <h5 style={{ margin: '0 0 8px', color: 'var(--emerald)' }}>✅ Zona Conforme</h5>
                                            <div className="form-group">
                                              <label className="form-label">Cantidad</label>
                                              <input type="number" className="form-input" min="0" value={processForm.cantidadConforme} onChange={e => setProcessForm({ ...processForm, cantidadConforme: parseInt(e.target.value) || 0 })} />
                                            </div>
                                            <div className="form-group">
                                              <label className="form-label">Ubicación Fís.</label>
                                              <select className="form-select form-select-full" value={processForm.ubicacionConformeId} onChange={e => setProcessForm({ ...processForm, ubicacionConformeId: e.target.value })}>
                                                <option value="">Sugerida...</option>
                                                {getSuggestedLocations(l.sku, true).map(loc => <option key={loc.id} value={loc.id}>{loc.codigo} (Cap: {loc.capacidadUnits})</option>)}
                                              </select>
                                            </div>
                                          </div>
                                          {/* NO CONFORME */}
                                          <div style={{ border: '1px solid var(--border)', padding: 12, borderRadius: 8, background: 'var(--bg-card)' }}>
                                            <h5 style={{ margin: '0 0 8px', color: 'var(--orange)' }}>⚠️ Zona No Conforme</h5>
                                            <div className="form-group">
                                              <label className="form-label">Cantidad</label>
                                              <input type="number" className="form-input" min="0" value={processForm.cantidadNoConforme} onChange={e => setProcessForm({ ...processForm, cantidadNoConforme: parseInt(e.target.value) || 0 })} />
                                            </div>
                                            <div className="form-group">
                                              <label className="form-label">Ubicación Fís.</label>
                                              <select className="form-select form-select-full" value={processForm.ubicacionNoConformeId} onChange={e => setProcessForm({ ...processForm, ubicacionNoConformeId: e.target.value })}>
                                                <option value="">Sugerida...</option>
                                                {getSuggestedLocations(l.sku, false).map(loc => <option key={loc.id} value={loc.id}>{loc.codigo} (Cap: {loc.capacidadUnits})</option>)}
                                              </select>
                                            </div>
                                          </div>
                                        </div>
                                        {/* Comunes */}
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginTop: 12 }}>
                                          <div className="form-group"><label className="form-label">Lote (Op)</label><input className="form-input" value={processForm.lote} onChange={e => setProcessForm({ ...processForm, lote: e.target.value })} /></div>
                                          <div className="form-group"><label className="form-label">Vencimiento</label><input type="date" className="form-input" value={processForm.fechaVencimiento} onChange={e => setProcessForm({ ...processForm, fechaVencimiento: e.target.value })} /></div>
                                          <div className="form-group"><label className="form-label">HU</label><select className="form-select form-select-full" value={processForm.tipoHu} onChange={e => setProcessForm({ ...processForm, tipoHu: e.target.value })}><option value="CAJA">Caja</option><option value="PALLET">Pallet</option></select></div>
                                        </div>
                                        {formMsg.text && <div className={`form-message ${formMsg.type === 'error' ? 'form-error-msg' : 'form-success-msg'}`}>{formMsg.text}</div>}
                                        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
                                          <button type="button" className="btn btn-ghost" onClick={() => setProcessLineId(null)}>Cancelar</button>
                                          <button type="submit" className="btn btn-primary" disabled={submitting}>Confirmar Ingreso</button>
                                        </div>
                                      </form>
                                    </td>
                                  </tr>
                                )}
                              </React.Fragment>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
