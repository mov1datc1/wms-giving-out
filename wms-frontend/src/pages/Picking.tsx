import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { API } from '../config/api';
import {
  Package, Search, RefreshCw, ChevronDown, ChevronUp, Clock, CheckCircle2,
  ScanLine, MapPin, Box, ArrowRight, AlertCircle, X, Layers, BarChart3, Target,
  Truck, ShieldCheck, UserCheck, CheckSquare, Sparkles, Send, PlayCircle,
  FileText, ShieldAlert
} from 'lucide-react';
import { DispatchManifestModal } from '../components/DispatchManifestModal';
import { useNavigate } from 'react-router-dom';

export function Picking() {
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<'queue' | 'active' | 'done'>('active');

  // Terminal de Picking Activo (1 Pedido por Surtidor)
  const [activeOrder, setActiveOrder] = useState<any>(null);
  const [pickingLines, setPickingLines] = useState<any[]>([]);
  const [selectedLineIdx, setSelectedLineIdx] = useState<number>(0);

  // Estados de Doble Validación por Escaneo
  const [locationScan, setLocationScan] = useState('');
  const [boxScan, setBoxScan] = useState('');
  const [locationVerified, setLocationVerified] = useState(false);
  const [scanFeedback, setScanFeedback] = useState<{
    type: 'success' | 'error' | 'warning';
    msg: string;
    step?: 'ubicacion' | 'caja';
  } | null>(null);

  // Modales integrados al diseño Giving Out (sin alert, confirm ni prompt nativos)
  const [takeoverDialog, setTakeoverDialog] = useState<{ message: string; order: any } | null>(null);
  const [adjustmentModal, setAdjustmentModal] = useState<{
    taskIdx: number;
    targetQty: number;
    reason: string;
    error?: string;
  } | null>(null);

  // Modal de Manifiesto de Despacho
  const [manifestOrderId, setManifestOrderId] = useState<string | null>(null);

  const headers: any = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  const currentUserEmail = user?.email || 'surtidor1@givingout.com';

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const res = await fetch(`${API}/orders`, { headers });
      if (res.ok) {
        const all = await res.json();
        const filtered = all.filter((o: any) =>
          ['APROBADO', 'EN_PICKING', 'CONSOLIDADO'].includes(o.estado)
        );
        setOrders(filtered);
      }
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  }

  // Cerrar o pausar terminal con sincronización automática garantizada del listado
  async function closeTerminal() {
    setActiveOrder(null);
    setSelectedLineIdx(0);
    setLocationVerified(false);
    setLocationScan('');
    setBoxScan('');
    setScanFeedback(null);
    await loadData();
  }

  // Regla de oro: 1 pedido por surtidor & Carga Inmediata (<10ms)
  async function handleStartPicking(order: any, force = false) {
    const tStart = performance.now();
    // Si ya está asignado al surtidor actual y en EN_PICKING, abrir modal inmediatamente sin bloqueos
    if (order.surtidor === currentUserEmail && order.estado === 'EN_PICKING') {
      openTerminal(order);
      const ms = Math.round(performance.now() - tStart);
      console.log(`[Picking] Terminal de surtido abierta en ${ms}ms (reanudación directa)`);
      return;
    }

    try {
      const res = await fetch(`${API}/orders/${order.id}/start-picking`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ surtidor: currentUserEmail, forzarReasignacion: force }),
      });

      const data = await res.json();
      if (!data.success && data.requiereConfirmacion) {
        setTakeoverDialog({ message: data.mensaje, order });
        return;
      }

      const updatedOrder = data.order || order;
      openTerminal(updatedOrder);
      const ms = Math.round(performance.now() - tStart);
      console.log(`[Picking] Terminal de surtido abierta en ${ms}ms tras start-picking`);
      loadData();
    } catch (err) {
      console.error('Error al iniciar picking:', err);
      openTerminal(order);
    }
  }

  // Desglosar asignaciones por rack y lote en tareas individuales de surtido
  function openTerminal(order: any) {
    setActiveOrder(order);
    setLocationScan('');
    setBoxScan('');
    setLocationVerified(false);
    setScanFeedback(null);

    const tasks: any[] = [];

    (order.lineas || []).forEach((line: any) => {
      let parsedAllocs: any[] = [];
      if (line.asignacionesJson) {
        try {
          const parsed = typeof line.asignacionesJson === 'string' ? JSON.parse(line.asignacionesJson) : line.asignacionesJson;
          if (Array.isArray(parsed) && parsed.length > 0) {
            parsedAllocs = parsed;
          }
        } catch (_) {}
      }

      const realLinePicked = Number(line.cantidadPickeada) || 0;
      const existingBoxes = line.cajaEscaneada ? line.cajaEscaneada.split(',').map((s: string) => s.trim()).filter(Boolean) : [];

      if (parsedAllocs.length === 0) {
        // Asignación simple (1 sola ubicación/lote)
        const solicitada = Number(line.cantidadSolicitada) || 0;
        tasks.push({
          id: `${line.id}-0`,
          lineId: line.id,
          sku: line.sku,
          ubicacionCodigo: (line.ubicacionAsignada || line.lote?.ubicacion?.codigo || 'A01-R01-N1').trim(),
          loteCodigo: (line.loteAsignado || line.lote?.lote || 'LOTE-DEFAULT').trim(),
          lotId: line.lotId,
          cantidadObjetivo: solicitada,
          cantidadPickeada: realLinePicked,
          completo: solicitada > 0 && realLinePicked >= solicitada,
          cajasEscaneadas: existingBoxes,
        });
      } else {
        // Desglose por ubicación de asignación (ej. B01: 12 pzs, B02: 12 pzs)
        parsedAllocs.forEach((alloc: any, aIdx: number) => {
          const objQty = Number(alloc.cantidad) || 0;
          const allocLoc = (alloc.ubicacionCodigo || line.ubicacionAsignada || 'B01-R01-N1').trim();
          const allocLot = (alloc.lote || line.loteAsignado || 'LOTE').trim();

          // 1. Obtener cantidad recolectada específica de la asignación persistida
          let taskPicked = 0;
          let taskBoxes: string[] = [];

          if (alloc.cantidadPickeada !== undefined && alloc.cantidadPickeada !== null) {
            taskPicked = Number(alloc.cantidadPickeada) || 0;
            taskBoxes = Array.isArray(alloc.cajasEscaneadas) ? alloc.cajasEscaneadas : [];
          } else {
            // Fallback por evidencia física registrada en la línea
            const isMatchLoc = line.ubicacionEscaneada && line.ubicacionEscaneada.toUpperCase().includes(allocLoc.toUpperCase());
            if (isMatchLoc) {
              taskPicked = Math.min(realLinePicked, objQty);
              taskBoxes = existingBoxes;
            }
          }

          tasks.push({
            id: `${line.id}-${alloc.lotId || aIdx}`,
            lineId: line.id,
            sku: line.sku,
            ubicacionCodigo: allocLoc,
            loteCodigo: allocLot,
            lotId: alloc.lotId,
            cantidadObjetivo: objQty,
            cantidadPickeada: taskPicked,
            completo: objQty > 0 && taskPicked >= objQty,
            cajasEscaneadas: taskBoxes,
          });
        });
      }
    });

    // Ordenar tareas por rack para optimizar recorrido físico
    tasks.sort((a, b) => (a.ubicacionCodigo || '').localeCompare(b.ubicacionCodigo || ''));

    // Posicionar automáticamente en la primera parada pendiente
    const firstPendingIdx = tasks.findIndex(t => !t.completo);
    setSelectedLineIdx(firstPendingIdx !== -1 ? firstPendingIdx : 0);

    setPickingLines(tasks);
  }

  // Doble Validación: Escaneo de Ubicación Física (Rack)
  async function handleLocationScanSubmit(e?: React.FormEvent) {
    if (e) e.preventDefault();
    const currentTask = pickingLines[selectedLineIdx];
    if (!currentTask) return;

    const raw = locationScan.trim();
    if (!raw) {
      setScanFeedback({
        type: 'warning',
        msg: 'Debe ingresar o escanear el código de barras del rack.',
        step: 'ubicacion',
      });
      return;
    }

    try {
      const res = await fetch(`${API}/orders/${activeOrder.id}/validate-scan`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          lineId: currentTask.lineId,
          tipoScan: 'UBICACION',
          codigoEscaneado: raw,
          ubicacionEsperada: currentTask.ubicacionCodigo,
        }),
      });

      const result = await res.json();
      if (result.valid) {
        setLocationVerified(true);
        setScanFeedback({
          type: 'success',
          msg: result.mensaje || `Rack ${raw} validado con éxito. Procede a escanear las cajas de este rack.`,
          step: 'ubicacion',
        });
      } else {
        setLocationVerified(false);
        setScanFeedback({
          type: 'error',
          msg: result.mensaje || `Ubicación errónea: ${raw}. La ubicación programada es ${currentTask.ubicacionCodigo}.`,
          step: 'ubicacion',
        });
      }
    } catch (err) {
      const expected = (currentTask.ubicacionCodigo || '').toUpperCase();
      const clean = raw.toUpperCase();
      if (clean === expected) {
        setLocationVerified(true);
        setScanFeedback({
          type: 'success',
          msg: `Rack ${raw} validado con éxito. Procede a escanear las cajas de este rack.`,
          step: 'ubicacion',
        });
      } else {
        setLocationVerified(false);
        setScanFeedback({
          type: 'error',
          msg: `Ubicación errónea: Escaneaste "${raw}". La ubicación requerida es "${expected}".`,
          step: 'ubicacion',
        });
      }
    }
  }

  // Doble Validación: Escaneo de Caja / Etiqueta Code-128
  async function handleBoxScanSubmit(e?: React.FormEvent) {
    if (e) e.preventDefault();
    const currentTask = pickingLines[selectedLineIdx];
    if (!currentTask) return;

    if (!locationVerified) {
      setScanFeedback({
        type: 'warning',
        msg: 'Debes escanear y validar primero la etiqueta del rack asignado antes de escanear cajas.',
        step: 'ubicacion',
      });
      return;
    }

    const raw = boxScan.trim();
    if (!raw) {
      setScanFeedback({
        type: 'warning',
        msg: 'Debe ingresar o escanear el código de barras de la caja / HU.',
        step: 'caja',
      });
      return;
    }

    // Validación preventiva de caja duplicada en toda la orden
    const allScannedBoxesAcrossOrder = pickingLines.flatMap(t => t.cajasEscaneadas || []);
    if (allScannedBoxesAcrossOrder.some(c => (c || '').toUpperCase() === raw.toUpperCase())) {
      setScanFeedback({
        type: 'error',
        msg: `Caja duplicada: La caja "${raw}" ya fue escaneada y registrada previamente en este pedido.`,
        step: 'caja',
      });
      return;
    }

    const faltante = currentTask.cantidadObjetivo - currentTask.cantidadPickeada;

    try {
      const res = await fetch(`${API}/orders/${activeOrder.id}/validate-scan`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          lineId: currentTask.lineId,
          tipoScan: 'CAJA',
          codigoEscaneado: raw,
          ubicacionEsperada: currentTask.ubicacionCodigo,
          loteEsperado: currentTask.loteCodigo,
          cantidadEsperada: faltante,
          cajasYaEscaneadas: allScannedBoxesAcrossOrder,
        }),
      });

      const result = await res.json();
      if (result.valid) {
        const cantToAdd = Number(result.cantidadCaja) || 1;
        const newQty = (currentTask.cantidadPickeada || 0) + cantToAdd;
        await syncTaskPick(selectedLineIdx, newQty, result.huCodigo || raw);

        setScanFeedback({
          type: 'success',
          msg: `Caja y lote correctos: +${cantToAdd} ud(s) registradas (${Math.min(newQty, currentTask.cantidadObjetivo)}/${currentTask.cantidadObjetivo} uds).`,
          step: 'caja',
        });
        setBoxScan('');
      } else {
        setScanFeedback({
          type: 'error',
          msg: result.mensaje || `Caja inválida: "${raw}" no corresponde al lote o rack validado.`,
          step: 'caja',
        });
      }
    } catch (err) {
      setScanFeedback({
        type: 'error',
        msg: 'Error al contactar al servidor para validar el escaneo de la caja.',
        step: 'caja',
      });
    }
  }

  // Sincronizar conteo de una tarea y reportar a backend con desglose por asignación
  async function syncTaskPick(taskIdx: number, targetQtyInTask: number, boxScanned?: string, esAjusteManual = false, motivoAjuste = '') {
    const currentTask = pickingLines[taskIdx];
    if (!currentTask) return;

    const clampedTaskQty = Math.max(0, Math.min(targetQtyInTask, currentTask.cantidadObjetivo));
    const newBoxes = boxScanned && !currentTask.cajasEscaneadas.includes(boxScanned)
      ? [...currentTask.cajasEscaneadas, boxScanned]
      : currentTask.cajasEscaneadas;

    const nextTasks = [...pickingLines];
    nextTasks[taskIdx] = {
      ...currentTask,
      cantidadPickeada: clampedTaskQty,
      completo: clampedTaskQty >= currentTask.cantidadObjetivo && currentTask.cantidadObjetivo > 0,
      cajasEscaneadas: newBoxes,
    };
    setPickingLines(nextTasks);

    // Preparar el array de asignaciones actualizado para la línea padre
    const lineTasks = nextTasks.filter(t => t.lineId === currentTask.lineId);
    const totalLinePicked = lineTasks.reduce((s, t) => s + (Number(t.cantidadPickeada) || 0), 0);
    const allScannedBoxes = Array.from(new Set(lineTasks.flatMap(t => t.cajasEscaneadas || [])));

    const asignacionesActualizadas = lineTasks.map(t => ({
      lotId: t.lotId,
      cantidad: t.cantidadObjetivo,
      lote: t.loteCodigo,
      ubicacionCodigo: t.ubicacionCodigo,
      cantidadPickeada: t.cantidadPickeada,
      cajasEscaneadas: t.cajasEscaneadas || [],
      completo: t.completo,
    }));

    // Sincronizar inmediatamente en orders local para reflejo reactivo en listado
    setOrders(prev => prev.map(o => {
      if (o.id !== activeOrder.id) return o;
      return {
        ...o,
        lineas: (o.lineas || []).map((l: any) => {
          if (l.id !== currentTask.lineId) return l;
          return {
            ...l,
            cantidadPickeada: totalLinePicked,
            cajaEscaneada: allScannedBoxes.join(', '),
            ubicacionEscaneada: currentTask.ubicacionCodigo,
            asignacionesJson: JSON.stringify(asignacionesActualizadas),
          };
        }),
      };
    }));

    try {
      const res = await fetch(`${API}/orders/${activeOrder.id}/record-pick`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          lineId: currentTask.lineId,
          cantidadPickeada: totalLinePicked,
          ubicacionEscaneada: currentTask.ubicacionCodigo,
          cajaEscaneada: boxScanned || (allScannedBoxes.length > 0 ? allScannedBoxes[allScannedBoxes.length - 1] : undefined),
          cajasHistorial: allScannedBoxes,
          taskUbicacionCodigo: currentTask.ubicacionCodigo,
          taskLotId: currentTask.lotId,
          taskCantidadPickeada: clampedTaskQty,
          asignacionesActualizadas,
          usuario: currentUserEmail,
          esAjusteManual,
          motivoAjuste: motivoAjuste || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setScanFeedback({
          type: 'error',
          msg: data.message || 'Error al persistir recolección en base de datos',
        });
        return;
      }

      if (data.orderFullyPicked) {
        setActiveOrder((prev: any) => ({ ...prev, estado: 'CONSOLIDADO' }));
        loadData();
      }
    } catch (err) {
      console.error('Error al registrar picking:', err);
    }
  }

  // Ajuste por excepción: Dispara modal integrado con motivo obligatorio
  function handleManualAdjustment(taskIdx: number, targetQty: number) {
    const currentTask = pickingLines[taskIdx];
    if (!currentTask) return;
    setAdjustmentModal({
      taskIdx,
      targetQty,
      reason: '',
      error: '',
    });
  }

  // Filtrado de pedidos
  const queueOrders = orders.filter(o => o.estado === 'APROBADO');
  const activeOrders = orders.filter(o => o.estado === 'EN_PICKING');
  const doneOrders = orders.filter(o => o.estado === 'CONSOLIDADO');

  const currentTabList = tab === 'queue' ? queueOrders : tab === 'active' ? activeOrders : doneOrders;

  const filteredOrders = currentTabList.filter(o => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      o.codigo?.toLowerCase().includes(s) ||
      o.cliente?.nombreComercial?.toLowerCase().includes(s) ||
      o.endCustomer?.nombre?.toLowerCase().includes(s)
    );
  });

  // Métricas estrictamente separadas: Solicitado, Asignado, Recolectado
  const totalSolicitado = (o: any) => o.lineas?.reduce((s: number, l: any) => s + (Number(l.cantidadSolicitada) || 0), 0) || 0;
  const totalAsignado = (o: any) => o.lineas?.reduce((s: number, l: any) => s + (Number(l.cantidadAsignada) || 0), 0) || 0;
  const totalRecolectado = (o: any) => o.lineas?.reduce((s: number, l: any) => s + (Number(l.cantidadPickeada) || 0), 0) || 0;
  const pctProgress = (o: any) => {
    const t = totalSolicitado(o);
    return t ? Math.round((totalRecolectado(o) / t) * 100) : 0;
  };

  const currentLine = pickingLines[selectedLineIdx];
  const allLinesComplete = pickingLines.length > 0 && pickingLines.every(l => l.completo);

  return (
    <div className="page-container">
      {/* Header */}
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 className="page-title">Terminal de Surtido & Picking</h1>
          <p className="page-subtitle">
            Doble Validación por Escaneo (Rack + Caja) · Regla de 1 Pedido por Surtidor
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <div style={{
            fontSize: 12,
            padding: '6px 12px',
            borderRadius: 20,
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}>
            <UserCheck size={14} color="var(--primary)" />
            <span>Surtidor activo: <strong>{currentUserEmail.split('@')[0]}</strong></span>
          </div>
          <button className="btn btn-secondary" onClick={loadData}>
            <RefreshCw size={15} /> Actualizar
          </button>
        </div>
      </div>

      {/* KPI Ribbon */}
      <div className="stats-grid" style={{ marginBottom: 20 }}>
        <div
          className="stat-card"
          onClick={() => setTab('queue')}
          style={{
            cursor: 'pointer',
            border: tab === 'queue' ? '2px solid var(--primary)' : '1px solid var(--border)',
            transition: 'all 0.2s',
          }}
        >
          <div className="stat-icon" style={{ background: 'rgba(99,102,241,0.15)', color: 'var(--primary)' }}>
            <Layers size={20} />
          </div>
          <div className="stat-info">
            <span className="stat-value">{queueOrders.length}</span>
            <span className="stat-label">En Cola (Aprobados)</span>
          </div>
        </div>

        <div
          className="stat-card"
          onClick={() => setTab('active')}
          style={{
            cursor: 'pointer',
            border: tab === 'active' ? '2px solid #f59e0b' : '1px solid var(--border)',
            transition: 'all 0.2s',
          }}
        >
          <div className="stat-icon" style={{ background: 'rgba(245,158,11,0.15)', color: '#f59e0b' }}>
            <ScanLine size={20} />
          </div>
          <div className="stat-info">
            <span className="stat-value">{activeOrders.length}</span>
            <span className="stat-label">En Recolección</span>
          </div>
        </div>

        <div
          className="stat-card"
          onClick={() => setTab('done')}
          style={{
            cursor: 'pointer',
            border: tab === 'done' ? '2px solid var(--emerald)' : '1px solid var(--border)',
            transition: 'all 0.2s',
          }}
        >
          <div className="stat-icon" style={{ background: 'rgba(16,185,129,0.15)', color: 'var(--emerald)' }}>
            <CheckCircle2 size={20} />
          </div>
          <div className="stat-info">
            <span className="stat-value">{doneOrders.length}</span>
            <span className="stat-label">Consolidados (Salida)</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(14,165,233,0.15)', color: '#0ea5e9' }}>
            <BarChart3 size={20} />
          </div>
          <div className="stat-info">
            <span className="stat-value">{orders.reduce((s, o) => s + totalSolicitado(o), 0)}</span>
            <span className="stat-label">Uds Totales Programadas</span>
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
          {[
            { key: 'active' as const, icon: <ScanLine size={15} />, label: 'En Recolección Activa', count: activeOrders.length },
            { key: 'queue' as const, icon: <Layers size={15} />, label: 'Cola de Picking', count: queueOrders.length },
            { key: 'done' as const, icon: <CheckCircle2 size={15} />, label: 'Consolidados para Despacho', count: doneOrders.length },
          ].map(t => (
            <button
              key={t.key}
              className="btn btn-ghost"
              style={{
                flex: 1,
                borderBottom: tab === t.key ? '2px solid var(--primary)' : 'none',
                borderRadius: 0,
                fontWeight: tab === t.key ? 700 : 400,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                padding: '12px 16px',
              }}
              onClick={() => setTab(t.key)}
            >
              {t.icon}
              <span>{t.label}</span>
              {t.count > 0 && <span className="sidebar-badge">{t.count}</span>}
            </button>
          ))}
        </div>

        {/* Filter bar */}
        <div style={{ padding: '12px 16px' }}>
          <div className="search-box">
            <Search size={16} />
            <input
              placeholder="Buscar por folio, cliente depositante o destino (Walmart, etc.)..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Orders List */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-secondary)' }}>
          <RefreshCw className="animate-spin" size={24} />
          <p style={{ marginTop: 10 }}>Cargando cola de picking...</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 14 }}>
          {filteredOrders.map((o, idx) => {
            const isMyOrder = o.surtidor === currentUserEmail;
            const isTaken = o.surtidor && o.surtidor !== currentUserEmail;
            const pct = pctProgress(o);

            return (
              <div
                key={o.id}
                className="card animate-fade-in"
                style={{
                  animationDelay: `${idx * 0.04}s`,
                  borderLeft: `4px solid ${
                    o.estado === 'CONSOLIDADO' ? 'var(--emerald)' :
                    o.estado === 'EN_PICKING' ? '#f59e0b' : 'var(--primary)'
                  }`,
                }}
              >
                <div style={{ padding: '18px 22px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                      <span style={{ fontWeight: 700, fontSize: 16 }}>{o.codigo}</span>
                      <span className={`badge badge-${o.estado === 'CONSOLIDADO' ? 'success' : o.estado === 'EN_PICKING' ? 'warning' : 'info'}`}>
                        {o.estado === 'CONSOLIDADO' ? 'Consolidado' : o.estado === 'EN_PICKING' ? 'En Recolección' : 'En Espera'}
                      </span>
                      {o.prioridad === 1 && (
                        <span className="badge badge-error" style={{ fontSize: 11, fontWeight: 700 }}>
                          Prioridad Urgente
                        </span>
                      )}
                      {o.surtidor && (
                        <span style={{ fontSize: 11, color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', gap: 4 }}>
                          <UserCheck size={12} /> {o.surtidor.split('@')[0]}
                        </span>
                      )}
                    </div>

                    <div style={{ display: 'flex', gap: 8 }}>
                      {o.estado === 'APROBADO' && (
                        <button className="btn btn-primary" onClick={() => handleStartPicking(o)}>
                          <PlayCircle size={16} /> Tomar Pedido & Surtir
                        </button>
                      )}
                      {o.estado === 'EN_PICKING' && (
                        <button
                          className={`btn ${isMyOrder ? 'btn-warning' : 'btn-secondary'}`}
                          onClick={() => handleStartPicking(o)}
                        >
                          <Target size={16} /> {isMyOrder ? 'Continuar Mi Surtido' : 'Abrir Terminal'}
                        </button>
                      )}
                      {o.estado === 'CONSOLIDADO' && (
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button
                            className="btn btn-success"
                            onClick={() => setManifestOrderId(o.id)}
                            style={{ fontWeight: 700 }}
                          >
                            <FileText size={15} /> Manifiesto de Salida
                          </button>
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => navigate('/dispatch')}
                          >
                            <Truck size={14} /> Rampa de Salida
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Info details */}
                  <div style={{ display: 'flex', gap: 20, fontSize: 13, color: 'var(--text-secondary)', flexWrap: 'wrap', marginBottom: 12 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <Package size={14} color="var(--primary)" />
                      {o.cliente?.nombreComercial}
                    </span>
                    {o.endCustomer && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <MapPin size={14} color="var(--emerald)" />
                        {o.endCustomer.nombre} {o.endCustomer.ciudad ? `· ${o.endCustomer.ciudad}` : ''}
                      </span>
                    )}
                    <span>
                      {o.lineas?.length} líneas · {totalSolicitado(o)} solicitadas · {totalAsignado(o)} asignadas · <strong style={{ color: totalRecolectado(o) > 0 ? 'var(--emerald)' : 'inherit' }}>{totalRecolectado(o)}</strong> recolectadas
                    </span>
                    {o.fechaCompromiso && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <Clock size={13} />
                        Cita: {new Date(o.fechaCompromiso).toLocaleDateString('es-MX')} {o.horaCompromiso ? `(${o.horaCompromiso})` : ''}
                      </span>
                    )}
                  </div>

                  {/* Progress bar for EN_PICKING */}
                  {o.estado === 'EN_PICKING' && (
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                        <span style={{ color: 'var(--text-tertiary)' }}>
                          Progreso de recolección: <strong>{totalRecolectado(o)} / {totalSolicitado(o)} uds</strong>
                        </span>
                        <span style={{ fontWeight: 700, color: pct === 100 ? 'var(--emerald)' : '#f59e0b' }}>
                          {pct}%
                        </span>
                      </div>
                      <div className="progress-bar">
                        <div
                          className="progress-fill"
                          style={{
                            width: `${pct}%`,
                            background: pct === 100 ? 'var(--emerald)' : 'var(--orange)',
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {filteredOrders.length === 0 && (
            <div className="card" style={{ padding: 50, textAlign: 'center', color: 'var(--text-tertiary)' }}>
              No hay pedidos en este apartado actualmente.
            </div>
          )}
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL / TERMINAL TÁCTIL DE SURTIDO CON DOBLE VALIDACIÓN   */}
      {/* ========================================================= */}
      {activeOrder && (
        <div className="modal-overlay" onClick={closeTerminal} style={{ zIndex: 1100 }}>
          <div
            className="modal-content animate-fade-in"
            onClick={e => e.stopPropagation()}
            style={{ maxWidth: 860, maxHeight: '92vh', overflowY: 'auto' }}
          >
            {/* Terminal Header */}
            <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ padding: 8, borderRadius: 8, background: 'rgba(245,158,11,0.15)', color: '#f59e0b' }}>
                  <ScanLine size={22} />
                </div>
                <div>
                  <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>
                    Terminal de Surtido — {activeOrder.codigo}
                  </h2>
                  <p style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: '2px 0 0 0' }}>
                    Destino: <strong style={{ color: 'var(--text-primary)' }}>{activeOrder.endCustomer?.nombre || activeOrder.cliente?.nombreComercial}</strong> · Carrito / Pallet Activo #1
                  </p>
                </div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={closeTerminal}>
                <X size={18} />
              </button>
            </div>

            <div className="modal-body" style={{ padding: 20 }}>
              {/* Order Info Strip */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 16 }}>
                <div className="card" style={{ padding: 12, background: 'var(--bg-secondary)' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>Depositante</div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{activeOrder.cliente?.nombreComercial}</div>
                </div>
                <div className="card" style={{ padding: 12, background: 'var(--bg-secondary)' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>Cita de Entrega</div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>
                    {activeOrder.fechaCompromiso ? new Date(activeOrder.fechaCompromiso).toLocaleDateString('es-MX') : 'Inmediata'}{' '}
                    {activeOrder.horaCompromiso ? `(${activeOrder.horaCompromiso})` : ''}
                  </div>
                </div>
                <div className="card" style={{ padding: 12, background: 'var(--bg-secondary)' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>Surtidor Asignado</div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--primary)' }}>
                    {activeOrder.surtidor || currentUserEmail.split('@')[0]}
                  </div>
                </div>
                <div className="card" style={{ padding: 12, background: 'var(--bg-secondary)' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>Progreso Total</div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: allLinesComplete ? 'var(--emerald)' : 'var(--orange)' }}>
                    {pickingLines.filter(l => l.completo).length} / {pickingLines.length} paradas completas
                  </div>
                </div>
              </div>

              {/* Scan Feedback Alert */}
              {scanFeedback && (
                <div style={{
                  padding: '12px 16px',
                  borderRadius: 8,
                  background: scanFeedback.type === 'success' ? 'rgba(16,185,129,0.1)' : scanFeedback.type === 'warning' ? 'rgba(245,158,11,0.1)' : 'rgba(239,68,68,0.1)',
                  border: `1px solid ${scanFeedback.type === 'success' ? 'var(--emerald)' : scanFeedback.type === 'warning' ? '#f59e0b' : 'var(--error)'}`,
                  color: scanFeedback.type === 'success' ? 'var(--emerald)' : scanFeedback.type === 'warning' ? '#f59e0b' : 'var(--error)',
                  marginBottom: 16,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  fontSize: 13,
                  fontWeight: 600,
                }}>
                  {scanFeedback.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
                  <span>{scanFeedback.msg}</span>
                </div>
              )}

              {/* Active Item Scanning Station */}
              {currentLine && (
                <div style={{
                  background: 'var(--bg-secondary)',
                  borderRadius: 12,
                  padding: 18,
                  marginBottom: 20,
                  border: '2px solid var(--primary)',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className="badge badge-info" style={{ fontWeight: 700 }}>
                        Parada #{selectedLineIdx + 1} de {pickingLines.length}
                      </span>
                      <code style={{ fontSize: 14, fontWeight: 700, color: 'var(--primary)' }}>
                        {currentLine.sku?.codigo}
                      </code>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                        Surtido: <strong style={{ fontSize: 16, color: currentLine.completo ? 'var(--emerald)' : 'var(--text-primary)' }}>{currentLine.cantidadPickeada}</strong> / {currentLine.cantidadObjetivo} uds
                      </span>
                    </div>
                  </div>

                  <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12, color: 'var(--text-primary)' }}>
                    {currentLine.sku?.descripcion}
                  </div>

                  {/* Target rack location and lot strip */}
                  <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
                    <div style={{
                      padding: '8px 14px',
                      borderRadius: 8,
                      background: locationVerified ? 'rgba(16,185,129,0.15)' : 'var(--bg-primary)',
                      border: `1px solid ${locationVerified ? 'var(--emerald)' : 'var(--border)'}`,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                    }}>
                      <MapPin size={16} color={locationVerified ? 'var(--emerald)' : 'var(--primary)'} />
                      <span style={{ fontSize: 12 }}>
                        Ubicación Rack:{' '}
                        <strong style={{ fontFamily: 'monospace', fontSize: 14 }}>
                          {currentLine.ubicacionCodigo}
                        </strong>
                      </span>
                      {locationVerified && (
                        <span className="badge badge-success" style={{ fontSize: 10, padding: '2px 6px' }}>
                          Verificada
                        </span>
                      )}
                    </div>

                    <div style={{
                      padding: '8px 14px',
                      borderRadius: 8,
                      background: 'var(--bg-primary)',
                      border: '1px solid var(--border)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                    }}>
                      <Layers size={16} color="var(--primary)" />
                      <span style={{ fontSize: 12 }}>
                        Lote Asignado:{' '}
                        <strong style={{ fontFamily: 'monospace', fontSize: 14 }}>
                          {currentLine.loteCodigo}
                        </strong>
                      </span>
                    </div>
                  </div>

                  {/* Dual Scan Inputs */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                    {/* Scan 1: Rack Location */}
                    <form onSubmit={handleLocationScanSubmit} style={{ background: 'var(--bg-primary)', padding: 14, borderRadius: 8, border: `1px solid ${locationVerified ? 'var(--emerald)' : 'var(--border)'}` }}>
                      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6, color: locationVerified ? 'var(--emerald)' : 'var(--text-primary)' }}>
                        <ScanLine size={15} /> 1. Escanear Ubicación Física (Rack)
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <input
                          type="text"
                          className="form-input"
                          placeholder={currentLine.ubicacionCodigo}
                          value={locationScan}
                          onChange={e => setLocationScan(e.target.value)}
                          disabled={locationVerified}
                          style={{ flex: 1, fontFamily: 'monospace', fontWeight: 700 }}
                        />
                        <button
                          type="submit"
                          className={`btn btn-sm ${locationVerified ? 'btn-success' : 'btn-primary'}`}
                          disabled={locationVerified || !locationScan.trim()}
                        >
                          {locationVerified ? <CheckCircle2 size={14} /> : 'Validar'}
                        </button>
                      </div>
                      {locationVerified && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          style={{ fontSize: 11, padding: '2px 6px', marginTop: 6 }}
                          onClick={() => { setLocationVerified(false); setLocationScan(''); }}
                        >
                          Reescanear rack
                        </button>
                      )}
                    </form>

                    {/* Scan 2: Box Barcode */}
                    <form onSubmit={handleBoxScanSubmit} style={{ background: 'var(--bg-primary)', padding: 14, borderRadius: 8, border: `1px solid ${!locationVerified ? 'var(--border)' : 'var(--primary)'}`, opacity: locationVerified ? 1 : 0.6 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Box size={15} /> 2. Escanear Caja / Etiqueta Code-128
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <input
                          type="text"
                          className="form-input"
                          placeholder="Escanea etiqueta de la caja..."
                          value={boxScan}
                          onChange={e => setBoxScan(e.target.value)}
                          disabled={!locationVerified}
                          autoFocus={locationVerified}
                          style={{ flex: 1, fontFamily: 'monospace', fontWeight: 700 }}
                        />
                        <button
                          type="submit"
                          className="btn btn-primary btn-sm"
                          disabled={!locationVerified || !boxScan.trim()}
                        >
                          <ScanLine size={14} /> +1 Caja
                        </button>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 6 }}>
                        Valida SKU y lote programado antes de sumar
                      </div>
                    </form>
                  </div>

                  {/* Manual / Touch Controls Fallback con Auditoría Obligatoria */}
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    background: 'var(--bg-primary)',
                    padding: '10px 14px',
                    borderRadius: 8,
                    border: '1px solid var(--border)',
                  }}>
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      Ajuste asistido por excepción (pantalla táctil / supervisor):
                    </span>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => handleManualAdjustment(selectedLineIdx, currentLine.cantidadPickeada - 1)}
                        disabled={currentLine.cantidadPickeada <= 0}
                      >
                        -1
                      </button>
                      <input
                        type="number"
                        min={0}
                        max={currentLine.cantidadObjetivo}
                        value={currentLine.cantidadPickeada}
                        onChange={e => handleManualAdjustment(selectedLineIdx, parseInt(e.target.value, 10) || 0)}
                        style={{
                          width: 55,
                          height: 32,
                          textAlign: 'center',
                          fontWeight: 700,
                          borderRadius: 6,
                          border: '1px solid var(--border)',
                        }}
                      />
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => handleManualAdjustment(selectedLineIdx, currentLine.cantidadPickeada + 1)}
                        disabled={currentLine.cantidadPickeada >= currentLine.cantidadObjetivo}
                      >
                        +1
                      </button>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => handleManualAdjustment(selectedLineIdx, currentLine.cantidadObjetivo)}
                        style={{ marginLeft: 6 }}
                      >
                        <CheckSquare size={13} /> Surtir Todo
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* All Items Route List */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
                  Ruta de Recolección en Almacén ({pickingLines.length} paradas programadas)
                </div>

                <div style={{ display: 'grid', gap: 8 }}>
                  {pickingLines.map((line, idx) => (
                    <div
                      key={idx}
                      onClick={() => {
                        setSelectedLineIdx(idx);
                        setLocationVerified(false);
                        setLocationScan('');
                        setBoxScan('');
                      }}
                      style={{
                        padding: '12px 16px',
                        borderRadius: 8,
                        border: `1px solid ${
                          selectedLineIdx === idx ? 'var(--primary)' :
                          line.completo ? 'var(--emerald)' : 'var(--border)'
                        }`,
                        background: selectedLineIdx === idx ? 'rgba(99,102,241,0.06)' : line.completo ? 'rgba(16,185,129,0.04)' : 'var(--bg-secondary)',
                        cursor: 'pointer',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{
                          width: 24,
                          height: 24,
                          borderRadius: '50%',
                          background: line.completo ? 'var(--emerald)' : selectedLineIdx === idx ? 'var(--primary)' : 'var(--border)',
                          color: 'white',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 11,
                          fontWeight: 700,
                        }}>
                          {line.completo ? <CheckCircle2 size={14} /> : idx + 1}
                        </span>
                        <div>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                            <code style={{ fontSize: 12, fontWeight: 700, color: 'var(--primary)' }}>
                              {line.sku?.codigo}
                            </code>
                            <span style={{ fontSize: 13, fontWeight: 600 }}>{line.sku?.descripcion}</span>
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>
                            Rack: <strong>{line.ubicacionCodigo}</strong> · Lote: <strong>{line.loteCodigo}</strong>
                          </div>
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: line.completo ? 'var(--emerald)' : 'var(--orange)' }}>
                          {line.cantidadPickeada} / {line.cantidadObjetivo} uds
                        </span>
                        {line.completo ? (
                          <span className="badge badge-success" style={{ fontSize: 11 }}>Completo</span>
                        ) : (
                          <span className="badge badge-warning" style={{ fontSize: 11 }}>En curso</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Terminal Footer */}
            <div className="modal-footer" style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border)' }}>
              <button className="btn btn-ghost" onClick={closeTerminal}>
                Pausar y Cerrar
              </button>
              {allLinesComplete && pickingLines.length > 0 && pickingLines.every(l => l.completo && l.cantidadPickeada >= l.cantidadObjetivo && l.cantidadObjetivo > 0) ? (
                <button
                  className="btn btn-success"
                  style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}
                  onClick={() => {
                    setManifestOrderId(activeOrder.id);
                    setActiveOrder(null);
                  }}
                >
                  <CheckCircle2 size={16} />
                  Surtido al 100% — Proceder a Manifiesto de Despacho
                </button>
              ) : (
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    const nextPending = pickingLines.findIndex(l => !l.completo);
                    if (nextPending !== -1) {
                      setSelectedLineIdx(nextPending);
                      setLocationVerified(false);
                      setLocationScan('');
                      setBoxScan('');
                    }
                  }}
                >
                  Siguiente Parada Pendiente <ArrowRight size={14} />
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal de Reasignación de Surtidor (Diseño Giving Out) */}
      {takeoverDialog && (
        <div className="modal-overlay" style={{ zIndex: 1250 }}>
          <div className="modal-content animate-fade-in" style={{ maxWidth: 480 }}>
            <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <UserCheck size={20} color="var(--primary)" />
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Reasignación de Surtidor</h3>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => setTakeoverDialog(null)}>
                <X size={16} />
              </button>
            </div>
            <div className="modal-body" style={{ padding: '18px 20px', fontSize: 13 }}>
              <p style={{ margin: 0, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                {takeoverDialog.message}
              </p>
            </div>
            <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, borderTop: '1px solid var(--border)' }}>
              <button className="btn btn-ghost" onClick={() => setTakeoverDialog(null)}>
                Cancelar
              </button>
              <button
                className="btn btn-primary"
                style={{ fontWeight: 700 }}
                onClick={async () => {
                  const ord = takeoverDialog.order;
                  setTakeoverDialog(null);
                  await handleStartPicking(ord, true);
                }}
              >
                Asumir Control y Surtir
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Ajuste Asistido por Excepción con Auditoría Obligatoria */}
      {adjustmentModal && (
        <div className="modal-overlay" style={{ zIndex: 1250 }}>
          <div className="modal-content animate-fade-in" style={{ maxWidth: 520 }}>
            <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <ShieldAlert size={20} color="var(--orange)" />
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
                  Ajuste Asistido por Excepción
                </h3>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => setAdjustmentModal(null)}>
                <X size={16} />
              </button>
            </div>
            <div className="modal-body" style={{ padding: '18px 20px', fontSize: 13 }}>
              <div style={{ background: 'var(--bg-secondary)', padding: '12px 14px', borderRadius: 8, marginBottom: 14 }}>
                <div style={{ fontWeight: 700, color: 'var(--primary)', marginBottom: 2 }}>
                  {pickingLines[adjustmentModal.taskIdx]?.sku?.codigo} — {pickingLines[adjustmentModal.taskIdx]?.sku?.descripcion}
                </div>
                <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
                  Ubicación: <strong>{pickingLines[adjustmentModal.taskIdx]?.ubicacionCodigo}</strong> · Lote: <strong>{pickingLines[adjustmentModal.taskIdx]?.loteCodigo}</strong>
                </div>
                <div style={{ marginTop: 6, fontSize: 13 }}>
                  Cantidad anterior: <strong>{pickingLines[adjustmentModal.taskIdx]?.cantidadPickeada} uds</strong> → Nueva cantidad: <strong style={{ color: 'var(--primary)' }}>{adjustmentModal.targetQty} / {pickingLines[adjustmentModal.taskIdx]?.cantidadObjetivo} uds</strong>
                </div>
              </div>

              <label style={{ display: 'block', fontWeight: 600, marginBottom: 6 }}>
                Motivo obligatorio de auditoría (mínimo 5 caracteres) *:
              </label>
              <textarea
                className="form-input"
                rows={3}
                placeholder="Especifique la justificación operativa del ajuste asistido (ej. Caja deteriorada con autorización de supervisión)..."
                value={adjustmentModal.reason}
                onChange={e => setAdjustmentModal(prev => prev ? { ...prev, reason: e.target.value, error: '' } : null)}
                style={{ width: '100%', resize: 'vertical' }}
              />
              {adjustmentModal.error && (
                <div style={{ color: 'var(--error)', fontSize: 12, marginTop: 6 }}>
                  {adjustmentModal.error}
                </div>
              )}
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 8 }}>
                Usuario supervisor/operador: <strong>{currentUserEmail}</strong> · Este ajuste se almacena permanentemente en la bitácora oficial.
              </div>
            </div>
            <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, borderTop: '1px solid var(--border)' }}>
              <button className="btn btn-ghost" onClick={() => setAdjustmentModal(null)}>
                Cancelar
              </button>
              <button
                className="btn btn-primary"
                style={{ fontWeight: 700 }}
                disabled={!adjustmentModal.reason || adjustmentModal.reason.trim().length < 5}
                onClick={async () => {
                  if (!adjustmentModal.reason || adjustmentModal.reason.trim().length < 5) {
                    setAdjustmentModal(prev => prev ? { ...prev, error: 'El motivo debe tener al menos 5 caracteres.' } : null);
                    return;
                  }
                  const { taskIdx, targetQty, reason } = adjustmentModal;
                  setAdjustmentModal(null);
                  await syncTaskPick(taskIdx, targetQty, undefined, true, reason.trim());
                  setScanFeedback({
                    type: 'success',
                    msg: `Ajuste por excepción registrado (${targetQty}/${pickingLines[taskIdx]?.cantidadObjetivo} uds) con auditoría: "${reason.trim()}".`,
                  });
                }}
              >
                Confirmar Ajuste y Auditar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL FORMAL DE MANIFIESTO DE DESPACHO Y SALIDA           */}
      {/* ========================================================= */}
      {manifestOrderId && (
        <DispatchManifestModal
          orderId={manifestOrderId}
          token={token || ''}
          currentUser={currentUserEmail}
          onClose={() => setManifestOrderId(null)}
          onSuccess={() => {
            loadData();
          }}
        />
      )}
    </div>
  );
}
