jest.mock('../../prisma.service', () => ({
  PrismaService: class MockPrismaService {},
}));

import { HttpException } from '@nestjs/common';
import { PutawayEngineService } from './putaway-engine.service';
import { OperationsController } from './operations.controller';

interface ClosureScenarioSeed {
  exemptTraceability?: boolean;
  conteoAndenEstado?: string;
  inspeccionCalidadEstado?: string;
  etiquetasEstado?: string;
  receiptEstado?: string;
  fechaCierre?: Date | null;
  omitBoxes?: boolean;
  boxLotId?: string | null;
  boxLocation?: string;
  lotExists?: boolean;
  lotDisponible?: number;
  lotBloqueado?: number;
  lotEstadoCalidad?: string;
  lotLocationCode?: string;
  lotLocationTipo?: string;
  lotLocationZonaTipo?: string;
  lotLocationActivo?: boolean;
  lineLote?: string | null;
  lineExpiry?: Date | string | null;
  boxLote?: string | null;
  boxExpiry?: Date | string | null;
  lotLote?: string | null;
  lotExpiry?: Date | string | null;
  expectedQty?: number;
  receivedQty?: number;
  damagedQty?: number;
  failAuditCreate?: boolean;
}

function createClosurePrismaMock(seed: ClosureScenarioSeed = {}) {
  const zone = {
    id: 'zone-interior',
    codigo: seed.lotLocationZonaTipo === 'DEVOLUCION' ? 'DEVOLUCION' : seed.lotLocationZonaTipo === 'STAGING' ? 'STAGING' : 'INTERIOR',
    nombre: 'Área Comercial',
    tipoZona: seed.lotLocationZonaTipo ?? 'ALMACENAMIENTO',
    temperatura: 'AMBIENTE',
    activo: true,
  };

  const commercialLocation = {
    id: 'loc-g-01',
    codigo: seed.lotLocationCode ?? 'G0001',
    tipoUbicacion: seed.lotLocationTipo ?? 'TARIMA_PISO',
    activo: seed.lotLocationActivo ?? true,
    estado: 'OCUPADO',
    zona: zone,
  };

  const client = seed.exemptTraceability
    ? {
        id: 'cli-gen',
        codigo: 'DEP-GEN',
        nombreComercial: 'Depositante General Exento',
        giro: 'GENERAL',
        requiereLote: false,
        requiereCaducidad: false,
      }
    : {
        id: 'cli-food',
        codigo: 'DEP-FOOD',
        nombreComercial: 'Depositante Alimentos Regulado',
        giro: 'COMIDA',
        requiereLote: true,
        requiereCaducidad: true,
      };

  const sku = {
    id: 'sku-1',
    codigo: 'SKU-CLOSE-01',
    descripcion: 'Producto Prueba Cierre',
    categoria: seed.exemptTraceability ? 'GENERAL' : 'ALIMENTO',
    requiereLote: !seed.exemptTraceability,
    requiereCaducidad: !seed.exemptTraceability,
  };

  const expectedQty = seed.expectedQty ?? 24;
  const receivedQty = seed.receivedQty ?? 24;
  const damagedQty = seed.damagedQty ?? 0;

  const lineLote = seed.lineLote !== undefined ? seed.lineLote : (seed.exemptTraceability ? null : 'LOT-CLS-001');
  const lineExpiry = seed.lineExpiry !== undefined ? seed.lineExpiry : (seed.exemptTraceability ? null : new Date('2027-06-30T00:00:00.000Z'));

  const boxLote = seed.boxLote !== undefined ? seed.boxLote : lineLote;
  const boxExpiry = seed.boxExpiry !== undefined ? seed.boxExpiry : lineExpiry;

  const lotLote = seed.lotLote !== undefined ? seed.lotLote : boxLote;
  const lotExpiry = seed.lotExpiry !== undefined ? seed.lotExpiry : boxExpiry;

  const line = {
    id: 'line-1',
    receiptId: 'rec-close-1',
    skuId: sku.id,
    sku,
    cantidadEsperada: expectedQty,
    cantidadRecibida: receivedQty,
    cantidadDanada: damagedQty,
    estado: 'COMPLETO',
    loteAsignado: lineLote,
    loteEsperado: lineLote,
    fechaVencimiento: lineExpiry,
    fechaCaducidadEsperada: lineExpiry,
    notas: null as string | null,
  };

  const lotId = 'lot-1';
  const lotRecord = seed.lotExists === false
    ? null
    : {
        id: lotId,
        skuId: sku.id,
        sku,
        clienteId: client.id,
        lote: lotLote,
        fechaVencimiento: lotExpiry,
        ubicacionId: commercialLocation.id,
        ubicacion: commercialLocation,
        cantidadDisponible: seed.lotDisponible ?? receivedQty,
        cantidadReservada: 0,
        cantidadBloqueada: seed.lotBloqueado ?? 0,
        estadoCalidad: seed.lotEstadoCalidad ?? 'LIBERADO',
      };

  const handlingUnits: any[] = seed.omitBoxes
    ? []
    : [
        {
          id: 'hu-plt-1',
          codigo: 'PLT-CLOSE-01',
          receiptId: 'rec-close-1',
          tipoHu: 'PALLET',
          parentHuId: null,
          cantidad: 2,
          uom: 'TARIMA',
          estadoHu: 'ACTIVO',
          ubicacionActual: seed.boxLocation ?? 'G0001',
          lotId: null,
        },
        {
          id: 'hu-box-1',
          codigo: 'BOX-CLOSE-0001',
          receiptId: 'rec-close-1',
          receiptLineId: line.id,
          skuId: sku.id,
          skuCodigo: sku.codigo,
          tipoHu: 'CAJA',
          parentHuId: 'hu-plt-1',
          cantidad: Math.floor(receivedQty / 2),
          uom: 'PZA',
          loteTexto: boxLote,
          fechaVencimiento: boxExpiry,
          estadoHu: 'ACTIVO',
          ubicacionActual: seed.boxLocation ?? 'G0001',
          lotId: seed.boxLotId !== undefined ? seed.boxLotId : lotId,
        },
        {
          id: 'hu-box-2',
          codigo: 'BOX-CLOSE-0002',
          receiptId: 'rec-close-1',
          receiptLineId: line.id,
          skuId: sku.id,
          skuCodigo: sku.codigo,
          tipoHu: 'CAJA',
          parentHuId: 'hu-plt-1',
          cantidad: receivedQty - Math.floor(receivedQty / 2),
          uom: 'PZA',
          loteTexto: boxLote,
          fechaVencimiento: boxExpiry,
          estadoHu: 'ACTIVO',
          ubicacionActual: seed.boxLocation ?? 'G0001',
          lotId: seed.boxLotId !== undefined ? seed.boxLotId : lotId,
        },
      ];

  const receipt: any = {
    id: 'rec-close-1',
    codigo: 'REC-TEST-CLOSE-01',
    clienteId: client.id,
    cliente: client,
    proveedor: null,
    estado: seed.receiptEstado ?? 'COMPLETO',
    conteoAndenEstado: seed.conteoAndenEstado ?? 'COMPLETADO',
    inspeccionCalidadEstado: seed.inspeccionCalidadEstado ?? 'COMPLETADA',
    etiquetasEstado: seed.etiquetasEstado ?? 'COLOCADAS',
    fechaCierre: seed.fechaCierre ?? null,
    cerradoPor: null as string | null,
    bloqueado: true,
    notas: 'Previo de prueba',
    lineas: [line],
    handlingUnits,
    inspecciones: [{ id: 'insp-1' }],
  };

  const auditLogs: any[] = [];

  const createTxDb = (targetReceipt: any, targetLine: any, targetAudits: any[]) => ({
    receipt: {
      findFirst: async () => ({
        ...targetReceipt,
        lineas: [{ ...targetLine }],
        handlingUnits: handlingUnits.map((h) => ({ ...h })),
      }),
      findUnique: async () => ({
        ...targetReceipt,
        lineas: [{ ...targetLine }],
        handlingUnits: handlingUnits.map((h) => ({ ...h })),
      }),
      update: async ({ data }: any) => {
        Object.assign(targetReceipt, data);
        return {
          ...targetReceipt,
          lineas: [{ ...targetLine }],
        };
      },
    },
    receiptLine: {
      update: async ({ data }: any) => {
        Object.assign(targetLine, data);
        return { ...targetLine };
      },
    },
    handlingUnit: {
      findMany: async ({ where }: any = {}) => {
        if (where?.lotId?.in) {
          return handlingUnits
            .filter((h) => h.tipoHu === 'CAJA' && h.estadoHu === 'ACTIVO' && where.lotId.in.includes(h.lotId))
            .map((h) => ({ ...h }));
        }
        return handlingUnits.map((h) => ({ ...h }));
      },
    },
    lotInventory: {
      findMany: async ({ where }: any = {}) => {
        if (!lotRecord) return [];
        if (where?.id?.in && !where.id.in.includes(lotRecord.id)) return [];
        return [{ ...lotRecord }];
      },
    },
    auditLog: {
      create: async ({ data }: any) => {
        if (seed.failAuditCreate) {
          throw new Error('DB_AUDIT_WRITE_FAILURE');
        }
        const entry = { id: `audit-${targetAudits.length + 1}`, createdAt: new Date(), ...data };
        targetAudits.push(entry);
        return entry;
      },
    },
  });

  const db: any = {
    state: { receipt, line, auditLogs },
    ...createTxDb(receipt, line, auditLogs),
    $transaction: async (cb: any) => {
      // Simula rollback atómico real sobre snapshots en caso de error
      const receiptSnap = { ...receipt };
      const lineSnap = { ...line };
      const auditsSnap = [...auditLogs];
      try {
        return await cb(createTxDb(receipt, line, auditLogs));
      } catch (err) {
        Object.assign(receipt, receiptSnap);
        Object.assign(line, lineSnap);
        auditLogs.length = 0;
        auditLogs.push(...auditsSnap);
        throw err;
      }
    },
  };

  return db;
}

