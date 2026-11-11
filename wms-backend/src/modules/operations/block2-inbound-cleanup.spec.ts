jest.mock('../../prisma.service', () => ({
  PrismaService: class MockPrismaService {},
}));
jest.mock('../../email.service', () => ({
  EmailService: class MockEmailService {},
}));

import { ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as jwt from 'jsonwebtoken';
import { OperationsController } from './operations.controller';
import { PutawayEngineService } from './putaway-engine.service';
import { WmsAuthGuard } from '../auth/wms-auth.guard';
import { formatCalendarDate } from '../../../../wms-frontend/src/utils/dateUtils';
import { getLocationHuRowPresentation, isContainerMasterHu } from '../../../../wms-frontend/src/utils/locationHuDisplay';

const JWT_SECRET = process.env.JWT_SECRET || 'giving-out-wms-secret-2026';

function createAcusePrismaMock(receipt: any) {
  return {
    receipt: {
      findFirst: jest.fn(async ({ where }: any) => {
        if (!receipt) return null;
        const clauses = where?.OR || [];
        const matched = clauses.some(
          (c: any) => (c.id && c.id === receipt.id) || (c.codigo && c.codigo === receipt.codigo),
        );
        return matched ? receipt : null;
      }),
    },
  };
}

function makeGuardContext(handlerName: keyof OperationsController, headers: Record<string, string>) {
  const handler = OperationsController.prototype[handlerName];
  const request: any = { headers };
  const context = {
    getHandler: () => handler,
    getClass: () => OperationsController,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return context;
}

describe('Block 2 Inbound Cleanup — Acuse de Rampa, Tarima Master en Etiquetado y Fechas', () => {
  describe('GET /api/receipts/:id/acuse-rampa (UUID y código + RBAC)', () => {
    const sampleReceipt = {
      id: '03872d7e-bdc7-4d61-9c01-415bc90d5473',
      codigo: 'REC-2026-0020',
      bultosDeclarados: 2,
      bultosRecibidos: 2,
      bultosDanados: 0,
      diferenciaBultos: 0,
      andenAsignado: 'Andén 01',
      fechaRecepcion: new Date('2026-11-10T18:00:00.000Z'),
      cliente: { id: 'cli-1', nombreComercial: 'AlimNorte', razonSocial: 'AlimNorte S.A.' },
      proveedor: { id: 'prov-1', nombre: 'Proveedor Uno' },
      lineas: [],
    };

    it('acepta consulta tanto por UUID como por código folio REC-2026-0020 (200) y devuelve 404 si no existe', async () => {
      const prismaMock = createAcusePrismaMock(sampleReceipt);
      const ctrl = new OperationsController(prismaMock as any, new PutawayEngineService(prismaMock as any));

      const byUuid: any = await ctrl.getAcuseRampa('03872d7e-bdc7-4d61-9c01-415bc90d5473');
      expect(byUuid.receiptId).toBe('03872d7e-bdc7-4d61-9c01-415bc90d5473');
      expect(byUuid.codigo).toBe('REC-2026-0020');
      expect(byUuid.transporte.andenAsignado).toBe('Andén 01');

      const byCode: any = await ctrl.getAcuseRampa('REC-2026-0020');
      expect(byCode.receiptId).toBe('03872d7e-bdc7-4d61-9c01-415bc90d5473');
      expect(byCode.codigo).toBe('REC-2026-0020');
      expect(byCode.transporte.andenAsignado).toBe('Andén 01');

      await expect(ctrl.getAcuseRampa('REC-NO-EXISTE')).rejects.toMatchObject({
        status: HttpStatus.NOT_FOUND,
      });
    });

    it('protege getAcuseRampa vía WmsAuthGuard: sin token -> 401, Picking/Portal/spoof -> 403, Recepción/Admin -> 200', async () => {
      const makeGuard = (roleNombre: string, modulos: { modulo: string; accion: string }[], clienteId: string | null = null) => {
        const dbUser = {
          id: `u-${roleNombre}`,
          email: `${roleNombre}@givingout.com`,
          nombre: roleNombre,
          activo: true,
          clienteId,
          rol: { id: `r-${roleNombre}`, nombre: roleNombre, permisos: modulos },
        };
        const prismaGuard = { user: { findUnique: jest.fn(async () => dbUser) } };
        return new WmsAuthGuard(prismaGuard as any, new Reflector());
      };

      // Sin token -> 401
      const noTokenGuard = makeGuard('Super Admin', [{ modulo: 'recepcion', accion: 'ver' }]);
      await expect(
        noTokenGuard.canActivate(makeGuardContext('getAcuseRampa', {})),
      ).rejects.toMatchObject({ status: HttpStatus.UNAUTHORIZED });

      // Operador Picking con x-user-role spoofeado -> 403
      const pickToken = jwt.sign({ userId: 'u-Operador Picking' }, JWT_SECRET);
      const pickGuard = makeGuard('Operador Picking', [{ modulo: 'picking', accion: 'ver' }]);
      await expect(
        pickGuard.canActivate(
          makeGuardContext('getAcuseRampa', {
            authorization: `Bearer ${pickToken}`,
            'x-user-role': 'Super Admin',
          }),
        ),
      ).rejects.toMatchObject({ status: HttpStatus.FORBIDDEN });

      // Depositante Portal -> 403 (allowPortal: false)
      const portalToken = jwt.sign({ userId: 'u-Depositante' }, JWT_SECRET);
      const portalGuard = makeGuard('Depositante', [{ modulo: 'recepcion', accion: 'ver' }], 'cli-portal');
      await expect(
        portalGuard.canActivate(
          makeGuardContext('getAcuseRampa', { authorization: `Bearer ${portalToken}` }),
        ),
      ).rejects.toMatchObject({ status: HttpStatus.FORBIDDEN });

      // Operador Recepción autorizado -> true (200)
      const recToken = jwt.sign({ userId: 'u-Operador Recepción' }, JWT_SECRET);
      const recGuard = makeGuard('Operador Recepción', [{ modulo: 'recepcion', accion: 'ver' }]);
      await expect(
        recGuard.canActivate(
          makeGuardContext('getAcuseRampa', { authorization: `Bearer ${recToken}` }),
        ),
      ).resolves.toBe(true);
    });
  });

  describe('Presentación Tarima Master en Etiquetado y Fechas en DualLabelModal', () => {
    it('deriva SKU contenido y "Contenedor de 2 cajas" / "1 tarima" para PLT-REC-2026-0020-01 sin mostrar SKU-N/A ni 2 PZA', () => {
      const pltId = 'plt-01';
      const allHus = [
        {
          id: pltId,
          codigo: 'PLT-REC-2026-0020-01',
          tipoHu: 'PALLET',
          uom: 'TARIMA',
          cantidad: 2,
          parentHuId: null,
          skuCodigo: null,
          lotId: null,
          lote: null,
        },
        {
          id: 'box-1',
          codigo: 'BOX-REC-2026-0020-0001',
          tipoHu: 'CAJA',
          uom: 'PZA',
          cantidad: 12,
          parentHuId: pltId,
          skuCodigo: 'ACE-OLI-1L',
          loteTexto: 'LOT-QA-E2E-001',
          lote: { lote: 'LOT-QA-E2E-001', sku: { codigo: 'ACE-OLI-1L', descripcion: 'Aceite de Oliva Extra Virgen 1L' } },
        },
        {
          id: 'box-2',
          codigo: 'BOX-REC-2026-0020-0002',
          tipoHu: 'CAJA',
          uom: 'PZA',
          cantidad: 12,
          parentHuId: pltId,
          skuCodigo: 'ACE-OLI-1L',
          loteTexto: 'LOT-QA-E2E-001',
          lote: { lote: 'LOT-QA-E2E-001', sku: { codigo: 'ACE-OLI-1L', descripcion: 'Aceite de Oliva Extra Virgen 1L' } },
        },
      ];

      expect(isContainerMasterHu(allHus[0], allHus)).toBe(true);
      const pres = getLocationHuRowPresentation(allHus[0], allHus);
      expect(pres.tipoLabel).toBe('Tarima Master');
      expect(pres.contenidoLabel).toBe('Contenedor de 2 cajas');
      expect(pres.cantidadLabel).toBe('1 tarima');
      expect(pres.childSkus).toEqual(['ACE-OLI-1L']);
      expect(pres.childLots).toEqual(['LOT-QA-E2E-001']);
    });

    it('formatea caducidad de calendario 2027-06-30 exactamente como 30/06/2027 sin desfase UTC -1 día', () => {
      expect(formatCalendarDate('2027-06-30')).toBe('30/06/2027');
      expect(formatCalendarDate('2027-06-30T00:00:00.000Z')).toBe('30/06/2027');
    });
  });
});
