export interface QualityClassificationInput {
  qiRecord?: any | null;
  bultosDanados?: number;
  bultosRecibidos?: number;
  totalConformePiezas?: number;
  totalMermaPiezas?: number;
  boxHus?: any[];
  hasDamagedBoxes?: boolean;
  hasMerma?: boolean;
  hasQuarantine?: boolean;
  originDamagedBox?: any | null;
  reconditionedBox?: any | null;
}

export interface QualityClassificationResult {
  hasQualityInspection: boolean;
  detalles: any[];
  hasRealDamageOrQuarantine: boolean;
  hasRealRescue: boolean;
  isConformingCleanLiberation: boolean;
  piezasInspeccionadas: number;
  piezasConformesAnden: number;
  piezasRescatadas: number;
  piezasMerma: number;
  dictamenOperativo: string;
  anexoBTituloChecklist: string;
  anexoBTituloDocumento: string;
  firma2Titulo: string;
}

export function parseQualityDetalles(qiRecord: any): any[] {
  if (!qiRecord) return [];
  const raw = qiRecord.detalles ?? qiRecord.detallesJson;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string' && raw.trim().length > 0) {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Determina si una HU de caja corresponde a una caja comercial recuperada/reacondicionada activa o ya despachada,
 * excluyendo la caja dañada original inactiva y cualquier HU segregada de merma/cuarentena (p. ej. DEV-01).
 */
export function isActiveRescuedBox(hu: any): boolean {
  if (!hu) return false;
  const estHu = String(hu.estadoHu || '').toUpperCase();
  const cod = String(hu.codigo || '').toUpperCase();
  const ubi = String(hu.ubicacionActual || hu.lote?.ubicacion?.codigo || '').toUpperCase();
  const estCal = String(hu.estadoCalidad || hu.lote?.estadoCalidad || '').toUpperCase();
  if (
    estHu === 'INACTIVO' ||
    estHu === 'DAÑADO' ||
    estHu === 'DANADO' ||
    estHu === 'BLOQUEADO' ||
    estHu === 'RETENIDO' ||
    estHu === 'CUARENTENA' ||
    cod.includes('DANO') ||
    cod.includes('MERMA') ||
    cod.startsWith('HU-NC-') ||
    ubi === 'DEV-01' ||
    ubi.startsWith('DEV-') ||
    ubi.includes('CUARENTENA') ||
    ubi.startsWith('NC-') ||
    ubi.startsWith('VIR-') ||
    estCal === 'MERMA' ||
    estCal === 'CUARENTENA' ||
    estCal === 'BLOQUEADO' ||
    estCal === 'RECHAZADO'
  ) {
    return false;
  }
  return Boolean(hu.cajaOrigenId) || Boolean(hu.reacondicionada);
}

export function hasDetailsDamageEvidence(detalles: any[]): boolean {
  return detalles.some(
    (d) =>
      Boolean(d?.cajaOrigenCodigo || d?.cajaOrigenId) ||
      (Array.isArray(d?.nuevasCajasGeneradas) && d.nuevasCajasGeneradas.length > 0) ||
      Number(d?.piezasMerma ?? d?.merma ?? 0) > 0,
  );
}

/**
 * Clasifica el dictamen técnico de calidad separando:
 * - Liberación conforme 100% sana en andén (sin daño, sin rescate, sin merma), compatible con
 *   registros históricos donde `totalPiezasRescatadas` se guardó igual a las conformes.
 * - Inspección técnica con daño, rescate real y/o merma dictaminada.
 */
export function classifyQualityOutcome(input: QualityClassificationInput): QualityClassificationResult {
  const qiRecord = input.qiRecord || null;
  const boxHus = Array.isArray(input.boxHus) ? input.boxHus : [];
  const bultosDanados = Number(input.bultosDanados || 0);
  const totalConformePiezas = Number(input.totalConformePiezas || 0);
  const totalMermaPiezas = Number(input.totalMermaPiezas || 0);

  const hasQualityInspection = Boolean(qiRecord);
  const detalles = parseQualityDetalles(qiRecord);

  const detallesRescuedPieces = detalles.reduce(
    (sum, d) => sum + Number(d?.piezasRescatadas ?? d?.rescatadas ?? 0),
    0,
  );
  const detallesMermaPieces = detalles.reduce(
    (sum, d) => sum + Number(d?.piezasMerma ?? d?.merma ?? 0),
    0,
  );
  const detallesSanasAnden = detalles.reduce(
    (sum, d) => sum + Number(d?.sanasAnden ?? 0),
    0,
  );
  const detallesHasExplicitAndenSanas = detalles.some(
    (d) => d?.sanasAnden !== undefined && d?.sanasAnden !== null,
  );
  const detallesHasDamageLineage = hasDetailsDamageEvidence(detalles);

  const qiMermaNum = Number(qiRecord?.totalPiezasMerma || 0);
  const mermaPiecesFinal = Math.max(totalMermaPiezas, qiMermaNum, detallesMermaPieces);

  const hasRealDamageOrQuarantine = Boolean(
    input.hasDamagedBoxes ||
      bultosDanados > 0 ||
      input.hasMerma ||
      input.hasQuarantine ||
      input.originDamagedBox ||
      qiRecord?.cajaOrigenCodigo ||
      mermaPiecesFinal > 0 ||
      detallesHasDamageLineage,
  );

  const rescuedFromActiveHus = boxHus
    .filter((b) => isActiveRescuedBox(b))
    .reduce((sum, b) => sum + (Number(b?.cantidad) || 0), 0);

  const hasNewBoxesOrDestino = Boolean(
    input.reconditionedBox ||
      Number(qiRecord?.totalCajasNuevasArmadas || 0) > 0 ||
      qiRecord?.cajaDestinoCodigo ||
      detalles.some((d) => Array.isArray(d?.nuevasCajasGeneradas) && d.nuevasCajasGeneradas.length > 0),
  );

  const hasAndenRescatadasZeroInDetalles =
    detallesHasExplicitAndenSanas &&
    detallesRescuedPieces === 0 &&
    !hasNewBoxesOrDestino &&
    rescuedFromActiveHus === 0;

  const hasRealRescue = Boolean(
    !hasAndenRescatadasZeroInDetalles &&
      (rescuedFromActiveHus > 0 ||
        hasNewBoxesOrDestino ||
        detallesRescuedPieces > 0 ||
        (hasRealDamageOrQuarantine && Number(qiRecord?.totalPiezasRescatadas || 0) > 0)),
  );

  const isConformingCleanLiberation = Boolean(
    hasQualityInspection && !hasRealDamageOrQuarantine && !hasRealRescue,
  );

  let piezasRescatadas = 0;
  if (hasRealRescue) {
    if (detallesRescuedPieces > 0) {
      piezasRescatadas = detallesRescuedPieces;
    } else if (hasRealDamageOrQuarantine && Number(qiRecord?.totalPiezasRescatadas || 0) > 0) {
      piezasRescatadas = Number(qiRecord.totalPiezasRescatadas);
    } else {
      piezasRescatadas = rescuedFromActiveHus;
    }
  }

  const piezasMerma = isConformingCleanLiberation ? 0 : mermaPiecesFinal;

  const rawInspeccionadas = Number(qiRecord?.totalPiezasInspeccionadas || 0);
  const piezasInspeccionadas =
    rawInspeccionadas > 0
      ? rawInspeccionadas
      : hasRealDamageOrQuarantine
        ? piezasRescatadas + piezasMerma
        : totalConformePiezas;

  const piezasConformesAnden = isConformingCleanLiberation
    ? detallesHasExplicitAndenSanas
      ? detallesSanasAnden
      : totalConformePiezas > 0
        ? totalConformePiezas
        : piezasInspeccionadas
    : Math.max(0, totalConformePiezas - piezasRescatadas);

  const dictamenOperativo =
    qiRecord?.dictamen ||
    (isConformingCleanLiberation
      ? 'LIBERADO / CONFORME'
      : hasRealRescue
        ? 'REACONDICIONADO'
        : 'INSPECCIONADO');

  return {
    hasQualityInspection,
    detalles,
    hasRealDamageOrQuarantine,
    hasRealRescue,
    isConformingCleanLiberation,
    piezasInspeccionadas,
    piezasConformesAnden,
    piezasRescatadas,
    piezasMerma,
    dictamenOperativo,
    anexoBTituloChecklist: isConformingCleanLiberation ? 'Liberación de Calidad' : 'Inspección y Rescate',
    anexoBTituloDocumento: isConformingCleanLiberation
      ? 'LIBERACIÓN TÉCNICA DE CALIDAD EN ANDÉN'
      : qiRecord
        ? 'BITÁCORA TÉCNICA DE INSPECCIÓN Y RESCATE'
        : 'DOCUMENTACIÓN OPERATIVA DE CALIDAD Y NO CONFORMIDAD',
    firma2Titulo: isConformingCleanLiberation
      ? '2. Liberación Técnica de Calidad'
      : '2. Inspección Técnica y Rescate (Calidad)',
  };
}
