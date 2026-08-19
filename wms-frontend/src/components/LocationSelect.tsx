import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  MapPin, Search, ChevronDown, Check, Sparkles, Layers,
  Box, AlertTriangle, CheckCircle2, X, Filter
} from 'lucide-react';

export interface LocationItem {
  id: string;
  codigo: string;
  pasillo: string;
  rack: string;
  nivel: string;
  posicion?: string;
  tipoUbicacion: string;
  temperatura: string;
  capacidadUnits: number;
  ocupacion: number;
  estado: string;
  activo?: boolean;
  zonaId?: string;
  zona?: {
    codigo: string;
    nombre: string;
    tipoZona?: string;
    temperatura?: string;
  };
  lotes?: any[];
}

interface LocationSelectProps {
  locations: LocationItem[];
  value: string;
  onChange: (locationId: string, locationObj?: LocationItem) => void;
  sku?: any;
  client?: any;
  isConforme?: boolean;
  quantity?: number;
  label?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
}

interface ScoredLocation {
  location: LocationItem;
  score: number;
  reasons: string[];
  isRecommended: boolean;
  zoneType: 'TEXTIL' | 'ALIMENTOS' | 'CUARENTENA' | 'GENERAL';
}

export function LocationSelect({
  locations,
  value,
  onChange,
  sku,
  client,
  isConforme = true,
  quantity = 0,
  label,
  placeholder = 'Seleccionar ubicación...',
  required = false,
  disabled = false,
}: LocationSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterTab, setFilterTab] = useState<'SUGGESTED' | 'ZONE' | 'FREE' | 'ALL'>('SUGGESTED');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // --- MOTOR DE ASIGNACIÓN INTELIGENTE (PUTAWAY ENGINE) ---
  const scoredLocations: ScoredLocation[] = useMemo(() => {
    if (!locations || locations.length === 0) return [];

    const activeLocs = locations.filter(l => l.activo !== false && l.estado !== 'BLOQUEADO');

    return activeLocs.map(loc => {
      let score = 0;
      const reasons: string[] = [];
      const zoneCode = loc.zona?.codigo?.toUpperCase() || '';
      const zoneName = loc.zona?.nombre?.toUpperCase() || '';
      const pasillo = loc.pasillo?.toUpperCase() || '';
      const rack = loc.rack?.toUpperCase() || '';
      const nivel = loc.nivel?.toUpperCase() || '';
      const ocupacion = loc.ocupacion || 0;
      const capacidad = loc.capacidadUnits || 50;
      const espacioLibre = Math.max(0, capacidad - ocupacion);

      // Determinar tipo de zona visual
      let zoneType: 'TEXTIL' | 'ALIMENTOS' | 'CUARENTENA' | 'GENERAL' = 'GENERAL';
      if (zoneCode.includes('ALM-A') || zoneName.includes('TEXTIL') || zoneName.includes('ROPA') || pasillo.startsWith('A')) {
        zoneType = 'TEXTIL';
      } else if (zoneCode.includes('ALM-B') || zoneName.includes('ALIMENTO') || zoneName.includes('COMIDA') || pasillo.startsWith('B')) {
        zoneType = 'ALIMENTOS';
      } else if (zoneCode.includes('DEV') || zoneName.includes('DEVOLUCION') || zoneName.includes('CUARENTENA') || pasillo.startsWith('DEV')) {
        zoneType = 'CUARENTENA';
      }

      if (isConforme) {
        // === CASO 1: ZONA CONFORME (LIBERADO) ===
        // 1.1 Zona asignada al cliente o giro de negocio
        const isRopa = sku?.categoria === 'PRENDA' || client?.giro === 'ROPA';
        const isComida = sku?.categoria === 'ALIMENTO' || client?.giro === 'COMIDA';

        if (client?.zonaAsignadaId && loc.zonaId === client.zonaAsignadaId) {
          score += 1500;
          reasons.push('Zona preferente del depositante');
        } else if (isRopa && zoneType === 'TEXTIL') {
          score += 1200;
          reasons.push('Zona Textil / Prendas (ALM-A)');
        } else if (isComida && zoneType === 'ALIMENTOS') {
          score += 1200;
          reasons.push('Zona Alimentos (ALM-B)');
        } else if (zoneType === 'CUARENTENA') {
          score -= 3000; // No almacenar conforme en cuarentena
        }

        // 1.2 Temperatura requerida
        if (sku?.temperaturaRequerida && sku.temperaturaRequerida !== 'AMBIENTE') {
          if (loc.temperatura === sku.temperaturaRequerida) {
            score += 800;
            reasons.push(`Temperatura controlada (${sku.temperaturaRequerida})`);
          } else {
            score -= 2000;
          }
        }

        // 1.3 Reglas de Picking y Rotación (FIFO vs FEFO)
        const regla = client?.reglaInventario || 'FIFO';
        if (regla === 'FIFO') {
          // Nivel 1 es nivel de suelo (Fast Picking rápido)
          if (nivel === 'N1' || nivel === '1') {
            score += 300;
            reasons.push('Nivel 1 (Picking rápido FIFO)');
          } else if (nivel === 'N2' || nivel === '2') {
            score += 150;
          }
        } else if (regla === 'FEFO') {
          // En FEFO agrupamos en estantería accesible
          if (nivel === 'N1' || nivel === 'N2') {
            score += 250;
            reasons.push('Nivel accesible (Control FEFO)');
          }
        }

        // 1.4 Pasillos y racks cercanos a la entrada / staging
        if (rack === 'R01' || rack === '01') score += 100;
        else if (rack === 'R02' || rack === '02') score += 60;

        // 1.5 Capacidad y disponibilidad
        if (ocupacion === 0) {
          score += 200;
          reasons.push('100% Libre');
        } else if (espacioLibre >= quantity && espacioLibre > 0) {
          score += 100 + (espacioLibre / capacidad) * 50;
          reasons.push(`Espacio disponible (${espacioLibre} uds)`);
        } else if (espacioLibre <= 0) {
          score -= 4000; // Saturada
        }

      } else {
        // === CASO 2: ZONA NO CONFORME (CUARENTENA / DAÑADO) ===
        if (zoneType === 'CUARENTENA' || loc.tipoUbicacion === 'CUARENTENA' || loc.codigo.startsWith('DEV')) {
          score += 2500;
          reasons.push('Zona de Cuarentena / Retención');
        } else if (loc.tipoUbicacion === 'PISO') {
          score += 800;
          reasons.push('Ubicación de Piso / Aislamiento');
        } else {
          score -= 1000;
        }

        if (espacioLibre > 0) {
          score += 200;
        }
      }

      return {
        location: loc,
        score,
        reasons,
        isRecommended: false,
        zoneType
      };
    }).sort((a, b) => b.score - a.score);
  }, [locations, sku, client, isConforme, quantity]);

  // Marcar la mejor sugerencia
  const rankedList = useMemo(() => {
    if (scoredLocations.length === 0) return [];
    return scoredLocations.map((item, idx) => ({
      ...item,
      isRecommended: idx === 0 && item.score > 0
    }));
  }, [scoredLocations]);

  const bestRecommendation = rankedList.find(i => i.isRecommended);

  // --- AUTO-SELECCIÓN INTELIGENTE ---
  // Si no hay valor o cambió de producto/línea, pre-seleccionar automáticamente la mejor ubicación
  useEffect(() => {
    if ((!value || value === '') && bestRecommendation) {
      onChange(bestRecommendation.location.id, bestRecommendation.location);
    }
  }, [bestRecommendation, value]);

  // Manejador de clicks fuera del dropdown
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Autofocus al abrir buscador
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isOpen]);

  // Ubicación actualmente seleccionada
  const selectedObj = locations.find(l => l.id === value);
  const selectedScored = rankedList.find(s => s.location.id === value);

  // Filtrado de la lista en dropdown
  const filteredOptions = useMemo(() => {
    return rankedList.filter(item => {
      const loc = item.location;
      const term = searchTerm.toLowerCase().trim();

      // Búsqueda por texto
      const matchesSearch = !term ||
        loc.codigo.toLowerCase().includes(term) ||
        loc.pasillo.toLowerCase().includes(term) ||
        loc.rack.toLowerCase().includes(term) ||
        loc.nivel.toLowerCase().includes(term) ||
        loc.zona?.nombre?.toLowerCase().includes(term) ||
        loc.zona?.codigo?.toLowerCase().includes(term);

      if (!matchesSearch) return false;

      // Filtro por pestaña
      if (filterTab === 'SUGGESTED') {
        return item.score > 500 || item.isRecommended;
      }
      if (filterTab === 'ZONE') {
        if (isConforme) {
          const isRopa = sku?.categoria === 'PRENDA' || client?.giro === 'ROPA';
          return isRopa ? item.zoneType === 'TEXTIL' : item.zoneType === 'ALIMENTOS';
        }
        return item.zoneType === 'CUARENTENA';
      }
      if (filterTab === 'FREE') {
        return (loc.ocupacion || 0) === 0;
      }
      return true;
    });
  }, [rankedList, searchTerm, filterTab, isConforme, sku, client]);

  // Color de badge de zona
  const getZoneBadgeStyle = (zoneType: string) => {
    switch (zoneType) {
      case 'TEXTIL':
        return { bg: 'rgba(124, 58, 237, 0.1)', border: 'rgba(124, 58, 237, 0.3)', text: '#7c3aed', label: 'ALM-A Textil' };
      case 'ALIMENTOS':
        return { bg: 'rgba(16, 185, 129, 0.1)', border: 'rgba(16, 185, 129, 0.3)', text: '#059669', label: 'ALM-B Alimentos' };
      case 'CUARENTENA':
        return { bg: 'rgba(245, 158, 11, 0.1)', border: 'rgba(245, 158, 11, 0.3)', text: '#d97706', label: 'DEV Cuarentena' };
      default:
        return { bg: 'rgba(37, 99, 235, 0.1)', border: 'rgba(37, 99, 235, 0.3)', text: '#2563eb', label: 'General' };
    }
  };

  return (
    <div className="location-select-container" ref={dropdownRef} style={{ position: 'relative', width: '100%' }}>
      {label && (
        <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <span>{label} {required && <span className="required">*</span>}</span>
          {selectedScored?.isRecommended && (
            <span style={{ 
              fontSize: 11, 
              fontWeight: 600, 
              color: isConforme ? 'var(--emerald)' : 'var(--orange)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 3,
              background: isConforme ? 'rgba(16, 185, 129, 0.1)' : 'rgba(245, 158, 11, 0.1)',
              padding: '1px 6px',
              borderRadius: 4
            }}>
              <Sparkles size={11} /> Sugerida por IA/Layout
            </span>
          )}
        </label>
      )}

      {/* --- TRIGGER BUTTON (PRO UI) --- */}
      <div
        onClick={() => !disabled && setIsOpen(!isOpen)}
        style={{
          width: '100%',
          padding: '10px 14px',
          background: disabled ? 'var(--bg-secondary)' : 'var(--bg-card)',
          border: isOpen 
            ? '2px solid var(--primary)' 
            : selectedScored?.isRecommended
            ? `1.5px solid ${isConforme ? 'rgba(16, 185, 129, 0.6)' : 'rgba(245, 158, 11, 0.6)'}`
            : '1px solid var(--border)',
          borderRadius: 8,
          cursor: disabled ? 'not-allowed' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          transition: 'all 0.2s',
          boxShadow: isOpen ? '0 0 0 3px rgba(37, 99, 235, 0.15)' : 'none',
          minHeight: 44
        }}
      >
        {selectedObj ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
            <div style={{
              width: 32,
              height: 32,
              borderRadius: 6,
              background: isConforme ? 'rgba(16, 185, 129, 0.12)' : 'rgba(245, 158, 11, 0.12)',
              color: isConforme ? 'var(--emerald)' : 'var(--orange)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0
            }}>
              <MapPin size={16} />
            </div>

            <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 700, fontSize: 14, fontFamily: 'monospace', color: 'var(--text-primary)' }}>
                  {selectedObj.codigo}
                </span>

                {/* Badge de Zona */}
                {selectedScored && (
                  <span style={{
                    fontSize: 10,
                    fontWeight: 600,
                    padding: '2px 6px',
                    borderRadius: 4,
                    background: getZoneBadgeStyle(selectedScored.zoneType).bg,
                    color: getZoneBadgeStyle(selectedScored.zoneType).text,
                    border: `1px solid ${getZoneBadgeStyle(selectedScored.zoneType).border}`
                  }}>
                    {getZoneBadgeStyle(selectedScored.zoneType).label}
                  </span>
                )}

                {/* Nivel */}
                <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                  Pasillo {selectedObj.pasillo} • Nivel {selectedObj.nivel}
                </span>
              </div>

              {/* Barra de ocupación y razón */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2, fontSize: 11, color: 'var(--text-tertiary)' }}>
                <span style={{ fontWeight: 500, color: (selectedObj.ocupacion || 0) === 0 ? 'var(--emerald)' : 'var(--text-secondary)' }}>
                  {(selectedObj.ocupacion || 0) === 0 ? '🟢 100% Libre' : `Ocupación: ${selectedObj.ocupacion}/${selectedObj.capacidadUnits || 50} uds`}
                </span>
                {selectedScored?.reasons && selectedScored.reasons.length > 0 && (
                  <span style={{ color: 'var(--text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    • {selectedScored.reasons[0]}
                  </span>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-tertiary)' }}>
            <MapPin size={16} />
            <span>{placeholder}</span>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--text-tertiary)' }}>
          {selectedObj && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ padding: '2px 4px', height: 'auto' }}
              onClick={(e) => {
                e.stopPropagation();
                onChange('');
              }}
              title="Limpiar selección"
            >
              <X size={14} />
            </button>
          )}
          <ChevronDown size={16} style={{ transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
        </div>
      </div>

      {/* --- DROPDOWN PANEL (PRO UI SEARCHABLE) --- */}
      {isOpen && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 6px)',
          left: 0,
          right: 0,
          background: '#ffffff',
          color: '#0f172a',
          border: '1px solid #cbd5e1',
          borderRadius: 10,
          boxShadow: '0 20px 45px rgba(0,0,0,0.25), 0 4px 14px rgba(0,0,0,0.1)',
          zIndex: 99999,
          overflow: 'hidden',
          animation: 'scaleIn 0.15s ease-out',
          minWidth: 320
        }}>
          {/* BUSCADOR DENTRO DEL DROPDOWN */}
          <div style={{ padding: '10px 12px', borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <Search size={15} style={{ position: 'absolute', left: 10, color: '#64748b' }} />
              <input
                ref={searchInputRef}
                type="text"
                className="form-input"
                placeholder="Buscar ubicación (ej. A01, N1, Textil, Libre)..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                style={{ paddingLeft: 32, fontSize: 13, height: 34, background: '#ffffff', color: '#0f172a', border: '1px solid #cbd5e1' }}
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  style={{ position: 'absolute', right: 8, background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}
                >
                  <X size={14} />
                </button>
              )}
            </div>

            {/* PESTAÑAS DE FILTRO */}
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              {[
                { id: 'SUGGESTED', label: '⭐ Sugeridas' },
                { id: 'ZONE', label: isConforme ? '📍 Misma Zona' : '⚠️ Cuarentena' },
                { id: 'FREE', label: '🟢 100% Libres' },
                { id: 'ALL', label: '📦 Todas' },
              ].map(tab => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setFilterTab(tab.id as any)}
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    padding: '3px 8px',
                    borderRadius: 4,
                    border: '1px solid ' + (filterTab === tab.id ? 'var(--primary)' : '#e2e8f0'),
                    cursor: 'pointer',
                    background: filterTab === tab.id ? 'var(--primary)' : '#ffffff',
                    color: filterTab === tab.id ? '#ffffff' : '#475569',
                    transition: 'all 0.15s'
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* LISTA DE UBICACIONES CON SCROLL */}
          <div style={{ maxHeight: 250, overflowY: 'auto', padding: '4px 0', background: '#ffffff' }}>
            {filteredOptions.length === 0 ? (
              <div style={{ padding: '24px 16px', textAlign: 'center', color: '#64748b', fontSize: 13, background: '#ffffff' }}>
                <Box size={24} style={{ margin: '0 auto 6px', opacity: 0.4 }} />
                No se encontraron ubicaciones con ese criterio.
              </div>
            ) : (
              filteredOptions.map(({ location: loc, score, reasons, isRecommended, zoneType }) => {
                const isSelected = loc.id === value;
                const badgeInfo = getZoneBadgeStyle(zoneType);
                const ocupacion = loc.ocupacion || 0;
                const capacidad = loc.capacidadUnits || 50;
                const pct = Math.round((ocupacion / capacidad) * 100);

                return (
                  <div
                    key={loc.id}
                    onClick={() => {
                      onChange(loc.id, loc);
                      setIsOpen(false);
                    }}
                    style={{
                      padding: '8px 14px',
                      cursor: 'pointer',
                      borderBottom: '1px solid #f1f5f9',
                      background: isSelected
                        ? '#eff6ff'
                        : isRecommended
                        ? '#f0fdf4'
                        : '#ffffff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 10,
                      transition: 'background 0.15s'
                    }}
                    onMouseEnter={e => {
                      if (!isSelected) (e.currentTarget as HTMLElement).style.background = '#f8fafc';
                    }}
                    onMouseLeave={e => {
                      if (!isSelected) (e.currentTarget as HTMLElement).style.background = isRecommended ? '#f0fdf4' : '#ffffff';
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontWeight: 700, fontSize: 13, fontFamily: 'monospace', color: 'var(--text-primary)' }}>
                          {loc.codigo}
                        </span>

                        <span style={{
                          fontSize: 10,
                          fontWeight: 600,
                          padding: '1px 5px',
                          borderRadius: 4,
                          background: badgeInfo.bg,
                          color: badgeInfo.text,
                          border: `1px solid ${badgeInfo.border}`
                        }}>
                          {badgeInfo.label}
                        </span>

                        {isRecommended && (
                          <span style={{
                            fontSize: 10,
                            fontWeight: 700,
                            padding: '1px 6px',
                            borderRadius: 4,
                            background: isConforme ? 'rgba(16, 185, 129, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                            color: isConforme ? 'var(--emerald)' : 'var(--orange)',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 3
                          }}>
                            <Sparkles size={10} /> Óptima
                          </span>
                        )}
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3, fontSize: 11, color: 'var(--text-tertiary)' }}>
                        <span>Pasillo {loc.pasillo} • Rack {loc.rack} • Nivel {loc.nivel}</span>
                        <span>• Capacidad: {ocupacion}/{capacidad} uds ({100 - pct}% libre)</span>
                      </div>

                      {reasons.length > 0 && (
                        <div style={{ fontSize: 11, color: isRecommended ? (isConforme ? 'var(--emerald)' : 'var(--orange)') : 'var(--text-secondary)', marginTop: 2 }}>
                          {isRecommended ? '⭐ ' : '• '}{reasons.slice(0, 2).join(' • ')}
                        </div>
                      )}
                    </div>

                    <div style={{ flexShrink: 0 }}>
                      {isSelected ? (
                        <div style={{
                          width: 22, height: 22, borderRadius: '50%',
                          background: 'var(--primary)', color: '#fff',
                          display: 'flex', alignItems: 'center', justifyContent: 'center'
                        }}>
                          <Check size={13} />
                        </div>
                      ) : isRecommended ? (
                        <span style={{ fontSize: 11, fontWeight: 600, color: isConforme ? 'var(--emerald)' : 'var(--orange)' }}>
                          Sugerida
                        </span>
                      ) : null}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* PIE DE DROPDOWN */}
          <div style={{
            padding: '6px 12px',
            background: 'var(--bg-secondary)',
            borderTop: '1px solid var(--border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: 11,
            color: 'var(--text-tertiary)'
          }}>
            <span>{filteredOptions.length} ubicaciones disponibles</span>
            <span>💡 Algoritmo Putaway {client?.reglaInventario || 'FIFO'}</span>
          </div>
        </div>
      )}
    </div>
  );
}
