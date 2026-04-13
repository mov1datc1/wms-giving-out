import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { API } from '../config/api';
import { Users, Search, RefreshCw, Building2, Phone, Mail, MapPin, ChevronDown, ChevronUp, Plus, X } from 'lucide-react';

export function Clients() {
  const { token } = useAuth();
  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ nombreComercial: '', razonSocial: '', rfc: '', giro: 'ROPA', tipoCliente: 'ALMACEN_3PL', telefono: '', email: '', ciudad: '', estado: '' });
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
    if (!form.nombreComercial || !form.razonSocial) { setFormMsg({ type: 'error', text: 'Nombre comercial y razón social son obligatorios' }); return; }
    setSubmitting(true);
    try {
      const res = await fetch(`${API}/clients`, { method: 'POST', headers, body: JSON.stringify(form) });
      if (!res.ok) throw new Error((await res.json()).message || 'Error');
      setFormMsg({ type: 'success', text: '✅ Cliente creado' });
      setForm({ nombreComercial: '', razonSocial: '', rfc: '', giro: 'ROPA', tipoCliente: 'ALMACEN_3PL', telefono: '', email: '', ciudad: '', estado: '' });
      loadData();
      setTimeout(() => { setShowForm(false); setFormMsg({ type: '', text: '' }); }, 2000);
    } catch (err: any) { setFormMsg({ type: 'error', text: err.message }); }
    setSubmitting(false);
  }

  const filtered = clients.filter(c => !search || c.nombreComercial?.toLowerCase().includes(search.toLowerCase()) || c.razonSocial?.toLowerCase().includes(search.toLowerCase()) || c.rfc?.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Clientes</h1>
          <p className="page-subtitle">{clients.length} clientes registrados</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" onClick={() => { setShowForm(true); setFormMsg({ type: '', text: '' }); }}><Plus size={16} /> Nuevo Cliente</button>
          <button className="btn btn-secondary" onClick={loadData}><RefreshCw size={16} /> Actualizar</button>
        </div>
      </div>

      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 600 }}>
            <div className="modal-header">
              <h2><Users size={20} /> Nuevo Cliente</h2>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowForm(false)}><X size={18} /></button>
            </div>
            <form onSubmit={handleSubmit} className="modal-body">
              <div className="form-row">
                <div className="form-group" style={{ flex: 2 }}>
                  <label className="form-label">Nombre Comercial <span className="required">*</span></label>
                  <input className="form-input" placeholder="Nombre comercial" value={form.nombreComercial} onChange={e => setForm(f => ({ ...f, nombreComercial: e.target.value }))} required />
                </div>
                <div className="form-group">
                  <label className="form-label">Giro <span className="required">*</span></label>
                  <select className="form-select form-select-full" value={form.giro} onChange={e => setForm(f => ({ ...f, giro: e.target.value }))}>
                    <option value="ROPA">Ropa</option>
                    <option value="COMIDA">Comida</option>
                    <option value="GENERAL">General</option>
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Razón Social <span className="required">*</span></label>
                  <input className="form-input" placeholder="Razón social" value={form.razonSocial} onChange={e => setForm(f => ({ ...f, razonSocial: e.target.value }))} required />
                </div>
                <div className="form-group">
                  <label className="form-label">RFC</label>
                  <input className="form-input" placeholder="RFC" value={form.rfc} onChange={e => setForm(f => ({ ...f, rfc: e.target.value }))} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Teléfono</label>
                  <input className="form-input" placeholder="55-1234-5678" value={form.telefono} onChange={e => setForm(f => ({ ...f, telefono: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Email</label>
                  <input className="form-input" type="email" placeholder="email@cliente.mx" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Ciudad</label>
                  <input className="form-input" placeholder="CDMX" value={form.ciudad} onChange={e => setForm(f => ({ ...f, ciudad: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Estado</label>
                  <input className="form-input" placeholder="México" value={form.estado} onChange={e => setForm(f => ({ ...f, estado: e.target.value }))} />
                </div>
              </div>
              {formMsg.text && <div className={`form-message ${formMsg.type === 'error' ? 'form-error-msg' : 'form-success-msg'}`}>{formMsg.text}</div>}
              <div className="modal-footer">
                <button type="button" className="btn btn-ghost" onClick={() => setShowForm(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>{submitting ? 'Guardando...' : 'Guardar Cliente'}</button>
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
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-secondary)' }}><RefreshCw className="animate-spin" size={24} /> Cargando clientes...</div>
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          {filtered.map((c, i) => (
            <div key={c.id} className="card animate-fade-in" style={{ animationDelay: `${i * 0.05}s` }}>
              <div style={{ padding: '20px 24px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                    <div style={{ width: 48, height: 48, borderRadius: 12, background: c.giro === 'ROPA' ? 'var(--teal-bg)' : 'var(--emerald-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: c.giro === 'ROPA' ? 'var(--teal)' : 'var(--emerald)' }}><Building2 size={22} /></div>
                    <div>
                      <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{c.nombreComercial}</h3>
                      <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>{c.razonSocial}</p>
                      <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                        <span className={`badge badge-${c.giro === 'ROPA' ? 'info' : 'warning'}`}>{c.giro}</span>
                        <span className="badge badge-success">{c.tipoCliente}</span>
                        {c.rfc && <span style={{ fontSize: 11, color: 'var(--text-tertiary)', fontFamily: 'monospace' }}>{c.rfc}</span>}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--teal)' }}>{c._count?.skus || 0}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>SKUs</div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--purple)' }}>{c._count?.recepciones || 0}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Recepciones</div>
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
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                      <div>
                        <h4 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>Contactos</h4>
                        {c.contactos?.length ? c.contactos.map((ct: any, j: number) => (
                          <div key={j} style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                            <div style={{ fontWeight: 500, fontSize: 13 }}>{ct.nombre} {ct.esPrincipal && '⭐'}</div>
                            <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{ct.cargo} · {ct.email}</div>
                          </div>
                        )) : <p style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>Sin contactos</p>}
                      </div>
                      <div>
                        <h4 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>Direcciones de Entrega</h4>
                        {c.direccionesEntrega?.length ? c.direccionesEntrega.map((d: any, j: number) => (
                          <div key={j} style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                            <div style={{ fontWeight: 500, fontSize: 13 }}>{d.alias} {d.esDefault && '📍'}</div>
                            <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{d.calle}, {d.colonia}, {d.ciudad} {d.cp}</div>
                          </div>
                        )) : <p style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>Sin direcciones</p>}
                      </div>
                    </div>
                    <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-tertiary)' }}>
                      {c.requiereLote && <span className="badge badge-info" style={{ marginRight: 4 }}>Requiere Lote</span>}
                      {c.requiereCaducidad && <span className="badge badge-warning" style={{ marginRight: 4 }}>Requiere Caducidad</span>}
                      {c.requiereSerie && <span className="badge badge-info">Requiere Serie</span>}
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
