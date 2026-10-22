/**
 * ============================================================================
 * EVALUADOR CENTRAL DE PRECEDENCIA DE ESTADOS OPERATIVOS DE INVENTARIO WMS
 * ============================================================================
 * Fuente única de verdad transversal para clasificar el estado operativo principal
 * de cada partida de inventario, resolviendo la precedencia estricta:
 *
 *   MERMA / NO_CONFORME
 *   > EXCESO / CUARENTENA
 *   > VENCIDO (EXPIRADO)
 *   > TRANSITO_INTERNO
 *   > DISPONIBLE_COMERCIAL
 *
 * REGLAS FUNDAMENTALES DE ARQUITECTURA:
 * 1. RESERVADO es una magnitud cuantitativa del saldo disponible, NO un estado
 *    excluyente de toda la partida.
 * 2. Un bloqueo parcial (cantidadBloqueada > 0) no invalida automáticamente el
 *    saldo disponible de una celda comercial si coexisten cantidades mixtas.
 * 3. La condición de VENCIDO tiene precedencia operativa sobre la ubicación física:
 *    una partida vencida en REC-01 se clasifica como VENCIDO (no en tránsito vigente),
 *    queda formalmente BLOQUEADA para Putaway comercial, y suma a totalExpirado.
 * 4. Las partidas vencidas en DEV-01/NC se clasifican como MERMA/CUARENTENA por mayor
 *    precedencia, evitando doble conteo en Expirado.
 */

import { LocationOperationalClassification } from './location-classifier.util';

export type InventoryOperationalState =
  | 'MERMA'
  | 'EXCESO'
  | 'CUARENTENA'
  | 'VENCIDO'
  | 'TRANSITO_INTERNO'
  | 'NO_ELEGIBLE_SURTIDO'
  | 'DISPONIBLE_COMERCIAL';

export interface EvaluatedInventoryState {
  estadoPrincipal: InventoryOperationalState;
  badgeTexto: string;
  badgeColor: 'emerald' | 'amber' | 'rose' | 'slate' | 'sky';
  motivo: string;
  esVendible: boolean;
  esElegiblePutawayComercial: boolean;
  esElegibleAllocation: boolean;
  esElegiblePicking: boolean;
  esVisiblePortalComoDisponible: boolean;
  esVencido: boolean;
  esTransito: boolean;
  esBloqueado: boolean;
  
  // Magnitudes reconciliadas
  cantidadFisica: number;
  cantidadDisponibleVendible: number;
  cantidadReservada: number;
  cantidadBloqueada: number;
  cantidadTransitoVigente: number;
  cantidadExpirada: number;
  desgloseBloqueado: {
    merma: number;
    exceso: number;
    cuarentenaOtros: number;
  };
}

/**
 * Normaliza una fecha a nivel de día calendario (YYYY-MM-DD UTC)
 * para evitar discrepancias por hora o zona horaria.
 */
export function toCalendarDayString(date: Date | string | null | undefined): string | null {
  if (!date) return null;
  const d = new Date(date);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().split('T')[0];
}

/**
 * Regla de negocio oficial de caducidad en el almacén:
 * Un lote está vencido si su día de caducidad calendario es anterior o igual
 * al día operativo del almacén (inclusiveToday: true por defecto para control comercial).
 */
export function isExpired(
  fechaVencimiento: Date | string | null | undefined,
  businessDate: Date = new Date(),
  inclusiveToday: boolean = true,
): boolean {
  if (!fechaVencimiento) return false;
  const expDayStr = toCalendarDayString(fechaVencimiento);
  const bizDayStr = toCalendarDayString(businessDate);
  if (!expDayStr || !bizDayStr) return false;

  if (inclusiveToday) {
    return expDayStr <= bizDayStr;
  }
  return expDayStr < bizDayStr;
}

/**
 * Evalúa el estado operativo de una partida de inventario aplicando
 * la precedencia estricta y segregando saldos cuantitativos.
 */
