jest.mock('../../prisma.service', () => ({
  PrismaService: class MockPrismaService { },
}));

import { HttpException } from '@nestjs/common';
import { PutawayEngineService } from './putaway-engine.service';
import { OperationsController } from './operations.controller';

function createStatefulWarehousePrisma(seed?: {
  includeLegacyClientZone?: boolean;
  strictClientZone?: boolean;
  activeAssignedZoneId?: string | null;
  skuTemperatura?: string;
  skuCategoria?: string;
}) {
  const now = new Date('2026-11-10T22:00:00.000Z');
  const zoneInterior = {
    id: 'zone-interior',
    codigo: 'INTERIOR',
    nombre: 'Área Interior',
    tipoZona: 'ALMACENAMIENTO',
    temperatura: 'AMBIENTE',
    activo: true,
  };
  const zoneExteriorTechado = {
    id: 'zone-exterior-techado',
    codigo: 'EXTERIOR_TECHADO',
    nombre: 'Exterior Techado',
    tipoZona: 'ALMACENAMIENTO',
    temperatura: 'AMBIENTE',
    activo: true,
  };
  const zoneLegacyAlmB = {
    id: 'zone-alm-b-legacy',
    codigo: 'ALM-B',
    nombre: 'Almacenamiento B (Alimentos)',
    tipoZona: 'ALMACENAMIENTO',
    temperatura: 'AMBIENTE',
    activo: true,
  };
  const zoneRecibo = {
    id: 'zone-recibo',
    codigo: 'RECIBO',
    nombre: 'Zona de Recibo',
    tipoZona: 'RECIBO',
    temperatura: 'AMBIENTE',
    activo: true,
  };
  const zoneStaging = {
    id: 'zone-staging',
    codigo: 'STAGING',
    nombre: 'Zona de Staging',
    tipoZona: 'STAGING',
    temperatura: 'AMBIENTE',
    activo: true,
  };
  const zoneDevolucion = {
    id: 'zone-devolucion',
    codigo: 'DEVOLUCION',
    nombre: 'Zona Devolución',
    tipoZona: 'DEVOLUCION',
    temperatura: 'AMBIENTE',
    activo: true,
  };

  const locations: any[] = [
    // 4 posiciones comerciales INTERIOR (G0001..G0004)
    { id: 'loc-g0001', codigo: 'G0001', almacenId: 'alm-1', zonaId: zoneInterior.id, zona: zoneInterior, pasillo: 'PISO', rack: 'G', nivel: '0', posicion: '01', tipoUbicacion: 'TARIMA_PISO', temperatura: 'AMBIENTE', capacidadUnits: 100, ocupacion: 0, estado: 'LIBRE', activo: true },
    { id: 'loc-g0002', codigo: 'G0002', almacenId: 'alm-1', zonaId: zoneInterior.id, zona: zoneInterior, pasillo: 'PISO', rack: 'G', nivel: '0', posicion: '02', tipoUbicacion: 'TARIMA_PISO', temperatura: 'AMBIENTE', capacidadUnits: 100, ocupacion: 0, estado: 'LIBRE', activo: true },
    // 1 posición comercial EXTERIOR_TECHADO (G0037)
    { id: 'loc-g0037', codigo: 'G0037', almacenId: 'alm-1', zonaId: zoneExteriorTechado.id, zona: zoneExteriorTechado, pasillo: 'PISO', rack: 'G', nivel: '0', posicion: '37', tipoUbicacion: 'TARIMA_PISO', temperatura: 'AMBIENTE', capacidadUnits: 100, ocupacion: 0, estado: 'LIBRE', activo: true },
    // 3 posiciones PNC en EXTERIOR_TECHADO (G0036, G0041, G0042)
    { id: 'loc-g0036', codigo: 'G0036', almacenId: 'alm-1', zonaId: zoneExteriorTechado.id, zona: zoneExteriorTechado, pasillo: 'PISO', rack: 'G', nivel: '0', posicion: '36', tipoUbicacion: 'PNC', temperatura: 'AMBIENTE', capacidadUnits: 100, ocupacion: 0, estado: 'LIBRE', activo: true },
    { id: 'loc-g0041', codigo: 'G0041', almacenId: 'alm-1', zonaId: zoneExteriorTechado.id, zona: zoneExteriorTechado, pasillo: 'PISO', rack: 'G', nivel: '0', posicion: '41', tipoUbicacion: 'PNC', temperatura: 'AMBIENTE', capacidadUnits: 100, ocupacion: 0, estado: 'LIBRE', activo: true },
    { id: 'loc-g0042', codigo: 'G0042', almacenId: 'alm-1', zonaId: zoneExteriorTechado.id, zona: zoneExteriorTechado, pasillo: 'PISO', rack: 'G', nivel: '0', posicion: '42', tipoUbicacion: 'PNC', temperatura: 'AMBIENTE', capacidadUnits: 100, ocupacion: 0, estado: 'LIBRE', activo: true },
    // 6 áreas especiales activas
    { id: 'loc-rec-01', codigo: 'REC-01', almacenId: 'alm-1', zonaId: zoneRecibo.id, zona: zoneRecibo, pasillo: 'REC', rack: '01', nivel: '0', posicion: '01', tipoUbicacion: 'RECIBO', temperatura: 'AMBIENTE', capacidadUnits: 100, ocupacion: 0, estado: 'LIBRE', activo: true },
    { id: 'loc-rec-02', codigo: 'REC-02', almacenId: 'alm-1', zonaId: zoneRecibo.id, zona: zoneRecibo, pasillo: 'REC', rack: '02', nivel: '0', posicion: '02', tipoUbicacion: 'RECIBO', temperatura: 'AMBIENTE', capacidadUnits: 100, ocupacion: 0, estado: 'LIBRE', activo: true },
    { id: 'loc-stg-01', codigo: 'STG-01', almacenId: 'alm-1', zonaId: zoneStaging.id, zona: zoneStaging, pasillo: 'STG', rack: '01', nivel: '0', posicion: '01', tipoUbicacion: 'STAGING', temperatura: 'AMBIENTE', capacidadUnits: 100, ocupacion: 0, estado: 'LIBRE', activo: true },
    { id: 'loc-stg-02', codigo: 'STG-02', almacenId: 'alm-1', zonaId: zoneStaging.id, zona: zoneStaging, pasillo: 'STG', rack: '02', nivel: '0', posicion: '02', tipoUbicacion: 'STAGING', temperatura: 'AMBIENTE', capacidadUnits: 100, ocupacion: 0, estado: 'LIBRE', activo: true },
    { id: 'loc-dev-01', codigo: 'DEV-01', almacenId: 'alm-1', zonaId: zoneDevolucion.id, zona: zoneDevolucion, pasillo: 'DEV', rack: '01', nivel: '0', posicion: '01', tipoUbicacion: 'PISO', temperatura: 'AMBIENTE', capacidadUnits: 100, ocupacion: 0, estado: 'LIBRE', activo: true },
    { id: 'loc-nc-01', codigo: 'NC-EXCESO-01', almacenId: 'alm-1', zonaId: zoneDevolucion.id, zona: zoneDevolucion, pasillo: 'NC', rack: '01', nivel: '0', posicion: '01', tipoUbicacion: 'CUARENTENA', temperatura: 'AMBIENTE', capacidadUnits: 100, ocupacion: 0, estado: 'LIBRE', activo: true },
    // Histórica inactiva (ALM-B / B01-R01-N1)
    { id: 'loc-b01-legacy', codigo: 'B01-R01-N1', almacenId: 'alm-1', zonaId: zoneLegacyAlmB.id, zona: zoneLegacyAlmB, pasillo: 'B01', rack: 'R01', nivel: 'N1', posicion: '01', tipoUbicacion: 'ESTANTERIA', temperatura: 'AMBIENTE', capacidadUnits: 100, ocupacion: 0, estado: 'LIBRE', activo: false },
  ];

  const client = {
    id: 'cli-1',
    codigo: 'DEP-GEN-01',
    nombreComercial: 'Depositante Alimentos Genérico',
    razonSocial: 'Depositante Alimentos S.A.',
    giro: 'COMIDA',
    reglaInventario: 'FEFO',
    requiereLote: true,
    requiereCaducidad: true,
    zonaAsignadaId:
      seed?.activeAssignedZoneId !== undefined
        ? seed.activeAssignedZoneId
        : seed?.includeLegacyClientZone === false
          ? null
          : zoneLegacyAlmB.id,
    zonaExclusiva: Boolean(seed?.strictClientZone),
  };

  const sku = {
    id: 'sku-1',
    codigo: 'SKU-TEST-FOOD-01',
    descripcion: 'Producto Alimenticio Ambiente',
    categoria: seed?.skuCategoria ?? 'ALIMENTO',
    temperaturaRequerida: seed?.skuTemperatura ?? 'AMBIENTE',
    requiereLote: true,
    requiereCaducidad: true,
  };

  const receipt = {
    id: 'rec-1',
    codigo: 'REC-TEST-001',
    clienteId: client.id,
    cliente: client,
    estado: 'CONCILIADO',
    conteoAndenEstado: 'COMPLETADO',
    inspeccionCalidadEstado: 'COMPLETADA',
    etiquetasEstado: 'COLOCADAS',
    facturaRespaldo: 'FAC-TEST-001',
    ocReferencia: null,
    bultosDanados: 0,
    inspecciones: [{ id: 'insp-1', estado: 'LIBERADO' }],
    lineas: [
      {
        id: 'line-1',
        receiptId: 'rec-1',
        skuId: sku.id,
        sku,
        cantidadEsperada: 24,
        cantidadRecibida: 24,
        cantidadDanada: 0,
        loteAsignado: 'LOT-TEST-001',
        loteEsperado: null,
        fechaVencimiento: new Date('2027-06-30T00:00:00.000Z'),
        ubicacionId: null,
      },
    ],
  };

  const handlingUnits: any[] = [
    {
      id: 'hu-plt-1',
      codigo: 'PLT-REC-TEST-01',
      receiptId: receipt.id,
      receiptLineId: null,
      clienteId: client.id,
      tipoHu: 'PALLET',
      parentHuId: null,
      cantidad: 2,
      uom: 'TARIMA',
      skuCodigo: null,
      loteTexto: null,
      fechaVencimiento: null,
      estadoHu: 'ACTIVO',
      estadoEtiqueta: 'COLOCADA',
      ubicacionActual: 'RAMPA_RECEPCION',
      lotId: null,
    },
    {
      id: 'hu-box-1',
      codigo: 'BOX-REC-TEST-0001',
      receiptId: receipt.id,
      receiptLineId: 'line-1',
      clienteId: client.id,
      tipoHu: 'CAJA',
      parentHuId: 'hu-plt-1',
      cantidad: 12,
      uom: 'PZA',
      skuId: sku.id,
      skuCodigo: sku.codigo,
      skuDescripcion: sku.descripcion,
      loteTexto: 'LOT-TEST-001',
      fechaVencimiento: new Date('2027-06-30T00:00:00.000Z'),
      estadoHu: 'ACTIVO',
      estadoEtiqueta: 'COLOCADA',
      ubicacionActual: 'RAMPA_RECEPCION',
      lotId: null,
    },
    {
      id: 'hu-box-2',
      codigo: 'BOX-REC-TEST-0002',
      receiptId: receipt.id,
      receiptLineId: 'line-1',
      clienteId: client.id,
      tipoHu: 'CAJA',
      parentHuId: 'hu-plt-1',
      cantidad: 12,
      uom: 'PZA',
      skuId: sku.id,
      skuCodigo: sku.codigo,
      skuDescripcion: sku.descripcion,
      loteTexto: 'LOT-TEST-001',
      fechaVencimiento: new Date('2027-06-30T00:00:00.000Z'),
      estadoHu: 'ACTIVO',
      estadoEtiqueta: 'COLOCADA',
      ubicacionActual: 'RAMPA_RECEPCION',
      lotId: null,
    },
  ];

  const lots: any[] = [];
  const movements: any[] = [];
  const auditLogs: any[] = [];
  let seq = 1;

  const matchLocFilter = (loc: any, where: any): boolean => {
    if (!where) return true;
    if (where.activo !== undefined && loc.activo !== where.activo) return false;
    if (where.id !== undefined) {
      if (typeof where.id === 'string' && loc.id !== where.id) return false;
      if (where.id?.in && !where.id.in.includes(loc.id)) return false;
    }
    if (where.codigo !== undefined) {
      if (typeof where.codigo === 'string' && loc.codigo !== where.codigo) return false;
      if (where.codigo?.in && !where.codigo.in.includes(loc.codigo)) return false;
    }
    if (where.OR) {
      return where.OR.some((cond: any) => matchLocFilter(loc, cond));
    }
    return true;
  };

  const matchHuFilter = (hu: any, where: any): boolean => {
    if (!where) return true;
    if (where.receiptId !== undefined && hu.receiptId !== where.receiptId) return false;
    if (where.id !== undefined) {
      if (typeof where.id === 'string' && hu.id !== where.id) return false;
      if (where.id?.in && !where.id.in.includes(hu.id)) return false;
    }
    if (where.tipoHu !== undefined && hu.tipoHu !== where.tipoHu) return false;
    if (where.ubicacionActual !== undefined && hu.ubicacionActual !== where.ubicacionActual) return false;
    if (where.estadoHu !== undefined) {
      if (typeof where.estadoHu === 'string' && hu.estadoHu !== where.estadoHu) return false;
      if (where.estadoHu?.notIn && where.estadoHu.notIn.includes(hu.estadoHu)) return false;
    }
    if (where.OR) {
      return where.OR.some((cond: any) => matchHuFilter(hu, cond));
    }
    return true;
  };

  const db: any = {
    state: { locations, handlingUnits, lots, movements, auditLogs, receipt },
    receipt: {
      findFirst: async ({ where }: any = {}) => {
        if (where?.OR) {
          const hit = where.OR.some((w: any) => w.id === receipt.id || w.codigo === receipt.codigo);
          if (!hit) return null;
        }
        return {
          ...receipt,
          handlingUnits: handlingUnits.filter((h) => h.receiptId === receipt.id).map((h) => ({ ...h })),
          lineas: receipt.lineas.map((l) => ({ ...l })),
        };
      },
      update: async ({ where, data }: any) => {
        if (where.id === receipt.id) Object.assign(receipt, data);
        return { ...receipt };
      },
    },
    location: {
      findMany: async ({ where }: any = {}) => {
        return locations
          .filter((loc) => matchLocFilter(loc, where))
          .map((loc) => ({
            ...loc,
            lotes: lots
              .filter((l) => l.ubicacionId === loc.id && ((l.cantidadDisponible || 0) > 0 || (l.cantidadBloqueada || 0) > 0))
              .map((l) => ({ ...l, sku, cliente: client })),
          }));
      },
      findFirst: async ({ where }: any = {}) => {
        const hit = locations.find((loc) => matchLocFilter(loc, where));
        if (!hit) return null;
        return {
          ...hit,
          lotes: lots
            .filter((l) => l.ubicacionId === hit.id && ((l.cantidadDisponible || 0) > 0 || (l.cantidadBloqueada || 0) > 0))
            .map((l) => ({ ...l, sku, cliente: client })),
        };
      },
      update: async ({ where, data }: any) => {
        const loc = locations.find((l) => l.id === where.id);
        if (loc) Object.assign(loc, data);
        return loc;
      },
    },
    handlingUnit: {
      findMany: async ({ where }: any = {}) => {
        return handlingUnits.filter((hu) => matchHuFilter(hu, where)).map((hu) => ({ ...hu }));
      },
      findUnique: async ({ where }: any) => {
        const hu = handlingUnits.find((h) => h.id === where.id);
        return hu ? { ...hu } : null;
      },
      update: async ({ where, data }: any) => {
        const hu = handlingUnits.find((h) => h.id === where.id);
        if (hu) Object.assign(hu, data);
        return hu ? { ...hu } : null;
      },
    },
    lotInventory: {
      findMany: async ({ where }: any = {}) => {
        return lots
          .filter((l) => {
            if (where?.id?.in && !where.id.in.includes(l.id)) return false;
            if (where?.clienteId && l.clienteId !== where.clienteId) return false;
            if (where?.skuId?.in && !where.skuId.in.includes(l.skuId)) return false;
            if (where?.ubicacionId?.in && !where.ubicacionId.in.includes(l.ubicacionId)) return false;
            return true;
          })
          .map((l) => ({
            ...l,
            ubicacion: locations.find((loc) => loc.id === l.ubicacionId) || null,
          }));
      },
      create: async ({ data }: any) => {
        const created = { id: `lot-${seq++}`, createdAt: now, ...data };
        lots.push(created);
        return { ...created };
      },
      update: async ({ where, data }: any) => {
        const lot = lots.find((l) => l.id === where.id);
        if (lot) {
          if (data.cantidadDisponible?.increment) {
            lot.cantidadDisponible += data.cantidadDisponible.increment;
          } else if (data.cantidadDisponible?.decrement) {
            lot.cantidadDisponible -= data.cantidadDisponible.decrement;
          }
          if (data.estadoCalidad) lot.estadoCalidad = data.estadoCalidad;
        }
        return lot;
      },
    },
    inventoryMovement: {
      findMany: async ({ where }: any = {}) => {
        return movements.filter((m) => {
          if (where?.documentoOrigen && m.documentoOrigen !== where.documentoOrigen) return false;
          if (where?.tipoMovimiento && m.tipoMovimiento !== where.tipoMovimiento) return false;
          if (where?.huId?.in && !where.huId.in.includes(m.huId)) return false;
          return true;
        });
      },
      createMany: async ({ data }: any) => {
        for (const item of data) {
          movements.push({ id: `mov-${seq++}`, createdAt: now, ...item });
        }
        return { count: data.length };
      },
    },
    auditLog: {
      findMany: async ({ where }: any = {}) => {
        return auditLogs.filter((a) => {
          if (where?.entidad && a.entidad !== where.entidad) return false;
          if (where?.entidadId?.in && !where.entidadId.in.includes(a.entidadId)) return false;
          if (where?.accion) {
            if (typeof where.accion === 'string' && a.accion !== where.accion) return false;
            if (where.accion?.in && !where.accion.in.includes(a.accion)) return false;
          }
          return true;
        });
      },
      findFirst: async ({ where }: any = {}) => {
        const list = await db.auditLog.findMany({ where });
        return list[0] || null;
      },
      create: async ({ data }: any) => {
        const created = { id: `audit-${seq++}`, createdAt: now, ...data };
        auditLogs.unshift(created);
        return created;
      },
    },
    skuMaster: {
      findUnique: async ({ where }: any) => (where.id === sku.id ? sku : null),
    },
    $transaction: async (cb: any) => cb(db),
  };

  return db;
}

