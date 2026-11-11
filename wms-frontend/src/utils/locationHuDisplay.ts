export interface LocationHuRowPresentation {
  isContainer: boolean;
  tipoLabel: string;
  contenidoLabel: string;
  contenidoSublabel: string | null;
  cantidadLabel: string;
  cantidadSublabel: string | null;
  parentCodigo: string | null;
  associatedChildrenCount: number;
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

