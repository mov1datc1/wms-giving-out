import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { API } from '../config/api';
import {
  Shield, Users, Key, Settings, Search, Plus, Edit3, Mail,
  CheckCircle, AlertTriangle, Save, RefreshCw, Wifi, Building2,
  Lock, UserCheck, X, Eye, EyeOff
} from 'lucide-react';
import { formatCalendarDate } from '../utils/dateUtils';

const tabs = ['Usuarios', 'Roles', 'Configuración', 'Correo SMTP'];

export function AdminPanel() {
  const { token, user: currentUser } = useAuth();
  const [activeTab, setActiveTab] = useState(0);
  const [search, setSearch] = useState('');

  // Real users state (P-04)
  const [usersList, setUsersList] = useState<any[]>([]);
  const [rolesList, setRolesList] = useState<any[]>([]);
  const [clientsList, setClientsList] = useState<any[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);

  // User modal create / edit
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<any | null>(null);
  const [userForm, setUserForm] = useState({
    nombre: '',
    email: '',
    password: '',
    rolId: '',
    clienteId: '',
    activo: true,
  });
  const [userFormSaving, setUserFormSaving] = useState(false);
  const [userFormError, setUserFormError] = useState('');

  // SMTP Config
  const [smtp, setSmtp] = useState({
    host: 'mail.movidatci.com',
    port: '465',
    user: 'wms@movidatci.com',
    pass: '',
    fromName: 'Giving Out WMS',
  });
  const [smtpLoading, setSmtpLoading] = useState(false);
  const [smtpSaving, setSmtpSaving] = useState(false);
  const [smtpTesting, setSmtpTesting] = useState(false);
  const [smtpMsg, setSmtpMsg] = useState({ type: '', text: '' });
  const [showPass, setShowPass] = useState(false);

  const headers: any = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  useEffect(() => {
    loadUsersAndRoles();
  }, []);

  useEffect(() => {
    if (activeTab === 3) loadSmtpConfig();
  }, [activeTab]);

  async function loadUsersAndRoles() {
    setLoadingUsers(true);
    try {
      const [usersRes, rolesRes, clientsRes] = await Promise.all([
        fetch(`${API}/admin/users`, { headers }),
        fetch(`${API}/admin/roles`, { headers }),
        fetch(`${API}/clients`, { headers }),
      ]);
      if (usersRes.ok) setUsersList(await usersRes.json());
      if (rolesRes.ok) setRolesList(await rolesRes.json());
      if (clientsRes.ok) setClientsList(await clientsRes.json());
    } catch (err) {
      console.error('Error al cargar usuarios:', err);
    } finally {
      setLoadingUsers(false);
    }
  }

  function handleOpenCreateUser() {
    setEditingUser(null);
    setUserForm({
      nombre: '',
      email: '',
      password: '',
      rolId: rolesList[0]?.id || '',
      clienteId: '',
      activo: true,
    });
    setUserFormError('');
    setUserModalOpen(true);
  }

  function handleOpenEditUser(u: any) {
    setEditingUser(u);
    setUserForm({
      nombre: u.nombre || '',
      email: u.email || '',
      password: '',
      rolId: u.rolId || u.rolObj?.id || '',
      clienteId: u.clienteId || '',
      activo: u.activo ?? true,
    });
    setUserFormError('');
    setUserModalOpen(true);
  }

  async function handleSaveUser(e: React.FormEvent) {
    e.preventDefault();
    if (!userForm.nombre || !userForm.email) {
      setUserFormError('Nombre y email son obligatorios');
      return;
    }
    if (!editingUser && !userForm.password) {
      setUserFormError('La contraseña es requerida para nuevos usuarios');
      return;
    }

    setUserFormSaving(true);
    setUserFormError('');
    try {
      const payload: any = {
        nombre: userForm.nombre,
        email: userForm.email,
        rolId: userForm.rolId || undefined,
        clienteId: userForm.clienteId || null,
        activo: userForm.activo,
      };
      if (userForm.password) payload.password = userForm.password;

      let res: Response;
      if (editingUser) {
        res = await fetch(`${API}/admin/users/${editingUser.id}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify(payload),
        });
      } else {
        res = await fetch(`${API}/admin/users`, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
        });
      }

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.message || 'Error al guardar usuario');
      }

      setUserModalOpen(false);
      loadUsersAndRoles();
    } catch (err: any) {
      setUserFormError(err.message || 'Error al procesar solicitud');
    } finally {
      setUserFormSaving(false);
    }
  }

  async function handleToggleUserStatus(u: any) {
    try {
      await fetch(`${API}/admin/users/${u.id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ activo: !u.activo }),
      });
      loadUsersAndRoles();
    } catch (err) {
      console.error('Error al cambiar estatus:', err);
    }
  }

  async function loadSmtpConfig() {
    setSmtpLoading(true);
    try {
      const res = await fetch(`${API}/settings?category=email`, { headers });
      if (res.ok) {
        const settings = await res.json();
        const cfg: Record<string, string> = {};
        settings.forEach((s: any) => { cfg[s.key] = s.value; });
        setSmtp({
          host: cfg['email.smtp_host'] || 'mail.movidatci.com',
          port: cfg['email.smtp_port'] || '465',
          user: cfg['email.smtp_user'] || 'wms@movidatci.com',
          pass: cfg['email.smtp_pass'] || '',
          fromName: cfg['email.from_name'] || 'Giving Out WMS',
        });
      }
    } catch (err) { console.error(err); }
    setSmtpLoading(false);
  }

  async function saveSmtpConfig() {
    setSmtpSaving(true);
    setSmtpMsg({ type: '', text: '' });
    try {
      const res = await fetch(`${API}/settings`, {
        method: 'PUT', headers,
        body: JSON.stringify({
          settings: [
            { key: 'email.smtp_host', value: smtp.host, category: 'email', label: 'Servidor SMTP' },
            { key: 'email.smtp_port', value: smtp.port, category: 'email', label: 'Puerto SMTP' },
            { key: 'email.smtp_user', value: smtp.user, category: 'email', label: 'Usuario SMTP' },
            { key: 'email.smtp_pass', value: smtp.pass, category: 'email', label: 'Contraseña SMTP' },
            { key: 'email.from_name', value: smtp.fromName, category: 'email', label: 'Nombre remitente' },
          ],
        }),
      });
      if (res.ok) {
        setSmtpMsg({ type: 'success', text: 'Configuración SMTP guardada correctamente' });
      }
    } catch (err: any) { setSmtpMsg({ type: 'error', text: err.message }); }
    setSmtpSaving(false);
  }

  async function testSmtp() {
    setSmtpTesting(true);
    setSmtpMsg({ type: '', text: '' });
    try {
      await saveSmtpConfig();
      const res = await fetch(`${API}/settings/test-email`, { method: 'POST', headers });
      const result = await res.json();
      setSmtpMsg({
        type: result.success ? 'success' : 'error',
        text: result.success ? 'Conexión SMTP exitosa — el correo está listo para enviar notificaciones' : `Error: ${result.message}`
      });
    } catch (err: any) { setSmtpMsg({ type: 'error', text: err.message }); }
    setSmtpTesting(false);
  }

  const filteredUsers = usersList.filter(u => {
    const q = search.toLowerCase().trim();
    if (!q) return true;
    return (
      u.nombre?.toLowerCase().includes(q) ||
      u.email?.toLowerCase().includes(q) ||
      u.rol?.toLowerCase().includes(q) ||
      u.cliente?.nombreComercial?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Panel de Administración</h1>
          <p className="page-subtitle">Gestión de usuarios, permisos RBAC, multi-tenant y configuración general</p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', padding: '0 4px' }}>
          {tabs.map((tab, i) => (
            <button key={i} onClick={() => { setActiveTab(i); setSearch(''); }}
              style={{
                padding: '12px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                border: 'none', background: 'none', color: activeTab === i ? 'var(--accent-primary)' : 'var(--text-secondary)',
                borderBottom: activeTab === i ? '2px solid var(--accent-primary)' : '2px solid transparent',
                transition: 'all 0.15s', display: 'flex', alignItems: 'center', gap: 6,
              }}>
              {i === 0 && <Users size={14} />}
              {i === 1 && <Key size={14} />}
              {i === 2 && <Settings size={14} />}
              {i === 3 && <Mail size={14} />}
              {tab}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 0 && (
        <div className="card">
          <div style={{ padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)' }}>
            <div>
              <span style={{ fontWeight: 700, fontSize: 14 }}>Usuarios del Sistema y Portales ({filteredUsers.length})</span>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--text-secondary)' }}>
                Gestión unificada de personal de Giving Out y cuentas de depositantes
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <div className="search-box">
                <Search size={14} />
                <input placeholder="Buscar por nombre, email o depositante..." value={search} onChange={e => setSearch(e.target.value)} />
              </div>
              <button className="btn btn-secondary btn-sm" onClick={loadUsersAndRoles}>
                <RefreshCw size={14} />
              </button>
              <button className="btn btn-primary btn-sm" onClick={handleOpenCreateUser}>
                <Plus size={14} /> Nuevo Usuario
              </button>
            </div>
          </div>

          <div style={{ overflowX: 'auto' }}>
            {loadingUsers ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>
                <RefreshCw className="animate-spin" size={20} /> Cargando catálogo de usuarios...
              </div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Nombre</th>
                    <th>Email</th>
                    <th>Rol Asignado</th>
                    <th>Alcance / Depositante</th>
                    <th>Estado</th>
                    <th>Registrado</th>
                    <th style={{ textAlign: 'right' }}>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map(u => {
                    const isClientUser = Boolean(u.clienteId || u.cliente);
                    return (
                      <tr key={u.id}>
                        <td style={{ fontWeight: 600 }}>{u.nombre}</td>
                        <td style={{ color: 'var(--accent-primary)', fontFamily: 'monospace', fontSize: 12 }}>{u.email}</td>
                        <td>
                          <span className={`badge ${isClientUser ? 'badge-info' : 'badge-default'}`}>
                            {u.rol}
                          </span>
                        </td>
                        <td>
                          {isClientUser ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--accent-primary)', fontWeight: 600 }}>
                              <Building2 size={13} />
                              {u.cliente?.nombreComercial || 'Depositante'}
                              <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>({u.cliente?.codigo || 'PORTAL'})</span>
                            </span>
                          ) : (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text-secondary)' }}>
                              <Shield size={13} color="var(--primary)" />
                              Giving Out Central (3PL)
                            </span>
                          )}
                        </td>
                        <td>
                          <button
                            type="button"
                            onClick={() => handleToggleUserStatus(u)}
                            className={`badge ${u.activo ? 'badge-success' : 'badge-danger'}`}
                            style={{ cursor: 'pointer', border: 'none' }}
                            title="Haz clic para activar o desactivar este usuario"
                          >
                            {u.activo ? 'Activo' : 'Inactivo'}
                          </button>
                        </td>
                        <td style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                          {formatCalendarDate(u.createdAt)}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => handleOpenEditUser(u)}
                            title="Editar usuario y depositante"
                          >
                            <Edit3 size={14} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredUsers.length === 0 && (
                    <tr>
                      <td colSpan={7} style={{ textAlign: 'center', padding: 30, color: 'var(--text-tertiary)' }}>
                        No se encontraron usuarios coincidentes.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {activeTab === 1 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {rolesList.map(role => (
            <div key={role.id} className="card" style={{ padding: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--bg-secondary)', color: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Shield size={16} />
                  </div>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>{role.nombre}</span>
                </div>
                <span className="badge badge-default">Nivel {role.nivel}</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
                {role.descripcion || 'Permisos según matriz RBAC configurada'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                {usersList.filter(u => u.rolId === role.id || u.rolObj?.id === role.id).length} usuario(s) asignado(s)
              </div>
            </div>
          ))}
        </div>
      )}

      {activeTab === 2 && (
        <div className="card">
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', fontWeight: 700 }}>Configuración de Plataforma</div>
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead><tr><th>Clave</th><th>Valor</th><th>Descripción</th></tr></thead>
              <tbody>
                <tr><td><code>app.name</code></td><td>Giving Out WMS</td><td>Nombre del sistema 3PL</td></tr>
                <tr><td><code>auth.session_hours</code></td><td>24</td><td>Duración de tokens JWT</td></tr>
                <tr><td><code>fefo.threshold_days</code></td><td>365</td><td>Umbral de rotación en días para niveles accesibles</td></tr>
                <tr><td><code>labels.default_format</code></td><td>100x50mm</td><td>Medida estándar de etiquetas térmicas</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 3 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 20 }}>
          <div className="card" style={{ padding: 24 }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Configuración de Servidor SMTP</div>
            <div className="form-grid">
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Host SMTP</label>
                  <input className="form-input" value={smtp.host} onChange={e => setSmtp(s => ({ ...s, host: e.target.value }))} placeholder="mail.movidatci.com" />
                </div>
                <div className="form-group">
                  <label className="form-label">Puerto</label>
                  <select className="form-select form-select-full" value={smtp.port} onChange={e => setSmtp(s => ({ ...s, port: e.target.value }))}>
                    <option value="465">465 (SSL)</option>
                    <option value="587">587 (TLS)</option>
                    <option value="25">25 (Sin cifrar)</option>
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Correo / Usuario</label>
                  <input className="form-input" type="email" value={smtp.user} onChange={e => setSmtp(s => ({ ...s, user: e.target.value }))} placeholder="wms@movidatci.com" />
                </div>
                <div className="form-group">
                  <label className="form-label">Contraseña</label>
                  <div style={{ position: 'relative' }}>
                    <input className="form-input" type={showPass ? 'text' : 'password'} value={smtp.pass}
                      onChange={e => setSmtp(s => ({ ...s, pass: e.target.value }))} placeholder="••••••••" style={{ paddingRight: 60 }} />
                    <button type="button" onClick={() => setShowPass(!showPass)}
                      style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', fontSize: 11, color: 'var(--accent-primary)', cursor: 'pointer', fontWeight: 600 }}>
                      {showPass ? 'Ocultar' : 'Mostrar'}
                    </button>
                  </div>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Nombre del remitente</label>
                <input className="form-input" value={smtp.fromName} onChange={e => setSmtp(s => ({ ...s, fromName: e.target.value }))} placeholder="Giving Out WMS" />
              </div>

              {smtpMsg.text && (
                <div className={`form-message ${smtpMsg.type === 'error' ? 'form-error-msg' : 'form-success-msg'}`} style={{ marginTop: 12 }}>
                  {smtpMsg.text}
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                <button className="btn btn-primary" onClick={saveSmtpConfig} disabled={smtpSaving}>
                  {smtpSaving ? 'Guardando...' : <><Save size={14} /> Guardar Configuración</>}
                </button>
                <button className="btn btn-secondary" onClick={testSmtp} disabled={smtpTesting}>
                  {smtpTesting ? <><RefreshCw size={14} className="animate-spin" /> Probando...</> : <><Wifi size={14} /> Probar Conexión</>}
                </button>
              </div>
            </div>
          </div>

          <div className="card" style={{ padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Información del Servicio</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              <p style={{ margin: '0 0 8px' }}>El sistema envía correos automáticamente ante alertas críticas, asignación de tareas operativas y confirmación de despachos.</p>
              <div style={{ padding: '10px 12px', background: 'var(--bg-secondary)', borderRadius: 8, fontSize: 12 }}>
                <strong>Protocolo:</strong> SMTP sobre SSL (465) / TLS (587)<br/>
                <strong>Servidor:</strong> mail.movidatci.com<br/>
                <strong>Remitente:</strong> wms@movidatci.com
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== MODAL DE CREACIÓN / EDICIÓN DE USUARIO (P-04) ===== */}
      {userModalOpen && (
        <div className="modal-overlay" onClick={() => setUserModalOpen(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 520 }}>
            <div className="modal-header">
              <h2>
                <UserCheck size={18} color="var(--primary)" />
                {editingUser ? `Editar Usuario — ${editingUser.nombre}` : 'Nuevo Usuario del Sistema'}
              </h2>
              <button className="btn btn-ghost btn-sm" onClick={() => setUserModalOpen(false)}>
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSaveUser}>
              <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                {userFormError && (
                  <div style={{ padding: '8px 12px', background: '#FEE2E2', border: '1px solid #FCA5A5', color: '#991B1B', borderRadius: 6, fontSize: 12 }}>
                    {userFormError}
                  </div>
                )}

                <div className="form-group">
                  <label className="form-label">Nombre Completo</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Ej. Pedro Ramírez"
                    value={userForm.nombre}
                    onChange={e => setUserForm(f => ({ ...f, nombre: e.target.value }))}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Correo Electrónico (Login)</label>
                  <input
                    type="email"
                    className="form-input"
                    placeholder="ejemplo@empresa.com"
                    value={userForm.email}
                    onChange={e => setUserForm(f => ({ ...f, email: e.target.value }))}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">
                    Contraseña {editingUser && <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-tertiary)' }}>(dejar en blanco para no cambiar)</span>}
                  </label>
                  <input
                    type="password"
                    className="form-input"
                    placeholder={editingUser ? '••••••••' : 'Contraseña segura'}
                    value={userForm.password}
                    onChange={e => setUserForm(f => ({ ...f, password: e.target.value }))}
                    required={!editingUser}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Rol Operativo</label>
                  <select
                    className="form-select form-select-full"
                    value={userForm.rolId}
                    onChange={e => setUserForm(f => ({ ...f, rolId: e.target.value }))}
                  >
                    <option value="">Seleccionar rol...</option>
                    {rolesList.map(r => (
                      <option key={r.id} value={r.id}>
                        {r.nombre} (Nivel {r.nivel})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">
                    Depositante Vinculado <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-tertiary)' }}>(Obligatorio para cuentas del Portal Depositante)</span>
                  </label>
                  <select
                    className="form-select form-select-full"
                    value={userForm.clienteId}
                    onChange={e => setUserForm(f => ({ ...f, clienteId: e.target.value }))}
                  >
                    <option value="">Ninguno — Usuario Interno de Giving Out 3PL</option>
                    {clientsList.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.nombreComercial} ({c.codigo})
                      </option>
                    ))}
                  </select>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                  <input
                    type="checkbox"
                    id="userActivoCheck"
                    checked={userForm.activo}
                    onChange={e => setUserForm(f => ({ ...f, activo: e.target.checked }))}
                  />
                  <label htmlFor="userActivoCheck" style={{ fontSize: 12, fontWeight: 600, cursor: 'pointer', margin: 0 }}>
                    Usuario Activo (permite iniciar sesión)
                  </label>
                </div>
              </div>

              <div className="modal-footer" style={{ borderTop: '1px solid var(--border)' }}>
                <button type="button" className="btn btn-ghost" onClick={() => setUserModalOpen(false)}>
                  Cancelar
                </button>
                <button type="submit" className="btn btn-primary" disabled={userFormSaving}>
                  {userFormSaving ? 'Guardando...' : (editingUser ? 'Actualizar Usuario' : 'Crear Usuario')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
