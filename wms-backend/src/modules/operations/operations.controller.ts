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
  @ApiOperation({ summary: 'Registrar recepción de mercancía (Conforme y No Conforme)' })
  async registerReception(@Body() data: {
    skuId: string; clienteId: string; lote?: string; serie?: string;
    fechaVencimiento?: string; cantidadConforme?: number; cantidadNoConforme?: number; 
    proveedor?: string; tipoHu: string; 
    ubicacionConformeId?: string; ubicacionNoConformeId?: string; 
    almacenId: string; usuario: string; notas?: string; receiptLineId?: string;
  }) {
    const qtyConforme = data.cantidadConforme || 0;
    const qtyNoConforme = data.cantidadNoConforme || 0;
    const totalQty = qtyConforme + qtyNoConforme;

    if (totalQty <= 0) throw new HttpException('Cantidad total debe ser mayor a 0', HttpStatus.BAD_REQUEST);

    const createdLots: any[] = [];
    const createdHus: any[] = [];

    // --- Procesar Conforme ---
    if (qtyConforme > 0 && data.ubicacionConformeId) {
      const lotC = await this.prisma.lotInventory.create({
        data: {
          skuId: data.skuId, clienteId: data.clienteId,
          lote: data.lote || null, serie: data.serie || null,
          fechaVencimiento: data.fechaVencimiento ? new Date(data.fechaVencimiento) : null,
          proveedorNombre: data.proveedor,
          estadoCalidad: 'LIBERADO',
          cantidadDisponible: qtyConforme,
          ubicacionId: data.ubicacionConformeId,
        },
      });

      const huCodigoC = `HU-${new Date().getFullYear()}-${String(await this.prisma.handlingUnit.count() + 1).padStart(5, '0')}`;
      const huC = await this.prisma.handlingUnit.create({
        data: {
          codigo: huCodigoC, tipoHu: data.tipoHu, lotId: lotC.id,
          clienteId: data.clienteId, cantidad: qtyConforme,
          uom: 'PZA', ubicacionActual: data.ubicacionConformeId,
        },
      });

      await this.prisma.inventoryMovement.create({
        data: {
          tipoMovimiento: 'ENTRADA', almacenId: data.almacenId,
          skuId: data.skuId, clienteId: data.clienteId, lotId: lotC.id,
          huId: huC.id, toLocationId: data.ubicacionConformeId,
          cantidad: qtyConforme, usuario: data.usuario,
          motivo: data.notas || `Recepción Conforme — ${data.proveedor || 'Proveedor'}`,
        },
      });

      await this.prisma.location.update({
        where: { id: data.ubicacionConformeId },
        data: { ocupacion: { increment: 1 }, estado: 'OCUPADO' },
      });

      createdLots.push(lotC);
      createdHus.push(huC);
    }

    // --- Procesar No Conforme ---
    if (qtyNoConforme > 0 && data.ubicacionNoConformeId) {
      const lotNC = await this.prisma.lotInventory.create({
        data: {
          skuId: data.skuId, clienteId: data.clienteId,
          lote: data.lote || null, serie: data.serie || null,
          fechaVencimiento: data.fechaVencimiento ? new Date(data.fechaVencimiento) : null,
          proveedorNombre: data.proveedor,
          estadoCalidad: 'BLOQUEADO',
          cantidadBloqueada: qtyNoConforme,
          cantidadDisponible: 0,
          ubicacionId: data.ubicacionNoConformeId,
        },
      });

      const huCodigoNC = `HU-${new Date().getFullYear()}-${String(await this.prisma.handlingUnit.count() + 1).padStart(5, '0')}`;
      const huNC = await this.prisma.handlingUnit.create({
        data: {
          codigo: huCodigoNC, tipoHu: data.tipoHu, lotId: lotNC.id,
          clienteId: data.clienteId, cantidad: qtyNoConforme,
          uom: 'PZA', ubicacionActual: data.ubicacionNoConformeId,
        },
      });

      await this.prisma.inventoryMovement.create({
        data: {
          tipoMovimiento: 'ENTRADA', almacenId: data.almacenId,
          skuId: data.skuId, clienteId: data.clienteId, lotId: lotNC.id,
          huId: huNC.id, toLocationId: data.ubicacionNoConformeId,
          cantidad: qtyNoConforme, usuario: data.usuario,
          motivo: data.notas || `Recepción No Conforme — ${data.proveedor || 'Proveedor'}`,
        },
      });

      await this.prisma.location.update({
        where: { id: data.ubicacionNoConformeId },
        data: { ocupacion: { increment: 1 }, estado: 'OCUPADO' },
      });

      createdLots.push(lotNC);
      createdHus.push(huNC);
    }

    // Update receipt line if linked
    if (data.receiptLineId) {
      const line = await this.prisma.receiptLine.findUnique({ where: { id: data.receiptLineId } });
      if (line) {
        const newRecibida = line.cantidadRecibida + qtyConforme;
        const newDanada = line.cantidadDanada + qtyNoConforme;
        const totalProcesada = newRecibida + newDanada;
        
        await this.prisma.receiptLine.update({
          where: { id: data.receiptLineId },
          data: {
            cantidadRecibida: newRecibida,
            cantidadDanada: newDanada,
            estado: line.cantidadEsperada && totalProcesada >= line.cantidadEsperada ? 'COMPLETO' : 'PARCIAL',
            loteAsignado: data.lote, 
            ubicacionId: data.ubicacionConformeId || data.ubicacionNoConformeId, // Just keeping one ref
          },
        });
      }
    }

    await this.audit(data.usuario, 'RECEPCION', 'LotInventory', createdLots[0]?.id,
      `Lote: ${data.lote || 'N/A'}, C: ${qtyConforme}, NC: ${qtyNoConforme}`);

    return { success: true, lots: createdLots, handlingUnits: createdHus, message: `Recepción procesada correctamente` };
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
        cliente: { select: { nombreComercial: true, reglaInventario: true } },
        endCustomer: { select: { nombre: true, ciudad: true, calle: true } },
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

    // Sanitize: only pass valid SalesOrder fields to Prisma
    const cleanLines = (data.lineas || []).map((l: any) => ({
      skuId: l.skuId,
      cantidadSolicitada: l.cantidadSolicitada,
      cantidadAsignada: l.cantidadAsignada || 0,
      ...(l.lotId ? { lotId: l.lotId } : {}),
      ...(l.huId ? { huId: l.huId } : {}),
    }));

    const order = await this.prisma.salesOrder.create({
      data: {
        codigo,
        clienteId: data.clienteId,
        endCustomerId: data.endCustomerId || null,
        prioridad: data.prioridad || 3,
        fechaCompromiso: data.fechaCompromiso ? new Date(data.fechaCompromiso) : null,
        estado: data.estado || 'SOLICITADO',
        notas: data.notas || null,
        solicitadoPor: data.solicitadoPor || null,
        lineas: { create: cleanLines },
      },
      include: { cliente: true, endCustomer: true, lineas: { include: { sku: true } } },
    });

    await this.audit(data.usuario || 'Sistema', 'CREAR_ORDEN', 'SalesOrder', order.id, `${codigo}: ${cleanLines.length} líneas`);
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

  @Post('orders/:id/approve')
  @ApiOperation({ summary: 'Aprobar orden de salida (3PL workflow)' })
  async approveOrder(@Param('id') id: string, @Body() body: { usuario: string; notas?: string }) {
    const order = await this.prisma.salesOrder.findUnique({ where: { id } });
    if (!order) throw new HttpException('Orden no encontrada', HttpStatus.NOT_FOUND);

    const updated = await this.prisma.salesOrder.update({
      where: { id },
      data: {
        estado: 'APROBADO', aprobado: true,
        fechaAprobacion: new Date(), aprobadoPor: body.usuario,
      },
      include: { cliente: true, endCustomer: true },
    });

    await this.prisma.orderApproval.create({
      data: { orderId: id, estado: 'APROBADO', aprobadoPor: body.usuario, notas: body.notas },
    });

    await this.audit(body.usuario, 'APROBAR_ORDEN', 'SalesOrder', id, `Orden ${order.codigo} aprobada`);
    return { success: true, order: updated };
  }

  @Post('orders/:id/reject')
  @ApiOperation({ summary: 'Rechazar orden de salida (3PL workflow)' })
  async rejectOrder(@Param('id') id: string, @Body() body: { usuario: string; motivo: string; notas?: string }) {
    const order = await this.prisma.salesOrder.findUnique({ where: { id } });
    if (!order) throw new HttpException('Orden no encontrada', HttpStatus.NOT_FOUND);
    if (!body.motivo) throw new HttpException('El motivo de rechazo es obligatorio', HttpStatus.BAD_REQUEST);

    const updated = await this.prisma.salesOrder.update({
      where: { id },
      data: { estado: 'RECHAZADO', motivoRechazo: body.motivo },
      include: { cliente: true, endCustomer: true },
    });

    await this.prisma.orderApproval.create({
      data: { orderId: id, estado: 'RECHAZADO', aprobadoPor: body.usuario, motivo: body.motivo, notas: body.notas },
    });

    await this.audit(body.usuario, 'RECHAZAR_ORDEN', 'SalesOrder', id, `Orden ${order.codigo} rechazada: ${body.motivo}`);
    return { success: true, order: updated };
  }

  @Post('orders/:id/dispatch')
  @ApiOperation({ summary: 'Confirmar despacho — descuenta inventario y libera ubicaciones' })
  async dispatchOrder(@Param('id') id: string, @Body() data: { despachador: string; vehiculoPlaca?: string; notas?: string; tipoTransporte?: string; paqueteria?: string; numeroGuia?: string }) {
    const fullOrder = await this.prisma.salesOrder.findUnique({
      where: { id },
      include: { lineas: { include: { sku: true } }, cliente: true, endCustomer: true },
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
            motivo: `Despacho ${fullOrder.codigo} → ${(fullOrder as any).endCustomer?.nombre || fullOrder.cliente.nombreComercial}`,
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
        tipoTransporte: data.tipoTransporte, paqueteria: data.paqueteria, numeroGuia: data.numeroGuia,
      },
      include: { cliente: true, endCustomer: true },
    });

    await this.prisma.dispatchTracking.create({
      data: { orderId: id, estado: 'SALIDA_ALMACEN', usuario: data.despachador, notas: data.notas },
    });

    await this.audit(data.despachador, 'DESPACHO', 'SalesOrder', id, `Vehículo: ${data.vehiculoPlaca || 'N/A'}`);
    return { success: true, order };
  }

  @Post('orders/:id/confirm-delivery')
  @ApiOperation({ summary: 'Confirmar entrega al cliente final' })
  async confirmDelivery(@Param('id') id: string, @Body() data: { usuario: string; nombreReceptor: string; notasEntrega?: string; firmaBase64?: string }) {
    const order = await this.prisma.salesOrder.findUnique({ where: { id }, include: { cliente: true, endCustomer: true } });
    if (!order) throw new HttpException('Orden no encontrada', HttpStatus.NOT_FOUND);

    const updated = await this.prisma.salesOrder.update({
      where: { id },
      data: {
        estado: 'ENTREGADO',
        estadoEntrega: 'ENTREGADO',
        fechaEntrega: new Date(),
        nombreReceptor: data.nombreReceptor,
        notasEntrega: data.notasEntrega || null,
        firmaReceptor: data.firmaBase64 || null,
      },
      include: { cliente: true, endCustomer: true },
    });

    await this.prisma.dispatchTracking.create({
      data: {
        orderId: id,
        estado: 'ENTREGADO',
        usuario: data.usuario,
        notas: `Recibió: ${data.nombreReceptor}${data.notasEntrega ? ` — ${data.notasEntrega}` : ''}`,
        nombreFirmante: data.nombreReceptor,
        firmaBase64: data.firmaBase64,
      },
    });

    await this.audit(data.usuario, 'ENTREGA_CONFIRMADA', 'SalesOrder', id,
      `${order.codigo} entregado a ${data.nombreReceptor} en ${(order as any).endCustomer?.nombre || 'destino'}`);
    return { success: true, order: updated };
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
      this.prisma.salesOrder.count({ where: { estado: { in: ['SOLICITADO', 'PENDIENTE_APROBACION', 'APROBADO', 'EN_PICKING'] } } }),
      this.prisma.alert.count({ where: { resuelta: false } }),
      this.prisma.inventoryMovement.findMany({ orderBy: { fechaHora: 'desc' }, take: 10, include: { sku: { select: { descripcion: true } } } }),
    ]);

    const [totalUnidades, pendingApprovals, totalEndCustomers] = await Promise.all([
      this.prisma.lotInventory.aggregate({ _sum: { cantidadDisponible: true }, where: { cantidadDisponible: { gt: 0 } } }),
      this.prisma.salesOrder.count({ where: { estado: { in: ['SOLICITADO', 'PENDIENTE_APROBACION'] } } }),
      this.prisma.endCustomer.count({ where: { activo: true } }),
    ]);

    return {
      totalSkus, totalClients, totalLots, totalOrders, pendingOrders, activeAlerts,
      totalUnidades: totalUnidades._sum.cantidadDisponible || 0,
      pendingApprovals, totalEndCustomers,
      recentMovements,
    };
  }
}
