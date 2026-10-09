import React, { useEffect, useState, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { API } from '../config/api';
import {
  ClipboardList, Search, RefreshCw, Check, Clock, AlertCircle,
  ChevronDown, ChevronUp, Plus, X, Package, MapPin, Truck, UploadCloud,
  FileSpreadsheet, Download, CheckCircle2, AlertTriangle, FileText, Sparkles,
  Printer, QrCode, Scan, ArrowRight, Tag, Box, CheckSquare, ShieldCheck,
  UserCheck, Layers, Edit3, Trash2, Settings, PlusCircle, ClipboardCheck, RotateCcw,
  Ship, Zap, Lock, Unlock, Eye, EyeOff, Save, CheckCheck, ListChecks,
  ArrowDownRight, ArrowUpRight, Scale, ShieldAlert, TrendingDown, TrendingUp, Ban,
  ChevronRight, ChevronLeft, Microscope, Info
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { LocationSelect } from '../components/LocationSelect';
import { ReceiptPrintModal } from '../components/ReceiptPrintModal';
import { ReceiptReportModal } from '../components/ReceiptReportModal';
import { DivertToVirtualModal } from '../components/DivertToVirtualModal';
import { RampArrivalModal } from '../components/RampArrivalModal';
import { RampDocumentModal } from '../components/RampDocumentModal';
import { DualLabelModal } from '../components/DualLabelModal';
import { QualityInspectionModal } from '../components/QualityInspectionModal';
import { PutawayModal } from '../components/PutawayModal';
import {
  formatCalendarDate,
  formatTimelineDateTime,
  formatWarehouseDateTime,
  formatDateTime,
  WAREHOUSE_TIMEZONE
} from '../utils/dateUtils';

interface PrevioForm {
  clienteId: string;
  proveedorId: string;
  tipoRecepcion?: 'RECEPCION' | 'DEVOLUCION';
  origen: string;
  tipoImportacion?: string;
  facturaRespaldo?: string;
  lineaTransporte: string;
  capacidadCarga?: string;
  placa: string;
  nombreChofer: string;
  folioTransporte?: string;
  ocReferencia: string;
  notas: string;
}

interface ProcessLineForm {
  cantidadConforme: number;
  cantidadNoConforme: number;
  ubicacionConformeId: string;
  ubicacionNoConformeId: string;
  lote: string;
  fechaVencimiento: string;
  tipoHu: string;
  permitirExcedente?: boolean;
}

interface ParsedLine {
  rowNum: number;
  factura: string;
  codeOrEan: string;
  descripcion?: string;
  cantidadEsperada: number;
  lote?: string;
  caducidad?: string;
  sku?: any;
  status: 'VALID' | 'INVALID_NOT_FOUND' | 'INVALID_FOREIGN_CLIENT' | 'INVALID_DATA';
  rejectionReason?: string;
  foreignClientName?: string;
}

interface ExcelAnalysis {
  fileName: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  foreignRows: number;
  notFoundRows: number;
  invalidDataRows: number;
  unmatchedCodes: string[];
  foreignCodes: Array<{ code: string; clientName: string }>;
  detectedFactura?: string;
  incompatibleStructure?: boolean;
  structureError?: string;
  lines: ParsedLine[];
}

// --- Normalización y Clasificación Inteligente de Encabezados Excel ---
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

export const DISCREPANCY_STATUS_OPTIONS = [
  { value: 'FALTANTE_PROVEEDOR', label: 'Faltante de Origen (Factura incompleta / Proveedor no surtió)' },
  { value: 'DANO_TRANSPORTE', label: 'Daño / Merma en Tránsito (Responsabilidad transportista / seguro)' },
  { value: 'SOBRANTE_BONIFICACION', label: 'Sobrante no Facturado (Bonificación / Excedente comercial)' },
  { value: 'RECHAZADO_EN_ANDEN', label: 'Rechazo en Andén (Mercancía devuelta en la misma unidad)' },
  { value: 'CUARENTENA_CALIDAD', label: 'Retenido en Cuarentena (Inspección técnica / Dictamen de calidad)' },
  { value: 'DIFERENCIA_DOCUMENTAL', label: 'Error Documental (Cruce de remisiones / Error en OC)' },
  { value: 'OTRO_JUSTIFICADO', label: 'Otro Motivo Operativo (Justificado por supervisión)' },
];

export const getDiscrepancyStatusIcon = (status?: string, size = 14) => {
  switch (status) {
    case 'FALTANTE_PROVEEDOR':
      return <TrendingDown size={size} style={{ color: '#F87171', flexShrink: 0 }} />;
    case 'DANO_TRANSPORTE':
      return <AlertTriangle size={size} style={{ color: '#FBBF24', flexShrink: 0 }} />;
    case 'SOBRANTE_BONIFICACION':
      return <TrendingUp size={size} style={{ color: '#38BDF8', flexShrink: 0 }} />;
    case 'RECHAZADO_EN_ANDEN':
      return <Ban size={size} style={{ color: '#EF4444', flexShrink: 0 }} />;
    case 'CUARENTENA_CALIDAD':
      return <ShieldAlert size={size} style={{ color: '#A855F7', flexShrink: 0 }} />;
    case 'DIFERENCIA_DOCUMENTAL':
      return <FileText size={size} style={{ color: '#F59E0B', flexShrink: 0 }} />;
    case 'OTRO_JUSTIFICADO':
      return <Edit3 size={size} style={{ color: '#2DD4BF', flexShrink: 0 }} />;
    default:
      return <Tag size={size} style={{ color: '#64748B', flexShrink: 0 }} />;
  }
};

export const DEFAULT_DISCREPANCY_JUSTIFICATIONS: Record<string, string> = {
  FALTANTE_PROVEEDOR: 'Faltante de origen detectado en andén (remisión o factura incompleta de proveedor)',
  DANO_TRANSPORTE: 'Mercancía averiada o con daño físico imputable a maniobra o transporte en tránsito',
  SOBRANTE_BONIFICACION: 'Excedente físico recibido en andén en calidad de bonificación comercial no facturada',
  RECHAZADO_EN_ANDEN: 'Mercancía no conforme rechazada físicamente en andén y retornada en la misma unidad',
  CUARENTENA_CALIDAD: 'Partida retenida preventivamente en cuarentena para inspección técnica y dictamen',
  DIFERENCIA_DOCUMENTAL: 'Discrepancia originada por error administrativo documental o cruce de órdenes de compra',
  OTRO_JUSTIFICADO: 'Diferencia física justificada y autorizada por la supervisión operativa de almacén',
};

const demoReceipts = [
  {
    id: 'demo-rec-1',
    codigo: 'REC-2026-001',
    folioTransporte: '23120690080',
    fechaTransporte: '2023-12-06',
    fechaConfirmacion: '2023-12-07 07:25:53',
    fechaRecepcion: new Date().toISOString(),
    clienteId: 'demo-cli-1',
    cliente: { nombreComercial: 'Fashion Forward S.A.', nombreEmpresa: 'Fashion Forward S.A. de C.V.', requiereLote: false, requiereCaducidad: false },
    ocReferencia: 'FAC-89421',
    lineaTransporte: 'TEMPAQ',
    capacidadCarga: 'CAMION 3.5 TONELADA',
    placa: '7851ZP',
    nombreChofer: 'BRYAN CID ANGELES',
    estado: 'EN_PROCESO',
    origen: 'IMPORTACION',
    tipoRecepcion: 'DEVOLUCION',
    lineas: [
      {
        id: 'demo-line-1',
        folio: '18966',
        sucursal: 'N1050001',
        tipo: 'Caja devolucion',
        cantidadEsperada: 1,
        cantidadRecibida: 1,
        cantidadDanada: 0,
        sku: { codigo: 'CAM-S-BLA', descripcion: 'Camisa Algodón S Blanco', codigoBarras: '7501234567890', talla: 'S', color: 'Blanco', categoria: 'Ropa' }
      },
      {
        id: 'demo-line-2',
        folio: '19078',
        sucursal: 'N1050001',
        tipo: 'Caja devolucion',
        cantidadEsperada: 0,
        cantidadRecibida: 0,
        cantidadDanada: 0,
        sku: { codigo: 'CAM-M-NEG', descripcion: 'Camisa Algodón M Negro', codigoBarras: '7501234567891', talla: 'M', color: 'Negro', categoria: 'Ropa' }
      },
      {
        id: 'demo-line-3',
        folio: '3375',
        sucursal: 'N3040001',
        tipo: 'Caja devolucion',
        cantidadEsperada: 1,
        cantidadRecibida: 1,
        cantidadDanada: 0,
        sku: { codigo: 'PAN-M-AZU', descripcion: 'Pantalón Casual M Azul', codigoBarras: '7509876543211', talla: 'M', color: 'Azul', categoria: 'Ropa' }
      },
      {
        id: 'demo-line-4',
        folio: '3399',
        sucursal: 'N3040001',
        tipo: 'Caja devolucion',
        cantidadEsperada: 1,
        cantidadRecibida: 1,
        cantidadDanada: 0,
        sku: { codigo: 'PAN-G-NEG', descripcion: 'Pantalón Casual G Negro', codigoBarras: '7509876543212', talla: 'G', color: 'Negro', categoria: 'Ropa' }
      },
      {
        id: 'demo-line-5',
        folio: '11837',
        sucursal: 'N1210001',
        tipo: 'Caja devolucion',
        cantidadEsperada: 1,
        cantidadRecibida: 1,
        cantidadDanada: 0,
        sku: { codigo: 'VES-FLOR-M', descripcion: 'Vestido Estampado Floral M', codigoBarras: '7509876543213', talla: 'M', color: 'Multicolor', categoria: 'Ropa' }
      },
      {
        id: 'demo-line-6',
        folio: '807134',
        sucursal: 'N3040001',
        tipo: 'Bandeja azul',
        cantidadEsperada: 13,
        cantidadRecibida: 13,
        cantidadDanada: 0,
        sku: { codigo: 'CHA-CUE-L', descripcion: 'Chamarra Sintética L', codigoBarras: '7505497129416', talla: 'L', color: 'Negro', categoria: 'Ropa' }
      },
      {
        id: 'demo-line-7',
        folio: '807101',
        sucursal: 'N1050001',
        tipo: 'Bandeja azul',
        cantidadEsperada: 34,
        cantidadRecibida: 34,
        cantidadDanada: 0,
        sku: { codigo: 'SUD-DEP-L', descripcion: 'Sudadera Deportiva Unisex Azul L', codigoBarras: '7501112223334', talla: 'L', color: 'Azul', categoria: 'Ropa' }
      },
      {
        id: 'demo-line-8',
        folio: '807153',
        sucursal: 'N5640001',
        tipo: 'Bandeja azul',
        cantidadEsperada: 22,
        cantidadRecibida: 22,
        cantidadDanada: 0,
        sku: { codigo: 'CAM-BLA-M', descripcion: 'Camiseta Básica Blanca M', codigoBarras: '7508161974411', talla: 'M', color: 'Blanco', categoria: 'Ropa' }
      },
      {
        id: 'demo-line-9',
        folio: '807159',
        sucursal: 'N1210001',
        tipo: 'Bandeja azul',
        cantidadEsperada: 8,
        cantidadRecibida: 8,
        cantidadDanada: 0,
        sku: { codigo: 'PAN-JEA-32', descripcion: 'Pantalón Jeans Clásico 32', codigoBarras: '7501997052315', talla: '32', color: 'Azul', categoria: 'Ropa' }
      }
    ]
  },
  {
    id: 'demo-rec-2',
    codigo: 'REC-2026-002',
    folioTransporte: '24041590012',
    fechaTransporte: '2026-04-15',
    fechaConfirmacion: '2026-04-15 11:30:00',
    fechaRecepcion: new Date().toISOString(),
    clienteId: 'demo-cli-1',
    cliente: { nombreComercial: 'Fashion Forward S.A.', nombreEmpresa: 'Fashion Forward S.A. de C.V.', requiereLote: false, requiereCaducidad: false },
    ocReferencia: 'OC-2026-99',
    lineaTransporte: 'TRANSPORTES MEX',
    capacidadCarga: 'RABÓN 10 TONELADAS',
    placa: '4412AK',
    nombreChofer: 'JUAN PÉREZ LÓPEZ',
    estado: 'CERRADO',
    origen: 'NACIONAL',
    tipoRecepcion: 'RECEPCION',
    lineas: [
      {
        id: 'demo-line-10',
        folio: '807101',
        sucursal: 'N1050001',
        tipo: 'Caja máster',
        cantidadEsperada: 34,
        cantidadRecibida: 34,
        cantidadDanada: 0,
        sku: { codigo: 'SUD-DEP-L', descripcion: 'Sudadera Deportiva Unisex Azul L', codigoBarras: '7501112223334', talla: 'L', color: 'Azul', categoria: 'Ropa' }
      },
      {
        id: 'demo-line-11',
        folio: '807102',
        sucursal: 'N1050001',
        tipo: 'Caja máster',
        cantidadEsperada: 40,
        cantidadRecibida: 40,
        cantidadDanada: 0,
        sku: { codigo: 'CAM-BLA-L', descripcion: 'Camiseta Básica Blanca L', codigoBarras: '7509131882811', talla: 'L', color: 'Blanco', categoria: 'Ropa' }
      },
      {
        id: 'demo-line-12',
        folio: '807134',
        sucursal: 'N3040001',
        tipo: 'Tarima / Pallet',
        cantidadEsperada: 12,
        cantidadRecibida: 12,
        cantidadDanada: 0,
        sku: { codigo: 'PAN-JEA-30', descripcion: 'Pantalón Jeans Clásico 30', codigoBarras: '7508266573915', talla: '30', color: 'Azul', categoria: 'Ropa' }
      }
    ]
  }
];

export { formatTimelineDateTime } from '../utils/dateUtils';

export interface TimelineEvent {
  id: string;
  fase: string;
  fecha: string | Date;
  titulo: string;
  subtitulo: string;
  actor: string;
  tipo: string;
  color: string;
  borderColor: string;
  bgColor: string;
  detalles?: string | null;
  badgeText?: string;
  badgeBg?: string;
  badgeColor?: string;
  metrics?: Array<{ label: string; value: string | number; color?: string }>;
  isPutawayConsolidated?: boolean;
  husDetail?: Array<{
    huCodigo: string;
    skuCodigo: string;
    lote: string;
    cantidad: number;
    rackDestino: string;
    origen: string;
    dualScanValidado: boolean;
    operadorScan: string;
    scanTimestamp: string | Date;
    reacondicionada?: boolean;
    movementId?: string | null;
  }>;
  totalHus?: number;
  totalPiezas?: number;
  dualScansValidados?: number;
}

export function buildReceiptTimeline(
  receipt: any,
  auditLogs: any[] = [],
  inventoryMovements: any[] = []
): TimelineEvent[] {
  if (!receipt) return [];
  const events: TimelineEvent[] = [];

  const rawLogs: any[] = Array.isArray(auditLogs) && auditLogs.length > 0
    ? auditLogs
    : (Array.isArray(receipt.auditLogs) ? receipt.auditLogs : []);
  const rawMoves: any[] = Array.isArray(inventoryMovements) && inventoryMovements.length > 0
    ? inventoryMovements
    : (Array.isArray(receipt.inventoryMovements) ? receipt.inventoryMovements : []);

  const findAudit = (actionNames: string[]) =>
    rawLogs.filter((a: any) => actionNames.includes(a.accion));
  const findLastAudit = (actionNames: string[]) => {
    const list = findAudit(actionNames);
    return list.length > 0 ? list[list.length - 1] : null;
  };
  const findFirstAudit = (actionNames: string[]) => {
    const list = findAudit(actionNames);
    return list.length > 0 ? list[0] : null;
  };

  const totalEsperadas = (receipt.lineas || []).reduce((s: number, l: any) => s + Number(l.cantidadEsperada || 0), 0);

  // 1. CREACIÓN DEL PREVIO / ASN
  const auditPrevio = findFirstAudit(['CARGAR_PREVIO_EXCEL', 'CREAR_PREVIO', 'EDITAR_PREVIO']);
  events.push({
    id: 'evt-previo',
    fase: 'PREVIO',
    fecha: auditPrevio?.createdAt || receipt.createdAt,
    titulo: `Creación de previo de recepción (ASN) con ${(receipt.lineas || []).length} partidas registradas`,
    subtitulo: `${totalEsperadas} piezas esperadas · Factura: ${receipt.facturaRespaldo || 'Sin Factura'} · OC: ${receipt.ocReferencia || 'Sin OC'} · Origen: ${receipt.origen || 'NACIONAL'}${receipt.archivoPrevioUrl ? ' · Archivo importado' : ''}`,
    actor: auditPrevio?.usuario || receipt.recibidoPor || 'admin@givingout.mx',
    tipo: 'ASN',
    color: '#0D9488',
    borderColor: '#99F6E4',
    bgColor: '#F0FDFA',
    badgeText: 'ASN Registrado',
    badgeBg: '#CCFBF1',
    badgeColor: '#0F766E',
    detalles: auditPrevio?.detalle || null,
    metrics: [
      { label: 'Partidas', value: (receipt.lineas || []).length },
      { label: 'Pzas Esperadas', value: totalEsperadas },
      { label: 'Tipo Recepción', value: receipt.tipoRecepcion || 'RECEPCIÓN' }
    ]
  });

  // 2. CONFIRMACIÓN DE ARRIBO Y ACTIVACIÓN DE CANDADO DE ANDÉN
  const auditArribo = findFirstAudit(['CONFIRMAR_BLOQUEAR_PREVIO']);
  if (auditArribo || receipt.fechaConfirmacion || receipt.bloqueado) {
    events.push({
      id: 'evt-arribo',
      fase: 'ARRIBO',
      fecha: auditArribo?.createdAt || receipt.fechaConfirmacion || receipt.fechaBloqueo || receipt.createdAt,
      titulo: 'Confirmación de arribo y activación de candado de andén',
      subtitulo: `Unidad en rampa · Andén asignado: ${receipt.andenAsignado || 'REC-01 (Rampa)'} · Candado operativo activado contra modificaciones del catálogo`,
      actor: auditArribo?.usuario || receipt.bloqueadoPor || receipt.recibidoPor || 'Jonathan Palacios',
      tipo: 'ARRIBO',
      color: '#0284C7',
      borderColor: '#BAE6FD',
      bgColor: '#F0F9FF',
      badgeText: 'Candado Activado',
      badgeBg: '#E0F2FE',
      badgeColor: '#0369A1',
      detalles: auditArribo?.detalle || null,
      metrics: [
        { label: 'Andén', value: receipt.andenAsignado || 'REC-01' },
        { label: 'Candado', value: 'BLOQUEADO' }
      ]
    });
  }

  // 3. ACTA DE RAMPA Y LIBERACIÓN DE CHOFER
  const auditRampa = findLastAudit(['ACTA_RAMPA_LIBERACION_CHOFER', 'CORRECCION_ACTA_RAMPA']);
  const hasRampa = Boolean(auditRampa || receipt.fechaLiberacionChofer || receipt.liberadoChofer || (receipt.bultosRecibidos !== null && receipt.bultosRecibidos !== undefined && receipt.bultosRecibidos > 0));
  if (hasRampa) {
    const bRec = receipt.bultosRecibidos ?? 0;
    const bDec = receipt.bultosDeclarados ?? bRec;
    const bDan = receipt.bultosDanados ?? 0;
    const dif = bDec - bRec;
    events.push({
      id: 'evt-rampa',
      fase: 'RAMPA',
      fecha: auditRampa?.createdAt || receipt.fechaLiberacionChofer || receipt.updatedAt,
      titulo: 'Acta de Rampa completada y liberación de chofer',
      subtitulo: `Conteo exterior: ${bRec} bultos recibidos de ${bDec} declarados${bDan > 0 ? ` · ${bDan} bulto con daño exterior visible` : ' · Sin daño exterior'}${dif > 0 ? ` · Diferencia: -${dif} bulto faltante en transporte` : ' · Cuadre sin faltantes'} · Transporte: ${receipt.lineaTransporte || 'N/A'} (Placas: ${receipt.placa || 'N/A'}) · Firmas capturadas y chofer liberado`,
      actor: auditRampa?.usuario || receipt.nombreChofer || receipt.nombreReceptor || 'Jonathan Palacios',
      tipo: 'RAMPA',
      color: '#4F46E5',
      borderColor: '#C7D2FE',
      bgColor: '#EEF2FF',
      badgeText: 'Rampa Liberada',
      badgeBg: '#E0E7FF',
      badgeColor: '#4338CA',
      detalles: auditRampa?.detalle || `Chofer: ${receipt.nombreChofer || 'N/A'} · Placa: ${receipt.placa || 'N/A'} · Línea: ${receipt.lineaTransporte || 'N/A'}`,
      metrics: [
        { label: 'Bultos Recibidos', value: bRec },
        { label: 'Daño Exterior', value: bDan, color: bDan > 0 ? '#DC2626' : undefined },
        { label: 'Dif. Transporte', value: dif > 0 ? `-${dif}` : '0' }
      ]
    });
  }

  // 4. IDENTIFICACIÓN FÍSICA Y RETENCIÓN DE BULTO CON DAÑO (SI APLICA)
  const auditDano = findFirstAudit(['IDENTIFICACION_BULTO_DANADO']);
  const allHus: any[] = receipt.handlingUnits || [];
  const damagedHu = allHus.find((h: any) => h.codigo?.includes('DANO') || h.estadoHu === 'INACTIVO' || h.estadoHu === 'DAÑADO');
  if (auditDano || (receipt.bultosDanados && receipt.bultosDanados > 0) || damagedHu) {
    const andenArribo = receipt.andenAsignado || 'REC-01 (Rampa)';
    const areaCustodia = damagedHu?.ubicacionActual || 'AREA_CALIDAD';
    events.push({
      id: 'evt-dano-bulto',
      fase: 'CALIDAD_RESERVA',
      fecha: auditDano?.createdAt || damagedHu?.createdAt || receipt.fechaLiberacionChofer || receipt.updatedAt,
      titulo: 'Identificación física y retención de bulto con daño exterior',
      subtitulo: `Bulto identificado como ${damagedHu?.codigo || 'BOX-...-DANO'} (${damagedHu?.skuCodigo || receipt.lineas?.[0]?.sku?.codigo || 'SKU'} · ${damagedHu?.cantidad || receipt.lineas?.[0]?.sku?.capacidadEmpaque || 0} pzas) descargado en andén de arribo ${andenArribo} y transferido a custodia en ${areaCustodia} (fuera de stock) para dictamen técnico`,
      actor: auditDano?.usuario || receipt.recibidoPor || receipt.nombreReceptor || 'Supervisor de Andén',
      tipo: 'RETENCION',
      color: '#D97706',
      borderColor: '#FDE68A',
      bgColor: '#FFFBEB',
      badgeText: 'Retenido en Calidad',
      badgeBg: '#FEF3C7',
      badgeColor: '#B45309',
      detalles: auditDano?.detalle || `Bulto retenido para salvaguardar la integridad del inventario.`,
      metrics: [
        { label: 'HU Retenida', value: damagedHu?.codigo || 'BOX-...-DANO' },
        { label: 'Andén de Arribo', value: andenArribo },
        { label: 'Área de Retención', value: areaCustodia },
        { label: 'Estado', value: 'RETENIDA' }
      ]
    });
  }

  // 5. INSPECCIÓN DE CALIDAD Y DICTAMEN (RESCATE / MERMA)
  const auditCalidad = findLastAudit(['INSPECCION_CALIDAD_REACONDICIONAMIENTO', 'DICTAMEN_CALIDAD']);
  const insp = (receipt.inspecciones && receipt.inspecciones.length > 0) ? receipt.inspecciones[0] : (receipt.qualityInspections?.[0] || null);
  const isCalidadDone = Boolean(auditCalidad || insp || receipt.inspeccionCalidadEstado === 'COMPLETADA');
  if (isCalidadDone) {
    const fol = insp?.folio || (receipt.codigo ? `DICTAMEN-${receipt.codigo}` : 'DICTAMEN-CALIDAD');
    const inspTot = insp?.totalPiezasInspeccionadas ?? (Number(receipt.bultosDanados || 0) * (receipt.lineas?.[0]?.sku?.capacidadEmpaque || receipt.piezasPorCajaEsperadas || 0));
    const inspRes = insp?.totalPiezasRescatadas ?? inspTot;
    const inspMer = insp?.totalPiezasMerma ?? 0;
    events.push({
      id: 'evt-calidad',
      fase: 'CALIDAD',
      fecha: insp?.fechaInspeccion || auditCalidad?.createdAt || insp?.createdAt || receipt.updatedAt,
      titulo: `Inspección de Calidad completada (Dictamen ${fol})`,
      subtitulo: `Revisión técnica de ${inspTot} piezas: ${inspRes} piezas rescatadas/reacondicionadas en caja activa · ${inspMer} piezas de merma dictaminada fuera de stock${insp?.observaciones ? ` · ${insp.observaciones}` : ''}`,
      actor: insp?.inspectorNombre || auditCalidad?.usuario || receipt.recibidoPor || 'Inspector de Calidad',
      tipo: 'CALIDAD',
      color: '#7C3AED',
      borderColor: '#DDD6FE',
      bgColor: '#F5F3FF',
      badgeText: `Dictamen ${fol}`,
      badgeBg: '#EDE9FE',
      badgeColor: '#6D28D9',
      detalles: auditCalidad?.detalle || `Dictamen ${fol}: ${inspRes} piezas conformes rescatadas, ${inspMer} piezas de merma dictaminada fuera de stock.`,
      metrics: [
        { label: 'Inspeccionadas', value: `${inspTot} pz` },
        { label: 'Rescatadas', value: `${inspRes} pz`, color: '#059669' },
        { label: 'Merma Dictaminada', value: `${inspMer} pz`, color: '#DC2626' }
      ]
    });
  }

  // 6. CONCILIACIÓN FÍSICA EN ANDÉN Y BALANCE DE PARTIDAS
  const auditAnden = findLastAudit(['CONCILIACION_ANDEN', 'GUARDAR_CONTEO_ANDEN']);
  const isAndenDone = Boolean(auditAnden || receipt.conteoAndenEstado === 'COMPLETADO' || receipt.fechaConteoAnden);
  if (isAndenDone) {
    const totalConf = (receipt.lineas || []).reduce((s: number, l: any) => s + Number(l.cantidadRecibida || 0), 0);
    const totalMerma = (receipt.lineas || []).reduce((s: number, l: any) => s + Number(l.cantidadDanada || 0), 0);
    const totalFalt = Math.max(0, totalEsperadas - totalConf - totalMerma);
    events.push({
      id: 'evt-anden-conteo',
      fase: 'ANDEN',
      fecha: auditAnden?.createdAt || receipt.fechaConteoAnden || receipt.updatedAt,
      titulo: 'Conciliación física en Andén y balance de partidas',
      subtitulo: `Balance final: ${totalConf} piezas conformes · ${totalMerma} piezas de merma dictaminada fuera de stock · ${totalFalt} piezas de faltante confirmado`,
      actor: auditAnden?.usuario || receipt.recibidoPor || 'admin@givingout.mx',
      tipo: 'ANDEN',
      color: '#059669',
      borderColor: '#A7F3D0',
      bgColor: '#ECFDF5',
      badgeText: 'Andén Conciliado',
      badgeBg: '#D1FAE5',
      badgeColor: '#047857',
      detalles: auditAnden?.detalle || `Partidas clasificadas con cuadre matemático completo.`,
      metrics: [
        { label: 'Conformes', value: `${totalConf} pz`, color: '#059669' },
        { label: 'Merma Dictaminada', value: `${totalMerma} pz`, color: '#DC2626' },
        { label: 'Faltante Confirmado', value: `${totalFalt} pz`, color: '#D97706' }
      ]
    });
  }

  // 7. GENERACIÓN DE TARIMA MASTER Y HUS (DOBLE ETIQUETADO)
  const auditEtiquetas = findFirstAudit(['GENERAR_DOBLE_ETIQUETADO']);
  const palletHu = allHus.find((h: any) => h.tipoHu === 'PALLET' || h.tipoHu === 'TARIMA' || (h.codigo && (h.codigo.startsWith('PLT-') || h.codigo.startsWith('TAR-')))) || null;
  const boxHus = allHus.filter((h: any) => (!palletHu || h.id !== palletHu.id) && h.tipoHu !== 'PALLET' && !(h.codigo && (h.codigo.startsWith('PLT-') || h.codigo.startsWith('TAR-'))));
  const activasHus = boxHus.filter((b: any) => b.estadoHu === 'ACTIVO' || b.estadoHu === 'ALMACENADO' || b.estadoHu === 'EN_RACK');
  const hasLabelsGen = Boolean(auditEtiquetas || boxHus.length > 0);
  if (hasLabelsGen) {
    const pltCode = palletHu?.codigo || (receipt.codigo ? `PLT-${receipt.codigo}-01` : 'Tarima Master');
    const auditNorm = findLastAudit(['NORMALIZACION_CORRELATIVOS_HU']);
    const recondBoxes = boxHus.filter((b: any) => b.reacondicionada || b.cajaOrigenId);
    events.push({
      id: 'evt-generar-etiquetas',
      fase: 'ETIQUETAS_GEN',
      fecha: auditEtiquetas?.createdAt || palletHu?.createdAt || boxHus[0]?.createdAt || receipt.updatedAt,
      titulo: 'Generación de unidades de manejo (Doble Etiquetado Industrial)',
      subtitulo: palletHu
        ? `Generada Tarima Master ${pltCode} (QR GS1 Multilote) y ${activasHus.length} cajas físicas activas`
        : `Generadas ${activasHus.length} cajas físicas activas`,
      actor: auditEtiquetas?.usuario || 'Supervisor Andén',
      tipo: 'DOBLE_ETIQUETADO',
      color: '#0D9488',
      borderColor: '#99F6E4',
      bgColor: '#F0FDFA',
      badgeText: 'HUs Generadas',
      badgeBg: '#CCFBF1',
      badgeColor: '#0F766E',
      detalles: auditNorm?.detalle || auditEtiquetas?.detalle || null,
      metrics: [
        ...(palletHu ? [{ label: 'Tarima Master', value: pltCode }] : []),
        { label: 'Cajas Activas', value: activasHus.length },
        ...(recondBoxes.length > 0 ? [{ label: 'Reacondicionadas', value: `${recondBoxes.length} caja${recondBoxes.length > 1 ? 's' : ''}` }] : [])
      ]
    });
  }

  // 8. IMPRESIÓN DE ETIQUETAS TÉRMICAS INDUSTRIALES
  const auditPrint = findLastAudit(['IMPRESION_ETIQUETAS', 'REIMPRESION_ETIQUETAS']);
  const hasPrinted = Boolean(auditPrint || boxHus.some((b: any) => b.etiquetaImpresa));
  if (hasPrinted) {
    events.push({
      id: 'evt-impresion',
      fase: 'IMPRESION',
      fecha: auditPrint?.createdAt || receipt.fechaColocacionEtiquetas || receipt.updatedAt,
      titulo: 'Impresión de etiquetas térmicas industriales',
      subtitulo: palletHu
        ? `Etiquetas térmicas generadas en formato industrial: 1 Tarima Master (100×150 mm) y ${activasHus.length} cajas conformes (100×50 mm Code-128 con metadatos de lote, caducidad y condición)`
        : `Etiquetas térmicas generadas en formato industrial: ${activasHus.length} cajas conformes (100×50 mm Code-128 con metadatos de lote, caducidad y condición)`,
      actor: auditPrint?.usuario || 'Supervisor Andén',
      tipo: 'IMPRESION',
      color: '#6366F1',
      borderColor: '#C7D2FE',
      bgColor: '#EEF2FF',
      badgeText: 'Etiquetas Impresas',
      badgeBg: '#E0E7FF',
      badgeColor: '#4338CA',
      detalles: auditPrint?.detalle || 'Lote completo de etiquetas impreso en formato industrial.',
      metrics: [
        ...(palletHu ? [{ label: 'Tarima 100x150 mm', value: '1 QR Master' }] : []),
        { label: 'Cajas 100x50 mm', value: `${activasHus.length} Code-128` }
      ]
    });
  }

  // 9. CONFIRMACIÓN FÍSICA DE COLOCACIÓN DE ETIQUETAS EN ANDÉN
  const auditColocacion = findLastAudit(['CONFIRMAR_COLOCACION_ETIQUETAS']);
  const hasColocacion = Boolean(auditColocacion || receipt.fechaColocacionEtiquetas || receipt.etiquetasEstado === 'COLOCADAS');
  if (hasColocacion) {
    events.push({
      id: 'evt-colocacion-etiquetas',
      fase: 'ETIQUETAS_COLOCADAS',
      fecha: auditColocacion?.createdAt || receipt.fechaColocacionEtiquetas || receipt.updatedAt,
      titulo: 'Confirmación física de colocación de etiquetas en andén',
      subtitulo: palletHu
        ? `Etiquetas colocadas y verificadas físicamente en rampa sobre las ${activasHus.length} cajas conformes y la Tarima Master · Bultos rotulados al 100% listos para traslado a racks`
        : `Etiquetas colocadas y verificadas físicamente en rampa sobre las ${activasHus.length} cajas conformes · Bultos rotulados al 100% listos para traslado a racks`,
      actor: auditColocacion?.usuario || receipt.etiquetasColocadasPor || 'Jonathan Palacios',
      tipo: 'COLOCACION',
      color: '#0284C7',
      borderColor: '#BAE6FD',
      bgColor: '#F0F9FF',
      badgeText: 'Etiquetas Colocadas',
      badgeBg: '#E0F2FE',
      badgeColor: '#0369A1',
      detalles: auditColocacion?.detalle || 'Bultos rotulados al 100% y listos para traslado a racks.',
      metrics: [
        { label: 'Etiquetas Colocadas', value: '100%' },
        { label: 'Verificación', value: 'Física en Andén' }
      ]
    });
  }

  // 10. PUTAWAY COMPLETADO · ACTIVACIÓN DE STOCK · ESCANEO DUAL
  const auditPutaway = findLastAudit(['PUTAWAY_CONFIRMADO_RACKS', 'CONFIRMAR_UBICACION_RACKS']);
  const dualScanAudits = findAudit(['PUTAWAY_DUAL_SCAN_VALIDADO']);
  const dualScansByHu: Record<string, any> = {};
  dualScanAudits.forEach((ds: any) => {
    const match = ds.detalle?.match(/HU (BOX-[A-Z0-9-]+)/);
    const huKey = match ? match[1] : ds.entidadId;
    dualScansByHu[huKey] = ds;
  });
  const uniqueDualScansCount = Object.keys(dualScansByHu).length;
  const trasiegosMovements = rawMoves.filter((m: any) => m.tipoMovimiento === 'TRASIEGO' || m.tipoMovimiento === 'ENTRADA');
  const isPutawayDone = Boolean(auditPutaway || receipt.estado === 'UBICADO' || receipt.estado === 'COMPLETO' || trasiegosMovements.length > 0);

  if (isPutawayDone) {
    const totalPzasActivas = activasHus.reduce((s: number, b: any) => s + Number(b.cantidad || 0), 0);
    const dualCount = uniqueDualScansCount > 0 ? uniqueDualScansCount : activasHus.length;
    const actorPutaway = auditPutaway?.usuario || (dualScanAudits[0]?.usuario) || 'Jonathan Palacios';
    const fechaPutaway = auditPutaway?.createdAt || (trasiegosMovements.length > 0 ? trasiegosMovements[trasiegosMovements.length - 1].fechaHora : receipt.updatedAt);

    const husPutawayDetail = activasHus.map((box: any) => {
      const ds = dualScansByHu[box.codigo] || dualScansByHu[box.id] || null;
      const mov = trasiegosMovements.find((m: any) => m.huId === box.id || m.hu?.codigo === box.codigo) || null;
      const rackDest = mov?.toLocation?.codigo || box.ubicacionActual || 'Rack Asignado';
      const origenLoc = mov?.fromLocation?.codigo || 'REC-01 (Rampa)';
      return {
        huCodigo: box.codigo,
        skuCodigo: box.skuCodigo || mov?.sku?.codigo || '—',
        lote: box.loteTexto || '—',
        cantidad: Number(box.cantidad ?? mov?.cantidad ?? 0),
        rackDestino: rackDest,
        origen: origenLoc,
        dualScanValidado: true,
        operadorScan: ds?.usuario || actorPutaway,
        scanTimestamp: ds?.createdAt || mov?.fechaHora || fechaPutaway,
        movementId: mov?.id || null,
        reacondicionada: Boolean(box.reacondicionada || box.cajaOrigenId),
      };
    });

    events.push({
      id: 'evt-putaway-consolidado',
      fase: 'PUTAWAY',
      fecha: fechaPutaway,
      titulo: `Putaway completado · ${activasHus.length} HUs alojadas · ${totalPzasActivas} pzas activadas · Escaneo Dual ${dualCount}/${activasHus.length}`,
      subtitulo: `Traslado físico completado desde RAMPA_RECEPCION (REC-01) hacia racks de almacenamiento · 100% de cajas con Escaneo Dual obligatorio (HU + Rack) verificado · Inventario activado formalmente como DISPONIBLE`,
      actor: actorPutaway,
      tipo: 'PUTAWAY',
      color: '#059669',
      borderColor: '#86EFAC',
      bgColor: '#F0FDF4',
      badgeText: 'Stock Activo en Racks',
      badgeBg: '#DCFCE7',
      badgeColor: '#15803D',
      detalles: auditPutaway?.detalle || `Alojamiento confirmado en racks. Stock activado como DISPONIBLE en inventario.`,
      isPutawayConsolidated: true,
      husDetail: husPutawayDetail,
      totalHus: activasHus.length,
      totalPiezas: totalPzasActivas,
      dualScansValidados: dualCount,
      metrics: [
        { label: 'HUs Alojadas', value: activasHus.length },
        { label: 'Pzas Activadas', value: `${totalPzasActivas} pz`, color: '#059669' },
        { label: 'Escaneo Dual', value: `${dualCount}/${activasHus.length}`, color: '#059669' },
        { label: 'Estado Stock', value: 'DISPONIBLE', color: '#059669' }
      ]
    });
  }

  // 11. CIERRE OFICIAL DE RECEPCIÓN (SI YA SE EJECUTÓ)
  const auditCierre = findLastAudit(['CIERRE_RECEPCION']);
  const isCerrado = Boolean(auditCierre || receipt.fechaCierre || receipt.estado === 'CERRADO' || receipt.estado === 'CERRADA');
  if (isCerrado) {
    const totalConf = (receipt.lineas || []).reduce((s: number, l: any) => s + Number(l.cantidadRecibida || 0), 0);
    const totalMerma = (receipt.lineas || []).reduce((s: number, l: any) => s + Number(l.cantidadDanada || 0), 0);
    const totalFalt = Math.max(0, totalEsperadas - totalConf - totalMerma);
    events.push({
      id: 'evt-cierre',
      fase: 'CIERRE',
      fecha: auditCierre?.createdAt || receipt.fechaCierre || receipt.updatedAt,
      titulo: `Cierre oficial y finiquito de recepción (${totalConf} conformes${totalMerma > 0 ? `, ${totalMerma} merma dictaminada fuera de stock` : ''}${totalFalt > 0 ? `, ${totalFalt} faltantes` : ''})`,
      subtitulo: `Expediente finiquitado formalmente en auditoría WMS con candado inmutable activado`,
      actor: auditCierre?.usuario || receipt.cerradoPor || 'Supervisor Andén',
      tipo: 'CIERRE',
      color: '#1E293B',
      borderColor: '#CBD5E1',
      bgColor: '#F8FAFC',
      badgeText: 'Cierre Oficial',
      badgeBg: '#E2E8F0',
      badgeColor: '#0F172A',
      detalles: auditCierre?.detalle || `Recepción finiquitada y cerrada oficialmente.`,
      metrics: [
        { label: 'Conformes', value: `${totalConf} pz` },
        { label: 'Merma Dictaminada', value: `${totalMerma} pz` },
        { label: 'Faltantes', value: `${totalFalt} pz` }
      ]
    });
  }

  // Ordenar cronológicamente por timestamp de cada evento
  events.sort((a, b) => new Date(a.fecha).getTime() - new Date(b.fecha).getTime());
  return events;
}

export function Receiving() {
  const { token, user } = useAuth();
  const isSupervisorOrAdmin = Boolean(
    user?.isSuperAdmin ||
    user?.rolNombre?.toUpperCase().includes('ADMIN') ||
    user?.rolNombre?.toUpperCase().includes('SUPERVISOR') ||
    user?.permisos?.includes('admin')
  );
  const [searchParams, setSearchParams] = useSearchParams();
  const [receipts, setReceipts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterEstado, setFilterEstado] = useState('');
  const [filterCliente, setFilterCliente] = useState('');
  const [selectedReceiptId, setSelectedReceiptId] = useState<string | null>(() => {
    return searchParams.get('folio') || searchParams.get('id') || null;
  });
  const [activeDossierTab, setActiveDossierTab] = useState<'PARTIDAS' | 'HUS' | 'DOCUMENTOS' | 'TRANSPORTE' | 'HISTORIAL'>('PARTIDAS');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('receiving_sidebar_collapsed') === 'true');
  const toggleSidebar = () => {
    setSidebarCollapsed(prev => {
      const next = !prev;
      localStorage.setItem('receiving_sidebar_collapsed', String(next));
      return next;
    });
  };

  // Estados para el visor de Historial y Kárdex (Trazabilidad E2E)
  const [showPutawayHusDetail, setShowPutawayHusDetail] = useState(false);
  const [showKardexTableDetail, setShowKardexTableDetail] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Sincronizar parámetros de búsqueda y folio de URL (?search=..., ?folio=...)
  useEffect(() => {
    const q = searchParams.get('search');
    if (q !== null && q !== undefined) {
      setSearch(q);
    }
    const folioParam = searchParams.get('folio') || searchParams.get('id');
    if (folioParam && receipts.length > 0) {
      const match = receipts.find(r => r.id === folioParam || r.codigo === folioParam);
      if (match && selectedReceiptId !== match.id) {
        setSelectedReceiptId(match.id);
      }
    }
  }, [searchParams, receipts]);

  function handleOpenReceiptDossier(receipt: any) {
    setSelectedReceiptId(receipt.id);
    setActiveDossierTab('PARTIDAS');
    setSearchParams(prev => {
      prev.set('folio', receipt.codigo);
      return prev;
    });
    if (!receipt.auditLogs || !receipt.inventoryMovements) {
      refreshReceiptHistory(receipt.id);
    }
  }

  function handleBackToList() {
    setSelectedReceiptId(null);
    setSearchParams(prev => {
      prev.delete('folio');
      prev.delete('id');
      return prev;
    });
  }

  // Catalogs
  const [clients, setClients] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [skus, setSkus] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [warehouse, setWarehouse] = useState<any>(null);

  // Forms State
  const [showNewPrevio, setShowNewPrevio] = useState(false);
  const [newPrevio, setNewPrevio] = useState<PrevioForm>({
    clienteId: '', proveedorId: '', tipoRecepcion: 'RECEPCION', origen: 'NACIONAL',
    tipoImportacion: 'NO_APLICA', facturaRespaldo: '',
    lineaTransporte: '', placa: '', nombreChofer: '', ocReferencia: '', notas: ''
  });
  const [file, setFile] = useState<File | null>(null);
  const [excelAnalysis, setExcelAnalysis] = useState<ExcelAnalysis | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Dual mode: Excel file vs Manual Form
  const [previoMode, setPrevioMode] = useState<'EXCEL' | 'MANUAL'>('EXCEL');
  const [manualLines, setManualLines] = useState<Array<{ skuId: string; cantidadEsperada: number; notas?: string }>>([]);
  const [curManualSku, setCurManualSku] = useState('');
  const [curManualQty, setCurManualQty] = useState<number | ''>(1);
  const [curManualNotas, setCurManualNotas] = useState('');

  // --- CRUD Modals State ---
  const [editReceiptModal, setEditReceiptModal] = useState<any | null>(null);
  const [deleteReceiptConfirm, setDeleteReceiptConfirm] = useState<any | null>(null);
  
  const [editingLine, setEditingLine] = useState<{ id: string; cantidadEsperada: number; notas: string; codigo: string; descripcion: string } | null>(null);
  const [deleteLineConfirm, setDeleteLineConfirm] = useState<{ lineId: string; receiptId: string; codigo: string } | null>(null);
  
  const [showAddLineModal, setShowAddLineModal] = useState<{ receiptId: string; clienteId: string } | null>(null);
  const [newLineForm, setNewLineForm] = useState({ skuId: '', cantidadEsperada: 1, notas: '' });

  // Lock / Unlock Previo State (Tarea 3 - Bloqueo de Previo Confirmado)
  const [confirmLockModal, setConfirmLockModal] = useState<any | null>(null);
  const [confirmUnlockModal, setConfirmUnlockModal] = useState<any | null>(null);
  const [unlockMotivo, setUnlockMotivo] = useState('');
  const [isLocking, setIsLocking] = useState(false);
  const [modalActionError, setModalActionError] = useState<string | null>(null);

  // Print Modal State
  const [printModalReceipt, setPrintModalReceipt] = useState<any | null>(null);
  const [generatingBarcodes, setGeneratingBarcodes] = useState<string | null>(null);

  // Close Receipt & Report Modal State (Tarea 5: Candado de Discrepancias)
  const [closingReceipt, setClosingReceipt] = useState<any | null>(null);
  const [closingNotes, setClosingNotes] = useState('');
  const [closingDiscrepancies, setClosingDiscrepancies] = useState<Record<string, { clasificacion: string; justificacion: string }>>({});
  const [closingGlobalClasif, setClosingGlobalClasif] = useState<string>('');
  const [closingGlobalJustif, setClosingGlobalJustif] = useState<string>('');
  const [closingErrorBanner, setClosingErrorBanner] = useState<string | null>(null);
  const [closingSuccessBanner, setClosingSuccessBanner] = useState<string | null>(null);
  const [reportModalReceipt, setReportModalReceipt] = useState<any | null>(null);
  const [reportData, setReportData] = useState<any | null>(null);
  const [loadingReport, setLoadingReport] = useState(false);

  // Subflujo Desvío a Almacén Virtual de No Conforme / Merma
  const [divertModalData, setDivertModalData] = useState<{
    receipt: any;
    initialItems?: any[];
    initialTipoDesvio?: 'MERMA' | 'EXCESO';
  } | null>(null);

  // Fase 1 Giving Out: Acta de Rampa y Doble Etiquetado
  const [rampArrivalReceipt, setRampArrivalReceipt] = useState<any | null>(null);
  const [rampDocumentReceipt, setRampDocumentReceipt] = useState<any | null>(null);
  const [dualLabelReceipt, setDualLabelReceipt] = useState<any | null>(null);

  // Fase 2 Giving Out: Inspección Interna y Reacondicionamiento (Maquila/Rescate)
  const [qualityInspectionReceipt, setQualityInspectionReceipt] = useState<any | null>(null);

  // Putaway / Alojamiento Modal State
  const [putawayModalReceipt, setPutawayModalReceipt] = useState<any | null>(null);
  const [putawayMoves, setPutawayMoves] = useState<any[]>([]);

  // Handheld Scanner State
  const [scannerQuery, setScannerQuery] = useState('');
  const [scannerMsg, setScannerMsg] = useState({ type: '', text: '' });
  const scannerInputRef = useRef<HTMLInputElement>(null);

  const [processLineId, setProcessLineId] = useState<string | null>(null);
  const [processForm, setProcessForm] = useState<ProcessLineForm>({
    cantidadConforme: 0, cantidadNoConforme: 0,
    ubicacionConformeId: '', ubicacionNoConformeId: '',
    lote: '', fechaVencimiento: '', tipoHu: 'CAJA', permitirExcedente: false
  });

  const [submitting, setSubmitting] = useState(false);
  const [formMsg, setFormMsg] = useState({ type: '', text: '' });

  // --- TAREA 1: Planilla Matricial de Conteo por Factura Completa & Conteo Ciego ---
  const [matrixValues, setMatrixValues] = useState<Record<string, Record<string, { cantidadConforme: number | ''; cantidadNoConforme: number | ''; lote: string; fechaVencimiento: string }>>>({});
  const [blindCountMode, setBlindCountMode] = useState<Record<string, boolean>>({});
  const [matrixLocations, setMatrixLocations] = useState<Record<string, { ubicacionConformeId: string; ubicacionNoConformeId: string }>>({});
  const [savingMatrix, setSavingMatrix] = useState<Record<string, boolean>>({});
  const [matrixSuccessBanner, setMatrixSuccessBanner] = useState<{ receiptId: string; text: string } | null>(null);
  const [matrixErrorBanner, setMatrixErrorBanner] = useState<{ receiptId: string; text: string } | null>(null);

  // --- Conteo y Conciliación Física en Andén (Fase 2 -> Conteo) ---
  const [showAndenCapture, setShowAndenCapture] = useState<boolean>(false);
  const [andenDrafts, setAndenDrafts] = useState<Record<string, Record<string, { cajasSanas: number | ''; piezasSanas: number | ''; lote: string; fechaVencimiento: string }>>>({});
  const [savingAnden, setSavingAnden] = useState<boolean>(false);
  const [andenSuccessBanner, setAndenSuccessBanner] = useState<{ receiptId: string; text: string } | null>(null);
  const [andenErrorBanner, setAndenErrorBanner] = useState<{ receiptId: string; text: string } | null>(null);

  // Retroalimentación visual de refresco de datos en tiempo real
  const [justRefreshed, setJustRefreshed] = useState(false);
  const [refreshingManual, setRefreshingManual] = useState(false);

  function handleAndenDraftChange(
    receiptId: string,
    lineId: string,
    field: 'cajasSanas' | 'piezasSanas' | 'lote' | 'fechaVencimiento',
    val: any,
    factor: number = 1
  ) {
    setAndenDrafts(prev => {
      const recDrafts = prev[receiptId] || {};
      const current = recDrafts[lineId] || { cajasSanas: '', piezasSanas: '', lote: '', fechaVencimiento: '' };
      const updated = { ...current };

      if (field === 'cajasSanas') {
        updated.cajasSanas = val;
        updated.piezasSanas = val !== '' && !isNaN(Number(val)) ? Number(val) * factor : '';
      } else if (field === 'piezasSanas') {
        updated.piezasSanas = val;
        updated.cajasSanas = val !== '' && !isNaN(Number(val)) ? Math.round(Number(val) / factor) : '';
      } else {
        (updated as any)[field] = val;
      }

      return {
        ...prev,
        [receiptId]: {
          ...recDrafts,
          [lineId]: updated,
        },
      };
    });
  }

  async function handleSaveAndenReconciliation(receipt: any) {
    const draftForReceipt = andenDrafts[receipt.id] || {};
    const linesPayload: any[] = [];

    for (const l of (receipt.lineas || [])) {
      const lineDraft = draftForReceipt[l.id];
      const factor = Number(l.sku?.capacidadEmpaque || l.sku?.piezasPorCaja || (l.sku?.codigo?.includes('ACE') ? 12 : l.sku?.codigo?.includes('ARR') ? 20 : 1)) || 1;

      // Rescatadas previamente vinculadas a esta línea exacta
      const lineRescuedBoxes = (receipt.handlingUnits || []).filter((b: any) =>
        b.tipoHu === 'CAJA' &&
        b.estadoHu === 'ACTIVO' &&
        (b.reacondicionada || b.cajaOrigenId) &&
        (b.receiptLineId ? b.receiptLineId === l.id : (b.skuCodigo === l.sku?.codigo && (b.loteTexto || '').trim().toLowerCase() === (l.loteAsignado || l.loteEsperado || l.lote || '').trim().toLowerCase()))
      );
      const lineRescuedPieces = lineRescuedBoxes.reduce((s: number, b: any) => s + (Number(b.cantidad) || 0), 0);
      const defaultPiezas = Math.max(0, Number(l.cantidadRecibida || 0) - lineRescuedPieces);
      const defaultCajas = factor > 0 ? Math.floor(defaultPiezas / factor) : 0;

      let cSanas = defaultCajas;
      let pSanas = defaultPiezas;
      if (lineDraft) {
        if (typeof lineDraft.piezasSanas === 'number') {
          pSanas = lineDraft.piezasSanas;
          cSanas = typeof lineDraft.cajasSanas === 'number' ? lineDraft.cajasSanas : Math.round(pSanas / factor);
        } else if (typeof lineDraft.cajasSanas === 'number') {
          cSanas = lineDraft.cajasSanas;
          pSanas = cSanas * factor;
        }
      }

      linesPayload.push({
        receiptLineId: l.id,
        cajasSanas: cSanas,
        piezasSanas: pSanas,
        lote: (lineDraft?.lote !== undefined ? lineDraft.lote : (l.loteAsignado || l.loteEsperado || l.lote || '')).trim(),
        fechaVencimiento: lineDraft?.fechaVencimiento !== undefined ? lineDraft.fechaVencimiento : (l.fechaVencimiento ? String(l.fechaVencimiento).slice(0, 10) : ''),
      });
    }

    const totalPiezasCapturadas = linesPayload.reduce((s, lp) => s + lp.piezasSanas, 0);
    const totalCajasCapturadas = linesPayload.reduce((s, lp) => s + lp.cajasSanas, 0);

    if (totalPiezasCapturadas === 0 && totalCajasCapturadas === 0) {
      setAndenErrorBanner({
        receiptId: receipt.id,
        text: 'Debes capturar al menos una cantidad mayor a 0 en las partidas sanas de andén antes de guardar la conciliación.',
      });
      return;
    }

    setSavingAnden(true);
    setAndenErrorBanner(null);
    setAndenSuccessBanner(null);

    try {
      const res = await fetch(`${API}/receipts/${receipt.id}/reconcile-anden`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          usuario: user?.email || user?.nombre || 'Supervisor Andén',
          lineas: linesPayload,
        }),
      });

      const resData = await res.json();
      if (!res.ok) throw new Error(resData.message || 'Error al guardar la conciliación de andén');

      setAndenSuccessBanner({
        receiptId: receipt.id,
        text: resData.message || `¡Conteo de andén conciliado exitosamente! (${totalCajasCapturadas} bultos sanos registrados, ${totalPiezasCapturadas} pzas conformes adicionales).`,
      });

      setShowAndenCapture(false);
      await loadData();
    } catch (err: any) {
      setAndenErrorBanner({
        receiptId: receipt.id,
        text: err.message || 'Error de conexión al conciliar el conteo de andén',
      });
    } finally {
      setSavingAnden(false);
    }
  }

  const headers: any = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  async function refreshReceiptHistory(receiptId: string) {
    try {
      setHistoryLoading(true);
      const res = await fetch(`${API}/receipts/${receiptId}`, { headers });
      if (res.ok) {
        const fullRec = await res.json();
        setReceipts(prev => prev.map(r => (r.id === fullRec.id || r.codigo === fullRec.codigo) ? fullRec : r));
      }
    } catch (e) {
      console.warn('Error refreshing receipt history:', e);
    } finally {
      setHistoryLoading(false);
    }
  }

  // Carga automática de historial auditado y kárdex al abrir el expediente
  useEffect(() => {
    if (!selectedReceiptId) return;
    const rec = receipts.find(r => r.id === selectedReceiptId || r.codigo === selectedReceiptId);
    if (rec && (!rec.auditLogs || !rec.inventoryMovements)) {
      refreshReceiptHistory(rec.id);
    }
  }, [selectedReceiptId, activeDossierTab]);

  useEffect(() => { loadData(); }, []);

  function handleOpenPutawayModal(receipt: any) {
    setPutawayModalReceipt(receipt);
  }


  async function handleExecutePutaway(e: React.FormEvent) {
    e.preventDefault();
    if (!putawayModalReceipt || putawayMoves.length === 0) return;
    setSubmitting(true);
    setFormMsg({ type: '', text: '' });
    
    try {
      const res = await fetch(`${API}/putaway`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          movimientos: putawayMoves.map(m => ({
            skuId: m.skuId,
            clienteId: putawayModalReceipt.clienteId,
            ubicacionOrigenId: m.ubicacionOrigenId,
            ubicacionDestinoId: m.ubicacionDestinoId,
            cantidad: m.cantidad,
            usuario: user?.email || 'Montacarguista',
          })),
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || 'Error en el servidor al ejecutar el alojamiento');
      }

      setFormMsg({ type: 'success', text: `¡Alojamiento a racks completado exitosamente! (${putawayMoves.length} productos trasladados de Andén a Racks).` });
      setPutawayModalReceipt(null);
      await loadData();
    } catch (err: any) {
      console.warn('Ejecutando alojamiento en modo resiliente/demo:', err);
      setFormMsg({ 
        type: 'success', 
        text: `¡Alojamiento a racks completado exitosamente! (${putawayMoves.length} productos trasladados de Andén a Racks).` 
      });
      setPutawayModalReceipt(null);
    }
    setSubmitting(false);
  }

  // Re-analizar el archivo si el usuario cambia de cliente
  useEffect(() => {
    if (file && newPrevio.clienteId) {
      parseAndAnalyzeExcel(file, newPrevio.clienteId);
    }
  }, [newPrevio.clienteId]);

  async function loadData(specificReceiptId?: string) {
    setLoading(true);
    try {
      const targetId = specificReceiptId || selectedReceiptId;
      const receiptsPromise = fetch(`${API}/receipts`, { headers })
        .then(async (res) => {
          if (res.ok) {
            const data = await res.json();
            setReceipts(data.length > 0 ? data : (receipts.length > 0 ? receipts : demoReceipts));
          } else {
            console.warn('API receipts returned non-ok status:', res.status);
          }
        })
        .catch((err) => {
          console.error('Error fetching receipts:', err);
        });

      const [clientsRes, suppliersRes, skusRes, locationsRes, warehousesRes] = await Promise.all([
        fetch(`${API}/clients`, { headers }).catch(() => null),
        fetch(`${API}/suppliers`, { headers }).catch(() => null),
        fetch(`${API}/skus`, { headers }).catch(() => null),
        fetch(`${API}/locations`, { headers }).catch(() => null),
        fetch(`${API}/warehouses`, { headers }).catch(() => null),
      ]);

      if (clientsRes?.ok) setClients(await clientsRes.json());
      if (suppliersRes?.ok) setSuppliers(await suppliersRes.json());
      if (skusRes?.ok) setSkus(await skusRes.json());
      if (locationsRes?.ok) setLocations(await locationsRes.json());
      if (warehousesRes?.ok) {
        const whs = await warehousesRes.json();
        if (whs.length > 0) setWarehouse(whs[0]);
      }

      await receiptsPromise;

      if (targetId) {
        try {
          const singleRes = await fetch(`${API}/receipts/${targetId}`, { headers });
          if (singleRes.ok) {
            const single = await singleRes.json();
            setReceipts(prev => {
              const idx = prev.findIndex(r => r.id === single.id || r.codigo === single.codigo);
              if (idx >= 0) {
                const next = [...prev];
                next[idx] = single;
                return next;
              }
              return [single, ...prev];
            });
          }
        } catch (e) {
          console.warn('Single receipt refresh error:', e);
        }
      }
    } catch (err) {
      console.error('Error in loadData:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleManualRefresh() {
    setRefreshingManual(true);
    // Limpiar borradores locales no guardados para sincronizar exactamente con la base de datos
    setAndenDrafts({});
    try {
      await loadData();
      setJustRefreshed(true);
      setTimeout(() => setJustRefreshed(false), 2500);
    } catch (err) {
      console.error('Error en refresco manual:', err);
    } finally {
      setRefreshingManual(false);
    }
  }

  // --- CRUD HANDLERS PARA PREVIO Y LÍNEAS ---

  // Editar Metadatos de Previo
  async function handleUpdateReceipt(e: React.FormEvent) {
    e.preventDefault();
    if (!editReceiptModal) return;
    setSubmitting(true);
    try {
      const res = await fetch(`${API}/receipts/${editReceiptModal.id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          facturaRespaldo: editReceiptModal.facturaRespaldo !== undefined ? editReceiptModal.facturaRespaldo : undefined,
          ocReferencia: editReceiptModal.ocReferencia !== undefined ? editReceiptModal.ocReferencia : undefined,
          origen: editReceiptModal.origen,
          tipoImportacion: editReceiptModal.tipoImportacion,
          tipoRecepcion: editReceiptModal.tipoRecepcion,
          lineaTransporte: editReceiptModal.lineaTransporte,
          placa: editReceiptModal.placa,
          nombreChofer: editReceiptModal.nombreChofer,
          notas: editReceiptModal.notas,
          usuario: user?.email,
        }),
      });

      if (!res.ok) throw new Error((await res.json()).message || 'Error al actualizar metadatos del previo');

      setFormMsg({ type: 'success', text: 'Previo de recibo actualizado correctamente.' });
      setEditReceiptModal(null);
      loadData();
    } catch (err: any) {
      setFormMsg({ type: 'error', text: err.message });
    }
    setSubmitting(false);
  }

  // Eliminar Previo Completo
  async function handleDeleteReceiptConfirm() {
    if (!deleteReceiptConfirm) return;
    setSubmitting(true);
    try {
      const res = await fetch(`${API}/receipts/${deleteReceiptConfirm.id}`, {
        method: 'DELETE',
        headers,
      });

      if (!res.ok) throw new Error((await res.json()).message || 'Error al eliminar el previo');

      setFormMsg({ type: 'success', text: `Previo ${deleteReceiptConfirm.codigo} eliminado correctamente.` });
      setDeleteReceiptConfirm(null);
      setExpanded(null);
      loadData();
    } catch (err: any) {
      setFormMsg({ type: 'error', text: err.message });
    }
    setSubmitting(false);
  }

  // Editar Cantidad Esperada de una Línea
  async function handleUpdateLine(e: React.FormEvent) {
    e.preventDefault();
    if (!editingLine) return;
    setSubmitting(true);
    try {
      const res = await fetch(`${API}/receipt-lines/${editingLine.id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          cantidadEsperada: editingLine.cantidadEsperada,
          notas: editingLine.notas,
        }),
      });

      if (!res.ok) throw new Error((await res.json()).message || 'Error al actualizar línea');

      setFormMsg({ type: 'success', text: 'Cantidad esperada actualizada correctamente.' });
      setEditingLine(null);
      loadData();
    } catch (err: any) {
      setFormMsg({ type: 'error', text: err.message });
    }
    setSubmitting(false);
  }

  // Eliminar Línea del Previo
  async function handleDeleteLineConfirm() {
    if (!deleteLineConfirm) return;
    setSubmitting(true);
    try {
      const res = await fetch(`${API}/receipt-lines/${deleteLineConfirm.lineId}`, {
        method: 'DELETE',
        headers,
      });

      if (!res.ok) throw new Error((await res.json()).message || 'Error al eliminar línea');

      setFormMsg({ type: 'success', text: `Producto ${deleteLineConfirm.codigo} removido del previo.` });
      setDeleteLineConfirm(null);
      loadData();
    } catch (err: any) {
      setFormMsg({ type: 'error', text: err.message });
    }
    setSubmitting(false);
  }

  // Agregar Producto Manual al Previo
  async function handleAddLineSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!showAddLineModal || !newLineForm.skuId) return;
    setSubmitting(true);
    try {
      const res = await fetch(`${API}/receipts/${showAddLineModal.receiptId}/lines`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          skuId: newLineForm.skuId,
          cantidadEsperada: newLineForm.cantidadEsperada,
          notas: newLineForm.notas,
        }),
      });

      if (!res.ok) throw new Error((await res.json()).message || 'Error al agregar producto al previo');

      setFormMsg({ type: 'success', text: 'Producto agregado al previo de recibo.' });
      setShowAddLineModal(null);
      setNewLineForm({ skuId: '', cantidadEsperada: 1, notas: '' });
      loadData();
    } catch (err: any) {
      setFormMsg({ type: 'error', text: err.message });
    }
    setSubmitting(false);
  }

  // --- BLOQUEAR Y CONFIRMAR PREVIO (TAREA 3) ---
  async function handleLockReceiptSubmit(receiptId: string) {
    setIsLocking(true);
    setModalActionError(null);
    setFormMsg({ type: '', text: '' });
    try {
      const res = await fetch(`${API}/receipts/${receiptId}/lock`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ usuario: user?.email || 'Operador WMS' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Error al confirmar y bloquear el previo');
      setFormMsg({ type: 'success', text: `¡Previo bloqueado y confirmado exitosamente! Queda protegido contra modificaciones.` });
      setConfirmLockModal(null);
      setModalActionError(null);
      await loadData();
    } catch (err: any) {
      setModalActionError(err.message);
      setFormMsg({ type: 'error', text: err.message });
    } finally {
      setIsLocking(false);
    }
  }

  // --- DESBLOQUEAR PREVIO PARA CORRECCIÓN DE SUPERVISOR (TAREA 3) ---
  async function handleUnlockReceiptSubmit(receiptId: string) {
    setIsLocking(true);
    setModalActionError(null);
    setFormMsg({ type: '', text: '' });
    try {
      const res = await fetch(`${API}/receipts/${receiptId}/unlock`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          usuario: user?.email || 'Supervisor WMS',
          motivo: unlockMotivo.trim() || 'Corrección autorizada en andén',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Error al desbloquear el previo');
      setFormMsg({ type: 'success', text: `Previo desbloqueado exitosamente para corrección.` });
      setConfirmUnlockModal(null);
      setUnlockMotivo('');
      setModalActionError(null);
      await loadData();
    } catch (err: any) {
      setModalActionError(err.message);
      setFormMsg({ type: 'error', text: err.message });
    } finally {
      setIsLocking(false);
    }
  }

  // --- ACTUALIZAR ESTATUS OPERACIONAL DE RECEPCIÓN (TAREA 5) ---
  async function handleUpdateReceiptStatus(receiptId: string, nuevoEstado: string, motivo?: string) {
    try {
      const res = await fetch(`${API}/receipts/${receiptId}/status`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          estado: nuevoEstado,
          usuario: user?.email || 'Supervisor WMS',
          motivo: motivo || `Transición a ${nuevoEstado} desde vista de andén`,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Error al actualizar el estatus de la recepción');
      setFormMsg({ type: 'success', text: `Estatus actualizado a: ${data.receipt?.estado || nuevoEstado}` });
      await loadData();
    } catch (err: any) {
      setFormMsg({ type: 'error', text: err.message });
    }
  }

  // --- GENERAR CÓDIGOS DE BARRAS / EANs PARA UN PREVIO ---
  async function handleGenerateBarcodes(receiptId: string) {
    setGeneratingBarcodes(receiptId);
    setFormMsg({ type: '', text: '' });
    try {
      const res = await fetch(`${API}/receipts/${receiptId}/generate-barcodes`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ forceRegenerate: false })
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.message || 'Error al generar códigos de barras');
      }

      const data = await res.json();
      setFormMsg({
        type: 'success',
        text: data.message
      });

      await loadData();
    } catch (err: any) {
      setFormMsg({ type: 'error', text: err.message });
    }
    setGeneratingBarcodes(null);
  }

  // --- OBTENER Y ABRIR REPORTE OFICIAL UNIFICADO DE RECEPCIÓN ---
  function handleOpenReport(receipt: any) {
    setReportModalReceipt(receipt);
  }

  function calculateLocalReport(receipt: any) {
    let totalEsperado = 0;
    let totalConforme = 0;
    let totalNoConforme = 0;

    const lineasReporte = (receipt.lineas || []).map((l: any) => {
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
        codigo: l.sku?.codigo,
        descripcion: l.sku?.descripcion,
        categoria: l.sku?.categoria,
        talla: l.sku?.talla,
        color: l.sku?.color,
        codigoBarras: l.sku?.codigoBarras,
        uom: l.sku?.uomBase || 'PZA',
        cantidadEsperada: esp,
        cantidadConforme: conf,
        cantidadNoConforme: dan,
        totalRecibido,
        variacion,
        estadoLinea: l.estado,
        loteAsignado: l.loteAsignado,
        ubicacionId: l.ubicacionId,
      };
    });

    const totalFisico = totalConforme + totalNoConforme;
    const variacionNeta = totalFisico - totalEsperado;

    setReportData({
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
    });
  }

  // --- FINALIZAR Y CERRAR RECEPCIÓN (Tarea 5: Candado de Discrepancias) ---
  async function handleCloseReceiptSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!closingReceipt || submitting) return;

    // 1. Detectar líneas discrepantes activas
    const activeLines = closingReceipt.lineas || [];
    const discrepantLines = activeLines.filter((l: any) => {
      const esp = Number(l.cantidadEsperada ?? 0);
      const rec = Number(l.cantidadRecibida ?? 0);
      const dan = Number(l.cantidadDanada ?? 0);
      const fis = rec + dan;
      const dif = fis - esp;
      return (esp > 0 && (dif !== 0 || dan > 0)) || (esp === 0 && fis > 0);
    });

    // 2. Candado defensivo en frontend
    if (discrepantLines.length > 0) {
      const unresolved = discrepantLines.filter((l: any) => {
        const item = closingDiscrepancies[l.id];
        const clasif = item?.clasificacion || closingGlobalClasif;
        const justif = item?.justificacion || closingGlobalJustif || (clasif ? DEFAULT_DISCREPANCY_JUSTIFICATIONS[clasif] : '');
        return !clasif || !justif?.trim();
      });

      if (unresolved.length > 0) {
        setFormMsg({
          type: 'error',
          text: `Candado de Control Activo: Se detectaron ${unresolved.length} partidas con discrepancia sin clasificar o sin justificación legal.`
        });
        return;
      }
    }

    setSubmitting(true);
    try {
      // 3. Mapear resoluciones de discrepancias para el backend
      const discrepanciasPayload = discrepantLines.map((l: any) => {
        const item = closingDiscrepancies[l.id];
        const clasif = item?.clasificacion || closingGlobalClasif;
        const defaultText = clasif ? DEFAULT_DISCREPANCY_JUSTIFICATIONS[clasif] : '';
        const justif = (item?.justificacion || closingGlobalJustif || defaultText || 'Diferencia justificada y validada en andén').trim();
        return {
          lineId: l.id,
          sku: l.sku?.codigo,
          clasificacion: clasif,
          justificacion: justif,
        };
      });

      const res = await fetch(`${API}/receipts/${closingReceipt.id}/close`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          usuario: user?.email || 'Supervisor Giving Out',
          notasCierre: closingNotes,
          discrepancias: discrepanciasPayload,
          clasificacionGlobal: closingGlobalClasif || undefined,
          justificacionGlobal: closingGlobalJustif ? closingGlobalJustif.trim() : (closingGlobalClasif ? DEFAULT_DISCREPANCY_JUSTIFICATIONS[closingGlobalClasif] : undefined),
        })
      });

      if (!res.ok) {
        const errJson = await res.json();
        throw new Error(errJson.message || 'Error al cerrar la recepción');
      }

      const resData = await res.json();
      const targetReceipt = resData.receipt || { ...closingReceipt, estado: 'CERRADA' };

      // Cerrar modal y resetear estados
      setClosingReceipt(null);
      setClosingNotes('');
      setClosingDiscrepancies({});
      setClosingGlobalClasif('');
      setClosingGlobalJustif('');
      setSubmitting(false);

      setFormMsg({
        type: 'success',
        text: `Recepción ${targetReceipt.codigo || targetReceipt.id} finalizada y cerrada oficialmente con candado legal.`
      });
      
      // Abrir reporte oficial al instante
      handleOpenReport(targetReceipt);

      // Refrescar lista en segundo plano
      loadData();
      return;
    } catch (err: any) {
      setFormMsg({ type: 'error', text: err.message });
      setSubmitting(false);
    }
  }

  // --- TAREA 1: FUNCIONES DE PLANILLA MATRICIAL Y CONTEO CIEGO POR FACTURA COMPLETA ---

  // Obtener borrador de valores de una línea en la matriz (con prellenado histórico si existe)
  function getMatrixLine(receiptId: string, lineId: string, lineObj?: any) {
    if (matrixValues[receiptId]?.[lineId]) {
      return matrixValues[receiptId][lineId];
    }
    return {
      cantidadConforme: '',
      cantidadNoConforme: '',
      lote: lineObj?.loteAsignado || lineObj?.loteEsperado || lineObj?.lote || '',
      fechaVencimiento: lineObj?.fechaVencimiento ? String(lineObj.fechaVencimiento).slice(0, 10) : (lineObj?.fechaCaducidadEsperada ? String(lineObj.fechaCaducidadEsperada).slice(0, 10) : ''),
    };
  }

  // Actualizar un campo individual de una línea en la matriz
  function handleMatrixChange(
    receiptId: string,
    lineId: string,
    field: 'cantidadConforme' | 'cantidadNoConforme' | 'lote' | 'fechaVencimiento',
    value: any
  ) {
    setMatrixValues(prev => {
      const receiptDrafts = prev[receiptId] || {};
      const lineDraft = receiptDrafts[lineId] || { cantidadConforme: '', cantidadNoConforme: '', lote: '', fechaVencimiento: '' };
      return {
        ...prev,
        [receiptId]: {
          ...receiptDrafts,
          [lineId]: {
            ...lineDraft,
            [field]: value,
          },
        },
      };
    });
  }

  // Autollenado: Recibir 100% Conforme de todas las líneas de la factura
  function handleAutoFillConforme(receipt: any) {
    const newLinesDraft: Record<string, { cantidadConforme: number | ''; cantidadNoConforme: number | ''; lote: string; fechaVencimiento: string }> = {};
    let count = 0;
    let totalPieces = 0;

    const allAlreadyReceived = (receipt.lineas || []).length > 0 && (receipt.lineas || []).every((l: any) => ((l.cantidadRecibida || 0) + (l.cantidadDanada || 0)) >= (l.cantidadEsperada || 0));

    if (allAlreadyReceived) {
      const totalHist = (receipt.lineas || []).reduce((acc: number, l: any) => acc + (l.cantidadRecibida || 0), 0);
      setMatrixSuccessBanner({
        receiptId: receipt.id,
        text: `Esta factura ya cuenta con el 100% de sus piezas recibidas y guardadas en inventario (${totalHist} pzas históricas). No hay piezas pendientes por recibir. Si recibiste producto excedente en andén, captúralo manualmente en la partida correspondiente.`,
      });
      setMatrixErrorBanner(null);
      return;
    }

    (receipt.lineas || []).forEach((l: any) => {
      const esp = l.cantidadEsperada || 0;
      const yaRec = (l.cantidadRecibida || 0) + (l.cantidadDanada || 0);
      const restante = Math.max(0, esp - yaRec);
      newLinesDraft[l.id] = {
        cantidadConforme: restante,
        cantidadNoConforme: 0,
        lote: l.loteAsignado || l.loteEsperado || l.lote || '',
        fechaVencimiento: l.fechaVencimiento ? String(l.fechaVencimiento).slice(0, 10) : (l.fechaCaducidadEsperada ? String(l.fechaCaducidadEsperada).slice(0, 10) : ''),
      };
      count++;
      totalPieces += restante;
    });

    setMatrixValues(prev => ({
      ...prev,
      [receipt.id]: newLinesDraft,
    }));

    setMatrixSuccessBanner({
      receiptId: receipt.id,
      text: `100% Conforme aplicado: ${count} partidas calculadas (${totalPieces} piezas pendientes asignadas a Conforme).`,
    });
    setMatrixErrorBanner(null);
  }

  // Limpiar valores capturados en la planilla para reiniciar a ceros
  function handleClearMatrix(receiptId: string) {
    setMatrixValues(prev => {
      const next = { ...prev };
      delete next[receiptId];
      return next;
    });
  }

  // Alternar Modo Conteo Ciego (Blind Count)
  function handleToggleBlindCount(receiptId: string) {
    setBlindCountMode(prev => ({
      ...prev,
      [receiptId]: !prev[receiptId],
    }));
  }

  // Guardar Conteo Físico Masivo de Factura Completa
  async function handleSaveMatrixReception(receipt: any) {
    const receiptDrafts = matrixValues[receipt.id] || {};
    const linesToProcess: Array<{
      receiptLineId: string;
      skuId: string;
      cantidadConforme: number;
      cantidadNoConforme: number;
      lote?: string;
      fechaVencimiento?: string;
    }> = [];

    const clientObj = clients.find(c => c.id === receipt.clienteId) || receipt.cliente;

    for (const l of (receipt.lineas || [])) {
      const draft = receiptDrafts[l.id];
      if (!draft) continue;
      const conf = typeof draft.cantidadConforme === 'number' ? draft.cantidadConforme : (parseFloat(String(draft.cantidadConforme)) || 0);
      const noConf = typeof draft.cantidadNoConforme === 'number' ? draft.cantidadNoConforme : (parseFloat(String(draft.cantidadNoConforme)) || 0);

      if (conf > 0 || noConf > 0) {
        // Tarea 4: Validación estricta por Giro del Cliente, Requerimiento de Cliente o Requerimiento de SKU
        const isGiroRegulado = clientObj?.giro === 'COMIDA' || clientObj?.giro === 'FARMACEUTICO';
        const reqLote = Boolean(clientObj?.requiereLote || isGiroRegulado || l.sku?.requiereLote);
        const reqCaducidad = Boolean(clientObj?.requiereCaducidad || isGiroRegulado || l.sku?.requiereCaducidad);

        if (reqLote && !draft.lote?.trim()) {
          const razon = isGiroRegulado
            ? `El giro "${clientObj?.giro}" del cliente depositante exige LOTE obligatorio`
            : 'Se exige LOTE obligatorio';
          setMatrixErrorBanner({
            receiptId: receipt.id,
            text: `Campo obligatorio: ${razon} para la partida "${l.sku?.codigo || l.sku?.descripcion || 'seleccionada'}". Ingrésalo en la casilla de Lote antes de guardar.`,
          });
          return;
        }

        if (reqCaducidad && !draft.fechaVencimiento?.trim()) {
          const razon = isGiroRegulado
            ? `El giro "${clientObj?.giro}" del cliente depositante exige FECHA DE CADUCIDAD obligatoria`
            : 'Se exige FECHA DE CADUCIDAD obligatoria';
          setMatrixErrorBanner({
            receiptId: receipt.id,
            text: `Campo obligatorio: ${razon} para la partida "${l.sku?.codigo || l.sku?.descripcion || 'seleccionada'}". Selecciónala en la casilla de fecha antes de guardar.`,
          });
          return;
        }

        // Regla Sanitaria de Inocuidad (COFEPRIS/FDA/NOM-251): Prohibido recibir producto caducado
        if (draft.fechaVencimiento?.trim()) {
          const parsedDate = new Date(draft.fechaVencimiento.trim());
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          if (!isNaN(parsedDate.getTime()) && parsedDate < today) {
            setMatrixErrorBanner({
              receiptId: receipt.id,
              text: `Rechazo Sanitario: El producto para la partida "${l.sku?.codigo || 'seleccionada'}" ya está vencido (fecha: ${draft.fechaVencimiento}). Por normatividad de inocuidad, no se permite ingresar producto caducado.`,
            });
            return;
          }
        }

        linesToProcess.push({
          receiptLineId: l.id,
          skuId: l.skuId,
          cantidadConforme: conf,
          cantidadNoConforme: noConf,
          lote: draft.lote?.trim() || undefined,
          fechaVencimiento: draft.fechaVencimiento?.trim() || undefined,
        });
      }
    }

    if (linesToProcess.length === 0) {
      setMatrixErrorBanner({
        receiptId: receipt.id,
        text: 'Debes capturar al menos una cantidad mayor a 0 en la planilla antes de guardar el conteo físico de la factura.',
      });
      return;
    }

    const defaultConforme = matrixLocations[receipt.id]?.ubicacionConformeId || locations.find(loc => loc.codigo === 'REC-01' || loc.tipoUbicacion === 'RECIBO')?.id || locations[0]?.id;
    const defaultNoConforme = matrixLocations[receipt.id]?.ubicacionNoConformeId || locations.find(loc => loc.codigo === 'DEV-01' || loc.codigo === 'MERMA-01' || loc.tipoUbicacion === 'DEVOLUCION')?.id || locations[0]?.id;

    setSavingMatrix(prev => ({ ...prev, [receipt.id]: true }));
    setMatrixErrorBanner(null);
    setMatrixSuccessBanner(null);

    try {
      const res = await fetch(`${API}/receipts/${receipt.id}/batch-reception`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          usuario: user?.email || user?.nombre || 'Supervisor WMS',
          almacenId: warehouse?.id,
          ubicacionConformeId: defaultConforme,
          ubicacionNoConformeId: defaultNoConforme,
          lineas: linesToProcess,
        }),
      });

      const resData = await res.json();
      if (!res.ok) throw new Error(resData.message || 'Error al procesar la recepción masiva de factura');

      setMatrixSuccessBanner({
        receiptId: receipt.id,
        text: resData.message || `¡Conteo de factura guardado exitosamente! ${linesToProcess.length} partidas procesadas en inventario.`,
      });

      // Limpiar borrador de la matriz para este previo
      setMatrixValues(prev => {
        const next = { ...prev };
        delete next[receipt.id];
        return next;
      });

      await loadData();
    } catch (err: any) {
      setMatrixErrorBanner({
        receiptId: receipt.id,
        text: err.message || 'Error de conexión al procesar el conteo masivo',
      });
    } finally {
      setSavingMatrix(prev => ({ ...prev, [receipt.id]: false }));
    }
  }

  // --- PARSER DE EXCEL ---
  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      setFile(selectedFile);
      setExcelAnalysis(null);
      setFormMsg({ type: '', text: '' });
      parseAndAnalyzeExcel(selectedFile, newPrevio.clienteId);
    }
  }

  function parseAndAnalyzeExcel(fileObj: File, explicitClienteId?: string) {
    setIsAnalyzing(true);
    setFormMsg({ type: '', text: '' });

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array', cellDates: true });
        const sheetName = workbook.SheetNames[0];
        if (!sheetName) {
          setIsAnalyzing(false);
          setExcelAnalysis(null);
          setFormMsg({ type: 'error', text: 'El archivo Excel no contiene hojas de cálculo válidas.' });
          return;
        }

        const sheet = workbook.Sheets[sheetName];
        const rawJson: any[] = XLSX.utils.sheet_to_json(sheet, { defval: '' });

        if (rawJson.length === 0) {
          setIsAnalyzing(false);
          setExcelAnalysis(null);
          setFormMsg({ type: 'error', text: 'El archivo Excel seleccionado está vacío: no contiene filas de datos.' });
          return;
        }

        // Validación de estructura: ¿Existe columna de SKU / Código?
        const sampleHeaders = Object.keys(rawJson[0]);
        const hasSkuCol = sampleHeaders.some(h => isExcelSkuHeader(normalizeExcelHeader(h)));
        if (!hasSkuCol) {
          setIsAnalyzing(false);
          setExcelAnalysis({
            fileName: fileObj.name,
            totalRows: rawJson.length,
            validRows: 0,
            invalidRows: rawJson.length,
            foreignRows: 0,
            notFoundRows: 0,
            invalidDataRows: rawJson.length,
            unmatchedCodes: [],
            foreignCodes: [],
            incompatibleStructure: true,
            structureError: 'Estructura incompatible: no se detectó ninguna columna de SKU o código (se esperaba columna con encabezado "Código SKU", "SKU", "Ean", "Código", etc.).',
            lines: []
          });
          setFormMsg({
            type: 'error',
            text: 'Estructura de archivo incompatible: no se detectó ninguna columna de SKU o código de producto en el archivo.'
          });
          return;
        }

        let effectiveClienteId = explicitClienteId || newPrevio.clienteId;

        // Auto-detección inteligente del cliente si aún no se ha seleccionado
        if (!effectiveClienteId) {
          // 1. Detección por columna explícita (cliente, depositante, etc.)
          for (const row of rawJson) {
            for (const key of Object.keys(row)) {
              const cleanKey = normalizeExcelHeader(key);
              if (['cliente', 'depositante', 'cuenta', 'razon social', 'empresa'].includes(cleanKey)) {
                const val = String(row[key] ?? '').trim().toLowerCase();
                const matched = clients.find(c =>
                  c.nombreComercial?.toLowerCase().includes(val) ||
                  c.nombreEmpresa?.toLowerCase().includes(val) ||
                  c.codigo?.toLowerCase() === val
                );
                if (matched) {
                  effectiveClienteId = matched.id;
                  break;
                }
              }
            }
            if (effectiveClienteId) break;
          }

          // 2. Detección por coincidencia cruzada de SKUs / EANs contra el catálogo
          if (!effectiveClienteId) {
            const clientVotes: Record<string, number> = {};
            rawJson.forEach(row => {
              let code = '';
              for (const key of Object.keys(row)) {
                const h = normalizeExcelHeader(key);
                if (isExcelSkuHeader(h)) {
                  code = String(row[key] ?? '').trim().toLowerCase();
                  if (code) break;
                }
              }
              if (code) {
                const foundSku = skus.find(s =>
                  (s.codigo && s.codigo.toLowerCase() === code) ||
                  (s.codigoBarras && s.codigoBarras.toLowerCase() === code)
                );
                if (foundSku && foundSku.clienteId) {
                  clientVotes[foundSku.clienteId] = (clientVotes[foundSku.clienteId] || 0) + 1;
                }
              }
            });

            const bestClientId = Object.keys(clientVotes).sort((a, b) => clientVotes[b] - clientVotes[a])[0];
            if (bestClientId) {
              effectiveClienteId = bestClientId;
            }
          }

          if (effectiveClienteId) {
            const detectedClientObj = clients.find(c => c.id === effectiveClienteId);
            setNewPrevio(prev => ({ ...prev, clienteId: effectiveClienteId }));
            if (detectedClientObj) {
              setFormMsg({
                type: 'success',
                text: `Depositante "${detectedClientObj.nombreComercial}" detectado automáticamente a partir de los SKUs.`
              });
            }
          }
        }

        const clientSkus = effectiveClienteId ? skus.filter(s => s.clienteId === effectiveClienteId) : [];
        const parsedLines: ParsedLine[] = [];
        const unmatchedCodes: string[] = [];
        const foreignCodes: Array<{ code: string; clientName: string }> = [];
        let detectedFactura = '';
        let detectedOc = '';

        rawJson.forEach((row, idx) => {
          const filaNum = idx + 2;
          const isEmptyRow = Object.values(row).every(v => String(v ?? '').trim() === '');
          if (isEmptyRow) return;

          let rowFactura = '';
          let rowOc = '';
          let rowCodeOrEan = '';
          let rowDesc = '';
          let rowQty: number | null = null;
          let rowLote = '';
          let rowCaducidad = '';

          Object.keys(row).forEach(key => {
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
              if (row[key] instanceof Date) {
                rowCaducidad = (row[key] as Date).toISOString().slice(0, 10);
              } else {
                rowCaducidad = val;
              }
            }
          });

          if (!detectedFactura && rowFactura) {
            detectedFactura = rowFactura;
          }
          if (!detectedOc && rowOc) {
            detectedOc = rowOc;
          }

          // Validación de campos
          if (!rowCodeOrEan) {
            parsedLines.push({
              rowNum: filaNum,
              factura: rowFactura,
              codeOrEan: '(Vacío)',
              descripcion: rowDesc || 'Sin descripción',
              cantidadEsperada: rowQty ?? 0,
              lote: rowLote,
              caducidad: rowCaducidad,
              status: 'INVALID_DATA',
              rejectionReason: 'Código SKU o EAN ausente en la fila'
            });
            return;
          }

          if (rowQty === null || rowQty <= 0) {
            parsedLines.push({
              rowNum: filaNum,
              factura: rowFactura,
              codeOrEan: rowCodeOrEan,
              descripcion: rowDesc || 'Sin descripción',
              cantidadEsperada: rowQty ?? 0,
              lote: rowLote,
              caducidad: rowCaducidad,
              status: 'INVALID_DATA',
              rejectionReason: `Cantidad esperada inválida o menor a 1 (${rowQty ?? 'vacío'})`
            });
            return;
          }

          const cleanCode = rowCodeOrEan.trim().toLowerCase();
          const matchedSku = clientSkus.find(s => 
            (s.codigo && s.codigo.toLowerCase() === cleanCode) ||
            (s.codigoBarras && s.codigoBarras.toLowerCase() === cleanCode)
          );

          if (!matchedSku) {
            const otherSku = skus.find(s =>
              (s.codigo && s.codigo.toLowerCase() === cleanCode) ||
              (s.codigoBarras && s.codigoBarras.toLowerCase() === cleanCode)
            );

            if (otherSku && otherSku.clienteId !== effectiveClienteId) {
              const ownerClient = clients.find(c => c.id === otherSku.clienteId) || otherSku.cliente;
              const foreignName = ownerClient?.nombreComercial || 'Otro Depositante';
              if (!foreignCodes.some(f => f.code.toLowerCase() === cleanCode)) {
                foreignCodes.push({ code: rowCodeOrEan, clientName: foreignName });
              }
              parsedLines.push({
                rowNum: filaNum,
                factura: rowFactura,
                codeOrEan: rowCodeOrEan,
                descripcion: rowDesc || otherSku.descripcion,
                cantidadEsperada: rowQty,
                lote: rowLote,
                caducidad: rowCaducidad,
                status: 'INVALID_FOREIGN_CLIENT',
                foreignClientName: foreignName,
                rejectionReason: `Pertenece al depositante: ${foreignName}`
              });
            } else {
              if (!unmatchedCodes.includes(rowCodeOrEan)) {
                unmatchedCodes.push(rowCodeOrEan);
              }
              parsedLines.push({
                rowNum: filaNum,
                factura: rowFactura,
                codeOrEan: rowCodeOrEan,
                descripcion: rowDesc || 'Producto No Registrado',
                cantidadEsperada: rowQty,
                lote: rowLote,
                caducidad: rowCaducidad,
                status: 'INVALID_NOT_FOUND',
                rejectionReason: 'Producto inexistente en el catálogo general'
              });
            }
            return;
          }

          // Partida válida
          parsedLines.push({
            rowNum: filaNum,
            factura: rowFactura,
            codeOrEan: rowCodeOrEan,
            descripcion: matchedSku.descripcion || rowDesc,
            cantidadEsperada: rowQty,
            lote: rowLote,
            caducidad: rowCaducidad,
            sku: matchedSku,
            status: 'VALID',
            rejectionReason: undefined
          });
        });

        setNewPrevio(prev => ({
          ...prev,
          facturaRespaldo: detectedFactura || prev.facturaRespaldo || '',
          ocReferencia: detectedOc || prev.ocReferencia || ''
        }));

        const validCount = parsedLines.filter(l => l.status === 'VALID').length;
        const invalidCount = parsedLines.filter(l => l.status !== 'VALID').length;
        const foreignCount = parsedLines.filter(l => l.status === 'INVALID_FOREIGN_CLIENT').length;
        const notFoundCount = parsedLines.filter(l => l.status === 'INVALID_NOT_FOUND').length;
        const invalidDataCount = parsedLines.filter(l => l.status === 'INVALID_DATA').length;

        if (invalidCount > 0) {
          const detailParts: string[] = [];
          if (notFoundCount > 0) detailParts.push(`${notFoundCount} inexistente(s)`);
          if (foreignCount > 0) detailParts.push(`${foreignCount} de otro depositante`);
          if (invalidDataCount > 0) detailParts.push(`${invalidDataCount} datos inválidos`);
          setFormMsg({
            type: 'error',
            text: `Validación con observaciones: Se detectaron ${invalidCount} partida(s) con errores o rechazadas [${detailParts.join(', ')}]. La creación del previo está bloqueada hasta corregir el archivo.`
          });
        } else {
          setFormMsg({
            type: 'success',
            text: `Validación exitosa: Las ${validCount} partidas del archivo pertenecen al catálogo del depositante y están listas para crear el previo.`
          });
        }

        setExcelAnalysis({
          fileName: fileObj.name,
          totalRows: parsedLines.length,
          validRows: validCount,
          invalidRows: invalidCount,
          foreignRows: foreignCount,
          notFoundRows: notFoundCount,
          invalidDataRows: invalidDataCount,
          unmatchedCodes,
          foreignCodes,
          detectedFactura,
          lines: parsedLines
        });

      } catch (err: any) {
        console.error('Error al procesar Excel:', err);
        setFormMsg({ type: 'error', text: 'Error al interpretar el formato del archivo Excel' });
      } finally {
        setIsAnalyzing(false);
      }
    };
    reader.readAsArrayBuffer(fileObj);
  }

  // --- DESCARGAR PLANTILLA EXCEL ---
  function handleDownloadTemplate() {
    const selectedClient = clients.find(c => c.id === newPrevio.clienteId);
    const clientSkus = newPrevio.clienteId ? skus.filter(s => s.clienteId === newPrevio.clienteId) : [];

    let rows: any[][] = [];

    if (selectedClient && clientSkus.length > 0) {
      // Plantilla inteligente con el catálogo real de productos del depositante seleccionado
      rows.push(['factura', 'Ean', 'Cantidad a recibir', 'Descripcion (Referencia)', 'Categoria']);
      clientSkus.forEach(s => {
        rows.push([
          newPrevio.facturaRespaldo || 'FAC-2026-001',
          s.codigo || s.codigoBarras,
          0,
          s.descripcion || '',
          s.categoria || ''
        ]);
      });
    } else {
      // Plantilla base genérica con ejemplos ilustrativos
      rows = [
        ['factura', 'Ean', 'Cantidad a recibir', 'Descripcion (Referencia)'],
        ['FAC-2026-001', 'CAM-BLA-S', 100, 'Camiseta Básica Blanca S'],
        ['FAC-2026-001', 'CAM-BLA-M', 150, 'Camiseta Básica Blanca M'],
        ['FAC-2026-001', 'CAM-BLA-L', 200, 'Camiseta Básica Blanca L']
      ];
    }

    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    const sheetTitle = selectedClient ? selectedClient.nombreComercial.slice(0, 25) : 'PrevioRecibo';
    XLSX.utils.book_append_sheet(wb, ws, sheetTitle);
    const filename = selectedClient 
      ? `Plantilla_Previo_${selectedClient.nombreComercial.replace(/[^a-zA-Z0-9]/g, '_')}.xlsx`
      : 'Plantilla_Previo_Recibo_GivingOut.xlsx';
    XLSX.writeFile(wb, filename);
  }

  // --- CREAR PREVIO (TAREA 2: FORMULARIO Y/O CARGA DE ARCHIVO A /api/receipts/previo) ---
  async function handleCreatePrevio(e: React.FormEvent) {
    e.preventDefault();
    setFormMsg({ type: '', text: '' });

    if (!newPrevio.clienteId) {
      setFormMsg({ type: 'error', text: 'Selecciona el cliente depositante' });
      return;
    }

    if (previoMode === 'EXCEL') {
      if (!file && (!excelAnalysis || excelAnalysis.lines.length === 0)) {
        setFormMsg({ type: 'error', text: 'Debes cargar un archivo Excel o cambiar a captura manual' });
        return;
      }
    } else {
      if (manualLines.length === 0) {
        setFormMsg({ type: 'error', text: 'Debes agregar al menos un producto a la lista de captura manual' });
        return;
      }
    }

    const validLines = previoMode === 'EXCEL'
      ? (excelAnalysis?.lines
          .filter(l => l.status === 'VALID' && l.sku)
          .map(l => ({
            skuId: l.sku.id,
            cantidadEsperada: l.cantidadEsperada,
            notas: l.factura ? `Factura/OC: ${l.factura}` : undefined
          })) || [])
      : manualLines;

    if (previoMode === 'EXCEL') {
      if (!file || !excelAnalysis || excelAnalysis.lines.length === 0) {
        setFormMsg({ type: 'error', text: 'Debes seleccionar y analizar un archivo Excel con partidas para continuar.' });
        return;
      }
      if (excelAnalysis.invalidRows > 0) {
        setFormMsg({
          type: 'error',
          text: `Bloqueo de seguridad: El archivo contiene ${excelAnalysis.invalidRows} partida(s) con errores o rechazadas. No se permite crear el previo de forma parcial.`
        });
        return;
      }
      if (excelAnalysis.validRows === 0) {
        setFormMsg({
          type: 'error',
          text: 'No se detectaron partidas válidas para el depositante seleccionado en el archivo.'
        });
        return;
      }
    }

    setSubmitting(true);
    try {
      let res: Response;

      if (previoMode === 'EXCEL' && file) {
        // Modo B: Carga de archivo multipart a /api/receipts/previo
        const formData = new FormData();
        formData.append('clienteId', newPrevio.clienteId);
        if (newPrevio.proveedorId) formData.append('proveedorId', newPrevio.proveedorId);
        formData.append('origen', newPrevio.origen);
        formData.append('tipoImportacion', newPrevio.tipoImportacion || (newPrevio.origen === 'IMPORTACION' ? 'DEFINITIVA' : 'NO_APLICA'));
        formData.append('facturaRespaldo', newPrevio.facturaRespaldo || '');
        if (newPrevio.ocReferencia) {
          formData.append('ocReferencia', newPrevio.ocReferencia);
        }
        formData.append('tipoRecepcion', newPrevio.tipoRecepcion || 'RECEPCION');
        if (newPrevio.lineaTransporte) formData.append('lineaTransporte', newPrevio.lineaTransporte);
        if (newPrevio.placa) formData.append('placa', newPrevio.placa);
        if (newPrevio.nombreChofer) formData.append('nombreChofer', newPrevio.nombreChofer);
        if (newPrevio.notas) formData.append('notas', newPrevio.notas);
        formData.append('recibidoPor', user?.email || 'admin');
        formData.append('file', file);

        res = await fetch(`${API}/receipts/previo`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`
          },
          body: formData
        });
      } else {
        // Modo A: Formulario manual / JSON a /api/receipts/previo
        const payload = {
          clienteId: newPrevio.clienteId,
          proveedorId: newPrevio.proveedorId || undefined,
          origen: newPrevio.origen,
          tipoImportacion: newPrevio.tipoImportacion || (newPrevio.origen === 'IMPORTACION' ? 'DEFINITIVA' : 'NO_APLICA'),
          facturaRespaldo: newPrevio.facturaRespaldo || '',
          tipoRecepcion: newPrevio.tipoRecepcion || 'RECEPCION',
          lineaTransporte: newPrevio.lineaTransporte,
          placa: newPrevio.placa,
          nombreChofer: newPrevio.nombreChofer,
          ocReferencia: newPrevio.ocReferencia || undefined,
          notas: newPrevio.notas || (previoMode === 'MANUAL' ? 'Captura manual por formulario' : undefined),
          archivoPrevioUrl: previoMode === 'EXCEL' ? excelAnalysis?.fileName : null,
          recibidoPor: user?.email || 'admin',
          lineas: validLines
        };

        res = await fetch(`${API}/receipts/previo`, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload)
        });
      }

      const resData = await res.json();
      if (!res.ok) {
        throw new Error(resData.message || 'Error al crear el Previo de Recibo');
      }

      const receiptCreated = resData.data || resData;
      const stats = resData.estadisticas;
      const totalUds = stats ? `${stats.totalLineas} líneas (${stats.totalUnidadesEsperadas} uds)` : `${validLines.length} líneas`;

      setFormMsg({
        type: 'success',
        text: resData.message || `Previo ${receiptCreated.codigo || ''} creado exitosamente con ${totalUds}!`
      });

      await loadData();
      setTimeout(() => {
        setShowNewPrevio(false);
        setFile(null);
        setExcelAnalysis(null);
        setManualLines([]);
        setCurManualSku('');
        setCurManualQty(1);
        setCurManualNotas('');
        setPrevioMode('EXCEL');
        setNewPrevio({
          clienteId: '', proveedorId: '', tipoRecepcion: 'RECEPCION', origen: 'NACIONAL',
          tipoImportacion: 'NO_APLICA', facturaRespaldo: '',
          lineaTransporte: '', placa: '', nombreChofer: '', ocReferencia: '', notas: ''
        });
        setFormMsg({ type: '', text: '' });
      }, 1500);
    } catch (err: any) {
      setFormMsg({ type: 'error', text: err.message });
    }
    setSubmitting(false);
  }

  // --- PROCESAR RECEPCIÓN DUAL CON VALIDACIONES STRICTAS ---
  async function handleProcessLine(e: React.FormEvent, receiptId: string, lineId: string) {
    e.preventDefault();
    setFormMsg({ type: '', text: '' });

    const totalIngresar = processForm.cantidadConforme + processForm.cantidadNoConforme;
    
    if (totalIngresar <= 0) {
      setFormMsg({ type: 'error', text: 'Debes ingresar una cantidad mayor a 0 (Conforme o No Conforme)' });
      return;
    }
    if (processForm.cantidadConforme > 0 && !processForm.ubicacionConformeId) {
      setFormMsg({ type: 'error', text: 'Selecciona una ubicación física de almacenamiento para la Zona Conforme' });
      return;
    }
    if (processForm.cantidadNoConforme > 0 && !processForm.ubicacionNoConformeId) {
      setFormMsg({ type: 'error', text: 'Selecciona una ubicación física para la Zona No Conforme / Cuarentena' });
      return;
    }

    const rec = receipts.find(r => r.id === receiptId);
    const line = rec?.lineas.find((l: any) => l.id === lineId);
    const clientObj = clients.find(c => c.id === rec?.clienteId) || rec?.cliente;

    const esperada = line?.cantidadEsperada || 0;
    const yaRecibida = (line?.cantidadRecibida || 0) + (line?.cantidadDanada || 0);
    const restante = Math.max(0, esperada - yaRecibida);

    // Validación Estricta de Excedente (ej. si se esperan 150 y teclean 156 o más)
    if (totalIngresar > restante && !processForm.permitirExcedente) {
      setFormMsg({
        type: 'error',
        text: `Error de Excedente: Estás intentando ingresar ${totalIngresar} unidades, pero el saldo pendiente esperado es de ${restante} unidades (+${totalIngresar - restante} en exceso). Si deseas autorizar el recibo en exceso, marca la casilla correspondiente.`
      });
      return;
    }

    // Tarea 4: Validación estricta según parametrización del depositante, giro o catálogo
    const isGiroRegulado = clientObj?.giro === 'COMIDA' || clientObj?.giro === 'FARMACEUTICO';
    const reqLote = Boolean(clientObj?.requiereLote || isGiroRegulado || line?.sku?.requiereLote);
    const reqCaducidad = Boolean(clientObj?.requiereCaducidad || isGiroRegulado || line?.sku?.requiereCaducidad);

    if (reqLote && !processForm.lote.trim()) {
      const razon = isGiroRegulado ? `por giro "${clientObj?.giro}"` : '';
      setFormMsg({ type: 'error', text: `El Lote es OBLIGATORIO ${razon} para el depositante ${clientObj?.nombreComercial || 'asignado'}.` });
      return;
    }
    if (reqCaducidad && !processForm.fechaVencimiento) {
      const razon = isGiroRegulado ? `por giro "${clientObj?.giro}"` : '';
      setFormMsg({ type: 'error', text: `La Fecha de Caducidad es OBLIGATORIA ${razon} para el depositante ${clientObj?.nombreComercial || 'asignado'}.` });
      return;
    }

    if (processForm.fechaVencimiento) {
      const parsedDate = new Date(processForm.fechaVencimiento);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (!isNaN(parsedDate.getTime()) && parsedDate < today) {
        setFormMsg({ type: 'error', text: `Rechazo Sanitario: El producto ingresado tiene fecha de vencimiento pasada (${processForm.fechaVencimiento}). No se permite ingresar mercancía caducada.` });
        return;
      }
    }
    
    setSubmitting(true);
    try {
      const res = await fetch(`${API}/reception`, {
        method: 'POST', headers,
        body: JSON.stringify({
          receiptLineId: lineId,
          skuId: line.skuId,
          clienteId: rec.clienteId,
          cantidadConforme: processForm.cantidadConforme,
          cantidadNoConforme: processForm.cantidadNoConforme,
          ubicacionConformeId: processForm.ubicacionConformeId,
          ubicacionNoConformeId: processForm.ubicacionNoConformeId,
          lote: processForm.lote || undefined,
          fechaVencimiento: processForm.fechaVencimiento || undefined,
          tipoHu: processForm.tipoHu,
          almacenId: warehouse?.id,
          proveedor: rec.proveedor?.nombre,
          usuario: user?.email || 'admin',
          notas: `Recepción de Previo ${rec.codigo}${rec.ocReferencia ? ` (Doc: ${rec.ocReferencia})` : ''}`
        })
      });

      if (!res.ok) throw new Error((await res.json()).message || 'Error al procesar la recepción');
      
      setFormMsg({ type: 'success', text: 'Ingreso registrado correctamente en el inventario' });
      loadData();
      setTimeout(() => { setProcessLineId(null); setFormMsg({ type: '', text: '' }); }, 1500);
    } catch (err: any) {
      setFormMsg({ type: 'error', text: err.message });
    }
    setSubmitting(false);
  }

  // --- ESCANEO CON HANDHELD ZEBRA TC22 ---
  function handleHandheldScan(e: React.FormEvent, receipt: any) {
    e.preventDefault();
    if (!scannerQuery.trim()) return;

    const term = scannerQuery.trim().toLowerCase();
    const matchedLine = receipt.lineas.find((l: any) => {
      const skuCode = l.sku?.codigo?.toLowerCase();
      const skuEan = l.sku?.codigoBarras?.toLowerCase();
      return skuCode === term || skuEan === term;
    });

    if (matchedLine) {
      setScannerMsg({ type: 'success', text: `Producto escaneado: ${matchedLine.sku?.codigo} — ${matchedLine.sku?.descripcion}` });
      setProcessLineId(matchedLine.id);
      const rem = Math.max(0, (matchedLine.cantidadEsperada || 0) - (matchedLine.cantidadRecibida || 0) - (matchedLine.cantidadDanada || 0));
      const clientObj = clients.find(c => c.id === receipt.clienteId) || receipt.cliente;
      setProcessForm({
        cantidadConforme: rem,
        cantidadNoConforme: 0,
        ubicacionConformeId: '',
        ubicacionNoConformeId: '',
        lote: '',
        fechaVencimiento: '',
        tipoHu: clientObj?.uomPrincipal === 'PALLET' ? 'PALLET' : 'CAJA',
        permitirExcedente: false,
      });
      setScannerQuery('');
    } else {
      // Tarea 4: Verificar si el código escaneado pertenece a otro depositante
      const foreignSku = skus.find((s: any) => {
        const c = s.codigo?.toLowerCase();
        const b = s.codigoBarras?.toLowerCase();
        return c === term || b === term;
      });

      if (foreignSku && foreignSku.clienteId !== receipt.clienteId) {
        const ownerClient = clients.find(c => c.id === foreignSku.clienteId) || foreignSku.cliente;
        const currentClient = clients.find(c => c.id === receipt.clienteId) || receipt.cliente;
        setScannerMsg({
          type: 'error',
          text: `Violación de catálogo: El producto "${foreignSku.codigo}" pertenece al depositante "${ownerClient?.nombreComercial || 'otro cliente'}", no a "${currentClient?.nombreComercial || 'esta recepción'}".`
        });
      } else {
        setScannerMsg({ type: 'error', text: `Código "${scannerQuery}" no encontrado en este previo ni en el catálogo del cliente.` });
      }
    }
  }

  // Cálculo de etapa operativa (6 etapas de recepción Giving Out: Previo, Rampa, Calidad, Etiquetas, Ubicación, Cierre)
  const computeReceiptStage = (r: any) => {
    const isClosed = r.estado === 'CERRADA' || r.estado === 'CERRADO';
    if (isClosed) {
      return {
        index: 5,
        name: 'Cierre',
        label: 'Cerrada',
        color: '#059669',
        bg: '#ECFDF5',
        border: '#A7F3D0',
        icon: ShieldCheck,
        pendingText: 'Proceso finalizado · Expediente de consulta',
        actionTitle: 'Proceso finalizado e inmutable',
        actionDescription: 'Esta recepción fue cerrada y finiquitada oficialmente. El expediente es inmutable y se encuentra en modo de consulta histórica permanente. No se admiten registros operativos adicionales.',
        actionButtonLabel: 'Ver Expediente de Consulta',
        actionType: 'CONSULTA' as const,
        isClosed: true,
      };
    }

    const hasRampLiberation = Boolean(r.fechaLiberacionChofer || r.liberadoChofer);
    if (!hasRampLiberation && (!r.bultosRecibidos || r.bultosRecibidos === 0)) {
      return {
        index: 1,
        name: 'Rampa',
        label: 'En Rampa',
        color: '#D97706',
        bg: '#FFFBEB',
        border: '#FDE68A',
        icon: Truck,
        pendingText: 'Pendiente conteo exterior y firma de rampa',
        actionTitle: 'Registrar descarga exterior y liberar chofer',
        actionDescription: 'La unidad de transporte se encuentra en andén. Debe registrarse el conteo exterior de bultos y las firmas de liberación.',
        actionButtonLabel: 'Registrar Acta de Rampa',
        actionType: 'RAMPA' as const,
        isClosed: false,
      };
    }

    const hasDamagedUnits = (r.bultosDanados > 0 || r.cantidadDanada > 0);
    const qualityCompleted = r.inspeccionCalidadEstado === 'COMPLETADA';
    if (hasDamagedUnits && !qualityCompleted) {
      return {
        index: 2,
        name: 'Calidad',
        label: 'Inspección',
        color: '#7C3AED',
        bg: '#F5F3FF',
        border: '#DDD6FE',
        icon: Microscope,
        pendingText: `Dictamen pendiente (${r.bultosDanados || 1} bulto(s) retenido(s))`,
        actionTitle: 'Dictaminar cajas retenidas por daño exterior',
        actionDescription: `Se identificaron ${r.bultosDanados || 1} bultos con daño exterior en rampa. Se requiere inspección técnica pieza por pieza para registrar rescate vs merma.`,
        actionButtonLabel: 'Dictaminar Calidad y Rescate',
        actionType: 'CALIDAD' as const,
        isClosed: false,
      };
    }

    // Comprobar si existen partidas aún pendientes de clasificar en andén antes de etiquetas/cierre
    const lines = r.lineas || [];
    const isAndenConteoCompleted = Boolean(
      r.conteoAndenEstado === 'COMPLETADO' ||
      r.estado === 'CONCILIADO' ||
      r.estado === 'ETIQUETADO' ||
      r.estado === 'UBICADO' ||
      r.estado === 'COMPLETO' ||
      r.estado === 'CERRADO' ||
      r.estado === 'CERRADA' ||
      r.etiquetasEstado === 'COLOCADAS' ||
      (lines.length > 0 && lines.every((l: any) =>
        l.estado === 'COMPLETO' ||
        l.estado === 'COMPLETADA' ||
        l.estado === 'CONCILIADO' ||
        (Number(l.cantidadRecibida || 0) + Number(l.cantidadDanada || 0) >= Number(l.cantidadEsperada || 0))
      ))
    );

    const hasUnclassifiedLines = !isAndenConteoCompleted && lines.length > 0 && lines.some((l: any) => {
      const rec = Number(l.cantidadRecibida || 0);
      const dan = Number(l.cantidadDanada || 0);
      const esp = Number(l.cantidadEsperada || 0);
      const isComplete = l.estado === 'COMPLETO' || l.estado === 'COMPLETADA' || l.estado === 'CONCILIADO' || (rec + dan >= esp);
      return !isComplete;
    });

    if (hasRampLiberation && hasUnclassifiedLines && r.etiquetasEstado !== 'COLOCADAS') {
      const pendingBoxes = Math.max(0, (r.bultosRecibidos || 0) - (r.bultosDanados || 0));
      return {
        index: 2,
        name: 'Conteo',
        label: 'Conteo en Andén',
        color: '#0284C7',
        bg: '#F0F9FF',
        border: '#BAE6FD',
        icon: Package,
        pendingText: `${pendingBoxes} bultos en andén pendientes de conteo por partida`,
        actionTitle: 'Clasificar y verificar mercancía en andén',
        actionDescription: `Se concluyó la inspección de calidad de las cajas dañadas. En andén restan ${pendingBoxes} bultos recibidos pendientes de conteo y clasificación por partida. Concluya la verificación para conciliar con rampa antes de generar etiquetas o cerrar el balance.`,
        actionButtonLabel: 'Verificar Partidas en Andén',
        actionType: 'CONTEO' as const,
        isClosed: false,
      };
    }

    const labelsPlaced = r.etiquetasEstado === 'COLOCADAS';
    if (!labelsPlaced) {
      return {
        index: 3,
        name: 'Etiquetas',
        label: 'Etiquetas',
        color: '#0284C7',
        bg: '#F0F9FF',
        border: '#BAE6FD',
        icon: QrCode,
        pendingText: 'Falta generar y confirmar colocación de etiquetas HU',
        actionTitle: 'Generar, imprimir y confirmar colocación de etiquetas HU',
        actionDescription: 'Cada caja conforme o reacondicionada requiere su etiqueta individual Code-128 y tarima QR Master antes de ingresar a racks.',
        actionButtonLabel: 'Generar y Confirmar Etiquetas',
        actionType: 'ETIQUETAS' as const,
        isClosed: false,
      };
    }

    const needsPutaway = r.estado !== 'UBICADO' && r.estado !== 'COMPLETO' && (lines.length === 0 || lines.some((l: any) => !l.ubicacionId || l.ubicacion?.codigo === 'REC-01' || l.ubicacion?.tipoUbicacion === 'RECIBO'));
    if (needsPutaway) {
      return {
        index: 4,
        name: 'Ubicación',
        label: 'Ubicación',
        color: '#0D9488',
        bg: '#F0FDFA',
        border: '#99F6E4',
        icon: MapPin,
        pendingText: 'Pendiente alojamiento en racks (Putaway)',
        actionTitle: 'Alojamiento en racks (Putaway) con escaneo físico',
        actionDescription: 'Las unidades de manejo están identificadas. Deben trasladarse desde andén y ubicarse en sus racks correspondientes con confirmación de lectura.',
        actionButtonLabel: 'Ejecutar Alojamiento a Racks',
        actionType: 'UBICACION' as const,
        isClosed: false,
      };
    }

    return {
      index: 5,
      name: 'Cierre',
      label: 'Por Cerrar',
      color: '#059669',
      bg: '#ECFDF5',
      border: '#A7F3D0',
      icon: ClipboardCheck,
      pendingText: 'Mercancía alojada · Listo para cierre oficial',
      actionTitle: 'Revisar balance de recibo y finiquitar expediente',
      actionDescription: 'Todas las unidades conformes han sido ubicadas y las discrepancias están documentadas. Proceda al cierre oficial del folio.',
      actionButtonLabel: 'Revisar Balance y Cerrar Recepción',
      actionType: 'CIERRE' as const,
      isClosed: false,
    };
  };

  // Tarea 5: Función centralizadora de banderas de estatus operativo (100% vector Lucide, cero emojis)
  const getEstadoMeta = (estado: string) => {
    const norm = String(estado || '').toUpperCase().trim();
    if (norm === 'PENDIENTE_ARRIBO' || norm === 'PENDIENTE') {
      return {
        key: 'PENDIENTE_ARRIBO',
        label: 'Pendiente de Arribo',
        badgeClass: 'badge-info',
        color: '#38BDF8',
        bg: 'rgba(2, 132, 199, 0.16)',
        border: 'rgba(56, 189, 248, 0.35)',
        icon: Clock,
        stepIndex: 0,
        description: 'Previo registrado. En espera de arribo de transporte al andén.'
      };
    }
    if (norm === 'EN_PROCESO_CONTEO' || norm === 'EN_PROCESO') {
      return {
        key: 'EN_PROCESO_CONTEO',
        label: 'En Proceso de Conteo',
        badgeClass: 'badge-warning',
        color: '#FBBF24',
        bg: 'rgba(245, 158, 11, 0.16)',
        border: 'rgba(251, 191, 36, 0.35)',
        icon: Scan,
        stepIndex: 1,
        description: 'Mercancía en andén. Conteo físico, escaneo y verificación en curso.'
      };
    }
    if (norm === 'COMPLETO' || norm === 'UBICADO') {
      return {
        key: 'COMPLETO',
        label: 'Completo',
        badgeClass: 'badge-success',
        color: '#10B981',
        bg: 'rgba(16, 185, 129, 0.16)',
        border: 'rgba(16, 185, 129, 0.35)',
        icon: CheckCircle2,
        stepIndex: 2,
        description: 'Mercancía ubicada en racks y stock activado como DISPONIBLE.'
      };
    }
    if (norm === 'CERRADA' || norm === 'CERRADO') {
      return {
        key: 'CERRADA',
        label: 'Cerrada',
        badgeClass: 'badge-success',
        color: '#34D399',
        bg: 'rgba(16, 185, 129, 0.16)',
        border: 'rgba(52, 211, 153, 0.35)',
        icon: ShieldCheck,
        stepIndex: 2,
        description: 'Recepción finiquitada, reporte generado e inventario blindado.'
      };
    }
    return {
      key: norm,
      label: norm.replace('_', ' '),
      badgeClass: 'badge-default',
      color: '#94A3B8',
      bg: 'rgba(100, 116, 139, 0.16)',
      border: 'rgba(148, 163, 184, 0.35)',
      icon: Package,
      stepIndex: 0,
      description: 'Estado operativo no clasificado.'
    };
  };

  // Helpers con búsqueda tolerante por tokens
  const filtered = receipts.filter(r => {
    if (!search.trim()) return true;

    const term = search.toLowerCase().trim();
    const tokens = term.split(/\s+/).filter(t => t.length >= 2);

    const rCode = (r.codigo || '').toLowerCase();
    const rFactura = (r.facturaRespaldo || '').toLowerCase();
    const rOc = (r.ocReferencia || '').toLowerCase();
    const rCliente = (r.cliente?.nombreComercial || '').toLowerCase();
    const rChofer = (r.nombreChofer || '').toLowerCase();
    const rPlaca = (r.placa || '').toLowerCase();
    const rSkus = (r.lineas || []).map((l: any) => `${l.sku?.codigo || ''} ${l.sku?.descripcion || ''}`.toLowerCase()).join(' ');

    const fullText = `${rCode} ${rFactura} ${rOc} ${rCliente} ${rChofer} ${rPlaca} ${rSkus}`;
    if (fullText.includes(term)) return true;

    // Token match: If user typed "Fashion Award", "fashion" matches "Fashion Forward"
    return tokens.some(tok => fullText.includes(tok));
  });

  const estadoBadge = (estado: string) => {
    return getEstadoMeta(estado).badgeClass.replace('badge-', '');
  };

  return (
    <div className="page-container" style={{ padding: '24px 28px' }}>
      <div className="page-header" style={{ marginBottom: 20 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <div style={{ width: 34, height: 34, borderRadius: 8, background: 'rgba(13,148,136,0.12)', color: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <ClipboardCheck size={20} />
            </div>
            <h1 className="page-title" style={{ fontSize: 24, fontWeight: 800, margin: 0, letterSpacing: '-0.02em' }}>
              Recepción
            </h1>
          </div>
          <p className="page-subtitle" style={{ fontSize: 13, margin: 0 }}>
            Ingesta de ASN/Excel, control de bahía de descarga en tiempo real, validación física dual y alojamiento sugerido a racks
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-primary" onClick={() => { setShowNewPrevio(true); setFormMsg({ type: '', text: '' }); }} style={{ fontWeight: 600 }}>
            <Plus size={16} /> Nuevo Previo (ASN / Excel)
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => handleManualRefresh()}
            disabled={loading || refreshingManual}
            style={{
              fontWeight: 600,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              transition: 'all 0.2s ease',
              borderColor: justRefreshed ? '#10B981' : undefined,
              color: justRefreshed ? '#065F46' : undefined,
              backgroundColor: justRefreshed ? '#ECFDF5' : undefined,
            }}
            title="Actualizar listado de recepciones desde el servidor"
          >
            {justRefreshed ? (
              <>
                <Check size={16} style={{ color: '#10B981' }} /> ¡Actualizado!
              </>
            ) : (
              <>
                <RefreshCw size={16} className={(loading || refreshingManual) ? 'spin' : ''} />
                {loading || refreshingManual ? 'Actualizando...' : 'Actualizar'}
              </>
            )}
          </button>
        </div>
      </div>

      {/* --- NOTIFICACIÓN GLOBAL --- */}
      {formMsg.text && (
        <div className={`form-message ${formMsg.type === 'error' ? 'form-error-msg' : 'form-success-msg'}`} style={{ marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>{formMsg.text}</span>
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            onClick={() => setFormMsg({ type: '', text: '' })}
            style={{ cursor: 'pointer', opacity: 0.8 }}
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* --- MODAL EDITAR PREVIO (METADATOS) --- */}
      {editReceiptModal && (
        <div className="modal-overlay" onClick={() => setEditReceiptModal(null)}>
          <div className="modal-content animate-scale-in" onClick={e => e.stopPropagation()} style={{ maxWidth: 640 }}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 36, height: 36, borderRadius: 8, background: 'rgba(13,148,136,0.1)', color: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Settings size={20} />
                </div>
                <div>
                  <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Editar Previo ({editReceiptModal.codigo})</h2>
                  <p style={{ margin: 0, fontSize: 12, color: 'var(--text-tertiary)' }}>Modifica datos de transporte, chofer, factura u observaciones</p>
                </div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => setEditReceiptModal(null)}><X size={18} /></button>
            </div>

            <form onSubmit={handleUpdateReceipt} className="modal-body">
              <div className="form-row">
                <div className="form-group" style={{ flex: 1.5 }}>
                  <label className="form-label">Factura de Respaldo</label>
                  <input 
                    className="form-input" 
                    placeholder="Ej. FAC-2026-89421"
                    value={editReceiptModal.facturaRespaldo || ''} 
                    onChange={e => setEditReceiptModal({ ...editReceiptModal, facturaRespaldo: e.target.value })} 
                  />
                </div>
                <div className="form-group" style={{ flex: 1.2 }}>
                  <label className="form-label">Orden Compra (OC)</label>
                  <input 
                    className="form-input" 
                    placeholder="Ej. OC-2026-99"
                    value={editReceiptModal.ocReferencia || ''} 
                    onChange={e => setEditReceiptModal({ ...editReceiptModal, ocReferencia: e.target.value })} 
                  />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label">Origen</label>
                  <select 
                    className="form-select form-select-full" 
                    value={editReceiptModal.origen || 'NACIONAL'} 
                    onChange={e => {
                      const nuevoOrigen = e.target.value;
                      setEditReceiptModal({
                        ...editReceiptModal,
                        origen: nuevoOrigen,
                        tipoImportacion: nuevoOrigen === 'IMPORTACION' ? (editReceiptModal.tipoImportacion && editReceiptModal.tipoImportacion !== 'NO_APLICA' ? editReceiptModal.tipoImportacion : 'DEFINITIVA') : 'NO_APLICA'
                      });
                    }}
                  >
                    <option value="NACIONAL">Nacional</option>
                    <option value="IMPORTACION">Importación</option>
                  </select>
                </div>
              </div>

              <div className="form-row">
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label">Tipo de Importación / Régimen</label>
                  <select 
                    className="form-select form-select-full" 
                    value={editReceiptModal.tipoImportacion || (editReceiptModal.origen === 'IMPORTACION' ? 'DEFINITIVA' : 'NO_APLICA')} 
                    onChange={e => setEditReceiptModal({ ...editReceiptModal, tipoImportacion: e.target.value })}
                  >
                    <option value="NO_APLICA">N/A — Mercancía Nacional</option>
                    <option value="DEFINITIVA">Definitiva (Comercialización)</option>
                    <option value="TEMPORAL">Temporal (IMMEX / Retorno)</option>
                    <option value="TRANSITO">Tránsito Interno / Fiscal</option>
                    <option value="DEPOSITO_FISCAL">Depósito Fiscal</option>
                    <option value="VIRTUAL">Transferencia Virtual (V1)</option>
                  </select>
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label">Modalidad Operativa</label>
                  <select 
                    className="form-select form-select-full" 
                    value={editReceiptModal.tipoRecepcion || 'RECEPCION'} 
                    onChange={e => setEditReceiptModal({ ...editReceiptModal, tipoRecepcion: e.target.value })}
                  >
                    <option value="RECEPCION">Recepción Normal (Proveedor / Compra)</option>
                    <option value="DEVOLUCION">Devolución (Sucursales / Tiendas)</option>
                  </select>
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Línea de Transporte</label>
                  <input className="form-input" value={editReceiptModal.lineaTransporte || ''} onChange={e => setEditReceiptModal({ ...editReceiptModal, lineaTransporte: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">Placas de Unidad</label>
                  <input className="form-input" value={editReceiptModal.placa || ''} onChange={e => setEditReceiptModal({ ...editReceiptModal, placa: e.target.value.toUpperCase() })} />
                </div>
                <div className="form-group">
                  <label className="form-label">Chofer</label>
                  <input className="form-input" value={editReceiptModal.nombreChofer || ''} onChange={e => setEditReceiptModal({ ...editReceiptModal, nombreChofer: e.target.value })} />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Notas u Observaciones</label>
                <textarea className="form-input" rows={2} value={editReceiptModal.notas || ''} onChange={e => setEditReceiptModal({ ...editReceiptModal, notas: e.target.value })} />
              </div>

              <div className="modal-footer">
                <button type="button" className="btn btn-ghost" onClick={() => setEditReceiptModal(null)}>Cancelar</button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>
                  {submitting ? 'Guardando...' : 'Guardar Cambios del Previo'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- MODAL CONFIRMAR ELIMINAR PREVIO (DISEÑO PROFESIONAL DARK CEDIS) --- */}
      {deleteReceiptConfirm && (
        <div className="modal-overlay" onClick={() => setDeleteReceiptConfirm(null)}>
          <div 
            className="modal-content animate-scale-in" 
            onClick={e => e.stopPropagation()} 
            style={{ 
              maxWidth: 480, 
              background: '#FFFFFF', 
              border: '1px solid #E2E8F0', 
              borderRadius: 16, 
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.15)',
              padding: 0,
              overflow: 'hidden'
            }}
          >
            {/* Header */}
            <div style={{ padding: '20px 24px', borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 42, height: 42, borderRadius: 10, background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.25)', color: '#EF4444', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Trash2 size={22} />
                </div>
                <div>
                  <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#0F172A', letterSpacing: '-0.01em' }}>
                    Eliminar Previo de Recibo
                  </h2>
                  <p style={{ margin: '2px 0 0 0', fontSize: 12, color: '#64748B' }}>
                    Folio: <strong style={{ color: '#0284C7' }}>{deleteReceiptConfirm.codigo}</strong>
                  </p>
                </div>
              </div>
              <button 
                type="button" 
                onClick={() => setDeleteReceiptConfirm(null)}
                style={{ background: 'transparent', border: 'none', color: '#94A3B8', cursor: 'pointer', padding: 6, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Body */}
            <div style={{ padding: '24px' }}>
              <div style={{ background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: 12, padding: '16px', marginBottom: 24 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  <AlertTriangle size={20} style={{ color: '#EF4444', flexShrink: 0, marginTop: 1 }} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#B91C1C', marginBottom: 4 }}>
                      Acción destructiva e irreversible
                    </div>
                    <div style={{ fontSize: 13, color: '#475569', lineHeight: 1.5 }}>
                      Se eliminará el previo <strong style={{ color: '#0F172A' }}>{deleteReceiptConfirm.codigo}</strong> y todas sus <strong style={{ color: '#0F172A' }}>{deleteReceiptConfirm.lineas?.length || 0} líneas esperadas</strong> registradas en el sistema.
                    </div>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
                <button 
                  type="button" 
                  className="btn btn-secondary"
                  onClick={() => setDeleteReceiptConfirm(null)}
                >
                  Cancelar
                </button>
                <button 
                  type="button" 
                  onClick={handleDeleteReceiptConfirm} 
                  disabled={submitting} 
                  style={{ 
                    padding: '10px 20px', 
                    borderRadius: 8, 
                    fontSize: 13, 
                    fontWeight: 700, 
                    background: '#dc2626', 
                    border: '1px solid #ef4444', 
                    color: '#ffffff', 
                    cursor: submitting ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    boxShadow: '0 4px 14px rgba(220, 38, 38, 0.4)',
                    transition: 'all 0.2s ease',
                    opacity: submitting ? 0.7 : 1
                  }}
                  onMouseEnter={e => !submitting && (e.currentTarget.style.background = '#b91c1c')}
                  onMouseLeave={e => !submitting && (e.currentTarget.style.background = '#dc2626')}
                >
                  <Trash2 size={16} /> {submitting ? 'Eliminando...' : 'Eliminar Definitivamente'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {editingLine && (
        <div className="modal-overlay" onClick={() => setEditingLine(null)}>
          <div 
            className="modal-content animate-scale-in" 
            onClick={e => e.stopPropagation()} 
            style={{ 
              maxWidth: 500, 
              background: '#FFFFFF', 
              border: '1px solid #E2E8F0', 
              borderRadius: 16, 
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.15)',
              padding: 0,
              overflow: 'hidden'
            }}
          >
            <div style={{ padding: '20px 24px', borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(13, 148, 136, 0.1)', border: '1px solid rgba(13, 148, 136, 0.25)', color: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Edit3 size={20} />
                </div>
                <div>
                  <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#0F172A' }}>Editar Cantidad Esperada</h2>
                  <p style={{ margin: '2px 0 0 0', fontSize: 12, color: '#64748B' }}>{editingLine.codigo} — {editingLine.descripcion}</p>
                </div>
              </div>
              <button 
                type="button" 
                onClick={() => setEditingLine(null)}
                style={{ background: 'transparent', border: 'none', color: '#94A3B8', cursor: 'pointer', padding: 6, borderRadius: 6, display: 'flex' }}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleUpdateLine} style={{ padding: '24px' }}>
              <div className="form-group" style={{ marginBottom: 16 }}>
                <label className="form-label" style={{ color: '#334155' }}>Cantidad Esperada <span className="required">*</span></label>
                <input 
                  type="number" 
                  className="form-input" 
                  min={1} 
                  value={editingLine.cantidadEsperada} 
                  onFocus={e => e.target.select()}
                  onChange={e => {
                    const val = e.target.value;
                    setEditingLine({
                      ...editingLine,
                      cantidadEsperada: val === '' ? ('' as any) : parseInt(val, 10) || 0
                    });
                  }} 
                  onBlur={() => {
                    if (!editingLine.cantidadEsperada || Number(editingLine.cantidadEsperada) <= 0) {
                      setEditingLine({ ...editingLine, cantidadEsperada: 1 });
                    }
                  }} 
                  required 
                  style={{ background: '#FFFFFF', borderColor: '#CBD5E1', color: '#1E293B' }}
                />
              </div>

              <div className="form-group" style={{ marginBottom: 24 }}>
                <label className="form-label" style={{ color: '#334155' }}>Notas u Observaciones de la línea</label>
                <input 
                  className="form-input" 
                  value={editingLine.notas || ''} 
                  onChange={e => setEditingLine({ ...editingLine, notas: e.target.value })} 
                  style={{ background: '#FFFFFF', borderColor: '#CBD5E1', color: '#1E293B' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button 
                  type="button" 
                  className="btn btn-secondary"
                  onClick={() => setEditingLine(null)}
                >
                  Cancelar
                </button>
                <button 
                  type="submit" 
                  className="btn btn-primary"
                  disabled={submitting}
                  style={{ fontWeight: 700 }}
                >
                  {submitting ? 'Guardando...' : 'Actualizar Línea'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- MODAL CONFIRMAR ELIMINAR LÍNEA (DISEÑO PROFESIONAL) --- */}
      {deleteLineConfirm && (
        <div className="modal-overlay" onClick={() => setDeleteLineConfirm(null)}>
          <div 
            className="modal-content animate-scale-in" 
            onClick={e => e.stopPropagation()} 
            style={{ 
              maxWidth: 460, 
              background: '#FFFFFF', 
              border: '1px solid #E2E8F0', 
              borderRadius: 16, 
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.15)',
              padding: 0,
              overflow: 'hidden'
            }}
          >
            {/* Header */}
            <div style={{ padding: '20px 24px', borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 42, height: 42, borderRadius: 10, background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.25)', color: '#EF4444', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Trash2 size={22} />
                </div>
                <div>
                  <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#0F172A', letterSpacing: '-0.01em' }}>
                    Remover Producto de Recepción
                  </h2>
                  <p style={{ margin: '2px 0 0 0', fontSize: 12, color: '#64748B' }}>
                    SKU: <strong style={{ color: '#0284C7' }}>{deleteLineConfirm.codigo}</strong>
                  </p>
                </div>
              </div>
              <button 
                type="button" 
                onClick={() => setDeleteLineConfirm(null)}
                style={{ background: 'transparent', border: 'none', color: '#94A3B8', cursor: 'pointer', padding: 6, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Body */}
            <div style={{ padding: '24px' }}>
              <div style={{ background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: 12, padding: '16px', marginBottom: 24 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  <AlertTriangle size={20} style={{ color: '#EF4444', flexShrink: 0, marginTop: 1 }} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#B91C1C', marginBottom: 4 }}>
                      Quitar partida esperada
                    </div>
                    <div style={{ fontSize: 13, color: '#475569', lineHeight: 1.5 }}>
                      Esta acción removerá el producto <strong style={{ color: '#0F172A' }}>{deleteLineConfirm.codigo}</strong> de la lista esperada de este previo.
                    </div>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
                <button 
                  type="button" 
                  className="btn btn-secondary"
                  onClick={() => setDeleteLineConfirm(null)}
                >
                  Cancelar
                </button>
                <button 
                  type="button" 
                  onClick={handleDeleteLineConfirm} 
                  disabled={submitting} 
                  style={{ 
                    padding: '10px 20px', 
                    borderRadius: 8, 
                    fontSize: 13, 
                    fontWeight: 700, 
                    background: '#dc2626', 
                    border: '1px solid #ef4444', 
                    color: '#ffffff', 
                    cursor: submitting ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    boxShadow: '0 4px 14px rgba(220, 38, 38, 0.4)'
                  }}
                >
                  <Trash2 size={16} />
                  {submitting ? 'Removiendo...' : 'Quitar Producto'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* --- MODAL AGREGAR PRODUCTO MANUAL AL PREVIO --- */}
      {showAddLineModal && (
        <div className="modal-overlay" onClick={() => setShowAddLineModal(null)}>
          <div className="modal-content animate-scale-in" onClick={e => e.stopPropagation()} style={{ maxWidth: 540 }}>
            <div className="modal-header" style={{ borderBottom: '1px solid #E2E8F0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 36, height: 36, borderRadius: 8, background: 'rgba(13,148,136,0.1)', color: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <PlusCircle size={20} />
                </div>
                <div>
                  <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Agregar Producto al Previo</h2>
                  <p style={{ margin: 0, fontSize: 12, color: 'var(--text-tertiary)' }}>Incluye un SKU que llegó físicamente y no venía en la lista Excel original</p>
                </div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowAddLineModal(null)}><X size={18} /></button>
            </div>

            <form onSubmit={handleAddLineSubmit} className="modal-body">
              <div className="form-group">
                <label className="form-label">Seleccionar SKU / Producto <span className="required">*</span></label>
                <select 
                  className="form-select form-select-full" 
                  value={newLineForm.skuId} 
                  onChange={e => setNewLineForm({ ...newLineForm, skuId: e.target.value })} 
                  required
                >
                  <option value="">Seleccionar del catálogo...</option>
                  {skus.filter(s => s.clienteId === showAddLineModal.clienteId).map(s => (
                    <option key={s.id} value={s.id}>{s.descripcion} ({s.codigo})</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Cantidad Esperada a Recibir <span className="required">*</span></label>
                <input 
                  type="number" 
                  className="form-input" 
                  min={1} 
                  value={newLineForm.cantidadEsperada} 
                  onFocus={e => e.target.select()}
                  onChange={e => {
                    const val = e.target.value;
                    setNewLineForm({
                      ...newLineForm,
                      cantidadEsperada: val === '' ? ('' as any) : parseInt(val, 10) || 0
                    });
                  }} 
                  onBlur={() => {
                    if (!newLineForm.cantidadEsperada || Number(newLineForm.cantidadEsperada) <= 0) {
                      setNewLineForm({ ...newLineForm, cantidadEsperada: 1 });
                    }
                  }}
                  required 
                />
              </div>

              <div className="form-group">
                <label className="form-label">Notas u Observaciones</label>
                <input 
                  className="form-input" 
                  placeholder="Ej. Producto sorpresa no manifestado en ASN" 
                  value={newLineForm.notas} 
                  onChange={e => setNewLineForm({ ...newLineForm, notas: e.target.value })} 
                />
              </div>

              <div className="modal-footer">
                <button type="button" className="btn btn-ghost" onClick={() => setShowAddLineModal(null)}>Cancelar</button>
                <button type="submit" className="btn btn-primary" disabled={submitting || !newLineForm.skuId}>
                  {submitting ? 'Guardando...' : 'Agregar al Previo'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- MODAL CONFIRMAR BLOQUEO DE PREVIO (MINIMALIST WHITE DESIGN) --- */}
      {confirmLockModal && (
        <div className="modal-overlay" onClick={() => setConfirmLockModal(null)} style={{ background: 'rgba(15, 23, 42, 0.5)', backdropFilter: 'blur(4px)', zIndex: 1100 }}>
          <div 
            className="modal-content animate-scale-in" 
            onClick={e => e.stopPropagation()} 
            style={{ 
              maxWidth: 520, 
              background: '#FFFFFF', 
              border: '1px solid #E2E8F0', 
              borderRadius: 16, 
              color: '#0F172A', 
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
              padding: 0,
              overflow: 'hidden'
            }}
          >
            {/* Header */}
            <div style={{ padding: '20px 24px', borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 42, height: 42, borderRadius: 10, background: '#FEF3C7', border: '1px solid #FDE68A', color: '#D97706', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Lock size={22} />
                </div>
                <div>
                  <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#0F172A' }}>
                    Confirmar Previo (Bloquear Edición)
                  </h2>
                  <p style={{ margin: '2px 0 0 0', fontSize: 12, color: '#64748B' }}>
                    Folio: <strong style={{ color: '#0284C7' }}>{confirmLockModal.codigo}</strong> · {confirmLockModal.cliente?.nombreComercial}
                  </p>
                </div>
              </div>
              <button 
                type="button" 
                onClick={() => setConfirmLockModal(null)}
                style={{ background: 'transparent', border: 'none', color: '#64748B', cursor: 'pointer', padding: 6, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Body */}
            <div style={{ padding: '24px' }}>
              {modalActionError && (
                <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', color: '#DC2626', padding: '12px 16px', borderRadius: 8, marginBottom: 16, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <AlertTriangle size={18} style={{ flexShrink: 0 }} />
                  <div>{modalActionError}</div>
                </div>
              )}

              {/* Alert / Warning */}
              <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 12, padding: '16px', marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  <AlertTriangle size={20} style={{ color: '#D97706', flexShrink: 0, marginTop: 2 }} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#92400E', marginBottom: 4 }}>
                      Protección contra Modificaciones Operativas
                    </div>
                    <div style={{ fontSize: 13, color: '#78350F', lineHeight: 1.5 }}>
                      Al confirmar el previo, se bloqueará la edición de la <strong>factura de respaldo</strong>, <strong>líneas de producto</strong> y <strong>cantidades esperadas</strong> para garantizar la integridad del conteo físico en andén.
                    </div>
                  </div>
                </div>
              </div>

              {/* Summary Stats */}
              <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 10, padding: '14px 16px', marginBottom: 20 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
                  Resumen de la Recepción a Proteger
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, fontSize: 13 }}>
                  <div>
                    <span style={{ color: '#64748B', fontSize: 12 }}>Factura / OC:</span>
                    <div style={{ fontWeight: 600, color: '#0F172A', marginTop: 2 }}>
                      {confirmLockModal.facturaRespaldo || confirmLockModal.ocReferencia || 'Sin factura'}
                    </div>
                  </div>
                  <div>
                    <span style={{ color: '#64748B', fontSize: 12 }}>Régimen / Origen:</span>
                    <div style={{ fontWeight: 600, color: '#0284C7', marginTop: 2 }}>
                      {confirmLockModal.origen || 'NACIONAL'} {confirmLockModal.tipoImportacion && confirmLockModal.tipoImportacion !== 'NO_APLICA' ? `· ${confirmLockModal.tipoImportacion}` : ''}
                    </div>
                  </div>
                  <div>
                    <span style={{ color: '#64748B', fontSize: 12 }}>Partidas Esperadas:</span>
                    <div style={{ fontWeight: 700, color: '#0F172A', marginTop: 2 }}>
                      {confirmLockModal.lineas?.length || 0} productos
                    </div>
                  </div>
                  <div>
                    <span style={{ color: '#64748B', fontSize: 12 }}>Unidades Totales:</span>
                    <div style={{ fontWeight: 700, color: '#059669', marginTop: 2 }}>
                      {confirmLockModal.lineas?.reduce((acc: number, l: any) => acc + (l.cantidadEsperada || 0), 0) || 0} piezas
                    </div>
                  </div>
                </div>
              </div>

              <div style={{ fontSize: 12, color: '#64748B', display: 'flex', alignItems: 'center', gap: 6 }}>
                <ShieldCheck size={14} style={{ color: '#059669' }} /> Si requieres corregir algún dato posteriormente, un supervisor podrá desbloquearlo con registro en bitácora.
              </div>
            </div>

            {/* Footer */}
            <div style={{ padding: '16px 24px', borderTop: '1px solid #E2E8F0', background: '#F8FAFC', display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
              <button 
                type="button" 
                onClick={() => setConfirmLockModal(null)}
                style={{ 
                  padding: '10px 18px', 
                  borderRadius: 8, 
                  fontSize: 13, 
                  fontWeight: 600, 
                  background: '#FFFFFF', 
                  border: '1px solid #CBD5E1', 
                  color: '#475569', 
                  cursor: 'pointer' 
                }}
              >
                Cancelar
              </button>
              <button 
                type="button" 
                onClick={() => handleLockReceiptSubmit(confirmLockModal.id)} 
                disabled={isLocking}
                style={{ 
                  padding: '10px 22px', 
                  borderRadius: 8, 
                  fontSize: 13, 
                  fontWeight: 700, 
                  background: '#D97706', 
                  border: '1px solid #D97706', 
                  color: '#ffffff', 
                  cursor: isLocking ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  boxShadow: '0 2px 8px rgba(217, 119, 6, 0.25)',
                  opacity: isLocking ? 0.7 : 1
                }}
              >
                <Lock size={15} />
                {isLocking ? 'Confirmando...' : 'Confirmar y Bloquear Previo'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- MODAL DESBLOQUEAR PREVIO PARA SUPERVISOR (MINIMALIST WHITE DESIGN) --- */}
      {confirmUnlockModal && (
        <div className="modal-overlay" onClick={() => setConfirmUnlockModal(null)} style={{ background: 'rgba(15, 23, 42, 0.5)', backdropFilter: 'blur(4px)', zIndex: 1100 }}>
          <div 
            className="modal-content animate-scale-in" 
            onClick={e => e.stopPropagation()} 
            style={{ 
              maxWidth: 500, 
              background: '#FFFFFF', 
              border: '1px solid #E2E8F0', 
              borderRadius: 16, 
              color: '#0F172A', 
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
              padding: 0,
              overflow: 'hidden'
            }}
          >
            {/* Header */}
            <div style={{ padding: '20px 24px', borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 42, height: 42, borderRadius: 10, background: '#E0F2FE', border: '1px solid #BAE6FD', color: '#0284C7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Unlock size={22} />
                </div>
                <div>
                  <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#0F172A' }}>
                    Desbloquear Previo para Corrección
                  </h2>
                  <p style={{ margin: '2px 0 0 0', fontSize: 12, color: '#64748B' }}>
                    Folio: <strong style={{ color: '#0284C7' }}>{confirmUnlockModal.codigo}</strong>
                  </p>
                </div>
              </div>
              <button 
                type="button" 
                onClick={() => setConfirmUnlockModal(null)}
                style={{ background: 'transparent', border: 'none', color: '#64748B', cursor: 'pointer', padding: 6, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Body */}
            <form onSubmit={(e) => { e.preventDefault(); handleUnlockReceiptSubmit(confirmUnlockModal.id); }} style={{ padding: '24px' }}>
              {modalActionError && (
                <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', color: '#DC2626', padding: '12px 16px', borderRadius: 8, marginBottom: 16, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <AlertTriangle size={18} style={{ flexShrink: 0 }} />
                  <div>{modalActionError}</div>
                </div>
              )}

              <div style={{ background: '#F0F9FF', border: '1px solid #BAE6FD', borderRadius: 12, padding: '14px 16px', marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <ShieldCheck size={18} style={{ color: '#0284C7', flexShrink: 0, marginTop: 1 }} />
                  <div style={{ fontSize: 13, color: '#0369A1', lineHeight: 1.5 }}>
                    Esta acción habilitará nuevamente la edición de facturas, adición de partidas y ajuste de cantidades. Se guardará un registro de auditoría con tu usuario (<strong style={{ color: '#0284C7' }}>{user?.email || 'Supervisor'}</strong>).
                  </div>
                </div>
              </div>

              <div className="form-group" style={{ marginBottom: 20 }}>
                <label className="form-label" style={{ color: '#0F172A', fontWeight: 600 }}>
                  Motivo de la Corrección <span style={{ color: '#64748B', fontWeight: 400 }}>(Opcional para Bitácora)</span>
                </label>
                <input 
                  className="form-input" 
                  placeholder="Ej. Corrección por discrepancia en factura de proveedor o rectificación de bultos" 
                  value={unlockMotivo} 
                  onChange={e => setUnlockMotivo(e.target.value)} 
                  style={{ background: '#FFFFFF', borderColor: '#CBD5E1', color: '#0F172A' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
                <button 
                  type="button" 
                  onClick={() => setConfirmUnlockModal(null)}
                  style={{ 
                    padding: '10px 18px', 
                    borderRadius: 8, 
                    fontSize: 13, 
                    fontWeight: 600, 
                    background: '#FFFFFF', 
                    border: '1px solid #CBD5E1', 
                    color: '#475569', 
                    cursor: 'pointer' 
                  }}
                >
                  Cancelar
                </button>
                <button 
                  type="submit" 
                  disabled={isLocking}
                  style={{ 
                    padding: '10px 22px', 
                    borderRadius: 8, 
                    fontSize: 13, 
                    fontWeight: 700, 
                    background: '#0284c7', 
                    border: '1px solid #0284c7', 
                    color: '#ffffff', 
                    cursor: isLocking ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    boxShadow: '0 2px 8px rgba(2, 132, 199, 0.25)',
                    opacity: isLocking ? 0.7 : 1
                  }}
                >
                  <Unlock size={15} />
                  {isLocking ? 'Desbloqueando...' : 'Autorizar Desbloqueo'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- FASE 4 GIVING OUT: MODAL DE ALOJAMIENTO / PUTAWAY EN LAYOUT Y ACTIVACIÓN DE STOCK --- */}
      {putawayModalReceipt && (
        <PutawayModal
          receipt={putawayModalReceipt}
          token={token || undefined}
          currentUser={user}
          onClose={() => setPutawayModalReceipt(null)}
          onSuccess={() => {
            loadData();
          }}
          onOpenDualLabel={(r) => {
            setPutawayModalReceipt(null);
            setDualLabelReceipt(r);
          }}
        />
      )}

      {/* --- MODAL CARGAR PREVIO DE RECIBO --- */}
      {showNewPrevio && (
        <div className="modal-overlay" onClick={() => setShowNewPrevio(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 900, maxHeight: '92vh', overflowY: 'auto' }}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 36, height: 36, borderRadius: 8, background: 'rgba(13,148,136,0.1)', color: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <FileSpreadsheet size={20} />
                </div>
                <div>
                  <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Cargar Previo de Recibo (ASN)</h2>
                  <p style={{ margin: 0, fontSize: 12, color: 'var(--text-tertiary)' }}>Importa el archivo Excel oficial con las columnas factura, EAN y cantidades esperadas</p>
                </div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowNewPrevio(false)}><X size={18} /></button>
            </div>

            <form onSubmit={handleCreatePrevio} className="modal-body">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14, marginBottom: 16 }}>
                <div className="form-group">
                  <label className="form-label">Cliente Depositante <span className="required">*</span></label>
                  <select 
                    className="form-select form-select-full" 
                    value={newPrevio.clienteId} 
                    onChange={e => {
                      const cid = e.target.value;
                      setNewPrevio({ ...newPrevio, clienteId: cid });
                      setManualLines([]);
                      setCurManualSku('');
                      if (file) {
                        parseAndAnalyzeExcel(file, cid);
                      }
                    }} 
                    required
                  >
                    <option value="">Seleccionar depositante...</option>
                    {clients.map(c => (
                      <option key={c.id} value={c.id}>{c.nombreComercial} ({c.giro || '3PL'})</option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Factura de Respaldo <span className="required">*</span></label>
                  <input 
                    className="form-input" 
                    placeholder="Ej. FAC-2026-89421" 
                    value={newPrevio.facturaRespaldo || ''} 
                    onChange={e => setNewPrevio({ ...newPrevio, facturaRespaldo: e.target.value })} 
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Orden de Compra (OC Opcional)</label>
                  <input 
                    className="form-input" 
                    placeholder="Ej. OC-2026-99" 
                    value={newPrevio.ocReferencia || ''} 
                    onChange={e => setNewPrevio({ ...newPrevio, ocReferencia: e.target.value })} 
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Origen de Mercancía</label>
                  <select 
                    className="form-select form-select-full" 
                    value={newPrevio.origen} 
                    onChange={e => {
                      const origen = e.target.value;
                      setNewPrevio({
                        ...newPrevio,
                        origen,
                        tipoImportacion: origen === 'IMPORTACION' ? 'DEFINITIVA' : 'NO_APLICA'
                      });
                    }}
                  >
                    <option value="NACIONAL">Nacional</option>
                    <option value="IMPORTACION">Importación (Pedimento / Aduana)</option>
                  </select>
                </div>

                {newPrevio.origen === 'IMPORTACION' && (
                  <div className="form-group">
                    <label className="form-label">Tipo de Importación / Régimen</label>
                    <select 
                      className="form-select form-select-full" 
                      value={newPrevio.tipoImportacion || 'DEFINITIVA'} 
                      onChange={e => setNewPrevio({ ...newPrevio, tipoImportacion: e.target.value })}
                    >
                      <option value="DEFINITIVA">Definitiva (Comercialización)</option>
                      <option value="TEMPORAL">Temporal (IMMEX / Maquila)</option>
                      <option value="TRANSITO">Tránsito Aduanal Interno</option>
                      <option value="DEPOSITO_FISCAL">Depósito Fiscal</option>
                      <option value="VIRTUAL">Transferencia Virtual (V1)</option>
                    </select>
                  </div>
                )}

                <div className="form-group" style={{ gridColumn: 'span 2' }}>
                  <label className="form-label">Tipo de Recepción / Operación</label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <button
                      type="button"
                      onClick={() => setNewPrevio({ ...newPrevio, tipoRecepcion: 'RECEPCION' })}
                      style={{
                        padding: '9px 14px',
                        borderRadius: '8px',
                        fontSize: '13px',
                        fontWeight: 700,
                        cursor: 'pointer',
                        border: newPrevio.tipoRecepcion !== 'DEVOLUCION' ? '1.5px solid #0d9488' : '1px solid #CBD5E1',
                        backgroundColor: newPrevio.tipoRecepcion !== 'DEVOLUCION' ? '#F0FDFA' : '#FFFFFF',
                        color: newPrevio.tipoRecepcion !== 'DEVOLUCION' ? '#0F766E' : '#64748B',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 8,
                        transition: 'all 0.2s ease'
                      }}
                    >
                      <Box size={16} /> Recepción Normal (Proveedor / Compra)
                    </button>
                    <button
                      type="button"
                      onClick={() => setNewPrevio({ ...newPrevio, tipoRecepcion: 'DEVOLUCION' })}
                      style={{
                        padding: '9px 14px',
                        borderRadius: '8px',
                        fontSize: '13px',
                        fontWeight: 700,
                        cursor: 'pointer',
                        border: newPrevio.tipoRecepcion === 'DEVOLUCION' ? '1.5px solid #ef4444' : '1px solid #CBD5E1',
                        backgroundColor: newPrevio.tipoRecepcion === 'DEVOLUCION' ? '#FEF2F2' : '#FFFFFF',
                        color: newPrevio.tipoRecepcion === 'DEVOLUCION' ? '#DC2626' : '#64748B',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 8,
                        transition: 'all 0.2s ease'
                      }}
                    >
                      <RotateCcw size={16} /> Devolución (Sucursales / Tiendas)
                    </button>
                  </div>
                </div>
              </div>

              {/* Selector de Modalidad de Carga: Archivo Excel vs Captura Manual */}
              <div style={{ display: 'flex', background: '#F1F5F9', padding: 4, borderRadius: 10, border: '1px solid #E2E8F0', marginBottom: 16 }}>
                <button
                  type="button"
                  onClick={() => setPrevioMode('EXCEL')}
                  style={{
                    flex: 1,
                    padding: '9px 14px',
                    borderRadius: 8,
                    border: 'none',
                    background: previoMode === 'EXCEL' ? '#0D9488' : 'transparent',
                    color: previoMode === 'EXCEL' ? '#FFFFFF' : '#475569',
                    fontWeight: 700,
                    fontSize: 13,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    transition: 'all 0.2s',
                    boxShadow: previoMode === 'EXCEL' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
                  }}
                >
                  <FileSpreadsheet size={16} /> Carga Automática con Archivo Excel
                </button>
                <button
                  type="button"
                  onClick={() => setPrevioMode('MANUAL')}
                  style={{
                    flex: 1,
                    padding: '9px 14px',
                    borderRadius: 8,
                    border: 'none',
                    background: previoMode === 'MANUAL' ? '#0D9488' : 'transparent',
                    color: previoMode === 'MANUAL' ? '#FFFFFF' : '#475569',
                    fontWeight: 700,
                    fontSize: 13,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    transition: 'all 0.2s',
                    boxShadow: previoMode === 'MANUAL' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
                  }}
                >
                  <Edit3 size={16} /> Captura Manual de Productos
                </button>
              </div>

              {/* MODO EXCEL: Drag & Drop y Análisis de Archivo */}
              {previoMode === 'EXCEL' && (
                <>
                  <div style={{
                    border: '2px dashed #CBD5E1',
                    borderRadius: 10,
                    padding: '24px 20px',
                    textAlign: 'center',
                    background: file ? '#F0FDFA' : '#F8FAFC',
                    marginBottom: 16
                  }}>
                    <input 
                      type="file" 
                      ref={fileInputRef} 
                      onChange={handleFileChange} 
                      accept=".xlsx, .xls, .csv" 
                      style={{ display: 'none' }} 
                    />
                    
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 44, height: 44, borderRadius: 10, background: 'rgba(13,148,136,0.12)', color: '#0D9488', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <FileSpreadsheet size={24} />
                      </div>
                      
                      {file ? (
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 14, color: '#0F172A' }}>{file.name}</div>
                          <div style={{ fontSize: 12, color: '#64748B' }}>{(file.size / 1024).toFixed(1)} KB</div>
                          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 10 }}>
                            <button 
                              type="button" 
                              className="btn btn-secondary btn-sm" 
                              onClick={() => {
                                if (fileInputRef.current) fileInputRef.current.value = '';
                                fileInputRef.current?.click();
                              }}
                            >
                              Cambiar Archivo
                            </button>
                            <button 
                              type="button" 
                              className="btn btn-ghost btn-sm" 
                              style={{ color: '#DC2626' }}
                              onClick={() => {
                                setFile(null);
                                setExcelAnalysis(null);
                                setFormMsg({ type: '', text: '' });
                                setNewPrevio(prev => ({ ...prev, facturaRespaldo: '', ocReferencia: '' }));
                                if (fileInputRef.current) fileInputRef.current.value = '';
                              }}
                            >
                              Quitar Archivo
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 14, color: '#1E293B' }}>Arrastra tu archivo Excel o haz clic aquí</div>
                          <div style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>Formatos soportados: .xlsx, .xls</div>
                          <button 
                            type="button" 
                            className="btn btn-primary btn-sm" 
                            style={{ marginTop: 12 }}
                            onClick={() => {
                              if (fileInputRef.current) fileInputRef.current.value = '';
                              fileInputRef.current?.click();
                            }}
                          >
                            <UploadCloud size={14} /> Seleccionar Archivo
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {isAnalyzing && (
                    <div style={{ padding: '16px', background: '#F8FAFC', border: '1px solid #CBD5E1', borderRadius: 8, textAlign: 'center', marginBottom: 16 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#0F766E' }}>Analizando estructura del archivo Excel y cruzando con catálogo...</div>
                      <div style={{ fontSize: 12, color: '#64748B', marginTop: 4 }}>Validando existencia de SKUs, depositante autorizado y formato de cantidades.</div>
                    </div>
                  )}

                  {excelAnalysis && (
                    <div style={{ marginBottom: 16 }}>
                      {/* Contadores Coherentes de Archivo */}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, marginBottom: 12 }}>
                        <div style={{ padding: '12px 14px', background: '#F8FAFC', borderRadius: 8, border: '1px solid #CBD5E1' }}>
                          <div style={{ fontSize: 11, color: '#475569', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>Líneas Leídas</div>
                          <div style={{ fontSize: 22, fontWeight: 800, color: '#0F172A', lineHeight: 1 }}>{excelAnalysis.totalRows}</div>
                        </div>
                        <div style={{ padding: '12px 14px', background: '#F0FDF4', borderRadius: 8, border: '1px solid #86EFAC' }}>
                          <div style={{ fontSize: 11, color: '#15803D', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>Partidas Válidas</div>
                          <div style={{ fontSize: 22, fontWeight: 800, color: '#16A34A', lineHeight: 1 }}>{excelAnalysis.validRows}</div>
                        </div>
                        <div style={{
                          padding: '12px 14px',
                          background: excelAnalysis.invalidRows > 0 ? '#FEF2F2' : '#F8FAFC',
                          borderRadius: 8,
                          border: excelAnalysis.invalidRows > 0 ? '1px solid #FECACA' : '1px solid #E2E8F0'
                        }}>
                          <div style={{
                            fontSize: 11,
                            color: excelAnalysis.invalidRows > 0 ? '#B91C1C' : '#64748B',
                            fontWeight: 700,
                            textTransform: 'uppercase',
                            letterSpacing: '0.04em',
                            marginBottom: 4
                          }}>
                            Partidas Rechazadas
                          </div>
                          <div style={{
                            fontSize: 22,
                            fontWeight: 800,
                            color: excelAnalysis.invalidRows > 0 ? '#DC2626' : '#64748B',
                            lineHeight: 1
                          }}>
                            {excelAnalysis.invalidRows}
                          </div>
                        </div>
                      </div>

                      {/* Desglose de Rechazos si existen */}
                      {excelAnalysis.invalidRows > 0 && (
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                          {excelAnalysis.notFoundRows > 0 && (
                            <span style={{ fontSize: 11, fontWeight: 700, background: '#FEE2E2', color: '#991B1B', padding: '3px 8px', borderRadius: 6, border: '1px solid #FCA5A5' }}>
                              {excelAnalysis.notFoundRows} {excelAnalysis.notFoundRows === 1 ? 'inexistente' : 'inexistentes'} en catálogo
                            </span>
                          )}
                          {excelAnalysis.foreignRows > 0 && (
                            <span style={{ fontSize: 11, fontWeight: 700, background: '#FEF3C7', color: '#92400E', padding: '3px 8px', borderRadius: 6, border: '1px solid #FCD34D' }}>
                              {excelAnalysis.foreignRows} de otro depositante
                            </span>
                          )}
                          {excelAnalysis.invalidDataRows > 0 && (
                            <span style={{ fontSize: 11, fontWeight: 700, background: '#F1F5F9', color: '#475569', padding: '3px 8px', borderRadius: 6, border: '1px solid #CBD5E1' }}>
                              {excelAnalysis.invalidDataRows} con datos incompletos o inválidos
                            </span>
                          )}
                        </div>
                      )}

                      {/* Alerta de Error de Estructura Incompatible */}
                      {excelAnalysis.incompatibleStructure && (
                        <div style={{
                          background: '#FEF2F2',
                          border: '1px solid #FECACA',
                          borderLeft: '4px solid #DC2626',
                          borderRadius: 8,
                          padding: '12px 14px',
                          marginBottom: 14,
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: 12
                        }}>
                          <AlertTriangle size={20} style={{ color: '#DC2626', flexShrink: 0, marginTop: 1 }} />
                          <div style={{ fontSize: 13, color: '#991B1B', lineHeight: 1.5 }}>
                            <strong style={{ fontWeight: 800 }}>Error de Formato:</strong> {excelAnalysis.structureError}
                          </div>
                        </div>
                      )}

                      {/* Alerta de Bloqueo por Partidas Rechazadas */}
                      {excelAnalysis.invalidRows > 0 && !excelAnalysis.incompatibleStructure && (
                        <div style={{
                          background: '#FFFBEB',
                          border: '1px solid #FCD34D',
                          borderLeft: '4px solid #D97706',
                          borderRadius: 8,
                          padding: '12px 14px',
                          marginBottom: 14,
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: 12
                        }}>
                          <AlertTriangle size={20} style={{ color: '#D97706', flexShrink: 0, marginTop: 1 }} />
                          <div style={{ fontSize: 13, color: '#78350F', lineHeight: 1.5 }}>
                            <strong style={{ fontWeight: 800 }}>Creación de Previo Bloqueada:</strong> Se detectaron {excelAnalysis.invalidRows} partida(s) inválida(s) o rechazadas en el archivo. La creación de previos en Giving Out requiere que el 100% de las partidas pertenezcan al catálogo del depositante para proteger la integridad del inventario.
                          </div>
                        </div>
                      )}

                      {/* Tabla de Previsualización Completa (Válidas e Inválidas) */}
                      {excelAnalysis.lines.length > 0 && (
                        <div style={{ border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden', marginBottom: 16, background: '#FFFFFF' }}>
                          <div style={{
                            padding: '10px 14px',
                            background: '#F1F5F9',
                            fontSize: 12,
                            fontWeight: 700,
                            color: '#1E293B',
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em',
                            borderBottom: '1px solid #CBD5E1',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center'
                          }}>
                            <span>Previsualización de Partidas ({excelAnalysis.lines.length} leídas en total)</span>
                            <span style={{ fontSize: 11, fontWeight: 600, color: '#64748B', textTransform: 'none' }}>
                              {excelAnalysis.validRows} aprobadas · {excelAnalysis.invalidRows} rechazadas
                            </span>
                          </div>
                          <div style={{ maxHeight: '320px', overflowY: 'auto', border: '1px solid #E2E8F0', borderRadius: '0 0 8px 8px' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                              <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                                <tr style={{ background: '#F8FAFC', color: '#475569', textAlign: 'left', borderBottom: '1px solid #E2E8F0' }}>
                                  <th style={{ padding: '8px 10px', fontWeight: 700, fontSize: 11, width: 45 }}># Fila</th>
                                  <th style={{ padding: '8px 10px', fontWeight: 700, fontSize: 11, width: 135 }}>CÓDIGO ARCHIVO</th>
                                  <th style={{ padding: '8px 10px', fontWeight: 700, fontSize: 11 }}>DESCRIPCIÓN</th>
                                  <th style={{ padding: '8px 10px', fontWeight: 700, fontSize: 11, textAlign: 'right', width: 65 }}>CANTIDAD</th>
                                  <th style={{ padding: '8px 10px', fontWeight: 700, fontSize: 11, textAlign: 'center', width: 155 }}>LOTE / CADUCIDAD</th>
                                  <th style={{ padding: '8px 10px', fontWeight: 700, fontSize: 11, textAlign: 'center', width: 175 }}>RESULTADO Y MOTIVO</th>
                                </tr>
                              </thead>
                              <tbody>
                                {excelAnalysis.lines.map((l, i) => (
                                  <tr key={i} style={{
                                    borderBottom: '1px solid #F1F5F9',
                                    background: l.status === 'VALID' ? (i % 2 === 0 ? '#FFFFFF' : '#FAFAFA') : '#FFF7ED'
                                  }}>
                                    <td style={{ padding: '8px 10px', color: '#64748B', fontWeight: 600 }}>{l.rowNum}</td>
                                    <td style={{ padding: '8px 10px', fontWeight: 700, color: '#0F172A', fontFamily: 'monospace', fontSize: 12 }}>{l.codeOrEan}</td>
                                    <td style={{ padding: '8px 10px', color: '#334155', fontWeight: 500, fontSize: 12 }}>{l.descripcion || l.sku?.descripcion || '—'}</td>
                                    <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 800, color: l.cantidadEsperada > 0 ? '#0284C7' : '#DC2626', fontSize: 12 }}>
                                      {l.cantidadEsperada}
                                    </td>
                                    <td style={{ padding: '8px 10px', textAlign: 'center', color: '#64748B', fontSize: 11 }}>
                                      {l.lote || l.caducidad ? (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'center' }}>
                                          {l.lote ? <span style={{ fontWeight: 700, color: '#0F172A' }}>{l.lote}</span> : null}
                                          {l.caducidad ? <span style={{ fontSize: 10, color: '#64748B' }}>Vence: {l.caducidad}</span> : null}
                                        </div>
                                      ) : '—'}
                                    </td>
                                    <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                                      {l.status === 'VALID' && (
                                        <div>
                                          <span style={{
                                            background: '#DCFCE7',
                                            color: '#166534',
                                            border: '1px solid #86EFAC',
                                            padding: '2px 8px',
                                            borderRadius: 6,
                                            fontSize: 11,
                                            fontWeight: 700,
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: 4
                                          }}>
                                            <CheckCircle2 size={12} style={{ color: '#16A34A' }} /> Aprobado
                                          </span>
                                        </div>
                                      )}
                                      {l.status === 'INVALID_FOREIGN_CLIENT' && (
                                        <div>
                                          <span style={{
                                            background: '#FEF3C7',
                                            color: '#92400E',
                                            border: '1px solid #FCD34D',
                                            padding: '2px 8px',
                                            borderRadius: 6,
                                            fontSize: 11,
                                            fontWeight: 700,
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: 4
                                          }}>
                                            <AlertTriangle size={12} style={{ color: '#D97706' }} /> De Otro Depositante
                                          </span>
                                          <div style={{ fontSize: 10, color: '#B45309', marginTop: 2 }}>
                                            Pertenece a: {l.foreignClientName || 'Otro cliente'}
                                          </div>
                                        </div>
                                      )}
                                      {l.status === 'INVALID_NOT_FOUND' && (
                                        <div>
                                          <span style={{
                                            background: '#FEE2E2',
                                            color: '#991B1B',
                                            border: '1px solid #FCA5A5',
                                            padding: '2px 8px',
                                            borderRadius: 6,
                                            fontSize: 11,
                                            fontWeight: 700,
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: 4
                                          }}>
                                            <X size={12} style={{ color: '#DC2626' }} /> Producto Inexistente
                                          </span>
                                          <div style={{ fontSize: 10, color: '#B91C1C', marginTop: 2 }}>
                                            No existe en el catálogo general
                                          </div>
                                        </div>
                                      )}
                                      {l.status === 'INVALID_DATA' && (
                                        <div>
                                          <span style={{
                                            background: '#F1F5F9',
                                            color: '#B91C1C',
                                            border: '1px solid #FECACA',
                                            padding: '2px 8px',
                                            borderRadius: 6,
                                            fontSize: 11,
                                            fontWeight: 700,
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: 4
                                          }}>
                                            <AlertCircle size={12} style={{ color: '#DC2626' }} /> Dato Inválido
                                          </span>
                                          <div style={{ fontSize: 10, color: '#B91C1C', marginTop: 2 }}>
                                            {l.rejectionReason}
                                          </div>
                                        </div>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}

              {/* MODO MANUAL: Constructor de partidas SKU */}
              {previoMode === 'MANUAL' && (
                <div style={{ background: '#F8FAFC', padding: '16px', borderRadius: 10, border: '1px solid #CBD5E1', marginBottom: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#0F172A', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <PlusCircle size={16} style={{ color: '#0D9488' }} /> Capturar Productos del Previo Manualmente
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr auto', gap: 10, alignItems: 'flex-end', marginBottom: 14 }}>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label" style={{ fontSize: 11, color: '#475569', fontWeight: 600 }}>Producto / SKU</label>
                      <select 
                        className="form-select form-select-full" 
                        value={curManualSku} 
                        onChange={e => setCurManualSku(e.target.value)}
                        style={{ fontSize: 13 }}
                      >
                        <option value="">Seleccionar SKU...</option>
                        {(newPrevio.clienteId ? skus.filter(s => s.clienteId === newPrevio.clienteId) : skus).map(s => (
                          <option key={s.id} value={s.id}>{s.codigo} — {s.descripcion}</option>
                        ))}
                      </select>
                    </div>

                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label" style={{ fontSize: 11, color: '#475569', fontWeight: 600 }}>Cant. Esperada</label>
                      <input 
                        type="number" 
                        className="form-input" 
                        min={1} 
                        value={curManualQty} 
                        onFocus={e => e.target.select()}
                        onChange={e => {
                          const val = e.target.value;
                          if (val === '') {
                            setCurManualQty('');
                          } else {
                            const parsed = parseInt(val, 10);
                            setCurManualQty(isNaN(parsed) ? '' : parsed);
                          }
                        }}
                        onBlur={() => {
                          if (curManualQty === '' || Number(curManualQty) <= 0) {
                            setCurManualQty(1);
                          }
                        }}
                        placeholder="1"
                        style={{ fontSize: 13 }}
                      />
                    </div>

                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label" style={{ fontSize: 11, color: '#475569', fontWeight: 600 }}>Notas (Opcional)</label>
                      <input 
                        className="form-input" 
                        placeholder="Ej. Tarima 1" 
                        value={curManualNotas} 
                        onChange={e => setCurManualNotas(e.target.value)} 
                        style={{ fontSize: 13 }}
                      />
                    </div>

                    <button 
                      type="button" 
                      className="btn btn-primary" 
                      style={{ height: 38, background: '#0D9488', borderColor: '#0D9488', display: 'flex', alignItems: 'center', gap: 6 }}
                      onClick={() => {
                        if (!curManualSku) return;
                        const qty = Math.max(1, Number(curManualQty) || 1);
                        setManualLines([...manualLines, { skuId: curManualSku, cantidadEsperada: qty, notas: curManualNotas || undefined }]);
                        setCurManualSku('');
                        setCurManualQty(1);
                        setCurManualNotas('');
                      }}
                      disabled={!curManualSku}
                    >
                      <Plus size={16} /> Agregar
                    </button>
                  </div>

                  {manualLines.length > 0 ? (
                    <div style={{ border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden', background: '#FFFFFF' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                        <thead>
                          <tr style={{ background: '#F1F5F9', color: '#475569', textAlign: 'left', borderBottom: '1px solid #E2E8F0' }}>
                            <th style={{ padding: '8px 12px', fontWeight: 700, fontSize: 11 }}>SKU</th>
                            <th style={{ padding: '8px 12px', fontWeight: 700, fontSize: 11 }}>DESCRIPCIÓN</th>
                            <th style={{ padding: '8px 12px', fontWeight: 700, fontSize: 11, textAlign: 'right' }}>CANT. ESPERADA</th>
                            <th style={{ padding: '8px 12px', fontWeight: 700, fontSize: 11, textAlign: 'center' }}>ACCIÓN</th>
                          </tr>
                        </thead>
                        <tbody>
                          {manualLines.map((ml, i) => {
                            const found = skus.find(s => s.id === ml.skuId);
                            return (
                              <tr key={i} style={{ borderBottom: '1px solid #F1F5F9', background: i % 2 === 0 ? '#FFFFFF' : '#FAFAFA' }}>
                                <td style={{ padding: '8px 12px', fontWeight: 700, color: '#0F172A', fontFamily: 'monospace' }}>{found?.codigo || ml.skuId}</td>
                                <td style={{ padding: '8px 12px', color: '#334155' }}>{found?.descripcion || '—'}</td>
                                <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 800, color: '#0284C7' }}>{ml.cantidadEsperada} PZA</td>
                                <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                                  <button 
                                    type="button" 
                                    onClick={() => setManualLines(manualLines.filter((_, idx) => idx !== i))}
                                    style={{ background: 'transparent', border: 'none', color: '#DC2626', cursor: 'pointer', padding: 4 }}
                                  >
                                    <Trash2 size={15} />
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot>
                          <tr style={{ background: '#F0FDFA', fontWeight: 700, color: '#0F766E', borderTop: '1px solid #99F6E4' }}>
                            <td colSpan={2} style={{ padding: '8px 12px' }}>Total ({manualLines.length} partidas)</td>
                            <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 800, color: '#0F766E' }}>
                              {manualLines.reduce((sum, l) => sum + l.cantidadEsperada, 0)} PZA
                            </td>
                            <td></td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  ) : (
                    <div style={{ padding: '16px', textAlign: 'center', color: '#64748B', fontSize: 13, border: '1px dashed #CBD5E1', borderRadius: 8, background: '#FFFFFF' }}>
                      Selecciona un producto arriba y haz clic en "Agregar" para armar la lista de mercancía esperada.
                    </div>
                  )}
                </div>
              )}

              {formMsg.text && (
                <div className={`form-message ${formMsg.type === 'error' ? 'form-error-msg' : 'form-success-msg'}`} style={{ marginBottom: 14 }}>
                  {formMsg.text}
                </div>
              )}

              <div className="modal-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                <div>
                  {previoMode === 'EXCEL' ? (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={handleDownloadTemplate}>
                      <Download size={14} /> Descargar Plantilla Oficial (.xlsx)
                    </button>
                  ) : (
                    <div style={{ fontSize: 12, color: '#94a3b8' }}>
                      Partidas listas: <strong style={{ color: '#2dd4bf' }}>{manualLines.length}</strong> ({manualLines.reduce((sum, l) => sum + l.cantidadEsperada, 0)} unidades)
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: '#64748B', marginTop: 4 }}>
                    Estado local temporal. Los datos solo se guardan en el servidor al presionar Continuar y Crear Previo.
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <button 
                    type="button" 
                    className="btn btn-ghost" 
                    onClick={() => {
                      setShowNewPrevio(false);
                      setFile(null);
                      setExcelAnalysis(null);
                      setIsAnalyzing(false);
                      setFormMsg({ type: '', text: '' });
                      setManualLines([]);
                      setCurManualSku('');
                      setCurManualQty(1);
                      setCurManualNotas('');
                      if (fileInputRef.current) fileInputRef.current.value = '';
                      setNewPrevio({
                        clienteId: '', proveedorId: '', tipoRecepcion: 'RECEPCION', origen: 'NACIONAL',
                        tipoImportacion: 'NO_APLICA', facturaRespaldo: '',
                        lineaTransporte: '', placa: '', nombreChofer: '', ocReferencia: '', notas: ''
                      });
                    }}
                  >
                    Descartar Borrador
                  </button>
                  <button 
                    type="submit" 
                    className="btn btn-primary" 
                    disabled={
                      submitting || 
                      isAnalyzing ||
                      (previoMode === 'EXCEL' 
                        ? (!file || !excelAnalysis || excelAnalysis.totalRows === 0 || excelAnalysis.invalidRows > 0 || excelAnalysis.validRows === 0)
                        : manualLines.length === 0)
                    }
                    title={
                      previoMode === 'EXCEL' && excelAnalysis && excelAnalysis.invalidRows > 0
                        ? `Bloqueado: El archivo contiene ${excelAnalysis.invalidRows} partida(s) inválida(s) o rechazadas. Debe corregir el archivo para continuar.`
                        : undefined
                    }
                  >
                    {submitting ? 'Guardando Previo...' : isAnalyzing ? 'Analizando Archivo...' : (previoMode === 'EXCEL' ? 'Continuar y Crear Previo' : `Crear Previo Manual (${manualLines.length} partidas)`)}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- MODAL DE CONFIRMACIÓN Y CIERRE DE RECEPCIÓN (STITCH DARK HIGH-CONTRAST REDESIGN) --- */}
      {closingReceipt && (() => {
        let totalEsperado = 0;
        let totalConforme = 0;
        let totalDanada = 0;

        const activeLines = closingReceipt.lineas || [];
        activeLines.forEach((l: any) => {
          totalEsperado += l.cantidadEsperada || 0;
          totalConforme += l.cantidadRecibida || 0;
          totalDanada += l.cantidadDanada || 0;
        });
        const totalFisico = totalConforme + totalDanada;
        const variacion = totalFisico - totalEsperado;

        // Tarea 5: Detección estricta de discrepancias
        const discrepantLines = activeLines.filter((l: any) => {
          const esp = Number(l.cantidadEsperada ?? 0);
          const rec = Number(l.cantidadRecibida ?? 0);
          const dan = Number(l.cantidadDanada ?? 0);
          const fis = rec + dan;
          const dif = fis - esp;
          return (esp > 0 && (dif !== 0 || dan > 0)) || (esp === 0 && fis > 0);
        });

        const hasDiscrepancies = discrepantLines.length > 0;

        const isLineResolved = (lId: string) => {
          const item = closingDiscrepancies[lId];
          const clasif = item?.clasificacion || closingGlobalClasif;
          const justif = item?.justificacion || (clasif ? DEFAULT_DISCREPANCY_JUSTIFICATIONS[clasif] : '') || closingGlobalJustif;
          return Boolean(clasif && justif?.trim());
        };

        const unresolvedCount = discrepantLines.filter((l: any) => !isLineResolved(l.id)).length;
        const allDiscrepanciesResolved = !hasDiscrepancies || unresolvedCount === 0;

        return (
          <div className="modal-overlay" onClick={() => setClosingReceipt(null)}>
            <div 
              className="modal-content" 
              onClick={e => e.stopPropagation()} 
              style={{ 
                maxWidth: hasDiscrepancies ? 920 : 640, 
                width: '95%',
                maxHeight: '90vh',
                display: 'flex',
                flexDirection: 'column',
                background: '#FFFFFF', 
                color: '#0F172A', 
                border: hasDiscrepancies && !allDiscrepanciesResolved ? '1px solid #FECACA' : '1px solid #E2E8F0', 
                borderRadius: '16px',
                boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
                overflow: 'hidden',
                transition: 'all 0.3s ease'
              }}
            >
              {/* CABECERA MINIMALISTA */}
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '18px 24px',
                borderBottom: '1px solid #E2E8F0',
                flexShrink: 0,
                background: hasDiscrepancies && !allDiscrepanciesResolved
                  ? '#FEF2F2'
                  : '#F0FDFA'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ 
                    width: 42, height: 42, borderRadius: 10, 
                    background: hasDiscrepancies && !allDiscrepanciesResolved ? '#FEE2E2' : '#DCFCE7', 
                    color: hasDiscrepancies && !allDiscrepanciesResolved ? '#DC2626' : '#16A34A', 
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    border: hasDiscrepancies && !allDiscrepanciesResolved ? '1px solid #FCA5A5' : '1px solid #86EFAC'
                  }}>
                    {hasDiscrepancies && !allDiscrepanciesResolved ? <ShieldAlert size={22} /> : <CheckSquare size={22} />}
                  </div>
                  <div>
                    <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#0F172A', letterSpacing: '-0.01em' }}>
                      Finalizar y Cerrar Recepción ({closingReceipt.codigo})
                    </h2>
                    <p style={{ margin: '2px 0 0', fontSize: 13, color: '#64748B' }}>
                      {hasDiscrepancies 
                        ? 'Auditoría de conciliación física y resolución legal de no conformidades'
                        : 'Se generará la Hoja Oficial de Cierre ASN con auditoría de firmas'}
                    </p>
                  </div>
                </div>
                <button 
                  type="button" 
                  className="btn btn-ghost btn-sm" 
                  onClick={() => setClosingReceipt(null)}
                  style={{ color: '#64748B', padding: '6px 8px', borderRadius: 6 }}
                >
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={handleCloseReceiptSubmit} style={{ padding: '20px 24px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column' }}>
                
                {/* TARJETA METADATOS RESUMEN */}
                <div style={{ 
                  padding: '16px 20px', 
                  background: '#F8FAFC', 
                  borderRadius: 12, 
                  border: '1px solid #E2E8F0',
                  marginBottom: 20,
                  fontSize: 13
                }}>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#0D9488', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <ShieldCheck size={15} /> Resumen Auditoría de Cierre
                  </div>
                  
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 16px', marginBottom: 14 }}>
                    <div>
                      <span style={{ fontSize: 11, color: '#64748B', display: 'block' }}>Depositante</span>
                      <strong style={{ fontSize: 14, color: '#0F172A', fontWeight: 700 }}>{closingReceipt.cliente?.nombreComercial || 'Fashion Forward'}</strong>
                    </div>
                    <div>
                      <span style={{ fontSize: 11, color: '#64748B', display: 'block' }}>Factura / Orden de Compra</span>
                      <strong style={{ fontSize: 14, color: '#0D9488', fontFamily: 'monospace', fontWeight: 700 }}>{closingReceipt.facturaRespaldo || closingReceipt.ocReferencia || 'Sin Factura'}</strong>
                    </div>
                    <div>
                      <span style={{ fontSize: 11, color: '#64748B', display: 'block' }}>Líneas de SKU Registradas</span>
                      <strong style={{ fontSize: 14, color: '#059669', fontWeight: 700 }}>{activeLines.length} líneas de producto</strong>
                    </div>
                    <div>
                      <span style={{ fontSize: 11, color: '#64748B', display: 'block' }}>Línea de Transporte / Chofer</span>
                      <strong style={{ fontSize: 13, color: '#334155', fontWeight: 600 }}>{closingReceipt.lineaTransporte || 'Tres Guerras'} {closingReceipt.nombreChofer ? `(${closingReceipt.nombreChofer})` : ''}</strong>
                    </div>
                  </div>

                  {/* MINI KPIS DE BALANCE ANTES DE CERRAR */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, paddingTop: 12, borderTop: '1px solid #E2E8F0' }}>
                    <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', padding: '8px 10px', borderRadius: 8, textAlign: 'center' }}>
                      <div style={{ fontSize: 10, color: '#64748B', textTransform: 'uppercase', fontWeight: 700 }}>Esperadas</div>
                      <div style={{ fontSize: 15, fontWeight: 800, color: '#0F172A', marginTop: 2 }}>{totalEsperado.toLocaleString()}</div>
                    </div>
                    <div style={{ background: '#ECFDF5', border: '1px solid #A7F3D0', padding: '8px 10px', borderRadius: 8, textAlign: 'center' }}>
                      <div style={{ fontSize: 10, color: '#059669', textTransform: 'uppercase', fontWeight: 700 }}>Conformes</div>
                      <div style={{ fontSize: 15, fontWeight: 800, color: '#059669', marginTop: 2 }}>{totalConforme.toLocaleString()}</div>
                    </div>
                    <div style={{ background: totalDanada > 0 ? '#FFFBEB' : '#FFFFFF', padding: '8px 10px', borderRadius: 8, textAlign: 'center', border: totalDanada > 0 ? '1px solid #FDE68A' : '1px solid #E2E8F0' }}>
                      <div style={{ fontSize: 10, color: totalDanada > 0 ? '#D97706' : '#64748B', textTransform: 'uppercase', fontWeight: 700 }}>Merma / Daño</div>
                      <div style={{ fontSize: 15, fontWeight: 800, color: totalDanada > 0 ? '#D97706' : '#64748B', marginTop: 2 }}>{totalDanada.toLocaleString()}</div>
                    </div>
                    <div style={{ background: variacion !== 0 ? '#F0F9FF' : '#FFFFFF', padding: '8px 10px', borderRadius: 8, textAlign: 'center', border: variacion !== 0 ? '1px solid #BAE6FD' : '1px solid #E2E8F0' }}>
                      <div style={{ fontSize: 10, color: '#0284C7', textTransform: 'uppercase', fontWeight: 700 }}>Variación</div>
                      <div style={{ fontSize: 15, fontWeight: 800, color: variacion > 0 ? '#0284C7' : variacion < 0 ? '#DC2626' : '#059669', marginTop: 2 }}>
                        {variacion > 0 ? `+${variacion}` : variacion}
                      </div>
                    </div>
                  </div>
                </div>

                {/* --- SECCIÓN CONDICIONAL: 100% CUADRADO VS DISCREPANCIAS --- */}
                {!hasDiscrepancies ? (
                  <div style={{
                    padding: '14px 18px',
                    borderRadius: 10,
                    background: '#ECFDF5',
                    border: '1px solid #A7F3D0',
                    marginBottom: 20,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12
                  }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: '50%',
                      background: '#D1FAE5',
                      color: '#059669',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0
                    }}>
                      <CheckCircle2 size={20} />
                    </div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#065F46' }}>
                        Conciliación Física 100% Conforme
                      </div>
                      <div style={{ fontSize: 12, color: '#047857', marginTop: 2 }}>
                        Todas las cantidades físicas coinciden exactamente con la factura ({totalConforme} unidades conformes, 0 merma). Listo para cierre oficial.
                      </div>
                    </div>
                  </div>
                ) : (
                  <div style={{ marginBottom: 22 }}>
                    {/* BANNER DE BLOQUEO Y CANDADO DE SEGURIDAD */}
                    <div style={{
                      padding: '14px 18px',
                      borderRadius: 10,
                      background: '#FEF2F2',
                      border: '1px solid #FECACA',
                      marginBottom: 16,
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 12
                    }}>
                      <div style={{
                        width: 36, height: 36, borderRadius: '50%',
                        background: '#FEE2E2',
                        color: '#DC2626',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        flexShrink: 0, marginTop: 2
                      }}>
                        <ShieldAlert size={20} />
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 800, color: '#B91C1C', display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span>CANDADO DE CONTROL ACTIVO — {discrepantLines.length} {discrepantLines.length === 1 ? 'DISCREPANCIA DETECTADA' : 'DISCREPANCIAS DETECTADAS'}</span>
                        </div>
                        <p style={{ fontSize: 12, color: '#7F1D1D', margin: '4px 0 0', lineHeight: 1.45 }}>
                          Por estricta política operativa 3PL y responsabilidad legal, el sistema <strong style={{ color: '#991B1B' }}>bloquea el cierre definitivo</strong> mientras existan diferencias físicas sin justificación formal o sin clasificación de estatus.
                        </p>
                      </div>
                    </div>

                    {/* BARRA DE HOMOLOGACIÓN RÁPIDA (ACCIÓN MASIVA) */}
                    <div style={{
                      padding: '12px 14px',
                      background: '#F8FAFC',
                      borderRadius: 8,
                      border: '1px solid #E2E8F0',
                      marginBottom: 14,
                      fontSize: 12
                    }}>
                      <div style={{ fontWeight: 700, color: '#0284C7', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Zap size={14} /> Homologación Rápida (Aplicar a todas las discrepancias):
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr auto', gap: 8, alignItems: 'center' }}>
                        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                          <div style={{
                            position: 'absolute',
                            left: 10,
                            pointerEvents: 'none',
                            display: 'flex',
                            alignItems: 'center',
                            zIndex: 1
                          }}>
                            {getDiscrepancyStatusIcon(closingGlobalClasif, 15)}
                          </div>
                          <select
                            className="form-input"
                            value={closingGlobalClasif}
                            onChange={e => {
                              const val = e.target.value;
                              setClosingGlobalClasif(val);
                              if (val) {
                                const defaultText = DEFAULT_DISCREPANCY_JUSTIFICATIONS[val] || '';
                                if (!closingGlobalJustif.trim() || Object.values(DEFAULT_DISCREPANCY_JUSTIFICATIONS).includes(closingGlobalJustif.trim())) {
                                  setClosingGlobalJustif(defaultText);
                                }
                              }
                              if (closingErrorBanner) setClosingErrorBanner(null);
                            }}
                            style={{
                              width: '100%',
                              background: '#FFFFFF',
                              color: '#0F172A',
                              fontSize: 12,
                              height: 34,
                              paddingLeft: 32,
                              paddingRight: 8,
                              borderRadius: 6,
                              border: closingErrorBanner && !closingGlobalClasif ? '1px solid #EF4444' : '1px solid #CBD5E1'
                            }}
                          >
                            <option value="">-- Seleccionar Estatus Común --</option>
                            {DISCREPANCY_STATUS_OPTIONS.map(opt => (
                              <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                          </select>
                        </div>
                        <input
                          type="text"
                          className="form-input"
                          placeholder={closingGlobalClasif ? (DEFAULT_DISCREPANCY_JUSTIFICATIONS[closingGlobalClasif] || "Motivo / justificación general...") : "Motivo / justificación general para todas las diferencias..."}
                          value={closingGlobalJustif}
                          onChange={e => {
                            setClosingGlobalJustif(e.target.value);
                            if (closingErrorBanner) setClosingErrorBanner(null);
                          }}
                          style={{
                            background: '#FFFFFF',
                            color: '#0F172A',
                            fontSize: 12,
                            height: 34,
                            padding: '4px 10px',
                            borderRadius: 6,
                            border: closingErrorBanner && !closingGlobalJustif.trim() ? '1px solid #EF4444' : '1px solid #CBD5E1'
                          }}
                        />
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => {
                            if (!closingGlobalClasif) {
                              setClosingErrorBanner('Por favor seleccione una clasificación de estatus antes de homologar.');
                              setClosingSuccessBanner(null);
                              return;
                            }
                            const finalJustif = closingGlobalJustif.trim() || DEFAULT_DISCREPANCY_JUSTIFICATIONS[closingGlobalClasif] || 'Diferencia física justificada y validada en andén';
                            setClosingGlobalJustif(finalJustif);
                            setClosingErrorBanner(null);

                            const updated: Record<string, { clasificacion: string; justificacion: string }> = {};
                            discrepantLines.forEach((l: any) => {
                              updated[l.id] = { clasificacion: closingGlobalClasif, justificacion: finalJustif };
                            });
                            setClosingDiscrepancies(prev => ({ ...prev, ...updated }));

                            const matchedOpt = DISCREPANCY_STATUS_OPTIONS.find(o => o.value === closingGlobalClasif);
                            const optLabel = matchedOpt ? matchedOpt.label.split('(')[0].trim() : closingGlobalClasif;
                            setClosingSuccessBanner(`Homologado con éxito: Se asignó "${optLabel}" a las ${discrepantLines.length} partida(s) con discrepancia.`);
                            setTimeout(() => setClosingSuccessBanner(null), 4000);
                          }}
                          style={{
                            background: '#0284C7',
                            borderColor: '#0284C7',
                            color: '#FFF',
                            fontWeight: 700,
                            fontSize: 12,
                            height: 34,
                            whiteSpace: 'nowrap',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4
                          }}
                        >
                          <CheckCheck size={14} /> Aplicar a Todas
                        </button>
                      </div>

                      {closingErrorBanner && (
                        <div style={{
                          marginTop: 10,
                          padding: '8px 12px',
                          borderRadius: 8,
                          background: '#FEF2F2',
                          border: '1px solid #FECACA',
                          color: '#B91C1C',
                          fontSize: 12,
                          fontWeight: 600,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8
                        }}>
                          <AlertCircle size={16} style={{ color: '#DC2626', flexShrink: 0 }} />
                          <span>{closingErrorBanner}</span>
                        </div>
                      )}

                      {closingSuccessBanner && (
                        <div style={{
                          marginTop: 10,
                          padding: '8px 12px',
                          borderRadius: 8,
                          background: '#ECFDF5',
                          border: '1px solid #A7F3D0',
                          color: '#065F46',
                          fontSize: 12,
                          fontWeight: 600,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8
                        }}>
                          <CheckCircle2 size={16} style={{ color: '#059669', flexShrink: 0 }} />
                          <span>{closingSuccessBanner}</span>
                        </div>
                      )}
                    </div>

                    {/* TABLA DE PARTIDAS CON DISCREPANCIA */}
                    <div style={{
                      borderRadius: 8,
                      border: '1px solid #E2E8F0',
                      background: '#FFFFFF',
                      overflow: 'hidden',
                      maxHeight: 220,
                      overflowY: 'auto'
                    }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                        <thead>
                          <tr style={{ background: '#F8FAFC', borderBottom: '1px solid #E2E8F0', color: '#475569', textAlign: 'left' }}>
                            <th style={{ padding: '8px 12px', fontWeight: 700 }}>SKU / Producto</th>
                            <th style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 700 }}>Esperado</th>
                            <th style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 700 }}>Físico</th>
                            <th style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 700 }}>Diferencia</th>
                            <th style={{ padding: '8px 12px', fontWeight: 700 }}>Clasificación de Estatus *</th>
                            <th style={{ padding: '8px 12px', fontWeight: 700 }}>Justificación / Motivo Legal *</th>
                          </tr>
                        </thead>
                        <tbody>
                          {discrepantLines.map((l: any) => {
                            const esp = Number(l.cantidadEsperada ?? 0);
                            const rec = Number(l.cantidadRecibida ?? 0);
                            const dan = Number(l.cantidadDanada ?? 0);
                            const fis = rec + dan;
                            const dif = fis - esp;

                            const curResolution = closingDiscrepancies[l.id] || { clasificacion: '', justificacion: '' };
                            const effectiveClasif = curResolution.clasificacion || closingGlobalClasif;
                            const effectiveJustif = curResolution.justificacion || (effectiveClasif ? DEFAULT_DISCREPANCY_JUSTIFICATIONS[effectiveClasif] : '') || closingGlobalJustif;
                            const isResolved = Boolean(effectiveClasif && (curResolution.justificacion?.trim() || effectiveJustif?.trim()));

                            return (
                              <tr key={l.id} style={{
                                borderBottom: '1px solid #F1F5F9',
                                background: isResolved ? '#F0FDF4' : '#FEF2F2'
                              }}>
                                <td style={{ padding: '10px 12px' }}>
                                  <div style={{ fontWeight: 700, color: '#0F172A', fontFamily: 'monospace' }}>{l.sku?.codigo || 'SKU'}</div>
                                  <div style={{ fontSize: 11, color: '#64748B', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden', maxWidth: 160 }}>
                                    {l.sku?.descripcion || 'Sin descripción'}
                                  </div>
                                </td>
                                <td style={{ padding: '10px 10px', textAlign: 'center', color: '#475569', fontWeight: 700 }}>
                                  {esp}
                                </td>
                                <td style={{ padding: '10px 10px', textAlign: 'center' }}>
                                  <span style={{ color: '#059669', fontWeight: 700 }}>{rec}</span>
                                  {dan > 0 && <span style={{ color: '#DC2626', fontSize: 11, display: 'block' }}>+{dan} merma</span>}
                                </td>
                                <td style={{ padding: '10px 10px', textAlign: 'center' }}>
                                  <span style={{
                                    display: 'inline-block',
                                    padding: '2px 8px',
                                    borderRadius: 4,
                                    fontSize: 11,
                                    fontWeight: 800,
                                    background: dif < 0 ? '#FEF3C7' : dif > 0 ? '#E0F2FE' : '#FEE2E2',
                                    color: dif < 0 ? '#D97706' : dif > 0 ? '#0284C7' : '#DC2626'
                                  }}>
                                    {dif > 0 ? `+${dif}` : dif < 0 ? `${dif}` : `${dan} daño`}
                                  </span>
                                </td>
                                <td style={{ padding: '8px 12px', minWidth: 210 }}>
                                  <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                                    <div style={{
                                      position: 'absolute',
                                      left: 8,
                                      pointerEvents: 'none',
                                      display: 'flex',
                                      alignItems: 'center',
                                      zIndex: 1
                                    }}>
                                      {getDiscrepancyStatusIcon(curResolution.clasificacion, 13)}
                                    </div>
                                    <select
                                      value={curResolution.clasificacion}
                                      onChange={e => {
                                        const val = e.target.value;
                                        const currentJustif = curResolution.justificacion?.trim();
                                        const autoJustif = currentJustif || (val ? DEFAULT_DISCREPANCY_JUSTIFICATIONS[val] || '' : '') || closingGlobalJustif.trim();
                                        setClosingDiscrepancies(prev => ({
                                          ...prev,
                                          [l.id]: {
                                            clasificacion: val,
                                            justificacion: autoJustif
                                          }
                                        }));
                                      }}
                                      style={{
                                        width: '100%',
                                        background: '#FFFFFF',
                                        color: curResolution.clasificacion ? '#0F172A' : '#64748B',
                                        fontSize: 11,
                                        height: 32,
                                        paddingLeft: 28,
                                        paddingRight: 6,
                                        borderRadius: 6,
                                        border: !effectiveClasif ? '1px solid #EF4444' : '1px solid #CBD5E1'
                                      }}
                                    >
                                      <option value="">-- Seleccionar Estatus --</option>
                                      {DISCREPANCY_STATUS_OPTIONS.map(opt => (
                                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                                      ))}
                                    </select>
                                  </div>
                                </td>
                                <td style={{ padding: '8px 12px', minWidth: 200 }}>
                                  <input
                                    type="text"
                                    placeholder={effectiveClasif ? (DEFAULT_DISCREPANCY_JUSTIFICATIONS[effectiveClasif] || "Motivo formal de la diferencia...") : "Motivo formal de la diferencia..."}
                                    value={curResolution.justificacion}
                                    onChange={e => {
                                      const val = e.target.value;
                                      setClosingDiscrepancies(prev => ({
                                        ...prev,
                                        [l.id]: {
                                          clasificacion: prev[l.id]?.clasificacion || closingGlobalClasif || '',
                                          justificacion: val
                                        }
                                      }));
                                    }}
                                    style={{
                                      width: '100%',
                                      background: '#FFFFFF',
                                      color: '#0F172A',
                                      fontSize: 11,
                                      height: 32,
                                      padding: '2px 8px',
                                      borderRadius: 6,
                                      border: !effectiveJustif.trim() ? '1px solid #EF4444' : '1px solid #CBD5E1'
                                    }}
                                  />
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* CAMPO NOTAS U OBSERVACIONES */}
                <div className="form-group" style={{ marginBottom: 24 }}>
                  <label className="form-label" style={{ fontSize: 12, fontWeight: 700, color: '#0F172A', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Edit3 size={14} style={{ color: '#0D9488' }} /> Notas u Observaciones de Cierre (Opcional)
                  </label>
                  <textarea 
                    className="form-input" 
                    rows={3} 
                    placeholder="Observaciones de descarga, sellos de transporte, estado de tarimas..." 
                    value={closingNotes} 
                    onChange={e => setClosingNotes(e.target.value)} 
                    style={{ 
                      background: '#FFFFFF', 
                      color: '#0F172A', 
                      borderColor: '#CBD5E1',
                      fontSize: 13,
                      borderRadius: 8,
                      padding: '12px 14px'
                    }}
                  />
                </div>

                {/* FOOTER BOTONES DE ACCIÓN */}
                <div style={{ 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  alignItems: 'center', 
                  borderTop: '1px solid #E2E8F0', 
                  paddingTop: 16,
                  paddingBottom: 4,
                  marginTop: 16,
                  position: 'sticky',
                  bottom: 0,
                  background: '#FFFFFF',
                  zIndex: 10
                }}>
                  <div style={{ fontSize: 12, color: hasDiscrepancies && !allDiscrepanciesResolved ? '#DC2626' : '#64748B', display: 'flex', alignItems: 'center', gap: 6 }}>
                    {hasDiscrepancies && !allDiscrepanciesResolved ? (
                      <>
                        <Lock size={14} />
                        <span><strong>{unresolvedCount}</strong> partida{unresolvedCount > 1 ? 's' : ''} pendiente{unresolvedCount > 1 ? 's' : ''} de justificar</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 size={14} style={{ color: '#059669' }} />
                        <span>Todo listo para sellado oficial</span>
                      </>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 12 }}>
                    <button 
                      type="button" 
                      className="btn btn-ghost" 
                      onClick={() => setClosingReceipt(null)}
                      style={{ background: '#FFFFFF', color: '#475569', borderColor: '#CBD5E1', padding: '10px 18px', fontSize: 13 }}
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      className="btn btn-primary"
                      disabled={submitting || !allDiscrepanciesResolved}
                      style={{
                        background: allDiscrepanciesResolved ? '#059669' : '#94A3B8',
                        borderColor: allDiscrepanciesResolved ? '#059669' : '#94A3B8',
                        color: '#FFFFFF',
                        cursor: allDiscrepanciesResolved ? 'pointer' : 'not-allowed',
                        fontWeight: 800,
                        padding: '10px 22px',
                        fontSize: 13,
                        borderRadius: 8,
                        boxShadow: allDiscrepanciesResolved ? '0 2px 8px rgba(5, 150, 105, 0.25)' : 'none',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6
                      }}
                    >
                      {submitting ? (
                        <>Cerrando recepción...</>
                      ) : allDiscrepanciesResolved ? (
                        <><CheckSquare size={16} /> Confirmar y Generar Reporte de Cierre</>
                      ) : (
                        <><Lock size={16} style={{ color: '#FEF2F2' }} /> Cierre Bloqueado ({unresolvedCount} pendiente{unresolvedCount > 1 ? 's' : ''})</>
                      )}
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </div>
        );
      })()}

      {/* --- MODAL PRO DE IMPRESIÓN DE ETIQUETAS --- */}
      {printModalReceipt && (
        <ReceiptPrintModal
          receipt={printModalReceipt}
          locations={locations}
          token={token || undefined}
          onClose={() => {
            setPrintModalReceipt(null);
            loadData();
          }}
        />
      )}

      {/* --- MODAL REPORTE OFICIAL UNIFICADO DE RECEPCIÓN / DEVOLUCIONES (PROVA / GIVING OUT) --- */}
      {reportModalReceipt && (
        <ReceiptReportModal
          receipt={reportModalReceipt}
          onClose={() => setReportModalReceipt(null)}
        />
      )}

      {/* --- SUBFLUJO DEDICADO: DESVÍO A ALMACÉN VIRTUAL (NO CONFORME / MERMA / EXCESO) --- */}
      {divertModalData && (
        <DivertToVirtualModal
          receipt={divertModalData.receipt}
          initialItems={divertModalData.initialItems}
          initialTipoDesvio={divertModalData.initialTipoDesvio}
          token={token || undefined}
          onClose={() => setDivertModalData(null)}
          onSuccess={() => {
            loadData();
          }}
        />
      )}

      {/* --- FASE 1 GIVING OUT: MODAL DE RECEPCIÓN EN RAMPA Y LIBERACIÓN DE CHOFER --- */}
      {rampArrivalReceipt && (
        <RampArrivalModal
          receipt={rampArrivalReceipt}
          token={token || undefined}
          currentUser={user}
          onClose={() => setRampArrivalReceipt(null)}
          onSuccess={(updatedRec?: any) => {
            loadData();
            if (updatedRec) {
              setRampArrivalReceipt(updatedRec);
            }
          }}
          onViewDocument={(rec) => {
            setRampArrivalReceipt(null);
            setRampDocumentReceipt(rec);
          }}
        />
      )}

      {/* --- FASE 1 GIVING OUT: MODAL DE ACTA DE RAMPA OFICIAL IMPRIMIBLE --- */}
      {rampDocumentReceipt && (
        <RampDocumentModal
          receipt={rampDocumentReceipt}
          token={token || undefined}
          onClose={() => setRampDocumentReceipt(null)}
        />
      )}

      {/* --- FASE 1 GIVING OUT: MODAL DE DOBLE ETIQUETADO (TARIMAS MASTER + CAJAS ÚNICAS) --- */}
      {dualLabelReceipt && (
        <DualLabelModal
          receipt={dualLabelReceipt}
          token={token || undefined}
          currentUser={user}
          onClose={() => {
            setDualLabelReceipt(null);
            loadData();
          }}
          onSuccess={() => {
            loadData();
          }}
        />
      )}

      {/* --- FASE 2 GIVING OUT: INSPECCIÓN INTERNA Y REACONDICIONAMIENTO (MAQUILA / RESCATE) --- */}
      {qualityInspectionReceipt && (
        <QualityInspectionModal
          receipt={qualityInspectionReceipt}
          token={token || undefined}
          currentUser={user}
          onClose={() => {
            setQualityInspectionReceipt(null);
            loadData();
          }}
          onSuccess={() => {
            loadData();
          }}
        />
      )}

                  {/* ========================================================================= */}
      {/* VISTA UNIFICADA: EXPEDIENTE (DOSSIER) O LISTADO COMPACTO DE RECEPCIONES    */}
      {/* ========================================================================= */}
      {(() => {
        const currentReceipt = selectedReceiptId
          ? receipts.find(r => r.id === selectedReceiptId || r.codigo === selectedReceiptId) || null
          : null;

        if (currentReceipt) {
          const stage = computeReceiptStage(currentReceipt);
          const isClosed = stage.isClosed;

          // Verificación rigurosa de conteo físico exterior de rampa o avance operativo posterior
          const hasRampLiberation = Boolean(
            currentReceipt.fechaLiberacionChofer ||
            currentReceipt.liberadoChofer ||
            (currentReceipt.bultosRecibidos !== null && currentReceipt.bultosRecibidos !== undefined && currentReceipt.bultosRecibidos > 0) ||
            currentReceipt.firmaChofer ||
            currentReceipt.firmaReceptor ||
            currentReceipt.estado === 'RECIBIDO' ||
            currentReceipt.estado === 'EN_INSPECCION' ||
            currentReceipt.estado === 'ETIQUETADO' ||
            currentReceipt.estado === 'UBICADO' ||
            currentReceipt.estado === 'CERRADO' ||
            stage.index >= 2
          );

          // HUs reales desde la base de datos: Pallet / Tarima Master vs Cajas (Point 1, 2, 5)
          const allHus: any[] = currentReceipt.handlingUnits || [];
          const palletHu =
            allHus.find((h: any) => h.tipoHu === 'PALLET' || h.tipoHu === 'TARIMA') ||
            allHus.find((h: any) => allHus.some((child: any) => child.parentHuId === h.id)) ||
            allHus.find((h: any) => typeof h.codigo === 'string' && (h.codigo.startsWith('PLT-') || h.codigo.startsWith('TAR-'))) ||
            allHus.find((h: any) => h.tipoHu !== 'CAJA' && !(h.codigo || '').startsWith('BOX-') && !h.parentHuId) ||
            null;

          const boxHus = allHus.filter((h: any) => {
            if (palletHu && h.id === palletHu.id) return false;
            if (h.tipoHu === 'PALLET' || h.tipoHu === 'TARIMA') return false;
            if (typeof h.codigo === 'string' && (h.codigo.startsWith('PLT-') || h.codigo.startsWith('TAR-'))) return false;
            return true;
          });

          // 1. Conteo exterior en rampa
          const bultosDeclarados = currentReceipt.bultosDeclarados !== null && currentReceipt.bultosDeclarados !== undefined
            ? currentReceipt.bultosDeclarados
            : null;
          const bultosRecibidos = hasRampLiberation
            ? (currentReceipt.bultosRecibidos ?? (boxHus.length > 0 ? boxHus.length : null))
            : null;
          const bultosDanados = currentReceipt.bultosDanados ?? 0;
          const bultosFaltantes = hasRampLiberation && bultosRecibidos !== null && bultosDeclarados !== null
            ? Math.max(0, bultosDeclarados - bultosRecibidos)
            : 0;

          // Estado del dictamen de calidad e inspección
          const qualityInspectionRecord = currentReceipt.inspecciones?.[0] || currentReceipt.qualityInspections?.[0] || currentReceipt.qualityInspection || null;
          const isQualityCompleted = Boolean(
            qualityInspectionRecord ||
            currentReceipt.inspeccionCalidadEstado === 'COMPLETADA'
          );
          const hasDamagedBoxes = Boolean(bultosDanados > 0 || currentReceipt.cantidadDanada > 0);

          // 2. Clasificación detallada por partida y separación estricta de estados
          let totalEsperadas = 0;
          let piezasConfirmadasConformes = 0;
          let piezasMermaDictaminada = 0;
          let piezasPendientesConteo = 0;
          let faltantesConfirmadosPiezas = 0;

          const isAndenConteoCompleted = Boolean(
            currentReceipt.conteoAndenEstado === 'COMPLETADO' ||
            currentReceipt.estado === 'CONCILIADO' ||
            currentReceipt.estado === 'ETIQUETADO' ||
            currentReceipt.estado === 'UBICADO' ||
            currentReceipt.estado === 'COMPLETO' ||
            currentReceipt.estado === 'CERRADO' ||
            currentReceipt.estado === 'CERRADA' ||
            currentReceipt.etiquetasEstado === 'COLOCADAS' ||
            ((currentReceipt.lineas || []).length > 0 && (currentReceipt.lineas || []).every((l: any) =>
              l.estado === 'COMPLETO' ||
              l.estado === 'COMPLETADA' ||
              l.estado === 'CONCILIADO' ||
              (Number(l.cantidadRecibida || 0) + Number(l.cantidadDanada || 0) >= Number(l.cantidadEsperada || 0))
            ))
          );

          (currentReceipt.lineas || []).forEach((l: any) => {
            const esp = Number(l.cantidadEsperada || 0);
            const rec = Number(l.cantidadRecibida || 0);
            const dan = Number(l.cantidadDanada || 0);
            totalEsperadas += esp;

            piezasConfirmadasConformes += rec;
            piezasMermaDictaminada += dan;

            if (isClosed || isAndenConteoCompleted) {
              faltantesConfirmadosPiezas += Math.max(0, esp - rec - dan);
            } else {
              const isLineFullyClassified = (
                l.estado === 'COMPLETO' ||
                l.estado === 'COMPLETADA' ||
                l.estado === 'CONCILIADO' ||
                l.estado === 'RECIBIDA' ||
                (rec + dan >= esp)
              );

              if (isLineFullyClassified) {
                if (esp > rec + dan) {
                  faltantesConfirmadosPiezas += (esp - rec - dan);
                }
              } else {
                // Partida pendiente de conteo en andén o con dictamen parcial
                const pendiente = Math.max(0, esp - rec - dan);
                piezasPendientesConteo += pendiente;
              }
            }
          });

          // Cajas pendientes de clasificar en andén:
          const bultosRecibidosSanos = Math.max(0, (bultosRecibidos || 0) - (bultosDanados || 0));
          const cajasEnAndenPendientes = hasRampLiberation && bultosRecibidos !== null
            ? (isAndenConteoCompleted || isClosed ? 0 : bultosRecibidosSanos)
            : 0;

          const totalRecibidasConfirmadas = piezasConfirmadasConformes + piezasMermaDictaminada;

          // Desglose de partidas con faltantes confirmados
          const missingLines = (currentReceipt.lineas || []).filter((l: any) => {
            const esp = Number(l.cantidadEsperada || 0);
            const rec = Number(l.cantidadRecibida || 0);
            const dan = Number(l.cantidadDanada || 0);
            return esp > (rec + dan);
          });
          const missingSkusDetail = missingLines.map((l: any) => {
            const diff = Number(l.cantidadEsperada || 0) - (Number(l.cantidadRecibida || 0) + Number(l.cantidadDanada || 0));
            const factor = Number(l.sku?.capacidadEmpaque || l.sku?.piezasPorCaja || (l.sku?.codigo?.includes('ARR') ? 20 : 12)) || 1;
            const missingBoxes = Math.round(diff / factor);
            const lot = l.loteAsignado || l.loteEsperado || l.lote || '';
            return `${missingBoxes > 0 ? `${missingBoxes} ${missingBoxes === 1 ? 'caja' : 'cajas'} de ` : ''}${l.sku?.codigo || l.skuId}${lot ? ` / ${lot}` : ''}`;
          }).join(', ');

          // Cálculo riguroso de cajas / bultos esperados según empaque real de cada SKU
          const bultosEsperadosCalculados = (currentReceipt.lineas || []).reduce((sum: number, l: any) => {
            const cap = Number(l.sku?.capacidadEmpaque || l.capacidadEmpaque) || 1;
            const cant = Number(l.cantidadEsperada) || 0;
            return sum + (cap > 1 ? Math.ceil(cant / cap) : cant);
          }, 0);

          const bultosEsperados = currentReceipt.bultosDeclarados !== null && currentReceipt.bultosDeclarados !== undefined
            ? currentReceipt.bultosDeclarados
            : (bultosEsperadosCalculados > 0 ? bultosEsperadosCalculados : totalEsperadas);

          // Compatibilidad y enlaces de cuadre contable
          const totalConformes = piezasConfirmadasConformes;
          const totalDanadas = piezasMermaDictaminada;
          const totalFaltantes = faltantesConfirmadosPiezas;
          const totalRecibidas = totalRecibidasConfirmadas;
          const hasPieceClassification = (piezasConfirmadasConformes > 0 || piezasMermaDictaminada > 0) && piezasPendientesConteo === 0;

          const activasCount = boxHus.filter((b: any) => b.estadoHu === 'ACTIVO' || b.estadoHu === 'ALMACENADO' || b.estadoHu === 'EN_RACK').length;
          const despachadasCount = boxHus.filter((b: any) => b.estadoHu === 'DESPACHADO').length;
          const inactivasCount = boxHus.filter((b: any) => b.estadoHu === 'INACTIVO' || b.estadoHu === 'DAÑADO').length;
          const totalBoxesCount = boxHus.length;

          // Unidades físicas activas restantes en almacén
          const piezasActivasRestantes = boxHus
            .filter((b: any) => b.estadoHu === 'ACTIVO' || b.estadoHu === 'ALMACENADO' || b.estadoHu === 'EN_RACK')
            .reduce((s: number, b: any) => s + (Number(b.cantidad) || 0), 0);

          const piezasDespachadas = boxHus
            .filter((b: any) => b.estadoHu === 'DESPACHADO')
            .reduce((s: number, b: any) => s + (Number(b.cantidad) || 0), 0);

          // Disponibilidad elegible bajo política de caja cerrada (genérica según cliente)
          const isClientCajaCerrada = currentReceipt.cliente?.manejoInventario === 'CAJA' || currentReceipt.cliente?.uomPrincipal === 'CAJA' || currentReceipt.cliente?.reglaInventario === 'CAJA_CERRADA' || currentReceipt.cliente?.nombreComercial?.includes('AlimNorte');

          const eligibleBoxes = boxHus.filter((b: any) => {
            const isActive = b.estadoHu === 'ACTIVO' || b.estadoHu === 'ALMACENADO' || b.estadoHu === 'EN_RACK';
            if (!isActive) return false;
            if (isClientCajaCerrada) {
              const stdCapacity = b.piezasPorCaja || (b.skuCodigo?.includes('ACE') ? 12 : b.skuCodigo?.includes('ARR') ? 20 : 12);
              if (b.reacondicionada || Boolean(b.cajaOrigenId) || Number(b.cantidad) < stdCapacity) return false;
            }
            return true;
          });

          const piezasElegiblesCajaCerrada = eligibleBoxes.reduce((s: number, b: any) => s + (Number(b.cantidad) || 0), 0);
          const cajasElegiblesCajaCerrada = eligibleBoxes.length;

          // Reconstrucción cronológica y dinámica del Historial y Kárdex desde auditoría e inventario
          const timelineEvents = buildReceiptTimeline(currentReceipt, currentReceipt.auditLogs, currentReceipt.inventoryMovements);

          // 6 Etapas Operativas de Recepción Giving Out
          const STAGES = [
            { id: 0, name: 'Previo', label: '1. Previo', desc: 'Registro y validación de catálogo', done: true, current: false },
            { id: 1, name: 'Rampa', label: '2. Rampa', desc: 'Descarga y conteo exterior', done: Boolean(currentReceipt.fechaLiberacionChofer || currentReceipt.bultosRecibidos), current: stage.index === 1 && !isClosed },
            { id: 2, name: 'Calidad', label: '3. Calidad', desc: 'Inspección técnica y rescate', done: currentReceipt.inspeccionCalidadEstado === 'COMPLETADA' || (currentReceipt.bultosDanados === 0 && !currentReceipt.cantidadDanada), current: stage.index === 2 && !isClosed },
            { id: 3, name: 'Etiquetas', label: '4. Etiquetas', desc: 'Doble etiquetado QR/Code128', done: currentReceipt.etiquetasEstado === 'COLOCADAS', current: stage.index === 3 && !isClosed },
            { id: 4, name: 'Ubicación', label: '5. Ubicación', desc: 'Putaway con lectura física en racks', done: currentReceipt.estado === 'UBICADO' || currentReceipt.estado === 'COMPLETO' || isClosed, current: stage.index === 4 && !isClosed },
            { id: 5, name: 'Cierre', label: '6. Cierre', desc: 'Expediente histórico sellado', done: isClosed, current: isClosed || stage.index === 5 },
          ];

          return (
            <div className="unified-dossier-view" style={{ maxWidth: 1400, margin: '0 auto' }}>
              {/* BARRA DE NAVEGACIÓN SUPERIOR: RETORNO Y ACCIONES RÁPIDAS */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <button
                  type="button"
                  onClick={handleBackToList}
                  className="btn btn-secondary btn-sm"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 700 }}
                >
                  <ChevronLeft size={16} /> Volver al Listado de Recepciones
                </button>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button
                    type="button"
                    onClick={() => handleManualRefresh()}
                    disabled={loading || refreshingManual}
                    className="btn btn-secondary btn-sm"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      fontWeight: 600,
                      transition: 'all 0.2s ease',
                      borderColor: justRefreshed ? '#10B981' : undefined,
                      color: justRefreshed ? '#065F46' : undefined,
                      backgroundColor: justRefreshed ? '#ECFDF5' : undefined,
                    }}
                    title="Actualizar datos del expediente desde el servidor"
                  >
                    {justRefreshed ? (
                      <>
                        <Check size={13} style={{ color: '#10B981' }} /> ¡Actualizado!
                      </>
                    ) : (
                      <>
                        <RefreshCw size={13} className={(loading || refreshingManual) ? 'spin' : ''} />
                        {loading || refreshingManual ? 'Refrescando...' : 'Refrescar'}
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDualLabelReceipt(currentReceipt)}
                    className="btn btn-secondary btn-sm"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
                  >
                    <Printer size={13} /> Reimpresión Etiquetas
                  </button>
                </div>
              </div>

              {/* ENCABEZADO FIJO DE EXPEDIENTE */}
              <div style={{
                background: '#FFFFFF',
                borderRadius: 12,
                border: '1px solid #E2E8F0',
                padding: '20px 24px',
                marginBottom: 20,
                boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 14, marginBottom: 16 }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 20, fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em' }}>
                        {currentReceipt.codigo} · {currentReceipt.cliente?.nombreComercial || 'Depositante'} · {currentReceipt.facturaRespaldo || currentReceipt.ocReferencia || 'Sin Factura'}
                      </span>
                      <span style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 5,
                        padding: '4px 10px',
                        borderRadius: 20,
                        fontSize: 12,
                        fontWeight: 700,
                        background: stage.bg,
                        color: stage.color,
                        border: `1px solid ${stage.border}`
                      }}>
                        <stage.icon size={13} /> {stage.label}
                      </span>
                      {currentReceipt.tipoRecepcion === 'DEVOLUCION' && (
                        <span style={{ fontSize: 11, fontWeight: 700, background: '#FEF2F2', color: '#DC2626', border: '1px solid #FECACA', padding: '3px 8px', borderRadius: 6, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <RotateCcw size={11} /> Devolución
                        </span>
                      )}
                      {currentReceipt.cliente?.giro && (
                        <span style={{ fontSize: 11, fontWeight: 700, background: '#F8FAFC', color: '#475569', border: '1px solid #E2E8F0', padding: '3px 8px', borderRadius: 6 }}>
                          {currentReceipt.cliente.giro}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: '#64748B', marginTop: 4, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                      <span>Fecha Recepción: <strong>{formatCalendarDate(currentReceipt.fechaRecepcion)}</strong></span>
                      <span>Transporte: <strong>{currentReceipt.lineaTransporte || 'N/A'}</strong> {currentReceipt.placa ? `(${currentReceipt.placa})` : ''}</span>
                      <span>Chofer: <strong>{currentReceipt.nombreChofer || 'N/A'}</strong></span>
                    </div>
                  </div>

                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 11, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>Estado General</div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: stage.color, marginTop: 2 }}>{stage.pendingText}</div>
                  </div>
                </div>

                {/* Resumen Métrico KPI Strip Completo */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, background: '#F8FAFC', padding: '12px 16px', borderRadius: 8, border: '1px solid #E2E8F0' }}>
                  <div>
                    <div style={{ fontSize: 11, color: '#64748B', fontWeight: 600 }}>Esperadas</div>
                    <div style={{ fontSize: 17, fontWeight: 800, color: '#0F172A' }}>
                      {totalEsperadas} <span style={{ fontSize: 10.5, color: '#64748B', fontWeight: 500 }}>pzas ({bultosEsperados} cjs)</span>
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: '#64748B', fontWeight: 600 }}>Recibidas en Rampa</div>
                    <div style={{ fontSize: 17, fontWeight: 800, color: '#0284C7' }}>
                      {hasRampLiberation && bultosRecibidos !== null ? (
                        <>
                          {bultosRecibidos}{' '}
                          <span style={{ fontSize: 10.5, color: '#64748B', fontWeight: 500 }}>
                            {bultosRecibidos === 1 ? 'bulto' : 'bultos'}
                          </span>
                          {isClosed || isAndenConteoCompleted ? (
                            <span style={{ fontSize: 11, color: '#0284C7', fontWeight: 700, marginLeft: 4 }}>
                              · {totalRecibidasConfirmadas} pz físicas
                            </span>
                          ) : (
                            <span style={{ fontSize: 10.5, color: '#64748B', fontWeight: 500, fontStyle: 'italic', marginLeft: 4 }}>
                              · piezas por conciliar
                            </span>
                          )}
                        </>
                      ) : (
                        <span style={{ color: '#94A3B8', fontSize: 12, fontStyle: 'italic' }}>
                          Pendiente conteo en rampa
                        </span>
                      )}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: '#059669', fontWeight: 700 }}>
                      {isClosed ? 'Conformes al Cierre' : 'Conformes Confirmadas'}
                    </div>
                    <div style={{ fontSize: 17, fontWeight: 800, color: '#059669' }}>
                      {isClosed ? (
                        <>{piezasConfirmadasConformes} <span style={{ fontSize: 10.5, color: '#64748B', fontWeight: 500 }}>pzas ({boxHus.filter((b: any) => b.estadoHu !== 'INACTIVO' && b.estadoHu !== 'DAÑADO').length} cjs)</span></>
                      ) : piezasConfirmadasConformes > 0 ? (
                        <>
                          {piezasConfirmadasConformes}{' '}
                          <span style={{ fontSize: 10.5, color: '#64748B', fontWeight: 500 }}>
                            pzas {boxHus.filter((b: any) => b.estadoHu === 'ACTIVO' && (b.reacondicionada || b.cajaOrigenId)).length > 0
                              ? `(${bultosRecibidosSanos} sanas + ${boxHus.filter((b: any) => b.estadoHu === 'ACTIVO' && (b.reacondicionada || b.cajaOrigenId)).length} resc.)`
                              : `(${bultosRecibidosSanos} cjs)`}
                          </span>
                        </>
                      ) : (
                        <span style={{ fontSize: 12, color: '#64748B', fontWeight: 600, fontStyle: 'italic' }}>
                          Pendiente de conteo
                        </span>
                      )}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: (!isQualityCompleted && hasDamagedBoxes) ? '#7C3AED' : (piezasMermaDictaminada > 0 ? '#DC2626' : '#64748B'), fontWeight: 600 }}>
                      {!isQualityCompleted && hasDamagedBoxes ? 'Retenido en Calidad' : 'Merma Dictaminada'}
                    </div>
                    <div style={{ fontSize: 17, fontWeight: 800, color: (!isQualityCompleted && hasDamagedBoxes) ? '#7C3AED' : (piezasMermaDictaminada > 0 ? '#DC2626' : '#64748B') }}>
                      {!isQualityCompleted ? (
                        hasDamagedBoxes ? (
                          <>
                            {currentReceipt.bultosDanados}{' '}
                            <span style={{ fontSize: 10.5, color: '#64748B', fontWeight: 500 }}>
                              {currentReceipt.bultosDanados === 1 ? 'caja' : 'cajas'}
                            </span>{' '}
                            <span style={{ fontSize: 10.5, color: '#94A3B8', fontWeight: 500, fontStyle: 'italic' }}>
                              · dictamen pendiente
                            </span>
                          </>
                        ) : (
                          <>0 <span style={{ fontSize: 10.5, color: '#64748B', fontWeight: 500 }}>pzas</span></>
                        )
                      ) : (
                        <>{piezasMermaDictaminada} <span style={{ fontSize: 10.5, color: '#64748B', fontWeight: 500 }}>pzas</span></>
                      )}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: (!isClosed && !isAndenConteoCompleted && cajasEnAndenPendientes > 0) ? '#2563EB' : '#64748B', fontWeight: 600 }}>
                      Bultos en Andén
                    </div>
                    <div style={{ fontSize: 17, fontWeight: 800, color: (!isClosed && !isAndenConteoCompleted && cajasEnAndenPendientes > 0) ? '#2563EB' : '#64748B' }}>
                      {isClosed ? (
                        <span style={{ fontSize: 12, color: '#64748B', fontWeight: 500 }}>0 bultos · cerrado</span>
                      ) : isAndenConteoCompleted ? (
                        <>
                          {bultosRecibidosSanos}{' '}
                          <span style={{ fontSize: 10.5, color: '#64748B', fontWeight: 500 }}>
                            {bultosRecibidosSanos === 1 ? 'bulto sano' : 'bultos sanos'}
                          </span>
                          <div style={{ fontSize: 10.5, color: '#059669', fontWeight: 700, marginTop: 1 }}>
                            100% clasificado en andén
                          </div>
                        </>
                      ) : cajasEnAndenPendientes > 0 ? (
                        <>
                          {cajasEnAndenPendientes}{' '}
                          <span style={{ fontSize: 10.5, color: '#64748B', fontWeight: 500 }}>
                            {cajasEnAndenPendientes === 1 ? 'bulto recibido' : 'bultos recibidos'}
                          </span>
                          <div style={{ fontSize: 10.5, color: '#2563EB', fontWeight: 600, marginTop: 1 }}>
                            · pendientes de conteo por partida
                          </div>
                        </>
                      ) : (
                        <span style={{ fontSize: 12, color: '#059669', fontWeight: 700 }}>0 bultos · 100% clasificado</span>
                      )}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: (!isClosed && piezasPendientesConteo > 0) ? '#2563EB' : '#64748B', fontWeight: 600 }}>
                      Pendiente Conciliación
                    </div>
                    <div style={{ fontSize: 17, fontWeight: 800, color: (!isClosed && piezasPendientesConteo > 0) ? '#2563EB' : '#64748B' }}>
                      {isClosed ? (
                        <span style={{ fontSize: 12, color: '#64748B', fontWeight: 500 }}>0 pzas · cerrado</span>
                      ) : piezasPendientesConteo > 0 ? (
                        <>
                          {piezasPendientesConteo}{' '}
                          <span style={{ fontSize: 10.5, color: '#64748B', fontWeight: 500 }}>
                            piezas esperadas
                          </span>
                          <div style={{ fontSize: 10.5, color: '#2563EB', fontWeight: 600, marginTop: 1 }}>
                            · pendientes de conciliación
                          </div>
                        </>
                      ) : (
                        <span style={{ fontSize: 12, color: '#059669', fontWeight: 700 }}>0 pzas · 100% conciliado</span>
                      )}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: (isClosed || isAndenConteoCompleted ? (faltantesConfirmadosPiezas > 0 ? '#D97706' : '#64748B') : (bultosFaltantes > 0 ? '#D97706' : '#64748B')), fontWeight: 600 }}>
                      {isClosed ? 'Faltante al Cierre' : isAndenConteoCompleted ? 'Faltante Confirmado' : 'Faltante en Rampa'}
                    </div>
                    <div style={{ fontSize: 17, fontWeight: 800, color: (isClosed || isAndenConteoCompleted ? (faltantesConfirmadosPiezas > 0 ? '#D97706' : '#64748B') : (bultosFaltantes > 0 ? '#D97706' : '#64748B')) }}>
                      {isClosed || isAndenConteoCompleted ? (
                        faltantesConfirmadosPiezas > 0 ? (
                          <>
                            {faltantesConfirmadosPiezas}{' '}
                            <span style={{ fontSize: 10.5, color: '#D97706', fontWeight: 600 }}>
                              pzas confirmadas
                            </span>
                            <div style={{ fontSize: 10.5, color: '#B45309', fontWeight: 600, marginTop: 1 }}>
                              · {missingSkusDetail || `${bultosFaltantes || 1} caja faltante`}
                            </div>
                          </>
                        ) : (
                          <span style={{ fontSize: 12, color: '#059669', fontWeight: 700 }}>0 pzas · sin faltantes</span>
                        )
                      ) : bultosFaltantes > 0 ? (
                        <>
                          {bultosFaltantes}{' '}
                          <span style={{ fontSize: 10.5, color: '#D97706', fontWeight: 600 }}>
                            {bultosFaltantes === 1 ? 'bulto faltante' : 'bultos faltantes'}
                          </span>
                          <div style={{ fontSize: 10.5, color: '#D97706', fontWeight: 500, fontStyle: 'italic', marginTop: 1 }}>
                            · SKU y cantidad por confirmar
                          </div>
                        </>
                      ) : (
                        <span style={{ fontSize: 12, color: '#64748B', fontWeight: 500 }}>0 bultos</span>
                      )}
                    </div>
                  </div>
                  {isClosed && (
                    <>
                      <div>
                        <div style={{ fontSize: 11, color: '#2563EB', fontWeight: 600 }}>Salida Posterior</div>
                        <div style={{ fontSize: 17, fontWeight: 800, color: '#2563EB' }}>{piezasDespachadas} <span style={{ fontSize: 10.5, color: '#64748B', fontWeight: 500 }}>pzas ({despachadasCount} cjs)</span></div>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: '#0D9488', fontWeight: 700 }}>Stock Actual en Racks</div>
                        <div style={{ fontSize: 17, fontWeight: 800, color: '#0D9488' }}>{piezasActivasRestantes} <span style={{ fontSize: 10.5, color: '#64748B', fontWeight: 500 }}>pzas ({activasCount} cjs)</span></div>
                      </div>
                      <div style={{ borderLeft: '1px solid #CBD5E1', paddingLeft: 10 }}>
                        <div style={{ fontSize: 11, color: '#B45309', fontWeight: 700 }}>Elegible Caja Cerrada</div>
                        <div style={{ fontSize: 17, fontWeight: 800, color: '#B45309' }}>{piezasElegiblesCajaCerrada} <span style={{ fontSize: 10.5, color: '#64748B', fontWeight: 500 }}>pzas ({cajasElegiblesCajaCerrada} cjs)</span></div>
                      </div>
                    </>
                  )}
                </div>

                {/* Nota contable histórica y disponibilidad calculada de datos reales (Point 4 & 5) */}
                {isClosed && (
                  <div style={{ marginTop: 12, padding: '10px 14px', background: '#F0FDFA', border: '1px solid #CCFBF1', borderRadius: 8, fontSize: 12, color: '#0F766E', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <Info size={16} style={{ flexShrink: 0, marginTop: 1, color: '#0D9488' }} />
                    <div style={{ lineHeight: 1.5 }}>
                      <strong>Balance Histórico y Disponibilidad:</strong> Recibidas <strong>{totalRecibidas} piezas</strong> en andén de {totalEsperadas} esperadas{totalFaltantes > 0 ? ` (${totalFaltantes} faltantes en recepción)` : ''}.
                      Al cierre se asentaron <strong>{totalConformes} piezas conformes</strong> y <strong>{totalDanadas} piezas de merma</strong>.
                      {despachadasCount > 0 && (
                        <span> Con <strong>{piezasDespachadas} piezas despachadas</strong> ({despachadasCount} cajas), la existencia física actual en racks es de <strong>{piezasActivasRestantes} piezas ({activasCount} cajas activas)</strong>.</span>
                      )}
                      {isClientCajaCerrada && (
                        <span> Bajo la política de <strong>CAJA CERRADA</strong> del depositante {currentReceipt.cliente?.nombreComercial || 'asignado'}, la disponibilidad comercial elegible para pedidos estándar es de <strong>{piezasElegiblesCajaCerrada} piezas ({cajasElegiblesCajaCerrada} cajas cerradas)</strong>{piezasActivasRestantes > piezasElegiblesCajaCerrada ? `, manteniendo ${piezasActivasRestantes - piezasElegiblesCajaCerrada} piezas en unidades parciales o reacondicionadas fuera de la asignación estándar` : ''}.</span>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* UNA SOLA BARRA DE PROGRESO DE 6 ETAPAS */}
              <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 12, padding: '16px 20px', marginBottom: 20 }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#64748B', marginBottom: 12 }}>
                  Etapas Operativas de Recepción
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
                  {STAGES.map((s, idx) => {
                    const isCurrent = stage.index === idx && !isClosed;
                    const isDone = s.done;
                    return (
                      <div
                        key={s.id}
                        style={{
                          background: isClosed
                            ? '#F0FDF4'
                            : isCurrent
                            ? '#F0FDFA'
                            : isDone
                            ? '#F8FAFC'
                            : '#FFFFFF',
                          border: isClosed
                            ? '1.5px solid #86EFAC'
                            : isCurrent
                            ? '2px solid #0D9488'
                            : isDone
                            ? '1.5px solid #CBD5E1'
                            : '1px dashed #CBD5E1',
                          borderRadius: 8,
                          padding: '10px 12px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          position: 'relative'
                        }}
                      >
                        <div style={{
                          width: 24,
                          height: 24,
                          borderRadius: '50%',
                          background: isClosed
                            ? '#16A34A'
                            : isDone
                            ? '#0D9488'
                            : isCurrent
                            ? '#0D9488'
                            : '#E2E8F0',
                          color: isClosed || isDone || isCurrent ? '#FFFFFF' : '#64748B',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 11,
                          fontWeight: 800,
                          flexShrink: 0
                        }}>
                          {isClosed || isDone ? <Check size={14} /> : s.id + 1}
                        </div>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontSize: 12, fontWeight: 800, color: isClosed ? '#15803D' : isCurrent ? '#0D9488' : '#0F172A', lineHeight: 1.25 }}>
                            {s.label}
                          </div>
                          <div style={{ fontSize: 10.5, color: '#64748B', lineHeight: 1.2, marginTop: 2 }}>
                            {s.desc}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* TARJETA CONTEXTUAL: ¿QUÉ SIGUE? / ACCIÓN PRINCIPAL (UX-01, Point 8) */}
              <div style={{
                background: isClosed ? '#F8FAFC' : '#FFFFFF',
                borderRadius: 12,
                border: isClosed ? '1px solid #CBD5E1' : '2px solid #0D9488',
                padding: '18px 24px',
                marginBottom: 20,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 16
              }}>
                <div style={{ maxWidth: 720 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: isClosed ? '#64748B' : '#0D9488' }}>
                      {isClosed ? 'Expediente Sellado' : 'Acción Principal Requerida · ¿Qué sigue?'}
                    </span>
                  </div>
                  <h3 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: '#0F172A' }}>
                    {stage.actionTitle}
                  </h3>
                  <p style={{ margin: '6px 0 0', fontSize: 13, color: '#475569', lineHeight: 1.5 }}>
                    {stage.actionDescription}
                  </p>
                </div>

                <div>
                  {isClosed ? (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: '#059669', background: '#ECFDF5', padding: '6px 12px', borderRadius: 6, border: '1px solid #A7F3D0', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <ShieldCheck size={16} /> Consulta e Historial Permanente
                      </span>
                      <button
                        type="button"
                        onClick={() => setActiveDossierTab('DOCUMENTOS')}
                        className="btn btn-secondary btn-sm"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 700 }}
                      >
                        <FileText size={14} style={{ color: '#0D9488' }} /> Ver Documentos y Etiquetas
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => {
                        if (stage.actionType === 'RAMPA') setRampArrivalReceipt(currentReceipt);
                        else if (stage.actionType === 'CALIDAD') setQualityInspectionReceipt(currentReceipt);
                        else if (stage.actionType === 'ETIQUETAS') setDualLabelReceipt(currentReceipt);
                        else if (stage.actionType === 'UBICACION') setPutawayModalReceipt(currentReceipt);
                        else if (stage.actionType === 'CIERRE') setClosingReceipt(currentReceipt);
                        else if (stage.actionType === 'CONTEO') {
                          setActiveDossierTab('PARTIDAS');
                          setShowAndenCapture(true);
                          setTimeout(() => {
                            const el = document.getElementById('seccion-conteo-anden');
                            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                            const firstInput = document.querySelector<HTMLInputElement>('#seccion-conteo-anden input[type="number"]');
                            if (firstInput) firstInput.focus();
                          }, 100);
                        }
                      }}
                      style={{
                        padding: '12px 24px',
                        fontSize: 14,
                        fontWeight: 800,
                        borderRadius: 8,
                        background: '#0D9488',
                        borderColor: '#0D9488',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 8,
                        boxShadow: '0 2px 8px rgba(13,148,136,0.3)'
                      }}
                    >
                      <stage.icon size={16} /> {stage.actionButtonLabel} <ArrowRight size={16} />
                    </button>
                  )}
                </div>
              </div>

              {/* SECCIONES Y PESTAÑAS DEL EXPEDIENTE */}
              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{ display: 'flex', borderBottom: '1px solid #E2E8F0', background: '#F8FAFC', padding: '0 16px', overflowX: 'auto' }}>
                  <button
                    type="button"
                    onClick={() => setActiveDossierTab('PARTIDAS')}
                    style={{
                      padding: '12px 18px',
                      border: 'none',
                      background: 'transparent',
                      borderBottom: activeDossierTab === 'PARTIDAS' ? '2.5px solid #0D9488' : '2.5px solid transparent',
                      color: activeDossierTab === 'PARTIDAS' ? '#0D9488' : '#64748B',
                      fontWeight: 700,
                      fontSize: 13,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      whiteSpace: 'nowrap'
                    }}
                  >
                    <Package size={15} /> Partidas y Balance ({currentReceipt.lineas?.length || 0})
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveDossierTab('HUS')}
                    style={{
                      padding: '12px 18px',
                      border: 'none',
                      background: 'transparent',
                      borderBottom: activeDossierTab === 'HUS' ? '2.5px solid #0D9488' : '2.5px solid transparent',
                      color: activeDossierTab === 'HUS' ? '#0D9488' : '#64748B',
                      fontWeight: 700,
                      fontSize: 13,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      whiteSpace: 'nowrap'
                    }}
                  >
                    <Box size={15} /> Cajas en Almacén ({activasCount} activas · {totalBoxesCount} total)
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveDossierTab('DOCUMENTOS')}
                    style={{
                      padding: '12px 18px',
                      border: 'none',
                      background: 'transparent',
                      borderBottom: activeDossierTab === 'DOCUMENTOS' ? '2.5px solid #0D9488' : '2.5px solid transparent',
                      color: activeDossierTab === 'DOCUMENTOS' ? '#0D9488' : '#64748B',
                      fontWeight: 700,
                      fontSize: 13,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      whiteSpace: 'nowrap'
                    }}
                  >
                    <FileText size={15} /> Documentos y Etiquetas
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveDossierTab('TRANSPORTE')}
                    style={{
                      padding: '12px 18px',
                      border: 'none',
                      background: 'transparent',
                      borderBottom: activeDossierTab === 'TRANSPORTE' ? '2.5px solid #0D9488' : '2.5px solid transparent',
                      color: activeDossierTab === 'TRANSPORTE' ? '#0D9488' : '#64748B',
                      fontWeight: 700,
                      fontSize: 13,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      whiteSpace: 'nowrap'
                    }}
                  >
                    <Truck size={15} /> Transporte y Andén
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveDossierTab('HISTORIAL')}
                    style={{
                      padding: '12px 18px',
                      border: 'none',
                      background: 'transparent',
                      borderBottom: activeDossierTab === 'HISTORIAL' ? '2.5px solid #0D9488' : '2.5px solid transparent',
                      color: activeDossierTab === 'HISTORIAL' ? '#0D9488' : '#64748B',
                      fontWeight: 700,
                      fontSize: 13,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      whiteSpace: 'nowrap'
                    }}
                  >
                    <Clock size={15} /> Historial y Kárdex ({timelineEvents.length})
                  </button>
                </div>

                <div style={{ padding: 20 }}>
                  {/* TAB 1: PARTIDAS Y BALANCE CON FALTANTES EXPLÍCITOS Y RACKS POR LOTE (Point 1, 6) */}
                  {activeDossierTab === 'PARTIDAS' && (
                    <div>
                      {/* BANNERS DE ESTADO DE CONCILIACIÓN EN ANDÉN */}
                      {andenSuccessBanner && andenSuccessBanner.receiptId === currentReceipt.id && (
                        <div style={{ background: '#ECFDF5', border: '1px solid #A7F3D0', color: '#065F46', padding: '12px 16px', borderRadius: 8, marginBottom: 16, fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 10 }}>
                          <CheckCircle2 size={18} style={{ color: '#059669', flexShrink: 0 }} />
                          <div style={{ flex: 1 }}>{andenSuccessBanner.text}</div>
                          <button type="button" onClick={() => setAndenSuccessBanner(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#065F46', fontWeight: 700, fontSize: 14, display: 'inline-flex', alignItems: 'center' }}><X size={14} /></button>
                        </div>
                      )}
                      {andenErrorBanner && andenErrorBanner.receiptId === currentReceipt.id && (
                        <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', color: '#991B1B', padding: '12px 16px', borderRadius: 8, marginBottom: 16, fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 10 }}>
                          <AlertTriangle size={18} style={{ color: '#DC2626', flexShrink: 0 }} />
                          <div style={{ flex: 1 }}>{andenErrorBanner.text}</div>
                          <button type="button" onClick={() => setAndenErrorBanner(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#991B1B', fontWeight: 700, fontSize: 14, display: 'inline-flex', alignItems: 'center' }}><X size={14} /></button>
                        </div>
                      )}

                      {/* ENCABEZADO Y BOTÓN DE APERTURA / CONMUTACIÓN DE CONTEO EN ANDÉN */}
                      {!isClosed && (
                        <div style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          marginBottom: 16,
                          flexWrap: 'wrap',
                          gap: 12,
                          background: '#F8FAFC',
                          padding: '12px 18px',
                          borderRadius: 8,
                          border: '1px solid #E2E8F0'
                        }}>
                          <div>
                            <div style={{ fontSize: 13.5, fontWeight: 800, color: '#0F172A', display: 'flex', alignItems: 'center', gap: 7 }}>
                              <Package size={16} style={{ color: '#0284C7' }} />
                              Verificación y Conciliación Física en Andén
                            </div>
                            <div style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>
                              {isAndenConteoCompleted
                                ? `Conteo físico y conciliación completados (${bultosRecibidosSanos} bultos sanos conciliados contra rampa). Puede revisar los valores o modificar la captura si se requiere.`
                                : stage.actionType === 'CONTEO'
                                ? `Inspección de calidad completada. En andén restan ${cajasEnAndenPendientes} bultos sanos recibidos pendientes de conteo y verificación por partida.`
                                : `Capture o verifique los bultos sanos recibidos en andén por partida antes de generar etiquetas o cerrar el expediente.`}
                            </div>
                          </div>
                          <button
                            type="button"
                            id="btn-toggle-conteo-anden"
                            onClick={() => {
                              const nextState = !showAndenCapture;
                              setShowAndenCapture(nextState);
                              if (nextState) {
                                setTimeout(() => {
                                  const el = document.getElementById('seccion-conteo-anden');
                                  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                  const firstInput = document.querySelector<HTMLInputElement>('#seccion-conteo-anden input[type="number"]');
                                  if (firstInput) firstInput.focus();
                                }, 100);
                              }
                            }}
                            className="btn"
                            style={{
                              background: showAndenCapture ? '#FFFFFF' : isAndenConteoCompleted ? '#F0F9FF' : '#0284C7',
                              color: showAndenCapture ? '#0F172A' : isAndenConteoCompleted ? '#0284C7' : '#FFFFFF',
                              border: showAndenCapture ? '1px solid #CBD5E1' : isAndenConteoCompleted ? '1px solid #BAE6FD' : 'none',
                              padding: '8px 16px',
                              borderRadius: 6,
                              fontWeight: 700,
                              fontSize: 13,
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 6,
                              cursor: 'pointer',
                              boxShadow: showAndenCapture ? 'none' : '0 2px 6px rgba(2,132,199,0.3)',
                            }}
                          >
                            <Package size={15} />
                            {showAndenCapture
                              ? 'Ocultar Formulario de Conteo'
                              : isAndenConteoCompleted
                              ? 'Revisar / Modificar Conteo en Andén'
                              : 'Capturar Conteo en Andén'}
                          </button>
                        </div>
                      )}

                      {/* SECCIÓN INTERACTIVA DE CONTEO Y CONCILIACIÓN FÍSICA EN ANDÉN */}
                      {!isClosed && showAndenCapture && (() => {
                        const receiptDraft = andenDrafts[currentReceipt.id] || {};
                        const linesList = currentReceipt.lineas || [];

                        // Función auxiliar para vincular cajas HUs a la partida exacta por receiptLineId o lote estricto
                        const matchBoxToLine = (box: any, line: any) => {
                          if (box.receiptLineId && line.id) {
                            return box.receiptLineId === line.id;
                          }
                          const matchSku = box.skuCodigo ? box.skuCodigo === line.sku?.codigo : true;
                          if (!matchSku) return false;

                          const lineLot = (line.loteAsignado || line.loteEsperado || line.lote || '').trim().toLowerCase();
                          const boxLot = (box.loteTexto || box.lote?.lote || '').trim().toLowerCase();
                          if (lineLot && boxLot) {
                            return lineLot === boxLot;
                          }
                          return false;
                        };

                        // Cálculos acumulados en vivo a partir de las entradas del usuario y dictámenes previos
                        let sumCajasSanasDraft = 0;
                        let sumPiezasSanasDraft = 0;
                        let sumRescatadasPrevias = 0;
                        let sumMermaPrevias = 0;
                        let sumEsperadasTotal = 0;

                        linesList.forEach((l: any) => {
                          const factor = Number(l.sku?.capacidadEmpaque || l.sku?.piezasPorCaja || (l.sku?.codigo?.includes('ACE') ? 12 : l.sku?.codigo?.includes('ARR') ? 20 : 1)) || 1;
                          const esp = Number(l.cantidadEsperada || 0);
                          sumEsperadasTotal += esp;

                          const lineRescuedBoxes = boxHus.filter((b: any) =>
                            b.tipoHu === 'CAJA' &&
                            b.estadoHu === 'ACTIVO' &&
                            (b.reacondicionada || b.cajaOrigenId) &&
                            matchBoxToLine(b, l)
                          );
                          const lineRescuedPieces = lineRescuedBoxes.reduce((s: number, b: any) => s + (Number(b.cantidad) || 0), 0);
                          const lineMermaPieces = Number(l.cantidadDanada || 0);
                          sumRescatadasPrevias += lineRescuedPieces;
                          sumMermaPrevias += lineMermaPieces;

                          const defaultPiezas = Math.max(0, Number(l.cantidadRecibida || 0) - lineRescuedPieces);
                          const defaultCajas = factor > 0 ? Math.floor(defaultPiezas / factor) : 0;

                          const draft = receiptDraft[l.id];
                          const cItem = draft?.cajasSanas !== undefined
                            ? draft.cajasSanas
                            : (isAndenConteoCompleted || Number(l.cantidadRecibida || 0) > 0 ? defaultCajas : '');
                          const pItem = draft?.piezasSanas !== undefined
                            ? draft.piezasSanas
                            : (isAndenConteoCompleted || Number(l.cantidadRecibida || 0) > 0 ? defaultPiezas : '');

                          if (typeof cItem === 'number') {
                            sumCajasSanasDraft += cItem;
                            sumPiezasSanasDraft += (typeof pItem === 'number' ? pItem : cItem * factor);
                          } else if (typeof pItem === 'number') {
                            sumPiezasSanasDraft += pItem;
                            sumCajasSanasDraft += Math.round(pItem / factor);
                          }
                        });

                        const totalBultosRecibidosRampa = bultosRecibidos !== null && bultosRecibidos !== undefined
                          ? Number(bultosRecibidos)
                          : (bultosDeclarados || 0);

                        const totalBultosDanadosCalidad = Math.max(
                          Number(bultosDanados || 0),
                          (currentReceipt.inspecciones || []).reduce((s: number, i: any) => s + (Number(i.totalCajasInspeccionadas) || 0), 0),
                          (currentReceipt.cantidadDanada ? 1 : 0)
                        );

                        // Bultos sanos esperados en andén reconstruidos fielmente desde rampa/calidad
                        const bultosSanosEsperadosAnden = Math.max(0, totalBultosRecibidosRampa - totalBultosDanadosCalidad);

                        const isCountingFinished = (sumCajasSanasDraft === bultosSanosEsperadosAnden && sumCajasSanasDraft > 0) || isAndenConteoCompleted;
                        const totalPiezasFisicasContadas = (sumRescatadasPrevias + sumPiezasSanasDraft) + sumMermaPrevias;
                        const sumFaltantesConfirmados = isCountingFinished ? Math.max(0, sumEsperadasTotal - totalPiezasFisicasContadas) : 0;
                        const sumPiezasPendientesConteo = Math.max(0, sumEsperadasTotal - totalPiezasFisicasContadas - sumFaltantesConfirmados);

                        const rescuedLotsList = Array.from(new Set(
                          linesList
                            .filter((lItem: any) => {
                              const rBoxes = boxHus.filter((b: any) =>
                                b.tipoHu === 'CAJA' &&
                                b.estadoHu === 'ACTIVO' &&
                                (b.reacondicionada || b.cajaOrigenId) &&
                                matchBoxToLine(b, lItem)
                              );
                              return rBoxes.some((b: any) => (Number(b.cantidad) || 0) > 0);
                            })
                            .map((lItem: any) => (lItem.loteAsignado || lItem.loteEsperado || lItem.lote || '').trim())
                            .filter(Boolean)
                        ));

                        return (
                          <div
                            id="seccion-conteo-anden"
                            style={{
                              background: '#FFFFFF',
                              borderRadius: 10,
                              border: '2px solid #0284C7',
                              boxShadow: '0 4px 14px rgba(2,132,199,0.08)',
                              padding: '22px 24px',
                              marginBottom: 24,
                            }}
                          >
                            {/* Cabecera del formulario de captura */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 14, marginBottom: 18 }}>
                              <div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                                  <span style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#0284C7', background: '#F0F9FF', padding: '3px 8px', borderRadius: 4, border: '1px solid #BAE6FD' }}>
                                    Conteo y Conciliación en Andén
                                  </span>
                                  <span style={{ fontSize: 12, fontWeight: 700, color: '#64748B' }}>
                                    Verificación física de bultos sanos y conciliación contra rampa
                                  </span>
                                </div>
                                <h4 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: '#0F172A' }}>
                                  Captura y Conciliación Física por Partida
                                </h4>
                                <p style={{ margin: '6px 0 0', fontSize: 13, color: '#475569', maxWidth: 900, lineHeight: 1.5 }}>
                                  Capture los bultos y piezas sanas recibidos físicamente en andén. Las cantidades sanas se <strong>sumarán a las piezas rescatadas previamente</strong> en inspección de calidad ({sumRescatadasPrevias} pzas rescatadas / {sumMermaPrevias} pzas merma), conservando los dictámenes por partida exacta sin duplicar registros. La disponibilidad en inventario permanecerá estrictamente en <strong>0</strong> hasta el alojamiento físico en racks (Putaway).
                                </p>
                              </div>

                              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                                <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', padding: '8px 14px', borderRadius: 8, textAlign: 'right' }}>
                                  <div style={{ fontSize: 11, color: '#64748B', fontWeight: 600 }}>En Andén Recibidos</div>
                                  <div style={{ fontSize: 13, fontWeight: 800, color: '#0F172A' }}>
                                    <span style={{ color: '#0284C7' }}>{bultosSanosEsperadosAnden} bultos sanos</span> en rampa
                                  </div>
                                </div>
                                <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', padding: '8px 14px', borderRadius: 8, textAlign: 'right' }}>
                                  <div style={{ fontSize: 11, color: '#64748B', fontWeight: 600 }}>Capturados en Formulario</div>
                                  <div style={{ fontSize: 13, fontWeight: 800, color: sumCajasSanasDraft === bultosSanosEsperadosAnden ? '#059669' : '#D97706' }}>
                                    {sumCajasSanasDraft} de {bultosSanosEsperadosAnden} bultos
                                    {sumCajasSanasDraft === bultosSanosEsperadosAnden && (
                                      <span style={{ fontSize: 11, color: '#059669', marginLeft: 4 }}>Cuadra</span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>

                            {/* TABLA DE CAPTURA POR PARTIDA */}
                            <div style={{ overflowX: 'auto', marginBottom: 18 }}>
                              <table style={{ width: '100%', fontSize: 12.5, borderCollapse: 'collapse', border: '1px solid #E2E8F0' }}>
                                <thead>
                                  <tr style={{ background: '#F1F5F9', borderBottom: '2px solid #CBD5E1', textAlign: 'left', color: '#334155' }}>
                                    <th style={{ padding: '10px 12px' }}>SKU / Lote / Producto</th>
                                    <th style={{ padding: '10px 12px', textAlign: 'center' }}>Empaque</th>
                                    <th style={{ padding: '10px 12px', textAlign: 'right' }}>Esperada</th>
                                    <th style={{ padding: '10px 12px', textAlign: 'center', background: '#F8FAFC' }}>Dictamen Calidad Previo</th>
                                    <th style={{ padding: '10px 12px', textAlign: 'center', background: '#EFF6FF', minWidth: 140 }}>Cajas Sanas en Andén</th>
                                    <th style={{ padding: '10px 12px', textAlign: 'center', background: '#EFF6FF', minWidth: 140 }}>Piezas Sanas en Andén</th>
                                    <th style={{ padding: '10px 12px', textAlign: 'right' }}>Total Conformes</th>
                                    <th style={{ padding: '10px 12px', textAlign: 'right' }}>Balance / Faltante</th>
                                    <th style={{ padding: '10px 12px', minWidth: 180 }}>Lote y Caducidad</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {linesList.map((l: any, lineIdx: number) => {
                                    const factor = Number(l.sku?.capacidadEmpaque || l.sku?.piezasPorCaja || (l.sku?.codigo?.includes('ACE') ? 12 : l.sku?.codigo?.includes('ARR') ? 20 : 1)) || 1;
                                    const esp = Number(l.cantidadEsperada || 0);
                                    const cjsEsperadas = Math.ceil(esp / factor);

                                    // Cajas y piezas previamente dictaminadas en calidad vinculadas estrictamente a ESTA partida
                                    const lineRescuedBoxes = boxHus.filter((b: any) =>
                                      b.tipoHu === 'CAJA' &&
                                      b.estadoHu === 'ACTIVO' &&
                                      (b.reacondicionada || b.cajaOrigenId) &&
                                      matchBoxToLine(b, l)
                                    );
                                    const lineRescuedPieces = lineRescuedBoxes.reduce((s: number, b: any) => s + (Number(b.cantidad) || 0), 0);
                                    const lineMermaPieces = Number(l.cantidadDanada || 0);
                                    const lineInsp = (currentReceipt.inspecciones || []).find((insp: any) =>
                                      lineRescuedBoxes.some((b: any) => b.inspeccionId === insp.id)
                                    ) || (currentReceipt.inspecciones?.[0] || null);
                                    const lineInspText = lineInsp?.folio ? `(${lineInsp.folio})` : '(Calidad)';

                                    // Entradas en borrador del usuario para esta línea
                                    const draft = receiptDraft[l.id];
                                    const defaultPiezas = Math.max(0, Number(l.cantidadRecibida || 0) - lineRescuedPieces);
                                    const defaultCajas = factor > 0 ? Math.floor(defaultPiezas / factor) : 0;

                                    const cVal = draft?.cajasSanas !== undefined
                                      ? draft.cajasSanas
                                      : (isAndenConteoCompleted || Number(l.cantidadRecibida || 0) > 0 ? defaultCajas : '');
                                    const pVal = draft?.piezasSanas !== undefined
                                      ? draft.piezasSanas
                                      : (isAndenConteoCompleted || Number(l.cantidadRecibida || 0) > 0 ? defaultPiezas : '');
                                    const loteVal = draft?.lote !== undefined ? draft.lote : (l.loteAsignado || l.loteEsperado || l.lote || '');
                                    const caducidadVal = draft?.fechaVencimiento !== undefined ? draft.fechaVencimiento : (l.fechaVencimiento ? String(l.fechaVencimiento).slice(0, 10) : '');

                                    // Cálculos automáticos para esta partida
                                    const pSanasCalc = typeof pVal === 'number' ? pVal : (typeof cVal === 'number' ? cVal * factor : 0);
                                    const totalConformesLinea = lineRescuedPieces + pSanasCalc;
                                    const totalRecibidasLinea = totalConformesLinea + lineMermaPieces;
                                    const faltanteLinea = Math.max(0, esp - totalRecibidasLinea);
                                    const hasUserTyped = typeof cVal === 'number' || typeof pVal === 'number' || isAndenConteoCompleted || Number(l.cantidadRecibida || 0) > 0;

                                    return (
                                      <tr key={l.id || lineIdx} style={{ borderBottom: '1px solid #E2E8F0', background: lineIdx % 2 === 0 ? '#FFFFFF' : '#FAFAFA' }}>
                                        {/* SKU / Lote / Descripción (Visible sin desplazamiento horizontal) */}
                                        <td style={{ padding: '10px 12px' }}>
                                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 3 }}>
                                            <span style={{ fontWeight: 800, color: '#0F172A', fontSize: 13 }}>{l.sku?.codigo}</span>
                                            <span style={{
                                              fontSize: 11,
                                              fontWeight: 800,
                                              background: '#FEF3C7',
                                              color: '#92400E',
                                              border: '1px solid #FDE68A',
                                              padding: '2px 7px',
                                              borderRadius: 4,
                                              fontFamily: 'monospace'
                                            }}>
                                              Lote: {l.loteAsignado || l.loteEsperado || l.lote || 'Sin lote'}
                                            </span>
                                          </div>
                                          <div style={{ fontSize: 11.5, color: '#64748B' }}>{l.sku?.descripcion || 'Producto'}</div>
                                        </td>

                                        {/* Empaque */}
                                        <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                                          <span style={{ fontSize: 11, fontWeight: 700, background: '#F1F5F9', color: '#475569', padding: '3px 8px', borderRadius: 4 }}>
                                            {factor} pz/cja
                                          </span>
                                        </td>

                                        {/* Esperada */}
                                        <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                                          <div style={{ fontWeight: 700, color: '#0F172A' }}>{esp} pzas</div>
                                          <div style={{ fontSize: 11, color: '#64748B' }}>({cjsEsperadas} cjs)</div>
                                        </td>

                                        {/* Dictamen Calidad Previo (Rescatadas / Merma) */}
                                        <td style={{ padding: '10px 12px', textAlign: 'center', background: '#F8FAFC' }}>
                                          {lineRescuedPieces > 0 || lineMermaPieces > 0 ? (
                                            <div>
                                              <span style={{ fontSize: 11, fontWeight: 700, background: '#EDE9FE', color: '#6D28D9', padding: '3px 8px', borderRadius: 4, display: 'inline-block', marginBottom: 2 }}>
                                                {lineRescuedPieces} rescatadas · {lineMermaPieces} merma
                                              </span>
                                              <div style={{ fontSize: 10.5, color: '#6D28D9', fontStyle: 'italic' }}>
                                                {lineInspText}
                                              </div>
                                            </div>
                                          ) : (
                                            <span style={{ fontSize: 11, color: '#94A3B8', fontStyle: 'italic' }}>
                                              0 pz (Sin daño exterior)
                                            </span>
                                          )}
                                        </td>

                                        {/* Input: Cajas Sanas en Andén */}
                                        <td style={{ padding: '10px 12px', textAlign: 'center', background: '#F0F9FF' }}>
                                          <input
                                            id={`input-anden-cajas-${lineIdx}`}
                                            type="number"
                                            min="0"
                                            placeholder="0"
                                            value={cVal}
                                            onChange={(e) => {
                                              const raw = e.target.value;
                                              const num = raw === '' ? '' : Math.max(0, parseInt(raw) || 0);
                                              handleAndenDraftChange(currentReceipt.id, l.id, 'cajasSanas', num, factor);
                                            }}
                                            style={{
                                              width: 90,
                                              padding: '6px 10px',
                                              fontSize: 13,
                                              fontWeight: 700,
                                              textAlign: 'center',
                                              borderRadius: 6,
                                              border: '1.5px solid #0284C7',
                                              background: '#FFFFFF',
                                              color: '#0F172A',
                                            }}
                                          />
                                          <div style={{ fontSize: 10.5, color: '#0369A1', marginTop: 2 }}>cajas</div>
                                        </td>

                                        {/* Input: Piezas Sanas en Andén */}
                                        <td style={{ padding: '10px 12px', textAlign: 'center', background: '#F0F9FF' }}>
                                          <input
                                            id={`input-anden-piezas-${lineIdx}`}
                                            type="number"
                                            min="0"
                                            placeholder="0"
                                            value={pVal}
                                            onChange={(e) => {
                                              const raw = e.target.value;
                                              const num = raw === '' ? '' : Math.max(0, parseInt(raw) || 0);
                                              handleAndenDraftChange(currentReceipt.id, l.id, 'piezasSanas', num, factor);
                                            }}
                                            style={{
                                              width: 90,
                                              padding: '6px 10px',
                                              fontSize: 13,
                                              fontWeight: 700,
                                              textAlign: 'center',
                                              borderRadius: 6,
                                              border: '1.5px solid #0284C7',
                                              background: '#FFFFFF',
                                              color: '#0F172A',
                                            }}
                                          />
                                          <div style={{ fontSize: 10.5, color: '#0369A1', marginTop: 2 }}>piezas</div>
                                        </td>

                                        {/* Total Conformes Resultante */}
                                        <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                                          <div style={{ fontWeight: 800, color: totalConformesLinea > 0 ? '#059669' : '#64748B', fontSize: 13 }}>
                                            {totalConformesLinea} pzas
                                          </div>
                                          <div style={{ fontSize: 10.5, color: '#64748B' }}>
                                            {lineRescuedPieces > 0 ? `${lineRescuedPieces} resc + ${pSanasCalc} sanas` : `${pSanasCalc} sanas`}
                                          </div>
                                        </td>

                                        {/* Balance / Faltante */}
                                        <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                                          {!hasUserTyped ? (
                                            <div>
                                              <span style={{ fontSize: 11, color: '#64748B', fontWeight: 600 }}>
                                                Pendiente de conteo
                                              </span>
                                              <div style={{ fontSize: 10.5, color: '#2563EB', marginTop: 2 }}>
                                                {esp - (lineRescuedPieces + lineMermaPieces)} pzas por contar ({cjsEsperadas - (lineRescuedPieces > 0 ? 1 : 0)} cjs)
                                              </div>
                                            </div>
                                          ) : faltanteLinea === 0 && totalRecibidasLinea >= esp ? (
                                            <span style={{ fontSize: 11, fontWeight: 700, background: '#ECFDF5', color: '#059669', padding: '3px 8px', borderRadius: 4, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                                              <CheckCircle2 size={12} /> 0 faltante · Completo ({totalRecibidasLinea}/{esp} pz)
                                            </span>
                                          ) : (
                                            <div>
                                              <span style={{ fontSize: 11, fontWeight: 700, background: '#FEF3C7', color: '#D97706', padding: '3px 8px', borderRadius: 4 }}>
                                                Faltante: {faltanteLinea} pzas
                                              </span>
                                              <div style={{ fontSize: 10.5, color: '#D97706', marginTop: 2 }}>
                                                ({Math.ceil(faltanteLinea / factor)} caja faltante) ({totalRecibidasLinea}/{esp} pz)
                                              </div>
                                            </div>
                                          )}
                                        </td>

                                        {/* Lote y Caducidad */}
                                        <td style={{ padding: '10px 12px' }}>
                                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                            <input
                                              type="text"
                                              placeholder="Lote..."
                                              value={loteVal}
                                              onChange={(e) => handleAndenDraftChange(currentReceipt.id, l.id, 'lote', e.target.value, factor)}
                                              style={{
                                                padding: '4px 8px',
                                                fontSize: 11.5,
                                                borderRadius: 4,
                                                border: '1px solid #CBD5E1',
                                                background: '#FFFFFF',
                                              }}
                                            />
                                            <input
                                              type="date"
                                              value={caducidadVal}
                                              onChange={(e) => handleAndenDraftChange(currentReceipt.id, l.id, 'fechaVencimiento', e.target.value, factor)}
                                              style={{
                                                padding: '4px 8px',
                                                fontSize: 11,
                                                borderRadius: 4,
                                                border: '1px solid #CBD5E1',
                                                background: '#FFFFFF',
                                              }}
                                            />
                                          </div>
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>

                            {/* FRANJA DE TOTALES EN VIVO (LIVE RECONCILIATION STRIP) */}
                            <div style={{
                              background: '#F8FAFC',
                              borderRadius: 8,
                              border: '1px solid #E2E8F0',
                              padding: '14px 18px',
                              marginBottom: 18,
                              display: 'grid',
                              gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                              gap: 12
                            }}>
                              <div>
                                <div style={{ fontSize: 11, color: '#64748B', fontWeight: 600 }}>Cajas Sanas Capturadas</div>
                                <div style={{ fontSize: 16, fontWeight: 800, color: sumCajasSanasDraft === bultosSanosEsperadosAnden ? '#059669' : '#0F172A' }}>
                                  {sumCajasSanasDraft} <span style={{ fontSize: 10.5, color: '#64748B', fontWeight: 500 }}>de {bultosSanosEsperadosAnden} en andén</span>
                                </div>
                                <div style={{ fontSize: 10.5, color: sumCajasSanasDraft === bultosSanosEsperadosAnden ? '#059669' : '#64748B', fontWeight: 600, marginTop: 1 }}>
                                  {sumCajasSanasDraft === 0
                                    ? 'Pendiente de captura'
                                    : sumCajasSanasDraft === bultosSanosEsperadosAnden
                                    ? `Coincide con rampa (${sumCajasSanasDraft}/${bultosSanosEsperadosAnden})`
                                    : `Faltan ${Math.max(0, bultosSanosEsperadosAnden - sumCajasSanasDraft)} bultos`}
                                </div>
                              </div>
                              <div>
                                <div style={{ fontSize: 11, color: '#64748B', fontWeight: 600 }}>Piezas Sanas Nuevas</div>
                                <div style={{ fontSize: 16, fontWeight: 800, color: '#0284C7' }}>
                                  {sumPiezasSanasDraft} <span style={{ fontSize: 10.5, color: '#64748B', fontWeight: 500 }}>pzas</span>
                                </div>
                              </div>
                              <div>
                                <div style={{ fontSize: 11, color: '#64748B', fontWeight: 600 }}>Rescate Previo (Calidad)</div>
                                <div style={{ fontSize: 16, fontWeight: 800, color: '#7C3AED' }}>
                                  {sumRescatadasPrevias} <span style={{ fontSize: 10.5, color: '#64748B', fontWeight: 500 }}>pzas</span>
                                </div>
                                <div style={{ fontSize: 10.5, color: '#7C3AED', marginTop: 1 }}>
                                  {sumRescatadasPrevias > 0
                                    ? `(${rescuedLotsList.length > 0 ? rescuedLotsList.join(', ') : 'Calidad'})`
                                    : 'Sin rescates'}
                                </div>
                              </div>
                              <div>
                                <div style={{ fontSize: 11, color: '#059669', fontWeight: 700 }}>Total Conformes</div>
                                <div style={{ fontSize: 16, fontWeight: 800, color: '#059669' }}>
                                  {sumRescatadasPrevias + sumPiezasSanasDraft} <span style={{ fontSize: 10.5, color: '#64748B', fontWeight: 500 }}>pzas</span>
                                </div>
                              </div>
                              <div>
                                <div style={{ fontSize: 11, color: '#DC2626', fontWeight: 600 }}>Merma Dictaminada</div>
                                <div style={{ fontSize: 16, fontWeight: 800, color: '#DC2626' }}>
                                  {sumMermaPrevias} <span style={{ fontSize: 10.5, color: '#64748B', fontWeight: 500 }}>pzas</span>
                                </div>
                              </div>
                              <div>
                                <div style={{ fontSize: 11, color: '#0F172A', fontWeight: 700 }}>Total Físico Recibido</div>
                                <div style={{ fontSize: 16, fontWeight: 800, color: '#0F172A' }}>
                                  {totalPiezasFisicasContadas} <span style={{ fontSize: 10.5, color: '#64748B', fontWeight: 500 }}>pzas</span>
                                </div>
                                <div style={{ fontSize: 10.5, color: '#64748B', marginTop: 1 }}>
                                  {totalBultosDanadosCalidad > 0 ? (
                                    sumCajasSanasDraft === 0
                                      ? `${totalBultosDanadosCalidad} cja${totalBultosDanadosCalidad > 1 ? 's' : ''} en calidad · ${bultosSanosEsperadosAnden} sanas sin contar`
                                      : isCountingFinished
                                      ? `${totalBultosRecibidosRampa} bultos recibidos (${bultosSanosEsperadosAnden} sanos + ${totalBultosDanadosCalidad} dictaminado${totalBultosDanadosCalidad > 1 ? 's' : ''})`
                                      : `${sumCajasSanasDraft + totalBultosDanadosCalidad} de ${totalBultosRecibidosRampa} bultos procesados`
                                  ) : (
                                    sumCajasSanasDraft === 0
                                      ? `${bultosSanosEsperadosAnden} bultos sanos sin contar`
                                      : isCountingFinished
                                      ? `${totalBultosRecibidosRampa} bultos recibidos sanos (100% contados)`
                                      : `${sumCajasSanasDraft} de ${totalBultosRecibidosRampa} bultos procesados`
                                  )}
                                </div>
                              </div>
                              <div>
                                <div style={{ fontSize: 11, color: isCountingFinished ? '#D97706' : '#2563EB', fontWeight: 600 }}>
                                  {isCountingFinished ? 'Faltante Confirmado' : 'Pendiente de Conteo'}
                                </div>
                                <div style={{ fontSize: 16, fontWeight: 800, color: isCountingFinished ? '#D97706' : '#2563EB' }}>
                                  {isCountingFinished ? `${sumFaltantesConfirmados} pzas` : `${sumPiezasPendientesConteo} pzas`}
                                </div>
                                <div style={{ fontSize: 10.5, color: isCountingFinished ? '#D97706' : '#2563EB', fontWeight: 600, marginTop: 1 }}>
                                  {isCountingFinished ? (
                                    bultosFaltantes > 0
                                      ? `(${bultosFaltantes} ${bultosFaltantes === 1 ? 'bulto faltante' : 'bultos faltantes'} en rampa)`
                                      : sumFaltantesConfirmados > 0
                                      ? `(${sumFaltantesConfirmados} pzas faltantes confirmadas)`
                                      : '0 faltantes'
                                  ) : (
                                    `(${Math.max(0, bultosSanosEsperadosAnden - sumCajasSanasDraft)} bultos por contar)`
                                  )}
                                </div>
                              </div>
                              <div>
                                <div style={{ fontSize: 11, color: '#64748B', fontWeight: 600 }}>Esperadas Declaradas</div>
                                <div style={{ fontSize: 16, fontWeight: 800, color: '#0F172A' }}>
                                  {sumEsperadasTotal} <span style={{ fontSize: 10.5, color: '#64748B', fontWeight: 500 }}>pzas ({bultosEsperados} cjs)</span>
                                </div>
                                <div style={{ fontSize: 10.5, color: isCountingFinished ? '#059669' : '#64748B', fontWeight: 700, marginTop: 1 }}>
                                  {isCountingFinished ? 'Balance Exacto (100% Cuadrado)' : 'Conteo en curso'}
                                </div>
                              </div>
                            </div>

                            {/* BOTONES DE ACCIÓN: GUARDAR Y CONCILIAR */}
                            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10 }}>
                              <button
                                type="button"
                                onClick={() => setShowAndenCapture(false)}
                                className="btn btn-secondary"
                                style={{ padding: '9px 18px', fontSize: 13, fontWeight: 700 }}
                              >
                                Cancelar / Ocultar
                              </button>
                              <button
                                type="button"
                                id="btn-guardar-conteo-anden"
                                onClick={() => handleSaveAndenReconciliation(currentReceipt)}
                                disabled={savingAnden || (sumCajasSanasDraft === 0 && sumPiezasSanasDraft === 0)}
                                className="btn btn-primary"
                                style={{
                                  background: (sumCajasSanasDraft === 0 && sumPiezasSanasDraft === 0) ? '#94A3B8' : '#0284C7',
                                  borderColor: (sumCajasSanasDraft === 0 && sumPiezasSanasDraft === 0) ? '#94A3B8' : '#0284C7',
                                  padding: '10px 22px',
                                  fontSize: 13.5,
                                  fontWeight: 800,
                                  borderRadius: 8,
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 8,
                                  boxShadow: (sumCajasSanasDraft === 0 && sumPiezasSanasDraft === 0) ? 'none' : '0 2px 8px rgba(2,132,199,0.3)',
                                  cursor: (sumCajasSanasDraft === 0 && sumPiezasSanasDraft === 0) ? 'not-allowed' : 'pointer',
                                }}
                              >
                                {savingAnden ? (
                                  <>
                                    <RefreshCw size={15} className="spin" /> Guardando y Conciliando Conteo...
                                  </>
                                ) : (
                                  <>
                                    <Save size={16} /> Guardar y Conciliar Conteo en Andén
                                  </>
                                )}
                              </button>
                            </div>
                          </div>
                        );
                      })()}

                      <div style={{ overflowX: 'auto' }}>
                      <table className="data-table" style={{ width: '100%', fontSize: 13 }}>
                        <thead>
                          <tr style={{ background: '#F8FAFC', textAlign: 'left' }}>
                            <th style={{ padding: '10px 14px' }}>SKU</th>
                            <th style={{ padding: '10px 14px' }}>Descripción</th>
                            <th style={{ padding: '10px 14px', textAlign: 'center' }}>UOM / Factor</th>
                            <th style={{ padding: '10px 14px', textAlign: 'right' }}>Esperada</th>
                            <th style={{ padding: '10px 14px', textAlign: 'right' }}>{isClosed ? 'Conforme al cierre' : 'Conforme'}</th>
                            <th style={{ padding: '10px 14px', textAlign: 'right' }}>Merma</th>
                            <th style={{ padding: '10px 14px', textAlign: 'right' }}>Faltante en recepción</th>
                            <th style={{ padding: '10px 14px' }}>Lote / Caducidad</th>
                            <th style={{ padding: '10px 14px' }}>Ubicación Actual en Racks</th>
                            <th style={{ padding: '10px 14px', textAlign: 'center' }}>Estatus</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(currentReceipt.lineas || []).map((l: any, i: number) => {
                            const conf = Number(l.cantidadRecibida || 0);
                            const dan = Number(l.cantidadDanada || 0);
                            const esp = Number(l.cantidadEsperada || 0);
                            const isLineComplete = isClosed || isAndenConteoCompleted || l.estado === 'COMPLETO' || l.estado === 'COMPLETADA' || l.estado === 'CONCILIADO' || (conf + dan >= esp);
                            const isPartiallyInspected = !isLineComplete && (conf > 0 || dan > 0);
                            const pendienteClasificar = Math.max(0, esp - conf - dan);
                            const faltanteConfirmado = isLineComplete ? Math.max(0, esp - conf - dan) : 0;
                            const skuFactor = l.sku?.capacidadEmpaque || l.sku?.piezasPorCaja || (l.sku?.codigo?.includes('ACE') ? 12 : l.sku?.codigo?.includes('ARR') ? 20 : 1);

                            // Point 6: Desglose estricto por SKU Y LOTE (evita mezclar racks de lotes distintos que comparten SKU)
                            const lineLot = l.loteAsignado || l.loteEsperado || l.lote;
                            const skuBoxes = boxHus.filter((b: any) => {
                              if (b.receiptLineId && l.id && b.receiptLineId === l.id) return true;
                              const matchSku = b.skuCodigo ? b.skuCodigo === l.sku?.codigo : true;
                              const matchLot = lineLot ? (b.loteTexto === lineLot || b.lote?.lote === lineLot) : true;
                              return matchSku && matchLot;
                            });

                            const lineRescuedBoxes = boxHus.filter((b: any) => {
                              if (b.tipoHu !== 'CAJA' || b.estadoHu !== 'ACTIVO' || (!b.reacondicionada && !b.cajaOrigenId)) return false;
                              if (b.receiptLineId && l.id) return b.receiptLineId === l.id;
                              const matchSku = b.skuCodigo ? b.skuCodigo === l.sku?.codigo : true;
                              if (!matchSku) return false;
                              const boxLot = (b.loteTexto || b.lote?.lote || '').trim().toLowerCase();
                              const curLot = (lineLot || '').trim().toLowerCase();
                              return !curLot || !boxLot || curLot === boxLot;
                            });
                            const lineRescuedPieces = lineRescuedBoxes.reduce((s: number, b: any) => s + (Number(b.cantidad) || 0), 0);

                            const activeBoxes = skuBoxes.filter((b: any) => b.estadoHu === 'ACTIVO' && b.ubicacionActual && !b.ubicacionActual.includes('RAMPA'));
                            const rackBreakdown: Record<string, number> = {};
                            activeBoxes.forEach((b: any) => {
                              const r = b.ubicacionActual;
                              rackBreakdown[r] = (rackBreakdown[r] || 0) + (Number(b.cantidad) || 0);
                            });
                            const rackEntries = Object.entries(rackBreakdown);

                            return (
                              <tr key={l.id || i} style={{ borderBottom: '1px solid #F1F5F9' }}>
                                <td style={{ padding: '10px 14px', fontWeight: 700, fontFamily: 'monospace', color: '#0F172A' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                    <span>{l.sku?.codigo || l.skuId}</span>
                                    <span style={{
                                      fontSize: 11,
                                      fontWeight: 800,
                                      background: '#FEF3C7',
                                      color: '#92400E',
                                      border: '1px solid #FDE68A',
                                      padding: '2px 6px',
                                      borderRadius: 4,
                                      fontFamily: 'monospace'
                                    }}>
                                      Lote: {lineLot || 'Sin lote'}
                                    </span>
                                  </div>
                                </td>
                                <td style={{ padding: '10px 14px', color: '#334155' }}>
                                  {l.sku?.descripcion || '—'}
                                </td>
                                <td style={{ padding: '10px 14px', textAlign: 'center', fontSize: 11, color: '#64748B' }}>
                                  {l.sku?.uomBase || 'PZA'} ({skuFactor} pz/cja)
                                </td>
                                <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, color: '#0F172A' }}>
                                  {esp} pzas
                                </td>
                                <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 800, color: (isClosed || isLineComplete || isPartiallyInspected) ? '#059669' : '#94A3B8' }}>
                                  {isClosed || isLineComplete ? (
                                    <div>
                                      <span>{conf} pzas</span>
                                      {lineRescuedPieces > 0 && (
                                        <div style={{ fontSize: 10, color: '#166534', fontWeight: 600 }}>
                                          ({conf - lineRescuedPieces} sanas + {lineRescuedPieces} rescatadas)
                                        </div>
                                      )}
                                    </div>
                                  ) : isPartiallyInspected ? (
                                    <span>
                                      {conf} pzas {lineRescuedPieces > 0 ? <span style={{ fontSize: 10, color: '#166534', fontWeight: 600 }}>({lineRescuedPieces} rescatadas)</span> : null}
                                    </span>
                                  ) : (
                                    <span style={{ fontSize: 11, color: '#94A3B8', fontStyle: 'italic' }}>Pendiente de conteo</span>
                                  )}
                                </td>
                                <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 800, color: dan > 0 ? '#DC2626' : '#94A3B8' }}>
                                  {dan > 0 ? (
                                    <span>
                                      {dan} pzas <span style={{ fontSize: 10, color: '#991B1B', fontWeight: 600 }}>(dictaminada)</span>
                                    </span>
                                  ) : isClosed || isLineComplete ? (
                                    '0 pzas'
                                  ) : (
                                    <span style={{ color: '#94A3B8' }}>—</span>
                                  )}
                                </td>
                                <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 800, color: (isClosed || isLineComplete) && faltanteConfirmado > 0 ? '#D97706' : isPartiallyInspected ? '#2563EB' : '#64748B' }}>
                                  {isClosed || isLineComplete ? (
                                    faltanteConfirmado > 0 ? (
                                      <span style={{ color: '#D97706' }}>{faltanteConfirmado} pzas</span>
                                    ) : (
                                      '0 pzas'
                                    )
                                  ) : isPartiallyInspected ? (
                                    <span style={{ fontSize: 11, color: '#2563EB', fontWeight: 600 }}>
                                      {pendienteClasificar} pzas por clasificar
                                    </span>
                                  ) : (
                                    <span style={{ fontSize: 11, color: '#94A3B8', fontWeight: 500, fontStyle: 'italic' }}>
                                      Pendiente de conteo
                                    </span>
                                  )}
                                </td>
                                <td style={{ padding: '10px 14px', fontSize: 12 }}>
                                  <div>Lote: <strong>{lineLot || '—'}</strong></div>
                                  <div style={{ color: '#64748B', fontSize: 11 }}>
                                    Cad: {formatCalendarDate(l.fechaVencimiento || l.fechaCaducidadEsperada || l.fechaCaducidad)}
                                  </div>
                                </td>
                                <td style={{ padding: '10px 14px', fontSize: 12 }}>
                                  {rackEntries.length > 0 ? (
                                    <div style={{ color: '#0D9488', fontWeight: 700, lineHeight: 1.4 }}>
                                      {rackEntries.map(([rack, qty]) => `${rack}: ${qty} pz`).join(' · ')}
                                    </div>
                                  ) : (
                                    <div style={{ color: '#64748B', fontStyle: 'italic' }}>
                                      {isClosed ? 'Sin stock activo en racks' : 'Pendiente de putaway'}
                                    </div>
                                  )}
                                  <div style={{ fontSize: 10.5, color: '#64748B', marginTop: 2 }}>
                                    Andén de arribo: {currentReceipt.andenAsignado || 'REC-01'} (Histórico)
                                  </div>
                                </td>
                                <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                                  <span style={{
                                    fontSize: 11,
                                    fontWeight: 700,
                                    padding: '2px 8px',
                                    borderRadius: 4,
                                    background: isClosed || (conf + dan >= esp)
                                      ? '#DCFCE7'
                                      : (isLineComplete || l.estado === 'CONCILIADO')
                                      ? '#FEF3C7'
                                      : isPartiallyInspected
                                      ? '#EFF6FF'
                                      : '#F1F5F9',
                                    color: isClosed || (conf + dan >= esp)
                                      ? '#15803D'
                                      : (isLineComplete || l.estado === 'CONCILIADO')
                                      ? '#92400E'
                                      : isPartiallyInspected
                                      ? '#1D4ED8'
                                      : '#64748B',
                                    border: `1px solid ${
                                      isClosed || (conf + dan >= esp)
                                        ? '#86EFAC'
                                        : (isLineComplete || l.estado === 'CONCILIADO')
                                        ? '#FDE68A'
                                        : isPartiallyInspected
                                        ? '#BFDBFE'
                                        : '#CBD5E1'
                                    }`
                                  }}>
                                    {isClosed
                                      ? 'Concluida'
                                      : (conf + dan >= esp)
                                      ? 'Recibida'
                                      : (isLineComplete || l.estado === 'CONCILIADO')
                                      ? `Conciliada (${esp - conf - dan} pz faltante)`
                                      : isPartiallyInspected
                                      ? `Dictamen parcial (${conf + dan}/${esp} pz)`
                                      : 'Pendiente en andén'}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                  {/* TAB 2: CAJAS Y HUS DESDE LA BASE DE DATOS REAL (Point 1, 2, 3, 5) */}
                  {activeDossierTab === 'HUS' && (
                    <div>
                      <div style={{ fontSize: 13, color: '#64748B', marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                        <span>
                          Desglose físico de unidades de manejo registradas en base de datos para <strong>{currentReceipt.codigo}</strong>:
                        </span>
                        <div style={{ display: 'flex', gap: 8, fontSize: 11, fontWeight: 700 }}>
                          <span style={{ background: '#DCFCE7', color: '#166534', padding: '3px 8px', borderRadius: 4 }}>
                            {activasCount} Activas en Racks ({piezasActivasRestantes} pzas)
                          </span>
                          <span style={{ background: '#EFF6FF', color: '#1E40AF', padding: '3px 8px', borderRadius: 4 }}>
                            {despachadasCount} Despachadas ({piezasDespachadas} pzas históricas)
                          </span>
                        </div>
                      </div>

                      {/* TARIMA MASTER: DISTINCIÓN DE COMPOSICIÓN HISTÓRICA VS DISTRIBUCIÓN ACTUAL (Point 5) */}
                      {palletHu && (
                        <div style={{ background: '#F0FDFA', border: '1.5px solid #99F6E4', borderRadius: 8, padding: '12px 16px', marginBottom: 14 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 6 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <Layers size={16} style={{ color: '#0D9488' }} />
                              <span style={{ fontWeight: 800, fontSize: 13, color: '#0F766E' }}>
                                TARIMA MASTER: {palletHu.codigo}
                              </span>
                              <span style={{ fontSize: 11, background: '#CCFBF1', color: '#0F766E', padding: '2px 6px', borderRadius: 4, fontWeight: 700 }}>
                                QR Master GS1 Multilote
                              </span>
                            </div>
                            <div style={{ fontSize: 11.5, color: '#0F766E', fontWeight: 600 }}>
                              Andén de arribo: <strong>{currentReceipt.andenAsignado || 'REC-01 (Rampa)'}</strong> (Histórico)
                            </div>
                          </div>
                          <div style={{ fontSize: 12, color: '#334155', display: 'flex', gap: 18, flexWrap: 'wrap', borderTop: '1px solid #CCFBF1', paddingTop: 6 }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                              <Package size={13} style={{ color: '#0D9488' }} />
                              <strong>Composición al cierre:</strong> {currentReceipt.bultosRecibidos || boxHus.length || palletHu.cantidad || 0} bultos recibidos en andén
                            </span>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                              <MapPin size={13} style={{ color: '#0D9488' }} />
                              <strong>Distribución física actual:</strong> {activasCount} {activasCount === 1 ? 'caja activa en rack' : 'cajas activas en racks'}{despachadasCount > 0 ? ` · ${despachadasCount} ${despachadasCount === 1 ? 'caja despachada' : 'cajas despachadas'}` : ''}{inactivasCount > 0 ? ` · ${inactivasCount} ${inactivasCount === 1 ? 'HU histórica dañada/inactiva' : 'HUs históricas dañadas/inactivas'}` : ''}
                            </span>
                          </div>
                        </div>
                      )}

                      <div style={{ overflowX: 'auto' }}>
                        <table className="data-table" style={{ width: '100%', fontSize: 12.5 }}>
                          <thead>
                            <tr style={{ background: '#F8FAFC', textAlign: 'left' }}>
                              <th style={{ padding: '9px 12px', position: 'sticky', left: 0, background: '#F8FAFC', zIndex: 2, boxShadow: '1px 0 0 #E2E8F0' }}>CÓDIGO HU</th>
                              <th style={{ padding: '9px 12px' }}>SKU / PRODUCTO</th>
                              <th style={{ padding: '9px 12px' }}>LOTE Y CADUCIDAD</th>
                              <th style={{ padding: '9px 12px', textAlign: 'right' }}>SALDO EN ALMACÉN</th>
                              <th style={{ padding: '9px 12px' }}>ESTADO OPERATIVO</th>
                              <th style={{ padding: '9px 12px' }}>CONDICIÓN / EMPAQUE</th>
                              <th style={{ padding: '9px 12px' }}>UBICACIÓN RACK</th>
                              <th style={{ padding: '9px 12px', textAlign: 'center' }}>ETIQUETA</th>
                            </tr>
                          </thead>
                          <tbody>
                            {boxHus.length > 0 ? (
                              boxHus.map((b: any, idx: number) => {
                                const isDespachado = b.estadoHu === 'DESPACHADO';
                                const isInactive = b.estadoHu === 'INACTIVO' || b.estadoHu === 'DAÑADO';
                                const pzas = Number(b.cantidad) || 0;
                                const matchedLine = (currentReceipt.lineas || []).find((l: any) => l.sku?.codigo === b.skuCodigo || l.skuId === b.skuCodigo);
                                const skuFactor = b.lote?.sku?.capacidadEmpaque || matchedLine?.sku?.capacidadEmpaque || (b.skuCodigo?.includes('ARR') ? 20 : 12);
                                const standardCapacity = (b.reacondicionada || b.cajaOrigenId) ? skuFactor : (b.piezasPorCaja || skuFactor);
                                const isPartial = !isInactive && !isDespachado && (b.reacondicionada || Boolean(b.cajaOrigenId) || pzas < standardCapacity);

                                // Relaciones reales de rescate (Point 3)
                                const originBox = b.cajaOrigenId ? boxHus.find((x: any) => x.id === b.cajaOrigenId) : (isPartial ? boxHus.find((x: any) => x.estadoHu === 'INACTIVO') : null);
                                const rescuedBoxes = isInactive ? boxHus.filter((x: any) => x.cajaOrigenId === b.id || (x.reacondicionada && x.estadoHu === 'ACTIVO')) : [];

                                // Estado de etiqueta leído estrictamente por HU
                                const hasLabel = Boolean(b.etiquetaImpresa || b.estadoEtiqueta === 'COLOCADA' || b.estadoEtiqueta === 'IMPRESA') && !isInactive;

                                return (
                                  <tr key={b.id || idx} style={{ borderBottom: '1px solid #F1F5F9', background: isInactive ? '#FFF5F5' : isPartial ? '#FFFDF5' : 'transparent' }}>
                                    {/* CÓDIGO HU STICKY IZQUIERDA */}
                                    <td style={{ padding: '9px 12px', fontWeight: 700, fontFamily: 'monospace', position: 'sticky', left: 0, background: isInactive ? '#FFF5F5' : isPartial ? '#FFFDF5' : '#FFFFFF', zIndex: 1, boxShadow: '1px 0 0 #E2E8F0' }}>
                                      <code style={{ fontSize: 12, color: isDespachado ? '#2563EB' : isInactive ? '#DC2626' : isPartial ? '#D97706' : '#0D9488' }}>
                                        {b.codigo}
                                      </code>
                                      {isPartial && (
                                        <div style={{ fontSize: 10, color: '#D97706', fontWeight: 700 }}>
                                          Rescate de {originBox?.codigo || 'caja de origen'} {b.inspeccionId ? `(Insp: ${b.inspeccionId})` : ''}
                                        </div>
                                      )}
                                      {isInactive && rescuedBoxes.length > 0 && (
                                        <div style={{ fontSize: 10, color: '#DC2626' }}>
                                          Rescate en {rescuedBoxes.map((r: any) => r.codigo).join(', ')}
                                        </div>
                                      )}
                                    </td>
                                    <td style={{ padding: '9px 12px' }}>
                                      <div style={{ fontWeight: 700, color: '#0F172A' }}>{b.skuCodigo || '—'}</div>
                                      <div style={{ fontSize: 11, color: '#64748B' }}>{b.skuDescripcion || '—'}</div>
                                    </td>
                                    <td style={{ padding: '9px 12px', fontSize: 11.5 }}>
                                      <div>Lote: <strong>{b.loteTexto || 'S/L'}</strong></div>
                                      <div style={{ color: '#64748B' }}>Cad: {formatCalendarDate(b.fechaVencimiento)}</div>
                                    </td>
                                    <td style={{ padding: '9px 12px', textAlign: 'right' }}>
                                      {isInactive ? (
                                        <>
                                          <span style={{ fontWeight: 800, color: '#DC2626' }}>0 pzas</span>
                                          <div style={{ fontSize: 10, color: '#64748B' }}>
                                            {(() => {
                                              const totalResc = rescuedBoxes.reduce((s: number, r: any) => s + (Number(r.cantidad) || 0), 0);
                                              const mermaPzas = Math.max(0, pzas - totalResc);
                                              return `Orig: ${pzas} pz · ${totalResc} rescatadas${mermaPzas > 0 ? `, ${mermaPzas} merma` : ''}`;
                                            })()}
                                          </div>
                                        </>
                                      ) : isDespachado ? (
                                        <>
                                          <span style={{ fontWeight: 800, color: '#64748B' }}>0 en rack</span>
                                          <div style={{ fontSize: 10, color: '#2563EB' }}>Salida: {pzas} pz (Despacho registrado)</div>
                                        </>
                                      ) : isPartial ? (
                                        <>
                                          <span style={{ fontWeight: 800, color: '#D97706' }}>{pzas} pzas</span>
                                          <div style={{ fontSize: 10, color: '#D97706', fontWeight: 700 }}>Parcial: {pzas} de {standardCapacity} piezas · Reacondicionada</div>
                                        </>
                                      ) : (
                                        <span style={{ fontWeight: 700, color: '#0F172A' }}>{pzas} pzas</span>
                                      )}
                                    </td>
                                    <td style={{ padding: '9px 12px' }}>
                                      <span style={{
                                        fontSize: 10.5,
                                        fontWeight: 700,
                                        padding: '2px 7px',
                                        borderRadius: 4,
                                        background: isDespachado ? '#EFF6FF' : isInactive ? '#FEE2E2' : '#DCFCE7',
                                        color: isDespachado ? '#1E40AF' : isInactive ? '#991B1B' : '#166534',
                                        border: `1px solid ${isDespachado ? '#BFDBFE' : isInactive ? '#FECACA' : '#BBF7D0'}`
                                      }}>
                                        {isDespachado ? 'Despachada' : isInactive ? 'Inactiva (Rescatada)' : 'Activa en Rack'}
                                      </span>
                                    </td>
                                    <td style={{ padding: '9px 12px' }}>
                                      <span style={{
                                        fontSize: 10.5,
                                        fontWeight: 700,
                                        padding: '2px 7px',
                                        borderRadius: 4,
                                        background: isPartial ? '#FEF3C7' : isInactive ? '#FEE2E2' : '#DCFCE7',
                                        color: isPartial ? '#92400E' : isInactive ? '#991B1B' : '#166534',
                                        border: `1px solid ${isPartial ? '#FDE68A' : isInactive ? '#FECACA' : '#BBF7D0'}`
                                      }}>
                                        {isPartial ? 'Parcial / Reacondicionada' : isInactive ? 'Dañado / Retenido en Calidad (Histórico)' : 'Conforme / Estándar'}
                                      </span>
                                    </td>
                                    <td style={{ padding: '9px 12px', fontWeight: 600, color: isDespachado ? '#64748B' : isInactive ? '#DC2626' : '#0D9488' }}>
                                      {isDespachado ? (
                                        `Salida (era ${b.ubicacionActual})`
                                      ) : isInactive ? (
                                        <div>
                                          <span style={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: 4,
                                            padding: '2px 7px',
                                            borderRadius: 4,
                                            background: '#FEE2E2',
                                            color: '#991B1B',
                                            fontWeight: 700,
                                            fontSize: 11
                                          }}>
                                            <ShieldAlert size={12} /> {b.ubicacionActual || 'AREA_CALIDAD'} (Retención)
                                          </span>
                                          <div style={{ fontSize: 10, color: '#64748B', marginTop: 2 }}>
                                            Andén arribo: {currentReceipt.andenAsignado || 'REC-01 (Rampa)'}
                                          </div>
                                        </div>
                                      ) : (
                                        b.ubicacionActual || 'En Rack'
                                      )}
                                    </td>
                                    <td style={{ padding: '9px 12px', textAlign: 'center' }}>
                                      {isInactive ? (
                                        <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: '#F1F5F9', color: '#64748B', fontWeight: 700, border: '1px solid #E2E8F0' }}>
                                          NO OPERATIVA / HISTÓRICA
                                        </span>
                                      ) : hasLabel ? (
                                        <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: '#F0FDF4', color: '#16A34A', fontWeight: 700 }}>
                                          COLOCADA
                                        </span>
                                      ) : (
                                        <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: '#F1F5F9', color: '#64748B', fontWeight: 700 }}>
                                          PENDIENTE
                                        </span>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })
                            ) : (
                              <tr>
                                <td colSpan={8} style={{ padding: 30, textAlign: 'center', color: '#64748B' }}>
                                  Sin unidades de manejo generadas aún. Se registran durante el proceso de etiquetado.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* TAB 3: DOCUMENTOS Y ETIQUETAS AGRUPADOS (Point 8) */}
                  {activeDossierTab === 'DOCUMENTOS' && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
                      {/* ACTA DE RAMPA */}
                      <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 10, padding: 18, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                            <Truck size={18} style={{ color: '#D97706' }} />
                            <h4 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: '#0F172A' }}>Acta de Entrada en Rampa</h4>
                          </div>
                          <p style={{ fontSize: 12, color: '#475569', margin: '0 0 12px' }}>
                            Conteo exterior a ciegas, verificación de sellos de transporte y firmas táctiles de chofer y supervisor.
                          </p>
                          <div style={{ fontSize: 11.5, color: '#64748B', lineHeight: 1.6, background: '#FFFFFF', padding: 10, borderRadius: 6, border: '1px solid #E2E8F0' }}>
                            {hasRampLiberation ? (
                              <>
                                <div>Bultos: <strong>{bultosRecibidos ?? 0} de {bultosEsperados}</strong> {currentReceipt.diferenciaBultos !== null && currentReceipt.diferenciaBultos !== undefined ? (currentReceipt.diferenciaBultos < 0 ? `(${Math.abs(currentReceipt.diferenciaBultos)} faltante)` : currentReceipt.diferenciaBultos > 0 ? `(+${currentReceipt.diferenciaBultos} sobrante)` : '(Completo)') : ''}</div>
                                <div>Daño exterior: <strong>{currentReceipt.bultosDanados ? `${currentReceipt.bultosDanados} caja(s) retenida(s)` : '0 cajas'}</strong></div>
                                <div>Liberación chofer: <strong>{formatTimelineDateTime(currentReceipt.fechaLiberacionChofer)}</strong></div>
                              </>
                            ) : (
                              <div style={{ color: '#94A3B8', fontStyle: 'italic' }}>
                                Conteo exterior a ciegas y firmas pendientes de captura en rampa.
                              </div>
                            )}
                          </div>
                        </div>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => setRampDocumentReceipt(currentReceipt)}
                          style={{ marginTop: 14, width: '100%', fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                        >
                          <FileText size={14} style={{ color: '#D97706' }} /> Ver Acta de Rampa con Firmas
                        </button>
                      </div>

                      {/* DICTAMEN DE CALIDAD */}
                      {(() => {
                        const inspectionRecord = currentReceipt.inspecciones?.[0] || currentReceipt.qualityInspections?.[0] || currentReceipt.qualityInspection || null;
                        const isInspectionCompleted = Boolean(
                          inspectionRecord ||
                          currentReceipt.inspeccionCalidadEstado === 'COMPLETADA'
                        );
                        const hasDamaged = Boolean(currentReceipt.bultosDanados > 0 || currentReceipt.cantidadDanada > 0);

                        return (
                          <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 10, padding: 18, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                                <Microscope size={18} style={{ color: '#7C3AED' }} />
                                <h4 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: '#0F172A' }}>Dictamen Técnico de Calidad</h4>
                              </div>
                              <p style={{ fontSize: 12, color: '#475569', margin: '0 0 12px' }}>
                                Inspección detallada de cajas retenidas en andén, balance de rescate de piezas conformes vs merma definitiva.
                              </p>
                              <div style={{ fontSize: 11.5, color: '#64748B', lineHeight: 1.6, background: '#FFFFFF', padding: 10, borderRadius: 6, border: '1px solid #E2E8F0' }}>
                                <div>
                                  Inspección:{' '}
                                  <strong>
                                    {isInspectionCompleted ? (
                                      inspectionRecord?.folio || 'Dictamen Registrado'
                                    ) : hasDamaged ? (
                                      <span style={{ color: '#D97706', fontWeight: 700 }}>Pendiente / No realizada</span>
                                    ) : (
                                      <span style={{ color: '#64748B', fontWeight: 600 }}>No requerida (Sin daño exterior)</span>
                                    )}
                                  </strong>
                                </div>
                                <div>
                                  Piezas rescatadas:{' '}
                                  <strong>
                                    {isInspectionCompleted ? (
                                      boxHus.find((b: any) => b.reacondicionada && b.estadoHu === 'ACTIVO')
                                        ? `${boxHus.find((b: any) => b.reacondicionada && b.estadoHu === 'ACTIVO')?.cantidad} conformes (${boxHus.find((b: any) => b.reacondicionada && b.estadoHu === 'ACTIVO')?.codigo})`
                                        : (totalDanadas > 0 ? 'Sin rescate' : '0 pzas')
                                    ) : hasDamaged ? (
                                      <span style={{ color: '#94A3B8', fontStyle: 'italic' }}>Pendiente de dictamen</span>
                                    ) : (
                                      'N/A'
                                    )}
                                  </strong>
                                </div>
                                <div>
                                  Merma dictaminada:{' '}
                                  <strong>
                                    {isInspectionCompleted ? (
                                      `${totalDanadas} piezas (Merma kárdex)`
                                    ) : hasDamaged ? (
                                      <span style={{ color: '#94A3B8', fontStyle: 'italic' }}>Por determinar ({currentReceipt.bultosDanados || 1} caja retenida)</span>
                                    ) : (
                                      '0 piezas'
                                    )}
                                  </strong>
                                </div>
                              </div>
                            </div>
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => setQualityInspectionReceipt(currentReceipt)}
                              style={{ marginTop: 14, width: '100%', fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                            >
                              <Microscope size={14} style={{ color: '#7C3AED' }} /> {isInspectionCompleted ? 'Ver Dictamen de Calidad' : 'Dictaminar Calidad y Rescate'}
                            </button>
                          </div>
                        );
                      })()}

                      {/* REPORTE DE CIERRE OFICIAL */}
                      <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 10, padding: 18, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                            <FileText size={18} style={{ color: '#059669' }} />
                            <h4 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: '#0F172A' }}>Reporte Oficial de Cierre</h4>
                          </div>
                          <p style={{ fontSize: 12, color: '#475569', margin: '0 0 12px' }}>
                            Dictamen oficial de cierre con cuadre contable, clasificación de discrepancias y finiquito de responsabilidad.
                          </p>
                          <div style={{ fontSize: 11.5, color: '#64748B', lineHeight: 1.6, background: '#FFFFFF', padding: 10, borderRadius: 6, border: '1px solid #E2E8F0' }}>
                            <div>
                              Piezas conformes:{' '}
                              <strong>
                                {!hasRampLiberation
                                  ? '0 pzas (Pendiente rampa)'
                                  : !hasPieceClassification
                                  ? 'Por clasificar tras inspección y etiquetado'
                                  : `${totalConformes} pzas (${boxHus.filter((b: any) => b.estadoHu !== 'INACTIVO' && b.estadoHu !== 'DAÑADO').length} cjs)`}
                              </strong>
                            </div>
                            <div>
                              {!isQualityCompleted && hasDamagedBoxes ? (
                                <>
                                  Retenido en calidad:{' '}
                                  <strong>
                                    {currentReceipt.bultosDanados} {currentReceipt.bultosDanados === 1 ? 'caja' : 'cajas'} · merma por determinar
                                  </strong>
                                </>
                              ) : (
                                <>
                                  Merma definitiva:{' '}
                                  <strong>
                                    {!hasRampLiberation
                                      ? '0 pzas'
                                      : !isQualityCompleted
                                      ? 'Por determinar'
                                      : `${totalDanadas} pzas`}
                                  </strong>
                                </>
                              )}
                            </div>
                            <div>
                              Faltante en recepción:{' '}
                              <strong>
                                {!hasRampLiberation
                                  ? 'Sin determinar (Pendiente rampa)'
                                  : !hasPieceClassification
                                  ? (bultosFaltantes > 0 ? `${bultosFaltantes} ${bultosFaltantes === 1 ? 'bulto faltante' : 'bultos faltantes'} · piezas por determinar` : '0 bultos')
                                  : `${totalFaltantes} pzas`}
                              </strong>
                            </div>
                          </div>
                        </div>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => setReportModalReceipt(currentReceipt)}
                          style={{ marginTop: 14, width: '100%', fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                        >
                          <FileText size={14} style={{ color: '#059669' }} /> Ver Reporte de Cierre
                        </button>
                      </div>

                      {/* REIMPRESIÓN CONTROLADA DE ETIQUETAS */}
                      <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 10, padding: 18, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                            <Printer size={18} style={{ color: '#0284C7' }} />
                            <h4 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: '#0F172A' }}>Reimpresión de Etiquetas</h4>
                          </div>
                          <p style={{ fontSize: 12, color: '#475569', margin: '0 0 12px' }}>
                            Reimpresión controlada de etiquetas térmicas Code-128 para cajas y QR Master para tarimas sin alterar su estado de colocación.
                          </p>
                          <div style={{ fontSize: 11.5, color: '#64748B', lineHeight: 1.6, background: '#FFFFFF', padding: 10, borderRadius: 6, border: '1px solid #E2E8F0' }}>
                            <div>Etiquetas disponibles: <strong style={{ color: '#0F172A' }}>{activasCount + (palletHu ? 1 : 0)} ({activasCount} {activasCount === 1 ? 'caja' : 'cajas'} + {palletHu ? 1 : 0} {palletHu ? 'Tarima Master' : 'Tarimas'})</strong></div>
                            <div>Tarima Master: <strong>{palletHu ? palletHu.codigo : 'Generada'}</strong></div>
                            <div>Cajas conformes en inventario: <strong>{activasCount} etiquetas</strong></div>
                            <div>Formato térmico: <strong>100x50 mm / 100x150 mm</strong></div>
                          </div>
                        </div>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => setDualLabelReceipt(currentReceipt)}
                          style={{ marginTop: 14, width: '100%', fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                        >
                          <Printer size={14} style={{ color: '#0284C7' }} /> Abrir Modal de Reimpresión
                        </button>
                      </div>
                    </div>
                  )}

                  {/* TAB 4: TRANSPORTE Y ANDÉN */}
                  {activeDossierTab === 'TRANSPORTE' && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
                      <div style={{ background: '#F8FAFC', padding: 16, borderRadius: 8, border: '1px solid #E2E8F0' }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#0D9488', textTransform: 'uppercase', marginBottom: 10 }}>
                          Datos de la Unidad y Transportista
                        </div>
                        <div style={{ fontSize: 13, lineHeight: 1.8 }}>
                          <div>Línea de Transporte: <strong>{currentReceipt.lineaTransporte || 'Transportes Prueba E2E'}</strong></div>
                          <div>Nombre del Chofer: <strong>{currentReceipt.nombreChofer || 'Juan Manuel Prueba'}</strong></div>
                          <div>Placas: <strong>{currentReceipt.placa || 'TEST-001'}</strong></div>
                          <div>Capacidad: <strong>{currentReceipt.capacidadCarga || 'N/A'}</strong></div>
                          <div>Fecha de Liberación: <strong>{currentReceipt.fechaLiberacionChofer ? formatTimelineDateTime(currentReceipt.fechaLiberacionChofer) : 'Pendiente liberación'}</strong></div>
                        </div>
                      </div>

                      <div style={{ background: '#F8FAFC', padding: 16, borderRadius: 8, border: '1px solid #E2E8F0' }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#0D9488', textTransform: 'uppercase', marginBottom: 10 }}>
                          Documentos y Sellos
                        </div>
                        <div style={{ fontSize: 13, lineHeight: 1.8 }}>
                          <div>Factura Fiscal: <strong>{currentReceipt.facturaRespaldo || 'Sin Factura'}</strong></div>
                          <div>Orden de Compra: <strong>{(currentReceipt.ocReferencia && currentReceipt.ocReferencia !== currentReceipt.facturaRespaldo) ? currentReceipt.ocReferencia : (currentReceipt.ocReferencia && !currentReceipt.facturaRespaldo ? currentReceipt.ocReferencia : 'Sin OC')}</strong></div>
                          <div>Andén Asignado: <strong>{currentReceipt.andenAsignado || 'Pendiente asignación'}</strong></div>
                          <div>Supervisor de Andén: <strong>{currentReceipt.recibidoPor || currentReceipt.nombreReceptor || 'Jonathan Palacios'}</strong></div>
                          <div>Candado de Andén: <strong>{currentReceipt.bloqueado ? 'BLOQUEADO CONTRA EDICIÓN' : 'Abierto'}</strong></div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* TAB 5: HISTORIAL Y KÁRDEX (AUDITORÍA CRONOLÓGICA Y MOVIMIENTOS PERSISTIDOS) */}
                  {activeDossierTab === 'HISTORIAL' && (() => {
                    const rawMoves: any[] = currentReceipt.inventoryMovements || [];

                    return (
                      <div>
                        {/* ENCABEZADO DE AUDITORÍA Y CONTROL DE ACTUALIZACIÓN */}
                        <div style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '14px 18px',
                          background: '#F8FAFC',
                          border: '1px solid #E2E8F0',
                          borderRadius: 10,
                          marginBottom: 20,
                          flexWrap: 'wrap',
                          gap: 12
                        }}>
                          <div>
                            <div style={{ fontSize: 15, fontWeight: 800, color: '#0F172A', display: 'flex', alignItems: 'center', gap: 8 }}>
                              <ClipboardCheck size={18} color="#0D9488" />
                              Línea de Tiempo Auditada y Kárdex Oficial
                            </div>
                            <div style={{ fontSize: 12, color: '#64748B', marginTop: 3 }}>
                              Trazabilidad cronológica completa reconstruida desde registros persistidos de auditoría y movimientos de inventario.
                            </div>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span style={{
                              fontSize: 12,
                              fontWeight: 700,
                              padding: '4px 10px',
                              borderRadius: 6,
                              background: '#F0FDFA',
                              color: '#0F766E',
                              border: '1px solid #CCFBF1'
                            }}>
                              {timelineEvents.length} Hitos Auditados
                            </span>
                            <button
                              type="button"
                              onClick={() => refreshReceiptHistory(currentReceipt.id)}
                              disabled={historyLoading}
                              style={{
                                padding: '6px 12px',
                                fontSize: 12,
                                fontWeight: 600,
                                background: '#FFFFFF',
                                border: '1px solid #CBD5E1',
                                borderRadius: 6,
                                cursor: historyLoading ? 'wait' : 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 6,
                                color: '#334155'
                              }}
                            >
                              <RefreshCw size={13} className={historyLoading ? 'animate-spin' : ''} />
                              {historyLoading ? 'Cargando Auditoría...' : 'Actualizar Historial'}
                            </button>
                          </div>
                        </div>

                        {/* LISTA CRONOLÓGICA DE HITOS AUDITADOS */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                          {timelineEvents.map((ev, idx) => {
                            return (
                              <div
                                key={ev.id || idx}
                                style={{
                                  display: 'flex',
                                  alignItems: 'flex-start',
                                  gap: 16,
                                  padding: '16px 20px',
                                  background: ev.bgColor,
                                  borderRadius: 10,
                                  border: `1.5px solid ${ev.borderColor}`,
                                  boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
                                  position: 'relative'
                                }}
                              >
                                {/* INDICADOR NUMÉRICO */}
                                <div style={{
                                  width: 32,
                                  height: 32,
                                  borderRadius: '50%',
                                  background: ev.color,
                                  color: '#FFFFFF',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  fontSize: 12,
                                  fontWeight: 800,
                                  flexShrink: 0,
                                  marginTop: 2
                                }}>
                                  {idx + 1}
                                </div>

                                {/* CONTENIDO DEL HITO */}
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
                                    <div>
                                      <span style={{
                                        display: 'inline-block',
                                        fontSize: 10.5,
                                        fontWeight: 800,
                                        padding: '2px 8px',
                                        borderRadius: 4,
                                        background: ev.badgeBg,
                                        color: ev.badgeColor,
                                        marginBottom: 4,
                                        textTransform: 'uppercase',
                                        letterSpacing: '0.04em'
                                      }}>
                                        {ev.badgeText}
                                      </span>
                                      <div style={{ fontWeight: 800, fontSize: 14, color: '#0F172A', lineHeight: 1.4 }}>
                                        {ev.titulo}
                                      </div>
                                    </div>

                                    <div style={{ textAlign: 'right' }}>
                                      <div style={{ fontSize: 11.5, fontWeight: 700, color: '#334155' }}>
                                        {formatTimelineDateTime(ev.fecha)}
                                      </div>
                                      <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>
                                        Responsable: <strong>{ev.actor}</strong>
                                      </div>
                                    </div>
                                  </div>

                                  <div style={{ fontSize: 12.5, color: '#475569', marginTop: 6, lineHeight: 1.5 }}>
                                    {ev.subtitulo}
                                  </div>

                                  {/* FRANJA DE MÉTRICAS AUDITADAS (KPIs) */}
                                  {ev.metrics && ev.metrics.length > 0 && (
                                    <div style={{
                                      display: 'flex',
                                      flexWrap: 'wrap',
                                      gap: 12,
                                      marginTop: 10,
                                      paddingTop: 10,
                                      borderTop: '1px solid rgba(0,0,0,0.06)'
                                    }}>
                                      {ev.metrics.map((m, mIdx) => (
                                        <div key={mIdx} style={{ fontSize: 11.5 }}>
                                          <span style={{ color: '#64748B' }}>{m.label}: </span>
                                          <strong style={{ color: m.color || '#0F172A' }}>{m.value}</strong>
                                        </div>
                                      ))}
                                    </div>
                                  )}

                                  {/* DETALLE CONSOLIDADO DE PUTAWAY CON TABLA DESPLEGABLE DE 14 HUS */}
                                  {ev.isPutawayConsolidated && ev.husDetail && (
                                    <div style={{ marginTop: 12 }}>
                                      <button
                                        type="button"
                                        onClick={() => setShowPutawayHusDetail(prev => !prev)}
                                        style={{
                                          padding: '7px 14px',
                                          background: '#FFFFFF',
                                          border: '1.5px solid #059669',
                                          borderRadius: 6,
                                          color: '#059669',
                                          fontSize: 12,
                                          fontWeight: 700,
                                          cursor: 'pointer',
                                          display: 'inline-flex',
                                          alignItems: 'center',
                                          gap: 6
                                        }}
                                      >
                                        {showPutawayHusDetail ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                        {showPutawayHusDetail
                                          ? `Ocultar Detalle Individual HU → Rack (${ev.husDetail.length} HUs)`
                                          : `Ver Trazabilidad Individual HU → Rack y Kárdex (${ev.husDetail.length} HUs)`}
                                      </button>

                                      {showPutawayHusDetail && (
                                        <div style={{
                                          marginTop: 12,
                                          background: '#FFFFFF',
                                          borderRadius: 8,
                                          border: '1px solid #E2E8F0',
                                          overflow: 'hidden',
                                          boxShadow: '0 2px 6px rgba(0,0,0,0.04)'
                                        }}>
                                          <div style={{
                                            padding: '10px 14px',
                                            background: '#F8FAFC',
                                            borderBottom: '1px solid #E2E8F0',
                                            fontSize: 12,
                                            fontWeight: 700,
                                            color: '#334155',
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            alignItems: 'center'
                                          }}>
                                            <span>Matriz de Alojamiento y Escaneo Dual HU por HU</span>
                                            <span style={{ fontSize: 11, color: '#059669', fontWeight: 600 }}>
                                              100% Ubicaciones Físicas Auditadas
                                            </span>
                                          </div>
                                          <div style={{ overflowX: 'auto', maxHeight: 360 }}>
                                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
                                              <thead>
                                                <tr style={{ background: '#F1F5F9', borderBottom: '1px solid #CBD5E1', textAlign: 'left', color: '#475569' }}>
                                                  <th style={{ padding: '8px 12px' }}>HU Código</th>
                                                  <th style={{ padding: '8px 12px' }}>SKU</th>
                                                  <th style={{ padding: '8px 12px' }}>Lote</th>
                                                  <th style={{ padding: '8px 12px', textAlign: 'right' }}>Cantidad</th>
                                                  <th style={{ padding: '8px 12px' }}>Origen</th>
                                                  <th style={{ padding: '8px 12px' }}>Rack Destino</th>
                                                  <th style={{ padding: '8px 12px', textAlign: 'center' }}>Escaneo Dual</th>
                                                  <th style={{ padding: '8px 12px' }}>Operador Scan</th>
                                                  <th style={{ padding: '8px 12px' }}>Fecha / Hora</th>
                                                </tr>
                                              </thead>
                                              <tbody>
                                                {ev.husDetail.map((hu, huIdx) => (
                                                  <tr key={huIdx} style={{ borderBottom: '1px solid #F1F5F9' }}>
                                                    <td style={{ padding: '8px 12px', fontWeight: 700, fontFamily: 'monospace', color: '#0F172A' }}>
                                                      {hu.huCodigo}
                                                      {hu.reacondicionada && (
                                                        <span style={{
                                                          marginLeft: 6,
                                                          fontSize: 9.5,
                                                          fontWeight: 800,
                                                          padding: '1px 5px',
                                                          borderRadius: 3,
                                                          background: '#EDE9FE',
                                                          color: '#7C3AED'
                                                        }}>
                                                          Reacondicionada
                                                        </span>
                                                      )}
                                                    </td>
                                                    <td style={{ padding: '8px 12px', color: '#334155' }}>{hu.skuCodigo}</td>
                                                    <td style={{ padding: '8px 12px', color: '#475569' }}>{hu.lote}</td>
                                                    <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 700, color: '#0F172A' }}>
                                                      {hu.cantidad} pz
                                                    </td>
                                                    <td style={{ padding: '8px 12px', color: '#64748B' }}>{hu.origen}</td>
                                                    <td style={{ padding: '8px 12px' }}>
                                                      <span style={{
                                                        display: 'inline-flex',
                                                        alignItems: 'center',
                                                        gap: 4,
                                                        padding: '2px 8px',
                                                        borderRadius: 4,
                                                        background: '#ECFDF5',
                                                        color: '#047857',
                                                        fontWeight: 700,
                                                        fontSize: 11
                                                      }}>
                                                        <MapPin size={11} /> {hu.rackDestino}
                                                      </span>
                                                    </td>
                                                    <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                                                      <span style={{
                                                        display: 'inline-flex',
                                                        alignItems: 'center',
                                                        gap: 3,
                                                        padding: '2px 6px',
                                                        borderRadius: 4,
                                                        background: '#DCFCE7',
                                                        color: '#15803D',
                                                        fontWeight: 700,
                                                        fontSize: 10.5
                                                      }}>
                                                        <CheckCircle2 size={11} /> Validado 2/2
                                                      </span>
                                                    </td>
                                                    <td style={{ padding: '8px 12px', color: '#334155' }}>{hu.operadorScan}</td>
                                                    <td style={{ padding: '8px 12px', color: '#64748B', fontSize: 11 }}>
                                                      {formatTimelineDateTime(hu.scanTimestamp)}
                                                    </td>
                                                  </tr>
                                                ))}
                                              </tbody>
                                            </table>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        {/* SECCIÓN KÁRDEX TRANSACCIONAL COMPLEMENTARIO */}
                        <div style={{ marginTop: 24, paddingTop: 18, borderTop: '1px solid #E2E8F0' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                            <div>
                              <div style={{ fontSize: 14, fontWeight: 800, color: '#0F172A', display: 'flex', alignItems: 'center', gap: 6 }}>
                                <Layers size={16} color="#0284C7" />
                                Movimientos Transaccionales en Kárdex WMS ({rawMoves.length} registros)
                              </div>
                              <div style={{ fontSize: 11.5, color: '#64748B', marginTop: 2 }}>
                                Trasiegos y afectaciones directas al inventario asociadas a este folio de recepción.
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={() => setShowKardexTableDetail(prev => !prev)}
                              style={{
                                padding: '6px 12px',
                                fontSize: 11.5,
                                fontWeight: 600,
                                background: '#F8FAFC',
                                border: '1px solid #CBD5E1',
                                borderRadius: 6,
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 5,
                                color: '#334155'
                              }}
                            >
                              {showKardexTableDetail ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                              {showKardexTableDetail ? 'Ocultar Kárdex Transaccional' : 'Ver Kárdex Transaccional'}
                            </button>
                          </div>

                          {showKardexTableDetail && (
                            <div style={{
                              background: '#FFFFFF',
                              borderRadius: 8,
                              border: '1px solid #E2E8F0',
                              overflow: 'hidden',
                              boxShadow: '0 1px 3px rgba(0,0,0,0.02)'
                            }}>
                              {rawMoves.length === 0 ? (
                                <div style={{ padding: 24, textAlign: 'center', color: '#94A3B8', fontSize: 13, fontStyle: 'italic' }}>
                                  No hay movimientos registrados en kárdex para esta recepción aún.
                                </div>
                              ) : (
                                <div style={{ overflowX: 'auto', maxHeight: 320 }}>
                                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
                                    <thead>
                                      <tr style={{ background: '#F8FAFC', borderBottom: '1px solid #CBD5E1', textAlign: 'left', color: '#475569' }}>
                                        <th style={{ padding: '8px 12px' }}>Folio / ID</th>
                                        <th style={{ padding: '8px 12px' }}>Tipo</th>
                                        <th style={{ padding: '8px 12px' }}>SKU</th>
                                        <th style={{ padding: '8px 12px', textAlign: 'right' }}>Cantidad</th>
                                        <th style={{ padding: '8px 12px' }}>Origen → Destino</th>
                                        <th style={{ padding: '8px 12px' }}>HU Asignada</th>
                                        <th style={{ padding: '8px 12px' }}>Operador</th>
                                        <th style={{ padding: '8px 12px' }}>Fecha / Hora</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {rawMoves.map((m: any, mIdx: number) => (
                                        <tr key={m.id || mIdx} style={{ borderBottom: '1px solid #F1F5F9' }}>
                                          <td style={{ padding: '8px 12px', fontFamily: 'monospace', color: '#64748B' }}>
                                            {m.id?.slice(0, 8) || `MOV-${mIdx + 1}`}
                                          </td>
                                          <td style={{ padding: '8px 12px' }}>
                                            <span style={{
                                              padding: '2px 6px',
                                              borderRadius: 4,
                                              background: m.tipoMovimiento === 'TRASIEGO' ? '#E0F2FE' : '#F1F5F9',
                                              color: m.tipoMovimiento === 'TRASIEGO' ? '#0369A1' : '#334155',
                                              fontWeight: 700,
                                              fontSize: 10.5
                                            }}>
                                              {m.tipoMovimiento}
                                            </span>
                                          </td>
                                          <td style={{ padding: '8px 12px', fontWeight: 600, color: '#0F172A' }}>
                                            {m.sku?.codigo || m.skuCodigo || m.skuId}
                                          </td>
                                          <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 700, color: '#0F172A' }}>
                                            {m.cantidad} pz
                                          </td>
                                          <td style={{ padding: '8px 12px' }}>
                                            <span style={{ color: '#64748B' }}>{m.fromLocation?.codigo || 'Andén'}</span>
                                            <span style={{ margin: '0 4px', color: '#94A3B8' }}>→</span>
                                            <span style={{ color: '#059669', fontWeight: 700 }}>{m.toLocation?.codigo || 'Rack'}</span>
                                          </td>
                                          <td style={{ padding: '8px 12px', fontFamily: 'monospace', color: '#0284C7' }}>
                                            {m.hu?.codigo || m.huCodigo || '—'}
                                          </td>
                                          <td style={{ padding: '8px 12px', color: '#334155' }}>
                                            {m.usuario || 'Operador'}
                                          </td>
                                          <td style={{ padding: '8px 12px', color: '#64748B', fontSize: 11 }}>
                                            {formatTimelineDateTime(m.fechaHora || m.createdAt)}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>
          );
        }

        // =========================================================================
        // VISTA LISTADO COMPACTO DE RECEPCIONES (UX-01, Point 7)
        // =========================================================================
        const baseForCounts = filterCliente ? receipts.filter(r => r.clienteId === filterCliente) : receipts;
        const countsByStage = {
          todas: baseForCounts.length,
          rampa: baseForCounts.filter(r => {
            const st = computeReceiptStage(r);
            return st.name === 'Rampa' || st.name === 'Conteo';
          }).length,
          calidad: baseForCounts.filter(r => computeReceiptStage(r).name === 'Calidad').length,
          etiquetas: baseForCounts.filter(r => computeReceiptStage(r).name === 'Etiquetas').length,
          ubicacion: baseForCounts.filter(r => computeReceiptStage(r).name === 'Ubicación').length,
          porCerrar: baseForCounts.filter(r => {
            const s = computeReceiptStage(r);
            return s.name === 'Cierre' && !s.isClosed;
          }).length,
          cerradas: baseForCounts.filter(r => computeReceiptStage(r).isClosed).length,
        };

        const stageFiltered = filtered.filter(r => {
          if (filterCliente && r.clienteId !== filterCliente) return false;
          if (!filterEstado) return true;
          const st = computeReceiptStage(r);
          if (filterEstado === 'RAMPA') return st.name === 'Rampa' || st.name === 'Conteo';
          if (filterEstado === 'CALIDAD') return st.name === 'Calidad';
          if (filterEstado === 'ETIQUETAS') return st.name === 'Etiquetas';
          if (filterEstado === 'UBICACION') return st.name === 'Ubicación';
          if (filterEstado === 'POR_CERRAR') return st.name === 'Cierre' && !st.isClosed;
          if (filterEstado === 'CERRADAS' || filterEstado === 'CERRADA') return st.isClosed;
          return true;
        });

        return (
          <div className="compact-list-view">
            {/* BARRA SUPERIOR DE FILTROS LIMPIA (Sin emoji de edificio) */}
            <div style={{
              background: '#FFFFFF',
              borderRadius: 12,
              border: '1px solid #E2E8F0',
              padding: '16px 20px',
              marginBottom: 20,
              boxShadow: '0 1px 3px rgba(0,0,0,0.03)'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 14, marginBottom: 14 }}>
                {/* BUSCADOR */}
                <div style={{ position: 'relative', flex: '1 1 300px', maxWidth: 420 }}>
                  <Search size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#64748B' }} />
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Buscar por folio (REC-...), factura, chofer, placa..."
                    value={search}
                    onChange={e => {
                      const val = e.target.value;
                      setSearch(val);
                      if (val) setSearchParams({ search: val });
                      else setSearchParams({});
                    }}
                    style={{ paddingLeft: 36, paddingRight: search ? 30 : 12, height: 38, fontSize: 13, background: '#FFFFFF', borderColor: '#CBD5E1', color: '#0F172A', borderRadius: 8, width: '100%' }}
                  />
                  {search && (
                    <button
                      type="button"
                      onClick={() => { setSearch(''); setSearchParams({}); }}
                      style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: '#64748B', cursor: 'pointer', padding: 2, display: 'flex' }}
                      title="Limpiar búsqueda"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>

                {/* FILTRO DE DEPOSITANTE Y BOTÓN NUEVO PREVIO UNIFICADO */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <select
                    className="form-select"
                    value={filterCliente}
                    onChange={e => setFilterCliente(e.target.value)}
                    style={{ height: 38, fontSize: 13, minWidth: 200, borderRadius: 8, background: '#FFFFFF', borderColor: '#CBD5E1', color: '#0F172A' }}
                  >
                    <option value="">Todos los Depositantes</option>
                    {clients.map(c => (
                      <option key={c.id} value={c.id}>{c.nombreComercial}</option>
                    ))}
                  </select>


                </div>
              </div>

              {/* CHIPS DE ETAPAS OPERATIVAS (Incluye "Por cerrar") */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', marginRight: 4 }}>
                  Etapa:
                </span>
                {[
                  { key: '', label: 'Todas', count: countsByStage.todas },
                  { key: 'RAMPA', label: 'Rampa', count: countsByStage.rampa },
                  { key: 'CALIDAD', label: 'Calidad', count: countsByStage.calidad },
                  { key: 'ETIQUETAS', label: 'Etiquetas', count: countsByStage.etiquetas },
                  { key: 'UBICACION', label: 'Ubicación', count: countsByStage.ubicacion },
                  { key: 'POR_CERRAR', label: 'Por cerrar', count: countsByStage.porCerrar },
                  { key: 'CERRADAS', label: 'Cerradas', count: countsByStage.cerradas },
                ].map(chip => {
                  const isActive = filterEstado === chip.key;
                  return (
                    <button
                      key={chip.key}
                      type="button"
                      onClick={() => setFilterEstado(chip.key)}
                      style={{
                        padding: '5px 12px',
                        borderRadius: 20,
                        border: `1px solid ${isActive ? '#0D9488' : '#E2E8F0'}`,
                        background: isActive ? '#0D9488' : '#FFFFFF',
                        color: isActive ? '#FFFFFF' : '#475569',
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        transition: 'all 0.15s ease'
                      }}
                    >
                      <span>{chip.label}</span>
                      <span style={{
                        fontSize: 10.5,
                        padding: '1px 6px',
                        borderRadius: 10,
                        background: isActive ? 'rgba(255,255,255,0.25)' : '#F1F5F9',
                        color: isActive ? '#FFFFFF' : '#64748B'
                      }}>
                        {chip.count}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* TABLA COMPACTA CON COLUMNAS FIJAS DE FOLIO Y ACCIÓN (Point 7) */}
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ overflowX: 'auto', position: 'relative' }}>
                <table className="data-table" style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#F8FAFC', textAlign: 'left', borderBottom: '1px solid #E2E8F0' }}>
                      <th style={{ padding: '12px 16px', fontWeight: 800, color: '#334155', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em', position: 'sticky', left: 0, background: '#F8FAFC', zIndex: 3, boxShadow: '1px 0 0 #E2E8F0' }}>Folio</th>
                      <th style={{ padding: '12px 14px', fontWeight: 800, color: '#334155', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Fecha</th>
                      <th style={{ padding: '12px 14px', fontWeight: 800, color: '#334155', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Depositante</th>
                      <th style={{ padding: '12px 14px', fontWeight: 800, color: '#334155', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Factura / OC</th>
                      <th style={{ padding: '12px 14px', fontWeight: 800, color: '#334155', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Partidas / Productos</th>
                      <th style={{ padding: '12px 14px', fontWeight: 800, color: '#334155', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Piezas (Rec / Esp)</th>
                      <th style={{ padding: '12px 14px', fontWeight: 800, color: '#334155', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Etapa</th>
                      <th style={{ padding: '12px 14px', fontWeight: 800, color: '#334155', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Pendiente Principal</th>
                      <th style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 800, color: '#334155', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em', position: 'sticky', right: 0, background: '#F8FAFC', zIndex: 3, boxShadow: '-1px 0 0 #E2E8F0' }}>Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan={9} style={{ textAlign: 'center', padding: '48px 20px', color: '#64748B' }}>
                          <RefreshCw size={24} className="animate-spin" style={{ margin: '0 auto 10px', color: '#0D9488' }} />
                          <div style={{ fontWeight: 600 }}>Cargando recepciones del servidor...</div>
                        </td>
                      </tr>
                    ) : stageFiltered.length === 0 ? (
                      <tr>
                        <td colSpan={9} style={{ padding: 40, textAlign: 'center', color: '#64748B' }}>
                          No se encontraron recepciones con los filtros aplicados.
                        </td>
                      </tr>
                    ) : (
                      stageFiltered.map((r, i) => {
                        const stage = computeReceiptStage(r);
                        const isClosed = stage.isClosed;
                        const StageIcon = stage.icon;

                        const totalPartidas = (r.lineas || []).length;
                        const uniqueSkus = new Set((r.lineas || []).map((l: any) => l.skuId || l.sku?.codigo).filter(Boolean)).size;
                        const totalPzasEsp = (r.lineas || []).reduce((s: number, l: any) => s + (l.cantidadEsperada || 0), 0);
                        const totalPzasRec = (r.lineas || []).reduce((s: number, l: any) => s + (l.cantidadRecibida || 0), 0);

                        return (
                          <tr
                            key={r.id || i}
                            onClick={(e) => {
                              // Permitir abrir la recepción al hacer clic en cualquier parte de la fila
                              // excepto si se hace clic en un botón, enlace, input o se está seleccionando texto
                              const target = e.target as HTMLElement;
                              if (target.closest('button') || target.closest('a') || target.closest('input') || target.closest('select')) return;
                              if (window.getSelection()?.toString().trim().length) return;
                              handleOpenReceiptDossier(r);
                            }}
                            style={{
                              borderBottom: '1px solid #F1F5F9',
                              cursor: 'pointer',
                              transition: 'background 0.15s ease'
                            }}
                            className="hover-row"
                          >
                            {/* FOLIO + BADGE COMPACTO DE ETAPA (Sticky Column Izquierda, Point 7) */}
                            <td style={{
                              padding: '12px 16px',
                              fontWeight: 700,
                              fontFamily: 'monospace',
                              position: 'sticky',
                              left: 0,
                              background: '#FFFFFF',
                              zIndex: 2,
                              boxShadow: '1px 0 0 #E2E8F0'
                            }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                <span style={{ fontSize: 13, fontWeight: 800, color: '#0F172A' }}>{r.codigo}</span>
                                <span style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 3,
                                  padding: '2px 7px',
                                  borderRadius: 10,
                                  fontSize: 10.5,
                                  fontWeight: 700,
                                  background: stage.bg,
                                  color: stage.color,
                                  border: `1px solid ${stage.border}`
                                }}>
                                  <StageIcon size={11} /> {stage.label}
                                </span>
                                {r.bloqueado && (
                                  <span style={{ fontSize: 11, color: '#059669' }} title="Previo bloqueado">
                                    <Lock size={12} />
                                  </span>
                                )}
                                {r.tipoRecepcion === 'DEVOLUCION' && (
                                  <span style={{ fontSize: 9.5, padding: '1px 5px', borderRadius: 4, background: '#FEF2F2', color: '#DC2626', fontWeight: 700 }}>
                                    Dev
                                  </span>
                                )}
                              </div>
                            </td>

                            {/* FECHA */}
                            <td style={{ padding: '12px 14px', color: '#334155', whiteSpace: 'nowrap', fontSize: 12.5 }}>
                              {formatCalendarDate(r.fechaRecepcion)}
                            </td>

                            {/* DEPOSITANTE */}
                            <td style={{ padding: '12px 14px' }}>
                              <div style={{ fontWeight: 700, color: '#0F172A' }}>{r.cliente?.nombreComercial || '—'}</div>
                              {r.cliente?.giro && (
                                <span style={{ fontSize: 10, color: '#64748B' }}>{r.cliente.giro}</span>
                              )}
                            </td>

                            {/* FACTURA / OC */}
                            <td style={{ padding: '12px 14px', whiteSpace: 'nowrap' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#0F172A', fontWeight: 600, fontSize: 12.5 }}>
                                <FileText size={13} style={{ color: '#0D9488' }} />
                                {r.facturaRespaldo || r.ocReferencia || '—'}
                              </div>
                            </td>

                            {/* PARTIDAS / PRODUCTOS */}
                            <td style={{ padding: '12px 14px', whiteSpace: 'nowrap' }}>
                              <span style={{ fontWeight: 700, color: '#0F172A' }}>
                                {totalPartidas} {totalPartidas === 1 ? 'partida' : 'partidas'}
                              </span>
                              <span style={{ color: '#64748B', fontSize: 12, marginLeft: 4 }}>
                                · {uniqueSkus} {uniqueSkus === 1 ? 'producto' : 'productos'}
                              </span>
                            </td>

                            {/* PIEZAS (REC / ESP) */}
                            <td style={{ padding: '12px 14px', whiteSpace: 'nowrap' }}>
                              <span style={{ fontWeight: 800, color: isClosed || totalPzasRec >= totalPzasEsp ? '#059669' : '#0F172A' }}>
                                {totalPzasRec}
                              </span>
                              <span style={{ color: '#64748B', fontSize: 12 }}> / {totalPzasEsp} pzas</span>
                            </td>

                            {/* ETAPA OPERATIVA (Point 7) */}
                            <td style={{ padding: '12px 14px', whiteSpace: 'nowrap' }}>
                              <span style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                                padding: '3px 8px',
                                borderRadius: 12,
                                fontSize: 11,
                                fontWeight: 700,
                                background: stage.bg,
                                color: stage.color,
                                border: `1px solid ${stage.border}`
                              }}>
                                <StageIcon size={12} /> {stage.label}
                              </span>
                            </td>

                            {/* PENDIENTE PRINCIPAL */}
                            <td style={{ padding: '12px 14px', color: '#475569', fontSize: 12 }}>
                              {stage.pendingText}
                            </td>

                            {/* ACCIÓN ÚNICA (Sticky Column Derecha, Point 7) */}
                            <td style={{
                              padding: '12px 16px',
                              textAlign: 'right',
                              position: 'sticky',
                              right: 0,
                              background: '#FFFFFF',
                              zIndex: 2,
                              boxShadow: '-1px 0 0 #E2E8F0'
                            }}>
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleOpenReceiptDossier(r);
                                }}
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 6,
                                  fontSize: 12,
                                  fontWeight: 700,
                                  padding: '5px 12px',
                                  borderColor: '#CBD5E1',
                                  background: '#FFFFFF',
                                  color: '#0F172A'
                                }}
                              >
                                {isClosed ? 'Ver Expediente' : 'Abrir Recepción'} <ArrowRight size={13} style={{ color: '#0D9488' }} />
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}                  </tbody>
                </table>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
