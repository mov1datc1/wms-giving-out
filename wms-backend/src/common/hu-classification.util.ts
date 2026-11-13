import { HttpException, HttpStatus } from '@nestjs/common';

const CONTAINER_HU_TYPES = new Set(['PALLET', 'TARIMA', 'CONTENEDOR', 'MASTER_PALLET']);
const CONTAINER_HU_UOMS = new Set(['TARIMA', 'PALLET', 'CONTENEDOR']);

/**
 * Determina si una Handling Unit corresponde a un contenedor logístico padre
 * (Tarima Master / Pallet) en lugar de una HU comercial inventariable/pickeable.
 */
export function isContainerMasterHuRecord(
  hu: any,
  parentIdsWithChildren?: Set<string>,
): boolean {
  if (!hu) return false;

  if (hu.id && parentIdsWithChildren?.has(hu.id)) {
    return true;
  }

  const tipo = String(hu.tipoHu || '').toUpperCase().trim();
  const uom = String(hu.uom || '').toUpperCase().trim();
  const codigo = String(hu.codigo || '').toUpperCase().trim();

  if (CONTAINER_HU_TYPES.has(tipo)) {
    return true;
  }

  if (CONTAINER_HU_UOMS.has(uom)) {
    return true;
  }

  const hasDirectProductRef = Boolean(hu.skuCodigo || hu.lotId);
  if (codigo.startsWith('PLT-') && !hasDirectProductRef) {
    return true;
  }

  return false;
}

/**
 * Devuelve true únicamente para HUs físicas comerciales aptas para allocation,
 * picking y despacho (ej. CAJA, BULTO, PAQUETE, PIEZA), excluyendo Tarimas Master.
 */
export function isInventariablePickableHu(
  hu: any,
  parentIdsWithChildren?: Set<string>,
): boolean {
  if (!hu) return false;
  return !isContainerMasterHuRecord(hu, parentIdsWithChildren);
}

/**
 * Lanza HTTP 409 Conflict cuando se intenta reservar, surtir, trasladar o despachar
 * una Tarima Master / contenedor logístico como si fuera mercancía suelta.
 */
export function assertPickableProductHu(
  hu: any,
  parentIdsWithChildren?: Set<string>,
): void {
  if (isContainerMasterHuRecord(hu, parentIdsWithChildren)) {
    throw new HttpException(
      {
        statusCode: HttpStatus.CONFLICT,
        code: 'HU_CONTENEDOR_NO_PICKABLE',
        codigoError: 'HU_CONTENEDOR_NO_PICKABLE',
        message: `La unidad de manejo "${hu?.codigo || 'Tarima Master'}" es un contenedor logístico padre y no puede reservarse, surtirse ni despacharse como stock comercial. Seleccione o escanee una HU hija (caja/bulto) inventariable.`,
        error: 'Conflict',
      },
      HttpStatus.CONFLICT,
    );
  }
}

/**
 * Obtiene el actor operativo exclusivamente desde la sesión JWT autenticada (`req.user`),
 * ignorando cualquier nombre/usuario suplantado en el payload del cliente.
 */
export function getRequestActor(req: any, defaultActor = 'Sistema'): string {
  const email = typeof req?.user?.email === 'string' ? req.user.email.trim() : '';
  if (email) return email;
  const nombre = typeof req?.user?.nombre === 'string' ? req.user.nombre.trim() : '';
  if (nombre) return nombre;
  return defaultActor;
}

const TRANSIENT_OR_VIRTUAL_LOC_PREFIXES = ['STG-', 'REC-', 'DEV-'];
const TRANSIENT_OR_VIRTUAL_LOC_NAMES = new Set([
  'RAMPA_RECEPCION',
  'RECIBO',
  'ANDEN',
  'STAGING',
  'DEVOLUCION',
]);

function isTransientOrStagingLoc(codigo?: string | null): boolean {
  const upper = String(codigo || '').toUpperCase().trim();
  if (!upper) return true;
  if (TRANSIENT_OR_VIRTUAL_LOC_NAMES.has(upper)) return true;
  return TRANSIENT_OR_VIRTUAL_LOC_PREFIXES.some((p) => upper.startsWith(p));
}

function isMermaOrVirtualChildHu(hu: any): boolean {
  const code = String(hu?.codigo || '').toUpperCase().trim();
  const loc = String(hu?.ubicacionActual || '').toUpperCase().trim();
  const est = String(hu?.estadoHu || '').toUpperCase().trim();
  return (
    code.includes('MERMA') ||
    loc === 'DEV-01' ||
    loc.startsWith('DEV-') ||
    est === 'BLOQUEADO' ||
    est === 'RECHAZADO' ||
    est === 'MERMA'
  );
}

/**
 * Excluye contenedores padre vacíos (Tarima Master / Pallet sin lote directo propio ni hijas activas
 * en el conjunto evaluado) para prevenir "tarimas fantasma" en ocupación física y conteos de cliente.
 */
export function filterEffectiveActiveHus<T = any>(hus: T[] = []): T[] {
  if (!Array.isArray(hus) || hus.length === 0) return [];
  const activeParentIdsWithChildren = new Set<string>();
  for (const h of hus as any[]) {
    if (!h) continue;
    if (h.parentHuId && !isContainerMasterHuRecord(h)) {
      activeParentIdsWithChildren.add(h.parentHuId);
    }
  }
  return hus.filter((h: any) => {
    if (!h) return false;
    if (!isContainerMasterHuRecord(h, activeParentIdsWithChildren)) {
      return true;
    }
    if (h.id && activeParentIdsWithChildren.has(h.id)) {
      return true;
    }
    if (h.lotId) {
      const lotQty = h.lote
        ? Number(h.lote.cantidadDisponible || 0) + Number(h.lote.cantidadBloqueada || 0)
        : Number(h.cantidad || 0);
      return lotQty > 0;
    }
    return false;
  });
}

