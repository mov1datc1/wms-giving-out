import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { API } from '../../config/api';
import {
  Package, Search, RefreshCw, MapPin, CheckCircle2, AlertTriangle,
  Clock, ShieldAlert, Building2, Layers, Filter, Eye
} from 'lucide-react';

export function PortalInventory() {
  const { token, user } = useAuth();
  const [data, setData] = useState<any>(null);
  const [search, setSearch] = useState('');
  const [filterEstado, setFilterEstado] = useState<'ALL' | 'AVAILABLE' | 'RESERVED' | 'QUARANTINE'>('ALL');
  const [selectedWarehouse, setSelectedWarehouse] = useState<string>('ALL');
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

  const allLots = data?.lotes || [];

  // Extraer almacenes únicos de los lotes
  const warehouses = Array.from(new Set(allLots.map((l: any) => l.ubicacion?.almacen?.nombre).filter(Boolean)));

  const filteredLots = allLots.filter((l: any) => {
    const term = search.toLowerCase();
    const matchSearch = !search || 
      l.sku?.descripcion?.toLowerCase().includes(term) ||
      l.sku?.codigo?.toLowerCase().includes(term) ||
      l.sku?.codigoBarras?.toLowerCase().includes(term) ||
      l.lote?.toLowerCase().includes(term) ||
      l.ubicacion?.codigo?.toLowerCase().includes(term);

    const matchWh = selectedWarehouse === 'ALL' || l.ubicacion?.almacen?.nombre === selectedWarehouse;

    let matchEstado = true;
    if (filterEstado === 'AVAILABLE') {
      matchEstado = l.estadoCalidad === 'LIBERADO' && (l.cantidadDisponible - l.cantidadReservada) > 0;
    } else if (filterEstado === 'RESERVED') {
      matchEstado = l.cantidadReservada > 0;
    } else if (filterEstado === 'QUARANTINE') {
      matchEstado = l.estadoCalidad === 'BLOQUEADO' || l.estadoCalidad === 'CUARENTENA' || l.cantidadBloqueada > 0;
    }

    return matchSearch && matchWh && matchEstado;
  });

  // Agrupar por SKU
  const grouped = filteredLots.reduce((acc: any, lot: any) => {
    const key = lot.skuId;
    if (!acc[key]) {
      acc[key] = {
        sku: lot.sku,
        lots: [],
        totalFisico: 0,
        totalDisponible: 0,
        totalReservado: 0,
        totalCuarentena: 0,
      };
    }
    acc[key].lots.push(lot);
    
    const disp = lot.cantidadDisponible || 0;
    const res = lot.cantidadReservada || 0;
    const bloq = lot.cantidadBloqueada || 0;

    acc[key].totalFisico += (disp + bloq);
    acc[key].totalReservado += res;
    
    if (lot.estadoCalidad === 'LIBERADO') {
      acc[key].totalDisponible += Math.max(0, disp - res);
    } else {
      acc[key].totalCuarentena += (bloq > 0 ? bloq : disp);
    }

    return acc;
  }, {});

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Mi Inventario en Almacén</h1>
          <p className="page-subtitle">Consulta de existencias en tiempo real desglosada por disponibilidad, pedidos en trámite y cuarentena</p>
        </div>
        <button className="btn btn-secondary" onClick={loadData}><RefreshCw size={16} /> Actualizar</button>
      </div>

      {/* Ribbon de Estados / KPIs */}
      <div className="stats-grid" style={{ marginBottom: 20 }}>
        <div 
          className="stat-card" 
          style={{ cursor: 'pointer', outline: filterEstado === 'ALL' ? '2px solid var(--primary)' : 'none' }}
          onClick={() => setFilterEstado('ALL')}
        >
          <div className="stat-icon" style={{ background: 'rgba(13,148,136,0.1)', color: 'var(--primary)' }}>
            <Package size={20} />
          </div>
          <div className="stat-info">
            <span className="stat-value">{data?.totalFisico || 0}</span>
            <span className="stat-label">Total Físico en Bodega</span>
          </div>
        </div>

        <div 
          className="stat-card" 
          style={{ cursor: 'pointer', outline: filterEstado === 'AVAILABLE' ? '2px solid var(--emerald)' : 'none' }}
          onClick={() => setFilterEstado('AVAILABLE')}
        >
          <div className="stat-icon" style={{ background: 'rgba(16,185,129,0.1)', color: 'var(--emerald)' }}>
            <CheckCircle2 size={20} />
          </div>
          <div className="stat-info">
            <span className="stat-value" style={{ color: 'var(--emerald)' }}>{data?.totalDisponible || 0}</span>
            <span className="stat-label">Disponible para Pedidos</span>
          </div>
        </div>

        <div 
          className="stat-card" 
          style={{ cursor: 'pointer', outline: filterEstado === 'RESERVED' ? '2px solid var(--accent-secondary)' : 'none' }}
          onClick={() => setFilterEstado('RESERVED')}
        >
          <div className="stat-icon" style={{ background: 'rgba(99,102,241,0.1)', color: 'var(--accent-secondary)' }}>
            <Clock size={20} />
          </div>
          <div className="stat-info">
            <span className="stat-value" style={{ color: 'var(--accent-secondary)' }}>{data?.totalReservado || 0}</span>
            <span className="stat-label">Reservado en Trámite</span>
          </div>
        </div>

        <div 
          className="stat-card" 
          style={{ cursor: 'pointer', outline: filterEstado === 'QUARANTINE' ? '2px solid var(--warning)' : 'none' }}
          onClick={() => setFilterEstado('QUARANTINE')}
        >
          <div className="stat-icon" style={{ background: 'rgba(245,158,11,0.1)', color: 'var(--warning)' }}>
            <AlertTriangle size={20} />
          </div>
          <div className="stat-info">
            <span className="stat-value" style={{ color: 'var(--warning)' }}>{data?.totalCuarentena || 0}</span>
            <span className="stat-label">Cuarentena / No Conforme</span>
          </div>
        </div>
      </div>

      {/* Barra de Filtros */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 12, padding: '14px 20px', alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="search-box" style={{ flex: 1, minWidth: 240 }}>
            <Search size={16} />
            <input 
              placeholder="Buscar por SKU, descripción, EAN o lote..." 
              value={search} 
              onChange={e => setSearch(e.target.value)} 
            />
          </div>

          {warehouses.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Building2 size={15} style={{ color: 'var(--text-tertiary)' }} />
              <select 
                className="form-select form-select-sm" 
                value={selectedWarehouse} 
                onChange={e => setSelectedWarehouse(e.target.value)}
                style={{ height: 36, fontSize: 13 }}
              >
                <option value="ALL">Todos los Almacenes</option>
                {warehouses.map((wh: any) => (
                  <option key={wh} value={wh}>{wh}</option>
                ))}
              </select>
            </div>
          )}

          {filterEstado !== 'ALL' && (
            <button className="btn btn-ghost btn-sm" onClick={() => setFilterEstado('ALL')}>
              Limpiar filtro ({filterEstado})
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-secondary)' }}>
          <RefreshCw className="animate-spin" size={24} /> Cargando inventario...
        </div>
      ) : Object.keys(grouped).length === 0 ? (
        <div className="card">
          <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-tertiary)' }}>
            <Package size={40} style={{ margin: '0 auto 12px', opacity: 0.3 }} />
            <div>No hay inventario que coincida con los filtros seleccionados.</div>
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          {Object.values(grouped).map((g: any, i: number) => (
            <div key={g.sku.id || g.sku.codigo} className="card animate-fade-in" style={{ animationDelay: `${i * 0.03}s` }}>
              <div style={{ padding: '20px 24px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 14 }}>
                  <div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                      <Package size={18} style={{ color: 'var(--primary)' }} />
                      <span style={{ fontWeight: 700, fontSize: 16 }}>{g.sku.descripcion}</span>
                      <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-tertiary)', fontWeight: 600 }}>({g.sku.codigo})</span>
                    </div>
                    {g.sku.codigoBarras && (
                      <div style={{ fontSize: 12, color: 'var(--text-tertiary)', fontFamily: 'monospace', marginBottom: 6 }}>
                        EAN-13: <strong>{g.sku.codigoBarras}</strong>
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {g.sku.categoria && <span className="badge badge-default">{g.sku.categoria}</span>}
                      {g.sku.talla && <span className="badge badge-info">Talla {g.sku.talla}</span>}
                      {g.sku.color && <span className="badge badge-default">{g.sku.color}</span>}
                    </div>
                  </div>

                  {/* Resumen de cantidades de este SKU */}
                  <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                    <div style={{ textAlign: 'center', padding: '6px 12px', background: 'rgba(16,185,129,0.06)', borderRadius: 8, border: '1px solid rgba(16,185,129,0.2)' }}>
                      <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--emerald)' }}>{g.totalDisponible}</div>
                      <div style={{ fontSize: 11, color: 'var(--emerald)' }}>Disponibles</div>
                    </div>

                    {g.totalReservado > 0 && (
                      <div style={{ textAlign: 'center', padding: '6px 12px', background: 'rgba(99,102,241,0.06)', borderRadius: 8, border: '1px solid rgba(99,102,241,0.2)' }}>
                        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--accent-secondary)' }}>{g.totalReservado}</div>
                        <div style={{ fontSize: 11, color: 'var(--accent-secondary)' }}>Reservadas</div>
                      </div>
                    )}

                    {g.totalCuarentena > 0 && (
                      <div style={{ textAlign: 'center', padding: '6px 12px', background: 'rgba(245,158,11,0.06)', borderRadius: 8, border: '1px solid rgba(245,158,11,0.2)' }}>
                        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--warning)' }}>{g.totalCuarentena}</div>
                        <div style={{ fontSize: 11, color: 'var(--warning)' }}>Cuarentena</div>
                      </div>
                    )}

                    <div style={{ textAlign: 'center', padding: '6px 12px', background: 'var(--bg-secondary)', borderRadius: 8, border: '1px solid var(--border)' }}>
                      <div style={{ fontSize: 18, fontWeight: 700 }}>{g.totalFisico}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Total Físico</div>
                    </div>
                  </div>
                </div>

                {/* Desglose por Lotes y Ubicaciones */}
                {g.lots.length > 0 && (
                  <div style={{ marginTop: 14, padding: 12, background: 'var(--bg-secondary)', borderRadius: 8, border: '1px solid var(--border)' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead>
                        <tr style={{ color: 'var(--text-tertiary)', fontSize: 11, textTransform: 'uppercase' as const, borderBottom: '1px solid var(--border)' }}>
                          <th style={{ textAlign: 'left', padding: '6px 8px' }}>Lote</th>
                          <th style={{ textAlign: 'left', padding: '6px 8px' }}>Almacén / Ubicación</th>
                          <th style={{ textAlign: 'left', padding: '6px 8px' }}>Estado Calidad</th>
                          <th style={{ textAlign: 'left', padding: '6px 8px' }}>Vencimiento</th>
                          <th style={{ textAlign: 'right', padding: '6px 8px' }}>Disponible</th>
                          <th style={{ textAlign: 'right', padding: '6px 8px' }}>Reservado</th>
                          <th style={{ textAlign: 'right', padding: '6px 8px' }}>Total Lote</th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.lots.map((lot: any) => {
                          const lotDisp = Math.max(0, (lot.cantidadDisponible || 0) - (lot.cantidadReservada || 0));
                          const isQuarantine = lot.estadoCalidad !== 'LIBERADO';

                          return (
                            <tr key={lot.id} style={{ borderBottom: '1px solid var(--border)' }}>
                              <td style={{ padding: '8px 8px', fontWeight: 600 }}>{lot.lote || 'Sin Lote'}</td>
                              <td style={{ padding: '8px 8px', color: 'var(--text-secondary)' }}>
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                  <MapPin size={12} />
                                  {lot.ubicacion?.almacen?.nombre ? `${lot.ubicacion.almacen.nombre} · ` : ''}
                                  <strong>{lot.ubicacion?.codigo || 'En Recepción'}</strong>
                                </span>
                              </td>
                              <td style={{ padding: '8px 8px' }}>
                                <span className={`badge badge-${isQuarantine ? 'warning' : 'success'}`}>
                                  {lot.estadoCalidad}
                                </span>
                              </td>
                              <td style={{ padding: '8px 8px', color: lot.fechaVencimiento ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>
                                {lot.fechaVencimiento ? new Date(lot.fechaVencimiento).toLocaleDateString('es-MX') : 'N/A'}
                              </td>
                              <td style={{ padding: '8px 8px', textAlign: 'right', fontWeight: 700, color: 'var(--emerald)' }}>
                                {!isQuarantine ? lotDisp : 0}
                              </td>
                              <td style={{ padding: '8px 8px', textAlign: 'right', color: lot.cantidadReservada > 0 ? 'var(--accent-secondary)' : 'var(--text-tertiary)', fontWeight: 600 }}>
                                {lot.cantidadReservada || 0}
                              </td>
                              <td style={{ padding: '8px 8px', textAlign: 'right', fontWeight: 700 }}>
                                {lot.cantidadDisponible + (lot.cantidadBloqueada || 0)}
                              </td>
                            </tr>
                          );
                        })}
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
