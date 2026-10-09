import { useState, useEffect } from 'react';
import { X, ArrowRight, ShieldAlert, CheckCircle2, AlertTriangle, AlertCircle, RefreshCw } from 'lucide-react';
import { API } from '../config/api';
import { formatCalendarDate } from '../utils/dateUtils';

interface TransferItem {
  id: string;
  sku?: { codigo?: string; descripcion?: string; talla?: string; color?: string };
  cliente?: { nombreComercial?: string };
  lote?: string;
  fechaVencimiento?: string | null;
  ubicacion?: { codigo?: string };
  cantidadDisponible?: number;
  cantidadFisica?: number;
  cantidadReservada?: number;
  isExpired?: boolean;
}

interface TransferToVirtualModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  items: TransferItem[];
  preselectedMotivo?: string;
  defaultUserName?: string;
}

const MOTIVOS_SUGERIDOS = [
  'Caducado',
  'No conforme',
  'Daño',
  'Calidad',
  'Cuarentena',
  'Devolución',
  'Corrección de inventario',
  'Otro',
];

export function TransferToVirtualModal({
  isOpen,
  onClose,
  onSuccess,
  items,
  preselectedMotivo,
  defaultUserName = 'Supervisor Giving Out',
}: TransferToVirtualModalProps) {
  const [motivo, setMotivo] = useState(preselectedMotivo || 'Caducado');
  const [motivoOtro, setMotivoOtro] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [usuario, setUsuario] = useState(defaultUserName);
  const [cantidades, setCantidades] = useState<Record<string, number | string>>({});
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const isSingle = items.length === 1;
  const singleItem = items[0];

  useEffect(() => {
    if (isOpen) {
      setErrorMsg('');
      setMotivo(preselectedMotivo || (items.some(i => i.isExpired) ? 'Caducado' : 'No conforme'));
      setMotivoOtro('');
      setObservaciones('');

      // Inicializar cantidades con el máximo disponible por cada ítem
      const initCant: Record<string, number | string> = {};
      items.forEach(it => {
        const fis = it.cantidadFisica ?? it.cantidadDisponible ?? 0;
        const res = it.cantidadReservada ?? 0;
        const disp = Math.max(0, fis - res);
        initCant[it.id] = disp;
      });
      setCantidades(initCant);
    }
  }, [isOpen, items, preselectedMotivo]);

  if (!isOpen || items.length === 0) return null;

  const handleCantidadChange = (id: string, rawVal: string) => {
    if (rawVal === '') {
      setCantidades(prev => ({ ...prev, [id]: '' }));
      return;
    }
    const digits = rawVal.replace(/\D/g, '');
    if (digits === '') {
      setCantidades(prev => ({ ...prev, [id]: '' }));
      return;
    }
    const clean = digits.replace(/^0+/, '');
    if (clean === '') {
      setCantidades(prev => ({ ...prev, [id]: '' }));
      return;
    }
    const parsed = parseInt(clean, 10);
    setCantidades(prev => ({ ...prev, [id]: isNaN(parsed) ? '' : parsed }));
  };

  const totalPiezasATransferir = items.reduce((sum, it) => {
    const val = cantidades[it.id];
    return sum + (val === '' ? 0 : (Number(val) || 0));
  }, 0);

  async function handleConfirm() {
    setErrorMsg('');
    const finalMotivo = motivo === 'Otro' ? motivoOtro.trim() : motivo;
    if (!finalMotivo) {
      setErrorMsg('Debe seleccionar o especificar un motivo obligatorio para la transferencia.');
      return;
    }

    if (!usuario.trim()) {
      setErrorMsg('El nombre del usuario responsable es obligatorio.');
      return;
    }

    if (totalPiezasATransferir <= 0) {
      setErrorMsg('La cantidad total a transferir debe ser mayor a 0 (mínimo 1 pieza).');
      return;
    }

    // Validar cada partida
    for (const it of items) {
      const val = cantidades[it.id];
      const q = val === '' ? 0 : Number(val);
      if (isNaN(q) || q <= 0) {
        setErrorMsg(`La cantidad para el SKU ${it.sku?.codigo || 'producto'} debe ser de al menos 1 pieza.`);
        return;
      }
      const fis = it.cantidadFisica ?? it.cantidadDisponible ?? 0;
      const res = it.cantidadReservada ?? 0;
      const maxPermitido = Math.max(0, fis - res);
      if (q > maxPermitido) {
        setErrorMsg(`La cantidad (${q}) para el SKU ${it.sku?.codigo} excede el físico libre transferible (${maxPermitido} pzas).`);
        return;
      }
    }

    setLoading(true);
    try {
      const payload = {
        items: items.map(it => {
          const val = cantidades[it.id];
          const q = val === '' ? 0 : Number(val);
          return {
            lotId: it.id,
            cantidad: q,
            motivo: finalMotivo,
            observaciones: observaciones.trim() || undefined,
          };
        }),
        motivoGeneral: finalMotivo,
        observaciones: observaciones.trim() || undefined,
        usuario: usuario.trim(),
      };

      const token = localStorage.getItem('token');
      const res = await fetch(`${API}/inventory/transfer-to-virtual`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Error al ejecutar la transferencia al Almacén Virtual.');
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

  // Físico libre para transferencia del ítem único
  const singleFisicoLibre = singleItem
    ? Math.max(0, (singleItem.cantidadFisica ?? singleItem.cantidadDisponible ?? 0) - (singleItem.cantidadReservada ?? 0))
    : 0;

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
          maxWidth: isSingle ? 580 : 700,
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
              <ShieldAlert size={22} />
            </div>
            <div>
              <h2 style={{ fontSize: 16, fontWeight: 800, color: '#0F172A', margin: 0 }}>
                {isSingle ? 'Transferir a Almacén Virtual (No Conforme / Merma)' : `Transferencia Masiva (${items.length} registros)`}
              </h2>
              <p style={{ fontSize: 12, color: '#64748B', margin: 0, marginTop: 2 }}>
                Segregación formal de Stock Operativo Comercial hacia Cuarentena
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

        {/* Cuerpo con Scroll */}
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

          {/* Comparativa de Ámbitos (Origen -> Destino) */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr auto 1fr',
              alignItems: 'center',
              gap: 12,
              padding: '12px 16px',
              backgroundColor: '#F8FAFC',
              borderRadius: 8,
              border: '1px solid #E2E8F0',
            }}
          >
            <div>
              <div style={{ fontSize: 10, color: '#64748B', textTransform: 'uppercase', fontWeight: 700 }}>Almacén Origen</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#0284C7', marginTop: 2 }}>Stock Operativo Comercial</div>
              <div style={{ fontSize: 11, color: '#64748B' }}>Ubicación en Racks de Despacho</div>
            </div>
            <div style={{ color: '#94A3B8', display: 'flex', justifyContent: 'center' }}>
              <ArrowRight size={20} />
            </div>
            <div>
              <div style={{ fontSize: 10, color: '#64748B', textTransform: 'uppercase', fontWeight: 700 }}>Almacén Destino</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#B45309', marginTop: 2 }}>Almacén Virtual (No Conforme / Merma)</div>
              <div style={{ fontSize: 11, color: '#64748B' }}>Ubicación DEV-01 · Retenido 100%</div>
            </div>
          </div>

          {/* Información del Ítem Individual */}
          {isSingle && singleItem && (
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
                <strong style={{ color: '#0F172A', fontFamily: 'monospace' }}>{singleItem.sku?.codigo}</strong>
              </div>
              <div>
                <span style={{ color: '#64748B' }}>Lote: </span>
                <strong style={{ color: '#0F172A', fontFamily: 'monospace' }}>{singleItem.lote || '—'}</strong>
              </div>
              <div style={{ gridColumn: 'span 2' }}>
                <span style={{ color: '#64748B' }}>Producto: </span>
                <span style={{ color: '#0F172A', fontWeight: 600 }}>{singleItem.sku?.descripcion}</span>
              </div>
              <div>
                <span style={{ color: '#64748B' }}>Cliente: </span>
                <span style={{ color: '#0F172A' }}>{singleItem.cliente?.nombreComercial || 'Depositante'}</span>
              </div>
              <div>
                <span style={{ color: '#64748B' }}>Ubicación Actual: </span>
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
                  {singleItem.ubicacion?.codigo || '—'}
                </span>
              </div>
              <div>
                <span style={{ color: '#64748B' }}>Caducidad: </span>
                <span style={{ color: singleItem.isExpired ? '#DC2626' : '#0F172A', fontWeight: singleItem.isExpired ? 700 : 500 }}>
                  {singleItem.fechaVencimiento ? formatCalendarDate(singleItem.fechaVencimiento) : 'No perecedero'}
                  {singleItem.isExpired && ' (Caducado)'}
                </span>
              </div>
              <div>
                <span style={{ color: '#64748B' }}>Físico libre para transferencia: </span>
                <strong style={{ color: '#0D9488' }}>
                  {singleFisicoLibre} pzas
                </strong>
              </div>
            </div>
          )}

          {/* Resumen de Múltiples Ítems */}
          {!isSingle && (
            <div style={{ backgroundColor: '#F8FAFC', borderRadius: 8, padding: 12, border: '1px solid #E2E8F0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 12, color: '#64748B' }}>
                <span>Registros seleccionados: <strong style={{ color: '#0F172A' }}>{items.length}</strong></span>
                <span>Total a transferir: <strong style={{ color: '#0D9488', fontSize: 13 }}>{totalPiezasATransferir} pzas</strong></span>
              </div>
              <div style={{ maxHeight: 150, overflowY: 'auto' }}>
                <table style={{ width: '100%', fontSize: 11.5, borderCollapse: 'collapse', color: '#0F172A' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#F1F5F9', borderBottom: '1px solid #E2E8F0', color: '#475569', textAlign: 'left' }}>
                      <th style={{ padding: '6px 8px' }}>SKU</th>
                      <th style={{ padding: '6px 8px' }}>Lote</th>
                      <th style={{ padding: '6px 8px' }}>Ubicación</th>
                      <th style={{ padding: '6px 8px', textAlign: 'right' }}>Físico Libre</th>
                      <th style={{ padding: '6px 8px', textAlign: 'right' }}>Cant. a Transferir</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map(it => {
                      const freeQty = Math.max(0, (it.cantidadFisica ?? it.cantidadDisponible ?? 0) - (it.cantidadReservada ?? 0));
                      return (
                        <tr key={it.id} style={{ borderBottom: '1px solid #F1F5F9' }}>
                          <td style={{ padding: '6px 8px', fontWeight: 700 }}>{it.sku?.codigo}</td>
                          <td style={{ padding: '6px 8px', fontFamily: 'monospace' }}>{it.lote || '—'}</td>
                          <td style={{ padding: '6px 8px', color: '#B45309', fontWeight: 600 }}>{it.ubicacion?.codigo || '—'}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'right', color: '#64748B' }}>{freeQty} pz</td>
                          <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                            <input
                              type="number"
                              min="1"
                              max={freeQty}
                              value={cantidades[it.id] ?? ''}
                              onChange={e => handleCantidadChange(it.id, e.target.value)}
                              style={{
                                width: 70,
                                padding: '4px 6px',
                                borderRadius: 4,
                                backgroundColor: '#FFFFFF',
                                border: '1px solid #CBD5E1',
                                color: '#0F172A',
                                fontWeight: 700,
                                textAlign: 'right',
                                fontSize: 12,
                                outline: 'none',
                              }}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Cantidad para Ítem Individual */}
          {isSingle && singleItem && (
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 4 }}>
                Cantidad a Transferir (Piezas) <span style={{ color: '#DC2626' }}>*</span>
              </label>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <input
                  type="number"
                  min="1"
                  max={singleFisicoLibre}
                  value={cantidades[singleItem.id] ?? ''}
                  onChange={e => handleCantidadChange(singleItem.id, e.target.value)}
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    borderRadius: 6,
                    backgroundColor: '#FFFFFF',
                    border: '1px solid #CBD5E1',
                    color: '#0F172A',
                    fontSize: 14,
                    fontWeight: 700,
                    outline: 'none',
                  }}
                />
                <button
                  type="button"
                  onClick={() => setCantidades({ [singleItem.id]: singleFisicoLibre })}
                  style={{
                    padding: '8px 14px',
                    borderRadius: 6,
                    backgroundColor: '#F1F5F9',
                    border: '1px solid #CBD5E1',
                    color: '#0F766E',
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer',
                    transition: 'background-color 0.15s ease',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#E2E8F0'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#F1F5F9'; }}
                >
                  Máximo ({singleFisicoLibre})
                </button>
              </div>
            </div>
          )}

          {/* Motivo de la Transferencia */}
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 4 }}>
              Motivo Obligatorio <span style={{ color: '#DC2626' }}>*</span>
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 8, marginBottom: 8 }}>
              {MOTIVOS_SUGERIDOS.map(m => {
                const isSelected = motivo === m;
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMotivo(m)}
                    style={{
                      padding: '6px 10px',
                      borderRadius: 6,
                      fontSize: 12,
                      fontWeight: isSelected ? 800 : 600,
                      textAlign: 'center',
                      cursor: 'pointer',
                      border: isSelected ? '1.5px solid #0D9488' : '1px solid #CBD5E1',
                      backgroundColor: isSelected ? '#F0FDFA' : '#FFFFFF',
                      color: isSelected ? '#0F766E' : '#475569',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {m}
                  </button>
                );
              })}
            </div>

            {motivo === 'Otro' && (
              <input
                type="text"
                placeholder="Especifique el motivo detallado..."
                value={motivoOtro}
                onChange={e => setMotivoOtro(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: 6,
                  backgroundColor: '#FFFFFF',
                  border: '1px solid #CBD5E1',
                  color: '#0F172A',
                  fontSize: 13,
                  marginTop: 6,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            )}
          </div>

          {/* Observaciones Operativas */}
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 4 }}>
              Observaciones Opcionales
            </label>
            <textarea
              rows={2}
              placeholder="Notas de segregación, número de tarima o acta interna..."
              value={observaciones}
              onChange={e => setObservaciones(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: 6,
                backgroundColor: '#FFFFFF',
                border: '1px solid #CBD5E1',
                color: '#0F172A',
                fontSize: 13,
                resize: 'none',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Usuario Responsable */}
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 4 }}>
              Usuario Responsable <span style={{ color: '#DC2626' }}>*</span>
            </label>
            <input
              type="text"
              value={usuario}
              onChange={e => setUsuario(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: 6,
                backgroundColor: '#FFFFFF',
                border: '1px solid #CBD5E1',
                color: '#0F172A',
                fontSize: 13,
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>
        </div>

        {/* Pie del Modal con Confirmación */}
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
            Total a desviar: <strong style={{ color: '#0D9488' }}>{totalPiezasATransferir} pzas</strong> a Cuarentena
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
              disabled={loading || totalPiezasATransferir <= 0}
              style={{
                padding: '9px 20px',
                borderRadius: 8,
                backgroundColor: totalPiezasATransferir <= 0 ? '#94A3B8' : '#0D9488',
                border: 'none',
                color: '#FFFFFF',
                fontWeight: 700,
                fontSize: 13,
                cursor: (loading || totalPiezasATransferir <= 0) ? 'not-allowed' : 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                boxShadow: totalPiezasATransferir <= 0 ? 'none' : '0 2px 6px rgba(13, 148, 136, 0.35)',
                transition: 'background-color 0.15s ease',
              }}
              onMouseEnter={(e) => {
                if (!loading && totalPiezasATransferir > 0) {
                  e.currentTarget.style.backgroundColor = '#0F766E';
                }
              }}
              onMouseLeave={(e) => {
                if (!loading && totalPiezasATransferir > 0) {
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
                  <CheckCircle2 size={16} /> Confirmar Transferencia
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
