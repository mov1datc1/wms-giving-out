import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum GiroComercial {
  ROPA = 'ROPA',
  COMIDA = 'COMIDA',
  FARMACEUTICO = 'FARMACEUTICO',
  MAQUILA = 'MAQUILA',
  ELECTRONICA = 'ELECTRONICA',
  COSMETICOS = 'COSMETICOS',
  GENERAL = 'GENERAL',
}

export enum ReglaInventarioRotacion {
  FIFO = 'FIFO',
  FEFO = 'FEFO',
  LIFO = 'LIFO',
}

export enum UnidadManejoPrincipal {
  PZA = 'PZA',
  CAJA = 'CAJA',
  PALLET = 'PALLET',
  MASTER = 'MASTER',
}

export enum ManejoInventario {
  PIEZA = 'PIEZA',
  CAJA = 'CAJA',
  PALLET = 'PALLET',
  MIXTO = 'MIXTO',
}

/**
 * Función canónica para derivar las reglas operativas obligatorias según el giro de negocio
 */
export function getDefaultRulesForGiro(giro?: string) {
  const g = giro?.trim().toUpperCase();
  if (g === 'COMIDA' || g === 'ALIMENTOS') {
    return {
      requiereLote: true,
      requiereCaducidad: true,
      reglaInventario: ReglaInventarioRotacion.FEFO,
      uomPrincipal: UnidadManejoPrincipal.CAJA,
      manejoInventario: ManejoInventario.CAJA,
    };
  }
  if (g === 'FARMACEUTICO') {
    return {
      requiereLote: true,
      requiereCaducidad: true,
      reglaInventario: ReglaInventarioRotacion.FEFO,
      uomPrincipal: UnidadManejoPrincipal.PZA,
      manejoInventario: ManejoInventario.PIEZA,
    };
  }
  if (g === 'MAQUILA') {
    return {
      requiereLote: true,
      requiereCaducidad: false,
      reglaInventario: ReglaInventarioRotacion.FIFO,
      uomPrincipal: UnidadManejoPrincipal.PZA,
      manejoInventario: ManejoInventario.PIEZA,
    };
  }
  if (g === 'ELECTRONICA') {
    return {
      requiereLote: true,
      requiereSerie: true,
      requiereCaducidad: false,
      reglaInventario: ReglaInventarioRotacion.FIFO,
      uomPrincipal: UnidadManejoPrincipal.PZA,
      manejoInventario: ManejoInventario.PIEZA,
    };
  }
  // Por defecto (ROPA, GENERAL, COSMETICOS)
  return {
    requiereLote: false,
    requiereCaducidad: false,
    reglaInventario: ReglaInventarioRotacion.FIFO,
    uomPrincipal: UnidadManejoPrincipal.PZA,
    manejoInventario: ManejoInventario.PIEZA,
  };
}

export class CreateClientDto {
  @ApiProperty({
    description: 'Código único de identificación del depositante (3PL)',
    example: 'DEP-ALIMENTOS-02',
  })
  codigo: string;

  @ApiProperty({
    description: 'Nombre comercial de la marca o empresa depositante',
    example: 'Distribuidora San Juan',
  })
  nombreComercial: string;

  @ApiProperty({
    description: 'Razón social oficial para efectos de facturación y contratos 3PL',
    example: 'Distribuidora de Alimentos San Juan S.A. de C.V.',
  })
  razonSocial: string;

  @ApiPropertyOptional({
    description: 'Registro Federal de Contribuyentes (RFC)',
    example: 'DAS190412AB3',
  })
  rfc?: string;

  @ApiProperty({
    description: 'Giro o sector comercial de la empresa',
    enum: GiroComercial,
    example: GiroComercial.COMIDA,
  })
  giro: string;

  @ApiPropertyOptional({
    description: 'Dirección fiscal completa',
    example: 'Av. Insurgentes Sur 1602, Crédito Constructor, Benito Juárez',
  })
  direccionFiscal?: string;

  @ApiPropertyOptional({
    description: 'Ciudad fiscal',
    example: 'Ciudad de México',
  })
  ciudad?: string;

