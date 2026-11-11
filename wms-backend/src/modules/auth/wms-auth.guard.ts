import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as jwt from 'jsonwebtoken';
import { PrismaService } from '../../prisma.service';
import {
  ACCESS_REQUIREMENT_KEY,
  AccessRequirement,
  AuthenticatedRequestUser,
  IS_PUBLIC_KEY,
} from './auth.decorators';

const JWT_SECRET = process.env.JWT_SECRET || 'giving-out-wms-secret-2026';

@Injectable()
export class WmsAuthGuard implements CanActivate {
  constructor(
    private prisma: PrismaService,
    private reflector?: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const reflector = this.reflector ?? new Reflector();
    const handler = context.getHandler();
    const cls = context.getClass();

    const isPublic = reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      handler,
      cls,
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const authHeader = request?.headers?.['authorization'];

    if (!authHeader || typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
      throw new HttpException(
        {
          statusCode: HttpStatus.UNAUTHORIZED,
          message: 'No autenticado: Token de sesión requerido',
          error: 'Unauthorized',
          codigo: 'TOKEN_REQUERIDO',
        },
        HttpStatus.UNAUTHORIZED,
      );
    }

    const token = authHeader.slice(7).trim();
    if (!token || token === 'demo-token') {
      throw new HttpException(
        {
          statusCode: HttpStatus.UNAUTHORIZED,
          message: 'Token de sesión inválido',
          error: 'Unauthorized',
          codigo: 'TOKEN_INVALIDO',
        },
        HttpStatus.UNAUTHORIZED,
      );
    }

    let decoded: any;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch {
      throw new HttpException(
        {
          statusCode: HttpStatus.UNAUTHORIZED,
          message: 'Token de sesión inválido o expirado',
          error: 'Unauthorized',
          codigo: 'TOKEN_EXPIRADO_O_INVALIDO',
        },
        HttpStatus.UNAUTHORIZED,
      );
    }

    const userId = decoded?.userId || decoded?.id;
    if (!userId) {
      throw new HttpException(
        {
          statusCode: HttpStatus.UNAUTHORIZED,
          message: 'Token inválido: falta identificador de usuario',
          error: 'Unauthorized',
          codigo: 'TOKEN_SIN_USUARIO',
        },
        HttpStatus.UNAUTHORIZED,
      );
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
      throw new HttpException(
        {
          statusCode: HttpStatus.UNAUTHORIZED,
          message: 'Sesión inválida: usuario inactivo o no encontrado',
          error: 'Unauthorized',
          codigo: 'USUARIO_INACTIVO_O_INEXISTENTE',
        },
        HttpStatus.UNAUTHORIZED,
      );
    }

    const isSuperAdmin =
      user.rol?.nombre === 'Super Admin' || user.rol?.nivel === 1;
    const rawPermisos = user.rol?.permisos || [];
    const modulos = [...new Set(rawPermisos.map((p: any) => p.modulo))];
    const permisosDetalle = rawPermisos.map((p: any) => `${p.modulo}:${p.accion}`);

    const authUser: AuthenticatedRequestUser = {
      id: user.id,
      email: user.email,
      nombre: user.nombre,
      rolId: user.rolId,
      rolNombre: user.rol?.nombre || null,
      rolNivel: user.rol?.nivel ?? null,
      almacenId: user.almacenId,
      clienteId: user.clienteId,
      isSuperAdmin,
      modulos,
      permisosDetalle,
    };

    request.user = authUser;

    const requirement = reflector.getAllAndOverride<AccessRequirement | undefined>(
      ACCESS_REQUIREMENT_KEY,
      [handler, cls],
    );

    if (!requirement || isSuperAdmin) {
      return true;
    }

    if (requirement.allowPortal === false && user.clienteId) {
      throw new HttpException(
        {
          statusCode: HttpStatus.FORBIDDEN,
          message: 'ACCESO_DENEGADO: Operación exclusiva para personal interno del almacén',
          error: 'Forbidden',
          codigo: 'ACCESO_PORTAL_NO_AUTORIZADO',
        },
        HttpStatus.FORBIDDEN,
      );
    }

    if (requirement.modules && requirement.modules.length > 0) {
      const hasPermission = rawPermisos.some((p: any) => {
        if (!requirement.modules!.includes(p.modulo)) return false;
        if (requirement.actions && requirement.actions.length > 0) {
          return requirement.actions.includes(p.accion);
        }
        return true;
      });

      if (!hasPermission) {
        throw new HttpException(
          {
            statusCode: HttpStatus.FORBIDDEN,
            message: `ACCESO_DENEGADO: Tu rol (${user.rol?.nombre || 'Sin Rol'}) no tiene autorización para esta operación`,
            error: 'Forbidden',
            codigo: 'PERMISO_INSUFICIENTE',
            modulosRequeridos: requirement.modules,
            accionesRequeridas: requirement.actions || [],
          },
          HttpStatus.FORBIDDEN,
        );
      }
    }

    return true;
  }
}
