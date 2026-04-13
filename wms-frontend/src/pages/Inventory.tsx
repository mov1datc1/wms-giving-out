import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { API } from '../config/api';
import { Search, RefreshCw, Box, Tag, MapPin, Calendar, Download } from 'lucide-react';

export function Inventory() {
  const { token } = useAuth();
  const [lots, setLots] = useState<any[]>([]);
  const [hus, setHus] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'lots' | 'hus'>('lots');
  const [search, setSearch] = useState('');
  const [filterClient, setFilterClient] = useState('');
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [lotsRes, husRes, clientsRes] = await Promise.all([
        fetch(`${API}/inventory/lots`, { headers }),
        fetch(`${API}/inventory/handling-units`, { headers }),
        fetch(`${API}/clients`, { headers }),
      ]);
      if (lotsRes.ok) setLots(await lotsRes.json());
      if (husRes.ok) setHus(await husRes.json());
      if (clientsRes.ok) setClients(await clientsRes.json());
    } catch (err) { console.error(err); }
    setLoading(false);
  }

  const filteredLots = lots.filter(l => {
    const matchSearch = !search || l.sku?.descripcion?.toLowerCase().includes(search.toLowerCase()) || l.sku?.codigo?.toLowerCase().includes(search.toLowerCase()) || l.lote?.toLowerCase().includes(search.toLowerCase());
    const matchClient = !filterClient || l.clienteId === filterClient;
    return matchSearch && matchClient;
  });

  const filteredHus = hus.filter(h => {
    const matchSearch = !search || h.codigo?.toLowerCase().includes(search.toLowerCase()) || h.lote?.sku?.descripcion?.toLowerCase().includes(search.toLowerCase());
    const matchClient = !filterClient || h.clienteId === filterClient;
    return matchSearch && matchClient;
  });

  const totalUnidades = filteredLots.reduce((s, l) => s + l.cantidadDisponible, 0);
  const totalReservado = filteredLots.reduce((s, l) => s + l.cantidadReservada, 0);

  function downloadCSV() {
    let csv = '';
    let filename = '';

    if (view === 'lots') {
      csv = 'SKU,Descripción,Cliente,Lote,Disponible,Reservado,Ubicación,Calidad,Vencimiento\n';
      filteredLots.forEach(l => {
        csv += `"${l.sku?.codigo || ''}","${l.sku?.descripcion || ''}${l.sku?.talla ? ` (${l.sku.talla})` : ''}","${l.cliente?.nombreComercial || ''}","${l.lote || ''}",${l.cantidadDisponible},${l.cantidadReservada},"${l.ubicacion?.codigo || ''}","${l.estadoCalidad}","${l.fechaVencimiento ? new Date(l.fechaVencimiento).toLocaleDateString('es-MX') : ''}"\n`;
      });
      filename = `inventario_lotes_${new Date().toISOString().slice(0, 10)}.csv`;
    } else {
      csv = 'Código HU,Tipo,SKU,Cliente,Cantidad,Estado,Etiqueta,Creado\n';
      filteredHus.forEach(h => {
        csv += `"${h.codigo}","${h.tipoHu}","${h.lote?.sku?.descripcion || ''}","${h.cliente?.nombreComercial || ''}",${h.cantidad},"${h.estadoHu}","${h.etiquetaImpresa ? 'Sí' : 'No'}","${new Date(h.createdAt).toLocaleDateString('es-MX')}"\n`;
      });
      filename = `inventario_hus_${new Date().toISOString().slice(0, 10)}.csv`;
    }

    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Inventario</h1>
          <p className="page-subtitle">{totalUnidades.toLocaleString()} unidades en stock · {totalReservado.toLocaleString()} reservadas</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" onClick={downloadCSV}><Download size={16} /> CSV</button>
          <button className="btn btn-secondary" onClick={loadData}><RefreshCw size={16} /> Actualizar</button>
        </div>
      </div>

      {/* Filters */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 12, padding: '16px 20px', flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="btn-group">
            <button className={`btn btn-sm ${view === 'lots' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setView('lots')}><Tag size={14} /> Lotes ({lots.length})</button>
            <button className={`btn btn-sm ${view === 'hus' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setView('hus')}><Box size={14} /> HUs ({hus.length})</button>
          </div>
          <div className="search-box" style={{ flex: 1, minWidth: 200 }}>
            <Search size={16} />
            <input placeholder="Buscar SKU, lote, código HU..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <select className="form-select" value={filterClient} onChange={e => setFilterClient(e.target.value)} style={{ minWidth: 180 }}>
            <option value="">Todos los clientes</option>
            {clients.map((c: any) => <option key={c.id} value={c.id}>{c.nombreComercial}</option>)}
          </select>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-secondary)' }}><RefreshCw className="animate-spin" size={24} /> Cargando inventario...</div>
      ) : view === 'lots' ? (
        <div className="card">
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Descripción</th>
                  <th>Cliente</th>
                  <th>Lote</th>
                  <th style={{ textAlign: 'right' }}>Disponible</th>
                  <th style={{ textAlign: 'right' }}>Reservado</th>
                  <th>Ubicación</th>
                  <th>Calidad</th>
                  <th>Vencimiento</th>
                </tr>
              </thead>
              <tbody>
                {filteredLots.map((l, i) => (
                  <tr key={i} className="animate-fade-in" style={{ animationDelay: `${i * 0.02}s` }}>
                    <td><code style={{ fontSize: 12, background: 'var(--bg-secondary)', padding: '2px 6px', borderRadius: 4 }}>{l.sku?.codigo}</code></td>
                    <td style={{ fontWeight: 500, whiteSpace: 'normal', minWidth: 180 }}>{l.sku?.descripcion}{l.sku?.talla ? ` (${l.sku.talla})` : ''}{l.sku?.color ? ` — ${l.sku.color}` : ''}</td>
                    <td><span className="badge badge-info">{l.cliente?.nombreComercial}</span></td>
                    <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{l.lote || '—'}</td>
                    <td style={{ fontWeight: 700, color: 'var(--teal)', textAlign: 'right' }}>{l.cantidadDisponible}</td>
                    <td style={{ color: l.cantidadReservada > 0 ? 'var(--orange)' : 'var(--text-tertiary)', textAlign: 'right' }}>{l.cantidadReservada || '—'}</td>
                    <td><span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-secondary)' }}><MapPin size={12} />{l.ubicacion?.codigo || '—'}</span></td>
                    <td><span className={`badge badge-${l.estadoCalidad === 'LIBERADO' ? 'success' : l.estadoCalidad === 'CUARENTENA' ? 'warning' : 'danger'}`}>{l.estadoCalidad}</span></td>
                    <td>{l.fechaVencimiento ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12 }}><Calendar size={12} />{new Date(l.fechaVencimiento).toLocaleDateString('es-MX')}</span> : '—'}</td>
                  </tr>
                ))}
                {filteredLots.length === 0 && <tr><td colSpan={9} style={{ textAlign: 'center', padding: 40, color: 'var(--text-tertiary)' }}>Sin lotes en inventario</td></tr>}
              </tbody>
            </table>
          </div>
          <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', fontSize: 13, color: 'var(--text-tertiary)', display: 'flex', justifyContent: 'space-between' }}>
            <span>{filteredLots.length} lotes</span>
            <span>Total: {totalUnidades.toLocaleString()} uds · Reservado: {totalReservado.toLocaleString()} uds</span>
          </div>
        </div>
      ) : (
        <div className="card">
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Código HU</th>
                  <th>Tipo</th>
                  <th>SKU</th>
                  <th>Cliente</th>
                  <th style={{ textAlign: 'right' }}>Cantidad</th>
                  <th>Estado</th>
                  <th>Etiqueta</th>
                  <th>Creado</th>
                </tr>
              </thead>
              <tbody>
                {filteredHus.map((h, i) => (
                  <tr key={i} className="animate-fade-in" style={{ animationDelay: `${i * 0.02}s` }}>
                    <td><code style={{ fontSize: 12, background: 'var(--bg-secondary)', padding: '2px 6px', borderRadius: 4 }}>{h.codigo}</code></td>
                    <td><span className={`badge badge-${h.tipoHu === 'PALLET' ? 'warning' : 'info'}`}>{h.tipoHu}</span></td>
                    <td style={{ fontWeight: 500, whiteSpace: 'normal', minWidth: 160 }}>{h.lote?.sku?.descripcion || '—'}</td>
                    <td>{h.cliente?.nombreComercial}</td>
                    <td style={{ fontWeight: 700, textAlign: 'right' }}>{h.cantidad}</td>
                    <td><span className={`badge badge-${h.estadoHu === 'ACTIVO' ? 'success' : h.estadoHu === 'DAÑADO' ? 'danger' : 'info'}`}>{h.estadoHu}</span></td>
                    <td>{h.etiquetaImpresa ? '✅' : '❌'}</td>
                    <td style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>{new Date(h.createdAt).toLocaleDateString('es-MX')}</td>
                  </tr>
                ))}
                {filteredHus.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', padding: 40, color: 'var(--text-tertiary)' }}>Sin handling units</td></tr>}
              </tbody>
            </table>
          </div>
          <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', fontSize: 13, color: 'var(--text-tertiary)' }}>
            {filteredHus.length} handling units
          </div>
        </div>
      )}
    </div>
  );
}
