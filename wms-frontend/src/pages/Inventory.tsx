import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { API } from '../config/api';
import {
  Download, RefreshCw, Tag, Box, Search, MapPin, Calendar,
  ShieldAlert, AlertTriangle, CheckCircle2, XCircle, Lock,
  Printer, Boxes, PlusCircle, ArrowRightLeft, ShieldCheck, CheckSquare, Square
} from 'lucide-react';
import { DivertToVirtualModal } from '../components/DivertToVirtualModal';
import { TransferToVirtualModal } from '../components/TransferToVirtualModal';
import { ReleaseFromVirtualModal } from '../components/ReleaseFromVirtualModal';
import { formatCalendarDate } from '../utils/dateUtils';

const demoLots = [
  {
    id: 'lot-1',
    skuId: 'sku-1',
    clienteId: 'cli-1',
    lote: 'L-2026-A1',
    cantidadDisponible: 250,
    cantidadReservada: 0,
    cantidadBloqueada: 0,
    estadoCalidad: 'LIBERADO',
    fechaVencimiento: null,
    sku: { codigo: 'CAM-S-BLA', descripcion: 'Camisa Algodón S Blanco', talla: 'S', color: 'Blanco', codigoBarras: '7501234567890' },
    cliente: { nombreComercial: 'Fashion Forward S.A.' },
    ubicacion: { codigo: 'A01-R01-N1' }
  },
  {
    id: 'lot-2',
    skuId: 'sku-2',
    clienteId: 'cli-1',
    lote: 'L-2026-A2',
    cantidadDisponible: 100,
    cantidadReservada: 0,
    cantidadBloqueada: 0,
    estadoCalidad: 'LIBERADO',
    fechaVencimiento: null,
    sku: { codigo: 'PAN-M-NEGRO', descripcion: 'Pantalón Casual M Negro', talla: 'M', color: 'Negro', codigoBarras: '7509876543210' },
    cliente: { nombreComercial: 'Fashion Forward S.A.' },
    ubicacion: { codigo: 'A02-R01-N2' }
  },
  {
    id: 'lot-3',
    skuId: 'sku-3',
    clienteId: 'cli-1',
    lote: 'L-2026-A3',
    cantidadDisponible: 50,
    cantidadReservada: 0,
    cantidadBloqueada: 0,
    estadoCalidad: 'LIBERADO',
    fechaVencimiento: null,
    sku: { codigo: 'SUD-L-CAP', descripcion: 'Sudadera con Capucha L', talla: 'L', color: 'Gris', codigoBarras: '7501122334455' },
    cliente: { nombreComercial: 'Fashion Forward S.A.' },
    ubicacion: { codigo: 'A03-R02-N1' }
  }
];