export function evaluateInventoryItemOperationalState(
  item: any,
  locClass: LocationOperationalClassification,
  businessDate: Date = new Date(),
): EvaluatedInventoryState {
  const disp = Math.max(0, Number(item?.cantidadDisponible || 0));
  const res = Math.max(0, Number(item?.cantidadReservada || 0));
  const bloq = Math.max(0, Number(item?.cantidadBloqueada || 0));
  const fisico = disp + bloq;
  const saldoLibre = Math.max(0, disp - res);

  const locCode = String(item?.ubicacion?.codigo || '').toUpperCase().trim();
  const notas = String(item?.notas || '').toUpperCase().trim();
  const estadoCalidad = String(item?.estadoCalidad || 'LIBERADO').toUpperCase().trim();

  const vencido = isExpired(item?.fechaVencimiento, businessDate, true);

  const isLocDev = locClass.rolOperativo === 'NO_CONFORME_BLOQUEADO' || locCode === 'DEV-01' || locCode === 'NC-MERMA-01';
  const isLocExceso = locCode === 'NC-EXCESO-01' || notas.includes('PRODUCTO_EXCESO') || notas.includes('EXCESO');
  const isMermaCausa = notas.includes('MERCANCIA_DANADA') || notas.includes('MERMA') || estadoCalidad === 'MERMA' || estadoCalidad === 'BLOQUEADO';

  const getDesgloseBloqueado = (bloqueadoCantidad: number) => {
    if (bloqueadoCantidad <= 0) {
      return { merma: 0, exceso: 0, cuarentenaOtros: 0 };
    }
    if (isLocDev || isMermaCausa) {
      return { merma: bloqueadoCantidad, exceso: 0, cuarentenaOtros: 0 };
    }
    if (isLocExceso) {
      return { merma: 0, exceso: bloqueadoCantidad, cuarentenaOtros: 0 };
    }
    return { merma: 0, exceso: 0, cuarentenaOtros: bloqueadoCantidad };
  };

  // ==========================================================================
  // PRECEDENCIA 1: MERMA / NO CONFORME CONFIRMADO
  // ==========================================================================
  if (isLocDev && !isLocExceso) {
    return {
      estadoPrincipal: 'MERMA',
      badgeTexto: 'MERMA DEV-01',
      badgeColor: 'rose',
      motivo: 'Mercancía en zona de merma / no conforme. Retenida fuera de operación comercial.',
      esVendible: false,
      esElegiblePutawayComercial: false,
      esElegibleAllocation: false,
      esElegiblePicking: false,
      esVisiblePortalComoDisponible: false,
      esVencido: vencido,
      esTransito: false,
      esBloqueado: true,
      cantidadFisica: fisico,
      cantidadDisponibleVendible: 0,
      cantidadReservada: res,
      cantidadBloqueada: fisico,
      cantidadTransitoVigente: 0,
      cantidadExpirada: 0, // No se duplica en Expirado porque MERMA tiene mayor precedencia
      desgloseBloqueado: { merma: fisico, exceso: 0, cuarentenaOtros: 0 },
    };
  }

  // ==========================================================================
  // PRECEDENCIA 2: EXCESO / CUARENTENA
  // ==========================================================================
  if (isLocExceso) {
    return {
      estadoPrincipal: 'EXCESO',
      badgeTexto: 'EXCEDENTE NC',
      badgeColor: 'sky',
      motivo: 'Excedente de recepción en cuarentena. Requiere regularización formal.',
      esVendible: false,
      esElegiblePutawayComercial: false,
      esElegibleAllocation: false,
      esElegiblePicking: false,
      esVisiblePortalComoDisponible: false,
      esVencido: vencido,
      esTransito: false,
      esBloqueado: true,
      cantidadFisica: fisico,
      cantidadDisponibleVendible: 0,
      cantidadReservada: res,
      cantidadBloqueada: fisico,
      cantidadTransitoVigente: 0,
      cantidadExpirada: 0,
      desgloseBloqueado: { merma: 0, exceso: fisico, cuarentenaOtros: 0 },
    };
  }

  // Si todo el registro está retenido por inspección de calidad
  if (disp === 0 && bloq > 0) {
    const isMerma = isMermaCausa || isLocDev;
    return {
      estadoPrincipal: isMerma ? 'MERMA' : 'CUARENTENA',
      badgeTexto: isMerma ? 'MERMA / DAÑO' : 'CUARENTENA',
      badgeColor: 'rose',
      motivo: 'Saldo bloqueado al 100% por control de calidad.',
      esVendible: false,
      esElegiblePutawayComercial: false,
      esElegibleAllocation: false,
      esElegiblePicking: false,
      esVisiblePortalComoDisponible: false,
      esVencido: vencido,
      esTransito: false,
      esBloqueado: true,
      cantidadFisica: fisico,
      cantidadDisponibleVendible: 0,
      cantidadReservada: res,
      cantidadBloqueada: bloq,
      cantidadTransitoVigente: 0,
      cantidadExpirada: 0,
      desgloseBloqueado: isMerma ? { merma: bloq, exceso: 0, cuarentenaOtros: 0 } : { merma: 0, exceso: 0, cuarentenaOtros: bloq },
    };
  }

  // Si el estado de calidad formal es retenido
  if (estadoCalidad !== 'LIBERADO') {
    return {
      estadoPrincipal: 'CUARENTENA',
      badgeTexto: `RETENIDO (${estadoCalidad})`,
      badgeColor: 'rose',
      motivo: `Lote retenido por inspección de calidad (${estadoCalidad}).`,
      esVendible: false,
      esElegiblePutawayComercial: false,
      esElegibleAllocation: false,
      esElegiblePicking: false,
      esVisiblePortalComoDisponible: false,
      esVencido: vencido,
      esTransito: false,
      esBloqueado: true,
      cantidadFisica: fisico,
      cantidadDisponibleVendible: 0,
      cantidadReservada: res,
      cantidadBloqueada: fisico,
      cantidadTransitoVigente: 0,
      cantidadExpirada: 0,
      desgloseBloqueado: { merma: 0, exceso: 0, cuarentenaOtros: fisico },
    };
  }

  // ==========================================================================
  // PRECEDENCIA 3: VENCIDO (EXPIRADO)
  // Prevalece sobre TRANSITO_INTERNO y sobre ALMACENABLE_COMERCIAL
  // ==========================================================================
  if (vencido) {
    const isTransitoLoc = locClass.rolOperativo === 'TRANSITO_INTERNO';
    return {
      estadoPrincipal: 'VENCIDO',
      badgeTexto: isTransitoLoc ? 'VENCIDO · NO ELEGIBLE PARA PUTAWAY' : 'VENCIDO · RETIRAR DE RACK',
      badgeColor: 'rose',
      motivo: isTransitoLoc
        ? `Lote vencido el ${toCalendarDayString(item?.fechaVencimiento)} en andén de recepción (${locCode}). Prohibido su alojamiento en racks comerciales.`
        : `Lote vencido el ${toCalendarDayString(item?.fechaVencimiento)} en ubicación ${locCode}. No disponible para venta ni surtido comercial.`,
      esVendible: false,
      esElegiblePutawayComercial: false, // BLOQUEO ESTRICTO DE PUTAWAY
      esElegibleAllocation: false,       // BLOQUEO ESTRICTO DE ALLOCATION
      esElegiblePicking: false,          // BLOQUEO ESTRICTO DE PICKING
      esVisiblePortalComoDisponible: false,
      esVencido: true,
      esTransito: isTransitoLoc,
      esBloqueado: bloq > 0,
      cantidadFisica: fisico,
      cantidadDisponibleVendible: 0,
      cantidadReservada: res,
      cantidadBloqueada: bloq,
      cantidadTransitoVigente: 0,        // Se descuenta de tránsito vigente
      cantidadExpirada: disp,            // Se canaliza a totalExpirado
      desgloseBloqueado: getDesgloseBloqueado(bloq),
    };
  }

  // ==========================================================================
  // PRECEDENCIA 4: TRANSITO INTERNO (Vigente, no vencido, no bloqueado)
  // ==========================================================================
  if (locClass.rolOperativo === 'TRANSITO_INTERNO') {
    const saldoTransitoLibre = Math.max(0, disp - res);
    return {
      estadoPrincipal: 'TRANSITO_INTERNO',
      badgeTexto: 'EN TRÁNSITO / PENDIENTE DE PUTAWAY',
      badgeColor: 'amber',
      motivo: `Mercancía vigente físicamente en recepción (${locCode}). No vendible hasta completar su Putaway en rack.`,
      esVendible: false,
      esElegiblePutawayComercial: true,  // Mercancía vigente: APTO para Putaway
      esElegibleAllocation: false,
      esElegiblePicking: false,
      esVisiblePortalComoDisponible: false,
      esVencido: false,
      esTransito: true,
      esBloqueado: bloq > 0,
      cantidadFisica: fisico,
      cantidadDisponibleVendible: 0,
      cantidadReservada: res,
      cantidadBloqueada: bloq,
      cantidadTransitoVigente: saldoTransitoLibre,    // Tránsito operativo vigente libre de reserva
      cantidadExpirada: 0,
      desgloseBloqueado: getDesgloseBloqueado(bloq),
    };
  }

  // ==========================================================================
  // PRECEDENCIA 5: NO ELEGIBLE SURTIDO (Staging / Áreas de maniobra)
  // ==========================================================================
  if (locClass.rolOperativo === 'NO_ELEGIBLE_SURTIDO') {
    // Regla de cuadre mutuo: La cantidad no vendible por ubicación es únicamente el saldo libre
    // que no está ya comprometido en cantidadReservada, evitando el doble conteo Tránsito + Reservado.
    const saldoNoVendibleUbicacion = Math.max(0, disp - res);
    return {
      estadoPrincipal: 'NO_ELEGIBLE_SURTIDO',
      badgeTexto: 'EN STAGING / CONSOLIDACIÓN',
      badgeColor: 'sky',
      motivo: `Ubicación operativa en staging (${locCode}): mercancía en consolidación reservada para despacho.`,
      esVendible: false,
      esElegiblePutawayComercial: false,
      esElegibleAllocation: false,
      esElegiblePicking: false,
      esVisiblePortalComoDisponible: false,
      esVencido: false,
      esTransito: false,
      esBloqueado: bloq > 0,
      cantidadFisica: fisico,
      cantidadDisponibleVendible: 0,
      cantidadReservada: res,
      cantidadBloqueada: bloq,
      cantidadTransitoVigente: saldoNoVendibleUbicacion, // Saldo libre en staging no duplicado
      cantidadExpirada: 0,
      desgloseBloqueado: getDesgloseBloqueado(bloq),
    };
  }

  // ==========================================================================
  // PRECEDENCIA 6: DISPONIBLE COMERCIAL (Rack Almacenable Comercial)
  // ==========================================================================
  // El estado es comercial; la reserva y el bloqueo parcial son cuantitativos
  const esTotalmenteReservado = disp > 0 && saldoLibre === 0;
  const esParcialmenteReservado = res > 0 && saldoLibre > 0;

  return {
    estadoPrincipal: 'DISPONIBLE_COMERCIAL',
    badgeTexto: esTotalmenteReservado
      ? 'TOTALMENTE RESERVADO'
      : esParcialmenteReservado
      ? 'CONFORME (CON RESERVA)'
      : 'CONFORME',
    badgeColor: 'emerald',
    motivo: `Mercancía vigente en rack almacenable (${locCode}). Disponible para pedidos y surtido comercial.`,
    esVendible: saldoLibre > 0,
    esElegiblePutawayComercial: true,
    esElegibleAllocation: saldoLibre > 0,
    esElegiblePicking: true,
    esVisiblePortalComoDisponible: saldoLibre > 0,
    esVencido: false,
    esTransito: false,
    esBloqueado: bloq > 0,
    cantidadFisica: fisico,
    cantidadDisponibleVendible: saldoLibre,
    cantidadReservada: res,
    cantidadBloqueada: bloq,
    cantidadTransitoVigente: 0,
    cantidadExpirada: 0,
    desgloseBloqueado: getDesgloseBloqueado(bloq),
  };
}
