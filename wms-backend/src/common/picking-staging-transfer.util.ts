import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * ============================================================================
 * UTILITARIO CANÓNICO DE ALLOCATION HU-AWARE Y TRASLADO PICKING → STAGING
 * ============================================================================
 * 1. Allocation HU-Aware: Comprueba antes de reservar que la cantidad solicitada
 *    puede ser satisfecha exactamente por una combinación de HUs físicas activas
 *    y no comprometidas, previniendo deadlocks en Picking por HUs indivisibles.
 * 2. Staging Persistente por Orden: Asigna una ubicación de Staging única y fija
 *    por pedido (reutilizada por todas sus HUs).
 * 3. Traslado Físico Picking → Staging: Ejecuta la reubicación atómica de la HU,
 *    decremento de rack, incremento de staging y Kárdex (TRASIEGO).
 */

export interface HuAllocationValidationParams {
  tx: any;
  lotId: string;
  clienteId: string;
  requestedQty: number;
  rackLocationCodigo?: string;
  skuCodigo?: string;
  currentOrderId?: string;
}

export interface HuAllocationValidationResult {
  esHuManaged: boolean;
  valido: boolean;
  codigoError?: string;
  mensaje?: string;
  availableHusCount: number;
  freeHusCount: number;
  huCapacities: number[];
  assignedHus: Array<{ id: string; codigo: string; cantidad: number }>;
}

/**
 * Algoritmo exacto de combinación de HUs (Subset-Sum):
 * Encuentra un subconjunto de HUs cuya suma de capacidades sea idéntica al target.
 */
export function findExactHuCombination(
  hus: Array<{ id: string; codigo: string; cantidad: number }>,
  target: number,
): Array<{ id: string; codigo: string; cantidad: number }> | null {
  const result: Array<{ id: string; codigo: string; cantidad: number }> = [];

  function backtrack(
    index: number,
    currentSum: number,
    selected: Array<{ id: string; codigo: string; cantidad: number }>,
  ): boolean {
    if (currentSum === target) {
      result.push(...selected);
      return true;
    }
    if (currentSum > target || index >= hus.length) {
      return false;
    }

    // Opción 1: Incluir la HU actual
    selected.push(hus[index]);
    if (backtrack(index + 1, currentSum + hus[index].cantidad, selected)) {
      return true;
    }
    selected.pop();

    // Opción 2: Omitir la HU actual
    return backtrack(index + 1, currentSum, selected);
  }

  const found = backtrack(0, 0, []);
  return found ? result : null;
}

/**
 * Valida de forma autoritativa si una cantidad a asignar puede satisfacerse con HUs completas.
 */
