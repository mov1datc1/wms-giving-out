import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { PrismaService } from '../../prisma.service';

@ApiTags('Inventory')
@Controller('api/inventory')
export class InventoryController {
  constructor(private prisma: PrismaService) {}

  @Get('lots')
  @ApiOperation({ summary: 'Listar inventario por lote (stock vivo)' })
  async getLots(
    @Query('clienteId') clienteId?: string,
    @Query('skuId') skuId?: string,
    @Query('estado') estado?: string,
  ) {
    const where: any = { cantidadDisponible: { gt: 0 } };
    if (clienteId) where.clienteId = clienteId;
    if (skuId) where.skuId = skuId;
    if (estado) where.estadoCalidad = estado;

    return this.prisma.lotInventory.findMany({
      where,
      include: {
        sku: { select: { codigo: true, descripcion: true, categoria: true, talla: true, color: true, marca: true, uomBase: true, capacidadEmpaque: true } },
        cliente: { select: { nombreComercial: true, giro: true } },
        ubicacion: { select: { codigo: true } },
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
}
