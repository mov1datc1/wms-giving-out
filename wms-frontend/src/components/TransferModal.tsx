import React, { useState, useEffect } from 'react';
import {
  ArrowRight, MapPin, Box, Boxes, CheckCircle2,
  AlertTriangle, X, ShieldCheck, Layers, RefreshCw,
  Info, Lock, Calendar, CornerDownRight
} from 'lucide-react';
import { API } from '../config/api';
import { formatCalendarDate } from '../utils/dateUtils';

export interface TransferModalProps {
  item: any;
  token?: string;
  currentUser?: string;
  onClose: () => void;
  onSuccess: (result: any) => void;
}

const MOTIVOS_CATALOGO = [
  'Reubicación operativa',
  'Consolidación',
  'Liberación de espacio',
  'Reabasto de Picking',
  'Corrección de ubicación física',
  'Otro',
];

const CATEGORIAS_SENSIBLES = ['ALIMENTO', 'PERECEDERO', 'FARMACEUTICO', 'QUIMICO', 'PELIGROSO'];

export interface DestinationCompatibilityResult {
  status: 'COMPATIBLE' | 'INCOMPATIBLE' | 'NO_CONFIGURADO';
  motivo: string;
  esCritica: boolean;
  esFallbackDemo?: boolean;
}

/**
 * Evaluación de compatibilidad canónica de destino para trasiegos comerciales.
 * Aplica idénticas reglas operativas al motor de Putaway (putaway-engine.service.ts):
 * 1. Restricción térmica estricta (SKU vs Ubicación/Zona)
 * 2. Matriz formal de categorías en zona/ubicación si existe
 * 3. Asignación contractual de zona al depositante (zonaAsignadaId)
 * 4. Incompatibilidad funcional manifiesta por vocación de zona (ej. Textil vs Alimento)
 * 5. Protección de categorías sensibles: NO_CONFIGURADO nunca se considera compatible
 */
export function evaluateDestinationCompatibility(
  sku: any,
  client: any,
  loc: any,
): DestinationCompatibilityResult {
  const skuTemp = (sku?.temperaturaRequerida || 'AMBIENTE').toUpperCase();
  const locTemp = (loc.temperatura || loc.zona?.temperatura || 'AMBIENTE').toUpperCase();

  // 1. Restricción física estricta: Control térmico
  if (skuTemp !== 'AMBIENTE' && locTemp !== skuTemp) {
    return {
      status: 'INCOMPATIBLE',
      motivo: `Incompatibilidad térmica: Producto requiere ${skuTemp} pero el rack es ${locTemp}`,
      esCritica: true,
    };
  }

  const skuCat = (sku?.categoria || '').toUpperCase();
  const zonaNombreUpper = (loc.zona?.nombre || '').toUpperCase();
  const zonaCodigoUpper = (loc.zona?.codigo || '').toUpperCase();

  // 2. Matriz formal de categorías en zona o ubicación (si existe en BD)
  const categoriasPermitidasZona: string[] | null = loc.zona?.categoriasPermitidas || null;
  const categoriasExcluidasZona: string[] | null = loc.zona?.categoriasExcluidas || null;

  if (skuCat && categoriasExcluidasZona && categoriasExcluidasZona.includes(skuCat)) {
    return {
      status: 'INCOMPATIBLE',
      motivo: `Categoría ${skuCat} restringida explícitamente en la matriz de la zona ${loc.zona?.nombre}`,
      esCritica: true,
    };
  }

  if (skuCat && categoriasPermitidasZona) {
    if (categoriasPermitidasZona.includes(skuCat)) {
      return {
        status: 'COMPATIBLE',
        motivo: `Categoría ${skuCat} admitida formalmente en la matriz de la zona ${loc.zona?.nombre}`,
        esCritica: false,
      };
    } else {
      return {
        status: 'INCOMPATIBLE',
        motivo: `Categoría ${skuCat} no admitida en la matriz de la zona ${loc.zona?.nombre}`,
        esCritica: true,
      };
    }
  }

  // 3. Asignación contractual de zona al depositante (Regla canónica de Putaway)
  const clientAssignedZoneId = client?.zonaAsignadaId;
  const isAssignedZone = Boolean(clientAssignedZoneId && (loc.zonaId === clientAssignedZoneId || loc.zona?.id === clientAssignedZoneId));

  if (isAssignedZone) {
    return {
      status: 'COMPATIBLE',
      motivo: `Zona ${loc.zona?.nombre || loc.zona?.codigo} asignada contractualmente al depositante`,
      esCritica: false,
      esFallbackDemo: true,
    };
  }

  // 4. Incompatibilidad funcional manifiesta por vocación de zona (Textil vs Alimento bidireccional)
  const esAlimento = skuCat === 'ALIMENTO' || skuCat === 'PERECEDERO';
  if (esAlimento && (zonaNombreUpper.includes('TEXTIL') || zonaCodigoUpper.includes('TEXTIL'))) {
    return {
      status: 'INCOMPATIBLE',
      motivo: `Ubicación configurada funcionalmente para Textil (${loc.zona?.nombre || loc.zona?.codigo}); incompatible con productos alimenticios.`,
      esCritica: true,
    };
  }

  const esTextil = skuCat === 'PRENDA' || skuCat === 'TEXTIL';
  if (esTextil && (zonaNombreUpper.includes('ALIMENTO') || zonaCodigoUpper.includes('ALIMENTO'))) {
    return {
      status: 'INCOMPATIBLE',
      motivo: `Ubicación configurada funcionalmente para Alimentos (${loc.zona?.nombre || loc.zona?.codigo}); incompatible con productos textiles.`,
      esCritica: true,
    };
  }

  // 5. Exclusión de zonas fuera de la asignación contractual del depositante
  if (clientAssignedZoneId && !isAssignedZone) {
    return {
      status: 'INCOMPATIBLE',
      motivo: `Zona ${loc.zona?.nombre || loc.zona?.codigo} ajena a la asignación contractual del depositante (${client?.nombreComercial || 'Cliente'}).`,
      esCritica: true,
    };
  }

  // 6. Sin configuración formal
  const esCritica = CATEGORIAS_SENSIBLES.includes(skuCat);
  return {
    status: 'NO_CONFIGURADO',
    motivo: `La zona ${loc.zona?.nombre || loc.zona?.codigo} no cuenta con matriz formal de categorías para ${skuCat || 'este producto'}`,
    esCritica,
  };
}

