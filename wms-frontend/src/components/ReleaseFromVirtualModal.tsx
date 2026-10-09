import { useState, useEffect } from 'react';
import { X, CheckCircle2, AlertTriangle, ShieldCheck, AlertCircle, RefreshCw, Lock } from 'lucide-react';
import { API } from '../config/api';
import { formatCalendarDate } from '../utils/dateUtils';

interface VirtualItem {
  id: string;
  sku?: { codigo?: string; descripcion?: string; nombre?: string; talla?: string };
  cliente?: { nombreComercial?: string };
  lote?: string;
  fechaVencimiento?: string | null;
  ubicacion?: { codigo?: string };
  cantidadBloqueada?: number;
  estadoCalidad?: string;
  notas?: string;
  tipoDesvio?: string;
  handlingUnits?: Array<{ id?: string; codigo?: string; cantidad?: number }>;
}

interface ReleaseFromVirtualModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  item: VirtualItem | null;
  defaultUserName?: string;
}

export function ReleaseFromVirtualModal({
  isOpen,
  onClose,
  onSuccess,
  item,
  defaultUserName = 'Supervisor Giving Out',
}: ReleaseFromVirtualModalProps) {
  const [cantidad, setCantidad] = useState<number | string>(1);
  const [motivo, setMotivo] = useState('');
  const [usuario, setUsuario] = useState(defaultUserName);
  const [rol, setRol] = useState('SUPERVISOR_CALIDAD');
  const [referenciaCalidad, setReferenciaCalidad] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const now = new Date();
  const isExpired = Boolean(item?.fechaVencimiento && new Date(item.fechaVencimiento) <= now);
  const isMerma = item?.estadoCalidad === 'MERMA' || (item?.notas && item.notas.toUpperCase().includes('MERMA'));
  const isDestruccion = item?.notas && (item.notas.toUpperCase().includes('DESTRUCCION') || item.notas.toUpperCase().includes('DESTRUID'));

  const handleCantidadChange = (rawVal: string) => {
    if (rawVal === '') {
      setCantidad('');
      return;
    }
    const digits = rawVal.replace(/\D/g, '');
    if (digits === '') {
      setCantidad('');
      return;
    }
    const clean = digits.replace(/^0+/, '');
    if (clean === '') {
      setCantidad('');
      return;
    }
    const parsed = parseInt(clean, 10);
    setCantidad(isNaN(parsed) ? '' : parsed);
  };

  useEffect(() => {
    if (isOpen && item) {
      setErrorMsg('');
      setCantidad(item.cantidadBloqueada || 1);
      setMotivo('');
      setUsuario(defaultUserName);
      setRol('SUPERVISOR_CALIDAD');
      setReferenciaCalidad('');
    }
  }, [isOpen, item]);

  if (!isOpen || !item) return null;

  async function handleConfirm() {
    setErrorMsg('');

    if (isExpired) {
      setErrorMsg('BLOQUEO ESTRICTO: No se puede liberar mercancía caducada a Stock Operativo comercial.');
      return;
    }

    if (isDestruccion) {
      setErrorMsg('BLOQUEO ESTRICTO: Mercancía con destrucción física registrada. Reintegración prohibida.');
      return;
    }

    if (!motivo.trim()) {
      setErrorMsg('El motivo de liberación es obligatorio.');
      return;
    }

    if (!usuario.trim()) {
      setErrorMsg('El nombre del usuario responsable es obligatorio.');
      return;
    }

    if (isMerma && !referenciaCalidad.trim()) {
      setErrorMsg('Para mercancía dictaminada como merma, es obligatorio capturar el folio formal de Calidad / Dictamen de rescate.');
      return;
    }

    const qty = cantidad === '' ? 0 : Number(cantidad);
    if (isNaN(qty) || qty <= 0) {
      setErrorMsg('La cantidad a liberar debe ser mayor a 0 (mínimo 1 pieza).');
      return;
    }

    if (qty > (item?.cantidadBloqueada || 0)) {
      setErrorMsg(`La cantidad no puede superar las ${item?.cantidadBloqueada} piezas bloqueadas.`);
      return;
    }

    setLoading(true);
    try {
      const payload = {
        lotId: item.id,
        huId: item.handlingUnits?.[0]?.id,
        cantidad: qty,
        motivo: motivo.trim(),
        usuario: usuario.trim(),
        rol: rol.trim(),
        referenciaCalidad: referenciaCalidad.trim() || undefined,
      };

      const token = localStorage.getItem('token');
      const res = await fetch(`${API}/inventory/release-from-virtual`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Error al liberar mercancía a Stock Operativo.');
      }

      onSuccess();
      onClose();
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || 'Error de conexión con el servidor.');
    } finally {
      setLoading(false);
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
          width: '100%',
          maxWidth: 580,
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: '#FFFFFF',
          border: '1px solid #E2E8F0',
          borderRadius: 14,
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
          overflow: 'hidden',
        }}
      >
        {/* Encabezado */}
        <div
          style={{
            padding: '16px 22px',
            borderBottom: '1px solid #E2E8F0',
            backgroundColor: '#FFFFFF',
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
                flexShrink: 0,
              }}
            >
              <ShieldCheck size={22} />
            </div>
            <div>
              <h2 style={{ fontSize: 16, fontWeight: 800, color: '#0F172A', margin: 0 }}>
                Liberar / Reintegrar a Stock Operativo
              </h2>
              <p style={{ fontSize: 12, color: '#64748B', margin: 0, marginTop: 2 }}>
                Retorno controlado desde Almacén Virtual hacia Disponibilidad Comercial
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              border: '1px solid #E2E8F0',
              backgroundColor: '#FFFFFF',
              color: '#64748B',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#F1F5F9'; e.currentTarget.style.color = '#0F172A'; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#FFFFFF'; e.currentTarget.style.color = '#64748B'; }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Cuerpo */}
        <div style={{ padding: '18px 22px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {errorMsg && (
            <div
              style={{
                padding: '10px 14px',
                borderRadius: 8,
                backgroundColor: '#FEF2F2',
                border: '1px solid #FCA5A5',
                color: '#B91C1C',
                fontSize: 12.5,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <AlertCircle size={16} color="#DC2626" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Bloqueo Estricto si Caducado */}
          {isExpired && (
            <div
              style={{
                padding: '12px 14px',
                borderRadius: 8,
                backgroundColor: '#FEF2F2',
                border: '1px solid #FCA5A5',
                color: '#7F1D1D',
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
              }}
            >
              <Lock size={18} color="#DC2626" style={{ marginTop: 2, flexShrink: 0 }} />
              <div>
                <strong style={{ display: 'block', fontSize: 12.5, color: '#991B1B', fontWeight: 800 }}>
                  RESTRICCIÓN NORMATIVA: LOTE CADUCADO
                </strong>
                <p style={{ fontSize: 12, margin: '3px 0 0 0', lineHeight: 1.4, color: '#B91C1C' }}>
                  Este producto venció el {formatCalendarDate(item.fechaVencimiento!)}. Su disponible comercial es 0 y el sistema prohíbe terminantemente su liberación a stock vendible. Debe permanecer en Almacén Virtual o canalizarse a destrucción / merma definitiva.
                </p>
              </div>
            </div>
          )}

          {/* Advertencia si es Merma */}
          {isMerma && !isExpired && (
            <div
              style={{
                padding: '12px 14px',
                borderRadius: 8,
                backgroundColor: '#FFFBEB',
                border: '1px solid #FCD34D',
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
              }}
            >
              <AlertTriangle size={18} color="#D97706" style={{ marginTop: 2, flexShrink: 0 }} />
              <div>
                <strong style={{ display: 'block', fontSize: 12.5, color: '#B45309', fontWeight: 800 }}>
                  Mercancía Dictaminada como Merma / Daño
                </strong>
                <p style={{ fontSize: 12, margin: '2px 0 0 0', lineHeight: 1.4, color: '#92400E' }}>
                  Requiere registrar dictamen formal de Calidad / Autorización técnica de rescate para permitir su liberación.
                </p>
              </div>
            </div>
          )}

          {/* Ficha Resumen del Ítem (Tarjeta Gris/Blanca Ligera) */}
          <div
            style={{
              backgroundColor: '#F8FAFC',
              borderRadius: 8,
              padding: '12px 14px',
              border: '1px solid #E2E8F0',
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: 8,
              fontSize: 12,
            }}
          >
            <div>
              <span style={{ color: '#64748B' }}>SKU: </span>
              <strong style={{ color: '#0F172A', fontFamily: 'monospace' }}>{item.sku?.codigo}</strong>
            </div>
            <div>
              <span style={{ color: '#64748B' }}>Lote: </span>
              <strong style={{ color: '#0F172A', fontFamily: 'monospace' }}>{item.lote || '—'}</strong>
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <span style={{ color: '#64748B' }}>Producto: </span>
              <span style={{ color: '#0F172A', fontWeight: 600 }}>{item.sku?.nombre || item.sku?.descripcion}</span>
            </div>
            <div>
              <span style={{ color: '#64748B' }}>Cliente: </span>
              <span style={{ color: '#0F172A' }}>{item.cliente?.nombreComercial || 'Depositante'}</span>
            </div>
            <div>
              <span style={{ color: '#64748B' }}>Ubicación Virtual: </span>
              <span
                style={{
                  display: 'inline-block',
                  backgroundColor: '#FEF3C7',
                  color: '#B45309',
                  fontWeight: 800,
                  fontSize: 11,
                  padding: '1px 6px',
                  borderRadius: 4,
                  border: '1px solid #FCD34D',
                }}
              >
                {item.ubicacion?.codigo || 'DEV-01'}
              </span>
            </div>
            <div>
              <span style={{ color: '#64748B' }}>Caducidad: </span>
              <span style={{ color: isExpired ? '#DC2626' : '#0F172A', fontWeight: isExpired ? 700 : 500 }}>
                {item.fechaVencimiento ? formatCalendarDate(item.fechaVencimiento) : 'No perecedero'}
                {isExpired && ' (Vencido)'}
              </span>
            </div>
            <div>
              <span style={{ color: '#64748B' }}>Cantidad Bloqueada: </span>
              <strong style={{ color: '#DC2626' }}>{item.cantidadBloqueada} pzas</strong>
            </div>
          </div>

          {/* Cantidad a Reintegrar */}
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 4 }}>
              Cantidad a Reintegrar (Piezas) <span style={{ color: '#DC2626' }}>*</span>
            </label>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <input
                type="number"
                min="1"
                max={item.cantidadBloqueada || 1}
                value={cantidad}
                onChange={e => handleCantidadChange(e.target.value)}
                disabled={isExpired || isDestruccion}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  borderRadius: 6,
                  backgroundColor: (isExpired || isDestruccion) ? '#F1F5F9' : '#FFFFFF',
                  border: '1px solid #CBD5E1',
                  color: '#0F172A',
                  fontSize: 14,
                  fontWeight: 700,
                  outline: 'none',
                }}
              />
              <button
                type="button"
                onClick={() => setCantidad(item.cantidadBloqueada || 1)}
                disabled={isExpired || isDestruccion}
                style={{
                  padding: '8px 14px',
                  borderRadius: 6,
                  backgroundColor: '#F1F5F9',
                  border: '1px solid #CBD5E1',
                  color: '#0F766E',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: (isExpired || isDestruccion) ? 'not-allowed' : 'pointer',
                  transition: 'background-color 0.15s ease',
                }}
              >
                Total ({item.cantidadBloqueada})
              </button>
            </div>
          </div>

          {/* Motivo de Liberación */}
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 4 }}>
              Motivo de Liberación / Justificación Técnica <span style={{ color: '#DC2626' }}>*</span>
            </label>
            <input
              type="text"
              placeholder="Ej. Liberación aprobada tras verificación de embalaje / Cuarentena superada..."
              value={motivo}
              onChange={e => setMotivo(e.target.value)}
              disabled={isExpired || isDestruccion}
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: 6,
                backgroundColor: (isExpired || isDestruccion) ? '#F1F5F9' : '#FFFFFF',
                border: '1px solid #CBD5E1',
                color: '#0F172A',
                fontSize: 13,
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Referencia de Calidad */}
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 4 }}>
              Folio de Referencia de Calidad {isMerma && <span style={{ color: '#DC2626' }}>(Obligatorio para Merma) *</span>}
            </label>
            <input
              type="text"
              placeholder="Ej. INSP-2026-0024 / DICTAMEN-RECUPERACION-01"
              value={referenciaCalidad}
              onChange={e => setReferenciaCalidad(e.target.value)}
              disabled={isExpired || isDestruccion}
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: 6,
                backgroundColor: (isExpired || isDestruccion) ? '#F1F5F9' : '#FFFFFF',
                border: '1px solid #CBD5E1',
                color: '#0F172A',
                fontSize: 13,
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Datos del Autorizador */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 4 }}>
                Usuario Autorizador <span style={{ color: '#DC2626' }}>*</span>
              </label>
              <input
                type="text"
                value={usuario}
                onChange={e => setUsuario(e.target.value)}
                disabled={isExpired || isDestruccion}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: 6,
                  backgroundColor: (isExpired || isDestruccion) ? '#F1F5F9' : '#FFFFFF',
                  border: '1px solid #CBD5E1',
                  color: '#0F172A',
                  fontSize: 13,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 4 }}>
                Rol / Nivel de Autorización
              </label>
              <select
                value={rol}
                onChange={e => setRol(e.target.value)}
                disabled={isExpired || isDestruccion}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: 6,
                  backgroundColor: (isExpired || isDestruccion) ? '#F1F5F9' : '#FFFFFF',
                  border: '1px solid #CBD5E1',
                  color: '#0F172A',
                  fontSize: 13,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              >
                <option value="SUPERVISOR_CALIDAD">Supervisor de Calidad</option>
                <option value="JEFE_ALMACEN">Jefe de Almacén</option>
                <option value="DIRECTOR_OPERACIONES">Director de Operaciones</option>
                <option value="AUDITOR_INTERNO">Auditor Interno</option>
              </select>
            </div>
          </div>
        </div>

        {/* Pie del Modal */}
        <div
          style={{
            padding: '14px 22px',
            borderTop: '1px solid #E2E8F0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: '#FFFFFF',
          }}
        >
          <div style={{ fontSize: 12.5, color: '#64748B' }}>
            A reintegrar: <strong style={{ color: '#0D9488' }}>{cantidad === '' ? 0 : cantidad} pzas</strong> a Stock Operativo
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              style={{
                padding: '9px 18px',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                backgroundColor: '#FFFFFF',
                border: '1px solid #CBD5E1',
                color: '#475569',
                cursor: 'pointer',
                transition: 'background-color 0.15s ease',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#F8FAFC'; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#FFFFFF'; }}
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={loading || isExpired || isDestruccion || (cantidad === '' ? 0 : Number(cantidad)) <= 0}
              style={{
                padding: '9px 20px',
                borderRadius: 8,
                backgroundColor: (isExpired || isDestruccion || (cantidad === '' ? 0 : Number(cantidad)) <= 0) ? '#94A3B8' : '#0D9488',
                border: 'none',
                color: '#FFFFFF',
                fontWeight: 700,
                fontSize: 13,
                cursor: (loading || isExpired || isDestruccion || (cantidad === '' ? 0 : Number(cantidad)) <= 0) ? 'not-allowed' : 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                boxShadow: (isExpired || isDestruccion || (cantidad === '' ? 0 : Number(cantidad)) <= 0) ? 'none' : '0 2px 6px rgba(13, 148, 136, 0.35)',
                transition: 'background-color 0.15s ease',
              }}
              onMouseEnter={(e) => {
                if (!loading && !isExpired && !isDestruccion && (cantidad === '' ? 0 : Number(cantidad)) > 0) {
                  e.currentTarget.style.backgroundColor = '#0F766E';
                }
              }}
              onMouseLeave={(e) => {
                if (!loading && !isExpired && !isDestruccion && (cantidad === '' ? 0 : Number(cantidad)) > 0) {
                  e.currentTarget.style.backgroundColor = '#0D9488';
                }
              }}
            >
              {loading ? (
                <>
                  <RefreshCw className="animate-spin" size={16} /> Procesando...
                </>
              ) : (
                <>
                  <CheckCircle2 size={16} /> Confirmar Liberación
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
