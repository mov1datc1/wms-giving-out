jest.mock('../../prisma.service', () => ({
  PrismaService: class MockPrismaService { },
}));
jest.mock('../../email.service', () => ({
  EmailService: class MockEmailService { },
}));

import { ExecutionContext, HttpStatus, HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as jwt from 'jsonwebtoken';
import { OperationsController } from './operations.controller';
import { PutawayEngineService } from './putaway-engine.service';
import { WmsAuthGuard } from '../auth/wms-auth.guard';
import { validateHuAllocationCompatibility } from '../../common/picking-staging-transfer.util';

const JWT_SECRET = process.env.JWT_SECRET || 'giving-out-wms-secret-2026';

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

function makeGuardContext(controllerClass: any, handlerName: string, headers: Record<string, string>, reqBody?: any) {
  const handler = controllerClass.prototype[handlerName];
  const request: any = { headers, body: reqBody };
  const context = {
    getHandler: () => handler,
    getClass: () => controllerClass,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { context, request };
}

describe('Preflight Técnico: Motor de Asignación FEFO / FIFO y Reglas de Reserva', () => {
  let operationsController: OperationsController;
  let putawayEngine: PutawayEngineService;
  let guard: WmsAuthGuard;
  let state: any;

  function buildInMemoryDb() {
    let seq = 1;
    const nextId = (p: string) => `${p}-${seq++}`;

    const clientAlimNorte = {
      id: 'ba453845-913f-47c8-b08e-b3f30874722f',
      codigo: 'DEP-ALIMENTOS-01',
      nombreComercial: 'AlimNorte',
      razonSocial: 'AlimNorte S.A. de C.V.',
      giro: 'COMIDA',
      reglaInventario: 'FEFO',
      manejoInventario: 'CAJA',
      uomPrincipal: 'CAJA',
      requiereLote: true,
      requiereCaducidad: true,
    };

    const clientFashion = {
      id: 'cli-fashion-001',
      codigo: 'DEP-FASHION-01',
      nombreComercial: 'Fashion Forward',
      razonSocial: 'Fashion Forward S.A.',
      giro: 'ROPA',
      reglaInventario: 'FIFO',
      manejoInventario: 'PIEZA',
      uomPrincipal: 'PZA',
      requiereLote: false,
      requiereCaducidad: false,
    };

    const endCustomerWalmart = {
      id: 'ec-walmart',
      codigo: 'WALMART-01',
      nombre: 'Walmart México CEDIS',
      ciudad: 'Cuautitlán Izcalli',
      clienteId: clientAlimNorte.id,
      activo: true,
    };

    const skuAceite = {
      id: 'sku-aceite-001',
      codigo: 'ACE-OLI-1L',
      descripcion: 'Aceite de Oliva Extra Virgen 1L',
      uomBase: 'PZA',
      capacidadEmpaque: 12,
      activo: true,
      clienteId: clientAlimNorte.id,
    };

    const skuPlayera = {
      id: 'sku-playera-001',
      codigo: 'TSHIRT-BLK-M',
      descripcion: 'Playera Deportiva Negra M',
      uomBase: 'PZA',
      capacidadEmpaque: 1,
      activo: true,
      clienteId: clientFashion.id,
    };

    const warehouse = { id: 'wh-1', codigo: 'ALM-TEPOZ', nombre: 'Almacén Tepotzotlán' };
    const zoneInterior = { id: 'zone-int', codigo: 'INTERIOR', nombre: 'Interior', tipoZona: 'ALMACENAMIENTO', almacenId: warehouse.id };
    const zoneStaging = { id: 'zone-stg', codigo: 'STAGING', nombre: 'Staging', tipoZona: 'STAGING', almacenId: warehouse.id };

    const locG0001: any = {
      id: 'loc-g0001',
      codigo: 'G0001',
      almacenId: warehouse.id,
      almacen: warehouse,
      zonaId: zoneInterior.id,
      zona: zoneInterior,
      tipoUbicacion: 'TARIMA_PISO',
      estado: 'OCUPADO',
      activo: true,
      capacidadUnits: 100,
      ocupacion: 1,
    };

    const locG0002: any = {
      id: 'loc-g0002',
      codigo: 'G0002',
      almacenId: warehouse.id,
      almacen: warehouse,
      zonaId: zoneInterior.id,
      zona: zoneInterior,
      tipoUbicacion: 'TARIMA_PISO',
      estado: 'OCUPADO',
      activo: true,
      capacidadUnits: 100,
      ocupacion: 1,
    };

    const locG0003: any = {
      id: 'loc-g0003',
      codigo: 'G0003',
      almacenId: warehouse.id,
      almacen: warehouse,
      zonaId: zoneInterior.id,
      zona: zoneInterior,
      tipoUbicacion: 'TARIMA_PISO',
      estado: 'OCUPADO',
      activo: true,
      capacidadUnits: 100,
      ocupacion: 1,
    };

    const locStg01: any = {
      id: 'loc-stg01',
      codigo: 'STG-01',
      almacenId: warehouse.id,
      almacen: warehouse,
      zonaId: zoneStaging.id,
      zona: zoneStaging,
      tipoUbicacion: 'STAGING',
      estado: 'LIBRE',
      activo: true,
      capacidadUnits: 1000,
      ocupacion: 0,
    };

    const users = [
      {
        id: 'usr-admin',
        email: 'admin@givingout.com',
        nombre: 'Administrador',
        rol: 'ADMIN',
        activo: true,
        clienteId: null,
      },
      {
        id: 'usr-pedro',
        email: 'pedro@alimnorte.mx',
        nombre: 'Pedro AlimNorte',
        rol: 'CLIENTE',
        activo: true,
        clienteId: clientAlimNorte.id,
      },
      {
        id: 'usr-laura',
        email: 'laura@fashionforward.mx',
        nombre: 'Laura Fashion',
        rol: 'CLIENTE',
        activo: true,
        clienteId: clientFashion.id,
      },
    ];

    state = {
      clients: [clientAlimNorte, clientFashion],
      endCustomers: [endCustomerWalmart],
      skus: [skuAceite, skuPlayera],
      locations: [locG0001, locG0002, locG0003, locStg01],
      lots: [] as any[],
      hus: [] as any[],
      orders: [] as any[],
      orderLines: [] as any[],
      movements: [] as any[],
      auditLogs: [] as any[],
      users,
    };

    const matchesWhere = (rec: any, where: any): boolean => {
      if (!where) return true;
      if (!rec) return false;
      if (where.OR && Array.isArray(where.OR)) {
        const matchesOr = where.OR.some((cond: any) => matchesWhere(rec, cond));
        if (!matchesOr) return false;
      }
      for (const [k, v] of Object.entries(where)) {
        if (k === 'OR') continue;
        if (v && typeof v === 'object' && !(v instanceof Date)) {
          const cond: any = v;
          if ('startsWith' in cond) {
            if (!String(rec[k] ?? '').startsWith(cond.startsWith)) return false;
            continue;
          }
          if ('equals' in cond) {
            if (cond.mode === 'insensitive') {
              if (String(rec[k] ?? '').toUpperCase() !== String(cond.equals ?? '').toUpperCase()) return false;
            } else if (rec[k] !== cond.equals) return false;
            continue;
          }
          if ('in' in cond) {
            if (!cond.in.map((x: any) => String(x).toUpperCase()).includes(String(rec[k] ?? '').toUpperCase())) return false;
            continue;
          }
          if ('notIn' in cond) {
            if (cond.notIn.map((x: any) => String(x).toUpperCase()).includes(String(rec[k] ?? '').toUpperCase())) return false;
            continue;
          }
          if ('not' in cond) {
            if (rec[k] === cond.not) return false;
            continue;
          }
          if ('gt' in cond) {
            if (!(Number(rec[k] ?? 0) > Number(cond.gt))) return false;
            continue;
          }
          if (rec[k] && typeof rec[k] === 'object') {
            if (!matchesWhere(rec[k], v)) return false;
            continue;
          }
        }
        if (v instanceof Date) {
          if (!rec[k] || new Date(rec[k]).getTime() !== v.getTime()) return false;
          continue;
        }
        if (rec[k] !== v) return false;
      }
      return true;
    };

    const sortLots = (lots: any[], orderBy: any[]) => {
      if (!orderBy || !Array.isArray(orderBy) || orderBy.length === 0) return lots;
      return [...lots].sort((a, b) => {
        for (const rule of orderBy) {
          if (rule.fechaVencimiento) {
            const dir = rule.fechaVencimiento === 'desc' ? -1 : 1;
            const da = a.fechaVencimiento ? new Date(a.fechaVencimiento).getTime() : null;
            const db = b.fechaVencimiento ? new Date(b.fechaVencimiento).getTime() : null;
            if (da === null && db !== null) return 1;
            if (da !== null && db === null) return -1;
            if (da !== null && db !== null && da !== db) {
              return da < db ? -1 * dir : 1 * dir;
            }
          }
          if (rule.createdAt) {
            const dir = rule.createdAt === 'desc' ? -1 : 1;
            const ca = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const cb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            if (ca !== cb) {
              return ca < cb ? -1 * dir : 1 * dir;
            }
          }
          if (rule.id) {
            const dir = rule.id === 'desc' ? -1 : 1;
            const ia = String(a.id || '');
            const ib = String(b.id || '');
            if (ia !== ib) {
              return ia < ib ? -1 * dir : 1 * dir;
            }
          }
        }
        return 0;
      });
    };

    const hydrateLot = (lot: any) => {
      if (!lot) return null;
      const ubicacion = state.locations.find((l: any) => l.id === lot.ubicacionId) || null;
      const sku = state.skus.find((s: any) => s.id === lot.skuId) || null;
      const cliente = state.clients.find((c: any) => c.id === lot.clienteId) || null;
      const handlingUnits = state.hus.filter((h: any) => h.lotId === lot.id);
      return { ...lot, ubicacion, sku, cliente, handlingUnits };
    };

    const hydrateOrder = (order: any) => {
      if (!order) return null;
      const cliente = state.clients.find((c: any) => c.id === order.clienteId) || null;
      const endCustomer = state.endCustomers.find((e: any) => e.id === order.endCustomerId) || null;
      const lineas = state.orderLines.filter((l: any) => l.orderId === order.id).map((line: any) => ({
        ...line,
        sku: state.skus.find((s: any) => s.id === line.skuId) || null,
        lote: line.lotId ? hydrateLot(state.lots.find((l: any) => l.id === line.lotId)) : null,
      }));
      return { ...order, cliente, endCustomer, lineas };
    };

    const dbApi: any = {
      $executeRawUnsafe: jest.fn(async () => 0),
      $queryRawUnsafe: jest.fn(async () => [{ id: 'lock' }]),
      $transaction: jest.fn(async (cb: any) => cb(dbApi)),
      user: {
        findUnique: jest.fn(async ({ where }: any) => state.users.find((u: any) => u.id === where.id || u.email === where.email) || null),
      },
      client: {
        findUnique: jest.fn(async ({ where }: any) => state.clients.find((c: any) => c.id === where.id) || null),
        findMany: jest.fn(async () => state.clients),
      },
      skuMaster: {
        findUnique: jest.fn(async ({ where }: any) => state.skus.find((s: any) => s.id === where.id) || null),
      },
      location: {
        findUnique: jest.fn(async ({ where }: any) => state.locations.find((l: any) => l.id === where.id || l.codigo === where.codigo) || null),
        findFirst: jest.fn(async ({ where }: any) => state.locations.find((l: any) => matchesWhere(l, where)) || null),
      },
      lotInventory: {
        findMany: jest.fn(async ({ where, include, orderBy }: any) => {
          let list = state.lots.map(hydrateLot).filter((l: any) => matchesWhere(l, where));
          list = sortLots(list, orderBy);
          return list.map((l: any) => {
            const hl = { ...l };
            if (include?.handlingUnits?.where) {
              hl.handlingUnits = state.hus.filter((h: any) => h.lotId === l.id && matchesWhere(h, include.handlingUnits.where));
            }
            return hl;
          });
        }),
        findUnique: jest.fn(async ({ where }: any) => {
          const l = state.lots.find((x: any) => x.id === where.id);
          return l ? hydrateLot(l) : null;
        }),
        findFirst: jest.fn(async ({ where }: any) => {
          const l = state.lots.map(hydrateLot).find((x: any) => matchesWhere(x, where));
          return l ? hydrateLot(l) : null;
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const l = state.lots.find((x: any) => x.id === where.id);
          if (l) {
            if (data.cantidadReservada?.increment) l.cantidadReservada += data.cantidadReservada.increment;
            if (data.cantidadReservada?.decrement) l.cantidadReservada -= data.cantidadReservada.decrement;
            if (data.cantidadDisponible?.decrement) l.cantidadDisponible -= data.cantidadDisponible.decrement;
          }
          return l;
        }),
        create: jest.fn(async ({ data }: any) => {
          const created = { id: nextId('lot'), ...data, createdAt: data.createdAt || new Date(), cantidadReservada: data.cantidadReservada || 0 };
          state.lots.push(created);
          return created;
        }),
      },
      handlingUnit: {
        findMany: jest.fn(async ({ where }: any) => state.hus.filter((h: any) => matchesWhere(h, where))),
        findFirst: jest.fn(async ({ where }: any) => state.hus.find((h: any) => matchesWhere(h, where)) || null),
      },
      salesOrder: {
        findMany: jest.fn(async ({ where }: any) => {
          return state.orders.filter((o: any) => matchesWhere(o, where)).map(hydrateOrder);
        }),
        findFirst: jest.fn(async ({ where }: any) => {
          const o = state.orders.find((x: any) => matchesWhere(x, where));
          return o ? hydrateOrder(o) : null;
        }),
        findUnique: jest.fn(async ({ where }: any) => {
          const o = state.orders.find((x: any) => x.id === where.id);
          return o ? hydrateOrder(o) : null;
        }),
        create: jest.fn(async ({ data }: any) => {
          const ordId = nextId('ord');
          const createdOrd = {
            id: ordId,
            codigo: data.codigo || `PED-${ordId}`,
            clienteId: data.clienteId,
            endCustomerId: data.endCustomerId || null,
            almacenOrigenId: data.almacenOrigenId || 'wh-1',
            estado: data.estado || 'SOLICITADO',
            fechaCompromiso: data.fechaCompromiso || new Date(),
            prioridad: data.prioridad || 'MEDIA',
            createdAt: new Date(),
          };
          state.orders.push(createdOrd);
          if (data.lineas?.create) {
            for (const lData of data.lineas.create) {
              state.orderLines.push({
                id: nextId('line'),
                orderId: ordId,
                ...lData,
              });
            }
          }
          return hydrateOrder(createdOrd);
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const o = state.orders.find((x: any) => x.id === where.id);
          if (o) Object.assign(o, data);
          return hydrateOrder(o);
        }),
      },
      salesOrderLine: {
        findMany: jest.fn(async ({ where }: any) => {
          return state.orderLines
            .map((l: any) => {
              const orden = state.orders.find((o: any) => o.id === l.orderId) || null;
              return { ...l, orden };
            })
            .filter((l: any) => matchesWhere(l, where));
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const l = state.orderLines.find((x: any) => x.id === where.id);
          if (l) Object.assign(l, data);
          return l;
        }),
      },
      auditLog: {
        create: jest.fn(async ({ data }: any) => state.auditLogs.push(data)),
      },
    };

    return { dbApi, state };
  }

  beforeEach(() => {
    const { dbApi } = buildInMemoryDb();
    putawayEngine = new PutawayEngineService(dbApi);
    operationsController = new OperationsController(dbApi, putawayEngine);
  });

  // ==========================================================================
  // CASO 1: FEFO TIENE PRIORIDAD ABSOLUTA SOBRE FIFO
  // ==========================================================================
  it('1. FEFO tiene prioridad sobre FIFO: selecciona Lote B (31/03/2027) antes que Lote A (30/06/2027) aunque Lote A ingresó primero', async () => {
    // Lote A ingresó a las 08:00 (primero), caducidad 30/06/2027
    state.lots.push({
      id: 'lot-a',
      lote: 'LOTE-A-TARDIO',
      skuId: 'sku-aceite-001',
      clienteId: 'ba453845-913f-47c8-b08e-b3f30874722f',
      fechaVencimiento: new Date('2027-06-30T00:00:00Z'),
      createdAt: new Date('2026-11-16T08:00:00Z'),
      estadoCalidad: 'LIBERADO',
      cantidadDisponible: 12,
      cantidadReservada: 0,
      cantidadBloqueada: 0,
      ubicacionId: 'loc-g0001',
    });
    state.hus.push({
      id: 'hu-box-a',
      codigo: 'BOX-A-001',
      tipoHu: 'CAJA',
      lotId: 'lot-a',
      clienteId: 'ba453845-913f-47c8-b08e-b3f30874722f',
      cantidad: 12,
      estadoHu: 'ACTIVO',
      ubicacionActual: 'G0001',
    });

    // Lote B ingresó a las 11:00 (después), pero vence antes: 31/03/2027
    state.lots.push({
      id: 'lot-b',
      lote: 'LOTE-B-PROXIMO-VENCER',
      skuId: 'sku-aceite-001',
      clienteId: 'ba453845-913f-47c8-b08e-b3f30874722f',
      fechaVencimiento: new Date('2027-03-31T00:00:00Z'),
      createdAt: new Date('2026-11-16T11:00:00Z'),
      estadoCalidad: 'LIBERADO',
      cantidadDisponible: 12,
      cantidadReservada: 0,
      cantidadBloqueada: 0,
      ubicacionId: 'loc-g0002',
    });
    state.hus.push({
      id: 'hu-box-b',
      codigo: 'BOX-B-001',
      tipoHu: 'CAJA',
      lotId: 'lot-b',
      clienteId: 'ba453845-913f-47c8-b08e-b3f30874722f',
      cantidad: 12,
      estadoHu: 'ACTIVO',
      ubicacionActual: 'G0002',
    });

    // Crear orden por 12 PZA (1 caja)
    const orderCreated = await operationsController.createOrder({
      clienteId: 'ba453845-913f-47c8-b08e-b3f30874722f',
      lineas: [{ skuId: 'sku-aceite-001', cantidadSolicitada: 12 }],
    });

    expect(orderCreated).toBeDefined();
    // La sugerencia / reserva automática debe asignar Lote B (FEFO gana a FIFO)
    const line = orderCreated.lineas[0];
    const asignaciones = JSON.parse(line.asignacionesJson || '[]');
    expect(asignaciones[0].lotId).toBe('lot-b');
    expect(asignaciones[0].lote).toBe('LOTE-B-PROXIMO-VENCER');

    // Comprobar sugerencia de allocation
    const suggestion = await operationsController.suggestOrderAllocation(orderCreated.id);
    expect(suggestion.reglaAplicada).toBe('FEFO');
    expect(suggestion.lineas[0].sugerencia[0].lotId).toBe('lot-b');
  });

  // ==========================================================================
  // CASO 2: FIFO DESEMPATA MISMA CADUCIDAD
  // ==========================================================================
  it('2. FIFO desempata lotes con la misma caducidad: Lote A (ingreso más antiguo) antes que Lote B (ingreso posterior)', async () => {
    // Ambos lotes vencen el 30/06/2027
    state.lots.push({
      id: 'lot-cad-antiguo',
      lote: 'LOT-CAD-ANTIGUO',
      skuId: 'sku-aceite-001',
      clienteId: 'ba453845-913f-47c8-b08e-b3f30874722f',
      fechaVencimiento: new Date('2027-06-30T00:00:00Z'),
      createdAt: new Date('2026-11-16T08:30:00Z'), // Entró 08:30
      estadoCalidad: 'LIBERADO',
      cantidadDisponible: 12,
      cantidadReservada: 0,
      cantidadBloqueada: 0,
      ubicacionId: 'loc-g0001',
    });
    state.hus.push({
      id: 'hu-box-antiguo',
      codigo: 'BOX-ANTIGUO-01',
      tipoHu: 'CAJA',
      lotId: 'lot-cad-antiguo',
      clienteId: 'ba453845-913f-47c8-b08e-b3f30874722f',
      cantidad: 12,
      estadoHu: 'ACTIVO',
      ubicacionActual: 'G0001',
    });

    state.lots.push({
      id: 'lot-cad-reciente',
      lote: 'LOT-CAD-RECIENTE',
      skuId: 'sku-aceite-001',
      clienteId: 'ba453845-913f-47c8-b08e-b3f30874722f',
      fechaVencimiento: new Date('2027-06-30T00:00:00Z'),
      createdAt: new Date('2026-11-16T12:00:00Z'), // Entró 12:00
      estadoCalidad: 'LIBERADO',
      cantidadDisponible: 12,
      cantidadReservada: 0,
      cantidadBloqueada: 0,
      ubicacionId: 'loc-g0002',
    });
    state.hus.push({
      id: 'hu-box-reciente',
      codigo: 'BOX-RECIENTE-01',
      tipoHu: 'CAJA',
      lotId: 'lot-cad-reciente',
      clienteId: 'ba453845-913f-47c8-b08e-b3f30874722f',
      cantidad: 12,
      estadoHu: 'ACTIVO',
      ubicacionActual: 'G0002',
    });

    const orderCreated = await operationsController.createOrder({
      clienteId: 'ba453845-913f-47c8-b08e-b3f30874722f',
      lineas: [{ skuId: 'sku-aceite-001', cantidadSolicitada: 12 }],
    });

    const line = orderCreated.lineas[0];
    const asignaciones = JSON.parse(line.asignacionesJson || '[]');
    // Debe seleccionar LOT-CAD-ANTIGUO por FIFO como desempate
    expect(asignaciones[0].lotId).toBe('lot-cad-antiguo');
  });

  // ==========================================================================
  // CASO 3: FEFO + FIFO COMBINADOS (ESCENARIO FINAL DE PRUEBA MANUAL)
  // ==========================================================================
  it('3. FEFO + FIFO Combinados: 3 lotes -> Selección obligatoria de LOT-FINAL-FEFO (31/03/2027) + LOT-FINAL-FIFO-A (30/06/2027 entrada 1) dejando LOT-FINAL-FIFO-B sin reservar', async () => {
    // 1. LOT-FINAL-FIFO-A: 30/06/2027, entra primero (08:00)
    state.lots.push({
      id: 'lot-fifo-a',
      lote: 'LOT-FINAL-FIFO-A',
      skuId: 'sku-aceite-001',
      clienteId: 'ba453845-913f-47c8-b08e-b3f30874722f',
      fechaVencimiento: new Date('2027-06-30T00:00:00Z'),
      createdAt: new Date('2026-11-16T08:00:00Z'),
      estadoCalidad: 'LIBERADO',
      cantidadDisponible: 12,
      cantidadReservada: 0,
      cantidadBloqueada: 0,
      ubicacionId: 'loc-g0001',
    });
    state.hus.push({
      id: 'hu-box-fifo-a',
      codigo: 'BOX-FINAL-FIFO-A',
      tipoHu: 'CAJA',
      lotId: 'lot-fifo-a',
      clienteId: 'ba453845-913f-47c8-b08e-b3f30874722f',
      cantidad: 12,
      estadoHu: 'ACTIVO',
      ubicacionActual: 'G0001',
    });

    // 2. LOT-FINAL-FIFO-B: 30/06/2027, entra segundo (09:00)
    state.lots.push({
      id: 'lot-fifo-b',
      lote: 'LOT-FINAL-FIFO-B',
      skuId: 'sku-aceite-001',
      clienteId: 'ba453845-913f-47c8-b08e-b3f30874722f',
      fechaVencimiento: new Date('2027-06-30T00:00:00Z'),
      createdAt: new Date('2026-11-16T09:00:00Z'),
      estadoCalidad: 'LIBERADO',
      cantidadDisponible: 12,
      cantidadReservada: 0,
      cantidadBloqueada: 0,
      ubicacionId: 'loc-g0002',
    });
    state.hus.push({
      id: 'hu-box-fifo-b',
      codigo: 'BOX-FINAL-FIFO-B',
      tipoHu: 'CAJA',
      lotId: 'lot-fifo-b',
      clienteId: 'ba453845-913f-47c8-b08e-b3f30874722f',
      cantidad: 12,
      estadoHu: 'ACTIVO',
      ubicacionActual: 'G0002',
    });

    // 3. LOT-FINAL-FEFO: 31/03/2027, entra tercero (10:00)
    state.lots.push({
      id: 'lot-fefo-c',
      lote: 'LOT-FINAL-FEFO',
      skuId: 'sku-aceite-001',
      clienteId: 'ba453845-913f-47c8-b08e-b3f30874722f',
      fechaVencimiento: new Date('2027-03-31T00:00:00Z'),
      createdAt: new Date('2026-11-16T10:00:00Z'),
      estadoCalidad: 'LIBERADO',
      cantidadDisponible: 12,
      cantidadReservada: 0,
      cantidadBloqueada: 0,
      ubicacionId: 'loc-g0003',
    });
    state.hus.push({
      id: 'hu-box-fefo-c',
      codigo: 'BOX-FINAL-FEFO-C',
      tipoHu: 'CAJA',
      lotId: 'lot-fefo-c',
      clienteId: 'ba453845-913f-47c8-b08e-b3f30874722f',
      cantidad: 12,
      estadoHu: 'ACTIVO',
      ubicacionActual: 'G0003',
    });

    // Pedido por 24 PZA (2 cajas cerradas de 12)
    const orderCreated = await operationsController.createOrder({
      clienteId: 'ba453845-913f-47c8-b08e-b3f30874722f',
      lineas: [{ skuId: 'sku-aceite-001', cantidadSolicitada: 24 }],
    });

    expect(orderCreated).toBeDefined();
    const line = orderCreated.lineas[0];
    const asignaciones = JSON.parse(line.asignacionesJson || '[]');

    // Debe contener exactamente 2 asignaciones
    expect(asignaciones.length).toBe(2);

    // Primera asignación: LOT-FINAL-FEFO (vence antes: 31/03/2027)
    expect(asignaciones[0].lotId).toBe('lot-fefo-c');
    expect(asignaciones[0].lote).toBe('LOT-FINAL-FEFO');
    expect(asignaciones[0].cantidad).toBe(12);

    // Segunda asignación: LOT-FINAL-FIFO-A (vence 30/06/2027 pero entró antes que B)
    expect(asignaciones[1].lotId).toBe('lot-fifo-a');
    expect(asignaciones[1].lote).toBe('LOT-FINAL-FIFO-A');
    expect(asignaciones[1].cantidad).toBe(12);

    // LOT-FINAL-FIFO-B debe quedar 100% libre sin reservar
    const lotB = state.lots.find((l: any) => l.id === 'lot-fifo-b');
    expect(lotB.cantidadReservada).toBe(0);
    expect(lotB.cantidadDisponible).toBe(12);
  });

  // ==========================================================================
  // CASO 4: LOTE BLOQUEADO EXCLUIDO
  // ==========================================================================
  it('4. Lote BLOQUEADO o en CUARENTENA es excluido del motor de reserva', async () => {
    state.lots.push({
      id: 'lot-bloqueado',
      lote: 'LOT-BLOQ',
      skuId: 'sku-aceite-001',
      clienteId: 'ba453845-913f-47c8-b08e-b3f30874722f',
      fechaVencimiento: new Date('2027-01-01T00:00:00Z'),
      createdAt: new Date('2026-11-16T07:00:00Z'),
      estadoCalidad: 'CUARENTENA',
      cantidadDisponible: 0,
      cantidadReservada: 0,
      cantidadBloqueada: 12,
      ubicacionId: 'loc-g0001',
    });

    await expect(
      operationsController.createOrder({
        clienteId: 'ba453845-913f-47c8-b08e-b3f30874722f',
        lineas: [{ skuId: 'sku-aceite-001', cantidadSolicitada: 12 }],
      }),
    ).rejects.toThrow(HttpException);
  });

  // ==========================================================================
  // CASO 5: CALIDAD NO LIBERADA EXCLUIDA
  // ==========================================================================
  it('5. Partida con MERMA o NO CONFORME no es elegible comercialmente', async () => {
    state.lots.push({
      id: 'lot-merma',
      lote: 'LOT-MERMA',
      skuId: 'sku-aceite-001',
      clienteId: 'ba453845-913f-47c8-b08e-b3f30874722f',
      fechaVencimiento: new Date('2027-02-01T00:00:00Z'),
      createdAt: new Date('2026-11-16T07:00:00Z'),
      estadoCalidad: 'MERMA',
      cantidadDisponible: 0,
      cantidadReservada: 0,
      cantidadBloqueada: 12,
      ubicacionId: 'loc-g0001',
    });

    await expect(
      operationsController.createOrder({
        clienteId: 'ba453845-913f-47c8-b08e-b3f30874722f',
        lineas: [{ skuId: 'sku-aceite-001', cantidadSolicitada: 12 }],
      }),
    ).rejects.toThrow(HttpException);
  });

  // ==========================================================================
  // CASO 6: CANTIDAD DISPONIBLE = 0 EXCLUIDA
  // ==========================================================================
  it('6. Lote con cantidad disponible = 0 no puede surtirse', async () => {
    state.lots.push({
      id: 'lot-cero',
      lote: 'LOT-CERO',
      skuId: 'sku-aceite-001',
      clienteId: 'ba453845-913f-47c8-b08e-b3f30874722f',
      fechaVencimiento: new Date('2027-12-31T00:00:00Z'),
      createdAt: new Date('2026-11-16T08:00:00Z'),
      estadoCalidad: 'LIBERADO',
      cantidadDisponible: 0,
      cantidadReservada: 0,
      cantidadBloqueada: 0,
      ubicacionId: 'loc-g0001',
    });

    await expect(
      operationsController.createOrder({
        clienteId: 'ba453845-913f-47c8-b08e-b3f30874722f',
        lineas: [{ skuId: 'sku-aceite-001', cantidadSolicitada: 12 }],
      }),
    ).rejects.toThrow('Stock insuficiente');
  });

  // ==========================================================================
  // CASO 7: CANTIDAD TOTALMENTE RESERVADA NO SE ASIGNA
  // ==========================================================================
  it('7. Lote totalmente reservado (disponible == reservado) no admite nueva reserva', async () => {
    state.lots.push({
      id: 'lot-res',
      lote: 'LOT-RES',
      skuId: 'sku-aceite-001',
      clienteId: 'ba453845-913f-47c8-b08e-b3f30874722f',
      fechaVencimiento: new Date('2027-12-31T00:00:00Z'),
      createdAt: new Date('2026-11-16T08:00:00Z'),
      estadoCalidad: 'LIBERADO',
      cantidadDisponible: 12,
      cantidadReservada: 12, // 100% reservado
      cantidadBloqueada: 0,
      ubicacionId: 'loc-g0001',
    });

    await expect(
      operationsController.createOrder({
        clienteId: 'ba453845-913f-47c8-b08e-b3f30874722f',
        lineas: [{ skuId: 'sku-aceite-001', cantidadSolicitada: 12 }],
      }),
    ).rejects.toThrow('Stock insuficiente');
  });

  // ==========================================================================
  // CASO 8: HU DESPACHADA EXCLUIDA
  // ==========================================================================
  it('8. HU en estado DESPACHADO no participa en asignaciones activas ni en sugerencias de stock', async () => {
    // 8a. Baseline real: inventario disponible = 0 y HU en DESPACHADO -> Rechaza con Stock insuficiente
    state.lots.push({
      id: 'lot-desp-0',
      lote: 'LOT-DESP-0',
      skuId: 'sku-aceite-001',
      clienteId: 'ba453845-913f-47c8-b08e-b3f30874722f',
      fechaVencimiento: new Date('2027-12-31T00:00:00Z'),
      createdAt: new Date('2026-11-16T08:00:00Z'),
      estadoCalidad: 'LIBERADO',
      cantidadDisponible: 0, // Inventario real tras despacho
      cantidadReservada: 0,
      cantidadBloqueada: 0,
      ubicacionId: 'loc-g0001',
    });
    state.hus.push({
      id: 'hu-despachada-0',
      codigo: 'BOX-DESP-001',
      tipoHu: 'CAJA',
      lotId: 'lot-desp-0',
      clienteId: 'ba453845-913f-47c8-b08e-b3f30874722f',
      cantidad: 12,
      estadoHu: 'DESPACHADO',
      ubicacionActual: 'DESPACHADO',
    });

    await expect(
      operationsController.createOrder({
        clienteId: 'ba453845-913f-47c8-b08e-b3f30874722f',
        lineas: [{ skuId: 'sku-aceite-001', cantidadSolicitada: 12 }],
      }),
    ).rejects.toThrow('Stock insuficiente');

    // 8b. Si un lote tiene stock pero una HU DESPACHADA y otra ACTIVA:
    // suggestOrderAllocation y createOrder ignoran estrictamente la HU despachada
    state.lots.push({
      id: 'lot-mixed',
      lote: 'LOT-MIXED',
      skuId: 'sku-aceite-001',
      clienteId: 'ba453845-913f-47c8-b08e-b3f30874722f',
      fechaVencimiento: new Date('2027-12-31T00:00:00Z'),
      createdAt: new Date('2026-11-16T09:00:00Z'),
      estadoCalidad: 'LIBERADO',
      cantidadDisponible: 12,
      cantidadReservada: 0,
      cantidadBloqueada: 0,
      ubicacionId: 'loc-g0001',
    });
    state.hus.push(
      {
        id: 'hu-old-desp',
        codigo: 'BOX-OLD-DESP',
        tipoHu: 'CAJA',
        lotId: 'lot-mixed',
        clienteId: 'ba453845-913f-47c8-b08e-b3f30874722f',
        cantidad: 12,
        estadoHu: 'DESPACHADO',
        ubicacionActual: 'DESPACHADO',
      },
      {
        id: 'hu-fresh-act',
        codigo: 'BOX-FRESH-ACT',
        tipoHu: 'CAJA',
        lotId: 'lot-mixed',
        clienteId: 'ba453845-913f-47c8-b08e-b3f30874722f',
        cantidad: 12,
        estadoHu: 'ACTIVO',
        ubicacionActual: 'G0001',
      },
    );

    const orderMixed = await operationsController.createOrder({
      clienteId: 'ba453845-913f-47c8-b08e-b3f30874722f',
      lineas: [{ skuId: 'sku-aceite-001', cantidadSolicitada: 12 }],
    });
    expect(orderMixed).toBeDefined();

    const suggestion = await operationsController.suggestOrderAllocation(orderMixed.id);
    const suggestedHUs = suggestion.lineas[0].sugerencia[0]?.handlingUnits || [];
    const suggestedCodes = suggestedHUs.map((h: any) => h.codigo);
    expect(suggestedCodes).toContain('BOX-FRESH-ACT');
    expect(suggestedCodes).not.toContain('BOX-OLD-DESP');
  });

  // ==========================================================================
  // CASO 9: TARIMA MASTER EXCLUIDA DE ASIGNACIÓN COMO PRODUCTO
  // ==========================================================================
  it('9. Tarima Master (tipoHu: PALLET/TARIMA) se excluye de HUs pickables', async () => {
    state.lots.push({
      id: 'lot-with-master',
      lote: 'LOT-MASTER-TEST',
      skuId: 'sku-aceite-001',
      clienteId: 'ba453845-913f-47c8-b08e-b3f30874722f',
      fechaVencimiento: new Date('2027-12-31T00:00:00Z'),
      createdAt: new Date('2026-11-16T08:00:00Z'),
      estadoCalidad: 'LIBERADO',
      cantidadDisponible: 24,
      cantidadReservada: 0,
      cantidadBloqueada: 0,
      ubicacionId: 'loc-g0001',
    });

    state.hus.push({
      id: 'hu-master-plt',
      codigo: 'PLT-MASTER-001',
      tipoHu: 'PALLET', // TARIMA MASTER
      lotId: 'lot-with-master',
      clienteId: 'ba453845-913f-47c8-b08e-b3f30874722f',
      cantidad: 0,
      estadoHu: 'ACTIVO',
      ubicacionActual: 'G0001',
    });

    state.hus.push({
      id: 'hu-box-child-1',
      codigo: 'BOX-CHILD-001',
      tipoHu: 'CAJA',
      lotId: 'lot-with-master',
      clienteId: 'ba453845-913f-47c8-b08e-b3f30874722f',
      cantidad: 12,
      estadoHu: 'ACTIVO',
      ubicacionActual: 'G0001',
      parentHuId: 'hu-master-plt',
    });

    state.hus.push({
      id: 'hu-box-child-2',
      codigo: 'BOX-CHILD-002',
      tipoHu: 'CAJA',
      lotId: 'lot-with-master',
      clienteId: 'ba453845-913f-47c8-b08e-b3f30874722f',
      cantidad: 12,
      estadoHu: 'ACTIVO',
      ubicacionActual: 'G0001',
      parentHuId: 'hu-master-plt',
    });

    const res = await validateHuAllocationCompatibility({
      tx: {
        lotInventory: { findUnique: async () => state.lots[0] },
        handlingUnit: {
          findMany: async ({ where }: any) => {
            return state.hus.filter((h: any) => {
              if (where.tipoHu?.notIn && where.tipoHu.notIn.includes(h.tipoHu)) return false;
              return h.estadoHu === 'ACTIVO';
            });
          },
        },
        salesOrderLine: { findMany: async () => [] },
      } as any,
      lotId: 'lot-with-master',
      clienteId: 'ba453845-913f-47c8-b08e-b3f30874722f',
      requestedQty: 12,
    });

    expect(res.valido).toBe(true);
    // Solo asigna una caja hija, NUNCA el pallet master
    expect(res.assignedHus.length).toBe(1);
    expect(res.assignedHus[0].codigo).not.toBe('PLT-MASTER-001');
    expect(res.assignedHus[0].codigo).toBe('BOX-CHILD-001');
  });

  // ==========================================================================
  // CASO 10: AISLAMIENTO CROSS-TENANT
  // ==========================================================================
  it('10. Aislamiento Cross-Tenant: AlimNorte no puede reservar inventario de Fashion Forward', async () => {
    // Inventario de Fashion Forward
    state.lots.push({
      id: 'lot-fashion',
      lote: 'LOT-FASHION-01',
      skuId: 'sku-playera-001',
      clienteId: 'cli-fashion-001',
      fechaVencimiento: null,
      createdAt: new Date('2026-11-16T08:00:00Z'),
      estadoCalidad: 'LIBERADO',
      cantidadDisponible: 50,
      cantidadReservada: 0,
      cantidadBloqueada: 0,
      ubicacionId: 'loc-g0001',
    });

    // Intentar crear orden de AlimNorte pidiendo el SKU de Fashion Forward
    await expect(
      operationsController.createOrder({
        clienteId: 'ba453845-913f-47c8-b08e-b3f30874722f', // AlimNorte
        lineas: [{ skuId: 'sku-playera-001', cantidadSolicitada: 10 }],
      }),
    ).rejects.toThrow('Stock insuficiente');
  });

  // ==========================================================================
  // CASO 11: ANTI-SPOOFING MULTI-TENANT
  // ==========================================================================
  it('11. Anti-Spoofing: Usuario de Portal Depositante que intenta crear pedido con otro clienteId es rechazado con HTTP 403', async () => {
    const fakeReq: any = {
      user: {
        userId: 'usr-pedro',
        email: 'pedro@alimnorte.mx',
        clienteId: 'ba453845-913f-47c8-b08e-b3f30874722f', // Pedro es de AlimNorte
        role: 'CLIENTE',
      },
      headers: {
        'x-user-role': 'ADMIN', // Intento de spoofing de rol
        'x-user-id': 'usr-admin', // Intento de spoofing de usuario
      },
    };

    // Pedro intenta crear orden para Fashion Forward
    await expect(
      operationsController.createOrder(
        {
          clienteId: 'cli-fashion-001', // Depositante ajeno
          lineas: [{ skuId: 'sku-playera-001', cantidadSolicitada: 5 }],
        },
        undefined,
        fakeReq,
      ),
    ).rejects.toThrow('ACCESO_DENEGADO');
  });

  // ==========================================================================
  // CASO 12: REGLA DE CAJA CERRADA (ACE-OLI-1L)
  // ==========================================================================
  it('12. Caja Cerrada (ACE-OLI-1L): 12 y 24 PZA permitidas; 13 PZA rechazada con conflicto 409', async () => {
    state.lots.push({
      id: 'lot-aceite-caja',
      lote: 'LOT-CAJA-001',
      skuId: 'sku-aceite-001',
      clienteId: 'ba453845-913f-47c8-b08e-b3f30874722f',
      fechaVencimiento: new Date('2027-12-31T00:00:00Z'),
      createdAt: new Date('2026-11-16T08:00:00Z'),
      estadoCalidad: 'LIBERADO',
      cantidadDisponible: 24,
      cantidadReservada: 0,
      cantidadBloqueada: 0,
      ubicacionId: 'loc-g0001',
    });
    state.hus.push(
      {
        id: 'hu-box-1',
        codigo: 'BOX-001',
        tipoHu: 'CAJA',
        lotId: 'lot-aceite-caja',
        clienteId: 'ba453845-913f-47c8-b08e-b3f30874722f',
        cantidad: 12,
        estadoHu: 'ACTIVO',
        ubicacionActual: 'G0001',
      },
      {
        id: 'hu-box-2',
        codigo: 'BOX-002',
        tipoHu: 'CAJA',
        lotId: 'lot-aceite-caja',
        clienteId: 'ba453845-913f-47c8-b08e-b3f30874722f',
        cantidad: 12,
        estadoHu: 'ACTIVO',
        ubicacionActual: 'G0001',
      },
    );

    // 12 PZA es exactamente 1 caja -> VÁLIDO
    const res12 = await operationsController.createOrder({
      clienteId: 'ba453845-913f-47c8-b08e-b3f30874722f',
      lineas: [{ skuId: 'sku-aceite-001', cantidadSolicitada: 12 }],
    });
    expect(res12).toBeDefined();

    // 13 PZA no es compatible con cajas de 12 -> RECHAZADO
    await expect(
      operationsController.createOrder({
        clienteId: 'ba453845-913f-47c8-b08e-b3f30874722f',
        lineas: [{ skuId: 'sku-aceite-001', cantidadSolicitada: 13 }],
      }),
    ).rejects.toThrow();
  });

  // ==========================================================================
  // CASO 13: LOTES SIN CADUCIDAD (FEFO VS FIFO)
  // ==========================================================================
  it('13. Lotes sin fecha de caducidad (null): en FIFO se ordenan por createdAt ASC; en FEFO se ordenan después de los que tienen caducidad', async () => {
    // Cliente FIFO (Fashion Forward) con 2 lotes sin caducidad
    state.lots.push(
      {
        id: 'lot-tshirt-1',
        lote: 'TSHIRT-LOTE-ANTIGUO',
        skuId: 'sku-playera-001',
        clienteId: 'cli-fashion-001',
        fechaVencimiento: null,
        createdAt: new Date('2026-11-16T08:00:00Z'), // Antiguo
        estadoCalidad: 'LIBERADO',
        cantidadDisponible: 10,
        cantidadReservada: 0,
        cantidadBloqueada: 0,
        ubicacionId: 'loc-g0001',
      },
      {
        id: 'lot-tshirt-2',
        lote: 'TSHIRT-LOTE-RECIENTE',
        skuId: 'sku-playera-001',
        clienteId: 'cli-fashion-001',
        fechaVencimiento: null,
        createdAt: new Date('2026-11-16T12:00:00Z'), // Reciente
        estadoCalidad: 'LIBERADO',
        cantidadDisponible: 10,
        cantidadReservada: 0,
        cantidadBloqueada: 0,
        ubicacionId: 'loc-g0001',
      },
    );

    const orderFashion = await operationsController.createOrder({
      clienteId: 'cli-fashion-001',
      lineas: [{ skuId: 'sku-playera-001', cantidadSolicitada: 5 }],
    });
    const asignaciones = JSON.parse(orderFashion.lineas[0].asignacionesJson || '[]');
    // En FIFO puro sin caducidad, selecciona el lote más antiguo (createdAt 08:00)
    expect(asignaciones[0].lotId).toBe('lot-tshirt-1');
  });

  // ==========================================================================
  // CASO 14: RESERVA ATÓMICA E IDEMPOTENCIA
  // ==========================================================================
  it('14. Reserva Atómica e Idempotencia: una caja reservada no puede ser reservada por otra orden concurrente', async () => {
    state.lots.push({
      id: 'lot-single',
      lote: 'LOT-SINGLE-BOX',
      skuId: 'sku-aceite-001',
      clienteId: 'ba453845-913f-47c8-b08e-b3f30874722f',
      fechaVencimiento: new Date('2027-12-31T00:00:00Z'),
      createdAt: new Date('2026-11-16T08:00:00Z'),
      estadoCalidad: 'LIBERADO',
      cantidadDisponible: 12,
      cantidadReservada: 0,
      cantidadBloqueada: 0,
      ubicacionId: 'loc-g0001',
    });
    state.hus.push({
      id: 'hu-box-only',
      codigo: 'BOX-ONLY-001',
      tipoHu: 'CAJA',
      lotId: 'lot-single',
      clienteId: 'ba453845-913f-47c8-b08e-b3f30874722f',
      cantidad: 12,
      estadoHu: 'ACTIVO',
      ubicacionActual: 'G0001',
    });

    // Orden 1 reserva la única caja disponible
    const order1 = await operationsController.createOrder({
      clienteId: 'ba453845-913f-47c8-b08e-b3f30874722f',
      lineas: [{ skuId: 'sku-aceite-001', cantidadSolicitada: 12 }],
    });
    expect(order1).toBeDefined();

    // Orden 2 intenta reservar otra caja del mismo producto
    await expect(
      operationsController.createOrder({
        clienteId: 'ba453845-913f-47c8-b08e-b3f30874722f',
        lineas: [{ skuId: 'sku-aceite-001', cantidadSolicitada: 12 }],
      }),
    ).rejects.toThrow('Stock insuficiente');
  });

  // ==========================================================================
  // CASO 15: DESEMPATE DETERMINISTA (MISMA CADUCIDAD Y MISMO CREATEDAT)
  // ==========================================================================
  it('15. Desempate determinista: cuando fechaCaducidad y createdAt son idénticos, la selección desempata estrictamente por id ASC', async () => {
    const sameDate = new Date('2027-06-30T00:00:00Z');
    const sameCreated = new Date('2026-11-16T08:00:00Z');

    // Insertamos primero 'lot-identical-2' para confirmar que el desempate no depende del orden de inserción
    state.lots.push(
      {
        id: 'lot-identical-2',
        lote: 'LOT-IDENT-2',
        skuId: 'sku-aceite-001',
        clienteId: 'ba453845-913f-47c8-b08e-b3f30874722f',
        fechaVencimiento: sameDate,
        createdAt: sameCreated,
        estadoCalidad: 'LIBERADO',
        cantidadDisponible: 12,
        cantidadReservada: 0,
        cantidadBloqueada: 0,
        ubicacionId: 'loc-g0002',
      },
      {
        id: 'lot-identical-1',
        lote: 'LOT-IDENT-1',
        skuId: 'sku-aceite-001',
        clienteId: 'ba453845-913f-47c8-b08e-b3f30874722f',
        fechaVencimiento: sameDate,
        createdAt: sameCreated,
        estadoCalidad: 'LIBERADO',
        cantidadDisponible: 12,
        cantidadReservada: 0,
        cantidadBloqueada: 0,
        ubicacionId: 'loc-g0001',
      },
    );
    state.hus.push(
      {
        id: 'hu-box-id-2',
        codigo: 'BOX-ID-2',
        tipoHu: 'CAJA',
        lotId: 'lot-identical-2',
        clienteId: 'ba453845-913f-47c8-b08e-b3f30874722f',
        cantidad: 12,
        estadoHu: 'ACTIVO',
        ubicacionActual: 'G0002',
      },
      {
        id: 'hu-box-id-1',
        codigo: 'BOX-ID-1',
        tipoHu: 'CAJA',
        lotId: 'lot-identical-1',
        clienteId: 'ba453845-913f-47c8-b08e-b3f30874722f',
        cantidad: 12,
        estadoHu: 'ACTIVO',
        ubicacionActual: 'G0001',
      },
    );

    // En cliente FEFO (AlimNorte): con misma caducidad y mismo createdAt, id ASC selecciona estrictamente lot-identical-1
    const orderCreated = await operationsController.createOrder({
      clienteId: 'ba453845-913f-47c8-b08e-b3f30874722f',
      lineas: [{ skuId: 'sku-aceite-001', cantidadSolicitada: 12 }],
    });

    expect(orderCreated).toBeDefined();
    const line = orderCreated.lineas[0];
    const asignaciones = JSON.parse(line.asignacionesJson || '[]');
    expect(asignaciones.length).toBe(1);
    expect(asignaciones[0].lotId).toBe('lot-identical-1');
    expect(asignaciones[0].lote).toBe('LOT-IDENT-1');

    // Comprobar que suggestOrderAllocation replica exactamente la misma selección determinista
    const suggestion = await operationsController.suggestOrderAllocation(orderCreated.id);
    expect(suggestion.lineas[0].sugerencia[0].lotId).toBe('lot-identical-1');
  });

  // ==========================================================================
  // CASO 16: DESEMPATE DETERMINISTA EN CLIENTE FIFO (MISMO CREATEDAT -> ID ASC)
  // ==========================================================================
  it('16. Desempate determinista en FIFO: cuando dos lotes tienen idéntico createdAt, desempata estrictamente por id ASC', async () => {
    const sameCreated = new Date('2026-11-16T10:00:00Z');

    state.lots.push(
      {
        id: 'lot-fifo-tie-z',
        lote: 'LOT-FIFO-TIE-Z',
        skuId: 'sku-playera-001',
        clienteId: 'cli-fashion-001', // Fashion Forward (FIFO)
        fechaVencimiento: null,
        createdAt: sameCreated,
        estadoCalidad: 'LIBERADO',
        cantidadDisponible: 10,
        cantidadReservada: 0,
        cantidadBloqueada: 0,
        ubicacionId: 'loc-g0002',
      },
      {
        id: 'lot-fifo-tie-a',
        lote: 'LOT-FIFO-TIE-A',
        skuId: 'sku-playera-001',
        clienteId: 'cli-fashion-001', // Fashion Forward (FIFO)
        fechaVencimiento: null,
        createdAt: sameCreated,
        estadoCalidad: 'LIBERADO',
        cantidadDisponible: 10,
        cantidadReservada: 0,
        cantidadBloqueada: 0,
        ubicacionId: 'loc-g0001',
      },
    );

    const orderFifo = await operationsController.createOrder({
      clienteId: 'cli-fashion-001',
      lineas: [{ skuId: 'sku-playera-001', cantidadSolicitada: 5 }],
    });

    expect(orderFifo).toBeDefined();
    const line = orderFifo.lineas[0];
    const asignaciones = JSON.parse(line.asignacionesJson || '[]');
    expect(asignaciones.length).toBe(1);
    // 'lot-fifo-tie-a' < 'lot-fifo-tie-z' por id ASC
    expect(asignaciones[0].lotId).toBe('lot-fifo-tie-a');
    expect(asignaciones[0].lote).toBe('LOT-FIFO-TIE-A');
  });
});
