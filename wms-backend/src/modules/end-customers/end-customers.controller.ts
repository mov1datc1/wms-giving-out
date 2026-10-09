import { Controller, Get, Post, Put, Delete, Param, Query, Body, Headers, HttpException, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { PrismaService } from '../../prisma.service';
import * as jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'giving-out-wms-secret-2026';

@ApiTags('End Customers (Ship-To)')
@Controller('api/end-customers')
export class EndCustomersController {
  constructor(private prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Listar clientes finales (Ship-To)' })
  async getEndCustomers(
    @Query('clienteId') clienteId?: string,
    @Query('activo') activo?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const where: any = {};
    let activeClienteId = clienteId;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const token = authHeader.split(' ')[1];
        const decoded: any = jwt.verify(token, JWT_SECRET);
        if (decoded?.clienteId) {
          activeClienteId = decoded.clienteId;
        } else if (decoded?.userId) {
          const user = await this.prisma.user.findUnique({ where: { id: decoded.userId } });
          if (user?.clienteId) activeClienteId = user.clienteId;
        }
      } catch {}
    }

    if (activeClienteId) where.clienteId = activeClienteId;
    if (activo !== undefined) where.activo = activo === 'true';

    return this.prisma.endCustomer.findMany({
      where,
      include: {
        cliente: { select: { nombreComercial: true, codigo: true } },
        _count: { select: { ordenes: true } },
      },
      orderBy: { nombre: 'asc' },
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalle de cliente final' })
  async getEndCustomer(@Param('id') id: string) {
    const ec = await this.prisma.endCustomer.findUnique({
      where: { id },
      include: {
        cliente: { select: { nombreComercial: true, codigo: true } },
        ordenes: {
          take: 10,
          orderBy: { createdAt: 'desc' },
          select: { id: true, codigo: true, estado: true, fechaCompromiso: true, createdAt: true },
        },
      },
    });
    if (!ec) throw new HttpException('Cliente final no encontrado', HttpStatus.NOT_FOUND);
    return ec;
  }

  @Post()
  @ApiOperation({ summary: 'Crear cliente final (Ship-To)' })
  async createEndCustomer(@Body() data: any) {
    if (!data.clienteId || !data.codigo || !data.nombre) {
      throw new HttpException('clienteId, codigo y nombre son obligatorios', HttpStatus.BAD_REQUEST);
    }

    // Verify depositor exists
    const client = await this.prisma.client.findUnique({ where: { id: data.clienteId } });
    if (!client) throw new HttpException('Depositante no encontrado', HttpStatus.NOT_FOUND);

    return this.prisma.endCustomer.create({
      data,
      include: { cliente: { select: { nombreComercial: true } } },
    });
  }

  @Put(':id')
  @ApiOperation({ summary: 'Actualizar cliente final' })
  async updateEndCustomer(@Param('id') id: string, @Body() data: any) {
    const { clienteId, ...updateData } = data; // Prevent changing depositor
    return this.prisma.endCustomer.update({
      where: { id },
      data: updateData,
      include: { cliente: { select: { nombreComercial: true } } },
    });
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Desactivar cliente final' })
  async deactivateEndCustomer(@Param('id') id: string) {
    return this.prisma.endCustomer.update({
      where: { id },
      data: { activo: false },
    });
  }
}
