/**
 * ============================================================================
 * CLASIFICADOR CENTRAL DE FUNCIONALIDAD OPERATIVA DE UBICACIONES WMS
 * ============================================================================
 * Fuente única de verdad para determinar si una ubicación física en el almacén
 * es comercialmente elegible para surtido (Disponible Vendible, Picking, Pedidos)
 * o si corresponde a Tránsito Interno, No Conforme o Áreas Especiales.
 *
 * Prioridad de resolución:
 * 1. Atributos estructurales de Location y Zone (tipoZona, zona.codigo).
 * 2. Tipo/función configurada de la ubicación (tipoUbicacion).
 * 3. Condición física de almacenamiento en rack (rack, pasillo, nivel).
 * 4. Fallback centralizado y documentado para registros heredados sin zona.
 */

export type LocationOperationalRole =
  | 'ALMACENABLE_COMERCIAL'   // Racks y estanterías operativas: elegible para Disponible Vendible y Surtido
  | 'TRANSITO_INTERNO'        // Andén, rampa, recibo, staging inbound: físico registrado pero NO vendible hasta Putaway
  | 'NO_CONFORME_BLOQUEADO'   // Merma, devolución, cuarentena, exceso: retenido fuera de stock vendible
  | 'NO_ELEGIBLE_SURTIDO';    // Staging de salida, piso especial, áreas de maniobra: no surtible

export interface LocationOperationalClassification {
  rolOperativo: LocationOperationalRole;
  esVendible: boolean;           // true SOLO si es ALMACENABLE_COMERCIAL
  esElegibleSurtido: boolean;    // true SOLO si es ALMACENABLE_COMERCIAL
  esAlmacenable: boolean;        // true si es posición física de almacenamiento
  esTransitoInterno: boolean;    // true si es andén, rampa o recibo en tránsito
  esNoConforme: boolean;         // true si es merma, cuarentena o exceso
  badgeTexto: string;            // Texto descriptivo uniforme para frontend
  badgeColor: 'emerald' | 'amber' | 'rose' | 'slate';
  motivoNoVendible?: string;     // Explicación operativa para tooltips y auditoría
}

/**
 * Clasifica la funcionalidad operativa de una ubicación WMS.
 * Acepta cualquier objeto de ubicación con o sin zona relacionada.
 */
