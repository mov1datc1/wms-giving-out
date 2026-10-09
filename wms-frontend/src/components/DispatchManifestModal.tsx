import { useEffect, useState, useRef } from 'react';
import {
  FileText, Truck, UserCheck, ShieldCheck, CheckCircle2,
  AlertTriangle, X, Printer, Package, Store, MapPin, Hash,
  Calendar, Clock, Edit3, Send, Layers
} from 'lucide-react';
import { API } from '../config/api';
import { formatCalendarDate } from '../utils/dateUtils';

interface DispatchManifestModalProps {
  orderId: string;
  token: string;
  currentUser: string;
  onClose: () => void;
  onSuccess?: () => void;
}

export function DispatchManifestModal({
  orderId,
  token,
  currentUser,
  onClose,
  onSuccess,
}: DispatchManifestModalProps) {
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [manifestData, setManifestData] = useState<any>(null);

  // Formulario de transporte
  const [transportForm, setTransportForm] = useState({
    tipoTransporte: 'DIRECTO',
    fletera: 'Transportes Logísticos Especializados',
    choferNombre: '',
    choferLicencia: '',
    vehiculoPlaca: '',
    paqueteria: '',
    numeroGuia: '',
    selloSeguridad: '',
    notas: '',
  });

  // Canvas de firmas
  const despachadorCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const choferCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawingDespachador, setIsDrawingDespachador] = useState(false);
  const [isDrawingChofer, setIsDrawingChofer] = useState(false);
  const [hasDespachadorFirma, setHasDespachadorFirma] = useState(false);
  const [hasChoferFirma, setHasChoferFirma] = useState(false);

  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  useEffect(() => {
    loadManifest();
  }, [orderId]);

  async function loadManifest() {
    setLoading(true);
    setErrorMsg('');
    try {
      const res = await fetch(`${API}/orders/${orderId}/manifest`, { headers });
      if (!res.ok) throw new Error('Error al cargar datos del manifiesto');
      const data = await res.json();
      setManifestData(data);

      if (data.order) {
        setTransportForm({
          tipoTransporte: data.order.tipoTransporte || 'DIRECTO',
          fletera: data.order.fletera || (data.order.paqueteria ? data.order.paqueteria : 'Transportes Logísticos Especializados'),
          choferNombre: data.order.choferNombre || '',
          choferLicencia: data.order.choferLicencia || '',
          vehiculoPlaca: data.order.vehiculoPlaca || '',
          paqueteria: data.order.paqueteria || '',
          numeroGuia: data.order.numeroGuia || '',
          selloSeguridad: data.order.selloSeguridad || `SELLO-${Math.floor(100000 + Math.random() * 900000)}`,
          notas: data.order.notas || '',
        });
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'No se pudo obtener el manifiesto');
    }
    setLoading(false);
  }

  // --- Canvas helper functions ---
  function startDrawing(type: 'despachador' | 'chofer', e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) {
    const canvas = type === 'despachador' ? despachadorCanvasRef.current : choferCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const x = 'touches' in e ? e.touches[0].clientX - rect.left : e.clientX - rect.left;
    const y = 'touches' in e ? e.touches[0].clientY - rect.top : e.clientY - rect.top;

    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';

    if (type === 'despachador') {
      setIsDrawingDespachador(true);
      setHasDespachadorFirma(true);
    } else {
      setIsDrawingChofer(true);
      setHasChoferFirma(true);
    }
  }

  function draw(type: 'despachador' | 'chofer', e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) {
    const isDrawing = type === 'despachador' ? isDrawingDespachador : isDrawingChofer;
    if (!isDrawing) return;
    const canvas = type === 'despachador' ? despachadorCanvasRef.current : choferCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const x = 'touches' in e ? e.touches[0].clientX - rect.left : e.clientX - rect.left;
    const y = 'touches' in e ? e.touches[0].clientY - rect.top : e.clientY - rect.top;

    ctx.lineTo(x, y);
    ctx.stroke();
  }

  function stopDrawing(type: 'despachador' | 'chofer') {
    if (type === 'despachador') setIsDrawingDespachador(false);
    else setIsDrawingChofer(false);
  }

  function clearCanvas(type: 'despachador' | 'chofer') {
    const canvas = type === 'despachador' ? despachadorCanvasRef.current : choferCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (type === 'despachador') setHasDespachadorFirma(false);
    else setHasChoferFirma(false);
  }

  async function handleConfirmDispatch() {
    if (!transportForm.choferNombre && transportForm.tipoTransporte === 'DIRECTO') {
      setErrorMsg('Debes especificar el nombre del chofer o transportista responsable.');
      return;
    }
    if (!transportForm.vehiculoPlaca) {
      setErrorMsg('Debes ingresar la placa del vehículo de transporte.');
      return;
    }

    setSubmitting(true);
    setErrorMsg('');

    try {
      const despachadorFirma = despachadorCanvasRef.current?.toDataURL('image/png') || '';
      const choferFirma = choferCanvasRef.current?.toDataURL('image/png') || '';

      const res = await fetch(`${API}/orders/${orderId}/dispatch`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          despachador: currentUser,
          vehiculoPlaca: transportForm.vehiculoPlaca,
          tipoTransporte: transportForm.tipoTransporte,
          paqueteria: transportForm.paqueteria,
          numeroGuia: transportForm.numeroGuia,
          fletera: transportForm.fletera,
          choferNombre: transportForm.choferNombre,
          choferLicencia: transportForm.choferLicencia,
          selloSeguridad: transportForm.selloSeguridad,
          notas: transportForm.notas,
          firmaDespachador: despachadorFirma,
          firmaChofer: choferFirma,
          folioManifiesto: manifestData?.folio || `MAN-${manifestData?.order?.codigo}`,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Error al procesar el despacho');
      }

      setSuccessMsg('Salida de almacén y despacho confirmados exitosamente. El inventario físico ha sido descontado y las ubicaciones liberadas.');
      if (onSuccess) onSuccess();
      await loadManifest();
    } catch (err: any) {
      setErrorMsg(err.message || 'Ocurrió un error al procesar el despacho');
    }
    setSubmitting(false);
  }

  function handlePrint() {
    window.print();
  }

  const order = manifestData?.order;
  const isAlreadyDispatched = order?.estado === 'DESPACHADO' || order?.estado === 'ENTREGADO';

  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 1200 }}>
      <style>{`
        @media print {
          body * {
            visibility: hidden !important;
          }
          #printable-dispatch-manifest, #printable-dispatch-manifest * {
            visibility: visible !important;
          }
          #printable-dispatch-manifest {
            position: fixed !important;
            left: 0 !important;
            top: 0 !important;
            width: 100vw !important;
            height: auto !important;
            background: #ffffff !important;
            color: #000000 !important;
            padding: 20px !important;
            box-shadow: none !important;
            border: none !important;
            overflow: visible !important;
          }
          .modal-overlay {
            position: static !important;
            background: transparent !important;
          }
          .no-print {
            display: none !important;
          }
          .print-avoid-break {
            break-inside: avoid !important;
            page-break-inside: avoid !important;
          }
        }
      `}</style>
      <div
        id="printable-dispatch-manifest"
        className="modal-content animate-fade-in"
        onClick={e => e.stopPropagation()}
        style={{ maxWidth: 880, maxHeight: '90vh', overflowY: 'auto' }}
      >
        {/* Modal Header */}
        <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ padding: 8, borderRadius: 8, background: 'rgba(99,102,241,0.15)', color: 'var(--primary)' }}>
              <FileText size={22} />
            </div>
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>
                Manifiesto de Embarque y Acuse de Salida
              </h2>
              <p style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: '2px 0 0 0' }}>
                Folio: <strong style={{ color: 'var(--primary)' }}>{manifestData?.folio || 'MAN-CARGANDO'}</strong> · Pedido: {order?.codigo}
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn btn-secondary btn-sm" onClick={handlePrint} title="Imprimir Manifiesto">
              <Printer size={15} /> Imprimir / PDF
            </button>
            <button className="btn btn-ghost btn-sm" onClick={onClose}>
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="modal-body" style={{ padding: 20 }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 50, color: 'var(--text-tertiary)' }}>
              Cargando información del manifiesto...
            </div>
          ) : (
            <>
              {errorMsg && (
                <div style={{
                  padding: '12px 16px',
                  borderRadius: 8,
                  background: 'rgba(239,68,68,0.1)',
                  border: '1px solid var(--error)',
                  color: 'var(--error)',
                  marginBottom: 16,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  fontSize: 13,
                  fontWeight: 600,
                }}>
                  <AlertTriangle size={18} />
                  <span>{errorMsg}</span>
                </div>
              )}

              {successMsg && (
                <div style={{
                  padding: '12px 16px',
                  borderRadius: 8,
                  background: 'rgba(16,185,129,0.1)',
                  border: '1px solid var(--emerald)',
                  color: 'var(--emerald)',
                  marginBottom: 16,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  fontSize: 13,
                  fontWeight: 600,
                }}>
                  <CheckCircle2 size={18} />
                  <span>{successMsg}</span>
                </div>
              )}

              {/* Status Banner */}
              <div style={{
                padding: '12px 16px',
                borderRadius: 10,
                background: isAlreadyDispatched ? 'rgba(16,185,129,0.1)' : 'rgba(99,102,241,0.08)',
                border: `1px solid ${isAlreadyDispatched ? 'var(--emerald)' : 'var(--primary)'}`,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 20,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <ShieldCheck size={20} color={isAlreadyDispatched ? 'var(--emerald)' : 'var(--primary)'} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: isAlreadyDispatched ? 'var(--emerald)' : 'var(--primary)' }}>
                      {isAlreadyDispatched ? 'Despacho Oficial Confirmado — En Ruta' : 'Listo para Salida Física de Almacén'}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                      Total: {manifestData?.totalBultos} unidades de producto en {order?.lineas?.length} líneas
                    </div>
                  </div>
                </div>
                {order?.selloSeguridad && (
                  <div style={{ textAlign: 'right', fontSize: 11 }}>
                    <span style={{ color: 'var(--text-tertiary)' }}>Candado / Sello:</span>{' '}
                    <strong style={{ fontFamily: 'monospace', color: 'var(--text-primary)' }}>{order.selloSeguridad}</strong>
                  </div>
                )}
              </div>

              {/* Operational Header Grid: Depositante vs Cliente Final */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
                {/* Depositante 3PL */}
                <div className="card" style={{ padding: 14, background: 'var(--bg-secondary)' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Package size={13} /> Depositante (Cliente 3PL)
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' }}>
                    {order?.cliente?.nombreComercial}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                    RFC: {order?.cliente?.rfc || 'No registrado'}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>
                    {order?.cliente?.ciudad}, {order?.cliente?.estado}
                  </div>
                </div>

                {/* Cliente Final / Ship-To */}
                <div className="card" style={{ padding: 14, background: 'var(--bg-secondary)' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Store size={13} /> Destino Final (Ship-To)
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' }}>
                    {order?.endCustomer?.nombre || 'Entrega Directa'}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <MapPin size={12} /> {order?.endCustomer?.calle || 'Dirección registrada en orden'}, {order?.endCustomer?.ciudad || ''}
                  </div>
                  {order?.fechaCompromiso && (
                    <div style={{ fontSize: 11, color: 'var(--primary)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Calendar size={12} /> Cita: {formatCalendarDate(order.fechaCompromiso)} {order.horaCompromiso ? `· ${order.horaCompromiso} hrs` : ''}
                    </div>
                  )}
                </div>
              </div>

              {/* Transport Data Form */}
              <div style={{
                background: 'var(--bg-secondary)',
                borderRadius: 10,
                padding: 16,
                marginBottom: 20,
                border: '1px solid var(--border)',
              }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-primary)' }}>
                  <Truck size={16} color="var(--primary)" />
                  Datos de la Unidad y Transportista Responsable
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
                      Tipo de Transporte
                    </label>
                    {isAlreadyDispatched ? (
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{transportForm.tipoTransporte}</div>
                    ) : (
                      <select
                        className="form-select form-select-full"
                        value={transportForm.tipoTransporte}
                        onChange={e => setTransportForm(f => ({ ...f, tipoTransporte: e.target.value }))}
                      >
                        <option value="DIRECTO">Transporte Directo / Fletera</option>
                        <option value="PAQUETERIA">Paquetería Consolidada</option>
                        <option value="VEHICULO_PROPIO">Vehículo Propio Giving Out</option>
                        <option value="CLIENTE_RECOGE">Cliente Recoge en Andén</option>
                      </select>
                    )}
                  </div>

                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
                      Empresa Fletera / Transporte
                    </label>
                    {isAlreadyDispatched ? (
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{transportForm.fletera}</div>
                    ) : (
                      <input
                        type="text"
                        className="form-input"
                        placeholder="Ej. Transportes Castores, Tresguerras..."
                        value={transportForm.fletera}
                        onChange={e => setTransportForm(f => ({ ...f, fletera: e.target.value }))}
                      />
                    )}
                  </div>

                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
                      Nombre del Chofer / Operador
                    </label>
                    {isAlreadyDispatched ? (
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{transportForm.choferNombre || 'N/A'}</div>
                    ) : (
                      <input
                        type="text"
                        className="form-input"
                        placeholder="Nombre completo del chofer"
                        value={transportForm.choferNombre}
                        onChange={e => setTransportForm(f => ({ ...f, choferNombre: e.target.value }))}
                      />
                    )}
                  </div>

                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
                      Placa del Vehículo / Tracto
                    </label>
                    {isAlreadyDispatched ? (
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{transportForm.vehiculoPlaca || 'N/A'}</div>
                    ) : (
                      <input
                        type="text"
                        className="form-input"
                        placeholder="Ej. 45-AF-8K"
                        value={transportForm.vehiculoPlaca}
                        onChange={e => setTransportForm(f => ({ ...f, vehiculoPlaca: e.target.value }))}
                      />
                    )}
                  </div>

                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
                      Licencia / Identificación
                    </label>
                    {isAlreadyDispatched ? (
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{transportForm.choferLicencia || 'N/A'}</div>
                    ) : (
                      <input
                        type="text"
                        className="form-input"
                        placeholder="No. Licencia Federal o INE"
                        value={transportForm.choferLicencia}
                        onChange={e => setTransportForm(f => ({ ...f, choferLicencia: e.target.value }))}
                      />
                    )}
                  </div>

                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
                      Sello / Candado de Seguridad
                    </label>
                    {isAlreadyDispatched ? (
                      <div style={{ fontWeight: 600, fontSize: 13, fontFamily: 'monospace' }}>{transportForm.selloSeguridad || 'N/A'}</div>
                    ) : (
                      <input
                        type="text"
                        className="form-input"
                        placeholder="Código de precinto"
                        value={transportForm.selloSeguridad}
                        onChange={e => setTransportForm(f => ({ ...f, selloSeguridad: e.target.value }))}
                      />
                    )}
                  </div>
                </div>
              </div>

              {/* Items / Desglose de Mercancía */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Layers size={15} color="var(--primary)" />
                    Desglose de Mercancía, Lotes y Cajas (HUs) Despachadas
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    Total: <strong style={{ color: 'var(--primary)' }}>{manifestData?.totalCajas || 3}</strong> cajas · <strong style={{ color: 'var(--emerald)' }}>{manifestData?.totalBultos || 44}</strong> piezas
                  </span>
                </div>

                <div style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)' }}>
                  <table className="data-table" style={{ fontSize: 13, width: '100%' }}>
                    <thead>
                      <tr>
                        <th>SKU</th>
                        <th>Descripción</th>
                        <th>Lote Asignado</th>
                        <th>Caja / HU</th>
                        <th>Rack Origen</th>
                        <th>Caducidad</th>
                        <th style={{ textAlign: 'right' }}>Cant. Despachada</th>
                      </tr>
                    </thead>
                    <tbody>
                      {manifestData?.lineasDesglose?.map((l: any, idx: number) => (
                        <tr key={idx}>
                          <td>
                            <code style={{ fontSize: 11, fontWeight: 700, color: 'var(--primary)' }}>{l.sku}</code>
                          </td>
                          <td>{l.descripcion}</td>
                          <td>
                            <span className="badge badge-default" style={{ fontSize: 11, fontWeight: 600 }}>
                              {l.lote}
                            </span>
                          </td>
                          <td>
                            <code style={{ fontSize: 11, background: 'var(--bg-secondary)', padding: '2px 5px', borderRadius: 4, color: 'var(--text-primary)' }}>
                              {l.huCodigo || (Array.isArray(l.cajasEscaneadas) && l.cajasEscaneadas.length > 0 ? l.cajasEscaneadas.join(', ') : 'S/N')}
                            </code>
                          </td>
                          <td>
                            <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-secondary)' }}>
                              {l.ubicacion}
                            </span>
                          </td>
                          <td style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                            {l.caducidad ? formatCalendarDate(l.caducidad) : 'N/A'}
                          </td>
                          <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--emerald)' }}>
                            {l.cantidadDespachada} {l.uom || 'uds'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Signatures Section (Canvas) */}
              <div style={{
                background: 'var(--bg-secondary)',
                borderRadius: 10,
                padding: 16,
                border: '1px solid var(--border)',
                marginBottom: 16,
              }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Edit3 size={15} color="var(--primary)" />
                  Firmas Digitales de Conformidad y Responsabilidad de Transporte
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  {/* Firma Despachador */}
                  <div style={{ background: 'var(--bg-primary)', padding: 12, borderRadius: 8, border: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>
                        Entrega: Despachador Giving Out
                      </span>
                      {!isAlreadyDispatched && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          style={{ fontSize: 10, padding: '2px 6px', height: 20 }}
                          onClick={() => clearCanvas('despachador')}
                        >
                          Limpiar
                        </button>
                      )}
                    </div>
                    {isAlreadyDispatched && order?.firmaDespachador ? (
                      <div style={{ height: 90, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <img src={order.firmaDespachador} alt="Firma Despachador" style={{ maxHeight: 80, maxWidth: '100%' }} />
                      </div>
                    ) : (
                      <canvas
                        ref={despachadorCanvasRef}
                        width={360}
                        height={90}
                        onMouseDown={e => startDrawing('despachador', e)}
                        onMouseMove={e => draw('despachador', e)}
                        onMouseUp={() => stopDrawing('despachador')}
                        onMouseLeave={() => stopDrawing('despachador')}
                        onTouchStart={e => startDrawing('despachador', e)}
                        onTouchMove={e => draw('despachador', e)}
                        onTouchEnd={() => stopDrawing('despachador')}
                        style={{
                          width: '100%',
                          height: 90,
                          background: '#ffffff',
                          borderRadius: 6,
                          border: '1px dashed var(--border)',
                          cursor: 'crosshair',
                        }}
                      />
                    )}
                    <div style={{ fontSize: 11, color: 'var(--text-tertiary)', textAlign: 'center', marginTop: 4 }}>
                      {order?.despachador || currentUser}
                    </div>
                  </div>

                  {/* Firma Chofer */}
                  <div style={{ background: 'var(--bg-primary)', padding: 12, borderRadius: 8, border: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>
                        Recibe: Chofer / Fletera
                      </span>
                      {!isAlreadyDispatched && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          style={{ fontSize: 10, padding: '2px 6px', height: 20 }}
                          onClick={() => clearCanvas('chofer')}
                        >
                          Limpiar
                        </button>
                      )}
                    </div>
                    {isAlreadyDispatched && order?.firmaChofer ? (
                      <div style={{ height: 90, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <img src={order.firmaChofer} alt="Firma Chofer" style={{ maxHeight: 80, maxWidth: '100%' }} />
                      </div>
                    ) : (
                      <canvas
                        ref={choferCanvasRef}
                        width={360}
                        height={90}
                        onMouseDown={e => startDrawing('chofer', e)}
                        onMouseMove={e => draw('chofer', e)}
                        onMouseUp={() => stopDrawing('chofer')}
                        onMouseLeave={() => stopDrawing('chofer')}
                        onTouchStart={e => startDrawing('chofer', e)}
                        onTouchMove={e => draw('chofer', e)}
                        onTouchEnd={() => stopDrawing('chofer')}
                        style={{
                          width: '100%',
                          height: 90,
                          background: '#ffffff',
                          borderRadius: 6,
                          border: '1px dashed var(--border)',
                          cursor: 'crosshair',
                        }}
                      />
                    )}
                    <div style={{ fontSize: 11, color: 'var(--text-tertiary)', textAlign: 'center', marginTop: 4 }}>
                      {transportForm.choferNombre || 'Firma de transportista receptor'}
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Modal Footer */}
        <div className="modal-footer" style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border)' }}>
          <button className="btn btn-ghost" onClick={onClose}>
            Cerrar
          </button>
          {!isAlreadyDispatched && (
            <button
              className="btn btn-primary"
              disabled={submitting || loading}
              onClick={handleConfirmDispatch}
              style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <Send size={16} />
              {submitting ? 'Procesando Salida Física...' : 'Confirmar Salida Física y Despacho'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
