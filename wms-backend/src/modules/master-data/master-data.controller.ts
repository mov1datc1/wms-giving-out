import { Controller, Get, Post, Put, Patch, Delete, Param, Query, Body, Headers, HttpException, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { PrismaService } from '../../prisma.service';
import { EmailService } from '../../email.service';
import * as jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'giving-out-wms-secret-2026';

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

    // Index HUs por ubicacionActual y por cliente (exclusivamente con existencia física real)
    const huCountByLoc: Record<string, number> = {};
    const husByLocAndClient: Record<string, Record<string, number>> = {};
    for (const hu of allActiveHus) {
      // Si la HU tiene lote asociado, verificar que el lote tenga saldo físico real (> 0)
      if (hu.lote) {
        const lotFisico = (hu.lote.cantidadDisponible || 0) + (hu.lote.cantidadBloqueada || 0);
        if (lotFisico <= 0) continue; // Descartar HUs vacías/históricas con saldo cero
      } else if ((hu.cantidad || 0) <= 0) {
        continue;
      }

      if (hu.ubicacionActual) {
        huCountByLoc[hu.ubicacionActual] = (huCountByLoc[hu.ubicacionActual] || 0) + 1;
        if (!husByLocAndClient[hu.ubicacionActual]) husByLocAndClient[hu.ubicacionActual] = {};
        const cid = hu.clienteId || 'DESCONOCIDO';
        husByLocAndClient[hu.ubicacionActual][cid] = (husByLocAndClient[hu.ubicacionActual][cid] || 0) + 1;
      }
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
      
      // Capacidad de bultos: exclusivamente desde configuración física real en BD.
      // Si no existe, se tipifica como NO_CONFIGURADA (null), sin inventar 5 ni 1.
      const hasConfiguredCapBultos = typeof (loc as any).capacidadBultos === 'number' && (loc as any).capacidadBultos > 0;
      const capBultos: number | null = hasConfiguredCapBultos ? (loc as any).capacidadBultos : null;
      const capacidadBultosEstado = hasConfiguredCapBultos ? 'CONFIGURADA' : 'NO_CONFIGURADA';
      
      // Fuente de verdad de bultos en esta fase: se deriva estrictamente de HandlingUnits activas
      const bultosReales = huCountByLoc[loc.codigo] || huCountByLoc[loc.id] || 0;
      const ocupBultos = bultosReales;
      
      // Reservas comprometidas
      const resUnidades = (loc as any).reservaUnidades ?? 0;
      const resBultos = (loc as any).reservaBultos ?? 0;
      
      // Capacidades disponibles derivadas
      const capDispUnidades = Math.max(0, capUnits - ocupUnidades - resUnidades);
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

    // Capacidad de bultos: exclusivamente desde configuración física real en BD.
    const hasConfiguredCapBultos = typeof (loc as any).capacidadBultos === 'number' && (loc as any).capacidadBultos > 0;
    const capBultos: number | null = hasConfiguredCapBultos ? (loc as any).capacidadBultos : null;
    const capacidadBultosEstado = hasConfiguredCapBultos ? 'CONFIGURADA' : 'NO_CONFIGURADA';
    const ocupBultos = hus.length;

    const resUnidades = (loc as any).reservaUnidades ?? 0;
    const resBultos = (loc as any).reservaBultos ?? 0;

    const capDispUnidades = Math.max(0, capUnits - ocupUnidades - resUnidades);
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

    // 1. Recibo y Andenes en tránsito
    if (code.startsWith('REC-') || code.includes('RAMPA') || code.includes('ANDEN') || tipo === 'RECIBO' || zonaTipo === 'RECIBO') {
      return {
        categoriaUbicacion: 'RECIBO_TRANSITO',
        esAlmacenable: false,
        categoriaDescripcion: 'Andén / Recibo en Tránsito',
      };
    }

    // 2. Virtual / No Conforme (Mermas DEV-01, Excesos NC-EXCESO-01, Cuarentenas)
    if (code === 'DEV-01' || code === 'NC-EXCESO-01' || code.includes('DEV') || code.includes('CUARENTENA') || tipo === 'CUARENTENA' || zonaTipo === 'CUARENTENA' || zonaTipo === 'DEVOLUCION') {
      return {
        categoriaUbicacion: 'VIRTUAL_NO_CONFORME',
        esAlmacenable: false,
        categoriaDescripcion: 'Almacén Virtual / No Conforme',
      };
    }

    // 3. Staging / Pulmón de salida
    if (code.includes('STAG') || tipo === 'STAGING' || zonaTipo === 'STAGING') {
      return {
        categoriaUbicacion: 'STAGING',
        esAlmacenable: false,
        categoriaDescripcion: 'Área de Staging / Consolidación',
      };
    }

    // 4. Especiales de piso no vinculadas a rack
    if (tipo === 'PISO' && (!loc.rack || loc.rack === 'PISO' || loc.pasillo === 'PISO')) {
      return {
        categoriaUbicacion: 'ESPECIAL_OTRAS',
        esAlmacenable: false,
        categoriaDescripcion: 'Ubicación Especial de Piso',
      };
    }

    // 5. Celdas físicas de almacenamiento (Rack / Estantería con Pasillo-Rack-Nivel)
    return {
      categoriaUbicacion: 'FISICA_ALMACENABLE',
      esAlmacenable: true,
      categoriaDescripcion: 'Celda Almacenable (Rack / Estantería)',
    };
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
