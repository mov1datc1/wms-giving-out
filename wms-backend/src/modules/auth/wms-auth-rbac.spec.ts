jest.mock('../../prisma.service', () => ({
  PrismaService: class MockPrismaService {},
}));

import { ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as jwt from 'jsonwebtoken';
import { WmsAuthGuard } from './wms-auth.guard';
import { AuthController } from './auth.controller';
import { AdminController } from './admin.controller';
import { AppController } from '../../app.controller';
import { ClientsController } from '../clients/clients.controller';
import { EndCustomersController } from '../end-customers/end-customers.controller';
import { MasterDataController } from '../master-data/master-data.controller';
import { InventoryController } from '../inventory/inventory.controller';
import { OperationsController } from '../operations/operations.controller';

const JWT_SECRET = process.env.JWT_SECRET || 'giving-out-wms-secret-2026';

type RoleName =
  | 'Super Admin'
  | 'Dirección'
  | 'Gerente Operaciones'
  | 'Supervisor Almacén'
  | 'Operador Recepción'
  | 'Operador Picking'
  | 'Depositante';

function buildPermissions(role: RoleName): { modulo: string; accion: string }[] {
  const allActions = ['ver', 'crear', 'editar', 'aprobar', 'imprimir', 'cancelar', 'ajustar', 'exportar'];
  const allModules = [
    'dashboard', 'inventario', 'ubicaciones', 'recepcion', 'picking', 'despacho',
    'maestros', 'admin', 'etiquetado', 'depositantes', 'clientes-finales',
    'conteo-ciclico', 'alertas', 'trazabilidad',
  ];

  if (role === 'Super Admin') {
    return allModules.flatMap(modulo => allActions.map(accion => ({ modulo, accion })));
  }
  if (role === 'Dirección') {
    return ['dashboard', 'inventario', 'depositantes', 'alertas', 'trazabilidad'].flatMap(modulo =>
      ['ver', 'exportar'].map(accion => ({ modulo, accion })),
    );
  }
  if (role === 'Gerente Operaciones') {
    return allModules
      .filter(m => m !== 'admin')
      .flatMap(modulo => ['ver', 'crear', 'editar', 'aprobar', 'imprimir', 'exportar'].map(accion => ({ modulo, accion })));
  }
  if (role === 'Supervisor Almacén') {
    return ['dashboard', 'inventario', 'ubicaciones', 'recepcion', 'picking', 'despacho', 'etiquetado', 'conteo-ciclico', 'alertas'].flatMap(modulo =>
      ['ver', 'crear', 'editar', 'imprimir'].map(accion => ({ modulo, accion })),
    );
  }
  if (role === 'Operador Recepción') {
    return [
      { modulo: 'dashboard', accion: 'ver' },
      ...['recepcion', 'inventario', 'etiquetado'].flatMap(modulo =>
        ['ver', 'crear', 'imprimir'].map(accion => ({ modulo, accion })),
      ),
    ];
  }
  if (role === 'Operador Picking') {
    return [
      { modulo: 'dashboard', accion: 'ver' },
      ...['picking', 'despacho', 'inventario'].flatMap(modulo =>
        ['ver', 'crear'].map(accion => ({ modulo, accion })),
      ),
    ];
  }
  // Depositante
  return [
    { modulo: 'dashboard', accion: 'ver' },
    { modulo: 'inventario', accion: 'ver' },
    ...['clientes-finales'].flatMap(modulo => ['ver', 'crear', 'editar'].map(accion => ({ modulo, accion }))),
    ...['despacho'].flatMap(modulo => ['ver', 'crear'].map(accion => ({ modulo, accion }))),
  ];
}

function makeDbUser(role: RoleName, opts: { activo?: boolean; clienteId?: string | null } = {}) {
  const nivelMap: Record<RoleName, number> = {
    'Super Admin': 1,
    'Dirección': 2,
    'Gerente Operaciones': 3,
    'Supervisor Almacén': 4,
    'Operador Recepción': 5,
    'Operador Picking': 5,
    Depositante: 10,
  };
  return {
    id: `user-${role}`,
    email: `${role.toLowerCase().replace(/\s+/g, '.')}@givingout.mx`,
    nombre: role,
    activo: opts.activo ?? true,
    rolId: `rol-${role}`,
    almacenId: 'wh-1',
    clienteId: opts.clienteId !== undefined ? opts.clienteId : role === 'Depositante' ? 'client-portal-1' : null,
    rol: {
      id: `rol-${role}`,
      nombre: role,
      nivel: nivelMap[role],
      permisos: buildPermissions(role),
    },
  };
}

function makeContext(
  cls: any,
  methodName: string,
  headers: Record<string, string> = {},
): { context: ExecutionContext; request: any } {
  const handler = cls.prototype[methodName];
  if (!handler) {
    throw new Error(`Handler ${cls.name}.${methodName} not found`);
  }
  const request: any = { headers };
  const context = {
    getHandler: () => handler,
    getClass: () => cls,
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
  return { context, request };
}

describe('WmsAuthGuard, RBAC Matrix, Anti-Spoofing y AuthController', () => {
  it('permite rutas @Public() (login / health) sin token', async () => {
    const guard = new WmsAuthGuard({} as any, new Reflector());
    const { context: loginCtx } = makeContext(AuthController, 'login');
    const { context: healthCtx } = makeContext(AppController, 'health');

    await expect(guard.canActivate(loginCtx)).resolves.toBe(true);
    await expect(guard.canActivate(healthCtx)).resolves.toBe(true);
  });

  it('rechaza con 401 si falta token, es demo-token, expiró/inválido o usuario está inactivo', async () => {
    const prismaMock = {
      user: {
        findUnique: jest.fn().mockResolvedValue(makeDbUser('Operador Recepción', { activo: false })),
      },
    };
    const guard = new WmsAuthGuard(prismaMock as any, new Reflector());

    // Sin token
    const missingCtx = makeContext(ClientsController, 'getClients').context;
    await expect(guard.canActivate(missingCtx)).rejects.toMatchObject({ status: HttpStatus.UNAUTHORIZED });

    // demo-token
    const demoCtx = makeContext(ClientsController, 'getClients', {
      authorization: 'Bearer demo-token',
    }).context;
    await expect(guard.canActivate(demoCtx)).rejects.toMatchObject({ status: HttpStatus.UNAUTHORIZED });

    // Token manipulado / firma inválida
    const badJwtCtx = makeContext(ClientsController, 'getClients', {
      authorization: 'Bearer invalid.jwt.signature',
    }).context;
    await expect(guard.canActivate(badJwtCtx)).rejects.toMatchObject({ status: HttpStatus.UNAUTHORIZED });

    // Usuario inactivo en BD
    const validTokenForInactive = jwt.sign({ userId: 'user-inactive', rol: 'Super Admin' }, JWT_SECRET);
    const inactiveCtx = makeContext(ClientsController, 'getClients', {
      authorization: `Bearer ${validTokenForInactive}`,
    }).context;
    await expect(guard.canActivate(inactiveCtx)).rejects.toMatchObject({ status: HttpStatus.UNAUTHORIZED });
  });

  it('ignora por completo x-user-role falsificado y aplica permisos reales de BD para Operador Recepción', async () => {
    const dbUser = makeDbUser('Operador Recepción');
    const prismaMock = {
      user: { findUnique: jest.fn().mockResolvedValue(dbUser) },
    };
    const guard = new WmsAuthGuard(prismaMock as any, new Reflector());
    const token = jwt.sign({ userId: dbUser.id, rol: 'Super Admin' }, JWT_SECRET);
    const spoofedHeaders = {
      authorization: `Bearer ${token}`,
      'x-user-role': 'Super Admin',
    };

    // Permitido para Operador Recepción: SKUs GET, Suppliers GET, Rampa Arribo POST, Dashboard Stats
    const allowed: [any, string][] = [
      [MasterDataController, 'getSkus'],
      [MasterDataController, 'getSuppliers'],
      [OperationsController, 'registrarArriboRampa'],
      [OperationsController, 'reconcileAnden'],
      [OperationsController, 'getDashboardStats'],
    ];
    for (const [cls, method] of allowed) {
      const { context, request } = makeContext(cls, method, spoofedHeaders);
      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(request.user.rolNombre).toBe('Operador Recepción');
      expect(request.user.isSuperAdmin).toBe(false);
    }

    // Bloqueado 403 aun con x-user-role: Super Admin falsificado
    const blocked: [any, string][] = [
      [ClientsController, 'createClient'],
      [MasterDataController, 'createSupplier'],
      [MasterDataController, 'saveSettings'],
      [AdminController, 'getUsers'],
      [OperationsController, 'startPicking'],
      [OperationsController, 'dispatchOrder'],
      [OperationsController, 'unlockReceipt'],
      [OperationsController, 'closeReceipt'],
    ];
    for (const [cls, method] of blocked) {
      const { context } = makeContext(cls, method, spoofedHeaders);
      await expect(guard.canActivate(context)).rejects.toMatchObject({ status: HttpStatus.FORBIDDEN });
    }
  });

  it('restringe a Dirección (solo ver/exportar) en mutaciones de catálogos y alertas', async () => {
    const dbUser = makeDbUser('Dirección');
    const prismaMock = { user: { findUnique: jest.fn().mockResolvedValue(dbUser) } };
    const guard = new WmsAuthGuard(prismaMock as any, new Reflector());
    const token = jwt.sign({ userId: dbUser.id }, JWT_SECRET);
    const headers = { authorization: `Bearer ${token}` };

    await expect(guard.canActivate(makeContext(ClientsController, 'getClients', headers).context)).resolves.toBe(true);
    await expect(guard.canActivate(makeContext(InventoryController, 'getConsolidatedInventory', headers).context)).resolves.toBe(true);

    await expect(guard.canActivate(makeContext(ClientsController, 'createClient', headers).context)).rejects.toMatchObject({
      status: HttpStatus.FORBIDDEN,
    });
    await expect(guard.canActivate(makeContext(MasterDataController, 'createSupplier', headers).context)).rejects.toMatchObject({
      status: HttpStatus.FORBIDDEN,
    });
    await expect(guard.canActivate(makeContext(EndCustomersController, 'updateEndCustomer', headers).context)).rejects.toMatchObject({
      status: HttpStatus.FORBIDDEN,
    });
    await expect(guard.canActivate(makeContext(MasterDataController, 'generateAlerts', headers).context)).rejects.toMatchObject({
      status: HttpStatus.FORBIDDEN,
    });
  });

  it('aísla a usuario Portal Depositante: permite su portal y bloquea endpoints exclusivos de staff', async () => {
    const dbUser = makeDbUser('Depositante', { clienteId: 'cli-alimnorte' });
    const prismaMock = { user: { findUnique: jest.fn().mockResolvedValue(dbUser) } };
    const guard = new WmsAuthGuard(prismaMock as any, new Reflector());
    const token = jwt.sign({ userId: dbUser.id, clienteId: 'cli-alimnorte' }, JWT_SECRET);
    const headers = { authorization: `Bearer ${token}` };

    // Rutas necesarias para el Portal Depositante
    const portalAllowed: [any, string][] = [
      [ClientsController, 'getClientInventory'],
      [EndCustomersController, 'getEndCustomers'],
      [EndCustomersController, 'createEndCustomer'],
      [MasterDataController, 'getSkus'],
      [MasterDataController, 'getWarehouses'],
      [OperationsController, 'getOrders'],
      [OperationsController, 'createOrder'],
      [OperationsController, 'getDashboardStats'],
    ];
    for (const [cls, method] of portalAllowed) {
      await expect(guard.canActivate(makeContext(cls, method, headers).context)).resolves.toBe(true);
    }

    // Bloqueadas para Portal aun si el rol tuviera nombre similar
    const portalBlocked: [any, string][] = [
      [ClientsController, 'createClient'],
      [MasterDataController, 'getSuppliers'],
      [MasterDataController, 'createSupplier'],
      [MasterDataController, 'getLocations'],
      [InventoryController, 'getVirtualWarehouse'],
      [OperationsController, 'getReceipts'],
      [OperationsController, 'dispatchOrder'],
      [AdminController, 'getUsers'],
    ];
    for (const [cls, method] of portalBlocked) {
      await expect(guard.canActivate(makeContext(cls, method, headers).context)).rejects.toMatchObject({
        status: HttpStatus.FORBIDDEN,
      });
    }
  });

  it('separa Operador Picking de operaciones de Despacho y Supervisión (aprobar/preparar/despachar -> 403)', async () => {
    const dbUser = makeDbUser('Operador Picking');
    const prismaMock = { user: { findUnique: jest.fn().mockResolvedValue(dbUser) } };
    const guard = new WmsAuthGuard(prismaMock as any, new Reflector());
    const token = jwt.sign({ userId: dbUser.id }, JWT_SECRET);
    const headers = { authorization: `Bearer ${token}` };

    await expect(guard.canActivate(makeContext(OperationsController, 'startPicking', headers).context)).resolves.toBe(true);
    await expect(guard.canActivate(makeContext(OperationsController, 'recordPick', headers).context)).resolves.toBe(true);
    await expect(guard.canActivate(makeContext(OperationsController, 'dispatchOrder', headers).context)).rejects.toMatchObject({
      status: HttpStatus.FORBIDDEN,
    });
    await expect(guard.canActivate(makeContext(OperationsController, 'confirmDelivery', headers).context)).rejects.toMatchObject({
      status: HttpStatus.FORBIDDEN,
    });
    await expect(guard.canActivate(makeContext(OperationsController, 'prepareOrder', headers).context)).rejects.toMatchObject({
      status: HttpStatus.FORBIDDEN,
    });
  });

  it('concede acceso total al Super Admin autenticado y devuelve permisosDetalle completos en /api/auth/me', async () => {
    const dbUser = makeDbUser('Super Admin');
    const prismaMock = { user: { findUnique: jest.fn().mockResolvedValue(dbUser) } };
    const guard = new WmsAuthGuard(prismaMock as any, new Reflector());
    const authController = new AuthController(prismaMock as any);
    const token = jwt.sign({ userId: dbUser.id }, JWT_SECRET);
    const headers = { authorization: `Bearer ${token}` };

    await expect(guard.canActivate(makeContext(AdminController, 'getUsers', headers).context)).resolves.toBe(true);
    await expect(guard.canActivate(makeContext(MasterDataController, 'saveSettings', headers).context)).resolves.toBe(true);
    await expect(guard.canActivate(makeContext(ClientsController, 'createClient', headers).context)).resolves.toBe(true);

    const me = await authController.me(`Bearer ${token}`);
    expect(me.isSuperAdmin).toBe(true);
    expect(me.permisos).toContain('depositantes');
    expect(Array.isArray(me.permisosDetalle)).toBe(true);
    expect(me.permisosDetalle).toContain('depositantes:crear');
    expect(me.permisosDetalle).toContain('clientes-finales:editar');
  });
});
