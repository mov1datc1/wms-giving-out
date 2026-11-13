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
import { MasterDataController } from '../master-data/master-data.controller';
import { ClientsController } from '../clients/clients.controller';
import { WmsAuthGuard } from '../auth/wms-auth.guard';
import { validateHuAllocationCompatibility, transferHuToStaging } from '../../common/picking-staging-transfer.util';
import { formatCalendarDate } from '../../../../wms-frontend/src/utils/dateUtils';
import { checkCitaVencida } from '../../../../wms-frontend/src/utils/order-sla.util';

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

function createInMemoryWms() {
  let seq = 1;
  const nextId = (prefix: string) => `${prefix}-${seq++}`;

  const warehouse = { id: 'wh-1', codigo: 'ALM-TEPOZ', nombre: 'Almacén Tepotzotlán' };
  const zoneInterior = { id: 'zone-int', codigo: 'INTERIOR', nombre: 'Interior', tipoZona: 'ALMACENAMIENTO', almacenId: warehouse.id };
  const zoneStaging = { id: 'zone-stg', codigo: 'STAGING', nombre: 'Staging', tipoZona: 'STAGING', almacenId: warehouse.id };

  const clientAlimNorte = {
    id: 'cli-alim',
    codigo: 'DEP-ALIMENTOS-01',
    nombreComercial: 'AlimNorte',
    razonSocial: 'AlimNorte S.A.',
    reglaInventario: 'FEFO',
    manejoInventario: 'CAJA',
    uomPrincipal: 'CAJA',
  };
  const endCustomerWalmart = {
    id: 'ec-walmart',
    codigo: 'WALMART-ALIMENTOS-01',
    nombre: 'Walmart México (CEDIS San Martín)',
    ciudad: 'Cuautitlán Izcalli',
    clienteId: clientAlimNorte.id,
    activo: true,
  };
  const skuAceite = {
    id: 'sku-ace',
    codigo: 'ACE-OLI-1L',
    descripcion: 'Aceite de Oliva Extra Virgen 1L',
    uomBase: 'PZA',
    capacidadEmpaque: 12,
    activo: true,
    codigoBarras: '750100000001',
  };

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
    ocupacion: 0,
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

  const lotOrigin: any = {
    id: 'lot-qa-001',
    skuId: skuAceite.id,
    clienteId: clientAlimNorte.id,
    lote: 'LOT-QA-E2E-001',
    fechaVencimiento: new Date('2027-06-30T06:00:00.000Z'),
    fechaProduccion: new Date('2026-06-30T06:00:00.000Z'),
    proveedorNombre: 'Proveedor Real',
    estadoCalidad: 'LIBERADO',
    cantidadDisponible: 24,
    cantidadReservada: 0,
    cantidadBloqueada: 0,
    ubicacionId: locG0001.id,
    notas: null,
    createdAt: new Date('2026-11-10T18:00:00.000Z'),
  };

  const state: any = {
    clients: [clientAlimNorte],
    endCustomers: [endCustomerWalmart],
    skus: [skuAceite],
    locations: [locG0001, locStg01],
    lots: [lotOrigin],
    hus: [
      {
        id: 'hu-plt-01',
        codigo: 'PLT-REC-2026-0020-01',
        tipoHu: 'PALLET',
        lotId: null,
        parentHuId: null,
        clienteId: clientAlimNorte.id,
        cantidad: 2,
        piezasPorCaja: null,
        uom: 'TARIMA',
        ubicacionActual: 'G0001',
        estadoHu: 'ACTIVO',
        loteTexto: null,
        skuCodigo: null,
      },
      {
        id: 'hu-box-01',
        codigo: 'BOX-REC-2026-0020-0001',
        tipoHu: 'CAJA',
        lotId: lotOrigin.id,
        parentHuId: 'hu-plt-01',
        clienteId: clientAlimNorte.id,
        cantidad: 12,
        piezasPorCaja: 12,
        uom: 'PZA',
        ubicacionActual: 'G0001',
        estadoHu: 'ACTIVO',
        loteTexto: 'LOT-QA-E2E-001',
        skuCodigo: 'ACE-OLI-1L',
      },
      {
        id: 'hu-box-02',
        codigo: 'BOX-REC-2026-0020-0002',
        tipoHu: 'CAJA',
        lotId: lotOrigin.id,
        parentHuId: 'hu-plt-01',
        clienteId: clientAlimNorte.id,
        cantidad: 12,
        piezasPorCaja: 12,
        uom: 'PZA',
        ubicacionActual: 'G0001',
        estadoHu: 'ACTIVO',
        loteTexto: 'LOT-QA-E2E-001',
        skuCodigo: 'ACE-OLI-1L',
      },
    ],
    orders: [],
    orderLines: [],
    movements: [],
    approvals: [],
    tracking: [],
    auditLogs: [],
  };

  const matchesWhere = (rec: any, where: any): boolean => {
    if (!where) return true;
    for (const [k, v] of Object.entries(where)) {
      if (v === undefined) continue;
      if (k === 'OR' && Array.isArray(v)) {
        if (!v.some((clause) => matchesWhere(rec, clause))) return false;
        continue;
      }
      if (k === 'orden' && typeof v === 'object' && v !== null) {
        const order = state.orders.find((o: any) => o.id === rec.orderId);
        if (!order || !matchesWhere(order, v)) return false;
        continue;
      }
      if (k === 'ubicacion' && typeof v === 'object' && v !== null) {
        const loc = state.locations.find((l: any) => l.id === rec.ubicacionId);
        if (!loc || !matchesWhere(loc, v)) return false;
        continue;
      }
      if (typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Date)) {
        const cond: any = v;
        if ('equals' in cond) {
          const a = rec[k];
          const b = cond.equals;
          if (cond.mode === 'insensitive') {
            if (String(a ?? '').toUpperCase() !== String(b ?? '').toUpperCase()) return false;
          } else if (a !== b) return false;
          continue;
        }
        if ('in' in cond) {
          if (!cond.in.map((x: any) => String(x).toUpperCase()).includes(String(rec[k] ?? '').toUpperCase())) {
            return false;
          }
          continue;
        }
        if ('notIn' in cond) {
          if (cond.notIn.map((x: any) => String(x).toUpperCase()).includes(String(rec[k] ?? '').toUpperCase())) {
            return false;
          }
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
        if ('startsWith' in cond) {
          if (!String(rec[k] || '').startsWith(cond.startsWith)) return false;
          continue;
        }
      }
      if (rec[k] !== v) return false;
    }
    return true;
  };

  const hydrateLot = (lot: any) => {
    if (!lot) return null;
    const ubicacion = state.locations.find((l: any) => l.id === lot.ubicacionId) || null;
    const sku = state.skus.find((s: any) => s.id === lot.skuId) || null;
    const cliente = state.clients.find((c: any) => c.id === lot.clienteId) || null;
    const handlingUnits = state.hus.filter((h: any) => h.lotId === lot.id);
    return { ...lot, ubicacion, sku, cliente, handlingUnits };
  };

  const hydrateHu = (hu: any) => {
    if (!hu) return null;
    return {
      ...hu,
      lote: hu.lotId ? hydrateLot(state.lots.find((l: any) => l.id === hu.lotId)) : null,
    };
  };

  const hydrateLine = (line: any) => {
    if (!line) return null;
    return {
      ...line,
      sku: state.skus.find((s: any) => s.id === line.skuId) || null,
      lote: line.lotId ? hydrateLot(state.lots.find((l: any) => l.id === line.lotId)) : null,
      orden: state.orders.find((o: any) => o.id === line.orderId) || null,
      hu: line.huId ? hydrateHu(state.hus.find((h: any) => h.id === line.huId)) : null,
    };
  };

  const hydrateOrder = (order: any) => {
    if (!order) return null;
    return {
      ...order,
      cliente: state.clients.find((c: any) => c.id === order.clienteId) || null,
      endCustomer: state.endCustomers.find((e: any) => e.id === order.endCustomerId) || null,
      lineas: state.orderLines.filter((l: any) => l.orderId === order.id).map(hydrateLine),
      trackingEvents: state.tracking.filter((t: any) => t.orderId === order.id),
      aprobaciones: state.approvals.filter((a: any) => a.orderId === order.id),
    };
  };

  const txLocks = new Set<string>();
  let txSeq = 1;
  const activeKeyOwner = new Map<string, number>();
  const keyWaiters = new Map<string, Array<() => void>>();

  const acquireKey = async (txId: number, key: string) => {
    while (activeKeyOwner.has(key) && activeKeyOwner.get(key) !== txId) {
      await new Promise<void>((resolve) => {
        const q = keyWaiters.get(key) || [];
        q.push(resolve);
        keyWaiters.set(key, q);
      });
    }
    activeKeyOwner.set(key, txId);
  };

  const releaseTxKeys = (txId: number) => {
    for (const [k, owner] of Array.from(activeKeyOwner.entries())) {
      if (owner === txId) {
        activeKeyOwner.delete(k);
        const q = keyWaiters.get(k);
        const nextWaiter = q?.shift();
        if (nextWaiter) nextWaiter();
      }
    }
  };

  const makeDbApi = (txId: number, undoFns: Array<() => void>): any => {
    const pushUndo = (fn: () => void) => {
      if (txId > 0) undoFns.push(fn);
    };
    const updateObj = (target: any, patch: Record<string, any>) => {
      const snap: Record<string, any> = {};
      for (const k of Object.keys(patch)) {
        snap[k] = target[k];
      }
      for (const [k, v] of Object.entries(patch)) {
        if (v && typeof v === 'object' && 'increment' in (v as any)) {
          target[k] = Number(target[k] || 0) + Number((v as any).increment);
        } else if (v && typeof v === 'object' && 'decrement' in (v as any)) {
          target[k] = Number(target[k] || 0) - Number((v as any).decrement);
        } else {
          target[k] = v;
        }
      }
      pushUndo(() => {
        for (const k of Object.keys(snap)) {
          target[k] = snap[k];
        }
      });
    };

    const api: any = {
      $executeRawUnsafe: jest.fn(async () => 0),
      $queryRawUnsafe: jest.fn(async (sql: string, id: string) => {
        if (sql.includes('FOR UPDATE')) {
          txLocks.add(id);
          if (txId > 0) await acquireKey(txId, id);
        }
        return [{ id }];
      }),
      $transaction: jest.fn(async (cb: any) => {
        const childTxId = txSeq++;
        const txUndo: Array<() => void> = [];
        const txClient = makeDbApi(childTxId, txUndo);
        try {
          return await cb(txClient);
        } catch (err) {
          while (txUndo.length > 0) {
            const undo = txUndo.pop();
            if (undo) undo();
          }
          throw err;
        } finally {
          releaseTxKeys(childTxId);
        }
      }),
      client: {
        findUnique: jest.fn(async ({ where }: any) => {
          const c = state.clients.find((x: any) => x.id === where.id) || null;
          if (!c) return null;
          return {
            ...c,
            endCustomers: state.endCustomers.filter((e: any) => e.clienteId === c.id),
            contactos: [],
            direccionesEntrega: [],
            _count: {
              skus: state.skus.length,
              ordenesSalida: state.orders.filter((o: any) => o.clienteId === c.id).length,
              recepciones: 0,
              endCustomers: state.endCustomers.filter((e: any) => e.clienteId === c.id).length,
              lotes: state.lots.filter((l: any) => l.clienteId === c.id).length,
              handlingUnits: state.hus.filter((h: any) => h.clienteId === c.id).length,
            },
          };
        }),
        findMany: jest.fn(async ({ where }: any) =>
          state.clients
            .filter((c: any) => !where || matchesWhere(c, where))
            .map((c: any) => ({
              ...c,
              endCustomers: state.endCustomers.filter((e: any) => e.clienteId === c.id),
              contactos: [],
              direccionesEntrega: [],
              _count: {
                skus: state.skus.length,
                ordenesSalida: state.orders.filter((o: any) => o.clienteId === c.id).length,
                recepciones: 0,
                endCustomers: state.endCustomers.filter((e: any) => e.clienteId === c.id).length,
                lotes: state.lots.filter((l: any) => l.clienteId === c.id).length,
              },
            })),
        ),
      },
      skuMaster: {
        findUnique: jest.fn(async ({ where }: any) => state.skus.find((s: any) => s.id === where.id) || null),
        findFirst: jest.fn(async ({ where }: any) => state.skus.find((s: any) => matchesWhere(s, where)) || null),
      },
      location: {
        findUnique: jest.fn(async ({ where, include }: any) => {
          const loc = state.locations.find((l: any) => l.id === where.id) || null;
          if (!loc) return null;
          if (include?.lotes) {
            return { ...loc, lotes: state.lots.filter((lt: any) => lt.ubicacionId === loc.id).map(hydrateLot) };
          }
          return loc;
        }),
        findFirst: jest.fn(async ({ where, include }: any) => {
          const loc = state.locations.find((l: any) => matchesWhere(l, where)) || null;
          if (!loc) return null;
          if (include?.lotes) {
            return { ...loc, lotes: state.lots.filter((lt: any) => lt.ubicacionId === loc.id).map(hydrateLot) };
          }
          return loc;
        }),
        findMany: jest.fn(async ({ where, include }: any) =>
          state.locations
            .filter((l: any) => !where || matchesWhere(l, where))
            .map((loc: any) =>
              include?.lotes
                ? { ...loc, lotes: state.lots.filter((lt: any) => lt.ubicacionId === loc.id).map(hydrateLot) }
                : loc,
            ),
        ),
        update: jest.fn(async ({ where, data }: any) => {
          const loc = state.locations.find((l: any) => l.id === where.id);
          updateObj(loc, data);
          return loc;
        }),
      },
      lotInventory: {
        findMany: jest.fn(async ({ where, include }: any) => {
          return state.lots
            .filter((l: any) => matchesWhere(l, where))
            .map((l: any) => {
              const hl = hydrateLot(l);
              if (include?.handlingUnits?.where) {
                hl.handlingUnits = state.hus.filter(
                  (h: any) => h.lotId === l.id && matchesWhere(h, include.handlingUnits.where),
                );
              }
              return hl;
            });
        }),
        findUnique: jest.fn(async ({ where }: any) => {
          const l = state.lots.find((x: any) => x.id === where.id);
          return l ? hydrateLot(l) : null;
        }),
        findFirst: jest.fn(async ({ where }: any) => {
          const l = state.lots.find((x: any) => matchesWhere(x, where));
          return l ? hydrateLot(l) : null;
        }),
        create: jest.fn(async ({ data }: any) => {
          const created = { id: nextId('lot'), ...data, createdAt: new Date() };
          state.lots.push(created);
          pushUndo(() => {
            const idx = state.lots.indexOf(created);
            if (idx >= 0) state.lots.splice(idx, 1);
          });
          return hydrateLot(created);
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const l = state.lots.find((x: any) => x.id === where.id);
          if (!l) throw new Error(`Lot ${where.id} not found`);
          updateObj(l, data);
          return hydrateLot(l);
        }),
      },
      handlingUnit: {
        findMany: jest.fn(async ({ where }: any) =>
          state.hus.filter((h: any) => matchesWhere(h, where)).map(hydrateHu),
        ),
        findFirst: jest.fn(async ({ where }: any) => {
          const h = state.hus.find((x: any) => matchesWhere(x, where));
          return h ? hydrateHu(h) : null;
        }),
        findUnique: jest.fn(async ({ where }: any) => {
          const h = state.hus.find((x: any) => x.id === where.id);
          return h ? hydrateHu(h) : null;
        }),
        count: jest.fn(async ({ where }: any) =>
          state.hus.filter((x: any) => matchesWhere(x, where)).length,
        ),
        update: jest.fn(async ({ where, data }: any) => {
          const h = state.hus.find((x: any) => x.id === where.id);
          updateObj(h, data);
          return hydrateHu(h);
        }),
      },
      salesOrder: {
        findMany: jest.fn(async ({ where }: any) =>
          state.orders.filter((o: any) => matchesWhere(o, where)).map(hydrateOrder),
        ),
        findFirst: jest.fn(async ({ where }: any) => {
          const o = state.orders.find((x: any) => matchesWhere(x, where));
          return o ? hydrateOrder(o) : null;
        }),
        findUnique: jest.fn(async ({ where }: any) => {
          const o = state.orders.find((x: any) => x.id === where.id);
          return o ? hydrateOrder(o) : null;
        }),
        create: jest.fn(async ({ data }: any) => {
          const { lineas, ...orderFields } = data;
          const createdOrder = { id: nextId('ord'), ...orderFields, createdAt: new Date() };
          state.orders.push(createdOrder);
          const createdLines: any[] = [];
          for (const l of lineas?.create || []) {
            const lineObj = {
              id: nextId('line'),
              orderId: createdOrder.id,
              cantidadPickeada: 0,
              pickingCompletado: false,
              ...l,
            };
            state.orderLines.push(lineObj);
            createdLines.push(lineObj);
          }
          pushUndo(() => {
            const oi = state.orders.indexOf(createdOrder);
            if (oi >= 0) state.orders.splice(oi, 1);
            for (const ln of createdLines) {
              const li = state.orderLines.indexOf(ln);
              if (li >= 0) state.orderLines.splice(li, 1);
            }
          });
          return hydrateOrder(createdOrder);
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const o = state.orders.find((x: any) => x.id === where.id);
          updateObj(o, data);
          return hydrateOrder(o);
        }),
      },
      salesOrderLine: {
        findMany: jest.fn(async ({ where }: any) =>
          state.orderLines.filter((l: any) => matchesWhere(l, where)).map(hydrateLine),
        ),
        findUnique: jest.fn(async ({ where }: any) => {
          const l = state.orderLines.find((x: any) => x.id === where.id);
          return l ? hydrateLine(l) : null;
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const l = state.orderLines.find((x: any) => x.id === where.id);
          updateObj(l, data);
          return hydrateLine(l);
        }),
      },
      inventoryMovement: {
        create: jest.fn(async ({ data }: any) => {
          const created = { id: nextId('mov'), ...data, fechaHora: new Date() };
          state.movements.push(created);
          pushUndo(() => {
            const idx = state.movements.indexOf(created);
            if (idx >= 0) state.movements.splice(idx, 1);
          });
          return created;
        }),
      },
      orderApproval: {
        create: jest.fn(async ({ data }: any) => {
          const created = { id: nextId('apr'), ...data, createdAt: new Date() };
          state.approvals.push(created);
          pushUndo(() => {
            const idx = state.approvals.indexOf(created);
            if (idx >= 0) state.approvals.splice(idx, 1);
          });
          return created;
        }),
      },
      dispatchTracking: {
        create: jest.fn(async ({ data }: any) => {
          const created = { id: nextId('trk'), ...data, createdAt: new Date() };
          state.tracking.push(created);
          pushUndo(() => {
            const idx = state.tracking.indexOf(created);
            if (idx >= 0) state.tracking.splice(idx, 1);
          });
          return created;
        }),
      },
      auditLog: {
        create: jest.fn(async ({ data }: any) => {
          const created = { id: nextId('aud'), ...data, createdAt: new Date() };
          state.auditLogs.push(created);
          pushUndo(() => {
            const idx = state.auditLogs.indexOf(created);
            if (idx >= 0) state.auditLogs.splice(idx, 1);
          });
          return created;
        }),
      },
    };
    return api;
  };

  const prismaMock: any = makeDbApi(0, []);

  const engine = new PutawayEngineService(prismaMock);
  const ctrl = new OperationsController(prismaMock, engine);
  return { state, prismaMock, engine, ctrl, txLocks };
}

