import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { API } from '../config/api';
import {
  Search, RefreshCw, Package, Building, MapPin, Layers,
  Plus, Edit3, X, AlertTriangle, CheckCircle2, Filter,
  Thermometer, Info, Box, Trash2, Power, Check, ShieldAlert
} from 'lucide-react';

type Tab = 'skus' | 'suppliers' | 'warehouses' | 'zones';

interface SkuFormData {
  id?: string;
  clienteId: string;
  codigo: string;
  descripcion: string;
  categoria: string;
  subcategoria: string;
  marca: string;
  modelo: string;
  color: string;
  talla: string;
  uomBase: string;
  pesoKg: string;
  volumenM3: string;
  codigoBarras: string;
  requiereLote: boolean;
  requiereSerie: boolean;
  requiereCaducidad: boolean;
  capacidadEmpaque: string;
  descripcionEmpaque: string;
  temperaturaRequerida: string;
  activo: boolean;
}

const DEFAULT_SKU_FORM: SkuFormData = {
  clienteId: '',
  codigo: '',
  descripcion: '',
  categoria: 'PRENDA',
  subcategoria: '',
  marca: '',
  modelo: '',
  color: '',
  talla: '',
  uomBase: 'PZA',
  pesoKg: '',
  volumenM3: '',
  codigoBarras: '',
  requiereLote: false,
  requiereSerie: false,
  requiereCaducidad: false,
  capacidadEmpaque: '',
  descripcionEmpaque: '',
  temperaturaRequerida: 'AMBIENTE',
  activo: true,
};

const CATEGORIAS = [
  'PRENDA',
  'CALZADO',
  'ACCESORIO',
  'ALIMENTO',
  'BEBIDA',
  'FARMACEUTICO',
  'ELECTRONICA',
  'GENERAL',
];

const UOMS = [
  { value: 'PZA', label: 'PZA - Pieza' },
  { value: 'CAJA', label: 'CAJA - Caja' },
  { value: 'PAR', label: 'PAR - Par' },
  { value: 'KG', label: 'KG - Kilogramo' },
  { value: 'M', label: 'M - Metro' },
  { value: 'LT', label: 'LT - Litro' },
  { value: 'PAQ', label: 'PAQ - Paquete' },
];

const TEMPERATURAS = [
  { value: 'AMBIENTE', label: 'Ambiente (Controlada)' },
  { value: 'REFRIGERADO', label: 'Refrigerado (2°C a 8°C)' },
  { value: 'CONGELADO', label: 'Congelado (-18°C o menos)' },
];

