import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { API } from '../config/api';
import {
  MapPin, Search, RefreshCw, Grid3X3, Layers, X,
  Package, Calendar, CheckCircle2, AlertTriangle, ShieldCheck, Box,
  Warehouse, Lock, Eye, Info, Users, UserCheck, ChevronDown, ChevronRight
} from 'lucide-react';
import { formatCalendarDate } from '../utils/dateUtils';

const CALIDAD_TOOLTIP = 'Resultado de inspección de calidad. No determina por sí solo la disponibilidad comercial; también aplican caducidad, ubicación y restricciones operativas.';

// Mapeo semántico de categorías internas a nombres amigables (Requisito 6)
function getFriendlyCategory(categoria?: string): string {
  switch (categoria) {
    case 'RECIBO_TRANSITO':
      return 'Recepción / Tránsito';
    case 'VIRTUAL_NO_CONFORME':
      return 'Merma / No conforme';
    case 'STAGING':
      return 'Preparación / Consolidación';
    case 'ESPECIAL_OTRAS':
      return 'Área especial';
    case 'FISICA_ALMACENABLE':
      return 'Celda de Rack';
    default:
      return 'Área especial';
  }
}

// Mapeo de niveles físicos de rack a etiquetas operativas claras (Requisito 3)
function getNivelInfo(nivelKey: string): { code: string; role: string; description: string } {
  const upper = (nivelKey || '').toUpperCase();
  if (upper === 'N1') {
    return { code: 'N1', role: 'Picking', description: 'Nivel 1 · Picking de piso / suelto' };
  }
  if (upper === 'N2') {
    return { code: 'N2', role: 'Reserva', description: 'Nivel 2 · Reserva media' };
  }
  if (upper === 'N3') {
    return { code: 'N3', role: 'Reserva', description: 'Nivel 3 · Reserva superior' };
  }
  return { code: nivelKey, role: 'Almacén', description: `Nivel ${nivelKey}` };
}

// Helper para calcular métricas por depositante en una ubicación (Modelo 3PL)
function getLocationClientStats(loc: any, clientTargetId: string) {
  if (!clientTargetId) {
    return { hasStock: false, pieces: 0, bultos: 0, isExclusive: false, isShared: false, otherPieces: 0 };
  }
  const clientLots = (loc.lotes || []).filter((l: any) => l.clienteId === clientTargetId || l.cliente?.id === clientTargetId);
  const otherLots = (loc.lotes || []).filter((l: any) => l.clienteId !== clientTargetId && l.cliente?.id !== clientTargetId);
  
  const clientPieces = clientLots.reduce((s: number, l: any) => s + ((l.cantidadDisponible || 0) + (l.cantidadBloqueada || 0)), 0);
  const otherPieces = otherLots.reduce((s: number, l: any) => s + ((l.cantidadDisponible || 0) + (l.cantidadBloqueada || 0)), 0);

  const clientBultos = (loc.bultosPorCliente && loc.bultosPorCliente[clientTargetId]) || 0;
  
  // Una posición SOLO tiene existencia del depositante cuando exista inventario físico actual atribuible
  const hasStock = clientPieces > 0;
  // Compartida SOLO si el depositante tiene existencia física actual Y otro depositante también tiene existencia física actual
  const isShared = hasStock && otherPieces > 0;
  const isExclusive = hasStock && !isShared;

  return {
    hasStock,
    pieces: clientPieces,
    bultos: clientBultos,
    isExclusive,
    isShared,
    otherPieces
  };
}

// Helper para evaluar disponibilidad compatible para un depositante (3PL)
function isLocationCompatibleWithClient(loc: any, clientObj: any, hasStock: boolean): boolean {
  if (!clientObj) return false;
  
  // Debe ser física almacenable
  if (loc.esAlmacenable === false || loc.categoriaUbicacion !== 'FISICA_ALMACENABLE') {
    return false;
  }
  // No debe estar bloqueada
  if (loc.estado === 'BLOQUEADO' || loc.estadoCapacidad === 'BLOQUEADO') {
    return false;
  }
  // No debe estar en sobrecapacidad ni llena
  if (loc.estadoCapacidad === 'SOBRECAPACIDAD' || loc.estadoCapacidad === 'LLENO') {
    return false;
  }
  // Debe tener espacio libre disponible (LIBRE o PARCIAL)
  if (loc.estadoCapacidad !== 'LIBRE' && loc.estadoCapacidad !== 'PARCIAL') {
    return false;
  }
  // Criterios de compatibilidad configurados (3PL):
  if (clientObj.zonaAsignadaId) {
    const matchesZone = loc.zonaId === clientObj.zonaAsignadaId || loc.zona?.id === clientObj.zonaAsignadaId;
    return matchesZone || hasStock;
  }
  return true;
}

