/**
 * ============================================================================
 * VALIDADOR CANÓNICO CENTRAL DE ELEGIBILIDAD OPERATIVA PARA PICKING WMS
 * ============================================================================
 * Fuente única de verdad transversal para revalidar la elegibilidad operativa
 * del inventario al momento del surtido (Picking).
 *
 * PRINCIPIO DE DISEÑO:
 * "Revalidate on Execution": Un WMS profesional NUNCA confía ciegamente en una
 * asignación histórica congelada en el tiempo. Si una partida asignada en T0
 * cambia de condición operativa en T1 (caduca, se bloquea por calidad, se traslada
 * a merma/tránsito/staging o su saldo disminuye), el intento de pick en T2 debe
 * ser rechazado inmediatamente con HTTP 409 Conflict.
 *
 * REGLAS EVALUADAS:
 * 1. Existencia del lote asignado en LotInventory.
 * 2. Vigencia / Caducidad (isExpired contra fecha operativa). -> LOTE_VENCIDO
 * 3. Ubicación física actual en celda ALMACENABLE_COMERCIAL. -> UBICACION_NO_ELEGIBLE
 * 4. Control de calidad y bloqueos (estadoCalidad === 'LIBERADO'). -> LOTE_BLOQUEADO
 * 5. Coincidencia estricta de asignación vs realidad física. -> ASIGNACION_DESACTUALIZADA
 * 6. Disponibilidad de saldo físico suficiente en rack. -> STOCK_INSUFICIENTE
 * 7. Reserva cuantitativa activa para la orden. -> ASIGNACION_DESACTUALIZADA
 * 8. Elegibilidad central devuelta por evaluateInventoryItemOperationalState().
 */

import { HttpException, HttpStatus } from '@nestjs/common';
import {
  classifyLocationOperationalRole,
  LocationOperationalClassification,
} from './location-classifier.util';
import {
  evaluateInventoryItemOperationalState,
  isExpired,
  toCalendarDayString,
  EvaluatedInventoryState,
} from './inventory-operational-state.util';

export type PickingConflictCode =
  | 'LOTE_VENCIDO'
  | 'UBICACION_NO_ELEGIBLE'
  | 'LOTE_BLOQUEADO'
  | 'ASIGNACION_DESACTUALIZADA'
  | 'STOCK_INSUFICIENTE'
  | 'LOTE_NO_ELEGIBLE_PICKING'
  | 'INVENTARIO_LEGADO_SIN_HU'
  | 'HU_REQUERIDA'
  | 'HU_NO_ENCONTRADA'
  | 'HU_NO_ACTIVA'
  | 'HU_SKU_NO_COINCIDE'
  | 'HU_LOTE_NO_COINCIDE'
  | 'HU_UBICACION_NO_COINCIDE'
  | 'HU_YA_ESCANEADA'
  | 'HU_CANTIDAD_EXCEDE_PENDIENTE';

export interface PickingValidationParams {
  orderId: string;
  lineId: string;
  requestedQty?: number;
  taskLotId?: string | null;
  taskLoteCodigo?: string | null;
  taskUbicacionCodigo?: string | null;
  businessDate?: Date;
  requirePhysicalHu?: boolean;
}

export interface PickingValidationSuccess {
  valido: true;
  line: any;
  freshLot: any;
  opState: EvaluatedInventoryState;
  locRole: LocationOperationalClassification;
  targetLotId: string;
  targetLocId: string;
  targetLocCodigo: string;
  totalActiveHus?: number;
}

export interface PickingValidationFailure {
  valido: false;
  codigoError: PickingConflictCode;
  motivo: string;
  mensajeUsuario: string;
  opState?: EvaluatedInventoryState;
  freshLot?: any;
  line?: any;
  requiereRegularizacion?: boolean;
  requiereRevalidacion?: boolean;
}

export type PickingValidationOutcome = PickingValidationSuccess | PickingValidationFailure;

/**
 * Revalida la elegibilidad física y operativa de una línea de pedido y su lote asignado
 * de forma canónica y centralizada.
 *
 * @param client PrismaClient o cliente de transacción transaccional (tx)
 * @param params Parámetros de la orden, línea, lote y cantidad a pickear
 * @param options Opciones: throwOnConflict (true para mutaciones, false para validación read-only)
 */
