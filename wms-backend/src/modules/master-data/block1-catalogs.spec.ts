jest.mock('../../prisma.service', () => ({
  PrismaService: class MockPrismaService {},
}));

import { ConflictException, HttpException, HttpStatus } from '@nestjs/common';
import { ClientsController } from '../clients/clients.controller';
import { EndCustomersController } from '../end-customers/end-customers.controller';
import { MasterDataController } from './master-data.controller';
import { OperationsController } from '../operations/operations.controller';

describe('Block 1 Catalogos, Tenant Isolation y Endurecimiento Operativo', () => {
  describe('ClientsController — tarimas reales, actor verificado y campos fiscales', () => {
    it('calcula totalTarimas agrupando cajas hijas bajo Tarima Master padre y bloquea lectura cross-tenant', async () => {
      const clientRow = {
        id: 'cli-alimnorte',
        codigo: 'ALM-01',
        nombreComercial: 'Distribuidora AlimNorte S.A.',
        requiereLote: true,
        requiereCaducidad: true,
        reglaInventario: 'FEFO',
        uomPrincipal: 'PZA',
        manejoInventario: 'CAJA',
        _count: {
          skus: 2,
          ordenesSalida: 0,
          recepciones: 2,
          lotes: 1,
          handlingUnits: 3,
          endCustomers: 0,
        },
      };
      const prismaMock = {
        client: {
          findMany: jest.fn().mockResolvedValue([clientRow]),
          findUnique: jest.fn().mockResolvedValue(clientRow),
        },
        handlingUnit: {
          findMany: jest.fn().mockResolvedValue([
            { id: 'hu-pallet-1', clienteId: 'cli-alimnorte', parentHuId: null, tipoHu: 'PALLET' },
            { id: 'hu-box-1', clienteId: 'cli-alimnorte', parentHuId: 'hu-pallet-1', tipoHu: 'CAJA' },
            { id: 'hu-box-2', clienteId: 'cli-alimnorte', parentHuId: 'hu-pallet-1', tipoHu: 'CAJA' },
          ]),
        },
      };

      const controller = new ClientsController(prismaMock as any);

      const listRes = await controller.getClients(undefined, undefined, undefined, { user: { clienteId: null } });
      expect(listRes[0].stats.totalTarimas).toBe(1);
      expect(listRes[0].stats.totalCajas).toBe(2);

      const detailRes = await controller.getClient('cli-alimnorte', { user: { clienteId: null } });
      expect(detailRes.stats.totalTarimas).toBe(1);
      expect(detailRes.stats.totalCajas).toBe(2);

      await expect(
        controller.getClient('cli-alimnorte', { user: { clienteId: 'cli-otro' } }),
      ).rejects.toMatchObject({ status: HttpStatus.FORBIDDEN });
    });

    it('actualiza direccionFiscal y ciudad por separado y audita exclusivamente req.user verificado', async () => {
      const prismaMock = {
        client: {
          findUnique: jest.fn().mockResolvedValue({ id: 'cli-1', codigo: 'CLI-1' }),
          update: jest.fn().mockImplementation(async ({ data }) => ({ id: 'cli-1', codigo: 'CLI-1', ...data })),
        },
        auditLog: { create: jest.fn().mockResolvedValue({}) },
      };

      const controller = new ClientsController(prismaMock as any);
      const updated = await controller.updateClient(
        'cli-1',
        { id: 'cli-1', direccionFiscal: 'Av. Reforma 123', ciudad: 'CDMX', estado: 'CDMX' } as any,
        {
          headers: { 'x-user-role': 'Operario Falsificado' },
          user: { id: 'u1', email: 'admin@givingout.mx', nombre: 'Admin Real', rolNombre: 'Super Admin' },
        },
      );

      expect(updated.direccionFiscal).toBe('Av. Reforma 123');
      expect(updated.ciudad).toBe('CDMX');
      const updateArg = prismaMock.client.update.mock.calls[0][0].data;
      expect(updateArg.id).toBeUndefined();
      expect(prismaMock.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ usuario: 'admin@givingout.mx', accion: 'ACTUALIZAR_DEPOSITANTE' }),
        }),
      );
    });
  });

  describe('EndCustomersController — CRUD, unicidad 409 y aislamiento multi-tenant', () => {
    it('soporta filtro ?activo=true|false|all y fuerza clienteId del tenant Portal', async () => {
      const findMany = jest.fn().mockResolvedValue([]);
      const controller = new EndCustomersController({ endCustomer: { findMany } } as any);

      await controller.getEndCustomers('cli-ajeno', 'all', { user: { clienteId: 'cli-celera' } });
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { clienteId: 'cli-celera' },
        }),
      );

      await controller.getEndCustomers(undefined, 'false', { user: { clienteId: null } });
      expect(findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: { activo: false },
        }),
      );
    });

    it('rechaza alta para otro depositante con 403 y traduce P2002 a 409 Conflict', async () => {
      const prismaMock = {
        client: { findUnique: jest.fn().mockResolvedValue({ id: 'cli-1', nombreComercial: 'Celera' }) },
        endCustomer: {
          create: jest.fn().mockRejectedValue({ code: 'P2002' }),
        },
        auditLog: { create: jest.fn() },
      };
      const controller = new EndCustomersController(prismaMock as any);

      await expect(
        controller.createEndCustomer(
          { clienteId: 'cli-ajeno', codigo: 'DEST-1', nombre: 'Tienda 1' },
          { user: { clienteId: 'cli-1', email: 'portal@celera.mx' } },
        ),
      ).rejects.toMatchObject({ status: HttpStatus.FORBIDDEN });

      await expect(
        controller.createEndCustomer(
          { clienteId: 'cli-1', codigo: 'DEST-1', nombre: 'Tienda 1' },
          { user: { clienteId: 'cli-1', email: 'portal@celera.mx' } },
        ),
      ).rejects.toMatchObject({ status: HttpStatus.CONFLICT });
    });

    it('permite editar, desactivar y reactivar destino registrando AuditLog', async () => {
      const existing = { id: 'ec-1', clienteId: 'cli-1', codigo: 'SUC-1', nombre: 'Sucursal 1', activo: true };
      const prismaMock = {
        endCustomer: {
          findUnique: jest.fn().mockResolvedValue(existing),
          update: jest.fn().mockImplementation(async ({ data }) => ({ ...existing, ...data })),
        },
        auditLog: { create: jest.fn().mockResolvedValue({}) },
      };
      const controller = new EndCustomersController(prismaMock as any);
      const actorReq = { user: { clienteId: null, email: 'gerente@givingout.mx' } };

      const edited = await controller.updateEndCustomer('ec-1', { nombre: 'Sucursal Norte', rfc: 'xaXX010101000' }, actorReq);
      expect(edited.nombre).toBe('Sucursal Norte');
      expect(edited.rfc).toBe('XAXX010101000');

      const deactivated = await controller.deactivateEndCustomer('ec-1', actorReq);
      expect(deactivated.activo).toBe(false);

      const reactivated = await controller.reactivateEndCustomer('ec-1', actorReq);
      expect(reactivated.activo).toBe(true);
      expect(prismaMock.auditLog.create).toHaveBeenCalledTimes(3);
    });
  });

  describe('MasterDataController (Suppliers CRUD)', () => {
    it('lista por estado, crea normalizado, maneja 409 P2002 y ejecuta baja lógica/reactivación', async () => {
      const createdRow = {
        id: 'sup-1',
        codigo: 'PROV-QA-1',
        nombre: 'Proveedor QA',
        direccion: 'Calle 10 #50',
        activo: true,
        _count: { recepciones: 0 },
      };
      const prismaMock = {
        supplier: {
          findMany: jest.fn().mockResolvedValue([createdRow]),
          findUnique: jest.fn().mockResolvedValue(createdRow),
          create: jest.fn().mockResolvedValue(createdRow),
          update: jest.fn().mockImplementation(async ({ data }) => ({ ...createdRow, ...data })),
        },
        auditLog: { create: jest.fn().mockResolvedValue({}) },
      };
      const controller = new MasterDataController(prismaMock as any, {} as any);
      const actorReq = { user: { email: 'admin@givingout.mx' } };

      await controller.getSuppliers('all', 'qa');
      expect(prismaMock.supplier.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.any(Array),
          }),
        }),
      );

      const created = await controller.createSupplier(
        { codigo: '  prov-qa-1 ', nombre: ' Proveedor QA ', direccion: 'Calle 10 #50' },
        actorReq,
      );
      expect(created.codigo).toBe('PROV-QA-1');
      expect(prismaMock.supplier.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ codigo: 'PROV-QA-1', nombre: 'Proveedor QA', direccion: 'Calle 10 #50' }),
        }),
      );

      const deactivated = await controller.deactivateSupplier('sup-1', actorReq);
      expect(deactivated.supplier.activo).toBe(false);

      const reactivated = await controller.reactivateSupplier('sup-1', actorReq);
      expect(reactivated.supplier.activo).toBe(true);

      prismaMock.supplier.create.mockRejectedValueOnce({ code: 'P2002' });
      await expect(
        controller.createSupplier({ codigo: 'PROV-QA-1', nombre: 'Dup' }, actorReq),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('OperationsController — aislamiento de órdenes y candado real de conteos cíclicos', () => {
    it('impide a usuario Portal consultar orden de otro depositante con 403', async () => {
      const prismaMock = {
        salesOrder: {
          findFirst: jest.fn().mockResolvedValue({ id: 'ord-1', clienteId: 'cli-alimentos' }),
        },
      };
      const controller = new OperationsController(prismaMock as any, {} as any);

      await expect(
        controller.getOrderById('ord-1', { user: { clienteId: 'cli-celera' } }),
      ).rejects.toMatchObject({ status: HttpStatus.FORBIDDEN });
    });

    it('rechaza finalizeCycleCount sin autenticación (401) o para operador sin privilegio (403)', async () => {
      const prismaMock = {
        cycleCount: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'cc-1',
            codigo: 'CC-001',
            estado: 'EN_PROGRESO',
            lineas: [],
          }),
        },
      };
      const controller = new OperationsController(prismaMock as any, {} as any);

      await expect(
        controller.finalizeCycleCount('cc-1', {}, undefined, undefined),
      ).rejects.toBeInstanceOf(HttpException);

      await expect(
        controller.finalizeCycleCount(
          'cc-1',
          {},
          undefined,
          { user: { isSuperAdmin: false, rolNivel: 5, rolNombre: 'Operador Recepción', permisosDetalle: ['recepcion:crear'] } },
        ),
      ).rejects.toMatchObject({ status: HttpStatus.FORBIDDEN });
    });
  });
});
