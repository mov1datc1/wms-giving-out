import React, { useState, useEffect, useRef } from 'react';
import {
  ShieldAlert, AlertTriangle, CheckCircle2, XCircle, Lock,
  Printer, X, ArrowRight, CornerDownRight, Box, Boxes,
  FileText, ShieldCheck, Tag, Calendar, MapPin, AlertOctagon, RotateCcw
} from 'lucide-react';
import JsBarcode from 'jsbarcode';
import { API } from '../config/api';

export interface DivertItemRow {
  skuId: string;
  skuCodigo: string;
  skuDescripcion: string;
  cantidad: number;
  lote: string;
  fechaVencimiento: string;
  receiptLineId?: string;
  motivoEspecifico: string;
}

export interface DivertToVirtualModalProps {
  receipt?: any;
  initialItems?: Array<Partial<DivertItemRow>>;
  initialTipoDesvio?: 'MERMA' | 'EXCESO';
  directPrintMode?: boolean;
  initialResult?: any;
  token?: string;
  onClose: () => void;
  onSuccess?: (result: any) => void;
}

const MOTIVOS_MERMA = [
  'Mercancía averiada o con daño físico imputable a maniobra o transporte en tránsito',
  'Empaque primario roto con fuga o exposición de producto',
  'Caducidad menor a política mínima de aceptación NOM-251/COFEPRIS',
  'Producto en mal estado físico detectado en descarga de andén',
  'Merma por aplastamiento o colapso de estiba',
  'Lote no conforme o sospecha de contaminación',
];

const MOTIVOS_EXCESO = [
  'Sobrante físico no amparado en factura / orden de compra',
  'Excedente de piezas remitido por proveedor sin orden de compra',
  'Diferencia de bultos superior a la remisión fiscal',
  'Piezas adicionales identificadas en conteo ciego de andén',
  'Excedente en custodia preventiva pendiente de nota de crédito / alcance',
];