export function Inventory() {
  const { token } = useAuth();
  const [mainTab, setMainTab] = useState<'commercial' | 'virtual'>('commercial');
  const [commercialView, setCommercialView] = useState<'lots' | 'hus'>('lots');
  
  // Commercial Data
  const [lots, setLots] = useState<any[]>([]);
  const [hus, setHus] = useState<any[]>([]);
  const [huEstadoFilter, setHuEstadoFilter] = useState<'ALL' | 'ACTIVO' | 'DESPACHADO' | 'DAÑADO'>('ALL');
  const [clients, setClients] = useState<any[]>([]);
  
  // Virtual Warehouse Data (Tarea 5)
  const [virtualData, setVirtualData] = useState<any[]>([]);
  const [virtualStats, setVirtualStats] = useState({ totalItems: 0, totalUnidades: 0, totalMerma: 0, totalExceso: 0, lotesMerma: 0, lotesExceso: 0 });
  const [virtualTipoFilter, setVirtualTipoFilter] = useState<'TODOS' | 'MERMA' | 'EXCESO'>('TODOS');
  
  // Shared filters & UI states
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterClient, setFilterClient] = useState('');
  const [divertModalOpen, setDivertModalOpen] = useState(false);
  const [selectedPrintItem, setSelectedPrintItem] = useState<any | null>(null);

  // Transferencia Manual y Masiva (Requerimiento 3)
  const [selectedLotIds, setSelectedLotIds] = useState<string[]>([]);
  const [transferModalOpen, setTransferModalOpen] = useState(false);
  const [itemsToTransfer, setItemsToTransfer] = useState<any[]>([]);
  const [preselectedMotivo, setPreselectedMotivo] = useState<string>('No conforme');

  // Liberación desde Almacén Virtual
  const [releaseModalOpen, setReleaseModalOpen] = useState(false);
  const [itemToRelease, setItemToRelease] = useState<any | null>(null);

  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    loadData();
  }, [mainTab, filterClient, virtualTipoFilter]);

  async function loadData() {
    setLoading(true);
    try {
      if (mainTab === 'commercial') {
        const [lotsRes, husRes, clientsRes] = await Promise.all([
          fetch(`${API}/inventory/lots?tipoStock=DISPONIBLE`, { headers }),
          fetch(`${API}/inventory/handling-units?estado=TODOS`, { headers }),
          fetch(`${API}/clients`, { headers }),
        ]);
        if (lotsRes.ok) {
          const data = await lotsRes.json();
          setLots(data.length > 0 ? data : demoLots);
        } else {
          setLots(demoLots);
        }
        if (husRes.ok) setHus(await husRes.json());
        if (clientsRes.ok) setClients(await clientsRes.json());
      } else {
        // Cargar datos del Almacén Virtual de No Conforme / Merma
        let url = `${API}/inventory/virtual-warehouse?`;
        if (filterClient) url += `clienteId=${filterClient}&`;
        if (virtualTipoFilter !== 'TODOS') url += `tipoDesvio=${virtualTipoFilter}&`;

        const [vwRes, clientsRes] = await Promise.all([
          fetch(url, { headers }),
          fetch(`${API}/clients`, { headers }),
        ]);

        if (vwRes.ok) {
          const resJson = await vwRes.json();
          const rawLots = resJson.lotes || resJson.data || [];
          const normalized = rawLots.map((v: any) => ({
            ...v,
            tipoDesvio: v.tipoDesvio || (v.ubicacion?.codigo === 'NC-EXCESO-01' || v.notas?.includes('PRODUCTO_EXCESO') ? 'EXCESO' : 'MERMA'),
            folioActa: v.folioActa || (v.notas?.includes('ACTA-NC-') ? v.notas.match(/ACTA-NC-[A-Z0-9-]+/)?.[0] : null) || `ACTA-NC-${new Date(v.createdAt).getFullYear()}-${v.id.slice(0, 5).toUpperCase()}`,
          }));
          setVirtualData(normalized);
          setVirtualStats({
            totalItems: resJson.totalLotes ?? normalized.length,
            totalUnidades: resJson.totalPiezasBloqueadas ?? 0,
            totalMerma: resJson.piezasDanadas ?? 0,
            totalExceso: resJson.piezasExceso ?? 0,
            lotesMerma: resJson.lotesMerma ?? normalized.filter((x: any) => x.tipoDesvio === 'MERMA' || x.ubicacion?.codigo !== 'NC-EXCESO-01').length,
            lotesExceso: resJson.lotesExceso ?? normalized.filter((x: any) => x.tipoDesvio === 'EXCESO' || x.ubicacion?.codigo === 'NC-EXCESO-01').length,
          });
        }
        if (clientsRes.ok) setClients(await clientsRes.json());
      }
    } catch (err) {
      console.error(err);
      if (mainTab === 'commercial') setLots(demoLots);
    }
    setLoading(false);
  }

  // Filtrado Comercial
  const filteredLots = lots.filter(l => {
    const q = search.toLowerCase().trim();
    const matchSearch = !q ||
      l.sku?.descripcion?.toLowerCase().includes(q) ||
      l.sku?.codigo?.toLowerCase().includes(q) ||
      l.lote?.toLowerCase().includes(q) ||
      l.ubicacion?.codigo?.toLowerCase().includes(q);
    const matchClient = !filterClient || l.clienteId === filterClient;
    return matchSearch && matchClient;
  });

  // Clasificación robusta de estados de HUs basada en datos reales de API/BD
  const isHuActive = (h: any) => h.estadoHu === 'ACTIVO' || h.estadoHu === 'DISPONIBLE' || h.estadoHu === 'ALMACENADO' || (!h.estadoHu && h.ubicacionActual && !h.ubicacionActual.includes('RAMPA') && h.ubicacionActual !== 'DESPACHADO');
  const isHuDispatched = (h: any) => h.estadoHu === 'DESPACHADO' || h.ubicacionActual === 'DESPACHADO';
  const isHuInactive = (h: any) => h.estadoHu === 'INACTIVO' || h.estadoHu === 'DAÑADO' || h.estadoHu === 'BAJA' || h.estadoHu === 'MERMA' || h.estadoHu === 'CUARENTENA' || h.ubicacionActual === 'RAMPA_RECEPCION' || h.ubicacionActual?.includes('QA');

  // HUs filtradas estrictamente por depositante y búsqueda activa
  const clientAndSearchHus = hus.filter(h => {
    const q = search.toLowerCase().trim();
    const matchSearch = !q ||
      h.codigo?.toLowerCase().includes(q) ||
      h.loteTexto?.toLowerCase().includes(q) ||
      h.lote?.lote?.toLowerCase().includes(q) ||
      h.lote?.sku?.descripcion?.toLowerCase().includes(q) ||
      h.lote?.sku?.codigo?.toLowerCase().includes(q) ||
      h.skuCodigo?.toLowerCase().includes(q) ||
      h.skuDescripcion?.toLowerCase().includes(q) ||
      h.ubicacionActual?.toLowerCase().includes(q);
    const matchClient = !filterClient || h.clienteId === filterClient;
    return matchSearch && matchClient;
  });

  // Contadores dinámicos restringidos al cliente y búsqueda actual
  const clientActiveHus = clientAndSearchHus.filter(isHuActive);
  const clientDispatchedHus = clientAndSearchHus.filter(isHuDispatched);
  const clientInactiveHus = clientAndSearchHus.filter(isHuInactive);

  // HUs mostradas en tabla según filtro de estado seleccionado
  const filteredHus = clientAndSearchHus.filter(h => {
    if (huEstadoFilter === 'ALL') return true;
    if (huEstadoFilter === 'ACTIVO') return isHuActive(h);
    if (huEstadoFilter === 'DESPACHADO') return isHuDispatched(h);
    if (huEstadoFilter === 'DAÑADO') return isHuInactive(h);
    return true;
  });

  const uniqueLotCodes = new Set(filteredLots.map(l => l.lote).filter(Boolean)).size;
  const activeHus = clientActiveHus;
  const activeHuUnits = activeHus.reduce((s, h) => s + (Number(h.cantidad) || Number(h.cantidadActual) || 0), 0);
  const dispatchedHus = clientDispatchedHus;
  const dispatchedHuUnits = dispatchedHus.reduce((s, h) => s + (Number(h.cantidad) || 0), 0);
  const inactiveHus = clientInactiveHus;
  const inactiveHuOrigUnits = inactiveHus.reduce((s, h) => s + (Number(h.cantidad) || 0), 0);

  // Disponibilidad de caja cerrada: distingue existencias físicas vs stock elegible estándar
  const selectedClientObj = clients.find(c => c.id === filterClient);
  const isCajaCerradaClient = Boolean(selectedClientObj && (selectedClientObj.reglaInventario === 'CAJA_CERRADA' || selectedClientObj.nombreComercial?.includes('AlimNorte')));
  const partialHusPieces = activeHus.filter(h => h.reacondicionada || h.cajaOrigenId || (h.piezasPorCaja && h.cantidad < h.piezasPorCaja)).reduce((s, h) => s + (Number(h.cantidad) || 0), 0);
  const totalElegibleCajaCerrada = isCajaCerradaClient ? Math.max(0, activeHuUnits - partialHusPieces) : activeHuUnits;

  // Filtrado Almacén Virtual
  const filteredVirtual = virtualData.filter(v => {
    const matchTipo = virtualTipoFilter === 'TODOS' ||
      (virtualTipoFilter === 'MERMA' && (v.tipoDesvio === 'MERMA' || v.ubicacion?.codigo !== 'NC-EXCESO-01')) ||
      (virtualTipoFilter === 'EXCESO' && (v.tipoDesvio === 'EXCESO' || v.ubicacion?.codigo === 'NC-EXCESO-01'));
    const matchSearch = !search ||
      v.sku?.codigo?.toLowerCase().includes(search.toLowerCase()) ||
      v.sku?.nombre?.toLowerCase().includes(search.toLowerCase()) ||
      v.sku?.descripcion?.toLowerCase().includes(search.toLowerCase()) ||
      v.lote?.toLowerCase().includes(search.toLowerCase()) ||
      v.folioActa?.toLowerCase().includes(search.toLowerCase()) ||
      v.handlingUnits?.some((hu: any) => hu.codigo?.toLowerCase().includes(search.toLowerCase()));
    return matchTipo && matchSearch;
  });

  const now = new Date();
  const totalFisico = filteredLots.reduce((s, l) => s + (l.cantidadDisponible || 0), 0);
  const totalReservado = filteredLots.reduce((s, l) => s + Math.max(0, l.cantidadReservada || 0), 0);
  const totalDisponible = filteredLots.reduce((s, l) => {
    const isExpired = Boolean(l.fechaVencimiento && new Date(l.fechaVencimiento) <= now);
    const isBlocked = l.estadoCalidad !== 'LIBERADO';
    if (isExpired || isBlocked) return s;
    const fis = l.cantidadFisica ?? l.cantidadDisponible ?? 0;
    const res = Math.max(0, l.cantidadReservada ?? 0);
    return s + Math.max(0, fis - res);
  }, 0);

  // Funciones de Selección y Transferencia Masiva (Requerimiento 3)
  const handleSelectAllLots = () => {
    setSelectedLotIds(filteredLots.map(l => l.id));
  };
  const handleDeselectAllLots = () => {
    setSelectedLotIds([]);
  };
  const toggleSelectLot = (id: string) => {
    setSelectedLotIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };
  const handleBulkTransfer = () => {
    const selected = filteredLots.filter(l => selectedLotIds.includes(l.id));
    if (selected.length === 0) return;
    setItemsToTransfer(selected);
    const hasExpired = selected.some(l => Boolean(l.fechaVencimiento && new Date(l.fechaVencimiento) <= now));
    setPreselectedMotivo(hasExpired ? 'Caducado' : 'No conforme');
    setTransferModalOpen(true);
  };

  function downloadCSV() {
    let csv = '';
    let filename = '';

    if (mainTab === 'virtual') {
      csv = 'Folio Acta,Tipo Desvío,SKU,Descripción,Cliente,Lote,Cant. Bloqueada,Cant. Disponible,Ubicación Virtual,Estado Calidad,Fecha Ingreso\n';
      filteredVirtual.forEach(v => {
        csv += `"${v.folioActa || ''}","${v.tipoDesvio || ''}","${v.sku?.codigo || ''}","${v.sku?.nombre || ''}","${v.cliente?.nombreComercial || ''}","${v.lote || ''}",${v.cantidadBloqueada},${v.cantidadDisponible},"${v.ubicacion?.codigo || ''}","${v.estadoCalidad}","${v.fechaIngreso ? new Date(v.fechaIngreso).toLocaleDateString('es-MX') : ''}"\n`;
      });
      filename = `almacen_virtual_no_conforme_${new Date().toISOString().slice(0, 10)}.csv`;
    } else if (commercialView === 'lots') {
      csv = 'SKU,Descripción,Cliente,Lote,Físico,Reservado,Disponible,Ubicación,Calidad,Vencimiento\n';
      filteredLots.forEach(l => {
        const isExp = Boolean(l.fechaVencimiento && new Date(l.fechaVencimiento) <= now);
        const isBlk = l.estadoCalidad !== 'LIBERADO';
        const fis = l.cantidadFisica ?? l.cantidadDisponible ?? 0;
        const res = Math.max(0, l.cantidadReservada ?? 0);
        const disp = (!isExp && !isBlk) ? (l.cantidadDisponibleLibre ?? Math.max(0, fis - res)) : 0;
        csv += `"${l.sku?.codigo || ''}","${l.sku?.descripcion || ''}${l.sku?.talla ? ` (${l.sku.talla})` : ''}","${l.cliente?.nombreComercial || ''}","${l.lote || ''}",${fis},${res},${disp},"${l.ubicacion?.codigo || ''}","${isExp ? 'CADUCADO' : l.estadoCalidad}","${l.fechaVencimiento ? formatCalendarDate(l.fechaVencimiento) : ''}"\n`;
      });
      filename = `inventario_lotes_${new Date().toISOString().slice(0, 10)}.csv`;
    } else {
      csv = 'Código HU,Tipo,SKU,Cliente,Cantidad,Estado,Etiqueta,Creado\n';
      filteredHus.forEach(h => {
        csv += `"${h.codigo}","${h.tipoHu}","${h.lote?.sku?.descripcion || ''}","${h.cliente?.nombreComercial || ''}",${h.cantidad},"${h.estadoHu}","${h.etiquetaImpresa ? 'Sí' : 'No'}","${new Date(h.createdAt).toLocaleDateString('es-MX')}"\n`;
      });
      filename = `inventario_hus_${new Date().toISOString().slice(0, 10)}.csv`;
    }

    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  return (
    <div className="page-container">
      {/* Header Principal con Tabs de Alto Rendimiento */}
      <div className="page-header" style={{ alignItems: 'flex-start' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1 className="page-title">Inventario & Control de Existencias</h1>
          </div>
          <p className="page-subtitle">
            {mainTab === 'commercial' ? (
              commercialView === 'hus' ? (
                <>
                  <strong style={{ color: 'var(--primary)' }}>Stock físico actual: {activeHus.length} cajas activas · {activeHuUnits.toLocaleString()} piezas</strong>
                  {dispatchedHus.length > 0 && (
                    <span style={{ color: '#64748B' }}> · {dispatchedHus.length} despachadas ({dispatchedHuUnits} pzas históricas)</span>
                  )}
                  {inactiveHus.length > 0 && (
                    <span style={{ color: '#F59E0B' }}> · {inactiveHus.length} dañada/inactiva (0 pzas stock actual, {inactiveHuOrigUnits} pzas originales)</span>
                  )}
                  {search ? ` · coincidencias con "${search}"` : ''}
                </>
              ) : (
                <>
                  {totalFisico.toLocaleString()} unidades físicas · {totalReservado.toLocaleString()} reservadas · <strong style={{ color: 'var(--teal)' }}>{totalDisponible.toLocaleString()} stock libre</strong>
                  {isCajaCerradaClient && partialHusPieces > 0 && (
                    <span style={{ color: '#B45309', fontWeight: 600 }}> · {totalElegibleCajaCerrada.toLocaleString()} elegibles para caja cerrada (excluye {partialHusPieces} pzas en cajas parciales)</span>
                  )}
                  {search ? ` (filtrado: ${filteredLots.length} registros)` : ''}
                </>
              )
            ) : (
              <span style={{ color: '#F87171', fontWeight: 600 }}>
                {virtualStats.totalUnidades.toLocaleString()} unidades retenidas en Cuarentena · 100% aisladas de despacho
              </span>
            )}
          </p>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {mainTab === 'virtual' && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setDivertModalOpen(true)}
              style={{
                background: 'rgba(239, 68, 68, 0.15)',
                border: '1px solid #EF4444',
                color: '#F87171',
                fontWeight: 700,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6
              }}
            >
              <PlusCircle size={15} /> Nuevo Desvío a Cuarentena
            </button>
          )}
          <button className="btn btn-secondary" onClick={downloadCSV}>
            <Download size={16} /> CSV
          </button>
          <button className="btn btn-secondary" onClick={loadData}>
            <RefreshCw size={16} /> Actualizar
          </button>
        </div>
      </div>

      {/* Selector de Pestaña Principal: Comercial vs Almacén Virtual */}
      <div style={{
        display: 'flex',
        gap: 8,
        marginBottom: 16,
        borderBottom: '1px solid var(--border)',
        paddingBottom: 8
      }}>
        <button
          type="button"
          onClick={() => setMainTab('commercial')}
          style={{
            padding: '10px 18px',
            borderRadius: 8,
            border: mainTab === 'commercial' ? '1px solid var(--primary)' : '1px solid transparent',
            background: mainTab === 'commercial' ? 'rgba(13, 148, 136, 0.12)' : 'transparent',
            color: mainTab === 'commercial' ? '#2DD4BF' : '#94A3B8',
            fontWeight: 800,
            fontSize: 13,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8
          }}
        >
          <Box size={16} /> Stock Operativo Comercial
        </button>

        <button
          type="button"
          onClick={() => setMainTab('virtual')}
          style={{
            padding: '10px 18px',
            borderRadius: 8,
            border: mainTab === 'virtual' ? '1px solid #EF4444' : '1px solid transparent',
            background: mainTab === 'virtual' ? 'rgba(239, 68, 68, 0.12)' : 'transparent',
            color: mainTab === 'virtual' ? '#F87171' : '#94A3B8',
            fontWeight: 800,
            fontSize: 13,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8
          }}
        >
          <ShieldAlert size={16} color={mainTab === 'virtual' ? '#EF4444' : '#94A3B8'} />
          <span>Almacén Virtual (No Conforme / Merma)</span>
          {virtualStats.totalUnidades > 0 && (
            <span style={{
              background: '#EF4444',
              color: '#FFFFFF',
              fontSize: 11,
              fontWeight: 800,
              padding: '2px 7px',
              borderRadius: 12
            }}>
              {virtualStats.totalUnidades}
            </span>
          )}
        </button>
      </div>

      {/* KPI STRIP CUANDO SE ENCUENTRA EN ALMACÉN VIRTUAL */}
      {mainTab === 'virtual' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 18 }}>
          <div className="card" style={{ padding: '14px 18px', borderLeft: '4px solid #EF4444' }}>
            <div style={{ fontSize: 11, color: '#94A3B8', fontWeight: 700, textTransform: 'uppercase' }}>Total Unidades en Cuarentena</div>
            <div style={{ fontSize: 22, fontWeight: 900, color: '#F87171', marginTop: 4 }}>
              {virtualStats.totalUnidades.toLocaleString()} pzas
            </div>
            <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>{virtualStats.totalItems} lote(s) registrados</div>
          </div>

          <div className="card" style={{ padding: '14px 18px', borderLeft: '4px solid #F59E0B' }}>
            <div style={{ fontSize: 11, color: '#94A3B8', fontWeight: 700, textTransform: 'uppercase' }}>Merma / Daño Físico</div>
            <div style={{ fontSize: 22, fontWeight: 900, color: '#FBBF24', marginTop: 4 }}>
              {virtualStats.totalMerma.toLocaleString()} pzas
            </div>
            <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>Ubicación: DEV-01</div>
          </div>

          <div className="card" style={{ padding: '14px 18px', borderLeft: '4px solid #38BDF8' }}>
            <div style={{ fontSize: 11, color: '#94A3B8', fontWeight: 700, textTransform: 'uppercase' }}>Excedentes no Amparados</div>
            <div style={{ fontSize: 22, fontWeight: 900, color: '#38BDF8', marginTop: 4 }}>
              {virtualStats.totalExceso.toLocaleString()} pzas
            </div>
            <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>Ubicación: NC-EXCESO-01</div>
          </div>

          <div className="card" style={{ padding: '14px 18px', borderLeft: '4px solid #10B981', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#34D399', fontWeight: 800, fontSize: 13 }}>
              <Lock size={16} /> Aislamiento Picking 100%
            </div>
            <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 4 }}>
              Cantidad Disponible = 0. Ninguna orden de picking puede tocar este inventario.
            </div>
          </div>
        </div>
      )}

      {/* Barra de Filtros y Búsqueda */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 12, padding: '14px 18px', flexWrap: 'wrap', alignItems: 'center' }}>
          {mainTab === 'commercial' ? (
            <div className="btn-group">
              <button
                className={`btn btn-sm ${commercialView === 'lots' ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setCommercialView('lots')}
              >
                <Tag size={14} /> Lotes ({uniqueLotCodes} lotes distintos · {filteredLots.length} registros por ubicación)
              </button>
              <button
                className={`btn btn-sm ${commercialView === 'hus' ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setCommercialView('hus')}
              >
                <Box size={14} /> HUs ({activeHus.length} activas · {filteredHus.length} total histórico)
              </button>
            </div>
          ) : (
            <div className="btn-group">
              <button
                className={`btn btn-sm ${virtualTipoFilter === 'TODOS' ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setVirtualTipoFilter('TODOS')}
              >
                Todos ({virtualStats.totalItems})
              </button>
              <button
                className={`btn btn-sm ${virtualTipoFilter === 'MERMA' ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setVirtualTipoFilter('MERMA')}
                style={{ color: virtualTipoFilter === 'MERMA' ? '#FFF' : '#F87171' }}
              >
                <AlertTriangle size={13} /> Merma / Dañado ({virtualStats.lotesMerma})
              </button>
              <button
                className={`btn btn-sm ${virtualTipoFilter === 'EXCESO' ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setVirtualTipoFilter('EXCESO')}
                style={{ color: virtualTipoFilter === 'EXCESO' ? '#FFF' : '#38BDF8' }}
              >
                <Boxes size={13} /> Sobrante / Exceso ({virtualStats.lotesExceso})
              </button>
            </div>
          )}

          <div className="search-box" style={{ flex: 1, minWidth: 220 }}>
            <Search size={16} />
            <input
              placeholder={mainTab === 'commercial' ? "Buscar SKU, lote, código HU..." : "Buscar SKU, lote, folio acta NC, HU..."}
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          <select
            className="form-select"
            value={filterClient}
            onChange={e => setFilterClient(e.target.value)}
            style={{ minWidth: 180 }}
          >
            <option value="">Todos los clientes</option>
            {clients.map((c: any) => (
              <option key={c.id} value={c.id}>{c.nombreComercial}</option>
            ))}
          </select>
        </div>
      </div>

      {/* CONTENIDO PRINCIPAL SEGÚN PESTAÑA */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-secondary)' }}>
          <RefreshCw className="animate-spin" size={24} /> Cargando inventario...
        </div>
      ) : mainTab === 'virtual' ? (
        /* VISTA TABLA: ALMACÉN VIRTUAL DE NO CONFORME / MERMA */
        <div className="card">
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Folio Acta NC</th>
                  <th>Tipo Desvío</th>
                  <th>SKU</th>
                  <th>Descripción</th>
                  <th>Cliente</th>
                  <th>Lote</th>
                  <th style={{ textAlign: 'right' }}>Cant. Bloqueada</th>
                  <th>Ubicación Virtual</th>
                  <th>Estado Calidad</th>
                  <th>Fecha Ingreso</th>
                  <th style={{ textAlign: 'center' }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filteredVirtual.map((v, i) => (
                  <tr key={i} className="animate-fade-in" style={{ animationDelay: `${i * 0.02}s` }}>
                    <td>
                      <span style={{
                        fontFamily: 'monospace',
                        fontWeight: 800,
                        fontSize: 12,
                        background: 'rgba(56, 189, 248, 0.12)',
                        color: '#38BDF8',
                        padding: '2px 8px',
                        borderRadius: 4,
                        border: '1px solid rgba(56, 189, 248, 0.3)'
                      }}>
                        {v.folioActa || 'ACTA-NC-001'}
                      </span>
                    </td>
                    <td>
                      {v.tipoDesvio === 'MERMA' ? (
                        <span style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          fontSize: 11,
                          fontWeight: 800,
                          color: '#F87171',
                          background: 'rgba(239, 68, 68, 0.15)',
                          padding: '2px 8px',
                          borderRadius: 4,
                          border: '1px solid rgba(239, 68, 68, 0.35)'
                        }}>
                          <AlertTriangle size={12} /> Merma / Daño
                        </span>
                      ) : (
                        <span style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          fontSize: 11,
                          fontWeight: 800,
                          color: '#38BDF8',
                          background: 'rgba(56, 189, 248, 0.15)',
                          padding: '2px 8px',
                          borderRadius: 4,
                          border: '1px solid rgba(56, 189, 248, 0.35)'
                        }}>
                          <Boxes size={12} /> Excedente
                        </span>
                      )}
                    </td>
                    <td>
                      <code style={{ fontSize: 12, background: 'var(--bg-secondary)', padding: '2px 6px', borderRadius: 4 }}>
                        {v.sku?.codigo}
                      </code>
                    </td>
                    <td style={{ fontWeight: 500, whiteSpace: 'normal', minWidth: 180 }}>
                      {v.sku?.nombre || v.sku?.descripcion}
                    </td>
                    <td><span className="badge badge-info">{v.cliente?.nombreComercial}</span></td>
                    <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{v.lote || '—'}</td>
                    <td style={{ textAlign: 'right' }}>
                      <span style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        fontWeight: 800,
                        color: '#F87171',
                        fontSize: 13
                      }}>
                        <Lock size={12} /> {v.cantidadBloqueada} pzas
                      </span>
                    </td>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#FBBF24', fontWeight: 700 }}>
                        <MapPin size={12} /> {v.ubicacion?.codigo || 'DEV-01'}
                      </span>
                    </td>
                    <td>
                      <span style={{
                        fontSize: 10,
                        fontWeight: 800,
                        padding: '2px 6px',
                        borderRadius: 4,
                        background: 'rgba(239, 68, 68, 0.15)',
                        color: '#F87171',
                        border: '1px solid rgba(239, 68, 68, 0.3)'
                      }}>
                        {v.estadoCalidad}
                      </span>
                    </td>
                    <td>
                      {v.fechaIngreso ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-tertiary)' }}>
                          <Calendar size={12} /> {new Date(v.fechaIngreso).toLocaleDateString('es-MX')}
                        </span>
                      ) : '—'}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center', justifyContent: 'center' }}>
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => {
                            setItemToRelease(v);
                            setReleaseModalOpen(true);
                          }}
                          title="Liberar / Reintegrar a Stock Operativo Comercial"
                          style={{
                            padding: '6px 11px',
                            backgroundColor: 'rgba(16, 185, 129, 0.18)',
                            border: '1px solid #10B981',
                            color: '#34D399',
                            fontWeight: 700,
                            fontSize: 11.5,
                            borderRadius: 6,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 5,
                            cursor: 'pointer',
                          }}
                        >
                          <ShieldCheck size={14} />
                          <span>Liberar a Stock</span>
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => setSelectedPrintItem(v)}
                          title="Imprimir papeleta oficial de pallet retenido en cuarentena"
                          style={{
                            padding: '6px 11px',
                            backgroundColor: '#DC2626',
                            borderColor: '#DC2626',
                            color: '#FFFFFF',
                            fontWeight: 700,
                            fontSize: 11.5,
                            borderRadius: 6,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 5,
                            cursor: 'pointer',
                            boxShadow: '0 2px 4px rgba(220, 38, 38, 0.35)'
                          }}
                        >
                          <Printer size={13} style={{ color: '#FFFFFF' }} />
                          <span>Imprimir Ficha</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredVirtual.length === 0 && (
                  <tr>
                    <td colSpan={11} style={{ textAlign: 'center', padding: 40, color: 'var(--text-tertiary)' }}>
                      Sin mercancía en almacén virtual de No Conforme
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', fontSize: 13, color: 'var(--text-tertiary)', display: 'flex', justifyContent: 'space-between' }}>
            <span>{filteredVirtual.length} partidas retenidas</span>
            <span>Total retenido: {virtualStats.totalUnidades.toLocaleString()} uds</span>
          </div>
        </div>
      ) : commercialView === 'lots' ? (
        /* VISTA TABLA: LOTES COMERCIALES */
        <div className="card">
          {/* Barra de Acciones Masivas y Selección (Requerimiento 3) */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 18px',
            backgroundColor: selectedLotIds.length > 0 ? 'rgba(56, 189, 248, 0.08)' : 'rgba(30, 41, 59, 0.4)',
            borderBottom: '1px solid var(--border)',
            flexWrap: 'wrap',
            gap: 10
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={handleSelectAllLots}
                style={{ fontSize: 12, padding: '4px 10px', display: 'inline-flex', alignItems: 'center', gap: 5 }}
              >
                <CheckSquare size={14} /> Seleccionar todos ({filteredLots.length})
              </button>
              {selectedLotIds.length > 0 && (
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={handleDeselectAllLots}
                  style={{ fontSize: 12, padding: '4px 10px', color: '#94A3B8' }}
                >
                  Deseleccionar todos
                </button>
              )}
              {selectedLotIds.length > 0 && (
                <span style={{ fontSize: 12, fontWeight: 700, color: '#38BDF8' }}>
                  {selectedLotIds.length} seleccionado(s)
                </span>
              )}
            </div>

            {selectedLotIds.length > 0 && (
              <button
                type="button"
                className="btn btn-sm"
                onClick={handleBulkTransfer}
                style={{
                  backgroundColor: '#EF4444',
                  border: '1px solid #DC2626',
                  color: '#FFFFFF',
                  fontWeight: 700,
                  fontSize: 12,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  boxShadow: '0 2px 6px rgba(239, 68, 68, 0.4)',
                  cursor: 'pointer',
                }}
              >
                <ArrowRightLeft size={14} />
                <span>Transferir seleccionados ({selectedLotIds.length})</span>
              </button>
            )}
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 36, textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={filteredLots.length > 0 && selectedLotIds.length === filteredLots.length}
                      onChange={e => {
                        if (e.target.checked) handleSelectAllLots();
                        else handleDeselectAllLots();
                      }}
                      style={{ cursor: 'pointer' }}
                    />
                  </th>
                  <th>SKU</th>
                  <th>Descripción</th>
                  <th>Cliente</th>
                  <th>Lote</th>
                  <th style={{ textAlign: 'right' }}>Físico</th>
                  <th style={{ textAlign: 'right' }}>Reservado</th>
                  <th style={{ textAlign: 'right' }}>Disponible</th>
                  <th>Ubicación</th>
                  <th>Calidad</th>
                  <th>Vencimiento</th>
                  <th style={{ textAlign: 'center' }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filteredLots.map((l, i) => {
                  const isExpired = Boolean(l.fechaVencimiento && new Date(l.fechaVencimiento) <= now);
                  const isBlocked = l.estadoCalidad !== 'LIBERADO';
                  const fis = l.cantidadFisica ?? l.cantidadDisponible ?? 0;
                  const res = Math.max(0, l.cantidadReservada ?? 0);
                  const disp = (!isExpired && !isBlocked) ? (l.cantidadDisponibleLibre ?? Math.max(0, fis - res)) : 0;
                  return (
                    <tr
                      key={l.id || i}
                      className="animate-fade-in"
                      style={{
                        animationDelay: `${i * 0.02}s`,
                        backgroundColor: isExpired ? 'rgba(239, 68, 68, 0.06)' : selectedLotIds.includes(l.id) ? 'rgba(56, 189, 248, 0.08)' : 'transparent',
                      }}
                    >
                      <td style={{ textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={selectedLotIds.includes(l.id)}
                          onChange={() => toggleSelectLot(l.id)}
                          style={{ cursor: 'pointer' }}
                        />
                      </td>
                      <td><code style={{ fontSize: 12, background: 'var(--bg-secondary)', padding: '2px 6px', borderRadius: 4 }}>{l.sku?.codigo}</code></td>
                      <td style={{ fontWeight: 500, whiteSpace: 'normal', minWidth: 180 }}>{l.sku?.descripcion}{l.sku?.talla ? ` (${l.sku.talla})` : ''}{l.sku?.color ? ` — ${l.sku.color}` : ''}</td>
                      <td><span className="badge badge-info">{l.cliente?.nombreComercial}</span></td>
                      <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{l.lote || '—'}</td>
                      <td style={{ fontWeight: 600, textAlign: 'right', color: '#1E293B' }}>{fis}</td>
                      <td style={{ color: res > 0 ? 'var(--orange)' : 'var(--text-tertiary)', textAlign: 'right', fontWeight: res > 0 ? 600 : 400 }}>{res > 0 ? res : '—'}</td>
                      <td style={{ fontWeight: 700, color: isExpired ? 'var(--text-tertiary)' : 'var(--teal)', textAlign: 'right' }}>
                        {disp}
                        {isExpired && (
                          <div style={{ marginTop: 4 }}>
                            <button
                              type="button"
                              onClick={() => {
                                setItemsToTransfer([l]);
                                setPreselectedMotivo('Caducado');
                                setTransferModalOpen(true);
                              }}
                              title="Lote caducado: haga clic para transferir directamente a No Conforme"
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 3,
                                padding: '3px 7px',
                                borderRadius: 4,
                                backgroundColor: 'rgba(239, 68, 68, 0.18)',
                                border: '1px solid #EF4444',
                                color: '#F87171',
                                fontSize: 10,
                                fontWeight: 800,
                                cursor: 'pointer',
                              }}
                            >
                              <AlertTriangle size={10} /> Caducado · Transferir a No Conforme
                            </button>
                          </div>
                        )}
                      </td>
                      <td><span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-secondary)' }}><MapPin size={12} />{l.ubicacion?.codigo || '—'}</span></td>
                      <td>
                        <span className={`badge badge-${isExpired ? 'danger' : (l.estadoCalidad === 'LIBERADO' ? 'success' : l.estadoCalidad === 'CUARENTENA' ? 'warning' : 'danger')}`}>
                          {isExpired ? 'CADUCADO' : l.estadoCalidad}
                        </span>
                      </td>
                      <td>
                        {l.fechaVencimiento ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: isExpired ? 'var(--danger)' : 'inherit', fontWeight: isExpired ? 700 : 400 }}>
                            <Calendar size={12} />
                            {formatCalendarDate(l.fechaVencimiento)}
                            {isExpired && ' (Vencido)'}
                          </span>
                        ) : '—'}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost"
                          onClick={() => {
                            setItemsToTransfer([l]);
                            setPreselectedMotivo(isExpired ? 'Caducado' : 'No conforme');
                            setTransferModalOpen(true);
                          }}
                          title="Transferir / Mover a Almacén Virtual"
                          style={{
                            padding: '4px 9px',
                            fontSize: 11.5,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            color: '#38BDF8',
                            border: '1px solid rgba(56, 189, 248, 0.35)',
                            borderRadius: 5,
                            cursor: 'pointer',
                          }}
                        >
                          <ArrowRightLeft size={12} /> Transferir / Mover
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {filteredLots.length === 0 && <tr><td colSpan={12} style={{ textAlign: 'center', padding: 40, color: 'var(--text-tertiary)' }}>Sin lotes en inventario</td></tr>}
              </tbody>
            </table>
          </div>
          <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', fontSize: 13, color: 'var(--text-tertiary)', display: 'flex', justifyContent: 'space-between' }}>
            <span><strong>{uniqueLotCodes}</strong> lotes distintos (en {filteredLots.length} registros por ubicación)</span>
            <span>Total Físico: {totalFisico.toLocaleString()} uds · Reservado: {totalReservado.toLocaleString()} uds · Disponible: <strong style={{ color: 'var(--teal)' }}>{totalDisponible.toLocaleString()}</strong> uds</span>
          </div>
        </div>
      ) : (
        /* VISTA TABLA: HUs COMERCIALES (SIN EMOJIS GENÉRICOS) */
        <div className="card">
          {/* Sub-filtro de estatus de Handling Units con contadores de ámbito local (Point 1) */}
          <div style={{ display: 'flex', gap: 8, padding: '12px 18px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginRight: 6 }}>Estado HU:</span>
            {[
              { key: 'ALL', label: `Todas (${clientAndSearchHus.length})` },
              { key: 'ACTIVO', label: `Activas en Racks (${clientActiveHus.length})` },
              { key: 'DESPACHADO', label: `Despachadas (${clientDispatchedHus.length})` },
              { key: 'DAÑADO', label: `Dañadas / Inactivas (${clientInactiveHus.length})` },
            ].map(f => (
              <button
                key={f.key}
                type="button"
                className={`btn btn-sm ${huEstadoFilter === f.key ? 'btn-primary' : 'btn-ghost'}`}
                style={{ borderRadius: 16, fontSize: 11.5, padding: '4px 12px' }}
                onClick={() => setHuEstadoFilter(f.key as any)}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table className="data-table" style={{ width: '100%', fontSize: 12.5 }}>
              <thead>
                <tr>
                  <th style={{ position: 'sticky', left: 0, background: '#FFFFFF', zIndex: 2, boxShadow: '1px 0 0 var(--border)' }}>Código HU</th>
                  <th>Tipo</th>
                  <th>SKU / Producto</th>
                  <th>Lote y Caducidad</th>
                  <th>Ubicación (Actual / Histórica)</th>
                  <th>Depositante</th>
                  <th style={{ textAlign: 'right' }}>Saldo en Almacén</th>
                  <th>Estado Operativo</th>
                  <th>Condición / Empaque</th>
                  <th style={{ textAlign: 'center' }}>Etiqueta</th>
                  <th>Fecha</th>
                  <th style={{ textAlign: 'center' }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filteredHus.map((h, i) => {
                  const isDespachado = isHuDispatched(h);
                  const isInactive = isHuInactive(h);
                  const pzas = Number(h.cantidad) || Number(h.cantidadActual) || 0;
                  const skuFactor = h.lote?.sku?.capacidadEmpaque || (h.skuCodigo?.includes('ARR') ? 20 : 12);
                  const standardCapacity = (h.reacondicionada || h.cajaOrigenId) ? (h.lote?.sku?.capacidadEmpaque || skuFactor) : (h.piezasPorCaja || h.lote?.sku?.capacidadEmpaque || skuFactor);
                  const isPartial = !isInactive && !isDespachado && (h.reacondicionada || Boolean(h.cajaOrigenId) || pzas < standardCapacity);
                  
                  const parentBox = h.cajaOrigenId ? hus.find(x => x.id === h.cajaOrigenId) : null;
                  const rescuedBoxes = hus.filter(x => x.cajaOrigenId === h.id || (h.reacondicionada && x.cajaOrigenId === h.id));

                  const rackLoc = isDespachado
                    ? (h.ubicacionActual && h.ubicacionActual !== 'DESPACHADO' ? h.ubicacionActual : 'B01/B02 (Salida)')
                    : isInactive
                    ? 'RAMPA_RECEPCION'
                    : (h.ubicacionActual || h.lote?.ubicacion?.codigo || 'En Rack');

                  const lotText = h.loteTexto || h.lote?.lote || '—';
                  const expDate = h.fechaVencimiento || h.lote?.fechaVencimiento;
                  const hasLabel = Boolean(h.etiquetaImpresa || h.estadoEtiqueta === 'COLOCADA' || h.estadoEtiqueta === 'IMPRESA') && !isInactive;

                  return (
                    <tr key={h.id || i} className="animate-fade-in" style={{ animationDelay: `${i * 0.02}s`, background: isInactive ? '#FFF5F5' : isPartial ? '#FFFDF5' : 'transparent' }}>
                      {/* CÓDIGO HU STICKY COLUMNA */}
                      <td style={{ position: 'sticky', left: 0, background: isInactive ? '#FFF5F5' : isPartial ? '#FFFDF5' : '#FFFFFF', zIndex: 1, boxShadow: '1px 0 0 var(--border)' }}>
                        <code style={{ fontSize: 12, background: 'var(--bg-secondary)', padding: '2px 6px', borderRadius: 4, fontWeight: 700, color: isDespachado ? 'var(--purple)' : isInactive ? 'var(--danger)' : isPartial ? '#D97706' : 'var(--primary)' }}>
                          {h.codigo}
                        </code>
                        {isPartial && (
                          <div style={{ fontSize: 10, color: '#D97706', fontWeight: 700 }}>
                            Rescate de {parentBox?.codigo || 'caja dañada'}
                          </div>
                        )}
                        {isInactive && rescuedBoxes.length > 0 && (
                          <div style={{ fontSize: 10, color: 'var(--danger)' }}>
                            Rescate en {rescuedBoxes.map(r => r.codigo).join(', ')}
                          </div>
                        )}
                      </td>

                      {/* TIPO */}
                      <td><span className={`badge badge-${h.tipoHu === 'PALLET' ? 'warning' : 'info'}`}>{h.tipoHu}</span></td>

                      {/* SKU / PRODUCTO */}
                      <td style={{ fontWeight: 500, whiteSpace: 'normal', minWidth: 160 }}>
                        <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{h.lote?.sku?.codigo || h.skuCodigo || '—'}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{h.lote?.sku?.descripcion || h.skuDescripcion || '—'}</div>
                      </td>

                      {/* LOTE Y CADUCIDAD */}
                      <td>
                        <span className="badge badge-default" style={{ fontSize: 11 }}>{lotText}</span>
                        {expDate && (
                          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>
                            Cad: {formatCalendarDate(expDate)}
                          </div>
                        )}
                      </td>

                      {/* UBICACIÓN RACK */}
                      <td>
                        {isDespachado ? (
                          <span style={{ fontSize: 11, color: 'var(--purple)', fontWeight: 600 }}>
                            <MapPin size={11} style={{ display: 'inline', marginRight: 3 }} />
                            Salida de almacén (Último: {rackLoc})
                          </span>
                        ) : isInactive ? (
                          <span style={{ fontSize: 11, color: 'var(--danger)', fontWeight: 600 }}>
                            <MapPin size={11} style={{ display: 'inline', marginRight: 3 }} />
                            {rackLoc} (Histórico andén)
                          </span>
                        ) : (
                          <span style={{ fontSize: 11.5, fontFamily: 'monospace', color: 'var(--teal)', fontWeight: 700 }}>
                            <MapPin size={11} style={{ display: 'inline', marginRight: 3 }} />
                            {rackLoc}
                          </span>
                        )}
                      </td>

                      {/* CLIENTE */}
                      <td>{h.cliente?.nombreComercial || '—'}</td>

                      {/* SALDO ACTUAL EN ALMACÉN VS HISTÓRICO (Point 2) */}
                      <td style={{ textAlign: 'right' }}>
                        {isInactive ? (
                          <>
                            <span style={{ fontWeight: 800, color: 'var(--danger)' }}>0 pzas</span>
                            <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
                              {(() => {
                                const totalResc = rescuedBoxes.reduce((s: number, r: any) => s + (Number(r.cantidad) || 0), 0);
                                const mermaPzas = Math.max(0, pzas - totalResc);
                                return `Orig: ${pzas} pz · ${totalResc} rescatadas${mermaPzas > 0 ? `, ${mermaPzas} merma` : ''}`;
                              })()}
                            </div>
                          </>
                        ) : isDespachado ? (
                          <>
                            <span style={{ fontWeight: 800, color: 'var(--text-secondary)' }}>0 en rack</span>
                            <div style={{ fontSize: 10, color: 'var(--purple)' }}>Salida: {pzas} pz (Despachado)</div>
                          </>
                        ) : isPartial ? (
                          <>
                            <span style={{ fontWeight: 800, color: '#D97706' }}>{pzas} pzas</span>
                            <div style={{ fontSize: 10, color: '#D97706', fontWeight: 600 }}>Parcial: {pzas} de {standardCapacity} piezas · Reacondicionada</div>
                          </>
                        ) : (
                          <>
                            <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{pzas} pzas</span>
                            <div style={{ fontSize: 10, color: 'var(--teal)' }}>Caja estándar ({standardCapacity} pz)</div>
                          </>
                        )}
                      </td>

                      {/* ESTADO OPERATIVO */}
                      <td>
                        <span className={`badge badge-${isInactive ? 'danger' : isDespachado ? 'info' : 'success'}`}>
                          {isInactive ? 'Inactiva' : isDespachado ? 'Despachada' : 'Activa en Rack'}
                        </span>
                      </td>

                      {/* CONDICIÓN / EMPAQUE */}
                      <td>
                        <span className={`badge badge-${isInactive ? 'danger' : isPartial ? 'warning' : 'success'}`}>
                          {isInactive ? 'Dañado / Retenido Andén (Histórico)' : isPartial ? 'Parcial / Reacondicionada' : 'Conforme'}
                        </span>
                      </td>

                      {/* ETIQUETA (Leída estrictamente por HU, Point 3) */}
                      <td style={{ textAlign: 'center' }}>
                        {isInactive ? (
                          <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: 'var(--bg-secondary)', color: 'var(--text-tertiary)', fontWeight: 700, border: '1px solid var(--border)' }}>
                            NO OPERATIVA / HISTÓRICA
                          </span>
                        ) : hasLabel ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#10B981', fontSize: 11, fontWeight: 700 }}>
                            <CheckCircle2 size={15} /> Colocada
                          </span>
                        ) : (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#94A3B8', fontSize: 11 }}>
                            <XCircle size={15} /> Pendiente
                          </span>
                        )}
                      </td>

                      {/* FECHA */}
                      <td style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>{formatCalendarDate(h.createdAt)}</td>

                      {/* ACCIONES */}
                      <td style={{ textAlign: 'center' }}>
                        {!isInactive && !isDespachado && (
                          <button
                            type="button"
                            className="btn btn-sm btn-ghost"
                            onClick={() => {
                              const lotObj = lots.find(x => x.id === h.lotId) || {
                                id: h.lotId || h.id,
                                sku: h.lote?.sku || { codigo: h.skuCodigo, descripcion: h.skuDescripcion },
                                cliente: h.cliente,
                                lote: h.loteTexto || h.lote?.lote,
                                fechaVencimiento: h.fechaVencimiento || h.lote?.fechaVencimiento,
                                ubicacion: { codigo: rackLoc },
                                cantidadDisponible: pzas,
                                cantidadFisica: pzas,
                                cantidadReservada: 0,
                              };
                              setItemsToTransfer([lotObj]);
                              setPreselectedMotivo('No conforme');
                              setTransferModalOpen(true);
                            }}
                            title="Transferir esta caja a Almacén Virtual"
                            style={{
                              padding: '3px 8px',
                              fontSize: 11,
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 3,
                              color: '#38BDF8',
                              border: '1px solid rgba(56, 189, 248, 0.3)',
                              borderRadius: 4,
                              cursor: 'pointer',
                            }}
                          >
                            <ArrowRightLeft size={11} /> Mover
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {filteredHus.length === 0 && (
                  <tr>
                    <td colSpan={12} style={{ textAlign: 'center', padding: 40, color: 'var(--text-tertiary)' }}>
                      Sin cajas / handling units con los filtros aplicados
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* PIE DE TABLA DE HUS (Point 1, 4, 8) */}
          <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', fontSize: 13, color: 'var(--text-tertiary)', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
            <span><strong>{filteredHus.length}</strong> cajas / unidades de manejo {huEstadoFilter === 'ALL' ? '(todas)' : `(filtro: ${huEstadoFilter.toLowerCase()})`}</span>
            <span>
              Stock físico actual en almacén: <strong style={{ color: 'var(--primary)' }}>{huEstadoFilter === 'DESPACHADO' || huEstadoFilter === 'DAÑADO' ? 0 : activeHuUnits.toLocaleString()}</strong> pzas
              {huEstadoFilter === 'ALL' && dispatchedHus.length > 0 && (
                <span style={{ color: '#64748B' }}> · {dispatchedHuUnits.toLocaleString()} pzas despachadas históricas</span>
              )}
            </span>
          </div>
        </div>
      )}

      {/* Modal de Desvío Manual a Cuarentena */}
      {divertModalOpen && (
        <DivertToVirtualModal
          token={token || undefined}
          onClose={() => setDivertModalOpen(false)}
          onSuccess={() => {
            setDivertModalOpen(false);
            loadData();
          }}
        />
      )}

      {/* Modal de Impresión de Papeleta para Item de Cuarentena seleccionado */}
      {selectedPrintItem && (
        <DivertToVirtualModal
          receipt={{
            cliente: selectedPrintItem.cliente,
            clienteId: selectedPrintItem.clienteId,
            codigo: selectedPrintItem.folioActa,
            folioActa: selectedPrintItem.folioActa,
            ubicacion: selectedPrintItem.ubicacion,
            huCodigo: selectedPrintItem.handlingUnits?.[0]?.codigo
          }}
          initialItems={[{
            skuId: selectedPrintItem.sku?.id,
            skuCodigo: selectedPrintItem.sku?.codigo,
            skuDescripcion: selectedPrintItem.sku?.descripcion || selectedPrintItem.sku?.nombre,
            cantidad: selectedPrintItem.cantidadBloqueada,
            lote: selectedPrintItem.lote,
            fechaVencimiento: selectedPrintItem.fechaCaducidad ? selectedPrintItem.fechaCaducidad.split('T')[0] : (selectedPrintItem.fechaVencimiento ? selectedPrintItem.fechaVencimiento.split('T')[0] : ''),
            motivoEspecifico: selectedPrintItem.notas || 'Retención preventiva por control de calidad / merma',
          }]}
          initialTipoDesvio={selectedPrintItem.tipoDesvio || 'MERMA'}
          directPrintMode={true}
          token={token || undefined}
          onClose={() => setSelectedPrintItem(null)}
          onSuccess={() => {
            setSelectedPrintItem(null);
            loadData();
          }}
        />
      )}
      {/* Modal de Transferencia a Almacén Virtual (Requerimiento 3) */}
      {transferModalOpen && (
        <TransferToVirtualModal
          isOpen={transferModalOpen}
          onClose={() => {
            setTransferModalOpen(false);
            setItemsToTransfer([]);
          }}
          onSuccess={() => {
            setTransferModalOpen(false);
            setItemsToTransfer([]);
            setSelectedLotIds([]);
            loadData();
          }}
          items={itemsToTransfer}
          preselectedMotivo={preselectedMotivo}
        />
      )}

      {/* Modal de Liberación desde Almacén Virtual (Requerimiento 3) */}
      {releaseModalOpen && (
        <ReleaseFromVirtualModal
          isOpen={releaseModalOpen}
          onClose={() => {
            setReleaseModalOpen(false);
            setItemToRelease(null);
          }}
          onSuccess={() => {
            setReleaseModalOpen(false);
            setItemToRelease(null);
            loadData();
          }}
          item={itemToRelease}
        />
      )}
    </div>
  );
}
