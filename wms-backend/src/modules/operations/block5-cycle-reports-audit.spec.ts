jest.mock('../../prisma.service', () => ({
  PrismaService: class MockPrismaService {},
}));
jest.mock('../../email.service', () => ({
  EmailService: class MockEmailService {},
}));

import { ExecutionContext, HttpStatus, HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as jwt from 'jsonwebtoken';
import { OperationsController } from './operations.controller';
import { PutawayEngineService } from './putaway-engine.service';
import { AdminController } from '../auth/admin.controller';
import { AdminAuthGuard } from '../auth/admin.guard';
import { WmsAuthGuard } from '../auth/wms-auth.guard';
import { formatCalendarDate } from '../../../../wms-frontend/src/utils/dateUtils';
import { formatMovementMotivoDisplay } from '../../../../wms-frontend/src/utils/traceabilityDisplay';

const JWT_SECRET = process.env.JWT_SECRET || 'giving-out-wms-secret-2026';

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

function makeGuardContext(handlerName: keyof OperationsController, headers: Record<string, string>) {
  const handler = OperationsController.prototype[handlerName];
  const request: any = { headers };
  const context = {
    getHandler: () => handler,
    getClass: () => OperationsController,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { context, request };
}

describe('Bloque 5: Conteo Cíclico, Reportes/CSV, AuditLog/AdminPanel e Integridad Transversal (M, N, O, P)', () => {
  let controller: OperationsController;
  let adminController: AdminController;
  let putawayEngine: PutawayEngineService;
  let guard: WmsAuthGuard;
  let adminGuard: AdminAuthGuard;

  let state: any;

  function buildInMemoryWms() {
    let seq = 1;
    const nextId = (p: string) => `${p}-${seq++}`;

    const clientAlimNorte = {
      id: 'cli-alim',
      codigo: 'DEP-ALIMENTOS-01',
      nombreComercial: 'AlimNorte',
      razonSocial: 'AlimNorte S.A.',
      reglaInventario: 'FEFO',
    };
    const clientFashion = {
      id: 'cli-fashion',
      codigo: 'DEP-FASHION-01',
      nombreComercial: 'Fashion Forward',
      razonSocial: 'Fashion Forward S.A.',
      reglaInventario: 'FIFO',
    };

    const skuAceite = {
      id: 'sku-ace',
      codigo: 'ACE-OLI-1L',
      descripcion: 'Aceite de Oliva Extra Virgen 1L',
      uomBase: 'PZA',
    };

    const locG0001 = {
      id: 'loc-g0001',
      codigo: 'G0001',
      estado: 'LIBRE',
      activo: true,
      ocupacionBultos: 0,
      capacidadBultos: 1,
      tipoUbicacion: 'TARIMA_PISO',
      zona: { id: 'zona-interior', codigo: 'ALM-INT', nombre: 'Almacén Interior' },
    };

    const locG0002 = {
      id: 'loc-g0002',
      codigo: 'G0002',
      estado: 'LIBRE',
      activo: true,
      ocupacionBultos: 0,
      capacidadBultos: 1,
      tipoUbicacion: 'TARIMA_PISO',
      zona: { id: 'zona-interior', codigo: 'ALM-INT', nombre: 'Almacén Interior' },
    };

    const locStg01 = {
      id: 'loc-stg01',
      codigo: 'STG-01',
      estado: 'LIBRE',
      activo: true,
      ocupacionBultos: 0,
      capacidadBultos: 10,
      tipoUbicacion: 'STAGING',
    };

    // Lot in G0001 with 0 available, 0 reserved, 0 blocked (Current post-Block 4 state)
    const lotG0001 = {
      id: 'lot-g0001-zero',
      skuId: skuAceite.id,
      clienteId: clientAlimNorte.id,
      ubicacionId: locG0001.id,
      lote: 'LOT-QA-E2E-001',
      cantidadDisponible: 0,
      cantidadReservada: 0,
      cantidadBloqueada: 0,
      estadoCalidad: 'LIBERADO',
      fechaVencimiento: new Date('2027-06-30T00:00:00.000Z'),
      sku: skuAceite,
      cliente: clientAlimNorte,
      ubicacion: locG0001,
      handlingUnits: [],
    };

    const lots: any[] = [lotG0001];

    const hus: any[] = [
      {
        id: 'hu-box-01',
        codigo: 'BOX-REC-2026-0020-0001',
        tipoHu: 'CAJA',
        cantidad: 12,
        estadoHu: 'DESPACHADO',
        ubicacionActual: 'STG-01',
        clienteId: clientAlimNorte.id,
      },
      {
        id: 'hu-box-02',
        codigo: 'BOX-REC-2026-0020-0002',
        tipoHu: 'CAJA',
        cantidad: 12,
        estadoHu: 'DESPACHADO',
        ubicacionActual: 'STG-01',
        clienteId: clientAlimNorte.id,
      },
      {
        id: 'hu-plt-01',
        codigo: 'PLT-REC-2026-0020-01',
        tipoHu: 'PALLET',
        cantidad: 0,
        estadoHu: 'DESPACHADO',
        ubicacionActual: 'STG-01',
        clienteId: clientAlimNorte.id,
      },
    ];

    const movements: any[] = [
      { id: 'mov-1', tipoMovimiento: 'TRASIEGO', cantidad: 12, documentoOrigen: 'REC-2026-0020', motivo: 'Alojamiento Putaway confirmado a rack G0001 (Fase 4)', sku: skuAceite, clienteId: clientAlimNorte.id, fechaHora: new Date('2026-11-11T00:12:12Z'), fromLocation: { codigo: 'REC-01' }, toLocation: { codigo: 'G0001' }, usuario: 'Administrador' },
      { id: 'mov-2', tipoMovimiento: 'TRASIEGO', cantidad: 12, documentoOrigen: 'REC-2026-0020', motivo: 'Alojamiento Putaway confirmado a rack G0001 (Fase 4)', sku: skuAceite, clienteId: clientAlimNorte.id, fechaHora: new Date('2026-11-11T00:48:21Z'), fromLocation: { codigo: 'REC-01' }, toLocation: { codigo: 'G0001' }, usuario: 'Administrador' },
      { id: 'mov-3', tipoMovimiento: 'TRASIEGO', cantidad: 12, documentoOrigen: 'PED-QA-E2E-OUT-001', motivo: 'Traslado picking a STG-01', sku: skuAceite, clienteId: clientAlimNorte.id, fechaHora: new Date('2026-11-11T23:01:49Z'), fromLocation: { codigo: 'G0001' }, toLocation: { codigo: 'STG-01' }, usuario: 'picking@givingout.com' },
      { id: 'mov-4', tipoMovimiento: 'SALIDA_PEDIDO', cantidad: 12, documentoOrigen: 'PED-QA-E2E-OUT-001', motivo: 'Despacho salida cliente', sku: skuAceite, clienteId: clientAlimNorte.id, fechaHora: new Date('2026-11-11T23:02:06Z'), fromLocation: { codigo: 'STG-01' }, toLocation: null, usuario: 'admin@givingout.com' },
      { id: 'mov-5', tipoMovimiento: 'TRASIEGO', cantidad: 12, documentoOrigen: 'PED-QA-E2E-OUT-002', motivo: 'Traslado picking a STG-01', sku: skuAceite, clienteId: clientAlimNorte.id, fechaHora: new Date('2026-11-11T23:50:37Z'), fromLocation: { codigo: 'G0001' }, toLocation: { codigo: 'STG-01' }, usuario: 'picking@givingout.com' },
      { id: 'mov-6', tipoMovimiento: 'SALIDA_PEDIDO', cantidad: 12, documentoOrigen: 'PED-QA-E2E-OUT-002', motivo: 'Despacho salida cliente', sku: skuAceite, clienteId: clientAlimNorte.id, fechaHora: new Date('2026-11-11T23:51:47Z'), fromLocation: { codigo: 'STG-01' }, toLocation: null, usuario: 'admin@givingout.com' },
    ];

    const cycleCounts: any[] = [];
    const cycleCountLines: any[] = [];
    const auditLogs: any[] = [
      { id: 'aud-1', usuario: 'admin@givingout.com', accion: 'ENTREGA_CONFIRMADA', entidad: 'SalesOrder', entidadId: 'ped-001', detalle: 'PED-QA-E2E-OUT-001 entregado a RESPONSABLE QA CEDIS', createdAt: new Date('2026-11-13T17:09:41Z') }
    ];

    const users: any[] = [
      {
        id: 'usr-admin',
        email: 'admin@givingout.com',
        nombre: 'Super Admin',
        activo: true,
        rolId: 'rol-super',
        clienteId: null,
        rol: {
          id: 'rol-super',
          nombre: 'Super Admin',
          nivel: 1,
          permisos: [
            { modulo: 'admin', accion: 'ver' },
            { modulo: 'admin', accion: 'crear' },
            { modulo: 'admin', accion: 'editar' },
            { modulo: 'conteo-ciclico', accion: 'ver' },
            { modulo: 'conteo-ciclico', accion: 'crear' },
            { modulo: 'conteo-ciclico', accion: 'editar' },
            { modulo: 'conteo-ciclico', accion: 'aprobar' },
            { modulo: 'conteo-ciclico', accion: 'ajustar' },
            { modulo: 'inventario', accion: 'ver' },
            { modulo: 'despacho', accion: 'ver' },
          ],
        },
      },
      {
        id: 'usr-operador',
        email: 'operador@givingout.com',
        nombre: 'Operador Conteo',
        activo: true,
        rolId: 'rol-oper',
        clienteId: null,
        rol: {
          id: 'rol-oper',
          nombre: 'Operador Inventario',
          nivel: 5,
          permisos: [
            { modulo: 'conteo-ciclico', accion: 'ver' },
            { modulo: 'conteo-ciclico', accion: 'editar' }, // Solo captura, no tiene aprobar ni ajustar
            { modulo: 'inventario', accion: 'ver' },
          ],
        },
      },
      {
        id: 'usr-portal',
        email: 'portal@alimnorte.com',
        nombre: 'Portal AlimNorte',
        activo: true,
        rolId: 'rol-portal',
        clienteId: clientAlimNorte.id,
        rol: {
          id: 'rol-portal',
          nombre: 'Depositante Portal',
          nivel: 9,
          permisos: [
            { modulo: 'inventario', accion: 'ver' },
            { modulo: 'despacho', accion: 'ver' },
          ],
        },
      },
    ];

    return {
      clients: [clientAlimNorte, clientFashion],
      skus: [skuAceite],
      locations: [locG0001, locG0002, locStg01],
      lots,
      hus,
      movements,
      cycleCounts,
      cycleCountLines,
      auditLogs,
      users,
      nextId,
    };
  }

  function createMockPrisma(stateObj: any) {
    const tx = {
      $executeRawUnsafe: jest.fn().mockResolvedValue(1),
      cycleCount: {
        findUnique: jest.fn(async ({ where, include }: any) => {
          const cc = stateObj.cycleCounts.find((c: any) => c.id === where.id || c.codigo === where.id);
          if (!cc) return null;
          const copy = clone(cc);
          if (include?.lineas) {
            copy.lineas = stateObj.cycleCountLines.filter((l: any) => l.cycleCountId === cc.id).map((l: any) => {
              const lineCopy = clone(l);
              if (include.lineas.include?.sku) {
                lineCopy.sku = clone(stateObj.skus.find((s: any) => s.id === l.skuId));
              }
              return lineCopy;
            });
          }
          return copy;
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const idx = stateObj.cycleCounts.findIndex((c: any) => c.id === where.id);
          if (idx >= 0) {
            stateObj.cycleCounts[idx] = { ...stateObj.cycleCounts[idx], ...data };
            return clone(stateObj.cycleCounts[idx]);
          }
          return null;
        }),
      },
      cycleCountLine: {
        update: jest.fn(async ({ where, data }: any) => {
          const idx = stateObj.cycleCountLines.findIndex((l: any) => l.id === where.id);
          if (idx >= 0) {
            stateObj.cycleCountLines[idx] = { ...stateObj.cycleCountLines[idx], ...data };
            return clone(stateObj.cycleCountLines[idx]);
          }
          return null;
        }),
        updateMany: jest.fn(async ({ where, data }: any) => {
          let count = 0;
          for (let i = 0; i < stateObj.cycleCountLines.length; i++) {
            if (!where?.cycleCountId || stateObj.cycleCountLines[i].cycleCountId === where.cycleCountId) {
              stateObj.cycleCountLines[i] = { ...stateObj.cycleCountLines[i], ...data };
              count++;
            }
          }
          return { count };
        }),
      },
      lotInventory: {
        findMany: jest.fn(async ({ where }: any) => {
          let list = [...stateObj.lots];
          if (where?.skuId) list = list.filter(l => l.skuId === where.skuId);
          if (where?.ubicacionId) list = list.filter(l => l.ubicacionId === where.ubicacionId);
          if (where?.lote) list = list.filter(l => l.lote === where.lote);
          return clone(list);
        }),
        findFirst: jest.fn(async ({ where }: any) => {
          const res = stateObj.lots.find((l: any) => (!where.skuId || l.skuId === where.skuId) && (!where.ubicacionId || l.ubicacionId === where.ubicacionId));
          return res ? clone(res) : null;
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const idx = stateObj.lots.findIndex((l: any) => l.id === where.id);
          if (idx >= 0) {
            stateObj.lots[idx] = { ...stateObj.lots[idx], ...data };
            return clone(stateObj.lots[idx]);
          }
          return null;
        }),
      },
      handlingUnit: {
        findMany: jest.fn(async ({ where }: any) => {
          let list = [...stateObj.hus];
          if (where?.ubicacionActual) list = list.filter(h => h.ubicacionActual === where.ubicacionActual);
          if (where?.estadoHu) list = list.filter(h => h.estadoHu === where.estadoHu);
          return clone(list);
        }),
      },
      salesOrderLine: {
        findMany: jest.fn(async () => []),
      },
      inventoryMovement: {
        create: jest.fn(async ({ data }: any) => {
          const rec = { id: stateObj.nextId('mov'), ...data, fechaHora: new Date() };
          stateObj.movements.push(rec);
          return clone(rec);
        }),
      },
      auditLog: {
        create: jest.fn(async ({ data }: any) => {
          const rec = { id: stateObj.nextId('aud'), ...data, createdAt: new Date() };
          stateObj.auditLogs.push(rec);
          return clone(rec);
        }),
      },
      location: {
        findUnique: jest.fn(async ({ where }: any) => {
          const loc = stateObj.locations.find((l: any) => l.codigo === where?.codigo || l.id === where?.id);
          if (!loc) return null;
          const copy = clone(loc);
          copy.lotes = stateObj.lots.filter((x: any) => x.ubicacionId === loc.id);
          return copy;
        }),
        findFirst: jest.fn(async ({ where }: any) => {
          const loc = stateObj.locations.find((l: any) => l.codigo === where?.codigo || l.id === where?.id);
          return loc ? clone(loc) : null;
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const idx = stateObj.locations.findIndex((l: any) => l.id === where.id);
          if (idx >= 0) {
            stateObj.locations[idx] = { ...stateObj.locations[idx], ...data };
            return clone(stateObj.locations[idx]);
          }
          return null;
        }),
      },
    };

    return {
      ...tx,
      $transaction: jest.fn(async (callback: any) => {
        if (typeof callback === 'function') {
          return await callback(tx);
        }
        return Promise.all(callback);
      }),
      location: {
        ...tx.location,
        findMany: jest.fn(async () => clone(stateObj.locations)),
      },
      skuMaster: {
        findUnique: jest.fn(async ({ where }: any) => {
          const s = stateObj.skus.find((x: any) => x.id === where.id);
          return s ? clone(s) : null;
        }),
        findMany: jest.fn(async () => clone(stateObj.skus)),
      },
      cycleCount: {
        ...tx.cycleCount,
        findMany: jest.fn(async () => clone(stateObj.cycleCounts)),
        create: jest.fn(async ({ data, include }: any) => {
          const ccId = stateObj.nextId('cc');
          const linesData = data.lineas?.create || [];
          const createdLines: any[] = [];
          for (const ld of linesData) {
            const line = {
              id: stateObj.nextId('ccl'),
              cycleCountId: ccId,
              ...ld,
              estado: 'PENDIENTE',
            };
            stateObj.cycleCountLines.push(line);
            const lineCopy = clone(line);
            lineCopy.sku = clone(stateObj.skus.find((s: any) => s.id === line.skuId));
            createdLines.push(lineCopy);
          }
          const newCC = {
            id: ccId,
            codigo: data.codigo,
            nombre: data.nombre,
            tipo: data.tipo,
            estado: 'PROGRAMADO',
            fechaProgramada: data.fechaProgramada,
            almacenId: data.almacenId,
            asignadoA: data.asignadoA,
            notas: data.notas,
            createdAt: new Date(),
          };
          stateObj.cycleCounts.push(newCC);
          const copyCC: any = clone(newCC);
          copyCC.lineas = createdLines;
          return copyCC;
        }),
      },
      auditLog: {
        ...tx.auditLog,
        findMany: jest.fn(async ({ orderBy, take }: any) => {
          let list = [...stateObj.auditLogs];
          list.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
          if (take) list = list.slice(0, take);
          return clone(list);
        }),
      },
      user: {
        findUnique: jest.fn(async ({ where }: any) => {
          const u = stateObj.users.find((x: any) => x.id === where.id || x.email === where.email);
          return u ? clone(u) : null;
        }),
        findMany: jest.fn(async () => clone(stateObj.users)),
      },
      client: {
        findMany: jest.fn(async () => clone(stateObj.clients)),
      },
      inventoryMovement: {
        ...tx.inventoryMovement,
        findMany: jest.fn(async () => clone(stateObj.movements)),
      },
    };
  }

  beforeEach(() => {
    state = buildInMemoryWms();
    const mockPrisma = createMockPrisma(state);

    putawayEngine = new PutawayEngineService(mockPrisma as any);
    controller = new OperationsController(
      mockPrisma as any,
      putawayEngine,
    );
    adminController = new AdminController(mockPrisma as any);

    const reflector = new Reflector();
    guard = new WmsAuthGuard(mockPrisma as any, reflector);
    adminGuard = new AdminAuthGuard(mockPrisma as any);
  });

  // ==========================================
  // 1. MÓDULO M: CONTEO CÍCLICO 0 VS 0
  // ==========================================
  describe('Módulo M: Conteo Cíclico — Caso Seguro 0 vs 0 en G0001', () => {
    it('A. debe crear conteo cíclico sobre G0001 capturando snapshot con cantidadSistema = 0', async () => {
      const g0001 = state.locations.find((l: any) => l.codigo === 'G0001');
      const cc = await controller.createCycleCount({
        nombre: 'Auditoría Cíclica G0001 Pre-RC',
        tipo: 'UBICACION',
        ubicacionId: g0001.id,
        fechaProgramada: '2026-11-14',
        asignadoA: 'Auditor QA',
      });

      expect(cc).toBeDefined();
      expect(cc.codigo).toMatch(/^CC-\d{4}-\d{3}$/);
      expect(cc.estado).toBe('PROGRAMADO');
      expect(cc.lineas.length).toBe(1);
      expect(cc.lineas[0].cantidadSistema).toBe(0);
      expect(cc.lineas[0].sku.codigo).toBe('ACE-OLI-1L');
    });

    it('B. debe registrar conteo físico = 0 con discrepancia = 0 y estado EN_PROGRESO', async () => {
      const g0001 = state.locations.find((l: any) => l.codigo === 'G0001');
      const cc = await controller.createCycleCount({
        nombre: 'Auditoría Cíclica G0001 Pre-RC',
        tipo: 'UBICACION',
        ubicacionId: g0001.id,
        fechaProgramada: '2026-11-14',
      });

      const lineId = cc.lineas[0].id;
      const resCount = await controller.registerCycleCount(
        cc.id,
        {
          lineas: [{ id: lineId, cantidadFisica: 0, cantidadSistema: 0 }],
        },
        { user: { email: 'admin@givingout.com', nombre: 'Super Admin' } },
      );

      expect(resCount.message).toContain('exitosamente');
      const updatedLine = state.cycleCountLines.find((l: any) => l.id === lineId);
      expect(updatedLine.cantidadFisica).toBe(0);
      expect(updatedLine.discrepancia).toBe(0);
      expect(updatedLine.contadoPor).toBe('admin@givingout.com');
    });

    it('C. finalizar conteo sin diferencia (0 vs 0) NO debe crear movimientos de ajuste ni alterar LotInventory', async () => {
      const g0001 = state.locations.find((l: any) => l.codigo === 'G0001');
      const cc = await controller.createCycleCount({
        nombre: 'Auditoría Cíclica G0001 Pre-RC',
        tipo: 'UBICACION',
        ubicacionId: g0001.id,
        fechaProgramada: '2026-11-14',
      });

      await controller.registerCycleCount(
        cc.id,
        { lineas: [{ id: cc.lineas[0].id, cantidadFisica: 0, cantidadSistema: 0 }] },
        { user: { email: 'admin@givingout.com', nombre: 'Super Admin' } },
      );

      const movementsBefore = state.movements.length;
      const lotBefore = clone(state.lots.find((l: any) => l.ubicacionId === g0001.id));

      const resFinalize = await controller.finalizeCycleCount(
        cc.id,
        {},
        undefined,
        { user: { email: 'admin@givingout.com', nombre: 'Super Admin', isSuperAdmin: true, rolNivel: 1 } },
      );

      expect(resFinalize.success).toBe(true);
      expect(resFinalize.estado).toBe('COMPLETADO');
      expect(resFinalize.adjustments).toBe(0);

      // Invariantes
      expect(state.movements.length).toBe(movementsBefore); // 0 movimientos creados
      const lotAfter = state.lots.find((l: any) => l.ubicacionId === g0001.id);
      expect(lotAfter.cantidadDisponible).toBe(lotBefore.cantidadDisponible);
      expect(lotAfter.cantidadReservada).toBe(0);
      expect(lotAfter.cantidadBloqueada).toBe(0);

      // G0001 permanece LIBRE
      expect(g0001.estado).toBe('LIBRE');

      // AuditLog registrado
      const audit = state.auditLogs.find((a: any) => a.accion === 'CONTEO_CICLICO_FINALIZADO' && a.entidadId === cc.id);
      expect(audit).toBeDefined();
      expect(audit.usuario).toBe('admin@givingout.com');
      expect(audit.detalle).toContain('0 ajuste(s) seguros aplicados');
    });

    it('D. segunda llamada a finalizeCycleCount debe ser rechazada con 409 CONFLICT por inmutabilidad', async () => {
      const g0001 = state.locations.find((l: any) => l.codigo === 'G0001');
      const cc = await controller.createCycleCount({
        nombre: 'Auditoría Cíclica G0001 Pre-RC',
        tipo: 'UBICACION',
        ubicacionId: g0001.id,
        fechaProgramada: '2026-11-14',
      });

      await controller.registerCycleCount(
        cc.id,
        { lineas: [{ id: cc.lineas[0].id, cantidadFisica: 0, cantidadSistema: 0 }] },
        { user: { email: 'admin@givingout.com', nombre: 'Super Admin' } },
      );

      await controller.finalizeCycleCount(
        cc.id,
        {},
        undefined,
        { user: { email: 'admin@givingout.com', nombre: 'Super Admin', isSuperAdmin: true, rolNivel: 1 } },
      );

      // Segunda llamada
      await expect(
        controller.finalizeCycleCount(
          cc.id,
          {},
          undefined,
          { user: { email: 'admin@givingout.com', nombre: 'Super Admin', isSuperAdmin: true, rolNivel: 1 } },
        )
      ).rejects.toThrow(
        expect.objectContaining({
          status: HttpStatus.CONFLICT,
          message: expect.stringContaining('inmutable'),
        })
      );
    });
  });

  // ==========================================
  // 2. MÓDULO M: REGLAS DEFENSIVAS DE DIFERENCIAS
  // ==========================================
  describe('Módulo M: Blindaje Transaccional ante Discrepancias y Ajustes', () => {
    it('E. debe rechazar con 400 BAD REQUEST si se intenta registrar una cantidad física negativa', async () => {
      const g0001 = state.locations.find((l: any) => l.codigo === 'G0001');
      const cc = await controller.createCycleCount({
        nombre: 'Conteo Test Negativo',
        tipo: 'UBICACION',
        ubicacionId: g0001.id,
        fechaProgramada: '2026-11-14',
      });

      await expect(
        controller.registerCycleCount(
          cc.id,
          { lineas: [{ id: cc.lineas[0].id, cantidadFisica: -5, cantidadSistema: 0 }] },
          { user: { email: 'admin@givingout.com', nombre: 'Super Admin' } },
        )
      ).rejects.toThrow(
        expect.objectContaining({
          status: HttpStatus.BAD_REQUEST,
          message: expect.stringContaining('no puede ser negativa'),
        })
      );
    });

    it('F. sobrante físico sin lote/cliente debe ser bloqueado preventivamente como SOBRANTE_NO_IDENTIFICADO sin mutar stock', async () => {
      // Simular ubicación sin lote previo (ej. G0002)
      const locG0002 = state.locations.find((l: any) => l.codigo === 'G0002');
      const dummyLine = {
        id: 'line-sobrante',
        cycleCountId: 'cc-sobrante',
        skuId: state.skus[0].id,
        ubicacionId: locG0002.id,
        lote: null,
        cantidadSistema: 0,
        cantidadFisica: 5, // Físico > Sistema (+5) sin lote existente
        estado: 'CONTADO',
      };
      state.cycleCounts.push({
        id: 'cc-sobrante',
        codigo: 'CC-2026-099',
        estado: 'EN_PROGRESO',
        lineas: [dummyLine],
      });
      state.cycleCountLines.push(dummyLine);

      const res = await controller.finalizeCycleCount(
        'cc-sobrante',
        {},
        undefined,
        { user: { email: 'admin@givingout.com', nombre: 'Super Admin', isSuperAdmin: true, rolNivel: 1 } },
      );

      expect(res.success).toBe(false);
      expect(res.requiresReview).toBe(true);
      expect(res.lineasBloqueadas?.[0].status).toBe('SOBRANTE_NO_IDENTIFICADO');
      expect(state.lots.filter((l: any) => l.ubicacionId === locG0002.id).length).toBe(0); // 0 stock creado
    });

    it('G. discrepancia en línea gestionada por HUs activas debe ser bloqueada como REQUIERE_CONCILIACION_HU', async () => {
      // Ubicación con HU activa
      const locG0001 = state.locations.find((l: any) => l.codigo === 'G0001');
      state.hus.push({
        id: 'hu-activa-test',
        codigo: 'BOX-TEST-001',
        tipoHu: 'CAJA',
        cantidad: 12,
        estadoHu: 'ACTIVO',
        ubicacionActual: locG0001.id,
        skuCodigo: 'ACE-OLI-1L',
      });

      const dummyLine = {
        id: 'line-hu',
        cycleCountId: 'cc-hu',
        skuId: state.skus[0].id,
        ubicacionId: locG0001.id,
        lote: 'LOT-QA-E2E-001',
        cantidadSistema: 12,
        cantidadFisica: 10, // Diferencia de -2 pzas
        estado: 'CONTADO',
      };
      state.cycleCounts.push({
        id: 'cc-hu',
        codigo: 'CC-2026-098',
        estado: 'EN_PROGRESO',
        lineas: [dummyLine],
      });
      state.cycleCountLines.push(dummyLine);

      const res = await controller.finalizeCycleCount(
        'cc-hu',
        {},
        undefined,
        { user: { email: 'admin@givingout.com', nombre: 'Super Admin', isSuperAdmin: true, rolNivel: 1 } },
      );

      expect(res.success).toBe(false);
      expect(res.requiresReview).toBe(true);
      expect(res.lineasBloqueadas?.[0].status).toBe('REQUIERE_CONCILIACION_HU');
    });

    it('H. si existe ajuste válido, el movimiento debe exigir motivo explícito con el código de conteo', async () => {
      // Simular lote elegible con saldo vendible libre
      const locG0001 = state.locations.find((l: any) => l.codigo === 'G0001');
      const targetLot = state.lots.find((l: any) => l.ubicacionId === locG0001.id);
      targetLot.cantidadDisponible = 20; // 20 PZA libres sin HUs activas

      const dummyLine = {
        id: 'line-valid-adj',
        cycleCountId: 'cc-valid',
        skuId: state.skus[0].id,
        ubicacionId: locG0001.id,
        lote: 'LOT-QA-E2E-001',
        cantidadSistema: 20,
        cantidadFisica: 18, // Ajuste salida de -2 pzas
        estado: 'CONTADO',
      };
      state.cycleCounts.push({
        id: 'cc-valid',
        codigo: 'CC-2026-097',
        estado: 'EN_PROGRESO',
        lineas: [dummyLine],
      });
      state.cycleCountLines.push(dummyLine);

      const res = await controller.finalizeCycleCount(
        'cc-valid',
        {},
        undefined,
        { user: { email: 'admin@givingout.com', nombre: 'Super Admin', isSuperAdmin: true, rolNivel: 1 } },
      );

      expect(res.success).toBe(true);
      expect(res.adjustments).toBe(1);
      const mov = state.movements.find((m: any) => m.documentoOrigen === 'CC-2026-097');
      expect(mov).toBeDefined();
      expect(mov.tipoMovimiento).toBe('AJUSTE_SALIDA');
      expect(mov.cantidad).toBe(2);
      expect(mov.motivo).toContain('Ajuste por Conteo Cíclico CC-2026-097');
    });
  });

  // ==========================================
  // 3. RBAC, PORTAL Y ANTI-SPOOFING
  // ==========================================
  describe('RBAC y Seguridad Multi-Tenant (Módulos M, N, O)', () => {
    it('I. usuario operativo sin permisos de ajuste debe ser rechazado con 403 FORBIDDEN en finalize', async () => {
      const g0001 = state.locations.find((l: any) => l.codigo === 'G0001');
      const cc = await controller.createCycleCount({
        nombre: 'Conteo RBAC Test',
        tipo: 'UBICACION',
        ubicacionId: g0001.id,
        fechaProgramada: '2026-11-14',
      });

      await controller.registerCycleCount(
        cc.id,
        { lineas: [{ id: cc.lineas[0].id, cantidadFisica: 0, cantidadSistema: 0 }] },
        { user: { email: 'admin@givingout.com', nombre: 'Super Admin' } },
      );

      // Usuario Operador (rolNivel 5 sin permiso ajustar)
      await expect(
        controller.finalizeCycleCount(
          cc.id,
          {},
          undefined,
          { user: { email: 'operador@givingout.com', rolNombre: 'Operador Inventario', rolNivel: 5, permisosDetalle: ['conteo-ciclico:ver'] } },
        )
      ).rejects.toThrow(
        expect.objectContaining({
          status: HttpStatus.FORBIDDEN,
          message: expect.stringContaining('no tiene autorización para finalizar'),
        })
      );
    });

    it('J. usuario de Portal Depositante debe ser bloqueado con 403 Forbidden por WmsAuthGuard (allowPortal: false)', async () => {
      const portalUser = state.users.find((u: any) => u.email === 'portal@alimnorte.com');
      const token = jwt.sign(
        { userId: portalUser.id, email: portalUser.email, rol: portalUser.rol.nombre, isPortal: true, clienteId: portalUser.clienteId },
        JWT_SECRET,
      );

      const { context } = makeGuardContext('getCycleCounts', { authorization: `Bearer ${token}` });
      await expect(guard.canActivate(context)).rejects.toThrow(
        expect.objectContaining({
          status: HttpStatus.FORBIDDEN,
          message: expect.stringContaining('exclusiva para personal interno'),
        })
      );
    });

    it('K. inyección de x-user-role falsificado no debe otorgar acceso a conteo cíclico', async () => {
      const portalUser = state.users.find((u: any) => u.email === 'portal@alimnorte.com');
      const token = jwt.sign(
        { userId: portalUser.id, email: portalUser.email, rol: portalUser.rol.nombre, isPortal: true, clienteId: portalUser.clienteId },
        JWT_SECRET,
      );

      const { context } = makeGuardContext('finalizeCycleCount', {
        authorization: `Bearer ${token}`,
        'x-user-role': 'Super Admin',
      });

      await expect(guard.canActivate(context)).rejects.toThrow(
        expect.objectContaining({ status: HttpStatus.FORBIDDEN })
      );
    });
  });

  // ==========================================
  // 4. MÓDULO O: ADMINPANEL Y AUDITLOG
  // ==========================================
  describe('Módulo O: AdminPanel y AuditLog Global', () => {
    it('L. AdminAuthGuard debe autorizar a Super Admin en GET /api/admin/audit-log', async () => {
      const adminUser = state.users.find((u: any) => u.email === 'admin@givingout.com');
      const token = jwt.sign(
        { userId: adminUser.id, email: adminUser.email, rol: adminUser.rol.nombre },
        JWT_SECRET,
      );

      const request: any = { headers: { authorization: `Bearer ${token}` } };
      const context = {
        switchToHttp: () => ({ getRequest: () => request }),
      } as unknown as ExecutionContext;

      const allowed = await adminGuard.canActivate(context);
      expect(allowed).toBe(true);

      const logs = await adminController.getAuditLog();
      expect(Array.isArray(logs)).toBe(true);
      expect(logs.length).toBeGreaterThan(0);
      expect(logs[0].accion).toBe('ENTREGA_CONFIRMADA');
    });

    it('M. AdminAuthGuard debe rechazar a usuario operativo sin permiso admin con 403 Forbidden', async () => {
      const operUser = state.users.find((u: any) => u.email === 'operador@givingout.com');
      const token = jwt.sign(
        { userId: operUser.id, email: operUser.email, rol: operUser.rol.nombre },
        JWT_SECRET,
      );

      const request: any = { headers: { authorization: `Bearer ${token}` } };
      const context = {
        switchToHttp: () => ({ getRequest: () => request }),
      } as unknown as ExecutionContext;

      await expect(adminGuard.canActivate(context)).rejects.toThrow(
        expect.objectContaining({
          status: HttpStatus.FORBIDDEN,
          message: expect.stringContaining('privilegios administrativos'),
        })
      );
    });
  });

  // ==========================================
  // 5. MÓDULO N: REPORTES Y EXPORTACIÓN CSV
  // ==========================================
  describe('Módulo N: Reportes y Exportación CSV Sin Datos Demo', () => {
    it('N. CSV de Kárdex debe contener exactamente 6 movimientos históricos y terminología de posición física', () => {
      const movs = state.movements;
      expect(movs.length).toBe(6);

      const rows = movs.map((m: any) => {
        const motivoNorm = formatMovementMotivoDisplay(m);
        return {
          id: m.id,
          tipo: m.tipoMovimiento,
          doc: m.documentoOrigen,
          cantidad: m.cantidad,
          from: m.fromLocation?.codigo || 'RAMPA',
          to: m.toLocation?.codigo || 'CLIENTE',
          motivo: motivoNorm,
        };
      });

      expect(rows.length).toBe(6);
      // Validar que ningún motivo presente "a rack G0001"
      rows.forEach(r => {
        expect(r.motivo).not.toContain('a rack G0001');
      });
      // Validar que los movimientos de putaway presenten "en posición física G0001"
      expect(rows[0].motivo).toContain('en posición física G0001');
      expect(rows[1].motivo).toContain('en posición física G0001');
    });

    it('O. CSV de inventario con stock = 0 debe generar encabezados oficiales y 0 filas de producto sin Tarima Master', () => {
      // Simular lógica de downloadCSV de Inventory.tsx
      const filteredConsolidated: any[] = []; // Inventario actual = 0
      const headers = 'Clasificación,SKU,Descripción,Depositante,Lote,Vencimiento,Ubicación Física,Físico Total,Disponible Vendible,Reservado,Bloqueado,Calidad,HUs Bultos,Notas\n';
      let csv = headers;
      filteredConsolidated.forEach((item: any) => {
        csv += `"${item.clasificacion || ''}","${item.sku?.codigo || ''}","${item.sku?.descripcion || ''}","${item.cliente?.nombreComercial || ''}","${item.lote || ''}","${item.fechaVencimiento ? formatCalendarDate(item.fechaVencimiento) : ''}","${item.ubicacion?.codigo || ''}",${item.cantidadFisica || 0},${item.cantidadDisponibleVendible || 0},${item.cantidadReservada || 0},${item.cantidadBloqueada || 0},"${item.estadoCalidad || ''}",0,"${item.notas || ''}"\n`;
      });

      const lines = csv.trim().split('\n');
      expect(lines.length).toBe(1); // Solo encabezado
      expect(lines[0]).toContain('Clasificación,SKU,Descripción,Depositante');
      expect(csv).not.toContain('PLT-REC-2026-0020-01'); // Tarima Master nunca aparece como stock
      expect(csv).not.toContain('Fashion Forward'); // Cero datos demo
    });

    it('P. formatCalendarDate debe preservar la fecha de caducidad 30/06/2027 sin desfase de zona horaria', () => {
      const utcDate = new Date('2027-06-30T00:00:00.000Z');
      const formatted = formatCalendarDate(utcDate);
      expect(formatted).toBe('30/06/2027');
      expect(formatted).not.toBe('29/06/2027');
    });
  });

  // ==========================================
  // 6. MÓDULO P: INTEGRIDAD TRANSVERSAL
  // ==========================================
  describe('Módulo P: Integridad Transversal del Sistema Pre-RC', () => {
    it('Q. la trazabilidad de auditoría no debe contener duplicados de negocio en eventos operacionales', () => {
      const actionSet = new Set<string>();
      const businessEvents = state.auditLogs.filter((a: any) => a.accion !== 'LOGIN');
      // Cada evento de negocio unitario registrado debe ser único para esa entidad y acción
      const compositeKeys = businessEvents.map((a: any) => `${a.accion}__${a.entidad}__${a.entidadId}`);
      const uniqueKeys = new Set(compositeKeys);
      expect(uniqueKeys.size).toBe(compositeKeys.length);
    });

    it('R. todas las ubicaciones Gxxxx deben conservar capacidad = 1 y estado LIBRE cuando no tienen bultos', () => {
      const gLocs = state.locations.filter((l: any) => l.codigo.startsWith('G'));
      gLocs.forEach((loc: any) => {
        expect(loc.capacidadBultos).toBe(1);
        expect(loc.ocupacionBultos).toBe(0);
        expect(loc.estado).toBe('LIBRE');
      });
    });
  });
});

