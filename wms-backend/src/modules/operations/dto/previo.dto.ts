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

/**
 * DTO para el registro del Arribo a Rampa y Emisión de Acta de Chofer Exprés (Fase 1)
 */
export class RampaArriboDto {
  @ApiProperty({
    description: 'Total de bultos/cajas declarados según carta porte o factura de respaldo',
    example: 400,
    minimum: 0,
    required: true,
  })
  bultosDeclarados: number;

  @ApiProperty({
    description: 'Total de bultos/cajas efectivamente descargados y recibidos en rampa',
    example: 400,
    minimum: 0,
    required: true,
  })
  bultosRecibidos: number;

  @ApiProperty({
    description: 'Bultos que presentan daño exterior visible (cajas rotas, aplastadas o abiertas). Es un subconjunto de bultosRecibidos.',
    example: 10,
    minimum: 0,
    required: true,
  })
  bultosDanados: number;

  @ApiPropertyOptional({
    description: 'Observaciones del estado exterior de la carga y empaque en rampa',
    example: 'Se reciben 10 bultos con rotura visible en cinta y aplastamiento lateral',
  })
  observacionesRampa?: string;

  @ApiPropertyOptional({
    description: 'Andén o bahía de descarga asignada en el CEDIS',
    example: 'Andén 02',
  })
  andenAsignado?: string;

  @ApiPropertyOptional({
    description: 'Línea de transporte o fletera',
    example: 'TRANSPORTES CASTORES S.A. DE C.V.',
  })
  lineaTransporte?: string;

  @ApiPropertyOptional({
    description: 'Capacidad o tipo de unidad (ej. Rabón, Camión 3.5 Ton, Tráiler 53 pies)',
    example: 'CAMION 3.5 TONELADAS',
  })
  capacidadCarga?: string;

  @ApiPropertyOptional({
    description: 'Placas del vehículo de transporte',
    example: '7851-ZP',
  })
  placa?: string;

  @ApiPropertyOptional({
    description: 'Nombre completo del chofer u operador de transporte',
    example: 'BRYAN CID ANGELES',
  })
  nombreChofer?: string;

  @ApiPropertyOptional({
    description: 'Folio de carta porte, guía de embarque o remisión',
    example: '23120690080',
  })
  folioTransporte?: string;

  @ApiProperty({
    description: 'Firma digital en Base64 del chofer/transportista',
    example: 'data:image/svg+xml;base64,...',
    required: true,
  })
  firmaChofer: string;

  @ApiProperty({
    description: 'Firma digital en Base64 del receptor / supervisor de andén Giving Out',
    example: 'data:image/svg+xml;base64,...',
    required: true,
  })
  firmaReceptor: string;

  @ApiPropertyOptional({
    description: 'Nombre del supervisor o auditor de andén que recibió físicamente',
    example: 'Alejandra Martínez',
  })
  nombreReceptor?: string;

  @ApiPropertyOptional({
    description: 'Usuario del sistema que ejecuta la operación',
    example: 'supervisor@givingout.com',
  })
  usuario?: string;

  @ApiPropertyOptional({
    description: 'Motivo de corrección si se está rectificando un acta previamente firmada',
    example: 'Aclaración de placas por error tipográfico de transportista',
  })
  motivoCorreccion?: string;
}

/**
 * DTO para la clasificación física de cajas por partida en andén (conforme, daño exterior, faltante)
 */
export class LineaClasificacionDto {
  @ApiProperty({
    description: 'ID de la partida del previo (ReceiptLine)',
    example: '550e8400-e29b-41d4-a716-446655440000',
    required: true,
  })
  receiptLineId: string;

  @ApiPropertyOptional({
    description: 'Cajas físicas recibidas conformes',
    example: 1,
    default: 0,
  })
  cajasConformes?: number;

  @ApiPropertyOptional({
    description: 'Cajas físicas recibidas con daño exterior (subconjunto de recibidas)',
    example: 1,
    default: 0,
  })
  cajasDanadas?: number;

  @ApiPropertyOptional({
    description: 'Cajas faltantes que no llegaron físicamente en la unidad',
    example: 1,
    default: 0,
  })
  cajasFaltantes?: number;
}

/**
 * DTO para generar el Doble Etiquetado (Tarimas Master + Cajas Únicas)
 */
export class GenerateLabelsDto {
  @ApiPropertyOptional({
    description: 'Cantidad estimada de cajas que caben en una tarima master estándar',
    example: 40,
    default: 40,
  })
  cajasPorTarima?: number;

