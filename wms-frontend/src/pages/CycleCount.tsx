import { useEffect, useState, useRef, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { API } from '../config/api';
import {
  ClipboardList, RefreshCw, Plus, X, Check, Clock, AlertTriangle,
  Package, Search, ChevronDown, ChevronUp, CheckCircle, XCircle, Scan, Volume2
} from 'lucide-react';

type Phase = 'list' | 'create' | 'count' | 'scan' | 'review';

// Audio feedback via Web Audio API
function playBeep(success: boolean) {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = success ? 880 : 330;
    osc.type = success ? 'sine' : 'square';
    gain.gain.value = 0.3;
    osc.start();
    osc.stop(ctx.currentTime + (success ? 0.12 : 0.3));
  } catch { }
}

function vibrate(ms: number) {
  try { navigator.vibrate?.(ms); } catch { }
}

export function CycleCount() {
  const { token, user } = useAuth();
  const [counts, setCounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState<Phase>('list');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  // Create form
  const [createForm, setCreateForm] = useState({ nombre: '', tipo: 'SKU', fechaProgramada: '', asignadoA: '', notas: '' });
  const [warehouse, setWarehouse] = useState<any>(null);
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState({ type: '', text: '' });

  // Count phase (manual)
  const [activeCount, setActiveCount] = useState<any>(null);
  const [physicalCounts, setPhysicalCounts] = useState<Record<string, number>>({});

  // Scan phase (Zebra)
  const [scanInput, setScanInput] = useState('');
  const [lastScan, setLastScan] = useState<{ sku: string; desc: string; count: number; time: string } | null>(null);
  const [scanLog, setScanLog] = useState<{ sku: string; time: string }[]>([]);
  const [scanError, setScanError] = useState('');
  const scanRef = useRef<HTMLInputElement>(null);
  const [totalScans, setTotalScans] = useState(0);

  const headers: any = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [ccRes, whRes] = await Promise.all([
        fetch(`${API}/cycle-counts`, { headers }),
        fetch(`${API}/warehouses`, { headers }),
      ]);
      if (ccRes.ok) setCounts(await ccRes.json());
      if (whRes.ok) {
        const whs = await whRes.json();
        if (whs.length > 0) setWarehouse(whs[0]);
      }
    } catch (err) { console.error(err); }
    setLoading(false);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setMsg({ type: '', text: '' });
    if (!createForm.nombre || !createForm.fechaProgramada) { setMsg({ type: 'error', text: 'Nombre y fecha son obligatorios' }); return; }
    setSubmitting(true);
    try {
      const res = await fetch(`${API}/cycle-counts`, {
        method: 'POST', headers,
        body: JSON.stringify({ ...createForm, almacenId: warehouse?.id }),
      });
      if (!res.ok) throw new Error((await res.json()).message || 'Error');
      const result = await res.json();
      setMsg({ type: 'success', text: `✅ Conteo ${result.codigo} creado con ${result.lineas?.length} líneas` });
      loadData();
      setTimeout(() => { setPhase('list'); setMsg({ type: '', text: '' }); }, 2000);
    } catch (err: any) { setMsg({ type: 'error', text: err.message }); }
    setSubmitting(false);
  }

  function startCounting(cc: any, mode: 'manual' | 'scan' = 'manual') {
    setActiveCount(cc);
    const initial: Record<string, number> = {};
    if (mode === 'manual') {
      cc.lineas?.forEach((l: any) => { initial[l.id] = l.cantidadFisica ?? l.cantidadSistema; });
    } else {
      // Scan mode starts at 0 — you count what you physically find
      cc.lineas?.forEach((l: any) => { initial[l.id] = 0; });
    }
    setPhysicalCounts(initial);
    setScanLog([]);
    setLastScan(null);
    setTotalScans(0);
    setScanError('');
    setPhase(mode === 'scan' ? 'scan' : 'count');
    setMsg({ type: '', text: '' });
    // Auto-focus scan input after render
    setTimeout(() => scanRef.current?.focus(), 200);
  }

  // Handle barcode scan (Zebra TC22 sends keystrokes + Enter)
  const handleScanSubmit = useCallback((barcode: string) => {
    if (!activeCount || !barcode.trim()) return;
    const code = barcode.trim().toUpperCase();

    // Find the matching line by SKU code
    const line = activeCount.lineas?.find((l: any) =>
      l.sku?.codigo?.toUpperCase() === code
    );

    if (!line) {
      setScanError(`❌ SKU "${code}" no encontrado en este conteo`);
      playBeep(false);
      vibrate(300);
      setTimeout(() => setScanError(''), 3000);
      setScanInput('');
      scanRef.current?.focus();
      return;
    }

    // Increment physical count for this SKU
    setPhysicalCounts(prev => ({
      ...prev,
      [line.id]: (prev[line.id] || 0) + 1,
    }));

    const newCount = (physicalCounts[line.id] || 0) + 1;
    const now = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    setLastScan({
      sku: line.sku?.codigo,
      desc: line.sku?.descripcion,
      count: newCount,
      time: now,
    });

    setScanLog(prev => [{ sku: code, time: now }, ...prev].slice(0, 50));
    setTotalScans(prev => prev + 1);
    setScanError('');
    playBeep(true);
    vibrate(100);
    setScanInput('');
    scanRef.current?.focus();
  }, [activeCount, physicalCounts]);

  async function savePhysicalCounts() {
    if (!activeCount) return;
    setSubmitting(true);
    setMsg({ type: '', text: '' });
    try {
      const lineas = activeCount.lineas.map((l: any) => ({
        id: l.id,
        cantidadFisica: physicalCounts[l.id] ?? (phase === 'scan' ? 0 : l.cantidadSistema),
        cantidadSistema: l.cantidadSistema,
      }));
      const res = await fetch(`${API}/cycle-counts/${activeCount.id}/count`, {
        method: 'PUT', headers,
        body: JSON.stringify({ lineas, usuario: user?.email }),
      });
      if (!res.ok) throw new Error((await res.json()).message || 'Error');
      setMsg({ type: 'success', text: '✅ Conteo físico registrado. Revisa las diferencias.' });
      const ccRes = await fetch(`${API}/cycle-counts`, { headers });
      if (ccRes.ok) {
        const all = await ccRes.json();
        setCounts(all);
        const updated = all.find((c: any) => c.id === activeCount.id);
        if (updated) setActiveCount(updated);
      }
      setPhase('review');
    } catch (err: any) { setMsg({ type: 'error', text: err.message }); }
    setSubmitting(false);
  }

  async function finalizeCount() {
    if (!activeCount) return;
    if (!confirm('¿Estás seguro? Esto ajustará el inventario real según los conteos físicos.')) return;
    setSubmitting(true);
    setMsg({ type: '', text: '' });
    try {
      const res = await fetch(`${API}/cycle-counts/${activeCount.id}/finalize`, {
        method: 'POST', headers,
        body: JSON.stringify({ usuario: user?.email }),
      });
      if (!res.ok) throw new Error((await res.json()).message || 'Error');
      const result = await res.json();
      setMsg({ type: 'success', text: `✅ ${result.message}` });
      loadData();
      setTimeout(() => { setPhase('list'); setActiveCount(null); setMsg({ type: '', text: '' }); }, 3000);
    } catch (err: any) { setMsg({ type: 'error', text: err.message }); }
    setSubmitting(false);
  }

  const filtered = counts.filter(c => !search || c.codigo?.toLowerCase().includes(search.toLowerCase()) || c.nombre?.toLowerCase().includes(search.toLowerCase()));

  const estadoBadge = (e: string) => {
    switch (e) {
      case 'PROGRAMADO': return 'info';
      case 'EN_PROGRESO': return 'warning';
      case 'COMPLETADO': return 'success';
      case 'CANCELADO': return 'danger';
      default: return 'default';
    }
  };

  // ==========================================
  // SCAN MODE (Zebra TC22 optimized)
  // ==========================================
  if (phase === 'scan' && activeCount) {
    const scannedSkus = activeCount.lineas?.filter((l: any) => (physicalCounts[l.id] || 0) > 0).length || 0;
    const totalLines = activeCount.lineas?.length || 0;
    const progress = totalLines > 0 ? Math.round((scannedSkus / totalLines) * 100) : 0;

    return (
      <div className="scan-mode">
        {/* Top bar */}
        <div className="scan-topbar">
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{activeCount.codigo}</div>
            <div style={{ fontSize: 12, opacity: 0.8 }}>{activeCount.nombre}</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-sm btn-ghost" style={{ color: 'white', borderColor: 'rgba(255,255,255,0.3)' }} onClick={() => { setPhase('list'); setActiveCount(null); }}>✕</button>
          </div>
        </div>

        {/* Scan input area */}
        <div className="scan-input-area">
          <div className="scan-icon-pulse">
            <Scan size={40} />
          </div>
          <input
            ref={scanRef}
            className="scan-input-field"
            value={scanInput}
            onChange={e => setScanInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleScanSubmit(scanInput);
              }
            }}
            placeholder="Escanea o escribe código SKU..."
            autoFocus
            autoComplete="off"
            inputMode="none"
          />
          <div className="scan-hint">
            Apunta el escáner Zebra al código de barras del producto
          </div>
        </div>

        {/* Last scan result */}
        {lastScan && (
          <div className="scan-result scan-result-success">
            <div className="scan-result-icon">✅</div>
            <div className="scan-result-info">
              <div className="scan-result-sku">{lastScan.sku}</div>
              <div className="scan-result-desc">{lastScan.desc}</div>
            </div>
            <div className="scan-result-count">
              <div className="scan-count-num">{lastScan.count}</div>
              <div className="scan-count-label">contados</div>
            </div>
          </div>
        )}

        {scanError && (
          <div className="scan-result scan-result-error">
            <div style={{ fontSize: 16 }}>{scanError}</div>
          </div>
        )}

        {/* Progress */}
        <div className="scan-progress-section">
          <div className="scan-progress-header">
            <span>{scannedSkus}/{totalLines} SKUs escaneados</span>
            <span>{totalScans} escaneos totales</span>
          </div>
          <div className="scan-progress-bar">
            <div className="scan-progress-fill" style={{ width: `${progress}%` }}></div>
          </div>
        </div>

        {/* Quick summary */}
        <div className="scan-summary">
          <div className="scan-summary-title">Resumen de Escaneo</div>
          {activeCount.lineas?.map((l: any) => {
            const counted = physicalCounts[l.id] || 0;
            const diff = counted - l.cantidadSistema;
            return (
              <div key={l.id} className={`scan-line ${counted > 0 ? 'scanned' : ''}`}>
                <div className="scan-line-info">
                  <code>{l.sku?.codigo}</code>
                  <span className="scan-line-desc">{l.sku?.descripcion}</span>
                </div>
                <div className="scan-line-counts">
                  <span className="scan-line-system">Sist: {l.cantidadSistema}</span>
                  <span className={`scan-line-physical ${counted > 0 ? 'active' : ''}`}>Físico: {counted}</span>
                  {counted > 0 && diff !== 0 && (
                    <span className={`scan-line-diff ${diff > 0 ? 'positive' : 'negative'}`}>
                      {diff > 0 ? '+' : ''}{diff}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Scan log */}
        {scanLog.length > 0 && (
          <div className="scan-log">
            <div className="scan-summary-title">Últimos escaneos</div>
            {scanLog.slice(0, 10).map((s, i) => (
              <div key={i} className="scan-log-item">
                <code>{s.sku}</code>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s.time}</span>
              </div>
            ))}
          </div>
        )}

        {/* Bottom action bar */}
        <div className="scan-actions">
          <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => startCounting(activeCount, 'manual')}>
            Modo Manual
          </button>
          <button className="btn btn-primary" style={{ flex: 2 }} onClick={savePhysicalCounts} disabled={submitting}>
            {submitting ? 'Guardando...' : `✅ Finalizar Escaneo (${totalScans} scans)`}
          </button>
        </div>
      </div>
    );
  }

  // ==========================================
  // CREATE FORM
  // ==========================================
  if (phase === 'create') {
    return (
      <div className="page-container">
        <div className="page-header">
          <div><h1 className="page-title">Nuevo Conteo Cíclico</h1><p className="page-subtitle">Programa un conteo para verificar stock físico vs sistema</p></div>
          <button className="btn btn-ghost" onClick={() => setPhase('list')}><X size={16} /> Cancelar</button>
        </div>
        <div className="card">
          <form onSubmit={handleCreate} className="modal-body" style={{ padding: '24px' }}>
            <div className="form-row">
              <div className="form-group" style={{ flex: 2 }}>
                <label className="form-label">Nombre del Conteo <span className="required">*</span></label>
                <input className="form-input" placeholder="Ej: Conteo mensual abril 2026" value={createForm.nombre} onChange={e => setCreateForm(f => ({ ...f, nombre: e.target.value }))} required />
              </div>
              <div className="form-group">
                <label className="form-label">Tipo</label>
                <select className="form-select form-select-full" value={createForm.tipo} onChange={e => setCreateForm(f => ({ ...f, tipo: e.target.value }))}>
                  <option value="SKU">Por SKU</option>
                  <option value="UBICACION">Por Ubicación</option>
                  <option value="ZONA">Por Zona</option>
                  <option value="COMPLETO">Completo</option>
                </select>
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Fecha Programada <span className="required">*</span></label>
                <input className="form-input" type="date" value={createForm.fechaProgramada} onChange={e => setCreateForm(f => ({ ...f, fechaProgramada: e.target.value }))} required />
              </div>
              <div className="form-group">
                <label className="form-label">Asignado a</label>
                <input className="form-input" placeholder="Nombre del responsable" value={createForm.asignadoA} onChange={e => setCreateForm(f => ({ ...f, asignadoA: e.target.value }))} />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Notas</label>
              <input className="form-input" placeholder="Instrucciones o notas adicionales" value={createForm.notas} onChange={e => setCreateForm(f => ({ ...f, notas: e.target.value }))} />
            </div>
            <div style={{ padding: '12px 16px', background: 'var(--info-soft)', borderRadius: 8, fontSize: 13, color: 'var(--info)' }}>
              ℹ️ Se generarán líneas automáticamente para todos los SKUs con stock activo (calidad LIBERADO).
            </div>
            {msg.text && <div className={`form-message ${msg.type === 'error' ? 'form-error-msg' : 'form-success-msg'}`}>{msg.text}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="btn btn-ghost" onClick={() => setPhase('list')}>Cancelar</button>
              <button type="submit" className="btn btn-primary" disabled={submitting}>{submitting ? 'Creando...' : 'Crear Conteo Cíclico'}</button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  // ==========================================
  // MANUAL COUNT
  // ==========================================
  if (phase === 'count' && activeCount) {
    return (
      <div className="page-container">
        <div className="page-header">
          <div><h1 className="page-title">Conteo Manual — {activeCount.codigo}</h1><p className="page-subtitle">{activeCount.nombre} · {activeCount.lineas?.length} líneas</p></div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-ghost" onClick={() => { setPhase('list'); setActiveCount(null); }}>Cancelar</button>
            <button className="btn btn-secondary" onClick={() => startCounting(activeCount, 'scan')}><Scan size={16} /> Modo Escáner</button>
            <button className="btn btn-primary" onClick={savePhysicalCounts} disabled={submitting}>{submitting ? <><RefreshCw size={14} className="animate-spin" /> Guardando...</> : <><Check size={16} /> Guardar Conteo</>}</button>
          </div>
        </div>
        {msg.text && <div className={`form-message ${msg.type === 'error' ? 'form-error-msg' : 'form-success-msg'}`} style={{ marginBottom: 16 }}>{msg.text}</div>}
        <div className="card">
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>SKU</th>
                  <th>Descripción</th>
                  <th style={{ textAlign: 'right' }}>Cantidad Sistema</th>
                  <th style={{ textAlign: 'center', background: 'var(--accent-primary-soft)', minWidth: 140 }}>Cantidad Física</th>
                  <th style={{ textAlign: 'right' }}>Diferencia</th>
                </tr>
              </thead>
              <tbody>
                {activeCount.lineas?.map((l: any, i: number) => {
                  const physical = physicalCounts[l.id] ?? l.cantidadSistema;
                  const diff = physical - l.cantidadSistema;
                  return (
                    <tr key={l.id} className="animate-fade-in" style={{ animationDelay: `${i * 0.02}s` }}>
                      <td style={{ fontWeight: 600, color: 'var(--text-tertiary)' }}>{i + 1}</td>
                      <td><code style={{ fontSize: 12, background: 'var(--bg-secondary)', padding: '2px 6px', borderRadius: 4 }}>{l.sku?.codigo}</code></td>
                      <td style={{ fontWeight: 500, whiteSpace: 'normal', minWidth: 180 }}>{l.sku?.descripcion}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600, fontSize: 15 }}>{l.cantidadSistema}</td>
                      <td style={{ textAlign: 'center' }}>
                        <input className="form-input" type="number" min="0" value={physical}
                          onChange={e => setPhysicalCounts(prev => ({ ...prev, [l.id]: parseInt(e.target.value) || 0 }))}
                          style={{ width: 100, textAlign: 'center', fontWeight: 700, fontSize: 15, margin: '0 auto', display: 'block' }} />
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {diff !== 0 ? <span style={{ fontWeight: 700, color: diff > 0 ? 'var(--emerald)' : 'var(--danger)', fontSize: 15 }}>{diff > 0 ? '+' : ''}{diff}</span> : <span style={{ color: 'var(--text-muted)' }}>0</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
            <span style={{ color: 'var(--text-tertiary)' }}>{activeCount.lineas?.length} líneas</span>
            <span><strong style={{ color: 'var(--danger)' }}>{activeCount.lineas?.filter((l: any) => (physicalCounts[l.id] ?? l.cantidadSistema) !== l.cantidadSistema).length}</strong> con diferencias</span>
          </div>
        </div>
      </div>
    );
  }

  // ==========================================
  // REVIEW PHASE
  // ==========================================
  if (phase === 'review' && activeCount) {
    const totalDiffs = activeCount.lineas?.filter((l: any) => l.discrepancia !== 0 && l.discrepancia !== null).length || 0;
    return (
      <div className="page-container">
        <div className="page-header">
          <div><h1 className="page-title">Revisión — {activeCount.codigo}</h1><p className="page-subtitle">{totalDiffs} diferencias encontradas · Revisa antes de aplicar ajustes</p></div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-ghost" onClick={() => { setPhase('list'); setActiveCount(null); }}>Volver</button>
            <button className="btn btn-warning" onClick={() => startCounting(activeCount, 'manual')}>Re-contar</button>
            <button className="btn btn-success" onClick={finalizeCount} disabled={submitting}>{submitting ? 'Aplicando...' : '✅ Finalizar y Ajustar Inventario'}</button>
          </div>
        </div>
        {msg.text && <div className={`form-message ${msg.type === 'error' ? 'form-error-msg' : 'form-success-msg'}`} style={{ marginBottom: 16 }}>{msg.text}</div>}

        <div className="stats-grid" style={{ marginBottom: 20 }}>
          <div className="stat-card">
            <div className="stat-icon" style={{ background: 'var(--info-soft)', color: 'var(--info)' }}><Package size={20} /></div>
            <div className="stat-info"><span className="stat-value">{activeCount.lineas?.length}</span><span className="stat-label">Líneas contadas</span></div>
          </div>
          <div className="stat-card">
            <div className="stat-icon" style={{ background: 'var(--success-soft)', color: 'var(--success)' }}><CheckCircle size={20} /></div>
            <div className="stat-info"><span className="stat-value">{activeCount.lineas?.filter((l: any) => (l.discrepancia || 0) === 0).length}</span><span className="stat-label">Sin diferencia</span></div>
          </div>
          <div className="stat-card">
            <div className="stat-icon" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}><XCircle size={20} /></div>
            <div className="stat-info"><span className="stat-value">{totalDiffs}</span><span className="stat-label">Con diferencia</span></div>
          </div>
          <div className="stat-card">
            <div className="stat-icon" style={{ background: 'var(--warning-soft)', color: 'var(--warning)' }}><AlertTriangle size={20} /></div>
            <div className="stat-info"><span className="stat-value">{activeCount.lineas?.reduce((s: number, l: any) => s + Math.abs(l.discrepancia || 0), 0)}</span><span className="stat-label">Uds a ajustar</span></div>
          </div>
        </div>

        <div className="card">
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead><tr><th>SKU</th><th>Descripción</th><th style={{ textAlign: 'right' }}>Sistema</th><th style={{ textAlign: 'right' }}>Físico</th><th style={{ textAlign: 'right' }}>Diferencia</th><th>Status</th></tr></thead>
              <tbody>
                {activeCount.lineas?.map((l: any, i: number) => {
                  const diff = l.discrepancia || 0;
                  return (
                    <tr key={l.id} className="animate-fade-in" style={{ animationDelay: `${i * 0.02}s`, background: diff !== 0 ? 'rgba(239,68,68,0.03)' : undefined }}>
                      <td><code style={{ fontSize: 12, background: 'var(--bg-secondary)', padding: '2px 6px', borderRadius: 4 }}>{l.sku?.codigo}</code></td>
                      <td style={{ fontWeight: 500, whiteSpace: 'normal', minWidth: 180 }}>{l.sku?.descripcion}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{l.cantidadSistema}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700, color: diff !== 0 ? 'var(--danger)' : 'var(--text-primary)' }}>{l.cantidadFisica ?? '—'}</td>
                      <td style={{ textAlign: 'right' }}>
                        {diff !== 0 ? <span style={{ fontWeight: 700, color: diff > 0 ? 'var(--emerald)' : 'var(--danger)' }}>{diff > 0 ? '+' : ''}{diff}</span> : <span style={{ color: 'var(--text-muted)' }}>0</span>}
                      </td>
                      <td>{diff === 0 ? <CheckCircle size={16} color="var(--emerald)" /> : <AlertTriangle size={16} color="var(--danger)" />}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        <div style={{ marginTop: 16, padding: '12px 16px', background: 'var(--warning-soft)', borderRadius: 8, fontSize: 13, color: 'var(--warning)', border: '1px solid rgba(245,158,11,0.2)' }}>
          ⚠️ Al finalizar, las diferencias se aplicarán directamente al inventario real: sobrantes se sumarán, faltantes se restarán, y se crearán movimientos de ajuste.
        </div>
      </div>
    );
  }

  // ==========================================
  // LIST VIEW
  // ==========================================
  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Conteo Cíclico</h1>
          <p className="page-subtitle">{counts.length} conteos · {counts.filter(c => c.estado === 'PROGRAMADO').length} programados</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" onClick={() => { setPhase('create'); setCreateForm({ nombre: '', tipo: 'SKU', fechaProgramada: '', asignadoA: '', notas: '' }); setMsg({ type: '', text: '' }); }}><Plus size={16} /> Nuevo Conteo</button>
          <button className="btn btn-secondary" onClick={loadData}><RefreshCw size={16} /> Actualizar</button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 12, padding: '16px 20px' }}>
          <div className="search-box" style={{ flex: 1 }}><Search size={16} /><input placeholder="Buscar conteo..." value={search} onChange={e => setSearch(e.target.value)} /></div>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-secondary)' }}><RefreshCw className="animate-spin" size={24} /> Cargando...</div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {filtered.map((cc, i) => {
            const totalLineas = cc.lineas?.length || 0;
            const totalDiffs = cc.lineas?.filter((l: any) => l.discrepancia !== 0 && l.discrepancia !== null).length || 0;
            return (
              <div key={cc.id} className="card animate-fade-in" style={{ animationDelay: `${i * 0.04}s` }}>
                <div style={{ padding: '16px 20px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                        <span style={{ fontWeight: 700, fontSize: 15 }}>{cc.codigo}</span>
                        <span className={`badge badge-${estadoBadge(cc.estado)}`}>{cc.estado}</span>
                        <span className="badge badge-default">{cc.tipo}</span>
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>{cc.nombre}</div>
                      <div style={{ display: 'flex', gap: 16, marginTop: 6, fontSize: 13, color: 'var(--text-secondary)' }}>
                        <span>📅 {new Date(cc.fechaProgramada).toLocaleDateString('es-MX')}</span>
                        <span>📦 {totalLineas} líneas</span>
                        {cc.asignadoA && <span>👤 {cc.asignadoA}</span>}
                        {totalDiffs > 0 && <span style={{ color: 'var(--danger)', fontWeight: 600 }}>⚠ {totalDiffs} diferencias</span>}
                        {cc.fechaCierre && <span>✅ Cerrado: {new Date(cc.fechaCierre).toLocaleDateString('es-MX')}</span>}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      {cc.estado === 'PROGRAMADO' && (
                        <>
                          <button className="btn btn-sm btn-secondary" onClick={() => startCounting(cc, 'scan')} title="Escanear con Zebra"><Scan size={14} /> Escáner</button>
                          <button className="btn btn-sm btn-primary" onClick={() => startCounting(cc, 'manual')}>Manual</button>
                        </>
                      )}
                      {cc.estado === 'EN_PROGRESO' && <button className="btn btn-sm btn-warning" onClick={() => { setActiveCount(cc); setPhase('review'); setMsg({ type: '', text: '' }); }}>Revisar</button>}
                      <button className="btn btn-ghost btn-sm" onClick={() => setExpanded(expanded === cc.id ? null : cc.id)}>
                        {expanded === cc.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </button>
                    </div>
                  </div>

                  {expanded === cc.id && (
                    <div style={{ marginTop: 12, padding: 12, background: 'var(--bg-secondary)', borderRadius: 8 }}>
                      <table className="data-table" style={{ fontSize: 13 }}>
                        <thead><tr><th>SKU</th><th>Descripción</th><th style={{ textAlign: 'right' }}>Sistema</th><th style={{ textAlign: 'right' }}>Físico</th><th style={{ textAlign: 'right' }}>Dif.</th></tr></thead>
                        <tbody>
                          {cc.lineas?.map((l: any) => (
                            <tr key={l.id}>
                              <td><code>{l.sku?.codigo}</code></td>
                              <td>{l.sku?.descripcion}</td>
                              <td style={{ textAlign: 'right', fontWeight: 600 }}>{l.cantidadSistema}</td>
                              <td style={{ textAlign: 'right', fontWeight: 600 }}>{l.cantidadFisica ?? '—'}</td>
                              <td style={{ textAlign: 'right', fontWeight: 700, color: (l.discrepancia || 0) !== 0 ? 'var(--danger)' : 'var(--text-muted)' }}>{l.discrepancia ?? '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && <div className="card"><div style={{ padding: 40, textAlign: 'center', color: 'var(--text-tertiary)' }}>Sin conteos cíclicos. Crea uno para verificar tu inventario.</div></div>}
        </div>
      )}
    </div>
  );
}
