import { Controller, Get, Post, Put, Param, Query, Body } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { PrismaService } from '../../prisma.service';
import { EmailService } from '../../email.service';

@ApiTags('Master Data')
@Controller('api')
export class MasterDataController {
  constructor(private prisma: PrismaService, private emailService: EmailService) {}

  // ============ SKUs ============
  @Get('skus')
  @ApiOperation({ summary: 'Listar catálogo de SKUs' })
  async getSkus(
    @Query('clienteId') clienteId?: string,
    @Query('categoria') categoria?: string,
    @Query('buscar') buscar?: string,
  ) {
    const where: any = {};
    if (clienteId) where.clienteId = clienteId;
    if (categoria) where.categoria = categoria;
    if (buscar) {
      where.OR = [
        { codigo: { contains: buscar, mode: 'insensitive' } },
        { descripcion: { contains: buscar, mode: 'insensitive' } },
        { marca: { contains: buscar, mode: 'insensitive' } },
      ];
    }

    return this.prisma.skuMaster.findMany({
      where,
      include: { cliente: { select: { nombreComercial: true, giro: true } } },
      orderBy: { descripcion: 'asc' },
    });
  }

  @Post('skus')
  @ApiOperation({ summary: 'Crear SKU' })
  async createSku(@Body() data: any) {
    return this.prisma.skuMaster.create({
      data,
      include: { cliente: { select: { nombreComercial: true } } },
    });
  }

  @Put('skus/:id')
  @ApiOperation({ summary: 'Actualizar SKU' })
  async updateSku(@Param('id') id: string, @Body() data: any) {
    return this.prisma.skuMaster.update({ where: { id }, data });
  }

  // ============ SUPPLIERS ============
  @Get('suppliers')
  @ApiOperation({ summary: 'Listar proveedores' })
  async getSuppliers() {
    return this.prisma.supplier.findMany({ where: { activo: true }, orderBy: { nombre: 'asc' } });
  }

  @Post('suppliers')
  @ApiOperation({ summary: 'Crear proveedor' })
  async createSupplier(@Body() data: any) {
    return this.prisma.supplier.create({ data });
  }

  @Put('suppliers/:id')
  @ApiOperation({ summary: 'Actualizar proveedor' })
  async updateSupplier(@Param('id') id: string, @Body() data: any) {
    return this.prisma.supplier.update({ where: { id }, data });
  }

  // ============ WAREHOUSES ============
  @Get('warehouses')
  @ApiOperation({ summary: 'Listar almacenes' })
  async getWarehouses() {
    return this.prisma.warehouse.findMany({
      include: { _count: { select: { locations: true, zones: true } } },
      orderBy: { nombre: 'asc' },
    });
  }

  @Post('warehouses')
  @ApiOperation({ summary: 'Crear almacén' })
  async createWarehouse(@Body() data: any) {
    return this.prisma.warehouse.create({ data });
  }

  // ============ ZONES ============
  @Get('zones')
  @ApiOperation({ summary: 'Listar zonas' })
  async getZones(@Query('almacenId') almacenId?: string) {
    const where: any = {};
    if (almacenId) where.almacenId = almacenId;
    return this.prisma.zone.findMany({
      where,
      include: { almacen: { select: { codigo: true, nombre: true } }, _count: { select: { locations: true } } },
      orderBy: { codigo: 'asc' },
    });
  }

  @Post('zones')
  @ApiOperation({ summary: 'Crear zona' })
  async createZone(@Body() data: any) {
    return this.prisma.zone.create({ data });
  }

  // ============ LOCATIONS ============
  @Get('locations')
  @ApiOperation({ summary: 'Listar ubicaciones' })
  async getLocations(@Query('almacenId') almacenId?: string, @Query('zonaId') zonaId?: string, @Query('estado') estado?: string) {
    const where: any = {};
    if (almacenId) where.almacenId = almacenId;
    if (zonaId) where.zonaId = zonaId;
    if (estado) where.estado = estado;

    return this.prisma.location.findMany({
      where,
      include: {
        zona: { select: { codigo: true, nombre: true } },
        almacen: { select: { codigo: true, nombre: true } },
        lotes: { where: { cantidadDisponible: { gt: 0 } }, select: { id: true, cantidadDisponible: true } },
      },
      orderBy: { codigo: 'asc' },
    });
  }

  @Post('locations')
  @ApiOperation({ summary: 'Crear ubicación' })
  async createLocation(@Body() data: any) {
    return this.prisma.location.create({ data });
  }

  @Put('locations/:id')
  @ApiOperation({ summary: 'Actualizar ubicación' })
  async updateLocation(@Param('id') id: string, @Body() data: any) {
    return this.prisma.location.update({ where: { id }, data });
  }