export function Locations() {
  const { token } = useAuth();
  const [locations, setLocations] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  
  // Filtros principales
  const [filterCliente, setFilterCliente] = useState<string>('');
  const [clientViewMode, setClientViewMode] = useState<'existencia' | 'compatibles' | 'todas'>('existencia');
  const [filterZona, setFilterZona] = useState('');
  const [filterPasillo, setFilterPasillo] = useState('');
  const [filterEstado, setFilterEstado] = useState('');
  const [viewMode, setViewMode] = useState<'layout' | 'operational'>('layout');

  // Pasillos colapsables / expandibles (Punto 1)
  const [collapsedAisles, setCollapsedAisles] = useState<Record<string, boolean>>({});

  // Detalle de ubicación modal
  const [selectedLoc, setSelectedLoc] = useState<any | null>(null);
  const [locDetailLoading, setLocDetailLoading] = useState(false);
  const [locDetailData, setLocDetailData] = useState<any | null>(null);
  const [showOnlyFilterClientInModal, setShowOnlyFilterClientInModal] = useState<boolean>(true);

  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => { loadData(); }, []);

  // Cierre intuitivo del modal mediante tecla Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedLoc) {
        setSelectedLoc(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedLoc]);

  async function loadData() {
    setLoading(true);
    try {
      const [locRes, clientRes] = await Promise.all([
        fetch(`${API}/locations`, { headers }),
        fetch(`${API}/clients`, { headers })
      ]);
      
      if (locRes.ok) {
        const data = await locRes.json();
        setLocations(data.length > 0 ? data : demoLocations);
      } else {
        setLocations(demoLocations);
      }

      if (clientRes.ok) {
        const clientData = await clientRes.json();
        setClients(clientData);
      }
    } catch (err) {
      console.error(err);
      setLocations(demoLocations);
    }
    setLoading(false);
  }

  async function handleOpenLocationDetail(loc: any) {
    setSelectedLoc(loc);
    setLocDetailLoading(true);
    setLocDetailData(null);
    setShowOnlyFilterClientInModal(Boolean(filterCliente));
    try {
      const res = await fetch(`${API}/locations/${loc.id || loc.codigo}`, { headers });
      if (res.ok) {
        const data = await res.json();
        setLocDetailData(data);
      } else {
        setLocDetailData(loc);
      }
    } catch (err) {
      console.error('Error al cargar detalle de ubicación:', err);
      setLocDetailData(loc);
    } finally {
      setLocDetailLoading(false);
    }
  }

  const selectedClient = clients.find(c => c.id === filterCliente);
  const selectedClientName = selectedClient?.nombreComercial || selectedClient?.razonSocial || 'Depositante';

  const zonas = [...new Set(locations.map(l => l.zona?.codigo).filter(Boolean))];
  const pasillosDisponibles = [...new Set(locations.filter(l => l.esAlmacenable).map(l => l.pasillo).filter(Boolean))].sort();

  const filtered = locations.filter(l => {
    const q = search.toLowerCase().trim();
    const matchSearch = !q ||
      l.codigo?.toLowerCase().includes(q) ||
      l.zona?.nombre?.toLowerCase().includes(q) ||
      l.pasillo?.toLowerCase().includes(q) ||
      l.rack?.toLowerCase().includes(q) ||
      getFriendlyCategory(l.categoriaUbicacion).toLowerCase().includes(q) ||
      l.categoriaDescripcion?.toLowerCase().includes(q);
      
    const matchZona = !filterZona || l.zona?.codigo === filterZona;
    const matchPasillo = !filterPasillo || l.pasillo === filterPasillo;
    const matchEstado = !filterEstado ||
      (filterEstado === 'SOBRECAPACIDAD' && l.estadoCapacidad === 'SOBRECAPACIDAD') ||
      (filterEstado === 'LLENO' && l.estadoCapacidad === 'LLENO') ||
      (filterEstado === 'PARCIAL' && l.estadoCapacidad === 'PARCIAL') ||
      (filterEstado === 'LIBRE' && (l.estadoCapacidad === 'LIBRE' || l.estado === 'LIBRE')) ||
      (filterEstado === 'BLOQUEADO' && (l.estado === 'BLOQUEADO' || l.estadoCapacidad === 'BLOQUEADO')) ||
      (filterEstado === 'NO_APLICA' && l.estadoCapacidad === 'NO_APLICA');

    // Filtro por Depositante 3PL
    let matchCliente = true;
    if (filterCliente) {
      const stats = getLocationClientStats(l, filterCliente);
      const isComp = isLocationCompatibleWithClient(l, selectedClient, stats.hasStock);

      if (clientViewMode === 'existencia') {
        matchCliente = stats.hasStock;
      } else if (clientViewMode === 'compatibles') {
        matchCliente = isComp && !stats.hasStock;
      } else if (clientViewMode === 'todas') {
        matchCliente = stats.hasStock || isComp;
      }
    }

    return matchSearch && matchZona && matchPasillo && matchEstado && matchCliente;
  });

  // Auto-apertura inteligente de pasillos si hay búsqueda o filtro por cliente (Punto 1)
  useEffect(() => {
    if (search || filterCliente || filterEstado) {
      setCollapsedAisles(prev => {
        const next = { ...prev };
        // Asegurar abiertos los pasillos que contienen celdas encontradas
        filtered.forEach(l => {
          if (l.pasillo) {
            delete next[l.pasillo];
          }
        });
        return next;
      });
    }
  }, [search, filterCliente, filterEstado]);

  const toggleAisle = (aisleKey: string) => {
    setCollapsedAisles(prev => ({
      ...prev,
      [aisleKey]: !prev[aisleKey]
    }));
  };

  const expandAllAisles = () => setCollapsedAisles({});
  const collapseAllAisles = () => {
    const allAisles: Record<string, boolean> = {};
    pasillosDisponibles.forEach(p => { allAisles[p] = true; });
    setCollapsedAisles(allAisles);
  };

  // Separación nítida de ubicaciones físicas de almacenamiento vs. ubicaciones especiales
  const almacenableLocs = filtered.filter(l => l.esAlmacenable !== false && l.categoriaUbicacion === 'FISICA_ALMACENABLE');
  const specialLocs = filtered.filter(l => l.esAlmacenable === false || l.categoriaUbicacion !== 'FISICA_ALMACENABLE');

  // Indicadores de capacidad sobre celdas almacenables
  const totalLibres = almacenableLocs.filter(l => l.estadoCapacidad === 'LIBRE').length;
  const totalParciales = almacenableLocs.filter(l => l.estadoCapacidad === 'PARCIAL').length;
  const totalLlenas = almacenableLocs.filter(l => l.estadoCapacidad === 'LLENO').length;
  const totalSobrecapacidad = almacenableLocs.filter(l => l.estadoCapacidad === 'SOBRECAPACIDAD').length;

  // Totales de volumen físico en celdas de almacenamiento
  const totalPiezasAlojadas = almacenableLocs.reduce((s, l) => s + (l.ocupacionUnidades || 0), 0);
  const totalCapacidadPiezas = almacenableLocs.reduce((s, l) => s + (l.capacidadUnits || 100), 0);
  const totalBultosAlojados = almacenableLocs.reduce((s, l) => s + (l.ocupacionBultos || 0), 0);
  const locsConBultosConfigurados = almacenableLocs.filter(l => typeof l.capacidadBultos === 'number' && l.capacidadBultos > 0);
  const hayCapacidadBultosGlobal = locsConBultosConfigurados.length > 0;
  const totalCapacidadBultos = locsConBultosConfigurados.reduce((s, l) => s + l.capacidadBultos, 0);
  const pctPiezas = totalCapacidadPiezas > 0 ? Math.round((totalPiezasAlojadas / totalCapacidadPiezas) * 100) : 0;
  const pctBultos = hayCapacidadBultosGlobal && totalCapacidadBultos > 0 ? Math.round((totalBultosAlojados / totalCapacidadBultos) * 100) : null;

  // Totales contextuales para el Depositante seleccionado (3PL)
  const clientPositionsCount = locations.filter(l => getLocationClientStats(l, filterCliente).hasStock).length;
  const clientTotalPieces = locations.reduce((sum, l) => sum + getLocationClientStats(l, filterCliente).pieces, 0);
  const clientTotalBultos = locations.reduce((sum, l) => sum + getLocationClientStats(l, filterCliente).bultos, 0);
  const compatiblePositionsCount = locations.filter(l => {
    const stats = getLocationClientStats(l, filterCliente);
    return isLocationCompatibleWithClient(l, selectedClient, stats.hasStock) && !stats.hasStock;
  }).length;
  // Unión sin duplicados de posiciones con existencia física + posiciones disponibles para el depositante
  const relatedPositionsCount = locations.filter(l => {
    const stats = getLocationClientStats(l, filterCliente);
    const isComp = isLocationCompatibleWithClient(l, selectedClient, stats.hasStock);
    return stats.hasStock || isComp;
  }).length;

  // Agrupación jerárquica para Mapa del Almacén: Zona -> Pasillo -> Rack -> Niveles (N3, N2, N1)
  interface HierarchyZona {
    zonaNombre: string;
    zonaCodigo: string;
    pasillos: {
      [pasilloCode: string]: {
        pasilloCodigo: string;
        racks: {
          [rackCode: string]: {
            rackCodigo: string;
            totalPiezas: number;
            capacidadPiezas: number;
            totalBultos: number;
            capacidadBultos: number;
            niveles: {
              [nivelCode: string]: any[];
            };
          };
        };
      };
    };
  }

  const hierarchy: Record<string, HierarchyZona> = {};
  for (const loc of almacenableLocs) {
    const zKey = loc.zona?.codigo || loc.zonaId || 'ZONA_GENERAL';
    const zNombre = loc.zona?.nombre || 'Zona de Almacén General';
    const pKey = loc.pasillo || 'P01';
    const rKey = loc.rack || 'R01';
    const nKey = loc.nivel || 'N1';

    if (!hierarchy[zKey]) {
      hierarchy[zKey] = {
        zonaNombre: zNombre,
        zonaCodigo: zKey,
        pasillos: {}
      };
    }
    if (!hierarchy[zKey].pasillos[pKey]) {
      hierarchy[zKey].pasillos[pKey] = {
        pasilloCodigo: pKey,
        racks: {}
      };
    }
    if (!hierarchy[zKey].pasillos[pKey].racks[rKey]) {
      hierarchy[zKey].pasillos[pKey].racks[rKey] = {
        rackCodigo: rKey,
        totalPiezas: 0,
        capacidadPiezas: 0,
        totalBultos: 0,
        capacidadBultos: 0,
        niveles: {}
      };
    }
    const rackObj = hierarchy[zKey].pasillos[pKey].racks[rKey];
    rackObj.totalPiezas += (loc.ocupacionUnidades || 0);
    rackObj.capacidadPiezas += (loc.capacidadUnits || 100);
    rackObj.totalBultos += (loc.ocupacionBultos || 0);
    rackObj.capacidadBultos += (loc.capacidadBultos || 1);

    if (!rackObj.niveles[nKey]) {
      rackObj.niveles[nKey] = [];
    }
    rackObj.niveles[nKey].push(loc);
  }

  // Agrupación de Vista por Zonas (plana)
  const byZone: Record<string, any[]> = {};
  for (const loc of filtered) {
    const zn = loc.zona?.nombre || 'Sin Zona';
    if (!byZone[zn]) byZone[zn] = [];
    byZone[zn].push(loc);
  }

  // Conjunto de IDs de ubicaciones agrupadas en zonas para evitar duplicados en Vista por Zonas (Punto 1)
  const renderedZoneLocIds = new Set<string>();
  Object.values(byZone).forEach(locList => {
    locList.forEach((l: any) => {
      if (l.id) renderedZoneLocIds.add(String(l.id));
      if (l.codigo) renderedZoneLocIds.add(String(l.codigo));
    });
  });

  // Áreas especiales que no estén ya integradas en una agrupación de zona mostrada
  const unassignedSpecialLocs = specialLocs.filter((l: any) =>
    !renderedZoneLocIds.has(String(l.id)) && !renderedZoneLocIds.has(String(l.codigo))
  );

  return (
    <div className="page-container">
      {/* Cabecera Principal */}
      <div className="page-header" style={{ alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h1 className="page-title" style={{ margin: 0 }}>Ubicaciones del Almacén</h1>
            <span style={{
              fontSize: 11,
              fontWeight: 800,
              padding: '3px 8px',
              borderRadius: 6,
              background: 'rgba(37,99,235,0.12)',
              color: '#2563EB',
              border: '1px solid rgba(37,99,235,0.25)'
            }}>
              Nave Tepotzotlán · Giving Out WMS
            </span>
            {filterCliente && (
              <span style={{
                fontSize: 11,
                fontWeight: 800,
                padding: '3px 8px',
                borderRadius: 6,
                background: 'rgba(16, 185, 129, 0.12)',
                color: '#059669',
                border: '1px solid rgba(16, 185, 129, 0.25)'
              }}>
                Depositante: {selectedClientName}
              </span>
            )}
          </div>
          <p className="page-subtitle" style={{ marginTop: 4 }}>
            {filterCliente
              ? `${relatedPositionsCount} ubicaciones relacionadas con ${selectedClientName} · ${clientPositionsCount} con existencia física · ${compatiblePositionsCount} disponibles para depositante`
              : `${almacenableLocs.length} celdas en racks · ${totalLibres} libres · ${totalParciales} parciales · ${totalSobrecapacidad} sobre capacidad · ${totalLlenas} llenas · ${specialLocs.length} áreas especiales/tránsito`
            }
          </p>
        </div>

        {/* Selector de Vistas: Mapa del Almacén vs. Vista por Zonas */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="btn-group" style={{ background: 'var(--bg-secondary)', padding: 3, borderRadius: 8, border: '1px solid var(--border)' }}>
            <button
              type="button"
              className={`btn btn-sm ${viewMode === 'layout' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setViewMode('layout')}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 700 }}
            >
              <Layers size={15} /> Mapa del Almacén
            </button>
            <button
              type="button"
              className={`btn btn-sm ${viewMode === 'operational' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setViewMode('operational')}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 700 }}
            >
              <Grid3X3 size={15} /> Vista por Zonas
            </button>
          </div>
          <button className="btn btn-secondary" onClick={loadData}>
            <RefreshCw size={15} /> Actualizar
          </button>
        </div>
      </div>

      {/* Franja Ejecutiva de Capacidad y Estado: Global vs. Depositante 3PL Contextualizado */}
      {!filterCliente ? (
        /* ===== KPIs GLOBALES ===== */
        <div className="stats-grid" style={{ marginBottom: 12 }}>
          {/* Card 1: Celdas de Almacén */}
          <div className="stat-card">
            <div className="stat-icon" style={{ background: 'var(--teal-bg)', color: 'var(--teal)' }}><Warehouse size={22}/></div>
            <div className="stat-info">
              <span className="stat-value">{almacenableLocs.length}</span>
              <span className="stat-label">Celdas en racks ({totalLibres} libres)</span>
            </div>
          </div>

          {/* Card 2: Capacidad Global Piezas */}
          <div className="stat-card">
            <div className="stat-icon" style={{ background: 'rgba(16,185,129,0.15)', color: 'var(--emerald)' }}><Package size={22}/></div>
            <div className="stat-info">
              <span className="stat-value">{pctPiezas}% ocupado en piezas</span>
              <span className="stat-label" style={{ color: totalSobrecapacidad > 0 ? '#DC2626' : 'var(--text-secondary)', fontWeight: totalSobrecapacidad > 0 ? 700 : 500 }}>
                {totalSobrecapacidad > 0 ? `${totalSobrecapacidad} ubicaciones requieren revisión` : `${totalPiezasAlojadas.toLocaleString()} de ${totalCapacidadPiezas.toLocaleString()} piezas`}
              </span>
            </div>
          </div>

          {/* Card 3: Capacidad en Bultos */}
          <div className="stat-card">
            <div className="stat-icon" style={{ background: 'rgba(2,132,199,0.15)', color: '#0284C7' }}><Box size={22}/></div>
            <div className="stat-info">
              {hayCapacidadBultosGlobal ? (
                <>
                  <span className="stat-value">{pctBultos}% ocupado en bultos</span>
                  <span className="stat-label">{totalBultosAlojados} de {totalCapacidadBultos} bultos en racks</span>
                </>
              ) : (
                <>
                  <span className="stat-value">{totalBultosAlojados} bultos alojados</span>
                  <span className="stat-label">Límite de bultos por rack no configurado</span>
                </>
              )}
            </div>
          </div>

          {/* Card 4: Alerta de Sobrecapacidad */}
          <div className="stat-card" style={{ borderColor: totalSobrecapacidad > 0 ? 'rgba(239,68,68,0.4)' : 'var(--border)' }}>
            <div className="stat-icon" style={{
              background: totalSobrecapacidad > 0 ? 'rgba(239,68,68,0.15)' : 'rgba(249,115,22,0.15)',
              color: totalSobrecapacidad > 0 ? '#DC2626' : 'var(--orange)'
            }}>
              {totalSobrecapacidad > 0 ? <AlertTriangle size={22} /> : <Layers size={22}/>}
            </div>
            <div className="stat-info">
              <span className="stat-value" style={{ color: totalSobrecapacidad > 0 ? '#DC2626' : 'inherit', fontSize: 16 }}>
                {totalSobrecapacidad > 0 ? `${totalSobrecapacidad} ubicaciones sobre capacidad` : `${totalLlenas} ubicaciones al 100%`}
              </span>
              <span className="stat-label" style={{ color: totalSobrecapacidad > 0 ? '#DC2626' : 'var(--text-secondary)' }}>
                {totalSobrecapacidad > 0 ? 'Requieren revisión o redistribución' : `${totalParciales} con espacio disponible`}
              </span>
            </div>
          </div>
        </div>
      ) : (
        /* ===== KPIs CONTEXTUALES DEPOSITANTE 3PL ===== */
        <div className="stats-grid" style={{ marginBottom: 12 }}>
          {/* Card 1: Posiciones Utilizadas */}
          <div className="stat-card" style={{ borderColor: 'rgba(37,99,235,0.4)' }}>
            <div className="stat-icon" style={{ background: 'rgba(37,99,235,0.12)', color: '#2563EB' }}><MapPin size={22}/></div>
            <div className="stat-info">
              <span className="stat-value">{clientPositionsCount}</span>
              <span className="stat-label">Posiciones utilizadas por {selectedClientName}</span>
            </div>
          </div>

          {/* Card 2: Piezas Almacenadas del Cliente */}
          <div className="stat-card" style={{ borderColor: 'rgba(16,185,129,0.4)' }}>
            <div className="stat-icon" style={{ background: 'rgba(16,185,129,0.15)', color: 'var(--emerald)' }}><Package size={22}/></div>
            <div className="stat-info">
              <span className="stat-value">{clientTotalPieces.toLocaleString()} piezas</span>
              <span className="stat-label">Inventario físico total del cliente</span>
            </div>
          </div>

          {/* Card 3: Bultos / HUs del Cliente */}
          <div className="stat-card" style={{ borderColor: 'rgba(2,132,199,0.4)' }}>
            <div className="stat-icon" style={{ background: 'rgba(2,132,199,0.15)', color: '#0284C7' }}><Box size={22}/></div>
            <div className="stat-info">
              <span className="stat-value">{clientTotalBultos} bultos</span>
              <span className="stat-label">Unidades de manejo (HUs) del cliente</span>
            </div>
          </div>

          {/* Card 4: Posiciones Disponibles para Depositante */}
          <div className="stat-card" style={{ borderColor: 'rgba(139,92,246,0.4)' }} title="Disponibilidad preliminar por zona, estado de celda y capacidad. La compatibilidad final de producto se valida al asignar el SKU/HU en Putaway.">
            <div className="stat-icon" style={{ background: 'rgba(139,92,246,0.15)', color: '#7C3AED' }}><CheckCircle2 size={22}/></div>
            <div className="stat-info">
              <span className="stat-value" style={{ color: '#7C3AED' }}>{compatiblePositionsCount} celdas</span>
              <span className="stat-label">Disponibles para depositante</span>
            </div>
          </div>
        </div>
      )}

      {/* Resumen Compacto del Filtro por Depositante (Punto 4) */}
      {filterCliente && (
        <div style={{
          padding: '10px 16px',
          borderRadius: 8,
          backgroundColor: 'rgba(37,99,235,0.08)',
          border: '1px solid rgba(37,99,235,0.22)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 10,
          marginBottom: 14
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <ShieldCheck size={18} style={{ color: '#2563EB', flexShrink: 0 }} />
            <div>
              <span style={{ fontSize: 13, fontWeight: 800, color: '#1E40AF' }}>
                Vista de {selectedClientName}
              </span>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)', marginLeft: 8 }}>
                · <strong>{clientTotalPieces.toLocaleString()} piezas</strong> · <strong>{clientTotalBultos} bultos</strong> · <strong>{clientPositionsCount} posiciones utilizadas</strong>
                {selectedClient?.zonaAsignadaId && (
                  <span style={{ marginLeft: 6, color: '#1D4ED8' }}>
                    (Zona: {locations.find(l => l.zonaId === selectedClient.zonaAsignadaId)?.zona?.nombre || 'Zona preferente'})
                  </span>
                )}
              </span>
            </div>
          </div>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setFilterCliente('')}
            style={{ fontSize: 11.5, color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px' }}
          >
            <X size={13} /> Quitar filtro
          </button>
        </div>
      )}

      {/* Leyenda Visual de Estados Compacta (Puntos 2 y 8) */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        flexWrap: 'wrap',
        padding: '8px 14px',
        backgroundColor: 'var(--bg-secondary)',
        borderRadius: 8,
        border: '1px solid var(--border)',
        fontSize: 11.5,
        color: 'var(--text-secondary)',
        marginBottom: 14
      }}>
        <span style={{ fontWeight: 700, color: 'var(--text-primary)', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <Info size={13} /> Leyenda:
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: '#10B981', display: 'inline-block' }} /> Libre
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: '#D97706', display: 'inline-block' }} /> Parcial
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: '#EF4444', display: 'inline-block' }} /> Lleno
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: '#DC2626', display: 'inline-block', boxShadow: '0 0 0 2px rgba(220,38,38,0.25)' }} /> Sobre capacidad
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: '#64748B', display: 'inline-block' }} /> Bloqueado
        </span>

        {filterCliente && (
          <>
            <span style={{ height: 12, width: 1, backgroundColor: 'var(--border)' }} />
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: '#1E40AF', fontWeight: 600 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: '#2563EB', display: 'inline-block' }} /> Con mercancía de {selectedClientName}
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: '#0284C7', fontWeight: 600 }} title="La compatibilidad final de producto se valida al asignar el SKU/HU en Putaway.">
              <span style={{ width: 8, height: 8, borderRadius: 2, border: '1.5px dashed #0284C7', display: 'inline-block' }} /> Disponible para {selectedClientName}
            </span>
            <span style={{ fontSize: 10.5, color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
              (Compatibilidad de producto se valida en Putaway)
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: '#4F46E5', fontWeight: 600 }}>
              <span style={{ padding: '1px 5px', borderRadius: 3, backgroundColor: 'rgba(99,102,241,0.15)', fontSize: 10, fontWeight: 700 }}>Compartida</span> Ubicación compartida
            </span>
          </>
        )}
      </div>

      {/* Barra de Filtros Sticky Compacta Totalmente Opaca (Punto 2) */}
      <div className="card" style={{
        position: 'sticky',
        top: 0,
        zIndex: 100,
        boxShadow: '0 4px 14px rgba(0,0,0,0.08)',
        backdropFilter: 'none',
        WebkitBackdropFilter: 'none',
        backgroundColor: '#FFFFFF',
        background: '#FFFFFF',
        opacity: 1,
        border: '1px solid var(--border)',
        marginBottom: 16
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 14px' }}>
          {/* Fila 1: Buscador | Depositante */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <div className="search-box" style={{ flex: 1, minWidth: 240 }}>
              <Search size={15}/>
              <input
                placeholder="Buscar código (ej. B01-R01-N1), pasillo, rack, zona o área especial..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{ fontSize: 13 }}
              />
            </div>

            {/* Selector de Depositante */}
            <div style={{ width: 260, minWidth: 200, flex: '0 1 280px' }}>
              <select
                className="form-select"
                value={filterCliente}
                onChange={e => {
                  setFilterCliente(e.target.value);
                  if (!e.target.value) setClientViewMode('existencia');
                }}
                style={{
                  width: '100%',
                  fontWeight: filterCliente ? 700 : 500,
                  fontSize: 12.5,
                  borderColor: filterCliente ? '#2563EB' : 'var(--border)',
                  backgroundColor: filterCliente ? 'rgba(37,99,235,0.05)' : 'var(--bg-primary)'
                }}
              >
                <option value="">Todos los depositantes</option>
                {clients.map(c => (
                  <option key={c.id} value={c.id}>
                    Depositante: {c.nombreComercial || c.razonSocial}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Fila 2: Zona | Pasillo | Estado (comparten misma fila cuando existe ancho suficiente) */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: viewMode === 'layout' ? 'repeat(auto-fit, minmax(180px, 1fr))' : 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 10
          }}>
            {/* Selector de Zona */}
            <select className="form-select" value={filterZona} onChange={e => setFilterZona(e.target.value)} style={{ width: '100%', fontSize: 12.5 }}>
              <option value="">Todas las zonas</option>
              {zonas.map(z => <option key={z} value={z}>{z}</option>)}
            </select>

            {/* Selector de Pasillo (en Mapa del Almacén) */}
            {viewMode === 'layout' && (
              <select className="form-select" value={filterPasillo} onChange={e => setFilterPasillo(e.target.value)} style={{ width: '100%', fontSize: 12.5 }}>
                <option value="">Todos los pasillos</option>
                {pasillosDisponibles.map(p => <option key={p} value={p}>Pasillo {p}</option>)}
              </select>
            )}

            {/* Selector de Estado */}
            <select className="form-select" value={filterEstado} onChange={e => setFilterEstado(e.target.value)} style={{ width: '100%', fontSize: 12.5 }}>
              <option value="">Todos los estados</option>
              <option value="LIBRE">Libre</option>
              <option value="PARCIAL">Parcial</option>
              <option value="LLENO">Lleno</option>
              <option value="SOBRECAPACIDAD">Sobre capacidad</option>
              <option value="BLOQUEADO">Bloqueado</option>
              <option value="NO_APLICA">Áreas especiales</option>
            </select>
          </div>

          {/* Fila 3 compacta cuando exista depositante */}
          {filterCliente && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingTop: 6,
              borderTop: '1px solid var(--border)',
              flexWrap: 'wrap',
              gap: 8
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-secondary)' }}>
                  Mostrar:
                </span>
                <div className="btn-group" style={{ background: 'var(--bg-secondary)', padding: 2, borderRadius: 6, border: '1px solid var(--border)' }}>
                  <button
                    type="button"
                    className={`btn btn-xs ${clientViewMode === 'existencia' ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => setClientViewMode('existencia')}
                    style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px' }}
                  >
                    Con existencia ({clientPositionsCount})
                  </button>
                  <button
                    type="button"
                    className={`btn btn-xs ${clientViewMode === 'compatibles' ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => setClientViewMode('compatibles')}
                    style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px' }}
                    title="Disponibles para depositante (preliminar). La compatibilidad final de producto se valida al asignar el SKU/HU en Putaway."
                  >
                    Disponibles para depositante ({compatiblePositionsCount})
                  </button>
                  <button
                    type="button"
                    className={`btn btn-xs ${clientViewMode === 'todas' ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => setClientViewMode('todas')}
                    style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px' }}
                  >
                    Todas relacionadas ({relatedPositionsCount})
                  </button>
                </div>
              </div>

              {viewMode === 'layout' && (
                <div style={{ display: 'flex', gap: 6, fontSize: 11 }}>
                  <button className="btn btn-ghost btn-xs" onClick={expandAllAisles}>Expandir pasillos</button>
                  <button className="btn btn-ghost btn-xs" onClick={collapseAllAisles}>Contraer pasillos</button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-secondary)' }}>
          <RefreshCw className="animate-spin" size={24}/> Cargando mapa y ubicaciones...
        </div>
      ) : viewMode === 'layout' ? (
        /* ========================================================
           VISTA 1: MAPA DEL ALMACÉN (PASILLOS COLAPSABLES) - Punto 1
           ======================================================== */
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {Object.entries(hierarchy).map(([zonaKey, zData]) => (
            <div key={zonaKey} className="card animate-fade-in" style={{ overflow: 'hidden' }}>
              {/* Encabezado de Zona */}
              <div style={{
                padding: '14px 20px',
                borderBottom: '1px solid var(--border)',
                backgroundColor: 'var(--bg-secondary)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 10
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Warehouse size={18} style={{ color: 'var(--primary)' }} />
                  <div>
                    <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>{zData.zonaNombre}</h3>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                      Zona: <strong style={{ color: 'var(--text-primary)' }}>{zData.zonaCodigo}</strong> · {Object.keys(zData.pasillos).length} pasillos configurados
                    </div>
                  </div>
                </div>

                {!filterCliente && (
                  <div style={{ display: 'flex', gap: 6, fontSize: 11 }}>
                    <button className="btn btn-ghost btn-xs" onClick={expandAllAisles}>Expandir todos</button>
                    <button className="btn btn-ghost btn-xs" onClick={collapseAllAisles}>Contraer todos</button>
                  </div>
                )}
              </div>

              {/* Contenedor de Pasillos de la Zona (Expandibles/Colapsables) */}
              <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
                {Object.entries(zData.pasillos).map(([pasilloKey, pData]) => {
                  const isAisleCollapsed = Boolean(collapsedAisles[pasilloKey]);
                  const isAisleOpen = !isAisleCollapsed;
                  
                  // Calcular piezas y presencia de cliente en este pasillo
                  const aisleRacksList = Object.values(pData.racks);
                  const aisleTotalPieces = aisleRacksList.reduce((s, r) => s + r.totalPiezas, 0);
                  const aisleTotalCap = aisleRacksList.reduce((s, r) => s + r.capacidadPiezas, 0);
                  
                  const hasClientStockInAisle = filterCliente ? Object.values(pData.racks).some(r =>
                    Object.values(r.niveles).some(cells =>
                      cells.some(loc => getLocationClientStats(loc, filterCliente).hasStock)
                    )
                  ) : false;

                  return (
                    <div key={pasilloKey} style={{
                      borderRadius: 10,
                      backgroundColor: 'rgba(15, 23, 42, 0.02)',
                      border: '1px solid var(--border)',
                      overflow: 'hidden',
                      transition: 'all 0.15s ease'
                    }}>
                      {/* Barra de Pasillo Clicable para Expandir / Contraer (Punto 1) */}
                      <div
                        onClick={() => toggleAisle(pasilloKey)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '10px 14px',
                          cursor: 'pointer',
                          backgroundColor: isAisleOpen ? 'rgba(15, 23, 42, 0.04)' : 'var(--bg-secondary)',
                          borderBottom: isAisleOpen ? '1px solid var(--border)' : 'none',
                          userSelect: 'none'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                          <span style={{
                            padding: '3px 9px',
                            borderRadius: 6,
                            fontSize: 12,
                            fontWeight: 800,
                            backgroundColor: '#0F172A',
                            color: '#FFFFFF'
                          }}>
                            PASILLO {pData.pasilloCodigo}
                          </span>
                          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                            {Object.keys(pData.racks).length} Racks de Almacenamiento · {aisleTotalPieces} de {aisleTotalCap} piezas
                          </span>
                          {hasClientStockInAisle && (
                            <span style={{
                              fontSize: 10.5,
                              fontWeight: 700,
                              padding: '2px 8px',
                              borderRadius: 4,
                              backgroundColor: 'rgba(37,99,235,0.12)',
                              color: '#1E40AF',
                              border: '1px solid rgba(37,99,235,0.25)'
                            }}>
                              Stock de {selectedClientName}
                            </span>
                          )}
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--text-secondary)' }}>
                          <span>{isAisleOpen ? 'Contraer' : 'Expandir'}</span>
                          {isAisleOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        </div>
                      </div>

                      {/* Grid de Racks Físicos en el Pasillo (Visible sólo si el pasillo está abierto) */}
                      {isAisleOpen && (
                        <div style={{
                          padding: 14,
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                          gap: 14
                        }}>
                          {Object.entries(pData.racks).map(([rackKey, rData]) => {
                            // Ordenar niveles de arriba a abajo: N3 (superior) -> N2 (medio) -> N1 (piso/picking)
                            const sortedNiveles = Object.keys(rData.niveles).sort((a, b) => b.localeCompare(a));
                            const pctRackPiezas = rData.capacidadPiezas > 0 ? Math.round((rData.totalPiezas / rData.capacidadPiezas) * 100) : 0;

                            return (
                              <div key={rackKey} style={{
                                borderRadius: 8,
                                border: '1px solid var(--border)',
                                backgroundColor: 'var(--bg-primary)',
                                overflow: 'hidden',
                                boxShadow: '0 2px 6px rgba(0,0,0,0.04)',
                                display: 'flex',
                                flexDirection: 'column'
                              }}>
                                {/* Cabecera del Rack Industrial */}
                                <div style={{
                                  padding: '10px 14px',
                                  backgroundColor: 'var(--bg-secondary)',
                                  borderBottom: '1px solid var(--border)',
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'center'
                                }}>
                                  <span style={{ fontWeight: 800, fontSize: 13, color: 'var(--text-primary)' }}>
                                    RACK {rData.rackCodigo}
                                  </span>
                                  <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600 }}>
                                    {rData.totalPiezas} de {rData.capacidadPiezas} piezas ({pctRackPiezas}%)
                                  </span>
                                </div>

                                {/* Estantes / Niveles Físicos Claros (N3 -> N2 -> N1) */}
                                <div style={{ padding: '12px 10px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                                  {sortedNiveles.map(nivelKey => {
                                    const celdasNivel = rData.niveles[nivelKey];
                                    const nivelInfo = getNivelInfo(nivelKey);
                                    const isPicking = nivelInfo.role === 'Picking';

                                    return (
                                      <div key={nivelKey} style={{
                                        display: 'flex',
                                        gap: 8,
                                        alignItems: 'stretch'
                                      }}>
                                        {/* Indicador de Nivel Operativo Claro */}
                                        <div style={{
                                          width: 74,
                                          minWidth: 74,
                                          borderRadius: 6,
                                          display: 'flex',
                                          flexDirection: 'column',
                                          alignItems: 'center',
                                          justifyContent: 'center',
                                          padding: '4px 2px',
                                          backgroundColor: isPicking ? 'rgba(56, 189, 248, 0.12)' : 'var(--bg-secondary)',
                                          color: isPicking ? '#0369A1' : 'var(--text-secondary)',
                                          border: isPicking ? '1px solid rgba(56, 189, 248, 0.35)' : '1px solid var(--border)',
                                          flexShrink: 0,
                                          textAlign: 'center'
                                        }} title={nivelInfo.description}>
                                          <span style={{ fontSize: 11, fontWeight: 800 }}>{nivelInfo.code}</span>
                                          <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.02em', opacity: 0.9 }}>
                                            {nivelInfo.role}
                                          </span>
                                        </div>

                                        {/* Celdas físicas de posición en esta viga */}
                                        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: `repeat(${celdasNivel.length}, 1fr)`, gap: 6 }}>
                                          {celdasNivel.map((loc: any) => {
                                            const isOver = loc.estadoCapacidad === 'SOBRECAPACIDAD';
                                            const isBlock = loc.estado === 'BLOQUEADO' || loc.estadoCapacidad === 'BLOQUEADO';
                                            const isFull = loc.estadoCapacidad === 'LLENO';
                                            const isPart = loc.estadoCapacidad === 'PARCIAL';
                                            const isFree = loc.estadoCapacidad === 'LIBRE';

                                            // Diferenciación 3PL por Depositante
                                            const clientStats = filterCliente ? getLocationClientStats(loc, filterCliente) : null;
                                            const isComp = filterCliente ? isLocationCompatibleWithClient(loc, selectedClient, clientStats?.hasStock || false) : false;
                                            const isClientHoldingStock = clientStats?.hasStock || false;

                                            // Prioridad Visual Estricta (Punto 5):
                                            // 1. Riesgo Operativo (SOBRECAPACIDAD / BLOQUEADO) NUNCA se oculta
                                            // 2. Existencia del cliente
                                            // 3. Disponible compatible
                                            let cellBorder = '1px solid rgba(16, 185, 129, 0.35)';
                                            let cellBg = 'rgba(16, 185, 129, 0.08)';
                                            let badgeBg = '#059669';
                                            let badgeText = loc.estadoCapacidad;
                                            let badgeColor = '#FFFFFF';

                                            if (isOver) {
                                              cellBorder = '2px solid #EF4444';
                                              cellBg = 'rgba(239, 68, 68, 0.12)';
                                              badgeBg = '#DC2626';
                                              badgeText = 'SOBRECAP.';
                                            } else if (isBlock) {
                                              cellBorder = '1px solid rgba(148, 163, 184, 0.5)';
                                              cellBg = 'rgba(148, 163, 184, 0.1)';
                                              badgeBg = '#64748B';
                                              badgeText = 'BLOQUEADO';
                                            } else if (filterCliente && isClientHoldingStock) {
                                              cellBorder = '2px solid #2563EB';
                                              cellBg = 'rgba(37, 99, 235, 0.09)';
                                              badgeBg = isFull ? '#EF4444' : isPart ? '#D97706' : '#2563EB';
                                              badgeText = loc.estadoCapacidad;
                                            } else if (filterCliente && isComp && !isClientHoldingStock) {
                                              cellBorder = '1.5px dashed #0284C7';
                                              cellBg = 'rgba(2, 132, 199, 0.05)';
                                              badgeBg = 'rgba(2, 132, 199, 0.15)';
                                              badgeText = 'DISPONIBLE';
                                              badgeColor = '#0284C7';
                                            } else if (isFull) {
                                              cellBorder = '1px solid rgba(239, 68, 68, 0.4)';
                                              cellBg = 'rgba(239, 68, 68, 0.08)';
                                              badgeBg = '#EF4444';
                                            } else if (isPart) {
                                              cellBorder = '1px solid rgba(245, 158, 11, 0.4)';
                                              cellBg = 'rgba(245, 158, 11, 0.08)';
                                              badgeBg = '#D97706';
                                            }

                                            const hasLocBultos = typeof loc.capacidadBultos === 'number' && loc.capacidadBultos > 0;
                                            const tooltipText = isOver
                                              ? `Celda ${loc.codigo} · ¡SOBRECAPACIDAD! La existencia física supera la capacidad configurada (${loc.ocupacionUnidades}/${loc.capacidadUnits} piezas · ${loc.ocupacionBultos || 0} ${hasLocBultos ? `de ${loc.capacidadBultos} bultos` : 'bultos [límite no conf.]'})`
                                              : (filterCliente && isComp && !isClientHoldingStock)
                                              ? `Celda ${loc.codigo} · Disponible preliminarmente para ${selectedClientName} (${loc.ocupacionUnidades ?? 0}/${loc.capacidadUnits} pzas). La compatibilidad final de producto se valida al asignar el SKU/HU en Putaway.`
                                              : `Celda ${loc.codigo} · ${loc.ocupacionUnidades || 0} de ${loc.capacidadUnits} piezas · ${hasLocBultos ? `${loc.ocupacionBultos || 0} de ${loc.capacidadBultos} bultos` : `${loc.ocupacionBultos || 0} bultos`} (${loc.estadoCapacidad})`;

                                            return (
                                              <div
                                                key={loc.id}
                                                onClick={() => handleOpenLocationDetail(loc)}
                                                title={tooltipText}
                                                style={{
                                                  padding: '8px 8px',
                                                  borderRadius: 6,
                                                  cursor: 'pointer',
                                                  border: cellBorder,
                                                  backgroundColor: cellBg,
                                                  transition: 'all 0.15s ease-in-out',
                                                  display: 'flex',
                                                  flexDirection: 'column',
                                                  justifyContent: 'space-between',
                                                  minHeight: 64
                                                }}
                                              >
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                  <span style={{ fontSize: 11, fontWeight: 800, color: '#0F172A' }}>
                                                    {loc.codigo}
                                                  </span>
                                                  <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                                                    {filterCliente && clientStats?.isShared && (
                                                      <span
                                                        title="Esta ubicación contiene mercancía de más de un depositante."
                                                        style={{
                                                          fontSize: 9,
                                                          fontWeight: 700,
                                                          padding: '1px 5px',
                                                          borderRadius: 3,
                                                          backgroundColor: 'rgba(99, 102, 241, 0.15)',
                                                          color: '#4F46E5',
                                                          display: 'inline-flex',
                                                          alignItems: 'center',
                                                          gap: 2
                                                        }}
                                                      >
                                                        <Users size={10} /> Compartida
                                                      </span>
                                                    )}
                                                    {isOver && (
                                                      <AlertTriangle size={13} style={{ color: '#DC2626' }} />
                                                    )}
                                                    {isBlock && (
                                                      <Lock size={12} style={{ color: '#64748B' }} />
                                                    )}
                                                  </div>
                                                </div>

                                                {/* Ocupación en piezas clara */}
                                                <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-primary)', marginTop: 2 }}>
                                                  {filterCliente && isClientHoldingStock ? (
                                                    <span style={{ color: '#1E40AF' }}>
                                                      {clientStats?.pieces} pzs de {selectedClientName}
                                                    </span>
                                                  ) : isFree ? (
                                                    <span style={{ color: '#059669' }}>0 de {loc.capacidadUnits} piezas</span>
                                                  ) : (
                                                    <span>{loc.ocupacionUnidades ?? 0} <span style={{ color: 'var(--text-secondary)', fontWeight: 400 }}>de {loc.capacidadUnits} piezas</span></span>
                                                  )}
                                                </div>

                                                {/* Bultos e indicador de compatibilidad 3PL */}
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                                                  <span style={{ fontSize: 9.5, color: 'var(--text-tertiary)' }}>
                                                    {filterCliente && isClientHoldingStock
                                                      ? `${clientStats?.bultos || 0} bultos`
                                                      : (loc.capacidadBultos !== null && loc.capacidadBultos !== undefined && loc.capacidadBultos !== 'NO_CONFIGURADA'
                                                          ? `${loc.ocupacionBultos ?? 0} de ${loc.capacidadBultos} bultos`
                                                          : `${loc.ocupacionBultos ?? 0} bultos alojados · límite no configurado`
                                                        )
                                                    }
                                                  </span>
                                                  
                                                  <span style={{
                                                    fontSize: 8.5,
                                                    fontWeight: 800,
                                                    padding: '1px 5px',
                                                    borderRadius: 3,
                                                    backgroundColor: badgeBg,
                                                    color: badgeColor,
                                                    border: badgeText === 'DISPONIBLE' ? '1px dashed #0284C7' : 'none'
                                                  }}>
                                                    {badgeText}
                                                  </span>
                                                </div>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {almacenableLocs.length === 0 && (
            filterCliente && clientViewMode === 'compatibles' && compatiblePositionsCount === 0 ? (
              <div className="card" style={{ padding: '36px 24px', textAlign: 'center', backgroundColor: 'var(--bg-secondary)', border: '1px dashed var(--border)', borderRadius: 10 }}>
                <CheckCircle2 size={36} style={{ color: '#0284C7', opacity: 0.8, marginBottom: 10 }} />
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: 'var(--text-primary)' }}>
                  No hay ubicaciones disponibles para {selectedClientName}
                </h3>
                <p style={{ margin: '8px auto 16px', maxWidth: 540, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  Actualmente no existen celdas libres o parciales con capacidad disponible dentro de las zonas habilitadas para este depositante.
                </p>
                {(filterZona || filterPasillo || filterEstado) && (
                  <p style={{ margin: '-8px auto 16px', fontSize: 12, color: 'var(--orange)', fontWeight: 600 }}>
                    Revise también los filtros de zona, pasillo o estado.
                  </p>
                )}
                <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
                  <button className="btn btn-primary btn-sm" onClick={() => setClientViewMode('existencia')}>
                    Ver posiciones con existencia
                  </button>
                  <button className="btn btn-secondary btn-sm" onClick={() => setFilterCliente('')}>
                    Quitar filtro de depositante
                  </button>
                </div>
              </div>
            ) : (
              <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>
                No se encontraron celdas de rack almacenables con los filtros seleccionados.
              </div>
            )
          )}

          {/* ========================================================
             SECCIÓN MEJORADA: ÁREAS ESPECIALES Y DE TRÁNSITO
             ======================================================== */}
          {specialLocs.length > 0 && (
            <div className="card animate-fade-in" style={{ border: '1px solid rgba(245, 158, 11, 0.35)', overflow: 'hidden' }}>
              <div style={{
                padding: '16px 20px',
                borderBottom: '1px solid var(--border)',
                backgroundColor: 'rgba(245, 158, 11, 0.08)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 10
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Warehouse size={18} style={{ color: '#D97706' }} />
                  <div>
                    <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>Áreas especiales y de tránsito ({specialLocs.length})</h3>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                      Estas áreas no participan en la asignación automática de racks.
                    </div>
                  </div>
                </div>
                <span style={{
                  fontSize: 11,
                  fontWeight: 700,
                  padding: '3px 9px',
                  borderRadius: 6,
                  backgroundColor: 'rgba(245, 158, 11, 0.15)',
                  color: '#B45309',
                  border: '1px solid rgba(245, 158, 11, 0.3)'
                }}>
                  Capacidad de rack no aplica
                </span>
              </div>

              {/* Grid simplificado de tarjetas limpias */}
              <div style={{ padding: 20, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 14 }}>
                {specialLocs.map((loc: any) => {
                  const clientStats = filterCliente ? getLocationClientStats(loc, filterCliente) : null;
                  
                  return (
                    <div
                      key={loc.id}
                      onClick={() => handleOpenLocationDetail(loc)}
                      style={{
                        padding: '16px 18px',
                        borderRadius: 10,
                        border: filterCliente && clientStats?.hasStock ? '2px solid #2563EB' : '1px solid var(--border)',
                        backgroundColor: 'var(--bg-secondary)',
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        gap: 12,
                        transition: 'all 0.15s ease-in-out',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.03)'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)' }}>{loc.codigo}</div>
                          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2, fontWeight: 500 }}>
                            {getFriendlyCategory(loc.categoriaUbicacion)}
                          </div>
                        </div>
                        {filterCliente && clientStats?.isShared && (
                          <span
                            title="Esta ubicación contiene mercancía de más de un depositante."
                            style={{
                              fontSize: 10,
                              padding: '2px 7px',
                              borderRadius: 4,
                              backgroundColor: 'rgba(99, 102, 241, 0.15)',
                              color: '#4F46E5',
                              fontWeight: 700,
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 3
                            }}
                          >
                            <Users size={11} /> Compartida
                          </span>
                        )}
                      </div>

                      <div style={{
                        padding: '10px 12px',
                        borderRadius: 6,
                        backgroundColor: 'var(--bg-primary)',
                        border: '1px solid var(--border)',
                        fontSize: 13,
                        fontWeight: 700,
                        color: 'var(--text-primary)'
                      }}>
                        {filterCliente && clientStats?.hasStock ? (
                          <span style={{ color: '#1E40AF' }}>
                            {clientStats.pieces.toLocaleString()} piezas · {clientStats.bultos} {clientStats.bultos === 1 ? 'bulto' : 'bultos'} de {selectedClientName}
                          </span>
                        ) : (
                          <span>{(loc.ocupacionUnidades ?? 0).toLocaleString()} piezas · {loc.ocupacionBultos ?? 0} bultos</span>
                        )}
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, color: 'var(--text-tertiary)' }}>
                        <span style={{ fontStyle: 'italic' }}>Sin límite de rack</span>
                        <span style={{ color: 'var(--primary)', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <Eye size={13} /> Consultar
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      ) : (
        /* ========================================================
           VISTA 2: VISTA POR ZONAS
           ======================================================== */
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {Object.entries(byZone).map(([zoneName, locs]) => (
            <div key={zoneName} className="card animate-fade-in" style={{ marginBottom: 16 }}>
              <div className="card-header">
                <h3><MapPin size={16}/> {zoneName} <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--text-tertiary)' }}>({locs.length} posiciones)</span></h3>
              </div>
              <div style={{ padding: '16px 20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
                {locs.map((loc: any) => {
                  const isBlocked = loc.estado === 'BLOQUEADO' || loc.estadoCapacidad === 'BLOQUEADO';
                  const isOver = loc.estadoCapacidad === 'SOBRECAPACIDAD';
                  const isFull = loc.estadoCapacidad === 'LLENO';
                  const isPartial = loc.estadoCapacidad === 'PARCIAL';
                  const isFree = loc.estadoCapacidad === 'LIBRE';
                  
                  const clientStats = filterCliente ? getLocationClientStats(loc, filterCliente) : null;
                  const isClientHoldingStock = clientStats?.hasStock || false;

                  return (
                    <div
                      key={loc.id}
                      onClick={() => handleOpenLocationDetail(loc)}
                      title={`Ver existencias y bultos en ${loc.codigo}`}
                      style={{
                        padding: '12px 10px',
                        borderRadius: 8,
                        textAlign: 'center',
                        cursor: 'pointer',
                        fontSize: 12,
                        fontWeight: 600,
                        border: isOver
                          ? '2px solid #EF4444'
                          : filterCliente && isClientHoldingStock
                          ? '2px solid #2563EB'
                          : isFull
                          ? '1px solid rgba(239,68,68,0.4)'
                          : isPartial
                          ? '1px solid rgba(245,158,11,0.4)'
                          : isBlocked
                          ? '1px solid rgba(148,163,184,0.4)'
                          : '1px solid rgba(16,185,129,0.3)',
                        transition: 'all 0.2s',
                        background: isOver
                          ? 'rgba(239,68,68,0.12)'
                          : filterCliente && isClientHoldingStock
                          ? 'rgba(37,99,235,0.1)'
                          : isFull
                          ? 'rgba(239,68,68,0.08)'
                          : isPartial
                          ? 'rgba(245,158,11,0.08)'
                          : isBlocked
                          ? 'rgba(148,163,184,0.08)'
                          : 'rgba(16,185,129,0.08)',
                        color: isOver || isFull
                          ? '#DC2626'
                          : filterCliente && isClientHoldingStock
                          ? '#1E40AF'
                          : isPartial
                          ? '#D97706'
                          : isBlocked
                          ? '#64748B'
                          : '#059669',
                      }}
                    >
                      <div style={{ fontSize: 13, fontWeight: 700 }}>{loc.codigo}</div>
                      <div style={{ fontSize: 11, fontWeight: 600, marginTop: 4, color: 'var(--text-primary)' }}>
                        {filterCliente && isClientHoldingStock ? (
                          <span style={{ color: '#1E40AF' }}>{clientStats?.pieces} piezas</span>
                        ) : isFree ? (
                          <span style={{ color: '#059669' }}>Libre</span>
                        ) : (
                          <span>{loc.ocupacionUnidades ?? 0} piezas</span>
                        )}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 2 }}>
                        {filterCliente && isClientHoldingStock
                          ? `${clientStats?.bultos} ${clientStats?.bultos === 1 ? 'bulto' : 'bultos'}`
                          : `${loc.ocupacionBultos ?? 0} ${(loc.ocupacionBultos ?? 0) === 1 ? 'bulto' : 'bultos'}`
                        }
                      </div>
                      <div style={{ fontSize: 9.5, fontWeight: 700, marginTop: 4 }}>
                        {loc.estadoCapacidad === 'NO_APLICA' ? 'Especial' : loc.estadoCapacidad}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Sección de áreas especiales únicamente para aquellas que no pertenezcan a ninguna zona renderizada arriba (Punto 1) */}
          {unassignedSpecialLocs.length > 0 && (
            <div className="card animate-fade-in" style={{ border: '1px solid rgba(245, 158, 11, 0.35)' }}>
              <div className="card-header" style={{ backgroundColor: 'rgba(245, 158, 11, 0.08)' }}>
                <h3><Warehouse size={16} color="#D97706" /> Áreas especiales y de tránsito ({unassignedSpecialLocs.length})</h3>
              </div>
              <div style={{ padding: '16px 20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
                {unassignedSpecialLocs.map((loc: any) => {
                  const clientStats = filterCliente ? getLocationClientStats(loc, filterCliente) : null;
                  
                  return (
                    <div
                      key={loc.id}
                      onClick={() => handleOpenLocationDetail(loc)}
                      style={{
                        padding: 12,
                        borderRadius: 8,
                        backgroundColor: 'var(--bg-secondary)',
                        border: filterCliente && clientStats?.hasStock ? '2px solid #2563EB' : '1px solid var(--border)',
                        cursor: 'pointer'
                      }}
                    >
                      <div style={{ fontWeight: 800, fontSize: 14 }}>{loc.codigo}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{getFriendlyCategory(loc.categoriaUbicacion)}</div>
                      <div style={{ fontSize: 12, fontWeight: 700, marginTop: 4 }}>
                        {filterCliente && clientStats?.hasStock ? (
                          <span style={{ color: '#1E40AF' }}>{clientStats.pieces.toLocaleString()} piezas · {clientStats.bultos} {clientStats.bultos === 1 ? 'bulto' : 'bultos'} de {selectedClientName}</span>
                        ) : (
                          <span>{loc.ocupacionUnidades ?? 0} piezas · {loc.ocupacionBultos ?? 0} {(loc.ocupacionBultos ?? 0) === 1 ? 'bulto' : 'bultos'}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ===== MODAL DE DETALLE DE UBICACIÓN (SOPORTE 3PL Y UBICACIONES COMPARTIDAS) ===== */}
      {selectedLoc && (
        <div className="modal-overlay" onClick={() => setSelectedLoc(null)}>
          <div
            className="modal-content"
            onClick={e => e.stopPropagation()}
            style={{
              width: '95vw',
              maxWidth: 1040,
              maxHeight: '90vh',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              borderRadius: 12,
              boxShadow: '0 20px 40px rgba(0,0,0,0.2)'
            }}
          >
            {/* Cabecera Fija del Modal */}
            <div className="modal-header" style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '16px 24px',
              borderBottom: '1px solid var(--border)',
              backgroundColor: 'var(--bg-primary)'
            }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <MapPin size={20} color="var(--primary)" /> Ubicación {selectedLoc.codigo}
                </h2>
                <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-secondary)' }}>
                  {selectedLoc.zona?.nombre || 'Zona de Almacén'} · {getFriendlyCategory(selectedLoc.categoriaUbicacion)}
                  {selectedLoc.pasillo ? ` · Pasillo: ${selectedLoc.pasillo}` : ''}
                  {selectedLoc.rack ? ` · Rack: ${selectedLoc.rack}` : ''}
                  {selectedLoc.nivel ? ` · ${getNivelInfo(selectedLoc.nivel).description}` : ''}
                </p>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => setSelectedLoc(null)} title="Cerrar modal">
                <X size={18} />
              </button>
            </div>

            {/* Cuerpo con Scroll Vertical Interno y Cero Desplazamiento Horizontal */}
            <div style={{
              padding: '20px 24px',
              overflowY: 'auto',
              overflowX: 'hidden',
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              gap: 18
            }}>
              {locDetailLoading ? (
                <div style={{ textAlign: 'center', padding: 50, color: 'var(--text-secondary)' }}>
                  <RefreshCw className="animate-spin" size={24} /> Cargando detalle de existencias...
                </div>
              ) : (
                (() => {
                  // Lógica 3PL de segregación por depositante en el modal
                  const allLots = locDetailData?.lotes || [];
                  const allHus = locDetailData?.handlingUnits || [];
                  
                  const clientLotsInModal = filterCliente
                    ? allLots.filter((l: any) => l.clienteId === filterCliente || l.cliente?.id === filterCliente)
                    : allLots;
                  
                  const otherLotsInModal = filterCliente
                    ? allLots.filter((l: any) => l.clienteId !== filterCliente && l.cliente?.id !== filterCliente)
                    : [];

                  const clientPiecesInModal = clientLotsInModal.reduce((s: number, l: any) => s + ((l.cantidadDisponible || 0) + (l.cantidadBloqueada || 0)), 0);
                  const otherPiecesInModal = otherLotsInModal.reduce((s: number, l: any) => s + ((l.cantidadDisponible || 0) + (l.cantidadBloqueada || 0)), 0);
                  const isShared = filterCliente && clientPiecesInModal > 0 && otherPiecesInModal > 0;

                  const clientHusInModal = filterCliente
                    ? allHus.filter((h: any) => h.clienteId === filterCliente || h.cliente?.id === filterCliente || h.lote?.clienteId === filterCliente)
                    : allHus;

                  const clientDispInModal = clientLotsInModal.reduce((s: number, l: any) => s + Math.max(0, (l.cantidadDisponible || 0) - (l.cantidadReservada || 0)), 0);
                  const clientBloqInModal = clientLotsInModal.reduce((s: number, l: any) => s + (l.cantidadBloqueada || 0), 0);

                  // Datos a mostrar según toggle de usuario (Punto 7)
                  const displayLots = (filterCliente && showOnlyFilterClientInModal) ? clientLotsInModal : allLots;
                  const displayHus = (filterCliente && showOnlyFilterClientInModal) ? clientHusInModal : allHus;

                  return (
                    <>
                      {/* Banner de Ubicación Compartida 3PL (Punto 6 y 7) */}
                      {isShared && (
                        <div style={{
                          padding: '12px 16px',
                          borderRadius: 8,
                          backgroundColor: 'rgba(245, 158, 11, 0.09)',
                          border: '1px solid rgba(245, 158, 11, 0.35)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 12
                        }}>
                          <Users size={20} style={{ color: '#D97706', flexShrink: 0 }} />
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 800, fontSize: 13, color: '#B45309' }}>
                              Ubicación compartida (Operación 3PL)
                            </div>
                            <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 2 }}>
                              Esta ubicación contiene mercancía de más de un depositante. Las métricas contextuales reflejan las existencias de <strong>{selectedClientName}</strong> sin mezclar saldos de terceros.
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Banner discreto para posición disponible de depositante */}
                      {filterCliente && !clientPiecesInModal && isLocationCompatibleWithClient(selectedLoc, selectedClient, false) && (
                        <div style={{
                          padding: '10px 14px',
                          borderRadius: 8,
                          backgroundColor: 'rgba(2, 132, 199, 0.08)',
                          border: '1px solid rgba(2, 132, 199, 0.25)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          fontSize: 12
                        }}>
                          <CheckCircle2 size={16} color="#0284C7" style={{ flexShrink: 0 }} />
                          <div>
                            <strong style={{ color: '#0369A1' }}>Disponible para {selectedClientName}</strong>
                            <span style={{ color: 'var(--text-secondary)', marginLeft: 6 }}>
                              · La compatibilidad definitiva se validará con el SKU/HU durante Putaway.
                            </span>
                          </div>
                        </div>
                      )}

                      {/* Alternador Segmentado de Vista en Modal (Punto 7) */}
                      {filterCliente && (
                        <div style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          backgroundColor: 'var(--bg-secondary)',
                          padding: '8px 12px',
                          borderRadius: 8,
                          border: '1px solid var(--border)',
                          flexWrap: 'wrap',
                          gap: 10
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>Vista de inventario:</span>
                            <div className="btn-group" style={{ background: 'var(--bg-primary)', padding: 2, borderRadius: 6, border: '1px solid var(--border)' }}>
                              <button
                                type="button"
                                className={`btn btn-xs ${showOnlyFilterClientInModal ? 'btn-primary' : 'btn-ghost'}`}
                                onClick={() => setShowOnlyFilterClientInModal(true)}
                                style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                              >
                                <UserCheck size={13} /> Solo {selectedClientName}
                              </button>
                              <button
                                type="button"
                                className={`btn btn-xs ${!showOnlyFilterClientInModal ? 'btn-primary' : 'btn-ghost'}`}
                                onClick={() => setShowOnlyFilterClientInModal(false)}
                                style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                              >
                                <Users size={13} /> Todo el inventario de la ubicación ({allLots.length} lotes)
                              </button>
                            </div>
                          </div>

                          {isShared && (
                            <span style={{
                              fontSize: 11,
                              fontWeight: 700,
                              color: '#B45309',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4
                            }}>
                              <AlertTriangle size={13} /> Celda multicliente
                            </span>
                          )}
                        </div>
                      )}

                      {/* Banner de Sobrecapacidad */}
                      {locDetailData?.estadoCapacidad === 'SOBRECAPACIDAD' && (
                        <div style={{
                          padding: '14px 18px',
                          borderRadius: 10,
                          backgroundColor: 'rgba(239, 68, 68, 0.1)',
                          border: '1px solid rgba(239, 68, 68, 0.35)',
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: 12
                        }}>
                          <AlertTriangle size={24} style={{ color: '#DC2626', flexShrink: 0, marginTop: 2 }} />
                          <div>
                            <div style={{ fontWeight: 800, fontSize: 13.5, color: '#DC2626' }}>
                              ALERTA OPERATIVA: SOBRECAPACIDAD FÍSICA DETECTADA
                            </div>
                            <div style={{ fontSize: 12, color: 'var(--text-primary)', marginTop: 3, fontWeight: 600 }}>
                              La existencia física supera la capacidad configurada de esta posición.
                            </div>
                            <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 3 }}>
                              Esta posición aloja <strong>{locDetailData.ocupacionUnidades} piezas</strong> y <strong>{locDetailData.ocupacionBultos} {locDetailData.ocupacionBultos === 1 ? 'bulto' : 'bultos'}</strong> ({(typeof locDetailData.capacidadBultos === 'number' && locDetailData.capacidadBultos > 0)
                                ? `capacidad nominal: ${locDetailData.capacidadUnits} piezas / ${locDetailData.capacidadBultos} bultos`
                                : `Capacidad configurada: ${locDetailData.capacidadUnits} piezas · límite de bultos no configurado`
                              }). El inventario real se respeta íntegro sin alterar saldos históricos.
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Banner para Área Especial / No Comercial */}
                      {(selectedLoc.esAlmacenable === false || selectedLoc.categoriaUbicacion !== 'FISICA_ALMACENABLE') && (
                        <div style={{
                          padding: '16px 20px',
                          borderRadius: 10,
                          backgroundColor: 'rgba(2, 132, 199, 0.08)',
                          border: '1px solid rgba(2, 132, 199, 0.25)',
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: 14
                        }}>
                          <Warehouse size={26} style={{ color: '#0284C7', flexShrink: 0, marginTop: 2 }} />
                          <div style={{ flex: 1 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: '#0F172A' }}>
                                Área no comercial · {getFriendlyCategory(selectedLoc.categoriaUbicacion)}
                              </h3>
                              <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6, backgroundColor: 'rgba(2, 132, 199, 0.15)', color: '#0284C7' }}>
                                Capacidad de rack no aplica
                              </span>
                            </div>
                            <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                              Esta ubicación almacena mercancía separada del inventario disponible y no participa en las sugerencias de Putaway.
                            </p>
                          </div>
                        </div>
                      )}

                      {/* KPIs Principales en Área Especial */}
                      {(selectedLoc.esAlmacenable === false || selectedLoc.categoriaUbicacion !== 'FISICA_ALMACENABLE') ? (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
                          <div style={{ background: 'var(--bg-secondary)', padding: '14px 16px', borderRadius: 8, border: '1px solid var(--border)' }}>
                            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 700, textTransform: 'uppercase' }}>
                              {filterCliente && showOnlyFilterClientInModal ? `Físico ${selectedClientName}` : 'Existencia Física Total'}
                            </div>
                            <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)', marginTop: 4 }}>
                              {filterCliente && showOnlyFilterClientInModal ? clientPiecesInModal.toLocaleString() : (locDetailData?.totalFisico ?? locDetailData?.ocupacionUnidades ?? 0).toLocaleString()} <span style={{ fontSize: 12, fontWeight: 500 }}>piezas</span>
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                              {filterCliente && showOnlyFilterClientInModal
                                ? `${clientHusInModal.length} ${clientHusInModal.length === 1 ? 'bulto' : 'bultos'} de ${selectedClientName}`
                                : `${locDetailData?.ocupacionBultos ?? locDetailData?.handlingUnits?.length ?? 0} ${(locDetailData?.ocupacionBultos ?? locDetailData?.handlingUnits?.length ?? 0) === 1 ? 'bulto total' : 'bultos totales'}`}
                            </div>
                          </div>

                          <div style={{ background: 'var(--bg-secondary)', padding: '14px 16px', borderRadius: 8, border: '1px solid var(--border)' }}>
                            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 700, textTransform: 'uppercase' }}>Disponible para Venta</div>
                            <div style={{ fontSize: 18, fontWeight: 800, color: '#059669', marginTop: 4 }}>
                              {filterCliente && showOnlyFilterClientInModal ? clientDispInModal.toLocaleString() : (locDetailData?.totalDisponible ?? 0).toLocaleString()} <span style={{ fontSize: 12, fontWeight: 500 }}>piezas</span>
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                              Mercancía en condiciones de despacho
                            </div>
                          </div>

                          <div style={{ background: 'var(--bg-secondary)', padding: '14px 16px', borderRadius: 8, border: '1px solid var(--border)' }}>
                            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 700, textTransform: 'uppercase' }}>Bloqueado / Retenido</div>
                            <div style={{ fontSize: 18, fontWeight: 800, color: (filterCliente && showOnlyFilterClientInModal ? clientBloqInModal : (locDetailData?.totalBloqueado ?? 0)) > 0 ? '#DC2626' : 'var(--text-primary)', marginTop: 4 }}>
                              {filterCliente && showOnlyFilterClientInModal ? clientBloqInModal.toLocaleString() : (locDetailData?.totalBloqueado ?? 0).toLocaleString()} <span style={{ fontSize: 12, fontWeight: 500 }}>piezas</span>
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                              Mermas, cuarentenas o devoluciones
                            </div>
                          </div>
                        </div>
                      ) : (
                        /* Desglose de Capacidad Física para Celdas de Rack */
                        <>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
                            {/* Tarjeta Capacidad Piezas */}
                            <div style={{ background: 'var(--bg-secondary)', padding: '14px 16px', borderRadius: 8, border: '1px solid var(--border)' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                                <span style={{ fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <Package size={15} style={{ color: 'var(--emerald)' }} /> Capacidad en Piezas
                                </span>
                                <span style={{ fontSize: 11.5, fontWeight: 700, color: locDetailData?.estadoCapacidad === 'SOBRECAPACIDAD' ? '#DC2626' : 'var(--emerald)' }}>
                                  Uso de capacidad: {locDetailData?.porcentajeOcupacionUnidades ?? 0}%
                                </span>
                              </div>
                              <div style={{ fontSize: 18, fontWeight: 800, color: '#0F172A' }}>
                                {filterCliente && showOnlyFilterClientInModal ? (
                                  <>
                                    <span>{clientPiecesInModal.toLocaleString()}</span>{' '}
                                    <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)' }}>
                                      piezas de {selectedClientName} (Total celda: {locDetailData?.ocupacionUnidades ?? 0}/{locDetailData?.capacidadUnits || 100})
                                    </span>
                                  </>
                                ) : (
                                  <>
                                    {locDetailData?.ocupacionUnidades ?? locDetailData?.totalFisico ?? 0}{' '}
                                    <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)' }}>
                                      de {locDetailData?.capacidadUnits || 100} piezas
                                    </span>
                                  </>
                                )}
                              </div>
                              <div style={{ height: 6, width: '100%', background: 'rgba(0,0,0,0.06)', borderRadius: 3, marginTop: 8, overflow: 'hidden' }}>
                                <div style={{
                                  height: '100%',
                                  width: `${Math.min(100, locDetailData?.porcentajeOcupacionUnidades ?? 0)}%`,
                                  background: locDetailData?.estadoCapacidad === 'SOBRECAPACIDAD' ? '#DC2626' : (locDetailData?.porcentajeOcupacionUnidades ?? 0) >= 100 ? '#EF4444' : '#10B981'
                                }} />
                              </div>
                              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 6, display: 'flex', justifyContent: 'space-between' }}>
                                <span>Espacio libre: <strong>{locDetailData?.capacidadDisponibleUnidades ?? 0} piezas</strong></span>
                                {locDetailData?.reservaUnidades > 0 && <span>Reserva: {locDetailData.reservaUnidades} piezas</span>}
                              </div>
                            </div>

                            {/* Tarjeta Capacidad Bultos */}
                            <div style={{ background: 'var(--bg-secondary)', padding: '14px 16px', borderRadius: 8, border: '1px solid var(--border)' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                                <span style={{ fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <Box size={15} style={{ color: '#0284C7' }} /> Capacidad en Bultos
                                </span>
                                {locDetailData?.capacidadBultos ? (
                                  <span style={{ fontSize: 11.5, fontWeight: 700, color: '#0284C7' }}>
                                    Uso de capacidad: {locDetailData?.porcentajeOcupacionBultos ?? 0}%
                                  </span>
                                ) : (
                                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>
                                    Límite no configurado
                                  </span>
                                )}
                              </div>
                              <div style={{ fontSize: 18, fontWeight: 800, color: '#0F172A' }}>
                                {filterCliente && showOnlyFilterClientInModal ? (
                                  <>
                                    <span>{clientHusInModal.length}</span>{' '}
                                    <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)' }}>
                                      {clientHusInModal.length === 1 ? 'bulto' : 'bultos'} de {selectedClientName} (Total: {locDetailData?.ocupacionBultos ?? 0}{' '}
                                      {locDetailData?.capacidadBultos
                                        ? `/${locDetailData.capacidadBultos} bultos`
                                        : `${(locDetailData?.ocupacionBultos ?? 0) === 1 ? 'bulto alojado' : 'bultos alojados'} · límite no configurado`})
                                    </span>
                                  </>
                                ) : (
                                  <>
                                    {locDetailData?.ocupacionBultos ?? locDetailData?.handlingUnits?.length ?? 0}{' '}
                                    <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)' }}>
                                      {locDetailData?.capacidadBultos
                                        ? `de ${locDetailData.capacidadBultos} bultos`
                                        : `${(locDetailData?.ocupacionBultos ?? locDetailData?.handlingUnits?.length ?? 0) === 1 ? 'bulto alojado' : 'bultos alojados'} · límite de bultos no configurado`}
                                    </span>
                                  </>
                                )}
                              </div>
                              {locDetailData?.capacidadBultos ? (
                                <div style={{ height: 6, width: '100%', background: 'rgba(0,0,0,0.06)', borderRadius: 3, marginTop: 8, overflow: 'hidden' }}>
                                  <div style={{
                                    height: '100%',
                                    width: `${Math.min(100, locDetailData?.porcentajeOcupacionBultos ?? 0)}%`,
                                    background: (locDetailData?.porcentajeOcupacionBultos ?? 0) >= 100 ? '#EF4444' : '#0284C7'
                                  }} />
                                </div>
                              ) : null}
                              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 6, display: 'flex', justifyContent: 'space-between' }}>
                                <span>{locDetailData?.capacidadBultos ? <>Espacio libre: <strong>{locDetailData?.capacidadDisponibleBultos ?? 0} {(locDetailData?.capacidadDisponibleBultos ?? 0) === 1 ? 'bulto' : 'bultos'}</strong></> : <span>Límite de bultos: <strong>No configurado</strong></span>}</span>
                                {locDetailData?.reservaBultos > 0 && <span>Reserva: {locDetailData.reservaBultos} {locDetailData.reservaBultos === 1 ? 'bulto' : 'bultos'}</span>}
                              </div>
                            </div>
                          </div>

                          {/* 4 Indicadores Complementarios */}
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10 }}>
                            <div style={{ background: 'var(--bg-secondary)', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', textAlign: 'center' }}>
                              <div style={{ fontSize: 10, color: 'var(--text-tertiary)', fontWeight: 700, textTransform: 'uppercase' }}>Estado Capacidad</div>
                              <div style={{
                                fontSize: 13,
                                fontWeight: 800,
                                marginTop: 3,
                                color: locDetailData?.estadoCapacidad === 'SOBRECAPACIDAD'
                                  ? '#DC2626'
                                  : locDetailData?.estadoCapacidad === 'LLENO'
                                  ? '#EF4444'
                                  : locDetailData?.estadoCapacidad === 'PARCIAL'
                                  ? '#D97706'
                                  : '#059669'
                              }}>
                                {locDetailData?.estadoCapacidad || selectedLoc.estado}
                              </div>
                            </div>
                            <div style={{ background: 'var(--bg-secondary)', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', textAlign: 'center' }}>
                              <div style={{ fontSize: 10, color: 'var(--text-tertiary)', fontWeight: 700, textTransform: 'uppercase' }}>
                                {filterCliente && showOnlyFilterClientInModal ? `Físico ${selectedClientName}` : 'Físico Total'}
                              </div>
                              <div style={{ fontSize: 14, fontWeight: 800, marginTop: 3 }}>
                                {(filterCliente && showOnlyFilterClientInModal ? clientPiecesInModal : (locDetailData?.totalFisico ?? 0)).toLocaleString()} <span style={{ fontSize: 10, fontWeight: 400 }}>piezas</span>
                              </div>
                            </div>
                            <div style={{ background: 'var(--bg-secondary)', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', textAlign: 'center' }}>
                              <div style={{ fontSize: 10, color: 'var(--text-tertiary)', fontWeight: 700, textTransform: 'uppercase' }}>Disp. Vendible</div>
                              <div style={{ fontSize: 14, fontWeight: 800, marginTop: 3, color: '#059669' }}>
                                {(filterCliente && showOnlyFilterClientInModal ? clientDispInModal : (locDetailData?.totalDisponible ?? 0)).toLocaleString()} <span style={{ fontSize: 10, fontWeight: 400 }}>piezas</span>
                              </div>
                            </div>
                            <div style={{ background: 'var(--bg-secondary)', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', textAlign: 'center' }}>
                              <div style={{ fontSize: 10, color: 'var(--text-tertiary)', fontWeight: 700, textTransform: 'uppercase' }}>Bloqueado</div>
                              <div style={{ fontSize: 14, fontWeight: 800, marginTop: 3, color: (filterCliente && showOnlyFilterClientInModal ? clientBloqInModal : (locDetailData?.totalBloqueado ?? 0)) > 0 ? '#DC2626' : 'inherit' }}>
                                {(filterCliente && showOnlyFilterClientInModal ? clientBloqInModal : (locDetailData?.totalBloqueado ?? 0)).toLocaleString()} <span style={{ fontSize: 10, fontWeight: 400 }}>piezas</span>
                              </div>
                            </div>
                          </div>
                        </>
                      )}

                      {/* Tabla 1: Existencias y Lotes Alojados */}
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                          <h4 style={{ fontSize: 13, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                            <Package size={15} color="var(--primary)" /> Existencias y Lotes Alojados ({displayLots.length} registros)
                          </h4>
                          {filterCliente && showOnlyFilterClientInModal && otherLotsInModal.length > 0 && (
                            <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                              ({otherLotsInModal.length} registros de otros depositantes ocultos)
                            </span>
                          )}
                        </div>
                        {displayLots.length > 0 ? (
                          <div style={{ borderRadius: 8, overflowX: 'auto', border: '1px solid var(--border)', backgroundColor: 'var(--bg-primary)' }}>
                            <table className="data-table" style={{ fontSize: 12, width: '100%', borderCollapse: 'collapse' }}>
                              <thead>
                                <tr style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}>
                                  <th style={{ padding: '10px 14px', textAlign: 'left', minWidth: 200 }}>SKU / Producto</th>
                                  <th style={{ padding: '10px 14px', textAlign: 'left', minWidth: 150 }}>Lote & Caducidad</th>
                                  <th style={{ padding: '10px 14px', textAlign: 'right', minWidth: 140 }}>Existencia (Físico / Disp.)</th>
                                  <th style={{ padding: '10px 14px', textAlign: 'center', minWidth: 110 }}>
                                    <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4, width: '100%' }}>
                                      <span>Calidad</span>
                                      <span
                                        title={CALIDAD_TOOLTIP}
                                        style={{ cursor: 'help', display: 'inline-flex', alignItems: 'center', color: 'var(--text-tertiary)' }}
                                      >
                                        <Info size={12} />
                                      </span>
                                    </div>
                                  </th>
                                  <th style={{ padding: '10px 14px', textAlign: 'left', minWidth: 160 }}>Depositante</th>
                                </tr>
                              </thead>
                              <tbody>
                                {displayLots.map((l: any) => {
                                  const total = (l.cantidadDisponible || 0) + (l.cantidadBloqueada || 0);
                                  const disp = Math.max(0, (l.cantidadDisponible || 0) - (l.cantidadReservada || 0));
                                  const res = l.cantidadReservada || 0;
                                  const bloq = l.cantidadBloqueada || 0;
                                  const isLiberado = l.estadoCalidad === 'LIBERADO';
                                  const isThisClient = filterCliente && (l.clienteId === filterCliente || l.cliente?.id === filterCliente);

                                  return (
                                    <tr key={l.id} style={{
                                      borderBottom: '1px solid var(--border)',
                                      backgroundColor: isThisClient ? 'rgba(37,99,235,0.03)' : 'inherit'
                                    }}>
                                      <td style={{ padding: '10px 14px', verticalAlign: 'top' }}>
                                        <div style={{ fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'monospace', fontSize: 13 }}>
                                          {l.sku?.codigo}
                                        </div>
                                        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2, whiteSpace: 'normal', wordBreak: 'break-word', lineHeight: 1.3 }}>
                                          {l.sku?.descripcion || '—'}
                                        </div>
                                      </td>
                                      <td style={{ padding: '10px 14px', verticalAlign: 'top' }}>
                                        <span className="badge badge-default" style={{ fontFamily: 'monospace', fontWeight: 600 }}>
                                          {l.lote || 'Sin Lote'}
                                        </span>
                                        {l.fechaVencimiento && (
                                          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                                            <Calendar size={11} /> {formatCalendarDate(l.fechaVencimiento)}
                                          </div>
                                        )}
                                      </td>
                                      <td style={{ padding: '10px 14px', textAlign: 'right', verticalAlign: 'top' }}>
                                        <div style={{ fontWeight: 800, fontSize: 13, color: 'var(--text-primary)' }}>
                                          {total.toLocaleString()} piezas
                                        </div>
                                        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                                          <span style={{ color: '#059669', fontWeight: 700 }}>{disp} disp</span>
                                          {res > 0 && <span style={{ color: 'var(--orange)', marginLeft: 4 }}>· {res} res</span>}
                                          {bloq > 0 && <span style={{ color: '#DC2626', marginLeft: 4 }}>· {bloq} bloq</span>}
                                        </div>
                                      </td>
                                      <td style={{ padding: '10px 14px', textAlign: 'center', verticalAlign: 'top' }}>
                                        {(() => {
                                          const isExpired = l.fechaVencimiento && new Date(l.fechaVencimiento) <= new Date();
                                          const hasHigherRestriction = isExpired || bloq > 0;
                                          const qualityValue = l.estadoCalidad || 'LIBERADO';

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
                                                  alignItems: 'center'
                                                }}
                                              >
                                                {qualityValue}
                                              </span>
                                            );
                                          }

                                          return (
                                            <span
                                              title={CALIDAD_TOOLTIP}
                                              className={`badge ${isLiberado ? 'badge-success' : 'badge-danger'}`}
                                              style={{ fontSize: 10, fontWeight: 700 }}
                                            >
                                              {qualityValue}
                                            </span>
                                          );
                                        })()}
                                      </td>
                                      <td style={{ padding: '10px 14px', verticalAlign: 'top' }}>
                                        <div style={{ fontWeight: 700, color: isThisClient ? '#1E40AF' : 'var(--text-primary)', whiteSpace: 'normal', wordBreak: 'break-word' }}>
                                          {l.cliente?.nombreComercial || l.cliente?.razonSocial || '—'}
                                        </div>
                                        {l.notas && (
                                          <div style={{ fontSize: 10.5, color: 'var(--text-tertiary)', marginTop: 3, fontStyle: 'italic', whiteSpace: 'normal', wordBreak: 'break-word' }}>
                                            {l.notas}
                                          </div>
                                        )}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <div style={{ padding: 24, textAlign: 'center', background: 'var(--bg-secondary)', borderRadius: 8, border: '1px dashed var(--border)', color: 'var(--text-tertiary)', fontSize: 12 }}>
                            {filterCliente
                              ? `Esta ubicación no contiene lotes registrados del depositante ${selectedClientName}.`
                              : 'Ubicación 100% libre. No cuenta con saldo de lotes ni reservas activas.'
                            }
                          </div>
                        )}
                      </div>

                      {/* Tabla 2: Unidades de Manejo (HUs) Físicas en Posición */}
                      {displayHus.length > 0 && (
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                            <h4 style={{ fontSize: 13, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                              <Layers size={15} color="var(--primary)" /> Unidades de Manejo (HUs) Físicas en Posición ({displayHus.length})
                            </h4>
                          </div>
                          <div style={{ borderRadius: 8, overflowX: 'auto', border: '1px solid var(--border)', backgroundColor: 'var(--bg-primary)' }}>
                            <table className="data-table" style={{ fontSize: 12, width: '100%', borderCollapse: 'collapse' }}>
                              <thead>
                                <tr style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}>
                                  <th style={{ padding: '10px 14px', textAlign: 'left', minWidth: 150 }}>Código HU</th>
                                  <th style={{ padding: '10px 14px', textAlign: 'left', minWidth: 100 }}>Tipo</th>
                                  <th style={{ padding: '10px 14px', textAlign: 'left', minWidth: 200 }}>Contenido / SKU</th>
                                  <th style={{ padding: '10px 14px', textAlign: 'left', minWidth: 130 }}>Lote</th>
                                  <th style={{ padding: '10px 14px', textAlign: 'right', minWidth: 120 }}>Cantidad</th>
                                  <th style={{ padding: '10px 14px', textAlign: 'center', minWidth: 110 }}>Estado</th>
                                </tr>
                              </thead>
                              <tbody>
                                {displayHus.map((h: any) => (
                                  <tr key={h.id} style={{ borderBottom: '1px solid var(--border)' }}>
                                    <td style={{ padding: '10px 14px', verticalAlign: 'middle' }}>
                                      <span style={{ fontFamily: 'monospace', fontWeight: 800, color: 'var(--primary)', fontSize: 12 }}>
                                        {h.codigo}
                                      </span>
                                    </td>
                                    <td style={{ padding: '10px 14px', verticalAlign: 'middle', textTransform: 'capitalize' }}>
                                      {h.tipoHu?.toLowerCase() || 'caja'}
                                    </td>
                                    <td style={{ padding: '10px 14px', verticalAlign: 'middle', whiteSpace: 'normal', wordBreak: 'break-word' }}>
                                      <div style={{ fontWeight: 700, fontFamily: 'monospace', fontSize: 12 }}>
                                        {h.skuCodigo || h.lote?.sku?.codigo || '—'}
                                      </div>
                                      {h.lote?.sku?.descripcion && (
                                        <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                                          {h.lote.sku.descripcion}
                                        </div>
                                      )}
                                    </td>
                                    <td style={{ padding: '10px 14px', verticalAlign: 'middle' }}>
                                      <span className="badge badge-default" style={{ fontFamily: 'monospace' }}>
                                        {h.loteTexto || h.lote?.lote || '—'}
                                      </span>
                                    </td>
                                    <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 800, verticalAlign: 'middle' }}>
                                      {h.cantidad} piezas
                                    </td>
                                    <td style={{ padding: '10px 14px', textAlign: 'center', verticalAlign: 'middle' }}>
                                      <span className="badge badge-success" style={{ fontSize: 10, fontWeight: 700 }}>
                                        {h.estadoHu || 'ALMACENADA'}
                                      </span>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>

                          {/* Nota de trazabilidad cuando el inventario físico difiere de la cantidad en HU (Punto 4) */}
                          {(() => {
                            const totalPiecesInLots = displayLots.reduce((s: number, l: any) => s + ((l.cantidadDisponible || 0) + (l.cantidadBloqueada || 0)), 0);
                            const totalPiecesInHus = displayHus.reduce((s: number, h: any) => s + Number(h.cantidad || 0), 0);
                            const hasHuDiscrepancy = displayHus.length > 0 && totalPiecesInLots !== totalPiecesInHus;

                            if (!hasHuDiscrepancy) return null;

                            const specificCause = displayHus.find((h: any) => h.motivoDano || h.notas)?.motivoDano || displayHus.find((h: any) => h.notas)?.notas;

                            return (
                              <div style={{
                                marginTop: 10,
                                padding: '8px 12px',
                                borderRadius: 6,
                                backgroundColor: 'rgba(245, 158, 11, 0.08)',
                                border: '1px solid rgba(245, 158, 11, 0.25)',
                                fontSize: 11.5,
                                color: '#B45309',
                                display: 'flex',
                                alignItems: 'flex-start',
                                gap: 8,
                                lineHeight: 1.45
                              }}>
                                <Info size={15} style={{ flexShrink: 0, marginTop: 1 }} />
                                <span>
                                  <strong>Nota de trazabilidad:</strong> El saldo físico actual registrado en inventario ({totalPiecesInLots.toLocaleString()} piezas) difiere de la cantidad registrada en {displayHus.length === 1 ? 'la HU' : 'las HUs'} ({totalPiecesInHus.toLocaleString()} piezas). {specificCause
                                    ? `Causa documentada: ${specificCause}. Se recomienda revisar la trazabilidad de la HU.`
                                    : 'Esta diferencia puede estar asociada a movimientos parciales históricos, ajustes o movimientos realizados sin re-etiquetado/split físico de la unidad de manejo. Se recomienda revisar la trazabilidad de la HU.'
                                  }
                                </span>
                              </div>
                            );
                          })()}
                        </div>
                      )}
                    </>
                  );
                })()
              )}
            </div>

            {/* Pie Fijo del Modal */}
            <div className="modal-footer" style={{
              borderTop: '1px solid var(--border)',
              padding: '14px 24px',
              display: 'flex',
              justifyContent: 'flex-end',
              backgroundColor: 'var(--bg-primary)'
            }}>
              <button className="btn btn-secondary" onClick={() => setSelectedLoc(null)}>
                Cerrar Consulta
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const demoLocations = [
  { id: 'loc-1', codigo: 'REC-01', estado: 'LIBRE', tipoUbicacion: 'RECIBO', categoriaUbicacion: 'RECIBO_TRANSITO', esAlmacenable: false, estadoCapacidad: 'NO_APLICA', zona: { codigo: 'ZONA-REC', nombre: 'Andén de Recibo & Inspección' } },
  { id: 'loc-2', codigo: 'DEV-01', estado: 'LIBRE', tipoUbicacion: 'DEVOLUCION', categoriaUbicacion: 'VIRTUAL_NO_CONFORME', esAlmacenable: false, estadoCapacidad: 'NO_APLICA', zona: { codigo: 'ZONA-REC', nombre: 'Andén de Recibo & Inspección' } },
  { id: 'loc-3', codigo: 'A01-R01-N1', estado: 'OCUPADO', ocupacionUnidades: 40, capacidadUnits: 40, ocupacionBultos: 2, capacidadBultos: 5, tipoUbicacion: 'ESTANTERIA', categoriaUbicacion: 'FISICA_ALMACENABLE', esAlmacenable: true, estadoCapacidad: 'LLENO', pasillo: 'A01', rack: 'R01', nivel: 'N1', zona: { codigo: 'ZONA-ROPA', nombre: 'Zona Almacenaje Ropa (FIFO)' } },
  { id: 'loc-4', codigo: 'A01-R01-N2', estado: 'LIBRE', ocupacionUnidades: 0, capacidadUnits: 40, ocupacionBultos: 0, capacidadBultos: 5, tipoUbicacion: 'ESTANTERIA', categoriaUbicacion: 'FISICA_ALMACENABLE', esAlmacenable: true, estadoCapacidad: 'LIBRE', pasillo: 'A01', rack: 'R01', nivel: 'N2', zona: { codigo: 'ZONA-ROPA', nombre: 'Zona Almacenaje Ropa (FIFO)' } },
  { id: 'loc-5', codigo: 'B01-R01-N1', estado: 'OCUPADO', ocupacionUnidades: 586, capacidadUnits: 40, ocupacionBultos: 4, capacidadBultos: 5, tipoUbicacion: 'RACK', categoriaUbicacion: 'FISICA_ALMACENABLE', esAlmacenable: true, estadoCapacidad: 'SOBRECAPACIDAD', pasillo: 'B01', rack: 'R01', nivel: 'N1', zona: { codigo: 'ZONA-ALIM', nombre: 'Zona Almacenaje Alimentos (FEFO)' } }
];
