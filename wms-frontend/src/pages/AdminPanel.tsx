import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { API } from '../config/api';
import {
  Shield, Users, Key, Settings, Search, Plus, Edit, Mail,
  CheckCircle, AlertTriangle, Save, RefreshCw, Wifi
} from 'lucide-react';

const tabs = ['Usuarios', 'Roles', 'Configuración', 'Correo SMTP'];

const mockUsers = [
  { id: 'U-001', nombre: 'Jonathan Palacios', email: 'jonathan@givingout.mx', rol: 'Super Admin', activo: true, ultimo: '2026-04-09 18:30' },
  { id: 'U-002', nombre: 'Carlos López', email: 'carlos@givingout.mx', rol: 'Operador Recepción', activo: true, ultimo: '2026-04-09 16:45' },
  { id: 'U-003', nombre: 'María García', email: 'maria@givingout.mx', rol: 'Operador Picking', activo: true, ultimo: '2026-04-09 17:00' },
  { id: 'U-004', nombre: 'Ana Torres', email: 'ana@givingout.mx', rol: 'ATC / Comercial', activo: true, ultimo: '2026-04-08 12:00' },
  { id: 'U-005', nombre: 'Roberto Sánchez', email: 'roberto@givingout.mx', rol: 'Gerente Operaciones', activo: false, ultimo: '2026-03-15 09:00' },
];

const mockRoles = [
  { id: 'R-01', nombre: 'Super Admin', usuarios: 1, permisos: 'Todos', color: 'danger' },
  { id: 'R-02', nombre: 'Dirección', usuarios: 0, permisos: 'Dashboard, KPIs, Auditoría', color: 'purple' },
  { id: 'R-03', nombre: 'Gerente Operaciones', usuarios: 1, permisos: 'Recepción, Inventario, Picking, Embarque', color: 'teal' },
  { id: 'R-04', nombre: 'Supervisor Almacén', usuarios: 0, permisos: 'Tareas, Discrepancias, Movimientos', color: 'info' },
  { id: 'R-05', nombre: 'Operador Recepción', usuarios: 1, permisos: 'Recepción, Escaneo, Etiquetado', color: 'success' },
  { id: 'R-06', nombre: 'Operador Picking', usuarios: 1, permisos: 'Surtido, Empaque, Staging', color: 'warning' },
  { id: 'R-07', nombre: 'ATC / Comercial', usuarios: 1, permisos: 'Stock, Cotización, HOLD, Pedidos', color: 'purple' },
  { id: 'R-08', nombre: 'Administración', usuarios: 0, permisos: 'Facturación, UUID, Conciliación', color: 'info' },
  { id: 'R-09', nombre: 'Compras', usuarios: 0, permisos: 'Stock neto, Sugeridos, OC', color: 'teal' },
  { id: 'R-10', nombre: 'Cliente Portal', usuarios: 0, permisos: 'Su inventario, Pedidos, Reportes', color: 'success' },
];

const mockConfig = [
  { key: 'app.name', value: 'Giving Out WMS', desc: 'Nombre de la plataforma' },
  { key: 'auth.otp_enabled', value: 'true', desc: 'Habilitar autenticación OTP' },
  { key: 'auth.session_hours', value: '24', desc: 'Duración de sesión (horas)' },
  { key: 'inventory.auto_putaway', value: 'true', desc: 'Putaway automático al recibir' },
  { key: 'alerts.stock_min', value: '10', desc: 'Alerta cuando stock sea menor a' },
  { key: 'labels.default_format', value: '4x2in', desc: 'Formato de etiqueta por defecto' },
];

