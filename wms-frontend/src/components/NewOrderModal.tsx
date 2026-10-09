import { useState, useEffect } from 'react';
import {
  X,
  ShoppingCart,
  Plus,
  Trash2,
  Store,
  Building2,
  Calendar,
  Clock,
  Layers,
  Lock,
  CheckCircle2,
  AlertTriangle,
  Package,
  Info,
  Sliders
} from 'lucide-react';
import { API } from '../config/api';

interface NewOrderModalProps {
  token: string;
  currentUser: string;
  onClose: () => void;
  onSuccess: (createdOrder: any, openPreparation: boolean) => void;
}

interface OrderItemRow {
  skuId: string;
  cantidadSolicitada: number | string;
}

export function NewOrderModal({
  token,
  currentUser,
  onClose,
  onSuccess,
}: NewOrderModalProps) {
  const [clients, setClients] = useState<any[]>([]);
  const [endCustomers, setEndCustomers] = useState<any[]>([]);
  const [skus, setSkus] = useState<any[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [inventoryLots, setInventoryLots] = useState<any[]>([]);

  const [clienteId, setClienteId] = useState('');
  const [endCustomerId, setEndCustomerId] = useState('');
  const [almacenOrigenId, setAlmacenOrigenId] = useState('');
  const [fechaCompromiso, setFechaCompromiso] = useState(
    new Date(Date.now() + 86400000 * 2).toISOString().split('T')[0]
  );
  const [horaCompromiso, setHoraCompromiso] = useState('09:00');
  const [prioridad, setPrioridad] = useState(3);
  const [notas, setNotas] = useState('');
  const [lines, setLines] = useState<OrderItemRow[]>([{ skuId: '', cantidadSolicitada: '' }]);

  const [loadingInitial, setLoadingInitial] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  useEffect(() => {
    loadInitialData();
  }, []);

  async function loadInitialData() {
    setLoadingInitial(true);
    try {
      const [cRes, whRes] = await Promise.all([
        fetch(`${API}/clients`, { headers }),
        fetch(`${API}/warehouses`, { headers }),
      ]);

      if (cRes.ok) {
        const clientList = await cRes.json();
        setClients(clientList);
        if (clientList.length > 0) {
          // Preseleccionar AlimNorte o el primero
          const preferred = clientList.find((c: any) => c.codigo === 'DEP-ALIMENTOS-01') || clientList[0];
          setClienteId(preferred.id);
          await loadClientContext(preferred.id);
        }
      }

      if (whRes.ok) {
        const whList = await whRes.json();
        setWarehouses(whList);
        if (whList.length > 0) setAlmacenOrigenId(whList[0].id);
      }
    } catch (err) {
      console.error(err);
      setErrorMsg('Error al cargar catálogos iniciales.');
    } finally {
      setLoadingInitial(false);
    }
  }

  async function loadClientContext(clientId: string) {
    if (!clientId) return;
    try {
      const [ecRes, skuRes, invRes] = await Promise.all([
        fetch(`${API}/end-customers?clienteId=${clientId}`, { headers }),
        fetch(`${API}/skus?clienteId=${clientId}`, { headers }),
        fetch(`${API}/clients/${clientId}/inventory`, { headers }),
      ]);

      if (ecRes.ok) {
        const ecData = await ecRes.json();
        setEndCustomers(ecData);
        // Preseleccionar Walmart si existe
        const walmart = ecData.find((ec: any) => ec.nombre.toLowerCase().includes('walmart'));
        setEndCustomerId(walmart ? walmart.id : ecData[0]?.id || '');
      }

      if (skuRes.ok) {
        const skuData = await skuRes.json();
        setSkus(skuData);
        if (skuData.length > 0) {
          setLines([{ skuId: skuData[0].id, cantidadSolicitada: 10 }]);
        }
      }

      if (invRes.ok) {
        const invData = await invRes.json();
        setInventoryLots(invData.lotes || []);
      }
    } catch (err) {
      console.error('Error loading client context:', err);
    }
  }

  function handleClientChange(newClientId: string) {
    setClienteId(newClientId);
    loadClientContext(newClientId);
  }

  // Stock helpers
  function getStockInfo(skuId: string) {
    if (!skuId) return { fisico: 0, reservado: 0, disponible: 0 };
    const now = new Date();
    const matchingLots = inventoryLots.filter(l => {
      if (l.skuId !== skuId || l.estadoCalidad !== 'LIBERADO') return false;
      if (l.fechaVencimiento && new Date(l.fechaVencimiento) <= now) return false;
      return true;
    });
    let fisico = 0;
    let reservado = 0;
    for (const lot of matchingLots) {
      const disp = Number(lot.cantidadDisponible) || 0;
      const res = Number(lot.cantidadReservada) || 0;
      fisico += disp;
      reservado += res;
    }
    const disponible = Math.max(0, fisico - reservado);
    return { fisico, reservado, disponible };
  }

  function addLine() {
    if (skus.length === 0) return;
    setLines([...lines, { skuId: skus[0]?.id || '', cantidadSolicitada: 1 }]);
  }

  function removeLine(idx: number) {
    if (lines.length <= 1) return;
    setLines(lines.filter((_, i) => i !== idx));
  }

  function updateLineSku(idx: number, skuId: string) {
    const updated = [...lines];
    updated[idx] = { ...updated[idx], skuId };
    setLines(updated);
  }

  function updateLineQty(idx: number, val: string | number) {
    const updated = [...lines];
    if (val === '') {
      updated[idx] = { ...updated[idx], cantidadSolicitada: '' };
    } else {
      const parsed = parseInt(String(val).replace(/\D/g, ''), 10);
      updated[idx] = { ...updated[idx], cantidadSolicitada: isNaN(parsed) ? '' : parsed };
    }
    setLines(updated);
  }

  async function handleCreateOrder(openPreparation: boolean) {
    setErrorMsg(null);

    if (!clienteId) {
      setErrorMsg('Debe seleccionar un depositante.');
      return;
    }
    if (!endCustomerId) {
      setErrorMsg('Debe seleccionar el cliente final de destino (ej. Walmart).');
      return;
    }

    const cleanLines = lines
      .map(l => ({
        skuId: l.skuId,
        cantidadSolicitada: Number(l.cantidadSolicitada) || 0,
      }))
      .filter(l => l.skuId && l.cantidadSolicitada > 0);

    if (cleanLines.length === 0) {
      setErrorMsg('Debe ingresar al menos una partida con cantidad mayor a cero.');
      return;
    }

    // Validar disponibilidad
    for (const l of cleanLines) {
      const stock = getStockInfo(l.skuId);
      const skuObj = skus.find(s => s.id === l.skuId);
      if (l.cantidadSolicitada > stock.disponible) {
        setErrorMsg(
          `Stock disponible insuficiente para "${skuObj?.descripcion || l.skuId}". Disponible libre: ${stock.disponible} pzas. Solicitado: ${l.cantidadSolicitada} pzas.`
        );
        return;
      }
    }

    setSubmitting(true);

    const payload = {
      clienteId,
      endCustomerId,
      almacenOrigenId: almacenOrigenId || null,
      prioridad,
      fechaCompromiso: fechaCompromiso ? new Date(fechaCompromiso).toISOString() : null,
      horaCompromiso,
      notas,
      solicitadoPor: currentUser || 'Supervisor de Salidas',
      usuario: currentUser || 'Supervisor',
      lineas: cleanLines,
    };

    try {
      const res = await fetch(`${API}/orders`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Error al crear la orden de salida.');
      }

      const created = await res.json();
      onSuccess(created, openPreparation);
      onClose();
    } catch (err: any) {
      console.error('Error creating order:', err);
      setErrorMsg(err.message || 'Error al registrar el pedido.');
    } finally {
      setSubmitting(false);
    }
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
          maxWidth: 780,
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
            padding: '18px 24px',
            borderBottom: '1px solid #E2E8F0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: '#F8FAFC',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 8,
                backgroundColor: 'rgba(13, 148, 136, 0.1)',
                color: '#0D9488',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <ShoppingCart size={20} />
            </div>
            <div>
              <h2 style={{ fontSize: 17, fontWeight: 700, color: '#0F172A', margin: 0 }}>
                Nuevo Pedido de Salida (Retail / Cliente Final)
              </h2>
              <p style={{ margin: 0, fontSize: 12, color: '#64748B' }}>
                Reserva inmediata de stock disponible con resguardo del inventario físico en racks.
              </p>
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
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>
          {errorMsg && (
            <div
              style={{
                backgroundColor: '#FEF2F2',
                border: '1px solid #F87171',
                borderRadius: 8,
                padding: '12px 16px',
                color: '#991B1B',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                marginBottom: 16,
                fontSize: 13,
              }}
            >
              <AlertTriangle size={18} />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Form Top: Client & End Customer */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 16 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 4 }}>
                Depositante Propietario *
              </label>
              <select
                value={clienteId}
                onChange={e => handleClientChange(e.target.value)}
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  borderRadius: 6,
                  border: '1px solid #CBD5E1',
                  fontSize: 13,
                  color: '#0F172A',
                  backgroundColor: '#FFFFFF',
                }}
              >
                {clients.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.nombreComercial} ({c.codigo}) — {c.giro}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 4 }}>
                Cliente Final (Ship-To / Retail) *
              </label>
              <select
                value={endCustomerId}
                onChange={e => setEndCustomerId(e.target.value)}
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  borderRadius: 6,
                  border: '1px solid #CBD5E1',
                  fontSize: 13,
                  color: '#0F172A',
                  backgroundColor: '#FFFFFF',
                }}
              >
                {endCustomers.length === 0 ? (
                  <option value="">Sin clientes finales registrados</option>
                ) : (
                  endCustomers.map(ec => (
                    <option key={ec.id} value={ec.id}>
                      {ec.nombre} {ec.ciudad ? `(${ec.ciudad})` : ''}
                    </option>
                  ))
                )}
              </select>
            </div>
          </div>

          {/* Commitment Date, Time & Priority */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, marginBottom: 16 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 4 }}>
                Fecha Cita / Compromiso
              </label>
              <input
                type="date"
                value={fechaCompromiso}
                onChange={e => setFechaCompromiso(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: 6,
                  border: '1px solid #CBD5E1',
                  fontSize: 13,
                  color: '#0F172A',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 4 }}>
                Hora de Cita
              </label>
              <input
                type="time"
                value={horaCompromiso}
                onChange={e => setHoraCompromiso(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: 6,
                  border: '1px solid #CBD5E1',
                  fontSize: 13,
                  color: '#0F172A',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 4 }}>
                Prioridad
              </label>
              <select
                value={prioridad}
                onChange={e => setPrioridad(Number(e.target.value))}
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  borderRadius: 6,
                  border: '1px solid #CBD5E1',
                  fontSize: 13,
                  color: '#0F172A',
                  backgroundColor: '#FFFFFF',
                }}
              >
                <option value={1}>1 - Urgente</option>
                <option value={2}>2 - Alta</option>
                <option value={3}>3 - Normal</option>
              </select>
            </div>
          </div>

          {/* Lines Table */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#1E293B' }}>
                Partidas Solicitadas (SKUs y Cantidades)
              </span>
              <button
                type="button"
                onClick={addLine}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: 12,
                  fontWeight: 600,
                  color: '#0D9488',
                  backgroundColor: 'rgba(13, 148, 136, 0.08)',
                  border: '1px solid rgba(13, 148, 136, 0.2)',
                  borderRadius: 5,
                  padding: '4px 10px',
                  cursor: 'pointer',
                }}
              >
                <Plus size={14} />
                Agregar Producto
              </button>
            </div>

            <div style={{ border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ backgroundColor: '#F8FAFC', borderBottom: '1px solid #E2E8F0', color: '#64748B' }}>
                    <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600 }}>Producto (SKU)</th>
                    <th style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 600, width: 140 }}>
                      Stock en Racks
                    </th>
                    <th style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 600, width: 130 }}>
                      Cantidad Solicitada
                    </th>
                    <th style={{ padding: '8px 12px', width: 44 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, idx) => {
                    const stock = getStockInfo(line.skuId);
                    const isOverStock = Number(line.cantidadSolicitada) > stock.disponible;
                    return (
                      <tr key={idx} style={{ borderBottom: '1px solid #F1F5F9' }}>
                        <td style={{ padding: '8px 12px' }}>
                          <select
                            value={line.skuId}
                            onChange={e => updateLineSku(idx, e.target.value)}
                            style={{
                              width: '100%',
                              padding: '7px 10px',
                              borderRadius: 5,
                              border: '1px solid #CBD5E1',
                              fontSize: 13,
                              color: '#0F172A',
                              backgroundColor: '#FFFFFF',
                            }}
                          >
                            {skus.map(s => (
                              <option key={s.id} value={s.id}>
                                {s.codigo} — {s.descripcion} ({s.uomBase || 'PZA'})
                              </option>
                            ))}
                          </select>
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                          <div style={{ fontSize: 11, color: '#64748B' }}>
                            Físico: <strong>{stock.fisico}</strong> · Reserv: <strong>{stock.reservado}</strong>
                          </div>
                          <div
                            style={{
                              fontSize: 12,
                              fontWeight: 700,
                              color: stock.disponible > 0 ? '#0D9488' : '#EF4444',
                            }}
                          >
                            {stock.disponible} disponibles
                          </div>
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                          <input
                            type="text"
                            inputMode="numeric"
                            value={line.cantidadSolicitada}
                            placeholder="0"
                            onChange={e => updateLineQty(idx, e.target.value)}
                            style={{
                              width: 80,
                              padding: '6px 10px',
                              textAlign: 'center',
                              borderRadius: 5,
                              border: isOverStock ? '1px solid #EF4444' : '1px solid #CBD5E1',
                              fontSize: 13,
                              fontWeight: 700,
                              color: isOverStock ? '#991B1B' : '#0F172A',
                              backgroundColor: isOverStock ? '#FEF2F2' : '#FFFFFF',
                            }}
                          />
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                          {lines.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeLine(idx)}
                              style={{
                                background: 'none',
                                border: 'none',
                                color: '#EF4444',
                                cursor: 'pointer',
                                padding: 4,
                              }}
                            >
                              <Trash2 size={16} />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Soft Reservation Explanatory Banner */}
          <div
            style={{
              backgroundColor: '#F0FDFA',
              border: '1px solid #99F6E4',
              borderRadius: 8,
              padding: '12px 16px',
              display: 'flex',
              alignItems: 'flex-start',
              gap: 12,
              marginBottom: 16,
            }}
          >
            <Info size={18} color="#0D9488" style={{ marginTop: 2, flexShrink: 0 }} />
            <div style={{ fontSize: 12, color: '#134E4A', lineHeight: 1.4 }}>
              <strong>Mecanismo de Reserva Inmediata (Giving Out 3PL):</strong> Al confirmar el pedido, el stock
              disponible libre para venta se reducirá instantáneamente para evitar sobreventas cruzadas. Las existencias
              físicas en racks permanecerán intactas hasta que el surtidor las baje y se confirme el despacho formal.
            </div>
          </div>

          {/* Notes */}
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 4 }}>
              Instrucciones / Observaciones del Pedido
            </label>
            <input
              type="text"
              value={notas}
              onChange={e => setNotas(e.target.value)}
              placeholder="Ej. Cita Walmart programada 9:00 hrs. Solicita entrega en tarimas estándar."
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: 6,
                border: '1px solid #CBD5E1',
                fontSize: 13,
                color: '#0F172A',
                boxSizing: 'border-box',
              }}
            />
          </div>
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
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '8px 16px',
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

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              type="button"
              onClick={() => handleCreateOrder(false)}
              disabled={submitting}
              style={{
                padding: '8px 16px',
                borderRadius: 6,
                border: '1px solid #CBD5E1',
                backgroundColor: '#FFFFFF',
                color: '#1E293B',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Guardar Pedido
            </button>

            <button
              type="button"
              onClick={() => handleCreateOrder(true)}
              disabled={submitting}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 18px',
                borderRadius: 6,
                border: 'none',
                backgroundColor: '#0D9488',
                color: '#FFFFFF',
                fontSize: 13,
                fontWeight: 700,
                cursor: 'pointer',
                boxShadow: '0 2px 4px rgba(13, 148, 136, 0.25)',
              }}
            >
              <Sliders size={16} />
              Guardar y Abrir Panel de Preparación
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
