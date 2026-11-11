export interface LocationHuRowPresentation {
  isContainer: boolean;
  tipoLabel: string;
  contenidoLabel: string;
  contenidoSublabel: string | null;
  cantidadLabel: string;
  cantidadSublabel: string | null;
  parentCodigo: string | null;
  associatedChildrenCount: number;
  childSkus?: string[];
  childDescriptions?: string[];
  childLots?: string[];
  childClientName?: string | null;
}

/**
 * Obtiene el conjunto de IDs de zonas operativas que tienen al menos una posición física activa
 * y almacenable en el layout real vigente (ej. INTERIOR / EXTERIOR_TECHADO).
 * Sirve para ignorar referencias legacy como ALM-A / ALM-B cuyos racks están inactivos (activo = false).
 */
export function getActiveOperationalZoneIds(locations: any[] = []): Set<string> {
  const ids = new Set<string>();
  for (const loc of locations) {
    if (!loc || loc.activo === false) continue;
    if (loc.esAlmacenable === false || loc.categoriaUbicacion !== 'FISICA_ALMACENABLE') continue;
    if (String(loc.tipoUbicacion || '').toUpperCase() === 'PNC') continue;
    const zId = loc.zonaId || loc.zona?.id;
    if (zId) ids.add(String(zId));
  }
  return ids;
}

/**
 * Determina si `client.zonaAsignadaId` pertenece a un catálogo legacy sin posiciones operativas activas
 * (por ejemplo ALM-A / ALM-B históricos), evitando restringir o inflar el layout físico real G0001–G0045.
 */
export function hasActiveAssignedClientZone(clientObj: any, activeZoneIds: Set<string>): boolean {
  if (!clientObj?.zonaAsignadaId) return false;
  return activeZoneIds.has(String(clientObj.zonaAsignadaId));
}

/**
 * Evalúa si una ubicación es elegible/compatible para un depositante 3PL en el layout operativo activo.
 */
