import { Controller, Get, Post, Body, Query, HttpCode, HttpStatus, HttpException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { PrismaService } from '../../prisma.service';
import { DivertToVirtualDto } from './dto/divert-virtual.dto';
import { TransferToVirtualDto, ReleaseFromVirtualDto } from './dto/transfer-virtual.dto';

@ApiTags('Inventory')
@Controller('api/inventory')
export class InventoryController {
  constructor(private prisma: PrismaService) {}

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
        ubicacion: { select: { codigo: true, tipoUbicacion: true, zona: { select: { codigo: true, nombre: true } } } },
        handlingUnits: { select: { id: true, codigo: true, tipoHu: true, cantidad: true, ubicacionActual: true, estadoHu: true, loteTexto: true, reacondicionada: true, piezasPorCaja: true, cajaOrigenId: true } },
      },
      orderBy: [{ fechaVencimiento: 'asc' }, { sku: { descripcion: 'asc' } }],
    });

    const now = new Date();
    return lots.map(l => {
      const fisico = l.cantidadDisponible || 0;
      const reservado = Math.max(0, l.cantidadReservada || 0);
      const isExpired = Boolean(l.fechaVencimiento && new Date(l.fechaVencimiento) <= now);
      const isBlocked = l.estadoCalidad !== 'LIBERADO';
      const disponible = (!isExpired && !isBlocked) ? Math.max(0, fisico - reservado) : 0;

      const isCajaCerrada = l.cliente?.manejoInventario === 'CAJA' || l.cliente?.uomPrincipal === 'CAJA' || l.cliente?.reglaInventario === 'CAJA_CERRADA' || (l.cliente as any)?.politicaEmpaque === 'CAJA_CERRADA' || l.cliente?.nombreComercial?.includes('AlimNorte');
      const partialUnits = isCajaCerrada && l.handlingUnits
        ? l.handlingUnits.filter((h: any) => h.reacondicionada || (h.piezasPorCaja && h.cantidad < h.piezasPorCaja) || h.codigo?.includes('PARCIAL')).reduce((s: number, h: any) => s + (Number(h.cantidad) || 0), 0)
        : 0;
      const cantidadElegible = Math.max(0, disponible - partialUnits);

      return {
        ...l,
        isExpired,
        isBlocked,
        cantidadFisica: fisico,
        cantidadReservada: reservado,
        cantidadDisponibleLibre: disponible,
        stockLibre: disponible,
        cantidadElegible,
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
      include: { sku: { select: { codigo: true, descripcion: true, categoria: true, clienteId: true } }, cliente: { select: { nombreComercial: true } } },
    });

    const now = new Date();
    const totalFisico = lots.reduce((sum, l) => sum + (l.cantidadDisponible || 0), 0);
    const totalReservado = lots.reduce((sum, l) => sum + Math.max(0, l.cantidadReservada || 0), 0);
    const totalDisponible = lots.reduce((sum, l) => {
      const isExpired = Boolean(l.fechaVencimiento && new Date(l.fechaVencimiento) <= now);
      const isBlocked = l.estadoCalidad !== 'LIBERADO';
      if (isExpired || isBlocked) return sum;
      const fis = l.cantidadDisponible || 0;
      const res = Math.max(0, l.cantidadReservada || 0);
      return sum + Math.max(0, fis - res);
    }, 0);
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

    return { totalFisico, totalUnidades: totalFisico, totalReservado, totalDisponible, totalSkus, totalLotes, porCliente: Object.values(porCliente) };
  }

  @Get('movements')
  @ApiOperation({ summary: 'Historial de movimientos de inventario' })
  async getMovements(
    @Query('tipo') tipo?: string,
    @Query('clienteId') clienteId?: string,
    @Query('limit') limit?: string,
  ) {
    const where: any = {};
    if (tipo) where.tipoMovimiento = tipo;
    if (clienteId) where.clienteId = clienteId;

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
      take: parseInt(limit || '100'),
    });
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

    return this.prisma.$transaction(async (tx) => {
      // Contador para folio de acta oficial
      const ncCount = await tx.inventoryMovement.count({
        where: { tipoMovimiento: { in: ['DESVIO_MERMA', 'DESVIO_EXCESO'] } },
      });
      const folioActa = `ACTA-NC-${new Date().getFullYear()}-${String(ncCount + 1).padStart(5, '0')}`;

      let huSequence = await tx.handlingUnit.count();
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

        // 1. Crear lote en LotInventory en estado CUARENTENA con cantidadBloqueada
        const lot = await tx.lotInventory.create({
          data: {
            skuId: item.skuId,
            clienteId: body.clienteId,
            lote: item.lote?.trim() || null,
            fechaVencimiento: item.fechaVencimiento ? new Date(item.fechaVencimiento) : null,
            estadoCalidad: 'CUARENTENA',
            cantidadBloqueada: item.cantidad,
            cantidadDisponible: 0,
            ubicacionId: destLocId,
            notas: `[ALMACEN_VIRTUAL_NC] ${item.tipoDesvio}: ${item.motivo.trim()} | Acta: ${folioActa}`,
          },
        });

        // 2. Crear Handling Unit segregada
        huSequence++;
        const huCode = `HU-NC-${new Date().getFullYear()}-${String(huSequence).padStart(5, '0')}`;
        const hu = await tx.handlingUnit.create({
          data: {
            codigo: huCode,
            tipoHu: item.tipoHu || (item.cantidad >= 50 ? 'PALLET' : 'CAJA'),
            lotId: lot.id,
            clienteId: body.clienteId,
            cantidad: item.cantidad,
            uom: sku.uomBase || 'PZA',
            ubicacionActual: destLocId,
            estadoHu: 'CUARENTENA',
          },
        });

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

  // ============ TRANSFERENCIA MANUAL Y MASIVA A ALMACÉN VIRTUAL ============
  @Post('transfer-to-virtual')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Transferir inventario (individual o masivo) de Stock Operativo a Almacén Virtual',
    description: 'Disminuye Stock Operativo, aumenta Almacén Virtual, bloquea disponibilidad comercial, y registra Kárdex y auditoría inmutable.',
  })
  async transferToVirtual(@Body() body: TransferToVirtualDto) {
    if (!body.items || !Array.isArray(body.items) || body.items.length === 0) {
      throw new HttpException(
        { statusCode: HttpStatus.BAD_REQUEST, message: 'Debe proporcionar al menos un ítem para transferir', error: 'Bad Request' },
        HttpStatus.BAD_REQUEST,
      );
    }

    const usuario = body.usuario?.trim() || 'Supervisor de Inventario';
    const locs = await this.ensureVirtualLocations();

    return this.prisma.$transaction(async (tx) => {
      let totalPiezas = 0;
      const transferidos: any[] = [];
      let huSequence = await tx.handlingUnit.count();

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

        // Validar cantidad física disponible (no reservada)
        const cantFisica = originLot.cantidadDisponible || 0;
        const cantReservada = originLot.cantidadReservada || 0;
        const disponibleParaTransferir = Math.max(0, cantFisica - cantReservada);

        if (qty > disponibleParaTransferir) {
          throw new HttpException(
            {
              statusCode: HttpStatus.BAD_REQUEST,
              message: `Cantidad insuficiente para transferir en el SKU ${originLot.sku.codigo} (Lote: ${originLot.lote || 'N/A'}). Físico disponible no reservado: ${disponibleParaTransferir}, Solicitado: ${qty}`,
              error: 'Bad Request',
            },
            HttpStatus.BAD_REQUEST,
          );
        }

        const motivo = (item.motivo || body.motivoGeneral || 'Transferencia a Almacén Virtual').trim();
        const obs = (item.observaciones || body.observaciones || '').trim();

        // Determinar destino virtual
        let destLoc = locs.devLoc;
        if (body.ubicacionDestinoId) {
          const foundLoc = await tx.location.findUnique({ where: { id: body.ubicacionDestinoId } });
          if (foundLoc) destLoc = foundLoc;
        } else if (motivo.toLowerCase().includes('exceso') || motivo.toLowerCase().includes('sobrante')) {
          destLoc = locs.excesoLoc;
        }

        // Determinar estado de calidad en Almacén Virtual
        let estadoVirtual = 'CUARENTENA';
        const isCaducado = motivo.toLowerCase().includes('caduc') || (originLot.fechaVencimiento && new Date(originLot.fechaVencimiento) <= new Date());
        if (isCaducado) {
          estadoVirtual = 'BLOQUEADO';
        } else if (motivo.toLowerCase().includes('merma') || motivo.toLowerCase().includes('daño') || motivo.toLowerCase().includes('dano')) {
          estadoVirtual = 'MERMA';
        }

        // 1. Descontar de stock operativo
        await tx.lotInventory.update({
          where: { id: originLot.id },
          data: {
            cantidadDisponible: { decrement: qty },
          },
        });

        // 2. Crear registro en Almacén Virtual
        const virtualLot = await tx.lotInventory.create({
          data: {
            skuId: originLot.skuId,
            clienteId: originLot.clienteId,
            lote: originLot.lote,
            fechaVencimiento: originLot.fechaVencimiento,
            estadoCalidad: estadoVirtual,
            cantidadBloqueada: qty,
            cantidadDisponible: 0,
            ubicacionId: destLoc.id,
            notas: `[ALMACEN_VIRTUAL_NC] Transferido desde ${originLot.ubicacion?.codigo || 'Stock'}: ${motivo}${obs ? ` | Obs: ${obs}` : ''}`,
          },
        });

        // 3. Manejo de Handling Unit si aplica
        let huIdFinal: string | null = null;
        if (item.huId) {
          const originHu = await tx.handlingUnit.findUnique({ where: { id: item.huId } });
          if (originHu) {
            if (originHu.cantidad === qty) {
              await tx.handlingUnit.update({
                where: { id: originHu.id },
                data: {
                  ubicacionActual: destLoc.id,
                  estadoHu: 'BLOQUEADO',
                  lotId: virtualLot.id,
                },
              });
              huIdFinal = originHu.id;
            } else {
              await tx.handlingUnit.update({
                where: { id: originHu.id },
                data: { cantidad: { decrement: qty } },
              });
              huSequence++;
              const newHuCode = `HU-NC-${new Date().getFullYear()}-${String(huSequence).padStart(5, '0')}`;
              const createdHu = await tx.handlingUnit.create({
                data: {
                  codigo: newHuCode,
                  tipoHu: originHu.tipoHu || 'CAJA',
                  lotId: virtualLot.id,
                  clienteId: originLot.clienteId,
                  cantidad: qty,
                  uom: originHu.uom || 'PZA',
                  ubicacionActual: destLoc.id,
                  estadoHu: 'BLOQUEADO',
                  loteTexto: originLot.lote,
                  skuCodigo: originLot.sku.codigo,
                  cajaOrigenId: originHu.id,
                },
              });
              huIdFinal = createdHu.id;
            }
          }
        } else {
          // HU segregada para trazabilidad en almacén virtual
          huSequence++;
          const newHuCode = `HU-NC-${new Date().getFullYear()}-${String(huSequence).padStart(5, '0')}`;
          const createdHu = await tx.handlingUnit.create({
            data: {
              codigo: newHuCode,
              tipoHu: qty >= 50 ? 'PALLET' : 'CAJA',
              lotId: virtualLot.id,
              clienteId: originLot.clienteId,
              cantidad: qty,
              uom: originLot.sku.uomBase || 'PZA',
              ubicacionActual: destLoc.id,
              estadoHu: 'BLOQUEADO',
              loteTexto: originLot.lote,
              skuCodigo: originLot.sku.codigo,
            },
          });
          huIdFinal = createdHu.id;
        }

        // 4. Registrar movimiento formal de inventario (Kárdex)
        await tx.inventoryMovement.create({
          data: {
            tipoMovimiento: 'TRANSFERENCIA_A_VIRTUAL',
            almacenId: destLoc.almacenId,
            skuId: originLot.skuId,
            clienteId: originLot.clienteId,
            lotId: virtualLot.id,
            huId: huIdFinal,
            fromLocationId: originLot.ubicacionId,
            toLocationId: destLoc.id,
            cantidad: qty,
            usuario,
            motivo: `[TRANSFERENCIA_A_VIRTUAL] ${motivo}${obs ? ` - Obs: ${obs}` : ''}`,
            documentoOrigen: 'TRANSFERENCIA_MANUAL',
          },
        });

        // 5. Registrar AuditLog inmutable
        await tx.auditLog.create({
          data: {
            usuario,
            accion: 'TRANSFERENCIA_STOCK_A_VIRTUAL',
            entidad: 'LotInventory',
            entidadId: virtualLot.id,
            detalle: `Transferencia de ${qty} pzas del SKU ${originLot.sku.codigo} (Lote: ${originLot.lote || 'N/A'}) desde ${originLot.ubicacion?.codigo || 'Stock'} al Almacén Virtual (${destLoc.codigo}). Motivo: ${motivo}`,
          },
        });

        totalPiezas += qty;
        transferidos.push({
          skuCodigo: originLot.sku.codigo,
          descripcion: originLot.sku.descripcion,
          lote: originLot.lote,
          cantidad: qty,
          origen: originLot.ubicacion?.codigo || 'Stock Operativo',
          destino: destLoc.codigo,
          motivo,
        });
      }

      return {
        success: true,
        totalItems: body.items.length,
        totalPiezas,
        mensaje: `Se transfirieron exitosamente ${totalPiezas} piezas al Almacén Virtual (No Conforme / Merma).`,
        itemsTransferidos: transferidos,
      };
    }, {
      maxWait: 15000,
      timeout: 45000,
    });
  }

  // ============ LIBERAR / REINTEGRAR A STOCK OPERATIVO ============
  @Post('release-from-virtual')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Liberar / Reintegrar mercancía de Almacén Virtual a Stock Operativo',
    description: 'Valida estrictamente caducidad, merma y bloqueos antes de permitir reintegrar inventario a disponibilidad comercial.',
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

    return this.prisma.$transaction(async (tx) => {
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

      // 3. Determinar ubicación destino en Stock Operativo
      let destLoc: any = null;
      if (body.ubicacionDestinoId) {
        destLoc = await tx.location.findUnique({ where: { id: body.ubicacionDestinoId } });
        if (!destLoc) {
          throw new HttpException(
            { statusCode: HttpStatus.NOT_FOUND, message: `Ubicación destino ${body.ubicacionDestinoId} no encontrada`, error: 'Not Found' },
            HttpStatus.NOT_FOUND,
          );
        }
      } else {
        // Buscar rack operativo común
        destLoc = await tx.location.findFirst({
          where: { tipoUbicacion: 'ESTANTERIA', estado: 'OCUPADO' },
        });
        if (!destLoc) {
          destLoc = await tx.location.findFirst({
            where: { tipoUbicacion: { notIn: ['DEVOLUCION', 'CUARENTENA'] } },
          });
        }
      }

      if (!destLoc) {
        throw new HttpException(
          { statusCode: HttpStatus.BAD_REQUEST, message: 'No se encontró una ubicación operativa válida para reintegrar la mercancía', error: 'Bad Request' },
          HttpStatus.BAD_REQUEST,
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

      // 6. Si hay HU, actualizarla
      let huIdFinal: string | null = null;
      if (body.huId) {
        const hu = await tx.handlingUnit.findUnique({ where: { id: body.huId } });
        if (hu) {
          await tx.handlingUnit.update({
            where: { id: hu.id },
            data: {
              ubicacionActual: destLoc.id,
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
          detalle: `Liberación formal de ${qty} pzas del SKU ${virtualLot.sku.codigo} (Lote: ${virtualLot.lote || 'N/A'}) a Stock Operativo en ${destLoc.codigo}. Motivo: ${body.motivo}. Autorizó: ${body.usuario} (${body.rol || 'Supervisor'}). Ref Calidad: ${body.referenciaCalidad || 'N/A'}`,
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
    }, {
      maxWait: 15000,
      timeout: 45000,
    });
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

