import { Controller, Get, Post, Put, Patch, Delete, Param, Query, Body, Headers, Req, HttpException, HttpStatus, BadRequestException, ConflictException, NotFoundException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { PrismaService } from '../../prisma.service';
import { EmailService } from '../../email.service';
import * as jwt from 'jsonwebtoken';
import { RequireAccess } from '../auth/auth.decorators';
import { CreateSupplierDto, UpdateSupplierDto } from './dto/supplier.dto';
import { classifyLocationOperationalRole } from '../../common/location-classifier.util';
import {
  evaluateInventoryItemOperationalState,
  isExpired,
  toCalendarDayString,
} from '../../common/inventory-operational-state.util';

const JWT_SECRET = process.env.JWT_SECRET || 'giving-out-wms-secret-2026';

function cleanOptionalSupplierText(value: any): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

@ApiTags('Master Data')
@Controller('api')
export class MasterDataController {
  constructor(private prisma: PrismaService, private emailService: EmailService) {}

  // ============ SKUs ============
  @Get('skus')
  @RequireAccess({
    modules: ['maestros', 'inventario', 'recepcion', 'picking', 'despacho', 'trazabilidad', 'conteo-ciclico'],
    actions: ['ver'],
    allowPortal: true,
  })
  @ApiOperation({ summary: 'Listar catálogo de SKUs' })
  async getSkus(
    @Query('clienteId') clienteId?: string,
    @Query('categoria') categoria?: string,
    @Query('buscar') buscar?: string,
    @Headers('authorization') authHeader?: string,
    @Req() req?: any,
  ) {
    const where: any = {};
    let activeClienteId = req?.user?.clienteId || clienteId;

    if (!req?.user && authHeader && authHeader.startsWith('Bearer ')) {
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
      include: {
        cliente: { select: { nombreComercial: true, giro: true } },
        _count: {
          select: {
            lineasRecepcion: true,
            lotes: true,
            movimientos: true,
            lineasSalida: true,
            cycleCountLineas: true,
            trazabilidad: true,
            conversiones: true,
          },
        },
      },
      orderBy: { descripcion: 'asc' },
    });
  }

  @Post('skus')
  @RequireAccess({ modules: ['maestros'], actions: ['crear'], allowPortal: false })
  @ApiOperation({ summary: 'Crear SKU' })
  async createSku(@Body() body: any) {
    try {
      const {
        clienteId,
        codigo,
        descripcion,
        categoria,
        subcategoria,
        marca,
        modelo,
        color,
        talla,
        uomBase,
        pesoKg,
        volumenM3,
        codigoBarras,
        requiereLote,
        requiereSerie,
        requiereCaducidad,
        capacidadEmpaque,
        descripcionEmpaque,
        temperaturaRequerida,
        activo,
      } = body || {};

      if (!clienteId || !String(clienteId).trim()) {
        throw new HttpException('El depositante / cliente propietario es obligatorio.', HttpStatus.BAD_REQUEST);
      }
      if (!codigo || !String(codigo).trim()) {
        throw new HttpException('El código SKU es obligatorio.', HttpStatus.BAD_REQUEST);
      }
      if (!descripcion || !String(descripcion).trim()) {
        throw new HttpException('La descripción del producto es obligatoria.', HttpStatus.BAD_REQUEST);
      }
      if (!categoria || !String(categoria).trim()) {
        throw new HttpException('La categoría del producto es obligatoria.', HttpStatus.BAD_REQUEST);
      }

      const cleanCodigo = String(codigo).trim().toUpperCase();

      // Verificar existencia del cliente depositante
      const cliente = await this.prisma.client.findUnique({ where: { id: clienteId } });
      if (!cliente) {
        throw new HttpException('El cliente depositante seleccionado no existe en el sistema.', HttpStatus.NOT_FOUND);
      }

      // Validar código SKU único
      const existingSku = await this.prisma.skuMaster.findFirst({
        where: {
          OR: [
            { codigo: { equals: cleanCodigo, mode: 'insensitive' } },
            { clienteId, codigo: { equals: cleanCodigo, mode: 'insensitive' } },
          ],
        },
      });
      if (existingSku) {
        throw new HttpException(
          `El código SKU "${cleanCodigo}" ya está registrado en el catálogo. Utilice un código único.`,
          HttpStatus.BAD_REQUEST,
        );
      }

      let parsedCap: number | null = null;
      if (capacidadEmpaque !== undefined && capacidadEmpaque !== null && String(capacidadEmpaque).trim() !== '') {
        parsedCap = parseInt(String(capacidadEmpaque), 10);
        if (isNaN(parsedCap) || parsedCap <= 0) {
          throw new HttpException('La capacidad de empaque (piezas por caja) debe ser un número entero positivo mayor a 0.', HttpStatus.BAD_REQUEST);
        }
      }

      let parsedPeso: number | null = null;
      if (pesoKg !== undefined && pesoKg !== null && String(pesoKg).trim() !== '') {
        parsedPeso = parseFloat(String(pesoKg));
        if (isNaN(parsedPeso) || parsedPeso < 0) {
          throw new HttpException('El peso en Kg debe ser un valor numérico positivo o cero.', HttpStatus.BAD_REQUEST);
        }
      }

      let parsedVol: number | null = null;
      if (volumenM3 !== undefined && volumenM3 !== null && String(volumenM3).trim() !== '') {
        parsedVol = parseFloat(String(volumenM3));
        if (isNaN(parsedVol) || parsedVol < 0) {
          throw new HttpException('El volumen en m³ debe ser un valor numérico positivo o cero.', HttpStatus.BAD_REQUEST);
        }
      }

      return await this.prisma.skuMaster.create({
        data: {
          clienteId,
          codigo: cleanCodigo,
          descripcion: String(descripcion).trim(),
          categoria: String(categoria).trim().toUpperCase(),
          subcategoria: subcategoria ? String(subcategoria).trim() : null,
          marca: marca ? String(marca).trim() : null,
          modelo: modelo ? String(modelo).trim() : null,
          color: color ? String(color).trim() : null,
          talla: talla ? String(talla).trim() : null,
          uomBase: uomBase ? String(uomBase).trim().toUpperCase() : 'PZA',
          pesoKg: parsedPeso,
          volumenM3: parsedVol,
          codigoBarras: codigoBarras ? String(codigoBarras).trim() : null,
          requiereLote: Boolean(requiereLote),
          requiereSerie: Boolean(requiereSerie),
          requiereCaducidad: Boolean(requiereCaducidad),
          capacidadEmpaque: parsedCap,
          descripcionEmpaque: descripcionEmpaque && String(descripcionEmpaque).trim()
            ? String(descripcionEmpaque).trim()
            : parsedCap ? `Caja x${parsedCap}` : null,
          temperaturaRequerida: temperaturaRequerida ? String(temperaturaRequerida).trim().toUpperCase() : 'AMBIENTE',
          activo: activo !== undefined ? Boolean(activo) : true,
        },
        include: { cliente: { select: { nombreComercial: true, giro: true } } },
      });
    } catch (err: any) {
      if (err instanceof HttpException) throw err;
      if (err.code === 'P2002') {
        throw new HttpException('El código SKU ya existe en la base de datos.', HttpStatus.BAD_REQUEST);
      }
      throw new HttpException(err.message || 'Error al crear SKU', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Put('skus/:id')
  @RequireAccess({ modules: ['maestros'], actions: ['editar'], allowPortal: false })
  @ApiOperation({ summary: 'Actualizar SKU' })
  async updateSku(@Param('id') id: string, @Body() body: any) {
    try {
      const existingSku = await this.prisma.skuMaster.findUnique({ where: { id } });
      if (!existingSku) {
        throw new HttpException('El producto / SKU especificado no existe.', HttpStatus.NOT_FOUND);
      }

      const {
        clienteId,
        codigo,
        descripcion,
        categoria,
        subcategoria,
        marca,
        modelo,
        color,
        talla,
        uomBase,
        pesoKg,
        volumenM3,
        codigoBarras,
        requiereLote,
        requiereSerie,
        requiereCaducidad,
        capacidadEmpaque,
        descripcionEmpaque,
        temperaturaRequerida,
        activo,
      } = body || {};

      let cleanCodigo = existingSku.codigo;
      if (codigo && String(codigo).trim()) {
        cleanCodigo = String(codigo).trim().toUpperCase();
        if (cleanCodigo !== existingSku.codigo) {
          const duplicate = await this.prisma.skuMaster.findFirst({
            where: {
              id: { not: id },
              OR: [
                { codigo: { equals: cleanCodigo, mode: 'insensitive' } },
                { clienteId: clienteId || existingSku.clienteId, codigo: { equals: cleanCodigo, mode: 'insensitive' } },
              ],
            },
          });
          if (duplicate) {
            throw new HttpException(`El código SKU "${cleanCodigo}" ya está en uso por otro producto.`, HttpStatus.BAD_REQUEST);
          }
        }
      }

      let parsedCap = existingSku.capacidadEmpaque;
      if (capacidadEmpaque !== undefined) {
        if (capacidadEmpaque === null || String(capacidadEmpaque).trim() === '') {
          parsedCap = null;
        } else {
          parsedCap = parseInt(String(capacidadEmpaque), 10);
          if (isNaN(parsedCap) || parsedCap <= 0) {
            throw new HttpException('La capacidad de empaque (piezas por caja) debe ser un número entero positivo mayor a 0.', HttpStatus.BAD_REQUEST);
          }
        }
      }

      let parsedPeso = existingSku.pesoKg;
      if (pesoKg !== undefined) {
        if (pesoKg === null || String(pesoKg).trim() === '') {
          parsedPeso = null;
        } else {
          parsedPeso = parseFloat(String(pesoKg));
          if (isNaN(parsedPeso) || parsedPeso < 0) {
            throw new HttpException('El peso en Kg debe ser un valor numérico positivo o cero.', HttpStatus.BAD_REQUEST);
          }
        }
      }

      let parsedVol = existingSku.volumenM3;
      if (volumenM3 !== undefined) {
        if (volumenM3 === null || String(volumenM3).trim() === '') {
          parsedVol = null;
        } else {
          parsedVol = parseFloat(String(volumenM3));
          if (isNaN(parsedVol) || parsedVol < 0) {
            throw new HttpException('El volumen en m³ debe ser un valor numérico positivo o cero.', HttpStatus.BAD_REQUEST);
          }
        }
      }

      return await this.prisma.skuMaster.update({
        where: { id },
        data: {
          ...(clienteId ? { clienteId } : {}),
          codigo: cleanCodigo,
          ...(descripcion ? { descripcion: String(descripcion).trim() } : {}),
          ...(categoria ? { categoria: String(categoria).trim().toUpperCase() } : {}),
          ...(subcategoria !== undefined ? { subcategoria: subcategoria ? String(subcategoria).trim() : null } : {}),
          ...(marca !== undefined ? { marca: marca ? String(marca).trim() : null } : {}),
          ...(modelo !== undefined ? { modelo: modelo ? String(modelo).trim() : null } : {}),
          ...(color !== undefined ? { color: color ? String(color).trim() : null } : {}),
          ...(talla !== undefined ? { talla: talla ? String(talla).trim() : null } : {}),
          ...(uomBase ? { uomBase: String(uomBase).trim().toUpperCase() } : {}),
          pesoKg: parsedPeso,
          volumenM3: parsedVol,
          ...(codigoBarras !== undefined ? { codigoBarras: codigoBarras ? String(codigoBarras).trim() : null } : {}),
          ...(requiereLote !== undefined ? { requiereLote: Boolean(requiereLote) } : {}),
          ...(requiereSerie !== undefined ? { requiereSerie: Boolean(requiereSerie) } : {}),
          ...(requiereCaducidad !== undefined ? { requiereCaducidad: Boolean(requiereCaducidad) } : {}),
          capacidadEmpaque: parsedCap,
          ...(descripcionEmpaque !== undefined
            ? { descripcionEmpaque: descripcionEmpaque && String(descripcionEmpaque).trim() ? String(descripcionEmpaque).trim() : (parsedCap ? `Caja x${parsedCap}` : null) }
            : {}),
          ...(temperaturaRequerida ? { temperaturaRequerida: String(temperaturaRequerida).trim().toUpperCase() } : {}),
          ...(activo !== undefined ? { activo: Boolean(activo) } : {}),
        },
        include: { cliente: { select: { nombreComercial: true, giro: true } } },
      });
    } catch (err: any) {
      if (err instanceof HttpException) throw err;
      if (err.code === 'P2002') {
        throw new HttpException('El código SKU ya existe en la base de datos.', HttpStatus.BAD_REQUEST);
      }
      throw new HttpException(err.message || 'Error al actualizar SKU', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Patch('skus/:id/toggle-activo')
  @RequireAccess({ modules: ['maestros'], actions: ['editar'], allowPortal: false })
  @ApiOperation({ summary: 'Alternar o definir estado activo/inactivo de un SKU' })
  async toggleSkuActivo(@Param('id') id: string, @Body() body?: { activo?: boolean }) {
    const existingSku = await this.prisma.skuMaster.findUnique({ where: { id } });
    if (!existingSku) {
      throw new HttpException('El producto / SKU especificado no existe.', HttpStatus.NOT_FOUND);
    }

    const newActivo = body && typeof body.activo === 'boolean' ? body.activo : !existingSku.activo;

    const updated = await this.prisma.skuMaster.update({
      where: { id },
      data: { activo: newActivo },
      include: {
        cliente: { select: { nombreComercial: true, giro: true } },
        _count: {
          select: {
            lineasRecepcion: true,
            lotes: true,
            movimientos: true,
            lineasSalida: true,
            cycleCountLineas: true,
            trazabilidad: true,
            conversiones: true,
          },
        },
      },
    });

    return {
      success: true,
      sku: updated,
      message: newActivo
        ? `El producto "${updated.codigo}" ha sido reactivado exitosamente.`
        : `El producto "${updated.codigo}" ha sido desactivado exitosamente.`,
    };
  }

  @Delete('skus/:id')
  @RequireAccess({ modules: ['maestros'], actions: ['editar', 'cancelar'], allowPortal: false })
  @ApiOperation({ summary: 'Eliminar físicamente un SKU sin historial operativo' })
  async deleteSku(@Param('id') id: string) {
    const sku = await this.prisma.skuMaster.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            lineasRecepcion: true,
            lotes: true,
            movimientos: true,
            lineasSalida: true,
            cycleCountLineas: true,
            trazabilidad: true,
            conversiones: true,
          },
        },
      },
    });

    if (!sku) {
      throw new HttpException('El producto / SKU especificado no existe.', HttpStatus.NOT_FOUND);
    }

    // Auditar HandlingUnit por skuCodigo y por lote
    const huCount = await this.prisma.handlingUnit.count({
      where: {
        OR: [
          { skuCodigo: sku.codigo },
          { lote: { skuId: id } },
        ],
      },
    });

    const totalOperationalHistory =
      (sku._count?.lineasRecepcion || 0) +
      (sku._count?.lotes || 0) +
      (sku._count?.movimientos || 0) +
      (sku._count?.lineasSalida || 0) +
      (sku._count?.cycleCountLineas || 0) +
      (sku._count?.trazabilidad || 0) +
      (sku._count?.conversiones || 0) +
      huCount;

    if (totalOperationalHistory > 0) {
      throw new HttpException(
        'El SKU cuenta con historial operativo y no puede eliminarse físicamente. Puede desactivarlo para impedir nuevos movimientos sin perder trazabilidad.',
        HttpStatus.BAD_REQUEST,
      );
    }

    await this.prisma.skuMaster.delete({
      where: { id },
    });

    return {
      success: true,
      message: `El producto "${sku.codigo}" ha sido eliminado exitosamente del catálogo.`,
    };
  }

  // ============ SUPPLIERS ============
  @Get('suppliers')
  @RequireAccess({
    modules: ['proveedores', 'maestros', 'recepcion'],
    actions: ['ver'],
    allowPortal: false,
  })
  @ApiOperation({ summary: 'Listar proveedores' })
  async getSuppliers(
    @Query('activo') activo?: string,
    @Query('buscar') buscar?: string,
  ) {
    const where: any = {};
    if (activo === 'all') {
      // Sin filtro de estado: mostrar activos e inactivos
    } else if (activo === 'false') {
      where.activo = false;
    } else {
      where.activo = true;
    }

    if (buscar && buscar.trim()) {
      const q = buscar.trim();
      where.OR = [
        { codigo: { contains: q, mode: 'insensitive' } },
        { nombre: { contains: q, mode: 'insensitive' } },
        { rfc: { contains: q, mode: 'insensitive' } },
        { contacto: { contains: q, mode: 'insensitive' } },
      ];
    }

    return this.prisma.supplier.findMany({
      where,
      include: { _count: { select: { recepciones: true } } },
      orderBy: { nombre: 'asc' },
    });
  }

  @Post('suppliers')
  @RequireAccess({ modules: ['proveedores', 'maestros'], actions: ['crear'], allowPortal: false })
  @ApiOperation({ summary: 'Crear proveedor' })
  async createSupplier(@Body() data: CreateSupplierDto, @Req() req?: any) {
    const cleanCodigo = String(data?.codigo || '').trim().toUpperCase();
    const cleanNombre = String(data?.nombre || '').trim();
    if (!cleanCodigo || !cleanNombre) {
      throw new BadRequestException('codigo y nombre son obligatorios para crear el proveedor.');
    }

    try {
      const created = await this.prisma.supplier.create({
        data: {
          codigo: cleanCodigo,
          nombre: cleanNombre,
          rfc: cleanOptionalSupplierText(data?.rfc) ?? null,
          telefono: cleanOptionalSupplierText(data?.telefono) ?? null,
          email: cleanOptionalSupplierText(data?.email) ?? null,
          direccion: cleanOptionalSupplierText(data?.direccion) ?? null,
          contacto: cleanOptionalSupplierText(data?.contacto) ?? null,
        },
        include: { _count: { select: { recepciones: true } } },
      });

      await this.prisma.auditLog.create({
        data: {
          usuario: req?.user?.email || req?.user?.nombre || 'sistema',
          accion: 'CREAR_PROVEEDOR',
          entidad: 'Supplier',
          entidadId: created.id,
          detalle: `Alta de proveedor ${created.codigo} (${created.nombre})`,
        },
      });

      return created;
    } catch (error: any) {
      if (error?.code === 'P2002') {
        throw new ConflictException({
          statusCode: HttpStatus.CONFLICT,
          message: `Ya existe un proveedor con el código [${cleanCodigo}].`,
          error: 'Conflict',
          codigo: 'CODIGO_DUPLICADO',
        });
      }
      throw error;
    }
  }

  @Put('suppliers/:id')
  @RequireAccess({ modules: ['proveedores', 'maestros'], actions: ['editar'], allowPortal: false })
  @ApiOperation({ summary: 'Actualizar proveedor' })
  async updateSupplier(@Param('id') id: string, @Body() data: UpdateSupplierDto, @Req() req?: any) {
    const existing = await this.prisma.supplier.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Proveedor no encontrado.');
    }

    const updateData: any = {};
    if (data.codigo !== undefined) {
      const cleanCodigo = String(data.codigo).trim().toUpperCase();
      if (!cleanCodigo) throw new BadRequestException('El código del proveedor no puede quedar vacío.');
      updateData.codigo = cleanCodigo;
    }
    if (data.nombre !== undefined) {
      const cleanNombre = String(data.nombre).trim();
      if (!cleanNombre) throw new BadRequestException('El nombre del proveedor no puede quedar vacío.');
      updateData.nombre = cleanNombre;
    }
    if (data.rfc !== undefined) updateData.rfc = cleanOptionalSupplierText(data.rfc);
    if (data.telefono !== undefined) updateData.telefono = cleanOptionalSupplierText(data.telefono);
    if (data.email !== undefined) updateData.email = cleanOptionalSupplierText(data.email);
    if (data.direccion !== undefined) updateData.direccion = cleanOptionalSupplierText(data.direccion);
    if (data.contacto !== undefined) updateData.contacto = cleanOptionalSupplierText(data.contacto);
    if (typeof data.activo === 'boolean') updateData.activo = data.activo;

    try {
      const updated = await this.prisma.supplier.update({
        where: { id },
        data: updateData,
        include: { _count: { select: { recepciones: true } } },
      });

      await this.prisma.auditLog.create({
        data: {
          usuario: req?.user?.email || req?.user?.nombre || 'sistema',
          accion: 'ACTUALIZAR_PROVEEDOR',
          entidad: 'Supplier',
          entidadId: updated.id,
          detalle: `Actualización de proveedor ${updated.codigo} (${updated.nombre})`,
        },
      });

      return updated;
    } catch (error: any) {
      if (error?.code === 'P2002') {
        throw new ConflictException({
          statusCode: HttpStatus.CONFLICT,
          message: `Ya existe un proveedor con el código [${updateData.codigo || existing.codigo}].`,
          error: 'Conflict',
          codigo: 'CODIGO_DUPLICADO',
        });
      }
      throw error;
    }
  }

  @Delete('suppliers/:id')
  @RequireAccess({ modules: ['proveedores', 'maestros'], actions: ['editar', 'cancelar'], allowPortal: false })
  @ApiOperation({ summary: 'Desactivar proveedor (baja lógica)' })
  async deactivateSupplier(@Param('id') id: string, @Req() req?: any) {
    const existing = await this.prisma.supplier.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Proveedor no encontrado.');
    }

    const updated = await this.prisma.supplier.update({
      where: { id },
      data: { activo: false },
      include: { _count: { select: { recepciones: true } } },
    });

    await this.prisma.auditLog.create({
      data: {
        usuario: req?.user?.email || req?.user?.nombre || 'sistema',
        accion: 'DESACTIVAR_PROVEEDOR',
        entidad: 'Supplier',
        entidadId: updated.id,
        detalle: `Baja lógica de proveedor ${updated.codigo} (${updated.nombre})`,
      },
    });

    return {
      success: true,
      supplier: updated,
      message: `Proveedor "${updated.nombre}" desactivado correctamente.`,
    };
  }

  @Put('suppliers/:id/reactivate')
  @RequireAccess({ modules: ['proveedores', 'maestros'], actions: ['editar'], allowPortal: false })
  @ApiOperation({ summary: 'Reactivar proveedor inactivo' })
  async reactivateSupplier(@Param('id') id: string, @Req() req?: any) {
    const existing = await this.prisma.supplier.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('Proveedor no encontrado.');
    }

    const updated = await this.prisma.supplier.update({
      where: { id },
      data: { activo: true },
      include: { _count: { select: { recepciones: true } } },
    });

    await this.prisma.auditLog.create({
      data: {
        usuario: req?.user?.email || req?.user?.nombre || 'sistema',
        accion: 'REACTIVAR_PROVEEDOR',
        entidad: 'Supplier',
        entidadId: updated.id,
        detalle: `Reactivación de proveedor ${updated.codigo} (${updated.nombre})`,
      },
    });

    return {
      success: true,
      supplier: updated,
      message: `Proveedor "${updated.nombre}" reactivado correctamente.`,
    };
  }

  // ============ WAREHOUSES ============
  @Get('warehouses')
  @RequireAccess({
    modules: ['ubicaciones', 'maestros', 'inventario', 'recepcion', 'picking', 'despacho', 'dashboard', 'conteo-ciclico', 'etiquetado'],
    actions: ['ver'],
    allowPortal: true,
  })
  @ApiOperation({ summary: 'Listar almacenes' })
  async getWarehouses() {
    return this.prisma.warehouse.findMany({
      include: { _count: { select: { locations: true, zones: true } } },
      orderBy: { nombre: 'asc' },
    });
  }

  @Post('warehouses')
  @RequireAccess({ modules: ['ubicaciones', 'maestros'], actions: ['crear'], allowPortal: false })
  @ApiOperation({ summary: 'Crear almacén' })
  async createWarehouse(@Body() data: any) {
    return this.prisma.warehouse.create({ data });
  }

  // ============ ZONES ============
  @Get('zones')
  @RequireAccess({
    modules: ['ubicaciones', 'maestros', 'inventario', 'recepcion', 'picking', 'despacho', 'dashboard', 'conteo-ciclico', 'etiquetado'],
    actions: ['ver'],
    allowPortal: false,
  })
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
  @RequireAccess({ modules: ['ubicaciones', 'maestros'], actions: ['crear'], allowPortal: false })
  @ApiOperation({ summary: 'Crear zona' })
  async createZone(@Body() data: any) {
    return this.prisma.zone.create({ data });
  }

  // ============ LOCATIONS ============
  @Get('locations')
  @RequireAccess({
    modules: ['ubicaciones', 'maestros', 'inventario', 'recepcion', 'picking', 'despacho', 'dashboard', 'conteo-ciclico', 'etiquetado'],
    actions: ['ver'],
    allowPortal: false,
  })
  @ApiOperation({ summary: 'Listar ubicaciones con modelo de capacidad enriquecida, clasificación y estado' })
  async getLocations(@Query('almacenId') almacenId?: string, @Query('zonaId') zonaId?: string, @Query('estado') estado?: string) {
    const where: any = {};
    if (almacenId) where.almacenId = almacenId;
    if (zonaId) where.zonaId = zonaId;
    if (estado) where.estado = estado;

    const [locations, allActiveHus] = await Promise.all([
      this.prisma.location.findMany({
        where,
        include: {
          zona: { select: { id: true, codigo: true, nombre: true, tipoZona: true } },
          almacen: { select: { id: true, codigo: true, nombre: true } },
          lotes: {
            where: {
              OR: [
                { cantidadDisponible: { gt: 0 } },
                { cantidadBloqueada: { gt: 0 } }
              ]
            },
            include: {
              sku: { select: { id: true, codigo: true, descripcion: true, uomBase: true } },
              cliente: { select: { id: true, nombreComercial: true, razonSocial: true } },
            },
          },
        },
        orderBy: { codigo: 'asc' },
      }),
      this.prisma.handlingUnit.findMany({
        where: {
          estadoHu: { notIn: ['INACTIVO', 'DESPACHADO'] }
        },
        select: {
          id: true,
          codigo: true,
          tipoHu: true,
          parentHuId: true,
          ubicacionActual: true,
          cantidad: true,
          clienteId: true,
          lotId: true,
          lote: {
            select: {
              id: true,
              ubicacionId: true,
              cantidadDisponible: true,
              cantidadBloqueada: true,
            }
          }
        }
      })
    ]);

    // Index HUs por ubicacionActual agrupando cajas hijas bajo su tarima física master
    const huCountByLoc: Record<string, number> = {};
    const husByLocAndClient: Record<string, Record<string, number>> = {};
    const distinctPalletsByLoc: Record<string, Set<string>> = {};

    for (const hu of allActiveHus) {
      // Si la HU tiene lote asociado, verificar que el lote tenga saldo físico real (> 0)
      if (hu.lote) {
        const lotFisico = (hu.lote.cantidadDisponible || 0) + (hu.lote.cantidadBloqueada || 0);
        if (lotFisico <= 0) continue; // Descartar HUs vacías/históricas con saldo cero
      } else if ((hu.cantidad || 0) <= 0) {
        continue;
      }

      if (hu.ubicacionActual) {
        if (!distinctPalletsByLoc[hu.ubicacionActual]) distinctPalletsByLoc[hu.ubicacionActual] = new Set<string>();
        distinctPalletsByLoc[hu.ubicacionActual].add((hu as any).parentHuId || hu.id);

        if (!husByLocAndClient[hu.ubicacionActual]) husByLocAndClient[hu.ubicacionActual] = {};
        const cid = hu.clienteId || 'DESCONOCIDO';
        husByLocAndClient[hu.ubicacionActual][cid] = (husByLocAndClient[hu.ubicacionActual][cid] || 0) + 1;
      }
    }

    for (const locKey of Object.keys(distinctPalletsByLoc)) {
      huCountByLoc[locKey] = distinctPalletsByLoc[locKey].size;
    }

    return locations.map(loc => {
      // 1. Clasificación funcional de la ubicación
      const classification = this.classifyLocation(loc);

      const capUnits = (loc as any).capacidadUnits || 100;
      
      // Fuente de verdad de ocupación en esta fase (según instrucción 4):
      // ocupacionUnidades se deriva estrictamente de LotInventory (suma de disponible + bloqueada)
      const sumDisp = loc.lotes.reduce((sum, l) => sum + (l.cantidadDisponible || 0), 0);
      const sumBloq = loc.lotes.reduce((sum, l) => sum + (l.cantidadBloqueada || 0), 0);
      const sumRes = loc.lotes.reduce((sum, l) => sum + Math.max(0, l.cantidadReservada || 0), 0);
      const ocupUnidades = sumDisp + sumBloq;
      
      const isFloorPallet =
        loc.tipoUbicacion === 'TARIMA_PISO' ||
        (loc.tipoUbicacion === 'PISO' && classification.esAlmacenable) ||
        (loc.codigo && loc.codigo.toUpperCase().startsWith('G'));

      // Capacidad de bultos:
      // Para posiciones de tarima en piso (incluyendo nomenclatura G0001+), la capacidad física canónica
      // es exactamente de 1 tarima física (confirmado operativamente por Alejandra).
      // Para celdas tradicionales proviene de configuración en BD.
      const hasConfiguredCapBultos =
        isFloorPallet ||
        (typeof (loc as any).capacidadBultos === 'number' && (loc as any).capacidadBultos > 0);
      const capBultos: number | null = isFloorPallet
        ? 1
        : hasConfiguredCapBultos
        ? (loc as any).capacidadBultos
        : null;
      const capacidadBultosEstado = hasConfiguredCapBultos ? 'CONFIGURADA' : 'NO_CONFIGURADA';

      // Fuente de verdad de bultos en esta fase: se deriva estrictamente de HandlingUnits activas
      const bultosReales = huCountByLoc[loc.codigo] || huCountByLoc[loc.id] || 0;
      const ocupBultos = isFloorPallet
        ? (bultosReales > 0 ? bultosReales : (ocupUnidades > 0 ? 1 : 0))
        : bultosReales;

      // Reservas comprometidas
      const resUnidades = (loc as any).reservaUnidades ?? 0;
      const resBultos = (loc as any).reservaBultos ?? 0;

      // Capacidades disponibles derivadas:
      // En posiciones de tarima en piso, una posición vacía admite una tarima completa entrante (capUnits disponible).
      // Si la posición ya tiene una tarima alojada, no admite más bultos ni piezas adicionales.
      const capDispUnidades = isFloorPallet
        ? (ocupBultos >= 1 ? 0 : capUnits)
        : Math.max(0, capUnits - ocupUnidades - resUnidades);
      const capDispBultos = hasConfiguredCapBultos && capBultos !== null
        ? Math.max(0, capBultos - ocupBultos - resBultos)
        : null;

      // Porcentajes de ocupación (0 - 100%+)
      const pctUnidades = capUnits > 0 ? Math.round((ocupUnidades / capUnits) * 100) : 0;
      const pctBultos = hasConfiguredCapBultos && capBultos !== null && capBultos > 0
        ? Math.round((ocupBultos / capBultos) * 100)
        : null;

      // Estado de capacidad canónico (Instrucciones 2 y 3)
      let estadoCapacidad = 'LIBRE';
      if (!classification.esAlmacenable) {
        // Recibo, andén, DEV-01, NC-EXCESO-01, cuarentena, staging -> NO_APLICA
        estadoCapacidad = 'NO_APLICA';
      } else if (loc.estado === 'BLOQUEADO') {
        estadoCapacidad = 'BLOQUEADO';
      } else if (isFloorPallet) {
        if (ocupBultos > 1) {
          estadoCapacidad = 'SOBRECAPACIDAD';
        } else if (ocupBultos >= 1 || ocupUnidades > 0) {
          estadoCapacidad = 'LLENO';
        } else {
          estadoCapacidad = 'LIBRE';
        }
      } else if (ocupUnidades > capUnits || (hasConfiguredCapBultos && capBultos !== null && ocupBultos > capBultos)) {
        // Detección estricta de sobrecapacidad física sin alterar inventario histórico
        estadoCapacidad = 'SOBRECAPACIDAD';
      } else if (ocupUnidades >= capUnits || (hasConfiguredCapBultos && capBultos !== null && ocupBultos >= capBultos)) {
        estadoCapacidad = 'LLENO';
      } else if (ocupUnidades > 0 || ocupBultos > 0) {
        estadoCapacidad = 'PARCIAL';
      } else {
        estadoCapacidad = 'LIBRE';
      }

      return {
        ...loc,
        // Clasificación de ubicación
        categoriaUbicacion: classification.categoriaUbicacion,
        esAlmacenable: classification.esAlmacenable,
        categoriaDescripcion: classification.categoriaDescripcion,
        // Modelo canónico de capacidad de Location (Etapa 2)
        capacidadUnits: capUnits,
        ocupacionUnidades: ocupUnidades,
        capacidadBultos: capBultos,
        capacidadBultosEstado,
        ocupacionBultos: ocupBultos,
        reservaUnidades: resUnidades,
        reservaBultos: resBultos,
        capacidadDisponibleUnidades: capDispUnidades,
        capacidadDisponibleBultos: capDispBultos,
        porcentajeOcupacionUnidades: pctUnidades,
        porcentajeOcupacionBultos: pctBultos,
        estadoCapacidad,
        // Desglose de piezas para auditoría
        stockFisicoPiezas: sumDisp + sumBloq,
        stockDisponiblePiezas: Math.max(0, sumDisp - sumRes),
        stockReservadoPiezas: sumRes,
        stockBloqueadoPiezas: sumBloq,
        bultosPorCliente: husByLocAndClient[loc.codigo] || husByLocAndClient[loc.id] || {},
      };
    });
  }

  @Get('locations/:id')
  @RequireAccess({
    modules: ['ubicaciones', 'maestros', 'inventario', 'recepcion', 'picking', 'despacho', 'dashboard', 'conteo-ciclico', 'etiquetado'],
    actions: ['ver'],
    allowPortal: false,
  })
  @ApiOperation({ summary: 'Consultar contenido y stock detallado de una ubicación con desglose de capacidad' })
  async getLocationById(@Param('id') id: string) {
    const loc = await this.prisma.location.findFirst({
      where: { OR: [{ id }, { codigo: id }] },
      include: {
        zona: true,
        almacen: true,
        lotes: {
          where: {
            OR: [
              { cantidadDisponible: { gt: 0 } },
              { cantidadBloqueada: { gt: 0 } }
            ]
          },
          include: {
            sku: true,
            cliente: true,
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!loc) throw new HttpException('Ubicación no encontrada', HttpStatus.NOT_FOUND);

    const rawHus = await this.prisma.handlingUnit.findMany({
      where: {
        OR: [{ ubicacionActual: loc.codigo }, { ubicacionActual: loc.id }],
        estadoHu: { notIn: ['INACTIVO', 'DESPACHADO'] }
      },
      include: { lote: { include: { sku: true } }, cliente: true },
      orderBy: { codigo: 'asc' },
    });

    // Solo HUs con saldo físico real en existencia
    const hus = rawHus.filter(h => {
      if (h.lote) {
        return ((h.lote.cantidadDisponible || 0) + (h.lote.cantidadBloqueada || 0)) > 0;
      }
      return (h.cantidad || 0) > 0;
    });

    const classification = this.classifyLocation(loc);

    const capUnits = (loc as any).capacidadUnits || 100;
    const sumDisp = loc.lotes.reduce((sum, l) => sum + (l.cantidadDisponible || 0), 0);
    const sumBloq = loc.lotes.reduce((sum, l) => sum + (l.cantidadBloqueada || 0), 0);
    const sumRes = loc.lotes.reduce((sum, l) => sum + Math.max(0, l.cantidadReservada || 0), 0);
    const ocupUnidades = sumDisp + sumBloq;

    const isFloorPallet =
      loc.tipoUbicacion === 'TARIMA_PISO' ||
      (loc.tipoUbicacion === 'PISO' && classification.esAlmacenable) ||
      (loc.codigo && loc.codigo.toUpperCase().startsWith('G'));

    // Capacidad de bultos:
    // Para posiciones de tarima en piso (incluyendo G0001+), la capacidad física canónica
    // es estrictamente de 1 tarima física (Alejandra).
    // Para celdas tradicionales proviene de configuración en BD.
    const hasConfiguredCapBultos =
      isFloorPallet ||
      (typeof (loc as any).capacidadBultos === 'number' && (loc as any).capacidadBultos > 0);
    const capBultos: number | null = isFloorPallet
      ? 1
      : hasConfiguredCapBultos
      ? (loc as any).capacidadBultos
      : null;
    const capacidadBultosEstado = hasConfiguredCapBultos ? 'CONFIGURADA' : 'NO_CONFIGURADA';
    const bultosReales = new Set(hus.map((h: any) => h.parentHuId || h.id)).size;
    const ocupBultos = isFloorPallet
      ? (bultosReales > 0 ? bultosReales : (ocupUnidades > 0 ? 1 : 0))
      : bultosReales;

    const resUnidades = (loc as any).reservaUnidades ?? 0;
    const resBultos = (loc as any).reservaBultos ?? 0;

    const capDispUnidades = isFloorPallet
      ? (ocupBultos >= 1 ? 0 : capUnits)
      : Math.max(0, capUnits - ocupUnidades - resUnidades);
    const capDispBultos = hasConfiguredCapBultos && capBultos !== null
      ? Math.max(0, capBultos - ocupBultos - resBultos)
      : null;

    const pctUnidades = capUnits > 0 ? Math.round((ocupUnidades / capUnits) * 100) : 0;
    const pctBultos = hasConfiguredCapBultos && capBultos !== null && capBultos > 0
      ? Math.round((ocupBultos / capBultos) * 100)
      : null;

    let estadoCapacidad = 'LIBRE';
    if (!classification.esAlmacenable) {
      estadoCapacidad = 'NO_APLICA';
    } else if (loc.estado === 'BLOQUEADO') {
      estadoCapacidad = 'BLOQUEADO';
    } else if (isFloorPallet) {
      if (ocupBultos > 1) {
        estadoCapacidad = 'SOBRECAPACIDAD';
      } else if (ocupBultos >= 1 || ocupUnidades > 0) {
        estadoCapacidad = 'LLENO';
      } else {
        estadoCapacidad = 'LIBRE';
      }
    } else if (ocupUnidades > capUnits || (hasConfiguredCapBultos && capBultos !== null && ocupBultos > capBultos)) {
      estadoCapacidad = 'SOBRECAPACIDAD';
    } else if (ocupUnidades >= capUnits || (hasConfiguredCapBultos && capBultos !== null && ocupBultos >= capBultos)) {
      estadoCapacidad = 'LLENO';
    } else if (ocupUnidades > 0 || ocupBultos > 0) {
      estadoCapacidad = 'PARCIAL';
    } else {
      estadoCapacidad = 'LIBRE';
    }

    return {
      ...loc,
      // Clasificación de ubicación
      categoriaUbicacion: classification.categoriaUbicacion,
      esAlmacenable: classification.esAlmacenable,
      categoriaDescripcion: classification.categoriaDescripcion,
      // Modelo canónico de capacidad de Location (Etapa 2)
      capacidadUnits: capUnits,
      ocupacionUnidades: ocupUnidades,
      capacidadBultos: capBultos,
      capacidadBultosEstado,
      ocupacionBultos: ocupBultos,
      reservaUnidades: resUnidades,
      reservaBultos: resBultos,
      capacidadDisponibleUnidades: capDispUnidades,
      capacidadDisponibleBultos: capDispBultos,
      porcentajeOcupacionUnidades: pctUnidades,
      porcentajeOcupacionBultos: pctBultos,
      estadoCapacidad,
      // Métricas de piezas y bultos
      totalFisico: sumDisp + sumBloq,
      totalReservado: sumRes,
      totalDisponible: Math.max(0, sumDisp - sumRes),
      totalBloqueado: sumBloq,
      handlingUnits: hus,
    };
  }

  // Helper privado para clasificar ubicaciones físicas vs especiales/transitorias
  private classifyLocation(loc: any) {
    const code = (loc.codigo || '').toUpperCase();
    const tipo = (loc.tipoUbicacion || '').toUpperCase();
    const zonaTipo = (loc.zona?.tipoZona || '').toUpperCase();
    const zonaCode = (loc.zona?.codigo || '').toUpperCase();

    // 1. Recibo y Andenes en tránsito
    if (code.startsWith('REC-') || code.includes('RAMPA') || code.includes('ANDEN') || tipo === 'RECIBO' || zonaTipo === 'RECIBO' || zonaCode === 'RECIBO') {
      return {
        categoriaUbicacion: 'RECIBO_TRANSITO',
        esAlmacenable: false,
        categoriaDescripcion: 'Andén / Recibo en Tránsito',
      };
    }

    // 2. Virtual / No Conforme (Mermas DEV-01, Excesos NC-EXCESO-01, Cuarentenas, PNC)
    if (
      code === 'DEV-01' ||
      code === 'NC-EXCESO-01' ||
      code.includes('DEV') ||
      code.includes('CUARENTENA') ||
      (code.includes('PNC') && !code.startsWith('G')) ||
      tipo === 'CUARENTENA' ||
      tipo === 'DEVOLUCION' ||
      tipo === 'PNC' ||
      zonaTipo === 'CUARENTENA' ||
      zonaTipo === 'DEVOLUCION' ||
      zonaTipo === 'PNC' ||
      zonaCode === 'DEVOLUCION' ||
      zonaCode === 'CUARENTENA' ||
      zonaCode === 'PNC'
    ) {
      return {
        categoriaUbicacion: 'VIRTUAL_NO_CONFORME',
        esAlmacenable: false,
        categoriaDescripcion: 'Almacén Virtual / No Conforme (PNC)',
      };
    }

    // 3. Staging / Pulmón de salida
    if (code.includes('STAG') || code.startsWith('STG-') || tipo === 'STAGING' || zonaTipo === 'STAGING' || zonaCode === 'STAGING') {
      return {
        categoriaUbicacion: 'STAGING',
        esAlmacenable: false,
        categoriaDescripcion: 'Área de Staging / Consolidación',
      };
    }

    // 4. Áreas de trabajo y elementos estructurales no inventariables (mesas, baños)
    if (
      tipo === 'TRABAJO' ||
      tipo === 'ESTRUCTURAL' ||
      tipo === 'MESA_TRABAJO' ||
      code.startsWith('MESA') ||
      code.startsWith('BAÑO') ||
      code.startsWith('BANIO')
    ) {
      return {
        categoriaUbicacion: 'ESPECIAL_OTRAS',
        esAlmacenable: false,
        categoriaDescripcion: 'Área Especial / No Inventariable',
      };
    }

    // 5. Posiciones físicas de estiba en piso:
    const esZonaAlmacenable =
      zonaTipo === 'ALMACENAMIENTO' ||
      zonaTipo === 'PICKING' ||
      zonaCode.startsWith('ALM-') ||
      zonaCode === 'INTERIOR' ||
      zonaCode === 'EXTERIOR_TECHADO' ||
      zonaCode.includes('EXTERIOR');

    if (tipo === 'TARIMA_PISO' && esZonaAlmacenable) {
      return {
        categoriaUbicacion: 'FISICA_ALMACENABLE',
        esAlmacenable: true,
        categoriaDescripcion: 'Posición de Tarima en Piso',
      };
    }

    if (tipo === 'PISO') {
      if (esZonaAlmacenable) {
        return {
          categoriaUbicacion: 'FISICA_ALMACENABLE',
          esAlmacenable: true,
          categoriaDescripcion: 'Posición de Tarima en Piso',
        };
      }
      return {
        categoriaUbicacion: 'ESPECIAL_OTRAS',
        esAlmacenable: false,
        categoriaDescripcion: 'Ubicación Especial de Piso',
      };
    }

    // 6. Celdas físicas de almacenamiento (Rack / Estantería con Pasillo-Rack-Nivel)
    return {
      categoriaUbicacion: 'FISICA_ALMACENABLE',
      esAlmacenable: true,
      categoriaDescripcion: 'Celda Almacenable (Rack / Estantería)',
    };
  }

  @Post('locations')
  @RequireAccess({ modules: ['ubicaciones', 'maestros'], actions: ['crear'], allowPortal: false })
  @ApiOperation({ summary: 'Crear ubicación' })
  async createLocation(@Body() data: any) {
    return this.prisma.location.create({ data });
  }

  @Put('locations/:id')
  @RequireAccess({ modules: ['ubicaciones', 'maestros'], actions: ['editar'], allowPortal: false })
  @ApiOperation({ summary: 'Actualizar ubicación' })
  async updateLocation(@Param('id') id: string, @Body() data: any) {
    return this.prisma.location.update({ where: { id }, data });
  }

  @Patch('locations/:id/pnc-designation')
  @RequireAccess({ modules: ['ubicaciones'], actions: ['editar', 'ajustar'], allowPortal: false })
  @ApiOperation({ summary: 'Alternar designación operativa entre Almacenamiento Comercial (TARIMA_PISO) y No Conforme (PNC) con blindaje y RBAC' })
  async setLocationPncDesignation(
    @Param('id') id: string,
    @Body() body: { usoPnc: boolean; motivo?: string; usuario?: string },
    @Headers('authorization') authHeader?: string,
    @Req() req?: any,
  ) {
    // 1. AUTENTICACIÓN Y RESOLUCIÓN DE USUARIO VERIFICADO
    let user: any = null;
    if (req?.user?.id) {
      user = await this.prisma.user.findUnique({
        where: { id: req.user.id },
        include: { rol: { include: { permisos: true } } },
      });
    } else {
      if (!authHeader || typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
        throw new UnauthorizedException('No autenticado: Token de sesión requerido');
      }

      const token = authHeader.replace('Bearer ', '').trim();
      let decoded: any;
      try {
        decoded = jwt.verify(token, JWT_SECRET);
      } catch {
        throw new UnauthorizedException('Token de sesión inválido o expirado');
      }

      const userId = decoded.userId || decoded.id;
      if (!userId) {
        throw new UnauthorizedException('Token inválido: falta identificador de usuario');
      }

      user = await this.prisma.user.findUnique({
        where: { id: userId },
        include: { rol: { include: { permisos: true } } },
      });
    }

    if (!user || !user.activo) {
      throw new UnauthorizedException('Sesión inválida: usuario inactivo o no encontrado');
    }

    // 2. CONTROL DE ACCESO BASADO EN ROLES (RBAC)
    // Autorizados: Super Admin (nivel 1), Dirección (2), Gerente Operaciones (3), Supervisor Almacén (4)
    // o cualquier rol con permiso formal sobre el módulo ubicaciones
    const isSuperAdmin = user.rol?.nombre === 'Super Admin' || user.rol?.nivel === 1;
    const isAuthorizedRole = isSuperAdmin || (typeof user.rol?.nivel === 'number' && user.rol.nivel <= 4);
    const hasPermisoUbicaciones = user.rol?.permisos?.some(
      (p: any) => p.modulo === 'ubicaciones' && ['editar', 'ajustar', 'administrar'].includes(p.accion),
    );

    if (!isAuthorizedRole && !hasPermisoUbicaciones) {
      throw new ForbiddenException(
        `ACCESO_DENEGADO: El rol "${user.rol?.nombre || 'Sin Rol'}" carece de privilegios para alterar el uso operativo de ubicaciones. Acción reservada a Supervisor, Gerente o Administrador.`,
      );
    }

    const auditUser = user.nombre || user.email || body.usuario || 'supervisor';

    // 3. RECUPERAR UBICACIÓN CON LOTES ASOCIADOS
    const loc = await this.prisma.location.findFirst({
      where: { OR: [{ id }, { codigo: id }] },
      include: { lotes: true, zona: true },
    });
    if (!loc) {
      throw new NotFoundException(`Ubicación con identificador "${id}" no encontrada`);
    }

    const unDisponibles = (loc.lotes || []).reduce((sum, l) => sum + (l.cantidadDisponible || 0), 0);
    const unReservadas = (loc.lotes || []).reduce((sum, l) => sum + (l.cantidadReservada || 0), 0);
    const unBloqueadas = (loc.lotes || []).reduce((sum, l) => sum + (l.cantidadBloqueada || 0), 0);

    // 4. BLINDAJE COMPLETO: NORMAL -> PNC
    if (body.usoPnc) {
      // 4.1 Inventario disponible comercial
      if (unDisponibles > 0) {
        throw new BadRequestException(
          `No es posible designar la ubicación ${loc.codigo} como PNC porque contiene ${unDisponibles} unidades disponibles de producto en buen estado. Transfiera o bloquee el inventario comercial antes de cambiar su designación operativa.`,
        );
      }

      // 4.2 Inventario reservado para pedidos
      if (unReservadas > 0) {
        throw new BadRequestException(
          `No es posible designar la ubicación ${loc.codigo} como PNC porque contiene ${unReservadas} unidades reservadas para pedidos de salida. Cancele o concluya los despachos antes de cambiar su designación operativa.`,
        );
      }

      // 4.3 Asignaciones activas a pedidos o surtido en curso
      const activeOrderLines = await this.prisma.salesOrderLine.count({
        where: {
          OR: [{ ubicacionAsignada: loc.codigo }, { ubicacionEscaneada: loc.codigo }],
          pickingCompletado: false,
          orden: { estado: { in: ['ASIGNADO', 'EN_PICKING'] } },
        },
      });
      if (activeOrderLines > 0) {
        throw new BadRequestException(
          `No es posible designar la ubicación ${loc.codigo} como PNC: tiene ${activeOrderLines} pedidos o surtidos activos asignados a esta posición. Concluya o reasigne los pedidos antes de cambiar el uso operativo.`,
        );
      }

      // 4.4 Handling Units comerciales activas en la ubicación
      const activeCommercialHus = await this.prisma.handlingUnit.findMany({
        where: {
          OR: [{ ubicacionActual: loc.codigo }, { ubicacionActual: loc.id }],
          estadoHu: { in: ['ACTIVO', 'EN_TRANSITO'] },
        },
        select: { id: true, codigo: true, tipoHu: true },
      });
      if (activeCommercialHus.length > 0) {
        throw new BadRequestException(
          `No es posible designar la ubicación ${loc.codigo} como PNC: contiene ${activeCommercialHus.length} Handling Units comerciales activas (${activeCommercialHus.map(h => h.codigo).slice(0, 3).join(', ')}). Desaloje o reasigne las unidades antes de cambiar la designación.`,
        );
      }

      const valorAnterior = loc.tipoUbicacion;
      const valorNuevo = 'PNC';

      const updated = await this.prisma.$transaction(async (tx) => {
        const u = await tx.location.update({
          where: { id: loc.id },
          data: { tipoUbicacion: valorNuevo },
          include: { zona: true, lotes: true },
        });

        await tx.auditLog.create({
          data: {
            usuario: auditUser,
            accion: 'DESIGNAR_PNC',
            entidad: 'Location',
            entidadId: loc.id,
            detalle: `Ubicación: ${loc.codigo} | Valor anterior: ${valorAnterior} | Valor nuevo: ${valorNuevo} | Motivo: ${body.motivo || 'Reasignación operativa de layout'} | Código inmutable: ${loc.codigo}`,
          },
        });

        return u;
      });

      return {
        success: true,
        message: `Ubicación ${loc.codigo} designada exitosamente como PNC/Merma`,
        location: updated,
        classification: this.classifyLocation(updated),
      };

    } else {
      // 5. BLINDAJE COMPLETO: PNC -> NORMAL (COMERCIAL)
      // 5.1 Inventario bloqueado
      if (unBloqueadas > 0) {
        throw new BadRequestException(
          `No es posible restituir la ubicación ${loc.codigo} a uso comercial porque contiene ${unBloqueadas} unidades en estado bloqueado/PNC. Desaloje la mercancía no conforme antes de habilitar uso comercial.`,
        );
      }

      // 5.2 Lotes con estado de calidad no liberado (CUARENTENA, BLOQUEADO, MERMA, NO_CONFORME, PENDIENTE)
      const nonLiberatedLots = (loc.lotes || []).filter(
        (l: any) => l.estadoCalidad && l.estadoCalidad !== 'LIBERADO',
      );
      if (nonLiberatedLots.length > 0) {
        throw new BadRequestException(
          `No es posible restituir la ubicación ${loc.codigo} a uso comercial: contiene ${nonLiberatedLots.length} lotes con estado de calidad no liberado (${nonLiberatedLots.map((l: any) => `${l.lote || 'S/L'}: ${l.estadoCalidad}`).join(', ')}).`,
        );
      }

      // 5.3 Handling Units no conformes o dañadas
      const nonConformingHus = await this.prisma.handlingUnit.findMany({
        where: {
          OR: [{ ubicacionActual: loc.codigo }, { ubicacionActual: loc.id }],
          estadoHu: { in: ['DAÑADO', 'CUARENTENA', 'RETENIDO'] },
        },
        select: { id: true, codigo: true, estadoHu: true },
      });
      if (nonConformingHus.length > 0) {
        throw new BadRequestException(
          `No es posible restituir la ubicación ${loc.codigo} a comercial: contiene ${nonConformingHus.length} Handling Units no conformes o retenidas (${nonConformingHus.map(h => `${h.codigo} [${h.estadoHu}]`).slice(0, 3).join(', ')}).`,
        );
      }

      const valorAnterior = loc.tipoUbicacion;
      const valorNuevo = 'TARIMA_PISO';

      const updated = await this.prisma.$transaction(async (tx) => {
        const u = await tx.location.update({
          where: { id: loc.id },
          data: { tipoUbicacion: valorNuevo },
          include: { zona: true, lotes: true },
        });

        await tx.auditLog.create({
          data: {
            usuario: auditUser,
            accion: 'RESTITUIR_COMERCIAL',
            entidad: 'Location',
            entidadId: loc.id,
            detalle: `Ubicación: ${loc.codigo} | Valor anterior: ${valorAnterior} | Valor nuevo: ${valorNuevo} | Motivo: ${body.motivo || 'Habilitación de posición para mercancía en buen estado'} | Código inmutable: ${loc.codigo}`,
          },
        });

        return u;
      });

      return {
        success: true,
        message: `Ubicación ${loc.codigo} restituida exitosamente a Almacenamiento Comercial (TARIMA_PISO)`,
        location: updated,
        classification: this.classifyLocation(updated),
      };
    }
  }

  // ============ ALERTS ============
  @Get('alerts')
  @RequireAccess({ modules: ['alertas', 'dashboard'], actions: ['ver'], allowPortal: false })
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

  @Get('alerts/status')
  @RequireAccess({ modules: ['alertas', 'dashboard'], actions: ['ver'], allowPortal: false })
  @ApiOperation({ summary: 'Obtener estado y fecha de último escaneo de alertas' })
  async getAlertsStatus() {
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key: 'ALERTS_LAST_SCAN' },
    });
    const lastAlert = await this.prisma.alert.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    const activeCount = await this.prisma.alert.count({ where: { resuelta: false } });
    const criticalCount = await this.prisma.alert.count({ where: { resuelta: false, prioridad: 'CRITICA' } });
    return {
      lastScan: setting?.value || lastAlert?.createdAt?.toISOString() || null,
      activeCount,
      criticalCount,
    };
  }

  @Post('alerts')
  @RequireAccess({ modules: ['alertas'], actions: ['crear'], allowPortal: false })
  @ApiOperation({ summary: 'Crear alerta manual' })
  async createAlert(@Body() data: any) {
    return this.prisma.alert.create({ data });
  }

  @Put('alerts/:id/resolve')
  @RequireAccess({ modules: ['alertas'], actions: ['editar'], allowPortal: false })
  @ApiOperation({ summary: 'Resolver alerta' })
  async resolveAlert(@Param('id') id: string, @Body() data: any, @Req() req?: any) {
    return this.prisma.alert.update({
      where: { id },
      data: { resuelta: true, resueltaPor: req?.user?.nombre || req?.user?.email || data?.usuario || 'sistema', resueltaEn: new Date() },
    });
  }

  @Post('alerts/generate')
  @RequireAccess({ modules: ['alertas'], actions: ['crear', 'editar'], allowPortal: false })
  @ApiOperation({ summary: 'Generar alertas inteligentes escaneando inventario' })
  async generateAlerts() {
    const candidateAlerts: any[] = [];
    const now = new Date();

    // 1. UBICACIÓN SATURADA: Posiciones comerciales de rack que exceden capacidad nominal
    const locations = await this.prisma.location.findMany({
      where: { activo: true },
      include: {
        zona: true,
        lotes: {
          where: {
            OR: [
              { cantidadDisponible: { gt: 0 } },
              { cantidadBloqueada: { gt: 0 } },
            ],
          },
        },
      },
      orderBy: { codigo: 'asc' },
    });

    for (const loc of locations) {
      const classification = this.classifyLocation(loc);
      if (!classification.esAlmacenable) continue;

      const capUnits = (loc as any).capacidadUnits || 100;
      const sumDisp = loc.lotes.reduce((sum, l) => sum + (l.cantidadDisponible || 0), 0);
      const sumBloq = loc.lotes.reduce((sum, l) => sum + (l.cantidadBloqueada || 0), 0);
      const ocupUnidades = sumDisp + sumBloq;
      const pctUnidades = capUnits > 0 ? Math.round((ocupUnidades / capUnits) * 100) : 0;

      if (pctUnidades > 100) {
        candidateAlerts.push({
          tipo: 'UBICACION_SATURADA',
          prioridad: pctUnidades >= 200 ? 'CRITICA' : 'ALTA',
          titulo: `Ubicación saturada: ${loc.codigo} (${pctUnidades}% de capacidad)`,
          detalle: `Ubicación ${loc.codigo} (Zona: ${loc.zona?.nombre || loc.zona?.codigo || 'N/A'}) supera su capacidad nominal: ${ocupUnidades}/${capUnits} piezas (${pctUnidades}%). Requiere desahogo operativo.`,
          entidad: 'Location',
          entidadId: loc.id,
          clienteId: null,
        });
      }
    }

    // 2. VENCIMIENTOS Y VENCIMIENTO PRÓXIMO: Precedencia canónica (274 PZA vencidas) + horizonte de 30 días
    const lotsWithExp = await this.prisma.lotInventory.findMany({
      where: { fechaVencimiento: { not: null } },
      include: {
        sku: { select: { id: true, codigo: true, descripcion: true } },
        cliente: { select: { id: true, nombreComercial: true } },
        ubicacion: { include: { zona: true } },
      },
    });

    const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    for (const lot of lotsWithExp) {
      const locClass = classifyLocationOperationalRole(lot.ubicacion);
      const evalState = evaluateInventoryItemOperationalState(lot, locClass, now);

      if (evalState.cantidadExpirada > 0) {
        candidateAlerts.push({
          tipo: 'VENCIMIENTO_PROXIMO',
          prioridad: 'CRITICA',
          titulo: `Lote vencido: ${lot.sku?.codigo} — Lote ${lot.lote || 'S/L'} (${evalState.cantidadExpirada} uds)`,
          detalle: `${lot.sku?.descripcion} (Lote: ${lot.lote || 'N/A'}) venció el ${toCalendarDayString(lot.fechaVencimiento)}. Saldo físico: ${evalState.cantidadExpirada} uds en ${lot.ubicacion?.codigo || 'N/A'}. Requiere segregación.`,
          entidad: 'LotInventory',
          entidadId: lot.id,
          clienteId: lot.clienteId,
        });
      } else if (
        evalState.esVendible &&
        lot.fechaVencimiento &&
        lot.fechaVencimiento > now &&
        lot.fechaVencimiento <= thirtyDaysFromNow &&
        lot.cantidadDisponible > 0
      ) {
        const daysLeft = Math.ceil((lot.fechaVencimiento.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        const prioridad = daysLeft < 7 ? 'CRITICA' : daysLeft < 14 ? 'ALTA' : 'MEDIA';
        candidateAlerts.push({
          tipo: 'VENCIMIENTO_PROXIMO',
          prioridad,
          titulo: `Vence en ${daysLeft} días: ${lot.sku?.codigo} — Lote ${lot.lote || 'S/L'}`,
          detalle: `${lot.sku?.descripcion} (Lote: ${lot.lote || 'N/A'}) vence el ${toCalendarDayString(lot.fechaVencimiento)} (${daysLeft} días restantes). ${lot.cantidadDisponible} uds vendibles en stock.`,
          entidad: 'LotInventory',
          entidadId: lot.id,
          clienteId: lot.clienteId,
        });
      }
    }

    // 3. PEDIDOS ATRASADOS: fechaCompromiso/fechaCita SLA vencida en pedidos abiertos
    const openOrders = await this.prisma.salesOrder.findMany({
      where: {
        estado: { in: ['APROBADO', 'EN_PICKING', 'CONSOLIDADO', 'PENDIENTE', 'CONFIRMADO', 'DESPACHADO', 'EN_TRANSITO'] },
      },
      include: { cliente: { select: { id: true, nombreComercial: true } } },
    });

    for (const order of openOrders) {
      const dateRef = (order as any).fechaCita || order.fechaCompromiso;
      let daysLate = 0;
      let dateLabel = '';

      if (dateRef) {
        const refTime = new Date(dateRef).getTime();
        if (now.getTime() > refTime) {
          daysLate = Math.ceil((now.getTime() - refTime) / (1000 * 60 * 60 * 24));
          dateLabel = (order as any).fechaCita ? 'fecha de cita' : 'fecha de compromiso';
        }
      } else {
        const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
        if (order.createdAt < threeDaysAgo) {
          daysLate = Math.ceil((now.getTime() - order.createdAt.getTime()) / (1000 * 60 * 60 * 24));
          dateLabel = 'antigüedad de creación (>3d)';
        }
      }

      if (daysLate > 0) {
        candidateAlerts.push({
          tipo: 'PEDIDO_ATRASADO',
          prioridad: daysLate > 7 ? 'CRITICA' : 'ALTA',
          titulo: `Pedido atrasado (${daysLate}d): ${order.codigo}`,
          detalle: `Pedido ${order.codigo} de ${order.cliente?.nombreComercial || 'N/A'} (Estado: ${order.estado}) supera su ${dateLabel} por ${daysLate} días. Requiere priorización en despacho.`,
          entidad: 'SalesOrder',
          entidadId: order.id,
          clienteId: order.clienteId,
        });
      }
    }

    // 4. SIN MOVIMIENTO: SKUs sin movimiento en >14 días (exactamente 1 alerta por SKU)
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const activeLots = await this.prisma.lotInventory.findMany({
      where: {
        OR: [
          { cantidadDisponible: { gt: 0 } },
          { cantidadBloqueada: { gt: 0 } },
        ],
      },
      include: {
        sku: { select: { id: true, codigo: true, descripcion: true } },
        cliente: { select: { id: true, nombreComercial: true } },
      },
    });

    const activeSkuMap = new Map<string, { sku: any; cliente: any; stockTotal: number }>();
    for (const lot of activeLots) {
      if (!lot.skuId || !lot.sku) continue;
      const existing = activeSkuMap.get(lot.skuId);
      const lotStock = (lot.cantidadDisponible || 0) + (lot.cantidadBloqueada || 0);
      if (existing) {
        existing.stockTotal += lotStock;
      } else {
        activeSkuMap.set(lot.skuId, {
          sku: lot.sku,
          cliente: lot.cliente,
          stockTotal: lotStock,
        });
      }
    }

    for (const [skuId, info] of activeSkuMap.entries()) {
      const recentMove = await this.prisma.inventoryMovement.findFirst({
        where: { skuId, fechaHora: { gte: fourteenDaysAgo } },
      });
      if (!recentMove) {
        candidateAlerts.push({
          tipo: 'SIN_MOVIMIENTO',
          prioridad: 'MEDIA',
          titulo: `Sin movimiento: ${info.sku.codigo} (>14 días)`,
          detalle: `${info.sku.descripcion} de ${info.cliente?.nombreComercial || 'N/A'} no registra movimientos en los últimos 14 días. Stock físico actual: ${info.stockTotal} uds.`,
          entidad: 'SkuMaster',
          entidadId: skuId,
          clienteId: info.cliente?.id || null,
        });
      }
    }

    // 5. DISCREPANCIA: Solo conteos cíclicos abiertos con partidas no conciliadas
    const openCounts = await this.prisma.cycleCount.findMany({
      where: {
        estado: { notIn: ['COMPLETADO', 'CERRADO', 'CANCELADO'] },
      },
      include: {
        lineas: {
          where: {
            OR: [
              { discrepancia: { gt: 0 } },
              { discrepancia: { lt: 0 } },
              { estado: 'DISCREPANCIA' },
            ],
          },
        },
      },
    });

    for (const cc of openCounts) {
      if (cc.lineas.length > 0) {
        candidateAlerts.push({
          tipo: 'DISCREPANCIA',
          prioridad: 'ALTA',
          titulo: `Discrepancia en conteo: ${cc.codigo} (${cc.lineas.length} partidas)`,
          detalle: `El conteo cíclico ${cc.codigo} (Estado: ${cc.estado}) presenta ${cc.lineas.length} línea(s) con discrepancia física pendiente de conciliación.`,
          entidad: 'CycleCount',
          entidadId: cc.id,
          clienteId: null,
        });
      }
    }

    // 6. STOCK BAJO: Solo partidas en racks comerciales con stock vendible < 10
    const lowStockLots = await this.prisma.lotInventory.findMany({
      where: { cantidadDisponible: { gt: 0, lt: 10 } },
      include: {
        sku: { select: { id: true, codigo: true, descripcion: true } },
        cliente: { select: { id: true, nombreComercial: true } },
        ubicacion: { include: { zona: true } },
      },
    });

    for (const lot of lowStockLots) {
      const locClass = classifyLocationOperationalRole(lot.ubicacion);
      const evalState = evaluateInventoryItemOperationalState(lot, locClass, now);

      if (evalState.esVendible && evalState.cantidadDisponibleVendible > 0 && evalState.cantidadDisponibleVendible < 10) {
        candidateAlerts.push({
          tipo: 'STOCK_BAJO',
          prioridad: evalState.cantidadDisponibleVendible < 5 ? 'CRITICA' : 'ALTA',
          titulo: `Stock bajo: ${lot.sku?.codigo} — ${evalState.cantidadDisponibleVendible} uds vendibles`,
          detalle: `${lot.sku?.descripcion} (Lote: ${lot.lote || 'N/A'}) de ${lot.cliente?.nombreComercial || 'N/A'} cuenta con solo ${evalState.cantidadDisponibleVendible} unidades disponibles vendibles en rack comercial.`,
          entidad: 'LotInventory',
          entidadId: lot.id,
          clienteId: lot.clienteId,
        });
      }
    }

    // RECONCILIACIÓN DEL ESTADO OPERATIVO Y CICLO DE VIDA DE ALERTAS
    // Clave canónica: ${tipo}:${entidad}:${entidadId}
    const allAlertsInDb = await this.prisma.alert.findMany({
      select: { id: true, tipo: true, entidad: true, entidadId: true, resuelta: true, titulo: true, prioridad: true, detalle: true },
    });

    const activeAlertsInDb = allAlertsInDb.filter(a => !a.resuelta);
    const activeAlertsMap = new Map<string, typeof activeAlertsInDb[0]>();
    for (const a of activeAlertsInDb) {
      const key = `${a.tipo}:${a.entidad}:${a.entidadId}`;
      activeAlertsMap.set(key, a);
    }

    // Conjunto canónico actual en memoria (deduplicado dentro del lote)
    const currentIncidenceMap = new Map<string, any>();
    for (const alert of candidateAlerts) {
      const key = `${alert.tipo}:${alert.entidad}:${alert.entidadId}`;
      if (!currentIncidenceMap.has(key)) {
        currentIncidenceMap.set(key, alert);
      }
    }

    const toCreate: any[] = [];
    let conservedCount = 0;
    const toAutoResolveIds: string[] = [];

    // A, B y C: Evaluar incidencias actuales contra BD activa
    for (const [key, incidence] of currentIncidenceMap.entries()) {
      if (activeAlertsMap.has(key)) {
        // B: Ya tiene alerta activa -> CONSERVAR
        conservedCount++;
      } else {
        // C: No tiene alerta activa -> CREAR NUEVA
        toCreate.push(incidence);
      }
    }

    // D: Alertas activas en BD que ya no aparecen en las incidencias actuales -> AUTO-RESOLVER
    for (const [key, activeAlert] of activeAlertsMap.entries()) {
      if (!currentIncidenceMap.has(key)) {
        toAutoResolveIds.push(activeAlert.id);
      }
    }

    // 3. TRANSACCIONALIDAD: Reconciliación atómica en BD
    // Modifica ÚNICAMENTE Alert, SystemSetting y AuditLog
    await this.prisma.$transaction(async (tx) => {
      // Auto-resolver alertas que desaparecieron operativamente
      if (toAutoResolveIds.length > 0) {
        await tx.alert.updateMany({
          where: { id: { in: toAutoResolveIds } },
          data: {
            resuelta: true,
            resueltaEn: now,
            resueltaPor: 'sistema:reconciliacion_automatica',
          },
        });
      }

      // Crear nuevas alertas
      if (toCreate.length > 0) {
        await tx.alert.createMany({ data: toCreate });
      }

      // Persistir timestamp en SystemSetting
      await tx.systemSetting.upsert({
        where: { key: 'ALERTS_LAST_SCAN' },
        update: { value: now.toISOString() },
        create: {
          key: 'ALERTS_LAST_SCAN',
          value: now.toISOString(),
          category: 'alerts',
          label: 'Último escaneo operativo de alertas',
        },
      });

      // Registrar auditoría del escaneo
      await tx.auditLog.create({
        data: {
          usuario: 'sistema',
          accion: 'SCAN_ALERTS',
          entidad: 'Alert',
          detalle: `Reconciliación: ${toCreate.length} creadas, ${conservedCount} conservadas, ${toAutoResolveIds.length} auto-resueltas (total evaluadas: ${currentIncidenceMap.size})`,
        },
      });
    });

    return {
      message: `${toCreate.length} nuevas alertas generadas, ${conservedCount} conservadas, ${toAutoResolveIds.length} auto-resueltas`,
      created: toCreate.length,
      conserved: conservedCount,
      autoResolved: toAutoResolveIds.length,
      scannedAt: now.toISOString(),
      totalEvaluadas: currentIncidenceMap.size,
    };
  }

  // ============ TASKS ============
  @Get('tasks')
  @RequireAccess({ modules: ['alertas', 'dashboard'], actions: ['ver'], allowPortal: false })
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
  @RequireAccess({ modules: ['alertas'], actions: ['crear'], allowPortal: false })
  @ApiOperation({ summary: 'Crear tarea desde alerta' })
  async createTask(@Body() data: any, @Req() req?: any) {
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
        creadoPor: req?.user?.nombre || req?.user?.email || data.creadoPor,
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
  @RequireAccess({ modules: ['alertas'], actions: ['editar'], allowPortal: false })
  @ApiOperation({ summary: 'Actualizar estado de tarea' })
  async updateTaskStatus(@Param('id') id: string, @Body() data: any, @Req() req?: any) {
    const updateData: any = { estado: data.estado };
    if (data.estado === 'COMPLETADA') {
      updateData.completadaEn = new Date();
      updateData.completadaPor = req?.user?.nombre || req?.user?.email || data.usuario || 'sistema';
    }
    return this.prisma.task.update({ where: { id }, data: updateData });
  }

  // ============ SYSTEM SETTINGS ============
  @Get('settings')
  @RequireAccess({ modules: ['admin'], actions: ['ver'], allowPortal: false })
  @ApiOperation({ summary: 'Obtener configuraciones del sistema' })
  async getSettings(@Query('category') category?: string) {
    const where: any = {};
    if (category) where.category = category;
    const settings = await this.prisma.systemSetting.findMany({ where, orderBy: { key: 'asc' } });
    return settings.map(s => {
      if (s.key === 'email.smtp_pass') {
        return {
          ...s,
          value: s.value ? '__CONFIGURED__' : '',
          isConfigured: !!s.value,
        };
      }
      return s;
    });
  }

  @Put('settings')
  @RequireAccess({ modules: ['admin'], actions: ['editar'], allowPortal: false })
  @ApiOperation({ summary: 'Guardar configuraciones (batch)' })
  async saveSettings(@Body() data: { settings: { key: string; value: string; category?: string; label?: string }[] }) {
    const results: any[] = [];
    for (const s of data.settings) {
      if (s.key === 'email.smtp_pass') {
        if (!s.value || s.value === '__CONFIGURED__' || s.value.trim() === '') {
          continue; // Conservar contraseña existente
        }
      }
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
  @RequireAccess({ modules: ['admin'], actions: ['editar'], allowPortal: false })
  @ApiOperation({ summary: 'Probar conexión SMTP' })
  async testEmail(@Body() data?: { host?: string; port?: string | number; user?: string; pass?: string }) {
    return this.emailService.testConnection(data);
  }
}
