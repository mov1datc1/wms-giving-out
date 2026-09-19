import { Controller, Get, Post, Put, Patch, Delete, Param, Query, Body, HttpException, HttpStatus, UseInterceptors, UploadedFile, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBody, ApiConsumes, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import * as XLSX from 'xlsx';
import { PrismaService } from '../../prisma.service';
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
} from './dto/previo.dto';
import { UploadPrevioDto } from './dto/upload-previo.dto';

@ApiTags('Operations')
@Controller('api')
export class OperationsController {
  constructor(private prisma: PrismaService) {}

  private async audit(usuario: string, accion: string, entidad: string, entidadId?: string, detalle?: string) {
    await this.prisma.auditLog.create({ data: { usuario, accion, entidad, entidadId, detalle } });
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

      const count = await this.prisma.receipt.count();
      const codigo = `REC-${new Date().getFullYear()}-${String(count + 1).padStart(4, '0')}`;

      const receipt = await this.prisma.receipt.create({
        data: {
          ...receiptData,
          codigo,
          estado: receiptData.estado || 'PENDIENTE_ARRIBO',
          facturaRespaldo: facturaRespaldo || ocReferencia,
          ocReferencia: ocReferencia || facturaRespaldo,
          tipoImportacion,
          lineas: { create: lineasData },
        },
        include: {
          cliente: { select: { id: true, nombreComercial: true, codigo: true } },
          proveedor: true,
          lineas: { include: { sku: true } },
        },
      });

      await this.audit(
        data.recibidoPor || 'Sistema',
        'CREAR_PREVIO_RECIBO',
        'Receipt',
        receipt.id,
        `${codigo}: Factura ${facturaRespaldo || ocReferencia}, Importación: ${tipoImportacion}, ${lineasData.length} SKUs esperados`,
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
        fileWorkbook = XLSX.read(file.buffer, { type: 'buffer' });
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

        // Auto-detección de cliente depositante si no fue enviado en el cuerpo
        if (!clienteId) {
          const sampleCodes: string[] = [];
          for (const row of rawRows) {
            let code = '';
            for (const key of Object.keys(row)) {
              const cleanKey = key.trim().toLowerCase();
              if (['ean', 'codigo', 'sku', 'codigo_barras', 'codigobarras', 'material'].includes(cleanKey)) {
                code = String(row[key]).trim();
              }
            }
            if (!code && (row['Ean'] || row['Codigo'] || row['SKU'])) {
              code = String(row['Ean'] || row['Codigo'] || row['SKU']).trim();
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
      const codigosNoEncontrados: string[] = [];
      const skusAjenos: Array<{ codigo: string; descripcion?: string; clientePropietario: string }> = [];
      const skusInexistentes: string[] = [];

      // =======================================================
      // 1. PROCESAMIENTO DE ARCHIVO EXCEL (Server-Side)
      // =======================================================
      if (rawRows.length > 0) {
        // Catálogo de SKUs del cliente en memoria para búsqueda inmediata
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
            const cleanKey = k.trim().toLowerCase();
            if (['ean', 'codigo', 'sku', 'codigo_barras', 'codigobarras', 'material'].includes(cleanKey)) {
              const val = String(row[k]).trim();
              if (val && !allFileCodes.includes(val)) allFileCodes.push(val);
            }
          });
          const altCode = String(row['Ean'] || row['EAN'] || row['Codigo'] || row['codigo'] || row['SKU'] || '').trim();
          if (altCode && !allFileCodes.includes(altCode)) allFileCodes.push(altCode);
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

        rawRows.forEach((row) => {
          let rowFactura = '';
          let rowCodeOrEan = '';
          let rowQty = 0;
          let rowLote = '';
          let rowCaducidad = '';

          Object.keys(row).forEach((key) => {
            const cleanKey = key.trim().toLowerCase();
            const val = String(row[key]).trim();

            if (['factura', 'oc', 'orden_compra', 'invoice', 'documento'].includes(cleanKey)) {
              rowFactura = val;
            } else if (['ean', 'codigo', 'sku', 'codigo_barras', 'codigobarras', 'material'].includes(cleanKey)) {
              rowCodeOrEan = val;
            } else if (['cantidad a recibir', 'cantidad', 'qty', 'cant', 'cantidad esperada', 'piezas'].includes(cleanKey)) {
              rowQty = parseFloat(val) || 0;
            } else if (['lote', 'lot', 'batch', 'lote_esperado'].includes(cleanKey)) {
              rowLote = val;
            } else if (['caducidad', 'vencimiento', 'fecha_vencimiento', 'expiry', 'fecha_caducidad', 'f_vencimiento'].includes(cleanKey)) {
              rowCaducidad = val;
            }
          });

          // Fallbacks comunes
          if (!rowFactura && (row['Factura'] || row['factura'] || row['FACTURA'])) {
            rowFactura = String(row['Factura'] || row['factura'] || row['FACTURA']).trim();
          }
          if (!rowCodeOrEan && (row['Ean'] || row['EAN'] || row['Codigo'] || row['codigo'] || row['SKU'])) {
            rowCodeOrEan = String(row['Ean'] || row['EAN'] || row['Codigo'] || row['codigo'] || row['SKU']).trim();
          }
          if (rowQty === 0 && (row['Cantidad a recibir'] || row['Cantidad'] || row['CANTIDAD'])) {
            rowQty = parseFloat(row['Cantidad a recibir'] || row['Cantidad'] || row['CANTIDAD']) || 0;
          }
          if (!rowLote && (row['Lote'] || row['lote'] || row['LOTE'] || row['Lot'] || row['LOT'])) {
            rowLote = String(row['Lote'] || row['lote'] || row['LOTE'] || row['Lot'] || row['LOT']).trim();
          }
          if (!rowCaducidad && (row['Caducidad'] || row['caducidad'] || row['CADUCIDAD'] || row['Vencimiento'] || row['vencimiento'])) {
            rowCaducidad = String(row['Caducidad'] || row['caducidad'] || row['CADUCIDAD'] || row['Vencimiento'] || row['vencimiento']).trim();
          }

          if (!detectedFactura && rowFactura) {
            detectedFactura = rowFactura;
          }

          if (!rowCodeOrEan && rowQty === 0) return;

          const cleanCode = rowCodeOrEan.trim().toLowerCase();
          const matchedSku = skuByCode.get(cleanCode) || skuByBarcode.get(cleanCode);

          if (!matchedSku) {
            const foreign = foreignSkuMap.get(cleanCode);
            if (foreign) {
              if (!skusAjenos.some((x) => x.codigo.toLowerCase() === cleanCode)) {
                skusAjenos.push({
                  codigo: foreign.codigo,
                  descripcion: foreign.descripcion,
                  clientePropietario: foreign.cliente?.nombreComercial || 'Otro cliente',
                });
              }
              const label = `${rowCodeOrEan} (pertenece a ${foreign.cliente?.nombreComercial || 'otro cliente'})`;
              if (!codigosNoEncontrados.includes(label)) codigosNoEncontrados.push(label);
            } else {
              if (rowCodeOrEan && !skusInexistentes.includes(rowCodeOrEan)) {
                skusInexistentes.push(rowCodeOrEan);
              }
              if (rowCodeOrEan && !codigosNoEncontrados.includes(rowCodeOrEan)) {
                codigosNoEncontrados.push(rowCodeOrEan);
              }
            }
            return;
          }

          if (rowQty > 0) {
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
          }
        });
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
            codigosNoEncontrados.push(msg);
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
        const detalles: string[] = [];
        if (skusAjenos.length > 0) {
          detalles.push(`SKUs de otro depositante: ${skusAjenos.map((x) => `"${x.codigo}" (${x.clientePropietario})`).join(', ')}`);
        }
        if (skusInexistentes.length > 0) {
          detalles.push(`SKUs no registrados: ${skusInexistentes.join(', ')}`);
        }

        throw new HttpException(
          {
            statusCode: HttpStatus.BAD_REQUEST,
            message: `No se detectaron líneas válidas para el previo. Todos los códigos analizados fueron rechazados porque no pertenecen al catálogo del depositante ${cliente.nombreComercial}.${detalles.length > 0 ? ` [${detalles.join(' | ')}]` : ''}`,
            error: 'Bad Request',
            detalles: {
              codigo: 'SIN_LINEAS_VALIDAS',
              skusAjenos,
              skusInexistentes,
            },
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      // Generar folio consecutivo
      const count = await this.prisma.receipt.count();
      const codigo = `REC-${new Date().getFullYear()}-${String(count + 1).padStart(4, '0')}`;

      // Factura de respaldo: prioridad manual > detectada en Excel > ocReferencia
      const facturaRespaldo = body.facturaRespaldo || detectedFactura || body.ocReferencia || null;
      const ocReferencia = body.ocReferencia || facturaRespaldo;
      const origen = body.origen || 'NACIONAL';
      const tipoImportacion = body.tipoImportacion || (origen === 'IMPORTACION' ? 'DEFINITIVA' : 'NO_APLICA');
      const tipoRecepcion = body.tipoRecepcion || 'NORMAL';

      const receipt = await this.prisma.receipt.create({
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

      const totalUnidades = lineasParsed.reduce((sum, l) => sum + (l.cantidadEsperada || 0), 0);

      await this.audit(
        body.usuario || body.recibidoPor || 'Sistema',
        file ? 'CARGAR_PREVIO_EXCEL' : 'CREAR_PREVIO_MANUAL',
        'Receipt',
        receipt.id,
        `${codigo}: ${lineasParsed.length} líneas (${totalUnidades} Uds) · Factura: ${facturaRespaldo || 'S/F'} · Origen: ${origen} · Archivo: ${archivoNombre || 'Formulario'}`,
      );

      return {
        success: true,
        message: `Previo ${codigo} creado exitosamente con ${lineasParsed.length} líneas (${totalUnidades} unidades esperadas)`,
        data: receipt,
        estadisticas: {
          totalLineas: lineasParsed.length,
          totalUnidadesEsperadas: totalUnidades,
          archivoProcesado: archivoNombre,
          codigosNoEncontrados,
          skusAjenos,
          skusInexistentes,
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
          ocReferencia: data.ocReferencia !== undefined ? data.ocReferencia : (data.facturaRespaldo || receipt.ocReferencia),
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

      if (line.recepcion?.bloqueado) {
        throw new HttpException('Operación rechazada: El previo está bloqueado. Las partidas esperadas no admiten modificaciones.', HttpStatus.FORBIDDEN);
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

      if (line.recepcion?.bloqueado) {
        throw new HttpException('Operación rechazada: El previo está bloqueado. No se pueden eliminar partidas confirmadas.', HttpStatus.FORBIDDEN);
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

      const huCodigoC = `HU-${new Date().getFullYear()}-${String(await this.prisma.handlingUnit.count() + 1).padStart(5, '0')}`;
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

      const huCodigoNC = `HU-${new Date().getFullYear()}-${String(await this.prisma.handlingUnit.count() + 1).padStart(5, '0')}`;
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
      // Ejecutar en transacción atómica de Prisma con timeout extendido para facturas grandes
      await this.prisma.$transaction(async (tx) => {
        let huSequence = await tx.handlingUnit.count();

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
            const huCodigoC = `HU-${new Date().getFullYear()}-${String(huSequence).padStart(5, '0')}`;
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
            const huCodigoNC = `HU-${new Date().getFullYear()}-${String(huSequence).padStart(5, '0')}`;
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
  async getOrders(@Query('estado') estado?: string, @Query('clienteId') clienteId?: string) {
    const where: any = {};
    if (estado) where.estado = estado;
    if (clienteId) where.clienteId = clienteId;

    return this.prisma.salesOrder.findMany({
      where,
      include: {
        cliente: { select: { nombreComercial: true, reglaInventario: true } },
        endCustomer: { select: { nombre: true, ciudad: true, calle: true } },
        lineas: { include: { sku: { select: { codigo: true, descripcion: true } } } },
        trackingEvents: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: [{ prioridad: 'asc' }, { fechaCompromiso: 'asc' }],
    });
  }

  @Get('receipts/:id/report')
  @ApiOperation({ summary: 'Obtener reporte detallado de cierre de recepción (Hoja de Entrada ASN)' })
  async getReceiptReport(@Param('id') receiptId: string) {
    const receipt = await this.prisma.receipt.findUnique({
      where: { id: receiptId },
      include: {
        cliente: true,
        proveedor: true,
        lineas: {
          include: {
            sku: true,
          },
        },
      },
    });
    if (!receipt) throw new HttpException('Previo no encontrado', HttpStatus.NOT_FOUND);

    let totalEsperado = 0;
    let totalConforme = 0;
    let totalNoConforme = 0;

    const lineasReporte = receipt.lineas.map(l => {
      const esp = l.cantidadEsperada || 0;
      const conf = l.cantidadRecibida || 0;
      const dan = l.cantidadDanada || 0;
      const totalRecibido = conf + dan;
      const variacion = totalRecibido - esp;

      totalEsperado += esp;
      totalConforme += conf;
      totalNoConforme += dan;

      return {
        id: l.id,
        skuId: l.skuId,
        codigo: l.sku.codigo,
        descripcion: l.sku.descripcion,
        categoria: l.sku.categoria,
        talla: l.sku.talla,
        color: l.sku.color,
        codigoBarras: l.sku.codigoBarras,
        uom: l.sku.uomBase,
        cantidadEsperada: esp,
        cantidadConforme: conf,
        cantidadNoConforme: dan,
        totalRecibido,
        variacion,
        estadoLinea: l.estado,
        loteAsignado: l.loteAsignado,
        loteEsperado: l.loteEsperado,
        fechaVencimiento: l.fechaVencimiento,
        ubicacionId: l.ubicacionId,
      };
    });

    const totalFisico = totalConforme + totalNoConforme;
    const variacionNeta = totalFisico - totalEsperado;

    return {
      receipt,
      resumen: {
        totalEsperado,
        totalConforme,
        totalNoConforme,
        totalFisico,
        variacionNeta,
        porcentajeCumplimiento: totalEsperado > 0 ? Math.round((totalConforme / totalEsperado) * 100) : 100,
        estado: receipt.estado,
      },
      lineas: lineasReporte,
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

      // 1. Validar si ya se encuentra cerrada
      if (receipt.estado === 'CERRADA' || receipt.estado === 'CERRADO') {
        throw new HttpException(
          {
            statusCode: HttpStatus.FORBIDDEN,
            message: `Operación rechazada: La recepción previa "${receipt.codigo}" ya se encuentra CERRADA e inmutable en auditoría.`,
            error: 'Forbidden',
            detalles: { codigo: 'RECEPCION_YA_CERRADA', receiptId },
          },
          HttpStatus.FORBIDDEN,
        );
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

          const yaJustificadoEnNotas = item.line.notas && item.line.notas.includes('[DISCREPANCIA_RESUELTA]');

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
          const hasResolution = line.notas && line.notas.includes('[DISCREPANCIA_RESUELTA]');
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
  async createOrder(@Body() data: any) {
    const count = await this.prisma.salesOrder.count();
    const codigo = `PED-${new Date().getFullYear()}-${String(count + 1).padStart(4, '0')}`;

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

    // 2. Crear la orden de salida
    const order = await this.prisma.salesOrder.create({
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

    // 3. Aplicar las reservas automáticas en los lotes
    for (const res of reservationsToApply) {
      await this.prisma.lotInventory.update({
        where: { id: res.lotId },
        data: { cantidadReservada: { increment: res.cantidad } },
      });
    }

    await this.audit(data.usuario || 'Sistema', 'CREAR_ORDEN', 'SalesOrder', order.id, `${codigo}: ${cleanLines.length} líneas reservadas`);
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

  @Post('orders/:id/dispatch')
  @ApiOperation({ summary: 'Confirmar despacho — descuenta inventario físico y reservas, liberando ubicaciones' })
  async dispatchOrder(@Param('id') id: string, @Body() data: { despachador: string; vehiculoPlaca?: string; notas?: string; tipoTransporte?: string; paqueteria?: string; numeroGuia?: string }) {
    const fullOrder = await this.prisma.salesOrder.findUnique({
      where: { id },
      include: { lineas: { include: { sku: true } }, cliente: true, endCustomer: true },
    });
    if (!fullOrder) throw new HttpException('Orden no encontrada', HttpStatus.NOT_FOUND);

    for (const line of fullOrder.lineas) {
      let remaining = line.cantidadSolicitada;
      const lots = await this.prisma.lotInventory.findMany({
        where: { skuId: line.skuId, clienteId: fullOrder.clienteId, cantidadDisponible: { gt: 0 }, estadoCalidad: 'LIBERADO' },
        orderBy: { fechaVencimiento: 'asc' },
        include: { ubicacion: true },
      });

      for (const lot of lots) {
        if (remaining <= 0) break;
        const toTake = Math.min(remaining, lot.cantidadDisponible);
        remaining -= toTake;

        const reservedToDeduct = Math.min(toTake, lot.cantidadReservada);

        await this.prisma.lotInventory.update({
          where: { id: lot.id },
          data: {
            cantidadDisponible: { decrement: toTake },
            cantidadReservada: { decrement: reservedToDeduct },
          },
        });

        if (toTake >= lot.cantidadDisponible && lot.ubicacionId) {
          const otherLots = await this.prisma.lotInventory.count({
            where: { ubicacionId: lot.ubicacionId, cantidadDisponible: { gt: 0 }, id: { not: lot.id } },
          });
          if (otherLots === 0) {
            await this.prisma.location.update({
              where: { id: lot.ubicacionId },
              data: { ocupacion: 0, estado: 'LIBRE' },
            });
          }
        }

        await this.prisma.inventoryMovement.create({
          data: {
            tipoMovimiento: 'SALIDA', skuId: line.skuId, clienteId: fullOrder.clienteId,
            lotId: lot.id, fromLocationId: lot.ubicacionId || undefined,
            cantidad: toTake, usuario: data.despachador,
            motivo: `Despacho ${fullOrder.codigo} → ${(fullOrder as any).endCustomer?.nombre || fullOrder.cliente.nombreComercial}`,
          },
        });
      }

      await this.prisma.salesOrderLine.update({
        where: { id: line.id },
        data: { cantidadAsignada: line.cantidadSolicitada - remaining },
      });
    }

    const order = await this.prisma.salesOrder.update({
      where: { id },
      data: {
        estado: 'DESPACHADO', despachador: data.despachador,
        fechaDespacho: new Date(), vehiculoPlaca: data.vehiculoPlaca, estadoEntrega: 'EN_RUTA',
        tipoTransporte: data.tipoTransporte, paqueteria: data.paqueteria, numeroGuia: data.numeroGuia,
      },
      include: { cliente: true, endCustomer: true },
    });

    await this.prisma.dispatchTracking.create({
      data: { orderId: id, estado: 'SALIDA_ALMACEN', usuario: data.despachador, notas: data.notas },
    });

    await this.audit(data.despachador, 'DESPACHO', 'SalesOrder', id, `Vehículo: ${data.vehiculoPlaca || 'N/A'}`);
    return { success: true, order };
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
    const count = await this.prisma.cycleCount.count();
    const codigo = `CC-${new Date().getFullYear()}-${String(count + 1).padStart(3, '0')}`;

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
}
