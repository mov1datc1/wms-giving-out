import { Controller, Get, Post, Put, Patch, Delete, Param, Query, Body, Headers, HttpException, HttpStatus, UseInterceptors, UploadedFile, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBody, ApiConsumes, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import * as XLSX from 'xlsx';
import * as jwt from 'jsonwebtoken';
import { PrismaService } from '../../prisma.service';
import { withConcurrencyRetry } from '../../common/concurrency.util';
import { PutawayEngineService, PutawayItemInput } from './putaway-engine.service';
import { classifyLocationOperationalRole } from '../../common/location-classifier.util';
import { evaluateInventoryItemOperationalState, isExpired } from '../../common/inventory-operational-state.util';
import { validatePickingEligibility } from '../../common/picking-validation.util';
import { transferHuToStaging, validateHuAllocationCompatibility } from '../../common/picking-staging-transfer.util';

const JWT_SECRET = process.env.JWT_SECRET || 'giving-out-wms-secret-2026';
import {
  CreateReceiptPrevioDto,
  AddPrevioLineDto,
  UpdateReceiptStatusDto,
  LockReceiptDto,
  UnlockReceiptDto,
  CloseReceiptDto,
  BatchReceptionDto,
  BatchReceptionLineItemDto,
  ApiErrorResponseDto,
  RampaArriboDto,
  IdentifyDamagedBoxDto,
  GenerateLabelsDto,
  ConfirmPlacementDto,
  ExecuteQualityInspectionDto,
  ConfirmPutawayDto,
  PutawayMoveItemDto,
  ValidatePutawayItemDto,
  ResetPutawayItemDto,
} from './dto/previo.dto';
import { UploadPrevioDto } from './dto/upload-previo.dto';

// --- Normalización y Clasificación Inteligente de Columnas Excel ---
function normalizeExcelHeader(key: string): string {
  return String(key || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function isExcelSkuHeader(h: string): boolean {
  if (['sku', 'ean', 'codigo', 'cod', 'barcode', 'codigo barras', 'codigo barra', 'upc', 'material', 'articulo', 'item'].includes(h)) return true;
  if (/\bsku\b/.test(h)) return true;
  if (/\bean\b/.test(h)) return true;
  if (h.includes('codigo') && !h.includes('cliente') && !h.includes('proveedor') && !h.includes('postal')) return true;
  if (h.includes('barcode')) return true;
  return false;
}

function isExcelQtyHeader(h: string): boolean {
  if (h.includes('piezas por caja') || h.includes('cajas empaque') || h.includes('cajas')) return false;
  if (['cantidad', 'cant', 'qty', 'piezas', 'pzas', 'unidades', 'uds'].includes(h)) return true;
  if (h.includes('cantidad') || h.includes('cant') || h.includes('qty')) return true;
  if (h.includes('piezas') || h.includes('pzas') || h.includes('unidades')) return true;
  if (h.includes('a recibir') || h.includes('esperada')) return true;
  return false;
}

function isExcelFacturaHeader(h: string): boolean {
  if (['factura', 'fac', 'remision', 'invoice', 'documento', 'folio'].includes(h)) return true;
  if (h.includes('factura') || h.includes('remision') || h.includes('invoice')) return true;
  return false;
}

function isExcelOcHeader(h: string): boolean {
  if (['oc', 'orden compra', 'orden de compra', 'po', 'purchase order'].includes(h)) return true;
  if (h.includes('orden compra') || h.includes('orden de compra') || h.includes('purchase order')) return true;
  if (h === 'oc' || h.startsWith('oc ') || h.endsWith(' oc')) return true;
  return false;
}

function isExcelDescHeader(h: string): boolean {
  if (h.includes('descripcion') || h.includes('desc') || h.includes('producto') || h.includes('nombre')) return true;
  return false;
}

function isExcelLoteHeader(h: string): boolean {
  if (['lote', 'lot', 'batch'].includes(h)) return true;
  if (h.includes('lote') || h.includes('batch')) return true;
  return false;
}

function isExcelCaducidadHeader(h: string): boolean {
  if (['caducidad', 'vencimiento', 'expiry', 'expiracion'].includes(h)) return true;
  if (h.includes('caducidad') || h.includes('vencimiento') || h.includes('expiry') || h.includes('expiracion') || h.includes('vence')) return true;
  return false;
}

function isExcelPzCjaHeader(h: string): boolean {
  return h.includes('piezas por caja') || h.includes('pz cja') || h.includes('pzas cja') || h.includes('pzas por caja');
}

function isExcelCjasHeader(h: string): boolean {
  if (isExcelPzCjaHeader(h)) return false;
  return h.includes('cajas empaque') || h.includes('cajas') || h.includes('bultos');
}

@ApiTags('Operations')
@Controller('api')
export class OperationsController {
  constructor(
    private prisma: PrismaService,
    private putawayEngine: PutawayEngineService,
  ) {}

  private async audit(usuario: string, accion: string, entidad: string, entidadId?: string, detalle?: string, client: any = this.prisma) {
    await client.auditLog.create({
      data: {
        usuario: usuario || 'Supervisor Andén',
        accion,
        entidad,
        entidadId,
        detalle,
      },
    });
  }

  @Get('receipts/:id')
  @ApiOperation({
    summary: 'Obtener detalle de una recepción previa por ID o Folio',
  })
  async getReceiptById(@Param('id') idOrCode: string) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrCode);
    const receipt = await this.prisma.receipt.findFirst({
      where: isUuid ? { id: idOrCode } : { OR: [{ id: idOrCode }, { codigo: idOrCode }] },
      include: {
        cliente: true,
        proveedor: true,
        lineas: { include: { sku: true } },
        handlingUnits: {
          select: {
            id: true,
            codigo: true,
            tipoHu: true,
            cantidad: true,
            uom: true,
            ubicacionActual: true,
            estadoHu: true,
            reacondicionada: true,
            loteTexto: true,
            fechaVencimiento: true,
            skuCodigo: true,
            skuDescripcion: true,
            piezasPorCaja: true,
            parentHuId: true,
            estadoEtiqueta: true,
            etiquetaImpresa: true,
            cajaOrigenId: true,
            inspeccionId: true,
            motivoDano: true,
            createdAt: true,
          },
          orderBy: { codigo: 'asc' },
        },
        inspecciones: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!receipt) {
      throw new HttpException(`Recepción con identificador "${idOrCode}" no encontrada.`, HttpStatus.NOT_FOUND);
    }

    const huIds = (receipt.handlingUnits || []).map((h: any) => h.id);
    const [auditLogs, inventoryMovements] = await Promise.all([
      this.prisma.auditLog.findMany({
        where: {
          OR: [
            { entidadId: receipt.id },
            { entidadId: receipt.codigo },
            ...(huIds.length > 0 ? [{ entidadId: { in: huIds } }] : []),
            { detalle: { contains: receipt.codigo } },
          ],
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.inventoryMovement.findMany({
        where: {
          OR: [
            ...(huIds.length > 0 ? [{ huId: { in: huIds } }] : []),
            { documentoOrigen: receipt.codigo },
            { motivo: { contains: receipt.codigo } },
          ],
        },
        include: {
          sku: { select: { id: true, codigo: true, descripcion: true } },
          hu: { select: { id: true, codigo: true, tipoHu: true } },
          fromLocation: { select: { id: true, codigo: true, tipoUbicacion: true } },
          toLocation: { select: { id: true, codigo: true, tipoUbicacion: true } },
        },
        orderBy: { fechaHora: 'asc' },
      }),
    ]);

    return {
      ...receipt,
      auditLogs,
      inventoryMovements,
    };
  }

  @Get('receipts/:id/history')
  @ApiOperation({
    summary: 'Obtener bitácora de auditoría y movimientos de kárdex de una recepción previa',
  })
  async getReceiptHistory(@Param('id') idOrCode: string) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrCode);
    const receipt = await this.prisma.receipt.findFirst({
      where: isUuid ? { id: idOrCode } : { OR: [{ id: idOrCode }, { codigo: idOrCode }] },
      select: { id: true, codigo: true, handlingUnits: { select: { id: true } } },
    });
    if (!receipt) {
      throw new HttpException(`Recepción "${idOrCode}" no encontrada.`, HttpStatus.NOT_FOUND);
    }
    const huIds = (receipt.handlingUnits || []).map((h: any) => h.id);
    const [auditLogs, inventoryMovements] = await Promise.all([
      this.prisma.auditLog.findMany({
        where: {
          OR: [
            { entidadId: receipt.id },
            { entidadId: receipt.codigo },
            ...(huIds.length > 0 ? [{ entidadId: { in: huIds } }] : []),
            { detalle: { contains: receipt.codigo } },
          ],
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.inventoryMovement.findMany({
        where: {
          OR: [
            ...(huIds.length > 0 ? [{ huId: { in: huIds } }] : []),
            { documentoOrigen: receipt.codigo },
            { motivo: { contains: receipt.codigo } },
          ],
        },
        include: {
          sku: { select: { id: true, codigo: true, descripcion: true } },
          hu: { select: { id: true, codigo: true, tipoHu: true } },
          fromLocation: { select: { id: true, codigo: true, tipoUbicacion: true } },
          toLocation: { select: { id: true, codigo: true, tipoUbicacion: true } },
        },
        orderBy: { fechaHora: 'asc' },
      }),
    ]);
    return { auditLogs, inventoryMovements };
  }

  // ============ ACTA DE ENTRADA EN RAMPA & LIBERACIÓN DE CHOFER (FASE 1) ============
  @Post('receipts/:id/rampa-arribo')
  @ApiOperation({
    summary: 'Registrar arribo a rampa y emitir Acta de Chofer Exprés (Fase 1)',
    description: 'Registra el conteo exterior de bultos contra chofer, daños visibles en empaque, firmas digitales y libera la unidad de transporte sin alterar la disponibilidad de inventario.',
  })
  @ApiParam({ name: 'id', description: 'ID de la recepción previa' })
  @ApiBody({ type: RampaArriboDto })
  @HttpCode(HttpStatus.OK)
  async registrarArriboRampa(@Param('id') receiptId: string, @Body() body: RampaArriboDto) {
    const receipt = await this.prisma.receipt.findFirst({
      where: {
        OR: [{ id: receiptId }, { codigo: receiptId }],
      },
      include: { cliente: true, proveedor: true, lineas: { include: { sku: true } } },
    });
    if (!receipt) {
      throw new HttpException('Previo de recibo no encontrado', HttpStatus.NOT_FOUND);
    }
    if (receipt.estado === 'CERRADA' || receipt.estado === 'CERRADO') {
      throw new HttpException('Operación denegada: La recepción ya está CERRADA e inmutable.', HttpStatus.FORBIDDEN);
    }

    const bultosDeclarados = Number(body.bultosDeclarados) || 0;
    const bultosRecibidos = Number(body.bultosRecibidos) || 0;
    const bultosDanados = Number(body.bultosDanados) || 0;

    if (bultosDeclarados < 0 || bultosRecibidos < 0 || bultosDanados < 0) {
      throw new HttpException('Las cantidades de bultos deben ser valores mayores o iguales a 0.', HttpStatus.BAD_REQUEST);
    }

    // Regla de Oro: Los bultos dañados son un subconjunto de los efectivamente recibidos
    if (bultosDanados > bultosRecibidos) {
      throw new HttpException(
        {
          statusCode: HttpStatus.BAD_REQUEST,
          message: `Inconsistencia en conteo: Los bultos con daño exterior (${bultosDanados}) no pueden ser mayores que los bultos efectivamente recibidos (${bultosRecibidos}). Son un subconjunto de los recibidos.`,
          error: 'Bad Request',
          detalles: { codigo: 'BULTOS_DANADOS_EXCEDE_RECIBIDOS', bultosDanados, bultosRecibidos },
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    if (!body.firmaChofer || !body.firmaChofer.trim()) {
      throw new HttpException('La firma digital del transportista/chofer es obligatoria para emitir el acta de rampa.', HttpStatus.BAD_REQUEST);
    }
    if (!body.firmaReceptor || !body.firmaReceptor.trim()) {
      throw new HttpException('La firma digital del responsable de andén es obligatoria para liberar al chofer.', HttpStatus.BAD_REQUEST);
    }
    if ((!body.lineaTransporte || !body.lineaTransporte.trim()) && !receipt.lineaTransporte) {
      throw new HttpException('La línea de transporte de la unidad es obligatoria para emitir el acta de rampa.', HttpStatus.BAD_REQUEST);
    }
    if ((!body.placa || !body.placa.trim()) && !receipt.placa) {
      throw new HttpException('Las placas de la unidad de transporte son obligatorias para emitir el acta de rampa.', HttpStatus.BAD_REQUEST);
    }
    if ((!body.nombreChofer || !body.nombreChofer.trim()) && !receipt.nombreChofer) {
      throw new HttpException('El nombre del chofer de la unidad es obligatorio para emitir el acta de rampa.', HttpStatus.BAD_REQUEST);
    }

    const diferenciaBultos = bultosRecibidos - bultosDeclarados;
    const now = new Date();
    const usuario = body.usuario || body.nombreReceptor || 'Supervisor Andén';

    // Rótulo legal de la firma del chofer: No usar "a conformidad" si hay reservas o discrepancias
    const tieneReservas = diferenciaBultos !== 0 || bultosDanados > 0;
    const leyendaFirmaChofer = tieneReservas
      ? 'Entregó con reservas y discrepancias asentadas'
      : 'Entregó carga conforme (revisión exterior)';

    // Auditoría de rectificaciones post-firma (no sobrescribir silenciosamente)
    let historial: any[] = [];
    if (receipt.historialCorreccionesRampa) {
      try {
        historial = JSON.parse(receipt.historialCorreccionesRampa);
      } catch (e) {
        historial = [];
      }
    }

    const esRectificacion = !!(receipt.firmaChofer || receipt.fechaLiberacionChofer);
    if (esRectificacion) {
      historial.push({
        fecha: now,
        usuario,
        motivo: body.motivoCorreccion || 'Rectificación de datos de rampa autorizada',
        valoresAnteriores: {
          bultosDeclarados: receipt.bultosDeclarados,
          bultosRecibidos: receipt.bultosRecibidos,
          bultosDanados: receipt.bultosDanados,
          diferenciaBultos: receipt.diferenciaBultos,
          observacionesRampa: receipt.observacionesRampa,
          andenAsignado: receipt.andenAsignado,
          placa: receipt.placa,
          nombreChofer: receipt.nombreChofer,
          lineaTransporte: receipt.lineaTransporte,
        },
        valoresNuevos: {
          bultosDeclarados,
          bultosRecibidos,
          bultosDanados,
          diferenciaBultos,
          observacionesRampa: body.observacionesRampa,
          andenAsignado: body.andenAsignado,
          placa: body.placa,
          nombreChofer: body.nombreChofer,
          lineaTransporte: body.lineaTransporte,
        },
      });
      await this.audit(usuario, 'CORRECCION_ACTA_RAMPA', 'Receipt', receiptId, `Acta de rampa rectificada: ${body.motivoCorreccion || 'Sin motivo'}`);
    } else {
      await this.audit(usuario, 'ACTA_RAMPA_LIBERACION_CHOFER', 'Receipt', receiptId, `Chofer liberado. Bultos: ${bultosRecibidos}/${bultosDeclarados} (Daño: ${bultosDanados}, Dif: ${diferenciaBultos})`);
    }

    const updated = await this.prisma.receipt.update({
      where: { id: receiptId },
      data: {
        bultosDeclarados,
        bultosRecibidos,
        bultosDanados,
        diferenciaBultos,
        observacionesRampa: body.observacionesRampa || null,
        andenAsignado: body.andenAsignado || receipt.andenAsignado || null,
        lineaTransporte: body.lineaTransporte || receipt.lineaTransporte,
        capacidadCarga: body.capacidadCarga || receipt.capacidadCarga,
        placa: body.placa || receipt.placa,
        nombreChofer: body.nombreChofer || receipt.nombreChofer,
        folioTransporte: body.folioTransporte || receipt.folioTransporte,
        firmaChofer: body.firmaChofer,
        firmaReceptor: body.firmaReceptor,
        nombreReceptor: body.nombreReceptor || usuario,
        fechaLiberacionChofer: receipt.fechaLiberacionChofer || now,
        historialCorreccionesRampa: JSON.stringify(historial),
        // Candado de andén activo y estado EN_PROCESO_CONTEO
        bloqueado: true,
        bloqueadoPor: usuario,
        fechaBloqueo: receipt.fechaBloqueo || now,
        fechaConfirmacion: receipt.fechaConfirmacion || now,
        estado: (receipt.estado === 'PENDIENTE' || receipt.estado === 'PENDIENTE_ARRIBO') ? 'EN_PROCESO_CONTEO' : receipt.estado,
      },
      include: { cliente: true, proveedor: true, lineas: { include: { sku: true } } },
    });

    return {
      success: true,
      message: esRectificacion ? 'Acta de rampa rectificada y auditada exitosamente.' : 'Arribo a rampa confirmado y chofer liberado exitosamente.',
      esRectificacion,
      leyendaFirmaChofer,
      actaRampa: {
        receiptId: updated.id,
        codigo: updated.codigo,
        cliente: updated.cliente?.nombreComercial || updated.cliente?.razonSocial,
        facturaRespaldo: updated.facturaRespaldo || updated.ocReferencia,
        transporte: {
          linea: updated.lineaTransporte || 'Fletera externa',
          placa: updated.placa || 'S/P',
          chofer: updated.nombreChofer || 'Operador',
          unidad: updated.capacidadCarga || 'Camión',
          folio: updated.folioTransporte || updated.codigo,
          anden: updated.andenAsignado || 'Andén 01',
        },
        conteoExterior: {
          declarados: bultosDeclarados,
          recibidos: bultosRecibidos,
          danadosVisibles: bultosDanados,
          diferencia: diferenciaBultos,
          estadoCarga: tieneReservas ? 'CON_RESERVAS' : 'CONFORME_EXTERIOR',
          observaciones: updated.observacionesRampa || 'Sin observaciones de empaque',
        },
        firmas: {
          chofer: updated.firmaChofer,
          leyendaChofer: leyendaFirmaChofer,
          receptor: updated.firmaReceptor,
          nombreReceptor: updated.nombreReceptor,
          fechaHoraLiberacion: updated.fechaLiberacionChofer,
        },
        avisoLegal: 'El presente documento certifica exclusivamente un conteo físico global y revisión exterior de bultos/cajas cerrado en rampa de descarga, quedando sujeto a la inspección interna a detalle pieza por pieza, verificación de lotes, conteo de unidades y dictamen de calidad posterior.',
      },
      receipt: updated,
    };
  }

  @Get('receipts/:id/acuse-rampa')
  @ApiOperation({
    summary: 'Consultar Acta Oficial de Entrada en Rampa y Chofer (Fase 1)',
    description: 'Devuelve la información estructurada del acta de rampa, firmas, transporte, conteo exterior y aviso legal para impresión y auditoría.',
  })
  @ApiParam({ name: 'id', description: 'ID de la recepción previa' })
  async getAcuseRampa(@Param('id') receiptId: string) {
    const receipt = await this.prisma.receipt.findUnique({
      where: { id: receiptId },
      include: { cliente: true, proveedor: true, lineas: { include: { sku: true } } },
    });
    if (!receipt) throw new HttpException('Previo de recibo no encontrado', HttpStatus.NOT_FOUND);

    const declarados = receipt.bultosDeclarados !== null && receipt.bultosDeclarados !== undefined
      ? receipt.bultosDeclarados
      : (receipt.lineas && receipt.lineas.length > 0 ? receipt.lineas.reduce((acc, l) => acc + (l.cantidadEsperada || 0), 0) : 0);
    const recibidos = receipt.bultosRecibidos !== null && receipt.bultosRecibidos !== undefined
      ? receipt.bultosRecibidos
      : declarados;
    const danados = receipt.bultosDanados !== null && receipt.bultosDanados !== undefined
      ? receipt.bultosDanados
      : 0;
    const diferencia = receipt.diferenciaBultos !== null && receipt.diferenciaBultos !== undefined
      ? receipt.diferenciaBultos
      : (recibidos - declarados);
    const tieneReservas = diferencia !== 0 || danados > 0;
    const leyendaFirmaChofer = tieneReservas
      ? 'Entregó con reservas y discrepancias asentadas'
      : 'Entregó carga conforme (revisión exterior)';
    const avisoLegalTexto = 'El presente documento certifica exclusivamente un conteo físico global y revisión exterior de bultos/cajas cerrado en rampa de descarga, quedando sujeto a la inspección interna a detalle pieza por pieza, verificación de lotes, conteo de unidades y dictamen de calidad posterior.';

    let historial: any[] = [];
    if (receipt.historialCorreccionesRampa) {
      try { historial = JSON.parse(receipt.historialCorreccionesRampa); } catch (e) { historial = []; }
    }

    const transporteObj = {
      linea: receipt.lineaTransporte || '',
      lineaTransporte: receipt.lineaTransporte || '',
      placa: receipt.placa || '',
      chofer: receipt.nombreChofer || '',
      nombreChofer: receipt.nombreChofer || '',
      unidad: receipt.capacidadCarga || '',
      capacidadCarga: receipt.capacidadCarga || '',
      folio: receipt.folioTransporte || receipt.codigo,
      folioTransporte: receipt.folioTransporte || receipt.codigo,
      anden: receipt.andenAsignado || 'Rampa 1',
      andenAsignado: receipt.andenAsignado || 'Rampa 1',
    };

    const conteoObj = {
      declarados,
      bultosDeclarados: declarados,
      recibidos,
      bultosRecibidos: recibidos,
      danadosVisibles: danados,
      bultosDanados: danados,
      diferencia,
      diferenciaBultos: diferencia,
      estadoCarga: tieneReservas ? 'CON_RESERVAS' : 'CONFORME_EXTERIOR',
      tieneReservas,
      tieneDiscrepancias: tieneReservas,
      observaciones: receipt.observacionesRampa || '',
      observacionesRampa: receipt.observacionesRampa || '',
    };

    const firmasObj = {
      chofer: receipt.firmaChofer || null,
      firmaChofer: receipt.firmaChofer || null,
      leyendaChofer: leyendaFirmaChofer,
      receptor: receipt.firmaReceptor || null,
      firmaReceptor: receipt.firmaReceptor || null,
      nombreReceptor: receipt.nombreReceptor || receipt.recibidoPor || 'Supervisor de Andén',
      fechaHoraLiberacion: receipt.fechaLiberacionChofer || null,
      fechaLiberacionChofer: receipt.fechaLiberacionChofer || null,
    };

    return {
      receiptId: receipt.id,
      codigo: receipt.codigo,
      cliente: receipt.cliente?.nombreComercial || receipt.cliente?.razonSocial || 'Cliente',
      clienteNombre: receipt.cliente?.nombreComercial || receipt.cliente?.razonSocial || 'Cliente',
      clienteGiro: receipt.cliente?.giro || 'GENERAL',
      clienteObj: receipt.cliente ? {
        id: receipt.cliente.id,
        nombreComercial: receipt.cliente.nombreComercial,
        razonSocial: receipt.cliente.razonSocial,
        giro: receipt.cliente.giro,
      } : null,
      facturaRespaldo: receipt.facturaRespaldo || receipt.ocReferencia || 'S/N',
      tipoRecepcion: receipt.tipoRecepcion || 'NORMAL',
      origen: receipt.origen || 'NACIONAL',
      transporte: transporteObj,
      conteoExterior: conteoObj,
      conteoRampa: conteoObj,
      firmas: firmasObj,
      estadoRampa: {
        tieneDiscrepancias: tieneReservas,
        tieneReservas,
        leyendaChofer: leyendaFirmaChofer,
        leyendaLegal: avisoLegalTexto,
        fechaLiberacionChofer: receipt.fechaLiberacionChofer || null,
      },
      historialCorrecciones: historial,
      avisoLegal: avisoLegalTexto,
      alcanceActa: avisoLegalTexto,
      estadoActualPrevio: receipt.estado,
    };
  }

  // ============ DOBLE ETIQUETADO GIVING OUT (MASTER PALLET VS CAJAS ÚNICAS) ============
  @Post('receipts/:id/generate-labels')
  @ApiOperation({
    summary: 'Generar doble etiquetado industrial Giving Out (Pallets Master + Cajas Únicas)',
    description: 'Genera de forma idempotente las Handling Units de nivel Tarima Master (con QR) y Cajas Únicas (con Code-128, lote y factura, sin ubicación física impresa) según el desglose real de partidas.',
  })
  @ApiParam({ name: 'id', description: 'ID de la recepción previa' })
  @ApiBody({ type: GenerateLabelsDto, required: false })
  @HttpCode(HttpStatus.OK)
  async generateLabels(@Param('id') receiptId: string, @Body() body?: GenerateLabelsDto) {
    const receipt = await this.prisma.receipt.findUnique({
      where: { id: receiptId },
      include: {
        cliente: true,
        lineas: { include: { sku: true } },
        handlingUnits: true,
      },
    });
    if (!receipt) throw new HttpException('Previo de recibo no encontrado', HttpStatus.NOT_FOUND);

    // 1. IDEMPOTENCIA Y PLANIFICACIÓN: Verificar tarimas y cajas existentes
    const pallets = receipt.handlingUnits.filter(h => h.tipoHu === 'PALLET' && h.estadoHu !== 'INACTIVO');
    const todasLasCajas = receipt.handlingUnits.filter(h => h.tipoHu === 'CAJA');

    if (!receipt.lineas || receipt.lineas.length === 0) {
      throw new HttpException('El previo no contiene partidas de SKU para generar etiquetas.', HttpStatus.BAD_REQUEST);
    }

    const cajasPorTarimaDefault = body?.cajasPorTarima && body.cajasPorTarima > 0 ? body.cajasPorTarima : 40;
    const usuario = body?.usuario || 'Supervisor Andén';

    // Determinar cajas sanas nuevas necesarias por cada partida (ReceiptLine)
    interface LinePlan {
      line: any;
      sku: any;
      piezasPorCaja: number;
      piezasSanasAnden: number;
      cajasSanasAnden: number;
      existingRescuedBoxes: any[];
      existingHealthyBoxes: any[];
      nuevasCajasCrear: number;
    }

    const linesPlan: LinePlan[] = [];
    let totalNuevasCajasCrear = 0;

    for (const line of receipt.lineas) {
      const sku = line.sku || {};
      const packSize = sku.capacidadEmpaque && sku.capacidadEmpaque > 0 ? sku.capacidadEmpaque : (sku.codigo?.includes('ACE') ? 12 : sku.codigo?.includes('ARR') ? 20 : 1);
      const lineLot = (line.loteAsignado || line.loteEsperado || '').trim().toLowerCase();

      const matchBoxToLine = (h: any) => {
        if (h.receiptLineId && line.id) return h.receiptLineId === line.id;
        const hLot = (h.loteTexto || '').trim().toLowerCase();
        if (h.skuCodigo === sku.codigo) {
          if (hLot && lineLot) return hLot === lineLot;
          return true;
        }
        return false;
      };

      // HUs conformes/reacondicionadas ya creadas por Calidad
      const existingRescuedBoxes = receipt.handlingUnits.filter(
        h => h.tipoHu === 'CAJA' && h.estadoHu === 'ACTIVO' && (h.reacondicionada || h.cajaOrigenId) && matchBoxToLine(h)
      );
      const existingRescuedPieces = existingRescuedBoxes.reduce((s, b) => s + (Number(b.cantidad) || 0), 0);

      // Cajas sanas estándar preexistentes
      const existingHealthyBoxes = receipt.handlingUnits.filter(
        h => h.tipoHu === 'CAJA' && h.estadoHu === 'ACTIVO' && !h.reacondicionada && !h.cajaOrigenId &&
          !(h.codigo && h.codigo.includes('DANO')) && matchBoxToLine(h)
      );

      // Conciliación física persistida en andén
      const conformesTotalPiezas = receipt.conteoAndenEstado === 'COMPLETADO'
        ? Number(line.cantidadRecibida || 0)
        : (Number(line.cantidadRecibida) > 0
            ? Math.max(Number(line.cantidadRecibida), Number(line.cantidadEsperada || 0) - Number(line.cantidadDanada || 0))
            : Math.max(0, Number(line.cantidadEsperada || 0) - Number(line.cantidadDanada || 0)));
      const piezasSanasAnden = Math.max(0, conformesTotalPiezas - existingRescuedPieces);
      const cajasSanasAnden = packSize > 0 ? Math.floor(piezasSanasAnden / packSize) : 0;
      const nuevasCajasCrear = Math.max(0, cajasSanasAnden - existingHealthyBoxes.length);

      totalNuevasCajasCrear += nuevasCajasCrear;

      linesPlan.push({
        line,
        sku,
        piezasPorCaja: packSize,
        piezasSanasAnden,
        cajasSanasAnden,
        existingRescuedBoxes,
        existingHealthyBoxes,
        nuevasCajasCrear,
      });
    }

    // IDEMPOTENCIA TOTAL: Si ya existen tarimas y no hay nuevas cajas sanas por crear, retornar existentes sin duplicar
    if (pallets.length > 0 && totalNuevasCajasCrear === 0 && !body?.forceRegenerate) {
      const primaryPallet = pallets[0];
      for (const plan of linesPlan) {
        for (const boxToLink of [...plan.existingRescuedBoxes, ...plan.existingHealthyBoxes]) {
          if (!boxToLink.parentHuId || boxToLink.parentHuId !== primaryPallet.id) {
            await this.prisma.handlingUnit.update({
              where: { id: boxToLink.id },
              data: { parentHuId: primaryPallet.id },
            });
            boxToLink.parentHuId = primaryPallet.id;
          }
        }
      }

      const cajasActivas = todasLasCajas.filter(c => c.estadoHu === 'ACTIVO');
      const palletsEnriquecidos = pallets.map(p => {
        const cajasHijas = cajasActivas.filter(c => c.parentHuId === p.id);
        const skusGrouped: Record<string, {
          receiptLineId?: string;
          codigo: string;
          descripcion: string;
          lote: string;
          caducidad: string | null;
          cantidad: number;
          cajas: number;
          hus: string[];
        }> = {};

        for (const c of cajasHijas) {
          const lineKey = `${c.receiptLineId || ''}_${c.skuCodigo || 'S/SKU'}_${c.loteTexto || 'S/L'}`;
          const formatCad = (fv: any) => {
            if (!fv) return null;
            try { return new Date(fv).toISOString().slice(0, 10); } catch (_) { return String(fv).slice(0, 10); }
          };
          if (!skusGrouped[lineKey]) {
            skusGrouped[lineKey] = {
              receiptLineId: c.receiptLineId || undefined,
              codigo: c.skuCodigo || 'S/SKU',
              descripcion: (c.skuDescripcion || '').replace('[DAÑO EXTERIOR] ', '').trim(),
              lote: c.loteTexto || 'S/L',
              caducidad: formatCad(c.fechaVencimiento),
              cantidad: 0,
              cajas: 0,
              hus: [],
            };
          }
          skusGrouped[lineKey].cantidad += c.cantidad || 0;
          skusGrouped[lineKey].cajas += 1;
          if (c.codigo && !skusGrouped[lineKey].hus.includes(c.codigo)) {
            skusGrouped[lineKey].hus.push(c.codigo);
          }
        }

        const skusDesgloseMap: Record<string, any> = {};
        for (const item of Object.values(skusGrouped)) {
          const desgloseKey = `${item.codigo} [${item.lote}]`;
          skusDesgloseMap[desgloseKey] = {
            receiptLineId: item.receiptLineId,
            desc: item.descripcion,
            lote: item.lote,
            caducidad: item.caducidad,
            cantidad: item.cantidad,
            cajas: item.cajas,
            hus: item.hus,
          };
        }

        return {
          ...p,
          totalCajas: cajasHijas.length,
          totalUnidades: cajasHijas.reduce((sum, c) => sum + (c.cantidad || 0), 0),
          cajas: cajasHijas,
          boxes: cajasHijas,
          skus: Object.values(skusGrouped).map(item => `${item.codigo} (${item.lote})`),
          skusDesglose: skusDesgloseMap,
          qrPayload: JSON.stringify({
            palletId: p.codigo,
            receiptCode: receipt.codigo,
            cliente: receipt.cliente?.nombreComercial || receipt.cliente?.razonSocial,
            factura: p.facturaRespaldo || receipt.facturaRespaldo || receipt.ocReferencia,
            totalCajas: cajasHijas.length,
            totalPiezas: cajasHijas.reduce((sum, c) => sum + (c.cantidad || 0), 0),
            skus: Object.values(skusGrouped).map(item => ({
              receiptLineId: item.receiptLineId,
              codigo: item.codigo,
              descripcion: item.descripcion,
              lote: item.lote,
              caducidad: item.caducidad,
              cantidad: item.cantidad,
              cajas: item.cajas,
              hus: item.hus,
            })),
          }),
        };
      });

      return {
        success: true,
        message: 'Etiquetas ya generadas previamente para este previo (respetando folios e IDs existentes)',
        yaGeneradas: true,
        etiquetasEstado: receipt.etiquetasEstado || 'GENERADAS',
        totalBoxes: cajasActivas.length,
        totalPallets: pallets.length,
        totales: {
          pallets: pallets.length,
          totalPallets: pallets.length,
          cajas: cajasActivas.length,
          totalBoxes: cajasActivas.length,
          unidades: cajasActivas.reduce((sum, c) => sum + (c.cantidad || 0), 0),
        },
        pallets: palletsEnriquecidos,
        cajas: cajasActivas,
        boxes: cajasActivas,
      };
    }

    // Si fuerza regeneración, eliminar las HUs estándar generadas sin tocar cajas retenidas/dañadas de calidad o reacondicionadas
    if (body?.forceRegenerate && receipt.handlingUnits.length > 0) {
      await this.prisma.handlingUnit.deleteMany({
        where: {
          receiptId,
          reacondicionada: false,
          inspeccionId: null,
          tipoHu: 'CAJA',
          estadoHu: { notIn: ['RETENIDA', 'DAÑADO'] },
          codigo: { not: { contains: 'DANO' } },
        },
      });
      for (const plan of linesPlan) {
        plan.existingHealthyBoxes = [];
        plan.nuevasCajasCrear = plan.cajasSanasAnden;
      }
    }

    // 2. Determinar o crear la Tarima Master y Cajas con protección de concurrencia
    const { createdPallets, createdCajas } = await withConcurrencyRetry(async () => {
      const freshHus = await this.prisma.handlingUnit.findMany({
        where: { receiptId: receipt.id },
      });
      const currentPallets = freshHus.filter(h => h.tipoHu === 'PALLET' || (h.codigo && h.codigo.startsWith('PLT-')));

      const cPallets: any[] = [];
      const cCajas: any[] = [];
      let curPallet: any = currentPallets.length > 0 ? currentPallets[0] : null;

      let maxPltIdx = 0;
      for (const p of currentPallets) {
        const match = p.codigo?.match(/PLT-[^-]+-(\d+)/);
        if (match) {
          const num = parseInt(match[1], 10);
          if (!isNaN(num) && num > maxPltIdx) maxPltIdx = num;
        }
      }
      let pCount = maxPltIdx;
      let cInCurrentPallet = 0;

      if (!curPallet) {
        pCount++;
        const palletCodigo = `PLT-${receipt.codigo}-${String(pCount).padStart(2, '0')}`;
        curPallet = await this.prisma.handlingUnit.create({
          data: {
            codigo: palletCodigo,
            tipoHu: 'PALLET',
            clienteId: receipt.clienteId,
            receiptId: receipt.id,
            cantidad: 0,
            uom: 'TARIMA',
            ubicacionActual: 'RAMPA_RECEPCION',
            estadoHu: 'ACTIVO',
            estadoEtiqueta: 'GENERADA',
            facturaRespaldo: receipt.facturaRespaldo || receipt.ocReferencia || receipt.codigo,
          },
        });
        cPallets.push(curPallet);
      } else {
        cPallets.push(curPallet);
      }

      // Determinar consecutivo seguro para numeración de nuevas cajas
      const boxPrefix = `BOX-${receipt.codigo}-`;
      let maxExIdx = 0;
      for (const h of freshHus) {
        if (h.tipoHu === 'CAJA' && h.codigo && h.codigo.startsWith(boxPrefix)) {
          const suffix = h.codigo.substring(boxPrefix.length);
          const numMatch = suffix.match(/^(\d{1,6})/);
          if (numMatch) {
            const num = parseInt(numMatch[1], 10);
            if (!isNaN(num) && num > maxExIdx) maxExIdx = num;
          }
        }
      }
      let gBoxIdx = maxExIdx;

      // 3. Procesar partidas: vincular existentes y crear únicamente las cajas sanas pendientes
      for (const plan of linesPlan) {
        const { line, sku, piezasPorCaja, existingRescuedBoxes, existingHealthyBoxes, nuevasCajasCrear } = plan;

        // A. Vincular HUs conformes/reacondicionadas ya creadas por Calidad
        for (const rBox of existingRescuedBoxes) {
          if (!rBox.parentHuId || rBox.parentHuId !== curPallet.id) {
            await this.prisma.handlingUnit.update({
              where: { id: rBox.id },
              data: { parentHuId: curPallet.id },
            });
            rBox.parentHuId = curPallet.id;
          }
          if (!cCajas.some(c => c.id === rBox.id)) {
            cCajas.push(rBox);
            cInCurrentPallet++;
          }
        }

        // B. Vincular cajas sanas preexistentes (si las hubiera)
        for (const eBox of existingHealthyBoxes) {
          if (!eBox.parentHuId || eBox.parentHuId !== curPallet.id) {
            await this.prisma.handlingUnit.update({
              where: { id: eBox.id },
              data: { parentHuId: curPallet.id },
            });
            eBox.parentHuId = curPallet.id;
          }
          if (!cCajas.some(c => c.id === eBox.id)) {
            cCajas.push(eBox);
            cInCurrentPallet++;
          }
        }

        // C. Crear ÚNICAMENTE las cajas sanas que todavía necesitan materializarse como HUs
        for (let cIdx = 1; cIdx <= nuevasCajasCrear; cIdx++) {
          if (cInCurrentPallet >= cajasPorTarimaDefault) {
            pCount++;
            const palletCodigo = `PLT-${receipt.codigo}-${String(pCount).padStart(2, '0')}`;
            curPallet = await this.prisma.handlingUnit.create({
              data: {
                codigo: palletCodigo,
                tipoHu: 'PALLET',
                clienteId: receipt.clienteId,
                receiptId: receipt.id,
                cantidad: 0,
                uom: 'TARIMA',
                ubicacionActual: 'RAMPA_RECEPCION',
                estadoHu: 'ACTIVO',
                estadoEtiqueta: 'GENERADA',
                facturaRespaldo: receipt.facturaRespaldo || receipt.ocReferencia || receipt.codigo,
              },
            });
            cPallets.push(curPallet);
            cInCurrentPallet = 0;
          }

          gBoxIdx++;
          const boxCodigo = `BOX-${receipt.codigo}-${String(gBoxIdx).padStart(4, '0')}`;
          const caja = await this.prisma.handlingUnit.create({
            data: {
              codigo: boxCodigo,
              tipoHu: 'CAJA',
              clienteId: receipt.clienteId,
              receiptId: receipt.id,
              receiptLineId: line.id,
              parentHuId: curPallet.id,
              cantidad: piezasPorCaja,
              uom: line.uom || sku.uomBase || 'PZA',
              ubicacionActual: 'RAMPA_RECEPCION',
              estadoHu: 'ACTIVO',
              estadoEtiqueta: 'GENERADA',
              skuCodigo: sku.codigo,
              skuDescripcion: sku.descripcion,
              loteTexto: line.loteAsignado || line.loteEsperado || 'S/LOTE',
              fechaVencimiento: line.fechaVencimiento || null,
              facturaRespaldo: receipt.facturaRespaldo || receipt.ocReferencia || receipt.codigo,
              piezasPorCaja: piezasPorCaja,
            },
          });

          cCajas.push(caja);
          cInCurrentPallet++;
        }
      }

      return { createdPallets: cPallets, createdCajas: cCajas };
    }, { contextName: 'generateLabels' });

    // 4. Actualizar cantidades consolidadas en los pallets y enriquecer respuesta
    const enrichedCreatedPallets: any[] = [];
    for (const p of createdPallets) {
      const palletBoxes = createdCajas.filter(c => c.parentHuId === p.id && c.estadoHu === 'ACTIVO');
      const totalUnitsInPallet = palletBoxes.reduce((acc, c) => acc + (c.cantidad || 0), 0);
      await this.prisma.handlingUnit.update({
        where: { id: p.id },
        data: { cantidad: palletBoxes.length }, // En pallet, cantidad = número de cajas activas
      });
      const skusGrouped: Record<string, {
        receiptLineId?: string;
        codigo: string;
        descripcion: string;
        lote: string;
        caducidad: string | null;
        cantidad: number;
        cajas: number;
        hus: string[];
      }> = {};

      for (const c of palletBoxes) {
        const lineKey = `${c.receiptLineId || ''}_${c.skuCodigo || 'S/SKU'}_${c.loteTexto || 'S/L'}`;
        const formatCad = (fv: any) => {
          if (!fv) return null;
          try { return new Date(fv).toISOString().slice(0, 10); } catch (_) { return String(fv).slice(0, 10); }
        };
        if (!skusGrouped[lineKey]) {
          skusGrouped[lineKey] = {
            receiptLineId: c.receiptLineId || undefined,
            codigo: c.skuCodigo || 'S/SKU',
            descripcion: (c.skuDescripcion || '').replace('[DAÑO EXTERIOR] ', '').trim(),
            lote: c.loteTexto || 'S/L',
            caducidad: formatCad(c.fechaVencimiento),
            cantidad: 0,
            cajas: 0,
            hus: [],
          };
        }
        skusGrouped[lineKey].cantidad += c.cantidad || 0;
        skusGrouped[lineKey].cajas += 1;
        if (c.codigo && !skusGrouped[lineKey].hus.includes(c.codigo)) {
          skusGrouped[lineKey].hus.push(c.codigo);
        }
      }

      const skusDesgloseMap: Record<string, any> = {};
      for (const item of Object.values(skusGrouped)) {
        const desgloseKey = `${item.codigo} [${item.lote}]`;
        skusDesgloseMap[desgloseKey] = {
          receiptLineId: item.receiptLineId,
          desc: item.descripcion,
          lote: item.lote,
          caducidad: item.caducidad,
          cantidad: item.cantidad,
          cajas: item.cajas,
          hus: item.hus,
        };
      }

      enrichedCreatedPallets.push({
        ...p,
        totalCajas: palletBoxes.length,
        totalUnidades: totalUnitsInPallet,
        cajas: palletBoxes,
        boxes: palletBoxes,
        skus: Object.values(skusGrouped).map(item => `${item.codigo} (${item.lote})`),
        skusDesglose: skusDesgloseMap,
        qrPayload: JSON.stringify({
          palletId: p.codigo,
          receiptCode: receipt.codigo,
          cliente: receipt.cliente?.nombreComercial || receipt.cliente?.razonSocial,
          factura: p.facturaRespaldo,
          totalCajas: palletBoxes.length,
          totalPiezas: totalUnitsInPallet,
          skus: Object.values(skusGrouped).map(item => ({
            receiptLineId: item.receiptLineId,
            codigo: item.codigo,
            descripcion: item.descripcion,
            lote: item.lote,
            caducidad: item.caducidad,
            cantidad: item.cantidad,
            cajas: item.cajas,
            hus: item.hus,
          })),
        }),
      });
    }

    // Actualizar estado en el previo (sin tocar inventario comercial ni racks)
    await this.prisma.receipt.update({
      where: { id: receiptId },
      data: { etiquetasEstado: 'GENERADAS' },
    });

    await this.audit(usuario, 'GENERAR_DOBLE_ETIQUETADO', 'Receipt', receiptId, `Generadas ${createdPallets.length} tarimas master y ${createdCajas.length} cajas físicas activas.`);

    return {
      success: true,
      message: `Doble etiquetado generado exitosamente: ${createdPallets.length} Tarimas Master y ${createdCajas.length} Cajas Físicas Activas.`,
      yaGeneradas: false,
      etiquetasEstado: 'GENERADAS',
      totalBoxes: createdCajas.length,
      totalPallets: createdPallets.length,
      totales: {
        pallets: createdPallets.length,
        totalPallets: createdPallets.length,
        cajas: createdCajas.length,
        totalBoxes: createdCajas.length,
        unidades: createdCajas.reduce((sum, c) => sum + (c.cantidad || 0), 0),
      },
      pallets: enrichedCreatedPallets,
      cajas: createdCajas,
      boxes: createdCajas,
    };
  }

  @Post('receipts/:id/labels/print')
  @ApiOperation({ summary: 'Registrar evento de impresión de etiquetas Giving Out' })
  @HttpCode(HttpStatus.OK)
  async printLabels(@Param('id') receiptId: string, @Body() body: { usuario?: string; tipo?: string; motivo?: string; huIds?: string[] }) {
    const receipt = await this.prisma.receipt.findUnique({
      where: { id: receiptId },
      include: { handlingUnits: true },
    });
    if (!receipt) throw new HttpException('Previo no encontrado', HttpStatus.NOT_FOUND);

    const usuario = body?.usuario || 'Supervisor Andén';
    const esReimpresion = receipt.etiquetasEstado === 'IMPRESAS' || receipt.etiquetasEstado === 'COLOCADAS';

    if (body?.huIds && Array.isArray(body.huIds) && body.huIds.length > 0) {
      await this.prisma.handlingUnit.updateMany({
        where: { id: { in: body.huIds } },
        data: {
          etiquetaImpresa: true,
          estadoEtiqueta: 'IMPRESA',
        },
      });
    } else {
      await this.prisma.handlingUnit.updateMany({
        where: { receiptId, estadoHu: 'ACTIVO' },
        data: {
          etiquetaImpresa: true,
          estadoEtiqueta: 'IMPRESA',
        },
      });
    }

    if (receipt.etiquetasEstado !== 'COLOCADAS') {
      await this.prisma.receipt.update({
        where: { id: receiptId },
        data: { etiquetasEstado: 'IMPRESAS' },
      });
    }

    await this.prisma.printLog.create({
      data: {
        usuario,
        tipoEtiqueta: body?.tipo || 'DOBLE_NIVEL_RECEPCION',
        referencia: receipt.codigo,
        reimpresion: esReimpresion,
        motivo: body?.motivo || (esReimpresion ? 'Reimpresión solicitada' : 'Primera emisión de etiquetas'),
      },
    });

    const detalleAudit = `Etiquetas enviadas a impresión (${body?.tipo || 'TODO'}${body?.huIds ? ` - ${body.huIds.length} cajas seleccionadas` : ''})`;
    await this.audit(usuario, esReimpresion ? 'REIMPRESION_ETIQUETAS' : 'IMPRESION_ETIQUETAS', 'Receipt', receiptId, detalleAudit);

    return {
      success: true,
      message: esReimpresion ? 'Reimpresión registrada preservando los mismos IDs.' : 'Impresión registrada exitosamente.',
      esReimpresion,
      totalImpresas: body?.huIds?.length,
      etiquetasEstado: receipt.etiquetasEstado === 'COLOCADAS' ? 'COLOCADAS' : 'IMPRESAS',
    };
  }

  @Post('receipts/:id/labels/confirm-placement')
  @ApiOperation({ summary: 'Confirmar colocación física de etiquetas en andén' })
  @HttpCode(HttpStatus.OK)
  async confirmLabelPlacement(@Param('id') receiptId: string, @Body() body: ConfirmPlacementDto) {
    const receipt = await this.prisma.receipt.findUnique({
      where: { id: receiptId },
      include: { handlingUnits: true },
    });
    if (!receipt) throw new HttpException('Previo no encontrado', HttpStatus.NOT_FOUND);

    if (!receipt.handlingUnits || receipt.handlingUnits.length === 0) {
      throw new HttpException('No hay etiquetas generadas para este previo.', HttpStatus.BAD_REQUEST);
    }

    if (receipt.etiquetasEstado !== 'IMPRESAS' && receipt.etiquetasEstado !== 'COLOCADAS') {
      throw new HttpException(
        `Secuencia operativa inválida: No se puede confirmar la colocación física si las etiquetas aún no han sido impresas (estado actual: ${receipt.etiquetasEstado || 'GENERADAS'}). Se debe imprimir y confirmar la emisión física antes de la colocación en andén.`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const usuario = (body?.usuario || (body as any)?.colocadoPor || receipt.recibidoPor || 'Operador de Andén').trim();
    const now = new Date();

    await this.prisma.handlingUnit.updateMany({
      where: { receiptId, estadoHu: 'ACTIVO' },
      data: { estadoEtiqueta: 'COLOCADA' },
    });

    const updated = await this.prisma.receipt.update({
      where: { id: receiptId },
      data: {
        etiquetasEstado: 'COLOCADAS',
        etiquetasColocadasPor: usuario,
        fechaColocacionEtiquetas: now,
      },
    });

    await this.audit(usuario, 'CONFIRMAR_COLOCACION_ETIQUETAS', 'Receipt', receiptId, `Confirmada colocación física de etiquetas en andén. ${body?.notas || ''}`);

    return {
      success: true,
      message: 'Colocación física de etiquetas confirmada exitosamente en andén.',
      etiquetasEstado: 'COLOCADAS',
      fechaColocacion: now,
      colocadoPor: usuario,
      etiquetasColocadasPor: usuario,
      receipt: updated,
    };
  }

  @Get('receipts/:id/labels')
  @ApiOperation({ summary: 'Consultar etiquetas Master y de Caja de una recepción' })
  async getReceiptLabels(@Param('id') receiptId: string) {
    const receipt = await this.prisma.receipt.findFirst({
      where: {
        OR: [{ id: receiptId }, { codigo: receiptId }],
      },
      include: {
        cliente: true,
        handlingUnits: {
          orderBy: { codigo: 'asc' },
        },
      },
    });
    if (!receipt) throw new HttpException('Previo no encontrado', HttpStatus.NOT_FOUND);

    const pallets = receipt.handlingUnits.filter(h => h.tipoHu === 'PALLET' && h.estadoHu !== 'INACTIVO');
    const todasLasCajas = receipt.handlingUnits.filter(h => h.tipoHu === 'CAJA');
    const cajasActivas = todasLasCajas.filter(h => h.estadoHu === 'ACTIVO');
    const cajas = cajasActivas.length > 0 ? cajasActivas : todasLasCajas;

    // Mapear pallets con el desglose de cajas que contiene para renderizar el QR 2D
    const palletsEnriquecidos = pallets.map(p => {
      const cajasHijas = todasLasCajas.filter(c => c.parentHuId === p.id);
      // Cajas activas en la tarima (excluyendo cajas inactivas consumidas en reacondicionamiento)
      const cajasActivasTarima = cajasHijas.filter(c => c.estadoHu === 'ACTIVO');
      const cajasAMapear = cajasActivasTarima.length > 0 ? cajasActivasTarima : cajasHijas;

      const skusGrouped: Record<string, {
        receiptLineId?: string;
        codigo: string;
        descripcion: string;
        lote: string;
        caducidad: string | null;
        cantidad: number;
        cajas: number;
        hus: string[];
      }> = {};

      for (const c of cajasAMapear) {
        const lineKey = `${c.receiptLineId || ''}_${c.skuCodigo || 'S/SKU'}_${c.loteTexto || 'S/L'}`;
        const formatCad = (fv: any) => {
          if (!fv) return null;
          try { return new Date(fv).toISOString().slice(0, 10); } catch (_) { return String(fv).slice(0, 10); }
        };
        if (!skusGrouped[lineKey]) {
          skusGrouped[lineKey] = {
            receiptLineId: c.receiptLineId || undefined,
            codigo: c.skuCodigo || 'S/SKU',
            descripcion: (c.skuDescripcion || '').replace('[DAÑO EXTERIOR] ', '').trim(),
            lote: c.loteTexto || 'S/L',
            caducidad: formatCad(c.fechaVencimiento),
            cantidad: 0,
            cajas: 0,
            hus: [],
          };
        }
        skusGrouped[lineKey].cantidad += c.cantidad || 0;
        skusGrouped[lineKey].cajas += 1;
        if (c.codigo && !skusGrouped[lineKey].hus.includes(c.codigo)) {
          skusGrouped[lineKey].hus.push(c.codigo);
        }
      }

      const skusDesgloseMap: Record<string, any> = {};
      for (const item of Object.values(skusGrouped)) {
        const desgloseKey = `${item.codigo} [${item.lote}]`;
        skusDesgloseMap[desgloseKey] = {
          receiptLineId: item.receiptLineId,
          desc: item.descripcion,
          lote: item.lote,
          caducidad: item.caducidad,
          cantidad: item.cantidad,
          cajas: item.cajas,
          hus: item.hus,
        };
      }

      return {
        ...p,
        totalCajas: cajasAMapear.length,
        totalUnidades: cajasAMapear.reduce((sum, c) => sum + (c.cantidad || 0), 0),
        cajas: cajasAMapear,
        boxes: cajasAMapear,
        todasLasCajas: cajasHijas,
        skus: Object.values(skusGrouped).map(item => `${item.codigo} (${item.lote})`),
        skusDesglose: skusDesgloseMap,
        qrPayload: JSON.stringify({
          palletId: p.codigo,
          receiptCode: receipt.codigo,
          cliente: receipt.cliente?.nombreComercial || receipt.cliente?.razonSocial,
          factura: p.facturaRespaldo || receipt.facturaRespaldo || receipt.ocReferencia,
          totalCajas: cajasAMapear.length,
          totalPiezas: cajasAMapear.reduce((sum, c) => sum + (c.cantidad || 0), 0),
          skus: Object.values(skusGrouped).map(item => ({
            receiptLineId: item.receiptLineId,
            codigo: item.codigo,
            descripcion: item.descripcion,
            lote: item.lote,
            caducidad: item.caducidad,
            cantidad: item.cantidad,
            cajas: item.cajas,
            hus: item.hus,
          })),
        }),
      };
    });

    return {
      receiptId: receipt.id,
      receiptCodigo: receipt.codigo,
      cliente: receipt.cliente?.nombreComercial || receipt.cliente?.razonSocial,
      facturaRespaldo: receipt.facturaRespaldo || receipt.ocReferencia,
      etiquetasEstado: receipt.etiquetasEstado || 'PENDIENTE',
      fechaColocacion: receipt.fechaColocacionEtiquetas,
      fechaColocacionEtiquetas: receipt.fechaColocacionEtiquetas,
      colocadoPor: receipt.etiquetasColocadasPor,
      etiquetasColocadasPor: receipt.etiquetasColocadasPor,
      totalBoxes: cajas.length,
      totalPallets: pallets.length,
      totales: {
        pallets: pallets.length,
        totalPallets: pallets.length,
        cajas: cajas.length,
        totalBoxes: cajas.length,
        unidades: cajas.reduce((sum, c) => sum + (c.cantidad || 0), 0),
      },
      pallets: palletsEnriquecidos,
      cajas,
      boxes: cajas,
    };
  }

  // ============ RECEPTION ============
  @Get('receipts')
  @ApiOperation({
    summary: 'Listar recepciones previas (ASN)',
    description: 'Obtiene el listado general de recepciones previas y manifiestos de entrada con desglose de cliente depositante, estatus operacional y líneas de SKUs programadas.',
  })
  @ApiQuery({ name: 'clienteId', required: false, description: 'Filtrar recepciones por ID del cliente depositante' })
  @ApiQuery({ name: 'estado', required: false, description: 'Filtrar por estatus operacional: PENDIENTE_ARRIBO, EN_PROCESO_CONTEO o CERRADA' })
  @ApiResponse({ status: 200, description: 'Lista de recepciones obtenida exitosamente' })
  @ApiResponse({ status: 500, description: 'Error interno del servidor', type: ApiErrorResponseDto })
  async getReceipts(@Query('clienteId') clienteId?: string, @Query('estado') estado?: string) {
    try {
      const where: any = {};
      if (clienteId) where.clienteId = clienteId;
      if (estado) {
        if (estado === 'PENDIENTE_ARRIBO') {
          where.estado = { in: ['PENDIENTE_ARRIBO', 'PENDIENTE'] };
        } else if (estado === 'EN_PROCESO_CONTEO') {
          where.estado = { in: ['EN_PROCESO_CONTEO', 'EN_PROCESO', 'COMPLETO'] };
        } else if (estado === 'CERRADA' || estado === 'CERRADO') {
          where.estado = { in: ['CERRADA', 'CERRADO'] };
        } else {
          where.estado = estado;
        }
      }

      return await this.prisma.receipt.findMany({
        where,
        include: {
          cliente: { select: { id: true, codigo: true, nombreComercial: true, giro: true, reglaInventario: true, zonaAsignadaId: true } },
          proveedor: { select: { id: true, nombre: true } },
          lineas: {
            include: {
              sku: {
                select: {
                  id: true,
                  codigo: true,
                  descripcion: true,
                  categoria: true,
                  subcategoria: true,
                  talla: true,
                  color: true,
                  codigoBarras: true,
                  uomBase: true,
                  capacidadEmpaque: true,
                  descripcionEmpaque: true,
                  marca: true,
                },
              },
            },
          },
          handlingUnits: {
            select: {
              id: true,
              codigo: true,
              tipoHu: true,
              cantidad: true,
              uom: true,
              ubicacionActual: true,
              estadoHu: true,
              reacondicionada: true,
              loteTexto: true,
              fechaVencimiento: true,
              skuCodigo: true,
              skuDescripcion: true,
              piezasPorCaja: true,
              parentHuId: true,
              estadoEtiqueta: true,
              etiquetaImpresa: true,
              cajaOrigenId: true,
              inspeccionId: true,
              motivoDano: true,
              createdAt: true,
            },
            orderBy: { codigo: 'asc' },
          },
          inspecciones: {
            select: {
              id: true,
              folio: true,
              estado: true,
              fechaInspeccion: true,
              totalCajasInspeccionadas: true,
              totalPiezasRescatadas: true,
              totalPiezasMerma: true,
            },
            orderBy: { createdAt: 'desc' },
          },
        },
        orderBy: { fechaRecepcion: 'desc' },
      });
    } catch (error: any) {
      console.error('Error al listar recepciones:', error);
      throw new HttpException(error.message || 'Error interno al consultar recepciones', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  // ============ GLOBAL SEARCH ============
  @Get('global-search')
  @ApiOperation({ summary: 'Búsqueda global inteligente para TopBar' })
  async globalSearch(@Query('q') query?: string) {
    if (!query || query.trim().length < 2) {
      return { clients: [], skus: [], receipts: [] };
    }
    const clean = query.trim();
    const tokens = clean.split(/\s+/).filter(t => t.length >= 2);

    const clientOR = tokens.map(t => ({
      OR: [
        { nombreComercial: { contains: t, mode: 'insensitive' as const } },
        { codigo: { contains: t, mode: 'insensitive' as const } },
        { rfc: { contains: t, mode: 'insensitive' as const } },
      ],
    }));

    const skuOR = tokens.map(t => ({
      OR: [
        { codigo: { contains: t, mode: 'insensitive' as const } },
        { descripcion: { contains: t, mode: 'insensitive' as const } },
        { codigoBarras: { contains: t, mode: 'insensitive' as const } },
      ],
    }));

    const receiptOR = tokens.map(t => ({
      OR: [
        { codigo: { contains: t, mode: 'insensitive' as const } },
        { facturaRespaldo: { contains: t, mode: 'insensitive' as const } },
        { ocReferencia: { contains: t, mode: 'insensitive' as const } },
        { nombreChofer: { contains: t, mode: 'insensitive' as const } },
        { placa: { contains: t, mode: 'insensitive' as const } },
        { cliente: { nombreComercial: { contains: t, mode: 'insensitive' as const } } },
      ],
    }));

    const [clients, skus, receipts] = await Promise.all([
      this.prisma.client.findMany({
        where: { OR: clientOR },
        take: 6,
        select: { id: true, codigo: true, nombreComercial: true, giro: true },
      }),
      this.prisma.skuMaster.findMany({
        where: { OR: skuOR },
        take: 6,
        select: { id: true, codigo: true, descripcion: true, codigoBarras: true, cliente: { select: { nombreComercial: true } } },
      }),
      this.prisma.receipt.findMany({
        where: { OR: receiptOR },
        take: 6,
        select: { id: true, codigo: true, facturaRespaldo: true, ocReferencia: true, estado: true, cliente: { select: { nombreComercial: true } } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return { clients, skus, receipts };
  }

  @Post('receipts')
  @ApiOperation({
    summary: 'Crear recepción previa (Modelo de datos recepciones_previas - Tarea 1)',
    description: 'Registra una nueva recepción previa en estado PENDIENTE_ARRIBO a partir de una estructura JSON con validación rigurosa de depositante, partidas esperadas (> 0), documento de respaldo y congruencia de catálogo.',
  })
  @ApiBody({ type: CreateReceiptPrevioDto })
  @ApiResponse({
    status: 201,
    description: 'Recepción previa creada exitosamente con sus partidas programadas.',
  })
  @ApiResponse({
    status: 400,
    description: 'Datos incompletos o violación de catálogo (clienteId ausente, partidas vacías, cantidad <= 0 o SKU ajeno).',
    type: ApiErrorResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Cliente depositante especificado no encontrado en base de datos.',
    type: ApiErrorResponseDto,
  })
  async createReceipt(@Body() data: any) {
    try {
      if (!data || typeof data !== 'object') {
        throw new HttpException(
          {
            statusCode: HttpStatus.BAD_REQUEST,
            message: 'Datos incompletos: El cuerpo de la solicitud no contiene un objeto válido.',
            error: 'Bad Request',
            detalles: { codigo: 'CUERPO_PETICION_VACIO' },
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      const { lineas, ...receiptData } = data;

      // 1. Validación de depositante (clienteId)
      if (!receiptData.clienteId || typeof receiptData.clienteId !== 'string' || receiptData.clienteId.trim() === '') {
        throw new HttpException(
          {
            statusCode: HttpStatus.BAD_REQUEST,
            message: 'Datos incompletos: Se requiere el identificador único del cliente depositante (clienteId).',
            error: 'Bad Request',
            detalles: { codigo: 'CLIENTE_ID_REQUERIDO', campo: 'clienteId' },
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      // Validar que el cliente exista en la base de datos
      const clienteExistente = await this.prisma.client.findUnique({
        where: { id: receiptData.clienteId },
      });
      if (!clienteExistente) {
        throw new HttpException(
          {
            statusCode: HttpStatus.NOT_FOUND,
            message: `El cliente depositante con ID "${receiptData.clienteId}" no existe en el catálogo.`,
            error: 'Not Found',
            detalles: { codigo: 'CLIENTE_NO_ENCONTRADO', clienteId: receiptData.clienteId },
          },
          HttpStatus.NOT_FOUND,
        );
      }

      // 2. Validación de documento de respaldo (factura o número de orden de compra)
      const facturaRespaldo = receiptData.facturaRespaldo ? String(receiptData.facturaRespaldo).trim() : null;
      const ocReferencia = receiptData.ocReferencia ? String(receiptData.ocReferencia).trim() : null;

      if (!facturaRespaldo && !ocReferencia) {
        throw new HttpException(
          {
            statusCode: HttpStatus.BAD_REQUEST,
            message: 'Datos incompletos: Se requiere al menos un documento de respaldo (factura comercial o número de orden de compra OC).',
            error: 'Bad Request',
            detalles: { codigo: 'DOCUMENTO_REFERENCIA_REQUERIDO', campos: ['facturaRespaldo', 'ocReferencia'] },
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      // 3. Validación de partidas / líneas de SKUs esperados
      if (!lineas || !Array.isArray(lineas) || lineas.length === 0) {
        throw new HttpException(
          {
            statusCode: HttpStatus.BAD_REQUEST,
            message: 'Datos incompletos: El manifiesto previo debe contener al menos una partida de SKU esperada en la lista.',
            error: 'Bad Request',
            detalles: { codigo: 'LINEAS_PREVIO_REQUERIDAS', campo: 'lineas' },
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      // Validar minuciosamente cada partida individual
      for (let i = 0; i < lineas.length; i++) {
        const l = lineas[i];
        if (!l.skuId || typeof l.skuId !== 'string' || l.skuId.trim() === '') {
          throw new HttpException(
            {
              statusCode: HttpStatus.BAD_REQUEST,
              message: `Datos incompletos: La partida #${i + 1} no cuenta con identificador de producto (skuId).`,
              error: 'Bad Request',
              detalles: { codigo: 'SKU_ID_REQUERIDO', posicion: i + 1, campo: 'skuId' },
            },
            HttpStatus.BAD_REQUEST,
          );
        }

        const qty = Number(l.cantidadEsperada ?? l.cantidad);
        if (isNaN(qty) || qty <= 0) {
          throw new HttpException(
            {
              statusCode: HttpStatus.BAD_REQUEST,
              message: `Datos incompletos o inválidos: La cantidad esperada en la partida #${i + 1} debe ser un número mayor a 0 (recibido: ${l.cantidadEsperada ?? l.cantidad}).`,
              error: 'Bad Request',
              detalles: { codigo: 'CANTIDAD_ESPERADA_INVALIDA', posicion: i + 1, valor: l.cantidadEsperada ?? l.cantidad },
            },
            HttpStatus.BAD_REQUEST,
          );
        }
      }

      const tipoImportacion = receiptData.tipoImportacion || (receiptData.origen === 'IMPORTACION' ? 'DEFINITIVA' : 'NO_APLICA');

      // Mapeo normalizado de líneas
      const lineasData = lineas.map((l: any) => {
        let parsedCad: Date | null = null;
        if (l.fechaVencimiento || l.fechaCaducidad) {
          const d = new Date(l.fechaVencimiento || l.fechaCaducidad);
          if (!isNaN(d.getTime())) parsedCad = d;
        }
        return {
          skuId: l.skuId,
          cantidadEsperada: Number(l.cantidadEsperada ?? l.cantidad),
          folio: l.folio ? String(l.folio) : null,
          sucursal: l.sucursal ? String(l.sucursal) : null,
          tipoContenedor: l.tipoContenedor || l.tipo || 'Caja máster',
          uom: l.uom || 'PZA',
          precioUnitario: l.precioUnitario ? Number(l.precioUnitario) : null,
          loteEsperado: l.loteEsperado || l.lote || null,
          fechaVencimiento: parsedCad,
          notas: l.notas || null,
        };
      });

      // Tarea 4: Validación automática cruzada contra catálogo del depositante
      const skuIds = lineasData.map((l: any) => l.skuId);
      const skusFound = await this.prisma.skuMaster.findMany({
        where: { id: { in: skuIds } },
        include: { cliente: { select: { id: true, nombreComercial: true } } },
      });

      const foreignSkus: string[] = [];
      const missingSkus: string[] = [];
      const skuMap = new Map(skusFound.map((s) => [s.id, s]));

      for (const id of skuIds) {
        const s = skuMap.get(id);
        if (!s) {
          missingSkus.push(id);
        } else if (s.clienteId !== receiptData.clienteId) {
          foreignSkus.push(`"${s.codigo}" (pertenece a ${s.cliente?.nombreComercial || 'otro depositante'})`);
        }
      }

      if (foreignSkus.length > 0) {
        throw new HttpException(
          {
            statusCode: HttpStatus.BAD_REQUEST,
            message: `Violación de catálogo: Se detectaron SKUs que no pertenecen al depositante ${clienteExistente.nombreComercial}: ${foreignSkus.join(', ')}`,
            error: 'Bad Request',
            detalles: { codigo: 'SKUS_AJENOS_DETECTADOS', foreignSkus },
          },
          HttpStatus.BAD_REQUEST,
        );
      }
      if (missingSkus.length > 0) {
        throw new HttpException(
          {
            statusCode: HttpStatus.BAD_REQUEST,
            message: `Los siguientes SKUs no existen en el catálogo maestro de productos: ${missingSkus.join(', ')}`,
            error: 'Bad Request',
            detalles: { codigo: 'SKUS_INEXISTENTES', missingSkus },
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      const inactiveSkus: string[] = [];
      for (const id of skuIds) {
        const s = skuMap.get(id);
        if (s && s.activo === false) {
          inactiveSkus.push(`"${s.codigo}" (${s.descripcion})`);
        }
      }
      if (inactiveSkus.length > 0) {
        throw new HttpException(
          {
            statusCode: HttpStatus.BAD_REQUEST,
            message: `El catálogo maestro indica que los siguientes SKUs se encuentran INACTIVOS y no pueden utilizarse en nuevas recepciones: ${inactiveSkus.join(', ')}. Reactívelos antes de continuar.`,
            error: 'Bad Request',
            detalles: { codigo: 'SKUS_INACTIVOS_DETECTADOS', inactiveSkus },
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      const receipt = await withConcurrencyRetry(async () => {
        const yearPrefix = `REC-${new Date().getFullYear()}-`;
        const existingReceipts = await this.prisma.receipt.findMany({
          where: { codigo: { startsWith: yearPrefix } },
          select: { codigo: true },
        });
        let maxSeq = 0;
        for (const r of existingReceipts) {
          const num = parseInt(r.codigo.replace(yearPrefix, ''), 10);
          if (!isNaN(num) && num > maxSeq) maxSeq = num;
        }
        const codigo = `${yearPrefix}${String(maxSeq + 1).padStart(4, '0')}`;

        return await this.prisma.receipt.create({
          data: {
            ...receiptData,
            codigo,
            estado: receiptData.estado || 'PENDIENTE_ARRIBO',
            facturaRespaldo: facturaRespaldo || null,
            ocReferencia: ocReferencia || null,
            tipoImportacion,
            lineas: { create: lineasData },
          },
          include: {
            cliente: { select: { id: true, nombreComercial: true, codigo: true } },
            proveedor: true,
            lineas: { include: { sku: true } },
          },
        });
      }, { contextName: 'createReceipt' });

      await this.audit(
        data.recibidoPor || 'Sistema',
        'CREAR_PREVIO_RECIBO',
        'Receipt',
        receipt.id,
        `${receipt.codigo}: Factura ${data.facturaRespaldo || data.ocReferencia || 'S/F'}, Importación: ${data.tipoImportacion || 'DEFINITIVA'}, ${lineasData.length} SKUs esperados`,
      );
      return receipt;
    } catch (error: any) {
      console.error('Error al crear recepción previa:', error);
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: error.message || 'Error interno al crear el previo de recibo',
          error: 'Internal Server Error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('receipts/previo')
  @ApiOperation({
    summary: 'Crear y cargar previo de recepción mediante formulario y/o carga de archivo (Tarea 2)',
    description: 'Endpoint dual para registrar un previo mediante captura de formulario o mediante subida de archivo Excel (.xlsx / .xls) con parseo automático en servidor y cruce con catálogo.',
  })
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiBody({ type: UploadPrevioDto })
  @ApiResponse({
    status: 201,
    description: 'Previo creado y procesado exitosamente vía Excel o formulario manual.',
  })
  @ApiResponse({
    status: 400,
    description: 'Datos incompletos, archivo vacío o no válido, o violación de catálogo.',
    type: ApiErrorResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Cliente depositante especificado no encontrado.',
    type: ApiErrorResponseDto,
  })
  @UseInterceptors(FileInterceptor('file'))
  async createOrUploadPrevio(
    @Body() body: any,
    @UploadedFile() file?: any,
  ) {
    try {
      // Validación temprana: se requiere archivo o partidas manuales
      const incomingLinesRaw = body?.lineas || body?.items;
      if (!file && !incomingLinesRaw) {
        throw new HttpException(
          {
            statusCode: HttpStatus.BAD_REQUEST,
            message: 'Datos incompletos: Debe proporcionar un archivo Excel con el manifiesto o al menos una partida de SKU esperada en la lista.',
            error: 'Bad Request',
            detalles: { codigo: 'ORIGEN_DATOS_PREVIO_VACIO', campos: ['file', 'lineas'] },
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      let clienteId = body?.clienteId;
      let archivoNombre: string | null = null;
      let rawRows: any[] = [];
      let fileWorkbook: any = null;

      // Si viene un archivo, prepararlo y realizar auto-detección de cliente si hace falta
      if (file && file.buffer) {
        archivoNombre = file.originalname;
        fileWorkbook = XLSX.read(file.buffer, { type: 'buffer', cellDates: true });
        const sheetName = fileWorkbook.SheetNames[0];
        if (!sheetName) {
          throw new HttpException(
            {
              statusCode: HttpStatus.BAD_REQUEST,
              message: 'El archivo Excel no contiene hojas de cálculo válidas.',
              error: 'Bad Request',
              detalles: { codigo: 'EXCEL_SIN_HOJAS' },
            },
            HttpStatus.BAD_REQUEST,
          );
        }
        const sheet = fileWorkbook.Sheets[sheetName];
        rawRows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

        if (rawRows.length === 0) {
          throw new HttpException(
            {
              statusCode: HttpStatus.BAD_REQUEST,
              message: 'El archivo Excel está vacío o no contiene filas de datos.',
              error: 'Bad Request',
              detalles: { codigo: 'EXCEL_VACIO' },
            },
            HttpStatus.BAD_REQUEST,
          );
        }

        // Validación de estructura: Verificar si el archivo contiene al menos una columna de SKU o código
        const sampleHeaders = rawRows.length > 0 ? Object.keys(rawRows[0]) : [];
        const hasSkuCol = sampleHeaders.some((h) => isExcelSkuHeader(normalizeExcelHeader(h)));
        if (!hasSkuCol) {
          throw new HttpException(
            {
              statusCode: HttpStatus.BAD_REQUEST,
              message:
                'Estructura de archivo incompatible: no se detectó ninguna columna de SKU o código de producto en el archivo Excel (se esperaba encabezado como "Código SKU", "SKU", "Ean", "Código", etc.).',
              error: 'Bad Request',
              detalles: {
                codigo: 'ESTRUCTURA_EXCEL_INCOMPATIBLE',
                encabezadosDetectados: sampleHeaders,
              },
            },
            HttpStatus.BAD_REQUEST,
          );
        }

        // Auto-detección de cliente depositante si no fue enviado en el cuerpo
        if (!clienteId) {
          const sampleCodes: string[] = [];
          for (const row of rawRows) {
            let code = '';
            for (const key of Object.keys(row)) {
              const h = normalizeExcelHeader(key);
              if (isExcelSkuHeader(h)) {
                code = String(row[key] ?? '').trim();
                if (code) break;
              }
            }
            if (code && !sampleCodes.includes(code)) {
              sampleCodes.push(code);
            }
          }

          if (sampleCodes.length > 0) {
            const matchedSkus = await this.prisma.skuMaster.findMany({
              where: {
                OR: [
                  { codigo: { in: sampleCodes, mode: 'insensitive' } },
                  { codigoBarras: { in: sampleCodes, mode: 'insensitive' } },
                ],
              },
              select: { clienteId: true },
            });

            if (matchedSkus.length > 0) {
              const votes: Record<string, number> = {};
              matchedSkus.forEach((s) => {
                votes[s.clienteId] = (votes[s.clienteId] || 0) + 1;
              });
              clienteId = Object.keys(votes).sort((a, b) => votes[b] - votes[a])[0];
            }
          }
        }
      }

      if (!clienteId) {
        throw new HttpException(
          {
            statusCode: HttpStatus.BAD_REQUEST,
            message: 'Datos incompletos: El cliente depositante (clienteId) es obligatorio o no se pudo deducir automáticamente a partir de los SKUs del manifiesto.',
            error: 'Bad Request',
            detalles: { codigo: 'CLIENTE_ID_REQUERIDO', campo: 'clienteId' },
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      // Validar cliente depositante en catálogo
      const cliente = await this.prisma.client.findUnique({
        where: { id: clienteId },
        include: { skus: true },
      });
      if (!cliente) {
        throw new HttpException('El cliente depositante especificado no existe', HttpStatus.NOT_FOUND);
      }

      let lineasParsed: any[] = [];
      let detectedFactura: string | null = null;
      let detectedOc: string | null = null;
      const partidasRechazadas: Array<{
        fila: number;
        codigo: string;
        descripcion?: string;
        motivo: string;
        tipo: 'INEXISTENTE' | 'AJENO' | 'DATO_INVALIDO';
        clientePropietario?: string;
      }> = [];

      // =======================================================
      // 1. PROCESAMIENTO DE ARCHIVO EXCEL (Server-Side)
      // =======================================================
      if (rawRows.length > 0) {
        const clientSkus = cliente.skus;
        const skuByCode = new Map<string, any>();
        const skuByBarcode = new Map<string, any>();

        for (const s of clientSkus) {
          if (s.codigo) skuByCode.set(s.codigo.trim().toLowerCase(), s);
          if (s.codigoBarras) skuByBarcode.set(s.codigoBarras.trim().toLowerCase(), s);
        }

        // Recolectar todos los códigos del archivo para búsqueda cruzada en la base de datos
        const allFileCodes: string[] = [];
        rawRows.forEach((row) => {
          Object.keys(row).forEach((k) => {
            const h = normalizeExcelHeader(k);
            if (isExcelSkuHeader(h)) {
              const val = String(row[k] ?? '').trim();
              if (val && !allFileCodes.includes(val)) allFileCodes.push(val);
            }
          });
        });

        // Buscar si los códigos pertenecen a otros clientes
        const otherClientSkus = await this.prisma.skuMaster.findMany({
          where: {
            OR: [
              { codigo: { in: allFileCodes, mode: 'insensitive' } },
              { codigoBarras: { in: allFileCodes, mode: 'insensitive' } },
            ],
            clienteId: { not: clienteId },
          },
          include: { cliente: { select: { nombreComercial: true } } },
        });

        const foreignSkuMap = new Map<string, any>();
        for (const s of otherClientSkus) {
          if (s.codigo) foreignSkuMap.set(s.codigo.trim().toLowerCase(), s);
          if (s.codigoBarras) foreignSkuMap.set(s.codigoBarras.trim().toLowerCase(), s);
        }

        rawRows.forEach((row, idx) => {
          const filaNum = idx + 2;
          const isEmptyRow = Object.values(row).every((v) => String(v ?? '').trim() === '');
          if (isEmptyRow) return;

          let rowFactura = '';
          let rowOc = '';
          let rowCodeOrEan = '';
          let rowDesc = '';
          let rowQty: number | null = null;
          let rowLote = '';
          let rowCaducidad = '';
          let rowPzCja: number | null = null;
          let rowCjas: number | null = null;

          Object.keys(row).forEach((key) => {
            const h = normalizeExcelHeader(key);
            const val = String(row[key] ?? '').trim();
            if (!val) return;

            if (isExcelSkuHeader(h) && !rowCodeOrEan) {
              rowCodeOrEan = val;
            } else if (isExcelQtyHeader(h) && rowQty === null) {
              const parsed = parseFloat(val);
              if (!isNaN(parsed)) rowQty = parsed;
            } else if (isExcelFacturaHeader(h) && !rowFactura) {
              rowFactura = val;
            } else if (isExcelOcHeader(h) && !rowOc) {
              rowOc = val;
            } else if (isExcelDescHeader(h) && !rowDesc) {
              rowDesc = val;
            } else if (isExcelLoteHeader(h) && !rowLote) {
              rowLote = val;
            } else if (isExcelCaducidadHeader(h) && !rowCaducidad) {
              rowCaducidad = val;
            } else if (isExcelPzCjaHeader(h) && rowPzCja === null) {
              const parsed = parseFloat(val);
              if (!isNaN(parsed) && parsed > 0) rowPzCja = parsed;
            } else if (isExcelCjasHeader(h) && rowCjas === null) {
              const parsed = parseFloat(val);
              if (!isNaN(parsed) && parsed > 0) rowCjas = parsed;
            }
          });

          if (!detectedFactura && rowFactura) {
            detectedFactura = rowFactura;
          }
          if (!detectedOc && rowOc) {
            detectedOc = rowOc;
          }

          // Validación estricta de partida
          if (!rowCodeOrEan) {
            partidasRechazadas.push({
              fila: filaNum,
              codigo: '(Vacío)',
              descripcion: rowDesc || undefined,
              motivo: 'Código SKU o EAN ausente en la fila',
              tipo: 'DATO_INVALIDO',
            });
            return;
          }

          if (rowQty === null || rowQty <= 0) {
            partidasRechazadas.push({
              fila: filaNum,
              codigo: rowCodeOrEan,
              descripcion: rowDesc || undefined,
              motivo: `Cantidad esperada inválida o menor a 1 (valor recibido: ${rowQty ?? 'vacío'})`,
              tipo: 'DATO_INVALIDO',
            });
            return;
          }

          const cleanCode = rowCodeOrEan.trim().toLowerCase();
          const matchedSku = skuByCode.get(cleanCode) || skuByBarcode.get(cleanCode);

          if (!matchedSku) {
            const foreign = foreignSkuMap.get(cleanCode);
            if (foreign) {
              const foreignName = foreign.cliente?.nombreComercial || 'Otro depositante';
              partidasRechazadas.push({
                fila: filaNum,
                codigo: rowCodeOrEan,
                descripcion: rowDesc || foreign.descripcion,
                motivo: `Producto de otro depositante (pertenece a: ${foreignName})`,
                tipo: 'AJENO',
                clientePropietario: foreignName,
              });
            } else {
              partidasRechazadas.push({
                fila: filaNum,
                codigo: rowCodeOrEan,
                descripcion: rowDesc || undefined,
                motivo: 'Producto inexistente en el catálogo general del WMS',
                tipo: 'INEXISTENTE',
              });
            }
            return;
          }

          if (matchedSku.activo === false) {
            partidasRechazadas.push({
              fila: filaNum,
              codigo: rowCodeOrEan,
              descripcion: matchedSku.descripcion,
              motivo: `El SKU "${matchedSku.codigo}" se encuentra INACTIVO en el catálogo maestro y no puede utilizarse en nuevos arribos o previos. Reactívelo antes de continuar.`,
              tipo: 'DATO_INVALIDO',
            });
            return;
          }

          // Validación de empaque ASN vs Catálogo Maestro
          const masterCap = matchedSku.capacidadEmpaque;
          if (rowPzCja !== null && masterCap && rowPzCja !== masterCap) {
            partidasRechazadas.push({
              fila: filaNum,
              codigo: rowCodeOrEan,
              descripcion: matchedSku.descripcion,
              motivo: `Empaque no coincide: el ASN declara ${rowPzCja} pzas/caja, pero el SKU ${matchedSku.codigo} está configurado en ${masterCap} pzas/caja. Corrija el archivo o revise el catálogo antes de crear el previo.`,
              tipo: 'DATO_INVALIDO',
            });
            return;
          }

          if (rowCjas !== null && masterCap) {
            const expectedCjas = Math.ceil(rowQty / masterCap);
            if (rowCjas !== expectedCjas) {
              partidasRechazadas.push({
                fila: filaNum,
                codigo: rowCodeOrEan,
                descripcion: matchedSku.descripcion,
                motivo: `Discrepancia en bultos declarados: el ASN declara ${rowCjas} caja(s), pero con el factor maestro de ${masterCap} pz/cja para ${rowQty} piezas corresponden ${expectedCjas} caja(s). Corrija el archivo o el catálogo antes de crear el previo.`,
                tipo: 'DATO_INVALIDO',
              });
              return;
            }
          }

          // Partida válida
          let parsedCaducidad: Date | null = null;
          if (rowCaducidad) {
            const d = new Date(rowCaducidad);
            if (!isNaN(d.getTime())) parsedCaducidad = d;
          }

          lineasParsed.push({
            skuId: matchedSku.id,
            cantidadEsperada: rowQty,
            uom: matchedSku.uomBase || 'PZA',
            tipoContenedor: 'Caja máster',
            loteEsperado: rowLote || null,
            fechaVencimiento: parsedCaducidad,
            notas: rowFactura ? `Factura archivo: ${rowFactura}` : undefined,
          });
        });

        // Rechazo total si existe al menos una partida inválida en el archivo
        if (partidasRechazadas.length > 0) {
          const resumenMotivos = Array.from(new Set(partidasRechazadas.map((p) => p.motivo))).join('; ');
          throw new HttpException(
            {
              statusCode: HttpStatus.BAD_REQUEST,
              message: `Rechazo total: El archivo contiene ${partidasRechazadas.length} partida(s) inválida(s) o rechazadas (${resumenMotivos}). Operación cancelada sin crear previo ni movimientos de inventario.`,
              error: 'Bad Request',
              detalles: {
                codigo: 'PARTIDAS_INVALIDAS_EN_PREVIO',
                totalLineas: lineasParsed.length + partidasRechazadas.length,
                validas: lineasParsed.length,
                invalidas: partidasRechazadas.length,
                partidasRechazadas,
              },
            },
            HttpStatus.BAD_REQUEST,
          );
        }

        if (lineasParsed.length === 0) {
          throw new HttpException(
            {
              statusCode: HttpStatus.BAD_REQUEST,
              message: `No se detectaron partidas válidas en el archivo para el depositante ${cliente.nombreComercial}.`,
              error: 'Bad Request',
              detalles: {
                codigo: 'SIN_LINEAS_VALIDAS',
                totalLineas: 0,
                validas: 0,
                invalidas: 0,
              },
            },
            HttpStatus.BAD_REQUEST,
          );
        }
      }

      // =======================================================
      // 2. PROCESAMIENTO DE FORMULARIO MANUAL (JSON / FORM-DATA)
      // =======================================================
      let manualLines: any[] = [];
      const incomingLines = body.lineas || body.items;
      if (incomingLines) {
        if (typeof incomingLines === 'string') {
          try {
            manualLines = JSON.parse(incomingLines);
          } catch {
            manualLines = [];
          }
        } else if (Array.isArray(incomingLines)) {
          manualLines = incomingLines;
        }
      }

      if (manualLines.length > 0) {
        const clientSkuIds = new Set(cliente.skus.map((s: any) => s.id));
        const foreignSkusManual: string[] = [];

        for (let idx = 0; idx < manualLines.length; idx++) {
          const l = manualLines[idx];
          if (!l.skuId || typeof l.skuId !== 'string' || l.skuId.trim() === '') {
            throw new HttpException(
              {
                statusCode: HttpStatus.BAD_REQUEST,
                message: `Datos incompletos: La partida #${idx + 1} no cuenta con SKU (skuId) obligatorio.`,
                error: 'Bad Request',
                detalles: { codigo: 'SKU_ID_REQUERIDO', posicion: idx + 1, campo: 'skuId' },
              },
              HttpStatus.BAD_REQUEST,
            );
          }

          const q = Number(l.cantidadEsperada ?? l.cantidad ?? 0);
          if (isNaN(q) || q <= 0) {
            throw new HttpException(
              {
                statusCode: HttpStatus.BAD_REQUEST,
                message: `Datos incompletos o inválidos: La cantidad esperada en la partida #${idx + 1} debe ser mayor a 0 (recibido: ${l.cantidadEsperada ?? l.cantidad}).`,
                error: 'Bad Request',
                detalles: { codigo: 'CANTIDAD_ESPERADA_INVALIDA', posicion: idx + 1, valor: l.cantidadEsperada ?? l.cantidad },
              },
              HttpStatus.BAD_REQUEST,
            );
          }

          if (!clientSkuIds.has(l.skuId)) {
            const foreign = await this.prisma.skuMaster.findUnique({
              where: { id: l.skuId },
              include: { cliente: { select: { nombreComercial: true } } },
            });
            const msg = foreign ? `"${foreign.codigo}" (pertenece a "${foreign.cliente?.nombreComercial}")` : `SKU ID ${l.skuId}`;
            foreignSkusManual.push(msg);
            continue;
          }

          const matchedSku = cliente.skus.find((s: any) => s.id === l.skuId);
          if (matchedSku && matchedSku.activo === false) {
            throw new HttpException(
              {
                statusCode: HttpStatus.BAD_REQUEST,
                message: `El SKU "${matchedSku.codigo}" se encuentra INACTIVO en el catálogo maestro y no puede utilizarse en nuevos arribos o previos. Reactívelo antes de continuar.`,
                error: 'Bad Request',
                detalles: { codigo: 'SKU_INACTIVO', sku: matchedSku.codigo },
              },
              HttpStatus.BAD_REQUEST,
            );
          }

          if (matchedSku?.capacidadEmpaque) {
            const masterCap = matchedSku.capacidadEmpaque;
            const pzCja = l.piezasPorCaja !== undefined && l.piezasPorCaja !== null && String(l.piezasPorCaja).trim() !== ''
              ? Number(l.piezasPorCaja) : null;
            if (pzCja !== null && !isNaN(pzCja) && pzCja !== masterCap) {
              throw new HttpException(
                {
                  statusCode: HttpStatus.BAD_REQUEST,
                  message: `Empaque no coincide: el ASN declara ${pzCja} pzas/caja, pero el SKU ${matchedSku.codigo} está configurado en ${masterCap} pzas/caja. Corrija el archivo o revise el catálogo antes de crear el previo.`,
                  error: 'Bad Request',
                  detalles: { codigo: 'EMPAQUE_DISCREPANCIA', sku: matchedSku.codigo, declaredPzCja: pzCja, masterCap },
                },
                HttpStatus.BAD_REQUEST,
              );
            }

            const cjas = l.cajas !== undefined && l.cajas !== null && String(l.cajas).trim() !== ''
              ? Number(l.cajas) : null;
            if (cjas !== null && !isNaN(cjas)) {
              const expectedCjas = Math.ceil(q / masterCap);
              if (cjas !== expectedCjas) {
                throw new HttpException(
                  {
                    statusCode: HttpStatus.BAD_REQUEST,
                    message: `Discrepancia en bultos declarados: el ASN declara ${cjas} caja(s), pero con el factor maestro de ${masterCap} pz/cja para ${q} piezas corresponden ${expectedCjas} caja(s). Corrija el archivo o el catálogo antes de crear el previo.`,
                    error: 'Bad Request',
                    detalles: { codigo: 'BULTOS_DISCREPANCIA', sku: matchedSku.codigo, declaredCjas: cjas, expectedCjas },
                  },
                  HttpStatus.BAD_REQUEST,
                );
              }
            }
          }

          let parsedCadManual: Date | null = null;
          if (l.fechaVencimiento || l.fechaCaducidad) {
            const d = new Date(l.fechaVencimiento || l.fechaCaducidad);
            if (!isNaN(d.getTime())) parsedCadManual = d;
          }

          lineasParsed.push({
            skuId: l.skuId,
            cantidadEsperada: q,
            folio: l.folio ? String(l.folio) : null,
            sucursal: l.sucursal ? String(l.sucursal) : null,
            tipoContenedor: l.tipoContenedor || l.tipo || 'Caja máster',
            uom: l.uom || 'PZA',
            precioUnitario: l.precioUnitario ? Number(l.precioUnitario) : null,
            loteEsperado: l.loteEsperado || l.lote || null,
            fechaVencimiento: parsedCadManual,
            notas: l.notas || 'Captura manual por formulario',
          });
        }

        if (foreignSkusManual.length > 0) {
          throw new HttpException(
            {
              statusCode: HttpStatus.BAD_REQUEST,
              message: `Violación de catálogo: Se intentó agregar SKUs que no pertenecen al depositante ${cliente.nombreComercial}: ${foreignSkusManual.join(', ')}`,
              error: 'Bad Request',
              detalles: { codigo: 'SKUS_AJENOS_DETECTADOS', foreignSkus: foreignSkusManual },
            },
            HttpStatus.BAD_REQUEST,
          );
        }
      }

      if (lineasParsed.length === 0) {
        throw new HttpException(
          {
            statusCode: HttpStatus.BAD_REQUEST,
            message: `No se detectaron partidas válidas para el previo del depositante ${cliente.nombreComercial}.`,
            error: 'Bad Request',
            detalles: {
              codigo: 'SIN_LINEAS_VALIDAS',
            },
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      const facturaRespaldo = (body.facturaRespaldo || detectedFactura || '').trim() || null;
      const ocReferencia = (body.ocReferencia || detectedOc || '').trim() || null;
      const origen = body.origen || 'NACIONAL';
      const tipoImportacion = body.tipoImportacion || 'DEFINITIVA';
      const tipoRecepcion = body.tipoRecepcion || 'DIRECTA';

      // Generar folio consecutivo y crear previo con reintentos automáticos
      const receipt = await withConcurrencyRetry(async () => {
        const yearPrefixManual = `REC-${new Date().getFullYear()}-`;
        const existingReceiptsManual = await this.prisma.receipt.findMany({
          where: { codigo: { startsWith: yearPrefixManual } },
          select: { codigo: true },
        });
        let maxSeqManual = 0;
        for (const r of existingReceiptsManual) {
          const num = parseInt(r.codigo.replace(yearPrefixManual, ''), 10);
          if (!isNaN(num) && num > maxSeqManual) maxSeqManual = num;
        }
        const codigo = `${yearPrefixManual}${String(maxSeqManual + 1).padStart(4, '0')}`;

        return await this.prisma.receipt.create({
          data: {
            codigo,
            clienteId,
            proveedorId: body.proveedorId || null,
            proveedorNombre: body.proveedorNombre || null,
            facturaRespaldo,
            ocReferencia,
            origen,
            tipoImportacion,
            tipoRecepcion,
            lineaTransporte: body.lineaTransporte || null,
            capacidadCarga: body.capacidadCarga || null,
            placa: body.placa ? String(body.placa).toUpperCase() : null,
            nombreChofer: body.nombreChofer || null,
            folioTransporte: body.folioTransporte || null,
            archivoPrevioUrl: archivoNombre || body.archivoPrevioUrl || null,
            notas: body.notas || (archivoNombre ? `Importado vía Excel: ${archivoNombre}` : 'Creado vía formulario manual'),
            recibidoPor: body.recibidoPor || body.usuario || 'Operador',
            estado: 'PENDIENTE_ARRIBO',
            lineas: {
              create: lineasParsed,
            },
          },
          include: {
            cliente: { select: { id: true, nombreComercial: true, codigo: true } },
            proveedor: true,
            lineas: { include: { sku: true } },
          },
        });
      }, { contextName: 'createReceiptManual' });

      const totalUnidades = lineasParsed.reduce((sum, l) => sum + (l.cantidadEsperada || 0), 0);

      await this.audit(
        body.usuario || body.recibidoPor || 'Sistema',
        file ? 'CARGAR_PREVIO_EXCEL' : 'CREAR_PREVIO_MANUAL',
        'Receipt',
        receipt.id,
        `${receipt.codigo}: ${lineasParsed.length} líneas (${totalUnidades} Uds) · Factura: ${facturaRespaldo || 'S/F'} · Origen: ${origen} · Archivo: ${archivoNombre || 'Formulario'}`,
      );

      return {
        success: true,
        message: `Previo ${receipt.codigo} creado exitosamente con ${lineasParsed.length} líneas (${totalUnidades} unidades esperadas)`,
        data: receipt,
        estadisticas: {
          totalLineas: lineasParsed.length,
          totalUnidadesEsperadas: totalUnidades,
          archivoProcesado: archivoNombre,
          codigosNoEncontrados: [],
          skusAjenos: [],
          skusInexistentes: [],
        },
      };
    } catch (error: any) {
      console.error('Error en createOrUploadPrevio:', error);
      if (error instanceof HttpException) throw error;
      throw new HttpException(error.message || 'Error interno al procesar el previo', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post('receipts/:id/lock')
  @ApiOperation({
    summary: 'Confirmar previo y activar candado de bloqueo de edición (Tarea 3)',
    description: 'Confirma el arribo del transporte a andén y bloquea la edición del previo para resguardar la integridad contra el conteo físico a ciegas.',
  })
  @ApiParam({ name: 'id', description: 'Identificador único UUID de la recepción previa' })
  @ApiBody({ type: LockReceiptDto, required: false })
  @ApiResponse({ status: 200, description: 'Previo confirmado y candado operativo activado exitosamente.' })
  @ApiResponse({ status: 400, description: 'El previo no contiene partidas registradas para confirmar.', type: ApiErrorResponseDto })
  @ApiResponse({ status: 403, description: 'Operación denegada: La recepción ya se encuentra CERRADA.', type: ApiErrorResponseDto })
  @ApiResponse({ status: 404, description: 'Recepción previa no encontrada.', type: ApiErrorResponseDto })
  async lockReceipt(@Param('id') receiptId: string, @Body() body?: { usuario?: string; notas?: string }) {
    try {
      const receipt = await this.prisma.receipt.findUnique({ where: { id: receiptId }, include: { lineas: true } });
      if (!receipt) {
        throw new HttpException(
          {
            statusCode: HttpStatus.NOT_FOUND,
            message: `Previo de recibo con ID "${receiptId}" no encontrado.`,
            error: 'Not Found',
            detalles: { codigo: 'RECEPCION_NO_ENCONTRADA', receiptId },
          },
          HttpStatus.NOT_FOUND,
        );
      }

      if (receipt.estado === 'CERRADO' || receipt.estado === 'CERRADA') {
        throw new HttpException(
          {
            statusCode: HttpStatus.FORBIDDEN,
            message: 'Operación denegada: La recepción ya está CERRADA en almacén y no admite modificaciones.',
            error: 'Forbidden',
            detalles: { codigo: 'RECEPCION_CERRADA' },
          },
          HttpStatus.FORBIDDEN,
        );
      }

      if (receipt.lineas.length === 0) {
        throw new HttpException(
          {
            statusCode: HttpStatus.BAD_REQUEST,
            message: 'No se puede confirmar un previo sin partidas de SKU registradas.',
            error: 'Bad Request',
            detalles: { codigo: 'PREVIO_SIN_PARTIDAS' },
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      const usuario = body?.usuario || 'Supervisor';
      const now = new Date();

      const updated = await this.prisma.receipt.update({
        where: { id: receiptId },
        data: {
          bloqueado: true,
          bloqueadoPor: usuario,
          fechaBloqueo: now,
          fechaConfirmacion: receipt.fechaConfirmacion || now,
          estado: (receipt.estado === 'PENDIENTE' || receipt.estado === 'PENDIENTE_ARRIBO') ? 'EN_PROCESO_CONTEO' : receipt.estado,
        },
        include: { cliente: true, proveedor: true, lineas: { include: { sku: true } } },
      });

      await this.audit(usuario, 'CONFIRMAR_BLOQUEAR_PREVIO', 'Receipt', receiptId, `Previo ${receipt.codigo} confirmado y bloqueado contra edición`);

      return {
        success: true,
        message: `Previo ${receipt.codigo} confirmado exitosamente. Candado de edición activado.`,
        receipt: updated,
      };
    } catch (error: any) {
      console.error('Error al bloquear previo:', error);
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: error.message || 'Error interno al confirmar previo',
          error: 'Internal Server Error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // =========================================================================
  // FASE 2: INSPECCIÓN INTERNA Y REACONDICIONAMIENTO (MAQUILA / RESCATE)
  // =========================================================================

  @Get('receipts/:id/inspection-pending')
  @ApiOperation({ summary: 'Obtener cajas retenidas pendientes de inspección de calidad (Fase 2)' })
  async getPendingInspectionBoxes(@Param('id') receiptId: string) {
    const receipt = await this.prisma.receipt.findFirst({
      where: {
        OR: [{ id: receiptId }, { codigo: receiptId }],
      },
      include: {
        cliente: true,
        lineas: { include: { sku: true } },
        handlingUnits: {
          orderBy: { codigo: 'asc' },
        },
      },
    });
    if (!receipt) throw new HttpException('Previo no encontrado', HttpStatus.NOT_FOUND);

    // Cajas que tienen condición RETENIDA, DAÑADO o código con DANO, y que aún no han sido procesadas / inactivadas
    const pendingBoxes = receipt.handlingUnits.filter(
      (h) =>
        h.tipoHu === 'CAJA' &&
        (h.estadoHu === 'RETENIDA' || h.estadoHu === 'DAÑADO' || h.codigo.includes('DANO')) &&
        !h.reacondicionada &&
        h.estadoHu !== 'INACTIVO'
    );

    // Cajas procesadas/reacondicionadas previamente
    const processedBoxes = receipt.handlingUnits.filter(
      (h) =>
        h.tipoHu === 'CAJA' &&
        (h.codigo.includes('DANO') || h.estadoHu === 'INACTIVO') &&
        (h.reacondicionada || h.inspeccionId != null) &&
        !h.cajaOrigenId
    );

    const bultosDanadosDeclarados = Number(receipt.bultosDanados) || 0;
    // Las cajas dañadas identificadas son las pendientes más las que ya fueron dictaminadas
    const totalIdentified = pendingBoxes.length + processedBoxes.length;
    const unidentifiedDamagedCount = Math.max(0, bultosDanadosDeclarados - totalIdentified);

    return {
      receiptId: receipt.id,
      receiptCodigo: receipt.codigo,
      cliente: receipt.cliente?.nombreComercial || receipt.cliente?.razonSocial,
      facturaRespaldo: receipt.facturaRespaldo || receipt.ocReferencia,
      bultosDanadosDeclarados,
      unidentifiedDamagedCount,
      totalPendingBoxes: pendingBoxes.length,
      pendingBoxes: pendingBoxes.map((b) => ({
        id: b.id,
        codigo: b.codigo,
        skuCodigo: b.skuCodigo,
        skuDescripcion: (b.skuDescripcion || '').replace('[DAÑO EXTERIOR] ', ''),
        loteTexto: b.loteTexto || 'S/L',
        fechaVencimiento: b.fechaVencimiento,
        piezasTotales: b.piezasPorCaja || b.cantidad || 0,
        parentPalletId: b.parentHuId,
        ubicacionActual: b.ubicacionActual || 'AREA_CALIDAD',
        facturaRespaldo: b.facturaRespaldo,
        motivoDano: b.motivoDano,
        receiptLineId: b.receiptLineId,
      })),
      processedBoxesCount: processedBoxes.length,
      inspeccionCalidadEstado: receipt.inspeccionCalidadEstado || 'PENDIENTE',
      lineasDisponibles: receipt.lineas.map((l) => ({
        id: l.id,
        skuId: l.skuId,
        skuCodigo: l.sku?.codigo || 'SKU',
        skuDescripcion: l.sku?.descripcion || 'Producto',
        lote: l.loteAsignado || l.loteEsperado || 'S/LOTE',
        fechaVencimiento: l.fechaVencimiento,
        piezasPorCaja: l.sku?.capacidadEmpaque && l.sku.capacidadEmpaque > 0 ? l.sku.capacidadEmpaque : (l.uom === 'CAJA' ? 1 : 12),
        uom: l.uom || 'PZA',
        cantidadEsperada: l.cantidadEsperada || 0,
        cantidadDanada: l.cantidadDanada || 0,
      })),
    };
  }

  @Post('receipts/:id/identify-damaged-box')
  @ApiOperation({ summary: 'Identificar físicamente un bulto dañado y vincularlo con su partida (Fase 2)' })
  @HttpCode(HttpStatus.OK)
  async identifyDamagedBox(
    @Param('id') receiptId: string,
    @Body() body: IdentifyDamagedBoxDto,
  ) {
    const receipt = await this.prisma.receipt.findFirst({
      where: { OR: [{ id: receiptId }, { codigo: receiptId }] },
      include: {
        cliente: true,
        lineas: { include: { sku: true } },
        handlingUnits: { orderBy: { codigo: 'asc' } },
      },
    });
    if (!receipt) throw new HttpException('Previo no encontrado', HttpStatus.NOT_FOUND);
    if (receipt.estado === 'CERRADA' || receipt.estado === 'CERRADO') {
      throw new HttpException('No se puede modificar una recepción CERRADA inmutable.', HttpStatus.BAD_REQUEST);
    }

    const line = receipt.lineas.find((l) => l.id === body.receiptLineId);
    if (!line) {
      throw new HttpException(`Partida con ID ${body.receiptLineId} no encontrada en este previo.`, HttpStatus.NOT_FOUND);
    }

    const sku = line.sku;
    const stdCapacidad = sku?.capacidadEmpaque && sku.capacidadEmpaque > 0 ? sku.capacidadEmpaque : (line.uom === 'CAJA' ? 1 : 12);
    const piezasTotales = Number(body.piezasTotales) > 0 ? Number(body.piezasTotales) : stdCapacidad;
    const loteTexto = (body.loteTexto || line.loteAsignado || line.loteEsperado || 'S/LOTE').trim();
    const fechaVencimiento = body.fechaVencimiento ? new Date(body.fechaVencimiento) : (line.fechaVencimiento || null);
    const motivoDano = (body.motivoDano || 'Rotura de envase por compresión / estiba pesada').trim();
    const usuario = (body.usuario || 'Inspector de Calidad').trim();

    // Contar cajas existentes para generar folio único correlativo
    const allBoxes = receipt.handlingUnits.filter((h) => h.tipoHu === 'CAJA');
    const boxIndex = allBoxes.length + 1;
    const boxCodigo = `BOX-${receipt.codigo}-${String(boxIndex).padStart(4, '0')}-DANO`;

    // 1. Crear HandlingUnit con estado RETENIDA y ubicación AREA_CALIDAD
    const newHu = await this.prisma.handlingUnit.create({
      data: {
        codigo: boxCodigo,
        tipoHu: 'CAJA',
        clienteId: receipt.clienteId,
        receiptId: receipt.id,
        receiptLineId: line.id,
        cantidad: piezasTotales,
        uom: line.uom || sku?.uomBase || 'PZA',
        ubicacionActual: 'AREA_CALIDAD',
        estadoHu: 'RETENIDA', // ESTADO DE RETENCIÓN / PENDIENTE_CALIDAD
        estadoEtiqueta: 'GENERADA',
        skuCodigo: sku.codigo,
        skuDescripcion: `[DAÑO EXTERIOR] ${sku.descripcion}`,
        loteTexto,
        fechaVencimiento,
        facturaRespaldo: receipt.facturaRespaldo || receipt.ocReferencia || receipt.codigo,
        piezasPorCaja: piezasTotales,
        motivoDano,
        reacondicionada: false,
      },
    });

    // 2. Actualizar la partida ReceiptLine para registrar formalmente la cantidad dañada
    const currentDanada = Number(line.cantidadDanada || 0);
    await this.prisma.receiptLine.update({
      where: { id: line.id },
      data: {
        cantidadDanada: currentDanada + piezasTotales,
        loteAsignado: line.loteAsignado || loteTexto,
        fechaVencimiento: line.fechaVencimiento || fechaVencimiento,
      },
    });

    // 3. Si el estado de calidad del previo estaba en PENDIENTE, cambiar a EN_PROCESO
    if (receipt.inspeccionCalidadEstado === 'PENDIENTE') {
      await this.prisma.receipt.update({
        where: { id: receipt.id },
        data: {
          inspeccionCalidadEstado: 'EN_PROCESO',
        },
      });
    }

    // 4. Registro de auditoría
    await this.audit(
      usuario,
      'IDENTIFICACION_BULTO_DANADO',
      'HandlingUnit',
      newHu.id,
      `Bulto dañado identificado físicamente para partida ${sku.codigo} (${piezasTotales} pzas, Lote: ${loteTexto}) como HU ${boxCodigo} (RETENIDA).`,
    );

    return {
      success: true,
      message: `Bulto identificado exitosamente y registrado en Calidad como ${boxCodigo} (RETENIDA).`,
      handlingUnit: newHu,
    };
  }

  @Post('receipts/:id/inspection/execute')
  @ApiOperation({ summary: 'Ejecutar inspección de calidad, rescate y reacondicionamiento en maquila' })
  @HttpCode(HttpStatus.OK)
  async executeQualityInspection(
    @Param('id') receiptId: string,
    @Body() body: ExecuteQualityInspectionDto,
  ) {
    const receipt = await this.prisma.receipt.findFirst({
      where: { OR: [{ id: receiptId }, { codigo: receiptId }] },
      include: {
        cliente: true,
        lineas: { include: { sku: true } },
        handlingUnits: { orderBy: { codigo: 'asc' } },
      },
    });
    if (!receipt) throw new HttpException('Previo no encontrado', HttpStatus.NOT_FOUND);
    if (receipt.estado === 'CERRADA' || receipt.estado === 'CERRADO') {
      throw new HttpException('No se puede realizar inspección en una recepción CERRADA inmutable.', HttpStatus.BAD_REQUEST);
    }

    if (!body.items || body.items.length === 0) {
      throw new HttpException('Debe ingresar al menos una caja para dictamen de inspección.', HttpStatus.BAD_REQUEST);
    }

    const inspectorNombre = (body.inspectorNombre || 'Inspector de Calidad').trim();
    const now = new Date();

    // Protección de concurrencia: si dos dictámenes se ejecutan simultáneamente y colisionan
    // en folio o correlativos (P2002), se reintenta automáticamente recalculando el siguiente correlativo.
    const maxRetries = 5;
    let attempt = 0;

    while (attempt < maxRetries) {
      attempt++;
      try {
        return await this.prisma.$transaction(async (tx) => {
          const receipt = await tx.receipt.findFirst({
            where: { OR: [{ id: receiptId }, { codigo: receiptId }] },
            include: {
              cliente: true,
              lineas: { include: { sku: true } },
              handlingUnits: { orderBy: { codigo: 'asc' } },
            },
          });
          if (!receipt) throw new HttpException('Previo no encontrado', HttpStatus.NOT_FOUND);
          if (receipt.estado === 'CERRADA' || receipt.estado === 'CERRADO') {
            throw new HttpException('No se puede realizar inspección en una recepción CERRADA inmutable.', HttpStatus.BAD_REQUEST);
          }

          // 1. Generar folio de inspección correlativo seguro anti-colisión
          const existingInspections = await tx.qualityInspection.findMany({
            select: { folio: true },
          });
          let maxFolioNum = 0;
          for (const qi of existingInspections) {
            if (qi.folio) {
              const m = qi.folio.match(/INSP-(\d{4})-(\d+)/);
              if (m) {
                const num = parseInt(m[2], 10);
                if (!isNaN(num) && num > maxFolioNum) {
                  maxFolioNum = num;
                }
              }
            }
          }
          let nextFolioIndex = maxFolioNum + 1;
          let folioInspeccion = `INSP-2026-${String(nextFolioIndex).padStart(4, '0')}`;
          while (await tx.qualityInspection.findUnique({ where: { folio: folioInspeccion } })) {
            nextFolioIndex++;
            folioInspeccion = `INSP-2026-${String(nextFolioIndex).padStart(4, '0')}`;
          }

          // 2. Costeo del servicio 3PL
          const horasMaquila = Number(body.horasMaquila || 0);
          const tarifaPorHora = Number(body.tarifaMaquilaPorHora || 0);
          const costoTotalMaquila = horasMaquila * tarifaPorHora;

          // 3. Crear registro maestro de QualityInspection
          const inspection = await tx.qualityInspection.create({
            data: {
              folio: folioInspeccion,
              receiptId: receipt.id,
              clienteId: receipt.clienteId,
              fechaInspeccion: now,
              inspectorNombre,
              estado: 'COMPLETADA',
              totalCajasInspeccionadas: body.items.length,
              totalPiezasInspeccionadas: 0,
              totalPiezasRescatadas: 0,
              totalPiezasMerma: 0,
              totalCajasNuevasArmadas: 0,
              horasMaquila,
              tarifaMaquilaPorHora: tarifaPorHora,
              costoTotalMaquila,
              observaciones: body.observacionesGenerales || 'Inspección interna y reacondicionamiento completados exitosamente.',
              detallesJson: '[]',
              firmadoPor: inspectorNombre,
            },
          });

          let totalPiezasInspeccionadas = 0;
          let totalPiezasRescatadas = 0;
          let totalPiezasMerma = 0;
          const nuevasCajasCreadas: any[] = [];
          const cajasDetalleAudit: any[] = [];

          // Determinar consecutivo seguro para numeración de nuevas cajas
          const prefix = `BOX-${receipt.codigo}-`;
          let maxExistingBoxNum = 0;
          for (const h of receipt.handlingUnits) {
            if (h.tipoHu === 'CAJA' && h.codigo && h.codigo.startsWith(prefix)) {
              const suffix = h.codigo.substring(prefix.length);
              const numMatch = suffix.match(/^(\d{1,6})/);
              if (numMatch) {
                const num = parseInt(numMatch[1], 10);
                if (!isNaN(num) && num > maxExistingBoxNum) {
                  maxExistingBoxNum = num;
                }
              }
            }
          }
          let nextBoxIndex = maxExistingBoxNum;

          // 4. Procesar cada caja dictaminada
          for (const item of body.items) {
            const box = receipt.handlingUnits.find((h) => h.id === item.huId);
            if (!box) {
              throw new HttpException(`Caja con ID ${item.huId} no encontrada en este previo.`, HttpStatus.NOT_FOUND);
            }

            // Validar idempotencia: no se permite volver a dictaminar una caja inactiva o ya procesada
            if (box.estadoHu === 'INACTIVO' || box.inspeccionId || (box.reacondicionada && box.cajaOrigenId)) {
              throw new HttpException(
                `La caja ${box.codigo} ya fue dictaminada previamente y no puede ser procesada nuevamente.`,
                HttpStatus.BAD_REQUEST,
              );
            }

            const pTotales = Number(item.piezasTotales || box.piezasPorCaja || box.cantidad || 0);
            const pRescatadas = Number(item.piezasRescatadas || 0);
            const pMerma = Number(item.piezasMerma || 0);

            if (pRescatadas + pMerma !== pTotales) {
              throw new HttpException(
                `La suma de piezas rescatadas (${pRescatadas}) y merma (${pMerma}) debe ser exactamente igual a las piezas totales (${pTotales}) en la caja ${box.codigo}.`,
                HttpStatus.BAD_REQUEST,
              );
            }

            totalPiezasInspeccionadas += pTotales;
            totalPiezasRescatadas += pRescatadas;
            totalPiezasMerma += pMerma;

            // Desactivar la caja dañada original y marcarla histórica/inactiva vinculada a la inspección
            await tx.handlingUnit.update({
              where: { id: box.id },
              data: {
                estadoHu: 'INACTIVO',
                reacondicionada: true,
                motivoDano: item.motivoDano || 'Empaque dañado en transporte / inspección realizada',
                inspeccionId: inspection.id,
              },
            });

            // Si se rescataron piezas y se solicita armar cajas conformes
            const createdBoxesForItem: any[] = [];
            if (pRescatadas > 0 && body.armarCajasConformes !== false) {
              const stdPiezas = box.piezasPorCaja || 12;
              let piezasRestantes = pRescatadas;

              while (piezasRestantes > 0) {
                nextBoxIndex++;
                let newBoxCode = `BOX-${receipt.codigo}-${String(nextBoxIndex).padStart(4, '0')}`;
                while (await tx.handlingUnit.findUnique({ where: { codigo: newBoxCode } })) {
                  nextBoxIndex++;
                  newBoxCode = `BOX-${receipt.codigo}-${String(nextBoxIndex).padStart(4, '0')}`;
                }

                const piezasEstaCaja = Math.min(piezasRestantes, stdPiezas);
                piezasRestantes -= piezasEstaCaja;

                const newHu = await tx.handlingUnit.create({
                  data: {
                    codigo: newBoxCode,
                    tipoHu: 'CAJA',
                    clienteId: receipt.clienteId,
                    receiptId: receipt.id,
                    receiptLineId: box.receiptLineId,
                    cantidad: piezasEstaCaja,
                    uom: 'PZA',
                    ubicacionActual: 'RAMPA_RECEPCION',
                    estadoHu: 'ACTIVO',
                    parentHuId: box.parentHuId,
                    estadoEtiqueta: 'GENERADA',
                    loteTexto: box.loteTexto,
                    fechaVencimiento: box.fechaVencimiento,
                    skuCodigo: box.skuCodigo,
                    skuDescripcion: (box.skuDescripcion || '').replace('[DAÑO EXTERIOR] ', ''),
                    facturaRespaldo: box.facturaRespaldo,
                    piezasPorCaja: piezasEstaCaja,
                    reacondicionada: true,
                    cajaOrigenId: box.id,
                    inspeccionId: inspection.id,
                  },
                });
                createdBoxesForItem.push(newHu);
                nuevasCajasCreadas.push(newHu);
              }
            }

            cajasDetalleAudit.push({
              cajaOrigenCodigo: box.codigo,
              cajaOrigenId: box.id,
              skuCodigo: box.skuCodigo,
              loteTexto: box.loteTexto,
              piezasTotales: pTotales,
              piezasRescatadas: pRescatadas,
              piezasMerma: pMerma,
              motivoDano: item.motivoDano || 'Revisión técnica de calidad',
              observaciones: item.observaciones || '',
              nuevasCajasGeneradas: createdBoxesForItem.map((nb) => ({ id: nb.id, codigo: nb.codigo, cantidad: nb.cantidad })),
            });

            // Reajustar la partida del previo en ReceiptLine si corresponde
            if (box.receiptLineId) {
              const line = receipt.lineas.find((l) => l.id === box.receiptLineId);
              if (line) {
                const currentRecibida = Number(line.cantidadRecibida || 0);
                const currentDanada = Number(line.cantidadDanada || 0);
                const newDanada = Math.max(0, currentDanada - pRescatadas);
                const newRecibida = currentRecibida + pRescatadas;

                await tx.receiptLine.update({
                  where: { id: line.id },
                  data: {
                    cantidadRecibida: newRecibida,
                    cantidadDanada: newDanada,
                    notas: `${line.notas || ''} | [Control de Calidad]: Rescatadas ${pRescatadas} pzas, Merma dictaminada: ${pMerma} pzas.`.trim(),
                  },
                });
              }
            }

            // Asiento formal de merma en Almacén Virtual No Conforme / Merma (DEV-01) si pMerma > 0
            if (pMerma > 0) {
              const line = receipt.lineas.find((l) => l.id === box.receiptLineId);
              const skuId = line?.skuId || receipt.lineas[0]?.skuId;
              const sku = line?.sku || (skuId ? await tx.skuMaster.findUnique({ where: { id: skuId } }) : null);

              if (sku) {
                const devLoc = await this.ensureVirtualMermaLocation(tx);
                const lotVirtual = await tx.lotInventory.create({
                  data: {
                    skuId: sku.id,
                    clienteId: receipt.clienteId,
                    lote: box.loteTexto || line?.loteAsignado || null,
                    fechaVencimiento: box.fechaVencimiento || line?.fechaVencimiento || null,
                    estadoCalidad: 'MERMA',
                    cantidadBloqueada: pMerma,
                    cantidadDisponible: 0,
                    cantidadReservada: 0,
                    ubicacionId: devLoc.id,
                    notas: `[ALMACEN_VIRTUAL_NC] MERMA: ${item.motivoDano || 'Dictamen de calidad'} | Dictamen: ${folioInspeccion} | Origen: ${box.codigo} | Previo: ${receipt.codigo}`,
                  },
                });

                // HU segregada en almacén virtual con numeración segura y ubicación legible DEV-01
                let mermaIndex = 1;
                let huMermaCode = `HU-NC-${receipt.codigo}-MERMA-${String(mermaIndex).padStart(2, '0')}`;
                while (await tx.handlingUnit.findUnique({ where: { codigo: huMermaCode } })) {
                  mermaIndex++;
                  huMermaCode = `HU-NC-${receipt.codigo}-MERMA-${String(mermaIndex).padStart(2, '0')}`;
                }

                const huMerma = await tx.handlingUnit.create({
                  data: {
                    codigo: huMermaCode,
                    tipoHu: 'CAJA',
                    lotId: lotVirtual.id,
                    clienteId: receipt.clienteId,
                    receiptId: receipt.id,
                    receiptLineId: box.receiptLineId,
                    cantidad: pMerma,
                    uom: sku.uomBase || 'PZA',
                    ubicacionActual: devLoc.codigo || 'DEV-01',
                    estadoHu: 'BLOQUEADO',
                    skuCodigo: sku.codigo,
                    skuDescripcion: sku.descripcion,
                    loteTexto: box.loteTexto,
                    fechaVencimiento: box.fechaVencimiento,
                    motivoDano: item.motivoDano || 'Merma dictaminada en calidad',
                    cajaOrigenId: box.id,
                    inspeccionId: inspection.id,
                  },
                });

                await tx.inventoryMovement.create({
                  data: {
                    tipoMovimiento: 'DESVIO_MERMA',
                    almacenId: devLoc.almacenId,
                    skuId: sku.id,
                    clienteId: receipt.clienteId,
                    lotId: lotVirtual.id,
                    huId: huMerma.id,
                    toLocationId: devLoc.id,
                    cantidad: pMerma,
                    usuario: inspectorNombre,
                    motivo: `[MERMA] ${item.motivoDano || 'Dictamen técnico en Calidad'} | Origen: ${box.codigo} | Dictamen: ${folioInspeccion}`,
                    documentoOrigen: `${receipt.codigo} / ${folioInspeccion}`,
                  },
                });

                await this.audit(
                  inspectorNombre,
                  'MERMA_ALMACEN_VIRTUAL',
                  'QualityInspection',
                  inspection.id,
                  `Envío automático de ${pMerma} pzas de merma a Almacén Virtual No Conforme. Dictamen: ${folioInspeccion} | Caja: ${box.codigo} | Lote: ${box.loteTexto || 'S/L'} | Ubicación: ${devLoc.codigo}`,
                  tx,
                );
              }
            }

            // Asiento en kárdex para piezas conformes rescatadas
            if (pRescatadas > 0) {
              const line = receipt.lineas.find((l) => l.id === box.receiptLineId);
              const skuId = line?.skuId || receipt.lineas[0]?.skuId;
              if (skuId) {
                await tx.inventoryMovement.create({
                  data: {
                    tipoMovimiento: 'REACONDICIONAMIENTO_MAQUILA',
                    skuId,
                    clienteId: receipt.clienteId,
                    cantidad: pRescatadas,
                    usuario: inspectorNombre,
                    motivo: `Piezas rescatadas en maquila de caja dañada ${box.codigo} e integradas como conformes`,
                    documentoOrigen: `${receipt.codigo} / ${folioInspeccion}`,
                  },
                });
              }
            }
          }

          // Actualizar registro maestro de QualityInspection con los totales definitivos
          await tx.qualityInspection.update({
            where: { id: inspection.id },
            data: {
              totalPiezasInspeccionadas,
              totalPiezasRescatadas,
              totalPiezasMerma,
              totalCajasNuevasArmadas: nuevasCajasCreadas.length,
              detallesJson: JSON.stringify(cajasDetalleAudit),
            },
          });

          // Evaluar si aún quedan cajas retenidas pendientes o bultos sin identificar
          const remainingPendingBoxes = receipt.handlingUnits.filter(
            (h) =>
              h.tipoHu === 'CAJA' &&
              (h.estadoHu === 'RETENIDA' || h.estadoHu === 'DAÑADO' || h.codigo.includes('DANO')) &&
              !h.reacondicionada &&
              h.estadoHu !== 'INACTIVO' &&
              !body.items.some((it) => it.huId === h.id)
          );

          const previousProcessed = receipt.handlingUnits.filter(
            (h) =>
              h.tipoHu === 'CAJA' &&
              (h.codigo.includes('DANO') || h.estadoHu === 'INACTIVO') &&
              (h.reacondicionada || h.inspeccionId != null) &&
              !h.cajaOrigenId
          ).length;
          const totalProcessedNow = previousProcessed + body.items.length;
          const remainingUnidentified = Math.max(0, (receipt.bultosDanados || 0) - (remainingPendingBoxes.length + totalProcessedNow));

          const allCompleted = remainingPendingBoxes.length === 0 && remainingUnidentified === 0;
          const nuevoEstadoCalidad = allCompleted ? 'COMPLETADA' : 'EN_PROCESO';

          // Actualizar estado de inspección en el previo
          await tx.receipt.update({
            where: { id: receipt.id },
            data: {
              inspeccionCalidadEstado: nuevoEstadoCalidad,
            },
          });

          // Auditoría
          await this.audit(
            inspectorNombre,
            'INSPECCION_CALIDAD_REACONDICIONAMIENTO',
            'Receipt',
            receipt.id,
            `Inspección ${folioInspeccion}: ${totalPiezasInspeccionadas} piezas revisadas, ${totalPiezasRescatadas} rescatadas en ${nuevasCajasCreadas.length} cajas nuevas, ${totalPiezasMerma} piezas a merma dictaminada. Estado Calidad: ${nuevoEstadoCalidad}.`,
            tx,
          );

          return {
            success: true,
            message: allCompleted
              ? `Inspección de calidad completada exitosamente bajo folio ${folioInspeccion}.`
              : `Dictamen parcial registrado bajo folio ${folioInspeccion}. Quedan cajas pendientes por dictaminar.`,
            inspection,
            nuevasCajasCreadas,
            allCompleted,
            inspeccionCalidadEstado: nuevoEstadoCalidad,
            balance: {
              totalPiezasInspeccionadas,
              totalPiezasRescatadas,
              totalPiezasMerma,
              totalCajasNuevasArmadas: nuevasCajasCreadas.length,
              costoTotalMaquila,
            },
          };
        });
      } catch (err: any) {
        const isUniqueConstraint =
          err?.code === 'P2002' ||
          (typeof err?.message === 'string' &&
            err.message.includes('Unique constraint failed') &&
            (err.message.includes('folio') || err.message.includes('codigo')));

        if (isUniqueConstraint && attempt < maxRetries) {
          const delayMs = 50 * attempt + Math.floor(Math.random() * 50);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }
        throw err;
      }
    }
  }

  @Get('receipts/:id/inspection/report')
  @ApiOperation({ summary: 'Consultar informe y dictamen de calidad para depositante (Fase 2)' })
  async getQualityInspectionReport(@Param('id') receiptId: string) {
    const receipt = await this.prisma.receipt.findFirst({
      where: {
        OR: [{ id: receiptId }, { codigo: receiptId }],
      },
      include: {
        cliente: true,
        inspecciones: { orderBy: { createdAt: 'desc' } },
        lineas: { include: { sku: true } },
        handlingUnits: { orderBy: { codigo: 'asc' } },
      },
    });
    if (!receipt) throw new HttpException('Previo no encontrado', HttpStatus.NOT_FOUND);

    const latestInspection = receipt.inspecciones[0] || null;
    let parsedDetails: any[] = [];
    if (latestInspection?.detallesJson) {
      try {
        parsedDetails = JSON.parse(latestInspection.detallesJson);
      } catch (e) {
        parsedDetails = [];
      }
    }

    return {
      receiptId: receipt.id,
      receiptCodigo: receipt.codigo,
      cliente: {
        id: receipt.cliente.id,
        nombre: receipt.cliente.nombreComercial || receipt.cliente.razonSocial,
        giro: receipt.cliente.giro,
      },
      facturaRespaldo: receipt.facturaRespaldo || receipt.ocReferencia,
      fechaRecepcion: receipt.fechaRecepcion,
      inspeccion: latestInspection
        ? {
            id: latestInspection.id,
            folio: latestInspection.folio,
            fechaInspeccion: latestInspection.fechaInspeccion,
            inspectorNombre: latestInspection.inspectorNombre,
            totalCajasInspeccionadas: latestInspection.totalCajasInspeccionadas,
            totalPiezasInspeccionadas: latestInspection.totalPiezasInspeccionadas,
            totalPiezasRescatadas: latestInspection.totalPiezasRescatadas,
            totalPiezasMerma: latestInspection.totalPiezasMerma,
            totalCajasNuevasArmadas: latestInspection.totalCajasNuevasArmadas,
            horasMaquila: latestInspection.horasMaquila,
            tarifaMaquilaPorHora: latestInspection.tarifaMaquilaPorHora,
            costoTotalMaquila: latestInspection.costoTotalMaquila,
            observaciones: latestInspection.observaciones,
            firmadoPor: latestInspection.firmadoPor,
            detalles: parsedDetails,
            cajaOrigenCodigo: parsedDetails[0]?.cajaOrigenCodigo || null,
            cajaDestinoCodigo: parsedDetails[0]?.nuevasCajasGeneradas?.[0]?.codigo || null,
          }
        : null,
      cajasReacondicionadas: receipt.handlingUnits
        .filter((h) => h.reacondicionada && h.estadoHu === 'ACTIVO')
        .map((h) => ({
          id: h.id,
          codigo: h.codigo,
          skuCodigo: h.skuCodigo,
          skuDescripcion: h.skuDescripcion,
          loteTexto: h.loteTexto,
          fechaVencimiento: h.fechaVencimiento,
          cantidad: h.cantidad,
          ubicacion: h.ubicacionActual,
          ubicacionActual: h.ubicacionActual,
          estadoEtiqueta: h.estadoEtiqueta || 'GENERADA',
          etiquetaImpresa: Boolean(h.etiquetaImpresa),
          estadoHu: h.estadoHu,
          lotId: h.lotId,
          piezasPorCaja: h.piezasPorCaja,
        })),
    };
  }

  // =========================================================================
  // CONCILIACIÓN Y CONTEO FÍSICO POR PARTIDA EN ANDÉN (FASE 2 -> CONTEO)
  // =========================================================================

  @Post('receipts/:id/reconcile-anden')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Registrar y conciliar conteo físico de mercancía sana en andén por partida (Fase 2 -> Conteo)',
    description: 'Asienta las piezas y cajas sanas contadas en andén, agregándolas a las piezas previamente rescatadas en Calidad sin duplicar unidades de manejo ni liberar stock antes de Putaway.',
  })
  async reconcileAnden(
    @Param('id') receiptId: string,
    @Body() body: {
      usuario?: string;
      lineas: Array<{
        receiptLineId: string;
        cajasSanas?: number;
        piezasSanas?: number;
        lote?: string;
        fechaVencimiento?: string;
      }>;
    },
  ) {
    const receipt = await this.prisma.receipt.findFirst({
      where: { OR: [{ id: receiptId }, { codigo: receiptId }] },
      include: {
        cliente: true,
        lineas: { include: { sku: true } },
        handlingUnits: true,
      },
    });

    if (!receipt) {
      throw new HttpException('Previo de recibo no encontrado', HttpStatus.NOT_FOUND);
    }

    if (receipt.estado === 'CERRADA' || receipt.estado === 'CERRADO') {
      throw new HttpException(
        'Candado de Inmutabilidad: La recepción se encuentra CERRADA y finiquitada. No se permiten modificaciones.',
        HttpStatus.FORBIDDEN,
      );
    }

    if (!body?.lineas || !Array.isArray(body.lineas) || body.lineas.length === 0) {
      throw new HttpException('Debe especificar al menos una partida para conciliar', HttpStatus.BAD_REQUEST);
    }

    const usuario = body.usuario || 'Operador Andén';
    const auditUpdates: any[] = [];

    await this.prisma.$transaction(async (tx) => {
      for (const item of body.lineas) {
        const line = receipt.lineas.find(l => l.id === item.receiptLineId);
        if (!line) continue;

        // Calcular piezas rescatadas existentes para esta partida vinculando estrictamente por receiptLineId o lote
        const lineLot = (line.loteAsignado || line.loteEsperado || '').trim().toLowerCase();
        const rescuedPieces = receipt.handlingUnits
          .filter(h => h.tipoHu === 'CAJA' && h.estadoHu === 'ACTIVO' && (h.reacondicionada || h.cajaOrigenId) &&
            (h.receiptLineId ? h.receiptLineId === line.id : (h.skuCodigo === line.sku?.codigo && lineLot && (h.loteTexto || '').trim().toLowerCase() === lineLot)))
          .reduce((sum, h) => sum + (Number(h.cantidad) || 0), 0);

        const piezasSanasAnden = Math.max(0, Number(item.piezasSanas) || 0);
        const totalConformesResultante = rescuedPieces + piezasSanasAnden;
        const totalDanadaResultante = Number(line.cantidadDanada || 0); // Preserva merma dictaminada
        const totalProcesado = totalConformesResultante + totalDanadaResultante;
        const isComplete = totalProcesado >= (line.cantidadEsperada || 0);

        await tx.receiptLine.update({
          where: { id: line.id },
          data: {
            cantidadRecibida: totalConformesResultante,
            cantidadDanada: totalDanadaResultante,
            estado: isComplete ? 'COMPLETO' : 'CONCILIADO',
            loteAsignado: item.lote ? item.lote.trim() : line.loteAsignado,
            fechaVencimiento: item.fechaVencimiento ? new Date(item.fechaVencimiento) : line.fechaVencimiento,
          },
        });

        auditUpdates.push({
          sku: line.sku?.codigo,
          rescatadas: rescuedPieces,
          sanasAnden: piezasSanasAnden,
          totalConformes: totalConformesResultante,
          merma: totalDanadaResultante,
          esperada: line.cantidadEsperada,
          faltante: Math.max(0, (line.cantidadEsperada || 0) - totalProcesado),
        });
      }

      // Actualizar el estado de la recepción a CONCILIADO y marcar conteo de andén como COMPLETADO
      if (receipt.estado !== 'CERRADA' && receipt.estado !== 'UBICADO') {
        await tx.receipt.update({
          where: { id: receipt.id },
          data: {
            estado: 'CONCILIADO',
            conteoAndenEstado: 'COMPLETADO',
            fechaConteoAnden: new Date(),
          },
        });
      }

      await this.audit(
        usuario,
        'CONCILIACION_ANDEN',
        'Receipt',
        receipt.id,
        `Conteo en andén guardado: ${auditUpdates.map(a => `${a.sku}: ${a.sanasAnden} sanas + ${a.rescatadas} resc = ${a.totalConformes} conf`).join(', ')}.`,
      );
    });

    // Consultar el receipt actualizado para devolver el balance exacto
    const updatedReceipt = await this.prisma.receipt.findFirst({
      where: { id: receipt.id },
      include: {
        cliente: true,
        lineas: { include: { sku: true } },
        handlingUnits: true,
      },
    });

    return {
      success: true,
      message: 'Conteo físico en andén registrado y conciliado exitosamente',
      receipt: updatedReceipt,
      auditUpdates,
    };
  }

  // =========================================================================
  // FASE 4: SUGERENCIA DE UBICACIÓN EN LAYOUT (PUTAWAY) Y ACTIVACIÓN DE STOCK
  // =========================================================================

  @Get('receipts/:id/putaway-suggestions')
  @ApiOperation({
    summary: 'Obtener sugerencias inteligentes de alojamiento a racks (Etapa 4)',
    description: 'Valida candado de etiquetas colocadas, calcula ubicaciones óptimas mediante el motor configurable con Layout y disponibilidad real del almacén (filtrado estricto, compatibilidad 3PL, consolidación de SKU/lote y FEFO/nivel).',
  })
  @ApiParam({ name: 'id', description: 'ID de la recepción previa' })
  async getPutawaySuggestions(@Param('id') receiptId: string) {
    return this.putawayEngine.generateReceiptSuggestions(receiptId);
  }

  // =========================================================================
  // FASE 4: VALIDACIÓN INDIVIDUAL DE ESCANEO DUAL (HU + RACK) PARA PUTAWAY
  // =========================================================================

  @Post('receipts/:id/putaway/confirm-item')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Validar y registrar confirmación individual de Escaneo Dual (HU + Rack)',
    description: 'Exige validación física independiente de ambos elementos: HU escaneada y validada + Rack escaneado y validado. Rechaza la confirmación si solo se cuenta con sugerencia IA o lectura parcial.',
  })
  @ApiParam({ name: 'id', description: 'ID o código de la recepción previa' })
  @ApiBody({ type: ValidatePutawayItemDto })
  async confirmPutawayItem(
    @Param('id') receiptId: string,
    @Body() body: ValidatePutawayItemDto,
  ) {
    const receipt = await this.prisma.receipt.findFirst({
      where: {
        OR: [{ id: receiptId }, { codigo: receiptId }],
      },
      include: {
        cliente: true,
        handlingUnits: true,
        lineas: { include: { sku: true } },
      },
    });

    if (!receipt) {
      throw new HttpException('Previo de recibo no encontrado', HttpStatus.NOT_FOUND);
    }

    if (receipt.estado === 'CERRADA' || receipt.estado === 'CERRADO') {
      throw new HttpException(
        'Candado de Inmutabilidad: La recepción se encuentra CERRADA. No se permiten modificaciones de alojamiento.',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (receipt.etiquetasEstado !== 'COLOCADAS') {
      throw new HttpException(
        'Candado de Fase 4: Las etiquetas Giving Out deben estar confirmadas como COLOCADAS antes de validar ubicación en racks.',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Regla 1: Validar HU escaneada físicamente
    if (!body.huScanValidated || !body.scannedHuCode || !body.scannedHuCode.trim()) {
      throw new HttpException(
        'Principio de Escaneo Dual violado: Se requiere escaneo y validación física obligatoria de la unidad de manejo (HU).',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Regla 2: Validar Rack escaneado físicamente (La sugerencia IA NO es evidencia física)
    if (!body.rackScanValidated || !body.scannedLocationCode || !body.scannedLocationCode.trim()) {
      throw new HttpException(
        'Principio de Escaneo Dual violado: La sugerencia IA no constituye evidencia física. Es obligatorio escanear y validar físicamente el código de barras del rack de destino.',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Buscar la HU física en la recepción
    const normScannedHu = body.scannedHuCode.trim().toUpperCase();
    const huObj = receipt.handlingUnits.find(
      h => (body.huId && h.id === body.huId) ||
           (body.huCodigo && h.codigo.toUpperCase() === body.huCodigo.toUpperCase()) ||
           h.codigo.toUpperCase() === normScannedHu
    );

    if (!huObj) {
      throw new HttpException(
        `La unidad de manejo "${normScannedHu}" no pertenece a las cajas activas de esta recepción.`,
        HttpStatus.BAD_REQUEST,
      );
    }

    if (huObj.codigo.toUpperCase() !== normScannedHu) {
      throw new HttpException(
        `Discrepancia en escaneo de HU: Se esperaba "${huObj.codigo}" pero se escaneó "${normScannedHu}".`,
        HttpStatus.BAD_REQUEST,
      );
    }

    // Buscar y validar la posición de rack física en el almacén
    const normScannedRack = body.scannedLocationCode.trim().toUpperCase();
    const destLoc = await this.prisma.location.findFirst({
      where: {
        OR: [
          ...(body.ubicacionDestinoId ? [{ id: body.ubicacionDestinoId }] : []),
          { codigo: normScannedRack },
        ],
      },
      include: { zona: true },
    });

    if (!destLoc) {
      throw new HttpException(
        `Ubicación física de rack "${normScannedRack}" no existe en el catálogo o no está autorizada.`,
        HttpStatus.BAD_REQUEST,
      );
    }

    // Validación formal contra catálogo: ubicación debe ser de almacenamiento/rack y no de recibo, staging ni merma
    if (['RECIBO', 'STAGING', 'CUARENTENA'].includes(destLoc.tipoUbicacion) ||
        ['RECIBO', 'STAGING', 'DEVOLUCION'].includes(destLoc.zona?.codigo || '')) {
      throw new HttpException(
        `La ubicación "${destLoc.codigo}" es de tipo ${destLoc.tipoUbicacion} / zona ${destLoc.zona?.nombre || destLoc.zona?.codigo} y no es una posición válida de rack/almacenamiento comercial.`,
        HttpStatus.BAD_REQUEST,
      );
    }

    if (destLoc.codigo.toUpperCase() !== normScannedRack) {
      throw new HttpException(
        `Discrepancia en escaneo de Rack: Se esperaba "${destLoc.codigo}" pero se escaneó "${normScannedRack}".`,
        HttpStatus.BAD_REQUEST,
      );
    }

    // Regla de Precedencia Central: Bloquear Putaway comercial de mercancía vencida
    const lineForExpiry = receipt.lineas?.find((l: any) => l.id === huObj.receiptLineId) ||
      receipt.lineas?.find((l: any) => l.sku?.codigo === huObj.skuCodigo);
    const huExpDate = huObj.fechaVencimiento || lineForExpiry?.fechaVencimiento;
    if (huExpDate && isExpired(huExpDate, new Date(), true)) {
      const destRole = classifyLocationOperationalRole(destLoc);
      if (destRole.rolOperativo === 'ALMACENABLE_COMERCIAL') {
        throw new HttpException(
          {
            statusCode: HttpStatus.CONFLICT,
            message: 'MERCANCÍA VENCIDA — Putaway comercial no permitido. La unidad requiere disposición operativa conforme al flujo de calidad/no conforme.',
            error: 'Conflict',
          },
          HttpStatus.CONFLICT,
        );
      }
    }

    const usuarioResponsable = body.usuario?.trim() || 'Montacarguista';
    const timestamp = new Date().toISOString();

    // PROTOCOLO TRANSACCIONAL CON BLOQUEO PESIMISTA Y REINTENTO ANTE DEADLOCK (Etapa 5: Reglas 1-8 y 10)
    return await this.putawayEngine.executeWithDeadlockRetry(
      async () => {
        return await this.prisma.$transaction(
          async (tx) => {
            // 1. Bloqueo pesimista determinista (HandlingUnit -> Location)
            await this.putawayEngine.acquirePessimisticLocks(tx, [huObj.id], [destLoc.id]);

            // 2. Relectura de estado real de la HU dentro de la transacción (Regla 3)
            const currentHu = await tx.handlingUnit.findUnique({
              where: { id: huObj.id },
            });

            if (!currentHu) {
              throw new HttpException('Unidad de manejo no encontrada en la base de datos.', HttpStatus.NOT_FOUND);
            }

            if (currentHu.estadoHu !== 'ACTIVO') {
              throw new HttpException(
                {
                  statusCode: HttpStatus.CONFLICT,
                  message: `La unidad de manejo ${currentHu.codigo} no se encuentra activa para alojamiento (Estado actual: ${currentHu.estadoHu}).`,
                  error: 'Conflict',
                },
                HttpStatus.CONFLICT,
              );
            }

            // Regla 8: Detectar si otro operador ya acomodó esta HU en otra posición
            const isAccommodatedElsewhere =
              currentHu.ubicacionActual &&
              !['RAMPA_RECEPCION', 'REC-01', 'RECIBO', 'STAGING', 'ANDEN'].includes(currentHu.ubicacionActual) &&
              currentHu.ubicacionActual !== destLoc.codigo;

            if (isAccommodatedElsewhere) {
              throw new HttpException(
                {
                  statusCode: HttpStatus.CONFLICT,
                  message: 'Esta HU ya fue acomodada por otra operación. Actualice la información antes de continuar.',
                  error: 'Conflict',
                },
                HttpStatus.CONFLICT,
              );
            }

            // Detectar si otro operador validó concurrentemente esta HU para una ubicación distinta en este ciclo
            const latestHuAudit = await tx.auditLog.findFirst({
              where: {
                entidad: 'HandlingUnit',
                entidadId: currentHu.id,
                accion: { in: ['PUTAWAY_DUAL_SCAN_VALIDADO', 'PUTAWAY_HU_RESET'] },
              },
              orderBy: { createdAt: 'desc' },
            });

            if (
              latestHuAudit?.accion === 'PUTAWAY_DUAL_SCAN_VALIDADO' &&
              !latestHuAudit.detalle?.includes(destLoc.codigo)
            ) {
              throw new HttpException(
                {
                  statusCode: HttpStatus.CONFLICT,
                  message: 'Esta HU ya fue acomodada por otra operación. Actualice la información antes de continuar.',
                  error: 'Conflict',
                },
                HttpStatus.CONFLICT,
              );
            }

            // 3. Revalidación estricta de capacidad física de la Location dentro de la transacción (Regla 4 y 7)
            const line = receipt.lineas?.find((l: any) => l.id === currentHu.receiptLineId) ||
              receipt.lineas?.find((l: any) => l.sku?.codigo === currentHu.skuCodigo);

            const itemInput: PutawayItemInput = {
              huId: currentHu.id,
              huCodigo: currentHu.codigo,
              tipoHu: currentHu.tipoHu || 'CAJA',
              skuId: line?.skuId || '',
              skuCodigo: currentHu.skuCodigo || line?.sku?.codigo || '',
              skuDescripcion: currentHu.skuDescripcion || line?.sku?.descripcion || '',
              skuCategoria: line?.sku?.categoria || '',
              cantidad: currentHu.cantidad,
              lote: currentHu.loteTexto || line?.loteAsignado || line?.loteEsperado || '',
              fechaVencimiento: currentHu.fechaVencimiento ? currentHu.fechaVencimiento.toISOString() : (line?.fechaVencimiento ? new Date(line.fechaVencimiento).toISOString() : null),
              ubicacionActual: currentHu.ubicacionActual || 'RAMPA_RECEPCION',
              skuTemperatura: line?.sku?.temperaturaRequerida || 'AMBIENTE',
            };

            const reval = await this.putawayEngine.revalidateLocationForPutaway(
              destLoc.id,
              currentHu.cantidad,
              tx,
              {
                huBultos: 1,
                client: receipt.cliente,
                item: itemInput,
              },
            );

            if (!reval.valid) {
              throw new HttpException(
                {
                  statusCode: HttpStatus.CONFLICT,
                  message: reval.error || `La ubicación ${destLoc.codigo} cambió desde que fue sugerida y ya no tiene capacidad suficiente. Solicite una nueva ubicación.`,
                  error: 'Conflict',
                },
                HttpStatus.CONFLICT,
              );
            }

            // 4. CANDADO DE IDEMPOTENCIA (Regla 6): Idempotencia basada en estado físico actual + identidad de operación
            // La existencia histórica de PUTAWAY_DUAL_SCAN_VALIDADO no debe dar falso positivo si fue reseteada o reubicada.
            const isAlreadyAtDestination = currentHu.ubicacionActual === destLoc.codigo;
            const isDualScanValidForThisRack =
              latestHuAudit?.accion === 'PUTAWAY_DUAL_SCAN_VALIDADO' &&
              Boolean(latestHuAudit?.detalle?.includes(destLoc.codigo));

            if (isAlreadyAtDestination || isDualScanValidForThisRack) {
              return {
                success: true,
                idempotent: true,
                message: `Escaneo Dual ya verificado previamente (idempotente): HU ${currentHu.codigo} en rack ${destLoc.codigo}.`,
                huId: currentHu.id,
                huCodigo: currentHu.codigo,
                ubicacionDestinoId: destLoc.id,
                ubicacionDestinoCodigo: destLoc.codigo,
                zona: destLoc.zona?.nombre || destLoc.zona?.codigo,
                huScanValidated: true,
                rackScanValidated: true,
                usuario: latestHuAudit?.usuario || usuarioResponsable,
                validatedAt: latestHuAudit?.createdAt?.toISOString() || timestamp,
              };
            }

            // 5. Actualizar ubicación física de la HU al rack confirmado
            await tx.handlingUnit.update({
              where: { id: currentHu.id },
              data: {
                ubicacionActual: destLoc.codigo,
              },
            });

            // 6. Registrar bitácora de auditoría inmutable del Escaneo Dual dentro de la misma transacción (Regla 5)
            await tx.auditLog.create({
              data: {
                usuario: usuarioResponsable,
                accion: 'PUTAWAY_DUAL_SCAN_VALIDADO',
                entidad: 'HandlingUnit',
                entidadId: currentHu.id,
                detalle: `Escaneo Dual Verificado: HU ${currentHu.codigo} validada exitosamente en rack físico ${destLoc.codigo} (${destLoc.zona?.nombre || destLoc.zona?.codigo}). Operador: ${usuarioResponsable}. Timestamp: ${timestamp}.`,
              },
            });

            return {
              success: true,
              message: `Escaneo Dual verificado exitosamente: HU ${currentHu.codigo} en rack ${destLoc.codigo}.`,
              huId: currentHu.id,
              huCodigo: currentHu.codigo,
              ubicacionDestinoId: destLoc.id,
              ubicacionDestinoCodigo: destLoc.codigo,
              zona: destLoc.zona?.nombre || destLoc.zona?.codigo,
              huScanValidated: true,
              rackScanValidated: true,
              usuario: usuarioResponsable,
              validatedAt: timestamp,
            };
          },
          { maxWait: 10000, timeout: 20000 },
        );
      },
      { hu: huObj.codigo, location: destLoc.codigo, opName: 'confirmPutawayItem' },
    );
  }

  @Post('receipts/:id/putaway/reset-item')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Restablecer validación individual de HU para permitir re-escaneo dual auditado',
    description: 'Devuelve una HU al estado de PENDIENTE de escaneo dual y asienta bitácora de auditoría.',
  })
  @ApiParam({ name: 'id', description: 'ID o código de la recepción previa' })
  @ApiBody({ type: ResetPutawayItemDto })
  async resetPutawayItem(
    @Param('id') receiptId: string,
    @Body() body: ResetPutawayItemDto,
  ) {
    const receipt = await this.prisma.receipt.findFirst({
      where: {
        OR: [{ id: receiptId }, { codigo: receiptId }],
      },
      include: { handlingUnits: true },
    });

    if (!receipt) {
      throw new HttpException('Previo de recibo no encontrado', HttpStatus.NOT_FOUND);
    }

    if (receipt.estado === 'CERRADA' || receipt.estado === 'CERRADO') {
      throw new HttpException(
        'Candado de Inmutabilidad: La recepción se encuentra CERRADA. No se permite reiniciar validaciones sobre un expediente cerrado.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const huObj = receipt.handlingUnits.find(
      h => (body.huId && h.id === body.huId) ||
           (body.huCodigo && h.codigo.toUpperCase() === body.huCodigo.toUpperCase())
    );

    if (!huObj) {
      throw new HttpException('Unidad de manejo no encontrada en esta recepción', HttpStatus.NOT_FOUND);
    }

    const usuarioResponsable = body.usuario?.trim() || 'Auditor de Calidad / WMS';
    const motivo = body.motivo?.trim() || 'Reinicio manual para ejecución de prueba de Escaneo Dual';

    return await this.prisma.$transaction(async (tx) => {
      await this.putawayEngine.acquirePessimisticLocks(tx, [huObj.id], []);
      await tx.handlingUnit.update({
        where: { id: huObj.id },
        data: {
          ubicacionActual: 'RAMPA_RECEPCION',
        },
      });
      await tx.auditLog.create({
        data: {
          usuario: usuarioResponsable,
          accion: 'PUTAWAY_HU_RESET',
          entidad: 'HandlingUnit',
          entidadId: huObj.id,
          detalle: `Reinicio de validación de putaway: HU ${huObj.codigo} restablecida a PENDIENTE de escaneo dual. Motivo: ${motivo}. Operador: ${usuarioResponsable}.`,
        },
      });

      return {
        success: true,
        message: `HU ${huObj.codigo} restablecida a pendiente de validación dual.`,
        huId: huObj.id,
        huCodigo: huObj.codigo,
        resetAt: new Date().toISOString(),
      };
    });
  }

  @Get('receipts/:id/putaway-validations')
  @ApiOperation({
    summary: 'Obtener estado y auditoría de validaciones de escaneo dual registradas',
  })
  @ApiParam({ name: 'id', description: 'ID o código de la recepción previa' })
  async getPutawayValidations(@Param('id') receiptId: string) {
    const receipt = await this.prisma.receipt.findFirst({
      where: { OR: [{ id: receiptId }, { codigo: receiptId }] },
      include: { handlingUnits: true },
    });

    if (!receipt) {
      throw new HttpException('Previo de recibo no encontrado', HttpStatus.NOT_FOUND);
    }

    const huIds = receipt.handlingUnits.map(h => h.id);
    const auditLogs = await this.prisma.auditLog.findMany({
      where: {
        entidad: 'HandlingUnit',
        entidadId: { in: huIds },
        accion: { in: ['PUTAWAY_DUAL_SCAN_VALIDADO', 'PUTAWAY_HU_RESET'] },
      },
      orderBy: { createdAt: 'desc' },
    });

    const validations: Record<string, any> = {};
    for (const hu of receipt.handlingUnits) {
      const logsForHu = auditLogs.filter(l => l.entidadId === hu.id);
      const latestLog = logsForHu[0];
      if (latestLog && latestLog.accion === 'PUTAWAY_DUAL_SCAN_VALIDADO') {
        const rackMatch = latestLog.detalle?.match(/en rack físico ([A-Z0-9-]+)/i);
        const rackCodigo = rackMatch ? rackMatch[1] : (hu.ubicacionActual && !['RAMPA_RECEPCION', 'REC-01', 'RECIBO'].includes(hu.ubicacionActual) ? hu.ubicacionActual : null);
        validations[hu.id] = {
          huId: hu.id,
          huCodigo: hu.codigo,
          ubicacionDestinoCodigo: rackCodigo,
          huScanValidated: true,
          rackScanValidated: true,
          confirmed: true,
          validatedAt: latestLog.createdAt,
          operator: latestLog.usuario,
          detalle: latestLog.detalle,
        };
      }
    }

    const activeBoxes = receipt.handlingUnits.filter(h => h.tipoHu === 'CAJA' && h.estadoHu === 'ACTIVO');

    return {
      success: true,
      receiptId: receipt.id,
      totalBoxes: activeBoxes.length,
      validatedCount: Object.keys(validations).length,
      isFullyValidated: activeBoxes.length > 0 && Object.keys(validations).length >= activeBoxes.length,
      validations,
    };
  }

  @Post('receipts/:id/putaway/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Confirmar Alojamiento a Racks y Activar Stock a DISPONIBLE (Fase 4)',
    description: 'Valida candado de etiquetas colocadas, verifica evidencia física de Escaneo Dual en la totalidad de bultos, procesa el traslado físico del andén al rack y activa el inventario de "En Tránsito Interno" a "Disponible" para pedidos y portal de clientes.',
  })
  @ApiParam({ name: 'id', description: 'ID de la recepción previa' })
  @ApiBody({ type: ConfirmPutawayDto })
  async confirmPutaway(
    @Param('id') receiptId: string,
    @Body() body: ConfirmPutawayDto,
  ) {
    const tStart = Date.now();
    const receipt = await this.prisma.receipt.findFirst({
      where: {
        OR: [
          { id: receiptId },
          { codigo: receiptId },
        ],
      },
      include: {
        cliente: true,
        handlingUnits: true,
        lineas: { include: { sku: true } },
        inspecciones: true,
      },
    });

    if (!receipt) {
      throw new HttpException('Previo de recibo no encontrado', HttpStatus.NOT_FOUND);
    }


    if (receipt.etiquetasEstado !== 'COLOCADAS') {
      throw new HttpException(
        'Candado de Fase 4: No se puede ubicar en racks mercancía sin etiquetas Giving Out confirmadas como COLOCADAS.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const isMermaHu = (h: any) =>
      h.codigo?.includes('MERMA') ||
      h.codigo?.startsWith('HU-NC-') ||
      h.ubicacionActual === 'DEV-01' ||
      h.ubicacionActual?.includes('DEV');

    const activeBoxes = receipt.handlingUnits.filter(
      (h: any) => h.tipoHu === 'CAJA' && h.estadoHu === 'ACTIVO' && !isMermaHu(h),
    );
    const inactiveBoxes = receipt.handlingUnits.filter(
      (h: any) => h.tipoHu === 'CAJA' && h.estadoHu !== 'ACTIVO' && !isMermaHu(h),
    );
    const tarimas = receipt.handlingUnits.filter(
      (h: any) => h.tipoHu === 'TARIMA' || h.tipoHu === 'PALLET',
    );

    // Calcular métricas de merma y faltante de forma consistente y general
    const totalPiezasMerma =
      receipt.inspecciones?.reduce((acc: number, insp: any) => acc + (insp.totalPiezasMerma || 0), 0) ||
      receipt.lineas?.reduce((acc: number, l: any) => acc + Number(l.cantidadDanada || 0), 0) ||
      0;
    const totalPiezasFaltantes =
      receipt.lineas?.reduce((acc: number, l: any) => {
        const esp = Number(l.cantidadEsperada || 0);
        const rec = Number(l.cantidadRecibida || 0);
        const dan = Number(l.cantidadDanada || 0);
        return acc + Math.max(0, esp - (rec + dan));
      }, 0) || 0;

    const usuarioResponsable = body.usuario?.trim() || 'Montacarguista';
    const timestamp = new Date().toISOString();

    // =========================================================================
    // COMPROBACIÓN DE FINALIZACIÓN CANÓNICA E IDEMPOTENCIA REAL DE PUTAWAY (Fase 4)
    // =========================================================================
    // Para devolver idempotent: true, TODO bulto comercial activo debe tener persistencia canónica verificable:
    // 1. HU tiene lotId no nulo.
    // 2. El LotInventory referenciado existe en la BD para el cliente, SKU y ubicación rack de la HU.
    // 3. Existe evidencia de movimiento de inventario (TRASIEGO) para dicha HU en la recepción.
    // 4. Existe la auditoría final PUTAWAY_CONFIRMADO_RACKS.
    const activeBoxLotIds = activeBoxes.map((b: any) => b.lotId).filter(Boolean);
    const existingLotsForBoxes = activeBoxLotIds.length > 0
      ? await this.prisma.lotInventory.findMany({
          where: {
            id: { in: activeBoxLotIds },
            clienteId: receipt.clienteId,
          },
          include: { ubicacion: true },
        })
      : [];
    const lotMapById = new Map<string, any>(existingLotsForBoxes.map((l: any) => [l.id, l]));

    const existingMovements = await this.prisma.inventoryMovement.findMany({
      where: {
        documentoOrigen: receipt.codigo,
        tipoMovimiento: 'TRASIEGO',
        huId: { in: activeBoxes.map((b: any) => b.id) },
      },
      select: { huId: true },
    });
    const movementHuIds = new Set(existingMovements.map((m: any) => m.huId));

    const existingPutawayAudit = await this.prisma.auditLog.findFirst({
      where: {
        entidad: 'Receipt',
        entidadId: receipt.id,
        accion: 'PUTAWAY_CONFIRMADO_RACKS',
      },
    });

    const isBoxCanonicallyAccounted = (b: any): boolean => {
      if (!b.lotId) return false;
      const lot = lotMapById.get(b.lotId);
      if (!lot) return false;
      if (lot.clienteId !== receipt.clienteId) return false;
      const line = receipt.lineas?.find((l: any) => l.id === b.receiptLineId) ||
        receipt.lineas?.find((l: any) => l.sku?.codigo === b.skuCodigo);
      const resolvedSkuId = b.skuId || line?.skuId;
      if (resolvedSkuId && lot.skuId !== resolvedSkuId) return false;
      if (b.ubicacionActual && lot.ubicacion?.codigo !== b.ubicacionActual) return false;
      if (!movementHuIds.has(b.id)) return false;
      return true;
    };

    const accountedBoxes = activeBoxes.filter((b: any) => isBoxCanonicallyAccounted(b));
    const isFullyCanonicallyCompleted =
      activeBoxes.length > 0 &&
      accountedBoxes.length === activeBoxes.length &&
      Boolean(existingPutawayAudit);

    // Si ya está 100% canónicamente consolidado, devolver respuesta idempotente con métricas reales de BD
    if (isFullyCanonicallyCompleted) {
      if (receipt.estado !== 'COMPLETO' && receipt.estado !== 'UBICADO' && receipt.estado !== 'CERRADA' && receipt.estado !== 'CERRADO') {
        await this.prisma.receipt.update({
          where: { id: receipt.id },
          data: { estado: 'COMPLETO' },
        });
      }

      const movimientosRealizados = activeBoxes.map((b: any) => {
        const line = receipt.lineas?.find((l: any) => l.id === b.receiptLineId) ||
          receipt.lineas?.find((l: any) => l.sku?.codigo === b.skuCodigo);
        const resolvedSkuId = line?.skuId || b.skuId || '';
        return {
          huId: b.id,
          huCodigo: b.codigo,
          skuId: resolvedSkuId,
          skuCodigo: b.skuCodigo || line?.sku?.codigo || 'SKU',
          skuDescripcion: b.skuDescripcion || line?.sku?.descripcion || 'Mercancía conforme',
          lote: b.loteTexto || line?.loteAsignado || line?.loteEsperado || 'S/L',
          fechaVencimiento: b.fechaVencimiento ? new Date(b.fechaVencimiento).toISOString().split('T')[0] : (line?.fechaVencimiento ? new Date(line.fechaVencimiento).toISOString().split('T')[0] : 'N/A'),
          cantidad: b.cantidad,
          ubicacionDestino: b.ubicacionActual,
          zona: b.ubicacionActual?.startsWith('B') ? 'Almacenamiento General' : 'Racks',
          estadoHu: 'ACTIVO',
          reacondicionada: !!b.reacondicionada,
          cajaOrigenId: b.cajaOrigenId || null,
        };
      });

      const totalPiezasAlojadas = activeBoxes.reduce((acc: number, b: any) => acc + b.cantidad, 0);
      const racksAsignados = [...new Set(activeBoxes.map((b: any) => b.ubicacionActual).filter(Boolean))];

      return {
        success: true,
        idempotent: true,
        canonicalComplete: true,
        durationMs: Date.now() - tStart,
        message: `¡Alojamiento verificado canónicamente (idempotente)! Se preservó el saldo en racks para ${movimientosRealizados.length} bultos (${totalPiezasAlojadas} pzas) con stock DISPONIBLE sin duplicidad.`,
        receiptId: receipt.id,
        receiptCodigo: receipt.codigo,
        cliente: receipt.cliente?.nombreComercial || receipt.cliente?.razonSocial || 'Depositante',
        totalBultos: movimientosRealizados.length,
        totalPiezas: totalPiezasAlojadas,
        totalHUsAlojadas: activeBoxes.length,
        tarimasMaster: tarimas.length > 0 ? tarimas.length : 1,
        piezasDisponibles: totalPiezasAlojadas,
        piezasMerma: totalPiezasMerma,
        piezasFaltantes: totalPiezasFaltantes,
        cajasDanadasFueraStock: inactiveBoxes.length,
        estadoInventario: 'DISPONIBLE',
        estadoRecibo: receipt.estado === 'CERRADA' ? 'CERRADA' : 'COMPLETO',
        timestamp: existingPutawayAudit?.createdAt?.toISOString() || timestamp,
        operador: existingPutawayAudit?.usuario || usuarioResponsable,
        racksAsignados,
        movimientos: movimientosRealizados,
        discrepancias: {
          mermaPiezas: totalPiezasMerma,
          faltantePiezas: totalPiezasFaltantes,
          cajasDanadasFueraStock: inactiveBoxes.length,
          detalle: `${totalPiezasMerma} pzas de merma en DEV-01 y ${totalPiezasFaltantes} pzas faltantes fuera de stock; ${inactiveBoxes.length} ${inactiveBoxes.length === 1 ? 'caja dañada histórica/inactiva' : 'cajas dañadas históricas/inactivas'} (saldo 0).`,
        },
      };
    }

    // Candado de Inmutabilidad: Si la recepción está CERRADA y tiene HUs pendientes, NO alterar silenciosamente.
    // Se requiere el flujo formal y trazable de Reconciliación Post-Cierre por un supervisor.
    if (receipt.estado === 'CERRADA' || receipt.estado === 'CERRADO') {
      throw new HttpException(
        'Candado de Inmutabilidad: La recepción se encuentra CERRADA. El endpoint estándar de Putaway no puede alterar silenciosamente un expediente cerrado. Para subsanar HUs físicamente ubicadas pero sin contabilización canónica, utilice el flujo formal de "Reconciliación Post-Cierre de Putaway" (/receipts/:id/post-closure-reconciliation) con autorización de supervisor y motivo obligatorio.',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Filtrar exclusivamente los bultos pendientes de consolidación canónica
    const pendingBoxes = activeBoxes.filter((b: any) => !accountedBoxes.some((ab: any) => ab.id === b.id));

    // Si no hay bultos activos o todos están pendientes de dual scan, validar
    const inputMovements = Array.isArray(body.movimientos) ? body.movimientos : [];
    const movMapByHu = new Map<string, any>();
    for (const m of inputMovements) {
      if (m.huId) movMapByHu.set(m.huId, m);
      if (m.huCodigo) movMapByHu.set(m.huCodigo.toUpperCase(), m);
    }

    // Consultar auditorías de Escaneo Dual para las HUs pendientes
    const dualScanAudits = await this.prisma.auditLog.findMany({
      where: {
        entidad: 'HandlingUnit',
        entidadId: { in: pendingBoxes.map((b: any) => b.id) },
        accion: 'PUTAWAY_DUAL_SCAN_VALIDADO',
      },
      select: { entidadId: true },
    });
    const dualScanAuditHuIds = new Set(dualScanAudits.map((a: any) => a.entidadId));

    // Validar que cada bulto pendiente cuente con validación física completa de Escaneo Dual
    for (const b of pendingBoxes) {
      const mov = movMapByHu.get(b.id) || movMapByHu.get(b.codigo.toUpperCase());
      const hasMovDualScan = Boolean(mov?.huScanValidated && mov?.rackScanValidated);
      const hasPersistedDualScan = dualScanAuditHuIds.has(b.id) &&
        b.ubicacionActual &&
        !['RAMPA_RECEPCION', 'REC-01', 'RECIBO', 'ANDEN', 'STAGING', 'DEV-01'].includes(b.ubicacionActual);

      if (!hasMovDualScan && !hasPersistedDualScan) {
        throw new HttpException(
          `Bloqueo de Seguridad Putaway: La caja "${b.codigo}" no cuenta con evidencia de Escaneo Dual completo (HU y Rack validados físicamente). Se requiere completar el escaneo físico antes de activar stock comercial.`,
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    // Ubicación de recibo/tránsito
    const recLocation = await this.prisma.location.findFirst({
      where: { OR: [{ codigo: 'REC-01' }, { tipoUbicacion: 'RECIBO' }] },
    }) || await this.prisma.location.findFirst();

    // Cargar ubicaciones destino necesarias en 1 sola consulta
    const neededLocCodesOrIds = new Set<string>();
    for (const b of pendingBoxes) {
      const mov = movMapByHu.get(b.id) || movMapByHu.get(b.codigo.toUpperCase());
      if (mov?.ubicacionDestinoId && mov.ubicacionDestinoId !== 'AUTO') {
        neededLocCodesOrIds.add(mov.ubicacionDestinoId);
      } else if (b.ubicacionActual && !['RAMPA_RECEPCION', 'REC-01', 'RECIBO', 'ANDEN', 'STAGING', 'DEV-01'].includes(b.ubicacionActual)) {
        neededLocCodesOrIds.add(b.ubicacionActual);
      }
    }

    const foundLocations = await this.prisma.location.findMany({
      where: {
        OR: [
          { id: { in: [...neededLocCodesOrIds] } },
          { codigo: { in: [...neededLocCodesOrIds] } },
        ],
      },
      include: { zona: true },
    });
    const locMapById = new Map<string, any>(foundLocations.map((l: any) => [l.id, l]));
    const locMapByCode = new Map<string, any>(foundLocations.map((l: any) => [l.codigo.toUpperCase(), l]));

    // Asociar destino validado a cada bulto pendiente
    const pendingWithDest: Array<{
      box: any;
      destLocation: any;
      resolvedSkuId: string;
      effectiveLote: string | null;
      effectiveFechaVencimiento: Date | null;
    }> = [];

    for (const b of pendingBoxes) {
      const mov = movMapByHu.get(b.id) || movMapByHu.get(b.codigo.toUpperCase());
      let destLoc: any = null;
      if (mov?.ubicacionDestinoId && mov.ubicacionDestinoId !== 'AUTO') {
        destLoc = locMapById.get(mov.ubicacionDestinoId) || locMapByCode.get(mov.ubicacionDestinoId.toUpperCase());
      }
      if (!destLoc && b.ubicacionActual) {
        destLoc = locMapByCode.get(b.ubicacionActual.toUpperCase());
      }

      if (!destLoc) {
        throw new HttpException(
          `Ubicación destino para la caja "${b.codigo}" no encontrada o no válida para alojamiento.`,
          HttpStatus.BAD_REQUEST,
        );
      }

      const line = receipt.lineas?.find((l: any) => l.id === b.receiptLineId) ||
        receipt.lineas?.find((l: any) => l.sku?.codigo === b.skuCodigo);
      const resolvedSkuId = (b as any).skuId || line?.skuId || mov?.skuId;
      if (!resolvedSkuId) {
        throw new HttpException(`No se pudo determinar el SKU asociado a la caja "${b.codigo}".`, HttpStatus.BAD_REQUEST);
      }

      let effectiveLote = b.loteTexto || line?.loteAsignado || line?.loteEsperado || null;
      let effectiveFechaVencimiento = b.fechaVencimiento || line?.fechaVencimiento || null;

      if (effectiveFechaVencimiento && isExpired(effectiveFechaVencimiento, new Date(), true)) {
        const destRole = classifyLocationOperationalRole(destLoc);
        if (destRole.rolOperativo === 'ALMACENABLE_COMERCIAL') {
          throw new HttpException(
            {
              statusCode: HttpStatus.CONFLICT,
              message: `MERCANCÍA VENCIDA — Putaway comercial no permitido para la caja "${b.codigo}". La unidad requiere disposición operativa conforme al flujo de calidad/no conforme.`,
              error: 'Conflict',
            },
            HttpStatus.CONFLICT,
          );
        }
      }

      pendingWithDest.push({
        box: b,
        destLocation: destLoc,
        resolvedSkuId,
        effectiveLote,
        effectiveFechaVencimiento: effectiveFechaVencimiento ? new Date(effectiveFechaVencimiento) : null,
      });
    }

    const sortedHuIds = [...new Set(pendingBoxes.map((b: any) => b.id))].sort();
    const sortedLocIds = [...new Set(pendingWithDest.map(p => p.destLocation.id))].sort();

    // =========================================================================
    // EJECUCIÓN ATÓMICA TRANSACCIONAL CON BLOQUEO PESIMISTA Y DEADLOCK RETRY (Etapa 5)
    // =========================================================================
    return await this.putawayEngine.executeWithDeadlockRetry(
      async () => {
        return await this.prisma.$transaction(
          async (tx) => {
            // 1. Bloqueo pesimista determinista (HandlingUnit -> Location) (Regla 2 y 9)
            await this.putawayEngine.acquirePessimisticLocks(tx, sortedHuIds, sortedLocIds);

            // 2. Relectura de estado real de HUs y Locations dentro de la transacción (Regla 3)
            const freshHus = await tx.handlingUnit.findMany({
              where: { id: { in: sortedHuIds } },
            });
            const freshHuMap = new Map<string, any>(freshHus.map(h => [h.id, h]));
            const freshHuByCode = new Map<string, any>(freshHus.map(h => [h.codigo.toUpperCase(), h]));

            const freshLocations = await tx.location.findMany({
              where: { id: { in: sortedLocIds } },
              include: { zona: true },
            });
            const freshLocMap = new Map<string, any>(freshLocations.map(l => [l.id, l]));

            // 3. Revalidación completa de HUs pendientes dentro de la transacción
            for (const p of pendingWithDest) {
              const freshHu = freshHuMap.get(p.box.id);
              if (!freshHu) {
                throw new HttpException(`Unidad de manejo ${p.box.codigo} no encontrada en BD.`, HttpStatus.NOT_FOUND);
              }

              if (freshHu.estadoHu !== 'ACTIVO') {
                throw new HttpException(
                  {
                    statusCode: HttpStatus.CONFLICT,
                    message: `La HU ${freshHu.codigo} ya no se encuentra activa para alojamiento (Estado actual: ${freshHu.estadoHu}).`,
                    error: 'Conflict',
                  },
                  HttpStatus.CONFLICT,
                );
              }
            }

            // 4. Revalidación estricta de capacidad por ubicación destino dentro de la transacción
            const incomingPiecesByLoc = new Map<string, number>();
            const incomingBultosByLoc = new Map<string, number>();

            for (const p of pendingWithDest) {
              const freshHu = freshHuMap.get(p.box.id);
              const cant = freshHu?.cantidad ?? p.box.cantidad ?? 0;
              incomingPiecesByLoc.set(p.destLocation.id, (incomingPiecesByLoc.get(p.destLocation.id) || 0) + cant);
              incomingBultosByLoc.set(p.destLocation.id, (incomingBultosByLoc.get(p.destLocation.id) || 0) + 1);
            }

            for (const [locId, totalPieces] of incomingPiecesByLoc.entries()) {
              const totalBultos = incomingBultosByLoc.get(locId) || 1;
              const targetDestLoc = freshLocMap.get(locId);
              const reval = await this.putawayEngine.revalidateLocationForPutaway(
                locId,
                totalPieces,
                tx,
                { huBultos: totalBultos, client: receipt.cliente },
              );

              if (!reval.valid) {
                throw new HttpException(
                  {
                    statusCode: HttpStatus.CONFLICT,
                    message: reval.error || `La ubicación ${targetDestLoc?.codigo || locId} cambió desde que fue sugerida y ya no tiene capacidad suficiente. Solicite una nueva ubicación.`,
                    error: 'Conflict',
                  },
                  HttpStatus.CONFLICT,
                );
              }
            }

            // 5. Pre-procesar movimientos en memoria y agrupar por (skuId + lote + ubicacionDestinoId) para LotInventory
            type GroupKey = string;
            interface AggregatedGroup {
              skuId: string;
              lote: string | null;
              fechaVencimiento: Date | null;
              destLocId: string;
              destLocCodigo: string;
              cantidadTotal: number;
              items: typeof pendingWithDest;
            }

            const groupsMap = new Map<GroupKey, AggregatedGroup>();

            for (const p of pendingWithDest) {
              const freshHu = freshHuMap.get(p.box.id);
              const cant = freshHu?.cantidad ?? p.box.cantidad ?? 0;
              const groupKey = `${p.resolvedSkuId}___${p.effectiveLote || 'NOLOTE'}___${p.destLocation.id}`;
              let group = groupsMap.get(groupKey);
              if (!group) {
                group = {
                  skuId: p.resolvedSkuId,
                  lote: p.effectiveLote,
                  fechaVencimiento: p.effectiveFechaVencimiento,
                  destLocId: p.destLocation.id,
                  destLocCodigo: p.destLocation.codigo,
                  cantidadTotal: 0,
                  items: [],
                };
                groupsMap.set(groupKey, group);
              }
              group.cantidadTotal += cant;
              group.items.push(p);
            }

            // 6. Consultar todos los LotInventory existentes en una sola consulta
            const allSkuIds = [...new Set(pendingWithDest.map(p => p.resolvedSkuId))];
            const allLocIds = [...new Set([...sortedLocIds, ...(recLocation ? [recLocation.id] : [])])];

            const existingLots = await tx.lotInventory.findMany({
              where: {
                clienteId: receipt.clienteId,
                skuId: { in: allSkuIds },
                ubicacionId: { in: allLocIds },
              },
            });

            // 7. Procesar lotes destino y origen de forma consolidada
            const targetLotIdByGroup = new Map<string, string>();

            for (const [groupKey, group] of groupsMap.entries()) {
              const existingLotDest = existingLots.find(
                l => l.skuId === group.skuId &&
                     l.ubicacionId === group.destLocId &&
                     (group.lote ? l.lote === group.lote : (!l.lote || l.lote === ''))
              );

              let targetLotId: string;
              if (existingLotDest) {
                await tx.lotInventory.update({
                  where: { id: existingLotDest.id },
                  data: {
                    cantidadDisponible: { increment: group.cantidadTotal },
                    estadoCalidad: 'LIBERADO',
                    fechaVencimiento: existingLotDest.fechaVencimiento || group.fechaVencimiento,
                  },
                });
                targetLotId = existingLotDest.id;
              } else {
                const newLot = await tx.lotInventory.create({
                  data: {
                    skuId: group.skuId,
                    clienteId: receipt.clienteId,
                    lote: group.lote,
                    fechaVencimiento: group.fechaVencimiento,
                    ubicacionId: group.destLocId,
                    cantidadDisponible: group.cantidadTotal,
                    estadoCalidad: 'LIBERADO',
                    notas: `Alojado desde ${receipt.codigo} a rack ${group.destLocCodigo}${group.lote ? ` (Lote ${group.lote})` : ''}`,
                  },
                });
                targetLotId = newLot.id;
              }
              targetLotIdByGroup.set(groupKey, targetLotId);

              // Descontar de andén si existía inventario en tránsito
              if (recLocation) {
                const existingLotAnden = existingLots.find(
                  l => l.skuId === group.skuId &&
                       l.ubicacionId === recLocation.id &&
                       (group.lote ? l.lote === group.lote : (!l.lote || l.lote === ''))
                );
                if (existingLotAnden) {
                  const dec = Math.min(existingLotAnden.cantidadDisponible, group.cantidadTotal);
                  await tx.lotInventory.update({
                    where: { id: existingLotAnden.id },
                    data: {
                      cantidadDisponible: { decrement: dec },
                    },
                  });
                }
              }
            }

            // 8. Actualizar HUs físicas y registrar movimientos para cada bulto pendiente
            const huUpdatePromises: Promise<any>[] = [];
            const inventoryMovementsData: any[] = [];

            for (const p of pendingWithDest) {
              const groupKey = `${p.resolvedSkuId}___${p.effectiveLote || 'NOLOTE'}___${p.destLocation.id}`;
              const targetLotId = targetLotIdByGroup.get(groupKey)!;
              const freshHu = freshHuMap.get(p.box.id);
              const cant = freshHu?.cantidad ?? p.box.cantidad ?? 0;

              huUpdatePromises.push(
                tx.handlingUnit.update({
                  where: { id: p.box.id },
                  data: {
                    ubicacionActual: p.destLocation.codigo,
                    lotId: targetLotId,
                    estadoHu: 'ACTIVO',
                  },
                }),
              );

              inventoryMovementsData.push({
                tipoMovimiento: 'TRASIEGO',
                skuId: p.resolvedSkuId,
                clienteId: receipt.clienteId,
                lotId: targetLotId,
                huId: p.box.id,
                fromLocationId: recLocation ? recLocation.id : null,
                toLocationId: p.destLocation.id,
                cantidad: cant,
                usuario: usuarioResponsable,
                motivo: `Alojamiento Putaway confirmado a rack ${p.destLocation.codigo} (Fase 4)`,
                documentoOrigen: receipt.codigo,
              });
            }

            await Promise.all(huUpdatePromises);

            // 9. Actualizar estado operativo en ubicaciones destino a OCUPADO
            for (const locId of sortedLocIds) {
              await tx.location.update({
                where: { id: locId },
                data: {
                  estado: 'OCUPADO',
                },
              });
            }

            // 10. Inserción masiva por lote en InventoryMovement (createMany) filtrando HUs ya trasladadas para garantizar idempotencia
            const existingMovements = await tx.inventoryMovement.findMany({
              where: {
                documentoOrigen: receipt.codigo,
                tipoMovimiento: 'TRASIEGO',
                huId: { in: inventoryMovementsData.map(m => m.huId).filter(Boolean) },
              },
              select: { huId: true },
            });
            const existingHuIds = new Set(existingMovements.map(m => m.huId));
            const movementsToInsert = inventoryMovementsData.filter(m => !m.huId || !existingHuIds.has(m.huId));

            if (movementsToInsert.length > 0) {
              await tx.inventoryMovement.createMany({
                data: movementsToInsert,
              });
            }

            // 10. Actualizar Receipt a COMPLETO si no se encuentra cerrada
            if (receipt.estado !== 'CERRADA' && receipt.estado !== 'CERRADO') {
              await tx.receipt.update({
                where: { id: receipt.id },
                data: { estado: 'COMPLETO' },
              });
            }

            // 11. Auditoría formal inmutable (idempotente)
            const existingFinalAudit = await tx.auditLog.findFirst({
              where: {
                entidad: 'Receipt',
                entidadId: receipt.id,
                accion: 'PUTAWAY_CONFIRMADO_RACKS',
              },
            });

            const allActiveBoxesFresh = await tx.handlingUnit.findMany({
              where: {
                receiptId: receipt.id,
                tipoHu: 'CAJA',
                estadoHu: 'ACTIVO',
              },
            });
            const totalPiezasAlojadas = allActiveBoxesFresh.reduce((acc: number, b: any) => acc + (b.cantidad || 0), 0);

            if (!existingFinalAudit) {
              await tx.auditLog.create({
                data: {
                  usuario: usuarioResponsable,
                  accion: 'PUTAWAY_CONFIRMADO_RACKS',
                  entidad: 'Receipt',
                  entidadId: receipt.id,
                  detalle: `Fase 4: Alojamiento confirmado para ${allActiveBoxesFresh.length} bultos (${totalPiezasAlojadas} pzas). Stock activado a DISPONIBLE en racks. Operador: ${usuarioResponsable}. Duración: ${Date.now() - tStart}ms`,
                },
              });
            }

            const movimientosRealizados = allActiveBoxesFresh.map((b: any) => {
              const line = receipt.lineas?.find((l: any) => l.id === b.receiptLineId) ||
                receipt.lineas?.find((l: any) => l.sku?.codigo === b.skuCodigo);
              return {
                huId: b.id,
                huCodigo: b.codigo,
                skuId: b.skuId || line?.skuId || '',
                skuCodigo: b.skuCodigo || line?.sku?.codigo || 'SKU',
                skuDescripcion: b.skuDescripcion || line?.sku?.descripcion || 'Mercancía conforme',
                lote: b.loteTexto || line?.loteAsignado || line?.loteEsperado || 'S/L',
                fechaVencimiento: b.fechaVencimiento ? new Date(b.fechaVencimiento).toISOString().split('T')[0] : (line?.fechaVencimiento ? new Date(line.fechaVencimiento).toISOString().split('T')[0] : 'N/A'),
                cantidad: b.cantidad,
                ubicacionDestino: b.ubicacionActual,
                zona: b.ubicacionActual?.startsWith('B') ? 'Almacenamiento General' : 'Racks',
                estadoHu: 'ACTIVO',
                reacondicionada: !!b.reacondicionada,
                cajaOrigenId: b.cajaOrigenId || null,
              };
            });

            const racksAsignados = [...new Set(allActiveBoxesFresh.map((b: any) => b.ubicacionActual).filter(Boolean))];

            return {
              success: true,
              durationMs: Date.now() - tStart,
              message: `¡Alojamiento confirmado exitosamente! Se trasladaron ${movimientosRealizados.length} bultos (${totalPiezasAlojadas} pzas) a racks y su stock quedó activo como DISPONIBLE en el portal.`,
              receiptId: receipt.id,
              receiptCodigo: receipt.codigo,
              cliente: receipt.cliente?.nombreComercial || receipt.cliente?.razonSocial || 'Depositante',
              totalBultos: movimientosRealizados.length,
              totalPiezas: totalPiezasAlojadas,
              totalHUsAlojadas: allActiveBoxesFresh.length,
              tarimasMaster: tarimas.length > 0 ? tarimas.length : 1,
              piezasDisponibles: totalPiezasAlojadas,
              piezasMerma: totalPiezasMerma,
              piezasFaltantes: totalPiezasFaltantes,
              cajasDanadasFueraStock: inactiveBoxes.length,
              estadoInventario: 'DISPONIBLE',
              estadoRecibo: receipt.estado === 'CERRADA' ? 'CERRADA' : 'COMPLETO',
              timestamp,
              operador: usuarioResponsable,
              racksAsignados,
              movimientos: movimientosRealizados,
              discrepancias: {
                mermaPiezas: totalPiezasMerma,
                faltantePiezas: totalPiezasFaltantes,
                cajasDanadasFueraStock: inactiveBoxes.length,
                detalle: `${totalPiezasMerma} pzas de merma en DEV-01 y ${totalPiezasFaltantes} pzas faltantes fuera de stock; ${inactiveBoxes.length} ${inactiveBoxes.length === 1 ? 'caja dañada histórica/inactiva' : 'cajas dañadas históricas/inactivas'} (saldo 0).`
              }
            };
          },
          {
            maxWait: 15000,
            timeout: 30000,
          },
        );
      },
      { opName: 'confirmPutaway' },
    );
  }

  // =========================================================================
  // RECONCILIACIÓN POST-CIERRE DE PUTAWAY (Arquitectura General de Subsanación)
  // Permite detectar y subsanar discrepancias canónicas en expedientes cerrados
  // preservando el estado histórico CERRADA, la fecha original de cierre y auditorías.
  // =========================================================================

  @Get('receipts/:id/post-closure-reconciliation/preview')
  @ApiOperation({
    summary: 'Vista previa de reconciliación post-cierre de Putaway (Strict Read-Only)',
    description: 'Detecta de forma automática si un expediente cerrado tiene HUs físicas en racks sin contabilización canónica y muestra las acciones a proyectar sin alterar la BD.',
  })
  @ApiParam({ name: 'id', description: 'ID o código de la recepción previa cerrada' })
  async previewPostClosurePutawayReconciliation(@Param('id') receiptId: string) {
    const receipt = await this.prisma.receipt.findFirst({
      where: { OR: [{ id: receiptId }, { codigo: receiptId }] },
      include: {
        cliente: true,
        lineas: { include: { sku: true } },
        handlingUnits: true,
      },
    });

    if (!receipt) {
      throw new HttpException('Previo de recibo no encontrado', HttpStatus.NOT_FOUND);
    }

    const isClosed = receipt.estado === 'CERRADA' || receipt.estado === 'CERRADO';
    if (!isClosed) {
      return {
        reconciliable: false,
        inconsistenciaDetectada: false,
        message: `El expediente "${receipt.codigo}" no se encuentra en estado CERRADA (Estado actual: ${receipt.estado}). Utilice el flujo operativo estándar de Putaway.`,
      };
    }

    const isMermaHu = (h: any) =>
      h.codigo?.includes('MERMA') ||
      h.codigo?.startsWith('HU-NC-') ||
      h.ubicacionActual === 'DEV-01' ||
      h.ubicacionActual?.includes('DEV');

    const activeBoxes = receipt.handlingUnits.filter(
      (h: any) => h.tipoHu === 'CAJA' && h.estadoHu === 'ACTIVO' && !isMermaHu(h),
    );

    const activeBoxLotIds = activeBoxes.map((b: any) => b.lotId).filter(Boolean);
    const existingLotsForBoxes = activeBoxLotIds.length > 0
      ? await this.prisma.lotInventory.findMany({
          where: { id: { in: activeBoxLotIds } },
          include: { ubicacion: true },
        })
      : [];
    const lotMapById = new Map<string, any>(existingLotsForBoxes.map(l => [l.id, l]));

    const existingMovements = await this.prisma.inventoryMovement.findMany({
      where: {
        documentoOrigen: receipt.codigo,
        tipoMovimiento: 'TRASIEGO',
        huId: { in: activeBoxes.map((b: any) => b.id) },
      },
      select: { huId: true },
    });
    const movementHuIds = new Set(existingMovements.map((m: any) => m.huId));

    const isBoxCanonicallyAccounted = (b: any): boolean => {
      if (!b.lotId) return false;
      const lot = lotMapById.get(b.lotId);
      if (!lot) return false;
      if (lot.clienteId !== receipt.clienteId) return false;
      const line = receipt.lineas?.find((l: any) => l.id === b.receiptLineId) ||
        receipt.lineas?.find((l: any) => l.sku?.codigo === b.skuCodigo);
      const resolvedSkuId = (b as any).skuId || line?.skuId;
      if (resolvedSkuId && lot.skuId !== resolvedSkuId) return false;
      if (b.ubicacionActual && lot.ubicacion?.codigo !== b.ubicacionActual) return false;
      if (!movementHuIds.has(b.id)) return false;
      return true;
    };

    const accountedBoxes = activeBoxes.filter((b: any) => isBoxCanonicallyAccounted(b));
    const pendingBoxes = activeBoxes.filter((b: any) => !isBoxCanonicallyAccounted(b));

    if (pendingBoxes.length === 0) {
      return {
        reconciliable: false,
        inconsistenciaDetectada: false,
        receiptId: receipt.id,
        receiptCodigo: receipt.codigo,
        estado: receipt.estado,
        fechaCierre: receipt.fechaCierre,
        cerradoPor: receipt.cerradoPor,
        totalHUsComerciales: activeBoxes.length,
        totalHUsContabilizadas: accountedBoxes.length,
        message: `El expediente cerrado "${receipt.codigo}" ya se encuentra 100% consolidado y contabilizado canónicamente. No requiere reconciliación.`,
      };
    }

    // Inspeccionar evidencia física de escaneo dual
    const dualScanAudits = await this.prisma.auditLog.findMany({
      where: {
        entidad: 'HandlingUnit',
        entidadId: { in: pendingBoxes.map((b: any) => b.id) },
        accion: 'PUTAWAY_DUAL_SCAN_VALIDADO',
      },
    });
    const dualScanHuMap = new Map<string, any>(dualScanAudits.map((a: any) => [a.entidadId, a]));

    const neededLocCodes = [...new Set(pendingBoxes.map((b: any) => b.ubicacionActual).filter(Boolean))];
    const locations = await this.prisma.location.findMany({
      where: { codigo: { in: neededLocCodes } },
    });
    const locMapByCode = new Map<string, any>(locations.map(l => [l.codigo.toUpperCase(), l]));

    const pendingWithDest: any[] = [];
    for (const b of pendingBoxes) {
      const line = receipt.lineas?.find((l: any) => l.id === b.receiptLineId) ||
        receipt.lineas?.find((l: any) => l.sku?.codigo === b.skuCodigo);
      const resolvedSkuId = (b as any).skuId || line?.skuId;
      const resolvedSkuCodigo = b.skuCodigo || line?.sku?.codigo;
      const effectiveLote = b.loteTexto || line?.loteAsignado || line?.loteEsperado || 'S/L';
      const destLoc = b.ubicacionActual ? locMapByCode.get(b.ubicacionActual.toUpperCase()) : null;

      pendingWithDest.push({
        box: b,
        resolvedSkuId,
        resolvedSkuCodigo,
        effectiveLote,
        destLocation: destLoc,
        dualScanAudit: dualScanHuMap.get(b.id) || null,
      });
    }

    // Agrupación canónica: (skuId, lote, destLocId)
    const groupsMap = new Map<string, any>();
    for (const p of pendingWithDest) {
      if (!p.destLocation) continue;
      const key = `${p.resolvedSkuId}___${p.effectiveLote || 'NOLOTE'}___${p.destLocation.id}`;
      if (!groupsMap.has(key)) {
        groupsMap.set(key, {
          skuId: p.resolvedSkuId,
          skuCodigo: p.resolvedSkuCodigo,
          lote: p.effectiveLote,
          destLocId: p.destLocation.id,
          destLocCodigo: p.destLocation.codigo,
          cantidadTotal: 0,
          boxes: [],
        });
      }
      const grp = groupsMap.get(key);
      grp.cantidadTotal += (p.box.cantidad || 0);
      grp.boxes.push(p.box);
    }

    const projectedGroups: any[] = [];
    for (const [key, grp] of groupsMap.entries()) {
      const existingLot = await this.prisma.lotInventory.findFirst({
        where: {
          skuId: grp.skuId,
          clienteId: receipt.clienteId,
          ubicacionId: grp.destLocId,
          lote: grp.lote === 'S/L' ? null : grp.lote,
        },
      });

      projectedGroups.push({
        skuCodigo: grp.skuCodigo,
        lote: grp.lote,
        ubicacionDestino: grp.destLocCodigo,
        ubicacionId: grp.destLocId,
        piezasAIncorporar: grp.cantidadTotal,
        accionLotInventory: existingLot ? 'INCREMENTAR_SALDO_EXISTENTE' : 'CREAR_NUEVO_LOT_INVENTORY',
        lotInventoryExistenteId: existingLot ? existingLot.id : null,
        saldoActualEnDestino: existingLot ? existingLot.cantidadDisponible : 0,
        saldoProyectadoEnDestino: (existingLot ? existingLot.cantidadDisponible : 0) + grp.cantidadTotal,
        totalHUsAEnlazar: grp.boxes.length,
        husAEnlazar: grp.boxes.map((b: any) => b.codigo),
        movimientosTrasiegoAGenerar: grp.boxes.length,
      });
    }

    const totalPiezasPendientes = pendingBoxes.reduce((acc: number, b: any) => acc + (b.cantidad || 0), 0);

    return {
      inconsistenciaDetectada: true,
      reconciliable: true,
      receipt: {
        id: receipt.id,
        codigo: receipt.codigo,
        estado: receipt.estado,
        cliente: receipt.cliente?.nombreComercial || receipt.cliente?.razonSocial || 'Depositante',
        fechaCierreOriginal: receipt.fechaCierre,
        cerradoPorOriginal: receipt.cerradoPor,
      },
      diagnostico: {
        totalHUsComerciales: activeBoxes.length,
        totalHUsContabilizadas: accountedBoxes.length,
        totalHUsPendientes: pendingBoxes.length,
        totalPiezasPendientes,
        racksFisicamenteConfirmados: [...new Set(pendingBoxes.map((b: any) => b.ubicacionActual).filter(Boolean))],
      },
      gruposProyectados: projectedGroups,
      auditoriaAProducir: 'PUTAWAY_RECONCILIACION_POST_CIERRE',
      politicaInmutabilidad: {
        estadoPreservado: 'CERRADA',
        modificaFechaCierre: false,
        modificaCerradorOriginal: false,
        alteraAuditoriasPrevias: false,
      },
      requisitosEjecucion: {
        requiereSupervisor: true,
        requiereMotivo: true,
        motivoLongitudMinima: 10,
      },
    };
  }

  @Post('receipts/:id/post-closure-reconciliation/execute')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Ejecutar Reconciliación Post-Cierre de Putaway (Transaccional y Trazable)',
    description: 'Consolida de manera atómica el inventario físico en racks para un expediente cerrado, preservando el estado CERRADA y registrando la auditoría PUTAWAY_RECONCILIACION_POST_CIERRE.',
  })
  @ApiParam({ name: 'id', description: 'ID o código de la recepción previa cerrada' })
  async executePostClosurePutawayReconciliation(@Param('id') receiptId: string, @Body() body: any) {
    const tStart = Date.now();
    const usuarioResponsable = (body.usuario || '').trim();
    const motivo = (body.motivo || '').trim();

    if (!usuarioResponsable) {
      throw new HttpException(
        'Se requiere identificar al usuario supervisor responsable de la reconciliación post-cierre.',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (!motivo || motivo.length < 10) {
      throw new HttpException(
        'El motivo de la reconciliación post-cierre es obligatorio y debe contener al menos 10 caracteres explicativos para fines de auditoría 3PL.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const receipt = await this.prisma.receipt.findFirst({
      where: { OR: [{ id: receiptId }, { codigo: receiptId }] },
      include: {
        cliente: true,
        lineas: { include: { sku: true } },
        handlingUnits: true,
      },
    });

    if (!receipt) {
      throw new HttpException('Previo de recibo no encontrado', HttpStatus.NOT_FOUND);
    }

    if (receipt.estado !== 'CERRADA' && receipt.estado !== 'CERRADO') {
      throw new HttpException(
        `Este endpoint es exclusivo para expedientes en estado CERRADA. El expediente actual se encuentra en estado "${receipt.estado}".`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const isMermaHu = (h: any) =>
      h.codigo?.includes('MERMA') ||
      h.codigo?.startsWith('HU-NC-') ||
      h.ubicacionActual === 'DEV-01' ||
      h.ubicacionActual?.includes('DEV');

    const activeBoxes = receipt.handlingUnits.filter(
      (h: any) => h.tipoHu === 'CAJA' && h.estadoHu === 'ACTIVO' && !isMermaHu(h),
    );

    const activeBoxLotIds = activeBoxes.map((b: any) => b.lotId).filter(Boolean);
    const existingLotsForBoxes = activeBoxLotIds.length > 0
      ? await this.prisma.lotInventory.findMany({
          where: { id: { in: activeBoxLotIds } },
          include: { ubicacion: true },
        })
      : [];
    const lotMapById = new Map<string, any>(existingLotsForBoxes.map(l => [l.id, l]));

    const existingMovements = await this.prisma.inventoryMovement.findMany({
      where: {
        documentoOrigen: receipt.codigo,
        tipoMovimiento: 'TRASIEGO',
        huId: { in: activeBoxes.map((b: any) => b.id) },
      },
      select: { huId: true },
    });
    const movementHuIds = new Set(existingMovements.map((m: any) => m.huId));

    const isBoxCanonicallyAccounted = (b: any): boolean => {
      if (!b.lotId) return false;
      const lot = lotMapById.get(b.lotId);
      if (!lot) return false;
      if (lot.clienteId !== receipt.clienteId) return false;
      const line = receipt.lineas?.find((l: any) => l.id === b.receiptLineId) ||
        receipt.lineas?.find((l: any) => l.sku?.codigo === b.skuCodigo);
      const resolvedSkuId = (b as any).skuId || line?.skuId;
      if (resolvedSkuId && lot.skuId !== resolvedSkuId) return false;
      if (b.ubicacionActual && lot.ubicacion?.codigo !== b.ubicacionActual) return false;
      if (!movementHuIds.has(b.id)) return false;
      return true;
    };

    const pendingBoxes = activeBoxes.filter((b: any) => !isBoxCanonicallyAccounted(b));

    if (pendingBoxes.length === 0) {
      return {
        success: true,
        idempotent: true,
        message: `El expediente cerrado "${receipt.codigo}" ya se encuentra 100% contabilizado canónicamente. No hubo mutaciones.`,
        receiptId: receipt.id,
        receiptCodigo: receipt.codigo,
        estado: receipt.estado,
      };
    }

    // Validar evidencia física para cada bulto pendiente
    const neededLocCodes = [...new Set(pendingBoxes.map((b: any) => b.ubicacionActual).filter(Boolean))];
    const locations = await this.prisma.location.findMany({
      where: { codigo: { in: neededLocCodes } },
    });
    const locMapByCode = new Map<string, any>(locations.map(l => [l.codigo.toUpperCase(), l]));

    const pendingWithDest: any[] = [];
    for (const b of pendingBoxes) {
      if (!b.ubicacionActual || ['RAMPA_RECEPCION', 'REC-01', 'RECIBO', 'ANDEN', 'STAGING', 'DEV-01'].includes(b.ubicacionActual)) {
        throw new HttpException(
          `Bloqueo de Reconciliación: La caja "${b.codigo}" no cuenta con ubicación física en racks.`,
          HttpStatus.BAD_REQUEST,
        );
      }
      const destLoc = locMapByCode.get(b.ubicacionActual.toUpperCase());
      if (!destLoc) {
        throw new HttpException(
          `Ubicación rack "${b.ubicacionActual}" de la caja "${b.codigo}" no existe en el catálogo.`,
          HttpStatus.BAD_REQUEST,
        );
      }

      const line = receipt.lineas?.find((l: any) => l.id === b.receiptLineId) ||
        receipt.lineas?.find((l: any) => l.sku?.codigo === b.skuCodigo);
      const resolvedSkuId = (b as any).skuId || line?.skuId;
      if (!resolvedSkuId) {
        throw new HttpException(`No se pudo resolver el SKU de la caja "${b.codigo}".`, HttpStatus.BAD_REQUEST);
      }
      const effectiveLote = b.loteTexto || line?.loteAsignado || line?.loteEsperado || null;
      const effectiveFechaVencimiento = b.fechaVencimiento || line?.fechaVencimiento || null;

      pendingWithDest.push({
        box: b,
        destLocation: destLoc,
        resolvedSkuId,
        resolvedSkuCodigo: b.skuCodigo || line?.sku?.codigo || 'SKU',
        effectiveLote,
        effectiveFechaVencimiento: effectiveFechaVencimiento ? new Date(effectiveFechaVencimiento) : null,
      });
    }

    const sortedHuIds = [...new Set(pendingBoxes.map((b: any) => b.id))].sort();
    const sortedLocIds = [...new Set(pendingWithDest.map(p => p.destLocation.id))].sort();

    // =========================================================================
    // EJECUCIÓN ATÓMICA TRANSACCIONAL DE RECONCILIACIÓN POST-CIERRE
    // =========================================================================
    return await this.putawayEngine.executeWithDeadlockRetry(
      async () => {
        return await this.prisma.$transaction(
          async (tx) => {
            // 1. Bloqueo pesimista determinista
            await this.putawayEngine.acquirePessimisticLocks(tx, sortedHuIds, sortedLocIds);

            // 2. Relectura de estado real dentro de la transacción
            const freshHus = await tx.handlingUnit.findMany({ where: { id: { in: sortedHuIds } } });
            const freshHuMap = new Map<string, any>(freshHus.map(h => [h.id, h]));

            const freshLocations = await tx.location.findMany({
              where: { id: { in: sortedLocIds } },
              include: { zona: true },
            });
            const freshLocMap = new Map<string, any>(freshLocations.map(l => [l.id, l]));

            // 3. Agrupación por tupla canónica: (skuId, lote, destLocId)
            const groupsMap = new Map<string, any>();
            for (const p of pendingWithDest) {
              const freshHu = freshHuMap.get(p.box.id);
              const cant = freshHu?.cantidad ?? p.box.cantidad ?? 0;
              const groupKey = `${p.resolvedSkuId}___${p.effectiveLote || 'NOLOTE'}___${p.destLocation.id}`;
              if (!groupsMap.has(groupKey)) {
                groupsMap.set(groupKey, {
                  skuId: p.resolvedSkuId,
                  skuCodigo: p.resolvedSkuCodigo,
                  lote: p.effectiveLote,
                  fechaVencimiento: p.effectiveFechaVencimiento,
                  destLocId: p.destLocation.id,
                  destLocCodigo: p.destLocation.codigo,
                  cantidadTotal: 0,
                  boxes: [],
                });
              }
              const grp = groupsMap.get(groupKey);
              grp.cantidadTotal += cant;
              grp.boxes.push(p);
            }

            // 4. Validar capacidad en ubicaciones destino
            const capacityByLoc = new Map<string, number>();
            for (const group of groupsMap.values()) {
              capacityByLoc.set(group.destLocId, (capacityByLoc.get(group.destLocId) || 0) + group.cantidadTotal);
            }

            for (const [locId, cantReconciliar] of capacityByLoc.entries()) {
              const loc = freshLocMap.get(locId);
              if (loc && loc.capacidadUnits > 0) {
                const currentLots = await tx.lotInventory.findMany({
                  where: { ubicacionId: locId },
                });
                const currentOcc = currentLots.reduce((acc: number, l: any) => acc + (l.cantidadDisponible || 0), 0);
                if (currentOcc + cantReconciliar > loc.capacidadUnits) {
                  throw new HttpException(
                    `Capacidad excedida: El rack "${loc.codigo}" excedería su límite (${currentOcc + cantReconciliar}/${loc.capacidadUnits} pzas).`,
                    HttpStatus.CONFLICT,
                  );
                }
              }
            }

            // 5. Crear o reutilizar LotInventory para cada grupo
            const targetLotIdByGroup = new Map<string, string>();
            for (const [groupKey, group] of groupsMap.entries()) {
              let existingTargetLot = await tx.lotInventory.findFirst({
                where: {
                  skuId: group.skuId,
                  clienteId: receipt.clienteId,
                  ubicacionId: group.destLocId,
                  lote: group.lote ? group.lote : null,
                },
              });

              let targetLotId: string;
              if (existingTargetLot) {
                await tx.lotInventory.update({
                  where: { id: existingTargetLot.id },
                  data: {
                    cantidadDisponible: { increment: group.cantidadTotal },
                    notas: existingTargetLot.notas
                      ? `${existingTargetLot.notas} | Reconciliación post-cierre ${receipt.codigo} (+${group.cantidadTotal} pzas)`
                      : `Reconciliación post-cierre ${receipt.codigo} (+${group.cantidadTotal} pzas)`,
                  },
                });
                targetLotId = existingTargetLot.id;
              } else {
                const newLot = await tx.lotInventory.create({
                  data: {
                    skuId: group.skuId,
                    clienteId: receipt.clienteId,
                    lote: group.lote,
                    fechaVencimiento: group.fechaVencimiento,
                    ubicacionId: group.destLocId,
                    cantidadDisponible: group.cantidadTotal,
                    estadoCalidad: 'LIBERADO',
                    notas: `Reconciliación post-cierre desde ${receipt.codigo} a rack ${group.destLocCodigo}${group.lote ? ` (Lote ${group.lote})` : ''}`,
                  },
                });
                targetLotId = newLot.id;
              }
              targetLotIdByGroup.set(groupKey, targetLotId);
            }

            // 6. Actualizar HandlingUnits
            const huUpdatePromises: Promise<any>[] = [];
            const inventoryMovementsData: any[] = [];

            for (const p of pendingWithDest) {
              const groupKey = `${p.resolvedSkuId}___${p.effectiveLote || 'NOLOTE'}___${p.destLocation.id}`;
              const targetLotId = targetLotIdByGroup.get(groupKey)!;
              const freshHu = freshHuMap.get(p.box.id);
              const cant = freshHu?.cantidad ?? p.box.cantidad ?? 0;

              huUpdatePromises.push(
                tx.handlingUnit.update({
                  where: { id: p.box.id },
                  data: {
                    ubicacionActual: p.destLocation.codigo,
                    lotId: targetLotId,
                    estadoHu: 'ACTIVO',
                  },
                }),
              );

              inventoryMovementsData.push({
                tipoMovimiento: 'TRASIEGO',
                skuId: p.resolvedSkuId,
                clienteId: receipt.clienteId,
                lotId: targetLotId,
                huId: p.box.id,
                fromLocationId: null,
                toLocationId: p.destLocation.id,
                cantidad: cant,
                usuario: usuarioResponsable,
                motivo: `Reconciliación post-cierre de Putaway a rack ${p.destLocation.codigo}: ${motivo}`,
                documentoOrigen: receipt.codigo,
              });
            }

            await Promise.all(huUpdatePromises);

            // 7. Ubicaciones destino a OCUPADO
            for (const locId of sortedLocIds) {
              await tx.location.update({
                where: { id: locId },
                data: { estado: 'OCUPADO' },
              });
            }

            // 8. Inserción de InventoryMovement idempotente
            const existingMovementsTx = await tx.inventoryMovement.findMany({
              where: {
                documentoOrigen: receipt.codigo,
                tipoMovimiento: 'TRASIEGO',
                huId: { in: inventoryMovementsData.map(m => m.huId).filter(Boolean) },
              },
              select: { huId: true },
            });
            const existingHuIds = new Set(existingMovementsTx.map(m => m.huId));
            const movementsToInsert = inventoryMovementsData.filter(m => !m.huId || !existingHuIds.has(m.huId));

            if (movementsToInsert.length > 0) {
              await tx.inventoryMovement.createMany({
                data: movementsToInsert,
              });
            }

            // 9. Registrar auditoría explícita PUTAWAY_RECONCILIACION_POST_CIERRE
            const totalPiezasAlojadas = pendingWithDest.reduce((acc: number, p: any) => acc + (p.box.cantidad || 0), 0);
            const racksAsignados = [...new Set(pendingWithDest.map(p => p.destLocation.codigo))];

            const auditRecord = await tx.auditLog.create({
              data: {
                usuario: usuarioResponsable,
                accion: 'PUTAWAY_RECONCILIACION_POST_CIERRE',
                entidad: 'Receipt',
                entidadId: receipt.id,
                detalle: `Reconciliación Post-Cierre de Putaway ejecutada por ${usuarioResponsable}. Motivo: ${motivo}. Detalle: Se contabilizaron canónicamente ${pendingWithDest.length} HUs (${totalPiezasAlojadas} pzas) en racks ${racksAsignados.join(', ')}. Estado CERRADA y fecha de cierre original preservados intactos. Duración: ${Date.now() - tStart}ms.`,
              },
            });

            // NOTA: NO SE MODIFICA receipt.estado (permanece CERRADA)
            // NO SE MODIFICA receipt.fechaCierre (permanece intacta)
            // NO SE MODIFICA receipt.cerradoPor (permanece intacta)

            return {
              success: true,
              reconciliacionPostCierre: true,
              message: `¡Reconciliación post-cierre ejecutada exitosamente! Se incorporaron ${pendingWithDest.length} bultos (${totalPiezasAlojadas} pzas) a inventario DISPONIBLE en racks. El expediente preserva su estatus CERRADA y su fecha de cierre original.`,
              receiptId: receipt.id,
              receiptCodigo: receipt.codigo,
              estadoRecibo: receipt.estado,
              fechaCierreOriginal: receipt.fechaCierre,
              cerradoPorOriginal: receipt.cerradoPor,
              supervisorResponsable: usuarioResponsable,
              motivo,
              totalHUsReconciliadas: pendingWithDest.length,
              piezasIncorporadas: totalPiezasAlojadas,
              racksAsignados,
              auditLogId: auditRecord.id,
              durationMs: Date.now() - tStart,
              timestamp: new Date().toISOString(),
            };
          },
          {
            maxWait: 15000,
            timeout: 30000,
          },
        );
      },
      { opName: 'executePostClosurePutawayReconciliation' },
    );
  }

  // Generic Putaway fallback endpoint protegido con protocolo transaccional (Regla 9)
  @Post('putaway')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Ejecutar movimientos generales de alojamiento (Putaway)' })
  async executePutawayGeneric(@Body() body: any) {
    if (!body?.movimientos || body.movimientos.length === 0) {
      throw new HttpException('Sin movimientos para ejecutar', HttpStatus.BAD_REQUEST);
    }
    const receiptId = body.receiptId || body.movimientos[0]?.receiptId;
    if (receiptId) {
      return this.confirmPutaway(receiptId, {
        movimientos: body.movimientos,
        usuario: body.usuario || body.movimientos[0]?.usuario,
        modo: body.modo || 'DIRECTO',
      });
    }

    const usuario = body.usuario || 'Montacarguista';
    const huIds = body.movimientos.map((m: any) => m.huId).filter(Boolean);
    const locIds = body.movimientos.map((m: any) => m.ubicacionDestinoId).filter(Boolean);

    return await this.putawayEngine.executeWithDeadlockRetry(
      async () => {
        return await this.prisma.$transaction(
          async (tx) => {
            await this.putawayEngine.acquirePessimisticLocks(tx, huIds, locIds);

            for (const m of body.movimientos) {
              if (m.ubicacionDestinoId && m.skuId) {
                const cant = m.cantidad || 0;
                const reval = await this.putawayEngine.revalidateLocationForPutaway(m.ubicacionDestinoId, cant, tx);
                if (!reval.valid) {
                  throw new HttpException(
                    {
                      statusCode: HttpStatus.CONFLICT,
                      message: reval.error || `La ubicación de destino ya no tiene capacidad suficiente.`,
                      error: 'Conflict',
                    },
                    HttpStatus.CONFLICT,
                  );
                }

                await tx.inventoryMovement.create({
                  data: {
                    tipoMovimiento: 'TRASIEGO',
                    skuId: m.skuId,
                    clienteId: m.clienteId,
                    fromLocationId: m.ubicacionOrigenId || null,
                    toLocationId: m.ubicacionDestinoId,
                    cantidad: cant,
                    usuario,
                    motivo: 'Alojamiento Putaway manual',
                  },
                });

                if (m.huId) {
                  const loc = await tx.location.findUnique({ where: { id: m.ubicacionDestinoId } });
                  if (loc) {
                    await tx.handlingUnit.update({
                      where: { id: m.huId },
                      data: { ubicacionActual: loc.codigo, estadoHu: 'ACTIVO' },
                    });
                  }
                }
              }
            }
            return { success: true, message: `Alojamiento ejecutado para ${body.movimientos.length} productos` };
          },
          { maxWait: 10000, timeout: 20000 },
        );
      },
      { opName: 'executePutawayGeneric' },
    );
  }

  @Post('receipts/:id/unlock')
  @ApiOperation({
    summary: 'Desbloquear previo para corrección excepcional (Supervisor - Tarea 3)',
    description: 'Permite a un supervisor abrir temporalmente el candado de un previo activo para corregir discrepancias de captura, exigiendo justificación obligatoria. No aplica para recepciones CERRADAS.',
  })
  @ApiParam({ name: 'id', description: 'Identificador único UUID de la recepción previa' })
  @ApiBody({ type: UnlockReceiptDto })
  @ApiResponse({ status: 200, description: 'Previo desbloqueado exitosamente para corrección excepcional.' })
  @ApiResponse({ status: 400, description: 'Datos incompletos: Se requiere justificar obligatoriamente el motivo.', type: ApiErrorResponseDto })
  @ApiResponse({ status: 403, description: 'Operación no permitida: Recepción histórica CERRADA es inmutable.', type: ApiErrorResponseDto })
  @ApiResponse({ status: 404, description: 'Recepción previa no encontrada.', type: ApiErrorResponseDto })
  async unlockReceipt(@Param('id') receiptId: string, @Body() body?: { usuario?: string; motivo?: string }) {
    try {
      const receipt = await this.prisma.receipt.findUnique({ where: { id: receiptId } });
      if (!receipt) {
        throw new HttpException(
          {
            statusCode: HttpStatus.NOT_FOUND,
            message: `Previo de recibo con ID "${receiptId}" no encontrado.`,
            error: 'Not Found',
            detalles: { codigo: 'RECEPCION_NO_ENCONTRADA', receiptId },
          },
          HttpStatus.NOT_FOUND,
        );
      }

      if (receipt.estado === 'CERRADO' || receipt.estado === 'CERRADA') {
        throw new HttpException(
          {
            statusCode: HttpStatus.FORBIDDEN,
            message: 'Operación no permitida: La recepción está CERRADA y finiquitada en inventario. Por políticas de auditoría WMS y control de inventario, ni el administrador puede alterar ni desbloquear una recepción histórica cerrada.',
            error: 'Forbidden',
            detalles: { codigo: 'RECEPCION_CERRADA_INMUTABLE' },
          },
          HttpStatus.FORBIDDEN,
        );
      }

      if (!body?.motivo || typeof body.motivo !== 'string' || body.motivo.trim().length === 0) {
        throw new HttpException(
          {
            statusCode: HttpStatus.BAD_REQUEST,
            message: 'Datos incompletos: Se requiere justificar obligatoriamente el motivo del desbloqueo operativo para la bitácora de auditoría.',
            error: 'Bad Request',
            detalles: { codigo: 'MOTIVO_DESBLOQUEO_REQUERIDO', campo: 'motivo' },
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      const usuario = body?.usuario || 'Supervisor';
      const motivo = body.motivo.trim();

      const updated = await this.prisma.receipt.update({
        where: { id: receiptId },
        data: {
          bloqueado: false,
          bloqueadoPor: null,
          fechaBloqueo: null,
        },
        include: { cliente: true, proveedor: true, lineas: { include: { sku: true } } },
      });

      await this.audit(
        usuario,
        'DESBLOQUEAR_PREVIO',
        'Receipt',
        receiptId,
        `Previo ${receipt.codigo} desbloqueado para corrección por supervisor. Motivo: ${motivo}`,
      );

      return {
        success: true,
        message: `Previo ${receipt.codigo} desbloqueado para edición`,
        receipt: updated,
      };
    } catch (error: any) {
      console.error('Error al desbloquear previo:', error);
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: error.message || 'Error interno al desbloquear previo',
          error: 'Internal Server Error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Put('receipts/:id')
  @ApiOperation({ summary: 'Editar metadatos de previo de recibo' })
  async updateReceipt(@Param('id') receiptId: string, @Body() data: any) {
    try {
      const receipt = await this.prisma.receipt.findUnique({ where: { id: receiptId } });
      if (!receipt) throw new HttpException('Previo de recibo no encontrado', HttpStatus.NOT_FOUND);

      if (receipt.bloqueado && data.bloqueado !== false) {
        throw new HttpException('Operación rechazada: El previo está confirmado y bloqueado contra edición. Desbloquéelo para realizar modificaciones.', HttpStatus.FORBIDDEN);
      }

      const updated = await this.prisma.receipt.update({
        where: { id: receiptId },
        data: {
          facturaRespaldo: data.facturaRespaldo !== undefined ? data.facturaRespaldo : receipt.facturaRespaldo,
          ocReferencia: data.ocReferencia !== undefined ? data.ocReferencia : receipt.ocReferencia,
          tipoImportacion: data.tipoImportacion !== undefined ? data.tipoImportacion : receipt.tipoImportacion,
          origen: data.origen !== undefined ? data.origen : receipt.origen,
          tipoRecepcion: data.tipoRecepcion !== undefined ? data.tipoRecepcion : receipt.tipoRecepcion,
          folioTransporte: data.folioTransporte !== undefined ? data.folioTransporte : receipt.folioTransporte,
          lineaTransporte: data.lineaTransporte !== undefined ? data.lineaTransporte : receipt.lineaTransporte,
          capacidadCarga: data.capacidadCarga !== undefined ? data.capacidadCarga : receipt.capacidadCarga,
          placa: data.placa !== undefined ? data.placa : receipt.placa,
          nombreChofer: data.nombreChofer !== undefined ? data.nombreChofer : receipt.nombreChofer,
          notas: data.notas !== undefined ? data.notas : receipt.notas,
          proveedorId: data.proveedorId !== undefined ? data.proveedorId : receipt.proveedorId,
          bloqueado: data.bloqueado !== undefined ? Boolean(data.bloqueado) : receipt.bloqueado,
        },
        include: { cliente: true, proveedor: true, lineas: { include: { sku: true } } },
      });

      await this.audit(data.usuario || 'Operador', 'EDITAR_PREVIO', 'Receipt', receiptId, `Actualizados datos del previo ${receipt.codigo}`);
      return updated;
    } catch (error: any) {
      console.error('Error al editar previo:', error);
      throw new HttpException(error.message || 'Error al actualizar el previo', error.status || HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Delete('receipts/:id')
  @ApiOperation({ summary: 'Eliminar previo de recibo completo' })
  async deleteReceipt(@Param('id') receiptId: string) {
    try {
      const receipt = await this.prisma.receipt.findUnique({ where: { id: receiptId }, include: { lineas: true } });
      if (!receipt) throw new HttpException('Previo no encontrado', HttpStatus.NOT_FOUND);

      if (receipt.bloqueado) {
        throw new HttpException('Operación rechazada: No se puede eliminar un previo confirmado y bloqueado.', HttpStatus.FORBIDDEN);
      }

      await this.prisma.receiptLine.deleteMany({ where: { recepcionId: receiptId } });
      await this.prisma.receipt.delete({ where: { id: receiptId } });

      await this.audit('Operador', 'ELIMINAR_PREVIO', 'Receipt', receiptId, `Eliminado previo ${receipt.codigo}`);
      return { success: true, message: `Previo ${receipt.codigo} eliminado correctamente` };
    } catch (error: any) {
      console.error('Error al eliminar previo:', error);
      throw new HttpException(error.message || 'Error al eliminar el previo', error.status || HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Put('receipt-lines/:id')
  @ApiOperation({ summary: 'Editar línea de previo de recibo' })
  async updateReceiptLine(
    @Param('id') lineId: string,
    @Body() data: { cantidadEsperada?: number; notas?: string; skuId?: string; loteEsperado?: string; lote?: string; fechaVencimiento?: string; fechaCaducidad?: string },
  ) {
    try {
      const line = await this.prisma.receiptLine.findUnique({ where: { id: lineId }, include: { recepcion: true } });
      if (!line) throw new HttpException('Línea no encontrada', HttpStatus.NOT_FOUND);

      if (line.recepcion?.bloqueado || line.recepcion?.estado === 'CERRADA' || line.recepcion?.estado === 'CERRADO') {
        throw new HttpException('Operación rechazada: El previo está confirmado o cerrado. Las partidas esperadas no admiten modificaciones.', HttpStatus.FORBIDDEN);
      }

      if (data.skuId && data.skuId !== line.skuId) {
        const sku = await this.prisma.skuMaster.findUnique({
          where: { id: data.skuId },
          include: { cliente: { select: { nombreComercial: true } } },
        });
        if (!sku) throw new HttpException('El SKU especificado no existe en el catálogo', HttpStatus.NOT_FOUND);
        if (sku.clienteId !== line.recepcion.clienteId) {
          throw new HttpException(
            `Violación de catálogo: El SKU "${sku.codigo}" pertenece al depositante "${sku.cliente?.nombreComercial || 'otro cliente'}", no al de esta recepción.`,
            HttpStatus.BAD_REQUEST,
          );
        }
      }

      const updated = await this.prisma.receiptLine.update({
        where: { id: lineId },
        data: {
          cantidadEsperada: data.cantidadEsperada !== undefined ? Number(data.cantidadEsperada) : line.cantidadEsperada,
          skuId: data.skuId || line.skuId,
          loteEsperado: data.loteEsperado !== undefined ? data.loteEsperado : (data.lote !== undefined ? data.lote : line.loteEsperado),
          fechaVencimiento: data.fechaVencimiento !== undefined ? (data.fechaVencimiento ? new Date(data.fechaVencimiento) : null) : (data.fechaCaducidad !== undefined ? (data.fechaCaducidad ? new Date(data.fechaCaducidad) : null) : line.fechaVencimiento),
          notas: data.notas !== undefined ? data.notas : line.notas,
        },
        include: { sku: true },
      });

      return updated;
    } catch (error: any) {
      console.error('Error al editar línea de previo:', error);
      throw new HttpException(error.message || 'Error al actualizar la línea', error.status || HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Delete('receipt-lines/:id')
  @ApiOperation({ summary: 'Eliminar línea de previo de recibo' })
  async deleteReceiptLine(@Param('id') lineId: string) {
    try {
      const line = await this.prisma.receiptLine.findUnique({ where: { id: lineId }, include: { recepcion: true } });
      if (!line) throw new HttpException('Línea no encontrada', HttpStatus.NOT_FOUND);

      if (line.recepcion?.bloqueado || line.recepcion?.estado === 'CERRADA' || line.recepcion?.estado === 'CERRADO') {
        throw new HttpException('Operación rechazada: El previo está confirmado o cerrado. No se pueden eliminar partidas confirmadas.', HttpStatus.FORBIDDEN);
      }

      await this.prisma.receiptLine.delete({ where: { id: lineId } });
      return { success: true, message: 'Línea eliminada correctamente del previo' };
    } catch (error: any) {
      console.error('Error al eliminar línea:', error);
      throw new HttpException(error.message || 'Error al eliminar la línea', error.status || HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post('receipts/:id/lines')
  @ApiOperation({
    summary: 'Agregar nueva partida de SKU a recepción previa existente (Tarea 1 / Tarea 4)',
    description: 'Permite registrar una partida de SKU esperado en un previo abierto, validando que el producto pertenezca al catálogo del cliente depositante y que la cantidad esperada sea estrictamente mayor a 0. Rechaza modificaciones con 403 si el previo está bloqueado o cerrado.',
  })
  @ApiParam({ name: 'id', description: 'Identificador único UUID de la recepción previa' })
  @ApiBody({ type: AddPrevioLineDto })
  @ApiResponse({ status: 201, description: 'Partida de SKU agregada exitosamente al previo.' })
  @ApiResponse({ status: 400, description: 'Datos incompletos (skuId ausente, cantidad <= 0) o violación de catálogo.', type: ApiErrorResponseDto })
  @ApiResponse({ status: 403, description: 'Operación rechazada: El previo está confirmado o cerrado.', type: ApiErrorResponseDto })
  @ApiResponse({ status: 404, description: 'Recepción previa o SKU no encontrado.', type: ApiErrorResponseDto })
  async addReceiptLine(@Param('id') receiptId: string, @Body() data: any) {
    try {
      const receipt = await this.prisma.receipt.findUnique({
        where: { id: receiptId },
        include: { cliente: { select: { id: true, nombreComercial: true } } },
      });
      if (!receipt) {
        throw new HttpException(
          {
            statusCode: HttpStatus.NOT_FOUND,
            message: `Previo de recibo con ID "${receiptId}" no encontrado.`,
            error: 'Not Found',
            detalles: { codigo: 'RECEPCION_NO_ENCONTRADA', receiptId },
          },
          HttpStatus.NOT_FOUND,
        );
      }

      if (receipt.bloqueado || receipt.estado === 'CERRADO' || receipt.estado === 'CERRADA') {
        throw new HttpException(
          {
            statusCode: HttpStatus.FORBIDDEN,
            message: 'Operación rechazada: El previo está confirmado o cerrado. No se pueden agregar partidas a una recepción bloqueada.',
            error: 'Forbidden',
            detalles: { codigo: 'PREVIO_BLOQUEADO', estado: receipt.estado },
          },
          HttpStatus.FORBIDDEN,
        );
      }

      if (!data?.skuId || typeof data.skuId !== 'string' || data.skuId.trim() === '') {
        throw new HttpException(
          {
            statusCode: HttpStatus.BAD_REQUEST,
            message: 'Datos incompletos: El identificador del producto (skuId) es obligatorio para agregar una partida al previo.',
            error: 'Bad Request',
            detalles: { codigo: 'SKU_ID_REQUERIDO', campo: 'skuId' },
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      const qty = Number(data?.cantidadEsperada);
      if (isNaN(qty) || qty <= 0) {
        throw new HttpException(
          {
            statusCode: HttpStatus.BAD_REQUEST,
            message: `Datos incompletos o inválidos: La cantidad esperada debe ser un número mayor a 0 (recibido: ${data?.cantidadEsperada}).`,
            error: 'Bad Request',
            detalles: { codigo: 'CANTIDAD_ESPERADA_INVALIDA', campo: 'cantidadEsperada', valor: data?.cantidadEsperada },
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      // Tarea 4: Validación automática contra catálogo del depositante
      const sku = await this.prisma.skuMaster.findUnique({
        where: { id: data.skuId },
        include: { cliente: { select: { id: true, nombreComercial: true } } },
      });
      if (!sku) {
        throw new HttpException(
          {
            statusCode: HttpStatus.NOT_FOUND,
            message: `El SKU seleccionado con ID "${data.skuId}" no existe en el catálogo maestro.`,
            error: 'Not Found',
            detalles: { codigo: 'SKU_NO_ENCONTRADO', skuId: data.skuId },
          },
          HttpStatus.NOT_FOUND,
        );
      }
      if (sku.clienteId !== receipt.clienteId) {
        throw new HttpException(
          {
            statusCode: HttpStatus.BAD_REQUEST,
            message: `Violación de catálogo: El SKU "${sku.codigo}" (${sku.descripcion}) pertenece a "${sku.cliente?.nombreComercial || 'otro depositante'}", no al cliente "${receipt.cliente?.nombreComercial || 'asignado'}" de este previo.`,
            error: 'Bad Request',
            detalles: { codigo: 'SKU_AJENO_DETECTADO', skuCodigo: sku.codigo, clientePropietario: sku.cliente?.nombreComercial },
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      if (sku.activo === false) {
        throw new HttpException(
          {
            statusCode: HttpStatus.BAD_REQUEST,
            message: `El SKU "${sku.codigo}" se encuentra INACTIVO en el catálogo maestro y no puede utilizarse en recepciones. Reactívelo antes de continuar.`,
            error: 'Bad Request',
            detalles: { codigo: 'SKU_INACTIVO', skuCodigo: sku.codigo },
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      const created = await this.prisma.receiptLine.create({
        data: {
          recepcionId: receiptId,
          skuId: data.skuId,
          cantidadEsperada: qty,
          folio: data.folio ? String(data.folio) : null,
          sucursal: data.sucursal ? String(data.sucursal) : null,
          tipoContenedor: data.tipoContenedor || 'Caja máster',
          uom: data.uom || 'PZA',
          loteEsperado: data.loteEsperado || data.lote || null,
          fechaVencimiento: data.fechaVencimiento ? new Date(data.fechaVencimiento) : (data.fechaCaducidad ? new Date(data.fechaCaducidad) : null),
          notas: data.notas || 'Agregado manualmente a previo',
        },
        include: { sku: true },
      });

      return created;
    } catch (error: any) {
      console.error('Error al agregar línea:', error);
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: error.message || 'Error al agregar el producto al previo',
          error: 'Internal Server Error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('receipts/:id/generate-barcodes')
  @ApiOperation({ summary: 'Generar códigos de barras EAN-13 para los SKUs del previo' })
  async generateReceiptBarcodes(@Param('id') receiptId: string, @Body() body?: { forceRegenerate?: boolean }) {
    const receipt = await this.prisma.receipt.findUnique({
      where: { id: receiptId },
      include: {
        lineas: { include: { sku: true } },
      },
    });
    if (!receipt) throw new HttpException('Previo de recibo no encontrado', HttpStatus.NOT_FOUND);

    const updatedSkus: any[] = [];
    const generatedCodes: { skuId: string; codigo: string; codigoBarras: string }[] = [];

    for (const linea of receipt.lineas) {
      if (!linea.sku.codigoBarras || body?.forceRegenerate) {
        // Algoritmo EAN-13 GS1 México (750) + 8 dígitos + checksum
        const randomNum = Math.floor(10000000 + Math.random() * 90000000);
        const ean12 = `750${randomNum}1`;
        
        let sumEven = 0;
        let sumOdd = 0;
        for (let i = 0; i < 12; i++) {
          const digit = parseInt(ean12[i]);
          if (i % 2 === 0) sumOdd += digit;
          else sumEven += digit;
        }
        const total = sumOdd + sumEven * 3;
        const checkDigit = (10 - (total % 10)) % 10;
        const generatedEan = `${ean12}${checkDigit}`;

        const updated = await this.prisma.skuMaster.update({
          where: { id: linea.sku.id },
          data: { codigoBarras: generatedEan },
        });

        updatedSkus.push(updated);
        generatedCodes.push({ skuId: linea.sku.id, codigo: linea.sku.codigo, codigoBarras: generatedEan });
      }
    }

    await this.audit('Sistema', 'GENERAR_EAN_PREVIO', 'Receipt', receipt.id, `Generados ${updatedSkus.length} códigos de barras`);

    return {
      success: true,
      message: `Se generaron códigos EAN-13 para ${updatedSkus.length} productos`,
      count: updatedSkus.length,
      generatedCodes,
    };
  }

  @Post('print-log')
  @ApiOperation({ summary: 'Registrar log de impresión de etiquetas' })
  async createPrintLog(@Body() data: { usuario: string; tipoEtiqueta: string; referencia: string; motivo?: string }) {
    return this.prisma.printLog.create({
      data: {
        usuario: data.usuario || 'Operador',
        tipoEtiqueta: data.tipoEtiqueta || 'RECEPCION',
        referencia: data.referencia,
        motivo: data.motivo || 'Impresión de etiquetas para recepción y escaneo',
      },
    });
  }

  @Post('reception')
  @ApiOperation({ summary: 'Registrar recepción de mercancía (Conforme y No Conforme)' })
  async registerReception(@Body() data: {
    skuId: string; clienteId: string; lote?: string; serie?: string;
    fechaVencimiento?: string; cantidadConforme?: number; cantidadNoConforme?: number; 
    proveedor?: string; tipoHu: string; 
    ubicacionConformeId?: string; ubicacionNoConformeId?: string; 
    almacenId: string; usuario: string; notas?: string; receiptLineId?: string;
  }) {
    const qtyConforme = data.cantidadConforme || 0;
    const qtyNoConforme = data.cantidadNoConforme || 0;
    const totalQty = qtyConforme + qtyNoConforme;

    if (totalQty <= 0) throw new HttpException('Cantidad total debe ser mayor a 0', HttpStatus.BAD_REQUEST);

    // Tarea 4: Validación automática contra catálogo del depositante y reglas sanitarias por giro
    let sku: any = null;
    let resolvedReceiptId: string | null = null;
    let resolvedReceiptLine: any = null;

    if (data.receiptLineId) {
      resolvedReceiptLine = await this.prisma.receiptLine.findUnique({
        where: { id: data.receiptLineId },
        include: { recepcion: true, sku: true },
      });
      if (!resolvedReceiptLine) {
        throw new HttpException(
          `Partida de recibo con ID "${data.receiptLineId}" no encontrada en la base de datos.`,
          HttpStatus.NOT_FOUND,
        );
      }
      const parentRecId = resolvedReceiptLine.recepcionId || resolvedReceiptLine.recepcion?.id || (resolvedReceiptLine as any).receiptId;
      if (!parentRecId) {
        throw new HttpException(
          `La partida "${data.receiptLineId}" no tiene una recepción asociada válida en el sistema.`,
          HttpStatus.BAD_REQUEST,
        );
      }
      resolvedReceiptId = parentRecId;
      if (!data.skuId && resolvedReceiptLine.skuId) {
        data.skuId = resolvedReceiptLine.skuId;
      }
      if (resolvedReceiptLine.sku) {
        sku = resolvedReceiptLine.sku;
      }
    }

    if (data.skuId && data.clienteId) {
      if (!sku) {
        sku = await this.prisma.skuMaster.findUnique({
          where: { id: data.skuId },
          include: { cliente: { select: { nombreComercial: true, giro: true, requiereLote: true, requiereCaducidad: true } } },
        });
      }
      if (!sku) throw new HttpException('El SKU especificado no existe en el catálogo', HttpStatus.NOT_FOUND);
      if (sku.clienteId !== data.clienteId) {
        throw new HttpException(
          `Violación de catálogo: El SKU "${sku.codigo}" pertenece a "${sku.cliente?.nombreComercial || 'otro depositante'}", no al depositante de esta recepción.`,
          HttpStatus.BAD_REQUEST,
        );
      }

      // Validación estricta por Giro y Trazabilidad Sanitaria
      const isGiroRegulado = sku.cliente?.giro === 'COMIDA' || sku.cliente?.giro === 'FARMACEUTICO';
      const reqLote = Boolean(sku.cliente?.requiereLote || isGiroRegulado || sku.requiereLote);
      const reqCaducidad = Boolean(sku.cliente?.requiereCaducidad || isGiroRegulado || sku.requiereCaducidad);

      if (reqLote && (!data.lote || typeof data.lote !== 'string' || !data.lote.trim())) {
        throw new HttpException(
          {
            statusCode: HttpStatus.BAD_REQUEST,
            message: `El giro "${sku.cliente?.giro || 'REGULADO'}" exige LOTE obligatorio para el SKU "${sku.codigo}".`,
            error: 'Bad Request',
            detalles: { codigo: 'LOTE_OBLIGATORIO_POR_GIRO', skuCodigo: sku.codigo, giro: sku.cliente?.giro },
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      if (reqCaducidad && (!data.fechaVencimiento || typeof data.fechaVencimiento !== 'string' || !data.fechaVencimiento.trim())) {
        throw new HttpException(
          {
            statusCode: HttpStatus.BAD_REQUEST,
            message: `El giro "${sku.cliente?.giro || 'REGULADO'}" exige FECHA DE CADUCIDAD obligatoria para el SKU "${sku.codigo}".`,
            error: 'Bad Request',
            detalles: { codigo: 'CADUCIDAD_OBLIGATORIA_POR_GIRO', skuCodigo: sku.codigo, giro: sku.cliente?.giro },
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      if (data.fechaVencimiento && typeof data.fechaVencimiento === 'string' && data.fechaVencimiento.trim()) {
        const dateStr = data.fechaVencimiento.trim();
        const isIsoFormat = /^\d{4}-\d{2}-\d{2}/.test(dateStr);
        const parsedDate = isIsoFormat ? new Date(dateStr) : new Date(NaN);
        if (!isIsoFormat || isNaN(parsedDate.getTime())) {
          throw new HttpException(
            {
              statusCode: HttpStatus.BAD_REQUEST,
              message: `Formato de fecha de caducidad inválido para el SKU "${sku.codigo}". Utilice el formato YYYY-MM-DD.`,
              error: 'Bad Request',
              detalles: { codigo: 'FECHA_CADUCIDAD_INVALIDA', skuCodigo: sku.codigo },
            },
            HttpStatus.BAD_REQUEST,
          );
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (parsedDate < today) {
          throw new HttpException(
            {
              statusCode: HttpStatus.BAD_REQUEST,
              message: `Rechazo Sanitario: El producto para el SKU "${sku.codigo}" está caducado (fecha: ${data.fechaVencimiento}). No se permite ingresar mercancía vencida.`,
              error: 'Bad Request',
              detalles: { codigo: 'PRODUCTO_CADUCADO_RECHAZADO', skuCodigo: sku.codigo, fechaVencimiento: data.fechaVencimiento },
            },
            HttpStatus.BAD_REQUEST,
          );
        }
      }
    }

    const createdLots: any[] = [];
    const createdHus: any[] = [];

    await withConcurrencyRetry(async () => {
      // Calcular correlativo HU seguro para el año en curso
      const huYear = new Date().getFullYear();
      const huYearPrefix = `HU-${huYear}-`;
      const existingHusGen = await this.prisma.handlingUnit.findMany({
        where: { codigo: { startsWith: huYearPrefix } },
        select: { codigo: true },
      });
      let maxHuSeq = 0;
      for (const h of existingHusGen) {
        const num = parseInt(h.codigo.replace(huYearPrefix, ''), 10);
        if (!isNaN(num) && num > maxHuSeq) maxHuSeq = num;
      }

      // --- Procesar Conforme ---
      if (qtyConforme > 0 && data.ubicacionConformeId) {
        const lotC = await this.prisma.lotInventory.create({
          data: {
            skuId: data.skuId, clienteId: data.clienteId,
            lote: data.lote || null, serie: data.serie || null,
            fechaVencimiento: data.fechaVencimiento ? new Date(data.fechaVencimiento) : null,
            proveedorNombre: data.proveedor,
            estadoCalidad: 'LIBERADO',
            cantidadDisponible: qtyConforme,
            ubicacionId: data.ubicacionConformeId,
          },
        });

        maxHuSeq++;
        const huCodigoC = `${huYearPrefix}${String(maxHuSeq).padStart(5, '0')}`;
        const huC = await this.prisma.handlingUnit.create({
          data: {
            codigo: huCodigoC,
            tipoHu: data.tipoHu || 'CAJA',
            lotId: lotC.id,
            clienteId: data.clienteId,
            receiptId: resolvedReceiptId || undefined,
            receiptLineId: data.receiptLineId || undefined,
            cantidad: qtyConforme,
            uom: resolvedReceiptLine?.uom || 'PZA',
            ubicacionActual: data.ubicacionConformeId,
            estadoHu: 'ACTIVO',
            skuCodigo: resolvedReceiptLine?.sku?.codigo || sku?.codigo,
            skuDescripcion: resolvedReceiptLine?.sku?.descripcion || sku?.descripcion,
            loteTexto: data.lote || null,
            fechaVencimiento: data.fechaVencimiento ? new Date(data.fechaVencimiento) : null,
            facturaRespaldo: resolvedReceiptLine?.recepcion?.facturaRespaldo || resolvedReceiptLine?.recepcion?.ocReferencia || resolvedReceiptLine?.recepcion?.codigo || undefined,
            piezasPorCaja: qtyConforme,
          },
        });

        await this.prisma.inventoryMovement.create({
          data: {
            tipoMovimiento: 'ENTRADA', almacenId: data.almacenId,
            skuId: data.skuId, clienteId: data.clienteId, lotId: lotC.id,
            huId: huC.id, toLocationId: data.ubicacionConformeId,
            cantidad: qtyConforme, usuario: data.usuario,
            motivo: data.notas || `Recepción Conforme — ${data.proveedor || 'Proveedor'}`,
          },
        });

        await this.prisma.location.update({
          where: { id: data.ubicacionConformeId },
          data: { ocupacion: { increment: 1 }, estado: 'OCUPADO' },
        });

        createdLots.push(lotC);
        createdHus.push(huC);
      }

      // --- Procesar No Conforme ---
      if (qtyNoConforme > 0 && data.ubicacionNoConformeId) {
        const lotNC = await this.prisma.lotInventory.create({
          data: {
            skuId: data.skuId, clienteId: data.clienteId,
            lote: data.lote || null, serie: data.serie || null,
            fechaVencimiento: data.fechaVencimiento ? new Date(data.fechaVencimiento) : null,
            proveedorNombre: data.proveedor,
            estadoCalidad: 'BLOQUEADO',
            cantidadBloqueada: qtyNoConforme,
            cantidadDisponible: 0,
            ubicacionId: data.ubicacionNoConformeId,
          },
        });

        maxHuSeq++;
        const huCodigoNC = `${huYearPrefix}${String(maxHuSeq).padStart(5, '0')}`;
        const huNC = await this.prisma.handlingUnit.create({
          data: {
            codigo: huCodigoNC,
            tipoHu: data.tipoHu || 'CAJA',
            lotId: lotNC.id,
            clienteId: data.clienteId,
            receiptId: resolvedReceiptId || undefined,
            receiptLineId: data.receiptLineId || undefined,
            cantidad: qtyNoConforme,
            uom: resolvedReceiptLine?.uom || 'PZA',
            ubicacionActual: data.ubicacionNoConformeId,
            estadoHu: 'BLOQUEADO',
            skuCodigo: resolvedReceiptLine?.sku?.codigo || sku?.codigo,
            skuDescripcion: resolvedReceiptLine?.sku?.descripcion || sku?.descripcion,
            loteTexto: data.lote || null,
            fechaVencimiento: data.fechaVencimiento ? new Date(data.fechaVencimiento) : null,
            facturaRespaldo: resolvedReceiptLine?.recepcion?.facturaRespaldo || resolvedReceiptLine?.recepcion?.ocReferencia || resolvedReceiptLine?.recepcion?.codigo || undefined,
            piezasPorCaja: qtyNoConforme,
          },
        });

        await this.prisma.inventoryMovement.create({
          data: {
            tipoMovimiento: 'ENTRADA', almacenId: data.almacenId,
            skuId: data.skuId, clienteId: data.clienteId, lotId: lotNC.id,
            huId: huNC.id, toLocationId: data.ubicacionNoConformeId,
            cantidad: qtyNoConforme, usuario: data.usuario,
            motivo: data.notas || `Recepción No Conforme — ${data.proveedor || 'Proveedor'}`,
          },
        });

        await this.prisma.location.update({
          where: { id: data.ubicacionNoConformeId },
          data: { ocupacion: { increment: 1 }, estado: 'OCUPADO' },
        });

        createdLots.push(lotNC);
        createdHus.push(huNC);
      }
    }, { contextName: 'executeReceptionDirect' });

    // Update receipt line if linked
    if (data.receiptLineId) {
      const line = await this.prisma.receiptLine.findUnique({ where: { id: data.receiptLineId } });
      if (line) {
        const newRecibida = line.cantidadRecibida + qtyConforme;
        const newDanada = line.cantidadDanada + qtyNoConforme;
        const totalProcesada = newRecibida + newDanada;
        
        await this.prisma.receiptLine.update({
          where: { id: data.receiptLineId },
          data: {
            cantidadRecibida: newRecibida,
            cantidadDanada: newDanada,
            estado: line.cantidadEsperada && totalProcesada >= line.cantidadEsperada ? 'COMPLETO' : 'PARCIAL',
            loteAsignado: data.lote || line.loteAsignado,
            fechaVencimiento: data.fechaVencimiento ? new Date(data.fechaVencimiento) : line.fechaVencimiento,
            ubicacionId: data.ubicacionConformeId || data.ubicacionNoConformeId, // Just keeping one ref
          },
        });

        // Tarea 5: Al iniciar conteo físico, transicionar recepción a EN_PROCESO_CONTEO automáticamente
        if (line.recepcionId) {
          const parentReceipt = await this.prisma.receipt.findUnique({ where: { id: line.recepcionId } });
          if (parentReceipt && (parentReceipt.estado === 'PENDIENTE' || parentReceipt.estado === 'PENDIENTE_ARRIBO')) {
            await this.prisma.receipt.update({
              where: { id: line.recepcionId },
              data: {
                estado: 'EN_PROCESO_CONTEO',
                bloqueado: true,
                bloqueadoPor: data.usuario || 'Operador Conteo',
                fechaBloqueo: parentReceipt.fechaBloqueo || new Date(),
              },
            });
          }
        }
      }
    }

    await this.audit(data.usuario, 'RECEPCION', 'LotInventory', createdLots[0]?.id,
      `Lote: ${data.lote || 'N/A'}, C: ${qtyConforme}, NC: ${qtyNoConforme}`);

    return { success: true, lots: createdLots, handlingUnits: createdHus, message: `Recepción procesada correctamente` };
  }

  @Post('receipts/:id/batch-reception')
  @ApiOperation({
    summary: 'Registrar recepción física masiva por factura completa (Planilla Matricial)',
    description: 'Procesa todas las partidas de una factura en una sola transacción atómica, asentando producto conforme (LIBERADO) y no conforme (CUARENTENA), actualizando líneas del previo y activando candado de andén.',
  })
  @ApiParam({ name: 'id', description: 'ID de la recepción previa (Receipt UUID)' })
  @ApiBody({ type: BatchReceptionDto })
  @ApiResponse({ status: 200, description: 'Recepción masiva de factura procesada correctamente' })
  @ApiResponse({ status: 400, description: 'Datos inválidos o partidas vacías', type: ApiErrorResponseDto })
  @ApiResponse({ status: 403, description: 'Recepción cerrada o bloqueada', type: ApiErrorResponseDto })
  @ApiResponse({ status: 404, description: 'Recepción no encontrada', type: ApiErrorResponseDto })
  @HttpCode(HttpStatus.OK)
  async batchReception(
    @Param('id') receiptId: string,
    @Body() body: BatchReceptionDto,
  ) {
    if (!receiptId) {
      throw new HttpException(
        { statusCode: HttpStatus.BAD_REQUEST, message: 'ID de recepción requerido', error: 'Bad Request', detalles: { campo: 'id' } },
        HttpStatus.BAD_REQUEST,
      );
    }

    if (!body || !body.usuario) {
      throw new HttpException(
        { statusCode: HttpStatus.BAD_REQUEST, message: 'El usuario auditor/capturista es obligatorio', error: 'Bad Request', detalles: { campo: 'usuario' } },
        HttpStatus.BAD_REQUEST,
      );
    }

    if (!body.lineas || !Array.isArray(body.lineas) || body.lineas.length === 0) {
      throw new HttpException(
        { statusCode: HttpStatus.BAD_REQUEST, message: 'Debe incluir al menos una partida en la planilla de recepción', error: 'Bad Request', detalles: { campo: 'lineas' } },
        HttpStatus.BAD_REQUEST,
      );
    }

    // Filtrar partidas con cantidades a procesar
    const activeLines = body.lineas.filter(l => {
      const conf = Number(l.cantidadConforme) || 0;
      const noConf = Number(l.cantidadNoConforme) || 0;
      return conf > 0 || noConf > 0;
    });

    if (activeLines.length === 0) {
      throw new HttpException(
        { statusCode: HttpStatus.BAD_REQUEST, message: 'No hay cantidades a recibir registradas (ingrese al menos una cantidad mayor a 0 en conforme o dañado)', error: 'Bad Request', detalles: { campo: 'lineas' } },
        HttpStatus.BAD_REQUEST,
      );
    }

    const receipt = await this.prisma.receipt.findUnique({
      where: { id: receiptId },
      include: {
        cliente: true,
        lineas: { include: { sku: true } },
      },
    });

    if (!receipt) {
      throw new HttpException(
        { statusCode: HttpStatus.NOT_FOUND, message: 'Recepción previa no encontrada', error: 'Not Found' },
        HttpStatus.NOT_FOUND,
      );
    }

    if (receipt.estado === 'CERRADA' || receipt.estado === 'CERRADO') {
      throw new HttpException(
        {
          statusCode: HttpStatus.FORBIDDEN,
          message: 'Operación rechazada: La recepción está CERRADA y finiquitada. El inventario histórico es inmutable.',
          error: 'Forbidden',
          detalles: { codigo: 'RECEPCION_CERRADA_INMUTABLE', estado: receipt.estado },
        },
        HttpStatus.FORBIDDEN,
      );
    }

    // Validar pertenencia de catálogo contra el depositante
    for (const l of activeLines) {
      if (!l.receiptLineId) {
        throw new HttpException(
          { statusCode: HttpStatus.BAD_REQUEST, message: 'receiptLineId es requerido para cada partida', error: 'Bad Request' },
          HttpStatus.BAD_REQUEST,
        );
      }
      const existingLine = receipt.lineas.find(rl => rl.id === l.receiptLineId);
      if (!existingLine) {
        throw new HttpException(
          { statusCode: HttpStatus.BAD_REQUEST, message: `La línea ${l.receiptLineId} no pertenece a este previo`, error: 'Bad Request' },
          HttpStatus.BAD_REQUEST,
        );
      }
      if (existingLine.sku.clienteId !== receipt.clienteId) {
        throw new HttpException(
          {
            statusCode: HttpStatus.BAD_REQUEST,
            message: `Violación de catálogo: El SKU "${existingLine.sku.codigo}" no pertenece al depositante de esta recepción.`,
            error: 'Bad Request',
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      // Tarea 4: Validación estricta de Lote y Caducidad según giro del cliente o catálogo del producto
      const isGiroRegulado = receipt.cliente?.giro === 'COMIDA' || receipt.cliente?.giro === 'FARMACEUTICO';
      const reqLote = Boolean(receipt.cliente?.requiereLote || isGiroRegulado || existingLine.sku?.requiereLote);
      const reqCaducidad = Boolean(receipt.cliente?.requiereCaducidad || isGiroRegulado || existingLine.sku?.requiereCaducidad);

      if (reqLote && (!l.lote || typeof l.lote !== 'string' || !l.lote.trim())) {
        const razon = isGiroRegulado
          ? `El giro "${receipt.cliente?.giro}" del cliente depositante exige LOTE obligatorio para la partida "${existingLine.sku.codigo}".`
          : `El depositante o producto exige LOTE obligatorio para la partida "${existingLine.sku.codigo}".`;
        throw new HttpException(
          {
            statusCode: HttpStatus.BAD_REQUEST,
            message: razon,
            error: 'Bad Request',
            detalles: { codigo: 'LOTE_OBLIGATORIO_POR_GIRO', skuCodigo: existingLine.sku.codigo, giro: receipt.cliente?.giro },
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      if (reqCaducidad && (!l.fechaVencimiento || typeof l.fechaVencimiento !== 'string' || !l.fechaVencimiento.trim())) {
        const razon = isGiroRegulado
          ? `El giro "${receipt.cliente?.giro}" del cliente depositante exige FECHA DE CADUCIDAD obligatoria para la partida "${existingLine.sku.codigo}".`
          : `El depositante o producto exige FECHA DE CADUCIDAD obligatoria para la partida "${existingLine.sku.codigo}".`;
        throw new HttpException(
          {
            statusCode: HttpStatus.BAD_REQUEST,
            message: razon,
            error: 'Bad Request',
            detalles: { codigo: 'CADUCIDAD_OBLIGATORIA_POR_GIRO', skuCodigo: existingLine.sku.codigo, giro: receipt.cliente?.giro },
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      // Regla Sanitaria de Inocuidad (COFEPRIS/FDA/NOM-251): Prohibido recibir producto caducado
      if (l.fechaVencimiento && typeof l.fechaVencimiento === 'string' && l.fechaVencimiento.trim()) {
        const dateStr = l.fechaVencimiento.trim();
        const isIsoFormat = /^\d{4}-\d{2}-\d{2}/.test(dateStr);
        const parsedDate = isIsoFormat ? new Date(dateStr) : new Date(NaN);
        if (!isIsoFormat || isNaN(parsedDate.getTime())) {
          throw new HttpException(
            {
              statusCode: HttpStatus.BAD_REQUEST,
              message: `Formato de fecha de caducidad inválido para la partida "${existingLine.sku.codigo}" (recibido: "${l.fechaVencimiento}"). Utilice el formato YYYY-MM-DD.`,
              error: 'Bad Request',
              detalles: { codigo: 'FECHA_CADUCIDAD_INVALIDA', skuCodigo: existingLine.sku.codigo },
            },
            HttpStatus.BAD_REQUEST,
          );
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (parsedDate < today) {
          throw new HttpException(
            {
              statusCode: HttpStatus.BAD_REQUEST,
              message: `Rechazo Sanitario: El producto para la partida "${existingLine.sku.codigo}" ya se encuentra caducado (fecha de vencimiento: ${l.fechaVencimiento.trim()}). Por normatividad sanitaria, no se permite ingresar producto vencido.`,
              error: 'Bad Request',
              detalles: { codigo: 'PRODUCTO_CADUCADO_RECHAZADO', skuCodigo: existingLine.sku.codigo, fechaVencimiento: l.fechaVencimiento.trim() },
            },
            HttpStatus.BAD_REQUEST,
          );
        }
      }
    }

    // Obtener almacén por defecto
    let effectiveAlmacenId = body.almacenId;
    if (!effectiveAlmacenId) {
      const firstWh = await this.prisma.warehouse.findFirst();
      effectiveAlmacenId = firstWh?.id;
    }

    // Obtener ubicaciones por defecto
    let defaultConformeLocId = body.ubicacionConformeId;
    let defaultNoConformeLocId = body.ubicacionNoConformeId;

    if (!defaultConformeLocId) {
      const recLoc = await this.prisma.location.findFirst({
        where: { OR: [{ codigo: 'REC-01' }, { tipoUbicacion: 'RECIBO' }] },
      });
      defaultConformeLocId = recLoc?.id;
    }

    if (!defaultNoConformeLocId) {
      const devLoc = await this.prisma.location.findFirst({
        where: { OR: [{ codigo: 'DEV-01' }, { codigo: 'MERMA-01' }, { tipoUbicacion: 'DEVOLUCION' }] },
      });
      defaultNoConformeLocId = devLoc?.id || defaultConformeLocId;
    }

    let totalConforme = 0;
    let totalNoConforme = 0;
    const processedResults: any[] = [];

    try {
      // Ejecutar en transacción atómica de Prisma con reintento por colisión y timeout extendido
      await withConcurrencyRetry(async () => {
        return this.prisma.$transaction(async (tx) => {
          const currentYear = new Date().getFullYear();
          const huYearPrefix = `HU-${currentYear}-`;
          const existingHus = await tx.handlingUnit.findMany({
            where: { codigo: { startsWith: huYearPrefix } },
            select: { codigo: true },
          });
          let maxHuSeq = 0;
          for (const h of existingHus) {
            const num = parseInt(h.codigo.replace(huYearPrefix, '') || '0', 10);
            if (!isNaN(num) && num > maxHuSeq) maxHuSeq = num;
          }
          let huSequence = maxHuSeq;

          for (const lineData of activeLines) {
            const line = receipt.lineas.find(rl => rl.id === lineData.receiptLineId)!;
            const qtyConforme = Math.max(0, Number(lineData.cantidadConforme) || 0);
            const qtyNoConforme = Math.max(0, Number(lineData.cantidadNoConforme) || 0);

            const locConforme = lineData.ubicacionConformeId || defaultConformeLocId;
            const locNoConforme = lineData.ubicacionNoConformeId || defaultNoConformeLocId;

            totalConforme += qtyConforme;
            totalNoConforme += qtyNoConforme;

            // 1. Producto Conforme (LIBERADO)
            if (qtyConforme > 0 && locConforme) {
              const lotC = await tx.lotInventory.create({
                data: {
                  skuId: line.skuId,
                  clienteId: receipt.clienteId,
                  lote: lineData.lote || null,
                  fechaVencimiento: lineData.fechaVencimiento ? new Date(lineData.fechaVencimiento) : null,
                  proveedorNombre: receipt.proveedorId ? undefined : 'Proveedor',
                  estadoCalidad: 'LIBERADO',
                  cantidadDisponible: qtyConforme,
                  ubicacionId: locConforme,
                },
              });

              huSequence++;
              const huCodigoC = `${huYearPrefix}${String(huSequence).padStart(5, '0')}`;
              const huC = await tx.handlingUnit.create({
                data: {
                  codigo: huCodigoC,
                  tipoHu: lineData.tipoHu || 'CAJA',
                  lotId: lotC.id,
                  clienteId: receipt.clienteId,
                  receiptId: receipt.id,
                  receiptLineId: line.id,
                  cantidad: qtyConforme,
                  uom: line.uom || 'PZA',
                  ubicacionActual: locConforme,
                  estadoHu: 'ACTIVO',
                  skuCodigo: line.sku?.codigo,
                  skuDescripcion: line.sku?.descripcion,
                  loteTexto: lineData.lote || null,
                  fechaVencimiento: lineData.fechaVencimiento ? new Date(lineData.fechaVencimiento) : null,
                  facturaRespaldo: receipt.facturaRespaldo || receipt.ocReferencia || receipt.codigo,
                  piezasPorCaja: qtyConforme,
                },
              });

              if (effectiveAlmacenId) {
                await tx.inventoryMovement.create({
                  data: {
                    tipoMovimiento: 'ENTRADA',
                    almacenId: effectiveAlmacenId,
                    skuId: line.skuId,
                    clienteId: receipt.clienteId,
                    lotId: lotC.id,
                    huId: huC.id,
                    toLocationId: locConforme,
                    cantidad: qtyConforme,
                    usuario: body.usuario,
                    motivo: lineData.notas || `Recepción Factura Completa Conforme — Previo ${receipt.codigo}`,
                  },
                });
              }

              await tx.location.update({
                where: { id: locConforme },
                data: { ocupacion: { increment: 1 }, estado: 'OCUPADO' },
              });
            }

            // 2. Producto No Conforme / Dañado (CUARENTENA)
            if (qtyNoConforme > 0 && locNoConforme) {
              const lotNC = await tx.lotInventory.create({
                data: {
                  skuId: line.skuId,
                  clienteId: receipt.clienteId,
                  lote: lineData.lote || null,
                  fechaVencimiento: lineData.fechaVencimiento ? new Date(lineData.fechaVencimiento) : null,
                  proveedorNombre: receipt.proveedorId ? undefined : 'Proveedor',
                  estadoCalidad: 'CUARENTENA',
                  cantidadBloqueada: qtyNoConforme,
                  cantidadDisponible: 0,
                  ubicacionId: locNoConforme,
                },
              });

              huSequence++;
              const huCodigoNC = `${huYearPrefix}${String(huSequence).padStart(5, '0')}`;
              const huNC = await tx.handlingUnit.create({
                data: {
                  codigo: huCodigoNC,
                  tipoHu: lineData.tipoHu || 'CAJA',
                  lotId: lotNC.id,
                  clienteId: receipt.clienteId,
                  receiptId: receipt.id,
                  receiptLineId: line.id,
                  cantidad: qtyNoConforme,
                  uom: line.uom || 'PZA',
                  ubicacionActual: locNoConforme,
                  estadoHu: 'BLOQUEADO',
                  skuCodigo: line.sku?.codigo,
                  skuDescripcion: line.sku?.descripcion,
                  loteTexto: lineData.lote || null,
                  fechaVencimiento: lineData.fechaVencimiento ? new Date(lineData.fechaVencimiento) : null,
                  facturaRespaldo: receipt.facturaRespaldo || receipt.ocReferencia || receipt.codigo,
                  piezasPorCaja: qtyNoConforme,
                },
              });

              if (effectiveAlmacenId) {
                await tx.inventoryMovement.create({
                  data: {
                    tipoMovimiento: 'ENTRADA',
                    almacenId: effectiveAlmacenId,
                    skuId: line.skuId,
                    clienteId: receipt.clienteId,
                    lotId: lotNC.id,
                    huId: huNC.id,
                    toLocationId: locNoConforme,
                    cantidad: qtyNoConforme,
                    usuario: body.usuario,
                    motivo: lineData.notas || `Recepción Factura Completa Dañado / Cuarentena — Previo ${receipt.codigo}`,
                  },
                });
              }

              await tx.location.update({
                where: { id: locNoConforme },
                data: { ocupacion: { increment: 1 }, estado: 'OCUPADO' },
              });
            }

            // 3. Actualizar partida del previo
            const newRecibida = line.cantidadRecibida + qtyConforme;
            const newDanada = line.cantidadDanada + qtyNoConforme;
            const totalProcesada = newRecibida + newDanada;

            const updatedLine = await tx.receiptLine.update({
              where: { id: line.id },
              data: {
                cantidadRecibida: newRecibida,
                cantidadDanada: newDanada,
                estado: line.cantidadEsperada && totalProcesada >= line.cantidadEsperada ? 'COMPLETO' : 'PARCIAL',
                loteAsignado: lineData.lote || line.loteAsignado,
                fechaVencimiento: lineData.fechaVencimiento ? new Date(lineData.fechaVencimiento) : line.fechaVencimiento,
                ubicacionId: locConforme || locNoConforme,
              },
            });

            processedResults.push({
              lineId: line.id,
              sku: line.sku.codigo,
              cantidadRecibida: newRecibida,
              cantidadDanada: newDanada,
              estado: updatedLine.estado,
            });
          }

          // 4. Actualizar estado del previo y activar candado de andén
          await tx.receipt.update({
            where: { id: receiptId },
            data: {
              estado: (receipt.estado === 'PENDIENTE' || receipt.estado === 'PENDIENTE_ARRIBO') ? 'EN_PROCESO_CONTEO' : receipt.estado,
              bloqueado: true,
              bloqueadoPor: body.usuario,
              fechaBloqueo: receipt.fechaBloqueo || new Date(),
            },
          });

          // 5. Bitácora de auditoría legal
          await tx.auditLog.create({
            data: {
              usuario: body.usuario,
              accion: 'RECEPCION_MASIVA_FACTURA',
              entidad: 'Receipt',
              entidadId: receiptId,
              detalle: `Recepción física masiva de factura completa: ${activeLines.length} partidas procesadas (${totalConforme} conformes, ${totalNoConforme} dañados). Total: ${totalConforme + totalNoConforme} piezas.`,
            },
          });
        }, {
          maxWait: 10000,
          timeout: 45000,
        });
      }, { contextName: 'batchReception', maxRetries: 5 });
    } catch (txError: any) {
      console.error('Error en transacción de batchReception:', txError);
      if (txError instanceof HttpException) throw txError;
      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: txError.message || 'Error al procesar la recepción de factura en base de datos',
          error: 'Internal Server Error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    return {
      success: true,
      message: `Recepción física de factura completada exitosamente (${activeLines.length} partidas, ${totalConforme} conformes, ${totalNoConforme} dañados).`,
      estadisticas: {
        lineasProcesadas: activeLines.length,
        totalConforme,
        totalNoConforme,
        totalUnidades: totalConforme + totalNoConforme,
      },
      partidas: processedResults,
    };
  }

  // ============ ORDERS ============
  @Get('orders')
  @ApiOperation({ summary: 'Listar órdenes de salida' })
  async getOrders(
    @Query('estado') estado?: string,
    @Query('clienteId') clienteId?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const where: any = {};
    if (estado) {
      if (estado.includes(',')) {
        where.estado = { in: estado.split(',').map(s => s.trim()) };
      } else {
        where.estado = estado;
      }
    }

    let activeClienteId = clienteId;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const token = authHeader.split(' ')[1];
        const decoded: any = jwt.verify(token, JWT_SECRET);
        if (decoded?.clienteId) {
          activeClienteId = decoded.clienteId;
        } else if (decoded?.userId) {
          const user = await this.prisma.user.findUnique({ where: { id: decoded.userId } });
          if (user?.clienteId) activeClienteId = user.clienteId;
        }
      } catch {}
    }
    if (activeClienteId) where.clienteId = activeClienteId;

    return this.prisma.salesOrder.findMany({
      where,
      include: {
        cliente: { select: { id: true, codigo: true, nombreComercial: true, giro: true, reglaInventario: true } },
        endCustomer: { select: { id: true, codigo: true, nombre: true, ciudad: true, calle: true } },
        lineas: {
          include: {
            sku: { select: { id: true, codigo: true, descripcion: true, uomBase: true } },
            lote: { include: { ubicacion: true } },
          },
        },
        trackingEvents: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: [{ createdAt: 'desc' }],
    });
  }

  @Get('orders/:id')
  @ApiOperation({ summary: 'Obtener detalle de orden de salida' })
  async getOrderById(@Param('id') id: string) {
    const order = await this.prisma.salesOrder.findFirst({
      where: { OR: [{ id }, { codigo: id }] },
      include: {
        cliente: true,
        endCustomer: true,
        lineas: {
          include: {
            sku: true,
            lote: { include: { ubicacion: true } },
            hu: true,
          },
        },
        trackingEvents: { orderBy: { createdAt: 'desc' } },
        aprobaciones: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!order) throw new HttpException('Orden no encontrada', HttpStatus.NOT_FOUND);
    return order;
  }

  @Get('receipts/:id/report')
  @ApiOperation({ summary: 'Obtener reporte detallado de cierre de recepción (Hoja de Entrada ASN)' })
  async getReceiptReport(@Param('id') receiptId: string) {
    const receipt = await this.prisma.receipt.findFirst({
      where: {
        OR: [{ id: receiptId }, { codigo: receiptId }],
      },
      include: {
        cliente: true,
        proveedor: true,
        lineas: {
          include: {
            sku: true,
          },
        },
        handlingUnits: {
          orderBy: { codigo: 'asc' },
          include: {
            lote: {
              include: {
                sku: true,
                ubicacion: true,
              },
            },
          },
        },
      },
    });
    if (!receipt) throw new HttpException('Previo no encontrado', HttpStatus.NOT_FOUND);

    const qualityInspection = await this.prisma.qualityInspection.findFirst({
      where: { receiptId: receipt.id },
    });

    let qiResult: any = null;
    if (qualityInspection) {
      let detalles: any[] = [];
      if (qualityInspection.detallesJson) {
        try {
          detalles = typeof qualityInspection.detallesJson === 'string'
            ? JSON.parse(qualityInspection.detallesJson)
            : qualityInspection.detallesJson;
        } catch {
          detalles = [];
        }
      }
      qiResult = {
        ...qualityInspection,
        detalles,
        cajaOrigenCodigo: detalles[0]?.cajaOrigenCodigo || null,
        cajaDestinoCodigo: detalles[0]?.nuevasCajasGeneradas?.[0]?.codigo || null,
      };
    }

    let totalEsperado = 0;
    let totalConforme = 0;
    let totalMerma = 0;
    let totalRecibido = 0;
    let totalFaltante = 0;

    const hasRamp = Boolean(
      receipt.fechaLiberacionChofer ||
      (receipt as any).liberadoChofer ||
      (receipt.bultosRecibidos !== null && receipt.bultosRecibidos !== undefined && receipt.bultosRecibidos > 0) ||
      receipt.firmaChofer ||
      receipt.firmaReceptor ||
      receipt.estado !== 'PENDIENTE_ARRIBO'
    );

    const hasPieceClassification = receipt.lineas.some(l => Number(l.cantidadRecibida || 0) > 0 || Number(l.cantidadDanada || 0) > 0) || receipt.handlingUnits.length > 0;

    const lineasReporte = receipt.lineas.map(l => {
      const esp = Number(l.cantidadEsperada || 0);
      const conf = Number(l.cantidadRecibida || 0);
      const dan = Number(l.cantidadDanada || 0);
      const rec = conf + dan;
      const falt = (hasRamp && hasPieceClassification) ? Math.max(0, esp - rec) : 0;

      totalEsperado += esp;
      totalConforme += conf;
      totalMerma += dan;
      totalRecibido += rec;
      totalFaltante += falt;

      return {
        id: l.id,
        skuId: l.skuId,
        codigo: l.sku?.codigo || l.skuId,
        descripcion: l.sku?.descripcion || 'Sin descripción',
        categoria: l.sku?.categoria,
        talla: l.sku?.talla,
        color: l.sku?.color,
        codigoBarras: l.sku?.codigoBarras,
        uom: l.sku?.uomBase || l.uom || 'PZA',
        cantidadEsperada: esp,
        cantidadRecibida: rec,
        cantidadConforme: conf,
        cantidadRetenida: 0,
        cantidadMerma: dan,
        cantidadFaltante: falt,
        estadoLinea: l.estado,
        loteAsignado: l.loteAsignado,
        loteEsperado: l.loteEsperado,
        fechaVencimiento: l.fechaVencimiento,
        ubicacionId: l.ubicacionId,
        notas: l.notas,
      };
    });

    const bultosRecibidos = receipt.bultosRecibidos || 0;
    const bultosDeclarados = receipt.bultosDeclarados !== null && receipt.bultosDeclarados !== undefined ? receipt.bultosDeclarados : bultosRecibidos;
    const bultosDanados = receipt.bultosDanados || 0;
    const bultosSinDanoExterior = Math.max(0, bultosRecibidos - bultosDanados);
    const bultosConformes = bultosSinDanoExterior;
    const bultosFaltantes = hasRamp ? Math.max(0, bultosDeclarados - bultosRecibidos) : 0;

    const huMap = new Map<string, string>();
    for (const h of receipt.handlingUnits) {
      huMap.set(h.id, h.codigo);
    }
    const enrichedHus = receipt.handlingUnits.map(h => ({
      ...h,
      cajaOrigenCodigo: h.cajaOrigenId ? (huMap.get(h.cajaOrigenId) || null) : null,
    }));

    const reconciliacionesPostCierre = await this.prisma.auditLog.findMany({
      where: {
        entidad: 'Receipt',
        entidadId: receipt.id,
        accion: 'PUTAWAY_RECONCILIACION_POST_CIERRE',
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      receipt,
      hasPieceClassification,
      resumenPiezas: {
        totalEsperado,
        totalRecibido,
        totalConforme,
        totalMerma,
        totalRetenida: 0,
        totalFaltante,
        porcentajeConforme: totalEsperado > 0 ? Math.round((totalConforme / totalEsperado) * 100) : 100,
      },
      resumenBultos: {
        bultosDeclarados,
        bultosRecibidos,
        bultosSinDanoExterior,
        bultosConformes,
        bultosDanados,
        bultosFaltantes,
        diferenciaBultos: receipt.diferenciaBultos !== null && receipt.diferenciaBultos !== undefined ? receipt.diferenciaBultos : (bultosRecibidos - bultosDeclarados),
        tarimasTotal: receipt.handlingUnits.filter(h => h.tipoHu === 'PALLET' || h.tipoHu === 'TARIMA').length,
        cajasFinalesRacks: receipt.handlingUnits.filter(h => h.tipoHu === 'CAJA' && h.estadoHu === 'ACTIVO' && !h.codigo?.includes('MERMA') && !h.codigo?.startsWith('HU-NC-') && h.ubicacionActual !== 'DEV-01').length,
        cajasDespachadas: receipt.handlingUnits.filter(h => h.tipoHu === 'CAJA' && h.estadoHu === 'DESPACHADO').length,
        cajasHistoricasInactivas: receipt.handlingUnits.filter(h => h.tipoHu === 'CAJA' && (h.estadoHu === 'INACTIVO' || h.estadoHu === 'DAÑADO')).length,
        cajasMermaSegregadas: receipt.handlingUnits.filter(h => h.tipoHu === 'CAJA' && (h.codigo?.includes('MERMA') || h.codigo?.startsWith('HU-NC-') || h.ubicacionActual === 'DEV-01' || h.lote?.estadoCalidad === 'MERMA' || (h as any).estadoCalidad === 'MERMA')).length,
        cajasTotalesRegistradas: receipt.handlingUnits.filter(h => h.tipoHu === 'CAJA').length,
        cajasConformesAlCierre: receipt.handlingUnits.filter(h => h.tipoHu === 'CAJA' && h.estadoHu === 'ACTIVO' && !h.codigo?.includes('MERMA') && !h.codigo?.startsWith('HU-NC-') && h.ubicacionActual !== 'DEV-01').length + receipt.handlingUnits.filter(h => h.tipoHu === 'CAJA' && h.estadoHu === 'DESPACHADO').length,
      },
      lineas: lineasReporte,
      handlingUnits: enrichedHus,
      qualityInspection: qiResult,
      reconciliacionesPostCierre,
    };
  }

  @Post('receipts/:id/close')
  @ApiOperation({
    summary: 'Finalizar y cerrar recepción de mercancía (Cierre definitivo de almacén - Tarea 3 / Tarea 5)',
    description: 'Finiquita la recepción, cambia el estatus operacional a CERRADA, activa candado permanente inmutable y genera bitácora de auditoría.',
  })
  @ApiParam({ name: 'id', description: 'Identificador único UUID de la recepción previa' })
  @ApiBody({ type: CloseReceiptDto })
  @ApiResponse({ status: 200, description: 'Recepción finalizada y cerrada correctamente en inventario.' })
  @ApiResponse({ status: 400, description: 'Datos incompletos (usuario auditor ausente).', type: ApiErrorResponseDto })
  @ApiResponse({ status: 404, description: 'Recepción previa no encontrada.', type: ApiErrorResponseDto })
  @HttpCode(HttpStatus.OK)
  async closeReceipt(@Param('id') receiptId: string, @Body() body: any) {
    try {
      const receipt = await this.prisma.receipt.findUnique({
        where: { id: receiptId },
        include: {
          lineas: { include: { sku: true } },
          cliente: true,
          inspecciones: true,
          handlingUnits: true,
        },
      });
      if (!receipt) {
        throw new HttpException(
          {
            statusCode: HttpStatus.NOT_FOUND,
            message: `Recepción previa con ID "${receiptId}" no encontrada.`,
            error: 'Not Found',
            detalles: { codigo: 'RECEPCION_NO_ENCONTRADA', receiptId },
          },
          HttpStatus.NOT_FOUND,
        );
      }

      // 1. CANDADO DE IDEMPOTENCIA TOTAL: Si ya se encuentra cerrada oficialmente, devolver estado existente sin duplicar escrituras
      if (receipt.estado === 'CERRADA' || receipt.estado === 'CERRADO' || receipt.fechaCierre) {
        const fullReceipt = await this.prisma.receipt.findUnique({
          where: { id: receipt.id },
          include: {
            cliente: true,
            proveedor: true,
            lineas: { include: { sku: true } },
          },
        });
        return {
          success: true,
          idempotent: true,
          message: `Recepción ${receipt.codigo} ya se encontraba finalizada y cerrada previamente. Se preservó el cierre existente sin duplicar movimientos ni auditorías.`,
          discrepanciasResueltas: receipt.lineas?.filter((l: any) => l.estado === 'DISCREPANCIA' || (l.notas && l.notas.includes('[DISCREPANCIA_RESUELTA]'))).length || 0,
          receipt: fullReceipt || receipt,
        };
      }

      // 2. Validar usuario auditor
      if (!body?.usuario || typeof body.usuario !== 'string' || body.usuario.trim().length === 0) {
        throw new HttpException(
          {
            statusCode: HttpStatus.BAD_REQUEST,
            message: 'Datos incompletos: El usuario auditor que autoriza el cierre de la recepción es obligatorio.',
            error: 'Bad Request',
            detalles: { codigo: 'USUARIO_CIERRE_REQUERIDO', campo: 'usuario' },
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      const usuario = body.usuario.trim();

      // 3. AUDITORÍA DE DISCREPANCIAS Y CANDADO DE CIERRE (Tarea 5)
      // Bloquear el cierre de recepción si existen discrepancias sin justificación o clasificación de estatus
      // CANDADO DE SEGURIDAD CANÓNICA DE FASE 4:
      // Validar que todas las HUs comerciales activas estén formalmente alojadas en racks
      // y vinculadas canónicamente a LotInventory (HUs comerciales activas alojadas == contabilizadas)
      const isMermaHu = (h: any) => h.codigo?.includes('MERMA') || h.codigo?.startsWith('HU-NC-') || h.ubicacionActual === 'DEV-01';
      const activeCommercialBoxes = receipt.handlingUnits?.filter(
        (h: any) => h.tipoHu === 'CAJA' && h.estadoHu === 'ACTIVO' && !isMermaHu(h)
      ) || [];

      const unlinkedBoxes = activeCommercialBoxes.filter(
        (h: any) => !h.lotId || !h.ubicacionActual || ['RAMPA_RECEPCION', 'REC-01', 'RECIBO', 'ANDEN', 'STAGING'].includes(h.ubicacionActual)
      );

      if (unlinkedBoxes.length > 0) {
        throw new HttpException(
          {
            statusCode: HttpStatus.BAD_REQUEST,
            message: `Bloqueo de Seguridad de Cierre: No se puede finalizar ni cerrar la recepción porque existen ${unlinkedBoxes.length} bultos comerciales activos sin confirmación canónica de alojamiento en racks (Fase 4 incompleta). Las piezas deben estar alojadas físicamente y vinculadas a LotInventory antes de finiquitar el expediente.`,
            error: 'Bad Request',
            detalles: {
              codigo: 'CIERRE_BLOQUEADO_POR_PUTAWAY_INCOMPLETO',
              totalBultosPendientes: unlinkedBoxes.length,
              bultosPendientes: unlinkedBoxes.map((b: any) => ({
                codigo: b.codigo,
                ubicacionActual: b.ubicacionActual,
                lotId: b.lotId,
                cantidad: b.cantidad,
              })),
            },
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      const activeLines = receipt.lineas || [];
      const discrepantLines: Array<{
        line: any;
        esperada: number;
        recibida: number;
        danada: number;
        totalFisico: number;
        diferencia: number;
        tipoDiscrepancia: 'FALTANTE' | 'SOBRANTE' | 'MERMA' | 'MIXTA';
      }> = [];

      for (const line of activeLines) {
        const esperada = Number(line.cantidadEsperada ?? 0);
        const recibida = Number(line.cantidadRecibida ?? 0);
        const danada = Number(line.cantidadDanada ?? 0);
        const totalFisico = recibida + danada;
        const diferencia = totalFisico - esperada;

        const hasDifference = esperada > 0 ? (diferencia !== 0) : (totalFisico > 0);
        const hasDamage = danada > 0;

        if (hasDifference || hasDamage) {
          let tipo: 'FALTANTE' | 'SOBRANTE' | 'MERMA' | 'MIXTA' = 'FALTANTE';
          if (diferencia < 0 && danada > 0) tipo = 'MIXTA';
          else if (diferencia < 0) tipo = 'FALTANTE';
          else if (diferencia > 0 && danada > 0) tipo = 'MIXTA';
          else if (diferencia > 0) tipo = 'SOBRANTE';
          else if (danada > 0) tipo = 'MERMA';

          discrepantLines.push({
            line,
            esperada,
            recibida,
            danada,
            totalFisico,
            diferencia,
            tipoDiscrepancia: tipo,
          });
        }
      }

      // Validar si existen discrepancias huérfanas sin justificación o clasificación
      const unresolvedLines: any[] = [];
      const resolvedMap = new Map<string, { clasificacion: string; justificacion: string }>();

      if (discrepantLines.length > 0) {
        const discrepanciasInput = Array.isArray(body.discrepancias) ? body.discrepancias : [];
        const discrepanciasDict = (body.discrepancias && typeof body.discrepancias === 'object' && !Array.isArray(body.discrepancias))
          ? body.discrepancias
          : {};

        for (const item of discrepantLines) {
          const lId = item.line.id;
          const skuCod = item.line.sku?.codigo;

          const fromArray = discrepanciasInput.find((d: any) => d.lineId === lId || (d.sku && d.sku === skuCod));
          const fromDict = discrepanciasDict[lId] || (skuCod ? discrepanciasDict[skuCod] : null);
          const resolution = fromArray || fromDict;

          const clasificacion = (resolution?.clasificacion || body.clasificacionGlobal || '').trim();
          const justificacion = (resolution?.justificacion || body.justificacionGlobal || '').trim();

          const yaDictaminadoEnCalidad = (
            (receipt.inspeccionCalidadEstado === 'COMPLETADA' || (receipt.inspecciones && receipt.inspecciones.length > 0)) &&
            item.tipoDiscrepancia === 'MERMA' &&
            item.diferencia === 0
          );
          const yaJustificadoEnNotas = (item.line.notas && (item.line.notas.includes('[DISCREPANCIA_RESUELTA]') || item.line.notas.includes('[Control de Calidad]'))) || yaDictaminadoEnCalidad;

          if (!clasificacion || !justificacion) {
            if (!yaJustificadoEnNotas) {
              unresolvedLines.push({
                lineId: lId,
                sku: skuCod,
                descripcion: item.line.sku?.descripcion,
                cantidadEsperada: item.esperada,
                cantidadRecibida: item.recibida,
                cantidadDanada: item.danada,
                diferenciaNeta: item.diferencia,
                tipoDiscrepancia: item.tipoDiscrepancia,
                faltaClasificacion: !clasificacion,
                faltaJustificacion: !justificacion,
              });
            } else {
              resolvedMap.set(lId, {
                clasificacion: clasificacion || (yaDictaminadoEnCalidad ? 'MERMA_DICTAMINADA_CALIDAD' : 'MERMA_TECNICA'),
                justificacion: justificacion || (yaDictaminadoEnCalidad ? 'Merma dictaminada y segregada en Almacén Virtual DEV-01 por Control de Calidad.' : (item.line.notas || 'Resuelta en auditoría.')),
              });
            }
          } else {
            resolvedMap.set(lId, { clasificacion, justificacion });
          }
        }

        // CANDADO DE BLOQUEO DE CIERRE:
        if (unresolvedLines.length > 0) {
          throw new HttpException(
            {
              statusCode: HttpStatus.BAD_REQUEST,
              message: `Bloqueo de Cierre: No se puede finalizar ni cerrar la recepción porque existen ${unresolvedLines.length} partidas con discrepancias físicas sin justificación formal o sin clasificación de estatus. Por política de control operativo 3PL y trazabilidad legal, es obligatorio clasificar y justificar cada diferencia antes de proceder con el cierre.`,
              error: 'Bad Request',
              detalles: {
                codigo: 'CIERRE_BLOQUEADO_POR_DISCREPANCIA',
                totalDiscrepanciasSinResolver: unresolvedLines.length,
                partidasSinResolver: unresolvedLines,
                instruccion: 'Proporcione el arreglo "discrepancias" con [{ lineId, clasificacion, justificacion }] o defina "clasificacionGlobal" y "justificacionGlobal".',
              },
            },
            HttpStatus.BAD_REQUEST,
          );
        }
      }

      // 4. Actualizar partidas con la resolución de discrepancias
      for (const [lineId, res] of resolvedMap.entries()) {
        const line = activeLines.find((l: any) => l.id === lineId);
        const resolutionNote = `[DISCREPANCIA_RESUELTA] Estatus: ${res.clasificacion} | Justificación: ${res.justificacion}`;
        const newNotes = line?.notas ? `${line.notas} | ${resolutionNote}` : resolutionNote;

        await this.prisma.receiptLine.update({
          where: { id: lineId },
          data: {
            estado: 'DISCREPANCIA',
            notas: newNotes,
          },
        });
      }

      // 5. Actualizar la recepción a CERRADA con candado definitivo
      const updated = await this.prisma.receipt.update({
        where: { id: receiptId },
        data: {
          estado: 'CERRADA',
          cerradoPor: usuario,
          fechaCierre: new Date(),
          bloqueado: true,
          notas: body.notasCierre ? `${receipt.notas ? receipt.notas + ' | ' : ''}Cierre: ${body.notasCierre}` : receipt.notas,
        },
        include: {
          cliente: true,
          proveedor: true,
          lineas: { include: { sku: true } },
        },
      });

      const auditMsg = discrepantLines.length > 0
        ? `Recepción ${receipt.codigo} finalizada y cerrada con ${discrepantLines.length} discrepancias clasificadas y justificadas legalmente.`
        : `Recepción ${receipt.codigo} finalizada y cerrada 100% conforme sin discrepancias.`;

      await this.audit(usuario, 'CERRAR_RECEPCION', 'Receipt', receiptId, auditMsg);

      return {
        success: true,
        message: `Recepción ${receipt.codigo} finalizada y cerrada correctamente`,
        discrepanciasResueltas: resolvedMap.size,
        receipt: updated,
      };
    } catch (error: any) {
      console.error('Error al cerrar recepción:', error);
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: error.message || 'Error interno al cerrar la recepción',
          error: 'Internal Server Error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Patch('receipts/:id/status')
  @ApiOperation({
    summary: 'Actualizar bandera de estatus operacional de la recepción (Tarea 5)',
    description: 'Actualiza la bandera de estado de la recepción entre PENDIENTE_ARRIBO, EN_PROCESO_CONTEO y CERRADA. Activa el candado de seguridad automáticamente en conteo o cierre y rechaza modificaciones si ya se encuentra CERRADA.',
  })
  @ApiParam({ name: 'id', description: 'Identificador único UUID de la recepción previa' })
  @ApiBody({ type: UpdateReceiptStatusDto })
  @ApiResponse({ status: 200, description: 'Estatus operacional actualizado exitosamente.' })
  @ApiResponse({ status: 400, description: 'Estatus operacional inválido o datos incompletos.', type: ApiErrorResponseDto })
  @ApiResponse({ status: 403, description: 'Operación denegada: La recepción ya se encuentra CERRADA.', type: ApiErrorResponseDto })
  @ApiResponse({ status: 404, description: 'Recepción previa no encontrada.', type: ApiErrorResponseDto })
  async updateReceiptStatus(
    @Param('id') receiptId: string,
    @Body() body: any,
  ) {
    try {
      const receipt = await this.prisma.receipt.findUnique({ where: { id: receiptId } });
      if (!receipt) {
        throw new HttpException(
          {
            statusCode: HttpStatus.NOT_FOUND,
            message: `Recepción con ID "${receiptId}" no encontrada.`,
            error: 'Not Found',
            detalles: { codigo: 'RECEPCION_NO_ENCONTRADA', receiptId },
          },
          HttpStatus.NOT_FOUND,
        );
      }

      if (receipt.estado === 'CERRADO' || receipt.estado === 'CERRADA') {
        throw new HttpException(
          {
            statusCode: HttpStatus.FORBIDDEN,
            message: 'Operación no permitida: La recepción está CERRADA e inmutable en auditoría.',
            error: 'Forbidden',
            detalles: { codigo: 'RECEPCION_CERRADA_INMUTABLE' },
          },
          HttpStatus.FORBIDDEN,
        );
      }

      if (!body?.estado || typeof body.estado !== 'string' || body.estado.trim() === '') {
        throw new HttpException(
          {
            statusCode: HttpStatus.BAD_REQUEST,
            message: 'Datos incompletos: El campo estado es obligatorio.',
            error: 'Bad Request',
            detalles: { codigo: 'ESTADO_REQUERIDO', campo: 'estado' },
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      const validStatuses = ['PENDIENTE_ARRIBO', 'EN_PROCESO_CONTEO', 'CERRADA'];
      if (!validStatuses.includes(body.estado.trim())) {
        throw new HttpException(
          {
            statusCode: HttpStatus.BAD_REQUEST,
            message: `Estatus operacional inválido ("${body.estado}"). Debe ser uno de: ${validStatuses.join(', ')}`,
            error: 'Bad Request',
            detalles: { codigo: 'ESTADO_INVALIDO', estadoRecibido: body.estado, estadosValidos: validStatuses },
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      const estado = body.estado.trim();
      const usuario = body.usuario || 'Supervisor';

      // CANDADO DE BLOQUEO ANTE DISCREPANCIAS SI SE INTENTA CERRAR VÍA STATUS
      if (estado === 'CERRADA') {
        const receiptWithLines = await this.prisma.receipt.findUnique({
          where: { id: receiptId },
          include: { lineas: { include: { sku: true } } },
        });
        const activeLines = receiptWithLines?.lineas || [];
        for (const line of activeLines) {
          const esp = Number(line.cantidadEsperada ?? 0);
          const rec = Number(line.cantidadRecibida ?? 0);
          const dan = Number(line.cantidadDanada ?? 0);
          const fis = rec + dan;
          const dif = fis - esp;
          const hasDiscrepancy = (esp > 0 && (dif !== 0 || dan > 0)) || (esp === 0 && fis > 0);
          const isQualityMermaResolved = (dif === 0 && dan > 0 && line.notas && line.notas.includes('[Control de Calidad]'));
          const hasResolution = (line.notas && line.notas.includes('[DISCREPANCIA_RESUELTA]')) || isQualityMermaResolved;
          if (hasDiscrepancy && !hasResolution) {
            throw new HttpException(
              {
                statusCode: HttpStatus.BAD_REQUEST,
                message: `Bloqueo de Cierre: No se puede cambiar a estatus CERRADA porque existen discrepancias físicas sin resolver en la partida "${line.sku?.codigo}". Utilice el endpoint oficial POST /api/receipts/:id/close con la justificación y clasificación de estatus correspondiente.`,
                error: 'Bad Request',
                detalles: { codigo: 'CIERRE_BLOQUEADO_POR_DISCREPANCIA', sku: line.sku?.codigo },
              },
              HttpStatus.BAD_REQUEST,
            );
          }
        }
      }

      const updated = await this.prisma.receipt.update({
        where: { id: receiptId },
        data: {
          estado,
          ...(estado === 'EN_PROCESO_CONTEO' && !receipt.bloqueado
            ? { bloqueado: true, bloqueadoPor: usuario, fechaBloqueo: new Date() }
            : {}),
          ...(estado === 'CERRADA'
            ? { cerradoPor: usuario, fechaCierre: new Date(), bloqueado: true }
            : {}),
        },
        include: { cliente: true, proveedor: true, lineas: { include: { sku: true } } },
      });

      await this.audit(
        usuario,
        'CAMBIAR_ESTATUS_RECEPCION',
        'Receipt',
        receiptId,
        `Estatus cambiado de ${receipt.estado} a ${estado}. ${body.motivo ? `Motivo: ${body.motivo}` : ''}`,
      );

      return {
        success: true,
        message: `Estatus actualizado a ${estado}`,
        receipt: updated,
      };
    } catch (error: any) {
      console.error('Error al actualizar estatus de recepción:', error);
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: error.message || 'Error al actualizar estatus',
          error: 'Internal Server Error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('orders')
  @ApiOperation({ summary: 'Crear orden de salida con reserva automática de stock (Anti-Backorders)' })
  async createOrder(@Body() data: any, @Headers('authorization') authHeader?: string) {
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const token = authHeader.split(' ')[1];
        const decoded: any = jwt.verify(token, JWT_SECRET);
        let userClienteId = decoded?.clienteId;
        if (!userClienteId && decoded?.userId) {
          const user = await this.prisma.user.findUnique({ where: { id: decoded.userId } });
          userClienteId = user?.clienteId;
        }
        if (userClienteId && data.clienteId !== userClienteId) {
          throw new HttpException('ACCESO_DENEGADO: No puede crear pedidos a nombre de otro depositante.', HttpStatus.FORBIDDEN);
        }
      } catch (err: any) {
        if (err instanceof HttpException) throw err;
      }
    }

    if (!data.clienteId) throw new HttpException('El depositante es obligatorio', HttpStatus.BAD_REQUEST);
    if (!data.lineas || data.lineas.length === 0) throw new HttpException('La orden debe tener al menos un producto', HttpStatus.BAD_REQUEST);

    // 1. Validar disponibilidad real de stock para cada SKU en el almacén especificado
    const client = await this.prisma.client.findUnique({ where: { id: data.clienteId } });
    if (!client) throw new HttpException('Depositante no encontrado', HttpStatus.NOT_FOUND);

    const cleanLines: any[] = [];
    const reservationsToApply: { lotId: string; cantidad: number }[] = [];

    for (const item of data.lineas) {
      const sku = await this.prisma.skuMaster.findUnique({ where: { id: item.skuId } });
      if (!sku) throw new HttpException(`Producto con ID ${item.skuId} no encontrado`, HttpStatus.BAD_REQUEST);
      if (sku.activo === false) {
        throw new HttpException(
          `El SKU "${sku.codigo}" (${sku.descripcion}) se encuentra INACTIVO en el catálogo y no puede utilizarse para nuevos pedidos ni salidas. Reactívelo antes de continuar.`,
          HttpStatus.BAD_REQUEST,
        );
      }

      const requestedQty = Number(item.cantidadSolicitada) || 0;
      if (requestedQty <= 0) throw new HttpException(`Cantidad inválida para ${sku.descripcion}`, HttpStatus.BAD_REQUEST);

      // Buscar lotes disponibles
      const lotWhere: any = {
        skuId: item.skuId,
        clienteId: data.clienteId,
        estadoCalidad: 'LIBERADO',
        cantidadDisponible: { gt: 0 },
      };

      if (data.almacenOrigenId) {
        lotWhere.ubicacion = { almacenId: data.almacenOrigenId };
      }

      const availableLotsRaw = await this.prisma.lotInventory.findMany({
        where: lotWhere,
        include: {
          ubicacion: {
            include: { zona: true, almacen: true },
          },
        },
        orderBy: client.reglaInventario === 'FEFO' ? [{ fechaVencimiento: 'asc' }, { createdAt: 'asc' }] : [{ createdAt: 'asc' }],
      });

      // Filtrar únicamente lotes en condiciones comercialmente elegibles (precedencia central: excluye vencidos, merma, tránsito)
      const now = new Date();
      const availableLotsWithState = availableLotsRaw.map(lot => {
        const role = classifyLocationOperationalRole(lot.ubicacion);
        const opState = evaluateInventoryItemOperationalState(lot, role, now);
        return { lot, opState };
      }).filter(x => x.opState.esVendible && x.opState.cantidadDisponibleVendible > 0);

      // Calcular saldo libre (disponible vendible real según evaluador central)
      let totalStockLibre = 0;
      for (const itemState of availableLotsWithState) {
        totalStockLibre += itemState.opState.cantidadDisponibleVendible;
      }

      if (totalStockLibre < requestedQty) {
        throw new HttpException(
          `Stock insuficiente para "${sku.descripcion}" (${sku.codigo}). Disponible libre: ${totalStockLibre} ${sku.uomBase}, Solicitado: ${requestedQty} ${sku.uomBase}.`,
          HttpStatus.BAD_REQUEST
        );
      }

      // Distribuir la reserva entre los lotes
      let remainingToReserve = requestedQty;
      let primaryLotId: string | null = null;
      const lineReservations: { lotId: string; cantidad: number }[] = [];

      for (const itemState of availableLotsWithState) {
        if (remainingToReserve <= 0) break;
        const lotFree = itemState.opState.cantidadDisponibleVendible;
        if (lotFree <= 0) continue;

        const take = Math.min(remainingToReserve, lotFree);
        reservationsToApply.push({ lotId: itemState.lot.id, cantidad: take });
        lineReservations.push({ lotId: itemState.lot.id, cantidad: take });
        if (!primaryLotId) primaryLotId = itemState.lot.id;
        remainingToReserve -= take;
      }

      cleanLines.push({
        skuId: item.skuId,
        cantidadSolicitada: requestedQty,
        cantidadAsignada: 0,
        lotId: primaryLotId,
        asignacionesJson: lineReservations.length > 0 ? JSON.stringify(lineReservations) : null,
      });
    }

    // 2. Crear la orden de salida y aplicar reservas en transacción con reintento ante concurrencia
    const order = await withConcurrencyRetry(async () => {
      const yearPrefixPed = `PED-${new Date().getFullYear()}-`;
      const existingOrders = await this.prisma.salesOrder.findMany({
        where: { codigo: { startsWith: yearPrefixPed } },
        select: { codigo: true },
      });
      let maxPedSeq = 0;
      for (const o of existingOrders) {
        const num = parseInt(o.codigo.replace(yearPrefixPed, ''), 10);
        if (!isNaN(num) && num > maxPedSeq) maxPedSeq = num;
      }
      const codigo = `${yearPrefixPed}${String(maxPedSeq + 1).padStart(4, '0')}`;

      return await this.prisma.$transaction(async (tx) => {
        const ord = await tx.salesOrder.create({
          data: {
            codigo,
            clienteId: data.clienteId,
            endCustomerId: data.endCustomerId || null,
            almacenOrigenId: data.almacenOrigenId || null,
            prioridad: data.prioridad || 3,
            fechaCompromiso: data.fechaCompromiso ? new Date(data.fechaCompromiso) : null,
            horaCompromiso: data.horaCompromiso || null,
            estado: data.estado || 'SOLICITADO',
            notas: data.notas || null,
            solicitadoPor: data.solicitadoPor || null,
            lineas: { create: cleanLines },
          },
          include: { cliente: true, endCustomer: true, lineas: { include: { sku: true } } },
        });

        for (const res of reservationsToApply) {
          await tx.lotInventory.update({
            where: { id: res.lotId },
            data: { cantidadReservada: { increment: res.cantidad } },
          });
        }

        await tx.auditLog.create({
          data: {
            usuario: data.usuario || 'Sistema',
            accion: 'CREAR_ORDEN',
            entidad: 'SalesOrder',
            entidadId: ord.id,
            detalle: `${codigo}: ${cleanLines.length} líneas reservadas`,
          },
        });

        return ord;
      });
    }, { contextName: 'createSalesOrder' });

    return order;
  }

  @Put('orders/:id/status')
  @ApiOperation({ summary: 'Actualizar estado de orden' })
  async updateOrderStatus(@Param('id') id: string, @Body() body: { estado: string; usuario?: string }) {
    const updateData: any = { estado: body.estado };
    if (body.estado === 'DESPACHADO') updateData.fechaDespacho = new Date();

    const order = await this.prisma.salesOrder.update({
      where: { id }, data: updateData, include: { cliente: true },
    });

    await this.audit(body.usuario || 'Sistema', `ORDEN_${body.estado}`, 'SalesOrder', id, `Estado: ${body.estado}`);
    return order;
  }

  @Get('orders/:id/suggest-allocation')
  @ApiOperation({ summary: 'Sugerencia inteligente de asignación de lotes y ubicaciones (FEFO / FIFO) para Supervisor' })
  async suggestOrderAllocation(@Param('id') id: string) {
    const order = await this.prisma.salesOrder.findFirst({
      where: { OR: [{ id }, { codigo: id }] },
      include: {
        cliente: true,
        endCustomer: true,
        lineas: {
          include: {
            sku: true,
            lote: { include: { ubicacion: true } },
          },
        },
      },
    });

    if (!order) throw new HttpException('Orden no encontrada', HttpStatus.NOT_FOUND);

    const client = order.cliente;
    const isFefo = client.reglaInventario === 'FEFO';
    const reglaAplicada = isFefo ? 'FEFO' : 'FIFO';

    const lineasResult: any[] = [];

    for (const line of order.lineas) {
      const sku = line.sku;
      const requestedQty = line.cantidadSolicitada;

      const lotWhere: any = {
        skuId: line.skuId,
        clienteId: order.clienteId,
        estadoCalidad: 'LIBERADO',
        cantidadDisponible: { gt: 0 },
      };
      if (order.almacenOrigenId) {
        lotWhere.ubicacion = { almacenId: order.almacenOrigenId };
      }

      const candidateLotsRaw = await this.prisma.lotInventory.findMany({
        where: lotWhere,
        include: {
          ubicacion: {
            include: { zona: true, almacen: true },
          },
          handlingUnits: {
            where: { estadoHu: 'ACTIVO' },
            select: {
              id: true,
              codigo: true,
              tipoHu: true,
              cantidad: true,
              ubicacionActual: true,
              estadoEtiqueta: true,
              reacondicionada: true,
              piezasPorCaja: true,
              cajaOrigenId: true,
            },
          },
        },
        orderBy: isFefo
          ? [{ fechaVencimiento: 'asc' }, { createdAt: 'asc' }]
          : [{ createdAt: 'asc' }],
      });

      // Mapear reservas iniciales de la línea (soporta multi-lote vía asignacionesJson y retrocompatibilidad vía lotId)
      const ownReservationsMap = new Map<string, number>();
      if (line.asignacionesJson) {
        try {
          const parsed = typeof line.asignacionesJson === 'string' ? JSON.parse(line.asignacionesJson) : line.asignacionesJson;
          if (Array.isArray(parsed)) {
            for (const r of parsed) {
              if (r && r.lotId && Number(r.cantidad) > 0) {
                ownReservationsMap.set(r.lotId, Number(r.cantidad));
              }
            }
          }
        } catch {}
      }
      if (ownReservationsMap.size === 0 && line.lotId) {
        ownReservationsMap.set(line.lotId, line.cantidadSolicitada);
      }

      // Filtrar únicamente lotes comercialmente elegibles (precedencia central: excluye vencidos, merma y tránsito)
      const now = new Date();
      const candidateLots = candidateLotsRaw.filter(lot => {
        const role = classifyLocationOperationalRole(lot.ubicacion);
        const opState = evaluateInventoryItemOperationalState(lot, role, now);
        // Excepción order-aware: solo si este lote fue reservado explícitamente para esta orden (principal o secundario)
        const isInitialLot = ownReservationsMap.has(lot.id);
        return opState.esElegibleAllocation || (isInitialLot && opState.estadoPrincipal === 'DISPONIBLE_COMERCIAL' && !opState.esVencido);
      });

      let remainingToAllocate = requestedQty;
      const sugerencia: any[] = [];
      const todosLotesDisponibles: any[] = [];

      for (const lot of candidateLots) {
        const isInitialLotForThisLine = ownReservationsMap.has(lot.id);
        const maxOwnLineQuota = ownReservationsMap.get(lot.id) || 0;

        // Aislamiento atómico de reservas: calcular de forma order-aware las reservas de OTRAS órdenes
        let reservedByOthers = lot.cantidadReservada || 0;
        let ownReservedOnThisLot = 0;

        if (isInitialLotForThisLine) {
          const otherActiveLines = await this.prisma.salesOrderLine.findMany({
            where: {
              lotId: lot.id,
              orderId: { not: order.id },
              orden: {
                estado: { in: ['SOLICITADO', 'APROBADO', 'EN_PREPARACION', 'EN_PICKING'] },
              },
            },
            select: { cantidadSolicitada: true, asignacionesJson: true },
          });

          let otherOrdersReservedQty = 0;
          for (const oLine of otherActiveLines) {
            let oFound = false;
            if (oLine.asignacionesJson) {
              try {
                const parsedO = typeof oLine.asignacionesJson === 'string' ? JSON.parse(oLine.asignacionesJson) : oLine.asignacionesJson;
                if (Array.isArray(parsedO)) {
                  const m = parsedO.find((x: any) => x.lotId === lot.id);
                  if (m) {
                    otherOrdersReservedQty += (Number(m.cantidad) || 0);
                    oFound = true;
                  }
                }
              } catch {}
            }
            if (!oFound) {
              otherOrdersReservedQty += (oLine.cantidadSolicitada || 0);
            }
          }

          reservedByOthers = Math.min(lot.cantidadReservada || 0, otherOrdersReservedQty);
          ownReservedOnThisLot = Math.min(maxOwnLineQuota, Math.max(0, (lot.cantidadReservada || 0) - reservedByOthers));
        }

        const globalSaldoLibre = Math.max(0, (lot.cantidadDisponible || 0) - (lot.cantidadReservada || 0));
        const libreParaEstaOrden = globalSaldoLibre + ownReservedOnThisLot;

        const lotInfo: any = {
          lotId: lot.id,
          lote: lot.lote || 'SIN_LOTE',
          fechaVencimiento: lot.fechaVencimiento,
          fechaProduccion: lot.fechaProduccion,
          stockFisico: lot.cantidadDisponible,
          stockReservado: lot.cantidadReservada,
          stockLibre: libreParaEstaOrden,
          stockElegible: libreParaEstaOrden,
          ubicacionId: lot.ubicacionId,
          ubicacionCodigo: lot.ubicacion?.codigo || 'ANDEN',
          almacenId: lot.ubicacion?.almacenId,
          handlingUnits: lot.handlingUnits || [],
        };

        todosLotesDisponibles.push(lotInfo);

        const isClientCajaCerrada = client.manejoInventario === 'CAJA' || client.uomPrincipal === 'CAJA' || client.reglaInventario === 'CAJA_CERRADA' || (client as any).politicaEmpaque === 'CAJA_CERRADA';
        let elegibleParaEstaOrden = libreParaEstaOrden;
        const standardCap = line.sku?.capacidadEmpaque || (line.sku?.codigo?.includes('ACE') ? 12 : line.sku?.codigo?.includes('ARR') ? 20 : 1);
        if (isClientCajaCerrada && lot.handlingUnits && lot.handlingUnits.length > 0) {
          const partialUnits = lot.handlingUnits
            .filter((h: any) => Number(h.cantidad) < standardCap || h.codigo?.includes('PARCIAL'))
            .reduce((s: number, h: any) => s + (Number(h.cantidad) || 0), 0);
          elegibleParaEstaOrden = Math.max(0, libreParaEstaOrden - partialUnits);
        }

        lotInfo.stockElegible = elegibleParaEstaOrden;

        if (remainingToAllocate > 0 && elegibleParaEstaOrden > 0) {
          const take = Math.min(remainingToAllocate, elegibleParaEstaOrden);
          const eligibleHUs = isClientCajaCerrada
            ? (lot.handlingUnits || []).filter((h: any) => (!h.codigo || !h.codigo.includes('PARCIAL')) && Number(h.cantidad) >= standardCap)
            : (lot.handlingUnits || []);

          sugerencia.push({
            lotId: lot.id,
            lote: lot.lote || 'SIN_LOTE',
            fechaVencimiento: lot.fechaVencimiento,
            ubicacionId: lot.ubicacionId,
            ubicacionCodigo: lot.ubicacion?.codigo || 'ANDEN',
            cantidadSugerida: take,
            handlingUnits: eligibleHUs.slice(0, Math.ceil(take / (eligibleHUs[0]?.cantidad || take || 1))),
          });
          remainingToAllocate -= take;
        }
      }

      let parsedAsignaciones = null;
      if (line.asignacionesJson) {
        try {
          parsedAsignaciones = typeof line.asignacionesJson === 'string' ? JSON.parse(line.asignacionesJson) : line.asignacionesJson;
        } catch (e) {
          parsedAsignaciones = null;
        }
      }

      lineasResult.push({
        lineId: line.id,
        skuId: line.skuId,
        skuCodigo: sku.codigo,
        skuDescripcion: sku.descripcion,
        uom: sku.uomBase || 'PZA',
        cantidadSolicitada: requestedQty,
        cantidadAsignada: line.cantidadAsignada || 0,
        loteAsignado: line.loteAsignado,
        ubicacionAsignada: line.ubicacionAsignada,
        asignacionesJson: parsedAsignaciones,
        sugerencia,
        totalSugerido: sugerencia.reduce((sum, s) => sum + s.cantidadSugerida, 0),
        cuadrado: sugerencia.reduce((sum, s) => sum + s.cantidadSugerida, 0) === requestedQty,
        lotesDisponibles: todosLotesDisponibles,
      });
    }

    return {
      orderId: order.id,
      codigo: order.codigo,
      cliente: {
        id: client.id,
        nombre: client.nombreComercial,
        giro: client.giro,
        reglaInventario: client.reglaInventario,
      },
      endCustomer: order.endCustomer
        ? {
            id: order.endCustomer.id,
            nombre: order.endCustomer.nombre,
            codigo: order.endCustomer.codigo,
            ciudad: order.endCustomer.ciudad,
          }
        : null,
      reglaAplicada,
      prioridad: order.prioridad,
      fechaCompromiso: order.fechaCompromiso,
      horaCompromiso: order.horaCompromiso,
      estado: order.estado,
      preparadoPor: order.preparadoPor,
      fechaPreparacion: order.fechaPreparacion,
      asignacionModo: order.asignacionModo,
      lineas: lineasResult,
    };
  }

  @Post('orders/:id/allocate')
  @ApiOperation({ summary: 'Asignar/reservar stock para orden de salida (Alias para integración continua)' })
  async allocateOrder(@Param('id') id: string, @Body() data: any) {
    return this.prepareOrder(id, data);
  }

  @Post('orders/:id/prepare')
  @ApiOperation({ summary: 'Asignar lotes y ubicaciones a orden de salida (Panel Supervisor / Alejandra)' })
  async prepareOrder(
    @Param('id') id: string,
    @Body() data: {
      usuario: string;
      modo?: string; // AUTO_FEFO, AUTO_FIFO, MANUAL
      asignaciones: Array<{
        lineId: string;
        lotes: Array<{
          lotId: string;
          cantidad: number;
          lote?: string;
          ubicacionCodigo?: string;
          huId?: string;
          huCodigo?: string;
        }>;
      }>;
      notas?: string;
    }
  ) {
    if (!data.usuario) throw new HttpException('El usuario supervisor es obligatorio', HttpStatus.BAD_REQUEST);
    if (!data.asignaciones || data.asignaciones.length === 0) {
      throw new HttpException('Debe especificar al menos una partida con lotes asignados', HttpStatus.BAD_REQUEST);
    }

    const order = await this.prisma.salesOrder.findFirst({
      where: { OR: [{ id }, { codigo: id }] },
      include: { lineas: { include: { sku: true } }, cliente: true },
    });
    if (!order) throw new HttpException('Orden no encontrada', HttpStatus.NOT_FOUND);

    if (['DESPACHADO', 'ENTREGADO', 'RECHAZADO', 'CANCELADO'].includes(order.estado)) {
      throw new HttpException(`No se puede preparar una orden en estado ${order.estado}`, HttpStatus.BAD_REQUEST);
    }

    await this.prisma.$transaction(async (tx) => {
      for (const item of data.asignaciones) {
        const line = order.lineas.find(l => l.id === item.lineId);
        if (!line) throw new HttpException(`Línea con ID ${item.lineId} no pertenece a esta orden`, HttpStatus.BAD_REQUEST);

        const totalAllocated = item.lotes.reduce((sum, l) => sum + (Number(l.cantidad) || 0), 0);
        if (totalAllocated <= 0) {
          throw new HttpException(`La línea para "${line.sku.descripcion}" debe tener al menos una unidad asignada`, HttpStatus.BAD_REQUEST);
        }

        // Si la línea ya tenía un lote o desglose multi-lote reservado al crear el pedido, liberar su reserva
        if (line.asignacionesJson) {
          try {
            const parsed = typeof line.asignacionesJson === 'string' ? JSON.parse(line.asignacionesJson) : line.asignacionesJson;
            if (Array.isArray(parsed)) {
              for (const r of parsed) {
                if (r && r.lotId && Number(r.cantidad) > 0) {
                  await tx.lotInventory.update({
                    where: { id: r.lotId },
                    data: { cantidadReservada: { decrement: Number(r.cantidad) } },
                  }).catch(() => null);
                }
              }
            }
          } catch {}
        } else if (line.lotId) {
          await tx.lotInventory.update({
            where: { id: line.lotId },
            data: { cantidadReservada: { decrement: line.cantidadSolicitada } },
          }).catch(() => null);
        }

        // Aplicar nuevas reservas atómicas a los lotes seleccionados
        for (const alloc of item.lotes) {
          const qty = Number(alloc.cantidad) || 0;
          if (qty <= 0) continue;

          const lot = await tx.lotInventory.findUnique({ 
            where: { id: alloc.lotId },
            include: { ubicacion: { include: { zona: true, almacen: true } } },
          });
          if (!lot) throw new HttpException(`Lote ${alloc.lotId} no encontrado`, HttpStatus.BAD_REQUEST);

          const locRole = classifyLocationOperationalRole(lot.ubicacion);
          const opState = evaluateInventoryItemOperationalState(lot, locRole, new Date());
          if (!opState.esElegibleAllocation) {
            throw new HttpException(
              {
                statusCode: HttpStatus.CONFLICT,
                message: `LOTE_NO_ELEGIBLE_ALLOCATION: El lote ${lot.lote || lot.id} no es elegible para asignación operativa (${opState.badgeTexto}: ${opState.motivo}).`,
                error: 'Conflict',
              },
              HttpStatus.CONFLICT,
            );
          }

          const availableToReserve = lot.cantidadDisponible - (lot.cantidadReservada || 0);
          if (availableToReserve < qty) {
            throw new HttpException(
              {
                statusCode: HttpStatus.CONFLICT,
                message: `Stock disponible no reservado insuficiente en lote ${lot.lote || lot.id} para ${line.sku.descripcion}. Disponible libre: ${availableToReserve}, Solicitado: ${qty}`,
                error: 'Conflict',
              },
              HttpStatus.CONFLICT,
            );
          }

          // Revalidación autoritativa de compatibilidad con Handling Units indivisibles
          const huAllocValidation = await validateHuAllocationCompatibility({
            tx,
            lotId: alloc.lotId,
            clienteId: order.clienteId,
            requestedQty: qty,
            currentOrderId: order.id,
            skuCodigo: line.sku?.codigo,
          });

          if (huAllocValidation.esHuManaged && !huAllocValidation.valido) {
            throw new HttpException(
              {
                statusCode: HttpStatus.CONFLICT,
                code: huAllocValidation.codigoError || 'CANTIDAD_NO_COMPATIBLE_CON_HU',
                codigoError: huAllocValidation.codigoError || 'CANTIDAD_NO_COMPATIBLE_CON_HU',
                message: huAllocValidation.mensaje,
                error: 'Conflict',
              },
              HttpStatus.CONFLICT,
            );
          }

          if (huAllocValidation.esHuManaged && huAllocValidation.assignedHus.length > 0) {
            (alloc as any).husAsignadas = huAllocValidation.assignedHus;
          }

          await tx.lotInventory.update({
            where: { id: alloc.lotId },
            data: { cantidadReservada: { increment: qty } },
          });
        }

        const primaryLot = item.lotes[0];
        const primaryLotRecord = primaryLot ? await tx.lotInventory.findUnique({ where: { id: primaryLot.lotId }, include: { ubicacion: true } }) : null;

        await tx.salesOrderLine.update({
          where: { id: line.id },
          data: {
            cantidadAsignada: totalAllocated,
            lotId: primaryLot?.lotId || null,
            loteAsignado: item.lotes.map(l => l.lote || primaryLotRecord?.lote || 'N/A').join(', '),
            ubicacionAsignada: item.lotes.map(l => l.ubicacionCodigo || primaryLotRecord?.ubicacion?.codigo || 'N/A').join(', '),
            asignacionesJson: JSON.stringify(item.lotes),
          },
        });
      }

      await tx.salesOrder.update({
        where: { id: order.id },
        data: {
          estado: 'EN_PICKING',
          preparadoPor: data.usuario,
          fechaPreparacion: new Date(),
          asignacionModo: data.modo || 'AUTO_FEFO',
          aprobado: true,
          fechaAprobacion: order.fechaAprobacion || new Date(),
          aprobadoPor: order.aprobadoPor || data.usuario,
        },
      });
    }, { timeout: 30000 });

    await this.audit(data.usuario, 'PREPARAR_ORDEN', 'SalesOrder', order.id, `Orden ${order.codigo} preparada y asignada: modo ${data.modo || 'AUTO_FEFO'}`);

    return this.prisma.salesOrder.findUnique({
      where: { id: order.id },
      include: {
        cliente: true,
        endCustomer: true,
        lineas: { include: { sku: true, lote: { include: { ubicacion: true } } } },
      },
    });
  }

  @Post('orders/:id/approve')
  @ApiOperation({ summary: 'Aprobar orden de salida (3PL workflow)' })
  async approveOrder(@Param('id') id: string, @Body() body: { usuario: string; notas?: string }) {
    const order = await this.prisma.salesOrder.findUnique({ where: { id } });
    if (!order) throw new HttpException('Orden no encontrada', HttpStatus.NOT_FOUND);

    const updated = await this.prisma.salesOrder.update({
      where: { id },
      data: {
        estado: 'APROBADO', aprobado: true,
        fechaAprobacion: new Date(), aprobadoPor: body.usuario,
      },
      include: { cliente: true, endCustomer: true },
    });

    await this.prisma.orderApproval.create({
      data: { orderId: id, estado: 'APROBADO', aprobadoPor: body.usuario, notas: body.notas },
    });

    await this.audit(body.usuario, 'APROBAR_ORDEN', 'SalesOrder', id, `Orden ${order.codigo} aprobada`);
    return { success: true, order: updated };
  }

  @Post('orders/:id/reject')
  @ApiOperation({ summary: 'Rechazar o cancelar orden de salida y liberar reservas (3PL workflow)' })
  async rejectOrder(@Param('id') id: string, @Body() body: { usuario: string; motivo: string; notas?: string }) {
    const order = await this.prisma.salesOrder.findUnique({ 
      where: { id },
      include: { lineas: true }
    });
    if (!order) throw new HttpException('Orden no encontrada', HttpStatus.NOT_FOUND);
    if (!body.motivo) throw new HttpException('El motivo de rechazo o cancelación es obligatorio', HttpStatus.BAD_REQUEST);

    // Liberar inventario reservado en los lotes (multi-lote o lote único con retrocompatibilidad)
    for (const line of order.lineas) {
      if (line.asignacionesJson) {
        try {
          const parsed = typeof line.asignacionesJson === 'string' ? JSON.parse(line.asignacionesJson) : line.asignacionesJson;
          if (Array.isArray(parsed)) {
            for (const r of parsed) {
              if (r && r.lotId && Number(r.cantidad) > 0) {
                await this.prisma.lotInventory.update({
                  where: { id: r.lotId },
                  data: { cantidadReservada: { decrement: Number(r.cantidad) } },
                }).catch(() => null);
              }
            }
            continue;
          }
        } catch {}
      }
      if (line.lotId && line.cantidadSolicitada > 0) {
        await this.prisma.lotInventory.update({
          where: { id: line.lotId },
          data: { cantidadReservada: { decrement: line.cantidadSolicitada } },
        }).catch(() => null);
      }
    }

    const updated = await this.prisma.salesOrder.update({
      where: { id },
      data: { estado: 'RECHAZADO', motivoRechazo: body.motivo },
      include: { cliente: true, endCustomer: true },
    });

    await this.prisma.orderApproval.create({
      data: { orderId: id, estado: 'RECHAZADO', aprobadoPor: body.usuario, motivo: body.motivo, notas: body.notas },
    });

    await this.audit(body.usuario, 'RECHAZAR_ORDEN', 'SalesOrder', id, `Orden ${order.codigo} rechazada y reservas liberadas: ${body.motivo}`);
    return { success: true, order: updated };
  }

  @Post('orders/:id/start-picking')
  @ApiOperation({ summary: 'Fase 6: Iniciar picking de orden por surtidor (Regla de oro: 1 pedido por surtidor)' })
  async startPicking(@Param('id') id: string, @Body() body: { surtidor: string; forzarReasignacion?: boolean }) {
    const order = await this.prisma.salesOrder.findFirst({
      where: { OR: [{ id }, { codigo: id }] },
      include: { lineas: { include: { sku: true, lote: { include: { ubicacion: true } } } } },
    });
    if (!order) throw new HttpException('Orden no encontrada', HttpStatus.NOT_FOUND);

    if (order.surtidor && order.surtidor !== body.surtidor && !body.forzarReasignacion && order.estado === 'EN_PICKING') {
      return {
        success: false,
        requiereConfirmacion: true,
        mensaje: `Esta orden ya está siendo recolectada por el surtidor ${order.surtidor}. ¿Deseas reasignártela?`,
        surtidorActual: order.surtidor,
      };
    }

    const updated = await this.prisma.salesOrder.update({
      where: { id: order.id },
      data: {
        estado: 'EN_PICKING',
        surtidor: body.surtidor,
        fechaInicioPicking: order.fechaInicioPicking || new Date(),
      },
      include: {
        cliente: true,
        endCustomer: true,
        lineas: { include: { sku: true, lote: { include: { ubicacion: true } } } },
      },
    });

    await this.audit(body.surtidor, 'INICIAR_PICKING', 'SalesOrder', order.id, `Surtidor ${body.surtidor} inició recolección de ${order.codigo}`);
    return { success: true, order: updated };
  }

  @Post('orders/:id/validate-scan')
  @ApiOperation({ summary: 'Fase 6: Doble validación por escaneo (Ubicación en rack y Etiqueta de Caja/Lote)' })
  async validatePickingScan(
    @Param('id') id: string,
    @Body() body: {
      lineId: string;
      tipoScan: 'UBICACION' | 'CAJA';
      codigoEscaneado: string;
      ubicacionEsperada?: string;
      loteEsperado?: string;
      cantidadEsperada?: number;
      taskLotId?: string;
      cajasYaEscaneadas?: string[];
    },
  ) {
    const line = await this.prisma.salesOrderLine.findUnique({
      where: { id: body.lineId },
      include: {
        sku: true,
        lote: { include: { ubicacion: true } },
        orden: true,
      },
    });
    if (!line) throw new HttpException('Línea de pedido no encontrada', HttpStatus.NOT_FOUND);

    // Revalidación canónica preventiva de elegibilidad operativa para Picking (read-only)
    const validation = await validatePickingEligibility(
      this.prisma,
      {
        orderId: id,
        lineId: body.lineId,
        taskLotId: body.taskLotId,
        taskLoteCodigo: body.loteEsperado,
        taskUbicacionCodigo: body.ubicacionEsperada,
        requestedQty: body.cantidadEsperada || 1,
      },
      { throwOnConflict: false },
    );

    if (!validation.valido) {
      const isRegularizacion = validation.codigoError === 'INVENTARIO_LEGADO_SIN_HU';
      return {
        valid: false,
        requiereRevalidacion: true,
        requiereRegularizacion: isRegularizacion,
        codigoError: validation.codigoError,
        motivo: validation.motivo,
        mensaje: isRegularizacion
          ? 'ASIGNACIÓN REQUIERE REGULARIZACIÓN: El inventario asignado no cuenta con unidades de manejo físicas trazables. No puede surtirse mediante el flujo de escaneo de cajas.'
          : `ASIGNACIÓN REQUIERE REVALIDACIÓN: ${validation.motivo}`,
        tipoScan: body.tipoScan,
      };
    }

    const raw = (body.codigoEscaneado || '').trim();
    const cleanScan = raw.toUpperCase();

    if (body.tipoScan === 'UBICACION') {
      let expectedLocation = (body.ubicacionEsperada || line.ubicacionAsignada || line.lote?.ubicacion?.codigo || '').toUpperCase();
      let validLocations = [expectedLocation];

      if (line.asignacionesJson) {
        try {
          const parsed = JSON.parse(line.asignacionesJson);
          if (Array.isArray(parsed)) {
            parsed.forEach((a: any) => {
              if (a.ubicacionCodigo) validLocations.push(a.ubicacionCodigo.toUpperCase());
            });
          }
        } catch (_) {}
      }
      validLocations = validLocations.filter(Boolean);

      const isMatch = validLocations.some(loc => loc === cleanScan || cleanScan.endsWith(loc) || loc.endsWith(cleanScan));

      if (!isMatch) {
        return {
          valid: false,
          tipoScan: 'UBICACION',
          mensaje: `Ubicación errónea: Escaneaste "${raw}". La ubicación asignada para este producto es "${validLocations[0] || 'N/A'}". Dirígete al rack correcto.`,
          ubicacionEsperada: validLocations[0],
        };
      }

      return {
        valid: true,
        tipoScan: 'UBICACION',
        mensaje: `Ubicación confirmada: ${cleanScan} correcta. Procede a escanear la caja.`,
        ubicacion: cleanScan,
      };
    }

    if (body.tipoScan === 'CAJA') {
      const skuCodigo = (line.sku.codigo || '').toUpperCase();
      const skuEan = (line.sku.codigoBarras || '').toUpperCase();
      const loteAsignado = (body.loteEsperado || line.loteAsignado || line.lote?.lote || '').toUpperCase();
      const expectedLocation = (body.ubicacionEsperada || line.ubicacionAsignada || line.lote?.ubicacion?.codigo || '').toUpperCase();

      // 1. REGLA: No permitir que un SKU o lote se hagan pasar por una Caja/HU
      const isSkuInput = cleanScan === skuCodigo || (skuEan && cleanScan === skuEan);
      const isLoteInput = Boolean(loteAsignado && cleanScan === loteAsignado);

      if (isSkuInput || isLoteInput) {
        return {
          valid: false,
          tipoScan: 'CAJA',
          codigoError: 'HU_REQUERIDA',
          mensaje: 'Esta operación requiere una unidad de manejo física. Escanea la etiqueta Code-128 de la caja/HU.',
        };
      }

      // 2. Búsqueda autoritativa de la Handling Unit por código exacto
      const hu = await this.prisma.handlingUnit.findFirst({
        where: {
          codigo: { equals: raw, mode: 'insensitive' },
        },
        include: { lote: true },
      });

      if (!hu) {
        return {
          valid: false,
          tipoScan: 'CAJA',
          codigoError: 'HU_NO_ENCONTRADA',
          mensaje: `Unidad de manejo no encontrada: La etiqueta "${raw}" no corresponde a ninguna caja/HU registrada en el almacén.`,
        };
      }

      // 3. Validar estado ACTIVO
      if (hu.estadoHu !== 'ACTIVO') {
        return {
          valid: false,
          tipoScan: 'CAJA',
          codigoError: 'HU_NO_ACTIVA',
          mensaje: `Caja no disponible: La HU "${raw}" se encuentra en estado ${hu.estadoHu} (no conforme/inactiva).`,
        };
      }

      // 4. Validar pertenencia al cliente de la orden
      if (hu.clienteId && line.orden?.clienteId && hu.clienteId !== line.orden.clienteId) {
        return {
          valid: false,
          tipoScan: 'CAJA',
          codigoError: 'HU_SKU_NO_COINCIDE',
          mensaje: `La caja "${raw}" pertenece a otro depositante/cliente y no corresponde a este pedido.`,
        };
      }

      // 5. Validar SKU
      const huSku = (hu.skuCodigo || (hu.lote as any)?.sku?.codigo || '').toUpperCase();
      if (huSku !== skuCodigo && hu.lote?.skuId !== line.skuId) {
        return {
          valid: false,
          tipoScan: 'CAJA',
          codigoError: 'HU_SKU_NO_COINCIDE',
          mensaje: `La caja "${raw}" contiene ${huSku || 'otro producto'}, pero la orden requiere ${skuCodigo}.`,
        };
      }

      // 6. Validar Lote Asignado
      const huLote = (hu.loteTexto || hu.lote?.lote || '').toUpperCase();
      if (loteAsignado && huLote !== loteAsignado) {
        return {
          valid: false,
          tipoScan: 'CAJA',
          codigoError: 'HU_LOTE_NO_COINCIDE',
          mensaje: `La caja "${raw}" pertenece al lote "${huLote || 'N/A'}", pero la orden tiene asignado el lote "${loteAsignado}".`,
        };
      }

      // 7. Validar Ubicación física actual de la HU (debe coincidir con el rack verificado)
      const huUbi = (hu.ubicacionActual || '').trim().toUpperCase();
      if (expectedLocation && huUbi !== expectedLocation) {
        return {
          valid: false,
          tipoScan: 'CAJA',
          codigoError: 'HU_UBICACION_NO_COINCIDE',
          mensaje: `La caja "${raw}" está registrada en la ubicación "${huUbi || 'SIN UBICACIÓN'}", pero el surtido actual es en "${expectedLocation}".`,
        };
      }

      // 8. Prevención de Doble Escaneo en Backend
      const yaEscaneadasEnFront = Array.isArray(body.cajasYaEscaneadas) ? body.cajasYaEscaneadas.map(c => c.toUpperCase()) : [];
      const cajasEnLinea = (line.cajaEscaneada || '').toUpperCase();
      let cajasHistorialLinea: string[] = [];
      if (line.asignacionesJson) {
        try {
          const parsed = JSON.parse(line.asignacionesJson);
          if (Array.isArray(parsed)) {
            parsed.forEach((a: any) => {
              if (Array.isArray(a.cajasEscaneadas)) {
                cajasHistorialLinea.push(...a.cajasEscaneadas.map((c: string) => c.toUpperCase()));
              }
            });
          }
        } catch (_) {}
      }

      const yaRegistrada =
        yaEscaneadasEnFront.includes(cleanScan) ||
        cajasEnLinea.includes(cleanScan) ||
        cajasHistorialLinea.includes(cleanScan);

      if (yaRegistrada) {
        return {
          valid: false,
          tipoScan: 'CAJA',
          codigoError: 'HU_YA_ESCANEADA',
          mensaje: `Caja duplicada: La HU "${raw}" ya fue escaneada y registrada previamente en esta orden.`,
        };
      }

      // 9. Cantidad de la HU y Regla de Caja Parcial
      const huPiezas = Number(hu.cantidad || hu.piezasPorCaja || 0);
      const cantPickeadaActual = Number(line.cantidadPickeada || 0);
      const pendiente = Math.max(0, Number(line.cantidadSolicitada) - cantPickeadaActual);

      if (huPiezas <= 0) {
        return {
          valid: false,
          tipoScan: 'CAJA',
          codigoError: 'HU_VACIA',
          mensaje: `La caja "${raw}" no cuenta con existencias físicas registradas (0 piezas).`,
        };
      }

      if (huPiezas > pendiente) {
        return {
          valid: false,
          tipoScan: 'CAJA',
          codigoError: 'HU_CANTIDAD_EXCEDE_PENDIENTE',
          mensaje: `HU indivisible: La caja "${raw}" contiene ${huPiezas} pzas pero el pedido solo requiere ${pendiente} pzas pendientes. No se permite fraccionamiento automático (split de HU) sin flujo formal auditado de acondicionamiento.`,
        };
      }

      return {
        valid: true,
        tipoScan: 'CAJA',
        mensaje: `Caja y lote validados con éxito: ${skuCodigo} (Lote: ${loteAsignado}). Contiene ${huPiezas} piezas.`,
        sku: line.sku.codigo,
        lote: loteAsignado,
        huCodigo: hu.codigo,
        cantidadCaja: huPiezas,
      };
    }

    return { valid: false, mensaje: 'Tipo de escaneo desconocido' };
  }

  @Post('orders/:id/record-pick')
  @ApiOperation({ summary: 'Fase 6: Registrar conteo pickeado por línea con doble escaneo y revalidación canónica' })
  async recordPick(
    @Param('id') id: string,
    @Body() body: {
      lineId: string;
      cantidadPickeada: number;
      ubicacionEscaneada?: string;
      cajaEscaneada?: string;
      usuario?: string;
      taskUbicacionCodigo?: string;
      taskLotId?: string;
      taskCantidadPickeada?: number;
      asignacionesActualizadas?: any[];
      esAjusteManual?: boolean;
      motivoAjuste?: string;
    },
  ) {
    return await this.prisma.$transaction(async (tx) => {
      // 0. Bloqueo de Bypass: Si se intenta ajuste manual sin flujo formal de supervisor activo
      if (body.esAjusteManual) {
        throw new HttpException(
          {
            statusCode: HttpStatus.FORBIDDEN,
            code: 'AJUSTE_MANUAL_NO_AUTORIZADO',
            codigoError: 'AJUSTE_MANUAL_NO_AUTORIZADO',
            message: 'El ajuste manual por excepción se encuentra deshabilitado. El surtido requiere validación física mediante escaneo de Rack y Caja/HU.',
            motivo: 'Protocolo formal de supervisor no habilitado para excepciones directas.',
            error: 'Forbidden',
          },
          HttpStatus.FORBIDDEN,
        );
      }

      // Bloqueo de Bypass: Si se intenta registrar cantidad > 0 sin los escaneos físicos
      if (body.cantidadPickeada > 0 && (!body.ubicacionEscaneada || !body.cajaEscaneada)) {
        throw new HttpException(
          {
            statusCode: HttpStatus.BAD_REQUEST,
            code: 'ESCANEO_FISICO_OBLIGATORIO',
            codigoError: 'ESCANEO_FISICO_OBLIGATORIO',
            message: 'Se requiere el escaneo obligatorio de Rack y Caja/HU para confirmar el picking.',
            motivo: 'Falta registro de ubicación física o etiqueta de caja escaneada.',
            error: 'Bad Request',
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      // 1. Revalidación canónica obligatoria bajo transacción antes de cualquier mutación
      const validation = await validatePickingEligibility(
        tx,
        {
          orderId: id,
          lineId: body.lineId,
          requestedQty: body.cantidadPickeada,
          taskLotId: body.taskLotId,
          taskUbicacionCodigo: body.taskUbicacionCodigo,
          businessDate: new Date(),
        },
        { throwOnConflict: true },
      );

      const line = validation.line;

      // 2. Validación autoritativa de la Handling Unit en confirmación mutante
      if (body.cajaEscaneada) {
        const rawCaja = body.cajaEscaneada.trim();
        const cleanCaja = rawCaja.toUpperCase();
        const skuCodigo = (line.sku?.codigo || '').toUpperCase();
        const loteAsignado = (validation.freshLot?.lote || line.loteAsignado || '').toUpperCase();

        if (cleanCaja === skuCodigo || cleanCaja === loteAsignado) {
          throw new HttpException(
            {
              statusCode: HttpStatus.CONFLICT,
              code: 'HU_REQUERIDA',
              codigoError: 'HU_REQUERIDA',
              message: 'Esta operación requiere una unidad de manejo física. Escanea la etiqueta Code-128 de la caja/HU.',
              error: 'Conflict',
            },
            HttpStatus.CONFLICT,
          );
        }

        const hu = await tx.handlingUnit.findFirst({
          where: { codigo: { equals: rawCaja, mode: 'insensitive' } },
        });

        if (!hu) {
          throw new HttpException(
            {
              statusCode: HttpStatus.CONFLICT,
              code: 'HU_NO_ENCONTRADA',
              codigoError: 'HU_NO_ENCONTRADA',
              message: `Unidad de manejo no encontrada: La etiqueta "${rawCaja}" no corresponde a ninguna caja/HU registrada.`,
              error: 'Conflict',
            },
            HttpStatus.CONFLICT,
          );
        }

        if (hu.estadoHu !== 'ACTIVO') {
          throw new HttpException(
            {
              statusCode: HttpStatus.CONFLICT,
              code: 'HU_NO_ACTIVA',
              codigoError: 'HU_NO_ACTIVA',
              message: `Caja no disponible: La HU "${rawCaja}" se encuentra en estado ${hu.estadoHu}.`,
              error: 'Conflict',
            },
            HttpStatus.CONFLICT,
          );
        }

        const huSku = (hu.skuCodigo || '').toUpperCase();
        if (huSku !== skuCodigo && hu.lotId !== validation.targetLotId) {
          throw new HttpException(
            {
              statusCode: HttpStatus.CONFLICT,
              code: 'HU_SKU_NO_COINCIDE',
              codigoError: 'HU_SKU_NO_COINCIDE',
              message: `La caja "${rawCaja}" contiene ${huSku}, pero la orden requiere ${skuCodigo}.`,
              error: 'Conflict',
            },
            HttpStatus.CONFLICT,
          );
        }

        const huLote = (hu.loteTexto || '').toUpperCase();
        if (loteAsignado && huLote !== loteAsignado) {
          throw new HttpException(
            {
              statusCode: HttpStatus.CONFLICT,
              code: 'HU_LOTE_NO_COINCIDE',
              codigoError: 'HU_LOTE_NO_COINCIDE',
              message: `La caja "${rawCaja}" pertenece al lote "${huLote}", pero la orden tiene asignado "${loteAsignado}".`,
              error: 'Conflict',
            },
            HttpStatus.CONFLICT,
          );
        }
      }

      let stagingTransferResult: any = null;
      const usuarioResponsable = body.usuario || line.orden?.surtidor || 'Surtidor';

      if (body.cajaEscaneada) {
        stagingTransferResult = await transferHuToStaging(tx, {
          orderId: id,
          orderCodigo: line.orden?.codigo,
          lineId: body.lineId,
          huCode: body.cajaEscaneada,
          rackLocationCode: body.ubicacionEscaneada || line.ubicacionAsignada || validation.targetLocCodigo,
          usuario: usuarioResponsable,
        });
      }

      const newQty = Math.max(0, Math.min(body.cantidadPickeada, line.cantidadSolicitada));
      const isCompleted = newQty >= line.cantidadSolicitada;

      const updateData: any = {
        cantidadPickeada: newQty,
        cantidadAsignada: newQty,
        ubicacionEscaneada: body.ubicacionEscaneada || line.ubicacionEscaneada,
        cajaEscaneada: body.cajaEscaneada || line.cajaEscaneada,
        pickingCompletado: isCompleted,
        fechaPicking: new Date(),
      };

      if (stagingTransferResult) {
        updateData.huId = stagingTransferResult.huId;
        let parsedAsignaciones: any[] = [];
        if (body.asignacionesActualizadas && Array.isArray(body.asignacionesActualizadas)) {
          parsedAsignaciones = body.asignacionesActualizadas;
        } else if (line.asignacionesJson) {
          try {
            const p = JSON.parse(line.asignacionesJson);
            if (Array.isArray(p)) parsedAsignaciones = p;
          } catch (_) {}
        }
        const matchingAlloc = parsedAsignaciones[0] || {};
        matchingAlloc.huId = stagingTransferResult.huId;
        matchingAlloc.huCodigo = stagingTransferResult.huCodigo;
        matchingAlloc.stagingLocationId = stagingTransferResult.stagingLocation.id;
        matchingAlloc.stagingLocationCodigo = stagingTransferResult.stagingLocation.codigo;
        matchingAlloc.stagingLotId = stagingTransferResult.stagingLotId;
        const currentCajas = Array.isArray(matchingAlloc.cajasEscaneadas) ? matchingAlloc.cajasEscaneadas : [];
        if (!currentCajas.includes(stagingTransferResult.huCodigo)) {
          matchingAlloc.cajasEscaneadas = [...currentCajas, stagingTransferResult.huCodigo];
        }
        updateData.asignacionesJson = JSON.stringify(parsedAsignaciones.length > 0 ? parsedAsignaciones : [matchingAlloc]);
      } else if (body.asignacionesActualizadas && Array.isArray(body.asignacionesActualizadas)) {
        updateData.asignacionesJson = JSON.stringify(body.asignacionesActualizadas);
      }

      await tx.salesOrderLine.update({
        where: { id: body.lineId },
        data: updateData,
      });

      await tx.auditLog.create({
        data: {
          usuario: usuarioResponsable,
          accion: 'PICKING_LINEA_REGISTRADO',
          entidad: 'SalesOrderLine',
          entidadId: line.id,
          detalle: `Picking registrado para orden ${line.orden?.codigo || id}: ${newQty} pzas pickeadas en ${validation.targetLocCodigo} (Lote: ${validation.freshLot.lote})`,
        },
      });

      const allLines = await tx.salesOrderLine.findMany({
        where: { orderId: line.orderId },
      });

      const orderFullyPicked = allLines.every(l =>
        l.id === body.lineId ? isCompleted : l.pickingCompletado || l.cantidadPickeada >= l.cantidadSolicitada,
      );

      let updatedOrder: any = null;
      if (orderFullyPicked) {
        updatedOrder = await tx.salesOrder.update({
          where: { id: line.orderId },
          data: {
            estado: 'CONSOLIDADO',
            fechaFinPicking: new Date(),
          },
          include: { cliente: true, endCustomer: true, lineas: { include: { sku: true, lote: true } } },
        });

        await tx.auditLog.create({
          data: {
            usuario: usuarioResponsable,
            accion: 'PICKING_COMPLETADO',
            entidad: 'SalesOrder',
            entidadId: line.orderId,
            detalle: `Pedido ${line.orden?.codigo || id} consolidado al 100% bajo protocolo de revalidación canónica`,
          },
        });
      }

      return {
        success: true,
        lineId: body.lineId,
        cantidadPickeada: newQty,
        lineCompleted: isCompleted,
        orderFullyPicked,
        order: updatedOrder,
      };
    });
  }

  @Post('orders/:id/pick')
  @ApiOperation({ summary: 'Fase 6: Pickear unidades de rack bajo protocolo transaccional con bloqueo pesimista (Etapa 5A.1)' })
  async pickOrderItem(
    @Param('id') id: string,
    @Body() body: {
      lineId: string;
      cantidadPickeada: number;
      lotId?: string;
      ubicacionId?: string;
      huId?: string;
      cajaEscaneada?: string;
      ubicacionEscaneada?: string;
      usuario?: string;
    },
  ) {
    const line = await this.prisma.salesOrderLine.findUnique({
      where: { id: body.lineId },
      include: { orden: { include: { lineas: true } }, lote: true },
    });
    if (!line) throw new HttpException('Línea de pedido no encontrada', HttpStatus.NOT_FOUND);

    const targetLotId = body.lotId || line.lotId;
    let targetLocId = body.ubicacionId || line.lote?.ubicacionId;

    if (!targetLocId && targetLotId) {
      const lotRec = await this.prisma.lotInventory.findUnique({ where: { id: targetLotId } });
      if (lotRec?.ubicacionId) targetLocId = lotRec.ubicacionId;
    }

    const locationIds = targetLocId ? [targetLocId] : [];
    const huIds = body.huId ? [body.huId] : [];

    return await this.putawayEngine.executePhysicalMovementProtocol(
      this.prisma,
      {
        huIds,
        locationIds,
        opName: 'pickOrderItem',
      },
      async (tx) => {
        // Revalidación canónica compartida y centralizada bajo transacción
        const validation = await validatePickingEligibility(
          tx,
          {
            orderId: id,
            lineId: body.lineId,
            requestedQty: body.cantidadPickeada,
            taskLotId: targetLotId,
            taskUbicacionCodigo: body.ubicacionEscaneada,
            businessDate: new Date(),
          },
          { throwOnConflict: true },
        );

        let stagingTransferResult: any = null;
        const usuarioResponsable = body.usuario || line.orden?.surtidor || 'Surtidor';

        const huCodeToTransfer = body.cajaEscaneada || (body.huId ? (await tx.handlingUnit.findUnique({ where: { id: body.huId } }))?.codigo : null);
        if (huCodeToTransfer) {
          stagingTransferResult = await transferHuToStaging(tx, {
            orderId: id,
            orderCodigo: line.orden?.codigo,
            lineId: body.lineId,
            huCode: huCodeToTransfer,
            rackLocationCode: body.ubicacionEscaneada || line.ubicacionAsignada || validation.targetLocCodigo,
            usuario: usuarioResponsable,
          });
        }

        const qty = Math.max(0, Math.min(body.cantidadPickeada, line.cantidadSolicitada));
        const isCompleted = qty >= line.cantidadSolicitada;

        const updateData: any = {
          cantidadPickeada: qty,
          cantidadAsignada: qty,
          ubicacionEscaneada: body.ubicacionEscaneada || line.ubicacionEscaneada,
          cajaEscaneada: body.cajaEscaneada || line.cajaEscaneada,
          pickingCompletado: isCompleted,
          fechaPicking: new Date(),
        };

        if (stagingTransferResult) {
          updateData.huId = stagingTransferResult.huId;
          let parsedAsignaciones: any[] = [];
          if (line.asignacionesJson) {
            try {
              const p = JSON.parse(line.asignacionesJson);
              if (Array.isArray(p)) parsedAsignaciones = p;
            } catch (_) {}
          }
          const matchingAlloc = parsedAsignaciones[0] || {};
          matchingAlloc.huId = stagingTransferResult.huId;
          matchingAlloc.huCodigo = stagingTransferResult.huCodigo;
          matchingAlloc.stagingLocationId = stagingTransferResult.stagingLocation.id;
          matchingAlloc.stagingLocationCodigo = stagingTransferResult.stagingLocation.codigo;
          matchingAlloc.stagingLotId = stagingTransferResult.stagingLotId;
          const currentCajas = Array.isArray(matchingAlloc.cajasEscaneadas) ? matchingAlloc.cajasEscaneadas : [];
          if (!currentCajas.includes(stagingTransferResult.huCodigo)) {
            matchingAlloc.cajasEscaneadas = [...currentCajas, stagingTransferResult.huCodigo];
          }
          updateData.asignacionesJson = JSON.stringify(parsedAsignaciones.length > 0 ? parsedAsignaciones : [matchingAlloc]);
        }

        // Actualizar línea de pedido
        await tx.salesOrderLine.update({
          where: { id: body.lineId },
          data: updateData,
        });

        await tx.auditLog.create({
          data: {
            usuario: usuarioResponsable,
            accion: 'PICKING_LINEA_REGISTRADO',
            entidad: 'SalesOrderLine',
            entidadId: line.id,
            detalle: `Picking registrado para orden ${line.orden.codigo}: ${qty} pzas pickeadas en ${validation.targetLocCodigo} (Lote: ${validation.freshLot.lote})`,
          },
        });

        const allLines = await tx.salesOrderLine.findMany({
          where: { orderId: line.orderId },
        });

        const orderFullyPicked = allLines.every(l =>
          l.id === body.lineId ? isCompleted : l.pickingCompletado || l.cantidadPickeada >= l.cantidadSolicitada,
        );

        let updatedOrder: any = null;
        if (orderFullyPicked) {
          updatedOrder = await tx.salesOrder.update({
            where: { id: line.orderId },
            data: {
              estado: 'CONSOLIDADO',
              fechaFinPicking: new Date(),
            },
            include: { cliente: true, endCustomer: true, lineas: { include: { sku: true, lote: true } } },
          });

          await tx.auditLog.create({
            data: {
              usuario: usuarioResponsable,
              accion: 'PICKING_COMPLETADO',
              entidad: 'SalesOrder',
              entidadId: line.orderId,
              detalle: `Pedido ${line.orden.codigo} consolidado al 100% bajo protocolo de concurrencia`,
            },
          });
        }

        return {
          success: true,
          message: `Picking registrado exitosamente para línea ${line.id} (${qty} pzas)`,
          lineId: body.lineId,
          cantidadPickeada: qty,
          lineCompleted: isCompleted,
          orderFullyPicked,
          order: updatedOrder,
        };
      },
    );
  }

  @Post('orders/:id/dispatch')
  @ApiOperation({ summary: 'Confirmar despacho — descuenta inventario físico y reservas bajo protocolo transaccional de concurrencia (Etapa 5A.1)' })
  async dispatchOrder(
    @Param('id') id: string,
    @Body() data: {
      despachador: string;
      vehiculoPlaca?: string;
      notas?: string;
      tipoTransporte?: string;
      paqueteria?: string;
      numeroGuia?: string;
      fletera?: string;
      choferNombre?: string;
      choferLicencia?: string;
      selloSeguridad?: string;
      firmaDespachador?: string;
      firmaChofer?: string;
      folioManifiesto?: string;
    },
  ) {
    const fullOrder = await this.prisma.salesOrder.findFirst({
      where: { OR: [{ id }, { codigo: id }] },
      include: {
        lineas: { include: { sku: true, lote: { include: { ubicacion: true } } } },
        cliente: true,
        endCustomer: true,
      },
    });
    if (!fullOrder) throw new HttpException('Orden no encontrada', HttpStatus.NOT_FOUND);

    const plannedDeductions: Array<{
      line: any;
      allocations: Array<{ lotId: string; cantidad: number; ubicacionId?: string }>;
    }> = [];

    const allLotIds: string[] = [];
    const allLocIds: string[] = [];

    for (const line of fullOrder.lineas) {
      let allocationsToDeduct: Array<{ lotId: string; cantidad: number; ubicacionId?: string }> = [];

      // 1. Asignaciones explícitas de Fase 5 (asignacionesJson)
      if (line.asignacionesJson) {
        try {
          const parsed = JSON.parse(line.asignacionesJson);
          if (Array.isArray(parsed) && parsed.length > 0) {
            allocationsToDeduct = parsed.map((a: any) => ({
              lotId: a.lotId,
              cantidad: Number(a.cantidad) || 0,
              ubicacionId: a.ubicacionId,
            }));
          }
        } catch (_) {}
      }

      // 2. Si no hay asignacionesJson pero sí lotId asignado
      if (allocationsToDeduct.length === 0 && line.lotId) {
        allocationsToDeduct.push({
          lotId: line.lotId,
          cantidad: line.cantidadSolicitada,
          ubicacionId: line.lote?.ubicacionId || undefined,
        });
      }

      // 3. Fallback FEFO si no hubo asignación previa
      if (allocationsToDeduct.length === 0) {
        let remaining = line.cantidadSolicitada;
        const candidateLotsRaw = await this.prisma.lotInventory.findMany({
          where: { skuId: line.skuId, clienteId: fullOrder.clienteId, cantidadDisponible: { gt: 0 }, estadoCalidad: 'LIBERADO' },
          orderBy: { fechaVencimiento: 'asc' },
          include: { ubicacion: { include: { zona: true, almacen: true } } },
        });
        const candidateLots = candidateLotsRaw.filter(cl => classifyLocationOperationalRole(cl.ubicacion).esVendible);
        for (const cl of candidateLots) {
          if (remaining <= 0) break;
          const take = Math.min(remaining, cl.cantidadDisponible);
          remaining -= take;
          allocationsToDeduct.push({ lotId: cl.id, cantidad: take, ubicacionId: cl.ubicacionId || undefined });
        }
      }

      plannedDeductions.push({ line, allocations: allocationsToDeduct });
      for (const a of allocationsToDeduct) {
        if (a.lotId) allLotIds.push(a.lotId);
        if (a.ubicacionId) allLocIds.push(a.ubicacionId);
      }
    }

    // Identificar HandlingUnits activas asociadas a los lotes a despachar
    const candidateHus = await this.prisma.handlingUnit.findMany({
      where: {
        lotId: { in: [...new Set(allLotIds)] },
        clienteId: fullOrder.clienteId,
        estadoHu: 'ACTIVO',
      },
      select: { id: true },
    });
    const huIds = candidateHus.map(h => h.id);
    const locationIds = [...new Set(allLocIds.filter(Boolean))];

    const folioManifiesto = data.folioManifiesto && !data.folioManifiesto.startsWith('PRE-')
      ? data.folioManifiesto
      : (fullOrder.folioManifiesto && !fullOrder.folioManifiesto.startsWith('PRE-')
          ? fullOrder.folioManifiesto
          : `MAN-${fullOrder.codigo}`);

    const order = await this.putawayEngine.executePhysicalMovementProtocol(
      this.prisma,
      {
        huIds,
        locationIds,
        opName: 'dispatchOrder',
      },
      async (tx) => {
        for (const { line, allocations } of plannedDeductions) {
          let totalDeductedForLine = 0;

          // 1. Identificar HUs recolectadas formalmente para esta línea
          let linePickedHuCodes: string[] = [];
          if (line.cajaEscaneada) {
            linePickedHuCodes.push(...line.cajaEscaneada.split(',').map((s: string) => s.trim().toUpperCase()));
          }
          if (line.asignacionesJson) {
            try {
              const parsed = JSON.parse(line.asignacionesJson);
              if (Array.isArray(parsed)) {
                parsed.forEach((a: any) => {
                  if (a.huCodigo) linePickedHuCodes.push(a.huCodigo.toUpperCase());
                  if (Array.isArray(a.cajasEscaneadas)) {
                    linePickedHuCodes.push(...a.cajasEscaneadas.map((c: string) => c.toUpperCase()));
                  }
                });
              }
            } catch (_) {}
          }
          linePickedHuCodes = [...new Set(linePickedHuCodes.filter(Boolean))];

          if (linePickedHuCodes.length > 0) {
            // Despacho HU-Managed estricto: Descontar solo las HUs pickeadas y marcarlas a DESPACHADO
            const husToDispatch = await tx.handlingUnit.findMany({
              where: {
                codigo: { in: linePickedHuCodes },
                clienteId: fullOrder.clienteId,
                estadoHu: 'ACTIVO',
              },
              include: {
                lote: { include: { ubicacion: true } },
              },
            });

            for (const hu of husToDispatch) {
              const huQty = Number(hu.cantidad || hu.piezasPorCaja || 0);
              if (huQty <= 0) continue;

              // Descontar del LotInventory donde reside la HU (Staging)
              if (hu.lotId) {
                const stagingLot = await tx.lotInventory.findUnique({
                  where: { id: hu.lotId },
                  include: { ubicacion: true },
                });
                if (stagingLot) {
                  const toTake = Math.min(huQty, stagingLot.cantidadDisponible);
                  const reservedToDeduct = Math.min(toTake, stagingLot.cantidadReservada);

                  await tx.lotInventory.update({
                    where: { id: stagingLot.id },
                    data: {
                      cantidadDisponible: { decrement: toTake },
                      cantidadReservada: { decrement: reservedToDeduct },
                    },
                  });
                  totalDeductedForLine += toTake;
                }
              }

              // Marcar ÚNICAMENTE esta HU como DESPACHADO (nunca tocar HUs hermanas no surtidas)
              await tx.handlingUnit.update({
                where: { id: hu.id },
                data: { estadoHu: 'DESPACHADO' },
              });

              // Trazabilidad Kárdex oficial Giving Out
              await tx.inventoryMovement.create({
                data: {
                  tipoMovimiento: 'SALIDA_PEDIDO',
                  skuId: line.skuId,
                  clienteId: fullOrder.clienteId,
                  lotId: hu.lotId,
                  huId: hu.id,
                  fromLocationId: hu.lote?.ubicacionId || undefined,
                  toLocationId: null,
                  cantidad: huQty,
                  usuario: data.despachador,
                  motivo: `Despacho ${fullOrder.codigo} (HU ${hu.codigo}) → ${(fullOrder as any).endCustomer?.nombre || fullOrder.cliente.nombreComercial}`,
                  documentoOrigen: fullOrder.codigo,
                },
              });
            }
          } else {
            // Fallback para líneas legado sin HUs
            for (const alloc of allocations) {
              if (alloc.cantidad <= 0) continue;
              const lot = await tx.lotInventory.findUnique({
                where: { id: alloc.lotId },
                include: { ubicacion: true },
              });
              if (!lot) continue;

              const toTake = Math.min(alloc.cantidad, lot.cantidadDisponible);
              const reservedToDeduct = Math.min(toTake, lot.cantidadReservada);

              await tx.lotInventory.update({
                where: { id: lot.id },
                data: {
                  cantidadDisponible: { decrement: toTake },
                  cantidadReservada: { decrement: reservedToDeduct },
                },
              });
              totalDeductedForLine += toTake;

              await tx.inventoryMovement.create({
                data: {
                  tipoMovimiento: 'SALIDA_PEDIDO',
                  skuId: line.skuId,
                  clienteId: fullOrder.clienteId,
                  lotId: lot.id,
                  fromLocationId: lot.ubicacionId || undefined,
                  cantidad: toTake,
                  usuario: data.despachador,
                  motivo: `Despacho ${fullOrder.codigo} → ${(fullOrder as any).endCustomer?.nombre || fullOrder.cliente.nombreComercial}`,
                  documentoOrigen: fullOrder.codigo,
                },
              });
            }
          }

          await tx.salesOrderLine.update({
            where: { id: line.id },
            data: {
              cantidadAsignada: totalDeductedForLine,
              pickingCompletado: true,
              cantidadPickeada: line.cantidadPickeada || totalDeductedForLine,
            },
          });
        }

        const updatedOrder = await tx.salesOrder.update({
          where: { id: fullOrder.id },
          data: {
            estado: 'DESPACHADO',
            despachador: data.despachador,
            fechaDespacho: new Date(),
            vehiculoPlaca: data.vehiculoPlaca,
            estadoEntrega: 'EN_RUTA',
            tipoTransporte: data.tipoTransporte || 'DIRECTO',
            paqueteria: data.paqueteria,
            numeroGuia: data.numeroGuia,
            fletera: data.fletera,
            choferNombre: data.choferNombre,
            choferLicencia: data.choferLicencia,
            selloSeguridad: data.selloSeguridad,
            firmaDespachador: data.firmaDespachador,
            firmaChofer: data.firmaChofer,
            folioManifiesto,
          },
          include: { cliente: true, endCustomer: true, lineas: { include: { sku: true, lote: true } } },
        });

        await tx.auditLog.create({
          data: {
            usuario: data.despachador,
            accion: 'ORDEN_DESPACHADA',
            entidad: 'SalesOrder',
            entidadId: fullOrder.id,
            detalle: `Despacho de pedido ${fullOrder.codigo} completado bajo protocolo transaccional. Manifiesto: ${folioManifiesto}. Chofer: ${data.choferNombre || 'N/A'}. Placas: ${data.vehiculoPlaca || 'N/A'}.`,
          },
        });

        return updatedOrder;
      },
    );

    await this.prisma.dispatchTracking.create({
      data: {
        orderId: fullOrder.id,
        estado: 'SALIDA_ALMACEN',
        usuario: data.despachador,
        notas: data.notas || `Embarque despachado: Chofer ${data.choferNombre || 'N/A'}, Fletera ${data.fletera || data.paqueteria || 'N/A'}, Sello ${data.selloSeguridad || 'N/A'}`,
        firmaBase64: data.firmaChofer || data.firmaDespachador,
        nombreFirmante: data.choferNombre || data.despachador,
      },
    });

    await this.audit(data.despachador, 'DESPACHO_SALIDA', 'SalesOrder', fullOrder.id, `Despacho completado: Manifiesto ${folioManifiesto}, Placa ${data.vehiculoPlaca || 'N/A'}`);
    return { success: true, order, folioManifiesto };
  }

  @Get('orders/:id/manifest')
  @ApiOperation({ summary: 'Fase 6: Obtener datos completos del manifiesto de embarque y acuse de salida' })
  async getDispatchManifest(@Param('id') id: string) {
    const order = await this.prisma.salesOrder.findFirst({
      where: { OR: [{ id }, { codigo: id }] },
      include: {
        cliente: true,
        endCustomer: true,
        lineas: {
          include: {
            sku: true,
            lote: { include: { ubicacion: true } },
          },
        },
        trackingEvents: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!order) throw new HttpException('Orden no encontrada', HttpStatus.NOT_FOUND);

    const lotIdsToFetch: string[] = [];
    const huCodesToFetch: string[] = [];

    order.lineas.forEach(l => {
      if (l.cajaEscaneada) {
        l.cajaEscaneada.split(',').forEach((c: string) => { if (c.trim()) huCodesToFetch.push(c.trim()); });
      }
      if (l.asignacionesJson) {
        try {
          const parsed = typeof l.asignacionesJson === 'string' ? JSON.parse(l.asignacionesJson) : l.asignacionesJson;
          if (Array.isArray(parsed)) {
            parsed.forEach((a: any) => {
              if (a.lotId) lotIdsToFetch.push(a.lotId);
              if (a.huCodigo) huCodesToFetch.push(a.huCodigo);
              if (Array.isArray(a.cajasEscaneadas)) {
                a.cajasEscaneadas.forEach((c: string) => { if (c) huCodesToFetch.push(c); });
              }
            });
          }
        } catch {}
      }
    });

    const lotsMap = new Map<string, any>();
    if (lotIdsToFetch.length > 0) {
      const dbLots = await this.prisma.lotInventory.findMany({
        where: { id: { in: lotIdsToFetch } },
        include: { ubicacion: true },
      });
      dbLots.forEach(dl => lotsMap.set(dl.id, dl));
    }

    const husMap = new Map<string, any>();
    if (huCodesToFetch.length > 0) {
      const dbHus = await this.prisma.handlingUnit.findMany({
        where: { codigo: { in: [...new Set(huCodesToFetch)] } },
        include: { lote: { include: { ubicacion: true } } },
      });
      dbHus.forEach(h => husMap.set(h.codigo.toUpperCase(), h));
    }

    const isDispatched = order.estado === 'DESPACHADO' || order.estado === 'ENTREGADO';
    const lineasDesglose: any[] = [];
    let totalCajas = 0;
    let totalPiezas = 0;

    for (const l of order.lineas) {
      let asigs: any[] = [];
      if (l.asignacionesJson) {
        try {
          const parsed = typeof l.asignacionesJson === 'string' ? JSON.parse(l.asignacionesJson) : l.asignacionesJson;
          if (Array.isArray(parsed)) asigs = parsed;
        } catch {}
      }

      if (asigs && asigs.length > 0) {
        for (const a of asigs) {
          const dl = a.lotId ? lotsMap.get(a.lotId) : null;
          const qty = Number(a.cantidadPickeada) || Number(a.cantidad) || 0;
          const hus: string[] = Array.isArray(a.cajasEscaneadas) ? a.cajasEscaneadas : [];
          const boxesCount = hus.length > 0 ? hus.length : Math.max(1, Math.ceil(qty / (l.sku.capacidadEmpaque || 12)));
          totalCajas += boxesCount;
          totalPiezas += qty;

          const firstHuCode = hus[0] || (l.cajaEscaneada ? l.cajaEscaneada.split(',')[0]?.trim() : null);
          const matchedHu = firstHuCode ? husMap.get(firstHuCode.toUpperCase()) : null;
          const stagingUbi = a.stagingLocationCodigo ||
            (matchedHu?.lote?.ubicacion?.codigo?.startsWith('STG') ? matchedHu.lote.ubicacion.codigo : null) ||
            (matchedHu?.ubicacionActual?.startsWith('STG') ? matchedHu.ubicacionActual : null) ||
            (order.estado === 'CONSOLIDADO' || order.estado === 'DESPACHADO' ? 'STG-01' : null) ||
            'STG-01';

          lineasDesglose.push({
            lineaId: l.id,
            sku: l.sku.codigo,
            descripcion: l.sku.descripcion,
            cantidadSolicitada: l.cantidadSolicitada,
            cantidadDespachada: isDispatched ? qty : 0,
            cantidadPreparada: qty,
            lote: a.lote || dl?.lote || l.loteAsignado || 'N/A',
            caducidad: a.caducidad || dl?.fechaVencimiento || l.lote?.fechaVencimiento || null,
            ubicacion: a.ubicacionCodigo || dl?.ubicacion?.codigo || l.ubicacionAsignada || 'RACK',
            rackOrigen: a.ubicacionCodigo || dl?.ubicacion?.codigo || l.ubicacionAsignada || 'RACK',
            stagingUbicacion: stagingUbi,
            cajasEscaneadas: hus,
            huCodigo: hus.length > 0 ? hus.join(', ') : 'N/A',
            totalCajas: boxesCount,
            totalHus: boxesCount,
            totalBultos: boxesCount,
            totalPiezas: qty,
            uom: l.sku.uomBase || 'PZA',
          });
        }
      } else {
        const qty = l.cantidadPickeada || l.cantidadSolicitada || 0;
        totalPiezas += qty;
        totalCajas += 1;

        const firstHuCode = l.cajaEscaneada ? l.cajaEscaneada.split(',')[0]?.trim() : null;
        const matchedHu = firstHuCode ? husMap.get(firstHuCode.toUpperCase()) : null;
        const stagingUbi = (matchedHu?.lote?.ubicacion?.codigo?.startsWith('STG') ? matchedHu.lote.ubicacion.codigo : null) ||
          (matchedHu?.ubicacionActual?.startsWith('STG') ? matchedHu.ubicacionActual : null) ||
          (order.estado === 'CONSOLIDADO' || order.estado === 'DESPACHADO' ? 'STG-01' : null) ||
          'STG-01';

        lineasDesglose.push({
          lineaId: l.id,
          sku: l.sku.codigo,
          descripcion: l.sku.descripcion,
          cantidadSolicitada: l.cantidadSolicitada,
          cantidadDespachada: isDispatched ? qty : 0,
          cantidadPreparada: qty,
          lote: l.loteAsignado || l.lote?.lote || 'N/A',
          caducidad: l.lote?.fechaVencimiento || null,
          ubicacion: l.ubicacionAsignada || l.lote?.ubicacion?.codigo || 'RACK',
          rackOrigen: l.ubicacionAsignada || l.lote?.ubicacion?.codigo || 'RACK',
          stagingUbicacion: stagingUbi,
          cajasEscaneadas: l.cajaEscaneada ? l.cajaEscaneada.split(',').map((s: string) => s.trim()) : [],
          huCodigo: l.cajaEscaneada || 'N/A',
          totalCajas: 1,
          totalHus: 1,
          totalBultos: 1,
          totalPiezas: qty,
          uom: l.sku.uomBase || 'PZA',
        });
      }
    }

    const folio = isDispatched
      ? (order.folioManifiesto && !order.folioManifiesto.startsWith('PRE-') ? order.folioManifiesto : `MAN-${order.codigo}`)
      : `PRE-${order.codigo}`;

    return {
      success: true,
      folio,
      order,
      isDispatched,
      esPreliminar: !isDispatched,
      fechaEmbarque: order.fechaDespacho || null,
      totalBultos: totalCajas,        // Semántica física real de manejo: 1 bulto / HU / caja
      totalHus: totalCajas,           // Alias canónico de unidades de manejo
      totalCajas: totalCajas,         // Alias canónico
      totalPiezas: totalPiezas,       // Contenido real de piezas
      totalUnidades: totalPiezas,     // Alias de unidades de producto
      lineasDesglose,
    };
  }

  @Post('orders/:id/confirm-delivery')
  @ApiOperation({ summary: 'Confirmar entrega al cliente final' })
  async confirmDelivery(@Param('id') id: string, @Body() data: { usuario: string; nombreReceptor: string; notasEntrega?: string; firmaBase64?: string }) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

    return await this.prisma.$transaction(
      async (tx) => {
        // 1. Configurar lock_timeout para evitar bloqueos indefinidos
        try {
          if (typeof tx.$executeRawUnsafe === 'function') {
            await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '5000ms'");
          }
        } catch {
          // Fallback para entornos que no sean Postgres directo
        }

        // 2. Resolver id canónico de la orden
        let orderId = id;
        if (!isUuid) {
          const found = await tx.salesOrder.findFirst({
            where: { OR: [{ id }, { codigo: id }] },
            select: { id: true },
          });
          if (!found) throw new HttpException('Orden no encontrada', HttpStatus.NOT_FOUND);
          orderId = found.id;
        }

        // 3. Bloqueo pesimista con FOR UPDATE en la fila de SalesOrder (concurrencia atómica)
        try {
          if (typeof tx.$queryRaw === 'function') {
            await tx.$queryRaw`SELECT id FROM "SalesOrder" WHERE id = ${orderId} FOR UPDATE`;
          } else if (typeof tx.$queryRawUnsafe === 'function') {
            await tx.$queryRawUnsafe('SELECT id FROM "SalesOrder" WHERE id = $1 FOR UPDATE', orderId);
          }
        } catch {
          // Fallback seguro si el motor mock o DB no soporta FOR UPDATE
        }

        // 4. Releer el estado canónico fresco de la orden dentro de la transacción
        const order = await tx.salesOrder.findUnique({
          where: { id: orderId },
          include: { cliente: true, endCustomer: true },
        });
        if (!order) throw new HttpException('Orden no encontrada', HttpStatus.NOT_FOUND);

        // 5. Idempotencia backend real: si ya fue entregada, retornar sin mutar absolutamente nada
        const isAlreadyDelivered = order.estado === 'ENTREGADO' || order.estadoEntrega === 'ENTREGADO';
        if (isAlreadyDelivered) {
          return {
            success: true,
            alreadyDelivered: true,
            message: `La orden ${order.codigo} ya fue entregada previamente el ${order.fechaEntrega ? new Date(order.fechaEntrega).toISOString() : 'fecha no registrada'}. Operación idempotente: no se generaron cambios ni eventos duplicados.`,
            order,
          };
        }

        // 6. Validación de estado previo obligatorio
        // Solo se permite confirmar entrega si el estado es DESPACHADO y estadoEntrega es EN_RUTA (o nulo por compatibilidad)
        const isEligible = order.estado === 'DESPACHADO' && (!order.estadoEntrega || order.estadoEntrega === 'EN_RUTA');
        if (!isEligible) {
          throw new HttpException(
            {
              statusCode: HttpStatus.CONFLICT,
              error: 'ESTADO_NO_APTO_PARA_ENTREGA',
              message: `No se puede confirmar la entrega de la orden ${order.codigo}. Su estado actual es "${order.estado}" (estadoEntrega: "${order.estadoEntrega || 'N/A'}"). Solo se permite confirmar entrega para órdenes en estado "DESPACHADO" con entrega "EN_RUTA".`,
              estadoActual: order.estado,
              estadoEntregaActual: order.estadoEntrega,
            },
            HttpStatus.CONFLICT,
          );
        }

        // 7. Validación de datos obligatorios de recepción
        if (!data.nombreReceptor || !data.nombreReceptor.trim()) {
          throw new HttpException('El nombre de la persona que recibe es obligatorio.', HttpStatus.BAD_REQUEST);
        }

        // 8. Inmutabilidad y actualización atómica de SalesOrder
        const updated = await tx.salesOrder.update({
          where: { id: order.id },
          data: {
            estado: 'ENTREGADO',
            estadoEntrega: 'ENTREGADO',
            fechaEntrega: new Date(),
            nombreReceptor: data.nombreReceptor.trim(),
            notasEntrega: data.notasEntrega?.trim() || null,
            firmaReceptor: data.firmaBase64 || null,
          },
          include: { cliente: true, endCustomer: true },
        });

        // 9. Crear exactamente un DispatchTracking en la misma transacción
        await tx.dispatchTracking.create({
          data: {
            orderId: order.id,
            estado: 'ENTREGADO',
            usuario: data.usuario || 'admin',
            notas: `Recibió: ${data.nombreReceptor.trim()}${data.notasEntrega?.trim() ? ` — ${data.notasEntrega.trim()}` : ''}`,
            nombreFirmante: data.nombreReceptor.trim(),
            firmaBase64: data.firmaBase64 || null,
          },
        });

        // 10. Crear exactamente un AuditLog en la misma transacción
        await this.audit(
          data.usuario || 'admin',
          'ENTREGA_CONFIRMADA',
          'SalesOrder',
          order.id,
          `${order.codigo} entregado a ${data.nombreReceptor.trim()} en ${(order as any).endCustomer?.nombre || 'destino'}`,
          tx,
        );

        return {
          success: true,
          alreadyDelivered: false,
          message: `Entrega de la orden ${order.codigo} confirmada exitosamente.`,
          order: updated,
        };
      },
      { timeout: 10000 },
    );
  }

  // ============ MOVEMENTS (manual) ============
  @Post('movements')
  @ApiOperation({ summary: 'Registrar movimiento manual (trasiego, ajuste)' })
  async createMovement(@Body() data: any) {
    const movement = await this.prisma.inventoryMovement.create({
      data,
      include: { sku: true, fromLocation: true, toLocation: true },
    });

    if ((data.tipoMovimiento === 'TRASIEGO' || data.tipoMovimiento === 'TRANSFERENCIA') && data.lotId && data.toLocationId) {
      await this.prisma.lotInventory.update({
        where: { id: data.lotId },
        data: { ubicacionId: data.toLocationId },
      });
    }

    await this.audit(data.usuario, data.tipoMovimiento, 'InventoryMovement', movement.id, `Cant: ${data.cantidad}`);
    return movement;
  }

  // ============ TRACEABILITY ============
  @Get('traceability')
  @ApiOperation({ summary: 'Consultar trazabilidad' })
  async getTraceability(@Query('skuId') skuId?: string, @Query('clienteId') clienteId?: string) {
    const where: any = {};
    if (skuId) where.skuId = skuId;
    if (clienteId) where.clienteId = clienteId;

    return this.prisma.traceabilityLink.findMany({
      where,
      include: {
        sku: { select: { codigo: true, descripcion: true } },
        lote: { select: { lote: true, fechaVencimiento: true, proveedorNombre: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ============ CYCLE COUNTS ============
  @Get('cycle-counts')
  @ApiOperation({ summary: 'Listar conteos cíclicos' })
  async getCycleCounts(@Query('estado') estado?: string) {
    const where: any = {};
    if (estado) where.estado = estado;
    const counts = await this.prisma.cycleCount.findMany({
      where,
      include: { lineas: { include: { sku: { select: { codigo: true, descripcion: true } } } } },
      orderBy: { fechaProgramada: 'desc' },
    });

    // Enriquecer en memoria cualquier línea sin metadata de depositante a partir del inventario histórico/canónico (Read-Only)
    for (const count of counts) {
      for (const line of count.lineas) {
        let parsed: any = null;
        try {
          if (line.notas && typeof line.notas === 'string' && line.notas.startsWith('{')) {
            parsed = JSON.parse(line.notas);
          }
        } catch { }

        if (!parsed || !parsed.clienteNombre) {
          const lotWhere: any = { skuId: line.skuId };
          if (line.ubicacionId) lotWhere.ubicacionId = line.ubicacionId;
          if (line.lote) lotWhere.lote = line.lote;

          const lot = await this.prisma.lotInventory.findFirst({
            where: lotWhere,
            include: { cliente: true, ubicacion: true },
          });

          if (lot) {
            const clienteNombre = lot.cliente?.nombreComercial || lot.cliente?.razonSocial || null;
            const clienteId = lot.clienteId || null;
            const ubicacionCodigo = lot.ubicacion?.codigo || null;

            const enrichedNotas = {
              ...(parsed || {}),
              clienteNombre: clienteNombre || parsed?.clienteNombre || null,
              clienteId: clienteId || parsed?.clienteId || null,
              ubicacionCodigo: ubicacionCodigo || parsed?.ubicacionCodigo || null,
            };

            (line as any).notas = JSON.stringify(enrichedNotas);
            (line as any).clienteNombre = clienteNombre;
          }
        } else {
          (line as any).clienteNombre = parsed.clienteNombre;
        }
      }
    }

    return counts;
  }

  @Post('cycle-counts')
  @ApiOperation({ summary: 'Crear conteo cíclico con snapshot granular inequívoco' })
  async createCycleCount(@Body() data: any) {
    const lotWhere: any = {};

    if (data.almacenId) {
      lotWhere.ubicacion = { ...(lotWhere.ubicacion || {}), almacenId: data.almacenId };
    }

    if (data.tipo === 'ZONA' && data.zonaId) {
      lotWhere.ubicacion = { ...(lotWhere.ubicacion || {}), zonaId: data.zonaId };
    } else if (data.tipo === 'UBICACION' && data.ubicacionId) {
      lotWhere.ubicacionId = data.ubicacionId;
    } else if (data.tipo === 'SKU' && data.skuId) {
      lotWhere.skuId = data.skuId;
    }

    const lots = await this.prisma.lotInventory.findMany({
      where: lotWhere,
      include: {
        sku: true,
        cliente: true,
        ubicacion: { include: { zona: true } },
        handlingUnits: { where: { estadoHu: 'ACTIVO' } },
      },
    });

    // Agrupación granular por SKU + UBICACION + LOTE (sin colapsar ubicaciones distintas)
    const snapshotMap = new Map<string, {
      skuId: string;
      ubicacionId: string | null;
      ubicacionCodigo: string | null;
      lote: string | null;
      lots: typeof lots;
      totalFisico: number;
      totalDisponible: number;
      totalReservado: number;
      totalBloqueado: number;
      hus: any[];
      clientes: Set<string>;
      clientesNombres: Set<string>;
    }>();

    for (const lot of lots) {
      // Si el conteo no es explícito de una ubicación específica, excluir ubicaciones de tránsito o no conformes
      if (data.tipo !== 'UBICACION') {
        const locRole = classifyLocationOperationalRole(lot.ubicacion);
        if (locRole.esTransitoInterno || locRole.esNoConforme) {
          continue; // No mezclar andenes, mermas o devoluciones en racks comerciales
        }
      }

      const cleanLote = lot.lote ? lot.lote.trim() : null;
      const key = `${lot.skuId}__${lot.ubicacionId || 'SIN_UBI'}__${cleanLote || 'SIN_LOTE'}`;

      if (!snapshotMap.has(key)) {
        snapshotMap.set(key, {
          skuId: lot.skuId,
          ubicacionId: lot.ubicacionId,
          ubicacionCodigo: lot.ubicacion?.codigo || null,
          lote: cleanLote,
          lots: [],
          totalFisico: 0,
          totalDisponible: 0,
          totalReservado: 0,
          totalBloqueado: 0,
          hus: [],
          clientes: new Set(),
          clientesNombres: new Set(),
        });
      }

      const item = snapshotMap.get(key)!;
      item.lots.push(lot);
      item.totalFisico += (lot.cantidadDisponible + lot.cantidadReservada + lot.cantidadBloqueada);
      item.totalDisponible += lot.cantidadDisponible;
      item.totalReservado += lot.cantidadReservada;
      item.totalBloqueado += lot.cantidadBloqueada;
      if (lot.clienteId) item.clientes.add(lot.clienteId);
      if (lot.cliente?.nombreComercial) item.clientesNombres.add(lot.cliente.nombreComercial);
      if (lot.handlingUnits && lot.handlingUnits.length > 0) {
        item.hus.push(...lot.handlingUnits);
      }
    }

    return withConcurrencyRetry(async () => {
      const yearPrefixCC = `CC-${new Date().getFullYear()}-`;
      const existingCCs = await this.prisma.cycleCount.findMany({
        where: { codigo: { startsWith: yearPrefixCC } },
        select: { codigo: true },
      });
      let maxCCSeq = 0;
      for (const c of existingCCs) {
        const num = parseInt(c.codigo.replace(yearPrefixCC, ''), 10);
        if (!isNaN(num) && num > maxCCSeq) maxCCSeq = num;
      }
      const codigo = `${yearPrefixCC}${String(maxCCSeq + 1).padStart(3, '0')}`;

      return this.prisma.cycleCount.create({
        data: {
          codigo,
          nombre: data.nombre,
          tipo: data.tipo || 'SKU',
          fechaProgramada: new Date(data.fechaProgramada),
          almacenId: data.almacenId,
          asignadoA: data.asignadoA,
          notas: data.notas,
          lineas: {
            create: Array.from(snapshotMap.values()).map(group => {
              let bloqueoInicial: string | null = null;
              if (group.clientes.size > 1) {
                bloqueoInicial = 'SALDO_AMBIGUO_MULTI_CLIENTE';
              } else if (group.lots.length > 1) {
                bloqueoInicial = 'SALDO_AMBIGUO_MULTI_LOTE';
              } else if (group.hus.length > 0) {
                bloqueoInicial = 'REQUIERE_CONCILIACION_HU';
              } else if (group.totalReservado > 0) {
                bloqueoInicial = 'BLOQUEADO_POR_PROCESO';
              }

              const notasObj = {
                ubicacionCodigo: group.ubicacionCodigo,
                clienteId: Array.from(group.clientes)[0] || null,
                clienteNombre: Array.from(group.clientesNombres)[0] || null,
                disponible: group.totalDisponible,
                reservado: group.totalReservado,
                bloqueado: group.totalBloqueado,
                tieneHUs: group.hus.length > 0,
                huCount: group.hus.length,
                huCodigos: group.hus.map(h => h.codigo),
                bloqueoInicial,
              };

              return {
                skuId: group.skuId,
                ubicacionId: group.ubicacionId,
                lote: group.lote,
                cantidadSistema: group.totalFisico, // Magnitud física canónica esperada
                notas: JSON.stringify(notasObj),
              };
            }),
          },
        },
        include: { lineas: { include: { sku: { select: { codigo: true, descripcion: true } } } } },
      });
    }, { contextName: 'createCycleCount', maxRetries: 5 });
  }

  @Put('cycle-counts/:id/count')
  @ApiOperation({ summary: 'Registrar conteo físico de líneas' })
  async registerCycleCount(@Param('id') id: string, @Body() data: any) {
    const cc = await this.prisma.cycleCount.findUnique({ where: { id } });
    if (!cc) throw new HttpException('Conteo no encontrado', HttpStatus.NOT_FOUND);

    if (cc.estado === 'COMPLETADO' || cc.estado === 'CERRADO') {
      throw new HttpException('Operación rechazada: El conteo ya fue COMPLETADO y es inmutable.', HttpStatus.CONFLICT);
    }
    if (cc.estado === 'CANCELADO') {
      throw new HttpException('Operación rechazada: El conteo está CANCELADO.', HttpStatus.CONFLICT);
    }

    for (const line of data.lineas) {
      const disc = line.cantidadFisica !== null && line.cantidadFisica !== undefined
        ? (Number(line.cantidadFisica) - (line.cantidadSistema || 0))
        : null;

      await this.prisma.cycleCountLine.update({
        where: { id: line.id },
        data: {
          cantidadFisica: line.cantidadFisica !== null && line.cantidadFisica !== undefined ? Number(line.cantidadFisica) : null,
          discrepancia: disc,
          porcentajeDisc: (disc !== null && line.cantidadSistema) ? (disc / line.cantidadSistema) * 100 : 0,
          contadoPor: data.usuario || 'Operador de Inventario',
          contadoEn: new Date(),
          estado: 'CONTADO',
        },
      });
    }

    await this.prisma.cycleCount.update({
      where: { id },
      data: { estado: 'EN_PROGRESO', fechaInicio: cc.fechaInicio || new Date() },
    });

    return { message: 'Conteo físico registrado exitosamente', id };
  }

  @Post('cycle-counts/:id/reconcile')
  @ApiOperation({ summary: 'Conciliar conteo cíclico y ajustar inventario real bajo protocolo transaccional (Etapa 5A.1)' })
  async reconcileCycleCount(@Param('id') id: string, @Body() data: any, @Headers('authorization') authHeader?: string) {
    return this.finalizeCycleCount(id, data, authHeader);
  }

  @Post('cycle-counts/:id/finalize')
  @ApiOperation({ summary: 'Finalizar conteo y ajustar inventario real bajo protocolo transaccional seguro' })
  async finalizeCycleCount(@Param('id') id: string, @Body() data: any, @Headers('authorization') authHeader?: string) {
    const cc = await this.prisma.cycleCount.findUnique({
      where: { id },
      include: { lineas: { include: { sku: true } } },
    });
    if (!cc) throw new HttpException('Conteo no encontrado', HttpStatus.NOT_FOUND);

    // 1. Candado de Inmutabilidad e Idempotencia
    if (cc.estado === 'COMPLETADO' || cc.estado === 'CERRADO') {
      throw new HttpException('Operación rechazada: El conteo ya está COMPLETADO e inmutable. No se permite re-finalización ni doble ajuste.', HttpStatus.CONFLICT);
    }
    if (cc.estado === 'CANCELADO') {
      throw new HttpException('Operación rechazada: El conteo está CANCELADO.', HttpStatus.CONFLICT);
    }

    // 2. Control de Permisos / Rol Reutilizable
    let userRole = '';
    let userEmail = data.usuario || '';
    if (authHeader) {
      try {
        const token = authHeader.replace('Bearer ', '');
        const decoded: any = jwt.verify(token, JWT_SECRET);
        userRole = decoded.rol || '';
        userEmail = decoded.email || userEmail;
      } catch (e) {}
    }
    if (userRole && !['Super Admin', 'Administrador', 'Supervisor', 'DIRECTOR', 'ADMIN', 'SUPER_ADMIN'].some(r => r.toLowerCase() === userRole.toLowerCase())) {
      throw new HttpException(`Permiso denegado: El rol "${userRole}" no tiene autorización para finalizar y ajustar inventario. Requiere Supervisor o Administrador.`, HttpStatus.FORBIDDEN);
    }

    // 3. Verificación de completitud de conteo físico
    const uncountedLines = cc.lineas.filter(l => l.cantidadFisica === null || l.cantidadFisica === undefined);
    if (uncountedLines.length > 0) {
      throw new HttpException(`Operación rechazada: Existen ${uncountedLines.length} línea(s) pendientes de conteo físico.`, HttpStatus.BAD_REQUEST);
    }

    // 4. Identificar ubicaciones afectadas para protocolo de concurrencia
    const affectedLocations = cc.lineas.map(l => l.ubicacionId).filter(Boolean) as string[];
    const locationIds = [...new Set(affectedLocations)];

    return await this.putawayEngine.executePhysicalMovementProtocol(
      this.prisma,
      {
        locationIds,
        opName: 'finalizeCycleCount',
      },
      async (tx) => {
        // Evaluación exhaustiva línea por línea
        const evaluations: {
          line: typeof cc.lineas[0];
          diff: number;
          status: 'COINCIDE' | 'DIFERENCIA_AJUSTABLE' | 'REQUIERE_CONCILIACION_HU' | 'BLOQUEADO_POR_PROCESO' | 'SALDO_AMBIGUO' | 'SOBRANTE_NO_IDENTIFICADO';
          targetLot: any | null;
          blockReason?: string;
        }[] = [];

        for (const line of cc.lineas) {
          const diff = Number(line.cantidadFisica) - Number(line.cantidadSistema);

          if (diff === 0) {
            evaluations.push({ line, diff: 0, status: 'COINCIDE', targetLot: null });
            continue;
          }

          // A. Detección de HandlingUnits (Blindaje HU-managed)
          const activeHUs = await tx.handlingUnit.findMany({
            where: {
              ubicacionActual: line.ubicacionId || '',
              estadoHu: 'ACTIVO',
              OR: [
                { skuCodigo: line.sku?.codigo },
                { lote: { skuId: line.skuId } },
              ],
            },
          });

          if (activeHUs.length > 0) {
            evaluations.push({
              line,
              diff,
              status: 'REQUIERE_CONCILIACION_HU',
              targetLot: null,
              blockReason: `Línea gestionada por ${activeHUs.length} Unidad(es) de Manejo (HUs: ${activeHUs.map(h => h.codigo).join(', ')}). Prohibido ajuste automático escalar.`,
            });
            continue;
          }

          // B. Búsqueda de lote objetivo inequívoco (Sin lots[0])
          const candidateLots = await tx.lotInventory.findMany({
            where: {
              skuId: line.skuId,
              ubicacionId: line.ubicacionId,
              ...(line.lote ? { lote: line.lote } : {}),
            },
            include: {
              sku: true,
              cliente: true,
              ubicacion: { include: { zona: true } },
            },
          });

          if (candidateLots.length === 0) {
            if (diff > 0) {
              evaluations.push({
                line,
                diff,
                status: 'SOBRANTE_NO_IDENTIFICADO',
                targetLot: null,
                blockReason: `Sobrante físico (+${diff} pza) detectado sin lote ni cliente registrado en esta ubicación. Prohibido crear inventario artificial sin alta formal.`,
              });
            } else {
              evaluations.push({
                line,
                diff,
                status: 'SALDO_AMBIGUO',
                targetLot: null,
                blockReason: `Faltante físico (${diff} pza) en ubicación sin lote registrado.`,
              });
            }
            continue;
          }

          if (candidateLots.length > 1) {
            evaluations.push({
              line,
              diff,
              status: 'SALDO_AMBIGUO',
              targetLot: null,
              blockReason: `Existen ${candidateLots.length} lotes/saldos candidatos en la misma ubicación. Prohibido ajuste ciego.`,
            });
            continue;
          }

          const targetLot = candidateLots[0];

          // C. Validación de Reservas y Pedidos Activos
          if (targetLot.cantidadReservada > 0) {
            evaluations.push({
              line,
              diff,
              status: 'BLOQUEADO_POR_PROCESO',
              targetLot: null,
              blockReason: `Lote cuenta con ${targetLot.cantidadReservada} piezas reservadas para pedidos activos.`,
            });
            continue;
          }

          const activePickingLines = await tx.salesOrderLine.findMany({
            where: {
              lotId: targetLot.id,
              pickingCompletado: false,
              orden: { estado: { in: ['SOLICITADO', 'APROBADO', 'EN_PICKING'] } },
            },
          });

          if (activePickingLines.length > 0) {
            evaluations.push({
              line,
              diff,
              status: 'BLOQUEADO_POR_PROCESO',
              targetLot: null,
              blockReason: `Lote comprometido en picking activo (${activePickingLines.length} ordenes).`,
            });
            continue;
          }

          // D. Validación de Ubicación y Estado de Calidad
          const locRole = classifyLocationOperationalRole(targetLot.ubicacion);
          if (locRole.esTransitoInterno) {
            evaluations.push({
              line,
              diff,
              status: 'BLOQUEADO_POR_PROCESO',
              targetLot: null,
              blockReason: `Ubicación en andén/recepción (${targetLot.ubicacion?.codigo}). Requiere Putaway antes de ajuste comercial.`,
            });
            continue;
          }

          if (locRole.esNoConforme || targetLot.estadoCalidad !== 'LIBERADO') {
            evaluations.push({
              line,
              diff,
              status: 'BLOQUEADO_POR_PROCESO',
              targetLot: null,
              blockReason: `Lote en condición no liberada (${targetLot.estadoCalidad} / ${locRole.badgeTexto}). Prohibido ajuste comercial.`,
            });
            continue;
          }

          if (targetLot.fechaVencimiento && targetLot.fechaVencimiento < new Date()) {
            evaluations.push({
              line,
              diff,
              status: 'BLOQUEADO_POR_PROCESO',
              targetLot: null,
              blockReason: `Lote vencido (${new Date(targetLot.fechaVencimiento).toLocaleDateString('es-MX')}). Prohibido reactivar como stock liberado.`,
            });
            continue;
          }

          // E. Validación de no-negatividad
          if (diff < 0 && (targetLot.cantidadDisponible + diff < 0)) {
            evaluations.push({
              line,
              diff,
              status: 'SALDO_AMBIGUO',
              targetLot: null,
              blockReason: `Faltante (${diff} pza) excede el saldo disponible actual (${targetLot.cantidadDisponible} pza).`,
            });
            continue;
          }

          // Línea 100% elegible para ajuste seguro
          evaluations.push({
            line,
            diff,
            status: 'DIFERENCIA_AJUSTABLE',
            targetLot,
          });
        }

        // 5. Criterio de Decisión: Si existen líneas bloqueantes, NO tocar inventario
        const blockedItems = evaluations.filter(e => e.status !== 'COINCIDE' && e.status !== 'DIFERENCIA_AJUSTABLE');

        if (blockedItems.length > 0) {
          // Persistir notas de diagnóstico en las líneas para visualización en UI
          for (const item of evaluations) {
            let notasPrevias: any = {};
            try { notasPrevias = JSON.parse(item.line.notas || '{}'); } catch (e) {}
            notasPrevias.estadoConciliacion = item.status;
            notasPrevias.motivoBloqueo = item.blockReason || null;
            await tx.cycleCountLine.update({
              where: { id: item.line.id },
              data: { notas: JSON.stringify(notasPrevias) },
            });
          }

          return {
            success: false,
            requiresReview: true,
            codigo: cc.codigo,
            estado: 'EN_PROGRESO',
            message: `Ajuste bloqueado preventivamente: Existen ${blockedItems.length} línea(s) con incidencias que impiden el ajuste automático (HUs activas, reservas o ambigüedad). El inventario NO fue modificado.`,
            lineasBloqueadas: blockedItems.map(b => ({
              lineId: b.line.id,
              sku: b.line.sku?.codigo,
              ubicacionId: b.line.ubicacionId,
              status: b.status,
              motivo: b.blockReason,
            })),
          };
        }

        // 6. Aplicar ajustes de forma atómica (todas las líneas son COINCIDE o DIFERENCIA_AJUSTABLE)
        let adjustmentsCount = 0;
        for (const item of evaluations) {
          if (item.status === 'COINCIDE') continue;
          const { line, diff, targetLot } = item;

          const newQty = targetLot.cantidadDisponible + diff;
          await tx.lotInventory.update({
            where: { id: targetLot.id },
            data: { cantidadDisponible: newQty },
          });

          await tx.inventoryMovement.create({
            data: {
              tipoMovimiento: diff > 0 ? 'AJUSTE_ENTRADA' : 'AJUSTE_SALIDA',
              almacenId: cc.almacenId,
              skuId: line.skuId,
              clienteId: targetLot.clienteId,
              lotId: targetLot.id,
              fromLocationId: diff < 0 ? targetLot.ubicacionId : null,
              toLocationId: diff > 0 ? targetLot.ubicacionId : null,
              cantidad: Math.abs(diff),
              usuario: userEmail || 'Supervisor de Inventario',
              motivo: `Ajuste por Conteo Cíclico ${cc.codigo} — ${line.sku?.descripcion || ''} (${diff > 0 ? '+' : ''}${diff} pza)`,
              documentoOrigen: cc.codigo,
            },
          });
          adjustmentsCount++;
        }

        // Marcar conteo y líneas como COMPLETADO / CONCILIADO
        await tx.cycleCount.update({
          where: { id },
          data: {
            estado: 'COMPLETADO',
            fechaCierre: new Date(),
          },
        });

        await tx.cycleCountLine.updateMany({
          where: { cycleCountId: id },
          data: { estado: 'CONCILIADO' },
        });

        await tx.auditLog.create({
          data: {
            usuario: userEmail || 'Supervisor de Inventario',
            accion: 'CONTEO_CICLICO_FINALIZADO',
            entidad: 'CycleCount',
            entidadId: cc.id,
            detalle: `Conteo ${cc.codigo} finalizado y conciliado con ${adjustmentsCount} ajuste(s) seguros aplicados. Inventario inmutable bajo protocolo transaccional.`,
          },
        });

        return {
          success: true,
          requiresReview: false,
          codigo: cc.codigo,
          estado: 'COMPLETADO',
          adjustments: adjustmentsCount,
          message: `Conteo ${cc.codigo} finalizado exitosamente. ${adjustmentsCount} ajuste(s) aplicados al inventario real.`,
        };
      },
    );
  }

  @Delete('cycle-counts/:id')
  @ApiOperation({ summary: 'Cancelar conteo cíclico programado (Inmutable si completado/en proceso)' })
  async deleteCycleCount(@Param('id') id: string, @Body() body?: any) {
    const cc = await this.prisma.cycleCount.findUnique({
      where: { id },
      include: { lineas: true },
    });
    if (!cc) throw new HttpException('Conteo no encontrado', HttpStatus.NOT_FOUND);

    if (cc.estado === 'COMPLETADO' || cc.estado === 'CERRADO') {
      throw new HttpException('Operación rechazada: Un conteo COMPLETADO o CERRADO es inmutable y no puede eliminarse ni cancelarse.', HttpStatus.FORBIDDEN);
    }

    if (cc.estado === 'EN_PROGRESO') {
      throw new HttpException('Operación rechazada: Un conteo EN_PROGRESO no puede eliminarse físicamente. Debe completarse la revisión o conciliarse.', HttpStatus.CONFLICT);
    }

    if (cc.estado === 'CANCELADO') {
      throw new HttpException('El conteo ya se encuentra CANCELADO.', HttpStatus.CONFLICT);
    }

    // Si está en PROGRAMADO, verificar si ya tiene capturas físicas
    const hasCounts = cc.lineas.some(l => l.cantidadFisica !== null || l.estado === 'CONTADO');
    if (hasCounts) {
      throw new HttpException('Operación rechazada: El conteo ya cuenta con capturas físicas registradas y no puede eliminarse físicamente.', HttpStatus.CONFLICT);
    }

    // Cancelación lógica segura y auditada (CERO DELETE físico)
    await this.prisma.cycleCount.update({
      where: { id },
      data: {
        estado: 'CANCELADO',
        notas: (cc.notas ? cc.notas + ' | ' : '') + `Cancelado el ${new Date().toISOString()} por usuario`,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        usuario: body?.usuario || 'Usuario Operativo',
        accion: 'CANCELAR_CONTEO_CICLICO',
        entidad: 'CycleCount',
        entidadId: cc.id,
        detalle: `Conteo ${cc.codigo} cancelado preventivamente antes de inicio de capturas. Registro histórico preservado.`,
      },
    });

    return { success: true, message: `Conteo ${cc.codigo} cancelado exitosamente. Registro histórico preservado.`, id };
  }


  @Get('dashboard/stats')
  @ApiOperation({ summary: 'Estadísticas para dashboard' })
  async getDashboardStats() {
    const [totalSkus, totalClients, totalLots, totalOrders, pendingOrders, activeAlerts, recentMovements] = await Promise.all([
      this.prisma.skuMaster.count({ where: { activo: true } }),
      this.prisma.client.count({ where: { activo: true } }),
      this.prisma.lotInventory.count({ where: { cantidadDisponible: { gt: 0 } } }),
      this.prisma.salesOrder.count(),
      this.prisma.salesOrder.count({ where: { estado: { in: ['SOLICITADO', 'PENDIENTE_APROBACION', 'APROBADO', 'EN_PICKING'] } } }),
      this.prisma.alert.count({ where: { resuelta: false } }),
      this.prisma.inventoryMovement.findMany({
        orderBy: { fechaHora: 'desc' },
        take: 10,
        include: {
          sku: { select: { descripcion: true, codigo: true } },
          fromLocation: { select: { codigo: true } },
          toLocation: { select: { codigo: true } },
        },
      }),
    ]);

    const [totalUnidades, pendingApprovals, totalEndCustomers] = await Promise.all([
      this.prisma.lotInventory.aggregate({ _sum: { cantidadDisponible: true }, where: { cantidadDisponible: { gt: 0 } } }),
      this.prisma.salesOrder.count({ where: { estado: { in: ['SOLICITADO', 'PENDIENTE_APROBACION'] } } }),
      this.prisma.endCustomer.count({ where: { activo: true } }),
    ]);

    return {
      totalSkus, totalClients, totalLots, totalOrders, pendingOrders, activeAlerts,
      totalUnidades: totalUnidades._sum.cantidadDisponible || 0,
      pendingApprovals, totalEndCustomers,
      recentMovements,
    };
  }

  private async ensureVirtualMermaLocation(client: any = this.prisma) {
    const devLoc = await client.location.findFirst({
      where: { OR: [{ codigo: 'DEV-01' }, { codigo: 'NC-MERMA-01' }] },
    });
    if (devLoc) return devLoc;

    let zone = await client.zone.findFirst({
      where: { OR: [{ codigo: 'DEVOLUCION' }, { tipoZona: 'CUARENTENA' }] },
    });

    if (!zone) {
      const wh = await client.warehouse.findFirst();
      if (!wh) throw new Error('No se encontró ningún almacén en el sistema');
      zone = await client.zone.create({
        data: {
          codigo: 'DEVOLUCION',
          nombre: 'Zona de Devoluciones y Merma',
          almacenId: wh.id,
          tipoZona: 'CUARENTENA',
        },
      });
    }

    return client.location.create({
      data: {
        codigo: 'DEV-01',
        almacenId: zone.almacenId,
        zonaId: zone.id,
        pasillo: 'DEV',
        rack: '01',
        nivel: 'P',
        posicion: '01',
        tipoUbicacion: 'DEVOLUCION',
        estado: 'LIBRE',
      },
    });
  }
}

