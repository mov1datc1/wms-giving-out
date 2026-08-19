import React, { useEffect, useState, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { API } from '../config/api';
import {
  ClipboardList, Search, RefreshCw, Check, Clock, AlertCircle,
  ChevronDown, ChevronUp, Plus, X, Package, MapPin, Truck, UploadCloud,
  FileSpreadsheet, Download, CheckCircle2, AlertTriangle, FileText, Sparkles,
  Printer, QrCode, Scan, ArrowRight, Tag, Box
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
        text: `✅ ${data.message || 'Códigos EAN-13 generados y vinculados correctamente.'}`
      });

      // Recargar datos para mostrar los nuevos EANs en la tabla
      await loadData();
    } catch (err: any) {
      setFormMsg({ type: 'error', text: err.message });
    }
    setGeneratingBarcodes(null);
  }

  // --- PARSEADOR INTELIGENTE DE EXCEL ---
  function normalizeKey(key: string): string {
    return key.toLowerCase().trim().replace(/[\s_-]+/g, '');
  }

  async function parseAndAnalyzeExcel(selectedFile: File, clienteId: string) {
    try {
      const buffer = await selectedFile.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array' });
      if (!wb.SheetNames || wb.SheetNames.length === 0) {
        throw new Error('El archivo Excel no contiene hojas.');
      }

      const ws = wb.Sheets[wb.SheetNames[0]];
      const rawData = XLSX.utils.sheet_to_json(ws) as any[];

      if (!rawData || rawData.length === 0) {
        setExcelAnalysis({
          fileName: selectedFile.name,
          totalRows: 0,
          matchedRows: 0,
          unmatchedCodes: [],
          detectedFactura: '',
          lines: []
        });
        return;
      }

      const clientSkus = skus.filter(s => !clienteId || s.clienteId === clienteId);
      let detectedFactura = '';
      const parsedLines: ParsedLine[] = [];
      const unmatchedSet = new Set<string>();

      rawData.forEach((row: any, idx: number) => {
        let rowFactura = '';
        let rowCode = '';
        let rowQty = 0;

        for (const [k, v] of Object.entries(row)) {
          if (v === null || v === undefined) continue;
          const normKey = normalizeKey(k);
          const strVal = String(v).trim();

          if (
            normKey === 'factura' || normKey === 'nofactura' || normKey === 'facturano' ||
            normKey === 'oc' || normKey === 'ocreferencia' || normKey === 'referencia' ||
            normKey === 'ordencompra' || normKey === 'remision'
          ) {
            rowFactura = strVal;
            if (!detectedFactura && strVal) detectedFactura = strVal;
          } else if (
            normKey === 'ean' || normKey === 'ean13' || normKey === 'upc' ||
            normKey === 'codigo' || normKey === 'codigobarras' || normKey === 'sku' ||
            normKey === 'codigoproducto' || normKey === 'articulo' || normKey === 'clave'
          ) {
            rowCode = strVal;
          } else if (
            normKey === 'cantidadarecibir' || normKey === 'cantidadaingresar' ||
            normKey === 'cantidadesperada' || normKey === 'cantidad' ||
            normKey === 'cant' || normKey === 'qty' || normKey === 'piezas' || normKey === 'unidades'
          ) {
            rowQty = Number(v) || 0;
          }
        }

        if (!rowCode) {
          rowCode = String(row.Ean || row.ean || row.EAN || row.Codigo || row.codigo || row.SKU || row.sku || '').trim();
        }
        if (!rowQty) {
          rowQty = Number(row['Cantidad a recibir'] || row.Cantidad || row.cantidad || row.qty || 0);
        }
        if (!rowFactura && (row.factura || row.Factura || row.FACTURA || row.ocReferencia)) {
          rowFactura = String(row.factura || row.Factura || row.FACTURA || row.ocReferencia).trim();
          if (!detectedFactura && rowFactura) detectedFactura = rowFactura;
        }

        if (!rowCode && rowQty === 0) return;

        const cleanCode = rowCode.toLowerCase();
        const matchedSku = clientSkus.find(s => 
          s.codigo?.toLowerCase() === cleanCode || 
          (s.codigoBarras && s.codigoBarras.toLowerCase() === cleanCode)
        );

        let status: 'MATCHED' | 'NOT_FOUND' | 'INVALID_QTY' = 'MATCHED';
        if (rowQty <= 0) {
          status = 'INVALID_QTY';
        } else if (!matchedSku) {
          status = 'NOT_FOUND';
          unmatchedSet.add(rowCode || `Fila #${idx + 2}`);
        }

        parsedLines.push({
          rowNum: idx + 2,
          factura: rowFactura || detectedFactura,
          codeOrEan: rowCode,
          cantidadEsperada: rowQty,
          sku: matchedSku,
          status
        });
      });

      const matchedCount = parsedLines.filter(l => l.status === 'MATCHED').length;

      setExcelAnalysis({
        fileName: selectedFile.name,
        totalRows: parsedLines.length,
        matchedRows: matchedCount,
        unmatchedCodes: Array.from(unmatchedSet),
        detectedFactura,
        lines: parsedLines
      });

      if (detectedFactura && !newPrevio.ocReferencia) {
        setNewPrevio(prev => ({ ...prev, ocReferencia: detectedFactura }));
      }
    } catch (err: any) {
      console.error('Error al analizar Excel:', err);
      setFormMsg({ type: 'error', text: `Error al leer Excel: ${err.message}` });
      setExcelAnalysis(null);
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0] || null;
    setFile(selected);
    setFormMsg({ type: '', text: '' });
    if (selected) {
      parseAndAnalyzeExcel(selected, newPrevio.clienteId);
    } else {
      setExcelAnalysis(null);
    }
  }

  // --- DESCARGAR PLANTILLA EXCEL ---
  function handleDownloadTemplate() {
    const sampleRows = [
      { 'factura': 'FAC-2026-001', 'Ean': '7501055310885', 'Cantidad a recibir': 150 },
      { 'factura': 'FAC-2026-001', 'Ean': '7501055310892', 'Cantidad a recibir': 200 },
      { 'factura': 'FAC-2026-001', 'Ean': '7501055310908', 'Cantidad a recibir': 80 }
    ];
    const ws = XLSX.utils.json_to_sheet(sampleRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Previo de Recibo');
    XLSX.writeFile(wb, 'Plantilla_Previo_Recibo.xlsx');
  }

  // --- SUBMIT PREVIO ---
  async function handleCreatePrevio(e: React.FormEvent) {
    e.preventDefault();
    setFormMsg({ type: '', text: '' });
    
    if (!newPrevio.clienteId) {
      setFormMsg({ type: 'error', text: 'Debes seleccionar un depositante (cliente).' });
      return;
    }
    if (!file || !excelAnalysis) {
      setFormMsg({ type: 'error', text: 'Debes subir un archivo Excel válido.' });
      return;
    }

    const validLines = excelAnalysis.lines
      .filter(l => l.status === 'MATCHED' && l.sku)
      .map(l => ({
        skuId: l.sku.id,
        cantidadEsperada: l.cantidadEsperada
      }));

    if (validLines.length === 0) {
      setFormMsg({ 
        type: 'error', 
        text: 'No se encontraron SKUs válidos del depositante en el archivo.' 
      });
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        clienteId: newPrevio.clienteId,
        proveedorId: newPrevio.proveedorId || undefined,
        origen: newPrevio.origen,
        lineaTransporte: newPrevio.lineaTransporte || undefined,
        placa: newPrevio.placa || undefined,
        nombreChofer: newPrevio.nombreChofer || undefined,
        ocReferencia: newPrevio.ocReferencia || excelAnalysis.detectedFactura || undefined,
        notas: newPrevio.notas || undefined,
        archivoPrevioUrl: file.name,
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
      setProcessForm({
        cantidadConforme: rem,
        cantidadNoConforme: 0,
        ubicacionConformeId: '',
        ubicacionNoConformeId: '',
        lote: '',
        fechaVencimiento: '',
        tipoHu: 'CAJA'
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

  const estadoBadge = (estado: string) => estado === 'COMPLETO' ? 'success' : estado === 'EN_PROCESO' ? 'warning' : estado === 'PENDIENTE' ? 'info' : 'default';

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Previos de Recibo (Recepción)</h1>
          <p className="page-subtitle">Cola de recepciones pendientes con soporte para generación de EANs, impresión térmica de etiquetas y escaneo con Handheld</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" onClick={() => { setShowNewPrevio(true); setFormMsg({ type: '', text: '' }); }}>
            <UploadCloud size={16} /> Cargar Previo
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

      {/* --- MODAL DE IMPRESIÓN DE ETIQUETAS --- */}
      {printModalReceipt && (
        <ReceiptPrintModal
          receipt={printModalReceipt}
          locations={locations}
          token={token || ''}
          onClose={() => setPrintModalReceipt(null)}
        />
      )}

      {/* --- MODAL CARGAR PREVIO --- */}
      {showNewPrevio && (
        <div className="modal-overlay" onClick={() => setShowNewPrevio(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 720, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
            <div className="modal-header">
              <h2><FileSpreadsheet size={20} style={{ color: 'var(--primary)' }} /> Cargar Nuevo Previo de Recibo</h2>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowNewPrevio(false)}><X size={18} /></button>
            </div>
            
            <form onSubmit={handleCreatePrevio} className="modal-body" style={{ overflowY: 'auto', flex: 1 }}>
              <div className="form-row">
                <div className="form-group" style={{ flex: 2 }}>
                  <label className="form-label">DEPOSITANTE (CLIENTE) <span className="required">*</span></label>
                  <select 
                    className="form-select form-select-full" 
                    value={newPrevio.clienteId} 
                    onChange={e => setNewPrevio({ ...newPrevio, clienteId: e.target.value })} 
                    required
                  >
                    <option value="">Seleccionar...</option>
                    {clients.map(c => <option key={c.id} value={c.id}>{c.nombreComercial} ({c.codigo})</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">ORIGEN</label>
                  <select className="form-select form-select-full" value={newPrevio.origen} onChange={e => setNewPrevio({ ...newPrevio, origen: e.target.value })}>
                    <option value="NACIONAL">Nacional</option>
                    <option value="IMPORTACION">Importación</option>
                  </select>
                </div>
              </div>

              <div className="form-row">
                <div className="form-group" style={{ flex: 1.5 }}>
                  <label className="form-label">FACTURA / OC / REFERENCIA</label>
                  <div style={{ position: 'relative' }}>
                    <input 
                      className="form-input" 
                      placeholder="Ej. FAC-2026-091 o auto-detectada" 
                      value={newPrevio.ocReferencia} 
                      onChange={e => setNewPrevio({ ...newPrevio, ocReferencia: e.target.value })} 
                    />
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">PROVEEDOR (OPCIONAL)</label>
                  <select className="form-select form-select-full" value={newPrevio.proveedorId} onChange={e => setNewPrevio({ ...newPrevio, proveedorId: e.target.value })}>
                    <option value="">Ninguno</option>
                    {suppliers.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                  </select>
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">LÍNEA DE TRANSPORTE</label>
                  <input className="form-input" placeholder="Ej. Castores, Tres Guerras" value={newPrevio.lineaTransporte} onChange={e => setNewPrevio({ ...newPrevio, lineaTransporte: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="form-label">PLACA</label>
                  <input className="form-input" placeholder="Ej. 123-ABC-9" value={newPrevio.placa} onChange={e => setNewPrevio({ ...newPrevio, placa: e.target.value })} />
                </div>
                <div className="form-group" style={{ flex: 1.5 }}>
                  <label className="form-label">NOMBRE CHOFER / CONTACTO</label>
                  <input className="form-input" placeholder="Nombre completo" value={newPrevio.nombreChofer} onChange={e => setNewPrevio({ ...newPrevio, nombreChofer: e.target.value })} />
                </div>
              </div>

              {/* ÁREA DE CARGA DE ARCHIVO */}
              <div className="form-group" style={{ marginTop: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <label className="form-label" style={{ margin: 0 }}>ARCHIVO EXCEL (PLANTILLA) <span className="required">*</span></label>
                  <button 
                    type="button" 
                    className="btn btn-ghost btn-sm" 
                    onClick={handleDownloadTemplate}
                    style={{ fontSize: 12, padding: '2px 8px', color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: 4 }}
                  >
                    <Download size={13} /> Descargar Plantilla Oficial (.xlsx)
                  </button>
                </div>
                
                <div style={{ 
                  border: file ? '2px solid var(--primary)' : '2px dashed var(--border)', 
                  padding: file ? '14px 18px' : '24px 18px', 
                  textAlign: 'center', 
                  borderRadius: 10,
                  background: file ? 'rgba(37, 99, 235, 0.03)' : 'var(--bg-secondary)',
                  transition: 'all 0.2s'
                }}>
                  <input 
                    type="file" 
                    accept=".xlsx, .xls, .csv" 
                    ref={fileInputRef} 
                    style={{ display: 'none' }} 
                    onChange={handleFileChange} 
                  />
                  
                  {file ? (
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left' }}>
                          <FileSpreadsheet size={28} style={{ color: 'var(--primary)' }} />
                          <div>
                            <p style={{ margin: 0, fontWeight: 600, fontSize: 14 }}>{file.name}</p>
                            <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{(file.size / 1024).toFixed(1)} KB</span>
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => fileInputRef.current?.click()}>Cambiar</button>
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setFile(null); setExcelAnalysis(null); }}><X size={15} /></button>
                        </div>
                      </div>

                      {/* RESUMEN DE VALIDACIÓN */}
                      {excelAnalysis && (
                        <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)', textAlign: 'left' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 10 }}>
                            <div style={{ background: 'var(--bg-card)', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)' }}>
                              <div style={{ fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>Filas en Archivo</div>
                              <div style={{ fontSize: 18, fontWeight: 700 }}>{excelAnalysis.totalRows}</div>
                            </div>
                            <div style={{ background: 'rgba(16, 185, 129, 0.08)', padding: '8px 12px', borderRadius: 6, border: '1px solid rgba(16, 185, 129, 0.2)' }}>
                              <div style={{ fontSize: 11, color: 'var(--emerald)', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 4 }}>
                                <CheckCircle2 size={12} /> SKUs Coincidentes
                              </div>
                              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--emerald)' }}>{excelAnalysis.matchedRows}</div>
                            </div>
                            {excelAnalysis.unmatchedCodes.length > 0 && (
                              <div style={{ background: 'rgba(245, 158, 11, 0.08)', padding: '8px 12px', borderRadius: 6, border: '1px solid rgba(245, 158, 11, 0.2)' }}>
                                <div style={{ fontSize: 11, color: 'var(--orange)', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 4 }}>
                                  <AlertTriangle size={12} /> No Encontrados
                                </div>
                                <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--orange)' }}>{excelAnalysis.unmatchedCodes.length}</div>
                              </div>
                            )}
                            {excelAnalysis.detectedFactura && (
                              <div style={{ background: 'var(--bg-card)', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)' }}>
                                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>Doc / Factura</div>
                                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {excelAnalysis.detectedFactura}
                                </div>
                              </div>
                            )}
                          </div>

                          {/* ALERTA DE NO ENCONTRADOS */}
                          {excelAnalysis.unmatchedCodes.length > 0 && (
                            <div style={{ padding: '8px 12px', background: 'rgba(245, 158, 11, 0.1)', borderRadius: 6, borderLeft: '3px solid var(--orange)', fontSize: 12, marginBottom: 10, color: 'var(--orange)' }}>
                              ⚠️ <strong>Atención:</strong> Los siguientes códigos/EANs no existen en el catálogo del depositante seleccionado: {excelAnalysis.unmatchedCodes.slice(0, 5).join(', ')}{excelAnalysis.unmatchedCodes.length > 5 ? ' y más...' : ''}. No se incluirán en el recibo.
                            </div>
                          )}

                          {/* PREVIEW DE PRIMERAS LÍNEAS */}
                          <div style={{ maxHeight: 130, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 6 }}>
                            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse', textAlign: 'left' }}>
                              <thead style={{ background: 'var(--bg-secondary)', position: 'sticky', top: 0 }}>
                                <tr>
                                  <th style={{ padding: '4px 8px' }}>EAN / Código</th>
                                  <th style={{ padding: '4px 8px' }}>SKU Encontrado</th>
                                  <th style={{ padding: '4px 8px', textAlign: 'right' }}>Cant.</th>
                                  <th style={{ padding: '4px 8px', textAlign: 'center' }}>Estado</th>
                                </tr>
                              </thead>
                              <tbody>
                                {excelAnalysis.lines.map((l, i) => (
                                  <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                                    <td style={{ padding: '4px 8px', fontFamily: 'monospace' }}>{l.codeOrEan}</td>
                                    <td style={{ padding: '4px 8px' }}>
                                      {l.sku ? `${l.sku.codigo} - ${l.sku.descripcion}` : <span style={{ color: 'var(--text-tertiary)' }}>No registrado</span>}
                                    </td>
                                    <td style={{ padding: '4px 8px', textAlign: 'right', fontWeight: 600 }}>{l.cantidadEsperada}</td>
                                    <td style={{ padding: '4px 8px', textAlign: 'center' }}>
                                      {l.status === 'MATCHED' ? (
                                        <span className="badge badge-success" style={{ fontSize: 10, padding: '1px 6px' }}>Válido</span>
                                      ) : (
                                        <span className="badge badge-warning" style={{ fontSize: 10, padding: '1px 6px' }}>No coincide</span>
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
                  ) : (
                    <div>
                      <UploadCloud size={36} style={{ color: 'var(--primary)', opacity: 0.8, marginBottom: 8 }} />
                      <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: 14 }}>Sube el archivo de Excel con el previo de recibo</p>
                      <p style={{ margin: '0 0 12px', color: 'var(--text-tertiary)', fontSize: 12 }}>
                        Formatos soportados: <strong>factura</strong>, <strong>Ean</strong> / <strong>Codigo</strong>, <strong>Cantidad a recibir</strong>
                      </p>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => fileInputRef.current?.click()}>
                        Seleccionar Archivo (.xlsx)
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="form-group" style={{ marginTop: 8 }}>
                <label className="form-label">NOTAS / OBSERVACIONES</label>
                <textarea 
                  className="form-input" 
                  rows={2} 
                  placeholder="Instrucciones especiales de recepción, sellos de contenedor, etc." 
                  value={newPrevio.notas} 
                  onChange={e => setNewPrevio({ ...newPrevio, notas: e.target.value })} 
                />
              </div>

              <div className="modal-footer" style={{ marginTop: 16 }}>
                <button type="button" className="btn btn-ghost" onClick={() => setShowNewPrevio(false)}>Cancelar</button>
                <button 
                  type="submit" 
                  className="btn btn-primary" 
                  disabled={submitting || (excelAnalysis ? excelAnalysis.matchedRows === 0 : false)}
                >
                  {submitting ? 'Procesando e ingresando...' : `Cargar Previo (${excelAnalysis ? excelAnalysis.matchedRows : 0} líneas)`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- TARJETAS DE ESTADÍSTICAS --- */}
      <div className="stats-grid" style={{ marginBottom: 20 }}>
        {[
          { key: 'PENDIENTE', label: 'PENDIENTES', color: 'var(--blue)' },
          { key: 'EN_PROCESO', label: 'EN PROCESO', color: 'var(--orange)' },
          { key: 'COMPLETO', label: 'COMPLETAS', color: 'var(--emerald)' }
        ].map(item => {
          const count = receipts.filter(r => r.estado === item.key).length;
          const isSelected = filterEstado === item.key;
          return (
            <div 
              key={item.key} 
              className="stat-card" 
              style={{ 
                cursor: 'pointer', 
                opacity: filterEstado && !isSelected ? 0.45 : 1,
                borderLeft: isSelected ? `4px solid ${item.color}` : undefined
              }} 
              onClick={() => setFilterEstado(isSelected ? '' : item.key)}
            >
              <div className="stat-info">
                <span className="stat-value">{count}</span>
                <span className="stat-label">{item.label}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* --- BUSCADOR --- */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 12, padding: '14px 20px', alignItems: 'center' }}>
          <div className="search-box" style={{ flex: 1 }}>
            <Search size={16} />
            <input 
              placeholder="Buscar por código de previo, factura / OC, depositante, chofer o placa..." 
              value={search} 
              onChange={e => setSearch(e.target.value)} 
            />
          </div>
          {filterEstado && (
            <button className="btn btn-ghost btn-sm" onClick={() => setFilterEstado('')}>
              Quitar filtro ({filterEstado})
            </button>
          )}
        </div>
      </div>

      {/* --- TABLA DE RECEPCIONES --- */}
      <div className="card">
        <div className="table-responsive">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ minWidth: '130px' }}>CÓDIGO</th>
                <th style={{ minWidth: '110px' }}>FECHA</th>
                <th style={{ minWidth: '130px' }}>DEPOSITANTE</th>
                <th style={{ minWidth: '140px' }}>FACTURA / OC</th>
                <th style={{ minWidth: '160px' }}>TRANSPORTE / CHOFER</th>
                <th style={{ width: '70px', textAlign: 'center' }}>LÍNEAS</th>
                <th style={{ width: '110px' }}>ESTADO</th>
                <th style={{ width: '160px', minWidth: '140px', textAlign: 'right' }}>ACCIONES</th>
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

                            {/* BOTÓN GENERAR EANS SI FALTAN */}
                            {missingBarcodesCount > 0 && (
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                title={`Generar EAN-13 para ${missingBarcodesCount} productos sin código`}
                                disabled={generatingBarcodes === r.id}
                                onClick={() => handleGenerateBarcodes(r.id)}
                                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--primary)', padding: '4px 6px', fontSize: 12 }}
                              >
                                <Sparkles size={13} />
                                {generatingBarcodes === r.id ? '...' : 'EANs'}
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
                              
                              {/* HEADER DEL DETALLE CON ACCIONES */}
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 12 }}>
                                <div style={{ minWidth: 220 }}>
                                  <h4 style={{ margin: 0, fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <Package size={18} style={{ color: 'var(--primary)' }} />
                                    Detalle de Líneas de Recepción ({r.codigo})
                                  </h4>
                                  <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                                    Origen: <strong>{r.origen || 'Nacional'}</strong> | Archivo: <strong>{r.archivoPrevioUrl || 'N/A'}</strong>
                                    {r.notas && ` | Notas: ${r.notas}`}
                                  </span>
                                </div>

                                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                  {/* GENERAR EANs */}
                                  <button
                                    type="button"
                                    className="btn btn-secondary btn-sm"
                                    onClick={() => handleGenerateBarcodes(r.id)}
                                    disabled={generatingBarcodes === r.id}
                                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}
                                  >
                                    <QrCode size={14} style={{ color: 'var(--primary)' }} />
                                    {generatingBarcodes === r.id ? 'Generando EANs...' : 'Generar Códigos EAN-13'}
                                  </button>

                                  {/* IMPRIMIR ETIQUETAS */}
                                  <button
                                    type="button"
                                    className="btn btn-primary btn-sm"
                                    onClick={() => setPrintModalReceipt(r)}
                                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}
                                  >
                                    <Printer size={14} />
                                    Imprimir Etiquetas Térmicas
                                  </button>
                                </div>
                              </div>

                              {/* BARRA DE ESCANEO RÁPIDO CON HANDHELD ZEBRA */}
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
                                    background: 'rgba(37,99,235,0.1)', color: 'var(--primary)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
                                  }}>
                                    <Scan size={18} />
                                  </div>
                                  <input
                                    ref={scannerInputRef}
                                    type="text"
                                    className="form-input"
                                    placeholder="Escanear código de barras o SKU con Handheld Zebra para ingreso rápido..."
                                    value={scannerQuery}
                                    onChange={e => setScannerQuery(e.target.value)}
                                    style={{ flex: 1, fontSize: 13, height: 36 }}
                                  />
                                  <button type="submit" className="btn btn-secondary btn-sm" style={{ height: 36 }}>
                                    Escanear <ArrowRight size={14} />
                                  </button>
                                </form>

                                {scannerMsg.text && (
                                  <div style={{
                                    fontSize: 12,
                                    fontWeight: 600,
                                    color: scannerMsg.type === 'error' ? 'var(--orange)' : 'var(--emerald)',
                                    padding: '4px 10px',
                                    background: scannerMsg.type === 'error' ? 'rgba(245, 158, 11, 0.1)' : 'rgba(16, 185, 129, 0.1)',
                                    borderRadius: 6
                                  }}>
                                    {scannerMsg.text}
                                  </div>
                                )}
                              </div>

                              {/* TABLA DE PRODUCTOS */}
                              <div className="table-responsive">
                                <table className="data-table" style={{ background: 'var(--bg-card)', borderRadius: 8, boxShadow: '0 1px 3px rgba(0,0,0,0.05)', width: '100%' }}>
                                  <thead>
                                    <tr>
                                      <th style={{ minWidth: '160px' }}>SKU / PRODUCTO</th>
                                      <th style={{ minWidth: '140px' }}>EAN / CÓDIGO BARRAS</th>
                                      <th style={{ textAlign: 'right', minWidth: '90px' }}>ESPERADO</th>
                                      <th style={{ textAlign: 'right', color: 'var(--emerald)', minWidth: '90px' }}>CONFORME</th>
                                      <th style={{ textAlign: 'right', color: 'var(--orange)', minWidth: '90px' }}>NO CONF.</th>
                                      <th style={{ minWidth: '100px' }}>ESTADO</th>
                                      <th style={{ textAlign: 'center', minWidth: '170px' }}>ACCIONES</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {r.lineas.map((l: any) => {
                                      const skuObj = skus.find(s => s.id === l.skuId) || l.sku;
                                      const barcode = l.sku?.codigoBarras || skuObj?.codigoBarras;

                                      return (
                                        <React.Fragment key={l.id}>
                                          <tr>
                                            <td>
                                              <div style={{ fontWeight: 600 }}>{l.sku?.codigo}</div>
                                              <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                                                {l.sku?.descripcion}
                                                {l.sku?.talla && ` • Talla: ${l.sku.talla}`}
                                                {l.sku?.color && ` • ${l.sku.color}`}
                                              </div>
                                            </td>
                                            <td>
                                              {barcode ? (
                                                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(37,99,235,0.06)', padding: '2px 8px', borderRadius: 4 }}>
                                                  <QrCode size={13} style={{ color: 'var(--primary)' }} />
                                                  <span style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color: 'var(--primary)' }}>
                                                    {barcode}
                                                  </span>
                                                </div>
                                              ) : (
                                                <button
                                                  type="button"
                                                  className="btn btn-ghost btn-sm"
                                                  onClick={() => handleGenerateBarcodes(r.id)}
                                                  style={{ fontSize: 11, color: 'var(--orange)', padding: '2px 6px' }}
                                                  title="Click para generar EAN-13"
                                                >
                                                  ⚠️ Sin EAN (Generar)
                                                </button>
                                              )}
                                            </td>
                                            <td style={{ textAlign: 'right', fontWeight: 700 }}>{l.cantidadEsperada}</td>
                                            <td style={{ textAlign: 'right', color: 'var(--emerald)', fontWeight: 700 }}>{l.cantidadRecibida}</td>
                                            <td style={{ textAlign: 'right', color: 'var(--orange)', fontWeight: 700 }}>{l.cantidadDanada}</td>
                                            <td><span className={`badge badge-${estadoBadge(l.estado)}`}>{l.estado}</span></td>
                                            <td style={{ textAlign: 'center' }}>
                                              <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                                                {l.estado !== 'COMPLETO' && (
                                                  <button 
                                                    className="btn btn-primary btn-sm" 
                                                    onClick={() => {
                                                      setProcessLineId(l.id);
                                                      const rem = Math.max(0, (l.cantidadEsperada || 0) - (l.cantidadRecibida || 0) - (l.cantidadDanada || 0));
                                                      setProcessForm({
                                                        cantidadConforme: rem,
                                                        cantidadNoConforme: 0,
                                                        ubicacionConformeId: '',
                                                        ubicacionNoConformeId: '',
                                                        lote: '',
                                                        fechaVencimiento: '',
                                                        tipoHu: 'CAJA'
                                                      });
                                                    }}
                                                  >
                                                    Ingresar
                                                  </button>
                                                )}

                                                <button
                                                  type="button"
                                                  className="btn btn-secondary btn-sm"
                                                  title="Imprimir etiquetas para esta línea"
                                                  onClick={() => {
                                                    setPrintModalReceipt({
                                                      ...r,
                                                      lineas: [l]
                                                    });
                                                  }}
                                                  style={{ padding: '4px 8px' }}
                                                >
                                                  <Printer size={13} />
                                                </button>
                                              </div>
                                            </td>
                                          </tr>

                                          {/* FORMULARIO DE INGRESO DUAL INLINE CON ASIGNACIÓN INTELIGENTE */}
                                          {processLineId === l.id && (
                                            <tr>
                                              <td colSpan={7} style={{ padding: 18, background: 'rgba(37,99,235,0.04)', borderTop: '1px solid var(--border)' }}>
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
                                                          label="Ubicación Física"
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
                                                      <h5 style={{ margin: '0 0 12px', color: 'var(--orange)', display: 'flex', alignItems: 'center', gap: 6 }}>
                                                        <AlertTriangle size={16} /> Zona No Conforme (Cuarentena / Dañado)
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
                                                          label="Ubicación Física Cuarentena"
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

                                                  {/* METADATOS COMUNES */}
                                                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginTop: 14 }}>
                                                    <div className="form-group">
                                                      <label className="form-label">Lote (Opcional)</label>
                                                      <input 
                                                        className="form-input" 
                                                        placeholder="Ej. LOT-2026-A"
                                                        value={processForm.lote} 
                                                        onChange={e => setProcessForm({ ...processForm, lote: e.target.value })} 
                                                      />
                                                    </div>
                                                    <div className="form-group">
                                                      <label className="form-label">Fecha de Vencimiento</label>
                                                      <input 
                                                        type="date" 
                                                        className="form-input" 
                                                        value={processForm.fechaVencimiento} 
                                                        onChange={e => setProcessForm({ ...processForm, fechaVencimiento: e.target.value })} 
                                                      />
                                                    </div>
                                                    <div className="form-group">
                                                      <label className="form-label">Unidad de Manejo (HU)</label>
                                                      <select 
                                                        className="form-select form-select-full" 
                                                        value={processForm.tipoHu} 
                                                        onChange={e => setProcessForm({ ...processForm, tipoHu: e.target.value })}
                                                      >
                                                        <option value="CAJA">Caja</option>
                                                        <option value="PALLET">Pallet Completo</option>
                                                        <option value="BULTO">Bulto / Paquete</option>
                                                      </select>
                                                    </div>
                                                  </div>

                                                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14, flexWrap: 'wrap' }}>
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