describe('PutawayEngineService & OperationsController — Layout Real, Cajas Hermanas y Tarima Master', () => {
  describe('1. Compatibilidad general del layout físico real (INTERIOR / EXTERIOR_TECHADO)', () => {
    it('sugiere G comercial en INTERIOR para alimento ambiente aun cuando zonaAsignadaId apunte a ALM-B legado y excluye PNC, especiales y Axx/Bxx', async () => {
      const prisma = createStatefulWarehousePrisma({ includeLegacyClientZone: true });
      const engine = new PutawayEngineService(prisma);

      const res: any = await engine.generateReceiptSuggestions('rec-1');

      expect(res.canProceed).toBe(true);
      expect(res.suggestions).toHaveLength(2);

      const box1Sug = res.suggestions[0];
      expect(box1Sug.suggestedLocation).not.toBeNull();
      expect(box1Sug.suggestedLocation.codigo).toBe('G0001');
      expect(box1Sug.suggestedLocation.zonaNombre).toBe('Área Interior');
      expect(box1Sug.parentHuId).toBe('hu-plt-1');

      const allCodes = [
        box1Sug.suggestedLocation.codigo,
        ...box1Sug.alternativeLocations.map((a: any) => a.codigo),
      ];
      expect(allCodes).toEqual(expect.arrayContaining(['G0001', 'G0002', 'G0037']));
      // Cero PNC, cero especiales, cero históricos inactivos
      expect(allCodes.some((c: string) => ['G0036', 'G0041', 'G0042'].includes(c))).toBe(false);
      expect(allCodes.some((c: string) => c.startsWith('B') || c.startsWith('REC-') || c.startsWith('STG-') || c.startsWith('DEV-') || c.startsWith('NC-'))).toBe(false);

      expect(res.diagnostics.discardedUnconfiguredCompatibility).toBe(0);
      expect(res.diagnostics.discardedSpecialLocations).toBe(9); // 3 PNC + 6 especiales
      expect(res.diagnostics.totalValidCandidates).toBe(3); // G0001, G0002, G0037
    });

    it('mantiene restricción térmica estricta: producto REFRIGERADO no es compatible con zonas AMBIENTE', async () => {
      const prisma = createStatefulWarehousePrisma({ skuTemperatura: 'REFRIGERADO' });
      const engine = new PutawayEngineService(prisma);

      const res: any = await engine.generateReceiptSuggestions('rec-1');
      expect(res.suggestions[0].suggestedLocation).toBeNull();
      expect(res.diagnostics.discardedProductIncompatibility).toBe(3);
    });

    it('respeta zonaExclusiva cuando el depositante apunta a una zona activa real (INTERIOR)', async () => {
      const prisma = createStatefulWarehousePrisma({
        activeAssignedZoneId: 'zone-interior',
        strictClientZone: true,
      });
      const engine = new PutawayEngineService(prisma);

      const res: any = await engine.generateReceiptSuggestions('rec-1');
      const allCodes = [
        res.suggestions[0].suggestedLocation.codigo,
        ...res.suggestions[0].alternativeLocations.map((a: any) => a.codigo),
      ];
      expect(allCodes).toEqual(['G0001', 'G0002']);
      expect(allCodes).not.toContain('G0037'); // EXTERIOR_TECHADO excluida por zonaExclusiva en INTERIOR
    });
  });

  describe('2. Regla 1 G = 1 Tarima con cajas hermanas, bloqueo de 2a tarima y propagación a Tarima Master', () => {
    it('permite confirmar BOX-0001 y BOX-0002 (misma parentHuId) en G0001, rechaza segunda tarima distinta y propaga ubicación a PLT sin duplicar stock', async () => {
      const prisma = createStatefulWarehousePrisma({ includeLegacyClientZone: true });
      const engine = new PutawayEngineService(prisma);
      const controller = new OperationsController(prisma, engine);

      // Paso A: Sugerencias iniciales -> G0001 para ambas cajas
      const initialSuggestions: any = await controller.getPutawaySuggestions('rec-1');
      expect(initialSuggestions.suggestions[0].suggestedLocation.codigo).toBe('G0001');
      expect(initialSuggestions.suggestions[1].suggestedLocation.codigo).toBe('G0001');

      // Paso B: Escaneo dual caja 1 (BOX-0001 -> G0001)
      const item1Res: any = await controller.confirmPutawayItem('rec-1', {
        huId: 'hu-box-1',
        huCodigo: 'BOX-REC-TEST-0001',
        scannedHuCode: 'BOX-REC-TEST-0001',
        huScanValidated: true,
        ubicacionDestinoId: 'loc-g0001',
        scannedLocationCode: 'G0001',
        rackScanValidated: true,
        usuario: 'QA Operator',
      } as any);
      expect(item1Res.success).toBe(true);

      // Paso C: Recarga de sugerencias para caja hermana 2 -> G0001 sigue siendo #1 como consolidación misma tarima
      const midSuggestions: any = await controller.getPutawaySuggestions('rec-1');
      const sugBox2 = midSuggestions.suggestions.find((s: any) => s.huId === 'hu-box-2');
      expect(sugBox2.suggestedLocation).not.toBeNull();
      expect(sugBox2.suggestedLocation.codigo).toBe('G0001');
      expect(sugBox2.suggestedLocation.isSamePalletConsolidation).toBe(true);
      expect(sugBox2.suggestedLocation.bultosDespuesDeAlojar).toBe(1);

      // Paso D: Escaneo dual caja hermana 2 (BOX-0002 -> G0001) -> PASS
      const item2Res: any = await controller.confirmPutawayItem('rec-1', {
        huId: 'hu-box-2',
        huCodigo: 'BOX-REC-TEST-0002',
        scannedHuCode: 'BOX-REC-TEST-0002',
        huScanValidated: true,
        ubicacionDestinoId: 'loc-g0001',
        scannedLocationCode: 'G0001',
        rackScanValidated: true,
        usuario: 'QA Operator',
      } as any);
      expect(item2Res.success).toBe(true);

      // Paso E: Segunda tarima física DISTINTA intentando alojarse en G0001 debe ser rechazada (1/1 tarimas)
      const otherPalletReval = await engine.revalidateLocationForPutaway('loc-g0001', 12, prisma, {
        huBultos: 1,
        client: prisma.state.receipt.cliente,
        incomingHuIds: ['hu-box-otra'],
        incomingPalletKeys: ['hu-plt-2'],
        item: {
          huId: 'hu-box-otra',
          huCodigo: 'BOX-OTRA-TARIMA-0001',
          tipoHu: 'CAJA',
          parentHuId: 'hu-plt-2',
          skuId: 'sku-1',
          skuCodigo: 'SKU-TEST-FOOD-01',
          skuDescripcion: 'Otro producto',
          cantidad: 12,
          lote: 'LOT-OTRO',
          fechaVencimiento: '2027-08-01',
          ubicacionActual: 'RAMPA_RECEPCION',
          skuCategoria: 'ALIMENTO',
          skuTemperatura: 'AMBIENTE',
        },
      });
      expect(otherPalletReval.valid).toBe(false);
      expect(otherPalletReval.error).toContain('1/1 tarimas');

      // También rechaza segunda caja independiente sin parentHuId intentando entrar a G0001
      const standaloneBoxReval = await engine.revalidateLocationForPutaway('loc-g0001', 10, prisma, {
        huBultos: 1,
        client: prisma.state.receipt.cliente,
        incomingHuIds: ['hu-box-solo'],
        incomingPalletKeys: ['hu-box-solo'],
      });
      expect(standaloneBoxReval.valid).toBe(false);

      // Paso F: Confirm Putaway final -> PASS (no colisiona con BOX-0001/BOX-0002 pre-confirmadas)
      const confirmRes: any = await controller.confirmPutaway('rec-1', {
        movimientos: [
          {
            huId: 'hu-box-1',
            huCodigo: 'BOX-REC-TEST-0001',
            skuId: 'sku-1',
            cantidad: 12,
            ubicacionDestinoId: 'loc-g0001',
            huScanValidated: true,
            rackScanValidated: true,
          },
          {
            huId: 'hu-box-2',
            huCodigo: 'BOX-REC-TEST-0002',
            skuId: 'sku-1',
            cantidad: 12,
            ubicacionDestinoId: 'loc-g0001',
            huScanValidated: true,
            rackScanValidated: true,
          },
        ],
        usuario: 'QA Operator',
      } as any);

      expect(confirmRes.success).toBe(true);
      expect(confirmRes.totalPiezas).toBe(24);
      expect(confirmRes.totalBultos).toBe(2);

      // Verificación de Propagación a Tarima Master y no duplicación
      const palletDb = prisma.state.handlingUnits.find((h: any) => h.id === 'hu-plt-1');
      const box1Db = prisma.state.handlingUnits.find((h: any) => h.id === 'hu-box-1');
      const box2Db = prisma.state.handlingUnits.find((h: any) => h.id === 'hu-box-2');

      expect(palletDb.ubicacionActual).toBe('G0001');
      expect(palletDb.lotId).toBeNull();
      expect(palletDb.cantidad).toBe(2); // Contenedor físico, no suma unidades al stock
      expect(box1Db.ubicacionActual).toBe('G0001');
      expect(box1Db.parentHuId).toBe('hu-plt-1');
      expect(box2Db.ubicacionActual).toBe('G0001');
      expect(box2Db.parentHuId).toBe('hu-plt-1');

      // Inventario y movimientos exactos (sin duplicar por Tarima Master)
      expect(prisma.state.lots).toHaveLength(1);
      expect(prisma.state.lots[0].cantidadDisponible).toBe(24);
      expect(prisma.state.movements).toHaveLength(2);
      expect(prisma.state.receipt.estado).toBe('COMPLETO');

      // Al re-evaluar layout completo tras propagación de PLT-01 (cantidad: 2 TARIMA),
      // G0001 debe reportar 1/1 tarima (LLENO) y 24 piezas reales (nunca 26 ni 48 ni 3 bultos)
      const postLayout = await engine.getEnrichedWarehouseLayout();
      const g0001Post = postLayout.find((l) => l.codigo === 'G0001')!;
      expect(g0001Post.ocupacionBultos).toBe(1);
      expect(g0001Post.ocupacionUnidades).toBe(24);
      expect(g0001Post.estadoCapacidad).toBe('LLENO');

      // Confirmar que PNC G0036 rechaza alojamiento comercial
      const pncReval = await engine.revalidateLocationForPutaway('loc-g0036', 12, prisma, {
        huBultos: 1,
        client: prisma.state.receipt.cliente,
      });
      expect(pncReval.valid).toBe(false);
    });

    it('rechaza alojar en una misma llamada batch de confirmPutaway dos tarimas físicas distintas en la misma posición G', async () => {
      const prisma = createStatefulWarehousePrisma();
      const engine = new PutawayEngineService(prisma);
      const controller = new OperationsController(prisma, engine);

      // Crear una segunda tarima física distinta en la recepción
      prisma.state.handlingUnits.push({
        id: 'hu-plt-2',
        codigo: 'PLT-REC-TEST-02',
        receiptId: 'rec-1',
        clienteId: 'cli-1',
        tipoHu: 'PALLET',
        parentHuId: null,
        cantidad: 1,
        uom: 'TARIMA',
        estadoHu: 'ACTIVO',
        estadoEtiqueta: 'COLOCADA',
        ubicacionActual: 'RAMPA_RECEPCION',
        lotId: null,
      });
      // Reasignar BOX-0002 a PLT-02 (ahora son 2 tarimas físicas distintas)
      const box2 = prisma.state.handlingUnits.find((h: any) => h.id === 'hu-box-2');
      box2.parentHuId = 'hu-plt-2';

      await expect(
        controller.confirmPutaway('rec-1', {
          movimientos: [
            { huId: 'hu-box-1', skuId: 'sku-1', cantidad: 12, ubicacionDestinoId: 'loc-g0001', huScanValidated: true, rackScanValidated: true },
            { huId: 'hu-box-2', skuId: 'sku-1', cantidad: 12, ubicacionDestinoId: 'loc-g0001', huScanValidated: true, rackScanValidated: true },
          ],
          usuario: 'QA Operator',
        } as any),
      ).rejects.toThrow(HttpException);
    });
  });
});
