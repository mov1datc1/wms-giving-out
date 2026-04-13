import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { API } from '../config/api';
import { MapPin, Search, RefreshCw, Grid3X3, Layers } from 'lucide-react';

export function Locations() {
  const { token } = useAuth();
  const [locations, setLocations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterZona, setFilterZona] = useState('');
  const [filterEstado, setFilterEstado] = useState('');
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    try {
      const res = await fetch(`${API}/locations`, { headers });
      if (res.ok) setLocations(await res.json());
    } catch (err) { console.error(err); }
    setLoading(false);
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
          <h1 className="page-title">Ubicaciones</h1>
          <p className="page-subtitle">{locations.length} ubicaciones · {totalLibres} libres · {totalOcupadas} ocupadas ({ocupacionPct}%)</p>
        </div>
        <button className="btn btn-secondary" onClick={loadData}><RefreshCw size={16}/> Actualizar</button>
      </div>

      {/* Summary bar */}
      <div className="stats-grid" style={{ marginBottom: 20 }}>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: 'var(--teal-bg)', color: 'var(--teal)' }}><Grid3X3 size={22}/></div>
          <div className="stat-info"><span className="stat-value">{locations.length}</span><span className="stat-label">Total</span></div>
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
          <div className="stat-info"><span className="stat-value">{ocupacionPct}%</span><span className="stat-label">Ocupación</span></div>
        </div>
      </div>

      {/* Filters */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 12, padding: '16px 20px', flexWrap: 'wrap' }}>
          <div className="search-box" style={{ flex: 1, minWidth: 200 }}>
            <Search size={16}/>
            <input placeholder="Buscar ubicación..." value={search} onChange={e => setSearch(e.target.value)}/>
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
              <h3><MapPin size={16}/> {zoneName} <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--text-tertiary)' }}>({locs.length} ubicaciones)</span></h3>
            </div>
            <div style={{ padding: '16px 20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: 8 }}>
              {locs.map((loc: any) => (
                <div key={loc.id} title={`${loc.codigo} — ${loc.estado} — ${loc.tipoUbicacion}`}
                  style={{
                    padding: '10px 8px', borderRadius: 8, textAlign: 'center', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                    border: '1px solid var(--border)', transition: 'all 0.2s',
                    background: loc.estado === 'OCUPADO' ? 'rgba(249,115,22,0.1)' : loc.estado === 'BLOQUEADO' ? 'rgba(239,68,68,0.1)' : 'rgba(16,185,129,0.08)',
                    color: loc.estado === 'OCUPADO' ? 'var(--orange)' : loc.estado === 'BLOQUEADO' ? 'var(--rose)' : 'var(--emerald)',
                  }}>
                  {loc.codigo}
                  <div style={{ fontSize: 10, fontWeight: 400, marginTop: 2 }}>
                    {loc.estado === 'OCUPADO' ? `${loc.ocupacion} items` : loc.estado}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
