import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO para cada línea de SKU esperado en la recepción previa
 */
export class PrevioLineItemDto {
  @ApiProperty({
    description: 'ID único del SKU registrado en el catálogo maestro SkuMaster',
    example: 'c1234567-89ab-cdef-0123-456789abcdef',
    required: true,
  })
  skuId: string;

  @ApiProperty({
    description: 'Cantidad física esperada de unidades según factura de respaldo o manifiesto (debe ser > 0)',
    example: 120,
    minimum: 1,
    required: true,
  })
  cantidadEsperada: number;

  @ApiPropertyOptional({
    description: 'Folio o número de bulto individual / caja de origen',
    example: '18966',
  })
  folio?: string;

  @ApiPropertyOptional({
    description: 'Código de sucursal, tienda o centro de distribución de procedencia',
    example: 'N1050001',
  })
  sucursal?: string;

  @ApiPropertyOptional({
    description: 'Tipo de contenedor físico (Caja devolución, Tarima, Caja máster, Bolsa)',
    example: 'Caja máster',
    default: 'Caja máster',
  })
  tipoContenedor?: string;

  @ApiPropertyOptional({
    description: 'Unidad de medida esperada para control en inventario',
    example: 'PZA',
    default: 'PZA',
  })
  uom?: string;

  @ApiPropertyOptional({
    description: 'Valor comercial o costo unitario según factura de respaldo (MXN / USD)',
    example: 250.50,
  })
  precioUnitario?: number;

  @ApiPropertyOptional({
    description: 'Lote de fabricación esperado (requerido si el depositante lo exige)',
    example: 'LOT-2026-09',
  })
  loteEsperado?: string;

  @ApiPropertyOptional({
    description: 'Fecha de caducidad estimada (YYYY-MM-DD)',
    example: '2027-12-31',
  })
  fechaCaducidadEsperada?: string;

  @ApiPropertyOptional({
    description: 'Observaciones particulares de esta partida física',
    example: 'Prendas con empaque primario sellado',
  })
  notas?: string;
}

/**
 * DTO para agregar una partida individual a un previo existente
 */
export class AddPrevioLineDto {
  @ApiProperty({
    description: 'ID único del SKU a ingresar al previo (debe pertenecer al depositante de la recepción)',
    example: 'c1234567-89ab-cdef-0123-456789abcdef',
    required: true,
  })
  skuId: string;

  @ApiProperty({
    description: 'Cantidad física esperada a recibir (entero o decimal mayor a 0)',
    example: 50,
    minimum: 1,
    required: true,
  })
  cantidadEsperada: number;

  @ApiPropertyOptional({
    description: 'Tipo de contenedor físico',
    example: 'Caja máster',
  })
  tipoContenedor?: string;

  @ApiPropertyOptional({
    description: 'Unidad de medida base',
    example: 'PZA',
    default: 'PZA',
  })
  uom?: string;

  @ApiPropertyOptional({
    description: 'Lote esperado de fabricación',
    example: 'LOTE-2026-A',
  })
  loteEsperado?: string;

  @ApiPropertyOptional({
    description: 'Folio o caja de procedencia',
    example: 'B-042',
  })
  folio?: string;

  @ApiPropertyOptional({
    description: 'Sucursal o tienda de procedencia',
    example: 'SUC-01',
  })
  sucursal?: string;

  @ApiPropertyOptional({
    description: 'Notas u observaciones de la partida',
    example: 'Partida adicional autorizada por compras',
  })
  notas?: string;
}

/**
 * DTO para actualizar la bandera de estatus operacional de una recepción (Tarea 5)
 */
export class UpdateReceiptStatusDto {
  @ApiProperty({
    description: 'Nuevo estatus operacional de la recepción',
    enum: ['PENDIENTE_ARRIBO', 'EN_PROCESO_CONTEO', 'CERRADA'],
    example: 'EN_PROCESO_CONTEO',
    required: true,
  })
  estado: string;

  @ApiPropertyOptional({
    description: 'Nombre o correo del usuario supervisor que autoriza la transición',
    example: 'supervisor@givingout.com',
  })
  usuario?: string;

  @ApiPropertyOptional({
    description: 'Motivo u observación del cambio de estatus para bitácora de auditoría',
    example: 'Arribo confirmado en bahía de descarga andén 3',
  })
  motivo?: string;
}

/**
 * DTO para confirmar arribo y activar candado operativo de edición (Tarea 3)
 */
export class LockReceiptDto {
  @ApiPropertyOptional({
    description: 'Usuario u operador que confirma el arribo de la unidad',
    example: 'operador_anden@givingout.com',
    default: 'Supervisor WMS',
  })
  usuario?: string;
}

/**
 * DTO para desbloqueo controlado por supervisor (Tarea 3)
 */
export class UnlockReceiptDto {
  @ApiPropertyOptional({
    description: 'Usuario supervisor con privilegios que autoriza el desbloqueo',
    example: 'admin@givingout.com',
  })
  usuario?: string;

