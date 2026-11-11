jest.mock('../../prisma.service', () => ({
  PrismaService: class MockPrismaService {},
}));
jest.mock('../../email.service', () => ({
  EmailService: class MockEmailService {},
}));

import { MasterDataController } from '../master-data/master-data.controller';
import {
  getActiveOperationalZoneIds,
  getLocationHuRowPresentation,
  hasActiveAssignedClientZone,
  isContainerMasterHu,
  isLocationCompatibleWithClient,
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

  it('4. getLocations agrupa bultosPorCliente por (parentHuId || id): 1 Pallet Master + 2 cajas = 1 bulto físico (NO 3)', async () => {
    const palletId = 'plt-rec20-01';
    const clientId = 'cli-alimnorte';
    const lotObj = {
      id: 'lot-qa-1',
      ubicacionId: 'loc-g0001',
      skuId: 'sku-ace',
      clienteId: clientId,
      cantidadDisponible: 24,
      cantidadReservada: 0,
      cantidadBloqueada: 0,
      sku: { id: 'sku-ace', codigo: 'ACE-OLI-1L', descripcion: 'Aceite de Oliva Extra Virgen 1L', uomBase: 'PZA' },
      cliente: { id: clientId, nombreComercial: 'AlimNorte', razonSocial: 'AlimNorte' },
    };

    const handlingUnits = [
      {
        id: palletId,
        codigo: 'PLT-REC-2026-0020-01',
        tipoHu: 'PALLET',
        parentHuId: null,
        ubicacionActual: 'G0001',
        cantidad: 2,
        clienteId: clientId,
        lotId: null,
        lote: null,
      },
      {
        id: 'box-1',
        codigo: 'BOX-REC-2026-0020-0001',
        tipoHu: 'CAJA',
        parentHuId: palletId,
        ubicacionActual: 'G0001',
        cantidad: 12,
        clienteId: clientId,
        lotId: lotObj.id,
        lote: { id: lotObj.id, ubicacionId: 'loc-g0001', cantidadDisponible: 24, cantidadBloqueada: 0 },
      },
      {
        id: 'box-2',
        codigo: 'BOX-REC-2026-0020-0002',
        tipoHu: 'CAJA',
        parentHuId: palletId,
        ubicacionActual: 'G0001',
        cantidad: 12,
        clienteId: clientId,
        lotId: lotObj.id,
        lote: { id: lotObj.id, ubicacionId: 'loc-g0001', cantidadDisponible: 24, cantidadBloqueada: 0 },
      },
    ];

    const prismaMock: any = {
      location: {
        findMany: jest.fn(async () => [
          {
            id: 'loc-g0001',
            codigo: 'G0001',
            tipoUbicacion: 'TARIMA_PISO',
            estado: 'OCUPADO',
            activo: true,
            capacidadUnits: 100,
            zonaId: 'zone-interior',
            zona: { id: 'zone-interior', codigo: 'INTERIOR', nombre: 'Área Interior', tipoZona: 'ALMACENAMIENTO' },
            almacen: { id: 'wh-1', nombre: 'CEDIS' },
            lotes: [lotObj],
          },
        ]),
      },
      handlingUnit: {
        findMany: jest.fn(async () => handlingUnits),
      },
    };

    const controller = new MasterDataController(prismaMock, {} as any);
    const locations: any[] = await controller.getLocations();

    expect(locations).toHaveLength(1);
    expect(locations[0].ocupacionBultos).toBe(1);
    expect(locations[0].ocupacionUnidades).toBe(24);
    expect(locations[0].bultosPorCliente[clientId]).toBe(1);
    expect(locations[0].bultosPorCliente[clientId]).not.toBe(3);
  });

  it('5. Compatibilidad de ubicaciones excluye racks inactivos (activo=false) e ignora zonaAsignadaId legacy (ALM-A/ALM-B)', () => {
    const legacyZoneId = 'zone-alm-b';
    const interiorZoneId = 'zone-interior';
    const exteriorZoneId = 'zone-exterior';

    const locations = [
      // Posición activa ocupada por AlimNorte
      {
        id: 'g1', codigo: 'G0001', activo: true, tipoUbicacion: 'TARIMA_PISO',
        esAlmacenable: true, categoriaUbicacion: 'FISICA_ALMACENABLE',
        estado: 'OCUPADO', estadoCapacidad: 'LLENO', zonaId: interiorZoneId,
      },
      // Posiciones comerciales activas libres
      {
        id: 'g2', codigo: 'G0002', activo: true, tipoUbicacion: 'TARIMA_PISO',
        esAlmacenable: true, categoriaUbicacion: 'FISICA_ALMACENABLE',
        estado: 'LIBRE', estadoCapacidad: 'LIBRE', zonaId: interiorZoneId,
      },
      {
        id: 'g37', codigo: 'G0037', activo: true, tipoUbicacion: 'TARIMA_PISO',
        esAlmacenable: true, categoriaUbicacion: 'FISICA_ALMACENABLE',
        estado: 'LIBRE', estadoCapacidad: 'LIBRE', zonaId: exteriorZoneId,
      },
      // Posición PNC (excluida de disponibilidad comercial)
      {
        id: 'g36', codigo: 'G0036', activo: true, tipoUbicacion: 'PNC',
        esAlmacenable: false, categoriaUbicacion: 'VIRTUAL_NO_CONFORME',
        estado: 'LIBRE', estadoCapacidad: 'NO_APLICA', zonaId: exteriorZoneId,
      },
      // Racks históricos ALM-B inactivos (antes causaban "12 celdas disponibles")
      {
        id: 'b01', codigo: 'B01-R01-N1', activo: false, tipoUbicacion: 'ESTANTERIA',
        esAlmacenable: true, categoriaUbicacion: 'FISICA_ALMACENABLE',
        estado: 'LIBRE', estadoCapacidad: 'LIBRE', zonaId: legacyZoneId,
      },
    ];

    const alimNorteLegacyClient = { id: 'cli-alim', nombreComercial: 'AlimNorte', zonaAsignadaId: legacyZoneId };
    const activeZones = getActiveOperationalZoneIds(locations);

    expect(activeZones.has(interiorZoneId)).toBe(true);
    expect(activeZones.has(exteriorZoneId)).toBe(true);
    expect(activeZones.has(legacyZoneId)).toBe(false);
    expect(hasActiveAssignedClientZone(alimNorteLegacyClient, activeZones)).toBe(false);

    const compatibleFree = locations.filter((l) => isLocationCompatibleWithClient(l, alimNorteLegacyClient, false, activeZones));
    expect(compatibleFree.map((l) => l.codigo)).toEqual(['G0002', 'G0037']);
    expect(compatibleFree.some((l) => l.codigo === 'B01-R01-N1')).toBe(false);
    expect(compatibleFree.some((l) => l.codigo === 'G0036')).toBe(false);
  });
});

