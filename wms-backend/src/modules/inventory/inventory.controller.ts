import { Controller, Get, Post, Body, Query, HttpCode, HttpStatus, HttpException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { PrismaService } from '../../prisma.service';
import { DivertToVirtualDto } from './dto/divert-virtual.dto';

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

    return this.prisma.lotInventory.findMany({
      where,
      include: {
        sku: { select: { codigo: true, descripcion: true, categoria: true, talla: true, color: true, marca: true, uomBase: true, capacidadEmpaque: true } },
        cliente: { select: { nombreComercial: true, giro: true } },
        ubicacion: { select: { codigo: true, tipoUbicacion: true, zona: { select: { codigo: true, nombre: true } } } },
      },
      orderBy: [{ fechaVencimiento: 'asc' }, { sku: { descripcion: 'asc' } }],
    });
  }

  @Get('handling-units')
  @ApiOperation({ summary: 'Listar Handling Units activas' })
  async getHandlingUnits(
    @Query('clienteId') clienteId?: string,
    @Query('estado') estado?: string,
  ) {
    const where: any = {};
    if (clienteId) where.clienteId = clienteId;
    if (estado) where.estadoHu = estado;
    else where.estadoHu = 'ACTIVO';

    return this.prisma.handlingUnit.findMany({
      where,
      include: {
        lote: { include: { sku: { select: { codigo: true, descripcion: true, categoria: true } } } },
        cliente: { select: { nombreComercial: true } },
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

    const totalUnidades = lots.reduce((sum, l) => sum + l.cantidadDisponible, 0);
    const totalReservado = lots.reduce((sum, l) => sum + l.cantidadReservada, 0);
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

    return { totalUnidades, totalReservado, totalSkus, totalLotes, porCliente: Object.values(porCliente) };
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
        sku: { select: { codigo: true, descripcion: true } },
        fromLocation: { select: { codigo: true } },
        toLocation: { select: { codigo: true } },
        almacen: { select: { codigo: true } },
        lote: { select: { lote: true } },
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
  @ApiQuery({ name: 'tipoDesvio', required: false, enum: ['TODOS', 'MERCANCIA_DANADA', 'PRODUCTO_EXCESO'], description: 'Filtrar por tipo de no conformidad' })
  async getVirtualWarehouse(
    @Query('clienteId') clienteId?: string,
    @Query('tipoDesvio') tipoDesvio?: string,
  ) {
    const where: any = {
      cantidadBloqueada: { gt: 0 },
      estadoCalidad: { in: ['CUARENTENA', 'BLOQUEADO', 'MERMA'] },
    };
    if (clienteId) where.clienteId = clienteId;

    if (tipoDesvio && tipoDesvio !== 'TODOS') {
      where.notas = { contains: tipoDesvio };
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

    let totalPiezasBloqueadas = 0;
    let piezasDanadas = 0;
    let piezasExceso = 0;

    for (const l of lots) {
      totalPiezasBloqueadas += l.cantidadBloqueada;
      if (l.notas && l.notas.includes('PRODUCTO_EXCESO')) {
        piezasExceso += l.cantidadBloqueada;
      } else {
        piezasDanadas += l.cantidadBloqueada;
      }
    }

    return {
      totalLotes: lots.length,
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