  @ApiPropertyOptional({
    description: 'Estado de la República o Provincia',
    example: 'CDMX',
  })
  estado?: string;

  @ApiPropertyOptional({
    description: 'Código postal fiscal',
    example: '03940',
  })
  codigoPostal?: string;

  @ApiPropertyOptional({
    description: 'País de residencia fiscal',
    example: 'México',
    default: 'México',
  })
  pais?: string;

  @ApiPropertyOptional({
    description: 'Régimen fiscal ante el SAT (ej. 601 General de Ley Personas Morales)',
    example: '601',
  })
  regimenFiscal?: string;

  @ApiPropertyOptional({
    description: 'Clave de uso de CFDI preferente (ej. G03 Gastos en general)',
    example: 'G03',
  })
  cfdiDefault?: string;

  @ApiPropertyOptional({
    description: 'Teléfono de contacto principal o conmutador',
    example: '55-1234-5678',
  })
  telefono?: string;

  @ApiPropertyOptional({
    description: 'Correo electrónico de contacto operativo',
    example: 'contacto@sanjuanalimentos.com',
  })
  email?: string;

  @ApiPropertyOptional({
    description: 'Nombre y apellido del contacto operativo principal',
    example: 'Lic. Roberto Mendoza',
  })
  contactoPrincipal?: string;

  @ApiPropertyOptional({
    description: 'Sitio web corporativo del depositante',
    example: 'https://sanjuanalimentos.com',
  })
  sitioWeb?: string;

  // ============ REGLAS OPERATIVAS 3PL ============
  @ApiPropertyOptional({
    description: 'Unidad de medida principal para almacenaje y conteo',
    enum: UnidadManejoPrincipal,
    default: UnidadManejoPrincipal.PZA,
  })
  uomPrincipal?: string;

  @ApiPropertyOptional({
    description: 'Modalidad de manejo en almacén (PIEZA, CAJA, PALLET, MIXTO)',
    enum: ManejoInventario,
    default: ManejoInventario.PIEZA,
  })
  manejoInventario?: string;

  @ApiPropertyOptional({
    description: 'Política estricta de rotación de inventario (FIFO / FEFO / LIFO)',
    enum: ReglaInventarioRotacion,
    default: ReglaInventarioRotacion.FIFO,
  })
  reglaInventario?: string;

  @ApiPropertyOptional({
    description: 'Indica si cada pieza física debe ser escaneada individualmente con lector láser',
    default: false,
  })
  escaneoIndividual?: boolean;

  @ApiPropertyOptional({
    description: 'Indica si los pedidos requieren visto bueno de Giving Out antes de pasar a picking',
    default: true,
  })
  requiereAprobacion?: boolean;

  @ApiPropertyOptional({
    description: 'Exige número de lote obligatorio en cada entrada de almacén',
    default: false,
  })
  requiereLote?: boolean;

  @ApiPropertyOptional({
    description: 'Exige número de serie único por unidad física',
    default: false,
  })
  requiereSerie?: boolean;

  @ApiPropertyOptional({
    description: 'Exige fecha de caducidad obligatoria vigente (NOM-251 / COFEPRIS)',
    default: false,
  })
  requiereCaducidad?: boolean;

  @ApiPropertyOptional({
    description: 'Alias de requiereCaducidad',
    default: false,
  })
  manejaCaducidad?: boolean;

  @ApiPropertyOptional({
    description: 'Color hexadecimal distintivo para el portal web del cliente',
    example: '#0D9488',
  })
  colorPortal?: string;

  @ApiPropertyOptional({
    description: 'URL del logotipo de la empresa',
    example: 'https://sanjuanalimentos.com/logo.png',
  })
  logoUrl?: string;
}

export class UpdateClientDto {
  @ApiPropertyOptional({ description: 'Nombre comercial' })
  nombreComercial?: string;

  @ApiPropertyOptional({ description: 'Razón social' })
  razonSocial?: string;

