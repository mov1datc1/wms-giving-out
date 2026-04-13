import { Controller, Get, Post, Put, Delete, Param, Body, HttpException, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { PrismaService } from '../../prisma.service';
import * as bcrypt from 'bcrypt';

@ApiTags('Auth')
@Controller('api/admin')
export class AdminController {
  constructor(private prisma: PrismaService) {}

  // ============ USERS ============
  @Get('users')
  @ApiOperation({ summary: 'Listar usuarios' })
  async getUsers() {
    return this.prisma.user.findMany({
      include: { rol: { select: { nombre: true, nivel: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Post('users')
  @ApiOperation({ summary: 'Crear usuario' })
  async createUser(@Body() data: { email: string; nombre: string; password: string; rolId?: string; almacenId?: string; clienteId?: string }) {
    const existing = await this.prisma.user.findUnique({ where: { email: data.email } });
    if (existing) throw new HttpException('Email ya registrado', HttpStatus.CONFLICT);

    const passwordHash = await bcrypt.hash(data.password, 10);
    return this.prisma.user.create({
      data: { email: data.email, nombre: data.nombre, passwordHash, rolId: data.rolId, almacenId: data.almacenId, clienteId: data.clienteId },
      include: { rol: { select: { nombre: true } } },
    });
  }

  @Put('users/:id')
  @ApiOperation({ summary: 'Actualizar usuario' })
  async updateUser(@Param('id') id: string, @Body() data: any) {
    const updateData: any = {};
    if (data.nombre) updateData.nombre = data.nombre;
    if (data.email) updateData.email = data.email;
    if (data.rolId !== undefined) updateData.rolId = data.rolId;
    if (data.almacenId !== undefined) updateData.almacenId = data.almacenId;
    if (data.clienteId !== undefined) updateData.clienteId = data.clienteId;
    if (data.activo !== undefined) updateData.activo = data.activo;
    if (data.password) updateData.passwordHash = await bcrypt.hash(data.password, 10);

    return this.prisma.user.update({
      where: { id },
      data: updateData,
      include: { rol: { select: { nombre: true } } },
    });
  }

  @Delete('users/:id')
  @ApiOperation({ summary: 'Desactivar usuario' })
  async deactivateUser(@Param('id') id: string) {
    return this.prisma.user.update({ where: { id }, data: { activo: false } });
  }

  // ============ ROLES ============
  @Get('roles')
  @ApiOperation({ summary: 'Listar roles con permisos' })
  async getRoles() {
    return this.prisma.role.findMany({
      include: { permisos: true, _count: { select: { usuarios: true } } },
      orderBy: { nivel: 'asc' },
    });
  }

  @Post('roles')
  @ApiOperation({ summary: 'Crear rol' })
  async createRole(@Body() data: { nombre: string; descripcion?: string; nivel?: number; permisos?: { modulo: string; accion: string }[] }) {
    return this.prisma.role.create({
      data: {
        nombre: data.nombre,
        descripcion: data.descripcion,
        nivel: data.nivel || 5,
        permisos: data.permisos ? { create: data.permisos } : undefined,
      },
      include: { permisos: true },
    });
  }

  @Put('roles/:id/permisos')
  @ApiOperation({ summary: 'Actualizar permisos de un rol' })
  async updateRolePermissions(@Param('id') id: string, @Body() data: { permisos: { modulo: string; accion: string }[] }) {
    await this.prisma.rolePermission.deleteMany({ where: { rolId: id } });
    await this.prisma.rolePermission.createMany({
      data: data.permisos.map(p => ({ rolId: id, modulo: p.modulo, accion: p.accion })),
    });
    return this.prisma.role.findUnique({ where: { id }, include: { permisos: true } });
  }

  // ============ PLATFORM SETTINGS ============
  @Get('settings')
  @ApiOperation({ summary: 'Obtener configuración de plataforma' })
  async getSettings() {
    let settings = await this.prisma.platformSettings.findFirst();
    if (!settings) {
      settings = await this.prisma.platformSettings.create({
        data: { nombre: 'Giving Out WMS', subtitulo: 'Sistema de Gestión de Almacén' },
      });
    }
    return settings;
  }

  @Put('settings')
  @ApiOperation({ summary: 'Actualizar configuración de plataforma' })
  async updateSettings(@Body() data: any) {
    const existing = await this.prisma.platformSettings.findFirst();
    if (existing) {
      return this.prisma.platformSettings.update({ where: { id: existing.id }, data });
    }
    return this.prisma.platformSettings.create({ data });
  }

  // ============ AUDIT LOG ============
  @Get('audit-log')
  @ApiOperation({ summary: 'Consultar historial de auditoría' })
  async getAuditLog() {
    return this.prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }
}