describe('OperationsController.closeReceipt — Hardening General de Cierre (A-N)', () => {
  const callCloseExpectBadRequest = async (controller: OperationsController, codeExpected?: string) => {
    let captured: any = null;
    try {
      await controller.closeReceipt('rec-close-1', { usuario: 'Auditor QA' });
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(HttpException);
    expect(captured.getStatus()).toBe(400);
    if (codeExpected) {
      const resp: any = captured.getResponse();
      expect(resp?.detalles?.codigo).toBe(codeExpected);
    }
  };

  it('A. Recepción totalmente conforme y alojada -> permite cierre atómico con AuditLog CERRAR_RECEPCION completo', async () => {
    const prisma = createClosurePrismaMock();
    const controller = new OperationsController(prisma, new PutawayEngineService(prisma));

    const res: any = await controller.closeReceipt('rec-close-1', { usuario: 'supervisor@givingout.com' });

    expect(res.success).toBe(true);
    expect(res.receipt.estado).toBe('CERRADA');
    expect(res.receipt.cerradoPor).toBe('supervisor@givingout.com');
    expect(res.receipt.fechaCierre).toBeInstanceOf(Date);
    expect(res.receipt.bloqueado).toBe(true);

    expect(prisma.state.auditLogs).toHaveLength(1);
    const audit = prisma.state.auditLogs[0];
    expect(audit.accion).toBe('CERRAR_RECEPCION');
    expect(audit.usuario).toBe('supervisor@givingout.com');
    expect(audit.detalle).toContain('REC-TEST-CLOSE-01');
    expect(audit.detalle).toContain('24 esperadas / 24 conformes / 0 merma / 0 faltante');
    expect(audit.detalle).toContain('Stock disponible: 24 PZA');
    expect(audit.detalle).toContain('2 HUs alojadas en G0001');
    expect(audit.detalle).toContain('LOT-CLS-001');
    expect(audit.detalle).toContain('2027-06-30');
  });

  it('A2. Bloquea si conteoAndenEstado != COMPLETADO o calidad pendiente, y hace rollback si falla AuditLog', async () => {
    const prismaConteo = createClosurePrismaMock({ conteoAndenEstado: 'PENDIENTE' });
    await callCloseExpectBadRequest(
      new OperationsController(prismaConteo, new PutawayEngineService(prismaConteo)),
      'CIERRE_BLOQUEADO_POR_CONTEO_INCOMPLETO',
    );

    const prismaCalidad = createClosurePrismaMock({ inspeccionCalidadEstado: 'EN_PROCESO' });
    await callCloseExpectBadRequest(
      new OperationsController(prismaCalidad, new PutawayEngineService(prismaCalidad)),
      'CIERRE_BLOQUEADO_POR_CALIDAD_PENDIENTE',
    );

    const prismaFailAudit = createClosurePrismaMock({ failAuditCreate: true });
    await expect(
      new OperationsController(prismaFailAudit, new PutawayEngineService(prismaFailAudit)).closeReceipt('rec-close-1', {
        usuario: 'supervisor@givingout.com',
      }),
    ).rejects.toThrow();
    expect(prismaFailAudit.state.receipt.estado).toBe('COMPLETO');
    expect(prismaFailAudit.state.receipt.fechaCierre).toBeNull();
  });

  it('B. Etiquetas no colocadas -> cierre bloqueado', async () => {
    const prisma = createClosurePrismaMock({ etiquetasEstado: 'IMPRESAS' });
    await callCloseExpectBadRequest(
      new OperationsController(prisma, new PutawayEngineService(prisma)),
      'CIERRE_BLOQUEADO_POR_ETIQUETAS_NO_COLOCADAS',
    );
  });

  it('C. Piezas recibidas pero 0 HUs -> cierre bloqueado', async () => {
    const prisma = createClosurePrismaMock({ omitBoxes: true });
    await callCloseExpectBadRequest(
      new OperationsController(prisma, new PutawayEngineService(prisma)),
      'CIERRE_BLOQUEADO_SIN_HUS_COMERCIALES',
    );
  });

  it('D. HU sin lotId -> cierre bloqueado', async () => {
    const prisma = createClosurePrismaMock({ boxLotId: null });
    await callCloseExpectBadRequest(
      new OperationsController(prisma, new PutawayEngineService(prisma)),
      'CIERRE_BLOQUEADO_POR_PUTAWAY_INCOMPLETO',
    );
  });

  it('E. HU en RAMPA_RECEPCION / STAGING -> cierre bloqueado', async () => {
    const prismaRampa = createClosurePrismaMock({ boxLocation: 'RAMPA_RECEPCION' });
    await callCloseExpectBadRequest(
      new OperationsController(prismaRampa, new PutawayEngineService(prismaRampa)),
      'CIERRE_BLOQUEADO_POR_PUTAWAY_INCOMPLETO',
    );

    const prismaStaging = createClosurePrismaMock({ boxLocation: 'STAGING' });
    await callCloseExpectBadRequest(
      new OperationsController(prismaStaging, new PutawayEngineService(prismaStaging)),
      'CIERRE_BLOQUEADO_POR_PUTAWAY_INCOMPLETO',
    );
  });

  it('F. Sin LotInventory cuando debería existir -> cierre bloqueado', async () => {
    const prisma = createClosurePrismaMock({ lotExists: false });
    await callCloseExpectBadRequest(
      new OperationsController(prisma, new PutawayEngineService(prisma)),
      'CIERRE_BLOQUEADO_SIN_LOTINVENTORY',
    );
  });

  it('G. Saldo de LotInventory inconsistente o bloqueado -> cierre bloqueado', async () => {
    const prismaUnder = createClosurePrismaMock({ lotDisponible: 10 });
    await callCloseExpectBadRequest(
      new OperationsController(prismaUnder, new PutawayEngineService(prismaUnder)),
      'CIERRE_BLOQUEADO_BALANCE_LOTINVENTORY',
    );

    const prismaBloq = createClosurePrismaMock({ lotBloqueado: 24 });
    await callCloseExpectBadRequest(
      new OperationsController(prismaBloq, new PutawayEngineService(prismaBloq)),
      'CIERRE_BLOQUEADO_BALANCE_LOTINVENTORY',
    );

    const prismaQuality = createClosurePrismaMock({ lotEstadoCalidad: 'CUARENTENA' });
    await callCloseExpectBadRequest(
      new OperationsController(prismaQuality, new PutawayEngineService(prismaQuality)),
      'CIERRE_BLOQUEADO_BALANCE_LOTINVENTORY',
    );
  });

  it('H. Ubicación no comercial (PNC / DEVOLUCION / inactiva) -> cierre bloqueado', async () => {
    const prismaPnc = createClosurePrismaMock({
      boxLocation: 'G0036',
      lotLocationCode: 'G0036',
      lotLocationTipo: 'PNC',
    });
    await callCloseExpectBadRequest(
      new OperationsController(prismaPnc, new PutawayEngineService(prismaPnc)),
      'CIERRE_BLOQUEADO_UBICACION_NO_COMERCIAL',
    );

    const prismaInactive = createClosurePrismaMock({ lotLocationActivo: false });
    await callCloseExpectBadRequest(
      new OperationsController(prismaInactive, new PutawayEngineService(prismaInactive)),
      'CIERRE_BLOQUEADO_UBICACION_NO_COMERCIAL',
    );
  });

  it('I. Lote obligatorio faltante -> cierre bloqueado', async () => {
    const prisma = createClosurePrismaMock({ lineLote: '', boxLote: '', lotLote: '' });
    await callCloseExpectBadRequest(
      new OperationsController(prisma, new PutawayEngineService(prisma)),
      'LOTE_OBLIGATORIO',
    );
  });

  it('J. Caducidad obligatoria faltante -> cierre bloqueado', async () => {
    const prisma = createClosurePrismaMock({ lineExpiry: null, boxExpiry: null, lotExpiry: null });
    await callCloseExpectBadRequest(
      new OperationsController(prisma, new PutawayEngineService(prisma)),
      'CADUCIDAD_OBLIGATORIA',
    );
  });

  it('K. Caducidad vencida o inválida -> cierre bloqueado', async () => {
    const prismaExpired = createClosurePrismaMock({
      lineExpiry: new Date('2020-01-01T00:00:00.000Z'),
      boxExpiry: new Date('2020-01-01T00:00:00.000Z'),
      lotExpiry: new Date('2020-01-01T00:00:00.000Z'),
    });
    await callCloseExpectBadRequest(
      new OperationsController(prismaExpired, new PutawayEngineService(prismaExpired)),
      'PRODUCTO_CADUCADO',
    );

    const prismaInvalid = createClosurePrismaMock({
      lineExpiry: '2027-02-31',
      boxExpiry: '2027-02-31',
      lotExpiry: '2027-02-31',
    });
    await callCloseExpectBadRequest(
      new OperationsController(prismaInvalid, new PutawayEngineService(prismaInvalid)),
      'FECHA_CADUCIDAD_INVALIDA',
    );
  });

  it('L. Discrepancia física no clasificada/justificada -> cierre bloqueado', async () => {
    const prisma = createClosurePrismaMock({ expectedQty: 24, receivedQty: 20, lotDisponible: 20 });
    await callCloseExpectBadRequest(
      new OperationsController(prisma, new PutawayEngineService(prisma)),
      'CIERRE_BLOQUEADO_POR_DISCREPANCIA',
    );
  });

  it('M. Cierre repetido -> idempotente y no duplica AuditLog ni escrituras', async () => {
    const prisma = createClosurePrismaMock();
    const controller = new OperationsController(prisma, new PutawayEngineService(prisma));

    const first: any = await controller.closeReceipt('rec-close-1', { usuario: 'supervisor@givingout.com' });
    const firstClosedAt = first.receipt.fechaCierre;
    expect(prisma.state.auditLogs).toHaveLength(1);

    const second: any = await controller.closeReceipt('rec-close-1', { usuario: 'otro@givingout.com' });
    expect(second.success).toBe(true);
    expect(second.idempotent).toBe(true);
    expect(prisma.state.auditLogs).toHaveLength(1);
    expect(prisma.state.receipt.cerradoPor).toBe('supervisor@givingout.com');
    expect(prisma.state.receipt.fechaCierre).toEqual(firstClosedAt);
  });

  it('N. Recepción exenta de lote/caducidad -> cierra sin exigir lote ni fecha', async () => {
    const prisma = createClosurePrismaMock({
      exemptTraceability: true,
      lineLote: null,
      lineExpiry: null,
      boxLote: null,
      boxExpiry: null,
      lotLote: null,
      lotExpiry: null,
    });
    const controller = new OperationsController(prisma, new PutawayEngineService(prisma));

    const res: any = await controller.closeReceipt('rec-close-1', { usuario: 'supervisor@givingout.com' });
    expect(res.success).toBe(true);
    expect(res.receipt.estado).toBe('CERRADA');
    expect(prisma.state.auditLogs[0].accion).toBe('CERRAR_RECEPCION');
  });
});
