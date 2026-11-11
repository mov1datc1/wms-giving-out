import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'wms_is_public';
export const ACCESS_REQUIREMENT_KEY = 'wms_access_requirement';

export interface AccessRequirement {
  modules?: string[];
  actions?: string[];
  allowPortal?: boolean;
}

export interface AuthenticatedRequestUser {
  id: string;
  email: string;
  nombre: string;
  rolId: string | null;
  rolNombre: string | null;
  rolNivel: number | null;
  almacenId: string | null;
  clienteId: string | null;
  isSuperAdmin: boolean;
  modulos: string[];
  permisosDetalle: string[];
}

export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const RequireAccess = (requirement: AccessRequirement) =>
  SetMetadata(ACCESS_REQUIREMENT_KEY, requirement);
