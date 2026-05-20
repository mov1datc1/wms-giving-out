import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { API } from '../../config/api';
import { Package, Search, RefreshCw, MapPin } from 'lucide-react';

export function PortalInventory() {
  const { token, user } = useAuth();
  const [data, setData] = useState<any>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const headers: any = { Authorization: `Bearer ${token}` };

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    try {
      const res = await fetch(`${API}/clients/${user?.clienteId}/inventory`, { headers });
      if (res.ok) setData(await res.json());
    } catch (err) { console.error(err); }
    setLoading(false);
  }

  const lots = (data?.lotes || []).filter((l: any) =>
    !search || l.sku?.descripcion?.toLowerCase().includes(search.toLowerCase()) ||
    l.sku?.codigo?.toLowerCase().includes(search.toLowerCase()) ||
    l.lote?.toLowerCase().includes(search.toLowerCase())
  );

  // Group by SKU
  const grouped = lots.reduce((acc: any, lot: any) => {
    const key = lot.skuId;
    if (!acc[key]) acc[key] = { sku: lot.sku, lots: [], total: 0 };
    acc[key].lots.push(lot);
    acc[key].total += lot.cantidadDisponible;
    return acc;
  }, {});

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Mi Inventario</h1>
          <p className="page-subtitle">{data?.totalSkus || 0} SKUs · {data?.totalUnidades || 0} unidades en almacén</p>
        </div>
        <button className="btn btn-secondary" onClick={loadData}><RefreshCw size={16} /> Actualizar</button>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ padding: '16px 20px' }}>
          <div className="search-box" style={{ flex: 1 }}><Search size={16} /><input placeholder="Buscar por SKU, descripción o lote..." value={search} onChange={e => setSearch(e.target.value)} /></div>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-secondary)' }}>Cargando inventario...</div>
      ) : Object.keys(grouped).length === 0 ? (
        <div className="card"><div style={{ padding: 40, textAlign: 'center', color: 'var(--text-tertiary)' }}>No hay inventario activo para tu cuenta.</div></div>
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          {Object.values(grouped).map((g: any, i: number) => (
            <div key={g.sku.codigo} className="card animate-fade-in" style={{ animationDelay: `${i * 0.04}s` }}>
              <div style={{ padding: '20px 24px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                      <Package size={16} style={{ color: 'var(--primary)' }} />
                      <span style={{ fontWeight: 700, fontSize: 15 }}>{g.sku.descripcion}</span>
                      <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-tertiary)' }}>{g.sku.codigo}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {g.sku.categoria && <span className="badge badge-default">{g.sku.categoria}</span>}
                      {g.sku.talla && <span className="badge badge-info">Talla {g.sku.talla}</span>}
                      {g.sku.color && <span className="badge badge-default">{g.sku.color}</span>}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--primary)' }}>{g.total}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{g.sku.uomBase} disponibles</div>
                  </div>
                </div>

                {/* Lot breakdown */}
                {g.lots.length > 0 && (
                  <div style={{ marginTop: 12, padding: 12, background: 'var(--bg-secondary)', borderRadius: 8 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <thead>
                        <tr style={{ color: 'var(--text-tertiary)', fontSize: 11, textTransform: 'uppercase' as const }}>
                          <th style={{ textAlign: 'left', padding: '4px 0' }}>Lote</th>
                          <th style={{ textAlign: 'left', padding: '4px 0' }}>Ubicación</th>
                          <th style={{ textAlign: 'left', padding: '4px 0' }}>Caducidad</th>
                          <th style={{ textAlign: 'right', padding: '4px 0' }}>Cantidad</th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.lots.map((lot: any) => (
                          <tr key={lot.id} style={{ borderTop: '1px solid var(--border)' }}>
                            <td style={{ padding: '6px 0', fontWeight: 500 }}>{lot.lote || '—'}</td>
                            <td style={{ padding: '6px 0', color: 'var(--text-secondary)' }}><MapPin size={12} /> {lot.ubicacion?.codigo || '—'}</td>
                            <td style={{ padding: '6px 0', color: lot.fechaCaducidad && new Date(lot.fechaCaducidad) < new Date(Date.now() + 30*24*60*60*1000) ? 'var(--error)' : 'var(--text-secondary)' }}>
                              {lot.fechaCaducidad ? new Date(lot.fechaCaducidad).toLocaleDateString('es-MX') : '—'}
                            </td>
                            <td style={{ padding: '6px 0', textAlign: 'right', fontWeight: 700 }}>{lot.cantidadDisponible}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
