import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Printer, X, FileText, Layers, Box, RotateCcw,
  CheckCircle2, AlertTriangle, Truck, Package,
  MapPin, Calendar, ShieldCheck, Check, Info
} from 'lucide-react';
import JsBarcode from 'jsbarcode';
import { API } from '../config/api';
import { formatCalendarDate, formatDateTime } from '../utils/dateUtils';

export interface ReceiptReportModalProps {
  receipt: any;
  onClose: () => void;
  defaultMode?: 'RECEPCION' | 'DEVOLUCIONES';
}

export function ReceiptReportModal({ receipt, onClose }: ReceiptReportModalProps) {
  if (!receipt) return null;

  // Detección automática del tipo de operación guardado en base de datos
  const isDevolucion = receipt.tipoRecepcion === 'DEVOLUCION';

  // Modo de vista en pantalla: Solo Reporte Principal vs Vista con Anexos
  const [viewMode, setViewMode] = useState<'MAIN_ONLY' | 'WITH_ANNEXES'>('MAIN_ONLY');

  // Selección de anexos a incluir
  const [includeAnnexA, setIncludeAnnexA] = useState<boolean>(true); // Manifiesto de HUs
  const [includeAnnexB, setIncludeAnnexB] = useState<boolean>(true); // Bitácora de Inspección y Rescate
  const [includeAnnexC, setIncludeAnnexC] = useState<boolean>(true); // Salidas y Existencia Actual

  // Alcance de impresión: 'MAIN_ONLY' | 'FULL'
  const [printScope, setPrintScope] = useState<'MAIN_ONLY' | 'FULL'>('MAIN_ONLY');

  // Estados de datos enriquecidos desde backend
  const [loadingDetails, setLoadingDetails] = useState<boolean>(true);
  const [reportData, setReportData] = useState<any>(null);
  const [rampData, setRampData] = useState<any>(null);
  const [inspectionData, setInspectionData] = useState<any>(null);

  const barcodeSvgRef = useRef<SVGSVGElement>(null);

  // Carga aislada por folio para evitar contaminación cruzada de datos
  useEffect(() => {
    let isMounted = true;
    const identifier = receipt.id || receipt.codigo;

    setReportData(null);
    setRampData(null);
    setInspectionData(null);
    setLoadingDetails(true);

    async function fetchFullDetails() {
      try {
        const [repRes, rampaRes, inspRes] = await Promise.all([
          fetch(`${API}/receipts/${identifier}/report`).then(r => r.ok ? r.json() : null).catch(() => null),
          fetch(`${API}/receipts/${identifier}/acuse-rampa`).then(r => r.ok ? r.json() : null).catch(() => null),
          fetch(`${API}/receipts/${identifier}/inspection/report`).then(r => r.ok ? r.json() : null).catch(() => null),
        ]);

        if (isMounted) {
          if (repRes) setReportData(repRes);
          if (rampaRes) setRampData(rampaRes);
          if (inspRes) setInspectionData(inspRes);
        }
      } catch (err) {
        console.warn('Error al cargar datos del informe:', err);
      } finally {
        if (isMounted) setLoadingDetails(false);
      }
    }

    fetchFullDetails();
    return () => { isMounted = false; };
  }, [receipt.id, receipt.codigo]);

  // Metadatos consolidados
  const folioTransporte = receipt.codigo || receipt.folioTransporte || '—';
  const clienteNombre = receipt.cliente?.nombreComercial || receipt.cliente?.razonSocial || reportData?.receipt?.cliente?.nombreComercial || '—';
  
  // Factura y O.C. verificadas contra su origen real (sin sustitución artificial)
  const facturaRespaldo = receipt.facturaRespaldo || reportData?.receipt?.facturaRespaldo || '—';
  const rawOc = receipt.ocReferencia || reportData?.receipt?.ocReferencia || null;
  const ocReferenciaReal = (rawOc && rawOc !== facturaRespaldo) ? rawOc : null;

  // Metadatos específicos de Devolución (solo cuando correspondan y existan)
  const sucursalOrigen = receipt.sucursalOrigen || reportData?.receipt?.sucursalOrigen || (isDevolucion ? (receipt.origen || reportData?.receipt?.origen) : null);
  const motivoDevolucion = receipt.motivoDevolucion || reportData?.receipt?.motivoDevolucion || (isDevolucion ? (receipt.notas || reportData?.receipt?.notas) : null);
  const referenciaDevolucion = receipt.referenciaDevolucion || (isDevolucion ? (receipt.facturaRespaldo || receipt.ocReferencia) : null);
  const dictamenCalidad = receipt.dictamenCalidad || reportData?.receipt?.dictamenCalidad || null;

  // Datos de Rampa y Transporte
  const anden = rampData?.transporte?.anden || rampData?.transporte?.andenAsignado || receipt.andenAsignado || '—';
  const lineaTransporte = rampData?.transporte?.linea || rampData?.transporte?.lineaTransporte || receipt.lineaTransporte || '—';
  const choferNombre = rampData?.transporte?.chofer || rampData?.transporte?.nombreChofer || rampData?.firmas?.nombreChofer || receipt.nombreChofer || '—';
  const placa = rampData?.transporte?.placa || receipt.placa || '—';

  // Firma del Chofer (certifica exclusivamente entrega física en rampa)
  const firmaChoferBase64 = rampData?.firmas?.firmaChofer || receipt.firmaChofer || null;

  // Fechas y horas auditadas — Fuente oficial: AuditLog > Entidad específica
  const auditLogs: any[] = receipt.auditLogs || reportData?.receipt?.auditLogs || [];
  const auditPrevio = auditLogs.find((a: any) => ['CARGAR_PREVIO_EXCEL', 'CREAR_PREVIO', 'EDITAR_PREVIO'].includes(a.accion));
  const auditRampa = auditLogs.find((a: any) => ['ACTA_RAMPA_LIBERACION_CHOFER', 'CORRECCION_ACTA_RAMPA'].includes(a.accion));
  
  const fechaPrevioOficial = auditPrevio?.createdAt || receipt.createdAt || receipt.fechaRecepcion;
  const fechaPrevio = fechaPrevioOficial ? formatDateTime(fechaPrevioOficial) : '—';

  const fechaArribo = (receipt.fechaConfirmacion || receipt.fechaBloqueo)
    ? formatDateTime(receipt.fechaConfirmacion || receipt.fechaBloqueo)
    : (fechaPrevioOficial ? formatDateTime(fechaPrevioOficial) : '—');

  const fechaLiberacionChofer = auditRampa?.createdAt || rampData?.estadoRampa?.fechaLiberacionChofer || receipt.fechaLiberacionChofer
    ? formatDateTime(auditRampa?.createdAt || rampData?.estadoRampa?.fechaLiberacionChofer || receipt.fechaLiberacionChofer)
    : '—';

  const fechaInspeccionCalidad = reportData?.qualityInspection?.fechaInspeccion || inspectionData?.inspeccion?.fechaInspeccion
    ? formatDateTime(reportData?.qualityInspection?.fechaInspeccion || inspectionData?.inspeccion?.fechaInspeccion)
    : null;
  // Cierre oficial formal: solo se certifica si existe fechaCierre o AuditLog de cierre persistido
  const auditCierre = auditLogs.find((a: any) => a.accion === 'CIERRE_RECEPCION' || a.accion === 'CERRAR_RECEPCION');
  const isOfficiallyClosed = Boolean(receipt.fechaCierre || auditCierre || receipt.estado === 'CERRADO' || receipt.estado === 'CERRADA');
  const fechaCierreRecepcion = isOfficiallyClosed ? (receipt.fechaCierre ? formatDateTime(receipt.fechaCierre) : (auditCierre ? formatDateTime(auditCierre.createdAt) : null)) : null;
  const fechaEmisionReporte = formatDateTime(new Date());

  // Responsables auditados
  const receptorRampa = rampData?.firmas?.nombreReceptor || rampData?.recepcion?.nombreReceptor || receipt.nombreReceptor || '—';
  
  // Responsable de cierre: nombre formal con usuario/correo como dato complementario
  const rawCerradoPor = receipt.cerradoPor || receipt.bloqueadoPor || null;
  const responsableCierreNombre = receipt.nombreReceptor || 'Jonathan Palacios';
  const responsableCierreEmail = rawCerradoPor && rawCerradoPor.includes('@') ? rawCerradoPor : null;

  // Renderizado de código de barras Code-128
  useEffect(() => {
    if (barcodeSvgRef.current && folioTransporte && folioTransporte !== '—') {
      try {
        JsBarcode(barcodeSvgRef.current, folioTransporte, {
          format: 'CODE128',
          width: 1.4,
          height: 32,
          displayValue: false,
          margin: 0,
          background: 'transparent',
          lineColor: '#0F172A',
        });
      } catch (e) {
        console.warn('Error al generar código de barras:', e);
      }
    }
  }, [folioTransporte, loadingDetails]);

  // Cómputo matemático de piezas por partida
  const lineas = reportData?.lineas || receipt.lineas || [];
  let totalEsperadoPiezas = 0;
  let totalRecibidoPiezas = 0;
  let totalConformePiezas = 0;
  let totalMermaPiezas = 0;
  let totalFaltantePiezas = 0;

  const hasPieceClassification = Boolean(
    reportData?.hasPieceClassification ??
    (
      lineas.some((l: any) => Number(l.cantidadRecibida || l.cantidadConforme || 0) > 0 || Number(l.cantidadDanada || l.cantidadMerma || 0) > 0) ||
      (reportData?.handlingUnits || receipt.handlingUnits || []).length > 0 ||
      receipt.estado === 'CERRADO' || receipt.estado === 'CERRADA'
    )
  );

  const partidasProcesadas = lineas.map((line: any, idx: number) => {
    const esp = Number(line.cantidadEsperada ?? line.cantidadProgramada ?? 0);
    const conf = Number(line.cantidadConforme ?? line.cantidadRecibida ?? 0);
    const merma = Number(line.cantidadMerma ?? line.cantidadDanada ?? 0);
    const rec = line.cantidadRecibida !== undefined && line.cantidadConforme !== undefined
      ? Number(line.cantidadRecibida)
      : (conf + merma);
    const falt = hasPieceClassification ? Number(line.cantidadFaltante ?? Math.max(0, esp - rec)) : 0;

    totalEsperadoPiezas += esp;
    totalRecibidoPiezas += rec;
    totalConformePiezas += conf;
    totalMermaPiezas += merma;
    if (hasPieceClassification) {
      totalFaltantePiezas += falt;
    }

    return {
      partidaNum: idx + 1,
      skuCodigo: line.codigo || line.sku?.codigo || line.skuId || '—',
      descripcion: line.descripcion || line.sku?.descripcion || '—',
      lote: line.loteAsignado || line.loteEsperado || line.loteTexto || '—',
      caducidad: line.fechaVencimiento ? formatCalendarDate(line.fechaVencimiento) : '—',
      uom: line.uom || line.sku?.uomBase || 'PZA',
      esperadas: esp,
      recibidas: rec,
      conformes: conf,
      merma,
      faltantes: falt,
    };
  });

  // Métricas de bultos
  const bultosDeclarados = reportData?.resumenBultos?.bultosDeclarados ?? receipt.bultosDeclarados ?? receipt.bultosRecibidos ?? 0;
  const bultosRecibidos = reportData?.resumenBultos?.bultosRecibidos ?? receipt.bultosRecibidos ?? 0;
  const bultosDanados = reportData?.resumenBultos?.bultosDanados ?? receipt.bultosDanados ?? 0;
  const bultosSinDanoExterior = reportData?.resumenBultos?.bultosSinDanoExterior ?? Math.max(0, bultosRecibidos - bultosDanados);
  const bultosFaltantes = reportData?.resumenBultos?.bultosFaltantes ?? Math.max(0, bultosDeclarados - bultosRecibidos);

  // Unidades de Manejo (HUs)
  const handlingUnits: any[] = reportData?.handlingUnits || receipt.handlingUnits || [];
  const palletHus = handlingUnits.filter(h =>
    h.tipoHu === 'PALLET' ||
    h.tipoHu === 'TARIMA' ||
    handlingUnits.some((child: any) => child.parentHuId === h.id) ||
    ((typeof h.codigo === 'string') && (h.codigo.startsWith('PLT-') || h.codigo.startsWith('TAR-')))
  );
  const palletHu = palletHus[0] || null;
  const boxHus = handlingUnits.filter(h => {
    if (palletHu && h.id === palletHu.id) return false;
    if (h.tipoHu === 'PALLET' || h.tipoHu === 'TARIMA') return false;
    if (typeof h.codigo === 'string' && (h.codigo.startsWith('PLT-') || h.codigo.startsWith('TAR-'))) return false;
    return true;
  });

  // Clasificación operativa y formal de HUs (Regla General para Anexo A y Existencias)
  const isHuMerma = (h: any): boolean => {
    if (!h) return false;
    const cod = String(h.codigo || '').toUpperCase();
    const ubi = String(h.ubicacionActual || h.lote?.ubicacion?.codigo || '').toUpperCase();
    const estCal = String(h.estadoCalidad || '').toUpperCase();
    return cod.includes('MERMA') || cod.startsWith('HU-NC-') || ubi === 'DEV-01' || ubi.startsWith('DEV-') || estCal === 'MERMA';
  };

  const isHuQuarantine = (h: any): boolean => {
    if (!h || isHuMerma(h)) return false;
    const ubi = String(h.ubicacionActual || h.lote?.ubicacion?.codigo || '').toUpperCase();
    const estHu = String(h.estadoHu || '').toUpperCase();
    const estCal = String(h.estadoCalidad || '').toUpperCase();
    return ubi.includes('CUARENTENA') || estHu === 'RETENIDO' || estHu === 'CUARENTENA' || estCal === 'CUARENTENA';
  };

  const isHuInactive = (h: any): boolean => {
    if (!h) return false;
    const estHu = String(h.estadoHu || '').toUpperCase();
    return estHu === 'INACTIVO' || estHu === 'DAÑADO' || estHu === 'DANADO';
  };

  const isHuDispatched = (h: any): boolean => {
    if (!h) return false;
    return String(h.estadoHu || '').toUpperCase() === 'DESPACHADO';
  };

  const isHuSegregatedOther = (h: any): boolean => {
    if (!h || isHuMerma(h) || isHuQuarantine(h) || isHuInactive(h) || isHuDispatched(h)) return false;
    const estHu = String(h.estadoHu || '').toUpperCase();
    const estCal = String(h.estadoCalidad || '').toUpperCase();
    const ubi = String(h.ubicacionActual || h.lote?.ubicacion?.codigo || '').toUpperCase();
    return estHu === 'BLOQUEADO' || estCal === 'BLOQUEADO' || estCal === 'RECHAZADO' || ubi.startsWith('NC-') || ubi.startsWith('VIR-');
  };

  const isHuCommercialActive = (h: any): boolean => {
    if (!h) return false;
    return !isHuMerma(h) && !isHuQuarantine(h) && !isHuInactive(h) && !isHuDispatched(h) && !isHuSegregatedOther(h) && h.estadoHu === 'ACTIVO';
  };

  // Conteo de cajas y unidades de manejo desglosado
  const cajasActivasRacks = boxHus.filter(h => isHuCommercialActive(h)).length;
  const cajasDespachadas = boxHus.filter(h => isHuDispatched(h)).length;
  const cajasHistoricasInactivas = boxHus.filter(h => isHuInactive(h)).length;
  const husMermaBloqueadas = boxHus.filter(h => isHuMerma(h)).length;
  const husCuarentenaBloqueadas = boxHus.filter(h => isHuQuarantine(h)).length;
  const husOtrasSegregadas = boxHus.filter(h => isHuSegregatedOther(h)).length;
  const cajasConformesAlCierre = cajasActivasRacks + cajasDespachadas;

  // Desglose general para el encabezado del Anexo A
  const anexoAHeaderParts: string[] = [];
  if (cajasActivasRacks > 0) {
    anexoAHeaderParts.push(`${cajasActivasRacks} ${cajasActivasRacks === 1 ? 'caja activa en rack' : 'cajas activas en racks'}`);
  }
  if (cajasDespachadas > 0) {
    anexoAHeaderParts.push(`${cajasDespachadas} ${cajasDespachadas === 1 ? 'caja despachada' : 'cajas despachadas'}`);
  }
  if (cajasHistoricasInactivas > 0) {
    anexoAHeaderParts.push(`${cajasHistoricasInactivas} ${cajasHistoricasInactivas === 1 ? 'HU histórica dañada/inactiva' : 'HUs históricas dañadas/inactivas'}`);
  }
  if (husMermaBloqueadas > 0) {
    anexoAHeaderParts.push(`${husMermaBloqueadas} ${husMermaBloqueadas === 1 ? 'HU de merma bloqueada en DEV-01' : 'HUs de merma bloqueadas en DEV-01'}`);
  }
  if (husCuarentenaBloqueadas > 0) {
    anexoAHeaderParts.push(`${husCuarentenaBloqueadas} ${husCuarentenaBloqueadas === 1 ? 'HU en cuarentena' : 'HUs en cuarentena'}`);
  }
  if (husOtrasSegregadas > 0) {
    anexoAHeaderParts.push(`${husOtrasSegregadas} ${husOtrasSegregadas === 1 ? 'HU segregada / no comercial' : 'HUs segregadas / no comerciales'}`);
  }
  if (anexoAHeaderParts.length === 0) {
    anexoAHeaderParts.push(`${boxHus.length} HUs registradas`);
  }

  // Métricas de inventario actual en racks (exclusivamente cajas comerciales activas)
  const piezasActivasEnRacks = boxHus
    .filter(h => isHuCommercialActive(h))
    .reduce((acc, h) => acc + (Number(h.cantidad) || 0), 0);
  const piezasDespachadas = boxHus
    .filter(h => isHuDispatched(h))
    .reduce((acc, h) => acc + (Number(h.cantidad) || 0), 0);

  // Elegibilidad para pedidos de caja cerrada
  let piezasElegiblesCajaCerrada = 0;
  let cajasElegiblesCajaCerrada = 0;
  boxHus.filter(h => isHuCommercialActive(h)).forEach(h => {
    const pzas = Number(h.cantidad) || 0;
    const lineMatch = receipt?.lineas?.find((l: any) => l.sku?.codigo === h.skuCodigo || l.skuId === h.lote?.skuId);
    const skuFactor = h.lote?.sku?.capacidadEmpaque || h.piezasPorCaja || lineMatch?.sku?.capacidadEmpaque || lineMatch?.piezasPorCaja || (receipt?.piezasPorCajaEsperadas || 1);
    const standardCap = (h.reacondicionada || h.cajaOrigenId) ? skuFactor : (h.piezasPorCaja || skuFactor);
    if (!h.reacondicionada && !h.cajaOrigenId && pzas >= standardCap) {
      piezasElegiblesCajaCerrada += pzas;
      cajasElegiblesCajaCerrada += 1;
    }
  });

  // Datos de Calidad e Inspección
  const qiRecord = reportData?.qualityInspection || inspectionData?.inspeccion || null;

  // 1. Identificar la caja origen dañada / retenida en rampa
  const originDamagedBox = boxHus.find((b: any) =>
    b.estadoHu === 'INACTIVO' ||
    b.estadoHu === 'DAÑADO' ||
    (typeof b.codigo === 'string' && b.codigo.includes('DANO')) ||
    (qiRecord?.cajaOrigenCodigo && b.codigo === qiRecord.cajaOrigenCodigo)
  );
  const originDamagedBoxCodigo = originDamagedBox?.codigo || qiRecord?.cajaOrigenCodigo || (qiRecord?.detalles?.[0]?.cajaOrigenCodigo) || '—';

  // 2. Identificar la caja destino del rescate (reacondicionada, activa y conforme en inventario)
  // Regla general: Excluir estrictamente la caja dañada de origen, merma y cualquier HU inactiva o con sufijo DANO.
  const reconditionedBox = boxHus.find((b: any) => {
    if (isHuMerma(b) || isHuQuarantine(b)) return false;
    if (originDamagedBox && b.id === originDamagedBox.id) return false;
    if (typeof b.codigo === 'string' && b.codigo.includes('DANO')) return false;
    if (b.estadoHu === 'INACTIVO' || b.estadoHu === 'DAÑADO') return false;

    // Prioridad 1: Destino explícito registrado en el dictamen técnico de calidad
    if (qiRecord?.cajaDestinoCodigo && b.codigo === qiRecord.cajaDestinoCodigo) return true;
    if (qiRecord?.detalles?.some((d: any) => d.nuevasCajasGeneradas?.some((nc: any) => nc.codigo === b.codigo))) return true;

    // Prioridad 2: Linaje de rescate (cajaOrigenId apunta a la caja dañada o coincide con originDamagedBox.id)
    if (b.cajaOrigenId && (!originDamagedBox || b.cajaOrigenId === originDamagedBox.id)) return true;

    // Prioridad 3: Marcada como reacondicionada y activa
    if (b.reacondicionada && b.estadoHu === 'ACTIVO') return true;

    // Prioridad 4: Caja activa con cantidad menor a capacidad de empaque
    const lineMatchB = receipt?.lineas?.find((l: any) => l.sku?.codigo === b.skuCodigo || l.skuId === b.lote?.skuId);
    const skuFactor = b.lote?.sku?.capacidadEmpaque || b.piezasPorCaja || lineMatchB?.sku?.capacidadEmpaque || lineMatchB?.piezasPorCaja || (receipt?.piezasPorCajaEsperadas || 1);
    if (b.estadoHu === 'ACTIVO' && Number(b.cantidad) < skuFactor) return true;

    return false;
  });

  // Fallback seguro de calidad para la caja destino: no debe ser la dañada ni terminar en DANO
  const rawQiDestino = qiRecord?.cajaDestinoCodigo || qiRecord?.detalles?.[0]?.nuevasCajasGeneradas?.[0]?.codigo;
  const safeQiDestino = rawQiDestino && !rawQiDestino.includes('DANO') ? rawQiDestino : null;
  const reconditionedBoxCodigo = reconditionedBox?.codigo || safeQiDestino || '—';

  // Pedidos de salida vinculados realmente a HUs despachadas de esta recepción
  const dispatchedOrders = Array.from(new Set(
    boxHus
      .filter(h => h.estadoHu === 'DESPACHADO' && (h.pedidoCodigo || h.ordenCodigo))
      .map(h => h.pedidoCodigo || h.ordenCodigo)
  ));
  const dispatchedOrdersStr = dispatchedOrders.length > 0 ? ` (${dispatchedOrders.join(', ')})` : '';

  // Estado de conciliación y cierre oficial
  const hasDiscrepancies = totalFaltantePiezas > 0 || totalMermaPiezas > 0 || bultosFaltantes > 0 || bultosDanados > 0;
  const estadoConciliacion = isOfficiallyClosed
    ? (hasDiscrepancies ? 'FINIQUITADO CON RESERVAS' : 'CONCILIADO 100%')
    : (hasDiscrepancies ? 'BORRADOR / PRE-CIERRE CON RESERVAS' : 'BORRADOR / PRE-CIERRE');

  // Cómputo dinámico de páginas para numeración real
  let runningPageCount = 1;
  const pageMainNum = 1;
  let pageAnnexANum = 0;
  if (includeAnnexA) { runningPageCount++; pageAnnexANum = runningPageCount; }
  let pageAnnexBNum = 0;
  if (includeAnnexB && qiRecord) { runningPageCount++; pageAnnexBNum = runningPageCount; }
  let pageAnnexCNum = 0;
  if (includeAnnexC) { runningPageCount++; pageAnnexCNum = runningPageCount; }
  const totalPagesFull = runningPageCount;

  // Acciones de impresión con sincronización de estado y renderizado limpio
  const handlePrint = (scope: 'MAIN_ONLY' | 'FULL') => {
    setPrintScope(scope);
    if (scope === 'FULL') {
      setViewMode('WITH_ANNEXES');
    }
    setTimeout(() => {
      window.print();
    }, 200);
  };

  const modalContent = (
    <div
      id="receipt-report-modal-overlay"
      className="modal-print-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.75)',
        zIndex: 99999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        overflowY: 'auto',
      }}
      onClick={onClose}
    >
      <style>{`
        @media print {
          @page {
            size: letter portrait;
            margin: 10mm;
          }
          /* Ocultar toda la aplicación detrás del portal */
          body > #root {
            display: none !important;
          }
          body {
            background: #FFFFFF !important;
            color: #000000 !important;
            margin: 0 !important;
            padding: 0 !important;
          }
          .no-print {
            display: none !important;
          }
          .modal-print-overlay {
            position: static !important;
            inset: auto !important;
            width: 100% !important;
            height: auto !important;
            max-height: none !important;
            overflow: visible !important;
            padding: 0 !important;
            margin: 0 !important;
            background: transparent !important;
            display: block !important;
            box-shadow: none !important;
            border: none !important;
          }
          .modal-print-dialog {
            position: static !important;
            width: 100% !important;
            max-width: 100% !important;
            height: auto !important;
            max-height: none !important;
            overflow: visible !important;
            box-shadow: none !important;
            border: none !important;
            border-radius: 0 !important;
            margin: 0 !important;
            padding: 0 !important;
            display: block !important;
            background: #FFFFFF !important;
          }
          .modal-print-content {
            position: static !important;
            overflow: visible !important;
            height: auto !important;
            max-height: none !important;
            padding: 0 !important;
            margin: 0 !important;
            display: block !important;
            background: #FFFFFF !important;
          }
          .report-main-page {
            display: block !important;
            position: static !important;
            height: auto !important;
            max-height: none !important;
            min-height: 0 !important;
            margin: 0 !important;
            padding: 0 !important;
            page-break-after: ${printScope === 'FULL' ? 'always' : 'auto'} !important;
            break-after: ${printScope === 'FULL' ? 'page' : 'auto'} !important;
          }
          .report-annex-section {
            display: ${printScope === 'FULL' ? 'block' : 'none'} !important;
            position: static !important;
            height: auto !important;
            max-height: none !important;
            overflow: visible !important;
          }
          .annex-page {
            display: block !important;
            position: static !important;
            height: auto !important;
            max-height: none !important;
            overflow: visible !important;
            page-break-before: always !important;
            break-before: page !important;
            page-break-inside: auto !important;
            break-inside: auto !important;
            padding-top: 10px !important;
            margin-bottom: 20px !important;
          }
          table {
            width: 100% !important;
            border-collapse: collapse !important;
            page-break-inside: auto !important;
            table-layout: fixed !important;
          }
          tr {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
            page-break-after: auto !important;
          }
          th {
            background-color: #F1F5F9 !important;
            color: #0F172A !important;
            font-weight: 800 !important;
            border: 1px solid #64748B !important;
          }
          td {
            border: 1px solid #94A3B8 !important;
          }
          thead {
            display: table-header-group !important;
          }
          tfoot {
            display: table-footer-group !important;
          }
          .signature-box, .border-box {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }
          .annex-table-box {
            page-break-inside: auto !important;
            break-inside: auto !important;
            overflow: visible !important;
            width: 100% !important;
            border: 1.5px solid #0F172A !important;
            border-radius: 4px !important;
            margin-bottom: 8px !important;
          }
          .annex-table-box table {
            width: 100% !important;
            border-collapse: collapse !important;
            table-layout: fixed !important;
            page-break-inside: auto !important;
          }
          .annex-table-box thead {
            display: table-header-group !important;
          }
          .annex-table-box tr {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
            height: auto !important;
          }
          .annex-table-box th,
          .annex-table-box td {
            overflow-wrap: anywhere !important;
            word-break: break-word !important;
            white-space: normal !important;
            height: auto !important;
            vertical-align: top !important;
          }
        }
      `}</style>

      {/* MODAL DIALOG CONTAINER */}
      <div
        id="receipt-report-modal-dialog"
        className="modal-print-dialog"
        style={{
          backgroundColor: '#FFFFFF',
          borderRadius: 8,
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.35)',
          width: '100%',
          maxWidth: 1020,
          maxHeight: '94vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* BARRA SUPERIOR DE ACCIONES (NO IMPRESA) */}
        <div
          className="no-print"
          style={{
            backgroundColor: '#0F172A',
            color: '#FFFFFF',
            padding: '12px 18px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 12,
            borderBottom: '1px solid #334155',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <FileText size={20} style={{ color: '#38BDF8' }} />
            <div>
              <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: '0.02em' }}>
                Reporte de Recepción — {folioTransporte}
              </div>
              <div style={{ fontSize: 11, color: '#94A3B8' }}>
                {clienteNombre} · {isDevolucion ? 'Operación de Devolución' : 'Recepción Normal ASN'}
              </div>
            </div>
          </div>

          {/* SELECTOR DE VISTA Y ACCIONES */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ display: 'inline-flex', backgroundColor: '#1E293B', padding: 2, borderRadius: 6, border: '1px solid #334155' }}>
              <button
                type="button"
                onClick={() => { setViewMode('MAIN_ONLY'); setPrintScope('MAIN_ONLY'); }}
                style={{
                  padding: '5px 12px',
                  fontSize: 11.5,
                  fontWeight: viewMode === 'MAIN_ONLY' ? 700 : 500,
                  backgroundColor: viewMode === 'MAIN_ONLY' ? '#0284C7' : 'transparent',
                  color: '#FFFFFF',
                  border: 'none',
                  borderRadius: 4,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                Reporte principal
              </button>
              <button
                type="button"
                onClick={() => { setViewMode('WITH_ANNEXES'); setPrintScope('FULL'); }}
                style={{
                  padding: '5px 12px',
                  fontSize: 11.5,
                  fontWeight: viewMode === 'WITH_ANNEXES' ? 700 : 500,
                  backgroundColor: viewMode === 'WITH_ANNEXES' ? '#0284C7' : 'transparent',
                  color: '#FFFFFF',
                  border: 'none',
                  borderRadius: 4,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                Con Anexos Detallados
              </button>
            </div>

            {/* BOTÓN IMPRIMIR REPORTE PRINCIPAL */}
            <button
              type="button"
              onClick={() => handlePrint('MAIN_ONLY')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 14px',
                fontSize: 12,
                fontWeight: 700,
                backgroundColor: '#0F766E',
                color: '#FFFFFF',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
              }}
              title="Imprime únicamente el acta de cierre principal"
            >
              <Printer size={14} />
              Imprimir Principal
            </button>

            {/* BOTÓN IMPRIMIR CON ANEXOS */}
            <button
              type="button"
              onClick={() => handlePrint('FULL')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 14px',
                fontSize: 12,
                fontWeight: 700,
                backgroundColor: '#334155',
                color: '#FFFFFF',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
              }}
              title="Imprime el acta principal y los anexos seleccionados"
            >
              <Printer size={14} />
              Imprimir con Anexos
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
                padding: 4,
                display: 'flex',
                alignItems: 'center',
              }}
              title="Cerrar ventana"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* SELECTOR DE ANEXOS CUANDO ESTÁ EN MODO ANEXOS (NO IMPRESO) */}
        {viewMode === 'WITH_ANNEXES' && (
          <div
            className="no-print"
            style={{
              backgroundColor: '#F8FAFC',
              padding: '8px 18px',
              borderBottom: '1px solid #E2E8F0',
              display: 'flex',
              alignItems: 'center',
              gap: 20,
              fontSize: 11.5,
              color: '#334155',
              flexWrap: 'wrap',
            }}
          >
            <span style={{ fontWeight: 700, color: '#0F172A' }}>Anexos a incluir en impresión:</span>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={includeAnnexA}
                onChange={(e) => setIncludeAnnexA(e.target.checked)}
              />
              Anexo A: Manifiesto de HUs y Tarimas ({boxHus.length} registros)
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={includeAnnexB}
                onChange={(e) => setIncludeAnnexB(e.target.checked)}
              />
              Anexo B: Inspección y Rescate {qiRecord ? `(${qiRecord.folio})` : ''}
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={includeAnnexC}
                onChange={(e) => setIncludeAnnexC(e.target.checked)}
              />
              Anexo C: Salidas y Existencia Actual ({piezasActivasEnRacks} pz en racks)
            </label>
          </div>
        )}

        {/* CUERPO DEL REPORTE */}
        <div
          id="receipt-report-modal-content"
          className="modal-print-content"
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '20px 28px',
            backgroundColor: '#FFFFFF',
            color: '#111827',
            fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif',
          }}
        >
          {loadingDetails ? (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: '#64748B' }}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Cargando datos verificados de la recepción...</div>
              <div style={{ fontSize: 12 }}>Consultando relaciones oficiales en base de datos para {folioTransporte}</div>
            </div>
          ) : (
            <div>

              {/* ===================================================================== */}
              {/* DOCUMENTO PRINCIPAL: ACTA DE FINIQUITO Y CIERRE (PÁGINA 1)             */}
              {/* ===================================================================== */}
              <div className="report-main-page" style={{ position: 'relative' }}>

                {/* 1. ENCABEZADO COMPACTO */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    borderBottom: '2px solid #0F172A',
                    paddingBottom: 6,
                    marginBottom: 8,
                  }}
                >
                  {/* LOGO GIVING OUT */}
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <div style={{ fontSize: 20, fontWeight: 900, letterSpacing: '-0.02em', color: '#0F172A' }}>
                      GIVING OUT
                    </div>
                    <span style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.12em', color: '#64748B', textTransform: 'uppercase' }}>
                      Operador Logístico 3PL & Custodia
                    </span>
                  </div>

                  {/* TÍTULO CENTRAL */}
                  <div style={{ textAlign: 'center', flex: 1, padding: '0 12px' }}>
                    <div style={{ fontSize: 13.5, fontWeight: 900, letterSpacing: '0.04em', color: '#0F172A', textTransform: 'uppercase' }}>
                      {isOfficiallyClosed
                        ? (isDevolucion ? 'ACTA DE FINIQUITO DE RECEPCIÓN POR DEVOLUCIÓN' : 'ACTA DE FINIQUITO Y CIERRE DE RECEPCIÓN')
                        : (isDevolucion ? 'PRE-CIERRE / BORRADOR DE RECEPCIÓN POR DEVOLUCIÓN' : 'PRE-CIERRE / BORRADOR DE RECEPCIÓN')}
                    </div>
                    <div style={{ fontSize: 9, color: '#475569', fontWeight: 600, marginTop: 1 }}>
                      {isOfficiallyClosed
                        ? 'COMPROBANTE OFICIAL DE ENTRADA A ALMACÉN E INVENTARIO WMS'
                        : 'COMPROBANTE PRELIMINAR DE PRE-CIERRE · PENDIENTE DE CIERRE FORMAL WMS'}
                    </div>
                    <div style={{ marginTop: 2 }}>
                      <span
                        style={{
                          fontSize: 8.5,
                          fontWeight: 800,
                          padding: '1px 8px',
                          border: `1.5px solid ${isOfficiallyClosed ? (hasDiscrepancies ? '#B45309' : '#15803D') : '#B45309'}`,
                          borderRadius: 3,
                          color: isOfficiallyClosed ? (hasDiscrepancies ? '#B45309' : '#15803D') : '#B45309',
                          backgroundColor: isOfficiallyClosed ? '#FFFFFF' : '#FFFBEB',
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                        }}
                      >
                        {estadoConciliacion}
                      </span>
                    </div>
                  </div>

                  {/* FOLIO Y CÓDIGO DE BARRAS */}
                  <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                    <div style={{ fontSize: 13.5, fontWeight: 900, fontFamily: 'monospace', color: '#0F172A' }}>
                      {folioTransporte}
                    </div>
                    <div style={{ height: 26, margin: '1px 0' }}>
                      <svg ref={barcodeSvgRef}></svg>
                    </div>
                    <div style={{ fontSize: 8.5, color: '#64748B' }}>
                      Emisión: {fechaEmisionReporte}
                    </div>
                  </div>
                </div>

                {/* 2. DATOS GENERALES (TABLA COMPACTA CON AJUSTE FLEXIBLE SIN CORTES) */}
                <div className="border-box" style={{ marginBottom: 8, border: '1.5px solid #0F172A', borderRadius: 4, overflow: 'visible' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 9.5, tableLayout: 'fixed' }}>
                    <tbody>
                      <tr style={{ borderBottom: '1px solid #CBD5E1' }}>
                        <td style={{ padding: '4px 6px', backgroundColor: '#F1F5F9', fontWeight: 800, color: '#0F172A', width: '16%', wordBreak: 'break-word', overflowWrap: 'anywhere', whiteSpace: 'normal', verticalAlign: 'middle' }}>
                          DEPOSITANTE:
                        </td>
                        <td style={{ padding: '4px 6px', fontWeight: 800, color: '#0F172A', width: '32%', wordBreak: 'break-word', overflowWrap: 'anywhere', whiteSpace: 'normal', verticalAlign: 'middle' }}>
                          {clienteNombre}
                        </td>
                        <td style={{ padding: '4px 6px', backgroundColor: '#F1F5F9', fontWeight: 800, color: '#0F172A', width: '20%', wordBreak: 'break-word', overflowWrap: 'anywhere', whiteSpace: 'normal', verticalAlign: 'middle' }}>
                          TRANSPORTE:
                        </td>
                        <td style={{ padding: '4px 6px', color: '#0F172A', width: '32%', wordBreak: 'break-word', overflowWrap: 'anywhere', whiteSpace: 'normal', verticalAlign: 'middle' }}>
                          <div><strong>{lineaTransporte}</strong></div>
                          {placa !== '—' && <div style={{ fontSize: 8.5, color: '#475569' }}>Placas Unidad: <strong>{placa}</strong></div>}
                        </td>
                      </tr>
                      <tr style={{ borderBottom: '1px solid #CBD5E1' }}>
                        <td style={{ padding: '4px 6px', backgroundColor: '#F1F5F9', fontWeight: 800, color: '#0F172A', width: '16%', wordBreak: 'break-word', overflowWrap: 'anywhere', whiteSpace: 'normal', verticalAlign: 'middle' }}>
                          FACTURA / REM:
                        </td>
                        <td style={{ padding: '4px 6px', color: '#0F172A', width: '32%', wordBreak: 'break-word', overflowWrap: 'anywhere', whiteSpace: 'normal', verticalAlign: 'middle' }}>
                          <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{facturaRespaldo}</span>
                          {ocReferenciaReal && (
                            <div style={{ fontSize: 8.5, color: '#475569' }}>O.C. / Referencia: <strong>{ocReferenciaReal}</strong></div>
                          )}
                        </td>
                        <td style={{ padding: '4px 6px', backgroundColor: '#F1F5F9', fontWeight: 800, color: '#0F172A', width: '20%', wordBreak: 'break-word', overflowWrap: 'anywhere', whiteSpace: 'normal', verticalAlign: 'middle' }}>
                          OPERADOR / CHOFER:
                        </td>
                        <td style={{ padding: '4px 6px', color: '#0F172A', width: '32%', wordBreak: 'break-word', overflowWrap: 'anywhere', whiteSpace: 'normal', verticalAlign: 'middle' }}>
                          <strong>{choferNombre}</strong>
                        </td>
                      </tr>
                      <tr style={{ borderBottom: isDevolucion ? '1px solid #CBD5E1' : 'none' }}>
                        <td style={{ padding: '4px 6px', backgroundColor: '#F1F5F9', fontWeight: 800, color: '#0F172A', width: '16%', wordBreak: 'break-word', overflowWrap: 'anywhere', whiteSpace: 'normal', verticalAlign: 'middle' }}>
                          FECHA ARRIBO:
                        </td>
                        <td style={{ padding: '4px 6px', color: '#0F172A', width: '32%', wordBreak: 'break-word', overflowWrap: 'anywhere', whiteSpace: 'normal', verticalAlign: 'middle' }}>
                          <div>{fechaArribo} <span style={{ color: '#475569' }}>· Andén: <strong>{anden}</strong></span></div>
                          {fechaPrevio && fechaPrevio !== '—' && (
                            <div style={{ fontSize: 8.5, color: '#475569', marginTop: 1 }}>
                              Previo (ASN): <strong>{fechaPrevio}</strong>
                            </div>
                          )}
                        </td>
                        <td style={{ padding: '4px 6px', backgroundColor: '#F1F5F9', fontWeight: 800, color: '#0F172A', width: '20%', wordBreak: 'break-word', overflowWrap: 'anywhere', whiteSpace: 'normal', verticalAlign: 'middle' }}>
                          {isOfficiallyClosed ? 'CIERRE ALMACÉN:' : 'ESTADO DE CIERRE:'}
                        </td>
                        <td style={{ padding: '4px 6px', color: '#0F172A', width: '32%', wordBreak: 'break-word', overflowWrap: 'anywhere', whiteSpace: 'normal', verticalAlign: 'middle' }}>
                          {isOfficiallyClosed ? (
                            <>
                              <div>{fechaCierreRecepcion}</div>
                              <div style={{ fontSize: 8.5, color: '#0F766E', fontWeight: 700 }}>
                                Resp: {responsableCierreNombre} {responsableCierreEmail ? `(${responsableCierreEmail})` : ''}
                              </div>
                            </>
                          ) : (
                            <>
                              <div style={{ color: '#B45309', fontWeight: 700, fontSize: 8.5 }}>
                                Pendiente de Cierre Oficial
                              </div>
                              <div style={{ fontSize: 8, color: '#64748B' }}>
                                Pre-cierre en curso · Sin cierre registrado
                              </div>
                            </>
                          )}
                        </td>
                      </tr>

                      {/* CAMPOS ESPECÍFICOS DE DEVOLUCIÓN (ÚNICAMENTE SI APLICAN Y EXISTEN) */}
                      {isDevolucion && (
                        <tr>
                          <td style={{ padding: '4px 6px', backgroundColor: '#F1F5F9', fontWeight: 800, color: '#0F172A', width: '16%', wordBreak: 'break-word', overflowWrap: 'anywhere', whiteSpace: 'normal', verticalAlign: 'middle' }}>
                            SUCURSAL / ORIGEN:
                          </td>
                          <td style={{ padding: '4px 6px', color: '#0F172A', width: '32%', wordBreak: 'break-word', overflowWrap: 'anywhere', whiteSpace: 'normal', verticalAlign: 'middle' }}>
                            <strong>{sucursalOrigen || '—'}</strong>
                          </td>
                          <td style={{ padding: '4px 6px', backgroundColor: '#F1F5F9', fontWeight: 800, color: '#0F172A', width: '20%', wordBreak: 'break-word', overflowWrap: 'anywhere', whiteSpace: 'normal', verticalAlign: 'middle' }}>
                            MOTIVO / GUÍA:
                          </td>
                          <td style={{ padding: '4px 6px', color: '#0F172A', width: '32%', wordBreak: 'break-word', overflowWrap: 'anywhere', whiteSpace: 'normal', verticalAlign: 'middle' }}>
                            {motivoDevolucion || '—'} {referenciaDevolucion ? `· Guía: ${referenciaDevolucion}` : ''}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {/* 3. TABLA PRINCIPAL DE PARTIDAS (SKU Y LOTE) */}
                <div className="border-box" style={{ marginBottom: 8, border: '1.5px solid #0F172A', borderRadius: 4, overflow: 'visible' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 9.5, tableLayout: 'fixed' }}>
                    <thead>
                      <tr style={{ backgroundColor: '#0F172A', color: '#FFFFFF', textAlign: 'left', fontSize: 8.5 }}>
                        <th style={{ padding: '4px 3px', width: '3.5%', textAlign: 'center', border: '1px solid #334155' }}>#</th>
                        <th style={{ padding: '4px 5px', width: '13.0%', border: '1px solid #334155', whiteSpace: 'normal', wordBreak: 'normal' }}>SKU / CÓDIGO</th>
                        <th style={{ padding: '4px 5px', width: '20.0%', border: '1px solid #334155', whiteSpace: 'normal', wordBreak: 'normal' }}>DESCRIPCIÓN DEL PRODUCTO</th>
                        <th style={{ padding: '4px 5px', width: '13.5%', border: '1px solid #334155', whiteSpace: 'normal', wordBreak: 'normal' }}>LOTE</th>
                        <th style={{ padding: '4px 2px', width: '11.0%', textAlign: 'center', border: '1px solid #334155', whiteSpace: 'normal', wordBreak: 'normal' }}>CADUCIDAD</th>
                        <th style={{ padding: '4px 2px', width: '5.0%', textAlign: 'center', border: '1px solid #334155', whiteSpace: 'normal', wordBreak: 'normal' }}>U.M.</th>
                        <th style={{ padding: '4px 3px', width: '6.5%', textAlign: 'right', border: '1px solid #334155', whiteSpace: 'normal', wordBreak: 'normal' }}>ESP.</th>
                        <th style={{ padding: '4px 3px', width: '6.5%', textAlign: 'right', border: '1px solid #334155', whiteSpace: 'normal', wordBreak: 'normal' }}>REC.</th>
                        <th style={{ padding: '4px 3px', width: '6.5%', textAlign: 'right', border: '1px solid #334155', whiteSpace: 'normal', wordBreak: 'normal' }}>CONF.</th>
                        <th style={{ padding: '4px 3px', width: '7.0%', textAlign: 'right', border: '1px solid #334155', whiteSpace: 'normal', wordBreak: 'normal' }}>MERMA</th>
                        <th style={{ padding: '4px 3px', width: '7.5%', textAlign: 'right', border: '1px solid #334155', whiteSpace: 'normal', wordBreak: 'normal' }}>FALT.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {partidasProcesadas.map((p, idx) => (
                        <tr
                          key={idx}
                          style={{
                            borderBottom: '1px solid #CBD5E1',
                            backgroundColor: idx % 2 === 0 ? '#FFFFFF' : '#F8FAFC',
                          }}
                        >
                          <td style={{ padding: '4px 3px', textAlign: 'center', color: '#64748B', border: '1px solid #CBD5E1', verticalAlign: 'middle', fontSize: 8.5 }}>
                            {p.partidaNum}
                          </td>
                          <td style={{ padding: '4px 5px', fontWeight: 800, fontFamily: 'monospace', border: '1px solid #CBD5E1', wordBreak: 'break-word', overflowWrap: 'anywhere', verticalAlign: 'middle', fontSize: 8.5 }}>
                            {p.skuCodigo}
                          </td>
                          <td style={{ padding: '4px 5px', border: '1px solid #CBD5E1', wordBreak: 'break-word', overflowWrap: 'anywhere', verticalAlign: 'middle', lineHeight: 1.25, fontSize: 8.5 }}>
                            {p.descripcion}
                          </td>
                          <td style={{ padding: '4px 5px', fontFamily: 'monospace', border: '1px solid #CBD5E1', wordBreak: 'break-word', overflowWrap: 'anywhere', verticalAlign: 'middle', fontSize: 8.5 }}>
                            {p.lote}
                          </td>
                          <td style={{ padding: '4px 2px', textAlign: 'center', border: '1px solid #CBD5E1', whiteSpace: 'nowrap', verticalAlign: 'middle', fontSize: 8.5 }}>
                            {p.caducidad}
                          </td>
                          <td style={{ padding: '4px 2px', textAlign: 'center', fontWeight: 700, border: '1px solid #CBD5E1', verticalAlign: 'middle', fontSize: 8.5 }}>
                            {p.uom}
                          </td>
                          <td style={{ padding: '4px 3px', textAlign: 'right', border: '1px solid #CBD5E1', whiteSpace: 'nowrap', verticalAlign: 'middle', fontSize: 8.5 }}>
                            {p.esperadas}
                          </td>
                          <td style={{ padding: '4px 3px', textAlign: 'right', fontWeight: 700, border: '1px solid #CBD5E1', whiteSpace: 'nowrap', verticalAlign: 'middle', fontSize: 8.5 }}>
                            {p.recibidas}
                          </td>
                          <td style={{ padding: '4px 3px', textAlign: 'right', fontWeight: 800, color: '#15803D', border: '1px solid #CBD5E1', whiteSpace: 'nowrap', verticalAlign: 'middle', fontSize: 8.5 }}>
                            {p.conformes}
                          </td>
                          <td style={{ padding: '4px 3px', textAlign: 'right', fontWeight: p.merma > 0 ? 800 : 500, color: p.merma > 0 ? '#DC2626' : '#64748B', border: '1px solid #CBD5E1', whiteSpace: 'nowrap', verticalAlign: 'middle', fontSize: 8.5 }}>
                            {p.merma}
                          </td>
                          <td style={{ padding: '4px 3px', textAlign: 'right', fontWeight: p.faltantes > 0 ? 800 : 500, color: p.faltantes > 0 ? '#B45309' : '#15803D', border: '1px solid #CBD5E1', whiteSpace: 'nowrap', verticalAlign: 'middle', fontSize: 8.5 }}>
                            {p.faltantes}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{ backgroundColor: '#F1F5F9', borderTop: '2px solid #0F172A', fontWeight: 800, fontSize: 8.5 }}>
                        <td colSpan={6} style={{ padding: '4px 6px', textAlign: 'right', letterSpacing: '0.04em', border: '1px solid #CBD5E1' }}>
                          {isOfficiallyClosed ? 'TOTALES DE PIEZAS AL CIERRE:' : 'TOTALES DE PIEZAS AL PRE-CIERRE:'}
                        </td>
                        <td style={{ padding: '4px 3px', textAlign: 'right', border: '1px solid #CBD5E1', whiteSpace: 'nowrap' }}>
                          {totalEsperadoPiezas}
                        </td>
                        <td style={{ padding: '4px 3px', textAlign: 'right', border: '1px solid #CBD5E1', whiteSpace: 'nowrap' }}>
                          {totalRecibidoPiezas}
                        </td>
                        <td style={{ padding: '4px 3px', textAlign: 'right', color: '#15803D', border: '1px solid #CBD5E1', whiteSpace: 'nowrap' }}>
                          {totalConformePiezas}
                        </td>
                        <td style={{ padding: '4px 3px', textAlign: 'right', color: totalMermaPiezas > 0 ? '#DC2626' : '#64748B', border: '1px solid #CBD5E1', whiteSpace: 'nowrap' }}>
                          {totalMermaPiezas}
                        </td>
                        <td style={{ padding: '4px 3px', textAlign: 'right', color: totalFaltantePiezas > 0 ? '#B45309' : '#15803D', border: '1px solid #CBD5E1', whiteSpace: 'nowrap' }}>
                          {totalFaltantePiezas}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {/* 4. RESUMEN DE BULTOS / MANEJO FÍSICO */}
                <div className="border-box" style={{ marginBottom: 8, border: '1.5px solid #0F172A', borderRadius: 4, overflow: 'hidden' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 9.5, textAlign: 'center', tableLayout: 'fixed' }}>
                    <thead>
                      <tr style={{ backgroundColor: '#F1F5F9', borderBottom: '1px solid #CBD5E1', color: '#0F172A', fontSize: 8.5 }}>
                        <th style={{ padding: '3px 4px', width: '20%', border: '1px solid #CBD5E1' }}>BULTOS DECLARADOS</th>
                        <th style={{ padding: '3px 4px', width: '20%', border: '1px solid #CBD5E1' }}>RECIBIDOS EN ANDÉN</th>
                        <th style={{ padding: '3px 4px', width: '20%', border: '1px solid #CBD5E1' }}>SIN DAÑO EXTERIOR</th>
                        <th style={{ padding: '3px 4px', width: '20%', border: '1px solid #CBD5E1' }}>CON DAÑO EXTERIOR</th>
                        <th style={{ padding: '3px 4px', width: '20%', border: '1px solid #CBD5E1' }}>FALTANTES RECEPCIÓN</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td style={{ padding: '4px 4px', fontWeight: 800, fontSize: 11, border: '1px solid #CBD5E1' }}>
                          {bultosDeclarados} <span style={{ fontSize: 8.5, fontWeight: 400, color: '#64748B' }}>bultos</span>
                        </td>
                        <td style={{ padding: '4px 4px', fontWeight: 800, fontSize: 11, border: '1px solid #CBD5E1' }}>
                          {bultosRecibidos} <span style={{ fontSize: 8.5, fontWeight: 400, color: '#64748B' }}>bultos</span>
                        </td>
                        <td style={{ padding: '4px 4px', fontWeight: 800, fontSize: 11, border: '1px solid #CBD5E1', color: '#15803D' }}>
                          {bultosSinDanoExterior} <span style={{ fontSize: 8.5, fontWeight: 400, color: '#64748B' }}>bultos</span>
                        </td>
                        <td style={{ padding: '4px 4px', fontWeight: 800, fontSize: 11, border: '1px solid #CBD5E1', color: bultosDanados > 0 ? '#DC2626' : '#64748B' }}>
                          {bultosDanados} <span style={{ fontSize: 8.5, fontWeight: 400, color: '#64748B' }}>bulto</span>
                        </td>
                        <td style={{ padding: '4px 4px', fontWeight: 800, fontSize: 11, border: '1px solid #CBD5E1', color: bultosFaltantes > 0 ? '#B45309' : '#15803D' }}>
                          {bultosFaltantes} <span style={{ fontSize: 8.5, fontWeight: 400, color: '#64748B' }}>bulto</span>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                  <div style={{ backgroundColor: '#F8FAFC', padding: '3px 8px', fontSize: 8.5, color: '#334155', borderTop: '1px solid #CBD5E1' }}>
                    <strong>Cuadre físico:</strong> {bultosDeclarados} bultos declarados = {bultosRecibidos} recibidos en andén + {bultosFaltantes} faltantes en recepción · De los {bultosRecibidos} recibidos: {bultosSinDanoExterior} sin daño exterior y {bultosDanados} con daño remitido a inspección técnica.
                  </div>
                </div>

                {/* 5. OBSERVACIONES E INCIDENCIAS RELEVANTES */}
                <div className="border-box" style={{ marginBottom: 8, border: '1px solid #CBD5E1', borderRadius: 4, padding: '5px 8px', fontSize: 9 }}>
                  <div style={{ fontWeight: 800, color: '#0F172A', textTransform: 'uppercase', marginBottom: 2 }}>
                    Observaciones e Incidencias Operativas:
                  </div>
                  <div style={{ color: '#334155', lineHeight: 1.35 }}>
                    {hasDiscrepancies ? (
                      <>
                        {isOfficiallyClosed
                          ? 'Recepción cerrada con reservas por discrepancia física de rampa.'
                          : 'Recepción en pre-cierre con reservas por discrepancia física de rampa.'}
                        {bultosDanados > 0 && qiRecord && (
                          <span> Daño exterior registrado en {bultosDanados} bulto ({originDamagedBoxCodigo !== '—' ? originDamagedBoxCodigo : (qiRecord.cajaOrigenCodigo || 'bulto dañado')}), inspeccionado bajo folio {qiRecord.folio} con resultado de {qiRecord.totalPiezasRescatadas} piezas conformes rescatadas en {reconditionedBoxCodigo !== '—' ? reconditionedBoxCodigo : (qiRecord.cajaDestinoCodigo || 'caja de rescate')} y {qiRecord.totalPiezasMerma} piezas de merma dictaminada (no aptas por daño físico).</span>
                        )}
                        {bultosDanados > 0 && !qiRecord && (
                          <span> Daño exterior registrado en {bultosDanados} {bultosDanados === 1 ? 'bulto retenido en rampa (dictamen e inspección técnica de calidad pendiente)' : 'bultos retenidos en rampa (dictamen e inspección técnica de calidad pendiente)'}.</span>
                        )}
                        {totalFaltantePiezas > 0 ? (
                          <span> Faltante físico en recepción de {bultosFaltantes} bulto equivalente a {totalFaltantePiezas} piezas.</span>
                        ) : bultosFaltantes > 0 ? (
                          <span> Faltante físico en rampa de {bultosFaltantes} {bultosFaltantes === 1 ? 'bulto' : 'bultos'} (piezas por determinar tras clasificación).</span>
                        ) : null}
                        <span> {isOfficiallyClosed ? 'Conformes definitivas al cierre' : 'Conformes confirmadas al pre-cierre'}: {totalConformePiezas} piezas en {cajasConformesAlCierre} cajas.</span>
                      </>
                    ) : (
                      <span>{isOfficiallyClosed ? 'Recepción concluida conforme a lo programado.' : 'Recepción en proceso de pre-cierre conforme a lo programado.'} Sin discrepancias físicas, bultos dañados ni faltantes. {isOfficiallyClosed ? 'Conformes al cierre' : 'Conformes confirmadas al pre-cierre'}: {totalConformePiezas} piezas en {cajasConformesAlCierre} cajas estándar.</span>
                    )}
                  </div>
                </div>

                {/* 6. FIRMAS Y RESPONSABLES AL FINAL (ACREDITACIÓN REAL DE CADA ACTO) */}
                <div
                  className="signature-box"
                  style={{
                    border: '1.5px solid #0F172A',
                    borderRadius: 4,
                    padding: '8px 10px',
                    backgroundColor: '#FFFFFF',
                  }}
                >
                  <div style={{ fontSize: 9, fontWeight: 900, color: '#0F172A', textTransform: 'uppercase', marginBottom: 6 }}>
                    Responsables Operativos y Certificación de Actos
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: qiRecord ? '1fr 1fr 1fr' : '1fr 1fr', gap: 10 }}>

                    {/* FIRMA 1: CHOFER EN RAMPA */}
                    <div style={{ border: '1px solid #CBD5E1', borderRadius: 4, padding: '6px 8px', textAlign: 'center', backgroundColor: '#F8FAFC' }}>
                      <div style={{ fontSize: 8.5, fontWeight: 800, color: '#334155', textTransform: 'uppercase', marginBottom: 4 }}>
                        1. Entrega y Revisión Exterior en Rampa
                      </div>
                      <div style={{ height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 2 }}>
                        {firmaChoferBase64 ? (
                          <img src={firmaChoferBase64} alt="Firma Chofer" style={{ maxHeight: 32, maxWidth: '90%', objectFit: 'contain' }} />
                        ) : (
                          <span style={{ fontSize: 9, fontStyle: 'italic', color: '#64748B' }}>[ Firma registrada en rampa ]</span>
                        )}
                      </div>
                      <div style={{ borderBottom: '1.5px solid #0F172A', width: '85%', margin: '0 auto 4px auto' }}></div>
                      <div style={{ fontSize: 9.5, fontWeight: 800, color: '#0F172A' }}>
                        {choferNombre}
                      </div>
                      <div style={{ fontSize: 8.5, color: '#475569' }}>
                        {lineaTransporte} {placa !== '—' ? `(${placa})` : ''} · Lib: {fechaLiberacionChofer}
                      </div>
                      <div style={{ fontSize: 8, color: '#B45309', fontWeight: 700, marginTop: 2 }}>
                        * Acredita exclusivamente entrega física y conteo exterior en rampa
                      </div>
                    </div>

                    {/* FIRMA 2: DICTAMEN DE CALIDAD (SI HUBO INSPECCIÓN) */}
                    {qiRecord && (
                      <div style={{ border: '1px solid #CBD5E1', borderRadius: 4, padding: '6px 8px', textAlign: 'center', backgroundColor: '#F8FAFC' }}>
                        <div style={{ fontSize: 8.5, fontWeight: 800, color: '#334155', textTransform: 'uppercase', marginBottom: 4 }}>
                          2. Inspección Técnica y Rescate (Calidad)
                        </div>
                        <div style={{ height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 2 }}>
                          <span style={{ fontSize: 8.5, color: '#0F172A', fontWeight: 800, border: '1px solid #64748B', padding: '1px 6px', borderRadius: 3, backgroundColor: '#FFFFFF' }}>
                            DICTAMEN TÉCNICO REGISTRADO · {qiRecord.folio}
                          </span>
                        </div>
                        <div style={{ borderBottom: '1.5px solid #0F172A', width: '85%', margin: '0 auto 4px auto' }}></div>
                        <div style={{ fontSize: 9.5, fontWeight: 800, color: '#0F172A' }}>
                          {qiRecord.inspectorNombre || qiRecord.firmadoPor || 'Inspector de Calidad'}
                        </div>
                        <div style={{ fontSize: 8.5, color: '#475569' }}>
                          Inspección: {fechaInspeccionCalidad || '—'}
                        </div>
                        <div style={{ fontSize: 8, color: '#15803D', fontWeight: 700, marginTop: 2 }}>
                          * Acredita dictamen técnico, {qiRecord.totalPiezasRescatadas} pz rescate y {qiRecord.totalPiezasMerma} pz merma
                        </div>
                      </div>
                    )}

                    {/* FIRMA 3: SUPERVISOR DE CIERRE DE ALMACÉN */}
                    <div style={{ border: '1px solid #CBD5E1', borderRadius: 4, padding: '6px 8px', textAlign: 'center', backgroundColor: '#F8FAFC' }}>
                      <div style={{ fontSize: 8.5, fontWeight: 800, color: '#334155', textTransform: 'uppercase', marginBottom: 4 }}>
                        {qiRecord ? '3. Finiquito y Cierre de Almacén' : '2. Finiquito y Cierre de Almacén'}
                      </div>
                      <div style={{ height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 2 }}>
                        {isOfficiallyClosed ? (
                          <span style={{ fontSize: 8.5, color: '#0F766E', fontWeight: 800, border: '1px solid #0F766E', padding: '1px 6px', borderRadius: 3, backgroundColor: '#FFFFFF' }}>
                            CIERRE OPERATIVO REGISTRADO EN SISTEMA
                          </span>
                        ) : (
                          <span style={{ fontSize: 8.5, color: '#B45309', fontWeight: 800, border: '1px solid #B45309', padding: '1px 6px', borderRadius: 3, backgroundColor: '#FFFBEB' }}>
                            PRE-CIERRE / BORRADOR EN REVISIÓN
                          </span>
                        )}
                      </div>
                      <div style={{ borderBottom: '1.5px solid #0F172A', width: '85%', margin: '0 auto 4px auto' }}></div>
                      <div style={{ fontSize: 9.5, fontWeight: 800, color: '#0F172A' }}>
                        {isOfficiallyClosed ? responsableCierreNombre : 'Pendiente de ejecución de cierre oficial'}
                      </div>
                      <div style={{ fontSize: 8.5, color: '#475569' }}>
                        {isOfficiallyClosed ? (
                          <>{responsableCierreEmail ? `Usuario: ${responsableCierreEmail} · ` : ''}Cierre oficial: {fechaCierreRecepcion}</>
                        ) : (
                          <>Estado operativo: Por Cerrar (Etapa 6) · Sin cierre persistido</>
                        )}
                      </div>
                      <div style={{ fontSize: 8, color: isOfficiallyClosed ? '#0F766E' : '#B45309', fontWeight: 700, marginTop: 2 }}>
                        {isOfficiallyClosed
                          ? '* Acredita conformidad del finiquito e ingreso formal a inventario WMS'
                          : '* Documento preliminar de pre-cierre. No certifica cierre ni finiquito definitivo.'}
                      </div>
                    </div>

                  </div>
                </div>

                {/* PIE INSTITUCIONAL PÁGINA 1 CON NUMERACIÓN REAL */}
                <div style={{ textAlign: 'center', marginTop: 8, fontSize: 8, color: '#64748B' }}>
                  Giving Out WMS · Sistema de Gestión de Almacenes 3PL · Folio {folioTransporte} · Hoja 1 de {printScope === 'FULL' || viewMode === 'WITH_ANNEXES' ? totalPagesFull : 1}
                </div>

              </div>

              {/* ===================================================================== */}
              {/* SECCIÓN DE ANEXOS OPCIONALES (PÁGINAS 2+)                             */}
              {/* ===================================================================== */}
              <div className="report-annex-section" style={{ display: viewMode === 'WITH_ANNEXES' ? 'block' : 'none' }}>

                {/* ------------------------------------------------------------------- */}
                {/* ANEXO A: MANIFIESTO DE UNIDADES DE MANEJO (HUs) Y TARIMAS           */}
                {/* ------------------------------------------------------------------- */}
                {includeAnnexA && (
                  <div className="annex-page" style={{ marginTop: 24, paddingTop: 16, borderTop: '2px dashed #94A3B8' }}>
                    {/* ENCABEZADO DE ANEXO */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #0F172A', paddingBottom: 6, marginBottom: 8 }}>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 900, color: '#0F172A', textTransform: 'uppercase' }}>
                          ANEXO A · MANIFIESTO DE UNIDADES DE MANEJO (HUs) Y TARIMAS
                        </div>
                        <div style={{ fontSize: 9.5, color: '#64748B' }}>
                          Folio: <strong>{folioTransporte}</strong> · Depositante: <strong>{clienteNombre}</strong>
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', fontSize: 9.5, color: '#0F172A', fontWeight: 700 }}>
                        <div>
                          {anexoAHeaderParts.join(' · ')}
                        </div>
                        <div style={{ fontSize: 8.5, color: '#64748B', fontWeight: 600, marginTop: 1 }}>
                          Total histórico registrado: {boxHus.length} {boxHus.length === 1 ? 'HU' : 'HUs'}
                        </div>
                      </div>
                    </div>

                    {/* TARIMA CONTENEDOR (ACLARACIÓN PUNTUAL PUNTO 4) */}
                    {palletHu && (
                      <div className="border-box" style={{ border: '1px solid #CBD5E1', borderRadius: 4, padding: '6px 10px', backgroundColor: '#F8FAFC', marginBottom: 8, fontSize: 9.5 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div>
                            <span style={{ fontWeight: 800, color: '#0F766E' }}>TARIMA MASTER: {palletHu.codigo}</span>
                            <span style={{ marginLeft: 8, fontSize: 8.5, color: '#64748B' }}>(Contenedor logístico de arribo)</span>
                          </div>
                          <span style={{ fontSize: 8.5, fontWeight: 600, color: '#475569' }}>
                            Andén de arribo: {receipt.andenAsignado || 'REC-01 (Rampa)'} (Histórico)
                          </span>
                        </div>
                        <div style={{ marginTop: 3, fontSize: 8.5, color: '#334155' }}>
                          <strong>{isOfficiallyClosed ? 'Composición al cierre:' : 'Composición actual previa al cierre:'}</strong>{' '}
                          {isOfficiallyClosed ? (
                            <>
                              {cajasConformesAlCierre} {cajasConformesAlCierre === 1 ? 'caja física activa asociada' : 'cajas físicas activas asociadas'} a la Tarima Master. No se duplica su conteo con las cajas contenidas.
                            </>
                          ) : (
                            <>
                              {cajasActivasRacks} {cajasActivasRacks === 1 ? 'caja física activa asociada' : 'cajas físicas activas asociadas'} a la Tarima Master.{bultosFaltantes > 0 ? ` ${bultosDeclarados} ${bultosDeclarados === 1 ? 'bulto declarado' : 'bultos declarados'} originalmente · ${bultosFaltantes} ${bultosFaltantes === 1 ? 'faltante no arribado' : 'faltantes no arribados'}.` : ''} No se duplica su conteo con las cajas contenidas.
                            </>
                          )}
                        </div>
                      </div>
                    )}

                    {/* TABLA DE CAJAS CON ANCHO TOTAL 100%, SALTOS DE LÍNEA Y FILAS EXPANDIBLES */}
                    <div className="annex-table-box" style={{ border: '1.5px solid #0F172A', borderRadius: 4, overflow: 'visible', width: '100%', marginBottom: 8 }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 8.5, tableLayout: 'fixed' }}>
                        <thead>
                          <tr style={{ backgroundColor: '#0F172A', color: '#FFFFFF', textAlign: 'left' }}>
                            <th style={{ padding: '5px 6px', width: '16.5%', border: '1px solid #334155', whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'normal' }}>CÓDIGO HU</th>
                            <th style={{ padding: '5px 6px', width: '15%', border: '1px solid #334155', whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'normal' }}>TIPO / CONDICIÓN</th>
                            <th style={{ padding: '5px 6px', width: '17%', border: '1px solid #334155', whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'normal' }}>SKU / PRODUCTO</th>
                            <th style={{ padding: '5px 6px', width: '17%', border: '1px solid #334155', whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'normal' }}>SALDO ALMACÉN</th>
                            <th style={{ padding: '5px 6px', width: '12.5%', border: '1px solid #334155', whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'normal' }}>LOTE & CADUCIDAD</th>
                            <th style={{ padding: '5px 6px', width: '11%', border: '1px solid #334155', whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'normal' }}>UBICACIÓN</th>
                            <th style={{ padding: '5px 4px', width: '11%', border: '1px solid #334155', textAlign: 'center', whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'normal' }}>ESTATUS OPERATIVO</th>
                          </tr>
                        </thead>
                        <tbody>
                          {boxHus.map((box: any, idx: number) => {
                            const isDespachado = isHuDispatched(box);
                            const isInactive = isHuInactive(box);
                            const isMerma = isHuMerma(box);
                            const isQuarantine = isHuQuarantine(box);
                            const isSegregated = isHuSegregatedOther(box);
                            const isCommercial = isHuCommercialActive(box);

                            const pzas = Number(box.cantidad) || 0;
                            const lineMatchBox = receipt?.lineas?.find((l: any) => l.sku?.codigo === box.skuCodigo || l.skuId === box.lote?.skuId);
                            const skuFactor = box.lote?.sku?.capacidadEmpaque || box.piezasPorCaja || lineMatchBox?.sku?.capacidadEmpaque || lineMatchBox?.piezasPorCaja || (receipt?.piezasPorCajaEsperadas || 1);
                            const standardCap = (box.reacondicionada || box.cajaOrigenId) ? skuFactor : (box.piezasPorCaja || skuFactor);
                            const isPartial = isCommercial && (box.reacondicionada || Boolean(box.cajaOrigenId) || pzas < standardCap);
                            const cadStr = box.fechaVencimiento ? formatCalendarDate(box.fechaVencimiento) : '—';
                            const ubi = isDespachado
                              ? `Salida / Despacho (era ${box.ubicacionActual || 'rack'})`
                              : isInactive
                              ? `${box.ubicacionActual || 'AREA_CALIDAD'} (Retención)`
                              : isMerma
                              ? `${box.ubicacionActual || 'DEV-01'} (Merma)`
                              : isQuarantine
                              ? `${box.ubicacionActual || 'CUARENTENA'} (Retención)`
                              : (box.lote?.ubicacion?.codigo || box.ubicacionActual || 'En Rack');

                            // Resolución limpia del folio de origen para la caja rescatada o merma segregada
                            const originBox = box.cajaOrigenId ? boxHus.find((b: any) => b.id === box.cajaOrigenId) : null;
                            const originFolio = box.cajaOrigenCodigo || originBox?.codigo || (box.cajaOrigenId?.startsWith('BOX-') ? box.cajaOrigenId : ((isPartial || isMerma) ? (originDamagedBoxCodigo !== '—' ? originDamagedBoxCodigo : null) : null));

                            return (
                              <tr
                                key={idx}
                                style={{
                                  borderBottom: '1px solid #CBD5E1',
                                  backgroundColor: (isInactive || isMerma)
                                    ? '#FEF2F2'
                                    : (isQuarantine || isSegregated)
                                    ? '#FFFBEB'
                                    : isPartial
                                    ? '#FFFDF5'
                                    : (idx % 2 === 0 ? '#FFFFFF' : '#F8FAFC'),
                                  height: 'auto',
                                }}
                              >
                                <td
                                  style={{
                                    padding: '5px 6px',
                                    fontFamily: 'monospace',
                                    fontWeight: 800,
                                    border: '1px solid #CBD5E1',
                                    verticalAlign: 'top',
                                    wordBreak: 'break-word',
                                    overflowWrap: 'anywhere',
                                    whiteSpace: 'normal',
                                    height: 'auto',
                                    color: isDespachado
                                      ? '#1D4ED8'
                                      : (isInactive || isMerma)
                                      ? '#DC2626'
                                      : (isQuarantine || isSegregated || isPartial)
                                      ? '#B45309'
                                      : '#0F172A',
                                  }}
                                >
                                  <div style={{ fontSize: 8.5, lineHeight: 1.25, wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
                                    {box.codigo}
                                  </div>
                                  {isMerma && originFolio && (
                                    <div style={{ fontSize: 7.5, color: '#DC2626', fontWeight: 700, marginTop: 3, lineHeight: 1.2 }}>
                                      Segregada de:
                                      <div style={{ fontFamily: 'monospace', wordBreak: 'break-word', overflowWrap: 'anywhere' }}>{originFolio}</div>
                                    </div>
                                  )}
                                  {(isQuarantine || isSegregated) && originFolio && (
                                    <div style={{ fontSize: 7.5, color: '#B45309', fontWeight: 700, marginTop: 3, lineHeight: 1.2 }}>
                                      Segregada de:
                                      <div style={{ fontFamily: 'monospace', wordBreak: 'break-word', overflowWrap: 'anywhere' }}>{originFolio}</div>
                                    </div>
                                  )}
                                  {isPartial && originFolio && (
                                    <div style={{ fontSize: 7.5, color: '#B45309', fontWeight: 700, marginTop: 3, lineHeight: 1.2 }}>
                                      Rescate de:
                                      <div style={{ fontFamily: 'monospace', wordBreak: 'break-word', overflowWrap: 'anywhere' }}>{originFolio}</div>
                                    </div>
                                  )}
                                  {isInactive && (
                                    <div style={{ fontSize: 7.5, color: '#DC2626', fontWeight: 700, marginTop: 3, lineHeight: 1.2 }}>
                                      Reacond. en:
                                      <div style={{ fontFamily: 'monospace', wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
                                        {reconditionedBoxCodigo !== '—' ? reconditionedBoxCodigo : (qiRecord?.cajaDestinoCodigo || '—')}
                                      </div>
                                    </div>
                                  )}
                                </td>
                                <td
                                  style={{
                                    padding: '5px 6px',
                                    border: '1px solid #CBD5E1',
                                    verticalAlign: 'top',
                                    wordBreak: 'break-word',
                                    overflowWrap: 'anywhere',
                                    whiteSpace: 'normal',
                                    height: 'auto',
                                  }}
                                >
                                  {isInactive ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                      <div style={{ fontWeight: 800, color: '#DC2626', fontSize: 8.5, lineHeight: 1.25 }}>
                                        Caja dañada en arribo
                                      </div>
                                      <div style={{ color: '#991B1B', fontSize: 7.5, fontWeight: 700, lineHeight: 1.2 }}>
                                        Inactiva por reacondicionamiento
                                      </div>
                                    </div>
                                  ) : isMerma ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                      <div style={{ fontWeight: 800, color: '#DC2626', fontSize: 8.5, lineHeight: 1.25 }}>
                                        Merma / No Conforme ({pzas} pz)
                                      </div>
                                      <div style={{ color: '#991B1B', fontSize: 7.5, fontWeight: 700, lineHeight: 1.2 }}>
                                        Segregada en almacén virtual DEV-01
                                      </div>
                                    </div>
                                  ) : isQuarantine ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                      <div style={{ fontWeight: 800, color: '#B45309', fontSize: 8.5, lineHeight: 1.25 }}>
                                        Cuarentena / En Inspección ({pzas} pz)
                                      </div>
                                      <div style={{ color: '#92400E', fontSize: 7.5, fontWeight: 700, lineHeight: 1.2 }}>
                                        Retenida fuera de inventario comercial
                                      </div>
                                    </div>
                                  ) : isSegregated ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                      <div style={{ fontWeight: 800, color: '#B45309', fontSize: 8.5, lineHeight: 1.25 }}>
                                        Segregada / No Disponible ({pzas} pz)
                                      </div>
                                      <div style={{ color: '#92400E', fontSize: 7.5, fontWeight: 700, lineHeight: 1.2 }}>
                                        Bloqueada en {box.ubicacionActual || 'Almacén Virtual'}
                                      </div>
                                    </div>
                                  ) : isPartial ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                      <div style={{ fontWeight: 800, color: '#B45309', fontSize: 8.5, lineHeight: 1.25 }}>
                                        Parcial comercial: {pzas} de {standardCap} pz · Reacondicionada
                                      </div>
                                    </div>
                                  ) : (
                                    <div style={{ fontSize: 8.5, color: '#334155', lineHeight: 1.25 }}>
                                      Caja estándar ({standardCap} pz)
                                    </div>
                                  )}
                                </td>
                                <td
                                  style={{
                                    padding: '5px 6px',
                                    border: '1px solid #CBD5E1',
                                    verticalAlign: 'top',
                                    wordBreak: 'break-word',
                                    overflowWrap: 'anywhere',
                                    whiteSpace: 'normal',
                                    height: 'auto',
                                  }}
                                >
                                  <div style={{ fontWeight: 800, color: '#0F172A', fontFamily: 'monospace', fontSize: 8.5, lineHeight: 1.25 }}>
                                    {box.skuCodigo || box.lote?.sku?.codigo || '—'}
                                  </div>
                                  <div style={{ fontSize: 8, color: (isInactive || isMerma) ? '#DC2626' : (isQuarantine || isSegregated) ? '#B45309' : '#475569', marginTop: 2, lineHeight: 1.25 }}>
                                    {(() => {
                                      const rawDesc = box.skuDescripcion || box.lote?.sku?.descripcion || '—';
                                      if (isInactive && !rawDesc.includes('[DAÑO EXTERIOR]')) return `[DAÑO EXTERIOR] ${rawDesc}`;
                                      if (isMerma && !rawDesc.includes('[MERMA DICTAMINADA]')) return `[MERMA DICTAMINADA] ${rawDesc}`;
                                      if (isQuarantine && !rawDesc.includes('[EN CUARENTENA]')) return `[EN CUARENTENA] ${rawDesc}`;
                                      return rawDesc;
                                    })()}
                                  </div>
                                </td>
                                <td
                                  style={{
                                    padding: '5px 6px',
                                    border: '1px solid #CBD5E1',
                                    verticalAlign: 'top',
                                    wordBreak: 'break-word',
                                    overflowWrap: 'anywhere',
                                    whiteSpace: 'normal',
                                    height: 'auto',
                                  }}
                                >
                                  {isInactive ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                      <div style={{ fontWeight: 800, color: '#DC2626', fontSize: 8.5, lineHeight: 1.2 }}>
                                        Saldo actual: 0 pz
                                      </div>
                                      <div style={{ color: '#475569', fontSize: 7.5, fontWeight: 700, lineHeight: 1.2 }}>
                                        Desglose técnico:
                                      </div>
                                      <div style={{ color: '#991B1B', fontSize: 7.5, fontWeight: 700, lineHeight: 1.25 }}>
                                        {qiRecord ? `${standardCap} originales / ${qiRecord.totalPiezasRescatadas ?? 0} rescatadas / ${qiRecord.totalPiezasMerma ?? 0} merma` : `${standardCap} originales / Inactiva por dictamen técnico`}
                                      </div>
                                    </div>
                                  ) : isDespachado ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                      <div style={{ fontWeight: 800, color: '#1E40AF', fontSize: 8.5, lineHeight: 1.2 }}>
                                        Saldo actual: 0 pz
                                      </div>
                                      <div style={{ color: '#1D4ED8', fontSize: 8, fontWeight: 700, lineHeight: 1.2 }}>
                                        Despachadas: {pzas} pz
                                      </div>
                                      <div style={{ color: '#475569', fontSize: 7.5, fontWeight: 600, lineHeight: 1.2 }}>
                                        Pedido: <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{box.pedidoCodigo || box.ordenCodigo || '—'}</span>
                                      </div>
                                    </div>
                                  ) : isMerma ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                      <div style={{ fontWeight: 800, color: '#DC2626', fontSize: 8.5, lineHeight: 1.2 }}>
                                        Saldo no comercial: {pzas} pz
                                      </div>
                                      <div style={{ color: '#991B1B', fontSize: 7.5, fontWeight: 700, lineHeight: 1.2 }}>
                                        Bloqueado (Merma en DEV-01)
                                      </div>
                                    </div>
                                  ) : (isQuarantine || isSegregated) ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                      <div style={{ fontWeight: 800, color: '#B45309', fontSize: 8.5, lineHeight: 1.2 }}>
                                        Saldo no disponible: {pzas} pz
                                      </div>
                                      <div style={{ color: '#92400E', fontSize: 7.5, fontWeight: 700, lineHeight: 1.2 }}>
                                        Bloqueado en almacén virtual
                                      </div>
                                    </div>
                                  ) : isPartial ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                      <div style={{ fontWeight: 800, color: '#B45309', fontSize: 8.5, lineHeight: 1.2 }}>
                                        Saldo actual: {pzas} pz
                                      </div>
                                      <div style={{ color: '#78350F', fontSize: 7.5, fontWeight: 600, lineHeight: 1.2 }}>
                                        En rack (disponible parcial)
                                      </div>
                                    </div>
                                  ) : (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                      <div style={{ fontWeight: 800, color: '#0F172A', fontSize: 8.5, lineHeight: 1.2 }}>
                                        Saldo actual: {pzas} pz
                                      </div>
                                      <div style={{ color: '#166534', fontSize: 7.5, fontWeight: 700, lineHeight: 1.2 }}>
                                        En rack (disponible)
                                      </div>
                                    </div>
                                  )}
                                </td>
                                <td
                                  style={{
                                    padding: '5px 6px',
                                    fontFamily: 'monospace',
                                    border: '1px solid #CBD5E1',
                                    verticalAlign: 'top',
                                    wordBreak: 'break-word',
                                    overflowWrap: 'anywhere',
                                    whiteSpace: 'normal',
                                    height: 'auto',
                                  }}
                                >
                                  <div style={{ fontWeight: 700, fontSize: 8.5, color: '#0F172A', lineHeight: 1.25 }}>
                                    {box.loteTexto || box.lote?.lote || '—'}
                                  </div>
                                  <div style={{ fontSize: 7.5, color: '#64748B', marginTop: 2, fontFamily: 'system-ui, sans-serif', lineHeight: 1.2 }}>
                                    Cad: {cadStr}
                                  </div>
                                </td>
                                <td
                                  style={{
                                    padding: '5px 6px',
                                    border: '1px solid #CBD5E1',
                                    verticalAlign: 'top',
                                    wordBreak: 'break-word',
                                    overflowWrap: 'anywhere',
                                    whiteSpace: 'normal',
                                    height: 'auto',
                                  }}
                                >
                                  {isDespachado ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                      <div style={{ fontWeight: 700, fontSize: 8.5, color: '#1E40AF', lineHeight: 1.2 }}>
                                        Salida / Despacho
                                      </div>
                                      <div style={{ fontSize: 7.5, color: '#64748B', fontWeight: 500, lineHeight: 1.2 }}>
                                        (era {box.ubicacionActual || 'rack'})
                                      </div>
                                    </div>
                                  ) : isInactive ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                      <div style={{ fontWeight: 800, fontSize: 8.5, color: '#DC2626', lineHeight: 1.2 }}>
                                        {box.ubicacionActual || 'AREA_CALIDAD'} (Retención)
                                      </div>
                                      <div style={{ fontSize: 7.5, color: '#64748B', fontWeight: 600, lineHeight: 1.2 }}>
                                        Arribo histórico: {(() => {
                                          const raw = anden !== '—' ? anden : (receipt.andenAsignado || 'Rampa 1 / REC-01');
                                          if (raw.includes('Rampa') && raw.includes('REC')) return raw;
                                          if (raw.includes('REC')) return `Rampa 1 / ${raw}`;
                                          if (raw.includes('Rampa')) return `${raw} / REC-01`;
                                          return `Rampa 1 / ${raw}`;
                                        })()}
                                      </div>
                                    </div>
                                  ) : isMerma ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                      <div style={{ fontWeight: 800, fontSize: 8.5, color: '#DC2626', fontFamily: 'monospace', lineHeight: 1.25 }}>
                                        {box.ubicacionActual || 'DEV-01'}
                                      </div>
                                      <div style={{ fontSize: 7.5, color: '#991B1B', fontWeight: 600, lineHeight: 1.2 }}>
                                        (Almacén Virtual / Merma)
                                      </div>
                                    </div>
                                  ) : isQuarantine ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                      <div style={{ fontWeight: 800, fontSize: 8.5, color: '#B45309', fontFamily: 'monospace', lineHeight: 1.25 }}>
                                        {box.ubicacionActual || 'CUARENTENA'}
                                      </div>
                                      <div style={{ fontSize: 7.5, color: '#92400E', fontWeight: 600, lineHeight: 1.2 }}>
                                        (Cuarentena / Calidad)
                                      </div>
                                    </div>
                                  ) : isSegregated ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                      <div style={{ fontWeight: 800, fontSize: 8.5, color: '#B45309', fontFamily: 'monospace', lineHeight: 1.25 }}>
                                        {box.ubicacionActual || 'VIRTUAL'}
                                      </div>
                                      <div style={{ fontSize: 7.5, color: '#92400E', fontWeight: 600, lineHeight: 1.2 }}>
                                        (Segregada fuera de rack)
                                      </div>
                                    </div>
                                  ) : (
                                    <div style={{ fontWeight: 800, fontSize: 8.5, color: '#0F172A', fontFamily: 'monospace', lineHeight: 1.25 }}>
                                      {box.lote?.ubicacion?.codigo || box.ubicacionActual || 'En Rack'}
                                    </div>
                                  )}
                                </td>
                                <td
                                  style={{
                                    padding: '5px 4px',
                                    border: '1px solid #CBD5E1',
                                    verticalAlign: 'top',
                                    textAlign: 'center',
                                    wordBreak: 'break-word',
                                    overflowWrap: 'anywhere',
                                    whiteSpace: 'normal',
                                    height: 'auto',
                                  }}
                                >
                                  <span
                                    style={{
                                      fontSize: 7.5,
                                      fontWeight: 800,
                                      padding: '2px 4px',
                                      borderRadius: 3,
                                      display: 'inline-block',
                                      width: '100%',
                                      boxSizing: 'border-box',
                                      textAlign: 'center',
                                      lineHeight: 1.2,
                                      backgroundColor: isDespachado
                                        ? '#DBEAFE'
                                        : (isInactive || isMerma)
                                        ? '#FEE2E2'
                                        : (isQuarantine || isSegregated)
                                        ? '#FEF3C7'
                                        : isPartial
                                        ? '#FEF3C7'
                                        : '#DCFCE7',
                                      color: isDespachado
                                        ? '#1E40AF'
                                        : (isInactive || isMerma)
                                        ? '#991B1B'
                                        : (isQuarantine || isSegregated)
                                        ? '#92400E'
                                        : isPartial
                                        ? '#92400E'
                                        : '#166534',
                                      border: `1px solid ${
                                        isDespachado
                                          ? '#93C5FD'
                                          : isMerma
                                          ? '#F87171'
                                          : isInactive
                                          ? '#FCA5A5'
                                          : (isQuarantine || isSegregated || isPartial)
                                          ? '#FCD34D'
                                          : '#86EFAC'
                                      }`,
                                    }}
                                  >
                                    {isDespachado ? (
                                      <>
                                        <div>DESPACHADA</div>
                                        <div style={{ fontSize: 6.5, fontWeight: 700 }}>(Salida)</div>
                                      </>
                                    ) : isInactive ? (
                                      <>
                                        <div>HISTÓRICA</div>
                                        <div style={{ fontSize: 6.5, fontWeight: 700 }}>INACTIVA</div>
                                      </>
                                    ) : isMerma ? (
                                      <>
                                        <div>BLOQUEADA</div>
                                        <div style={{ fontSize: 6.5, fontWeight: 700 }}>MERMA DEV-01</div>
                                      </>
                                    ) : isQuarantine ? (
                                      <>
                                        <div>BLOQUEADA</div>
                                        <div style={{ fontSize: 6.5, fontWeight: 700 }}>CUARENTENA</div>
                                      </>
                                    ) : isSegregated ? (
                                      <>
                                        <div>BLOQUEADA</div>
                                        <div style={{ fontSize: 6.5, fontWeight: 700 }}>SEGREGADA</div>
                                      </>
                                    ) : isPartial ? (
                                      <>
                                        <div>ACTIVA</div>
                                        <div style={{ fontSize: 6.5, fontWeight: 700 }}>PARCIAL</div>
                                      </>
                                    ) : (
                                      <>
                                        <div>ACTIVA</div>
                                        <div style={{ fontSize: 6.5, fontWeight: 700 }}>EN RACK</div>
                                      </>
                                    )}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* PIE INSTITUCIONAL ANEXO A */}
                    <div style={{ textAlign: 'center', marginTop: 8, fontSize: 8, color: '#64748B' }}>
                      Giving Out WMS · Folio {folioTransporte} · Hoja {pageAnnexANum} de {totalPagesFull}
                    </div>
                  </div>
                )}

                {/* ------------------------------------------------------------------- */}
                {/* ANEXO B: BITÁCORA TÉCNICA DE INSPECCIÓN Y RESCATE (CALIDAD)         */}
                {/* ------------------------------------------------------------------- */}
                {includeAnnexB && qiRecord && (
                  <div className="annex-page" style={{ marginTop: 24, paddingTop: 16, borderTop: '2px dashed #94A3B8' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #0F172A', paddingBottom: 6, marginBottom: 8 }}>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 900, color: '#0F172A', textTransform: 'uppercase' }}>
                          ANEXO B · BITÁCORA TÉCNICA DE INSPECCIÓN Y RESCATE
                        </div>
                        <div style={{ fontSize: 9.5, color: '#64748B' }}>
                          Folio Inspección: <strong>{qiRecord.folio}</strong> · Recepción: <strong>{folioTransporte}</strong>
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', fontSize: 9.5, color: '#0F172A', fontWeight: 700 }}>
                        Fecha: {fechaInspeccionCalidad || '—'} · Inspector: <strong>{qiRecord.inspectorNombre || qiRecord.firmadoPor}</strong>
                      </div>
                    </div>

                    <div className="border-box" style={{ border: '1.5px solid #0F172A', borderRadius: 4, padding: '10px 12px', fontSize: 9.5, backgroundColor: '#FAFAFA' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 8 }}>
                        <div style={{ backgroundColor: '#FFFFFF', padding: '6px 8px', borderRadius: 4, border: '1px solid #CBD5E1' }}>
                          <div style={{ fontSize: 8.5, color: '#475569', fontWeight: 700 }}>Caja Origen Dañada</div>
                          <div style={{ fontSize: 10.5, fontWeight: 800, fontFamily: 'monospace', color: '#DC2626' }}>
                            {originDamagedBoxCodigo !== '—' ? originDamagedBoxCodigo : (qiRecord.cajaOrigenCodigo || '—')}
                          </div>
                          <div style={{ fontSize: 8, color: '#64748B' }}>Contenido histórico: {qiRecord.totalPiezasInspeccionadas || 12} piezas</div>
                        </div>
                        <div style={{ backgroundColor: '#FFFFFF', padding: '6px 8px', borderRadius: 4, border: '1px solid #CBD5E1' }}>
                          <div style={{ fontSize: 8.5, color: '#475569', fontWeight: 700 }}>Caja Destino Rescate</div>
                          <div style={{ fontSize: 10.5, fontWeight: 800, fontFamily: 'monospace', color: '#15803D' }}>
                            {reconditionedBoxCodigo !== '—' ? reconditionedBoxCodigo : (qiRecord.cajaDestinoCodigo || '—')}
                          </div>
                          <div style={{ fontSize: 8, color: '#15803D', fontWeight: 700 }}>{qiRecord.totalPiezasRescatadas} piezas conformes rescatadas</div>
                        </div>
                        <div style={{ backgroundColor: '#FFFFFF', padding: '6px 8px', borderRadius: 4, border: '1px solid #CBD5E1' }}>
                          <div style={{ fontSize: 8.5, color: '#475569', fontWeight: 700 }}>Merma Dictaminada</div>
                          <div style={{ fontSize: 10.5, fontWeight: 800, color: '#DC2626' }}>
                            {qiRecord.totalPiezasMerma} piezas
                          </div>
                          <div style={{ fontSize: 8, color: '#DC2626' }}>Envases no aptos por daño físico</div>
                        </div>
                        <div style={{ backgroundColor: '#FFFFFF', padding: '6px 8px', borderRadius: 4, border: '1px solid #CBD5E1' }}>
                          <div style={{ fontSize: 8.5, color: '#475569', fontWeight: 700 }}>Dictamen Operativo</div>
                          <div style={{ fontSize: 10.5, fontWeight: 800, color: '#0F172A' }}>
                            REACONDICIONADO
                          </div>
                          <div style={{ fontSize: 8, color: '#64748B' }}>
                            Horas maquila: {qiRecord.horasMaquila && Number(qiRecord.horasMaquila) > 0 ? `${qiRecord.horasMaquila} hrs` : 'No registrado'}
                          </div>
                        </div>
                      </div>

                      <div style={{ backgroundColor: '#FFFFFF', padding: '8px 10px', borderRadius: 4, border: '1px solid #CBD5E1', lineHeight: 1.4 }}>
                        <strong>Observaciones de la Inspección Técnica:</strong> {qiRecord.observaciones || 'Inspección interna pieza por pieza y reacondicionamiento conforme a protocolo Giving Out 3PL.'}
                      </div>
                    </div>

                    {/* PIE INSTITUCIONAL ANEXO B */}
                    <div style={{ textAlign: 'center', marginTop: 8, fontSize: 8, color: '#64748B' }}>
                      Giving Out WMS · Folio {folioTransporte} · Hoja {pageAnnexBNum} de {totalPagesFull}
                    </div>
                  </div>
                )}

                {/* ------------------------------------------------------------------- */}
                {/* ANEXO C: TRAZABILIDAD DE SALIDAS Y EXISTENCIA ACTUAL                */}
                {/* ------------------------------------------------------------------- */}
                {includeAnnexC && (
                  <div className="annex-page" style={{ marginTop: 24, paddingTop: 16, borderTop: '2px dashed #94A3B8' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #0F172A', paddingBottom: 6, marginBottom: 8 }}>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 900, color: '#0F172A', textTransform: 'uppercase' }}>
                          ANEXO C · TRAZABILIDAD DE SALIDAS Y EXISTENCIA ACTUAL EN ALMACÉN
                        </div>
                        <div style={{ fontSize: 9.5, color: '#64748B' }}>
                          {isOfficiallyClosed ? 'Instantánea posterior al cierre' : 'Instantánea de existencia actual previa al cierre'} · Fecha de consulta: <strong>{fechaEmisionReporte}</strong>
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', fontSize: 9.5, color: '#0F172A', fontWeight: 700 }}>
                        Folio: <strong>{folioTransporte}</strong>
                      </div>
                    </div>

                    <div className="border-box" style={{ border: '1.5px solid #0F172A', borderRadius: 4, padding: '10px 12px', fontSize: 9.5, backgroundColor: '#FAFAFA' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 8 }}>
                        <div style={{ backgroundColor: '#FFFFFF', padding: '6px 8px', borderRadius: 4, border: '1px solid #CBD5E1' }}>
                          <div style={{ fontSize: 8.5, color: '#475569', fontWeight: 700 }}>Físico Actual en Racks</div>
                          <div style={{ fontSize: 13, fontWeight: 900, color: '#0F172A' }}>{piezasActivasEnRacks} PZA</div>
                          <div style={{ fontSize: 8, color: '#15803D', fontWeight: 700 }}>{cajasActivasRacks} cajas activas</div>
                        </div>
                        <div style={{ backgroundColor: '#FFFFFF', padding: '6px 8px', borderRadius: 4, border: '1px solid #CBD5E1' }}>
                          <div style={{ fontSize: 8.5, color: '#475569', fontWeight: 700 }}>Salidas Posteriores</div>
                          <div style={{ fontSize: 13, fontWeight: 900, color: '#1D4ED8' }}>{piezasDespachadas} PZA</div>
                          {cajasDespachadas > 0 ? (
                            <div style={{ fontSize: 8, color: '#1D4ED8', fontWeight: 700 }}>
                              {cajasDespachadas} {cajasDespachadas === 1 ? 'caja' : 'cajas'}{dispatchedOrdersStr}
                            </div>
                          ) : (
                            <div style={{ fontSize: 8, color: '#64748B', fontWeight: 600 }}>
                              Sin salidas posteriores
                            </div>
                          )}
                        </div>
                        <div style={{ backgroundColor: '#FFFFFF', padding: '6px 8px', borderRadius: 4, border: '1px solid #CBD5E1' }}>
                          <div style={{ fontSize: 8.5, color: '#475569', fontWeight: 700 }}>Elegible Caja Cerrada</div>
                          <div style={{ fontSize: 13, fontWeight: 900, color: '#0F766E' }}>{piezasElegiblesCajaCerrada} PZA</div>
                          <div style={{ fontSize: 8, color: '#0F766E', fontWeight: 700 }}>{cajasElegiblesCajaCerrada} cajas cerradas estándar</div>
                        </div>
                        <div style={{ backgroundColor: '#FFFFFF', padding: '6px 8px', borderRadius: 4, border: '1px solid #CBD5E1' }}>
                          <div style={{ fontSize: 8.5, color: '#475569', fontWeight: 700 }}>En Caja Parcial</div>
                          <div style={{ fontSize: 13, fontWeight: 900, color: '#B45309' }}>{piezasActivasEnRacks - piezasElegiblesCajaCerrada} PZA</div>
                          <div style={{ fontSize: 8, color: '#B45309', fontWeight: 700 }}>
                            {cajasActivasRacks - cajasElegiblesCajaCerrada > 0
                              ? `${cajasActivasRacks - cajasElegiblesCajaCerrada} caja parcial (${piezasActivasEnRacks - piezasElegiblesCajaCerrada} pz)`
                              : 'Sin cajas parciales'}
                          </div>
                        </div>
                      </div>

                      <div style={{ backgroundColor: '#FFFFFF', padding: '8px 10px', borderRadius: 4, border: '1px solid #CBD5E1', lineHeight: 1.4 }}>
                        <strong>Balance matemático de existencia:</strong> {totalConformePiezas} piezas conformes {isOfficiallyClosed ? 'al cierre' : 'al pre-cierre'} = {piezasActivasEnRacks} piezas actuales en racks + {piezasDespachadas} piezas despachadas en pedidos posteriores.{cajasDespachadas === 0 ? ' No se registran salidas ni despachos posteriores vinculados a esta recepción.' : ''} Bajo la regla de caja cerrada de {clienteNombre}, únicamente {piezasElegiblesCajaCerrada} piezas son elegibles para asignación automática estándar; {piezasActivasEnRacks - piezasElegiblesCajaCerrada > 0 ? `las ${piezasActivasEnRacks - piezasElegiblesCajaCerrada} piezas restantes corresponden a la caja parcial reacondicionada ${reconditionedBoxCodigo}.` : 'la totalidad de las piezas en inventario corresponden a cajas cerradas estándar.'}
                      </div>
                    </div>

                    {/* PIE INSTITUCIONAL ANEXO C */}
                    <div style={{ textAlign: 'center', marginTop: 8, fontSize: 8, color: '#64748B' }}>
                      Giving Out WMS · Folio {folioTransporte} · Hoja {pageAnnexCNum} de {totalPagesFull}
                    </div>
                  </div>
                )}

              </div>

            </div>
          )}
        </div>

      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