export function AdminPanel() {
  const { token } = useAuth();
  const [activeTab, setActiveTab] = useState(0);
  const [search, setSearch] = useState('');

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
    if (activeTab === 3) loadSmtpConfig();
  }, [activeTab]);

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
        setSmtpMsg({ type: 'success', text: '✅ Configuración SMTP guardada correctamente' });
      }
    } catch (err: any) { setSmtpMsg({ type: 'error', text: err.message }); }
    setSmtpSaving(false);
  }

  async function testSmtp() {
    setSmtpTesting(true);
    setSmtpMsg({ type: '', text: '' });
    try {
      // Save first, then test
      await saveSmtpConfig();
      const res = await fetch(`${API}/settings/test-email`, { method: 'POST', headers });
      const result = await res.json();
      setSmtpMsg({ type: result.success ? 'success' : 'error', text: result.success ? '✅ Conexión SMTP exitosa — el correo está listo para enviar notificaciones' : `❌ Error: ${result.message}` });
    } catch (err: any) { setSmtpMsg({ type: 'error', text: `❌ ${err.message}` }); }
    setSmtpTesting(false);
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Administración</h1>
          <p className="page-subtitle">Usuarios, roles, permisos y configuración del sistema</p>
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
            <span style={{ fontWeight: 700 }}>Usuarios del Sistema</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <div className="search-box"><Search size={14} /><input placeholder="Buscar..." value={search} onChange={e => setSearch(e.target.value)} /></div>
              <button className="btn btn-primary btn-sm"><Plus size={14} /> Nuevo</button>
            </div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead><tr><th>Nombre</th><th>Email</th><th>Rol</th><th>Estado</th><th>Último Acceso</th><th></th></tr></thead>
              <tbody>
                {mockUsers.filter(u => !search || u.nombre.toLowerCase().includes(search.toLowerCase())).map(u => (
                  <tr key={u.id}>
                    <td style={{ fontWeight: 600 }}>{u.nombre}</td>
                    <td style={{ color: 'var(--accent-primary)' }}>{u.email}</td>
                    <td><span className="badge badge-info">{u.rol}</span></td>
                    <td><span className={`badge ${u.activo ? 'badge-success' : 'badge-default'}`}>{u.activo ? 'Activo' : 'Inactivo'}</span></td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{u.ultimo}</td>
                    <td><button className="btn btn-ghost btn-sm"><Edit size={14} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 1 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {mockRoles.map(role => (
            <div key={role.id} className="card" style={{ padding: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: `var(--${role.color}-soft, var(--bg-secondary))`, color: `var(--${role.color}, var(--text-primary))`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Shield size={16} />
                  </div>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>{role.nombre}</span>
                </div>
                <button className="btn btn-ghost btn-sm"><Edit size={12} /></button>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>{role.permisos}</div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{role.usuarios} usuario{role.usuarios !== 1 ? 's' : ''}</div>
            </div>
          ))}
        </div>
      )}

      {activeTab === 2 && (
        <div className="card">
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', fontWeight: 700 }}>Configuración de Plataforma</div>
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead><tr><th>Clave</th><th>Valor</th><th>Descripción</th><th></th></tr></thead>
              <tbody>
                {mockConfig.map(c => (
                  <tr key={c.key}>
                    <td><code style={{ fontSize: 12, background: 'var(--bg-secondary)', padding: '2px 6px', borderRadius: 4 }}>{c.key}</code></td>
                    <td style={{ fontWeight: 600 }}>{c.value}</td>
                    <td style={{ color: 'var(--text-muted)', fontSize: 13 }}>{c.desc}</td>
                    <td><button className="btn btn-ghost btn-sm"><Edit size={14} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SMTP EMAIL CONFIG */}
      {activeTab === 3 && (
        <div style={{ maxWidth: 700 }}>
          <div className="card" style={{ marginBottom: 20 }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>📧 Configuración SMTP</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Credenciales para envío de correos de notificación</div>
              </div>
              {smtpLoading && <RefreshCw size={16} className="animate-spin" style={{ color: 'var(--text-muted)' }} />}
            </div>
            <div style={{ padding: 20 }}>
              <div className="form-row">
                <div className="form-group" style={{ flex: 2 }}>
                  <label className="form-label">Servidor SMTP (salida)</label>
                  <input className="form-input" value={smtp.host} onChange={e => setSmtp(s => ({ ...s, host: e.target.value }))} placeholder="mail.movidatci.com" />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
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

          {/* Info card */}
          <div className="card" style={{ padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>ℹ️ Información</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              <p style={{ margin: '0 0 8px' }}>El sistema envía correos automáticamente cuando se programa una tarea desde el módulo de alertas.</p>
              <p style={{ margin: '0 0 8px' }}>Los correos se envían a la dirección del responsable asignado con el detalle de la tarea, prioridad y fecha límite.</p>
              <div style={{ padding: '10px 12px', background: 'var(--bg-secondary)', borderRadius: 8, fontSize: 12 }}>
                <strong>Protocolo:</strong> SMTP sobre SSL (puerto 465)<br/>
                <strong>Servidor:</strong> mail.movidatci.com<br/>
                <strong>Remitente:</strong> wms@movidatci.com
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
