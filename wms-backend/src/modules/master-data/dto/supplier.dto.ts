import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateSupplierDto {
  @ApiProperty({ description: 'Código único del proveedor', example: 'PROV-006' })
  codigo: string;

  @ApiProperty({ description: 'Nombre o razón social del proveedor', example: 'Distribuidora del Valle S.A.' })
  nombre: string;

  @ApiPropertyOptional()
  rfc?: string;

  @ApiPropertyOptional()
  telefono?: string;

  @ApiPropertyOptional()
  email?: string;

  @ApiPropertyOptional()
  direccion?: string;

  @ApiPropertyOptional()
  contacto?: string;
}

export class UpdateSupplierDto {
  @ApiPropertyOptional()
  codigo?: string;

  @ApiPropertyOptional()
  nombre?: string;

  @ApiPropertyOptional()
  rfc?: string;

  @ApiPropertyOptional()
  telefono?: string;

  @ApiPropertyOptional()
  email?: string;

  @ApiPropertyOptional()
  direccion?: string;

  @ApiPropertyOptional()
  contacto?: string;

  @ApiPropertyOptional()
  activo?: boolean;
}
