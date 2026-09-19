import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { API } from '../config/api';
import {
  Download, RefreshCw, Tag, Box, Search, MapPin, Calendar,
  ShieldAlert, AlertTriangle, CheckCircle2, XCircle, Lock,
  Printer, Boxes, PlusCircle
} from 'lucide-react';
import { DivertToVirtualModal } from '../components/DivertToVirtualModal';

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
          fetch(`${API}/inventory/handling-units`, { headers }),
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
    const matchSearch = !search ||
      l.sku?.descripcion?.toLowerCase().includes(search.toLowerCase()) ||
      l.sku?.codigo?.toLowerCase().includes(search.toLowerCase()) ||
      l.lote?.toLowerCase().includes(search.toLowerCase());
    const matchClient = !filterClient || l.clienteId === filterClient;
    return matchSearch && matchClient;
  });

  const filteredHus = hus.filter(h => {
    const matchSearch = !search ||
      h.codigo?.toLowerCase().includes(search.toLowerCase()) ||
      h.lote?.sku?.descripcion?.toLowerCase().includes(search.toLowerCase());
    const matchClient = !filterClient || h.clienteId === filterClient;
    return matchSearch && matchClient;
  });

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

  const totalUnidades = filteredLots.reduce((s, l) => s + (l.cantidadDisponible || 0), 0);
  const totalReservado = filteredLots.reduce((s, l) => s + (l.cantidadReservada || 0), 0);

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
      csv = 'SKU,Descripción,Cliente,Lote,Disponible,Reservado,Ubicación,Calidad,Vencimiento\n';
      filteredLots.forEach(l => {
        csv += `"${l.sku?.codigo || ''}","${l.sku?.descripcion || ''}${l.sku?.talla ? ` (${l.sku.talla})` : ''}","${l.cliente?.nombreComercial || ''}","${l.lote || ''}",${l.cantidadDisponible},${l.cantidadReservada},"${l.ubicacion?.codigo || ''}","${l.estadoCalidad}","${l.fechaVencimiento ? new Date(l.fechaVencimiento).toLocaleDateString('es-MX') : ''}"\n`;
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
              <>{totalUnidades.toLocaleString()} unidades disponibles para picking · {totalReservado.toLocaleString()} reservadas</>
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
                <Tag size={14} /> Lotes ({lots.length})
              </button>
              <button
                className={`btn btn-sm ${commercialView === 'hus' ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setCommercialView('hus')}
              >
                <Box size={14} /> HUs ({hus.length})
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
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => setSelectedPrintItem(v)}
                        title="Imprimir papeleta oficial de pallet retenido en cuarentena"
                        style={{
                          padding: '6px 12px',
                          backgroundColor: '#DC2626',
                          borderColor: '#DC2626',
                          color: '#FFFFFF',
                          fontWeight: 700,
                          fontSize: 12,
                          borderRadius: 6,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          cursor: 'pointer',
                          boxShadow: '0 2px 4px rgba(220, 38, 38, 0.35)'
                        }}
                      >
                        <Printer size={14} style={{ color: '#FFFFFF' }} />
                        <span>Imprimir Ficha</span>
                      </button>
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
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Descripción</th>
                  <th>Cliente</th>
                  <th>Lote</th>
                  <th style={{ textAlign: 'right' }}>Disponible</th>
                  <th style={{ textAlign: 'right' }}>Reservado</th>
                  <th>Ubicación</th>
                  <th>Calidad</th>
                  <th>Vencimiento</th>
                </tr>
              </thead>
              <tbody>
                {filteredLots.map((l, i) => (
                  <tr key={i} className="animate-fade-in" style={{ animationDelay: `${i * 0.02}s` }}>
                    <td><code style={{ fontSize: 12, background: 'var(--bg-secondary)', padding: '2px 6px', borderRadius: 4 }}>{l.sku?.codigo}</code></td>
                    <td style={{ fontWeight: 500, whiteSpace: 'normal', minWidth: 180 }}>{l.sku?.descripcion}{l.sku?.talla ? ` (${l.sku.talla})` : ''}{l.sku?.color ? ` — ${l.sku.color}` : ''}</td>
                    <td><span className="badge badge-info">{l.cliente?.nombreComercial}</span></td>
                    <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{l.lote || '—'}</td>
                    <td style={{ fontWeight: 700, color: 'var(--teal)', textAlign: 'right' }}>{l.cantidadDisponible}</td>
                    <td style={{ color: l.cantidadReservada > 0 ? 'var(--orange)' : 'var(--text-tertiary)', textAlign: 'right' }}>{l.cantidadReservada || '—'}</td>
                    <td><span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-secondary)' }}><MapPin size={12} />{l.ubicacion?.codigo || '—'}</span></td>
                    <td><span className={`badge badge-${l.estadoCalidad === 'LIBERADO' ? 'success' : l.estadoCalidad === 'CUARENTENA' ? 'warning' : 'danger'}`}>{l.estadoCalidad}</span></td>
                    <td>{l.fechaVencimiento ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12 }}><Calendar size={12} />{new Date(l.fechaVencimiento).toLocaleDateString('es-MX')}</span> : '—'}</td>
                  </tr>
                ))}
                {filteredLots.length === 0 && <tr><td colSpan={9} style={{ textAlign: 'center', padding: 40, color: 'var(--text-tertiary)' }}>Sin lotes en inventario</td></tr>}
              </tbody>
            </table>
          </div>
          <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', fontSize: 13, color: 'var(--text-tertiary)', display: 'flex', justifyContent: 'space-between' }}>
            <span>{filteredLots.length} lotes</span>
            <span>Total: {totalUnidades.toLocaleString()} uds · Reservado: {totalReservado.toLocaleString()} uds</span>
          </div>
        </div>
      ) : (
        /* VISTA TABLA: HUs COMERCIALES (SIN EMOJIS GENÉRICOS) */
        <div className="card">
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Código HU</th>
                  <th>Tipo</th>
                  <th>SKU</th>
                  <th>Cliente</th>
                  <th style={{ textAlign: 'right' }}>Cantidad</th>
                  <th>Estado</th>
                  <th style={{ textAlign: 'center' }}>Etiqueta</th>
                  <th>Creado</th>
                </tr>
              </thead>
              <tbody>
                {filteredHus.map((h, i) => (
                  <tr key={i} className="animate-fade-in" style={{ animationDelay: `${i * 0.02}s` }}>
                    <td><code style={{ fontSize: 12, background: 'var(--bg-secondary)', padding: '2px 6px', borderRadius: 4 }}>{h.codigo}</code></td>
                    <td><span className={`badge badge-${h.tipoHu === 'PALLET' ? 'warning' : 'info'}`}>{h.tipoHu}</span></td>
                    <td style={{ fontWeight: 500, whiteSpace: 'normal', minWidth: 160 }}>{h.lote?.sku?.descripcion || '—'}</td>
                    <td>{h.cliente?.nombreComercial}</td>
                    <td style={{ fontWeight: 700, textAlign: 'right' }}>{h.cantidad}</td>
                    <td><span className={`badge badge-${h.estadoHu === 'ACTIVO' ? 'success' : h.estadoHu === 'DAÑADO' ? 'danger' : 'info'}`}>{h.estadoHu}</span></td>
                    <td style={{ textAlign: 'center' }}>
                      {h.etiquetaImpresa ? (
                        <CheckCircle2 size={16} color="#10B981" style={{ display: 'inline-block' }} />
                      ) : (
                        <XCircle size={16} color="#64748B" style={{ display: 'inline-block' }} />
                      )}
                    </td>
                    <td style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>{new Date(h.createdAt).toLocaleDateString('es-MX')}</td>
                  </tr>
                ))}
                {filteredHus.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', padding: 40, color: 'var(--text-tertiary)' }}>Sin handling units</td></tr>}
              </tbody>
            </table>
          </div>
          <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', fontSize: 13, color: 'var(--text-tertiary)' }}>
            {filteredHus.length} handling units
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
    </div>
  );
}