  @ApiPropertyOptional({
    description: 'Usuario que solicita la generación de etiquetas',
    example: 'supervisor@givingout.com',
  })
  usuario?: string;

  @ApiPropertyOptional({
    description: 'Forzar regeneración si ya existían etiquetas previas (por defecto false)',
    example: false,
    default: false,
  })
  forceRegenerate?: boolean;

  @ApiPropertyOptional({
    description: 'Desglose físico por partida para recepciones con faltantes o daños en rampa',
    type: [LineaClasificacionDto],
  })
  lineasClasificacion?: LineaClasificacionDto[];
}

/**
 * DTO para confirmar la colocación física de etiquetas en andén
 */
export class ConfirmPlacementDto {
  @ApiPropertyOptional({
    description: 'Usuario u operador de andén que confirma haber colocado físicamente las etiquetas',
    example: 'operador@givingout.com',
  })
  usuario?: string;

  @ApiPropertyOptional({
    description: 'Nombre del colocador de etiquetas',
    example: 'Jonathan Palacios',
  })
  colocadoPor?: string;

  @ApiPropertyOptional({
    description: 'Notas u observaciones del etiquetado físico',
    example: 'Etiquetas adheridas al 100% en todas las cajas y tarimas master',
  })
  notas?: string;
}

/**
 * DTO para la identificación física de un bulto/caja con daño exterior (Fase 2 - Paso Operativo)
 */
export class IdentifyDamagedBoxDto {
  @ApiProperty({ description: 'ID de la partida del previo a la que corresponde el bulto dañado', example: 'd3b07384-d113-4a11-9a99-0123456789ab' })
  receiptLineId: string;

  @ApiPropertyOptional({ description: 'Cantidad total de piezas contenidas en esta caja', example: 12 })
  piezasTotales?: number;

  @ApiPropertyOptional({ description: 'Lote físico impreso en la caja', example: 'LOTE-2026-A1' })
  loteTexto?: string;

  @ApiPropertyOptional({ description: 'Fecha de caducidad física de la caja' })
  fechaVencimiento?: string | Date;

  @ApiPropertyOptional({ description: 'Motivo u observación del daño exterior visible', example: 'Rotura de envase por compresión / estiba pesada' })
  motivoDano?: string;

  @ApiPropertyOptional({ description: 'Notas adicionales del operador o inspector' })
  observaciones?: string;

  @ApiPropertyOptional({ description: 'Usuario que identifica físicamente el bulto', example: 'Operador Andén / Calidad' })
  usuario?: string;
}

/**
 * DTO para dictamen unitario por caja en inspección interna
 */
export class ItemInspectionDictamenDto {
  @ApiProperty({ description: 'ID de la HandlingUnit (caja dañada) a inspeccionar', example: '26f72234-272e-47d4-ac1b-a0fd04c58d8f' })
  huId: string;

  @ApiProperty({ description: 'Cantidad total de piezas dentro de la caja', example: 12 })
  piezasTotales: number;

  @ApiProperty({ description: 'Cantidad de piezas conformes rescatadas sanas', example: 10 })
  piezasRescatadas: number;

  @ApiProperty({ description: 'Cantidad de piezas que no se pudieron salvar (merma definitiva)', example: 2 })
  piezasMerma: number;

  @ApiPropertyOptional({ description: 'Motivo del daño físico en empaque o piezas', example: 'Rotura de envase / fuga de líquido' })
  motivoDano?: string;

  @ApiPropertyOptional({ description: 'Notas u observaciones del inspector sobre esta caja' })
  observaciones?: string;
}

/**
 * DTO para ejecutar la inspección interna y reacondicionamiento (Fase 2)
 */
export class ExecuteQualityInspectionDto {
  @ApiProperty({ description: 'Nombre del inspector o líder de calidad', example: 'Jonathan Palacios' })
  inspectorNombre: string;

  @ApiProperty({ description: 'Lista de cajas inspeccionadas con su dictamen pieza por pieza', type: [ItemInspectionDictamenDto] })
  items: ItemInspectionDictamenDto[];

  @ApiPropertyOptional({ description: 'Indica si se deben armar cajas estándar nuevas con las piezas rescatadas', default: true })
  armarCajasConformes?: boolean;

  @ApiPropertyOptional({ description: 'Horas hombre dedicadas a la maquila / reacondicionamiento', example: 1.5 })
  horasMaquila?: number;

  @ApiPropertyOptional({ description: 'Tarifa por hora de servicio de maquila 3PL (en MXN)', example: 250.0 })
  tarifaMaquilaPorHora?: number;