export async function validatePickingEligibility(
  client: any,
  params: PickingValidationParams,
  options: { throwOnConflict: true },
): Promise<PickingValidationSuccess>;
export async function validatePickingEligibility(
  client: any,
  params: PickingValidationParams,
  options?: { throwOnConflict?: boolean },
): Promise<PickingValidationOutcome>;
export async function validatePickingEligibility(
  client: any,
  params: PickingValidationParams,
  options: { throwOnConflict?: boolean } = { throwOnConflict: true },
): Promise<PickingValidationOutcome> {
  const businessDate = params.businessDate || new Date();
  const requestedQty = params.requestedQty !== undefined ? Number(params.requestedQty) : 0;

  // 1. Cargar línea de pedido fresca con relaciones necesarias
  const line = await client.salesOrderLine.findUnique({
    where: { id: params.lineId },
    include: {
      orden: true,
      sku: true,
      lote: { include: { ubicacion: { include: { zona: true, almacen: true } } } },
    },
  });

  if (!line) {
    const failure: PickingValidationFailure = {
      valido: false,
      codigoError: 'ASIGNACION_DESACTUALIZADA',
      motivo: `Línea de pedido ${params.lineId} no encontrada en base de datos.`,
      mensajeUsuario: 'La línea de pedido especificada no existe en el sistema.',
    };
    if (options.throwOnConflict) raiseConflict(failure);
    return failure;
  }

  if (line.orderId !== params.orderId) {
    const failure: PickingValidationFailure = {
      valido: false,
      codigoError: 'ASIGNACION_DESACTUALIZADA',
      motivo: `La línea ${params.lineId} no pertenece a la orden ${params.orderId}.`,
      mensajeUsuario: 'Discrepancia entre la orden solicitada y la línea de pedido.',
      line,
    };
    if (options.throwOnConflict) raiseConflict(failure);
    return failure;
  }

  // 2. Determinar la asignación esperada (específica de la tarea o global de la línea)
  let expectedLotId = params.taskLotId || line.lotId;
  let expectedLoteCodigo = (params.taskLoteCodigo || line.loteAsignado || line.lote?.lote || '').trim().toUpperCase();
  let expectedLocCode = (params.taskUbicacionCodigo || line.ubicacionAsignada || line.lote?.ubicacion?.codigo || '').trim().toUpperCase();

  // Si existe desglose estructurado en asignacionesJson, verificar si la tarea corresponde
  if (line.asignacionesJson) {
    try {
      const parsed = JSON.parse(line.asignacionesJson);
      if (Array.isArray(parsed) && parsed.length > 0) {
        let matchingAlloc: any = null;
        if (params.taskLotId) {
          matchingAlloc = parsed.find((a: any) => a.lotId === params.taskLotId);
        } else if (params.taskUbicacionCodigo) {
          matchingAlloc = parsed.find(
            (a: any) => (a.ubicacionCodigo || '').trim().toUpperCase() === params.taskUbicacionCodigo?.trim().toUpperCase(),
          );
        } else if (params.taskLoteCodigo) {
          matchingAlloc = parsed.find(
            (a: any) => (a.lote || '').trim().toUpperCase() === params.taskLoteCodigo?.trim().toUpperCase(),
          );
        }

        if (matchingAlloc) {
          if (matchingAlloc.lotId) expectedLotId = matchingAlloc.lotId;
          if (matchingAlloc.lote) expectedLoteCodigo = matchingAlloc.lote.trim().toUpperCase();
          if (matchingAlloc.ubicacionCodigo) expectedLocCode = matchingAlloc.ubicacionCodigo.trim().toUpperCase();
        }
      }
    } catch (_) {}
  }

  // 3. Revalidar que haya un lote asignado
  if (!expectedLotId && !expectedLoteCodigo) {
    const failure: PickingValidationFailure = {
      valido: false,
      codigoError: 'ASIGNACION_DESACTUALIZADA',
      motivo: 'La línea de pedido no tiene ningún lote asignado en el sistema.',
      mensajeUsuario: 'Esta línea no cuenta con lote asignado. Requiere asignación previa por el supervisor.',
      line,
    };
    if (options.throwOnConflict) raiseConflict(failure);
    return failure;
  }

  // 4. Cargar registro vivo de LotInventory en base de datos
  let freshLot: any = null;
  if (expectedLotId) {
    freshLot = await client.lotInventory.findUnique({
      where: { id: expectedLotId },
      include: {
        ubicacion: { include: { zona: true, almacen: true } },
        sku: true,
      },
    });
  }

  if (!freshLot && expectedLoteCodigo) {
    freshLot = await client.lotInventory.findFirst({
      where: {
        lote: { equals: expectedLoteCodigo, mode: 'insensitive' },
        skuId: line.skuId,
      },
      include: {
        ubicacion: { include: { zona: true, almacen: true } },
        sku: true,
      },
    });
  }

  if (!freshLot) {
    const failure: PickingValidationFailure = {
      valido: false,
      codigoError: 'ASIGNACION_DESACTUALIZADA',
      motivo: `El lote asignado (${expectedLoteCodigo || expectedLotId}) ya no existe en el inventario del almacén.`,
      mensajeUsuario: `El lote asignado "${expectedLoteCodigo || 'N/A'}" no fue encontrado en inventario físico.`,
      line,
    };
    if (options.throwOnConflict) raiseConflict(failure);
    return failure;
  }

  // 5. Clasificar la ubicación física actual del lote en BD
  const locRole = classifyLocationOperationalRole(freshLot.ubicacion);
  const actualLocCode = (freshLot.ubicacion?.codigo || '').trim().toUpperCase();

  // 6. Evaluar estado operativo centralizado por precedencia
  const opState = evaluateInventoryItemOperationalState(freshLot, locRole, businessDate);

  // 7. REGLA: Vigencia / Caducidad
  const vencido = isExpired(freshLot.fechaVencimiento, businessDate, true) || opState.esVencido || opState.estadoPrincipal === 'VENCIDO';
  if (vencido) {
    const fechaCadStr = toCalendarDayString(freshLot.fechaVencimiento) || 'Fecha desconocida';
    const failure: PickingValidationFailure = {
      valido: false,
      codigoError: 'LOTE_VENCIDO',
      motivo: `Lote vencido: El lote ${freshLot.lote} expiró el ${fechaCadStr} y no es elegible para picking comercial.`,
      mensajeUsuario: `Lote vencido el ${fechaCadStr}. Prohibido su surtido y despacho comercial.`,
      opState,
      freshLot,
      line,
    };
    if (options.throwOnConflict) raiseConflict(failure);
    return failure;
  }

  // 8. REGLA: Ubicación física comercialmente almacenable (no tránsito, no merma, no staging)
  if (locRole.rolOperativo !== 'ALMACENABLE_COMERCIAL') {
    const failure: PickingValidationFailure = {
      valido: false,
      codigoError: 'UBICACION_NO_ELEGIBLE',
      motivo: `Ubicación no elegible: El lote se encuentra físicamente en ${actualLocCode || 'SIN UBICACIÓN'} (${locRole.badgeTexto}), no habilitada para surtido directo.`,
      mensajeUsuario: `Ubicación no elegible (${actualLocCode || 'N/A'}: ${locRole.badgeTexto}). La mercancía no está en posición comercial de rack.`,
      opState,
      freshLot,
      line,
    };
    if (options.throwOnConflict) raiseConflict(failure);
    return failure;
  }

  // 9. REGLA: Coincidencia entre ubicación asignada y ubicación física actual del lote
  if (expectedLocCode && actualLocCode && expectedLocCode !== actualLocCode) {
    const failure: PickingValidationFailure = {
      valido: false,
      codigoError: 'ASIGNACION_DESACTUALIZADA',
      motivo: `Asignación desactualizada: La ubicación física actual del lote (${actualLocCode}) difiere de la ubicación programada (${expectedLocCode}). El lote fue reubicado.`,
      mensajeUsuario: `El lote fue movido de ${expectedLocCode} a ${actualLocCode}. La asignación requiere actualización.`,
      opState,
      freshLot,
      line,
    };
    if (options.throwOnConflict) raiseConflict(failure);
    return failure;
  }

  // 10. REGLA: Calidad y bloqueos
  const isBloqueado =
    opState.esBloqueado ||
    Number(freshLot.cantidadBloqueada || 0) > 0 ||
    String(freshLot.estadoCalidad || '').toUpperCase() !== 'LIBERADO' ||
    opState.estadoPrincipal === 'MERMA' ||
    opState.estadoPrincipal === 'CUARENTENA';

  if (isBloqueado) {
    const failure: PickingValidationFailure = {
      valido: false,
      codigoError: 'LOTE_BLOQUEADO',
      motivo: `Lote bloqueado: El lote ${freshLot.lote} está retenido por control de calidad (${opState.badgeTexto}: ${opState.motivo}).`,
      mensajeUsuario: `Lote en estado ${freshLot.estadoCalidad || 'BLOQUEADO'}. No disponible para surtido comercial.`,
      opState,
      freshLot,
      line,
    };
    if (options.throwOnConflict) raiseConflict(failure);
    return failure;
  }

  // 11. REGLA: Elegibilidad central de picking
  if (!opState.esElegiblePicking) {
    const failure: PickingValidationFailure = {
      valido: false,
      codigoError: 'LOTE_NO_ELEGIBLE_PICKING',
      motivo: `Lote no elegible para picking: ${opState.motivo}`,
      mensajeUsuario: `Lote no elegible para picking (${opState.badgeTexto}).`,
      opState,
      freshLot,
      line,
    };
    if (options.throwOnConflict) raiseConflict(failure);
    return failure;
  }

  // 12. REGLA: Existencia física disponible suficiente en rack
  const cantDisponible = Number(freshLot.cantidadDisponible || 0);
  if (requestedQty > 0 && cantDisponible < requestedQty) {
    const failure: PickingValidationFailure = {
      valido: false,
      codigoError: 'STOCK_INSUFICIENTE',
      motivo: `Stock insuficiente: Existencia física disponible insuficiente en rack (${cantDisponible} pzas disponibles vs ${requestedQty} pzas requeridas).`,
      mensajeUsuario: `Existencia física insuficiente en rack. Disponible real: ${cantDisponible}, Requerido: ${requestedQty}.`,
      opState,
      freshLot,
      line,
    };
    if (options.throwOnConflict) raiseConflict(failure);
    return failure;
  }

  // 13. REGLA: Reserva cuantitativa vigente para la orden
  const cantReservada = Number(freshLot.cantidadReservada || 0);
  if (requestedQty > 0 && cantReservada <= 0) {
    const failure: PickingValidationFailure = {
      valido: false,
      codigoError: 'ASIGNACION_DESACTUALIZADA',
      motivo: `Reserva no vigente: El lote ${freshLot.lote} tiene reserva en cero (0 pzas). La asignación original fue liberada o caducó.`,
      mensajeUsuario: 'La reserva física de este lote fue liberada o reasignada. Requiere revalidación.',
      opState,
      freshLot,
      line,
    };
    if (options.throwOnConflict) raiseConflict(failure);
    return failure;
  }

  // 14. REGLA: Trazabilidad Física por Unidades de Manejo (HU-Managed vs Inventario Legado)
  // Cuando una asignación corresponde a un LotInventory que tiene stock pero 0 HUs físicas asociadas,
  // clasificar como INVENTARIO_LEGADO_SIN_HU · REQUIERE REGULARIZACIÓN
  let activeHusCount = 0;
  if (client.handlingUnit && typeof client.handlingUnit.count === 'function') {
    activeHusCount = await client.handlingUnit.count({
      where: {
        tipoHu: 'CAJA',
        estadoHu: 'ACTIVO',
        OR: [
          { lotId: freshLot.id },
          { loteTexto: freshLot.lote },
        ],
      },
    });

    const requiresPhysicalHu = params.requirePhysicalHu !== false;
    if (requiresPhysicalHu && activeHusCount === 0) {
      const failure: PickingValidationFailure = {
        valido: false,
        codigoError: 'INVENTARIO_LEGADO_SIN_HU',
        motivo: `Inventario legado sin HU: El lote ${freshLot.lote} cuenta con existencia física en LotInventory pero no tiene unidades de manejo (cajas/HUs) físicas trazables registradas.`,
        mensajeUsuario: 'ASIGNACIÓN REQUIERE REGULARIZACIÓN: El inventario asignado no cuenta con unidades de manejo físicas trazables. No puede surtirse mediante el flujo de escaneo de cajas.',
        opState,
        freshLot,
        line,
        requiereRegularizacion: true,
      };
      if (options.throwOnConflict) raiseConflict(failure);
      return failure;
    }
  }

  // Todo conforme: Asignación e inventario plenamente elegibles
  return {
    valido: true,
    line,
    freshLot,
    opState,
    locRole,
    targetLotId: freshLot.id,
    targetLocId: freshLot.ubicacionId || '',
    targetLocCodigo: actualLocCode,
    totalActiveHus: activeHusCount,
  };
}

/**
 * Lanza una excepción canónica HTTP 409 Conflict con estructura normalizada.
 */
function raiseConflict(failure: PickingValidationFailure): never {
  const isRegularizacion = failure.codigoError === 'INVENTARIO_LEGADO_SIN_HU';
  throw new HttpException(
    {
      statusCode: HttpStatus.CONFLICT,
      code: failure.codigoError,
      codigoError: failure.codigoError,
      message: isRegularizacion
        ? `ASIGNACIÓN REQUIERE REGULARIZACIÓN: ${failure.motivo}`
        : `ASIGNACIÓN REQUIERE REVALIDACIÓN: ${failure.motivo}`,
      motivo: failure.motivo,
      mensajeUsuario: failure.mensajeUsuario,
      requiereRegularizacion: Boolean(failure.requiereRegularizacion),
      error: 'Conflict',
    },
    HttpStatus.CONFLICT,
  );
}