export function isLocationCompatibleWithClient(
  loc: any,
  clientObj: any,
  hasStock: boolean,
  activeZoneIds?: Set<string>,
): boolean {
  if (!clientObj || !loc) return false;

  // Excluir ubicaciones históricas / inactivas (racks Axx/Bxx fuera de servicio)
  if (loc.activo === false) return false;

  // Debe ser física almacenable comercial (excluye PNC, recibo, devoluciones, cuarentena, staging)
  if (loc.esAlmacenable === false || loc.categoriaUbicacion !== 'FISICA_ALMACENABLE') {
    return false;
  }
  if (String(loc.tipoUbicacion || '').toUpperCase() === 'PNC') {
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

  // Respetar zonaAsignadaId únicamente si pertenece a una zona activa del layout actual
  if (clientObj.zonaAsignadaId) {
    const enforceZone = !activeZoneIds || activeZoneIds.has(String(clientObj.zonaAsignadaId));
    if (enforceZone) {
      const matchesZone =
        loc.zonaId === clientObj.zonaAsignadaId || loc.zona?.id === clientObj.zonaAsignadaId;
      return matchesZone || hasStock;
    }
  }
  return true;
}

export interface LocationHusSummary {
  containerHus: any[];
  inventariableHus: any[];
  physicalPalletsCount: number;
  totalPiecesInLots: number;
  totalPiecesInInventariableHus: number;
  hasHuDiscrepancy: boolean;
}

/**
 * Determina si una Handling Unit corresponde a un contenedor logístico padre (Tarima Master / Pallet)
 * que agrupa cajas u otras HUs y NO representa stock adicional de producto por sí misma.
 */
export function isContainerMasterHu(hu: any, allHusInScope: any[] = []): boolean {
  if (!hu) return false;
  const tipo = String(hu.tipoHu || '').toUpperCase().trim();
  const uom = String(hu.uom || '').toUpperCase().trim();

  const hasChildren =
    Boolean(hu.id) &&
    allHusInScope.some((c) => c && c.id !== hu.id && c.parentHuId === hu.id);

  if (hasChildren) return true;
  if (tipo !== 'PALLET' && tipo !== 'TARIMA') return false;
  if (uom === 'TARIMA' || uom === 'PALLET') return true;

  const hasDirectProductRef = Boolean(hu.skuCodigo || hu.lote?.sku?.codigo || hu.lotId);
  return !hasDirectProductRef;
}

/**
 * Calcula los totales físicos de la posición excluyendo contenedores padre (PALLET / TARIMA Master)
 * de la suma de piezas inventariables y comparando únicamente HUs de producto vs LotInventory.
 */
export function summarizeLocationHus(params: {
  lots?: any[];
  hus?: any[];
  allHusInPosition?: any[];
}): LocationHusSummary {
  const lots = Array.isArray(params.lots) ? params.lots : [];
  const hus = Array.isArray(params.hus) ? params.hus : [];
  const scopeHus =
    Array.isArray(params.allHusInPosition) && params.allHusInPosition.length > 0
      ? params.allHusInPosition
      : hus;

  const containerHus = hus.filter((h) => isContainerMasterHu(h, scopeHus));
  const inventariableHus = hus.filter((h) => !isContainerMasterHu(h, scopeHus));

  const physicalPalletsCount = new Set(
    hus.map((h: any) => h.parentHuId || h.id).filter(Boolean),
  ).size;

  const totalPiecesInLots = lots.reduce(
    (sum: number, l: any) =>
      sum + (Number(l?.cantidadDisponible || 0) + Number(l?.cantidadBloqueada || 0)),
    0,
  );

  const totalPiecesInInventariableHus = inventariableHus.reduce(
    (sum: number, h: any) => sum + (Number(h?.cantidad) || 0),
    0,
  );

  const hasHuDiscrepancy =
    inventariableHus.length > 0 && totalPiecesInLots !== totalPiecesInInventariableHus;

  return {
    containerHus,
    inventariableHus,
    physicalPalletsCount,
    totalPiecesInLots,
    totalPiecesInInventariableHus,
    hasHuDiscrepancy,
  };
}

/**
 * Formatea una fila HU en el detalle de ubicación separando contenedores padre (ej. "1 tarima / 2 cajas asociadas")
 * de HUs inventariables de producto (ej. "12 piezas"), preservando jerarquía `parentHuId`.
 */
export function getLocationHuRowPresentation(
  hu: any,
  allHusInPosition: any[] = [],
): LocationHuRowPresentation {
  const isContainer = isContainerMasterHu(hu, allHusInPosition);

  if (isContainer) {
    const children = allHusInPosition.filter(
      (c) =>
        c &&
        c.id !== hu?.id &&
        c.parentHuId === hu?.id &&
        !isContainerMasterHu(c, allHusInPosition),
    );
    const declaredCount = Number(hu?.cantidad || 0);
    const associatedChildrenCount = children.length > 0 ? children.length : declaredCount;
    const childSkus = Array.from(
      new Set(
        children
          .map((c) => c?.skuCodigo || c?.lote?.sku?.codigo)
          .filter(Boolean),
      ),
    );
    const childDescriptions = Array.from(
      new Set(
        children
          .map((c) => c?.lote?.sku?.descripcion || c?.skuDescripcion)
          .filter(Boolean),
      ),
    );
    const childLots = Array.from(
      new Set(
        children
          .map((c) => c?.lote?.lote || c?.loteTexto)
          .filter(Boolean),
      ),
    );
    const childClientName =
      children.find((c) => c?.cliente?.nombreComercial || c?.lote?.cliente?.nombreComercial)
        ?.cliente?.nombreComercial ||
      children.find((c) => c?.lote?.cliente?.nombreComercial)?.lote?.cliente?.nombreComercial ||
      null;

    const contenidoLabel =
      associatedChildrenCount > 0
        ? `Contenedor de ${associatedChildrenCount} ${associatedChildrenCount === 1 ? 'caja' : 'cajas'}`
        : 'Contenedor logístico (Tarima Master)';

    const contenidoSublabel =
      childSkus.length > 0
        ? `Contenido asociado: ${childSkus.join(', ')}`
        : 'Agrupador físico sin saldo duplicado';

    return {
      isContainer: true,
      tipoLabel: 'Tarima Master',
      contenidoLabel,
      contenidoSublabel,
      cantidadLabel: '1 tarima',
      cantidadSublabel:
        associatedChildrenCount > 0
          ? `${associatedChildrenCount} ${associatedChildrenCount === 1 ? 'caja asociada' : 'cajas asociadas'}`
          : 'Contenedor padre',
      parentCodigo: null,
      associatedChildrenCount,
      childSkus,
      childDescriptions,
      childLots,
      childClientName,
    };
  }

  const parentHu = hu?.parentHuId
    ? allHusInPosition.find((p) => p && p.id === hu.parentHuId)
    : null;

  const qty = Number(hu?.cantidad || 0);
  const rawUom = String(hu?.uom || 'PZA').toUpperCase().trim();
  const unitText =
    rawUom === 'PZA' || rawUom === 'PIEZAS' || rawUom === 'PIEZA' || !rawUom
      ? qty === 1
        ? 'pieza'
        : 'piezas'
      : rawUom.toLowerCase();

  return {
    isContainer: false,
    tipoLabel: hu?.tipoHu?.toLowerCase() || 'caja',
    contenidoLabel: hu?.skuCodigo || hu?.lote?.sku?.codigo || '—',
    contenidoSublabel: hu?.lote?.sku?.descripcion || hu?.skuDescripcion || null,
    cantidadLabel: `${qty} ${unitText}`,
    cantidadSublabel: null,
    parentCodigo: parentHu?.codigo || null,
    associatedChildrenCount: 0,
  };
}

