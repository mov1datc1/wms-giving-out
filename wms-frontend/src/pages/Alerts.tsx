import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { API } from '../config/api';
import {
  Bell, RefreshCw, AlertTriangle, Package, Clock, TrendingDown,
  CheckCircle, Search, Zap, ShieldAlert, CalendarClock,
  ClipboardList, Send, X, User, Calendar
} from 'lucide-react';

const TIPO_CONFIG: Record<string, { icon: any; color: string; bg: string; label: string }> = {
  STOCK_BAJO: { icon: Package, color: 'var(--danger)', bg: 'var(--danger-soft)', label: 'Stock Bajo' },
  VENCIMIENTO_PROXIMO: { icon: CalendarClock, color: 'var(--orange)', bg: 'var(--warning-soft)', label: 'Vencimiento Próximo' },
  PEDIDO_ATRASADO: { icon: Clock, color: 'var(--purple)', bg: 'rgba(99,102,241,0.1)', label: 'Pedido Atrasado' },
  SIN_MOVIMIENTO: { icon: TrendingDown, color: 'var(--info)', bg: 'var(--info-soft)', label: 'Sin Movimiento' },
  DISCREPANCIA: { icon: AlertTriangle, color: 'var(--danger)', bg: 'var(--danger-soft)', label: 'Discrepancia' },
  UBICACION_SATURADA: { icon: ShieldAlert, color: 'var(--warning)', bg: 'var(--warning-soft)', label: 'Ubicación Saturada' },
};

const PRIORIDAD_CONFIG: Record<string, { color: string; badge: string }> = {
  CRITICA: { color: '#dc2626', badge: 'danger' },
  ALTA: { color: '#f59e0b', badge: 'warning' },
  MEDIA: { color: '#3b82f6', badge: 'info' },
  BAJA: { color: '#6b7280', badge: 'default' },
};

const AREAS = [
  { value: 'COMPRAS', label: '🛒 Compras', desc: 'Gestión de proveedores y reposición' },
  { value: 'DESPACHO', label: '🚚 Despacho', desc: 'Preparación y envío de pedidos' },
  { value: 'INVENTARIO', label: '📦 Inventario', desc: 'Control y verificación de stock' },
  { value: 'CALIDAD', label: '✅ Calidad', desc: 'Inspección y vencimientos' },
  { value: 'ALMACEN', label: '🏭 Almacén', desc: 'Operaciones de piso' },
];

// Auto-suggest area based on alert type
function suggestArea(tipo: string): string {
  switch (tipo) {
    case 'STOCK_BAJO': return 'COMPRAS';
    case 'VENCIMIENTO_PROXIMO': return 'CALIDAD';
    case 'PEDIDO_ATRASADO': return 'DESPACHO';
    case 'SIN_MOVIMIENTO': return 'INVENTARIO';
    case 'UBICACION_SATURADA': return 'ALMACEN';
    default: return 'ALMACEN';
  }
}

function suggestPriority(prioridad: string): string {
  switch (prioridad) {
    case 'CRITICA': return 'URGENTE';
    case 'ALTA': return 'ALTA';
    default: return 'MEDIA';
  }
}

