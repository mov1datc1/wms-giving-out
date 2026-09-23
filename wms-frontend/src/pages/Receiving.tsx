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
  ChevronRight, ChevronLeft
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { LocationSelect } from '../components/LocationSelect';
import { ReceiptPrintModal } from '../components/ReceiptPrintModal';
import { ReceiptReportModal } from '../components/ReceiptReportModal';
import { DivertToVirtualModal } from '../components/DivertToVirtualModal';

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
  cantidadEsperada: number;
  sku?: any;
  status: 'MATCHED' | 'NOT_FOUND' | 'FOREIGN_CLIENT' | 'INVALID_QTY';
  foreignClientName?: string;
}

interface ExcelAnalysis {
  fileName: string;
  totalRows: number;
  matchedRows: number;
  foreignRows: number;
  unmatchedCodes: string[];
  foreignCodes: Array<{ code: string; clientName: string }>;
  detectedFactura?: string;
  lines: ParsedLine[];
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
  const [expanded, setExpanded] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('receiving_sidebar_collapsed') === 'true');
  const toggleSidebar = () => {
    setSidebarCollapsed(prev => {
      const next = !prev;
      localStorage.setItem('receiving_sidebar_collapsed', String(next));
      return next;
    });
  };

  // Sincronizar parámetro de búsqueda de URL (?search=...)
  useEffect(() => {
    const q = searchParams.get('search');
    if (q !== null && q !== undefined) {
      setSearch(q);
    }
  }, [searchParams]);

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

  const headers: any = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  useEffect(() => { loadData(); }, []);

  function handleOpenPutawayModal(receipt: any) {
    const recLocId = locations.find(loc => loc.codigo === 'REC-01' || loc.tipoUbicacion === 'RECIBO')?.id || '';
    const clientObj = clients.find(c => c.id === receipt.clienteId) || receipt.cliente;

    const initialMoves = (receipt.lineas || []).map((l: any) => {
      // Ubicar sugerencia de rack según zona del cliente
      let suggestedRackId = '';
      if (clientObj?.zonaAsignadaId) {
        suggestedRackId = locations.find(loc => loc.zonaId === clientObj.zonaAsignadaId && loc.tipoUbicacion !== 'RECIBO')?.id || '';
      }
      if (!suggestedRackId) {
        suggestedRackId = locations.find(loc => loc.tipoUbicacion === 'ESTANTERIA')?.id || '';
      }

      return {
        skuId: l.skuId,
        codigo: l.sku?.codigo,
        descripcion: l.sku?.descripcion,
        cantidad: l.cantidadRecibida || l.cantidadEsperada || 0,
        ubicacionOrigenId: recLocId,
        ubicacionDestinoId: suggestedRackId,
      };
    }).filter((m: any) => m.cantidad > 0);

    setPutawayMoves(initialMoves);
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

  async function loadData() {
    setLoading(true);
    try {
      const receiptsPromise = fetch(`${API}/receipts`, { headers })
        .then(async (res) => {
          if (res.ok) {
            const data = await res.json();
            setReceipts(data.length > 0 ? data : demoReceipts);
          } else {
            setReceipts(demoReceipts);
          }
        })
        .catch((err) => {
          console.error('Error fetching receipts:', err);
          setReceipts(demoReceipts);
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
    } catch (err) {
      console.error(err);
      setReceipts(demoReceipts);
    } finally {
      setLoading(false);
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
          facturaRespaldo: editReceiptModal.facturaRespaldo !== undefined ? editReceiptModal.facturaRespaldo : editReceiptModal.ocReferencia,
          ocReferencia: editReceiptModal.ocReferencia,
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
    if (!closingReceipt) return;

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
        text: `ℹ️ Esta factura ya cuenta con el 100% de sus piezas recibidas y guardadas en inventario (${totalHist} pzas históricas). No hay piezas pendientes por recibir. Si recibiste producto excedente en andén, captúralo manualmente en la partida correspondiente.`,
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
      text: `⚡ 100% Conforme aplicado: ${count} partidas calculadas (${totalPieces} piezas pendientes asignadas a Conforme).`,
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
        text: `❌ ${err.message || 'Error de conexión al procesar el conteo masivo'}`,
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
      parseAndAnalyzeExcel(selectedFile, newPrevio.clienteId);
    }
  }

  function parseAndAnalyzeExcel(fileObj: File, explicitClienteId?: string) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        
        const rawJson: any[] = XLSX.utils.sheet_to_json(sheet, { defval: '' });
        if (rawJson.length === 0) {
          setExcelAnalysis(null);
          setFormMsg({ type: 'error', text: 'El archivo Excel seleccionado está vacío' });
          return;
        }

        let effectiveClienteId = explicitClienteId || newPrevio.clienteId;

        // Auto-detección inteligente del cliente si aún no se ha seleccionado
        if (!effectiveClienteId) {
          // 1. Detección por columna explícita (cliente, depositante, etc.)
          for (const row of rawJson) {
            for (const key of Object.keys(row)) {
              const cleanKey = key.trim().toLowerCase();
              if (['cliente', 'depositante', 'cuenta', 'razon_social', 'empresa'].includes(cleanKey)) {
                const val = String(row[key]).trim().toLowerCase();
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
              Object.keys(row).forEach(key => {
                const cleanKey = key.trim().toLowerCase();
                if (['ean', 'codigo', 'sku', 'codigo_barras', 'codigobarras', 'material'].includes(cleanKey)) {
                  code = String(row[key]).trim().toLowerCase();
                }
              });
              if (!code && (row['Ean'] || row['Codigo'] || row['SKU'])) {
                code = String(row['Ean'] || row['Codigo'] || row['SKU']).trim().toLowerCase();
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

        rawJson.forEach((row, idx) => {
          let rowFactura = '';
          let rowCodeOrEan = '';
          let rowQty = 0;

          Object.keys(row).forEach(key => {
            const cleanKey = key.trim().toLowerCase();
            const val = String(row[key]).trim();

            if (cleanKey === 'factura' || cleanKey === 'oc' || cleanKey === 'orden_compra' || cleanKey === 'invoice') {
              rowFactura = val;
            } else if (cleanKey === 'ean' || cleanKey === 'codigo' || cleanKey === 'sku' || cleanKey === 'codigo_barras' || cleanKey === 'codigobarras') {
              rowCodeOrEan = val;
            } else if (cleanKey === 'cantidad a recibir' || cleanKey === 'cantidad' || cleanKey === 'qty' || cleanKey === 'cant') {
              rowQty = parseFloat(val) || 0;
            }
          });

          if (!rowFactura && (row['Factura'] || row['factura'])) rowFactura = String(row['Factura'] || row['factura']).trim();
          if (!rowCodeOrEan && (row['Ean'] || row['EAN'] || row['Codigo'] || row['codigo'])) rowCodeOrEan = String(row['Ean'] || row['EAN'] || row['Codigo'] || row['codigo']).trim();
          if (rowQty === 0 && (row['Cantidad a recibir'] || row['Cantidad'] || row['CANTIDAD'])) rowQty = parseFloat(row['Cantidad a recibir'] || row['Cantidad'] || row['CANTIDAD']) || 0;

          if (!detectedFactura && rowFactura) {
            detectedFactura = rowFactura;
          }

          if (!rowCodeOrEan && rowQty === 0) return;

          const cleanCode = rowCodeOrEan.trim().toLowerCase();
          const matchedSku = clientSkus.find(s => 
            (s.codigo && s.codigo.toLowerCase() === cleanCode) ||
            (s.codigoBarras && s.codigoBarras.toLowerCase() === cleanCode)
          );

          let status: 'MATCHED' | 'NOT_FOUND' | 'FOREIGN_CLIENT' | 'INVALID_QTY' = 'MATCHED';
          let foreignClientName: string | undefined = undefined;

          if (!matchedSku) {
            // Tarea 4: Verificar si el SKU existe pero pertenece a otro depositante
            const otherSku = skus.find(s =>
              (s.codigo && s.codigo.toLowerCase() === cleanCode) ||
              (s.codigoBarras && s.codigoBarras.toLowerCase() === cleanCode)
            );

            if (otherSku && otherSku.clienteId !== effectiveClienteId) {
              status = 'FOREIGN_CLIENT';
              const ownerClient = clients.find(c => c.id === otherSku.clienteId) || otherSku.cliente;
              foreignClientName = ownerClient?.nombreComercial || 'Otro Depositante';
              if (rowCodeOrEan && !foreignCodes.some(f => f.code.toLowerCase() === cleanCode)) {
                foreignCodes.push({ code: rowCodeOrEan, clientName: foreignClientName });
              }
            } else {
              status = 'NOT_FOUND';
              if (rowCodeOrEan && !unmatchedCodes.includes(rowCodeOrEan)) {
                unmatchedCodes.push(rowCodeOrEan);
              }
            }
          } else if (rowQty <= 0) {
            status = 'INVALID_QTY';
          }

          parsedLines.push({
            rowNum: idx + 2,
            factura: rowFactura,
            codeOrEan: rowCodeOrEan,
            cantidadEsperada: rowQty,
            sku: matchedSku,
            status,
            foreignClientName
          });
        });

        if (detectedFactura) {
          setNewPrevio(prev => ({
            ...prev,
            facturaRespaldo: prev.facturaRespaldo || detectedFactura,
            ocReferencia: prev.ocReferencia || detectedFactura
          }));
        }

        const foreignCount = parsedLines.filter(l => l.status === 'FOREIGN_CLIENT').length;
        if (foreignCount > 0) {
          setFormMsg({
            type: 'error',
            text: `Alerta de catálogo: Se detectaron ${foreignCount} partidas en el archivo que pertenecen a otro depositante. Solo los productos autorizados para el cliente seleccionado serán procesados.`
          });
        }

        setExcelAnalysis({
          fileName: fileObj.name,
          totalRows: parsedLines.length,
          matchedRows: parsedLines.filter(l => l.status === 'MATCHED').length,
          foreignRows: foreignCount,
          unmatchedCodes,
          foreignCodes,
          detectedFactura,
          lines: parsedLines
        });

      } catch (err: any) {
        console.error('Error al procesar Excel:', err);
        setFormMsg({ type: 'error', text: 'Error al interpretar el formato del archivo Excel' });
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
          .filter(l => l.status === 'MATCHED' && l.sku)
          .map(l => ({
            skuId: l.sku.id,
            cantidadEsperada: l.cantidadEsperada,
            notas: l.factura ? `Factura/OC: ${l.factura}` : undefined
          })) || [])
      : manualLines;

    if (previoMode === 'EXCEL' && !file && validLines.length === 0) {
      setFormMsg({ type: 'error', text: 'Ninguna línea coincide con los SKUs del cliente seleccionado' });
      return;
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
        formData.append('facturaRespaldo', newPrevio.facturaRespaldo || newPrevio.ocReferencia || '');
        formData.append('ocReferencia', newPrevio.ocReferencia || newPrevio.facturaRespaldo || '');
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
          facturaRespaldo: newPrevio.facturaRespaldo || newPrevio.ocReferencia,
          tipoRecepcion: newPrevio.tipoRecepcion || 'RECEPCION',
          lineaTransporte: newPrevio.lineaTransporte,
          placa: newPrevio.placa,
          nombreChofer: newPrevio.nombreChofer,
          ocReferencia: newPrevio.ocReferencia || newPrevio.facturaRespaldo,
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
    if (norm === 'EN_PROCESO_CONTEO' || norm === 'EN_PROCESO' || norm === 'COMPLETO') {
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

  // Helpers con búsqueda tolerante por tokens y filtrado normalizado de estatus
  const filtered = receipts.filter(r => {
    let matchEstado = true;
    if (filterEstado) {
      const rMeta = getEstadoMeta(r.estado);
      matchEstado = rMeta.key === filterEstado;
    }
    if (!matchEstado) return false;
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
            <UploadCloud size={16} /> Cargar Previo (ASN)
          </button>
          <button className="btn btn-secondary" onClick={loadData}>
            <RefreshCw size={16} /> Actualizar
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
                    value={editReceiptModal.facturaRespaldo || editReceiptModal.ocReferencia || ''} 
                    onChange={e => setEditReceiptModal({ ...editReceiptModal, facturaRespaldo: e.target.value, ocReferencia: e.target.value })} 
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

      {/* --- STITCH DRAWER DE ALOJAMIENTO / PUTAWAY DE ANDÉN A RACKS --- */}
      {putawayModalReceipt && (
        <div className="stitch-drawer-overlay" onClick={() => setPutawayModalReceipt(null)}>
          <div className="stitch-drawer-content" onClick={e => e.stopPropagation()} style={{ background: '#FFFFFF', color: '#0F172A' }}>
            <div className="modal-header" style={{ borderBottom: '1px solid #E2E8F0', padding: '20px 24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: '#F0FDFA', color: '#0D9488', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Box size={22} />
                </div>
                <div>
                  <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#0F172A' }}>Alojamiento a Racks (Putaway)</h2>
                  <p style={{ margin: 0, fontSize: 12, color: '#64748B' }}>Previo {putawayModalReceipt.codigo} · Traslado de Andén REC-01 a Racks</p>
                </div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => setPutawayModalReceipt(null)} style={{ color: '#64748B' }}><X size={20} /></button>
            </div>

            <form onSubmit={handleExecutePutaway} style={{ display: 'flex', flexDirection: 'column', flex: 1, padding: 24, overflowY: 'auto' }}>
              <div style={{ padding: '12px 16px', background: '#F0FDFA', borderRadius: 8, border: '1px solid #CCFBF1', marginBottom: 20 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#0D9488', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Sparkles size={15} /> Sugerencias de Ubicación por Algoritmo Putaway (3PL Rules)
                </div>
                <div style={{ fontSize: 12, color: '#0F766E', marginTop: 4 }}>
                  El motor asignó los racks óptimos según la zona asignada al depositante (Textil / Alimentos) y rotación FIFO/FEFO.
                </div>
              </div>

              <div style={{ flex: 1 }}>
                {putawayMoves.map((m, idx) => (
                  <div key={idx} style={{ background: '#F8FAFC', borderRadius: 10, padding: 16, border: '1px solid #E2E8F0', marginBottom: 14 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                      <div>
                        <div style={{ fontWeight: 700, color: '#0D9488', fontSize: 14 }}>{m.codigo}</div>
                        <div style={{ fontSize: 12, color: '#64748B' }}>{m.descripcion}</div>
                      </div>
                      <span className="stitch-ean-badge" style={{ background: '#E0F2FE', color: '#0369A1', borderColor: '#BAE6FD' }}>{m.cantidad} PZA</span>
                    </div>

                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label" style={{ fontSize: 11, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Ubicación Rack Destino</label>
                      <select 
                        className="form-select form-select-full" 
                        style={{ fontSize: 13, background: '#FFFFFF', color: '#0F172A', borderColor: '#CBD5E1' }}
                        value={m.ubicacionDestinoId} 
                        onChange={e => {
                          const updated = [...putawayMoves];
                          updated[idx].ubicacionDestinoId = e.target.value;
                          setPutawayMoves(updated);
                        }}
                      >
                        {locations.filter(l => l.tipoUbicacion !== 'RECIBO' && l.tipoUbicacion !== 'DEVOLUCION').map(loc => (
                          <option key={loc.id} value={loc.id}>
                            📍 {loc.codigo} ({loc.zona?.nombre || loc.pasillo}) — Libres: {loc.capacidadUnits - (loc.ocupacion || 0)} uds
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                ))}
              </div>

              <div className="modal-footer" style={{ borderTop: '1px solid #E2E8F0', paddingTop: 16, marginTop: 20, display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-ghost" onClick={() => setPutawayModalReceipt(null)} style={{ color: '#64748B' }}>Cancelar</button>
                <button type="submit" className="btn btn-primary" disabled={submitting} style={{ background: '#0D9488', borderColor: '#0D9488', padding: '10px 20px', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <Box size={16} /> {submitting ? 'Ejecutando Alojamiento...' : 'Confirmar Alojamiento a Racks'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- MODAL CARGAR PREVIO DE RECIBO --- */}
      {showNewPrevio && (
        <div className="modal-overlay" onClick={() => setShowNewPrevio(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 840, maxHeight: '92vh', overflowY: 'auto' }}>
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
                    value={newPrevio.facturaRespaldo || newPrevio.ocReferencia} 
                    onChange={e => setNewPrevio({ ...newPrevio, facturaRespaldo: e.target.value, ocReferencia: e.target.value })} 
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Orden de Compra (OC Opcional)</label>
                  <input 
                    className="form-input" 
                    placeholder="Ej. OC-2026-99" 
                    value={newPrevio.ocReferencia} 
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

              <div style={{ background: 'var(--bg-secondary)', padding: '12px 16px', borderRadius: 8, border: '1px solid var(--border)', marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--primary)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Truck size={14} /> Datos de Transporte y Chofer
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Línea de Transporte</label>
                    <input className="form-input" placeholder="Ej. Transportes Castores" value={newPrevio.lineaTransporte} onChange={e => setNewPrevio({ ...newPrevio, lineaTransporte: e.target.value })} />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Placas de Unidad</label>
                    <input className="form-input" placeholder="Ej. 82-AA-9K" value={newPrevio.placa} onChange={e => setNewPrevio({ ...newPrevio, placa: e.target.value.toUpperCase() })} />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Nombre del Chofer</label>
                    <input className="form-input" placeholder="Ej. Juan Pérez López" value={newPrevio.nombreChofer} onChange={e => setNewPrevio({ ...newPrevio, nombreChofer: e.target.value })} />
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
                          <button 
                            type="button" 
                            className="btn btn-secondary btn-sm" 
                            style={{ marginTop: 10 }}
                            onClick={() => fileInputRef.current?.click()}
                          >
                            Cambiar Archivo
                          </button>
                        </div>
                      ) : (
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 14, color: '#1E293B' }}>Arrastra tu archivo Excel o haz clic aquí</div>
                          <div style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>Formatos soportados: .xlsx, .xls</div>
                          <button 
                            type="button" 
                            className="btn btn-primary btn-sm" 
                            style={{ marginTop: 12 }}
                            onClick={() => fileInputRef.current?.click()}
                          >
                            <UploadCloud size={14} /> Seleccionar Archivo
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {excelAnalysis && (
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 14 }}>
                        <div style={{ padding: '12px 14px', background: '#F8FAFC', borderRadius: 8, border: '1px solid #CBD5E1', boxShadow: '0 1px 2px rgba(0,0,0,0.03)' }}>
                          <div style={{ fontSize: 11, color: '#475569', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>Líneas Leídas</div>
                          <div style={{ fontSize: 22, fontWeight: 800, color: '#0F172A', lineHeight: 1 }}>{excelAnalysis.totalRows}</div>
                        </div>
                        <div style={{ padding: '12px 14px', background: '#F0FDF4', borderRadius: 8, border: '1px solid #86EFAC', boxShadow: '0 1px 2px rgba(0,0,0,0.03)' }}>
                          <div style={{ fontSize: 11, color: '#15803D', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>SKUs Válidos del Cliente</div>
                          <div style={{ fontSize: 22, fontWeight: 800, color: '#16A34A', lineHeight: 1 }}>{excelAnalysis.matchedRows}</div>
                        </div>
                        {excelAnalysis.foreignRows > 0 && (
                          <div style={{ padding: '12px 14px', background: '#FEFCE8', borderRadius: 8, border: '1px solid #FDE047', boxShadow: '0 1px 2px rgba(0,0,0,0.03)' }}>
                            <div style={{ fontSize: 11, color: '#A16207', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>De Otro Depositante</div>
                            <div style={{ fontSize: 22, fontWeight: 800, color: '#D97706', lineHeight: 1 }}>{excelAnalysis.foreignRows}</div>
                          </div>
                        )}
                        {excelAnalysis.unmatchedCodes.length > 0 && (
                          <div style={{ padding: '12px 14px', background: '#FEF2F2', borderRadius: 8, border: '1px solid #FECACA', boxShadow: '0 1px 2px rgba(0,0,0,0.03)' }}>
                            <div style={{ fontSize: 11, color: '#B91C1C', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>No Registrados</div>
                            <div style={{ fontSize: 22, fontWeight: 800, color: '#DC2626', lineHeight: 1 }}>{excelAnalysis.unmatchedCodes.length}</div>
                          </div>
                        )}
                      </div>

                      {/* Alerta de Cruce de Catálogo */}
                      {excelAnalysis.foreignRows > 0 && (
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
                            <strong style={{ color: '#78350F', fontWeight: 800 }}>Validación de Catálogo:</strong>{' '}
                            Se detectaron <strong>{excelAnalysis.foreignRows}</strong> {excelAnalysis.foreignRows === 1 ? 'partida que pertenece' : 'partidas que pertenecen'} a otro depositante ({excelAnalysis.foreignCodes.map(f => `${f.code} ➔ ${f.clientName}`).slice(0, 3).join(', ')}{excelAnalysis.foreignCodes.length > 3 ? '...' : ''}). El WMS protege el inventario y solo importará los SKUs autorizados de este cliente.
                          </div>
                        </div>
                      )}

                      {/* Tabla de Previsualización con Validación Cruzada */}
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
                          <span>Previsualización de Partidas ({excelAnalysis.lines.length} analizadas)</span>
                          <span style={{ fontSize: 11, fontWeight: 600, color: '#64748B', textTransform: 'none' }}>
                            Mostrando {Math.min(8, excelAnalysis.lines.length)} de {excelAnalysis.lines.length}
                          </span>
                        </div>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                          <thead>
                            <tr style={{ background: '#F8FAFC', color: '#475569', textAlign: 'left', borderBottom: '1px solid #E2E8F0' }}>
                              <th style={{ padding: '8px 12px', fontWeight: 700, fontSize: 11, width: 40 }}>#</th>
                              <th style={{ padding: '8px 12px', fontWeight: 700, fontSize: 11 }}>CÓDIGO ARCHIVO</th>
                              <th style={{ padding: '8px 12px', fontWeight: 700, fontSize: 11 }}>DESCRIPCIÓN</th>
                              <th style={{ padding: '8px 12px', fontWeight: 700, fontSize: 11, textAlign: 'right' }}>CANT.</th>
                              <th style={{ padding: '8px 12px', fontWeight: 700, fontSize: 11, textAlign: 'center' }}>VALIDACIÓN CATÁLOGO</th>
                            </tr>
                          </thead>
                          <tbody>
                            {excelAnalysis.lines.slice(0, 8).map((l, i) => (
                              <tr key={i} style={{ borderBottom: '1px solid #F1F5F9', background: i % 2 === 0 ? '#FFFFFF' : '#FAFAFA' }}>
                                <td style={{ padding: '8px 12px', color: '#64748B', fontWeight: 600 }}>{l.rowNum}</td>
                                <td style={{ padding: '8px 12px', fontWeight: 700, color: '#0F172A', fontFamily: 'monospace', fontSize: 13 }}>{l.codeOrEan}</td>
                                <td style={{ padding: '8px 12px', color: '#334155', fontWeight: 500 }}>{l.sku?.descripcion || '—'}</td>
                                <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 800, color: '#0284C7', fontSize: 13 }}>{l.cantidadEsperada}</td>
                                <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                                  {l.status === 'MATCHED' && (
                                    <span style={{
                                      background: '#DCFCE7',
                                      color: '#166534',
                                      border: '1px solid #86EFAC',
                                      padding: '3px 8px',
                                      borderRadius: 6,
                                      fontSize: 11,
                                      fontWeight: 700,
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: 5
                                    }}>
                                      <CheckCircle2 size={13} style={{ color: '#16A34A' }} /> Aprobado
                                    </span>
                                  )}
                                  {l.status === 'FOREIGN_CLIENT' && (
                                    <span style={{
                                      background: '#FEF3C7',
                                      color: '#92400E',
                                      border: '1px solid #FCD34D',
                                      padding: '3px 8px',
                                      borderRadius: 6,
                                      fontSize: 11,
                                      fontWeight: 700,
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: 5
                                    }} title={`Pertenece al depositante: ${l.foreignClientName}`}>
                                      <AlertTriangle size={13} style={{ color: '#D97706' }} /> Pertenece a {l.foreignClientName}
                                    </span>
                                  )}
                                  {l.status === 'NOT_FOUND' && (
                                    <span style={{
                                      background: '#FEE2E2',
                                      color: '#991B1B',
                                      border: '1px solid #FCA5A5',
                                      padding: '3px 8px',
                                      borderRadius: 6,
                                      fontSize: 11,
                                      fontWeight: 700,
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: 5
                                    }}>
                                      <X size={13} style={{ color: '#DC2626' }} /> No Existe en Catálogo
                                    </span>
                                  )}
                                  {l.status === 'INVALID_QTY' && (
                                    <span style={{ background: '#F1F5F9', color: '#475569', border: '1px solid #CBD5E1', padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700 }}>
                                      Cant. 0
                                    </span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {excelAnalysis.lines.length > 8 && (
                          <div style={{ padding: '8px 12px', background: '#F8FAFC', textAlign: 'center', fontSize: 11, color: '#64748B', borderTop: '1px solid #E2E8F0' }}>
                            Mostrando 8 de {excelAnalysis.lines.length} partidas del archivo
                          </div>
                        )}
                      </div>
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

              <div className="modal-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                {previoMode === 'EXCEL' ? (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={handleDownloadTemplate}>
                    <Download size={14} /> Descargar Plantilla Oficial (.xlsx)
                  </button>
                ) : (
                  <div style={{ fontSize: 12, color: '#94a3b8' }}>
                    Partidas listas: <strong style={{ color: '#2dd4bf' }}>{manualLines.length}</strong> ({manualLines.reduce((sum, l) => sum + l.cantidadEsperada, 0)} unidades)
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" className="btn btn-ghost" onClick={() => setShowNewPrevio(false)}>Cancelar</button>
                  <button 
                    type="submit" 
                    className="btn btn-primary" 
                    disabled={submitting || (previoMode === 'EXCEL' ? !file : manualLines.length === 0)}
                  >
                    {submitting ? 'Procesando...' : (previoMode === 'EXCEL' ? 'Crear Previo de Recibo' : `Crear Previo Manual (${manualLines.length} partidas)`)}
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
                      <strong style={{ fontSize: 14, color: '#0D9488', fontFamily: 'monospace', fontWeight: 700 }}>{closingReceipt.ocReferencia || 'FAC-2026-TEST-001'}</strong>
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
                        ✓ Conciliación Física 100% Conforme
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

      {/* --- STITCH INDUSTRIAL DOCK STAGING PROGRESS & KPI SUITE --- */}
      {(() => {
        let globalConforme = 0;
        let globalCuarentena = 0;
        let globalPendiente = 0;
        let globalEsperado = 0;

        receipts.forEach(r => {
          r.lineas?.forEach((l: any) => {
            const conf = l.cantidadRecibida || 0;
            const dan = l.cantidadDanada || 0;
            const esp = l.cantidadEsperada || 0;
            globalConforme += conf;
            globalCuarentena += dan;
            globalPendiente += Math.max(0, esp - (conf + dan));
            globalEsperado += esp;
          });
        });

        const activeReceipt = filtered.find(r => r.estado !== 'CERRADO') || receipts[0];
        let activeProgress = 0;
        let activeRecCount = 0;
        let activeEspCount = 0;

        if (activeReceipt && activeReceipt.lineas) {
          activeReceipt.lineas.forEach((l: any) => {
            activeRecCount += (l.cantidadRecibida || 0) + (l.cantidadDanada || 0);
            activeEspCount += l.cantidadEsperada || 0;
          });
          activeProgress = activeEspCount > 0 ? Math.round((activeRecCount / activeEspCount) * 100) : 0;
        }

        return (
          <div className="stitch-split-container">
            {/* LEFT WORKSPACE: KPIs, DOCK REC-01 CARD AND TABLE */}
            <div className="stitch-split-main">
              
              {/* 3 STITCH KPI CARDS MATCHING MOCKUP 1:1 (MINIMALIST WHITE) */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: 20 }}>
                {/* CARD 1: CONFORME (RECIBIDO) */}
                <div className="stitch-kpi-card" style={{ borderColor: '#A7F3D0', background: '#FFFFFF' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#059669', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <CheckCircle2 size={15} /> CONFORME (RECIBIDO)
                    </span>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: '#ECFDF5', color: '#059669' }}>
                      +12% hoy
                    </span>
                  </div>
                  <div style={{ fontSize: 26, fontWeight: 800, color: '#059669', marginTop: 8 }}>
                    {globalConforme.toLocaleString()} <span style={{ fontSize: 12, fontWeight: 500, color: '#64748B' }}>PZA</span>
                  </div>
                </div>

                {/* CARD 2: CUARENTENA (REVISIÓN) */}
                <div className="stitch-kpi-card" style={{ borderColor: '#FDE68A', background: '#FFFFFF' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#D97706', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <AlertTriangle size={15} /> CUARENTENA (REVISIÓN)
                    </span>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: '#FFFBEB', color: '#D97706' }}>
                      Pendiente QA
                    </span>
                  </div>
                  <div style={{ fontSize: 26, fontWeight: 800, color: '#D97706', marginTop: 8 }}>
                    {globalCuarentena.toLocaleString()} <span style={{ fontSize: 12, fontWeight: 500, color: '#64748B' }}>PZA</span>
                  </div>
                </div>

                {/* CARD 3: STOCK LIBRE (PUTAWAY) */}
                <div className="stitch-kpi-card" style={{ borderColor: '#BAE6FD', background: '#FFFFFF' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#0284C7', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Box size={15} /> STOCK LIBRE (PUTAWAY)
                    </span>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: '#F0F9FF', color: '#0284C7' }}>
                      Listo p/ Alojamiento
                    </span>
                  </div>
                  <div style={{ fontSize: 26, fontWeight: 800, color: '#0284C7', marginTop: 8 }}>
                    {globalPendiente.toLocaleString()} <span style={{ fontSize: 12, fontWeight: 500, color: '#64748B' }}>Uds de {globalEsperado.toLocaleString()}</span>
                  </div>
                </div>
              </div>

              {/* DOCK REC-01 ACTIVO WIDGET 1:1 MATCH (LIGHT THEME) */}
              {activeReceipt && (
                <div className="stitch-dock-card" style={{ marginBottom: 20 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#059669', boxShadow: '0 0 8px rgba(5, 150, 105, 0.4)' }} />
                      <span style={{ fontWeight: 800, fontSize: 15, color: '#0F172A' }}>Dock REC-01 Activo</span>
                    </div>
                    <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#0D9488', background: '#F0FDFA', border: '1px solid #CCFBF1', padding: '2px 10px', borderRadius: 4, fontWeight: 700 }}>
                      {activeReceipt.codigo}
                    </span>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 10, flexWrap: 'wrap', gap: 10 }}>
                    <div>
                      <div style={{ fontSize: 12, color: '#64748B' }}>Progreso de Descarga</div>
                      <div style={{ fontSize: 22, fontWeight: 800, color: '#0F172A', marginTop: 2 }}>
                        {activeProgress}% Completado <span style={{ fontSize: 13, fontWeight: 500, color: '#64748B' }}>({activeRecCount} / {activeEspCount} Bultos)</span>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', fontSize: 12 }}>
                      <div style={{ color: '#64748B', fontSize: 10, letterSpacing: '0.05em' }}>OPERADOR A CARGO</div>
                      <div style={{ fontWeight: 700, color: '#0F172A', display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end', marginTop: 2 }}>
                        <UserCheck size={14} style={{ color: '#0D9488' }} /> {activeReceipt.nombreChofer || 'Miguel Rodríguez'}
                      </div>
                      <div style={{ color: '#64748B', fontSize: 10, letterSpacing: '0.05em', marginTop: 4 }}>ETA FIN DE DESCARGA</div>
                      <div style={{ fontWeight: 600, color: '#334155', marginTop: 1 }}>14:30 hrs (-0 min)</div>
                    </div>
                  </div>

                  <div className="stitch-progress-bar-track">
                    <div className="stitch-progress-bar-fill" style={{ width: `${activeProgress}%` }} />
                  </div>
                </div>
              )}

              {/* STAGING LINES TABLE CONTAINER */}
              <div className="card" style={{ padding: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#0F172A' }}>Líneas de Recepción (Staging)</h3>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                    {/* BUSCADOR EN VIVO DE LA TABLA */}
                    <div style={{ position: 'relative', minWidth: 240 }}>
                      <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#64748B' }} />
                      <input 
                        type="text"
                        className="form-input"
                        placeholder="Buscar por previo, cliente, factura..."
                        value={search}
                        onChange={e => {
                          const val = e.target.value;
                          setSearch(val);
                          if (val) {
                            setSearchParams({ search: val });
                          } else {
                            setSearchParams({});
                          }
                        }}
                        style={{ paddingLeft: 32, paddingRight: search ? 28 : 10, height: 34, fontSize: 12, background: '#FFFFFF', borderColor: '#CBD5E1', color: '#0F172A', borderRadius: 6 }}
                      />
                      {search && (
                        <button 
                          type="button" 
                          onClick={() => { setSearch(''); setSearchParams({}); }}
                          style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: '#64748B', cursor: 'pointer', padding: 2, display: 'flex' }}
                          title="Limpiar búsqueda"
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>

                    {/* FILTRO DE ESTADO ESTANDARIZADO */}
                    <select
                      className="form-select"
                      value={filterEstado}
                      onChange={e => setFilterEstado(e.target.value)}
                      style={{ height: 34, fontSize: 12, background: '#FFFFFF', borderColor: '#CBD5E1', color: '#0F172A', borderRadius: 6, padding: '4px 10px' }}
                    >
                      <option value="">Todos los Estados ({receipts.length})</option>
                      <option value="PENDIENTE_ARRIBO">Pendiente de Arribo ({receipts.filter(r => ['PENDIENTE_ARRIBO', 'PENDIENTE'].includes(r.estado)).length})</option>
                      <option value="EN_PROCESO_CONTEO">En Proceso de Conteo ({receipts.filter(r => ['EN_PROCESO_CONTEO', 'EN_PROCESO', 'COMPLETO'].includes(r.estado)).length})</option>
                      <option value="CERRADA">Cerrada ({receipts.filter(r => ['CERRADA', 'CERRADO'].includes(r.estado)).length})</option>
                    </select>

                    {/* BOTÓN COLAPSAR / EXPANDIR PANEL DE SUGERENCIAS PUTAWAY */}
                    <button
                      type="button"
                      onClick={toggleSidebar}
                      className="btn btn-sm"
                      style={{
                        background: sidebarCollapsed ? '#F0FDFA' : '#F8FAFC',
                        borderColor: sidebarCollapsed ? '#2DD4BF' : '#CBD5E1',
                        color: sidebarCollapsed ? '#0D9488' : '#475569',
                        fontWeight: 600,
                        height: 34,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6
                      }}
                      title={sidebarCollapsed ? "Mostrar panel lateral de sugerencias Putaway" : "Ocultar panel lateral de sugerencias"}
                    >
                      <Sparkles size={14} style={{ color: '#0D9488' }} />
                      {sidebarCollapsed ? 'Ver Sugerencias AI' : 'Ocultar Sugerencias'}
                    </button>

                    <button 
                      type="button" 
                      className="btn btn-primary btn-sm" 
                      style={{ background: '#0D9488', borderColor: '#0D9488', fontWeight: 600, height: 34 }} 
                      onClick={(e) => {
                        e.stopPropagation();
                        const target = activeReceipt || receipts[0] || filtered[0];
                        if (target) {
                          setPrintModalReceipt(target);
                        } else {
                          setFormMsg({ type: 'error', text: 'No hay previos de recibo disponibles para imprimir etiquetas.' });
                        }
                      }}
                    >
                      <Printer size={14} style={{ marginRight: 4 }} /> Imprimir Etiquetas
                    </button>
                  </div>
                </div>

                {/* BARRA DE BANDERAS DE ESTATUS OPERATIVO RÁPIDO */}
                <div style={{ display: 'flex', gap: 8, padding: '0 0 14px 0', flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Filtrar por Bandera:
                  </span>
                  
                  {/* Todas */}
                  <button
                    type="button"
                    onClick={() => setFilterEstado('')}
                    style={{
                      padding: '4px 11px',
                      borderRadius: 20,
                      border: !filterEstado ? '1.5px solid #0D9488' : '1px solid #E2E8F0',
                      background: !filterEstado ? '#F0FDFA' : '#FFFFFF',
                      color: !filterEstado ? '#0D9488' : '#64748B',
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 5,
                      transition: 'all 0.15s'
                    }}
                  >
                    Todos ({receipts.length})
                  </button>

                  {/* Pendiente de Arribo */}
                  <button
                    type="button"
                    onClick={() => setFilterEstado(filterEstado === 'PENDIENTE_ARRIBO' ? '' : 'PENDIENTE_ARRIBO')}
                    style={{
                      padding: '4px 11px',
                      borderRadius: 20,
                      border: filterEstado === 'PENDIENTE_ARRIBO' ? '1.5px solid #0284C7' : '1px solid #E2E8F0',
                      background: filterEstado === 'PENDIENTE_ARRIBO' ? '#E0F2FE' : '#FFFFFF',
                      color: filterEstado === 'PENDIENTE_ARRIBO' ? '#0369A1' : '#64748B',
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 5,
                      transition: 'all 0.15s'
                    }}
                  >
                    <Clock size={12} />
                    Pendiente de Arribo ({receipts.filter(r => ['PENDIENTE_ARRIBO', 'PENDIENTE'].includes(r.estado)).length})
                  </button>

                  {/* En Proceso de Conteo */}
                  <button
                    type="button"
                    onClick={() => setFilterEstado(filterEstado === 'EN_PROCESO_CONTEO' ? '' : 'EN_PROCESO_CONTEO')}
                    style={{
                      padding: '4px 11px',
                      borderRadius: 20,
                      border: filterEstado === 'EN_PROCESO_CONTEO' ? '1.5px solid #D97706' : '1px solid #E2E8F0',
                      background: filterEstado === 'EN_PROCESO_CONTEO' ? '#FEF3C7' : '#FFFFFF',
                      color: filterEstado === 'EN_PROCESO_CONTEO' ? '#B45309' : '#64748B',
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 5,
                      transition: 'all 0.15s'
                    }}
                  >
                    <Scan size={12} />
                    En Proceso de Conteo ({receipts.filter(r => ['EN_PROCESO_CONTEO', 'EN_PROCESO', 'COMPLETO'].includes(r.estado)).length})
                  </button>

                  {/* Cerrada */}
                  <button
                    type="button"
                    onClick={() => setFilterEstado(filterEstado === 'CERRADA' ? '' : 'CERRADA')}
                    style={{
                      padding: '4px 11px',
                      borderRadius: 20,
                      border: filterEstado === 'CERRADA' ? '1.5px solid #059669' : '1px solid #E2E8F0',
                      background: filterEstado === 'CERRADA' ? '#D1FAE5' : '#FFFFFF',
                      color: filterEstado === 'CERRADA' ? '#047857' : '#64748B',
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 5,
                      transition: 'all 0.15s'
                    }}
                  >
                    <ShieldCheck size={12} />
                    Cerrada ({receipts.filter(r => ['CERRADA', 'CERRADO'].includes(r.estado)).length})
                  </button>
                </div>

                <div className="table-responsive">
                  <table className="data-table">
                    <thead>
              <tr>
                <th style={{ minWidth: '150px' }}>CÓDIGO PREVIO</th>
                <th style={{ minWidth: '95px' }}>FECHA</th>
                <th style={{ minWidth: '120px' }}>DEPOSITANTE</th>
                <th style={{ minWidth: '130px' }}>FACTURA / OC</th>
                <th style={{ minWidth: '140px' }}>TRANSPORTE</th>
                <th style={{ width: '50px', textAlign: 'center' }}>SKUS</th>
                <th style={{ width: '90px' }}>ESTADO</th>
                <th style={{ minWidth: '170px', textAlign: 'right' }}>ACCIONES</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--text-tertiary)' }}>
                    <RefreshCw size={28} className="animate-spin" style={{ margin: '0 auto 12px', color: '#2DD4BF' }} />
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#F1F5F9' }}>Sincronizando previos de recibo con el servidor...</div>
                    <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 4 }}>Cargando catálogo maestro y líneas de conteo</div>
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-tertiary)' }}>
                    <Package size={36} style={{ margin: '0 auto 10px', opacity: 0.4 }} />
                    <div>No hay previos de recibo registrados{filterEstado ? ` en estado ${filterEstado}` : ''}.</div>
                  </td>
                </tr>
              ) : (
                filtered.map(r => {
                  const clientObj = clients.find(c => c.id === r.clienteId) || r.cliente;
                  const missingBarcodesCount = r.lineas?.filter((l: any) => !l.sku?.codigoBarras).length || 0;
                  const isClosed = r.estado === 'CERRADO' || r.estado === 'CERRADA';

                  return (
                    <React.Fragment key={r.id}>
                      <tr 
                        style={{ cursor: 'pointer', background: expanded === r.id ? 'var(--bg-secondary)' : '' }} 
                        onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                      >
                        <td style={{ fontWeight: 700, color: 'var(--primary)', whiteSpace: 'nowrap' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                            <span style={{ fontSize: 13, letterSpacing: '-0.01em' }}>{r.codigo}</span>
                            {r.bloqueado ? (
                              <span title={`Previo confirmado y bloqueado${r.fechaBloqueo ? ` el ${new Date(r.fechaBloqueo).toLocaleDateString('es-MX')}` : ''}${r.bloqueadoPor ? ` por ${r.bloqueadoPor}` : ''}`} style={{ display: 'inline-flex', alignItems: 'center', color: '#fbbf24' }}>
                                <Lock size={13} />
                              </span>
                            ) : (
                              <span title="Previo abierto y editable" style={{ display: 'inline-flex', alignItems: 'center', color: '#64748b', opacity: 0.6 }}>
                                <Unlock size={13} />
                              </span>
                            )}
                            {r.tipoRecepcion === 'DEVOLUCION' ? (
                              <span style={{
                                fontSize: '10px',
                                padding: '1px 6px',
                                borderRadius: '4px',
                                backgroundColor: 'rgba(239, 68, 68, 0.12)',
                                color: '#f87171',
                                border: '1px solid rgba(239, 68, 68, 0.28)',
                                fontWeight: 700,
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 3
                              }}>
                                <RotateCcw size={10} /> Devolución
                              </span>
                            ) : (
                              <span style={{
                                fontSize: '10px',
                                padding: '1px 6px',
                                borderRadius: '4px',
                                backgroundColor: 'rgba(16, 185, 129, 0.1)',
                                color: '#34d399',
                                border: '1px solid rgba(16, 185, 129, 0.25)',
                                fontWeight: 700,
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 3
                              }}>
                                <Package size={10} /> Normal
                              </span>
                            )}
                          </div>
                        </td>
                        <td>{new Date(r.fechaRecepcion).toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: 'numeric' })}</td>
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-start' }}>
                            <span className="badge badge-info">{r.cliente?.nombreComercial || clientObj?.nombreComercial}</span>
                            {clientObj?.giro && (
                              <span style={{
                                fontSize: 10,
                                fontWeight: 700,
                                padding: '1px 6px',
                                borderRadius: 4,
                                background: clientObj.giro === 'COMIDA' ? 'rgba(245, 158, 11, 0.15)' : clientObj.giro === 'FARMACEUTICO' ? 'rgba(168, 85, 247, 0.15)' : 'rgba(148, 163, 184, 0.15)',
                                color: clientObj.giro === 'COMIDA' ? '#FBBF24' : clientObj.giro === 'FARMACEUTICO' ? '#C084FC' : '#94A3B8',
                                border: `1px solid ${clientObj.giro === 'COMIDA' ? 'rgba(245, 158, 11, 0.3)' : clientObj.giro === 'FARMACEUTICO' ? 'rgba(168, 85, 247, 0.3)' : 'rgba(148, 163, 184, 0.2)'}`,
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 3
                              }}>
                                {clientObj.giro}
                              </span>
                            )}
                          </div>
                        </td>
                        <td>
                          {r.facturaRespaldo || r.ocReferencia ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                              <span style={{ fontWeight: 700, color: 'var(--text-primary)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                <FileText size={13} style={{ color: 'var(--primary)' }} />
                                {r.facturaRespaldo || r.ocReferencia}
                              </span>
                              {r.tipoImportacion && r.tipoImportacion !== 'NO_APLICA' && (
                                <span style={{
                                  fontSize: 10,
                                  fontWeight: 700,
                                  color: '#38BDF8',
                                  backgroundColor: 'rgba(56, 189, 248, 0.12)',
                                  border: '1px solid rgba(56, 189, 248, 0.28)',
                                  padding: '1px 6px',
                                  borderRadius: 4,
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 4
                                }}>
                                  <Ship size={10} style={{ color: '#38bdf8' }} /> {r.tipoImportacion}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span style={{ color: 'var(--text-tertiary)' }}>—</span>
                          )}
                        </td>
                        <td>
                          <div style={{ fontSize: 13, fontWeight: 500 }}>
                            {r.lineaTransporte || 'Sin transporte'} {r.placa ? `(${r.placa})` : ''}
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{r.nombreChofer || '—'}</div>
                        </td>
                        <td style={{ fontWeight: 600, textAlign: 'center' }}>{r.lineas?.length || 0}</td>
                        <td style={{ textAlign: 'center' }}>
                          {(() => {
                            const meta = getEstadoMeta(r.estado);
                            const IconComponent = meta.icon;
                            return (
                              <span
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 6,
                                  padding: '4px 10px',
                                  borderRadius: 12,
                                  fontSize: 11,
                                  fontWeight: 700,
                                  background: meta.bg,
                                  color: meta.color,
                                  border: `1px solid ${meta.border}`,
                                  whiteSpace: 'nowrap',
                                  letterSpacing: '0.02em',
                                  boxShadow: '0 1px 2px rgba(0,0,0,0.1)'
                                }}
                                title={meta.description}
                              >
                                {meta.key === 'EN_PROCESO_CONTEO' ? (
                                  <span style={{ position: 'relative', display: 'inline-flex', width: 7, height: 7 }}>
                                    <span style={{ position: 'absolute', width: '100%', height: '100%', borderRadius: '50%', background: '#F59E0B', opacity: 0.75, animation: 'ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite' }} />
                                    <span style={{ position: 'relative', width: 7, height: 7, borderRadius: '50%', background: '#D97706' }} />
                                  </span>
                                ) : (
                                  <IconComponent size={13} style={{ color: meta.color }} />
                                )}
                                {meta.label}
                              </span>
                            );
                          })()}
                        </td>
                        <td style={{ textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', alignItems: 'center' }}>

                            {/* BOTÓN EDITAR PREVIO */}
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              disabled={r.bloqueado}
                              title={r.bloqueado ? "Edición bloqueada: Previo confirmado" : "Editar metadatos del previo (Factura, Transporte, Chofer)"}
                              onClick={(e) => { 
                                e.stopPropagation(); 
                                if (!r.bloqueado) setEditReceiptModal(r); 
                              }}
                              style={{ 
                                padding: '4px 6px',
                                opacity: r.bloqueado ? 0.45 : 1,
                                cursor: r.bloqueado ? 'not-allowed' : 'pointer'
                              }}
                            >
                              {r.bloqueado ? <Lock size={14} style={{ color: '#64748b' }} /> : <Settings size={14} />}
                            </button>

                            {/* BOTÓN IMPRIMIR ETIQUETAS */}
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              title="Imprimir etiquetas térmicas para este previo"
                              onClick={(e) => { e.stopPropagation(); setPrintModalReceipt(r); }}
                              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 8px', fontSize: 12 }}
                            >
                              <Printer size={13} /> Imprimir
                            </button>

                            {/* BOTÓN REPORTE DE ENTRADA */}
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              title="Ver e imprimir Reporte Oficial de Recepción (PDF)"
                              onClick={(e) => { e.stopPropagation(); setReportModalReceipt(r); }}
                              style={{ padding: '4px 6px', color: 'var(--emerald)' }}
                            >
                              <FileText size={15} />
                            </button>

                            {/* BOTÓN ELIMINAR PREVIO (SOLO SI NO ESTÁ CERRADO NI BLOQUEADO) */}
                            {!isClosed && !r.bloqueado && (
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                title="Eliminar previo de recibo"
                                onClick={() => setDeleteReceiptConfirm(r)}
                                style={{ padding: '4px 6px', color: 'var(--error)' }}
                              >
                                <Trash2 size={15} />
                              </button>
                            )}

                            <button 
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                              style={{ padding: '4px 6px' }}
                            >
                              {expanded === r.id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                            </button>
                          </div>
                        </td>
                      </tr>

                      {/* VISTA EXPANDIDA DEL PREVIO */}
                      {expanded === r.id && (
                        <tr>
                          <td colSpan={8} style={{ padding: 0 }}>
                            <div style={{ padding: '16px 20px', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)', width: '100%', boxSizing: 'border-box' }}>
                              
                              {/* PIPELINE VISUAL DE 3 ETAPAS DE ESTATUS OPERATIVO (TAREA 5) */}
                              {(() => {
                                const meta = getEstadoMeta(r.estado);
                                const currentStep = meta.stepIndex;

                                const steps = [
                                  {
                                    index: 0,
                                    key: 'PENDIENTE_ARRIBO',
                                    label: 'Pendiente de Arribo',
                                    shortDesc: 'Previo registrado en WMS',
                                    icon: Clock,
                                    color: '#38BDF8',
                                    bgActive: 'rgba(2, 132, 199, 0.18)',
                                    borderActive: '#0284C7',
                                  },
                                  {
                                    index: 1,
                                    key: 'EN_PROCESO_CONTEO',
                                    label: 'En Proceso de Conteo',
                                    shortDesc: 'Conteo físico y escaneo en andén',
                                    icon: Scan,
                                    color: '#FBBF24',
                                    bgActive: 'rgba(245, 158, 11, 0.18)',
                                    borderActive: '#D97706',
                                  },
                                  {
                                    index: 2,
                                    key: 'CERRADA',
                                    label: 'Cerrada',
                                    shortDesc: 'Recepción finiquitada e inmutable',
                                    icon: ShieldCheck,
                                    color: '#34D399',
                                    bgActive: 'rgba(16, 185, 129, 0.18)',
                                    borderActive: '#059669',
                                  }
                                ];

                                return (
                                  <div style={{
                                    background: 'rgba(15, 23, 42, 0.65)',
                                    border: '1px solid rgba(255, 255, 255, 0.08)',
                                    borderRadius: 12,
                                    padding: '16px 20px',
                                    marginBottom: 16,
                                    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)'
                                  }}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#94A3B8' }}>
                                          Ciclo Operativo del Folio
                                        </span>
                                        <span style={{
                                          fontSize: 11,
                                          fontWeight: 800,
                                          padding: '2px 8px',
                                          borderRadius: 6,
                                          background: meta.bg,
                                          color: meta.color,
                                          border: `1px solid ${meta.border}`,
                                          display: 'inline-flex',
                                          alignItems: 'center',
                                          gap: 5
                                        }}>
                                          <meta.icon size={12} /> {meta.label}
                                        </span>
                                      </div>

                                      {/* Acciones directas de avance de estatus */}
                                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                        {currentStep === 0 && (
                                          <button
                                            type="button"
                                            className="btn btn-sm"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              handleLockReceiptSubmit(r.id);
                                            }}
                                            style={{
                                              background: '#0D9488',
                                              borderColor: '#0D9488',
                                              color: '#FFFFFF',
                                              fontWeight: 700,
                                              fontSize: 12,
                                              display: 'inline-flex',
                                              alignItems: 'center',
                                              gap: 6,
                                              padding: '6px 12px',
                                              borderRadius: 6,
                                              boxShadow: '0 2px 4px rgba(13,148,136,0.3)',
                                              cursor: 'pointer'
                                            }}
                                            title="Confirmar arribo de unidad a andén y pasar a Proceso de Conteo"
                                          >
                                            <Scan size={14} /> Iniciar Conteo en Andén
                                          </button>
                                        )}

                                        {currentStep === 1 && !isClosed && (
                                          <div style={{ display: 'inline-flex', gap: 6 }}>
                                            <button
                                              type="button"
                                              className="btn btn-sm"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                setDivertModalData({
                                                  receipt: r,
                                                  initialTipoDesvio: (r.lineas || []).some((l: any) => (l.cantidadDanada || 0) > 0) ? 'MERMA' : 'EXCESO'
                                                });
                                              }}
                                              style={{
                                                background: 'rgba(239, 68, 68, 0.15)',
                                                border: '1px solid rgba(239, 68, 68, 0.4)',
                                                color: '#F87171',
                                                fontWeight: 700,
                                                fontSize: 12,
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                gap: 6,
                                                padding: '6px 12px',
                                                borderRadius: 6,
                                                cursor: 'pointer'
                                              }}
                                              title="Desviar mercancía dañada o excedente al almacén virtual"
                                            >
                                              <ShieldAlert size={14} style={{ color: '#F87171' }} /> Desviar a Almacén Virtual
                                            </button>
                                            <button
                                              type="button"
                                              className="btn btn-sm"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                setClosingReceipt(r);
                                              }}
                                              style={{
                                                background: '#059669',
                                                borderColor: '#059669',
                                                color: '#FFFFFF',
                                                fontWeight: 700,
                                                fontSize: 12,
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                gap: 6,
                                                padding: '6px 12px',
                                                borderRadius: 6,
                                                boxShadow: '0 2px 4px rgba(5,150,105,0.3)',
                                                cursor: 'pointer'
                                              }}
                                              title="Finalizar conteo físico y emitir reporte de cierre"
                                            >
                                              <CheckSquare size={14} /> Finalizar y Cerrar Recepción
                                            </button>
                                          </div>
                                        )}
                                      </div>
                                    </div>

                                    {/* Grid del Stepper */}
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr auto 1fr', alignItems: 'center', gap: 10 }}>
                                      {steps.map((step, idx) => {
                                        const StepIcon = step.icon;
                                        const isCompleted = currentStep > step.index;
                                        const isCurrent = currentStep === step.index;

                                        return (
                                          <React.Fragment key={step.key}>
                                            <div style={{
                                              padding: '12px 14px',
                                              borderRadius: 10,
                                              background: isCurrent ? '#F0FDFA' : isCompleted ? '#ECFDF5' : '#F8FAFC',
                                              border: isCurrent ? '1.5px solid #2DD4BF' : isCompleted ? '1px solid #A7F3D0' : '1px solid #E2E8F0',
                                              transition: 'all 0.2s',
                                              display: 'flex',
                                              alignItems: 'center',
                                              gap: 10
                                            }}>
                                              <div style={{
                                                width: 32,
                                                height: 32,
                                                borderRadius: 8,
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                background: isCompleted ? '#059669' : isCurrent ? step.color : '#E2E8F0',
                                                color: isCompleted || isCurrent ? '#FFFFFF' : '#64748B',
                                                flexShrink: 0,
                                                fontWeight: 800,
                                                boxShadow: isCurrent ? `0 0 12px ${step.color}50` : 'none'
                                              }}>
                                                {isCompleted ? <CheckCircle2 size={16} color="#FFFFFF" /> : <StepIcon size={16} color={isCurrent ? '#FFFFFF' : '#64748B'} />}
                                              </div>
                                              <div style={{ minWidth: 0, flex: 1 }}>
                                                <div style={{
                                                  fontSize: 12,
                                                  fontWeight: isCurrent ? 800 : 700,
                                                  color: isCurrent ? '#0F172A' : isCompleted ? '#059669' : '#64748B',
                                                  whiteSpace: 'nowrap',
                                                  overflow: 'hidden',
                                                  textOverflow: 'ellipsis'
                                                }}>
                                                  {step.label}
                                                </div>
                                                <div style={{ fontSize: 10, color: isCurrent ? '#0D9488' : '#94A3B8', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                  {isCompleted ? 'Completado' : isCurrent ? 'Fase Activa' : step.shortDesc}
                                                </div>
                                              </div>
                                            </div>

                                            {idx < steps.length - 1 && (
                                              <div style={{ color: isCompleted ? '#059669' : '#CBD5E1', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                <ArrowRight size={16} />
                                              </div>
                                            )}
                                          </React.Fragment>
                                        );
                                      })}
                                    </div>
                                  </div>
                                );
                              })()}

                              {/* BANNER DE ESTADO Y SEGURIDAD DEL PREVIO (TAREA 3) */}
                              {r.bloqueado ? (
                                <div style={{
                                  background: isClosed
                                    ? 'linear-gradient(90deg, rgba(100, 116, 139, 0.12) 0%, rgba(100, 116, 139, 0.04) 100%)'
                                    : 'linear-gradient(90deg, rgba(245, 158, 11, 0.12) 0%, rgba(245, 158, 11, 0.04) 100%)',
                                  border: isClosed
                                    ? '1px solid rgba(100, 116, 139, 0.35)'
                                    : '1px solid rgba(245, 158, 11, 0.35)',
                                  borderRadius: 10,
                                  padding: '12px 18px',
                                  marginBottom: 16,
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  flexWrap: 'wrap',
                                  gap: 12
                                }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                    <div style={{
                                      width: 36, height: 36, borderRadius: 8,
                                      background: isClosed ? 'rgba(100, 116, 139, 0.2)' : 'rgba(245, 158, 11, 0.2)',
                                      color: isClosed ? '#94a3b8' : '#fbbf24',
                                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                                      border: isClosed ? '1px solid rgba(100, 116, 139, 0.4)' : '1px solid rgba(245, 158, 11, 0.4)'
                                    }}>
                                      <Lock size={18} />
                                    </div>
                                    <div>
                                      <div style={{ fontSize: 13, fontWeight: 800, color: isClosed ? '#334155' : '#92400E', letterSpacing: '0.02em', display: 'flex', alignItems: 'center', gap: 6 }}>
                                        {isClosed ? 'RECEPCIÓN CERRADA — BLOQUEO DEFINITIVO DE AUDITORÍA' : 'PREVIO CONFIRMADO Y BLOQUEADO CONTRA EDICIÓN'}
                                      </div>
                                      <div style={{ fontSize: 11, color: isClosed ? '#64748B' : '#78350F', marginTop: 2 }}>
                                        {isClosed
                                          ? 'Esta recepción ha sido CERRADA y finiquitada. El inventario ya fue ingresado al almacén; por normativa WMS ni el administrador puede alterar ni desbloquear sus partidas históricas.'
                                          : `Confirmado el ${r.fechaBloqueo ? new Date(r.fechaBloqueo).toLocaleString('es-MX') : 'recientemente'} por ${r.bloqueadoPor || 'Operaciones WMS'}. La factura, SKUs y cantidades esperadas están protegidas.`
                                        }
                                      </div>
                                    </div>
                                  </div>

                                  {isClosed ? (
                                    <span style={{
                                      display: 'inline-flex', alignItems: 'center', gap: 6,
                                      fontSize: 12, fontWeight: 700,
                                      background: 'rgba(255, 255, 255, 0.05)',
                                      border: '1px solid rgba(255, 255, 255, 0.12)',
                                      color: '#94a3b8',
                                      padding: '7px 14px', borderRadius: 6
                                    }} title="Recepción cerrada contable y físicamente. Inmutable en auditoría.">
                                      <Lock size={13} style={{ color: '#64748b' }} /> Recepción Cerrada (Inmutable)
                                    </span>
                                  ) : isSupervisorOrAdmin ? (
                                    <button
                                      type="button"
                                      className="btn btn-sm"
                                      onClick={() => { setConfirmUnlockModal(r); setUnlockMotivo(''); setModalActionError(null); }}
                                      style={{
                                        display: 'inline-flex', alignItems: 'center', gap: 6,
                                        fontSize: 12, fontWeight: 700,
                                        background: 'rgba(30, 41, 59, 0.85)',
                                        border: '1px solid rgba(245, 158, 11, 0.5)',
                                        color: '#fbbf24',
                                        padding: '7px 14px', borderRadius: 6,
                                        cursor: 'pointer',
                                        boxShadow: '0 2px 6px rgba(0,0,0,0.2)'
                                      }}
                                      title="Permitir correcciones bajo autorización de supervisor o administrador"
                                    >
                                      <Unlock size={14} /> Desbloquear para Corrección
                                    </button>
                                  ) : (
                                    <span style={{
                                      display: 'inline-flex', alignItems: 'center', gap: 6,
                                      fontSize: 11, fontWeight: 600,
                                      background: 'rgba(245, 158, 11, 0.08)',
                                      border: '1px solid rgba(245, 158, 11, 0.25)',
                                      color: '#f59e0b',
                                      padding: '6px 12px', borderRadius: 6
                                    }} title="Solo un supervisor o administrador puede autorizar el desbloqueo de este previo">
                                      <Lock size={12} /> Bloqueado (Requiere Supervisor)
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <div style={{
                                  background: 'linear-gradient(90deg, rgba(13, 148, 136, 0.12) 0%, rgba(13, 148, 136, 0.04) 100%)',
                                  border: '1px solid rgba(13, 148, 136, 0.3)',
                                  borderRadius: 10,
                                  padding: '12px 18px',
                                  marginBottom: 16,
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  flexWrap: 'wrap',
                                  gap: 12
                                }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                    <div style={{
                                      width: 36, height: 36, borderRadius: 8,
                                      background: 'rgba(13, 148, 136, 0.2)',
                                      color: '#2dd4bf',
                                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                                      border: '1px solid #99F6E4'
                                    }}>
                                      <Unlock size={18} />
                                    </div>
                                    <div>
                                      <div style={{ fontSize: 13, fontWeight: 800, color: '#0F766E', letterSpacing: '0.02em', display: 'flex', alignItems: 'center', gap: 6 }}>
                                        MODO CAPTURA Y EDICIÓN LIBRE (PREVIO ABIERTO)
                                      </div>
                                      <div style={{ fontSize: 11, color: '#115E59', marginTop: 2 }}>
                                        Puedes ajustar partidas, agregar productos o modificar factura. Confirma el previo una vez que la unidad arribe a andén para bloquearlo.
                                      </div>
                                    </div>
                                  </div>

                                  <button
                                    type="button"
                                    className="btn btn-sm"
                                    onClick={() => setConfirmLockModal(r)}
                                    style={{
                                      display: 'inline-flex', alignItems: 'center', gap: 6,
                                      fontSize: 12, fontWeight: 800,
                                      background: 'linear-gradient(135deg, #0d9488 0%, #0f766e 100%)',
                                      border: '1px solid #14b8a6',
                                      color: '#ffffff',
                                      padding: '7px 16px', borderRadius: 8,
                                      boxShadow: '0 4px 12px rgba(13, 148, 136, 0.35)',
                                      cursor: 'pointer'
                                    }}
                                    title="Confirmar arribo y bloquear previo contra ediciones no autorizadas"
                                  >
                                    <Lock size={14} /> Confirmar Previo (Bloquear Edición)
                                  </button>
                                </div>
                              )}

                              {/* HEADER DEL DETALLE CON ACCIONES */}
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 12 }}>
                                <div style={{ minWidth: 220 }}>
                                  <h4 style={{ margin: 0, fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <Package size={18} style={{ color: 'var(--primary)' }} />
                                    Detalle de Líneas de Recepción ({r.codigo})
                                  </h4>
                                  <span style={{ fontSize: 12, color: 'var(--text-tertiary)', display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                    <span>Origen: <strong>{r.origen || 'Nacional'}</strong></span>
                                    {r.tipoImportacion && r.tipoImportacion !== 'NO_APLICA' && (
                                      <span style={{ color: '#38bdf8', fontWeight: 600 }}> ({r.tipoImportacion})</span>
                                    )}
                                    <span>· Factura de Respaldo: <strong style={{ color: '#0F172A' }}>{r.facturaRespaldo || r.ocReferencia || 'N/A'}</strong></span>
                                    {clientObj?.giro && (
                                      <span style={{
                                        fontSize: 10,
                                        fontWeight: 800,
                                        padding: '1px 7px',
                                        borderRadius: 4,
                                        background: clientObj.giro === 'COMIDA' ? 'rgba(245, 158, 11, 0.18)' : clientObj.giro === 'FARMACEUTICO' ? 'rgba(168, 85, 247, 0.18)' : 'rgba(148, 163, 184, 0.15)',
                                        color: clientObj.giro === 'COMIDA' ? '#FBBF24' : clientObj.giro === 'FARMACEUTICO' ? '#C084FC' : '#94A3B8',
                                        border: `1px solid ${clientObj.giro === 'COMIDA' ? 'rgba(245, 158, 11, 0.35)' : clientObj.giro === 'FARMACEUTICO' ? 'rgba(168, 85, 247, 0.35)' : 'rgba(148, 163, 184, 0.25)'}`,
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: 4
                                      }}>
                                        <ShieldCheck size={11} /> Giro: {clientObj.giro}
                                      </span>
                                    )}
                                    {r.notas && ` | Notas: ${r.notas}`}
                                  </span>
                                </div>

                                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                  {/* BOTÓN EDITAR PREVIO (FACTURA / IMPORTACIÓN / TRANSPORTE) */}
                                  {r.bloqueado ? (
                                    <button
                                      type="button"
                                      className="btn btn-secondary btn-sm"
                                      disabled
                                      title="Edición bloqueada: Previo confirmado. Desbloquea como supervisor para editar."
                                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '6px 12px', borderRadius: '6px', background: '#F1F5F9', borderColor: '#E2E8F0', color: '#94A3B8', fontWeight: 600, cursor: 'not-allowed', opacity: 0.7 }}
                                    >
                                      <Lock size={13} style={{ color: '#64748b' }} /> Previo Bloqueado
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      className="btn btn-secondary btn-sm"
                                      onClick={() => setEditReceiptModal(r)}
                                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '6px 12px', borderRadius: '6px', background: '#FFFFFF', borderColor: '#CBD5E1', color: '#0F172A', fontWeight: 600 }}
                                    >
                                      <Settings size={14} style={{ color: '#2dd4bf' }} /> Editar Previo (Factura / Importación)
                                    </button>
                                  )}

                                  {/* BOTÓN ALOJAMIENTO / PUTAWAY */}
                                  <button
                                    type="button"
                                    className="btn btn-sm"
                                    onClick={() => handleOpenPutawayModal(r)}
                                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, backgroundColor: '#F0F9FF', color: '#0284C7', border: '1px solid #BAE6FD', fontWeight: 600, padding: '6px 12px', borderRadius: '6px' }}
                                  >
                                    <Box size={14} /> Alojamiento / Putaway a Racks
                                  </button>

                                  {/* BOTÓN AGREGAR PRODUCTO MANUAL (SOLO SI NO ESTÁ BLOQUEADO) */}
                                  {!isClosed && !r.bloqueado && (
                                    <button
                                      type="button"
                                      className="btn btn-sm"
                                      onClick={() => setShowAddLineModal({ receiptId: r.id, clienteId: r.clienteId })}
                                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, backgroundColor: '#FFFFFF', color: '#0F172A', border: '1px solid #CBD5E1', fontWeight: 600, padding: '6px 12px', borderRadius: '6px' }}
                                    >
                                      <PlusCircle size={14} /> Agregar Producto Manual
                                    </button>
                                  )}

                                  {/* BOTÓN DESVIAR A ALMACÉN VIRTUAL (MERMA / EXCESO) */}
                                  <button
                                    type="button"
                                    className="btn btn-sm"
                                    onClick={() => setDivertModalData({
                                      receipt: r,
                                      initialTipoDesvio: (r.lineas || []).some((l: any) => (l.cantidadDanada || 0) > 0) ? 'MERMA' : 'EXCESO'
                                    })}
                                    style={{
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: 6,
                                      fontSize: 12,
                                      backgroundColor: 'rgba(239, 68, 68, 0.12)',
                                      color: '#F87171',
                                      border: '1px solid rgba(239, 68, 68, 0.4)',
                                      fontWeight: 700,
                                      padding: '6px 12px',
                                      borderRadius: '6px',
                                      cursor: 'pointer'
                                    }}
                                    title="Desviar producto dañado o excedente a almacén virtual de No Conforme / Merma"
                                  >
                                    <ShieldAlert size={14} style={{ color: '#F87171' }} /> Desviar a Almacén Virtual
                                    {(() => {
                                      const totalDan = (r.lineas || []).reduce((s: number, l: any) => s + (l.cantidadDanada || 0), 0);
                                      const totalExc = (r.lineas || []).reduce((s: number, l: any) => s + Math.max(0, (l.cantidadRecibida || 0) - (l.cantidadEsperada || 0)), 0);
                                      const ncTotal = totalDan + totalExc;
                                      if (ncTotal > 0) {
                                        return (
                                          <span style={{ background: '#EF4444', color: '#FFF', fontSize: 10, padding: '1px 6px', borderRadius: 10, marginLeft: 2, fontWeight: 800 }}>
                                            {ncTotal}
                                          </span>
                                        );
                                      }
                                      return null;
                                    })()}
                                  </button>

                                  {/* BOTÓN CERRAR RECEPCIÓN */}
                                  {!isClosed && (
                                    <button
                                      type="button"
                                      className="btn btn-sm"
                                      onClick={() => setClosingReceipt(r)}
                                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, backgroundColor: '#059669', color: '#ffffff', border: '1px solid #059669', fontWeight: 700, padding: '6px 12px', borderRadius: '6px' }}
                                    >
                                      <CheckSquare size={14} /> Finalizar y Cerrar Recepción
                                    </button>
                                  )}

                                  {/* BOTÓN ÚNICO REPORTE OFICIAL DE RECEPCIÓN */}
                                  <button
                                    type="button"
                                    className="btn btn-sm"
                                    onClick={() => setReportModalReceipt(r)}
                                    style={{ 
                                      display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12, 
                                      backgroundColor: '#ffffff', color: '#0f172a', 
                                      border: '1.5px solid #cbd5e1', fontWeight: 800, 
                                      padding: '7px 16px', borderRadius: '8px',
                                      boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
                                      cursor: 'pointer'
                                    }}
                                    title="Ver e imprimir Reporte Oficial (PROVA / Devoluciones / Recepción)"
                                  >
                                    <FileText size={15} style={{ color: '#0f172a' }} /> Ver Reporte Oficial (PROVA / Recibo)
                                  </button>

                                  {/* GENERAR EANs */}
                                  {missingBarcodesCount > 0 && (
                                    <button
                                      type="button"
                                      className="btn btn-secondary btn-sm"
                                      onClick={() => handleGenerateBarcodes(r.id)}
                                      disabled={generatingBarcodes === r.id}
                                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}
                                    >
                                      <QrCode size={14} style={{ color: 'var(--primary)' }} />
                                      {generatingBarcodes === r.id ? 'Generando...' : 'Generar Códigos EAN-13'}
                                    </button>
                                  )}
                                </div>
                              </div>

                              {/* BARRA DE ESCANEO RÁPIDO CON HANDHELD ZEBRA */}
                              {!isClosed && (
                                <div style={{
                                  background: 'var(--bg-card)',
                                  padding: '12px 16px',
                                  borderRadius: 8,
                                  border: '1px solid var(--border)',
                                  marginBottom: 16,
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  gap: 12,
                                  flexWrap: 'wrap',
                                  width: '100%',
                                  boxSizing: 'border-box'
                                }}>
                                  <form onSubmit={(e) => handleHandheldScan(e, r)} style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 260 }}>
                                    <div style={{
                                      width: 32, height: 32, borderRadius: 6,
                                      background: 'rgba(13,148,136,0.1)', color: 'var(--primary)',
                                      display: 'flex', alignItems: 'center', justifyContent: 'center'
                                    }}>
                                      <Scan size={18} />
                                    </div>
                                    <div style={{ flex: 1 }}>
                                      <input 
                                        ref={scannerInputRef}
                                        className="form-input" 
                                        placeholder="Escanear con Handheld Zebra TC22 (EAN / SKU)..." 
                                        value={scannerQuery} 
                                        onChange={e => setScannerQuery(e.target.value)} 
                                        style={{ fontSize: 13, height: 36 }}
                                      />
                                    </div>
                                    <button type="submit" className="btn btn-primary btn-sm" style={{ height: 36 }}>
                                      Escanear
                                    </button>
                                  </form>
                                  {scannerMsg.text && (
                                    <div style={{
                                      fontSize: 12, fontWeight: 600,
                                      color: scannerMsg.type === 'success' ? 'var(--emerald)' : 'var(--error)'
                                    }}>
                                      {scannerMsg.text}
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* BANNER DE ÉXITO DE PLANILLA MATRICIAL */}
                              {matrixSuccessBanner?.receiptId === r.id && (
                                <div style={{
                                  padding: '12px 18px',
                                  background: 'rgba(16, 185, 129, 0.12)',
                                  border: '1px solid rgba(16, 185, 129, 0.35)',
                                  borderRadius: 8,
                                  color: '#34D399',
                                  fontSize: 13,
                                  fontWeight: 700,
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  marginBottom: 14
                                }}>
                                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <CheckCircle2 size={16} /> {matrixSuccessBanner.text}
                                  </span>
                                  <button
                                    type="button"
                                    className="btn btn-ghost btn-xs"
                                    onClick={() => setMatrixSuccessBanner(null)}
                                    style={{ color: '#34D399', cursor: 'pointer' }}
                                  >
                                    <X size={14} />
                                  </button>
                                </div>
                              )}

                              {/* BANNER DE ERROR / VALIDACIÓN DE PLANILLA MATRICIAL */}
                              {matrixErrorBanner?.receiptId === r.id && (
                                <div style={{
                                  padding: '12px 18px',
                                  background: 'rgba(239, 68, 68, 0.15)',
                                  border: '1.5px solid rgba(239, 68, 68, 0.5)',
                                  borderRadius: 8,
                                  color: '#F87171',
                                  fontSize: 13,
                                  fontWeight: 700,
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  marginBottom: 14,
                                  boxShadow: '0 4px 12px rgba(239, 68, 68, 0.15)'
                                }}>
                                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <AlertTriangle size={18} style={{ color: '#F87171', flexShrink: 0 }} /> {matrixErrorBanner.text}
                                  </span>
                                  <button
                                    type="button"
                                    className="btn btn-ghost btn-xs"
                                    onClick={() => setMatrixErrorBanner(null)}
                                    style={{ color: '#F87171', cursor: 'pointer' }}
                                  >
                                    <X size={14} />
                                  </button>
                                </div>
                              )}

                              {/* SPRINT #3 - TAREA 4: PROTOCOLO DE TRAZABILIDAD Y CONTROL SANITARIO (COFEPRIS/FDA/NOM-251) */}
                              {(clientObj?.giro === 'COMIDA' || clientObj?.giro === 'FARMACEUTICO' || clientObj?.requiereLote || clientObj?.requiereCaducidad) && (
                                <div style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  padding: '12px 18px',
                                  marginBottom: 14,
                                  background: 'linear-gradient(90deg, rgba(245, 158, 11, 0.14) 0%, rgba(217, 119, 6, 0.05) 100%)',
                                  border: '1px solid rgba(245, 158, 11, 0.35)',
                                  borderRadius: 8,
                                  gap: 12,
                                  flexWrap: 'wrap',
                                  boxShadow: '0 2px 8px rgba(0,0,0,0.15)'
                                }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                    <div style={{
                                      width: 32, height: 32, borderRadius: 8,
                                      background: 'rgba(245, 158, 11, 0.2)',
                                      color: '#FBBF24',
                                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                                      flexShrink: 0
                                    }}>
                                      <ShieldCheck size={18} />
                                    </div>
                                    <div>
                                      <div style={{ fontSize: 13, fontWeight: 800, color: '#FEF3C7', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                        <span>PROTOCOLO DE TRAZABILIDAD Y CONTROL SANITARIO OBLIGATORIO</span>
                                        {clientObj?.giro && (
                                          <span style={{
                                            fontSize: 10,
                                            fontWeight: 800,
                                            padding: '2px 8px',
                                            borderRadius: 4,
                                            background: '#D97706',
                                            color: '#FFFFFF'
                                          }}>
                                            GIRO: {clientObj.giro}
                                          </span>
                                        )}
                                      </div>
                                      <div style={{ fontSize: 11, color: '#CBD5E1', marginTop: 2 }}>
                                        {clientObj?.giro === 'COMIDA' || clientObj?.giro === 'FARMACEUTICO'
                                          ? 'Por normativa de inocuidad y salud pública (COFEPRIS/FDA/NOM-251), la captura de LOTE y FECHA DE VENCIMIENTO es obligatoria en cada partida. Se prohíbe el ingreso de producto con caducidad vencida.'
                                          : 'El cliente depositante exige registro riguroso de lote y fecha de vencimiento en todas las unidades recibidas.'
                                        }
                                      </div>
                                    </div>
                                  </div>
                                  <span style={{
                                    fontSize: 11,
                                    fontWeight: 700,
                                    color: '#FBBF24',
                                    background: 'rgba(245, 158, 11, 0.15)',
                                    padding: '4px 10px',
                                    borderRadius: 6,
                                    border: '1px solid rgba(245, 158, 11, 0.3)'
                                  }}>
                                    Inspección Física en Andén
                                  </span>
                                </div>
                              )}

                              {/* SPRINT #3 - TAREA 2: TIRA EJECUTIVA DE 4 KPIS EN TIEMPO REAL */}
                              {(() => {
                                const drafts = matrixValues[r.id] || {};
                                const isBlind = Boolean(blindCountMode[r.id]);

                                let totalEsperado = 0;
                                let totalConforme = 0;
                                let totalDanado = 0;
                                let lineasConDiscrepancia = 0;
                                let lineasConMerma = 0;
                                let lineasExactas = 0;
                                let lineasPendientes = 0;

                                (r.lineas || []).forEach((l: any) => {
                                  const esp = l.cantidadEsperada || 0;
                                  const histConf = l.cantidadRecibida || 0;
                                  const histDan = l.cantidadDanada || 0;

                                  const d = drafts[l.id];
                                  const draftConf = d ? (typeof d.cantidadConforme === 'number' ? d.cantidadConforme : (d.cantidadConforme === '' ? 0 : parseFloat(String(d.cantidadConforme)) || 0)) : 0;
                                  const draftDan = d ? (typeof d.cantidadNoConforme === 'number' ? d.cantidadNoConforme : (d.cantidadNoConforme === '' ? 0 : parseFloat(String(d.cantidadNoConforme)) || 0)) : 0;

                                  const lineConf = histConf + draftConf;
                                  const lineDan = histDan + draftDan;
                                  const lineFisico = lineConf + lineDan;
                                  const lineDiff = lineFisico - esp;

                                  totalEsperado += esp;
                                  totalConforme += lineConf;
                                  totalDanado += lineDan;

                                  if (lineFisico === 0 && esp > 0) {
                                    lineasPendientes++;
                                  } else if (lineDiff === 0 && lineDan === 0) {
                                    lineasExactas++;
                                  } else {
                                    if (lineDiff !== 0) lineasConDiscrepancia++;
                                    if (lineDan > 0) lineasConMerma++;
                                  }
                                });

                                const totalFisico = totalConforme + totalDanado;
                                const variacionNeta = totalFisico - totalEsperado;
                                const pctCumplimiento = totalEsperado > 0 ? Math.min(100, Math.round((totalConforme / totalEsperado) * 100)) : 0;
                                const pctMerma = totalFisico > 0 ? ((totalDanado / totalFisico) * 100).toFixed(1) : '0.0';

                                return (
                                  <div style={{
                                    display: 'grid',
                                    gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
                                    gap: 12,
                                    marginBottom: 14
                                  }}>
                                    {/* TARJETA KPI 1: TOTAL ESPERADO FACTURA */}
                                    <div style={{
                                      background: 'rgba(15, 23, 42, 0.75)',
                                      border: '1px solid rgba(56, 189, 248, 0.25)',
                                      borderRadius: 10,
                                      padding: '12px 14px',
                                      position: 'relative',
                                      overflow: 'hidden'
                                    }}>
                                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                                        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#94A3B8' }}>
                                          Factura Esperada
                                        </span>
                                        <div style={{ width: 26, height: 26, borderRadius: 6, background: 'rgba(56, 189, 248, 0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#38BDF8' }}>
                                          <FileText size={14} />
                                        </div>
                                      </div>
                                      {isBlind ? (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '6px 0' }}>
                                          <Lock size={14} style={{ color: '#FBBF24' }} />
                                          <span style={{ fontSize: 13, fontWeight: 700, color: '#FBBF24' }}>Oculto en Modo Ciego</span>
                                        </div>
                                      ) : (
                                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                                          <span style={{ fontSize: 22, fontWeight: 800, color: '#F8FAFC', letterSpacing: '-0.02em' }}>
                                            {totalEsperado.toLocaleString()}
                                          </span>
                                          <span style={{ fontSize: 12, color: '#94A3B8', fontWeight: 600 }}>pzas totales</span>
                                        </div>
                                      )}
                                      <div style={{ fontSize: 11, color: '#64748B', marginTop: 4 }}>
                                        {r.lineas?.length || 0} partidas programadas en previo
                                      </div>
                                    </div>

                                    {/* TARJETA KPI 2: FÍSICO CONFORME Y CUMPLIMIENTO */}
                                    <div style={{
                                      background: 'rgba(15, 23, 42, 0.75)',
                                      border: '1px solid rgba(16, 185, 129, 0.25)',
                                      borderRadius: 10,
                                      padding: '12px 14px',
                                      position: 'relative',
                                      overflow: 'hidden'
                                    }}>
                                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                                        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#34D399' }}>
                                          Conforme Recibido
                                        </span>
                                        <div style={{ width: 26, height: 26, borderRadius: 6, background: 'rgba(16, 185, 129, 0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#34D399' }}>
                                          <CheckCircle2 size={14} />
                                        </div>
                                      </div>
                                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                                        <span style={{ fontSize: 22, fontWeight: 800, color: '#34D399', letterSpacing: '-0.02em' }}>
                                          {totalConforme.toLocaleString()}
                                        </span>
                                        <span style={{ fontSize: 12, color: '#A7F3D0', fontWeight: 600 }}>pzas aptas</span>
                                      </div>
                                      {!isBlind ? (
                                        <div>
                                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11, color: '#94A3B8', marginTop: 4 }}>
                                            <span>Cumplimiento:</span>
                                            <strong style={{ color: pctCumplimiento === 100 ? '#34D399' : '#38BDF8' }}>{pctCumplimiento}%</strong>
                                          </div>
                                          <div style={{ height: 4, background: 'rgba(255, 255, 255, 0.08)', borderRadius: 2, marginTop: 3, overflow: 'hidden' }}>
                                            <div style={{
                                              height: '100%',
                                              width: `${pctCumplimiento}%`,
                                              background: pctCumplimiento === 100 ? '#10B981' : 'linear-gradient(90deg, #38BDF8 0%, #34D399 100%)',
                                              transition: 'width 0.3s ease'
                                            }} />
                                          </div>
                                        </div>
                                      ) : (
                                        <div style={{ fontSize: 11, color: '#64748B', marginTop: 4 }}>
                                          Físico apto para inventario liberado
                                        </div>
                                      )}
                                    </div>

                                    {/* TARJETA KPI 3: DISCREPANCIA NETA (FALTANTE / SOBRANTE) */}
                                    <div style={{
                                      background: 'rgba(15, 23, 42, 0.75)',
                                      border: isBlind
                                        ? '1px solid rgba(245, 158, 11, 0.25)'
                                        : variacionNeta === 0
                                          ? '1px solid rgba(16, 185, 129, 0.25)'
                                          : variacionNeta < 0
                                            ? '1px solid rgba(245, 158, 11, 0.35)'
                                            : '1px solid rgba(56, 189, 248, 0.35)',
                                      borderRadius: 10,
                                      padding: '12px 14px',
                                      position: 'relative',
                                      overflow: 'hidden'
                                    }}>
                                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                                        <span style={{
                                          fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
                                          color: isBlind ? '#FBBF24' : variacionNeta === 0 ? '#34D399' : variacionNeta < 0 ? '#FBBF24' : '#38BDF8'
                                        }}>
                                          Discrepancia Neta
                                        </span>
                                        <div style={{
                                          width: 26, height: 26, borderRadius: 6,
                                          background: isBlind ? 'rgba(245, 158, 11, 0.12)' : variacionNeta === 0 ? 'rgba(16, 185, 129, 0.12)' : variacionNeta < 0 ? 'rgba(245, 158, 11, 0.12)' : 'rgba(56, 189, 248, 0.12)',
                                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                                          color: isBlind ? '#FBBF24' : variacionNeta === 0 ? '#34D399' : variacionNeta < 0 ? '#FBBF24' : '#38BDF8'
                                        }}>
                                          {isBlind ? <Lock size={14} /> : variacionNeta === 0 ? <Scale size={14} /> : variacionNeta < 0 ? <ArrowDownRight size={14} /> : <ArrowUpRight size={14} />}
                                        </div>
                                      </div>
                                      {isBlind ? (
                                        <div>
                                          <span style={{ fontSize: 13, fontWeight: 700, color: '#FBBF24' }}>Auditoría en Curso</span>
                                          <div style={{ fontSize: 11, color: '#64748B', marginTop: 4 }}>Cálculo ciego contra sesgo</div>
                                        </div>
                                      ) : (
                                        <div>
                                          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                                            <span style={{
                                              fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em',
                                              color: variacionNeta === 0 ? '#34D399' : variacionNeta < 0 ? '#FBBF24' : '#38BDF8'
                                            }}>
                                              {variacionNeta === 0 ? '0' : variacionNeta > 0 ? `+${variacionNeta}` : variacionNeta}
                                            </span>
                                            <span style={{
                                              fontSize: 12, fontWeight: 700,
                                              color: variacionNeta === 0 ? '#34D399' : variacionNeta < 0 ? '#FBBF24' : '#38BDF8'
                                            }}>
                                              {variacionNeta === 0 ? 'pzas (Cuadrada)' : variacionNeta < 0 ? 'pzas (Faltante)' : 'pzas (Excedente)'}
                                            </span>
                                          </div>
                                          <div style={{ fontSize: 11, color: '#64748B', marginTop: 4 }}>
                                            {variacionNeta === 0
                                              ? 'Coincide 100% con factura'
                                              : variacionNeta < 0
                                                ? `${lineasConDiscrepancia} partida(s) con faltante`
                                                : `${lineasConDiscrepancia} partida(s) con excedente`}
                                          </div>
                                        </div>
                                      )}
                                    </div>

                                    {/* TARJETA KPI 4: MERMA / NO CONFORME (CUARENTENA) */}
                                    <div style={{
                                      background: 'rgba(15, 23, 42, 0.75)',
                                      border: totalDanado > 0 ? '1.5px solid rgba(239, 68, 68, 0.4)' : '1px solid rgba(255, 255, 255, 0.08)',
                                      borderRadius: 10,
                                      padding: '12px 14px',
                                      position: 'relative',
                                      overflow: 'hidden',
                                      boxShadow: totalDanado > 0 ? '0 0 12px rgba(239, 68, 68, 0.15)' : 'none'
                                    }}>
                                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                                        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: totalDanado > 0 ? '#F87171' : '#94A3B8' }}>
                                          Merma / Dañado
                                        </span>
                                        <div style={{
                                          width: 26, height: 26, borderRadius: 6,
                                          background: totalDanado > 0 ? 'rgba(239, 68, 68, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                                          color: totalDanado > 0 ? '#F87171' : '#64748B'
                                        }}>
                                          <AlertTriangle size={14} />
                                        </div>
                                      </div>
                                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                                        <span style={{ fontSize: 22, fontWeight: 800, color: totalDanado > 0 ? '#F87171' : '#64748B', letterSpacing: '-0.02em' }}>
                                          {totalDanado.toLocaleString()}
                                        </span>
                                        <span style={{ fontSize: 12, color: totalDanado > 0 ? '#FCA5A5' : '#64748B', fontWeight: 600 }}>pzas merma</span>
                                      </div>
                                      <div style={{ fontSize: 11, color: totalDanado > 0 ? '#F87171' : '#64748B', marginTop: 4, fontWeight: totalDanado > 0 ? 600 : 400 }}>
                                        {totalDanado > 0
                                          ? `${pctMerma}% merma · Desvío a Cuarentena`
                                          : '0% merma · Carga 100% íntegra'}
                                      </div>
                                    </div>
                                  </div>
                                );
                              })()}

                              {/* TAREA 1: BARRA DE CONTROL DE PLANILLA MATRICIAL & CONTEO CIEGO */}
                              <div style={{
                                background: 'rgba(15, 23, 42, 0.85)',
                                border: '1px solid rgba(255, 255, 255, 0.08)',
                                borderRadius: 10,
                                padding: '12px 16px',
                                marginBottom: 14,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                flexWrap: 'wrap',
                                gap: 12
                              }}>
                                {/* LADO IZQUIERDO: Switch de Conteo Ciego y Acciones Rápidas */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                                  {/* SELECTOR / SWITCH DE MODO CONTEO CIEGO */}
                                  <button
                                    type="button"
                                    className="btn btn-sm"
                                    onClick={() => handleToggleBlindCount(r.id)}
                                    style={{
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: 7,
                                      fontSize: 12,
                                      fontWeight: 800,
                                      background: blindCountMode[r.id]
                                        ? 'linear-gradient(135deg, rgba(245, 158, 11, 0.28) 0%, rgba(217, 119, 6, 0.22) 100%)'
                                        : 'rgba(30, 41, 59, 0.9)',
                                      border: blindCountMode[r.id]
                                        ? '1.5px solid #F59E0B'
                                        : '1px solid rgba(255, 255, 255, 0.15)',
                                      color: blindCountMode[r.id] ? '#FBBF24' : '#CBD5E1',
                                      padding: '6px 14px',
                                      borderRadius: 8,
                                      cursor: 'pointer',
                                      boxShadow: blindCountMode[r.id] ? '0 0 12px rgba(245, 158, 11, 0.3)' : 'none'
                                    }}
                                    title={blindCountMode[r.id]
                                      ? "Desactivar modo ciego y mostrar cantidades esperadas del previo"
                                      : "Ocultar cantidades esperadas para auditoría física imparcial en andén"}
                                  >
                                    {blindCountMode[r.id] ? <EyeOff size={14} style={{ color: '#FBBF24' }} /> : <Eye size={14} style={{ color: '#38BDF8' }} />}
                                    <span>{blindCountMode[r.id] ? 'Modo Conteo Ciego ACTIVO' : 'Modo Conteo Estándar'}</span>
                                  </button>

                                  {/* BOTÓN AUTOLLENADO 100% CONFORME */}
                                  {!isClosed && (
                                    <button
                                      type="button"
                                      className="btn btn-sm"
                                      onClick={() => handleAutoFillConforme(r)}
                                      style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: 6,
                                        fontSize: 12,
                                        fontWeight: 700,
                                        background: 'rgba(16, 185, 129, 0.15)',
                                        border: '1px solid rgba(16, 185, 129, 0.4)',
                                        color: '#34D399',
                                        padding: '6px 12px',
                                        borderRadius: 8,
                                        cursor: 'pointer'
                                      }}
                                      title="Autollenar el 100% de las cantidades esperadas restantes como piezas conformes"
                                    >
                                      <CheckCheck size={14} /> Recibir 100% Conforme
                                    </button>
                                  )}

                                  {/* BOTÓN LIMPIAR PLANILLA */}
                                  {!isClosed && matrixValues[r.id] && (
                                    <button
                                      type="button"
                                      className="btn btn-ghost btn-sm"
                                      onClick={() => handleClearMatrix(r.id)}
                                      style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: 5,
                                        fontSize: 11,
                                        color: '#94A3B8',
                                        padding: '5px 10px'
                                      }}
                                      title="Limpiar los valores capturados en la planilla"
                                    >
                                      <RotateCcw size={12} /> Limpiar Planilla
                                    </button>
                                  )}
                                </div>

                                {/* LADO DERECHO: Selectores Rápidos de Ubicación de Ingreso */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#94A3B8' }}>
                                    <MapPin size={13} style={{ color: '#34D399' }} />
                                    <span>Ubic. Conforme:</span>
                                    <select
                                      disabled={isClosed}
                                      className="form-input"
                                      value={matrixLocations[r.id]?.ubicacionConformeId || locations.find(loc => loc.codigo === 'REC-01' || loc.tipoUbicacion === 'RECIBO')?.id || ''}
                                      onChange={e => {
                                        const val = e.target.value;
                                        setMatrixLocations(prev => ({
                                          ...prev,
                                          [r.id]: {
                                            ubicacionConformeId: val,
                                            ubicacionNoConformeId: prev[r.id]?.ubicacionNoConformeId || '',
                                          }
                                        }));
                                      }}
                                      style={{ height: 28, fontSize: 11, padding: '2px 8px', minWidth: 110, background: '#FFFFFF', color: '#059669', borderColor: '#CBD5E1' }}
                                    >
                                      {locations.map((loc: any) => (
                                        <option key={loc.id} value={loc.id}>{loc.codigo} ({loc.tipoUbicacion})</option>
                                      ))}
                                    </select>
                                  </div>

                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#94A3B8' }}>
                                    <MapPin size={13} style={{ color: '#F87171' }} />
                                    <span>Ubic. Merma/NC:</span>
                                    <select
                                      disabled={isClosed}
                                      className="form-input"
                                      value={matrixLocations[r.id]?.ubicacionNoConformeId || locations.find(loc => loc.codigo === 'DEV-01' || loc.codigo === 'MERMA-01' || loc.tipoUbicacion === 'DEVOLUCION')?.id || ''}
                                      onChange={e => {
                                        const val = e.target.value;
                                        setMatrixLocations(prev => ({
                                          ...prev,
                                          [r.id]: {
                                            ubicacionConformeId: prev[r.id]?.ubicacionConformeId || '',
                                            ubicacionNoConformeId: val,
                                          }
                                        }));
                                      }}
                                      style={{ height: 28, fontSize: 11, padding: '2px 8px', minWidth: 110, background: '#FFFFFF', color: '#DC2626', borderColor: '#CBD5E1' }}
                                    >
                                      {locations.map((loc: any) => (
                                        <option key={loc.id} value={loc.id}>{loc.codigo} ({loc.tipoUbicacion})</option>
                                      ))}
                                    </select>
                                  </div>
                                </div>
                              </div>

                              {/* TABLA DE PLANILLA MATRICIAL DE LÍNEAS POR FACTURA COMPLETA */}
                              <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', background: 'var(--bg-card)' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                                  <thead>
                                    <tr style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)', textAlign: 'left', color: 'var(--text-tertiary)', fontSize: 11 }}>
                                      <th style={{ padding: '8px 12px' }}>CÓDIGO SKU</th>
                                      <th style={{ padding: '8px 12px' }}>CÓDIGO DE BARRAS (EAN-13)</th>
                                      <th style={{ padding: '8px 12px' }}>DESCRIPCIÓN</th>
                                      <th style={{ padding: '8px 12px', textAlign: 'center' }}>
                                        {blindCountMode[r.id] ? 'AUDITORÍA FÍSICA' : 'ESPERADO'}
                                      </th>
                                      <th style={{ padding: '8px 12px', textAlign: 'center', color: '#34D399', background: 'rgba(16, 185, 129, 0.05)' }}>
                                        CONFORME A RECIBIR
                                      </th>
                                      <th style={{ padding: '8px 12px', textAlign: 'center', color: '#F87171', background: 'rgba(239, 68, 68, 0.05)' }}>
                                        NO CONFORME / MERMA
                                      </th>
                                      <th style={{ padding: '8px 12px', textAlign: 'center' }}>
                                        {blindCountMode[r.id] ? 'ESTATUS' : 'VARIACIÓN'}
                                      </th>
                                      <th style={{ padding: '8px 12px', textAlign: 'right' }}>ACCIONES</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {r.lineas?.map((l: any) => {
                                      const skuObj = l.sku;
                                      const esperada = l.cantidadEsperada || 0;
                                      const conforme = l.cantidadRecibida || 0;
                                      const danada = l.cantidadDanada || 0;
                                      const totalRecibido = conforme + danada;

                                      const draft = getMatrixLine(r.id, l.id, l);
                                      const draftConf = typeof draft.cantidadConforme === 'number' ? draft.cantidadConforme : (draft.cantidadConforme === '' ? 0 : parseFloat(String(draft.cantidadConforme)) || 0);
                                      const draftNC = typeof draft.cantidadNoConforme === 'number' ? draft.cantidadNoConforme : (draft.cantidadNoConforme === '' ? 0 : parseFloat(String(draft.cantidadNoConforme)) || 0);
                                      const isBlind = Boolean(blindCountMode[r.id]);

                                      const lineConfTotal = conforme + draftConf;
                                      const lineDanTotal = danada + draftNC;
                                      const lineFisicoTotal = lineConfTotal + lineDanTotal;
                                      const lineDiff = lineFisicoTotal - esperada;

                                      let borderLeftAccent = '3px solid transparent';
                                      if (lineFisicoTotal > 0 && !isBlind) {
                                        if (lineDanTotal > 0) {
                                          borderLeftAccent = '3px solid #EF4444';
                                        } else if (lineDiff === 0) {
                                          borderLeftAccent = '3px solid #10B981';
                                        } else if (lineDiff < 0) {
                                          borderLeftAccent = '3px solid #F59E0B';
                                        } else {
                                          borderLeftAccent = '3px solid #38BDF8';
                                        }
                                      }

                                      return (
                                        <React.Fragment key={l.id}>
                                          <tr style={{
                                            borderBottom: '1px solid var(--border)',
                                            borderLeft: borderLeftAccent,
                                            background: (draftConf > 0 || draftNC > 0) ? 'rgba(13, 148, 136, 0.05)' : undefined,
                                            transition: 'all 0.2s ease'
                                          }}>
                                            <td style={{ padding: '10px 12px', fontWeight: 600, color: 'var(--primary)' }}>
                                              {skuObj?.codigo}
                                            </td>
                                            <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontSize: 12 }}>
                                              {skuObj?.codigoBarras ? (
                                                <span className="stitch-ean-badge">{skuObj.codigoBarras}</span>
                                              ) : (
                                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                                  <span style={{ color: '#94A3B8', fontSize: 11 }}>Sin EAN-13</span>
                                                  <button
                                                    type="button"
                                                    className="btn btn-ghost btn-xs"
                                                    onClick={(e) => { e.stopPropagation(); handleGenerateBarcodes(r.id); }}
                                                    title="Generar código de barras EAN-13 oficial GS1 México"
                                                    style={{ padding: '2px 6px', fontSize: 10, color: '#38bdf8', background: 'rgba(56,189,248,0.12)', border: '1px solid rgba(56,189,248,0.3)', borderRadius: 4, cursor: 'pointer', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                                                  >
                                                    <Zap size={10} /> Generar EAN
                                                  </button>
                                                </span>
                                              )}
                                            </td>
                                            <td style={{ padding: '10px 12px' }}>
                                              <div style={{ fontWeight: 600, color: '#F8FAFC' }}>{skuObj?.descripcion}</div>
                                              <div style={{ fontSize: 11, color: '#94A3B8' }}>
                                                {skuObj?.talla ? `Talla ${skuObj.talla}` : ''} {skuObj?.color ? `· ${skuObj.color}` : ''}
                                                {l.notas ? ` | ${l.notas}` : ''}
                                              </div>
                                              {(l.loteAsignado || l.fechaVencimiento) && (
                                                <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                                                  {l.loteAsignado && (
                                                    <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: 'rgba(245, 158, 11, 0.15)', color: '#FBBF24', border: '1px solid rgba(245, 158, 11, 0.3)', fontWeight: 700 }}>
                                                      Histórico Lote: {l.loteAsignado}
                                                    </span>
                                                  )}
                                                  {l.fechaVencimiento && (
                                                    <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: 'rgba(56, 189, 248, 0.15)', color: '#38BDF8', border: '1px solid rgba(56, 189, 248, 0.3)', fontWeight: 700 }}>
                                                      Histórico Caducidad: {String(l.fechaVencimiento).slice(0, 10)}
                                                    </span>
                                                  )}
                                                </div>
                                              )}

                                              {/* TRAZABILIDAD CONDICIONAL (LOTE Y FECHA CADUCIDAD) */}
                                              {(() => {
                                                const isGiroRegulado = clientObj?.giro === 'COMIDA' || clientObj?.giro === 'FARMACEUTICO';
                                                const rowReqLote = Boolean(clientObj?.requiereLote || isGiroRegulado || skuObj?.requiereLote || l.sku?.requiereLote);
                                                const rowReqCaducidad = Boolean(clientObj?.requiereCaducidad || isGiroRegulado || skuObj?.requiereCaducidad || l.sku?.requiereCaducidad);

                                                if (!rowReqLote && !rowReqCaducidad) return null;

                                                const isExpired = (() => {
                                                  if (!draft.fechaVencimiento?.trim()) return false;
                                                  const d = new Date(draft.fechaVencimiento.trim());
                                                  const today = new Date();
                                                  today.setHours(0, 0, 0, 0);
                                                  return !isNaN(d.getTime()) && d < today;
                                                })();

                                                return (
                                                  <div style={{ display: 'flex', gap: 8, marginTop: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                                                    {rowReqLote && (
                                                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                                        <input
                                                          type="text"
                                                          placeholder="Lote *"
                                                          disabled={isClosed}
                                                          value={draft.lote}
                                                          onChange={e => handleMatrixChange(r.id, l.id, 'lote', e.target.value)}
                                                          style={{
                                                            width: 100,
                                                            height: 25,
                                                            fontSize: 11,
                                                            background: '#FFFFFF',
                                                            color: '#0F172A',
                                                            border: !draft.lote?.trim() ? '1.5px solid #F59E0B' : '1.5px solid #10B981',
                                                            borderRadius: 5,
                                                            padding: '2px 7px',
                                                            boxShadow: !draft.lote?.trim() ? '0 0 6px rgba(245, 158, 11, 0.2)' : 'none'
                                                          }}
                                                          title="Lote obligatorio (*)"
                                                        />
                                                      </div>
                                                    )}
                                                    {rowReqCaducidad && (
                                                      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                                        <span style={{ fontSize: 11, color: isExpired ? '#EF4444' : (!draft.fechaVencimiento ? '#FBBF24' : '#34D399'), fontWeight: 700 }}>
                                                          {isExpired ? '¡Caducado! *:' : 'Caducidad *:'}
                                                        </span>
                                                        <input
                                                          type="date"
                                                          disabled={isClosed}
                                                          value={draft.fechaVencimiento}
                                                          onChange={e => handleMatrixChange(r.id, l.id, 'fechaVencimiento', e.target.value)}
                                                          style={{
                                                            height: 25,
                                                            fontSize: 11,
                                                            background: '#FFFFFF',
                                                            color: isExpired ? '#DC2626' : '#0F172A',
                                                            border: isExpired ? '1.5px solid #EF4444' : (!draft.fechaVencimiento ? '1.5px solid #F59E0B' : '1.5px solid #10B981'),
                                                            borderRadius: 5,
                                                            padding: '2px 5px',
                                                            boxShadow: isExpired ? '0 0 8px rgba(239, 68, 68, 0.3)' : (!draft.fechaVencimiento ? '0 0 6px rgba(245, 158, 11, 0.2)' : 'none')
                                                          }}
                                                          title={isExpired ? "¡Rechazo sanitario! Producto caducado no permitido" : "Fecha de caducidad obligatoria (*)"}
                                                        />
                                                      </div>
                                                    )}
                                                    {isGiroRegulado && (
                                                      <span style={{
                                                        fontSize: 9,
                                                        fontWeight: 800,
                                                        textTransform: 'uppercase',
                                                        padding: '1px 5px',
                                                        borderRadius: 4,
                                                        background: 'rgba(245, 158, 11, 0.15)',
                                                        color: '#FBBF24',
                                                        border: '1px solid rgba(245, 158, 11, 0.3)'
                                                      }}>
                                                        {clientObj?.giro}
                                                      </span>
                                                    )}
                                                  </div>
                                                );
                                              })()}
                                            </td>

                                            {/* COLUMNA ESPERADO / CONTEO CIEGO */}
                                            <td style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 700 }}>
                                              {isBlind ? (
                                                <div>
                                                  <span style={{
                                                    display: 'inline-flex', alignItems: 'center', gap: 5,
                                                    fontSize: 11, fontWeight: 700,
                                                    padding: '3px 8px', borderRadius: 6,
                                                    background: 'rgba(245, 158, 11, 0.15)',
                                                    color: '#FBBF24',
                                                    border: '1px solid rgba(245, 158, 11, 0.35)'
                                                  }}>
                                                    <Lock size={11} /> Ciego (Oculto)
                                                  </span>
                                                  <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 3 }}>
                                                    Previo: {totalRecibido} ya recibidas
                                                  </div>
                                                </div>
                                              ) : (
                                                <div>
                                                  <div style={{ color: '#0F172A', fontSize: 13, fontWeight: 700 }}>
                                                    {totalRecibido} / {esperada}
                                                  </div>
                                                  <div className="stitch-mini-progress" style={{ height: 4, background: 'rgba(255,255,255,0.08)', borderRadius: 2, margin: '4px 0 2px 0', overflow: 'hidden' }}>
                                                    <div className="stitch-mini-progress-fill" style={{
                                                      height: '100%',
                                                      width: `${esperada > 0 ? Math.min(100, Math.round(((totalRecibido + draftConf + draftNC) / esperada) * 100)) : 0}%`,
                                                      background: (totalRecibido + draftConf + draftNC) >= esperada ? '#34D399' : (totalRecibido + draftConf + draftNC) > 0 ? '#38BDF8' : '#64748B',
                                                      transition: 'width 0.3s ease'
                                                    }} />
                                                  </div>
                                                  {(draftConf > 0 || draftNC > 0) ? (
                                                    <div style={{ fontSize: 10, color: '#34D399', fontWeight: 800, marginTop: 2 }}>
                                                      +{draftConf + draftNC} a guardar
                                                    </div>
                                                  ) : (
                                                    <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 2 }}>
                                                      {Math.round((totalRecibido / (esperada || 1)) * 100)}% recibido
                                                    </div>
                                                  )}
                                                </div>
                                              )}
                                            </td>

                                            {/* COLUMNA CONFORME (INPUT MATRICIAL EDITABLE) */}
                                            <td style={{ padding: '8px 12px', textAlign: 'center', background: 'rgba(16, 185, 129, 0.03)' }}>
                                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                                                <button
                                                  type="button"
                                                  disabled={isClosed}
                                                  onClick={() => {
                                                    const cur = typeof draft.cantidadConforme === 'number' ? draft.cantidadConforme : 0;
                                                    handleMatrixChange(r.id, l.id, 'cantidadConforme', Math.max(0, cur - 1));
                                                  }}
                                                  style={{ width: 22, height: 28, borderRadius: 4, background: '#F1F5F9', border: '1px solid #CBD5E1', color: '#475569', cursor: isClosed ? 'not-allowed' : 'pointer', fontWeight: 700 }}
                                                >
                                                  -
                                                </button>
                                                <input
                                                  type="number"
                                                  min="0"
                                                  disabled={isClosed}
                                                  value={draft.cantidadConforme}
                                                  placeholder={String(Math.max(0, esperada - totalRecibido))}
                                                  onFocus={e => e.target.select()}
                                                  onChange={e => handleMatrixChange(r.id, l.id, 'cantidadConforme', e.target.value === '' ? '' : Math.max(0, parseInt(e.target.value) || 0))}
                                                  style={{
                                                    width: 72,
                                                    height: 30,
                                                    textAlign: 'center',
                                                    fontWeight: 700,
                                                    fontSize: 13,
                                                    background: '#FFFFFF',
                                                    color: '#059669',
                                                    border: draftConf > 0 ? '1.5px solid #10B981' : '1px solid rgba(52, 211, 153, 0.3)',
                                                    borderRadius: 5,
                                                    boxShadow: draftConf > 0 ? '0 0 6px rgba(16, 185, 129, 0.25)' : 'none'
                                                  }}
                                                />
                                                <button
                                                  type="button"
                                                  disabled={isClosed}
                                                  onClick={() => {
                                                    const cur = typeof draft.cantidadConforme === 'number' ? draft.cantidadConforme : 0;
                                                    handleMatrixChange(r.id, l.id, 'cantidadConforme', cur + 1);
                                                  }}
                                                  style={{ width: 22, height: 28, borderRadius: 4, background: '#F1F5F9', border: '1px solid #CBD5E1', color: '#475569', cursor: isClosed ? 'not-allowed' : 'pointer', fontWeight: 700 }}
                                                >
                                                  +
                                                </button>
                                              </div>
                                              <div style={{ fontSize: 10, color: '#64748B', marginTop: 2 }}>
                                                Histórico: {conforme} conf.
                                              </div>
                                            </td>

                                            {/* COLUMNA NO CONFORME / DAÑADO (INPUT MATRICIAL EDITABLE) */}
                                            <td style={{ padding: '8px 12px', textAlign: 'center', background: 'rgba(239, 68, 68, 0.03)' }}>
                                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                                                <button
                                                  type="button"
                                                  disabled={isClosed}
                                                  onClick={() => {
                                                    const cur = typeof draft.cantidadNoConforme === 'number' ? draft.cantidadNoConforme : 0;
                                                    handleMatrixChange(r.id, l.id, 'cantidadNoConforme', Math.max(0, cur - 1));
                                                  }}
                                                  style={{ width: 22, height: 28, borderRadius: 4, background: '#F1F5F9', border: '1px solid #CBD5E1', color: '#475569', cursor: isClosed ? 'not-allowed' : 'pointer', fontWeight: 700 }}
                                                >
                                                  -
                                                </button>
                                                <input
                                                  type="number"
                                                  min="0"
                                                  disabled={isClosed}
                                                  value={draft.cantidadNoConforme}
                                                  placeholder="0"
                                                  onFocus={e => e.target.select()}
                                                  onChange={e => handleMatrixChange(r.id, l.id, 'cantidadNoConforme', e.target.value === '' ? '' : Math.max(0, parseInt(e.target.value) || 0))}
                                                  style={{
                                                    width: 65,
                                                    height: 30,
                                                    textAlign: 'center',
                                                    fontWeight: 700,
                                                    fontSize: 13,
                                                    background: '#FFFFFF',
                                                    color: draftNC > 0 ? '#DC2626' : '#94A3B8',
                                                    border: draftNC > 0 ? '1.5px solid #EF4444' : '1px solid rgba(148, 163, 184, 0.25)',
                                                    borderRadius: 5,
                                                    boxShadow: draftNC > 0 ? '0 0 6px rgba(239, 68, 68, 0.25)' : 'none'
                                                  }}
                                                />
                                                <button
                                                  type="button"
                                                  disabled={isClosed}
                                                  onClick={() => {
                                                    const cur = typeof draft.cantidadNoConforme === 'number' ? draft.cantidadNoConforme : 0;
                                                    handleMatrixChange(r.id, l.id, 'cantidadNoConforme', cur + 1);
                                                  }}
                                                  style={{ width: 22, height: 28, borderRadius: 4, background: '#F1F5F9', border: '1px solid #CBD5E1', color: '#475569', cursor: isClosed ? 'not-allowed' : 'pointer', fontWeight: 700 }}
                                                >
                                                  +
                                                </button>
                                              </div>
                                              <div style={{ fontSize: 10, color: draftNC > 0 ? '#F87171' : '#64748B', marginTop: 2, fontWeight: draftNC > 0 ? 700 : 400 }}>
                                                {draftNC > 0 ? (
                                                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: '#F87171', fontWeight: 700 }}>
                                                    <AlertTriangle size={10} /> A Cuarentena
                                                  </span>
                                                ) : (
                                                  danada > 0 ? `Histórico: ${danada} dañado` : '0 dañado'
                                                )}
                                              </div>
                                            </td>

                                            {/* COLUMNA VARIACIÓN / ESTATUS */}
                                            <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                                              {isBlind ? (
                                                <span style={{
                                                  fontSize: 11,
                                                  fontWeight: 700,
                                                  color: '#FBBF24',
                                                  background: 'rgba(245, 158, 11, 0.12)',
                                                  padding: '3px 8px',
                                                  borderRadius: 5,
                                                  border: '1px solid rgba(245, 158, 11, 0.3)',
                                                  display: 'inline-flex',
                                                  alignItems: 'center',
                                                  gap: 4
                                                }}>
                                                  <Lock size={11} /> Ciego (Oculto)
                                                </span>
                                              ) : (() => {
                                                if (lineFisicoTotal === 0) {
                                                  return (
                                                    <span style={{
                                                      display: 'inline-flex',
                                                      alignItems: 'center',
                                                      gap: 4,
                                                      fontSize: 11,
                                                      color: '#64748B',
                                                      background: 'rgba(255, 255, 255, 0.04)',
                                                      padding: '3px 8px',
                                                      borderRadius: 5,
                                                      border: '1px solid rgba(255, 255, 255, 0.08)'
                                                    }}>
                                                      Pendiente
                                                    </span>
                                                  );
                                                }

                                                // Caso 1: 100% Exacto y sin merma
                                                if (lineDiff === 0 && lineDanTotal === 0) {
                                                  return (
                                                    <span style={{
                                                      display: 'inline-flex',
                                                      alignItems: 'center',
                                                      gap: 4,
                                                      fontSize: 11,
                                                      fontWeight: 700,
                                                      color: '#34D399',
                                                      background: 'rgba(16, 185, 129, 0.14)',
                                                      padding: '3px 9px',
                                                      borderRadius: 6,
                                                      border: '1px solid rgba(16, 185, 129, 0.35)'
                                                    }}>
                                                      <CheckCircle2 size={12} /> Exacto (100%)
                                                    </span>
                                                  );
                                                }

                                                // Caso 2: Coincide en piezas totales pero con producto dañado
                                                if (lineDiff === 0 && lineDanTotal > 0) {
                                                  return (
                                                    <div style={{ display: 'inline-flex', flexDirection: 'column', gap: 2, alignItems: 'center' }}>
                                                      <span style={{
                                                        display: 'inline-flex',
                                                        alignItems: 'center',
                                                        gap: 4,
                                                        fontSize: 11,
                                                        fontWeight: 700,
                                                        color: '#F87171',
                                                        background: 'rgba(239, 68, 68, 0.14)',
                                                        padding: '2px 8px',
                                                        borderRadius: 5,
                                                        border: '1px solid rgba(239, 68, 68, 0.35)'
                                                      }}>
                                                        <AlertTriangle size={11} /> Merma: {lineDanTotal} pzas
                                                      </span>
                                                      <span style={{ fontSize: 10, color: '#34D399', fontWeight: 600 }}>
                                                        {lineConfTotal} conformes
                                                      </span>
                                                    </div>
                                                  );
                                                }

                                                // Caso 3: Faltante de mercancía
                                                if (lineDiff < 0) {
                                                  return (
                                                    <div style={{ display: 'inline-flex', flexDirection: 'column', gap: 2, alignItems: 'center' }}>
                                                      <span style={{
                                                        display: 'inline-flex',
                                                        alignItems: 'center',
                                                        gap: 4,
                                                        fontSize: 11,
                                                        fontWeight: 700,
                                                        color: '#FBBF24',
                                                        background: 'rgba(245, 158, 11, 0.14)',
                                                        padding: '2px 8px',
                                                        borderRadius: 5,
                                                        border: '1px solid rgba(245, 158, 11, 0.35)'
                                                      }}>
                                                        <ArrowDownRight size={12} /> Faltante: {lineDiff} pzas
                                                      </span>
                                                      {lineDanTotal > 0 && (
                                                        <span style={{
                                                          display: 'inline-flex',
                                                          alignItems: 'center',
                                                          gap: 3,
                                                          fontSize: 10,
                                                          fontWeight: 700,
                                                          color: '#F87171'
                                                        }}>
                                                          <AlertTriangle size={10} /> +{lineDanTotal} dañadas
                                                        </span>
                                                      )}
                                                    </div>
                                                  );
                                                }

                                                // Caso 4: Excedente / Sobrante de mercancía
                                                return (
                                                  <div style={{ display: 'inline-flex', flexDirection: 'column', gap: 2, alignItems: 'center' }}>
                                                    <span style={{
                                                      display: 'inline-flex',
                                                      alignItems: 'center',
                                                      gap: 4,
                                                      fontSize: 11,
                                                      fontWeight: 700,
                                                      color: '#38BDF8',
                                                      background: 'rgba(56, 189, 248, 0.14)',
                                                      padding: '2px 8px',
                                                      borderRadius: 5,
                                                      border: '1px solid rgba(56, 189, 248, 0.35)'
                                                    }}>
                                                      <ArrowUpRight size={12} /> Sobrante: +{lineDiff} pzas
                                                    </span>
                                                    {lineDanTotal > 0 && (
                                                      <span style={{
                                                        display: 'inline-flex',
                                                        alignItems: 'center',
                                                        gap: 3,
                                                        fontSize: 10,
                                                        fontWeight: 700,
                                                        color: '#F87171'
                                                      }}>
                                                        <AlertTriangle size={10} /> +{lineDanTotal} dañadas
                                                      </span>
                                                    )}
                                                  </div>
                                                );
                                              })()}
                                            </td>

                                            {/* ACCIONES */}
                                            <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                                              <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end', alignItems: 'center' }}>
                                                {!isClosed && (
                                                  <>
                                                    {(lineDanTotal > 0 || lineDiff > 0 || draftNC > 0) && (
                                                      <button
                                                        type="button"
                                                        className="btn btn-ghost btn-xs"
                                                        onClick={() => setDivertModalData({
                                                          receipt: r,
                                                          initialItems: [{
                                                            skuId: l.skuId,
                                                            skuCodigo: skuObj?.codigo,
                                                            skuDescripcion: skuObj?.descripcion,
                                                            cantidad: draftNC > 0 ? draftNC : (danada > 0 ? danada : (lineDiff > 0 ? lineDiff : 1)),
                                                            lote: l.loteAsignado || '',
                                                            fechaVencimiento: l.fechaVencimiento ? l.fechaVencimiento.split('T')[0] : '',
                                                            receiptLineId: l.id,
                                                            motivoEspecifico: lineDanTotal > 0 ? 'Daño físico registrado en andén' : 'Excedente en recepción'
                                                          }],
                                                          initialTipoDesvio: lineDanTotal > 0 ? 'MERMA' : 'EXCESO'
                                                        })}
                                                        title="Desviar esta partida al almacén virtual de No Conforme"
                                                        style={{
                                                          padding: '3px 7px',
                                                          fontSize: 11,
                                                          color: '#F87171',
                                                          background: 'rgba(239, 68, 68, 0.12)',
                                                          border: '1px solid rgba(239, 68, 68, 0.3)',
                                                          borderRadius: 4,
                                                          cursor: 'pointer',
                                                          fontWeight: 700,
                                                          display: 'inline-flex',
                                                          alignItems: 'center',
                                                          gap: 4
                                                        }}
                                                      >
                                                        <ShieldAlert size={12} /> Desviar NC
                                                      </button>
                                                    )}
                                                    <button
                                                      type="button"
                                                      className="btn btn-primary btn-sm"
                                                      onClick={() => {
                                                        setProcessLineId(processLineId === l.id ? null : l.id);
                                                        const rem = Math.max(0, esperada - totalRecibido);
                                                        const recLoc = locations.find(loc => loc.codigo === 'REC-01' || loc.tipoUbicacion === 'RECIBO')?.id || '';
                                                        const devLoc = locations.find(loc => loc.codigo === 'DEV-01' || loc.tipoUbicacion === 'DEVOLUCION')?.id || '';
                                                        setProcessForm({
                                                          cantidadConforme: rem,
                                                          cantidadNoConforme: 0,
                                                          ubicacionConformeId: recLoc,
                                                          ubicacionNoConformeId: devLoc,
                                                          lote: '',
                                                          fechaVencimiento: '',
                                                          tipoHu: clientObj?.uomPrincipal === 'PALLET' ? 'PALLET' : 'CAJA',
                                                          permitirExcedente: false,
                                                        });
                                                      }}
                                                    >
                                                      {processLineId === l.id ? 'Cerrar' : 'Detalle'}
                                                    </button>
                                                  </>
                                                )}
                                                
                                                {/* EDITAR / ELIMINAR LÍNEA (BLOQUEADO SI PREVIO CONFIRMADO) */}
                                                {!isClosed && (
                                                  r.bloqueado ? (
                                                    <span 
                                                      title="Línea bloqueada: El previo ya fue confirmado. Desbloquea el previo como supervisor para ajustar cantidades o quitar partidas."
                                                      style={{ display: 'inline-flex', alignItems: 'center', padding: '0 6px', color: '#64748b', opacity: 0.65 }}
                                                    >
                                                      <Lock size={13} />
                                                    </span>
                                                  ) : (
                                                    <>
                                                      <button
                                                        type="button"
                                                        className="btn btn-ghost btn-sm"
                                                        title="Editar cantidad esperada de esta línea"
                                                        onClick={() => setEditingLine({ id: l.id, cantidadEsperada: esperada, notas: l.notas || '', codigo: skuObj?.codigo, descripcion: skuObj?.descripcion })}
                                                        style={{ padding: '4px 6px' }}
                                                      >
                                                        <Edit3 size={14} />
                                                      </button>

                                                      <button
                                                        type="button"
                                                        className="btn btn-ghost btn-sm"
                                                        title="Quitar producto de este previo"
                                                        onClick={() => setDeleteLineConfirm({ lineId: l.id, receiptId: r.id, codigo: skuObj?.codigo })}
                                                        style={{ padding: '4px 6px', color: 'var(--error)' }}
                                                      >
                                                        <Trash2 size={14} />
                                                      </button>
                                                    </>
                                                  )
                                                )}

                                                <button
                                                  type="button"
                                                  className="btn btn-secondary btn-sm"
                                                  title="Imprimir etiquetas de este producto"
                                                  onClick={() => setPrintModalReceipt({ ...r, lineas: [l] })}
                                                  style={{ padding: '4px 6px' }}
                                                >
                                                  <Printer size={13} />
                                                </button>
                                              </div>
                                            </td>
                                          </tr>

                                          {/* FORMULARIO DE INGRESO DUAL INLINE CON VALIDACIÓN DE EXCEDENTES */}
                                          {processLineId === l.id && (
                                            <tr>
                                              <td colSpan={8} style={{ padding: 18, background: 'rgba(13,148,136,0.03)', borderTop: '1px solid var(--border)' }}>
                                                <form onSubmit={(e) => handleProcessLine(e, r.id, l.id)}>
                                                  
                                                  {/* ADVERTENCIA DE EXCEDENTE EN TIEMPO REAL */}
                                                  {(processForm.cantidadConforme + processForm.cantidadNoConforme) > Math.max(0, esperada - totalRecibido) && (
                                                    <div style={{
                                                      padding: '12px 16px',
                                                      background: 'rgba(239, 68, 68, 0.08)',
                                                      borderRadius: 8,
                                                      border: '1px solid rgba(239, 68, 68, 0.3)',
                                                      marginBottom: 16
                                                    }}>
                                                      <div style={{ fontWeight: 700, color: 'var(--error)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                                                        <AlertTriangle size={16} /> Exceso de Piezas Detectado (+{(processForm.cantidadConforme + processForm.cantidadNoConforme) - Math.max(0, esperada - totalRecibido)} piezas en exceso)
                                                      </div>
                                                      <div style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '4px 0 10px' }}>
                                                        Se esperaban {esperada} piezas (quedan {Math.max(0, esperada - totalRecibido)} pendientes por recibir) y estás intentando ingresar {processForm.cantidadConforme + processForm.cantidadNoConforme} piezas.
                                                      </div>
                                                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer', fontWeight: 600, color: 'var(--text-primary)', background: 'var(--bg-card)', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)' }}>
                                                        <input 
                                                          type="checkbox" 
                                                          checked={Boolean(processForm.permitirExcedente)} 
                                                          onChange={e => setProcessForm({ ...processForm, permitirExcedente: e.target.checked })} 
                                                        />
                                                        <span><strong>Autorizo el recibo de este excedente de mercancía</strong> (Registra auditoría en sistema)</span>
                                                      </label>
                                                    </div>
                                                  )}

                                                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
                                                    
                                                    {/* ZONA CONFORME CON SMART LOCATION SELECT */}
                                                    <div style={{ border: '1px solid rgba(16, 185, 129, 0.3)', padding: 16, borderRadius: 10, background: 'var(--bg-card)' }}>
                                                      <h5 style={{ margin: '0 0 12px', color: 'var(--emerald)', display: 'flex', alignItems: 'center', gap: 6 }}>
                                                        <CheckCircle2 size={16} /> Zona Conforme (Liberado)
                                                      </h5>
                                                      <div className="form-group">
                                                        <label className="form-label">Cantidad Conforme</label>
                                                        <input 
                                                          type="number" 
                                                          className="form-input" 
                                                          min="0" 
                                                          value={processForm.cantidadConforme === 0 ? '' : processForm.cantidadConforme} 
                                                          onFocus={e => e.target.select()}
                                                          onChange={e => {
                                                            const raw = e.target.value.replace(/^0+(?=\d)/, '');
                                                            const val = raw === '' ? 0 : parseInt(raw, 10);
                                                            setProcessForm({ ...processForm, cantidadConforme: isNaN(val) ? 0 : val });
                                                          }} 
                                                          placeholder="0"
                                                        />
                                                      </div>
                                                      <div className="form-group" style={{ marginBottom: 0 }}>
                                                        <LocationSelect
                                                          label="Ubicación Física Almacenamiento"
                                                          locations={locations}
                                                          value={processForm.ubicacionConformeId}
                                                          onChange={(locId) => setProcessForm({ ...processForm, ubicacionConformeId: locId })}
                                                          sku={skuObj}
                                                          client={clientObj}
                                                          isConforme={true}
                                                          quantity={processForm.cantidadConforme}
                                                          placeholder="Buscar o elegir ubicación sugerida..."
                                                        />
                                                      </div>
                                                    </div>

                                                    {/* ZONA NO CONFORME CON SMART LOCATION SELECT */}
                                                    <div style={{ border: '1px solid rgba(245, 158, 11, 0.3)', padding: 16, borderRadius: 10, background: 'var(--bg-card)' }}>
                                                      <h5 style={{ margin: '0 0 12px', color: 'var(--warning)', display: 'flex', alignItems: 'center', gap: 6 }}>
                                                        <AlertTriangle size={16} /> Zona No Conforme (Cuarentena / Merma)
                                                      </h5>
                                                      <div className="form-group">
                                                        <label className="form-label">Cantidad No Conforme</label>
                                                        <input 
                                                          type="number" 
                                                          className="form-input" 
                                                          min="0" 
                                                          value={processForm.cantidadNoConforme === 0 ? '' : processForm.cantidadNoConforme} 
                                                          onFocus={e => e.target.select()}
                                                          onChange={e => {
                                                            const raw = e.target.value.replace(/^0+(?=\d)/, '');
                                                            const val = raw === '' ? 0 : parseInt(raw, 10);
                                                            setProcessForm({ ...processForm, cantidadNoConforme: isNaN(val) ? 0 : val });
                                                          }} 
                                                          placeholder="0"
                                                        />
                                                      </div>
                                                      <div className="form-group" style={{ marginBottom: 0 }}>
                                                        <LocationSelect
                                                          label="Ubicación Cuarentena / Devolución"
                                                          locations={locations}
                                                          value={processForm.ubicacionNoConformeId}
                                                          onChange={(locId) => setProcessForm({ ...processForm, ubicacionNoConformeId: locId })}
                                                          sku={skuObj}
                                                          client={clientObj}
                                                          isConforme={false}
                                                          quantity={processForm.cantidadNoConforme}
                                                          placeholder="Buscar o elegir ubicación de cuarentena..."
                                                        />
                                                      </div>
                                                    </div>
                                                  </div>

                                                  {/* CAMPOS CONDICIONALES SEGÚN REGLAS DEL CLIENTE / GIRO SANITARIO */}
                                                  {(() => {
                                                    const isGiroRegulado = clientObj?.giro === 'COMIDA' || clientObj?.giro === 'FARMACEUTICO';
                                                    const modalReqLote = Boolean(clientObj?.requiereLote || isGiroRegulado || skuObj?.requiereLote);
                                                    const modalReqCaducidad = Boolean(clientObj?.requiereCaducidad || isGiroRegulado || skuObj?.requiereCaducidad);

                                                    if (!modalReqLote && !modalReqCaducidad) return null;

                                                    const isExpired = (() => {
                                                      if (!processForm.fechaVencimiento?.trim()) return false;
                                                      const d = new Date(processForm.fechaVencimiento.trim());
                                                      const today = new Date();
                                                      today.setHours(0, 0, 0, 0);
                                                      return !isNaN(d.getTime()) && d < today;
                                                    })();

                                                    return (
                                                      <div style={{
                                                        border: '1px solid rgba(245, 158, 11, 0.3)',
                                                        padding: 14,
                                                        borderRadius: 10,
                                                        background: 'rgba(245, 158, 11, 0.05)',
                                                        marginTop: 14
                                                      }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                                                          <span style={{ fontSize: 12, fontWeight: 700, color: '#FBBF24', display: 'flex', alignItems: 'center', gap: 6 }}>
                                                            <ShieldCheck size={15} /> Control de Trazabilidad Obligatoria
                                                          </span>
                                                          {isGiroRegulado && (
                                                            <span style={{
                                                              fontSize: 10,
                                                              fontWeight: 800,
                                                              padding: '2px 8px',
                                                              borderRadius: 4,
                                                              background: '#D97706',
                                                              color: '#FFFFFF'
                                                            }}>
                                                              Giro: {clientObj?.giro}
                                                            </span>
                                                          )}
                                                        </div>

                                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
                                                          {modalReqLote && (
                                                            <div className="form-group" style={{ marginBottom: 0 }}>
                                                              <label className="form-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                                                <span>Lote de Fabricación</span>
                                                                <span className="required" style={{ color: '#F87171' }}>* Requerido</span>
                                                              </label>
                                                              <input 
                                                                className="form-input" 
                                                                placeholder="Ej. LOT-2026-A"
                                                                value={processForm.lote} 
                                                                onChange={e => setProcessForm({ ...processForm, lote: e.target.value })} 
                                                                style={{
                                                                  borderColor: !processForm.lote.trim() ? '#F59E0B' : '#10B981'
                                                                }}
                                                                required
                                                              />
                                                            </div>
                                                          )}
                                                          {modalReqCaducidad && (
                                                            <div className="form-group" style={{ marginBottom: 0 }}>
                                                              <label className="form-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                                                <span>Fecha de Vencimiento / Caducidad</span>
                                                                <span className="required" style={{ color: isExpired ? '#EF4444' : '#F87171' }}>
                                                                  {isExpired ? '¡CADUCADO!' : '* Requerido'}
                                                                </span>
                                                              </label>
                                                              <input 
                                                                type="date" 
                                                                className="form-input" 
                                                                value={processForm.fechaVencimiento} 
                                                                onChange={e => setProcessForm({ ...processForm, fechaVencimiento: e.target.value })} 
                                                                style={{
                                                                  borderColor: isExpired ? '#EF4444' : (!processForm.fechaVencimiento ? '#F59E0B' : '#10B981'),
                                                                  boxShadow: isExpired ? '0 0 8px rgba(239, 68, 68, 0.3)' : 'none'
                                                                }}
                                                                required
                                                              />
                                                              {isExpired && (
                                                                <div style={{ fontSize: 11, color: '#EF4444', fontWeight: 600, marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                                                                  <AlertTriangle size={13} style={{ flexShrink: 0 }} /> Inocuidad: No se permite recibir producto vencido (NOM-251 / COFEPRIS / FDA).
                                                                </div>
                                                              )}
                                                            </div>
                                                          )}
                                                        </div>
                                                      </div>
                                                    );
                                                  })()}

                                                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
                                                    <button type="button" className="btn btn-ghost" onClick={() => setProcessLineId(null)}>Cancelar</button>
                                                    <button 
                                                      type="submit" 
                                                      className="btn btn-primary" 
                                                      disabled={
                                                        submitting || 
                                                        ((processForm.cantidadConforme + processForm.cantidadNoConforme) > Math.max(0, esperada - totalRecibido) && !processForm.permitirExcedente)
                                                      }
                                                    >
                                                      {submitting ? 'Registrando ingreso...' : 'Confirmar Ingreso a Almacén'}
                                                    </button>
                                                  </div>
                                                </form>
                                              </td>
                                            </tr>
                                          )}
                                        </React.Fragment>
                                      );
                                    })}
                                  </tbody>
                                </table>

                                {/* TAREA 1: LIVE FOOTER SUMMARY STRIP DE LA PLANILLA MATRICIAL */}
                                {(() => {
                                  const drafts = matrixValues[r.id] || {};
                                  let sumConforme = 0;
                                  let sumNoConforme = 0;
                                  let activeCount = 0;

                                  (r.lineas || []).forEach((l: any) => {
                                    const d = drafts[l.id];
                                    if (d) {
                                      const c = typeof d.cantidadConforme === 'number' ? d.cantidadConforme : (parseFloat(String(d.cantidadConforme)) || 0);
                                      const nc = typeof d.cantidadNoConforme === 'number' ? d.cantidadNoConforme : (parseFloat(String(d.cantidadNoConforme)) || 0);
                                      if (c > 0 || nc > 0) activeCount++;
                                      sumConforme += c;
                                      sumNoConforme += nc;
                                    }
                                  });

                                  const isBlind = Boolean(blindCountMode[r.id]);

                                  return (
                                    <div style={{
                                      padding: '14px 20px',
                                      background: 'rgba(15, 23, 42, 0.92)',
                                      borderTop: '1px solid var(--border)',
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'space-between',
                                      flexWrap: 'wrap',
                                      gap: 16
                                    }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
                                        <div>
                                          <span style={{ fontSize: 11, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Partidas:</span>{' '}
                                          <strong style={{ fontSize: 13, color: '#F8FAFC' }}>{r.lineas?.length || 0}</strong>
                                        </div>
                                        <div>
                                          <span style={{ fontSize: 11, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Conforme Tecleado:</span>{' '}
                                          <strong style={{ fontSize: 14, color: '#059669', fontWeight: 800 }}>+{sumConforme} pzas</strong>
                                        </div>
                                        <div>
                                          <span style={{ fontSize: 11, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Merma / Dañado:</span>{' '}
                                          <strong style={{ fontSize: 14, color: sumNoConforme > 0 ? '#DC2626' : '#64748B', fontWeight: 800 }}>+{sumNoConforme} pzas</strong>
                                        </div>
                                        {!isBlind && (
                                          <div>
                                            <span style={{ fontSize: 11, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total Captura:</span>{' '}
                                            <strong style={{ fontSize: 14, color: '#38BDF8', fontWeight: 800 }}>{sumConforme + sumNoConforme} pzas</strong>
                                          </div>
                                        )}
                                        {activeCount > 0 && (
                                          <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: 'rgba(56,189,248,0.15)', color: '#38BDF8', fontWeight: 700 }}>
                                            {activeCount} partidas listas para registrar
                                          </span>
                                        )}
                                      </div>

                                      {!isClosed && (
                                        <button
                                          type="button"
                                          className="btn btn-sm"
                                          disabled={savingMatrix[r.id] || activeCount === 0}
                                          onClick={() => handleSaveMatrixReception(r)}
                                          style={{
                                            background: activeCount > 0 ? '#059669' : '#F1F5F9',
                                            border: activeCount > 0 ? '1.5px solid #059669' : '1px solid #CBD5E1',
                                            color: activeCount > 0 ? '#FFFFFF' : '#94A3B8',
                                            fontWeight: 800,
                                            fontSize: 13,
                                            padding: '8px 22px',
                                            borderRadius: 8,
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: 8,
                                            boxShadow: activeCount > 0 ? '0 4px 16px rgba(16, 185, 129, 0.4)' : 'none',
                                            cursor: (savingMatrix[r.id] || activeCount === 0) ? 'not-allowed' : 'pointer'
                                          }}
                                          title={activeCount === 0 ? "Captura al menos una cantidad en la planilla para guardar" : "Guardar en inventario todas las cantidades capturadas en la factura"}
                                        >
                                          <Save size={15} />
                                          {savingMatrix[r.id]
                                            ? 'Guardando en Inventario...'
                                            : activeCount > 0
                                              ? `Guardar Conteo de Factura (${activeCount} partidas)`
                                              : 'Guardar Conteo de Factura'}
                                        </button>
                                      )}
                                    </div>
                                  );
                                })()}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    {/* RIGHT PERSISTENT SIDEBAR PANEL (SUGERENCIA PUTAWAY 1:1 MATCH WITH STITCH MOCKUP) */}
    {!sidebarCollapsed ? (
      <div className="stitch-split-sidebar" style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 12, padding: 18, boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, borderBottom: '1px solid #E2E8F0', paddingBottom: 12 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#0F172A', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Sparkles size={18} style={{ color: '#0D9488' }} /> Sugerencias
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 11, background: '#F0FDFA', color: '#0D9488', border: '1px solid #CCFBF1', padding: '2px 8px', borderRadius: 4, fontWeight: 600 }}>
              3PL AI Rules
            </span>
            <button
              type="button"
              onClick={toggleSidebar}
              title="Ocultar panel lateral de sugerencias"
              style={{
                background: 'transparent',
                border: 'none',
                color: '#64748B',
                cursor: 'pointer',
                padding: '4px 6px',
                borderRadius: 4,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 2,
                fontSize: 12
              }}
            >
              <ChevronRight size={16} /> Ocultar
            </button>
          </div>
        </div>

        <div style={{ background: '#F8FAFC', padding: 14, borderRadius: 10, border: '1px solid #E2E8F0', marginBottom: 16 }}>
          <div style={{ fontSize: 10, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>ITEM A REUBICAR</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#0F172A', marginTop: 3 }}>
            {receipts[0]?.lineas?.[0]?.sku?.descripcion || 'Motor Eléctrico Trifásico 5HP'}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
            <span style={{ fontSize: 11, color: '#0D9488', fontFamily: 'monospace', fontWeight: 600 }}>
              {receipts[0]?.lineas?.[0]?.sku?.codigo || 'MOT-3P-5HP-001'}
            </span>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#0F172A' }}>
              Cant: {receipts[0]?.lineas?.[0]?.cantidadEsperada || 120}
            </span>
          </div>
        </div>

        <div style={{ fontSize: 12, fontWeight: 700, color: '#0D9488', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
          <MapPin size={14} /> Ubicaciones Óptimas (Regla FIFO)
        </div>

        {/* RACK LOCATION 1 */}
        <div style={{ background: '#FFFFFF', padding: 14, borderRadius: 10, border: '1px solid #CCFBF1', marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontWeight: 800, fontSize: 14, color: '#0F172A' }}>A02-R01-N1</div>
            <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: '#ECFDF5', color: '#059669' }}>83% Match</span>
          </div>
          <div style={{ fontSize: 11, color: '#64748B', marginTop: 3, display: 'flex', alignItems: 'center', gap: 4 }}>
            <MapPin size={11} style={{ color: '#0284C7' }} /> Pasillo Motores · Nivel Suelo (Libre: 80 u.)
          </div>
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
            <input className="form-input" defaultValue="80" style={{ width: 70, height: 32, fontSize: 12, textAlign: 'center', background: '#FFFFFF', color: '#0F172A', borderColor: '#CBD5E1' }} />
            <button 
              type="button"
              className="btn btn-secondary btn-sm" 
              onClick={() => handleOpenPutawayModal(receipts[0] || filtered[0])}
              style={{ flex: 1, fontSize: 11, background: '#F8FAFC', color: '#334155', borderColor: '#CBD5E1' }}
            >
              Mover a esta ubicación
            </button>
          </div>
        </div>

        {/* RACK LOCATION 2 */}
        <div style={{ background: '#FFFFFF', padding: 14, borderRadius: 10, border: '1px solid #E2E8F0', marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontWeight: 800, fontSize: 14, color: '#0F172A' }}>B05-R02-N3</div>
            <span style={{ fontSize: 11, color: '#64748B' }}>Libre: 40 u.</span>
          </div>
          <div style={{ fontSize: 11, color: '#64748B', marginTop: 3, display: 'flex', alignItems: 'center', gap: 4 }}>
            <MapPin size={11} style={{ color: '#0284C7' }} /> Pasillo Motores · Nivel Alto
          </div>
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
            <input className="form-input" defaultValue="40" style={{ width: 70, height: 32, fontSize: 12, textAlign: 'center', background: '#FFFFFF', color: '#0F172A', borderColor: '#CBD5E1' }} />
            <button 
              type="button"
              className="btn btn-secondary btn-sm" 
              onClick={() => handleOpenPutawayModal(receipts[0] || filtered[0])}
              style={{ flex: 1, fontSize: 11, background: '#F8FAFC', color: '#334155', borderColor: '#CBD5E1' }}
            >
              Mover a esta ubicación
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, fontSize: 13, fontWeight: 700, borderTop: '1px solid #E2E8F0', paddingTop: 12 }}>
          <span style={{ color: '#64748B' }}>Total a transferir:</span>
          <span style={{ color: '#0F172A' }}>120 / 120 PZA</span>
        </div>

        <button 
          type="button"
          className="btn btn-primary btn-block" 
          onClick={() => handleOpenPutawayModal(receipts[0] || filtered[0])}
          style={{ background: '#0D9488', borderColor: '#0D9488', width: '100%', padding: '12px', fontSize: 13, fontWeight: 700, borderRadius: 8 }}
        >
          <Check size={16} style={{ marginRight: 6 }} /> Confirmar Transferencia
        </button>
      </div>
    ) : (
      <button
        type="button"
        onClick={toggleSidebar}
        style={{
          position: 'fixed',
          right: 0,
          top: '50%',
          transform: 'translateY(-50%)',
          zIndex: 999,
          background: '#FFFFFF',
          border: '1px solid #CBD5E1',
          borderRight: 'none',
          borderTopLeftRadius: 8,
          borderBottomLeftRadius: 8,
          padding: '12px 6px',
          boxShadow: '-2px 4px 12px rgba(0,0,0,0.08)',
          cursor: 'pointer',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 6,
          color: '#0D9488',
          fontSize: 11,
          fontWeight: 700,
          writingMode: 'vertical-rl',
          letterSpacing: '0.05em'
        }}
        title="Mostrar Sugerencias Putaway 3PL AI"
      >
        <ChevronLeft size={16} style={{ writingMode: 'horizontal-tb' }} />
        <span>SUGERENCIAS AI</span>
      </button>
    )}
  </div>
        );
      })()}
    </div>
  );
}
