import { Controller, Get, Post, Put, Param, Query, Body, HttpException, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { PrismaService } from '../../prisma.service';

@ApiTags('Depositantes')
@Controller('api/clients')
export class ClientsController {
  constructor(private prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Listar depositantes' })
  async getClients(@Query('activo') activo?: string, @Query('giro') giro?: string) {
    const where: any = {};
    if (activo !== undefined) where.activo = activo === 'true';
    if (giro) where.giro = giro;

    return this.prisma.client.findMany({
      where,
      include: {
        contactos: true,
        direccionesEntrega: true,
        endCustomers: { where: { activo: true }, select: { id: true, codigo: true, nombre: true, ciudad: true } },
        _count: { select: { skus: true, ordenesSalida: true, recepciones: true, endCustomers: true } },
      },
      orderBy: { nombreComercial: 'asc' },
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalle de depositante' })
  async getClient(@Param('id') id: string) {
    const client = await this.prisma.client.findUnique({
      where: { id },
      include: {
        contactos: true,
        direccionesEntrega: true,
        endCustomers: { where: { activo: true }, orderBy: { nombre: 'asc' } },
        _count: { select: { skus: true, ordenesSalida: true, recepciones: true, lotes: true, handlingUnits: true, endCustomers: true } },
      },
    });
    if (!client) throw new HttpException('Depositante no encontrado', HttpStatus.NOT_FOUND);
    return client;
  }

  @Post()
  @ApiOperation({ summary: 'Crear depositante' })
  async createClient(@Body() data: any) {
    const { contactos, direcciones, ...clientData } = data;
    return this.prisma.client.create({
      data: {
        ...clientData,
        contactos: contactos ? { create: contactos } : undefined,
        direccionesEntrega: direcciones ? { create: direcciones } : undefined,
      },
      include: { contactos: true, direccionesEntrega: true },
    });
  }

  @Put(':id')
  @ApiOperation({ summary: 'Actualizar depositante' })
  async updateClient(@Param('id') id: string, @Body() data: any) {
    return this.prisma.client.update({
      where: { id },
      data,
      include: { contactos: true, direccionesEntrega: true },
    });
  }

  // ============ 3PL CONFIG ============
  @Put(':id/config')
  @ApiOperation({ summary: 'Configurar parámetros operativos 3PL del depositante' })
  async updateConfig(@Param('id') id: string, @Body() data: {
    uomPrincipal?: string; manejoInventario?: string; reglaInventario?: string;
    escaneoIndividual?: boolean; requiereAprobacion?: boolean;
    requiereLote?: boolean; requiereSerie?: boolean; requiereCaducidad?: boolean;
    zonaAsignadaId?: string; colorPortal?: string; logoUrl?: string;
  }) {
    return this.prisma.client.update({
      where: { id },
      data,
      include: { contactos: true, direccionesEntrega: true, endCustomers: true },
    });
  }

  // ============ CONTACTS ============
  @Post(':id/contacts')
  @ApiOperation({ summary: 'Agregar contacto a depositante' })
  async addContact(@Param('id') clienteId: string, @Body() data: any) {
    return this.prisma.clientContact.create({ data: { ...data, clienteId } });
  }

  // ============ ADDRESSES ============
  @Post(':id/addresses')
  @ApiOperation({ summary: 'Agregar dirección de entrega' })
  async addAddress(@Param('id') clienteId: string, @Body() data: any) {
    return this.prisma.clientAddress.create({ data: { ...data, clienteId } });
  }

  // ============ CLIENT INVENTORY SUMMARY ============
  @Get(':id/inventory')
  @ApiOperation({ summary: 'Resumen de inventario del depositante' })
  async getClientInventory(@Param('id') clienteId: string) {
    const lots = await this.prisma.lotInventory.findMany({
      where: { clienteId, cantidadDisponible: { gt: 0 } },
      include: {
        sku: { select: { codigo: true, descripcion: true, categoria: true, talla: true, color: true, uomBase: true } },
        ubicacion: { select: { codigo: true, zona: true } },
      },
      orderBy: { sku: { descripcion: 'asc' } },
    });

    const totalSkus = new Set(lots.map(l => l.skuId)).size;
    const totalUnidades = lots.reduce((sum, l) => sum + l.cantidadDisponible, 0);

    return { clienteId, totalSkus, totalUnidades, lotes: lots };
  }
}
