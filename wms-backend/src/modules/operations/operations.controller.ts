import { Controller, Get, Post, Put, Param, Query, Body, HttpException, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { PrismaService } from '../../prisma.service';

@ApiTags('Operations')
@Controller('api')
export class OperationsController {
  constructor(private prisma: PrismaService) {}

  private async audit(usuario: string, accion: string, entidad: string, entidadId?: string, detalle?: string) {
    await this.prisma.auditLog.create({ data: { usuario, accion, entidad, entidadId, detalle } });
  }

  // ============ RECEPTION ============
  @Get('receipts')
  @ApiOperation({ summary: 'Listar recepciones' })
  async getReceipts(@Query('clienteId') clienteId?: string, @Query('estado') estado?: string) {
    const where: any = {};
    if (clienteId) where.clienteId = clienteId;
    if (estado) where.estado = estado;

    return this.prisma.receipt.findMany({
      where,
      include: {
        cliente: { select: { nombreComercial: true } },
        proveedor: { select: { nombre: true } },
        lineas: { include: { sku: { select: { codigo: true, descripcion: true, categoria: true, talla: true, color: true } } } },
      },
      orderBy: { fechaRecepcion: 'desc' },
    });
  }

  @Post('receipts')
  @ApiOperation({ summary: 'Crear recepción' })
  async createReceipt(@Body() data: any) {
    const count = await this.prisma.receipt.count();
    const codigo = `REC-${new Date().getFullYear()}-${String(count + 1).padStart(4, '0')}`;

    const { lineas, ...receiptData } = data;
    const receipt = await this.prisma.receipt.create({
      data: { ...receiptData, codigo, lineas: lineas ? { create: lineas } : undefined },
      include: { cliente: { select: { nombreComercial: true } }, lineas: { include: { sku: true } } },
    });

    await this.audit(data.recibidoPor || 'Sistema', 'CREAR_RECEPCION', 'Receipt', receipt.id, `${codigo}: ${lineas?.length || 0} líneas`);
    return receipt;
  }

  @Post('reception')
  @ApiOperation({ summary: 'Registrar recepción de mercancía (crea lote + HU + movimiento)' })
  async registerReception(@Body() data: {
    skuId: string; clienteId: string; lote?: string; serie?: string;
    fechaVencimiento?: string; cantidad: number; proveedor?: string;
    tipoHu: string; ubicacionId: string; almacenId: string;
    usuario: string; notas?: string; receiptLineId?: string;
  }) {
    const lot = await this.prisma.lotInventory.create({
      data: {
        skuId: data.skuId, clienteId: data.clienteId,
        lote: data.lote || null, serie: data.serie || null,
        fechaVencimiento: data.fechaVencimiento ? new Date(data.fechaVencimiento) : null,
        proveedorNombre: data.proveedor,
        estadoCalidad: 'LIBERADO',
        cantidadDisponible: data.cantidad,
        ubicacionId: data.ubicacionId,
      },
    });

    const huCount = await this.prisma.handlingUnit.count();
    const huCodigo = `HU-${new Date().getFullYear()}-${String(huCount + 1).padStart(5, '0')}`;

    const hu = await this.prisma.handlingUnit.create({
      data: {
        codigo: huCodigo, tipoHu: data.tipoHu, lotId: lot.id,
        clienteId: data.clienteId, cantidad: data.cantidad,
        uom: 'PZA', ubicacionActual: data.ubicacionId,
      },
    });

    await this.prisma.inventoryMovement.create({
      data: {
        tipoMovimiento: 'ENTRADA', almacenId: data.almacenId,
        skuId: data.skuId, clienteId: data.clienteId, lotId: lot.id,
        huId: hu.id, toLocationId: data.ubicacionId,
        cantidad: data.cantidad, usuario: data.usuario,
        motivo: data.notas || `Recepción — ${data.proveedor || 'Proveedor'}`,
      },
    });

    await this.prisma.location.update({
      where: { id: data.ubicacionId },
      data: { ocupacion: { increment: 1 }, estado: 'OCUPADO' },
    });

    // Update receipt line if linked
    if (data.receiptLineId) {
      const line = await this.prisma.receiptLine.findUnique({ where: { id: data.receiptLineId } });
      if (line) {
        const newRecibida = line.cantidadRecibida + data.cantidad;
        await this.prisma.receiptLine.update({
          where: { id: data.receiptLineId },
          data: {
            cantidadRecibida: newRecibida,
            estado: line.cantidadEsperada && newRecibida >= line.cantidadEsperada ? 'COMPLETO' : 'PARCIAL',
            loteAsignado: data.lote, ubicacionId: data.ubicacionId,
          },
        });
      }
    }

    await this.audit(data.usuario, 'RECEPCION', 'LotInventory', lot.id,
      `Lote: ${data.lote || 'N/A'}, Cant: ${data.cantidad}, HU: ${huCodigo}`);

    return { success: true, lot, handlingUnit: hu, message: `Recepción registrada: HU ${huCodigo}` };
  }

  // ============ ORDERS ============
  @Get('orders')
  @ApiOperation({ summary: 'Listar órdenes de salida' })
  async getOrders(@Query('estado') estado?: string, @Query('clienteId') clienteId?: string) {
    const where: any = {};
    if (estado) where.estado = estado;
    if (clienteId) where.clienteId = clienteId;

    return this.prisma.salesOrder.findMany({
      where,
      include: {
        cliente: { select: { nombreComercial: true } },
        lineas: { include: { sku: { select: { codigo: true, descripcion: true } } } },
        trackingEvents: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: [{ prioridad: 'asc' }, { fechaCompromiso: 'asc' }],
    });
  }

  @Post('orders')
  @ApiOperation({ summary: 'Crear orden de salida' })
  async createOrder(@Body() data: any) {
    const count = await this.prisma.salesOrder.count();
    const codigo = `PED-${new Date().getFullYear()}-${String(count + 1).padStart(4, '0')}`;

    const { lineas, usuario, ...orderData } = data;
    const order = await this.prisma.salesOrder.create({
      data: { ...orderData, codigo, lineas: { create: lineas } },
      include: { cliente: true, lineas: { include: { sku: true } } },
    });

    await this.audit(usuario || 'Sistema', 'CREAR_ORDEN', 'SalesOrder', order.id, `${codigo}: ${lineas?.length || 0} líneas`);
    return order;
  }

  @Put('orders/:id/status')
  @ApiOperation({ summary: 'Actualizar estado de orden' })
  async updateOrderStatus(@Param('id') id: string, @Body() body: { estado: string; usuario?: string }) {
    const updateData: any = { estado: body.estado };
    if (body.estado === 'DESPACHADO') updateData.fechaDespacho = new Date();

    const order = await this.prisma.salesOrder.update({
      where: { id }, data: updateData, include: { cliente: true },
    });

    await this.audit(body.usuario || 'Sistema', `ORDEN_${body.estado}`, 'SalesOrder', id, `Estado: ${body.estado}`);
    return order;
  }

  @Post('orders/:id/dispatch')
  @ApiOperation({ summary: 'Confirmar despacho — descuenta inventario y libera ubicaciones' })
  async dispatchOrder(@Param('id') id: string, @Body() data: { despachador: string; vehiculoPlaca?: string; notas?: string }) {
    const fullOrder = await this.prisma.salesOrder.findUnique({
      where: { id },
      include: { lineas: { include: { sku: true } }, cliente: true },
    });
    if (!fullOrder) throw new HttpException('Orden no encontrada', HttpStatus.NOT_FOUND);

    for (const line of fullOrder.lineas) {
      let remaining = line.cantidadSolicitada;
      const lots = await this.prisma.lotInventory.findMany({
        where: { skuId: line.skuId, clienteId: fullOrder.clienteId, cantidadDisponible: { gt: 0 }, estadoCalidad: 'LIBERADO' },
        orderBy: { fechaVencimiento: 'asc' },
        include: { ubicacion: true },
      });

      for (const lot of lots) {
        if (remaining <= 0) break;
        const toTake = Math.min(remaining, lot.cantidadDisponible);
        remaining -= toTake;

        await this.prisma.lotInventory.update({
          where: { id: lot.id },
          data: { cantidadDisponible: { decrement: toTake } },
        });

        if (toTake >= lot.cantidadDisponible && lot.ubicacionId) {
          const otherLots = await this.prisma.lotInventory.count({
            where: { ubicacionId: lot.ubicacionId, cantidadDisponible: { gt: 0 }, id: { not: lot.id } },
          });
          if (otherLots === 0) {
            await this.prisma.location.update({
              where: { id: lot.ubicacionId },
              data: { ocupacion: 0, estado: 'LIBRE' },
            });
          }
        }

        await this.prisma.inventoryMovement.create({
          data: {
            tipoMovimiento: 'SALIDA', skuId: line.skuId, clienteId: fullOrder.clienteId,
            lotId: lot.id, fromLocationId: lot.ubicacionId || undefined,
            cantidad: toTake, usuario: data.despachador,
            motivo: `Despacho ${fullOrder.codigo} → ${fullOrder.destinatario || fullOrder.cliente.nombreComercial}`,
          },
        });
      }

      await this.prisma.salesOrderLine.update({
        where: { id: line.id },
        data: { cantidadAsignada: line.cantidadSolicitada - remaining },
      });
    }

    const order = await this.prisma.salesOrder.update({
      where: { id },
      data: {
        estado: 'DESPACHADO', despachador: data.despachador,
        fechaDespacho: new Date(), vehiculoPlaca: data.vehiculoPlaca, estadoEntrega: 'EN_RUTA',
      },
      include: { cliente: true },
    });

    await this.prisma.dispatchTracking.create({
      data: { orderId: id, estado: 'SALIDA_ALMACEN', usuario: data.despachador, notas: data.notas },
    });

    await this.audit(data.despachador, 'DESPACHO', 'SalesOrder', id, `Vehículo: ${data.vehiculoPlaca || 'N/A'}`);
    return { success: true, order };
  }

  // ============ MOVEMENTS (manual) ============
  @Post('movements')
  @ApiOperation({ summary: 'Registrar movimiento manual (trasiego, ajuste)' })
  async createMovement(@Body() data: any) {
    const movement = await this.prisma.inventoryMovement.create({
      data,
      include: { sku: true, fromLocation: true, toLocation: true },
    });

    if ((data.tipoMovimiento === 'TRASIEGO' || data.tipoMovimiento === 'TRANSFERENCIA') && data.lotId && data.toLocationId) {
      await this.prisma.lotInventory.update({
        where: { id: data.lotId },
        data: { ubicacionId: data.toLocationId },
      });
    }

    await this.audit(data.usuario, data.tipoMovimiento, 'InventoryMovement', movement.id, `Cant: ${data.cantidad}`);
    return movement;
  }

  // ============ TRACEABILITY ============
  @Get('traceability')
  @ApiOperation({ summary: 'Consultar trazabilidad' })
  async getTraceability(@Query('skuId') skuId?: string, @Query('clienteId') clienteId?: string) {
    const where: any = {};
    if (skuId) where.skuId = skuId;
    if (clienteId) where.clienteId = clienteId;

    return this.prisma.traceabilityLink.findMany({
      where,
      include: {
        sku: { select: { codigo: true, descripcion: true } },
        lote: { select: { lote: true, fechaVencimiento: true, proveedorNombre: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ============ CYCLE COUNTS ============
  @Get('cycle-counts')
  @ApiOperation({ summary: 'Listar conteos cíclicos' })
  async getCycleCounts(@Query('estado') estado?: string) {
    const where: any = {};
    if (estado) where.estado = estado;
    return this.prisma.cycleCount.findMany({
      where,
      include: { lineas: { include: { sku: { select: { codigo: true, descripcion: true } } } } },
      orderBy: { fechaProgramada: 'desc' },
    });
  }

  @Post('cycle-counts')
  @ApiOperation({ summary: 'Crear conteo cíclico' })
  async createCycleCount(@Body() data: any) {
    const count = await this.prisma.cycleCount.count();
    const codigo = `CC-${new Date().getFullYear()}-${String(count + 1).padStart(3, '0')}`;

    const lots = await this.prisma.lotInventory.findMany({
      where: { cantidadDisponible: { gt: 0 }, estadoCalidad: 'LIBERADO' },
      include: { sku: true },
    });

    const lineMap = new Map<string, { skuId: string; ubicacionId: string | null; lote: string | null; total: number }>();
    for (const lot of lots) {
      const key = lot.skuId;
      if (lineMap.has(key)) { lineMap.get(key)!.total += lot.cantidadDisponible; }
      else { lineMap.set(key, { skuId: lot.skuId, ubicacionId: lot.ubicacionId, lote: lot.lote, total: lot.cantidadDisponible }); }
    }

    return this.prisma.cycleCount.create({
      data: {
        codigo, nombre: data.nombre, tipo: data.tipo || 'SKU',
        fechaProgramada: new Date(data.fechaProgramada),
        almacenId: data.almacenId, asignadoA: data.asignadoA, notas: data.notas,
        lineas: {
          create: Array.from(lineMap.values()).map(item => ({
            skuId: item.skuId, ubicacionId: item.ubicacionId,
            lote: item.lote, cantidadSistema: item.total,
          })),
        },
      },
      include: { lineas: { include: { sku: { select: { codigo: true, descripcion: true } } } } },
    });
  }

  @Put('cycle-counts/:id/count')
  @ApiOperation({ summary: 'Registrar conteo físico de líneas' })
  async registerCycleCount(@Param('id') id: string, @Body() data: any) {
    // data.lineas = [{ id: lineId, cantidadFisica: number }]
    const cc = await this.prisma.cycleCount.findUnique({ where: { id } });
    if (!cc) throw new Error('Conteo no encontrado');

    for (const line of data.lineas) {
      const disc = line.cantidadFisica - (line.cantidadSistema || 0);
      await this.prisma.cycleCountLine.update({
        where: { id: line.id },
        data: {
          cantidadFisica: line.cantidadFisica,
          discrepancia: disc,
          porcentajeDisc: line.cantidadSistema ? (disc / line.cantidadSistema) * 100 : 0,
          contadoPor: data.usuario || 'admin',
          contadoEn: new Date(),
          estado: 'CONTADO',
        },
      });
    }

    await this.prisma.cycleCount.update({
      where: { id },
      data: { estado: 'EN_PROGRESO', fechaInicio: new Date() },
    });

    return { message: 'Conteo físico registrado', id };
  }

  @Post('cycle-counts/:id/finalize')
  @ApiOperation({ summary: 'Finalizar conteo y ajustar inventario real' })
  async finalizeCycleCount(@Param('id') id: string, @Body() data: any) {
    const cc = await this.prisma.cycleCount.findUnique({
      where: { id },
      include: { lineas: { include: { sku: true } } },
    });
    if (!cc) throw new Error('Conteo no encontrado');

    let adjustments = 0;

    for (const line of cc.lineas) {
      if (line.cantidadFisica === null) continue;
      const diff = line.cantidadFisica - line.cantidadSistema;
      if (diff === 0) continue;

      // Find matching lot to adjust
      const lots = await this.prisma.lotInventory.findMany({
        where: { skuId: line.skuId, cantidadDisponible: { gt: 0 } },
        orderBy: { createdAt: 'asc' },
      });

      if (lots.length > 0) {
        const lot = lots[0];
        const newQty = Math.max(0, lot.cantidadDisponible + diff);
        await this.prisma.lotInventory.update({
          where: { id: lot.id },
          data: { cantidadDisponible: newQty },
        });

        // If quantity went to zero, free the location
        if (newQty === 0 && lot.ubicacionId) {
          await this.prisma.location.update({
            where: { id: lot.ubicacionId },
            data: { estado: 'LIBRE' },
          });
        }

        // Create inventory movement for the adjustment
        await this.prisma.inventoryMovement.create({
          data: {
            tipoMovimiento: diff > 0 ? 'AJUSTE_ENTRADA' : 'AJUSTE_SALIDA',
            almacenId: cc.almacenId,
            skuId: line.skuId,
            clienteId: lot.clienteId,
            lotId: lot.id,
            toLocationId: lot.ubicacionId,
            cantidad: Math.abs(diff),
            usuario: data.usuario || 'admin@givingout.com',
            motivo: `Ajuste conteo cíclico ${cc.codigo} — ${line.sku?.descripcion || ''}`,
          },
        });

        adjustments++;
      } else if (diff > 0) {
        // Physical count found items not in system — flag but don't create lots
        adjustments++;
      }
    }

    await this.prisma.cycleCount.update({
      where: { id },
      data: {
        estado: 'COMPLETADO',
        fechaCierre: new Date(),
      },
    });

    return {
      message: `Conteo finalizado. ${adjustments} ajustes aplicados al inventario real.`,
      adjustments,
    };
  }


  @Get('dashboard/stats')
  @ApiOperation({ summary: 'Estadísticas para dashboard' })
  async getDashboardStats() {
    const [totalSkus, totalClients, totalLots, totalOrders, pendingOrders, activeAlerts, recentMovements] = await Promise.all([
      this.prisma.skuMaster.count({ where: { activo: true } }),
      this.prisma.client.count({ where: { activo: true } }),
      this.prisma.lotInventory.count({ where: { cantidadDisponible: { gt: 0 } } }),
      this.prisma.salesOrder.count(),
      this.prisma.salesOrder.count({ where: { estado: { in: ['PENDIENTE', 'CONFIRMADO', 'EN_PICKING'] } } }),
      this.prisma.alert.count({ where: { resuelta: false } }),
      this.prisma.inventoryMovement.findMany({ orderBy: { fechaHora: 'desc' }, take: 10, include: { sku: { select: { descripcion: true } } } }),
    ]);

    const totalUnidades = await this.prisma.lotInventory.aggregate({
      _sum: { cantidadDisponible: true },
      where: { cantidadDisponible: { gt: 0 } },
    });

    return {
      totalSkus, totalClients, totalLots, totalOrders, pendingOrders, activeAlerts,
      totalUnidades: totalUnidades._sum.cantidadDisponible || 0,
      recentMovements,
    };
  }
}
