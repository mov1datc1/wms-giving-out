import React, { useState, useEffect, useRef } from 'react';
import {
  Tag, QrCode, Layers, Box, Check, Printer, RefreshCw,
  AlertCircle, CheckCircle2, Clock, MapPin, X, Eye,
  ShieldCheck, ArrowRight, UserCheck, AlertTriangle, FileSpreadsheet,
  PackageCheck, HelpCircle, Sparkles
} from 'lucide-react';
import JsBarcode from 'jsbarcode';
import QRCode from 'qrcode';
import { API } from '../config/api';
import { formatCalendarDate } from '../utils/dateUtils';

interface LineBreakdown {
  receiptLineId: string;
  skuCodigo: string;
  skuDescripcion: string;
  lote: string;
  fechaVencimiento: string;
  piezasPorCaja: number;
  cajasEsperadas: number;
  cajasConformes: number | string;
  cajasDanadas: number | string;
  cajasSanasNuevas?: number;
  cajasRescatadasExistentes?: number;
  cajasSanasExistentes?: number;
  cajasFaltantes?: number;
  cajasDanadasHistoricas?: number;
}

interface DualLabelModalProps {
  receipt: any;
  token?: string;
  currentUser?: { nombre?: string; rolNombre?: string | null; name?: string; role?: string } | any;
  onClose: () => void;
  onSuccess?: () => void;
}

/**
 * Normaliza cadenas de texto para cotejo exacto (SKU, Lote, Fechas)
 */
const normText = (v?: any): string => (v !== undefined && v !== null ? String(v).trim().toUpperCase() : '');
const normDateOnly = (d?: any): string => (d ? String(d).trim().slice(0, 10) : '');

/**
 * Resuelve la línea de recepción (ReceiptLine) asociada a una Handling Unit.
 * Prioridad:
 * 1. receiptLineId exacto persistido (si existe en las líneas de la recepción).
 * 2. Si no existe receiptLineId: SKU + Lote normalizado + Caducidad (cuando aplique).
 * Regla estricta: NUNCA asociar una HU a una línea únicamente por SKU si existen múltiples líneas posibles con ese SKU.
 */
export const findMatchingReceiptLine = (hu: any, lineas: any[]): any | null => {
  if (!lineas || lineas.length === 0) return null;

  // 1. Prioridad estricta: receiptLineId exacto persistido
  if (hu?.receiptLineId) {
    const directMatch = lineas.find((l: any) => l.id === hu.receiptLineId);
    if (directMatch) return directMatch;
  }

  // Si no hay SKU en la HU, no se puede continuar
  const huSku = normText(hu?.skuCodigo || hu?.sku?.codigo);
  if (!huSku) return null;

  // Candidatas que comparten el SKU
  const skuCandidates = lineas.filter((l: any) => normText(l.sku?.codigo || l.skuCodigo) === huSku);
  if (skuCandidates.length === 0) return null;

  const huLote = normText(hu?.loteTexto || hu?.lote?.codigo || hu?.loteCodigo);
  const huVenc = normDateOnly(hu?.fechaVencimiento || hu?.lote?.fechaVencimiento);

  // 2. Si hay exactamente 1 línea con este SKU en toda la recepción:
  if (skuCandidates.length === 1) {
    const singleCandidate = skuCandidates[0];
    const candLote = normText(singleCandidate.loteAsignado || singleCandidate.loteEsperado || singleCandidate.loteTexto);
    // Si la HU tiene lote y la línea tiene lote, solo asociar si coinciden
    if (huLote && candLote && huLote !== candLote) {
      return null;
    }
    return singleCandidate;
  }

  // 3. Si hay múltiples líneas del mismo SKU (p.ej. ACE-OLI-1L en VAL1 y VAL2):
  // NUNCA asociar arbitrariamente por solo SKU. Requiere discriminación estricta por Lote normalizado.
  if (!huLote) {
    return null;
  }

  const lotCandidates = skuCandidates.filter((l: any) => {
    const candLote = normText(l.loteAsignado || l.loteEsperado || l.loteTexto);
    return candLote === huLote;
  });

  if (lotCandidates.length === 1) {
    return lotCandidates[0];
  }

  // Si aún hay múltiples líneas del mismo SKU e idéntico lote, desempatar por fecha de vencimiento
  if (lotCandidates.length > 1 && huVenc) {
    const dateCandidates = lotCandidates.filter((l: any) => normDateOnly(l.fechaVencimiento) === huVenc);
    if (dateCandidates.length === 1) {
      return dateCandidates[0];
    }
  }

  // Si persiste ambigüedad, no asociar arbitrariamente
  return null;
};

/**
 * Determina la capacidad estándar de empaque (packSize / piezas nominales por caja).
 * Proviene exclusivamente de:
 * 1. ReceiptLine asociada (line.sku.capacidadEmpaque, line.piezasPorCaja)
 * 2. Catálogo SKU de la HU (hu.sku.capacidadEmpaque, hu.lote.sku.capacidadEmpaque)
 * 3. Atributo piezasPorCaja de la propia HU (para cajas estándar sanas no reacondicionadas)
 * Si no existe capacidad válida en ninguna fuente, retorna null (dato faltante explícito, sin hardcoding).
 */
export const resolvePackagingCapacity = (hu: any, matchingLine?: any | null): number | null => {
  const isReacondicionada = Boolean(hu?.reacondicionada || hu?.cajaOrigenId);

  const candidates = [
    matchingLine?.sku?.capacidadEmpaque,
    matchingLine?.piezasPorCaja,
    hu?.sku?.capacidadEmpaque,
    hu?.lote?.sku?.capacidadEmpaque,
    !isReacondicionada ? hu?.piezasPorCaja : null,
  ];

  for (const c of candidates) {
    const num = Number(c);
    if (!isNaN(num) && num > 0) {
      return num;
    }
  }

  return null;
};

/**
 * Verifica si una HU tiene condición de daño.
 * La fuente principal es el estado persistido en base de datos (estadoHu, motivoDano).
 * La comprobación de includes('DANO') actúa únicamente como compatibilidad histórica secundaria.
 */
export const isHuDamaged = (hu: any): boolean => {
  if (!hu) return false;
  if (hu.estadoHu === 'DAÑADO' || hu.estadoHu === 'RETENIDO' || Boolean(hu.motivoDano)) {
    return true;
  }
  // Compatibilidad histórica secundaria controlada
  return Boolean(hu.codigo && typeof hu.codigo === 'string' && hu.codigo.includes('DANO'));
};

