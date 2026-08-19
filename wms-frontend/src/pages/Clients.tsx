import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { API } from '../config/api';
import {
  Users, Search, RefreshCw, Building2, Phone, Mail, MapPin, ChevronDown, ChevronUp,
  Plus, X, Settings2, Edit3, ShieldCheck, Package, Layers, Calendar, CheckCircle2,
  FileText, ArrowRight
} from 'lucide-react';

interface ClientForm {
  id?: string;
  codigo: string;
  nombreComercial: string;
  razonSocial: string;
  rfc: string;
  giro: string;
  uomPrincipal: string;
  manejoInventario: string;
  reglaInventario: string;
  escaneoIndividual: boolean;
  requiereAprobacion: boolean;
  requiereLote: boolean;
  requiereSerie: boolean;
  requiereCaducidad: boolean;
  telefono: string;
  email: string;
  ciudad: string;
  estado: string;
  colorPortal: string;
}

const DEFAULT_FORM: ClientForm = {
  codigo: '',
  nombreComercial: '',
  razonSocial: '',
  rfc: '',
  giro: 'ROPA',
  uomPrincipal: 'PZA',
  manejoInventario: 'PIEZA',
  reglaInventario: 'FIFO',
  escaneoIndividual: false,
  requiereAprobacion: true,
  requiereLote: false,
  requiereSerie: false,
  requiereCaducidad: false,
  telefono: '',
  email: '',
  ciudad: '',
  estado: '',
  colorPortal: '#0D9488',
};

