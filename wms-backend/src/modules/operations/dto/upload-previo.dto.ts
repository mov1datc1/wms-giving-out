import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO para la creación y carga dual de previo mediante formulario manual o subida de archivo Excel (Sprint #2)
 */
export class UploadPrevioDto {
  @ApiProperty({
    description: 'ID del cliente depositante dueño de la mercancía (opcional si el Excel contiene códigos de SKUs que permiten su auto-detección)',
    example: 'ba453845-913f-47c8-b08e-b3f30874722f',
    required: false,
  })
  clienteId?: string;

  @ApiPropertyOptional({
    description: 'Factura comercial o fiscal que ampara la entrada (si se omite, se extrae del archivo Excel)',
    example: 'FAC-2026-89421',
  })
  facturaRespaldo?: string;

  @ApiPropertyOptional({
    description: 'Orden de compra o referencia administrativa complementaria',
    example: 'OC-2026-99',
  })
  ocReferencia?: string;

  @ApiPropertyOptional({
    description: 'Origen del arribo de la mercancía',
    enum: ['NACIONAL', 'IMPORTACION'],
    default: 'NACIONAL',
    example: 'NACIONAL',
  })
  origen?: string;

  @ApiPropertyOptional({
    description: 'Tipo de importación / régimen aduanal',
    enum: ['DEFINITIVA', 'TEMPORAL', 'TRANSITO', 'DEPOSITO_FISCAL', 'VIRTUAL', 'NO_APLICA'],
    default: 'NO_APLICA',
    example: 'NO_APLICA',
  })
  tipoImportacion?: string;

  @ApiPropertyOptional({
    description: 'Modalidad de la operación en andén',
    enum: ['NORMAL', 'DEVOLUCION', 'TRANSFERENCIA'],
    default: 'NORMAL',
    example: 'NORMAL',
  })
  tipoRecepcion?: string;

  @ApiPropertyOptional({
    description: 'Línea de transporte de carga',
    example: 'TEMPAQ',
  })
  lineaTransporte?: string;

  @ApiPropertyOptional({
    description: 'Capacidad o tipo de la unidad de transporte',
    example: 'CAMION 3.5 TONELADA',
  })
  capacidadCarga?: string;

  @ApiPropertyOptional({
    description: 'Placa de la unidad de transporte',
    example: '7851ZP',
  })
  placa?: string;

  @ApiPropertyOptional({
    description: 'Nombre completo del chofer transportista',
    example: 'BRYAN CID ANGELES',
  })
  nombreChofer?: string;

  @ApiPropertyOptional({
    description: 'Folio de transporte para tracking y código de barras Code-128',
    example: '23120690080',
  })
  folioTransporte?: string;

  @ApiPropertyOptional({
    description: 'Notas u observaciones operativas',
    example: 'Entrega prioritaria de andén 2',
  })
  notas?: string;

  @ApiPropertyOptional({
    type: 'string',
    format: 'binary',
    description: 'Archivo Excel (.xlsx, .xls) con columnas factura, Ean y Cantidad a recibir',
  })
  file?: any;

  @ApiPropertyOptional({
    description: 'Líneas manuales en formato JSON string o arreglo (cuando no se adjunta archivo Excel)',
    example: '[{"skuId":"ba453845-913f-47c8-b08e-b3f30874722f","cantidadEsperada":100}]',
  })
  lineas?: any;
}
