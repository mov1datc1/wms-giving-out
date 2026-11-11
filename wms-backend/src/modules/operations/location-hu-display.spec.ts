jest.mock('../../prisma.service', () => ({
  PrismaService: class MockPrismaService {},
}));
jest.mock('../../email.service', () => ({
  EmailService: class MockEmailService {},
}));

import { MasterDataController } from '../master-data/master-data.controller';
import {
  getLocationHuRowPresentation,
  isContainerMasterHu,
  summarizeLocationHus,
} from '../../../../wms-frontend/src/utils/locationHuDisplay';

describe('Ubicaciones: exclusión de Tarima Master (PALLET/TARIMA) en suma inventariable', () => {
  it('1. 1 Pallet Master + 2 cajas de 12 PZA + LotInventory 24 PZA -> suma 24 PZA (NO 26), ocupación 1 tarima, sin warning', async () => {
    const palletId = 'plt-uuid-1';
    const lotObj = {
      id: 'lot-uuid-1',
      skuId: 'sku-1',
      clienteId: 'cli-1',
      lote: 'LOT-SPEC-001',
      estadoCalidad: 'LIBERADO',
      cantidadDisponible: 24,
      cantidadReservada: 0,
      cantidadBloqueada: 0,
      sku: { codigo: 'SKU-GEN-01', descripcion: 'Producto de Prueba' },
      cliente: { id: 'cli-1', nombreComercial: 'Depositante Demo' },
    };

    const handlingUnits = [
      {
        id: 'box-uuid-1',
        codigo: 'BOX-TEST-0001',
        tipoHu: 'CAJA',
        uom: 'PZA',
        cantidad: 12,
        parentHuId: palletId,
        ubicacionActual: 'G0001',
        estadoHu: 'ACTIVO',
        skuCodigo: 'SKU-GEN-01',
        loteTexto: 'LOT-SPEC-001',
        lotId: lotObj.id,
        lote: lotObj,
      },
      {
        id: 'box-uuid-2',
        codigo: 'BOX-TEST-0002',
        tipoHu: 'CAJA',
        uom: 'PZA',
        cantidad: 12,
        parentHuId: palletId,
        ubicacionActual: 'G0001',
        estadoHu: 'ACTIVO',
        skuCodigo: 'SKU-GEN-01',
        loteTexto: 'LOT-SPEC-001',
        lotId: lotObj.id,
        lote: lotObj,
      },
      {
        id: palletId,
        codigo: 'PLT-TEST-01',
        tipoHu: 'PALLET',
        uom: 'TARIMA',
        cantidad: 2,
        parentHuId: null,
        ubicacionActual: 'G0001',
        estadoHu: 'ACTIVO',
        skuCodigo: null,
        loteTexto: null,
        lotId: null,
        lote: null,
      },
    ];

    const prismaMock: any = {
      location: {
        findFirst: jest.fn(async () => ({
          id: 'loc-g0001',
          codigo: 'G0001',
          tipoUbicacion: 'TARIMA_PISO',
          estado: 'OCUPADO',
          activo: true,
          capacidadUnits: 100,
          zona: { codigo: 'INTERIOR', nombre: 'Interior', tipoZona: 'ALMACENAMIENTO' },
          almacen: { id: 'wh-1', nombre: 'CEDIS' },
          lotes: [lotObj],
        })),
      },
      handlingUnit: {
        findMany: jest.fn(async () => handlingUnits),
      },
    };

    const controller = new MasterDataController(prismaMock, {} as any);
    const detail: any = await controller.getLocationById('G0001');

    // Validación backend GET /locations/:id
    expect(detail.ocupacionBultos).toBe(1);
    expect(detail.capacidadBultos).toBe(1);
    expect(detail.totalFisico).toBe(24);
    expect(detail.ocupacionUnidades).toBe(24);
    expect(detail.estadoCapacidad).toBe('LLENO');
    expect(detail.handlingUnits).toHaveLength(3);

    // Validación lógica UI Locations.tsx
    const summary = summarizeLocationHus({
      lots: detail.lotes,
      hus: detail.handlingUnits,
      allHusInPosition: detail.handlingUnits,
    });

    expect(summary.totalPiecesInLots).toBe(24);
    expect(summary.totalPiecesInInventariableHus).toBe(24);
    expect(summary.totalPiecesInInventariableHus).not.toBe(26);
    expect(summary.physicalPalletsCount).toBe(1);
    expect(summary.containerHus).toHaveLength(1);
    expect(summary.inventariableHus).toHaveLength(2);
    expect(summary.hasHuDiscrepancy).toBe(false);

    // Validación semántica por fila
    const palletPresentation = getLocationHuRowPresentation(handlingUnits[2], detail.handlingUnits);
    expect(palletPresentation.isContainer).toBe(true);
    expect(palletPresentation.cantidadLabel).toBe('1 tarima');
    expect(palletPresentation.cantidadSublabel).toBe('2 cajas asociadas');
    expect(palletPresentation.contenidoLabel).toBe('Contenedor de 2 cajas');
    expect(palletPresentation.cantidadLabel.toLowerCase()).not.toContain('pieza');

    const boxPresentation = getLocationHuRowPresentation(handlingUnits[0], detail.handlingUnits);
    expect(boxPresentation.isContainer).toBe(false);
    expect(boxPresentation.cantidadLabel).toBe('12 piezas');
    expect(boxPresentation.parentCodigo).toBe('PLT-TEST-01');
  });

  it('2. Discrepancia REAL entre HUs inventariables y LotInventory sí activa warning (sin sumar Pallet Master)', () => {
    const palletId = 'plt-real-disc';
    const lots = [{ cantidadDisponible: 18, cantidadBloqueada: 0 }];
    const hus = [
      { id: 'b1', codigo: 'BOX-0001', tipoHu: 'CAJA', uom: 'PZA', cantidad: 12, parentHuId: palletId, skuCodigo: 'SKU-1', lotId: 'l1' },
      { id: 'b2', codigo: 'BOX-0002', tipoHu: 'CAJA', uom: 'PZA', cantidad: 12, parentHuId: palletId, skuCodigo: 'SKU-1', lotId: 'l1' },
      { id: palletId, codigo: 'PLT-01', tipoHu: 'PALLET', uom: 'TARIMA', cantidad: 2, parentHuId: null, skuCodigo: null, lotId: null },
    ];

    const summary = summarizeLocationHus({ lots, hus, allHusInPosition: hus });

    expect(summary.totalPiecesInLots).toBe(18);
    expect(summary.totalPiecesInInventariableHus).toBe(24);
    expect(summary.hasHuDiscrepancy).toBe(true);
  });

  it('3. HU virtual tipo PALLET con lotId/SKU y uom=PZA sin hijos sí cuenta como inventariable', () => {
    const virtualPalletHu = {
      id: 'hu-vir-1',
      codigo: 'HU-NC-VIR-01',
      tipoHu: 'PALLET',
      uom: 'PZA',
      cantidad: 60,
      parentHuId: null,
      skuCodigo: 'SKU-1',
      lotId: 'lot-vir-1',
    };

    expect(isContainerMasterHu(virtualPalletHu, [virtualPalletHu])).toBe(false);
    const summary = summarizeLocationHus({
      lots: [{ cantidadDisponible: 0, cantidadBloqueada: 60 }],
      hus: [virtualPalletHu],
      allHusInPosition: [virtualPalletHu],
    });
    expect(summary.totalPiecesInInventariableHus).toBe(60);
    expect(summary.hasHuDiscrepancy).toBe(false);
  });
});