/**
 * Sincroniza atómicamente el estado, ubicación y `cantidad` vigente de cada Tarima Master padre
 * después de traslados a Staging, devoluciones por rechazo o despachos de sus cajas hijas:
 * - Semántica canónica: `PALLET.cantidad` = número actual de cajas comerciales activas vinculadas.
 * - Salida parcial: actualiza `cantidad` al conteo vivo (ej. 2 → 1) manteniendo `estadoHu = 'ACTIVO'`.
 * - Salida de última caja (`0` hijas activas): fija `cantidad = 0` y transiciona a `'DESPACHADO'`
 *   (o `'INACTIVO'` si no hubo despachos), evitando tarimas fantasma que bloqueen la posición física.
 */
export async function syncParentPalletContainers(
  tx: any,
  parentHuIds: Array<string | null | undefined>,
): Promise<{
  updatedPallets: Array<{
    id: string;
    codigo: string;
    previousEstado: string;
    newEstado: string;
    previousCantidad: number;
    newCantidad: number;
    previousUbicacion: string | null;
    newUbicacion: string | null;
  }>;
  touchedLocationCodes: string[];
}> {
  const uniqueIds = [
    ...new Set(
      (parentHuIds || []).filter((id): id is string => typeof id === 'string' && id.trim().length > 0),
    ),
  ].sort();

  const updatedPallets: Array<{
    id: string;
    codigo: string;
    previousEstado: string;
    newEstado: string;
    previousCantidad: number;
    newCantidad: number;
    previousUbicacion: string | null;
    newUbicacion: string | null;
  }> = [];
  const touchedLocationCodes = new Set<string>();

  if (
    uniqueIds.length === 0 ||
    typeof tx?.handlingUnit?.findUnique !== 'function' ||
    typeof tx?.handlingUnit?.findMany !== 'function'
  ) {
    return { updatedPallets, touchedLocationCodes: [] };
  }

  for (const parentId of uniqueIds) {
    const parent = await tx.handlingUnit.findUnique({
      where: { id: parentId },
    });
    if (!parent) continue;

    const children = await tx.handlingUnit.findMany({
      where: { parentHuId: parent.id },
    });
    if (!isContainerMasterHuRecord(parent) && children.length === 0) continue;

    const commercialChildren = children.filter(
      (c: any) => !isContainerMasterHuRecord(c) && !isMermaOrVirtualChildHu(c),
    );
    const activeChildren = commercialChildren.filter(
      (c: any) => !['DESPACHADO', 'INACTIVO'].includes(String(c.estadoHu || '').toUpperCase()),
    );

    const prevLoc = parent.ubicacionActual || null;
    if (prevLoc) touchedLocationCodes.add(prevLoc);

    if (activeChildren.length > 0) {
      const storageLocs = [
        ...new Set(
          activeChildren
            .map((c: any) => c.ubicacionActual)
            .filter((loc: any): loc is string => typeof loc === 'string' && !isTransientOrStagingLoc(loc)),
        ),
      ];
      const stagingLocs = [
        ...new Set(
          activeChildren
            .map((c: any) => c.ubicacionActual)
            .filter((loc: any): loc is string => typeof loc === 'string' && loc.toUpperCase().startsWith('STG-')),
        ),
      ];

      let nextLoc = prevLoc;
      if (storageLocs.length === 1) {
        nextLoc = storageLocs[0];
      } else if (storageLocs.length === 0 && stagingLocs.length === 1) {
        nextLoc = stagingLocs[0];
      }

      if (nextLoc) touchedLocationCodes.add(nextLoc);

      const nextCantidad = activeChildren.length;
      const needsUpdate =
        Number(parent.cantidad || 0) !== nextCantidad ||
        String(parent.estadoHu || '') !== 'ACTIVO' ||
        nextLoc !== prevLoc;

      if (needsUpdate) {
        await tx.handlingUnit.update({
          where: { id: parent.id },
          data: {
            cantidad: nextCantidad,
            estadoHu: 'ACTIVO',
            ...(nextLoc !== prevLoc ? { ubicacionActual: nextLoc } : {}),
          },
        });
      }

      updatedPallets.push({
        id: parent.id,
        codigo: parent.codigo,
        previousEstado: parent.estadoHu,
        newEstado: 'ACTIVO',
        previousCantidad: Number(parent.cantidad || 0),
        newCantidad: nextCantidad,
        previousUbicacion: prevLoc,
        newUbicacion: nextLoc,
      });
    } else {
      const anyDispatched = commercialChildren.some(
        (c: any) => String(c.estadoHu || '').toUpperCase() === 'DESPACHADO',
      );
      const nextEstado = anyDispatched ? 'DESPACHADO' : 'INACTIVO';

      await tx.handlingUnit.update({
        where: { id: parent.id },
        data: {
          cantidad: 0,
          estadoHu: nextEstado,
        },
      });

      updatedPallets.push({
        id: parent.id,
        codigo: parent.codigo,
        previousEstado: parent.estadoHu,
        newEstado: nextEstado,
        previousCantidad: Number(parent.cantidad || 0),
        newCantidad: 0,
        previousUbicacion: prevLoc,
        newUbicacion: prevLoc,
      });
    }
  }

  return {
    updatedPallets,
    touchedLocationCodes: Array.from(touchedLocationCodes),
  };
}

