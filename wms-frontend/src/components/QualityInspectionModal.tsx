import React, { useState, useEffect, useRef } from 'react';
import {
  Microscope, CheckCircle2, AlertTriangle, FileText, Sparkles,
  Clock, ShieldAlert, DollarSign, Layers, Printer, Box, Trash2,
  Archive, User, ArrowRight, X, ChevronRight, RefreshCw, Check,
  RotateCcw, Info, Calendar, Tag, ShieldCheck, HelpCircle, PlusCircle,
  MapPin
} from 'lucide-react';
import JsBarcode from 'jsbarcode';
import { API } from '../config/api';
import { formatTimelineDateTime } from '../utils/dateUtils';

interface QualityInspectionModalProps {
  receipt: any;
  token?: string;
  currentUser?: any;
  onClose: () => void;
  onSuccess?: () => void;
}

interface ItemDictamenState {
  huId: string;
  codigoHu: string;
  skuCodigo: string;
  skuDescripcion: string;
  lote: string;
  fechaVencimiento: string;
  piezasTotales: number;
  piezasRescatadas: number;
  piezasMerma: number;
  motivoDano: string;
  observaciones: string;
  piezasPorCajaEstandar: number;
}

const MOTIVOS_DANO_OPTIONS = [
  { value: 'FRASCO_ROTO_COMPRESION', label: 'Rotura de envase por compresión / estiba pesada' },
  { value: 'FUGA_LIQUIDO_DERRAME', label: 'Fuga de líquido / derrame interior' },
  { value: 'EMPAQUE_DEFORMADO', label: 'Empaque primario deformado / abollado' },
  { value: 'SELLO_VIOLADO', label: 'Sello de inviolabilidad / tapa violada' },
  { value: 'VIDRIO_ASTILLADO', label: 'Vidrio o plástico con astillas / fisuras' },
  { value: 'HUMEDAD_MANCHAS', label: 'Contaminación por humedad exterior' },
  { value: 'OTRO_DANO_FISICO', label: 'Otro daño físico detectado en inspección' }
];

const NON_RACK_LOCATIONS = [
  'RAMPA_RECEPCION',
  'RAMPA',
  'REC-01',
  'RECIBO',
  'RECEPCION',
  'RECEPCIÓN',
  'ANDEN',
  'ANDÉN',
  'AREA_CALIDAD',
  'CALIDAD',
  'CUARENTENA',
  'QA',
  'STAGE',
  'STAGING',
  'TRANSITO',
  'TRÁNSITO'
];

export function isNonRackLocation(location?: string | null): boolean {
  if (!location) return true;
  const clean = location.trim().toUpperCase();
  if (!clean || ['—', '-', 'N/A', 'SIN ASIGNAR'].includes(clean)) return true;
  if (NON_RACK_LOCATIONS.includes(clean)) return true;
  return NON_RACK_LOCATIONS.some((kw) =>
    clean.startsWith(kw) ||
    clean.includes(`_${kw}`) ||
    clean.includes(`${kw}_`) ||
    clean.includes(`/${kw}`)
  );
}

