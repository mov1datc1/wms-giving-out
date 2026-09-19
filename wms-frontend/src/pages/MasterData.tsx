import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { API } from '../config/api';
import { Database, Search, RefreshCw, Package, Building, MapPin, Layers } from 'lucide-react';

type Tab = 'skus' | 'suppliers' | 'warehouses' | 'zones';

const demoSkus = [
  { id: '1', codigo: 'SUD-CAP-001', descripcion: 'Sudadera con Capucha', cliente: { nombreComercial: 'Fashion Forward' }, categoria: 'Ropa', uom: 'PZA', codigoBarras: '7501234567890' },
  { id: '2', codigo: 'CAM-S-BLA', descripcion: 'Camisa Algodón S Blanco', cliente: { nombreComercial: 'Fashion Forward' }, categoria: 'Ropa', uom: 'PZA', codigoBarras: '7509876543210' },
  { id: '3', codigo: 'PAN-M-NEGRO', descripcion: 'Pantalón Casual M Negro', cliente: { nombreComercial: 'Fashion Forward' }, categoria: 'Ropa', uom: 'PZA', codigoBarras: '7501122334455' },
  { id: '4', codigo: 'ACEITE-OLIVA-1L', descripcion: 'Aceite de Oliva Extra Virgen 1L', cliente: { nombreComercial: 'Alimentos del Bajío' }, categoria: 'Alimentos', uom: 'CAJA', codigoBarras: '7501112223334' },
  { id: '5', codigo: 'ARROZ-INTEGRAL-1KG', descripcion: 'Arroz Integral Super Premium 1kg', cliente: { nombreComercial: 'Alimentos del Bajío' }, categoria: 'Alimentos', uom: 'CAJA', codigoBarras: '7505556667778' }
];

const demoSuppliers = [
  { id: 'sup-1', codigo: 'PROV-001', nombreComercial: 'Textiles del Norte S.A.', rfc: 'TNO900101AA1', contacto: 'Roberto Gómez', telefono: '55-1122-3344' },
  { id: 'sup-2', codigo: 'PROV-002', nombreComercial: 'Importadora Mexicana de Alimentos', rfc: 'IMA950202BB2', contacto: 'Laura Sánchez', telefono: '55-5566-7788' }
];

const demoWarehouses = [
  { id: 'wh-1', codigo: 'ALM-01', nombre: 'Almacén Principal Tepotzotlán', direccion: 'Av. Industrial 45, Tepotzotlán', capM2: 5000 }
];

const demoZones = [
  { id: 'z-1', codigo: 'ZONA-ROPA', nombre: 'Zona Almacenaje Ropa (FIFO)', tipo: 'ESTANTERIA' },
  { id: 'z-2', codigo: 'ZONA-ALIM', nombre: 'Zona Almacenaje Alimentos (FEFO)', tipo: 'RACK' },
  { id: 'z-3', codigo: 'ZONA-REC', nombre: 'Andén de Recibo & Inspección', tipo: 'RECIBO' }
];

function getDemoData(t: Tab) {
  if (t === 'skus') return demoSkus;
  if (t === 'suppliers') return demoSuppliers;
  if (t === 'warehouses') return demoWarehouses;
  if (t === 'zones') return demoZones;
  return [];
}