  @ApiPropertyOptional({ description: 'Notas u observaciones generales del reacondicionamiento' })
  observacionesGenerales?: string;
}

/**
 * DTO para cada movimiento de guardado / putaway a racks
 */
export class PutawayMoveItemDto {
  @ApiPropertyOptional({ description: 'ID de la HandlingUnit (caja o pallet) que se traslada', example: '26f72234-272e-47d4-ac1b-a0fd04c58d8f' })
  huId?: string;

  @ApiPropertyOptional({ description: 'Código de la HandlingUnit (ej. BOX-REC-2026-0009-0001)', example: 'BOX-REC-2026-0009-0001' })
  huCodigo?: string;

  @ApiProperty({ description: 'ID del SKU que se está alojando', example: 'c1234567-89ab-cdef-0123-456789abcdef' })
  skuId: string;

  @ApiProperty({ description: 'Cantidad física en piezas a trasladar al rack', example: 12 })
  cantidad: number;

  @ApiProperty({ description: 'ID de la ubicación física destino en el rack', example: 'd1234567-89ab-cdef-0123-456789abcdef' })
  ubicacionDestinoId: string;

  @ApiPropertyOptional({ description: 'Código de la ubicación física destino (ej. B01-R01-N1)', example: 'B01-R01-N1' })
  ubicacionDestinoCodigo?: string;

  @ApiPropertyOptional({ description: 'Código escaneado por el montacarguista para la caja/tarima', example: 'BOX-REC-2026-0009-0001' })
  scannedHuCode?: string;

  @ApiPropertyOptional({ description: 'Código escaneado por el montacarguista para el rack físico', example: 'B01-R01-N1' })
  scannedLocationCode?: string;

  @ApiPropertyOptional({ description: 'Bandera que confirma la validación de escaneo de HU', default: false })
  huScanValidated?: boolean;

  @ApiPropertyOptional({ description: 'Bandera que confirma la validación de escaneo de rack físico', default: false })
  rackScanValidated?: boolean;
}

/**
 * DTO para la validación individual de Escaneo Dual (HU + Rack) en Putaway
 */
export class ValidatePutawayItemDto {
  @ApiPropertyOptional({ description: 'ID de la HandlingUnit a validar' })
  huId?: string;

  @ApiPropertyOptional({ description: 'Código de la HandlingUnit' })
  huCodigo?: string;

  @ApiProperty({ description: 'Código de la HU escaneado físicamente por el operador' })
  scannedHuCode: string;

  @ApiProperty({ description: 'Bandera de validación exitosa de escaneo de HU' })
  huScanValidated: boolean;

  @ApiProperty({ description: 'ID de la ubicación física de destino en rack' })
  ubicacionDestinoId: string;

  @ApiProperty({ description: 'Código del rack escaneado físicamente por el operador' })
  scannedLocationCode: string;

  @ApiProperty({ description: 'Bandera de validación exitosa de escaneo del rack físico' })
  rackScanValidated: boolean;

  @ApiPropertyOptional({ description: 'Nombre del operador o montacarguista' })
  usuario?: string;
}

/**
 * DTO para restablecer la validación de una HU y dejarla pendiente de re-escaneo dual
 */
export class ResetPutawayItemDto {
  @ApiPropertyOptional({ description: 'ID de la HandlingUnit a restablecer' })
  huId?: string;

  @ApiPropertyOptional({ description: 'Código de la HandlingUnit' })
  huCodigo?: string;

  @ApiPropertyOptional({ description: 'Motivo del restablecimiento de la validación' })
  motivo?: string;

  @ApiPropertyOptional({ description: 'Nombre del operador o montacarguista' })
  usuario?: string;
}

/**
 * DTO para confirmar el Alojamiento / Putaway y activar el stock a DISPONIBLE (Fase 4)
 */
export class ConfirmPutawayDto {
  @ApiProperty({ description: 'Lista de movimientos de guardado a racks', type: [PutawayMoveItemDto] })
  movimientos: PutawayMoveItemDto[];

  @ApiPropertyOptional({ description: 'Operador o montacarguista responsable del traslado físico', example: 'Jonathan Palacios (Montacargas 01)' })
  usuario?: string;

  @ApiPropertyOptional({ description: 'Modo de confirmación utilizado', enum: ['DIRECTO', 'ESCANEADO_HANDHELD'], default: 'ESCANEADO_HANDHELD' })
  modo?: 'DIRECTO' | 'ESCANEADO_HANDHELD';
}


