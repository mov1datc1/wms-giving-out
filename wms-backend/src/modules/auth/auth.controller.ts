import { Controller, Post, Get, Body, Headers, HttpException, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { PrismaService } from '../../prisma.service';
import * as bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'giving-out-wms-secret-2026';

@ApiTags('Auth')
@Controller('api/auth')
export class AuthController {
  constructor(private prisma: PrismaService) {}

  @Post('login')
  @ApiOperation({ summary: 'Login con email y contraseña' })
  async login(@Body() body: { email: string; password: string }) {
    const user = await this.prisma.user.findUnique({
      where: { email: body.email },
      include: {
        rol: { include: { permisos: true } },
      },
    });

    if (!user || !user.activo) {
      throw new HttpException('Credenciales inválidas', HttpStatus.UNAUTHORIZED);
    }

    const valid = await bcrypt.compare(body.password, user.passwordHash);
    if (!valid) {
      throw new HttpException('Credenciales inválidas', HttpStatus.UNAUTHORIZED);
    }

    const isSuperAdmin = user.rol?.nombre === 'Super Admin';
    const permisos = user.rol?.permisos?.map(p => `${p.modulo}:${p.accion}`) || [];
    const modulos = [...new Set(user.rol?.permisos?.map(p => p.modulo) || [])];

    const token = jwt.sign(
      { userId: user.id, email: user.email, rol: user.rol?.nombre },
      JWT_SECRET,
      { expiresIn: '24h' },
    );

    await this.prisma.auditLog.create({
      data: { usuario: user.email, accion: 'LOGIN', entidad: 'User', entidadId: user.id },
    });

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        nombre: user.nombre,
        rolId: user.rolId,
        rolNombre: user.rol?.nombre || null,
        almacenId: user.almacenId,
        clienteId: user.clienteId,
        isSuperAdmin,
        permisos: modulos,  // Module-level for sidebar
        permisosDetalle: permisos,  // Granular for actions
      },
    };
  }

  @Post('otp/request')
  @ApiOperation({ summary: 'Solicitar código OTP por email' })
  async requestOtp(@Body() body: { email: string }) {
    const user = await this.prisma.user.findUnique({ where: { email: body.email } });
    if (!user || !user.activo) {
      return { success: true, message: 'Si el email existe, se envió el código' };
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    await this.prisma.otpCode.create({
      data: {
        email: body.email,
        code,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    });

    // TODO: Send email via nodemailer
    console.log(`📧 OTP para ${body.email}: ${code}`);

    return { success: true, message: 'Código enviado al email registrado' };
  }

  @Post('otp/verify')
  @ApiOperation({ summary: 'Verificar código OTP' })
  async verifyOtp(@Body() body: { email: string; code: string }) {
    const otp = await this.prisma.otpCode.findFirst({
      where: {
        email: body.email,
        code: body.code,
        used: false,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!otp) {
      throw new HttpException('Código inválido o expirado', HttpStatus.UNAUTHORIZED);
    }

    await this.prisma.otpCode.update({ where: { id: otp.id }, data: { used: true } });

    const user = await this.prisma.user.findUnique({
      where: { email: body.email },
      include: { rol: { include: { permisos: true } } },
    });

    if (!user) throw new HttpException('Usuario no encontrado', HttpStatus.NOT_FOUND);

    const isSuperAdmin = user.rol?.nombre === 'Super Admin';
    const modulos = [...new Set(user.rol?.permisos?.map(p => p.modulo) || [])];

    const token = jwt.sign(
      { userId: user.id, email: user.email, rol: user.rol?.nombre },
      JWT_SECRET,
      { expiresIn: '24h' },
    );

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        nombre: user.nombre,
        rolId: user.rolId,
        rolNombre: user.rol?.nombre || null,
        almacenId: user.almacenId,
        clienteId: user.clienteId,
        isSuperAdmin,
        permisos: modulos,
      },
    };
  }

  @Get('me')
  @ApiOperation({ summary: 'Verificar token y obtener usuario actual' })
  async me(@Headers('authorization') auth: string) {
    if (!auth?.startsWith('Bearer ')) {
      throw new HttpException('Token requerido', HttpStatus.UNAUTHORIZED);
    }

    try {
      const decoded: any = jwt.verify(auth.replace('Bearer ', ''), JWT_SECRET);
      const user = await this.prisma.user.findUnique({
        where: { id: decoded.userId },
        include: { rol: { include: { permisos: true } } },
      });

      if (!user || !user.activo) {
        throw new HttpException('Sesión inválida', HttpStatus.UNAUTHORIZED);
      }

      const isSuperAdmin = user.rol?.nombre === 'Super Admin';
      const modulos = [...new Set(user.rol?.permisos?.map(p => p.modulo) || [])];

      return {
        id: user.id,
        email: user.email,
        nombre: user.nombre,
        rolId: user.rolId,
        rolNombre: user.rol?.nombre || null,
        almacenId: user.almacenId,
        clienteId: user.clienteId,
        isSuperAdmin,
        permisos: modulos,
      };
    } catch {
      throw new HttpException('Token inválido', HttpStatus.UNAUTHORIZED);
    }
  }
}
