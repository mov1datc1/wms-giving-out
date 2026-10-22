import { useEffect, useState, useRef, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { API } from '../config/api';
import {
  ClipboardList, RefreshCw, Plus, X, Check, Clock, AlertTriangle,
  Package, Search, ChevronDown, ChevronUp, CheckCircle, XCircle, Scan,
  ShieldAlert, Lock, Boxes, AlertCircle, EyeOff, Layers, MapPin, Tag
} from 'lucide-react';

type Phase = 'list' | 'count' | 'scan' | 'review';
type StatusFilter = 'TODOS' | 'PROGRAMADO' | 'EN_PROGRESO' | 'COMPLETADO' | 'CANCELADO';

// Helper for dynamic pluralization
function pluralize(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

// Helper to format operational calendar dates without timezone shift
function formatOperationalDate(dateVal: string | Date | null | undefined): string {
  if (!dateVal) return '—';
  if (typeof dateVal === 'string') {
    const match = dateVal.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      const [, year, month, day] = match;
      return `${day}/${month}/${year}`;
    }
  }
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-MX', { timeZone: 'UTC' });
}

// Helper to get today's calendar date in local timezone YYYY-MM-DD
function getTodayLocalDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

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
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('TODOS');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  // Modal Nuevo Conteo Cíclico
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState({
    nombre: '',
    tipo: 'ZONA',
    fechaProgramada: '',
    asignadoA: '',
    notas: '',
    zonaId: '',
    ubicacionId: '',
    skuId: '',
  });
  const [zones, setZones] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [skus, setSkus] = useState<any[]>([]);
  const [warehouse, setWarehouse] = useState<any>(null);
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState({ type: '', text: '' });
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [cancelConfirmId, setCancelConfirmId] = useState<string | null>(null);

  // Count phase (manual)
  const [activeCount, setActiveCount] = useState<any>(null);
  const [physicalCounts, setPhysicalCounts] = useState<Record<string, number | ''>>({});

  // Scan phase (Zebra)
  const [scanInput, setScanInput] = useState('');
  const [lastScan, setLastScan] = useState<{ sku: string; desc: string; count: number; time: string } | null>(null);
  const [scanLog, setScanLog] = useState<{ sku: string; time: string }[]>([]);
  const [scanError, setScanError] = useState('');
  const scanRef = useRef<HTMLInputElement>(null);
  const [totalScans, setTotalScans] = useState(0);

  const headers: any = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  // Role permissions check
  const isSupervisorOrAdmin = user?.isSuperAdmin || ['Super Admin', 'Administrador', 'Supervisor', 'DIRECTOR', 'ADMIN', 'SUPER_ADMIN'].some(
    r => r.toLowerCase() === (user?.rolNombre || '').toLowerCase()
  );

  useEffect(() => { loadData(); }, []);

  // Modal keyboard ergonomics (Escape closes modals if not submitting)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) {
        setShowCreateModal(false);
        setShowConfirmModal(false);
        setCancelConfirmId(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [submitting]);

  async function loadData() {
    setLoading(true);
    try {
      const [ccRes, whRes, zonesRes, locsRes, skusRes] = await Promise.all([
        fetch(`${API}/cycle-counts`, { headers }),
        fetch(`${API}/warehouses`, { headers }),
        fetch(`${API}/zones`, { headers }),
        fetch(`${API}/locations`, { headers }),
        fetch(`${API}/skus`, { headers }),
      ]);
      if (ccRes.ok) setCounts(await ccRes.json());
      if (whRes.ok) {
        const whs = await whRes.json();
        if (whs.length > 0) setWarehouse(whs[0]);
      }
      if (zonesRes.ok) setZones(await zonesRes.json());
      if (locsRes.ok) setLocations(await locsRes.json());
      if (skusRes.ok) setSkus(await skusRes.json());
    } catch (err) { console.error(err); }
    setLoading(false);
  }

  function formatErrorMessage(err: any): string {
    if (!err) return 'Error de conexión desconocido';
    const msg = typeof err === 'string' ? err : (err.message || String(err));
    if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('fetch failed')) {
      return 'No se pudo conectar con el servidor backend. Verifica que el servidor esté activo.';
    }
    return msg;
  }

  function openCreateModal() {
    setCreateForm({
      nombre: '',
      tipo: 'ZONA',
      fechaProgramada: getTodayLocalDate(),
      asignadoA: '',
      notas: '',
      zonaId: '',
      ubicacionId: '',
      skuId: '',
    });
    setMsg({ type: '', text: '' });
    setShowCreateModal(true);
  }

  // Helper to parse line notes and determine operational status
  function parseLineNotes(line: any): any {
    try {
      if (line.notas && typeof line.notas === 'string' && line.notas.startsWith('{')) {
        return JSON.parse(line.notas);
      }
    } catch {}
    return {};
  }

  function getLineLocationCode(line: any): string {
    const parsed = parseLineNotes(line);
    if (parsed.ubicacionCodigo) return parsed.ubicacionCodigo;
    if (line.ubicacionId) {
      const loc = locations.find(l => l.id === line.ubicacionId);
      if (loc) return loc.codigo;
      return line.ubicacionId.substring(0, 8);
    }
    return 'SIN UBICACIÓN';
  }

  function getLineClientName(line: any): string {
    const parsed = parseLineNotes(line);
    if (parsed.clienteNombre) return parsed.clienteNombre;
    if (line.clienteNombre) return line.clienteNombre;
    if (locations && locations.length > 0 && line.ubicacionId) {
      const loc = locations.find(l => l.id === line.ubicacionId);
      const matchLot = loc?.lotes?.find((lt: any) => lt.skuId === line.skuId && (!line.lote || lt.lote === line.lote));
      if (matchLot?.cliente?.nombreComercial) return matchLot.cliente.nombreComercial;
      if (matchLot?.cliente?.razonSocial) return matchLot.cliente.razonSocial;
    }
    if (skus && skus.length > 0 && line.skuId) {
      const skuObj = skus.find(s => s.id === line.skuId);
      if (skuObj?.cliente?.nombreComercial) return skuObj.cliente.nombreComercial;
      if (skuObj?.cliente?.razonSocial) return skuObj.cliente.razonSocial;
    }
    return 'Sin depositante';
  }

  function getLineEvaluation(line: any): {
    status: 'COINCIDE' | 'DIFERENCIA_AJUSTABLE' | 'REQUIERE_CONCILIACION_HU' | 'BLOQUEADO_POR_PROCESO' | 'SALDO_AMBIGUO' | 'SOBRANTE_NO_IDENTIFICADO';
    label: string;
    badgeClass: string;
    isBlocked: boolean;
    reason?: string;
  } {
    const parsed = parseLineNotes(line);
    const diff = (line.cantidadFisica !== null && line.cantidadFisica !== undefined)
      ? Number(line.cantidadFisica) - Number(line.cantidadSistema)
      : (line.discrepancia ?? 0);

    const state = parsed.estadoConciliacion || parsed.bloqueoInicial;
    const blockReason = parsed.motivoBloqueo;

    if (state === 'BLOQUEADO_POR_PROCESO' || (diff !== 0 && parsed.reservado > 0)) {
      return {
        status: 'BLOQUEADO_POR_PROCESO',
        label: 'BLOQUEADO POR RESERVA/PROCESO',
        badgeClass: 'badge-danger',
        isBlocked: true,
        reason: blockReason || `Inventario comprometido (${parsed.reservado || 0} pza reservadas)`,
      };
    }

    if (state === 'REQUIERE_CONCILIACION_HU' || (diff !== 0 && parsed.tieneHUs)) {
      return {
        status: 'REQUIERE_CONCILIACION_HU',
        label: 'REQUIERE CONCILIACIÓN HU',
        badgeClass: 'badge-purple',
        isBlocked: true,
        reason: blockReason || `Ubicación gestionada con ${parsed.huCount || 'múltiples'} HandlingUnits físicas`,
      };
    }

    if (state === 'SALDO_AMBIGUO' || state === 'SALDO_AMBIGUO_MULTI_CLIENTE' || state === 'SALDO_AMBIGUO_MULTI_LOTE') {
      return {
        status: 'SALDO_AMBIGUO',
        label: 'SALDO AMBIGUO',
        badgeClass: 'badge-warning',
        isBlocked: true,
        reason: blockReason || 'Múltiples partidas encontradas para la misma posición',
      };
    }

    if (state === 'SOBRANTE_NO_IDENTIFICADO') {
      return {
        status: 'SOBRANTE_NO_IDENTIFICADO',
        label: 'SOBRANTE NO IDENTIFICADO',
        badgeClass: 'badge-danger',
        isBlocked: true,
        reason: blockReason || 'Excedente físico sin partida de lote canónico en la posición',
      };
    }

    if (diff === 0) {
      return {
        status: 'COINCIDE',
        label: 'COINCIDE',
        badgeClass: 'badge-success',
        isBlocked: false,
      };
    }

    return {
      status: 'DIFERENCIA_AJUSTABLE',
      label: 'DIFERENCIA AJUSTABLE',
      badgeClass: 'badge-info',
      isBlocked: false,
      reason: 'Diferencia en partida legacy no comprometida apta para ajuste directo',
    };
  }

  // Safe Cancel for PROGRAMADO counts (No physical delete)
  async function handleCancelCount(id: string) {
    try {
      const res = await fetch(`${API}/cycle-counts/${id}`, {
        method: 'DELETE',
        headers,
      });
      if (!res.ok) throw new Error((await res.json()).message || 'Error al cancelar');
      setMsg({ type: 'success', text: 'Conteo programado cancelado de forma segura en bitácora' });
      if (activeCount?.id === id) {
        setPhase('list');
        setActiveCount(null);
      }
      setCancelConfirmId(null);
      loadData();
    } catch (err: any) {
      setMsg({ type: 'error', text: formatErrorMessage(err) });
      setCancelConfirmId(null);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setMsg({ type: '', text: '' });
    if (!createForm.nombre || !createForm.fechaProgramada) {
      setMsg({ type: 'error', text: 'Nombre y fecha son obligatorios' });
      return;
    }
    if (createForm.tipo === 'ZONA' && !createForm.zonaId) {
      setMsg({ type: 'error', text: 'Por favor selecciona la Zona a contar' });
      return;
    }
    if (createForm.tipo === 'UBICACION' && !createForm.ubicacionId) {
      setMsg({ type: 'error', text: 'Por favor selecciona la Ubicación a contar' });
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`${API}/cycle-counts`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...createForm, almacenId: warehouse?.id }),
      });
      if (!res.ok) throw new Error((await res.json()).message || 'Error al crear');
      const result = await res.json();
      setShowCreateModal(false);
      setStatusFilter('PROGRAMADO');
      const linesCount = result.lineas?.length || 0;
      setMsg({
        type: 'success',
        text: `Conteo ${result.codigo} programado exitosamente con ${pluralize(linesCount, 'línea granular', 'líneas granulares')}`,
      });
      loadData();
      setTimeout(() => { setMsg({ type: '', text: '' }); }, 4000);
    } catch (err: any) {
      setMsg({ type: 'error', text: formatErrorMessage(err) });
    }
    setSubmitting(false);
  }

  // Start counting: BLIND COUNT PROTOCOL
  function startCounting(cc: any, mode: 'manual' | 'scan' = 'manual') {
    setActiveCount(cc);
    const initial: Record<string, number | ''> = {};
    if (mode === 'manual') {
      cc.lineas?.forEach((l: any) => {
        initial[l.id] = (l.cantidadFisica !== null && l.cantidadFisica !== undefined) ? l.cantidadFisica : '';
      });
    } else {
      cc.lineas?.forEach((l: any) => { initial[l.id] = 0; });
    }
    setPhysicalCounts(initial);
    setScanLog([]);
    setLastScan(null);
    setTotalScans(0);
    setScanError('');
    setPhase(mode === 'scan' ? 'scan' : 'count');
    setMsg({ type: '', text: '' });
    setTimeout(() => scanRef.current?.focus(), 200);
  }

  // Handle barcode scan (Zebra TC22)
  const handleScanSubmit = useCallback((barcode: string) => {
    if (!activeCount || !barcode.trim()) return;
    const code = barcode.trim().toUpperCase();

    const line = activeCount.lineas?.find((l: any) =>
      l.sku?.codigo?.toUpperCase() === code
    );

    if (!line) {
      setScanError(`SKU "${code}" no asignado a este conteo`);
      playBeep(false);
      vibrate(300);
      setTimeout(() => setScanError(''), 3000);
      setScanInput('');
      scanRef.current?.focus();
      return;
    }

    setPhysicalCounts(prev => ({
      ...prev,
      [line.id]: (Number(prev[line.id]) || 0) + 1,
    }));

    const newCount = (Number(physicalCounts[line.id]) || 0) + 1;
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

    const uncaptured = activeCount.lineas?.filter((l: any) => {
      const val = physicalCounts[l.id];
      return val === '' || val === undefined || val === null;
    });

    if (uncaptured && uncaptured.length > 0 && phase === 'count') {
      setMsg({
        type: 'error',
        text: `Debes capturar el conteo físico de todas las líneas (${uncaptured.length} pendiente(s)). Ingresa 0 si la posición está físicamente vacía.`
      });
      return;
    }

    setSubmitting(true);
    setMsg({ type: '', text: '' });
    try {
      const lineas = activeCount.lineas.map((l: any) => ({
        id: l.id,
        cantidadFisica: Number(physicalCounts[l.id] ?? 0),
        cantidadSistema: l.cantidadSistema,
      }));
      const res = await fetch(`${API}/cycle-counts/${activeCount.id}/count`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ lineas, usuario: user?.email }),
      });
      if (!res.ok) throw new Error((await res.json()).message || 'Error al registrar conteo');
      setMsg({ type: 'success', text: 'Conteo físico registrado. Procediendo a la fase de Revisión y Conciliación.' });
      
      const ccRes = await fetch(`${API}/cycle-counts`, { headers });
      if (ccRes.ok) {
        const all = await ccRes.json();
        setCounts(all);
        const updated = all.find((c: any) => c.id === activeCount.id);
        if (updated) setActiveCount(updated);
      }
      setPhase('review');
    } catch (err: any) { setMsg({ type: 'error', text: formatErrorMessage(err) }); }
    setSubmitting(false);
  }

  async function finalizeCount() {
    if (!activeCount) return;
    setSubmitting(true);
    setMsg({ type: '', text: '' });
    try {
      const res = await fetch(`${API}/cycle-counts/${activeCount.id}/finalize`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ usuario: user?.email }),
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.message || 'Error al finalizar conteo');
      }
      const result = await res.json();
      setShowConfirmModal(false);
      setMsg({ type: 'success', text: result.message || 'Conteo finalizado exitosamente' });
      loadData();
      setTimeout(() => { setPhase('list'); setActiveCount(null); setMsg({ type: '', text: '' }); }, 3000);
    } catch (err: any) {
      setMsg({ type: 'error', text: formatErrorMessage(err) });
      setShowConfirmModal(false);
    }
    setSubmitting(false);
  }

  // Filter counts by search and status tab
  const filtered = counts.filter(c => {
    const matchesSearch = !search ||
      c.codigo?.toLowerCase().includes(search.toLowerCase()) ||
      c.nombre?.toLowerCase().includes(search.toLowerCase());

    if (!matchesSearch) return false;

    if (statusFilter === 'TODOS') return true;
    if (statusFilter === 'PROGRAMADO') return c.estado === 'PROGRAMADO';
    if (statusFilter === 'EN_PROGRESO') return c.estado === 'EN_PROGRESO';
    if (statusFilter === 'COMPLETADO') return c.estado === 'COMPLETADO' || c.estado === 'CERRADO';
    if (statusFilter === 'CANCELADO') return c.estado === 'CANCELADO';
    return true;
  });

  const estadoBadge = (e: string) => {
    switch (e) {
      case 'PROGRAMADO': return 'info';
      case 'EN_PROGRESO': return 'warning';
      case 'COMPLETADO':
      case 'CERRADO': return 'success';
      case 'CANCELADO': return 'danger';
      default: return 'default';
    }
  };

  // ==========================================
  // SCAN MODE (Zebra TC22 optimized — Blind Count)
  // ==========================================
  if (phase === 'scan' && activeCount) {
    const scannedSkus = activeCount.lineas?.filter((l: any) => (Number(physicalCounts[l.id]) || 0) > 0).length || 0;
    const totalLines = activeCount.lineas?.length || 0;
    const progress = totalLines > 0 ? Math.round((scannedSkus / totalLines) * 100) : 0;

    return (
      <div className="scan-mode">
        <div className="scan-topbar">
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{activeCount.codigo}</div>
            <div style={{ fontSize: 12, opacity: 0.8 }}>{activeCount.nombre} · Conteo Ciego Zebra</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-sm btn-ghost" style={{ color: 'white', borderColor: 'rgba(255,255,255,0.3)' }} onClick={() => { setPhase('list'); setActiveCount(null); }}><X size={14} /></button>
          </div>
        </div>

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

        {lastScan && (
          <div className="scan-result scan-result-success">
            <div className="scan-result-icon"><CheckCircle size={24} color="var(--emerald)" /></div>
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

        <div className="scan-progress-section">
          <div className="scan-progress-header">
            <span>{scannedSkus}/{totalLines} SKUs escaneados</span>
            <span>{totalScans} escaneos totales</span>
          </div>
          <div className="scan-progress-bar">
            <div className="scan-progress-fill" style={{ width: `${progress}%` }}></div>
          </div>
        </div>

        <div className="scan-summary">
          <div className="scan-summary-title">Líneas de Conteo Ciego</div>
          {activeCount.lineas?.map((l: any) => {
            const counted = Number(physicalCounts[l.id]) || 0;
            const locCode = getLineLocationCode(l);
            return (
              <div key={l.id} className={`scan-line ${counted > 0 ? 'scanned' : ''}`}>
                <div className="scan-line-info">
                  <code>{l.sku?.codigo}</code>
                  <span className="scan-line-desc">{l.sku?.descripcion}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-tertiary)', marginLeft: 8 }}>
                    <MapPin size={11} style={{ verticalAlign: 'middle', marginRight: 2 }} />
                    {locCode}
                  </span>
                </div>
                <div className="scan-line-counts">
                  <span className={`scan-line-physical ${counted > 0 ? 'active' : ''}`}>
                    Físico: {counted}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

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

        <div className="scan-actions">
          <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => startCounting(activeCount, 'manual')}>
            Modo Manual
          </button>
          <button className="btn btn-primary" style={{ flex: 2 }} onClick={savePhysicalCounts} disabled={submitting}>
            {submitting ? 'Guardando...' : `Finalizar Escaneo (${totalScans} scans)`}
          </button>
        </div>
      </div>
    );
  }

  // ==========================================
  // MANUAL COUNT — CONTEO CIEGO OPERATIVO
  // ==========================================
  if (phase === 'count' && activeCount) {
    const totalLines = activeCount.lineas?.length || 0;
    const capturedCount = activeCount.lineas?.filter((l: any) => physicalCounts[l.id] !== '' && physicalCounts[l.id] !== undefined && physicalCounts[l.id] !== null).length || 0;

    return (
      <div className="page-container">
        <div className="page-header">
          <div>
            <h1 className="page-title">Captura Física — {activeCount.codigo}</h1>
            <p className="page-subtitle">{activeCount.nombre} · {pluralize(totalLines, 'posición a verificar', 'posiciones a verificar')}</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-ghost" onClick={() => { setPhase('list'); setActiveCount(null); }}>Cancelar</button>
            <button className="btn btn-secondary" onClick={() => startCounting(activeCount, 'scan')}><Scan size={16} /> Modo Escáner</button>
            <button className="btn btn-primary" onClick={savePhysicalCounts} disabled={submitting}>
              {submitting ? <><RefreshCw size={14} className="animate-spin" /> Guardando...</> : <><Check size={16} /> Registrar y Revisar</>}
            </button>
          </div>
        </div>

        {/* PROTOCOLO CONTEO CIEGO BANNER */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', background: 'rgba(59, 130, 246, 0.08)', borderRadius: 8, fontSize: 13, color: 'var(--accent-primary)', border: '1px solid rgba(59, 130, 246, 0.2)', marginBottom: 16 }}>
          <EyeOff size={18} style={{ flexShrink: 0 }} />
          <div>
            <strong>Protocolo de Conteo Ciego Activo:</strong> La cantidad teórica del sistema y el cálculo de discrepancias se mantienen ocultos durante la captura física para garantizar la imparcialidad del auditor. Las discrepancias y evaluaciones se presentarán en la fase de Revisión y Conciliación.
          </div>
        </div>

        {msg.text && <div className={`form-message ${msg.type === 'error' ? 'form-error-msg' : 'form-success-msg'}`} style={{ marginBottom: 16 }}>{msg.text}</div>}

        <div className="card">
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Ubicación</th>
                  <th>Lote</th>
                  <th>SKU</th>
                  <th>Descripción</th>
                  <th style={{ textAlign: 'center', background: 'var(--accent-primary-soft)', minWidth: 150 }}>
                    Cantidad Física Contada
                  </th>
                </tr>
              </thead>
              <tbody>
                {activeCount.lineas?.map((l: any, i: number) => {
                  const physicalVal = physicalCounts[l.id] ?? '';
                  const locCode = getLineLocationCode(l);
                  const parsed = parseLineNotes(l);

                  return (
                    <tr key={l.id} className="animate-fade-in" style={{ animationDelay: `${i * 0.02}s` }}>
                      <td style={{ fontWeight: 600, color: 'var(--text-tertiary)' }}>{i + 1}</td>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 600 }}>
                          <MapPin size={13} color="var(--accent-primary)" />
                          {locCode}
                        </span>
                      </td>
                      <td>
                        <span style={{ fontSize: 12, color: l.lote ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                          {l.lote || '(Sin lote)'}
                        </span>
                        {(() => {
                          const cName = getLineClientName(l);
                          return cName !== 'Sin depositante' ? (
                            <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{cName}</div>
                          ) : null;
                        })()}
                      </td>
                      <td>
                        <code style={{ fontSize: 12, background: 'var(--bg-secondary)', padding: '2px 6px', borderRadius: 4 }}>
                          {l.sku?.codigo}
                        </code>
                      </td>
                      <td style={{ fontWeight: 500, whiteSpace: 'normal', minWidth: 180 }}>
                        {l.sku?.descripcion}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <input
                          className="form-input"
                          type="number"
                          min="0"
                          placeholder="—"
                          value={physicalVal}
                          onChange={e => {
                            const val = e.target.value === '' ? '' : Math.max(0, parseInt(e.target.value, 10) || 0);
                            setPhysicalCounts(prev => ({ ...prev, [l.id]: val }));
                          }}
                          style={{ width: 110, textAlign: 'center', fontWeight: 700, fontSize: 16, margin: '0 auto', display: 'block' }}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
            <span style={{ color: 'var(--text-tertiary)' }}>{pluralize(totalLines, 'línea total', 'líneas totales')}</span>
            <span>
              Capturadas: <strong>{capturedCount}</strong> de <strong>{totalLines}</strong>
            </span>
          </div>
        </div>
      </div>
    );
  }

  // ==========================================
  // REVIEW PHASE — AUDITORÍA Y CONCILIACIÓN
  // ==========================================
  if (phase === 'review' && activeCount) {
    const evaluations = (activeCount.lineas || []).map((l: any) => ({
      line: l,
      eval: getLineEvaluation(l),
    }));

    const totalLines = evaluations.length;
    const matchedLines = evaluations.filter((e: any) => e.eval.status === 'COINCIDE').length;
    const diffLines = evaluations.filter((e: any) => e.eval.status !== 'COINCIDE').length;
    const adjustableLines = evaluations.filter((e: any) => e.eval.status === 'DIFERENCIA_AJUSTABLE').length;
    const blockedLines = evaluations.filter((e: any) => e.eval.isBlocked).length;
    const hasUncounted = activeCount.lineas?.some((l: any) => l.cantidadFisica === null || l.cantidadFisica === undefined);

    const canFinalizeNow = isSupervisorOrAdmin && blockedLines === 0 && !hasUncounted && activeCount.estado === 'EN_PROGRESO';

    return (
      <div className="page-container">
        <div className="page-header">
          <div>
            <h1 className="page-title">Revisión y Conciliación — {activeCount.codigo}</h1>
            <p className="page-subtitle">
              {pluralize(diffLines, 'discrepancia detectada', 'discrepancias detectadas')} · {blockedLines > 0 ? pluralize(blockedLines, 'línea bloqueada por seguridad WMS', 'líneas bloqueadas por seguridad WMS') : 'Auditoría lista para conciliar'}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-ghost" onClick={() => { setPhase('list'); setActiveCount(null); }}>Volver a Lista</button>
            <button className="btn btn-warning" onClick={() => startCounting(activeCount, 'manual')}>Re-contar Posiciones</button>
            <button
              className="btn btn-success"
              onClick={() => setShowConfirmModal(true)}
              disabled={!canFinalizeNow || submitting}
              title={
                !isSupervisorOrAdmin
                  ? 'Se requiere rol Supervisor o Administrador para conciliar inventario real'
                  : blockedLines > 0
                  ? 'Bloqueado: Existen líneas con incidencias de HUs o reservas que no pueden ajustarse automáticamente'
                  : hasUncounted
                  ? 'Faltan líneas por contar'
                  : adjustableLines > 0
                  ? 'Finalizar y conciliar inventario con ajustes'
                  : 'Finalizar conteo sin variaciones de inventario'
              }
            >
              {submitting
                ? 'Procesando...'
                : (adjustableLines === 0 && blockedLines === 0)
                ? 'Finalizar Conteo'
                : 'Finalizar y Ajustar Inventario'}
            </button>
          </div>
        </div>

        {msg.text && <div className={`form-message ${msg.type === 'error' ? 'form-error-msg' : 'form-success-msg'}`} style={{ marginBottom: 16 }}>{msg.text}</div>}

        {/* STATS SUMMARY */}
        <div className="stats-grid" style={{ marginBottom: 20 }}>
          <div className="stat-card">
            <div className="stat-icon" style={{ background: 'var(--info-soft)', color: 'var(--info)' }}><Package size={20} /></div>
            <div className="stat-info"><span className="stat-value">{totalLines}</span><span className="stat-label">Líneas contadas</span></div>
          </div>
          <div className="stat-card">
            <div className="stat-icon" style={{ background: 'var(--success-soft)', color: 'var(--success)' }}><CheckCircle size={20} /></div>
            <div className="stat-info"><span className="stat-value">{matchedLines}</span><span className="stat-label">Coinciden con Sistema</span></div>
          </div>
          <div className="stat-card">
            <div className="stat-icon" style={{ background: 'var(--info-soft)', color: 'var(--accent-primary)' }}><Boxes size={20} /></div>
            <div className="stat-info"><span className="stat-value">{adjustableLines}</span><span className="stat-label">Ajustes Viables</span></div>
          </div>
          <div className="stat-card">
            <div className="stat-icon" style={{ background: blockedLines > 0 ? 'var(--danger-soft)' : 'var(--bg-secondary)', color: blockedLines > 0 ? 'var(--danger)' : 'var(--text-tertiary)' }}>
              <ShieldAlert size={20} />
            </div>
            <div className="stat-info"><span className="stat-value" style={{ color: blockedLines > 0 ? 'var(--danger)' : undefined }}>{blockedLines}</span><span className="stat-label">Bloqueadas / Revisión</span></div>
          </div>
        </div>

        {/* SECURITY ADVISORY BANNER */}
        {blockedLines > 0 ? (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '14px 18px', background: 'rgba(239, 68, 68, 0.08)', borderRadius: 10, fontSize: 13, color: 'var(--danger)', border: '1px solid rgba(239, 68, 68, 0.25)', marginBottom: 20 }}>
            <Lock size={20} style={{ flexShrink: 0, marginTop: 2 }} />
            <div>
              <strong>Finalización Bloqueada por Seguridad WMS:</strong> Se identificaron {pluralize(blockedLines, 'línea', 'líneas')} en posiciones gestionadas por HandlingUnits físicas, con reservas de pedidos activos o saldos ambiguos.
              <div style={{ marginTop: 4, color: 'var(--text-secondary)' }}>
                Por política de inalterabilidad, el sistema NO aplicará ajustes escalares automáticos a estas partidas. El conteo se conserva <strong>EN_PROGRESO</strong> hasta resolver las incidencias con supervisión operativa.
              </div>
            </div>
          </div>
        ) : !isSupervisorOrAdmin ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', background: 'var(--warning-soft)', borderRadius: 8, fontSize: 13, color: 'var(--warning)', border: '1px solid rgba(245, 158, 11, 0.25)', marginBottom: 20 }}>
            <AlertCircle size={18} style={{ flexShrink: 0 }} />
            <div>
              <strong>Permiso Requerido:</strong> Tienes perfil de captura física. La autorización final y aplicación de ajustes en inventario real está restringida a roles de <strong>Supervisor</strong> o <strong>Administrador</strong>.
            </div>
          </div>
        ) : null}

        {/* REVIEW TABLE */}
        <div className="card">
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Lote / Depositante</th>
                  <th>Ubicación</th>
                  <th style={{ textAlign: 'right' }}>Sistema</th>
                  <th style={{ textAlign: 'right' }}>Físico</th>
                  <th style={{ textAlign: 'right' }}>Diferencia</th>
                  <th>Estado de Conciliación</th>
                </tr>
              </thead>
              <tbody>
                {evaluations.map(({ line: l, eval: ev }: any, i: number) => {
                  const diff = (l.cantidadFisica !== null && l.cantidadFisica !== undefined)
                    ? Number(l.cantidadFisica) - Number(l.cantidadSistema)
                    : (l.discrepancia ?? 0);
                  const locCode = getLineLocationCode(l);
                  const parsed = parseLineNotes(l);

                  return (
                    <tr
                      key={l.id}
                      className="animate-fade-in"
                      style={{
                        animationDelay: `${i * 0.02}s`,
                        background: ev.isBlocked
                          ? 'rgba(239, 68, 68, 0.04)'
                          : diff !== 0
                          ? 'rgba(14, 165, 233, 0.03)'
                          : undefined,
                      }}
                    >
                      <td>
                        <code style={{ fontSize: 12, background: 'var(--bg-secondary)', padding: '2px 6px', borderRadius: 4 }}>
                          {l.sku?.codigo}
                        </code>
                        <div style={{ fontWeight: 500, fontSize: 13, marginTop: 2, whiteSpace: 'normal', minWidth: 160 }}>
                          {l.sku?.descripcion}
                        </div>
                      </td>
                      <td>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{l.lote || '(Sin lote)'}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{getLineClientName(l)}</div>
                      </td>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 600 }}>
                          <MapPin size={13} color="var(--accent-primary)" />
                          {locCode}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{l.cantidadSistema}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700 }}>{l.cantidadFisica ?? '—'}</td>
                      <td style={{ textAlign: 'right' }}>
                        {diff !== 0 ? (
                          <span style={{ fontWeight: 700, color: diff > 0 ? 'var(--emerald)' : 'var(--danger)' }}>
                            {diff > 0 ? '+' : ''}{diff}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--text-muted)' }}>0</span>
                        )}
                      </td>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                          <span className={`badge ${ev.badgeClass}`} style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px' }}>
                            {ev.label}
                          </span>
                          {ev.reason && (
                            <span style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.2 }}>
                              {ev.reason}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* MODAL CONFIRMAR FINALIZAR CONTEO CÍCLICO */}
        {/* MODAL CONFIRMAR FINALIZAR CONTEO CÍCLICO */}
        {showConfirmModal && (
          <div className="modal-overlay" onClick={() => !submitting && setShowConfirmModal(false)}>
            <div
              className="modal-content animate-scale-in"
              onClick={e => e.stopPropagation()}
              style={{
                maxWidth: 620,
                width: '92%',
                padding: 0,
                overflow: 'hidden',
                borderRadius: 14,
                backgroundColor: '#FFFFFF',
                border: '1px solid var(--border, #E2E8F0)',
                boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
              }}
            >
              {/* Header con fondo blanco limpio */}
              <div
                style={{
                  backgroundColor: '#FFFFFF',
                  padding: '20px 24px',
                  borderBottom: '1px solid var(--border, #E2E8F0)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 10,
                      backgroundColor: (adjustableLines === 0 && blockedLines === 0)
                        ? 'rgba(16, 185, 129, 0.1)'
                        : 'rgba(59, 130, 246, 0.1)',
                      color: (adjustableLines === 0 && blockedLines === 0)
                        ? 'var(--emerald, #10B981)'
                        : 'var(--accent-primary, #2563EB)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      border: (adjustableLines === 0 && blockedLines === 0)
                        ? '1px solid rgba(16, 185, 129, 0.25)'
                        : '1px solid rgba(59, 130, 246, 0.25)',
                    }}
                  >
                    {adjustableLines === 0 && blockedLines === 0 ? <CheckCircle size={22} /> : <Boxes size={22} />}
                  </div>
                  <div>
                    <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--text-primary, #0F172A)' }}>
                      {adjustableLines === 0 && blockedLines === 0
                        ? 'Finalizar Conteo Cíclico'
                        : 'Confirmar Conciliación de Inventario'}
                    </h3>
                    <p style={{ margin: '2px 0 0 0', fontSize: 13, color: 'var(--text-secondary, #64748B)' }}>
                      Conteo Cíclico: <strong style={{ color: 'var(--accent-primary, #2563EB)' }}>{activeCount.codigo}</strong>
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setShowConfirmModal(false)}
                  disabled={submitting}
                  style={{ padding: 6, borderRadius: 6, color: 'var(--text-secondary, #64748B)' }}
                >
                  <X size={18} />
                </button>
              </div>

              {/* Body */}
              <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
                {adjustableLines === 0 && blockedLines === 0 ? (
                  <div
                    style={{
                      padding: '14px 16px',
                      backgroundColor: 'rgba(16, 185, 129, 0.05)',
                      border: '1px solid rgba(16, 185, 129, 0.2)',
                      borderRadius: 10,
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 12,
                      fontSize: 13,
                      lineHeight: 1.5,
                      color: 'var(--text-primary, #0F172A)',
                    }}
                  >
                    <CheckCircle size={18} style={{ color: 'var(--emerald, #10B981)', flexShrink: 0, marginTop: 2 }} />
                    <div>
                      <strong style={{ color: 'var(--emerald, #059669)', fontWeight: 700 }}>Cierre de Conteo sin Variaciones:</strong><br />
                      <span style={{ color: 'var(--text-secondary, #475569)' }}>
                        Todas las partidas físicas coinciden exactamente con el sistema (Diferencia = 0). No se generarán movimientos de Kárdex ni ajustes de existencias. El conteo pasará a estado inmutable <strong>COMPLETADO</strong>.
                      </span>
                    </div>
                  </div>
                ) : (
                  <div
                    style={{
                      padding: '14px 16px',
                      backgroundColor: 'rgba(59, 130, 246, 0.05)',
                      border: '1px solid rgba(59, 130, 246, 0.2)',
                      borderRadius: 10,
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 12,
                      fontSize: 13,
                      lineHeight: 1.5,
                      color: 'var(--text-primary, #0F172A)',
                    }}
                  >
                    <Boxes size={18} style={{ color: 'var(--accent-primary, #2563EB)', flexShrink: 0, marginTop: 2 }} />
                    <div>
                      <strong style={{ color: 'var(--accent-primary, #2563EB)', fontWeight: 700 }}>Transacción de Conciliación WMS Segura:</strong><br />
                      <span style={{ color: 'var(--text-secondary, #475569)' }}>
                        Se registrarán movimientos de Kárdex auditados (<code>AJUSTE_ENTRADA</code> / <code>AJUSTE_SALIDA</code>) para partidas conciliables. El conteo pasará a estado inmutable <strong>COMPLETADO</strong>.
                      </span>
                    </div>
                  </div>
                )}

                {/* Resumen métricas mini-WMS */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, 1fr)',
                    gap: 12,
                  }}
                >
                  <div
                    style={{
                      backgroundColor: 'var(--bg-secondary, #F8FAFC)',
                      padding: '14px 16px',
                      borderRadius: 10,
                      textAlign: 'center',
                      border: '1px solid var(--border, #E2E8F0)',
                    }}
                  >
                    <div style={{ fontSize: 11, color: 'var(--text-tertiary, #64748B)', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.04em' }}>Líneas</div>
                    <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4, color: 'var(--text-primary, #0F172A)' }}>{totalLines}</div>
                  </div>
                  <div
                    style={{
                      backgroundColor: 'var(--bg-secondary, #F8FAFC)',
                      padding: '14px 16px',
                      borderRadius: 10,
                      textAlign: 'center',
                      border: '1px solid var(--border, #E2E8F0)',
                    }}
                  >
                    <div style={{ fontSize: 11, color: 'var(--text-tertiary, #64748B)', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.04em' }}>Ajustes</div>
                    <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4, color: adjustableLines > 0 ? 'var(--accent-primary, #2563EB)' : 'var(--text-secondary, #64748B)' }}>
                      {adjustableLines}
                    </div>
                  </div>
                  <div
                    style={{
                      backgroundColor: 'var(--bg-secondary, #F8FAFC)',
                      padding: '14px 16px',
                      borderRadius: 10,
                      textAlign: 'center',
                      border: '1px solid var(--border, #E2E8F0)',
                    }}
                  >
                    <div style={{ fontSize: 11, color: 'var(--text-tertiary, #64748B)', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.04em' }}>Bloqueadas</div>
                    <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4, color: blockedLines > 0 ? 'var(--danger, #EF4444)' : 'var(--emerald, #10B981)' }}>
                      {blockedLines}
                    </div>
                  </div>
                </div>

                <p style={{ fontSize: 13, color: 'var(--text-secondary, #64748B)', margin: 0, textAlign: 'center' }}>
                  {adjustableLines === 0 && blockedLines === 0
                    ? '¿Deseas finalizar este conteo cíclico exitoso sin variaciones?'
                    : '¿Deseas aplicar los ajustes bajo protocolo atómico de concurrencia?'}
                </p>
              </div>

              {/* Footer blanco limpio */}
              <div
                style={{
                  padding: '16px 24px',
                  backgroundColor: '#FFFFFF',
                  borderTop: '1px solid var(--border, #E2E8F0)',
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: 10,
                }}
              >
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowConfirmModal(false)}
                  disabled={submitting}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  className="btn btn-success"
                  onClick={finalizeCount}
                  disabled={submitting}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}
                >
                  {submitting ? (
                    <>
                      <RefreshCw size={16} className="animate-spin" /> Finalizando...
                    </>
                  ) : (
                    <>
                      <Check size={16} /> {adjustableLines === 0 && blockedLines === 0 ? 'Finalizar Conteo' : 'Confirmar y Ajustar'}
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ==========================================
  // LIST VIEW — CONTEOS CÍCLICOS
  // ==========================================
  const countsProgramados = counts.filter(c => c.estado === 'PROGRAMADO').length;
  const countsEnProgreso = counts.filter(c => c.estado === 'EN_PROGRESO').length;
  const countsCompletados = counts.filter(c => c.estado === 'COMPLETADO' || c.estado === 'CERRADO').length;
  const countsCancelados = counts.filter(c => c.estado === 'CANCELADO').length;

  const selectedZone = zones.find(z => z.id === createForm.zonaId);
  const selectedLoc = locations.find(l => l.id === createForm.ubicacionId);
  const selectedSkuObj = skus.find(s => s.id === createForm.skuId);

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Conteo Cíclico</h1>
          <p className="page-subtitle">
            {pluralize(counts.length, 'conteo', 'conteos')} · {pluralize(countsProgramados, 'programado', 'programados')} · {countsEnProgreso} en progreso
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" onClick={openCreateModal}>
            <Plus size={16} /> Nuevo Conteo
          </button>
          <button className="btn btn-secondary" onClick={loadData}>
            <RefreshCw size={16} /> Actualizar
          </button>
        </div>
      </div>

      {msg.text && <div className={`form-message ${msg.type === 'error' ? 'form-error-msg' : 'form-success-msg'}`} style={{ marginBottom: 16 }}>{msg.text}</div>}

      {/* TABS DE ESTADO */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, borderBottom: '1px solid var(--border)', paddingBottom: 8, overflowX: 'auto' }}>
        <button
          className={`btn btn-sm ${statusFilter === 'TODOS' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setStatusFilter('TODOS')}
        >
          Todos ({counts.length})
        </button>
        <button
          className={`btn btn-sm ${statusFilter === 'PROGRAMADO' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setStatusFilter('PROGRAMADO')}
        >
          Programados ({countsProgramados})
        </button>
        <button
          className={`btn btn-sm ${statusFilter === 'EN_PROGRESO' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setStatusFilter('EN_PROGRESO')}
        >
          En Proceso ({countsEnProgreso})
        </button>
        <button
          className={`btn btn-sm ${statusFilter === 'COMPLETADO' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setStatusFilter('COMPLETADO')}
        >
          Completados / Histórico ({countsCompletados})
        </button>
        <button
          className={`btn btn-sm ${statusFilter === 'CANCELADO' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setStatusFilter('CANCELADO')}
        >
          Cancelados ({countsCancelados})
        </button>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 12, padding: '16px 20px' }}>
          <div className="search-box" style={{ flex: 1 }}>
            <Search size={16} />
            <input placeholder="Buscar por folio o nombre..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-secondary)' }}><RefreshCw className="animate-spin" size={24} /> Cargando...</div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {filtered.map((cc, i) => {
            const totalLineas = cc.lineas?.length || 0;
            const totalDiffs = cc.lineas?.filter((l: any) => l.discrepancia !== 0 && l.discrepancia !== null).length || 0;
            const isImmutable = cc.estado === 'COMPLETADO' || cc.estado === 'CERRADO';
            const isCancelled = cc.estado === 'CANCELADO';
            const isProgrammed = cc.estado === 'PROGRAMADO';
            const isInProgress = cc.estado === 'EN_PROGRESO';

            return (
              <div key={cc.id} className="card animate-fade-in" style={{ animationDelay: `${i * 0.04}s` }}>
                <div style={{ padding: '16px 20px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                        <span style={{ fontWeight: 700, fontSize: 15 }}>{cc.codigo}</span>
                        <span className={`badge badge-${estadoBadge(cc.estado)}`}>{cc.estado}</span>
                        <span className="badge badge-default">{cc.tipo}</span>
                        {isImmutable && (
                          <span style={{ fontSize: 11, color: 'var(--emerald)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <Lock size={12} /> Inmutable
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>{cc.nombre}</div>
                      <div style={{ display: 'flex', gap: 16, marginTop: 6, fontSize: 13, color: 'var(--text-secondary)' }}>
                        <span>Programado: {formatOperationalDate(cc.fechaProgramada)}</span>
                        <span>{pluralize(totalLineas, 'posición', 'posiciones')}</span>
                        {cc.asignadoA && <span>Asignado: {cc.asignadoA}</span>}
                        {totalDiffs > 0 && <span style={{ color: 'var(--danger)', fontWeight: 600 }}>{pluralize(totalDiffs, 'diferencia', 'diferencias')}</span>}
                        {cc.fechaCierre && <span>Cerrado: {new Date(cc.fechaCierre).toLocaleDateString('es-MX')}</span>}
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      {isProgrammed && (
                        <>
                          <button className="btn btn-sm btn-secondary" onClick={() => startCounting(cc, 'scan')} title="Escanear con Zebra"><Scan size={14} /> Escáner</button>
                          <button className="btn btn-sm btn-primary" onClick={() => startCounting(cc, 'manual')}>Captura Manual</button>
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => setCancelConfirmId(cc.id)}
                            title="Cancelar conteo programado"
                            style={{ color: 'var(--text-tertiary)' }}
                          >
                            <XCircle size={15} />
                          </button>
                        </>
                      )}

                      {isInProgress && (
                        <button className="btn btn-sm btn-warning" onClick={() => { setActiveCount(cc); setPhase('review'); setMsg({ type: '', text: '' }); }}>
                          Revisar y Conciliar
                        </button>
                      )}

                      <button className="btn btn-ghost btn-sm" onClick={() => setExpanded(expanded === cc.id ? null : cc.id)} title="Ver detalles de posiciones">
                        {expanded === cc.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </button>
                    </div>
                  </div>

                  {expanded === cc.id && (
                    <div style={{ marginTop: 12, padding: 12, background: 'var(--bg-secondary)', borderRadius: 8 }}>
                      <table className="data-table" style={{ fontSize: 13 }}>
                        <thead>
                          <tr>
                            <th>Ubicación</th>
                            <th>Lote</th>
                            <th>SKU</th>
                            <th>Descripción</th>
                            <th style={{ textAlign: 'right' }}>Sistema</th>
                            <th style={{ textAlign: 'right' }}>Físico</th>
                            <th style={{ textAlign: 'right' }}>Dif.</th>
                          </tr>
                        </thead>
                        <tbody>
                          {cc.lineas?.map((l: any) => {
                            const locCode = getLineLocationCode(l);
                            return (
                              <tr key={l.id}>
                                <td><code>{locCode}</code></td>
                                <td>
                                  <div style={{ fontWeight: 600 }}>{l.lote || '(Sin lote)'}</div>
                                  {(() => {
                                    const cName = getLineClientName(l);
                                    return cName !== 'Sin depositante' ? (
                                      <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{cName}</div>
                                    ) : null;
                                  })()}
                                </td>
                                <td><code>{l.sku?.codigo}</code></td>
                                <td>{l.sku?.descripcion}</td>
                                <td style={{ textAlign: 'right', fontWeight: 600 }}>{l.cantidadSistema}</td>
                                <td style={{ textAlign: 'right', fontWeight: 600 }}>{l.cantidadFisica ?? '—'}</td>
                                <td style={{ textAlign: 'right', fontWeight: 700, color: (l.discrepancia || 0) !== 0 ? 'var(--danger)' : 'var(--text-muted)' }}>
                                  {l.discrepancia ?? '—'}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div className="card">
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-tertiary)' }}>
                No se encontraron conteos cíclicos con los filtros seleccionados.
              </div>
            </div>
          )}
        </div>
      )}

      {/* MODAL AMPLIO: NUEVO CONTEO CÍCLICO */}
      {showCreateModal && (
        <div
          className="modal-overlay"
          onClick={() => !submitting && setShowCreateModal(false)}
          style={{ zIndex: 1100 }}
        >
          <div
            className="modal-content animate-scale-in"
            onClick={e => e.stopPropagation()}
            style={{
              maxWidth: 900,
              width: '92%',
              maxHeight: '90vh',
              overflowY: 'auto',
              padding: 0,
              borderRadius: 14,
              backgroundColor: '#FFFFFF',
              border: '1px solid var(--border, #E2E8F0)',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
            }}
          >
            <div
              style={{
                backgroundColor: '#FFFFFF',
                padding: '20px 24px',
                borderBottom: '1px solid var(--border, #E2E8F0)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 10,
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    color: 'var(--accent-primary, #2563EB)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: '1px solid rgba(59, 130, 246, 0.25)',
                  }}
                >
                  <ClipboardList size={22} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--text-primary, #0F172A)' }}>
                    Nuevo Conteo Cíclico
                  </h3>
                  <p style={{ margin: '2px 0 0 0', fontSize: 13, color: 'var(--text-secondary, #64748B)' }}>
                    Genera un snapshot granular seguro (SKU + Ubicación + Lote) para verificación física
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => !submitting && setShowCreateModal(false)}
                disabled={submitting}
                style={{ padding: 6, borderRadius: 6, color: 'var(--text-secondary, #64748B)' }}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreate}>
              <div style={{ padding: '24px' }}>
                <div className="form-row" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16, marginBottom: 16 }}>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label">Nombre del Conteo <span className="required">*</span></label>
                    <input
                      className="form-input"
                      placeholder="Ej: Conteo zona A - estanterías comerciales"
                      value={createForm.nombre}
                      onChange={e => setCreateForm(f => ({ ...f, nombre: e.target.value }))}
                      required
                      autoFocus
                    />
                  </div>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label">Tipo de Conteo <span className="required">*</span></label>
                    <select
                      className="form-select form-select-full"
                      value={createForm.tipo}
                      onChange={e => setCreateForm(f => ({ ...f, tipo: e.target.value, zonaId: '', ubicacionId: '', skuId: '' }))}
                    >
                      <option value="ZONA">Por Zona</option>
                      <option value="UBICACION">Por Ubicación</option>
                      <option value="SKU">Por SKU</option>
                      <option value="COMPLETO">Completo (Todo el almacén comercial)</option>
                    </select>
                  </div>
                </div>

                {/* Filtros dinámicos según el tipo seleccionado */}
                {createForm.tipo === 'ZONA' && (
                  <div className="form-group" style={{ marginBottom: 16 }}>
                    <label className="form-label">Seleccionar Zona a Contar <span className="required">*</span></label>
                    <select
                      className="form-select form-select-full"
                      value={createForm.zonaId}
                      onChange={e => setCreateForm(f => ({ ...f, zonaId: e.target.value }))}
                      required
                    >
                      <option value="">-- Selecciona la zona del almacén --</option>
                      {zones.map(z => (
                        <option key={z.id} value={z.id}>
                          {z.codigo} — {z.nombre} ({z._count?.locations || 0} ubicaciones)
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {createForm.tipo === 'UBICACION' && (
                  <div className="form-group" style={{ marginBottom: 16 }}>
                    <label className="form-label">Seleccionar Ubicación a Contar <span className="required">*</span></label>
                    <select
                      className="form-select form-select-full"
                      value={createForm.ubicacionId}
                      onChange={e => setCreateForm(f => ({ ...f, ubicacionId: e.target.value }))}
                      required
                    >
                      <option value="">-- Selecciona la posición / rack --</option>
                      {locations.map(loc => (
                        <option key={loc.id} value={loc.id}>
                          {loc.codigo} — Zona: {loc.zona?.codigo || 'General'}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {createForm.tipo === 'SKU' && (
                  <div className="form-group" style={{ marginBottom: 16 }}>
                    <label className="form-label">Seleccionar SKU Específico (Opcional)</label>
                    <select
                      className="form-select form-select-full"
                      value={createForm.skuId}
                      onChange={e => setCreateForm(f => ({ ...f, skuId: e.target.value }))}
                    >
                      <option value="">-- Todos los SKUs con inventario activo --</option>
                      {skus.map(s => (
                        <option key={s.id} value={s.id}>
                          {s.codigo} — {s.descripcion}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="form-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label">Fecha Programada <span className="required">*</span></label>
                    <input
                      className="form-input"
                      type="date"
                      value={createForm.fechaProgramada}
                      onChange={e => setCreateForm(f => ({ ...f, fechaProgramada: e.target.value }))}
                      required
                    />
                  </div>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label">Asignado a</label>
                    <input
                      className="form-input"
                      placeholder="Nombre del auditor responsable"
                      value={createForm.asignadoA}
                      onChange={e => setCreateForm(f => ({ ...f, asignadoA: e.target.value }))}
                    />
                  </div>
                </div>

                <div className="form-group" style={{ marginBottom: 16 }}>
                  <label className="form-label">Notas</label>
                  <input
                    className="form-input"
                    placeholder="Instrucciones o notas adicionales para auditoría"
                    value={createForm.notas}
                    onChange={e => setCreateForm(f => ({ ...f, notas: e.target.value }))}
                  />
                </div>

                {/* Banner Informativo Compacto */}
                <div
                  style={{
                    padding: '10px 14px',
                    background: 'var(--info-soft)',
                    borderRadius: 8,
                    fontSize: 12.5,
                    color: 'var(--info)',
                    border: '1px solid rgba(14,165,233,0.2)',
                    lineHeight: 1.45,
                  }}
                >
                  {createForm.tipo === 'ZONA' && (
                    <>
                      <strong>Snapshot por Zona:</strong> Se generarán líneas independientes por cada SKU + Ubicación + Lote en la {selectedZone ? <strong>Zona {selectedZone.codigo} ({selectedZone.nombre})</strong> : 'zona seleccionada'}. Se excluyen andenes de recepción y mermas.
                    </>
                  )}
                  {createForm.tipo === 'UBICACION' && (
                    <>
                      <strong>Snapshot por Ubicación:</strong> Se generará el conteo granular para la celda {selectedLoc ? <strong>{selectedLoc.codigo}</strong> : 'seleccionada'}.
                    </>
                  )}
                  {createForm.tipo === 'SKU' && (
                    <>
                      <strong>Snapshot por SKU:</strong> Se generará el conteo enfocado en {selectedSkuObj ? <strong>{selectedSkuObj.codigo} ({selectedSkuObj.descripcion})</strong> : 'los SKUs activos'}.
                    </>
                  )}
                  {createForm.tipo === 'COMPLETO' && (
                    <>
                      <strong>Snapshot Completo:</strong> Se incluirá la totalidad de racks y estantes con inventario en posiciones comerciales canónicas.
                    </>
                  )}
                </div>
              </div>

              <div
                style={{
                  padding: '16px 24px',
                  backgroundColor: '#FFFFFF',
                  borderTop: '1px solid var(--border, #E2E8F0)',
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: 10,
                }}
              >
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowCreateModal(false)}
                  disabled={submitting}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={submitting}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}
                >
                  {submitting ? (
                    <>
                      <RefreshCw size={15} className="animate-spin" /> Programando...
                    </>
                  ) : (
                    <>
                      <Plus size={16} /> Crear Conteo Cíclico
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL CONFIRMAR CANCELACIÓN DE CONTEO PROGRAMADO */}
      {cancelConfirmId && (
        <div className="modal-overlay" onClick={() => setCancelConfirmId(null)}>
          <div
            className="modal-content animate-scale-in"
            onClick={e => e.stopPropagation()}
            style={{
              maxWidth: 480,
              width: '92%',
              padding: 0,
              overflow: 'hidden',
              borderRadius: 14,
              backgroundColor: '#FFFFFF',
              border: '1px solid var(--border, #E2E8F0)',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
            }}
          >
            {/* Header con fondo blanco limpio */}
            <div
              style={{
                backgroundColor: '#FFFFFF',
                padding: '20px 24px',
                borderBottom: '1px solid var(--border, #E2E8F0)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 10,
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    color: 'var(--danger, #EF4444)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: '1px solid rgba(239, 68, 68, 0.25)',
                  }}
                >
                  <XCircle size={22} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--text-primary, #0F172A)' }}>
                    Cancelar Conteo Programado
                  </h3>
                  <p style={{ margin: '2px 0 0 0', fontSize: 13, color: 'var(--text-secondary, #64748B)' }}>
                    Operación de auditoría inmutable
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setCancelConfirmId(null)}
                style={{ padding: 6, borderRadius: 6, color: 'var(--text-secondary, #64748B)' }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Body */}
            <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
              <p style={{ margin: 0, fontSize: 14, color: 'var(--text-primary, #0F172A)', lineHeight: 1.5 }}>
                ¿Estás seguro de que deseas cancelar este conteo programado?
              </p>
              <div
                style={{
                  padding: '12px 14px',
                  backgroundColor: 'rgba(239, 68, 68, 0.05)',
                  border: '1px solid rgba(239, 68, 68, 0.2)',
                  borderRadius: 8,
                  fontSize: 13,
                  color: 'var(--text-secondary, #64748B)',
                  lineHeight: 1.5,
                }}
              >
                El conteo quedará registrado como <strong style={{ color: 'var(--danger, #DC2626)' }}>CANCELADO</strong> en la bitácora de auditoría sin realizar ningún borrado físico ni afectar saldos de inventario.
              </div>
            </div>

            {/* Footer blanco limpio */}
            <div
              style={{
                padding: '16px 24px',
                backgroundColor: '#FFFFFF',
                borderTop: '1px solid var(--border, #E2E8F0)',
                display: 'flex',
                justifyContent: 'flex-end',
                gap: 10,
              }}
            >
              <button type="button" className="btn btn-secondary" onClick={() => setCancelConfirmId(null)}>
                Volver
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => handleCancelCount(cancelConfirmId)}
                style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}
              >
                Confirmar Cancelación
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
