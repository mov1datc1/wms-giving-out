/**
 * ============================================================================
 * CONFIGURACIÓN CANÓNICA DE LAYOUT REAL DEL ALMACÉN (FASE 3A)
 * ============================================================================
 * Fuente única de verdad para el mapeo espacial del layout real de Giving Out WMS.
 * Derivado de la inspección pixel a pixel del plano original compartido por Alejandra.
 *
 * Total de posiciones físicas: 45
 *  - INTERIOR: 35 posiciones (G0001 a G0035)
 *  - EXTERIOR_TECHADO: 10 posiciones (G0036 a G0045)
 *
 * Cada posición física representa un espacio individual con capacidad estricta
 * de exactamente 1 tarima (capacidadBultos = 1).
 */

export interface WarehouseLocationConfig {
  codigo: string;
  areaFisica: 'INTERIOR' | 'EXTERIOR_TECHADO';
  orden: number;
  coordX: number;
  coordY: number;
  ancho: number;
  alto: number;
  rotacion: 0 | 90;
  descripcion: string;
  esPncSugerido?: boolean;
}

export interface SpatialLandmark {
  id: string;
  nombre: string;
  areaFisica: 'INTERIOR' | 'EXTERIOR_TECHADO';
  tipo: 'BANIOS' | 'MESAS_TRABAJO' | 'ACCESO' | 'ESCALERA' | 'MESA_EXTERIOR' | 'TABLEROS_CONTROL';
  coordX: number;
  coordY: number;
  ancho: number;
  alto: number;
}

export const WAREHOUSE_CANVAS_DIMENSIONS = {
  width: 707,
  height: 760,
  interiorHeight: 605,
  exteriorTechadoHeight: 155,
};