const demoSkus = [
  { id: '1', codigo: 'SUD-CAP-001', descripcion: 'Sudadera con Capucha', cliente: { nombreComercial: 'Fashion Forward' }, categoria: 'PRENDA', uomBase: 'PZA', capacidadEmpaque: 4, descripcionEmpaque: 'Caja x4', codigoBarras: '7501234567890' },
  { id: '2', codigo: 'CAM-S-BLA', descripcion: 'Camisa Algodón S Blanco', cliente: { nombreComercial: 'Fashion Forward' }, categoria: 'PRENDA', uomBase: 'PZA', capacidadEmpaque: 10, descripcionEmpaque: 'Caja x10', codigoBarras: '7509876543210' },
  { id: '3', codigo: 'PAN-M-NEGRO', descripcion: 'Pantalón Casual M Negro', cliente: { nombreComercial: 'Fashion Forward' }, categoria: 'PRENDA', uomBase: 'PZA', capacidadEmpaque: 6, descripcionEmpaque: 'Caja x6', codigoBarras: '7501122334455' },
  { id: '4', codigo: 'ACEITE-OLIVA-1L', descripcion: 'Aceite de Oliva Extra Virgen 1L', cliente: { nombreComercial: 'Alimentos del Bajío' }, categoria: 'ALIMENTO', uomBase: 'CAJA', capacidadEmpaque: 12, descripcionEmpaque: 'Caja x12', codigoBarras: '7501112223334' },
  { id: '5', codigo: 'ARROZ-INTEGRAL-1KG', descripcion: 'Arroz Integral Super Premium 1kg', cliente: { nombreComercial: 'Alimentos del Bajío' }, categoria: 'ALIMENTO', uomBase: 'CAJA', capacidadEmpaque: 20, descripcionEmpaque: 'Caja x20', codigoBarras: '7505556667778' }
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
  const [searchParams, setSearchParams] = useSearchParams();

  // URL parameters for deep-linking
  const urlTab = (searchParams.get('tab') as Tab) || 'skus';
  const urlClienteId = searchParams.get('clienteId') || '';

  const [tab, setTab] = useState<Tab>(urlTab);
  const [data, setData] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [filterClienteId, setFilterClienteId] = useState<string>(urlClienteId);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // SKU Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [skuForm, setSkuForm] = useState<SkuFormData>(DEFAULT_SKU_FORM);
  const [autoEmpaqueText, setAutoEmpaqueText] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [toastSuccess, setToastSuccess] = useState<string | null>(null);

  // SKU Lifecycle Action Modals (Confirmations)
  const [skuToDelete, setSkuToDelete] = useState<any | null>(null);
  const [skuToDeactivate, setSkuToDeactivate] = useState<any | null>(null);
  const [skuToReactivate, setSkuToReactivate] = useState<any | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  // Safe Physical Delete Handler
  async function handleConfirmDelete() {
    if (!skuToDelete) return;
    setActionLoading(true);
    setActionError(null);
    try {
      const res = await fetch(`${API}/skus/${skuToDelete.id}`, {
        method: 'DELETE',
        headers,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.message || 'Error al eliminar SKU');
      }
      setToastSuccess(`Producto ${skuToDelete.codigo} eliminado definitivamente del catálogo`);
      setTimeout(() => setToastSuccess(null), 4000);
      setSkuToDelete(null);
      await loadTab('skus');
    } catch (err: any) {
      console.error(err);
      setActionError(err.message || 'Error al procesar la eliminación');
    } finally {
      setActionLoading(false);
    }
  }

  // Logical Deactivate Handler
  async function handleConfirmDeactivate() {
    if (!skuToDeactivate) return;
    setActionLoading(true);
    setActionError(null);
    try {
      const res = await fetch(`${API}/skus/${skuToDeactivate.id}/toggle-activo`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ activo: false }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.message || 'Error al desactivar SKU');
      }
      setToastSuccess(`Producto ${skuToDeactivate.codigo} desactivado exitosamente`);
      setTimeout(() => setToastSuccess(null), 4000);
      setSkuToDeactivate(null);
      await loadTab('skus');
    } catch (err: any) {
      console.error(err);
      setActionError(err.message || 'Error al desactivar el producto');
    } finally {
      setActionLoading(false);
    }
  }

  // Logical Reactivate Handler
  async function handleConfirmReactivate() {
    if (!skuToReactivate) return;
    setActionLoading(true);
    setActionError(null);
    try {
      const res = await fetch(`${API}/skus/${skuToReactivate.id}/toggle-activo`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ activo: true }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.message || 'Error al reactivar SKU');
      }
      setToastSuccess(`Producto ${skuToReactivate.codigo} reactivado exitosamente`);
      setTimeout(() => setToastSuccess(null), 4000);
      setSkuToReactivate(null);
      await loadTab('skus');
    } catch (err: any) {
      console.error(err);
      setActionError(err.message || 'Error al reactivar el producto');
    } finally {
      setActionLoading(false);
    }
  }

  // Sync tab with URL
  useEffect(() => {
    if (searchParams.get('tab') && searchParams.get('tab') !== tab) {
      setTab(searchParams.get('tab') as Tab);
    }
    if (searchParams.get('clienteId') !== null && searchParams.get('clienteId') !== filterClienteId) {
      setFilterClienteId(searchParams.get('clienteId') || '');
    }
  }, [searchParams]);

  // Load clients once for filter dropdown and SKU modal
  useEffect(() => {
    async function fetchClients() {
      try {
        const res = await fetch(`${API}/clients`, { headers });
        if (res.ok) {
          const d = await res.json();
          setClients(d || []);
        }
      } catch (e) {
        console.error('Error al cargar clientes:', e);
      }
    }
    fetchClients();
  }, []);

  // Load tab data
  useEffect(() => {
    loadTab(tab);
  }, [tab]);

  async function loadTab(t: Tab) {
    setLoading(true);
    setSearch('');
    try {
      const res = await fetch(`${API}/${t}`, { headers });
      if (res.ok) {
        const d = await res.json();
        if (d && d.length > 0) setData(d);
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

  function handleTabChange(newTab: Tab) {
    setTab(newTab);
    setSearchParams(prev => {
      prev.set('tab', newTab);
      return prev;
    });
  }

  function handleClienteFilterChange(cId: string) {
    setFilterClienteId(cId);
    setSearchParams(prev => {
      if (cId) prev.set('clienteId', cId);
      else prev.delete('clienteId');
      return prev;
    });
  }

  // Open Create Modal
  function handleOpenCreate() {
    setIsEditing(false);
    setFormError(null);
    setAutoEmpaqueText(true);
    setSkuForm({
      ...DEFAULT_SKU_FORM,
      clienteId: filterClienteId || (clients.length > 0 ? clients[0].id : ''),
    });
    setIsModalOpen(true);
  }

  // Open Edit Modal
  function handleOpenEdit(sku: any) {
    setIsEditing(true);
    setFormError(null);
    setAutoEmpaqueText(false);
    setSkuForm({
      id: sku.id,
      clienteId: sku.clienteId || sku.cliente?.id || '',
      codigo: sku.codigo || '',
      descripcion: sku.descripcion || '',
      categoria: sku.categoria || 'PRENDA',
      subcategoria: sku.subcategoria || '',
      marca: sku.marca || '',
      modelo: sku.modelo || '',
      color: sku.color || '',
      talla: sku.talla || '',
      uomBase: sku.uomBase || 'PZA',
      pesoKg: sku.pesoKg !== null && sku.pesoKg !== undefined ? String(sku.pesoKg) : '',
      volumenM3: sku.volumenM3 !== null && sku.volumenM3 !== undefined ? String(sku.volumenM3) : '',
      codigoBarras: sku.codigoBarras || '',
      requiereLote: Boolean(sku.requiereLote),
      requiereSerie: Boolean(sku.requiereSerie),
      requiereCaducidad: Boolean(sku.requiereCaducidad),
      capacidadEmpaque: sku.capacidadEmpaque !== null && sku.capacidadEmpaque !== undefined ? String(sku.capacidadEmpaque) : '',
      descripcionEmpaque: sku.descripcionEmpaque || '',
      temperaturaRequerida: sku.temperaturaRequerida || 'AMBIENTE',
      activo: sku.activo !== undefined ? Boolean(sku.activo) : true,
    });
    setIsModalOpen(true);
  }

  // Handle Capacidad de Empaque change with auto-description rule
  function handleCapacidadEmpaqueChange(val: string) {
    const nextForm = { ...skuForm, capacidadEmpaque: val };
    const num = parseInt(val, 10);
    if (autoEmpaqueText || !skuForm.descripcionEmpaque || skuForm.descripcionEmpaque.startsWith('Caja x')) {
      if (!isNaN(num) && num > 0) {
        nextForm.descripcionEmpaque = `Caja x${num}`;
      }
    }
    setSkuForm(nextForm);
  }

  // Submit Create or Edit SKU
  async function handleSubmitSku(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    // Front validations
    if (!skuForm.clienteId) {
      setFormError('El depositante / cliente propietario es obligatorio.');
      return;
    }
    if (!skuForm.codigo.trim()) {
      setFormError('El código SKU es obligatorio.');
      return;
    }
    if (!skuForm.descripcion.trim()) {
      setFormError('La descripción es obligatoria.');
      return;
    }
    if (!skuForm.categoria.trim()) {
      setFormError('La categoría es obligatoria.');
      return;
    }
    if (!skuForm.uomBase.trim()) {
      setFormError('La unidad base es obligatoria.');
      return;
    }
    if (skuForm.capacidadEmpaque.trim()) {
      const cap = parseInt(skuForm.capacidadEmpaque, 10);
      if (isNaN(cap) || cap <= 0) {
        setFormError('La capacidad de empaque (piezas por caja) debe ser un entero positivo mayor a 0.');
        return;
      }
    }

    setSubmitting(true);
    try {
      const payload: any = {
        clienteId: skuForm.clienteId,
        codigo: skuForm.codigo.trim().toUpperCase(),
        descripcion: skuForm.descripcion.trim(),
        categoria: skuForm.categoria.trim().toUpperCase(),
        subcategoria: skuForm.subcategoria.trim() || null,
        marca: skuForm.marca.trim() || null,
        modelo: skuForm.modelo.trim() || null,
        color: skuForm.color.trim() || null,
        talla: skuForm.talla.trim() || null,
        uomBase: skuForm.uomBase.trim().toUpperCase(),
        pesoKg: skuForm.pesoKg.trim() ? parseFloat(skuForm.pesoKg) : null,
        volumenM3: skuForm.volumenM3.trim() ? parseFloat(skuForm.volumenM3) : null,
        codigoBarras: skuForm.codigoBarras.trim() || null,
        requiereLote: skuForm.requiereLote,
        requiereSerie: skuForm.requiereSerie,
        requiereCaducidad: skuForm.requiereCaducidad,
        capacidadEmpaque: skuForm.capacidadEmpaque.trim() ? parseInt(skuForm.capacidadEmpaque, 10) : null,
        descripcionEmpaque: skuForm.descripcionEmpaque.trim() || null,
        temperaturaRequerida: skuForm.temperaturaRequerida || 'AMBIENTE',
        activo: skuForm.activo,
      };

      const url = isEditing ? `${API}/skus/${skuForm.id}` : `${API}/skus`;
      const method = isEditing ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers,
        body: JSON.stringify(payload),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.message || (isEditing ? 'Error al actualizar SKU' : 'Error al crear SKU'));
      }

      setToastSuccess(isEditing ? `SKU ${payload.codigo} actualizado con éxito` : `SKU ${payload.codigo} creado con éxito`);
      setTimeout(() => setToastSuccess(null), 4000);
      setIsModalOpen(false);
      await loadTab('skus');
    } catch (err: any) {
      console.error(err);
      setFormError(err.message || 'Error al procesar la solicitud');
    } finally {
      setSubmitting(false);
    }
  }

  const tabs: { key: Tab; label: string; icon: any }[] = [
    { key: 'skus', label: 'SKUs', icon: Package },
    { key: 'suppliers', label: 'Proveedores', icon: Building },
    { key: 'warehouses', label: 'Almacenes', icon: MapPin },
    { key: 'zones', label: 'Zonas', icon: Layers },
  ];

  // Filtering data
  const filtered = data.filter((d: any) => {
    // Client filter for SKUs
    if (tab === 'skus' && filterClienteId) {
      const matchClient = d.clienteId === filterClienteId || d.cliente?.id === filterClienteId;
      if (!matchClient) return false;
    }

    if (!search) return true;
    const s = search.toLowerCase();
    return (
      (d.codigo && d.codigo.toLowerCase().includes(s)) ||
      (d.descripcion && d.descripcion.toLowerCase().includes(s)) ||
      (d.nombre && d.nombre.toLowerCase().includes(s)) ||
      (d.marca && d.marca.toLowerCase().includes(s)) ||
      (d.cliente?.nombreComercial && d.cliente.nombreComercial.toLowerCase().includes(s))
    );
  });

  const selectedClientObj = clients.find(c => c.id === filterClienteId);

  return (
    <div className="page-container">
      {/* Toast de éxito */}
      {toastSuccess && (
        <div style={{
          position: 'fixed',
          top: 24,
          right: 24,
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          background: '#065F46',
          color: '#ECFDF5',
          padding: '12px 20px',
          borderRadius: 8,
          boxShadow: '0 10px 25px -5px rgba(0,0,0,0.4)',
          border: '1px solid #10B981',
          fontWeight: 600,
          fontSize: 14,
          animation: 'fadeIn 0.2s ease-out'
        }}>
          <CheckCircle2 size={18} color="#34D399" />
          {toastSuccess}
        </div>
      )}

      <div className="page-header">
        <div>
          <h1 className="page-title">Datos Maestros</h1>
          <p className="page-subtitle">Catálogos centrales y configuración de productos WMS</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {tab === 'skus' && (
            <button className="btn btn-primary" onClick={handleOpenCreate}>
              <Plus size={16} /> Nuevo producto
            </button>
          )}
          <button className="btn btn-secondary" onClick={() => loadTab(tab)}>
            <RefreshCw size={16} /> Actualizar
          </button>
        </div>
      </div>

      {/* Tabs & Filters */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 8, padding: '12px 20px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
          {tabs.map(t => (
            <button
              key={t.key}
              className={`btn btn-sm ${tab === t.key ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => handleTabChange(t.key)}
            >
              <t.icon size={14} /> {t.label} ({tab === t.key ? filtered.length : ''})
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 12, padding: '12px 20px', flexWrap: 'wrap', alignItems: 'center' }}>
          {/* Search Box */}
          <div className="search-box" style={{ flex: 1, minWidth: 240 }}>
            <Search size={16} />
            <input
              placeholder={tab === 'skus' ? "Buscar por código SKU, descripción, marca..." : "Buscar..."}
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          {/* Depositante Filter (only in SKUs tab) */}
          {tab === 'skus' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Filter size={16} style={{ color: 'var(--text-secondary)' }} />
              <select
                className="form-select"
                style={{ minWidth: 220, height: 38 }}
                value={filterClienteId}
                onChange={e => handleClienteFilterChange(e.target.value)}
              >
                <option value="">Todos los depositantes</option>
                {clients.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.nombreComercial || c.razonSocial} ({c.codigo})
                  </option>
                ))}
              </select>
              {filterClienteId && (
                <button
                  className="btn btn-sm btn-ghost"
                  title="Limpiar filtro de depositante"
                  onClick={() => handleClienteFilterChange('')}
                >
                  <X size={14} />
                </button>
              )}
            </div>
          )}
        </div>

        {/* Active Filter Notice */}
        {tab === 'skus' && selectedClientObj && (
          <div style={{
            padding: '8px 20px',
            background: 'rgba(59, 130, 246, 0.08)',
            borderTop: '1px solid var(--border)',
            fontSize: 13,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}>
            <span style={{ color: 'var(--text-primary)' }}>
              Mostrando catálogo exclusivo de: <strong>{selectedClientObj.nombreComercial}</strong> ({selectedClientObj.codigo})
            </span>
            <button
              className="btn btn-xs btn-ghost"
              style={{ color: 'var(--accent-color)', fontWeight: 600 }}
              onClick={() => handleClienteFilterChange('')}
            >
              Ver todos los depositantes
            </button>
          </div>
        )}
      </div>

      {/* Content */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-secondary)' }}>
          <RefreshCw className="animate-spin" size={24} /> Cargando...
        </div>
      ) : tab === 'skus' ? (
        <div className="card">
          <div className="card-body" style={{ padding: 0, overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Descripción</th>
                  <th>Estado</th>
                  <th>Depositante</th>
                  <th>Categoría</th>
                  <th>Trazabilidad</th>
                  <th>UoM Base</th>
                  <th>Empaque (Pz/Cja)</th>
                  <th>Temp.</th>
                  <th>Peso / Vol.</th>
                  <th style={{
                    textAlign: 'center',
                    minWidth: 175,
                    position: 'sticky',
                    right: 0,
                    background: '#FFFFFF',
                    zIndex: 10,
                    boxShadow: '-4px 0 8px rgba(0,0,0,0.06)',
                  }}>
                    Acciones
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s: any, i: number) => {
                  const totalHistory = (s._count?.lineasRecepcion || 0) +
                    (s._count?.lotes || 0) +
                    (s._count?.movimientos || 0) +
                    (s._count?.lineasSalida || 0) +
                    (s._count?.cycleCountLineas || 0) +
                    (s._count?.trazabilidad || 0) +
                    (s._count?.conversiones || 0);
                  const hasHistory = totalHistory > 0;
                  const isActive = s.activo !== false;

                  return (
                    <tr
                      key={s.id || i}
                      className="animate-fade-in"
                      style={{
                        animationDelay: `${i * 0.01}s`,
                        background: !isActive ? '#FAFAFB' : undefined,
                        opacity: !isActive ? 0.9 : 1,
                      }}
                    >
                      <td>
                        <code style={{ fontSize: 12, background: 'var(--bg-secondary)', padding: '3px 7px', borderRadius: 4, fontWeight: 700 }}>
                          {s.codigo}
                        </code>
                      </td>
                      <td style={{ fontWeight: 500 }}>
                        <div>{s.descripcion}</div>
                        {(s.marca || s.talla || s.color) && (
                          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                            {[s.marca, s.talla, s.color].filter(Boolean).join(' · ')}
                          </div>
                        )}
                      </td>
                      <td>
                        {isActive ? (
                          <span
                            className="badge"
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 5,
                              fontSize: 11,
                              padding: '2px 8px',
                              borderRadius: 4,
                              background: 'rgba(16, 185, 129, 0.12)',
                              color: '#059669',
                              border: '1px solid rgba(16, 185, 129, 0.3)',
                              fontWeight: 700,
                            }}
                          >
                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10B981' }} />
                            ACTIVO
                          </span>
                        ) : (
                          <span
                            className="badge"
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 5,
                              fontSize: 11,
                              padding: '2px 8px',
                              borderRadius: 4,
                              background: 'rgba(239, 68, 68, 0.12)',
                              color: '#DC2626',
                              border: '1px solid rgba(239, 68, 68, 0.3)',
                              fontWeight: 700,
                            }}
                          >
                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#EF4444' }} />
                            INACTIVO
                          </span>
                        )}
                      </td>
                      <td>
                        <span className="badge badge-info">
                          {s.cliente?.nombreComercial || '—'}
                        </span>
                      </td>
                      <td>
                        <span className={`badge badge-${s.categoria === 'PRENDA' ? 'info' : s.categoria === 'ALIMENTO' ? 'warning' : 'secondary'}`}>
                          {s.categoria}
                        </span>
                      </td>
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
                      <td>
                        <span style={{ fontWeight: 600, fontSize: 12 }}>{s.uomBase || 'PZA'}</span>
                      </td>
                      <td style={{ fontSize: 12 }}>
                        {s.capacidadEmpaque ? (
                          <div>
                            <span style={{ fontWeight: 600, color: 'var(--accent-color)' }}>
                              {s.capacidadEmpaque} pz/cja
                            </span>
                            {s.descripcionEmpaque && (
                              <span style={{ color: 'var(--text-secondary)', marginLeft: 4, fontSize: 11 }}>
                                ({s.descripcionEmpaque})
                              </span>
                            )}
                          </div>
                        ) : (
                          <span style={{ color: 'var(--text-tertiary)' }}>{s.descripcionEmpaque || '—'}</span>
                        )}
                      </td>
                      <td>
                        <span style={{
                          fontSize: 11,
                          padding: '2px 6px',
                          borderRadius: 4,
                          background: s.temperaturaRequerida === 'CONGELADO' ? 'rgba(59, 130, 246, 0.2)' : s.temperaturaRequerida === 'REFRIGERADO' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(148, 163, 184, 0.15)',
                          color: s.temperaturaRequerida === 'CONGELADO' ? '#60A5FA' : s.temperaturaRequerida === 'REFRIGERADO' ? '#34D399' : 'var(--text-secondary)'
                        }}>
                          {s.temperaturaRequerida || 'AMBIENTE'}
                        </span>
                      </td>
                      <td style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                        {s.pesoKg ? `${s.pesoKg} kg` : ''} {s.volumenM3 ? `· ${s.volumenM3} m³` : ''}
                        {!s.pesoKg && !s.volumenM3 && '—'}
                      </td>
                      <td style={{
                        textAlign: 'center',
                        position: 'sticky',
                        right: 0,
                        background: !isActive ? '#FAFAFB' : '#FFFFFF',
                        zIndex: 5,
                        boxShadow: '-4px 0 8px rgba(0,0,0,0.06)',
                        whiteSpace: 'nowrap',
                      }}>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}>
                          <button
                            className="btn btn-xs btn-secondary"
                            onClick={() => handleOpenEdit(s)}
                            title="Editar SKU"
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 8px', fontSize: 11 }}
                          >
                            <Edit3 size={12} /> Editar
                          </button>

                          {isActive ? (
                            hasHistory ? (
                              <button
                                className="btn btn-xs"
                                onClick={() => { setActionError(null); setSkuToDeactivate(s); }}
                                title={`Desactivar SKU (${totalHistory} registros operativos)`}
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 4,
                                  padding: '4px 8px',
                                  fontSize: 11,
                                  background: 'rgba(245, 158, 11, 0.1)',
                                  color: '#D97706',
                                  border: '1px solid rgba(245, 158, 11, 0.3)',
                                  borderRadius: 4,
                                  cursor: 'pointer',
                                  fontWeight: 600,
                                }}
                              >
                                <Power size={12} /> Desactivar
                              </button>
                            ) : (
                              <button
                                className="btn btn-xs"
                                onClick={() => { setActionError(null); setSkuToDelete(s); }}
                                title="Eliminar SKU definitivamente (sin historial operativo)"
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 4,
                                  padding: '4px 8px',
                                  fontSize: 11,
                                  background: 'rgba(239, 68, 68, 0.1)',
                                  color: '#DC2626',
                                  border: '1px solid rgba(239, 68, 68, 0.3)',
                                  borderRadius: 4,
                                  cursor: 'pointer',
                                  fontWeight: 600,
                                }}
                              >
                                <Trash2 size={12} /> Eliminar
                              </button>
                            )
                          ) : (
                            <div style={{ display: 'inline-flex', gap: 4 }}>
                              <button
                                className="btn btn-xs"
                                onClick={() => { setActionError(null); setSkuToReactivate(s); }}
                                title="Reactivar SKU para permitir nuevos arribos y pedidos"
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 4,
                                  padding: '4px 8px',
                                  fontSize: 11,
                                  background: 'rgba(13, 148, 136, 0.12)',
                                  color: '#0D9488',
                                  border: '1px solid rgba(13, 148, 136, 0.3)',
                                  borderRadius: 4,
                                  cursor: 'pointer',
                                  fontWeight: 600,
                                }}
                              >
                                <Check size={12} /> Reactivar
                              </button>
                              {!hasHistory && (
                                <button
                                  className="btn btn-xs"
                                  onClick={() => { setActionError(null); setSkuToDelete(s); }}
                                  title="Eliminar SKU definitivamente (sin historial operativo)"
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 4,
                                    padding: '4px 8px',
                                    fontSize: 11,
                                    background: 'rgba(239, 68, 68, 0.1)',
                                    color: '#DC2626',
                                    border: '1px solid rgba(239, 68, 68, 0.3)',
                                    borderRadius: 4,
                                    cursor: 'pointer',
                                    fontWeight: 600,
                                  }}
                                >
                                  <Trash2 size={12} /> Eliminar
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={11} style={{ textAlign: 'center', padding: 48, color: 'var(--text-tertiary)' }}>
                      No se encontraron productos que coincidan con la búsqueda.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : tab === 'suppliers' ? (
        <div className="card">
          <div className="card-body" style={{ padding: 0 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Nombre</th>
                  <th>RFC</th>
                  <th>Teléfono</th>
                  <th>Email</th>
                  <th>Contacto</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s: any, i: number) => (
                  <tr key={i}>
                    <td><code>{s.codigo}</code></td>
                    <td style={{ fontWeight: 500 }}>{s.nombre || s.nombreComercial}</td>
                    <td>{s.rfc || '—'}</td>
                    <td>{s.telefono || '—'}</td>
                    <td>{s.email || '—'}</td>
                    <td>{s.contacto || '—'}</td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: 40, color: 'var(--text-tertiary)' }}>
                      Sin proveedores
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : tab === 'warehouses' ? (
        <div style={{ display: 'grid', gap: 16 }}>
          {filtered.map((w: any, i: number) => (
            <div key={i} className="card">
              <div style={{ padding: '20px 24px' }}>
                <h3 style={{ margin: 0 }}>{w.nombre}</h3>
                <p style={{ margin: '4px 0', color: 'var(--text-secondary)', fontSize: 13 }}>
                  {w.codigo} · {w.direccion || 'Sin dirección'}
                </p>
                <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
                  <span style={{ fontSize: 13 }}>{w.metrosCuadrados || w.capM2 || 0} m²</span>
                  <span style={{ fontSize: 13 }}>{w._count?.zones || 0} zonas</span>
                  <span style={{ fontSize: 13 }}>{w._count?.locations || 0} ubicaciones</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card">
          <div className="card-body" style={{ padding: 0 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Nombre</th>
                  <th>Almacén</th>
                  <th>Tipo</th>
                  <th>Temperatura</th>
                  <th>Ubicaciones</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((z: any, i: number) => (
                  <tr key={i}>
                    <td><code>{z.codigo}</code></td>
                    <td style={{ fontWeight: 500 }}>{z.nombre}</td>
                    <td>{z.almacen?.nombre || '—'}</td>
                    <td><span className="badge badge-info">{z.tipoZona}</span></td>
                    <td>{z.temperatura || 'AMBIENTE'}</td>
                    <td style={{ fontWeight: 600 }}>{z._count?.locations || 0}</td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: 40, color: 'var(--text-tertiary)' }}>
                      Sin zonas
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* MODAL CREAR / EDITAR SKU (Giving Out WMS White/Teal Design) */}
      {isModalOpen && (
        <div
          className="modal-overlay"
          onClick={() => !submitting && setIsModalOpen(false)}
          style={{
            zIndex: 1200,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(15, 23, 42, 0.5)',
            backdropFilter: 'blur(4px)'
          }}
        >
          <div
            className="modal-content"
            onClick={e => e.stopPropagation()}
            style={{
              maxWidth: 760,
              width: '95%',
              maxHeight: '90vh',
              overflowY: 'auto',
              background: '#FFFFFF',
              borderRadius: 12,
              border: '1px solid #E5E7EB',
              boxShadow: '0 20px 45px -10px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(0, 0, 0, 0.05)'
            }}
          >
            {/* Modal Header */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '20px 24px',
              borderBottom: '1px solid #E5E7EB',
              background: '#FFFFFF'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{
                  width: 44,
                  height: 44,
                  borderRadius: 10,
                  background: 'rgba(13, 148, 136, 0.1)',
                  border: '1px solid rgba(13, 148, 136, 0.25)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0
                }}>
                  <Package size={24} color="#0D9488" />
                </div>
                <div>
                  <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: '#111827', letterSpacing: '-0.02em' }}>
                    {isEditing ? 'Editar producto' : 'Nuevo producto'}
                  </h2>
                  <p style={{ margin: '4px 0 0 0', fontSize: 13, color: '#6B7280', fontWeight: 500 }}>
                    {isEditing ? `Actualizar atributos en SkuMaster (${skuForm.codigo})` : 'Alta de producto en catálogo maestro'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => !submitting && setIsModalOpen(false)}
                disabled={submitting}
                style={{
                  color: '#4B5563',
                  padding: '6px 10px',
                  borderRadius: 6,
                  border: '1px solid #E5E7EB',
                  background: '#F9FAFB',
                  cursor: 'pointer'
                }}
                aria-label="Cerrar modal"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <form onSubmit={handleSubmitSku} style={{ padding: '20px 24px', background: '#FFFFFF' }}>
              {/* Error Banner */}
              {formError && (
                <div style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  padding: '12px 16px',
                  background: '#FEF2F2',
                  border: '1px solid #FCA5A5',
                  borderRadius: 8,
                  marginBottom: 16,
                  color: '#B91C1C',
                  fontSize: 13
                }}>
                  <AlertTriangle size={18} color="#DC2626" style={{ flexShrink: 0, marginTop: 1 }} />
                  <div>
                    <strong>Error: </strong> {formError}
                  </div>
                </div>
              )}

              {/* Sección 1: Identificación y Clasificación */}
              <div style={{ marginBottom: 18 }}>
                <h4 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#0D9488', fontWeight: 700, marginBottom: 12 }}>
                  1. Identificación y Depositante
                </h4>

                <div className="form-row" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
                  {/* Depositante */}
                  <div className="form-group">
                    <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
                      Depositante / Propietario <span style={{ color: '#DC2626', fontWeight: 700, marginLeft: 3 }}>*</span>
                    </label>
                    <select
                      className="form-select"
                      style={{ background: '#FFFFFF', border: '1px solid #D1D5DB', color: '#111827', borderRadius: 6 }}
                      value={skuForm.clienteId}
                      onChange={e => setSkuForm({ ...skuForm, clienteId: e.target.value })}
                      required
                    >
                      <option value="">Seleccione depositante...</option>
                      {clients.map(c => (
                        <option key={c.id} value={c.id}>
                          {c.nombreComercial || c.razonSocial} ({c.codigo})
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Código SKU */}
                  <div className="form-group">
                    <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
                      Código SKU <span style={{ color: '#DC2626', fontWeight: 700, marginLeft: 3 }}>*</span>
                    </label>
                    <input
                      className="form-input"
                      style={{ background: '#FFFFFF', border: '1px solid #D1D5DB', color: '#111827', borderRadius: 6 }}
                      placeholder="p.ej. CHA-CUE-L"
                      value={skuForm.codigo}
                      onChange={e => setSkuForm({ ...skuForm, codigo: e.target.value.toUpperCase() })}
                      required
                    />
                  </div>

                  {/* Código de barras */}
                  <div className="form-group">
                    <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
                      Código de Barras / UPC
                    </label>
                    <input
                      className="form-input"
                      style={{ background: '#FFFFFF', border: '1px solid #D1D5DB', color: '#111827', borderRadius: 6 }}
                      placeholder="7501234567890"
                      value={skuForm.codigoBarras}
                      onChange={e => setSkuForm({ ...skuForm, codigoBarras: e.target.value })}
                    />
                  </div>
                </div>

                {/* Descripción */}
                <div className="form-group" style={{ marginTop: 12 }}>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
                    Descripción del Producto <span style={{ color: '#DC2626', fontWeight: 700, marginLeft: 3 }}>*</span>
                  </label>
                  <input
                    className="form-input"
                    style={{ background: '#FFFFFF', border: '1px solid #D1D5DB', color: '#111827', borderRadius: 6 }}
                    placeholder="Descripción completa del artículo para etiquetado e inventario"
                    value={skuForm.descripcion}
                    onChange={e => setSkuForm({ ...skuForm, descripcion: e.target.value })}
                    required
                  />
                </div>

                {/* Categoría, Subcategoría y UoM */}
                <div className="form-row" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginTop: 12 }}>
                  <div className="form-group">
                    <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
                      Categoría <span style={{ color: '#DC2626', fontWeight: 700, marginLeft: 3 }}>*</span>
                    </label>
                    <select
                      className="form-select"
                      style={{ background: '#FFFFFF', border: '1px solid #D1D5DB', color: '#111827', borderRadius: 6 }}
                      value={skuForm.categoria}
                      onChange={e => setSkuForm({ ...skuForm, categoria: e.target.value })}
                      required
                    >
                      {CATEGORIAS.map(cat => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                    </select>
                  </div>

                  <div className="form-group">
                    <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
                      Subcategoría
                    </label>
                    <input
                      className="form-input"
                      style={{ background: '#FFFFFF', border: '1px solid #D1D5DB', color: '#111827', borderRadius: 6 }}
                      placeholder="p.ej. Chamarras, Botas"
                      value={skuForm.subcategoria}
                      onChange={e => setSkuForm({ ...skuForm, subcategoria: e.target.value })}
                    />
                  </div>

                  <div className="form-group">
                    <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
                      Unidad Base (UoM) <span style={{ color: '#DC2626', fontWeight: 700, marginLeft: 3 }}>*</span>
                    </label>
                    <select
                      className="form-select"
                      style={{ background: '#FFFFFF', border: '1px solid #D1D5DB', color: '#111827', borderRadius: 6 }}
                      value={skuForm.uomBase}
                      onChange={e => setSkuForm({ ...skuForm, uomBase: e.target.value })}
                      required
                    >
                      {UOMS.map(u => (
                        <option key={u.value} value={u.value}>{u.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Sección 2: Configuración de Empaque y Almacenaje */}
              <div style={{ marginBottom: 18, borderTop: '1px solid #E5E7EB', paddingTop: 16 }}>
                <h4 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#0D9488', fontWeight: 700, marginBottom: 12 }}>
                  2. Empaque y Condiciones Físicas
                </h4>

                <div className="form-row" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
                  {/* Capacidad de empaque */}
                  <div className="form-group">
                    <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
                      Capacidad Empaque (Pzas/Caja)
                    </label>
                    <input
                      className="form-input"
                      style={{ background: '#FFFFFF', border: '1px solid #D1D5DB', color: '#111827', borderRadius: 6 }}
                      type="number"
                      min="1"
                      step="1"
                      placeholder="p.ej. 4"
                      value={skuForm.capacidadEmpaque}
                      onChange={e => handleCapacidadEmpaqueChange(e.target.value)}
                    />
                    <span style={{ fontSize: 12, color: '#6B7280', marginTop: 4, display: 'block', lineHeight: 1.4 }}>
                      Fuente de verdad para validación de bultos en ASN.
                    </span>
                  </div>

                  {/* Descripción de empaque */}
                  <div className="form-group">
                    <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
                      Descripción de Empaque
                    </label>
                    <input
                      className="form-input"
                      style={{ background: '#FFFFFF', border: '1px solid #D1D5DB', color: '#111827', borderRadius: 6 }}
                      placeholder="p.ej. Caja x4"
                      value={skuForm.descripcionEmpaque}
                      onChange={e => {
                        setAutoEmpaqueText(false);
                        setSkuForm({ ...skuForm, descripcionEmpaque: e.target.value });
                      }}
                    />
                    <span style={{ fontSize: 12, color: '#6B7280', marginTop: 4, display: 'block', lineHeight: 1.4 }}>
                      Sugerencia autogenerada, editable por el usuario.
                    </span>
                  </div>

                  {/* Temperatura */}
                  <div className="form-group">
                    <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
                      Temperatura Requerida
                    </label>
                    <select
                      className="form-select"
                      style={{ background: '#FFFFFF', border: '1px solid #D1D5DB', color: '#111827', borderRadius: 6 }}
                      value={skuForm.temperaturaRequerida}
                      onChange={e => setSkuForm({ ...skuForm, temperaturaRequerida: e.target.value })}
                    >
                      {TEMPERATURAS.map(t => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Peso y Volumen */}
                <div className="form-row" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginTop: 12 }}>
                  <div className="form-group">
                    <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
                      Peso (Kg)
                    </label>
                    <input
                      className="form-input"
                      style={{ background: '#FFFFFF', border: '1px solid #D1D5DB', color: '#111827', borderRadius: 6 }}
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="p.ej. 0.85"
                      value={skuForm.pesoKg}
                      onChange={e => setSkuForm({ ...skuForm, pesoKg: e.target.value })}
                    />
                  </div>

                  <div className="form-group">
                    <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
                      Volumen (m³)
                    </label>
                    <input
                      className="form-input"
                      style={{ background: '#FFFFFF', border: '1px solid #D1D5DB', color: '#111827', borderRadius: 6 }}
                      type="number"
                      step="0.001"
                      min="0"
                      placeholder="p.ej. 0.015"
                      value={skuForm.volumenM3}
                      onChange={e => setSkuForm({ ...skuForm, volumenM3: e.target.value })}
                    />
                  </div>

                  <div className="form-group">
                    <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
                      Marca
                    </label>
                    <input
                      className="form-input"
                      style={{ background: '#FFFFFF', border: '1px solid #D1D5DB', color: '#111827', borderRadius: 6 }}
                      placeholder="p.ej. Fashion Sport"
                      value={skuForm.marca}
                      onChange={e => setSkuForm({ ...skuForm, marca: e.target.value })}
                    />
                  </div>

                  <div className="form-group">
                    <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
                      Talla / Color
                    </label>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input
                        className="form-input"
                        style={{ background: '#FFFFFF', border: '1px solid #D1D5DB', color: '#111827', borderRadius: 6, flex: 1 }}
                        placeholder="Talla"
                        value={skuForm.talla}
                        onChange={e => setSkuForm({ ...skuForm, talla: e.target.value })}
                      />
                      <input
                        className="form-input"
                        style={{ background: '#FFFFFF', border: '1px solid #D1D5DB', color: '#111827', borderRadius: 6, flex: 1 }}
                        placeholder="Color"
                        value={skuForm.color}
                        onChange={e => setSkuForm({ ...skuForm, color: e.target.value })}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Sección 3: Reglas de Trazabilidad */}
              <div style={{ borderTop: '1px solid #E5E7EB', paddingTop: 16, marginBottom: 20 }}>
                <h4 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#0D9488', fontWeight: 700, marginBottom: 12 }}>
                  3. Trazabilidad y Calidad
                </h4>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
                  {/* Requiere Lote */}
                  <div style={{
                    padding: 12,
                    borderRadius: 8,
                    background: skuForm.requiereLote ? '#FFFBEB' : '#F9FAFB',
                    border: `1px solid ${skuForm.requiereLote ? '#FCD34D' : '#E5E7EB'}`
                  }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontWeight: 600, color: skuForm.requiereLote ? '#92400E' : '#374151', fontSize: 13 }}>
                      <input
                        type="checkbox"
                        checked={skuForm.requiereLote}
                        onChange={e => setSkuForm({ ...skuForm, requiereLote: e.target.checked })}
                      />
                      Requiere Número de Lote
                    </label>
                    {skuForm.requiereLote && (
                      <p style={{ margin: '8px 0 0 26px', fontSize: 12, color: '#B45309', lineHeight: 1.4, fontWeight: 500 }}>
                        ⚠️ <strong>Regla ASN:</strong> Todas las recepciones y previos futuros de este producto requerirán capturar el número de lote obligatorio.
                      </p>
                    )}
                  </div>

                  {/* Requiere Caducidad */}
                  <div style={{
                    padding: 12,
                    borderRadius: 8,
                    background: skuForm.requiereCaducidad ? '#F0FDFA' : '#F9FAFB',
                    border: `1px solid ${skuForm.requiereCaducidad ? '#99F6E4' : '#E5E7EB'}`
                  }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontWeight: 600, color: skuForm.requiereCaducidad ? '#115E59' : '#374151', fontSize: 13 }}>
                      <input
                        type="checkbox"
                        checked={skuForm.requiereCaducidad}
                        onChange={e => setSkuForm({ ...skuForm, requiereCaducidad: e.target.checked })}
                      />
                      Requiere Fecha de Caducidad
                    </label>
                    {skuForm.requiereCaducidad && (
                      <p style={{ margin: '8px 0 0 26px', fontSize: 12, color: '#0F766E', lineHeight: 1.4, fontWeight: 500 }}>
                        ⚠️ <strong>Regla Recepción:</strong> Las recepciones futuras deberán incluir obligatoriamente fecha de vencimiento/caducidad (FEFO).
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Modal Footer */}
              <div style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: 12,
                borderTop: '1px solid #E5E7EB',
                paddingTop: 16
              }}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setIsModalOpen(false)}
                  disabled={submitting}
                  style={{ color: '#4B5563', border: '1px solid #D1D5DB', background: '#FFFFFF' }}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={submitting}
                  style={{ minWidth: 140, fontWeight: 600, background: '#0D9488', borderColor: '#0D9488', color: '#FFFFFF' }}
                >
                  {submitting ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <RefreshCw className="animate-spin" size={14} /> Guardando...
                    </span>
                  ) : isEditing ? 'Guardar Cambios' : 'Crear Producto'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL 1: CONFIRMAR BORRADO FÍSICO SEGURO                 */}
      {/* ======================================================== */}
      {skuToDelete && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(15, 23, 42, 0.55)',
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backdropFilter: 'blur(2px)',
          padding: 16,
        }}>
          <div style={{
            background: '#FFFFFF',
            borderRadius: 12,
            padding: 24,
            maxWidth: 500,
            width: '100%',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.15), 0 10px 10px -5px rgba(0, 0, 0, 0.05)',
            border: '1px solid #E5E7EB',
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 16 }}>
              <div style={{
                width: 44,
                height: 44,
                borderRadius: '50%',
                background: 'rgba(239, 68, 68, 0.12)',
                color: '#DC2626',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}>
                <Trash2 size={22} />
              </div>
              <div style={{ flex: 1 }}>
                <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#111827' }}>
                  Eliminar producto definitivamente
                </h3>
                <p style={{ margin: '4px 0 0 0', fontSize: 13, color: '#6B7280' }}>
                  SKU: <strong style={{ color: '#111827' }}>{skuToDelete.codigo}</strong> · {skuToDelete.cliente?.nombreComercial || 'Depositante'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => { setSkuToDelete(null); setActionError(null); }}
                disabled={actionLoading}
                style={{ background: 'none', border: 'none', color: '#9CA3AF', cursor: 'pointer', padding: 4 }}
              >
                <X size={20} />
              </button>
            </div>

            <div style={{
              background: '#FEF2F2',
              border: '1px solid #FECACA',
              borderRadius: 8,
              padding: 14,
              marginBottom: 16,
              fontSize: 14,
              lineHeight: 1.5,
              color: '#991B1B',
            }}>
              ¿Eliminar definitivamente {skuToDelete.codigo}? Este producto todavía no tiene historial operativo y puede eliminarse de forma segura.
            </div>

            <p style={{ fontSize: 13, color: '#4B5563', margin: '0 0 16px 0', lineHeight: 1.5 }}>
              Descripción: <strong>{skuToDelete.descripcion}</strong>
              <br />
              <span style={{ fontSize: 12, color: '#6B7280' }}>
                Esta acción ejecutará una eliminación física en el catálogo. Si el producto llegara a contar con movimientos o partidas asociadas, la base de datos rechazará la operación para proteger la trazabilidad.
              </span>
            </p>

            {actionError && (
              <div style={{
                background: '#FEF2F2',
                border: '1px solid #F87171',
                borderRadius: 6,
                padding: 12,
                marginBottom: 16,
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                fontSize: 13,
                color: '#B91C1C',
              }}>
                <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 2 }} />
                <span>{actionError}</span>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => { setSkuToDelete(null); setActionError(null); }}
                disabled={actionLoading}
                style={{ color: '#4B5563', border: '1px solid #D1D5DB', background: '#FFFFFF' }}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn"
                onClick={handleConfirmDelete}
                disabled={actionLoading}
                style={{
                  background: '#DC2626',
                  borderColor: '#DC2626',
                  color: '#FFFFFF',
                  fontWeight: 600,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '8px 16px',
                }}
              >
                {actionLoading ? (
                  <>
                    <RefreshCw className="animate-spin" size={14} /> Eliminando...
                  </>
                ) : (
                  <>
                    <Trash2 size={14} /> Eliminar definitivamente
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL 2: CONFIRMAR BAJA LÓGICA (DESACTIVAR)              */}
      {/* ======================================================== */}
      {skuToDeactivate && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(15, 23, 42, 0.55)',
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backdropFilter: 'blur(2px)',
          padding: 16,
        }}>
          <div style={{
            background: '#FFFFFF',
            borderRadius: 12,
            padding: 24,
            maxWidth: 500,
            width: '100%',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.15), 0 10px 10px -5px rgba(0, 0, 0, 0.05)',
            border: '1px solid #E5E7EB',
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 16 }}>
              <div style={{
                width: 44,
                height: 44,
                borderRadius: '50%',
                background: 'rgba(245, 158, 11, 0.12)',
                color: '#D97706',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}>
                <Power size={22} />
              </div>
              <div style={{ flex: 1 }}>
                <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#111827' }}>
                  Desactivar producto
                </h3>
                <p style={{ margin: '4px 0 0 0', fontSize: 13, color: '#6B7280' }}>
                  SKU: <strong style={{ color: '#111827' }}>{skuToDeactivate.codigo}</strong> · {skuToDeactivate.cliente?.nombreComercial || 'Depositante'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => { setSkuToDeactivate(null); setActionError(null); }}
                disabled={actionLoading}
                style={{ background: 'none', border: 'none', color: '#9CA3AF', cursor: 'pointer', padding: 4 }}
              >
                <X size={20} />
              </button>
            </div>

            <div style={{
              background: '#FFFBEB',
              border: '1px solid #FDE68A',
              borderRadius: 8,
              padding: 14,
              marginBottom: 16,
              fontSize: 14,
              lineHeight: 1.5,
              color: '#92400E',
            }}>
              ¿Desactivar este producto? Ya no podrá utilizarse en nuevos movimientos, pero su historial permanecerá intacto.
            </div>

            <p style={{ fontSize: 13, color: '#4B5563', margin: '0 0 16px 0', lineHeight: 1.5 }}>
              Producto: <strong>{skuToDeactivate.descripcion}</strong>
              <br />
              <span style={{ fontSize: 12, color: '#6B7280' }}>
                El SKU mostrará la etiqueta <strong>INACTIVO</strong>. Se bloqueará su uso en nuevos Previos ASN y órdenes de salida, pero se preservará íntegramente en consultas históricas, inventario y kárdex.
              </span>
            </p>

            {actionError && (
              <div style={{
                background: '#FEF2F2',
                border: '1px solid #F87171',
                borderRadius: 6,
                padding: 12,
                marginBottom: 16,
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                fontSize: 13,
                color: '#B91C1C',
              }}>
                <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 2 }} />
                <span>{actionError}</span>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => { setSkuToDeactivate(null); setActionError(null); }}
                disabled={actionLoading}
                style={{ color: '#4B5563', border: '1px solid #D1D5DB', background: '#FFFFFF' }}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn"
                onClick={handleConfirmDeactivate}
                disabled={actionLoading}
                style={{
                  background: '#D97706',
                  borderColor: '#D97706',
                  color: '#FFFFFF',
                  fontWeight: 600,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '8px 16px',
                }}
              >
                {actionLoading ? (
                  <>
                    <RefreshCw className="animate-spin" size={14} /> Desactivando...
                  </>
                ) : (
                  <>
                    <Power size={14} /> Desactivar producto
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL 3: CONFIRMAR REACTIVACIÓN                          */}
      {/* ======================================================== */}
      {skuToReactivate && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(15, 23, 42, 0.55)',
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backdropFilter: 'blur(2px)',
          padding: 16,
        }}>
          <div style={{
            background: '#FFFFFF',
            borderRadius: 12,
            padding: 24,
            maxWidth: 500,
            width: '100%',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.15), 0 10px 10px -5px rgba(0, 0, 0, 0.05)',
            border: '1px solid #E5E7EB',
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 16 }}>
              <div style={{
                width: 44,
                height: 44,
                borderRadius: '50%',
                background: 'rgba(13, 148, 136, 0.12)',
                color: '#0D9488',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}>
                <Check size={22} />
              </div>
              <div style={{ flex: 1 }}>
                <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#111827' }}>
                  Reactivar producto
                </h3>
                <p style={{ margin: '4px 0 0 0', fontSize: 13, color: '#6B7280' }}>
                  SKU: <strong style={{ color: '#111827' }}>{skuToReactivate.codigo}</strong> · {skuToReactivate.cliente?.nombreComercial || 'Depositante'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => { setSkuToReactivate(null); setActionError(null); }}
                disabled={actionLoading}
                style={{ background: 'none', border: 'none', color: '#9CA3AF', cursor: 'pointer', padding: 4 }}
              >
                <X size={20} />
              </button>
            </div>

            <div style={{
              background: '#F0FDF4',
              border: '1px solid #BBF7D0',
              borderRadius: 8,
              padding: 14,
              marginBottom: 16,
              fontSize: 14,
              lineHeight: 1.5,
              color: '#166534',
            }}>
              ¿Reactivar este producto? Volverá a estar disponible para recepciones y movimientos en el sistema.
            </div>

            <p style={{ fontSize: 13, color: '#4B5563', margin: '0 0 16px 0', lineHeight: 1.5 }}>
              Producto: <strong>{skuToReactivate.descripcion}</strong>
              <br />
              <span style={{ fontSize: 12, color: '#6B7280' }}>
                El SKU volverá al estado <strong>ACTIVO</strong> y podrá ser seleccionado normalmente en nuevos arribos ASN, manifiestos Excel y órdenes de salida.
              </span>
            </p>

            {actionError && (
              <div style={{
                background: '#FEF2F2',
                border: '1px solid #F87171',
                borderRadius: 6,
                padding: 12,
                marginBottom: 16,
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                fontSize: 13,
                color: '#B91C1C',
              }}>
                <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 2 }} />
                <span>{actionError}</span>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => { setSkuToReactivate(null); setActionError(null); }}
                disabled={actionLoading}
                style={{ color: '#4B5563', border: '1px solid #D1D5DB', background: '#FFFFFF' }}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn"
                onClick={handleConfirmReactivate}
                disabled={actionLoading}
                style={{
                  background: '#0D9488',
                  borderColor: '#0D9488',
                  color: '#FFFFFF',
                  fontWeight: 600,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '8px 16px',
                }}
              >
                {actionLoading ? (
                  <>
                    <RefreshCw className="animate-spin" size={14} /> Reactivando...
                  </>
                ) : (
                  <>
                    <Check size={14} /> Reactivar producto
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
