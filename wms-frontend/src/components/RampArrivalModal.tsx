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
    receipt?.nombreReceptor || currentUser?.nombre || currentUser?.name || currentUser?.email || ''
  );

  // Control explícito y trazable del estado del sello / precinto (SIN selección por default)
  const getInitialEstadoSello = (): 'INTACTO' | 'ROTO' | 'SIN_SELLO' | 'NO_APLICA' | null => {
    // Si la unidad ya fue liberada previamente, permitir restaurar
    if (activeReceipt?.fechaLiberacionChofer || receipt?.fechaLiberacionChofer) {
      if (receipt?.estadoSello && ['INTACTO', 'ROTO', 'SIN_SELLO', 'NO_APLICA'].includes(receipt.estadoSello)) {
        return receipt.estadoSello;
      }
      if (receipt?.observacionesRampa) {
        if (receipt.observacionesRampa.includes('[SELLO: ROTO]')) return 'ROTO';
        if (receipt.observacionesRampa.includes('[SELLO: SIN_SELLO]')) return 'SIN_SELLO';
        if (receipt.observacionesRampa.includes('[SELLO: NO_APLICA]')) return 'NO_APLICA';
        if (receipt.observacionesRampa.includes('[SELLO: INTACTO]')) return 'INTACTO';
      }
    }
    return null; // Operación real: operador debe seleccionar explícitamente al abrir
  };

  const getInitialNumeroSello = (): string => {
    if (receipt?.numeroSello) return receipt.numeroSello;
    if (receipt?.observacionesRampa) {
      const match = receipt.observacionesRampa.match(/\[SELLO:\s*[A-Z_]+(?:\s*#([A-Za-z0-9_-]+))?\]/);
      if (match && match[2]) return match[2];
    }
    return '';
  };

  const [estadoSello, setEstadoSello] = useState<'INTACTO' | 'ROTO' | 'SIN_SELLO' | 'NO_APLICA' | null>(getInitialEstadoSello());
  const [numeroSello, setNumeroSello] = useState<string>(getInitialNumeroSello());

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
  // Bultos Recibidos: Requiere captura física del operador en rampa (no auto-confirmar sin conteo)
  const [bultosRecibidos, setBultosRecibidos] = useState<number | string>(
    receipt?.bultosRecibidos !== undefined && receipt?.bultosRecibidos !== null
      ? receipt.bultosRecibidos
      : ''
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
      setNombreReceptor(receipt.nombreReceptor || currentUser?.nombre || currentUser?.name || currentUser?.email || '');
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
      if (receipt.fechaLiberacionChofer) {
        if (receipt.estadoSello && ['INTACTO', 'ROTO', 'SIN_SELLO', 'NO_APLICA'].includes(receipt.estadoSello)) {
          setEstadoSello(receipt.estadoSello);
        } else if (receipt.sellosIntactos === false) {
          setEstadoSello('ROTO');
        } else if (receipt.observacionesRampa) {
          if (receipt.observacionesRampa.includes('[SELLO: ROTO]')) setEstadoSello('ROTO');
          else if (receipt.observacionesRampa.includes('[SELLO: SIN_SELLO]')) setEstadoSello('SIN_SELLO');
          else if (receipt.observacionesRampa.includes('[SELLO: NO_APLICA]')) setEstadoSello('NO_APLICA');
          else if (receipt.observacionesRampa.includes('[SELLO: INTACTO]')) setEstadoSello('INTACTO');
        }
      }
      if (receipt.numeroSello) {
        setNumeroSello(receipt.numeroSello);
      }
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

  // Conteo físico real ingresado
  const conteoCapturado = bultosRecibidos !== '' && !isNaN(numRecibidos) && numRecibidos >= 0;
  const diferenciaBultos = conteoCapturado ? (numRecibidos - numDeclarados) : 0;
  const selloSeleccionado = estadoSello !== null;

  // Condiciones de reserva / incidencias
  const tieneReservas =
    estadoSello === 'ROTO' ||
    estadoSello === 'SIN_SELLO' ||
    (conteoCapturado && diferenciaBultos !== 0) ||
    numDanados > 0;

  // Conforme SOLO tras conteo físico completo y sin incidencias
  const esConforme =
    conteoCapturado &&
    selloSeleccionado &&
    (estadoSello === 'INTACTO' || estadoSello === 'NO_APLICA') &&
    diferenciaBultos === 0 &&
    numDanados === 0;

  // Pendiente de validación física si falta conteo o falta selección de sello
  const pendienteValidacion = !conteoCapturado || !selloSeleccionado;

  // Leyenda dinámica del chofer
  const leyendaChofer = tieneReservas
    ? 'Entregó con reservas y discrepancias asentadas'
    : esConforme
    ? 'Entregó carga conforme (revisión exterior)'
    : 'Pendiente de validación física en rampa';

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

    // Validación de enteros no negativos y captura física
    if (bultosDeclarados === '' || isNaN(numDeclarados) || numDeclarados < 0 || !Number.isInteger(numDeclarados)) {
      setErrorMsg('Debe especificar los bultos declarados como un número entero mayor o igual a cero.');
      return;
    }
    if (bultosRecibidos === '' || isNaN(numRecibidos) || numRecibidos < 0 || !Number.isInteger(numRecibidos)) {
      setErrorMsg('Debe registrar físicamente los bultos recibidos en rampa (captura física requerida).');
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
      setErrorMsg('Debe registrar la línea de transporte / fletera de la unidad física que arribó a rampa.');
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
    if (!andenAsignado || !andenAsignado.trim()) {
      setErrorMsg('Debe registrar el andén asignado para la descarga de la unidad en rampa.');
      return;
    }
    if (!nombreReceptor || !nombreReceptor.trim()) {
      setErrorMsg('Debe registrar el responsable de recibo en andén (usuario autenticado).');
      return;
    }

    // 0. Selección explícita obligatoria del estado del sello (sin default)
    if (!estadoSello) {
      setErrorMsg('Debe seleccionar explícitamente el estado físico del sello o precinto de seguridad de la unidad.');
      return;
    }

    // 1. Folio de sello según condición física
    if (estadoSello === 'INTACTO' && (!numeroSello || !numeroSello.trim())) {
      setErrorMsg('Al registrar el sello como Intacto, es obligatorio ingresar el número/folio físico del sello.');
      return;
    }
    if (estadoSello === 'ROTO' && (!numeroSello || !numeroSello.trim())) {
      setErrorMsg('Al registrar el sello como Roto o Alterado, capture el folio visible o escriba "ILEGIBLE".');
      return;
    }

    // 2. Observaciones obligatorias ante anomalías o reservas
    if (estadoSello === 'ROTO' && (!observacionesRampa || observacionesRampa.trim().length < 5)) {
      setErrorMsg('Al marcar el sello como Roto o Alterado, es obligatorio detallar las observaciones de la anomalía en rampa (mínimo 5 caracteres).');
      return;
    }
    if (estadoSello === 'SIN_SELLO' && (!observacionesRampa || observacionesRampa.trim().length < 5)) {
      setErrorMsg('Al asentar que la unidad llegó Sin Sello cuando se requería, es obligatorio justificar el motivo en las Observaciones (mínimo 5 caracteres).');
      return;
    }
    if (tieneReservas && (!observacionesRampa || observacionesRampa.trim().length < 5)) {
      setErrorMsg('La carga presenta reservas (daños, faltante/sobrante o condición de sello). Es obligatorio registrar las observaciones correspondientes (mínimo 5 caracteres).');
      return;
    }

    // Validación estricta de firmas digitales: nunca vacías
    if (!firmaChofer || !firmaChofer.trim()) {
      setErrorMsg('La firma digital del transportista / chofer es obligatoria para emitir el acta de rampa.');
      return;
    }
    if (!firmaReceptor || !firmaReceptor.trim()) {
      setErrorMsg('La firma digital del responsable de andén es obligatoria para liberar al chofer.');
      return;
    }

    // Validación de auditoría si ya estaba firmado y liberado
    if (isLiberated && (!motivoCorreccion || motivoCorreccion.trim().length < 5)) {
      setErrorMsg('Este documento ya fue firmado y liberado previamente. Para aplicar cambios debe justificar un motivo de corrección para el historial de auditoría.');
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

      // Etiquetado explícito de sello en observaciones para trazabilidad permanente sin ruptura de schema
      const cleanObs = observacionesRampa.trim();
      const numSelloVal = (estadoSello === 'NO_APLICA' || estadoSello === 'SIN_SELLO') ? '' : numeroSello.trim();
      const selloPrefix = `[SELLO: ${estadoSello}${numSelloVal ? ` #${numSelloVal}` : ''}]`;
      const finalObs = cleanObs
        ? (cleanObs.includes('[SELLO:') ? cleanObs : `${selloPrefix} ${cleanObs}`)
        : selloPrefix;

      const body = {
        bultosDeclarados: numDeclarados,
        bultosRecibidos: numRecibidos,
        bultosDanados: numDanados,
        lineaTransporte: lineaTransporte.trim(),
        capacidadCarga: capacidadCarga.trim() || undefined,
        placa: placa.trim(),
        nombreChofer: nombreChofer.trim(),
        andenAsignado: andenAsignado.trim(),
        estadoSello,
        sellosIntactos: estadoSello === 'INTACTO',
        numeroSello: numSelloVal || undefined,
        observacionesRampa: finalObs,
        firmaChofer,
        firmaReceptor,
        nombreReceptor: nombreReceptor.trim(),
        usuario: currentUser?.nombre || currentUser?.name || currentUser?.email || nombreReceptor.trim(),
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

              {/* CONTROL PROFESIONAL DE ESTADO DE SELLOS DE SEGURIDAD (SIN DEFAULT) */}
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px dashed #E2E8F0' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 700, color: '#334155' }}>
                    <ShieldCheck size={16} style={{ color: estadoSello === 'INTACTO' ? '#16A34A' : estadoSello === 'ROTO' ? '#DC2626' : estadoSello === 'SIN_SELLO' ? '#D97706' : estadoSello === 'NO_APLICA' ? '#475569' : '#94A3B8' }} />
                    Estado del Sello / Precinto de Seguridad *
                    {!estadoSello && (
                      <span style={{ fontSize: 10, color: '#DC2626', fontWeight: 600, backgroundColor: '#FEF2F2', padding: '1px 6px', borderRadius: 4, border: '1px solid #FECACA' }}>
                        Selección requerida
                      </span>
                    )}
                  </label>
                  <span style={{ fontSize: 10.5, color: '#64748B' }}>
                    Inspección física exterior de inviolabilidad
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
                  {/* Opción 1: Intacto */}
                  <button
                    type="button"
                    onClick={() => setEstadoSello('INTACTO')}
                    style={{
                      padding: '10px 12px',
                      borderRadius: 8,
                      border: estadoSello === 'INTACTO' ? '2px solid #16A34A' : '1px solid #CBD5E1',
                      backgroundColor: estadoSello === 'INTACTO' ? '#F0FDF4' : '#FFFFFF',
                      cursor: 'pointer',
                      textAlign: 'left',
                      transition: 'all 0.15s ease',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 3,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <CheckCircle2 size={16} style={{ color: estadoSello === 'INTACTO' ? '#16A34A' : '#94A3B8' }} />
                      <span style={{ fontSize: 12, fontWeight: 700, color: estadoSello === 'INTACTO' ? '#166534' : '#334155' }}>
                        Intacto / Íntegro
                      </span>
                    </div>
                    <span style={{ fontSize: 9.5, color: estadoSello === 'INTACTO' ? '#15803D' : '#64748B' }}>
                      Sello verificado con folio
                    </span>
                  </button>

                  {/* Opción 2: Roto / Alterado */}
                  <button
                    type="button"
                    onClick={() => setEstadoSello('ROTO')}
                    style={{
                      padding: '10px 12px',
                      borderRadius: 8,
                      border: estadoSello === 'ROTO' ? '2px solid #DC2626' : '1px solid #CBD5E1',
                      backgroundColor: estadoSello === 'ROTO' ? '#FEF2F2' : '#FFFFFF',
                      cursor: 'pointer',
                      textAlign: 'left',
                      transition: 'all 0.15s ease',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 3,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <AlertTriangle size={16} style={{ color: estadoSello === 'ROTO' ? '#DC2626' : '#94A3B8' }} />
                      <span style={{ fontSize: 12, fontWeight: 700, color: estadoSello === 'ROTO' ? '#991B1B' : '#334155' }}>
                        Roto / Alterado
                      </span>
                    </div>
                    <span style={{ fontSize: 9.5, color: estadoSello === 'ROTO' ? '#B91C1C' : '#64748B' }}>
                      Violado, forzado o roto
                    </span>
                  </button>

                  {/* Opción 3: Sin Sello (Ausente) */}
                  <button
                    type="button"
                    onClick={() => {
                      setEstadoSello('SIN_SELLO');
                      setNumeroSello('');
                    }}
                    style={{
                      padding: '10px 12px',
                      borderRadius: 8,
                      border: estadoSello === 'SIN_SELLO' ? '2px solid #D97706' : '1px solid #CBD5E1',
                      backgroundColor: estadoSello === 'SIN_SELLO' ? '#FFFBEB' : '#FFFFFF',
                      cursor: 'pointer',
                      textAlign: 'left',
                      transition: 'all 0.15s ease',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 3,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <AlertCircle size={16} style={{ color: estadoSello === 'SIN_SELLO' ? '#D97706' : '#94A3B8' }} />
                      <span style={{ fontSize: 12, fontWeight: 700, color: estadoSello === 'SIN_SELLO' ? '#92400E' : '#334155' }}>
                        Sin Sello (Ausente)
                      </span>
                    </div>
                    <span style={{ fontSize: 9.5, color: estadoSello === 'SIN_SELLO' ? '#B45309' : '#64748B' }}>
                      Debía tener sello pero no lo trae
                    </span>
                  </button>

                  {/* Opción 4: No Aplica */}
                  <button
                    type="button"
                    onClick={() => {
                      setEstadoSello('NO_APLICA');
                      setNumeroSello('');
                    }}
                    style={{
                      padding: '10px 12px',
                      borderRadius: 8,
                      border: estadoSello === 'NO_APLICA' ? '2px solid #64748B' : '1px solid #CBD5E1',
                      backgroundColor: estadoSello === 'NO_APLICA' ? '#F8FAFC' : '#FFFFFF',
                      cursor: 'pointer',
                      textAlign: 'left',
                      transition: 'all 0.15s ease',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 3,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Layers size={16} style={{ color: estadoSello === 'NO_APLICA' ? '#475569' : '#94A3B8' }} />
                      <span style={{ fontSize: 12, fontWeight: 700, color: estadoSello === 'NO_APLICA' ? '#1E293B' : '#334155' }}>
                        No Aplica Precinto
                      </span>
                    </div>
                    <span style={{ fontSize: 9.5, color: estadoSello === 'NO_APLICA' ? '#475569' : '#64748B' }}>
                      Unidad abierta o no requerida
                    </span>
                  </button>
                </div>

                {/* Folio de sello condicional y advertencias */}
                <div style={{ marginTop: 10, display: 'flex', gap: 12, alignItems: 'center' }}>
                  <div style={{ flex: '1 1 280px' }}>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#475569', marginBottom: 3 }}>
                      {estadoSello === 'NO_APLICA'
                        ? 'Folio de Sello (No aplica para esta unidad)'
                        : estadoSello === 'SIN_SELLO'
                        ? 'Folio de Sello (Opcional - Sello ausente)'
                        : estadoSello === 'ROTO'
                        ? 'Folio del Sello Afectado (o "ILEGIBLE") *'
                        : 'Número / Folio del Sello de Seguridad *'}
                    </label>
                    <input
                      type="text"
                      value={numeroSello}
                      onChange={(e) => setNumeroSello(e.target.value)}
                      disabled={estadoSello === 'NO_APLICA' || !estadoSello}
                      placeholder={
                        !estadoSello
                          ? 'Seleccione primero el estado del sello'
                          : estadoSello === 'NO_APLICA'
                          ? 'No aplica precinto por tipo de unidad'
                          : estadoSello === 'SIN_SELLO'
                          ? 'N/A (Sello ausente)'
                          : estadoSello === 'ROTO'
                          ? 'Folio visible o "ILEGIBLE"'
                          : 'Ej. MX-889102 (Obligatorio)'
                      }
                      style={{
                        width: '100%',
                        padding: '7px 10px',
                        borderRadius: 6,
                        border: `1px solid ${
                          (estadoSello === 'INTACTO' || estadoSello === 'ROTO') && !numeroSello
                            ? '#F59E0B'
                            : '#CBD5E1'
                        }`,
                        backgroundColor:
                          estadoSello === 'NO_APLICA' || !estadoSello
                            ? '#F1F5F9'
                            : (estadoSello === 'INTACTO' || estadoSello === 'ROTO') && !numeroSello
                            ? '#FFFBEB'
                            : '#FFFFFF',
                        color: estadoSello === 'NO_APLICA' || !estadoSello ? '#94A3B8' : '#0F172A',
                        fontSize: 12,
                        fontFamily: 'monospace',
                        boxSizing: 'border-box',
                        cursor: estadoSello === 'NO_APLICA' || !estadoSello ? 'not-allowed' : 'text',
                      }}
                    />
                  </div>

                  <div style={{ flex: '2 1 320px', fontSize: 11 }}>
                    {!estadoSello && (
                      <span style={{ color: '#D97706', fontWeight: 600 }}>
                        ⚠️ Seleccione el estado observado para habilitar el registro de la unidad.
                      </span>
                    )}
                    {estadoSello === 'INTACTO' && (
                      <span style={{ color: '#166534', fontWeight: 600 }}>
                        Capture el folio alfanumérico visible troquelado en el precinto físico.
                      </span>
                    )}
                    {estadoSello === 'ROTO' && (
                      <span style={{ color: '#DC2626', fontWeight: 600 }}>
                        ⚠️ Registre el folio o "ILEGIBLE" y justifique la causa en Observaciones abajo.
                      </span>
                    )}
                    {estadoSello === 'SIN_SELLO' && (
                      <span style={{ color: '#D97706', fontWeight: 600 }}>
                        ⚠️ La unidad debía traer sello y llegó abierta/sin precinto. Justifique en Observaciones.
                      </span>
                    )}
                    {estadoSello === 'NO_APLICA' && (
                      <span style={{ color: '#475569' }}>
                        Operación o unidad abierta/local que no requiere precinto fiscal o de seguridad.
                      </span>
                    )}
                  </div>
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
                    Bultos Recibidos *
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={bultosRecibidos}
                    onChange={handleBultosChange(setBultosRecibidos)}
                    placeholder="Captura física en rampa"
                    style={{
                      width: '100%',
                      padding: '10px',
                      borderRadius: 8,
                      border: `1px solid ${bultosRecibidos === '' ? '#F59E0B' : '#38BDF8'}`,
                      backgroundColor: bultosRecibidos === '' ? '#FFFBEB' : '#FFFFFF',
                      fontSize: 16,
                      fontWeight: 700,
                      color: '#0284C7',
                      boxSizing: 'border-box',
                    }}
                  />
                  <span style={{ fontSize: 10, color: bultosRecibidos === '' ? '#B45309' : '#64748B', fontWeight: bultosRecibidos === '' ? 600 : 400 }}>
                    {bultosRecibidos === '' ? 'Conteo físico pendiente' : 'Total descargado en rampa'}
                  </span>
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
                        bultosRecibidos === ''
                          ? '#F8FAFC'
                          : diferenciaBultos === 0
                          ? '#F1F5F9'
                          : diferenciaBultos > 0
                          ? '#ECFDF5'
                          : '#FEF2F2',
                      border:
                        bultosRecibidos === ''
                          ? '1px dashed #CBD5E1'
                          : diferenciaBultos === 0
                          ? '1px solid #CBD5E1'
                          : diferenciaBultos > 0
                          ? '1px solid #A7F3D0'
                          : '1px solid #FECACA',
                      fontSize: 16,
                      fontWeight: 800,
                      color:
                        bultosRecibidos === ''
                          ? '#94A3B8'
                          : diferenciaBultos === 0
                          ? '#475569'
                          : diferenciaBultos > 0
                          ? '#059669'
                          : '#DC2626',
                      textAlign: 'center',
                    }}
                  >
                    {bultosRecibidos === '' ? '—' : diferenciaBultos > 0 ? `+${diferenciaBultos}` : diferenciaBultos}{' '}
                    <span style={{ fontSize: 11, fontWeight: 600 }}>
                      {bultosRecibidos === '' ? 'Pendiente captura' : diferenciaBultos === 0 ? 'Sin dif.' : diferenciaBultos > 0 ? 'Sobrante' : 'Faltante'}
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
                  backgroundColor:
                    pendienteValidacion
                      ? '#F8FAFC'
                      : tieneReservas
                      ? (estadoSello === 'ROTO' ? '#FEF2F2' : '#FFFBEB')
                      : '#F0FDF4',
                  border: `1px solid ${
                    pendienteValidacion
                      ? '#CBD5E1'
                      : tieneReservas
                      ? (estadoSello === 'ROTO' ? '#FECACA' : '#FDE68A')
                      : '#BBF7D0'
                  }`,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                }}
              >
                {pendienteValidacion ? (
                  <Clock size={18} style={{ color: '#64748B', flexShrink: 0 }} />
                ) : tieneReservas ? (
                  estadoSello === 'ROTO' ? (
                    <AlertCircle size={18} style={{ color: '#DC2626', flexShrink: 0 }} />
                  ) : (
                    <AlertTriangle size={18} style={{ color: '#D97706', flexShrink: 0 }} />
                  )
                ) : (
                  <CheckCircle2 size={18} style={{ color: '#16A34A', flexShrink: 0 }} />
                )}
                <div style={{ fontSize: 12 }}>
                  <strong
                    style={{
                      color:
                        pendienteValidacion
                          ? '#475569'
                          : tieneReservas
                          ? (estadoSello === 'ROTO' ? '#991B1B' : '#92400E')
                          : '#166534',
                    }}
                  >
                    {pendienteValidacion
                      ? 'Pendiente de validación física en rampa'
                      : tieneReservas
                      ? (estadoSello === 'ROTO'
                          ? 'Carga recibida con reservas (Sello Roto o Alterado)'
                          : estadoSello === 'SIN_SELLO'
                          ? 'Carga recibida con reservas (Unidad Sin Sello Requerido)'
                          : 'Carga recibida con reservas (Discrepancias / Daños)')
                      : estadoSello === 'NO_APLICA'
                      ? 'Carga Conforme en Rampa (Unidad sin sellos requeridos)'
                      : 'Carga Conforme en Rampa (Sellos y empaques íntegros)'}
                  </strong>
                  <div style={{ color: '#64748B' }}>
                    Leyenda que firmará el transportista:{' '}
                    <strong style={{ color: '#0F172A' }}>«{leyendaChofer}»</strong>
                  </div>
                </div>
              </div>

              {/* OBSERVACIONES */}
              <div style={{ marginTop: 12 }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: 11,
                    fontWeight: 600,
                    color: (estadoSello === 'ROTO' || estadoSello === 'SIN_SELLO' || (tieneReservas && !pendienteValidacion)) ? '#DC2626' : '#64748B',
                    marginBottom: 4,
                  }}
                >
                  Observaciones de Rampa{' '}
                  {estadoSello === 'ROTO'
                    ? '(Obligatorio por Sello Roto / Alterado) *'
                    : estadoSello === 'SIN_SELLO'
                    ? '(Obligatorio por Sello Ausente) *'
                    : tieneReservas && !pendienteValidacion
                    ? '(Obligatorio por Reservas en Carga) *'
                    : '(Estado de empaques, sello, estiba caída, etc.)'}
                </label>
                <textarea
                  rows={2}
                  value={observacionesRampa}
                  onChange={(e) => setObservacionesRampa(e.target.value)}
                  placeholder={
                    estadoSello === 'ROTO'
                      ? 'Obligatorio: Detallar anomalía del sello, cerrojo y condición de arribo de la unidad...'
                      : estadoSello === 'SIN_SELLO'
                      ? 'Obligatorio: Justificar por qué la unidad arriba sin precinto y autorización de apertura...'
                      : tieneReservas && !pendienteValidacion
                      ? 'Obligatorio: Describir causas de las reservas, bultos dañados o diferencias detectadas...'
                      : 'Detallar cualquier condición física observada durante la descarga exterior...'
                  }
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: 6,
                    border: `1px solid ${
                      (estadoSello === 'ROTO' || estadoSello === 'SIN_SELLO' || (tieneReservas && !pendienteValidacion)) && (!observacionesRampa || observacionesRampa.trim().length < 5)
                        ? '#F87171'
                        : '#CBD5E1'
                    }`,
                    backgroundColor:
                      (estadoSello === 'ROTO' || estadoSello === 'SIN_SELLO' || (tieneReservas && !pendienteValidacion)) && (!observacionesRampa || observacionesRampa.trim().length < 5)
                        ? '#FFF5F5'
                        : '#FFFFFF',
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
                      color: tieneReservas ? '#B45309' : '#15803D',
                      textAlign: 'center',
                      padding: '4px',
                      backgroundColor: tieneReservas ? '#FFFBEB' : '#F0FDF4',
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
                  disabled={submitting || !estadoSello}
                  style={{
                    padding: '9px 22px',
                    borderRadius: 8,
                    fontSize: 13,
                    fontWeight: 700,
                    backgroundColor: (!estadoSello || submitting) ? '#94A3B8' : '#0D9488',
                    border: `1px solid ${(!estadoSello || submitting) ? '#94A3B8' : '#0D9488'}`,
                    color: '#FFFFFF',
                    cursor: (!estadoSello || submitting) ? 'not-allowed' : 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    boxShadow: (!estadoSello || submitting) ? 'none' : '0 2px 4px rgba(13,148,136,0.25)',
                    opacity: submitting ? 0.7 : (!estadoSello ? 0.8 : 1),
                  }}
                  title={!estadoSello ? 'Debe seleccionar el estado del sello para habilitar la liberación' : ''}
                >
                  <Save size={15} />
                  {submitting
                    ? 'Procesando...'
                    : !estadoSello
                    ? 'Seleccione Estado de Sello'
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
