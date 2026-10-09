import React, { useEffect, useRef, useState } from 'react';
import {
  Printer, X, Truck, ShieldCheck, CheckCircle2,
  AlertTriangle, FileText, Calendar, Layers, AlertCircle, RefreshCw
} from 'lucide-react';
import JsBarcode from 'jsbarcode';
import { API } from '../config/api';
import { formatTimelineDateTime } from '../utils/dateUtils';

interface RampDocumentModalProps {
  receipt: any;
  token?: string;
  onClose: () => void;
}

export function RampDocumentModal({ receipt, token, onClose }: RampDocumentModalProps) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const barcodeRef = useRef<SVGSVGElement | null>(null);

  const loadAcuse = async () => {
    if (!receipt?.id) {
      setLoadError('El identificador del previo no está disponible.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setLoadError(null);

    try {
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`${API}/receipts/${receipt.id}/acuse-rampa`, { headers });
      if (!res.ok) {
        throw new Error(`El servidor respondió con código HTTP ${res.status}.`);
      }
      const json = await res.json();
      setData(json);
    } catch (err: any) {
      console.error('Error al cargar acuse oficial de rampa:', err);
      setLoadError(err.message || 'No fue posible cargar el acta de rampa desde el servidor.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAcuse();
  }, [receipt?.id, token]);

  // Generar código de barras Code-128 para el folio de transporte / previo
  useEffect(() => {
    if (barcodeRef.current && data) {
      const folioBarcode =
        data.transporte?.folio ||
        data.transporte?.folioTransporte ||
        data.folioTransporte ||
        data.codigo ||
        receipt?.folioTransporte ||
        receipt?.codigo ||
        'REC-0000-0000';

      try {
        JsBarcode(barcodeRef.current, folioBarcode, {
          format: 'CODE128',
          width: 1.6,
          height: 38,
          displayValue: true,
          font: 'monospace',
          fontSize: 11,
          margin: 0,
          lineColor: '#0F172A',
        });
      } catch (err) {
        console.warn('Error rendering barcode in RampDocumentModal:', err);
      }
    }
  }, [data, receipt]);

  const handlePrint = () => {
    if (loadError || !data) return;
    window.print();
  };

  // --- EXTRACCIÓN ROBUSTA Y NORMALIZADA DE METADATOS ---
  // Depositante / Cliente
  const clienteNombre =
    typeof data?.cliente === 'string' && data.cliente.trim() !== '' && data.cliente !== 'Cliente'
      ? data.cliente
      : (data?.clienteNombre && data.clienteNombre !== 'Cliente'
          ? data.clienteNombre
          : (data?.clienteObj?.nombreComercial ||
             data?.clienteObj?.razonSocial ||
             data?.cliente?.nombreComercial ||
             data?.cliente?.razonSocial ||
             receipt?.cliente?.nombreComercial ||
             receipt?.cliente?.razonSocial ||
             (typeof data?.cliente === 'string' ? data.cliente : '—')));

  // Datos de Transporte
  const transporte = data?.transporte || {};
  const lineaTransporte =
    transporte.linea || transporte.lineaTransporte || receipt?.lineaTransporte || '—';
  const placa =
    transporte.placa || receipt?.placa || '—';
  const capacidadCarga =
    transporte.unidad || transporte.capacidadCarga || receipt?.capacidadCarga || '—';
  const nombreChofer =
    transporte.chofer || transporte.nombreChofer || receipt?.nombreChofer || '—';
  const anden =
    transporte.anden || transporte.andenAsignado || receipt?.andenAsignado || 'Rampa 1';
  const folioTransporte =
    transporte.folio || transporte.folioTransporte || data?.folioTransporte || data?.codigo || receipt?.codigo || '—';

  // Folio Previo y Documento de Respaldo
  const codigoPrevio = data?.codigo || receipt?.codigo || '—';
  const facturaRespaldo =
    data?.facturaRespaldo || data?.ocReferencia || receipt?.facturaRespaldo || receipt?.ocReferencia || 'S/N';

  // Balance Físico de Bultos
  const conteo = data?.conteoExterior || data?.conteoRampa || {};
  const bultosDeclarados =
    conteo.declarados !== undefined && conteo.declarados !== null
      ? conteo.declarados
      : (conteo.bultosDeclarados !== undefined && conteo.bultosDeclarados !== null
          ? conteo.bultosDeclarados
          : (receipt?.bultosDeclarados !== undefined && receipt?.bultosDeclarados !== null
              ? receipt.bultosDeclarados
              : null));

  const bultosRecibidos =
    conteo.recibidos !== undefined && conteo.recibidos !== null
      ? conteo.recibidos
      : (conteo.bultosRecibidos !== undefined && conteo.bultosRecibidos !== null
          ? conteo.bultosRecibidos
          : (receipt?.bultosRecibidos !== undefined && receipt?.bultosRecibidos !== null
              ? receipt.bultosRecibidos
              : null));

  const bultosDanados =
    conteo.danadosVisibles !== undefined && conteo.danadosVisibles !== null
      ? conteo.danadosVisibles
      : (conteo.bultosDanados !== undefined && conteo.bultosDanados !== null
          ? conteo.bultosDanados
          : (receipt?.bultosDanados !== undefined && receipt?.bultosDanados !== null
              ? receipt.bultosDanados
              : null));

  const diferencia =
    conteo.diferencia !== undefined && conteo.diferencia !== null
      ? conteo.diferencia
      : (conteo.diferenciaBultos !== undefined && conteo.diferenciaBultos !== null
          ? conteo.diferenciaBultos
          : (bultosRecibidos !== null && bultosDeclarados !== null
              ? bultosRecibidos - bultosDeclarados
              : (receipt?.diferenciaBultos !== undefined && receipt?.diferenciaBultos !== null
                  ? receipt.diferenciaBultos
                  : null)));

  const tieneDanados = typeof bultosDanados === 'number' && bultosDanados > 0;
  const tieneDiferencia = typeof diferencia === 'number' && diferencia !== 0;
  const tieneReservas = tieneDanados || tieneDiferencia;

  // Observaciones de Rampa
  const observacionesRampa =
    conteo.observaciones ||
    conteo.observacionesRampa ||
    data?.observaciones ||
    receipt?.observacionesRampa ||
    '';

  // Firmas Digitales
  const firmas = data?.firmas || {};
  const firmaChofer =
    firmas.chofer || firmas.firmaChofer || receipt?.firmaChofer || null;
  const firmaReceptor =
    firmas.receptor || firmas.firmaReceptor || receipt?.firmaReceptor || null;
  const nombreReceptor =
    firmas.nombreReceptor || data?.nombreReceptor || receipt?.nombreReceptor || 'Receptor de Andén';

  const leyendaChofer =
    firmas.leyendaChofer ||
    data?.estadoRampa?.leyendaChofer ||
    (tieneReservas
      ? 'Entregó con reservas y discrepancias asentadas'
      : 'Entregó carga conforme (revisión exterior)');

  // Fechas Identificadas por Separado
  const fechaLiberacionReal =
    firmas.fechaHoraLiberacion ||
    firmas.fechaLiberacionChofer ||
    data?.estadoRampa?.fechaLiberacionChofer ||
    receipt?.fechaLiberacionChofer ||
    null;

  const fechaLiberacionTexto = fechaLiberacionReal
    ? formatTimelineDateTime(fechaLiberacionReal)
    : 'Pendiente de liberación en rampa';

  const fechaImpresionTexto = formatTimelineDateTime(new Date());

  // Alcance del Acta y Cláusula de Deslinde Operativo
  const alcanceTexto =
    data?.avisoLegal ||
    data?.alcanceActa ||
    data?.estadoRampa?.leyendaLegal ||
    'El presente documento certifica exclusivamente un conteo físico global y la revisión del estado exterior de bultos/cajas cerrado en rampa de descarga para la liberación del transporte. La recepción definitiva del inventario queda estrictamente sujeta a la apertura, inspección técnica interna pieza por pieza, verificación de códigos SKU, números de lote, fechas de caducidad, conteo de unidades interiores y dictamen de calidad posterior.';

  // Historial de Auditoría
  const historial = Array.isArray(data?.historialCorrecciones)
    ? data.historialCorrecciones
    : (typeof receipt?.historialCorreccionesRampa === 'string'
        ? (() => { try { return JSON.parse(receipt.historialCorreccionesRampa); } catch { return []; } })()
        : (Array.isArray(receipt?.historialCorreccionesRampa) ? receipt.historialCorreccionesRampa : []));

  return (
    <>
      {/* ESTILOS DE IMPRESIÓN CALIBRADOS EN HOJA CARTA (SIN DESBORDAMIENTOS NI CORTES) */}
      <style>{`
        @media print {
          @page {
            size: letter portrait;
            margin: 8mm 10mm;
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
          #print-area-rampa, #print-area-rampa * {
            visibility: visible !important;
          }
          #print-area-rampa {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            max-width: 100% !important;
            box-sizing: border-box !important;
            margin: 0 !important;
            padding: 0 !important;
            background: #FFFFFF !important;
            box-shadow: none !important;
            border: none !important;
            overflow: visible !important;
          }
          .no-print {
            display: none !important;
          }
        }
      `}</style>

      <div
        style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.72)',
          backdropFilter: 'blur(4px)',
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 16,
          boxSizing: 'border-box',
          overflowY: 'auto',
        }}
      >
        <div
          style={{
            backgroundColor: '#FFFFFF',
            borderRadius: 12,
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.35)',
            width: '100%',
            maxWidth: 840,
            maxHeight: '94vh',
            display: 'flex',
            flexDirection: 'column',
            boxSizing: 'border-box',
            overflow: 'hidden',
          }}
        >
          {/* BARRA SUPERIOR DE ACCIONES (NO IMPRIMIBLE) */}
          <div
            className="no-print"
            style={{
              padding: '12px 20px',
              backgroundColor: '#F8FAFC',
              borderBottom: '1px solid #E2E8F0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              boxSizing: 'border-box',
              flexShrink: 0,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <FileText size={18} style={{ color: '#0D9488' }} />
              <span style={{ fontSize: 14, fontWeight: 700, color: '#0F172A' }}>
                Acta Administrativa de Rampa (Formato Carta Oficial)
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {!loading && !loadError && (
                <button
                  type="button"
                  onClick={handlePrint}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '7px 14px',
                    borderRadius: 6,
                    fontSize: 13,
                    fontWeight: 700,
                    backgroundColor: '#0D9488',
                    border: '1px solid #0D9488',
                    color: '#FFFFFF',
                    cursor: 'pointer',
                    boxShadow: '0 2px 4px rgba(13,148,136,0.25)',
                  }}
                >
                  <Printer size={15} /> Imprimir Acta (Hoja Carta)
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#64748B',
                  cursor: 'pointer',
                  padding: 4,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                title="Cerrar modal"
              >
                <X size={20} />
              </button>
            </div>
          </div>

          {/* CONTENEDOR CON SCROLL (VISTA PREVIA Y ESTADOS) */}
          <div
            style={{
              padding: '24px 28px',
              overflowY: 'auto',
              overflowX: 'hidden',
              flex: 1,
              backgroundColor: '#FFFFFF',
              boxSizing: 'border-box',
            }}
          >
            {/* ESTADO DE CARGA */}
            {loading && (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '60px 20px',
                  gap: 12,
                  color: '#475569',
                }}
              >
                <RefreshCw size={28} className="animate-spin" style={{ color: '#0D9488' }} />
                <div style={{ fontSize: 14, fontWeight: 600 }}>
                  Consultando acta oficial de rampa desde el servidor...
                </div>
              </div>
            )}

            {/* ESTADO DE ERROR DE CARGA */}
            {!loading && loadError && (
              <div
                style={{
                  padding: '28px',
                  textAlign: 'center',
                  backgroundColor: '#FEF2F2',
                  borderRadius: 10,
                  border: '1px solid #FCA5A5',
                  margin: '20px 0',
                }}
              >
                <AlertCircle size={40} style={{ color: '#DC2626', marginBottom: 12, display: 'inline-block' }} />
                <div style={{ fontSize: 16, fontWeight: 800, color: '#991B1B', marginBottom: 6 }}>
                  No se pudo cargar el Acta Oficial de Rampa
                </div>
                <div style={{ fontSize: 13, color: '#7F1D1D', marginBottom: 18, maxWidth: 500, margin: '0 auto 18px' }}>
                  {loadError}
                </div>
                <div style={{ display: 'flex', justifyContent: 'center', gap: 10 }}>
                  <button
                    type="button"
                    onClick={loadAcuse}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '8px 16px',
                      borderRadius: 6,
                      backgroundColor: '#DC2626',
                      color: '#FFFFFF',
                      border: 'none',
                      fontWeight: 700,
                      fontSize: 12.5,
                      cursor: 'pointer',
                    }}
                  >
                    <RefreshCw size={14} /> Reintentar Carga
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    style={{
                      padding: '8px 16px',
                      borderRadius: 6,
                      backgroundColor: '#FFFFFF',
                      color: '#475569',
                      border: '1px solid #CBD5E1',
                      fontWeight: 600,
                      fontSize: 12.5,
                      cursor: 'pointer',
                    }}
                  >
                    Cerrar
                  </button>
                </div>
              </div>
            )}

            {/* DOCUMENTO OFICIAL FORMAL (SOLO RENDERIZA SI CARGÓ EXITOSAMENTE) */}
            {!loading && !loadError && data && (
              <div
                id="print-area-rampa"
                style={{
                  boxSizing: 'border-box',
                  width: '100%',
                  maxWidth: '100%',
                  overflowX: 'hidden',
                }}
              >
                {/* ENCABEZADO EJECUTIVO */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    borderBottom: '2px solid #0F172A',
                    paddingBottom: 12,
                    marginBottom: 14,
                    gap: 16,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 20, fontWeight: 900, color: '#0F172A', letterSpacing: '-0.02em', lineHeight: 1.15 }}>
                      GIVING OUT <span style={{ color: '#0D9488' }}>3PL WMS</span>
                    </div>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 2 }}>
                      Centro de Distribución & Almacén Fiscalizado · Tepotzotlán
                    </div>
                    <div style={{ fontSize: 12.5, fontWeight: 800, color: '#0F172A', marginTop: 6, lineHeight: 1.25 }}>
                      ACTA ADMINISTRATIVA DE ARRIBO, DESCARGA Y CONTEO GLOBAL EN RAMPA
                    </div>
                  </div>

                  <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', flexShrink: 0 }}>
                    <svg ref={barcodeRef} style={{ maxWidth: 175 }} />
                    <div style={{ fontSize: 9.5, color: '#475569', marginTop: 4 }}>
                      Liberación en Rampa: <strong style={{ color: '#0F172A' }}>{fechaLiberacionTexto}</strong>
                    </div>
                    <div style={{ fontSize: 9, color: '#64748B', marginTop: 1 }}>
                      Fecha Impresión: {fechaImpresionTexto}
                    </div>
                  </div>
                </div>

                {/* SECCIÓN 1: DATOS GENERALES Y TRANSPORTE */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                    gap: 8,
                    backgroundColor: '#F8FAFC',
                    padding: '10px 12px',
                    borderRadius: 6,
                    border: '1px solid #E2E8F0',
                    marginBottom: 12,
                    fontSize: 10.5,
                    boxSizing: 'border-box',
                  }}
                >
                  <div>
                    <div style={{ color: '#64748B', fontWeight: 600 }}>Folio Previo:</div>
                    <div style={{ fontWeight: 800, color: '#0F172A', fontSize: 11.5, wordBreak: 'break-all' }}>
                      {codigoPrevio}
                    </div>
                  </div>
                  <div>
                    <div style={{ color: '#64748B', fontWeight: 600 }}>Factura / Remisión:</div>
                    <div style={{ fontWeight: 800, color: '#0F172A', fontSize: 11.5, wordBreak: 'break-all' }}>
                      {facturaRespaldo}
                    </div>
                  </div>
                  <div>
                    <div style={{ color: '#64748B', fontWeight: 600 }}>Depositante / Cliente:</div>
                    <div style={{ fontWeight: 800, color: '#0F172A', fontSize: 11.5 }}>
                      {clienteNombre}
                    </div>
                  </div>
                  <div>
                    <div style={{ color: '#64748B', fontWeight: 600 }}>Andén Asignado:</div>
                    <div style={{ fontWeight: 800, color: '#0D9488', fontSize: 11.5 }}>
                      {anden}
                    </div>
                  </div>

                  <div>
                    <div style={{ color: '#64748B', fontWeight: 600 }}>Línea Transportista:</div>
                    <div style={{ fontWeight: 700, color: '#0F172A' }}>{lineaTransporte}</div>
                  </div>
                  <div>
                    <div style={{ color: '#64748B', fontWeight: 600 }}>Placas Unidad:</div>
                    <div style={{ fontWeight: 700, color: '#0F172A' }}>{placa}</div>
                  </div>
                  <div>
                    <div style={{ color: '#64748B', fontWeight: 600 }}>Capacidad Vehículo:</div>
                    <div style={{ fontWeight: 700, color: '#0F172A' }}>{capacidadCarga}</div>
                  </div>
                  <div>
                    <div style={{ color: '#64748B', fontWeight: 600 }}>Operador / Chofer:</div>
                    <div style={{ fontWeight: 700, color: '#0F172A' }}>{nombreChofer}</div>
                  </div>
                </div>

                {/* SECCIÓN 2: TABLA DE BALANCE DE BULTOS */}
                <div style={{ marginBottom: 10 }}>
                  <table
                    style={{
                      width: '100%',
                      borderCollapse: 'collapse',
                      border: '1px solid #CBD5E1',
                      fontSize: 11,
                      tableLayout: 'fixed',
                      boxSizing: 'border-box',
                    }}
                  >
                    <thead>
                      <tr style={{ backgroundColor: '#0F172A', color: '#FFFFFF', textAlign: 'center' }}>
                        <th style={{ padding: '7px 8px', fontWeight: 700, width: '25%' }}>Bultos Declarados</th>
                        <th style={{ padding: '7px 8px', fontWeight: 700, width: '25%' }}>Bultos Recibidos</th>
                        <th style={{ padding: '7px 8px', fontWeight: 700, width: '25%' }}>Con Daño Exterior</th>
                        <th style={{ padding: '7px 8px', fontWeight: 700, width: '25%' }}>Diferencia en Rampa</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr style={{ textAlign: 'center', backgroundColor: '#FFFFFF', fontSize: 13.5 }}>
                        <td style={{ padding: '10px 8px', fontWeight: 700, border: '1px solid #CBD5E1', color: '#334155' }}>
                          {bultosDeclarados !== null ? bultosDeclarados : '—'}
                          <div style={{ fontSize: 9.5, fontWeight: 500, color: '#64748B' }}>Carta Porte / Remisión</div>
                        </td>
                        <td style={{ padding: '10px 8px', fontWeight: 800, border: '1px solid #CBD5E1', color: '#0284C7' }}>
                          {bultosRecibidos !== null ? bultosRecibidos : '—'}
                          <div style={{ fontSize: 9.5, fontWeight: 500, color: '#64748B' }}>Descarga Física en Bahía</div>
                        </td>
                        <td style={{ padding: '10px 8px', fontWeight: 800, border: '1px solid #CBD5E1', color: tieneDanados ? '#D97706' : '#64748B' }}>
                          {bultosDanados !== null ? bultosDanados : '—'}
                          <div style={{ fontSize: 9.5, fontWeight: tieneDanados ? 700 : 500, color: tieneDanados ? '#DC2626' : '#64748B' }}>
                            {tieneDanados
                              ? `(Subconjunto de los ${bultosRecibidos ?? '—'} recibidos)`
                              : '(Sin daño exterior)'}
                          </div>
                        </td>
                        <td
                          style={{
                            padding: '10px 8px',
                            fontWeight: 900,
                            border: '1px solid #CBD5E1',
                            color:
                              diferencia === null
                                ? '#64748B'
                                : diferencia === 0
                                ? (tieneDanados ? '#D97706' : '#059669')
                                : diferencia > 0
                                ? '#0284C7'
                                : '#DC2626',
                          }}
                        >
                          {diferencia !== null ? (diferencia > 0 ? `+${diferencia}` : `${diferencia}`) : '—'}
                          <div style={{ fontSize: 10, fontWeight: 700 }}>
                            {diferencia === null
                              ? '—'
                              : diferencia === 0
                              ? (tieneDanados ? '0 (Cuadrado con Daño)' : '0 (Sin diferencia)')
                              : diferencia > 0
                              ? 'Sobrante no amparado'
                              : 'Faltante en entrega'}
                          </div>
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  {/* ADVERTENCIA DE CONDICIÓN DE CARGA (PRESERVA ADVERTENCIA POR DAÑO AUN CON DIFERENCIA 0) */}
                  <div
                    style={{
                      marginTop: 6,
                      padding: '6px 10px',
                      borderRadius: 4,
                      fontSize: 10.5,
                      fontWeight: 600,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      backgroundColor: tieneReservas ? '#FEF3C7' : '#DCFCE7',
                      border: `1px solid ${tieneReservas ? '#FDE68A' : '#BBF7D0'}`,
                      color: tieneReservas ? '#92400E' : '#166534',
                    }}
                  >
                    {tieneReservas ? (
                      <>
                        <AlertTriangle size={14} style={{ color: '#D97706', flexShrink: 0 }} />
                        <span>
                          <strong>Condición de Carga: CON RESERVAS.</strong>{' '}
                          {tieneDanados && `Se reporta ${bultosDanados} bulto(s) con daño exterior visible en empaque.`}
                          {tieneDiferencia && ` Diferencia neta de ${diferencia} bulto(s) contra lo declarado.`}{' '}
                          Sujeto a dictamen técnico e inspección interna en almacén.
                        </span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 size={14} style={{ color: '#16A34A', flexShrink: 0 }} />
                        <span>
                          <strong>Condición de Carga: CONFORME.</strong> Entrega exteriormente íntegra y cuadrada sin daño visible en rampa.
                        </span>
                      </>
                    )}
                  </div>
                </div>

                {/* OBSERVACIONES DEL ESTADO FÍSICO EXTERIOR */}
                <div
                  style={{
                    padding: '8px 12px',
                    borderRadius: 6,
                    border: '1px solid #E2E8F0',
                    backgroundColor: '#F8FAFC',
                    marginBottom: 10,
                    fontSize: 10.5,
                    boxSizing: 'border-box',
                  }}
                >
                  <strong style={{ color: '#0F172A' }}>Observaciones de Estado Físico Exterior en Rampa:</strong>{' '}
                  <span style={{ color: '#334155' }}>
                    {observacionesRampa || 'Carga recibida en empaque estándar sin anomalías exteriores asentadas.'}
                  </span>
                </div>

                {/* SECCIÓN 3: ALCANCE DEL ACTA & DESLINDE OPERATIVO (REVISIÓN POSTERIOR OBLIGATORIA) */}
                <div
                  style={{
                    padding: '9px 12px',
                    borderRadius: 6,
                    border: '1px solid #CBD5E1',
                    backgroundColor: '#F1F5F9',
                    marginBottom: 12,
                    fontSize: 10,
                    color: '#334155',
                    lineHeight: 1.45,
                    boxSizing: 'border-box',
                  }}
                >
                  <strong style={{ color: '#0F172A', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                    Alcance del Acta & Dictamen Posterior (Revisión Exterior en Rampa):
                  </strong>{' '}
                  {alcanceTexto}
                </div>

                {/* SECCIÓN 4: FIRMAS DIGITALES Y LEYENDAS LEGALES */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                    gap: 16,
                    marginBottom: 12,
                    boxSizing: 'border-box',
                  }}
                >
                  {/* FIRMA OPERADOR TRANSPORTISTA */}
                  <div
                    style={{
                      border: '1px solid #CBD5E1',
                      borderRadius: 6,
                      padding: '8px 10px',
                      textAlign: 'center',
                      backgroundColor: '#FFFFFF',
                      boxSizing: 'border-box',
                      minWidth: 0,
                    }}
                  >
                    <div style={{ height: 75, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {firmaChofer ? (
                        <img
                          src={firmaChofer}
                          alt="Firma del Chofer"
                          style={{ maxHeight: 70, maxWidth: '92%', objectFit: 'contain' }}
                        />
                      ) : (
                        <div style={{ color: '#94A3B8', fontSize: 11, fontStyle: 'italic' }}>
                          Sin firma digital capturada
                        </div>
                      )}
                    </div>
                    <div style={{ borderTop: '1px solid #0F172A', paddingTop: 4, marginTop: 2 }}>
                      <div style={{ fontSize: 11.5, fontWeight: 800, color: '#0F172A', wordBreak: 'break-word' }}>
                        {nombreChofer !== '—' ? nombreChofer : 'Firma del Operador de Transporte'}
                      </div>
                      <div style={{ fontSize: 9.5, color: '#64748B' }}>
                        Operador Transportista · {lineaTransporte}
                      </div>
                      <div
                        style={{
                          marginTop: 3,
                          fontSize: 9.5,
                          fontWeight: 700,
                          color: tieneReservas ? '#B45309' : '#15803D',
                          padding: '2px 6px',
                          backgroundColor: tieneReservas ? '#FEF3C7' : '#DCFCE7',
                          borderRadius: 4,
                          display: 'inline-block',
                          maxWidth: '100%',
                          wordBreak: 'break-word',
                        }}
                      >
                        «{leyendaChofer}»
                      </div>
                    </div>
                  </div>

                  {/* FIRMA RECEPTOR DE ANDÉN */}
                  <div
                    style={{
                      border: '1px solid #CBD5E1',
                      borderRadius: 6,
                      padding: '8px 10px',
                      textAlign: 'center',
                      backgroundColor: '#FFFFFF',
                      boxSizing: 'border-box',
                      minWidth: 0,
                    }}
                  >
                    <div style={{ height: 75, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {firmaReceptor ? (
                        <img
                          src={firmaReceptor}
                          alt="Firma del Receptor"
                          style={{ maxHeight: 70, maxWidth: '92%', objectFit: 'contain' }}
                        />
                      ) : (
                        <div style={{ color: '#94A3B8', fontSize: 11, fontStyle: 'italic' }}>
                          Sin firma digital capturada
                        </div>
                      )}
                    </div>
                    <div style={{ borderTop: '1px solid #0F172A', paddingTop: 4, marginTop: 2 }}>
                      <div style={{ fontSize: 11.5, fontWeight: 800, color: '#0F172A', wordBreak: 'break-word' }}>
                        {nombreReceptor}
                      </div>
                      <div style={{ fontSize: 9.5, color: '#64748B' }}>
                        Giving Out WMS · Supervisor / Receptor de Andén
                      </div>
                      <div
                        style={{
                          marginTop: 3,
                          fontSize: 9.5,
                          fontWeight: 700,
                          color: '#334155',
                          padding: '2px 6px',
                          backgroundColor: '#F1F5F9',
                          borderRadius: 4,
                          display: 'inline-block',
                        }}
                      >
                        «Recibió en andén y atestiguó conteo exterior»
                      </div>
                    </div>
                  </div>
                </div>

                {/* SECCIÓN 5: BITÁCORA INMUTABLE DE RECTIFICACIONES AUDITADAS */}
                {historial && historial.length > 0 && (
                  <div
                    style={{
                      marginTop: 10,
                      padding: '8px 10px',
                      borderRadius: 6,
                      border: '1px solid #E2E8F0',
                      backgroundColor: '#F8FAFC',
                      fontSize: 9.5,
                      boxSizing: 'border-box',
                    }}
                  >
                    <div style={{ fontWeight: 800, color: '#0F172A', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Bitácora Inmutable de Rectificaciones en Rampa (Auditoría Post-Firma):
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {historial.map((h: any, idx: number) => {
                        const ant = h.valoresAnteriores;
                        const nue = h.valoresNuevos;
                        const fechaEvento = h.fecha
                          ? formatTimelineDateTime(h.fecha)
                          : '—';

                        return (
                          <div
                            key={idx}
                            style={{
                              padding: '6px 8px',
                              borderRadius: 4,
                              backgroundColor: '#FFFFFF',
                              border: '1px solid #E2E8F0',
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                              <span style={{ fontWeight: 700, color: '#0F172A' }}>
                                Evento #{idx + 1} · {fechaEvento}
                              </span>
                              <span style={{ color: '#64748B' }}>
                                Auditor: <strong style={{ color: '#0F172A' }}>{h.usuario || 'Supervisor'}</strong>
                              </span>
                            </div>
                            <div style={{ color: '#334155', marginBottom: 3 }}>
                              <strong style={{ color: '#0F172A' }}>Motivo:</strong> {h.motivo || 'Sin motivo registrado'}
                            </div>

                            {/* VALORES ANTERIORES Y NUEVOS REALES SIN ETIQUETAS VACÍAS */}
                            {ant && (
                              <div style={{ color: '#64748B', display: 'flex', flexWrap: 'wrap', gap: 10, fontSize: 9 }}>
                                <span>
                                  <strong style={{ color: '#475569' }}>Bultos Previos:</strong> Decl: {ant.bultosDeclarados ?? '—'} | Rec: {ant.bultosRecibidos ?? '—'} | Dañ: {ant.bultosDanados ?? '—'}{' '}
                                  (Dif: {ant.diferenciaBultos !== undefined ? (ant.diferenciaBultos > 0 ? `+${ant.diferenciaBultos}` : ant.diferenciaBultos) : '—'})
                                </span>
                                {nue && (
                                  <span>
                                    <strong style={{ color: '#0D9488' }}>Bultos Rectificados:</strong> Decl: {nue.bultosDeclarados ?? '—'} | Rec: {nue.bultosRecibidos ?? '—'} | Dañ: {nue.bultosDanados ?? '—'}{' '}
                                    (Dif: {nue.diferenciaBultos !== undefined ? (nue.diferenciaBultos > 0 ? `+${nue.diferenciaBultos}` : nue.diferenciaBultos) : '—'})
                                  </span>
                                )}
                              </div>
                            )}

                            {!ant && h.bultosDeclaradosPrevios !== undefined && (
                              <div style={{ color: '#64748B', fontSize: 9 }}>
                                Bultos Previos: Decl: {h.bultosDeclaradosPrevios} | Rec: {h.bultosRecibidosPrevios} | Dañ: {h.bultosDanadosPrevios}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