export function classifyLocationOperationalRole(location: any): LocationOperationalClassification {
  if (!location) {
    return {
      rolOperativo: 'NO_ELEGIBLE_SURTIDO',
      esVendible: false,
      esElegibleSurtido: false,
      esAlmacenable: false,
      esTransitoInterno: false,
      esNoConforme: false,
      badgeTexto: 'SIN UBICACIÓN ASIGNADA',
      badgeColor: 'slate',
      motivoNoVendible: 'Ubicación física no configurada o nula.',
    };
  }

  const code = String(location.codigo || '').toUpperCase().trim();
  const tipoUbi = String(location.tipoUbicacion || '').toUpperCase().trim();
  const zonaTipo = String(location.zona?.tipoZona || '').toUpperCase().trim();
  const zonaCode = String(location.zona?.codigo || '').toUpperCase().trim();

  // --------------------------------------------------------------------------
  // PRIORIDAD 1: ATRIBUTOS ESTRUCTURALES DE ZONA (Zone.tipoZona / Zone.codigo)
  // --------------------------------------------------------------------------

  // 1.A Zona de No Conforme / Devolución / Cuarentena
  if (zonaTipo === 'DEVOLUCION' || zonaTipo === 'CUARENTENA' || zonaCode === 'DEVOLUCION' || zonaCode === 'CUARENTENA') {
    return {
      rolOperativo: 'NO_CONFORME_BLOQUEADO',
      esVendible: false,
      esElegibleSurtido: false,
      esAlmacenable: false,
      esTransitoInterno: false,
      esNoConforme: true,
      badgeTexto: 'BLOQUEADO / NO CONFORME',
      badgeColor: 'rose',
      motivoNoVendible: 'Ubicación asignada a zona de merma, cuarentena o producto no conforme.',
    };
  }

  // 1.B Zona de Recibo / Tránsito Inbound
  if (zonaTipo === 'RECIBO' || zonaCode === 'RECIBO') {
    return {
      rolOperativo: 'TRANSITO_INTERNO',
      esVendible: false,
      esElegibleSurtido: false,
      esAlmacenable: false,
      esTransitoInterno: true,
      esNoConforme: false,
      badgeTexto: 'EN TRÁNSITO / PENDIENTE DE PUTAWAY',
      badgeColor: 'amber',
      motivoNoVendible: 'Existencia física en andén de recibo/tránsito. No disponible para surtido hasta completar Putaway en racks.',
    };
  }

  // 1.C Zona de Staging / Consolidación de Salida
  if (zonaTipo === 'STAGING' || zonaCode === 'STAGING') {
    return {
      rolOperativo: 'NO_ELEGIBLE_SURTIDO',
      esVendible: false,
      esElegibleSurtido: false,
      esAlmacenable: false,
      esTransitoInterno: false,
      esNoConforme: false,
      badgeTexto: 'ÁREA DE STAGING / PULMÓN',
      badgeColor: 'slate',
      motivoNoVendible: 'Área de maniobra o consolidación de salida no elegible para surtido comercial directo.',
    };
  }

  // 1.D Zona de Almacenamiento o Picking Comercial
  if (zonaTipo === 'ALMACENAMIENTO' || zonaTipo === 'PICKING') {
    // Si la zona es almacenable, verificar que el tipo de ubicación no indique segregación
    if (tipoUbi !== 'DEVOLUCION' && tipoUbi !== 'CUARENTENA' && tipoUbi !== 'RECIBO' && tipoUbi !== 'STAGING') {
      return {
        rolOperativo: 'ALMACENABLE_COMERCIAL',
        esVendible: true,
        esElegibleSurtido: true,
        esAlmacenable: true,
        esTransitoInterno: false,
        esNoConforme: false,
        badgeTexto: 'ALMACENABLE EN RACK',
        badgeColor: 'emerald',
      };
    }
  }

  // --------------------------------------------------------------------------
  // PRIORIDAD 2: TIPO / FUNCIÓN CONFIGURADA DE UBICACIÓN (Location.tipoUbicacion)
  // --------------------------------------------------------------------------

  if (tipoUbi === 'RECIBO') {
    return {
      rolOperativo: 'TRANSITO_INTERNO',
      esVendible: false,
      esElegibleSurtido: false,
      esAlmacenable: false,
      esTransitoInterno: true,
      esNoConforme: false,
      badgeTexto: 'EN TRÁNSITO / PENDIENTE DE PUTAWAY',
      badgeColor: 'amber',
      motivoNoVendible: 'Ubicación tipificada como recibo/tránsito inbound. Requiere Putaway a racks.',
    };
  }

  if (tipoUbi === 'CUARENTENA' || tipoUbi === 'DEVOLUCION') {
    return {
      rolOperativo: 'NO_CONFORME_BLOQUEADO',
      esVendible: false,
      esElegibleSurtido: false,
      esAlmacenable: false,
      esTransitoInterno: false,
      esNoConforme: true,
      badgeTexto: 'BLOQUEADO / NO CONFORME',
      badgeColor: 'rose',
      motivoNoVendible: 'Ubicación tipificada como cuarentena o devolución no conforme.',
    };
  }

  if (tipoUbi === 'STAGING') {
    return {
      rolOperativo: 'NO_ELEGIBLE_SURTIDO',
      esVendible: false,
      esElegibleSurtido: false,
      esAlmacenable: false,
      esTransitoInterno: false,
      esNoConforme: false,
      badgeTexto: 'ÁREA DE STAGING / PULMÓN',
      badgeColor: 'slate',
      motivoNoVendible: 'Área de staging no elegible para surtido directo.',
    };
  }

  if (tipoUbi === 'RACK' || tipoUbi === 'ESTANTERIA') {
    return {
      rolOperativo: 'ALMACENABLE_COMERCIAL',
      esVendible: true,
      esElegibleSurtido: true,
      esAlmacenable: true,
      esTransitoInterno: false,
      esNoConforme: false,
      badgeTexto: 'ALMACENABLE EN RACK',
      badgeColor: 'emerald',
    };
  }

  // --------------------------------------------------------------------------
  // PRIORIDAD 3: CONDICIÓN FÍSICA ESTRUCTURAL (Rack, Pasillo, Nivel)
  // --------------------------------------------------------------------------

  const hasPhysicalRackStructure =
    Boolean(location.pasillo && location.rack && location.nivel) &&
    location.pasillo !== 'PISO' &&
    location.rack !== 'PISO' &&
    location.nivel !== 'PISO';

  if (hasPhysicalRackStructure && tipoUbi !== 'PISO') {
    return {
      rolOperativo: 'ALMACENABLE_COMERCIAL',
      esVendible: true,
      esElegibleSurtido: true,
      esAlmacenable: true,
      esTransitoInterno: false,
      esNoConforme: false,
      badgeTexto: 'ALMACENABLE EN RACK',
      badgeColor: 'emerald',
    };
  }

  // --------------------------------------------------------------------------
  // PRIORIDAD 4: FALLBACK CENTRALIZADO PARA MODELOS LEGADOS / CONVENCIONES
  // --------------------------------------------------------------------------

  // Tránsito / Recibo legado
  if (code.startsWith('REC-') || code.includes('RAMPA') || code.includes('ANDEN')) {
    return {
      rolOperativo: 'TRANSITO_INTERNO',
      esVendible: false,
      esElegibleSurtido: false,
      esAlmacenable: false,
      esTransitoInterno: true,
      esNoConforme: false,
      badgeTexto: 'EN TRÁNSITO / PENDIENTE DE PUTAWAY',
      badgeColor: 'amber',
      motivoNoVendible: 'Ubicación identificada como andén/recibo por convención. Requiere alojamiento en rack.',
    };
  }

  // No conforme legado
  if (code.startsWith('DEV-') || code.startsWith('NC-') || code.includes('MERMA') || code.includes('CUARENTENA')) {
    return {
      rolOperativo: 'NO_CONFORME_BLOQUEADO',
      esVendible: false,
      esElegibleSurtido: false,
      esAlmacenable: false,
      esTransitoInterno: false,
      esNoConforme: true,
      badgeTexto: 'BLOQUEADO / NO CONFORME',
      badgeColor: 'rose',
      motivoNoVendible: 'Ubicación identificada como almacén virtual de merma o no conformidad.',
    };
  }

  // Staging legado
  if (code.startsWith('STG-') || code.includes('STAG')) {
    return {
      rolOperativo: 'NO_ELEGIBLE_SURTIDO',
      esVendible: false,
      esElegibleSurtido: false,
      esAlmacenable: false,
      esTransitoInterno: false,
      esNoConforme: false,
      badgeTexto: 'ÁREA DE STAGING / PULMÓN',
      badgeColor: 'slate',
      motivoNoVendible: 'Área de staging o consolidación no almacenable.',
    };
  }

  // Por defecto, cualquier ubicación no reconocible se trata de forma conservadora
  return {
    rolOperativo: 'NO_ELEGIBLE_SURTIDO',
    esVendible: false,
    esElegibleSurtido: false,
    esAlmacenable: false,
    esTransitoInterno: false,
    esNoConforme: false,
    badgeTexto: 'ÁREA ESPECIAL / NO SURTIBLE',
    badgeColor: 'slate',
    motivoNoVendible: 'Ubicación no catalogada como almacenable comercial.',
  };
}