describe('Block 3A — Hardening Picking, Reservas, Staging, Despacho, Idempotencia, RBAC y Fechas (Cases A–Z)', () => {
  const adminReq = { user: { id: 'u-admin', email: 'admin@givingout.com', nombre: 'Administrador' } };
  const supervisorReq = { user: { id: 'u-sup', email: 'supervisor@givingout.com', nombre: 'Ana García' } };
  const pickingReq = { user: { id: 'u-pick', email: 'picking@givingout.com', nombre: 'María López' } };
  const portalReq = {
    user: { id: 'u-pedro', email: 'pedro@alimnorte.mx', nombre: 'Pedro Ramírez', clienteId: 'cli-alim' },
  };

  it('Cases A–E: CreateOrder 12 PZA válido, 13 PZA y 1 PZA rechazados, reserva concurrente sin sobre-reserva, y rechazo de body.estado = DESPACHADO', async () => {
    const { state, ctrl, txLocks } = createInMemoryWms();

    // Case E: body.estado = DESPACHADO debe ser rechazado (y nunca crear orden despachada)
    await expect(
      ctrl.createOrder(
        {
          clienteId: 'cli-alim',
          endCustomerId: 'ec-walmart',
          estado: 'DESPACHADO',
          lineas: [{ skuId: 'sku-ace', cantidadSolicitada: 12 }],
        },
        undefined,
        portalReq,
      ),
    ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
    expect(state.orders).toHaveLength(0);

    // Case B & C: 13 PZA y 1 PZA rechazados para cliente manejoInventario=CAJA (solo cajas de 12 PZA)
    await expect(
      ctrl.createOrder(
        { clienteId: 'cli-alim', endCustomerId: 'ec-walmart', lineas: [{ skuId: 'sku-ace', cantidadSolicitada: 13 }] },
        undefined,
        adminReq,
      ),
    ).rejects.toMatchObject({ status: HttpStatus.CONFLICT });
    await expect(
      ctrl.createOrder(
        { clienteId: 'cli-alim', endCustomerId: 'ec-walmart', lineas: [{ skuId: 'sku-ace', cantidadSolicitada: 1 }] },
        undefined,
        adminReq,
      ),
    ).rejects.toMatchObject({ status: HttpStatus.CONFLICT });
    expect(state.lots[0].cantidadReservada).toBe(0);

    // Case A: CreateOrder 12 PZA válido -> estado SOLICITADO, reserva 12, excluye PLT-01 y registra actor real
    const ord1 = await ctrl.createOrder(
      {
        codigo: 'PED-QA-E2E-OUT-001',
        clienteId: 'cli-alim',
        endCustomerId: 'ec-walmart',
        usuario: 'usuario-spoofeado@fake.com',
        solicitadoPor: 'otro-spoof@fake.com',
        lineas: [{ skuId: 'sku-ace', cantidadSolicitada: 12 }],
      },
      undefined,
      { user: { email: 'supervisor@givingout.com', nombre: 'Ana García' } },
    );

    expect(ord1.estado).toBe('SOLICITADO');
    expect(ord1.solicitadoPor).toBe('supervisor@givingout.com'); // Case U
    expect(state.lots[0].cantidadDisponible).toBe(24);
    expect(state.lots[0].cantidadReservada).toBe(12);
    expect(txLocks.has('cli-alim')).toBe(true);
    expect(txLocks.has('lot-qa-001')).toBe(true);
    const allocJson = JSON.parse(ord1.lineas[0].asignacionesJson || '[]');
    expect(allocJson[0].husAsignadas.map((h: any) => h.codigo)).not.toContain('PLT-REC-2026-0020-01');

    // Case D: Reserva concurrente (dos órdenes más de 12 cuando solo quedan 12 disponibles -> máx 1 pasa, otra falla)
    const concurrentResults = await Promise.allSettled([
      ctrl.createOrder(
        { clienteId: 'cli-alim', endCustomerId: 'ec-walmart', lineas: [{ skuId: 'sku-ace', cantidadSolicitada: 12 }] },
        undefined,
        adminReq,
      ),
      ctrl.createOrder(
        { clienteId: 'cli-alim', endCustomerId: 'ec-walmart', lineas: [{ skuId: 'sku-ace', cantidadSolicitada: 12 }] },
        undefined,
        adminReq,
      ),
    ]);
    const fulfilled = concurrentResults.filter((r) => r.status === 'fulfilled');
    const rejected = concurrentResults.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(state.lots[0].cantidadReservada).toBe(24);
  });

  it('Case F: Tarima Master (PALLET / TARIMA / PLT-*) nunca se incluye en allocation, scan, recordPick ni transferHuToStaging', async () => {
    const { state, prismaMock, ctrl } = createInMemoryWms();
    // Caso adverso: incluso si la Tarima Master tuviera lotId o loteTexto asignado, debe ser excluida siempre
    state.hus[0].lotId = 'lot-qa-001';
    state.hus[0].loteTexto = 'LOT-QA-E2E-001';
    state.hus[0].skuCodigo = 'ACE-OLI-1L';

    const allocVal = await validateHuAllocationCompatibility({
      tx: prismaMock,
      lotId: 'lot-qa-001',
      clienteId: 'cli-alim',
      requestedQty: 2, // Si incluyera PLT-01 (cantidad 2), resolvería erróneamente como válido
    });
    expect(allocVal.valido).toBe(false);
    expect(allocVal.huCapacities).toEqual([12, 12]);

    const order = await ctrl.createOrder(
      { clienteId: 'cli-alim', endCustomerId: 'ec-walmart', lineas: [{ skuId: 'sku-ace', cantidadSolicitada: 12 }] },
      undefined,
      adminReq,
    );
    await ctrl.prepareOrder(
      order.id,
      {
        asignaciones: [
          { lineId: order.lineas[0].id, lotes: [{ lotId: 'lot-qa-001', cantidad: 12, lote: 'LOT-QA-E2E-001', ubicacionCodigo: 'G0001' }] },
        ],
      },
      supervisorReq,
    );

    const scanRes: any = await ctrl.validatePickingScan(order.id, {
      lineId: order.lineas[0].id,
      tipoScan: 'CAJA',
      codigoEscaneado: 'PLT-REC-2026-0020-01',
      ubicacionEsperada: 'G0001',
    });
    expect(scanRes.valid).toBe(false);
    expect(scanRes.codigoError).toBe('HU_CONTENEDOR_NO_PICKABLE');

    await expect(
      ctrl.recordPick(
        order.id,
        {
          lineId: order.lineas[0].id,
          cantidadPickeada: 12,
          ubicacionEscaneada: 'G0001',
          cajaEscaneada: 'PLT-REC-2026-0020-01',
        },
        pickingReq,
      ),
    ).rejects.toMatchObject({ status: HttpStatus.CONFLICT });

    await expect(
      transferHuToStaging(prismaMock, {
        orderId: order.id,
        lineId: order.lineas[0].id,
        huCode: 'PLT-REC-2026-0020-01',
        rackLocationCode: 'G0001',
        usuario: 'picking@givingout.com',
      }),
    ).rejects.toMatchObject({ status: HttpStatus.CONFLICT });
  });

  it('Cases G–L, O–U, Z: Ciclo completo 12 PZA (Prepare exacto -> RecordPick único/idempotente -> Staging -> Dispatch atómico/idempotente -> G0001 OCUPADO)', async () => {
    const { state, ctrl } = createInMemoryWms();

    const order = await ctrl.createOrder(
      {
        codigo: 'PED-QA-E2E-OUT-001',
        clienteId: 'cli-alim',
        endCustomerId: 'ec-walmart',
        fechaCompromiso: '2026-11-15',
        lineas: [{ skuId: 'sku-ace', cantidadSolicitada: 12 }],
      },
      undefined,
      supervisorReq,
    );
    const lineId = order.lineas[0].id;

    // Case O: PUT /orders/:id/status bypass a DESPACHADO / CONSOLIDADO / CANCELADO -> 409 rechazado
    for (const badStatus of ['CONSOLIDADO', 'DESPACHADO', 'ENTREGADO', 'CANCELADO']) {
      await expect(
        ctrl.updateOrderStatus(order.id, { estado: badStatus, usuario: 'spoof@x.com' }, supervisorReq),
      ).rejects.toMatchObject({ status: HttpStatus.CONFLICT });
    }

    // Case P: Dispatch antes de consolidar -> rechazado 409
    await expect(
      ctrl.dispatchOrder(order.id, { despachador: 'fake', choferNombre: 'Carlos', vehiculoPlaca: 'ABC-123' }, supervisorReq),
    ).rejects.toMatchObject({ status: HttpStatus.CONFLICT });

    // Case H: prepareOrder incompleto (6/12) -> rechazado 400
    await expect(
      ctrl.prepareOrder(
        order.id,
        { asignaciones: [{ lineId, lotes: [{ lotId: 'lot-qa-001', cantidad: 6 }] }] },
        supervisorReq,
      ),
    ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });

    // Case G: prepareOrder exacto 12/12 -> PASS (actor desde req.user, reserva se mantiene exacta en 12)
    const prepared = await ctrl.prepareOrder(
      order.id,
      {
        usuario: 'nombre-falso',
        asignaciones: [
          {
            lineId,
            lotes: [{ lotId: 'lot-qa-001', cantidad: 12, lote: 'LOT-QA-E2E-001', ubicacionCodigo: 'G0001' }],
          },
        ],
      },
      supervisorReq,
    );
    expect(prepared).toBeTruthy();
    expect(prepared!.estado).toBe('EN_PICKING');
    expect(prepared!.preparadoPor).toBe('supervisor@givingout.com');
    expect(state.lots[0].cantidadReservada).toBe(12);

    // Iniciar picking con actor real desde req.user
    const started: any = await ctrl.startPicking(order.id, { surtidor: 'surtidor-falso@evil.com' }, pickingReq);
    expect(started.order.surtidor).toBe('picking@givingout.com');

    // Case J: recordPick válido -> 1 movimiento TRASIEGO (G0001 -> STG-01), G0001 pasa a 12 disp / 0 res, STG-01 12 disp / 12 res
    const pick1: any = await ctrl.recordPick(
      order.id,
      {
        lineId,
        cantidadPickeada: 12,
        ubicacionEscaneada: 'G0001',
        cajaEscaneada: 'BOX-REC-2026-0020-0001',
        usuario: 'fake-picker',
      },
      pickingReq,
    );
    expect(pick1.success).toBe(true);
    expect(pick1.orderFullyPicked).toBe(true);
    expect(pick1.stagingLocationCodigo).toBe('STG-01');
    expect(state.movements).toHaveLength(1);
    expect(state.movements[0].tipoMovimiento).toBe('TRASIEGO');
    expect(state.movements[0].cantidad).toBe(12);
    expect(state.movements[0].usuario).toBe('picking@givingout.com');

    const g0001LotAfterPick = state.lots.find((l: any) => l.id === 'lot-qa-001');
    const stgLotAfterPick = state.lots.find((l: any) => l.ubicacionId === 'loc-stg01');
    expect(g0001LotAfterPick.cantidadDisponible).toBe(12);
    expect(g0001LotAfterPick.cantidadReservada).toBe(0);
    expect(stgLotAfterPick.cantidadDisponible).toBe(12);
    expect(stgLotAfterPick.cantidadReservada).toBe(12);
    expect(state.locations[0].estado).toBe('OCUPADO'); // Case L & Z: G0001 recalculada y sigue OCUPADO

    // Case I: prepareOrder repetido después de picking/consolidación -> rechazado 409
    await expect(
      ctrl.prepareOrder(
        order.id,
        { asignaciones: [{ lineId, lotes: [{ lotId: 'lot-qa-001', cantidad: 12 }] }] },
        supervisorReq,
      ),
    ).rejects.toMatchObject({ status: HttpStatus.CONFLICT });

    // Case K: mismo recordPick repetido -> idempotente (0 movimientos extra, 0 auditLogs extra, BOX-0002 intacto en G0001)
    const auditCountBeforeRetryPick = state.auditLogs.length;
    const pickRetry: any = await ctrl.recordPick(
      order.id,
      {
        lineId,
        cantidadPickeada: 12,
        ubicacionEscaneada: 'G0001',
        cajaEscaneada: 'BOX-REC-2026-0020-0001',
      },
      pickingReq,
    );
    expect(pickRetry.idempotent).toBe(true);
    expect(state.movements).toHaveLength(1);
    expect(state.auditLogs).toHaveLength(auditCountBeforeRetryPick);

    // Intentar surtir la segunda caja BOX-0002 en esa línea ya completada -> 409 LINEA_YA_COMPLETADA
    await expect(
      ctrl.recordPick(
        order.id,
        {
          lineId,
          cantidadPickeada: 12,
          ubicacionEscaneada: 'G0001',
          cajaEscaneada: 'BOX-REC-2026-0020-0002',
        },
        pickingReq,
      ),
    ).rejects.toMatchObject({ status: HttpStatus.CONFLICT });

    // Case Q: dispatchOrder correcto -> descuenta 12 exactas desde Staging, marca SOLO BOX-0001 a DESPACHADO, BOX-0002 ACTIVO en G0001
    const dispatchRes: any = await ctrl.dispatchOrder(
      order.id,
      {
        despachador: 'impostor@fake.com',
        choferNombre: 'Carlos Transportista',
        vehiculoPlaca: '99-GO-12',
        tipoTransporte: 'DIRECTO',
      },
      adminReq,
    );
    expect(dispatchRes.success).toBe(true);
    expect(dispatchRes.idempotent).toBe(false);
    expect(dispatchRes.totalPiezasDespachadas).toBe(12);
    expect(dispatchRes.order.despachador).toBe('admin@givingout.com'); // Case U
    expect(dispatchRes.order.estado).toBe('DESPACHADO');
    expect(dispatchRes.originLocationsSummary[0]).toMatchObject({
      codigo: 'G0001',
      estado: 'OCUPADO',
      remainingPieces: 12,
    });

    // Verificar HUs finales: BOX-0001 DESPACHADO, BOX-0002 ACTIVO en G0001, PLT-01 ACTIVO en G0001
    const box1 = state.hus.find((h: any) => h.codigo === 'BOX-REC-2026-0020-0001');
    const box2 = state.hus.find((h: any) => h.codigo === 'BOX-REC-2026-0020-0002');
    const plt1 = state.hus.find((h: any) => h.codigo === 'PLT-REC-2026-0020-01');
    expect(box1.estadoHu).toBe('DESPACHADO');
    expect(box2.estadoHu).toBe('ACTIVO');
    expect(box2.ubicacionActual).toBe('G0001');
    expect(plt1.estadoHu).toBe('ACTIVO');

    // Verificar Staging en 0 y G0001 con 12 disponibles / 0 reservadas / OCUPADO
    const stgLotAfterDispatch = state.lots.find((l: any) => l.ubicacionId === 'loc-stg01');
    const g0001LotAfterDispatch = state.lots.find((l: any) => l.id === 'lot-qa-001');
    expect(stgLotAfterDispatch.cantidadDisponible).toBe(0);
    expect(stgLotAfterDispatch.cantidadReservada).toBe(0);
    expect(g0001LotAfterDispatch.cantidadDisponible).toBe(12);
    expect(g0001LotAfterDispatch.cantidadReservada).toBe(0);
    expect(state.locations.find((l: any) => l.id === 'loc-g0001').estado).toBe('OCUPADO');

    // Verificar Case S & T: exactamente 1 SALIDA_PEDIDO, 1 DispatchTracking, 1 AuditLog ORDEN_DESPACHADA
    const salidaMovs = state.movements.filter((m: any) => m.tipoMovimiento === 'SALIDA_PEDIDO');
    const dispatchAudits = state.auditLogs.filter((a: any) => a.accion === 'ORDEN_DESPACHADA');
    expect(salidaMovs).toHaveLength(1);
    expect(salidaMovs[0].cantidad).toBe(12);
    expect(salidaMovs[0].usuario).toBe('admin@givingout.com');
    expect(state.tracking).toHaveLength(1);
    expect(dispatchAudits).toHaveLength(1);
    expect(dispatchAudits[0].usuario).toBe('admin@givingout.com');
    const firstDispatchDate = dispatchRes.order.fechaDespacho;

    // Case R: dispatchOrder repetido -> idempotente total, 0 cambios
    const dispatchRetry: any = await ctrl.dispatchOrder(
      order.id,
      { despachador: 'otra-persona', choferNombre: 'Otro', vehiculoPlaca: 'XX' },
      adminReq,
    );
    expect(dispatchRetry.alreadyDispatched).toBe(true);
    expect(dispatchRetry.idempotent).toBe(true);
    expect(state.lots.find((l: any) => l.id === 'lot-qa-001').cantidadDisponible).toBe(12);
    expect(state.orders[0].fechaDespacho).toEqual(firstDispatchDate);
    expect(state.orderLines[0].cantidadAsignada).toBe(12); // nunca vuelve a 0
    expect(state.movements.filter((m: any) => m.tipoMovimiento === 'SALIDA_PEDIDO')).toHaveLength(1);
    expect(state.tracking).toHaveLength(1);
    expect(state.auditLogs.filter((a: any) => a.accion === 'ORDEN_DESPACHADA')).toHaveLength(1);
    expect(box2.estadoHu).toBe('ACTIVO');
  });

  it('Cases M & N: rejectOrder transaccional e idempotente (1ra vez libera exacto / 2da no altera ni duplica; devuelve Staging si existía)', async () => {
    const { state, ctrl } = createInMemoryWms();
    const order = await ctrl.createOrder(
      { clienteId: 'cli-alim', endCustomerId: 'ec-walmart', lineas: [{ skuId: 'sku-ace', cantidadSolicitada: 12 }] },
      undefined,
      adminReq,
    );
    expect(state.lots[0].cantidadReservada).toBe(12);

    // 1er rechazo
    const rej1 = await ctrl.rejectOrder(order.id, { motivo: 'Cancelado por cliente', usuario: 'spoof' }, supervisorReq);
    expect(rej1.alreadyRejected).toBe(false);
    expect(state.lots[0].cantidadReservada).toBe(0);
    expect(state.approvals).toHaveLength(1);
    const rejAuditsAfter1 = state.auditLogs.filter((a: any) => a.accion === 'RECHAZAR_ORDEN');
    expect(rejAuditsAfter1).toHaveLength(1);
    expect(rejAuditsAfter1[0].usuario).toBe('supervisor@givingout.com');

    // 2do rechazo repetido -> idempotente, reservas quedan en 0 (no negativas), sin segundo AuditLog ni OrderApproval
    const rej2 = await ctrl.rejectOrder(order.id, { motivo: 'Reintento', usuario: 'spoof' }, supervisorReq);
    expect(rej2.alreadyRejected).toBe(true);
    expect(rej2.idempotent).toBe(true);
    expect(state.lots[0].cantidadReservada).toBe(0);
    expect(state.approvals).toHaveLength(1);
    expect(state.auditLogs.filter((a: any) => a.accion === 'RECHAZAR_ORDEN')).toHaveLength(1);

    // Rechazo cuando una caja ya fue trasladada a Staging debe devolverla íntegramente a G0001
    const orderStg = await ctrl.createOrder(
      { clienteId: 'cli-alim', endCustomerId: 'ec-walmart', lineas: [{ skuId: 'sku-ace', cantidadSolicitada: 12 }] },
      undefined,
      adminReq,
    );
    await ctrl.prepareOrder(
      orderStg.id,
      { asignaciones: [{ lineId: orderStg.lineas[0].id, lotes: [{ lotId: 'lot-qa-001', cantidad: 12 }] }] },
      supervisorReq,
    );
    await ctrl.recordPick(
      orderStg.id,
      {
        lineId: orderStg.lineas[0].id,
        cantidadPickeada: 12,
        ubicacionEscaneada: 'G0001',
        cajaEscaneada: 'BOX-REC-2026-0020-0001',
      },
      pickingReq,
    );
    const rejStg = await ctrl.rejectOrder(orderStg.id, { motivo: 'Cancela en rampa' }, supervisorReq);
    expect(rejStg.order.estado).toBe('RECHAZADO');
    const originLot = state.lots.find((l: any) => l.id === 'lot-qa-001');
    const stgLot = state.lots.find((l: any) => l.ubicacionId === 'loc-stg01');
    expect(originLot.cantidadDisponible).toBe(24);
    expect(originLot.cantidadReservada).toBe(0);
    expect(stgLot.cantidadDisponible).toBe(0);
    expect(stgLot.cantidadReservada).toBe(0);
    expect(state.hus.find((h: any) => h.codigo === 'BOX-REC-2026-0020-0001').ubicacionActual).toBe('G0001');
  });

  it('Cases V–X: RBAC Operador Picking vs Despacho, Portal multi-tenant y anti-spoofing x-user-role', async () => {
    const makeGuard = (role: string, permisos: { modulo: string; accion: string }[], clienteId: string | null = null) =>
      new WmsAuthGuard(
        {
          user: {
            findUnique: jest.fn(async () => ({
              id: `u-${role}`,
              email: `${role.toLowerCase().replace(/\s+/g, '')}@givingout.com`,
              nombre: role,
              activo: true,
              rolId: `r-${role}`,
              almacenId: 'wh-1',
              clienteId,
              rol: { nombre: role, nivel: role === 'Super Admin' ? 1 : 5, permisos },
            })),
          },
        } as any,
        new Reflector(),
      );

    const pickToken = jwt.sign({ userId: 'u-Operador Picking' }, JWT_SECRET);
    const pickHeaders = { authorization: `Bearer ${pickToken}`, 'x-user-role': 'Super Admin' };
    const pickGuard = makeGuard('Operador Picking', [
      { modulo: 'dashboard', accion: 'ver' },
      { modulo: 'picking', accion: 'ver' },
      { modulo: 'picking', accion: 'crear' },
      { modulo: 'despacho', accion: 'ver' },
      { modulo: 'despacho', accion: 'crear' },
      { modulo: 'inventario', accion: 'ver' },
      { modulo: 'inventario', accion: 'crear' },
    ]);

    // Operador Picking PUEDE surtir Picking
    for (const op of ['startPicking', 'validatePickingScan', 'recordPick', 'pickOrderItem', 'getOrders', 'getDispatchManifest'] as const) {
      await expect(pickGuard.canActivate(makeGuardContext(op, pickHeaders).context)).resolves.toBe(true);
    }

    // Operador Picking NO PUEDE preparar, aprobar, rechazar, despachar ni confirmar entrega (ni con x-user-role spoofeado)
    for (const op of ['prepareOrder', 'approveOrder', 'rejectOrder', 'dispatchOrder', 'confirmDelivery', 'updateOrderStatus'] as const) {
      await expect(pickGuard.canActivate(makeGuardContext(op, pickHeaders).context)).rejects.toMatchObject({
        status: HttpStatus.FORBIDDEN,
      });
    }

    // Portal Depositante -> 403 en todo staff Picking y Despacho
    const portalToken = jwt.sign({ userId: 'u-Depositante', clienteId: 'cli-alim' }, JWT_SECRET);
    const portalGuard = makeGuard(
      'Depositante',
      [
        { modulo: 'despacho', accion: 'ver' },
        { modulo: 'despacho', accion: 'crear' },
      ],
      'cli-alim',
    );
    for (const op of ['startPicking', 'recordPick', 'prepareOrder', 'dispatchOrder', 'confirmDelivery', 'getDispatchManifest'] as const) {
      await expect(
        portalGuard.canActivate(makeGuardContext(op, { authorization: `Bearer ${portalToken}` }).context),
      ).rejects.toMatchObject({ status: HttpStatus.FORBIDDEN });
    }
  });

  it('Case Y: Fechas calendar-day 2027-06-30 -> 30/06/2027 y SLA cita sin desfase -1 día', () => {
    expect(formatCalendarDate('2027-06-30')).toBe('30/06/2027');
    expect(formatCalendarDate('2027-06-30T00:00:00.000Z')).toBe('30/06/2027');
    expect(formatCalendarDate('2027-06-30T06:00:00.000Z')).toBe('30/06/2027');

    // Simular cita para el 2026-11-15T00:00:00.000Z consultada el 2026-11-14 a las 18:00 local -> aún NO vencida
    const refBefore = new Date(2026, 10, 14, 18, 0, 0);
    const slaOk = checkCitaVencida('2026-11-15T00:00:00.000Z', '09:00', 'EN_PICKING', refBefore);
    expect(slaOk.isVencida).toBe(false);

    // Mismo día 2026-11-15 antes de hora 09:00 -> NO vencida
    const refSameDayEarly = new Date(2026, 10, 15, 8, 30, 0);
    expect(checkCitaVencida('2026-11-15T00:00:00.000Z', '09:00', 'EN_PICKING', refSameDayEarly).isVencida).toBe(false);

    // Mismo día 2026-11-15 después de hora 09:00 -> vencida hoy
    const refSameDayLate = new Date(2026, 10, 15, 10, 0, 0);
    const slaExpired = checkCitaVencida('2026-11-15T00:00:00.000Z', '09:00', 'EN_PICKING', refSameDayLate);
    expect(slaExpired.isVencida).toBe(true);
    expect(slaExpired.badgeTexto).toContain('hoy');
  });

  it('Pruebas Puente AA: Aprobación integrada en prepareOrder registra OrderApproval único y preserva flujo pre-aprobado /approve', async () => {
    const { state, ctrl } = createInMemoryWms();

    // Camino 1 (UX oficial Panel de Preparación): SOLICITADO -> prepareOrder -> EN_PICKING con OrderApproval automático
    const ord1 = await ctrl.createOrder(
      { clienteId: 'cli-alim', endCustomerId: 'ec-walmart', lineas: [{ skuId: 'sku-ace', cantidadSolicitada: 12 }] },
      undefined,
      supervisorReq,
    );
    expect(ord1.estado).toBe('SOLICITADO');
    expect(state.approvals).toHaveLength(0);

    const prep1 = await ctrl.prepareOrder(
      ord1.id,
      { asignaciones: [{ lineId: ord1.lineas[0].id, lotes: [{ lotId: 'lot-qa-001', cantidad: 12 }] }] },
      supervisorReq,
    );
    expect(prep1!.estado).toBe('EN_PICKING');
    expect(prep1!.aprobado).toBe(true);
    expect(prep1!.aprobadoPor).toBe('supervisor@givingout.com');
    expect(state.approvals.filter((a: any) => a.orderId === ord1.id)).toHaveLength(1);
    expect(state.approvals.find((a: any) => a.orderId === ord1.id).estado).toBe('APROBADO');

    // Repreparación previa al picking NO debe duplicar OrderApproval
    await ctrl.prepareOrder(
      ord1.id,
      { asignaciones: [{ lineId: ord1.lineas[0].id, lotes: [{ lotId: 'lot-qa-001', cantidad: 12 }] }] },
      adminReq,
    );
    expect(state.approvals.filter((a: any) => a.orderId === ord1.id)).toHaveLength(1);

    // Camino 2 (API /approve opcional antes de prepare): SOLICITADO -> APROBADO (1 OrderApproval) -> prepareOrder preserva 1 OrderApproval
    const ord2 = await ctrl.createOrder(
      { clienteId: 'cli-alim', endCustomerId: 'ec-walmart', lineas: [{ skuId: 'sku-ace', cantidadSolicitada: 12 }] },
      undefined,
      portalReq,
    );
    const aprRes: any = await ctrl.approveOrder(ord2.id, { notas: 'Pre-aprobación formal Supervisor' }, supervisorReq);
    expect(aprRes.order.estado).toBe('APROBADO');
    expect(state.approvals.filter((a: any) => a.orderId === ord2.id)).toHaveLength(1);

    const prep2 = await ctrl.prepareOrder(
      ord2.id,
      { asignaciones: [{ lineId: ord2.lineas[0].id, lotes: [{ lotId: 'lot-qa-001', cantidad: 12 }] }] },
      adminReq,
    );
    expect(prep2!.estado).toBe('EN_PICKING');
    expect(prep2!.aprobadoPor).toBe('supervisor@givingout.com');
    expect(state.approvals.filter((a: any) => a.orderId === ord2.id)).toHaveLength(1);
  });

  it('Pruebas Puente AB–AC: Tarima Master 2 -> 1 tras salida parcial, cierre a DESPACHADO (cantidad=0) en última caja, G0001 LIBRE y 0 tarima fantasma', async () => {
    const { state, prismaMock, engine, ctrl } = createInMemoryWms();
    const masterDataCtrl = new MasterDataController(prismaMock, {} as any);
    const clientsCtrl = new ClientsController(prismaMock);

    // 1. Orden 1 (12 PZA -> BOX-REC-2026-0020-0001)
    const ord1 = await ctrl.createOrder(
      { codigo: 'PED-BRIDGE-3A', clienteId: 'cli-alim', endCustomerId: 'ec-walmart', lineas: [{ skuId: 'sku-ace', cantidadSolicitada: 12 }] },
      undefined,
      supervisorReq,
    );
    await ctrl.prepareOrder(
      ord1.id,
      { asignaciones: [{ lineId: ord1.lineas[0].id, lotes: [{ lotId: 'lot-qa-001', cantidad: 12 }] }] },
      supervisorReq,
    );
    await ctrl.startPicking(ord1.id, {}, pickingReq);
    await ctrl.recordPick(
      ord1.id,
      { lineId: ord1.lineas[0].id, cantidadPickeada: 12, ubicacionEscaneada: 'G0001', cajaEscaneada: 'BOX-REC-2026-0020-0001' },
      pickingReq,
    );
    await ctrl.dispatchOrder(ord1.id, { choferNombre: 'Carlos', vehiculoPlaca: 'NLX-1' }, adminReq);

    // Post salida parcial: BOX-0001 DESPACHADO, BOX-0002 ACTIVO, PLT-01 ACTIVO con cantidad actualizada 2 -> 1 en G0001
    const palletAfter3A = state.hus.find((h: any) => h.codigo === 'PLT-REC-2026-0020-01');
    expect(palletAfter3A.estadoHu).toBe('ACTIVO');
    expect(palletAfter3A.cantidad).toBe(1);
    expect(palletAfter3A.ubicacionActual).toBe('G0001');
    expect(state.locations.find((l: any) => l.codigo === 'G0001').estado).toBe('OCUPADO');

    // 2. Orden 2 (últimas 12 PZA -> BOX-REC-2026-0020-0002, simulación previa de Bloque 3B)
    const ord2 = await ctrl.createOrder(
      { codigo: 'PED-BRIDGE-3B', clienteId: 'cli-alim', endCustomerId: 'ec-walmart', lineas: [{ skuId: 'sku-ace', cantidadSolicitada: 12 }] },
      undefined,
      supervisorReq,
    );
    await ctrl.prepareOrder(
      ord2.id,
      { asignaciones: [{ lineId: ord2.lineas[0].id, lotes: [{ lotId: 'lot-qa-001', cantidad: 12 }] }] },
      supervisorReq,
    );
    await ctrl.startPicking(ord2.id, {}, pickingReq);
    await ctrl.recordPick(
      ord2.id,
      { lineId: ord2.lineas[0].id, cantidadPickeada: 12, ubicacionEscaneada: 'G0001', cajaEscaneada: 'BOX-REC-2026-0020-0002' },
      pickingReq,
    );

    // Al salir la última caja física de G0001 hacia Staging, G0001 se libera sin tarima fantasma
    expect(state.locations.find((l: any) => l.codigo === 'G0001').estado).toBe('LIBRE');

    const disp2: any = await ctrl.dispatchOrder(ord2.id, { choferNombre: 'Carlos', vehiculoPlaca: 'NLX-2' }, adminReq);
    expect(disp2.success).toBe(true);
    expect(disp2.totalPiezasDespachadas).toBe(12);
    expect(disp2.originLocationsSummary.find((l: any) => l.codigo === 'G0001')).toMatchObject({
      codigo: 'G0001',
      estado: 'LIBRE',
      estadoCapacidad: 'LIBRE',
      remainingPieces: 0,
      remainingBultos: 0,
    });

    // Idempotencia al re-despachar orden 2
    const disp2Retry: any = await ctrl.dispatchOrder(ord2.id, { choferNombre: 'Carlos' }, adminReq);
    expect(disp2Retry.alreadyDispatched).toBe(true);
    expect(disp2Retry.idempotent).toBe(true);

    // Verificar PLT-REC-2026-0020-01 cerrada limpiamente a DESPACHADO con cantidad=0 (preservando vínculo histórico parentHuId)
    const palletAfter3B = state.hus.find((h: any) => h.codigo === 'PLT-REC-2026-0020-01');
    const box2After3B = state.hus.find((h: any) => h.codigo === 'BOX-REC-2026-0020-0002');
    expect(box2After3B.estadoHu).toBe('DESPACHADO');
    expect(box2After3B.parentHuId).toBe(palletAfter3B.id);
    expect(palletAfter3B.estadoHu).toBe('DESPACHADO');
    expect(palletAfter3B.cantidad).toBe(0);

    // Verificar consumidores globales: Locations, Location Detail y Clients => 0 PZA, G0001 LIBRE, 0 bultos, 0 tarima fantasma
    const locsAfter3B: any[] = await masterDataCtrl.getLocations();
    const g1Card = locsAfter3B.find((l: any) => l.codigo === 'G0001');
    expect(g1Card.estado).toBe('LIBRE');
    expect(g1Card.estadoCapacidad).toBe('LIBRE');
    expect(g1Card.ocupacionBultos).toBe(0);
    expect(g1Card.ocupacionUnidades).toBe(0);
    expect(g1Card.bultosPorCliente['cli-alim'] || 0).toBe(0);

    const g1Detail: any = await masterDataCtrl.getLocationById('G0001');
    expect(g1Detail.ocupacionBultos).toBe(0);
    expect(g1Detail.totalFisico).toBe(0);
    expect(g1Detail.handlingUnits).toHaveLength(0);

    const clientsAfter3B: any[] = await clientsCtrl.getClients();
    const alimStats = clientsAfter3B.find((c: any) => c.id === 'cli-alim')!.stats;
    expect(alimStats.totalTarimas).toBe(0);
    expect(alimStats.totalCajas).toBe(0);

    // AC. Defensa en profundidad: incluso si un registro legado de Tarima Master quedara ACTIVO en G0001 sin hijas activas,
    // ningún calculador de ubicación, putaway ni depositante genera tarima fantasma.
    palletAfter3B.estadoHu = 'ACTIVO';
    palletAfter3B.cantidad = 2;
    palletAfter3B.ubicacionActual = 'G0001';
    const recalcOrphan = await engine.recalculateLocationState(prismaMock, 'loc-g0001');
    expect(recalcOrphan.nuevoEstado).toBe('LIBRE');
    expect(recalcOrphan.ocupacionBultos).toBe(0);
    const locsOrphan: any[] = await masterDataCtrl.getLocations();
    expect(locsOrphan.find((l: any) => l.codigo === 'G0001')!.ocupacionBultos).toBe(0);
    const clientsOrphan: any[] = await clientsCtrl.getClients();
    expect(clientsOrphan.find((c: any) => c.id === 'cli-alim')!.stats.totalTarimas).toBe(0);
  });
});

