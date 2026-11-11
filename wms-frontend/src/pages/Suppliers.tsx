import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { API } from '../config/api';
import {
  Building, Search, RefreshCw, Phone, Mail, User, MapPin,
  Plus, X, Edit3, Trash2, RotateCcw, AlertTriangle
} from 'lucide-react';

interface SupplierForm {
  id?: string;
  codigo: string;
  nombre: string;
  rfc: string;
  telefono: string;
  email: string;
  contacto: string;
  direccion: string;
}

const DEFAULT_SUPPLIER_FORM: SupplierForm = {
  codigo: '',
  nombre: '',
  rfc: '',
  telefono: '',
  email: '',
  contacto: '',
  direccion: '',
};

export function Suppliers() {
  const { token, hasActionPermission } = useAuth();
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [filterActivo, setFilterActivo] = useState<'ACTIVOS' | 'INACTIVOS' | 'TODOS'>('ACTIVOS');

  const [showForm, setShowForm] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState<SupplierForm>(DEFAULT_SUPPLIER_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [formMsg, setFormMsg] = useState({ type: '', text: '' });

  const [targetToDeactivate, setTargetToDeactivate] = useState<any | null>(null);
  const [targetToReactivate, setTargetToReactivate] = useState<any | null>(null);
  const [processingStateChange, setProcessingStateChange] = useState(false);
  const [actionError, setActionError] = useState('');

  const canCreate = hasActionPermission('proveedores', 'crear') || hasActionPermission('maestros', 'crear');
  const canEdit = hasActionPermission('proveedores', 'editar') || hasActionPermission('maestros', 'editar');
  const canDeactivate =
    hasActionPermission('proveedores', 'cancelar') ||
    hasActionPermission('maestros', 'cancelar') ||
    canEdit;

  const headers: any = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  useEffect(() => {
    if (!token) return;
    loadData();
  }, [token, filterActivo]);

  async function loadData() {
    if (!token) return;
    setLoading(true);
    setLoadError('');
    try {
      const params = new URLSearchParams();
      if (filterActivo === 'ACTIVOS') params.set('activo', 'true');
      else if (filterActivo === 'INACTIVOS') params.set('activo', 'false');
      else params.set('activo', 'all');

      const res = await fetch(`${API}/suppliers?${params.toString()}`, { headers });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setLoadError(err.message || `No se pudieron cargar proveedores (HTTP ${res.status})`);
        setSuppliers([]);
      } else {
        const data = await res.json();
        setSuppliers(Array.isArray(data) ? data : []);
      }
    } catch (err: any) {
      setLoadError(err?.message || 'Error de conexión al cargar proveedores.');
      setSuppliers([]);
    }
    setLoading(false);
  }

  function handleOpenCreate() {
    setIsEditing(false);
    setForm(DEFAULT_SUPPLIER_FORM);
    setFormMsg({ type: '', text: '' });
    setShowForm(true);
  }

  function handleOpenEdit(s: any) {
    setIsEditing(true);
    setForm({
      id: s.id,
      codigo: s.codigo || '',
      nombre: s.nombre || '',
      rfc: s.rfc || '',
      telefono: s.telefono || '',
      email: s.email || '',
      contacto: s.contacto || '',
      direccion: s.direccion || '',
    });
    setFormMsg({ type: '', text: '' });
    setShowForm(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormMsg({ type: '', text: '' });
    if (!form.nombre.trim() || !form.codigo.trim()) {
      setFormMsg({ type: 'error', text: 'Nombre y código son obligatorios.' });
      return;
    }
    setSubmitting(true);
    try {
      const url = isEditing && form.id ? `${API}/suppliers/${form.id}` : `${API}/suppliers`;
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
        text: isEditing ? 'Proveedor actualizado exitosamente.' : 'Proveedor creado exitosamente.',
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
      const res = await fetch(`${API}/suppliers/${targetToDeactivate.id}`, {
        method: 'DELETE',
        headers,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'No se pudo desactivar el proveedor.');
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
      const res = await fetch(`${API}/suppliers/${targetToReactivate.id}/reactivate`, {
        method: 'PUT',
        headers,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'No se pudo reactivar el proveedor.');
      setTargetToReactivate(null);
      await loadData();
    } catch (err: any) {
      setActionError(err.message);
    }
    setProcessingStateChange(false);
  }

  const filtered = suppliers.filter(s =>
    !search ||
    s.nombre?.toLowerCase().includes(search.toLowerCase()) ||
    s.codigo?.toLowerCase().includes(search.toLowerCase()) ||
    s.rfc?.toLowerCase().includes(search.toLowerCase()) ||
    s.contacto?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Proveedores</h1>
          <p className="page-subtitle">{filtered.length} proveedores listados</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {canCreate && (
            <button type="button" className="btn btn-primary" onClick={handleOpenCreate}>
              <Plus size={16} /> Nuevo Proveedor
            </button>
          )}
          <button type="button" className="btn btn-secondary" onClick={loadData}>
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Actualizar
          </button>
        </div>
      </div>

      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 580 }}>
            <div className="modal-header">
              <h2><Building size={20} /> {isEditing ? 'Editar Proveedor' : 'Nuevo Proveedor'}</h2>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowForm(false)}><X size={18} /></button>
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
                  <input className="form-input" placeholder="RFC del proveedor" value={form.rfc} onChange={e => setForm(f => ({ ...f, rfc: e.target.value.toUpperCase() }))} />
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
              <div className="form-group">
                <label className="form-label">Dirección</label>
                <input
                  className="form-input"
                  placeholder="Calle, número, colonia, ciudad"
                  value={form.direccion}
                  onChange={e => setForm(f => ({ ...f, direccion: e.target.value }))}
                />
              </div>
              {formMsg.text && <div className={`form-message ${formMsg.type === 'error' ? 'form-error-msg' : 'form-success-msg'}`}>{formMsg.text}</div>}
              <div className="modal-footer">
                <button type="button" className="btn btn-ghost" onClick={() => setShowForm(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>
                  {submitting ? 'Guardando...' : isEditing ? 'Actualizar Proveedor' : 'Guardar Proveedor'}
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
              <h2 style={{ color: '#DC2626' }}><AlertTriangle size={18} /> Desactivar Proveedor</h2>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setTargetToDeactivate(null); setActionError(''); }}><X size={18} /></button>
            </div>
            <div className="modal-body">
              <p style={{ marginTop: 0, fontSize: 13.5, color: 'var(--text-secondary)' }}>
                ¿Confirmas desactivar al proveedor <strong>{targetToDeactivate.nombre}</strong> (<code>{targetToDeactivate.codigo}</code>)?
                Las recepciones históricas se mantendrán intactas.
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
              <h2><RotateCcw size={18} /> Reactivar Proveedor</h2>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setTargetToReactivate(null); setActionError(''); }}><X size={18} /></button>
            </div>
            <div className="modal-body">
              <p style={{ marginTop: 0, fontSize: 13.5, color: 'var(--text-secondary)' }}>
                ¿Deseas reactivar al proveedor <strong>{targetToReactivate.nombre}</strong> (<code>{targetToReactivate.codigo}</code>)?
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

      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 12, padding: '16px 20px', flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="search-box" style={{ flex: 1, minWidth: 220 }}>
            <Search size={16} />
            <input placeholder="Buscar por nombre, código, RFC o contacto..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
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

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-secondary)' }}>
          <RefreshCw className="animate-spin" size={24} /> Cargando proveedores...
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          {filtered.map((s, i) => (
            <div
              key={s.id}
              className="card animate-fade-in"
              style={{ animationDelay: `${i * 0.04}s`, opacity: s.activo === false ? 0.72 : 1 }}
            >
              <div style={{ padding: '20px 24px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                    <div style={{ width: 48, height: 48, borderRadius: 12, background: 'rgba(99,102,241,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--purple)' }}>
                      <Building size={22} />
                    </div>
                    <div>
                      <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{s.nombre}</h3>
                      <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                        <code style={{ fontSize: 11, background: 'var(--bg-secondary)', padding: '1px 6px', borderRadius: 4 }}>{s.codigo}</code>
                        {s.rfc && <span style={{ fontSize: 12, color: 'var(--text-tertiary)', fontFamily: 'monospace' }}>{s.rfc}</span>}
                        <span className={`badge ${s.activo !== false ? 'badge-success' : 'badge-danger'}`}>
                          {s.activo !== false ? 'Activo' : 'Inactivo'}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    {typeof s._count?.recepciones === 'number' && (
                      <div style={{ textAlign: 'center', marginRight: 6 }}>
                        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--primary)' }}>{s._count.recepciones}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Recep.</div>
                      </div>
                    )}
                    {canEdit && (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => handleOpenEdit(s)}
                        title="Editar proveedor"
                      >
                        <Edit3 size={14} /> Editar
                      </button>
                    )}
                    {canDeactivate && (s.activo !== false ? (
                      <button
                        type="button"
                        className="btn btn-sm"
                        style={{ background: '#FEE2E2', color: '#DC2626', border: '1px solid #FECACA' }}
                        onClick={() => { setActionError(''); setTargetToDeactivate(s); }}
                        title="Desactivar proveedor"
                      >
                        <Trash2 size={14} /> Desactivar
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-sm"
                        style={{ background: '#ECFDF5', color: '#059669', border: '1px solid #A7F3D0' }}
                        onClick={() => { setActionError(''); setTargetToReactivate(s); }}
                        title="Reactivar proveedor"
                      >
                        <RotateCcw size={14} /> Reactivar
                      </button>
                    ))}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 24, marginTop: 12, flexWrap: 'wrap' }}>
                  {s.telefono && <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, color: 'var(--text-secondary)' }}><Phone size={13} />{s.telefono}</span>}
                  {s.email && <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, color: 'var(--text-secondary)' }}><Mail size={13} />{s.email}</span>}
                  {s.contacto && <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, color: 'var(--text-secondary)' }}><User size={13} />{s.contacto}</span>}
                  {s.direccion && <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, color: 'var(--text-secondary)' }}><MapPin size={13} />{s.direccion}</span>}
                </div>
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="card">
              <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-tertiary)' }}>
                <Building size={32} style={{ opacity: 0.35, marginBottom: 10 }} />
                <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--text-secondary)', marginBottom: 4 }}>
                  Sin proveedores registrados
                </div>
                <div style={{ fontSize: 13 }}>
                  No existen proveedores registrados para el criterio seleccionado.
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
