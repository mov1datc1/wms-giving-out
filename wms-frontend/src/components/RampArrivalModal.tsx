import React, { useState, useEffect, useRef } from 'react';
import {
  Truck, X, Check, AlertTriangle, ShieldCheck, FileText,
  Clock, RotateCcw, AlertCircle, CheckCircle2, UserCheck,
  Calendar, Layers, Save, Printer, History, PenTool
} from 'lucide-react';
import { API } from '../config/api';

interface RampArrivalModalProps {
  receipt: any;
  token?: string;
  currentUser?: { nombre?: string; rolNombre?: string | null; name?: string; role?: string } | any;
  onClose: () => void;
  onSuccess: (updatedReceipt?: any) => void;
  onViewDocument: (receipt: any) => void;
}

export function RampArrivalModal({
  receipt,
  token,
  currentUser,
  onClose,
  onSuccess,
  onViewDocument
}: RampArrivalModalProps) {
  // Estado local reactivo de la recepción activa
  const [activeReceipt, setActiveReceipt] = useState<any>(receipt);

  // Datos de Transporte
  const [lineaTransporte, setLineaTransporte] = useState(receipt?.lineaTransporte || '');
  const [capacidadCarga, setCapacidadCarga] = useState(receipt?.capacidadCarga || '');
  const [placa, setPlaca] = useState(receipt?.placa || '');
  const [nombreChofer, setNombreChofer] = useState(receipt?.nombreChofer || '');
  const [andenAsignado, setAndenAsignado] = useState(receipt?.andenAsignado || '');
  const [nombreReceptor, setNombreReceptor] = useState(
    receipt?.nombreReceptor || currentUser?.nombre || currentUser?.name || 'Jonathan Palacios'
  );

  // Conteo exterior de bultos
  // Calcular bultos sugeridos de las líneas si no están definidos
  const totalBultosLineas = Array.isArray(receipt?.lineas)
    ? receipt.lineas.reduce((acc: number, l: any) => {
        const packSize = l.sku?.capacidadEmpaque || 1;
        const bultos = Math.ceil((l.cantidadEsperada || 0) / packSize);
        return acc + (bultos || 0);
      }, 0)
    : 0;

  // Permitir strings vacías ('') durante edición para evitar el molesto 01, 02
  const [bultosDeclarados, setBultosDeclarados] = useState<number | string>(
    receipt?.bultosDeclarados !== undefined && receipt?.bultosDeclarados !== null
      ? receipt.bultosDeclarados
      : (totalBultosLineas > 0 ? totalBultosLineas : 0)
  );
  const [bultosRecibidos, setBultosRecibidos] = useState<number | string>(
    receipt?.bultosRecibidos !== undefined && receipt?.bultosRecibidos !== null
      ? receipt.bultosRecibidos
      : (receipt?.bultosDeclarados !== undefined && receipt?.bultosDeclarados !== null
          ? receipt.bultosDeclarados
          : (totalBultosLineas > 0 ? totalBultosLineas : 0))
  );
  const [bultosDanados, setBultosDanados] = useState<number | string>(
    receipt?.bultosDanados !== undefined && receipt?.bultosDanados !== null ? receipt.bultosDanados : 0
  );
  const [observacionesRampa, setObservacionesRampa] = useState(receipt?.observacionesRampa || '');

  // Firmas digitales
  const [firmaChofer, setFirmaChofer] = useState<string>(receipt?.firmaChofer || '');
  const [firmaReceptor, setFirmaReceptor] = useState<string>(receipt?.firmaReceptor || '');
  const [choferPadActive, setChoferPadActive] = useState<boolean>(!receipt?.firmaChofer);
  const [receptorPadActive, setReceptorPadActive] = useState<boolean>(!receipt?.firmaReceptor);

  // Auditoría y modo corrección posterior
  const isLiberated = Boolean(activeReceipt?.fechaLiberacionChofer);
  const [motivoCorreccion, setMotivoCorreccion] = useState<string>('');
  const [showHistory, setShowHistory] = useState<boolean>(false);

  // Estados UI
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Refs de Canvas para firmas
  const choferCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const receptorCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawingChofer = useRef<boolean>(false);
  const isDrawingReceptor = useRef<boolean>(false);

  // Sincronizar si receipt prop se actualiza externamente
  useEffect(() => {
    if (receipt) {
      setActiveReceipt(receipt);
      setLineaTransporte(receipt.lineaTransporte || '');
      setCapacidadCarga(receipt.capacidadCarga || '');
      setPlaca(receipt.placa || '');
      setNombreChofer(receipt.nombreChofer || '');
      setAndenAsignado(receipt.andenAsignado || '');
      setNombreReceptor(receipt.nombreReceptor || currentUser?.nombre || currentUser?.name || 'Jonathan Palacios');
      if (receipt.bultosDeclarados !== undefined && receipt.bultosDeclarados !== null) {
        setBultosDeclarados(receipt.bultosDeclarados);
      }
      if (receipt.bultosRecibidos !== undefined && receipt.bultosRecibidos !== null) {
        setBultosRecibidos(receipt.bultosRecibidos);
      }
      if (receipt.bultosDanados !== undefined && receipt.bultosDanados !== null) {
        setBultosDanados(receipt.bultosDanados);
      }
      if (receipt.observacionesRampa) setObservacionesRampa(receipt.observacionesRampa);
      if (receipt.firmaChofer) {
        setFirmaChofer(receipt.firmaChofer);
        setChoferPadActive(false);
      }
      if (receipt.firmaReceptor) {
        setFirmaReceptor(receipt.firmaReceptor);
        setReceptorPadActive(false);
      }
    }
  }, [receipt]);

  // Valores numéricos seguros para cálculos y validaciones
  const numDeclarados = bultosDeclarados === '' ? 0 : Number(bultosDeclarados);
  const numRecibidos = bultosRecibidos === '' ? 0 : Number(bultosRecibidos);
  const numDanados = bultosDanados === '' ? 0 : Number(bultosDanados);

  // Diferencia calculada: recibidos - declarados (fórmula exacta)
  const diferenciaBultos = numRecibidos - numDeclarados;
  const tieneDiscrepancias = diferenciaBultos !== 0 || numDanados > 0;

  // Leyenda dinámica del chofer
  const leyendaChofer = tieneDiscrepancias
    ? 'Entregó con reservas y discrepancias asentadas'
    : 'Entregó carga conforme (revisión exterior)';

  // Handler para campos de bultos que permite vaciar mientras se escribe
  const handleBultosChange = (setter: React.Dispatch<React.SetStateAction<number | string>>) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    if (raw === '') {
      setter('');
      return;
    }
    const digitsOnly = raw.replace(/\D/g, '');
    if (digitsOnly === '') {
      setter('');
      return;
    }
    const parsed = parseInt(digitsOnly, 10);
    setter(isNaN(parsed) ? '' : parsed);
  };

  // Inicializar handlers de canvas para chofer
  useEffect(() => {
    const canvas = choferCanvasRef.current;
    if (!canvas || !choferPadActive) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.strokeStyle = '#0F172A';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const getPos = (e: MouseEvent | TouchEvent) => {
      const rect = canvas.getBoundingClientRect();
      const clientX = 'touches' in e ? e.touches[0].clientX : (e as MouseEvent).clientX;
      const clientY = 'touches' in e ? e.touches[0].clientY : (e as MouseEvent).clientY;
      return {
        x: clientX - rect.left,
        y: clientY - rect.top
      };
    };

    const startDraw = (e: MouseEvent | TouchEvent) => {
      e.preventDefault();
      isDrawingChofer.current = true;
      const pos = getPos(e);
      ctx.beginPath();
      ctx.moveTo(pos.x, pos.y);
    };

    const draw = (e: MouseEvent | TouchEvent) => {
      if (!isDrawingChofer.current) return;
      e.preventDefault();
      const pos = getPos(e);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
    };

    const endDraw = () => {
      if (!isDrawingChofer.current) return;
      isDrawingChofer.current = false;
      setFirmaChofer(canvas.toDataURL());
    };

    canvas.addEventListener('mousedown', startDraw);
    canvas.addEventListener('mousemove', draw);
    window.addEventListener('mouseup', endDraw);
    canvas.addEventListener('touchstart', startDraw, { passive: false });
    canvas.addEventListener('touchmove', draw, { passive: false });
    window.addEventListener('touchend', endDraw);

    return () => {
      canvas.removeEventListener('mousedown', startDraw);
      canvas.removeEventListener('mousemove', draw);
      window.removeEventListener('mouseup', endDraw);
      canvas.removeEventListener('touchstart', startDraw);
      canvas.removeEventListener('touchmove', draw);
      window.removeEventListener('touchend', endDraw);
    };
  }, [choferPadActive]);

  // Inicializar handlers de canvas para receptor
  useEffect(() => {
    const canvas = receptorCanvasRef.current;
    if (!canvas || !receptorPadActive) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.strokeStyle = '#0F172A';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const getPos = (e: MouseEvent | TouchEvent) => {
      const rect = canvas.getBoundingClientRect();
      const clientX = 'touches' in e ? e.touches[0].clientX : (e as MouseEvent).clientX;
      const clientY = 'touches' in e ? e.touches[0].clientY : (e as MouseEvent).clientY;
      return {
        x: clientX - rect.left,
        y: clientY - rect.top
      };
    };

    const startDraw = (e: MouseEvent | TouchEvent) => {
      e.preventDefault();
      isDrawingReceptor.current = true;
      const pos = getPos(e);
      ctx.beginPath();
      ctx.moveTo(pos.x, pos.y);
    };

    const draw = (e: MouseEvent | TouchEvent) => {
      if (!isDrawingReceptor.current) return;
      e.preventDefault();
      const pos = getPos(e);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
    };

    const endDraw = () => {
      if (!isDrawingReceptor.current) return;
      isDrawingReceptor.current = false;
      setFirmaReceptor(canvas.toDataURL());
    };

    canvas.addEventListener('mousedown', startDraw);
    canvas.addEventListener('mousemove', draw);
    window.addEventListener('mouseup', endDraw);
    canvas.addEventListener('touchstart', startDraw, { passive: false });
    canvas.addEventListener('touchmove', draw, { passive: false });
    window.addEventListener('touchend', endDraw);

    return () => {
      canvas.removeEventListener('mousedown', startDraw);
      canvas.removeEventListener('mousemove', draw);
      window.removeEventListener('mouseup', endDraw);
      canvas.removeEventListener('touchstart', startDraw);
      canvas.removeEventListener('touchmove', draw);
      window.removeEventListener('touchend', endDraw);
    };
  }, [receptorPadActive]);

  const clearChoferCanvas = () => {
    const canvas = choferCanvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    setFirmaChofer('');
    setChoferPadActive(true);
  };

  const clearReceptorCanvas = () => {
    const canvas = receptorCanvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    setFirmaReceptor('');
    setReceptorPadActive(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    // Validación de enteros no negativos
    if (bultosDeclarados === '' || isNaN(numDeclarados) || numDeclarados < 0 || !Number.isInteger(numDeclarados)) {
      setErrorMsg('Debe especificar los bultos declarados como un número entero mayor o igual a cero.');
      return;
    }
    if (bultosRecibidos === '' || isNaN(numRecibidos) || numRecibidos < 0 || !Number.isInteger(numRecibidos)) {
      setErrorMsg('Debe especificar los bultos recibidos como un número entero mayor o igual a cero.');
      return;
    }
    if (bultosDanados === '' || isNaN(numDanados) || numDanados < 0 || !Number.isInteger(numDanados)) {
      setErrorMsg('Debe especificar los bultos con daño exterior como un número entero mayor o igual a cero.');
      return;
    }

    // Validación crítica: Dañados es subconjunto de recibidos
    if (numDanados > numRecibidos) {
      setErrorMsg(`Inconsistencia en conteo: Los bultos con daño exterior (${numDanados}) no pueden superar los bultos efectivamente recibidos (${numRecibidos}). Los bultos dañados son un subconjunto de los recibidos.`);
      return;
    }

    // Validación obligatoria de unidad de transporte que arriba físicamente a rampa
    if (!lineaTransporte || !lineaTransporte.trim()) {
      setErrorMsg('Debe registrar la línea de transporte de la unidad física que arribó a rampa.');
      return;
    }
    if (!placa || !placa.trim()) {
      setErrorMsg('Debe registrar las placas de la unidad física que arribó a rampa.');
      return;
    }
    if (!nombreChofer || !nombreChofer.trim()) {
      setErrorMsg('Debe registrar el nombre del chofer de la unidad física que arribó a rampa.');
      return;
    }

    // Validación de auditoría si ya estaba firmado y liberado
    if (isLiberated && (!motivoCorreccion || motivoCorreccion.trim().length < 5)) {
      setErrorMsg('Este documento ya fue firmado y liberado previamente. Para aplicar cambios debe justificar un motivo de corrección para el historial de auditoría.');
      return;
    }

    // Validación de firmas al liberar por primera vez
    if (!isLiberated && (!firmaChofer || !firmaReceptor)) {
      setErrorMsg('Debe recabar ambas firmas (Chofer de la unidad y Receptor de andén) para validar el acta de rampa.');
      return;
    }

    setSubmitting(true);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const body = {
        bultosDeclarados: numDeclarados,
        bultosRecibidos: numRecibidos,
        bultosDanados: numDanados,
        lineaTransporte,
        capacidadCarga,
        placa,
        nombreChofer,
        andenAsignado,
        observacionesRampa,
        firmaChofer,
        firmaReceptor,
        nombreReceptor,
        motivoCorreccion: isLiberated ? motivoCorreccion.trim() : undefined,
      };

      const res = await fetch(`${API}/receipts/${activeReceipt.id}/rampa-arribo`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || `Error del servidor (${res.status}): No se pudo registrar el acta de rampa.`);
      }

      // Actualizar estado local inmediatamente con lo guardado
      const updatedRec = data.receipt || {
        ...activeReceipt,
        ...body,
        fechaLiberacionChofer: activeReceipt.fechaLiberacionChofer || new Date().toISOString(),
        historialCorreccionesRampa: JSON.stringify(data.actaRampa?.historial || []),
      };

      setActiveReceipt(updatedRec);
      setSuccessMsg(isLiberated ? '¡Corrección de acta registrada y auditada con éxito!' : '¡Acta de rampa registrada y chofer liberado con éxito!');
      setMotivoCorreccion('');

      // Notificar a la vista principal
      if (typeof onSuccess === 'function') {
        onSuccess(updatedRec);
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        setErrorMsg('El servidor tardó más de 20 segundos en responder. Compruebe la conexión; todos los datos capturados siguen intactos para volver a intentar.');
      } else {
        setErrorMsg(err.message || 'Ocurrió un error al procesar el acta de rampa. Sus datos y firmas se conservan para reintentar.');
      }
    } finally {
      clearTimeout(timeoutId);
      setSubmitting(false);
    }
  };

  let historial: any[] = [];
  if (activeReceipt?.historialCorreccionesRampa) {
    if (Array.isArray(activeReceipt.historialCorreccionesRampa)) {
      historial = activeReceipt.historialCorreccionesRampa;
    } else if (typeof activeReceipt.historialCorreccionesRampa === 'string') {
      try {
        historial = JSON.parse(activeReceipt.historialCorreccionesRampa);
      } catch (e) {
        historial = [];
      }
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.65)',
        backdropFilter: 'blur(4px)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        overflowY: 'auto',
      }}
    >
      <div
        style={{
          backgroundColor: '#FFFFFF',
          borderRadius: 14,
          border: '1px solid #E2E8F0',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
          width: '100%',
          maxWidth: 820,
          maxHeight: '94vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* ENCABEZADO */}
        <div
          style={{
            padding: '16px 22px',
            borderBottom: '1px solid #E2E8F0',
            backgroundColor: '#F8FAFC',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 10,
                backgroundColor: '#0D9488',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#FFFFFF',
              }}
            >
              <Truck size={22} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#0F172A' }}>
                  {isLiberated ? 'Acta de Rampa & Liberación de Chofer' : 'Recepción en Rampa & Liberación Exprés'}
                </h3>
                {isLiberated ? (
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: 12,
                      backgroundColor: '#DCFCE7',
                      color: '#15803D',
                      border: '1px solid #BBF7D0',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    <CheckCircle2 size={12} /> Chofer Liberado
                  </span>
                ) : (
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: 12,
                      backgroundColor: '#FEF3C7',
                      color: '#B45309',
                      border: '1px solid #FDE68A',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    <Clock size={12} /> Pendiente Liberar
                  </span>
                )}
              </div>
              <p style={{ margin: 0, fontSize: 12, color: '#64748B' }}>
                Folio: <strong style={{ color: '#0F172A' }}>{activeReceipt?.codigo}</strong> • Factura:{' '}
                <strong style={{ color: '#0F172A' }}>{activeReceipt?.facturaRespaldo || activeReceipt?.ocReferencia || 'S/N'}</strong> • Cliente:{' '}
                <strong>{activeReceipt?.cliente?.nombreComercial || activeReceipt?.cliente?.nombreEmpresa || activeReceipt?.cliente?.razonSocial || 'Cliente'}</strong>
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {isLiberated && (
              <button
                type="button"
                onClick={() => onViewDocument(activeReceipt)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 12px',
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: 600,
                  backgroundColor: '#F1F5F9',
                  border: '1px solid #CBD5E1',
                  color: '#334155',
                  cursor: 'pointer',
                }}
              >
                <Printer size={14} /> Ver / Imprimir Acta
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
                borderRadius: 6,
              }}
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* CUERPO DEL MODAL (SCROLLABLE) */}
        <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1, backgroundColor: '#FFFFFF' }}>
          {errorMsg && (
            <div
              style={{
                marginBottom: 16,
                padding: '10px 14px',
                borderRadius: 8,
                backgroundColor: '#FEF2F2',
                border: '1px solid #FCA5A5',
                color: '#B91C1C',
                fontSize: 13,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <AlertCircle size={16} />
              <span>{errorMsg}</span>
            </div>
          )}

          {successMsg && (
            <div
              style={{
                marginBottom: 16,
                padding: '10px 14px',
                borderRadius: 8,
                backgroundColor: '#F0FDF4',
                border: '1px solid #86EFAC',
                color: '#15803D',
                fontSize: 13,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <CheckCircle2 size={16} />
                <span>{successMsg}</span>
              </div>
              <button
                type="button"
                onClick={() => onViewDocument(activeReceipt)}
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: '#0D9488',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                }}
              >
                Abrir Acta Imprimible
              </button>
            </div>
          )}

          {/* DESLINDE LEGAL OBLIGATORIO */}
          <div
            style={{
              padding: '12px 16px',
              backgroundColor: '#F8FAFC',
              borderRadius: 8,
              border: '1px solid #E2E8F0',
              marginBottom: 18,
              fontSize: 12,
              color: '#475569',
              lineHeight: 1.5,
              display: 'flex',
              gap: 10,
              alignItems: 'flex-start',
            }}
          >
            <ShieldCheck size={18} style={{ color: '#0D9488', flexShrink: 0, marginTop: 2 }} />
            <div>
              <strong style={{ color: '#0F172A' }}>Alcance Operativo de Rampa:</strong> El presente documento certifica
              exclusivamente un conteo físico global y revisión exterior de bultos/cajas cerrado en rampa de descarga,
              quedando sujeto a la inspección interna a detalle pieza por pieza, verificación de lotes, conteo de unidades
              y dictamen de calidad posterior.
            </div>
          </div>

          <form onSubmit={handleSubmit}>
            {/* SECCIÓN 1: DATOS DE TRANSPORTE Y ANDÉN */}
            <div style={{ marginBottom: 20 }}>
              <h4
                style={{
                  margin: '0 0 10px 0',
                  fontSize: 13,
                  fontWeight: 700,
                  color: '#334155',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}
              >
                1. Datos de Transporte y Maniobra
              </h4>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#64748B', marginBottom: 4 }}>
                    Línea / Fletera
                  </label>
                  <input
                    type="text"
                    value={lineaTransporte}
                    onChange={(e) => setLineaTransporte(e.target.value)}
                    placeholder="Ej. TEMPAQ / Castores"
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      borderRadius: 6,
                      border: '1px solid #CBD5E1',
                      fontSize: 13,
                      boxSizing: 'border-box',
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#64748B', marginBottom: 4 }}>
                    Capacidad de Unidad
                  </label>
                  <input
                    type="text"
                    value={capacidadCarga}
                    onChange={(e) => setCapacidadCarga(e.target.value)}
                    placeholder="Ej. Camión 3.5 Ton, Tráiler 53', Rabón..."
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      borderRadius: 6,
                      border: '1px solid #CBD5E1',
                      fontSize: 13,
                      boxSizing: 'border-box',
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#64748B', marginBottom: 4 }}>
                    Placas del Vehículo
                  </label>
                  <input
                    type="text"
                    value={placa}
                    onChange={(e) => setPlaca(e.target.value)}
                    placeholder="Ej. 7851ZP"
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      borderRadius: 6,
                      border: '1px solid #CBD5E1',
                      fontSize: 13,
                      boxSizing: 'border-box',
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#64748B', marginBottom: 4 }}>
                    Nombre del Chofer
                  </label>
                  <input
                    type="text"
                    value={nombreChofer}
                    onChange={(e) => setNombreChofer(e.target.value)}
                    placeholder="Nombre completo del transportista"
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      borderRadius: 6,
                      border: '1px solid #CBD5E1',
                      fontSize: 13,
                      boxSizing: 'border-box',
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#64748B', marginBottom: 4 }}>
                    Andén Asignado
                  </label>
                  <input
                    type="text"
                    value={andenAsignado}
                    onChange={(e) => setAndenAsignado(e.target.value)}
                    placeholder="Ej. Andén 01, Rampa 1..."
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      borderRadius: 6,
                      border: '1px solid #CBD5E1',
                      fontSize: 13,
                      boxSizing: 'border-box',
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#64748B', marginBottom: 4 }}>
                    Responsable de Recibo (Andén)
                  </label>
                  <input
                    type="text"
                    value={nombreReceptor}
                    onChange={(e) => setNombreReceptor(e.target.value)}
                    placeholder="Nombre del almacenista receptor"
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      borderRadius: 6,
                      border: '1px solid #CBD5E1',
                      fontSize: 13,
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
              </div>
            </div>

            {/* SECCIÓN 2: CONTEO GLOBAL Y DAÑOS EXTERIORES */}
            <div style={{ marginBottom: 20 }}>
              <h4
                style={{
                  margin: '0 0 10px 0',
                  fontSize: 13,
                  fontWeight: 700,
                  color: '#334155',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}
              >
                2. Balance Físico de Bultos en Rampa
              </h4>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(4, 1fr)',
                  gap: 12,
                  backgroundColor: '#F8FAFC',
                  padding: 16,
                  borderRadius: 10,
                  border: '1px solid #E2E8F0',
                }}
              >
                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#475569', marginBottom: 4 }}>
                    Bultos Declarados
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={bultosDeclarados}
                    onChange={handleBultosChange(setBultosDeclarados)}
                    placeholder="0"
                    style={{
                      width: '100%',
                      padding: '10px',
                      borderRadius: 8,
                      border: '1px solid #CBD5E1',
                      fontSize: 16,
                      fontWeight: 700,
                      color: '#0F172A',
                      boxSizing: 'border-box',
                    }}
                  />
                  <span style={{ fontSize: 10, color: '#64748B' }}>Según remisión / factura</span>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#0284C7', marginBottom: 4 }}>
                    Bultos Recibidos
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={bultosRecibidos}
                    onChange={handleBultosChange(setBultosRecibidos)}
                    placeholder="0"
                    style={{
                      width: '100%',
                      padding: '10px',
                      borderRadius: 8,
                      border: '1px solid #38BDF8',
                      fontSize: 16,
                      fontWeight: 700,
                      color: '#0284C7',
                      boxSizing: 'border-box',
                    }}
                  />
                  <span style={{ fontSize: 10, color: '#64748B' }}>Total descargado en rampa</span>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#D97706', marginBottom: 4 }}>
                    Bultos con Daño Exterior
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={bultosDanados}
                    onChange={handleBultosChange(setBultosDanados)}
                    placeholder="0"
                    style={{
                      width: '100%',
                      padding: '10px',
                      borderRadius: 8,
                      border: `1px solid ${numDanados > numRecibidos ? '#EF4444' : '#FBBF24'}`,
                      fontSize: 16,
                      fontWeight: 700,
                      color: '#D97706',
                      boxSizing: 'border-box',
                    }}
                  />
                  <span style={{ fontSize: 10, color: '#64748B' }}>Subconjunto de los recibidos</span>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#475569', marginBottom: 4 }}>
                    Diferencia Neta
                  </label>
                  <div
                    style={{
                      padding: '10px',
                      borderRadius: 8,
                      backgroundColor:
                        diferenciaBultos === 0
                          ? '#F1F5F9'
                          : diferenciaBultos > 0
                          ? '#ECFDF5'
                          : '#FEF2F2',
                      border:
                        diferenciaBultos === 0
                          ? '1px solid #CBD5E1'
                          : diferenciaBultos > 0
                          ? '1px solid #A7F3D0'
                          : '1px solid #FECACA',
                      fontSize: 16,
                      fontWeight: 800,
                      color:
                        diferenciaBultos === 0
                          ? '#475569'
                          : diferenciaBultos > 0
                          ? '#059669'
                          : '#DC2626',
                      textAlign: 'center',
                    }}
                  >
                    {diferenciaBultos > 0 ? `+${diferenciaBultos}` : diferenciaBultos}{' '}
                    <span style={{ fontSize: 11, fontWeight: 600 }}>
                      {diferenciaBultos === 0 ? 'Sin dif.' : diferenciaBultos > 0 ? 'Sobrante' : 'Faltante'}
                    </span>
                  </div>
                  <span style={{ fontSize: 10, color: '#64748B' }}>Recibidos vs Declarados</span>
                </div>
              </div>

              {/* BANNER DINÁMICO DE ESTADO DE CONFORMIDAD */}
              <div
                style={{
                  marginTop: 12,
                  padding: '10px 14px',
                  borderRadius: 8,
                  backgroundColor: tieneDiscrepancias ? '#FFFBEB' : '#F0FDF4',
                  border: `1px solid ${tieneDiscrepancias ? '#FDE68A' : '#BBF7D0'}`,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                }}
              >
                {tieneDiscrepancias ? (
                  <AlertTriangle size={18} style={{ color: '#D97706', flexShrink: 0 }} />
                ) : (
                  <CheckCircle2 size={18} style={{ color: '#16A34A', flexShrink: 0 }} />
                )}
                <div style={{ fontSize: 12 }}>
                  <strong style={{ color: tieneDiscrepancias ? '#92400E' : '#166534' }}>
                    {tieneDiscrepancias ? 'Atención: Carga con Discrepancias / Reservas en Rampa' : 'Carga Conforme en Rampa'}
                  </strong>
                  <div style={{ color: '#64748B' }}>
                    Leyenda que firmará el transportista:{' '}
                    <strong style={{ color: '#0F172A' }}>«{leyendaChofer}»</strong>
                  </div>
                </div>
              </div>

              {/* OBSERVACIONES */}
              <div style={{ marginTop: 12 }}>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#64748B', marginBottom: 4 }}>
                  Observaciones de Rampa (Estado de empaques, sello roto, estiba caída, etc.)
                </label>
                <textarea
                  rows={2}
                  value={observacionesRampa}
                  onChange={(e) => setObservacionesRampa(e.target.value)}
                  placeholder="Detallar cualquier condición física observada durante la descarga exterior..."
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: 6,
                    border: '1px solid #CBD5E1',
                    fontSize: 12,
                    boxSizing: 'border-box',
                    resize: 'vertical',
                  }}
                />
              </div>
            </div>

            {/* SECCIÓN 3: FIRMAS DIGITALES */}
            <div style={{ marginBottom: 20 }}>
              <h4
                style={{
                  margin: '0 0 10px 0',
                  fontSize: 13,
                  fontWeight: 700,
                  color: '#334155',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}
              >
                3. Firmas Digitales de Liberación
              </h4>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                {/* FIRMA CHOFER */}
                <div
                  style={{
                    border: '1px solid #CBD5E1',
                    borderRadius: 10,
                    padding: 12,
                    backgroundColor: '#FFFFFF',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <div>
                      <span style={{ fontSize: 12, fontWeight: 700, color: '#0F172A' }}>Firma del Transportista</span>
                      <div style={{ fontSize: 10, color: '#64748B' }}>{nombreChofer || 'Chofer'}</div>
                    </div>
                    <button
                      type="button"
                      onClick={clearChoferCanvas}
                      style={{
                        padding: '2px 8px',
                        fontSize: 11,
                        color: '#64748B',
                        backgroundColor: '#F1F5F9',
                        border: '1px solid #E2E8F0',
                        borderRadius: 4,
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                      }}
                    >
                      <RotateCcw size={11} /> Limpiar
                    </button>
                  </div>

                  {choferPadActive ? (
                    <canvas
                      ref={choferCanvasRef}
                      width={340}
                      height={130}
                      style={{
                        width: '100%',
                        height: 130,
                        border: '1px dashed #CBD5E1',
                        borderRadius: 6,
                        backgroundColor: '#FAFAFA',
                        touchAction: 'none',
                        cursor: 'crosshair',
                      }}
                    />
                  ) : (
                    <div style={{ height: 130, border: '1px solid #E2E8F0', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#FAFAFA' }}>
                      <img src={firmaChofer} alt="Firma Chofer" style={{ maxHeight: 110, maxWidth: '95%' }} />
                    </div>
                  )}

                  <div
                    style={{
                      marginTop: 6,
                      fontSize: 10.5,
                      fontWeight: 600,
                      color: tieneDiscrepancias ? '#B45309' : '#15803D',
                      textAlign: 'center',
                      padding: '4px',
                      backgroundColor: tieneDiscrepancias ? '#FFFBEB' : '#F0FDF4',
                      borderRadius: 4,
                    }}
                  >
                    «{leyendaChofer}»
                  </div>
                </div>

                {/* FIRMA RECEPTOR */}
                <div
                  style={{
                    border: '1px solid #CBD5E1',
                    borderRadius: 10,
                    padding: 12,
                    backgroundColor: '#FFFFFF',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <div>
                      <span style={{ fontSize: 12, fontWeight: 700, color: '#0F172A' }}>Firma Receptor de Andén</span>
                      <div style={{ fontSize: 10, color: '#64748B' }}>{nombreReceptor || 'Receptor'}</div>
                    </div>
                    <button
                      type="button"
                      onClick={clearReceptorCanvas}
                      style={{
                        padding: '2px 8px',
                        fontSize: 11,
                        color: '#64748B',
                        backgroundColor: '#F1F5F9',
                        border: '1px solid #E2E8F0',
                        borderRadius: 4,
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                      }}
                    >
                      <RotateCcw size={11} /> Limpiar
                    </button>
                  </div>

                  {receptorPadActive ? (
                    <canvas
                      ref={receptorCanvasRef}
                      width={340}
                      height={130}
                      style={{
                        width: '100%',
                        height: 130,
                        border: '1px dashed #CBD5E1',
                        borderRadius: 6,
                        backgroundColor: '#FAFAFA',
                        touchAction: 'none',
                        cursor: 'crosshair',
                      }}
                    />
                  ) : (
                    <div style={{ height: 130, border: '1px solid #E2E8F0', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#FAFAFA' }}>
                      <img src={firmaReceptor} alt="Firma Receptor" style={{ maxHeight: 110, maxWidth: '95%' }} />
                    </div>
                  )}

                  <div
                    style={{
                      marginTop: 6,
                      fontSize: 10.5,
                      fontWeight: 600,
                      color: '#475569',
                      textAlign: 'center',
                      padding: '4px',
                      backgroundColor: '#F1F5F9',
                      borderRadius: 4,
                    }}
                  >
                    «Recibió en andén y atestiguó conteo exterior»
                  </div>
                </div>
              </div>
            </div>

            {/* SECCIÓN 4: AUDITORÍA (SI YA ESTABA LIBERADO) */}
            {isLiberated && (
              <div
                style={{
                  marginBottom: 20,
                  padding: 16,
                  backgroundColor: '#FFF7ED',
                  border: '1px solid #FFEDD5',
                  borderRadius: 10,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <AlertTriangle size={16} style={{ color: '#EA580C' }} />
                  <strong style={{ fontSize: 13, color: '#9A3412' }}>
                    Documento Previamente Firmado - Modo Corrección Auditada
                  </strong>
                </div>
                <p style={{ margin: '0 0 10px 0', fontSize: 12, color: '#7C2D12' }}>
                  Este folio ya fue firmado por el chofer y liberado el{' '}
                  <strong>{activeReceipt?.fechaLiberacionChofer ? new Date(activeReceipt.fechaLiberacionChofer).toLocaleString() : ''}</strong>.
                  Para salvaguardar la validez jurídica, el cambio no sobrescribirá silenciosamente el registro original; se
                  grabará una entrada con sello de tiempo y justificación.
                </p>

                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#9A3412', marginBottom: 4 }}>
                    Motivo de Corrección Posterior (Obligatorio) *
                  </label>
                  <input
                    type="text"
                    value={motivoCorreccion}
                    onChange={(e) => setMotivoCorreccion(e.target.value)}
                    placeholder="Ej. Rectificación de conteo por reclasificación de cajas del lote 2026A..."
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      borderRadius: 6,
                      border: '1px solid #FDBA74',
                      fontSize: 13,
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
              </div>
            )}

            {/* HISTORIAL DE CORRECCIONES */}
            {historial.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <button
                  type="button"
                  onClick={() => setShowHistory(!showHistory)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#0284C7',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: 0,
                  }}
                >
                  <History size={14} />
                  {showHistory ? 'Ocultar' : 'Ver'} Historial de Auditoría ({historial.length} corrección{historial.length > 1 ? 'es' : ''})
                </button>

                {showHistory && (
                  <div
                    style={{
                      marginTop: 8,
                      border: '1px solid #E2E8F0',
                      borderRadius: 8,
                      overflow: 'hidden',
                      fontSize: 11,
                    }}
                  >
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ backgroundColor: '#F8FAFC', textAlign: 'left', borderBottom: '1px solid #E2E8F0' }}>
                          <th style={{ padding: '6px 10px', color: '#64748B' }}>Fecha/Hora</th>
                          <th style={{ padding: '6px 10px', color: '#64748B' }}>Usuario</th>
                          <th style={{ padding: '6px 10px', color: '#64748B' }}>Motivo</th>
                          <th style={{ padding: '6px 10px', color: '#64748B' }}>Valores Anteriores</th>
                        </tr>
                      </thead>
                      <tbody>
                        {historial.map((h: any, idx: number) => (
                          <tr key={idx} style={{ borderBottom: '1px solid #F1F5F9' }}>
                            <td style={{ padding: '6px 10px', color: '#334155' }}>
                              {new Date(h.fecha).toLocaleString()}
                            </td>
                            <td style={{ padding: '6px 10px', fontWeight: 600, color: '#0F172A' }}>
                              {h.usuario || 'Almacén'}
                            </td>
                            <td style={{ padding: '6px 10px', color: '#64748B' }}>{h.motivo}</td>
                            <td style={{ padding: '6px 10px', color: '#64748B' }}>
                              Decl: {h.valoresAnteriores?.bultosDeclarados ?? h.bultosDeclaradosPrevios ?? '-'} | Rec: {h.valoresAnteriores?.bultosRecibidos ?? h.bultosRecibidosPrevios ?? '-'} | Dañ: {h.valoresAnteriores?.bultosDanados ?? h.bultosDanadosPrevios ?? '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* ACCIONES DEL FORMULARIO */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingTop: 16,
                borderTop: '1px solid #E2E8F0',
              }}
            >
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                style={{
                  padding: '9px 18px',
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  backgroundColor: '#F1F5F9',
                  border: '1px solid #CBD5E1',
                  color: '#475569',
                  cursor: 'pointer',
                }}
              >
                Cerrar
              </button>

              <div style={{ display: 'flex', gap: 10 }}>
                {isLiberated && (
                  <button
                    type="button"
                    onClick={() => onViewDocument(activeReceipt)}
                    style={{
                      padding: '9px 18px',
                      borderRadius: 8,
                      fontSize: 13,
                      fontWeight: 600,
                      backgroundColor: '#FFFFFF',
                      border: '1px solid #0D9488',
                      color: '#0D9488',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <FileText size={15} /> Ver Acta Completa
                  </button>
                )}

                <button
                  type="submit"
                  disabled={submitting}
                  style={{
                    padding: '9px 22px',
                    borderRadius: 8,
                    fontSize: 13,
                    fontWeight: 700,
                    backgroundColor: '#0D9488',
                    border: '1px solid #0D9488',
                    color: '#FFFFFF',
                    cursor: submitting ? 'not-allowed' : 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    boxShadow: '0 2px 4px rgba(13,148,136,0.25)',
                    opacity: submitting ? 0.7 : 1,
                  }}
                >
                  <Save size={15} />
                  {submitting
                    ? 'Procesando...'
                    : isLiberated
                    ? 'Guardar Corrección Auditada'
                    : 'Guardar y Liberar Chofer'}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
