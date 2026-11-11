import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { API } from '../config/api';
import {
  Store, Search, RefreshCw, Plus, X, Phone, Mail, MapPin, Truck,
  ChevronDown, ChevronUp, FileText, Edit3, Trash2, RotateCcw, AlertTriangle
} from 'lucide-react';

interface EndCustomerForm {
  id?: string;
  clienteId: string;
  codigo: string;
  nombre: string;
  razonSocial: string;
  rfc: string;
  contacto: string;
  telefono: string;
  email: string;
  calle: string;
  colonia: string;
  ciudad: string;
  estado: string;
  codigoPostal: string;
  referencia: string;
  instruccionesEntrega: string;
  requiereFactura: boolean;
}

const DEFAULT_END_CUSTOMER_FORM: EndCustomerForm = {
  clienteId: '',
  codigo: '',
  nombre: '',
  razonSocial: '',
  rfc: '',
  contacto: '',
  telefono: '',
  email: '',
  calle: '',
  colonia: '',
  ciudad: '',
  estado: '',
  codigoPostal: '',
  referencia: '',
  instruccionesEntrega: '',
  requiereFactura: false,
};

export function EndCustomers() {
  const { token, user, hasActionPermission } = useAuth();
  const [endCustomers, setEndCustomers] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [filterClient, setFilterClient] = useState('');
  const [filterActivo, setFilterActivo] = useState<'ACTIVOS' | 'INACTIVOS' | 'TODOS'>('ACTIVOS');
  const [expanded, setExpanded] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState<EndCustomerForm>(DEFAULT_END_CUSTOMER_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [formMsg, setFormMsg] = useState({ type: '', text: '' });

  const [targetToDeactivate, setTargetToDeactivate] = useState<any | null>(null);
  const [targetToReactivate, setTargetToReactivate] = useState<any | null>(null);
  const [processingStateChange, setProcessingStateChange] = useState(false);
  const [actionError, setActionError] = useState('');

  const canCreate = hasActionPermission('clientes-finales', 'crear');
  const canEdit = hasActionPermission('clientes-finales', 'editar');
  const canDeactivate = hasActionPermission('clientes-finales', 'cancelar') || canEdit;

  const headers: any = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  useEffect(() => {
    if (!token) return;
    loadClients();
  }, [token]);

  useEffect(() => {
    if (!token) return;
    loadData();
  }, [token, filterClient, filterActivo]);

  async function loadData() {
    if (!token) return;
    setLoading(true);
    setLoadError('');
    try {
      const params = new URLSearchParams();
      if (filterClient) params.set('clienteId', filterClient);
      if (filterActivo === 'ACTIVOS') params.set('activo', 'true');
      else if (filterActivo === 'INACTIVOS') params.set('activo', 'false');
      else params.set('activo', 'all');

      const res = await fetch(`${API}/end-customers?${params.toString()}`, { headers });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setLoadError(err.message || `No se pudieron cargar clientes finales (HTTP ${res.status})`);
        setEndCustomers([]);
      } else {
        const data = await res.json();
        setEndCustomers(Array.isArray(data) ? data : []);
      }
    } catch (err: any) {
      setLoadError(err?.message || 'Error de conexión al cargar clientes finales.');
      setEndCustomers([]);
    }
    setLoading(false);
  }

  async function loadClients() {
    if (!token) return;
    try {
      const res = await fetch(`${API}/clients`, { headers });
      if (res.ok) {
        const data = await res.json();
        setClients(Array.isArray(data) ? data : []);
      }
    } catch {
      setClients([]);
    }
  }

  function handleOpenCreate() {
    setIsEditing(false);
    setForm({
      ...DEFAULT_END_CUSTOMER_FORM,
      clienteId: user?.clienteId || filterClient || '',
    });
    setFormMsg({ type: '', text: '' });
    setShowForm(true);
  }

  function handleOpenEdit(ec: any) {
    setIsEditing(true);
    setForm({
      id: ec.id,
      clienteId: ec.clienteId || '',
      codigo: ec.codigo || '',
      nombre: ec.nombre || '',
      razonSocial: ec.razonSocial || '',
      rfc: ec.rfc || '',
      contacto: ec.contacto || '',
      telefono: ec.telefono || '',
      email: ec.email || '',
      calle: ec.calle || '',
      colonia: ec.colonia || '',
      ciudad: ec.ciudad || '',
      estado: ec.estado || '',
      codigoPostal: ec.codigoPostal || '',
      referencia: ec.referencia || '',
      instruccionesEntrega: ec.instruccionesEntrega || '',
      requiereFactura: Boolean(ec.requiereFactura),
    });
    setFormMsg({ type: '', text: '' });
    setShowForm(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormMsg({ type: '', text: '' });
    if (!form.clienteId || !form.codigo.trim() || !form.nombre.trim()) {
      setFormMsg({ type: 'error', text: 'Depositante, código y nombre son obligatorios.' });
      return;
    }
    setSubmitting(true);
    try {
      const url = isEditing && form.id ? `${API}/end-customers/${form.id}` : `${API}/end-customers`;
      const method = isEditing ? 'PUT' : 'POST';
      const payload = { ...form };
      delete payload.id;

      const res = await fetch(url, { method, headers, body: JSON.stringify(payload) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || `Error al guardar (HTTP ${res.status})`);
      }

      setFormMsg({
        type: 'success',
        text: isEditing ? 'Cliente final actualizado correctamente.' : 'Cliente final registrado con éxito.',
      });
      await loadData();
      setTimeout(() => {
        setShowForm(false);
        setFormMsg({ type: '', text: '' });
      }, 900);
    } catch (err: any) {
      setFormMsg({ type: 'error', text: err.message });
    }
    setSubmitting(false);
  }

  async function handleConfirmDeactivate() {
    if (!targetToDeactivate) return;
    setProcessingStateChange(true);
    setActionError('');
    try {
      const res = await fetch(`${API}/end-customers/${targetToDeactivate.id}`, {
        method: 'DELETE',
        headers,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'No se pudo desactivar el destino.');
      setTargetToDeactivate(null);
      await loadData();
    } catch (err: any) {
      setActionError(err.message);
    }
    setProcessingStateChange(false);
  }

  async function handleConfirmReactivate() {
    if (!targetToReactivate) return;
    setProcessingStateChange(true);
    setActionError('');
    try {
      const res = await fetch(`${API}/end-customers/${targetToReactivate.id}/reactivate`, {
        method: 'PUT',
        headers,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'No se pudo reactivar el destino.');
      setTargetToReactivate(null);
      await loadData();
    } catch (err: any) {
      setActionError(err.message);
    }
    setProcessingStateChange(false);
  }

  const filtered = endCustomers.filter(ec =>
    !search ||
    ec.nombre?.toLowerCase().includes(search.toLowerCase()) ||
    ec.codigo?.toLowerCase().includes(search.toLowerCase()) ||
    ec.ciudad?.toLowerCase().includes(search.toLowerCase()) ||
    ec.rfc?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Clientes Finales (Ship-To)</h1>
          <p className="page-subtitle">{filtered.length} destinos de entrega listados</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {canCreate && (
            <button type="button" className="btn btn-primary" onClick={handleOpenCreate}>
              <Plus size={16} /> Nuevo Destino
            </button>
          )}
          <button type="button" className="btn btn-secondary" onClick={loadData}>
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Actualizar
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 12, padding: '16px 20px', flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="search-box" style={{ flex: 1, minWidth: 220 }}>
            <Search size={16} />
            <input
              placeholder="Buscar por nombre, código, RFC o ciudad..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          {!user?.clienteId && (
            <select
              className="form-select"
              value={filterClient}
              onChange={e => setFilterClient(e.target.value)}
              style={{ minWidth: 220 }}
            >
              <option value="">Todos los depositantes</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.nombreComercial}</option>)}
            </select>
          )}
          <select
            className="form-select"
            value={filterActivo}
            onChange={e => setFilterActivo(e.target.value as any)}
            style={{ minWidth: 160 }}
          >
            <option value="ACTIVOS">Solo Activos</option>
            <option value="INACTIVOS">Solo Inactivos</option>
            <option value="TODOS">Todos</option>
          </select>
        </div>
      </div>

      {loadError && (
        <div className="form-message form-error-msg" style={{ marginBottom: 16 }}>
          <AlertTriangle size={16} /> {loadError}
        </div>
      )}

      {/* Create / Edit Modal */}
      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 680 }}>
            <div className="modal-header">
              <h2><Store size={20} /> {isEditing ? 'Editar Cliente Final (Ship-To)' : 'Nuevo Cliente Final (Ship-To)'}</h2>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowForm(false)}><X size={18} /></button>
            </div>
            <form onSubmit={handleSubmit} className="modal-body">
              <div className="form-row">
                <div className="form-group" style={{ flex: 2 }}>
                  <label className="form-label">Depositante <span className="required">*</span></label>
                  <select
                    className="form-select form-select-full"
                    value={form.clienteId}
                    onChange={e => setForm(f => ({ ...f, clienteId: e.target.value }))}
                    disabled={isEditing || Boolean(user?.clienteId)}
                    required
                  >
                    <option value="">Seleccionar depositante...</option>
                    {clients.map(c => <option key={c.id} value={c.id}>{c.nombreComercial} ({c.giro})</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Código <span className="required">*</span></label>
                  <input
                    className="form-input"
                    placeholder="SUC-001"
                    value={form.codigo}
                    onChange={e => setForm(f => ({ ...f, codigo: e.target.value }))}
                    required
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group" style={{ flex: 2 }}>
                  <label className="form-label">Nombre Comercial / Sucursal <span className="required">*</span></label>
                  <input
                    className="form-input"
                    placeholder="Nombre del destino"
                    value={form.nombre}
                    onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">RFC</label>
                  <input
                    className="form-input"
                    placeholder="RFC"
                    value={form.rfc}
                    onChange={e => setForm(f => ({ ...f, rfc: e.target.value.toUpperCase() }))}
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group" style={{ flex: 2 }}>
                  <label className="form-label">Razón Social</label>
                  <input
                    className="form-input"
                    placeholder="Razón social para facturación"
                    value={form.razonSocial}
                    onChange={e => setForm(f => ({ ...f, razonSocial: e.target.value }))}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Contacto</label>
                  <input
                    className="form-input"
                    placeholder="Nombre del contacto"
                    value={form.contacto}
                    onChange={e => setForm(f => ({ ...f, contacto: e.target.value }))}
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Teléfono</label>
                  <input
                    className="form-input"
                    placeholder="55-1234-5678"
                    value={form.telefono}
                    onChange={e => setForm(f => ({ ...f, telefono: e.target.value }))}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Email</label>
                  <input
                    className="form-input"
                    type="email"
                    placeholder="recibo@destino.mx"
                    value={form.email}
                    onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  />
                </div>
              </div>
              <div style={{ margin: '12px 0 6px', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <MapPin size={13} color="var(--primary)" /> Dirección de Entrega
              </div>
              <div className="form-row">
                <div className="form-group" style={{ flex: 2 }}>
                  <label className="form-label">Calle</label>
                  <input className="form-input" placeholder="Calle y número" value={form.calle} onChange={e => setForm(f => ({ ...f, calle: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Colonia</label>
                  <input className="form-input" placeholder="Colonia" value={form.colonia} onChange={e => setForm(f => ({ ...f, colonia: e.target.value }))} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group"><label className="form-label">Ciudad</label><input className="form-input" placeholder="Ciudad" value={form.ciudad} onChange={e => setForm(f => ({ ...f, ciudad: e.target.value }))} /></div>
                <div className="form-group"><label className="form-label">Estado</label><input className="form-input" placeholder="Estado" value={form.estado} onChange={e => setForm(f => ({ ...f, estado: e.target.value }))} /></div>
                <div className="form-group"><label className="form-label">C.P.</label><input className="form-input" placeholder="06500" value={form.codigoPostal} onChange={e => setForm(f => ({ ...f, codigoPostal: e.target.value }))} /></div>
              </div>
              <div className="form-group">
                <label className="form-label">Referencia de Ubicación / Andén</label>
                <input
                  className="form-input"
                  placeholder="Ej. Entrar por puerta 4, andén norte"
                  value={form.referencia}
                  onChange={e => setForm(f => ({ ...f, referencia: e.target.value }))}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Instrucciones de Entrega</label>
                <textarea
                  className="form-input"
                  rows={2}
                  placeholder="Horario de recibo, cita o requisitos..."
                  value={form.instruccionesEntrega}
                  onChange={e => setForm(f => ({ ...f, instruccionesEntrega: e.target.value }))}
                />
              </div>
              <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  id="ec-req-factura"
                  type="checkbox"
                  checked={form.requiereFactura}
                  onChange={e => setForm(f => ({ ...f, requiereFactura: e.target.checked }))}
                />
                <label htmlFor="ec-req-factura" className="form-label" style={{ margin: 0 }}>Requiere factura</label>
              </div>
              {formMsg.text && (
                <div className={`form-message ${formMsg.type === 'error' ? 'form-error-msg' : 'form-success-msg'}`}>
                  {formMsg.text}
                </div>
              )}
              <div className="modal-footer">
                <button type="button" className="btn btn-ghost" onClick={() => setShowForm(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>
                  {submitting ? 'Guardando...' : isEditing ? 'Actualizar Destino' : 'Guardar Destino'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Confirmación Baja Lógica */}
      {targetToDeactivate && (
        <div className="modal-overlay" onClick={() => { setTargetToDeactivate(null); setActionError(''); }}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 440 }}>
            <div className="modal-header">
              <h2 style={{ color: '#DC2626' }}><AlertTriangle size={18} /> Desactivar Cliente Final</h2>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setTargetToDeactivate(null); setActionError(''); }}><X size={18} /></button>
            </div>
            <div className="modal-body">
              <p style={{ marginTop: 0, fontSize: 13.5, color: 'var(--text-secondary)' }}>
                ¿Confirmas desactivar el destino <strong>{targetToDeactivate.nombre}</strong> (<code>{targetToDeactivate.codigo}</code>)?
                El historial operativo y órdenes previas permanecerán intactos.
              </p>
              {actionError && <div className="form-message form-error-msg">{actionError}</div>}
              <div className="modal-footer">
                <button type="button" className="btn btn-ghost" onClick={() => { setTargetToDeactivate(null); setActionError(''); }}>Cancelar</button>
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ background: '#DC2626', borderColor: '#DC2626' }}
                  disabled={processingStateChange}
                  onClick={handleConfirmDeactivate}
                >
                  {processingStateChange ? 'Desactivando...' : 'Confirmar Desactivación'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal Confirmación Reactivación */}
      {targetToReactivate && (
        <div className="modal-overlay" onClick={() => { setTargetToReactivate(null); setActionError(''); }}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 440 }}>
            <div className="modal-header">
              <h2><RotateCcw size={18} /> Reactivar Cliente Final</h2>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setTargetToReactivate(null); setActionError(''); }}><X size={18} /></button>
            </div>
            <div className="modal-body">
              <p style={{ marginTop: 0, fontSize: 13.5, color: 'var(--text-secondary)' }}>
                ¿Deseas reactivar el destino <strong>{targetToReactivate.nombre}</strong> (<code>{targetToReactivate.codigo}</code>)?
              </p>
              {actionError && <div className="form-message form-error-msg">{actionError}</div>}
              <div className="modal-footer">
                <button type="button" className="btn btn-ghost" onClick={() => { setTargetToReactivate(null); setActionError(''); }}>Cancelar</button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={processingStateChange}
                  onClick={handleConfirmReactivate}
                >
                  {processingStateChange ? 'Reactivando...' : 'Confirmar Reactivación'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-secondary)' }}>
          <RefreshCw className="animate-spin" size={24} /> Cargando destinos...
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          {filtered.length === 0 && (
            <div className="card">
              <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-tertiary)' }}>
                <Store size={32} style={{ opacity: 0.35, marginBottom: 10 }} />
                <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--text-secondary)', marginBottom: 4 }}>
                  Sin destinos registrados
                </div>
                <div style={{ fontSize: 13 }}>
                  No existen clientes finales registrados que coincidan con el filtro actual.
                </div>
              </div>
            </div>
          )}

          {filtered.map((ec, i) => (
            <div
              key={ec.id}
              className="card animate-fade-in"
              style={{ animationDelay: `${i * 0.03}s`, opacity: ec.activo === false ? 0.72 : 1 }}
            >
              <div style={{ padding: '20px 24px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                    <div style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--primary-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary)' }}>
                      <Store size={20} />
                    </div>
                    <div>
                      <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{ec.nombre}</h3>
                      <div style={{ fontSize: 12, color: 'var(--text-tertiary)', fontFamily: 'monospace' }}>{ec.codigo}</div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                        {ec.cliente?.nombreComercial && <span className="badge badge-info">{ec.cliente.nombreComercial}</span>}
                        <span className={`badge ${ec.activo !== false ? 'badge-success' : 'badge-danger'}`}>
                          {ec.activo !== false ? 'Activo' : 'Inactivo'}
                        </span>
                        {ec.requiereFactura && <span className="badge badge-warning"><FileText size={10} /> Factura</span>}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <div style={{ textAlign: 'center', marginRight: 6 }}>
                      <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--primary)' }}>{ec._count?.ordenes || 0}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Pedidos</div>
                    </div>
                    {canEdit && (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => handleOpenEdit(ec)}
                        title="Editar destino"
                      >
                        <Edit3 size={14} /> Editar
                      </button>
                    )}
                    {canDeactivate && (ec.activo !== false ? (
                      <button
                        type="button"
                        className="btn btn-sm"
                        style={{ background: '#FEE2E2', color: '#DC2626', border: '1px solid #FECACA' }}
                        onClick={() => { setActionError(''); setTargetToDeactivate(ec); }}
                        title="Desactivar destino"
                      >
                        <Trash2 size={14} /> Desactivar
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-sm"
                        style={{ background: '#ECFDF5', color: '#059669', border: '1px solid #A7F3D0' }}
                        onClick={() => { setActionError(''); setTargetToReactivate(ec); }}
                        title="Reactivar destino"
                      >
                        <RotateCcw size={14} /> Reactivar
                      </button>
                    ))}
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setExpanded(expanded === ec.id ? null : ec.id)}
                    >
                      {expanded === ec.id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </button>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 20, marginTop: 10, flexWrap: 'wrap' }}>
                  {ec.contacto && <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, color: 'var(--text-secondary)' }}><Phone size={12} /> {ec.contacto}</span>}
                  {ec.telefono && <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, color: 'var(--text-secondary)' }}><Phone size={12} /> {ec.telefono}</span>}
                  {ec.email && <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, color: 'var(--text-secondary)' }}><Mail size={12} /> {ec.email}</span>}
                  {(ec.ciudad || ec.calle) && <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, color: 'var(--text-secondary)' }}><MapPin size={12} /> {ec.calle ? `${ec.calle}, ` : ''}{ec.ciudad}{ec.codigoPostal ? ` CP ${ec.codigoPostal}` : ''}</span>}
                </div>

                {expanded === ec.id && (
                  <div style={{ marginTop: 14, padding: 14, background: 'var(--bg-secondary)', borderRadius: 8 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                      <div>
                        <h4 style={{ margin: '0 0 6px', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                          <MapPin size={13} color="var(--primary)" /> Dirección Completa
                        </h4>
                        <div style={{ fontSize: 13 }}>
                          {ec.calle && <div>{ec.calle}</div>}
                          {ec.colonia && <div>Col. {ec.colonia}</div>}
                          <div>{[ec.ciudad, ec.estado, ec.codigoPostal].filter(Boolean).join(', ') || 'No especificada'}</div>
                          {ec.referencia && <div style={{ color: 'var(--text-tertiary)', marginTop: 4 }}>Ref: {ec.referencia}</div>}
                        </div>
                      </div>
                      <div>
                        <h4 style={{ margin: '0 0 6px', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                          <Truck size={13} color="var(--primary)" /> Instrucciones de Entrega
                        </h4>
                        <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                          {ec.instruccionesEntrega || 'Sin instrucciones especiales'}
                        </div>
                      </div>
                    </div>
                    {(ec.razonSocial || ec.rfc) && (
                      <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-tertiary)' }}>
                        {ec.razonSocial && `Razón Social: ${ec.razonSocial}`}
                        {ec.razonSocial && ec.rfc && ' · '}
                        {ec.rfc && `RFC: ${ec.rfc}`}
                      </div>
                    )}
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
