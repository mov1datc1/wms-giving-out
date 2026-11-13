jest.mock('../../prisma.service', () => ({
  PrismaService: class MockPrismaService {},
}));
jest.mock('../../email.service', () => ({
  EmailService: class MockEmailService {},
}));

import { ExecutionContext, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as jwt from 'jsonwebtoken';
import { OperationsController } from './operations.controller';
import { PutawayEngineService } from './putaway-engine.service';
import { WmsAuthGuard } from '../auth/wms-auth.guard';
import { formatCalendarDate } from '../../../../wms-frontend/src/utils/dateUtils';

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

describe('Bloque 4: Confirmación de Entrega E2E (Módulos J y P)', () => {
  let controller: OperationsController;
  let putawayEngine: PutawayEngineService;
  let guard: WmsAuthGuard;

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

    const endCustomerWalmart = {
      id: 'ec-walmart',
      codigo: 'WALMART-ALIMENTOS-01',
      nombre: 'Walmart México (CEDIS San Martín)',
      clienteId: clientAlimNorte.id,
      activo: true,
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
    };
    const locStg01 = {
      id: 'loc-stg01',
      codigo: 'STG-01',
      estado: 'LIBRE',
      activo: true,
      ocupacionBultos: 0,
      capacidadBultos: 10,
    };

    const lots: any[] = [];
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
      { id: 'mov-1', tipoMovimiento: 'TRASIEGO', cantidad: 12, documentoOrigen: 'REC-2026-0020' },
      { id: 'mov-2', tipoMovimiento: 'TRASIEGO', cantidad: 12, documentoOrigen: 'REC-2026-0020' },
      { id: 'mov-3', tipoMovimiento: 'TRASIEGO', cantidad: 12, documentoOrigen: 'PED-QA-E2E-OUT-001' },
      { id: 'mov-4', tipoMovimiento: 'SALIDA_PEDIDO', cantidad: 12, documentoOrigen: 'PED-QA-E2E-OUT-001' },
      { id: 'mov-5', tipoMovimiento: 'TRASIEGO', cantidad: 12, documentoOrigen: 'PED-QA-E2E-OUT-002' },
      { id: 'mov-6', tipoMovimiento: 'SALIDA_PEDIDO', cantidad: 12, documentoOrigen: 'PED-QA-E2E-OUT-002' },
    ];

    const order001 = {
      id: 'order-001-id',
      codigo: 'PED-QA-E2E-OUT-001',
      clienteId: clientAlimNorte.id,
      endCustomerId: endCustomerWalmart.id,
      cliente: clientAlimNorte,
      endCustomer: endCustomerWalmart,
      estado: 'DESPACHADO',
      estadoEntrega: 'EN_RUTA',
      fechaDespacho: new Date('2026-11-11T23:02:04.911Z'),
      fechaEntrega: null,
      nombreReceptor: null,
      notasEntrega: null,
      firmaReceptor: null,
      folioManifiesto: 'MAN-PED-QA-E2E-OUT-001',
      despachador: 'admin@givingout.com',
      vehiculoPlaca: 'NLX-4821',
      lineas: [
        {
          id: 'line-001',
          skuId: skuAceite.id,
          sku: skuAceite,
          cantidadSolicitada: 12,
          cantidadPickeada: 12,
          cajaEscaneada: 'BOX-REC-2026-0020-0001',
          ubicacionAsignada: 'G0001',
        },
      ],
      trackingEvents: [
        {
          id: 'track-001-dispatch',
          orderId: 'order-001-id',
          estado: 'SALIDA_ALMACEN',
          usuario: 'admin@givingout.com',
          notas: 'Salida parcial controlada Bloque 3A',
          createdAt: new Date('2026-11-11T23:02:04.911Z'),
        },
      ],
    };

    const order002 = {
      id: 'order-002-id',
      codigo: 'PED-QA-E2E-OUT-002',
      clienteId: clientAlimNorte.id,
      endCustomerId: endCustomerWalmart.id,
      cliente: clientAlimNorte,
      endCustomer: endCustomerWalmart,
      estado: 'DESPACHADO',
      estadoEntrega: 'EN_RUTA',
      fechaDespacho: new Date('2026-11-11T23:51:46.973Z'),
      fechaEntrega: null,
      nombreReceptor: null,
      notasEntrega: null,
      firmaReceptor: null,
      folioManifiesto: 'MAN-PED-QA-E2E-OUT-002',
      despachador: 'admin@givingout.com',
      vehiculoPlaca: 'NLY-7734',
      lineas: [
        {
          id: 'line-002',
          skuId: skuAceite.id,
          sku: skuAceite,
          cantidadSolicitada: 12,
          cantidadPickeada: 12,
          cajaEscaneada: 'BOX-REC-2026-0020-0002',
          ubicacionAsignada: 'G0001',
        },
      ],
      trackingEvents: [
        {
          id: 'track-002-dispatch',
          orderId: 'order-002-id',
          estado: 'SALIDA_ALMACEN',
          usuario: 'admin@givingout.com',
          notas: 'Salida final controlada Bloque 3B',
          createdAt: new Date('2026-11-11T23:51:46.973Z'),
        },
      ],
    };

    const auditLogs: any[] = [];
    const dispatchTrackings: any[] = [...order001.trackingEvents, ...order002.trackingEvents];

    return {
      clients: [clientAlimNorte, clientFashion],
      endCustomers: [endCustomerWalmart],
      skus: [skuAceite],
      locations: [locG0001, locStg01],
      lots,
      hus,
      movements,
      orders: [order001, order002],
      auditLogs,
      dispatchTrackings,
      nextId,
    };
  }

  function createMockPrisma(stateObj: any) {
    const tx = {
      $executeRawUnsafe: jest.fn().mockResolvedValue(1),
      salesOrder: {
        findUnique: jest.fn(async ({ where }: any) => {
          const ord = stateObj.orders.find((o: any) => o.id === where.id || o.codigo === where.id || o.codigo === where.codigo);
          return ord ? clone(ord) : null;
        }),
        findFirst: jest.fn(async ({ where }: any) => {
          let found: any = null;
          if (where.OR) {
            for (const cond of where.OR) {
              found = stateObj.orders.find((o: any) => (cond.id && o.id === cond.id) || (cond.codigo && o.codigo === cond.codigo));
              if (found) break;
            }
          } else if (where.id) {
            found = stateObj.orders.find((o: any) => o.id === where.id);
          } else if (where.codigo) {
            found = stateObj.orders.find((o: any) => o.codigo === where.codigo);
          }
          return found ? clone(found) : null;
        }),
        findMany: jest.fn(async ({ where }: any) => {
          let list = [...stateObj.orders];
          if (where?.clienteId) {
            list = list.filter((o) => o.clienteId === where.clienteId);
          }
          if (where?.estado) {
            if (typeof where.estado === 'object' && where.estado.in) {
              list = list.filter((o) => where.estado.in.includes(o.estado));
            } else {
              list = list.filter((o) => o.estado === where.estado);
            }
          }
          return clone(list);
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const ord = stateObj.orders.find((o: any) => o.id === where.id);
          if (!ord) throw new Error('Order not found');
          Object.assign(ord, data);
          return clone(ord);
        }),
      },
      dispatchTracking: {
        findFirst: jest.fn(async ({ where }: any) => {
          const trk = stateObj.dispatchTrackings.find((t: any) => t.orderId === where.orderId);
          return trk ? clone(trk) : null;
        }),
        create: jest.fn(async ({ data }: any) => {
          const trk = { id: stateObj.nextId('trk'), ...data, createdAt: new Date() };
          stateObj.dispatchTrackings.push(trk);
          return clone(trk);
        }),
      },
      auditLog: {
        create: jest.fn(async ({ data }: any) => {
          const log = { id: stateObj.nextId('aud'), ...data, createdAt: new Date() };
          stateObj.auditLogs.push(log);
          return clone(log);
        }),
      },
    };

    return {
      $transaction: jest.fn(async (callback: any) => {
        return await callback(tx);
      }),
      salesOrder: tx.salesOrder,
      dispatchTracking: tx.dispatchTracking,
      auditLog: tx.auditLog,
      lotInventory: {
        findMany: jest.fn(async () => clone(stateObj.lots)),
      },
      handlingUnit: {
        findMany: jest.fn(async () => clone(stateObj.hus)),
      },
      inventoryMovement: {
        findMany: jest.fn(async () => clone(stateObj.movements)),
      },
      location: {
        findMany: jest.fn(async () => clone(stateObj.locations)),
      },
    };
  }

  function makeStaffUser(role: string, email: string, permissions: Array<{ modulo: string; accion: string }>) {
    return {
      id: `usr-${role.toLowerCase().replace(/\s+/g, '-')}`,
      email,
      nombre: `Usuario ${role}`,
      activo: true,
      clienteId: null,
      rol: {
        nombre: role,
        permisos: permissions.map((p) => ({
          modulo: { codigo: p.modulo },
          accion: { codigo: p.accion },
        })),
      },
    };
  }

  beforeEach(() => {
    state = buildInMemoryWms();
    const mockPrisma = createMockPrisma(state);
    putawayEngine = new PutawayEngineService(mockPrisma as any);
    controller = new OperationsController(mockPrisma as any, putawayEngine);
    guard = new WmsAuthGuard(mockPrisma as any, new Reflector());
  });

  // A. entregar DESPACHADO/EN_RUTA -> PASS
  it('A. debe confirmar entrega exitosamente cuando la orden está en DESPACHADO y EN_RUTA', async () => {
    const req = { user: { email: 'admin@givingout.com', nombre: 'Administrador' } };
    const res = await controller.confirmDelivery(
      'order-001-id',
      {
        nombreReceptor: 'RESPONSABLE QA CEDIS',
        notasEntrega: 'Entrega E2E controlada PED-QA-E2E-OUT-001',
      },
      req,
    );

    expect(res.success).toBe(true);
    expect(res.alreadyDelivered).toBe(false);
    expect(res.order.estado).toBe('ENTREGADO');
    expect(res.order.estadoEntrega).toBe('ENTREGADO');
    expect(res.order.nombreReceptor).toBe('RESPONSABLE QA CEDIS');
    expect(res.order.notasEntrega).toBe('Entrega E2E controlada PED-QA-E2E-OUT-001');
    expect(res.order.fechaEntrega).not.toBeNull();
    expect(new Date(res.order.fechaEntrega!).getTime()).toBeGreaterThan(0);
  });

  // B. entregar SOLICITADO -> 409
  it('B. debe rechazar con 409 CONFLICT si se intenta entregar una orden en estado SOLICITADO', async () => {
    state.orders[0].estado = 'SOLICITADO';
    state.orders[0].estadoEntrega = null;

    const req = { user: { email: 'admin@givingout.com' } };
    await expect(
      controller.confirmDelivery(
        'order-001-id',
        { nombreReceptor: 'RESPONSABLE QA CEDIS' },
        req,
      ),
    ).rejects.toMatchObject({
      status: HttpStatus.CONFLICT,
      response: expect.objectContaining({ error: 'ESTADO_NO_APTO_PARA_ENTREGA' }),
    });
  });

  // C. entregar EN_PICKING -> 409
  it('C. debe rechazar con 409 CONFLICT si se intenta entregar una orden en estado EN_PICKING', async () => {
    state.orders[0].estado = 'EN_PICKING';
    state.orders[0].estadoEntrega = null;

    const req = { user: { email: 'admin@givingout.com' } };
    await expect(
      controller.confirmDelivery(
        'order-001-id',
        { nombreReceptor: 'RESPONSABLE QA CEDIS' },
        req,
      ),
    ).rejects.toMatchObject({
      status: HttpStatus.CONFLICT,
      response: expect.objectContaining({ error: 'ESTADO_NO_APTO_PARA_ENTREGA' }),
    });
  });

  // D. doble entrega -> idempotente
  it('D. segunda llamada a confirmDelivery debe ser idempotente sin error ni mutaciones duplicadas', async () => {
    const req = { user: { email: 'admin@givingout.com' } };

    // Primera entrega
    const res1 = await controller.confirmDelivery(
      'order-001-id',
      { nombreReceptor: 'RESPONSABLE QA CEDIS' },
      req,
    );
    expect(res1.success).toBe(true);
    expect(res1.alreadyDelivered).toBe(false);

    const trackCountBefore = state.dispatchTrackings.length;
    const auditCountBefore = state.auditLogs.length;

    // Segunda entrega (idempotente)
    const res2 = await controller.confirmDelivery(
      'order-001-id',
      { nombreReceptor: 'OTRO RECEPTOR FALSO' },
      req,
    );
    expect(res2.success).toBe(true);
    expect(res2.idempotent).toBe(true);
    expect(res2.alreadyDelivered).toBe(true);
    expect(state.dispatchTrackings.length).toBe(trackCountBefore);
    expect(state.auditLogs.length).toBe(auditCountBefore);
  });

  // E. segunda entrega no cambia fecha original
  it('E. segunda llamada idempotente no debe modificar la fechaEntrega original ni el nombreReceptor original', async () => {
    const req = { user: { email: 'admin@givingout.com' } };

    await controller.confirmDelivery(
      'order-001-id',
      { nombreReceptor: 'RESPONSABLE QA CEDIS' },
      req,
    );
    const originalDate = state.orders[0].fechaEntrega;
    const originalReceptor = state.orders[0].nombreReceptor;

    // Reintentar con otro receptor
    await controller.confirmDelivery(
      'order-001-id',
      { nombreReceptor: 'RECEPTOR POSTERIOR' },
      req,
    );

    expect(state.orders[0].fechaEntrega).toBe(originalDate);
    expect(state.orders[0].nombreReceptor).toBe(originalReceptor);
    expect(state.orders[0].nombreReceptor).toBe('RESPONSABLE QA CEDIS');
  });

  // F. no crea InventoryMovement
  it('F. confirmar entrega NO debe registrar ningún movimiento en InventoryMovement', async () => {
    const movCountBefore = state.movements.length;
    expect(movCountBefore).toBe(6);

    const req = { user: { email: 'admin@givingout.com' } };
    await controller.confirmDelivery(
      'order-001-id',
      { nombreReceptor: 'RESPONSABLE QA CEDIS' },
      req,
    );

    expect(state.movements.length).toBe(6);
  });

  // G. no modifica LotInventory
  it('G. confirmar entrega NO debe modificar los registros ni saldos de LotInventory', async () => {
    const lotsSnapshot = clone(state.lots);

    const req = { user: { email: 'admin@givingout.com' } };
    await controller.confirmDelivery(
      'order-001-id',
      { nombreReceptor: 'RESPONSABLE QA CEDIS' },
      req,
    );

    expect(state.lots).toEqual(lotsSnapshot);
  });

  // H. no modifica HUs
  it('H. confirmar entrega NO debe alterar los estados ni cantidades de HandlingUnits', async () => {
    const husSnapshot = clone(state.hus);

    const req = { user: { email: 'admin@givingout.com' } };
    await controller.confirmDelivery(
      'order-001-id',
      { nombreReceptor: 'RESPONSABLE QA CEDIS' },
      req,
    );

    expect(state.hus).toEqual(husSnapshot);
  });

  // I. no modifica Location
  it('I. confirmar entrega NO debe modificar los estados ni ocupaciones de Locations', async () => {
    const locsSnapshot = clone(state.locations);

    const req = { user: { email: 'admin@givingout.com' } };
    await controller.confirmDelivery(
      'order-001-id',
      { nombreReceptor: 'RESPONSABLE QA CEDIS' },
      req,
    );

    expect(state.locations).toEqual(locsSnapshot);
  });

  // J. AuditLog único
  it('J. debe generar exactamente UN registro en AuditLog con acción ENTREGA_CONFIRMADA', async () => {
    const req = { user: { email: 'admin@givingout.com' } };
    await controller.confirmDelivery(
      'order-001-id',
      { nombreReceptor: 'RESPONSABLE QA CEDIS' },
      req,
    );

    const deliveryAudits = state.auditLogs.filter((a: any) => a.accion === 'ENTREGA_CONFIRMADA');
    expect(deliveryAudits.length).toBe(1);
    expect(deliveryAudits[0].usuario).toBe('admin@givingout.com');
    expect(deliveryAudits[0].entidad).toBe('SalesOrder');
    expect(deliveryAudits[0].entidadId).toBe('order-001-id');
  });

  // K. actor req.user
  it('K. el actor operativo debe provenir estrictamente de req.user ignorando cualquier body.usuario inyectado', async () => {
    const req = { user: { email: 'despacho_real@givingout.com' } };
    await controller.confirmDelivery(
      'order-001-id',
      {
        nombreReceptor: 'RESPONSABLE QA CEDIS',
        usuario: 'hacker_spoofed@evil.com',
      },
      req,
    );

    const latestTracking = state.dispatchTrackings.find((t: any) => t.estado === 'ENTREGADO');
    expect(latestTracking.usuario).toBe('despacho_real@givingout.com');
    expect(latestTracking.nombreFirmante).toBe('RESPONSABLE QA CEDIS');

    const latestAudit = state.auditLogs.find((a: any) => a.accion === 'ENTREGA_CONFIRMADA');
    expect(latestAudit.usuario).toBe('despacho_real@givingout.com');
  });

  // L. Operador Picking -> 403
  it('L. Operador Picking debe ser rechazado con 403 Forbidden por falta de permisos en despacho:editar/aprobar', async () => {
    const userPicking = makeStaffUser('Operador Picking', 'picking@givingout.com', [
      { modulo: 'picking', accion: 'ver' },
      { modulo: 'picking', accion: 'crear' },
      { modulo: 'picking', accion: 'editar' },
      { modulo: 'despacho', accion: 'ver' },
      { modulo: 'despacho', accion: 'crear' },
    ]);

    const token = jwt.sign(
      { userId: userPicking.id, email: userPicking.email, rol: userPicking.rol.nombre },
      JWT_SECRET,
    );

    const mockPrisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(userPicking),
      },
    };
    const testGuard = new WmsAuthGuard(mockPrisma as any, new Reflector());
    const { context } = makeGuardContext('confirmDelivery', { authorization: `Bearer ${token}` });

    await expect(testGuard.canActivate(context)).rejects.toMatchObject({
      status: HttpStatus.FORBIDDEN,
    });
  });

  // M. Operador Recepción -> 403
  it('M. Operador Recepción debe ser rechazado con 403 Forbidden por no tener módulo despacho', async () => {
    const userRecepcion = makeStaffUser('Operador Recepción', 'recepcion@givingout.com', [
      { modulo: 'recepcion', accion: 'ver' },
      { modulo: 'recepcion', accion: 'crear' },
      { modulo: 'recepcion', accion: 'editar' },
    ]);

    const token = jwt.sign(
      { userId: userRecepcion.id, email: userRecepcion.email, rol: userRecepcion.rol.nombre },
      JWT_SECRET,
    );

    const mockPrisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(userRecepcion),
      },
    };
    const testGuard = new WmsAuthGuard(mockPrisma as any, new Reflector());
    const { context } = makeGuardContext('confirmDelivery', { authorization: `Bearer ${token}` });

    await expect(testGuard.canActivate(context)).rejects.toMatchObject({
      status: HttpStatus.FORBIDDEN,
    });
  });

  // N. Portal -> 403
  it('N. Usuario de Portal Depositante debe ser rechazado con 403 Forbidden para confirmDelivery (allowPortal: false)', async () => {
    const userPortal = {
      id: 'usr-portal-alim',
      email: 'pedro@alimnorte.mx',
      nombre: 'Pedro AlimNorte',
      activo: true,
      clienteId: 'cli-alim',
      rol: {
        nombre: 'Portal Depositante',
        permisos: [
          { modulo: { codigo: 'despacho' }, accion: { codigo: 'ver' } },
          { modulo: { codigo: 'despacho' }, accion: { codigo: 'editar' } },
        ],
      },
    };

    const token = jwt.sign(
      { userId: userPortal.id, email: userPortal.email, rol: userPortal.rol.nombre, clienteId: userPortal.clienteId },
      JWT_SECRET,
    );

    const mockPrisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(userPortal),
      },
    };
    const testGuard = new WmsAuthGuard(mockPrisma as any, new Reflector());
    const { context } = makeGuardContext('confirmDelivery', { authorization: `Bearer ${token}` });

    await expect(testGuard.canActivate(context)).rejects.toMatchObject({
      status: HttpStatus.FORBIDDEN,
    });
  });

  // O. x-user-role -> sin elevación
  it('O. inyección de x-user-role no debe otorgar permisos ni eludir el bloqueo 403', async () => {
    const userRecepcion = makeStaffUser('Operador Recepción', 'recepcion@givingout.com', [
      { modulo: 'recepcion', accion: 'ver' },
    ]);

    const token = jwt.sign(
      { userId: userRecepcion.id, email: userRecepcion.email, rol: userRecepcion.rol.nombre },
      JWT_SECRET,
    );

    const mockPrisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(userRecepcion),
      },
    };
    const testGuard = new WmsAuthGuard(mockPrisma as any, new Reflector());
    const { context } = makeGuardContext('confirmDelivery', {
      authorization: `Bearer ${token}`,
      'x-user-role': 'Super Admin',
    });

    await expect(testGuard.canActivate(context)).rejects.toMatchObject({
      status: HttpStatus.FORBIDDEN,
    });
  });

  // P. multi-tenant
  it('P. Portal AlimNorte puede ver su pedido entregado mientras que Portal Fashion Forward recibe lista vacía', async () => {
    // Entregar PED-001
    const reqStaff = { user: { email: 'admin@givingout.com' } };
    await controller.confirmDelivery(
      'order-001-id',
      { nombreReceptor: 'RESPONSABLE QA CEDIS' },
      reqStaff,
    );

    // Consulta Portal AlimNorte
    const reqAlimNorte = { user: { clienteId: 'cli-alim' } };
    const ordersAlim = await controller.getOrders(undefined, undefined, undefined, reqAlimNorte);
    expect(ordersAlim.length).toBe(2);
    const deliveredAlim = ordersAlim.find((o) => o.codigo === 'PED-QA-E2E-OUT-001');
    expect(deliveredAlim).toBeDefined();
    expect(deliveredAlim?.estado).toBe('ENTREGADO');

    // Consulta Portal Fashion Forward
    const reqFashion = { user: { clienteId: 'cli-fashion' } };
    const ordersFashion = await controller.getOrders(undefined, undefined, undefined, reqFashion);
    expect(ordersFashion.length).toBe(0);
  });

  // Q. PED-002 control intacto
  it('Q. PED-QA-E2E-OUT-002 debe permanecer estrictamente en DESPACHADO y EN_RUTA sin alteraciones', async () => {
    const reqStaff = { user: { email: 'admin@givingout.com' } };

    // Confirmar entrega solo de PED-001
    await controller.confirmDelivery(
      'order-001-id',
      { nombreReceptor: 'RESPONSABLE QA CEDIS' },
      reqStaff,
    );

    const ped002 = state.orders.find((o: any) => o.codigo === 'PED-QA-E2E-OUT-002');
    expect(ped002).toBeDefined();
    expect(ped002.estado).toBe('DESPACHADO');
    expect(ped002.estadoEntrega).toBe('EN_RUTA');
    expect(ped002.fechaEntrega).toBeNull();
    expect(ped002.nombreReceptor).toBeNull();
    expect(ped002.trackingEvents.length).toBe(1);
    expect(ped002.trackingEvents[0].estado).toBe('SALIDA_ALMACEN');
  });

  // R. Fechas formatCalendarDate
  it('R. formatCalendarDate formatea la fecha de entrega sin desfase de zona horaria', () => {
    const formatted = formatCalendarDate('2026-11-13T10:00:00.000Z');
    expect(formatted).toBe('13/11/2026');
  });
});

