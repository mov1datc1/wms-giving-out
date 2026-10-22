import { useEffect, useState, useRef } from 'react';
import {
  FileText, Truck, ShieldCheck, CheckCircle2,
  AlertTriangle, X, Printer, Package, Store, MapPin,
  Calendar, Edit3, Send, Layers, AlertCircle,
  ShieldAlert, FileWarning, Clock, ArrowRight
} from 'lucide-react';
import { API } from '../config/api';
import { formatCalendarDate } from '../utils/dateUtils';

interface DispatchManifestModalProps {
  orderId: string;
  token: string;
  currentUser: string;
  onClose: () => void;
  onSuccess?: () => void;
}

function isCanvasBlank(canvas: HTMLCanvasElement | null): boolean {
  if (!canvas) return true;
  const ctx = canvas.getContext('2d');
  if (!ctx) return true;
  try {
    const pixelBuffer = new Uint32Array(
      ctx.getImageData(0, 0, canvas.width, canvas.height).data.buffer
    );
    return !pixelBuffer.some(color => color !== 0);
  } catch {
    return false;
  }
}

export function DispatchManifestModal({
  orderId,
  token,
  currentUser,
  onClose,
  onSuccess,
}: DispatchManifestModalProps) {
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [manifestData, setManifestData] = useState<any>(null);

  // Formulario de transporte
  const [transportForm, setTransportForm] = useState({
    tipoTransporte: 'DIRECTO',
    fletera: 'Transportes Logísticos Especializados',
    choferNombre: '',
    choferLicencia: '',
    vehiculoPlaca: '',
    paqueteria: '',
    numeroGuia: '',
    selloSeguridad: '',
    notas: '',
  });

  // Canvas de firmas
  const despachadorCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const choferCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawingDespachador, setIsDrawingDespachador] = useState(false);
  const [isDrawingChofer, setIsDrawingChofer] = useState(false);
  const [hasDespachadorFirma, setHasDespachadorFirma] = useState(false);
  const [hasChoferFirma, setHasChoferFirma] = useState(false);

  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  useEffect(() => {
    loadManifest();
  }, [orderId]);

  async function loadManifest() {
    setLoading(true);
    setErrorMsg('');
    try {
      const res = await fetch(`${API}/orders/${orderId}/manifest`, { headers });
      if (!res.ok) throw new Error('Error al cargar datos del manifiesto');
      const data = await res.json();
      setManifestData(data);

      if (data.order) {
        setTransportForm({
          tipoTransporte: data.order.tipoTransporte || 'DIRECTO',
          fletera: data.order.fletera || (data.order.paqueteria ? data.order.paqueteria : 'Transportes Logísticos Especializados'),
          choferNombre: data.order.choferNombre || '',
          choferLicencia: data.order.choferLicencia || '',
          vehiculoPlaca: data.order.vehiculoPlaca || '',
          paqueteria: data.order.paqueteria || '',
          numeroGuia: data.order.numeroGuia || '',
          selloSeguridad: data.order.selloSeguridad || `SELLO-${Math.floor(100000 + Math.random() * 900000)}`,
          notas: data.order.notas || '',
        });
        if (data.order.firmaDespachador) setHasDespachadorFirma(true);
        if (data.order.firmaChofer) setHasChoferFirma(true);
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'No se pudo obtener el manifiesto');
    }
    setLoading(false);
  }

  // --- Canvas helper functions ---
  function startDrawing(type: 'despachador' | 'chofer', e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) {
    const canvas = type === 'despachador' ? despachadorCanvasRef.current : choferCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const x = 'touches' in e ? e.touches[0].clientX - rect.left : e.clientX - rect.left;
    const y = 'touches' in e ? e.touches[0].clientY - rect.top : e.clientY - rect.top;

    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';

    if (type === 'despachador') {
      setIsDrawingDespachador(true);
      setHasDespachadorFirma(true);
    } else {
      setIsDrawingChofer(true);
      setHasChoferFirma(true);
    }
  }

  function draw(type: 'despachador' | 'chofer', e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) {
    const isDrawing = type === 'despachador' ? isDrawingDespachador : isDrawingChofer;
    if (!isDrawing) return;
    const canvas = type === 'despachador' ? despachadorCanvasRef.current : choferCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const x = 'touches' in e ? e.touches[0].clientX - rect.left : e.clientX - rect.left;
    const y = 'touches' in e ? e.touches[0].clientY - rect.top : e.clientY - rect.top;

    ctx.lineTo(x, y);
    ctx.stroke();
  }

  function stopDrawing(type: 'despachador' | 'chofer') {
    if (type === 'despachador') setIsDrawingDespachador(false);
    else setIsDrawingChofer(false);
  }

  function clearCanvas(type: 'despachador' | 'chofer') {
    const canvas = type === 'despachador' ? despachadorCanvasRef.current : choferCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (type === 'despachador') setHasDespachadorFirma(false);
    else setHasChoferFirma(false);
  }

  async function handleConfirmDispatch() {
    setErrorMsg('');

    const tipo = transportForm.tipoTransporte;
    const isDirecto = tipo === 'DIRECTO' || !tipo;
    const isPaqueteria = tipo === 'PAQUETERIA';
    const isVehiculoPropio = tipo === 'VEHICULO_PROPIO';
    const isClienteRecoge = tipo === 'CLIENTE_RECOGE';

    // 1. Validaciones por Tipo de Transporte (Reglas Generales)
    if (isDirecto) {
      if (!transportForm.vehiculoPlaca.trim()) {
        setErrorMsg('Debes ingresar la placa del vehículo / tracto de transporte.');
        return;
      }
      if (!transportForm.choferNombre.trim()) {
        setErrorMsg('Debes especificar el nombre del chofer o transportista responsable.');
        return;
      }
    } else if (isVehiculoPropio) {
      if (!transportForm.vehiculoPlaca.trim()) {
        setErrorMsg('Debes ingresar la placa de la unidad de Giving Out.');
        return;
      }
      if (!transportForm.choferNombre.trim()) {
        setErrorMsg('Debes especificar el nombre del operador interno asignado.');
        return;
      }
    } else if (isPaqueteria) {
      if (!transportForm.paqueteria.trim()) {
        setErrorMsg('Debes especificar la empresa de paquetería (ej. Castores, DHL, FedEx).');
        return;
      }
      if (!transportForm.numeroGuia.trim()) {
        setErrorMsg('Debes ingresar el número de guía o rastreo de la paquetería.');
        return;
      }
    } else if (isClienteRecoge) {
      if (!transportForm.choferNombre.trim()) {
        setErrorMsg('Debes ingresar el nombre de la persona autorizada que recoge la mercancía.');
        return;
      }
      if (!transportForm.choferLicencia.trim()) {
        setErrorMsg('Debes ingresar la identificación oficial (INE / Licencia) de quien recoge.');
        return;
      }
    }

    // 2. Validación obligatoria de Firmas Digitales
    const despachadorFirma = despachadorCanvasRef.current?.toDataURL('image/png') || '';
    const choferFirma = choferCanvasRef.current?.toDataURL('image/png') || '';

    const despachadorTieneFirma = hasDespachadorFirma || !isCanvasBlank(despachadorCanvasRef.current);
    if (!despachadorTieneFirma) {
      setErrorMsg('Se requiere obligatoriamente la firma digital del despachador responsable de Giving Out.');
      return;
    }

    const requiresReceiverSignature = isDirecto || isVehiculoPropio || isClienteRecoge;
    const choferTieneFirma = hasChoferFirma || !isCanvasBlank(choferCanvasRef.current);
    if (requiresReceiverSignature && !choferTieneFirma) {
      const receptorLabel = isClienteRecoge ? 'de la persona que recoge' : 'del chofer o transportista receptor';
      setErrorMsg(`Se requiere obligatoriamente la firma digital ${receptorLabel}.`);
      return;
    }

    setSubmitting(true);

    try {
      const folioFinal = manifestData?.folio && !manifestData.folio.startsWith('PRE-')
        ? manifestData.folio
        : `MAN-${manifestData?.order?.codigo}`;

      const res = await fetch(`${API}/orders/${orderId}/dispatch`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          despachador: currentUser,
          vehiculoPlaca: transportForm.vehiculoPlaca,
          tipoTransporte: transportForm.tipoTransporte,
          paqueteria: transportForm.paqueteria,
          numeroGuia: transportForm.numeroGuia,
          fletera: transportForm.fletera,
          choferNombre: transportForm.choferNombre,
          choferLicencia: transportForm.choferLicencia,
          selloSeguridad: transportForm.selloSeguridad,
          notas: transportForm.notas,
          firmaDespachador: despachadorFirma,
          firmaChofer: choferFirma,
          folioManifiesto: folioFinal,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Error al procesar el despacho');
      }

      setSuccessMsg('Salida de almacén y despacho confirmados exitosamente. El inventario físico ha sido descontado y las ubicaciones liberadas.');
      if (onSuccess) onSuccess();
      await loadManifest();
    } catch (err: any) {
      setErrorMsg(err.message || 'Ocurrió un error al procesar el despacho');
    }
    setSubmitting(false);
  }

  function handlePrint() {
    window.print();
  }

  const order = manifestData?.order;
  const isAlreadyDispatched = order?.estado === 'DESPACHADO' || order?.estado === 'ENTREGADO';

  // Dynamic validation for enterprise preparation status
  const tipo = transportForm.tipoTransporte;
  const isDirecto = tipo === 'DIRECTO' || !tipo;
  const isPaqueteria = tipo === 'PAQUETERIA';
  const isVehiculoPropio = tipo === 'VEHICULO_PROPIO';
  const isClienteRecoge = tipo === 'CLIENTE_RECOGE';

  const isTransportDataValid = Boolean(
    (isDirecto && transportForm.vehiculoPlaca.trim() && transportForm.choferNombre.trim()) ||
    (isVehiculoPropio && transportForm.vehiculoPlaca.trim() && transportForm.choferNombre.trim()) ||
    (isPaqueteria && transportForm.paqueteria.trim() && transportForm.numeroGuia.trim()) ||
    (isClienteRecoge && transportForm.choferNombre.trim() && transportForm.choferLicencia.trim())
  );

  const requiresReceiverSignature = isDirecto || isVehiculoPropio || isClienteRecoge;
  const areSignaturesComplete = hasDespachadorFirma && (!requiresReceiverSignature || hasChoferFirma);
  const isReadyToDispatch = isTransportDataValid && areSignaturesComplete;

  const pendingItems: string[] = [];
  if (!isAlreadyDispatched && !isReadyToDispatch) {
    if (isDirecto) {
      if (!transportForm.vehiculoPlaca.trim()) pendingItems.push('Placa del vehículo');
      if (!transportForm.choferNombre.trim()) pendingItems.push('Nombre del chofer');
    } else if (isVehiculoPropio) {
      if (!transportForm.vehiculoPlaca.trim()) pendingItems.push('Placa de unidad');
      if (!transportForm.choferNombre.trim()) pendingItems.push('Operador asignado');
    } else if (isPaqueteria) {
      if (!transportForm.paqueteria.trim()) pendingItems.push('Empresa paquetería');
      if (!transportForm.numeroGuia.trim()) pendingItems.push('Número de guía');
    } else if (isClienteRecoge) {
      if (!transportForm.choferNombre.trim()) pendingItems.push('Nombre de quien recoge');
      if (!transportForm.choferLicencia.trim()) pendingItems.push('Identificación oficial');
    }
    if (!hasDespachadorFirma) pendingItems.push('Firma digital despachador');
    if (requiresReceiverSignature && !hasChoferFirma) {
      pendingItems.push(isClienteRecoge ? 'Firma de quien recibe' : 'Firma de transportista receptor');
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 1200 }}>
      <style>{`
        @media print {
          body * {
            visibility: hidden !important;
          }
          #printable-dispatch-manifest, #printable-dispatch-manifest * {
            visibility: visible !important;
          }
          #printable-dispatch-manifest {
            position: fixed !important;
            left: 0 !important;
            top: 0 !important;
            width: 100vw !important;
            height: auto !important;
            background: #ffffff !important;
            color: #000000 !important;
            padding: 20px !important;
            box-shadow: none !important;
            border: none !important;
            overflow: visible !important;
          }
          .modal-overlay {
            position: static !important;
            background: transparent !important;
          }
          .no-print {
            display: none !important;
          }
          .print-avoid-break {
            break-inside: avoid !important;
            page-break-inside: avoid !important;
          }
          #printable-dispatch-manifest table {
            width: 100% !important;
            border-collapse: collapse !important;
          }
          #printable-dispatch-manifest th, #printable-dispatch-manifest td {
            border: 1px solid #cbd5e1 !important;
          }
          .draft-watermark-overlay {
            display: block !important;
            position: fixed !important;
            top: 35% !important;
            left: 5% !important;
            right: 5% !important;
            text-align: center !important;
            font-size: 32px !important;
            font-weight: 800 !important;
            color: rgba(146, 64, 14, 0.14) !important;
            transform: rotate(-20deg) !important;
            pointer-events: none !important;
            z-index: 99999 !important;
            text-transform: uppercase !important;
            letter-spacing: 3px !important;
            border: 3px solid rgba(146, 64, 14, 0.18) !important;
            padding: 20px 12px !important;
            font-family: inherit !important;
          }
        }
      `}</style>
      <div
        id="printable-dispatch-manifest"
        className="modal-content animate-fade-in"
        onClick={e => e.stopPropagation()}
        style={{ maxWidth: 880, maxHeight: '90vh', overflowY: 'auto' }}
      >
        {/* Banner de Borrador para Impresión y Pantalla */}
        {!isAlreadyDispatched && (
          <>
            <div className="draft-watermark-overlay" style={{ display: 'none' }}>
              DOCUMENTO PRELIMINAR · SIN SALIDA CONFIRMADA
            </div>
            <div style={{
              border: '1px solid rgba(245, 158, 11, 0.35)',
              background: '#fffbeb',
              color: '#92400e',
              padding: '10px 14px',
              borderRadius: 8,
              marginBottom: 16,
              display: 'flex',
              alignItems: 'center',
              gap: 12,
            }}>
              <ShieldAlert size={22} color="#d97706" style={{ flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 800, fontSize: 12, letterSpacing: 0.5, color: '#92400e' }}>
                    DOCUMENTO PRELIMINAR DE PREPARACIÓN EN STAGING · NO CONSTITUYE ACUSE OFICIAL DE SALIDA FÍSICA
                  </span>
                  <span className="badge badge-amber" style={{ fontSize: 10, padding: '1px 6px', fontWeight: 700 }}>
                    PRELIMINAR
                  </span>
                </div>
                <div style={{ fontSize: 11, fontWeight: 500, marginTop: 3, color: '#b45309' }}>
                  Este documento preliminar refleja {manifestData?.totalHus || manifestData?.totalCajas || 1} {Number(manifestData?.totalHus || manifestData?.totalCajas || 1) === 1 ? 'HU / caja' : 'HUs / cajas'} ({manifestData?.totalPiezas || manifestData?.totalUnidades || 0} piezas) consolidada(s) en Staging. El acuse oficial de embarque se emitirá tras confirmar transportista, placas y firmas de salida.
                </div>
              </div>
            </div>
          </>
        )}

        {/* Modal Header */}
        <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              padding: 8,
              borderRadius: 8,
              background: isAlreadyDispatched ? 'rgba(16,185,129,0.15)' : 'rgba(245,158,11,0.15)',
              color: isAlreadyDispatched ? 'var(--emerald)' : 'var(--amber)',
            }}>
              <FileText size={22} />
            </div>
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                {isAlreadyDispatched ? 'Manifiesto de Embarque y Acuse de Salida' : 'Manifiesto Preliminar de Embarque'}
              </h2>
              <p style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: '3px 0 0 0' }}>
                {isAlreadyDispatched ? (
                  <>Folio Oficial: <strong style={{ color: 'var(--emerald)' }}>{manifestData?.folio || order?.folioManifiesto || `MAN-${order?.codigo}`}</strong> · Pedido: {order?.codigo}</>
                ) : (
                  <>Preparación de salida · Folio Preliminar: <strong style={{ color: 'var(--amber)' }}>{manifestData?.folio || `PRE-${order?.codigo}`}</strong> · Pedido: {order?.codigo}</>
                )}
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {isAlreadyDispatched ? (
              <button className="btn btn-secondary btn-sm" onClick={handlePrint} title="Imprimir Manifiesto Oficial de Salida">
                <Printer size={15} /> Imprimir Acuse Oficial / PDF
              </button>
            ) : (
              <button className="btn btn-secondary btn-sm" onClick={handlePrint} title="Imprime un borrador preliminar de preparación con marca de agua">
                <Printer size={15} /> Imprimir borrador
              </button>
            )}
            <button className="btn btn-ghost btn-sm" onClick={onClose}>
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="modal-body" style={{ padding: 20 }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 50, color: 'var(--text-tertiary)' }}>
              Cargando información del manifiesto...
            </div>
          ) : (
            <>
              {errorMsg && (
                <div style={{
                  padding: '12px 16px',
                  borderRadius: 8,
                  background: 'rgba(239,68,68,0.1)',
                  border: '1px solid var(--error)',
                  color: 'var(--error)',
                  marginBottom: 16,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  fontSize: 13,
                  fontWeight: 600,
                }}>
                  <AlertTriangle size={18} />
                  <span>{errorMsg}</span>
                </div>
              )}

              {successMsg && (
                <div style={{
                  padding: '12px 16px',
                  borderRadius: 8,
                  background: 'rgba(16,185,129,0.1)',
                  border: '1px solid var(--emerald)',
                  color: 'var(--emerald)',
                  marginBottom: 16,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  fontSize: 13,
                  fontWeight: 600,
                }}>
                  <CheckCircle2 size={18} />
                  <span>{successMsg}</span>
                </div>
              )}

              {/* Status Banner */}
              <div style={{
                padding: '12px 16px',
                borderRadius: 10,
                background: isAlreadyDispatched
                  ? 'rgba(16,185,129,0.1)'
                  : isReadyToDispatch
                  ? 'rgba(16,185,129,0.08)'
                  : 'rgba(245,158,11,0.08)',
                border: `1px solid ${
                  isAlreadyDispatched
                    ? 'var(--emerald)'
                    : isReadyToDispatch
                    ? 'var(--emerald)'
                    : 'rgba(245,158,11,0.35)'
                }`,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 20,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  {isAlreadyDispatched ? (
                    <ShieldCheck size={22} color="var(--emerald)" />
                  ) : isReadyToDispatch ? (
                    <CheckCircle2 size={22} color="var(--emerald)" />
                  ) : (
                    <Clock size={22} color="var(--amber)" />
                  )}
                  <div>
                    <div style={{
                      fontSize: 13,
                      fontWeight: 700,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                    }}>
                      {isAlreadyDispatched ? (
                        <span style={{ color: 'var(--emerald)' }}>Despacho Oficial Confirmado — En Ruta</span>
                      ) : isReadyToDispatch ? (
                        <>
                          <span style={{ color: 'var(--emerald)' }}>Listo para confirmar salida física</span>
                          <span
                            className="badge badge-success"
                            style={{ fontSize: 10, padding: '2px 7px', fontWeight: 700 }}
                          >
                            VALIDADO
                          </span>
                        </>
                      ) : (
                        <>
                          <span style={{ color: 'var(--amber)' }}>Consolidado en Staging</span>
                          <span
                            className="badge badge-amber"
                            style={{ fontSize: 10, padding: '2px 7px', fontWeight: 700 }}
                          >
                            PENDIENTE
                          </span>
                        </>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                      {isAlreadyDispatched
                        ? `Salida física completada${order?.fechaDespacho ? ` el ${formatCalendarDate(order.fechaDespacho)}` : ''} · Despachador: ${order?.despachador || currentUser} · Total: ${manifestData?.totalHus || manifestData?.totalCajas || 1} ${Number(manifestData?.totalHus || manifestData?.totalCajas || 1) === 1 ? 'HU / caja' : 'HUs / cajas'} (${manifestData?.totalPiezas || manifestData?.totalUnidades || 0} piezas) en ${order?.lineas?.length || 0} líneas`
                        : isReadyToDispatch
                        ? `Datos de transporte y firmas capturados. Autorizado para salida física y confirmación de despacho · ${manifestData?.totalHus || manifestData?.totalCajas || 1} ${Number(manifestData?.totalHus || manifestData?.totalCajas || 1) === 1 ? 'HU / caja' : 'HUs / cajas'} (${manifestData?.totalPiezas || manifestData?.totalUnidades || 0} piezas).`
                        : `Pendiente de datos de transporte y autorización de salida. Mercancía consolidada en Staging: ${manifestData?.totalHus || manifestData?.totalCajas || 1} ${Number(manifestData?.totalHus || manifestData?.totalCajas || 1) === 1 ? 'HU / caja' : 'HUs / cajas'} (${manifestData?.totalPiezas || manifestData?.totalUnidades || 0} piezas).`}
                    </div>
                    {pendingItems.length > 0 && (
                      <div style={{ fontSize: 11, color: 'var(--amber)', marginTop: 4, fontWeight: 600 }}>
                        Requisitos pendientes: {pendingItems.join(' · ')}
                      </div>
                    )}
                  </div>
                </div>
                {order?.selloSeguridad && (
                  <div style={{ textAlign: 'right', fontSize: 11 }}>
                    <span style={{ color: 'var(--text-tertiary)' }}>Candado / Sello:</span>{' '}
                    <strong style={{ fontFamily: 'monospace', color: 'var(--text-primary)' }}>{order.selloSeguridad}</strong>
                  </div>
                )}
              </div>

              {/* Operational Header Grid: Depositante vs Cliente Final */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
                {/* Depositante 3PL */}
                <div className="card" style={{ padding: 14, background: 'var(--bg-secondary)' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Package size={13} /> Depositante (Cliente 3PL)
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' }}>
                    {order?.cliente?.nombreComercial}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                    RFC: {order?.cliente?.rfc || 'No registrado'}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>
                    {order?.cliente?.ciudad}, {order?.cliente?.estado}
                  </div>
                </div>

                {/* Cliente Final / Ship-To */}
                <div className="card" style={{ padding: 14, background: 'var(--bg-secondary)' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Store size={13} /> Destino Final (Ship-To)
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' }}>
                    {order?.endCustomer?.nombre || 'Entrega Directa'}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <MapPin size={12} /> {order?.endCustomer?.calle || 'Dirección registrada en orden'}, {order?.endCustomer?.ciudad || ''}
                  </div>
                  {order?.fechaCompromiso && (
                    <div style={{ fontSize: 11, color: 'var(--primary)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Calendar size={12} /> Cita: {formatCalendarDate(order.fechaCompromiso)} {order.horaCompromiso ? `· ${order.horaCompromiso} hrs` : ''}
                    </div>
                  )}
                </div>
              </div>

              {/* Transport Data Form */}
              <div style={{
                background: 'var(--bg-secondary)',
                borderRadius: 10,
                padding: 16,
                marginBottom: 20,
                border: '1px solid var(--border)',
              }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-primary)' }}>
                  <Truck size={16} color="var(--primary)" />
                  Datos de la Unidad y Transportista Responsable
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
                      Tipo de Transporte {!isAlreadyDispatched && <span style={{ color: 'var(--amber)', fontWeight: 700 }}>*</span>}
                    </label>
                    {isAlreadyDispatched ? (
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{transportForm.tipoTransporte}</div>
                    ) : (
                      <select
                        className="form-select form-select-full"
                        value={transportForm.tipoTransporte}
                        onChange={e => setTransportForm(f => ({ ...f, tipoTransporte: e.target.value }))}
                      >
                        <option value="DIRECTO">Transporte Directo / Fletera</option>
                        <option value="PAQUETERIA">Paquetería Consolidada</option>
                        <option value="VEHICULO_PROPIO">Vehículo Propio Giving Out</option>
                        <option value="CLIENTE_RECOGE">Cliente Recoge en Andén</option>
                      </select>
                    )}
                  </div>

                  {transportForm.tipoTransporte === 'PAQUETERIA' ? (
                    <>
                      <div>
                        <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
                          Empresa de Paquetería {!isAlreadyDispatched && <span style={{ color: 'var(--amber)', fontWeight: 700 }}>*</span>}
                        </label>
                        {isAlreadyDispatched ? (
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{transportForm.paqueteria || 'N/A'}</div>
                        ) : (
                          <input
                            type="text"
                            className="form-input"
                            placeholder="Ej. DHL, FedEx, Castores, Tresguerras..."
                            value={transportForm.paqueteria}
                            onChange={e => setTransportForm(f => ({ ...f, paqueteria: e.target.value }))}
                          />
                        )}
                      </div>

                      <div>
                        <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
                          Número de Guía / Rastreo {!isAlreadyDispatched && <span style={{ color: 'var(--amber)', fontWeight: 700 }}>*</span>}
                        </label>
                        {isAlreadyDispatched ? (
                          <div style={{ fontWeight: 600, fontSize: 13, fontFamily: 'monospace' }}>{transportForm.numeroGuia || 'N/A'}</div>
                        ) : (
                          <input
                            type="text"
                            className="form-input"
                            placeholder="Código de rastreo o guía"
                            value={transportForm.numeroGuia}
                            onChange={e => setTransportForm(f => ({ ...f, numeroGuia: e.target.value }))}
                          />
                        )}
                      </div>
                    </>
                  ) : (
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
                        {transportForm.tipoTransporte === 'CLIENTE_RECOGE' ? 'Empresa / Cliente que Retira' : 'Empresa Fletera / Transporte'}
                      </label>
                      {isAlreadyDispatched ? (
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{transportForm.fletera}</div>
                      ) : (
                        <input
                          type="text"
                          className="form-input"
                          placeholder="Ej. Transportes Especializados..."
                          value={transportForm.fletera}
                          onChange={e => setTransportForm(f => ({ ...f, fletera: e.target.value }))}
                        />
                      )}
                    </div>
                  )}

                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
                      {transportForm.tipoTransporte === 'CLIENTE_RECOGE'
                        ? 'Nombre de Quien Recoge'
                        : transportForm.tipoTransporte === 'VEHICULO_PROPIO'
                        ? 'Operador Asignado'
                        : 'Nombre del Chofer / Operador'} {!isAlreadyDispatched && transportForm.tipoTransporte !== 'PAQUETERIA' && <span style={{ color: 'var(--amber)', fontWeight: 700 }}>*</span>}
                    </label>
                    {isAlreadyDispatched ? (
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{transportForm.choferNombre || 'N/A'}</div>
                    ) : (
                      <input
                        type="text"
                        className="form-input"
                        placeholder="Nombre completo"
                        value={transportForm.choferNombre}
                        onChange={e => setTransportForm(f => ({ ...f, choferNombre: e.target.value }))}
                      />
                    )}
                  </div>

                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
                      Placa del Vehículo / Tracto {!isAlreadyDispatched && (transportForm.tipoTransporte === 'DIRECTO' || transportForm.tipoTransporte === 'VEHICULO_PROPIO') && <span style={{ color: 'var(--amber)', fontWeight: 700 }}>*</span>}
                    </label>
                    {isAlreadyDispatched ? (
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{transportForm.vehiculoPlaca || 'N/A'}</div>
                    ) : (
                      <input
                        type="text"
                        className="form-input"
                        placeholder="Ej. 45-AF-8K"
                        value={transportForm.vehiculoPlaca}
                        onChange={e => setTransportForm(f => ({ ...f, vehiculoPlaca: e.target.value }))}
                      />
                    )}
                  </div>

                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
                      {transportForm.tipoTransporte === 'CLIENTE_RECOGE'
                        ? 'Identificación Oficial (INE / Licencia)'
                        : 'Licencia / Identificación (Opcional)'} {!isAlreadyDispatched && transportForm.tipoTransporte === 'CLIENTE_RECOGE' && <span style={{ color: 'var(--amber)', fontWeight: 700 }}>*</span>}
                    </label>
                    {isAlreadyDispatched ? (
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{transportForm.choferLicencia || 'N/A'}</div>
                    ) : (
                      <input
                        type="text"
                        className="form-input"
                        placeholder="No. Licencia Federal o INE"
                        value={transportForm.choferLicencia}
                        onChange={e => setTransportForm(f => ({ ...f, choferLicencia: e.target.value }))}
                      />
                    )}
                  </div>

                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
                      Sello / Candado de Seguridad
                    </label>
                    {isAlreadyDispatched ? (
                      <div style={{ fontWeight: 600, fontSize: 13, fontFamily: 'monospace' }}>{transportForm.selloSeguridad || 'N/A'}</div>
                    ) : (
                      <input
                        type="text"
                        className="form-input"
                        placeholder="Código de precinto"
                        value={transportForm.selloSeguridad}
                        onChange={e => setTransportForm(f => ({ ...f, selloSeguridad: e.target.value }))}
                      />
                    )}
                  </div>
                </div>
              </div>

              {/* Items / Desglose de Mercancía */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Layers size={15} color="var(--primary)" />
                    {isAlreadyDispatched
                      ? 'Desglose Oficial: Mercancía, Lotes y Cajas (HUs) Despachadas'
                      : 'Desglose Operativo: Mercancía y HUs Preparadas para Despacho'}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    Total: <strong style={{ color: 'var(--primary)' }}>{manifestData?.totalHus || manifestData?.totalCajas || 1}</strong> {Number(manifestData?.totalHus || manifestData?.totalCajas || 1) === 1 ? 'HU / caja' : 'HUs / cajas'} · <strong style={{ color: 'var(--emerald)' }}>{manifestData?.totalPiezas || manifestData?.totalUnidades || 0}</strong> piezas
                  </span>
                </div>

                <div style={{ borderRadius: 8, overflowX: 'auto', border: '1px solid var(--border)', background: 'var(--bg-primary)' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}>
                        <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>SKU</th>
                        <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>Descripción</th>
                        <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>Lote</th>
                        <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>Caja / HU</th>
                        <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>Rack Origen</th>
                        <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>Staging / Salida</th>
                        <th style={{ padding: '10px 12px', textAlign: 'right', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
                          {isAlreadyDispatched ? 'CANT. DESPACHADA' : 'CANT. PREPARADA'}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {manifestData?.lineasDesglose?.map((l: any, idx: number) => (
                        <tr key={idx} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ padding: '10px 12px' }}>
                            <code style={{ fontSize: 11, fontWeight: 700, color: 'var(--primary)' }}>{l.sku}</code>
                          </td>
                          <td style={{ padding: '10px 12px', maxWidth: 180, whiteSpace: 'normal', fontSize: 12 }}>
                            {l.descripcion}
                          </td>
                          <td style={{ padding: '10px 12px' }}>
                            <span className="badge badge-default" style={{ fontSize: 11, fontWeight: 600 }}>
                              {l.lote}
                            </span>
                            {l.caducidad && (
                              <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2 }}>
                                Vence: {formatCalendarDate(l.caducidad)}
                              </div>
                            )}
                          </td>
                          <td style={{ padding: '10px 12px' }}>
                            <code style={{ fontSize: 11, background: 'var(--bg-secondary)', padding: '2px 5px', borderRadius: 4, color: 'var(--text-primary)' }}>
                              {l.huCodigo || (Array.isArray(l.cajasEscaneadas) && l.cajasEscaneadas.length > 0 ? l.cajasEscaneadas.join(', ') : 'S/N')}
                            </code>
                          </td>
                          <td style={{ padding: '10px 12px' }}>
                            <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-secondary)' }}>
                              {l.rackOrigen || l.ubicacion || 'RACK'}
                            </span>
                          </td>
                          <td style={{ padding: '10px 12px' }}>
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'monospace', fontSize: 11 }}>
                              <span style={{ color: 'var(--text-secondary)' }}>{l.rackOrigen || l.ubicacion || 'RACK'}</span>
                              <ArrowRight size={13} color="var(--primary)" style={{ flexShrink: 0 }} />
                              <span className="badge badge-cyan" style={{ fontSize: 11, fontWeight: 700, padding: '2px 6px' }}>
                                {l.stagingUbicacion || l.stagingLocationCodigo || 'STG-01'}
                              </span>
                            </div>
                          </td>
                          <td
                            style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, color: 'var(--emerald)', whiteSpace: 'nowrap' }}
                            title={isAlreadyDispatched ? `Cantidad despachada: ${l.cantidadDespachada} ${l.uom || 'PZA'}` : `Cantidad preparada en Staging: ${l.cantidadPreparada ?? l.cantidadDespachada} ${l.uom || 'PZA'}`}
                          >
                            {isAlreadyDispatched ? l.cantidadDespachada : (l.cantidadPreparada ?? l.cantidadDespachada)} {l.uom || 'PZA'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Signatures Section (Canvas) */}
              <div style={{
                background: 'var(--bg-secondary)',
                borderRadius: 10,
                padding: 16,
                border: '1px solid var(--border)',
                marginBottom: 16,
              }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Edit3 size={15} color="var(--primary)" />
                  Firmas Digitales de Conformidad y Responsabilidad de Transporte
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  {/* Firma Despachador */}
                  <div style={{ background: 'var(--bg-primary)', padding: 12, borderRadius: 8, border: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>
                        Entrega: Despachador Giving Out {!isAlreadyDispatched && <span style={{ color: 'var(--amber)', fontWeight: 700 }}>* Requerido</span>}
                      </span>
                      {!isAlreadyDispatched && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          style={{ fontSize: 10, padding: '2px 6px', height: 20 }}
                          onClick={() => clearCanvas('despachador')}
                        >
                          Limpiar
                        </button>
                      )}
                    </div>
                    {isAlreadyDispatched && order?.firmaDespachador ? (
                      <div style={{ height: 90, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <img src={order.firmaDespachador} alt="Firma Despachador" style={{ maxHeight: 80, maxWidth: '100%' }} />
                      </div>
                    ) : (
                      <canvas
                        ref={despachadorCanvasRef}
                        width={360}
                        height={90}
                        onMouseDown={e => startDrawing('despachador', e)}
                        onMouseMove={e => draw('despachador', e)}
                        onMouseUp={() => stopDrawing('despachador')}
                        onMouseLeave={() => stopDrawing('despachador')}
                        onTouchStart={e => startDrawing('despachador', e)}
                        onTouchMove={e => draw('despachador', e)}
                        onTouchEnd={() => stopDrawing('despachador')}
                        style={{
                          width: '100%',
                          height: 90,
                          background: '#ffffff',
                          borderRadius: 6,
                          border: '1px dashed var(--border)',
                          cursor: 'crosshair',
                        }}
                      />
                    )}
                    <div style={{ fontSize: 11, color: 'var(--text-tertiary)', textAlign: 'center', marginTop: 4 }}>
                      {order?.despachador || currentUser}
                    </div>
                  </div>

                  {/* Firma Chofer / Receptor */}
                  <div style={{ background: 'var(--bg-primary)', padding: 12, borderRadius: 8, border: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>
                        {transportForm.tipoTransporte === 'CLIENTE_RECOGE'
                          ? 'Recibe: Cliente / Receptor Autorizado'
                          : 'Recibe: Chofer / Fletera'} {!isAlreadyDispatched && transportForm.tipoTransporte !== 'PAQUETERIA' && <span style={{ color: 'var(--amber)', fontWeight: 700 }}>* Requerido</span>}
                      </span>
                      {!isAlreadyDispatched && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          style={{ fontSize: 10, padding: '2px 6px', height: 20 }}
                          onClick={() => clearCanvas('chofer')}
                        >
                          Limpiar
                        </button>
                      )}
                    </div>
                    {isAlreadyDispatched && order?.firmaChofer ? (
                      <div style={{ height: 90, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <img src={order.firmaChofer} alt="Firma Chofer" style={{ maxHeight: 80, maxWidth: '100%' }} />
                      </div>
                    ) : (
                      <canvas
                        ref={choferCanvasRef}
                        width={360}
                        height={90}
                        onMouseDown={e => startDrawing('chofer', e)}
                        onMouseMove={e => draw('chofer', e)}
                        onMouseUp={() => stopDrawing('chofer')}
                        onMouseLeave={() => stopDrawing('chofer')}
                        onTouchStart={e => startDrawing('chofer', e)}
                        onTouchMove={e => draw('chofer', e)}
                        onTouchEnd={() => stopDrawing('chofer')}
                        style={{
                          width: '100%',
                          height: 90,
                          background: '#ffffff',
                          borderRadius: 6,
                          border: '1px dashed var(--border)',
                          cursor: 'crosshair',
                        }}
                      />
                    )}
                    <div style={{ fontSize: 11, color: 'var(--text-tertiary)', textAlign: 'center', marginTop: 4 }}>
                      {transportForm.choferNombre || (transportForm.tipoTransporte === 'CLIENTE_RECOGE' ? 'Firma de persona autorizada' : 'Firma de transportista receptor')}
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Modal Footer */}
        <div className="modal-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border)' }}>
          <button className="btn btn-ghost" onClick={onClose}>
            Cerrar
          </button>
          {!isAlreadyDispatched && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {!isReadyToDispatch && (
                <span style={{ fontSize: 11, color: 'var(--amber)', display: 'flex', alignItems: 'center', gap: 5, fontWeight: 600 }}>
                  <Clock size={13} /> Requisitos pendientes para salida física
                </span>
              )}
              <button
                className="btn btn-primary"
                disabled={submitting || loading || !isReadyToDispatch}
                onClick={handleConfirmDispatch}
                title={!isReadyToDispatch ? 'Completa los datos obligatorios de transporte y firmas para habilitar el despacho' : 'Confirmar Salida Física y Despacho'}
                style={{
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  opacity: !isReadyToDispatch ? 0.45 : 1,
                  cursor: !isReadyToDispatch ? 'not-allowed' : 'pointer',
                }}
              >
                <Send size={16} />
                {submitting ? 'Procesando Salida Física...' : 'Confirmar Salida Física y Despacho'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