export async function validateHuAllocationCompatibility(
  params: HuAllocationValidationParams,
): Promise<HuAllocationValidationResult> {
  const { tx, lotId, clienteId, requestedQty, currentOrderId } = params;

  // 1. Obtener registro del lote
  const lot = await tx.lotInventory.findUnique({
    where: { id: lotId },
    include: { ubicacion: true },
  });

  if (!lot) {
    return {
      esHuManaged: false,
      valido: false,
      codigoError: 'LOTE_NO_ENCONTRADO',
      mensaje: `Lote ${lotId} no encontrado.`,
      availableHusCount: 0,
      freeHusCount: 0,
      huCapacities: [],
      assignedHus: [],
    };
  }

  // 2. Buscar HUs activas asociadas a este lote y ubicación
  const activeHus = await tx.handlingUnit.findMany({
    where: {
      OR: [
        { lotId },
        { loteTexto: lot.lote, clienteId },
      ],
      estadoHu: 'ACTIVO',
      ...(lot.ubicacion?.codigo ? { ubicacionActual: lot.ubicacion.codigo } : {}),
    },
    orderBy: { codigo: 'asc' },
  });

  if (activeHus.length === 0) {
    // Inventario legado sin HUs: no se gestiona por cajas completas
    return {
      esHuManaged: false,
      valido: true,
      availableHusCount: 0,
      freeHusCount: 0,
      huCapacities: [],
      assignedHus: [],
    };
  }

  // 3. Identificar HUs ya comprometidas/asignadas a otras órdenes activas
  const otherActiveLines = await tx.salesOrderLine.findMany({
    where: {
      ...(currentOrderId ? { orderId: { not: currentOrderId } } : {}),
      orden: {
        estado: { in: ['SOLICITADO', 'APROBADO', 'EN_PICKING', 'EN_RECOLECCION', 'CONSOLIDADO'] },
      },
    },
    select: { asignacionesJson: true, huId: true, cajaEscaneada: true },
  });

  const committedHuCodes = new Set<string>();
  const committedHuIds = new Set<string>();

  for (const line of otherActiveLines) {
    if (line.huId) committedHuIds.add(line.huId);
    if (line.cajaEscaneada) {
      line.cajaEscaneada.split(',').forEach((c: string) => committedHuCodes.add(c.trim().toUpperCase()));
    }
    if (line.asignacionesJson) {
      try {
        const parsed = JSON.parse(line.asignacionesJson);
        if (Array.isArray(parsed)) {
          parsed.forEach((item: any) => {
            if (Array.isArray(item.husAsignadas)) {
              item.husAsignadas.forEach((h: any) => {
                if (h.id) committedHuIds.add(h.id);
                if (h.codigo) committedHuCodes.add(h.codigo.toUpperCase());
              });
            }
            if (Array.isArray(item.cajasEscaneadas)) {
              item.cajasEscaneadas.forEach((c: string) => committedHuCodes.add(c.toUpperCase()));
            }
            if (item.huId) committedHuIds.add(item.huId);
            if (item.huCodigo) committedHuCodes.add(item.huCodigo.toUpperCase());
          });
        }
      } catch (_) {}
    }
  }

  // 4. Filtrar HUs no comprometidas
  const freeHus = activeHus.filter(
    h => !committedHuIds.has(h.id) && !committedHuCodes.has(h.codigo.toUpperCase()),
  );

  const huCandidates = freeHus.map(h => ({
    id: h.id,
    codigo: h.codigo,
    cantidad: Number(h.cantidad || h.piezasPorCaja || 0),
  }));

  // 5. Buscar combinación exacta
  const exactCombo = findExactHuCombination(huCandidates, requestedQty);

  if (!exactCombo) {
    return {
      esHuManaged: true,
      valido: false,
      codigoError: 'CANTIDAD_NO_COMPATIBLE_CON_HU',
      mensaje: `La cantidad solicitada (${requestedQty} pzas) no puede satisfacerse mediante unidades de manejo completas del lote ${lot.lote || lotId}. Capacidades de HUs libres: [${huCandidates.map(h => h.cantidad).join(', ')}]. Se prohíbe el fraccionamiento de cajas sin flujo formal de acondicionamiento/split.`,
      availableHusCount: activeHus.length,
      freeHusCount: freeHus.length,
      huCapacities: huCandidates.map(h => h.cantidad),
      assignedHus: [],
    };
  }

  return {
    esHuManaged: true,
    valido: true,
    availableHusCount: activeHus.length,
    freeHusCount: freeHus.length,
    huCapacities: huCandidates.map(h => h.cantidad),
    assignedHus: exactCombo,
  };
}

export interface PickingStagingTransferParams {
  orderId: string;
  orderCodigo?: string;
  lineId: string;
  huCode: string;
  rackLocationCode: string;
  usuario: string;
}

export interface PickingStagingTransferResult {
  huId: string;
  huCodigo: string;
  cantidadHu: number;
  rackLocation: { id: string; codigo: string };
  stagingLocation: { id: string; codigo: string };
  originLotId: string;
  stagingLotId: string;
  movementId: string;
  alreadyInStaging: boolean;
}

