import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { API } from '../config/api';
import { Truck, RefreshCw, CheckCircle, Clock, Send, MapPin, Package } from 'lucide-react';

export function Dispatch() {
  const { token, user } = useAuth();
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    try {
      const res = await fetch(`${API}/orders`, { headers });
      if (res.ok) {
        const all = await res.json();
        // Show orders ready for dispatch or already dispatched
        setOrders(all.filter((o: any) => ['CONSOLIDADO', 'DESPACHADO', 'ENTREGADO'].includes(o.estado)));
      }
    } catch (err) { console.error(err); }
    setLoading(false);
  }

  async function dispatchOrder(id: string) {
    const placa = prompt('Placa del vehículo (opcional):');
    try {
      await fetch(`${API}/orders/${id}/dispatch`, {
        method: 'POST', headers,
        body: JSON.stringify({ despachador: user?.email || 'admin', vehiculoPlaca: placa || undefined }),
      });
      loadData();
    } catch (err) { console.error(err); }
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Despacho</h1>
          <p className="page-subtitle">{orders.filter(o => o.estado === 'CONSOLIDADO').length} listos para despacho · {orders.filter(o => o.estado === 'DESPACHADO').length} despachados</p>
        </div>
        <button className="btn btn-secondary" onClick={loadData}><RefreshCw size={16}/> Actualizar</button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-secondary)' }}><RefreshCw className="animate-spin" size={24}/> Cargando...</div>
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          {orders.length === 0 && <div className="card"><div style={{ padding: 40, textAlign: 'center', color: 'var(--text-tertiary)' }}>No hay órdenes listas para despacho. Completa el picking primero.</div></div>}
          {orders.map((o, i) => (
            <div key={o.id} className="card animate-fade-in" style={{ animationDelay: `${i * 0.05}s`, borderLeft: `4px solid ${o.estado === 'DESPACHADO' ? 'var(--emerald)' : o.estado === 'ENTREGADO' ? 'var(--teal)' : 'var(--orange)'}` }}>
              <div style={{ padding: '20px 24px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                      <span style={{ fontWeight: 700, fontSize: 16 }}>{o.codigo}</span>
                      <span className={`badge badge-${o.estado === 'DESPACHADO' ? 'success' : o.estado === 'ENTREGADO' ? 'success' : 'warning'}`}>
                        {o.estado === 'DESPACHADO' ? <><Send size={12}/> Despachado</> : o.estado === 'ENTREGADO' ? <><CheckCircle size={12}/> Entregado</> : <><Clock size={12}/> Listo</>}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 16, fontSize: 13, color: 'var(--text-secondary)' }}>
                      <span><Package size={13}/> {o.cliente?.nombreComercial}</span>
                      <span><Truck size={13}/> {o.destinatario}</span>
                      <span><MapPin size={13}/> {o.direccionEntrega}</span>
                    </div>
                    <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-tertiary)' }}>
                      {o.lineas?.length} líneas · {o.lineas?.reduce((s: number, l: any) => s + l.cantidadSolicitada, 0)} uds
                      {o.fechaDespacho && <> · Despachado: {new Date(o.fechaDespacho).toLocaleDateString('es-MX')}</>}
                      {o.vehiculoPlaca && <> · 🚛 {o.vehiculoPlaca}</>}
                      {o.despachador && <> · Por: {o.despachador.split('@')[0]}</>}
                    </div>
                  </div>
                  {o.estado === 'CONSOLIDADO' && (
                    <button className="btn btn-primary" onClick={() => dispatchOrder(o.id)}>
                      <Send size={16}/> Despachar
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