/**
 * Resuelve la ubicación operativa amigable de una HU para piso de almacén.
 * Garantiza que nunca se muestren identificadores técnicos (UUID) al operador.
 */
export function formatHuLocationDisplay(hu: any, originLoc: any, allLocations: any[] = []): string {
  // 1. Si viene el código operativo en ubicacionCodigo y no es UUID, usarlo directamente
  if (hu?.ubicacionCodigo && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(hu.ubicacionCodigo)) {
    return hu.ubicacionCodigo;
  }
  const locVal = hu?.ubicacionActual;
  if (!locVal) return originLoc?.codigo || '—';

  // 2. Si ubicacionActual es un UUID, resolver contra el origen o la lista de ubicaciones
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(locVal);
  if (isUuid) {
    if (originLoc && (originLoc.id === locVal || originLoc.ubicacionId === locVal)) {
      return originLoc.codigo;
    }
    const found = allLocations.find(l => l.id === locVal);
    if (found) return found.codigo;
    return originLoc?.codigo || 'Rack comercial';
  }

  return locVal;
}

export function TransferModal({
  item,
  token,
  currentUser = 'Operador Giving Out',
  onClose,
  onSuccess,
}: TransferModalProps) {
  const [locations, setLocations] = useState<any[]>([]);
  const [loadingLocations, setLoadingLocations] = useState(true);
  const [targetLocationId, setTargetLocationId] = useState('');
  const [motivo, setMotivo] = useState(MOTIVOS_CATALOGO[0]);
  const [observaciones, setObservaciones] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Manejo de HUs individuales
  const hasHus = Array.isArray(item?.handlingUnits) && item.handlingUnits.length > 0;

  // 1. Regla defensiva: Inconsistencia física total de la partida vs suma de Handling Units (HUs)
  const partidaSaldoFisico = Number(item?.cantidadFisica ?? ((item?.cantidadDisponible || 0) + (item?.cantidadBloqueada || 0) + (item?.cantidadReservada || 0)));
  const husTotalFisico = hasHus
    ? item.handlingUnits.reduce((acc: number, h: any) => acc + Number(h.cantidad || 0), 0)
    : 0;

  const hasInventoryInconsistency = hasHus && (
    husTotalFisico !== partidaSaldoFisico ||
    item.handlingUnits.some((h: any) => Number(h.cantidad || 0) > partidaSaldoFisico)
  );

  const [selectedHuIds, setSelectedHuIds] = useState<string[]>(() => {
    if (hasHus && !hasInventoryInconsistency) {
      // Por defecto seleccionar las HUs activas no bloqueadas solo si no hay inconsistencia
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

  // Cargar ubicaciones destino válidas desde el backend aplicando compatibilidad canónica
  useEffect(() => {
    async function fetchLocations() {
      setLoadingLocations(true);
      try {
        const res = await fetch(`${API}/locations`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (res.ok) {
          const data: any[] = await res.json();
          const originCode = item?.ubicacion?.codigo;
          const originId = item?.ubicacion?.id || item?.ubicacionId;

          // Filtrar ubicaciones elegibles para trasiego comercial:
          // 1. Activas
          // 2. Almacenables (esAlmacenable === true y categoría FISICA_ALMACENABLE)
          // 3. No bloqueadas (estado !== 'BLOQUEADO')
          // 4. Que no sean el origen actual
          // 5. Que no sean áreas virtuales / especiales / transitorias (no DEV-01, no NC-EXCESO-01, no REC-*, no STG-*)
          // 6. Compatibilidad canónica de producto / categoría / depositante / temperatura / política de zona
          const eligible = data.filter(loc => {
            if (!loc.activo) return false;
            if (loc.estado === 'BLOQUEADO') return false;
            if (loc.codigo === originCode || loc.id === originId) return false;

            // Descartar áreas especiales y no comerciales
            if (['DEV-01', 'NC-EXCESO-01', 'NC-MERMA-01', 'REC-01', 'STG-01', 'STG-02'].includes(loc.codigo)) return false;
            if (['CUARENTENA', 'DEVOLUCION', 'RECIBO', 'STAGING'].includes(loc.tipoUbicacion)) return false;
            if (loc.classification?.esVirtualOTransitoria) return false;
            if (loc.esAlmacenable === false) return false;
            if (loc.categoriaUbicacion && loc.categoriaUbicacion !== 'FISICA_ALMACENABLE') return false;

            // Compatibilidad canónica real con el producto y depositante: EXCLUSIVAMENTE 'COMPATIBLE'
            const compat = evaluateDestinationCompatibility(item?.sku, item?.cliente, loc);
            if (compat.status !== 'COMPATIBLE') return false;

            return true;
          });

          setLocations(eligible);
        }
      } catch (err) {
        console.error('Error al cargar ubicaciones:', err);
        setErrorMsg('No se pudieron consultar las ubicaciones de destino disponibles.');
      } finally {
        setLoadingLocations(false);
      }
    }

    fetchLocations();
  }, [item, token]);

  const toggleHu = (huId: string) => {
    if (hasInventoryInconsistency) return;
    setSelectedHuIds(prev =>
      prev.includes(huId) ? prev.filter(id => id !== huId) : [...prev, huId]
    );
    if (errorMsg) setErrorMsg(null);
  };

  const selectAllHus = () => {
    if (hasInventoryInconsistency || !item?.handlingUnits) return;
    const all = item.handlingUnits.map((h: any) => h.id);
    setSelectedHuIds(all);
    if (errorMsg) setErrorMsg(null);
  };

  const deselectAllHus = () => {
    if (hasInventoryInconsistency) return;
    setSelectedHuIds([]);
    if (errorMsg) setErrorMsg(null);
  };

  // Cálculo de unidades físicas a transferir y validación escalar
  const parsedScalar = parseInt(scalarQty, 10);
  const isScalarCaptured = scalarQty.trim() !== '' && !isNaN(parsedScalar);
  const isScalarValid = isScalarCaptured && parsedScalar > 0 && parsedScalar <= availableScalarQty;
  const isFormValid = !hasInventoryInconsistency && (hasHus ? selectedHuIds.length > 0 : isScalarValid);

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

  // Ordenar ubicaciones compatibles por recomendación/proximidad operativa (mismo pasillo primero, luego alfanumérico)
  const sortedCompatibleLocations = [...locations].sort((a, b) => {
    const originPasillo = item?.ubicacion?.pasillo || '';
    const aMatch = a.pasillo === originPasillo ? 0 : 1;
    const bMatch = b.pasillo === originPasillo ? 0 : 1;
    if (aMatch !== bMatch) return aMatch - bMatch;
    return (a.codigo || '').localeCompare(b.codigo || '');
  });

  // Sincronización estricta de destino con capacidad suficiente (Hard-cap WMS):
  // Solo se habilitan ubicaciones cuya capacidad real libre sea >= cantidad seleccionada a mover.
  const locationsWithCapacity = sortedCompatibleLocations.filter(loc => {
    const dispPiezas = loc.capacidadDisponibleUnidades ?? loc.capDispUnidades ?? loc.capacidadUnits ?? 0;
    return movingUnits > 0 ? dispPiezas >= movingUnits : dispPiezas > 0;
  });

  const maxCapDisponible = sortedCompatibleLocations.length > 0
    ? Math.max(0, ...sortedCompatibleLocations.map(l => l.capacidadDisponibleUnidades ?? l.capDispUnidades ?? l.capacidadUnits ?? 0))
    : 0;

  useEffect(() => {
    if (locationsWithCapacity.length === 0) {
      setTargetLocationId('');
      return;
    }
    const currentLoc = locationsWithCapacity.find(l => l.id === targetLocationId);
    if (!currentLoc) {
      // Auto-seleccionar la primera ubicación con capacidad real suficiente
      setTargetLocationId(locationsWithCapacity[0].id);
    }
  }, [movingUnits, locationsWithCapacity, targetLocationId]);

  const targetLocObj = sortedCompatibleLocations.find(l => l.id === targetLocationId || l.codigo === targetLocationId);
  const targetCapDisp = targetLocObj ? (targetLocObj.capacidadDisponibleUnidades ?? targetLocObj.capDispUnidades ?? targetLocObj.capacidadUnits ?? 0) : 0;
  const isTargetCapSufficient = Boolean(targetLocObj && (movingUnits > 0 ? targetCapDisp >= movingUnits : targetCapDisp > 0));

  // Ejecución de la transferencia
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (hasInventoryInconsistency) {
      setErrorMsg('Inconsistencia de inventario detectada. La composición física por HU no coincide con el saldo de la partida. Requiere conciliación antes de mover mercancía.');
      return;
    }

    if (!targetLocationId) {
      setErrorMsg('Debe seleccionar una ubicación de destino compatible con capacidad suficiente.');
      return;
    }

    if (!isTargetCapSufficient) {
      setErrorMsg(`Capacidad insuficiente en el destino ${targetLocObj?.codigo}: requiere ${movingUnits} piezas pero solo dispone de ${targetCapDisp} piezas libres. No se autoriza sobrecupo.`);
      return;
    }

    if (motivo === 'Otro' && !observaciones.trim()) {
      setErrorMsg('Al seleccionar el motivo "Otro", es obligatorio ingresar una observación justificatoria.');
      return;
    }

    if (hasHus && selectedHuIds.length === 0) {
      setErrorMsg('Debe seleccionar al menos una Handling Unit (HU) física para transferir.');
      return;
    }

    if (!hasHus) {
      if (!isScalarCaptured) {
        setErrorMsg('Debe capturar explícitamente la cantidad de piezas a transferir.');
        return;
      }
      if (parsedScalar <= 0) {
        setErrorMsg('La cantidad a transferir debe ser mayor a 0 piezas.');
        return;
      }
      if (parsedScalar > availableScalarQty) {
        setErrorMsg(`La cantidad indicada (${parsedScalar}) supera el saldo físico disponible de la partida (${availableScalarQty} piezas).`);
        return;
      }
    }

    setSubmitting(true);
    try {
      // Construir payload canónico
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
        tipoOperacion: 'TRANSFERENCIA',
        ubicacionDestinoId: targetLocationId,
        motivo: motivo === 'Otro' ? observaciones.trim() : motivo,
        notas: observaciones.trim() || undefined,
        usuario: currentUser,
        items: payloadItems,
      };

      const res = await fetch(`${API}/inventory/transfer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Error operativo al ejecutar el trasiego entre ubicaciones.');
      }

      onSuccess(data);
    } catch (err: any) {
      console.error('Error al transferir mercancía:', err);
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
            backgroundColor: '#F8FAFC',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 8,
                backgroundColor: 'rgba(37, 99, 235, 0.1)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#2563EB',
              }}
            >
              <ArrowRight size={20} />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#0F172A' }}>
                Transferir / Mover Mercancía
              </h2>
              <p style={{ margin: 0, fontSize: 12, color: '#64748B', marginTop: 2 }}>
                Reubicación física interna entre racks comerciales sin alterar el físico global del almacén.
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
          {/* Regla Defensiva WMS: Inconsistencia Físico Total vs HUs */}
          {hasInventoryInconsistency && (
            <div
              style={{
                padding: '12px 16px',
                borderRadius: 8,
                backgroundColor: '#FEF2F2',
                border: '1.5px solid #DC2626',
                display: 'flex',
                alignItems: 'flex-start',
                gap: 12,
                color: '#991B1B',
              }}
            >
              <AlertTriangle size={20} style={{ color: '#DC2626', flexShrink: 0, marginTop: 2 }} />
              <div style={{ flex: 1, fontSize: 12 }}>
                <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 4, color: '#B91C1C' }}>
                  Inconsistencia de inventario detectada. La composición física por HU no coincide con el saldo de la partida. Requiere conciliación antes de mover mercancía.
                </div>
                <div style={{ color: '#7F1D1D', lineHeight: 1.5 }}>
                  El saldo físico canónico registrado de la partida es de <strong>{partidaSaldoFisico} piezas</strong>, pero la composición de Handling Units suma <strong>{husTotalFisico} piezas</strong> (diferencia de {Math.abs(partidaSaldoFisico - husTotalFisico)} pzas). Por control de auditoría WMS, las operaciones de trasiego están bloqueadas hasta que se ejecute la conciliación correspondiente.
                </div>
              </div>
            </div>
          )}

          {/* 1. FICHA TÉCNICA DE LA MERCANCÍA */}
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
              <span style={{ fontSize: 11, color: '#64748B', fontWeight: 600 }}>LOTE & VENCIMIENTO</span>
              <div style={{ fontWeight: 600, color: '#0F172A', marginTop: 2, fontFamily: 'monospace' }}>
                {item.lote || '—'}
              </div>
              <div style={{ fontSize: 11, color: item.isExpired ? '#DC2626' : '#64748B', marginTop: 2 }}>
                {item.fechaVencimiento ? formatCalendarDate(item.fechaVencimiento) : 'Sin vencimiento'}
              </div>
            </div>
          </div>

          {/* 2. ESTADO ACTUAL DE EXISTENCIAS */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(5, 1fr)',
              gap: 10,
              textAlign: 'center',
            }}
          >
            <div style={{ padding: 10, borderRadius: 8, backgroundColor: '#EFF6FF', border: '1px solid #BFDBFE' }}>
              <div style={{ fontSize: 10, color: '#1D4ED8', fontWeight: 700, textTransform: 'uppercase' }}>Ubicación Origen</div>
              <div style={{ fontSize: 15, fontWeight: 800, marginTop: 4, color: '#1E40AF', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                <MapPin size={14} /> {item.ubicacion?.codigo || '—'}
              </div>
              <div style={{ fontSize: 10, color: '#3B82F6', marginTop: 2 }}>Actual en Rack</div>
            </div>

            <div style={{ padding: 10, borderRadius: 8, backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0' }}>
              <div style={{ fontSize: 10, color: '#64748B', fontWeight: 700, textTransform: 'uppercase' }}>Físico Total</div>
              <div style={{ fontSize: 16, fontWeight: 800, marginTop: 4, color: '#0F172A' }}>
                {item.cantidadFisica?.toLocaleString() ?? 0}
              </div>
              <div style={{ fontSize: 10, color: '#64748B', marginTop: 2 }}>piezas en almacén</div>
            </div>

            <div style={{ padding: 10, borderRadius: 8, backgroundColor: '#ECFDF5', border: '1px solid #A7F3D0' }}>
              <div style={{ fontSize: 10, color: '#047857', fontWeight: 700, textTransform: 'uppercase' }}>Disp. Vendible</div>
              <div style={{ fontSize: 16, fontWeight: 800, marginTop: 4, color: '#059669' }}>
                {item.cantidadDisponibleVendible?.toLocaleString() ?? 0}
              </div>
              <div style={{ fontSize: 10, color: '#047857', marginTop: 2 }}>disponible surtido</div>
            </div>

            <div style={{ padding: 10, borderRadius: 8, backgroundColor: '#FFFBEB', border: '1px solid #FDE68A' }}>
              <div style={{ fontSize: 10, color: '#B45309', fontWeight: 700, textTransform: 'uppercase' }}>Reservado</div>
              <div style={{ fontSize: 16, fontWeight: 800, marginTop: 4, color: '#D97706' }}>
                {item.cantidadReservada?.toLocaleString() ?? 0}
              </div>
              <div style={{ fontSize: 10, color: '#B45309', marginTop: 2 }}>órdenes activas</div>
            </div>

            <div style={{ padding: 10, borderRadius: 8, backgroundColor: '#FEF2F2', border: '1px solid #FECACA' }}>
              <div style={{ fontSize: 10, color: '#B91C1C', fontWeight: 700, textTransform: 'uppercase' }}>Bloqueado</div>
              <div style={{ fontSize: 16, fontWeight: 800, marginTop: 4, color: '#DC2626' }}>
                {item.cantidadBloqueada?.toLocaleString() ?? 0}
              </div>
              <div style={{ fontSize: 10, color: '#B91C1C', marginTop: 2 }}>retención / calidad</div>
            </div>
          </div>

          {/* 3. UNIDAD FÍSICA A MOVER: HUs INDIVIDUALES O PROTOCOLO LEGADO */}
          <div style={{ borderRadius: 8, border: '1px solid #E2E8F0', padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: 13, color: '#0F172A' }}>
                <Box size={16} style={{ color: '#2563EB' }} />
                <span>Unidad Física a Mover {hasInventoryInconsistency ? '(Modo Diagnóstico · Read-Only)' : ''}</span>
              </div>
              {hasHus && (
                hasInventoryInconsistency ? (
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      padding: '3px 8px',
                      borderRadius: 4,
                      backgroundColor: '#FEE2E2',
                      color: '#991B1B',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    <Lock size={12} /> Diagnóstico Read-Only
                  </span>
                ) : (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      type="button"
                      onClick={selectAllHus}
                      className="btn btn-sm"
                      style={{
                        fontSize: 11,
                        padding: '2px 8px',
                        border: '1px solid #CBD5E1',
                        borderRadius: 4,
                        background: '#F8FAFC',
                      }}
                    >
                      Seleccionar todas
                    </button>
                    <button
                      type="button"
                      onClick={deselectAllHus}
                      className="btn btn-sm"
                      style={{
                        fontSize: 11,
                        padding: '2px 8px',
                        border: '1px solid #CBD5E1',
                        borderRadius: 4,
                        background: '#F8FAFC',
                      }}
                    >
                      Deseleccionar
                    </button>
                  </div>
                )
              )}
            </div>

            {hasHus ? (
              <div>
                <p style={{ margin: '0 0 10px 0', fontSize: 11, color: hasInventoryInconsistency ? '#B91C1C' : '#64748B' }}>
                  {hasInventoryInconsistency
                    ? 'Partida en discrepancia física. Las HUs registradas se despliegan en modo solo lectura para auditoría y diagnóstico:'
                    : 'Seleccione individualmente qué Handling Units (cajas/pallets) desea transferir. No se permiten trasiegos ciegos sobre mercancía HU-managed:'}
                </p>
                <div style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid #E2E8F0', borderRadius: 6 }}>
                  <table className="data-table" style={{ fontSize: 11, width: '100%' }}>
                    <thead>
                      <tr style={{ backgroundColor: '#F8FAFC' }}>
                        <th style={{ width: 36, textAlign: 'center' }}>
                          {hasInventoryInconsistency ? <Lock size={12} style={{ color: '#94A3B8' }} /> : null}
                        </th>
                        <th>Código HU</th>
                        <th style={{ textAlign: 'right' }}>Cantidad</th>
                        <th>Tipo</th>
                        <th>Estado HU</th>
                        <th>Ubicación Actual</th>
                      </tr>
                    </thead>
                    <tbody>
                      {item.handlingUnits.map((hu: any) => {
                        const isChecked = selectedHuIds.includes(hu.id);
                        const huState = (hu.estadoHu || hu.estado || 'ACTIVO').toUpperCase();
                        const isBlocked = huState === 'BLOQUEADO' || huState === 'BLOQUEADA' || huState === 'DESPACHADO';

                        return (
                          <tr
                            key={hu.id}
                            onClick={() => !isBlocked && !hasInventoryInconsistency && toggleHu(hu.id)}
                            style={{
                              backgroundColor: isChecked && !hasInventoryInconsistency ? 'rgba(37, 99, 235, 0.05)' : 'transparent',
                              cursor: isBlocked || hasInventoryInconsistency ? 'default' : 'pointer',
                              opacity: isBlocked ? 0.6 : 1,
                            }}
                          >
                            <td style={{ textAlign: 'center' }}>
                              <input
                                type="checkbox"
                                checked={isChecked && !hasInventoryInconsistency}
                                onChange={() => toggleHu(hu.id)}
                                disabled={isBlocked || hasInventoryInconsistency}
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
                                <MapPin size={11} /> {formatHuLocationDisplay(hu, item.ubicacion, locations)}
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
                  Esta partida no cuenta con contenedores HU físicos individuales. Para prevenir movimientos accidentales del saldo total, capture explícitamente el número de piezas a trasladar.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <label style={{ fontSize: 12, fontWeight: 600, color: '#0F172A' }}>
                      Cantidad de piezas a transferir: *
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
                      Debe capturar explícitamente la cantidad de piezas a transferir.
                    </div>
                  )}
                  {scalarTouched && isScalarCaptured && parsedScalar <= 0 && (
                    <div style={{ fontSize: 11, color: '#DC2626', fontWeight: 600 }}>
                      La cantidad a transferir debe ser mayor a 0 piezas.
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

          {/* MODO OPERATIVO BLOQUEADO: Si existe inconsistencia de inventario */}
          {hasInventoryInconsistency ? (
            <div
              style={{
                borderRadius: 8,
                border: '1.5px solid #FCA5A5',
                backgroundColor: '#FEF2F2',
                padding: '24px 20px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                textAlign: 'center',
                gap: 12,
              }}
            >
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: '50%',
                  backgroundColor: '#FEE2E2',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#DC2626',
                }}
              >
                <Lock size={24} />
              </div>

              <div>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#991B1B' }}>
                  Transferencia no disponible
                </h3>
                <p style={{ margin: '6px 0 0 0', fontSize: 13, color: '#7F1D1D', maxWidth: 540, lineHeight: 1.5 }}>
                  Esta partida requiere conciliación de inventario antes de que pueda realizarse cualquier reubicación física.
                </p>
              </div>

              <div
                style={{
                  display: 'inline-flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 10,
                  padding: '8px 16px',
                  borderRadius: 6,
                  backgroundColor: '#FFFFFF',
                  border: '1px solid #FECACA',
                  fontSize: 12,
                  color: '#991B1B',
                  fontWeight: 600,
                  marginTop: 4,
                }}
              >
                <span>Saldo canónico: <strong>{partidaSaldoFisico} pzas</strong></span>
                <span style={{ color: '#FCA5A5' }}>·</span>
                <span>Composición HU: <strong>{husTotalFisico} pzas</strong></span>
                <span style={{ color: '#FCA5A5' }}>·</span>
                <span>Diferencia: <strong>{Math.abs(partidaSaldoFisico - husTotalFisico)} pzas</strong></span>
              </div>
            </div>
          ) : (
            <>
              {/* 4. DESTINO COMERCIAL Y VISUALIZADOR DE TRASLADO */}
              <div
                style={{
                  borderRadius: 8,
                  border: '1px solid #E2E8F0',
                  padding: 14,
                  backgroundColor: '#FFFFFF',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: '#0F172A', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <MapPin size={16} style={{ color: '#2563EB' }} />
                    <span>Ubicación Destino Comercial</span>
                  </div>
                  <span style={{ fontSize: 11, color: '#64748B' }}>
                    Solo racks comerciales compatibles y activos
                  </span>
                </div>

                {/* Diagrama visual Origen -> Destino */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 16,
                    padding: '12px 16px',
                    backgroundColor: '#F8FAFC',
                    borderRadius: 8,
                    border: '1px solid #CBD5E1',
                    marginBottom: 14,
                  }}
                >
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 10, color: '#64748B', fontWeight: 700, textTransform: 'uppercase' }}>Origen</div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: '#1E293B', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <MapPin size={14} style={{ color: '#64748B' }} />
                      {item.ubicacion?.codigo || '—'}
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: isFormValid ? '#2563EB' : '#94A3B8' }}>
                      {movingUnits} PZA {hasHus ? `(${movingBultosCount} HU)` : ''}
                    </span>
                    <ArrowRight size={22} style={{ color: isFormValid ? '#2563EB' : '#94A3B8' }} />
                  </div>

                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 10, color: '#047857', fontWeight: 700, textTransform: 'uppercase' }}>Destino</div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: '#047857', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <MapPin size={14} style={{ color: '#059669' }} />
                      {targetLocObj?.codigo || 'Seleccione destino'}
                    </div>
                  </div>
                </div>

                {loadingLocations ? (
                  <div style={{ textAlign: 'center', padding: 12, color: '#64748B', fontSize: 12 }}>
                    <RefreshCw size={14} className="animate-spin" /> Evaluando racks compatibles disponibles...
                  </div>
                ) : locations.length === 0 ? (
                  <div
                    style={{
                      padding: '12px 14px',
                      borderRadius: 6,
                      backgroundColor: '#FEF2F2',
                      border: '1px solid #FCA5A5',
                      color: '#991B1B',
                      fontSize: 12,
                    }}
                  >
                    <strong>Sin destinos compatibles:</strong> No se encontraron ubicaciones de almacenamiento comercial compatibles con este producto, categoría y depositante.
                  </div>
                ) : locationsWithCapacity.length > 0 ? (
                  <div>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#0F172A', marginBottom: 4 }}>
                      Seleccionar Rack Destino Compatible:
                    </label>
                    <select
                      value={targetLocationId}
                      onChange={(e) => setTargetLocationId(e.target.value)}
                      className="input"
                      style={{ width: '100%', fontSize: 13, padding: '7px 10px' }}
                    >
                      <option value="" disabled>
                        -- Seleccione un rack destino con capacidad suficiente ({locationsWithCapacity.length} disponibles) --
                      </option>
                      {locationsWithCapacity.map(loc => {
                        const dispPiezas = loc.capacidadDisponibleUnidades ?? loc.capDispUnidades ?? loc.capacidadUnits ?? 0;
                        const hasConfiguredBultos =
                          loc.capacidadBultosEstado === 'CONFIGURADA' &&
                          typeof loc.capacidadDisponibleBultos === 'number' &&
                          !isNaN(loc.capacidadDisponibleBultos);
                        const dispBultos = hasConfiguredBultos ? ` · ${loc.capacidadDisponibleBultos} bultos disp.` : '';

                        return (
                          <option key={loc.id} value={loc.id}>
                            {loc.codigo} — {loc.zona?.nombre || 'Zona Comercial'} (Disponible: {dispPiezas} pzas{dispBultos})
                          </option>
                        );
                      })}
                    </select>
                  </div>
                ) : (
                  <div
                    style={{
                      padding: '14px 16px',
                      borderRadius: 8,
                      backgroundColor: '#FFFBEB',
                      border: '1px solid #FDE68A',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 10,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#B45309' }}>
                      <AlertTriangle size={18} style={{ flexShrink: 0 }} />
                      <span style={{ fontWeight: 700, fontSize: 13 }}>
                        Sin ubicaciones compatibles con capacidad suficiente
                      </span>
                    </div>

                    <p style={{ margin: 0, fontSize: 12, color: '#78350F', lineHeight: 1.5 }}>
                      {hasHus && movingBultosCount === 1
                        ? `La HU requiere ${movingUnits} piezas de capacidad y el máximo disponible en la zona compatible (${locations[0]?.zona?.nombre || 'Almacenamiento'}) es ${maxCapDisponible}.`
                        : `El movimiento requiere ${movingUnits > 0 ? movingUnits : 'mayor'} piezas de capacidad y el máximo disponible en la zona compatible (${locations[0]?.zona?.nombre || 'Almacenamiento'}) es ${maxCapDisponible}.`}
                    </p>

                    {sortedCompatibleLocations.length > 0 && (
                  <div style={{ marginTop: 2 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#92400E', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.02em' }}>
                      Racks compatibles más cercanos (Capacidad vs Déficit — Informativo):
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8 }}>
                      {sortedCompatibleLocations.slice(0, 3).map(loc => {
                        const capLibre = loc.capacidadDisponibleUnidades ?? loc.capDispUnidades ?? loc.capacidadUnits ?? 0;
                        const deficit = Math.max(0, movingUnits - capLibre);
                        return (
                          <div
                            key={loc.id}
                            style={{
                              padding: '8px 10px',
                              borderRadius: 6,
                              backgroundColor: '#FFFFFF',
                              border: '1px solid #FCD34D',
                              fontSize: 11,
                              color: '#475569',
                            }}
                          >
                            <div style={{ fontWeight: 700, color: '#1E293B', display: 'flex', alignItems: 'center', gap: 4 }}>
                              <MapPin size={12} style={{ color: '#D97706' }} />
                              <span>{loc.codigo}</span>
                            </div>
                            <div style={{ marginTop: 2, display: 'flex', justifyContent: 'space-between', color: '#64748B' }}>
                              <span>{capLibre} libres</span>
                              <span style={{ fontWeight: 700, color: '#DC2626' }}>
                                {movingUnits > 0 ? `déficit ${deficit}` : 'requiere selección'}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div style={{ fontSize: 10, color: '#A16207', marginTop: 6, fontStyle: 'italic' }}>
                      * Estas referencias son estrictamente informativas y NO son seleccionables debido a la política de cero sobrecupo del WMS.
                    </div>
                  </div>
                )}
                  </div>
                )}
              </div>

              {/* 5. MOTIVO OBLIGATORIO Y OBSERVACIONES */}
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
                    Motivo Operativo de Traslado: *
                  </label>
                  <select
                    value={motivo}
                    onChange={(e) => setMotivo(e.target.value)}
                    className="input"
                    style={{ width: '100%', fontSize: 13, padding: '7px 10px' }}
                  >
                    {MOTIVOS_CATALOGO.map(m => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#0F172A', marginBottom: 4 }}>
                    {motivo === 'Otro' ? 'Observación Obligatoria: *' : 'Observaciones adicionales:'}
                  </label>
                  <input
                    type="text"
                    value={observaciones}
                    onChange={(e) => setObservaciones(e.target.value)}
                    placeholder={motivo === 'Otro' ? 'Especifique la justificación técnica del movimiento...' : 'Notas opcionales para la bitácora...'}
                    className="input"
                    style={{ width: '100%', fontSize: 13, padding: '7px 10px' }}
                  />
                </div>
              </div>

              {/* 6. BANNER DE CONFIRMACIÓN CANÓNICA */}
              <div
                style={{
                  padding: '12px 14px',
                  borderRadius: 8,
                  backgroundColor: '#EFF6FF',
                  border: '1px solid #BFDBFE',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  fontSize: 12,
                  color: '#1E40AF',
                }}
              >
                <ShieldCheck size={18} style={{ color: '#2563EB', flexShrink: 0 }} />
                <div>
                  <strong>Traslado interno.</strong> El físico global del inventario permanecerá sin cambios. Se generará un movimiento de Kárdex tipo <code>TRASIEGO</code> y registro inmutable en auditoría.
                </div>
              </div>
            </>
          )}
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
            Operador: <strong>{currentUser}</strong>
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
              disabled={submitting || hasInventoryInconsistency || !isFormValid || !targetLocationId || !isTargetCapSufficient}
              className="btn btn-primary"
              style={{
                padding: '8px 18px',
                fontSize: 13,
                fontWeight: 700,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                backgroundColor: !hasInventoryInconsistency && isFormValid && targetLocationId && isTargetCapSufficient && !submitting ? '#2563EB' : '#94A3B8',
                borderColor: !hasInventoryInconsistency && isFormValid && targetLocationId && isTargetCapSufficient && !submitting ? '#1D4ED8' : '#94A3B8',
                cursor: !hasInventoryInconsistency && isFormValid && targetLocationId && isTargetCapSufficient && !submitting ? 'pointer' : 'not-allowed',
              }}
            >
              {submitting ? (
                <>
                  <RefreshCw size={14} className="animate-spin" />
                  <span>Procesando trasiego...</span>
                </>
              ) : (
                <>
                  <ArrowRight size={15} />
                  <span>
                    {hasInventoryInconsistency
                      ? 'Inconsistencia de inventario'
                      : !isFormValid
                      ? (hasHus ? 'Confirmar Traslado (Seleccione HU)' : 'Confirmar Traslado (Capture cantidad)')
                      : !targetLocationId || !isTargetCapSufficient
                      ? 'Capacidad insuficiente'
                      : `Confirmar Traslado (${movingUnits} pzas)`}
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