export function DivertToVirtualModal({
  receipt,
  initialItems = [],
  initialTipoDesvio = 'MERMA',
  directPrintMode = false,
  initialResult,
  token,
  onClose,
  onSuccess,
}: DivertToVirtualModalProps) {
  const [tipoDesvio, setTipoDesvio] = useState<'MERMA' | 'EXCESO'>(initialTipoDesvio);
  const [motivoGeneral, setMotivoGeneral] = useState(
    initialTipoDesvio === 'MERMA' ? MOTIVOS_MERMA[0] : MOTIVOS_EXCESO[0]
  );
  const [notas, setNotas] = useState('');
  const [items, setItems] = useState<DivertItemRow[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const initialDivertResult = initialResult || (directPrintMode ? {
    folioActa: receipt?.codigo || receipt?.folioActa || 'ACTA-NC-2026-00001',
    totalPiezas: initialItems.reduce((acc, it) => acc + (Number(it.cantidad) || 0), 0) || 1,
    ubicacionDestino: receipt?.ubicacion?.codigo || (initialTipoDesvio === 'MERMA' ? 'DEV-01' : 'NC-EXCESO-01'),
    motivo: initialItems[0]?.motivoEspecifico || 'Mercancía en retención de calidad / cuarentena',
    handlingUnits: [{ codigo: receipt?.huCodigo || `HU-NC-2026-${(receipt?.codigo || '00001').slice(-5)}` }]
  } : null);

  const [divertResult, setDivertResult] = useState<any | null>(initialDivertResult);
  const [showPrintLabel, setShowPrintLabel] = useState<boolean>(directPrintMode);

  const barcodeActaRef = useRef<SVGSVGElement>(null);
  const barcodeHuRef = useRef<SVGSVGElement>(null);

  // Inicializar partidas a desviar
  useEffect(() => {
    if (initialItems && initialItems.length > 0) {
      setItems(
        initialItems.map(item => ({
          skuId: item.skuId || '',
          skuCodigo: item.skuCodigo || 'SKU-DESC',
          skuDescripcion: item.skuDescripcion || 'Producto',
          cantidad: Number(item.cantidad) > 0 ? Number(item.cantidad) : 1,
          lote: item.lote || '',
          fechaVencimiento: item.fechaVencimiento || '',
          receiptLineId: item.receiptLineId,
          motivoEspecifico: item.motivoEspecifico || '',
        }))
      );
    } else if (receipt && receipt.lineas) {
      // Auto-poblar partidas con daño o exceso detectado en la recepción
      const autoItems: DivertItemRow[] = [];
      receipt.lineas.forEach((l: any) => {
        const dan = Number(l.cantidadDanada || 0);
        const rec = Number(l.cantidadRecibida || 0);
        const esp = Number(l.cantidadEsperada || 0);
        const diff = rec - esp;

        if (tipoDesvio === 'MERMA' && dan > 0) {
          autoItems.push({
            skuId: l.skuId,
            skuCodigo: l.sku?.codigo || 'SKU',
            skuDescripcion: l.sku?.descripcion || 'Producto',
            cantidad: dan,
            lote: l.loteAsignado || '',
            fechaVencimiento: l.fechaVencimiento ? l.fechaVencimiento.split('T')[0] : '',
            receiptLineId: l.id,
            motivoEspecifico: 'Daño físico registrado durante descarga en andén',
          });
        } else if (tipoDesvio === 'EXCESO' && diff > 0) {
          autoItems.push({
            skuId: l.skuId,
            skuCodigo: l.sku?.codigo || 'SKU',
            skuDescripcion: l.sku?.descripcion || 'Producto',
            cantidad: diff,
            lote: l.loteAsignado || '',
            fechaVencimiento: l.fechaVencimiento ? l.fechaVencimiento.split('T')[0] : '',
            receiptLineId: l.id,
            motivoEspecifico: `Excedente no amparado en factura (+${diff} piezas)`,
          });
        }
      });

      // Si no se detectaron automáticamente, pre-cargar todas las líneas con cantidad 0 para que el operador elija
      if (autoItems.length === 0) {
        receipt.lineas.forEach((l: any) => {
          autoItems.push({
            skuId: l.skuId,
            skuCodigo: l.sku?.codigo || 'SKU',
            skuDescripcion: l.sku?.descripcion || 'Producto',
            cantidad: Number(l.cantidadDanada || 0) || 1,
            lote: l.loteAsignado || '',
            fechaVencimiento: l.fechaVencimiento ? l.fechaVencimiento.split('T')[0] : '',
            receiptLineId: l.id,
            motivoEspecifico: '',
          });
        });
      }
      setItems(autoItems);
    }
  }, [receipt, tipoDesvio]);

  // Renderizar códigos de barras cuando se muestre el resultado exitoso
  useEffect(() => {
    if (divertResult && barcodeActaRef.current) {
      try {
        JsBarcode(barcodeActaRef.current, divertResult.folioActa, {
          format: 'CODE128',
          width: 1.8,
          height: 48,
          displayValue: true,
          font: 'monospace',
          fontSize: 13,
          lineColor: '#000000',
        });
      } catch (e) {
        console.warn('Error rendering barcodeActa', e);
      }
    }
    if (divertResult && divertResult.handlingUnits?.[0] && barcodeHuRef.current) {
      try {
        JsBarcode(barcodeHuRef.current, divertResult.handlingUnits[0].codigo, {
          format: 'CODE128',
          width: 1.8,
          height: 48,
          displayValue: true,
          font: 'monospace',
          fontSize: 13,
          lineColor: '#000000',
        });
      } catch (e) {
        console.warn('Error rendering barcodeHu', e);
      }
    }
  }, [divertResult, showPrintLabel]);

  const handleItemChange = (index: number, field: keyof DivertItemRow, value: any) => {
    setItems(prev => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
    if (errorBanner) setErrorBanner(null);
  };

  const handleRemoveItem = (index: number) => {
    setItems(prev => prev.filter((_, i) => i !== index));
  };

  const handleExecuteDivert = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorBanner(null);

    const validItems = items.filter(it => it.skuId && Number(it.cantidad) > 0);
    if (validItems.length === 0) {
      setErrorBanner('Debe especificar al menos una partida con cantidad mayor a 0 para desviar.');
      return;
    }

    if (!motivoGeneral.trim()) {
      setErrorBanner('Por favor seleccione o redacte el motivo de la segregación.');
      return;
    }

    const clienteId = receipt?.clienteId;
    if (!clienteId) {
      setErrorBanner('No se pudo determinar el cliente de la recepción.');
      return;
    }

    setSubmitting(true);
    try {
      const mappedItems = validItems.map(it => ({
        skuId: it.skuId,
        cantidad: Number(it.cantidad),
        tipoDesvio: tipoDesvio === 'MERMA' ? ('MERCANCIA_DANADA' as const) : ('PRODUCTO_EXCESO' as const),
        motivo: it.motivoEspecifico?.trim() || motivoGeneral.trim() || 'Desvío a almacén virtual de cuarentena',
        lote: it.lote.trim() || undefined,
        fechaVencimiento: it.fechaVencimiento || undefined,
        receiptLineId: it.receiptLineId,
      }));

      const payload = {
        clienteId,
        tipoDesvio: tipoDesvio === 'MERMA' ? 'MERCANCIA_DANADA' : 'PRODUCTO_EXCESO',
        receiptId: receipt?.id,
        usuario: 'Supervisor Giving Out',
        motivo: motivoGeneral.trim(),
        notas: notas.trim() || undefined,
        notasGenerales: notas.trim() || undefined,
        partidas: mappedItems,
        items: mappedItems,
      };

      const res = await fetch(`${API}/inventory/divert-to-virtual`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Error al ejecutar el desvío al almacén virtual');
      }

      setDivertResult(data);
      if (onSuccess) onSuccess(data);
    } catch (err: any) {
      console.error(err);
      setErrorBanner(err.message || 'Error de conexión con el servidor');
    } finally {
      setSubmitting(false);
    }
  };

  const totalPiezas = items.reduce((acc, it) => acc + (Number(it.cantidad) || 0), 0);
  const targetLocation = tipoDesvio === 'MERMA' ? 'DEV-01 (Cuarentena)' : 'NC-EXCESO-01 (Cuarentena)';

  const handlePrintQuarantineTag = () => {
    const printNode = document.getElementById('print-quarantine-tag');
    const folio = divertResult?.folioActa || 'ACTA-NC';

    // Intento 1: Ventana limpia desacoplada (idéntica a ReceiptReportModal)
    try {
      const printWindow = window.open('', '_blank', 'width=880,height=950');
      if (printWindow && printNode) {
        printWindow.document.open();
        printWindow.document.write(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>Papeleta de Cuarentena — ${folio}</title>
  <style>
    @page {
      size: letter portrait;
      margin: 8mm 10mm;
    }
    * {
      box-sizing: border-box !important;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    body {
      margin: 0;
      padding: 14px;
      background: #FFFFFF !important;
      color: #000000 !important;
      font-family: Arial, Helvetica, sans-serif;
    }
    #print-quarantine-tag {
      border: 4px solid #DC2626 !important;
      border-radius: 6px !important;
      padding: 16px !important;
      background: #FFFFFF !important;
      max-width: 820px !important;
      margin: 0 auto !important;
    }
    .print-badge-red {
      background: #DC2626 !important;
      color: #FFFFFF !important;
      text-align: center !important;
      padding: 12px 10px !important;
      border-radius: 4px !important;
      margin-bottom: 14px !important;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    .print-badge-red h1 {
      margin: 0 !important;
      font-size: 22px !important;
      font-weight: 900 !important;
      color: #FFFFFF !important;
    }
    .print-badge-red p {
      margin: 4px 0 0 !important;
      font-size: 12px !important;
      font-weight: 700 !important;
      color: #FFFFFF !important;
    }
    table {
      width: 100% !important;
      border-collapse: collapse !important;
    }
    th, td {
      border: 1px solid #CBD5E1 !important;
      padding: 6px 8px !important;
    }
    th {
      background: #F1F5F9 !important;
      font-weight: 800 !important;
      color: #334155 !important;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    svg {
      max-width: 100% !important;
      height: auto !important;
      display: block !important;
      margin: 0 auto !important;
    }
  </style>
</head>
<body>
  ${printNode.outerHTML}
  <script>
    setTimeout(function() {
      window.focus();
      window.print();
    }, 250);
  </script>
</body>
</html>`);
        printWindow.document.close();
        return;
      }
    } catch (e) {
      console.warn('Popup blocked or failed, fallback to native window.print()', e);
    }

    // Intento 2: Impresión nativa directa sobre la pantalla actual
    window.print();
  };

  // VISTA 1: PAPELETA OFICIAL IMPRIMIBLE DE CUARENTENA / MERMA (PALLET TAG)
  if (divertResult && showPrintLabel) {
    const huCode = divertResult.handlingUnits?.[0]?.codigo || 'HU-NC-PENDIENTE';
    const clientName = receipt?.cliente?.nombreComercial || receipt?.cliente?.nombreEmpresa || 'CLIENTE WMS';

    return (
      <div className="modal-overlay" style={{ zIndex: 99999, background: 'rgba(0,0,0,0.85)' }}>
        <style>{`
          @media print {
            @page {
              size: letter portrait;
              margin: 8mm 10mm;
            }
            html, body, #root, .app-layout, .app-main, .app-content, .page-container {
              background: #FFFFFF !important;
              color: #000000 !important;
              margin: 0 !important;
              padding: 0 !important;
              overflow: visible !important;
              height: auto !important;
              width: 100% !important;
              transform: none !important;
              animation: none !important;
              filter: none !important;
              backdrop-filter: none !important;
              -webkit-backdrop-filter: none !important;
            }
            .sidebar,
            .topbar,
            .page-header,
            .no-print,
            .tabs,
            .filter-bar,
            .table-pagination,
            .data-table-wrapper,
            .btn,
            .card,
            nav,
            header {
              display: none !important;
            }
            .modal-overlay {
              position: static !important;
              background: #FFFFFF !important;
              backdrop-filter: none !important;
              -webkit-backdrop-filter: none !important;
              padding: 0 !important;
              margin: 0 !important;
              display: block !important;
              overflow: visible !important;
              height: auto !important;
              width: 100% !important;
              box-shadow: none !important;
              animation: none !important;
              transform: none !important;
            }
            #print-area {
              display: block !important;
              position: static !important;
              width: 100% !important;
              max-width: 820px !important;
              padding: 0 !important;
              margin: 0 auto !important;
              box-shadow: none !important;
              border: none !important;
              background: #FFFFFF !important;
              color: #000000 !important;
              overflow: visible !important;
              height: auto !important;
              max-height: none !important;
            }
            #print-quarantine-tag {
              display: block !important;
              border: 4px solid #DC2626 !important;
              border-radius: 6px !important;
              padding: 16px !important;
              margin: 0 auto !important;
              page-break-inside: avoid !important;
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
              background: #FFFFFF !important;
            }
            .print-badge-red {
              background: #DC2626 !important;
              color: #FFFFFF !important;
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }
          }
        `}</style>
        <div id="print-area" style={{
          background: '#FFFFFF',
          color: '#000000',
          width: '780px',
          maxWidth: '95vw',
          maxHeight: '92vh',
          overflowY: 'auto',
          borderRadius: 8,
          padding: 24,
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
          fontFamily: 'Arial, sans-serif'
        }}>
          {/* Barra de control no imprimible */}
          <div className="no-print" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, borderBottom: '1px solid #E2E8F0', paddingBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <ShieldAlert size={20} color="#DC2626" />
              <span style={{ fontWeight: 800, fontSize: 16, color: '#0F172A' }}>
                Papeleta de Retención en Cuarentena (Ficha Física de Pallet)
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={handlePrintQuarantineTag}
                className="btn"
                style={{ background: '#DC2626', color: '#FFF', fontWeight: 700, fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 6, cursor: 'pointer', border: 'none', boxShadow: '0 2px 6px rgba(220, 38, 38, 0.4)' }}
                title="Abre diálogo de impresión oficial listo para imprimir"
              >
                <Printer size={15} /> Imprimir Etiqueta
              </button>
              <button
                type="button"
                onClick={handlePrintQuarantineTag}
                className="btn btn-secondary"
                style={{ fontSize: 13, padding: '8px 14px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                title="Lanzar diálogo directo de impresión"
              >
                <FileText size={15} /> Imprimir Rápido (Ctrl+P)
              </button>
              <button
                type="button"
                onClick={() => setShowPrintLabel(false)}
                className="btn btn-secondary"
                style={{ fontSize: 13, padding: '8px 14px', cursor: 'pointer' }}
              >
                Volver
              </button>
            </div>
          </div>

          {/* CUERPO OFICIAL DEL TAG FISICO (ESTILO NOM-251 / AUDITORÍA COFEPRIS) */}
          <div id="print-quarantine-tag" style={{
            border: '4px solid #DC2626',
            borderRadius: 6,
            padding: 18,
            background: '#FFFFFF'
          }}>
            {/* Cabecera Roja de Advertencia */}
            <div className="print-badge-red" style={{
              background: '#DC2626',
              color: '#FFFFFF',
              textAlign: 'center',
              padding: '12px 10px',
              borderRadius: 4,
              marginBottom: 16,
              WebkitPrintColorAdjust: 'exact',
              printColorAdjust: 'exact',
            }}>
              <h1 style={{ margin: 0, fontSize: 24, fontWeight: 900, letterSpacing: '1px', color: '#FFFFFF' }}>
                MATERIAL NO CONFORME / CUARENTENA
              </h1>
              <p style={{ margin: '4px 0 0', fontSize: 13, fontWeight: 700, letterSpacing: '0.5px', color: '#FFFFFF' }}>
                PROHIBIDO SU DESPACHO, PICKING O MOVILIZACIÓN SIN AUTORIZACIÓN DE CALIDAD
              </p>
            </div>

            {/* Datos Clave en Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
              <div style={{ border: '1px solid #CBD5E1', padding: 10, borderRadius: 4 }}>
                <div style={{ fontSize: 11, color: '#64748B', fontWeight: 700, textTransform: 'uppercase' }}>Folio de Acta Oficial</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: '#0F172A', fontFamily: 'monospace' }}>
                  {divertResult.folioActa}
                </div>
              </div>
              <div style={{ border: '1px solid #CBD5E1', padding: 10, borderRadius: 4 }}>
                <div style={{ fontSize: 11, color: '#64748B', fontWeight: 700, textTransform: 'uppercase' }}>Ubicación Virtual Destino</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: '#DC2626' }}>
                  {divertResult.ubicacionDestino} (ZONA DEVOLUCIÓN)
                </div>
              </div>
              <div style={{ border: '1px solid #CBD5E1', padding: 10, borderRadius: 4 }}>
                <div style={{ fontSize: 11, color: '#64748B', fontWeight: 700, textTransform: 'uppercase' }}>Cliente Titular</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#0F172A' }}>
                  {clientName}
                </div>
              </div>
              <div style={{ border: '1px solid #CBD5E1', padding: 10, borderRadius: 4 }}>
                <div style={{ fontSize: 11, color: '#64748B', fontWeight: 700, textTransform: 'uppercase' }}>Clasificación de Desvío</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: tipoDesvio === 'MERMA' ? '#DC2626' : '#0284C7' }}>
                  {tipoDesvio === 'MERMA' ? 'MERMA / DAÑADO FÍSICO' : 'PRODUCTO EN EXCESO / SOBRANTE'}
                </div>
              </div>
            </div>

            {/* Códigos de Barras Code-128 */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16, background: '#F8FAFC', border: '1px dashed #CBD5E1', padding: 12, borderRadius: 4 }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#475569', marginBottom: 4 }}>CÓDIGO HU (HANDLING UNIT)</div>
                <svg ref={barcodeHuRef} style={{ maxWidth: '100%' }} />
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#475569', marginBottom: 4 }}>FOLIO ACTA DE NO CONFORMIDAD</div>
                <svg ref={barcodeActaRef} style={{ maxWidth: '100%' }} />
              </div>
            </div>

            {/* Tabla de Productos Retenidos */}
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 16, fontSize: 12 }}>
              <thead>
                <tr style={{ background: '#F1F5F9', borderBottom: '2px solid #CBD5E1' }}>
                  <th style={{ padding: '6px 8px', textAlign: 'left' }}>SKU</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left' }}>Descripción</th>
                  <th style={{ padding: '6px 8px', textAlign: 'center' }}>Lote</th>
                  <th style={{ padding: '6px 8px', textAlign: 'center' }}>Caducidad</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right' }}>Cant. Retenida</th>
                </tr>
              </thead>
              <tbody>
                {items.filter(it => Number(it.cantidad) > 0).map((it, idx) => (
                  <tr key={idx} style={{ borderBottom: '1px solid #E2E8F0' }}>
                    <td style={{ padding: '6px 8px', fontWeight: 700, fontFamily: 'monospace' }}>{it.skuCodigo}</td>
                    <td style={{ padding: '6px 8px' }}>{it.skuDescripcion}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'center', fontFamily: 'monospace' }}>{it.lote || 'N/A'}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'center' }}>{it.fechaVencimiento || 'N/A'}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 800, color: '#DC2626' }}>{it.cantidad} pzas</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: '#F8FAFC', fontWeight: 800 }}>
                  <td colSpan={4} style={{ padding: '8px', textAlign: 'right' }}>TOTAL PIEZAS BLOQUEADAS:</td>
                  <td style={{ padding: '8px', textAlign: 'right', color: '#DC2626', fontSize: 14 }}>
                    {divertResult.totalPiezas} pzas
                  </td>
                </tr>
              </tfoot>
            </table>

            {/* Motivo Dictaminado */}
            <div style={{ background: '#FEF2F2', border: '1px solid #F87171', borderRadius: 4, padding: 10, marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#991B1B', textTransform: 'uppercase' }}>Dictamen / Causa Raíz:</div>
              <div style={{ fontSize: 12, color: '#7F1D1D', marginTop: 2, fontWeight: 600 }}>{divertResult.motivo || motivoGeneral}</div>
              {notas && (
                <div style={{ fontSize: 11, color: '#991B1B', marginTop: 4, fontStyle: 'italic' }}>
                  Nota operativa: {notas}
                </div>
              )}
            </div>

            {/* Firmas de Responsabilidad */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginTop: 24, paddingTop: 16, borderTop: '1px solid #CBD5E1' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ height: 35 }}></div>
                <div style={{ borderTop: '1px solid #000', fontSize: 11, fontWeight: 700, paddingTop: 4 }}>
                  Inspector de Calidad
                </div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ height: 35 }}></div>
                <div style={{ borderTop: '1px solid #000', fontSize: 11, fontWeight: 700, paddingTop: 4 }}>
                  Supervisor de Andén WMS
                </div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ height: 35 }}></div>
                <div style={{ borderTop: '1px solid #000', fontSize: 11, fontWeight: 700, paddingTop: 4 }}>
                  Transportista / Entrega
                </div>
              </div>
            </div>

            <div style={{ textAlign: 'center', fontSize: 10, color: '#64748B', marginTop: 16 }}>
              Sistema Giving Out WMS · Generado el {new Date().toLocaleString('es-MX')} · Folio {divertResult.folioActa}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // VISTA 2: RESULTADO DE ÉXITO POST-EJECUCIÓN
  if (divertResult) {
    return (
      <div className="modal-overlay" style={{ zIndex: 9999, background: 'rgba(15, 23, 42, 0.5)', backdropFilter: 'blur(4px)' }}>
        <div style={{
          background: '#FFFFFF',
          border: '1px solid #E2E8F0',
          borderRadius: 12,
          padding: 28,
          width: '640px',
          maxWidth: '92vw',
          color: '#0F172A',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)'
        }}>
          <div style={{ textAlign: 'center', marginBottom: 20 }}>
            <div style={{
              width: 56,
              height: 56,
              borderRadius: '50%',
              background: '#D1FAE5',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 12,
              border: '1px solid #A7F3D0'
            }}>
              <CheckCircle2 size={32} color="#059669" />
            </div>
            <h2 style={{ fontSize: 20, fontWeight: 800, margin: 0, color: '#0F172A' }}>
              Desvío a Almacén Virtual Realizado
            </h2>
            <p style={{ fontSize: 13, color: '#64748B', marginTop: 4 }}>
              Las mercancías han sido segregadas físicamente y bloqueadas en el WMS.
            </p>
          </div>

          <div style={{ background: '#F8FAFC', borderRadius: 8, padding: 16, marginBottom: 20, border: '1px solid #E2E8F0' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <div style={{ fontSize: 11, color: '#64748B' }}>FOLIO ACTA DE NO CONFORMIDAD</div>
                <div style={{ fontSize: 15, fontWeight: 800, color: '#0284C7', fontFamily: 'monospace', marginTop: 2 }}>
                  {divertResult.folioActa}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: '#64748B' }}>UBICACIÓN DESTINO VIRTUAL</div>
                <div style={{ fontSize: 15, fontWeight: 800, color: '#D97706', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <MapPin size={14} /> {divertResult.ubicacionDestino}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: '#64748B' }}>TOTAL PIEZAS SEGREGADAS</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: '#DC2626', marginTop: 2 }}>
                  {divertResult.totalPiezas} piezas
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: '#64748B' }}>HANDLING UNIT GENERADA</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#7C3AED', fontFamily: 'monospace', marginTop: 2 }}>
                  {divertResult.handlingUnits?.[0]?.codigo || 'N/A'}
                </div>
              </div>
            </div>

            <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#059669' }}>
              <Lock size={14} />
              <span>
                <strong>Aislamiento Seguro Activo:</strong> Cantidad disponible = 0 pzas (100% blindado contra picking).
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              style={{ background: '#FFFFFF', color: '#475569', borderColor: '#CBD5E1' }}
            >
              Cerrar
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setShowPrintLabel(true)}
              style={{
                background: '#DC2626',
                borderColor: '#DC2626',
                color: '#FFF',
                fontWeight: 700,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6
              }}
            >
              <Printer size={15} /> Imprimir Papeleta de Cuarentena
            </button>
          </div>
        </div>
      </div>
    );
  }

  // VISTA 3: FORMULARIO PRINCIPAL DE CAPTURA Y SEGREGACIÓN
  return (
    <div className="modal-overlay" style={{ zIndex: 9999, background: 'rgba(15, 23, 42, 0.5)', backdropFilter: 'blur(4px)' }}>
      <div style={{
        background: '#FFFFFF',
        border: '1px solid #E2E8F0',
        borderRadius: 12,
        padding: 24,
        width: '840px',
        maxWidth: '95vw',
        maxHeight: '90vh',
        overflowY: 'auto',
        color: '#0F172A',
        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)'
      }}>
        {/* Encabezado */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18, borderBottom: '1px solid #E2E8F0', paddingBottom: 14 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <ShieldAlert size={22} color={tipoDesvio === 'MERMA' ? '#DC2626' : '#0284C7'} />
              <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0, color: '#0F172A' }}>
                Subflujo: Desviar a Almacén Virtual de No Conforme / Merma
              </h2>
            </div>
            <p style={{ fontSize: 12, color: '#64748B', margin: '4px 0 0 30px' }}>
              Recepción: <strong>{receipt?.codigo || 'En Andén'}</strong> · Cliente: <strong>{receipt?.cliente?.nombreComercial || 'Asignado'}</strong>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: '#64748B', cursor: 'pointer', padding: 4 }}
          >
            <X size={20} />
          </button>
        </div>

        {errorBanner && (
          <div style={{
            background: 'rgba(239, 68, 68, 0.12)',
            border: '1px solid #EF4444',
            borderRadius: 6,
            padding: '10px 14px',
            marginBottom: 16,
            fontSize: 12,
            color: '#FCA5A5',
            display: 'flex',
            alignItems: 'center',
            gap: 8
          }}>
            <AlertTriangle size={16} style={{ flexShrink: 0 }} />
            <span>{errorBanner}</span>
          </div>
        )}

        <form onSubmit={handleExecuteDivert}>
          {/* Conmutador de Tipo de Desvío */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: '#334155', display: 'block', marginBottom: 6 }}>
              1. Naturaleza de la Mercancía No Conforme:
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <button
                type="button"
                onClick={() => {
                  setTipoDesvio('MERMA');
                  setMotivoGeneral(MOTIVOS_MERMA[0]);
                }}
                style={{
                  padding: 12,
                  borderRadius: 8,
                  border: tipoDesvio === 'MERMA' ? '2px solid #EF4444' : '1px solid #CBD5E1',
                  background: tipoDesvio === 'MERMA' ? '#FEF2F2' : '#FFFFFF',
                  textAlign: 'left',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10
                }}
              >
                <AlertTriangle size={20} color="#DC2626" style={{ flexShrink: 0, marginTop: 2 }} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: tipoDesvio === 'MERMA' ? '#DC2626' : '#0F172A' }}>
                    Mercancía Dañada / Merma Física
                  </div>
                  <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>
                    Avería, derrame, rotura de empaque o caducidad menor a política. Destino: <strong>DEV-01</strong>.
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  setTipoDesvio('EXCESO');
                  setMotivoGeneral(MOTIVOS_EXCESO[0]);
                }}
                style={{
                  padding: 12,
                  borderRadius: 8,
                  border: tipoDesvio === 'EXCESO' ? '2px solid #0284C7' : '1px solid #CBD5E1',
                  background: tipoDesvio === 'EXCESO' ? '#F0F9FF' : '#FFFFFF',
                  textAlign: 'left',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10
                }}
              >
                <Boxes size={20} color="#0284C7" style={{ flexShrink: 0, marginTop: 2 }} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: tipoDesvio === 'EXCESO' ? '#0284C7' : '#0F172A' }}>
                    Producto en Exceso / Sobrante
                  </div>
                  <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>
                    Excedente físico no amparado en factura u orden de compra. Destino: <strong>NC-EXCESO-01</strong>.
                  </div>
                </div>
              </button>
            </div>
          </div>

          {/* Motivo y Justificación Técnica */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 12, marginBottom: 16 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 700, color: '#334155', display: 'block', marginBottom: 4 }}>
                2. Causa Raíz / Motivo de Segregación:
              </label>
              <select
                className="form-select"
                value={motivoGeneral}
                onChange={e => setMotivoGeneral(e.target.value)}
                style={{ background: '#FFFFFF', color: '#0F172A', fontSize: 12, width: '100%', borderRadius: 6, borderColor: '#CBD5E1' }}
              >
                {(tipoDesvio === 'MERMA' ? MOTIVOS_MERMA : MOTIVOS_EXCESO).map((mot, i) => (
                  <option key={i} value={mot}>{mot}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 700, color: '#334155', display: 'block', marginBottom: 4 }}>
                Notas Operativas / Bitácora de Andén:
              </label>
              <input
                type="text"
                className="form-input"
                placeholder="Ej. Evidencia fotográfica tomada en rampa 4..."
                value={notas}
                onChange={e => setNotas(e.target.value)}
                style={{ background: '#FFFFFF', color: '#0F172A', fontSize: 12, width: '100%', borderRadius: 6, borderColor: '#CBD5E1' }}
              />
            </div>
          </div>

          {/* Tabla de Partidas */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: '#334155' }}>
                3. Partidas y Cantidades a Desviar:
              </label>
              <span style={{ fontSize: 11, color: '#64748B' }}>
                Destino asignado: <strong style={{ color: '#D97706' }}>{targetLocation}</strong>
              </span>
            </div>

            <div style={{
              background: '#FFFFFF',
              borderRadius: 8,
              border: '1px solid #E2E8F0',
              overflow: 'hidden'
            }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: '#F8FAFC', borderBottom: '1px solid #E2E8F0' }}>
                    <th style={{ padding: '8px 10px', textAlign: 'left', color: '#64748B' }}>SKU / Producto</th>
                    <th style={{ padding: '8px 10px', textAlign: 'center', width: 90, color: '#DC2626' }}>Cant. Desviar</th>
                    <th style={{ padding: '8px 10px', textAlign: 'center', width: 110, color: '#64748B' }}>Lote</th>
                    <th style={{ padding: '8px 10px', textAlign: 'center', width: 115, color: '#64748B' }}>Caducidad</th>
                    <th style={{ padding: '8px 10px', textAlign: 'left', color: '#64748B' }}>Motivo Específico</th>
                    <th style={{ padding: '8px 10px', width: 35 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid #F1F5F9' }}>
                      <td style={{ padding: '8px 10px' }}>
                        <div style={{ fontWeight: 700, color: '#0284C7', fontFamily: 'monospace' }}>{it.skuCodigo}</div>
                        <div style={{ fontSize: 11, color: '#64748B', maxWidth: 220, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {it.skuDescripcion}
                        </div>
                      </td>
                      <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                        <input
                          type="number"
                          min="0"
                          value={it.cantidad}
                          onChange={e => handleItemChange(idx, 'cantidad', Math.max(0, parseInt(e.target.value) || 0))}
                          style={{
                            width: 70,
                            textAlign: 'center',
                            background: '#FEF2F2',
                            color: '#DC2626',
                            border: '1px solid #FECACA',
                            borderRadius: 4,
                            padding: '4px 6px',
                            fontWeight: 800,
                            fontSize: 13
                          }}
                        />
                      </td>
                      <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                        <input
                          type="text"
                          placeholder="Lote..."
                          value={it.lote}
                          onChange={e => handleItemChange(idx, 'lote', e.target.value)}
                          style={{
                            width: 95,
                            background: '#FFFFFF',
                            color: '#0F172A',
                            border: '1px solid #CBD5E1',
                            borderRadius: 4,
                            padding: '4px 6px',
                            fontSize: 11,
                            fontFamily: 'monospace'
                          }}
                        />
                      </td>
                      <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                        <input
                          type="date"
                          value={it.fechaVencimiento}
                          onChange={e => handleItemChange(idx, 'fechaVencimiento', e.target.value)}
                          style={{
                            width: 110,
                            background: '#FFFFFF',
                            color: '#0F172A',
                            border: '1px solid #CBD5E1',
                            borderRadius: 4,
                            padding: '4px 4px',
                            fontSize: 11
                          }}
                        />
                      </td>
                      <td style={{ padding: '8px 10px' }}>
                        <input
                          type="text"
                          placeholder="Opcional: detalle de daño o motivo..."
                          value={it.motivoEspecifico}
                          onChange={e => handleItemChange(idx, 'motivoEspecifico', e.target.value)}
                          style={{
                            width: '100%',
                            background: '#FFFFFF',
                            color: '#0F172A',
                            border: '1px solid #CBD5E1',
                            borderRadius: 4,
                            padding: '4px 8px',
                            fontSize: 11
                          }}
                        />
                      </td>
                      <td style={{ padding: '8px 6px', textAlign: 'center' }}>
                        {items.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleRemoveItem(idx)}
                            style={{ background: 'transparent', border: 'none', color: '#64748B', cursor: 'pointer', padding: 2 }}
                            title="Quitar de este desvío"
                          >
                            <X size={14} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Banner de Garantía de Aislamiento */}
          <div style={{
            background: '#ECFDF5',
            border: '1px solid #A7F3D0',
            borderRadius: 6,
            padding: '10px 14px',
            marginBottom: 20,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            fontSize: 11,
            color: '#065F46'
          }}>
            <Lock size={16} color="#059669" style={{ flexShrink: 0 }} />
            <div>
              <strong>Garantía de Aislamiento Inmediato:</strong> Este subflujo creará el lote con estado <code>CUARENTENA</code>, <code>cantidadBloqueada = {totalPiezas}</code> y <code>cantidadDisponible = 0</code>. No podrá ser seleccionado en picking ni asignado a órdenes comerciales.
            </div>
          </div>

          {/* Acciones de Cierre */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #E2E8F0', paddingTop: 16 }}>
            <div style={{ fontSize: 12, color: '#64748B' }}>
              Total a segregar: <strong style={{ color: '#DC2626', fontSize: 14 }}>{totalPiezas} pzas</strong> en {items.length} partida(s)
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={onClose}
                disabled={submitting}
                style={{ background: '#FFFFFF', color: '#475569', borderColor: '#CBD5E1' }}
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={submitting || totalPiezas <= 0}
                style={{
                  background: tipoDesvio === 'MERMA' ? '#DC2626' : '#0284C7',
                  borderColor: tipoDesvio === 'MERMA' ? '#DC2626' : '#0284C7',
                  color: '#FFFFFF',
                  fontWeight: 800,
                  fontSize: 13,
                  padding: '8px 18px',
                  borderRadius: 6,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  boxShadow: tipoDesvio === 'MERMA' ? '0 4px 12px rgba(220,38,38,0.35)' : '0 4px 12px rgba(2,132,199,0.35)',
                  cursor: submitting || totalPiezas <= 0 ? 'not-allowed' : 'pointer'
                }}
              >
                {submitting ? (
                  <>Procesando desvío...</>
                ) : (
                  <>
                    <ShieldAlert size={16} /> Ejecutar Desvío a Almacén Virtual ({totalPiezas} pzas)
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
