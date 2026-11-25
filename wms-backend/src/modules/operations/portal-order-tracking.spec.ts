jest.mock('../../prisma.service', () => ({
  PrismaService: class MockPrismaService {},
}));
jest.mock('../../email.service', () => ({
  EmailService: class MockEmailService {},
}));

import { OperationsController } from './operations.controller';
import { PutawayEngineService } from './putaway-engine.service';
import {
  PORTAL_FOCUS_THROTTLE_MS,
  PORTAL_POLL_INTERVAL_MS,
  PORTAL_TIMELINE_STEPS,
  filterPortalOrders,
  getPortalDashboardBadgeClass,
  getPortalLineAssignedQty,
  getPortalOrderCounts,
  getPortalOrderStatusMeta,
  getPortalRejectionBanner,
  getPortalTimelineState,
} from '../../../../wms-frontend/src/utils/portalOrderTracking';

function createInMemoryPortalFlowWms() {
  let seq = 1;
  const nextId = (prefix: string) => `${prefix}-${seq++}`;

  const warehouse = { id: 'wh-1', codigo: 'ALM-TEPOZ', nombre: 'Almacén Tepotzotlán' };
  const zoneInterior = { id: 'zone-int', codigo: 'INTERIOR', nombre: 'Interior', tipoZona: 'ALMACENAMIENTO', almacenId: warehouse.id };
  const zoneStaging = { id: 'zone-stg', codigo: 'STAGING', nombre: 'Staging', tipoZona: 'STAGING', almacenId: warehouse.id };

  const clientAlim = {
    id: 'cli-alim',
    codigo: 'DEP-ALIMENTOS-01',
    nombreComercial: 'AlimNorte',
    razonSocial: 'AlimNorte S.A.',
    reglaInventario: 'FEFO',
    manejoInventario: 'CAJA',
    uomPrincipal: 'CAJA',
  };
  const endCustomer = {
    id: 'ec-walmart',
    codigo: 'WALMART-01',
    nombre: 'Walmart CEDIS',
    ciudad: 'Cuautitlán Izcalli',
    calle: 'Autopista México-Querétaro Km 37',
    clienteId: clientAlim.id,
    activo: true,
  };
  const skuAceite = {
    id: 'sku-ace',
    codigo: 'ACE-OLI-1L',
    descripcion: 'Aceite de Oliva Extra Virgen 1L',
    uomBase: 'PZA',
    capacidadEmpaque: 12,
    activo: true,
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
    id: 'lot-portal-001',
    skuId: skuAceite.id,
    clienteId: clientAlim.id,
    lote: 'LOT-PORTAL-TEST-01',
    fechaVencimiento: new Date('2028-06-30T00:00:00.000Z'),
    estadoCalidad: 'LIBERADO',
    cantidadDisponible: 24,
    cantidadReservada: 0,
    cantidadBloqueada: 0,
    ubicacionId: locG0001.id,
    createdAt: new Date('2026-11-10T12:00:00.000Z'),
  };

  const state: any = {
    clients: [clientAlim],
    endCustomers: [endCustomer],
    skus: [skuAceite],
    locations: [locG0001, locStg01],
    lots: [lotOrigin],
    hus: [
      {
        id: 'hu-box-1',
        codigo: 'BOX-PORTAL-0001',
        tipoHu: 'CAJA',
        lotId: lotOrigin.id,
        parentHuId: null,
        clienteId: clientAlim.id,
        cantidad: 12,
        piezasPorCaja: 12,
        uom: 'PZA',
        ubicacionActual: 'G0001',
        estadoHu: 'ACTIVO',
        loteTexto: 'LOT-PORTAL-TEST-01',
        skuCodigo: 'ACE-OLI-1L',
      },
      {
        id: 'hu-box-2',
        codigo: 'BOX-PORTAL-0002',
        tipoHu: 'CAJA',
        lotId: lotOrigin.id,
        parentHuId: null,
        clienteId: clientAlim.id,
        cantidad: 12,
        piezasPorCaja: 12,
        uom: 'PZA',
        ubicacionActual: 'G0001',
        estadoHu: 'ACTIVO',
        loteTexto: 'LOT-PORTAL-TEST-01',
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
        const ord = state.orders.find((o: any) => o.id === rec.orderId);
        if (!ord || !matchesWhere(ord, v)) return false;
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
    return {
      ...lot,
      ubicacion: state.locations.find((l: any) => l.id === lot.ubicacionId) || null,
      sku: state.skus.find((s: any) => s.id === lot.skuId) || null,
      cliente: state.clients.find((c: any) => c.id === lot.clienteId) || null,
      handlingUnits: state.hus.filter((h: any) => h.lotId === lot.id),
    };
  };

  const hydrateLine = (line: any) => {
    if (!line) return null;
    return {
      ...line,
      sku: state.skus.find((s: any) => s.id === line.skuId) || null,
      lote: line.lotId ? hydrateLot(state.lots.find((l: any) => l.id === line.lotId)) : null,
      orden: state.orders.find((o: any) => o.id === line.orderId) || null,
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

  const prismaMock: any = {
    $executeRawUnsafe: jest.fn(async () => 0),
    $queryRawUnsafe: jest.fn(async () => [{ id: 'lock' }]),
    $transaction: jest.fn(async (cb: any) => cb(prismaMock)),
    client: {
      findUnique: jest.fn(async ({ where }: any) => state.clients.find((c: any) => c.id === where.id) || null),
    },
    skuMaster: {
      findUnique: jest.fn(async ({ where }: any) => state.skus.find((s: any) => s.id === where.id) || null),
    },
    location: {
      findUnique: jest.fn(async ({ where }: any) => state.locations.find((l: any) => l.id === where.id || l.codigo === where.codigo) || null),
      findFirst: jest.fn(async ({ where }: any) => state.locations.find((l: any) => matchesWhere(l, where)) || null),
      findMany: jest.fn(async ({ where }: any) => state.locations.filter((l: any) => matchesWhere(l, where))),
      update: jest.fn(async ({ where, data }: any) => {
        const loc = state.locations.find((l: any) => l.id === where.id);
        if (loc) Object.assign(loc, data);
        return loc;
      }),
    },
    lotInventory: {
      findMany: jest.fn(async ({ where }: any) => state.lots.filter((l: any) => matchesWhere(l, where)).map(hydrateLot)),
      findUnique: jest.fn(async ({ where }: any) => {
        const found = state.lots.find((l: any) => l.id === where.id);
        return found ? hydrateLot(found) : null;
      }),
      findFirst: jest.fn(async ({ where }: any) => {
        const found = state.lots.find((l: any) => matchesWhere(l, where));
        return found ? hydrateLot(found) : null;
      }),
      create: jest.fn(async ({ data }: any) => {
        const created = {
          id: nextId('lot'),
          cantidadDisponible: 0,
          cantidadReservada: 0,
          cantidadBloqueada: 0,
          createdAt: new Date(),
          ...data,
        };
        state.lots.push(created);
        return hydrateLot(created);
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const lot = state.lots.find((l: any) => l.id === where.id);
        if (!lot) throw new Error('Lot not found');
        if (data.cantidadDisponible?.increment !== undefined) lot.cantidadDisponible += data.cantidadDisponible.increment;
        else if (data.cantidadDisponible?.decrement !== undefined) lot.cantidadDisponible -= data.cantidadDisponible.decrement;
        else if (typeof data.cantidadDisponible === 'number') lot.cantidadDisponible = data.cantidadDisponible;

        if (data.cantidadReservada?.increment !== undefined) lot.cantidadReservada += data.cantidadReservada.increment;
        else if (data.cantidadReservada?.decrement !== undefined) lot.cantidadReservada -= data.cantidadReservada.decrement;
        else if (typeof data.cantidadReservada === 'number') lot.cantidadReservada = data.cantidadReservada;

        if (data.ubicacionId !== undefined) lot.ubicacionId = data.ubicacionId;
        return hydrateLot(lot);
      }),
    },
    handlingUnit: {
      findMany: jest.fn(async ({ where }: any) =>
        state.hus
          .filter((h: any) => matchesWhere(h, where))
          .map((h: any) => ({ ...h, lote: h.lotId ? hydrateLot(state.lots.find((l: any) => l.id === h.lotId)) : null })),
      ),
      findFirst: jest.fn(async ({ where }: any) => {
        const found = state.hus.find((h: any) => matchesWhere(h, where));
        if (!found) return null;
        return { ...found, lote: found.lotId ? hydrateLot(state.lots.find((l: any) => l.id === found.lotId)) : null };
      }),
      findUnique: jest.fn(async ({ where }: any) => {
        const found = state.hus.find((h: any) => h.id === where.id);
        if (!found) return null;
        return { ...found, lote: found.lotId ? hydrateLot(state.lots.find((l: any) => l.id === found.lotId)) : null };
      }),
      count: jest.fn(async ({ where }: any) => state.hus.filter((h: any) => matchesWhere(h, where)).length),
      update: jest.fn(async ({ where, data }: any) => {
        const hu = state.hus.find((h: any) => h.id === where.id);
        if (hu) Object.assign(hu, data);
        return hu;
      }),
    },
    salesOrder: {
      findMany: jest.fn(async ({ where }: any) =>
        state.orders.filter((o: any) => matchesWhere(o, where)).map(hydrateOrder),
      ),
      findFirst: jest.fn(async ({ where }: any) => {
        const found = state.orders.find((o: any) => matchesWhere(o, where));
        return found ? hydrateOrder(found) : null;
      }),
      findUnique: jest.fn(async ({ where }: any) => {
        const found = state.orders.find((o: any) => o.id === where.id);
        return found ? hydrateOrder(found) : null;
      }),
      create: jest.fn(async ({ data }: any) => {
        const ordId = nextId('ord');
        const { lineas, ...rest } = data;
        const created = {
          id: ordId,
          aprobado: false,
          aprobadoPor: null,
          fechaAprobacion: null,
          motivoRechazo: null,
          estadoEntrega: null,
          fechaEntrega: null,
          nombreReceptor: null,
          createdAt: new Date(),
          ...rest,
        };
        state.orders.push(created);
        for (const l of lineas?.create || []) {
          state.orderLines.push({
            id: nextId('line'),
            orderId: ordId,
            cantidadAsignada: 0,
            cantidadPickeada: 0,
            pickingCompletado: false,
            huId: null,
            cajaEscaneada: null,
            ubicacionEscaneada: null,
            ...l,
          });
        }
        return hydrateOrder(created);
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const ord = state.orders.find((o: any) => o.id === where.id);
        if (!ord) throw new Error('Order not found');
        Object.assign(ord, data);
        return hydrateOrder(ord);
      }),
    },
    salesOrderLine: {
      findMany: jest.fn(async ({ where }: any) =>
        state.orderLines.filter((l: any) => matchesWhere(l, where)).map(hydrateLine),
      ),
      findUnique: jest.fn(async ({ where }: any) => {
        const found = state.orderLines.find((l: any) => l.id === where.id);
        return found ? hydrateLine(found) : null;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const line = state.orderLines.find((l: any) => l.id === where.id);
        if (line) Object.assign(line, data);
        return hydrateLine(line);
      }),
    },
    orderApproval: {
      create: jest.fn(async ({ data }: any) => {
        const rec = { id: nextId('apr'), createdAt: new Date(), ...data };
        state.approvals.push(rec);
        return rec;
      }),
    },
    dispatchTracking: {
      findFirst: jest.fn(async ({ where }: any) => state.tracking.find((t: any) => matchesWhere(t, where)) || null),
      create: jest.fn(async ({ data }: any) => {
        const rec = { id: nextId('trk'), createdAt: new Date(), ...data };
        state.tracking.push(rec);
        return rec;
      }),
    },
    inventoryMovement: {
      create: jest.fn(async ({ data }: any) => {
        const rec = { id: nextId('mov'), createdAt: new Date(), ...data };
        state.movements.push(rec);
        return rec;
      }),
    },
    auditLog: {
      create: jest.fn(async ({ data }: any) => {
        const rec = { id: nextId('aud'), createdAt: new Date(), ...data };
        state.auditLogs.push(rec);
        return rec;
      }),
    },
  };

  const engine = new PutawayEngineService(prismaMock);
  const ctrl = new OperationsController(prismaMock, engine);
  return { state, ctrl };
}

describe('Portal del Depositante — Seguimiento Visual Progresivo y Estados Negativos', () => {
  it('1. Mapea exactamente los 9 estados canónicos de backend hacia las 6 etapas visuales del Timeline', () => {
    expect(PORTAL_TIMELINE_STEPS.map((s) => s.label)).toEqual([
      'Solicitado',
      'Aprobado',
      'Preparando',
      'Listo',
      'Enviado',
      'Entregado',
    ]);

    const cases: Array<{
      estado: string;
      expectedStep: number;
      visible: boolean;
      activeLabel: string | null;
      badgeCls: string;
      hasReservedStock: boolean;
      isDispatched: boolean;
    }> = [
      { estado: 'SOLICITADO', expectedStep: 1, visible: true, activeLabel: 'Solicitado', badgeCls: 'info', hasReservedStock: true, isDispatched: false },
      { estado: 'PENDIENTE_APROBACION', expectedStep: 1, visible: true, activeLabel: 'Solicitado', badgeCls: 'warning', hasReservedStock: true, isDispatched: false },
      { estado: 'APROBADO', expectedStep: 2, visible: true, activeLabel: 'Aprobado', badgeCls: 'success', hasReservedStock: true, isDispatched: false },
      { estado: 'EN_PICKING', expectedStep: 3, visible: true, activeLabel: 'Preparando', badgeCls: 'warning', hasReservedStock: true, isDispatched: false },
      { estado: 'CONSOLIDADO', expectedStep: 4, visible: true, activeLabel: 'Listo', badgeCls: 'info', hasReservedStock: true, isDispatched: false },
      { estado: 'DESPACHADO', expectedStep: 5, visible: true, activeLabel: 'Enviado', badgeCls: 'warning', hasReservedStock: false, isDispatched: true },
      { estado: 'ENTREGADO', expectedStep: 6, visible: true, activeLabel: 'Entregado', badgeCls: 'success', hasReservedStock: false, isDispatched: true },
      { estado: 'RECHAZADO', expectedStep: 0, visible: false, activeLabel: null, badgeCls: 'danger', hasReservedStock: false, isDispatched: false },
      { estado: 'CANCELADO', expectedStep: 0, visible: false, activeLabel: null, badgeCls: 'default', hasReservedStock: false, isDispatched: false },
    ];

    for (const c of cases) {
      const meta = getPortalOrderStatusMeta(c.estado);
      const timeline = getPortalTimelineState(c.estado);

      expect(meta.step).toBe(c.expectedStep);
      expect(meta.cls).toBe(c.badgeCls);
      expect(meta.hasReservedStock).toBe(c.hasReservedStock);
      expect(meta.isDispatched).toBe(c.isDispatched);

      expect(timeline.visible).toBe(c.visible);
      expect(timeline.currentStep).toBe(c.expectedStep);
      expect(timeline.activeLabel).toBe(c.activeLabel);

      if (c.visible) {
        const expectedStatuses = PORTAL_TIMELINE_STEPS.map((s) =>
          s.num < c.expectedStep ? 'completed' : s.num === c.expectedStep ? 'active' : 'pending',
        );
        expect(timeline.steps.map((s) => s.status)).toEqual(expectedStatuses);
        expect(timeline.steps.map((s) => s.connectorActive)).toEqual(
          PORTAL_TIMELINE_STEPS.map((s) => s.num < c.expectedStep),
        );
      } else {
        expect(timeline.steps.every((s) => s.status === 'pending' && !s.connectorActive)).toBe(true);
      }
    }
  });

  it('2. Corrige RECHAZADO / CANCELADO: tokens danger, 0 real en Reservado/Asignado sin fallback a cantidadSolicitada, motivo y contadores', () => {
    // Nunca usa 'error' (inexistente en index.css); usa 'danger'
    expect(getPortalOrderStatusMeta('RECHAZADO').cls).toBe('danger');
    expect(getPortalDashboardBadgeClass('RECHAZADO')).toBe('danger');
    expect(getPortalOrderStatusMeta('CANCELADO').cls).toBe('default');
    expect(getPortalDashboardBadgeClass('CANCELADO')).toBe('default');

    // Reservado/Asignado: sin fallback a cantidadSolicitada cuando cantidadAsignada = 0
    expect(getPortalLineAssignedQty('SOLICITADO', { cantidadSolicitada: 12, cantidadAsignada: 0 })).toBe(0);
    expect(getPortalLineAssignedQty('APROBADO', { cantidadSolicitada: 12, cantidadAsignada: 0 })).toBe(0);
    expect(getPortalLineAssignedQty('APROBADO', { cantidadSolicitada: 12, cantidadAsignada: 12 })).toBe(12);
    expect(getPortalLineAssignedQty('RECHAZADO', { cantidadSolicitada: 12, cantidadAsignada: 0 })).toBe(0);
    expect(getPortalLineAssignedQty('RECHAZADO', { cantidadSolicitada: 12, cantidadAsignada: 12 })).toBe(0);
    expect(getPortalLineAssignedQty('CANCELADO', { cantidadSolicitada: 24, cantidadAsignada: 0 })).toBe(0);
    expect(getPortalLineAssignedQty('CANCELADO', { cantidadSolicitada: 24, cantidadAsignada: 24 })).toBe(0);

    // Banner de motivo tanto en RECHAZADO como en CANCELADO
    expect(getPortalRejectionBanner({ estado: 'RECHAZADO', motivoRechazo: 'Falta cita confirmada' })).toEqual({
      visible: true,
      label: 'Motivo de rechazo',
      reason: 'Falta cita confirmada',
    });
    expect(getPortalRejectionBanner({ estado: 'CANCELADO', motivoRechazo: 'Cancelado a solicitud del cliente' })).toEqual({
      visible: true,
      label: 'Motivo de cancelación',
      reason: 'Cancelado a solicitud del cliente',
    });
    expect(getPortalRejectionBanner({ estado: 'RECHAZADO', motivoRechazo: '   ' }).visible).toBe(false);
    expect(getPortalRejectionBanner({ estado: 'APROBADO', motivoRechazo: 'Texto residual' }).visible).toBe(false);

    // Contadores y filtros (incluyendo contador de Cancelados / Rechazados)
    const sampleOrders = [
      { id: '1', estado: 'SOLICITADO' },
      { id: '2', estado: 'PENDIENTE_APROBACION' },
      { id: '3', estado: 'APROBADO' },
      { id: '4', estado: 'EN_PICKING' },
      { id: '5', estado: 'CONSOLIDADO' },
      { id: '6', estado: 'DESPACHADO' },
      { id: '7', estado: 'ENTREGADO' },
      { id: '8', estado: 'RECHAZADO' },
      { id: '9', estado: 'CANCELADO' },
    ];
    const counts = getPortalOrderCounts(sampleOrders);
    expect(counts).toEqual({
      total: 9,
      activeCount: 6,
      reservedCount: 5,
      deliveredCount: 1,
      transitCount: 1,
      rejectedCount: 2,
    });
    expect(filterPortalOrders(sampleOrders, 'rejected').map((o) => o.id)).toEqual(['8', '9']);
    expect(filterPortalOrders(sampleOrders, 'delivered').map((o) => o.id)).toEqual(['7']);
    expect(filterPortalOrders(sampleOrders, 'active').map((o) => o.id)).toEqual(['1', '2', '3', '4', '5', '6']);

    // Configuración de refresco automático ligero (30s polling, 3s throttle de foco)
    expect(PORTAL_POLL_INTERVAL_MS).toBe(30_000);
    expect(PORTAL_FOCUS_THROTTLE_MS).toBe(3_000);
  });

  it('3. Flujo real paso a paso desde UI (Solicitado → Aprobado → Preparando → Listo → Enviado → Entregado) reflejado en consultas del Portal', async () => {
    const { ctrl } = createInMemoryPortalFlowWms();

    const portalReq = { user: { id: 'u-pedro', email: 'pedro@alimnorte.mx', nombre: 'Pedro', clienteId: 'cli-alim' } };
    const supervisorReq = { user: { id: 'u-sup', email: 'supervisor@givingout.com', nombre: 'Ana García' } };
    const pickingReq = { user: { id: 'u-pick', email: 'picking@givingout.com', nombre: 'María López' } };
    const dispatchReq = { user: { id: 'u-disp', email: 'admin@givingout.com', nombre: 'Admin' } };

    const fetchPortalOrder = async (orderId: string): Promise<any> => {
      const orders = await ctrl.getOrders(undefined, 'cli-alim', undefined, portalReq);
      const found = orders.find((o: any) => o.id === orderId);
      if (!found) throw new Error(`Order ${orderId} not returned by Portal GET /orders`);
      return found;
    };

    // PASO 1: Depositante crea pedido -> SOLICITADO -> Timeline en "Solicitado" (step 1)
    const created = await ctrl.createOrder(
      {
        codigo: 'PED-PORTAL-FLOW-001',
        clienteId: 'cli-alim',
        endCustomerId: 'ec-walmart',
        lineas: [{ skuId: 'sku-ace', cantidadSolicitada: 12 }],
      },
      undefined,
      portalReq,
    );
    const lineId = created.lineas[0].id;

    let portalOrder = await fetchPortalOrder(created.id);
    expect(portalOrder.estado).toBe('SOLICITADO');
    expect(getPortalTimelineState(portalOrder.estado).currentStep).toBe(1);
    expect(getPortalTimelineState(portalOrder.estado).activeLabel).toBe('Solicitado');
    expect(getPortalLineAssignedQty(portalOrder.estado, portalOrder.lineas[0])).toBe(0);

    // PASO 2: Supervisor aprueba y asigna lotes en Panel de Preparación -> APROBADO -> Timeline en "Aprobado" (step 2)
    await ctrl.prepareOrder(
      created.id,
      {
        modo: 'AUTO_FEFO',
        asignaciones: [{ lineId, lotes: [{ lotId: 'lot-portal-001', cantidad: 12, lote: 'LOT-PORTAL-TEST-01', ubicacionCodigo: 'G0001' }] }],
      },
      supervisorReq,
    );

    portalOrder = await fetchPortalOrder(created.id);
    expect(portalOrder.estado).toBe('APROBADO');
    expect(getPortalTimelineState(portalOrder.estado).currentStep).toBe(2);
    expect(getPortalTimelineState(portalOrder.estado).activeLabel).toBe('Aprobado');
    expect(getPortalTimelineState(portalOrder.estado).steps.map((s) => s.status)).toEqual([
      'completed',
      'active',
      'pending',
      'pending',
      'pending',
      'pending',
    ]);
    expect(getPortalLineAssignedQty(portalOrder.estado, portalOrder.lineas[0])).toBe(12);

    // PASO 3: Surtidor toma pedido e inicia Picking -> EN_PICKING -> Timeline en "Preparando" (step 3)
    await ctrl.startPicking(created.id, {}, pickingReq);

    portalOrder = await fetchPortalOrder(created.id);
    expect(portalOrder.estado).toBe('EN_PICKING');
    expect(getPortalTimelineState(portalOrder.estado).currentStep).toBe(3);
    expect(getPortalTimelineState(portalOrder.estado).activeLabel).toBe('Preparando');

    // PASO 4: Surtidor completa recolección física hacia Staging -> CONSOLIDADO -> Timeline en "Listo" (step 4)
    await ctrl.recordPick(
      created.id,
      {
        lineId,
        cantidadPickeada: 12,
        ubicacionEscaneada: 'G0001',
        cajaEscaneada: 'BOX-PORTAL-0001',
      },
      pickingReq,
    );

    portalOrder = await fetchPortalOrder(created.id);
    expect(portalOrder.estado).toBe('CONSOLIDADO');
    expect(getPortalTimelineState(portalOrder.estado).currentStep).toBe(4);
    expect(getPortalTimelineState(portalOrder.estado).activeLabel).toBe('Listo');

    // PASO 5: Despacho emite Manifiesto & Salida -> DESPACHADO -> Timeline en "Enviado" (step 5)
    await ctrl.dispatchOrder(
      created.id,
      {
        choferNombre: 'Carlos López',
        vehiculoPlaca: 'NLX-1234',
        tipoTransporte: 'DIRECTO',
      },
      dispatchReq,
    );

    portalOrder = await fetchPortalOrder(created.id);
    expect(portalOrder.estado).toBe('DESPACHADO');
    expect(getPortalTimelineState(portalOrder.estado).currentStep).toBe(5);
    expect(getPortalTimelineState(portalOrder.estado).activeLabel).toBe('Enviado');
    expect(getPortalOrderStatusMeta(portalOrder.estado).isDispatched).toBe(true);
    expect(getPortalOrderStatusMeta(portalOrder.estado).hasReservedStock).toBe(false);

    // PASO 6: Despacho confirma entrega al cliente final -> ENTREGADO -> Timeline en "Entregado" (step 6)
    await ctrl.confirmDelivery(
      created.id,
      {
        nombreReceptor: 'Juan Receptor CEDIS',
        notasEntrega: 'Recibido completo',
      },
      dispatchReq,
    );

    portalOrder = await fetchPortalOrder(created.id);
    expect(portalOrder.estado).toBe('ENTREGADO');
    expect(getPortalTimelineState(portalOrder.estado).currentStep).toBe(6);
    expect(getPortalTimelineState(portalOrder.estado).activeLabel).toBe('Entregado');
    expect(getPortalTimelineState(portalOrder.estado).steps.map((s) => s.status)).toEqual([
      'completed',
      'completed',
      'completed',
      'completed',
      'completed',
      'active',
    ]);
  });

  it('4. Aprobación directa (/approve) y rechazo (/reject) reflejan correctamente APROBADO y luego RECHAZADO (timeline oculto y 0 asignado)', async () => {
    const { ctrl } = createInMemoryPortalFlowWms();

    const portalReq = { user: { id: 'u-pedro', email: 'pedro@alimnorte.mx', nombre: 'Pedro', clienteId: 'cli-alim' } };
    const supervisorReq = { user: { id: 'u-sup', email: 'supervisor@givingout.com', nombre: 'Ana García' } };

    const created = await ctrl.createOrder(
      {
        codigo: 'PED-PORTAL-REJ-001',
        clienteId: 'cli-alim',
        endCustomerId: 'ec-walmart',
        lineas: [{ skuId: 'sku-ace', cantidadSolicitada: 12 }],
      },
      undefined,
      portalReq,
    );

    // Aprobación directa -> APROBADO (step 2) con cantidadAsignada aún en 0 (sin fallback engañoso)
    await ctrl.approveOrder(created.id, { notas: 'Aprobado por supervisor' }, supervisorReq);
    let orders: any[] = await ctrl.getOrders(undefined, 'cli-alim', undefined, portalReq);
    let ord: any = orders.find((o: any) => o.id === created.id);
    expect(ord).toBeDefined();
    expect(ord.estado).toBe('APROBADO');
    expect(getPortalTimelineState(ord.estado).currentStep).toBe(2);
    expect(getPortalTimelineState(ord.estado).activeLabel).toBe('Aprobado');
    expect(getPortalLineAssignedQty(ord.estado, ord.lineas[0])).toBe(0);

    // Rechazo -> RECHAZADO (step 0, timeline oculto, motivo visible, 0 asignado, badge danger)
    await ctrl.rejectOrder(created.id, { motivo: 'Cita reprogramada por tienda' }, supervisorReq);
    orders = await ctrl.getOrders(undefined, 'cli-alim', undefined, portalReq);
    ord = orders.find((o: any) => o.id === created.id);
    expect(ord).toBeDefined();
    expect(ord.estado).toBe('RECHAZADO');
    expect(getPortalOrderStatusMeta(ord.estado).cls).toBe('danger');
    expect(getPortalTimelineState(ord.estado).visible).toBe(false);
    expect(getPortalLineAssignedQty(ord.estado, ord.lineas[0])).toBe(0);
    expect(getPortalRejectionBanner(ord)).toEqual({
      visible: true,
      label: 'Motivo de rechazo',
      reason: 'Cita reprogramada por tienda',
    });
  });
});