export function MasterData() {
  const { token } = useAuth();
  const [tab, setTab] = useState<Tab>('skus');
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => { loadTab(tab); }, [tab]);

  async function loadTab(t: Tab) {
    setLoading(true); setSearch('');
    try {
      const res = await fetch(`${API}/${t}`, { headers });
      if (res.ok) {
        const d = await res.json();
        if (d.length > 0) setData(d);
        else setData(getDemoData(t));
      } else {
        setData(getDemoData(t));
      }
    } catch (err) {
      console.error(err);
      setData(getDemoData(t));
    }
    setLoading(false);
  }

  const tabs: { key: Tab; label: string; icon: any }[] = [
    { key: 'skus', label: 'SKUs', icon: Package },
    { key: 'suppliers', label: 'Proveedores', icon: Building },
    { key: 'warehouses', label: 'Almacenes', icon: MapPin },
    { key: 'zones', label: 'Zonas', icon: Layers },
  ];

  const filtered = data.filter((d: any) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return JSON.stringify(d).toLowerCase().includes(s);
  });

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Datos Maestros</h1>
          <p className="page-subtitle">Catálogos del sistema</p>
        </div>
        <button className="btn btn-secondary" onClick={() => loadTab(tab)}><RefreshCw size={16}/> Actualizar</button>
      </div>

      {/* Tabs */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 8, padding: '12px 20px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
          {tabs.map(t => (
            <button key={t.key} className={`btn btn-sm ${tab === t.key ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab(t.key)}>
              <t.icon size={14}/> {t.label} ({tab === t.key ? data.length : ''})
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 12, padding: '12px 20px' }}>
          <div className="search-box" style={{ flex: 1 }}><Search size={16}/><input placeholder="Buscar..." value={search} onChange={e => setSearch(e.target.value)}/></div>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-secondary)' }}><RefreshCw className="animate-spin" size={24}/> Cargando...</div>
      ) : tab === 'skus' ? (
        <div className="card"><div className="card-body" style={{ padding: 0 }}>
          <table className="data-table">
            <thead><tr><th>Código</th><th>Descripción</th><th>Cliente</th><th>Categoría</th><th>Trazabilidad</th><th>Marca</th><th>Talla</th><th>Color</th><th>UoM</th><th>Empaque</th></tr></thead>
            <tbody>
              {filtered.map((s: any, i: number) => (
                <tr key={i} className="animate-fade-in" style={{ animationDelay: `${i * 0.02}s` }}>
                  <td><code style={{ fontSize: 12, background: 'var(--bg-secondary)', padding: '2px 6px', borderRadius: 4 }}>{s.codigo}</code></td>
                  <td style={{ fontWeight: 500 }}>{s.descripcion}</td>
                  <td><span className="badge badge-info">{s.cliente?.nombreComercial}</span></td>
                  <td><span className={`badge badge-${s.categoria === 'PRENDA' ? 'info' : 'warning'}`}>{s.categoria}</span></td>
                  <td>
                    {(s.requiereLote || s.requiereCaducidad || s.cliente?.giro === 'COMIDA' || s.cliente?.giro === 'FARMACEUTICO') ? (
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {(s.requiereLote || s.cliente?.requiereLote || s.cliente?.giro === 'COMIDA' || s.cliente?.giro === 'FARMACEUTICO') && (
                          <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: 'rgba(245, 158, 11, 0.15)', color: '#F59E0B', fontWeight: 700, border: '1px solid rgba(245, 158, 11, 0.3)' }}>
                            LOTE
                          </span>
                        )}
                        {(s.requiereCaducidad || s.cliente?.requiereCaducidad || s.cliente?.giro === 'COMIDA' || s.cliente?.giro === 'FARMACEUTICO') && (
                          <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: 'rgba(56, 189, 248, 0.15)', color: '#38BDF8', fontWeight: 700, border: '1px solid rgba(56, 189, 248, 0.3)' }}>
                            CADUCIDAD
                          </span>
                        )}
                      </div>
                    ) : (
                      <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>Estándar</span>
                    )}
                  </td>
                  <td>{s.marca || '—'}</td>
                  <td>{s.talla || '—'}</td>
                  <td>{s.color || '—'}</td>
                  <td>{s.uomBase}</td>
                  <td style={{ fontSize: 12 }}>{s.descripcionEmpaque || '—'}</td>
                </tr>
              ))}
              {filtered.length === 0 && <tr><td colSpan={10} style={{ textAlign: 'center', padding: 40, color: 'var(--text-tertiary)' }}>Sin datos</td></tr>}
            </tbody>
          </table>
        </div></div>
      ) : tab === 'suppliers' ? (
        <div className="card"><div className="card-body" style={{ padding: 0 }}>
          <table className="data-table">
            <thead><tr><th>Código</th><th>Nombre</th><th>RFC</th><th>Teléfono</th><th>Email</th><th>Contacto</th></tr></thead>
            <tbody>
              {filtered.map((s: any, i: number) => (
                <tr key={i}><td><code>{s.codigo}</code></td><td style={{ fontWeight: 500 }}>{s.nombre}</td><td>{s.rfc || '—'}</td><td>{s.telefono || '—'}</td><td>{s.email || '—'}</td><td>{s.contacto || '—'}</td></tr>
              ))}
              {filtered.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', padding: 40, color: 'var(--text-tertiary)' }}>Sin proveedores</td></tr>}
            </tbody>
          </table>
        </div></div>
      ) : tab === 'warehouses' ? (
        <div style={{ display: 'grid', gap: 16 }}>
          {filtered.map((w: any, i: number) => (
            <div key={i} className="card"><div style={{ padding: '20px 24px' }}>
              <h3 style={{ margin: 0 }}>{w.nombre}</h3>
              <p style={{ margin: '4px 0', color: 'var(--text-secondary)', fontSize: 13 }}>{w.codigo} · {w.direccion || 'Sin dirección'}</p>
              <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
                <span style={{ fontSize: 13 }}>{w.metrosCuadrados}m²</span>
                <span style={{ fontSize: 13 }}>{w._count?.zones || 0} zonas</span>
                <span style={{ fontSize: 13 }}>{w._count?.locations || 0} ubicaciones</span>
              </div>
            </div></div>
          ))}
        </div>
      ) : (
        <div className="card"><div className="card-body" style={{ padding: 0 }}>
          <table className="data-table">
            <thead><tr><th>Código</th><th>Nombre</th><th>Almacén</th><th>Tipo</th><th>Temperatura</th><th>Ubicaciones</th></tr></thead>
            <tbody>
              {filtered.map((z: any, i: number) => (
                <tr key={i}>
                  <td><code>{z.codigo}</code></td><td style={{ fontWeight: 500 }}>{z.nombre}</td>
                  <td>{z.almacen?.nombre}</td>
                  <td><span className="badge badge-info">{z.tipoZona}</span></td>
                  <td>{z.temperatura}</td><td style={{ fontWeight: 600 }}>{z._count?.locations || 0}</td>
                </tr>
              ))}
              {filtered.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', padding: 40, color: 'var(--text-tertiary)' }}>Sin zonas</td></tr>}
            </tbody>
          </table>
        </div></div>
      )}
    </div>
  );
}
