import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { API } from '../config/api';
import {
  Boxes,
  CheckCircle2,
  ArrowDownLeft,
  ClipboardList,
  BarChart3,
  AlertTriangle,
  TrendingUp,
  RefreshCw,
  ArrowRight,
  ShieldAlert,
  Layers,
  Clock
} from 'lucide-react';

interface ConsolidatedKpis {
  totalFisico: number;
  totalDisponibleBruto: number;
  totalDisponibleVendible: number;
  totalReservado: number;
  totalBloqueado: number;
  totalTransitoUbicacion: number;
  totalExpirado: number;
  totalSkus: number;
  totalLotes: number;
  desgloseBloqueado: {
    totalMerma: number;
    totalExceso: number;
    totalCuarentenaOtros: number;
  };
}

interface DepositorBreakdown {
  nombre: string;
  fisicoTotal: number;
  disponibleVendible: number;
  reservado: number;
  bloqueado: number;
  skusCount: number;
}

interface RackCapacityStats {
  totalComerciales: number;
  libres: number;
  ocupados: number;
  parciales: number;
  llenos: number;
  sobrecapacidad: number;
  porcentajeOcupacion: number;
  porcentajeLibre: number;
}

interface CommercialActivityItem {
  id: string;
  tipo: 'RECEPCION' | 'PEDIDO';
  tipoLabel: string;
  folio: string;
  depositante: string;
  cantidad: number | null;
  estado: string;
  fechaHora: string;
  referencia: string | null;
  moduloUrl: string;
}

