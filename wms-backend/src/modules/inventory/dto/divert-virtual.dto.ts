import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class DivertItemDto {
  @ApiProperty({ description: 'ID del SKU a desviar', example: 'sku-uuid-001' })
  skuId: string;

  @ApiPropertyOptional({ description: 'ID de la línea del previo de recibo si viene de recepción', example: 'line-uuid-001' })
  receiptLineId?: string;

  @ApiProperty({ description: 'Cantidad física a desviar al almacén virtual', example: 10, minimum: 1 })
  cantidad: number;

  @ApiProperty({
    description: 'Tipo de no conformidad que motiva el desvío',
    enum: ['MERCANCIA_DANADA', 'PRODUCTO_EXCESO', 'CADUCIDAD_VENCIDA', 'ERROR_EMPAQUE'],
    example: 'MERCANCIA_DANADA',
  })
  tipoDesvio: 'MERCANCIA_DANADA' | 'PRODUCTO_EXCESO' | 'CADUCIDAD_VENCIDA' | 'ERROR_EMPAQUE';

  @ApiProperty({ description: 'Justificación o dictamen técnico del motivo de segregación', example: 'Cajas rotas y aplastadas por estiba colapsada en transporte' })
  motivo: string;

  @ApiPropertyOptional({ description: 'Número de lote', example: 'LOTE-2026-A1' })
  lote?: string;

  @ApiPropertyOptional({ description: 'Fecha de caducidad en formato YYYY-MM-DD', example: '2027-12-31' })
  fechaVencimiento?: string;

  @ApiPropertyOptional({ description: 'Ubicación virtual de destino sugerida', example: 'DEV-01' })
  ubicacionDestinoId?: string;

  @ApiPropertyOptional({ description: 'Tipo de Handling Unit para segregar', example: 'PALLET' })
  tipoHu?: string;
}

export class DivertToVirtualDto {
  @ApiPropertyOptional({ description: 'ID de la recepción previa vinculada', example: 'rec-uuid-001' })
  receiptId?: string;

  @ApiProperty({ description: 'ID del cliente depositante', example: 'cli-uuid-001' })
  clienteId: string;

  @ApiProperty({ description: 'Usuario supervisor o perito que autoriza el desvío', example: 'Supervisor Giving Out' })
  usuario: string;

  @ApiPropertyOptional({ description: 'Observaciones generales del acta de desvío', example: 'Peritaje conjunto con chofer de transportista en andén 3' })
  notasGenerales?: string;

  @ApiProperty({ description: 'Lista de partidas con piezas a desviar', type: [DivertItemDto] })
  partidas: DivertItemDto[];
}
