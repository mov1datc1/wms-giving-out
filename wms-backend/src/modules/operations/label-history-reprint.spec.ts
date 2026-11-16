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
import { InventoryController } from '../inventory/inventory.controller';
import { PutawayEngineService } from './putaway-engine.service';
import { WmsAuthGuard } from '../auth/wms-auth.guard';
import { formatCalendarDate } from '../../../../wms-frontend/src/utils/dateUtils';
import { isContainerMasterHu, getLocationHuRowPresentation } from '../../../../wms-frontend/src/utils/locationHuDisplay';

const JWT_SECRET = process.env.JWT_SECRET || 'giving-out-wms-secret-2026';

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

function makeGuardContext(controllerClass: any, handlerName: string, headers: Record<string, string>) {
  const handler = controllerClass.prototype[handlerName];
  const request: any = { headers };
  const context = {
    getHandler: () => handler,
    getClass: () => controllerClass,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { context, request };
}

describe('Opción A: Regresión Final de Etiquetado — Histórico / Reimpresión (Revisión Alejandra)', () => {
  let operationsController: OperationsController;
  let inventoryController: InventoryController;
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
      reglaInventario: 'FEFO',
    };

    const clientFashion = {
      id: 'cli-fashion-001',
      codigo: 'DEP-FASHION-01',
      nombreComercial: 'Fashion Forward',
      razonSocial: 'Fashion Forward S.A.',
      reglaInventario: 'FIFO',
    };

    const skuAceite = {
      id: 'sku-ace-001',
      codigo: 'ACE-OLI-1L',
      descripcion: 'Aceite de Oliva Extra Virgen 1L',
      categoria: 'ALIMENTOS',
      uomBase: 'PZA',
      capacidadEmpaque: 12,
      clienteId: clientAlimNorte.id,
    };

    const receipt20 = {
      id: '03872d7e-bdc7-4d61-9c01-415bc90d5473',
      codigo: 'REC-2026-0020',
      estado: 'CERRADA',
      etiquetasEstado: 'COLOCADAS',
      andenAsignado: 'Andén 01',
      clienteId: clientAlimNorte.id,
      cliente: clientAlimNorte,
      createdAt: new Date('2026-11-10T22:00:00.000Z'),
      lineas: [
        {
          id: 'a436d628-89e3-43a3-ba0a-01d21765f9e7',
          skuId: skuAceite.id,
          sku: skuAceite,
          lote: 'LOT-QA-E2E-001',
          fechaVencimiento: new Date('2027-06-30T00:00:00.000Z'),
          cantidadEsperada: 24,
          cantidadRecibida: 24,
        },
      ],
    };

    const pltMaster = {
      id: '6e094f37-df2f-4ab2-95ca-38e80d4826d4',
      codigo: 'PLT-REC-2026-0020-01',
      tipoHu: 'PALLET',
      clienteId: clientAlimNorte.id,
      receiptId: receipt20.id,
      cantidad: 0,
      uom: 'TARIMA',
      ubicacionActual: 'STG-01',
      estadoHu: 'DESPACHADO',
      parentHuId: null,
      etiquetaImpresa: true,
      estadoEtiqueta: 'COLOCADA',
      loteTexto: null,
      fechaVencimiento: null,
      skuCodigo: null,
      skuDescripcion: null,
      cliente: clientAlimNorte,
      recepcion: {
        id: receipt20.id,
        codigo: receipt20.codigo,
        andenAsignado: receipt20.andenAsignado,
        fechaRecepcion: receipt20.createdAt,
        createdAt: receipt20.createdAt,
      },
      lineasSalida: [],
      createdAt: new Date('2026-11-10T22:05:02.888Z'),
    };

    const box1 = {
      id: 'e0ad2e3b-6618-49fe-96a3-491b27a513e3',
      codigo: 'BOX-REC-2026-0020-0001',
      tipoHu: 'CAJA',
      clienteId: clientAlimNorte.id,
      receiptId: receipt20.id,
      parentHuId: pltMaster.id,
      cantidad: 12,
      uom: 'PZA',
      ubicacionActual: 'STG-01',
      estadoHu: 'DESPACHADO',
      etiquetaImpresa: true,
      estadoEtiqueta: 'COLOCADA',
      loteTexto: 'LOT-QA-E2E-001',
      fechaVencimiento: new Date('2027-06-30T00:00:00.000Z'),
      skuCodigo: skuAceite.codigo,
      skuDescripcion: skuAceite.descripcion,
      cliente: clientAlimNorte,
      recepcion: {
        id: receipt20.id,
        codigo: receipt20.codigo,
        andenAsignado: receipt20.andenAsignado,
        fechaRecepcion: receipt20.createdAt,
        createdAt: receipt20.createdAt,
      },
      lineasSalida: [
        {
          orden: {
            codigo: 'PED-QA-E2E-OUT-001',
            estado: 'ENTREGADO',
            endCustomer: { nombre: 'Walmart México (CEDIS San Martín)' },
          },
        },
      ],
      createdAt: new Date('2026-11-10T22:05:03.019Z'),
    };

    const box2 = {
      id: '03e8b113-8bd1-43fb-80c9-814731bf3b8f',
      codigo: 'BOX-REC-2026-0020-0002',
      tipoHu: 'CAJA',
      clienteId: clientAlimNorte.id,
      receiptId: receipt20.id,
      parentHuId: pltMaster.id,
      cantidad: 12,
      uom: 'PZA',
      ubicacionActual: 'STG-01',
      estadoHu: 'DESPACHADO',
      etiquetaImpresa: true,
      estadoEtiqueta: 'COLOCADA',
      loteTexto: 'LOT-QA-E2E-001',
      fechaVencimiento: new Date('2027-06-30T00:00:00.000Z'),
      skuCodigo: skuAceite.codigo,
      skuDescripcion: skuAceite.descripcion,
      cliente: clientAlimNorte,
      recepcion: {
        id: receipt20.id,
        codigo: receipt20.codigo,
        andenAsignado: receipt20.andenAsignado,
        fechaRecepcion: receipt20.createdAt,
        createdAt: receipt20.createdAt,
      },
      lineasSalida: [
        {
          orden: {
            codigo: 'PED-QA-E2E-OUT-002',
            estado: 'DESPACHADO',
            endCustomer: { nombre: 'Walmart México (CEDIS San Martín)' },
          },
        },
      ],
      createdAt: new Date('2026-11-10T22:05:03.019Z'),
    };

    const handlingUnits = [pltMaster, box1, box2];
    const lotInventory: any[] = []; // Inventario comercial físico = 0 PZA
    const inventoryMovements: any[] = [];
    const printLogs: any[] = [
      {
        id: 'a9f61f71-297e-415f-aefa-8c70ece1059b',
        usuario: 'Supervisor Andén',
        tipoEtiqueta: 'TODAS',
        referencia: 'REC-2026-0020',
        reimpresion: false,
        motivo: 'Primera emisión de etiquetas',
        createdAt: new Date('2026-11-10T22:38:47.566Z'),
      },
    ];

    const users: any[] = [
      {
        id: 'usr-admin-1',
        email: 'admin@givingout.com',
        nombre: 'Super Admin',
        activo: true,
        rolId: 'rol-admin',
        clienteId: null,
        rol: {
          id: 'rol-admin',
          nombre: 'Administrador',
          nivel: 1,
          permisos: [
            { modulo: 'etiquetado', accion: 'ver' },
            { modulo: 'etiquetado', accion: 'crear' },
            { modulo: 'etiquetado', accion: 'imprimir' },
            { modulo: 'recepcion', accion: 'ver' },
            { modulo: 'recepcion', accion: 'imprimir' },
          ],
        },
      },
      {
        id: 'usr-pick-1',
        email: 'picker@givingout.com',
        nombre: 'Operador Picking',
        activo: true,
        rolId: 'rol-pick',
        clienteId: null,
        rol: {
          id: 'rol-pick',
          nombre: 'Operador Picking',
          nivel: 6,
          permisos: [
            { modulo: 'picking', accion: 'ver' },
            { modulo: 'picking', accion: 'editar' },
          ],
        },
      },
      {
        id: 'usr-desp-1',
        email: 'despachador@givingout.com',
        nombre: 'Despachador Oficial',
        activo: true,
        rolId: 'rol-desp',
        clienteId: null,
        rol: {
          id: 'rol-desp',
          nombre: 'Despachador',
          nivel: 5,
          permisos: [
            { modulo: 'despacho', accion: 'ver' },
          ],
        },
      },
      {
        id: 'usr-sup-1',
        email: 'supervisor@givingout.com',
        nombre: 'Supervisor Certificado',
        activo: true,
        rolId: 'rol-sup',
        clienteId: null,
        rol: {
          id: 'rol-sup',
          nombre: 'Supervisor Andén',
          nivel: 3,
          permisos: [
            { modulo: 'etiquetado', accion: 'ver' },
            { modulo: 'etiquetado', accion: 'crear' },
            { modulo: 'etiquetado', accion: 'imprimir' },
            { modulo: 'recepcion', accion: 'ver' },
            { modulo: 'recepcion', accion: 'imprimir' },
          ],
        },
      },
      {
        id: 'usr-client-1',
        email: 'pedro@alimnorte.mx',
        nombre: 'Pedro AlimNorte',
        activo: true,
        rolId: 'rol-client',
        clienteId: clientAlimNorte.id,
        rol: {
          id: 'rol-client',
          nombre: 'Depositante Portal',
          nivel: 9,
          permisos: [
            { modulo: 'portal', accion: 'ver' },
          ],
        },
      },
    ];

    const prismaMock: any = {
      user: {
        findUnique: jest.fn(async ({ where }: any) => {
          const u = users.find((x: any) => x.id === where.id || x.email === where.email);
          return u ? clone(u) : null;
        }),
      },
      handlingUnit: {
        findMany: jest.fn(async (args?: any) => {
          let list = clone(handlingUnits);
          if (args?.where) {
            const w = args.where;
            if (w.clienteId) list = list.filter((h: any) => h.clienteId === w.clienteId);
            if (w.estadoHu?.in) list = list.filter((h: any) => w.estadoHu.in.includes(h.estadoHu));
            if (w.OR && Array.isArray(w.OR)) {
              list = list.filter((h: any) => {
                return w.OR.some((term: any) => {
                  if (term.codigo?.contains) {
                    return String(h.codigo).toLowerCase().includes(term.codigo.contains.toLowerCase());
                  }
                  if (term.loteTexto?.contains) {
                    return String(h.loteTexto || '').toLowerCase().includes(term.loteTexto.contains.toLowerCase());
                  }
                  if (term.skuCodigo?.contains) {
                    return String(h.skuCodigo || '').toLowerCase().includes(term.skuCodigo.contains.toLowerCase());
                  }
                  if (term.recepcion?.codigo?.contains) {
                    return String(h.recepcion?.codigo || '').toLowerCase().includes(term.recepcion.codigo.contains.toLowerCase());
                  }
                  return false;
                });
              });
            }
          }
          return list;
        }),
        findFirst: jest.fn(async (args?: any) => {
          const list = await prismaMock.handlingUnit.findMany(args);
          return list[0] || null;
        }),
        count: jest.fn(async () => handlingUnits.length),
      },
      lotInventory: {
        count: jest.fn(async () => lotInventory.length),
        aggregate: jest.fn(async () => ({
          _sum: {
            cantidadDisponible: 0,
            cantidadBloqueada: 0,
            cantidadReservada: 0,
          },
        })),
      },
      inventoryMovement: {
        count: jest.fn(async () => inventoryMovements.length),
      },
      printLog: {
        create: jest.fn(async ({ data }: any) => {
          const item = {
            id: nextId('pl'),
            usuario: data.usuario || 'Operador',
            tipoEtiqueta: data.tipoEtiqueta || 'RECEPCION',
            referencia: data.referencia,
            reimpresion: Boolean(data.reimpresion),
            motivo: data.motivo || 'Impresión de etiquetas',
            createdAt: new Date(),
          };
          printLogs.unshift(item);
          return item;
        }),
        findMany: jest.fn(async (args?: any) => {
          let list = clone(printLogs);
          if (args?.where) {
            const w = args.where;
            if (w.referencia?.contains) {
              list = list.filter((p: any) => p.referencia.toLowerCase().includes(w.referencia.contains.toLowerCase()));
            }
            if (w.tipoEtiqueta) {
              list = list.filter((p: any) => p.tipoEtiqueta === w.tipoEtiqueta);
            }
            if (w.reimpresion !== undefined) {
              list = list.filter((p: any) => p.reimpresion === w.reimpresion);
            }
          }
          return list;
        }),
        count: jest.fn(async () => printLogs.length),
      },
    };

    return {
      prismaMock,
      handlingUnits,
      lotInventory,
      inventoryMovements,
      printLogs,
      clientAlimNorte,
      clientFashion,
      receipt20,
    };
  }

  beforeEach(() => {
    state = buildInMemoryDb();
    putawayEngine = new PutawayEngineService(state.prismaMock as any);
    operationsController = new OperationsController(state.prismaMock as any, {} as any);
    inventoryController = new InventoryController(state.prismaMock as any, putawayEngine);
    guard = new WmsAuthGuard(state.prismaMock as any, new Reflector());
  });

  // A. HU DESPACHADO sigue disponible en Histórico
  test('A. HU DESPACHADO sigue disponible en Histórico (scope=HISTORICO)', async () => {
    const historicalHus = await inventoryController.getHandlingUnits(undefined, undefined, 'HISTORICO');
    expect(historicalHus).toHaveLength(3);
    const codes = historicalHus.map((h: any) => h.codigo);
    expect(codes).toContain('PLT-REC-2026-0020-01');
    expect(codes).toContain('BOX-REC-2026-0020-0001');
    expect(codes).toContain('BOX-REC-2026-0020-0002');
    expect(historicalHus.every((h: any) => h.estadoHu === 'DESPACHADO')).toBe(true);
  });

  // B. Histórico no aparece como inventario activo
  test('B. Histórico no aparece como inventario activo (scope=FISICO retorna 0 HUs)', async () => {
    const physicalHus = await inventoryController.getHandlingUnits(undefined, undefined, 'FISICO');
    expect(physicalHus).toHaveLength(0); // Inventario comercial activo = 0
  });

  // C. Reimpresión no crea HU
  test('C. Reimpresión no crea HandlingUnit nueva en BD', async () => {
    const huCountBefore = await state.prismaMock.handlingUnit.count();
    
    // Ejecutar reimpresión a través de createPrintLog
    await operationsController.createPrintLog(
      {
        tipoEtiqueta: 'CAJA',
        referencia: 'BOX-REC-2026-0020-0001',
        reimpresion: true,
        motivo: 'Reimpresión histórica controlada por reposición de etiqueta',
      },
      { user: { email: 'admin@givingout.com', nombre: 'Super Admin' } }
    );

    const huCountAfter = await state.prismaMock.handlingUnit.count();
    expect(huCountAfter).toBe(huCountBefore);
    expect(state.prismaMock.handlingUnit.findMany).toBeDefined();
  });

  // D. Reimpresión no cambia estado HU
  test('D. Reimpresión no cambia estado de la HU (permanece DESPACHADO)', async () => {
    const huBefore = await state.prismaMock.handlingUnit.findFirst({
      where: { codigo: 'BOX-REC-2026-0020-0001' },
    });
    expect(huBefore.estadoHu).toBe('DESPACHADO');

    await operationsController.createPrintLog(
      {
        tipoEtiqueta: 'CAJA',
        referencia: 'BOX-REC-2026-0020-0001',
        reimpresion: true,
      },
      { user: { email: 'admin@givingout.com', nombre: 'Super Admin' } }
    );

    const huAfter = await state.prismaMock.handlingUnit.findFirst({
      where: { codigo: 'BOX-REC-2026-0020-0001' },
    });
    expect(huAfter.estadoHu).toBe('DESPACHADO');
  });

  // E. Reimpresión no modifica LotInventory
  test('E. Reimpresión no modifica LotInventory (total físico permanece 0 PZA)', async () => {
    const lotAggBefore = await state.prismaMock.lotInventory.aggregate();
    expect(lotAggBefore._sum.cantidadDisponible).toBe(0);

    await operationsController.createPrintLog(
      {
        tipoEtiqueta: 'CAJA',
        referencia: 'BOX-REC-2026-0020-0001',
        reimpresion: true,
      },
      { user: { email: 'admin@givingout.com', nombre: 'Super Admin' } }
    );

    const lotAggAfter = await state.prismaMock.lotInventory.aggregate();
    expect(lotAggAfter._sum.cantidadDisponible).toBe(0);
  });

  // F. Reimpresión no genera InventoryMovement
  test('F. Reimpresión no genera InventoryMovement en Kárdex', async () => {
    const movCountBefore = await state.prismaMock.inventoryMovement.count();

    await operationsController.createPrintLog(
      {
        tipoEtiqueta: 'CAJA',
        referencia: 'BOX-REC-2026-0020-0001',
        reimpresion: true,
      },
      { user: { email: 'admin@givingout.com', nombre: 'Super Admin' } }
    );

    const movCountAfter = await state.prismaMock.inventoryMovement.count();
    expect(movCountAfter).toBe(movCountBefore);
    expect(movCountAfter).toBe(0);
  });

  // G. Tarima Master no se cuenta como PZA
  test('G. Tarima Master no se cuenta como PZA y es tratada como contenedor padre', () => {
    const allHus = state.handlingUnits;
    const plt = allHus.find((h: any) => h.codigo === 'PLT-REC-2026-0020-01');
    expect(plt).toBeDefined();

    const isMaster = isContainerMasterHu(plt, allHus);
    expect(isMaster).toBe(true);

    const pres = getLocationHuRowPresentation(plt, allHus);
    expect(pres.isContainer).toBe(true);
    expect(pres.tipoLabel).toBe('Tarima Master');
    expect(pres.cantidadLabel).toBe('1 tarima');
    expect(pres.associatedChildrenCount).toBe(2);
    expect(pres.childSkus).toEqual(['ACE-OLI-1L']);
    expect(pres.contenidoLabel).toBe('Contenedor de 2 cajas');
  });

  // H. Datos históricos correctos
  test('H. Datos históricos correctos (Recepción, Andén, SKU, Lote, Jerarquía)', async () => {
    const allHus = await inventoryController.getHandlingUnits(undefined, undefined, 'HISTORICO');
    const box1 = allHus.find((h: any) => h.codigo === 'BOX-REC-2026-0020-0001');
    expect(box1).toBeDefined();
    if (!box1) return;

    expect(box1.recepcion?.codigo).toBe('REC-2026-0020');
    expect(box1.recepcion?.andenAsignado).toBe('Andén 01');
    expect(box1.skuCodigo).toBe('ACE-OLI-1L');
    expect(box1.loteTexto).toBe('LOT-QA-E2E-001');
    expect(box1.parentHuId).toBe('6e094f37-df2f-4ab2-95ca-38e80d4826d4');
    expect(box1.lineasSalida[0].orden.codigo).toBe('PED-QA-E2E-OUT-001');
  });

  // I. Fecha calendar-day correcta (30/06/2027 sin desfase UTC)
  test('I. Fecha calendar-day exacta (30/06/2027 sin retroceso a 29/06/2027)', () => {
    const box = state.handlingUnits.find((h: any) => h.codigo === 'BOX-REC-2026-0020-0001');
    const formatted = formatCalendarDate(box.fechaVencimiento);
    expect(formatted).toBe('30/06/2027');
    expect(formatted).not.toBe('29/06/2027');
  });

  // J. RBAC: Super Admin y Staff con etiquetado/recepción autorizados
  test('J. RBAC: Operador sin permiso en etiquetado/recepción es denegado (HTTP 403)', async () => {
    const tokenOperadorPicking = jwt.sign(
      {
        id: 'usr-pick-1',
        email: 'picker@givingout.com',
        nombre: 'Operador Picking',
        isSuperAdmin: false,
        modulos: ['picking'],
        permisos: ['picking:ver', 'picking:editar'],
      },
      JWT_SECRET
    );

    const { context } = makeGuardContext(OperationsController, 'createPrintLog', {
      authorization: `Bearer ${tokenOperadorPicking}`,
    });

    await expect(guard.canActivate(context)).rejects.toThrow(HttpException);
    try {
      await guard.canActivate(context);
    } catch (err: any) {
      expect(err.getStatus()).toBe(HttpStatus.FORBIDDEN);
    }
  });

  // K. Portal bloqueado: usuario depositante no accede a endpoints staff de impresión
  test('K. Portal Depositante bloqueado de endpoints staff de impresión (allowPortal: false)', async () => {
    const tokenPortal = jwt.sign(
      {
        id: 'usr-client-1',
        email: 'pedro@alimnorte.mx',
        nombre: 'Pedro AlimNorte',
        clienteId: state.clientAlimNorte.id,
        isSuperAdmin: false,
        modulos: ['portal'],
        permisos: ['portal:ver'],
      },
      JWT_SECRET
    );

    const { context } = makeGuardContext(OperationsController, 'createPrintLog', {
      authorization: `Bearer ${tokenPortal}`,
    });

    await expect(guard.canActivate(context)).rejects.toThrow(HttpException);
    try {
      await guard.canActivate(context);
    } catch (err: any) {
      expect(err.getStatus()).toBe(HttpStatus.FORBIDDEN);
    }
  });

  // L. Anti-spoofing: x-user-role no eleva privilegios y actor se toma de sesión
  test('L. Anti-spoofing: x-user-role no eleva privilegios y usuario se deriva de req.user', async () => {
    const tokenOperadorDespacho = jwt.sign(
      {
        id: 'usr-desp-1',
        email: 'despachador@givingout.com',
        nombre: 'Despachador Oficial',
        isSuperAdmin: false,
        modulos: ['despacho'],
        permisos: ['despacho:ver'],
      },
      JWT_SECRET
    );

    // Intento de spoofing con header x-user-role: SUPER_ADMIN
    const { context } = makeGuardContext(OperationsController, 'createPrintLog', {
      authorization: `Bearer ${tokenOperadorDespacho}`,
      'x-user-role': 'SUPER_ADMIN',
    });

    await expect(guard.canActivate(context)).rejects.toThrow(HttpException);

    // Con usuario autorizado, el actor registrado en el log debe ser el del JWT, no el del body
    const tokenSupervisor = jwt.sign(
      {
        id: 'usr-sup-1',
        email: 'supervisor@givingout.com',
        nombre: 'Supervisor Certificado',
        isSuperAdmin: false,
        modulos: ['etiquetado', 'recepcion'],
        permisos: ['etiquetado:crear', 'etiquetado:imprimir'],
      },
      JWT_SECRET
    );

    const log = await operationsController.createPrintLog(
      {
        usuario: 'Atacante Inyectado',
        tipoEtiqueta: 'HU',
        referencia: 'BOX-REC-2026-0020-0001',
        reimpresion: true,
      },
      { user: { email: 'supervisor@givingout.com', nombre: 'Supervisor Certificado' } }
    );

    expect(log.usuario).toBe('Supervisor Certificado');
    expect(log.usuario).not.toBe('Atacante Inyectado');
  });

  // M. PrintLog correcto: registro y consulta distinguiendo reimpresión
  test('M. PrintLog registra y consulta eventos distinguiendo reimpresión canónica', async () => {
    // 1. Crear reimpresión
    const log = await operationsController.createPrintLog(
      {
        tipoEtiqueta: 'CAJA',
        referencia: 'BOX-REC-2026-0020-0001',
        reimpresion: true,
        motivo: 'Reimpresión controlada de prueba',
      },
      { user: { email: 'admin@givingout.com', nombre: 'Super Admin' } }
    );

    expect(log.reimpresion).toBe(true);
    expect(log.referencia).toBe('BOX-REC-2026-0020-0001');

    // 2. Consultar logs
    const allLogs = await operationsController.getPrintLogs('BOX-REC-2026-0020-0001');
    expect(allLogs).toHaveLength(1);
    expect(allLogs[0].reimpresion).toBe(true);
    expect(allLogs[0].referencia).toBe('BOX-REC-2026-0020-0001');

    const historicalEmission = await operationsController.getPrintLogs('REC-2026-0020', undefined, 'false');
    expect(historicalEmission).toHaveLength(1);
    expect(historicalEmission[0].reimpresion).toBe(false);
  });

  // N. Búsqueda cruzada por recepción, SKU, lote y código en handling-units
  test('N. Búsqueda cruzada localiza HUs por recepción REC-2026-0020, SKU y Lote', async () => {
    const byReceipt = await inventoryController.getHandlingUnits(undefined, undefined, undefined, 'REC-2026-0020');
    expect(byReceipt).toHaveLength(3);

    const bySku = await inventoryController.getHandlingUnits(undefined, undefined, undefined, 'ACE-OLI-1L');
    expect(bySku.length).toBeGreaterThanOrEqual(2);

    const byLot = await inventoryController.getHandlingUnits(undefined, undefined, undefined, 'LOT-QA-E2E-001');
    expect(byLot.length).toBeGreaterThanOrEqual(2);

    const byHu = await inventoryController.getHandlingUnits(undefined, undefined, undefined, 'BOX-REC-2026-0020-0001');
    expect(byHu).toHaveLength(1);
    expect(byHu[0].codigo).toBe('BOX-REC-2026-0020-0001');
  });
});

