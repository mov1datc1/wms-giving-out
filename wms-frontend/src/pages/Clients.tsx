import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { API } from '../config/api';
import {
  Users, Search, RefreshCw, Building2, Phone, Mail, MapPin, ChevronDown, ChevronUp,
  Plus, X, Settings2, Edit3, ShieldCheck, Package, Layers, Calendar, CheckCircle2,
  FileText, ArrowRight, Lock, Unlock, AlertTriangle, Trash2, Globe, ShieldAlert,
  Zap, Info, Shirt, Utensils, Pill, Factory, Cpu, Sparkles, RotateCcw
} from 'lucide-react';

interface ClientForm {
  id?: string;
  codigo: string;
  nombreComercial: string;
  razonSocial: string;
  rfc: string;
  giro: string;
  // Campos fiscales
  regimenFiscal: string;
  codigoPostal: string;
  pais: string;
  cfdiDefault: string;
  // Configuración operativa 3PL
  uomPrincipal: string;
  manejoInventario: string;
  reglaInventario: string;
  escaneoIndividual: boolean;
  requiereAprobacion: boolean;
  requiereLote: boolean;
  requiereSerie: boolean;
  requiereCaducidad: boolean;
  // Contacto & Portal
  telefono: string;
  email: string;
  contactoPrincipal: string;
  sitioWeb: string;
  ciudad: string;
  estado: string;
  colorPortal: string;
}

const DEFAULT_FORM: ClientForm = {
  codigo: '',
  nombreComercial: '',
  razonSocial: '',
  rfc: '',
  giro: 'ROPA',
  regimenFiscal: '601',
  codigoPostal: '',
  pais: 'México',
  cfdiDefault: 'G03',
  uomPrincipal: 'PZA',
  manejoInventario: 'PIEZA',
  reglaInventario: 'FIFO',
  escaneoIndividual: false,
  requiereAprobacion: true,
  requiereLote: false,
  requiereSerie: false,
  requiereCaducidad: false,
  telefono: '',
  email: '',
  contactoPrincipal: '',
  sitioWeb: '',
  ciudad: '',
  estado: '',
  colorPortal: '#0D9488',
};

export function getRulesByGiro(giro: string) {
  const g = giro?.toUpperCase();
  if (g === 'COMIDA' || g === 'ALIMENTOS') {
    return {
      requiereLote: true,
      requiereCaducidad: true,
      reglaInventario: 'FEFO',
      uomPrincipal: 'CAJA',
      manejoInventario: 'CAJA',
      descripcion: 'Alimentos / Perecederos: Exige control de Lote y Caducidad estricta (NOM-251 / COFEPRIS) con rotación FEFO (vence primero, sale primero).'
    };
  }
  if (g === 'FARMACEUTICO') {
    return {
      requiereLote: true,
      requiereCaducidad: true,
      reglaInventario: 'FEFO',
      uomPrincipal: 'PZA',
      manejoInventario: 'PIEZA',
      descripcion: 'Farma & Salud: Trazabilidad sanitaria rigurosa con Lote de Fabricación y Caducidad obligatoria, rotación FEFO y validación en andén.'
    };
  }
  if (g === 'MAQUILA') {
    return {
      requiereLote: true,
      requiereCaducidad: false,
      reglaInventario: 'FIFO',
      uomPrincipal: 'PZA',
      manejoInventario: 'PIEZA',
      descripcion: 'Maquila & Manufactura: Control de Lote de ensamble y número de parte para control de producción y garantías, rotación estándar FIFO.'
    };
  }
  if (g === 'ELECTRONICA') {
    return {
      requiereLote: true,
      requiereSerie: true,
      requiereCaducidad: false,
      reglaInventario: 'FIFO',
      uomPrincipal: 'PZA',
      manejoInventario: 'PIEZA',
      descripcion: 'Tecnología & Electrónica: Exige Lote y Número de Serie individual para rastreo de componentes y rotación FIFO.'
    };
  }
  if (g === 'COSMETICOS') {
    return {
      requiereLote: true,
      requiereCaducidad: true,
      reglaInventario: 'FEFO',
      uomPrincipal: 'PZA',
      manejoInventario: 'PIEZA',
      descripcion: 'Cosméticos & Cuidado Personal: Exige Lote de formulación y fecha de vencimiento con rotación FEFO.'
    };
  }
  return {
    requiereLote: false,
    requiereCaducidad: false,
    reglaInventario: 'FIFO',
    uomPrincipal: 'PZA',
    manejoInventario: 'PIEZA',
    descripcion: 'Ropa / Mercancía General: Rotación estándar FIFO por fecha de ingreso sin restricciones de caducidad.'
  };
}

