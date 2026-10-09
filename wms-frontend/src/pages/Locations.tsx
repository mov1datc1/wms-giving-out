import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { API } from '../config/api';
import {
  MapPin, Search, RefreshCw, Grid3X3, Layers, X,
  Package, Calendar, CheckCircle2, AlertTriangle, ShieldCheck
} from 'lucide-react';
import { formatCalendarDate } from '../utils/dateUtils';

export function Locations() {
  const { token } = useAuth();
  const [locations, setLocations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterZona, setFilterZona] = useState('');
  const [filterEstado, setFilterEstado] = useState('');

  // Detalle de ubicación modal (U-06)
  const [selectedLoc, setSelectedLoc] = useState<any | null>(null);
  const [locDetailLoading, setLocDetailLoading] = useState(false);
  const [locDetailData, setLocDetailData] = useState<any | null>(null);

  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    try {
      const res = await fetch(`${API}/locations`, { headers });
      if (res.ok) {
        const data = await res.json();
        setLocations(data.length > 0 ? data : demoLocations);
      } else {
        setLocations(demoLocations);
      }
    } catch (err) {
      console.error(err);
      setLocations(demoLocations);
    }
    setLoading(false);
  }

  async function handleOpenLocationDetail(loc: any) {
    setSelectedLoc(loc);
    setLocDetailLoading(true);
    setLocDetailData(null);
    try {
      const res = await fetch(`${API}/locations/${loc.id || loc.codigo}`, { headers });
      if (res.ok) {
        const data = await res.json();
        setLocDetailData(data);
      } else {
        // Fallback usando los datos embebidos de la lista
        setLocDetailData(loc);
      }
    } catch (err) {
      console.error('Error al cargar detalle de ubicación:', err);
      setLocDetailData(loc);
    } finally {
      setLocDetailLoading(false);
    }
  }

  const zonas = [...new Set(locations.map(l => l.zona?.codigo).filter(Boolean))];

  const filtered = locations.filter(l => {
    const matchSearch = !search || l.codigo?.toLowerCase().includes(search.toLowerCase());
    const matchZona = !filterZona || l.zona?.codigo === filterZona;
    const matchEstado = !filterEstado || l.estado === filterEstado;
    return matchSearch && matchZona && matchEstado;
  });

  const totalLibres = locations.filter(l => l.estado === 'LIBRE').length;
  const totalOcupadas = locations.filter(l => l.estado === 'OCUPADO').length;
  const ocupacionPct = locations.length ? Math.round((totalOcupadas / locations.length) * 100) : 0;

  // Group by zone for visual map
  const byZone: Record<string, any[]> = {};
  for (const loc of filtered) {
    const zn = loc.zona?.nombre || 'Sin Zona';
    if (!byZone[zn]) byZone[zn] = [];
    byZone[zn].push(loc);
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Ubicaciones del Almacén</h1>
          <p className="page-subtitle">{locations.length} posiciones configuradas · {totalLibres} libres · {totalOcupadas} ocupadas ({ocupacionPct}%)</p>
        </div>
        <button className="btn btn-secondary" onClick={loadData}><RefreshCw size={16}/> Actualizar</button>
      </div>

      {/* Summary bar */}
      <div className="stats-grid" style={{ marginBottom: 20 }}>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'var(--teal-bg)', color: 'var(--teal)' }}><Grid3X3 size={22}/></div>
          <div className="stat-info"><span className="stat-value">{locations.length}</span><span className="stat-label">Total Posiciones</span></div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(16,185,129,0.15)', color: 'var(--emerald)' }}><MapPin size={22}/></div>
          <div className="stat-info"><span className="stat-value">{totalLibres}</span><span className="stat-label">Libres</span></div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(249,115,22,0.15)', color: 'var(--orange)' }}><Layers size={22}/></div>
          <div className="stat-info"><span className="stat-value">{totalOcupadas}</span><span className="stat-label">Ocupadas</span></div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'rgba(99,102,241,0.15)', color: 'var(--purple)' }}><Grid3X3 size={22}/></div>
          <div className="stat-info"><span className="stat-value">{ocupacionPct}%</span><span className="stat-label">Ocupación Global</span></div>
        </div>
      </div>

      {/* Filters */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 12, padding: '16px 20px', flexWrap: 'wrap' }}>
          <div className="search-box" style={{ flex: 1, minWidth: 200 }}>
            <Search size={16}/>
            <input placeholder="Buscar por código de rack/posición..." value={search} onChange={e => setSearch(e.target.value)}/>
          </div>
          <select className="form-select" value={filterZona} onChange={e => setFilterZona(e.target.value)}>
            <option value="">Todas las zonas</option>
            {zonas.map(z => <option key={z} value={z}>{z}</option>)}
          </select>
          <select className="form-select" value={filterEstado} onChange={e => setFilterEstado(e.target.value)}>
            <option value="">Todos los estados</option>
            <option value="LIBRE">Libre</option>
            <option value="OCUPADO">Ocupado</option>
            <option value="BLOQUEADO">Bloqueado</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-secondary)' }}><RefreshCw className="animate-spin" size={24}/> Cargando ubicaciones...</div>
      ) : (
        Object.entries(byZone).map(([zoneName, locs]) => (
          <div key={zoneName} className="card animate-fade-in" style={{ marginBottom: 16 }}>
            <div className="card-header">
              <h3><MapPin size={16}/> {zoneName} <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--text-tertiary)' }}>({locs.length} posiciones)</span></h3>
            </div>
            <div style={{ padding: '16px 20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(115px, 1fr))', gap: 10 }}>
              {locs.map((loc: any) => {
                const totalUnits = (loc.lotes || []).reduce((acc: number, l: any) => acc + (l.cantidadDisponible || 0), 0);
                const isOccupied = loc.estado === 'OCUPADO' || totalUnits > 0;
                return (
                  <div
                    key={loc.id}
                    onClick={() => handleOpenLocationDetail(loc)}
                    title={`Ver detalle de stock y bultos en ${loc.codigo}`}
                    style={{
                      padding: '12px 8px',
                      borderRadius: 8,
                      textAlign: 'center',
                      cursor: 'pointer',
                      fontSize: 12,
                      fontWeight: 600,
                      border: '1px solid var(--border)',
                      transition: 'all 0.2s',
                      background: isOccupied ? 'rgba(249,115,22,0.1)' : loc.estado === 'BLOQUEADO' ? 'rgba(239,68,68,0.1)' : 'rgba(16,185,129,0.08)',
                      color: isOccupied ? 'var(--orange)' : loc.estado === 'BLOQUEADO' ? 'var(--rose)' : 'var(--emerald)',
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{loc.codigo}</div>
                    <div style={{ fontSize: 10, fontWeight: 500, marginTop: 4, color: 'var(--text-secondary)' }}>
                      {isOccupied ? `${totalUnits || loc.ocupacion || 0} pzs` : 'Libre'}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}

      {/* ===== MODAL DE DETALLE DE UBICACIÓN (U-06) ===== */}
      {selectedLoc && (
        <div className="modal-overlay" onClick={() => setSelectedLoc(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 750, maxHeight: '90vh', overflowY: 'auto' }}>
            <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h2>
                  <MapPin size={20} color="var(--primary)" /> Ubicación {selectedLoc.codigo}
                </h2>
                <p style={{ margin: 0, fontSize: 12, color: 'var(--text-secondary)' }}>
                  {selectedLoc.zona?.nombre || 'Zona de Almacén'} · {selectedLoc.tipoUbicacion || 'ESTANTERIA'}
                </p>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => setSelectedLoc(null)}>
                <X size={18} />
              </button>
            </div>

            <div style={{ padding: '16px 24px' }}>
              {locDetailLoading ? (
                <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-secondary)' }}>
                  <RefreshCw className="animate-spin" size={20} /> Consultando contenido del rack...
                </div>
              ) : (
                <>
                  {/* KPI Cards de la ubicación */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
                    <div style={{ background: 'var(--bg-secondary)', padding: '12px', borderRadius: 8, border: '1px solid var(--border)' }}>
                      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 600 }}>Estado Físico</div>
                      <div style={{ fontSize: 15, fontWeight: 700, marginTop: 4, color: selectedLoc.estado === 'OCUPADO' ? 'var(--orange)' : 'var(--emerald)' }}>
                        {selectedLoc.estado}
                      </div>
                    </div>
                    <div style={{ background: 'var(--bg-secondary)', padding: '12px', borderRadius: 8, border: '1px solid var(--border)' }}>
                      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 600 }}>Stock Físico Total</div>
                      <div style={{ fontSize: 15, fontWeight: 700, marginTop: 4 }}>
                        {locDetailData?.totalFisico ?? selectedLoc.ocupacion ?? 0} <span style={{ fontSize: 11, fontWeight: 400 }}>pzs</span>
                      </div>
                    </div>
                    <div style={{ background: 'var(--bg-secondary)', padding: '12px', borderRadius: 8, border: '1px solid var(--border)' }}>
                      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 600 }}>Stock Reservado</div>
                      <div style={{ fontSize: 15, fontWeight: 700, marginTop: 4, color: 'var(--accent-secondary)' }}>
                        {locDetailData?.totalReservado ?? 0} <span style={{ fontSize: 11, fontWeight: 400 }}>pzs</span>
                      </div>
                    </div>
                    <div style={{ background: 'var(--bg-secondary)', padding: '12px', borderRadius: 8, border: '1px solid var(--border)' }}>
                      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 600 }}>Disponible Libre</div>
                      <div style={{ fontSize: 15, fontWeight: 700, marginTop: 4, color: 'var(--emerald)' }}>
                        {locDetailData?.totalDisponible ?? 0} <span style={{ fontSize: 11, fontWeight: 400 }}>pzs</span>
                      </div>
                    </div>
                  </div>

                  {/* Tabla de Existencias por Lote / SKU */}
                  <div style={{ marginBottom: 20 }}>
                    <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Package size={15} color="var(--primary)" /> Existencias y Lotes Alojados ({locDetailData?.lotes?.length || 0} registros)
                    </h4>
                    {locDetailData?.lotes && locDetailData.lotes.length > 0 ? (
                      <div style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)' }}>
                        <table className="data-table" style={{ fontSize: 12, width: '100%' }}>
                          <thead>
                            <tr>
                              <th>SKU</th>
                              <th>Descripción</th>
                              <th>Lote</th>
                              <th>Vencimiento</th>
                              <th>Depositante</th>
                              <th style={{ textAlign: 'right' }}>Físico</th>
                              <th style={{ textAlign: 'right' }}>Reservado</th>
                              <th style={{ textAlign: 'right' }}>Disponible</th>
                            </tr>
                          </thead>
                          <tbody>
                            {locDetailData.lotes.map((l: any) => {
                              const disp = Math.max(0, (l.cantidadDisponible || 0) - (l.cantidadReservada || 0));
                              return (
                                <tr key={l.id}>
                                  <td><code>{l.sku?.codigo}</code></td>
                                  <td>{l.sku?.descripcion || '—'}</td>
                                  <td><span className="badge badge-default">{l.lote || 'Sin Lote'}</span></td>
                                  <td>{formatCalendarDate(l.fechaVencimiento)}</td>
                                  <td>{l.cliente?.nombreComercial || '—'}</td>
                                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{l.cantidadDisponible}</td>
                                  <td style={{ textAlign: 'right', color: l.cantidadReservada > 0 ? 'var(--accent-secondary)' : 'inherit' }}>
                                    {l.cantidadReservada || 0}
                                  </td>
                                  <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--emerald)' }}>
                                    {disp}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div style={{ padding: 24, textAlign: 'center', background: 'var(--bg-secondary)', borderRadius: 8, border: '1px dashed var(--border)', color: 'var(--text-tertiary)', fontSize: 12 }}>
                        Ubicación 100% libre. No cuenta con saldo de lotes ni reservas activas.
                      </div>
                    )}
                  </div>

                  {/* Tabla de Handling Units (Cajas/Pallets) físicas */}
                  {locDetailData?.handlingUnits && locDetailData.handlingUnits.length > 0 && (
                    <div>
                      <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Layers size={15} color="var(--primary)" /> Unidades de Manejo (HUs) Físicas en Posición ({locDetailData.handlingUnits.length})
                      </h4>
                      <div style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)' }}>
                        <table className="data-table" style={{ fontSize: 12, width: '100%' }}>
                          <thead>
                            <tr>
                              <th>Código HU</th>
                              <th>Tipo</th>
                              <th>SKU / Contenido</th>
                              <th>Lote</th>
                              <th style={{ textAlign: 'right' }}>Cantidad</th>
                              <th>Estado</th>
                            </tr>
                          </thead>
                          <tbody>
                            {locDetailData.handlingUnits.map((h: any) => (
                              <tr key={h.id}>
                                <td><code>{h.codigo}</code></td>
                                <td>{h.tipoHu}</td>
                                <td>{h.skuCodigo || h.lote?.sku?.codigo || '—'}</td>
                                <td>{h.loteTexto || h.lote?.lote || '—'}</td>
                                <td style={{ textAlign: 'right', fontWeight: 700 }}>{h.cantidad} pzs</td>
                                <td><span className="badge badge-success">{h.estadoHu}</span></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="modal-footer" style={{ borderTop: '1px solid var(--border)' }}>
              <button className="btn btn-secondary" onClick={() => setSelectedLoc(null)}>
                Cerrar Consulta
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const demoLocations = [
  { id: 'loc-1', codigo: 'REC-01', estado: 'LIBRE', tipoUbicacion: 'RECIBO', zona: { codigo: 'ZONA-REC', nombre: 'Andén de Recibo & Inspección' } },
  { id: 'loc-2', codigo: 'DEV-01', estado: 'LIBRE', tipoUbicacion: 'DEVOLUCION', zona: { codigo: 'ZONA-REC', nombre: 'Andén de Recibo & Inspección' } },
  { id: 'loc-3', codigo: 'A01-R01-N1', estado: 'OCUPADO', ocupacion: 250, tipoUbicacion: 'ESTANTERIA', zona: { codigo: 'ZONA-ROPA', nombre: 'Zona Almacenaje Ropa (FIFO)' } },
  { id: 'loc-4', codigo: 'A01-R01-N2', estado: 'LIBRE', tipoUbicacion: 'ESTANTERIA', zona: { codigo: 'ZONA-ROPA', nombre: 'Zona Almacenaje Ropa (FIFO)' } },
  { id: 'loc-5', codigo: 'A02-R01-N1', estado: 'OCUPADO', ocupacion: 100, tipoUbicacion: 'ESTANTERIA', zona: { codigo: 'ZONA-ROPA', nombre: 'Zona Almacenaje Ropa (FIFO)' } },
  { id: 'loc-6', codigo: 'B01-R01-N1', estado: 'OCUPADO', ocupacion: 50, tipoUbicacion: 'RACK', zona: { codigo: 'ZONA-ALIM', nombre: 'Zona Almacenaje Alimentos (FEFO)' } }
];
