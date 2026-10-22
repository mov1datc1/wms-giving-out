import React, { useState, useEffect } from 'react';
import {
  ShieldAlert, MapPin, Box, Boxes, AlertTriangle,
  X, CheckCircle2, RefreshCw, Info, Lock, ArrowRight,
  ShieldCheck, FileText, Calendar
} from 'lucide-react';
import { API } from '../config/api';
import { formatCalendarDate } from '../utils/dateUtils';

export interface QuarantineModalProps {
  item: any;
  token?: string;
  currentUser?: string;
  onClose: () => void;
  onSuccess: (result: any) => void;
}

const MOTIVOS_CUARENTENA = [
  'Daño visible',
  'Empaque deteriorado',
  'Inspección de calidad',
  'Producto sospechoso',
  'Diferencia física',
  'Incidencia de manipulación',
  'Otro',
];

export function QuarantineModal({
  item,
  token,
  currentUser = 'Supervisor de Calidad',
  onClose,
  onSuccess,
}: QuarantineModalProps) {
  const [locations, setLocations] = useState<any[]>([]);
  const [loadingLocations, setLoadingLocations] = useState(true);
  const [targetLocationId, setTargetLocationId] = useState('');
  const [motivo, setMotivo] = useState(MOTIVOS_CUARENTENA[0]);
  const [observaciones, setObservaciones] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Manejo de HUs individuales
  const hasHus = Array.isArray(item?.handlingUnits) && item.handlingUnits.length > 0;
  const [selectedHuIds, setSelectedHuIds] = useState<string[]>(() => {
    if (hasHus) {
      return item.handlingUnits
        .filter((hu: any) => {
          const s = (hu.estadoHu || hu.estado || 'ACTIVO').toUpperCase();
          return s === 'ACTIVO' || s === 'ACTIVA';
        })
        .map((hu: any) => hu.id);
    }
    return [];
  });

  // Manejo de inventario legado sin HUs: campo vacío inicialmente para requerir captura explícita
  const availableScalarQty = Math.max(0, (item?.cantidadDisponibleVendible ?? item?.cantidadFisica ?? 0));
  const [scalarQty, setScalarQty] = useState<string>('');
  const [scalarTouched, setScalarTouched] = useState<boolean>(false);

  // Tecla Escape para cerrar
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [submitting, onClose]);

  // Cargar ubicaciones de cuarentena válidas
  useEffect(() => {
    async function fetchQuarantineLocations() {
      setLoadingLocations(true);
      try {
        const res = await fetch(`${API}/locations`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (res.ok) {
          const data: any[] = await res.json();
          // Filtrar ubicaciones de cuarentena / no conforme
          const quarantineLocs = data.filter(loc => {
            if (!loc.activo) return false;
            if (loc.estado === 'BLOQUEADO') return false;
            return (
              loc.codigo === 'NC-EXCESO-01' ||
              loc.tipoUbicacion === 'CUARENTENA' ||
              (loc.nombre && loc.nombre.toLowerCase().includes('cuarentena'))
            );
          });

          setLocations(quarantineLocs);
          // Por defecto seleccionar NC-EXCESO-01 si existe
          const ncDefault = quarantineLocs.find(l => l.codigo === 'NC-EXCESO-01') || quarantineLocs[0];
          if (ncDefault) {
            setTargetLocationId(ncDefault.id);
          }
        }
      } catch (err) {
        console.error('Error al cargar ubicaciones de cuarentena:', err);
        setErrorMsg('No se pudieron consultar las ubicaciones de cuarentena disponibles.');
      } finally {
        setLoadingLocations(false);
      }
    }

    fetchQuarantineLocations();
  }, [token]);

  const toggleHu = (huId: string) => {
    setSelectedHuIds(prev =>
      prev.includes(huId) ? prev.filter(id => id !== huId) : [...prev, huId]
    );
    if (errorMsg) setErrorMsg(null);
  };

  const selectAllHus = () => {
    if (!item?.handlingUnits) return;
    const all = item.handlingUnits.map((h: any) => h.id);
    setSelectedHuIds(all);
    if (errorMsg) setErrorMsg(null);
  };

  const deselectAllHus = () => {
    setSelectedHuIds([]);
    if (errorMsg) setErrorMsg(null);
  };

  // Cálculo de unidades físicas a enviar a cuarentena
  const parsedScalar = parseInt(scalarQty, 10);
  const isScalarCaptured = scalarQty.trim() !== '' && !isNaN(parsedScalar);
  const isScalarValid = isScalarCaptured && parsedScalar > 0 && parsedScalar <= availableScalarQty;
  const isFormValid = hasHus ? selectedHuIds.length > 0 : isScalarValid;

  let movingUnits = 0;
  let movingBultosCount = 0;
  if (hasHus) {
    const selectedObjs = item.handlingUnits.filter((h: any) => selectedHuIds.includes(h.id));
    movingUnits = selectedObjs.reduce((acc: number, h: any) => acc + Number(h.cantidad || 0), 0);
    movingBultosCount = selectedObjs.length;
  } else {
    movingUnits = isScalarValid ? parsedScalar : 0;
    movingBultosCount = 0;
  }

  const targetLocObj = locations.find(l => l.id === targetLocationId || l.codigo === targetLocationId);

  // Ejecución del envío a cuarentena
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (motivo === 'Otro' && !observaciones.trim()) {
      setErrorMsg('Al seleccionar el motivo "Otro", es obligatorio ingresar una observación técnica.');
      return;
    }

    if (hasHus && selectedHuIds.length === 0) {
      setErrorMsg('Debe seleccionar al menos una Handling Unit (HU) física para enviar a cuarentena.');
      return;
    }

    if (!hasHus) {
      if (!isScalarCaptured) {
        setErrorMsg('Debe capturar explícitamente la cantidad de piezas a enviar a cuarentena.');
        return;
      }
      if (parsedScalar <= 0) {
        setErrorMsg('La cantidad a enviar a cuarentena debe ser mayor a 0 piezas.');
        return;
      }
      if (parsedScalar > availableScalarQty) {
        setErrorMsg(`La cantidad indicada (${parsedScalar}) supera el saldo físico disponible de la partida (${availableScalarQty} piezas).`);
        return;
      }
    }

    setSubmitting(true);
    try {
      let payloadItems: any[] = [];
      if (hasHus) {
        payloadItems = item.handlingUnits
          .filter((h: any) => selectedHuIds.includes(h.id))
          .map((h: any) => ({
            lotId: item.id || item.lotId,
            huId: h.id,
            cantidad: Number(h.cantidad || 0),
            motivo: motivo === 'Otro' ? observaciones.trim() : motivo,
          }));
      } else {
        payloadItems = [
          {
            lotId: item.id || item.lotId,
            cantidad: movingUnits,
            motivo: motivo === 'Otro' ? observaciones.trim() : motivo,
          },
        ];
      }

      const payload = {
        tipoOperacion: 'CUARENTENA',
        ubicacionDestinoId: targetLocationId || undefined,
        motivo: motivo === 'Otro' ? observaciones.trim() : motivo,
        notas: observaciones.trim() || undefined,
        usuario: currentUser,
        items: payloadItems,
      };

      const res = await fetch(`${API}/inventory/quarantine`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Error operativo al enviar mercancía a cuarentena.');
      }

      onSuccess(data);
    } catch (err: any) {
      console.error('Error al enviar a cuarentena:', err);
      setErrorMsg(err.message || 'Error de comunicación con el servidor WMS.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
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
        zIndex: 1000,
        padding: 16,
      }}
    >
      <div
        className="modal-container"
        style={{
          width: '100%',
          maxWidth: 780,
          maxHeight: '92vh',
          backgroundColor: '#FFFFFF',
          borderRadius: 12,
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          border: '1px solid var(--border, #E2E8F0)',
        }}
      >
        {/* Cabecera del Modal */}
        <div
          style={{
            padding: '16px 22px',
            borderBottom: '1px solid #E2E8F0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: '#FFFBEB',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 8,
                backgroundColor: 'rgba(217, 119, 6, 0.12)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#D97706',
              }}
            >
              <ShieldAlert size={20} />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#92400E' }}>
                Enviar a Cuarentena Preventiva
              </h2>
              <p style={{ margin: 0, fontSize: 12, color: '#B45309', marginTop: 2 }}>
                Retiro temporal del inventario comercial por incidencia de calidad o daño, sin convertir en merma.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="btn btn-ghost"
            style={{
              padding: 6,
              borderRadius: 6,
              border: 'none',
              background: 'transparent',
              cursor: submitting ? 'not-allowed' : 'pointer',
              color: '#64748B',
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Banner de Error Operacional */}
        {errorMsg && (
          <div
            style={{
              margin: '12px 22px 0 22px',
              padding: '10px 14px',
              borderRadius: 8,
              backgroundColor: '#FEF2F2',
              border: '1px solid #FCA5A5',
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              fontSize: 12,
              color: '#991B1B',
            }}
          >
            <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1, color: '#DC2626' }} />
            <div>
              <strong>Error operativo:</strong> {errorMsg}
            </div>
          </div>
        )}

        {/* Cuerpo con Scroll */}
        <div style={{ padding: '18px 22px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* 1. DISTINCIÓN CLARA: CUARENTENA VS MERMA */}
          <div
            style={{
              padding: '10px 14px',
              borderRadius: 8,
              backgroundColor: '#FFFBEB',
              border: '1px solid #FDE68A',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              fontSize: 12,
              color: '#92400E',
            }}
          >
            <Info size={16} style={{ color: '#D97706', flexShrink: 0 }} />
            <div>
              <strong>Aclaración Operativa WMS:</strong> Cuarentena <em>no significa merma automáticamente</em>. La mercancía conserva su existencia física, queda excluida temporalmente de disponibilidad comercial y surtido, y permanece bajo resguardo en espera del dictamen formal de calidad.
            </div>
          </div>

          {/* 2. FICHA TÉCNICA DE LA PARTIDA */}
          <div
            style={{
              borderRadius: 8,
              border: '1px solid #E2E8F0',
              backgroundColor: '#F8FAFC',
              padding: 14,
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 12,
              fontSize: 12,
            }}
          >
            <div style={{ gridColumn: 'span 2' }}>
              <span style={{ fontSize: 11, color: '#64748B', fontWeight: 600 }}>PRODUCTO / SKU</span>
              <div style={{ fontWeight: 700, color: '#0F172A', marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                <code style={{ background: '#E2E8F0', padding: '2px 6px', borderRadius: 4, fontSize: 12 }}>
                  {item.sku?.codigo || '—'}
                </code>
                <span>{item.sku?.descripcion || item.sku?.nombre || '—'}</span>
              </div>
            </div>

            <div>
              <span style={{ fontSize: 11, color: '#64748B', fontWeight: 600 }}>DEPOSITANTE</span>
              <div style={{ fontWeight: 700, color: '#0F172A', marginTop: 2 }}>
                {item.cliente?.nombreComercial || item.cliente?.razonSocial || '—'}
              </div>
            </div>

            <div>
              <span style={{ fontSize: 11, color: '#64748B', fontWeight: 600 }}>LOTE & CALIDAD ACTUAL</span>
              <div style={{ fontWeight: 600, color: '#0F172A', marginTop: 2, fontFamily: 'monospace' }}>
                {item.lote || '—'}
              </div>
              <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>
                Calidad: <strong>{item.estadoCalidad || 'LIBERADO'}</strong>
              </div>
            </div>
          </div>

          {/* 3. ESTADO ACTUAL DE EXISTENCIAS */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 10,
              textAlign: 'center',
            }}
          >
            <div style={{ padding: 10, borderRadius: 8, backgroundColor: '#EFF6FF', border: '1px solid #BFDBFE' }}>
              <div style={{ fontSize: 10, color: '#1D4ED8', fontWeight: 700, textTransform: 'uppercase' }}>Ubicación Origen</div>
              <div style={{ fontSize: 15, fontWeight: 800, marginTop: 4, color: '#1E40AF', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                <MapPin size={14} /> {item.ubicacion?.codigo || '—'}
              </div>
              <div style={{ fontSize: 10, color: '#3B82F6', marginTop: 2 }}>Rack comercial</div>
            </div>

            <div style={{ padding: 10, borderRadius: 8, backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0' }}>
              <div style={{ fontSize: 10, color: '#64748B', fontWeight: 700, textTransform: 'uppercase' }}>Físico Total</div>
              <div style={{ fontSize: 16, fontWeight: 800, marginTop: 4, color: '#0F172A' }}>
                {item.cantidadFisica?.toLocaleString() ?? 0}
              </div>
              <div style={{ fontSize: 10, color: '#64748B', marginTop: 2 }}>piezas físicas</div>
            </div>

            <div style={{ padding: 10, borderRadius: 8, backgroundColor: '#ECFDF5', border: '1px solid #A7F3D0' }}>
              <div style={{ fontSize: 10, color: '#047857', fontWeight: 700, textTransform: 'uppercase' }}>Disp. Vendible</div>
              <div style={{ fontSize: 16, fontWeight: 800, marginTop: 4, color: '#059669' }}>
                {item.cantidadDisponibleVendible?.toLocaleString() ?? 0}
              </div>
              <div style={{ fontSize: 10, color: '#047857', marginTop: 2 }}>comercializable</div>
            </div>

            <div style={{ padding: 10, borderRadius: 8, backgroundColor: '#FEF2F2', border: '1px solid #FECACA' }}>
              <div style={{ fontSize: 10, color: '#B91C1C', fontWeight: 700, textTransform: 'uppercase' }}>Bloqueado Actual</div>
              <div style={{ fontSize: 16, fontWeight: 800, marginTop: 4, color: '#DC2626' }}>
                {item.cantidadBloqueada?.toLocaleString() ?? 0}
              </div>
              <div style={{ fontSize: 10, color: '#B91C1C', marginTop: 2 }}>en retención</div>
            </div>
          </div>

          {/* 4. HUs O INVENTARIO LEGADO */}
          <div style={{ borderRadius: 8, border: '1px solid #E2E8F0', padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: 13, color: '#0F172A' }}>
                <Box size={16} style={{ color: '#D97706' }} />
                <span>Mercancía a Desviar a Cuarentena</span>
              </div>
              {hasHus && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    onClick={selectAllHus}
                    className="btn btn-sm"
                    style={{ fontSize: 11, padding: '2px 8px', border: '1px solid #CBD5E1', borderRadius: 4, background: '#F8FAFC' }}
                  >
                    Seleccionar todas
                  </button>
                  <button
                    type="button"
                    onClick={deselectAllHus}
                    className="btn btn-sm"
                    style={{ fontSize: 11, padding: '2px 8px', border: '1px solid #CBD5E1', borderRadius: 4, background: '#F8FAFC' }}
                  >
                    Deseleccionar
                  </button>
                </div>
              )}
            </div>

            {hasHus ? (
              <div>
                <p style={{ margin: '0 0 10px 0', fontSize: 11, color: '#64748B' }}>
                  Marque las HUs físicas que presentan incidencia para retirarlas a la zona de cuarentena:
                </p>
                <div style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid #E2E8F0', borderRadius: 6 }}>
                  <table className="data-table" style={{ fontSize: 11, width: '100%' }}>
                    <thead>
                      <tr style={{ backgroundColor: '#F8FAFC' }}>
                        <th style={{ width: 36, textAlign: 'center' }}></th>
                        <th>Código HU</th>
                        <th style={{ textAlign: 'right' }}>Cantidad</th>
                        <th>Tipo</th>
                        <th>Estado Actual</th>
                        <th>Ubicación Actual</th>
                      </tr>
                    </thead>
                    <tbody>
                      {item.handlingUnits.map((hu: any) => {
                        const isChecked = selectedHuIds.includes(hu.id);
                        const huState = (hu.estadoHu || hu.estado || 'ACTIVO').toUpperCase();
                        const isBlocked = huState === 'DESPACHADO' || huState === 'DESPACHADA';

                        return (
                          <tr
                            key={hu.id}
                            onClick={() => !isBlocked && toggleHu(hu.id)}
                            style={{
                              backgroundColor: isChecked ? 'rgba(217, 119, 6, 0.06)' : 'transparent',
                              cursor: isBlocked ? 'not-allowed' : 'pointer',
                              opacity: isBlocked ? 0.6 : 1,
                            }}
                          >
                            <td style={{ textAlign: 'center' }}>
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => toggleHu(hu.id)}
                                disabled={isBlocked}
                                onClick={(e) => e.stopPropagation()}
                              />
                            </td>
                            <td>
                              <code style={{ fontWeight: 700, color: '#1E293B' }}>{hu.codigo}</code>
                            </td>
                            <td style={{ textAlign: 'right', fontWeight: 700 }}>
                              {hu.cantidad?.toLocaleString() ?? 0} pza
                            </td>
                            <td>
                              <span className="badge badge-neutral">{hu.tipoHu || hu.tipo || 'CAJA'}</span>
                            </td>
                            <td>
                              <span
                                style={{
                                  fontSize: 10,
                                  fontWeight: 700,
                                  padding: '1px 6px',
                                  borderRadius: 4,
                                  backgroundColor: huState === 'ACTIVO' ? '#DCFCE7' : '#FEE2E2',
                                  color: huState === 'ACTIVO' ? '#166534' : '#991B1B',
                                }}
                              >
                                {huState}
                              </span>
                            </td>
                            <td>
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontWeight: 600 }}>
                                <MapPin size={11} /> {hu.ubicacionActual || item.ubicacion?.codigo}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div
                style={{
                  padding: 12,
                  borderRadius: 6,
                  backgroundColor: '#FFFBEB',
                  border: '1px solid #FDE68A',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#B45309', fontWeight: 700 }}>
                  <Info size={14} /> Inventario legado sin HU — Captura explícita de cantidad
                </div>
                <p style={{ margin: 0, fontSize: 11, color: '#78350F' }}>
                  Esta partida no cuenta con contenedores HU físicos individuales. Para prevenir movimientos accidentales del saldo total, capture explícitamente el número de piezas a desviar a cuarentena.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <label style={{ fontSize: 12, fontWeight: 600, color: '#0F172A' }}>
                      Cantidad de piezas a segregar: *
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={availableScalarQty}
                      value={scalarQty}
                      onChange={(e) => {
                        setScalarQty(e.target.value);
                        setScalarTouched(true);
                        if (errorMsg) setErrorMsg(null);
                      }}
                      placeholder={`Capture cantidad (1 a ${availableScalarQty})`}
                      className="input"
                      style={{
                        width: 210,
                        textAlign: 'right',
                        fontWeight: 700,
                        padding: '5px 8px',
                        borderColor: scalarTouched && !isScalarValid ? '#DC2626' : undefined,
                      }}
                    />
                    <span style={{ fontSize: 11, color: '#64748B' }}>
                      (Máx. disponible en origen: {availableScalarQty} piezas)
                    </span>
                  </div>

                  {scalarTouched && !isScalarCaptured && (
                    <div style={{ fontSize: 11, color: '#DC2626', fontWeight: 600 }}>
                      Debe capturar explícitamente la cantidad de piezas a enviar a cuarentena.
                    </div>
                  )}
                  {scalarTouched && isScalarCaptured && parsedScalar <= 0 && (
                    <div style={{ fontSize: 11, color: '#DC2626', fontWeight: 600 }}>
                      La cantidad a desviar debe ser mayor a 0 piezas.
                    </div>
                  )}
                  {scalarTouched && isScalarCaptured && parsedScalar > availableScalarQty && (
                    <div style={{ fontSize: 11, color: '#DC2626', fontWeight: 600 }}>
                      La cantidad indicada ({parsedScalar}) supera el disponible de la partida ({availableScalarQty} piezas).
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* 5. DESTINO DE CUARENTENA */}
          <div
            style={{
              borderRadius: 8,
              border: '1px solid #E2E8F0',
              padding: 14,
              backgroundColor: '#FFFFFF',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#0F172A', display: 'flex', alignItems: 'center', gap: 6 }}>
                <MapPin size={16} style={{ color: '#D97706' }} />
                <span>Ubicación Destino de Cuarentena</span>
              </div>
              <span style={{ fontSize: 11, color: '#64748B' }}>
                Zona de no conforme / retención preventiva
              </span>
            </div>

            {loadingLocations ? (
              <div style={{ textAlign: 'center', padding: 12, color: '#64748B', fontSize: 12 }}>
                <RefreshCw size={14} className="animate-spin" /> Consultando áreas de cuarentena...
              </div>
            ) : (
              <select
                value={targetLocationId}
                onChange={(e) => setTargetLocationId(e.target.value)}
                className="input"
                style={{ width: '100%', fontSize: 13, padding: '7px 10px' }}
              >
                {locations.length > 0 ? (
                  locations.map(loc => {
                    const esNcExceso = loc.codigo === 'NC-EXCESO-01';
                    const labelPrincipal = esNcExceso
                      ? 'Zona de Cuarentena / Retención de Calidad'
                      : (loc.nombre || 'Zona de Retención de Calidad / Cuarentena');
                    return (
                      <option key={loc.id} value={loc.id}>
                        {labelPrincipal} ({loc.codigo})
                      </option>
                    );
                  })
                ) : (
                  <option value="NC-EXCESO-01">
                    Zona de Cuarentena / Retención de Calidad (NC-EXCESO-01)
                  </option>
                )}
              </select>
            )}
          </div>

          {/* 6. MOTIVO OBLIGATORIO Y OBSERVACIONES */}
          <div
            style={{
              borderRadius: 8,
              border: '1px solid #E2E8F0',
              padding: 14,
              backgroundColor: '#FFFFFF',
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: 12,
            }}
          >
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#0F172A', marginBottom: 4 }}>
                Motivo de la Incidencia de Calidad: *
              </label>
              <select
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                className="input"
                style={{ width: '100%', fontSize: 13, padding: '7px 10px' }}
              >
                {MOTIVOS_CUARENTENA.map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#0F172A', marginBottom: 4 }}>
                {motivo === 'Otro' ? 'Observación Obligatoria: *' : 'Observación / Detalle de la incidencia:'}
              </label>
              <input
                type="text"
                value={observaciones}
                onChange={(e) => setObservaciones(e.target.value)}
                placeholder={motivo === 'Otro' ? 'Especifique la causa de la no conformidad...' : 'Notas para el expediente de calidad...'}
                className="input"
                style={{ width: '100%', fontSize: 13, padding: '7px 10px' }}
              />
            </div>
          </div>

          {/* 7. CONFIRMACIÓN CANÓNICA */}
          <div
            style={{
              padding: '12px 14px',
              borderRadius: 8,
              backgroundColor: '#FFFBEB',
              border: '1px solid #FDE68A',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              fontSize: 12,
              color: '#92400E',
            }}
          >
            <ShieldAlert size={18} style={{ color: '#D97706', flexShrink: 0 }} />
            <div>
              <strong>La mercancía será retirada temporalmente del inventario comercial y quedará pendiente de resolución de calidad.</strong> Su físico global permanece igual, pero su saldo vendible pasará a 0 y quedará bloqueado para picking.
            </div>
          </div>
        </div>

        {/* Pie de Acciones */}
        <div
          style={{
            padding: '14px 22px',
            borderTop: '1px solid #E2E8F0',
            backgroundColor: '#F8FAFC',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div style={{ fontSize: 12, color: '#64748B' }}>
            Supervisor: <strong>{currentUser}</strong>
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="btn btn-secondary"
              style={{ padding: '8px 16px', fontSize: 13 }}
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || !isFormValid}
              className="btn"
              style={{
                padding: '8px 18px',
                fontSize: 13,
                fontWeight: 700,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                backgroundColor: isFormValid && !submitting ? '#D97706' : '#94A3B8',
                borderColor: isFormValid && !submitting ? '#B45309' : '#94A3B8',
                color: '#FFFFFF',
                cursor: isFormValid && !submitting ? 'pointer' : 'not-allowed',
              }}
            >
              {submitting ? (
                <>
                  <RefreshCw size={14} className="animate-spin" />
                  <span>Registrando segregación...</span>
                </>
              ) : (
                <>
                  <ShieldAlert size={15} />
                  <span>
                    {isFormValid
                      ? `Enviar a Cuarentena (${movingUnits} pzas)`
                      : hasHus
                      ? 'Enviar a Cuarentena (Seleccione HU)'
                      : 'Enviar a Cuarentena (Capture cantidad)'}
                  </span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