export function Clients() {
  const { token, user } = useAuth();
  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterGiro, setFilterGiro] = useState('TODOS');
  const [filterActivo, setFilterActivo] = useState<'TODOS' | 'ACTIVOS' | 'INACTIVOS'>('ACTIVOS');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState<ClientForm>(DEFAULT_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [formMsg, setFormMsg] = useState({ type: '', text: '' });
  
  // Modal de confirmación de baja lógica (Botecito de Basura)
  const [clientToDelete, setClientToDelete] = useState<any | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Modal de confirmación de reactivación
  const [clientToReactivate, setClientToReactivate] = useState<any | null>(null);
  const [reactivating, setReactivating] = useState(false);

  // Candado de Roles (Subtarea 3 & 5) y Simulador Interactivo para validación
  const [simulatedRole, setSimulatedRole] = useState<'ADMIN' | 'OPERARIO'>('ADMIN');
  const effectiveRole = simulatedRole === 'OPERARIO' 
    ? 'Operario de Almacén' 
    : (user?.rolNombre || 'Administrador');
  const isOperator = effectiveRole.toLowerCase().includes('operador') || 
                     effectiveRole.toLowerCase().includes('operario') || 
                     effectiveRole.toLowerCase().includes('almacenista');
  const canEditRules = !isOperator; // En modo admin siempre está activo, bloqueado para operarios

  const headers: any = { 
    Authorization: `Bearer ${token}`, 
    'Content-Type': 'application/json',
    'x-user-role': effectiveRole,
  };

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    try {
      const res = await fetch(`${API}/clients`, { headers });
      if (res.ok) {
        const data = await res.json();
        setClients(data);
      } else {
        console.warn('No se pudo cargar /api/clients');
      }
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  }

  function handleOpenCreate() {
    setIsEditing(false);
    const initialGiro = 'ROPA';
    const rules = getRulesByGiro(initialGiro);
    setForm({
      ...DEFAULT_FORM,
      giro: initialGiro,
      requiereLote: rules.requiereLote,
      requiereCaducidad: rules.requiereCaducidad,
      reglaInventario: rules.reglaInventario,
      uomPrincipal: rules.uomPrincipal,
      manejoInventario: rules.manejoInventario,
    });
    setFormMsg({ type: '', text: '' });
    setShowModal(true);
  }

  function handleOpenEdit(client: any) {
    setIsEditing(true);
    setForm({
      id: client.id,
      codigo: client.codigo || '',
      nombreComercial: client.nombreComercial || '',
      razonSocial: client.razonSocial || '',
      rfc: client.rfc || '',
      giro: client.giro || 'ROPA',
      regimenFiscal: client.regimenFiscal || '601',
      codigoPostal: client.codigoPostal || '',
      pais: client.pais || 'México',
      cfdiDefault: client.cfdiDefault || 'G03',
      uomPrincipal: client.uomPrincipal || 'PZA',
      manejoInventario: client.manejoInventario || 'PIEZA',
      reglaInventario: client.reglaInventario || 'FIFO',
      escaneoIndividual: Boolean(client.escaneoIndividual),
      requiereAprobacion: client.requiereAprobacion !== false,
      requiereLote: Boolean(client.requiereLote),
      requiereSerie: Boolean(client.requiereSerie),
      requiereCaducidad: Boolean(client.requiereCaducidad),
      telefono: client.telefono || '',
      email: client.email || '',
      contactoPrincipal: client.contactoPrincipal || '',
      sitioWeb: client.sitioWeb || '',
      ciudad: client.ciudad || '',
      estado: client.estado || '',
      colorPortal: client.colorPortal || '#0D9488',
    });
    setFormMsg({ type: '', text: '' });
    setShowModal(true);
  }

  function handleGiroChange(newGiro: string) {
    if (!canEditRules) return; // Bloqueado para operarios
    const rules = getRulesByGiro(newGiro);
    setForm(f => ({
      ...f,
      giro: newGiro,
      requiereLote: rules.requiereLote,
      requiereCaducidad: rules.requiereCaducidad,
      reglaInventario: rules.reglaInventario,
      uomPrincipal: rules.uomPrincipal,
      manejoInventario: rules.manejoInventario,
      requiereSerie: (newGiro === 'ELECTRONICA'),
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormMsg({ type: '', text: '' });

    if (!form.codigo.trim() || !form.nombreComercial.trim() || !form.razonSocial.trim()) {
      setFormMsg({ type: 'error', text: 'Código único, nombre comercial y razón social son campos obligatorios.' });
      return;
    }

    setSubmitting(true);
    try {
      const url = isEditing && form.id ? `${API}/clients/${form.id}` : `${API}/clients`;
      const method = isEditing ? 'PUT' : 'POST';
      const res = await fetch(url, { 
        method, 
        headers, 
        body: JSON.stringify(form) 
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Error al procesar la solicitud.');
      }
      
      setFormMsg({ 
        type: 'success', 
        text: isEditing ? 'Parámetros operativos y fiscales actualizados correctamente.' : 'Depositante dado de alta exitosamente con reglas heredables.' 
      });
      loadData();
      setTimeout(() => { 
        setShowModal(false); 
        setFormMsg({ type: '', text: '' }); 
      }, 1200);
    } catch (err: any) {
      setFormMsg({ type: 'error', text: err.message });
    }
    setSubmitting(false);
  }

  async function handleConfirmDelete() {
    if (!clientToDelete) return;
    setDeleting(true);
    try {
      const res = await fetch(`${API}/clients/${clientToDelete.id}`, {
        method: 'DELETE',
        headers,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'No se pudo desactivar el depositante');
      
      loadData();
      setClientToDelete(null);
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    }
    setDeleting(false);
  }

  async function handleConfirmReactivate() {
    if (!clientToReactivate) return;
    setReactivating(true);
    try {
      const res = await fetch(`${API}/clients/${clientToReactivate.id}/reactivate`, {
        method: 'PUT',
        headers,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'No se pudo reactivar el depositante');
      
      loadData();
      setClientToReactivate(null);
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    }
    setReactivating(false);
  }

  const filtered = clients.filter(c => {
    const matchText = !search || 
      c.nombreComercial?.toLowerCase().includes(search.toLowerCase()) || 
      c.razonSocial?.toLowerCase().includes(search.toLowerCase()) || 
      c.codigo?.toLowerCase().includes(search.toLowerCase()) || 
      c.rfc?.toLowerCase().includes(search.toLowerCase());

    const matchGiro = filterGiro === 'TODOS' || c.giro === filterGiro;

    const matchActivo = 
      filterActivo === 'TODOS' ? true : 
      filterActivo === 'ACTIVOS' ? c.activo !== false : 
      c.activo === false;

    return matchText && matchGiro && matchActivo;
  });

  const activeRulesInfo = getRulesByGiro(form.giro);

  const totalActivos = clients.filter(c => c.activo !== false).length;
  const totalInactivos = clients.filter(c => c.activo === false).length;
  const totalTodos = clients.length;
  const totalSkusSum = clients.reduce((acc, c) => acc + (c.stats?.totalSkus ?? (c._count?.skus || 0)), 0);

  return (
    <div className="page-container stitch-page-dark" style={{ background: '#0B0F17', minHeight: '100vh', padding: '24px 32px', color: '#F8FAFC' }}>
      {/* Header Ejecutivo Dark CEDIS */}
      <div className="page-header" style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
            <h1 className="page-title" style={{ margin: 0, fontSize: 24, fontWeight: 800, color: '#F8FAFC', letterSpacing: '-0.01em' }}>
              Depositantes (Clientes 3PL)
            </h1>
            <span style={{
              fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 6,
              background: 'rgba(13, 148, 136, 0.15)', color: '#2DD4BF', border: '1px solid rgba(45, 212, 191, 0.3)'
            }}>
              SPRINT #1 · REGLAS HEREDABLES
            </span>
          </div>
          <p className="page-subtitle" style={{ margin: 0, color: '#94A3B8', fontSize: 13 }}>
            Administración del catálogo de depositantes, datos fiscales y configuración soberana de reglas de rotación (FIFO/FEFO) y trazabilidad por giro.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button 
            type="button"
            className="btn btn-primary" 
            onClick={handleOpenCreate}
            style={{ 
              display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 18px', 
              fontWeight: 700, background: '#0D9488', border: '1px solid #2DD4BF', color: '#FFFFFF',
              boxShadow: '0 4px 14px rgba(13, 148, 136, 0.35)', borderRadius: 8, cursor: 'pointer'
            }}
          >
            <Plus size={16} /> Nuevo Depositante
          </button>
          <button 
            type="button"
            className="btn btn-secondary" 
            onClick={loadData}
            style={{ 
              display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 16px',
              background: '#1E293B', border: '1px solid rgba(255, 255, 255, 0.12)', color: '#E2E8F0',
              borderRadius: 8, cursor: 'pointer', fontWeight: 600
            }}
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Actualizar
          </button>
        </div>
      </div>

      {/* TIRA DE 4 KPIS INDUSTRIALES WMS (IGUAL QUE RECEPCIÓN) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, marginBottom: 24 }}>
        {/* KPI 1: TOTAL DEPOSITANTES */}
        <div style={{ 
          background: 'linear-gradient(135deg, #0F172A 0%, rgba(13, 148, 136, 0.08) 100%)', 
          border: '1px solid rgba(45, 212, 191, 0.25)', 
          borderRadius: 12, padding: '16px 20px',
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#2DD4BF', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Building2 size={15} /> Total Depositantes
            </span>
            <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, background: 'rgba(13, 148, 136, 0.2)', color: '#2DD4BF' }}>
              3PL Multi-Cliente
            </span>
          </div>
          <div style={{ fontSize: 28, fontWeight: 800, color: '#F8FAFC', marginTop: 8 }}>
            {totalTodos} <span style={{ fontSize: 12, fontWeight: 500, color: '#94A3B8' }}>cuentas</span>
          </div>
        </div>

        {/* KPI 2: ACTIVOS EN OPERACIÓN */}
        <div style={{ 
          background: 'linear-gradient(135deg, #0F172A 0%, rgba(16, 185, 129, 0.08) 100%)', 
          border: '1px solid rgba(52, 211, 153, 0.25)', 
          borderRadius: 12, padding: '16px 20px',
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#34D399', display: 'flex', alignItems: 'center', gap: 6 }}>
              <CheckCircle2 size={15} /> Activos en Operación
            </span>
            <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, background: 'rgba(16, 185, 129, 0.2)', color: '#34D399' }}>
              100% Operativos
            </span>
          </div>
          <div style={{ fontSize: 28, fontWeight: 800, color: '#34D399', marginTop: 8 }}>
            {totalActivos} <span style={{ fontSize: 12, fontWeight: 500, color: '#94A3B8' }}>clientes</span>
          </div>
        </div>

        {/* KPI 3: CATÁLOGO DE SKUS TOTAL */}
        <div style={{ 
          background: 'linear-gradient(135deg, #0F172A 0%, rgba(56, 189, 248, 0.08) 100%)', 
          border: '1px solid rgba(56, 189, 248, 0.25)', 
          borderRadius: 12, padding: '16px 20px',
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#38BDF8', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Package size={15} /> Catálogo de SKUs
            </span>
            <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, background: 'rgba(56, 189, 248, 0.2)', color: '#38BDF8' }}>
              Registrados
            </span>
          </div>
          <div style={{ fontSize: 28, fontWeight: 800, color: '#38BDF8', marginTop: 8 }}>
            {totalSkusSum.toLocaleString()} <span style={{ fontSize: 12, fontWeight: 500, color: '#94A3B8' }}>partidas</span>
          </div>
        </div>

        {/* KPI 4: INACTIVOS / RESGUARDO */}
        <div style={{ 
          background: 'linear-gradient(135deg, #0F172A 0%, rgba(148, 163, 184, 0.05) 100%)', 
          border: totalInactivos > 0 ? '1px solid rgba(248, 113, 113, 0.3)' : '1px solid rgba(148, 163, 184, 0.2)', 
          borderRadius: 12, padding: '16px 20px',
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: totalInactivos > 0 ? '#F87171' : '#94A3B8', display: 'flex', alignItems: 'center', gap: 6 }}>
              <ShieldAlert size={15} /> Inactivos / Resguardo
            </span>
            <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, background: totalInactivos > 0 ? 'rgba(239, 68, 68, 0.2)' : 'rgba(148, 163, 184, 0.15)', color: totalInactivos > 0 ? '#F87171' : '#94A3B8' }}>
              Baja Lógica
            </span>
          </div>
          <div style={{ fontSize: 28, fontWeight: 800, color: totalInactivos > 0 ? '#F87171' : '#94A3B8', marginTop: 8 }}>
            {totalInactivos} <span style={{ fontSize: 12, fontWeight: 500, color: '#94A3B8' }}>en resguardo</span>
          </div>
        </div>
      </div>

      {/* BARRA DE BÚSQUEDA Y FILTROS REACTIVOS DARK */}
      <div style={{ 
        background: '#0F172A', 
        border: '1px solid rgba(255, 255, 255, 0.08)', 
        borderRadius: 12, 
        padding: '16px 20px', 
        marginBottom: 24,
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.25)'
      }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
          
          <div style={{ display: 'flex', gap: 12, flex: 1, minWidth: 320, alignItems: 'center' }}>
            {/* Filtro por Giro Comercial (A la izquierda) */}
            <div style={{ minWidth: 190, width: 200, flexShrink: 0 }}>
              <select 
                className="form-select" 
                style={{ 
                  width: '100%',
                  padding: '9px 14px', fontSize: 13, background: '#1E293B', 
                  color: '#F8FAFC', border: '1px solid rgba(255, 255, 255, 0.14)', 
                  borderRadius: 8, height: 42, cursor: 'pointer'
                }}
                value={filterGiro} 
                onChange={e => setFilterGiro(e.target.value)}
              >
                <option value="TODOS">Todos los giros</option>
                <option value="ROPA">Ropa & Textil</option>
                <option value="COMIDA">Alimentos & Bebidas</option>
                <option value="FARMACEUTICO">Farmacéutico & Salud</option>
                <option value="MAQUILA">Maquila & Manufactura</option>
                <option value="ELECTRONICA">Electrónica & Tecnología</option>
                <option value="COSMETICOS">Cosméticos & Belleza</option>
                <option value="GENERAL">Mercancía General</option>
              </select>
            </div>

            {/* Buscador Principal Amplio (Donde estaba Todos los Giros, con width 100% para evitar que se comprima) */}
            <div style={{ position: 'relative', flex: 1, minWidth: 260 }}>
              <Search size={16} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#2DD4BF', pointerEvents: 'none' }} />
              <input 
                type="text"
                className="form-input" 
                placeholder="Buscar por nombre comercial, razón social, código o RFC..." 
                value={search} 
                onChange={e => setSearch(e.target.value)} 
                style={{ 
                  width: '100%',
                  boxSizing: 'border-box',
                  paddingLeft: 42, 
                  paddingRight: search ? 36 : 14,
                  background: '#1E293B', 
                  border: '1px solid rgba(255, 255, 255, 0.14)', 
                  color: '#F8FAFC', 
                  borderRadius: 8, 
                  height: 42, 
                  fontSize: 13 
                }}
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: '#94A3B8', cursor: 'pointer', display: 'flex', padding: 4 }}
                  title="Limpiar búsqueda"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </div>

          {/* Filtro de Estatus Activo con Contadores de Alto Contraste */}
          <div style={{
            display: 'inline-flex',
            background: '#070B11',
            padding: 4,
            borderRadius: 10,
            border: '1px solid rgba(255, 255, 255, 0.1)',
            gap: 4
          }}>
            {([
              { key: 'ACTIVOS', label: 'Activos', count: totalActivos },
              { key: 'TODOS', label: 'Todos', count: totalTodos },
              { key: 'INACTIVOS', label: 'Inactivos', count: totalInactivos },
            ] as const).map(tab => {
              const isSelected = filterActivo === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setFilterActivo(tab.key)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '7px 15px',
                    fontSize: 12,
                    fontWeight: 700,
                    borderRadius: 7,
                    border: 'none',
                    cursor: 'pointer',
                    background: isSelected ? '#0D9488' : 'transparent',
                    color: isSelected ? '#FFFFFF' : '#94A3B8',
                    boxShadow: isSelected ? '0 2px 8px rgba(13, 148, 136, 0.4)' : 'none',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <span>{tab.label}</span>
                  <span style={{
                    fontSize: 11,
                    fontWeight: 800,
                    padding: '2px 7px',
                    borderRadius: 10,
                    background: isSelected ? 'rgba(255, 255, 255, 0.25)' : 'rgba(255, 255, 255, 0.08)',
                    color: isSelected ? '#FFFFFF' : '#94A3B8'
                  }}>
                    {tab.count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* LISTADO DE DEPOSITANTES EN TARJETAS INDUSTRIALES DARK */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '80px 20px', color: '#94A3B8' }}>
          <RefreshCw className="animate-spin" size={32} style={{ margin: '0 auto 12px', color: '#2DD4BF' }} />
          <div style={{ fontSize: 14, fontWeight: 600, color: '#F8FAFC' }}>Sincronizando catálogo de depositantes con Supabase...</div>
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ 
          background: '#0F172A', 
          textAlign: 'center', 
          padding: '60px 20px', 
          border: '1px dashed rgba(255, 255, 255, 0.15)', 
          borderRadius: 14 
        }}>
          <Building2 size={48} style={{ margin: '0 auto 14px', color: '#64748B', opacity: 0.6 }} />
          <h3 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 6px', color: '#F8FAFC' }}>
            {filterActivo === 'INACTIVOS' 
              ? 'No hay depositantes inactivos' 
              : search 
              ? `Sin resultados para "${search}"`
              : 'No se encontraron depositantes'}
          </h3>
          <p style={{ fontSize: 13, margin: 0, color: '#94A3B8' }}>
            {filterActivo === 'INACTIVOS'
              ? 'Todos tus depositantes se encuentran activos para operaciones en el WMS.'
              : search
              ? 'Verifica la ortografía o intenta buscar por RFC o código 3PL.'
              : 'Registra un nuevo cliente 3PL o ajusta los filtros seleccionados.'}
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          {filtered.map((c, i) => {
            // Asignación de color según giro (idéntico a Recepción)
            const industryColor = c.activo === false 
              ? '#64748B' 
              : c.giro === 'COMIDA' ? '#F59E0B' 
              : c.giro === 'FARMACEUTICO' ? '#A855F7' 
              : c.giro === 'MAQUILA' ? '#3B82F6' 
              : c.giro === 'ELECTRONICA' ? '#06B6D4'
              : c.giro === 'COSMETICOS' ? '#EC4899'
              : '#10B981';

            return (
              <div 
                key={c.id} 
                className="animate-fade-in" 
                style={{ 
                  animationDelay: `${i * 0.03}s`,
                  background: '#0F172A',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  borderLeft: `4px solid ${industryColor}`,
                  borderRadius: 12,
                  boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)',
                  opacity: c.activo === false ? 0.75 : 1,
                  transition: 'all 0.2s ease',
                  overflow: 'hidden'
                }}
              >
                <div style={{ padding: '20px 24px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
                    
                    {/* Info Principal */}
                    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                      <div style={{ 
                        width: 48, height: 48, borderRadius: 10, 
                        background: c.activo === false ? 'rgba(100, 116, 139, 0.15)' : 'rgba(13, 148, 136, 0.15)', 
                        border: `1px solid ${c.activo === false ? 'rgba(100, 116, 139, 0.3)' : 'rgba(45, 212, 191, 0.3)'}`, 
                        display: 'flex', alignItems: 'center', justifyContent: 'center', 
                        color: c.activo === false ? '#94A3B8' : '#2DD4BF',
                        flexShrink: 0
                      }}>
                        <Building2 size={24} />
                      </div>

                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#F8FAFC' }}>
                            {c.nombreComercial}
                          </h3>
                          <span style={{ 
                            fontSize: 12, color: '#38BDF8', fontFamily: 'monospace', fontWeight: 700, 
                            background: '#1E293B', padding: '2px 8px', borderRadius: 4, 
                            border: '1px solid rgba(56, 189, 248, 0.25)' 
                          }}>
                            {c.codigo}
                          </span>
                          {c.activo === false && (
                            <span style={{ 
                              fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4, 
                              background: 'rgba(239, 68, 68, 0.15)', color: '#F87171', border: '1px solid rgba(239, 68, 68, 0.3)' 
                            }}>
                              INACTIVO
                            </span>
                          )}
                        </div>

                        <p style={{ margin: '4px 0 8px', fontSize: 13, color: '#94A3B8' }}>
                          {c.razonSocial}
                        </p>
                        
                        {/* Badges de Reglas Operativas Heredables Dark */}
                        <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                          <span style={{ 
                            fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 6,
                            background: 'rgba(56, 189, 248, 0.12)', color: '#38BDF8', border: '1px solid rgba(56, 189, 248, 0.25)' 
                          }}>
                            Giro: {c.giro || 'GENERAL'}
                          </span>
                          <span style={{ 
                            fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 6,
                            background: c.reglaInventario === 'FEFO' ? 'rgba(245, 158, 11, 0.15)' : 'rgba(16, 185, 129, 0.15)', 
                            color: c.reglaInventario === 'FEFO' ? '#FBBF24' : '#34D399', 
                            border: `1px solid ${c.reglaInventario === 'FEFO' ? 'rgba(245, 158, 11, 0.3)' : 'rgba(16, 185, 129, 0.3)'}` 
                          }}>
                            Rotación: {c.reglaInventario || 'FIFO'}
                          </span>
                          <span style={{ 
                            fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 6,
                            background: '#1E293B', color: '#CBD5E1', border: '1px solid rgba(255, 255, 255, 0.08)' 
                          }}>
                            UoM: {c.uomPrincipal || 'PZA'} ({c.manejoInventario || 'PIEZA'})
                          </span>

                          {c.requiereLote && (
                            <span style={{ 
                              display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, 
                              padding: '3px 8px', borderRadius: 6, background: 'rgba(245, 158, 11, 0.15)', 
                              color: '#FBBF24', border: '1px solid rgba(245, 158, 11, 0.3)' 
                            }}>
                              <Zap size={11} /> Lote Obligatorio
                            </span>
                          )}

                          {c.requiereCaducidad && (
                            <span style={{ 
                              display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, 
                              padding: '3px 8px', borderRadius: 6, background: 'rgba(239, 68, 68, 0.15)', 
                              color: '#F87171', border: '1px solid rgba(239, 68, 68, 0.3)' 
                            }}>
                              <ShieldAlert size={11} /> Caducidad Obligatoria
                            </span>
                          )}

                          {c.requiereSerie && (
                            <span style={{ 
                              fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 6, 
                              background: 'rgba(59, 130, 246, 0.15)', color: '#60A5FA', border: '1px solid rgba(59, 130, 246, 0.3)' 
                            }}>
                              Serie 1x1
                            </span>
                          )}

                          {c.rfc && (
                            <span style={{ 
                              fontSize: 11, color: '#94A3B8', fontFamily: 'monospace', 
                              background: '#1E293B', padding: '3px 8px', borderRadius: 6, border: '1px solid rgba(255, 255, 255, 0.06)' 
                            }}>
                              RFC: {c.rfc}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Métricas y Acciones Dark */}
                    <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                      <div style={{ textAlign: 'center', minWidth: 46 }}>
                        <div style={{ fontSize: 20, fontWeight: 800, color: '#2DD4BF' }}>
                          {c.stats?.totalSkus ?? (c._count?.skus || 0)}
                        </div>
                        <div style={{ fontSize: 11, color: '#94A3B8', fontWeight: 600 }}>SKUs</div>
                      </div>

                      <div style={{ textAlign: 'center', minWidth: 46 }}>
                        <div style={{ fontSize: 20, fontWeight: 800, color: '#818CF8' }}>
                          {c.stats?.totalClientesFinales ?? (c._count?.endCustomers || 0)}
                        </div>
                        <div style={{ fontSize: 11, color: '#94A3B8', fontWeight: 600 }}>Ship-To</div>
                      </div>

                      <div style={{ textAlign: 'center', minWidth: 46 }}>
                        <div style={{ fontSize: 20, fontWeight: 800, color: '#38BDF8' }}>
                          {c.stats?.totalRecepciones ?? (c._count?.recepciones || 0)}
                        </div>
                        <div style={{ fontSize: 11, color: '#94A3B8', fontWeight: 600 }}>Previos</div>
                      </div>

                      {/* Botón Editar Parámetros */}
                      <button 
                        type="button"
                        className="btn btn-secondary btn-sm" 
                        onClick={() => handleOpenEdit(c)}
                        style={{ 
                          display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, 
                          padding: '8px 14px', background: '#1E293B', border: '1px solid rgba(255, 255, 255, 0.12)', 
                          color: '#F8FAFC', borderRadius: 6, cursor: 'pointer' 
                        }}
                      >
                        <Settings2 size={14} style={{ color: '#2DD4BF' }} /> {canEditRules ? 'Editar Parámetros' : 'Ver Parámetros'}
                      </button>

                      {/* BOTECITO DE BASURA PROMINENTE Y ACCESIBLE (SUBTAREA 2) */}
                      {c.activo !== false ? (
                        <button 
                          type="button"
                          className="btn btn-sm" 
                          onClick={() => setClientToDelete(c)}
                          title="Desactivar este depositante (Baja lógica segura)"
                          style={{ 
                            display: 'inline-flex', 
                            alignItems: 'center', 
                            gap: 5, 
                            fontSize: 12, 
                            fontWeight: 600, 
                            padding: '8px 12px',
                            background: 'rgba(239, 68, 68, 0.12)',
                            color: '#F87171',
                            border: '1px solid rgba(239, 68, 68, 0.35)',
                            borderRadius: 6,
                            cursor: 'pointer',
                            transition: 'all 0.15s ease'
                          }}
                        >
                          <Trash2 size={14} /> Desactivar
                        </button>
                      ) : (
                        <button 
                          type="button"
                          className="btn btn-sm" 
                          onClick={() => setClientToReactivate(c)}
                          title="Reactivar este depositante para operaciones activas"
                          style={{ 
                            display: 'inline-flex', 
                            alignItems: 'center', 
                            gap: 5, 
                            fontSize: 12, 
                            fontWeight: 600, 
                            padding: '8px 12px',
                            background: 'rgba(16, 185, 129, 0.12)',
                            color: '#34D399',
                            border: '1px solid rgba(16, 185, 129, 0.35)',
                            borderRadius: 6,
                            cursor: 'pointer',
                            transition: 'all 0.15s ease'
                          }}
                        >
                          <RotateCcw size={14} /> Reactivar
                        </button>
                      )}

                      {/* Expandir Accordion */}
                      <button 
                        type="button"
                        className="btn btn-ghost btn-sm" 
                        onClick={() => setExpanded(expanded === c.id ? null : c.id)}
                        style={{ padding: 8, color: '#94A3B8', background: 'transparent', border: 'none', cursor: 'pointer' }}
                        title={expanded === c.id ? 'Contraer ficha técnica' : 'Expandir ficha técnica'}
                      >
                        {expanded === c.id ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                      </button>
                    </div>
                  </div>

                  {/* Datos de contacto y ubicación rápida Dark */}
                  <div style={{ display: 'flex', gap: 20, marginTop: 14, flexWrap: 'wrap', fontSize: 12, color: '#94A3B8' }}>
                    {c.telefono && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <Phone size={13} style={{ color: '#2DD4BF' }} /> {c.telefono}
                      </span>
                    )}
                    {c.email && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <Mail size={13} style={{ color: '#2DD4BF' }} /> {c.email}
                      </span>
                    )}
                    {(c.ciudad || c.estado) && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <MapPin size={13} style={{ color: '#2DD4BF' }} /> {c.ciudad}{c.ciudad && c.estado ? ', ' : ''}{c.estado} ({c.pais || 'México'})
                      </span>
                    )}
                    {c.sitioWeb && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <Globe size={13} style={{ color: '#2DD4BF' }} /> 
                        <a href={c.sitioWeb} target="_blank" rel="noreferrer" style={{ color: '#38BDF8', textDecoration: 'none' }}>
                          {c.sitioWeb.replace(/^https?:\/\//, '')}
                        </a>
                      </span>
                    )}
                  </div>

                  {/* Sección Expandida con Ficha Técnica 3PL Dark */}
                  {expanded === c.id && (
                    <div style={{ 
                      marginTop: 18, padding: '18px 20px', 
                      background: '#070B11', borderRadius: 10, 
                      border: '1px solid rgba(255, 255, 255, 0.08)' 
                    }}>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 20 }}>
                        
                        {/* Datos Fiscales */}
                        <div>
                          <h4 style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 700, color: '#2DD4BF', display: 'flex', alignItems: 'center', gap: 6 }}>
                            <FileText size={14} /> Ficha Fiscal SAT
                          </h4>
                          <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '6px 8px', fontSize: 12 }}>
                            <span style={{ color: '#94A3B8' }}>Régimen Fiscal:</span>
                            <strong style={{ color: '#F8FAFC' }}>{c.regimenFiscal || '601 (General de Ley)'}</strong>
                            <span style={{ color: '#94A3B8' }}>Uso CFDI Defecto:</span>
                            <strong style={{ color: '#F8FAFC' }}>{c.cfdiDefault || 'G03 (Gastos en general)'}</strong>
                            <span style={{ color: '#94A3B8' }}>Código Postal:</span>
                            <strong style={{ color: '#F8FAFC' }}>{c.codigoPostal || 'No registrado'}</strong>
                            <span style={{ color: '#94A3B8' }}>Dirección Fiscal:</span>
                            <span style={{ color: '#CBD5E1' }}>{c.direccionFiscal || 'No registrada'}</span>
                          </div>
                        </div>

                        {/* Reglas de Rotación e Inventario */}
                        <div>
                          <h4 style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 700, color: '#2DD4BF', display: 'flex', alignItems: 'center', gap: 6 }}>
                            <Settings2 size={14} /> Reglas Operativas 3PL (Heredadas)
                          </h4>
                          <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr', gap: '6px 8px', fontSize: 12 }}>
                            <span style={{ color: '#94A3B8' }}>Método de Rotación:</span>
                            <strong style={{ color: c.reglaInventario === 'FEFO' ? '#FBBF24' : '#34D399' }}>
                              {c.reglaInventario || 'FIFO'}
                            </strong>
                            <span style={{ color: '#94A3B8' }}>Lote Obligatorio:</span>
                            <strong style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#F8FAFC' }}>
                              {c.requiereLote ? <><CheckCircle2 size={13} style={{ color: '#34D399' }} /> Sí (NOM-251)</> : <><X size={13} style={{ color: '#94A3B8' }} /> No</>}
                            </strong>
                            <span style={{ color: '#94A3B8' }}>Caducidad Obligatoria:</span>
                            <strong style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#F8FAFC' }}>
                              {c.requiereCaducidad ? <><CheckCircle2 size={13} style={{ color: '#34D399' }} /> Sí (COFEPRIS/FDA)</> : <><X size={13} style={{ color: '#94A3B8' }} /> No</>}
                            </strong>
                            <span style={{ color: '#94A3B8' }}>Manejo Almacén:</span>
                            <strong style={{ color: '#F8FAFC' }}>{c.uomPrincipal} ({c.manejoInventario})</strong>
                            <span style={{ color: '#94A3B8' }}>Escaneo Unitario:</span>
                            <strong style={{ color: '#F8FAFC' }}>{c.escaneoIndividual ? 'Sí (1 a 1)' : 'Global por contenedor'}</strong>
                          </div>
                        </div>

                        {/* Contactos & Destinos */}
                        <div>
                          <h4 style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 700, color: '#2DD4BF', display: 'flex', alignItems: 'center', gap: 6 }}>
                            <Users size={14} /> Contactos y Destinos
                          </h4>
                          <div style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                            <div>
                              <span style={{ color: '#94A3B8' }}>Contacto Operativo: </span>
                              <strong style={{ color: '#F8FAFC' }}>{c.contactoPrincipal || 'No asignado'}</strong>
                            </div>
                            <div>
                              <span style={{ color: '#94A3B8' }}>Clientes Finales (Ship-To): </span>
                              <strong style={{ color: '#818CF8' }}>{c._count?.endCustomers || 0} registrados</strong>
                            </div>
                            <div>
                              <span style={{ color: '#94A3B8' }}>Lotes Físicos en Racks: </span>
                              <strong style={{ color: '#38BDF8' }}>{c._count?.lotes || 0} lotes</strong>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* MODAL DE ALTA / EDICIÓN CON CANDADO RBAC (DISEÑO PROFESIONAL DARK CEDIS) */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)} style={{ background: 'rgba(2, 6, 23, 0.85)', backdropFilter: 'blur(10px)', zIndex: 1100 }}>
          <div 
            className="modal-content animate-scale-in" 
            onClick={e => e.stopPropagation()} 
            style={{ 
              maxWidth: 840, width: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column',
              background: '#0F172A', border: '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: 16, boxShadow: '0 25px 60px -12px rgba(0, 0, 0, 0.85)',
              overflow: 'hidden'
            }}
          >
            {/* Header del Modal */}
            <div style={{ padding: '20px 24px', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ 
                  width: 42, height: 42, borderRadius: 10, 
                  background: isEditing ? 'rgba(59, 130, 246, 0.15)' : 'rgba(13, 148, 136, 0.15)', 
                  border: `1px solid ${isEditing ? 'rgba(59, 130, 246, 0.3)' : 'rgba(45, 212, 191, 0.3)'}`,
                  color: isEditing ? '#38BDF8' : '#2DD4BF', 
                  display: 'flex', alignItems: 'center', justifyContent: 'center' 
                }}>
                  {isEditing ? <Settings2 size={22} /> : <Building2 size={22} />}
                </div>
                <div>
                  <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#F8FAFC', letterSpacing: '-0.01em' }}>
                    {isEditing ? `Configuración del Depositante — ${form.nombreComercial}` : 'Registrar Nuevo Depositante (Cliente 3PL)'}
                  </h2>
                  <p style={{ margin: '2px 0 0', fontSize: 12, color: '#94A3B8' }}>
                    {isEditing 
                      ? 'Las reglas operativas aquí configuradas se heredarán automáticamente en previas, andén y órdenes de salida.'
                      : 'Define el perfil fiscal y las reglas fijas de inventario para automatizar los candados en andén.'}
                  </p>
                </div>
              </div>

              <button 
                type="button"
                className="btn btn-ghost btn-sm" 
                onClick={() => setShowModal(false)}
                style={{ background: 'transparent', border: 'none', color: '#94A3B8', cursor: 'pointer', padding: 6, display: 'flex' }}
              >
                <X size={20} />
              </button>
            </div>

            {/* Formulario */}
            <form onSubmit={handleSubmit} style={{ overflowY: 'auto', padding: '20px 24px', flex: 1 }}>
              
              {/* BARRA EJECUTIVA DE CONTROL RBAC & SIMULADOR DE ROLES (SUBTAREA 5) */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 12,
                padding: '12px 16px',
                background: simulatedRole === 'OPERARIO' ? 'rgba(239, 68, 68, 0.12)' : 'rgba(13, 148, 136, 0.12)',
                borderRadius: 10,
                border: `1px solid ${simulatedRole === 'OPERARIO' ? 'rgba(239, 68, 68, 0.3)' : 'rgba(45, 212, 191, 0.3)'}`,
                marginBottom: 20,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{
                    width: 34, height: 34, borderRadius: 8,
                    background: simulatedRole === 'OPERARIO' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(13, 148, 136, 0.2)',
                    color: simulatedRole === 'OPERARIO' ? '#F87171' : '#2DD4BF',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0
                  }}>
                    {simulatedRole === 'OPERARIO' ? <Lock size={18} /> : <ShieldCheck size={18} />}
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#F8FAFC' }}>
                      {simulatedRole === 'OPERARIO' 
                        ? 'Candado de Seguridad RBAC Activo — Vista de Operario de Almacén' 
                        : 'Privilegios de Alta Seguridad — Perfil Super Administrador'}
                    </div>
                    <div style={{ fontSize: 12, color: '#94A3B8' }}>
                      {simulatedRole === 'OPERARIO'
                        ? 'Las reglas operativas 3PL (FEFO/FIFO, Lote, Caducidad) están bloqueadas contra modificaciones en piso.'
                        : 'Tienes autorización soberana para crear clientes, fijar reglas de negocio y autorizar parámetros.'}
                    </div>
                  </div>
                </div>

                {/* Control Segmentado de Rol */}
                <div style={{
                  display: 'inline-flex',
                  background: '#070B11',
                  padding: 3,
                  borderRadius: 8,
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.4)'
                }}>
                  <button
                    type="button"
                    onClick={() => setSimulatedRole('ADMIN')}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '6px 13px',
                      fontSize: 12,
                      fontWeight: 700,
                      borderRadius: 6,
                      border: 'none',
                      cursor: 'pointer',
                      background: simulatedRole === 'ADMIN' ? '#0D9488' : 'transparent',
                      color: simulatedRole === 'ADMIN' ? '#FFFFFF' : '#94A3B8',
                      boxShadow: simulatedRole === 'ADMIN' ? '0 1px 3px rgba(13, 148, 136, 0.35)' : 'none',
                      transition: 'all 0.15s ease',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    <ShieldCheck size={14} /> Administrador (Tú)
                  </button>
                  <button
                    type="button"
                    onClick={() => setSimulatedRole('OPERARIO')}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '6px 13px',
                      fontSize: 12,
                      fontWeight: 700,
                      borderRadius: 6,
                      border: 'none',
                      cursor: 'pointer',
                      background: simulatedRole === 'OPERARIO' ? '#DC2626' : 'transparent',
                      color: simulatedRole === 'OPERARIO' ? '#FFFFFF' : '#94A3B8',
                      boxShadow: simulatedRole === 'OPERARIO' ? '0 1px 3px rgba(220, 38, 38, 0.35)' : 'none',
                      transition: 'all 0.15s ease',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    <Lock size={14} /> Probar como Operario
                  </button>
                </div>
              </div>

              {/* SECCIÓN 1: DATOS GENERALES & FISCALES */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#2DD4BF', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Building2 size={15} /> 1. Identificación y Datos Fiscales SAT
                </div>

                <div className="form-row">
                  <div className="form-group" style={{ flex: 1 }}>
                    <label className="form-label" style={{ color: '#E2E8F0', fontWeight: 600 }}>
                      Código Único 3PL <span className="required" style={{ color: '#F87171' }}>*</span>
                    </label>
                    <input 
                      className="form-input" 
                      placeholder="DEP-ALIMENTOS-01" 
                      value={form.codigo} 
                      onChange={e => setForm(f => ({ ...f, codigo: e.target.value.toUpperCase() }))} 
                      disabled={isEditing || !canEditRules}
                      required 
                      style={{ background: '#1E293B', borderColor: 'rgba(255, 255, 255, 0.14)', color: '#F8FAFC' }}
                    />
                  </div>

                  <div className="form-group" style={{ flex: 2 }}>
                    <label className="form-label" style={{ color: '#E2E8F0', fontWeight: 600 }}>
                      Nombre Comercial <span className="required" style={{ color: '#F87171' }}>*</span>
                    </label>
                    <input 
                      className="form-input" 
                      placeholder="Ej. Alimentos del Norte" 
                      value={form.nombreComercial} 
                      onChange={e => setForm(f => ({ ...f, nombreComercial: e.target.value }))} 
                      required 
                      style={{ background: '#1E293B', borderColor: 'rgba(255, 255, 255, 0.14)', color: '#F8FAFC' }}
                    />
                  </div>

                  <div className="form-group" style={{ flex: 1.5 }}>
                    <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#E2E8F0', fontWeight: 600 }}>
                      Giro Comercial <span className="required" style={{ color: '#F87171' }}>*</span>
                      {!canEditRules && <Lock size={12} style={{ color: '#F87171' }} />}
                    </label>
                    <select 
                      className="form-select form-select-full" 
                      value={form.giro} 
                      disabled={!canEditRules}
                      onChange={e => handleGiroChange(e.target.value)}
                      style={{ background: '#1E293B', borderColor: 'rgba(255, 255, 255, 0.14)', color: '#F8FAFC' }}
                    >
                      <option value="ROPA">Ropa & Textil</option>
                      <option value="COMIDA">Alimentos & Bebidas (Perecedero)</option>
                      <option value="FARMACEUTICO">Farmacéutico & Salud</option>
                      <option value="MAQUILA">Maquila & Manufactura</option>
                      <option value="ELECTRONICA">Electrónica & Tecnología</option>
                      <option value="COSMETICOS">Cosméticos & Belleza</option>
                      <option value="GENERAL">Mercancía General</option>
                    </select>
                  </div>
                </div>

                {/* Banner de Ayuda por Giro Dark */}
                <div style={{
                  padding: '12px 14px', borderRadius: 8,
                  background: 'rgba(13, 148, 136, 0.08)', border: '1px solid rgba(13, 148, 136, 0.25)',
                  fontSize: 12, color: '#CBD5E1', marginBottom: 14,
                  display: 'flex', alignItems: 'flex-start', gap: 8
                }}>
                  <Info size={16} style={{ color: '#2DD4BF', flexShrink: 0, marginTop: 1 }} />
                  <div>
                    <strong style={{ color: '#2DD4BF' }}>Reglas estándar sugeridas por giro:</strong> {activeRulesInfo.descripcion}
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group" style={{ flex: 2 }}>
                    <label className="form-label" style={{ color: '#E2E8F0', fontWeight: 600 }}>
                      Razón Social Oficial <span className="required" style={{ color: '#F87171' }}>*</span>
                    </label>
                    <input 
                      className="form-input" 
                      placeholder="Razón social completa para contratos y CFDI" 
                      value={form.razonSocial} 
                      onChange={e => setForm(f => ({ ...f, razonSocial: e.target.value }))} 
                      required 
                      style={{ background: '#1E293B', borderColor: 'rgba(255, 255, 255, 0.14)', color: '#F8FAFC' }}
                    />
                  </div>

                  <div className="form-group" style={{ flex: 1 }}>
                    <label className="form-label" style={{ color: '#E2E8F0', fontWeight: 600 }}>RFC</label>
                    <input 
                      className="form-input" 
                      placeholder="RFC123456789" 
                      value={form.rfc} 
                      onChange={e => setForm(f => ({ ...f, rfc: e.target.value.toUpperCase() }))} 
                      style={{ background: '#1E293B', borderColor: 'rgba(255, 255, 255, 0.14)', color: '#F8FAFC' }}
                    />
                  </div>

                  <div className="form-group" style={{ flex: 1 }}>
                    <label className="form-label" style={{ color: '#E2E8F0', fontWeight: 600 }}>Régimen Fiscal (SAT)</label>
                    <input 
                      className="form-input" 
                      placeholder="601, 612, 626" 
                      value={form.regimenFiscal} 
                      onChange={e => setForm(f => ({ ...f, regimenFiscal: e.target.value }))} 
                      style={{ background: '#1E293B', borderColor: 'rgba(255, 255, 255, 0.14)', color: '#F8FAFC' }}
                    />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group" style={{ flex: 1.5 }}>
                    <label className="form-label" style={{ color: '#E2E8F0', fontWeight: 600 }}>Dirección Fiscal</label>
                    <input 
                      className="form-input" 
                      placeholder="Calle, número, colonia" 
                      value={form.ciudad} 
                      onChange={e => setForm(f => ({ ...f, ciudad: e.target.value }))} 
                      style={{ background: '#1E293B', borderColor: 'rgba(255, 255, 255, 0.14)', color: '#F8FAFC' }}
                    />
                  </div>

                  <div className="form-group" style={{ flex: 1 }}>
                    <label className="form-label" style={{ color: '#E2E8F0', fontWeight: 600 }}>Código Postal</label>
                    <input 
                      className="form-input" 
                      placeholder="03940" 
                      value={form.codigoPostal} 
                      onChange={e => setForm(f => ({ ...f, codigoPostal: e.target.value }))} 
                      style={{ background: '#1E293B', borderColor: 'rgba(255, 255, 255, 0.14)', color: '#F8FAFC' }}
                    />
                  </div>

                  <div className="form-group" style={{ flex: 1 }}>
                    <label className="form-label" style={{ color: '#E2E8F0', fontWeight: 600 }}>País</label>
                    <input 
                      className="form-input" 
                      placeholder="México" 
                      value={form.pais} 
                      onChange={e => setForm(f => ({ ...f, pais: e.target.value }))} 
                      style={{ background: '#1E293B', borderColor: 'rgba(255, 255, 255, 0.14)', color: '#F8FAFC' }}
                    />
                  </div>

                  <div className="form-group" style={{ flex: 1 }}>
                    <label className="form-label" style={{ color: '#E2E8F0', fontWeight: 600 }}>CFDI Defecto</label>
                    <input 
                      className="form-input" 
                      placeholder="G03, G01" 
                      value={form.cfdiDefault} 
                      onChange={e => setForm(f => ({ ...f, cfdiDefault: e.target.value }))} 
                      style={{ background: '#1E293B', borderColor: 'rgba(255, 255, 255, 0.14)', color: '#F8FAFC' }}
                    />
                  </div>
                </div>
              </div>

              {/* SECCIÓN 2: REGLAS OPERATIVAS 3PL (SUBTAREA 3 & 4) */}
              <div style={{
                marginBottom: 20, padding: '16px 18px',
                background: '#070B11', borderRadius: 10,
                border: '1px solid rgba(255, 255, 255, 0.08)'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#2DD4BF', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Settings2 size={15} /> 2. Reglas Operativas Fijas 3PL (Cero Decisiones en Andén)
                  </div>
                  {!canEditRules && (
                    <span style={{ fontSize: 11, color: '#F87171', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Lock size={12} /> Bloqueado para Operarios
                    </span>
                  )}
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#E2E8F0', fontWeight: 600 }}>
                      Método de Rotación
                      {!canEditRules && <Lock size={12} style={{ color: '#F87171' }} />}
                    </label>
                    <select 
                      className="form-select form-select-full" 
                      value={form.reglaInventario} 
                      disabled={!canEditRules}
                      onChange={e => setForm(f => ({ ...f, reglaInventario: e.target.value }))}
                      style={{ background: '#1E293B', borderColor: 'rgba(255, 255, 255, 0.14)', color: '#F8FAFC' }}
                    >
                      <option value="FIFO">FIFO (First-In, First-Out / Estándar)</option>
                      <option value="FEFO">FEFO (First-Expired, First-Out / Perecederos)</option>
                      <option value="LIFO">LIFO (Last-In, First-Out)</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#E2E8F0', fontWeight: 600 }}>
                      Unidad de Medida Principal
                      {!canEditRules && <Lock size={12} style={{ color: '#F87171' }} />}
                    </label>
                    <select 
                      className="form-select form-select-full" 
                      value={form.uomPrincipal} 
                      disabled={!canEditRules}
                      onChange={e => setForm(f => ({ ...f, uomPrincipal: e.target.value }))}
                      style={{ background: '#1E293B', borderColor: 'rgba(255, 255, 255, 0.14)', color: '#F8FAFC' }}
                    >
                      <option value="PZA">Pieza (PZA)</option>
                      <option value="CAJA">Caja (CAJA)</option>
                      <option value="PALLET">Pallet (PALLET)</option>
                      <option value="MASTER">Caja Master (MASTER)</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#E2E8F0', fontWeight: 600 }}>
                      Manejo de Inventario
                      {!canEditRules && <Lock size={12} style={{ color: '#F87171' }} />}
                    </label>
                    <select 
                      className="form-select form-select-full" 
                      value={form.manejoInventario} 
                      disabled={!canEditRules}
                      onChange={e => setForm(f => ({ ...f, manejoInventario: e.target.value }))}
                      style={{ background: '#1E293B', borderColor: 'rgba(255, 255, 255, 0.14)', color: '#F8FAFC' }}
                    >
                      <option value="PIEZA">Por Pieza Individual</option>
                      <option value="CAJA">Por Caja Cerrada</option>
                      <option value="PALLET">Por Pallet Completo</option>
                      <option value="MIXTO">Mixto (Pieza y Caja)</option>
                    </select>
                  </div>
                </div>

                {/* Casillas de Verificación de Reglas Heredables */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginTop: 14 }}>
                  
                  {/* Requiere Lote */}
                  <label style={{
                    display: 'flex', alignItems: 'center', gap: 10, fontSize: 13,
                    cursor: canEditRules ? 'pointer' : 'not-allowed',
                    background: form.requiereLote ? 'rgba(245, 158, 11, 0.15)' : '#1E293B',
                    padding: '10px 14px', borderRadius: 8,
                    border: `1px solid ${form.requiereLote ? 'rgba(245, 158, 11, 0.4)' : 'rgba(255, 255, 255, 0.08)'}`,
                    opacity: canEditRules ? 1 : 0.8
                  }}>
                    <input 
                      type="checkbox" 
                      checked={form.requiereLote} 
                      disabled={!canEditRules}
                      onChange={e => setForm(f => ({ ...f, requiereLote: e.target.checked }))} 
                    />
                    <div>
                      <div style={{ fontWeight: 700, color: form.requiereLote ? '#FBBF24' : '#F8FAFC' }}>
                        Requiere Lote
                      </div>
                      <div style={{ fontSize: 11, color: '#94A3B8' }}>Obligatorio en andén</div>
                    </div>
                  </label>

                  {/* Requiere Caducidad */}
                  <label style={{
                    display: 'flex', alignItems: 'center', gap: 10, fontSize: 13,
                    cursor: canEditRules ? 'pointer' : 'not-allowed',
                    background: form.requiereCaducidad ? 'rgba(239, 68, 68, 0.15)' : '#1E293B',
                    padding: '10px 14px', borderRadius: 8,
                    border: `1px solid ${form.requiereCaducidad ? 'rgba(239, 68, 68, 0.4)' : 'rgba(255, 255, 255, 0.08)'}`,
                    opacity: canEditRules ? 1 : 0.8
                  }}>
                    <input 
                      type="checkbox" 
                      checked={form.requiereCaducidad} 
                      disabled={!canEditRules}
                      onChange={e => setForm(f => ({ ...f, requiereCaducidad: e.target.checked }))} 
                    />
                    <div>
                      <div style={{ fontWeight: 700, color: form.requiereCaducidad ? '#F87171' : '#F8FAFC' }}>
                        Requiere Caducidad
                      </div>
                      <div style={{ fontSize: 11, color: '#94A3B8' }}>NOM-251 / COFEPRIS</div>
                    </div>
                  </label>

                  {/* Escaneo Individual */}
                  <label style={{
                    display: 'flex', alignItems: 'center', gap: 10, fontSize: 13,
                    cursor: canEditRules ? 'pointer' : 'not-allowed',
                    background: form.escaneoIndividual ? 'rgba(56, 189, 248, 0.15)' : '#1E293B', 
                    padding: '10px 14px', borderRadius: 8,
                    border: `1px solid ${form.escaneoIndividual ? 'rgba(56, 189, 248, 0.4)' : 'rgba(255, 255, 255, 0.08)'}`,
                    opacity: canEditRules ? 1 : 0.8
                  }}>
                    <input 
                      type="checkbox" 
                      checked={form.escaneoIndividual} 
                      disabled={!canEditRules}
                      onChange={e => setForm(f => ({ ...f, escaneoIndividual: e.target.checked }))} 
                    />
                    <div>
                      <div style={{ fontWeight: 700, color: form.escaneoIndividual ? '#38BDF8' : '#F8FAFC' }}>Escaneo 1 a 1</div>
                      <div style={{ fontSize: 11, color: '#94A3B8' }}>Láser por cada pieza</div>
                    </div>
                  </label>

                  {/* Aprobación de Pedidos */}
                  <label style={{
                    display: 'flex', alignItems: 'center', gap: 10, fontSize: 13,
                    cursor: canEditRules ? 'pointer' : 'not-allowed',
                    background: form.requiereAprobacion ? 'rgba(16, 185, 129, 0.15)' : '#1E293B', 
                    padding: '10px 14px', borderRadius: 8,
                    border: `1px solid ${form.requiereAprobacion ? 'rgba(16, 185, 129, 0.4)' : 'rgba(255, 255, 255, 0.08)'}`,
                    opacity: canEditRules ? 1 : 0.8
                  }}>
                    <input 
                      type="checkbox" 
                      checked={form.requiereAprobacion} 
                      disabled={!canEditRules}
                      onChange={e => setForm(f => ({ ...f, requiereAprobacion: e.target.checked }))} 
                    />
                    <div>
                      <div style={{ fontWeight: 700, color: form.requiereAprobacion ? '#34D399' : '#F8FAFC' }}>Visto Bueno</div>
                      <div style={{ fontSize: 11, color: '#94A3B8' }}>Giving Out autoriza salida</div>
                    </div>
                  </label>
                </div>
              </div>

              {/* SECCIÓN 3: CONTACTO OPERATIVO Y PORTAL */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#2DD4BF', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Phone size={15} /> 3. Contacto Operativo y Enlace Digital
                </div>

                <div className="form-row">
                  <div className="form-group" style={{ flex: 1.5 }}>
                    <label className="form-label" style={{ color: '#E2E8F0', fontWeight: 600 }}>Contacto Principal</label>
                    <input 
                      className="form-input" 
                      placeholder="Nombre y cargo del responsable" 
                      value={form.contactoPrincipal} 
                      onChange={e => setForm(f => ({ ...f, contactoPrincipal: e.target.value }))} 
                      style={{ background: '#1E293B', borderColor: 'rgba(255, 255, 255, 0.14)', color: '#F8FAFC' }}
                    />
                  </div>

                  <div className="form-group" style={{ flex: 1 }}>
                    <label className="form-label" style={{ color: '#E2E8F0', fontWeight: 600 }}>Teléfono</label>
                    <input 
                      className="form-input" 
                      placeholder="55-1234-5678" 
                      value={form.telefono} 
                      onChange={e => setForm(f => ({ ...f, telefono: e.target.value }))} 
                      style={{ background: '#1E293B', borderColor: 'rgba(255, 255, 255, 0.14)', color: '#F8FAFC' }}
                    />
                  </div>

                  <div className="form-group" style={{ flex: 1.5 }}>
                    <label className="form-label" style={{ color: '#E2E8F0', fontWeight: 600 }}>Email Operativo</label>
                    <input 
                      className="form-input" 
                      type="email" 
                      placeholder="logistica@cliente.com" 
                      value={form.email} 
                      onChange={e => setForm(f => ({ ...f, email: e.target.value }))} 
                      style={{ background: '#1E293B', borderColor: 'rgba(255, 255, 255, 0.14)', color: '#F8FAFC' }}
                    />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group" style={{ flex: 2 }}>
                    <label className="form-label" style={{ color: '#E2E8F0', fontWeight: 600 }}>Sitio Web Corporativo</label>
                    <input 
                      className="form-input" 
                      placeholder="https://www.cliente.com" 
                      value={form.sitioWeb} 
                      onChange={e => setForm(f => ({ ...f, sitioWeb: e.target.value }))} 
                      style={{ background: '#1E293B', borderColor: 'rgba(255, 255, 255, 0.14)', color: '#F8FAFC' }}
                    />
                  </div>

                  <div className="form-group" style={{ flex: 1 }}>
                    <label className="form-label" style={{ color: '#E2E8F0', fontWeight: 600 }}>Color Distintivo Portal</label>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <input 
                        type="color" 
                        value={form.colorPortal} 
                        onChange={e => setForm(f => ({ ...f, colorPortal: e.target.value }))} 
                        style={{ width: 40, height: 38, padding: 2, borderRadius: 6, border: '1px solid rgba(255, 255, 255, 0.15)', background: '#1E293B', cursor: 'pointer' }}
                      />
                      <input 
                        className="form-input" 
                        value={form.colorPortal} 
                        onChange={e => setForm(f => ({ ...f, colorPortal: e.target.value }))} 
                        style={{ flex: 1, fontFamily: 'monospace', background: '#1E293B', borderColor: 'rgba(255, 255, 255, 0.14)', color: '#F8FAFC' }}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Mensajes de Éxito / Error */}
              {formMsg.text && (
                <div style={{ 
                  marginTop: 14, padding: '12px 16px', borderRadius: 8,
                  background: formMsg.type === 'error' ? 'rgba(239, 68, 68, 0.12)' : 'rgba(16, 185, 129, 0.12)',
                  border: `1px solid ${formMsg.type === 'error' ? 'rgba(239, 68, 68, 0.35)' : 'rgba(16, 185, 129, 0.35)'}`,
                  color: formMsg.type === 'error' ? '#F87171' : '#34D399',
                  display: 'flex', alignItems: 'center', gap: 8, fontSize: 13
                }}>
                  {formMsg.type === 'error' ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}
                  <span>{formMsg.text}</span>
                </div>
              )}

              {/* Footer */}
              <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid rgba(255, 255, 255, 0.08)', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button 
                  type="button" 
                  onClick={() => setShowModal(false)}
                  style={{
                    padding: '10px 18px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                    background: '#1E293B', border: '1px solid rgba(255, 255, 255, 0.12)', color: '#E2E8F0', cursor: 'pointer'
                  }}
                >
                  Cancelar
                </button>
                <button 
                  type="submit" 
                  disabled={submitting}
                  style={{
                    padding: '10px 22px', borderRadius: 8, fontSize: 13, fontWeight: 700,
                    background: '#0D9488', border: '1px solid #2DD4BF', color: '#FFFFFF',
                    boxShadow: '0 4px 14px rgba(13, 148, 136, 0.35)', cursor: submitting ? 'not-allowed' : 'pointer',
                    opacity: submitting ? 0.7 : 1
                  }}
                >
                  {submitting ? 'Guardando en Supabase...' : isEditing ? 'Actualizar Depositante' : 'Guardar y Fijar Reglas 3PL'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL DE CONFIRMACIÓN DE BAJA LÓGICA (BOTECITO DE BASURA - DARK CEDIS) */}
      {clientToDelete && (
        <div className="modal-overlay" onClick={() => setClientToDelete(null)} style={{ background: 'rgba(2, 6, 23, 0.85)', backdropFilter: 'blur(10px)', zIndex: 1100 }}>
          <div 
            className="modal-content animate-scale-in" 
            onClick={e => e.stopPropagation()} 
            style={{ 
              maxWidth: 480, background: '#0F172A', border: '1px solid rgba(255, 255, 255, 0.12)', 
              borderRadius: 16, boxShadow: '0 25px 60px -12px rgba(0, 0, 0, 0.85)', padding: 0, overflow: 'hidden' 
            }}
          >
            <div style={{ padding: '20px 24px', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#F87171' }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(239, 68, 68, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <AlertTriangle size={22} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#F8FAFC' }}>¿Desactivar Depositante?</h3>
                  <p style={{ margin: '2px 0 0', fontSize: 12, color: '#94A3B8' }}>Baja lógica con resguardo de kárdex</p>
                </div>
              </div>
              <button 
                type="button" 
                onClick={() => setClientToDelete(null)}
                style={{ background: 'transparent', border: 'none', color: '#94A3B8', cursor: 'pointer', padding: 6, display: 'flex' }}
              >
                <X size={18} />
              </button>
            </div>

            <div style={{ padding: '20px 24px', fontSize: 13, color: '#CBD5E1' }}>
              <p style={{ margin: '0 0 14px' }}>
                Estás por desactivar al depositante <strong style={{ color: '#F8FAFC' }}>{clientToDelete.nombreComercial}</strong> (<span style={{ fontFamily: 'monospace', color: '#38BDF8' }}>{clientToDelete.codigo}</span>).
              </p>
              <div style={{ padding: '12px 14px', background: 'rgba(239, 68, 68, 0.1)', borderRadius: 8, border: '1px solid rgba(239, 68, 68, 0.25)', color: '#FCA5A5', fontSize: 12, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <Lock size={16} style={{ flexShrink: 0, marginTop: 2, color: '#F87171' }} />
                <div>
                  <strong style={{ color: '#F87171' }}>Resguardo de Kárdex:</strong> Esta acción no eliminará registros históricos ni movimientos de inventario. El cliente simplemente ya no estará disponible para nuevos previos hasta ser reactivado.
                </div>
              </div>
            </div>

            <div style={{ padding: '16px 24px', borderTop: '1px solid rgba(255, 255, 255, 0.08)', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button 
                type="button" 
                onClick={() => setClientToDelete(null)} 
                disabled={deleting}
                style={{ 
                  padding: '10px 18px', borderRadius: 8, fontSize: 13, fontWeight: 600, 
                  background: '#1E293B', border: '1px solid rgba(255, 255, 255, 0.12)', color: '#E2E8F0', cursor: 'pointer' 
                }}
              >
                Cancelar
              </button>
              <button 
                type="button"
                onClick={handleConfirmDelete} 
                disabled={deleting}
                style={{ 
                  background: '#DC2626', color: '#FFFFFF', border: '1px solid #EF4444', 
                  display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 700, padding: '10px 18px', borderRadius: 8,
                  boxShadow: '0 4px 14px rgba(220, 38, 38, 0.4)', cursor: deleting ? 'not-allowed' : 'pointer'
                }}
              >
                <Trash2 size={15} /> {deleting ? 'Desactivando...' : 'Confirmar Desactivación'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE CONFIRMACIÓN DE REACTIVACIÓN (DARK CEDIS) */}
      {clientToReactivate && (
        <div className="modal-overlay" onClick={() => setClientToReactivate(null)} style={{ background: 'rgba(2, 6, 23, 0.85)', backdropFilter: 'blur(10px)', zIndex: 1100 }}>
          <div 
            className="modal-content animate-scale-in" 
            onClick={e => e.stopPropagation()} 
            style={{ 
              maxWidth: 480, background: '#0F172A', border: '1px solid rgba(255, 255, 255, 0.12)', 
              borderRadius: 16, boxShadow: '0 25px 60px -12px rgba(0, 0, 0, 0.85)', padding: 0, overflow: 'hidden' 
            }}
          >
            <div style={{ padding: '20px 24px', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(16, 185, 129, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#34D399' }}>
                  <CheckCircle2 size={22} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#F8FAFC' }}>¿Reactivar Depositante?</h3>
                  <p style={{ margin: '2px 0 0', fontSize: 12, color: '#94A3B8' }}>Habilitación inmediata para andén y órdenes</p>
                </div>
              </div>
              <button 
                type="button" 
                onClick={() => setClientToReactivate(null)}
                style={{ background: 'transparent', border: 'none', color: '#94A3B8', cursor: 'pointer', padding: 6, display: 'flex' }}
              >
                <X size={18} />
              </button>
            </div>

            <div style={{ padding: '20px 24px', fontSize: 13, color: '#CBD5E1' }}>
              <p style={{ margin: '0 0 14px' }}>
                Estás por reactivar al depositante <strong style={{ color: '#F8FAFC' }}>{clientToReactivate.nombreComercial}</strong> (<span style={{ fontFamily: 'monospace', color: '#38BDF8' }}>{clientToReactivate.codigo}</span>).
              </p>
              <div style={{ padding: '12px 14px', background: 'rgba(16, 185, 129, 0.1)', borderRadius: 8, border: '1px solid rgba(16, 185, 129, 0.25)', color: '#A7F3D0', fontSize: 12, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <CheckCircle2 size={16} style={{ flexShrink: 0, marginTop: 2, color: '#34D399' }} />
                <div>
                  <strong style={{ color: '#34D399' }}>Disponibilidad Operativa:</strong> Al reactivarlo, el depositante volverá a estar disponible de inmediato para recepción de previos, catálogo de SKUs y órdenes de despacho en el WMS.
                </div>
              </div>
            </div>

            <div style={{ padding: '16px 24px', borderTop: '1px solid rgba(255, 255, 255, 0.08)', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button 
                type="button" 
                onClick={() => setClientToReactivate(null)} 
                disabled={reactivating}
                style={{ 
                  padding: '10px 18px', borderRadius: 8, fontSize: 13, fontWeight: 600, 
                  background: '#1E293B', border: '1px solid rgba(255, 255, 255, 0.12)', color: '#E2E8F0', cursor: 'pointer' 
                }}
              >
                Cancelar
              </button>
              <button 
                type="button" 
                onClick={handleConfirmReactivate} 
                disabled={reactivating}
                style={{ 
                  display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 700, padding: '10px 18px', borderRadius: 8,
                  background: '#0D9488', border: '1px solid #2DD4BF', color: '#FFFFFF',
                  boxShadow: '0 4px 14px rgba(13, 148, 136, 0.35)', cursor: reactivating ? 'not-allowed' : 'pointer'
                }}
              >
                <RotateCcw size={15} /> {reactivating ? 'Reactivando...' : 'Confirmar Reactivación'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
