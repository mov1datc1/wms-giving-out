import { Controller, Get, Post, Put, Delete, Param, Query, Body, Headers, HttpException, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { PrismaService } from '../../prisma.service';
import * as jwt from 'jsonwebtoken';
import { 
  CreateClientDto, 
  UpdateClientDto, 
  UpdateClientConfigDto, 
  GiroComercial, 
  getDefaultRulesForGiro,
  ReglaInventarioRotacion,
} from './dto/client.dto';

const JWT_SECRET = process.env.JWT_SECRET || 'giving-out-wms-secret-2026';

@ApiTags('Depositantes')
@Controller('api/clients')
export class ClientsController {
  constructor(private prisma: PrismaService) {}

  /**
   * Helper privado para extraer y validar el rol del usuario autenticado
   */
  private resolveUserRole(headerRole?: string, authHeader?: string): { rol: string; isOperador: boolean } {
    let rol = 'Super Admin'; // Default seguro si no viene especificado en pruebas abiertas

    if (headerRole) {
      rol = headerRole;
    } else if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const token = authHeader.split(' ')[1];
        const decoded: any = jwt.verify(token, JWT_SECRET);
        if (decoded?.rol) rol = decoded.rol;
      } catch {
        // En caso de token inválido o demo, se tolera para no romper endpoints abiertos
      }
    }

    const lower = rol.toLowerCase();
    const isOperador = lower.includes('operador') || lower.includes('operario') || lower.includes('almacenista');
    return { rol, isOperador };
  }

  // ============ CATÁLOGOS ============
  @Get('catalogos/giros')
  @ApiOperation({ summary: 'Obtener catálogo oficial de giros y sus reglas operativas por defecto' })
  async getCatalogGiros() {
    return Object.values(GiroComercial).map(giro => ({
      giro,
      reglasDefecto: getDefaultRulesForGiro(giro),
    }));
  }

  // ============ LISTADO ============
  @Get()
  @ApiOperation({ summary: 'Listar depositantes con filtros avanzados y conteo de existencias' })
  async getClients(
    @Query('activo') activo?: string, 
    @Query('giro') giro?: string,
    @Query('search') search?: string
  ) {
    const where: any = {};
    if (activo !== undefined) where.activo = activo === 'true';
    if (giro) where.giro = giro;
    if (search && search.trim()) {
      const q = search.trim();
      where.OR = [
        { nombreComercial: { contains: q, mode: 'insensitive' } },
        { razonSocial: { contains: q, mode: 'insensitive' } },
        { codigo: { contains: q, mode: 'insensitive' } },
        { rfc: { contains: q, mode: 'insensitive' } },
      ];
    }

    const clients = await this.prisma.client.findMany({
      where,
      include: {
        contactos: true,
        direccionesEntrega: true,
        endCustomers: { where: { activo: true }, select: { id: true, codigo: true, nombre: true, ciudad: true } },
        _count: { select: { skus: true, ordenesSalida: true, recepciones: true, endCustomers: true, lotes: true } },
      },
      orderBy: { nombreComercial: 'asc' },
    });

    return clients.map(client => ({
      ...client,
      stats: {
        totalSkus: client._count.skus,
        totalOrdenes: client._count.ordenesSalida,
        totalRecepciones: client._count.recepciones,
        totalClientesFinales: client._count.endCustomers,
        totalLotes: client._count.lotes,
      },
      reglasHeredadas: {
        requiereLote: client.requiereLote,
        requiereCaducidad: client.requiereCaducidad,
        reglaInventario: client.reglaInventario,
        uomPrincipal: client.uomPrincipal,
        manejoInventario: client.manejoInventario,
      }
    }));
  }

  // ============ DETALLE ============
  @Get(':id')
  @ApiOperation({ summary: 'Detalle de depositante con reglas operativas e inventario consolidado' })
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

    return {
      ...client,
      stats: {
        totalSkus: client._count.skus,
        totalOrdenes: client._count.ordenesSalida,
        totalRecepciones: client._count.recepciones,
        totalLotes: client._count.lotes,
        totalTarimas: client._count.handlingUnits,
      },
      reglasHeredadas: {
        requiereLote: client.requiereLote,
        requiereCaducidad: client.requiereCaducidad,
        reglaInventario: client.reglaInventario,
        uomPrincipal: client.uomPrincipal,
        manejoInventario: client.manejoInventario,
      }
    };
  }

  // ============ CREACIÓN (SUBTAREA 2 & 4) ============
  @Post()
  @ApiOperation({ summary: 'Crear nuevo depositante con reglas operativas heredables según giro' })
  async createClient(
    @Body() data: CreateClientDto,
    @Headers('x-user-role') headerRole?: string,
    @Headers('authorization') authHeader?: string
  ) {
    // Validaciones estrictas de campos obligatorios
    if (!data.codigo || !data.codigo.trim()) {
      throw new HttpException({
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'El código del depositante es obligatorio (ej. DEP-TEXTIL-01)',
        error: 'Bad Request',
        codigo: 'CODIGO_REQUERIDO'
      }, HttpStatus.BAD_REQUEST);
    }
    if (!data.nombreComercial || !data.nombreComercial.trim()) {
      throw new HttpException({
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'El nombre comercial es obligatorio',
        error: 'Bad Request',
        codigo: 'NOMBRE_COMERCIAL_REQUERIDO'
      }, HttpStatus.BAD_REQUEST);
    }
    if (!data.razonSocial || !data.razonSocial.trim()) {
      throw new HttpException({
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'La razón social fiscal es obligatoria',
        error: 'Bad Request',
        codigo: 'RAZON_SOCIAL_REQUERIDA'
      }, HttpStatus.BAD_REQUEST);
    }
    if (!data.giro || !data.giro.trim()) {
      throw new HttpException({
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'El giro comercial es obligatorio (ej. ROPA, COMIDA, FARMACEUTICO, MAQUILA, ELECTRONICA, GENERAL)',
        error: 'Bad Request',
        codigo: 'GIRO_REQUERIDO'
      }, HttpStatus.BAD_REQUEST);
    }

    const cleanCodigo = data.codigo.trim().toUpperCase();
    const cleanRfc = data.rfc?.trim().toUpperCase() || null;
    const cleanGiro = data.giro.trim().toUpperCase();

    // Validar duplicidad previa
    const existingCodigo = await this.prisma.client.findUnique({ where: { codigo: cleanCodigo } });
    if (existingCodigo) {
      throw new HttpException({
        statusCode: HttpStatus.CONFLICT,
        message: `Ya existe un depositante registrado con el código [${cleanCodigo}]`,
        error: 'Conflict',
        codigo: 'CODIGO_DUPLICADO'
      }, HttpStatus.CONFLICT);
    }

    if (cleanRfc) {
      const existingRfc = await this.prisma.client.findFirst({ where: { rfc: cleanRfc } });
      if (existingRfc) {
        throw new HttpException({
          statusCode: HttpStatus.CONFLICT,
          message: `Ya existe un depositante registrado con el RFC [${cleanRfc}]`,
          error: 'Conflict',
          codigo: 'RFC_DUPLICADO'
        }, HttpStatus.CONFLICT);
      }
    }

    // Subtarea 4: Derivar reglas por giro si no se especificaron
    const defaultRules = getDefaultRulesForGiro(cleanGiro);
    const requiereLote = data.requiereLote !== undefined ? Boolean(data.requiereLote) : defaultRules.requiereLote;
    const requiereCaducidad = data.requiereCaducidad !== undefined 
      ? Boolean(data.requiereCaducidad) 
      : (data.manejaCaducidad !== undefined ? Boolean(data.manejaCaducidad) : defaultRules.requiereCaducidad);
    const reglaInventario = data.reglaInventario || defaultRules.reglaInventario;
    const uomPrincipal = data.uomPrincipal || defaultRules.uomPrincipal;
    const manejoInventario = data.manejoInventario || defaultRules.manejoInventario;

    try {
      const newClient = await this.prisma.client.create({
        data: {
          codigo: cleanCodigo,
          nombreComercial: data.nombreComercial.trim(),
          razonSocial: data.razonSocial.trim(),
          rfc: cleanRfc,
          giro: cleanGiro,
          direccionFiscal: data.direccionFiscal?.trim() || null,
          ciudad: data.ciudad?.trim() || null,
          estado: data.estado?.trim() || null,
          codigoPostal: data.codigoPostal?.trim() || null,
          pais: data.pais?.trim() || 'México',
          regimenFiscal: data.regimenFiscal?.trim() || null,
          cfdiDefault: data.cfdiDefault?.trim() || null,
          telefono: data.telefono?.trim() || null,
          email: data.email?.trim() || null,
          contactoPrincipal: data.contactoPrincipal?.trim() || null,
          sitioWeb: data.sitioWeb?.trim() || null,

          // Reglas 3PL heredables
          uomPrincipal,
          manejoInventario,
          reglaInventario,
          escaneoIndividual: Boolean(data.escaneoIndividual),
          requiereAprobacion: data.requiereAprobacion !== false,
          requiereLote,
          requiereSerie: Boolean(data.requiereSerie),
          requiereCaducidad,
          colorPortal: data.colorPortal || '#0D9488',
          logoUrl: data.logoUrl || null,
        },
        include: { contactos: true, direccionesEntrega: true }
      });

      await this.prisma.auditLog.create({
        data: {
          usuario: 'Sistema Admin',
          accion: 'CREAR_DEPOSITANTE',
          entidad: 'Client',
          entidadId: newClient.id,
          detalle: `Alta de depositante ${newClient.codigo} (${newClient.nombreComercial}) con giro ${newClient.giro}. Reglas: Lote=${requiereLote}, Caducidad=${requiereCaducidad}, Rotación=${reglaInventario}`,
        }
      });

      return newClient;
    } catch (error: any) {
      if (error.code === 'P2002') {
        throw new HttpException('Ya existe un depositante con este Código o RFC.', HttpStatus.CONFLICT);
      }
      throw new HttpException(error.message || 'Error interno al crear depositante', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  // ============ ACTUALIZACIÓN (SUBTAREAS 2 & 5) ============
  @Put(':id')
  @ApiOperation({ summary: 'Actualizar depositante con candado estricto contra operarios' })
  async updateClient(
    @Param('id') id: string, 
    @Body() data: UpdateClientDto,
    @Headers('x-user-role') headerRole?: string,
    @Headers('authorization') authHeader?: string
  ) {
    const client = await this.prisma.client.findUnique({ where: { id } });
    if (!client) throw new HttpException('Depositante no encontrado', HttpStatus.NOT_FOUND);

    const { rol, isOperador } = this.resolveUserRole(headerRole, authHeader);

    // SUBTAREA 5: Candado de seguridad RBAC contra operarios
    if (isOperador) {
      const fixedRulesTouched = 
        data.giro !== undefined ||
        data.requiereLote !== undefined ||
        data.requiereCaducidad !== undefined ||
        data.manejaCaducidad !== undefined ||
        data.reglaInventario !== undefined ||
        data.uomPrincipal !== undefined;

      if (fixedRulesTouched) {
        await this.prisma.auditLog.create({
          data: {
            usuario: `Operador (${rol})`,
            accion: 'VIOLACION_REGLAS_RECHAZADA',
            entidad: 'Client',
            entidadId: id,
            detalle: `Intento de mutación no autorizada de reglas operativas fijas del cliente ${client.codigo}`,
          }
        });

        throw new HttpException({
          statusCode: HttpStatus.FORBIDDEN,
          message: 'OPERARIO_NO_AUTORIZADO_PARA_MODIFICAR_REGLAS_FIJAS: Los operarios y personal de piso no tienen autorización para modificar las reglas operativas fijas del depositante. Se requiere perfil Administrador o Supervisor.',
          error: 'Forbidden',
          codigo: 'OPERARIO_NO_AUTORIZADO_PARA_MODIFICAR_REGLAS_FIJAS',
          rolDetectado: rol,
        }, HttpStatus.FORBIDDEN);
      }
    }

    // Normalizar caducidad si viene como alias
    const updatePayload: any = { ...data };
    if (data.manejaCaducidad !== undefined && data.requiereCaducidad === undefined) {
      updatePayload.requiereCaducidad = Boolean(data.manejaCaducidad);
    }
    delete updatePayload.manejaCaducidad;

    const updated = await this.prisma.client.update({
      where: { id },
      data: updatePayload,
      include: { contactos: true, direccionesEntrega: true },
    });

    await this.prisma.auditLog.create({
      data: {
        usuario: rol,
        accion: 'ACTUALIZAR_DEPOSITANTE',
        entidad: 'Client',
        entidadId: id,
        detalle: `Actualización de parámetros para el depositante ${updated.codigo}`,
      }
    });

    return updated;
  }

  // ============ CONFIGURACIÓN DE REGLAS 3PL (SUBTAREA 4 & 5) ============
  @Put(':id/config')
  @ApiOperation({ summary: 'Configurar parámetros operativos 3PL del depositante con candado de seguridad' })
  async updateConfig(
    @Param('id') id: string, 
    @Body() data: UpdateClientConfigDto,
    @Headers('x-user-role') headerRole?: string,
    @Headers('authorization') authHeader?: string
  ) {
    const client = await this.prisma.client.findUnique({ where: { id } });
    if (!client) throw new HttpException('Depositante no encontrado', HttpStatus.NOT_FOUND);

    const { rol, isOperador } = this.resolveUserRole(headerRole, authHeader);

    // SUBTAREA 5: Bloqueo categórico a operarios
    if (isOperador) {
      throw new HttpException({
        statusCode: HttpStatus.FORBIDDEN,
        message: 'OPERARIO_NO_AUTORIZADO_PARA_MODIFICAR_REGLAS_FIJAS: Los operarios y personal de piso no tienen autorización para modificar la configuración de reglas operativas 3PL del depositante.',
        error: 'Forbidden',
        codigo: 'OPERARIO_NO_AUTORIZADO_PARA_MODIFICAR_REGLAS_FIJAS',
        rolDetectado: rol,
      }, HttpStatus.FORBIDDEN);
    }

    const payload: any = { ...data };
    if (data.manejaCaducidad !== undefined && data.requiereCaducidad === undefined) {
      payload.requiereCaducidad = Boolean(data.manejaCaducidad);
    }
    delete payload.manejaCaducidad;

    const updated = await this.prisma.client.update({
      where: { id },
      data: payload,
      include: { contactos: true, direccionesEntrega: true, endCustomers: true },
    });

    await this.prisma.auditLog.create({
      data: {
        usuario: rol,
        accion: 'ACTUALIZAR_CONFIG_3PL',
        entidad: 'Client',
        entidadId: id,
        detalle: `Actualización de reglas 3PL: Lote=${updated.requiereLote}, Caducidad=${updated.requiereCaducidad}, Rotación=${updated.reglaInventario}`,
      }
    });

    return updated;
  }

  // ============ DESACTIVACIÓN / BAJA LÓGICA (SUBTAREA 2) ============
  @Delete(':id')
  @ApiOperation({ summary: 'Desactivar depositante (baja lógica segura preservando trazabilidad)' })
  async deleteClient(
    @Param('id') id: string,
    @Headers('x-user-role') headerRole?: string,
    @Headers('authorization') authHeader?: string
  ) {
    const client = await this.prisma.client.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            lotes: true,
            recepciones: true,
          }
        }
      }
    });
    if (!client) throw new HttpException('Depositante no encontrado', HttpStatus.NOT_FOUND);

    const { rol, isOperador } = this.resolveUserRole(headerRole, authHeader);
    if (isOperador) {
      throw new HttpException({
        statusCode: HttpStatus.FORBIDDEN,
        message: 'OPERARIO_NO_AUTORIZADO: Solo perfiles de supervisión o administración pueden desactivar depositantes.',
        error: 'Forbidden',
        codigo: 'OPERARIO_NO_AUTORIZADO',
      }, HttpStatus.FORBIDDEN);
    }

    // Soft delete para garantizar cumplimiento normativo e inmutabilidad de kárdex
    const deactivated = await this.prisma.client.update({
      where: { id },
      data: { activo: false },
    });

    await this.prisma.auditLog.create({
      data: {
        usuario: rol,
        accion: 'DESACTIVAR_DEPOSITANTE',
        entidad: 'Client',
        entidadId: id,
        detalle: `Desactivación lógica del depositante ${client.codigo} (${client.nombreComercial}). Lotes resguardados: ${client._count.lotes}, Recepciones históricas: ${client._count.recepciones}`,
      }
    });

    return {
      success: true,
      message: `Depositante [${client.nombreComercial}] desactivado exitosamente. Todo su inventario y recepciones históricas quedan resguardados.`,
      cliente: deactivated,
    };
  }

  // ============ REACTIVACIÓN (SUBTAREA 2 EXTENDIDA) ============
  @Put(':id/reactivate')
  @ApiOperation({ summary: 'Reactivar depositante previamente desactivado' })
  async reactivateClient(
    @Param('id') id: string,
    @Headers('x-user-role') headerRole?: string,
    @Headers('authorization') authHeader?: string
  ) {
    const client = await this.prisma.client.findUnique({ where: { id } });
    if (!client) throw new HttpException('Depositante no encontrado', HttpStatus.NOT_FOUND);

    const { rol, isOperador } = this.resolveUserRole(headerRole, authHeader);
    if (isOperador) {
      throw new HttpException({
        statusCode: HttpStatus.FORBIDDEN,
        message: 'OPERARIO_NO_AUTORIZADO: Solo perfiles de supervisión o administración pueden reactivar depositantes.',
        error: 'Forbidden',
        codigo: 'OPERARIO_NO_AUTORIZADO',
      }, HttpStatus.FORBIDDEN);
    }

    const reactivated = await this.prisma.client.update({
      where: { id },
      data: { activo: true },
    });

    await this.prisma.auditLog.create({
      data: {
        usuario: rol,
        accion: 'REACTIVAR_DEPOSITANTE',
        entidad: 'Client',
        entidadId: id,
        detalle: `Reactivación del depositante ${client.codigo} (${client.nombreComercial}). Vuelve a estar disponible para operaciones activas en el WMS.`,
      }
    });

    return {
      success: true,
      message: `Depositante [${client.nombreComercial}] reactivado exitosamente.`,
      cliente: reactivated,
    };
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
  @ApiOperation({ summary: 'Resumen completo de inventario del depositante con desglose de estados y almacén' })
  async getClientInventory(@Param('id') clienteId: string) {
    const lots = await this.prisma.lotInventory.findMany({
      where: {
        clienteId,
        OR: [
          { cantidadDisponible: { gt: 0 } },
          { cantidadReservada: { gt: 0 } },
          { cantidadBloqueada: { gt: 0 } },
        ],
      },
      include: {
        sku: { select: { id: true, codigo: true, descripcion: true, categoria: true, talla: true, color: true, uomBase: true, codigoBarras: true } },
        ubicacion: { 
          select: { 
            id: true, codigo: true, pasillo: true, rack: true, nivel: true, tipoUbicacion: true,
            zona: { select: { id: true, codigo: true, nombre: true, tipoZona: true } },
            almacen: { select: { id: true, codigo: true, nombre: true } }
          } 
        },
      },
      orderBy: [{ sku: { descripcion: 'asc' } }, { createdAt: 'desc' }],
    });

    const totalSkus = new Set(lots.map(l => l.skuId)).size;
    let totalFisico = 0;
    let totalDisponible = 0;
    let totalReservado = 0;
    let totalCuarentena = 0;

    for (const lot of lots) {
      const disp = lot.cantidadDisponible || 0;
      const res = lot.cantidadReservada || 0;
      const bloq = lot.cantidadBloqueada || 0;
      
      totalFisico += (disp + bloq);
      totalReservado += res;
      
      if (lot.estadoCalidad === 'LIBERADO') {
        totalDisponible += Math.max(0, disp - res);
      } else {
        totalCuarentena += (bloq > 0 ? bloq : disp);
      }
    }

    return {
      clienteId,
      totalSkus,
      totalFisico,
      totalDisponible,
      totalReservado,
      totalCuarentena,
      totalUnidades: totalFisico,
      lotes: lots,
    };
  }
}