  @ApiProperty({
    description: 'Justificación obligatoria para la bitácora de auditoría inmutable',
    example: 'Corrección de cantidad esperada autorizada por cliente vía correo',
    required: true,
  })
  motivo: string;
}

/**
 * DTO para resolución de discrepancias en cierre (Tarea 5)
 */
export class DiscrepancyResolutionDto {
  @ApiProperty({
    description: 'ID de la línea de recepción con discrepancia',
    example: 'line-uuid-1234',
    required: true,
  })
  lineId: string;

  @ApiPropertyOptional({
    description: 'Código del SKU asociado a la discrepancia',
    example: 'SKU-001',
  })
  sku?: string;

  @ApiProperty({
    description: 'Clasificación oficial del estatus de la discrepancia (FALTANTE_PROVEEDOR, DANO_TRANSPORTE, SOBRANTE_BONIFICACION, RECHAZADO_EN_ANDEN, CUARENTENA_CALIDAD, DIFERENCIA_DOCUMENTAL, OTRO_JUSTIFICADO)',
    example: 'FALTANTE_PROVEEDOR',
    required: true,
  })
  clasificacion: string;

  @ApiProperty({
    description: 'Justificación o motivo detallado que ampara la discrepancia física',
    example: 'Proveedor no surtió partida completa por falta de stock en planta matriz',
    required: true,
  })
  justificacion: string;
}

/**
 * DTO para cierre definitivo de recepción (Tarea 3 / Tarea 5)
 */
export class CloseReceiptDto {
  @ApiProperty({
    description: 'Usuario responsable que valida el conteo y autoriza el cierre',
    example: 'jefe_almacen@givingout.com',
    required: true,
  })
  usuario: string;

  @ApiPropertyOptional({
    description: 'Notas u observaciones finales de cierre para el reporte de discrepancias',
    example: 'Cierre total con 2 pzas dañadas asentadas en merma',
  })
  notasCierre?: string;

  @ApiPropertyOptional({
    description: 'Resolución obligatoria de discrepancias activas (requerido si existen diferencias físicas)',
    type: [DiscrepancyResolutionDto],
  })
  discrepancias?: DiscrepancyResolutionDto[];

  @ApiPropertyOptional({
    description: 'Clasificación global de estatus de discrepancia para aplicar a todas las líneas desalineadas',
    example: 'FALTANTE_PROVEEDOR',
  })
  clasificacionGlobal?: string;

  @ApiPropertyOptional({
    description: 'Justificación global para aplicar a todas las líneas con diferencias',
    example: 'Factura con merma en trayecto amparada con acta de siniestro',
  })
  justificacionGlobal?: string;
}

/**
 * DTO Oficial del Modelo de Datos de Recepciones Previas (Sprint #2)
 */
export class CreateReceiptPrevioDto {
  @ApiProperty({
    description: 'ID único del cliente depositante dueño de la mercancía',
    example: 'ba453845-913f-47c8-b08e-b3f30874722f',
    required: true,
  })
  clienteId: string;

  @ApiProperty({
    description: 'Factura comercial, fiscal o manifiesto que ampara legalmente el ingreso',
    example: 'FAC-2026-89421',
    required: true,
  })
  facturaRespaldo: string;

  @ApiPropertyOptional({
    description: 'Orden de compra o referencia administrativa complementaria',
    example: 'OC-2026-99',
  })
  ocReferencia?: string;

  @ApiPropertyOptional({
    description: 'Tipo de importación / régimen aduanal',
    enum: ['DEFINITIVA', 'TEMPORAL', 'TRANSITO', 'DEPOSITO_FISCAL', 'VIRTUAL', 'NO_APLICA'],
    default: 'NO_APLICA',
    example: 'DEFINITIVA',
  })
  tipoImportacion?: string;

  @ApiPropertyOptional({
    description: 'Origen del arribo de la mercancía',
    enum: ['NACIONAL', 'IMPORTACION'],
    default: 'NACIONAL',
    example: 'IMPORTACION',
  })
  origen?: string;

  @ApiPropertyOptional({
    description: 'Modalidad de la operación en andén',
    enum: ['NORMAL', 'DEVOLUCION', 'TRANSFERENCIA'],
    default: 'NORMAL',
    example: 'NORMAL',
  })
  tipoRecepcion?: string;

  @ApiPropertyOptional({
    description: 'ID del proveedor o fabricante de procedencia',
    example: 'prov-123',
  })
  proveedorId?: string;

  @ApiPropertyOptional({
    description: 'Nombre o razón social del proveedor',
    example: 'Textiles del Norte S.A. de C.V.',
  })
  proveedorNombre?: string;