export function Clients() {
  const { token } = useAuth();
  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState<ClientForm>(DEFAULT_FORM);
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

  function handleOpenCreate() {
    setIsEditing(false);
    setForm(DEFAULT_FORM);
    setFormMsg({ type: '', text: '' });
    setShowModal(true);
  }

  function handleOpenEdit(client: any) {
    setIsEditing(true);
    setForm({
      id: client.id,
      codigo: client.codigo || '',
      nombreComercial: client.nombreComercial || '',
      razonSocial: client.razonSocial || '',
      rfc: client.rfc || '',
      giro: client.giro || 'ROPA',
      uomPrincipal: client.uomPrincipal || 'PZA',
      manejoInventario: client.manejoInventario || 'PIEZA',
      reglaInventario: client.reglaInventario || 'FIFO',
      escaneoIndividual: Boolean(client.escaneoIndividual),
      requiereAprobacion: client.requiereAprobacion !== false,
      requiereLote: Boolean(client.requiereLote),
      requiereSerie: Boolean(client.requiereSerie),
      requiereCaducidad: Boolean(client.requiereCaducidad),
      telefono: client.telefono || '',
      email: client.email || '',
      ciudad: client.ciudad || '',
      estado: client.estado || '',
      colorPortal: client.colorPortal || '#0D9488',
    });
    setFormMsg({ type: '', text: '' });
    setShowModal(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormMsg({ type: '', text: '' });
    if (!form.nombreComercial || !form.razonSocial || !form.codigo) {
      setFormMsg({ type: 'error', text: 'Código, nombre comercial y razón social son obligatorios' });
      return;
    }
    setSubmitting(true);
    try {
      const url = isEditing && form.id ? `${API}/clients/${form.id}` : `${API}/clients`;
      const method = isEditing ? 'PUT' : 'POST';
      const res = await fetch(url, { method, headers, body: JSON.stringify(form) });
      if (!res.ok) throw new Error((await res.json()).message || 'Error al guardar depositante');
      
      setFormMsg({ type: 'success', text: isEditing ? '✅ Parámetros operativos actualizados' : '✅ Depositante creado exitosamente' });
      loadData();
      setTimeout(() => { setShowModal(false); setFormMsg({ type: '', text: '' }); }, 1500);
    } catch (err: any) {
      setFormMsg({ type: 'error', text: err.message });
    }
    setSubmitting(false);
  }

  const filtered = clients.filter(c => 
    !search || 
    c.nombreComercial?.toLowerCase().includes(search.toLowerCase()) || 
    c.razonSocial?.toLowerCase().includes(search.toLowerCase()) || 
    c.codigo?.toLowerCase().includes(search.toLowerCase()) || 
    c.rfc?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Depositantes (Clientes 3PL)</h1>
          <p className="page-subtitle">Configuración operativa estricta y parámetros de inventario por cliente (Ropa, Alimentos, etc.)</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" onClick={handleOpenCreate}>
            <Plus size={16} /> Nuevo Depositante
          </button>
          <button className="btn btn-secondary" onClick={loadData}>
            <RefreshCw size={16} /> Actualizar
          </button>
        </div>
      </div>

      {/* Modal de Creación / Edición */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 740 }}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 36, height: 36, borderRadius: 8, background: 'rgba(13,148,136,0.1)', color: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {isEditing ? <Settings2 size={20} /> : <Building2 size={20} />}
                </div>
                <div>
                  <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>
                    {isEditing ? `Editar Configuración 3PL — ${form.nombreComercial}` : 'Registrar Nuevo Depositante'}
                  </h2>
                  <p style={{ margin: 0, fontSize: 12, color: 'var(--text-tertiary)' }}>
                    {isEditing ? 'Las reglas fijadas aquí se heredarán automáticamente en recepción y pedidos.' : 'Define los parámetros operativos fijos para automatizar la operación en almacén.'}
                  </p>
                </div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowModal(false)}><X size={18} /></button>
            </div>

            <form onSubmit={handleSubmit} className="modal-body">
              {/* Sección 1: Datos Generales */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--primary)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Building2 size={14} /> 1. Datos Generales & Fiscales
                </div>
                <div className="form-row">
                  <div className="form-group" style={{ flex: 1 }}>
                    <label className="form-label">Código Único <span className="required">*</span></label>
                    <input 
                      className="form-input" 
                      placeholder="DEP-TEXTIL-01" 
                      value={form.codigo} 
                      onChange={e => setForm(f => ({ ...f, codigo: e.target.value.toUpperCase() }))} 
                      disabled={isEditing}
                      required 
                    />
                  </div>
                  <div className="form-group" style={{ flex: 2 }}>
                    <label className="form-label">Nombre Comercial <span className="required">*</span></label>
                    <input 
                      className="form-input" 
                      placeholder="Ej. Fashion Forward S.A." 
                      value={form.nombreComercial} 
                      onChange={e => setForm(f => ({ ...f, nombreComercial: e.target.value }))} 
                      required 
                    />
                  </div>
                  <div className="form-group" style={{ flex: 1.5 }}>
                    <label className="form-label">Giro del Negocio</label>
                    <select 
                      className="form-select form-select-full" 
                      value={form.giro} 
                      onChange={e => {
                        const newGiro = e.target.value;
                        setForm(f => ({
                          ...f,
                          giro: newGiro,
                          requiereLote: newGiro === 'COMIDA' || newGiro === 'FARMACEUTICO',
                          requiereCaducidad: newGiro === 'COMIDA' || newGiro === 'FARMACEUTICO',
                          reglaInventario: newGiro === 'COMIDA' ? 'FEFO' : 'FIFO',
                        }));
                      }}
                    >
                      <option value="ROPA">👕 Ropa & Textil</option>
                      <option value="COMIDA">🥫 Alimentos & Bebidas</option>
                      <option value="FARMACEUTICO">💊 Farmacéutico & Salud</option>
                      <option value="GENERAL">📦 Mercancía General</option>
                      <option value="ELECTRONICA">⚡ Electrónica</option>
                    </select>
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group" style={{ flex: 2 }}>
                    <label className="form-label">Razón Social <span className="required">*</span></label>
                    <input 
                      className="form-input" 
                      placeholder="Razón social para facturación" 
                      value={form.razonSocial} 
                      onChange={e => setForm(f => ({ ...f, razonSocial: e.target.value }))} 
                      required 
                    />
                  </div>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label className="form-label">RFC</label>
                    <input 
                      className="form-input" 
                      placeholder="RFC123456789" 
                      value={form.rfc} 
                      onChange={e => setForm(f => ({ ...f, rfc: e.target.value.toUpperCase() }))} 
                    />
                  </div>
                </div>
              </div>

              {/* Sección 2: Configuración Operativa 3PL */}
              <div style={{ marginBottom: 16, padding: '14px 16px', background: 'var(--bg-secondary)', borderRadius: 10, border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--primary)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Settings2 size={14} /> 2. Reglas Operativas Fijas (Cero Decisiones en Piso)
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Unidad de Medida Principal</label>
                    <select 
                      className="form-select form-select-full" 
                      value={form.uomPrincipal} 
                      onChange={e => setForm(f => ({ ...f, uomPrincipal: e.target.value }))}
                    >
                      <option value="PZA">Pieza (PZA)</option>
                      <option value="CAJA">Caja (CAJA)</option>
                      <option value="PALLET">Pallet (PALLET)</option>
                      <option value="MASTER">Master (MASTER)</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Manejo de Inventario</label>
                    <select 
                      className="form-select form-select-full" 
                      value={form.manejoInventario} 
                      onChange={e => setForm(f => ({ ...f, manejoInventario: e.target.value }))}
                    >
                      <option value="PIEZA">Por Pieza Individual</option>
                      <option value="CAJA">Por Caja Cerrada</option>
                      <option value="PALLET">Por Pallet Completo</option>
                      <option value="MIXTO">Mixto (Pieza y Caja)</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Regla de Rotación</label>
                    <select 
                      className="form-select form-select-full" 
                      value={form.reglaInventario} 
                      onChange={e => setForm(f => ({ ...f, reglaInventario: e.target.value }))}
                    >
                      <option value="FIFO">FIFO (First-In, First-Out / Picking rápido)</option>
                      <option value="FEFO">FEFO (First-Expired, First-Out / Alimentos)</option>
                      <option value="LIFO">LIFO (Last-In, First-Out)</option>
                    </select>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginTop: 12 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', background: 'var(--bg-card)', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)' }}>
                    <input 
                      type="checkbox" 
                      checked={form.requiereLote} 
                      onChange={e => setForm(f => ({ ...f, requiereLote: e.target.checked }))} 
                    />
                    <span><strong>Requiere Lote</strong> (Obligatorio en recibo)</span>
                  </label>

                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', background: 'var(--bg-card)', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)' }}>
                    <input 
                      type="checkbox" 
                      checked={form.requiereCaducidad} 
                      onChange={e => setForm(f => ({ ...f, requiereCaducidad: e.target.checked }))} 
                    />
                    <span><strong>Requiere Caducidad</strong> (Obligatorio en recibo)</span>
                  </label>

                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', background: 'var(--bg-card)', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)' }}>
                    <input 
                      type="checkbox" 
                      checked={form.escaneoIndividual} 
                      onChange={e => setForm(f => ({ ...f, escaneoIndividual: e.target.checked }))} 
                    />
                    <span><strong>Escaneo Individual</strong> (Láser pieza por pieza)</span>
                  </label>

                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', background: 'var(--bg-card)', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)' }}>
                    <input 
                      type="checkbox" 
                      checked={form.requiereAprobacion} 
                      onChange={e => setForm(f => ({ ...f, requiereAprobacion: e.target.checked }))} 
                    />
                    <span><strong>Aprobación de Pedidos</strong> (Giving Out autoriza)</span>
                  </label>
                </div>
              </div>

              {/* Sección 3: Contacto & Portal */}
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--primary)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <MapPin size={14} /> 3. Contacto & Portal
                </div>
                <div className="form-row">
                  <div className="form-group"><label className="form-label">Teléfono</label><input className="form-input" placeholder="55-1234-5678" value={form.telefono} onChange={e => setForm(f => ({ ...f, telefono: e.target.value }))} /></div>
                  <div className="form-group"><label className="form-label">Email Operativo</label><input className="form-input" type="email" placeholder="contacto@cliente.com" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></div>
                  <div className="form-group"><label className="form-label">Ciudad / Estado</label><input className="form-input" placeholder="CDMX / Edo Mex" value={form.ciudad} onChange={e => setForm(f => ({ ...f, ciudad: e.target.value }))} /></div>
                </div>
              </div>

              {formMsg.text && (
                <div className={`form-message ${formMsg.type === 'error' ? 'form-error-msg' : 'form-success-msg'}`} style={{ marginTop: 14 }}>
                  {formMsg.text}
                </div>
              )}

              <div className="modal-footer">
                <button type="button" className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>
                  {submitting ? 'Guardando...' : isEditing ? 'Actualizar Parámetros 3PL' : 'Guardar Depositante'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Buscador */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 12, padding: '14px 20px' }}>
          <div className="search-box" style={{ flex: 1 }}>
            <Search size={16} />
            <input placeholder="Buscar por código, nombre comercial, razón social o RFC..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-secondary)' }}>
          <RefreshCw className="animate-spin" size={24} /> Cargando depositantes...
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          {filtered.map((c, i) => (
            <div key={c.id} className="card animate-fade-in" style={{ animationDelay: `${i * 0.04}s` }}>
              <div style={{ padding: '20px 24px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
                  
                  {/* Info Principal */}
                  <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                    <div style={{ width: 48, height: 48, borderRadius: 10, background: 'var(--bg-secondary)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary)' }}>
                      <Building2 size={24} />
                    </div>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{c.nombreComercial}</h3>
                        <span style={{ fontSize: 12, color: 'var(--text-tertiary)', fontFamily: 'monospace', fontWeight: 600 }}>({c.codigo})</span>
                      </div>
                      <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>{c.razonSocial}</p>
                      
                      {/* Badges de Reglas Operativas */}
                      <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                        <span className="badge badge-info">{c.giro || 'GENERAL'}</span>
                        <span className="badge badge-success">{c.reglaInventario || 'FIFO'}</span>
                        <span className="badge badge-default">UoM: {c.uomPrincipal || 'PZA'}</span>
                        {c.requiereLote && <span className="badge badge-warning">Lote Obligatorio</span>}
                        {c.requiereCaducidad && <span className="badge badge-warning">Caducidad Obligatoria</span>}
                        {c.escaneoIndividual && <span className="badge badge-info">Escaneo 1x1</span>}
                        {c.requiereAprobacion && <span className="badge badge-default">Aprobación Req.</span>}
                        {c.rfc && <span style={{ fontSize: 11, color: 'var(--text-tertiary)', fontFamily: 'monospace' }}>RFC: {c.rfc}</span>}
                      </div>
                    </div>
                  </div>

                  {/* Métricas y Botón Editar */}
                  <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--primary)' }}>{c._count?.skus || 0}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>SKUs</div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--accent-secondary)' }}>{c._count?.endCustomers || 0}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Ship-To</div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--warning)' }}>{c._count?.ordenesSalida || 0}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Pedidos</div>
                    </div>

                    <button 
                      className="btn btn-secondary btn-sm" 
                      onClick={() => handleOpenEdit(c)}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}
                    >
                      <Settings2 size={14} /> Editar Reglas
                    </button>

                    <button className="btn btn-ghost btn-sm" onClick={() => setExpanded(expanded === c.id ? null : c.id)}>
                      {expanded === c.id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </button>
                  </div>
                </div>

                {/* Contacto rápido */}
                <div style={{ display: 'flex', gap: 20, marginTop: 12, flexWrap: 'wrap', fontSize: 12, color: 'var(--text-secondary)' }}>
                  {c.telefono && <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Phone size={13} />{c.telefono}</span>}
                  {c.email && <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Mail size={13} />{c.email}</span>}
                  {c.ciudad && <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><MapPin size={13} />{c.ciudad}, {c.estado}</span>}
                </div>

                {/* Sección Expandida */}
                {expanded === c.id && (
                  <div style={{ marginTop: 16, padding: 16, background: 'var(--bg-secondary)', borderRadius: 8 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
                      <div>
                        <h4 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>👥 Contactos Registrados</h4>
                        {c.contactos?.length ? c.contactos.map((ct: any, j: number) => (
                          <div key={j} style={{ padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
                            <div style={{ fontWeight: 600 }}>{ct.nombre} {ct.esPrincipal && '⭐'}</div>
                            <div style={{ color: 'var(--text-tertiary)' }}>{ct.cargo || 'Contacto'} · {ct.email}</div>
                          </div>
                        )) : <p style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Sin contactos</p>}
                      </div>

                      <div>
                        <h4 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>🏪 Clientes Finales (Ship-To)</h4>
                        {c.endCustomers?.length ? c.endCustomers.map((ec: any, j: number) => (
                          <div key={j} style={{ padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
                            <div style={{ fontWeight: 600 }}>{ec.nombre}</div>
                            <div style={{ color: 'var(--text-tertiary)' }}>{ec.codigo} · {ec.ciudad}</div>
                          </div>
                        )) : <p style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Sin clientes finales</p>}
                      </div>

                      <div>
                        <h4 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>⚙️ Parametrización 3PL</h4>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 10px', fontSize: 12 }}>
                          <span style={{ color: 'var(--text-tertiary)' }}>UoM Base:</span><strong>{c.uomPrincipal}</strong>
                          <span style={{ color: 'var(--text-tertiary)' }}>Manejo:</span><strong>{c.manejoInventario}</strong>
                          <span style={{ color: 'var(--text-tertiary)' }}>Rotación:</span><strong>{c.reglaInventario}</strong>
                          <span style={{ color: 'var(--text-tertiary)' }}>Lote Obligatorio:</span><strong>{c.requiereLote ? 'Sí' : 'No'}</strong>
                          <span style={{ color: 'var(--text-tertiary)' }}>Caducidad:</span><strong>{c.requiereCaducidad ? 'Sí' : 'No'}</strong>
                        </div>
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
