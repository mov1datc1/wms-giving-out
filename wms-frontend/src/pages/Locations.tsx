import { useEffect, useState, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { API } from '../config/api';
import {
  MapPin, Search, RefreshCw, Grid3X3, Layers, X,
  Package, Calendar, CheckCircle2, AlertTriangle, ShieldCheck, Box,
  Warehouse, Lock, Eye, Info, Users, UserCheck, ChevronDown, ChevronRight,
  ZoomIn, ZoomOut, Maximize2, Tag, ArrowRightLeft, Sparkles, Archive
} from 'lucide-react';
import { formatCalendarDate } from '../utils/dateUtils';
import {
  REAL_WAREHOUSE_POSITIONS,
  SPATIAL_LANDMARKS,
  WAREHOUSE_CANVAS_DIMENSIONS,
  WarehouseLocationConfig,
  SpatialLandmark
} from '../config/warehouse-layout.config';

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
      return 'Celda / Posición Comercial';
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
  // Vista predeterminada: 1. Plano Físico 2D — Operación (Fase 3B-B)
  const [viewMode, setViewMode] = useState<'spatial' | 'operational' | 'layout'>('spatial');

  // Estados de búsqueda independientes por vista (spatial, operational, layout) — Fase 3B-B Fix
  const [searchByView, setSearchByView] = useState<Record<'spatial' | 'operational' | 'layout', string>>({
    spatial: '',
    operational: '',
    layout: '',
  });
  const search = searchByView[viewMode];
  const setSearch = (val: string) => {
    setSearchByView(prev => ({ ...prev, [viewMode]: val }));
  };
  
  // Filtros principales
  const [filterCliente, setFilterCliente] = useState<string>('');
  const [clientViewMode, setClientViewMode] = useState<'existencia' | 'compatibles' | 'todas'>('existencia');
  const [filterZona, setFilterZona] = useState('');
  const [filterPasillo, setFilterPasillo] = useState('');
  const [filterEstado, setFilterEstado] = useState('');

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

  // ==========================================================================
  // MODELO DE CAPACIDAD Y MÉTRICAS DEL ALMACÉN REAL (G0001–G0045) — FASE 3B-B
  // ==========================================================================
  // Posiciones físicas oficiales del almacén real
  const realWarehouseLocs = useMemo(() => {
    return locations.filter((l: any) => l.codigo && l.codigo.toUpperCase().startsWith('G'));
  }, [locations]);

  const totalPosicionesFisicas = 45;
  const capacidadTarimasTotal = 45;

  // Conteo de tarimas físicas alojadas (ocupación física 1/1 por posición de tarima)
  // Cada posición con ocupación (bultos >= 1 o unidades > 0) cuenta como exactamente 1 tarima alojada
  const tarimasAlojadas = realWarehouseLocs.filter((l: any) => {
    return (typeof l.ocupacionBultos === 'number' && l.ocupacionBultos >= 1) ||
           (typeof l.ocupacionUnidades === 'number' && l.ocupacionUnidades > 0) ||
           l.estadoCapacidad === 'LLENO';
  }).length;

  // Posiciones comerciales ocupadas
  const ocupadasComerciales = realWarehouseLocs.filter((l: any) => {
    const isPnc = l.tipoUbicacion === 'PNC' || l.categoriaUbicacion === 'VIRTUAL_NO_CONFORME';
    const isOcc = (typeof l.ocupacionBultos === 'number' && l.ocupacionBultos >= 1) ||
                  (typeof l.ocupacionUnidades === 'number' && l.ocupacionUnidades > 0) ||
                  l.estadoCapacidad === 'LLENO';
    return !isPnc && isOcc;
  }).length;

  // Posiciones PNC designadas
  const pncDesignadas = realWarehouseLocs.filter((l: any) => {
    return l.tipoUbicacion === 'PNC' || l.categoriaUbicacion === 'VIRTUAL_NO_CONFORME';
  }).length || REAL_WAREHOUSE_POSITIONS.filter(p => p.esPncSugerido).length;

  // Posiciones físicas libres (capacidad física disponible = 1 tarima)
  // Las posiciones PNC vacías son físicamente libres pero reservadas operativamente para no conforme
  const posicionesLibres = Math.max(0, totalPosicionesFisicas - tarimasAlojadas);
  const comercialesLibres = Math.max(0, (totalPosicionesFisicas - pncDesignadas) - ocupadasComerciales);

  // Porcentaje de ocupación física real: tarimasAlojadas / 45 * 100%
  const pctOcupacionFisica = totalPosicionesFisicas > 0 ? Math.round((tarimasAlojadas / totalPosicionesFisicas) * 100) : 0;

  // Separación nítida de ubicaciones físicas de almacenamiento vs. ubicaciones especiales
  // Las 45 posiciones físicas G (incluyendo las designadas para PNC) pertenecen exclusivamente al almacén físico
  // Las 6 áreas especiales corresponden estrictamente a maniobra: REC-01, REC-02, STG-01, STG-02, DEV-01, NC-EXCESO-01
  const isPhysicalWarehousePos = (l: any) => l.codigo && l.codigo.toUpperCase().startsWith('G');
  const almacenableLocs = filtered.filter(l => isPhysicalWarehousePos(l) || (l.esAlmacenable !== false && l.categoriaUbicacion === 'FISICA_ALMACENABLE'));
  const specialLocs = filtered.filter(l => !isPhysicalWarehousePos(l) && (l.esAlmacenable === false || l.categoriaUbicacion !== 'FISICA_ALMACENABLE'));

  // Conteo estructural fijo de áreas especiales de maniobra (Catálogo canónico: REC-01, REC-02, STG-01, STG-02, DEV-01, NC-EXCESO-01)
  // No cambia ante búsquedas ni cambios de tab
  const totalSpecialLocsCount = useMemo(() => {
    const canonicalSpecialCodes = new Set(['REC-01', 'REC-02', 'STG-01', 'STG-02', 'DEV-01', 'NC-EXCESO-01']);
    const count = locations.filter((l: any) => {
      const c = (l.codigo || '').toUpperCase();
      return l.activo !== false && (
        canonicalSpecialCodes.has(c) ||
        (!c.startsWith('G') && !c.startsWith('A') && !c.startsWith('B') && (l.esAlmacenable === false || l.categoriaUbicacion !== 'FISICA_ALMACENABLE'))
      );
    }).length;
    return count > 0 ? count : 6;
  }, [locations]);

  // ==========================================================================
  // DATASET EXCLUSIVO PARA HISTÓRICO — RACKS ANTERIORES (Axx/Bxx)
  // ==========================================================================
  // Regla estricta: Solo entran celdas con activo = false y código Axx o Bxx (exactamente 48)
  // NINGUNA posición G0001–G0045 ni área especial puede ingresar a este conjunto
  const isHistoricalRackLoc = (l: any) => {
    const code = (l.codigo || '').toUpperCase();
    const isAB = code.startsWith('A') || code.startsWith('B');
    return l.activo === false && isAB;
  };

  const historicalLocs = useMemo(() => {
    return locations.filter(isHistoricalRackLoc);
  }, [locations]);

  const filteredHistoricalLocs = useMemo(() => {
    const q = (searchByView.layout || '').toLowerCase().trim();
    return historicalLocs.filter(l => {
      if (!q) return true;
      return (
        l.codigo?.toLowerCase().includes(q) ||
        l.pasillo?.toLowerCase().includes(q) ||
        l.rack?.toLowerCase().includes(q) ||
        l.nivel?.toLowerCase().includes(q) ||
        l.zona?.nombre?.toLowerCase().includes(q)
      );
    });
  }, [historicalLocs, searchByView.layout]);

  const historicalHierarchy = useMemo(() => {
    const hier: Record<string, HierarchyZona> = {};
    for (const loc of filteredHistoricalLocs) {
      const zKey = loc.zona?.codigo || loc.zonaId || 'ZONA_HISTORICA';
      const zNombre = loc.zona?.nombre || 'Almacenamiento Histórico';
      const pKey = loc.pasillo || 'P01';
      const rKey = loc.rack || 'R01';
      const nKey = loc.nivel || 'N1';

      if (!hier[zKey]) {
        hier[zKey] = {
          zonaNombre: zNombre,
          zonaCodigo: zKey,
          pasillos: {}
        };
      }
      if (!hier[zKey].pasillos[pKey]) {
        hier[zKey].pasillos[pKey] = {
          pasilloCodigo: pKey,
          racks: {}
        };
      }
      if (!hier[zKey].pasillos[pKey].racks[rKey]) {
        hier[zKey].pasillos[pKey].racks[rKey] = {
          rackCodigo: rKey,
          totalPiezas: 0,
          capacidadPiezas: 0,
          totalBultos: 0,
          capacidadBultos: 0,
          niveles: {}
        };
      }
      const rackObj = hier[zKey].pasillos[pKey].racks[rKey];
      rackObj.totalPiezas += (loc.ocupacionUnidades || 0);
      rackObj.capacidadPiezas += (loc.capacidadUnits || 100);
      rackObj.totalBultos += (loc.ocupacionBultos || 0);
      rackObj.capacidadBultos += (loc.capacidadBultos || 1);

      if (!rackObj.niveles[nKey]) {
        rackObj.niveles[nKey] = [];
      }
      rackObj.niveles[nKey].push(loc);
    }
    return hier;
  }, [filteredHistoricalLocs]);

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

  // Ordenamiento canónico de zonas para Fase 3B-B:
  // 1. Zonas operativas reales: Área Interior (35) y Exterior Techado (10)
  // 2. Zonas especiales de maniobra: Recibo (2), Staging (2), Devolución/Merma (2)
  // 3. Zonas históricas inactivas: ALM-A (36), ALM-B (12)
  const sortedZoneEntries = useMemo(() => {
    return Object.entries(byZone).sort(([aName, aLocs], [bName, bLocs]) => {
      const getPriority = (name: string, locs: any[]) => {
        const u = name.toUpperCase();
        if (u.includes('INTERIOR')) return 1;
        if (u.includes('EXTERIOR')) return 2;
        if (u.includes('RECIBO')) return 10;
        if (u.includes('STAGING')) return 11;
        if (u.includes('DEVOLUCI') || u.includes('MERMA') || u.includes('RETENCI')) return 12;
        if (u.includes('ALM-A') || u.includes('TEXTIL')) return 20;
        if (u.includes('ALM-B') || u.includes('ALIMENTO')) return 21;
        return 15;
      };
      return getPriority(aName, aLocs) - getPriority(bName, bLocs);
    });
  }, [byZone]);

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
              : `Almacén Físico Oficial: 45 posiciones de tarima en piso · 35 Interior · 10 Exterior Techado · 3 designadas PNC · ${totalSpecialLocsCount} áreas especiales de maniobra`
            }
          </p>
        </div>

        {/* Selector de Vistas: 1. Plano Físico 2D (Default) -> 2. Vista por Zonas -> 3. Histórico Racks */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="btn-group" style={{ background: 'var(--bg-secondary)', padding: 3, borderRadius: 8, border: '1px solid var(--border)' }}>
            <button
              type="button"
              className={`btn btn-sm ${viewMode === 'spatial' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setViewMode('spatial')}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 700 }}
              title="Plano arquitectónico interactivo de las 45 posiciones físicas oficiales en piso"
            >
              <MapPin size={15} /> Plano Físico 2D — Operación
            </button>
            <button
              type="button"
              className={`btn btn-sm ${viewMode === 'operational' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setViewMode('operational')}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 700 }}
              title="Distribución operativa agrupada por Área Interior y Exterior Techado"
            >
              <Grid3X3 size={15} /> Vista por Zonas
            </button>
            <button
              type="button"
              className={`btn btn-sm ${viewMode === 'layout' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setViewMode('layout')}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 700 }}
              title="Ubicaciones históricas en racks Axx/Bxx (conservadas solo para consulta y auditoría)"
            >
              <Archive size={15} /> Histórico — Racks anteriores
            </button>
          </div>
          <button className="btn btn-secondary" onClick={loadData}>
            <RefreshCw size={15} /> Actualizar
          </button>
        </div>
      </div>

      {/* Franja Ejecutiva de Capacidad y Estado: Métricas Exclusivas de G0001–G0045 */}
      {!filterCliente ? (
        /* ===== KPIs OFICIALES DEL ALMACÉN REAL (G0001–G0045) ===== */
        <div className="stats-grid" style={{ marginBottom: 16 }}>
          {/* Card 1: Posiciones Físicas */}
          <div className="stat-card" style={{ borderColor: 'rgba(13, 148, 136, 0.3)' }}>
            <div className="stat-icon" style={{ background: 'var(--teal-bg)', color: 'var(--teal)' }}>
              <Warehouse size={22}/>
            </div>
            <div className="stat-info">
              <span className="stat-value">{totalPosicionesFisicas}</span>
              <span className="stat-label">Posiciones físicas en piso</span>
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>
                Capacidad total: {capacidadTarimasTotal} tarimas
              </span>
            </div>
          </div>

          {/* Card 2: Posiciones Libres */}
          <div className="stat-card" style={{ borderColor: 'rgba(16, 185, 129, 0.3)' }}>
            <div className="stat-icon" style={{ background: 'rgba(16, 185, 129, 0.15)', color: 'var(--emerald)' }}>
              <CheckCircle2 size={22}/>
            </div>
            <div className="stat-info">
              <span className="stat-value" style={{ color: 'var(--emerald)' }}>{posicionesLibres}</span>
              <span className="stat-label">Posiciones libres ({posicionesLibres}/45)</span>
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>
                {comercialesLibres} comerciales · {pncDesignadas} PNC vacías
              </span>
            </div>
          </div>

          {/* Card 3: Tarimas Alojadas */}
          <div className="stat-card" style={{ borderColor: 'rgba(2, 132, 199, 0.3)' }}>
            <div className="stat-icon" style={{ background: 'rgba(2, 132, 199, 0.15)', color: '#0284C7' }}>
              <Box size={22}/>
            </div>
            <div className="stat-info">
              <span className="stat-value">{tarimasAlojadas}</span>
              <span className="stat-label">Tarimas físicas alojadas</span>
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>
                Ocupadas comerciales: {ocupadasComerciales}
              </span>
            </div>
          </div>

          {/* Card 4: Designadas PNC */}
          <div className="stat-card" style={{ borderColor: 'rgba(239, 68, 68, 0.3)' }}>
            <div className="stat-icon" style={{ background: 'rgba(239, 68, 68, 0.12)', color: '#DC2626' }}>
              <AlertTriangle size={22}/>
            </div>
            <div className="stat-info">
              <span className="stat-value" style={{ color: '#DC2626' }}>{pncDesignadas}</span>
              <span className="stat-label">Posiciones designadas PNC</span>
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>
                G0036, G0041, G0042 (Ext. Techado)
              </span>
            </div>
          </div>

          {/* Card 5: Ocupación Física Real */}
          <div className="stat-card" style={{ borderColor: 'rgba(99, 102, 241, 0.3)' }}>
            <div className="stat-icon" style={{ background: 'rgba(99, 102, 241, 0.15)', color: '#6366F1' }}>
              <Layers size={22}/>
            </div>
            <div className="stat-info">
              <span className="stat-value" style={{ color: '#6366F1' }}>{pctOcupacionFisica}%</span>
              <span className="stat-label">Ocupación física real</span>
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>
                {tarimasAlojadas} de {capacidadTarimasTotal} tarimas estibadas
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
                placeholder={
                  viewMode === 'spatial'
                    ? "Buscar en plano 2D (ej. G0001, Interior, PNC)..."
                    : viewMode === 'layout'
                    ? "Buscar en histórico de racks (ej. A01, B01-R01-N1), pasillo o nivel..."
                    : "Buscar código (ej. G0001), zona o estado…"
                }
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
      ) : viewMode === 'spatial' ? (
        /* ========================================================
           VISTA 3: PLANO FÍSICO 2D INTERACTIVO (FASE 3A)
           Renderizado fiel de las 45 posiciones físicas de tarima
           derivadas del plano arquitectónico confirmado por Alejandra
           ======================================================== */
        <PhysicalWarehouseMap
          locations={locations}
          specialLocs={specialLocs}
          filterCliente={filterCliente}
          selectedClientName={selectedClientName}
          searchTerm={searchByView.spatial}
          onRefresh={loadData}
        />
      ) : viewMode === 'layout' ? (
        /* ========================================================
           VISTA HISTÓRICA: RACKS ANTERIORES (SOLO CONSULTA / TRAZABILIDAD)
           ======================================================== */
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Banner Informativo de Trazabilidad Histórica */}
          <div style={{
            padding: '16px 20px',
            borderRadius: 12,
            backgroundColor: '#FFFBEB',
            border: '1px solid #FCD34D',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 14,
            boxShadow: '0 2px 4px rgba(0,0,0,0.02)'
          }}>
            <div style={{ color: '#D97706', marginTop: 2, flexShrink: 0 }}>
              <AlertTriangle size={24} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <h4 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: '#92400E' }}>
                  Ubicaciones históricas del modelo anterior (Racks Axx/Bxx) — Solo Trazabilidad y Consulta
                </h4>
                <span style={{
                  fontSize: 11,
                  fontWeight: 800,
                  padding: '2px 8px',
                  borderRadius: 6,
                  backgroundColor: '#FEE2E2',
                  color: '#991B1B',
                  border: '1px solid #FCA5A5'
                }}>
                  100% Inactivas en BD
                </span>
              </div>
              <p style={{ margin: '6px 0 0', fontSize: 13, color: '#78350F', lineHeight: 1.5 }}>
                Estas 48 celdas de estantería pertenecieron al modelo previo de desarrollo y demostraciones y se encuentran <strong>completamente inactivas</strong> (<code>activo = false, estado = LIBRE</code>). Se conservan en base de datos para preservar la trazabilidad documental histórica sin eliminar referencias.
              </p>
              <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12, color: '#92400E', lineHeight: 1.6 }}>
                <li><strong>No representan el almacén físico actual:</strong> La operación real se realiza en nave abierta sin racks elevados.</li>
                <li><strong>Excluidas de algoritmos WMS:</strong> No participan en el motor de alojamiento (Putaway), surtido (Picking), ni en rotación FEFO/FIFO.</li>
                <li><strong>Operación activa:</strong> Toda la estiba y surtido se gestiona en las <strong>45 posiciones físicas oficiales de tarima en piso (G0001–G0045)</strong> en la pestaña <em>Plano Físico 2D</em>.</li>
              </ul>
            </div>
          </div>
          {Object.entries(historicalHierarchy).map(([zonaKey, zData]) => (
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
                                        {/* Indicador de Nivel Histórico */}
                                        <div style={{
                                          width: 78,
                                          minWidth: 78,
                                          borderRadius: 6,
                                          display: 'flex',
                                          flexDirection: 'column',
                                          alignItems: 'center',
                                          justifyContent: 'center',
                                          padding: '4px 2px',
                                          backgroundColor: '#F1F5F9',
                                          color: '#64748B',
                                          border: '1px solid #CBD5E1',
                                          flexShrink: 0,
                                          textAlign: 'center'
                                        }} title={`Nivel previo: ${nivelInfo.code} (${nivelInfo.role}) — Conservado para consulta y auditoría`}>
                                          <span style={{ fontSize: 11, fontWeight: 800, color: '#334155' }}>{nivelInfo.code}</span>
                                          <span style={{ fontSize: 8.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.02em', color: '#64748B' }}>
                                            HISTÓRICO
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

                                            // En este tab histórico, atenuar visualmente las celdas y reemplazar el verde "LIBRE" por "INACTIVO"
                                            let cellBorder = '1px solid #CBD5E1';
                                            let cellBg = '#F8FAFC';
                                            let badgeBg = '#E2E8F0';
                                            let badgeText = 'INACTIVO';
                                            let badgeColor = '#475569';

                                            if (isOver) {
                                              cellBorder = '2px solid #EF4444';
                                              cellBg = 'rgba(239, 68, 68, 0.08)';
                                              badgeBg = '#DC2626';
                                              badgeText = 'SOBRECAP.';
                                              badgeColor = '#FFFFFF';
                                            } else if (isBlock) {
                                              cellBorder = '1px solid rgba(148, 163, 184, 0.5)';
                                              cellBg = 'rgba(148, 163, 184, 0.1)';
                                              badgeBg = '#64748B';
                                              badgeText = 'BLOQUEADO';
                                              badgeColor = '#FFFFFF';
                                            } else if (filterCliente && isClientHoldingStock) {
                                              cellBorder = '2px solid #2563EB';
                                              cellBg = 'rgba(37, 99, 235, 0.06)';
                                              badgeBg = isFull ? '#EF4444' : isPart ? '#D97706' : '#2563EB';
                                              badgeText = loc.estadoCapacidad;
                                              badgeColor = '#FFFFFF';
                                            } else if (filterCliente && isComp && !isClientHoldingStock) {
                                              cellBorder = '1.5px dashed #94A3B8';
                                              cellBg = '#F1F5F9';
                                              badgeBg = '#E2E8F0';
                                              badgeText = 'INACTIVO';
                                              badgeColor = '#64748B';
                                            }

                                            const hasLocBultos = typeof loc.capacidadBultos === 'number' && loc.capacidadBultos > 0;
                                            const tooltipText = isOver
                                              ? `Celda histórica ${loc.codigo} · ¡SOBRECAPACIDAD! (${loc.ocupacionUnidades}/${loc.capacidadUnits} piezas)`
                                              : `Celda histórica ${loc.codigo} · Inactiva en BD · Conservada para trazabilidad y auditoría (${loc.ocupacionUnidades || 0} de ${loc.capacidadUnits} piezas configuradas)`;

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
                                                  minHeight: 64,
                                                  opacity: 0.82
                                                }}
                                              >
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                  <span style={{ fontSize: 11, fontWeight: 800, color: '#334155' }}>
                                                    {loc.codigo}
                                                  </span>
                                                  <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                                                    <span style={{
                                                      fontSize: 8,
                                                      fontWeight: 800,
                                                      padding: '1px 4px',
                                                      borderRadius: 3,
                                                      backgroundColor: '#FEF3C7',
                                                      color: '#92400E',
                                                      border: '1px solid #FCD34D'
                                                    }}>
                                                      HISTÓRICO
                                                    </span>
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
                                                <div style={{ fontSize: 10, fontWeight: 600, color: '#64748B', marginTop: 2 }}>
                                                  {filterCliente && isClientHoldingStock ? (
                                                    <span style={{ color: '#1E40AF' }}>
                                                      {clientStats?.pieces} pzs de {selectedClientName}
                                                    </span>
                                                  ) : isFree ? (
                                                    <span>0 piezas · Sin saldo</span>
                                                  ) : (
                                                    <span>{loc.ocupacionUnidades ?? 0} <span style={{ color: 'var(--text-secondary)', fontWeight: 400 }}>de {loc.capacidadUnits} piezas</span></span>
                                                  )}
                                                </div>

                                                {/* Bultos e indicador de estatus inactivo */}
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                                                  <span style={{ fontSize: 9.5, color: '#94A3B8' }}>
                                                    {filterCliente && isClientHoldingStock
                                                      ? `${clientStats?.bultos || 0} bultos`
                                                      : 'Rack inactivo'
                                                    }
                                                  </span>
                                                  <span style={{
                                                    fontSize: 8.5,
                                                    fontWeight: 800,
                                                    padding: '1px 5px',
                                                    borderRadius: 3,
                                                    backgroundColor: badgeBg,
                                                    color: badgeColor,
                                                    border: '1px solid #CBD5E1'
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

          {filteredHistoricalLocs.length === 0 && (
            <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>
              No se encontraron celdas de rack históricas con la búsqueda seleccionada.
            </div>
          )}


        </div>
      ) : (
        /* ========================================================
           VISTA 2: VISTA POR ZONAS
           ======================================================== */
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {sortedZoneEntries.map(([zoneName, locs]) => {
            const znUpper = zoneName.toUpperCase();
            const isPrincipal = znUpper.includes('INTERIOR') || znUpper.includes('EXTERIOR');
            const isHistorical = znUpper.includes('ALM-A') || znUpper.includes('ALM-B') || znUpper.includes('TEXTIL') || znUpper.includes('ALIMENTO');
            const isSpecial = znUpper.includes('RECIBO') || znUpper.includes('STAGING') || znUpper.includes('DEVOLUCI') || znUpper.includes('MERMA');

            return (
              <div
                key={zoneName}
                className="card animate-fade-in"
                style={{
                  marginBottom: 16,
                  border: isPrincipal
                    ? '1.5px solid #86EFAC'
                    : isHistorical
                    ? '1px dashed #FCD34D'
                    : '1px solid var(--border)',
                  opacity: isHistorical ? 0.88 : 1
                }}
              >
                <div className="card-header" style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  backgroundColor: isPrincipal ? '#F0FDF4' : isHistorical ? '#FFFBEB' : 'var(--bg-secondary)',
                  padding: '12px 18px'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <MapPin size={18} color={isPrincipal ? '#16A34A' : isHistorical ? '#D97706' : '#2563EB'} />
                    <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: isPrincipal ? '#166534' : isHistorical ? '#92400E' : 'var(--text-primary)' }}>
                      {zoneName}
                    </h3>
                    <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-tertiary)' }}>
                      ({locs.length} posiciones)
                    </span>
                  </div>

                  <div>
                    {isPrincipal && (
                      <span style={{
                        fontSize: 11,
                        fontWeight: 800,
                        padding: '3px 10px',
                        borderRadius: 6,
                        backgroundColor: '#DCFCE7',
                        color: '#166534',
                        border: '1px solid #86EFAC'
                      }}>
                        Almacén Operativo Principal
                      </span>
                    )}
                    {isSpecial && (
                      <span style={{
                        fontSize: 11,
                        fontWeight: 700,
                        padding: '3px 10px',
                        borderRadius: 6,
                        backgroundColor: '#EFF6FF',
                        color: '#1E40AF',
                        border: '1px solid #BFDBFE'
                      }}>
                        Áreas Especiales y Maniobra
                      </span>
                    )}
                    {isHistorical && (
                      <span style={{
                        fontSize: 11,
                        fontWeight: 800,
                        padding: '3px 10px',
                        borderRadius: 6,
                        backgroundColor: '#FEE2E2',
                        color: '#991B1B',
                        border: '1px solid #FCA5A5'
                      }}>
                        Histórico · Racks Inactivos
                      </span>
                    )}
                  </div>
                </div>

                {isHistorical && (
                  <div style={{
                    padding: '8px 18px',
                    backgroundColor: '#FEF3C7',
                    borderBottom: '1px solid #FCD34D',
                    fontSize: 11,
                    color: '#92400E',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6
                  }}>
                    <AlertTriangle size={14} color="#D97706" />
                    <span>Racks inactivos (activo = false) conservados únicamente para trazabilidad documental. No participan en alojamiento ni surtido.</span>
                  </div>
                )}

                <div style={{ padding: '16px 20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
                  {locs.map((loc: any) => {
                    const isBlocked = loc.estado === 'BLOQUEADO' || loc.estadoCapacidad === 'BLOQUEADO';
                    const isOver = loc.estadoCapacidad === 'SOBRECAPACIDAD';
                    const isFull = loc.estadoCapacidad === 'LLENO';
                    const isPartial = loc.estadoCapacidad === 'PARCIAL';
                    const isFree = loc.estadoCapacidad === 'LIBRE' || (!loc.ocupacionBultos && !loc.ocupacionUnidades);
                    const isPnc = loc.tipoUbicacion === 'PNC' || loc.categoriaUbicacion === 'VIRTUAL_NO_CONFORME';
                    const isFloorPallet = loc.codigo && loc.codigo.toUpperCase().startsWith('G');
                    const isInactive = loc.activo === false;

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
                          position: 'relative',
                          border: isOver
                            ? '2px solid #EF4444'
                            : filterCliente && isClientHoldingStock
                            ? '2px solid #2563EB'
                            : isPnc
                            ? '1.5px solid #FCA5A5'
                            : isFull
                            ? '1px solid rgba(239,68,68,0.4)'
                            : isPartial
                            ? '1px solid rgba(245,158,11,0.4)'
                            : isBlocked || isInactive
                            ? '1px solid rgba(148,163,184,0.4)'
                            : '1px solid rgba(16,185,129,0.3)',
                          transition: 'all 0.2s',
                          background: isOver
                            ? 'rgba(239,68,68,0.12)'
                            : filterCliente && isClientHoldingStock
                            ? 'rgba(37,99,235,0.1)'
                            : isPnc
                            ? '#FEF2F2'
                            : isFull
                            ? 'rgba(239,68,68,0.08)'
                            : isPartial
                            ? 'rgba(245,158,11,0.08)'
                            : isBlocked || isInactive
                            ? '#F8FAFC'
                            : 'rgba(16,185,129,0.08)',
                          color: isOver || isFull
                            ? '#DC2626'
                            : filterCliente && isClientHoldingStock
                            ? '#1E40AF'
                            : isPartial
                            ? '#D97706'
                            : isBlocked || isInactive
                            ? '#64748B'
                            : '#059669',
                          opacity: isInactive ? 0.75 : 1
                        }}
                      >
                        {isPnc && (
                          <div style={{
                            position: 'absolute',
                            top: 4,
                            right: 4,
                            fontSize: 9,
                            fontWeight: 800,
                            padding: '1px 4px',
                            borderRadius: 3,
                            backgroundColor: '#FEE2E2',
                            color: '#991B1B',
                            border: '1px solid #FCA5A5'
                          }}>
                            PNC
                          </div>
                        )}
                        <div style={{ fontSize: 13, fontWeight: 700, color: isInactive ? '#64748B' : 'inherit' }}>
                          {loc.codigo}
                        </div>
                        <div style={{ fontSize: 11, fontWeight: 600, marginTop: 4, color: 'var(--text-primary)' }}>
                          {filterCliente && isClientHoldingStock ? (
                            <span style={{ color: '#1E40AF' }}>{clientStats?.pieces} piezas</span>
                          ) : isFloorPallet ? (
                            isFree ? (
                              <span style={{ color: '#059669' }}>Libre (1 tarima)</span>
                            ) : (
                              <span>{loc.ocupacionBultos || 1}/1 tarima</span>
                            )
                          ) : isFree ? (
                            <span style={{ color: '#059669' }}>Libre</span>
                          ) : (
                            <span>{loc.ocupacionUnidades ?? 0} piezas</span>
                          )}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 2 }}>
                          {isFloorPallet ? (
                            <span>Cap: 1 tarima</span>
                          ) : isInactive ? (
                            <span style={{ color: '#94A3B8' }}>Inactivo · Trazabilidad</span>
                          ) : filterCliente && isClientHoldingStock ? (
                            `${clientStats?.bultos} ${clientStats?.bultos === 1 ? 'bulto' : 'bultos'}`
                          ) : (
                            `${loc.ocupacionBultos ?? 0} ${(loc.ocupacionBultos ?? 0) === 1 ? 'bulto' : 'bultos'}`
                          )}
                        </div>
                        <div style={{ fontSize: 9.5, fontWeight: 700, marginTop: 4 }}>
                          {isInactive ? 'INACTIVO' : loc.estadoCapacidad === 'NO_APLICA' ? 'Especial' : loc.estadoCapacidad}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

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

// ============================================================================
// PLANO FÍSICO 2D INTERACTIVO (FASE 3A DE ADAPTACIÓN AL ALMACÉN REAL)
// ============================================================================
// Renderizado interactivo fiel de las 45 posiciones físicas de tarima derivadas
// del plano arquitectónico compartido por Alejandra y verificado pixel a pixel.
//
// Reglas de negocio confirmadas por Alejandra:
//  1. Cada espacio dibujado en el plano = 1 ubicación física independiente.
//  2. Capacidad física estricta = exactamente UNA sola tarima (capacidadBultos = 1).
//  3. Nomenclatura consecutiva G0001 a G0045.
//  4. Sin restricciones de producto por zona.
//  5. Reserva es virtual (LotInventory.cantidadReservada) y NO tipo de ubicación.
//  6. Exterior Techado se usa operativamente para PNC (posiciones G0036+ dinámicas).
// ============================================================================
interface SpatialMapProps {
  locations: any[];
  specialLocs: any[];
  filterCliente?: string;
  selectedClientName?: string;
  searchTerm?: string;
  onRefresh?: () => void;
}

function PhysicalWarehouseMap({
  locations,
  specialLocs,
  filterCliente,
  selectedClientName,
  searchTerm,
  onRefresh
}: SpatialMapProps) {
  const [selectedPosition, setSelectedPosition] = useState<WarehouseLocationConfig | null>(null);
  const [filterMode, setFilterMode] = useState<'ALL' | 'INTERIOR' | 'EXTERIOR_TECHADO' | 'PNC'>('ALL');
  const [zoomScale, setZoomScale] = useState<number>(1);
  const [hoveredCode, setHoveredCode] = useState<string | null>(null);
  const [isTogglingPnc, setIsTogglingPnc] = useState<boolean>(false);
  const [actionFeedback, setActionFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Mapeo indexado de ubicaciones de BD por código
  const locationsByCode = useMemo(() => {
    const map = new Map<string, any>();
    for (const loc of locations) {
      if (loc.codigo) map.set(loc.codigo.toUpperCase(), loc);
    }
    return map;
  }, [locations]);

  // Posición seleccionada en BD si existe
  const selectedLiveLocation = useMemo(() => {
    if (!selectedPosition) return null;
    return locationsByCode.get(selectedPosition.codigo.toUpperCase()) || null;
  }, [selectedPosition, locationsByCode]);

  // Conteo dinámico de métricas para las 45 posiciones oficiales (Fase 3B-B)
  const stats = useMemo(() => {
    let ocupadas = 0;
    let libres = 0;
    let pncCount = 0;
    let enBdCount = 0;

    for (const pos of REAL_WAREHOUSE_POSITIONS) {
      const live = locationsByCode.get(pos.codigo.toUpperCase());
      if (live) {
        enBdCount++;
        const isOccupied = (typeof live.ocupacionBultos === 'number' && live.ocupacionBultos >= 1) ||
                           (typeof live.ocupacionUnidades === 'number' && live.ocupacionUnidades > 0) ||
                           live.estadoCapacidad === 'LLENO';
        const isPnc = live.tipoUbicacion === 'PNC' || live.categoriaUbicacion === 'VIRTUAL_NO_CONFORME';
        if (isPnc) pncCount++;
        if (isOccupied) ocupadas++;
        else libres++;
      } else {
        if (pos.esPncSugerido) pncCount++;
        libres++;
      }
    }

    return {
      total: REAL_WAREHOUSE_POSITIONS.length,
      interior: REAL_WAREHOUSE_POSITIONS.filter(p => p.areaFisica === 'INTERIOR').length,
      exterior: REAL_WAREHOUSE_POSITIONS.filter(p => p.areaFisica === 'EXTERIOR_TECHADO').length,
      pncSugerido: pncCount,
      ocupadas,
      libres,
      pncCount,
      enBdCount
    };
  }, [locationsByCode]);

  // Alternar designación PNC de una ubicación si ya está registrada en BD
  const handleTogglePncDesignation = async (locId: string, currentIsPnc: boolean) => {
    setIsTogglingPnc(true);
    setActionFeedback(null);
    try {
      const token = localStorage.getItem('token') || '';
      const res = await fetch(`${API}/locations/${locId}/pnc-designation`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          usoPnc: !currentIsPnc,
          motivo: currentIsPnc ? 'Restitución a Almacenamiento Comercial' : 'Designación de posición para PNC/Merma',
          usuario: 'supervisor'
        })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Error al cambiar designación operativa');
      }
      setActionFeedback({
        type: 'success',
        message: data.message || 'Designación operativa actualizada exitosamente'
      });
      if (onRefresh) onRefresh();
    } catch (err: any) {
      setActionFeedback({
        type: 'error',
        message: err.message || 'Error al alternar designación PNC'
      });
    } finally {
      setIsTogglingPnc(false);
    }
  };

  return (
    <div className="card animate-fade-in" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Barra de Encabezado y Métricas Arquitectónicas */}
      <div style={{
        padding: '16px 20px',
        borderRadius: 12,
        backgroundColor: 'rgba(37, 99, 235, 0.04)',
        border: '1px solid rgba(37, 99, 235, 0.2)',
        display: 'flex',
        flexDirection: 'column',
        gap: 14
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 42,
              height: 42,
              borderRadius: 10,
              backgroundColor: '#1E40AF',
              color: '#FFFFFF',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 6px -1px rgba(30, 64, 175, 0.2)'
            }}>
              <Warehouse size={24} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#1E3A8A' }}>
                  Plano Físico Real del Almacén — 45 Posiciones Físicas de Tarima
                </h3>
                <span style={{
                  fontSize: 11,
                  fontWeight: 800,
                  padding: '2px 8px',
                  borderRadius: 6,
                  backgroundColor: '#DCFCE7',
                  color: '#166534',
                  border: '1px solid #86EFAC'
                }}>
                  Fase 3B · Almacén Operativo Real
                </span>
              </div>
              <p style={{ margin: '4px 0 0', fontSize: 13, color: '#475569' }}>
                Fuente de verdad arquitectónica confirmada por Alejandra · <strong>Capacidad canónica: 1 Tarima por Posición</strong> · Acceso directo a nivel de suelo
              </p>
            </div>
          </div>

          {/* Controles de Zoom */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, backgroundColor: '#FFFFFF', padding: 4, borderRadius: 8, border: '1px solid var(--border)' }}>
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => setZoomScale(z => Math.max(0.7, Number((z - 0.1).toFixed(2))))}
              title="Alejar mapa"
              style={{ padding: '4px 8px' }}
            >
              <ZoomOut size={14} />
            </button>
            <span style={{ fontSize: 11, fontWeight: 700, minWidth: 42, textAlign: 'center', color: '#1E293B' }}>
              {Math.round(zoomScale * 100)}%
            </span>
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => setZoomScale(z => Math.min(1.5, Number((z + 0.1).toFixed(2))))}
              title="Acercar mapa"
              style={{ padding: '4px 8px' }}
            >
              <ZoomIn size={14} />
            </button>
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => setZoomScale(1)}
              title="Restablecer escala al 100%"
              style={{ padding: '4px 8px', fontSize: 11 }}
            >
              100%
            </button>
          </div>
        </div>

        {/* Chips de Resumen Operativo */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ padding: '6px 12px', borderRadius: 8, backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', fontSize: 12 }}>
            <span style={{ color: '#64748B' }}>Total Posiciones:</span> <strong style={{ color: '#0F172A' }}>{stats.total} tarimas</strong>
          </div>
          <div style={{ padding: '6px 12px', borderRadius: 8, backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', fontSize: 12 }}>
            <span style={{ color: '#64748B' }}>Área Interior:</span> <strong style={{ color: '#1D4ED8' }}>{stats.interior} (G0001–G0035)</strong>
          </div>
          <div style={{ padding: '6px 12px', borderRadius: 8, backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', fontSize: 12 }}>
            <span style={{ color: '#64748B' }}>Exterior Techado:</span> <strong style={{ color: '#0D9488' }}>{stats.exterior} (G0036–G0045)</strong>
          </div>
          <div style={{ padding: '6px 12px', borderRadius: 8, backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', fontSize: 12 }}>
            <span style={{ color: '#64748B' }}>PNC Designadas:</span> <strong style={{ color: '#DC2626' }}>{stats.pncSugerido} pos</strong>
          </div>
          <div style={{ padding: '6px 12px', borderRadius: 8, backgroundColor: '#DCFCE7', border: '1px solid #86EFAC', fontSize: 12, color: '#166534' }}>
            <strong>Operación Real:</strong> 45 posiciones físicas oficiales (G0001–G0045) activas en base de datos
          </div>
        </div>

        {/* Filtros Rápidos de Visualización */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', paddingTop: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#475569' }}>Filtrar vista:</span>
          <button
            type="button"
            className={`btn btn-sm ${filterMode === 'ALL' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setFilterMode('ALL')}
            style={{ fontSize: 11, padding: '4px 10px' }}
          >
            Todas ({stats.total})
          </button>
          <button
            type="button"
            className={`btn btn-sm ${filterMode === 'INTERIOR' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setFilterMode('INTERIOR')}
            style={{ fontSize: 11, padding: '4px 10px' }}
          >
            Solo Interior ({stats.interior})
          </button>
          <button
            type="button"
            className={`btn btn-sm ${filterMode === 'EXTERIOR_TECHADO' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setFilterMode('EXTERIOR_TECHADO')}
            style={{ fontSize: 11, padding: '4px 10px' }}
          >
            Solo Exterior Techado ({stats.exterior})
          </button>
          <button
            type="button"
            className={`btn btn-sm ${filterMode === 'PNC' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setFilterMode('PNC')}
            style={{ fontSize: 11, padding: '4px 10px' }}
          >
            Posiciones PNC
          </button>
        </div>
      </div>

      {/* Contenedor Principal: Canvas SVG del Plano y Panel Lateral de Inspección */}
      <div style={{ display: 'grid', gridTemplateColumns: selectedPosition ? 'minmax(0, 1fr) 340px' : '1fr', gap: 20 }}>
        {/* Canvas SVG con Layout Real */}
        <div style={{
          backgroundColor: '#0F172A',
          borderRadius: 12,
          padding: 16,
          overflow: 'auto',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'flex-start',
          border: '1px solid #334155',
          boxShadow: 'inset 0 2px 4px 0 rgba(0, 0, 0, 0.4)',
          minHeight: 520
        }}>
          <div style={{
            transform: `scale(${zoomScale})`,
            transformOrigin: 'top center',
            transition: 'transform 0.15s ease-out',
            width: 707,
            height: 760
          }}>
            <svg
              width="707"
              height="760"
              viewBox="0 0 707 760"
              style={{ display: 'block', backgroundColor: '#FFFFFF', borderRadius: 8, boxShadow: '0 10px 25px -5px rgba(0,0,0,0.5)' }}
            >
              <defs>
                {/* Patrón de Tablones de Madera para Tarima */}
                <pattern id="palletWoodSlatH" width="20" height="8" patternUnits="userSpaceOnUse">
                  <rect width="20" height="6.5" fill="#FDE68A" stroke="#D97706" strokeWidth="0.5" />
                  <line x1="0" y1="7" x2="20" y2="7" stroke="#92400E" strokeWidth="0.5" strokeOpacity="0.4" />
                </pattern>
                <pattern id="palletWoodSlatV" width="8" height="20" patternUnits="userSpaceOnUse">
                  <rect width="6.5" height="20" fill="#FDE68A" stroke="#D97706" strokeWidth="0.5" />
                  <line x1="7" y1="0" x2="7" y2="20" stroke="#92400E" strokeWidth="0.5" strokeOpacity="0.4" />
                </pattern>
                {/* Patrón de Escalera */}
                <pattern id="stairSteps" width="10" height="8" patternUnits="userSpaceOnUse">
                  <rect width="10" height="4" fill="#94A3B8" />
                  <rect y="4" width="10" height="4" fill="#64748B" />
                </pattern>
              </defs>

              {/* 1. Fondo de Nave Interior */}
              <rect x="18" y="10" width="671" height="598" fill="#F8FAFC" stroke="#0F172A" strokeWidth="3" />

              {/* 2. Fondo de Patio Exterior Techado */}
              <rect x="18" y="608" width="671" height="142" fill="#F0FDFA" stroke="#0F172A" strokeWidth="3" />

              {/* Muro Separador Estructural entre Interior y Exterior */}
              <line x1="18" y1="608" x2="689" y2="608" stroke="#0F172A" strokeWidth="5" />

              {/* Rótulo de Zonas Espaciales */}
              <text x="490" y="555" fill="#CBD5E1" fontSize="28" fontWeight="900" letterSpacing="4">INTERIOR</text>
              <text x="350" y="642" fill="#0D9488" fontSize="14" fontWeight="800" letterSpacing="2" textAnchor="middle">
                EXTERIOR TECHADO (PNC / RECEPCIÓN)
              </text>

              {/* Muro Interior Tabicado (Recinto de Tarimas G0018-G0026) */}
              <path
                d="M 120 180 L 420 180 L 420 320"
                fill="none"
                stroke="#0F172A"
                strokeWidth="4"
              />
              <line x1="130" y1="320" x2="315" y2="320" stroke="#0F172A" strokeWidth="4" />

              {/* LANDMARKS ARQUITECTÓNICOS */}
              {/* Baños */}
              <g id="landmark-banios">
                <rect x="515" y="135" width="165" height="130" fill="#F1F5F9" stroke="#0F172A" strokeWidth="2.5" rx="3" />
                <text x="597" y="205" fill="#334155" fontSize="16" fontWeight="800" textAnchor="middle">Baños</text>
                {/* Líneas de mamparas sanitarias */}
                <line x1="517" y1="170" x2="540" y2="195" stroke="#3B82F6" strokeWidth="2" />
                <line x1="517" y1="210" x2="540" y2="235" stroke="#3B82F6" strokeWidth="2" />
              </g>

              {/* Mesas de Trabajo Interior */}
              <g id="landmark-mesas-trabajo">
                <rect x="165" y="435" width="85" height="55" fill="#2563EB" stroke="#1D4ED8" strokeWidth="2" rx="4" />
                <rect x="285" y="435" width="85" height="55" fill="#2563EB" stroke="#1D4ED8" strokeWidth="2" rx="4" />
                <text x="267" y="425" fill="#1E3A8A" fontSize="12" fontWeight="800" textAnchor="middle">Mesas de trabajo</text>
              </g>

              {/* Tableros de Control Oriente */}
              <g id="landmark-tableros">
                <rect x="580" y="405" width="65" height="90" fill="#E2E8F0" stroke="#64748B" strokeWidth="2" rx="4" />
                <rect x="580" y="510" width="65" height="90" fill="#E2E8F0" stroke="#64748B" strokeWidth="2" rx="4" />
                <text x="612" y="455" fill="#64748B" fontSize="9" fontWeight="700" textAnchor="middle">Tablero</text>
                <text x="612" y="560" fill="#64748B" fontSize="9" fontWeight="700" textAnchor="middle">Tablero</text>
              </g>

              {/* Escaleras Exterior Techado */}
              <g id="landmark-escaleras">
                <rect x="80" y="618" width="60" height="40" fill="url(#stairSteps)" stroke="#475569" strokeWidth="1.5" rx="2" />
                <rect x="485" y="618" width="75" height="40" fill="url(#stairSteps)" stroke="#475569" strokeWidth="1.5" rx="2" />
              </g>

              {/* Mesa Exterior de Madera */}
              <g id="landmark-mesa-exterior">
                <rect x="150" y="618" width="160" height="40" fill="#B45309" stroke="#78350F" strokeWidth="2" rx="3" />
                <text x="230" y="642" fill="#FEF3C7" fontSize="11" fontWeight="800" textAnchor="middle">Mesa Auxiliar</text>
              </g>

              {/* Botes de basura / Mantenimiento exterior */}
              <circle cx="250" cy="700" r="10" fill="#2563EB" stroke="#1D4ED8" strokeWidth="1" />
              <circle cx="275" cy="718" r="10" fill="#2563EB" stroke="#1D4ED8" strokeWidth="1" />

              {/* RENDERIZADO DE LAS 45 POSICIONES FÍSICAS DE TARIMA */}
              {REAL_WAREHOUSE_POSITIONS.map((pos) => {
                const live = locationsByCode.get(pos.codigo.toUpperCase());
                const isSelected = selectedPosition?.codigo === pos.codigo;
                const isHovered = hoveredCode === pos.codigo;

                // Filtrado visual por modo y búsqueda (Fase 3B-B)
                let isFilteredOut = false;
                if (filterMode === 'INTERIOR' && pos.areaFisica !== 'INTERIOR') isFilteredOut = true;
                if (filterMode === 'EXTERIOR_TECHADO' && pos.areaFisica !== 'EXTERIOR_TECHADO') isFilteredOut = true;
                if (filterMode === 'PNC') {
                  const isPnc = live?.tipoUbicacion === 'PNC' || live?.categoriaUbicacion === 'VIRTUAL_NO_CONFORME' || pos.esPncSugerido;
                  if (!isPnc) isFilteredOut = true;
                }
                const q = (searchTerm || '').trim().toLowerCase();
                if (q) {
                  const matchesSearch = pos.codigo.toLowerCase().includes(q) ||
                                        pos.areaFisica.toLowerCase().includes(q) ||
                                        (live?.zona?.nombre && live.zona.nombre.toLowerCase().includes(q));
                  if (!matchesSearch) isFilteredOut = true;
                }

                // Determinación de estado físico de la posición
                const isLivePnc = live?.tipoUbicacion === 'PNC' || live?.categoriaUbicacion === 'VIRTUAL_NO_CONFORME';
                const isPnc = isLivePnc || pos.esPncSugerido;
                const isOccupied = live ? (live.ocupacionBultos >= 1 || live.ocupacionUnidades > 0 || live.estadoCapacidad === 'LLENO') : false;

                // Estilo y color de la tarima
                let palletBorder = '#D97706';
                let palletFill = pos.rotacion === 90 ? 'url(#palletWoodSlatV)' : 'url(#palletWoodSlatH)';
                let badgeBg = '#FEF3C7';
                let badgeText = '#92400E';

                if (isPnc) {
                  palletBorder = '#DC2626';
                  badgeBg = '#FEE2E2';
                  badgeText = '#991B1B';
                } else if (isOccupied) {
                  palletBorder = '#2563EB';
                  badgeBg = '#DBEAFE';
                  badgeText = '#1E40AF';
                }

                if (isSelected) {
                  palletBorder = '#4F46E5';
                }

                return (
                  <g
                    key={pos.codigo}
                    id={`pos-${pos.codigo}`}
                    opacity={isFilteredOut ? 0.15 : 1}
                    cursor="pointer"
                    onClick={() => setSelectedPosition(pos)}
                    onMouseEnter={() => setHoveredCode(pos.codigo)}
                    onMouseLeave={() => setHoveredCode(null)}
                    style={{ transition: 'opacity 0.2s ease, transform 0.15s ease' }}
                  >
                    {/* Contorno y Fondo de la Tarima */}
                    <rect
                      x={pos.coordX}
                      y={pos.coordY}
                      width={pos.ancho}
                      height={pos.alto}
                      fill={palletFill}
                      stroke={palletBorder}
                      strokeWidth={isSelected ? 3 : (isHovered ? 2.5 : 1.5)}
                      rx={3}
                      filter={isSelected ? 'drop-shadow(0 0 6px rgba(79, 70, 229, 0.7))' : undefined}
                    />

                    {/* Badge de Código Consecutivo G0001+ */}
                    <rect
                      x={pos.coordX + 4}
                      y={pos.coordY + (pos.alto / 2) - 10}
                      width={pos.ancho - 8}
                      height={20}
                      fill={badgeBg}
                      stroke={palletBorder}
                      strokeWidth={1}
                      rx={3}
                      opacity={0.95}
                    />
                    <text
                      x={pos.coordX + (pos.ancho / 2)}
                      y={pos.coordY + (pos.alto / 2) + 4}
                      fill={badgeText}
                      fontSize="11"
                      fontWeight="800"
                      textAnchor="middle"
                      letterSpacing="0.5"
                    >
                      {pos.codigo}
                    </text>

                    {/* Tag indicador PNC en las posiciones designadas */}
                    {isPnc && (
                      <g>
                        <rect
                          x={pos.coordX + (pos.ancho / 2) - 16}
                          y={pos.coordY + pos.alto - 14}
                          width={32}
                          height={12}
                          fill="#DC2626"
                          rx={2}
                        />
                        <text
                          x={pos.coordX + (pos.ancho / 2)}
                          y={pos.coordY + pos.alto - 5}
                          fill="#FFFFFF"
                          fontSize="9"
                          fontWeight="900"
                          textAnchor="middle"
                        >
                          PNC
                        </text>
                      </g>
                    )}

                    {/* Tag de Ocupada 1/1 */}
                    {isOccupied && !isPnc && (
                      <g>
                        <rect
                          x={pos.coordX + (pos.ancho / 2) - 14}
                          y={pos.coordY + pos.alto - 14}
                          width={28}
                          height={12}
                          fill="#2563EB"
                          rx={2}
                        />
                        <text
                          x={pos.coordX + (pos.ancho / 2)}
                          y={pos.coordY + pos.alto - 5}
                          fill="#FFFFFF"
                          fontSize="9"
                          fontWeight="900"
                          textAnchor="middle"
                        >
                          1/1
                        </text>
                      </g>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>
        </div>

        {/* Panel Lateral de Inspección de Ubicación Física */}
        {selectedPosition && (
          <div style={{
            backgroundColor: '#FFFFFF',
            borderRadius: 12,
            border: '1px solid var(--border)',
            padding: 20,
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            height: 'fit-content',
            boxShadow: '0 4px 12px -2px rgba(0, 0, 0, 0.08)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <span style={{
                  fontSize: 10,
                  fontWeight: 800,
                  textTransform: 'uppercase',
                  color: selectedPosition.areaFisica === 'INTERIOR' ? '#1D4ED8' : '#0D9488',
                  letterSpacing: '0.5px'
                }}>
                  {selectedPosition.areaFisica === 'INTERIOR' ? 'Área Interior' : 'Exterior Techado'}
                </span>
                <h4 style={{ margin: '2px 0 0', fontSize: 20, fontWeight: 900, color: '#0F172A' }}>
                  {selectedPosition.codigo}
                </h4>
              </div>
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => setSelectedPosition(null)}
                style={{ padding: 4 }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Atributos Físicos Confirmados */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 6, borderBottom: '1px solid #F1F5F9' }}>
                <span style={{ color: '#64748B' }}>Capacidad Física:</span>
                <strong style={{ color: '#0F172A' }}>1 Tarima Estándar (1/1)</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 6, borderBottom: '1px solid #F1F5F9' }}>
                <span style={{ color: '#64748B' }}>Accesibilidad:</span>
                <strong style={{ color: '#0F172A' }}>Nivel de Piso Directo (MIXTO)</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 6, borderBottom: '1px solid #F1F5F9' }}>
                <span style={{ color: '#64748B' }}>Coordenadas Plano:</span>
                <span style={{ fontFamily: 'monospace', color: '#475569' }}>
                  X: {selectedPosition.coordX}, Y: {selectedPosition.coordY} ({selectedPosition.ancho}x{selectedPosition.alto}px)
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 6, borderBottom: '1px solid #F1F5F9' }}>
                <span style={{ color: '#64748B' }}>Orientación:</span>
                <span style={{ color: '#475569' }}>{selectedPosition.rotacion === 90 ? 'Vertical (90°)' : 'Horizontal (0°)'}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 6, borderBottom: '1px solid #F1F5F9' }}>
                <span style={{ color: '#64748B' }}>Uso Operativo Actual:</span>
                <span style={{
                  fontWeight: 800,
                  color: (selectedLiveLocation?.tipoUbicacion === 'PNC' || (!selectedLiveLocation && selectedPosition.esPncSugerido)) ? '#DC2626' : '#166534'
                }}>
                  {(selectedLiveLocation?.tipoUbicacion === 'PNC' || (!selectedLiveLocation && selectedPosition.esPncSugerido)) ? 'USO PNC' : 'COMERCIAL'}
                </span>
              </div>
            </div>

            {/* Feedback de Acciones */}
            {actionFeedback && (
              <div style={{
                padding: '10px 12px',
                borderRadius: 8,
                fontSize: 12,
                backgroundColor: actionFeedback.type === 'success' ? '#DCFCE7' : '#FEE2E2',
                color: actionFeedback.type === 'success' ? '#166534' : '#991B1B',
                border: `1px solid ${actionFeedback.type === 'success' ? '#86EFAC' : '#FCA5A5'}`
              }}>
                {actionFeedback.message}
              </div>
            )}

            {/* Estado en Base de Datos Real */}
            {selectedLiveLocation ? (
              <div style={{
                padding: 14,
                borderRadius: 8,
                backgroundColor: '#F8FAFC',
                border: '1px solid #E2E8F0',
                display: 'flex',
                flexDirection: 'column',
                gap: 10
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#64748B' }}>UUID en BD:</span>
                  <span style={{ fontSize: 10, fontFamily: 'monospace', color: '#1E293B', backgroundColor: '#EDE9FE', padding: '1px 6px', borderRadius: 4, maxWidth: 210, overflow: 'hidden', textOverflow: 'ellipsis' }} title={selectedLiveLocation.id}>
                    {selectedLiveLocation.id}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#64748B' }}>Estado Físico:</span>
                  <span style={{ fontSize: 11, fontWeight: 800, color: selectedLiveLocation.estado === 'LIBRE' ? '#166534' : '#991B1B' }}>
                    {selectedLiveLocation.estado || 'LIBRE'}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#64748B' }}>Zona Asignada:</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#1E40AF' }}>
                    {selectedLiveLocation.zona?.nombre || (selectedPosition.areaFisica === 'INTERIOR' ? 'Área Interior' : 'Exterior Techado')}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#64748B' }}>Estatus Operativo:</span>
                  <span style={{
                    fontSize: 11,
                    fontWeight: 800,
                    padding: '2px 8px',
                    borderRadius: 4,
                    backgroundColor: selectedLiveLocation.tipoUbicacion === 'PNC' ? '#FEE2E2' : '#DCFCE7',
                    color: selectedLiveLocation.tipoUbicacion === 'PNC' ? '#991B1B' : '#166534'
                  }}>
                    {selectedLiveLocation.tipoUbicacion === 'PNC' ? 'USO PNC' : 'COMERCIAL'}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: '#334155', backgroundColor: '#FFFFFF', padding: '8px 10px', borderRadius: 6, border: '1px solid #E2E8F0' }}>
                  • Ocupación de bultos: <strong>{selectedLiveLocation.ocupacionBultos || 0}/1 tarimas</strong><br />
                  • Ocupación en piezas: <strong>{selectedLiveLocation.ocupacionUnidades || 0} unidades</strong>
                </div>

                {/* Botón para alternar designación PNC */}
                <button
                  type="button"
                  className={`btn btn-sm ${selectedLiveLocation.tipoUbicacion === 'PNC' ? 'btn-secondary' : 'btn-ghost'}`}
                  disabled={isTogglingPnc}
                  onClick={() => handleTogglePncDesignation(selectedLiveLocation.id, selectedLiveLocation.tipoUbicacion === 'PNC')}
                  style={{ marginTop: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontWeight: 700 }}
                >
                  <ArrowRightLeft size={14} />
                  {selectedLiveLocation.tipoUbicacion === 'PNC' ? 'Restituir a Comercial' : 'Designar como PNC'}
                </button>
              </div>
            ) : (
              <div style={{
                padding: 12,
                borderRadius: 8,
                backgroundColor: '#F1F5F9',
                border: '1px solid #CBD5E1',
                fontSize: 12,
                color: '#475569'
              }}>
                <strong>Sin registro en BD:</strong> Posición arquitectónica no localizada en el catálogo de ubicaciones.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Leyenda Visual del Plano */}
      <div style={{
        padding: '12px 16px',
        borderRadius: 8,
        backgroundColor: '#FFFFFF',
        border: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 12,
        fontSize: 12
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 14, height: 14, backgroundColor: '#FEF3C7', border: '1.5px solid #D97706', borderRadius: 3 }} />
            <span style={{ color: '#475569' }}>Tarima Libre (0/1)</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 14, height: 14, backgroundColor: '#DBEAFE', border: '1.5px solid #2563EB', borderRadius: 3 }} />
            <span style={{ color: '#475569' }}>Tarima Ocupada (1/1)</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 14, height: 14, backgroundColor: '#FEE2E2', border: '1.5px solid #DC2626', borderRadius: 3 }} />
            <span style={{ color: '#475569' }}>Uso PNC / No Conforme</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 14, height: 14, backgroundColor: '#2563EB', borderRadius: 3 }} />
            <span style={{ color: '#475569' }}>Mesas de Trabajo</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 14, height: 14, backgroundColor: '#F1F5F9', border: '1px solid #94A3B8', borderRadius: 3 }} />
            <span style={{ color: '#475569' }}>Baños / Tableros</span>
          </div>
        </div>

        <span style={{ color: 'var(--text-tertiary)', fontStyle: 'italic', fontSize: 11 }}>
          Haga clic en cualquier posición del plano para inspeccionar sus atributos y trazabilidad espacial.
        </span>
      </div>
    </div>
  );
}