export const REAL_WAREHOUSE_POSITIONS: WarehouseLocationConfig[] = [
  // ==========================================================================
  // ÁREA INTERIOR (35 Posiciones)
  // ==========================================================================

  // 1. Fila Superior (Norte Interior) — 5 posiciones
  { codigo: 'G0001', areaFisica: 'INTERIOR', orden: 1, coordX: 39, coordY: 13, ancho: 58, alto: 49, rotacion: 0, descripcion: 'Fila Superior 1 (Esquina Norponiente)' },
  { codigo: 'G0002', areaFisica: 'INTERIOR', orden: 2, coordX: 114, coordY: 13, ancho: 58, alto: 49, rotacion: 0, descripcion: 'Fila Superior 2' },
  { codigo: 'G0003', areaFisica: 'INTERIOR', orden: 3, coordX: 187, coordY: 13, ancho: 59, alto: 48, rotacion: 0, descripcion: 'Fila Superior 3' },
  { codigo: 'G0004', areaFisica: 'INTERIOR', orden: 4, coordX: 263, coordY: 13, ancho: 58, alto: 49, rotacion: 0, descripcion: 'Fila Superior 4' },
  { codigo: 'G0005', areaFisica: 'INTERIOR', orden: 5, coordX: 338, coordY: 13, ancho: 58, alto: 49, rotacion: 0, descripcion: 'Fila Superior 5' },

  // 2. Fila 2 Central (Bajo fila superior) — 3 posiciones
  { codigo: 'G0006', areaFisica: 'INTERIOR', orden: 6, coordX: 165, coordY: 75, ancho: 52, alto: 61, rotacion: 90, descripcion: 'Fila 2 Centro 1' },
  { codigo: 'G0007', areaFisica: 'INTERIOR', orden: 7, coordX: 235, coordY: 75, ancho: 52, alto: 61, rotacion: 90, descripcion: 'Fila 2 Centro 2' },
  { codigo: 'G0008', areaFisica: 'INTERIOR', orden: 8, coordX: 299, coordY: 75, ancho: 52, alto: 61, rotacion: 90, descripcion: 'Fila 2 Centro 3' },

  // 3. Columna Muro Poniente (Left wall, bajo G0001) — 9 posiciones
  { codigo: 'G0009', areaFisica: 'INTERIOR', orden: 9, coordX: 31, coordY: 71, ancho: 61, alto: 50, rotacion: 0, descripcion: 'Muro Poniente 2' },
  { codigo: 'G0010', areaFisica: 'INTERIOR', orden: 10, coordX: 31, coordY: 121, ancho: 61, alto: 51, rotacion: 0, descripcion: 'Muro Poniente 3' },
  { codigo: 'G0011', areaFisica: 'INTERIOR', orden: 11, coordX: 31, coordY: 172, ancho: 61, alto: 50, rotacion: 0, descripcion: 'Muro Poniente 4' },
  { codigo: 'G0012', areaFisica: 'INTERIOR', orden: 12, coordX: 32, coordY: 231, ancho: 61, alto: 56, rotacion: 0, descripcion: 'Muro Poniente 5' },
  { codigo: 'G0013', areaFisica: 'INTERIOR', orden: 13, coordX: 32, coordY: 294, ancho: 61, alto: 58, rotacion: 0, descripcion: 'Muro Poniente 6' },
  { codigo: 'G0014', areaFisica: 'INTERIOR', orden: 14, coordX: 32, coordY: 352, ancho: 61, alto: 58, rotacion: 0, descripcion: 'Muro Poniente 7' },
  { codigo: 'G0015', areaFisica: 'INTERIOR', orden: 15, coordX: 32, coordY: 415, ancho: 61, alto: 68, rotacion: 0, descripcion: 'Muro Poniente 8' },
  { codigo: 'G0016', areaFisica: 'INTERIOR', orden: 16, coordX: 32, coordY: 487, ancho: 61, alto: 60, rotacion: 0, descripcion: 'Muro Poniente 9' },
  { codigo: 'G0017', areaFisica: 'INTERIOR', orden: 17, coordX: 32, coordY: 547, ancho: 61, alto: 60, rotacion: 0, descripcion: 'Muro Poniente 10' },

  // 4. Recinto Tabicado Central — Fila Superior — 5 posiciones
  { codigo: 'G0018', areaFisica: 'INTERIOR', orden: 18, coordX: 124, coordY: 142, ancho: 58, alto: 53, rotacion: 0, descripcion: 'Recinto Central Superior 1' },
  { codigo: 'G0019', areaFisica: 'INTERIOR', orden: 19, coordX: 182, coordY: 142, ancho: 58, alto: 53, rotacion: 0, descripcion: 'Recinto Central Superior 2' },
  { codigo: 'G0020', areaFisica: 'INTERIOR', orden: 20, coordX: 240, coordY: 142, ancho: 59, alto: 53, rotacion: 0, descripcion: 'Recinto Central Superior 3' },
  { codigo: 'G0021', areaFisica: 'INTERIOR', orden: 21, coordX: 299, coordY: 142, ancho: 58, alto: 53, rotacion: 0, descripcion: 'Recinto Central Superior 4' },
  { codigo: 'G0022', areaFisica: 'INTERIOR', orden: 22, coordX: 357, coordY: 142, ancho: 61, alto: 53, rotacion: 0, descripcion: 'Recinto Central Superior 5' },

  // 5. Recinto Tabicado Central — Fila Inferior — 4 posiciones
  { codigo: 'G0023', areaFisica: 'INTERIOR', orden: 23, coordX: 134, coordY: 208, ancho: 52, alto: 62, rotacion: 90, descripcion: 'Recinto Central Inferior 1' },
  { codigo: 'G0024', areaFisica: 'INTERIOR', orden: 24, coordX: 206, coordY: 208, ancho: 59, alto: 62, rotacion: 90, descripcion: 'Recinto Central Inferior 2' },
  { codigo: 'G0025', areaFisica: 'INTERIOR', orden: 25, coordX: 265, coordY: 208, ancho: 59, alto: 62, rotacion: 90, descripcion: 'Recinto Central Inferior 3' },
  { codigo: 'G0026', areaFisica: 'INTERIOR', orden: 26, coordX: 350, coordY: 208, ancho: 50, alto: 62, rotacion: 90, descripcion: 'Recinto Central Inferior 4' },

  // 6. Fila Bajo Recinto Tabicado — 3 posiciones
  { codigo: 'G0027', areaFisica: 'INTERIOR', orden: 27, coordX: 139, coordY: 284, ancho: 60, alto: 52, rotacion: 0, descripcion: 'Fila Bajo Recinto 1' },
  { codigo: 'G0028', areaFisica: 'INTERIOR', orden: 28, coordX: 228, coordY: 284, ancho: 60, alto: 52, rotacion: 0, descripcion: 'Fila Bajo Recinto 2' },
  { codigo: 'G0029', areaFisica: 'INTERIOR', orden: 29, coordX: 337, coordY: 284, ancho: 60, alto: 52, rotacion: 0, descripcion: 'Fila Bajo Recinto 3' },

  // 7. Posición Central Intermedia — 1 posición
  { codigo: 'G0030', areaFisica: 'INTERIOR', orden: 30, coordX: 322, coordY: 343, ancho: 69, alto: 59, rotacion: 0, descripcion: 'Posición Central Intermedia' },

  // 8. Fila Bajo Mesas de Trabajo — 4 posiciones
  { codigo: 'G0031', areaFisica: 'INTERIOR', orden: 31, coordX: 153, coordY: 533, ancho: 59, alto: 75, rotacion: 0, descripcion: 'Bajo Mesas de Trabajo 1' },
  { codigo: 'G0032', areaFisica: 'INTERIOR', orden: 32, coordX: 221, coordY: 533, ancho: 58, alto: 75, rotacion: 0, descripcion: 'Bajo Mesas de Trabajo 2' },
  { codigo: 'G0033', areaFisica: 'INTERIOR', orden: 33, coordX: 288, coordY: 533, ancho: 57, alto: 75, rotacion: 0, descripcion: 'Bajo Mesas de Trabajo 3' },
  { codigo: 'G0034', areaFisica: 'INTERIOR', orden: 34, coordX: 364, coordY: 533, ancho: 56, alto: 75, rotacion: 0, descripcion: 'Bajo Mesas de Trabajo 4' },

  // 9. Posición Aislada Oriente (Bajo Baños) — 1 posición
  { codigo: 'G0035', areaFisica: 'INTERIOR', orden: 35, coordX: 545, coordY: 285, ancho: 59, alto: 69, rotacion: 0, descripcion: 'Interior Oriente (Bajo Baños)' },

  // ==========================================================================
  // ÁREA EXTERIOR TECHADO (10 Posiciones)
  // ==========================================================================

  // 10. Exterior Techado Alto Oriente (PNC) — 1 posición
  { codigo: 'G0036', areaFisica: 'EXTERIOR_TECHADO', orden: 36, coordX: 596, coordY: 615, ancho: 51, alto: 61, rotacion: 0, descripcion: 'Exterior Techado Alto Oriente', esPncSugerido: true },

  // 11. Exterior Techado Fila Inferior Surponiente — 3 posiciones
  { codigo: 'G0037', areaFisica: 'EXTERIOR_TECHADO', orden: 37, coordX: 28, coordY: 687, ancho: 52, alto: 61, rotacion: 0, descripcion: 'Exterior Techado Surponiente 1' },
  { codigo: 'G0038', areaFisica: 'EXTERIOR_TECHADO', orden: 38, coordX: 81, coordY: 687, ancho: 52, alto: 61, rotacion: 0, descripcion: 'Exterior Techado Surponiente 2' },
  { codigo: 'G0039', areaFisica: 'EXTERIOR_TECHADO', orden: 39, coordX: 139, coordY: 687, ancho: 52, alto: 61, rotacion: 0, descripcion: 'Exterior Techado Surponiente 3' },

  // 12. Exterior Techado Fila Inferior Centro (PNC) — 3 posiciones
  { codigo: 'G0040', areaFisica: 'EXTERIOR_TECHADO', orden: 40, coordX: 298, coordY: 689, ancho: 52, alto: 62, rotacion: 0, descripcion: 'Exterior Techado Centro 1' },
  { codigo: 'G0041', areaFisica: 'EXTERIOR_TECHADO', orden: 41, coordX: 353, coordY: 689, ancho: 52, alto: 62, rotacion: 0, descripcion: 'Exterior Techado Centro 2', esPncSugerido: true },
  { codigo: 'G0042', areaFisica: 'EXTERIOR_TECHADO', orden: 42, coordX: 408, coordY: 689, ancho: 53, alto: 62, rotacion: 0, descripcion: 'Exterior Techado Centro 3', esPncSugerido: true },

  // 13. Exterior Techado Fila Inferior Suroriente — 3 posiciones
  { codigo: 'G0043', areaFisica: 'EXTERIOR_TECHADO', orden: 43, coordX: 490, coordY: 688, ancho: 53, alto: 64, rotacion: 0, descripcion: 'Exterior Techado Suroriente 1' },
  { codigo: 'G0044', areaFisica: 'EXTERIOR_TECHADO', orden: 44, coordX: 546, coordY: 688, ancho: 53, alto: 64, rotacion: 0, descripcion: 'Exterior Techado Suroriente 2' },
  { codigo: 'G0045', areaFisica: 'EXTERIOR_TECHADO', orden: 45, coordX: 602, coordY: 688, ancho: 52, alto: 64, rotacion: 0, descripcion: 'Exterior Techado Suroriente 3' },
];

