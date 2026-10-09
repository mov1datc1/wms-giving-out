import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class TransferItemDto {
  @ApiProperty({ description: 'ID del registro de inventario (LotInventory)', example: 'lot-uuid-001' })
  lotId: string;

  @ApiPropertyOptional({ description: 'ID de la Handling Unit si se transfiere una HU específica', example: 'hu-uuid-001' })
  huId?: string;

  @ApiProperty({ description: 'Cantidad física a transferir al almacén virtual', example: 10, minimum: 1 })
  cantidad: number;

  @ApiPropertyOptional({ description: 'Motivo de la transferencia (Caducado, No conforme, Daño, Calidad, Cuarentena, Devolución, Corrección de inventario, Otro)', example: 'Caducado' })
  motivo?: string;

  @ApiPropertyOptional({ description: 'Observaciones operativas adicionales', example: 'Lote expirado detectado en pasillo A01' })
  observaciones?: string;
}

export class TransferToVirtualDto {
  @ApiProperty({ description: 'Lista de ítems/lotes a transferir', type: [TransferItemDto] })
  items: TransferItemDto[];

  @ApiPropertyOptional({ description: 'Motivo general para todos los ítems si no se especifica individualmente', example: 'Caducado' })
  motivoGeneral?: string;

  @ApiPropertyOptional({ description: 'Observaciones generales del movimiento' })
  observaciones?: string;

  @ApiProperty({ description: 'Usuario responsable que ejecuta la transferencia', example: 'Mariana Supervisor' })
  usuario: string;

  @ApiPropertyOptional({ description: 'Ubicación de destino específica en almacén virtual (ej. DEV-01)', example: 'DEV-01' })
  ubicacionDestinoId?: string;
}

export class ReleaseFromVirtualDto {
  @ApiProperty({ description: 'ID del registro de inventario virtual (LotInventory)', example: 'lot-uuid-001' })
  lotId: string;

  @ApiPropertyOptional({ description: 'ID de la Handling Unit a liberar', example: 'hu-uuid-001' })
  huId?: string;

  @ApiProperty({ description: 'Cantidad a reintegrar a stock operativo', example: 10, minimum: 1 })
  cantidad: number;

  @ApiProperty({ description: 'Motivo obligatorio de la liberación', example: 'Liberación tras dictamen de laboratorio aprobatorio' })
  motivo: string;

  @ApiProperty({ description: 'Usuario que autoriza la liberación', example: 'Jefe de Calidad' })
  usuario: string;

  @ApiPropertyOptional({ description: 'Rol o nivel de autorización del usuario', example: 'SUPERVISOR_CALIDAD' })
  rol?: string;

  @ApiPropertyOptional({ description: 'Folio o referencia de Calidad / Dictamen aprobatorio', example: 'INSP-2026-LIB-001' })
  referenciaCalidad?: string;

  @ApiPropertyOptional({ description: 'Ubicación destino en racks de stock operativo', example: 'B01-R01-N1' })
  ubicacionDestinoId?: string;
}
