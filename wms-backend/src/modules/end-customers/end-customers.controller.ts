import { Controller, Get, Post, Put, Delete, Param, Query, Body, Req, HttpException, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { PrismaService } from '../../prisma.service';
import { RequireAccess } from '../auth/auth.decorators';
import { CreateEndCustomerDto, UpdateEndCustomerDto } from './dto/end-customer.dto';

function cleanOptionalText(v: any): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

@ApiTags('End Customers (Ship-To)')
@Controller('api/end-customers')
export class EndCustomersController {
  constructor(private prisma: PrismaService) {}

  @Get()
  @RequireAccess({
    modules: ['clientes-finales', 'despacho', 'picking'],
    allowPortal: true,
  })
  @ApiOperation({ summary: 'Listar clientes finales (Ship-To)' })
  async getEndCustomers(
    @Query('clienteId') clienteId?: string,
    @Query('activo') activo?: string,
    @Req() req?: any,
  ) {
    const where: any = {};
    const tenantClienteId = req?.user?.clienteId || null;
    const activeClienteId = tenantClienteId || clienteId;

    if (activeClienteId) where.clienteId = activeClienteId;
    if (activo === 'true' || activo === 'false') {
      where.activo = activo === 'true';
    }

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
  @RequireAccess({
    modules: ['clientes-finales', 'despacho', 'picking'],
    allowPortal: true,
  })
  @ApiOperation({ summary: 'Detalle de cliente final' })
  async getEndCustomer(@Param('id') id: string, @Req() req?: any) {
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
    if (req?.user?.clienteId && ec.clienteId !== req.user.clienteId) {
      throw new HttpException('ACCESO_DENEGADO: El destino pertenece a otro depositante.', HttpStatus.FORBIDDEN);
    }
    return ec;
  }

  @Post()
  @RequireAccess({
    modules: ['clientes-finales'],
    actions: ['crear'],
    allowPortal: true,
  })
  @ApiOperation({ summary: 'Crear cliente final (Ship-To)' })
  async createEndCustomer(@Body() data: CreateEndCustomerDto, @Req() req?: any) {
    const tenantClienteId = req?.user?.clienteId || null;
    const resolvedClienteId = tenantClienteId
      ? (data?.clienteId && data.clienteId !== tenantClienteId
          ? (() => {
              throw new HttpException('ACCESO_DENEGADO: No puede crear destinos para otro depositante.', HttpStatus.FORBIDDEN);
            })()
          : tenantClienteId)
      : String(data?.clienteId || '').trim();

    const cleanCodigo = String(data?.codigo || '').trim().toUpperCase();
    const cleanNombre = String(data?.nombre || '').trim();

    if (!resolvedClienteId || !cleanCodigo || !cleanNombre) {
      throw new HttpException('clienteId, codigo y nombre son obligatorios', HttpStatus.BAD_REQUEST);
    }

    const client = await this.prisma.client.findUnique({ where: { id: resolvedClienteId } });
    if (!client) throw new HttpException('Depositante no encontrado', HttpStatus.NOT_FOUND);

    try {
      const created = await this.prisma.endCustomer.create({
        data: {
          clienteId: resolvedClienteId,
          codigo: cleanCodigo,
          nombre: cleanNombre,
          razonSocial: cleanOptionalText(data.razonSocial) ?? null,
          rfc: cleanOptionalText(data.rfc)?.toUpperCase() ?? null,
          contacto: cleanOptionalText(data.contacto) ?? null,
          telefono: cleanOptionalText(data.telefono) ?? null,
          email: cleanOptionalText(data.email) ?? null,
          calle: cleanOptionalText(data.calle) ?? null,
          colonia: cleanOptionalText(data.colonia) ?? null,
          ciudad: cleanOptionalText(data.ciudad) ?? null,
          estado: cleanOptionalText(data.estado) ?? null,
          codigoPostal: cleanOptionalText(data.codigoPostal) ?? null,
          referencia: cleanOptionalText(data.referencia) ?? null,
          instruccionesEntrega: cleanOptionalText(data.instruccionesEntrega) ?? null,
          requiereFactura: Boolean(data.requiereFactura),
        },
        include: {
          cliente: { select: { nombreComercial: true, codigo: true } },
          _count: { select: { ordenes: true } },
        },
      });

      await this.prisma.auditLog.create({
        data: {
          usuario: req?.user?.email || req?.user?.nombre || 'sistema',
          accion: 'CREAR_CLIENTE_FINAL',
          entidad: 'EndCustomer',
          entidadId: created.id,
          detalle: `Alta de destino Ship-To ${created.codigo} (${created.nombre}) para depositante ${client.nombreComercial}`,
        },
      });

      return created;
    } catch (error: any) {
      if (error?.code === 'P2002') {
        throw new HttpException(
          {
            statusCode: HttpStatus.CONFLICT,
            message: `Ya existe un destino con el código [${cleanCodigo}] para este depositante.`,
            error: 'Conflict',
            codigo: 'CODIGO_DUPLICADO',
          },
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }
  }

  @Put(':id')
  @RequireAccess({
    modules: ['clientes-finales'],
    actions: ['editar'],
    allowPortal: true,
  })
  @ApiOperation({ summary: 'Actualizar cliente final' })
  async updateEndCustomer(@Param('id') id: string, @Body() data: UpdateEndCustomerDto, @Req() req?: any) {
    const existing = await this.prisma.endCustomer.findUnique({ where: { id } });
    if (!existing) throw new HttpException('Cliente final no encontrado', HttpStatus.NOT_FOUND);
    if (req?.user?.clienteId && existing.clienteId !== req.user.clienteId) {
      throw new HttpException('ACCESO_DENEGADO: El destino pertenece a otro depositante.', HttpStatus.FORBIDDEN);
    }

    const updateData: any = {};
    if (data.codigo !== undefined) {
      const cleanCodigo = String(data.codigo).trim().toUpperCase();
      if (!cleanCodigo) throw new HttpException('El código no puede quedar vacío', HttpStatus.BAD_REQUEST);
      updateData.codigo = cleanCodigo;
    }
    if (data.nombre !== undefined) {
      const cleanNombre = String(data.nombre).trim();
      if (!cleanNombre) throw new HttpException('El nombre no puede quedar vacío', HttpStatus.BAD_REQUEST);
      updateData.nombre = cleanNombre;
    }
    if (data.razonSocial !== undefined) updateData.razonSocial = cleanOptionalText(data.razonSocial);
    if (data.rfc !== undefined) updateData.rfc = cleanOptionalText(data.rfc)?.toUpperCase() ?? null;
    if (data.contacto !== undefined) updateData.contacto = cleanOptionalText(data.contacto);
    if (data.telefono !== undefined) updateData.telefono = cleanOptionalText(data.telefono);
    if (data.email !== undefined) updateData.email = cleanOptionalText(data.email);
    if (data.calle !== undefined) updateData.calle = cleanOptionalText(data.calle);
    if (data.colonia !== undefined) updateData.colonia = cleanOptionalText(data.colonia);
    if (data.ciudad !== undefined) updateData.ciudad = cleanOptionalText(data.ciudad);
    if (data.estado !== undefined) updateData.estado = cleanOptionalText(data.estado);
    if (data.codigoPostal !== undefined) updateData.codigoPostal = cleanOptionalText(data.codigoPostal);
    if (data.referencia !== undefined) updateData.referencia = cleanOptionalText(data.referencia);
    if (data.instruccionesEntrega !== undefined) updateData.instruccionesEntrega = cleanOptionalText(data.instruccionesEntrega);
    if (data.requiereFactura !== undefined) updateData.requiereFactura = Boolean(data.requiereFactura);
    if (data.activo !== undefined) updateData.activo = Boolean(data.activo);

    try {
      const updated = await this.prisma.endCustomer.update({
        where: { id },
        data: updateData,
        include: {
          cliente: { select: { nombreComercial: true, codigo: true } },
          _count: { select: { ordenes: true } },
        },
      });

      await this.prisma.auditLog.create({
        data: {
          usuario: req?.user?.email || req?.user?.nombre || 'sistema',
          accion: 'ACTUALIZAR_CLIENTE_FINAL',
          entidad: 'EndCustomer',
          entidadId: updated.id,
          detalle: `Actualización de destino Ship-To ${updated.codigo} (${updated.nombre})`,
        },
      });

      return updated;
    } catch (error: any) {
      if (error?.code === 'P2002') {
        throw new HttpException(
          {
            statusCode: HttpStatus.CONFLICT,
            message: `Ya existe otro destino con el código [${updateData.codigo}] para este depositante.`,
            error: 'Conflict',
            codigo: 'CODIGO_DUPLICADO',
          },
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }
  }

  @Delete(':id')
  @RequireAccess({
    modules: ['clientes-finales'],
    actions: ['editar', 'cancelar'],
    allowPortal: true,
  })
  @ApiOperation({ summary: 'Desactivar cliente final (baja lógica)' })
  async deactivateEndCustomer(@Param('id') id: string, @Req() req?: any) {
    const existing = await this.prisma.endCustomer.findUnique({ where: { id } });
    if (!existing) throw new HttpException('Cliente final no encontrado', HttpStatus.NOT_FOUND);
    if (req?.user?.clienteId && existing.clienteId !== req.user.clienteId) {
      throw new HttpException('ACCESO_DENEGADO: El destino pertenece a otro depositante.', HttpStatus.FORBIDDEN);
    }

    const updated = await this.prisma.endCustomer.update({
      where: { id },
      data: { activo: false },
      include: {
        cliente: { select: { nombreComercial: true, codigo: true } },
        _count: { select: { ordenes: true } },
      },
    });

    await this.prisma.auditLog.create({
      data: {
        usuario: req?.user?.email || req?.user?.nombre || 'sistema',
        accion: 'DESACTIVAR_CLIENTE_FINAL',
        entidad: 'EndCustomer',
        entidadId: updated.id,
        detalle: `Baja lógica de destino Ship-To ${updated.codigo} (${updated.nombre})`,
      },
    });

    return updated;
  }

  @Put(':id/reactivate')
  @RequireAccess({
    modules: ['clientes-finales'],
    actions: ['editar'],
    allowPortal: true,
  })
  @ApiOperation({ summary: 'Reactivar cliente final' })
  async reactivateEndCustomer(@Param('id') id: string, @Req() req?: any) {
    const existing = await this.prisma.endCustomer.findUnique({ where: { id } });
    if (!existing) throw new HttpException('Cliente final no encontrado', HttpStatus.NOT_FOUND);
    if (req?.user?.clienteId && existing.clienteId !== req.user.clienteId) {
      throw new HttpException('ACCESO_DENEGADO: El destino pertenece a otro depositante.', HttpStatus.FORBIDDEN);
    }

    const updated = await this.prisma.endCustomer.update({
      where: { id },
      data: { activo: true },
      include: {
        cliente: { select: { nombreComercial: true, codigo: true } },
        _count: { select: { ordenes: true } },
      },
    });

    await this.prisma.auditLog.create({
      data: {
        usuario: req?.user?.email || req?.user?.nombre || 'sistema',
        accion: 'REACTIVAR_CLIENTE_FINAL',
        entidad: 'EndCustomer',
        entidadId: updated.id,
        detalle: `Reactivación de destino Ship-To ${updated.codigo} (${updated.nombre})`,
      },
    });

    return updated;
  }
}
