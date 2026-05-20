import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { API } from '../config/api';
import { Store, Search, RefreshCw, Plus, X, Phone, Mail, MapPin, Truck, ChevronDown, ChevronUp, FileText } from 'lucide-react';

export function EndCustomers() {
  const { token } = useAuth();
  const [endCustomers, setEndCustomers] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterClient, setFilterClient] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    clienteId: '', codigo: '', nombre: '', razonSocial: '', rfc: '',
    contacto: '', telefono: '', email: '',
    calle: '', colonia: '', ciudad: '', estado: '', codigoPostal: '', referencia: '',
    instruccionesEntrega: '', requiereFactura: false,
  });
  const [submitting, setSubmitting] = useState(false);
  const [formMsg, setFormMsg] = useState({ type: '', text: '' });
  const headers: any = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  useEffect(() => { loadData(); loadClients(); }, []);

  async function loadData() {
    setLoading(true);
    try {
      const params = filterClient ? `?clienteId=${filterClient}` : '';
      const res = await fetch(`${API}/end-customers${params}`, { headers });
      if (res.ok) setEndCustomers(await res.json());
    } catch (err) { console.error(err); }
    setLoading(false);
  }

  async function loadClients() {
    try {
      const res = await fetch(`${API}/clients`, { headers });
      if (res.ok) setClients(await res.json());
    } catch {}
  }

  useEffect(() => { loadData(); }, [filterClient]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormMsg({ type: '', text: '' });
    if (!form.clienteId || !form.codigo || !form.nombre) {
      setFormMsg({ type: 'error', text: 'Depositante, código y nombre son obligatorios' }); return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`${API}/end-customers`, { method: 'POST', headers, body: JSON.stringify(form) });
      if (!res.ok) throw new Error((await res.json()).message || 'Error');
      setFormMsg({ type: 'success', text: '✅ Cliente final creado' });
      setForm({ clienteId: '', codigo: '', nombre: '', razonSocial: '', rfc: '', contacto: '', telefono: '', email: '', calle: '', colonia: '', ciudad: '', estado: '', codigoPostal: '', referencia: '', instruccionesEntrega: '', requiereFactura: false });
      loadData();
      setTimeout(() => { setShowForm(false); setFormMsg({ type: '', text: '' }); }, 2000);
    } catch (err: any) { setFormMsg({ type: 'error', text: err.message }); }
    setSubmitting(false);
  }

  const filtered = endCustomers.filter(ec =>
    !search || ec.nombre?.toLowerCase().includes(search.toLowerCase()) ||
    ec.codigo?.toLowerCase().includes(search.toLowerCase()) ||
    ec.ciudad?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Clientes Finales (Ship-To)</h1>
          <p className="page-subtitle">{endCustomers.length} destinos de entrega registrados</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" onClick={() => { setShowForm(true); setFormMsg({ type: '', text: '' }); }}><Plus size={16} /> Nuevo Destino</button>
          <button className="btn btn-secondary" onClick={loadData}><RefreshCw size={16} /> Actualizar</button>
        </div>
      </div>

      {/* Filters */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 12, padding: '16px 20px', flexWrap: 'wrap' }}>
          <div className="search-box" style={{ flex: 1, minWidth: 200 }}><Search size={16} /><input placeholder="Buscar por nombre, código o ciudad..." value={search} onChange={e => setSearch(e.target.value)} /></div>
          <select className="form-select" value={filterClient} onChange={e => setFilterClient(e.target.value)} style={{ minWidth: 200 }}>
            <option value="">Todos los depositantes</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.nombreComercial}</option>)}
          </select>
        </div>
      </div>

      {/* New End Customer Modal */}
      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 650 }}>
            <div className="modal-header">
              <h2><Store size={20} /> Nuevo Cliente Final (Ship-To)</h2>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowForm(false)}><X size={18} /></button>
            </div>
            <form onSubmit={handleSubmit} className="modal-body">
              <div className="form-row">
                <div className="form-group" style={{ flex: 2 }}>
                  <label className="form-label">Depositante <span className="required">*</span></label>
                  <select className="form-select form-select-full" value={form.clienteId} onChange={e => setForm(f => ({ ...f, clienteId: e.target.value }))} required>
                    <option value="">Seleccionar depositante...</option>
                    {clients.map(c => <option key={c.id} value={c.id}>{c.nombreComercial} ({c.giro})</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Código <span className="required">*</span></label>
                  <input className="form-input" placeholder="SANBORNS-REFORMA" value={form.codigo} onChange={e => setForm(f => ({ ...f, codigo: e.target.value }))} required />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group" style={{ flex: 2 }}>
                  <label className="form-label">Nombre <span className="required">*</span></label>
                  <input className="form-input" placeholder="Sanborns Reforma" value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} required />
                </div>
                <div className="form-group">
                  <label className="form-label">Contacto</label>
                  <input className="form-input" placeholder="Nombre del contacto" value={form.contacto} onChange={e => setForm(f => ({ ...f, contacto: e.target.value }))} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Teléfono</label>
                  <input className="form-input" placeholder="55-1234-5678" value={form.telefono} onChange={e => setForm(f => ({ ...f, telefono: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Email</label>
                  <input className="form-input" type="email" placeholder="recibo@destino.mx" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
                </div>
              </div>
              <div style={{ margin: '12px 0 6px', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>📍 Dirección de Entrega</div>
              <div className="form-row">
                <div className="form-group" style={{ flex: 2 }}>
                  <label className="form-label">Calle</label>
                  <input className="form-input" placeholder="Av. Reforma 345" value={form.calle} onChange={e => setForm(f => ({ ...f, calle: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Colonia</label>
                  <input className="form-input" placeholder="Cuauhtémoc" value={form.colonia} onChange={e => setForm(f => ({ ...f, colonia: e.target.value }))} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group"><label className="form-label">Ciudad</label><input className="form-input" placeholder="CDMX" value={form.ciudad} onChange={e => setForm(f => ({ ...f, ciudad: e.target.value }))} /></div>
                <div className="form-group"><label className="form-label">Estado</label><input className="form-input" placeholder="CDMX" value={form.estado} onChange={e => setForm(f => ({ ...f, estado: e.target.value }))} /></div>
                <div className="form-group"><label className="form-label">C.P.</label><input className="form-input" placeholder="06500" value={form.codigoPostal} onChange={e => setForm(f => ({ ...f, codigoPostal: e.target.value }))} /></div>
              </div>
              <div className="form-group">
                <label className="form-label">Instrucciones de Entrega</label>
                <textarea className="form-input" rows={2} placeholder="Entrar por rampa de carga. Solo Lunes-Viernes 8am-3pm." value={form.instruccionesEntrega} onChange={e => setForm(f => ({ ...f, instruccionesEntrega: e.target.value }))} />
              </div>
              <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" checked={form.requiereFactura} onChange={e => setForm(f => ({ ...f, requiereFactura: e.target.checked }))} />
                <label className="form-label" style={{ margin: 0 }}>Requiere factura</label>
              </div>
              {formMsg.text && <div className={`form-message ${formMsg.type === 'error' ? 'form-error-msg' : 'form-success-msg'}`}>{formMsg.text}</div>}
              <div className="modal-footer">
                <button type="button" className="btn btn-ghost" onClick={() => setShowForm(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>{submitting ? 'Guardando...' : 'Guardar Destino'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-secondary)' }}><RefreshCw className="animate-spin" size={24} /> Cargando...</div>
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          {filtered.length === 0 && <div className="card"><div style={{ padding: 40, textAlign: 'center', color: 'var(--text-tertiary)' }}>No hay clientes finales. Crea uno nuevo.</div></div>}
          {filtered.map((ec, i) => (
            <div key={ec.id} className="card animate-fade-in" style={{ animationDelay: `${i * 0.04}s` }}>
              <div style={{ padding: '20px 24px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                    <div style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--primary-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary)' }}><Store size={20} /></div>
                    <div>
                      <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{ec.nombre}</h3>
                      <div style={{ fontSize: 12, color: 'var(--text-tertiary)', fontFamily: 'monospace' }}>{ec.codigo}</div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                        <span className="badge badge-info">{ec.cliente?.nombreComercial}</span>
                        {ec.requiereFactura && <span className="badge badge-warning"><FileText size={10} /> Factura</span>}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--primary)' }}>{ec._count?.ordenes || 0}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Pedidos</div>
                    </div>
                    <button className="btn btn-ghost btn-sm" onClick={() => setExpanded(expanded === ec.id ? null : ec.id)}>
                      {expanded === ec.id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </button>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 20, marginTop: 10, flexWrap: 'wrap' }}>
                  {ec.contacto && <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, color: 'var(--text-secondary)' }}><Phone size={12} /> {ec.contacto}</span>}
                  {ec.telefono && <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, color: 'var(--text-secondary)' }}><Phone size={12} /> {ec.telefono}</span>}
                  {ec.email && <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, color: 'var(--text-secondary)' }}><Mail size={12} /> {ec.email}</span>}
                  {ec.ciudad && <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, color: 'var(--text-secondary)' }}><MapPin size={12} /> {ec.calle ? `${ec.calle}, ` : ''}{ec.ciudad}{ec.codigoPostal ? ` CP ${ec.codigoPostal}` : ''}</span>}
                </div>

                {expanded === ec.id && (
                  <div style={{ marginTop: 14, padding: 14, background: 'var(--bg-secondary)', borderRadius: 8 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                      <div>
                        <h4 style={{ margin: '0 0 6px', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>📍 Dirección Completa</h4>
                        <div style={{ fontSize: 13 }}>
                          {ec.calle && <div>{ec.calle}</div>}
                          {ec.colonia && <div>Col. {ec.colonia}</div>}
                          <div>{ec.ciudad}, {ec.estado} {ec.codigoPostal}</div>
                          {ec.referencia && <div style={{ color: 'var(--text-tertiary)', marginTop: 4 }}>Ref: {ec.referencia}</div>}
                        </div>
                      </div>
                      <div>
                        <h4 style={{ margin: '0 0 6px', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>🚚 Instrucciones de Entrega</h4>
                        <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                          {ec.instruccionesEntrega || 'Sin instrucciones especiales'}
                        </div>
                      </div>
                    </div>
                    {ec.razonSocial && <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-tertiary)' }}>Razón Social: {ec.razonSocial} {ec.rfc && `· RFC: ${ec.rfc}`}</div>}
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
