import { Controller, Get, Post, Body, Param, Query, HttpCode, HttpStatus, HttpException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { PrismaService } from '../../prisma.service';
import { DivertToVirtualDto } from './dto/divert-virtual.dto';
import { TransferToVirtualDto, ReleaseFromVirtualDto } from './dto/transfer-virtual.dto';
import { withConcurrencyRetry } from '../../common/concurrency.util';
import { PutawayEngineService } from '../operations/putaway-engine.service';
import { classifyLocationOperationalRole } from '../../common/location-classifier.util';
import { evaluateInventoryItemOperationalState, isExpired } from '../../common/inventory-operational-state.util';

@ApiTags('Inventory')
@Controller('api/inventory')
export class InventoryController {
  constructor(
    private prisma: PrismaService,
    private putawayEngine: PutawayEngineService,
  ) {}

  @Get('lots')
  @ApiOperation({ summary: 'Listar inventario por lote (stock vivo o virtual)' })
  @ApiQuery({ name: 'tipoStock', required: false, enum: ['DISPONIBLE', 'VIRTUAL_NC', 'TODOS'], description: 'Filtrar por stock vendible disponible o retenido en almacén virtual de No Conforme/Merma' })
  async getLots(
    @Query('clienteId') clienteId?: string,
    @Query('skuId') skuId?: string,
    @Query('estado') estado?: string,
    @Query('tipoStock') tipoStock?: string,
  ) {
    const where: any = {};
    if (tipoStock === 'VIRTUAL_NC') {
      where.cantidadBloqueada = { gt: 0 };
    } else if (tipoStock === 'TODOS') {
      where.OR = [{ cantidadDisponible: { gt: 0 } }, { cantidadBloqueada: { gt: 0 } }];
    } else {
      where.cantidadDisponible = { gt: 0 };
    }

    if (clienteId) where.clienteId = clienteId;
    if (skuId) where.skuId = skuId;
    if (estado) where.estadoCalidad = estado;

    const lots = await this.prisma.lotInventory.findMany({
      where,
      include: {
        sku: { select: { codigo: true, descripcion: true, categoria: true, talla: true, color: true, marca: true, uomBase: true, capacidadEmpaque: true } },
        cliente: { select: { nombreComercial: true, giro: true, manejoInventario: true, uomPrincipal: true, reglaInventario: true } },
        ubicacion: { select: { codigo: true, tipoUbicacion: true, pasillo: true, rack: true, nivel: true, zona: { select: { codigo: true, nombre: true, tipoZona: true } } } },
        handlingUnits: { select: { id: true, codigo: true, tipoHu: true, cantidad: true, ubicacionActual: true, estadoHu: true, loteTexto: true, reacondicionada: true, piezasPorCaja: true, cajaOrigenId: true } },
      },
      orderBy: [{ fechaVencimiento: 'asc' }, { sku: { descripcion: 'asc' } }],
    });

    // En Stock Operativo Comercial (tipoStock === 'DISPONIBLE' o por defecto),
    // excluir cualquier partida cuya condición operativa no sea vendible (precedencia central).
    const now = new Date();
    const filteredLots = (tipoStock === 'DISPONIBLE' || !tipoStock)
      ? lots.filter(l => {
          const locClass = classifyLocationOperationalRole(l.ubicacion);
          const ev = evaluateInventoryItemOperationalState(l, locClass, now);
          return ev.esVendible;
        })
      : lots;

    return filteredLots.map(l => {
      const locClass = classifyLocationOperationalRole(l.ubicacion);
      const ev = evaluateInventoryItemOperationalState(l, locClass, now);
      const disp = l.cantidadDisponible || 0;
      const bloq = l.cantidadBloqueada || 0;
      const fisico = disp + bloq;
      const reservado = Math.max(0, l.cantidadReservada || 0);

      const isCajaCerrada = l.cliente?.manejoInventario === 'CAJA' || l.cliente?.uomPrincipal === 'CAJA' || l.cliente?.reglaInventario === 'CAJA_CERRADA' || (l.cliente as any)?.politicaEmpaque === 'CAJA_CERRADA' || l.cliente?.nombreComercial?.includes('AlimNorte');
      const partialUnits = isCajaCerrada && l.handlingUnits
        ? l.handlingUnits.filter((h: any) => h.reacondicionada || (h.piezasPorCaja && h.cantidad < h.piezasPorCaja) || h.codigo?.includes('PARCIAL')).reduce((s: number, h: any) => s + (Number(h.cantidad) || 0), 0)
        : 0;
      const cantidadElegible = Math.max(0, ev.cantidadDisponibleVendible - partialUnits);

      return {
        ...l,
        isExpired: ev.esVencido,
        isBlocked: l.estadoCalidad !== 'LIBERADO',
        estadoOperativoPrincipal: ev.estadoPrincipal,
        badgeOperativoTexto: ev.badgeTexto,
        motivoOperativo: ev.motivo,
        rolOperativoUbicacion: locClass.rolOperativo,
        esUbicacionVendible: locClass.esVendible,
        esTransitoInterno: locClass.esTransitoInterno,
        estadoOperativoUbicacion: locClass.badgeTexto,
        cantidadFisica: fisico,
        cantidadReservada: reservado,
        cantidadDisponibleLibre: ev.cantidadDisponibleVendible,
        stockLibre: ev.cantidadDisponibleVendible,
        cantidadElegible,
        esElegiblePutawayComercial: ev.esElegiblePutawayComercial,
        esElegibleAllocation: ev.esElegibleAllocation,
        esElegiblePicking: ev.esElegiblePicking,
        esVisiblePortalComoDisponible: ev.esVisiblePortalComoDisponible,
      };
    });
  }

  @Get('handling-units')
  @ApiOperation({ summary: 'Listar Handling Units activas' })
  async getHandlingUnits(
    @Query('clienteId') clienteId?: string,
    @Query('estado') estado?: string,
    @Query('search') search?: string,
  ) {
    const where: any = {};
    if (clienteId) where.clienteId = clienteId;
    if (estado) {
      if (estado === 'TODOS' || estado === 'ALL') {
        // No filter, show all HUs
      } else if (estado.includes(',')) {
        where.estadoHu = { in: estado.split(',').map(s => s.trim()) };
      } else {
        where.estadoHu = estado;
      }
    }
    if (search && search.trim()) {
      const q = search.trim();
      where.OR = [
        { codigo: { contains: q, mode: 'insensitive' } },
        { loteTexto: { contains: q, mode: 'insensitive' } },
        { skuCodigo: { contains: q, mode: 'insensitive' } },
        { lote: { lote: { contains: q, mode: 'insensitive' } } },
        { lote: { sku: { codigo: { contains: q, mode: 'insensitive' } } } },
        { lote: { sku: { descripcion: { contains: q, mode: 'insensitive' } } } },
      ];
    }

    return this.prisma.handlingUnit.findMany({
      where,
      include: {
        lote: {
          include: {
            sku: { select: { codigo: true, descripcion: true, categoria: true, uomBase: true, capacidadEmpaque: true } },
            ubicacion: { select: { codigo: true } },
          },
        },
        cliente: { select: { nombreComercial: true, manejoInventario: true, uomPrincipal: true, reglaInventario: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Get('summary')
  @ApiOperation({ summary: 'Resumen de inventario por cliente' })
  async getSummary(@Query('clienteId') clienteId?: string) {
    const where: any = { cantidadDisponible: { gt: 0 } };
    if (clienteId) where.clienteId = clienteId;

    const lots = await this.prisma.lotInventory.findMany({
      where,
      include: {
        sku: { select: { codigo: true, descripcion: true, categoria: true, clienteId: true } },
        cliente: { select: { nombreComercial: true } },
        ubicacion: { include: { zona: true } },
      },
    });

    const now = new Date();
    const totalFisico = lots.reduce((sum, l) => sum + (l.cantidadDisponible || 0) + (l.cantidadBloqueada || 0), 0);
    const totalReservado = lots.reduce((sum, l) => sum + Math.max(0, l.cantidadReservada || 0), 0);
    let totalTransito = 0;
    let totalDisponible = 0;
    for (const l of lots) {
      const locClass = classifyLocationOperationalRole(l.ubicacion);
      const ev = evaluateInventoryItemOperationalState(l, locClass, now);
      totalDisponible += ev.cantidadDisponibleVendible;
      totalTransito += ev.cantidadTransitoVigente;
    }
    const totalSkus = new Set(lots.map(l => l.skuId)).size;
    const totalLotes = lots.length;

    // Group by client
    const porCliente: Record<string, { nombre: string; unidades: number; skus: number }> = {};
    for (const lot of lots) {
      const cn = lot.cliente.nombreComercial;
      if (!porCliente[cn]) porCliente[cn] = { nombre: cn, unidades: 0, skus: 0 };
      porCliente[cn].unidades += lot.cantidadDisponible;
    }
    // Count unique SKUs per client
    const skusByClient: Record<string, Set<string>> = {};
    for (const lot of lots) {
      const cn = lot.cliente.nombreComercial;
      if (!skusByClient[cn]) skusByClient[cn] = new Set();
      skusByClient[cn].add(lot.skuId);
    }
    for (const cn of Object.keys(porCliente)) {
      porCliente[cn].skus = skusByClient[cn]?.size || 0;
    }

    return { totalFisico, totalUnidades: totalFisico, totalReservado, totalDisponible, totalTransito, totalSkus, totalLotes, porCliente: Object.values(porCliente) };
  }

  @Get('movements')
  @ApiOperation({ summary: 'Historial de movimientos de inventario' })
  async getMovements(
    @Query('tipo') tipo?: string,
    @Query('clienteId') clienteId?: string,
    @Query('limit') limit?: string,
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
  ) {
    const where: any = {};
    if (tipo) where.tipoMovimiento = tipo;
    if (clienteId) where.clienteId = clienteId;
    if (desde || hasta) {
      where.fechaHora = {};
      if (desde) where.fechaHora.gte = new Date(desde);
      if (hasta) where.fechaHora.lte = new Date(hasta);
    }

    return this.prisma.inventoryMovement.findMany({
      where,
      include: {
        sku: { select: { codigo: true, descripcion: true, uomBase: true } },
        fromLocation: { select: { codigo: true } },
        toLocation: { select: { codigo: true } },
        almacen: { select: { codigo: true, nombre: true } },
        lote: { select: { lote: true, fechaVencimiento: true } },
        hu: { select: { codigo: true } },
      },
      orderBy: { fechaHora: 'desc' },
      take: parseInt(limit || '1000'),
    });
  }

  // ============ INVENTARIO CONSOLIDADO / GENERAL ============
  @Get('consolidated')
  @ApiOperation({ summary: 'Consultar inventario general consolidado (conforme, merma, exceso y cuarentena) en una sola consulta' })
  @ApiQuery({ name: 'clienteId', required: false, description: 'Filtrar por cliente depositante' })
  @ApiQuery({ name: 'skuId', required: false, description: 'Filtrar por SKU' })
  @ApiQuery({ name: 'clasificacion', required: false, enum: ['TODOS', 'CONFORME', 'MERMA', 'EXCESO', 'CUARENTENA', 'EXPIRADO', 'BLOQUEADO', 'STAGING'], description: 'Filtrar por clasificación' })
  @ApiQuery({ name: 'search', required: false, description: 'Búsqueda por texto (SKU, lote, ubicación, cliente, etc.)' })
  async getConsolidatedInventory(
    @Query('clienteId') clienteId?: string,
    @Query('skuId') skuId?: string,
    @Query('clasificacion') clasificacion?: string,
    @Query('search') search?: string,
  ) {
    const where: any = {
      OR: [
        { cantidadDisponible: { gt: 0 } },
        { cantidadBloqueada: { gt: 0 } },
      ],
    };
    if (clienteId) where.clienteId = clienteId;
    if (skuId) where.skuId = skuId;

    const allLots = await this.prisma.lotInventory.findMany({
      where,
      include: {
        sku: {
          select: {
            id: true,
            codigo: true,
            descripcion: true,
            categoria: true,
            subcategoria: true,
            marca: true,
            color: true,
            talla: true,
            uomBase: true,
            capacidadEmpaque: true,
            temperaturaRequerida: true,
          },
        },
        cliente: {
          select: {
            id: true,
            codigo: true,
            nombreComercial: true,
            razonSocial: true,
            giro: true,
            uomPrincipal: true,
            manejoInventario: true,
            reglaInventario: true,
            zonaAsignadaId: true,
          },
        },
        ubicacion: {
          select: {
            id: true,
            codigo: true,
            pasillo: true,
            rack: true,
            nivel: true,
            posicion: true,
            tipoUbicacion: true,
            temperatura: true,
            zona: {
              select: {
                id: true,
                codigo: true,
                nombre: true,
                tipoZona: true,
              },
            },
          },
        },
        handlingUnits: {
          select: {
            id: true,
            codigo: true,
            tipoHu: true,
            cantidad: true,
            ubicacionActual: true,
            estadoHu: true,
            loteTexto: true,
            reacondicionada: true,
            piezasPorCaja: true,
            cajaOrigenId: true,
          },
        },
      },
      orderBy: [
        { cliente: { nombreComercial: 'asc' } },
        { sku: { codigo: 'asc' } },
        { fechaVencimiento: 'asc' },
      ],
    });

    const now = new Date();

    let totalFisico = 0;
    let totalDisponibleBruto = 0;
    let totalDisponibleVendible = 0;
    let totalReservado = 0;
    let totalBloqueado = 0;
    let totalTransitoUbicacion = 0;
    let totalStaging = 0;
    let totalMerma = 0;
    let totalExceso = 0;
    let totalCuarentenaOtros = 0;
    let totalExpirado = 0;

    const items = allLots.map((l) => {
      const locClass = classifyLocationOperationalRole(l.ubicacion);
      const ev = evaluateInventoryItemOperationalState(l, locClass, now);

      let tipoClasificacion: 'CONFORME' | 'MERMA' | 'EXCESO' | 'CUARENTENA' | 'EXPIRADO' | 'TRANSITO' | 'STAGING' = 'CONFORME';
      if (ev.estadoPrincipal === 'MERMA') {
        tipoClasificacion = 'MERMA';
      } else if (ev.estadoPrincipal === 'EXCESO') {
        tipoClasificacion = 'EXCESO';
      } else if (ev.estadoPrincipal === 'CUARENTENA') {
        tipoClasificacion = 'CUARENTENA';
      } else if (ev.estadoPrincipal === 'VENCIDO') {
        tipoClasificacion = 'EXPIRADO';
      } else if (ev.estadoPrincipal === 'TRANSITO_INTERNO') {
        tipoClasificacion = 'TRANSITO';
      } else if (ev.estadoPrincipal === 'NO_ELEGIBLE_SURTIDO') {
        tipoClasificacion = 'STAGING';
      } else {
        tipoClasificacion = 'CONFORME';
      }

      if (tipoClasificacion === 'STAGING') {
        totalStaging += ev.cantidadFisica;
      }

      totalFisico += ev.cantidadFisica;
      totalDisponibleBruto += (l.cantidadDisponible || 0);
      totalDisponibleVendible += ev.cantidadDisponibleVendible;
      totalReservado += ev.cantidadReservada;
      totalBloqueado += ev.cantidadBloqueada;
      totalTransitoUbicacion += ev.cantidadTransitoVigente;
      totalExpirado += ev.cantidadExpirada;
      totalMerma += ev.desgloseBloqueado.merma;
      totalExceso += ev.desgloseBloqueado.exceso;
      totalCuarentenaOtros += ev.desgloseBloqueado.cuarentenaOtros;

      return {
        id: l.id,
        skuId: l.skuId,
        sku: l.sku,
        clienteId: l.clienteId,
        cliente: l.cliente,
        lote: l.lote,
        serie: l.serie,
        fechaVencimiento: l.fechaVencimiento,
        fechaProduccion: l.fechaProduccion,
        ubicacionId: l.ubicacionId,
        ubicacion: l.ubicacion,
        estadoCalidad: l.estadoCalidad,
        clasificacion: tipoClasificacion,
        estadoPrincipalOperativo: ev.estadoPrincipal,
        badgeOperativoTexto: ev.badgeTexto,
        motivoOperativo: ev.motivo,
        rolOperativoUbicacion: locClass.rolOperativo,
        esUbicacionVendible: locClass.esVendible,
        esTransitoInterno: locClass.esTransitoInterno,
        estadoOperativoUbicacion: locClass.badgeTexto,
        motivoNoVendible: !locClass.esVendible ? locClass.motivoNoVendible : undefined,
        cantidadFisica: ev.cantidadFisica,
        cantidadDisponible: Number(l.cantidadDisponible || 0),
        cantidadDisponibleVendible: ev.cantidadDisponibleVendible,
        cantidadNoVendibleUbicacion: ev.cantidadTransitoVigente,
        cantidadReservada: ev.cantidadReservada,
        cantidadBloqueada: ev.cantidadBloqueada,
        isExpired: ev.esVencido,
        isBlocked: l.estadoCalidad !== 'LIBERADO',
        esVendible: ev.esVendible,
        esElegiblePutawayComercial: ev.esElegiblePutawayComercial,
        esElegibleAllocation: ev.esElegibleAllocation,
        esElegiblePicking: ev.esElegiblePicking,
        esVisiblePortalComoDisponible: ev.esVisiblePortalComoDisponible,
        notas: l.notas,
        totalHus: (l.handlingUnits || []).length,
        handlingUnits: (l.handlingUnits || []).map((h) => ({
          ...h,
          estado: h.estadoHu,
          ubicacionCodigo: l.ubicacion?.codigo,
        })),
        createdAt: l.createdAt,
        updatedAt: l.updatedAt,
      };
    });

    // Filtrar items según query params
    const filteredItems = items.filter(item => {
      if (clasificacion && clasificacion !== 'TODOS') {
        if (clasificacion === 'BLOQUEADO') {
          if (item.cantidadBloqueada <= 0) return false;
        } else if (clasificacion === 'TRANSITO' || clasificacion === 'EN_TRANSITO') {
          if (!item.esTransitoInterno && item.clasificacion !== 'TRANSITO') return false;
        } else if (item.clasificacion !== clasificacion) {
          return false;
        }
      }
      if (search && search.trim()) {
        const q = search.toLowerCase().trim();
        const matchHu = item.handlingUnits?.some(
          (h: any) =>
            h.codigo?.toLowerCase().includes(q) ||
            h.loteTexto?.toLowerCase().includes(q),
        );
        const match =
          item.sku?.codigo?.toLowerCase().includes(q) ||
          item.sku?.descripcion?.toLowerCase().includes(q) ||
          item.lote?.toLowerCase().includes(q) ||
          item.ubicacion?.codigo?.toLowerCase().includes(q) ||
          item.cliente?.nombreComercial?.toLowerCase().includes(q) ||
          (item.notas && item.notas.toLowerCase().includes(q)) ||
          matchHu;
        if (!match) return false;
      }
      return true;
    });

    const uniqueSkus = new Set(allLots.map(l => l.skuId)).size;
    const uniqueLotes = new Set(allLots.map(l => `${l.skuId}-${l.lote || 'SL'}`)).size;

    return {
      kpis: {
        totalFisico,
        totalDisponibleBruto,
        totalDisponibleVendible,
        totalReservado,
        totalBloqueado,
        totalTransito: totalTransitoUbicacion,
        totalTransitoUbicacion,
        totalStaging,
        totalNoVendiblePorUbicacion: totalTransitoUbicacion,
        desgloseBloqueado: {
          totalMerma,
          totalExceso,
          totalCuarentenaOtros,
        },
        totalExpirado,
        totalSkus: uniqueSkus,
        totalLotes: uniqueLotes,
        reglaCalculo: {
          totalFisico: 'cantidadDisponible + cantidadBloqueada',
          totalDisponibleBruto: 'cantidadDisponible física total',
          disponibleVendible: 'cantidadDisponible - cantidadReservada (exclusivamente en racks ALMACENABLE_COMERCIAL, LIBERADO y no vencido)',
          transitoUbicacion: 'Mercancía física en andenes/recibo/tránsito vigente (excluye mercancía vencida)',
          reservado: 'cantidadReservada en pedidos de salida',
          bloqueadoTotal: 'cantidadBloqueada (Merma + Exceso + Cuarentena)',
          expirado: 'cantidad de existencias vencidas (tanto en tránsito como en rack, excluyendo merma)',
          ecuacionConciliacion: 'Fisico Total = Disponible Vendible + Reservado + Expirado + Bloqueado Total + En Tránsito',
          diferenciaConciliacion: totalFisico - (totalDisponibleVendible + totalReservado + totalExpirado + totalBloqueado + totalTransitoUbicacion),
        },
      },
      totalItems: filteredItems.length,
      items: filteredItems,
    };
  }

  // ============ SUBFLUJO: DESVIAR A ALMACÉN VIRTUAL NO CONFORME / MERMA ============
  @Post('divert-to-virtual')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Desviar producto dañado o en exceso a almacén virtual de No Conforme / Merma',
    description: 'Segrega físicamente e impacta en base de datos la mercancía averiada o con excedente físico, colocándola con estado CUARENTENA y cantidadBloqueada en el Almacén Virtual para que no sea elegible para picking ni venta.',
  })
  async divertToVirtual(@Body() body: DivertToVirtualDto) {
    if (!body.clienteId) {
      throw new HttpException(
        { statusCode: HttpStatus.BAD_REQUEST, message: 'clienteId es obligatorio para desviar inventario', error: 'Bad Request' },
        HttpStatus.BAD_REQUEST,
      );
    }

    const partidasList = (Array.isArray(body.partidas) && body.partidas.length > 0)
      ? body.partidas
      : (Array.isArray((body as any).items) && (body as any).items.length > 0 ? (body as any).items : null);

    if (!partidasList || partidasList.length === 0) {
      throw new HttpException(
        { statusCode: HttpStatus.BAD_REQUEST, message: 'Debe especificar al menos una partida para desviar', error: 'Bad Request' },
        HttpStatus.BAD_REQUEST,
      );
    }

    const client = await this.prisma.client.findUnique({ where: { id: body.clienteId } });
    if (!client) {
      throw new HttpException(
        { statusCode: HttpStatus.NOT_FOUND, message: `Cliente con ID ${body.clienteId} no encontrado`, error: 'Not Found' },
        HttpStatus.NOT_FOUND,
      );
    }

    // Asegurar ubicaciones virtuales en la base de datos (idempotente)
    const locs = await this.ensureVirtualLocations();

    let totalPieces = 0;
    for (const p of partidasList) {
      const qty = Number(p.cantidad) || 0;
      if (qty <= 0) {
        throw new HttpException(
          { statusCode: HttpStatus.BAD_REQUEST, message: `La cantidad a desviar para el SKU ${p.skuId} debe ser mayor a 0`, error: 'Bad Request' },
          HttpStatus.BAD_REQUEST,
        );
      }
      p.motivo = p.motivo?.trim() || (p as any).motivoEspecifico?.trim() || (body as any).motivo?.trim() || (body as any).notas?.trim() || 'Desvío operativo a almacén virtual';
      p.tipoDesvio = p.tipoDesvio || ((body as any).tipoDesvio === 'EXCESO' || (body as any).tipoDesvio === 'PRODUCTO_EXCESO' ? 'PRODUCTO_EXCESO' : 'MERCANCIA_DANADA');
      totalPieces += qty;
    }

    const usuarioResponsable = body.usuario || (body as any).user || 'Supervisor Giving Out';

    return withConcurrencyRetry(async () => {
      return this.prisma.$transaction(async (tx) => {
        // Contador para folio de acta oficial y secuencia HU resistente a eliminaciones
        const currentYear = new Date().getFullYear();
        const actaPrefix = `ACTA-NC-${currentYear}-`;
        const existingActas = await tx.inventoryMovement.findMany({
          where: { documentoOrigen: { startsWith: actaPrefix } },
          select: { documentoOrigen: true },
        });
        let maxActaSeq = 0;
        for (const a of existingActas) {
          const num = parseInt(a.documentoOrigen?.replace(actaPrefix, '') || '0', 10);
          if (!isNaN(num) && num > maxActaSeq) maxActaSeq = num;
        }
        const folioActa = `${actaPrefix}${String(maxActaSeq + 1).padStart(5, '0')}`;

        const huPrefix = `HU-NC-${currentYear}-`;
        const existingNcs = await tx.handlingUnit.findMany({
          where: { codigo: { startsWith: huPrefix } },
          select: { codigo: true },
        });
        let maxHuSeq = 0;
        for (const h of existingNcs) {
          const num = parseInt(h.codigo.replace(huPrefix, '') || '0', 10);
          if (!isNaN(num) && num > maxHuSeq) maxHuSeq = num;
        }
        let huSequence = maxHuSeq;
        const divertedDetails: any[] = [];

        for (const item of partidasList) {
          const sku = await tx.skuMaster.findUnique({ where: { id: item.skuId } });
          if (!sku) {
            throw new HttpException(
              { statusCode: HttpStatus.NOT_FOUND, message: `SKU ${item.skuId} no encontrado en catálogo`, error: 'Not Found' },
              HttpStatus.NOT_FOUND,
            );
          }

          // Determinar ubicación destino en almacén virtual
          let destLocId = item.ubicacionDestinoId;
          if (!destLocId) {
            destLocId = item.tipoDesvio === 'PRODUCTO_EXCESO' ? locs.excesoLoc.id : locs.devLoc.id;
          }

          const targetLoc = await tx.location.findUnique({ where: { id: destLocId } });
          if (!targetLoc) {
            throw new HttpException(
              { statusCode: HttpStatus.NOT_FOUND, message: `Ubicación destino ${destLocId} no encontrada`, error: 'Not Found' },
              HttpStatus.NOT_FOUND,
            );
          }

          // Buscar si existe una HU origen conocida
          const originHuId = (item as any).huId || (item as any).originHuId || (item as any).cajaOrigenId;
          let originHu: any = null;
          if (originHuId) {
            originHu = await tx.handlingUnit.findUnique({ where: { id: originHuId } });
          }

          // Determinar receiptId y receiptLineId sin inventar si no existe origen inequívoco
          let derivedReceiptId: string | null = null;
          let derivedReceiptLineId: string | null = null;

          if (originHu) {
            derivedReceiptId = originHu.receiptId || null;
            derivedReceiptLineId = originHu.receiptLineId || null;
          } else if (item.receiptLineId) {
            const rLine = await tx.receiptLine.findUnique({ where: { id: item.receiptLineId } });
            if (rLine) {
              derivedReceiptId = rLine.recepcionId || (rLine as any).receiptId || null;
              derivedReceiptLineId = rLine.id;
            }
          } else if (body.receiptId) {
            derivedReceiptId = body.receiptId;
          }

          // 1. Crear lote en LotInventory en estado CUARENTENA con cantidadBloqueada
          const lot = await tx.lotInventory.create({
            data: {
              skuId: item.skuId,
              clienteId: body.clienteId,
              lote: item.lote?.trim() || originHu?.loteTexto || null,
              fechaVencimiento: item.fechaVencimiento ? new Date(item.fechaVencimiento) : (originHu?.fechaVencimiento || null),
              estadoCalidad: 'CUARENTENA',
              cantidadBloqueada: item.cantidad,
              cantidadDisponible: 0,
              ubicacionId: destLocId,
              notas: `[ALMACEN_VIRTUAL_NC] ${item.tipoDesvio}: ${item.motivo.trim()} | Acta: ${folioActa}`,
            },
          });

          // 2. Crear Handling Unit segregada
          huSequence++;
          const huCode = `${huPrefix}${String(huSequence).padStart(5, '0')}`;
          const hu = await tx.handlingUnit.create({
            data: {
              codigo: huCode,
              tipoHu: item.tipoHu || originHu?.tipoHu || (item.cantidad >= 50 ? 'PALLET' : 'CAJA'),
              lotId: lot.id,
              clienteId: body.clienteId,
              receiptId: derivedReceiptId || undefined,
              receiptLineId: derivedReceiptLineId || undefined,
              cantidad: item.cantidad,
              uom: sku.uomBase || originHu?.uom || 'PZA',
              ubicacionActual: destLocId,
              estadoHu: 'CUARENTENA',
              skuCodigo: sku.codigo,
              skuDescripcion: sku.descripcion,
              loteTexto: item.lote?.trim() || originHu?.loteTexto || null,
              fechaVencimiento: item.fechaVencimiento ? new Date(item.fechaVencimiento) : (originHu?.fechaVencimiento || null),
              cajaOrigenId: originHu?.id || undefined,
              facturaRespaldo: originHu?.facturaRespaldo || undefined,
            },
          });

          // Si la HU origen existía y se desvió inventario de ella, descontar su saldo físico y el del lote asociado
          if (originHu) {
            if (originHu.cantidad < item.cantidad) {
              throw new HttpException(
                {
                  statusCode: HttpStatus.BAD_REQUEST,
                  message: `La cantidad a desviar (${item.cantidad}) excede el contenido disponible de la HU ${originHu.codigo} (${originHu.cantidad} pzas).`,
                  error: 'Bad Request',
                },
                HttpStatus.BAD_REQUEST,
              );
            }

            if (originHu.lotId) {
              await tx.lotInventory.update({
                where: { id: originHu.lotId },
                data: { cantidadDisponible: { decrement: item.cantidad } },
              });
            }

            if (originHu.cantidad > item.cantidad) {
              await tx.handlingUnit.update({
                where: { id: originHu.id },
                data: { cantidad: { decrement: item.cantidad } },
              });
            } else if (originHu.cantidad === item.cantidad) {
              await tx.handlingUnit.update({
                where: { id: originHu.id },
                data: {
                  cantidad: 0,
                  estadoHu: 'INACTIVO',
                  ubicacionActual: destLocId,
                  lotId: lot.id,
                },
              });
            }
          } else {
            // Si no se envió HU específica pero sí un lote origen, descontar del lote y de sus HUs activas
            const originLotId = (item as any).lotId || (item as any).originLotId;
            if (originLotId) {
              const originLot = await tx.lotInventory.findUnique({
                where: { id: originLotId },
                include: { handlingUnits: true },
              });
              if (originLot) {
                if (originLot.cantidadDisponible < item.cantidad) {
                  throw new HttpException(
                    {
                      statusCode: HttpStatus.BAD_REQUEST,
                      message: `La cantidad a desviar (${item.cantidad}) excede el saldo disponible del lote (${originLot.cantidadDisponible} pzas).`,
                      error: 'Bad Request',
                    },
                    HttpStatus.BAD_REQUEST,
                  );
                }
                await tx.lotInventory.update({
                  where: { id: originLot.id },
                  data: { cantidadDisponible: { decrement: item.cantidad } },
                });

                let remToDeduct = item.cantidad;
                const activeHus = (originLot.handlingUnits || []).filter((h: any) => h.estadoHu === 'ACTIVO' && h.cantidad > 0);
                for (const h of activeHus) {
                  if (remToDeduct <= 0) break;
                  const dec = Math.min(h.cantidad, remToDeduct);
                  if (h.cantidad === dec) {
                    await tx.handlingUnit.update({
                      where: { id: h.id },
                      data: { cantidad: 0, estadoHu: 'INACTIVO', ubicacionActual: destLocId, lotId: lot.id },
                    });
                  } else {
                    await tx.handlingUnit.update({
                      where: { id: h.id },
                      data: { cantidad: { decrement: dec } },
                    });
                  }
                  remToDeduct -= dec;
                }
              }
            }
          }

          // 3. Crear asiento inmutable en InventoryMovement
          const movTipo = item.tipoDesvio === 'MERCANCIA_DANADA' ? 'DESVIO_MERMA' : 'DESVIO_EXCESO';
          await tx.inventoryMovement.create({
            data: {
              tipoMovimiento: movTipo,
              almacenId: targetLoc.almacenId,
              skuId: item.skuId,
              clienteId: body.clienteId,
              lotId: lot.id,
              huId: hu.id,
              toLocationId: destLocId,
              cantidad: item.cantidad,
              usuario: usuarioResponsable,
              motivo: `[${item.tipoDesvio}] ${item.motivo.trim()} (Acta: ${folioActa})`,
              documentoOrigen: body.receiptId ? `REC-${body.receiptId}` : folioActa,
            },
          });

          // 4. Actualizar ocupación en ubicación virtual
          await tx.location.update({
            where: { id: destLocId },
            data: { ocupacion: { increment: 1 }, estado: 'OCUPADO' },
          });

          // 5. Si viene vinculado a una línea de recepción previa, actualizar trazabilidad
          if (body.receiptId && item.receiptLineId) {
            const rLine = await tx.receiptLine.findUnique({ where: { id: item.receiptLineId } });
            if (rLine) {
              const updateData: any = {};
              if (item.tipoDesvio === 'MERCANCIA_DANADA') {
                updateData.cantidadDanada = (rLine.cantidadDanada || 0) + item.cantidad;
              }
              await tx.receiptLine.update({
                where: { id: item.receiptLineId },
                data: updateData,
              });
            }
          }

          divertedDetails.push({
            skuId: item.skuId,
            skuCodigo: sku.codigo,
            descripcion: sku.descripcion,
            cantidad: item.cantidad,
            tipoDesvio: item.tipoDesvio,
            motivo: item.motivo.trim(),
            ubicacionCodigo: targetLoc.codigo,
            huCodigo: huCode,
            lotId: lot.id,
          });
        }

        // 6. Asiento formal en AuditLog
        await tx.auditLog.create({
          data: {
            usuario: body.usuario,
            accion: 'DESVIO_ALMACEN_VIRTUAL_NO_CONFORME',
            entidad: 'Inventory',
            entidadId: folioActa,
            detalle: `Desvío formal de ${totalPieces} pzas al Almacén Virtual de No Conforme / Merma. Acta: ${folioActa} | Cliente: ${client.nombreComercial}${body.receiptId ? ` | Previo: ${body.receiptId}` : ''}`,
          },
        });

        return {
          success: true,
          folioActa,
          fechaActa: new Date().toISOString(),
          cliente: client.nombreComercial,
          totalPartidas: body.partidas.length,
          totalPiezas: totalPieces,
          mensaje: `Se desviaron exitosamente ${totalPieces} piezas al Almacén Virtual de No Conforme / Merma bajo el acta ${folioActa}.`,
          partidasDesviadas: divertedDetails,
        };
      }, {
        maxWait: 15000,
        timeout: 45000,
      });
    }, { contextName: 'divertToVirtual', maxRetries: 5 });
  }

  // ============ CONSULTA: ALMACÉN VIRTUAL NO CONFORME / MERMA ============
  @Get('virtual-warehouse')
  @ApiOperation({ summary: 'Consultar inventario en Almacén Virtual de No Conforme / Merma' })
  @ApiQuery({ name: 'clienteId', required: false, description: 'Filtrar por cliente depositante' })
  @ApiQuery({ name: 'tipoDesvio', required: false, enum: ['TODOS', 'MERMA', 'EXCESO', 'MERCANCIA_DANADA', 'PRODUCTO_EXCESO'], description: 'Filtrar por tipo de no conformidad' })
  async getVirtualWarehouse(
    @Query('clienteId') clienteId?: string,
    @Query('tipoDesvio') tipoDesvio?: string,
  ) {
    const baseWhere: any = {
      cantidadBloqueada: { gt: 0 },
      estadoCalidad: { in: ['CUARENTENA', 'BLOQUEADO', 'MERMA'] },
    };
    if (clienteId) baseWhere.clienteId = clienteId;

    // Calcular estadísticas globales antes de aplicar filtro de tipo
    const allLots = await this.prisma.lotInventory.findMany({
      where: baseWhere,
      include: {
        ubicacion: { select: { codigo: true } },
      },
    });

    let totalPiezasBloqueadas = 0;
    let piezasDanadas = 0;
    let piezasExceso = 0;
    let lotesMerma = 0;
    let lotesExceso = 0;

    for (const l of allLots) {
      totalPiezasBloqueadas += l.cantidadBloqueada;
      const isExceso = l.ubicacion?.codigo === 'NC-EXCESO-01' || (l.notas && l.notas.includes('PRODUCTO_EXCESO'));
      if (isExceso) {
        piezasExceso += l.cantidadBloqueada;
        lotesExceso++;
      } else {
        piezasDanadas += l.cantidadBloqueada;
        lotesMerma++;
      }
    }

    const where: any = { ...baseWhere };

    if (tipoDesvio && tipoDesvio !== 'TODOS') {
      const cleanTipo = tipoDesvio.toUpperCase();
      if (cleanTipo === 'MERMA' || cleanTipo === 'MERCANCIA_DANADA' || cleanTipo === 'DANADO') {
        where.AND = [
          {
            OR: [
              { ubicacion: { codigo: { in: ['DEV-01', 'NC-MERMA-01'] } } },
              { ubicacion: { tipoUbicacion: 'DEVOLUCION' } },
              { notas: { contains: 'MERCANCIA_DANADA' } },
              { notas: { contains: 'MERMA' } },
              { notas: null },
            ],
          },
          {
            ubicacion: { codigo: { not: 'NC-EXCESO-01' } },
          },
        ];
      } else if (cleanTipo === 'EXCESO' || cleanTipo === 'PRODUCTO_EXCESO' || cleanTipo === 'SOBRANTE') {
        where.OR = [
          { ubicacion: { codigo: 'NC-EXCESO-01' } },
          { notas: { contains: 'PRODUCTO_EXCESO' } },
          { notas: { contains: 'EXCESO' } },
        ];
      } else {
        where.notas = { contains: tipoDesvio };
      }
    }

    const lots = await this.prisma.lotInventory.findMany({
      where,
      include: {
        sku: { select: { codigo: true, descripcion: true, categoria: true, talla: true, color: true, uomBase: true } },
        cliente: { select: { nombreComercial: true, giro: true } },
        ubicacion: { select: { codigo: true, tipoUbicacion: true, zona: { select: { codigo: true, nombre: true } } } },
        handlingUnits: { select: { codigo: true, tipoHu: true, estadoHu: true, cantidad: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      totalLotes: allLots.length,
      totalLotesFiltrados: lots.length,
      lotesMerma,
      lotesExceso,
      totalPiezasBloqueadas,
      piezasDanadas,
      piezasExceso,
      almacenVirtual: {
        codigo: 'ALM-VIRTUAL-NC',
        nombre: 'Almacén Virtual de No Conforme / Merma',
        zonaDefault: 'DEVOLUCION',
        ubicaciones: ['DEV-01', 'NC-MERMA-01', 'NC-EXCESO-01'],
      },
      lotes: lots,
    };
  }

  @Post('transfer')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Transferir / Mover inventario entre ubicaciones (Rack A -> Rack B) bajo protocolo de concurrencia WMS (Etapa 5A.1)',
  })
  async transfer(@Body() body: any) {
    const items = body.items || [body];
    return this.transferToVirtual({ ...body, items, tipoOperacion: body.tipoOperacion || 'TRANSFERENCIA' });
  }

  @Post('quarantine')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Enviar inventario a Cuarentena (retención preventiva por calidad/daño/inspección) bajo protocolo de concurrencia WMS',
  })
  async quarantine(@Body() body: any) {
    const items = body.items || [body];
    return this.transferToVirtual({ ...body, items, tipoOperacion: 'CUARENTENA' });
  }

  // ============ TRANSFERENCIA MANUAL Y MASIVA A ALMACÉN VIRTUAL / ENTRE RACKS ============
  @Post('transfer-to-virtual')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Transferir inventario (individual o masivo) de Stock Operativo a Almacén Virtual o entre racks',
    description: 'Disminuye Stock Operativo, aumenta Almacén Virtual/destino comercial, y registra Kárdex y auditoría inmutable bajo protocolo transaccional.',
  })
  async transferToVirtual(@Body() body: TransferToVirtualDto) {
    if (!body.items || !Array.isArray(body.items) || body.items.length === 0) {
      throw new HttpException(
        { statusCode: HttpStatus.BAD_REQUEST, message: 'Debe proporcionar al menos un ítem para la operación', error: 'Bad Request' },
        HttpStatus.BAD_REQUEST,
      );
    }

    const usuario = body.usuario?.trim() || 'Supervisor de Inventario';
    const locs = await this.ensureVirtualLocations();
    const tipoOperacion: 'TRANSFERENCIA' | 'CUARENTENA' = body.tipoOperacion || (
      body.ubicacionDestinoId && (body.ubicacionDestinoId.includes('NC-') || body.ubicacionDestinoId.includes('DEV-'))
        ? 'CUARENTENA'
        : 'TRANSFERENCIA'
    );

    // 1. Identificar IDs preliminares para adquisición determinista de candados
    const candidateHuIds = body.items.map(i => i.huId).filter(Boolean) as string[];
    const lotIds = body.items.map(i => i.lotId).filter(Boolean);
    const preLots = await this.prisma.lotInventory.findMany({
      where: { id: { in: lotIds } },
      select: { ubicacionId: true },
    });
    const originLocIds = preLots.map(l => l.ubicacionId).filter(Boolean) as string[];
    const destLocIds = body.ubicacionDestinoId ? [body.ubicacionDestinoId] : [locs.devLoc.id, locs.excesoLoc.id];
    const locationIds = [...new Set([...originLocIds, ...destLocIds])];

    return await this.putawayEngine.executePhysicalMovementProtocol(
      this.prisma,
      {
        huIds: candidateHuIds,
        locationIds,
        opName: tipoOperacion === 'CUARENTENA' ? 'inventoryQuarantine' : 'inventoryTransfer',
      },
      async (tx) => {
        let totalPiezas = 0;
        const transferidos: any[] = [];
        const currentYear = new Date().getFullYear();
        const huPrefix = `HU-NC-${currentYear}-`;
        const existingNcs = await tx.handlingUnit.findMany({
          where: { codigo: { startsWith: huPrefix } },
          select: { codigo: true },
        });
        let maxHuSeq = 0;
        for (const h of existingNcs) {
          const num = parseInt(h.codigo.replace(huPrefix, '') || '0', 10);
          if (!isNaN(num) && num > maxHuSeq) maxHuSeq = num;
        }
        let huSequence = maxHuSeq;

        // Determinar ubicación de destino general
        let defaultDestLoc: any = null;
        if (body.ubicacionDestinoId) {
          defaultDestLoc = await tx.location.findFirst({
            where: { OR: [{ id: body.ubicacionDestinoId }, { codigo: body.ubicacionDestinoId }] },
            include: { zona: true }
          });
          if (!defaultDestLoc) {
            throw new HttpException(
              { statusCode: HttpStatus.NOT_FOUND, message: `Ubicación destino ${body.ubicacionDestinoId} no encontrada`, error: 'Not Found' },
              HttpStatus.NOT_FOUND,
            );
          }
        } else if (tipoOperacion === 'CUARENTENA') {
          defaultDestLoc = locs.excesoLoc; // NC-EXCESO-01 para retención preventiva
        } else {
          throw new HttpException(
            { statusCode: HttpStatus.BAD_REQUEST, message: 'Debe especificar una ubicación destino para la transferencia', error: 'Bad Request' },
            HttpStatus.BAD_REQUEST,
          );
        }

        if (!defaultDestLoc.activo) {
          throw new HttpException(
            { statusCode: HttpStatus.CONFLICT, message: `La ubicación destino ${defaultDestLoc.codigo} se encuentra inactiva.`, error: 'Conflict' },
            HttpStatus.CONFLICT,
          );
        }

        if (defaultDestLoc.estado === 'BLOQUEADO') {
          throw new HttpException(
            { statusCode: HttpStatus.CONFLICT, message: `La ubicación destino ${defaultDestLoc.codigo} se encuentra bloqueada operativamente.`, error: 'Conflict' },
            HttpStatus.CONFLICT,
          );
        }

        const destClassification = this.putawayEngine.classifyLocation(defaultDestLoc);

        if (tipoOperacion === 'TRANSFERENCIA') {
          // Destino comercial debe ser un rack almacenable comercial
          if (!destClassification.esAlmacenable || ['CUARENTENA', 'DEVOLUCION', 'RECIBO', 'STAGING'].includes(defaultDestLoc.tipoUbicacion) || ['DEV-01', 'NC-EXCESO-01', 'REC-01', 'STG-01'].includes(defaultDestLoc.codigo)) {
            throw new HttpException(
              { statusCode: HttpStatus.BAD_REQUEST, message: `La ubicación ${defaultDestLoc.codigo} no es un rack de almacenamiento comercial elegible para trasiego.`, error: 'Bad Request' },
              HttpStatus.BAD_REQUEST,
            );
          }
        }

        for (const item of body.items) {
          const qty = Number(item.cantidad);
          if (isNaN(qty) || qty <= 0) {
            throw new HttpException(
              { statusCode: HttpStatus.BAD_REQUEST, message: 'La cantidad a transferir debe ser mayor a 0', error: 'Bad Request' },
              HttpStatus.BAD_REQUEST,
            );
          }

          const originLot = await tx.lotInventory.findUnique({
            where: { id: item.lotId },
            include: { sku: true, cliente: true, ubicacion: true, handlingUnits: true },
          });

          if (!originLot) {
            throw new HttpException(
              { statusCode: HttpStatus.NOT_FOUND, message: `Lote de inventario ${item.lotId} no encontrado`, error: 'Not Found' },
              HttpStatus.NOT_FOUND,
            );
          }

          const destLoc = defaultDestLoc;

          // 1. Validar que origen != destino
          if (originLot.ubicacionId === destLoc.id || originLot.ubicacion?.codigo === destLoc.codigo) {
            throw new HttpException(
              { statusCode: HttpStatus.BAD_REQUEST, message: `La ubicación destino debe ser diferente a la ubicación origen (${originLot.ubicacion?.codigo || 'origen'}).`, error: 'Bad Request' },
              HttpStatus.BAD_REQUEST,
            );
          }

          // 2. Validar que origen no sea STAGING ni RECIBO
          if (originLot.ubicacion?.tipoUbicacion === 'STAGING' || originLot.ubicacion?.codigo?.startsWith('STG-')) {
            throw new HttpException(
              { statusCode: HttpStatus.CONFLICT, message: `La mercancía en área de Staging/Consolidación (${originLot.ubicacion.codigo}) está comprometida para despacho y no puede ser transferida manualmente.`, error: 'Conflict' },
              HttpStatus.CONFLICT,
            );
          }
          if (originLot.ubicacion?.tipoUbicacion === 'RECIBO' || originLot.ubicacion?.codigo === 'REC-01') {
            throw new HttpException(
              { statusCode: HttpStatus.CONFLICT, message: `La mercancía en andén de recibo (${originLot.ubicacion.codigo}) debe alojarse mediante el protocolo de Putaway.`, error: 'Conflict' },
              HttpStatus.CONFLICT,
            );
          }

          // 3. Reglas operativas por tipo de operación
          const isExpiredLot = originLot.fechaVencimiento ? new Date(originLot.fechaVencimiento) <= new Date() : false;
          if (tipoOperacion === 'TRANSFERENCIA') {
            if (isExpiredLot) {
              throw new HttpException(
                { statusCode: HttpStatus.CONFLICT, message: 'MERCANCÍA VENCIDA — No se permite transferir producto caducado hacia racks comerciales vendibles.', error: 'Conflict' },
                HttpStatus.CONFLICT,
              );
            }
            if (originLot.estadoCalidad === 'MERMA' || originLot.ubicacion?.codigo === 'DEV-01') {
              throw new HttpException(
                { statusCode: HttpStatus.CONFLICT, message: 'La mercancía en Merma no puede transferirse hacia inventario comercial.', error: 'Conflict' },
                HttpStatus.CONFLICT,
              );
            }
          }

          // 4. Validar cantidad física disponible no reservada
          const cantFisica = originLot.cantidadDisponible || 0;
          const cantReservada = originLot.cantidadReservada || 0;
          const disponibleParaTransferir = Math.max(0, cantFisica - cantReservada);

          if (qty > disponibleParaTransferir) {
            throw new HttpException(
              {
                statusCode: HttpStatus.CONFLICT,
                message: `Cantidad insuficiente para transferir en el SKU ${originLot.sku.codigo} (Lote: ${originLot.lote || 'N/A'}). Físico disponible no reservado: ${disponibleParaTransferir}, Solicitado: ${qty}`,
                error: 'Conflict',
              },
              HttpStatus.CONFLICT,
            );
          }

          // 5. Validar HU si viene especificada
          let originHu: any = null;
          if (item.huId) {
            originHu = await tx.handlingUnit.findUnique({ where: { id: item.huId } });
            if (!originHu) {
              throw new HttpException(
                { statusCode: HttpStatus.NOT_FOUND, message: `HandlingUnit ${item.huId} no encontrada`, error: 'Not Found' },
                HttpStatus.NOT_FOUND,
              );
            }

            // Validar que la HU pertenezca al lote y ubicación esperados (idempotencia y protección contra concurrencia)
            if (originHu.lotId !== originLot.id || (originHu.ubicacionActual !== originLot.ubicacion?.codigo && originHu.ubicacionActual !== originLot.ubicacionId)) {
              throw new HttpException(
                {
                  statusCode: HttpStatus.CONFLICT,
                  message: `La HU ${originHu.codigo} ya no se encuentra en la ubicación de origen ${originLot.ubicacion?.codigo}. Es posible que haya sido reubicada por otra operación concurrente.`,
                  error: 'Conflict',
                },
                HttpStatus.CONFLICT,
              );
            }

            // Validar que no esté comprometida en un pedido activo (Picking / Asignación)
            const activeOrderCommitment = await tx.salesOrderLine.findFirst({
              where: {
                OR: [
                  { huId: originHu.id },
                  { cajaEscaneada: originHu.codigo },
                ],
                orden: {
                  estado: { in: ['APROBADO', 'EN_PICKING', 'CONSOLIDADO'] }
                }
              },
              include: { orden: true }
            });

            if (activeOrderCommitment) {
              throw new HttpException(
                {
                  statusCode: HttpStatus.CONFLICT,
                  message: `La HU ${originHu.codigo} está comprometida en el pedido activo ${activeOrderCommitment.orden.codigo} (estado: ${activeOrderCommitment.orden.estado}). No puede ser transferida ni enviada a cuarentena.`,
                  error: 'Conflict',
                },
                HttpStatus.CONFLICT,
              );
            }

            if (qty > originHu.cantidad) {
              throw new HttpException(
                {
                  statusCode: HttpStatus.BAD_REQUEST,
                  message: `La cantidad a transferir (${qty}) excede el contenido disponible de la HU ${originHu.codigo} (${originHu.cantidad} pzas).`,
                  error: 'Bad Request',
                },
                HttpStatus.BAD_REQUEST,
              );
            }
          }

          // 6. Validar capacidad si el destino es almacenable comercial
          if (destClassification.esAlmacenable && tipoOperacion === 'TRANSFERENCIA') {
            const reval = await this.putawayEngine.revalidateLocationForPutaway(
              destLoc.id,
              qty,
              tx,
              {
                huBultos: item.huId ? 1 : 0,
                client: originLot.cliente,
                item: {
                  huId: item.huId || '',
                  huCodigo: originHu?.codigo || '',
                  tipoHu: originHu?.tipoHu || 'CAJA',
                  skuId: originLot.skuId,
                  skuCodigo: originLot.sku?.codigo || '',
                  skuDescripcion: originLot.sku?.descripcion || '',
                  skuCategoria: originLot.sku?.categoria || '',
                  cantidad: qty,
                  lote: originLot.lote || '',
                  fechaVencimiento: originLot.fechaVencimiento ? new Date(originLot.fechaVencimiento).toISOString() : null,
                  ubicacionActual: originLot.ubicacion?.codigo || 'RACK',
                  skuTemperatura: originLot.sku?.temperaturaRequerida || 'AMBIENTE',
                },
              },
            );

            if (!reval.valid) {
              throw new HttpException(
                {
                  statusCode: HttpStatus.CONFLICT,
                  message: reval.error || `La ubicación destino comercial ${destLoc.codigo} no tiene capacidad suficiente para recibir el trasiego.`,
                  error: 'Conflict',
                },
                HttpStatus.CONFLICT,
              );
            }
          }

          const motivo = (item.motivo || body.motivoGeneral || (tipoOperacion === 'CUARENTENA' ? 'Retención preventiva en cuarentena' : 'Reubicación operativa')).trim();
          const obs = (item.observaciones || body.observaciones || '').trim();

          // 7. Descontar del lote origen
          await tx.lotInventory.update({
            where: { id: originLot.id },
            data: {
              cantidadDisponible: { decrement: qty },
            },
          });

          // 8. Incrementar o crear registro en destino
          let targetLotId: string;
          if (tipoOperacion === 'CUARENTENA') {
            // EN CUARENTENA: Calidad CUARENTENA (¡NUNCA MERMA!), cantidadBloqueada = qty, vendible = 0
            const virtualLot = await tx.lotInventory.create({
              data: {
                skuId: originLot.skuId,
                clienteId: originLot.clienteId,
                lote: originLot.lote,
                fechaVencimiento: originLot.fechaVencimiento,
                estadoCalidad: 'CUARENTENA',
                cantidadBloqueada: qty,
                cantidadDisponible: 0,
                ubicacionId: destLoc.id,
                notas: `[CUARENTENA] Retención preventiva desde ${originLot.ubicacion?.codigo || 'Stock'}: ${motivo}${obs ? ` | Obs: ${obs}` : ''}`,
              },
            });
            targetLotId = virtualLot.id;
          } else {
            // EN TRASIEGO COMERCIAL: Conserva estadoCalidad ('LIBERADO'), vendible = qty, bloqueado = 0
            const existingDestLot = await tx.lotInventory.findFirst({
              where: {
                skuId: originLot.skuId,
                clienteId: originLot.clienteId,
                lote: originLot.lote,
                ubicacionId: destLoc.id,
                estadoCalidad: originLot.estadoCalidad || 'LIBERADO',
              },
            });

            if (existingDestLot) {
              await tx.lotInventory.update({
                where: { id: existingDestLot.id },
                data: { cantidadDisponible: { increment: qty } },
              });
              targetLotId = existingDestLot.id;
            } else {
              const newDestLot = await tx.lotInventory.create({
                data: {
                  skuId: originLot.skuId,
                  clienteId: originLot.clienteId,
                  lote: originLot.lote,
                  fechaVencimiento: originLot.fechaVencimiento,
                  estadoCalidad: originLot.estadoCalidad || 'LIBERADO',
                  cantidadDisponible: qty,
                  cantidadBloqueada: 0,
                  ubicacionId: destLoc.id,
                  notas: `Trasiego desde ${originLot.ubicacion?.codigo || 'Stock'}: ${motivo}${obs ? ` | Obs: ${obs}` : ''}`,
                },
              });
              targetLotId = newDestLot.id;
            }
          }

          // 9. Manejo de Handling Unit
          let huIdFinal: string | null = null;
          if (item.huId && originHu) {
            if (originHu.cantidad === qty) {
              await tx.handlingUnit.update({
                where: { id: originHu.id },
                data: {
                  ubicacionActual: destLoc.codigo,
                  estadoHu: tipoOperacion === 'CUARENTENA' ? 'CUARENTENA' : 'ACTIVO',
                  lotId: targetLotId,
                },
              });
              huIdFinal = originHu.id;
            } else {
              await tx.handlingUnit.update({
                where: { id: originHu.id },
                data: { cantidad: { decrement: qty } },
              });
              huSequence++;
              const newHuCode = tipoOperacion === 'CUARENTENA'
                ? `${huPrefix}${String(huSequence).padStart(5, '0')}`
                : `HU-T-${String(huSequence).padStart(5, '0')}`;
              const createdHu = await tx.handlingUnit.create({
                data: {
                  codigo: newHuCode,
                  tipoHu: originHu.tipoHu || 'CAJA',
                  lotId: targetLotId,
                  clienteId: originHu.clienteId || originLot.clienteId,
                  receiptId: originHu.receiptId || null,
                  receiptLineId: originHu.receiptLineId || null,
                  cantidad: qty,
                  uom: originHu.uom || 'PZA',
                  ubicacionActual: destLoc.codigo,
                  estadoHu: tipoOperacion === 'CUARENTENA' ? 'CUARENTENA' : 'ACTIVO',
                  loteTexto: originHu.loteTexto || originLot.lote,
                  skuCodigo: originHu.skuCodigo || originLot.sku.codigo,
                  skuDescripcion: originHu.skuDescripcion || originLot.sku.descripcion,
                  fechaVencimiento: originHu.fechaVencimiento || originLot.fechaVencimiento,
                  facturaRespaldo: originHu.facturaRespaldo || null,
                  cajaOrigenId: originHu.id,
                  parentHuId: tipoOperacion === 'CUARENTENA' ? null : originHu.parentHuId,
                },
              });
              huIdFinal = createdHu.id;
            }
          } else {
            // Inventario legado sin HU: NO inventar HU
            huIdFinal = null;
          }

          // 10. Registrar movimiento formal de inventario (Kárdex)
          await tx.inventoryMovement.create({
            data: {
              tipoMovimiento: 'TRASIEGO',
              almacenId: destLoc.almacenId,
              skuId: originLot.skuId,
              clienteId: originLot.clienteId,
              lotId: targetLotId,
              huId: huIdFinal,
              fromLocationId: originLot.ubicacionId,
              toLocationId: destLoc.id,
              cantidad: qty,
              usuario,
              motivo: `[${tipoOperacion === 'CUARENTENA' ? 'CUARENTENA' : 'TRASIEGO'}] ${motivo}${obs ? ` - Obs: ${obs}` : ''}`,
              documentoOrigen: tipoOperacion === 'CUARENTENA' ? 'ENVIO_CUARENTENA' : 'TRASIEGO_MANUAL',
            },
          });

          // 11. Registrar AuditLog inmutable
          await tx.auditLog.create({
            data: {
              usuario,
              accion: tipoOperacion === 'CUARENTENA' ? 'ENVIO_A_CUARENTENA' : 'TRASIEGO_ENTRE_UBICACIONES',
              entidad: 'LotInventory',
              entidadId: targetLotId,
              detalle: `${tipoOperacion === 'CUARENTENA' ? 'Desvío a Cuarentena' : 'Trasiego'} de ${qty} pzas del SKU ${originLot.sku.codigo} (Lote: ${originLot.lote || 'N/A'}${originHu ? `, HU: ${originHu.codigo}` : ''}) desde ${originLot.ubicacion?.codigo || 'Stock'} hacia ${destLoc.codigo}. Motivo: ${motivo}`,
            },
          });

          totalPiezas += qty;
          transferidos.push({
            skuCodigo: originLot.sku.codigo,
            descripcion: originLot.sku.descripcion,
            lote: originLot.lote,
            huCodigo: originHu?.codigo || null,
            cantidad: qty,
            origen: originLot.ubicacion?.codigo || 'Stock Operativo',
            destino: destLoc.codigo,
            tipoOperacion,
            motivo,
          });
        }

        return {
          success: true,
          tipoOperacion,
          totalItems: body.items.length,
          totalPiezas,
          mensaje: tipoOperacion === 'CUARENTENA'
            ? `Se enviaron exitosamente ${totalPiezas} piezas a Cuarentena (${transferidos[0]?.destino || 'NC-EXCESO-01'}).`
            : `Se transfirieron exitosamente ${totalPiezas} piezas hacia ${transferidos[0]?.destino || 'destino'}.`,
          itemsTransferidos: transferidos,
        };
      },
    );
  }

  // ============ LIBERAR / REINTEGRAR A STOCK OPERATIVO ============
  @Post('quarantine/release')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Liberar mercancía de cuarentena a Stock Operativo bajo protocolo de concurrencia (Etapa 5A.1)',
  })
  async releaseQuarantine(@Body() body: ReleaseFromVirtualDto) {
    return this.releaseFromVirtual(body);
  }

  @Post('release-from-virtual')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Liberar / Reintegrar mercancía de Almacén Virtual a Stock Operativo bajo protocolo de concurrencia (Etapa 5A.1)',
    description: 'Valida estrictamente caducidad, merma y capacidad física bajo protocolo de concurrencia antes de reintegrar inventario a disponibilidad comercial.',
  })
  async releaseFromVirtual(@Body() body: ReleaseFromVirtualDto) {
    if (!body.lotId) {
      throw new HttpException(
        { statusCode: HttpStatus.BAD_REQUEST, message: 'lotId es obligatorio', error: 'Bad Request' },
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!body.motivo || !body.motivo.trim()) {
      throw new HttpException(
        { statusCode: HttpStatus.BAD_REQUEST, message: 'El motivo de liberación es obligatorio', error: 'Bad Request' },
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!body.usuario || !body.usuario.trim()) {
      throw new HttpException(
        { statusCode: HttpStatus.BAD_REQUEST, message: 'El usuario responsable es obligatorio', error: 'Bad Request' },
        HttpStatus.BAD_REQUEST,
      );
    }

    const qty = Number(body.cantidad);
    if (isNaN(qty) || qty <= 0) {
      throw new HttpException(
        { statusCode: HttpStatus.BAD_REQUEST, message: 'La cantidad a liberar debe ser mayor a 0', error: 'Bad Request' },
        HttpStatus.BAD_REQUEST,
      );
    }

    // Determinar destino preliminar
    let destLocId = body.ubicacionDestinoId;
    if (!destLocId) {
      const defaultLoc = await this.prisma.location.findFirst({
        where: { tipoUbicacion: 'ESTANTERIA', estado: 'OCUPADO' },
      }) || await this.prisma.location.findFirst({
        where: { tipoUbicacion: { notIn: ['DEVOLUCION', 'CUARENTENA'] }, activo: true },
      });
      destLocId = defaultLoc?.id;
    }

    if (!destLocId) {
      throw new HttpException(
        { statusCode: HttpStatus.BAD_REQUEST, message: 'No se encontró una ubicación operativa válida para reintegrar la mercancía', error: 'Bad Request' },
        HttpStatus.BAD_REQUEST,
      );
    }

    const huIds = body.huId ? [body.huId] : [];
    const locationIds = [destLocId];

    return await this.putawayEngine.executePhysicalMovementProtocol(
      this.prisma,
      {
        huIds,
        locationIds,
        opName: 'quarantineRelease',
      },
      async (tx) => {
        const virtualLot = await tx.lotInventory.findUnique({
          where: { id: body.lotId },
          include: { sku: true, cliente: true, ubicacion: true, handlingUnits: true },
        });

        if (!virtualLot) {
          throw new HttpException(
            { statusCode: HttpStatus.NOT_FOUND, message: `Lote en Almacén Virtual ${body.lotId} no encontrado`, error: 'Not Found' },
            HttpStatus.NOT_FOUND,
          );
        }

        if (qty > (virtualLot.cantidadBloqueada || 0)) {
          throw new HttpException(
            {
              statusCode: HttpStatus.BAD_REQUEST,
              message: `La cantidad a liberar (${qty}) supera las existencias bloqueadas en este registro (${virtualLot.cantidadBloqueada})`,
              error: 'Bad Request',
            },
            HttpStatus.BAD_REQUEST,
          );
        }

        // 1. RESTRICCIÓN: Producto Caducado
        const now = new Date();
        if (virtualLot.fechaVencimiento && new Date(virtualLot.fechaVencimiento) <= now) {
          throw new HttpException(
            {
              statusCode: HttpStatus.BAD_REQUEST,
              message: 'BLOQUEO ESTRICTO: No se puede liberar a Stock Operativo un producto caducado. Su disponibilidad comercial es 0 y debe permanecer en Almacén Virtual o enviarse a disposición final.',
              error: 'Bad Request',
            },
            HttpStatus.BAD_REQUEST,
          );
        }

        // 2. RESTRICCIÓN: Merma Definitiva / Destrucción Física Registrada
        const notas = (virtualLot.notas || '').toUpperCase();
        const isMerma = virtualLot.estadoCalidad === 'MERMA' || notas.includes('MERMA') || notas.includes('DESTRUCCION');
        if (isMerma && !body.referenciaCalidad) {
          throw new HttpException(
            {
              statusCode: HttpStatus.BAD_REQUEST,
              message: 'BLOQUEO ESTRICTO: No se puede liberar mercancía dictaminada como merma definitiva o con destrucción física sin un dictamen formal de Calidad / Autorización técnica registrada.',
              error: 'Bad Request',
            },
            HttpStatus.BAD_REQUEST,
          );
        }

        const destLoc = await tx.location.findUnique({
          where: { id: destLocId },
          include: { zona: true, lotes: true },
        });
        if (!destLoc) {
          throw new HttpException(
            { statusCode: HttpStatus.NOT_FOUND, message: `Ubicación destino ${destLocId} no encontrada`, error: 'Not Found' },
            HttpStatus.NOT_FOUND,
          );
        }

        // Revalidación estricta de capacidad del rack comercial bajo lock (Regla 4 y 7)
        const reval = await this.putawayEngine.revalidateLocationForPutaway(
          destLoc.id,
          qty,
          tx,
          {
            huBultos: body.huId ? 1 : 0,
            client: virtualLot.cliente,
            item: {
              huId: body.huId || '',
              huCodigo: '',
              tipoHu: 'CAJA',
              skuId: virtualLot.skuId,
              skuCodigo: virtualLot.sku?.codigo || '',
              skuDescripcion: virtualLot.sku?.descripcion || '',
              skuCategoria: virtualLot.sku?.categoria || '',
              cantidad: qty,
              lote: virtualLot.lote || '',
              fechaVencimiento: virtualLot.fechaVencimiento ? new Date(virtualLot.fechaVencimiento).toISOString() : null,
              ubicacionActual: virtualLot.ubicacion?.codigo || 'DEV-01',
              skuTemperatura: virtualLot.sku?.temperaturaRequerida || 'AMBIENTE',
            },
          },
        );

        if (!reval.valid) {
          throw new HttpException(
            {
              statusCode: HttpStatus.CONFLICT,
              message: reval.error || `La ubicación ${destLoc.codigo} no tiene capacidad suficiente para recibir la liberación.`,
              error: 'Conflict',
            },
            HttpStatus.CONFLICT,
          );
        }

        // 4. Descontar del almacén virtual
        await tx.lotInventory.update({
          where: { id: virtualLot.id },
          data: {
            cantidadBloqueada: { decrement: qty },
          },
        });

        // 5. Reintegrar a Stock Operativo (buscar lote coincidente en la ubicación destino o crear uno nuevo)
        const existingOpLot = await tx.lotInventory.findFirst({
          where: {
            skuId: virtualLot.skuId,
            clienteId: virtualLot.clienteId,
            lote: virtualLot.lote,
            ubicacionId: destLoc.id,
            estadoCalidad: 'LIBERADO',
          },
        });

        let targetLotId: string;
        if (existingOpLot) {
          await tx.lotInventory.update({
            where: { id: existingOpLot.id },
            data: {
              cantidadDisponible: { increment: qty },
            },
          });
          targetLotId = existingOpLot.id;
        } else {
          const createdOpLot = await tx.lotInventory.create({
            data: {
              skuId: virtualLot.skuId,
              clienteId: virtualLot.clienteId,
              lote: virtualLot.lote,
              fechaVencimiento: virtualLot.fechaVencimiento,
              estadoCalidad: 'LIBERADO',
              cantidadDisponible: qty,
              cantidadBloqueada: 0,
              ubicacionId: destLoc.id,
              notas: `Reintegrado a Stock Operativo desde Almacén Virtual (${virtualLot.ubicacion?.codigo || 'DEV'}). Ref: ${body.referenciaCalidad || body.motivo}`,
            },
          });
          targetLotId = createdOpLot.id;
        }

        // 6. Si hay HU, actualizarla con destLoc.codigo
        let huIdFinal: string | null = null;
        if (body.huId) {
          const hu = await tx.handlingUnit.findUnique({ where: { id: body.huId } });
          if (hu) {
            await tx.handlingUnit.update({
              where: { id: hu.id },
              data: {
                ubicacionActual: destLoc.codigo,
                estadoHu: 'ACTIVO',
                lotId: targetLotId,
              },
            });
            huIdFinal = hu.id;
          }
        }

        // 7. Registrar InventoryMovement (Kárdex)
        await tx.inventoryMovement.create({
          data: {
            tipoMovimiento: 'LIBERACION_DE_VIRTUAL',
            almacenId: destLoc.almacenId,
            skuId: virtualLot.skuId,
            clienteId: virtualLot.clienteId,
            lotId: targetLotId,
            huId: huIdFinal,
            fromLocationId: virtualLot.ubicacionId,
            toLocationId: destLoc.id,
            cantidad: qty,
            usuario: body.usuario,
            motivo: `[LIBERACION_A_STOCK] ${body.motivo}${body.referenciaCalidad ? ` | Ref Calidad: ${body.referenciaCalidad}` : ''}`,
            documentoOrigen: body.referenciaCalidad || 'LIBERACION_MANUAL',
          },
        });

        // 8. Registrar AuditLog
        await tx.auditLog.create({
          data: {
            usuario: body.usuario,
            accion: 'LIBERACION_ALMACEN_VIRTUAL_A_STOCK',
            entidad: 'LotInventory',
            entidadId: targetLotId,
            detalle: `Liberación formal de ${qty} pzas del SKU ${virtualLot.sku.codigo} (Lote: ${virtualLot.lote || 'N/A'}) a Stock Operativo en ${destLoc.codigo} bajo protocolo de concurrencia. Motivo: ${body.motivo}. Autorizó: ${body.usuario} (${body.rol || 'Supervisor'}). Ref Calidad: ${body.referenciaCalidad || 'N/A'}`,
          },
        });

        return {
          success: true,
          mensaje: `Se reintegraron exitosamente ${qty} piezas del SKU ${virtualLot.sku.codigo} a Stock Operativo en ubicación ${destLoc.codigo}.`,
          skuCodigo: virtualLot.sku.codigo,
          lote: virtualLot.lote,
          cantidadLiberada: qty,
          ubicacionDestino: destLoc.codigo,
        };
      },
    );
  }

  // ============ CONCILIACIÓN DE CONTEO FÍSICO (CYCLE COUNT / RECONCILE) ============
  @Post('count/:id/reconcile')
  @ApiOperation({
    summary: 'Conciliar conteo físico (Deprecado por directriz de seguridad WMS)',
  })
  async reconcileInventoryCount(@Param('id') id: string, @Body() body: any) {
    throw new HttpException(
      'Operación inhabilitada por directriz de seguridad de inventario WMS: La conciliación de conteos cíclicos debe ejecutarse exclusivamente a través del módulo oficial auditado POST /api/operations/cycle-counts/:id/finalize',
      HttpStatus.FORBIDDEN,
    );
  }

  // Helper privado para asegurar ubicaciones virtuales (idempotente)
  private async ensureVirtualLocations() {
    let zone = await this.prisma.zone.findFirst({
      where: { OR: [{ codigo: 'DEVOLUCION' }, { tipoZona: 'CUARENTENA' }] },
    });

    if (!zone) {
      const wh = await this.prisma.warehouse.findFirst();
      if (!wh) throw new Error('No se encontró ningún almacén en el sistema');
      zone = await this.prisma.zone.create({
        data: {
          codigo: 'DEVOLUCION',
          nombre: 'Zona de Devoluciones y Merma',
          almacenId: wh.id,
          tipoZona: 'CUARENTENA',
        },
      });
    }

    // 1. Ubicación DEV-01 (Merma)
    let devLoc = await this.prisma.location.findFirst({
      where: { OR: [{ codigo: 'DEV-01' }, { codigo: 'NC-MERMA-01' }] },
    });
    if (!devLoc) {
      devLoc = await this.prisma.location.create({
        data: {
          codigo: 'DEV-01',
          almacenId: zone.almacenId,
          zonaId: zone.id,
          pasillo: 'DEV',
          rack: '01',
          nivel: 'P',
          posicion: '01',
          tipoUbicacion: 'DEVOLUCION',
          estado: 'LIBRE',
        },
      });
    }

    // 2. Ubicación NC-EXCESO-01 (Exceso / Sobrante en cuarentena)
    let excesoLoc = await this.prisma.location.findFirst({
      where: { codigo: 'NC-EXCESO-01' },
    });
    if (!excesoLoc) {
      excesoLoc = await this.prisma.location.create({
        data: {
          codigo: 'NC-EXCESO-01',
          almacenId: zone.almacenId,
          zonaId: zone.id,
          pasillo: 'EXC',
          rack: '01',
          nivel: 'P',
          posicion: '01',
          tipoUbicacion: 'CUARENTENA',
          estado: 'LIBRE',
        },
      });
    }

    return { devLoc, excesoLoc, zone };
  }
}