export async function transferHuToStaging(
  tx: any,
  params: PickingStagingTransferParams,
): Promise<PickingStagingTransferResult> {
  const { orderId, orderCodigo, lineId, huCode, rackLocationCode, usuario } = params;
  const rawHu = huCode.trim();

  // 1. Relectura autoritativa de la Handling Unit
  const hu = await tx.handlingUnit.findFirst({
    where: { codigo: { equals: rawHu, mode: 'insensitive' } },
    include: {
      lote: { include: { ubicacion: true } },
    },
  });

  if (!hu) {
    throw new HttpException(
      {
        statusCode: HttpStatus.CONFLICT,
        code: 'HU_NO_ENCONTRADA',
        codigoError: 'HU_NO_ENCONTRADA',
        message: `Unidad de manejo no encontrada: La etiqueta "${rawHu}" no existe en el catálogo físico.`,
        error: 'Conflict',
      },
      HttpStatus.CONFLICT,
    );
  }

  if (hu.estadoHu !== 'ACTIVO') {
    throw new HttpException(
      {
        statusCode: HttpStatus.CONFLICT,
        code: 'HU_NO_ACTIVA',
        codigoError: 'HU_NO_ACTIVA',
        message: `Caja no disponible: La HU "${rawHu}" se encuentra en estado ${hu.estadoHu}.`,
        error: 'Conflict',
      },
      HttpStatus.CONFLICT,
    );
  }

  // 2. Relectura de la ubicación física de origen (Rack)
  const cleanRackCode = rackLocationCode.trim().toUpperCase();
  const rackLoc = await tx.location.findFirst({
    where: { codigo: { equals: cleanRackCode, mode: 'insensitive' } },
    include: { almacen: true },
  });

  if (!rackLoc) {
    throw new HttpException(
      {
        statusCode: HttpStatus.CONFLICT,
        code: 'UBICACION_ORIGEN_NO_ENCONTRADA',
        codigoError: 'UBICACION_ORIGEN_NO_ENCONTRADA',
        message: `Ubicación de rack "${rackLocationCode}" no encontrada.`,
        error: 'Conflict',
      },
      HttpStatus.CONFLICT,
    );
  }

  // 3. Staging Persistente por Orden:
  //    A. Buscar si este pedido ya tiene una ubicación de Staging fijada en alguna de sus líneas
  let stagingLoc: any = null;

  const orderLines = await tx.salesOrderLine.findMany({
    where: { orderId },
    select: { id: true, asignacionesJson: true },
  });

  let priorStagingId: string | null = null;
  let priorStagingCode: string | null = null;

  for (const ol of orderLines) {
    if (ol.asignacionesJson) {
      try {
        const parsed = JSON.parse(ol.asignacionesJson);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (item.stagingLocationId) priorStagingId = item.stagingLocationId;
            if (item.stagingLocationCodigo) priorStagingCode = item.stagingLocationCodigo;
            if (priorStagingId || priorStagingCode) break;
          }
        }
      } catch (_) {}
    }
    if (priorStagingId || priorStagingCode) break;
  }

  if (priorStagingId) {
    stagingLoc = await tx.location.findUnique({
      where: { id: priorStagingId },
    });
  } else if (priorStagingCode) {
    stagingLoc = await tx.location.findFirst({
      where: { codigo: { equals: priorStagingCode, mode: 'insensitive' } },
    });
  }

  // B. Si el pedido aún no tiene Staging asignado, seleccionar dinámicamente en el mismo almacén
  if (!stagingLoc) {
    stagingLoc = await tx.location.findFirst({
      where: {
        almacenId: rackLoc.almacenId,
        tipoUbicacion: 'STAGING',
        activo: true,
        estado: { not: 'BLOQUEADO' },
      },
      orderBy: { codigo: 'asc' },
    });

    if (!stagingLoc) {
      stagingLoc = await tx.location.findFirst({
        where: {
          almacenId: rackLoc.almacenId,
          OR: [{ codigo: { startsWith: 'STG' } }, { zona: { tipoZona: 'STAGING' } }],
          activo: true,
          estado: { not: 'BLOQUEADO' },
        },
        orderBy: { codigo: 'asc' },
      });
    }
  }

  if (!stagingLoc) {
    throw new HttpException(
      {
        statusCode: HttpStatus.CONFLICT,
        code: 'STAGING_NO_CONFIGURADO',
        codigoError: 'STAGING_NO_CONFIGURADO',
        message: `No se encontró una ubicación de Staging activa en el almacén ${rackLoc.almacen?.codigo || rackLoc.almacenId}.`,
        error: 'Conflict',
      },
      HttpStatus.CONFLICT,
    );
  }

  // 4. Idempotencia: Verificar si la HU ya reside en la ubicación Staging fijada
  const currentHuUbi = (hu.ubicacionActual || '').trim().toUpperCase();
  if (currentHuUbi === stagingLoc.codigo.toUpperCase()) {
    return {
      huId: hu.id,
      huCodigo: hu.codigo,
      cantidadHu: hu.cantidad,
      rackLocation: { id: rackLoc.id, codigo: rackLoc.codigo },
      stagingLocation: { id: stagingLoc.id, codigo: stagingLoc.codigo },
      originLotId: hu.lotId,
      stagingLotId: hu.lotId,
      movementId: 'EXISTING_STAGING',
      alreadyInStaging: true,
    };
  }

  // 5. Relectura de LotInventory origen en el rack
  let originLot: any = null;
  if (hu.lotId) {
    originLot = await tx.lotInventory.findFirst({
      where: { id: hu.lotId, ubicacionId: rackLoc.id },
    });
  }

  if (!originLot) {
    let skuId = null;
    if (hu.skuCodigo) {
      const sku = await tx.skuMaster.findFirst({ where: { codigo: hu.skuCodigo } });
      skuId = sku?.id;
    }
    originLot = await tx.lotInventory.findFirst({
      where: {
        ...(skuId ? { skuId } : {}),
        lote: hu.loteTexto,
        clienteId: hu.clienteId,
        ubicacionId: rackLoc.id,
      },
    });
  }

  if (!originLot) {
    throw new HttpException(
      {
        statusCode: HttpStatus.CONFLICT,
        code: 'LOTE_ORIGEN_NO_ENCONTRADO',
        codigoError: 'LOTE_ORIGEN_NO_ENCONTRADO',
        message: `No se encontró saldo de inventario para la HU "${hu.codigo}" en el rack "${rackLoc.codigo}".`,
        error: 'Conflict',
      },
      HttpStatus.CONFLICT,
    );
  }

  const huQty = Number(hu.cantidad || hu.piezasPorCaja || 0);
  if (huQty <= 0) {
    throw new HttpException(
      {
        statusCode: HttpStatus.CONFLICT,
        code: 'HU_CANTIDAD_INVALIDA',
        codigoError: 'HU_CANTIDAD_INVALIDA',
        message: `La HU "${hu.codigo}" tiene una cantidad registrada inválida (0 o negativa).`,
        error: 'Conflict',
      },
      HttpStatus.CONFLICT,
    );
  }

  if (originLot.cantidadDisponible < huQty) {
    throw new HttpException(
      {
        statusCode: HttpStatus.CONFLICT,
        code: 'STOCK_INSUFICIENTE_ORIGEN',
        codigoError: 'STOCK_INSUFICIENTE_ORIGEN',
        message: `Stock insuficiente en rack ${rackLoc.codigo} (Disponible: ${originLot.cantidadDisponible}, Requerido por HU: ${huQty}).`,
        error: 'Conflict',
      },
      HttpStatus.CONFLICT,
    );
  }

  const reservedToMove = Math.min(huQty, Math.max(0, Number(originLot.cantidadReservada || 0)));

  // 6. Descontar físicamente del LotInventory origen (Rack)
  await tx.lotInventory.update({
    where: { id: originLot.id },
    data: {
      cantidadDisponible: { decrement: huQty },
      cantidadReservada: { decrement: reservedToMove },
    },
  });

  // 7. Incrementar o crear LotInventory en Staging
  let stagingLot = await tx.lotInventory.findFirst({
    where: {
      skuId: originLot.skuId,
      clienteId: originLot.clienteId,
      lote: originLot.lote,
      ubicacionId: stagingLoc.id,
    },
  });

  if (stagingLot) {
    await tx.lotInventory.update({
      where: { id: stagingLot.id },
      data: {
        cantidadDisponible: { increment: huQty },
        cantidadReservada: { increment: reservedToMove },
      },
    });
  } else {
    stagingLot = await tx.lotInventory.create({
      data: {
        skuId: originLot.skuId,
        clienteId: originLot.clienteId,
        lote: originLot.lote,
        serie: originLot.serie,
        fechaVencimiento: originLot.fechaVencimiento,
        fechaProduccion: originLot.fechaProduccion,
        proveedorNombre: originLot.proveedorNombre,
        estadoCalidad: originLot.estadoCalidad,
        cantidadDisponible: huQty,
        cantidadReservada: reservedToMove,
        cantidadBloqueada: 0,
        ubicacionId: stagingLoc.id,
        notas: `Consolidación de pedidos en Staging (${stagingLoc.codigo})`,
      },
    });
  }

  // 8. Traslado Físico de la Handling Unit a Staging
  await tx.handlingUnit.update({
    where: { id: hu.id },
    data: {
      ubicacionActual: stagingLoc.codigo,
      lotId: stagingLot.id,
    },
  });

  // 9. Registro de Trazabilidad Oficial en Kardex (InventoryMovement)
  const movement = await tx.inventoryMovement.create({
    data: {
      tipoMovimiento: 'TRASIEGO',
      skuId: originLot.skuId,
      clienteId: originLot.clienteId,
      lotId: stagingLot.id,
      huId: hu.id,
      fromLocationId: rackLoc.id,
      toLocationId: stagingLoc.id,
      cantidad: huQty,
      usuario: usuario || 'Surtidor',
      motivo: `PICKING_A_STAGING: Traslado de HU ${hu.codigo} desde ${rackLoc.codigo} a ${stagingLoc.codigo}`,
      documentoOrigen: orderCodigo || orderId,
    },
  });

  return {
    huId: hu.id,
    huCodigo: hu.codigo,
    cantidadHu: huQty,
    rackLocation: { id: rackLoc.id, codigo: rackLoc.codigo },
    stagingLocation: { id: stagingLoc.id, codigo: stagingLoc.codigo },
    originLotId: originLot.id,
    stagingLotId: stagingLot.id,
    movementId: movement.id,
    alreadyInStaging: false,
  };
}