export function DualLabelModal({
  receipt,
  token,
  currentUser,
  onClose,
  onSuccess
}: DualLabelModalProps) {
  const [activeTab, setActiveTab] = useState<'PALLETS' | 'BOXES'>('PALLETS');
  const [loading, setLoading] = useState<boolean>(true);
  const [generating, setGenerating] = useState<boolean>(false);
  const [printing, setPrinting] = useState<boolean>(false);
  const [confirming, setConfirming] = useState<boolean>(false);
  const [labelsData, setLabelsData] = useState<any>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Estado para distinguir solicitud de impresión física de confirmación del operador
  const [pendingPrintConfirm, setPendingPrintConfirm] = useState<{
    tipo: 'PALLETS' | 'CAJAS' | 'TODAS';
    huIds?: string[];
    description: string;
    totalEtiquetas: number;
  } | null>(null);
  const [confirmingPrint, setConfirmingPrint] = useState<boolean>(false);

  // Clasificación física de cajas por partida
  const [breakdown, setBreakdown] = useState<LineBreakdown[]>([]);

  // Filtros y selección de cajas a imprimir
  const [selectedPalletFilter, setSelectedPalletFilter] = useState<string>('ALL');
  const [selectedBoxIds, setSelectedBoxIds] = useState<string[]>([]);
  const [qrCodeUrls, setQrCodeUrls] = useState<Record<string, string>>({});

  // Nombre de colocador
  const [colocadorNombre, setColocadorNombre] = useState<string>(
    currentUser?.nombre || currentUser?.name || 'Operador de Andén'
  );

  // Función general para construir el desglose físico por partida integrando conciliación persistida y HUs de Calidad
  const computeBreakdownForLines = (lineas: any[], handlingUnits: any[]): LineBreakdown[] => {
    return (lineas || []).map((line: any) => {
      const sku = line.sku || {};
      const resolvedPack = resolvePackagingCapacity({ sku }, line);
      const packSize = resolvedPack !== null ? resolvedPack : (Number(line.piezasPorCaja) > 0 ? Number(line.piezasPorCaja) : 0);
      const expectedBoxes = line.uom === 'CAJA' ? Math.round(line.cantidadEsperada || 1) : (packSize > 0 ? Math.ceil((line.cantidadEsperada || 1) / packSize) : Math.round(line.cantidadEsperada || 1));

      // Vincular HUs de la línea respetando receiptLineId prioritario y SKU + Lote normalizado
      const lineBoxes = (handlingUnits || []).filter((h: any) => {
        if (h.tipoHu !== 'CAJA') return false;
        const matched = findMatchingReceiptLine(h, lineas);
        return matched?.id === line.id;
      });

      // 1. HUs conformes/reacondicionadas ya creadas por Calidad (stock activo con ID preexistente)
      const rescuedBoxes = lineBoxes.filter(
        (b: any) => b.estadoHu === 'ACTIVO' && (b.reacondicionada || b.cajaOrigenId)
      );
      const rescuedPieces = rescuedBoxes.reduce((s: number, b: any) => s + (Number(b.cantidad) || 0), 0);
      const cajasRescatadasExistentes = rescuedBoxes.length;

      // 2. Cajas sanas estándar que ya fueron generadas previamente en andén
      const existingHealthyBoxes = lineBoxes.filter(
        (b: any) => b.estadoHu === 'ACTIVO' && !b.reacondicionada && !b.cajaOrigenId && !isHuDamaged(b)
      );
      const cajasSanasExistentes = existingHealthyBoxes.length;

      // 3. HUs dañadas originales históricas/inactivas (no operativas, no se reactivan ni se etiquetan)
      const existingDamagedBoxes = lineBoxes.filter(
        (b: any) => b.estadoHu === 'DAÑADO' || b.estadoHu === 'INACTIVO' || isHuDamaged(b)
      );
      const cajasDanadasHistoricas = existingDamagedBoxes.length;

      // Conciliación física persistida en andén (cantidadRecibida = conformes totales: sanas + rescatadas)
      const totalConformesPiezas = receipt.conteoAndenEstado === 'COMPLETADO'
        ? Number(line.cantidadRecibida || 0)
        : (Number(line.cantidadRecibida) > 0
            ? Math.max(Number(line.cantidadRecibida), Number(line.cantidadEsperada || 0) - Number(line.cantidadDanada || 0))
            : Math.max(0, Number(line.cantidadEsperada || 0) - Number(line.cantidadDanada || 0)));
      const totalDanadasPiezas = Number(line.cantidadDanada || 0);

      // Cajas sanas conciliadas en andén que todavía necesitan materializarse como HUs
      const piezasSanasAnden = Math.max(0, totalConformesPiezas - rescuedPieces);
      const cajasSanasAnden = packSize > 0 ? Math.floor(piezasSanasAnden / packSize) : 0;
      const cajasSanasNuevas = Math.max(0, cajasSanasAnden - cajasSanasExistentes);

      // Total físico conforme activo = sanas andén + reacondicionadas de calidad
      const cajasConformesTotales = (cajasSanasExistentes > 0 ? cajasSanasExistentes + cajasSanasNuevas : cajasSanasAnden) + cajasRescatadasExistentes;

      // Cajas faltantes confirmadas (NO generan HU ni etiqueta)
      const totalAccountedPieces = totalConformesPiezas + totalDanadasPiezas;
      const diffPieces = Math.max(0, Number(line.cantidadEsperada || 0) - totalAccountedPieces);
      const cajasFaltantes = packSize > 0 ? Math.round(diffPieces / packSize) : 0;

      // Cajas dañadas externas operativas (0 si ya fueron dictaminadas en Calidad)
      const cajasDanadasOperativas = Math.max(0, (packSize > 0 ? Math.floor(totalDanadasPiezas / packSize) : 0) - cajasDanadasHistoricas);

      return {
        receiptLineId: line.id,
        skuCodigo: sku.codigo || 'SKU',
        skuDescripcion: sku.descripcion || 'Producto',
        lote: line.loteAsignado || line.loteEsperado || 'S/LOTE',
        fechaVencimiento: line.fechaVencimiento ? String(line.fechaVencimiento).slice(0, 10) : (line.fechaCaducidadEsperada ? String(line.fechaCaducidadEsperada).slice(0, 10) : ''),
        piezasPorCaja: packSize,
        cajasEsperadas: expectedBoxes,
        cajasConformes: cajasConformesTotales,
        cajasDanadas: cajasDanadasOperativas,
        cajasSanasNuevas,
        cajasRescatadasExistentes,
        cajasSanasExistentes,
        cajasFaltantes,
        cajasDanadasHistoricas,
      };
    });
  };

  // Inicializar desglose de cajas por línea a partir de la conciliación persistida y HUs de Calidad
  useEffect(() => {
    if (!receipt?.lineas || receipt.lineas.length === 0) return;
    setBreakdown(computeBreakdownForLines(receipt.lineas, receipt.handlingUnits || []));
  }, [receipt]);

  // Cargar etiquetas existentes y sincronizar desglose
  const fetchLabels = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`${API}/receipts/${receipt.id}/labels`, { headers });
      if (res.ok) {
        const data = await res.json();
        setLabelsData(data);

        // Integrar HUs devueltas por el endpoint con las HUs ya presentes en el receipt
        const allHUsMap = new Map<string, any>();
        (receipt.handlingUnits || []).forEach((h: any) => allHUsMap.set(h.id || h.codigo, h));
        (data.cajas || data.boxes || []).forEach((h: any) => allHUsMap.set(h.id || h.codigo, h));
        const allHUs = Array.from(allHUsMap.values());

        if (receipt?.lineas && receipt.lineas.length > 0) {
          setBreakdown(computeBreakdownForLines(receipt.lineas, allHUs));
        }
      } else {
        const err = await res.json();
        setErrorMsg(err.message || 'Error al cargar etiquetas');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Error de conexión');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLabels();
  }, [receipt.id]);

  // Generar URLs de QR para los pallets
  useEffect(() => {
    if (!labelsData?.pallets) return;

    const generateQrs = async () => {
      const newUrls: Record<string, string> = {};
      for (const plt of labelsData.pallets) {
        try {
          const payloadStr = typeof plt.qrPayload === 'string' ? plt.qrPayload : JSON.stringify(plt.qrPayload);
          const dataUrl = await QRCode.toDataURL(payloadStr, {
            width: 140,
            margin: 1,
            color: {
              dark: '#0F172A',
              light: '#FFFFFF',
            },
          });
          newUrls[plt.id] = dataUrl;
        } catch (e) {
          console.warn('Error generating QR:', e);
        }
      }
      setQrCodeUrls(newUrls);
    };

    generateQrs();
  }, [labelsData]);

  // Manejador seguro para campos de cajas que permite vaciar mientras se escribe (solución al cero inicial "01")
  const handleBreakdownInputChange = (
    lineId: string,
    field: 'cajasConformes' | 'cajasDanadas',
    raw: string
  ) => {
    if (raw === '') {
      setBreakdown(prev => prev.map(item => item.receiptLineId === lineId ? { ...item, [field]: '' } : item));
      return;
    }
    const digitsOnly = raw.replace(/\D/g, '');
    if (digitsOnly === '') {
      setBreakdown(prev => prev.map(item => item.receiptLineId === lineId ? { ...item, [field]: '' } : item));
      return;
    }
    const parsed = parseInt(digitsOnly, 10);
    setBreakdown(prev => prev.map(item => {
      if (item.receiptLineId !== lineId) return item;
      const val = isNaN(parsed) ? '' : parsed;
      const numVal = typeof val === 'number' ? val : 0;
      const confVal = field === 'cajasConformes' ? numVal : (Number(item.cajasConformes) || 0);
      const danVal = field === 'cajasDanadas' ? numVal : (Number(item.cajasDanadas) || 0);
      return {
        ...item,
        [field]: val,
        cajasSanasNuevas: Math.max(0, confVal - (item.cajasRescatadasExistentes || 0) - (item.cajasSanasExistentes || 0)),
        cajasFaltantes: Math.max(0, item.cajasEsperadas - confVal - danVal),
      };
    }));
  };

  const handleBreakdownInputBlur = (
    lineId: string,
    field: 'cajasConformes' | 'cajasDanadas'
  ) => {
    setBreakdown(prev => prev.map(item => {
      if (item.receiptLineId !== lineId) return item;
      const val = item[field];
      const finalVal = (val === '' || isNaN(Number(val))) ? 0 : Number(val);
      const confVal = field === 'cajasConformes' ? finalVal : (Number(item.cajasConformes) || 0);
      const danVal = field === 'cajasDanadas' ? finalVal : (Number(item.cajasDanadas) || 0);
      return {
        ...item,
        [field]: finalVal,
        cajasSanasNuevas: Math.max(0, confVal - (item.cajasRescatadasExistentes || 0) - (item.cajasSanasExistentes || 0)),
        cajasFaltantes: Math.max(0, item.cajasEsperadas - confVal - danVal),
      };
    }));
  };

  // Totales calculados en el desglose
  const totalConformesConfiguradas = breakdown.reduce((sum, b) => sum + (Number(b.cajasConformes) || 0), 0);
  const totalDanadasConfiguradas = breakdown.reduce((sum, b) => sum + (Number(b.cajasDanadas) || 0), 0);
  const totalFisicasConfiguradas = totalConformesConfiguradas + totalDanadasConfiguradas;
  const totalEsperadasPrevio = breakdown.reduce((sum, b) => sum + (Number(b.cajasEsperadas) || 0), 0);
  const totalFaltantesConfiguradas = breakdown.reduce((sum, b) => sum + (Number(b.cajasFaltantes ?? Math.max(0, b.cajasEsperadas - (Number(b.cajasConformes) || 0) - (Number(b.cajasDanadas) || 0))) || 0), 0);
  const totalNuevasCrear = breakdown.reduce((sum, b) => sum + (Number(b.cajasSanasNuevas) || 0), 0);
  const totalRescatadasExistentes = breakdown.reduce((sum, b) => sum + (Number(b.cajasRescatadasExistentes) || 0), 0);
  const totalDanadasHistoricas = breakdown.reduce((sum, b) => sum + (Number(b.cajasDanadasHistoricas) || 0), 0);
  const totalSanasExistentes = breakdown.reduce((sum, b) => sum + (Number(b.cajasSanasExistentes) || 0), 0);

  // Separación conceptual estricta:
  // - "Pendientes por generar": totalNuevasCrear (0 una vez que ya se generaron las HUs)
  // - "HUs físicas existentes / composición actual": se reconstruye desde las HUs generadas/existentes
  const totalSanasGeneradasExistentes = totalSanasExistentes > 0
    ? totalSanasExistentes
    : Math.max(0, totalConformesConfiguradas - totalRescatadasExistentes);

  const isCalidadCompletada = Boolean(
    receipt?.inspeccionCalidadEstado === 'COMPLETADA' ||
    (receipt?.inspecciones && receipt.inspecciones.length > 0) ||
    totalRescatadasExistentes > 0 ||
    totalDanadasHistoricas > 0 ||
    receipt?.conteoAndenEstado === 'COMPLETADO'
  );

  const bultosRecibidosNum = Number(receipt?.bultosRecibidos ?? 0);
  const isCuadradoConRampa =
    totalConformesConfiguradas === bultosRecibidosNum ||
    (totalConformesConfiguradas + totalDanadasConfiguradas === bultosRecibidosNum) ||
    (totalSanasGeneradasExistentes + totalRescatadasExistentes === bultosRecibidosNum) ||
    (totalSanasGeneradasExistentes + totalRescatadasExistentes + totalDanadasConfiguradas === bultosRecibidosNum) ||
    (totalSanasGeneradasExistentes + (totalDanadasHistoricas || 0) === bultosRecibidosNum) ||
    (totalNuevasCrear + totalRescatadasExistentes + totalDanadasConfiguradas === bultosRecibidosNum);

  // Totales reales calculados de etiquetas ya generadas (sólo cajas activas)
  const totalBoxesCount =
    labelsData?.cajas && Array.isArray(labelsData.cajas)
      ? labelsData.cajas.filter((c: any) => c.estadoHu !== 'INACTIVO').length
      : labelsData?.boxes && Array.isArray(labelsData.boxes)
      ? labelsData.boxes.filter((c: any) => c.estadoHu !== 'INACTIVO').length
      : labelsData?.totalBoxes ?? 0;

  const totalPalletsCount =
    labelsData?.totalPallets ??
    labelsData?.totales?.pallets ??
    labelsData?.totales?.totalPallets ??
    (labelsData?.pallets || []).length ??
    0;

  // Generación segura ante doble clic con clasificación física
  const handleGenerateLabels = async () => {
    if (generating) return;
    setGenerating(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const payload = {
        lineasClasificacion: breakdown.map(b => ({
          receiptLineId: b.receiptLineId,
          cajasConformes: Number(b.cajasConformes) || 0,
          cajasDanadas: Number(b.cajasDanadas) || 0,
          cajasFaltantes: b.cajasFaltantes ?? Math.max(0, b.cajasEsperadas - (Number(b.cajasConformes) || 0) - (Number(b.cajasDanadas) || 0)),
          cajasSanasNuevas: b.cajasSanasNuevas ?? (Number(b.cajasConformes) || 0),
          cajasRescatadasExistentes: b.cajasRescatadasExistentes ?? 0,
        })),
        forceRegenerate: false,
      };

      const res = await fetch(`${API}/receipts/${receipt.id}/generate-labels`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Error al generar etiquetas');
      }

      setSuccessMsg(
        `Doble etiquetado generado: ${data.resumen?.cajasCreadas || data.totales?.cajas || totalFisicasConfiguradas} Cajas físicas (${totalConformesConfiguradas} Conformes, ${totalDanadasConfiguradas} con Daño exterior). ${totalFaltantesConfiguradas > 0 ? `(${totalFaltantesConfiguradas} caja${totalFaltantesConfiguradas !== 1 ? 's' : ''} faltante${totalFaltantesConfiguradas !== 1 ? 's' : ''} omitida${totalFaltantesConfiguradas !== 1 ? 's' : ''} sin generar etiqueta física)` : ''}`
      );
      await fetchLabels();
      if (onSuccess) onSuccess();
    } catch (err: any) {
      setErrorMsg(err.message || 'Error al generar etiquetas');
    } finally {
      setGenerating(false);
    }
  };

  // 1. Abrir vista de impresión térmica (NO avanza el estado a IMPRESAS automáticamente)
  const handleOpenPrintWindow = (tipo: 'PALLETS' | 'CAJAS' | 'TODAS', huIds?: string[]) => {
    setErrorMsg(null);
    setSuccessMsg(null);

    let count = 0;
    if (tipo === 'CAJAS') {
      count = huIds ? huIds.length : totalBoxesCount;
    } else if (tipo === 'PALLETS') {
      count = huIds ? huIds.length : totalPalletsCount;
    } else {
      count = totalBoxesCount + totalPalletsCount;
    }

    const desc =
      tipo === 'CAJAS'
        ? `${count} Cajas Únicas (Rollo 100×50 mm)`
        : tipo === 'PALLETS'
        ? `${count} Tarima Master (Rollo 100×150 mm / 4"×6")`
        : `Lote Completo (${totalPalletsCount} Tarima 100×150 mm + ${totalBoxesCount} Cajas 100×50 mm)`;

    // Lanzar ventana de impresión física del navegador
    triggerThermalPrintWindow(tipo, huIds);

    // Activar tarjeta de confirmación del operador en el modal
    setPendingPrintConfirm({
      tipo,
      huIds,
      description: desc,
      totalEtiquetas: count,
    });
  };

  // 2. Confirmación explícita del operador de que las etiquetas salieron correctamente del equipo físico
  const handleConfirmPrintSuccess = async () => {
    if (confirmingPrint) return;
    setConfirmingPrint(true);
    setErrorMsg(null);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`${API}/receipts/${receipt.id}/labels/print`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          tipo: pendingPrintConfirm?.tipo || 'TODAS',
          huIds: pendingPrintConfirm?.huIds,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Error al registrar confirmación de impresión');
      }

      setSuccessMsg(
        `Emisión física confirmada por el operador. ${data.reimpresion ? 'Reimpresión registrada' : 'Etiquetas impresas'} (${data.totalImpresas || pendingPrintConfirm?.totalEtiquetas || totalBoxesCount} etiquetas). Ya puede registrar la colocación en andén.`
      );

      setPendingPrintConfirm(null);
      await fetchLabels();
      if (onSuccess) onSuccess();
    } catch (err: any) {
      setErrorMsg(err.message || 'Error al confirmar impresión física');
    } finally {
      setConfirmingPrint(false);
    }
  };

  // Confirmar colocación física en andén
  const handleConfirmPlacement = async () => {
    if (confirming) return;
    setConfirming(true);
    setErrorMsg(null);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const opName = colocadorNombre?.trim() || 'Jonathan Palacios';
      const res = await fetch(`${API}/receipts/${receipt.id}/labels/confirm-placement`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          usuario: opName,
          colocadoPor: opName,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Error al confirmar colocación');
      }

      setSuccessMsg(
        `Colocación física de etiquetas confirmada en andén por ${data.etiquetasColocadasPor || data.colocadoPor || opName}.`
      );
      await fetchLabels();
      if (onSuccess) onSuccess();
    } catch (err: any) {
      setErrorMsg(err.message || 'Error al confirmar colocación');
    } finally {
      setConfirming(false);
    }
  };

  // Generador de ventana de impresión térmica con formato estándar de etiquetas
  const triggerThermalPrintWindow = (tipo: 'PALLETS' | 'CAJAS' | 'TODAS', targetHuIds?: string[]) => {
    if (!labelsData?.pallets) return;

    const palletsToPrint =
      tipo === 'CAJAS'
        ? []
        : targetHuIds
        ? labelsData.pallets.filter((p: any) => targetHuIds.includes(p.id))
        : labelsData.pallets;

    let boxesToPrint: any[] = [];
    if (tipo === 'PALLETS') {
      boxesToPrint = [];
    } else {
      (labelsData.pallets || []).forEach((p: any) => {
        const pBoxes = p.boxes || p.cajas || [];
        pBoxes.forEach((b: any) => {
          if (!targetHuIds || targetHuIds.includes(b.id)) {
            boxesToPrint.push({ ...b, parentPalletCode: p.codigo });
          }
        });
      });
      if (boxesToPrint.length === 0 && (labelsData?.cajas || labelsData?.boxes)) {
        const rootBoxes = labelsData.cajas || labelsData.boxes || [];
        rootBoxes.forEach((b: any) => {
          if (!targetHuIds || targetHuIds.includes(b.id)) {
            const parentPlt = labelsData.pallets?.find((p: any) => p.id === b.parentHuId);
            boxesToPrint.push({ ...b, parentPalletCode: parentPlt?.codigo || 'TARIMA' });
          }
        });
      }
    }

    const printWin = window.open('', '_blank', 'width=950,height=750');
    if (!printWin) return;

    const paperFormatDesc =
      tipo === 'CAJAS'
        ? 'Rollo de Cajas: 100 mm × 50 mm'
        : tipo === 'PALLETS'
        ? 'Rollo de Tarima Master: 100 mm × 150 mm (4" × 6")'
        : 'Lote Mixto (Tarima 100×150 mm + Cajas 100×50 mm)';

    let html = `
      <!DOCTYPE html>
      <html lang="es">
        <head>
          <meta charset="UTF-8">
          <title>Impresión de Etiquetas Giving Out - ${receipt.codigo}</title>
          <style>
            ${tipo === 'CAJAS' ? `
              @page {
                size: 100mm 50mm;
                margin: 0;
              }
            ` : tipo === 'PALLETS' ? `
              @page {
                size: 100mm 150mm;
                margin: 0;
              }
            ` : `
              @page {
                margin: 0;
              }
              @page pallet-page {
                size: 100mm 150mm;
                margin: 0;
              }
              @page box-page {
                size: 100mm 50mm;
                margin: 0;
              }
            `}
            * {
              box-sizing: border-box;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, monospace;
              margin: 0;
              padding: 0;
              background: #e2e8f0;
              color: #000;
            }

            @media screen {
              body {
                padding: 24px;
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 20px;
              }
              .label-page {
                box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.2), 0 4px 6px -4px rgba(0, 0, 0, 0.1);
                background: #fff;
              }
              .no-print {
                position: sticky;
                top: 8px;
                z-index: 1000;
                background: #0f172a;
                color: #fff;
                padding: 12px 20px;
                border-radius: 8px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                width: 100%;
                max-width: 850px;
                box-shadow: 0 4px 6px -1px rgba(0,0,0,0.3);
              }
              .btn-print {
                background: #0d9488;
                color: #fff;
                border: none;
                padding: 8px 16px;
                border-radius: 6px;
                font-weight: 700;
                font-size: 13px;
                cursor: pointer;
              }
              .btn-close {
                background: #334155;
                color: #fff;
                border: none;
                padding: 8px 14px;
                border-radius: 6px;
                font-size: 13px;
                cursor: pointer;
                margin-left: 8px;
              }
            }

            @media print {
              body {
                background: #fff;
                padding: 0;
                margin: 0;
              }
              .no-print {
                display: none !important;
              }
              .label-page {
                page-break-after: always;
                page-break-inside: avoid;
                margin: 0;
              }
              .label-page.pallet {
                page: pallet-page;
                width: 100mm;
                height: 146mm;
                max-height: 146mm;
              }
              .label-page.caja {
                page: box-page;
                width: 100mm;
                height: 48mm;
                max-height: 48mm;
              }
            }

            /* FORMATO TARIMA MASTER: 100mm x 150mm (4" x 6") */
            .label-page.pallet {
              width: 100mm;
              height: 146mm;
              max-height: 146mm;
              padding: 2.2mm 3.5mm 1.8mm 3.5mm;
              background: #fff;
              display: flex;
              flex-direction: column;
              justify-content: space-between;
              border: 2px solid #000;
              overflow: hidden;
              box-sizing: border-box;
            }

            /* FORMATO CAJA ÚNICA: 100mm x 50mm */
            .label-page.caja {
              width: 100mm;
              height: 48mm;
              max-height: 48mm;
              padding: 1.6mm 2.5mm 1.4mm 2.5mm;
              background: #fff;
              display: flex;
              flex-direction: column;
              justify-content: space-between;
              border: 1.5px solid #000;
              overflow: hidden;
              box-sizing: border-box;
            }

            .label-page.caja.danada {
              border: 3px double #000;
            }

            .barcode-svg {
              max-width: 90mm;
              width: 100%;
              height: 13.5mm;
              display: block;
              margin: 0 auto;
            }
          </style>
        </head>
        <body>
          <div class="no-print">
            <div>
              <div style="font-weight: 800; font-size: 14px; letter-spacing: 0.02em;">GIVING OUT WMS • VISTA DE IMPRESIÓN TÉRMICA</div>
              <div style="font-size: 11px; color: #94a3b8; margin-top: 2px;">
                ${paperFormatDesc} • ${boxesToPrint.length} Cajas • ${palletsToPrint.length} Tarimas
              </div>
            </div>
            <div>
              <button class="btn-print" onclick="window.print()">Mandar a Imprimir</button>
              <button class="btn-close" onclick="window.close()">Cerrar</button>
            </div>
          </div>
    `;

    // 1. Imprimir etiquetas de Tarima Master (100mm x 150mm)
    palletsToPrint.forEach((plt: any) => {
      const qrDataUrl = qrCodeUrls[plt.id] || '';

      // Obtener cajas físicas activas de la tarima (excluyendo cajas inactivas reacondicionadas)
      const rawBoxes = plt.boxes || plt.cajas || allBoxes.filter((b: any) => b.parentHuId === plt.id || b.parentPalletId === plt.id) || [];
      const palletBoxes = rawBoxes.filter((b: any) => b.estadoHu !== 'INACTIVO');
      const confBoxes = palletBoxes.filter((b: any) => !isHuDamaged(b));
      const danBoxes = palletBoxes.filter((b: any) => isHuDamaged(b));
      const confCount = confBoxes.length;
      const danCount = danBoxes.length;
      const confPiezas = confBoxes.reduce((s: number, b: any) => s + Number(b.piezasPorCaja || b.cantidad || 0), 0);
      const danPiezas = danBoxes.reduce((s: number, b: any) => s + Number(b.piezasPorCaja || b.cantidad || 0), 0);
      const totalPiezasTarima = palletBoxes.reduce((s: number, b: any) => s + Number(b.piezasPorCaja || b.cantidad || 0), 0);

      // Desglose real por SKU y Lote (sin inventar lote único ficticio)
      const skusGrouped: Record<string, {
        sku: string;
        desc: string;
        lote: string;
        caducidad: string;
        cajasTotal: number;
        cajasConformes: number;
        cajasDanadas: number;
        cajasReacondicionadas: number;
        piezasTotal: number;
      }> = {};

      if (palletBoxes.length > 0) {
        palletBoxes.forEach((b: any) => {
          const key = b.receiptLineId ? b.receiptLineId : `${b.skuCodigo}_${b.loteTexto || 'SL'}`;
          if (!skusGrouped[key]) {
            skusGrouped[key] = {
              sku: b.skuCodigo,
              desc: b.skuDescripcion || '',
              lote: b.loteTexto || 'S/L',
              caducidad: b.fechaVencimiento ? String(b.fechaVencimiento).slice(0, 10) : 'Sin caducidad',
              cajasTotal: 0,
              cajasConformes: 0,
              cajasDanadas: 0,
              cajasReacondicionadas: 0,
              piezasTotal: 0,
            };
          }
          const isDan = isHuDamaged(b);
          skusGrouped[key].cajasTotal += 1;
          if (isDan) {
            skusGrouped[key].cajasDanadas += 1;
          } else {
            skusGrouped[key].cajasConformes += 1;
          }
          if (b.reacondicionada || b.cajaOrigenId) {
            skusGrouped[key].cajasReacondicionadas += 1;
          }
          skusGrouped[key].piezasTotal += Number(b.piezasPorCaja || b.cantidad || 0);
        });
      } else if (plt.skusDesglose) {
        Object.entries(plt.skusDesglose).forEach(([skuKey, item]: [string, any]) => {
          skusGrouped[skuKey] = {
            sku: skuKey,
            desc: item.desc || '',
            lote: item.lote || 'S/L',
            caducidad: 'Según partida',
            cajasTotal: Math.ceil(item.cantidad / 12) || 1,
            cajasConformes: Math.ceil(item.cantidad / 12) || 1,
            cajasDanadas: 0,
            cajasReacondicionadas: 0,
            piezasTotal: item.cantidad,
          };
        });
      }

      // Cálculo de SKUs únicos y Lotes únicos (evitar contar SKU+lote como SKU distinto)
      const distinctSkusSet = new Set<string>();
      const distinctLotesSet = new Set<string>();
      Object.values(skusGrouped).forEach((item) => {
        if (item.sku) distinctSkusSet.add(item.sku);
        if (item.lote && item.lote !== 'S/L' && item.lote !== 'Sin lote' && item.lote !== 'SL') {
          distinctLotesSet.add(item.lote);
        }
      });
      const distinctSkusList = Array.from(distinctSkusSet);
      const distinctLotesList = Array.from(distinctLotesSet);
      const totalSkusUnicos = distinctSkusList.length;
      const totalPartidasLote = Object.keys(skusGrouped).length;
      const totalLotes = distinctLotesList.length;
      const esMonoSku = totalSkusUnicos <= 1;

      const skusResumenTexto = distinctSkusList.length <= 4
        ? distinctSkusList.join(', ')
        : `${distinctSkusList.slice(0, 3).join(', ')} +${distinctSkusList.length - 3}`;

      const lotesResumenTexto = distinctLotesList.length > 0
        ? distinctLotesList.length <= 3
          ? distinctLotesList.join(', ')
          : `${distinctLotesList.slice(0, 3).join(', ')} +${distinctLotesList.length - 3}`
        : 'Sin lotes registrados';

      html += `
        <div class="label-page pallet">
          <!-- Encabezado Master -->
          <div style="border-bottom: 1.5px solid #000; padding-bottom: 1.2mm;">
            <div style="display: flex; justify-content: space-between; align-items: baseline;">
              <span style="font-size: 8.5pt; font-weight: 900; letter-spacing: 0.05em;">GIVING OUT WMS</span>
              <span style="font-size: 7pt; font-weight: 800; text-transform: uppercase;">ETIQUETA MASTER DE TARIMA</span>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-top: 0.8mm;">
              <div>
                <div style="font-size: 6pt; color: #475569; text-transform: uppercase; font-weight: 700;">Depositante / Cliente:</div>
                <div style="font-size: 11pt; font-weight: 900; line-height: 1.1;">${receipt.cliente?.nombreComercial || receipt.cliente?.nombreEmpresa || 'AlimNorte'}</div>
              </div>
              <div style="text-align: right;">
                <div style="font-size: 6pt; color: #475569; font-weight: 700;">PREVIO / FACTURA:</div>
                <div style="font-size: 8pt; font-weight: 800; line-height: 1.1;">${receipt.codigo} • ${receipt.facturaRespaldo || 'S/F'}</div>
              </div>
            </div>
          </div>

          <!-- Identificador de Tarima y Conteo de Cajas -->
          <div style="background: #000; color: #fff; padding: 1.2mm 2mm; text-align: center; margin: 1mm 0;">
            <div style="font-size: 6.5pt; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;">IDENTIFICADOR ÚNICO DE TARIMA</div>
            <div style="font-size: 14pt; font-weight: 900; font-family: monospace; letter-spacing: 0.05em; margin: 0.3mm 0;">${plt.codigo}</div>
            <div style="font-size: 7.5pt; font-weight: 800; border-top: 1px solid #444; padding-top: 0.6mm; margin-top: 0.4mm;">
              TOTAL: ${plt.totalCajas} CAJAS FÍSICAS CONTENIDAS (${totalPiezasTarima} Piezas)
            </div>
          </div>

          <!-- Indicador de Condición Física de Cajas (Conformes vs Dañadas) -->
          <div style="display: flex; gap: 2mm; margin-bottom: 1mm;">
            <div style="flex: 1; border: 1.2px solid #000; padding: 0.8mm; text-align: center; font-size: 7pt; font-weight: 800;">
              CONFORME: ${confCount} CAJAS (${confPiezas} pzas)
            </div>
            <div style="flex: 1; border: 1.5px solid #000; background: ${danCount > 0 ? '#eee' : '#fff'}; padding: 0.8mm; text-align: center; font-size: 7pt; font-weight: 900;">
              ${danCount > 0 ? `RETENIDA: ${danCount} CAJA (${danPiezas} pzas)` : '0 CAJAS RETENIDAS'}
            </div>
          </div>

          <!-- Sección QR 2D + Metadatos Logísticos -->
          <div style="display: flex; gap: 2.5mm; align-items: center; border: 1.2px solid #000; padding: 1.5mm 2mm; margin-bottom: 1.2mm;">
            <div style="text-align: center; flex-shrink: 0;">
              ${qrDataUrl ? `<img src="${qrDataUrl}" style="width: 26mm; height: 26mm; display: block;" />` : `<div style="width: 26mm; height: 26mm; border: 1px dashed #999;"></div>`}
              <div style="font-size: 5.5pt; font-family: monospace; font-weight: bold; margin-top: 0.4mm;">2D QR MASTER (GS1)</div>
            </div>
            <div style="font-size: 6.8pt; line-height: 1.4; flex: 1;">
              <div><strong>Tipo Tarima:</strong> ${esMonoSku ? 'MONO-SKU ESTÁNDAR' : 'MIXTA MULTI-SKU'}</div>
              <div><strong>SKUs en Tarima:</strong> ${totalSkusUnicos} SKU${totalSkusUnicos !== 1 ? 's' : ''} (${skusResumenTexto}) • ${totalPartidasLote} partidas-lote</div>
              <div><strong>Lotes en Tarima:</strong> ${totalLotes} Lote${totalLotes !== 1 ? 's' : ''} diferenciado${totalLotes !== 1 ? 's' : ''} (${lotesResumenTexto})</div>
              <div><strong>Rampa Descarga:</strong> ${receipt.rampaAsignada || 'Rampa 1'}</div>
              <div><strong>Estado Físico:</strong> RECIBIDO EN ANDÉN</div>
              <div style="font-size: 5.8pt; color: #475569; margin-top: 0.6mm;">
                * Escaneo del QR despliega el manifiesto digital unificado de bultos unitarios vinculados.
              </div>
            </div>
          </div>

          <!-- Tabla de Desglose Real de SKUs y Lotes (Sin Lote Ficticio) -->
          <div style="border: 1.2px solid #000; margin-bottom: 1mm;">
            <div style="background: #000; color: #fff; font-size: 6.2pt; font-weight: 800; padding: 0.6mm 1.5mm; text-align: center; letter-spacing: 0.04em;">
              MANIFIESTO REAL DE CONTENIDO POR SKU / LOTE (TARIMA ${esMonoSku ? 'MONO-SKU' : 'MIXTA'})
            </div>
            <table style="width: 100%; border-collapse: collapse; font-size: 6.2pt;">
              <thead>
                <tr style="border-bottom: 1px solid #000; background: #f1f5f9; font-size: 5.8pt; text-align: left;">
                  <th style="padding: 0.6mm 0.8mm;">SKU / DESCRIPCIÓN</th>
                  <th style="padding: 0.6mm 0.8mm;">LOTE</th>
                  <th style="padding: 0.6mm 0.8mm;">CADUCIDAD</th>
                  <th style="padding: 0.6mm 0.8mm; text-align: center;">CONDICIÓN</th>
                  <th style="padding: 0.6mm 0.8mm; text-align: right;">CANT</th>
                </tr>
              </thead>
              <tbody>
                ${Object.values(skusGrouped).map((item) => `
                  <tr style="border-bottom: 1px dashed #ccc;">
                    <td style="padding: 0.6mm 0.8mm;">
                      <strong>${item.sku}</strong><br/>
                      <span style="font-size: 5.4pt; color: #333;">${(item.desc || '').replace('[DAÑO EXTERIOR] ', '').substring(0, 32)}</span>
                    </td>
                    <td style="padding: 0.6mm 0.8mm; font-family: monospace; font-weight: bold;">${item.lote}</td>
                    <td style="padding: 0.6mm 0.8mm; font-family: monospace;">${item.caducidad}</td>
                    <td style="padding: 0.6mm 0.8mm; text-align: center; font-weight: bold;">
                      ${item.cajasDanadas > 0
                        ? `${item.cajasConformes} Conf + ${item.cajasDanadas} Daño`
                        : item.cajasReacondicionadas > 0
                        ? `${item.cajasConformes} Conf (${item.cajasReacondicionadas} Reacond.)`
                        : `${item.cajasConformes} Conforme`}
                    </td>
                    <td style="padding: 0.6mm 0.8mm; text-align: right; font-weight: bold;">${item.cajasTotal} cjs (${item.piezasTotal} pz)</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>

          <!-- Advertencia por Caja Retenida -->
          ${danCount > 0 ? `
            <div style="border: 1.2px solid #000; background: #eee; padding: 0.8mm 1.5mm; font-size: 5.6pt; font-weight: bold; text-align: center; margin-bottom: 0.8mm;">
              AVISO DE CALIDAD: Esta tarima contiene ${danCount} caja${danCount !== 1 ? 's' : ''} retenida${danCount !== 1 ? 's' : ''} por daño exterior en empaque. Segregar físicamente en andén para inspección interna previa a putaway.
            </div>
          ` : ''}

          <!-- Pie de Tarima Master -->
          <div style="font-size: 5.6pt; text-align: center; border-top: 1.2px solid #000; padding-top: 0.8mm; padding-bottom: 0.4mm; font-weight: 800; letter-spacing: 0.04em; text-transform: uppercase;">
            TARIMA LOGÍSTICA DE RECEPCIÓN • IDENTIFICADOR DIGITAL DE MANIFIESTO
          </div>
        </div>
      `;
    });

    // 2. Imprimir etiquetas de Cajas Únicas (100mm x 50mm)
    boxesToPrint.forEach((box: any) => {
      const isDamaged = isHuDamaged(box);
      const isReacondicionada = Boolean(box.reacondicionada || box.cajaOrigenId);

      // Localizar la línea de recepción con prioridad receiptLineId exacto y luego SKU + Lote + Vencimiento
      const matchingLine = findMatchingReceiptLine(box, receipt.lineas || []);

      // Capacidad nominal estándar (sin suposiciones hardcodeadas; si no existe, es null / dato faltante)
      const packSize = resolvePackagingCapacity(box, matchingLine);

      // Piezas reales contenidas en la caja física
      const pzasActuales = Number(box.cantidad ?? box.piezasPorCaja ?? 0);

      // Determinación estricta de parcialidad por atributos persistidos y capacidad estándar
      const esParcial = Boolean(box.esParcial || (packSize !== null && packSize > 0 && pzasActuales < packSize));

      // Texto de cantidad / empaque
      const textoPiezas = esParcial
        ? `${pzasActuales} PZAS (PARCIAL)`
        : pzasActuales > 0
        ? `${pzasActuales} PZAS / CAJA`
        : packSize !== null
        ? `${packSize} PZAS / CAJA`
        : 'CANTIDAD PENDIENTE';

      // Condición física preservando trazabilidad para unidades reacondicionadas / rescatadas
      const textoCondicion = isDamaged
        ? 'RETENIDA / DAÑO EXTERIOR'
        : isReacondicionada
        ? 'REACONDICIONADA / CONFORME'
        : 'CONFORME';

      // Para condiciones extendidas o combinaciones que comprometan el ancho de 100mm:
      // se separan los metadatos en 2 líneas dedicadas (Línea 1: Lote y Caducidad; Línea 2: Condición completa)
      // Para condiciones estándar cortas (CONFORME), se mantiene en una sola línea si cabe holgadamente.
      const isCondicionLarga =
        textoCondicion.length > 10 ||
        (String(box.loteTexto || '').length + textoCondicion.length > 24);

      const desc = (
        box.skuDescripcion ||
        box.descripcion ||
        box.sku?.descripcion ||
        matchingLine?.sku?.descripcion ||
        box.skuCodigo ||
        'Producto'
      ).replace('[DAÑO EXTERIOR] ', '');

      const facRespaldo = box.facturaRespaldo || receipt.facturaRespaldo || 'S/F';

      if (isDamaged) {
        html += `
          <!-- CAJA CON DAÑO EXTERIOR -->
          <div class="label-page caja danada">
            <!-- Banner Superior Invertido B/N -->
            <div style="background: #000; color: #fff; text-align: center; padding: 1mm 1mm; margin: -1.6mm -2.5mm 0.6mm -2.5mm;">
              <div style="font-size: 7.5pt; font-weight: 900; letter-spacing: 0.03em; white-space: nowrap;">
                DAÑO EXTERIOR — RETENIDA PARA INSPECCIÓN / RESCATE
              </div>
              <div style="font-size: 5.4pt; font-weight: 700; color: #fff; margin-top: 0.3mm; white-space: nowrap;">
                NO REPRESENTA MERMA DEFINITIVA • NO DISPONIBLE PARA VENTA
              </div>
            </div>

            <!-- Fila 1: SKU e Identificador Único -->
            <div style="display: flex; justify-content: space-between; align-items: baseline;">
              <span style="font-size: 10.5pt; font-weight: 900; white-space: nowrap;">SKU: ${box.skuCodigo}</span>
              <span style="font-size: 8pt; font-weight: 900; font-family: monospace; white-space: nowrap;">${box.codigo}</span>
            </div>

            <!-- Fila 2: Previo, Factura y Empaque -->
            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 6.2pt; margin-top: 0.3mm;">
              <span style="white-space: nowrap;">Previo: <b>${receipt.codigo}</b> &nbsp;|&nbsp; Fact: <b>${facRespaldo}</b></span>
              <span style="font-size: 7.5pt; font-weight: 800; border: 1.2px solid #000; padding: 0.2mm 1.5mm; white-space: nowrap;">
                ${textoPiezas}
              </span>
            </div>

            <!-- Fila 3: Descripción completa del producto -->
            <div style="font-size: 7.2pt; font-weight: 700; color: #000; margin: 0.2mm 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
              ${desc}
            </div>

            <!-- Fila 4: Lote, Caducidad y Tarima Matriz -->
            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 6.2pt; border-top: 1px solid #000; border-bottom: 1px solid #000; padding: 0.3mm 0.8mm; margin-bottom: 0.4mm; background: #eee; gap: 3px;">
              <span style="white-space: nowrap;">LOTE: <b style="font-family: monospace; font-size: 6.8pt;">${box.loteTexto || 'S/L'}</b></span>
              <span style="color: #666;">•</span>
              <span style="white-space: nowrap;">CADUCIDAD: <b style="font-family: monospace; font-size: 6.8pt;">${box.fechaVencimiento ? String(box.fechaVencimiento).slice(0, 10) : 'N/A'}</b></span>
              <span style="color: #666;">•</span>
              <span style="white-space: nowrap;">TARIMA: <b>${box.parentPalletCode}</b></span>
            </div>

            <!-- Código de Barras Code-128 ancho completo -->
            <div style="text-align: center; width: 100%; margin: 0;">
              <svg id="barcode-${box.id}" class="barcode-svg" style="height: 13.5mm;"></svg>
            </div>

            <!-- Pie de Caja Dañada -->
            <div style="font-size: 5.2pt; text-align: center; border-top: 1px solid #000; padding-top: 0.4mm; font-weight: bold; background: #000; color: #fff; margin: 0 -2.5mm -1.4mm -2.5mm; white-space: nowrap;">
              MERCANCÍA RETENIDA • PENDIENTE DE DICTAMEN TÉCNICO • CONSULTAR EN WMS
            </div>
          </div>
        `;
      } else {
        html += `
          <!-- CAJA CONFORME -->
          <div class="label-page caja">
            <!-- Encabezado Caja Conforme -->
            <div style="display: flex; justify-content: space-between; align-items: baseline; border-bottom: 1px solid #000; padding-bottom: 0.5mm;">
              <span style="font-size: 7.8pt; font-weight: 900; letter-spacing: 0.04em; white-space: nowrap;">GIVING OUT • CAJA ÚNICA</span>
              <span style="font-size: 7.8pt; font-weight: 800; font-family: monospace; white-space: nowrap;">${box.codigo}</span>
            </div>

            <!-- Previo, Factura y Tarima Matriz -->
            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 6pt; margin-top: 0.3mm; gap: 4px;">
              <span style="white-space: nowrap;">Previo: <b>${receipt.codigo}</b> &nbsp;|&nbsp; Fact: <b>${facRespaldo}</b></span>
              <span style="white-space: nowrap; font-family: monospace; font-weight: 800;">TARIMA: <b>${box.parentPalletCode}</b></span>
            </div>

            <!-- SKU y Piezas -->
            <div style="display: flex; justify-content: space-between; align-items: baseline; margin-top: 0.3mm;">
              <span style="font-size: 10.5pt; font-weight: 900; white-space: nowrap;">SKU: ${box.skuCodigo}</span>
              <span style="font-size: 7.5pt; font-weight: 800; border: 1.2px solid #000; padding: 0.2mm 1.5mm; border-radius: 2px; white-space: nowrap;">
                ${textoPiezas}
              </span>
            </div>

            <!-- Descripción -->
            <div style="font-size: 7.2pt; font-weight: 700; color: #111; margin: 0.2mm 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
              ${desc}
            </div>

            <!-- Metadatos de Lote, Caducidad y Condición Física (Garantía anti-recorte) -->
            ${isCondicionLarga ? `
              <div style="border-top: 1px dashed #666; border-bottom: 1px dashed #666; padding: 0.3mm 0.8mm; margin-bottom: 0.4mm; font-size: 6.4pt;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                  <span style="white-space: nowrap;">LOTE: <b style="font-family: monospace; font-size: 7pt;">${box.loteTexto || 'S/L'}</b></span>
                  <span style="color: #94a3b8;">•</span>
                  <span style="white-space: nowrap;">CADUCIDAD: <b style="font-family: monospace; font-size: 7pt;">${box.fechaVencimiento ? String(box.fechaVencimiento).slice(0, 10) : 'N/A'}</b></span>
                </div>
                <div style="margin-top: 0.3mm; font-size: 6.4pt; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                  CONDICIÓN: <b style="letter-spacing: 0.01em;">${textoCondicion}</b>
                </div>
              </div>
            ` : `
              <div style="display: flex; justify-content: space-between; align-items: center; font-size: 6.4pt; border-top: 1px dashed #666; border-bottom: 1px dashed #666; padding: 0.4mm 0.8mm; margin-bottom: 0.4mm; gap: 4px;">
                <span style="white-space: nowrap;">LOTE: <b style="font-family: monospace; font-size: 7pt;">${box.loteTexto || 'S/L'}</b></span>
                <span style="color: #94a3b8;">•</span>
                <span style="white-space: nowrap;">CADUCIDAD: <b style="font-family: monospace; font-size: 7pt;">${box.fechaVencimiento ? String(box.fechaVencimiento).slice(0, 10) : 'N/A'}</b></span>
                <span style="color: #94a3b8;">•</span>
                <span style="white-space: nowrap; font-size: 6.4pt;">CONDICIÓN: <b>${textoCondicion}</b></span>
              </div>
            `}

            <!-- Código de Barras Code-128 ancho completo -->
            <div style="text-align: center; width: 100%; margin: 0;">
              <svg id="barcode-${box.id}" class="barcode-svg" style="height: 13.5mm;"></svg>
            </div>

            <!-- Pie de Caja Conforme -->
            <div style="font-size: 5.2pt; text-align: center; border-top: 1px solid #000; padding-top: 0.4mm; font-weight: bold; white-space: nowrap;">
              TRAZABILIDAD UNITARIA • CONSULTAR POSICIÓN FÍSICA EN WMS
            </div>
          </div>
        `;
      }
    });

    html += `
          <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js"></script>
          <script>
            window.onload = function() {
              ${boxesToPrint
                .map(
                  (b) => `
                try {
                  JsBarcode("#barcode-${b.id}", "${b.codigo}", {
                    format: "CODE128",
                    width: 0.95,
                    height: 22,
                    displayValue: true,
                    fontSize: 8,
                    fontOptions: "bold",
                    font: "monospace",
                    textMargin: 1,
                    margin: 0
                  });
                } catch(e) {
                  console.error(e);
                }
              `
                )
                .join('\n')}
              setTimeout(function() {
                window.print();
              }, 400);
            };
          </script>
        </body>
      </html>
    `;

    printWin.document.open();
    printWin.document.write(html);
    printWin.document.close();
  };

  // Cajas aplanadas para tab de cajas (excluyendo cajas inactivas reacondicionadas)
  const allBoxes: any[] = [];
  if (labelsData?.pallets && Array.isArray(labelsData.pallets)) {
    labelsData.pallets.forEach((p: any) => {
      const palletBoxes = p.boxes || p.cajas || [];
      palletBoxes.forEach((b: any) => {
        if (b.estadoHu !== 'INACTIVO') {
          allBoxes.push({
            ...b,
            parentPalletId: p.id,
            parentPalletCode: p.codigo,
          });
        }
      });
    });
  }
  if (allBoxes.length === 0 && (labelsData?.cajas || labelsData?.boxes)) {
    const rootBoxes = labelsData.cajas || labelsData.boxes || [];
    rootBoxes.forEach((b: any) => {
      if (b.estadoHu !== 'INACTIVO') {
        const parentPallet = labelsData.pallets?.find((p: any) => p.id === b.parentHuId);
        allBoxes.push({
          ...b,
          parentPalletId: b.parentHuId,
          parentPalletCode: parentPallet?.codigo || 'TARIMA',
        });
      }
    });
  }

  const filteredBoxes =
    selectedPalletFilter === 'ALL'
      ? allBoxes
      : allBoxes.filter((b) => b.parentPalletId === selectedPalletFilter);

  // Sincronizar selección de cajas: si hay cajas nuevas/reacondicionadas pendientes, seleccionarlas por defecto
  useEffect(() => {
    if (allBoxes.length === 0) return;
    const pendingOrReconditioned = allBoxes.filter(
      (b: any) => b.reacondicionada || b.cajaOrigenId || b.estadoEtiqueta !== 'COLOCADA'
    );
    if (pendingOrReconditioned.length > 0 && pendingOrReconditioned.length < allBoxes.length) {
      setSelectedBoxIds(pendingOrReconditioned.map((b: any) => b.id));
    } else {
      setSelectedBoxIds(allBoxes.map((b: any) => b.id));
    }
  }, [labelsData?.pallets, labelsData?.cajas]);

  const handleToggleBoxSelect = (id: string) => {
    setSelectedBoxIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleSelectAllBoxes = () => {
    setSelectedBoxIds(filteredBoxes.map((b: any) => b.id));
  };

  const handleDeselectAllBoxes = () => {
    setSelectedBoxIds([]);
  };

  const handleSelectOnlyNewOrPending = () => {
    const target = filteredBoxes.filter(
      (b: any) => b.reacondicionada || b.cajaOrigenId || b.estadoEtiqueta !== 'COLOCADA'
    );
    setSelectedBoxIds(target.map((b: any) => b.id));
  };

  const estadoCiclo = labelsData?.etiquetasEstado || receipt?.etiquetasEstado || 'PENDIENTE';
  const hasGeneratedLabels = Boolean(
    totalPalletsCount > 0 ||
    totalBoxesCount > 0 ||
    totalSanasExistentes > 0 ||
    (totalNuevasCrear === 0 && totalConformesConfiguradas > 0)
  );

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
          width: '96%',
          maxWidth: 1180,
          maxHeight: '94vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* ENCABEZADO */}
        <div
          style={{
            padding: '16px 24px',
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
              <QrCode size={22} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#0F172A' }}>
                  Doble Etiquetado Giving Out (Tarimas Master + Cajas Únicas)
                </h3>
              </div>
              <p style={{ margin: 0, fontSize: 12, color: '#64748B' }}>
                Folio: <strong style={{ color: '#0F172A' }}>{receipt.codigo}</strong> • Factura:{' '}
                <strong style={{ color: '#0F172A' }}>{receipt.facturaRespaldo || receipt.ocReferencia || 'S/N'}</strong> • Cliente:{' '}
                <strong>{receipt.cliente?.nombreComercial || receipt.cliente?.nombreEmpresa || 'Cliente'}</strong>
              </p>
            </div>
          </div>

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

        {/* PIPELINE DE 3 ETAPAS DE ETIQUETADO */}
        <div
          style={{
            padding: '12px 24px',
            backgroundColor: '#F1F5F9',
            borderBottom: '1px solid #E2E8F0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase' }}>
              Ciclo de Vida:
            </span>

            {/* Paso 1: Generadas */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: '50%',
                  backgroundColor: estadoCiclo !== 'PENDIENTE' ? '#0D9488' : '#CBD5E1',
                  color: '#FFFFFF',
                  fontSize: 11,
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {estadoCiclo !== 'PENDIENTE' ? <Check size={13} /> : '1'}
              </div>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: estadoCiclo === 'GENERADAS' ? 700 : 500,
                  color: estadoCiclo !== 'PENDIENTE' ? '#0F172A' : '#94A3B8',
                }}
              >
                1. Generadas
              </span>
            </div>

            <ArrowRight size={14} style={{ color: '#94A3B8' }} />

            {/* Paso 2: Enviadas a Impresión */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: '50%',
                  backgroundColor:
                    estadoCiclo === 'IMPRESAS' || estadoCiclo === 'COLOCADAS'
                      ? '#0D9488'
                      : '#CBD5E1',
                  color: '#FFFFFF',
                  fontSize: 11,
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {estadoCiclo === 'IMPRESAS' || estadoCiclo === 'COLOCADAS' ? <Check size={13} /> : '2'}
              </div>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: estadoCiclo === 'IMPRESAS' ? 700 : 500,
                  color:
                    estadoCiclo === 'IMPRESAS' || estadoCiclo === 'COLOCADAS'
                      ? '#0F172A'
                      : '#94A3B8',
                }}
              >
                2. Impresas
              </span>
            </div>

            <ArrowRight size={14} style={{ color: '#94A3B8' }} />

            {/* Paso 3: Colocación Confirmada */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: '50%',
                  backgroundColor: estadoCiclo === 'COLOCADAS' ? '#16A34A' : '#CBD5E1',
                  color: '#FFFFFF',
                  fontSize: 11,
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {estadoCiclo === 'COLOCADAS' ? <Check size={13} /> : '3'}
              </div>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: estadoCiclo === 'COLOCADAS' ? 700 : 500,
                  color: estadoCiclo === 'COLOCADAS' ? '#166534' : '#94A3B8',
                }}
              >
                3. Colocación Confirmada
              </span>
            </div>
          </div>

          {/* Información del colocador si ya está confirmado */}
          {estadoCiclo === 'COLOCADAS' && (
            <div style={{ fontSize: 11, color: '#166534', fontWeight: 600 }}>
              Colocadas por {labelsData?.etiquetasColocadasPor || receipt?.etiquetasColocadasPor} el{' '}
              {labelsData?.fechaColocacionEtiquetas
                ? new Date(labelsData.fechaColocacionEtiquetas).toLocaleString()
                : ''}
            </div>
          )}
        </div>

        {/* CUERPO DEL MODAL */}
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
                gap: 8,
              }}
            >
              <CheckCircle2 size={16} />
              <span>{successMsg}</span>
            </div>
          )}

          {/* CLASIFICACIÓN FÍSICA PREVIA AL ETIQUETADO (RESOLUCIÓN DE DISCREPANCIAS Y DAÑOS) */}
          <div
            style={{
              padding: '14px 18px',
              backgroundColor: '#F8FAFC',
              borderRadius: 10,
              border: '1px solid #E2E8F0',
              marginBottom: 18,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <PackageCheck size={18} style={{ color: '#0D9488' }} />
                <strong style={{ fontSize: 13, color: '#0F172A' }}>
                  {hasGeneratedLabels ? 'Distribución Física Registrada en Andén' : 'Clasificación Física de Cajas en Andén (Previa a Generar Etiquetas)'}
                </strong>
              </div>

              {receipt?.bultosRecibidos !== undefined && (
                <div style={{ fontSize: 11, color: '#64748B' }}>
                  Acta de Rampa:{' '}
                  <strong>{receipt.bultosDeclarados || 0} declarados</strong> |{' '}
                  <strong style={{ color: '#0284C7' }}>{receipt.bultosRecibidos || 0} recibidos</strong> |{' '}
                  <strong style={{ color: '#D97706' }}>{receipt.bultosDanados || 0} con daño</strong> |{' '}
                  <strong style={{ color: (receipt.diferenciaBultos || 0) < 0 ? '#DC2626' : '#16A34A' }}>
                    {receipt.diferenciaBultos || 0} dif.
                  </strong>
                </div>
              )}
            </div>

            <p style={{ margin: '0 0 12px 0', fontSize: 11.5, color: '#64748B', lineHeight: 1.4 }}>
              {isCalidadCompletada ? (
                <>
                  Distribución física consolidada tras la conciliación en andén y dictamen de calidad. Las cajas faltantes <strong>NO recibirán etiqueta física</strong> (evitando generar bultos fantasmas), las HUs dañadas originales (históricas/inactivas) <strong>no generan etiqueta operativa</strong>, y las HUs reacondicionadas ya dictaminadas en Calidad conservan su código e identidad en la tarima.
                </>
              ) : (
                <>
                  Asigne qué cajas físicas llegaron conformes y cuáles con daño exterior. Las cajas faltantes <strong>NO recibirán etiqueta física</strong> (evitando generar bultos fantasmas), y las cajas con daño se imprimirán identificadas para su inspección técnica y dictamen en Control de Calidad.
                </>
              )}
            </p>

            {/* TABLA DE CLASIFICACIÓN POR PARTIDA */}
            <div style={{ border: '1px solid #CBD5E1', borderRadius: 8, overflow: 'hidden', backgroundColor: '#FFFFFF', marginBottom: 10 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
                <thead>
                  <tr style={{ backgroundColor: '#F1F5F9', borderBottom: '1px solid #CBD5E1', color: '#475569', textAlign: 'left' }}>
                    <th style={{ padding: '8px 10px' }}>SKU & Descripción</th>
                    <th style={{ padding: '8px 10px' }}>Lote / Caducidad</th>
                    <th style={{ padding: '8px 10px', textAlign: 'center' }}>Cajas Declaradas</th>
                    <th style={{ padding: '8px 10px', textAlign: 'center', color: '#059669' }}>Cajas Conformes</th>
                    <th style={{ padding: '8px 10px', textAlign: 'center', color: '#D97706' }}>Cajas Daño Exterior</th>
                    <th style={{ padding: '8px 10px', textAlign: 'center', color: '#DC2626' }}>Cajas Faltantes</th>
                  </tr>
                </thead>
                <tbody>
                  {breakdown.map((item) => {
                    const faltantes = Math.max(0, item.cajasEsperadas - (Number(item.cajasConformes) || 0) - (Number(item.cajasDanadas) || 0));
                    return (
                      <tr key={item.receiptLineId} style={{ borderBottom: '1px solid #F1F5F9' }}>
                        <td style={{ padding: '8px 10px' }}>
                          <div style={{ fontWeight: 700, color: '#0F172A' }}>{item.skuCodigo}</div>
                          <div style={{ fontSize: 10.5, color: '#64748B' }}>{item.skuDescripcion}</div>
                        </td>
                        <td style={{ padding: '8px 10px' }}>
                          <div style={{ fontWeight: 600 }}>{item.lote}</div>
                          <div style={{ fontSize: 10.5, color: '#64748B' }}>{item.fechaVencimiento || 'Sin caducidad'}</div>
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 700, color: '#334155' }}>
                          {item.cajasEsperadas} cajas
                          <div style={{ fontSize: 10, color: '#64748B' }}>({item.piezasPorCaja} pzas/caja)</div>
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                          <input
                            type="text"
                            inputMode="numeric"
                            value={item.cajasConformes}
                            onFocus={(e) => e.target.select()}
                            onChange={(e) => handleBreakdownInputChange(item.receiptLineId, 'cajasConformes', e.target.value)}
                            onBlur={() => handleBreakdownInputBlur(item.receiptLineId, 'cajasConformes')}
                            placeholder="0"
                            style={{
                              width: 60,
                              padding: '5px',
                              textAlign: 'center',
                              borderRadius: 6,
                              border: '1px solid #86EFAC',
                              fontWeight: 700,
                              color: '#15803D',
                              backgroundColor: '#F0FDF4',
                            }}
                          />
                          {(() => {
                            const sanasExist = item.cajasSanasExistentes || 0;
                            const rescExist = item.cajasRescatadasExistentes || 0;
                            const sanasNuevas = item.cajasSanasNuevas || 0;
                            const sanasFisicas = sanasExist > 0 ? sanasExist : Math.max(0, (Number(item.cajasConformes) || 0) - rescExist);

                            if (hasGeneratedLabels || sanasExist > 0) {
                              return (
                                <div style={{ fontSize: 9.5, color: '#047857', fontWeight: 600, marginTop: 2 }}>
                                  ({sanasFisicas} sanas generadas{rescExist > 0 ? ` + ${rescExist} de Calidad` : ''}{sanasNuevas > 0 ? ` · ${sanasNuevas} pendientes` : ''})
                                </div>
                              );
                            }

                            return rescExist > 0 ? (
                              <div style={{ fontSize: 9.5, color: '#047857', fontWeight: 600, marginTop: 2 }}>
                                ({sanasNuevas} sanas por crear + {rescExist} de Calidad)
                              </div>
                            ) : (
                              <div style={{ fontSize: 9.5, color: '#047857', marginTop: 2 }}>
                                ({sanasNuevas} sanas por crear)
                              </div>
                            );
                          })()}
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                          <input
                            type="text"
                            inputMode="numeric"
                            value={item.cajasDanadas}
                            onFocus={(e) => e.target.select()}
                            onChange={(e) => handleBreakdownInputChange(item.receiptLineId, 'cajasDanadas', e.target.value)}
                            onBlur={() => handleBreakdownInputBlur(item.receiptLineId, 'cajasDanadas')}
                            placeholder="0"
                            style={{
                              width: 60,
                              padding: '5px',
                              textAlign: 'center',
                              borderRadius: 6,
                              border: '1px solid #FDE68A',
                              fontWeight: 700,
                              color: '#B45309',
                              backgroundColor: '#FFFBEB',
                            }}
                          />
                          {(item.cajasDanadasHistoricas ?? 0) > 0 ? (
                            <div style={{ fontSize: 9.5, color: '#92400E', marginTop: 2 }}>
                              ({item.cajasDanadasHistoricas} histórica en Calidad)
                            </div>
                          ) : null}
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 800, color: faltantes > 0 ? '#DC2626' : '#64748B' }}>
                          {faltantes > 0 ? (
                            <span style={{ padding: '2px 6px', borderRadius: 4, backgroundColor: '#FEF2F2', border: '1px solid #FECACA' }}>
                              {faltantes} (Sin etiqueta)
                            </span>
                          ) : (
                            '0'
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* BALANCE COMPARATIVO EN VIVO */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, fontSize: 11.5 }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ color: '#475569' }}>
                  {hasGeneratedLabels || totalSanasExistentes > 0 ? 'Composición física activa:' : 'Total físico conforme a etiquetar:'}{' '}
                  <strong style={{ color: '#0F172A', fontSize: 13 }}>{totalConformesConfiguradas} Cajas físicas activas</strong>{' '}
                  <span style={{ color: '#0D9488', fontWeight: 700 }}>
                    {hasGeneratedLabels || totalSanasExistentes > 0 ? (
                      <>
                        ({totalSanasGeneradasExistentes} Sanas generadas/existentes{totalRescatadasExistentes > 0 ? ` + ${totalRescatadasExistentes} Reacondicionada de Calidad` : ''}{totalNuevasCrear > 0 ? ` · ${totalNuevasCrear} pendientes por generar` : ''})
                      </>
                    ) : (
                      <>
                        ({totalNuevasCrear} Sanas nuevas por crear{totalRescatadasExistentes > 0 ? ` + ${totalRescatadasExistentes} Reacondicionada de Calidad` : ''})
                      </>
                    )}
                  </span>
                </span>
                {totalDanadasConfiguradas > 0 && (
                  <span style={{ color: '#D97706', fontWeight: 700 }}>
                    • {totalDanadasConfiguradas} Dañadas operativas
                  </span>
                )}
                {totalFaltantesConfiguradas > 0 && (
                  <span style={{ color: '#DC2626', fontWeight: 700 }}>
                    • {totalFaltantesConfiguradas} Caja faltante (NO genera HU)
                  </span>
                )}
                {totalDanadasHistoricas > 0 && (
                  <span style={{ color: '#64748B', fontWeight: 600 }}>
                    • {totalDanadasHistoricas} Dañada histórica / inactiva fuera de la tarima
                  </span>
                )}
              </div>

              {receipt?.bultosRecibidos !== undefined && (
                <div style={{
                  padding: '4px 10px',
                  borderRadius: 6,
                  fontSize: 11,
                  fontWeight: 700,
                  backgroundColor: isCuadradoConRampa ? '#DCFCE7' : '#FEF3C7',
                  color: isCuadradoConRampa ? '#15803D' : '#92400E',
                  border: `1px solid ${isCuadradoConRampa ? '#BBF7D0' : '#FDE68A'}`,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4
                }}>
                  {isCuadradoConRampa ? (
                    <><CheckCircle2 size={12} /> Cuadrado con Acta de Rampa ({receipt.bultosRecibidos} bultos recibidos: {totalSanasGeneradasExistentes} sanos{totalRescatadasExistentes > 0 ? ` + ${totalRescatadasExistentes} procesado en Calidad` : ''}{totalFaltantesConfiguradas > 0 ? ` · ${totalFaltantesConfiguradas} faltante` : ''}{receipt.bultosDeclarados ? ` respecto a ${receipt.bultosDeclarados} declarados` : ''})</>
                  ) : (
                    <><AlertTriangle size={12} /> Difiere del Acta de Rampa (Recibidas: {receipt.bultosRecibidos}, Conformes: {totalConformesConfiguradas})</>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* BARRA DE ACCIÓN PRINCIPAL DE GENERACIÓN Y CONFIRMACIÓN */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 18,
              padding: '12px 16px',
              backgroundColor: '#F8FAFC',
              borderRadius: 10,
              border: '1px solid #E2E8F0',
              flexWrap: 'wrap',
              gap: 12,
            }}
          >
            {/* LADO IZQUIERDO: GENERAR O RE-GENERAR Y BOTONES DE IMPRESIÓN CON TAMAÑOS EXPLÍCITOS */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={handleGenerateLabels}
                disabled={generating || totalConformesConfiguradas === 0}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '8px 14px',
                  borderRadius: 8,
                  fontSize: 12.5,
                  fontWeight: 700,
                  backgroundColor: estadoCiclo === 'PENDIENTE' ? '#0D9488' : '#FFFFFF',
                  border: `1px solid ${estadoCiclo === 'PENDIENTE' ? '#0D9488' : '#CBD5E1'}`,
                  color: estadoCiclo === 'PENDIENTE' ? '#FFFFFF' : '#334155',
                  cursor: generating || totalConformesConfiguradas === 0 ? 'not-allowed' : 'pointer',
                  boxShadow: estadoCiclo === 'PENDIENTE' ? '0 2px 4px rgba(13,148,136,0.3)' : 'none',
                }}
              >
                <RefreshCw size={14} className={generating ? 'spin' : ''} />
                {generating
                  ? 'Generando...'
                  : totalNuevasCrear > 0
                  ? (estadoCiclo === 'PENDIENTE'
                      ? `Generar Doble Etiquetado (${totalNuevasCrear} Cajas Nuevas · ${totalConformesConfiguradas} Físicas Activas)`
                      : `Regenerar (${totalNuevasCrear} Cajas Nuevas · ${totalConformesConfiguradas} Físicas Activas)`)
                  : `Etiquetas ya Generadas (${totalConformesConfiguradas} Cajas en Tarima)`}
              </button>

              {/* Botón Tirada Cajas: 100 x 50 mm */}
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <button
                  type="button"
                  onClick={() =>
                    handleOpenPrintWindow(
                      'CAJAS',
                      selectedBoxIds.length > 0 && selectedBoxIds.length < totalBoxesCount
                        ? selectedBoxIds
                        : undefined
                    )
                  }
                  disabled={printing || totalBoxesCount === 0 || (selectedBoxIds.length === 0 && totalBoxesCount > 0)}
                  title="Imprimir etiquetas de caja en rollo de 100 × 50 mm"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '8px 14px',
                    borderRadius: 8,
                    fontSize: 12.5,
                    fontWeight: 700,
                    backgroundColor: '#0F172A',
                    border: '1px solid #0F172A',
                    color: '#FFFFFF',
                    cursor:
                      printing || totalBoxesCount === 0 || (selectedBoxIds.length === 0 && totalBoxesCount > 0)
                        ? 'not-allowed'
                        : 'pointer',
                  }}
                >
                  <Box size={14} />
                  {selectedBoxIds.length > 0 && selectedBoxIds.length < totalBoxesCount
                    ? `Imprimir Cajas Marcadas (${selectedBoxIds.length})`
                    : `Imprimir Cajas (100×50 mm) [${totalBoxesCount}]`}
                </button>
                {selectedBoxIds.length > 0 && selectedBoxIds.length < totalBoxesCount && (
                  <button
                    type="button"
                    onClick={() => handleOpenPrintWindow('CAJAS', undefined)}
                    title="Mandar a imprimir todas las cajas del previo (100×50 mm)"
                    style={{
                      padding: '8px 10px',
                      borderRadius: 8,
                      fontSize: 12,
                      fontWeight: 600,
                      backgroundColor: '#FFFFFF',
                      border: '1px solid #CBD5E1',
                      color: '#475569',
                      cursor: 'pointer',
                    }}
                  >
                    Todas ({totalBoxesCount})
                  </button>
                )}
              </div>

              {/* Botón Tirada Tarimas: 100 x 150 mm */}
              <button
                type="button"
                onClick={() => handleOpenPrintWindow('PALLETS')}
                disabled={printing || totalPalletsCount === 0}
                title="Imprimir etiquetas de tarima master en rollo de 100 × 150 mm (4x6 pulg)"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '8px 14px',
                  borderRadius: 8,
                  fontSize: 12.5,
                  fontWeight: 700,
                  backgroundColor: '#1E293B',
                  border: '1px solid #1E293B',
                  color: '#FFFFFF',
                  cursor: printing || totalPalletsCount === 0 ? 'not-allowed' : 'pointer',
                }}
              >
                <Layers size={14} />
                Imprimir Tarima (100×150 mm) [{totalPalletsCount}]
              </button>

              {/* Botón Todo el Lote */}
              <button
                type="button"
                onClick={() => handleOpenPrintWindow('TODAS')}
                disabled={printing || totalBoxesCount === 0}
                title="Imprimir todas las etiquetas en secuencia"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '8px 12px',
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: 600,
                  backgroundColor: '#FFFFFF',
                  border: '1px solid #CBD5E1',
                  color: '#334155',
                  cursor: printing || totalBoxesCount === 0 ? 'not-allowed' : 'pointer',
                }}
              >
                <Printer size={13} />
                Lote Completo ({totalBoxesCount + totalPalletsCount})
              </button>
            </div>

            {/* LADO DERECHO: CONFIRMAR COLOCACIÓN FÍSICA EN ANDÉN (CONTROL SECUENCIAL ESTRICTO) */}
            {estadoCiclo === 'GENERADAS' && totalBoxesCount > 0 && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 12px',
                  backgroundColor: '#F1F5F9',
                  borderRadius: 8,
                  border: '1px dashed #CBD5E1',
                }}
                title="Primero debe imprimir y confirmar físicamente las etiquetas antes de registrar su colocación"
              >
                <Clock size={16} color="#64748B" />
                <div style={{ fontSize: 11, color: '#64748B' }}>
                  <strong>Paso 3 Bloqueado:</strong> Imprima y confirme las etiquetas físicas (Paso 2) antes de registrar la colocación.
                </div>
              </div>
            )}

            {estadoCiclo === 'IMPRESAS' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="text"
                  value={colocadorNombre}
                  onChange={(e) => setColocadorNombre(e.target.value)}
                  placeholder="Nombre de quien colocó las etiquetas"
                  style={{
                    padding: '7px 10px',
                    borderRadius: 6,
                    border: '1px solid #CBD5E1',
                    fontSize: 12,
                    width: 190,
                  }}
                />
                <button
                  type="button"
                  onClick={handleConfirmPlacement}
                  disabled={confirming || !colocadorNombre.trim()}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '8px 16px',
                    borderRadius: 8,
                    fontSize: 12.5,
                    fontWeight: 700,
                    backgroundColor: '#16A34A',
                    border: '1px solid #16A34A',
                    color: '#FFFFFF',
                    cursor: confirming || !colocadorNombre.trim() ? 'not-allowed' : 'pointer',
                    boxShadow: '0 2px 4px rgba(22,163,74,0.25)',
                  }}
                >
                  <CheckCircle2 size={15} />
                  {confirming ? 'Confirmando...' : 'Confirmar Colocación Física'}
                </button>
              </div>
            )}

            {estadoCiclo === 'COLOCADAS' && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 14px',
                  backgroundColor: '#DCFCE7',
                  borderRadius: 8,
                  border: '1px solid #86EFAC',
                }}
              >
                <CheckCircle2 size={16} color="#16A34A" />
                <div style={{ fontSize: 12, fontWeight: 700, color: '#166534' }}>
                  Etiquetas colocadas en físico por {labelsData?.etiquetasColocadasPor || labelsData?.colocadoPor || receipt?.etiquetasColocadasPor || 'Jonathan Palacios'}
                </div>
              </div>
            )}
          </div>

          {/* TARJETA DE CONFIRMACIÓN DE EMISIÓN FÍSICA POR EL OPERADOR */}
          {pendingPrintConfirm && (
            <div
              style={{
                marginBottom: 18,
                padding: '14px 18px',
                borderRadius: 10,
                backgroundColor: '#EFF6FF',
                border: '1.5px solid #60A5FA',
                boxShadow: '0 4px 6px -1px rgba(59, 130, 246, 0.1)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ display: 'flex', gap: 12 }}>
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: '50%',
                      backgroundColor: '#2563EB',
                      color: '#FFFFFF',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <Printer size={18} />
                  </div>
                  <div>
                    <h4 style={{ margin: '0 0 4px 0', fontSize: 13.5, fontWeight: 700, color: '#1E3A8A' }}>
                      Paso de Verificación: Se envió el documento a la impresora
                    </h4>
                    <p style={{ margin: '0 0 8px 0', fontSize: 12, color: '#1E40AF', lineHeight: 1.4 }}>
                      Se abrió la ventana de impresión térmica para <strong>{pendingPrintConfirm.description}</strong>.
                      <br />
                      Abrir el diálogo de impresión no acredita que el papel haya salido del equipo. Compruebe físicamente que las etiquetas hayan salido legibles, completas y sin códigos cortados.
                    </p>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        onClick={handleConfirmPrintSuccess}
                        disabled={confirmingPrint}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          padding: '7px 14px',
                          borderRadius: 6,
                          fontSize: 12.5,
                          fontWeight: 700,
                          backgroundColor: '#2563EB',
                          color: '#FFFFFF',
                          border: 'none',
                          cursor: confirmingPrint ? 'not-allowed' : 'pointer',
                          boxShadow: '0 2px 4px rgba(37,99,235,0.25)',
                        }}
                      >
                        <CheckCircle2 size={14} />
                        {confirmingPrint ? 'Registrando...' : 'Confirmar que las etiquetas se imprimieron correctamente en físico'}
                      </button>

                      <button
                        type="button"
                        onClick={() => triggerThermalPrintWindow(pendingPrintConfirm.tipo, pendingPrintConfirm.huIds)}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          padding: '7px 12px',
                          borderRadius: 6,
                          fontSize: 12,
                          fontWeight: 600,
                          backgroundColor: '#FFFFFF',
                          color: '#1E40AF',
                          border: '1px solid #93C5FD',
                          cursor: 'pointer',
                        }}
                      >
                        <RefreshCw size={12} />
                        Reabrir diálogo de impresión
                      </button>

                      <button
                        type="button"
                        onClick={() => setPendingPrintConfirm(null)}
                        style={{
                          padding: '7px 12px',
                          borderRadius: 6,
                          fontSize: 12,
                          color: '#64748B',
                          backgroundColor: 'transparent',
                          border: 'none',
                          cursor: 'pointer',
                        }}
                      >
                        Descartar (Aún no se imprimen)
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* PESTAÑAS (TABS): TARIMAS MASTER VS CAJAS ÚNICAS */}
          <div
            style={{
              display: 'flex',
              borderBottom: '1px solid #E2E8F0',
              marginBottom: 16,
              gap: 8,
            }}
          >
            <button
              type="button"
              onClick={() => setActiveTab('PALLETS')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 18px',
                border: 'none',
                borderBottom: `2px solid ${activeTab === 'PALLETS' ? '#0D9488' : 'transparent'}`,
                backgroundColor: 'transparent',
                color: activeTab === 'PALLETS' ? '#0D9488' : '#64748B',
                fontWeight: activeTab === 'PALLETS' ? 700 : 500,
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              <Layers size={16} />
              Tarimas Master (Pallets) ({totalPalletsCount})
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('BOXES')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 18px',
                border: 'none',
                borderBottom: `2px solid ${activeTab === 'BOXES' ? '#0D9488' : 'transparent'}`,
                backgroundColor: 'transparent',
                color: activeTab === 'BOXES' ? '#0D9488' : '#64748B',
                fontWeight: activeTab === 'BOXES' ? 700 : 500,
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              <Box size={16} />
              Cajas Únicas (Boxes) ({totalBoxesCount})
            </button>
          </div>

          {/* CONTENIDO TAB 1: TARIMAS MASTER */}
          {activeTab === 'PALLETS' && (
            <div>
              {loading ? (
                <div style={{ textAlign: 'center', padding: 40, color: '#64748B' }}>
                  Cargando tarimas master...
                </div>
              ) : (labelsData?.pallets || []).length === 0 ? (
                <div
                  style={{
                    textAlign: 'center',
                    padding: 40,
                    backgroundColor: '#F8FAFC',
                    borderRadius: 10,
                    border: '1px dashed #CBD5E1',
                  }}
                >
                  <Layers size={36} style={{ color: '#94A3B8', marginBottom: 10 }} />
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#334155' }}>
                    No se han generado Tarimas Master para este previo
                  </div>
                  <p style={{ fontSize: 12, color: '#64748B', maxWidth: 450, margin: '6px auto 14px auto' }}>
                    Revise la clasificación física de cajas en la parte superior y haga clic en «Generar Doble Etiquetado» para emitir las tarimas y cajas físicas efectivamente descargadas.
                  </p>
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: 16 }}>
                  {labelsData.pallets.map((plt: any) => (
                    <div
                      key={plt.id}
                      style={{
                        backgroundColor: '#FFFFFF',
                        border: '1px solid #E2E8F0',
                        borderRadius: 10,
                        padding: 16,
                        boxShadow: '0 2px 4px rgba(0,0,0,0.03)',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                      }}
                    >
                      <div>
                        {/* HEADER DE TARIMA */}
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'flex-start',
                            marginBottom: 12,
                          }}
                        >
                          <div>
                            <span
                              style={{
                                fontSize: 10,
                                fontWeight: 800,
                                color: '#0D9488',
                                textTransform: 'uppercase',
                                letterSpacing: '0.04em',
                              }}
                            >
                              TARIMA MASTER (PALLET)
                            </span>
                            <div style={{ fontSize: 16, fontWeight: 800, color: '#0F172A' }}>{plt.codigo}</div>
                          </div>
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 700,
                              backgroundColor: '#EFF6FF',
                              color: '#1D4ED8',
                              padding: '2px 8px',
                              borderRadius: 12,
                              border: '1px solid #BFDBFE',
                            }}
                          >
                            {plt.totalCajas} Cajas Contenidas
                          </span>
                        </div>

                        {/* CUERPO CON QR Y METADATOS */}
                        <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginBottom: 12 }}>
                          <div
                            style={{
                              padding: 6,
                              backgroundColor: '#FFFFFF',
                              border: '1px solid #E2E8F0',
                              borderRadius: 8,
                              textAlign: 'center',
                            }}
                          >
                            {qrCodeUrls[plt.id] ? (
                              <img
                                src={qrCodeUrls[plt.id]}
                                alt={`QR ${plt.codigo}`}
                                style={{ width: 90, height: 90 }}
                              />
                            ) : (
                              <div style={{ width: 90, height: 90, backgroundColor: '#F1F5F9' }} />
                            )}
                            <div style={{ fontSize: 9, color: '#64748B', fontWeight: 600, marginTop: 2 }}>
                              2D QR MASTER
                            </div>
                          </div>

                          <div style={{ fontSize: 11.5, color: '#334155', lineHeight: 1.5, flex: 1 }}>
                            <div>
                              <strong>SKUs en Pallet:</strong>{' '}
                              <span style={{ color: '#0F172A' }}>
                                {plt.skus && Array.isArray(plt.skus) && plt.skus.length > 0
                                  ? plt.skus.join(', ')
                                  : (plt.skusDesglose ? Object.keys(plt.skusDesglose).join(', ') : 'N/A')}
                              </span>
                            </div>
                            <div>
                              <strong>Factura:</strong> {receipt.facturaRespaldo || receipt.ocReferencia || 'S/N'}
                            </div>
                            <div>
                              <strong>Total Cajas:</strong> {plt.totalCajas} unidades físicas
                            </div>
                            <div>
                              <strong>Estatus Etiqueta:</strong>{' '}
                              <span
                                style={{
                                  fontWeight: 700,
                                  color:
                                    (plt.boxes || plt.cajas)?.[0]?.estadoEtiqueta === 'COLOCADA'
                                      ? '#16A34A'
                                      : (plt.boxes || plt.cajas)?.[0]?.estadoEtiqueta === 'IMPRESA'
                                      ? '#0284C7'
                                      : '#64748B',
                                }}
                              >
                                {(plt.boxes || plt.cajas)?.[0]?.estadoEtiqueta || plt.estadoEtiqueta || 'GENERADA'}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* ACCIONES DE TARIMA */}
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          borderTop: '1px solid #F1F5F9',
                          paddingTop: 10,
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedPalletFilter(plt.id);
                            setActiveTab('BOXES');
                          }}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: '#0D9488',
                            fontSize: 11.5,
                            fontWeight: 700,
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                          }}
                        >
                          Ver {plt.totalCajas} Cajas Contenidas <ArrowRight size={12} />
                        </button>

                        <button
                          type="button"
                          onClick={() => handleOpenPrintWindow('PALLETS', [plt.id])}
                          style={{
                            padding: '4px 10px',
                            borderRadius: 6,
                            backgroundColor: '#F8FAFC',
                            border: '1px solid #CBD5E1',
                            color: '#334155',
                            fontSize: 11.5,
                            fontWeight: 600,
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                          }}
                        >
                          <Printer size={12} /> Imprimir Tarima (100×150 mm)
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* CONTENIDO TAB 2: CAJAS ÚNICAS */}
          {activeTab === 'BOXES' && (
            <div>
              {/* BARRA DE HERRAMIENTAS: FILTROS, SELECTORES Y ACCIÓN DE IMPRESIÓN */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 14,
                  flexWrap: 'wrap',
                  gap: 10,
                  backgroundColor: '#F8FAFC',
                  padding: '10px 14px',
                  borderRadius: 8,
                  border: '1px solid #E2E8F0',
                }}
              >
                {/* Lado izquierdo: Filtro de tarima matriz y botones de selección rápida */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#64748B' }}>Tarima Matriz:</span>
                  <select
                    value={selectedPalletFilter}
                    onChange={(e) => setSelectedPalletFilter(e.target.value)}
                    style={{
                      padding: '5px 10px',
                      borderRadius: 6,
                      border: '1px solid #CBD5E1',
                      fontSize: 12,
                      color: '#0F172A',
                      backgroundColor: '#FFFFFF',
                    }}
                  >
                    <option value="ALL">Todas las tarimas ({allBoxes.length} cajas)</option>
                    {(labelsData?.pallets || []).map((p: any) => (
                      <option key={p.id} value={p.id}>
                        {p.codigo} ({p.totalCajas} cajas)
                      </option>
                    ))}
                  </select>

                  <div style={{ height: 18, width: 1, backgroundColor: '#CBD5E1', margin: '0 4px' }} />

                  {/* Botones de selección rápida */}
                  <span style={{ fontSize: 11.5, color: '#64748B', fontWeight: 600 }}>Selección:</span>
                  <button
                    type="button"
                    onClick={handleSelectAllBoxes}
                    style={{
                      padding: '3px 8px',
                      borderRadius: 4,
                      fontSize: 11,
                      fontWeight: 600,
                      backgroundColor: selectedBoxIds.length === filteredBoxes.length ? '#0D9488' : '#FFFFFF',
                      color: selectedBoxIds.length === filteredBoxes.length ? '#FFFFFF' : '#334155',
                      border: '1px solid #CBD5E1',
                      cursor: 'pointer',
                    }}
                  >
                    Todas ({filteredBoxes.length})
                  </button>

                  {filteredBoxes.some((b: any) => b.reacondicionada || b.cajaOrigenId || b.estadoEtiqueta !== 'COLOCADA') && (
                    <button
                      type="button"
                      onClick={handleSelectOnlyNewOrPending}
                      style={{
                        padding: '3px 8px',
                        borderRadius: 4,
                        fontSize: 11,
                        fontWeight: 700,
                        backgroundColor: '#DCFCE7',
                        color: '#15803D',
                        border: '1px solid #86EFAC',
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 3,
                      }}
                      title="Seleccionar únicamente las cajas generadas o reacondicionadas pendientes de rotular"
                    >
                      <Sparkles size={11} />
                      Solo Nuevas / Pendientes ({filteredBoxes.filter((b: any) => b.reacondicionada || b.cajaOrigenId || b.estadoEtiqueta !== 'COLOCADA').length})
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={handleDeselectAllBoxes}
                    disabled={selectedBoxIds.length === 0}
                    style={{
                      padding: '3px 8px',
                      borderRadius: 4,
                      fontSize: 11,
                      fontWeight: 500,
                      backgroundColor: '#FFFFFF',
                      color: '#64748B',
                      border: '1px solid #E2E8F0',
                      cursor: selectedBoxIds.length === 0 ? 'not-allowed' : 'pointer',
                    }}
                  >
                    Desmarcar
                  </button>
                </div>

                {/* Lado derecho: Botón principal de impresión de selección */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => handleOpenPrintWindow('CAJAS', selectedBoxIds)}
                    disabled={selectedBoxIds.length === 0}
                    style={{
                      padding: '6px 14px',
                      borderRadius: 6,
                      backgroundColor: selectedBoxIds.length > 0 ? '#0F172A' : '#E2E8F0',
                      border: 'none',
                      color: selectedBoxIds.length > 0 ? '#FFFFFF' : '#94A3B8',
                      fontSize: 12.5,
                      fontWeight: 700,
                      cursor: selectedBoxIds.length === 0 ? 'not-allowed' : 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      boxShadow: selectedBoxIds.length > 0 ? '0 2px 4px rgba(15,23,42,0.2)' : 'none',
                    }}
                  >
                    <Printer size={13} />
                    Imprimir Cajas Marcadas (100×50 mm) [{selectedBoxIds.length} de {filteredBoxes.length}]
                  </button>
                </div>
              </div>

              {/* LISTA / TABLA DE CAJAS */}
              {filteredBoxes.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 40, color: '#64748B' }}>
                  No hay cajas disponibles para el filtro seleccionado.
                </div>
              ) : (
                <div
                  style={{
                    border: '1px solid #E2E8F0',
                    borderRadius: 8,
                    overflowX: 'auto',
                    overflowY: 'auto',
                    maxHeight: 460,
                    backgroundColor: '#FFFFFF',
                  }}
                >
                  <table style={{ width: '100%', minWidth: 980, borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead style={{ position: 'sticky', top: 0, backgroundColor: '#F8FAFC', zIndex: 10 }}>
                      <tr style={{ textAlign: 'left', borderBottom: '1px solid #E2E8F0', color: '#64748B' }}>
                        <th style={{ padding: '8px 8px', width: 36, textAlign: 'center' }}>
                          <input
                            type="checkbox"
                            checked={filteredBoxes.length > 0 && selectedBoxIds.length === filteredBoxes.length}
                            ref={(el) => {
                              if (el) {
                                el.indeterminate =
                                  selectedBoxIds.length > 0 && selectedBoxIds.length < filteredBoxes.length;
                              }
                            }}
                            onChange={(e) =>
                              e.target.checked ? handleSelectAllBoxes() : handleDeselectAllBoxes()
                            }
                            title="Seleccionar / Deseleccionar todas"
                            style={{ cursor: 'pointer', width: 16, height: 16, accentColor: '#0D9488' }}
                          />
                        </th>
                        <th style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>ID Único de Caja</th>
                        <th style={{ padding: '8px 10px' }}>SKU & Descripción</th>
                        <th style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>Lote / Caducidad</th>
                        <th style={{ padding: '8px 8px', textAlign: 'center', whiteSpace: 'nowrap' }}>Pzas/Caja</th>
                        <th style={{ padding: '8px 8px', whiteSpace: 'nowrap' }}>Tarima Matriz</th>
                        <th style={{ padding: '8px 8px', whiteSpace: 'nowrap' }}>Condición Física</th>
                        <th style={{ padding: '8px 8px', whiteSpace: 'nowrap' }}>Estatus Etiqueta</th>
                        <th style={{ padding: '8px 10px', textAlign: 'right', whiteSpace: 'nowrap' }}>Acción</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredBoxes.map((b: any) => {
                        const isDamaged = isHuDamaged(b);
                        const isSelected = selectedBoxIds.includes(b.id);
                        const isReacondicionada = Boolean(b.reacondicionada || b.cajaOrigenId);

                        const matchingLine = findMatchingReceiptLine(b, receipt.lineas || []);
                        const stdPackSize = resolvePackagingCapacity(b, matchingLine);
                        const pzas = Number(b.cantidad ?? b.piezasPorCaja ?? (stdPackSize ?? 0));
                        const isPartial = isReacondicionada && stdPackSize !== null && stdPackSize > 0 && pzas < stdPackSize;

                        return (
                          <tr
                            key={b.id}
                            style={{
                              borderBottom: '1px solid #F1F5F9',
                              backgroundColor: isSelected
                                ? '#F0FDFA'
                                : isDamaged
                                ? '#FFFDF5'
                                : '#FFFFFF',
                              transition: 'background-color 0.15s ease',
                            }}
                          >
                            <td style={{ padding: '8px 8px', textAlign: 'center' }}>
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => handleToggleBoxSelect(b.id)}
                                style={{ cursor: 'pointer', width: 16, height: 16, accentColor: '#0D9488' }}
                              />
                            </td>
                            <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ fontWeight: 800, color: '#0F172A', fontFamily: 'monospace' }}>
                                  {b.codigo}
                                </span>
                                {isReacondicionada && (
                                  <span
                                    style={{
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: 3,
                                      fontSize: 9.5,
                                      fontWeight: 800,
                                      backgroundColor: isPartial ? '#FEF3C7' : '#DCFCE7',
                                      color: isPartial ? '#92400E' : '#15803D',
                                      border: `1px solid ${isPartial ? '#FDE68A' : '#86EFAC'}`,
                                      borderRadius: 4,
                                      padding: '1px 5px',
                                      letterSpacing: '0.02em',
                                    }}
                                  >
                                    <Sparkles size={10} /> {isPartial ? 'PARCIAL · REACONDICIONADA' : 'REACONDICIONADA'}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td style={{ padding: '8px 10px' }}>
                              <div style={{ fontWeight: 700, color: isDamaged ? '#B45309' : '#0D9488' }}>
                                {b.skuCodigo}
                              </div>
                              <div style={{ fontSize: 11, color: '#64748B', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {b.skuDescripcion}
                              </div>
                            </td>
                            <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                              <div style={{ fontWeight: 600 }}>{b.loteTexto || '—'}</div>
                              <div style={{ fontSize: 10.5, color: '#64748B' }}>
                                {b.fechaVencimiento ? String(b.fechaVencimiento).slice(0, 10) : 'Sin caducidad'}
                              </div>
                            </td>
                            <td style={{ padding: '8px 8px', textAlign: 'center', fontWeight: 700, color: '#0F172A', whiteSpace: 'nowrap' }}>
                              {isPartial ? (
                                <span style={{ color: '#B45309', fontSize: 11 }}>
                                  Parcial: {pzas} de {stdPackSize} pz
                                </span>
                              ) : pzas > 0 ? (
                                `${pzas} pzas`
                              ) : stdPackSize !== null ? (
                                `${stdPackSize} pzas`
                              ) : (
                                '—'
                              )}
                            </td>
                            <td style={{ padding: '8px 8px', fontSize: 11, color: '#475569', whiteSpace: 'nowrap' }}>
                              {b.parentPalletCode}
                            </td>
                            <td style={{ padding: '8px 8px', whiteSpace: 'nowrap' }}>
                              {isDamaged ? (
                                <span
                                  style={{
                                    fontSize: 10,
                                    fontWeight: 700,
                                    padding: '2px 6px',
                                    borderRadius: 6,
                                    backgroundColor: '#FEF3C7',
                                    color: '#B45309',
                                    border: '1px solid #FDE68A',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 3,
                                  }}
                                >
                                  <AlertTriangle size={11} /> Daño Exterior
                                </span>
                              ) : isReacondicionada ? (
                                <span
                                  style={{
                                    fontSize: 10,
                                    fontWeight: 700,
                                    padding: '2px 6px',
                                    borderRadius: 6,
                                    backgroundColor: '#DCFCE7',
                                    color: '#15803D',
                                    border: '1px solid #BBF7D0',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 3,
                                  }}
                                >
                                  <Check size={11} /> Rescatada Conforme
                                </span>
                              ) : (
                                <span
                                  style={{
                                    fontSize: 10,
                                    fontWeight: 700,
                                    padding: '2px 6px',
                                    borderRadius: 6,
                                    backgroundColor: '#DCFCE7',
                                    color: '#15803D',
                                    border: '1px solid #BBF7D0',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 3,
                                  }}
                                >
                                  <Check size={11} /> Conforme
                                </span>
                              )}
                            </td>
                            <td style={{ padding: '8px 8px', whiteSpace: 'nowrap' }}>
                              <span
                                style={{
                                  fontSize: 10,
                                  fontWeight: 700,
                                  padding: '2px 6px',
                                  borderRadius: 6,
                                  backgroundColor:
                                    b.estadoEtiqueta === 'COLOCADA'
                                      ? '#DCFCE7'
                                      : b.estadoEtiqueta === 'IMPRESA'
                                      ? '#E0F2FE'
                                      : '#F1F5F9',
                                  color:
                                    b.estadoEtiqueta === 'COLOCADA'
                                      ? '#15803D'
                                      : b.estadoEtiqueta === 'IMPRESA'
                                      ? '#0369A1'
                                      : '#64748B',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 3,
                                }}
                              >
                                {b.estadoEtiqueta === 'COLOCADA' && <Check size={10} />}
                                {b.estadoEtiqueta || 'GENERADA'}
                              </span>
                            </td>
                            <td style={{ padding: '8px 10px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                              <button
                                type="button"
                                onClick={() => handleOpenPrintWindow('CAJAS', [b.id])}
                                title="Imprimir únicamente esta etiqueta de caja (100×50 mm)"
                                style={{
                                  padding: '4px 10px',
                                  borderRadius: 6,
                                  backgroundColor: '#FFFFFF',
                                  border: '1px solid #CBD5E1',
                                  color: '#334155',
                                  fontSize: 11,
                                  fontWeight: 600,
                                  cursor: 'pointer',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 4,
                                }}
                              >
                                <Printer size={12} /> Imprimir 1 sola
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        {/* PIE DEL MODAL */}
        <div
          style={{
            padding: '12px 24px',
            backgroundColor: '#F8FAFC',
            borderTop: '1px solid #E2E8F0',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div style={{ fontSize: 11, color: '#64748B' }}>
            Doble Etiquetado Giving Out: Master Pallet (100×150 mm) + Cajas Únicas (100×50 mm) • Cero ubicación física fija impresa en andén
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '8px 18px',
              borderRadius: 6,
              backgroundColor: '#FFFFFF',
              border: '1px solid #CBD5E1',
              color: '#334155',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
