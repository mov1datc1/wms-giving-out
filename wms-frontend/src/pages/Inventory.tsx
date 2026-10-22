import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { API } from '../config/api';
import {
  Download, RefreshCw, Box, Search, MapPin, Calendar,
  AlertTriangle, CheckCircle2, Lock,
  PlusCircle, Layers, Eye, X, Clock, Info, Boxes, ShieldAlert,
  ChevronDown, ArrowRight, ArrowRightLeft, Shield
} from 'lucide-react';
import { TransferModal } from '../components/TransferModal';
import { QuarantineModal } from '../components/QuarantineModal';
import { formatCalendarDate } from '../utils/dateUtils';

const CALIDAD_TOOLTIP = 'Resultado de inspección de calidad. No determina por sí solo la disponibilidad comercial; también aplican caducidad, ubicación y restricciones operativas.';

export function Inventory() {
  const { token, user } = useAuth();

  // Datos de Inventario General Consolidado (Vista Única Canónica)
  const [consolidatedData, setConsolidatedData] = useState<any[]>([]);
  const [consolidatedKpis, setConsolidatedKpis] = useState<any | null>(null);
  const [consolidatedClasificacionFilter, setConsolidatedClasificacionFilter] = useState<string>('TODOS');
  const [selectedConsolidatedItem, setSelectedConsolidatedItem] = useState<any | null>(null);

  // Filtros globales y depositantes
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterClient, setFilterClient] = useState('');
  const [clients, setClients] = useState<any[]>([]);

  // Modales operativos contextuales por partida
  const [selectedTransferItem, setSelectedTransferItem] = useState<any | null>(null);
  const [selectedQuarantineItem, setSelectedQuarantineItem] = useState<any | null>(null);
  const [openActionMenuId, setOpenActionMenuId] = useState<string | null>(null);

  const headers = { Authorization: `Bearer ${token}` };

  // Cierre de dropdowns contextuales con click exterior o Escape
  useEffect(() => {
    if (!openActionMenuId) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.action-menu-container')) {
        setOpenActionMenuId(null);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenActionMenuId(null);
    };
    document.addEventListener('click', handleClickOutside);
    window.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('click', handleClickOutside);
      window.removeEventListener('keydown', handleKey);
    };
  }, [openActionMenuId]);

  // Cierre de modal de detalle con tecla Escape
  useEffect(() => {
    if (!selectedConsolidatedItem) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedConsolidatedItem(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedConsolidatedItem]);

  useEffect(() => {
    loadData();
  }, [filterClient]);

  async function loadData() {
    setLoading(true);
    try {
      let url = `${API}/inventory/consolidated?`;
      if (filterClient) url += `clienteId=${filterClient}&`;

      const [cRes, clientsRes] = await Promise.all([
        fetch(url, { headers }),
        clients.length === 0 ? fetch(`${API}/clients`, { headers }) : Promise.resolve(null),
      ]);

      if (cRes.ok) {
        const resJson = await cRes.json();
        setConsolidatedData(resJson.items || []);
        setConsolidatedKpis(resJson.kpis || null);
      }
      if (clientsRes && clientsRes.ok) {
        setClients(await clientsRes.json());
      }
    } catch (err) {
      console.error('Error al cargar inventario consolidado:', err);
    }
    setLoading(false);
  }

  // Elementos acotados por depositante para calcular los contadores de navegación
  const clientScopedData = consolidatedData.filter(item => {
    return !filterClient || item.clienteId === filterClient || item.cliente?.id === filterClient;
  });

  // Contadores canónicos 100% excluyentes (su suma equivale a countTodos)
  const countTodos = clientScopedData.length;
  const countMerma = clientScopedData.filter(x => x.clasificacion === 'MERMA').length;
  const countExceso = clientScopedData.filter(x => x.clasificacion === 'EXCESO' || x.clasificacion === 'CUARENTENA').length;
  const countExpirado = clientScopedData.filter(x => x.clasificacion === 'EXPIRADO').length;
  const countTransito = clientScopedData.filter(x => x.clasificacion === 'TRANSITO').length;
  const countStaging = clientScopedData.filter(x => x.clasificacion === 'STAGING').length;
  const countConforme = clientScopedData.filter(x => x.clasificacion === 'CONFORME').length;

  // Filtrado final de la tabla (búsqueda + depositante + clasificación operativa seleccionada)
  const filteredConsolidated = clientScopedData.filter(item => {
    const q = search.toLowerCase().trim();
    const matchHu = item.handlingUnits?.some(
      (hu: any) =>
        hu.codigo?.toLowerCase().includes(q) ||
        hu.loteTexto?.toLowerCase().includes(q),
    );
    const matchSearch = !q ||
      item.sku?.codigo?.toLowerCase().includes(q) ||
      item.sku?.descripcion?.toLowerCase().includes(q) ||
      item.sku?.nombre?.toLowerCase().includes(q) ||
      item.lote?.toLowerCase().includes(q) ||
      item.ubicacion?.codigo?.toLowerCase().includes(q) ||
      item.cliente?.nombreComercial?.toLowerCase().includes(q) ||
      (item.notas && item.notas.toLowerCase().includes(q)) ||
      matchHu;

    let matchClasif = true;
    if (consolidatedClasificacionFilter === 'TODOS') {
      matchClasif = true;
    } else if (consolidatedClasificacionFilter === 'MERMA') {
      matchClasif = item.clasificacion === 'MERMA';
    } else if (consolidatedClasificacionFilter === 'EXCESO') {
      matchClasif = item.clasificacion === 'EXCESO' || item.clasificacion === 'CUARENTENA';
    } else if (consolidatedClasificacionFilter === 'EXPIRADO') {
      matchClasif = item.clasificacion === 'EXPIRADO';
    } else if (consolidatedClasificacionFilter === 'TRANSITO') {
      matchClasif = item.clasificacion === 'TRANSITO';
    } else if (consolidatedClasificacionFilter === 'STAGING') {
      matchClasif = item.clasificacion === 'STAGING';
    } else if (consolidatedClasificacionFilter === 'CONFORME') {
      matchClasif = item.clasificacion === 'CONFORME';
    }

    return matchSearch && matchClasif;
  });

  // Exportación oficial en CSV del inventario consolidado
  function downloadCSV() {
    let csv = 'Clasificación,SKU,Descripción,Depositante,Lote,Vencimiento,Ubicación Física,Físico Total,Disponible Vendible,Reservado,Bloqueado,Calidad,HUs Bultos,Notas\n';
    filteredConsolidated.forEach(item => {
      const huCount = item.totalHus ?? item.handlingUnits?.length ?? 0;
      csv += `"${item.clasificacion || ''}","${item.sku?.codigo || ''}","${item.sku?.descripcion || item.sku?.nombre || ''}","${item.cliente?.nombreComercial || ''}","${item.lote || ''}","${item.fechaVencimiento ? formatCalendarDate(item.fechaVencimiento) : ''}","${item.ubicacion?.codigo || ''}",${item.cantidadFisica || 0},${item.cantidadDisponibleVendible || 0},${item.cantidadReservada || 0},${item.cantidadBloqueada || 0},"${item.estadoCalidad || ''}",${huCount},"${item.notas || ''}"\n`;
    });

    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `inventario_general_giving_out_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  return (
    <div className="page-container">
      {/* ========================================= */}
      {/* 1. ENCABEZADO PRINCIPAL                    */}
      {/* ========================================= */}
      <div className="page-header" style={{ alignItems: 'flex-start', marginBottom: 18 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1 className="page-title">Inventario & Control de Existencias</h1>
          </div>
          <p className="page-subtitle" style={{ marginTop: 4 }}>
            Control operativo unificado de existencias físicas, disponibilidad comercial, reservas y bloqueos en tiempo real.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn btn-secondary" onClick={downloadCSV} title="Descargar inventario filtrado en formato CSV">
            <Download size={16} /> CSV
          </button>
          <button className="btn btn-secondary" onClick={loadData} title="Actualizar datos del almacén">
            <RefreshCw size={16} /> Actualizar
          </button>
        </div>
      </div>

      {/* ========================================= */}
      {/* 2. KPIs SUPERIORES LIMPIOS Y CANÓNICOS    */}
      {/* ========================================= */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: 12,
        marginBottom: 18
      }}>
        {/* KPI 1: Físico Total Global */}
        <div className="card" style={{ padding: '14px 18px', borderLeft: '4px solid #0D9488', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 96 }}>
          <div style={{ fontSize: 11, color: '#64748B', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
            Físico Total Global
          </div>
          <div style={{ fontSize: 24, fontWeight: 900, color: 'var(--text-primary)', margin: '4px 0' }}>
            {(consolidatedKpis?.totalFisico ?? 0).toLocaleString()} <span style={{ fontSize: 12, fontWeight: 500, color: '#64748B' }}>pzas</span>
          </div>
          <div style={{ fontSize: 11, color: '#64748B' }}>
            {consolidatedKpis?.totalSkus ?? 0} SKUs · {consolidatedKpis?.totalLotes ?? 0} lotes
          </div>
        </div>

        {/* KPI 2: Disponible Vendible */}
        <div className="card" style={{ padding: '14px 18px', borderLeft: '4px solid #10B981', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 96 }}>
          <div style={{ fontSize: 11, color: '#059669', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
            Disponible Vendible
          </div>
          <div style={{ fontSize: 24, fontWeight: 900, color: '#10B981', margin: '4px 0' }}>
            {(consolidatedKpis?.totalDisponibleVendible ?? 0).toLocaleString()} <span style={{ fontSize: 12, fontWeight: 500, color: '#059669' }}>pzas</span>
          </div>
          <div style={{ fontSize: 11, color: '#059669', fontWeight: 600 }}>
            Libre para pedidos y surtido
          </div>
        </div>

        {/* KPI 3: Tránsito Inbound / Recibo */}
        <div className="card" style={{ padding: '14px 18px', borderLeft: '4px solid #D97706', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 96 }}>
          <div style={{ fontSize: 11, color: '#D97706', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
            Tránsito Inbound / Recibo
          </div>
          <div style={{ fontSize: 24, fontWeight: 900, color: '#D97706', margin: '4px 0' }}>
            {(consolidatedKpis?.totalTransito ?? consolidatedKpis?.totalTransitoUbicacion ?? 0).toLocaleString()} <span style={{ fontSize: 12, fontWeight: 500, color: '#D97706' }}>pzas</span>
          </div>
          <div style={{ fontSize: 11, color: '#B45309', fontWeight: 600 }}>
            En andén · Pendiente Putaway
          </div>
        </div>

        {/* KPI 4: Stock Reservado */}
        <div className="card" style={{ padding: '14px 18px', borderLeft: '4px solid #6366F1', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 96 }}>
          <div style={{ fontSize: 11, color: '#4F46E5', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
            Stock Reservado
          </div>
          <div style={{ fontSize: 24, fontWeight: 900, color: '#6366F1', margin: '4px 0' }}>
            {(consolidatedKpis?.totalReservado ?? 0).toLocaleString()} <span style={{ fontSize: 12, fontWeight: 500, color: '#4F46E5' }}>pzas</span>
          </div>
          <div style={{ fontSize: 11, color: '#64748B' }}>
            Comprometido en pedidos
          </div>
        </div>

        {/* KPI 5: Bloqueado Total */}
        <div className="card" style={{ padding: '14px 18px', borderLeft: '4px solid #EF4444', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 96 }}>
          <div style={{ fontSize: 11, color: '#DC2626', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
            Bloqueado Total
          </div>
          <div style={{ fontSize: 24, fontWeight: 900, color: '#EF4444', margin: '4px 0' }}>
            {(consolidatedKpis?.totalBloqueado ?? 0).toLocaleString()} <span style={{ fontSize: 12, fontWeight: 500, color: '#DC2626' }}>pzas</span>
          </div>
          <div style={{ fontSize: 11, color: '#64748B' }}>
            Merma: {consolidatedKpis?.desgloseBloqueado?.totalMerma ?? 0} · Exceso: {consolidatedKpis?.desgloseBloqueado?.totalExceso ?? 0}
          </div>
        </div>

        {/* KPI 6: Caducado / Vencido */}
        <div className="card" style={{ padding: '14px 18px', borderLeft: '4px solid #DC2626', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 96 }}>
          <div style={{ fontSize: 11, color: '#DC2626', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
            Caducado / Vencido
          </div>
          <div style={{ fontSize: 24, fontWeight: 900, color: '#DC2626', margin: '4px 0' }}>
            {(consolidatedKpis?.totalExpirado ?? 0).toLocaleString()} <span style={{ fontSize: 12, fontWeight: 500, color: '#DC2626' }}>pzas</span>
          </div>
          <div style={{ fontSize: 11, color: '#DC2626', fontWeight: 600 }}>
            Retirado de venta comercial
          </div>
        </div>
      </div>

      {/* ========================================================= */}
      {/* 3. BARRA DE CONTROL INTEGRADA: BÚSQUEDA + CLIENTE + FILTROS */}
      {/* ========================================================= */}
      <div className="card" style={{ marginBottom: 18, padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Fila 1: Búsqueda y Selector de Depositante */}
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="search-box" style={{ flex: 1, minWidth: 260 }}>
            <Search size={16} />
            <input
              placeholder="Buscar por SKU, descripción, lote, ubicación, depositante o HU..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="btn btn-ghost btn-sm"
                style={{ padding: 2, height: 'auto', color: 'var(--text-tertiary)' }}
                title="Limpiar búsqueda"
              >
                <X size={14} />
              </button>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', minWidth: 240 }}>
            <select
              className="form-select"
              value={filterClient}
              onChange={e => setFilterClient(e.target.value)}
              style={{ width: '100%', fontSize: 13, height: 38 }}
            >
              <option value="">Todos los depositantes ({clients.length})</option>
              {clients.map((c: any) => (
                <option key={c.id} value={c.id}>{c.nombreComercial}</option>
              ))}
            </select>
          </div>

          {(search || filterClient || consolidatedClasificacionFilter !== 'TODOS') && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setSearch('');
                setFilterClient('');
                setConsolidatedClasificacionFilter('TODOS');
              }}
              style={{ fontSize: 12, color: 'var(--text-secondary)' }}
            >
              <RefreshCw size={13} /> Restablecer
            </button>
          )}
        </div>

        {/* Fila 2: Segmento de Navegación Operativa (7 Filtros Canónicos) */}
        <div style={{
          display: 'flex',
          gap: 6,
          flexWrap: 'nowrap',
          overflowX: 'auto',
          alignItems: 'center',
          borderTop: '1px solid var(--border)',
          paddingTop: 12,
          paddingBottom: 2,
          scrollbarWidth: 'thin',
          WebkitOverflowScrolling: 'touch',
        }}>
          <span style={{
            fontSize: 11,
            fontWeight: 700,
            color: 'var(--text-tertiary)',
            textTransform: 'uppercase',
            marginRight: 2,
            flexShrink: 0,
            whiteSpace: 'nowrap'
          }}>
            Clasificación:
          </span>

          {/* 1. Todos */}
          <button
            type="button"
            onClick={() => setConsolidatedClasificacionFilter('TODOS')}
            style={{
              padding: '4px 9px',
              borderRadius: 20,
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              flexShrink: 0,
              whiteSpace: 'nowrap',
              transition: 'all 0.15s ease',
              border: consolidatedClasificacionFilter === 'TODOS' ? '1px solid #0F172A' : '1px solid var(--border)',
              backgroundColor: consolidatedClasificacionFilter === 'TODOS' ? '#0F172A' : 'var(--bg-secondary)',
              color: consolidatedClasificacionFilter === 'TODOS' ? '#FFFFFF' : 'var(--text-secondary)',
            }}
          >
            <Layers size={13} />
            <span>Todos</span>
            <span style={{
              fontSize: 11,
              fontWeight: 800,
              padding: '1px 5px',
              borderRadius: 10,
              backgroundColor: consolidatedClasificacionFilter === 'TODOS' ? 'rgba(255,255,255,0.2)' : 'rgba(148,163,184,0.2)',
              color: consolidatedClasificacionFilter === 'TODOS' ? '#FFFFFF' : 'var(--text-secondary)',
            }}>
              {countTodos}
            </span>
          </button>

          {/* 2. Merma DEV-01 */}
          <button
            type="button"
            onClick={() => setConsolidatedClasificacionFilter('MERMA')}
            style={{
              padding: '4px 9px',
              borderRadius: 20,
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              flexShrink: 0,
              whiteSpace: 'nowrap',
              transition: 'all 0.15s ease',
              border: consolidatedClasificacionFilter === 'MERMA' ? '1px solid #DC2626' : '1px solid rgba(239, 68, 68, 0.3)',
              backgroundColor: consolidatedClasificacionFilter === 'MERMA' ? '#DC2626' : 'rgba(239, 68, 68, 0.08)',
              color: consolidatedClasificacionFilter === 'MERMA' ? '#FFFFFF' : '#DC2626',
            }}
          >
            <AlertTriangle size={13} />
            <span>Merma DEV-01</span>
            <span style={{
              fontSize: 11,
              fontWeight: 800,
              padding: '1px 5px',
              borderRadius: 10,
              backgroundColor: consolidatedClasificacionFilter === 'MERMA' ? 'rgba(255,255,255,0.25)' : 'rgba(239, 68, 68, 0.2)',
              color: consolidatedClasificacionFilter === 'MERMA' ? '#FFFFFF' : '#DC2626',
            }}>
              {countMerma}
            </span>
          </button>

          {/* 3. Exceso NC */}
          <button
            type="button"
            onClick={() => setConsolidatedClasificacionFilter('EXCESO')}
            style={{
              padding: '4px 9px',
              borderRadius: 20,
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              flexShrink: 0,
              whiteSpace: 'nowrap',
              transition: 'all 0.15s ease',
              border: consolidatedClasificacionFilter === 'EXCESO' ? '1px solid #0284C7' : '1px solid rgba(2, 132, 199, 0.3)',
              backgroundColor: consolidatedClasificacionFilter === 'EXCESO' ? '#0284C7' : 'rgba(2, 132, 199, 0.08)',
              color: consolidatedClasificacionFilter === 'EXCESO' ? '#FFFFFF' : '#0284C7',
            }}
          >
            <Boxes size={13} />
            <span>Exceso NC</span>
            <span style={{
              fontSize: 11,
              fontWeight: 800,
              padding: '1px 5px',
              borderRadius: 10,
              backgroundColor: consolidatedClasificacionFilter === 'EXCESO' ? 'rgba(255,255,255,0.25)' : 'rgba(2, 132, 199, 0.2)',
              color: consolidatedClasificacionFilter === 'EXCESO' ? '#FFFFFF' : '#0284C7',
            }}>
              {countExceso}
            </span>
          </button>

          {/* 4. Vencidos */}
          <button
            type="button"
            onClick={() => setConsolidatedClasificacionFilter('EXPIRADO')}
            style={{
              padding: '4px 9px',
              borderRadius: 20,
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              flexShrink: 0,
              whiteSpace: 'nowrap',
              transition: 'all 0.15s ease',
              border: consolidatedClasificacionFilter === 'EXPIRADO' ? '1px solid #DC2626' : '1px solid rgba(220, 38, 38, 0.3)',
              backgroundColor: consolidatedClasificacionFilter === 'EXPIRADO' ? '#DC2626' : 'rgba(220, 38, 38, 0.08)',
              color: consolidatedClasificacionFilter === 'EXPIRADO' ? '#FFFFFF' : '#DC2626',
            }}
          >
            <Calendar size={13} />
            <span>Vencidos</span>
            <span style={{
              fontSize: 11,
              fontWeight: 800,
              padding: '1px 5px',
              borderRadius: 10,
              backgroundColor: consolidatedClasificacionFilter === 'EXPIRADO' ? 'rgba(255,255,255,0.25)' : 'rgba(220, 38, 38, 0.2)',
              color: consolidatedClasificacionFilter === 'EXPIRADO' ? '#FFFFFF' : '#DC2626',
            }}>
              {countExpirado}
            </span>
          </button>

          {/* 5. Tránsito Inbound */}
          <button
            type="button"
            onClick={() => setConsolidatedClasificacionFilter('TRANSITO')}
            style={{
              padding: '4px 9px',
              borderRadius: 20,
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              flexShrink: 0,
              whiteSpace: 'nowrap',
              transition: 'all 0.15s ease',
              border: consolidatedClasificacionFilter === 'TRANSITO' ? '1px solid #D97706' : '1px solid rgba(245, 158, 11, 0.3)',
              backgroundColor: consolidatedClasificacionFilter === 'TRANSITO' ? '#D97706' : 'rgba(245, 158, 11, 0.08)',
              color: consolidatedClasificacionFilter === 'TRANSITO' ? '#FFFFFF' : '#D97706',
            }}
          >
            <Clock size={13} />
            <span>Tránsito Inbound</span>
            <span style={{
              fontSize: 11,
              fontWeight: 800,
              padding: '1px 5px',
              borderRadius: 10,
              backgroundColor: consolidatedClasificacionFilter === 'TRANSITO' ? 'rgba(255,255,255,0.25)' : 'rgba(245, 158, 11, 0.2)',
              color: consolidatedClasificacionFilter === 'TRANSITO' ? '#FFFFFF' : '#D97706',
            }}>
              {countTransito}
            </span>
          </button>

          {/* 6. Staging / Consolidación */}
          <button
            type="button"
            onClick={() => setConsolidatedClasificacionFilter('STAGING')}
            style={{
              padding: '4px 9px',
              borderRadius: 20,
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              flexShrink: 0,
              whiteSpace: 'nowrap',
              transition: 'all 0.15s ease',
              border: consolidatedClasificacionFilter === 'STAGING' ? '1px solid #0284C7' : '1px solid rgba(2, 132, 199, 0.3)',
              backgroundColor: consolidatedClasificacionFilter === 'STAGING' ? '#0284C7' : 'rgba(2, 132, 199, 0.08)',
              color: consolidatedClasificacionFilter === 'STAGING' ? '#FFFFFF' : '#0284C7',
            }}
          >
            <Layers size={13} />
            <span>Staging / Consolidación</span>
            <span style={{
              fontSize: 11,
              fontWeight: 800,
              padding: '1px 5px',
              borderRadius: 10,
              backgroundColor: consolidatedClasificacionFilter === 'STAGING' ? 'rgba(255,255,255,0.25)' : 'rgba(2, 132, 199, 0.2)',
              color: consolidatedClasificacionFilter === 'STAGING' ? '#FFFFFF' : '#0284C7',
            }}>
              {countStaging}
            </span>
          </button>

          {/* 7. Conforme Comercial */}
          <button
            type="button"
            onClick={() => setConsolidatedClasificacionFilter('CONFORME')}
            style={{
              padding: '4px 9px',
              borderRadius: 20,
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              flexShrink: 0,
              whiteSpace: 'nowrap',
              transition: 'all 0.15s ease',
              border: consolidatedClasificacionFilter === 'CONFORME' ? '1px solid #059669' : '1px solid rgba(16, 185, 129, 0.3)',
              backgroundColor: consolidatedClasificacionFilter === 'CONFORME' ? '#059669' : 'rgba(16, 185, 129, 0.08)',
              color: consolidatedClasificacionFilter === 'CONFORME' ? '#FFFFFF' : '#059669',
            }}
          >
            <CheckCircle2 size={13} />
            <span>Conforme Comercial</span>
            <span style={{
              fontSize: 11,
              fontWeight: 800,
              padding: '1px 5px',
              borderRadius: 10,
              backgroundColor: consolidatedClasificacionFilter === 'CONFORME' ? 'rgba(255,255,255,0.25)' : 'rgba(16, 185, 129, 0.2)',
              color: consolidatedClasificacionFilter === 'CONFORME' ? '#FFFFFF' : '#059669',
            }}>
              {countConforme}
            </span>
          </button>
        </div>
      </div>

      {/* ========================================= */}
      {/* 4. TABLA CANÓNICA DE INVENTARIO GENERAL   */}
      {/* ========================================= */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-secondary)' }}>
          <RefreshCw className="animate-spin" size={24} /> Cargando inventario general...
        </div>
      ) : (
        <div className="card">
          <div style={{ overflowX: 'auto', minHeight: 440, paddingBottom: 110 }}>
            <table className="data-table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th style={{ minWidth: 150 }}>Clasificación</th>
                  <th>SKU</th>
                  <th style={{ minWidth: 200 }}>Descripción</th>
                  <th>Depositante</th>
                  <th>Lote</th>
                  <th>Vencimiento</th>
                  <th>Ubicación Física</th>
                  <th style={{ textAlign: 'right' }}>Físico Total</th>
                  <th style={{ textAlign: 'right' }}>Disp. Vendible</th>
                  <th style={{ textAlign: 'right' }}>Reservado</th>
                  <th style={{ textAlign: 'right' }}>Bloqueado</th>
                  <th>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                      <span>Calidad</span>
                      <span
                        title={CALIDAD_TOOLTIP}
                        style={{ cursor: 'help', display: 'inline-flex', alignItems: 'center', color: 'var(--text-tertiary)' }}
                      >
                        <Info size={13} />
                      </span>
                    </div>
                  </th>
                  <th>HUs / Bultos</th>
                  <th style={{ textAlign: 'center' }}>Acción</th>
                </tr>
              </thead>
              <tbody>
                {filteredConsolidated.map((item, idx) => {
                  // Precedencia canónica disyuntiva:
                  // 1. estadoCalidad = CUARENTENA -> Cuarentena / No Conforme pendiente de resolución de calidad.
                  // 2. resolución formal MERMA (estadoCalidad = MERMA) -> Merma Definitiva.
                  // DEV-01 por sí sola NO convierte en Merma si su estadoCalidad es CUARENTENA.
                  const isExceso = item.estadoCalidad === 'CUARENTENA' || (!item.estadoCalidad && (item.clasificacion === 'CUARENTENA' || item.clasificacion === 'EXCESO'));
                  const isMerma = !isExceso && (item.estadoCalidad === 'MERMA' || (item.clasificacion === 'MERMA' && item.estadoCalidad !== 'CUARENTENA') || (item.estadoPrincipalOperativo === 'MERMA' && item.estadoCalidad !== 'CUARENTENA'));
                  const isExpired = !isExceso && !isMerma && (item.clasificacion === 'EXPIRADO' || item.estadoPrincipalOperativo === 'VENCIDO' || item.isExpired);
                  const isStaging = !isExceso && !isMerma && !isExpired && (item.clasificacion === 'STAGING' || item.estadoPrincipalOperativo === 'NO_ELEGIBLE_SURTIDO' || item.rolOperativoUbicacion === 'NO_ELEGIBLE_SURTIDO' || item.ubicacion?.codigo?.startsWith('STG-'));
                  const isTransito = !isExceso && !isMerma && !isExpired && !isStaging && (item.clasificacion === 'TRANSITO' || item.estadoPrincipalOperativo === 'TRANSITO_INTERNO' || item.esTransito || item.ubicacion?.codigo?.startsWith('REC-'));
                  const isConforme = !isExceso && !isMerma && !isExpired && !isStaging && !isTransito && item.clasificacion === 'CONFORME';

                  const rowKey = item.id || `row-${idx}`;
                  const isMenuOpen = openActionMenuId === rowKey;

                  return (
                    <tr
                      key={rowKey}
                      className="animate-fade-in"
                      style={{
                        animationDelay: `${idx * 0.012}s`,
                        position: isMenuOpen ? 'relative' : undefined,
                        zIndex: isMenuOpen ? 70 : 1,
                        backgroundColor: isMerma
                          ? 'rgba(239, 68, 68, 0.03)'
                          : isExceso
                          ? 'rgba(2, 132, 199, 0.03)'
                          : isExpired
                          ? 'rgba(220, 38, 38, 0.03)'
                          : isTransito
                          ? 'rgba(245, 158, 11, 0.03)'
                          : isStaging
                          ? 'rgba(2, 132, 199, 0.03)'
                          : 'transparent'
                      }}
                    >
                      {/* 1. Clasificación */}
                      <td>
                        {isConforme && (
                          <span style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            padding: '3px 8px',
                            borderRadius: 6,
                            fontSize: 11,
                            fontWeight: 700,
                            backgroundColor: 'rgba(16, 185, 129, 0.15)',
                            color: '#059669',
                            border: '1px solid rgba(16, 185, 129, 0.3)'
                          }}>
                            <CheckCircle2 size={12} /> Conforme Comercial
                          </span>
                        )}
                        {isStaging && (
                          <div style={{ display: 'inline-flex', flexDirection: 'column', gap: 2 }}>
                            <span
                              title="Ubicación operativa en área de Staging. Mercancía en consolidación física reservada para despacho."
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                                padding: '3px 8px',
                                borderRadius: 6,
                                fontSize: 10,
                                fontWeight: 800,
                                backgroundColor: 'rgba(2, 132, 199, 0.15)',
                                color: '#0284C7',
                                border: '1px solid rgba(2, 132, 199, 0.3)',
                                letterSpacing: '0.02em',
                                whiteSpace: 'nowrap',
                                cursor: 'help'
                              }}
                            >
                              <Layers size={12} /> STAGING / CONSOLIDACIÓN
                            </span>
                            <span style={{ fontSize: 10, color: 'var(--text-tertiary)', fontWeight: 500 }}>
                              Reservado para salida
                            </span>
                          </div>
                        )}
                        {isTransito && (
                          <span
                            title="Existencia física registrada. No disponible para surtido hasta completar su alojamiento en rack."
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                              padding: '3px 8px',
                              borderRadius: 6,
                              fontSize: 10,
                              fontWeight: 800,
                              backgroundColor: 'rgba(245, 158, 11, 0.15)',
                              color: '#D97706',
                              border: '1px solid rgba(245, 158, 11, 0.3)',
                              letterSpacing: '0.02em',
                              whiteSpace: 'nowrap',
                              cursor: 'help'
                            }}
                          >
                            <Clock size={12} /> TRÁNSITO INBOUND
                          </span>
                        )}
                        {isMerma && (
                          <span style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            padding: '3px 8px',
                            borderRadius: 6,
                            fontSize: 11,
                            fontWeight: 700,
                            backgroundColor: 'rgba(239, 68, 68, 0.15)',
                            color: '#DC2626',
                            border: '1px solid rgba(239, 68, 68, 0.3)'
                          }}>
                            <AlertTriangle size={12} /> Merma DEV-01
                          </span>
                        )}
                        {isExceso && (
                          <span style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            padding: '3px 8px',
                            borderRadius: 6,
                            fontSize: 11,
                            fontWeight: 700,
                            backgroundColor: 'rgba(2, 132, 199, 0.15)',
                            color: '#0284C7',
                            border: '1px solid rgba(2, 132, 199, 0.3)'
                          }}>
                            <Boxes size={12} /> Exceso NC
                          </span>
                        )}
                        {isExpired && (
                          <span
                            title={item.esTransitoInterno ? "Mercancía vencida en andén de recepción. Bloqueada formalmente para Putaway comercial." : "Lote vencido. Retirado de surtido comercial."}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                              padding: '3px 8px',
                              borderRadius: 6,
                              fontSize: item.esTransitoInterno ? 10 : 11,
                              fontWeight: 800,
                              backgroundColor: 'rgba(239, 68, 68, 0.15)',
                              color: '#DC2626',
                              border: '1px solid rgba(239, 68, 68, 0.3)',
                              letterSpacing: item.esTransitoInterno ? '0.02em' : 'normal',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            <Calendar size={12} /> {item.esTransitoInterno ? 'VENCIDO · ANDÉN' : 'VENCIDO'}
                          </span>
                        )}
                        {!isConforme && !isTransito && !isMerma && !isExceso && !isExpired && !isStaging && (
                          <span style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            padding: '3px 8px',
                            borderRadius: 6,
                            fontSize: 11,
                            fontWeight: 700,
                            backgroundColor: 'rgba(139, 92, 246, 0.15)',
                            color: '#7C3AED',
                            border: '1px solid rgba(139, 92, 246, 0.3)'
                          }}>
                            <Lock size={12} /> Retenido
                          </span>
                        )}
                      </td>

                      {/* 2. SKU */}
                      <td>
                        <code style={{ fontSize: 12, background: 'var(--bg-secondary)', padding: '2px 6px', borderRadius: 4, fontWeight: 700 }}>
                          {item.sku?.codigo || '—'}
                        </code>
                      </td>

                      {/* 3. Descripción */}
                      <td style={{ fontWeight: 500, whiteSpace: 'normal', minWidth: 170 }}>
                        {item.sku?.descripcion || item.sku?.nombre || '—'}
                        {item.sku?.talla && <span style={{ color: 'var(--text-tertiary)', fontSize: 11 }}> · Talla {item.sku.talla}</span>}
                        {item.sku?.color && <span style={{ color: 'var(--text-tertiary)', fontSize: 11 }}> · {item.sku.color}</span>}
                      </td>

                      {/* 4. Depositante */}
                      <td>
                        <span className="badge badge-info">{item.cliente?.nombreComercial || '—'}</span>
                      </td>

                      {/* 5. Lote */}
                      <td style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 600 }}>
                        {item.lote || '—'}
                      </td>

                      {/* 6. Vencimiento */}
                      <td style={{ fontSize: 12 }}>
                        {item.fechaVencimiento ? (
                          <span style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            color: item.isExpired ? '#DC2626' : 'var(--text-secondary)',
                            fontWeight: item.isExpired ? 700 : 400
                          }}>
                            <Calendar size={12} /> {formatCalendarDate(item.fechaVencimiento)}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--text-tertiary)' }}>Sin caducidad</span>
                        )}
                      </td>

                      {/* 7. Ubicación Física */}
                      <td>
                        <span style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          fontSize: 12,
                          fontWeight: 700,
                          color: isMerma ? '#DC2626' : isExceso ? '#0284C7' : (isExpired && item.esTransitoInterno) ? '#DC2626' : isTransito ? '#D97706' : isStaging ? '#0284C7' : '#2563EB'
                        }}>
                          <MapPin size={12} /> {item.ubicacion?.codigo || '—'}
                          {item.esTransitoInterno && (
                            <span style={{ fontSize: 10, color: '#D97706', fontWeight: 600 }}> · Tránsito</span>
                          )}
                          {isStaging && (
                            <span style={{ fontSize: 10, color: '#0284C7', fontWeight: 600 }}> · Staging</span>
                          )}
                        </span>
                      </td>

                      {/* 8. Físico Total */}
                      <td style={{ textAlign: 'right', fontWeight: 800, fontSize: 13, color: '#0F172A', fontVariantNumeric: 'tabular-nums' }}>
                        {item.cantidadFisica?.toLocaleString() ?? 0}
                      </td>

                      {/* 9. Disp. Vendible */}
                      <td style={{ textAlign: 'right', fontWeight: 700, fontSize: 13, color: item.cantidadDisponibleVendible > 0 ? '#059669' : '#94A3B8', fontVariantNumeric: 'tabular-nums' }}>
                        {isTransito ? (
                          <span
                            title="Existencia física registrada en andén. No disponible para surtido hasta completar alojamiento en rack."
                            style={{
                              cursor: 'help',
                              borderBottom: '1px dotted #D97706',
                              color: '#D97706',
                              fontSize: 12,
                              fontWeight: 800
                            }}
                          >
                            0
                          </span>
                        ) : isStaging ? (
                          <span
                            title="Mercancía en área de Staging / Consolidación. Reservada para despacho de pedido (no vendible para nuevo surtido)."
                            style={{
                              cursor: 'help',
                              borderBottom: '1px dotted #0284C7',
                              color: '#0284C7',
                              fontSize: 12,
                              fontWeight: 800
                            }}
                          >
                            0
                          </span>
                        ) : (
                          item.cantidadDisponibleVendible?.toLocaleString() ?? 0
                        )}
                      </td>

                      {/* 10. Reservado */}
                      <td style={{ textAlign: 'right', fontWeight: item.cantidadReservada > 0 ? 700 : 400, color: item.cantidadReservada > 0 ? '#4F46E5' : 'var(--text-tertiary)', fontVariantNumeric: 'tabular-nums' }}>
                        {item.cantidadReservada > 0 ? item.cantidadReservada.toLocaleString() : '—'}
                      </td>

                      {/* 11. Bloqueado */}
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {item.cantidadBloqueada > 0 ? (
                          <span style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 3,
                            fontWeight: 700,
                            color: '#DC2626',
                            fontSize: 12
                          }}>
                            <Lock size={11} /> {item.cantidadBloqueada.toLocaleString()}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--text-tertiary)' }}>—</span>
                        )}
                      </td>

                      {/* 12. Calidad */}
                      <td>
                        {(() => {
                          const hasHigherRestriction = isExpired || isMerma || isExceso || (!isConforme && !isTransito && !isStaging);
                          const qualityValue = item.estadoCalidad || 'LIBERADO';

                          if (hasHigherRestriction) {
                            return (
                              <span
                                title={CALIDAD_TOOLTIP}
                                style={{
                                  fontSize: 10,
                                  fontWeight: 600,
                                  padding: '2px 6px',
                                  borderRadius: 4,
                                  background: 'rgba(148, 163, 184, 0.12)',
                                  color: 'var(--text-secondary, #64748B)',
                                  border: '1px solid rgba(148, 163, 184, 0.28)',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  letterSpacing: '0.02em'
                                }}
                              >
                                {qualityValue}
                              </span>
                            );
                          }

                          const isLiberado = qualityValue === 'LIBERADO';
                          return (
                            <span
                              title={CALIDAD_TOOLTIP}
                              style={{
                                fontSize: 10,
                                fontWeight: 800,
                                padding: '2px 6px',
                                borderRadius: 4,
                                background: isLiberado ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)',
                                color: isLiberado ? '#059669' : '#DC2626',
                                border: `1px solid ${isLiberado ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
                                display: 'inline-flex',
                                alignItems: 'center'
                              }}
                            >
                              {qualityValue}
                            </span>
                          );
                        })()}
                      </td>

                      {/* 13. HUs / Bultos */}
                      <td>
                        {(() => {
                          const huCount = item.totalHus ?? item.handlingUnits?.length ?? 0;
                          return (
                            <span style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                              fontSize: 12,
                              color: huCount > 0 ? 'var(--text-primary)' : 'var(--text-tertiary)',
                              fontWeight: huCount > 0 ? 600 : 400
                            }}>
                              <Box size={12} /> {huCount > 0 ? `${huCount} bulto${huCount > 1 ? 's' : ''}` : 'Sin HU'}
                            </span>
                          );
                        })()}
                      </td>

                      {/* 14. Acción */}
                      <td style={{
                        textAlign: 'center',
                        whiteSpace: 'nowrap',
                        position: 'relative',
                        zIndex: isMenuOpen ? 75 : 1,
                      }}>
                        <div
                          className="action-menu-container"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 6,
                            position: 'relative',
                            zIndex: isMenuOpen ? 80 : 1,
                          }}
                        >
                          {/* Botón Detalle */}
                          <button
                            type="button"
                            className="btn btn-sm btn-ghost"
                            onClick={() => {
                              setOpenActionMenuId(null);
                              setSelectedConsolidatedItem(item);
                            }}
                            title="Ver trazabilidad completa y HUs asociadas"
                            style={{
                              padding: '4px 8px',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                              fontSize: 12,
                              fontWeight: 600,
                              color: '#2563EB',
                              border: '1px solid rgba(37, 99, 235, 0.25)',
                              borderRadius: 6,
                              backgroundColor: 'rgba(37, 99, 235, 0.04)',
                            }}
                          >
                            <Eye size={13} />
                            <span>Detalle</span>
                          </button>

                          {/* Botón Acciones (Dropdown) */}
                          <button
                            type="button"
                            className="btn btn-sm btn-ghost"
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenActionMenuId(isMenuOpen ? null : rowKey);
                            }}
                            title="Operaciones operativas válidas para esta partida"
                            style={{
                              padding: '4px 8px',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                              fontSize: 12,
                              fontWeight: 600,
                              color: isMenuOpen ? '#0F172A' : '#475569',
                              border: isMenuOpen ? '1px solid #94A3B8' : '1px solid #CBD5E1',
                              borderRadius: 6,
                              backgroundColor: isMenuOpen ? '#F1F5F9' : '#FFFFFF',
                            }}
                          >
                            <span>Acciones</span>
                            <ChevronDown
                              size={12}
                              style={{
                                transform: isMenuOpen ? 'rotate(180deg)' : 'none',
                                transition: 'transform 0.15s ease',
                              }}
                            />
                          </button>

                          {/* Menú Contextual Desplegable */}
                          {isMenuOpen && (
                            <div
                              style={{
                                position: 'absolute',
                                right: 0,
                                top: (idx >= filteredConsolidated.length - 2 && filteredConsolidated.length > 2) ? 'auto' : 'calc(100% + 4px)',
                                bottom: (idx >= filteredConsolidated.length - 2 && filteredConsolidated.length > 2) ? 'calc(100% + 4px)' : 'auto',
                                zIndex: 100,
                                minWidth: 280,
                                maxWidth: 330,
                                backgroundColor: '#FFFFFF',
                                borderRadius: 8,
                                boxShadow: '0 12px 28px -4px rgba(15, 23, 42, 0.25), 0 6px 12px -4px rgba(15, 23, 42, 0.15)',
                                border: '1px solid #CBD5E1',
                                padding: '6px 0',
                                textAlign: 'left',
                                whiteSpace: 'normal',
                              }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <div
                                style={{
                                  padding: '6px 12px 8px 12px',
                                  fontSize: 10,
                                  fontWeight: 700,
                                  color: '#64748B',
                                  textTransform: 'uppercase',
                                  letterSpacing: '0.5px',
                                  borderBottom: '1px solid #F1F5F9',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                }}
                              >
                                <span>Operaciones WMS</span>
                                <span style={{ fontSize: 9, color: '#94A3B8', fontWeight: 600 }}>{item.sku?.codigo}</span>
                              </div>

                              {/* 1. Conforme Comercial */}
                              {isConforme && (
                                <div style={{ padding: '4px 0' }}>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setOpenActionMenuId(null);
                                      setSelectedTransferItem(item);
                                    }}
                                    style={{
                                      width: '100%',
                                      padding: '8px 14px',
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: 10,
                                      fontSize: 12,
                                      fontWeight: 600,
                                      color: '#1E293B',
                                      background: 'none',
                                      border: 'none',
                                      cursor: 'pointer',
                                      textAlign: 'left',
                                      transition: 'background-color 0.1s ease',
                                    }}
                                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#F8FAFC')}
                                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                                  >
                                    <ArrowRight size={15} style={{ color: '#2563EB', flexShrink: 0 }} />
                                    <div>
                                      <div style={{ color: '#0F172A', fontWeight: 700 }}>Transferir / Mover</div>
                                      <div style={{ fontSize: 10, color: '#64748B', fontWeight: 400 }}>Reubicar entre racks comerciales</div>
                                    </div>
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => {
                                      setOpenActionMenuId(null);
                                      setSelectedQuarantineItem(item);
                                    }}
                                    style={{
                                      width: '100%',
                                      padding: '8px 14px',
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: 10,
                                      fontSize: 12,
                                      fontWeight: 600,
                                      color: '#92400E',
                                      background: 'none',
                                      border: 'none',
                                      cursor: 'pointer',
                                      textAlign: 'left',
                                      transition: 'background-color 0.1s ease',
                                    }}
                                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#FFFBEB')}
                                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                                  >
                                    <ShieldAlert size={15} style={{ color: '#D97706', flexShrink: 0 }} />
                                    <div>
                                      <div style={{ color: '#92400E', fontWeight: 700 }}>Enviar a Cuarentena</div>
                                      <div style={{ fontSize: 10, color: '#B45309', fontWeight: 400 }}>Retención preventiva por calidad o daño</div>
                                    </div>
                                  </button>
                                </div>
                              )}

                              {/* 2. Cuarentena / No Conforme / Exceso */}
                              {isExceso && (
                                <div style={{ padding: '6px 8px' }}>
                                  <div
                                    style={{
                                      padding: '8px 10px',
                                      borderRadius: 6,
                                      backgroundColor: 'rgba(2, 132, 199, 0.08)',
                                      border: '1px solid rgba(2, 132, 199, 0.25)',
                                      display: 'flex',
                                      alignItems: 'flex-start',
                                      gap: 8,
                                      fontSize: 11,
                                      lineHeight: '15px',
                                      color: '#0369A1',
                                      whiteSpace: 'normal',
                                    }}
                                  >
                                    <ShieldAlert size={15} style={{ color: '#0284C7', flexShrink: 0, marginTop: 1 }} />
                                    <div>
                                      <div style={{ fontWeight: 700, marginBottom: 2 }}>Cuarentena / No Conforme</div>
                                      <div>Mercancía en Cuarentena pendiente de resolución de calidad. No transferible a inventario comercial.</div>
                                      {item.ubicacion?.codigo === 'DEV-01' && (
                                        <div style={{ marginTop: 4, fontSize: 10, color: '#0369A1', fontWeight: 600 }}>
                                          Nota: Ubicada transitoriamente en DEV-01 en espera de dictamen de calidad.
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setOpenActionMenuId(null);
                                      setSelectedTransferItem(item);
                                    }}
                                    style={{
                                      width: '100%',
                                      marginTop: 4,
                                      padding: '7px 10px',
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: 8,
                                      fontSize: 12,
                                      fontWeight: 600,
                                      color: '#1E293B',
                                      background: '#F8FAFC',
                                      border: '1px solid #E2E8F0',
                                      borderRadius: 6,
                                      cursor: 'pointer',
                                      textAlign: 'left',
                                    }}
                                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#F1F5F9')}
                                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#F8FAFC')}
                                  >
                                    <ArrowRight size={14} style={{ color: '#2563EB', flexShrink: 0 }} />
                                    <span>Reubicar / Mover</span>
                                  </button>
                                </div>
                              )}

                              {/* 3. Merma Definitiva */}
                              {isMerma && (
                                <div style={{ padding: '6px 8px' }}>
                                  <div
                                    style={{
                                      padding: '8px 10px',
                                      borderRadius: 6,
                                      backgroundColor: 'rgba(239, 68, 68, 0.08)',
                                      border: '1px solid rgba(239, 68, 68, 0.25)',
                                      display: 'flex',
                                      alignItems: 'flex-start',
                                      gap: 8,
                                      fontSize: 11,
                                      lineHeight: '15px',
                                      color: '#991B1B',
                                      whiteSpace: 'normal',
                                    }}
                                  >
                                    <AlertTriangle size={15} style={{ color: '#DC2626', flexShrink: 0, marginTop: 1 }} />
                                    <div>
                                      <div style={{ fontWeight: 700, marginBottom: 2 }}>Merma Definitiva</div>
                                      <div>Merma definitiva en {item.ubicacion?.codigo || 'DEV-01'}. No transferible a racks comerciales.</div>
                                    </div>
                                  </div>
                                </div>
                              )}

                              {/* 4. Vencido */}
                              {isExpired && !isMerma && (
                                <div style={{ padding: '6px 8px' }}>
                                  <div
                                    style={{
                                      padding: '8px 10px',
                                      borderRadius: 6,
                                      backgroundColor: 'rgba(220, 38, 38, 0.08)',
                                      border: '1px solid rgba(220, 38, 38, 0.25)',
                                      display: 'flex',
                                      alignItems: 'flex-start',
                                      gap: 8,
                                      fontSize: 11,
                                      lineHeight: '15px',
                                      color: '#991B1B',
                                      whiteSpace: 'normal',
                                    }}
                                  >
                                    <Calendar size={15} style={{ color: '#DC2626', flexShrink: 0, marginTop: 1 }} />
                                    <div>
                                      <div style={{ fontWeight: 700, marginBottom: 2 }}>Lote Vencido</div>
                                      <div>Lote vencido. Retirado de surtido y no transferible a inventario comercial vendible.</div>
                                    </div>
                                  </div>
                                </div>
                              )}

                              {/* 5. Tránsito Inbound */}
                              {isTransito && !isMerma && !isExpired && (
                                <div style={{ padding: '6px 8px' }}>
                                  <div
                                    style={{
                                      padding: '8px 10px',
                                      borderRadius: 6,
                                      backgroundColor: 'rgba(245, 158, 11, 0.08)',
                                      border: '1px solid rgba(245, 158, 11, 0.25)',
                                      display: 'flex',
                                      alignItems: 'flex-start',
                                      gap: 8,
                                      fontSize: 11,
                                      lineHeight: '15px',
                                      color: '#92400E',
                                      whiteSpace: 'normal',
                                    }}
                                  >
                                    <Clock size={15} style={{ color: '#D97706', flexShrink: 0, marginTop: 1 }} />
                                    <div>
                                      <div style={{ fontWeight: 700, marginBottom: 2 }}>Tránsito Inbound</div>
                                      <div>Mercancía en andén de recepción. Requiere protocolo formal de Putaway en andén.</div>
                                    </div>
                                  </div>
                                </div>
                              )}

                              {/* 6. Staging / Consolidación */}
                              {isStaging && (
                                <div style={{ padding: '6px 8px' }}>
                                  <div
                                    style={{
                                      padding: '8px 10px',
                                      borderRadius: 6,
                                      backgroundColor: 'rgba(2, 132, 199, 0.08)',
                                      border: '1px solid rgba(2, 132, 199, 0.25)',
                                      display: 'flex',
                                      alignItems: 'flex-start',
                                      gap: 8,
                                      fontSize: 11,
                                      lineHeight: '15px',
                                      color: '#075985',
                                      whiteSpace: 'normal',
                                    }}
                                  >
                                    <Layers size={15} style={{ color: '#0284C7', flexShrink: 0, marginTop: 1 }} />
                                    <div>
                                      <div style={{ fontWeight: 700, marginBottom: 2 }}>Staging / Salida</div>
                                      <div>Mercancía consolidada para salida. Comprometida en orden de despacho activa.</div>
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filteredConsolidated.length === 0 && (
                  <tr>
                    <td colSpan={14} style={{ textAlign: 'center', padding: 50, color: 'var(--text-tertiary)' }}>
                      No se encontraron registros en el inventario general con los filtros aplicados.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* ========================================= */}
          {/* 5. FOOTER DE CONCILIACIÓN LIMPIO Y EXACTO */}
          {/* ========================================= */}
          <div style={{
            padding: '12px 20px',
            borderTop: '1px solid var(--border)',
            fontSize: 12,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 12,
            background: 'var(--bg-secondary)',
            borderRadius: '0 0 10px 10px',
          }}>
            <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ color: 'var(--text-secondary)' }}>
                <strong>Partidas:</strong> {filteredConsolidated.length}
              </span>
              <span style={{ color: '#0F172A' }}>
                <strong>Físico Total:</strong> {filteredConsolidated.reduce((s, x) => s + (x.cantidadFisica || 0), 0).toLocaleString()} uds
              </span>
              <span style={{ color: '#059669' }}>
                <strong>Disponible Vendible:</strong> {filteredConsolidated.reduce((s, x) => s + (x.cantidadDisponibleVendible || 0), 0).toLocaleString()} uds
              </span>
              <span style={{ color: '#4F46E5' }}>
                <strong>Reservado:</strong> {filteredConsolidated.reduce((s, x) => s + (x.cantidadReservada || 0), 0).toLocaleString()} uds
              </span>
              <span style={{ color: '#DC2626' }}>
                <strong>Bloqueado Total:</strong> {filteredConsolidated.reduce((s, x) => s + (x.cantidadBloqueada || 0), 0).toLocaleString()} uds
              </span>
            </div>

            <div
              style={{
                fontSize: 11,
                color: 'var(--text-tertiary)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                cursor: 'help',
                padding: '4px 8px',
                borderRadius: 4,
                background: 'rgba(148, 163, 184, 0.08)',
                border: '1px solid rgba(148, 163, 184, 0.2)',
              }}
              title="Fórmula canónica WMS: Físico Total = Vendible libre + Reservado + Bloqueado Total + Tránsito Inbound + Vencidos. Cuadre 100% excluyente sin doble conteo."
            >
              <Info size={13} style={{ color: 'var(--text-secondary)' }} />
              <span>Conciliación Matemática Canónica (100% cuadre)</span>
            </div>
          </div>
        </div>
      )}

      {/* ========================================= */}
      {/* 6. MODALES OPERATIVOS PRESERVADOS         */}
      {/* ========================================= */}



      {/* Modal de Detalle de Partida Consolidada (Ficha Técnica de Partida) */}
      {selectedConsolidatedItem && (
        <div
          onClick={() => setSelectedConsolidatedItem(null)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.75)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 20
          }}
        >
          <div
            className="card animate-fade-in"
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: 720,
              width: '100%',
              maxHeight: '90vh',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
              border: '1px solid var(--border)'
            }}
          >
            {/* Cabecera del Modal */}
            <div style={{
              padding: '16px 24px',
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              backgroundColor: 'var(--bg-secondary)'
            }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Layers size={18} style={{ color: 'var(--primary)' }} />
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Ficha Técnica de Partida · Inventario General</h3>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                  SKU: <strong style={{ color: 'var(--text-primary)' }}>{selectedConsolidatedItem.sku?.codigo || 'No registrado'}</strong> · Lote: <strong style={{ color: 'var(--text-primary)' }}>{selectedConsolidatedItem.lote || 'No registrado'}</strong>
                </div>
              </div>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => setSelectedConsolidatedItem(null)}
                style={{ padding: 6, borderRadius: '50%' }}
                title="Cerrar (Esc)"
              >
                <X size={18} />
              </button>
            </div>

            {/* Cuerpo del Modal con scroll */}
            <div style={{ padding: '20px 24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 18 }}>
              {/* Banner de Clasificación Operativa y Estado */}
              {(() => {
                const estadoPrincipal = selectedConsolidatedItem.estadoPrincipalOperativo || (
                  selectedConsolidatedItem.clasificacion === 'EXPIRADO' ? 'VENCIDO' :
                  selectedConsolidatedItem.clasificacion === 'MERMA' ? 'MERMA' :
                  selectedConsolidatedItem.clasificacion === 'EXCESO' ? 'EXCESO' :
                  selectedConsolidatedItem.clasificacion === 'CUARENTENA' ? 'CUARENTENA' :
                  selectedConsolidatedItem.clasificacion === 'STAGING' ? 'NO_ELEGIBLE_SURTIDO' :
                  (selectedConsolidatedItem.clasificacion === 'TRANSITO' || selectedConsolidatedItem.esTransito) ? 'TRANSITO_INTERNO' :
                  'DISPONIBLE_COMERCIAL'
                );
                const isCuarentena = selectedConsolidatedItem.estadoCalidad === 'CUARENTENA' || (!selectedConsolidatedItem.estadoCalidad && (selectedConsolidatedItem.clasificacion === 'CUARENTENA' || selectedConsolidatedItem.clasificacion === 'EXCESO' || estadoPrincipal === 'CUARENTENA'));
                const isMerma = !isCuarentena && (selectedConsolidatedItem.estadoCalidad === 'MERMA' || selectedConsolidatedItem.clasificacion === 'MERMA' || estadoPrincipal === 'MERMA');
                const isVencido = !isCuarentena && !isMerma && (estadoPrincipal === 'VENCIDO' || selectedConsolidatedItem.clasificacion === 'EXPIRADO' || selectedConsolidatedItem.isExpired);
                const isExceso = !isCuarentena && !isMerma && !isVencido && (estadoPrincipal === 'EXCESO' || selectedConsolidatedItem.clasificacion === 'EXCESO');
                const isStagingModal = !isCuarentena && !isMerma && !isVencido && (estadoPrincipal === 'NO_ELEGIBLE_SURTIDO' || selectedConsolidatedItem.clasificacion === 'STAGING' || selectedConsolidatedItem.rolOperativoUbicacion === 'NO_ELEGIBLE_SURTIDO');
                const isTransito = !isCuarentena && !isMerma && !isVencido && !isStagingModal && (estadoPrincipal === 'TRANSITO_INTERNO' || selectedConsolidatedItem.clasificacion === 'TRANSITO' || selectedConsolidatedItem.esTransito);

                let bannerBg = 'rgba(16, 185, 129, 0.12)';
                let bannerBorder = 'rgba(16, 185, 129, 0.35)';
                let textColor = '#059669';
                let icon = <CheckCircle2 size={24} style={{ color: '#059669', flexShrink: 0 }} />;
                let headerTitle = 'Stock Comercial Conforme · 100% Vendible';
                let secondaryContent = (
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                    Ubicación asignada: <strong>{selectedConsolidatedItem.ubicacion?.codigo || 'No registrada'}</strong> · <span title={CALIDAD_TOOLTIP}>Calidad: <strong>{selectedConsolidatedItem.estadoCalidad || 'LIBERADO'}</strong></span>
                  </div>
                );

                if (isMerma) {
                  bannerBg = 'rgba(239, 68, 68, 0.12)';
                  bannerBorder = 'rgba(239, 68, 68, 0.35)';
                  textColor = '#DC2626';
                  icon = <AlertTriangle size={24} style={{ color: '#DC2626', flexShrink: 0 }} />;
                  headerTitle = `Clasificación: Merma / No conforme · Estado: ${selectedConsolidatedItem.estadoCalidad || 'Bloqueado'}`;
                  secondaryContent = (
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                      Ubicación física: <strong>{selectedConsolidatedItem.ubicacion?.codigo || 'DEV-01'}</strong> · Causa: <strong>{selectedConsolidatedItem.motivoBloqueo || selectedConsolidatedItem.notas || 'Segregación por calidad'}</strong>
                    </div>
                  );
                } else if (isExceso) {
                  bannerBg = 'rgba(2, 132, 199, 0.12)';
                  bannerBorder = 'rgba(2, 132, 199, 0.35)';
                  textColor = '#0284C7';
                  icon = <Boxes size={24} style={{ color: '#0284C7', flexShrink: 0 }} />;
                  headerTitle = `Clasificación: Excedente de Recepción · Estado: ${selectedConsolidatedItem.estadoCalidad || 'Bloqueado'}`;
                  secondaryContent = (
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                      Ubicación física: <strong>{selectedConsolidatedItem.ubicacion?.codigo || 'NC-EXCESO-01'}</strong> · Stock retenido fuera de inventario vendible
                    </div>
                  );
                } else if (isCuarentena) {
                  bannerBg = 'rgba(139, 92, 246, 0.12)';
                  bannerBorder = 'rgba(139, 92, 246, 0.35)';
                  textColor = '#7C3AED';
                  icon = <Lock size={24} style={{ color: '#7C3AED', flexShrink: 0 }} />;
                  headerTitle = 'Retenido en Cuarentena · Inspección o Bloqueo Preventivo';
                  secondaryContent = (
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                      Ubicación: <strong>{selectedConsolidatedItem.ubicacion?.codigo || 'No registrada'}</strong> · <span title={CALIDAD_TOOLTIP}>Calidad: <strong>{selectedConsolidatedItem.estadoCalidad || 'CUARENTENA'}</strong></span>
                    </div>
                  );
                } else if (isVencido) {
                  bannerBg = 'rgba(239, 68, 68, 0.12)';
                  bannerBorder = 'rgba(239, 68, 68, 0.35)';
                  textColor = '#DC2626';
                  icon = <Calendar size={24} style={{ color: '#DC2626', flexShrink: 0 }} />;
                  headerTitle = selectedConsolidatedItem.esTransitoInterno
                    ? 'VENCIDO · NO ELEGIBLE PARA PUTAWAY'
                    : (selectedConsolidatedItem.badgeOperativoTexto || 'VENCIDO · NO VENDIBLE');
                  secondaryContent = (
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                      Existencia física registrada. No disponible para venta, surtido ni alojamiento comercial por fecha de vencimiento. · Ubicación actual: <strong>{selectedConsolidatedItem.ubicacion?.codigo || 'REC-01'}{selectedConsolidatedItem.esTransitoInterno ? ' · Tránsito interno' : ''}</strong> · <span title={CALIDAD_TOOLTIP}>Calidad: <strong>{selectedConsolidatedItem.estadoCalidad || 'LIBERADO'}</strong></span>
                    </div>
                  );
                } else if (isStagingModal) {
                  bannerBg = 'rgba(2, 132, 199, 0.12)';
                  bannerBorder = 'rgba(2, 132, 199, 0.35)';
                  textColor = '#0284C7';
                  icon = <Layers size={24} style={{ color: '#0284C7', flexShrink: 0 }} />;
                  headerTitle = 'EN STAGING / CONSOLIDACIÓN · RESERVADO PARA DESPACHO';
                  secondaryContent = (
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                      Mercancía en consolidación física para salida. Ubicación actual: <strong>{selectedConsolidatedItem.ubicacion?.codigo || 'STG-01'} · Área de Staging</strong> · <span title={CALIDAD_TOOLTIP}>Calidad: <strong>{selectedConsolidatedItem.estadoCalidad || 'LIBERADO'}</strong></span> · Reservado para despacho.
                    </div>
                  );
                } else if (isTransito) {
                  bannerBg = 'rgba(245, 158, 11, 0.12)';
                  bannerBorder = 'rgba(245, 158, 11, 0.35)';
                  textColor = '#D97706';
                  icon = <Clock size={24} style={{ color: '#D97706', flexShrink: 0 }} />;
                  headerTitle = 'En Tránsito / Pendiente de Putaway · No Vendible por Ubicación';
                  secondaryContent = (
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                      Existencia física registrada. No disponible para surtido hasta completar su alojamiento en una ubicación operativa. · Ubicación actual: <strong>{selectedConsolidatedItem.ubicacion?.codigo || 'RECEPCIÓN'} · Tránsito interno</strong> · <span title={CALIDAD_TOOLTIP}>Calidad: <strong>{selectedConsolidatedItem.estadoCalidad || 'LIBERADO'}</strong></span>
                    </div>
                  );
                }

                return (
                  <div style={{
                    padding: '12px 16px',
                    borderRadius: 8,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    backgroundColor: bannerBg,
                    border: `1px solid ${bannerBorder}`
                  }}>
                    {icon}
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13, color: textColor }}>
                        {headerTitle}
                      </div>
                      {secondaryContent}
                    </div>
                  </div>
                );
              })()}

              {/* Grid de 4 KPIs Físicos / Lógicos de la partida */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
                <div style={{ padding: 12, borderRadius: 8, backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border)', textAlign: 'center' }}>
                  <div style={{ fontSize: 10, color: 'var(--text-tertiary)', fontWeight: 700, textTransform: 'uppercase' }}>Físico Total</div>
                  <div style={{ fontSize: 20, fontWeight: 800, marginTop: 4, color: '#0F172A' }}>
                    {selectedConsolidatedItem.cantidadFisica?.toLocaleString() || 0}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>piezas en almacén</div>
                </div>

                {(() => {
                  const estadoPrincipal = selectedConsolidatedItem.estadoPrincipalOperativo || (
                    selectedConsolidatedItem.clasificacion === 'EXPIRADO' ? 'VENCIDO' :
                    selectedConsolidatedItem.clasificacion === 'MERMA' ? 'MERMA' :
                    selectedConsolidatedItem.clasificacion === 'EXCESO' ? 'EXCESO' :
                    selectedConsolidatedItem.clasificacion === 'CUARENTENA' ? 'CUARENTENA' :
                    selectedConsolidatedItem.clasificacion === 'STAGING' ? 'NO_ELEGIBLE_SURTIDO' :
                    (selectedConsolidatedItem.clasificacion === 'TRANSITO' || selectedConsolidatedItem.esTransito) ? 'TRANSITO_INTERNO' :
                    'DISPONIBLE_COMERCIAL'
                  );
                  const isCuarentena = selectedConsolidatedItem.estadoCalidad === 'CUARENTENA' || (!selectedConsolidatedItem.estadoCalidad && (selectedConsolidatedItem.clasificacion === 'CUARENTENA' || selectedConsolidatedItem.clasificacion === 'EXCESO' || estadoPrincipal === 'CUARENTENA'));
                  const isMerma = !isCuarentena && (selectedConsolidatedItem.estadoCalidad === 'MERMA' || selectedConsolidatedItem.clasificacion === 'MERMA' || estadoPrincipal === 'MERMA');
                  const isVencido = !isCuarentena && !isMerma && (estadoPrincipal === 'VENCIDO' || selectedConsolidatedItem.clasificacion === 'EXPIRADO' || selectedConsolidatedItem.isExpired);
                  const isExceso = !isCuarentena && !isMerma && !isVencido && (estadoPrincipal === 'EXCESO' || selectedConsolidatedItem.clasificacion === 'EXCESO');
                  const isStagingModal = !isCuarentena && !isMerma && !isVencido && (estadoPrincipal === 'NO_ELEGIBLE_SURTIDO' || selectedConsolidatedItem.clasificacion === 'STAGING' || selectedConsolidatedItem.rolOperativoUbicacion === 'NO_ELEGIBLE_SURTIDO');
                  const isTransitoModal = !isCuarentena && !isMerma && !isVencido && !isStagingModal && (estadoPrincipal === 'TRANSITO_INTERNO' || selectedConsolidatedItem.clasificacion === 'TRANSITO' || selectedConsolidatedItem.esTransito);
                  const vendibleQty = Number(selectedConsolidatedItem.cantidadDisponibleVendible || 0);

                  const hasAbsoluteRestriction = isVencido || isMerma || isCuarentena || isExceso || isStagingModal;

                  if (hasAbsoluteRestriction || (vendibleQty === 0 && !isTransitoModal)) {
                    const restrictionLabel = isVencido
                      ? '0 pzas (lote vencido)'
                      : isMerma
                      ? '0 pzas (merma / daño)'
                      : isExceso
                      ? '0 pzas (excedente)'
                      : isCuarentena
                      ? '0 pzas (cuarentena)'
                      : isStagingModal
                      ? '0 pzas (en staging / salida)'
                      : '0 pzas vendibles';

                    return (
                      <div style={{
                        padding: 12,
                        borderRadius: 8,
                        backgroundColor: 'rgba(148, 163, 184, 0.08)',
                        border: '1px solid rgba(148, 163, 184, 0.25)',
                        textAlign: 'center'
                      }}>
                        <div style={{ fontSize: 10, color: 'var(--text-secondary, #64748B)', fontWeight: 700, textTransform: 'uppercase' }}>Vendible</div>
                        <div style={{ fontSize: 20, fontWeight: 800, marginTop: 4, color: 'var(--text-secondary, #64748B)' }}>
                          0
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text-tertiary, #94A3B8)', fontWeight: 500 }}>
                          {restrictionLabel}
                        </div>
                      </div>
                    );
                  }

                  if (isTransitoModal) {
                    return (
                      <div style={{
                        padding: 12,
                        borderRadius: 8,
                        backgroundColor: 'rgba(245, 158, 11, 0.08)',
                        border: '1px solid rgba(245, 158, 11, 0.25)',
                        textAlign: 'center'
                      }}>
                        <div style={{ fontSize: 10, color: '#D97706', fontWeight: 700, textTransform: 'uppercase' }}>Vendible</div>
                        <div style={{ fontSize: 20, fontWeight: 800, marginTop: 4, color: '#D97706' }}>
                          0
                        </div>
                        <div style={{ fontSize: 10, color: '#D97706', fontWeight: 600 }}>
                          0 pzas (en tránsito)
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div style={{
                      padding: 12,
                      borderRadius: 8,
                      backgroundColor: 'rgba(16, 185, 129, 0.08)',
                      border: '1px solid rgba(16, 185, 129, 0.25)',
                      textAlign: 'center'
                    }}>
                      <div style={{ fontSize: 10, color: '#059669', fontWeight: 700, textTransform: 'uppercase' }}>Vendible</div>
                      <div style={{ fontSize: 20, fontWeight: 800, marginTop: 4, color: '#059669' }}>
                        {vendibleQty.toLocaleString()}
                      </div>
                      <div style={{ fontSize: 10, color: '#059669', fontWeight: 600 }}>
                        disponible para surtido
                      </div>
                    </div>
                  );
                })()}

                <div style={{ padding: 12, borderRadius: 8, backgroundColor: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.25)', textAlign: 'center' }}>
                  <div style={{ fontSize: 10, color: '#D97706', fontWeight: 700, textTransform: 'uppercase' }}>Reservado</div>
                  <div style={{ fontSize: 20, fontWeight: 800, marginTop: 4, color: '#D97706' }}>
                    {selectedConsolidatedItem.cantidadReservada?.toLocaleString() || 0}
                  </div>
                  <div style={{ fontSize: 10, color: '#D97706' }}>comprometido</div>
                </div>

                <div style={{ padding: 12, borderRadius: 8, backgroundColor: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.25)', textAlign: 'center' }}>
                  <div style={{ fontSize: 10, color: '#DC2626', fontWeight: 700, textTransform: 'uppercase' }}>Bloqueado</div>
                  <div style={{ fontSize: 20, fontWeight: 800, marginTop: 4, color: '#DC2626' }}>
                    {selectedConsolidatedItem.cantidadBloqueada?.toLocaleString() || 0}
                  </div>
                  <div style={{ fontSize: 10, color: '#DC2626' }}>
                    {selectedConsolidatedItem.clasificacion === 'MERMA'
                      ? 'merma en DEV-01'
                      : selectedConsolidatedItem.clasificacion === 'EXCESO'
                      ? 'exceso en recepción'
                      : selectedConsolidatedItem.clasificacion === 'CUARENTENA'
                      ? 'retención por calidad'
                      : selectedConsolidatedItem.cantidadBloqueada > 0
                      ? 'stock bloqueado'
                      : 'sin retención'}
                  </div>
                </div>
              </div>

              {/* Atributos y Trazabilidad */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: 12,
                fontSize: 12,
                padding: 14,
                borderRadius: 8,
                backgroundColor: 'var(--bg-secondary)',
                border: '1px solid var(--border)'
              }}>
                <div>
                  <span style={{ color: 'var(--text-tertiary)' }}>Descripción Producto:</span>
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginTop: 2 }}>
                    {selectedConsolidatedItem.sku?.descripcion || selectedConsolidatedItem.sku?.nombre || 'No registrada'}
                  </div>
                </div>
                <div>
                  <span style={{ color: 'var(--text-tertiary)' }}>Depositante:</span>
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginTop: 2 }}>
                    {selectedConsolidatedItem.cliente?.nombreComercial || 'No registrado'}
                  </div>
                </div>
                <div>
                  <span style={{ color: 'var(--text-tertiary)' }}>Fecha de vencimiento:</span>
                  <div style={{ fontWeight: 600, color: (selectedConsolidatedItem.isExpired || selectedConsolidatedItem.clasificacion === 'EXPIRADO' || selectedConsolidatedItem.estadoPrincipalOperativo === 'VENCIDO') ? '#DC2626' : 'var(--text-primary)', marginTop: 2 }}>
                    {selectedConsolidatedItem.fechaVencimiento ? formatCalendarDate(selectedConsolidatedItem.fechaVencimiento) : 'No registrada'}
                    {(selectedConsolidatedItem.isExpired || selectedConsolidatedItem.clasificacion === 'EXPIRADO' || selectedConsolidatedItem.estadoPrincipalOperativo === 'VENCIDO') && ' (VENCIDO)'}
                  </div>
                </div>
                <div>
                  <span style={{ color: 'var(--text-tertiary)' }}>Fecha de Ingreso a Planta:</span>
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginTop: 2 }}>
                    {selectedConsolidatedItem.fechaIngreso ? new Date(selectedConsolidatedItem.fechaIngreso).toLocaleString('es-MX') : 'No registrada'}
                  </div>
                </div>
                {selectedConsolidatedItem.motivoBloqueo && (
                  <div style={{ gridColumn: 'span 2' }}>
                    <span style={{ color: 'var(--text-tertiary)' }}>Motivo de Retención / Bloqueo:</span>
                    <div style={{ fontWeight: 600, color: '#DC2626', marginTop: 2 }}>
                      {selectedConsolidatedItem.motivoBloqueo}
                    </div>
                  </div>
                )}
                {selectedConsolidatedItem.notas && (
                  <div style={{ gridColumn: 'span 2' }}>
                    <span style={{ color: 'var(--text-tertiary)' }}>Notas Operativas:</span>
                    <div style={{ fontWeight: 500, color: 'var(--text-secondary)', marginTop: 2 }}>
                      {selectedConsolidatedItem.notas}
                    </div>
                  </div>
                )}
              </div>

              {/* Lista de Bultos / Handling Units */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: 13 }}>
                    <Box size={14} style={{ color: 'var(--primary)' }} />
                    Bultos asociados (HUs) ({selectedConsolidatedItem.handlingUnits?.length || 0})
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Contenedores físicos que integran esta partida</span>
                </div>

                {selectedConsolidatedItem.handlingUnits && selectedConsolidatedItem.handlingUnits.length > 0 ? (
                  <>
                    <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
                      <table className="data-table" style={{ fontSize: 11 }}>
                        <thead>
                          <tr>
                            <th>Código HU</th>
                            <th style={{ textAlign: 'right' }}>Piezas Registradas (HU)</th>
                            <th>Tipo</th>
                            <th>Estado HU</th>
                            <th>Ubicación</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedConsolidatedItem.handlingUnits.map((hu: any) => {
                            const huState = (hu.estadoHu || hu.estado || 'ACTIVO').toUpperCase();
                            let badgeBg = 'rgba(148, 163, 184, 0.15)';
                            let badgeColor = '#64748B';
                            let badgeBorder = 'rgba(148, 163, 184, 0.3)';

                            if (huState === 'ACTIVO' || huState === 'ACTIVA') {
                              badgeBg = 'rgba(16, 185, 129, 0.15)';
                              badgeColor = '#059669';
                              badgeBorder = 'rgba(16, 185, 129, 0.3)';
                            } else if (huState === 'BLOQUEADO' || huState === 'BLOQUEADA' || huState === 'MERMA') {
                              badgeBg = 'rgba(239, 68, 68, 0.15)';
                              badgeColor = '#DC2626';
                              badgeBorder = 'rgba(239, 68, 68, 0.3)';
                            } else if (huState === 'CUARENTENA') {
                              badgeBg = 'rgba(217, 119, 6, 0.15)';
                              badgeColor = '#D97706';
                              badgeBorder = 'rgba(217, 119, 6, 0.3)';
                            } else if (huState === 'DESPACHADO' || huState === 'DESPACHADA') {
                              badgeBg = 'rgba(59, 130, 246, 0.15)';
                              badgeColor = '#2563EB';
                              badgeBorder = 'rgba(59, 130, 246, 0.3)';
                            }

                            return (
                              <tr key={hu.id}>
                                <td><code style={{ fontWeight: 700 }}>{hu.codigo}</code></td>
                                <td style={{ textAlign: 'right', fontWeight: 700 }}>{hu.cantidad?.toLocaleString() ?? 0}</td>
                                <td><span className="badge badge-neutral">{hu.tipoHu || hu.tipo || 'CAJA'}</span></td>
                                <td>
                                  <span style={{
                                    fontSize: 10,
                                    fontWeight: 700,
                                    padding: '2px 8px',
                                    borderRadius: 4,
                                    backgroundColor: badgeBg,
                                    color: badgeColor,
                                    border: `1px solid ${badgeBorder}`,
                                    display: 'inline-block',
                                    textAlign: 'center'
                                  }}>
                                    {huState}
                                  </span>
                                </td>
                                <td>
                                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontWeight: 600 }}>
                                    <MapPin size={11} /> {hu.ubicacionCodigo || selectedConsolidatedItem.ubicacion?.codigo || 'No registrada'}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* Nota de conciliación si la suma de las HUs difiere del Físico Total del lote */}
                    {(() => {
                      const huTotal = selectedConsolidatedItem.handlingUnits.reduce((acc: number, h: any) => acc + Number(h.cantidad || 0), 0);
                      if (huTotal !== selectedConsolidatedItem.cantidadFisica) {
                        return (
                          <div style={{
                            marginTop: 8,
                            padding: '8px 12px',
                            borderRadius: 6,
                            backgroundColor: 'rgba(217, 119, 6, 0.08)',
                            border: '1px solid rgba(217, 119, 6, 0.25)',
                            fontSize: 11,
                            color: '#B45309',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6
                          }}>
                            <AlertTriangle size={13} style={{ flexShrink: 0 }} />
                            <span>
                              <strong>Nota de trazabilidad:</strong> El saldo físico actual del lote ({selectedConsolidatedItem.cantidadFisica?.toLocaleString()} pzas) difiere de la cantidad registrada en la HU ({huTotal?.toLocaleString()} pzas). Esto ocurre cuando se realizaron transferencias parciales o mermas a nivel lote sin re-etiquetado/split físico de la caja contenedora original.
                            </span>
                          </div>
                        );
                      }
                      return null;
                    })()}
                  </>
                ) : (
                  <div style={{ padding: 20, textAlign: 'center', border: '1px dashed var(--border)', borderRadius: 8, color: 'var(--text-tertiary)', fontSize: 12 }}>
                    Esta partida no tiene Handling Units (HUs) individuales registradas.
                  </div>
                )}
              </div>
            </div>

            {/* Pie del Modal */}
            <div style={{
              padding: '14px 24px',
              borderTop: '1px solid var(--border)',
              display: 'flex',
              justifyContent: 'flex-end',
              backgroundColor: 'var(--bg-secondary)'
            }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setSelectedConsolidatedItem(null)}
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Operativo 1: Transferir / Mover entre Ubicaciones */}
      {selectedTransferItem && (
        <TransferModal
          item={selectedTransferItem}
          token={token || undefined}
          currentUser={user?.nombre || 'Supervisor Giving Out'}
          onClose={() => setSelectedTransferItem(null)}
          onSuccess={() => {
            setSelectedTransferItem(null);
            loadData();
          }}
        />
      )}

      {/* Modal Operativo 2: Enviar a Cuarentena Preventiva */}
      {selectedQuarantineItem && (
        <QuarantineModal
          item={selectedQuarantineItem}
          token={token || undefined}
          currentUser={user?.nombre || 'Supervisor de Calidad'}
          onClose={() => setSelectedQuarantineItem(null)}
          onSuccess={() => {
            setSelectedQuarantineItem(null);
            loadData();
          }}
        />
      )}
    </div>
  );
}
