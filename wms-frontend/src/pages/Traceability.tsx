import React, { useEffect, useState, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { API } from '../config/api';
import {
  GitBranch, Search, RefreshCw, Package, ArrowRight, MapPin,
  Calendar, User, ArrowDown, ArrowUp, Building2,
  Tag, Box, FileText, Plus, Minus, Download, X, RotateCcw,
  ShieldCheck, AlertTriangle, Eye, Clock, Layers, Trash2,
  Lock, History
} from 'lucide-react';

interface MovementTypeConfig {
  label: string;
  icon: React.ReactNode;
  color: string;
  bg: string;
  badgeClass: string;
  sign: string;
  category: 'ENTRADA' | 'SALIDA' | 'TRASIEGO' | 'CUARENTENA' | 'AJUSTE' | 'OTRO';
}

const getTipoConfig = (tipo: string): MovementTypeConfig => {
  const t = (tipo || '').toUpperCase();
  if (t === 'ENTRADA' || t === 'RECEPCION' || t === 'RECEPCIÓN') {
    return {
      label: 'ENTRADA',
      icon: <ArrowDown size={14} />,
      color: 'var(--emerald, #10b981)',
      bg: 'rgba(16,185,129,0.12)',
      badgeClass: 'badge-success',
      sign: '+',
      category: 'ENTRADA',
    };
  }
  if (t === 'SALIDA' || t === 'SALIDA_PEDIDO' || t === 'DESPACHO') {
    return {
      label: t === 'SALIDA_PEDIDO' ? 'SALIDA PEDIDO' : 'SALIDA',
      icon: <ArrowUp size={14} />,
      color: 'var(--danger, #ef4444)',
      bg: 'rgba(239,68,68,0.12)',
      badgeClass: 'badge-danger',
      sign: '−',
      category: 'SALIDA',
    };
  }
  if (t === 'ENVIO_CUARENTENA' || t === 'ENVÍO_CUARENTENA' || t === 'CUARENTENA') {
    return {
      label: 'ENVÍO A CUARENTENA',
      icon: <AlertTriangle size={14} />,
      color: '#f59e0b',
      bg: 'rgba(245,158,11,0.12)',
      badgeClass: 'badge-warning',
      sign: '',
      category: 'CUARENTENA',
    };
  }
  if (t === 'TRASIEGO' || t === 'TRASIEGO_MANUAL' || t === 'TRANSFERENCIA' || t === 'PICKING_A_STAGING' || t === 'PICKING') {
    return {
      label: t === 'TRASIEGO_MANUAL' ? 'TRASIEGO MANUAL' : t === 'PICKING_A_STAGING' ? 'PICKING A STAGING' : 'TRASIEGO',
      icon: <RefreshCw size={14} />,
      color: 'var(--info, #3b82f6)',
      bg: 'rgba(59,130,246,0.12)',
      badgeClass: 'badge-info',
      sign: '',
      category: 'TRASIEGO',
    };
  }
  if (t === 'AJUSTE_ENTRADA') {
    return {
      label: 'AJUSTE ENTRADA',
      icon: <Plus size={14} />,
      color: '#0d9488',
      bg: 'rgba(13,148,136,0.12)',
      badgeClass: 'badge-success',
      sign: '+',
      category: 'AJUSTE',
    };
  }
  if (t === 'AJUSTE_SALIDA') {
    return {
      label: 'AJUSTE SALIDA',
      icon: <Minus size={14} />,
      color: '#f97316',
      bg: 'rgba(249,115,22,0.12)',
      badgeClass: 'badge-warning',
      sign: '−',
      category: 'AJUSTE',
    };
  }
  if (t === 'REACONDICIONAMIENTO_MAQUILA') {
    return {
      label: 'REACONDICIONAMIENTO MAQUILA',
      icon: <Layers size={14} />,
      color: '#8b5cf6',
      bg: 'rgba(139,92,246,0.12)',
      badgeClass: 'badge-purple',
      sign: '',
      category: 'OTRO',
    };
  }
  if (t.includes('MERMA') || t === 'DESVIO_MERMA') {
    return {
      label: t.replace(/_/g, ' '),
      icon: <Trash2 size={14} />,
      color: '#dc2626',
      bg: 'rgba(220,38,38,0.12)',
      badgeClass: 'badge-danger',
      sign: '−',
      category: 'SALIDA',
    };
  }
  return {
    label: t.replace(/_/g, ' '),
    icon: <ArrowRight size={14} />,
    color: 'var(--text-secondary, #64748b)',
    bg: 'var(--bg-secondary, rgba(148,163,184,0.1))',
    badgeClass: 'badge-default',
    sign: '',
    category: 'OTRO',
  };
};

type DatePreset = 'ALL' | 'TODAY' | '7D' | '30D' | 'CUSTOM';

interface InventoryMovementRecord {
  id: string;
  fechaHora: string;
  tipoMovimiento: string;
  almacenId?: string;
  skuId?: string;
  clienteId?: string;
  lotId?: string;
  huId?: string;
  fromLocationId?: string;
  toLocationId?: string;
  cantidad: number;
  usuario?: string;
  motivo?: string;
  documentoOrigen?: string;
  sku?: {
    codigo?: string;
    descripcion?: string;
    uomBase?: string;
  };
  fromLocation?: {
    codigo?: string;
  };
  toLocation?: {
    codigo?: string;
  };
  almacen?: {
    codigo?: string;
    nombre?: string;
  };
  lote?: {
    lote?: string;
    fechaVencimiento?: string;
  };
  hu?: {
    codigo?: string;
  };
}

interface RelatedRetry {
  id: string;
  fechaHora: string;
  tipoMovimiento: string;
  documentoOrigen?: string;
  cantidad: number;
  diffMs: number;
}

interface RetryMapEntry {
  isPossibleRetry: boolean;
  relatedMovements: RelatedRetry[];
}

export function Traceability() {
  const { token } = useAuth();
  const [movements, setMovements] = useState<InventoryMovementRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterTipo, setFilterTipo] = useState('');
  const [filterCliente, setFilterCliente] = useState('');
  const [datePreset, setDatePreset] = useState<DatePreset>('ALL');
  const [customDesde, setCustomDesde] = useState('');
  const [customHasta, setCustomHasta] = useState('');
  const [clients, setClients] = useState<any[]>([]);
  const [selectedMovement, setSelectedMovement] = useState<InventoryMovementRecord | null>(null);

  const headers: any = useMemo(() => ({
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
  }), [token]);

  // Modal Escape key listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedMovement(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    loadData();
  }, [datePreset, customDesde, customHasta]);

  async function loadData() {
    setLoading(true);
    try {
      // Build query params for movements endpoint
      const params = new URLSearchParams();
      params.set('limit', '1000');

      if (datePreset === 'TODAY') {
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        params.set('desde', start.toISOString());
      } else if (datePreset === '7D') {
        const start = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        params.set('desde', start.toISOString());
      } else if (datePreset === '30D') {
        const start = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        params.set('desde', start.toISOString());
      } else if (datePreset === 'CUSTOM') {
        if (customDesde) {
          const dStart = new Date(customDesde + 'T00:00:00');
          params.set('desde', dStart.toISOString());
        }
        if (customHasta) {
          const dEnd = new Date(customHasta + 'T23:59:59.999');
          params.set('hasta', dEnd.toISOString());
        }
      }

      const [movRes, cliRes] = await Promise.all([
        fetch(`${API}/inventory/movements?${params.toString()}`, { headers }),
        fetch(`${API}/clients`, { headers }),
      ]);
      if (movRes.ok) setMovements(await movRes.json());
      if (cliRes.ok) setClients(await cliRes.json());
    } catch (err) {
      console.error('Error loading traceability data:', err);
    }
    setLoading(false);
  }

  // Detección visual conservadora de posibles reintentos históricos
  // Regla fuerte: Mismo SKU, misma cantidad, mismo origen, mismo destino, mismo documento,
  // mismo tipo, mismo usuario, intervalo temporal <= 5 segundos y ausencia de HUs distintas.
  const retryAnalysis = useMemo(() => {
    const map = new Map<string, RetryMapEntry>();

    for (let i = 0; i < movements.length; i++) {
      const a = movements[i];
      const related: RelatedRetry[] = [];

      for (let j = 0; j < movements.length; j++) {
        if (i === j) continue;
        const b = movements[j];

        // 1. Mismo SKU
        const sameSku = (a.skuId && b.skuId && a.skuId === b.skuId) ||
                        (a.sku?.codigo && b.sku?.codigo && a.sku.codigo === b.sku.codigo);
        if (!sameSku) continue;

        // 2. Misma Cantidad
        const sameQty = Number(a.cantidad) === Number(b.cantidad);
        if (!sameQty) continue;

        // 3. Mismo Origen
        const fromA = a.fromLocationId || a.fromLocation?.codigo || null;
        const fromB = b.fromLocationId || b.fromLocation?.codigo || null;
        if (fromA !== fromB) continue;

        // 4. Mismo Destino
        const toA = a.toLocationId || a.toLocation?.codigo || null;
        const toB = b.toLocationId || b.toLocation?.codigo || null;
        if (toA !== toB) continue;

        // 5. Mismo Documento Origen
        const docA = a.documentoOrigen || null;
        const docB = b.documentoOrigen || null;
        if (docA !== docB) continue;

        // 6. Mismo Tipo de Movimiento
        if (a.tipoMovimiento !== b.tipoMovimiento) continue;

        // 7. Mismo Usuario
        if (a.usuario !== b.usuario) continue;

        // 8. Timestamps extremadamente cercanos (<= 5 segundos)
        const diffMs = Math.abs(new Date(a.fechaHora).getTime() - new Date(b.fechaHora).getTime());
        if (diffMs > 5000) continue;

        // 9. Ausencia de HUs distintas que justifiquen eventos separados
        // Si ambos tienen HUs distintas asignadas (ej. BOX-REC-2026-0017-0001 vs 0002), es una operación legítima independiente
        const huA = a.hu?.codigo || null;
        const huB = b.hu?.codigo || null;
        if (huA && huB && huA !== huB) {
          continue;
        }

        related.push({
          id: b.id,
          fechaHora: b.fechaHora,
          tipoMovimiento: b.tipoMovimiento,
          documentoOrigen: b.documentoOrigen,
          cantidad: b.cantidad,
          diffMs
        });
      }

      if (related.length > 0) {
        map.set(a.id, {
          isPossibleRetry: true,
          relatedMovements: related
        });
      }
    }

    return map;
  }, [movements]);

  // Client-side search and filters
  const filtered = useMemo(() => {
    return movements.filter(m => {
      // Type filter
      if (filterTipo && m.tipoMovimiento !== filterTipo) {
        return false;
      }

      // Depositor filter (clienteId)
      if (filterCliente && m.clienteId !== filterCliente) {
        return false;
      }

      // Search keyword filter across SKU, description, lote, HU, folio, motivo, user, locations, depositor
      if (search.trim()) {
        const term = search.toLowerCase().trim();
        const client = clients.find(c => c.id === m.clienteId);
        const clientName = (client?.nombreComercial || client?.razonSocial || '').toLowerCase();
        const match =
          (m.sku?.codigo && m.sku.codigo.toLowerCase().includes(term)) ||
          (m.sku?.descripcion && m.sku.descripcion.toLowerCase().includes(term)) ||
          (m.lote?.lote && m.lote.lote.toLowerCase().includes(term)) ||
          (m.hu?.codigo && m.hu.codigo.toLowerCase().includes(term)) ||
          (m.documentoOrigen && m.documentoOrigen.toLowerCase().includes(term)) ||
          (m.motivo && m.motivo.toLowerCase().includes(term)) ||
          (m.usuario && m.usuario.toLowerCase().includes(term)) ||
          (m.fromLocation?.codigo && m.fromLocation.codigo.toLowerCase().includes(term)) ||
          (m.toLocation?.codigo && m.toLocation.codigo.toLowerCase().includes(term)) ||
          clientName.includes(term);

        if (!match) return false;
      }

      return true;
    });
  }, [movements, filterTipo, filterCliente, search, clients]);

  // Group by date (descending chronological days)
  const grouped = useMemo(() => {
    const map: Record<string, InventoryMovementRecord[]> = {};
    filtered.forEach(m => {
      const dateKey = new Date(m.fechaHora).toLocaleDateString('es-MX', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      });
      if (!map[dateKey]) map[dateKey] = [];
      map[dateKey].push(m);
    });
    return map;
  }, [filtered]);

  // Unique types present in loaded movements
  const availableTipos = useMemo(() => {
    const list = Array.from(new Set(movements.map(m => m.tipoMovimiento).filter(Boolean)));
    return list.sort();
  }, [movements]);

  // Dynamic KPIs derived exclusively from filtered operational records
  const totalEntradas = useMemo(() => {
    return filtered
      .filter(m => m.tipoMovimiento === 'ENTRADA' || m.tipoMovimiento === 'AJUSTE_ENTRADA')
      .reduce((s, m) => s + (Number(m.cantidad) || 0), 0);
  }, [filtered]);

  const totalSalidas = useMemo(() => {
    return filtered
      .filter(m => m.tipoMovimiento === 'SALIDA' || m.tipoMovimiento === 'SALIDA_PEDIDO' || m.tipoMovimiento === 'AJUSTE_SALIDA')
      .reduce((s, m) => s + (Number(m.cantidad) || 0), 0);
  }, [filtered]);

  const totalTrasiegos = useMemo(() => {
    return filtered
      .filter(m => m.tipoMovimiento === 'TRASIEGO' || m.tipoMovimiento === 'TRASIEGO_MANUAL' || m.tipoMovimiento === 'TRANSFERENCIA')
      .reduce((s, m) => s + (Number(m.cantidad) || 0), 0);
  }, [filtered]);

  const activeOperatorsCount = useMemo(() => {
    const set = new Set(filtered.map(m => m.usuario).filter(Boolean));
    return set.size;
  }, [filtered]);

  const hasActiveFilters = Boolean(
    search.trim() || filterTipo || filterCliente || datePreset !== 'ALL' || customDesde || customHasta
  );

  const handleResetFilters = () => {
    setSearch('');
    setFilterTipo('');
    setFilterCliente('');
    setDatePreset('ALL');
    setCustomDesde('');
    setCustomHasta('');
  };

  // CSV Export respecting active filters
  const handleExportCSV = () => {
    if (filtered.length === 0) {
      alert('No hay movimientos en el filtro seleccionado para exportar.');
      return;
    }

    const headersList = [
      'ID Auditoria',
      'Fecha / Hora',
      'Tipo de Movimiento',
      'Folio / Documento',
      'Depositante',
      'SKU',
      'Descripcion',
      'Lote',
      'Vencimiento Lote',
      'Handling Unit (HU)',
      'Cantidad',
      'UOM',
      'Origen',
      'Destino',
      'Operador',
      'Almacen',
      'Motivo'
    ];

    const escapeCsv = (val: any) => {
      if (val === null || val === undefined) return '""';
      const str = String(val).replace(/"/g, '""');
      return `"${str}"`;
    };

    const rows = filtered.map(m => {
      const client = clients.find(c => c.id === m.clienteId);
      const depositor = client?.nombreComercial || client?.razonSocial || 'N/A';
      const fromLoc = m.fromLocation?.codigo || (m.tipoMovimiento === 'ENTRADA' ? 'RAMPA' : 'N/D');
      const toLoc = m.toLocation?.codigo || (m.tipoMovimiento.includes('SALIDA') ? 'CLIENTE' : m.tipoMovimiento === 'ENVIO_CUARENTENA' ? 'CUARENTENA' : 'N/D');
      const uom = m.sku?.uomBase || 'PZA';
      const almac = m.almacen?.nombre || m.almacen?.codigo || m.almacenId || 'Central';

      return [
        escapeCsv(m.id),
        escapeCsv(new Date(m.fechaHora).toLocaleString('es-MX')),
        escapeCsv(m.tipoMovimiento),
        escapeCsv(m.documentoOrigen || 'N/A'),
        escapeCsv(depositor),
        escapeCsv(m.sku?.codigo || 'N/A'),
        escapeCsv(m.sku?.descripcion || 'N/A'),
        escapeCsv(m.lote?.lote || 'N/A'),
        escapeCsv(m.lote?.fechaVencimiento ? new Date(m.lote.fechaVencimiento).toLocaleDateString('es-MX') : 'N/A'),
        escapeCsv(m.hu?.codigo || 'N/A'),
        escapeCsv(m.cantidad),
        escapeCsv(uom),
        escapeCsv(fromLoc),
        escapeCsv(toLoc),
        escapeCsv(m.usuario || 'Sistema'),
        escapeCsv(almac),
        escapeCsv(m.motivo || 'Operacion estandar')
      ].join(',');
    });

    // Prepend UTF-8 Byte Order Mark (BOM) for correct Excel encoding of accents
    const csvContent = '\uFEFF' + [headersList.join(','), ...rows].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const dateStr = new Date().toISOString().split('T')[0];
    link.href = url;
    link.setAttribute('download', `kardex_trazabilidad_${dateStr}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const selectedRetryInfo = selectedMovement ? retryAnalysis.get(selectedMovement.id) : null;

  return (
    <div className="page-container">
      {/* Header */}
      <div className="page-header" style={{ marginBottom: 16 }}>
        <div>
          <h1 className="page-title">Trazabilidad & Kárdex</h1>
          <p className="page-subtitle">
            {movements.length} movimientos en base &middot; {filtered.length} visibles bajo filtros activos &middot; Auditoría inmutable WMS
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button
            className="btn btn-secondary"
            onClick={handleExportCSV}
            title="Exportar movimientos filtrados a CSV para auditoría"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Download size={15} />
            <span>CSV</span>
          </button>
          <button
            className="btn btn-secondary"
            onClick={loadData}
            title="Actualizar movimientos desde la base de datos"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            <span>Actualizar</span>
          </button>
        </div>
      </div>

      {/* Dynamic Operational KPIs */}
      <div className="stats-grid" style={{ marginBottom: 18 }}>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(16,185,129,0.1)', color: 'var(--emerald)' }}>
            <ArrowDown size={20} />
          </div>
          <div className="stat-info">
            <span className="stat-value">{totalEntradas.toLocaleString()}</span>
            <span className="stat-label">Uds Ingresadas</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>
            <ArrowUp size={20} />
          </div>
          <div className="stat-info">
            <span className="stat-value">{totalSalidas.toLocaleString()}</span>
            <span className="stat-label">Uds Despachadas</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'var(--info-soft)', color: 'var(--info)' }}>
            <RefreshCw size={20} />
          </div>
          <div className="stat-info">
            <span className="stat-value">{totalTrasiegos.toLocaleString()}</span>
            <span className="stat-label">Uds Trasiegos Internos</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(99,102,241,0.1)', color: 'var(--purple)' }}>
            <User size={20} />
          </div>
          <div className="stat-info">
            <span className="stat-value">{activeOperatorsCount}</span>
            <span className="stat-label">Operadores Activos</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
              {filtered.length} transacciones auditadas
            </span>
          </div>
        </div>
      </div>

      {/* Compact Horizontal Filter Bar */}
      <div className="card" style={{ marginBottom: 20, padding: '12px 16px' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* 1. Universal Search Input */}
          <div className="search-box" style={{ flex: '1 1 240px', minWidth: 220, height: 38 }}>
            <Search size={15} style={{ color: 'var(--text-muted)' }} />
            <input
              type="text"
              placeholder="Buscar SKU, producto, lote, HU, folio, motivo, ubicación..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ fontSize: 13 }}
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--text-muted)' }}
                title="Limpiar búsqueda"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* 2. Movement Type Selector */}
          <select
            className="form-select"
            style={{ width: 'auto', minWidth: 170, height: 38, fontSize: 13 }}
            value={filterTipo}
            onChange={e => setFilterTipo(e.target.value)}
          >
            <option value="">Tipo de movimiento</option>
            {availableTipos.map(t => (
              <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
            ))}
          </select>

          {/* 3. Depositor Selector */}
          <select
            className="form-select"
            style={{ width: 'auto', minWidth: 180, height: 38, fontSize: 13 }}
            value={filterCliente}
            onChange={e => setFilterCliente(e.target.value)}
          >
            <option value="">Todos los depositantes</option>
            {clients.map(c => (
              <option key={c.id} value={c.id}>{c.nombreComercial || c.razonSocial}</option>
            ))}
          </select>

          {/* 4. Date Range Preset Selector */}
          <select
            className="form-select"
            style={{ width: 'auto', minWidth: 160, height: 38, fontSize: 13 }}
            value={datePreset}
            onChange={e => setDatePreset(e.target.value as DatePreset)}
          >
            <option value="ALL">Todo el historial</option>
            <option value="TODAY">Hoy</option>
            <option value="7D">Últimos 7 días</option>
            <option value="30D">Últimos 30 días</option>
            <option value="CUSTOM">Personalizado...</option>
          </select>

          {/* Custom Date Inputs if CUSTOM is active */}
          {datePreset === 'CUSTOM' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="date"
                className="form-input"
                style={{ width: 130, height: 38, fontSize: 12, padding: '4px 8px' }}
                value={customDesde}
                onChange={e => setCustomDesde(e.target.value)}
                title="Fecha desde"
              />
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>a</span>
              <input
                type="date"
                className="form-input"
                style={{ width: 130, height: 38, fontSize: 12, padding: '4px 8px' }}
                value={customHasta}
                onChange={e => setCustomHasta(e.target.value)}
                title="Fecha hasta"
              />
            </div>
          )}

          {/* 5. Reset Filters Button */}
          {hasActiveFilters && (
            <button
              className="btn btn-ghost"
              onClick={handleResetFilters}
              title="Restablecer todos los filtros"
              style={{
                height: 38,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 13,
                color: 'var(--text-secondary)',
                padding: '0 10px'
              }}
            >
              <RotateCcw size={14} />
              <span>Restablecer</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Content / Timeline */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-secondary)' }}>
          <RefreshCw className="animate-spin" size={24} style={{ marginBottom: 8 }} />
          <div>Cargando kárdex de trazabilidad inmutable...</div>
        </div>
      ) : (
        <div className="traceability-timeline">
          {Object.entries(grouped).map(([date, items]) => (
            <div key={date} className="timeline-day">
              <div className="timeline-date">
                <Calendar size={14} />
                <span>{date}</span>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>({items.length} mov.)</span>
              </div>
              <div className="timeline-items">
                {items.map((m: InventoryMovementRecord, i: number) => {
                  const cfg = getTipoConfig(m.tipoMovimiento);
                  const client = clients.find(c => c.id === m.clienteId);
                  const depositorName = client?.nombreComercial || client?.razonSocial;
                  const uom = m.sku?.uomBase || 'uds';
                  const fromLoc = m.fromLocation?.codigo || (m.tipoMovimiento === 'ENTRADA' ? 'RAMPA' : 'ORIGEN');
                  const toLoc = m.toLocation?.codigo || (m.tipoMovimiento.includes('SALIDA') ? 'CLIENTE' : m.tipoMovimiento === 'ENVIO_CUARENTENA' ? 'CUARENTENA' : 'DESTINO');
                  const retryInfo = retryAnalysis.get(m.id);

                  return (
                    <div
                      key={m.id}
                      className="timeline-item animate-fade-in"
                      style={{
                        animationDelay: `${Math.min(i * 0.015, 0.3)}s`,
                        cursor: 'pointer'
                      }}
                      onClick={() => setSelectedMovement(m)}
                    >
                      <div className="timeline-dot" style={{ background: cfg.bg, color: cfg.color }}>
                        {cfg.icon}
                      </div>
                      <div className="timeline-content">
                        {/* Header: Badge, Quantity, Time & Discreet Detail Trigger */}
                        <div className="timeline-header">
                          <span className={`badge ${cfg.badgeClass}`}>
                            {cfg.label}
                          </span>
                          <span
                            className="timeline-qty"
                            style={{
                              color: cfg.category === 'SALIDA' ? 'var(--danger)' :
                                     cfg.category === 'ENTRADA' ? 'var(--emerald)' :
                                     cfg.category === 'CUARENTENA' ? '#d97706' :
                                     cfg.category === 'TRASIEGO' ? 'var(--info)' :
                                     'var(--text-primary)',
                              fontWeight: 800
                            }}
                          >
                            {cfg.sign}{m.cantidad} {uom}
                          </span>
                          <span className="timeline-time" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <Clock size={11} />
                            {new Date(m.fechaHora).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                          </span>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedMovement(m);
                            }}
                            style={{
                              padding: '2px 8px',
                              fontSize: 11,
                              height: 22,
                              color: 'var(--primary)',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4
                            }}
                            title="Ver ficha completa de auditoría"
                          >
                            <Eye size={12} />
                            <span>Detalle</span>
                          </button>
                        </div>

                        {/* Product info */}
                        <div className="timeline-product">
                          <Package size={13} />
                          <strong>{m.sku?.descripcion || m.sku?.codigo || 'Producto sin descripción'}</strong>
                          {m.sku?.codigo && (
                            <code style={{ fontSize: 11, marginLeft: 6, color: 'var(--primary)', fontWeight: 600 }}>
                              {m.sku.codigo}
                            </code>
                          )}
                        </div>

                        {/* Audit Tags: Lote, HU, Origin -> Destination, Folio & Discrete Retry Badge */}
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4, marginBottom: 4 }}>
                          {m.lote?.lote && (
                            <span className="badge badge-default" style={{ fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                              <Tag size={10} /> Lote: {m.lote.lote}
                            </span>
                          )}
                          {m.hu?.codigo && (
                            <span className="badge badge-default" style={{ fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                              <Box size={10} /> HU: {m.hu.codigo}
                            </span>
                          )}
                          <span className="badge badge-info" style={{ fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <MapPin size={10} /> {fromLoc} <ArrowRight size={10} /> {toLoc}
                          </span>
                          {m.documentoOrigen && (
                            <span className="badge badge-default" style={{ fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                              <FileText size={10} /> Folio: {m.documentoOrigen}
                            </span>
                          )}
                          {/* Señal discreta y no alarmista de posible reintento histórico */}
                          {retryInfo?.isPossibleRetry && (
                            <span
                              className="badge"
                              style={{
                                fontSize: 10,
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                                background: 'rgba(100, 116, 139, 0.08)',
                                color: 'var(--text-secondary, #64748B)',
                                border: '1px solid #CBD5E1',
                                fontWeight: 500,
                              }}
                              title="Este movimiento presenta coincidencias con otro registro generado en un intervalo de tiempo muy corto. Se conserva íntegro por política de auditoría WMS."
                            >
                              <History size={10} /> Posible reintento histórico
                            </span>
                          )}
                        </div>

                        {/* Reason / Details */}
                        {m.motivo && (
                          <div className="timeline-details" style={{ marginTop: 2 }}>
                            <span className="timeline-detail">{m.motivo}</span>
                          </div>
                        )}

                        {/* Operational Meta: User and Depositor */}
                        <div className="timeline-meta" style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 4 }}>
                          <span><User size={11} /> {m.usuario || 'Sistema'}</span>
                          {depositorName && (
                            <span><Building2 size={11} /> {depositorName}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {filtered.length === 0 && (
            <div className="card">
              <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-tertiary)' }}>
                <GitBranch size={32} style={{ opacity: 0.3, marginBottom: 12 }} />
                <div style={{ fontWeight: 600, fontSize: 14 }}>Sin movimientos registrados</div>
                <div style={{ fontSize: 12, marginTop: 4, color: 'var(--text-muted)' }}>
                  No se encontraron transacciones que coincidan con los filtros aplicados.
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Read-Only Audit Detail Modal */}
      {selectedMovement && (
        <div
          className="modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelectedMovement(null);
          }}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(3px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 16,
          }}
        >
          <div
            className="modal-container"
            style={{
              width: '100%',
              maxWidth: 680,
              maxHeight: '90vh',
              backgroundColor: '#FFFFFF',
              borderRadius: 12,
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              border: '1px solid var(--border, #E2E8F0)',
            }}
          >
            {/* Modal Header */}
            <div
              style={{
                padding: '16px 20px',
                borderBottom: '1px solid var(--border, #E2E8F0)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                backgroundColor: '#F8FAFC',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 8,
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    color: 'var(--primary, #2563EB)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <ShieldCheck size={18} />
                </div>
                <div>
                  <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text-primary, #0F172A)' }}>
                    Detalle de Movimiento de Inventario
                  </h2>
                  <p style={{ margin: 0, fontSize: 12, color: 'var(--text-secondary, #64748B)' }}>
                    Registro inmutable de auditoría WMS &middot; Solo lectura
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedMovement(null)}
                className="btn btn-ghost"
                style={{ padding: 6, borderRadius: 6, color: 'var(--text-muted)' }}
                title="Cerrar ventana (Escape)"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Scrollable Body */}
            <div style={{ padding: '20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Highlight summary card */}
              {(() => {
                const cfg = getTipoConfig(selectedMovement.tipoMovimiento);
                const uom = selectedMovement.sku?.uomBase || 'PZA';
                const client = clients.find(c => c.id === selectedMovement.clienteId);
                const depositor = client?.nombreComercial || client?.razonSocial || 'No especificado';

                return (
                  <div
                    style={{
                      background: cfg.bg,
                      border: `1px solid ${cfg.color}33`,
                      borderRadius: 10,
                      padding: '14px 18px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: 12,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: 8,
                          background: '#FFFFFF',
                          color: cfg.color,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
                        }}
                      >
                        {cfg.icon}
                      </div>
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: cfg.color, letterSpacing: 0.5 }}>
                          {cfg.label}
                        </div>
                        <div style={{ fontSize: 13, color: 'var(--text-secondary, #475569)', marginTop: 2 }}>
                          {depositor}
                        </div>
                      </div>
                    </div>

                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 18, fontWeight: 800, color: cfg.color }}>
                        {cfg.sign}{selectedMovement.cantidad} {uom}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted, #64748B)', marginTop: 2 }}>
                        {new Date(selectedMovement.fechaHora).toLocaleString('es-MX')}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Data Grid with all verified attributes */}
              {(() => {
                const client = clients.find(c => c.id === selectedMovement.clienteId);
                const depositor = client?.nombreComercial || client?.razonSocial || 'No especificado';
                const fromLoc = selectedMovement.fromLocation?.codigo || (selectedMovement.tipoMovimiento === 'ENTRADA' ? 'RAMPA / PROVEEDOR' : 'No especificado');
                const toLoc = selectedMovement.toLocation?.codigo || (selectedMovement.tipoMovimiento.includes('SALIDA') ? 'CLIENTE / DESTINO FINAL' : selectedMovement.tipoMovimiento === 'ENVIO_CUARENTENA' ? 'Zona de Cuarentena' : 'No especificado');
                const almacen = selectedMovement.almacen?.nombre
                  ? `${selectedMovement.almacen.nombre} (${selectedMovement.almacen.codigo})`
                  : (selectedMovement.almacenId || 'Almacén Central');

                return (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
                    {/* Producto / SKU */}
                    <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, padding: 12 }}>
                      <div style={{ fontSize: 11, color: '#64748B', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Package size={12} /> PRODUCTO &middot; SKU
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#0F172A', marginTop: 4 }}>
                        {selectedMovement.sku?.descripcion || 'Sin descripción'}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--primary, #2563EB)', fontWeight: 600, marginTop: 2 }}>
                        Código: <code>{selectedMovement.sku?.codigo || 'N/D'}</code>
                      </div>
                    </div>

                    {/* Depositante */}
                    <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, padding: 12 }}>
                      <div style={{ fontSize: 11, color: '#64748B', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Building2 size={12} /> DEPOSITANTE (CLIENTE 3PL)
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#0F172A', marginTop: 4 }}>
                        {depositor}
                      </div>
                      <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>
                        Propiedad formal de mercancía
                      </div>
                    </div>

                    {/* Lote */}
                    <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, padding: 12 }}>
                      <div style={{ fontSize: 11, color: '#64748B', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Tag size={12} /> LOTE ASOCIADO
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#0F172A', marginTop: 4 }}>
                        {selectedMovement.lote?.lote || 'Sin lote'}
                      </div>
                      <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>
                        {selectedMovement.lote?.fechaVencimiento
                          ? `Vence: ${new Date(selectedMovement.lote.fechaVencimiento).toLocaleDateString('es-MX')}`
                          : 'Sin fecha de vencimiento'}
                      </div>
                    </div>

                    {/* Handling Unit (HU) */}
                    <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, padding: 12 }}>
                      <div style={{ fontSize: 11, color: '#64748B', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Box size={12} /> HANDLING UNIT (HU)
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#0F172A', marginTop: 4 }}>
                        {selectedMovement.hu?.codigo || 'Sin HU (Inventario a granel)'}
                      </div>
                      <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>
                        {selectedMovement.hu?.codigo ? 'Contenedor / Caja física serializada' : 'Partida sin contenedorización'}
                      </div>
                    </div>

                    {/* Flujo Físico: Origen -> Destino */}
                    <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, padding: 12, gridColumn: 'span 2' }}>
                      <div style={{ fontSize: 11, color: '#64748B', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <MapPin size={12} /> FLUJO FÍSICO (ORIGEN &rarr; DESTINO)
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 6 }}>
                        <div style={{ flex: 1, background: '#FFFFFF', padding: '8px 12px', borderRadius: 6, border: '1px solid #CBD5E1' }}>
                          <span style={{ fontSize: 10, color: '#64748B', textTransform: 'uppercase', display: 'block' }}>Ubicación Origen</span>
                          <strong style={{ fontSize: 13, color: '#0F172A' }}>{fromLoc}</strong>
                        </div>
                        <ArrowRight size={16} style={{ color: '#64748B', flexShrink: 0 }} />
                        <div style={{ flex: 1, background: '#FFFFFF', padding: '8px 12px', borderRadius: 6, border: '1px solid #CBD5E1' }}>
                          <span style={{ fontSize: 10, color: '#64748B', textTransform: 'uppercase', display: 'block' }}>Ubicación Destino</span>
                          <strong style={{ fontSize: 13, color: '#0F172A' }}>{toLoc}</strong>
                        </div>
                      </div>
                    </div>

                    {/* Folio / Documento de origen */}
                    <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, padding: 12 }}>
                      <div style={{ fontSize: 11, color: '#64748B', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <FileText size={12} /> DOCUMENTO / FOLIO
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#0F172A', marginTop: 4 }}>
                        {selectedMovement.documentoOrigen || 'Sin folio asociado'}
                      </div>
                      <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>
                        Orden o comprobante de operación
                      </div>
                    </div>

                    {/* Operador responsable */}
                    <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, padding: 12 }}>
                      <div style={{ fontSize: 11, color: '#64748B', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <User size={12} /> OPERADOR / USUARIO
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#0F172A', marginTop: 4 }}>
                        {selectedMovement.usuario || 'Sistema WMS'}
                      </div>
                      <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>
                        Usuario que autorizó o ejecutó
                      </div>
                    </div>

                    {/* Almacén */}
                    <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, padding: 12 }}>
                      <div style={{ fontSize: 11, color: '#64748B', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Building2 size={12} /> ALMACÉN
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#0F172A', marginTop: 4 }}>
                        {almacen}
                      </div>
                    </div>

                    {/* Motivo operativo */}
                    <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, padding: 12 }}>
                      <div style={{ fontSize: 11, color: '#64748B', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <FileText size={12} /> MOTIVO OPERATIVO
                      </div>
                      <div style={{ fontSize: 13, color: '#0F172A', marginTop: 4 }}>
                        {selectedMovement.motivo || 'Operación estándar registrada en sistema'}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Observación de auditoría (solo cuando cumpla la regla de posible reintento) */}
              {selectedRetryInfo?.isPossibleRetry && (
                <div
                  style={{
                    background: '#F8FAFC',
                    border: '1px solid #E2E8F0',
                    borderRadius: 8,
                    padding: '12px 14px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: '#475569' }}>
                    <History size={14} style={{ color: '#64748B' }} />
                    <span>Observación de auditoría</span>
                  </div>
                  <p style={{ margin: 0, fontSize: 12, color: '#64748B', lineHeight: 1.5 }}>
                    Se detectó un registro históricamente similar generado en un intervalo temporal muy cercano. Ambos registros se conservan sin alteraciones para preservar la integridad del Kárdex.
                  </p>
                  {selectedRetryInfo.relatedMovements.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                      {selectedRetryInfo.relatedMovements.map((rel) => (
                        <div
                          key={rel.id}
                          style={{
                            background: '#FFFFFF',
                            border: '1px solid #E2E8F0',
                            borderRadius: 6,
                            padding: '8px 10px',
                            fontSize: 11,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            flexWrap: 'wrap',
                            gap: 6,
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontWeight: 600, color: '#334155' }}>
                              {new Date(rel.fechaHora).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                            </span>
                            <span className="badge badge-default" style={{ fontSize: 10 }}>
                              {rel.tipoMovimiento}
                            </span>
                            {rel.documentoOrigen && (
                              <span style={{ color: '#64748B' }}>
                                Folio: {rel.documentoOrigen}
                              </span>
                            )}
                          </div>
                          <code style={{ fontSize: 10, color: '#94A3B8' }}>
                            ID: {rel.id}
                          </code>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Technical Audit Banner (Discrete) */}
              <div
                style={{
                  background: '#F1F5F9',
                  borderRadius: 6,
                  padding: '8px 12px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  fontSize: 11,
                  color: '#64748B',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Lock size={12} />
                  <span>Transacción inmutable registrada en PostgreSQL</span>
                </div>
                <code>ID: {selectedMovement.id}</code>
              </div>
            </div>

            {/* Modal Footer */}
            <div
              style={{
                padding: '12px 20px',
                borderTop: '1px solid var(--border, #E2E8F0)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-end',
                backgroundColor: '#F8FAFC',
              }}
            >
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setSelectedMovement(null)}
                style={{ minWidth: 100 }}
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
