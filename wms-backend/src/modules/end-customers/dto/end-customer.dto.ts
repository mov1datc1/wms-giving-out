import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateEndCustomerDto {
  @ApiProperty({ description: 'ID del depositante propietario del destino' })
  clienteId: string;

  @ApiProperty({ description: 'Código único del destino por depositante', example: 'SANBORNS-REFORMA' })
  codigo: string;

  @ApiProperty({ description: 'Nombre del destino / tienda / cedis', example: 'Sanborns Reforma' })
  nombre: string;

  @ApiPropertyOptional()
  razonSocial?: string;

  @ApiPropertyOptional()
  rfc?: string;

  @ApiPropertyOptional()
  contacto?: string;

  @ApiPropertyOptional()
  telefono?: string;

  @ApiPropertyOptional()
  email?: string;

  @ApiPropertyOptional()
  calle?: string;

  @ApiPropertyOptional()
  colonia?: string;

  @ApiPropertyOptional()
  ciudad?: string;

  @ApiPropertyOptional()
  estado?: string;

  @ApiPropertyOptional()
  codigoPostal?: string;

  @ApiPropertyOptional()
  referencia?: string;

  @ApiPropertyOptional()
  instruccionesEntrega?: string;

  @ApiPropertyOptional({ default: false })
  requiereFactura?: boolean;
}

export class UpdateEndCustomerDto {
  @ApiPropertyOptional()
  codigo?: string;

  @ApiPropertyOptional()
  nombre?: string;

  @ApiPropertyOptional()
  razonSocial?: string;

  @ApiPropertyOptional()
  rfc?: string;

  @ApiPropertyOptional()
  contacto?: string;

  @ApiPropertyOptional()
  telefono?: string;

  @ApiPropertyOptional()
  email?: string;

  @ApiPropertyOptional()
  calle?: string;

  @ApiPropertyOptional()
  colonia?: string;

  @ApiPropertyOptional()
  ciudad?: string;

  @ApiPropertyOptional()
  estado?: string;

  @ApiPropertyOptional()
  codigoPostal?: string;

  @ApiPropertyOptional()
  referencia?: string;

  @ApiPropertyOptional()
  instruccionesEntrega?: string;

  @ApiPropertyOptional()
  requiereFactura?: boolean;

  @ApiPropertyOptional()
  activo?: boolean;
}