  @ApiPropertyOptional({
    description: 'Folio de transporte para tracking y código de barras Code-128',
    example: '23120690080',
  })
  folioTransporte?: string;

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
    description: 'Nombre completo del chofer u operador transportista',
    example: 'BRYAN CID ANGELES',
  })
  nombreChofer?: string;

  @ApiPropertyOptional({
    description: 'Fecha y hora estimada de arribo a bahía de descarga (ISO-8601)',
    example: '2026-09-18T08:00:00.000Z',
  })
  fechaArriboEstimada?: string;

  @ApiPropertyOptional({
    description: 'URL del archivo Excel o manifiesto original cargado',
    example: 'https://storage.givingout.com/previos/manifiesto-89421.xlsx',
  })
  archivoPrevioUrl?: string;

  @ApiPropertyOptional({
    description: 'Notas u observaciones operativas para la cuadrilla de andén',
    example: 'Descarga con montacargas eléctrico, tarimas emplayadas',
  })
  notas?: string;

  @ApiProperty({
    description: 'Lista detallada de partidas de SKUs esperados con cantidades programadas (mínimo 1 partida requerida)',
    type: [PrevioLineItemDto],
    required: true,
  })
  lineas: PrevioLineItemDto[];
}

/**
 * Esquema estándar de respuesta de error de la API (RFC-7807 / NestJS Standard)
 */
export class ApiErrorResponseDto {
  @ApiProperty({ description: 'Código de estado HTTP', example: 400 })
  statusCode: number;

  @ApiProperty({ description: 'Mensaje descriptivo del error para el usuario o integrador', example: 'Datos incompletos: El campo "clienteId" es obligatorio.' })
  message: string;

  @ApiProperty({ description: 'Nombre estándar del error HTTP', example: 'Bad Request' })
  error: string;

  @ApiPropertyOptional({
    description: 'Detalles complementarios o lista de campos faltantes/inválidos',
    example: { codigo: 'DATOS_INCOMPLETOS', campos: ['clienteId', 'lineas'] },
  })
  detalles?: any;
}

/**
 * DTO para cada partida individual dentro de la captura masiva por factura completa
 */
export class BatchReceptionLineItemDto {
  @ApiProperty({
    description: 'ID de la línea de recepción previa (ReceiptLine)',
    example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
    required: true,
  })
  receiptLineId: string;

  @ApiProperty({
    description: 'ID del SKU correspondiente',
    example: 'c1234567-89ab-cdef-0123-456789abcdef',
    required: true,
  })
  skuId: string;

  @ApiProperty({
    description: 'Cantidad física conforme recibida (aprobada para inventario disponible)',
    example: 50,
    default: 0,
  })
  cantidadConforme: number;

  @ApiPropertyOptional({
    description: 'Cantidad física no conforme o dañada (para desvío a cuarentena)',
    example: 2,
    default: 0,
  })
  cantidadNoConforme?: number;

  @ApiPropertyOptional({
    description: 'ID de la ubicación física de almacenamiento para producto conforme (ej. REC-01)',
  })
  ubicacionConformeId?: string;

  @ApiPropertyOptional({
    description: 'ID de la ubicación física para producto no conforme o dañado (ej. DEV-01 o MERMA-01)',
  })
  ubicacionNoConformeId?: string;

  @ApiPropertyOptional({
    description: 'Lote de fabricación o partida de producción',
    example: 'LOT-2026-09-A',
  })
  lote?: string;

  @ApiPropertyOptional({
    description: 'Fecha de vencimiento o caducidad (YYYY-MM-DD)',
    example: '2027-06-30',
  })
  fechaVencimiento?: string;

  @ApiPropertyOptional({
    description: 'Tipo de Handling Unit / contenedor (CAJA, PALLET, ATADO, BANDEJA)',
    example: 'CAJA',
    default: 'CAJA',
  })
  tipoHu?: string;

  @ApiPropertyOptional({
    description: 'Notas u observaciones particulares de esta partida',
    example: 'Empaque íntegro sin merma',
  })
  notas?: string;
}

/**
 * DTO para la captura masiva de recepción física por factura completa (Planilla Matricial)
 */
export class BatchReceptionDto {
  @ApiProperty({
    description: 'Usuario o auditor que ejecuta el conteo físico en andén',
    example: 'operador@givingout.com',
    required: true,
  })
  usuario: string;

  @ApiPropertyOptional({
    description: 'ID del almacén destino (si se omite se toma el almacén principal por defecto)',
  })
  almacenId?: string;

  @ApiPropertyOptional({
    description: 'Ubicación global por defecto para piezas conformes (ej. REC-01)',
  })
  ubicacionConformeId?: string;

  @ApiPropertyOptional({
    description: 'Ubicación global por defecto para piezas no conformes / dañadas (ej. DEV-01 o MERMA-01)',
  })
  ubicacionNoConformeId?: string;

  @ApiProperty({
    description: 'Arreglo con las partidas de la factura y sus cantidades físicas capturadas',
    type: [BatchReceptionLineItemDto],
    required: true,
  })
  lineas: BatchReceptionLineItemDto[];
}

