jest.mock('../../prisma.service', () => ({
  PrismaService: class MockPrismaService {},
}));
jest.mock('../../email.service', () => ({
  EmailService: class MockEmailService {},
}));

import { InventoryController } from '../inventory/inventory.controller';
import { OperationsController } from './operations.controller';
import { PutawayEngineService } from './putaway-engine.service';
import { formatCalendarDate } from '../../../../wms-frontend/src/utils/dateUtils';
import {
  formatMovementExpiryDate,
  formatMovementMotivoDisplay,
  isHistoricalRackLocation,
} from '../../../../wms-frontend/src/utils/traceabilityDisplay';

describe('Trazabilidad / Kárdex: fechas de calendario y terminología de layout', () => {
  it('1. expiry 2027-06-30 y 2027-06-30T00:00:00.000Z siempre se muestran como 30/06/2027 (nunca 29/06/2027 ni 29/6/2027)', () => {
    expect(formatCalendarDate('2027-06-30')).toBe('30/06/2027');
    expect(formatCalendarDate('2027-06-30T00:00:00.000Z')).toBe('30/06/2027');
    expect(formatMovementExpiryDate('2027-06-30T00:00:00.000Z')).toBe('30/06/2027');
    expect(formatMovementExpiryDate(new Date('2027-06-30T00:00:00.000Z'))).toBe('30/06/2027');
    expect(formatMovementExpiryDate('2027-06-30T00:00:00.000Z')).not.toBe('29/06/2027');
    expect(formatMovementExpiryDate('2027-06-30T00:00:00.000Z')).not.toBe('29/6/2027');

    // Fechas límite adicionales sensibles a huso horario UTC negativo (America/Mexico_City)
    expect(formatMovementExpiryDate('2027-01-01T00:00:00.000Z')).toBe('01/01/2027');
    expect(formatMovementExpiryDate('2026-03-01T00:00:00.000Z')).toBe('01/03/2026');
  });

  it('2. Posiciones TARIMA_PISO (G0001, G0015, etc.) no se describen como rack en presentación histórica ni en texto nuevo', () => {
    const legacyMovementOnFloor = {
      id: 'mov-1',
      cantidad: 12,
      fromLocation: { codigo: 'REC-01', tipoUbicacion: 'RECIBO' },
      toLocation: { codigo: 'G0001', tipoUbicacion: 'TARIMA_PISO' },
      motivo: 'Alojamiento Putaway confirmado a rack G0001 (Fase 4)',
      lote: { lote: 'LOT-QA-E2E-001', fechaVencimiento: '2027-06-30T00:00:00.000Z' },
    };

    expect(isHistoricalRackLocation(legacyMovementOnFloor.toLocation)).toBe(false);
    const displayText = formatMovementMotivoDisplay(legacyMovementOnFloor);
    expect(displayText).toBe('Alojamiento Putaway confirmado en posición física G0001 (Fase 4)');
    expect(displayText.toLowerCase()).not.toContain('rack');
    // No muta el registro original proveniente de BD
    expect(legacyMovementOnFloor.motivo).toBe('Alojamiento Putaway confirmado a rack G0001 (Fase 4)');

    // Generalización sin hardcodeo para cualquier otra posición Gxxxx o TARIMA_PISO
    const genericFloorMovement = {
      toLocation: { codigo: 'G0028', tipoUbicacion: 'TARIMA_PISO' },
      motivo: 'Alojamiento Putaway confirmado a rack G0028 (Fase 4)',
    };
    expect(formatMovementMotivoDisplay(genericFloorMovement)).toBe(
      'Alojamiento Putaway confirmado en posición física G0028 (Fase 4)',
    );

    // Backend wording helper para nuevos movimientos
    const ctrl: any = new OperationsController({} as any, new PutawayEngineService({} as any));
    expect(ctrl.formatDestinationLocationPhrase({ codigo: 'G0001', tipoUbicacion: 'TARIMA_PISO' })).toBe(
      'en posición física G0001',
    );
    expect(ctrl.formatDestinationLocationPhrase({ codigo: 'G0032', tipoUbicacion: 'TARIMA_PISO' })).toBe(
      'en posición física G0032',
    );
  });

  it('3. Racks históricos Axx/Bxx (ESTANTERIA/RACK) conservan su semántica histórica en backend y UI', () => {
    const legacyRackMovement = {
      toLocation: { codigo: 'A01-R01-N1', tipoUbicacion: 'ESTANTERIA' },
      motivo: 'Alojamiento Putaway confirmado a rack A01-R01-N1 (Fase 4)',
    };
    expect(isHistoricalRackLocation(legacyRackMovement.toLocation)).toBe(true);
    expect(formatMovementMotivoDisplay(legacyRackMovement)).toBe(
      'Alojamiento Putaway confirmado a rack A01-R01-N1 (Fase 4)',
    );

    const legacyRackByCodeOnly = {
      toLocation: { codigo: 'B02-R01-N2' },
      motivo: 'Alojamiento Putaway confirmado a rack B02-R01-N2 (Fase 4)',
    };
    expect(isHistoricalRackLocation(legacyRackByCodeOnly.toLocation)).toBe(true);
    expect(formatMovementMotivoDisplay(legacyRackByCodeOnly)).toBe(
      'Alojamiento Putaway confirmado a rack B02-R01-N2 (Fase 4)',
    );

    const ctrl: any = new OperationsController({} as any, new PutawayEngineService({} as any));
    expect(ctrl.formatDestinationLocationPhrase({ codigo: 'A01-R01-N1', tipoUbicacion: 'ESTANTERIA' })).toBe(
      'a rack A01-R01-N1',
    );
  });

  it('4. GET /api/inventory/movements incluye tipoUbicacion y conserva REC-01 -> G0001 y 12 PZA sin mutar BD', async () => {
    const storedMovements = [
      {
        id: 'mov-bfa02d40',
        tipoMovimiento: 'TRASIEGO',
        cantidad: 12,
        fromLocation: { codigo: 'REC-01', tipoUbicacion: 'RECIBO' },
        toLocation: { codigo: 'G0001', tipoUbicacion: 'TARIMA_PISO' },
        lote: { lote: 'LOT-QA-E2E-001', fechaVencimiento: '2027-06-30T00:00:00.000Z' },
        hu: { codigo: 'BOX-REC-2026-0020-0001' },
        motivo: 'Alojamiento Putaway confirmado a rack G0001 (Fase 4)',
      },
    ];
    const prismaMock: any = {
      inventoryMovement: {
        findMany: jest.fn(async () => storedMovements),
        update: jest.fn(),
        create: jest.fn(),
      },
    };
    const controller = new InventoryController(prismaMock, new PutawayEngineService(prismaMock));
    const result: any[] = await controller.getMovements();

    expect(prismaMock.inventoryMovement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          fromLocation: { select: { codigo: true, tipoUbicacion: true } },
          toLocation: { select: { codigo: true, tipoUbicacion: true } },
        }),
      }),
    );
    expect(prismaMock.inventoryMovement.update).not.toHaveBeenCalled();
    expect(prismaMock.inventoryMovement.create).not.toHaveBeenCalled();

    expect(result[0].fromLocation.codigo).toBe('REC-01');
    expect(result[0].toLocation.codigo).toBe('G0001');
    expect(result[0].cantidad).toBe(12);
    expect(formatMovementExpiryDate(result[0].lote.fechaVencimiento)).toBe('30/06/2027');
    expect(formatMovementMotivoDisplay(result[0])).toBe(
      'Alojamiento Putaway confirmado en posición física G0001 (Fase 4)',
    );
  });
});

