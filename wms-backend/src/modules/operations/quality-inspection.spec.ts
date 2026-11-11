jest.mock('../../prisma.service', () => ({
  PrismaService: class MockPrismaService {},
}));

import { PutawayEngineService } from './putaway-engine.service';
import { OperationsController } from './operations.controller';
import {
  classifyQualityOutcome,
  isActiveRescuedBox,
} from '../../../../wms-frontend/src/utils/qualityReportClassification';

interface InspectionSpecSeed {
  codigo?: string;
  bultosDeclarados?: number;
  bultosRecibidos?: number;
  bultosDanados?: number;
  damagedBoxQty?: number;
}

function createInspectionScenarioPrismaMock(seed: InspectionSpecSeed = {}) {
  const client = {
    id: 'cli-alimentos',
    codigo: 'DEP-FOOD',
    nombreComercial: 'AlimNorte',
    razonSocial: 'Alimentos del Norte S.A.',
    giro: 'COMIDA',
    requiereLote: true,
    requiereCaducidad: true,
  };

  const sku = {
    id: 'sku-ace',
    codigo: 'ACE-OLI-1L',
    descripcion: 'Aceite de Oliva Extra Virgen 1L',
    categoria: 'ALIMENTO',
    uomBase: 'PZA',
    capacidadEmpaque: 12,
    requiereLote: true,
    requiereCaducidad: true,
  };

  const zoneInterior = {
    id: 'zone-int',
    codigo: 'INTERIOR',
    nombre: 'Interior Comercial',
    tipoZona: 'ALMACENAMIENTO',
    temperatura: 'AMBIENTE',
    activo: true,
  };

  const commercialLocation = {
    id: 'loc-g0001',
    codigo: 'G0001',
    almacenId: 'wh-1',
    zonaId: zoneInterior.id,
    tipoUbicacion: 'TARIMA_PISO',
    activo: true,
    estado: 'OCUPADO',
    zona: zoneInterior,
  };

  const devLocation = {
    id: 'loc-dev-01',
    codigo: 'DEV-01',
    almacenId: 'wh-1',
    zonaId: 'zone-dev',
    pasillo: 'DEV',
    rack: '01',
    nivel: 'P',
    posicion: '01',
    tipoUbicacion: 'DEVOLUCION',
    activo: true,
    estado: 'LIBRE',
  };

  const bultosDeclarados = seed.bultosDeclarados ?? 2;
  const bultosRecibidos = seed.bultosRecibidos ?? 2;
  const bultosDanados = seed.bultosDanados ?? 0;
  const expectedPieces = bultosDeclarados * 12;

  const line: any = {
    id: 'line-1',
    receiptId: 'rec-qa-1',
    skuId: sku.id,
    sku,
    cantidadEsperada: expectedPieces,
    cantidadRecibida: 0,
    cantidadDanada: bultosDanados > 0 ? seed.damagedBoxQty ?? 12 : 0,
    estado: 'PENDIENTE',
    loteAsignado: 'LOT-SPEC-001',
    loteEsperado: 'LOT-SPEC-001',
    fechaVencimiento: new Date('2027-06-30T00:00:00.000Z'),
    notas: null as string | null,
  };

  const receipt: any = {
    id: 'rec-qa-1',
    codigo: seed.codigo ?? 'REC-2026-0901',
    clienteId: client.id,
    cliente: client,
    proveedor: null,
    estado: 'PENDIENTE',
    tipoRecepcion: 'RECEPCION',
    bultosDeclarados,
    bultosRecibidos,
    bultosDanados,
    conteoAndenEstado: 'PENDIENTE',
    inspeccionCalidadEstado: bultosDanados > 0 ? 'PENDIENTE' : null,
    etiquetasEstado: 'COLOCADAS',
    fechaConteoAnden: null as Date | null,
    fechaLiberacionChofer: new Date('2026-11-10T20:00:00.000Z'),
    fechaCierre: null as Date | null,
    cerradoPor: null as string | null,
    bloqueado: false,
    bloqueadoPor: null as string | null,
    notas: 'Spec test',
    lineas: [line],
  };

  const handlingUnits: any[] = [];
  if (bultosDanados > 0) {
    handlingUnits.push({
      id: 'hu-dano-1',
      codigo: `BOX-${receipt.codigo}-DANO-01`,
      tipoHu: 'CAJA',
      clienteId: client.id,
      receiptId: receipt.id,
      receiptLineId: line.id,
      skuId: sku.id,
      skuCodigo: sku.codigo,
      skuDescripcion: `[DAÑO EXTERIOR] ${sku.descripcion}`,
      loteTexto: 'LOT-SPEC-001',
      fechaVencimiento: new Date('2027-06-30T00:00:00.000Z'),
      cantidad: seed.damagedBoxQty ?? 12,
      piezasPorCaja: 12,
      uom: 'PZA',
      ubicacionActual: 'AREA_CALIDAD',
      estadoHu: 'RETENIDA',
      estadoEtiqueta: 'COLOCADA',
      parentHuId: null,
      reacondicionada: false,
      cajaOrigenId: null,
      inspeccionId: null,
      lotId: null,
      lote: null,
    });
  }

  const inspections: any[] = [];
  const lots: any[] = [];
  const movements: any[] = [];
  const auditLogs: any[] = [];
  let seq = 1;

  const hydrateReceipt = () => ({
    ...receipt,
    cliente: client,
    lineas: receipt.lineas.map((l: any) => ({ ...l, sku })),
    handlingUnits: handlingUnits.map((h) => ({ ...h })),
    inspecciones: inspections.map((i) => ({ ...i })),
    auditLogs: auditLogs.map((a) => ({ ...a })),
  });

  const prisma: any = {
    receipt: {
      findFirst: jest.fn(async () => hydrateReceipt()),
      findUnique: jest.fn(async () => hydrateReceipt()),
      update: jest.fn(async ({ data }: any) => {
        Object.assign(receipt, data);
        return hydrateReceipt();
      }),
    },
    receiptLine: {
      update: jest.fn(async ({ where, data }: any) => {
        const target = receipt.lineas.find((l: any) => l.id === where.id);
        Object.assign(target, data);
        return target;
      }),
    },
    qualityInspection: {
      findMany: jest.fn(async () => inspections.map((i) => ({ ...i }))),
      findFirst: jest.fn(async () => inspections[0] ?? null),
      findUnique: jest.fn(async ({ where }: any) =>
        inspections.find((i) => i.folio === where.folio || i.id === where.id) ?? null,
      ),
      create: jest.fn(async ({ data }: any) => {
        const rec = { id: `qi-${seq++}`, createdAt: new Date(), updatedAt: new Date(), ...data };
        inspections.unshift(rec);
        return rec;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const target = inspections.find((i) => i.id === where.id);
        Object.assign(target, data, { updatedAt: new Date() });
        return target;
      }),
    },
    handlingUnit: {
      findUnique: jest.fn(async ({ where }: any) =>
        handlingUnits.find((h) => h.codigo === where.codigo || h.id === where.id) ?? null,
      ),
      findMany: jest.fn(async ({ where }: any) => {
        if (where?.lotId?.in) {
          return handlingUnits.filter(
            (h) => where.lotId.in.includes(h.lotId) && h.tipoHu === 'CAJA' && h.estadoHu === 'ACTIVO',
          );
        }
        return handlingUnits.map((h) => ({ ...h }));
      }),
      create: jest.fn(async ({ data }: any) => {
        const hu = {
          id: `hu-${seq++}`,
          lote: null,
          reacondicionada: false,
          cajaOrigenId: null,
          ...data,
        };
        handlingUnits.push(hu);
        return hu;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const target = handlingUnits.find((h) => h.id === where.id);
        Object.assign(target, data);
        return target;
      }),
    },
    lotInventory: {
      findMany: jest.fn(async ({ where }: any) => {
        if (where?.id?.in) {
          return lots.filter((l) => where.id.in.includes(l.id));
        }
        return lots.map((l) => ({ ...l }));
      }),
      create: jest.fn(async ({ data }: any) => {
        const lot = {
          id: `lot-${seq++}`,
          sku,
          ubicacion: data.ubicacionId === commercialLocation.id ? commercialLocation : devLocation,
          ...data,
        };
        lots.push(lot);
        return lot;
      }),
    },
    location: {
      findFirst: jest.fn(async () => devLocation),
      create: jest.fn(async () => devLocation),
    },
    inventoryMovement: {
      create: jest.fn(async ({ data }: any) => {
        const mv = { id: `mov-${seq++}`, fechaHora: new Date(), ...data };
        movements.push(mv);
        return mv;
      }),
    },
    auditLog: {
      findMany: jest.fn(async ({ where }: any) =>
        auditLogs.filter((a) => !where?.accion || a.accion === where.accion),
      ),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `aud-${seq++}`, createdAt: new Date(), ...data };
        auditLogs.push(row);
        return row;
      }),
    },
    $transaction: jest.fn(async (cb: any) => cb(prisma)),
    state: {
      receipt,
      line,
      inspections,
      handlingUnits,
      lots,
      movements,
      auditLogs,
      commercialLocation,
      sku,
    },
  };

  return prisma;
}

