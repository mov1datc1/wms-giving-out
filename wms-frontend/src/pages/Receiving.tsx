import React, { useEffect, useState, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { API } from '../config/api';
import {
  ClipboardList, Search, RefreshCw, Check, Clock, AlertCircle,
  ChevronDown, ChevronUp, Plus, X, Package, MapPin, Truck, UploadCloud,
  FileSpreadsheet, Download, CheckCircle2, AlertTriangle, FileText, Sparkles,
  Printer, QrCode, Scan, ArrowRight, Tag, Box, CheckSquare, ShieldCheck,
  UserCheck, Layers
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { LocationSelect } from '../components/LocationSelect';
import { ReceiptPrintModal } from '../components/ReceiptPrintModal';

interface PrevioForm {
  clienteId: string;
  proveedorId: string;
  origen: string;
  lineaTransporte: string;
  placa: string;
  nombreChofer: string;
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
}

interface ParsedLine {
  rowNum: number;
  factura: string;
  codeOrEan: string;
  cantidadEsperada: number;
  sku?: any;
  status: 'MATCHED' | 'NOT_FOUND' | 'INVALID_QTY';
}

interface ExcelAnalysis {
  fileName: string;
  totalRows: number;
  matchedRows: number;
  unmatchedCodes: string[];
  detectedFactura: string;
  lines: ParsedLine[];
}

export function Receiving() {
  const { token, user } = useAuth();
  const [receipts, setReceipts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterEstado, setFilterEstado] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  // Catalogs
  const [clients, setClients] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [skus, setSkus] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [warehouse, setWarehouse] = useState<any>(null);

  // Forms State
  const [showNewPrevio, setShowNewPrevio] = useState(false);
  const [newPrevio, setNewPrevio] = useState<PrevioForm>({
    clienteId: '', proveedorId: '', origen: 'NACIONAL',
    lineaTransporte: '', placa: '', nombreChofer: '', ocReferencia: '', notas: ''
  });
  const [file, setFile] = useState<File | null>(null);
  const [excelAnalysis, setExcelAnalysis] = useState<ExcelAnalysis | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Print Modal State
  const [printModalReceipt, setPrintModalReceipt] = useState<any | null>(null);
  const [generatingBarcodes, setGeneratingBarcodes] = useState<string | null>(null);

  // Close Receipt & Report Modal State
  const [closingReceipt, setClosingReceipt] = useState<any | null>(null);
  const [closingNotes, setClosingNotes] = useState('');
  const [reportModalReceipt, setReportModalReceipt] = useState<any | null>(null);
  const [reportData, setReportData] = useState<any | null>(null);
  const [loadingReport, setLoadingReport] = useState(false);

  // Handheld Scanner State
  const [scannerQuery, setScannerQuery] = useState('');
  const [scannerMsg, setScannerMsg] = useState({ type: '', text: '' });
  const scannerInputRef = useRef<HTMLInputElement>(null);

  const [processLineId, setProcessLineId] = useState<string | null>(null);
  const [processForm, setProcessForm] = useState<ProcessLineForm>({
    cantidadConforme: 0, cantidadNoConforme: 0,
    ubicacionConformeId: '', ubicacionNoConformeId: '',
    lote: '', fechaVencimiento: '', tipoHu: 'CAJA'
  });

  const [submitting, setSubmitting] = useState(false);
  const [formMsg, setFormMsg] = useState({ type: '', text: '' });

  const headers: any = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  useEffect(() => { loadData(); }, []);

  // Re-analizar el archivo si el usuario cambia de cliente
  useEffect(() => {
    if (file && newPrevio.clienteId) {
      parseAndAnalyzeExcel(file, newPrevio.clienteId);
    }
  }, [newPrevio.clienteId]);

  async function loadData() {
    setLoading(true);
    try {
      const [receiptsRes, clientsRes, suppliersRes, skusRes, locationsRes, warehousesRes] = await Promise.all([
        fetch(`${API}/receipts`, { headers }),
        fetch(`${API}/clients`, { headers }),
        fetch(`${API}/suppliers`, { headers }),
        fetch(`${API}/skus`, { headers }),
        fetch(`${API}/locations`, { headers }),
        fetch(`${API}/warehouses`, { headers }),
      ]);
      if (receiptsRes.ok) setReceipts(await receiptsRes.json());
      if (clientsRes.ok) setClients(await clientsRes.json());
      if (suppliersRes.ok) setSuppliers(await suppliersRes.json());
      if (skusRes.ok) setSkus(await skusRes.json());
      if (locationsRes.ok) setLocations(await locationsRes.json());
      if (warehousesRes.ok) {
        const whs = await warehousesRes.json();
        if (whs.length > 0) setWarehouse(whs[0]);
      }
    } catch (err) { console.error(err); }
    setLoading(false);
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
        text: `⚡ ${data.message}`
      });

      await loadData();
    } catch (err: any) {
      setFormMsg({ type: 'error', text: err.message });
    }
    setGeneratingBarcodes(null);
  }

  // --- OBTENER Y ABRIR REPORTE DE CIERRE ---
  async function handleOpenReport(receipt: any) {
    setReportModalReceipt(receipt);
    setLoadingReport(true);
    try {
      const res = await fetch(`${API}/receipts/${receipt.id}/report`, { headers });
      if (res.ok) {
        const data = await res.json();
        setReportData(data);
      } else {
        // Fallback local calculation
        calculateLocalReport(receipt);
      }
    } catch (err) {
      calculateLocalReport(receipt);
    }
    setLoadingReport(false);
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

  // --- FINALIZAR Y CERRAR RECEPCIÓN ---
  async function handleCloseReceiptSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!closingReceipt) return;
    setSubmitting(true);
    try {
      const res = await fetch(`${API}/receipts/${closingReceipt.id}/close`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          usuario: user?.email || 'Supervisor Giving Out',
          notasCierre: closingNotes,
        })
      });

      if (!res.ok) throw new Error((await res.json()).message || 'Error al cerrar la recepción');

      setFormMsg({ type: 'success', text: `🏁 Recepción ${closingReceipt.codigo} finalizada y cerrada oficialmente.` });
      const targetReceipt = closingReceipt;
      setClosingReceipt(null);
      setClosingNotes('');
      await loadData();
      
      // Abrir reporte de cierre automáticamente
      handleOpenReport(targetReceipt);
    } catch (err: any) {
      setFormMsg({ type: 'error', text: err.message });
    }
    setSubmitting(false);
  }

  // --- PARSER DE EXCEL ---
  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      setFile(selectedFile);
      if (newPrevio.clienteId) {
        parseAndAnalyzeExcel(selectedFile, newPrevio.clienteId);
      }
    }
  }

  function parseAndAnalyzeExcel(fileObj: File, clienteId: string) {
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

        const clientSkus = skus.filter(s => s.clienteId === clienteId);
        const parsedLines: ParsedLine[] = [];
        const unmatchedCodes: string[] = [];
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

          const matchedSku = clientSkus.find(s => 
            (s.codigo && s.codigo.toLowerCase() === rowCodeOrEan.toLowerCase()) ||
            (s.codigoBarras && s.codigoBarras.toLowerCase() === rowCodeOrEan.toLowerCase())
          );

          let status: 'MATCHED' | 'NOT_FOUND' | 'INVALID_QTY' = 'MATCHED';
          if (!matchedSku) {
            status = 'NOT_FOUND';
            if (rowCodeOrEan && !unmatchedCodes.includes(rowCodeOrEan)) {
              unmatchedCodes.push(rowCodeOrEan);
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
            status
          });
        });

        if (!newPrevio.ocReferencia && detectedFactura) {
          setNewPrevio(prev => ({ ...prev, ocReferencia: detectedFactura }));
        }

        setExcelAnalysis({
          fileName: fileObj.name,
          totalRows: parsedLines.length,
          matchedRows: parsedLines.filter(l => l.status === 'MATCHED').length,
          unmatchedCodes,
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
    const templateData = [
      { factura: 'FAC-2026-001', Ean: 'CAM-S-BLA', 'Cantidad a recibir': 120, Descripcion: 'Camiseta Básica Blanca Talla S' },
      { factura: 'FAC-2026-001', Ean: '7501234567890', 'Cantidad a recibir': 60, Descripcion: 'Aceite de Oliva Extra Virgen 500ml' },
      { factura: 'FAC-2026-001', Ean: 'PAN-30-NEG', 'Cantidad a recibir': 45, Descripcion: 'Pantalón Mezclilla Negro T30' }
    ];

    const ws = XLSX.utils.json_to_sheet(templateData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'PrevioRecibo');
    XLSX.writeFile(wb, 'Plantilla_Previo_Recibo_GivingOut.xlsx');
  }

  // --- CREAR PREVIO ---
  async function handleCreatePrevio(e: React.FormEvent) {
    e.preventDefault();
    setFormMsg({ type: '', text: '' });

    if (!newPrevio.clienteId) {
      setFormMsg({ type: 'error', text: 'Selecciona el cliente depositante' });
      return;
    }

    if (!excelAnalysis || excelAnalysis.lines.length === 0) {
      setFormMsg({ type: 'error', text: 'Debes cargar un archivo Excel con líneas válidas' });
      return;
    }

    const validLines = excelAnalysis.lines
      .filter(l => l.status === 'MATCHED' && l.sku)
      .map(l => ({
        skuId: l.sku.id,
        cantidadEsperada: l.cantidadEsperada,
        notas: l.factura ? `Factura/OC: ${l.factura}` : undefined
      }));

    if (validLines.length === 0) {
      setFormMsg({ type: 'error', text: 'Ninguna línea del Excel coincide con los SKUs del cliente seleccionado' });
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        clienteId: newPrevio.clienteId,
        proveedorId: newPrevio.proveedorId || undefined,
        origen: newPrevio.origen,
        lineaTransporte: newPrevio.lineaTransporte,
        placa: newPrevio.placa,
        nombreChofer: newPrevio.nombreChofer,
        ocReferencia: newPrevio.ocReferencia,
        notas: newPrevio.notas,
        archivoPrevioUrl: excelAnalysis.fileName,
        recibidoPor: user?.email || 'admin',
        lineas: validLines
      };

      const res = await fetch(`${API}/receipts`, {
        method: 'POST', 
        headers, 
        body: JSON.stringify(payload)
      });
      
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.message || 'Error al crear el Previo de Recibo');
      }

      setFormMsg({ type: 'success', text: `¡Previo creado exitosamente con ${validLines.length} líneas!` });
      loadData();
      setTimeout(() => { 
        setShowNewPrevio(false); 
        setFile(null); 
        setExcelAnalysis(null);
        setNewPrevio({
          clienteId: '', proveedorId: '', origen: 'NACIONAL',
          lineaTransporte: '', placa: '', nombreChofer: '', ocReferencia: '', notas: ''
        });
        setFormMsg({ type: '', text: '' }); 
      }, 1800);
    } catch (err: any) {
      setFormMsg({ type: 'error', text: err.message });
    }
    setSubmitting(false);
  }

  // --- PROCESAR RECEPCION DUAL ---
  async function handleProcessLine(e: React.FormEvent, receiptId: string, lineId: string) {
    e.preventDefault();
    setFormMsg({ type: '', text: '' });
    
    if (processForm.cantidadConforme <= 0 && processForm.cantidadNoConforme <= 0) {
      setFormMsg({ type: 'error', text: 'Debes ingresar al menos una cantidad (Conforme o No Conforme)' });
      return;
    }
    if (processForm.cantidadConforme > 0 && !processForm.ubicacionConformeId) {
      setFormMsg({ type: 'error', text: 'Selecciona una ubicación física para la Zona Conforme' });
      return;
    }
    if (processForm.cantidadNoConforme > 0 && !processForm.ubicacionNoConformeId) {
      setFormMsg({ type: 'error', text: 'Selecciona una ubicación física para la Zona No Conforme' });
      return;
    }

    const rec = receipts.find(r => r.id === receiptId);
    const line = rec?.lineas.find((l: any) => l.id === lineId);
    const clientObj = clients.find(c => c.id === rec?.clienteId) || rec?.cliente;

    // Validación estricta según parametrización del depositante
    if (clientObj?.requiereLote && !processForm.lote.trim()) {
      setFormMsg({ type: 'error', text: `⚠️ El Lote es OBLIGATORIO para el depositante ${clientObj.nombreComercial}.` });
      return;
    }
    if (clientObj?.requiereCaducidad && !processForm.fechaVencimiento) {
      setFormMsg({ type: 'error', text: `⚠️ La Fecha de Caducidad es OBLIGATORIA para el depositante ${clientObj.nombreComercial}.` });
      return;
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
      setScannerMsg({ type: 'success', text: `✅ Producto escaneado: ${matchedLine.sku?.codigo} — ${matchedLine.sku?.descripcion}` });
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
        tipoHu: clientObj?.uomPrincipal === 'PALLET' ? 'PALLET' : 'CAJA'
      });
      setScannerQuery('');
    } else {
      setScannerMsg({ type: 'error', text: `⚠️ Código "${scannerQuery}" no encontrado en este previo de recibo.` });
    }
  }

  // Helpers
  const filtered = receipts.filter(r => {
    const term = search.toLowerCase();
    const matchSearch = !search || 
      r.codigo?.toLowerCase().includes(term) || 
      r.ocReferencia?.toLowerCase().includes(term) ||
      r.cliente?.nombreComercial?.toLowerCase().includes(term) ||
      r.nombreChofer?.toLowerCase().includes(term) ||
      r.placa?.toLowerCase().includes(term);
    const matchEstado = !filterEstado || r.estado === filterEstado;
    return matchSearch && matchEstado;
  });

  const estadoBadge = (estado: string) => {
    if (estado === 'CERRADO') return 'default';
    if (estado === 'COMPLETO') return 'success';
    if (estado === 'EN_PROCESO') return 'warning';
    return 'info';
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Previos de Recibo & Entrada (3PL)</h1>
          <p className="page-subtitle">Ingesta de ASN/Excel, validación física dual, códigos EAN-13, impresión térmica y reporte oficial de cierre</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" onClick={() => { setShowNewPrevio(true); setFormMsg({ type: '', text: '' }); }}>
            <UploadCloud size={16} /> Cargar Previo (ASN)
          </button>
          <button className="btn btn-secondary" onClick={loadData}><RefreshCw size={16} /> Actualizar</button>
        </div>
      </div>

      {/* --- NOTIFICACIÓN GLOBAL --- */}
      {formMsg.text && (
        <div className={`form-message ${formMsg.type === 'error' ? 'form-error-msg' : 'form-success-msg'}`} style={{ marginBottom: 16 }}>
          {formMsg.text}
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
              {/* SELECCIÓN DE CLIENTE Y METADATOS */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14, marginBottom: 16 }}>
                <div className="form-group">
                  <label className="form-label">Cliente Depositante <span className="required">*</span></label>
                  <select 
                    className="form-select form-select-full" 
                    value={newPrevio.clienteId} 
                    onChange={e => setNewPrevio({ ...newPrevio, clienteId: e.target.value })} 
                    required
                  >
                    <option value="">Seleccionar depositante...</option>
                    {clients.map(c => (
                      <option key={c.id} value={c.id}>{c.nombreComercial} ({c.giro || '3PL'})</option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Factura / Orden de Compra (OC)</label>
                  <input 
                    className="form-input" 
                    placeholder="Ej. FAC-2026-9901" 
                    value={newPrevio.ocReferencia} 
                    onChange={e => setNewPrevio({ ...newPrevio, ocReferencia: e.target.value })} 
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Origen de Mercancía</label>
                  <select 
                    className="form-select form-select-full" 
                    value={newPrevio.origen} 
                    onChange={e => setNewPrevio({ ...newPrevio, origen: e.target.value })}
                  >
                    <option value="NACIONAL">Nacional</option>
                    <option value="IMPORTACION">Importación (Pedimento / Aduana)</option>
                  </select>
                </div>
              </div>

              {/* DATOS DE TRANSPORTE */}
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

              {/* ZONA DE CARGA DE ARCHIVO EXCEL */}
              <div style={{
                border: '2px dashed var(--border)',
                borderRadius: 10,
                padding: '24px 20px',
                textAlign: 'center',
                background: file ? 'rgba(13,148,136,0.03)' : 'var(--bg-card)',
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
                  <div style={{ width: 44, height: 44, borderRadius: 10, background: 'rgba(13,148,136,0.1)', color: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <FileSpreadsheet size={24} />
                  </div>
                  
                  {file ? (
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{file.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{(file.size / 1024).toFixed(1)} KB</div>
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
                      <div style={{ fontWeight: 600, fontSize: 14 }}>Arrastra tu archivo Excel o haz clic aquí</div>
                      <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>Formatos soportados: .xlsx, .xls</div>
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

              {/* RESUMEN DEL ANÁLISIS DE EXCEL */}
              {excelAnalysis && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 12 }}>
                    <div style={{ padding: '10px 14px', background: 'var(--bg-secondary)', borderRadius: 8, border: '1px solid var(--border)' }}>
                      <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Líneas Leídas</div>
                      <div style={{ fontSize: 18, fontWeight: 700 }}>{excelAnalysis.totalRows}</div>
                    </div>
                    <div style={{ padding: '10px 14px', background: 'rgba(16,185,129,0.08)', borderRadius: 8, border: '1px solid rgba(16,185,129,0.3)' }}>
                      <div style={{ fontSize: 11, color: 'var(--emerald)' }}>SKUs Válidos Coincidentes</div>
                      <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--emerald)' }}>{excelAnalysis.matchedRows}</div>
                    </div>
                    {excelAnalysis.unmatchedCodes.length > 0 && (
                      <div style={{ padding: '10px 14px', background: 'rgba(239,68,68,0.08)', borderRadius: 8, border: '1px solid rgba(239,68,68,0.3)' }}>
                        <div style={{ fontSize: 11, color: 'var(--error)' }}>No Registrados</div>
                        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--error)' }}>{excelAnalysis.unmatchedCodes.length}</div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="modal-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <button type="button" className="btn btn-ghost btn-sm" onClick={handleDownloadTemplate}>
                  <Download size={14} /> Descargar Plantilla Oficial (.xlsx)
                </button>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" className="btn btn-ghost" onClick={() => setShowNewPrevio(false)}>Cancelar</button>
                  <button type="submit" className="btn btn-primary" disabled={submitting || !file}>
                    {submitting ? 'Procesando...' : 'Crear Previo de Recibo'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- MODAL DE CONFIRMACIÓN Y CIERRE DE RECEPCIÓN --- */}
      {closingReceipt && (
        <div className="modal-overlay" onClick={() => setClosingReceipt(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 600 }}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 36, height: 36, borderRadius: 8, background: 'rgba(13,148,136,0.1)', color: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <CheckSquare size={20} />
                </div>
                <div>
                  <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Finalizar y Cerrar Recepción ({closingReceipt.codigo})</h2>
                  <p style={{ margin: 0, fontSize: 12, color: 'var(--text-tertiary)' }}>Se generará el reporte oficial de entrada con el balance de mercancía recibida</p>
                </div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => setClosingReceipt(null)}><X size={18} /></button>
            </div>

            <form onSubmit={handleCloseReceiptSubmit} className="modal-body">
              <div style={{ padding: '12px 16px', background: 'var(--bg-secondary)', borderRadius: 8, marginBottom: 14, fontSize: 13 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px' }}>
                  <span>Depositante: <strong>{closingReceipt.cliente?.nombreComercial}</strong></span>
                  <span>Factura/OC: <strong>{closingReceipt.ocReferencia || 'N/A'}</strong></span>
                  <span>Líneas totales: <strong>{closingReceipt.lineas?.length || 0}</strong></span>
                  <span>Transporte: <strong>{closingReceipt.lineaTransporte || 'N/A'}</strong></span>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Notas u Observaciones de Cierre (Opcional)</label>
                <textarea 
                  className="form-input" 
                  rows={3} 
                  placeholder="Observaciones de descarga, sellos de transporte, estado de tarimas..." 
                  value={closingNotes} 
                  onChange={e => setClosingNotes(e.target.value)} 
                />
              </div>

              <div className="modal-footer">
                <button type="button" className="btn btn-ghost" onClick={() => setClosingReceipt(null)}>Cancelar</button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>
                  {submitting ? 'Cerrando recepción...' : '🏁 Confirmar y Generar Reporte de Cierre'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- MODAL REPORTE OFICIAL DE CIERRE / HOJA DE ENTRADA (ASN) --- */}
      {reportModalReceipt && reportData && (
        <div className="modal-overlay" onClick={() => setReportModalReceipt(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 880, maxHeight: '94vh', overflowY: 'auto' }}>
            <div className="modal-header" style={{ borderBottom: 'none', paddingBottom: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 36, height: 36, borderRadius: 8, background: 'rgba(13,148,136,0.1)', color: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <FileText size={20} />
                </div>
                <div>
                  <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Hoja Oficial de Cierre — Reporte de Entrada (ASN)</h2>
                  <p style={{ margin: 0, fontSize: 12, color: 'var(--text-tertiary)' }}>Comprobante oficial de recepción para cliente depositante y transportista</p>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button 
                  type="button" 
                  className="btn btn-primary btn-sm"
                  onClick={() => window.print()}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                >
                  <Printer size={14} /> Imprimir / PDF
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => setReportModalReceipt(null)}><X size={18} /></button>
              </div>
            </div>

            {/* CONTENIDO DEL REPORTE IMPRIMIBLE */}
            <div className="modal-body" id="printable-reception-report" style={{ padding: '20px 24px' }}>
              
              {/* Header Empresa & Folio */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '2px solid var(--border)', paddingBottom: 16, marginBottom: 16 }}>
                <div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--primary)', letterSpacing: '-0.02em' }}>GIVING OUT WMS 360+</div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Operador Logístico 3PL · CEDIS Tepotzotlán</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>FOLIO: {reportData.receipt?.codigo}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                    Fecha: {new Date(reportData.receipt?.fechaRecepcion).toLocaleString('es-MX')}
                  </div>
                  <span className={`badge badge-${reportData.receipt?.estado === 'CERRADO' ? 'default' : 'success'}`} style={{ marginTop: 4 }}>
                    ESTADO: {reportData.receipt?.estado}
                  </span>
                </div>
              </div>

              {/* Metadatos de la Entrada */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, padding: '12px 16px', background: 'var(--bg-secondary)', borderRadius: 8, marginBottom: 16, fontSize: 12 }}>
                <div>
                  <span style={{ color: 'var(--text-tertiary)' }}>Depositante:</span>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{reportData.receipt?.cliente?.nombreComercial}</div>
                </div>
                <div>
                  <span style={{ color: 'var(--text-tertiary)' }}>Factura / OC:</span>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{reportData.receipt?.ocReferencia || 'N/A'}</div>
                </div>
                <div>
                  <span style={{ color: 'var(--text-tertiary)' }}>Línea de Transporte:</span>
                  <div style={{ fontWeight: 600 }}>{reportData.receipt?.lineaTransporte || 'N/A'} {reportData.receipt?.placa ? `(${reportData.receipt.placa})` : ''}</div>
                </div>
                <div>
                  <span style={{ color: 'var(--text-tertiary)' }}>Nombre del Chofer:</span>
                  <div style={{ fontWeight: 600 }}>{reportData.receipt?.nombreChofer || 'N/A'}</div>
                </div>
              </div>

              {/* Tarjetas KPI de Balance */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, marginBottom: 16 }}>
                <div style={{ padding: '10px 12px', background: 'var(--bg-card)', borderRadius: 8, border: '1px solid var(--border)', textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Total Esperado</div>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>{reportData.resumen?.totalEsperado}</div>
                </div>
                <div style={{ padding: '10px 12px', background: 'rgba(16,185,129,0.06)', borderRadius: 8, border: '1px solid rgba(16,185,129,0.25)', textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: 'var(--emerald)' }}>Conforme (Liberado)</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--emerald)' }}>{reportData.resumen?.totalConforme}</div>
                </div>
                <div style={{ padding: '10px 12px', background: 'rgba(245,158,11,0.06)', borderRadius: 8, border: '1px solid rgba(245,158,11,0.25)', textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: 'var(--warning)' }}>No Conforme (Merma)</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--warning)' }}>{reportData.resumen?.totalNoConforme}</div>
                </div>
                <div style={{ padding: '10px 12px', background: 'var(--bg-card)', borderRadius: 8, border: '1px solid var(--border)', textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Variación Neta</div>
                  <div style={{ 
                    fontSize: 18, 
                    fontWeight: 700, 
                    color: reportData.resumen?.variacionNeta === 0 ? 'var(--emerald)' : reportData.resumen?.variacionNeta < 0 ? 'var(--error)' : 'var(--info)' 
                  }}>
                    {reportData.resumen?.variacionNeta > 0 ? `+${reportData.resumen?.variacionNeta}` : reportData.resumen?.variacionNeta}
                  </div>
                </div>
              </div>

              {/* Tabla Comparativa Detallada */}
              <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', marginBottom: 20 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)', textAlign: 'left', color: 'var(--text-tertiary)' }}>
                      <th style={{ padding: '8px 10px' }}>SKU / EAN CLIENTE</th>
                      <th style={{ padding: '8px 10px' }}>DESCRIPCIÓN</th>
                      <th style={{ padding: '8px 10px', textAlign: 'center' }}>ESPERADO</th>
                      <th style={{ padding: '8px 10px', textAlign: 'center' }}>CONFORME</th>
                      <th style={{ padding: '8px 10px', textAlign: 'center' }}>MERMA</th>
                      <th style={{ padding: '8px 10px', textAlign: 'center' }}>VARIACIÓN</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reportData.lineas?.map((l: any, idx: number) => (
                      <tr key={idx} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '8px 10px', fontWeight: 600 }}>
                          <div>{l.codigo}</div>
                          {l.codigoBarras && <div style={{ fontSize: 11, color: 'var(--text-tertiary)', fontFamily: 'monospace' }}>EAN: {l.codigoBarras}</div>}
                        </td>
                        <td style={{ padding: '8px 10px' }}>{l.descripcion}</td>
                        <td style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 600 }}>{l.cantidadEsperada}</td>
                        <td style={{ padding: '8px 10px', textAlign: 'center', color: 'var(--emerald)', fontWeight: 700 }}>{l.cantidadConforme}</td>
                        <td style={{ padding: '8px 10px', textAlign: 'center', color: l.cantidadNoConforme > 0 ? 'var(--warning)' : 'var(--text-tertiary)' }}>{l.cantidadNoConforme}</td>
                        <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                          {l.variacion === 0 ? (
                            <span style={{ color: 'var(--emerald)', fontWeight: 600 }}>0 (Exacto)</span>
                          ) : l.variacion < 0 ? (
                            <span style={{ color: 'var(--error)', fontWeight: 700 }}>{l.variacion} (Faltan)</span>
                          ) : (
                            <span style={{ color: 'var(--info)', fontWeight: 700 }}>+{l.variacion} (Excedente)</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Cuadro de Firmas de Conformidad */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 40, marginTop: 30, paddingTop: 20 }}>
                <div style={{ borderTop: '1px solid var(--border)', textAlign: 'center', paddingTop: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>Firma y Nombre del Transportista</div>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Entregó de conformidad</div>
                </div>
                <div style={{ borderTop: '1px solid var(--border)', textAlign: 'center', paddingTop: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>Firma Supervisor de Almacén Giving Out</div>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Recibió y validó físicamente</div>
                </div>
              </div>

            </div>
          </div>
        </div>
      )}

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

      {/* --- TABLA DE RECEPCIONES --- */}
      <div className="card">
        <div className="table-responsive">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ minWidth: '130px' }}>CÓDIGO PREVIO</th>
                <th style={{ minWidth: '110px' }}>FECHA</th>
                <th style={{ minWidth: '130px' }}>DEPOSITANTE</th>
                <th style={{ minWidth: '140px' }}>FACTURA / OC</th>
                <th style={{ minWidth: '160px' }}>TRANSPORTE / CHOFER</th>
                <th style={{ width: '70px', textAlign: 'center' }}>LÍNEAS</th>
                <th style={{ width: '110px' }}>ESTADO</th>
                <th style={{ width: '180px', minWidth: '160px', textAlign: 'right' }}>ACCIONES</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
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
                  const isClosed = r.estado === 'CERRADO';

                  return (
                    <React.Fragment key={r.id}>
                      <tr 
                        style={{ cursor: 'pointer', background: expanded === r.id ? 'var(--bg-secondary)' : '' }} 
                        onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                      >
                        <td style={{ fontWeight: 700, color: 'var(--primary)' }}>{r.codigo}</td>
                        <td>{new Date(r.fechaRecepcion).toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: 'numeric' })}</td>
                        <td><span className="badge badge-info">{r.cliente?.nombreComercial}</span></td>
                        <td>
                          {r.ocReferencia ? (
                            <span style={{ fontWeight: 600, color: 'var(--text-primary)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                              <FileText size={13} style={{ color: 'var(--text-tertiary)' }} />
                              {r.ocReferencia}
                            </span>
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
                        <td><span className={`badge badge-${estadoBadge(r.estado)}`}>{r.estado.replace('_', ' ')}</span></td>
                        <td style={{ textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', alignItems: 'center' }}>
                            
                            {/* BOTÓN IMPRIMIR ETIQUETAS */}
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              title="Imprimir etiquetas térmicas para este previo"
                              onClick={() => setPrintModalReceipt(r)}
                              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 8px', fontSize: 12 }}
                            >
                              <Printer size={13} /> Imprimir
                            </button>

                            {/* BOTÓN REPORTE DE ENTRADA */}
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              title="Ver Reporte Oficial de Cierre (ASN)"
                              onClick={() => handleOpenReport(r)}
                              style={{ padding: '4px 6px', color: 'var(--primary)' }}
                            >
                              <FileText size={15} />
                            </button>

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
                              
                              {/* HEADER DEL DETALLE CON ACCIONES */}
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 12 }}>
                                <div style={{ minWidth: 220 }}>
                                  <h4 style={{ margin: 0, fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <Package size={18} style={{ color: 'var(--primary)' }} />
                                    Detalle de Líneas de Recepción ({r.codigo})
                                  </h4>
                                  <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                                    Origen: <strong>{r.origen || 'Nacional'}</strong> | Factura: <strong>{r.ocReferencia || 'N/A'}</strong>
                                    {r.notas && ` | Notas: ${r.notas}`}
                                  </span>
                                </div>

                                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                  {/* BOTÓN CERRAR RECEPCIÓN */}
                                  {!isClosed && (
                                    <button
                                      type="button"
                                      className="btn btn-primary btn-sm"
                                      onClick={() => setClosingReceipt(r)}
                                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, background: 'var(--emerald)', borderColor: 'var(--emerald)' }}
                                    >
                                      <CheckSquare size={14} /> Finalizar y Cerrar Recepción
                                    </button>
                                  )}

                                  {/* BOTÓN VER REPORTE */}
                                  <button
                                    type="button"
                                    className="btn btn-secondary btn-sm"
                                    onClick={() => handleOpenReport(r)}
                                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}
                                  >
                                    <FileText size={14} /> Hoja de Entrada (ASN)
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

                              {/* TABLA DE LÍNEAS DEL PREVIO */}
                              <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', background: 'var(--bg-card)' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                                  <thead>
                                    <tr style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)', textAlign: 'left', color: 'var(--text-tertiary)', fontSize: 11 }}>
                                      <th style={{ padding: '8px 12px' }}>SKU / EAN CLIENTE</th>
                                      <th style={{ padding: '8px 12px' }}>CÓDIGO GIVINGOUT</th>
                                      <th style={{ padding: '8px 12px' }}>DESCRIPCIÓN</th>
                                      <th style={{ padding: '8px 12px', textAlign: 'center' }}>ESPERADO</th>
                                      <th style={{ padding: '8px 12px', textAlign: 'center' }}>CONFORME</th>
                                      <th style={{ padding: '8px 12px', textAlign: 'center' }}>NO CONFORME</th>
                                      <th style={{ padding: '8px 12px', textAlign: 'center' }}>VARIACIÓN</th>
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
                                      const variacion = totalRecibido - esperada;

                                      return (
                                        <React.Fragment key={l.id}>
                                          <tr style={{ borderBottom: '1px solid var(--border)' }}>
                                            <td style={{ padding: '10px 12px', fontWeight: 600, color: 'var(--primary)' }}>
                                              {skuObj?.codigo}
                                            </td>
                                            <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontSize: 12 }}>
                                              {skuObj?.codigoBarras ? (
                                                <span className="badge badge-info">{skuObj.codigoBarras}</span>
                                              ) : (
                                                <span style={{ color: 'var(--text-tertiary)' }}>Sin EAN-13</span>
                                              )}
                                            </td>
                                            <td style={{ padding: '10px 12px' }}>
                                              <div style={{ fontWeight: 500 }}>{skuObj?.descripcion}</div>
                                              <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                                                {skuObj?.talla ? `Talla ${skuObj.talla}` : ''} {skuObj?.color ? `· ${skuObj.color}` : ''}
                                              </div>
                                            </td>
                                            <td style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 700 }}>
                                              {esperada}
                                            </td>
                                            <td style={{ padding: '10px 12px', textAlign: 'center', color: 'var(--emerald)', fontWeight: 700 }}>
                                              {conforme}
                                            </td>
                                            <td style={{ padding: '10px 12px', textAlign: 'center', color: danada > 0 ? 'var(--warning)' : 'var(--text-tertiary)', fontWeight: 600 }}>
                                              {danada}
                                            </td>
                                            <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                                              {variacion === 0 ? (
                                                <span className="badge badge-success">Exacto (0)</span>
                                              ) : variacion < 0 ? (
                                                <span className="badge badge-warning">{variacion} faltan</span>
                                              ) : (
                                                <span className="badge badge-info">+{variacion} excedente</span>
                                              )}
                                            </td>
                                            <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                                              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                                                {!isClosed && (
                                                  <button
                                                    type="button"
                                                    className="btn btn-primary btn-sm"
                                                    onClick={() => {
                                                      setProcessLineId(processLineId === l.id ? null : l.id);
                                                      const rem = Math.max(0, esperada - totalRecibido);
                                                      setProcessForm({
                                                        cantidadConforme: rem,
                                                        cantidadNoConforme: 0,
                                                        ubicacionConformeId: '',
                                                        ubicacionNoConformeId: '',
                                                        lote: '',
                                                        fechaVencimiento: '',
                                                        tipoHu: clientObj?.uomPrincipal === 'PALLET' ? 'PALLET' : 'CAJA'
                                                      });
                                                    }}
                                                  >
                                                    Ingresar
                                                  </button>
                                                )}
                                                <button
                                                  type="button"
                                                  className="btn btn-secondary btn-sm"
                                                  title="Imprimir etiquetas de este producto"
                                                  onClick={() => setPrintModalReceipt({ ...r, lineas: [l] })}
                                                >
                                                  <Printer size={13} />
                                                </button>
                                              </div>
                                            </td>
                                          </tr>

                                          {/* FORMULARIO DE INGRESO DUAL INLINE */}
                                          {processLineId === l.id && (
                                            <tr>
                                              <td colSpan={8} style={{ padding: 18, background: 'rgba(13,148,136,0.03)', borderTop: '1px solid var(--border)' }}>
                                                <form onSubmit={(e) => handleProcessLine(e, r.id, l.id)}>
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
                                                          value={processForm.cantidadConforme} 
                                                          onChange={e => setProcessForm({ ...processForm, cantidadConforme: parseInt(e.target.value) || 0 })} 
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
                                                          value={processForm.cantidadNoConforme} 
                                                          onChange={e => setProcessForm({ ...processForm, cantidadNoConforme: parseInt(e.target.value) || 0 })} 
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

                                                  {/* CAMPOS CONDICIONALES SEGÚN REGLAS DEL CLIENTE */}
                                                  {(clientObj?.requiereLote || clientObj?.requiereCaducidad) && (
                                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginTop: 14 }}>
                                                      {clientObj?.requiereLote && (
                                                        <div className="form-group">
                                                          <label className="form-label">
                                                            Lote <span className="required">* (Obligatorio)</span>
                                                          </label>
                                                          <input 
                                                            className="form-input" 
                                                            placeholder="Ej. LOT-2026-A"
                                                            value={processForm.lote} 
                                                            onChange={e => setProcessForm({ ...processForm, lote: e.target.value })} 
                                                            required
                                                          />
                                                        </div>
                                                      )}
                                                      {clientObj?.requiereCaducidad && (
                                                        <div className="form-group">
                                                          <label className="form-label">
                                                            Fecha de Vencimiento <span className="required">* (Obligatorio)</span>
                                                          </label>
                                                          <input 
                                                            type="date" 
                                                            className="form-input" 
                                                            value={processForm.fechaVencimiento} 
                                                            onChange={e => setProcessForm({ ...processForm, fechaVencimiento: e.target.value })} 
                                                            required
                                                          />
                                                        </div>
                                                      )}
                                                    </div>
                                                  )}

                                                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
                                                    <button type="button" className="btn btn-ghost" onClick={() => setProcessLineId(null)}>Cancelar</button>
                                                    <button type="submit" className="btn btn-primary" disabled={submitting}>
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
  );
}
