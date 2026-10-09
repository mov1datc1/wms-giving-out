import { Controller, Get, Post, Put, Patch, Delete, Param, Query, Body, Headers, HttpException, HttpStatus, UseInterceptors, UploadedFile, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBody, ApiConsumes, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import * as XLSX from 'xlsx';
import * as jwt from 'jsonwebtoken';
import { PrismaService } from '../../prisma.service';
import { withConcurrencyRetry } from '../../common/concurrency.util';

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

@ApiTags('Operations')
@Controller('api')
export class OperationsController {
  constructor(private prisma: PrismaService) {}

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
    summary: 'Obtener sugerencias inteligentes de alojamiento a racks (Fase 4)',
    description: 'Valida candado de etiquetas colocadas, calcula ubicaciones óptimas según giro (Alimentos FEFO vs Textil FIFO) y disponibilidad física en racks.',
  })
  @ApiParam({ name: 'id', description: 'ID de la recepción previa' })
  async getPutawaySuggestions(@Param('id') receiptId: string) {
    const receipt = await this.prisma.receipt.findFirst({
      where: {
        OR: [
          { id: receiptId },
          { codigo: receiptId },
        ],
      },
      include: {
        cliente: true,
        lineas: { include: { sku: true } },
        handlingUnits: {
          where: { estadoHu: 'ACTIVO' },
          include: { lote: true },
          orderBy: { codigo: 'asc' },
        },
      },
    });

    if (!receipt) {
      throw new HttpException('Previo de recibo no encontrado', HttpStatus.NOT_FOUND);
    }

    const canProceed = receipt.etiquetasEstado === 'COLOCADAS';
    const lockMessage = !canProceed
      ? (receipt.etiquetasEstado === 'IMPRESAS'
          ? 'Las etiquetas Giving Out ya están impresas pero aún no se ha confirmado su pegado físico en las cajas/tarimas. Confirma la colocación antes de trasladar a racks.'
          : 'Las etiquetas Giving Out aún no han sido impresas ni colocadas. Debe completarse la Fase 3 (Doble Etiquetado) antes de iniciar el alojamiento.')
      : null;

    const clientGiro = String(receipt.cliente?.giro || '').toUpperCase().trim();
    const esAlimentos = clientGiro === 'COMIDA' || clientGiro === 'FARMACEUTICO' || Boolean(receipt.cliente?.requiereCaducidad);
    const esRopa = clientGiro === 'ROPA' || clientGiro === 'TEXTIL';

    // Obtener todas las ubicaciones de estantería/racks del almacén con su zona
    const allLocations = await this.prisma.location.findMany({
      where: {
        tipoUbicacion: 'ESTANTERIA',
      },
      include: {
        zona: true,
      },
      orderBy: [
        { pasillo: 'asc' },
        { rack: 'asc' },
        { nivel: 'asc' },
      ],
    });

    // Separar ubicaciones por zona lógica del almacén
    const alimentosLocations = allLocations.filter(
      l => l.zona?.nombre?.toLowerCase().includes('alimento') || l.zona?.codigo?.toLowerCase().includes('b') || l.pasillo?.startsWith('B')
    );
    const textilLocations = allLocations.filter(
      l => l.zona?.nombre?.toLowerCase().includes('textil') || l.zona?.codigo?.toLowerCase().includes('a') || l.pasillo?.startsWith('A')
    );

    const targetPool = esAlimentos
      ? (alimentosLocations.length > 0 ? alimentosLocations : allLocations)
      : (esRopa ? (textilLocations.length > 0 ? textilLocations : allLocations) : allLocations);

    // Identificar las cajas/unidades a ubicar
    const activeBoxes = receipt.handlingUnits.filter(h => h.tipoHu === 'CAJA' && h.estadoHu === 'ACTIVO');
    const itemsToProcess: any[] = [];

    if (activeBoxes.length > 0) {
      // Manejo por cajas unitarias (Giving Out IDs individuales)
      activeBoxes.forEach(box => {
        itemsToProcess.push({
          huId: box.id,
          huCodigo: box.codigo,
          tipoHu: 'CAJA',
          skuId: box.lote?.skuId || receipt.lineas.find(l => l.sku?.codigo === box.skuCodigo)?.skuId || '',
          skuCodigo: box.skuCodigo || 'SKU',
          skuDescripcion: box.skuDescripcion || 'Caja de producto',
          cantidad: box.cantidad,
          lote: box.loteTexto || 'S/L',
          fechaVencimiento: box.fechaVencimiento ? new Date(box.fechaVencimiento).toISOString().split('T')[0] : null,
          ubicacionActual: box.ubicacionActual || 'REC-01',
          reacondicionada: box.reacondicionada,
        });
      });
    } else {
      // Fallback si no hay HUs generadas aún: por partida de recepción
      receipt.lineas.forEach(l => {
        itemsToProcess.push({
          huId: null,
          huCodigo: `PARTIDA-${l.sku?.codigo}`,
          tipoHu: 'PARTIDA',
          skuId: l.skuId,
          skuCodigo: l.sku?.codigo || 'SKU',
          skuDescripcion: l.sku?.descripcion || 'Partida de recibo',
          cantidad: (l.cantidadRecibida || l.cantidadEsperada || 0),
          lote: l.loteAsignado || 'S/L',
          fechaVencimiento: l.fechaVencimiento ? new Date(l.fechaVencimiento).toISOString().split('T')[0] : null,
          ubicacionActual: 'REC-01',
          reacondicionada: false,
        });
      });
    }

    // Algoritmo de Sugerencia Inteligente (FEFO para Alimentos, FIFO para Textil)
    const suggestions = itemsToProcess.map((item, index) => {
      let reglaRotacion = esAlimentos ? 'FEFO' : 'FIFO';
      let suggestedLoc: any = null;
      let matchScore = 95;
      let matchReason = '';

      let daysUntilExpiry: number | null = null;
      if (item.fechaVencimiento) {
        const expDate = new Date(item.fechaVencimiento);
        if (!isNaN(expDate.getTime())) {
          daysUntilExpiry = Math.ceil((expDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
        }
      }

      if (esAlimentos) {
        // Umbral operativo FEFO: Vencimiento cercano (<= 365 días) en Nivel 1; vida útil mayor en Niveles Altos (N2/N3)
        const esVencimientoCercano = daysUntilExpiry !== null && daysUntilExpiry <= 365;
        const candidatesN1 = targetPool.filter(l => l.nivel === 'N1' && (l.capacidadUnits - (l.ocupacion || 0)) >= item.cantidad);
        const candidatesUpper = targetPool.filter(l => l.nivel !== 'N1' && (l.capacidadUnits - (l.ocupacion || 0)) >= item.cantidad);

        if (esVencimientoCercano && candidatesN1.length > 0) {
          suggestedLoc = candidatesN1[index % candidatesN1.length];
          matchReason = `FEFO Picking Activo: Vencimiento prioritario (${daysUntilExpiry}d · ${item.fechaVencimiento}). Sugerido en Nivel 1 (${suggestedLoc.codigo}) para surtido rápido.`;
        } else if (!esVencimientoCercano && candidatesUpper.length > 0) {
          suggestedLoc = candidatesUpper[index % candidatesUpper.length];
          matchReason = `FEFO Reserva Alta: Amplia vida útil (${daysUntilExpiry !== null ? `${daysUntilExpiry}d` : 'reserva'} · ${item.fechaVencimiento}). Sugerido en Nivel Alto (${suggestedLoc.codigo}) para almacenaje estandarizado.`;
        } else if (candidatesN1.length > 0) {
          suggestedLoc = candidatesN1[index % candidatesN1.length];
          matchReason = `FEFO Capacidad: Posición en Nivel 1 (${suggestedLoc.codigo}) con espacio libre verificado para ${item.cantidad} uds.`;
        } else if (candidatesUpper.length > 0) {
          suggestedLoc = candidatesUpper[index % candidatesUpper.length];
          matchReason = `FEFO Capacidad: Posición en Nivel Alto (${suggestedLoc.codigo}) con espacio disponible.`;
        } else {
          suggestedLoc = targetPool[index % targetPool.length] || allLocations[0];
          matchReason = `Zona Alimentos: Posición alternativa (${suggestedLoc?.codigo}).`;
        }
      } else {
        // Regla FIFO: Textil / Retail
        const candidatesN1 = targetPool.filter(l => l.nivel === 'N1' && (l.capacidadUnits - (l.ocupacion || 0)) >= item.cantidad);
        const candidatesUpper = targetPool.filter(l => l.nivel !== 'N1' && (l.capacidadUnits - (l.ocupacion || 0)) >= item.cantidad);

        if (candidatesN1.length > 0) {
          suggestedLoc = candidatesN1[index % candidatesN1.length];
          matchReason = `Regla FIFO: Textil/Prendas. Nivel 1 (${suggestedLoc.codigo}) para fácil surtido y rotación por lote.`;
        } else if (candidatesUpper.length > 0) {
          suggestedLoc = candidatesUpper[index % candidatesUpper.length];
          matchReason = `Regla FIFO: Ubicación en rack textil (${suggestedLoc.codigo}) con capacidad libre suficiente.`;
        } else {
          suggestedLoc = targetPool[index % targetPool.length] || allLocations[0];
          matchReason = `Ubicación textil recomendada (${suggestedLoc?.codigo}).`;
        }
      }

      // Top 5 alternativas válidas
      const alternatives = targetPool
        .filter(l => l.id !== suggestedLoc?.id)
        .slice(0, 5)
        .map(l => ({
          id: l.id,
          codigo: l.codigo,
          pasillo: l.pasillo,
          rack: l.rack,
          nivel: l.nivel,
          zonaNombre: l.zona?.nombre || l.zona?.codigo,
          capacidadLibre: Math.max(0, l.capacidadUnits - (l.ocupacion || 0)),
        }));

      return {
        ...item,
        reglaRotacion,
        matchScore,
        matchReason,
        suggestedLocation: suggestedLoc ? {
          id: suggestedLoc.id,
          codigo: suggestedLoc.codigo,
          pasillo: suggestedLoc.pasillo,
          rack: suggestedLoc.rack,
          nivel: suggestedLoc.nivel,
          zonaNombre: suggestedLoc.zona?.nombre || suggestedLoc.zona?.codigo,
          capacidadLibre: Math.max(0, suggestedLoc.capacidadUnits - (suggestedLoc.ocupacion || 0)),
        } : null,
        alternativeLocations: alternatives,
      };
    });

    return {
      success: true,
      canProceed,
      lockMessage,
      etiquetasEstado: receipt.etiquetasEstado || 'PENDIENTE',
      receipt: {
        id: receipt.id,
        codigo: receipt.codigo,
        cliente: receipt.cliente?.nombreComercial || receipt.cliente?.razonSocial,
        giro: receipt.cliente?.giro || '3PL',
        esAlimentos,
        esRopa,
        facturaRespaldo: receipt.facturaRespaldo || receipt.ocReferencia,
        totalItems: itemsToProcess.length,
        totalUnidades: itemsToProcess.reduce((sum, i) => sum + (i.cantidad || 0), 0),
      },
      suggestions,
    };
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
      include: { cliente: true, handlingUnits: true },
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

    const usuarioResponsable = body.usuario?.trim() || 'Montacarguista';
    const timestamp = new Date().toISOString();

    // Registrar bitácora de auditoría inmutable del Escaneo Dual
    await this.prisma.auditLog.create({
      data: {
        usuario: usuarioResponsable,
        accion: 'PUTAWAY_DUAL_SCAN_VALIDADO',
        entidad: 'HandlingUnit',
        entidadId: huObj.id,
        detalle: `Escaneo Dual Verificado: HU ${huObj.codigo} validada exitosamente en rack físico ${destLoc.codigo} (${destLoc.zona?.nombre || destLoc.zona?.codigo}). Operador: ${usuarioResponsable}. Timestamp: ${timestamp}.`,
      },
    });

    return {
      success: true,
      message: `Escaneo Dual verificado exitosamente: HU ${huObj.codigo} en rack ${destLoc.codigo}.`,
      huId: huObj.id,
      huCodigo: huObj.codigo,
      ubicacionDestinoId: destLoc.id,
      ubicacionDestinoCodigo: destLoc.codigo,
      zona: destLoc.zona?.nombre || destLoc.zona?.codigo,
      huScanValidated: true,
      rackScanValidated: true,
      usuario: usuarioResponsable,
      validatedAt: timestamp,
    };
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

    const huObj = receipt.handlingUnits.find(
      h => (body.huId && h.id === body.huId) ||
           (body.huCodigo && h.codigo.toUpperCase() === body.huCodigo.toUpperCase())
    );

    if (!huObj) {
      throw new HttpException('Unidad de manejo no encontrada en esta recepción', HttpStatus.NOT_FOUND);
    }

    const usuarioResponsable = body.usuario?.trim() || 'Auditor de Calidad / WMS';
    const motivo = body.motivo?.trim() || 'Reinicio manual para ejecución de prueba de Escaneo Dual';

    await this.prisma.auditLog.create({
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
        validations[hu.id] = {
          huId: hu.id,
          huCodigo: hu.codigo,
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

    if (receipt.estado === 'CERRADA' || receipt.estado === 'CERRADO') {
      throw new HttpException(
        'Candado de Inmutabilidad: La recepción se encuentra CERRADA y finiquitada. No se permiten nuevos movimientos de alojamiento sobre un expediente cerrado.',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (receipt.etiquetasEstado !== 'COLOCADAS') {
      throw new HttpException(
        'Candado de Fase 4: No se puede ubicar en racks mercancía sin etiquetas Giving Out confirmadas como COLOCADAS.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const activeBoxes = receipt.handlingUnits.filter(h => h.tipoHu === 'CAJA' && h.estadoHu === 'ACTIVO');
    const inactiveBoxes = receipt.handlingUnits.filter(h => h.tipoHu === 'CAJA' && h.estadoHu !== 'ACTIVO');
    const tarimas = receipt.handlingUnits.filter(h => h.tipoHu === 'TARIMA');

    // Calcular métricas de merma y faltante de forma consistente y general
    const totalPiezasMerma = receipt.inspecciones?.reduce((acc: number, insp: any) => acc + (insp.totalPiezasMerma || 0), 0) || 
      receipt.lineas?.reduce((acc: number, l: any) => acc + Number(l.cantidadDanada || 0), 0) || 0;
    const totalPiezasFaltantes = receipt.lineas?.reduce((acc: number, l: any) => {
      const esp = Number(l.cantidadEsperada || 0);
      const rec = Number(l.cantidadRecibida || 0);
      const dan = Number(l.cantidadDanada || 0);
      return acc + Math.max(0, esp - (rec + dan));
    }, 0) || 0;

    const usuarioResponsable = body.usuario?.trim() || 'Montacarguista';
    const timestamp = new Date().toISOString();

    // =========================================================================
    // CANDADO DE IDEMPOTENCIA: Si todos los bultos activos ya están en racks y receipt es COMPLETO
    // =========================================================================
    const unlocatedActive = activeBoxes.filter(
      h => !h.ubicacionActual || ['RAMPA_RECEPCION', 'REC-01', 'RECIBO'].includes(h.ubicacionActual)
    );

    if (unlocatedActive.length === 0 && (receipt.estado === 'COMPLETO' || receipt.estado === 'UBICADO')) {
      const movimientosRealizados = activeBoxes.map(b => {
        const line = receipt.lineas?.find((l: any) => l.id === b.receiptLineId) ||
          receipt.lineas?.find((l: any) => l.sku?.codigo === b.skuCodigo);
        const resolvedSkuId = line?.skuId || '';
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

      const totalPiezasAlojadas = activeBoxes.reduce((acc, b) => acc + b.cantidad, 0);
      const racksAsignados = [...new Set(activeBoxes.map(b => b.ubicacionActual).filter(Boolean))];

      return {
        success: true,
        idempotent: true,
        durationMs: Date.now() - tStart,
        message: `¡Alojamiento confirmado exitosamente! Se trasladaron ${movimientosRealizados.length} bultos (${totalPiezasAlojadas} pzas) a racks y su stock quedó activo como DISPONIBLE en el portal.`,
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
        estadoRecibo: 'COMPLETO',
        timestamp,
        operador: usuarioResponsable,
        racksAsignados,
        movimientos: movimientosRealizados,
        discrepancias: {
          mermaPiezas: totalPiezasMerma,
          faltantePiezas: totalPiezasFaltantes,
          cajasDanadasFueraStock: inactiveBoxes.length,
          detalle: `${totalPiezasMerma} pzas de merma dictaminadas y ${totalPiezasFaltantes} pzas faltantes fuera de stock; ${inactiveBoxes.length} caja dañada histórica retenida en Calidad.`
        }
      };
    }

    if (!body.movimientos || body.movimientos.length === 0) {
      throw new HttpException('Debe especificar al menos un movimiento para alojar', HttpStatus.BAD_REQUEST);
    }

    // Bloqueo de seguridad: Escaneo Dual obligatorio en 100% de cajas activas
    if (activeBoxes.length > 0) {
      if (body.movimientos.length < activeBoxes.length) {
        throw new HttpException(
          `Bloqueo de Seguridad Putaway: Se requiere completar el alojamiento de la totalidad de cajas activas (${body.movimientos.length} de ${activeBoxes.length} bultos con Escaneo Dual). No se permite activación parcial de stock sin autorización expresa.`,
          HttpStatus.BAD_REQUEST,
        );
      }

      for (const mov of body.movimientos) {
        if (!mov.huScanValidated || !mov.rackScanValidated) {
          throw new HttpException(
            `Bloqueo de Seguridad Putaway: La caja "${mov.huCodigo || mov.huId}" no cuenta con evidencia de Escaneo Dual completo (HU y Rack validados físicamente).`,
            HttpStatus.BAD_REQUEST,
          );
        }
      }
    }

    // Ubicación de recibo
    const recLocation = await this.prisma.location.findFirst({
      where: { OR: [{ codigo: 'REC-01' }, { tipoUbicacion: 'RECIBO' }] },
    }) || await this.prisma.location.findFirst();

    // Indexar HUs en memoria para acceso O(1) sin consultas N+1
    const huById = new Map<string, any>(receipt.handlingUnits.map(h => [h.id, h]));
    const huByCodigo = new Map<string, any>(receipt.handlingUnits.map(h => [h.codigo.toUpperCase(), h]));

    // Consultar TODAS las ubicaciones destino en 1 sola consulta
    const destLocIds = [...new Set(body.movimientos.map(m => m.ubicacionDestinoId).filter(Boolean))];
    const destLocations = await this.prisma.location.findMany({
      where: { id: { in: destLocIds } },
      include: { zona: true },
    });
    const locMap = new Map<string, any>(destLocations.map(l => [l.id, l]));

    for (const mov of body.movimientos) {
      if (!locMap.has(mov.ubicacionDestinoId)) {
        throw new HttpException(`Ubicación destino ${mov.ubicacionDestinoId} no encontrada`, HttpStatus.BAD_REQUEST);
      }
    }

    // Pre-procesar movimientos en memoria y agrupar por (skuId + lote + ubicacionDestinoId) para LotInventory
    type GroupKey = string;
    interface AggregatedGroup {
      skuId: string;
      lote: string | null;
      fechaVencimiento: Date | null;
      destLocId: string;
      destLocCodigo: string;
      cantidadTotal: number;
      movimientos: any[];
    }

    const groupsMap = new Map<GroupKey, AggregatedGroup>();
    const preparedMovements: any[] = [];

    for (const mov of body.movimientos) {
      const destLoc = locMap.get(mov.ubicacionDestinoId)!;
      const huObj = (mov.huId && huById.get(mov.huId)) ||
        (mov.huCodigo && huByCodigo.get(mov.huCodigo.toUpperCase())) || null;

      let effectiveLote = huObj?.loteTexto || null;
      let effectiveFechaVencimiento = huObj?.fechaVencimiento || null;

      if (!effectiveLote && huObj?.receiptLineId) {
        const rLine = receipt.lineas?.find((l: any) => l.id === huObj.receiptLineId);
        if (rLine) {
          effectiveLote = rLine.loteAsignado || rLine.loteEsperado || null;
          effectiveFechaVencimiento = rLine.fechaVencimiento || null;
        }
      }

      if (!effectiveLote && receipt.lineas) {
        const matchingLine = receipt.lineas.find((l: any) => l.skuId === mov.skuId && (l.loteAsignado || l.loteEsperado));
        if (matchingLine) {
          effectiveLote = matchingLine.loteAsignado || matchingLine.loteEsperado || null;
          effectiveFechaVencimiento = matchingLine.fechaVencimiento || null;
        }
      }

      const groupKey = `${mov.skuId}___${effectiveLote || 'NOLOTE'}___${destLoc.id}`;
      let group = groupsMap.get(groupKey);
      if (!group) {
        group = {
          skuId: mov.skuId,
          lote: effectiveLote,
          fechaVencimiento: effectiveFechaVencimiento ? new Date(effectiveFechaVencimiento) : null,
          destLocId: destLoc.id,
          destLocCodigo: destLoc.codigo,
          cantidadTotal: 0,
          movimientos: [],
        };
        groupsMap.set(groupKey, group);
      }
      group.cantidadTotal += mov.cantidad;
      group.movimientos.push({ mov, huObj, destLoc, effectiveLote, effectiveFechaVencimiento });

      preparedMovements.push({ mov, huObj, destLoc, effectiveLote, effectiveFechaVencimiento, groupKey });
    }

    // =========================================================================
    // EJECUCIÓN ATÓMICA OPTIMIZADA EN TRANSACCIÓN ÚNICA
    // =========================================================================
    return await this.prisma.$transaction(async (tx) => {
      // 1. Consultar todos los LotInventory existentes en una sola consulta
      const allSkuIds = [...new Set(body.movimientos.map(m => m.skuId))];
      const allLocIds = [...new Set([...destLocIds, ...(recLocation ? [recLocation.id] : [])])];

      const existingLots = await tx.lotInventory.findMany({
        where: {
          clienteId: receipt.clienteId,
          skuId: { in: allSkuIds },
          ubicacionId: { in: allLocIds },
        },
      });

      // 2. Procesar lotes destino y origen de forma consolidada
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

      // 3. Actualizar HUs físicas en paralelo (1 sola actualización por HU con ubicacionActual y lotId)
      const huUpdatePromises: Promise<any>[] = [];
      const movimientosRealizados: any[] = [];
      const inventoryMovementsData: any[] = [];
      let totalPiezasAlojadas = 0;

      for (const item of preparedMovements) {
        const { mov, huObj, destLoc, effectiveLote, effectiveFechaVencimiento, groupKey } = item;
        const targetLotId = targetLotIdByGroup.get(groupKey)!;

        if (huObj) {
          huUpdatePromises.push(
            tx.handlingUnit.update({
              where: { id: huObj.id },
              data: {
                ubicacionActual: destLoc.codigo,
                lotId: targetLotId,
                estadoHu: 'ACTIVO',
              },
            })
          );
        }

        totalPiezasAlojadas += mov.cantidad;

        const line = receipt.lineas?.find((l: any) => l.id === huObj?.receiptLineId) ||
          receipt.lineas?.find((l: any) => l.skuId === mov.skuId);

        movimientosRealizados.push({
          huId: huObj?.id,
          huCodigo: mov.huCodigo || huObj?.codigo || 'N/A',
          skuId: mov.skuId,
          skuCodigo: huObj?.skuCodigo || line?.sku?.codigo || 'SKU',
          skuDescripcion: huObj?.skuDescripcion || line?.sku?.descripcion || 'Mercancía conforme',
          lote: effectiveLote || 'S/L',
          fechaVencimiento: effectiveFechaVencimiento ? new Date(effectiveFechaVencimiento).toISOString().split('T')[0] : 'N/A',
          cantidad: mov.cantidad,
          ubicacionDestino: destLoc.codigo,
          zona: destLoc.zona?.nombre || destLoc.zona?.codigo || 'Almacenamiento General',
          estadoHu: 'ACTIVO',
          reacondicionada: !!huObj?.reacondicionada,
          cajaOrigenId: huObj?.cajaOrigenId || null,
        });

        inventoryMovementsData.push({
          tipoMovimiento: 'TRASIEGO',
          skuId: mov.skuId,
          clienteId: receipt.clienteId,
          lotId: targetLotId,
          huId: mov.huId || huObj?.id || null,
          fromLocationId: recLocation ? recLocation.id : null,
          toLocationId: destLoc.id,
          cantidad: mov.cantidad,
          usuario: usuarioResponsable,
          motivo: `Alojamiento Putaway confirmado a rack ${destLoc.codigo} (Fase 4)`,
          documentoOrigen: receipt.codigo,
        });
      }

      await Promise.all(huUpdatePromises);

      // 4. Actualizar ocupación en ubicaciones de forma agrupada
      const locCounts = new Map<string, number>();
      for (const mov of body.movimientos) {
        locCounts.set(mov.ubicacionDestinoId, (locCounts.get(mov.ubicacionDestinoId) || 0) + 1);
      }

      for (const [locId, count] of locCounts.entries()) {
        await tx.location.update({
          where: { id: locId },
          data: {
            ocupacion: { increment: count },
            estado: 'OCUPADO',
          },
        });
      }

      if (recLocation) {
        await tx.location.update({
          where: { id: recLocation.id },
          data: {
            ocupacion: { decrement: body.movimientos.length },
          },
        });
      }

      // 5. Inserción masiva por lote en InventoryMovement (createMany)
      await tx.inventoryMovement.createMany({
        data: inventoryMovementsData,
      });

      // 6. Actualizar Receipt a COMPLETO
      await tx.receipt.update({
        where: { id: receipt.id },
        data: { estado: 'COMPLETO' },
      });

      // 7. Auditoría formal inmutable
      await tx.auditLog.create({
        data: {
          usuario: usuarioResponsable,
          accion: 'PUTAWAY_CONFIRMADO_RACKS',
          entidad: 'Receipt',
          entidadId: receipt.id,
          detalle: `Fase 4: Alojamiento confirmado para ${movimientosRealizados.length} bultos (${totalPiezasAlojadas} pzas). Stock activado a DISPONIBLE en racks. Operador: ${usuarioResponsable}. Duración: ${Date.now() - tStart}ms`,
        },
      });

      const racksAsignados = [...new Set(movimientosRealizados.map(m => m.ubicacionDestino))];

      return {
        success: true,
        durationMs: Date.now() - tStart,
        message: `¡Alojamiento confirmado exitosamente! Se trasladaron ${movimientosRealizados.length} bultos (${totalPiezasAlojadas} pzas) a racks y su stock quedó activo como DISPONIBLE en el portal.`,
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
        estadoRecibo: 'COMPLETO',
        timestamp,
        operador: usuarioResponsable,
        racksAsignados,
        movimientos: movimientosRealizados,
        discrepancias: {
          mermaPiezas: totalPiezasMerma,
          faltantePiezas: totalPiezasFaltantes,
          cajasDanadasFueraStock: inactiveBoxes.length,
          detalle: `${totalPiezasMerma} pzas de merma dictaminadas y ${totalPiezasFaltantes} pzas faltantes fuera de stock; ${inactiveBoxes.length} caja dañada histórica retenida en Calidad.`
        }
      };
    }, {
      maxWait: 15000,
      timeout: 30000,
    });
  }

  // Generic Putaway fallback endpoint
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
    for (const m of body.movimientos) {
      if (m.ubicacionDestinoId && m.skuId) {
        await this.prisma.inventoryMovement.create({
          data: {
            tipoMovimiento: 'TRASIEGO',
            skuId: m.skuId,
            clienteId: m.clienteId,
            fromLocationId: m.ubicacionOrigenId || null,
            toLocationId: m.ubicacionDestinoId,
            cantidad: m.cantidad || 0,
            usuario,
            motivo: 'Alojamiento Putaway manual',
          },
        });
      }
    }
    return { success: true, message: `Alojamiento ejecutado para ${body.movimientos.length} productos` };
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
    if (data.skuId && data.clienteId) {
      const sku = await this.prisma.skuMaster.findUnique({
        where: { id: data.skuId },
        include: { cliente: { select: { nombreComercial: true, giro: true, requiereLote: true, requiereCaducidad: true } } },
      });
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
            codigo: huCodigoC, tipoHu: data.tipoHu, lotId: lotC.id,
            clienteId: data.clienteId, cantidad: qtyConforme,
            uom: 'PZA', ubicacionActual: data.ubicacionConformeId,
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
            codigo: huCodigoNC, tipoHu: data.tipoHu, lotId: lotNC.id,
            clienteId: data.clienteId, cantidad: qtyNoConforme,
            uom: 'PZA', ubicacionActual: data.ubicacionNoConformeId,
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
                  cantidad: qtyConforme,
                  uom: line.uom || 'PZA',
                  ubicacionActual: locConforme,
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
                  cantidad: qtyNoConforme,
                  uom: line.uom || 'PZA',
                  ubicacionActual: locNoConforme,
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
        tarimasTotal: receipt.handlingUnits.filter(h => h.tipoHu === 'PALLET').length,
        cajasFinalesRacks: receipt.handlingUnits.filter(h => h.tipoHu === 'CAJA' && h.estadoHu === 'ACTIVO').length,
        cajasDespachadas: receipt.handlingUnits.filter(h => h.tipoHu === 'CAJA' && h.estadoHu === 'DESPACHADO').length,
        cajasHistoricasInactivas: receipt.handlingUnits.filter(h => h.tipoHu === 'CAJA' && (h.estadoHu === 'INACTIVO' || h.estadoHu === 'DAÑADO')).length,
        cajasTotalesRegistradas: receipt.handlingUnits.filter(h => h.tipoHu === 'CAJA').length,
        cajasConformesAlCierre: receipt.handlingUnits.filter(h => h.tipoHu === 'CAJA' && (h.estadoHu === 'ACTIVO' || h.estadoHu === 'DESPACHADO')).length,
      },
      lineas: lineasReporte,
      handlingUnits: enrichedHus,
      qualityInspection: qiResult,
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
      if (receipt.estado === 'CERRADA' || receipt.estado === 'CERRADO') {
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

      const availableLots = await this.prisma.lotInventory.findMany({
        where: lotWhere,
        orderBy: client.reglaInventario === 'FEFO' ? [{ fechaVencimiento: 'asc' }, { createdAt: 'asc' }] : [{ createdAt: 'asc' }],
      });

      // Calcular saldo libre (disponible - reservado)
      let totalStockLibre = 0;
      for (const lot of availableLots) {
        totalStockLibre += Math.max(0, lot.cantidadDisponible - lot.cantidadReservada);
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

      for (const lot of availableLots) {
        if (remainingToReserve <= 0) break;
        const lotFree = Math.max(0, lot.cantidadDisponible - lot.cantidadReservada);
        if (lotFree <= 0) continue;

        const take = Math.min(remainingToReserve, lotFree);
        reservationsToApply.push({ lotId: lot.id, cantidad: take });
        if (!primaryLotId) primaryLotId = lot.id;
        remainingToReserve -= take;
      }

      cleanLines.push({
        skuId: item.skuId,
        cantidadSolicitada: requestedQty,
        cantidadAsignada: 0,
        lotId: primaryLotId,
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
    const isFefo = client.reglaInventario === 'FEFO' || client.giro === 'COMIDA' || client.giro === 'FARMACEUTICO';
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

      const candidateLots = await this.prisma.lotInventory.findMany({
        where: lotWhere,
        include: {
          ubicacion: true,
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

      let remainingToAllocate = requestedQty;
      const sugerencia: any[] = [];
      const todosLotesDisponibles: any[] = [];

      for (const lot of candidateLots) {
        const isInitialLotForThisLine = line.lotId === lot.id;
        const reservedByOthers = Math.max(0, lot.cantidadReservada - (isInitialLotForThisLine ? line.cantidadSolicitada : 0));
        const libreParaEstaOrden = Math.max(0, lot.cantidadDisponible - reservedByOthers);

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

        // Si la línea ya tenía un lote original reservado al crear el pedido, liberar su reserva
        if (line.lotId) {
          await tx.lotInventory.update({
            where: { id: line.lotId },
            data: { cantidadReservada: { decrement: line.cantidadSolicitada } },
          }).catch(() => null);
        }

        // Aplicar nuevas reservas a los lotes seleccionados por Alejandra
        for (const alloc of item.lotes) {
          const qty = Number(alloc.cantidad) || 0;
          if (qty <= 0) continue;

          const lot = await tx.lotInventory.findUnique({ where: { id: alloc.lotId } });
          if (!lot) throw new HttpException(`Lote ${alloc.lotId} no encontrado`, HttpStatus.BAD_REQUEST);

          if (lot.cantidadDisponible < qty) {
            throw new HttpException(`Stock físico insuficiente en lote ${lot.lote || lot.id} para ${line.sku.descripcion}`, HttpStatus.BAD_REQUEST);
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

    // Liberar inventario reservado en los lotes
    for (const line of order.lineas) {
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

    const raw = (body.codigoEscaneado || '').trim();
    const cleanScan = raw.toUpperCase();

    if (body.tipoScan === 'UBICACION') {
      let expectedLocation = (line.ubicacionAsignada || line.lote?.ubicacion?.codigo || '').toUpperCase();
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
      const loteAsignado = (line.loteAsignado || line.lote?.lote || '').toUpperCase();

      const matchesSku = cleanScan === skuCodigo || cleanScan.includes(skuCodigo);
      const matchesEan = Boolean(skuEan && (cleanScan === skuEan || cleanScan.includes(skuEan)));
      const matchesLote = Boolean(loteAsignado && (cleanScan === loteAsignado || cleanScan.includes(loteAsignado)));

      const hu = await this.prisma.handlingUnit.findFirst({
        where: {
          codigo: { equals: raw, mode: 'insensitive' },
          clienteId: line.orden.clienteId,
        },
        include: { lote: true },
      });

      let huMatches = false;
      if (hu) {
        const huSkuMatch = hu.skuCodigo?.toUpperCase() === skuCodigo || hu.lote?.skuId === line.skuId;
        const huLoteMatch = !loteAsignado || (hu.loteTexto?.toUpperCase() === loteAsignado) || (hu.lote?.lote?.toUpperCase() === loteAsignado);
        huMatches = huSkuMatch && huLoteMatch;
      }

      if (!matchesSku && !matchesEan && !matchesLote && !huMatches) {
        return {
          valid: false,
          tipoScan: 'CAJA',
          mensaje: `Etiqueta de caja no válida: "${raw}" no coincide con el producto ${skuCodigo} ni con el lote asignado ${loteAsignado || 'N/A'}.`,
        };
      }

      return {
        valid: true,
        tipoScan: 'CAJA',
        mensaje: `Caja y lote validados con éxito: ${skuCodigo} (Lote: ${loteAsignado || 'Asignado'}).`,
        sku: line.sku.codigo,
        lote: loteAsignado,
        huCodigo: hu?.codigo,
      };
    }

    return { valid: false, mensaje: 'Tipo de escaneo desconocido' };
  }

  @Post('orders/:id/record-pick')
  @ApiOperation({ summary: 'Fase 6: Registrar conteo pickeado por línea con doble escaneo' })
  async recordPick(
    @Param('id') id: string,
    @Body() body: {
      lineId: string;
      cantidadPickeada: number;
      ubicacionEscaneada?: string;
      cajaEscaneada?: string;
      usuario?: string;
    },
  ) {
    const line = await this.prisma.salesOrderLine.findUnique({
      where: { id: body.lineId },
      include: { orden: { include: { lineas: true } } },
    });
    if (!line) throw new HttpException('Línea de pedido no encontrada', HttpStatus.NOT_FOUND);

    const newQty = Math.max(0, Math.min(body.cantidadPickeada, line.cantidadSolicitada));
    const isCompleted = newQty >= line.cantidadSolicitada;

    await this.prisma.salesOrderLine.update({
      where: { id: body.lineId },
      data: {
        cantidadPickeada: newQty,
        cantidadAsignada: newQty,
        ubicacionEscaneada: body.ubicacionEscaneada || line.ubicacionEscaneada,
        cajaEscaneada: body.cajaEscaneada || line.cajaEscaneada,
        pickingCompletado: isCompleted,
        fechaPicking: new Date(),
      },
    });

    const allLines = await this.prisma.salesOrderLine.findMany({
      where: { orderId: line.orderId },
    });

    const orderFullyPicked = allLines.every(l =>
      l.id === body.lineId ? isCompleted : l.pickingCompletado || l.cantidadPickeada >= l.cantidadSolicitada,
    );

    let updatedOrder: any = null;
    if (orderFullyPicked) {
      updatedOrder = await this.prisma.salesOrder.update({
        where: { id: line.orderId },
        data: {
          estado: 'CONSOLIDADO',
          fechaFinPicking: new Date(),
        },
        include: { cliente: true, endCustomer: true, lineas: { include: { sku: true, lote: true } } },
      });

      await this.audit(
        body.usuario || line.orden.surtidor || 'Surtidor',
        'PICKING_COMPLETADO',
        'SalesOrder',
        line.orderId,
        `Pedido ${line.orden.codigo} consolidado al 100% listo para despacho`,
      );
    }

    return {
      success: true,
      lineId: body.lineId,
      cantidadPickeada: newQty,
      lineCompleted: isCompleted,
      orderFullyPicked,
      order: updatedOrder,
    };
  }

  @Post('orders/:id/dispatch')
  @ApiOperation({ summary: 'Confirmar despacho — descuenta inventario físico y reservas, liberando ubicaciones' })
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
        const candidateLots = await this.prisma.lotInventory.findMany({
          where: { skuId: line.skuId, clienteId: fullOrder.clienteId, cantidadDisponible: { gt: 0 }, estadoCalidad: 'LIBERADO' },
          orderBy: { fechaVencimiento: 'asc' },
          include: { ubicacion: true },
        });
        for (const cl of candidateLots) {
          if (remaining <= 0) break;
          const take = Math.min(remaining, cl.cantidadDisponible);
          remaining -= take;
          allocationsToDeduct.push({ lotId: cl.id, cantidad: take, ubicacionId: cl.ubicacionId || undefined });
        }
      }

      // Procesar cada deducción física
      let totalDeductedForLine = 0;
      for (const alloc of allocationsToDeduct) {
        if (alloc.cantidad <= 0) continue;
        const lot = await this.prisma.lotInventory.findUnique({
          where: { id: alloc.lotId },
          include: { ubicacion: true },
        });
        if (!lot) continue;

        const toTake = Math.min(alloc.cantidad, lot.cantidadDisponible);
        const reservedToDeduct = Math.min(toTake, lot.cantidadReservada);

        await this.prisma.lotInventory.update({
          where: { id: lot.id },
          data: {
            cantidadDisponible: { decrement: toTake },
            cantidadReservada: { decrement: reservedToDeduct },
          },
        });
        totalDeductedForLine += toTake;

        // Liberar ubicación física si el inventario queda en 0
        if (lot.ubicacionId) {
          const remainingInLocation = await this.prisma.lotInventory.aggregate({
            where: { ubicacionId: lot.ubicacionId, id: { not: lot.id } },
            _sum: { cantidadDisponible: true },
          });
          const otherQty = remainingInLocation._sum.cantidadDisponible || 0;
          const thisRemaining = lot.cantidadDisponible - toTake;
          if (thisRemaining <= 0 && otherQty <= 0) {
            await this.prisma.location.update({
              where: { id: lot.ubicacionId },
              data: { ocupacion: 0, estado: 'LIBRE' },
            });
          }
        }

        // Trazabilidad Kárdex oficial Giving Out
        await this.prisma.inventoryMovement.create({
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

        // Actualizar HandlingUnits asociados a DESPACHADO
        await this.prisma.handlingUnit.updateMany({
          where: { lotId: lot.id, clienteId: fullOrder.clienteId, estadoHu: 'ACTIVO' },
          data: { estadoHu: 'DESPACHADO' },
        }).catch(() => null);
      }

      await this.prisma.salesOrderLine.update({
        where: { id: line.id },
        data: {
          cantidadAsignada: totalDeductedForLine,
          pickingCompletado: true,
          cantidadPickeada: line.cantidadPickeada || totalDeductedForLine,
        },
      });
    }

    const folioManifiesto = data.folioManifiesto || `MAN-${fullOrder.codigo}`;

    const order = await this.prisma.salesOrder.update({
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
      include: { cliente: true, endCustomer: true },
    });

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
    order.lineas.forEach(l => {
      if (l.asignacionesJson) {
        try {
          const parsed = typeof l.asignacionesJson === 'string' ? JSON.parse(l.asignacionesJson) : l.asignacionesJson;
          if (Array.isArray(parsed)) {
            parsed.forEach((a: any) => { if (a.lotId) lotIdsToFetch.push(a.lotId); });
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

          lineasDesglose.push({
            lineaId: l.id,
            sku: l.sku.codigo,
            descripcion: l.sku.descripcion,
            cantidadSolicitada: l.cantidadSolicitada,
            cantidadDespachada: qty,
            lote: a.lote || dl?.lote || l.loteAsignado || 'N/A',
            caducidad: a.caducidad || dl?.fechaVencimiento || l.lote?.fechaVencimiento || null,
            ubicacion: a.ubicacionCodigo || dl?.ubicacion?.codigo || l.ubicacionAsignada || 'RACK',
            cajasEscaneadas: hus,
            huCodigo: hus.length > 0 ? hus.join(', ') : 'N/A',
            totalCajas: boxesCount,
            uom: l.sku.uomBase || 'PZA',
          });
        }
      } else {
        const qty = l.cantidadPickeada || l.cantidadSolicitada || 0;
        totalPiezas += qty;
        totalCajas += 1;
        lineasDesglose.push({
          lineaId: l.id,
          sku: l.sku.codigo,
          descripcion: l.sku.descripcion,
          cantidadSolicitada: l.cantidadSolicitada,
          cantidadDespachada: qty,
          lote: l.loteAsignado || l.lote?.lote || 'N/A',
          caducidad: l.lote?.fechaVencimiento || null,
          ubicacion: l.ubicacionAsignada || l.lote?.ubicacion?.codigo || 'RACK',
          cajasEscaneadas: l.cajaEscaneada ? l.cajaEscaneada.split(',').map((s: string) => s.trim()) : [],
          huCodigo: l.cajaEscaneada || 'N/A',
          totalCajas: 1,
          uom: l.sku.uomBase || 'PZA',
        });
      }
    }

    const folio = order.folioManifiesto || `MAN-${order.codigo}`;

    return {
      success: true,
      folio,
      order,
      fechaEmbarque: order.fechaDespacho || new Date(),
      totalBultos: totalPiezas,
      totalCajas,
      lineasDesglose,
    };
  }

  @Post('orders/:id/confirm-delivery')
  @ApiOperation({ summary: 'Confirmar entrega al cliente final' })
  async confirmDelivery(@Param('id') id: string, @Body() data: { usuario: string; nombreReceptor: string; notasEntrega?: string; firmaBase64?: string }) {
    const order = await this.prisma.salesOrder.findUnique({ where: { id }, include: { cliente: true, endCustomer: true } });
    if (!order) throw new HttpException('Orden no encontrada', HttpStatus.NOT_FOUND);

    const updated = await this.prisma.salesOrder.update({
      where: { id },
      data: {
        estado: 'ENTREGADO',
        estadoEntrega: 'ENTREGADO',
        fechaEntrega: new Date(),
        nombreReceptor: data.nombreReceptor,
        notasEntrega: data.notasEntrega || null,
        firmaReceptor: data.firmaBase64 || null,
      },
      include: { cliente: true, endCustomer: true },
    });

    await this.prisma.dispatchTracking.create({
      data: {
        orderId: id,
        estado: 'ENTREGADO',
        usuario: data.usuario,
        notas: `Recibió: ${data.nombreReceptor}${data.notasEntrega ? ` — ${data.notasEntrega}` : ''}`,
        nombreFirmante: data.nombreReceptor,
        firmaBase64: data.firmaBase64,
      },
    });

    await this.audit(data.usuario, 'ENTREGA_CONFIRMADA', 'SalesOrder', id,
      `${order.codigo} entregado a ${data.nombreReceptor} en ${(order as any).endCustomer?.nombre || 'destino'}`);
    return { success: true, order: updated };
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
    return this.prisma.cycleCount.findMany({
      where,
      include: { lineas: { include: { sku: { select: { codigo: true, descripcion: true } } } } },
      orderBy: { fechaProgramada: 'desc' },
    });
  }

  @Post('cycle-counts')
  @ApiOperation({ summary: 'Crear conteo cíclico' })
  async createCycleCount(@Body() data: any) {
    const lotWhere: any = { cantidadDisponible: { gt: 0 }, estadoCalidad: 'LIBERADO' };

    if (data.tipo === 'ZONA' && data.zonaId) {
      lotWhere.ubicacion = { zonaId: data.zonaId };
    } else if (data.tipo === 'UBICACION' && data.ubicacionId) {
      lotWhere.ubicacionId = data.ubicacionId;
    } else if (data.tipo === 'SKU' && data.skuId) {
      lotWhere.skuId = data.skuId;
    }

    const lots = await this.prisma.lotInventory.findMany({
      where: lotWhere,
      include: { sku: true },
    });

    const lineMap = new Map<string, { skuId: string; ubicacionId: string | null; lote: string | null; total: number }>();
    for (const lot of lots) {
      const key = lot.skuId;
      if (lineMap.has(key)) { lineMap.get(key)!.total += lot.cantidadDisponible; }
      else { lineMap.set(key, { skuId: lot.skuId, ubicacionId: lot.ubicacionId, lote: lot.lote, total: lot.cantidadDisponible }); }
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
          codigo, nombre: data.nombre, tipo: data.tipo || 'SKU',
          fechaProgramada: new Date(data.fechaProgramada),
          almacenId: data.almacenId, asignadoA: data.asignadoA, notas: data.notas,
          lineas: {
            create: Array.from(lineMap.values()).map(item => ({
              skuId: item.skuId, ubicacionId: item.ubicacionId,
              lote: item.lote, cantidadSistema: item.total,
            })),
          },
        },
        include: { lineas: { include: { sku: { select: { codigo: true, descripcion: true } } } } },
      });
    }, { contextName: 'createCycleCount', maxRetries: 5 });
  }

  @Put('cycle-counts/:id/count')
  @ApiOperation({ summary: 'Registrar conteo físico de líneas' })
  async registerCycleCount(@Param('id') id: string, @Body() data: any) {
    // data.lineas = [{ id: lineId, cantidadFisica: number }]
    const cc = await this.prisma.cycleCount.findUnique({ where: { id } });
    if (!cc) throw new Error('Conteo no encontrado');

    for (const line of data.lineas) {
      const disc = line.cantidadFisica - (line.cantidadSistema || 0);
      await this.prisma.cycleCountLine.update({
        where: { id: line.id },
        data: {
          cantidadFisica: line.cantidadFisica,
          discrepancia: disc,
          porcentajeDisc: line.cantidadSistema ? (disc / line.cantidadSistema) * 100 : 0,
          contadoPor: data.usuario || 'admin',
          contadoEn: new Date(),
          estado: 'CONTADO',
        },
      });
    }

    await this.prisma.cycleCount.update({
      where: { id },
      data: { estado: 'EN_PROGRESO', fechaInicio: new Date() },
    });

    return { message: 'Conteo físico registrado', id };
  }

  @Post('cycle-counts/:id/finalize')
  @ApiOperation({ summary: 'Finalizar conteo y ajustar inventario real' })
  async finalizeCycleCount(@Param('id') id: string, @Body() data: any) {
    const cc = await this.prisma.cycleCount.findUnique({
      where: { id },
      include: { lineas: { include: { sku: true } } },
    });
    if (!cc) throw new Error('Conteo no encontrado');

    let adjustments = 0;

    for (const line of cc.lineas) {
      if (line.cantidadFisica === null) continue;
      const diff = line.cantidadFisica - line.cantidadSistema;
      if (diff === 0) continue;

      // Find matching lot to adjust
      const lots = await this.prisma.lotInventory.findMany({
        where: { skuId: line.skuId, cantidadDisponible: { gt: 0 } },
        orderBy: { createdAt: 'asc' },
      });

      if (lots.length > 0) {
        const lot = lots[0];
        const newQty = Math.max(0, lot.cantidadDisponible + diff);
        await this.prisma.lotInventory.update({
          where: { id: lot.id },
          data: { cantidadDisponible: newQty },
        });

        // If quantity went to zero, free the location
        if (newQty === 0 && lot.ubicacionId) {
          await this.prisma.location.update({
            where: { id: lot.ubicacionId },
            data: { estado: 'LIBRE' },
          });
        }

        // Create inventory movement for the adjustment
        await this.prisma.inventoryMovement.create({
          data: {
            tipoMovimiento: diff > 0 ? 'AJUSTE_ENTRADA' : 'AJUSTE_SALIDA',
            almacenId: cc.almacenId,
            skuId: line.skuId,
            clienteId: lot.clienteId,
            lotId: lot.id,
            toLocationId: lot.ubicacionId,
            cantidad: Math.abs(diff),
            usuario: data.usuario || 'admin@givingout.com',
            motivo: `Ajuste conteo cíclico ${cc.codigo} — ${line.sku?.descripcion || ''}`,
          },
        });

        adjustments++;
      } else if (diff > 0) {
        // Physical count found items not in system — flag but don't create lots
        adjustments++;
      }
    }

    await this.prisma.cycleCount.update({
      where: { id },
      data: {
        estado: 'COMPLETADO',
        fechaCierre: new Date(),
      },
    });

    return {
      message: `Conteo finalizado. ${adjustments} ajustes aplicados al inventario real.`,
      adjustments,
    };
  }

  @Delete('cycle-counts/:id')
  @ApiOperation({ summary: 'Eliminar conteo cíclico' })
  async deleteCycleCount(@Param('id') id: string) {
    await this.prisma.cycleCountLine.deleteMany({ where: { cycleCountId: id } });
    await this.prisma.cycleCount.delete({ where: { id } });
    return { message: 'Conteo cíclico eliminado correctamente', id };
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
      this.prisma.inventoryMovement.findMany({ orderBy: { fechaHora: 'desc' }, take: 10, include: { sku: { select: { descripcion: true } } } }),
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