export function QualityInspectionModal({
  receipt,
  token,
  currentUser,
  onClose,
  onSuccess
}: QualityInspectionModalProps) {
  const [activeTab, setActiveTab] = useState<'DICTAMEN' | 'INFORME' | 'ETIQUETAS'>('DICTAMEN');
  const [loading, setLoading] = useState<boolean>(true);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Datos del backend
  const [damagedBoxes, setDamagedBoxes] = useState<any[]>([]);
  const [reportData, setReportData] = useState<any>(null);

  // Identificación física de bultos dañados en andén
  const [unidentifiedCount, setUnidentifiedCount] = useState<number>(0);
  const [lineasDisponibles, setLineasDisponibles] = useState<any[]>([]);
  const [selectedLineId, setSelectedLineId] = useState<string>('');
  const [identifyingLote, setIdentifyingLote] = useState<string>('');
  const [identifyingVencimiento, setIdentifyingVencimiento] = useState<string>('');
  const [identifyingPiezas, setIdentifyingPiezas] = useState<number | string>(12);
  const [identifyingMotivo, setIdentifyingMotivo] = useState<string>('Rotura de envase por compresión / estiba pesada');
  const [identifyingObservaciones, setIdentifyingObservaciones] = useState<string>('');
  const [identifyingLoading, setIdentifyingLoading] = useState<boolean>(false);

  // Formulario de dictamen
  const [dictamenItems, setDictamenItems] = useState<ItemDictamenState[]>([]);
  const [inspectorNombre, setInspectorNombre] = useState<string>(
    currentUser?.nombre || currentUser?.name || 'Inspector de Calidad'
  );
  const [horasMaquila, setHorasMaquila] = useState<number | string>(0.0);
  const [tarifaMaquilaPorHora, setTarifaMaquilaPorHora] = useState<number | string>(
    receipt?.cliente?.tarifaMaquilaPorHora || receipt?.cliente?.tarifaMaquila || 0.0
  );
  const [observacionesGenerales, setObservacionesGenerales] = useState<string>(
    'Inspección interna pieza por pieza y reacondicionamiento conforme a protocolo Giving Out 3PL.'
  );
  const [armarCajasConformes, setArmarCajasConformes] = useState<boolean>(true);

  // Modal / Impresión
  const reportPrintRef = useRef<HTMLDivElement>(null);
  const barcodeSvgs = useRef<{ [key: string]: SVGSVGElement | null }>({});

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };

  // Cargar datos iniciales
  const loadInspectionData = async () => {
    if (!receipt?.id) return;
    setLoading(true);
    setErrorMsg(null);

    try {
      // 1. Cargar cajas pendientes
      const resPending = await fetch(`${API}/receipts/${receipt.id}/inspection-pending`, { credentials: 'omit', headers });
      if (!resPending.ok) {
        throw new Error(`Error al consultar cajas de inspección (${resPending.status})`);
      }
      const dataPending = await resPending.json();
      const boxes = dataPending.pendingBoxes || dataPending.damagedBoxes || [];
      setDamagedBoxes(boxes);

      const unident = Number(dataPending.unidentifiedDamagedCount || 0);
      setUnidentifiedCount(unident);
      const lines = dataPending.lineasDisponibles || [];
      setLineasDisponibles(lines);

      if (lines.length > 0) {
        setSelectedLineId(prev => {
          const match = lines.find((l: any) => l.id === prev);
          const active = match || lines[0];
          setIdentifyingLote(active.lote || '');
          setIdentifyingVencimiento(active.fechaVencimiento ? String(active.fechaVencimiento).slice(0, 10) : '');
          setIdentifyingPiezas(active.piezasPorCaja || 12);
          return active.id;
        });
      }

      // Mapear cajas al estado de dictamen
      const initialItems: ItemDictamenState[] = boxes.map((box: any) => {
        const totalPzas = Number(box.piezasTotales || box.piezasPorHu || box.cantidad || 12);
        return {
          huId: box.id,
          codigoHu: box.codigo || box.codigoHu,
          skuCodigo: box.skuCodigo || box.sku?.codigo || 'SKU',
          skuDescripcion: box.skuDescripcion || box.sku?.descripcion || 'Producto',
          lote: box.loteTexto || box.lote || 'S/L',
          fechaVencimiento: box.fechaVencimiento ? String(box.fechaVencimiento).slice(0, 10) : '',
          piezasTotales: totalPzas,
          piezasRescatadas: totalPzas, // Por defecto asumimos que se busca rescatar
          piezasMerma: 0,
          motivoDano: box.motivoDano || 'Rotura de envase por compresión / estiba pesada',
          observaciones: '',
          piezasPorCajaEstandar: box.piezasPorCaja || box.sku?.piezasPorCaja || totalPzas,
        };
      });
      setDictamenItems(initialItems);

      // 2. Cargar informe histórico si ya existe
      const resReport = await fetch(`${API}/receipts/${receipt.id}/inspection/report`, { credentials: 'omit', headers });
      if (resReport.ok) {
        const reportJson = await resReport.json();
        setReportData(reportJson);
        // Si no hay cajas pendientes ni bultos sin identificar pero sí hay inspección completada, pasar directo al informe
        if (boxes.length === 0 && unident === 0 && reportJson.inspeccion) {
          setActiveTab('INFORME');
        }
      }
    } catch (err: any) {
      console.error('Error cargando datos de inspección:', err);
      setErrorMsg(err.message || 'No fue posible obtener los datos de inspección.');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectLine = (lineId: string) => {
    setSelectedLineId(lineId);
    const line = lineasDisponibles.find(l => l.id === lineId);
    if (line) {
      setIdentifyingLote(line.lote || '');
      setIdentifyingVencimiento(line.fechaVencimiento ? String(line.fechaVencimiento).slice(0, 10) : '');
      setIdentifyingPiezas(line.piezasPorCaja || 12);
    }
  };

  const handleIdentifyBox = async () => {
    if (!selectedLineId) {
      setErrorMsg('Debe seleccionar la partida correspondiente al bulto dañado.');
      return;
    }
    if (Number(identifyingPiezas) <= 0) {
      setErrorMsg('La cantidad de piezas por caja debe ser mayor a 0.');
      return;
    }

    setIdentifyingLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const payload = {
        receiptLineId: selectedLineId,
        piezasTotales: Number(identifyingPiezas),
        loteTexto: identifyingLote.trim(),
        fechaVencimiento: identifyingVencimiento ? new Date(identifyingVencimiento).toISOString() : undefined,
        motivoDano: identifyingMotivo,
        observaciones: identifyingObservaciones.trim(),
        usuario: inspectorNombre,
      };

      const res = await fetch(`${API}/receipts/${receipt.id}/identify-damaged-box`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.message || `Error al identificar bulto dañado (${res.status})`);
      }

      const resData = await res.json();
      setSuccessMsg(resData.message || 'Bulto dañado identificado y asignado a Calidad exitosamente.');
      setIdentifyingObservaciones('');
      await loadInspectionData();
      if (onSuccess) onSuccess();
    } catch (err: any) {
      console.error('Error al identificar bulto dañado:', err);
      setErrorMsg(err.message || 'No fue posible registrar la identificación del bulto dañado.');
    } finally {
      setIdentifyingLoading(false);
    }
  };

  useEffect(() => {
    loadInspectionData();
  }, [receipt?.id]);

  // Actualizar piezas en item de dictamen con validación de balance
  const handleItemChange = (index: number, field: 'piezasRescatadas' | 'piezasMerma', value: number) => {
    setDictamenItems(prev => {
      const copy = [...prev];
      const item = { ...copy[index] };
      const val = Math.max(0, isNaN(value) ? 0 : value);

      if (field === 'piezasRescatadas') {
        item.piezasRescatadas = Math.min(val, item.piezasTotales);
        item.piezasMerma = item.piezasTotales - item.piezasRescatadas;
      } else {
        item.piezasMerma = Math.min(val, item.piezasTotales);
        item.piezasRescatadas = item.piezasTotales - item.piezasMerma;
      }

      copy[index] = item;
      return copy;
    });
  };

  const handleReasonChange = (index: number, reason: string) => {
    setDictamenItems(prev => {
      const copy = [...prev];
      copy[index] = { ...copy[index], motivoDano: reason };
      return copy;
    });
  };

  const handleNotesChange = (index: number, notes: string) => {
    setDictamenItems(prev => {
      const copy = [...prev];
      copy[index] = { ...copy[index], observaciones: notes };
      return copy;
    });
  };

  // Cálculos de consolidación en tiempo real
  const totalPiezasInspeccionadas = dictamenItems.reduce((acc, it) => acc + it.piezasTotales, 0);
  const totalPiezasRescatadas = dictamenItems.reduce((acc, it) => acc + it.piezasRescatadas, 0);
  const totalPiezasMerma = dictamenItems.reduce((acc, it) => acc + it.piezasMerma, 0);

  // Estimación de cajas estándar conformes
  const totalCajasConformesEstimadas = dictamenItems.reduce((acc, it) => {
    const std = it.piezasPorCajaEstandar || 12;
    return acc + Math.ceil(it.piezasRescatadas / std);
  }, 0);

  const costoTotalCalculado = Number(((Number(horasMaquila) || 0) * (Number(tarifaMaquilaPorHora) || 0)).toFixed(2));

  // Ejecutar dictamen (permite dictamen unitario por caja o masivo)
  const handleExecuteInspection = async (specificItems?: ItemDictamenState[]) => {
    const itemsToProcess = specificItems && specificItems.length > 0 ? specificItems : dictamenItems;
    if (itemsToProcess.length === 0) {
      setErrorMsg('No hay cajas seleccionadas para dictaminar.');
      return;
    }

    // Validar balances
    for (const it of itemsToProcess) {
      if (it.piezasRescatadas + it.piezasMerma !== it.piezasTotales) {
        setErrorMsg(`La caja ${it.codigoHu} no está balanceada. Suma: ${it.piezasRescatadas + it.piezasMerma} vs Total: ${it.piezasTotales}.`);
        return;
      }
    }

    if (!inspectorNombre.trim()) {
      setErrorMsg('Debe especificar el nombre del inspector responsable.');
      return;
    }

    setSubmitting(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const payload = {
        inspectorNombre: inspectorNombre.trim(),
        firmadoPor: inspectorNombre.trim(),
        armarCajasConformes,
        horasMaquila: Number(horasMaquila) || 0,
        tarifaMaquilaPorHora: Number(tarifaMaquilaPorHora) || 0,
        observacionesGenerales: observacionesGenerales.trim(),
        items: itemsToProcess.map(it => ({
          huId: it.huId,
          piezasTotales: it.piezasTotales,
          piezasRescatadas: it.piezasRescatadas,
          piezasMerma: it.piezasMerma,
          motivoDano: it.motivoDano,
          observaciones: it.observaciones,
        }))
      };

      const res = await fetch(`${API}/receipts/${receipt.id}/inspection/execute`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.message || `Error al procesar dictamen (${res.status})`);
      }

      const resData = await res.json();
      setSuccessMsg(resData.message || `Dictamen completado con éxito bajo folio ${resData.inspection?.folio}.`);

      // Recargar datos actualizados
      await loadInspectionData();
      if (onSuccess) onSuccess();

      if (resData.allCompleted) {
        setActiveTab('INFORME');
      }
    } catch (err: any) {
      console.error('Error al ejecutar dictamen:', err);
      setErrorMsg(err.message || 'Ocurrió un error inesperado al procesar la inspección.');
    } finally {
      setSubmitting(false);
    }
  };

  // Renderizar códigos de barras cuando se abre la pestaña de etiquetas
  useEffect(() => {
    if (activeTab === 'ETIQUETAS' && reportData?.cajasReacondicionadas) {
      setTimeout(() => {
        reportData.cajasReacondicionadas.forEach((box: any) => {
          const el = barcodeSvgs.current[box.codigo];
          if (el) {
            try {
              JsBarcode(el, box.codigo, {
                format: 'CODE128',
                width: 1.4,
                height: 36,
                displayValue: true,
                fontSize: 10,
                margin: 0,
                lineColor: '#0F172A',
              });
            } catch (e) {
              console.warn('Error rendering barcode for box:', box.codigo, e);
            }
          }
        });
      }, 100);
    }
  }, [activeTab, reportData]);

  // Imprimir informe
  const handlePrintReport = () => {
    window.print();
  };

  // Imprimir una etiqueta individual
  const handlePrintSingleLabel = (box: any) => {
    const printWindow = window.open('', '_blank', 'width=500,height=350');
    if (!printWindow) return;

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Etiqueta Caja Reacondicionada - ${box.codigo}</title>
          <style>
            @page { size: 100mm 50mm; margin: 0; }
            * { box-sizing: border-box; margin: 0; padding: 0; }
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
              width: 100mm;
              height: 50mm;
              padding: 2.5mm 3.5mm;
              color: #0F172A;
              background: #FFF;
            }
            .header {
              display: flex;
              justify-content: space-between;
              align-items: center;
              border-bottom: 1.5px solid #0F172A;
              padding-bottom: 1mm;
              margin-bottom: 1.5mm;
            }
            .header-title { font-size: 8pt; font-weight: 800; letter-spacing: 0.5px; }
            .badge {
              font-size: 6.5pt;
              font-weight: 800;
              background: #0F172A;
              color: #FFF;
              padding: 1px 4px;
              border-radius: 2px;
            }
            .sku-row {
              display: flex;
              justify-content: space-between;
              align-items: baseline;
              margin-bottom: 1mm;
            }
            .sku-code { font-size: 11pt; font-weight: 900; }
            .pieces { font-size: 9pt; font-weight: 800; background: #F1F5F9; padding: 1px 5px; border-radius: 3px; }
            .desc {
              font-size: 7.5pt;
              font-weight: 600;
              color: #334155;
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
              margin-bottom: 1.5mm;
            }
            .meta-grid {
              display: grid;
              grid-template-columns: 1fr 1fr;
              gap: 2mm;
              font-size: 7pt;
              margin-bottom: 1.5mm;
            }
            .meta-item strong { display: block; font-size: 6pt; color: #64748B; text-transform: uppercase; }
            .barcode-wrap { text-align: center; margin-top: 1mm; }
            .barcode-wrap svg { max-width: 100%; height: 13mm; }
          </style>
          <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js"></script>
        </head>
        <body>
          <div class="header">
            <span class="header-title">GIVING OUT WMS · REACONDICIONADO</span>
            <span class="badge">${Number(box.cantidad) < (box.piezasPorCaja || 12) ? 'PARCIAL / REACONDICIONADA' : 'CONFORME / MAQUILA'}</span>
          </div>
          <div class="sku-row">
            <span class="sku-code">${box.skuCodigo || 'SKU'}</span>
            <span class="pieces">${Number(box.cantidad) < (box.piezasPorCaja || 12) ? `PARCIAL: ${box.cantidad} DE ${box.piezasPorCaja || 12} PZAS` : `${box.cantidad} PZAS`}</span>
          </div>
          <div class="desc">${box.skuDescripcion || ''}</div>
          <div class="meta-grid">
            <div class="meta-item">
              <strong>Lote</strong>
              <span>${box.loteTexto || 'S/L'}</span>
            </div>
            <div class="meta-item">
              <strong>Caducidad</strong>
              <span>${box.fechaVencimiento ? String(box.fechaVencimiento).slice(0, 10) : 'N/A'}</span>
            </div>
          </div>
          <div class="barcode-wrap">
            <svg id="single-barcode"></svg>
          </div>
          <script>
            JsBarcode("#single-barcode", "${box.codigo}", {
              format: "CODE128",
              width: 1.5,
              height: 38,
              displayValue: true,
              fontSize: 10,
              margin: 0
            });
            window.onload = function() {
              window.print();
              setTimeout(function() { window.close(); }, 500);
            };
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.75)',
        backdropFilter: 'blur(4px)',
        zIndex: 99999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        overflowY: 'auto'
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          backgroundColor: '#FFFFFF',
          width: '100%',
          maxWidth: '1080px',
          maxHeight: '92vh',
          borderRadius: '12px',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          border: '1px solid #CBD5E1'
        }}
      >
        {/* ENCABEZADO SUPERIOR */}
        <div
          style={{
            padding: '16px 24px',
            borderBottom: '1px solid #E2E8F0',
            backgroundColor: '#F8FAFC',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 42,
                height: 42,
                borderRadius: 8,
                backgroundColor: '#0F172A',
                color: '#38BDF8',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
              }}
            >
              <Microscope size={22} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 800,
                    textTransform: 'uppercase',
                    letterSpacing: '0.6px',
                    color: '#0284C7',
                    backgroundColor: '#E0F2FE',
                    padding: '2px 8px',
                    borderRadius: 4
                  }}
                >
                  Control de Calidad
                </span>
                <span style={{ fontSize: 13, color: '#64748B', fontWeight: 500 }}>
                  Previo: <strong style={{ color: '#0F172A' }}>{receipt?.codigo}</strong>
                </span>
                <span style={{ fontSize: 13, color: '#64748B', fontWeight: 500 }}>
                  Factura: <strong style={{ color: '#0F172A' }}>{receipt?.facturaRespaldo || receipt?.ocReferencia || 'S/F'}</strong>
                </span>
              </div>
              <h2 style={{ margin: '2px 0 0 0', fontSize: 18, fontWeight: 800, color: '#0F172A' }}>
                Inspección Interna y Reacondicionamiento (Maquila / Rescate)
              </h2>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span
              style={{
                fontSize: 12,
                color: '#475569',
                backgroundColor: '#FFFFFF',
                padding: '6px 12px',
                borderRadius: 6,
                border: '1px solid #E2E8F0',
                fontWeight: 600
              }}
            >
              Cliente: {receipt?.cliente?.nombreComercial || receipt?.cliente?.razonSocial || 'AlimNorte'}
            </span>
            <button
              type="button"
              onClick={onClose}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: '#64748B',
                padding: 6,
                borderRadius: 6,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
              title="Cerrar modal"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* NAVEGACIÓN POR PESTAÑAS */}
        <div
          style={{
            display: 'flex',
            borderBottom: '1px solid #E2E8F0',
            backgroundColor: '#FFFFFF',
            padding: '0 24px'
          }}
        >
          <button
            type="button"
            onClick={() => setActiveTab('DICTAMEN')}
            style={{
              padding: '12px 18px',
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: activeTab === 'DICTAMEN' ? 700 : 500,
              color: activeTab === 'DICTAMEN' ? '#0F172A' : '#64748B',
              borderBottom: activeTab === 'DICTAMEN' ? '2.5px solid #0284C7' : '2.5px solid transparent',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              transition: 'all 0.15s ease'
            }}
          >
            <Microscope size={16} style={{ color: activeTab === 'DICTAMEN' ? '#0284C7' : '#94A3B8' }} />
            Mesa de Dictamen y Rescate
            {(damagedBoxes.length > 0 || unidentifiedCount > 0) && (
              <span
                style={{
                  fontSize: 10.5,
                  fontWeight: 700,
                  backgroundColor: '#FEF3C7',
                  color: '#B45309',
                  padding: '1px 6px',
                  borderRadius: 10
                }}
              >
                {damagedBoxes.length + unidentifiedCount} pend.
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('INFORME')}
            style={{
              padding: '12px 18px',
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: activeTab === 'INFORME' ? 700 : 500,
              color: activeTab === 'INFORME' ? '#0F172A' : '#64748B',
              borderBottom: activeTab === 'INFORME' ? '2.5px solid #0284C7' : '2.5px solid transparent',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              transition: 'all 0.15s ease'
            }}
          >
            <FileText size={16} style={{ color: activeTab === 'INFORME' ? '#0284C7' : '#94A3B8' }} />
            Informe Oficial para Depositante
            {reportData?.inspeccion && (
              <span
                style={{
                  fontSize: 10.5,
                  fontWeight: 700,
                  backgroundColor: '#DCFCE7',
                  color: '#15803D',
                  padding: '1px 6px',
                  borderRadius: 10
                }}
              >
                {reportData.inspeccion.folio}
              </span>
            )}
          </button>

          {reportData?.cajasReacondicionadas?.length > 0 && (
            <button
              type="button"
              onClick={() => setActiveTab('ETIQUETAS')}
              style={{
                padding: '12px 18px',
                border: 'none',
                background: 'none',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: activeTab === 'ETIQUETAS' ? 700 : 500,
                color: activeTab === 'ETIQUETAS' ? '#0F172A' : '#64748B',
                borderBottom: activeTab === 'ETIQUETAS' ? '2.5px solid #0284C7' : '2.5px solid transparent',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                transition: 'all 0.15s ease'
              }}
            >
              <Tag size={16} style={{ color: activeTab === 'ETIQUETAS' ? '#0284C7' : '#94A3B8' }} />
              Etiquetas Reacondicionadas ({reportData.cajasReacondicionadas.length})
            </button>
          )}
        </div>

        {/* CONTENEDOR CON SCROLL */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', backgroundColor: '#F8FAFC' }}>
          {/* MENSAJES DE ESTADO */}
          {errorMsg && (
            <div
              style={{
                backgroundColor: '#FEF2F2',
                border: '1px solid #FECACA',
                color: '#991B1B',
                padding: '12px 16px',
                borderRadius: '8px',
                marginBottom: '16px',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                fontSize: 13
              }}
            >
              <AlertTriangle size={18} style={{ color: '#EF4444', flexShrink: 0 }} />
              <div style={{ flex: 1 }}>{errorMsg}</div>
              <button
                type="button"
                onClick={() => setErrorMsg(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#991B1B' }}
              >
                <X size={16} />
              </button>
            </div>
          )}

          {successMsg && (
            <div
              style={{
                backgroundColor: '#F0FDF4',
                border: '1px solid #BBF7D0',
                color: '#166534',
                padding: '12px 16px',
                borderRadius: '8px',
                marginBottom: '16px',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                fontSize: 13
              }}
            >
              <CheckCircle2 size={18} style={{ color: '#22C55E', flexShrink: 0 }} />
              <div style={{ flex: 1 }}>{successMsg}</div>
              <button
                type="button"
                onClick={() => setSuccessMsg(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#166534' }}
              >
                <X size={16} />
              </button>
            </div>
          )}

          {loading ? (
            <div style={{ padding: '60px', textAlign: 'center', color: '#64748B' }}>
              <RefreshCw size={28} className="animate-spin" style={{ margin: '0 auto 12px', display: 'block', color: '#0284C7' }} />
              <p style={{ fontSize: 14, fontWeight: 500 }}>Consultando estado de inspección y cajas retenidas...</p>
            </div>
          ) : (
            <>
              {/* ======================================================== */}
              {/* PESTAÑA 1: MESA DE DICTAMEN Y RESCATE                     */}
              {/* ======================================================== */}
              {activeTab === 'DICTAMEN' && (
                <div>
                  {/* PROTOCOLO INFORMATIVO */}
                  <div
                    style={{
                      backgroundColor: '#FFFFFF',
                      border: '1px solid #E2E8F0',
                      borderRadius: '8px',
                      padding: '14px 18px',
                      marginBottom: '20px',
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 14
                    }}
                  >
                    <Info size={20} style={{ color: '#0284C7', marginTop: 2, flexShrink: 0 }} />
                    <div style={{ fontSize: 13, color: '#334155', lineHeight: 1.5 }}>
                      <strong style={{ color: '#0F172A', display: 'block', marginBottom: 2 }}>
                        Protocolo de Inspección Fina y Reacondicionamiento
                      </strong>
                      Se procede a la apertura controlada de las cajas retenidas con daño exterior en andén.
                      Cada pieza interna (frascos, botellas, envases) se revisa individualmente. Las unidades sanas se consolidan
                      en nuevas cajas estándar conformes y se reingresan formalmente a la factura/previo original.
                      Las piezas dañadas se dictaminan como merma dictaminada y se desglosa el costo de mano de obra (maquila) para facturación al depositante en caso de aplicar.
                    </div>
                  </div>

                  {/* PASO OPERATIVO: IDENTIFICACIÓN FÍSICA DE BULTOS DAÑADOS EN ANDÉN */}
                  {unidentifiedCount > 0 && (
                    <div
                      style={{
                        backgroundColor: '#FFFBEB',
                        border: '1.5px solid #FCD34D',
                        borderRadius: '10px',
                        padding: '20px',
                        marginBottom: '24px',
                        boxShadow: '0 4px 6px -1px rgba(245, 158, 11, 0.08)'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div
                            style={{
                              width: 32,
                              height: 32,
                              borderRadius: 6,
                              backgroundColor: '#D97706',
                              color: '#FFFFFF',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center'
                            }}
                          >
                            <Box size={18} />
                          </div>
                          <div>
                            <h4 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: '#92400E' }}>
                              Identificación Física de Bultos con Daño Exterior
                            </h4>
                            <span style={{ fontSize: 12, color: '#B45309' }}>
                              En Rampa se reportaron bultos con daño exterior en conteo cerrado. Vincula físicamente cada caja con su partida (SKU, Lote y Caducidad).
                            </span>
                          </div>
                        </div>

                        <span
                          style={{
                            backgroundColor: '#FDE68A',
                            color: '#92400E',
                            padding: '4px 10px',
                            borderRadius: 20,
                            fontSize: 12,
                            fontWeight: 800,
                            border: '1px solid #F59E0B'
                          }}
                        >
                          {unidentifiedCount} bulto(s) por clasificar
                        </span>
                      </div>

                      <div
                        style={{
                          backgroundColor: '#FFFFFF',
                          borderRadius: 8,
                          padding: '16px',
                          border: '1px solid #FDE68A'
                        }}
                      >
                        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
                          <div>
                            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#475569', marginBottom: 4 }}>
                              Partida / Producto (SKU)
                            </label>
                            <select
                              value={selectedLineId}
                              onChange={(e) => handleSelectLine(e.target.value)}
                              style={{
                                width: '100%',
                                height: 36,
                                padding: '0 10px',
                                fontSize: 12,
                                borderRadius: 6,
                                border: '1px solid #CBD5E1',
                                backgroundColor: '#FFFFFF',
                                color: '#0F172A',
                                outline: 'none'
                              }}
                            >
                              {lineasDisponibles.map((line) => (
                                <option key={line.id} value={line.id}>
                                  {line.skuCodigo} - {line.skuDescripcion} ({line.piezasPorCaja} pzas/caja)
                                </option>
                              ))}
                            </select>
                          </div>

                          <div>
                            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#475569', marginBottom: 4 }}>
                              Lote Impreso
                            </label>
                            <input
                              type="text"
                              value={identifyingLote}
                              onChange={(e) => setIdentifyingLote(e.target.value)}
                              placeholder="LOTE-..."
                              style={{
                                width: '100%',
                                height: 36,
                                padding: '0 10px',
                                fontSize: 12,
                                borderRadius: 6,
                                border: '1px solid #CBD5E1',
                                outline: 'none'
                              }}
                            />
                          </div>

                          <div>
                            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#475569', marginBottom: 4 }}>
                              Fecha Caducidad
                            </label>
                            <input
                              type="date"
                              value={identifyingVencimiento}
                              onChange={(e) => setIdentifyingVencimiento(e.target.value)}
                              style={{
                                width: '100%',
                                height: 36,
                                padding: '0 10px',
                                fontSize: 12,
                                borderRadius: 6,
                                border: '1px solid #CBD5E1',
                                outline: 'none'
                              }}
                            />
                          </div>

                          <div>
                            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#475569', marginBottom: 4 }}>
                              Piezas en la Caja
                            </label>
                            <input
                              type="number"
                              min={1}
                              value={identifyingPiezas}
                              onChange={(e) => setIdentifyingPiezas(e.target.value)}
                              onFocus={(e) => {
                                if (e.target.value === '0' || e.target.value === '12' || e.target.value === '1') {
                                  e.target.select();
                                }
                              }}
                              onBlur={() => {
                                if (!identifyingPiezas || Number(identifyingPiezas) < 1) {
                                  setIdentifyingPiezas(1);
                                } else {
                                  setIdentifyingPiezas(parseInt(String(identifyingPiezas), 10) || 1);
                                }
                              }}
                              placeholder="1"
                              style={{
                                width: '100%',
                                height: 36,
                                padding: '0 10px',
                                fontSize: 12,
                                fontWeight: 700,
                                borderRadius: 6,
                                border: '1px solid #CBD5E1',
                                outline: 'none'
                              }}
                            />
                          </div>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '2fr 2fr auto', gap: 12, alignItems: 'flex-end' }}>
                          <div>
                            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#475569', marginBottom: 4 }}>
                              Motivo de Daño Exterior Visible
                            </label>
                            <select
                              value={identifyingMotivo}
                              onChange={(e) => setIdentifyingMotivo(e.target.value)}
                              style={{
                                width: '100%',
                                height: 36,
                                padding: '0 10px',
                                fontSize: 12,
                                borderRadius: 6,
                                border: '1px solid #CBD5E1',
                                outline: 'none'
                              }}
                            >
                              {MOTIVOS_DANO_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.label}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div>
                            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#475569', marginBottom: 4 }}>
                              Observación de Embalaje
                            </label>
                            <input
                              type="text"
                              value={identifyingObservaciones}
                              onChange={(e) => setIdentifyingObservaciones(e.target.value)}
                              placeholder="Caja aplastada en rampa, mancha de líquido, etc."
                              style={{
                                width: '100%',
                                height: 36,
                                padding: '0 10px',
                                fontSize: 12,
                                borderRadius: 6,
                                border: '1px solid #CBD5E1',
                                outline: 'none'
                              }}
                            />
                          </div>

                          <button
                            type="button"
                            disabled={identifyingLoading}
                            onClick={handleIdentifyBox}
                            style={{
                              height: 36,
                              padding: '0 18px',
                              backgroundColor: identifyingLoading ? '#94A3B8' : '#D97706',
                              color: '#FFFFFF',
                              fontWeight: 700,
                              fontSize: 12.5,
                              border: 'none',
                              borderRadius: 6,
                              cursor: identifyingLoading ? 'not-allowed' : 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 8,
                              whiteSpace: 'nowrap'
                            }}
                          >
                            {identifyingLoading ? (
                              <RefreshCw size={14} className="animate-spin" />
                            ) : (
                              <PlusCircle size={15} />
                            )}
                            Identificar Caja y Asignar a Calidad
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {damagedBoxes.length === 0 && unidentifiedCount === 0 ? (
                    <div
                      style={{
                        backgroundColor: '#FFFFFF',
                        border: '1px solid #E2E8F0',
                        borderRadius: '8px',
                        padding: '48px 24px',
                        textAlign: 'center',
                        color: '#64748B'
                      }}
                    >
                      <CheckCircle2 size={44} style={{ color: '#16A34A', margin: '0 auto 12px', display: 'block' }} />
                      <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0F172A', marginBottom: 6 }}>
                        No hay cajas con daño exterior pendientes de dictamen
                      </h3>
                      <p style={{ fontSize: 13, maxWidth: 500, margin: '0 auto 16px' }}>
                        Todas las cajas de este previo han sido inspeccionadas o no registraron daños físicos durante la descarga en rampa.
                      </p>
                      {reportData?.inspeccion && (
                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={() => setActiveTab('INFORME')}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 8,
                            padding: '8px 16px',
                            fontWeight: 600,
                            fontSize: 13,
                            backgroundColor: '#0F172A',
                            color: '#FFFFFF',
                            border: 'none',
                            borderRadius: 6,
                            cursor: 'pointer'
                          }}
                        >
                          <FileText size={15} /> Ver Informe Técnico de Dictamen
                        </button>
                      )}
                    </div>
                  ) : damagedBoxes.length === 0 && unidentifiedCount > 0 ? (
                    <div
                      style={{
                        backgroundColor: '#FFFFFF',
                        border: '1px dashed #CBD5E1',
                        borderRadius: '8px',
                        padding: '32px 24px',
                        textAlign: 'center',
                        color: '#64748B'
                      }}
                    >
                      <Box size={36} style={{ color: '#D97706', margin: '0 auto 10px', display: 'block' }} />
                      <h4 style={{ fontSize: 15, fontWeight: 700, color: '#0F172A', marginBottom: 4 }}>
                        Bultos dañados en espera de clasificación
                      </h4>
                      <p style={{ fontSize: 13, maxWidth: 460, margin: '0 auto' }}>
                        Identifica físicamente la caja dañada usando el formulario superior para habilitar su dictamen pieza por pieza.
                      </p>
                    </div>
                  ) : (
                    <div>
                      {/* TARJETAS DE CAJAS A INSPECCIONAR */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 24 }}>
                        {dictamenItems.map((item, idx) => {
                          const isBalanced = item.piezasRescatadas + item.piezasMerma === item.piezasTotales;
                          const pctRescatado = Math.round((item.piezasRescatadas / item.piezasTotales) * 100) || 0;

                          return (
                            <div
                              key={item.huId}
                              style={{
                                backgroundColor: '#FFFFFF',
                                border: `1px solid ${isBalanced ? '#E2E8F0' : '#FCA5A5'}`,
                                borderRadius: '10px',
                                padding: '18px 20px',
                                boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
                              }}
                            >
                              {/* HEADER DE LA CAJA */}
                              <div
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  borderBottom: '1px solid #F1F5F9',
                                  paddingBottom: 12,
                                  marginBottom: 14
                                }}
                              >
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                  <div
                                    style={{
                                      backgroundColor: '#FEE2E2',
                                      color: '#B91C1C',
                                      padding: '4px 8px',
                                      borderRadius: 6,
                                      fontWeight: 800,
                                      fontSize: 12,
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: 6
                                    }}
                                  >
                                    <ShieldAlert size={14} />
                                    {item.codigoHu}
                                  </div>
                                  <div>
                                    <span style={{ fontSize: 13, fontWeight: 700, color: '#0F172A' }}>
                                      {item.skuCodigo}
                                    </span>
                                    <span style={{ fontSize: 13, color: '#64748B', marginLeft: 6 }}>
                                      {item.skuDescripcion}
                                    </span>
                                  </div>
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12, color: '#475569' }}>
                                  <span>Lote: <strong style={{ color: '#0F172A' }}>{item.lote}</strong></span>
                                  <span>Caducidad: <strong style={{ color: '#0F172A' }}>{item.fechaVencimiento || 'N/A'}</strong></span>
                                  <span
                                    style={{
                                      backgroundColor: '#F1F5F9',
                                      padding: '3px 8px',
                                      borderRadius: 4,
                                      fontWeight: 700,
                                      color: '#0F172A'
                                    }}
                                  >
                                    {item.piezasTotales} piezas totales
                                  </span>
                                </div>
                              </div>

                              {/* GRILLA DE CONTEO Y DICTAMEN PIEZA POR PIEZA */}
                              <div
                                style={{
                                  display: 'grid',
                                  gridTemplateColumns: '1.2fr 1fr 1.3fr',
                                  gap: 20,
                                  alignItems: 'flex-start'
                                }}
                              >
                                {/* COLUMNA 1: CONTADORES FINOS (SANAS VS MERMA) */}
                                <div
                                  style={{
                                    backgroundColor: '#F8FAFC',
                                    padding: '14px',
                                    borderRadius: '8px',
                                    border: '1px solid #E2E8F0'
                                  }}
                                >
                                  <span style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', color: '#64748B', display: 'block', marginBottom: 10 }}>
                                    Conteo Fino Pieza por Pieza
                                  </span>

                                  <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
                                    {/* PIEZAS SANAS */}
                                    <div style={{ flex: 1 }}>
                                      <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#15803D', marginBottom: 4 }}>
                                        Sanas (Rescate)
                                      </label>
                                      <div style={{ display: 'flex', alignItems: 'center' }}>
                                        <button
                                          type="button"
                                          onClick={() => handleItemChange(idx, 'piezasRescatadas', item.piezasRescatadas - 1)}
                                          style={{
                                            width: 32,
                                            height: 34,
                                            backgroundColor: '#E2E8F0',
                                            border: '1px solid #CBD5E1',
                                            borderRadius: '6px 0 0 6px',
                                            cursor: 'pointer',
                                            fontWeight: 700,
                                            fontSize: 14
                                          }}
                                        >
                                          -
                                        </button>
                                        <input
                                          type="number"
                                          min={0}
                                          max={item.piezasTotales}
                                          value={item.piezasRescatadas}
                                          onFocus={(e) => e.target.select()}
                                          onChange={(e) => handleItemChange(idx, 'piezasRescatadas', e.target.value === '' ? 0 : (parseInt(e.target.value, 10) || 0))}
                                          style={{
                                            width: '100%',
                                            height: 34,
                                            textAlign: 'center',
                                            fontSize: 14,
                                            fontWeight: 700,
                                            color: '#15803D',
                                            backgroundColor: '#F0FDF4',
                                            border: '1px solid #86EFAC',
                                            borderLeft: 'none',
                                            borderRight: 'none',
                                            outline: 'none'
                                          }}
                                        />
                                        <button
                                          type="button"
                                          onClick={() => handleItemChange(idx, 'piezasRescatadas', item.piezasRescatadas + 1)}
                                          style={{
                                            width: 32,
                                            height: 34,
                                            backgroundColor: '#E2E8F0',
                                            border: '1px solid #CBD5E1',
                                            borderRadius: '0 6px 6px 0',
                                            cursor: 'pointer',
                                            fontWeight: 700,
                                            fontSize: 14
                                          }}
                                        >
                                          +
                                        </button>
                                      </div>
                                    </div>

                                    {/* PIEZAS MERMA */}
                                    <div style={{ flex: 1 }}>
                                      <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#B91C1C', marginBottom: 4 }}>
                                        Rotas (Merma)
                                      </label>
                                      <div style={{ display: 'flex', alignItems: 'center' }}>
                                        <button
                                          type="button"
                                          onClick={() => handleItemChange(idx, 'piezasMerma', item.piezasMerma - 1)}
                                          style={{
                                            width: 32,
                                            height: 34,
                                            backgroundColor: '#E2E8F0',
                                            border: '1px solid #CBD5E1',
                                            borderRadius: '6px 0 0 6px',
                                            cursor: 'pointer',
                                            fontWeight: 700,
                                            fontSize: 14
                                          }}
                                        >
                                          -
                                        </button>
                                        <input
                                          type="number"
                                          min={0}
                                          max={item.piezasTotales}
                                          value={item.piezasMerma}
                                          onFocus={(e) => e.target.select()}
                                          onChange={(e) => handleItemChange(idx, 'piezasMerma', e.target.value === '' ? 0 : (parseInt(e.target.value, 10) || 0))}
                                          style={{
                                            width: '100%',
                                            height: 34,
                                            textAlign: 'center',
                                            fontSize: 14,
                                            fontWeight: 700,
                                            color: '#B91C1C',
                                            backgroundColor: '#FEF2F2',
                                            border: '1px solid #FCA5A5',
                                            borderLeft: 'none',
                                            borderRight: 'none',
                                            outline: 'none'
                                          }}
                                        />
                                        <button
                                          type="button"
                                          onClick={() => handleItemChange(idx, 'piezasMerma', item.piezasMerma + 1)}
                                          style={{
                                            width: 32,
                                            height: 34,
                                            backgroundColor: '#E2E8F0',
                                            border: '1px solid #CBD5E1',
                                            borderRadius: '0 6px 6px 0',
                                            cursor: 'pointer',
                                            fontWeight: 700,
                                            fontSize: 14
                                          }}
                                        >
                                          +
                                        </button>
                                      </div>
                                    </div>
                                  </div>

                                  {/* BARRA DE BALANCE VISUAL */}
                                  <div style={{ marginTop: 8 }}>
                                    <div
                                      style={{
                                        display: 'flex',
                                        height: 8,
                                        borderRadius: 4,
                                        overflow: 'hidden',
                                        backgroundColor: '#E2E8F0'
                                      }}
                                    >
                                      <div
                                        style={{
                                          width: `${pctRescatado}%`,
                                          backgroundColor: '#22C55E',
                                          transition: 'width 0.2s ease'
                                        }}
                                        title={`Sanas: ${item.piezasRescatadas} (${pctRescatado}%)`}
                                      />
                                      <div
                                        style={{
                                          width: `${100 - pctRescatado}%`,
                                          backgroundColor: '#EF4444',
                                          transition: 'width 0.2s ease'
                                        }}
                                        title={`Merma: ${item.piezasMerma} (${100 - pctRescatado}%)`}
                                      />
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#64748B', marginTop: 4 }}>
                                      <span>{pctRescatado}% Rescate</span>
                                      <span>{100 - pctRescatado}% Merma</span>
                                    </div>
                                  </div>
                                </div>

                                {/* COLUMNA 2: MOTIVO DEL DAÑO */}
                                <div>
                                  <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#475569', marginBottom: 4 }}>
                                    Motivo del Daño / Avería
                                  </label>
                                  <select
                                    value={item.motivoDano}
                                    onChange={(e) => handleReasonChange(idx, e.target.value)}
                                    style={{
                                      width: '100%',
                                      height: 36,
                                      padding: '0 8px',
                                      fontSize: 12,
                                      borderRadius: 6,
                                      border: '1px solid #CBD5E1',
                                      backgroundColor: '#FFFFFF',
                                      color: '#0F172A',
                                      outline: 'none',
                                      marginBottom: 10
                                    }}
                                  >
                                    {MOTIVOS_DANO_OPTIONS.map(opt => (
                                      <option key={opt.value} value={opt.label}>
                                        {opt.label}
                                      </option>
                                    ))}
                                  </select>

                                  <div
                                    style={{
                                      padding: '8px 10px',
                                      borderRadius: 6,
                                      backgroundColor: isBalanced ? '#F0FDF4' : '#FEF2F2',
                                      border: `1px solid ${isBalanced ? '#86EFAC' : '#FCA5A5'}`,
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: 8,
                                      fontSize: 11.5,
                                      fontWeight: 600,
                                      color: isBalanced ? '#15803D' : '#991B1B'
                                    }}
                                  >
                                    {isBalanced ? (
                                      <>
                                        <Check size={14} style={{ color: '#16A34A' }} />
                                        Balance exacto ({item.piezasRescatadas + item.piezasMerma} de {item.piezasTotales} pzas)
                                      </>
                                    ) : (
                                      <>
                                        <AlertTriangle size={14} style={{ color: '#EF4444' }} />
                                        Descuadre: Faltan/Sobran {item.piezasTotales - (item.piezasRescatadas + item.piezasMerma)} pzas
                                      </>
                                    )}
                                  </div>
                                </div>

                                {/* COLUMNA 3: OBSERVACIONES ESPECÍFICAS Y DESTINO */}
                                <div>
                                  <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#475569', marginBottom: 4 }}>
                                    Observaciones de la Caja / Evidencia
                                  </label>
                                  <textarea
                                    rows={2}
                                    placeholder="Detalles del estado de frascos, limpieza aplicada, número de sello, etc."
                                    value={item.observaciones}
                                    onChange={(e) => handleNotesChange(idx, e.target.value)}
                                    style={{
                                      width: '100%',
                                      padding: '6px 10px',
                                      fontSize: 12,
                                      borderRadius: 6,
                                      border: '1px solid #CBD5E1',
                                      outline: 'none',
                                      resize: 'vertical',
                                      fontFamily: 'inherit'
                                    }}
                                  />
                                </div>
                              </div>

                              {/* BARRA DE ACCIÓN INDIVIDUAL POR CAJA */}
                              <div
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  marginTop: 14,
                                  paddingTop: 12,
                                  borderTop: '1px solid #F1F5F9'
                                }}
                              >
                                <span style={{ fontSize: 11.5, color: '#64748B' }}>
                                  Estado: <strong style={{ color: '#D97706' }}>RETENIDA / EN INSPECCIÓN</strong>
                                </span>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                  <span style={{ fontSize: 11, color: '#64748B' }}>
                                    Dictamen unitario de este bulto
                                  </span>
                                  <button
                                    type="button"
                                    disabled={submitting || !isBalanced}
                                    onClick={() => handleExecuteInspection([item])}
                                    style={{
                                      padding: '6px 14px',
                                      backgroundColor: isBalanced && !submitting ? '#0F172A' : '#94A3B8',
                                      color: '#FFFFFF',
                                      borderRadius: 6,
                                      border: 'none',
                                      fontSize: 12,
                                      fontWeight: 700,
                                      cursor: isBalanced && !submitting ? 'pointer' : 'not-allowed',
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: 6
                                    }}
                                  >
                                    {submitting ? <RefreshCw size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                                    Dictaminar Solo Esta Caja ({item.codigoHu})
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                        </div>

                        {/* CALCULADORA DE CONSOLIDACIÓN Y COSTEO 3PL */}
                        <div
                          style={{
                            backgroundColor: '#FFFFFF',
                            border: '1px solid #CBD5E1',
                            borderRadius: '10px',
                            padding: '20px 24px',
                            marginBottom: 24,
                            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)'
                          }}
                        >
                          <h4
                            style={{
                              margin: '0 0 16px 0',
                              fontSize: 14,
                              fontWeight: 800,
                              color: '#0F172A',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 8
                            }}
                          >
                            <Sparkles size={16} style={{ color: '#0284C7' }} />
                            Consolidación de Cajas Nuevas & Costeo de Servicio 3PL (Maquila)
                          </h4>

                          <div
                            style={{
                              display: 'grid',
                              gridTemplateColumns: 'repeat(4, 1fr)',
                              gap: 16,
                              marginBottom: 20
                            }}
                          >
                            <div style={{ backgroundColor: '#F8FAFC', padding: '12px 16px', borderRadius: 8, border: '1px solid #E2E8F0' }}>
                              <span style={{ fontSize: 11, color: '#64748B', fontWeight: 600, display: 'block' }}>Cajas Dañadas</span>
                              <strong style={{ fontSize: 20, color: '#0F172A' }}>{dictamenItems.length}</strong>
                            </div>

                            <div style={{ backgroundColor: '#F0FDF4', padding: '12px 16px', borderRadius: 8, border: '1px solid #BBF7D0' }}>
                              <span style={{ fontSize: 11, color: '#166534', fontWeight: 600, display: 'block' }}>Piezas Rescatadas</span>
                              <strong style={{ fontSize: 20, color: '#15803D' }}>{totalPiezasRescatadas}</strong>
                              <span style={{ fontSize: 11, color: '#166534', marginLeft: 4 }}>pzas</span>
                            </div>

                            <div style={{ backgroundColor: '#FEF2F2', padding: '12px 16px', borderRadius: 8, border: '1px solid #FECACA' }}>
                              <span style={{ fontSize: 11, color: '#991B1B', fontWeight: 600, display: 'block' }}>Merma Dictaminada</span>
                              <strong style={{ fontSize: 20, color: '#B91C1C' }}>{totalPiezasMerma}</strong>
                              <span style={{ fontSize: 11, color: '#991B1B', marginLeft: 4 }}>pzas</span>
                            </div>

                          <div style={{ backgroundColor: '#EFF6FF', padding: '12px 16px', borderRadius: 8, border: '1px solid #BFDBFE' }}>
                            <span style={{ fontSize: 11, color: '#1E40AF', fontWeight: 600, display: 'block' }}>Nuevas Cajas Conformes</span>
                            <strong style={{ fontSize: 20, color: '#1D4ED8' }}>{totalCajasConformesEstimadas}</strong>
                            <span style={{ fontSize: 11, color: '#1E40AF', marginLeft: 4 }}>cajas</span>
                          </div>
                        </div>

                        {/* DETALLE DE FACTURACIÓN DE MANO DE OBRA (MAQUILA) */}
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: '1.2fr 1fr 1fr 1.2fr',
                            gap: 16,
                            alignItems: 'center',
                            backgroundColor: '#F8FAFC',
                            padding: '16px',
                            borderRadius: 8,
                            border: '1px solid #E2E8F0'
                          }}
                        >
                          <div>
                            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#475569', marginBottom: 4 }}>
                              Inspector / Responsable Maquila
                            </label>
                            <div style={{ display: 'flex', alignItems: 'center', position: 'relative' }}>
                              <User size={14} style={{ position: 'absolute', left: 10, color: '#64748B' }} />
                              <input
                                type="text"
                                value={inspectorNombre}
                                onChange={(e) => setInspectorNombre(e.target.value)}
                                style={{
                                  width: '100%',
                                  height: 36,
                                  paddingLeft: 32,
                                  paddingRight: 10,
                                  fontSize: 12.5,
                                  borderRadius: 6,
                                  border: '1px solid #CBD5E1',
                                  outline: 'none'
                                }}
                              />
                            </div>
                          </div>

                          <div>
                            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#475569', marginBottom: 4 }}>
                              Horas de Maquila
                            </label>
                            <div style={{ display: 'flex', alignItems: 'center', position: 'relative' }}>
                              <Clock size={14} style={{ position: 'absolute', left: 10, color: '#64748B' }} />
                              <input
                                type="number"
                                step="0.25"
                                min="0"
                                value={horasMaquila}
                                onChange={(e) => setHorasMaquila(e.target.value)}
                                onFocus={(e) => {
                                  if (e.target.value === '0' || e.target.value === '0.0' || e.target.value === '0.00' || e.target.value === '1' || e.target.value === '1.0') {
                                    e.target.select();
                                  }
                                }}
                                onBlur={() => {
                                  if (horasMaquila === '' || isNaN(Number(horasMaquila))) {
                                    setHorasMaquila(0);
                                  } else {
                                    setHorasMaquila(Number(parseFloat(String(horasMaquila)).toFixed(2)));
                                  }
                                }}
                                placeholder="0"
                                style={{
                                  width: '100%',
                                  height: 36,
                                  paddingLeft: 32,
                                  paddingRight: 10,
                                  fontSize: 13,
                                  fontWeight: 600,
                                  borderRadius: 6,
                                  border: '1px solid #CBD5E1',
                                  outline: 'none'
                                }}
                              />
                            </div>
                          </div>

                          <div>
                            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#475569', marginBottom: 4 }}>
                              Tarifa / Hora (MXN)
                            </label>
                            <div style={{ display: 'flex', alignItems: 'center', position: 'relative' }}>
                              <DollarSign size={14} style={{ position: 'absolute', left: 10, color: '#64748B' }} />
                              <input
                                type="number"
                                step="10"
                                min="0"
                                value={tarifaMaquilaPorHora}
                                onChange={(e) => setTarifaMaquilaPorHora(e.target.value)}
                                onFocus={(e) => {
                                  if (e.target.value === '0' || e.target.value === '180' || e.target.value === '180.0') {
                                    e.target.select();
                                  }
                                }}
                                onBlur={() => {
                                  if (tarifaMaquilaPorHora === '' || isNaN(Number(tarifaMaquilaPorHora))) {
                                    setTarifaMaquilaPorHora(0);
                                  } else {
                                    setTarifaMaquilaPorHora(Number(parseFloat(String(tarifaMaquilaPorHora)).toFixed(2)));
                                  }
                                }}
                                placeholder="0"
                                style={{
                                  width: '100%',
                                  height: 36,
                                  paddingLeft: 32,
                                  paddingRight: 10,
                                  fontSize: 13,
                                  fontWeight: 600,
                                  borderRadius: 6,
                                  border: '1px solid #CBD5E1',
                                  outline: 'none'
                                }}
                              />
                            </div>
                          </div>

                          <div>
                            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#475569', marginBottom: 4 }}>
                              Costo de Maquila a Facturar
                            </label>
                            <div
                              style={{
                                height: 36,
                                backgroundColor: '#0F172A',
                                color: '#38BDF8',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                borderRadius: 6,
                                fontWeight: 800,
                                fontSize: 15,
                                letterSpacing: 0.5
                              }}
                            >
                              ${costoTotalCalculado.toLocaleString('es-MX', { minimumFractionDigits: 2 })} MXN
                            </div>
                          </div>
                        </div>

                        {/* OBSERVACIONES GENERALES */}
                        <div style={{ marginTop: 16 }}>
                          <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#475569', marginBottom: 4 }}>
                            Dictamen y Observaciones para el Informe Oficial
                          </label>
                          <textarea
                            rows={2}
                            value={observacionesGenerales}
                            onChange={(e) => setObservacionesGenerales(e.target.value)}
                            style={{
                              width: '100%',
                              padding: '8px 12px',
                              fontSize: 12.5,
                              borderRadius: 6,
                              border: '1px solid #CBD5E1',
                              outline: 'none',
                              fontFamily: 'inherit'
                            }}
                          />
                        </div>
                      </div>

                      {/* BOTONES DE ACCIÓN */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                        <div style={{ fontSize: 11.5, color: '#64748B', maxWidth: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
                          <Info size={14} style={{ color: '#0284C7', flexShrink: 0 }} />
                          <span><strong>Modalidades de Dictamen:</strong> Puede dictaminar cada bulto de forma unitaria en su tarjeta correspondiente o procesar todos los bultos retenidos simultáneamente.</span>
                        </div>
                        <div style={{ display: 'flex', gap: 12 }}>
                          <button
                            type="button"
                            onClick={onClose}
                            style={{
                              padding: '10px 18px',
                              backgroundColor: '#FFFFFF',
                              border: '1px solid #CBD5E1',
                              borderRadius: 6,
                              fontSize: 13,
                              fontWeight: 600,
                              color: '#475569',
                              cursor: 'pointer'
                            }}
                          >
                            Cancelar
                          </button>

                          <button
                            type="button"
                            disabled={submitting}
                            onClick={() => !submitting && handleExecuteInspection()}
                            style={{
                              padding: '10px 22px',
                              backgroundColor: submitting ? '#94A3B8' : '#0284C7',
                              border: 'none',
                              borderRadius: 6,
                              fontSize: 13,
                              fontWeight: 700,
                              color: '#FFFFFF',
                              cursor: submitting ? 'not-allowed' : 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 8,
                              boxShadow: '0 4px 6px -1px rgba(2, 132, 199, 0.3)'
                            }}
                          >
                            {submitting ? (
                              <>
                                <RefreshCw size={16} className="animate-spin" /> Procesando Dictamen...
                              </>
                            ) : (
                              <>
                                <CheckCircle2 size={16} /> Confirmar Dictamen y Armar Cajas Conformes ({dictamenItems.length} bultos)
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ======================================================== */}
              {/* PESTAÑA 2: INFORME OFICIAL PARA EL DEPOSITANTE (PDF/PRINT) */}
              {/* ======================================================== */}
              {activeTab === 'INFORME' && (
                <div>
                  {!reportData?.inspeccion ? (
                    <div
                      style={{
                        backgroundColor: '#FFFFFF',
                        border: '1px solid #E2E8F0',
                        borderRadius: '8px',
                        padding: '48px 24px',
                        textAlign: 'center',
                        color: '#64748B'
                      }}
                    >
                      <FileText size={44} style={{ color: '#94A3B8', margin: '0 auto 12px', display: 'block' }} />
                      <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0F172A', marginBottom: 6 }}>
                        No se ha registrado ninguna inspección para este previo
                      </h3>
                      <p style={{ fontSize: 13, maxWidth: 500, margin: '0 auto 16px' }}>
                        Para generar el informe técnico oficial, primero ejecute el dictamen en la pestaña "Mesa de Dictamen y Rescate".
                      </p>
                      <button
                        type="button"
                        onClick={() => setActiveTab('DICTAMEN')}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 8,
                          padding: '8px 16px',
                          fontWeight: 600,
                          fontSize: 13,
                          backgroundColor: '#0F172A',
                          color: '#FFFFFF',
                          border: 'none',
                          borderRadius: 6,
                          cursor: 'pointer'
                        }}
                      >
                        <Microscope size={15} /> Ir a Mesa de Dictamen
                      </button>
                    </div>
                  ) : (
                    <div>
                      {/* BARRA DE ACCIÓN SUPERIOR DEL INFORME */}
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          backgroundColor: '#FFFFFF',
                          padding: '12px 18px',
                          borderRadius: '8px',
                          border: '1px solid #E2E8F0',
                          marginBottom: 16
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 800,
                              backgroundColor: '#DCFCE7',
                              color: '#166534',
                              padding: '3px 8px',
                              borderRadius: 4
                            }}
                          >
                            DICTAMEN COMPLETADO
                          </span>
                          <span style={{ fontSize: 13, fontWeight: 700, color: '#0F172A' }}>
                            Folio Oficial: {reportData.inspeccion.folio}
                          </span>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          {reportData.cajasReacondicionadas?.length > 0 && (
                            <button
                              type="button"
                              onClick={() => setActiveTab('ETIQUETAS')}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 6,
                                padding: '7px 14px',
                                fontSize: 12.5,
                                fontWeight: 600,
                                backgroundColor: '#EFF6FF',
                                color: '#1D4ED8',
                                border: '1px solid #BFDBFE',
                                borderRadius: 6,
                                cursor: 'pointer'
                              }}
                            >
                              <Tag size={14} /> Ver Etiquetas ({reportData.cajasReacondicionadas.length})
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={handlePrintReport}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 6,
                              padding: '7px 16px',
                              fontSize: 12.5,
                              fontWeight: 700,
                              backgroundColor: '#0F172A',
                              color: '#FFFFFF',
                              border: 'none',
                              borderRadius: 6,
                              cursor: 'pointer',
                              boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                            }}
                          >
                            <Printer size={15} /> Imprimir Informe Oficial (PDF)
                          </button>
                        </div>
                      </div>

                      {/* HOJA IMPRIMIBLE DEL INFORME (ESTILO CORPORATIVO FORMAL) */}
                      <div
                        id="print-area-calidad"
                        ref={reportPrintRef}
                        className="print-report-container"
                        style={{
                          backgroundColor: '#FFFFFF',
                          border: '1px solid #CBD5E1',
                          borderRadius: '8px',
                          padding: '24px 30px',
                          color: '#0F172A',
                          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)',
                          boxSizing: 'border-box',
                          width: '100%',
                          maxWidth: '100%'
                        }}
                      >
                        {/* ENCABEZADO DEL DOCUMENTO */}
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'flex-start',
                            borderBottom: '2px solid #0F172A',
                            paddingBottom: 16,
                            marginBottom: 20
                          }}
                        >
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                              <span style={{ fontSize: 16, fontWeight: 900, letterSpacing: '0.8px', color: '#0F172A' }}>
                                GIVING OUT
                              </span>
                              <span style={{ fontSize: 12, fontWeight: 700, color: '#0284C7', backgroundColor: '#E0F2FE', padding: '1px 6px', borderRadius: 3 }}>
                                3PL LOGISTICS
                              </span>
                            </div>
                            <h1 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#0F172A' }}>
                              ACTA TÉCNICA DE INSPECCIÓN, REACONDICIONAMIENTO Y MERMA
                            </h1>
                            <p style={{ margin: '3px 0 0 0', fontSize: 11.5, color: '#64748B' }}>
                              Departamento de Calidad, Maniobras y Operaciones en Almacén Fiscal y General
                            </p>
                          </div>

                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: 14, fontWeight: 800, color: '#0284C7' }}>
                              {reportData.inspeccion.folio}
                            </div>
                            <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>
                              Fecha: {formatTimelineDateTime(reportData.inspeccion.fechaInspeccion)}
                            </div>
                            <div style={{ fontSize: 11, color: '#64748B' }}>
                              Previo WMS: <strong>{reportData.receiptCodigo}</strong>
                            </div>
                          </div>
                        </div>

                        {/* METADATOS DEL CLIENTE Y DOCUMENTO */}
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(3, 1fr)',
                            gap: 16,
                            backgroundColor: '#F8FAFC',
                            padding: '12px 16px',
                            borderRadius: 6,
                            border: '1px solid #E2E8F0',
                            marginBottom: 20,
                            fontSize: 11.5
                          }}
                        >
                          <div>
                            <span style={{ color: '#64748B', display: 'block', fontSize: 10, textTransform: 'uppercase', fontWeight: 700 }}>
                              Depositante / Propietario
                            </span>
                            <strong style={{ color: '#0F172A', fontSize: 13 }}>
                              {reportData.cliente?.nombre || 'Cliente'}
                            </strong>
                          </div>

                          <div>
                            <span style={{ color: '#64748B', display: 'block', fontSize: 10, textTransform: 'uppercase', fontWeight: 700 }}>
                              Factura / Documento Origen
                            </span>
                            <strong style={{ color: '#0F172A', fontSize: 13 }}>
                              {reportData.facturaRespaldo || 'S/F'}
                            </strong>
                          </div>

                          <div>
                            <span style={{ color: '#64748B', display: 'block', fontSize: 10, textTransform: 'uppercase', fontWeight: 700 }}>
                              Inspector Responsable
                            </span>
                            <strong style={{ color: '#0F172A', fontSize: 13 }}>
                              {reportData.inspeccion.inspectorNombre}
                            </strong>
                          </div>
                        </div>

                        {/* CUADRO DE INDICADORES DE BALANCE */}
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(5, 1fr)',
                            gap: 12,
                            marginBottom: 24,
                            textAlign: 'center'
                          }}
                        >
                          <div style={{ border: '1px solid #E2E8F0', padding: '10px 8px', borderRadius: 6, backgroundColor: '#FFFFFF' }}>
                            <span style={{ fontSize: 10, color: '#64748B', fontWeight: 700, textTransform: 'uppercase' }}>Cajas Revisadas</span>
                            <div style={{ fontSize: 18, fontWeight: 800, color: '#0F172A', marginTop: 2 }}>
                              {reportData.inspeccion.totalCajasInspeccionadas}
                            </div>
                          </div>

                          <div style={{ border: '1px solid #E2E8F0', padding: '10px 8px', borderRadius: 6, backgroundColor: '#FFFFFF' }}>
                            <span style={{ fontSize: 10, color: '#64748B', fontWeight: 700, textTransform: 'uppercase' }}>Piezas Totales</span>
                            <div style={{ fontSize: 18, fontWeight: 800, color: '#0F172A', marginTop: 2 }}>
                              {reportData.inspeccion.totalPiezasInspeccionadas}
                            </div>
                          </div>

                          <div style={{ border: '1px solid #BBF7D0', padding: '10px 8px', borderRadius: 6, backgroundColor: '#F0FDF4' }}>
                            <span style={{ fontSize: 10, color: '#166534', fontWeight: 700, textTransform: 'uppercase' }}>Sanas Rescatadas</span>
                            <div style={{ fontSize: 18, fontWeight: 800, color: '#15803D', marginTop: 2 }}>
                              {reportData.inspeccion.totalPiezasRescatadas}
                            </div>
                          </div>

                          <div style={{ border: '1px solid #FECACA', padding: '10px 8px', borderRadius: 6, backgroundColor: '#FEF2F2' }}>
                            <span style={{ fontSize: 10, color: '#991B1B', fontWeight: 700, textTransform: 'uppercase' }}>Merma Dictaminada</span>
                            <div style={{ fontSize: 18, fontWeight: 800, color: '#B91C1C', marginTop: 2 }}>
                              {reportData.inspeccion.totalPiezasMerma}
                            </div>
                          </div>

                          <div style={{ border: '1px solid #BFDBFE', padding: '10px 8px', borderRadius: 6, backgroundColor: '#EFF6FF' }}>
                            <span style={{ fontSize: 10, color: '#1E40AF', fontWeight: 700, textTransform: 'uppercase' }}>Cajas Conformes</span>
                            <div style={{ fontSize: 18, fontWeight: 800, color: '#1D4ED8', marginTop: 2 }}>
                              {reportData.inspeccion.totalCajasNuevasArmadas}
                            </div>
                          </div>
                        </div>

                        {/* TABLA DE DETALLE POR CAJA */}
                        <div style={{ marginBottom: 24 }}>
                          <h4 style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', color: '#0F172A', marginBottom: 8, letterSpacing: 0.5 }}>
                            Desglose de Inspección Fina por Caja Retenida
                          </h4>
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10, textAlign: 'left', tableLayout: 'fixed' }}>
                            <thead>
                              <tr style={{ backgroundColor: '#F1F5F9', borderBottom: '1.5px solid #CBD5E1' }}>
                                <th style={{ width: '15%', padding: '6px 6px', fontWeight: 700, border: '1px solid #CBD5E1' }}>Caja Origen</th>
                                <th style={{ width: '10%', padding: '6px 6px', fontWeight: 700, border: '1px solid #CBD5E1' }}>SKU</th>
                                <th style={{ width: '13%', padding: '6px 8px', fontWeight: 700, border: '1px solid #CBD5E1' }}>Lote</th>
                                <th style={{ width: '7%', padding: '6px 4px', fontWeight: 800, textAlign: 'center', border: '1px solid #CBD5E1', backgroundColor: '#F8FAFC' }}>Total</th>
                                <th style={{ width: '7%', padding: '6px 4px', fontWeight: 800, textAlign: 'center', border: '1px solid #CBD5E1', backgroundColor: '#DCFCE7', color: '#166534' }}>Sanas</th>
                                <th style={{ width: '7%', padding: '6px 4px', fontWeight: 800, textAlign: 'center', border: '1px solid #CBD5E1', backgroundColor: '#FEE2E2', color: '#991C1C' }}>Merma</th>
                                <th style={{ width: '18%', padding: '6px 6px', fontWeight: 700, border: '1px solid #CBD5E1' }}>Causa Daño</th>
                                <th style={{ width: '23%', padding: '6px 6px', fontWeight: 700, border: '1px solid #CBD5E1' }}>Nueva Caja</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(reportData.inspeccion.detalles || []).map((det: any, i: number) => {
                                const stdCap = (det.skuCodigo?.includes('ACE') ? 12 : det.skuCodigo?.includes('ARR') ? 20 : 12);
                                return (
                                  <tr key={i} style={{ borderBottom: '1px solid #E2E8F0' }}>
                                    <td style={{ border: '1px solid #CBD5E1', padding: '6px 6px', fontWeight: 700, color: '#B91C1C', wordBreak: 'break-word', overflowWrap: 'anywhere', verticalAlign: 'top', fontFamily: 'monospace', fontSize: 9.5 }}>
                                      {det.cajaOrigenCodigo}
                                    </td>
                                    <td style={{ border: '1px solid #CBD5E1', padding: '6px 6px', wordBreak: 'break-word', overflowWrap: 'anywhere', verticalAlign: 'top' }}>
                                      <strong style={{ color: '#0F172A' }}>{det.skuCodigo}</strong>
                                    </td>
                                    <td style={{ border: '1px solid #CBD5E1', padding: '6px 8px', color: '#0F172A', wordBreak: 'break-word', overflowWrap: 'anywhere', verticalAlign: 'top', fontFamily: 'monospace', fontWeight: 700 }}>
                                      {det.loteTexto || 'S/L'}
                                    </td>
                                    <td style={{ border: '1px solid #CBD5E1', padding: '6px 4px', textAlign: 'center', fontWeight: 800, color: '#0F172A', backgroundColor: '#F8FAFC', verticalAlign: 'top' }}>
                                      {det.piezasTotales}
                                    </td>
                                    <td style={{ border: '1px solid #CBD5E1', padding: '6px 4px', textAlign: 'center', fontWeight: 800, color: '#15803D', backgroundColor: '#F0FDF4', verticalAlign: 'top' }}>
                                      {det.piezasRescatadas}
                                    </td>
                                    <td style={{ border: '1px solid #CBD5E1', padding: '6px 4px', textAlign: 'center', fontWeight: 800, color: '#B91C1C', backgroundColor: '#FEF2F2', verticalAlign: 'top' }}>
                                      {det.piezasMerma}
                                    </td>
                                    <td style={{ border: '1px solid #CBD5E1', padding: '6px 6px', color: '#475569', fontSize: 9.5, wordBreak: 'break-word', overflowWrap: 'anywhere', verticalAlign: 'top', lineHeight: 1.3 }}>
                                      {det.motivoDano || 'Empaque dañado'}
                                    </td>
                                    <td style={{ border: '1px solid #CBD5E1', padding: '6px 6px', verticalAlign: 'top', wordBreak: 'break-word', overflowWrap: 'anywhere', whiteSpace: 'normal' }}>
                                      {det.nuevasCajasGeneradas?.map((nb: any) => {
                                        const isPartial = nb.cantidad < stdCap;
                                        return (
                                          <div key={nb.codigo || nb.id} style={{ marginBottom: 3, lineHeight: 1.25 }}>
                                            <strong style={{ color: '#1D4ED8', fontFamily: 'monospace', fontSize: 9.5, display: 'block', wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
                                              {nb.codigo}
                                            </strong>
                                            <span style={{ fontSize: 9, color: isPartial ? '#B45309' : '#166534', fontWeight: 600, display: 'block', wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
                                              {isPartial ? `Parcial: ${nb.cantidad} de ${stdCap} pz · Reacondicionada` : `Completa: ${nb.cantidad} de ${stdCap} pz · Reacondicionada`}
                                            </span>
                                          </div>
                                        );
                                      }) || <span style={{ color: '#94A3B8', fontSize: 9.5 }}>Sin cajas armadas</span>}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>

                        {/* DESGLOSE DE MAQUILA Y COSTEO */}
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: '1.4fr 1fr',
                            gap: 20,
                            marginBottom: 24,
                            alignItems: 'stretch'
                          }}
                        >
                          <div
                            style={{
                              border: '1px solid #E2E8F0',
                              borderRadius: 6,
                              padding: '12px 16px',
                              backgroundColor: '#F8FAFC',
                              fontSize: 11.5
                            }}
                          >
                            <span style={{ fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase', color: '#475569', display: 'block', marginBottom: 6 }}>
                              Dictamen Técnico y Observaciones
                            </span>
                            <p style={{ margin: 0, color: '#334155', lineHeight: 1.5 }}>
                              {reportData.inspeccion.observaciones}
                            </p>
                          </div>

                          <div
                            style={{
                              border: '1px solid #CBD5E1',
                              borderRadius: 6,
                              padding: '12px 16px',
                              backgroundColor: '#FFFFFF',
                              fontSize: 11.5
                            }}
                          >
                            <span style={{ fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase', color: '#0F172A', display: 'block', marginBottom: 8 }}>
                              Costeo de Mano de Obra (Maquila 3PL)
                            </span>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                              <span style={{ color: '#64748B' }}>Horas hombre invertidas:</span>
                              <strong style={{ color: '#0F172A' }}>{reportData.inspeccion.horasMaquila} hrs</strong>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                              <span style={{ color: '#64748B' }}>
                                {Number(reportData.inspeccion.horasMaquila || 0) > 0 ? 'Tarifa por hora pactada:' : 'Tarifa configurada:'}
                              </span>
                              <strong style={{ color: '#0F172A' }}>
                                ${Number(reportData.inspeccion.tarifaMaquilaPorHora || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })} MXN
                              </strong>
                            </div>
                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                borderTop: '1.5px solid #0F172A',
                                paddingTop: 6,
                                marginTop: 6,
                                fontSize: 13,
                                fontWeight: 800
                              }}
                            >
                              <span>Total a Facturar:</span>
                              <span style={{ color: Number(reportData.inspeccion.costoTotalMaquila || 0) > 0 ? '#0284C7' : '#059669' }}>
                                ${Number(reportData.inspeccion.costoTotalMaquila || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })} MXN {Number(reportData.inspeccion.costoTotalMaquila || 0) === 0 ? '(Sin cargo / Prueba)' : ''}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* SECCIÓN DE FIRMAS */}
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(3, 1fr)',
                            gap: 24,
                            marginTop: 40,
                            paddingTop: 16,
                            textAlign: 'center',
                            fontSize: 11
                          }}
                        >
                          <div>
                            <div style={{ borderBottom: '1px solid #94A3B8', height: 48, marginBottom: 6 }} />
                            <strong style={{ display: 'block', color: '#0F172A' }}>
                              {reportData.inspeccion.inspectorNombre}
                            </strong>
                            <span style={{ color: '#64748B', fontSize: 10 }}>Inspector / Dictaminador de Calidad</span>
                          </div>

                          <div>
                            <div style={{ borderBottom: '1px solid #94A3B8', height: 48, marginBottom: 6 }} />
                            <strong style={{ display: 'block', color: '#0F172A' }}>
                              Supervisión de Operaciones 3PL
                            </strong>
                            <span style={{ color: '#64748B', fontSize: 10 }}>Giving Out WMS</span>
                          </div>

                          <div>
                            <div
                              style={{
                                border: '1.5px dashed #0284C7',
                                height: 56,
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                justifyContent: 'center',
                                borderRadius: 6,
                                backgroundColor: '#F0F9FF',
                                color: '#0284C7',
                                fontWeight: 700,
                                fontSize: 10
                              }}
                            >
                              <ShieldCheck size={16} style={{ marginBottom: 2 }} />
                              SELLO DE CONTROL DE CALIDAD
                              <span style={{ fontSize: 8.5, fontWeight: 500, color: '#0369A1' }}>
                                APROBADO PARA INVENTARIO
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ======================================================== */}
              {/* PESTAÑA 3: ETIQUETAS DE CAJAS REACONDICIONADAS             */}
              {/* ======================================================== */}
              {activeTab === 'ETIQUETAS' && (
                <div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      backgroundColor: '#FFFFFF',
                      padding: '12px 18px',
                      borderRadius: '8px',
                      border: '1px solid #E2E8F0',
                      marginBottom: 16
                    }}
                  >
                    <div>
                      <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#0F172A' }}>
                        Cajas Conformes Generadas tras Reacondicionamiento
                      </h4>
                      <p style={{ margin: '2px 0 0 0', fontSize: 12, color: '#64748B' }}>
                        {(() => {
                          const recondBoxes: any[] = reportData?.cajasReacondicionadas || [];
                          const allHus: any[] = receipt?.handlingUnits || reportData?.handlingUnits || [];
                          if (recondBoxes.length === 0) {
                            return 'No hay cajas reacondicionadas registradas aún.';
                          }
                          const statuses = recondBoxes.map((b: any) => {
                            const rHu = allHus.find((h: any) => h.codigo === b.codigo) || b;
                            const ubi = rHu.ubicacionActual || rHu.ubicacion || b.ubicacionActual || b.ubicacion;
                            const inRack = !isNonRackLocation(ubi) && Boolean(
                              ubi ||
                              receipt?.estado === 'UBICADO' ||
                              receipt?.estado === 'CERRADO' ||
                              receipt?.estado === 'CERRADA' ||
                              rHu.lotId ||
                              b.lotId
                            );
                            const labeled = Boolean(
                              rHu.estadoEtiqueta === 'COLOCADA' ||
                              b.estadoEtiqueta === 'COLOCADA' ||
                              receipt?.etiquetasEstado === 'COLOCADAS'
                            );
                            return { inRack, labeled };
                          });

                          const allInRack = statuses.every((s) => s.inRack);
                          const someInRack = statuses.some((s) => s.inRack);
                          const allLabeled = statuses.every((s) => s.labeled);
                          const someLabeled = statuses.some((s) => s.labeled);

                          if (allInRack) {
                            return 'Estas cajas reacondicionadas han completado su ciclo operativo: etiquetadas, ubicadas en racks (Putaway) y con existencia activa disponible en inventario WMS.';
                          }
                          if (someInRack) {
                            return 'Parte de las cajas reacondicionadas ya se encuentran ubicadas en racks (Putaway); el resto permanece en andén/rampa continuando su ciclo operativo.';
                          }
                          if (allLabeled || someLabeled) {
                            return 'Cajas reacondicionadas con etiquetado colocado, pendientes de traslado físico y alojamiento en racks (Putaway) para activar su inventario.';
                          }
                          return 'Cajas conformes generadas tras dictamen en rampa/andén. Pendientes de etiquetado y posterior alojamiento en racks (Putaway).';
                        })()}
                      </p>
                    </div>

                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 700,
                        backgroundColor: (() => {
                          const recondBoxes: any[] = reportData?.cajasReacondicionadas || [];
                          const allHus: any[] = receipt?.handlingUnits || reportData?.handlingUnits || [];
                          if (recondBoxes.length === 0) return '#F1F5F9';
                          const allInRack = recondBoxes.every((b: any) => {
                            const rHu = allHus.find((h: any) => h.codigo === b.codigo) || b;
                            const ubi = rHu.ubicacionActual || rHu.ubicacion || b.ubicacionActual || b.ubicacion;
                            return !isNonRackLocation(ubi);
                          });
                          const allLabeled = recondBoxes.every((b: any) => {
                            const rHu = allHus.find((h: any) => h.codigo === b.codigo) || b;
                            return rHu.estadoEtiqueta === 'COLOCADA' || b.estadoEtiqueta === 'COLOCADA' || receipt?.etiquetasEstado === 'COLOCADAS';
                          });
                          return allInRack ? '#DCFCE7' : allLabeled ? '#EFF6FF' : '#FEF3C7';
                        })(),
                        color: (() => {
                          const recondBoxes: any[] = reportData?.cajasReacondicionadas || [];
                          const allHus: any[] = receipt?.handlingUnits || reportData?.handlingUnits || [];
                          if (recondBoxes.length === 0) return '#64748B';
                          const allInRack = recondBoxes.every((b: any) => {
                            const rHu = allHus.find((h: any) => h.codigo === b.codigo) || b;
                            const ubi = rHu.ubicacionActual || rHu.ubicacion || b.ubicacionActual || b.ubicacion;
                            return !isNonRackLocation(ubi);
                          });
                          const allLabeled = recondBoxes.every((b: any) => {
                            const rHu = allHus.find((h: any) => h.codigo === b.codigo) || b;
                            return rHu.estadoEtiqueta === 'COLOCADA' || b.estadoEtiqueta === 'COLOCADA' || receipt?.etiquetasEstado === 'COLOCADAS';
                          });
                          return allInRack ? '#166534' : allLabeled ? '#1D4ED8' : '#92400E';
                        })(),
                        padding: '4px 10px',
                        borderRadius: 6
                      }}
                    >
                      {(() => {
                        const count = reportData?.cajasReacondicionadas?.length || 0;
                        if (count === 0) return '0 cajas';
                        const recondBoxes: any[] = reportData?.cajasReacondicionadas || [];
                        const allHus: any[] = receipt?.handlingUnits || reportData?.handlingUnits || [];
                        const allInRack = count > 0 && recondBoxes.every((b: any) => {
                          const rHu = allHus.find((h: any) => h.codigo === b.codigo) || b;
                          const ubi = rHu.ubicacionActual || rHu.ubicacion || b.ubicacionActual || b.ubicacion;
                          return !isNonRackLocation(ubi);
                        });
                        const allLabeled = count > 0 && recondBoxes.every((b: any) => {
                          const rHu = allHus.find((h: any) => h.codigo === b.codigo) || b;
                          return rHu.estadoEtiqueta === 'COLOCADA' || b.estadoEtiqueta === 'COLOCADA' || receipt?.etiquetasEstado === 'COLOCADAS';
                        });
                        if (allInRack) return `${count} ${count === 1 ? 'caja en rack' : 'cajas en rack'}`;
                        if (allLabeled) return `${count} ${count === 1 ? 'caja etiquetada' : 'cajas etiquetadas'}`;
                        return `${count} ${count === 1 ? 'caja en rampa' : 'cajas en rampa'}`;
                      })()}
                    </span>
                  </div>

                  {(!reportData?.cajasReacondicionadas || reportData.cajasReacondicionadas.length === 0) ? (
                    <div style={{ textAlign: 'center', padding: '40px', color: '#64748B', backgroundColor: '#FFFFFF', borderRadius: 8 }}>
                      <Box size={36} style={{ margin: '0 auto 10px', display: 'block', color: '#94A3B8' }} />
                      <p style={{ fontSize: 13 }}>No hay cajas reacondicionadas registradas aún.</p>
                    </div>
                  ) : (
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
                        gap: 16
                      }}
                    >
                      {reportData.cajasReacondicionadas.map((box: any) => {
                        const stdCap = box.piezasPorCaja || (box.skuCodigo?.includes('ACE') ? 12 : box.skuCodigo?.includes('ARR') ? 20 : 12);
                        const isPartial = Number(box.cantidad) < stdCap;
                        const allHus: any[] = receipt?.handlingUnits || reportData?.handlingUnits || [];
                        const realHu = allHus.find((h: any) => h.codigo === box.codigo) || box;

                        // Ubicación y estado post-Putaway
                        const rawUbi = realHu.ubicacionActual || realHu.ubicacion || box.ubicacionActual || box.ubicacion;
                        const isTransit = isNonRackLocation(rawUbi);
                        const isPutawayDone = !isTransit && Boolean(
                          (rawUbi && rawUbi !== '—') ||
                          receipt?.estado === 'UBICADO' ||
                          receipt?.estado === 'CERRADO' ||
                          receipt?.estado === 'CERRADA' ||
                          realHu.lotId ||
                          box.lotId
                        );
                        const rackActual = isPutawayDone
                          ? (!isTransit ? rawUbi : (realHu.lote?.ubicacion?.codigo || 'Rack de almacenamiento'))
                          : null;
                        const isLabelPlaced = Boolean(
                          realHu.estadoEtiqueta === 'COLOCADA' ||
                          box.estadoEtiqueta === 'COLOCADA' ||
                          receipt?.etiquetasEstado === 'COLOCADAS'
                        );

                        return (
                        <div
                          key={box.codigo}
                          style={{
                            backgroundColor: '#FFFFFF',
                            border: '1px solid #CBD5E1',
                            borderRadius: '8px',
                            padding: '16px',
                            boxShadow: '0 2px 4px rgba(0,0,0,0.04)',
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'space-between'
                          }}
                        >
                          <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 4 }}>
                              <span
                                style={{
                                  fontSize: 10,
                                  fontWeight: 800,
                                  backgroundColor: isPartial ? '#FEF3C7' : '#DCFCE7',
                                  color: isPartial ? '#92400E' : '#166534',
                                  padding: '2px 6px',
                                  borderRadius: 4
                                }}
                              >
                                {isPartial ? 'PARCIAL · REACONDICIONADA' : 'COMPLETA · REACONDICIONADA'}
                              </span>
                              <span style={{ fontSize: 11, fontWeight: 700, color: isPartial ? '#92400E' : '#0F172A', backgroundColor: '#F1F5F9', padding: '2px 8px', borderRadius: 4 }}>
                                {isPartial ? `Parcial: ${box.cantidad} de ${stdCap} piezas · Reacondicionada` : `${box.cantidad} pzas`}
                              </span>
                            </div>

                            <div style={{ fontSize: 14, fontWeight: 800, color: '#0F172A', marginBottom: 2 }}>
                              {box.codigo}
                            </div>
                            <div style={{ fontSize: 12, fontWeight: 600, color: '#0284C7' }}>
                              {box.skuCodigo}
                            </div>
                            <div style={{ fontSize: 11.5, color: '#475569', marginBottom: 10, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {box.skuDescripcion}
                            </div>

                            <div style={{ display: 'flex', gap: 12, fontSize: 11, color: '#64748B', marginBottom: 10 }}>
                              <span>Lote: <strong>{box.loteTexto || 'S/L'}</strong></span>
                              <span>Cad: <strong>{box.fechaVencimiento ? String(box.fechaVencimiento).slice(0, 10) : 'N/A'}</strong></span>
                            </div>

                            {/* ESTADO ACTUAL Y CICLO OPERATIVO */}
                            <div
                              style={{
                                padding: '8px 10px',
                                backgroundColor: isPutawayDone ? '#F0FDF4' : isLabelPlaced ? '#EFF6FF' : '#FFFBEB',
                                borderRadius: 6,
                                border: `1px solid ${isPutawayDone ? '#BBF7D0' : isLabelPlaced ? '#BFDBFE' : '#FDE68A'}`,
                                marginBottom: 12
                              }}
                            >
                              <div
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 6,
                                  fontSize: 11,
                                  fontWeight: 700,
                                  color: isPutawayDone ? '#15803D' : isLabelPlaced ? '#1D4ED8' : '#B45309'
                                }}
                              >
                                {isPutawayDone ? (
                                  <>
                                    <MapPin size={13} style={{ color: '#15803D', flexShrink: 0 }} />
                                    <span>Ubicación actual: <strong>{rackActual}</strong> (Activo / Disponible)</span>
                                  </>
                                ) : isLabelPlaced ? (
                                  <>
                                    <Tag size={13} style={{ color: '#1D4ED8', flexShrink: 0 }} />
                                    <span>Etiquetada · Pendiente de alojamiento en racks</span>
                                  </>
                                ) : (
                                  <>
                                    <Clock size={13} style={{ color: '#B45309', flexShrink: 0 }} />
                                    <span>Pendiente de etiquetado y alojamiento en racks</span>
                                  </>
                                )}
                              </div>
                              <div style={{ fontSize: 9.5, color: '#64748B', fontStyle: 'italic', marginTop: 3 }}>
                                {isPutawayDone
                                  ? 'Alojamiento en racks verificado · Existencia activa disponible en inventario comercial'
                                  : isLabelPlaced
                                  ? `Ubicación operativa: ${rawUbi || 'RAMPA_RECEPCION'} · Pendiente de traslado a racks (Putaway)`
                                  : `Ubicación operativa: ${rawUbi || 'RAMPA_RECEPCION'} · No disponible para despacho comercial hasta completar Putaway`}
                              </div>
                            </div>

                            {/* BARCODE PREVIEW */}
                            <div style={{ textAlign: 'center', backgroundColor: '#F8FAFC', padding: '8px', borderRadius: 6, border: '1px solid #F1F5F9', marginBottom: 12 }}>
                              <svg
                                ref={(el) => { barcodeSvgs.current[box.codigo] = el; }}
                                style={{ maxWidth: '100%', height: '36px' }}
                              />
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => handlePrintSingleLabel(box)}
                            style={{
                              width: '100%',
                              padding: '8px',
                              backgroundColor: '#0F172A',
                              color: '#FFFFFF',
                              border: 'none',
                              borderRadius: 6,
                              fontSize: 12,
                              fontWeight: 700,
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: 6
                            }}
                          >
                            <Printer size={14} /> Imprimir Etiqueta Térmica
                          </button>
                        </div>
                      );
                    })}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* PIE DE PÁGINA / FOOTER */}
        <div
          style={{
            padding: '12px 24px',
            backgroundColor: '#FFFFFF',
            borderTop: '1px solid #E2E8F0',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: 12,
            color: '#64748B'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <ShieldCheck size={16} style={{ color: '#0284C7' }} />
            <span>Control de Calidad Giving Out WMS · Inspección Técnica y Trazabilidad Integral</span>
          </div>

          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '6px 14px',
              backgroundColor: '#F1F5F9',
              border: '1px solid #CBD5E1',
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 600,
              color: '#334155',
              cursor: 'pointer'
            }}
          >
            Cerrar Ventana
          </button>
        </div>
      </div>

      {/* ESTILOS DE IMPRESIÓN OFICIALES CALIBRADOS PARA HOJA CARTA */}
      <style>{`
        @media print {
          @page {
            size: letter portrait;
            margin: 8mm 8mm;
          }
          html, body {
            margin: 0 !important;
            padding: 0 !important;
            background: #FFFFFF !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          body * {
            visibility: hidden !important;
          }
          #print-area-calidad, #print-area-calidad * {
            visibility: visible !important;
          }
          #print-area-calidad {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            max-width: 100% !important;
            box-sizing: border-box !important;
            margin: 0 !important;
            padding: 2mm 3mm !important;
            background: #FFFFFF !important;
            box-shadow: none !important;
            border: none !important;
            overflow: visible !important;
          }
        }
      `}</style>
    </div>
  );
}