describe('QualityInspection semantics and ReceiptReportModal classification (A-E)', () => {
  it('A. Recepción 100% conforme (24 sanas, 0 daño, 0 rescate) -> totalPiezasRescatadas=0 y reporte LIBERADO / CONFORME', async () => {
    const prisma = createInspectionScenarioPrismaMock({ bultosDeclarados: 2, bultosRecibidos: 2, bultosDanados: 0 });
    const controller = new OperationsController(prisma, new PutawayEngineService(prisma));

    await controller.reconcileAnden('rec-qa-1', {
      usuario: 'admin@givingout.com',
      lineas: [{ receiptLineId: 'line-1', cajasSanas: 2, piezasSanas: 24, lote: 'LOT-SPEC-001', fechaVencimiento: '2027-06-30' }],
    });

    expect(prisma.state.inspections).toHaveLength(1);
    const qi = prisma.state.inspections[0];
    expect(qi.totalPiezasInspeccionadas).toBe(24);
    expect(qi.totalPiezasRescatadas).toBe(0);
    expect(qi.totalPiezasMerma).toBe(0);
    expect(qi.totalCajasNuevasArmadas).toBe(0);

    const detalles = JSON.parse(qi.detallesJson);
    expect(detalles[0]).toMatchObject({
      sku: 'ACE-OLI-1L',
      sanasAnden: 24,
      rescatadas: 0,
      totalConformes: 24,
      merma: 0,
    });

    const report: any = await controller.getReceiptReport('rec-qa-1');
    const summary = classifyQualityOutcome({
      qiRecord: report.qualityInspection,
      bultosDanados: report.resumenBultos.bultosDanados,
      bultosRecibidos: report.resumenBultos.bultosRecibidos,
      totalConformePiezas: report.resumenPiezas.totalConforme,
      totalMermaPiezas: report.resumenPiezas.totalMerma,
      boxHus: report.handlingUnits,
      hasDamagedBoxes: false,
      hasMerma: false,
      hasQuarantine: false,
      originDamagedBox: null,
      reconditionedBox: null,
    });

    expect(summary.isConformingCleanLiberation).toBe(true);
    expect(summary.hasRealRescue).toBe(false);
    expect(summary.piezasInspeccionadas).toBe(24);
    expect(summary.piezasConformesAnden).toBe(24);
    expect(summary.piezasRescatadas).toBe(0);
    expect(summary.piezasMerma).toBe(0);
    expect(summary.dictamenOperativo).toBe('LIBERADO / CONFORME');
    expect(summary.anexoBTituloDocumento).toBe('LIBERACIÓN TÉCNICA DE CALIDAD EN ANDÉN');
    expect(summary.firma2Titulo).toBe('2. Liberación Técnica de Calidad');
    expect(summary.firma2Titulo.toLowerCase()).not.toContain('rescate');
  });

  it('B. Recepción con daño y rescate real -> totalPiezasRescatadas y reporte muestran únicamente piezas recuperadas', async () => {
    const prisma = createInspectionScenarioPrismaMock({
      bultosDeclarados: 2,
      bultosRecibidos: 2,
      bultosDanados: 1,
      damagedBoxQty: 12,
    });
    const controller = new OperationsController(prisma, new PutawayEngineService(prisma));

    const qiRes: any = await controller.executeQualityInspection('rec-qa-1', {
      inspectorNombre: 'Inspector QA',
      armarCajasConformes: true,
      horasMaquila: 0.5,
      tarifaMaquilaPorHora: 100,
      items: [
        {
          huId: 'hu-dano-1',
          piezasTotales: 12,
          piezasRescatadas: 8,
          piezasMerma: 4,
          motivoDano: 'Empaque húmedo parcial',
        },
      ],
    } as any);

    expect(qiRes.balance.totalPiezasRescatadas).toBe(8);
    expect(qiRes.balance.totalPiezasMerma).toBe(4);
    expect(qiRes.balance.totalCajasNuevasArmadas).toBe(1);

    // Conciliar las 12 piezas sanas restantes en andén (total conformes = 12 sanas + 8 rescatadas = 20)
    await controller.reconcileAnden('rec-qa-1', {
      usuario: 'admin@givingout.com',
      lineas: [{ receiptLineId: 'line-1', cajasSanas: 1, piezasSanas: 12, lote: 'LOT-SPEC-001', fechaVencimiento: '2027-06-30' }],
    });

    const report: any = await controller.getReceiptReport('rec-qa-1');
    const rescuedHu = report.handlingUnits.find((h: any) => isActiveRescuedBox(h));
    const damagedOriginHu = report.handlingUnits.find((h: any) => h.codigo.includes('DANO'));

    expect(rescuedHu).toBeDefined();
    expect(rescuedHu.cantidad).toBe(8);

    const summary = classifyQualityOutcome({
      qiRecord: report.qualityInspection,
      bultosDanados: report.resumenBultos.bultosDanados,
      bultosRecibidos: report.resumenBultos.bultosRecibidos,
      totalConformePiezas: report.resumenPiezas.totalConforme,
      totalMermaPiezas: report.resumenPiezas.totalMerma,
      boxHus: report.handlingUnits,
      hasDamagedBoxes: true,
      hasMerma: true,
      hasQuarantine: false,
      originDamagedBox: damagedOriginHu,
      reconditionedBox: rescuedHu,
    });

    expect(summary.isConformingCleanLiberation).toBe(false);
    expect(summary.hasRealRescue).toBe(true);
    expect(summary.piezasInspeccionadas).toBe(12);
    expect(summary.piezasRescatadas).toBe(8);
    expect(summary.piezasMerma).toBe(4);
    expect(summary.piezasConformesAnden).toBe(12);
    expect(summary.dictamenOperativo).toBe('REACONDICIONADO');
    expect(summary.anexoBTituloDocumento).toBe('BITÁCORA TÉCNICA DE INSPECCIÓN Y RESCATE');
  });

  it('C. Recepción con merma sin rescate -> rescate=0, merma>0 y no clasifica HU merma DEV-01 como rescate activo', async () => {
    const prisma = createInspectionScenarioPrismaMock({
      bultosDeclarados: 1,
      bultosRecibidos: 1,
      bultosDanados: 1,
      damagedBoxQty: 12,
    });
    const controller = new OperationsController(prisma, new PutawayEngineService(prisma));

    const qiRes: any = await controller.executeQualityInspection('rec-qa-1', {
      inspectorNombre: 'Inspector QA',
      armarCajasConformes: true,
      items: [
        {
          huId: 'hu-dano-1',
          piezasTotales: 12,
          piezasRescatadas: 0,
          piezasMerma: 12,
          motivoDano: 'Producto roto en su totalidad',
        },
      ],
    } as any);

    expect(qiRes.balance.totalPiezasRescatadas).toBe(0);
    expect(qiRes.balance.totalPiezasMerma).toBe(12);
    expect(qiRes.balance.totalCajasNuevasArmadas).toBe(0);

    const report: any = await controller.getReceiptReport('rec-qa-1');
    expect(report.handlingUnits.filter((h: any) => isActiveRescuedBox(h))).toHaveLength(0);

    const summary = classifyQualityOutcome({
      qiRecord: report.qualityInspection,
      bultosDanados: report.resumenBultos.bultosDanados,
      bultosRecibidos: report.resumenBultos.bultosRecibidos,
      totalConformePiezas: report.resumenPiezas.totalConforme,
      totalMermaPiezas: report.resumenPiezas.totalMerma,
      boxHus: report.handlingUnits,
      hasDamagedBoxes: true,
      hasMerma: true,
      hasQuarantine: false,
      originDamagedBox: report.handlingUnits.find((h: any) => h.codigo.includes('DANO')),
      reconditionedBox: null,
    });

    expect(summary.isConformingCleanLiberation).toBe(false);
    expect(summary.hasRealDamageOrQuarantine).toBe(true);
    expect(summary.hasRealRescue).toBe(false);
    expect(summary.piezasRescatadas).toBe(0);
    expect(summary.piezasMerma).toBe(12);
    expect(summary.dictamenOperativo).toBe('INSPECCIONADO');
  });

  it('D. Compatibilidad histórica (REC-2026-0020 con totalPiezasRescatadas legado=24) -> infiere 0 rescate y LIBERADO / CONFORME sin tocar BD', () => {
    const legacyQiRecord = {
      id: '037f17fb-6408-4877-833b-3d99494b6c2c',
      folio: 'DICTAMEN-REC-2026-0020',
      totalCajasInspeccionadas: 2,
      totalPiezasInspeccionadas: 24,
      totalPiezasRescatadas: 24,
      totalPiezasMerma: 0,
      totalCajasNuevasArmadas: 0,
      detalles: [
        {
          sku: 'ACE-OLI-1L',
          rescatadas: 0,
          sanasAnden: 24,
          totalConformes: 24,
          merma: 0,
          esperada: 24,
          faltante: 0,
        },
      ],
      cajaOrigenCodigo: null,
      cajaDestinoCodigo: null,
    };

    const commercialBoxes = [
      { id: 'box-1', codigo: 'BOX-REC-2026-0020-0001', tipoHu: 'CAJA', cantidad: 12, estadoHu: 'ACTIVO', reacondicionada: false, cajaOrigenId: null },
      { id: 'box-2', codigo: 'BOX-REC-2026-0020-0002', tipoHu: 'CAJA', cantidad: 12, estadoHu: 'ACTIVO', reacondicionada: false, cajaOrigenId: null },
    ];

    const summary = classifyQualityOutcome({
      qiRecord: legacyQiRecord,
      bultosDanados: 0,
      bultosRecibidos: 2,
      totalConformePiezas: 24,
      totalMermaPiezas: 0,
      boxHus: commercialBoxes,
      hasDamagedBoxes: false,
      hasMerma: false,
      hasQuarantine: false,
      originDamagedBox: null,
      reconditionedBox: null,
    });

    expect(summary.isConformingCleanLiberation).toBe(true);
    expect(summary.hasRealRescue).toBe(false);
    expect(summary.piezasInspeccionadas).toBe(24);
    expect(summary.piezasConformesAnden).toBe(24);
    expect(summary.piezasRescatadas).toBe(0);
    expect(summary.piezasMerma).toBe(0);
    expect(summary.dictamenOperativo).toBe('LIBERADO / CONFORME');

    // Incluso sin detallesJson parseados, ausencia de daño/reacondicionamiento infiere 0 rescate
    const summaryWithoutDetails = classifyQualityOutcome({
      qiRecord: { ...legacyQiRecord, detalles: [], detallesJson: null },
      bultosDanados: 0,
      bultosRecibidos: 2,
      totalConformePiezas: 24,
      totalMermaPiezas: 0,
      boxHus: commercialBoxes,
      hasDamagedBoxes: false,
      hasMerma: false,
      hasQuarantine: false,
      originDamagedBox: null,
      reconditionedBox: null,
    });
    expect(summaryWithoutDetails.isConformingCleanLiberation).toBe(true);
    expect(summaryWithoutDetails.piezasRescatadas).toBe(0);
    expect(summaryWithoutDetails.dictamenOperativo).toBe('LIBERADO / CONFORME');
  });

  it('E. Cierre de recepción con QualityInspection.totalPiezasRescatadas=0 no bloquea cierre, stock ni trazabilidad', async () => {
    const prisma = createInspectionScenarioPrismaMock({ bultosDeclarados: 2, bultosRecibidos: 2, bultosDanados: 0 });
    const controller = new OperationsController(prisma, new PutawayEngineService(prisma));

    await controller.reconcileAnden('rec-qa-1', {
      usuario: 'admin@givingout.com',
      lineas: [{ receiptLineId: 'line-1', cajasSanas: 2, piezasSanas: 24, lote: 'LOT-SPEC-001', fechaVencimiento: '2027-06-30' }],
    });

    expect(prisma.state.inspections[0].totalPiezasRescatadas).toBe(0);

    // Simular Putaway comercial completado en G0001
    const lot = await prisma.lotInventory.create({
      data: {
        skuId: 'sku-ace',
        clienteId: 'cli-alimentos',
        lote: 'LOT-SPEC-001',
        fechaVencimiento: new Date('2027-06-30T00:00:00.000Z'),
        estadoCalidad: 'LIBERADO',
        cantidadDisponible: 24,
        cantidadReservada: 0,
        cantidadBloqueada: 0,
        ubicacionId: prisma.state.commercialLocation.id,
      },
    });
    prisma.state.handlingUnits.push(
      {
        id: 'hu-c1',
        codigo: 'BOX-REC-2026-0901-0001',
        receiptId: 'rec-qa-1',
        receiptLineId: 'line-1',
        skuId: 'sku-ace',
        skuCodigo: 'ACE-OLI-1L',
        tipoHu: 'CAJA',
        cantidad: 12,
        loteTexto: 'LOT-SPEC-001',
        fechaVencimiento: new Date('2027-06-30T00:00:00.000Z'),
        estadoHu: 'ACTIVO',
        ubicacionActual: 'G0001',
        lotId: lot.id,
        reacondicionada: false,
      },
      {
        id: 'hu-c2',
        codigo: 'BOX-REC-2026-0901-0002',
        receiptId: 'rec-qa-1',
        receiptLineId: 'line-1',
        skuId: 'sku-ace',
        skuCodigo: 'ACE-OLI-1L',
        tipoHu: 'CAJA',
        cantidad: 12,
        loteTexto: 'LOT-SPEC-001',
        fechaVencimiento: new Date('2027-06-30T00:00:00.000Z'),
        estadoHu: 'ACTIVO',
        ubicacionActual: 'G0001',
        lotId: lot.id,
        reacondicionada: false,
      },
    );

    const closed: any = await controller.closeReceipt('rec-qa-1', { usuario: 'admin@givingout.com' });
    expect(closed.success).toBe(true);
    expect(closed.receipt.estado).toBe('CERRADA');
    expect(prisma.state.auditLogs.some((a: any) => a.accion === 'CERRAR_RECEPCION')).toBe(true);
  });
});