  @ApiPropertyOptional({ description: 'RFC' })
  rfc?: string;

  @ApiPropertyOptional({ description: 'Giro comercial', enum: GiroComercial })
  giro?: string;

  @ApiPropertyOptional({ description: 'Dirección fiscal' })
  direccionFiscal?: string;

  @ApiPropertyOptional({ description: 'Ciudad' })
  ciudad?: string;

  @ApiPropertyOptional({ description: 'Estado' })
  estado?: string;

  @ApiPropertyOptional({ description: 'Código postal' })
  codigoPostal?: string;

  @ApiPropertyOptional({ description: 'País' })
  pais?: string;

  @ApiPropertyOptional({ description: 'Régimen fiscal' })
  regimenFiscal?: string;

  @ApiPropertyOptional({ description: 'Uso CFDI preferente' })
  cfdiDefault?: string;

  @ApiPropertyOptional({ description: 'Teléfono' })
  telefono?: string;

  @ApiPropertyOptional({ description: 'Correo electrónico' })
  email?: string;

  @ApiPropertyOptional({ description: 'Contacto principal' })
  contactoPrincipal?: string;

  @ApiPropertyOptional({ description: 'Sitio Web' })
  sitioWeb?: string;

  @ApiPropertyOptional({ description: 'Estado activo/inactivo' })
  activo?: boolean;

  // Reglas
  @ApiPropertyOptional({ description: 'UOM principal', enum: UnidadManejoPrincipal })
  uomPrincipal?: string;

  @ApiPropertyOptional({ description: 'Manejo de inventario', enum: ManejoInventario })
  manejoInventario?: string;

  @ApiPropertyOptional({ description: 'Regla de inventario', enum: ReglaInventarioRotacion })
  reglaInventario?: string;

  @ApiPropertyOptional({ description: 'Escaneo individual' })
  escaneoIndividual?: boolean;

  @ApiPropertyOptional({ description: 'Requiere aprobación de pedidos' })
  requiereAprobacion?: boolean;

  @ApiPropertyOptional({ description: 'Requiere lote' })
  requiereLote?: boolean;

  @ApiPropertyOptional({ description: 'Requiere serie' })
  requiereSerie?: boolean;

  @ApiPropertyOptional({ description: 'Requiere caducidad' })
  requiereCaducidad?: boolean;

  @ApiPropertyOptional({ description: 'Alias maneja caducidad' })
  manejaCaducidad?: boolean;

  @ApiPropertyOptional({ description: 'Color del portal' })
  colorPortal?: string;

  @ApiPropertyOptional({ description: 'Logo URL' })
  logoUrl?: string;
}

export class UpdateClientConfigDto {
  @ApiPropertyOptional({ description: 'UOM Principal', enum: UnidadManejoPrincipal })
  uomPrincipal?: string;

  @ApiPropertyOptional({ description: 'Manejo de inventario', enum: ManejoInventario })
  manejoInventario?: string;

  @ApiPropertyOptional({ description: 'Regla de inventario rotación', enum: ReglaInventarioRotacion })
  reglaInventario?: string;

  @ApiPropertyOptional({ description: 'Escaneo individual' })
  escaneoIndividual?: boolean;

  @ApiPropertyOptional({ description: 'Requiere aprobación de pedidos' })
  requiereAprobacion?: boolean;

  @ApiPropertyOptional({ description: 'Requiere lote' })
  requiereLote?: boolean;

  @ApiPropertyOptional({ description: 'Requiere serie' })
  requiereSerie?: boolean;

  @ApiPropertyOptional({ description: 'Requiere caducidad' })
  requiereCaducidad?: boolean;

  @ApiPropertyOptional({ description: 'Maneja caducidad (alias)' })
  manejaCaducidad?: boolean;

  @ApiPropertyOptional({ description: 'Zona preferente en almacén' })
  zonaAsignadaId?: string;

  @ApiPropertyOptional({ description: 'Color del portal' })
  colorPortal?: string;

  @ApiPropertyOptional({ description: 'Logo URL' })
  logoUrl?: string;
}
