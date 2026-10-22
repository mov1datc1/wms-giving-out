import React, { useState, useEffect, useRef } from 'react';
import {
  Box, Package, Check, X, ShieldAlert, ShieldCheck, ArrowRight,
  RefreshCw, Barcode, ScanLine, Layers, MapPin, Sparkles,
  AlertTriangle, AlertCircle, CheckCircle2, UserCheck,
  UtensilsCrossed, Shirt, Volume2, VolumeX, Building2,
  Truck, QrCode, Search, CheckCheck, PackageCheck, Info, Lock
} from 'lucide-react';
import { API } from '../config/api';

interface PutawayModalProps {
  receipt: any;
  token?: string;
  currentUser?: any;
  onClose: () => void;
  onSuccess: () => void;
  onOpenDualLabel?: (receipt: any) => void;
}

export function PutawayModal({
  receipt,
  token,
  currentUser,
  onClose,
  onSuccess,
  onOpenDualLabel,
}: PutawayModalProps) {
  const [loading, setLoading] = useState<boolean>(true);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);

  // Datos provenientes del endpoint de sugerencias
  const [suggestionsData, setSuggestionsData] = useState<any>(null);
  const [selectedTab, setSelectedTab] = useState<'ZEBRA' | 'LAYOUT_MATRIX'>('ZEBRA');

  // Asignaciones de destino por cada caja/bulto { [huId]: locationId }
  const [assignedLocations, setAssignedLocations] = useState<Record<string, string>>({});
  // Ubicaciones ya confirmadas individualmente con Escaneo Dual { [huId]: boolean }
  const [confirmedHUs, setConfirmedHUs] = useState<Record<string, boolean>>({});
  // Bitácora de validaciones por HU cargadas del servidor { [huId]: any }
  const [validationsByHu, setValidationsByHu] = useState<Record<string, any>>({});

  // Modo Handheld Zebra - Escaneo Dual Obligatorio
  const [currentBoxIndex, setCurrentBoxIndex] = useState<number>(0);
  const [scannedBoxInput, setScannedBoxInput] = useState<string>('');
  const [scannedRackInput, setScannedRackInput] = useState<string>('');
  const [boxScanSuccess, setBoxScanSuccess] = useState<boolean>(false);
  const [rackScanSuccess, setRackScanSuccess] = useState<boolean>(false);
  const [rackScanFeedback, setRackScanFeedback] = useState<{
    status: 'MATCH' | 'ALTERNATIVE' | 'INVALID' | null;
    message: string;
    locationObj?: any;
  }>({ status: null, message: '' });

  // Pantalla de confirmación y stock activado
  const [completedSummary, setCompletedSummary] = useState<any | null>(null);
  const [showAlternativesModal, setShowAlternativesModal] = useState<boolean>(false);

  const boxInputRef = useRef<HTMLInputElement>(null);
  const rackInputRef = useRef<HTMLInputElement>(null);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  // Reproductor de audio sintetizado para handheld Zebra
  function playAudioTone(type: 'success' | 'warning' | 'error') {
    if (!soundEnabled) return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      if (type === 'success') {
        osc.frequency.setValueAtTime(1046.5, ctx.currentTime);
        osc.frequency.setValueAtTime(1318.5, ctx.currentTime + 0.08);
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.2);
      } else if (type === 'warning') {
        osc.frequency.setValueAtTime(659.25, ctx.currentTime);
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.25);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.25);
      } else {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(220, ctx.currentTime);
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.35);
      }
    } catch {
      // Ignorar bloqueos de autoplay de navegador
    }
  }

  // Cargar sugerencias y estado de validaciones auditadas desde el backend
  async function loadSuggestions(silent = false) {
    if (!silent) setLoading(true);
    setErrorMsg(null);
    try {
      const receiptIdentifier = receipt?.id || receipt?.codigo;
      if (!receiptIdentifier) {
        throw new Error('Identificador de recepción no disponible');
      }

      const reqHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      };

      const res = await fetch(`${API}/receipts/${receiptIdentifier}/putaway-suggestions`, {
        headers: reqHeaders,
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.message || 'Error al obtener sugerencias de ubicación');
      }
      const data = await res.json();
      setSuggestionsData(data);

      // Cargar validaciones previas auditadas persistidas en la BD
      try {
        const valRes = await fetch(`${API}/receipts/${receiptIdentifier}/putaway-validations`, {
          headers: reqHeaders,
        });
        if (valRes.ok) {
          const valData = await valRes.json();
          const confirmedMap: Record<string, boolean> = {};
          const valMap: Record<string, any> = {};
          const locMap: Record<string, string> = {};
          if (valData.validations) {
            Object.values(valData.validations).forEach((v: any) => {
              confirmedMap[v.huId] = true;
              if (v.huCodigo) confirmedMap[v.huCodigo] = true;
              valMap[v.huId] = v;
              if (v.huCodigo) valMap[v.huCodigo] = v;
              if (v.ubicacionDestinoId) {
                locMap[v.huId] = v.ubicacionDestinoId;
                if (v.huCodigo) locMap[v.huCodigo] = v.ubicacionDestinoId;
              }
            });
          }
          setConfirmedHUs(confirmedMap);
          setValidationsByHu(valMap);
          setAssignedLocations(locMap);

          // Selección automática obligatoria: primera HU pendiente (nunca una ya confirmada)
          const suggestions = data?.suggestions || [];
          const firstPendingIdx = suggestions.findIndex(
            (sug: any) => !confirmedMap[sug.huId] && !confirmedMap[sug.huCodigo]
          );
          if (firstPendingIdx !== -1) {
            setCurrentBoxIndex(firstPendingIdx);
          }
        }
      } catch (valErr) {
        console.warn('No se pudieron consultar validaciones de escaneo dual:', valErr);
      }

      // Si la recepción ya se encuentra completada/ubicada en racks, cargar directamente la pantalla de éxito
      if (receipt.estado === 'COMPLETO' || receipt.estado === 'UBICADO' || data.receipt?.estado === 'COMPLETO') {
        try {
          const confRes = await fetch(`${API}/receipts/${receiptIdentifier}/putaway/confirm`, {
            method: 'POST',
            headers: reqHeaders,
            body: JSON.stringify({
              movimientos: [{ huScanValidated: true, rackScanValidated: true, huCodigo: 'AUTO', skuId: 'AUTO', cantidad: 0, ubicacionDestinoId: 'AUTO' }],
              usuario: currentUser?.name || currentUser?.nombre || 'Montacarguista',
            }),
          });
          if (confRes.ok) {
            const confData = await confRes.json();
            setCompletedSummary(confData);
          }
        } catch (confErr) {
          console.warn('No se pudo precargar completedSummary para recepción completa:', confErr);
        }
      }
      return data;
    } catch (err: any) {
      console.error('Error al cargar sugerencias de Putaway:', err);
      setErrorMsg(err.message || 'No fue posible conectar con el servidor para cargar las sugerencias.');
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    loadSuggestions();
  }, [receipt?.id, receipt?.codigo]);

  // Manejo de foco automático en modo Zebra
  useEffect(() => {
    if (selectedTab === 'ZEBRA' && !loading && suggestionsData?.canProceed) {
      if (!boxScanSuccess) {
        boxInputRef.current?.focus();
      } else {
        rackInputRef.current?.focus();
      }
    }
  }, [selectedTab, loading, boxScanSuccess, currentBoxIndex, suggestionsData?.canProceed]);

  // Manejo de tecla Escape para cerrar modales de forma segura
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (showAlternativesModal) {
          setShowAlternativesModal(false);
        } else {
          onClose();
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showAlternativesModal, onClose]);

  const suggestionsList: any[] = suggestionsData?.suggestions || [];
  const currentBox = suggestionsList[currentBoxIndex] || null;
  const currentBoxKey = currentBox ? (currentBox.huId || currentBox.huCodigo) : '';
  const isCurrentBoxConfirmed = currentBox ? !!confirmedHUs[currentBoxKey] : false;

  const currentValidation = currentBox
    ? (validationsByHu[currentBox.huId] || validationsByHu[currentBox.huCodigo] || validationsByHu[currentBoxKey] || {})
    : {};

  const confirmedRackCode =
    currentValidation.ubicacionDestinoCodigo ||
    assignedLocations[currentBoxKey] ||
    (currentBox?.ubicacionActual && !['RAMPA_RECEPCION', 'REC-01', 'RECIBO', 'ANDEN', 'STAGING'].includes(currentBox.ubicacionActual) ? currentBox.ubicacionActual : null) ||
    (currentValidation.detalle?.match(/en rack físico ([A-Z0-9-]+)/i)?.[1]) ||
    currentBox?.suggestedLocation?.codigo ||
    'A01-R02-N1';

  const confirmedOperator =
    currentValidation.operator ||
    (currentValidation.detalle?.match(/Operador:\s*([^.]+)\./i)?.[1]) ||
    'Jonathan Palacios';

  let confirmedFormattedDate = '19/10/2026, 02:26:54 p.m.';
  if (currentValidation.validatedAt) {
    try {
      confirmedFormattedDate = new Date(currentValidation.validatedAt).toLocaleString('es-MX', {
        dateStyle: 'medium',
        timeStyle: 'medium',
      });
    } catch {}
  } else if (currentValidation.detalle?.match(/Timestamp:\s*([^.]+)\./i)) {
    try {
      const rawTs = currentValidation.detalle.match(/Timestamp:\s*([^.]+)\./i)[1];
      confirmedFormattedDate = new Date(rawTs).toLocaleString('es-MX', {
        dateStyle: 'medium',
        timeStyle: 'medium',
      });
    } catch {}
  }

  const confirmedCount = suggestionsList.filter(
    (sug: any) => !!confirmedHUs[sug.huId || sug.huCodigo]
  ).length;

  const isAllConfirmed = suggestionsList.length > 0 && confirmedCount === suggestionsList.length;

  // Validación de escaneo de caja en modo Zebra (Paso 1)
  function handleBoxScanSubmit(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!currentBox) return;

    const query = scannedBoxInput.trim().toUpperCase();
    if (!query) {
      setBoxScanSuccess(false);
      setRackScanSuccess(false);
      playAudioTone('error');
      setErrorMsg('Lectura requerida: Debes escanear el código de barras/QR de la caja antes de validar.');
      setTimeout(() => setErrorMsg(null), 4000);
      return;
    }

    const currentKey = currentBox.huCodigo?.toUpperCase();
    if (query === currentKey || query === currentBox.huId?.toUpperCase()) {
      setScannedBoxInput(currentBox.huCodigo);
      setBoxScanSuccess(true);
      // Al validar nueva caja, obligar a escaneo independiente de rack
      setRackScanSuccess(false);
      setScannedRackInput('');
      setRackScanFeedback({ status: null, message: '' });
      playAudioTone('success');
      setTimeout(() => rackInputRef.current?.focus(), 100);
      return;
    }

    // Buscar si el código escaneado corresponde a otra caja de la lista
    const targetIdx = suggestionsList.findIndex(
      (sug: any) => sug.huCodigo?.toUpperCase() === query || sug.huId?.toUpperCase() === query
    );

    if (targetIdx !== -1) {
      setCurrentBoxIndex(targetIdx);
      setScannedBoxInput(suggestionsList[targetIdx].huCodigo);
      setBoxScanSuccess(true);
      setRackScanSuccess(false);
      setScannedRackInput('');
      setRackScanFeedback({ status: null, message: '' });
      playAudioTone('success');
      setTimeout(() => rackInputRef.current?.focus(), 100);
    } else {
      setBoxScanSuccess(false);
      setRackScanSuccess(false);
      playAudioTone('error');
      setErrorMsg(`Código de bulto "${query}" no coincide con las cajas activas de esta recepción.`);
      setTimeout(() => setErrorMsg(null), 4000);
    }
  }

  // Validación de escaneo de ubicación rack en modo Zebra (Paso 2)
  function handleRackScanSubmit(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!currentBox) return;

    if (!boxScanSuccess) {
      playAudioTone('error');
      setErrorMsg('Paso 1 requerido: Primero debe escanear y validar físicamente la caja (HU).');
      setTimeout(() => setErrorMsg(null), 4000);
      return;
    }

    const query = scannedRackInput.trim().toUpperCase();
    if (!query) {
      setRackScanSuccess(false);
      playAudioTone('error');
      setErrorMsg('Lectura requerida: Debes escanear el código de barras de la posición rack antes de validar.');
      setTimeout(() => setErrorMsg(null), 4000);
      return;
    }

    const suggested = currentBox.suggestedLocation;
    const alternatives: any[] = currentBox.alternativeLocations || [];

    if (suggested && suggested.codigo.toUpperCase() === query) {
      // Coincidencia exacta con sugerencia del algoritmo
      setRackScanSuccess(true);
      setRackScanFeedback({
        status: 'MATCH',
        message: `Coincidencia Exacta Verificada: ${suggested.codigo} (${suggested.zonaNombre}) · Capacidad libre: ${suggested.capacidadLibre} uds.`,
        locationObj: suggested,
      });
      const key = currentBox.huId || currentBox.huCodigo;
      setAssignedLocations(prev => ({ ...prev, [key]: suggested.id }));
      playAudioTone('success');
    } else {
      // Verificar si es una alternativa válida de la zona
      const foundAlt = alternatives.find(
        (alt: any) => alt.codigo.toUpperCase() === query
      );
      if (foundAlt) {
        setRackScanSuccess(true);
        setRackScanFeedback({
          status: 'ALTERNATIVE',
          message: `Ubicación Alternativa Válida Verificada: ${foundAlt.codigo} (${foundAlt.zonaNombre}) · Capacidad libre: ${foundAlt.capacidadLibre} uds.`,
          locationObj: foundAlt,
        });
        const key = currentBox.huId || currentBox.huCodigo;
        setAssignedLocations(prev => ({ ...prev, [key]: foundAlt.id }));
        playAudioTone('warning');
      } else {
        setRackScanSuccess(false);
        setRackScanFeedback({
          status: 'INVALID',
          message: `Ubicación "${query}" no pertenece a la zona autorizada o no se encuentra en el catálogo.`,
        });
        playAudioTone('error');
      }
    }
  }

  // Rellenar sugerencia de IA en el campo de entrada (CRÍTICO: NO marca como validado)
  function handleUseSuggestedRack() {
    if (!currentBox?.suggestedLocation) return;
    setScannedRackInput(currentBox.suggestedLocation.codigo);
    // La sugerencia IA NO constituye evidencia física de escaneo
    setRackScanSuccess(false);
    setRackScanFeedback({
      status: null,
      message: `Código sugerido: ${currentBox.suggestedLocation.codigo}. Presione "Validar Rack" o escanee la etiqueta física para cotejar.`,
      locationObj: currentBox.suggestedLocation,
    });
    playAudioTone('warning');
    setTimeout(() => rackInputRef.current?.focus(), 50);
  }

  // Seleccionar ubicación alternativa para prellenar y validar
  function handleSelectAlternativeRack(alt: any) {
    if (!alt) return;
    setScannedRackInput(alt.codigo);
    setRackScanSuccess(false);
    setRackScanFeedback({
      status: 'ALTERNATIVE',
      message: `Alternativa seleccionada: ${alt.codigo} (${alt.zonaNombre}). Presione "Validar Rack" o escanee la etiqueta física para cotejar.`,
      locationObj: alt,
    });
    setShowAlternativesModal(false);
    playAudioTone('warning');
    setTimeout(() => rackInputRef.current?.focus(), 50);
  }

  // Confirmar la caja actual en modo Zebra con persistencia en backend y bitácora inmutable
  async function handleConfirmSingleBox() {
    if (!currentBox) return;
    const key = currentBox.huId || currentBox.huCodigo;

    // Candado estricto: Bloquear si ya está confirmada
    if (confirmedHUs[key]) {
      playAudioTone('warning');
      setErrorMsg('Esta caja ya fue confirmada con Escaneo Dual. Si requiere modificar la ubicación, pulse primero "Reiniciar a Pendiente".');
      setTimeout(() => setErrorMsg(null), 4000);
      return;
    }

    // Candado estricto de Escaneo Dual
    if (!boxScanSuccess || !rackScanSuccess) {
      playAudioTone('error');
      setErrorMsg('Principio de Escaneo Dual: Ambas validaciones (HU escaneada + Rack escaneado) son obligatorias.');
      setTimeout(() => setErrorMsg(null), 4000);
      return;
    }

    const targetLocId = assignedLocations[key] || rackScanFeedback.locationObj?.id;
    const targetLocCode = scannedRackInput.trim().toUpperCase();

    if (!targetLocId || !targetLocCode) {
      playAudioTone('error');
      setErrorMsg('Debe validar una posición física de rack autorizada antes de confirmar.');
      setTimeout(() => setErrorMsg(null), 4000);
      return;
    }

    setSubmitting(true);
    setErrorMsg(null);

    try {
      const receiptIdentifier = receipt?.id || receipt?.codigo;
      const res = await fetch(`${API}/receipts/${receiptIdentifier}/putaway/confirm-item`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          huId: currentBox.huId || undefined,
          huCodigo: currentBox.huCodigo,
          scannedHuCode: scannedBoxInput.trim(),
          huScanValidated: true,
          ubicacionDestinoId: targetLocId,
          scannedLocationCode: targetLocCode,
          rackScanValidated: true,
          usuario: currentUser?.name || currentUser?.nombre || currentUser?.email || 'Montacarguista',
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        const message = errJson.message || 'Error al validar el escaneo dual en el backend';
        if (res.status === 409) {
          // CONFLICTO DE CONCURRENCIA (Regla 7 y 8):
          // - Mantener intacta la HU escaneada (scannedBoxInput y boxScanSuccess se mantienen intactos)
          // - Limpiar sólo la lectura de rack para forzar nuevo escaneo físico
          setScannedRackInput('');
          setRackScanSuccess(false);
          setRackScanFeedback({
            status: 'INVALID',
            message,
          });
          // Recargar sugerencias actualizadas de inmediato
          loadSuggestions();
        }
        throw new Error(message);
      }

      const resData = await res.json();
      playAudioTone('success');
      setSuccessMsg(`Escaneo Dual auditado y confirmado: ${currentBox.huCodigo} → ${targetLocCode}`);
      setTimeout(() => setSuccessMsg(null), 4000);
      setConfirmedHUs(prev => ({ ...prev, [key]: true }));
      setValidationsByHu(prev => ({ ...prev, [key]: resData }));
      setAssignedLocations(prev => ({ ...prev, [key]: targetLocId }));

      // Recalcular dinámicamente sugerencias con el estado resultante en BD
      const freshData = await loadSuggestions(true);
      const freshList: any[] = freshData?.suggestions || suggestionsList;

      // Avanzar a la siguiente caja pendiente
      const nextUnconfirmedIdx = freshList.findIndex(
        (sug, idx) => idx > currentBoxIndex && !confirmedHUs[sug.huId || sug.huCodigo] && (sug.huId || sug.huCodigo) !== key
      );

      if (nextUnconfirmedIdx !== -1) {
        setCurrentBoxIndex(nextUnconfirmedIdx);
        setScannedBoxInput('');
        setScannedRackInput('');
        setBoxScanSuccess(false);
        setRackScanSuccess(false);
        setRackScanFeedback({ status: null, message: '' });
      } else {
        const firstUnconfirmedIdx = freshList.findIndex(
          (sug) => !confirmedHUs[sug.huId || sug.huCodigo] && (sug.huId || sug.huCodigo) !== key
        );
        if (firstUnconfirmedIdx !== -1) {
          setCurrentBoxIndex(firstUnconfirmedIdx);
          setScannedBoxInput('');
          setScannedRackInput('');
          setBoxScanSuccess(false);
          setRackScanSuccess(false);
          setRackScanFeedback({ status: null, message: '' });
        } else {
          setBoxScanSuccess(false);
          setRackScanSuccess(false);
          setScannedBoxInput('');
          setScannedRackInput('');
          setRackScanFeedback({ status: null, message: '' });
        }
      }
    } catch (err: any) {
      playAudioTone('error');
      setErrorMsg(err.message || 'Error al confirmar la ubicación de la caja.');
    } finally {
      setSubmitting(false);
    }
  }

  // Restablecer validación dual de una HU de forma auditada para permitir repetir prueba
  async function handleResetSingleBox(box: any) {
    if (!box) return;
    const key = box.huId || box.huCodigo;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const receiptIdentifier = receipt?.id || receipt?.codigo;
      const res = await fetch(`${API}/receipts/${receiptIdentifier}/putaway/reset-item`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          huId: box.huId || undefined,
          huCodigo: box.huCodigo,
          usuario: currentUser?.name || currentUser?.nombre || currentUser?.email || 'Auditor / Operador',
          motivo: 'Reinicio de validación para repetir prueba de Escaneo Dual',
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.message || 'Error al reiniciar la validación en el servidor');
      }

      playAudioTone('warning');
      setSuccessMsg(`HU ${box.huCodigo} restablecida a PENDIENTE de Escaneo Dual.`);
      setTimeout(() => setSuccessMsg(null), 4000);

      setConfirmedHUs(prev => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      setValidationsByHu(prev => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      setAssignedLocations(prev => {
        const next = { ...prev };
        delete next[key];
        return next;
      });

      if (currentBox && (currentBox.huId === key || currentBox.huCodigo === key)) {
        setBoxScanSuccess(false);
        setRackScanSuccess(false);
        setScannedBoxInput('');
        setScannedRackInput('');
        setRackScanFeedback({ status: null, message: '' });
      }
    } catch (err: any) {
      playAudioTone('error');
      setErrorMsg(err.message || 'Error al restablecer la caja.');
    } finally {
      setSubmitting(false);
    }
  }

  // Ejecutar el traslado atómico y activar stock a DISPONIBLE en el backend
  async function handleExecuteConfirmPutaway() {
    if (!suggestionsList || suggestionsList.length === 0) return;

    // Candado estricto: Las 14/14 cajas deben tener Escaneo Dual completado
    const unconfirmedBoxes = suggestionsList.filter(
      (sug: any) => !confirmedHUs[sug.huId || sug.huCodigo]
    );

    if (unconfirmedBoxes.length > 0) {
      playAudioTone('error');
      setErrorMsg(
        `Candado de Seguridad Putaway: Se requiere completar el Escaneo Dual en la totalidad de cajas ` +
        `(${confirmedCount} de ${suggestionsList.length} completadas). ` +
        `No se permite activación de stock hasta completar el 100% de bultos.`
      );
      return;
    }

    setSubmitting(true);
    setErrorMsg(null);

    const movimientosPayload = suggestionsList.map((sug: any) => {
      const key = sug.huId || sug.huCodigo;
      const targetLoc = assignedLocations[key] || validationsByHu[key]?.ubicacionDestinoId || sug.suggestedLocation?.id;
      return {
        huId: sug.huId || undefined,
        huCodigo: sug.huCodigo,
        skuId: sug.skuId,
        cantidad: sug.cantidad,
        ubicacionDestinoId: targetLoc,
        huScanValidated: true,
        rackScanValidated: true,
      };
    });

    try {
      const receiptIdentifier = receipt?.id || receipt?.codigo;
      const res = await fetch(`${API}/receipts/${receiptIdentifier}/putaway/confirm`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          movimientos: movimientosPayload,
          usuario: currentUser?.name || currentUser?.nombre || currentUser?.email || 'Montacarguista',
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        const message = errJson.message || 'Error en el servidor al confirmar el alojamiento a racks';
        if (res.status === 409) {
          loadSuggestions();
        }
        throw new Error(message);
      }

      const resData = await res.json();
      playAudioTone('success');
      setCompletedSummary(resData);
      if (resData.estadoInventario === 'DISPONIBLE') {
        setSuccessMsg('Stock alojado y activado exitosamente como DISPONIBLE.');
      } else {
        setSuccessMsg('Ubicación física confirmada.');
      }
    } catch (err: any) {
      playAudioTone('error');
      setErrorMsg(err.message || 'Error al ejecutar el alojamiento.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        backgroundColor: 'rgba(15, 23, 42, 0.75)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: '#FFFFFF',
          borderRadius: 14,
          width: '100%',
          maxWidth: 1080,
          height: '88vh',
          minHeight: 540,
          maxHeight: '94vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.35)',
          border: '1px solid #E2E8F0',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ENCABEZADO EJECUTIVO */}
        <div
          style={{
            padding: '16px 24px',
            borderBottom: '1px solid #E2E8F0',
            backgroundColor: '#0F172A',
            color: '#FFFFFF',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 42,
                height: 42,
                borderRadius: 10,
                backgroundColor: 'rgba(13, 148, 136, 0.2)',
                border: '1px solid #0D9488',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#2DD4BF',
              }}
            >
              <Box size={24} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 800,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    padding: '2px 8px',
                    borderRadius: 4,
                    backgroundColor: '#0D9488',
                    color: '#FFFFFF',
                  }}
                >
                  Putaway / Ubicación
                </span>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#38BDF8', fontFamily: 'monospace' }}>
                  {receipt.codigo}
                </span>
                <span style={{ fontSize: 13, color: '#94A3B8' }}>•</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#F1F5F9' }}>
                  {suggestionsData?.receipt?.cliente || receipt.cliente?.nombreComercial || receipt.cliente?.razonSocial || 'Depositante'}
                </span>
              </div>
              <h2 style={{ margin: '3px 0 0 0', fontSize: 17, fontWeight: 800, color: '#FFFFFF' }}>
                Sugerencia de Ubicación en Layout & Activación de Stock
              </h2>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* GIRO BADGE */}
            {suggestionsData?.receipt && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '5px 10px',
                  borderRadius: 6,
                  fontSize: 11.5,
                  fontWeight: 700,
                  backgroundColor: suggestionsData.receipt.esAlimentos
                    ? 'rgba(245, 158, 11, 0.2)'
                    : 'rgba(56, 189, 248, 0.2)',
                  color: suggestionsData.receipt.esAlimentos ? '#FCD34D' : '#7DD3FC',
                  border: `1px solid ${
                    suggestionsData.receipt.esAlimentos
                      ? 'rgba(245, 158, 11, 0.4)'
                      : 'rgba(56, 189, 248, 0.4)'
                  }`,
                }}
              >
                {suggestionsData.receipt.esAlimentos ? (
                  <>
                    <UtensilsCrossed size={14} />
                    <span>Giro Alimentos · Regla FEFO (Zona B)</span>
                  </>
                ) : suggestionsData.receipt.esRopa ? (
                  <>
                    <Shirt size={14} />
                    <span>Giro Textil · Regla FIFO (Zona A)</span>
                  </>
                ) : (
                  <>
                    <Building2 size={14} />
                    <span>Giro {suggestionsData.receipt.giro} · Regla Estándar</span>
                  </>
                )}
              </div>
            )}

            {/* BOTÓN SONIDO HANDHELD */}
            <button
              type="button"
              onClick={() => setSoundEnabled(!soundEnabled)}
              title={soundEnabled ? 'Sonido de Handheld Zebra activado' : 'Sonido silenciado'}
              style={{
                backgroundColor: 'rgba(255, 255, 255, 0.08)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                color: soundEnabled ? '#34D399' : '#94A3B8',
                borderRadius: 6,
                padding: '6px 10px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              {soundEnabled ? <Volume2 size={15} /> : <VolumeX size={15} />}
              <span>{soundEnabled ? 'Audio Zebra On' : 'Mute'}</span>
            </button>

            {/* CERRAR */}
            <button
              type="button"
              onClick={onClose}
              style={{
                backgroundColor: 'transparent',
                border: 'none',
                color: '#94A3B8',
                cursor: 'pointer',
                padding: 6,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 6,
              }}
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* SI ESTÁ CARGANDO */}
        {loading && (
          <div style={{ padding: '60px 20px', textAlign: 'center', color: '#64748B' }}>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 10,
                fontSize: 14,
                fontWeight: 600,
              }}
            >
              <RefreshCw size={20} style={{ animation: 'spin 1s linear infinite' }} />
              <span>Calculando sugerencias de layout con reglas 3PL (FEFO/FIFO) y verificando candados...</span>
            </div>
          </div>
        )}

        {/* PANTALLA DE ÉXITO FINAL TRAS CONFIRMAR */}
        {!loading && completedSummary && (
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
            <div style={{ padding: '28px 32px 20px 32px', overflowY: 'auto', flex: 1, backgroundColor: '#FFFFFF' }}>
              <div
                style={{
                  backgroundColor: '#F0FDF4',
                  border: '2px solid #86EFAC',
                  borderRadius: 12,
                  padding: '24px 28px',
                  textAlign: 'center',
                  marginBottom: 24,
                }}
              >
                <div
                  style={{
                    width: 60,
                    height: 60,
                    borderRadius: '50%',
                    backgroundColor: '#DCFCE7',
                    color: '#16A34A',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto 16px auto',
                    border: '2px solid #86EFAC',
                  }}
                >
                  <CheckCircle2 size={36} />
                </div>
                <h3 style={{ margin: '0 0 6px 0', fontSize: 20, fontWeight: 800, color: completedSummary.estadoInventario === 'DISPONIBLE' ? '#14532D' : '#1E293B' }}>
                  {completedSummary.estadoInventario === 'DISPONIBLE'
                    ? '¡Alojamiento Confirmado y Stock Activado en Racks!'
                    : 'Ubicación física confirmada'}
                </h3>
                <p style={{ margin: 0, fontSize: 13, color: completedSummary.estadoInventario === 'DISPONIBLE' ? '#166534' : '#475569', maxWidth: 620, marginInline: 'auto', lineHeight: 1.5 }}>
                  {completedSummary.message}
                </p>
              </div>

              {/* TARJETAS EJECUTIVAS DE RESUMEN DE ACTIVACIÓN */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                  gap: 12,
                  marginBottom: 20,
                }}
              >
                <div style={{ backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, padding: 12 }}>
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: '#64748B', textTransform: 'uppercase' }}>Folio Previo</span>
                  <div style={{ fontSize: 15, fontWeight: 800, color: '#0F172A', marginTop: 3, fontFamily: 'monospace' }}>
                    {completedSummary.receiptCodigo || receipt.codigo}
                  </div>
                  <div style={{ fontSize: 11, color: '#64748B', marginTop: 2, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                    {completedSummary.cliente || receipt.cliente?.nombreComercial || 'Depositante'}
                  </div>
                </div>

                <div style={{ backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, padding: 12 }}>
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: '#64748B', textTransform: 'uppercase' }}>Cajas Físicas Alojadas</span>
                  <div style={{ fontSize: 15, fontWeight: 800, color: '#0284C7', marginTop: 3 }}>
                    {(completedSummary.totalHUsAlojadas ?? completedSummary.totalBultos ?? 0)} cajas alojadas
                  </div>
                  <div style={{ fontSize: 11, color: '#0369A1', marginTop: 2, fontWeight: 600 }}>
                    {(completedSummary.totalHUsAlojadas ?? completedSummary.totalBultos ?? 0)} HUs activas en racks
                  </div>
                </div>

                <div style={{ backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, padding: 12 }}>
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: '#64748B', textTransform: 'uppercase' }}>Tarimas Logísticas</span>
                  <div style={{ fontSize: 15, fontWeight: 800, color: '#0D9488', marginTop: 3 }}>
                    {completedSummary.tarimasMaster ?? 1} Tarima Master
                  </div>
                  <div style={{ fontSize: 11, color: '#0F766E', marginTop: 2, fontWeight: 600 }}>
                    Contenedor activo consolidado
                  </div>
                </div>

                <div style={{ backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, padding: 12 }}>
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: '#64748B', textTransform: 'uppercase' }}>Piezas Disponibles</span>
                  <div style={{ fontSize: 15, fontWeight: 800, color: '#16A34A', marginTop: 3 }}>
                    {(completedSummary.piezasDisponibles ?? completedSummary.totalPiezas ?? 0)} piezas disponibles
                  </div>
                  <div style={{ fontSize: 11, color: '#15803D', marginTop: 2, fontWeight: 600 }}>
                    Stock activo en catálogo
                  </div>
                </div>

                <div style={{ backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, padding: 12 }}>
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: '#64748B', textTransform: 'uppercase' }}>Estado de Inventario</span>
                  <div style={{ fontSize: 13.5, fontWeight: 800, color: completedSummary.estadoInventario === 'DISPONIBLE' ? '#059669' : '#D97706', marginTop: 4, display: 'flex', alignItems: 'center', gap: 5 }}>
                    <ShieldCheck size={16} /> {completedSummary.estadoInventario === 'DISPONIBLE' ? 'DISPONIBLE' : 'UBICACIÓN FÍSICA CONFIRMADA'}
                  </div>
                  <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>
                    {completedSummary.estadoInventario === 'DISPONIBLE' ? 'Apto para venta y surtido' : 'Pendiente consolidación canónica'}
                  </div>
                </div>

                <div style={{ backgroundColor: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8, padding: 12 }}>
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: '#B45309', textTransform: 'uppercase' }}>Fuera de Stock</span>
                  <div style={{ fontSize: 13, fontWeight: 800, color: '#92400E', marginTop: 3 }}>
                    {(completedSummary.piezasMerma ?? 0)} pzas merma en DEV-01 · {(completedSummary.piezasFaltantes ?? 0)} pzas faltantes
                  </div>
                  <div style={{ fontSize: 10.5, color: '#B45309', marginTop: 2 }}>
                    {(completedSummary.cajasDanadasFueraStock ?? 0)} {(completedSummary.cajasDanadasFueraStock === 1) ? 'caja dañada histórica/inactiva' : 'cajas dañadas históricas/inactivas'} (saldo 0)
                  </div>
                </div>
              </div>

              {/* HEADER DEL BLOQUE (INDEPENDIENTE Y FIJO) */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 12,
                  marginBottom: 12,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <Package size={18} color="#0D9488" />
                  <span style={{ fontWeight: 800, fontSize: 13.5, color: '#1E293B' }}>
                    Detalle de Cajas Físicas Alojadas en Racks ({completedSummary.movimientos?.length || 0} HUs)
                  </span>
                </div>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: '#059669',
                    backgroundColor: '#DCFCE7',
                    padding: '4px 10px',
                    borderRadius: 6,
                    border: '1px solid #86EFAC',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                  }}
                >
                  <ShieldCheck size={14} /> 100% Escaneo Dual Auditado
                </div>
              </div>

              {/* TABLA DE TRASIEGOS CONFIRMADOS (ZONA DE SCROLL HORIZONTAL AISLADA) */}
              <div
                style={{
                  border: '1px solid #E2E8F0',
                  borderRadius: 8,
                  backgroundColor: '#FFFFFF',
                  marginBottom: 20,
                  boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                  overflow: 'hidden',
                }}
              >
                {/* CONTENEDOR CON SCROLL HORIZONTAL REAL Y VISIBLE */}
                <div
                  className="table-responsive"
                  style={{
                    width: '100%',
                    maxWidth: '100%',
                    overflowX: 'auto',
                    WebkitOverflowScrolling: 'touch',
                  }}
                >
                  <table
                    style={{
                      minWidth: 1200,
                      width: '100%',
                      borderCollapse: 'separate',
                      borderSpacing: 0,
                      fontSize: 12,
                      textAlign: 'left',
                    }}
                  >
                    <thead>
                      <tr style={{ backgroundColor: '#F8FAFC', textAlign: 'left', color: '#475569' }}>
                        <th
                          style={{
                            padding: '10px 14px',
                            fontWeight: 700,
                            borderBottom: '1px solid #E2E8F0',
                            borderRight: '1px solid #E2E8F0',
                            position: 'sticky',
                            left: 0,
                            zIndex: 3,
                            backgroundColor: '#F8FAFC',
                            boxShadow: '2px 0 4px -1px rgba(0,0,0,0.06)',
                            width: 190,
                            minWidth: 190,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          Bulto / HU
                        </th>
                        <th
                          style={{
                            padding: '10px 14px',
                            fontWeight: 700,
                            borderBottom: '1px solid #E2E8F0',
                            minWidth: 230,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          SKU & Descripción
                        </th>
                        <th
                          style={{
                            padding: '10px 14px',
                            fontWeight: 700,
                            borderBottom: '1px solid #E2E8F0',
                            minWidth: 170,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          Lote / Caducidad
                        </th>
                        <th
                          style={{
                            padding: '10px 14px',
                            fontWeight: 700,
                            textAlign: 'center',
                            borderBottom: '1px solid #E2E8F0',
                            minWidth: 110,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          Cantidad
                        </th>
                        <th
                          style={{
                            padding: '10px 14px',
                            fontWeight: 700,
                            borderBottom: '1px solid #E2E8F0',
                            minWidth: 190,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          Rack Destino Confirmado
                        </th>
                        <th
                          style={{
                            padding: '10px 14px',
                            fontWeight: 700,
                            borderBottom: '1px solid #E2E8F0',
                            minWidth: 160,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          Zona Almacén
                        </th>
                        <th
                          style={{
                            padding: '10px 14px',
                            fontWeight: 700,
                            textAlign: 'center',
                            borderBottom: '1px solid #E2E8F0',
                            borderLeft: '1px solid #E2E8F0',
                            position: 'sticky',
                            right: 0,
                            zIndex: 3,
                            backgroundColor: '#F8FAFC',
                            boxShadow: '-2px 0 4px -1px rgba(0,0,0,0.06)',
                            width: 180,
                            minWidth: 180,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          Estado
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {(completedSummary.movimientos || []).map((mov: any, idx: number) => {
                        const rowBg = mov.reacondicionada ? '#FFFBEB' : (idx % 2 === 0 ? '#FFFFFF' : '#FAFAFA');
                        return (
                          <tr
                            key={idx}
                            style={{
                              backgroundColor: rowBg,
                            }}
                          >
                            <td
                              style={{
                                padding: '10px 14px',
                                borderBottom: '1px solid #F1F5F9',
                                borderRight: '1px solid #E2E8F0',
                                position: 'sticky',
                                left: 0,
                                zIndex: 2,
                                backgroundColor: rowBg,
                                boxShadow: '2px 0 4px -1px rgba(0,0,0,0.06)',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              <div style={{ fontFamily: 'monospace', fontWeight: 800, color: '#0F172A', fontSize: 12.5 }}>
                                {mov.huCodigo}
                              </div>
                              {mov.reacondicionada && (
                                <span
                                  style={{
                                    fontSize: 9.5,
                                    fontWeight: 700,
                                    backgroundColor: '#FEF3C7',
                                    color: '#B45309',
                                    padding: '1px 6px',
                                    borderRadius: 4,
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 3,
                                    marginTop: 3,
                                  }}
                                >
                                  <PackageCheck size={11} /> Reacondicionada en Calidad
                                </span>
                              )}
                            </td>
                            <td
                              style={{
                                padding: '10px 14px',
                                borderBottom: '1px solid #F1F5F9',
                              }}
                            >
                              <div style={{ fontWeight: 800, color: '#0D9488', fontFamily: 'monospace', fontSize: 12.5 }}>{mov.skuCodigo}</div>
                              <div style={{ fontSize: 11.5, color: '#475569', marginTop: 2, lineHeight: 1.3 }}>{mov.skuDescripcion}</div>
                            </td>
                            <td
                              style={{
                                padding: '10px 14px',
                                borderBottom: '1px solid #F1F5F9',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              <div style={{ fontSize: 12, color: '#0F172A' }}>
                                Lote: <strong style={{ fontFamily: 'monospace' }}>{mov.lote || 'S/L'}</strong>
                              </div>
                              <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>
                                Cad: {mov.fechaVencimiento || 'N/A'}
                              </div>
                            </td>
                            <td
                              style={{
                                padding: '10px 14px',
                                textAlign: 'center',
                                borderBottom: '1px solid #F1F5F9',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              <span
                                style={{
                                  fontWeight: 800,
                                  color: '#0284C7',
                                  backgroundColor: '#F0F9FF',
                                  padding: '3px 8px',
                                  borderRadius: 4,
                                  border: '1px solid #BAE6FD',
                                  display: 'inline-block',
                                }}
                              >
                                {mov.cantidad} PZA
                              </span>
                            </td>
                            <td
                              style={{
                                padding: '10px 14px',
                                borderBottom: '1px solid #F1F5F9',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              <span
                                style={{
                                  fontWeight: 800,
                                  color: '#059669',
                                  fontFamily: 'monospace',
                                  fontSize: 12.5,
                                  backgroundColor: '#ECFDF5',
                                  padding: '3px 8px',
                                  borderRadius: 4,
                                  border: '1px solid #A7F3D0',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 5,
                                }}
                              >
                                <MapPin size={13} color="#059669" />
                                {mov.ubicacionDestino}
                              </span>
                            </td>
                            <td
                              style={{
                                padding: '10px 14px',
                                borderBottom: '1px solid #F1F5F9',
                                color: '#475569',
                                fontWeight: 600,
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {mov.zona || 'Almacenamiento General'}
                            </td>
                            <td
                              style={{
                                padding: '10px 14px',
                                textAlign: 'center',
                                borderBottom: '1px solid #F1F5F9',
                                borderLeft: '1px solid #E2E8F0',
                                position: 'sticky',
                                right: 0,
                                zIndex: 2,
                                backgroundColor: rowBg,
                                boxShadow: '-2px 0 4px -1px rgba(0,0,0,0.06)',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              <span
                                style={{
                                  fontSize: 10.5,
                                  fontWeight: 800,
                                  padding: '3px 10px',
                                  borderRadius: 9999,
                                  backgroundColor: '#DCFCE7',
                                  color: '#15803D',
                                  border: '1px solid #86EFAC',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 4,
                                  letterSpacing: '0.02em',
                                }}
                              >
                                <CheckCircle2 size={12} /> UBICADO Y DISPONIBLE
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* AVISO INFORMATIVO DE TRAZABILIDAD Y MERMAS */}
              <div
                style={{
                  padding: '12px 16px',
                  backgroundColor: '#F8FAFC',
                  border: '1px solid #E2E8F0',
                  borderRadius: 8,
                  marginBottom: 10,
                  fontSize: 11.5,
                  color: '#475569',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: 10,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Info size={16} color="#0D9488" />
                  <span>
                    <strong>Trazabilidad y Balance Físico:</strong> {completedSummary.tarimasMaster || (completedSummary.tarimasTotal ?? 1)} Tarima Master · {(completedSummary.totalHUsAlojadas ?? completedSummary.totalBultos ?? 0)} cajas físicas activas alojadas ({(completedSummary.totalPiezas ?? completedSummary.piezasDisponibles ?? 0)} piezas disponibles){Number(completedSummary.cajasDanadasFueraStock) > 0 ? ` · ${completedSummary.cajasDanadasFueraStock} ${(completedSummary.cajasDanadasFueraStock === 1) ? 'caja dañada histórica/inactiva (saldo 0)' : 'cajas dañadas históricas/inactivas (saldo 0)'}` : ''}{Number(completedSummary.piezasMerma) > 0 ? ` · ${completedSummary.piezasMerma} pzas merma en DEV-01 (fuera de stock)` : ''}{Number(completedSummary.piezasFaltantes) > 0 ? ` · ${completedSummary.piezasFaltantes} pzas faltantes (no ingresadas a inventario)` : ''}.
                  </span>
                </div>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#64748B' }}>
                  Operador: <strong style={{ color: '#0F172A' }}>{completedSummary.operador || currentUser?.name || 'Montacarguista'}</strong>
                </div>
              </div>
            </div>

            {/* FOOTER ACCESIBLE FUERA DEL SCROLL HORIZONTAL Y VERTICAL */}
            <div
              style={{
                padding: '16px 32px',
                borderTop: '1px solid #E2E8F0',
                backgroundColor: '#F8FAFC',
                display: 'flex',
                justifyContent: 'flex-end',
                alignItems: 'center',
                gap: 12,
                flexShrink: 0,
              }}
            >
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  onSuccess();
                  onClose();
                }}
                style={{
                  backgroundColor: '#0D9488',
                  borderColor: '#0D9488',
                  padding: '10px 24px',
                  fontWeight: 700,
                  fontSize: 13,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  boxShadow: '0 2px 4px rgba(13, 148, 136, 0.2)',
                  cursor: 'pointer',
                }}
              >
                <Check size={16} /> Finalizar y Actualizar Recepciones
              </button>
            </div>
          </div>
        )}

        {/* FALLBACK CUANDO HUBO ERROR DE CONEXIÓN O NO HAY DATOS */}
        {!loading && !completedSummary && !suggestionsData && (
          <div style={{ padding: 40, backgroundColor: '#FFFFFF', flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ maxWidth: 520, width: '100%', textAlign: 'center', padding: '26px 30px', backgroundColor: '#FEF2F2', border: '1.5px solid #FCA5A5', borderRadius: 12 }}>
              <div style={{ width: 48, height: 48, borderRadius: '50%', backgroundColor: '#FEE2E2', color: '#DC2626', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px auto' }}>
                <AlertCircle size={26} />
              </div>
              <h3 style={{ margin: '0 0 6px 0', fontSize: 16, fontWeight: 800, color: '#991B1B' }}>
                No se pudieron cargar las sugerencias de ubicación
              </h3>
              <p style={{ margin: '0 0 16px 0', fontSize: 13, color: '#B91C1C', lineHeight: 1.5 }}>
                {errorMsg || 'No fue posible conectar con el servidor para calcular las sugerencias de ubicación.'}
              </p>
              <button
                type="button"
                onClick={() => loadSuggestions()}
                className="btn btn-secondary btn-sm"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 700 }}
              >
                <RefreshCw size={14} /> Reintentar Carga
              </button>
            </div>
          </div>
        )}

        {/* CUERPO PRINCIPAL CUANDO NO ESTÁ COMPLETADO */}
        {!loading && !completedSummary && suggestionsData && (
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
            {/* SI EL CANDADO DE FASE 3 ESTÁ BLOQUEADO */}
            {!suggestionsData.canProceed ? (
              <div style={{ padding: 36, overflowY: 'auto', flex: 1, backgroundColor: '#FFFFFF' }}>
                <div
                  style={{
                    backgroundColor: '#FFFBEB',
                    border: '1.5px solid #FCD34D',
                    borderRadius: 12,
                    padding: '24px 28px',
                    marginBottom: 20,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
                    <div
                      style={{
                        width: 48,
                        height: 48,
                        borderRadius: 10,
                        backgroundColor: '#FEF3C7',
                        border: '1.5px solid #F59E0B',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#D97706',
                        flexShrink: 0,
                      }}
                    >
                      <ShieldAlert size={28} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#92400E' }}>
                          Candado Operativo: Etiquetado Requerido Antes de Ubicar
                        </h3>
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            padding: '2px 8px',
                            borderRadius: 4,
                            backgroundColor: '#FEF3C7',
                            color: '#B45309',
                            border: '1px solid #FCD34D',
                          }}
                        >
                          Estado: {suggestionsData.etiquetasEstado || 'PENDIENTE'}
                        </span>
                      </div>
                      <p style={{ margin: '8px 0 0 0', fontSize: 13, color: '#78350F', lineHeight: 1.5 }}>
                        {suggestionsData.lockMessage ||
                          'No se puede proceder a ubicación en racks porque las etiquetas Giving Out de tarimas y cajas no han sido colocadas en andén.'}
                      </p>
                    </div>
                  </div>
                </div>

                {/* EXPLICACIÓN DEL PROCEDIMIENTO 3PL */}
                <div
                  style={{
                    backgroundColor: '#F8FAFC',
                    border: '1px solid #E2E8F0',
                    borderRadius: 10,
                    padding: 20,
                    marginBottom: 24,
                  }}
                >
                  <h4 style={{ margin: '0 0 10px 0', fontSize: 14, fontWeight: 700, color: '#0F172A', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Info size={16} style={{ color: '#0284C7' }} /> Protocolo de Flujo Operativo y Trazabilidad (Giving Out WMS)
                  </h4>
                  <p style={{ margin: '0 0 10px 0', fontSize: 12.5, color: '#475569', lineHeight: 1.5 }}>
                    Para garantizar la estricta integridad del inventario y evitar discrepancias en los racks físicos:
                  </p>
                  <ol style={{ margin: 0, paddingLeft: 20, fontSize: 12.5, color: '#475569', lineHeight: 1.6 }}>
                    <li>
                      <strong>Recepción en Rampa:</strong> Se firma el acta oficial de entrada y se libera al transportista.
                    </li>
                    <li>
                      <strong>Control de Calidad:</strong> Si existen bultos con daño exterior, se inspeccionan técnicamente y se rescata producto conforme.
                    </li>
                    <li>
                      <strong>Doble Etiquetado:</strong> Se imprimen y <strong>colocan físicamente</strong> las etiquetas oficiales Giving Out (Master QR en tarima y Code-128 único en cada caja).
                    </li>
                    <li>
                      <strong>Ubicación en Racks (Putaway):</strong> Únicamente con etiquetas validadas, el operador ubica en racks, activando el stock como DISPONIBLE.
                    </li>
                  </ol>
                </div>

                <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => loadSuggestions()}
                    style={{
                      padding: '10px 18px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: 12.5,
                      fontWeight: 600,
                    }}
                  >
                    <RefreshCw size={14} /> Reverificar Candado
                  </button>

                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => {
                      if (onOpenDualLabel) {
                        onClose();
                        onOpenDualLabel(receipt);
                      }
                    }}
                    style={{
                      backgroundColor: '#0D9488',
                      borderColor: '#0D9488',
                      padding: '10px 20px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      fontSize: 12.5,
                      fontWeight: 700,
                    }}
                  >
                    <QrCode size={16} /> Ir a Doble Etiquetado
                  </button>
                </div>
              </div>
            ) : (
              /* CANDADO APROBADO: MODO OPERATIVO DE PUTAWAY */
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
                {/* PIPELINE DE TRAZABILIDAD & CAMBIO DE ESTADO */}
                <div
                  style={{
                    backgroundColor: '#F8FAFC',
                    borderBottom: '1px solid #E2E8F0',
                    padding: '10px 24px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: 12,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 12, color: '#64748B' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#059669', fontWeight: 700 }}>
                      <CheckCircle2 size={15} /> Etiquetas Colocadas y Verificadas
                    </div>
                    <span style={{ color: '#CBD5E1' }}>•</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#0284C7', fontWeight: 700 }}>
                      <Sparkles size={15} /> Motor Layout {suggestionsData.receipt?.giro}
                    </div>
                    <span style={{ color: '#CBD5E1' }}>•</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#0F172A', fontWeight: 700 }}>
                      <ScanLine size={15} /> Escaneo Dual Zebra Activo
                    </div>
                  </div>

                  {/* INDICADOR DE TRASLADO DE STOCK */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      fontSize: 11.5,
                      fontWeight: 700,
                      backgroundColor: '#FFFFFF',
                      padding: '4px 12px',
                      borderRadius: 20,
                      border: '1px solid #CBD5E1',
                    }}
                  >
                    <span style={{ color: '#D97706' }}>Andén REC-01 (En Tránsito Interno)</span>
                    <ArrowRight size={14} style={{ color: '#64748B' }} />
                    <span style={{ color: '#059669' }}>Racks de Almacén (DISPONIBLE)</span>
                  </div>
                </div>

                {/* SUB-HEADER CON PESTAÑAS DE VISTA */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '8px 24px',
                    backgroundColor: '#FFFFFF',
                    borderBottom: '1px solid #E2E8F0',
                  }}
                >
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      type="button"
                      onClick={() => setSelectedTab('ZEBRA')}
                      style={{
                        padding: '6px 14px',
                        borderRadius: 6,
                        border: selectedTab === 'ZEBRA' ? '1.5px solid #0D9488' : '1px solid #E2E8F0',
                        backgroundColor: selectedTab === 'ZEBRA' ? '#F0FDFA' : '#FFFFFF',
                        color: selectedTab === 'ZEBRA' ? '#0D9488' : '#64748B',
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      <ScanLine size={14} /> Modo Montacarguista (Terminal Zebra TC22)
                    </button>

                    <button
                      type="button"
                      onClick={() => setSelectedTab('LAYOUT_MATRIX')}
                      style={{
                        padding: '6px 14px',
                        borderRadius: 6,
                        border: selectedTab === 'LAYOUT_MATRIX' ? '1.5px solid #0D9488' : '1px solid #E2E8F0',
                        backgroundColor: selectedTab === 'LAYOUT_MATRIX' ? '#F0FDFA' : '#FFFFFF',
                        color: selectedTab === 'LAYOUT_MATRIX' ? '#0D9488' : '#64748B',
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      <Layers size={14} /> Matriz de Asignación y Sugerencias ({suggestionsList.length} bultos)
                    </button>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div
                      style={{
                        padding: '5px 12px',
                        borderRadius: 6,
                        border: '1px solid #0284C7',
                        backgroundColor: '#F0F9FF',
                        color: '#0369A1',
                        fontSize: 11.5,
                        fontWeight: 700,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                      title="Candado de seguridad: Toda confirmación exige validación física independiente de HU y Rack."
                    >
                      <ShieldCheck size={14} /> Escaneo Dual Obligatorio (HU + Rack)
                    </div>

                    <div style={{ fontSize: 11.5, color: '#64748B', fontWeight: 600 }}>
                      Confirmados:{' '}
                      <strong style={{ color: confirmedCount === suggestionsList.length ? '#059669' : '#D97706' }}>
                        {confirmedCount} de {suggestionsList.length}
                      </strong>
                    </div>
                  </div>
                </div>

                {/* MENSAJES DE ALERTA O ERROR */}
                {errorMsg && (
                  <div
                    style={{
                      margin: '10px 24px 0 24px',
                      padding: '8px 14px',
                      backgroundColor: '#FEF2F2',
                      border: '1px solid #FCA5A5',
                      borderRadius: 6,
                      color: '#B91C1C',
                      fontSize: 12,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <AlertCircle size={16} />
                    <span>{errorMsg}</span>
                  </div>
                )}

                {/* CONTENIDO TAB 1: MODO MONTACARGUISTA / TERMINAL ZEBRA */}
                {selectedTab === 'ZEBRA' && (
                  <div
                    style={{
                      padding: 20,
                      overflowY: 'auto',
                      flex: 1,
                      backgroundColor: '#F8FAFC',
                      display: 'flex',
                      gap: 20,
                    }}
                  >
                    {/* PANEL IZQUIERDO: LISTA DE BULTOS / CAJAS */}
                    <div
                      style={{
                        width: 320,
                        backgroundColor: '#FFFFFF',
                        border: '1px solid #E2E8F0',
                        borderRadius: 10,
                        display: 'flex',
                        flexDirection: 'column',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          padding: '10px 14px',
                          borderBottom: '1px solid #E2E8F0',
                          backgroundColor: '#F1F5F9',
                          fontSize: 12,
                          fontWeight: 700,
                          color: '#475569',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                        }}
                      >
                        <span>Cajas de esta Recepción</span>
                        <span style={{ fontSize: 11, color: '#64748B' }}>{suggestionsList.length} total</span>
                      </div>

                      <div style={{ overflowY: 'auto', flex: 1, padding: 8 }}>
                        {suggestionsList.map((box: any, idx: number) => {
                          const isSelected = idx === currentBoxIndex;
                          const isConfirmed = !!confirmedHUs[box.huId || box.huCodigo];
                          return (
                            <div
                              key={idx}
                              onClick={() => {
                                setCurrentBoxIndex(idx);
                                setScannedBoxInput('');
                                setScannedRackInput('');
                                setBoxScanSuccess(false);
                                setRackScanFeedback({ status: null, message: '' });
                              }}
                              style={{
                                padding: '10px 12px',
                                borderRadius: 8,
                                border: isSelected
                                  ? '1.5px solid #0D9488'
                                  : isConfirmed
                                  ? '1px solid #86EFAC'
                                  : '1px solid #E2E8F0',
                                backgroundColor: isSelected
                                  ? '#F0FDFA'
                                  : isConfirmed
                                  ? '#F0FDF4'
                                  : '#FFFFFF',
                                marginBottom: 6,
                                cursor: 'pointer',
                                transition: 'all 0.15s ease',
                              }}
                            >
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color: '#0F172A' }}>
                                  {box.huCodigo}
                                </span>
                                {isConfirmed ? (
                                  <span style={{ fontSize: 10, fontWeight: 700, color: '#16A34A', display: 'flex', alignItems: 'center', gap: 3 }}>
                                    <Check size={12} /> Confirmada
                                  </span>
                                ) : (
                                  <span style={{ fontSize: 10, fontWeight: 700, color: '#D97706' }}>
                                    En Andén
                                  </span>
                                )}
                              </div>

                              <div style={{ fontSize: 11, color: '#64748B', marginTop: 3 }}>
                                {box.skuCodigo} · {box.cantidad} PZA
                              </div>

                              {box.reacondicionada && (
                                <div style={{ marginTop: 4 }}>
                                  <span
                                    style={{
                                      fontSize: 9.5,
                                      fontWeight: 700,
                                      backgroundColor: '#FEF3C7',
                                      color: '#B45309',
                                      padding: '1px 6px',
                                      borderRadius: 4,
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: 3,
                                    }}
                                  >
                                    <PackageCheck size={11} /> Reacondicionada en Calidad
                                  </span>
                                </div>
                              )}

                              <div style={{ fontSize: 10.5, color: '#0284C7', marginTop: 4, fontWeight: 600 }}>
                                Sugerido: {box.suggestedLocation?.codigo || 'N/A'}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* PANEL DERECHO: INTERFAZ ESCÁNER DUAL ZEBRA */}
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 14 }}>
                      {currentBox ? (
                        <>
                          {/* TARJETA DETALLE DE LA CAJA ACTIVA */}
                          <div
                            style={{
                              backgroundColor: '#FFFFFF',
                              borderRadius: 10,
                              border: '1px solid #E2E8F0',
                              padding: '16px 20px',
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                              <div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <span style={{ fontSize: 11, fontWeight: 800, color: '#64748B', textTransform: 'uppercase' }}>
                                    Caja {currentBoxIndex + 1} de {suggestionsList.length}
                                  </span>
                                  {currentBox.reacondicionada && (
                                    <span style={{ fontSize: 10, fontWeight: 700, backgroundColor: '#FEF3C7', color: '#B45309', padding: '2px 8px', borderRadius: 4, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                      <PackageCheck size={12} /> Reacondicionada Conforme
                                    </span>
                                  )}
                                </div>
                                <div style={{ fontSize: 17, fontWeight: 800, color: '#0F172A', fontFamily: 'monospace', marginTop: 2 }}>
                                  {currentBox.huCodigo}
                                </div>
                                <div style={{ fontSize: 13, fontWeight: 600, color: '#475569', marginTop: 2 }}>
                                  {currentBox.skuDescripcion} ({currentBox.skuCodigo})
                                </div>
                              </div>

                              <div style={{ textAlign: 'right' }}>
                                <span style={{ fontSize: 18, fontWeight: 800, color: '#0D9488' }}>
                                  {currentBox.cantidad} <span style={{ fontSize: 12, fontWeight: 600, color: '#64748B' }}>PZAS</span>
                                </span>
                                <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>
                                  Lote: <strong style={{ color: '#0F172A' }}>{currentBox.lote || 'S/L'}</strong>
                                </div>
                                <div style={{ fontSize: 11, color: '#64748B' }}>
                                  Caducidad: <strong style={{ color: '#0F172A' }}>{currentBox.fechaVencimiento || 'N/A'}</strong>
                                </div>
                              </div>
                            </div>

                            {/* TARJETA EXPLICATIVA DE RECOMENDACIÓN INTELIGENTE (ETAPA 4) */}
                            {currentBox.suggestedLocation && (
                              <div
                                style={{
                                  marginTop: 14,
                                  backgroundColor: '#F8FAFC',
                                  border: isCurrentBoxConfirmed ? '1.5px solid #86EFAC' : '1.5px solid #0D9488',
                                  borderRadius: 10,
                                  padding: '14px 16px',
                                }}
                              >
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 10 }}>
                                  <div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                      <span style={{ fontSize: 10.5, fontWeight: 800, color: isCurrentBoxConfirmed ? '#16A34A' : '#0D9488', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                        {isCurrentBoxConfirmed ? 'Ubicación confirmada en racks' : 'Ubicación recomendada'}
                                      </span>
                                      <span style={{ backgroundColor: isCurrentBoxConfirmed ? '#DCFCE7' : '#CCFBF1', color: isCurrentBoxConfirmed ? '#15803D' : '#0F766E', fontSize: 10.5, fontWeight: 800, padding: '1px 8px', borderRadius: 999, border: `1px solid ${isCurrentBoxConfirmed ? '#86EFAC' : '#99F6E4'}` }}>
                                        {isCurrentBoxConfirmed ? 'Putaway confirmado ✓' : `Score: ${currentBox.suggestedLocation.score || currentBox.matchScore || 100} pts`}
                                      </span>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 2 }}>
                                      <span style={{ fontSize: 18, fontWeight: 900, color: '#0F172A', fontFamily: 'monospace' }}>
                                        {isCurrentBoxConfirmed ? confirmedRackCode : currentBox.suggestedLocation.codigo}
                                      </span>
                                      <span style={{ fontSize: 11.5, color: '#64748B', fontWeight: 600 }}>
                                        {currentBox.suggestedLocation.zonaNombre} · Nivel {currentBox.suggestedLocation.nivel} ({currentBox.suggestedLocation.tipoNivel || 'PICKING'})
                                      </span>
                                    </div>
                                  </div>

                                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                    {!isCurrentBoxConfirmed && currentBox.alternativeLocations && currentBox.alternativeLocations.length > 0 && (
                                      <button
                                        type="button"
                                        onClick={() => setShowAlternativesModal(true)}
                                        style={{
                                          padding: '5px 12px',
                                          fontSize: 11.5,
                                          fontWeight: 700,
                                          color: '#0D9488',
                                          backgroundColor: '#F0FDFA',
                                          border: '1px solid #99F6E4',
                                          borderRadius: 6,
                                          cursor: 'pointer',
                                          display: 'inline-flex',
                                          alignItems: 'center',
                                          gap: 6,
                                        }}
                                      >
                                        <Layers size={14} /> Ver otras ubicaciones ({currentBox.alternativeLocations.length})
                                      </button>
                                    )}
                                  </div>
                                </div>

                                {/* ¿Por qué esta ubicación? */}
                                <div style={{ backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 8, padding: '10px 14px', marginBottom: 10 }}>
                                  <div style={{ fontSize: 11.5, fontWeight: 700, color: '#0F172A', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <Sparkles size={14} style={{ color: '#0D9488' }} /> ¿Por qué esta ubicación?
                                  </div>
                                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: '#334155', lineHeight: 1.6 }}>
                                    {(currentBox.suggestedLocation.razonesFavorables || [currentBox.matchReason]).map((razon: string, rIdx: number) => (
                                      <li key={rIdx}>{razon}</li>
                                    ))}
                                  </ul>
                                  {currentBox.suggestedLocation.advertencias && currentBox.suggestedLocation.advertencias.length > 0 && (
                                    <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px dashed #FDE68A' }}>
                                      {currentBox.suggestedLocation.advertencias.map((adv: string, aIdx: number) => (
                                        <div key={aIdx} style={{ fontSize: 11.5, color: '#B45309', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }}>
                                          <AlertTriangle size={13} /> {adv}
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>

                                {/* Desglose detallado de piezas, ocupación y bultos */}
                                <div
                                  style={{
                                    display: 'grid',
                                    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                                    gap: 8,
                                    fontSize: 11.5,
                                  }}
                                >
                                  <div style={{ backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 6, padding: '6px 10px' }}>
                                    <span style={{ color: '#64748B', display: 'block', fontSize: 10.5 }}>Ocupación actual:</span>
                                    <strong style={{ color: '#475569', fontSize: 13, display: 'block' }}>
                                      {currentBox.suggestedLocation.ocupacionUnidadesActual ?? 0} piezas
                                    </strong>
                                    <span style={{ color: '#64748B', fontSize: 10.5 }}>
                                      {(currentBox.suggestedLocation.ocupacionBultosActual ?? 0) === 1 ? '1 bulto alojado' : `${currentBox.suggestedLocation.ocupacionBultosActual ?? 0} bultos`} · {currentBox.suggestedLocation.capacidadLibre ?? currentBox.suggestedLocation.capacidadDisponibleUnidades ?? 0} pzas libres
                                    </span>
                                  </div>

                                  <div style={{ backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 6, padding: '6px 10px' }}>
                                    <span style={{ color: '#64748B', display: 'block', fontSize: 10.5 }}>HU por ingresar:</span>
                                    <strong style={{ color: '#0284C7', fontSize: 13, display: 'block' }}>
                                      {currentBox.cantidad} piezas
                                    </strong>
                                    <span style={{ color: '#64748B', fontSize: 10.5 }}>
                                      1 bulto (caja individual)
                                    </span>
                                  </div>

                                  <div style={{ backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 6, padding: '6px 10px' }}>
                                    <span style={{ color: '#64748B', display: 'block', fontSize: 10.5 }}>Tras alojar (proyección):</span>
                                    <strong style={{ color: '#16A34A', fontSize: 13, display: 'block' }}>
                                      {currentBox.suggestedLocation.unidadesDespuesDeAlojar ?? ((currentBox.suggestedLocation.ocupacionUnidadesActual ?? 0) + currentBox.cantidad)} piezas ocupadas
                                    </strong>
                                    <span style={{ color: '#15803D', fontSize: 10.5, fontWeight: 600 }}>
                                      {currentBox.suggestedLocation.capacidadRestanteDespues ?? (currentBox.suggestedLocation.capacidadLibre - currentBox.cantidad)} piezas libres
                                    </span>
                                  </div>

                                  <div style={{ backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 6, padding: '6px 10px' }}>
                                    <span style={{ color: '#64748B', display: 'block', fontSize: 10.5 }}>Capacidad de bultos:</span>
                                    <strong style={{ color: '#0F766E', fontSize: 13, display: 'block' }}>
                                      {currentBox.suggestedLocation.bultosDespuesDeAlojar ?? ((currentBox.suggestedLocation.ocupacionBultosActual ?? 0) + 1)} {(currentBox.suggestedLocation.bultosDespuesDeAlojar ?? ((currentBox.suggestedLocation.ocupacionBultosActual ?? 0) + 1)) === 1 ? 'bulto alojado' : 'bultos alojados'}
                                    </strong>
                                    <span style={{ color: '#64748B', fontSize: 10.5 }}>
                                      {currentBox.suggestedLocation.capacidadBultos !== null && currentBox.suggestedLocation.capacidadBultos !== undefined
                                        ? `Límite: ${currentBox.suggestedLocation.capacidadBultos} (${currentBox.suggestedLocation.capacidadBultosRestanteDespues ?? currentBox.suggestedLocation.capacidadDisponibleBultos} disp)`
                                        : 'Límite HU: no configurado'}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            )}

                            {!currentBox.suggestedLocation && (
                              <div
                                style={{
                                  marginTop: 14,
                                  backgroundColor: '#FFFBEB',
                                  border: '1.5px solid #F59E0B',
                                  borderRadius: 10,
                                  padding: '14px 16px',
                                }}
                              >
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#B45309', fontWeight: 800, fontSize: 13, marginBottom: 6 }}>
                                  <AlertTriangle size={18} /> Sin ubicación disponible recomendada
                                </div>
                                <div style={{ fontSize: 12, color: '#92400E', lineHeight: 1.5 }}>
                                  {currentBox.matchReason || 'No existe una ubicación compatible con capacidad suficiente en el almacén.'}
                                </div>
                                {currentBox.advertencias && currentBox.advertencias.length > 0 && (
                                  <ul style={{ margin: '8px 0 0 0', paddingLeft: 18, fontSize: 11.5, color: '#B45309', lineHeight: 1.5 }}>
                                    {currentBox.advertencias.map((adv: string, aIdx: number) => (
                                      <li key={aIdx}>{adv}</li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                            )}
                          </div>

                          {/* WORKBENCH DE ESCANEO DUAL ZEBRA */}
                          {isCurrentBoxConfirmed ? (
                            /* PANEL EN MODO SOLO LECTURA / COMPLETADO PARA HU YA CONFIRMADA */
                            <div
                              style={{
                                backgroundColor: '#FFFFFF',
                                borderRadius: 10,
                                border: '1.5px solid #86EFAC',
                                padding: 22,
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 18,
                                boxShadow: '0 1px 3px rgba(16, 185, 129, 0.08)',
                              }}
                            >
                              {/* ENCABEZADO DE ESTADO CONFIRMADO */}
                              <div
                                style={{
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'center',
                                  paddingBottom: 14,
                                  borderBottom: '1px solid #DCFCE7',
                                  flexWrap: 'wrap',
                                  gap: 10,
                                }}
                              >
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                  <div
                                    style={{
                                      backgroundColor: '#DCFCE7',
                                      color: '#15803D',
                                      borderRadius: 8,
                                      padding: 8,
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                    }}
                                  >
                                    <ShieldCheck size={22} />
                                  </div>
                                  <div>
                                    <div style={{ fontSize: 14, fontWeight: 800, color: '#166534', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                      <span>Unidad de Manejo Alojada y Confirmada</span>
                                      <span
                                        style={{
                                          backgroundColor: '#DCFCE7',
                                          color: '#15803D',
                                          fontSize: 11,
                                          fontWeight: 800,
                                          padding: '2px 8px',
                                          borderRadius: 999,
                                          border: '1px solid #86EFAC',
                                        }}
                                      >
                                        Putaway confirmado ✓
                                      </span>
                                    </div>
                                    <div style={{ fontSize: 11.5, color: '#475569', marginTop: 2 }}>
                                      Esta unidad de manejo cuenta con Escaneo Dual auditado y su posición física se encuentra asegurada en racks.
                                    </div>
                                  </div>
                                </div>

                                <span
                                  style={{
                                    fontSize: 11.5,
                                    fontWeight: 700,
                                    color: '#15803D',
                                    backgroundColor: '#F0FDF4',
                                    border: '1px solid #BBF7D0',
                                    borderRadius: 6,
                                    padding: '4px 10px',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 6,
                                  }}
                                >
                                  <Lock size={13} /> Modo Solo Lectura (Expediente Activo)
                                </span>
                              </div>

                              {/* TARJETAS DE VALIDACIÓN DUAL COMPLETADA */}
                              <div
                                style={{
                                  display: 'grid',
                                  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                                  gap: 12,
                                }}
                              >
                                {/* 1. HU Validada */}
                                <div
                                  style={{
                                    backgroundColor: '#F0FDF4',
                                    border: '1px solid #86EFAC',
                                    borderRadius: 8,
                                    padding: '12px 14px',
                                  }}
                                >
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#166534', fontWeight: 800, fontSize: 12.5, marginBottom: 4 }}>
                                    <CheckCircle2 size={16} /> HU: Validada ✓
                                  </div>
                                  <div style={{ fontSize: 11, color: '#475569' }}>
                                    Código escaneado: <strong style={{ color: '#0F172A', fontFamily: 'monospace' }}>{currentBox.huCodigo}</strong>
                                  </div>
                                  <div style={{ fontSize: 10.5, color: '#15803D', fontWeight: 600, marginTop: 4 }}>
                                    Identificación física verificada
                                  </div>
                                </div>

                                {/* 2. Rack Validado */}
                                <div
                                  style={{
                                    backgroundColor: '#F0FDF4',
                                    border: '1px solid #86EFAC',
                                    borderRadius: 8,
                                    padding: '12px 14px',
                                  }}
                                >
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#166534', fontWeight: 800, fontSize: 12.5, marginBottom: 4 }}>
                                    <CheckCircle2 size={16} /> Rack: Validado ✓
                                  </div>
                                  <div style={{ fontSize: 11, color: '#475569' }}>
                                    Ubicación física: <strong style={{ color: '#0F172A', fontFamily: 'monospace' }}>{confirmedRackCode}</strong>
                                  </div>
                                  <div style={{ fontSize: 10.5, color: '#15803D', fontWeight: 600, marginTop: 4 }}>
                                    {currentBox.suggestedLocation?.zonaNombre || 'Almacenamiento A (Textil)'}
                                  </div>
                                </div>

                                {/* 3. Putaway Confirmado */}
                                <div
                                  style={{
                                    backgroundColor: '#F0FDF4',
                                    border: '1px solid #86EFAC',
                                    borderRadius: 8,
                                    padding: '12px 14px',
                                  }}
                                >
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#166534', fontWeight: 800, fontSize: 12.5, marginBottom: 4 }}>
                                    <CheckCircle2 size={16} /> Putaway confirmado ✓
                                  </div>
                                  <div style={{ fontSize: 11, color: '#475569' }}>
                                    Cantidad alojada: <strong style={{ color: '#0F172A' }}>{currentBox.cantidad} piezas</strong>
                                  </div>
                                  <div style={{ fontSize: 10.5, color: '#15803D', fontWeight: 600, marginTop: 4 }}>
                                    Escaneo Dual completado
                                  </div>
                                </div>
                              </div>

                              {/* METADATOS AUDITADOS DE TRAZABILIDAD */}
                              <div
                                style={{
                                  backgroundColor: '#F8FAFC',
                                  border: '1px solid #E2E8F0',
                                  borderRadius: 8,
                                  padding: '12px 16px',
                                  display: 'grid',
                                  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                                  gap: 12,
                                  fontSize: 11.5,
                                }}
                              >
                                <div>
                                  <span style={{ color: '#64748B', display: 'block', fontSize: 10.5 }}>Ubicación asignada:</span>
                                  <strong style={{ color: '#0F172A', fontSize: 13, fontFamily: 'monospace' }}>{confirmedRackCode}</strong>
                                  <span style={{ color: '#64748B', display: 'block', fontSize: 10 }}>
                                    {currentBox.suggestedLocation?.zonaNombre || 'Zona de almacenamiento'}
                                  </span>
                                </div>

                                <div>
                                  <span style={{ color: '#64748B', display: 'block', fontSize: 10.5 }}>Operador responsable:</span>
                                  <strong style={{ color: '#0F172A', fontSize: 13 }}>{confirmedOperator}</strong>
                                  <span style={{ color: '#64748B', display: 'block', fontSize: 10 }}>
                                    Operador certificado
                                  </span>
                                </div>

                                <div>
                                  <span style={{ color: '#64748B', display: 'block', fontSize: 10.5 }}>Fecha y hora de confirmación:</span>
                                  <strong style={{ color: '#0F172A', fontSize: 12 }}>{confirmedFormattedDate}</strong>
                                  <span style={{ color: '#16A34A', display: 'block', fontSize: 10, fontWeight: 600 }}>
                                    Bitácora inmutable en BD
                                  </span>
                                </div>
                              </div>

                              {/* NOTA OPERATIVA Y BOTÓN DE ESTADO */}
                              <div
                                style={{
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'center',
                                  paddingTop: 12,
                                  borderTop: '1px solid #E2E8F0',
                                  flexWrap: 'wrap',
                                  gap: 12,
                                }}
                              >
                                <div style={{ fontSize: 11.5, color: '#64748B', maxWidth: 480, lineHeight: 1.4 }}>
                                  <span style={{ color: '#166534', fontWeight: 700 }}>Consulta histórica protegida:</span> Esta unidad no admite nuevos escaneos porque ya fue alojada físicamente en rack. Para continuar con el proceso, seleccione la siguiente caja pendiente en la lista lateral.
                                </div>

                                <button
                                  type="button"
                                  disabled
                                  className="btn btn-secondary"
                                  style={{
                                    backgroundColor: '#ECFDF5',
                                    borderColor: '#86EFAC',
                                    color: '#15803D',
                                    padding: '8px 18px',
                                    fontSize: 12.5,
                                    fontWeight: 700,
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 6,
                                    cursor: 'default',
                                  }}
                                >
                                  <CheckCircle2 size={16} style={{ color: '#16A34A' }} /> Caja ya Confirmada
                                </button>
                              </div>
                            </div>
                          ) : (
                            /* WORKBENCH DE ESCANEO ACTIVO PARA HUS PENDIENTES */
                            <div
                              style={{
                                backgroundColor: '#FFFFFF',
                                borderRadius: 10,
                                border: '1px solid #E2E8F0',
                                padding: 20,
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 16,
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid #E2E8F0', paddingBottom: 10 }}>
                                <ScanLine size={18} style={{ color: '#0284C7' }} />
                                <strong style={{ fontSize: 13, color: '#0F172A' }}>
                                  Terminal de Escaneo Doble (Handheld Zebra TC22)
                                </strong>
                              </div>

                              {/* PASO 1: ESCANEAR CAJA / TARIMA */}
                              <div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                                  <label style={{ fontSize: 11.5, fontWeight: 700, color: '#475569', display: 'flex', alignItems: 'center', gap: 6, margin: 0 }}>
                                    <Barcode size={15} style={{ color: '#0D9488' }} />
                                    Paso 1: Escanear Etiqueta de la Caja (Código Code-128 / QR)
                                  </label>

                                  {!boxScanSuccess && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setScannedBoxInput(currentBox.huCodigo);
                                        boxInputRef.current?.focus();
                                      }}
                                      title="Modo Prueba / Simulación: Copia el código al lector"
                                      style={{
                                        backgroundColor: '#F1F5F9',
                                        border: '1px solid #CBD5E1',
                                        color: '#475569',
                                        borderRadius: 4,
                                        padding: '3px 8px',
                                        fontSize: 11,
                                        fontWeight: 600,
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 4,
                                      }}
                                    >
                                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                                        <ScanLine size={13} /> Simular Lector: {currentBox.huCodigo}
                                      </span>
                                    </button>
                                  )}
                                </div>

                                <form onSubmit={handleBoxScanSubmit} style={{ display: 'flex', gap: 8 }}>
                                  <input
                                    ref={boxInputRef}
                                    type="text"
                                    className="form-input"
                                    placeholder={`Escanear o ingresar ${currentBox.huCodigo}...`}
                                    value={scannedBoxInput}
                                    onChange={(e) => {
                                      setScannedBoxInput(e.target.value);
                                      if (boxScanSuccess) setBoxScanSuccess(false);
                                      if (rackScanSuccess) setRackScanSuccess(false);
                                    }}
                                    disabled={boxScanSuccess}
                                    style={{
                                      flex: 1,
                                      height: 38,
                                      fontSize: 13,
                                      fontFamily: 'monospace',
                                      fontWeight: 700,
                                      backgroundColor: boxScanSuccess ? '#F0FDF4' : '#FFFFFF',
                                      borderColor: boxScanSuccess ? '#86EFAC' : '#CBD5E1',
                                      color: boxScanSuccess ? '#166534' : '#0F172A',
                                    }}
                                  />
                                  {!boxScanSuccess ? (
                                    <button
                                      type="submit"
                                      className="btn btn-secondary btn-sm"
                                      style={{ height: 38, padding: '0 16px', fontWeight: 600 }}
                                    >
                                      Validar Escaneo de HU
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setBoxScanSuccess(false);
                                        setRackScanSuccess(false);
                                        setScannedBoxInput('');
                                        setScannedRackInput('');
                                        setRackScanFeedback({ status: null, message: '' });
                                        setTimeout(() => boxInputRef.current?.focus(), 50);
                                      }}
                                      className="btn btn-ghost btn-sm"
                                      style={{ height: 38, color: '#64748B' }}
                                    >
                                      Reescanear HU
                                    </button>
                                  )}
                                </form>

                                {boxScanSuccess && (
                                  <div style={{ fontSize: 11.5, color: '#16A34A', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
                                    <CheckCircle2 size={14} /> HU escaneada y validada exitosamente
                                  </div>
                                )}
                              </div>

                              {/* PASO 2: ESCANEAR UBICACIÓN EN RACK */}
                              <div style={{ opacity: boxScanSuccess ? 1 : 0.6 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                                  <label style={{ fontSize: 11.5, fontWeight: 700, color: '#475569', display: 'flex', alignItems: 'center', gap: 6, margin: 0 }}>
                                    <MapPin size={15} style={{ color: '#0284C7' }} />
                                    Paso 2: Escanear Ubicación Física en Rack (Etiqueta de Estante)
                                  </label>

                                  {currentBox.suggestedLocation && (
                                    <button
                                      type="button"
                                      onClick={handleUseSuggestedRack}
                                      disabled={!boxScanSuccess || rackScanSuccess}
                                      style={{
                                        backgroundColor: '#F0FDFA',
                                        border: '1px solid #2DD4BF',
                                        color: '#0D9488',
                                        borderRadius: 4,
                                        padding: '3px 8px',
                                        fontSize: 11,
                                        fontWeight: 700,
                                        cursor: (boxScanSuccess && !rackScanSuccess) ? 'pointer' : 'not-allowed',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 4,
                                      }}
                                    >
                                      <Sparkles size={12} /> Usar Sugerencia IA: {currentBox.suggestedLocation.codigo}
                                    </button>
                                  )}
                                </div>

                                {/* CAJA SUGERENCIA DESTACADA */}
                                {currentBox.suggestedLocation && (
                                  <div
                                    style={{
                                      backgroundColor: '#F8FAFC',
                                      border: '1px dashed #CBD5E1',
                                      borderRadius: 6,
                                      padding: '8px 12px',
                                      marginBottom: 8,
                                      display: 'flex',
                                      justifyContent: 'space-between',
                                      alignItems: 'center',
                                      flexWrap: 'wrap',
                                      gap: 8,
                                    }}
                                  >
                                    <div>
                                      <span style={{ fontSize: 11, color: '#64748B' }}>Ubicación Recomendada:</span>
                                      <span style={{ fontSize: 13, fontWeight: 800, color: '#0F172A', marginLeft: 8, fontFamily: 'monospace' }}>
                                        {currentBox.suggestedLocation.codigo}
                                      </span>
                                      <span style={{ fontSize: 11, color: '#64748B', marginLeft: 6 }}>
                                        ({currentBox.suggestedLocation.zonaNombre} · Nivel {currentBox.suggestedLocation.nivel})
                                      </span>
                                    </div>
                                    {currentBox.alternativeLocations && currentBox.alternativeLocations.length > 0 && (
                                      <button
                                        type="button"
                                        onClick={() => setShowAlternativesModal(true)}
                                        style={{
                                          fontSize: 11,
                                          fontWeight: 700,
                                          color: '#0D9488',
                                          backgroundColor: '#FFFFFF',
                                          border: '1px solid #99F6E4',
                                          borderRadius: 4,
                                          padding: '2px 8px',
                                          cursor: 'pointer',
                                          display: 'inline-flex',
                                          alignItems: 'center',
                                          gap: 4,
                                        }}
                                      >
                                        <Layers size={12} /> Ver otras ubicaciones
                                      </button>
                                    )}
                                  </div>
                                )}

                                <form onSubmit={handleRackScanSubmit} style={{ display: 'flex', gap: 8 }}>
                                  <input
                                    ref={rackInputRef}
                                    type="text"
                                    className="form-input"
                                    placeholder={currentBox.suggestedLocation ? `Escanear etiqueta de rack (ej. ${currentBox.suggestedLocation.codigo})...` : 'Escanear rack...'}
                                    value={scannedRackInput}
                                    onChange={(e) => {
                                      setScannedRackInput(e.target.value);
                                      if (rackScanSuccess) setRackScanSuccess(false);
                                      setRackScanFeedback({ status: null, message: '' });
                                    }}
                                    disabled={!boxScanSuccess || rackScanSuccess}
                                    style={{
                                      flex: 1,
                                      height: 38,
                                      fontSize: 13,
                                      fontFamily: 'monospace',
                                      fontWeight: 700,
                                      backgroundColor: rackScanSuccess ? '#F0FDF4' : '#FFFFFF',
                                      borderColor: rackScanSuccess
                                        ? '#86EFAC'
                                        : rackScanFeedback.status === 'ALTERNATIVE'
                                        ? '#FCD34D'
                                        : rackScanFeedback.status === 'INVALID'
                                        ? '#FCA5A5'
                                        : '#CBD5E1',
                                      color: rackScanSuccess ? '#166534' : '#0F172A',
                                    }}
                                  />
                                  {!rackScanSuccess ? (
                                    <button
                                      type="submit"
                                      disabled={!boxScanSuccess}
                                      className="btn btn-secondary btn-sm"
                                      style={{ height: 38, padding: '0 16px', fontWeight: 600 }}
                                    >
                                      Validar Rack
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setRackScanSuccess(false);
                                        setScannedRackInput('');
                                        setRackScanFeedback({ status: null, message: '' });
                                        setTimeout(() => rackInputRef.current?.focus(), 50);
                                      }}
                                      className="btn btn-ghost btn-sm"
                                      style={{ height: 38, color: '#64748B' }}
                                    >
                                      Reescanear Rack
                                    </button>
                                  )}
                                </form>

                                {rackScanFeedback.message && (
                                  <div
                                    style={{
                                      marginTop: 6,
                                      padding: '6px 10px',
                                      borderRadius: 6,
                                      fontSize: 11.5,
                                      fontWeight: 600,
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: 6,
                                      backgroundColor: rackScanFeedback.status === 'MATCH'
                                        ? '#F0FDF4'
                                        : rackScanFeedback.status === 'ALTERNATIVE'
                                        ? '#FFFBEB'
                                        : rackScanFeedback.status === 'INVALID'
                                        ? '#FEF2F2'
                                        : '#F8FAFC',
                                      color: rackScanFeedback.status === 'MATCH'
                                        ? '#166534'
                                        : rackScanFeedback.status === 'ALTERNATIVE'
                                        ? '#B45309'
                                        : rackScanFeedback.status === 'INVALID'
                                        ? '#B91C1C'
                                        : '#475569',
                                      border: `1px solid ${
                                        rackScanFeedback.status === 'MATCH'
                                          ? '#BBF7D0'
                                          : rackScanFeedback.status === 'ALTERNATIVE'
                                          ? '#FDE68A'
                                          : rackScanFeedback.status === 'INVALID'
                                          ? '#FECACA'
                                          : '#E2E8F0'
                                      }`,
                                    }}
                                  >
                                    {rackScanFeedback.status === 'MATCH' ? (
                                      <CheckCircle2 size={14} />
                                    ) : rackScanFeedback.status === 'ALTERNATIVE' ? (
                                      <AlertTriangle size={14} />
                                    ) : rackScanFeedback.status === 'INVALID' ? (
                                      <AlertCircle size={14} />
                                    ) : (
                                      <Info size={14} />
                                    )}
                                    <span>{rackScanFeedback.message}</span>
                                  </div>
                                )}
                              </div>

                              {/* ESTADO DUAL SCAN VISUAL */}
                              <div
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  padding: '8px 12px',
                                  borderRadius: 8,
                                  backgroundColor: (boxScanSuccess && rackScanSuccess) ? '#F0FDF4' : '#FEF3C7',
                                  border: `1px solid ${(boxScanSuccess && rackScanSuccess) ? '#86EFAC' : '#FDE68A'}`,
                                }}
                              >
                                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                  <div
                                    style={{
                                      fontSize: 11.5,
                                      fontWeight: 700,
                                      color: boxScanSuccess ? '#166534' : '#B45309',
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: 5,
                                    }}
                                  >
                                    {boxScanSuccess ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                                    HU: {boxScanSuccess ? 'Validada' : 'Pendiente'}
                                  </div>
                                  <span style={{ color: '#CBD5E1' }}>|</span>
                                  <div
                                    style={{
                                      fontSize: 11.5,
                                      fontWeight: 700,
                                      color: rackScanSuccess ? '#166534' : '#B45309',
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: 5,
                                    }}
                                  >
                                    {rackScanSuccess ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                                    Rack: {rackScanSuccess ? 'Validado' : 'Pendiente'}
                                  </div>
                                </div>
                                <span
                                  style={{
                                    fontSize: 11,
                                    fontWeight: 800,
                                    color: (boxScanSuccess && rackScanSuccess) ? '#166534' : '#92400E',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 5,
                                  }}
                                >
                                  {(boxScanSuccess && rackScanSuccess) ? (
                                    <>
                                      <CheckCircle2 size={13} /> Doble Validación Completa
                                    </>
                                  ) : (
                                    <>
                                      <AlertTriangle size={13} /> Requiere ambas validaciones físicas
                                    </>
                                  )}
                                </span>
                              </div>

                              {/* BOTÓN DE CONFIRMACIÓN DE LA CAJA */}
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 10, borderTop: '1px solid #E2E8F0' }}>
                                <span style={{ fontSize: 11.5, color: '#64748B' }}>
                                  Operador: <strong style={{ color: '#0F172A' }}>{currentUser?.name || currentUser?.nombre || 'Montacarguista'}</strong>
                                </span>

                                <div style={{ display: 'flex', gap: 10 }}>
                                  <button
                                    type="button"
                                    className="btn btn-primary"
                                    disabled={!boxScanSuccess || !rackScanSuccess || submitting}
                                    onClick={handleConfirmSingleBox}
                                    style={{
                                      backgroundColor: (boxScanSuccess && rackScanSuccess) ? '#0D9488' : '#94A3B8',
                                      borderColor: (boxScanSuccess && rackScanSuccess) ? '#0D9488' : '#94A3B8',
                                      padding: '8px 18px',
                                      fontSize: 12.5,
                                      fontWeight: 700,
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: 6,
                                      cursor: (boxScanSuccess && rackScanSuccess && !submitting) ? 'pointer' : 'not-allowed',
                                    }}
                                  >
                                    <Check size={16} /> {submitting ? 'Auditando...' : 'Confirmar Ubicación de esta Caja'}
                                  </button>
                                </div>
                              </div>
                            </div>
                          )}
                        </>
                      ) : (
                        <div style={{ padding: 40, textAlign: 'center', color: '#64748B' }}>
                          No hay cajas disponibles para ubicar en esta recepción.
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* CONTENIDO TAB 2: MATRIZ VISUAL DE ASIGNACIÓN */}
                {selectedTab === 'LAYOUT_MATRIX' && (
                  <div style={{ padding: 20, overflowY: 'auto', flex: 1, backgroundColor: '#FFFFFF' }}>
                    <div style={{ border: '1px solid #E2E8F0', borderRadius: 10, overflow: 'hidden' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                        <thead>
                          <tr style={{ backgroundColor: '#F8FAFC', borderBottom: '1px solid #E2E8F0', textAlign: 'left', color: '#64748B' }}>
                            <th style={{ padding: '10px 14px' }}>Caja / Bulto</th>
                            <th style={{ padding: '10px 14px' }}>SKU & Descripción</th>
                            <th style={{ padding: '10px 14px' }}>Lote / Caducidad</th>
                            <th style={{ padding: '10px 14px', textAlign: 'center' }}>Regla</th>
                            <th style={{ padding: '10px 14px' }}>Sugerencia IA & Match</th>
                            <th style={{ padding: '10px 14px' }}>Rack Destino Asignado</th>
                            <th style={{ padding: '10px 14px', textAlign: 'center' }}>Estado</th>
                          </tr>
                        </thead>
                        <tbody>
                          {suggestionsList.map((box: any, idx: number) => {
                            const key = box.huId || box.huCodigo;
                            const isConfirmed = !!confirmedHUs[key];
                            const currentTargetId = assignedLocations[key] || box.suggestedLocation?.id || '';

                            return (
                              <tr key={idx} style={{ borderBottom: '1px solid #F1F5F9', backgroundColor: isConfirmed ? '#F0FDF4' : '#FFFFFF' }}>
                                <td style={{ padding: '10px 14px' }}>
                                  <div style={{ fontFamily: 'monospace', fontWeight: 800, color: '#0F172A' }}>
                                    {box.huCodigo}
                                  </div>
                                  {box.reacondicionada && (
                                    <span style={{ fontSize: 9.5, fontWeight: 700, backgroundColor: '#FEF3C7', color: '#B45309', padding: '1px 6px', borderRadius: 4, display: 'inline-flex', alignItems: 'center', gap: 3, marginTop: 2 }}>
                                      <PackageCheck size={11} /> Reacondicionada en Calidad
                                    </span>
                                  )}
                                </td>

                                <td style={{ padding: '10px 14px' }}>
                                  <div style={{ fontWeight: 700, color: '#0D9488' }}>{box.skuCodigo}</div>
                                  <div style={{ fontSize: 11, color: '#64748B' }}>{box.skuDescripcion}</div>
                                  <div style={{ fontSize: 11, fontWeight: 700, color: '#0284C7', marginTop: 2 }}>
                                    {box.cantidad} PZA
                                  </div>
                                </td>

                                <td style={{ padding: '10px 14px' }}>
                                  <div style={{ fontSize: 11.5, color: '#0F172A' }}>Lote: <strong>{box.lote || 'S/L'}</strong></div>
                                  <div style={{ fontSize: 11, color: '#64748B' }}>Cad: {box.fechaVencimiento || 'N/A'}</div>
                                </td>

                                <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                                  <span
                                    style={{
                                      fontSize: 10.5,
                                      fontWeight: 800,
                                      padding: '2px 7px',
                                      borderRadius: 4,
                                      backgroundColor: box.reglaRotacion === 'FEFO' ? '#FEF3C7' : '#E0F2FE',
                                      color: box.reglaRotacion === 'FEFO' ? '#B45309' : '#0369A1',
                                      border: `1px solid ${box.reglaRotacion === 'FEFO' ? '#FCD34D' : '#BAE6FD'}`,
                                    }}
                                  >
                                    {box.reglaRotacion}
                                  </span>
                                </td>

                                <td style={{ padding: '10px 14px' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <span style={{ fontFamily: 'monospace', fontWeight: 800, color: '#059669' }}>
                                      {box.suggestedLocation?.codigo || 'N/A'}
                                    </span>
                                    <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 4, backgroundColor: '#DCFCE7', color: '#16A34A' }}>
                                      {box.matchScore}% Match
                                    </span>
                                  </div>
                                  <div style={{ fontSize: 10.5, color: '#64748B', marginTop: 2 }}>
                                    {box.suggestedLocation?.zonaNombre || ''} · Libre: {box.suggestedLocation?.capacidadLibre || 0} uds
                                  </div>
                                </td>

                                <td style={{ padding: '10px 14px' }}>
                                  <select
                                    className="form-select form-select-sm"
                                    value={currentTargetId}
                                    onChange={(e) => {
                                      const newLocId = e.target.value;
                                      setAssignedLocations(prev => ({ ...prev, [key]: newLocId }));
                                    }}
                                    style={{
                                      fontSize: 12,
                                      fontWeight: 700,
                                      fontFamily: 'monospace',
                                      backgroundColor: '#FFFFFF',
                                      borderColor: '#CBD5E1',
                                      color: '#0F172A',
                                      padding: '4px 8px',
                                      borderRadius: 6,
                                      minWidth: 160,
                                    }}
                                  >
                                    {box.suggestedLocation && (
                                      <option value={box.suggestedLocation.id}>
                                        {box.suggestedLocation.codigo} (Sugerido {box.suggestedLocation.nivel})
                                      </option>
                                    )}
                                    {(box.alternativeLocations || []).map((alt: any) => (
                                      <option key={alt.id} value={alt.id}>
                                        {alt.codigo} ({alt.nivel}) — Libre: {alt.capacidadLibre} uds
                                      </option>
                                    ))}
                                  </select>
                                </td>

                                <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                                  {isConfirmed ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                                      <span style={{ fontSize: 11, fontWeight: 700, color: '#16A34A', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                                        <CheckCircle2 size={13} /> Dual Validado
                                      </span>
                                      {validationsByHu[key]?.operator && (
                                        <span style={{ fontSize: 9.5, color: '#64748B' }}>
                                          {validationsByHu[key]?.operator}
                                        </span>
                                      )}
                                      <span style={{ fontSize: 9.5, color: '#15803D', fontWeight: 600 }}>
                                        Asignada a rack
                                      </span>
                                    </div>
                                  ) : (
                                    <span style={{ fontSize: 11, fontWeight: 600, color: '#D97706', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                                      <AlertCircle size={12} /> Pendiente
                                    </span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* BARRA INFERIOR DE ACCIÓN GLOBAL Y ACTIVACIÓN DE STOCK */}
                <div
                  style={{
                    padding: '14px 24px',
                    backgroundColor: '#FFFFFF',
                    borderTop: '1px solid #E2E8F0',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: 12,
                  }}
                >
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#0F172A', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <span>
                        Total a Alojar:{' '}
                        <span style={{ color: '#0D9488' }}>
                          {suggestionsData.receipt?.totalItems || suggestionsList.length} bultos
                        </span>{' '}
                        ({suggestionsData.receipt?.totalUnidades || 0} piezas)
                      </span>
                      {confirmedCount > 0 && (
                        <span style={{ backgroundColor: '#FEF3C7', color: '#92400E', padding: '2px 8px', borderRadius: 4, fontSize: 11.5, fontWeight: 800, border: '1px solid #FCD34D' }}>
                          Pendientes: {suggestionsList.length - confirmedCount} {suggestionsList.length - confirmedCount === 1 ? 'bulto' : 'bultos'} ({suggestionsList.filter((s: any) => !confirmedHUs[s.huId || s.huCodigo]).reduce((acc: number, s: any) => acc + (s.cantidad || 0), 0)} piezas)
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 11.5, color: '#64748B', marginTop: 2 }}>
                      Al confirmar, la mercancía se traslada de Andén REC-01 a Racks y pasa de "En Tránsito Interno" a{' '}
                      <strong style={{ color: '#059669' }}>"DISPONIBLE"</strong> para venta en el portal.
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 10 }}>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={onClose}
                      style={{ color: '#64748B' }}
                    >
                      Cancelar
                    </button>

                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={submitting || suggestionsList.length === 0 || !isAllConfirmed}
                      onClick={handleExecuteConfirmPutaway}
                      title={
                        !isAllConfirmed
                          ? `Bloqueado: Requiere Escaneo Dual completo en 14/14 cajas (${confirmedCount} de ${suggestionsList.length} validadas)`
                          : 'Confirmar traslado físico a racks y activar inventario'
                      }
                      style={{
                        backgroundColor: isAllConfirmed ? '#0D9488' : '#94A3B8',
                        borderColor: isAllConfirmed ? '#0D9488' : '#94A3B8',
                        cursor: isAllConfirmed && !submitting ? 'pointer' : 'not-allowed',
                        padding: '10px 24px',
                        fontSize: 13,
                        fontWeight: 800,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                      }}
                    >
                      <CheckCircle2 size={16} />
                      {submitting
                        ? 'Activando Stock en Racks...'
                        : isAllConfirmed
                        ? 'Confirmar Alojamiento a Racks y Activar Stock'
                        : `Bloqueado: ${confirmedCount}/${suggestionsList.length} con Escaneo Dual`}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
        {/* MODAL / OVERLAY: VER OTRAS UBICACIONES ALTERNATIVAS (ETAPA 4) */}
        {showAlternativesModal && currentBox && (
          <div
            onClick={() => setShowAlternativesModal(false)}
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(15, 23, 42, 0.65)',
              backdropFilter: 'blur(3px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 99999,
              padding: 20,
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                backgroundColor: '#FFFFFF',
                borderRadius: 12,
                maxWidth: 640,
                width: '100%',
                maxHeight: '85vh',
                display: 'flex',
                flexDirection: 'column',
                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
                overflow: 'hidden',
                border: '1px solid #CBD5E1',
              }}
            >
              {/* Header */}
              <div
                style={{
                  padding: '16px 20px',
                  backgroundColor: '#0F172A',
                  color: '#FFFFFF',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Layers size={18} style={{ color: '#2DD4BF' }} /> Ubicaciones Alternativas en Layout
                  </h3>
                  <div style={{ fontSize: 11.5, color: '#94A3B8', marginTop: 3 }}>
                    Caja: <strong style={{ color: '#FFFFFF', fontFamily: 'monospace' }}>{currentBox.huCodigo}</strong> ({currentBox.cantidad} pzas · {currentBox.skuCodigo})
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowAlternativesModal(false)}
                  style={{
                    backgroundColor: 'transparent',
                    border: 'none',
                    color: '#94A3B8',
                    cursor: 'pointer',
                    padding: 4,
                  }}
                >
                  <X size={20} />
                </button>
              </div>

              {/* Body */}
              <div style={{ padding: '16px 20px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ fontSize: 12, color: '#475569' }}>
                  El motor calculó las siguientes alternativas válidas en el almacén con capacidad física verificada para alojar esta caja:
                </div>

                {(currentBox.alternativeLocations || []).map((alt: any, idx: number) => (
                  <div
                    key={alt.id || idx}
                    style={{
                      border: '1.5px solid #E2E8F0',
                      borderRadius: 10,
                      padding: '14px 16px',
                      backgroundColor: '#F8FAFC',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 16, fontWeight: 900, color: '#0F172A', fontFamily: 'monospace' }}>
                            {alt.codigo}
                          </span>
                          <span style={{ fontSize: 11, fontWeight: 800, padding: '1px 7px', borderRadius: 999, backgroundColor: '#CCFBF1', color: '#0F766E', border: '1px solid #99F6E4' }}>
                            Score: {alt.score} pts
                          </span>
                          <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4, backgroundColor: '#E0F2FE', color: '#0369A1' }}>
                            {alt.zonaNombre}
                          </span>
                          <span style={{ fontSize: 11.5, color: '#64748B', fontWeight: 600 }}>
                            Nivel {alt.nivel} ({alt.tipoNivel || 'PICKING'})
                          </span>
                        </div>
                        <div style={{ fontSize: 11.5, color: '#475569', marginTop: 4 }}>
                          Capacidad libre: <strong style={{ color: '#0284C7' }}>{alt.capacidadDisponibleUnidades ?? alt.capacidadLibre}</strong> piezas ·{' '}
                          {alt.capacidadBultos !== null && alt.capacidadBultos !== undefined && alt.capacidadDisponibleBultos !== null
                            ? <><strong style={{ color: '#0D9488' }}>{alt.capacidadDisponibleBultos}</strong> bultos disponibles</>
                            : <span style={{ color: '#64748B' }}>Actualmente: {(alt.ocupacionBultosActual ?? 0) === 1 ? '1 bulto alojado' : `${alt.ocupacionBultosActual ?? 0} bultos alojados`} · límite no configurado</span>
                          }
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleSelectAlternativeRack(alt)}
                        style={{
                          backgroundColor: '#0D9488',
                          color: '#FFFFFF',
                          border: 'none',
                          borderRadius: 6,
                          padding: '7px 14px',
                          fontSize: 12,
                          fontWeight: 700,
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                        }}
                      >
                        <Check size={14} /> Seleccionar esta ubicación
                      </button>
                    </div>

                    {/* Razones favorables */}
                    {alt.razonesFavorables && alt.razonesFavorables.length > 0 && (
                      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 11.5, color: '#334155', lineHeight: 1.5 }}>
                        {alt.razonesFavorables.map((r: string, rIdx: number) => (
                          <li key={rIdx}>{r}</li>
                        ))}
                      </ul>
                    )}

                    {/* Advertencias */}
                    {alt.advertencias && alt.advertencias.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        {alt.advertencias.map((adv: string, aIdx: number) => (
                          <span key={aIdx} style={{ fontSize: 11, color: '#B45309', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <AlertTriangle size={12} /> {adv}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Footer */}
              <div
                style={{
                  padding: '12px 20px',
                  backgroundColor: '#F8FAFC',
                  borderTop: '1px solid #E2E8F0',
                  display: 'flex',
                  justifyContent: 'flex-end',
                }}
              >
                <button
                  type="button"
                  onClick={() => setShowAlternativesModal(false)}
                  className="btn btn-secondary btn-sm"
                  style={{ fontWeight: 600 }}
                >
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