export function Alerts() {
  const { token, user } = useAuth();
  const [alerts, setAlerts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [search, setSearch] = useState('');
  const [filterTipo, setFilterTipo] = useState('');
  const [showResolved, setShowResolved] = useState(false);
  const [msg, setMsg] = useState('');

  // Task modal
  const [taskModal, setTaskModal] = useState<any>(null); // the alert to create task for
  const [taskForm, setTaskForm] = useState({
    area: '', asignadoA: '', asignadoNombre: '', prioridad: 'MEDIA',
    fechaLimite: '', notas: '', notificarEmail: true,
  });
  const [taskSubmitting, setTaskSubmitting] = useState(false);
  const [taskMsg, setTaskMsg] = useState({ type: '', text: '' });
  const [expandedAlert, setExpandedAlert] = useState<string | null>(null);

  const headers: any = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  useEffect(() => { loadData(); }, [showResolved]);

  async function loadData() {
    setLoading(true);
    try {
      const url = showResolved ? `${API}/alerts?todas=true` : `${API}/alerts`;
      const res = await fetch(url, { headers });
      if (res.ok) setAlerts(await res.json());
    } catch (err) { console.error(err); }
    setLoading(false);
  }

  async function generateAlerts() {
    setGenerating(true);
    setMsg('');
    try {
      const res = await fetch(`${API}/alerts/generate`, { method: 'POST', headers });
      if (res.ok) {
        const result = await res.json();
        setMsg(`✅ ${result.message}`);
        loadData();
      }
    } catch (err) { console.error(err); }
    setGenerating(false);
  }

  async function resolveAlert(id: string) {
    try {
      await fetch(`${API}/alerts/${id}/resolve`, {
        method: 'PUT', headers,
        body: JSON.stringify({ usuario: user?.email }),
      });
      loadData();
    } catch (err) { console.error(err); }
  }

  function openTaskModal(alert: any) {
    setTaskModal(alert);
    setTaskForm({
      area: suggestArea(alert.tipo),
      asignadoA: '',
      asignadoNombre: '',
      prioridad: suggestPriority(alert.prioridad),
      fechaLimite: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      notas: '',
      notificarEmail: true,
    });
    setTaskMsg({ type: '', text: '' });
  }

  async function submitTask(e: React.FormEvent) {
    e.preventDefault();
    if (!taskModal || !taskForm.area) return;
    setTaskSubmitting(true);
    setTaskMsg({ type: '', text: '' });
    try {
      const body = {
        titulo: `Tarea: ${taskModal.titulo}`,
        descripcion: taskModal.detalle,
        area: taskForm.area,
        asignadoA: taskForm.asignadoA,
        asignadoNombre: taskForm.asignadoNombre,
        prioridad: taskForm.prioridad,
        fechaLimite: taskForm.fechaLimite,
        notas: taskForm.notas,
        alertaId: taskModal.id,
        creadoPor: user?.email,
      };
      const res = await fetch(`${API}/tasks`, { method: 'POST', headers, body: JSON.stringify({ ...body, notificarEmail: taskForm.notificarEmail }) });
      if (!res.ok) throw new Error((await res.json()).message || 'Error');
      const task = await res.json();
      setTaskMsg({ type: 'success', text: `✅ Tarea creada y asignada a ${AREAS.find(a => a.value === taskForm.area)?.label || taskForm.area}${taskForm.asignadoNombre ? ` — ${taskForm.asignadoNombre}` : ''}${taskForm.notificarEmail && taskForm.asignadoA ? ' · 📧 Correo enviado' : ''}` });
      setTimeout(() => { setTaskModal(null); loadData(); }, 2500);
    } catch (err: any) { setTaskMsg({ type: 'error', text: err.message }); }
    setTaskSubmitting(false);
  }

  const filtered = alerts.filter(a => {
    const matchSearch = !search || a.titulo?.toLowerCase().includes(search.toLowerCase()) || a.detalle?.toLowerCase().includes(search.toLowerCase());
    const matchTipo = !filterTipo || a.tipo === filterTipo;
    return matchSearch && matchTipo;
  });

  const byTipo = alerts.reduce((acc: Record<string, number>, a) => {
    if (!a.resuelta) acc[a.tipo] = (acc[a.tipo] || 0) + 1;
    return acc;
  }, {});

  const activeCount = alerts.filter(a => !a.resuelta).length;
  const criticalCount = alerts.filter(a => !a.resuelta && a.prioridad === 'CRITICA').length;

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Centro de Alertas</h1>
          <p className="page-subtitle">{activeCount} alertas activas · {criticalCount} críticas</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" onClick={generateAlerts} disabled={generating}>
            {generating ? <><RefreshCw size={14} className="animate-spin" /> Escaneando...</> : <><Zap size={16} /> Escanear Inventario</>}
          </button>
          <button className="btn btn-secondary" onClick={loadData}><RefreshCw size={16} /> Actualizar</button>
        </div>
      </div>

      {msg && <div className="form-message form-success-msg" style={{ marginBottom: 16 }}>{msg}</div>}

      {/* Summary cards by type */}
      <div className="stats-grid" style={{ marginBottom: 20 }}>
        {Object.entries(TIPO_CONFIG).map(([tipo, cfg]) => {
          const count = byTipo[tipo] || 0;
          const Icon = cfg.icon;
          return (
            <div key={tipo} className="stat-card" style={{ cursor: 'pointer', opacity: filterTipo && filterTipo !== tipo ? 0.4 : 1 }}
              onClick={() => setFilterTipo(filterTipo === tipo ? '' : tipo)}>
              <div className="stat-icon" style={{ background: cfg.bg, color: cfg.color }}><Icon size={20} /></div>
              <div className="stat-info"><span className="stat-value">{count}</span><span className="stat-label">{cfg.label}</span></div>
            </div>
          );
        })}
      </div>

      {/* Filters */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 12, padding: '16px 20px', alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="search-box" style={{ flex: 1, minWidth: 200 }}><Search size={16} /><input placeholder="Buscar alertas..." value={search} onChange={e => setSearch(e.target.value)} /></div>
          <label className="toggle-switch">
            <input type="checkbox" checked={showResolved} onChange={e => setShowResolved(e.target.checked)} />
            <span className="toggle-slider"></span>
            <span className="toggle-label" style={{ minWidth: 80 }}>{showResolved ? 'Todas' : 'Activas'}</span>
          </label>
        </div>
      </div>

      {/* Task creation modal */}
      {taskModal && (
        <div className="modal-overlay" onClick={() => setTaskModal(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 580 }}>
            <div className="modal-header">
              <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><ClipboardList size={20} /> Programar Tarea</h2>
              <button className="btn btn-ghost btn-sm" onClick={() => setTaskModal(null)}><X size={18} /></button>
            </div>
            <form onSubmit={submitTask} className="modal-body">
              {/* Source alert preview */}
              <div style={{ padding: '12px 16px', borderRadius: 8, background: 'var(--bg-secondary)', marginBottom: 16, border: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                  <span className={`badge badge-${PRIORIDAD_CONFIG[taskModal.prioridad]?.badge || 'default'}`}>{taskModal.prioridad}</span>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{taskModal.titulo}</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{taskModal.detalle}</div>
              </div>

              {/* Area assignment with visual cards */}
              <div className="form-group">
                <label className="form-label">Asignar al Área <span className="required">*</span></label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
                  {AREAS.map(a => (
                    <div key={a.value} onClick={() => setTaskForm(f => ({ ...f, area: a.value }))}
                      style={{
                        padding: '10px 12px', borderRadius: 10, cursor: 'pointer', textAlign: 'center',
                        border: `2px solid ${taskForm.area === a.value ? 'var(--accent-primary)' : 'var(--border)'}`,
                        background: taskForm.area === a.value ? 'var(--accent-primary-soft)' : 'var(--bg-secondary)',
                        transition: 'all 0.15s',
                      }}>
                      <div style={{ fontSize: 20 }}>{a.label.split(' ')[0]}</div>
                      <div style={{ fontSize: 12, fontWeight: 600, marginTop: 2 }}>{a.label.split(' ').slice(1).join(' ')}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Responsable</label>
                  <input className="form-input" placeholder="Nombre del responsable" value={taskForm.asignadoNombre}
                    onChange={e => setTaskForm(f => ({ ...f, asignadoNombre: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Email del responsable</label>
                  <input className="form-input" type="email" placeholder="correo@givingout.com" value={taskForm.asignadoA}
                    onChange={e => setTaskForm(f => ({ ...f, asignadoA: e.target.value }))} />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Prioridad</label>
                  <select className="form-select form-select-full" value={taskForm.prioridad}
                    onChange={e => setTaskForm(f => ({ ...f, prioridad: e.target.value }))}>
                    <option value="BAJA">🟢 Baja</option>
                    <option value="MEDIA">🔵 Media</option>
                    <option value="ALTA">🟡 Alta</option>
                    <option value="URGENTE">🔴 Urgente</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Fecha límite</label>
                  <input className="form-input" type="date" value={taskForm.fechaLimite}
                    onChange={e => setTaskForm(f => ({ ...f, fechaLimite: e.target.value }))} />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Instrucciones adicionales</label>
                <textarea className="form-input" rows={2} placeholder="Ej: Contactar a proveedor TextilMX para cotizar 200 prendas..."
                  value={taskForm.notas} onChange={e => setTaskForm(f => ({ ...f, notas: e.target.value }))}
                  style={{ resize: 'vertical', fontFamily: 'inherit' }} />
              </div>

              {/* Email toggle */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: 'var(--bg-secondary)', borderRadius: 8, border: '1px solid var(--border)' }}>
                <label className="toggle-switch" style={{ marginRight: 0 }}>
                  <input type="checkbox" checked={taskForm.notificarEmail}
                    onChange={e => setTaskForm(f => ({ ...f, notificarEmail: e.target.checked }))} />
                  <span className="toggle-slider"></span>
                </label>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}><Send size={13} style={{ marginRight: 4 }} />Notificar por correo</div>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                    {taskForm.notificarEmail
                      ? taskForm.asignadoA ? `Se enviará notificación a ${taskForm.asignadoA}` : 'Ingresa un email para notificar'
                      : 'La tarea se creará sin enviar notificación'}
                  </div>
                </div>
              </div>

              {taskMsg.text && <div className={`form-message ${taskMsg.type === 'error' ? 'form-error-msg' : 'form-success-msg'}`}>{taskMsg.text}</div>}
              <div className="modal-footer">
                <button type="button" className="btn btn-ghost" onClick={() => setTaskModal(null)}>Cancelar</button>
                <button type="submit" className="btn btn-primary" disabled={taskSubmitting || !taskForm.area}>
                  {taskSubmitting ? 'Creando...' : <><ClipboardList size={14} /> Crear Tarea</>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-secondary)' }}><RefreshCw className="animate-spin" size={24} /> Cargando alertas...</div>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {filtered.map((a, i) => {
            const cfg = TIPO_CONFIG[a.tipo] || TIPO_CONFIG.STOCK_BAJO;
            const prio = PRIORIDAD_CONFIG[a.prioridad] || PRIORIDAD_CONFIG.MEDIA;
            const Icon = cfg.icon;
            const hasTasks = a.tasks?.length > 0;
            return (
              <div key={a.id} className="card animate-fade-in" style={{ animationDelay: `${i * 0.03}s`, opacity: a.resuelta ? 0.5 : 1 }}>
                <div style={{ padding: '14px 20px', display: 'flex', gap: 14, alignItems: 'center' }}>
                  <div style={{ width: 42, height: 42, borderRadius: 10, background: cfg.bg, color: cfg.color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Icon size={20} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 2, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, fontSize: 14 }}>{a.titulo}</span>
                      <span className={`badge badge-${prio.badge}`} style={{ fontSize: 10 }}>{a.prioridad}</span>
                      {a.resuelta && <span className="badge badge-success" style={{ fontSize: 10 }}>RESUELTA</span>}
                      {hasTasks && (
                        <span className="badge badge-info" style={{ fontSize: 10, cursor: 'pointer' }}
                          onClick={() => setExpandedAlert(expandedAlert === a.id ? null : a.id)}>
                          📋 {a.tasks.length} tarea{a.tasks.length > 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.4 }}>{a.detalle}</div>
                    <div style={{ display: 'flex', gap: 12, marginTop: 4, fontSize: 11, color: 'var(--text-muted)' }}>
                      <span>{new Date(a.createdAt).toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                      {a.resueltaPor && <span>Resuelta por: {a.resueltaPor}</span>}
                    </div>
                  </div>
                  {!a.resuelta && (
                    <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                      <button className="btn btn-sm btn-ghost" onClick={() => openTaskModal(a)} title="Programar tarea"
                        style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 10px' }}>
                        <ClipboardList size={15} color="var(--purple)" />
                        <span style={{ fontSize: 11, color: 'var(--purple)', fontWeight: 600 }}>Tarea</span>
                      </button>
                      <button className="btn btn-sm btn-ghost" onClick={() => resolveAlert(a.id)} title="Marcar como resuelta">
                        <CheckCircle size={18} color="var(--emerald)" />
                      </button>
                    </div>
                  )}
                </div>
                {/* Expandable tasks list */}
                {hasTasks && expandedAlert === a.id && (
                  <div style={{ borderTop: '1px solid var(--border)', padding: '12px 20px', background: 'var(--bg-secondary)' }}>
                    <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8, color: 'var(--text-secondary)' }}>📋 Tareas asignadas</div>
                    {a.tasks.map((t: any) => {
                      const areaLabel = AREAS.find(ar => ar.value === t.area)?.label || t.area;
                      const statusColor = t.estado === 'COMPLETADA' ? 'var(--emerald)' : t.estado === 'EN_PROCESO' ? 'var(--info)' : 'var(--orange)';
                      return (
                        <div key={t.id} style={{
                          display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                          background: 'var(--bg-card)', borderRadius: 8, marginBottom: 6,
                          border: '1px solid var(--border)', fontSize: 13,
                        }}>
                          <span style={{ fontSize: 16 }}>{areaLabel.split(' ')[0]}</span>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 600, fontSize: 13 }}>{areaLabel.split(' ').slice(1).join(' ')}</div>
                            {t.asignadoNombre && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}><User size={10} /> {t.asignadoNombre}</div>}
                          </div>
                          <span className="badge" style={{ fontSize: 10, background: statusColor, color: '#fff' }}>{t.estado}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div className="card"><div style={{ padding: 60, textAlign: 'center', color: 'var(--text-tertiary)' }}>
              <Bell size={32} style={{ opacity: 0.3, marginBottom: 12 }} />
              <div>Sin alertas {filterTipo ? `de tipo "${TIPO_CONFIG[filterTipo]?.label}"` : ''}</div>
              <div style={{ fontSize: 13, marginTop: 4 }}>Haz clic en "Escanear Inventario" para detectar problemas automáticamente.</div>
            </div></div>
          )}
        </div>
      )}
    </div>
  );
}