export const SPATIAL_LANDMARKS: SpatialLandmark[] = [
  { id: 'banios', nombre: 'Baños', areaFisica: 'INTERIOR', tipo: 'BANIOS', coordX: 515, coordY: 135, ancho: 165, alto: 130 },
  { id: 'mesa_trabajo_1', nombre: 'Mesa de Trabajo 1', areaFisica: 'INTERIOR', tipo: 'MESAS_TRABAJO', coordX: 165, coordY: 435, ancho: 85, alto: 55 },
  { id: 'mesa_trabajo_2', nombre: 'Mesa de Trabajo 2', areaFisica: 'INTERIOR', tipo: 'MESAS_TRABAJO', coordX: 285, coordY: 435, ancho: 85, alto: 55 },
  { id: 'escalera_izq', nombre: 'Escaleras Poniente', areaFisica: 'EXTERIOR_TECHADO', tipo: 'ESCALERA', coordX: 80, coordY: 615, ancho: 60, alto: 45 },
  { id: 'mesa_madera_ext', nombre: 'Mesa de Trabajo Exterior', areaFisica: 'EXTERIOR_TECHADO', tipo: 'MESA_EXTERIOR', coordX: 150, coordY: 615, ancho: 160, alto: 45 },
  { id: 'escalera_der', nombre: 'Escaleras Oriente', areaFisica: 'EXTERIOR_TECHADO', tipo: 'ESCALERA', coordX: 490, coordY: 615, ancho: 75, alto: 45 },
  { id: 'tablero_control_1', nombre: 'Tablero de Control 1', areaFisica: 'INTERIOR', tipo: 'TABLEROS_CONTROL', coordX: 580, coordY: 410, ancho: 65, alto: 90 },
  { id: 'tablero_control_2', nombre: 'Tablero de Control 2', areaFisica: 'INTERIOR', tipo: 'TABLEROS_CONTROL', coordX: 580, coordY: 515, ancho: 65, alto: 90 },
];

