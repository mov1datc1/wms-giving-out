import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { API } from '../config/api';
import { Users, Search, RefreshCw, Building2, Phone, Mail, MapPin, ChevronDown, ChevronUp, Plus, X, Store, Settings, BarChart3 } from 'lucide-react';

export function Clients() {
  const { token } = useAuth();
  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    codigo: '', nombreComercial: '', razonSocial: '', rfc: '', giro: 'ROPA',
    uomPrincipal: 'PZA', manejoInventario: 'PIEZA', reglaInventario: 'FIFO',
    escaneoIndividual: false, requiereAprobacion: true,
    requiereLote: false, requiereSerie: false, requiereCaducidad: false,
    telefono: '', email: '', ciudad: '', estado: '', colorPortal: '#2563EB',
  });
  const [submitting, setSubmitting] = useState(false);
  const [formMsg, setFormMsg] = useState({ type: '', text: '' });
  const headers: any = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    try {
      const res = await fetch(`${API}/clients`, { headers });
      if (res.ok) setClients(await res.json());
    } catch (err) { console.error(err); }
    setLoading(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormMsg({ type: '', text: '' });
    if (!form.nombreComercial || !form.razonSocial || !form.codigo) { setFormMsg({ type: 'error', text: 'Código, nombre comercial y razón social son obligatorios' }); return; }
    setSubmitting(true);
    try {
      const res = await fetch(`${API}/clients`, { method: 'POST', headers, body: JSON.stringify(form) });
      if (!res.ok) throw new Error((await res.json()).message || 'Error');
      setFormMsg({ type: 'success', text: '✅ Depositante creado' });
      loadData();
      setTimeout(() => { setShowForm(false); setFormMsg({ type: '', text: '' }); }, 2000);
    } catch (err: any) { setFormMsg({ type: 'error', text: err.message }); }
    setSubmitting(false);
  }

  const filtered = clients.filter(c => !search || c.nombreComercial?.toLowerCase().includes(search.toLowerCase()) || c.razonSocial?.toLowerCase().includes(search.toLowerCase()) || c.rfc?.toLowerCase().includes(search.toLowerCase()));

  const giroColor = (giro: string) => {
    const map: any = { ROPA: { bg: 'var(--teal-bg)', fg: 'var(--teal)' }, COMIDA: { bg: 'var(--orange-bg)', fg: 'var(--orange)' }, GENERAL: { bg: 'var(--purple-bg)', fg: 'var(--purple)' } };
    return map[giro] || map.GENERAL;
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Depositantes</h1>
          <p className="page-subtitle">{clients.length} depositantes registrados</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" onClick={() => { setShowForm(true); setFormMsg({ type: '', text: '' }); }}><Plus size={16} /> Nuevo Depositante</button>
          <button className="btn btn-secondary" onClick={loadData}><RefreshCw size={16} /> Actualizar</button>
        </div>
      </div>

      {/* New Depositor Modal */}
      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 700 }}>
            <div className="modal-header">
              <h2><Users size={20} /> Nuevo Depositante</h2>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowForm(false)}><X size={18} /></button>
            </div>
            <form onSubmit={handleSubmit} className="modal-body">
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Código <span className="required">*</span></label>
                  <input className="form-input" placeholder="DEP-TEXTIL-01" value={form.codigo} onChange={e => setForm(f => ({ ...f, codigo: e.target.value }))} required />
                </div>
                <div className="form-group" style={{ flex: 2 }}>
                  <label className="form-label">Nombre Comercial <span className="required">*</span></label>
                  <input className="form-input" placeholder="Nombre comercial" value={form.nombreComercial} onChange={e => setForm(f => ({ ...f, nombreComercial: e.target.value }))} required />
                </div>
                <div className="form-group">
                  <label className="form-label">Giro</label>
                  <select className="form-select form-select-full" value={form.giro} onChange={e => setForm(f => ({ ...f, giro: e.target.value }))}>
                    <option value="ROPA">Ropa</option>
                    <option value="COMIDA">Comida</option>
                    <option value="GENERAL">General</option>
                    <option value="FARMACEUTICO">Farmacéutico</option>
                    <option value="ELECTRONICA">Electrónica</option>
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group" style={{ flex: 2 }}>
                  <label className="form-label">Razón Social <span className="required">*</span></label>
                  <input className="form-input" placeholder="Razón social" value={form.razonSocial} onChange={e => setForm(f => ({ ...f, razonSocial: e.target.value }))} required />
                </div>
                <div className="form-group">
                  <label className="form-label">RFC</label>
                  <input className="form-input" placeholder="RFC" value={form.rfc} onChange={e => setForm(f => ({ ...f, rfc: e.target.value }))} />
                </div>
              </div>

              {/* 3PL Config Section */}
              <div style={{ margin: '16px 0 6px', fontSize: 13, fontWeight: 700, color: 'var(--primary)' }}>⚙️ Configuración Operativa 3PL</div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">UoM Principal</label>
                  <select className="form-select form-select-full" value={form.uomPrincipal} onChange={e => setForm(f => ({ ...f, uomPrincipal: e.target.value }))}>
                    <option value="PZA">Pieza</option>
                    <option value="CAJA">Caja</option>
                    <option value="MASTER">Master</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Manejo Inventario</label>
                  <select className="form-select form-select-full" value={form.manejoInventario} onChange={e => setForm(f => ({ ...f, manejoInventario: e.target.value }))}>
                    <option value="PIEZA">Por Pieza</option>
                    <option value="CAJA">Por Caja</option>
                    <option value="MIXTO">Mixto</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Regla Inventario</label>
                  <select className="form-select form-select-full" value={form.reglaInventario} onChange={e => setForm(f => ({ ...f, reglaInventario: e.target.value }))}>
                    <option value="FIFO">FIFO</option>
                    <option value="FEFO">FEFO</option>
                    <option value="LIFO">LIFO</option>
                  </select>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', margin: '8px 0 16px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                  <input type="checkbox" checked={form.escaneoIndividual} onChange={e => setForm(f => ({ ...f, escaneoIndividual: e.target.checked }))} /> Escaneo Individual
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                  <input type="checkbox" checked={form.requiereAprobacion} onChange={e => setForm(f => ({ ...f, requiereAprobacion: e.target.checked }))} /> Requiere Aprobación
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                  <input type="checkbox" checked={form.requiereLote} onChange={e => setForm(f => ({ ...f, requiereLote: e.target.checked }))} /> Requiere Lote
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                  <input type="checkbox" checked={form.requiereCaducidad} onChange={e => setForm(f => ({ ...f, requiereCaducidad: e.target.checked }))} /> Requiere Caducidad
                </label>
              </div>

              <div style={{ margin: '8px 0 6px', fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)' }}>📍 Contacto</div>
              <div className="form-row">
                <div className="form-group"><label className="form-label">Teléfono</label><input className="form-input" placeholder="55-1234-5678" value={form.telefono} onChange={e => setForm(f => ({ ...f, telefono: e.target.value }))} /></div>
                <div className="form-group"><label className="form-label">Email</label><input className="form-input" type="email" placeholder="email@depositante.mx" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></div>
                <div className="form-group"><label className="form-label">Ciudad</label><input className="form-input" placeholder="CDMX" value={form.ciudad} onChange={e => setForm(f => ({ ...f, ciudad: e.target.value }))} /></div>
              </div>
              <div className="form-group" style={{ maxWidth: 140 }}>
                <label className="form-label">Color Portal</label>
                <input type="color" value={form.colorPortal} onChange={e => setForm(f => ({ ...f, colorPortal: e.target.value }))} style={{ width: '100%', height: 36, border: 'none', cursor: 'pointer', borderRadius: 6 }} />
              </div>
              {formMsg.text && <div className={`form-message ${formMsg.type === 'error' ? 'form-error-msg' : 'form-success-msg'}`}>{formMsg.text}</div>}
              <div className="modal-footer">
                <button type="button" className="btn btn-ghost" onClick={() => setShowForm(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>{submitting ? 'Guardando...' : 'Guardar Depositante'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 12, padding: '16px 20px' }}>
          <div className="search-box" style={{ flex: 1 }}><Search size={16} /><input placeholder="Buscar por nombre, razón social o RFC..." value={search} onChange={e => setSearch(e.target.value)} /></div>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-secondary)' }}><RefreshCw className="animate-spin" size={24} /> Cargando depositantes...</div>
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          {filtered.map((c, i) => (
            <div key={c.id} className="card animate-fade-in" style={{ animationDelay: `${i * 0.05}s` }}>
              <div style={{ padding: '20px 24px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                    <div style={{ width: 48, height: 48, borderRadius: 12, background: giroColor(c.giro).bg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: giroColor(c.giro).fg }}><Building2 size={22} /></div>
                    <div>
                      <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{c.nombreComercial}</h3>
                      <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>{c.razonSocial}</p>
                      <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                        <span className={`badge badge-${c.giro === 'ROPA' ? 'info' : c.giro === 'COMIDA' ? 'warning' : 'default'}`}>{c.giro}</span>
                        <span className="badge badge-success">{c.reglaInventario}</span>
                        <span className="badge badge-default">{c.manejoInventario === 'PIEZA' ? 'Por Pieza' : c.manejoInventario === 'CAJA' ? 'Por Caja' : 'Mixto'}</span>
                        {c.escaneoIndividual && <span className="badge badge-info">Escaneo Individual</span>}
                        {c.requiereAprobacion && <span className="badge badge-warning">Aprobación Req.</span>}
                        {c.rfc && <span style={{ fontSize: 11, color: 'var(--text-tertiary)', fontFamily: 'monospace' }}>{c.rfc}</span>}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--teal)' }}>{c._count?.skus || 0}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>SKUs</div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--primary)' }}>{c._count?.endCustomers || 0}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Ship-To</div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--orange)' }}>{c._count?.ordenesSalida || 0}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Pedidos</div>
                    </div>
                    <button className="btn btn-ghost btn-sm" onClick={() => setExpanded(expanded === c.id ? null : c.id)}>
                      {expanded === c.id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </button>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 24, marginTop: 12, flexWrap: 'wrap' }}>
                  {c.telefono && <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, color: 'var(--text-secondary)' }}><Phone size={13} />{c.telefono}</span>}
                  {c.email && <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, color: 'var(--text-secondary)' }}><Mail size={13} />{c.email}</span>}
                  {c.ciudad && <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, color: 'var(--text-secondary)' }}><MapPin size={13} />{c.ciudad}, {c.estado}</span>}
                </div>
                {expanded === c.id && (
                  <div style={{ marginTop: 16, padding: 16, background: 'var(--bg-secondary)', borderRadius: 8 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 20 }}>
                      <div>
                        <h4 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>👥 Contactos</h4>
                        {c.contactos?.length ? c.contactos.map((ct: any, j: number) => (
                          <div key={j} style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                            <div style={{ fontWeight: 500, fontSize: 13 }}>{ct.nombre} {ct.esPrincipal && '⭐'}</div>
                            <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{ct.cargo} · {ct.email}</div>
                          </div>
                        )) : <p style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>Sin contactos</p>}
                      </div>
                      <div>
                        <h4 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>🏪 Clientes Finales (Ship-To)</h4>
                        {c.endCustomers?.length ? c.endCustomers.map((ec: any, j: number) => (
                          <div key={j} style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                            <div style={{ fontWeight: 500, fontSize: 13 }}>{ec.nombre}</div>
                            <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{ec.codigo} · {ec.ciudad}</div>
                          </div>
                        )) : <p style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>Sin clientes finales</p>}
                      </div>
                      <div>
                        <h4 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>⚙️ Config. Operativa</h4>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', fontSize: 13 }}>
                          <span style={{ color: 'var(--text-tertiary)' }}>UoM Principal:</span><span style={{ fontWeight: 600 }}>{c.uomPrincipal}</span>
                          <span style={{ color: 'var(--text-tertiary)' }}>Manejo:</span><span style={{ fontWeight: 600 }}>{c.manejoInventario}</span>
                          <span style={{ color: 'var(--text-tertiary)' }}>Rotación:</span><span style={{ fontWeight: 600 }}>{c.reglaInventario}</span>
                          <span style={{ color: 'var(--text-tertiary)' }}>Escaneo:</span><span style={{ fontWeight: 600 }}>{c.escaneoIndividual ? 'Individual' : 'Caja'}</span>
                          <span style={{ color: 'var(--text-tertiary)' }}>Aprobación:</span><span style={{ fontWeight: 600 }}>{c.requiereAprobacion ? 'Sí' : 'No'}</span>
                        </div>
                        <div style={{ marginTop: 8 }}>
                          {c.requiereLote && <span className="badge badge-info" style={{ marginRight: 4 }}>Lote</span>}
                          {c.requiereCaducidad && <span className="badge badge-warning" style={{ marginRight: 4 }}>Caducidad</span>}
                          {c.requiereSerie && <span className="badge badge-info">Serie</span>}
                        </div>
                        {c.colorPortal && (
                          <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                            <div style={{ width: 16, height: 16, borderRadius: 4, background: c.colorPortal }} />
                            <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Color Portal</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
