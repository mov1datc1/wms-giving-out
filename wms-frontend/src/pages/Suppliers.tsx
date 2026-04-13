import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { API } from '../config/api';
import { Building, Search, RefreshCw, Phone, Mail, User, Plus, X } from 'lucide-react';

export function Suppliers() {
  const { token } = useAuth();
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ nombre: '', codigo: '', rfc: '', telefono: '', email: '', contacto: '' });
  const [submitting, setSubmitting] = useState(false);
  const [formMsg, setFormMsg] = useState({ type: '', text: '' });
  const headers: any = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    try {
      const res = await fetch(`${API}/suppliers`, { headers });
      if (res.ok) setSuppliers(await res.json());
    } catch (err) { console.error(err); }
    setLoading(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormMsg({ type: '', text: '' });
    if (!form.nombre || !form.codigo) { setFormMsg({ type: 'error', text: 'Nombre y código son obligatorios' }); return; }
    setSubmitting(true);
    try {
      const res = await fetch(`${API}/suppliers`, { method: 'POST', headers, body: JSON.stringify(form) });
      if (!res.ok) throw new Error((await res.json()).message || 'Error');
      setFormMsg({ type: 'success', text: '✅ Proveedor creado' });
      setForm({ nombre: '', codigo: '', rfc: '', telefono: '', email: '', contacto: '' });
      loadData();
      setTimeout(() => { setShowForm(false); setFormMsg({ type: '', text: '' }); }, 2000);
    } catch (err: any) { setFormMsg({ type: 'error', text: err.message }); }
    setSubmitting(false);
  }

  const filtered = suppliers.filter(s => !search || s.nombre?.toLowerCase().includes(search.toLowerCase()) || s.codigo?.toLowerCase().includes(search.toLowerCase()) || s.rfc?.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Proveedores</h1>
          <p className="page-subtitle">{suppliers.length} proveedores registrados</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" onClick={() => { setShowForm(true); setFormMsg({ type: '', text: '' }); }}><Plus size={16} /> Nuevo Proveedor</button>
          <button className="btn btn-secondary" onClick={loadData}><RefreshCw size={16} /> Actualizar</button>
        </div>
      </div>

      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 560 }}>
            <div className="modal-header">
              <h2><Building size={20} /> Nuevo Proveedor</h2>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowForm(false)}><X size={18} /></button>
            </div>
            <form onSubmit={handleSubmit} className="modal-body">
              <div className="form-row">
                <div className="form-group" style={{ flex: 2 }}>
                  <label className="form-label">Nombre <span className="required">*</span></label>
                  <input className="form-input" placeholder="Nombre del proveedor" value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} required />
                </div>
                <div className="form-group">
                  <label className="form-label">Código <span className="required">*</span></label>
                  <input className="form-input" placeholder="PROV-006" value={form.codigo} onChange={e => setForm(f => ({ ...f, codigo: e.target.value }))} required />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">RFC</label>
                  <input className="form-input" placeholder="RFC del proveedor" value={form.rfc} onChange={e => setForm(f => ({ ...f, rfc: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Contacto</label>
                  <input className="form-input" placeholder="Nombre de contacto" value={form.contacto} onChange={e => setForm(f => ({ ...f, contacto: e.target.value }))} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Teléfono</label>
                  <input className="form-input" placeholder="55-1234-5678" value={form.telefono} onChange={e => setForm(f => ({ ...f, telefono: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Email</label>
                  <input className="form-input" type="email" placeholder="email@proveedor.mx" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
                </div>
              </div>
              {formMsg.text && <div className={`form-message ${formMsg.type === 'error' ? 'form-error-msg' : 'form-success-msg'}`}>{formMsg.text}</div>}
              <div className="modal-footer">
                <button type="button" className="btn btn-ghost" onClick={() => setShowForm(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>{submitting ? 'Guardando...' : 'Guardar Proveedor'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 12, padding: '16px 20px' }}>
          <div className="search-box" style={{ flex: 1 }}><Search size={16} /><input placeholder="Buscar por nombre, código o RFC..." value={search} onChange={e => setSearch(e.target.value)} /></div>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-secondary)' }}><RefreshCw className="animate-spin" size={24} /> Cargando...</div>
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          {filtered.map((s, i) => (
            <div key={s.id} className="card animate-fade-in" style={{ animationDelay: `${i * 0.05}s` }}>
              <div style={{ padding: '20px 24px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                    <div style={{ width: 48, height: 48, borderRadius: 12, background: 'rgba(99,102,241,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--purple)' }}><Building size={22} /></div>
                    <div>
                      <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{s.nombre}</h3>
                      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                        <code style={{ fontSize: 11, background: 'var(--bg-secondary)', padding: '1px 6px', borderRadius: 4 }}>{s.codigo}</code>
                        {s.rfc && <span style={{ fontSize: 12, color: 'var(--text-tertiary)', fontFamily: 'monospace' }}>{s.rfc}</span>}
                      </div>
                    </div>
                  </div>
                  <span className="badge badge-success">Activo</span>
                </div>
                <div style={{ display: 'flex', gap: 24, marginTop: 12, flexWrap: 'wrap' }}>
                  {s.telefono && <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, color: 'var(--text-secondary)' }}><Phone size={13} />{s.telefono}</span>}
                  {s.email && <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, color: 'var(--text-secondary)' }}><Mail size={13} />{s.email}</span>}
                  {s.contacto && <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, color: 'var(--text-secondary)' }}><User size={13} />{s.contacto}</span>}
                </div>
              </div>
            </div>
          ))}
          {filtered.length === 0 && <div className="card"><div style={{ padding: 40, textAlign: 'center', color: 'var(--text-tertiary)' }}>Sin proveedores</div></div>}
        </div>
      )}
    </div>
  );
}
