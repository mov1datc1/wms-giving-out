import { Injectable, CanActivate, ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import * as jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'giving-out-wms-secret-2026';

@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers['authorization'];

    if (!authHeader || typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
      throw new HttpException('No autenticado: Token de sesión requerido', HttpStatus.UNAUTHORIZED);
    }

    const token = authHeader.replace('Bearer ', '').trim();
    let decoded: any;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch {
      throw new HttpException('Token de sesión inválido o expirado', HttpStatus.UNAUTHORIZED);
    }

    const userId = decoded.userId || decoded.id;
    if (!userId) {
      throw new HttpException('Token inválido: falta identificador de usuario', HttpStatus.UNAUTHORIZED);
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        rol: {
          include: {
            permisos: true,
          },
        },
      },
    });

    if (!user || !user.activo) {
      throw new HttpException('Sesión inválida: usuario inactivo o no encontrado', HttpStatus.UNAUTHORIZED);
    }

    const isSuperAdmin = user.rol?.nombre === 'Super Admin' || user.rol?.nivel === 1;
    const hasAdminPermission = user.rol?.permisos?.some(p => p.modulo === 'admin');

    if (!isSuperAdmin && !hasAdminPermission) {
      throw new HttpException('ACCESO_DENEGADO: Requiere privilegios administrativos del módulo admin o Super Admin', HttpStatus.FORBIDDEN);
    }

    request.user = user;
    return true;
  }
}
