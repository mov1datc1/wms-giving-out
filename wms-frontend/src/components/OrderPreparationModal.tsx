import { useState, useEffect } from 'react';
import {
  X,
  Sliders,
  Package,
  Layers,
  Lock,
  CheckCircle2,
  AlertTriangle,
  Zap,
  Calendar,
  Clock,
  Building2,
  Store,
  MapPin,
  RotateCcw,
  FileText,
  Check,
  ChevronRight,
  Info
} from 'lucide-react';
import { API } from '../config/api';
import { formatCalendarDate } from '../utils/dateUtils';

interface AllocationLot {
  lotId: string;
  lote: string;
  fechaVencimiento: string | null;
  ubicacionCodigo: string;
  stockLibre: number;
  stockFisico: number;
  cantidadAsignada: number;
}

interface AllocationLine {
  lineId: string;
  skuId: string;
  skuCodigo: string;
  skuDescripcion: string;
  uom: string;
  cantidadSolicitada: number;
  lotes: AllocationLot[];
}

interface OrderPreparationModalProps {
  orderId: string;
  token: string;
  currentUser: string;
  onClose: () => void;
  onSuccess: (updatedOrder: any) => void;
}

export function OrderPreparationModal({
  orderId,
  token,
  currentUser,
  onClose,
  onSuccess,
}: OrderPreparationModalProps) {
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [orderData, setOrderData] = useState<any>(null);
  const [lines, setLines] = useState<AllocationLine[]>([]);
  const [allocationMode, setAllocationMode] = useState<'AUTO_FEFO' | 'AUTO_FIFO' | 'MANUAL'>('AUTO_FEFO');
  const [supervisorNotas, setSupervisorNotas] = useState('');

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  useEffect(() => {
    fetchAllocationData();
  }, [orderId]);

  async function fetchAllocationData() {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`${API}/orders/${orderId}/suggest-allocation`, { headers });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || 'No se pudo obtener la sugerencia de asignación');
      }

      const data = await res.json();
      setOrderData(data);
      setAllocationMode(data.reglaAplicada === 'FEFO' ? 'AUTO_FEFO' : 'AUTO_FIFO');

      // Mapear líneas con sus lotes disponibles y sugerencias iniciales
      const parsedLines: AllocationLine[] = (data.lineas || []).map((l: any) => {
        const lotMap = new Map<string, number>();

        // Si ya hay sugerencia automática, poblar cantidades sugeridas
        (l.sugerencia || []).forEach((sug: any) => {
          lotMap.set(sug.lotId, Number(sug.cantidadSugerida) || 0);
        });

        // Combinar todos los lotes disponibles con las cantidades asignadas
        const allLots: AllocationLot[] = (l.lotesDisponibles || []).map((lot: any) => ({
          lotId: lot.lotId,
          lote: lot.lote || 'SIN_LOTE',
          fechaVencimiento: lot.fechaVencimiento,
          ubicacionCodigo: lot.ubicacionCodigo || 'ANDEN',
          stockLibre: Number(lot.stockLibre) || 0,
          stockFisico: Number(lot.stockFisico) || 0,
          cantidadAsignada: lotMap.get(lot.lotId) || 0,
        }));

        return {
          lineId: l.lineId,
          skuId: l.skuId,
          skuCodigo: l.skuCodigo,
          skuDescripcion: l.skuDescripcion,
          uom: l.uom || 'PZA',
          cantidadSolicitada: Number(l.cantidadSolicitada) || 0,
          lotes: allLots,
        };
      });

      setLines(parsedLines);
    } catch (err: any) {
      console.error('Error fetching allocation suggestion:', err);
      setErrorMsg(err.message || 'Error al conectar con el servidor.');
    } finally {
      setLoading(false);
    }
  }

  // Aplicar sugerencia automática (FEFO / FIFO)
  function applyAutomaticSuggestion() {
    if (!orderData) return;
    setAllocationMode(orderData.reglaAplicada === 'FEFO' ? 'AUTO_FEFO' : 'AUTO_FIFO');

    setLines(prev =>
      prev.map(line => {
        const rawLine = orderData.lineas.find((l: any) => l.lineId === line.lineId);
        if (!rawLine) return line;

        const sugMap = new Map<string, number>();
        (rawLine.sugerencia || []).forEach((sug: any) => {
          sugMap.set(sug.lotId, Number(sug.cantidadSugerida) || 0);
        });

        return {
          ...line,
          lotes: line.lotes.map(lot => {
            const exp = formatExpiry(lot.fechaVencimiento);
            return {
              ...lot,
              cantidadAsignada: exp.isExpired ? 0 : (sugMap.get(lot.lotId) || 0),
            };
          }),
        };
      })
    );
  }

  // Restablecer todas las asignaciones a cero para selección manual libre
  function resetAllocations() {
    setAllocationMode('MANUAL');
    setLines(prev =>
      prev.map(line => ({
        ...line,
        lotes: line.lotes.map(lot => ({
          ...lot,
          cantidadAsignada: 0,
        })),
      }))
    );
  }

  // Modificar cantidad asignada a un lote específico
  function handleLotQtyChange(lineId: string, lotId: string, val: string | number) {
    setAllocationMode('MANUAL');
    setLines(prev =>
      prev.map(line => {
        if (line.lineId !== lineId) return line;

        const lot = line.lotes.find(l => l.lotId === lotId);
        if (!lot) return line;

        const exp = formatExpiry(lot.fechaVencimiento);
        if (exp.isExpired) {
          return {
            ...line,
            lotes: line.lotes.map(l => (l.lotId === lotId ? { ...l, cantidadAsignada: 0 } : l)),
          };
        }

        let num = typeof val === 'number' ? val : parseInt(String(val).replace(/\D/g, ''), 10);
        if (isNaN(num) || num < 0) num = 0;

        // Tope por stock libre en ese lote
        if (num > lot.stockLibre) {
          num = lot.stockLibre;
        }

        return {
          ...line,
          lotes: line.lotes.map(l => (l.lotId === lotId ? { ...l, cantidadAsignada: num } : l)),
        };
      })
    );
  }

  // Asignar el máximo disponible posible de un lote hasta cubrir lo solicitado
  function handleAssignMax(lineId: string, lotId: string) {
    setAllocationMode('MANUAL');
    setLines(prev =>
      prev.map(line => {
        if (line.lineId !== lineId) return line;

        const lot = line.lotes.find(l => l.lotId === lotId);
        if (!lot) return line;

        const exp = formatExpiry(lot.fechaVencimiento);
        if (exp.isExpired) return line;

        const currentAllocatedExcludingThis = line.lotes
          .filter(l => l.lotId !== lotId)
          .reduce((sum, l) => sum + l.cantidadAsignada, 0);

        const needed = Math.max(0, line.cantidadSolicitada - currentAllocatedExcludingThis);

        const toTake = Math.min(needed, lot.stockLibre);

        return {
          ...line,
          lotes: line.lotes.map(l => (l.lotId === lotId ? { ...l, cantidadAsignada: toTake } : l)),
        };
      })
    );
  }

  // Cálculos de cuadratura
  const lineMetrics = lines.map(line => {
    const totalAllocated = line.lotes.reduce((sum, l) => sum + l.cantidadAsignada, 0);
    const diff = totalAllocated - line.cantidadSolicitada;
    const isCuadrado = diff === 0;
    return {
      lineId: line.lineId,
      totalAllocated,
      diff,
      isCuadrado,
    };
  });

  const allLinesCuadradas = lineMetrics.length > 0 && lineMetrics.every(m => m.isCuadrado);
  const totalSolicitadoGlobal = lines.reduce((s, l) => s + l.cantidadSolicitada, 0);
  const totalAsignadoGlobal = lineMetrics.reduce((s, m) => s + m.totalAllocated, 0);

  // Enviar asignación al backend
  async function handleConfirmPreparation() {
    if (!allLinesCuadradas) return;

    setSubmitting(true);
    setErrorMsg(null);

    const payload = {
      usuario: currentUser || 'Alejandra (Supervisor)',
      modo: allocationMode,
      notas: supervisorNotas,
      asignaciones: lines.map(line => ({
        lineId: line.lineId,
        lotes: line.lotes
          .filter(l => l.cantidadAsignada > 0)
          .map(l => ({
            lotId: l.lotId,
            cantidad: l.cantidadAsignada,
            lote: l.lote,
            ubicacionCodigo: l.ubicacionCodigo,
          })),
      })),
    };

    try {
      const res = await fetch(`${API}/orders/${orderId}/prepare`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Error al confirmar la preparación de la orden');
      }

      const updated = await res.json();
      onSuccess(updated);
      onClose();
    } catch (err: any) {
      console.error('Error confirming order preparation:', err);
      setErrorMsg(err.message || 'Error al procesar la preparación.');
    } finally {
      setSubmitting(false);
    }
  }

  // Helpers de fecha y días de vencimiento
  function formatExpiry(expiryStr: string | null) {
    if (!expiryStr) return { text: 'Sin Vencimiento', isExpiringSoon: false, isExpired: false, diffDays: null };
    const dateFormatted = formatCalendarDate(expiryStr);
    const dateParts = expiryStr.slice(0, 10).split('-').map(Number);
    const expDateUtc = new Date(Date.UTC(dateParts[0], (dateParts[1] || 1) - 1, dateParts[2] || 1));
    const now = new Date();
    const todayUtc = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    const diffDays = Math.ceil((expDateUtc.getTime() - todayUtc.getTime()) / (1000 * 60 * 60 * 24));

    const isExpired = diffDays <= 0;

    return {
      text: isExpired ? `${dateFormatted} (¡Caducado!)` : `${dateFormatted} (${diffDays} días)`,
      diffDays,
      isExpiringSoon: diffDays <= 60 && !isExpired,
      isExpired,
    };
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.75)',
        backdropFilter: 'blur(4px)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        style={{
          backgroundColor: '#FFFFFF',
          borderRadius: 12,
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
          border: '1px solid #E2E8F0',
          width: '100%',
          maxWidth: 960,
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          animation: 'fadeIn 0.2s ease-out',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '20px 24px',
            borderBottom: '1px solid #E2E8F0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: '#F8FAFC',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 10,
                backgroundColor: 'rgba(13, 148, 136, 0.1)',
                color: '#0D9488',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Sliders size={22} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <h2 style={{ fontSize: 18, fontWeight: 700, color: '#0F172A', margin: 0 }}>
                  Panel de Preparación y Asignación de Lotes
                </h2>
                <span
                  style={{
                    backgroundColor: '#E0F2FE',
                    color: '#0369A1',
                    padding: '2px 8px',
                    borderRadius: 6,
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  {orderData?.codigo || orderId}
                </span>
                <span
                  style={{
                    backgroundColor: orderData?.reglaAplicada === 'FEFO' ? '#FEF3C7' : '#F1F5F9',
                    color: orderData?.reglaAplicada === 'FEFO' ? '#B45309' : '#475569',
                    padding: '2px 8px',
                    borderRadius: 6,
                    fontSize: 12,
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <Zap size={12} />
                  Rotación {orderData?.reglaAplicada || 'FEFO'}
                </span>
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  marginTop: 4,
                  fontSize: 13,
                  color: '#64748B',
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Building2 size={13} />
                  Depositante: <strong style={{ color: '#1E293B' }}>{orderData?.cliente?.nombre || 'Cargando...'}</strong>
                </span>
                <span>•</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Store size={13} />
                  Cliente Final: <strong style={{ color: '#0D9488' }}>{orderData?.endCustomer?.nombre || 'Entrega General'}</strong>
                </span>
                {orderData?.fechaCompromiso && (
                  <>
                    <span>•</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Calendar size={13} />
                      Cita: {new Date(orderData.fechaCompromiso).toLocaleDateString('es-MX')} ({orderData.horaCompromiso || '09:00'})
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: '#94A3B8',
              padding: 6,
              borderRadius: 6,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Content Body */}
        <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: '#64748B' }}>
              <div
                style={{
                  display: 'inline-block',
                  width: 32,
                  height: 32,
                  border: '3px solid #E2E8F0',
                  borderTopColor: '#0D9488',
                  borderRadius: '50%',
                  animation: 'spin 1s linear infinite',
                  marginBottom: 12,
                }}
              />
              <p style={{ margin: 0, fontWeight: 500 }}>
                Analizando existencias físicas en racks y calculando ruta FEFO/FIFO...
              </p>
            </div>
          ) : errorMsg ? (
            <div
              style={{
                backgroundColor: '#FEF2F2',
                border: '1px solid #F87171',
                borderRadius: 8,
                padding: '16px 20px',
                color: '#991B1B',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
              }}
            >
              <AlertTriangle size={20} />
              <div>
                <strong>Atención:</strong> {errorMsg}
              </div>
            </div>
          ) : (
            <>
              {/* Executive Strip: 3 Live Stock Pillars */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: 14,
                  marginBottom: 20,
                }}
              >
                <div
                  style={{
                    backgroundColor: '#F8FAFC',
                    border: '1px solid #E2E8F0',
                    borderRadius: 8,
                    padding: '12px 16px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                  }}
                >
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 8,
                      backgroundColor: 'rgba(14, 165, 233, 0.1)',
                      color: '#0284C7',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Layers size={18} />
                  </div>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#64748B', textTransform: 'uppercase' }}>
                      Físico Total en Racks
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: '#0F172A' }}>
                      {lines.reduce((sum, l) => sum + l.lotes.reduce((s, lot) => s + lot.stockFisico, 0), 0)} pzas
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    backgroundColor: '#F8FAFC',
                    border: '1px solid #E2E8F0',
                    borderRadius: 8,
                    padding: '12px 16px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                  }}
                >
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 8,
                      backgroundColor: 'rgba(245, 158, 11, 0.1)',
                      color: '#D97706',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Lock size={18} />
                  </div>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#64748B', textTransform: 'uppercase' }}>
                      Reserva Inmediata (Este Pedido)
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: '#B45309' }}>
                      {totalSolicitadoGlobal} pzas
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    backgroundColor: allLinesCuadradas ? '#F0FDF4' : '#FFFBEB',
                    border: allLinesCuadradas ? '1px solid #86EFAC' : '1px solid #FCD34D',
                    borderRadius: 8,
                    padding: '12px 16px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                  }}
                >
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 8,
                      backgroundColor: allLinesCuadradas ? 'rgba(34, 197, 94, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                      color: allLinesCuadradas ? '#15803D' : '#D97706',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {allLinesCuadradas ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
                  </div>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#64748B', textTransform: 'uppercase' }}>
                      Balance de Asignación
                    </div>
                    <div
                      style={{
                        fontSize: 18,
                        fontWeight: 800,
                        color: allLinesCuadradas ? '#15803D' : '#D97706',
                      }}
                    >
                      {totalAsignadoGlobal} / {totalSolicitadoGlobal} pzas {allLinesCuadradas ? '(Cuadrado)' : ''}
                    </div>
                  </div>
                </div>
              </div>

              {/* Toolbar Actions */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  backgroundColor: '#F1F5F9',
                  borderRadius: 8,
                  padding: '10px 16px',
                  marginBottom: 20,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#475569' }}>
                  <Info size={16} color="#0D9488" />
                  <span>
                    El supervisor valida o modifica de qué ubicaciones y lotes físicos se surtirá cada partida.
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <button
                    type="button"
                    onClick={applyAutomaticSuggestion}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      backgroundColor: '#0D9488',
                      color: '#FFFFFF',
                      border: 'none',
                      borderRadius: 6,
                      padding: '7px 14px',
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: 'pointer',
                      transition: 'background-color 0.2s',
                    }}
                  >
                    <Zap size={14} />
                    Aplicar Sugerencia {orderData?.reglaAplicada || 'FEFO'}
                  </button>
                  <button
                    type="button"
                    onClick={resetAllocations}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      backgroundColor: '#FFFFFF',
                      color: '#475569',
                      border: '1px solid #CBD5E1',
                      borderRadius: 6,
                      padding: '7px 12px',
                      fontSize: 12,
                      fontWeight: 500,
                      cursor: 'pointer',
                    }}
                  >
                    <RotateCcw size={14} />
                    Restablecer
                  </button>
                </div>
              </div>

              {/* Line Items Matrix */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                {lines.map((line, idx) => {
                  const metric = lineMetrics[idx];
                  return (
                    <div
                      key={line.lineId}
                      style={{
                        backgroundColor: '#FFFFFF',
                        border: metric?.isCuadrado ? '1px solid #E2E8F0' : '1px solid #F59E0B',
                        borderRadius: 10,
                        overflow: 'hidden',
                        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)',
                      }}
                    >
                      {/* Line Header */}
                      <div
                        style={{
                          backgroundColor: '#F8FAFC',
                          padding: '12px 18px',
                          borderBottom: '1px solid #E2E8F0',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <span
                            style={{
                              backgroundColor: '#0F172A',
                              color: '#FFFFFF',
                              padding: '2px 8px',
                              borderRadius: 4,
                              fontSize: 12,
                              fontWeight: 700,
                              fontFamily: 'monospace',
                            }}
                          >
                            {line.skuCodigo}
                          </span>
                          <span style={{ fontSize: 14, fontWeight: 600, color: '#1E293B' }}>
                            {line.skuDescripcion}
                          </span>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                          <div style={{ fontSize: 13, color: '#475569' }}>
                            Solicitado:{' '}
                            <strong style={{ color: '#0F172A' }}>
                              {line.cantidadSolicitada} {line.uom}
                            </strong>
                          </div>

                          <span
                            style={{
                              backgroundColor: metric?.isCuadrado
                                ? '#DCFCE7'
                                : metric?.diff > 0
                                ? '#FEE2E2'
                                : '#FEF3C7',
                              color: metric?.isCuadrado
                                ? '#166534'
                                : metric?.diff > 0
                                ? '#991B1B'
                                : '#92400E',
                              padding: '4px 10px',
                              borderRadius: 6,
                              fontSize: 12,
                              fontWeight: 700,
                              display: 'flex',
                              alignItems: 'center',
                              gap: 6,
                            }}
                          >
                            {metric?.isCuadrado ? (
                              <>
                                <CheckCircle2 size={13} />
                                {metric.totalAllocated} / {line.cantidadSolicitada} {line.uom} (100% Cuadrado)
                              </>
                            ) : metric?.diff > 0 ? (
                              <>
                                <AlertTriangle size={13} />
                                Excedido por +{metric.diff} {line.uom}
                              </>
                            ) : (
                              <>
                                <AlertTriangle size={13} />
                                Faltan {Math.abs(metric.diff)} {line.uom} ({metric.totalAllocated} / {line.cantidadSolicitada})
                              </>
                            )}
                          </span>
                        </div>
                      </div>

                      {/* Candidate Lots Table */}
                      <div style={{ padding: '14px 18px' }}>
                        {line.lotes.length === 0 ? (
                          <div style={{ padding: 12, color: '#94A3B8', fontSize: 13, fontStyle: 'italic' }}>
                            No se encontraron lotes con stock libre para este producto.
                          </div>
                        ) : (
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                            <thead>
                              <tr style={{ borderBottom: '1px solid #E2E8F0', color: '#64748B', textAlign: 'left' }}>
                                <th style={{ padding: '8px 10px', fontWeight: 600 }}>Lote</th>
                                <th style={{ padding: '8px 10px', fontWeight: 600 }}>Caducidad</th>
                                <th style={{ padding: '8px 10px', fontWeight: 600 }}>Ubicación / Rack</th>
                                <th style={{ padding: '8px 10px', fontWeight: 600 }}>Stock Libre</th>
                                <th style={{ padding: '8px 10px', fontWeight: 600, width: 220, textAlign: 'right' }}>
                                  Cantidad a Surtir
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {line.lotes.map(lot => {
                                const expiry = formatExpiry(lot.fechaVencimiento);
                                const isAssigned = lot.cantidadAsignada > 0;
                                return (
                                  <tr
                                    key={lot.lotId}
                                    style={{
                                      borderBottom: '1px solid #F1F5F9',
                                      backgroundColor: isAssigned ? '#F0FDFA' : (expiry.isExpired ? '#FEF2F2' : 'transparent'),
                                      transition: 'background-color 0.15s',
                                    }}
                                  >
                                    <td style={{ padding: '10px 10px', fontWeight: 600, color: '#0F172A' }}>
                                      {lot.lote}
                                    </td>
                                    <td style={{ padding: '10px 10px' }}>
                                      <span
                                        style={{
                                          color: expiry.isExpired ? '#DC2626' : (expiry.isExpiringSoon ? '#B45309' : '#475569'),
                                          fontWeight: (expiry.isExpired || expiry.isExpiringSoon) ? 700 : 400,
                                          fontSize: 12,
                                          display: 'inline-flex',
                                          alignItems: 'center',
                                          gap: 4,
                                          backgroundColor: expiry.isExpired ? '#FEE2E2' : 'transparent',
                                          padding: expiry.isExpired ? '2px 8px' : 0,
                                          borderRadius: 4,
                                          border: expiry.isExpired ? '1px solid #FECACA' : 'none',
                                        }}
                                      >
                                        {expiry.isExpired && <AlertTriangle size={12} color="#DC2626" />}
                                        {expiry.text}
                                      </span>
                                    </td>
                                    <td style={{ padding: '10px 10px' }}>
                                      <span
                                        style={{
                                          backgroundColor: '#F1F5F9',
                                          color: '#334155',
                                          padding: '2px 8px',
                                          borderRadius: 4,
                                          fontSize: 12,
                                          fontWeight: 600,
                                          fontFamily: 'monospace',
                                          display: 'inline-flex',
                                          alignItems: 'center',
                                          gap: 4,
                                        }}
                                      >
                                        <MapPin size={11} />
                                        {lot.ubicacionCodigo}
                                      </span>
                                    </td>
                                    <td style={{ padding: '10px 10px', color: '#64748B' }}>
                                      {lot.stockLibre} {line.uom}
                                    </td>
                                    <td style={{ padding: '10px 10px', textAlign: 'right' }}>
                                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                        <button
                                          type="button"
                                          onClick={() =>
                                            handleLotQtyChange(line.lineId, lot.lotId, Math.max(0, lot.cantidadAsignada - 1))
                                          }
                                          disabled={lot.cantidadAsignada <= 0 || expiry.isExpired}
                                          style={{
                                            width: 28,
                                            height: 28,
                                            border: '1px solid #CBD5E1',
                                            backgroundColor: '#FFFFFF',
                                            borderRadius: 4,
                                            cursor: (lot.cantidadAsignada <= 0 || expiry.isExpired) ? 'not-allowed' : 'pointer',
                                            opacity: (lot.cantidadAsignada <= 0 || expiry.isExpired) ? 0.4 : 1,
                                            fontWeight: 700,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                          }}
                                        >
                                          -
                                        </button>
                                        <input
                                          type="text"
                                          inputMode="numeric"
                                          disabled={expiry.isExpired}
                                          value={lot.cantidadAsignada === 0 ? '' : lot.cantidadAsignada}
                                          placeholder="0"
                                          title={expiry.isExpired ? 'Lote caducado - Asignación bloqueada por sanidad' : ''}
                                          onChange={e => handleLotQtyChange(line.lineId, lot.lotId, e.target.value)}
                                          style={{
                                            width: 58,
                                            height: 28,
                                            textAlign: 'center',
                                            border: '1px solid #CBD5E1',
                                            borderRadius: 4,
                                            fontSize: 13,
                                            fontWeight: 700,
                                            color: expiry.isExpired ? '#94A3B8' : (isAssigned ? '#0D9488' : '#0F172A'),
                                            backgroundColor: expiry.isExpired ? '#F1F5F9' : (isAssigned ? '#FFFFFF' : '#F8FAFC'),
                                            cursor: expiry.isExpired ? 'not-allowed' : 'text',
                                          }}
                                        />
                                        <button
                                          type="button"
                                          onClick={() =>
                                            handleLotQtyChange(
                                              line.lineId,
                                              lot.lotId,
                                              Math.min(lot.stockLibre, lot.cantidadAsignada + 1)
                                            )
                                          }
                                          disabled={lot.cantidadAsignada >= lot.stockLibre || expiry.isExpired}
                                          style={{
                                            width: 28,
                                            height: 28,
                                            border: '1px solid #CBD5E1',
                                            backgroundColor: '#FFFFFF',
                                            borderRadius: 4,
                                            cursor: (lot.cantidadAsignada >= lot.stockLibre || expiry.isExpired) ? 'not-allowed' : 'pointer',
                                            opacity: (lot.cantidadAsignada >= lot.stockLibre || expiry.isExpired) ? 0.4 : 1,
                                            fontWeight: 700,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                          }}
                                        >
                                          +
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => handleAssignMax(line.lineId, lot.lotId)}
                                          disabled={expiry.isExpired}
                                          title={expiry.isExpired ? 'Lote caducado' : ''}
                                          style={{
                                            padding: '4px 8px',
                                            border: '1px solid #94A3B8',
                                            backgroundColor: '#FFFFFF',
                                            borderRadius: 4,
                                            fontSize: 11,
                                            fontWeight: 600,
                                            cursor: expiry.isExpired ? 'not-allowed' : 'pointer',
                                            opacity: expiry.isExpired ? 0.4 : 1,
                                            color: '#475569',
                                          }}
                                        >
                                          Máx
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Instructions / Notes for Picker */}
              <div style={{ marginTop: 20 }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: 12,
                    fontWeight: 600,
                    color: '#475569',
                    marginBottom: 6,
                  }}
                >
                  Instrucciones u Observaciones para el Surtidor (Opcional):
                </label>
                <textarea
                  value={supervisorNotas}
                  onChange={e => setSupervisorNotas(e.target.value)}
                  placeholder="Ej. Palletizar con emplaye reforzado y colocar etiqueta de Walmart en cara frontal..."
                  rows={2}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: 6,
                    border: '1px solid #CBD5E1',
                    fontSize: 13,
                    color: '#0F172A',
                    fontFamily: 'inherit',
                    resize: 'vertical',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '16px 24px',
            borderTop: '1px solid #E2E8F0',
            backgroundColor: '#F8FAFC',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ fontSize: 13, color: '#64748B' }}>
            Supervisor activo: <strong style={{ color: '#1E293B' }}>{currentUser || 'Alejandra'}</strong>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              style={{
                padding: '9px 16px',
                borderRadius: 6,
                border: '1px solid #CBD5E1',
                backgroundColor: '#FFFFFF',
                color: '#475569',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleConfirmPreparation}
              disabled={!allLinesCuadradas || submitting || loading}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '9px 20px',
                borderRadius: 6,
                border: 'none',
                backgroundColor: allLinesCuadradas && !submitting ? '#0D9488' : '#94A3B8',
                color: '#FFFFFF',
                fontSize: 13,
                fontWeight: 700,
                cursor: allLinesCuadradas && !submitting ? 'pointer' : 'not-allowed',
                boxShadow: allLinesCuadradas ? '0 2px 4px rgba(13, 148, 136, 0.25)' : 'none',
                transition: 'background-color 0.2s',
              }}
            >
              {submitting ? (
                <>Procesando...</>
              ) : (
                <>
                  <Check size={16} />
                  Confirmar Asignación y Enviar a Picking
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