  // ============ ALERTS ============
  @Get('alerts')
  @ApiOperation({ summary: 'Listar alertas' })
  async getAlerts(@Query('clienteId') clienteId?: string, @Query('todas') todas?: string) {
    const where: any = {};
    if (todas !== 'true') where.resuelta = false;
    if (clienteId) where.clienteId = clienteId;
    return this.prisma.alert.findMany({
      where, orderBy: { createdAt: 'desc' }, take: 100,
      include: { tasks: { select: { id: true, area: true, estado: true, asignadoNombre: true } } },
    });
  }

  @Post('alerts')
  @ApiOperation({ summary: 'Crear alerta manual' })
  async createAlert(@Body() data: any) {
    return this.prisma.alert.create({ data });
  }

  @Put('alerts/:id/resolve')
  @ApiOperation({ summary: 'Resolver alerta' })
  async resolveAlert(@Param('id') id: string, @Body() data: any) {
    return this.prisma.alert.update({
      where: { id },
      data: { resuelta: true, resueltaPor: data.usuario || 'admin', resueltaEn: new Date() },
    });
  }

  @Post('alerts/generate')
  @ApiOperation({ summary: 'Generar alertas inteligentes escaneando inventario' })
  async generateAlerts() {
    const alerts: any[] = [];
    const now = new Date();

    // 1. STOCK BAJO: lotes con menos de 10 unidades disponibles
    const lowStock = await this.prisma.lotInventory.findMany({
      where: { cantidadDisponible: { gt: 0, lt: 10 }, estadoCalidad: 'LIBERADO' },
      include: { sku: { select: { codigo: true, descripcion: true } }, cliente: { select: { id: true, nombreComercial: true } } },
    });
    for (const lot of lowStock) {
      const exists = await this.prisma.alert.findFirst({
        where: { tipo: 'STOCK_BAJO', entidadId: lot.id, resuelta: false },
      });
      if (!exists) {
        alerts.push({
          tipo: 'STOCK_BAJO', prioridad: lot.cantidadDisponible < 5 ? 'CRITICA' : 'ALTA',
          titulo: `Stock bajo: ${lot.sku?.codigo} — ${lot.cantidadDisponible} uds`,
          detalle: `${lot.sku?.descripcion} del cliente ${lot.cliente?.nombreComercial} tiene solo ${lot.cantidadDisponible} unidades disponibles.`,
          entidad: 'LotInventory', entidadId: lot.id, clienteId: lot.clienteId,
        });
      }
    }

    // 2. VENCIMIENTO PRÓXIMO: productos que vencen en < 30 días
    const thirtyDays = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const expiring = await this.prisma.lotInventory.findMany({
      where: { fechaVencimiento: { lte: thirtyDays, gte: now }, cantidadDisponible: { gt: 0 } },
      include: { sku: { select: { codigo: true, descripcion: true } }, cliente: { select: { id: true, nombreComercial: true } } },
    });
    for (const lot of expiring) {
      const exists = await this.prisma.alert.findFirst({
        where: { tipo: 'VENCIMIENTO_PROXIMO', entidadId: lot.id, resuelta: false },
      });
      if (!exists) {
        const daysLeft = Math.ceil((lot.fechaVencimiento!.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        alerts.push({
          tipo: 'VENCIMIENTO_PROXIMO', prioridad: daysLeft < 7 ? 'CRITICA' : daysLeft < 15 ? 'ALTA' : 'MEDIA',
          titulo: `Vence en ${daysLeft} días: ${lot.sku?.codigo}`,
          detalle: `${lot.sku?.descripcion} — Lote ${lot.lote || 'N/A'} vence el ${lot.fechaVencimiento!.toLocaleDateString('es-MX')}. ${lot.cantidadDisponible} uds en stock.`,
          entidad: 'LotInventory', entidadId: lot.id, clienteId: lot.clienteId,
        });
      }
    }

    // 3. PEDIDOS ATRASADOS: más de 3 días en estado PENDIENTE o CONFIRMADO
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    const lateOrders = await this.prisma.salesOrder.findMany({
      where: { estado: { in: ['PENDIENTE', 'CONFIRMADO'] }, createdAt: { lt: threeDaysAgo } },
      include: { cliente: { select: { id: true, nombreComercial: true } } },
    });
    for (const order of lateOrders) {
      const exists = await this.prisma.alert.findFirst({
        where: { tipo: 'PEDIDO_ATRASADO', entidadId: order.id, resuelta: false },
      });
      if (!exists) {
        const daysLate = Math.ceil((now.getTime() - order.createdAt.getTime()) / (1000 * 60 * 60 * 24));
        alerts.push({
          tipo: 'PEDIDO_ATRASADO', prioridad: daysLate > 7 ? 'CRITICA' : 'ALTA',
          titulo: `Pedido atrasado ${daysLate}d: ${order.codigo}`,
          detalle: `Pedido ${order.codigo} de ${order.cliente?.nombreComercial} lleva ${daysLate} días sin despachar. Estado: ${order.estado}.`,
          entidad: 'SalesOrder', entidadId: order.id, clienteId: order.clienteId,
        });
      }
    }

    // 4. SIN MOVIMIENTO: SKUs sin movimiento en > 14 días
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const activeLots = await this.prisma.lotInventory.findMany({
      where: { cantidadDisponible: { gt: 0 } },
      include: { sku: { select: { id: true, codigo: true, descripcion: true } }, cliente: { select: { id: true, nombreComercial: true } } },
    });
    for (const lot of activeLots) {
      const recentMove = await this.prisma.inventoryMovement.findFirst({
        where: { skuId: lot.skuId, fechaHora: { gte: fourteenDaysAgo } },
      });
      if (!recentMove) {
        const exists = await this.prisma.alert.findFirst({
          where: { tipo: 'SIN_MOVIMIENTO', entidadId: lot.skuId, resuelta: false },
        });
        if (!exists) {
          alerts.push({
            tipo: 'SIN_MOVIMIENTO', prioridad: 'MEDIA',
            titulo: `Sin movimiento: ${lot.sku?.codigo}`,
            detalle: `${lot.sku?.descripcion} de ${lot.cliente?.nombreComercial} lleva más de 14 días sin movimiento. ${lot.cantidadDisponible} uds en stock.`,
            entidad: 'SkuMaster', entidadId: lot.skuId, clienteId: lot.clienteId,
          });
        }
      }
    }

    // Bulk create
    if (alerts.length > 0) {
      await this.prisma.alert.createMany({ data: alerts });
    }

    return { message: `${alerts.length} nuevas alertas generadas`, count: alerts.length };
  }

  // ============ TASKS ============
  @Get('tasks')
  @ApiOperation({ summary: 'Listar tareas' })
  async getTasks(@Query('estado') estado?: string, @Query('area') area?: string) {
    const where: any = {};
    if (estado) where.estado = estado;
    if (area) where.area = area;
    return this.prisma.task.findMany({
      where,
      include: { alerta: { select: { id: true, tipo: true, titulo: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  @Post('tasks')
  @ApiOperation({ summary: 'Crear tarea desde alerta' })
  async createTask(@Body() data: any) {
    const task = await this.prisma.task.create({
      data: {
        titulo: data.titulo,
        descripcion: data.descripcion,
        area: data.area,
        asignadoA: data.asignadoA,
        asignadoNombre: data.asignadoNombre,
        prioridad: data.prioridad || 'MEDIA',
        fechaLimite: data.fechaLimite ? new Date(data.fechaLimite) : null,
        notas: data.notas,
        alertaId: data.alertaId,
        creadoPor: data.creadoPor,
      },
      include: { alerta: { select: { id: true, tipo: true, titulo: true } } },
    });

    // Send email notification (async, non-blocking)
    if (data.notificarEmail && data.asignadoA) {
      this.emailService.sendTaskNotification(task).then(result => {
        console.log(`📧 Email to ${data.asignadoA}: ${result.success ? '✅ sent' : '❌ ' + result.error}`);
      });
    }

    return task;
  }

  @Put('tasks/:id/status')
  @ApiOperation({ summary: 'Actualizar estado de tarea' })
  async updateTaskStatus(@Param('id') id: string, @Body() data: any) {
    const updateData: any = { estado: data.estado };
    if (data.estado === 'COMPLETADA') {
      updateData.completadaEn = new Date();
      updateData.completadaPor = data.usuario || 'admin';
    }
    return this.prisma.task.update({ where: { id }, data: updateData });
  }

  // ============ SYSTEM SETTINGS ============
  @Get('settings')
  @ApiOperation({ summary: 'Obtener configuraciones del sistema' })
  async getSettings(@Query('category') category?: string) {
    const where: any = {};
    if (category) where.category = category;
    return this.prisma.systemSetting.findMany({ where, orderBy: { key: 'asc' } });
  }

  @Put('settings')
  @ApiOperation({ summary: 'Guardar configuraciones (batch)' })
  async saveSettings(@Body() data: { settings: { key: string; value: string; category?: string; label?: string }[] }) {
    const results: any[] = [];
    for (const s of data.settings) {
      const result = await this.prisma.systemSetting.upsert({
        where: { key: s.key },
        update: { value: s.value },
        create: { key: s.key, value: s.value, category: s.category || 'general', label: s.label },
      });
      results.push(result);
    }
    return { message: `${results.length} configuraciones guardadas`, count: results.length };
  }

  @Post('settings/test-email')
  @ApiOperation({ summary: 'Probar conexión SMTP' })
  async testEmail() {
    return this.emailService.testConnection();
  }
}