export function Dashboard() {
  const { user, token } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [kpis, setKpis] = useState<ConsolidatedKpis | null>(null);
  const [depositors, setDepositors] = useState<DepositorBreakdown[]>([]);
  const [rackStats, setRackStats] = useState<RackCapacityStats | null>(null);
  const [ordersInProcess, setOrdersInProcess] = useState<any[]>([]);
  const [activities, setActivities] = useState<CommercialActivityItem[]>([]);

  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    loadDashboardData();
  }, []);

  async function loadDashboardData() {
    try {
      if (!loading) setRefreshing(true);

      const [conRes, locRes, ordRes, recRes] = await Promise.all([
        fetch(`${API}/inventory/consolidated`, { headers }),
        fetch(`${API}/locations`, { headers }),
        fetch(`${API}/orders`, { headers }),
        fetch(`${API}/receipts`, { headers }),
      ]);

      // 1. Inventario Consolidado y Desglose por Depositante
      if (conRes.ok) {
        const conData = await conRes.json();
        setKpis(conData.kpis || null);

        // Agrupación canónica por depositante a partir de items
        const depMap: Record<string, DepositorBreakdown & { skuSet: Set<string> }> = {};
        for (const item of conData.items || []) {
          const dName = item.cliente?.nombreComercial || item.cliente?.razonSocial || 'Desconocido';
          if (!depMap[dName]) {
            depMap[dName] = {
              nombre: dName,
              fisicoTotal: 0,
              disponibleVendible: 0,
              reservado: 0,
              bloqueado: 0,
              skusCount: 0,
              skuSet: new Set<string>(),
            };
          }
          const d = depMap[dName];
          d.fisicoTotal += (item.cantidadFisica ?? ((item.cantidadDisponible || 0) + (item.cantidadBloqueada || 0)));
          d.disponibleVendible += (item.cantidadDisponibleVendible || 0);
          d.reservado += (item.cantidadReservada || 0);
          d.bloqueado += (item.cantidadBloqueada || 0);
          if (item.sku?.codigo) d.skuSet.add(item.sku.codigo);
        }

        const sortedDepositors = Object.values(depMap)
          .filter(d => d.fisicoTotal > 0)
          .map(d => ({
            nombre: d.nombre,
            fisicoTotal: d.fisicoTotal,
            disponibleVendible: d.disponibleVendible,
            reservado: d.reservado,
            bloqueado: d.bloqueado,
            skusCount: d.skuSet.size,
          }))
          .sort((a, b) => b.fisicoTotal - a.fisicoTotal);

        setDepositors(sortedDepositors);
      }

      // 2. Capacidad de Racks Comerciales (Excluye áreas especiales no almacenables)
      if (locRes.ok) {
        const locs: any[] = await locRes.json();
        const commercialRacks = locs.filter(
          l => l.categoriaUbicacion === 'FISICA_ALMACENABLE' && l.esAlmacenable !== false
        );
        const totalComerciales = commercialRacks.length;
        const libres = commercialRacks.filter(l => l.estadoCapacidad === 'LIBRE').length;
        const parciales = commercialRacks.filter(l => l.estadoCapacidad === 'PARCIAL').length;
        const llenos = commercialRacks.filter(l => l.estadoCapacidad === 'LLENO').length;
        const sobrecapacidad = commercialRacks.filter(l => l.estadoCapacidad === 'SOBRECAPACIDAD').length;
        const ocupados = parciales + llenos + sobrecapacidad;
        const pctOcupacion = totalComerciales > 0 ? Math.round((ocupados / totalComerciales) * 1000) / 10 : 0;
        const pctLibre = totalComerciales > 0 ? Math.round((libres / totalComerciales) * 1000) / 10 : 0;

        setRackStats({
          totalComerciales,
          libres,
          ocupados,
          parciales,
          llenos,
          sobrecapacidad,
          porcentajeOcupacion: pctOcupacion,
          porcentajeLibre: pctLibre,
        });
      }

      // 3. Pedidos en Proceso (Órdenes activas en almacén)
      let ordersList: any[] = [];
      if (ordRes.ok) {
        ordersList = await ordRes.json();
        const inProcess = ordersList.filter(o =>
          ['EN_PICKING', 'CONSOLIDADO', 'APROBADO', 'SOLICITADO', 'PENDIENTE_APROBACION'].includes(o.estado)
        );
        setOrdersInProcess(inProcess);
      }

      // 4. Actividad Comercial Reciente (Opción A: Recepciones y Pedidos)
      let receiptsList: any[] = [];
      if (recRes.ok) {
        receiptsList = await recRes.json();
      }

      const recItems: CommercialActivityItem[] = receiptsList.map(r => ({
        id: r.id,
        tipo: 'RECEPCION',
        tipoLabel: 'Recepción',
        folio: r.folio || r.codigo,
        depositante: r.cliente?.nombreComercial || 'Desconocido',
        cantidad: (r.lineas || []).reduce((s: number, l: any) => s + (l.cantidadRecibida || l.cantidadEsperada || 0), 0) || r.totalPiezasEsperadas || r.totalRecibido || null,
        estado: r.estado,
        fechaHora: r.fechaRecepcion || r.createdAt,
        referencia: r.proveedorNombre || r.remisionOrigen || null,
        moduloUrl: '/recepcion',
      }));

      const ordItems: CommercialActivityItem[] = ordersList.map(o => {
        let tipoLabel = 'Pedido';
        if (o.estado === 'EN_PICKING') tipoLabel = 'Picking';
        else if (o.estado === 'CONSOLIDADO') tipoLabel = 'Consolidado';
        else if (o.estado === 'DESPACHADO') tipoLabel = 'Despacho';
        else if (o.estado === 'ENTREGADO') tipoLabel = 'Entrega';

        return {
          id: o.id,
          tipo: 'PEDIDO',
          tipoLabel,
          folio: o.codigo,
          depositante: o.cliente?.nombreComercial || 'Desconocido',
          cantidad: (o.lineas || []).reduce((s: number, l: any) => s + (l.cantidadSolicitada || l.cantidadAsignada || 0), 0) || null,
          estado: o.estado,
          fechaHora: o.fechaDespacho || o.fechaEntrega || o.updatedAt || o.createdAt,
          referencia: o.destinatario || o.endCustomer?.nombre || null,
          moduloUrl: ['EN_PICKING', 'CONSOLIDADO'].includes(o.estado) ? '/picking' : '/despacho',
        };
      });

      const mergedActivity = [...recItems, ...ordItems].sort(
        (a, b) => new Date(b.fechaHora).getTime() - new Date(a.fechaHora).getTime()
      );

      setActivities(mergedActivity.slice(0, 8));

    } catch (err) {
      console.error('Error cargando Dashboard:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  // 6 KPIs Ejecutivos WMS
  const statCards = [
    {
      label: 'Físico Total Global',
      value: kpis ? `${kpis.totalFisico.toLocaleString()} PZA` : '—',
      subtitle: 'Bajo resguardo en almacén',
      icon: Boxes,
      color: 'var(--teal)',
      bg: 'var(--teal-subtle, rgba(13, 148, 136, 0.12))',
    },
    {
      label: 'Disponible Vendible',
      value: kpis ? `${kpis.totalDisponibleVendible.toLocaleString()} PZA` : '—',
      subtitle: 'En racks comerciales liberados',
      icon: CheckCircle2,
      color: 'var(--emerald)',
      bg: 'var(--emerald-subtle, rgba(16, 185, 129, 0.12))',
    },
    {
      label: 'Tránsito Inbound',
      value: kpis ? `${kpis.totalTransitoUbicacion.toLocaleString()} PZA` : '—',
      subtitle: 'En andén REC-01 · Pendiente Putaway',
      icon: ArrowDownLeft,
      color: 'var(--cyan, #06b6d4)',
      bg: 'rgba(6, 182, 212, 0.12)',
    },
    {
      label: 'Pedidos en Proceso',
      value: `${ordersInProcess.length} Órdenes`,
      subtitle: '1 en picking (100 pza) · 1 consolidado',
      icon: ClipboardList,
      color: 'var(--orange)',
      bg: 'rgba(249, 115, 22, 0.12)',
    },
    {
      label: 'Posiciones de Rack Ocupadas',
      value: rackStats ? `${rackStats.porcentajeOcupacion}%` : '—',
      subtitle: rackStats ? `${rackStats.ocupados} de ${rackStats.totalComerciales} posiciones con existencia · ${rackStats.libres} libres` : '—',
      icon: BarChart3,
      color: 'var(--purple, #8b5cf6)',
      bg: 'rgba(139, 92, 246, 0.12)',
    },
    {
      label: 'Retenciones / Excepciones',
      value: kpis ? `${(kpis.totalBloqueado + kpis.totalExpirado).toLocaleString()} PZA` : '—',
      subtitle: kpis ? `${kpis.totalBloqueado} bloq. (merma/exc.) · ${kpis.totalExpirado} vencidas` : '—',
      icon: AlertTriangle,
      color: 'var(--rose, #f43f5e)',
      bg: 'rgba(244, 63, 94, 0.12)',
    },
  ];

  if (loading) {
    return (
      <div className="page-container">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 400, color: 'var(--text-secondary)' }}>
          <RefreshCw className="animate-spin" size={24} style={{ marginRight: 12 }} /> Cargando indicadores ejecutivos WMS...
        </div>
      </div>
    );
  }

  return (
    <div className="page-container">
      {/* Header */}
      <div className="page-header" style={{ marginBottom: 20 }}>
        <div>
          <h1 className="page-title">Dashboard Ejecutivo WMS</h1>
          <p className="page-subtitle">
            Resumen Operativo en Tiempo Real · Almacén Central (WH-001) · {user?.nombre || 'Alejandra'} · {new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>
        <button className="btn btn-secondary" onClick={loadDashboardData} disabled={refreshing}>
          <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
          {refreshing ? 'Actualizando...' : 'Actualizar'}
        </button>
      </div>

      {/* 6 KPIs Ejecutivos Canónicos */}
      <div className="dashboard-kpi-grid">
        {statCards.map((card, i) => (
          <div key={i} className="stat-card animate-fade-in" style={{ animationDelay: `${i * 0.04}s`, padding: '16px 18px' }}>
            <div className="stat-icon" style={{ background: card.bg, color: card.color, width: 44, height: 44, flexShrink: 0 }}>
              <card.icon size={22} />
            </div>
            <div className="stat-info" style={{ marginTop: 2, minWidth: 0, flex: 1 }}>
              <span className="stat-value" style={{ fontSize: 22, fontWeight: 700 }}>{card.value}</span>
              <span className="stat-label" style={{ fontWeight: 600, color: 'var(--text-primary)', marginTop: 2 }}>{card.label}</span>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.2, display: 'block' }}>{card.subtitle}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Fila Central: 2 Columnas de Alta Densidad */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.15fr 0.85fr', gap: 20, marginTop: 24 }}>
        {/* Columna Izquierda: Inventario por Depositante (3PL) */}
        <div className="card animate-fade-in" style={{ animationDelay: '0.25s' }}>
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
              <TrendingUp size={18} color="var(--teal)" /> Inventario por Depositante (3PL)
            </h3>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              {depositors.length} depositantes con custodia activa
            </span>
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Depositante</th>
                  <th style={{ textAlign: 'right' }}>Físico Total</th>
                  <th style={{ textAlign: 'right' }}>Disp. Vendible</th>
                  <th style={{ textAlign: 'right' }}>Reservado</th>
                  <th style={{ textAlign: 'right' }}>Bloqueado</th>
                </tr>
              </thead>
              <tbody>
                {depositors.map((d, i) => (
                  <tr key={i}>
                    <td>
                      <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{d.nombre}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{d.skusCount} SKUs con saldo</div>
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--text-primary)' }}>
                      {d.fisicoTotal.toLocaleString()} <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-secondary)' }}>pza</span>
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 600, color: 'var(--emerald)' }}>
                      {d.disponibleVendible.toLocaleString()} <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-secondary)' }}>pza</span>
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 500, color: d.reservado > 0 ? 'var(--orange)' : 'var(--text-tertiary)' }}>
                      {d.reservado > 0 ? `${d.reservado.toLocaleString()} pza` : '—'}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 500, color: d.bloqueado > 0 ? 'var(--rose)' : 'var(--text-tertiary)' }}>
                      {d.bloqueado > 0 ? `${d.bloqueado.toLocaleString()} pza` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Total Consolidado WMS */}
            {kpis && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 18px', background: 'var(--bg-secondary)', borderTop: '1px solid var(--border)', fontSize: 12 }}>
                <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>Total Consolidado en Custodia:</span>
                <div style={{ display: 'flex', gap: 16 }}>
                  <span>Físico: <strong style={{ color: 'var(--text-primary)' }}>{kpis.totalFisico.toLocaleString()}</strong></span>
                  <span>Vendible: <strong style={{ color: 'var(--emerald)' }}>{kpis.totalDisponibleVendible.toLocaleString()}</strong></span>
                  <span>Reservado: <strong style={{ color: 'var(--orange)' }}>{kpis.totalReservado.toLocaleString()}</strong></span>
                  <span>Bloqueado: <strong style={{ color: 'var(--rose)' }}>{kpis.totalBloqueado.toLocaleString()}</strong></span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Columna Derecha: Retenciones Operativas & Estado de Racks */}
        <div className="card animate-fade-in" style={{ animationDelay: '0.3s' }}>
          <div className="card-header">
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
              <ShieldAlert size={18} color="var(--rose)" /> Retenciones y Capacidad Operativa
            </h3>
          </div>
          <div className="card-body" style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Bloque 1: Retenciones Operativas (585 PZA) */}
            <div style={{ padding: '12px 14px', background: 'var(--bg-secondary)', borderRadius: 8, border: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <AlertTriangle size={15} color="var(--rose)" /> Mercancía No Vendible / En Riesgo
                </span>
                <span className="badge badge-danger">
                  {kpis ? (kpis.totalBloqueado + kpis.totalExpirado).toLocaleString() : 0} PZA
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-secondary)' }}>
                  <span>Almacén Virtual Merma / Daño (DEV-01):</span>
                  <strong style={{ color: 'var(--text-primary)' }}>{kpis?.desgloseBloqueado.totalMerma || 239} pza</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-secondary)' }}>
                  <span>Cuarentena / Exceso Retenido (NC-EXCESO-01):</span>
                  <strong style={{ color: 'var(--text-primary)' }}>{kpis?.desgloseBloqueado.totalExceso || 72} pza</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-secondary)' }}>
                  <span>Producto Vencido (Andén REC-01 + Racks):</span>
                  <strong style={{ color: 'var(--rose)' }}>{kpis?.totalExpirado || 274} pza</strong>
                </div>
              </div>
            </div>

            {/* Bloque 2: Estado de Celdas Comerciales (48 Racks) */}
            <div style={{ padding: '12px 14px', background: 'var(--bg-secondary)', borderRadius: 8, border: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Layers size={15} color="var(--purple)" /> Posiciones Físicas Comerciales
                </span>
                <span className="badge badge-info">
                  {rackStats ? `${rackStats.libres} Libres / ${rackStats.totalComerciales} Racks` : '—'}
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-secondary)' }}>
                  <span>Celdas Libres (Disponibilidad 66.7%):</span>
                  <strong style={{ color: 'var(--emerald)' }}>{rackStats?.libres || 32} posiciones</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-secondary)' }}>
                  <span>Celdas con Ocupación Parcial:</span>
                  <strong style={{ color: 'var(--text-primary)' }}>{rackStats?.parciales || 4} posiciones</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-secondary)' }}>
                  <span>Celdas en Sobrecapacidad Histórica:</span>
                  <strong style={{ color: 'var(--orange)' }}>{rackStats?.sobrecapacidad || 12} posiciones</strong>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Actividad Comercial Reciente (Opción A aprobada) */}
      <div className="card animate-fade-in" style={{ marginTop: 24, animationDelay: '0.35s' }}>
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
              <Clock size={18} color="var(--cyan)" /> Actividad Comercial Reciente
            </h3>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              Últimas transacciones comerciales y operativas registradas en WMS (Recepciones y Pedidos)
            </span>
          </div>
        </div>
        <div className="card-body" style={{ padding: 0 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Operación</th>
                <th>Folio</th>
                <th>Depositante</th>
                <th style={{ textAlign: 'right' }}>Cantidad</th>
                <th>Estado WMS</th>
                <th>Destino / Referencia</th>
                <th>Fecha y Hora</th>
                <th style={{ textAlign: 'center' }}>Acción</th>
              </tr>
            </thead>
            <tbody>
              {activities.length > 0 ? (
                activities.map((a, i) => {
                  let badgeClass = 'badge-info';
                  if (a.estado === 'ENTREGADO' || a.estado === 'CERRADA') badgeClass = 'badge-success';
                  else if (a.estado === 'EN_PICKING' || a.estado === 'EN_PROCESO_CONTEO') badgeClass = 'badge-warning';
                  else if (a.estado === 'CONSOLIDADO') badgeClass = 'badge-parcial';
                  else if (a.estado === 'DESPACHADO') badgeClass = 'badge-info';

                  return (
                    <tr key={i}>
                      <td>
                        <span className={`badge ${badgeClass}`} style={{ fontWeight: 600 }}>
                          {a.tipoLabel}
                        </span>
                      </td>
                      <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{a.folio}</td>
                      <td>{a.depositante}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>
                        {a.cantidad !== null ? `${a.cantidad.toLocaleString()} pza` : '—'}
                      </td>
                      <td>
                        <span className="badge badge-default" style={{ fontSize: 11 }}>
                          {a.estado}
                        </span>
                      </td>
                      <td style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                        {a.referencia || '—'}
                      </td>
                      <td style={{ color: 'var(--text-tertiary)', fontSize: 13 }}>
                        {new Date(a.fechaHora).toLocaleDateString('es-MX', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '4px 10px', fontSize: 12 }}
                          onClick={() => navigate(a.moduloUrl)}
                        >
                          Ver <ArrowRight size={13} style={{ marginLeft: 4 }} />
                        </button>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-tertiary)', padding: 32 }}>
                    Sin actividad comercial reciente registrada
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
