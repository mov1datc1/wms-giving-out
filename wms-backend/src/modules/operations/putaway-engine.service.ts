import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { isExpired } from '../../common/inventory-operational-state.util';

export interface LocationClassification {
  categoriaUbicacion: 'FISICA_ALMACENABLE' | 'RECIBO_TRANSITO' | 'VIRTUAL_NO_CONFORME' | 'STAGING' | 'ESPECIAL_OTRAS';
  esAlmacenable: boolean;
  categoriaDescripcion: string;
}

/**
 * Umbral estándar por defecto del WMS para rotación FEFO en nivel Picking (días de vida útil restante).
 * Política general configurable: prioriza nivel Picking/surtido rápido para mercancía con caducidad próxima.
 * Fallback temporal cuando ni el cliente depositante ni el SKU tienen un umbral personalizado.
 */
export const DEFAULT_FEFO_PICKING_THRESHOLD_DAYS = 180;

export interface EnrichedLocation {
  id: string;
  codigo: string;
  almacenId: string;
  zonaId: string | null;
  pasillo: string;
  rack: string;
  nivel: string;
  posicion: string;
  tipoUbicacion: string;
  temperatura: string;
  capacidadUnits: number;
  capacidadBultos: number | null; // null si no está configurada físicamente en BD (NO_CONFIGURADA)
  capacidadBultosEstado: 'CONFIGURADA' | 'NO_CONFIGURADA';
  ocupacionUnidades: number;
  ocupacionBultos: number; // Siempre real derivada de HandlingUnits activas
  capacidadDisponibleUnidades: number;
  capacidadDisponibleBultos: number | null;
  estado: string;
  activo: boolean;
  estadoCapacidad: 'LIBRE' | 'PARCIAL' | 'LLENO' | 'SOBRECAPACIDAD' | 'BLOQUEADO' | 'NO_APLICA';
  categoriaUbicacion: string;
  esAlmacenable: boolean;
  categoriaDescripcion: string;
  tipoNivel: 'PICKING' | 'RESERVA' | 'MIXTO';
  funcionNivel?: 'PICKING' | 'RESERVA' | 'MIXTO';
  zona?: any;
  lotes: any[];
  bultosCount: number;
  depositantesPresentes: string[];
  skusPresentes: string[];
  lotesPresentes: string[];
}

export interface RankedLocationCandidate {
  id: string;
  codigo: string;
  pasillo: string;
  rack: string;
  nivel: string;
  tipoNivel: 'PICKING' | 'RESERVA' | 'MIXTO';
  zonaNombre: string;
  score: number;
  capacidadDisponibleUnidades: number;
  capacidadDisponibleBultos: number | null;
  capacidadBultosEstado: 'CONFIGURADA' | 'NO_CONFIGURADA';
  ocupacionUnidadesActual: number;
  ocupacionBultosActual: number;
  unidadesDespuesDeAlojar: number;
  capacidadRestanteDespues: number;
  bultosDespuesDeAlojar: number;
  capacidadBultosRestanteDespues: number | null;
  razonesFavorables: string[];
  advertencias: string[];
  matchReason: string;
}

export interface PutawayItemInput {
  huId: string | null;
  huCodigo: string;
  tipoHu: string;
  skuId: string;
  skuCodigo: string;
  skuDescripcion: string;
  cantidad: number;
  lote: string;
  fechaVencimiento: string | null;
  ubicacionActual: string;
  reacondicionada?: boolean;
  clienteId?: string;
  skuCategoria?: string;
  skuTemperatura?: string;
}

export type CompatibilityStatus = 'COMPATIBLE' | 'INCOMPATIBLE' | 'NO_CONFIGURADO';

export type CompatibilitySource =
  | 'MATRIZ_PRODUCTO_ZONA'
  | 'RESTRICCION_TERMICA'
  | 'POLITICA_DEPOSITANTE'
  | 'SIN_CONFIGURACION';

export interface CompatibilityEvaluation {
  status: CompatibilityStatus;
  fuente: CompatibilitySource;
  motivo: string;
  esCritica: boolean;
  esFallbackDemo?: boolean;
}

export interface DiscardDiagnostics {
  totalLocationsEvaluated: number;
  discardedSpecialLocations: number;
  discardedBlocked: number;
  discardedOvercapacity: number;
  discardedFull: number;
  discardedInsufficientUnits: number;
  discardedInsufficientBultos: number;
  discardedIncompatibleZoneOrClient: number;
  discardedProductIncompatibility: number;
  discardedUnconfiguredCompatibility: number;
  totalValidCandidates: number;
  motivoAgotamiento?: string;
}

@Injectable()
export class PutawayEngineService {
  constructor(private prisma: PrismaService) {}

  /**
   * Clasifica una ubicación según su rol operativo físico vs especial/transitorio
   */
  classifyLocation(loc: any): LocationClassification {
    const code = (loc.codigo || '').toUpperCase();
    const tipo = (loc.tipoUbicacion || '').toUpperCase();
    const zonaTipo = (loc.zona?.tipoZona || '').toUpperCase();
    const zonaCode = (loc.zona?.codigo || '').toUpperCase();

    // 1. Recibo y Andenes en tránsito (REC-01, REC-02, RAMPA, etc.)
    if (
      code.startsWith('REC-') ||
      code.includes('RAMPA') ||
      code.includes('ANDEN') ||
      tipo === 'RECIBO' ||
      zonaTipo === 'RECIBO' ||
      zonaCode === 'RECIBO'
    ) {
      return {
        categoriaUbicacion: 'RECIBO_TRANSITO',
        esAlmacenable: false,
        categoriaDescripcion: 'Andén / Recibo en Tránsito',
      };
    }

    // 2. Virtual / No Conforme (Mermas DEV-01, Excesos NC-EXCESO-01, Cuarentenas)
    if (
      code === 'DEV-01' ||
      code === 'NC-EXCESO-01' ||
      code.includes('DEV') ||
      code.includes('CUARENTENA') ||
      tipo === 'CUARENTENA' ||
      zonaTipo === 'CUARENTENA' ||
      zonaTipo === 'DEVOLUCION' ||
      zonaCode === 'DEVOLUCION'
    ) {
      return {
        categoriaUbicacion: 'VIRTUAL_NO_CONFORME',
        esAlmacenable: false,
        categoriaDescripcion: 'Almacén Virtual / No Conforme',
      };
    }

    // 3. Staging / Pulmón de salida (STG-01, STG-02, etc.)
    if (
      code.startsWith('STG-') ||
      code.includes('STAG') ||
      tipo === 'STAGING' ||
      zonaTipo === 'STAGING' ||
      zonaCode === 'STAGING'
    ) {
      return {
        categoriaUbicacion: 'STAGING',
        esAlmacenable: false,
        categoriaDescripcion: 'Área de Staging / Consolidación',
      };
    }

    // 4. Especiales de piso no vinculadas a rack de almacenamiento
    if (tipo === 'PISO' && (!loc.rack || loc.rack === 'PISO' || loc.pasillo === 'PISO')) {
      return {
        categoriaUbicacion: 'ESPECIAL_OTRAS',
        esAlmacenable: false,
        categoriaDescripcion: 'Ubicación Especial de Piso',
      };
    }

    // 5. Celdas físicas de almacenamiento (Rack / Estantería)
    return {
      categoriaUbicacion: 'FISICA_ALMACENABLE',
      esAlmacenable: true,
      categoriaDescripcion: 'Celda Almacenable (Rack / Estantería)',
    };
  }

  /**
   * Carga y enriquece el layout completo del almacén con ocupación real derivada de LotInventory y HandlingUnit
   */
  async getEnrichedWarehouseLayout(): Promise<EnrichedLocation[]> {
    const [locations, allActiveHus, recentDualScanAudits] = await Promise.all([
      this.prisma.location.findMany({
        where: { activo: true },
        include: {
          zona: true,
          lotes: {
            where: {
              OR: [
                { cantidadDisponible: { gt: 0 } },
                { cantidadBloqueada: { gt: 0 } },
              ],
            },
            include: {
              sku: {
                select: {
                  id: true,
                  codigo: true,
                  descripcion: true,
                  categoria: true,
                  temperaturaRequerida: true,
                },
              },
              cliente: {
                select: {
                  id: true,
                  codigo: true,
                  nombreComercial: true,
                },
              },
            },
            orderBy: { createdAt: 'asc' },
          },
        },
        orderBy: [
          { pasillo: 'asc' },
          { rack: 'asc' },
          { nivel: 'asc' },
        ],
      }),
      this.prisma.handlingUnit.findMany({
        where: {
          estadoHu: { notIn: ['INACTIVO', 'DESPACHADO'] },
        },
        select: {
          id: true,
          codigo: true,
          ubicacionActual: true,
          clienteId: true,
          skuCodigo: true,
          loteTexto: true,
          cantidad: true,
        },
      }),
      this.prisma.auditLog.findMany({
        where: {
          entidad: 'HandlingUnit',
          accion: 'PUTAWAY_DUAL_SCAN_VALIDADO',
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    // Indexar auditorías de validación más recientes por HU para asegurar que HUs confirmadas
    // reflejen su rack validado aunque su campo ubicacionActual esté en tránsito
    const validatedRackByHuId = new Map<string, string>();
    for (const audit of recentDualScanAudits) {
      if (audit.entidadId && !validatedRackByHuId.has(audit.entidadId)) {
        const match = audit.detalle?.match(/en rack físico ([A-Z0-9-]+)/i);
        if (match && match[1]) {
          validatedRackByHuId.set(audit.entidadId, match[1].toUpperCase());
        }
      }
    }

    // Indexar HUs activas por ubicación
    const huCountByLoc: Record<string, number> = {};
    const husByLoc: Record<string, any[]> = {};
    for (const hu of allActiveHus) {
      let effectiveLoc = hu.ubicacionActual;
      const isRampa = !effectiveLoc || ['RAMPA_RECEPCION', 'REC-01', 'RECIBO', 'STAGING', 'ANDEN'].includes(effectiveLoc);
      if (isRampa && validatedRackByHuId.has(hu.id)) {
        effectiveLoc = validatedRackByHuId.get(hu.id)!;
      }

      if (effectiveLoc && !['RAMPA_RECEPCION', 'REC-01', 'RECIBO', 'STAGING', 'ANDEN'].includes(effectiveLoc)) {
        huCountByLoc[effectiveLoc] = (huCountByLoc[effectiveLoc] || 0) + 1;
        if (!husByLoc[effectiveLoc]) husByLoc[effectiveLoc] = [];
        husByLoc[effectiveLoc].push({ ...hu, ubicacionActual: effectiveLoc });
      }
    }

    return locations.map((loc) => {
      const classification = this.classifyLocation(loc);

      // Capacidad de piezas (provisional/demo configurable desde Location)
      const capUnits = (loc as any).capacidadUnits || 100;

      // Ocupación de piezas: suma de LotInventory (disponible + bloqueada)
      // combinada con HandlingUnits activas alojadas físicamente en el rack
      const sumDisp = loc.lotes.reduce((sum, l) => sum + (l.cantidadDisponible || 0), 0);
      const sumBloq = loc.lotes.reduce((sum, l) => sum + (l.cantidadBloqueada || 0), 0);
      const huUnits = (husByLoc[loc.codigo] || []).reduce((sum, h) => sum + (h.cantidad || 0), 0);
      const ocupUnidades = Math.max(sumDisp + sumBloq, huUnits);

      // Tipo funcional del nivel: Configurable en Location / Layout (con fallback temporal aislado)
      // Describe únicamente la función operativa para surtido/FEFO, NUNCA la capacidad física de bultos.
      const tipoNivel = this.resolveFuncionNivel(loc);

      // Capacidad física de bultos: Exclusivamente proveniente de configuración física real de cada Location.
      // Si no existe fuente física real en la entidad Location, se tipifica estrictamente como NO_CONFIGURADA (null).
      // Prohibido inventar 5, 1 ni basarse en la función operativa (PICKING/RESERVA/MIXTO).
      const hasConfiguredCapBultos =
        typeof (loc as any).capacidadBultos === 'number' && (loc as any).capacidadBultos > 0;
      const capBultos: number | null = hasConfiguredCapBultos ? (loc as any).capacidadBultos : null;
      const capacidadBultosEstado: 'CONFIGURADA' | 'NO_CONFIGURADA' = hasConfiguredCapBultos
        ? 'CONFIGURADA'
        : 'NO_CONFIGURADA';

      // Ocupación de bultos: conteo estricto de HandlingUnits activas (dato informativo real)
      const bultosLoc = huCountByLoc[loc.codigo] || huCountByLoc[loc.id] || 0;
      const ocupBultos = bultosLoc;

      // Capacidades disponibles derivadas
      const capDispUnidades = Math.max(0, capUnits - ocupUnidades);
      const capDispBultos = hasConfiguredCapBultos && capBultos !== null
        ? Math.max(0, capBultos - ocupBultos)
        : null;

      // Estado de capacidad canónico:
      // Cuando la capacidad de bultos es NO_CONFIGURADA, la decisión temporal se apoya
      // exclusivamente en la capacidad real de piezas + estado físico de la celda.
      let estadoCapacidad: 'LIBRE' | 'PARCIAL' | 'LLENO' | 'SOBRECAPACIDAD' | 'BLOQUEADO' | 'NO_APLICA' = 'LIBRE';
      if (!classification.esAlmacenable) {
        estadoCapacidad = 'NO_APLICA';
      } else if (loc.estado === 'BLOQUEADO') {
        estadoCapacidad = 'BLOQUEADO';
      } else if (ocupUnidades > capUnits || (hasConfiguredCapBultos && capBultos !== null && ocupBultos > capBultos)) {
        estadoCapacidad = 'SOBRECAPACIDAD';
      } else if (ocupUnidades >= capUnits || (hasConfiguredCapBultos && capBultos !== null && ocupBultos >= capBultos)) {
        estadoCapacidad = 'LLENO';
      } else if (ocupUnidades > 0 || ocupBultos > 0) {
        estadoCapacidad = 'PARCIAL';
      } else {
        estadoCapacidad = 'LIBRE';
      }

      const depositantesPresentes = [
        ...new Set([
          ...loc.lotes.map((l) => l.clienteId).filter(Boolean),
          ...(husByLoc[loc.codigo] || []).map((h) => h.clienteId).filter(Boolean),
        ]),
      ];

      const skusPresentes = [
        ...new Set([
          ...loc.lotes.map((l) => l.sku?.codigo).filter(Boolean),
          ...(husByLoc[loc.codigo] || []).map((h) => h.skuCodigo).filter(Boolean),
        ]),
      ];

      const lotesPresentes = [
        ...new Set([
          ...loc.lotes.map((l) => l.lote).filter(Boolean),
          ...(husByLoc[loc.codigo] || []).map((h) => h.loteTexto).filter(Boolean),
        ]),
      ];

      return {
        id: loc.id,
        codigo: loc.codigo,
        almacenId: loc.almacenId,
        zonaId: loc.zonaId,
        pasillo: loc.pasillo,
        rack: loc.rack,
        nivel: loc.nivel,
        posicion: loc.posicion,
        tipoUbicacion: loc.tipoUbicacion,
        temperatura: loc.temperatura || 'AMBIENTE',
        capacidadUnits: capUnits,
        capacidadBultos: capBultos,
        capacidadBultosEstado,
        ocupacionUnidades: ocupUnidades,
        ocupacionBultos: ocupBultos,
        capacidadDisponibleUnidades: capDispUnidades,
        capacidadDisponibleBultos: capDispBultos,
        estado: loc.estado,
        activo: loc.activo,
        estadoCapacidad,
        categoriaUbicacion: classification.categoriaUbicacion,
        esAlmacenable: classification.esAlmacenable,
        categoriaDescripcion: classification.categoriaDescripcion,
        tipoNivel,
        zona: loc.zona,
        lotes: loc.lotes,
        bultosCount: ocupBultos,
        depositantesPresentes,
        skusPresentes,
        lotesPresentes,
      };
    });
  }

  /**
   * Determina la función operativa del nivel (PICKING, RESERVA o MIXTO).
   * 1. Prioridad: Atributo formal configurable (loc.funcionNivel o loc.tipoNivel).
   * 2. Fallback temporal aislado para demo hasta recibir el layout oficial de Alejandra.
   */
  resolveFuncionNivel(loc: any): 'PICKING' | 'RESERVA' | 'MIXTO' {
    if (loc.funcionNivel && ['PICKING', 'RESERVA', 'MIXTO'].includes(loc.funcionNivel)) {
      return loc.funcionNivel;
    }
    if (loc.tipoNivel && ['PICKING', 'RESERVA', 'MIXTO'].includes(loc.tipoNivel)) {
      return loc.tipoNivel;
    }
    return this.fallbackTemporalNivelFuncionDemo(loc);
  }

  /**
   * @deprecated FALLBACK TEMPORAL DE COMPATIBILIDAD (DEMO PREVIA AL LAYOUT OFICIAL)
   * Aislado exclusivamente para compatibilidad demo hasta recibir el Layout físico oficial de Alejandra.
   * Al poblar la columna funcionNivel en Location, este método queda obsoleto sin tocar el motor.
   */
  private fallbackTemporalNivelFuncionDemo(loc: any): 'PICKING' | 'RESERVA' {
    return loc.nivel === 'N1' ? 'PICKING' : 'RESERVA';
  }

  /**
   * Evalúa la compatibilidad física y operativa entre el producto (SKU) y la zona/ubicación.
   * Totalmente trazable con tipificación tripartita (COMPATIBLE, INCOMPATIBLE, NO_CONFIGURADO)
   * e identificación inequívoca de la fuente de la decisión:
   *  - RESTRICCION_TERMICA: Violación física estricta de temperatura (refrigerado vs ambiente).
   *  - MATRIZ_PRODUCTO_ZONA: Matriz formal de categorías admitidas/excluidas en la zona o ubicación.
   *  - POLITICA_DEPOSITANTE: Asignación/preferencia contractual de zona del cliente depositante.
   *    (Identificado explícitamente como fallback temporal de demo mientras no exista matriz formal producto-zona;
   *     no garantiza por sí sola la compatibilidad sanitaria universal de todos los SKU del cliente).
   *  - SIN_CONFIGURACION: La zona carece de matriz formal y no es zona asignada al cliente.
   */
  evaluateProductZoneCompatibility(
    item: PutawayItemInput | null | undefined,
    loc: EnrichedLocation,
    client?: any,
  ): CompatibilityEvaluation {
    if (!item) {
      return {
        status: 'COMPATIBLE',
        fuente: 'SIN_CONFIGURACION',
        motivo: 'Sin especificación de SKU',
        esCritica: false,
      };
    }

    const skuTemp = item.skuTemperatura || 'AMBIENTE';
    const locTemp = loc.temperatura || loc.zona?.temperatura || 'AMBIENTE';

    // 1. RESTRICCIÓN FÍSICA ESTRICTA: Control térmico
    if (skuTemp !== 'AMBIENTE' && locTemp !== skuTemp) {
      return {
        status: 'INCOMPATIBLE',
        fuente: 'RESTRICCION_TERMICA',
        motivo: `Incompatibilidad térmica estricta: Producto requiere ${skuTemp} pero el rack es ${locTemp}`,
        esCritica: true,
      };
    }

    // 2. MATRIZ FORMAL DE CATEGORÍAS EN ZONA O UBICACIÓN (Máxima prioridad cuando exista configuración real)
    const categoriasPermitidasZona: string[] | null = (loc.zona as any)?.categoriasPermitidas || null;
    const categoriasExcluidasZona: string[] | null = (loc.zona as any)?.categoriasExcluidas || null;

    if (item.skuCategoria && categoriasExcluidasZona && categoriasExcluidasZona.includes(item.skuCategoria)) {
      return {
        status: 'INCOMPATIBLE',
        fuente: 'MATRIZ_PRODUCTO_ZONA',
        motivo: `Categoría ${item.skuCategoria} restringida explícitamente en la matriz de la zona ${loc.zona?.nombre}`,
        esCritica: true,
      };
    }

    if (item.skuCategoria && categoriasPermitidasZona) {
      if (categoriasPermitidasZona.includes(item.skuCategoria)) {
        return {
          status: 'COMPATIBLE',
          fuente: 'MATRIZ_PRODUCTO_ZONA',
          motivo: `Categoría ${item.skuCategoria} admitida formalmente en la matriz de la zona ${loc.zona?.nombre}`,
          esCritica: false,
        };
      } else {
        return {
          status: 'INCOMPATIBLE',
          fuente: 'MATRIZ_PRODUCTO_ZONA',
          motivo: `Categoría ${item.skuCategoria} no admitida en la matriz de la zona ${loc.zona?.nombre}`,
          esCritica: true,
        };
      }
    }

    // 3. ASIGNACIÓN CONTRACTUAL DE ZONA AL DEPOSITANTE (Fallback Temporal de Demo)
    // cliente.zonaAsignadaId representa la preferencia/asignación contractual del depositante.
    // Mientras no exista matriz formal producto-zona, se admite como fallback temporal demo
    // identificándolo explícitamente para no asumir universalidad de SKU sin matriz.
    const clienteId = client?.id || item.clienteId;
    const clientAssignedZoneId = client?.zonaAsignadaId;
    const isAssignedZone = clientAssignedZoneId && loc.zonaId === clientAssignedZoneId;

    if (isAssignedZone) {
      return {
        status: 'COMPATIBLE',
        fuente: 'POLITICA_DEPOSITANTE',
        motivo: `Zona ${loc.zona?.nombre || loc.zona?.codigo} asignada contractualmente al depositante (autorización operativa provisional / fallback temporal demo; pendiente matriz formal producto-zona)`,
        esCritica: false,
        esFallbackDemo: true,
      };
    }

    // 4. SIN CONFIGURACIÓN FORMAL (Estado actual de la BD para zonas externas no asignadas)
    // El motor NO debe asumir silenciosamente que una zona externa es compatible sólo por ser AMBIENTE.
    const esCategoriaCritica = ['ALIMENTO', 'PERECEDERO', 'FARMACEUTICO', 'QUIMICO', 'PELIGROSO'].includes(
      (item.skuCategoria || '').toUpperCase(),
    );

    return {
      status: 'NO_CONFIGURADO',
      fuente: 'SIN_CONFIGURACION',
      motivo: `La zona ${loc.zona?.nombre || loc.zona?.codigo} no cuenta con matriz de categorías admitidas para ${item.skuCategoria || 'este producto'}`,
      esCritica: esCategoriaCritica,
    };
  }

  /**
   * Filtro Obligatorio de Candidatos (Regla 2 y 3)
   * Una ubicación solo puede ser candidata si cumple con TODOS los requisitos estrictos de almacenabilidad, espacio y compatibilidad de producto.
   * Separa formalmente:
   *  - Compatibilidad operativa del producto (Criterio A): Incompatible o No Configurado crítico = DESCARTAR.
   *  - Preferencia del depositante (Criterio B): Evaluada posteriormente (zona preferente bonifica, secundaria penaliza).
   */
  filterCandidates(
    allLocations: EnrichedLocation[],
    huCantidad: number,
    client?: any,
    item?: PutawayItemInput,
  ): { candidates: EnrichedLocation[]; diagnostics: DiscardDiagnostics } {
    let discardedSpecialLocations = 0;
    let discardedBlocked = 0;
    let discardedOvercapacity = 0;
    let discardedFull = 0;
    let discardedInsufficientUnits = 0;
    let discardedInsufficientBultos = 0;
    let discardedIncompatibleZoneOrClient = 0;
    let discardedProductIncompatibility = 0;
    let discardedUnconfiguredCompatibility = 0;

    // Política de zona del depositante:
    // - 'EXCLUSIVA' / 'OBLIGATORIA' (o client.zonaExclusiva === true):
    //     Ninguna ubicación fuera de client.zonaAsignadaId puede ser candidata.
    // - 'PREFERENTE' (Default / cuando no está configurado explícitamente):
    //     La zona asignada recibe bonificación de puntuación y prioridad, pero si se agota,
    //     otras zonas compatibles pueden fungir como alternativa secundaria con advertencia explícita.
    const isStrictZone =
      client?.zonaExclusiva === true ||
      client?.politicaZona === 'EXCLUSIVA' ||
      client?.politicaZona === 'OBLIGATORIA';

    const clienteId = client?.id;

    // Regla de Precedencia Central: Mercancía vencida NO es elegible para Putaway comercial.
    if (item && isExpired(item.fechaVencimiento, new Date(), true)) {
      return {
        candidates: [],
        diagnostics: {
          totalLocationsEvaluated: allLocations.length,
          discardedSpecialLocations: 0,
          discardedBlocked: 0,
          discardedOvercapacity: 0,
          discardedFull: 0,
          discardedInsufficientUnits: 0,
          discardedInsufficientBultos: 0,
          discardedIncompatibleZoneOrClient: 0,
          discardedProductIncompatibility: 0,
          discardedUnconfiguredCompatibility: 0,
          totalValidCandidates: 0,
          motivoAgotamiento: 'MERCANCÍA VENCIDA — Putaway comercial no permitido. La unidad requiere disposición operativa conforme al flujo de calidad/no conforme.',
        },
      };
    }

    const candidates: EnrichedLocation[] = [];

    for (const loc of allLocations) {
      // 1. Excluir ubicaciones especiales/transitorias
      if (!loc.esAlmacenable || loc.categoriaUbicacion !== 'FISICA_ALMACENABLE') {
        discardedSpecialLocations++;
        continue;
      }

      // 2. Excluir inactivas o bloqueadas
      if (!loc.activo || loc.estado === 'BLOQUEADO' || loc.estadoCapacidad === 'BLOQUEADO') {
        discardedBlocked++;
        continue;
      }

      // 3. Excluir sobrecapacidad
      if (loc.estadoCapacidad === 'SOBRECAPACIDAD') {
        discardedOvercapacity++;
        continue;
      }

      // 4. Excluir llenas
      if (loc.estadoCapacidad === 'LLENO') {
        discardedFull++;
        continue;
      }

      // 5. Excluir falta de capacidad en piezas para la HU entrante
      if (loc.capacidadDisponibleUnidades < huCantidad) {
        discardedInsufficientUnits++;
        continue;
      }

      // 6. Capacidad física en bultos (HUs):
      // Si existe una capacidad real/configurada de bultos para la Location, validarla estrictamente.
      // Si no existe fuente real en BD (capacidadBultos === null / NO_CONFIGURADA), NO inventar valores
      // (5 ni 1) ni descartar por bultos ficticios; la decisión temporal se apoya en capacidad real de piezas + estado físico.
      if (loc.capacidadBultos !== null && loc.capacidadDisponibleBultos !== null) {
        if (loc.capacidadDisponibleBultos < 1) {
          discardedInsufficientBultos++;
          continue;
        }
      }

      // 7. Filtro estricto de Zona Exclusiva / Obligatoria (cuando esté configurada para el depositante)
      if (isStrictZone && client?.zonaAsignadaId && loc.zonaId !== client.zonaAsignadaId) {
        discardedIncompatibleZoneOrClient++;
        continue;
      }

      // 8. Filtro de exclusividad de ubicación por depositante (cuando la celda tenga cliente exclusivo asignado)
      const locClienteExclusivo = (loc as any).clienteExclusivoId;
      if (locClienteExclusivo && clienteId && locClienteExclusivo !== clienteId) {
        discardedIncompatibleZoneOrClient++;
        continue;
      }

      // 8b. Filtro de política Single-SKU (cuando la ubicación, la zona o el depositante prohíben mezclar SKUs)
      const isSingleSkuEnforced =
        (loc as any).permiteMezclaSku === false ||
        (loc as any).singleSku === true ||
        (loc as any).politicaSku === 'SINGLE_SKU' ||
        (loc.zona as any)?.permiteMezclaSku === false ||
        (loc.zona as any)?.singleSku === true ||
        (loc.zona as any)?.politicaSku === 'SINGLE_SKU' ||
        client?.permiteMezclaSku === false ||
        client?.singleSku === true ||
        client?.politicaSku === 'SINGLE_SKU';

      const hasOtherSkuInLoc = Boolean(
        item?.skuCodigo &&
          loc.skusPresentes.length > 0 &&
          !loc.skusPresentes.includes(item.skuCodigo),
      );
      if (isSingleSkuEnforced && hasOtherSkuInLoc) {
        discardedProductIncompatibility++;
        continue;
      }

      // 9. COMPATIBILIDAD OPERATIVA PRODUCTO-ZONA (Criterio A)
      // Determina si físicamente/operativamente el producto PUEDE almacenarse ahí.
      // Una ubicación incompatible debe ser DESCARTADA de raíz (no penalizada).
      const compatibilidad = this.evaluateProductZoneCompatibility(item, loc, client);
      if (compatibilidad.status === 'INCOMPATIBLE') {
        discardedProductIncompatibility++;
        continue;
      }
      if (compatibilidad.status === 'NO_CONFIGURADO' && compatibilidad.esCritica) {
        // Política segura de operación: Cuando una categoría crítica (alimentos, químicos, perecederos)
        // se evalúa contra una zona externa sin matriz de compatibilidad configurada,
        // no se asume compatible de forma silenciosa y se descarta de las sugerencias automáticas.
        discardedUnconfiguredCompatibility++;
        continue;
      }

      candidates.push(loc);
    }

    let motivoAgotamiento: string | undefined;
    if (candidates.length === 0) {
      if (discardedUnconfiguredCompatibility > 0 && discardedInsufficientUnits > 0) {
        motivoAgotamiento =
          'Capacidad física agotada en la zona asignada al depositante y las zonas externas disponibles carecen de matriz de compatibilidad configurada para este producto.';
      } else if (discardedUnconfiguredCompatibility > 0) {
        motivoAgotamiento =
          'Las zonas disponibles no cuentan con matriz de compatibilidad configurada para la categoría de este producto.';
      } else if (discardedProductIncompatibility > 0) {
        motivoAgotamiento = 'No existen ubicaciones operativamente compatibles con las restricciones de este producto.';
      } else if (discardedIncompatibleZoneOrClient > 0 && discardedInsufficientUnits > 0) {
        motivoAgotamiento = 'Zona obligatoria asignada sin capacidad suficiente y zonas externas no autorizadas.';
      } else if (discardedInsufficientUnits > 0 || discardedOvercapacity > 0) {
        motivoAgotamiento = 'Capacidad física insuficiente en todas las celdas compatibles del almacén.';
      } else {
        motivoAgotamiento = 'No existen posiciones válidas en el layout para alojar esta unidad de manejo.';
      }
    }

    return {
      candidates,
      diagnostics: {
        totalLocationsEvaluated: allLocations.length,
        discardedSpecialLocations,
        discardedBlocked,
        discardedOvercapacity,
        discardedFull,
        discardedInsufficientUnits,
        discardedInsufficientBultos,
        discardedIncompatibleZoneOrClient,
        discardedProductIncompatibility,
        discardedUnconfiguredCompatibility,
        totalValidCandidates: candidates.length,
        motivoAgotamiento,
      },
    };
  }

  /**
   * Motor de Puntuación / Ranking Explicable (Reglas 4, 5, 6, 7, 8)
   * Evalúa compatibilidad 3PL, consolidación de depositante/SKU/lote, FEFO/nivel y genera explicación detallada.
   */
  rankCandidatesForItem(
    candidates: EnrichedLocation[],
    item: PutawayItemInput,
    client: any,
  ): RankedLocationCandidate[] {
    const scoredList: RankedLocationCandidate[] = [];

    // Precedencia operativa: Si la mercancía está vencida, el Putaway comercial NO está permitido.
    // Se excluyen candidatos antes de cualquier cálculo de score o bonificación FEFO.
    if (item && isExpired(item.fechaVencimiento, new Date(), true)) {
      return [];
    }

    // Calcular días restantes de caducidad si aplica
    let daysUntilExpiry: number | null = null;
    let hasExpiry = false;
    if (item.fechaVencimiento) {
      const expDate = new Date(item.fechaVencimiento);
      if (!isNaN(expDate.getTime())) {
        hasExpiry = true;
        daysUntilExpiry = Math.ceil((expDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      }
    }

    const clienteId = client?.id || item.clienteId;
    const clientAssignedZoneId = client?.zonaAsignadaId;

    for (const loc of candidates) {
      let score = 50; // Base inicial para ubicación disponible y almacenable
      const razonesFavorables: string[] = [];
      const advertencias: string[] = [];

      // =======================================================================
      // 1. COMPATIBILIDAD 3PL / DEPOSITANTE (Regla 4)
      // =======================================================================
      const isZoneAssigned = clientAssignedZoneId && loc.zonaId === clientAssignedZoneId;
      if (isZoneAssigned) {
        score += 30;
        razonesFavorables.push(`Zona preferente asignada al depositante (${loc.zona?.nombre || loc.zona?.codigo})`);
      } else if (!clientAssignedZoneId) {
        score += 10;
        razonesFavorables.push(`Zona de almacenamiento comercial (${loc.zona?.nombre || loc.zona?.codigo})`);
      } else {
        // La zona no es la preferente asignada al depositante
        score -= 25;
        advertencias.push(`Zona secundaria (${loc.zona?.nombre || loc.zona?.codigo}), fuera de zona preferente`);
      }

      // =======================================================================
      // 2. CONSOLIDACIÓN DE SKU Y LOTE vs CELDA VACÍA vs MULTI-SKU (Reglas 1, 2, 3, 4, 5)
      // Orden conceptual esperado:
      // Mismo SKU compatible -> Celda vacía compatible -> Multi-SKU permitido -> resto
      // =======================================================================
      const hasSameClient = Boolean(clienteId && loc.depositantesPresentes.includes(clienteId));
      const hasOtherClient = loc.depositantesPresentes.some((cid) => cid !== clienteId);
      const isCellEmpty = loc.depositantesPresentes.length === 0;

      const hasSameSku = Boolean(item.skuCodigo && loc.skusPresentes.includes(item.skuCodigo));
      const hasSameLot = Boolean(hasSameSku && item.lote && item.lote !== 'S/L' && loc.lotesPresentes.includes(item.lote));
      const hasOtherSkuSameClient = Boolean(hasSameClient && !hasSameSku && loc.skusPresentes.length > 0);

      if (hasSameSku) {
        if (hasSameLot) {
          score += 50;
          razonesFavorables.push('Consolidación del mismo SKU y lote existente en la ubicación');
        } else {
          score += 35;
          razonesFavorables.push(`Consolidación de SKU: Ya contiene existencias del producto ${item.skuCodigo}`);
          if (item.lote && item.lote !== 'S/L' && loc.lotesPresentes.length > 0) {
            advertencias.push(`Lote distinto al presente en celda (${loc.lotesPresentes.join(', ')} vs ${item.lote})`);
          }
        }
      } else if (isCellEmpty) {
        score += 25;
        razonesFavorables.push('Celda física vacía y limpia para nueva estiba');
      } else if (hasOtherSkuSameClient) {
        // Multi-SKU del mismo depositante: permitido por política, pero con menor prioridad que celdas vacías
        score += 5;
        advertencias.push(
          `La ubicación contiene otro SKU del mismo depositante (${loc.skusPresentes.join(', ')}); mezcla permitida por política operativa`,
        );
      } else if (hasOtherClient) {
        score -= 25;
        advertencias.push('Ubicación compartida: Contiene inventario de otro depositante');
      }

      // =======================================================================
      // 3. COMPATIBILIDAD OPERATIVA Y CONTROL TÉRMICO (Regla 5)
      // =======================================================================
      const compat = this.evaluateProductZoneCompatibility(item, loc, client);
      if (compat.status === 'COMPATIBLE') {
        score += 5;
        razonesFavorables.push(`Control térmico y compatibilidad operativa verificada (${loc.temperatura})`);
      } else if (compat.status === 'NO_CONFIGURADO') {
        // En productos no críticos admitidos excepcionalmente por política
        advertencias.push(`Supervisión requerida: ${compat.motivo}`);
      }

      // =======================================================================
      // 4. FEFO Y FUNCIÓN CONFIGURADA DEL NIVEL (Regla 6)
      // =======================================================================
      // Umbral configurable de días de vida útil para priorizar surtido en nivel Picking:
      // 1. Configuración del cliente (cliente.diasUmbralPickingCaducidad)
      // 2. Configuración del SKU (sku.diasUmbralPicking)
      // 3. Política estándar por defecto: DEFAULT_FEFO_PICKING_THRESHOLD_DAYS (180 días)
      const umbralDiasPicking =
        client?.diasUmbralPickingCaducidad ||
        (item as any)?.skuDiasUmbralPicking ||
        DEFAULT_FEFO_PICKING_THRESHOLD_DAYS;

      const isPicking = loc.tipoNivel === 'PICKING';
      const isReserva = loc.tipoNivel === 'RESERVA';
      const isMixto = loc.tipoNivel === 'MIXTO';

      if (hasExpiry && daysUntilExpiry !== null) {
        const esCaducidadCercana = daysUntilExpiry <= umbralDiasPicking;
        if (esCaducidadCercana) {
          if (isPicking || isMixto) {
            score += 25;
            razonesFavorables.push(
              `Prioridad FEFO Picking: Vencimiento próximo (${daysUntilExpiry}d · ${item.fechaVencimiento} vs umbral ${umbralDiasPicking}d), nivel asignado para surtido rápido`,
            );
          } else {
            score += 5;
            advertencias.push(
              `Nivel Reserva: Mercancía con caducidad próxima (${daysUntilExpiry}d) en nivel alto requerirá maniobra de bajada`,
            );
          }
        } else {
          if (isReserva || isMixto) {
            score += 20;
            razonesFavorables.push(
              `Nivel Reserva óptimo: Larga vida útil (${daysUntilExpiry}d · ${item.fechaVencimiento}), preserva posiciones de picking bajo`,
            );
          } else {
            score += 10;
            razonesFavorables.push(`Nivel Picking disponible (vida útil holgada: ${daysUntilExpiry}d)`);
          }
        }
      } else {
        if (isPicking) {
          score += 15;
          razonesFavorables.push('Nivel Picking: Fácil acceso operativo para surtido');
        } else {
          score += 12;
          razonesFavorables.push('Nivel Reserva: Almacenaje estandarizado en estantería alta');
        }
      }

      // =======================================================================
      // 5. ESPACIO FÍSICO Y CAPACIDAD DESPUÉS DE ALOJAR (Regla 3)
      // =======================================================================
      const unidadesDespues = loc.ocupacionUnidades + item.cantidad;
      const capacidadRestanteDespues = Math.max(0, loc.capacidadUnits - unidadesDespues);
      const bultosDespues = loc.ocupacionBultos + 1;
      const hasCapBultos = loc.capacidadBultos !== null && loc.capacidadBultos !== undefined;
      const capBultosRestanteDespues = hasCapBultos
        ? Math.max(0, (loc.capacidadBultos as number) - bultosDespues)
        : null;

      const formatBultosAlojad = (n: number) => (n === 1 ? '1 bulto alojado' : `${n} bultos alojados`);

      const bultosTexto = hasCapBultos
        ? ` y ${capBultosRestanteDespues} bultos disponibles`
        : ` · Actualmente: ${formatBultosAlojad(loc.ocupacionBultos)} (después del acomodo: ${formatBultosAlojad(bultosDespues)} · límite no configurado)`;

      razonesFavorables.push(
        `Espacio verificado: Capacidad para alojar ${item.cantidad} piezas (quedarán ${capacidadRestanteDespues} pzas${bultosTexto})`,
      );

      if (capacidadRestanteDespues >= 10 && (!hasCapBultos || (capBultosRestanteDespues ?? 0) >= 1)) {
        score += 5;
      }

      const matchReason = razonesFavorables.slice(0, 3).join(' · ');
      const rawScore = score;
      const normalizedScore = Math.max(10, Math.min(100, Math.round((rawScore / 150) * 100)));

      scoredList.push({
        id: loc.id,
        codigo: loc.codigo,
        pasillo: loc.pasillo,
        rack: loc.rack,
        nivel: loc.nivel,
        tipoNivel: loc.tipoNivel,
        zonaNombre: loc.zona?.nombre || loc.zona?.codigo || 'Almacenamiento General',
        score: normalizedScore,
        rawScore,
        capacidadDisponibleUnidades: loc.capacidadDisponibleUnidades,
        capacidadDisponibleBultos: loc.capacidadDisponibleBultos,
        capacidadBultosEstado: loc.capacidadBultosEstado,
        ocupacionUnidadesActual: loc.ocupacionUnidades,
        ocupacionBultosActual: loc.ocupacionBultos,
        unidadesDespuesDeAlojar: unidadesDespues,
        capacidadRestanteDespues,
        bultosDespuesDeAlojar: bultosDespues,
        capacidadBultosRestanteDespues: capBultosRestanteDespues,
        razonesFavorables,
        advertencias,
        matchReason,
      } as any);
    }

    // Ordenar de mayor a menor score real, luego penalizar advertencias, y por pasillo/rack/nivel como desempate natural
    scoredList.sort((a: any, b: any) => {
      if (b.rawScore !== a.rawScore) return b.rawScore - a.rawScore;
      if (a.advertencias.length !== b.advertencias.length) return a.advertencias.length - b.advertencias.length;
      if (b.score !== a.score) return b.score - a.score;
      if (a.pasillo !== b.pasillo) return a.pasillo.localeCompare(b.pasillo);
      if (a.rack !== b.rack) return a.rack.localeCompare(b.rack);
      return a.nivel.localeCompare(b.nivel);
    });

    return scoredList;
  }

  /**
   * Genera el paquete completo de sugerencias para un recibo completo
   */
  async generateReceiptSuggestions(receiptIdOrCode: string) {
    const receipt = await this.prisma.receipt.findFirst({
      where: {
        OR: [{ id: receiptIdOrCode }, { codigo: receiptIdOrCode }],
      },
      include: {
        cliente: true,
        lineas: { include: { sku: true } },
        handlingUnits: {
          where: { estadoHu: 'ACTIVO' },
          include: { lote: true },
          orderBy: { codigo: 'asc' },
        },
      },
    });

    if (!receipt) {
      throw new HttpException('Previo de recibo no encontrado', HttpStatus.NOT_FOUND);
    }

    const canProceed = receipt.etiquetasEstado === 'COLOCADAS';
    const lockMessage = !canProceed
      ? receipt.etiquetasEstado === 'IMPRESAS'
        ? 'Las etiquetas Giving Out ya están impresas pero aún no se ha confirmado su pegado físico en las cajas/tarimas. Confirma la colocación antes de trasladar a racks.'
        : 'Las etiquetas Giving Out aún no han sido impresas ni colocadas. Debe completarse la Fase 3 (Doble Etiquetado) antes de iniciar el alojamiento.'
      : null;

    // Obtener layout enriquecido con ocupación real de BD
    const allLocations = await this.getEnrichedWarehouseLayout();

    // Identificar las cajas a ubicar
    const activeBoxes = receipt.handlingUnits.filter((h) => h.tipoHu === 'CAJA' && h.estadoHu === 'ACTIVO');
    const itemsToProcess: PutawayItemInput[] = [];

    if (activeBoxes.length > 0) {
      activeBoxes.forEach((box) => {
        const line = receipt.lineas.find((l) => l.sku?.codigo === box.skuCodigo);
        itemsToProcess.push({
          huId: box.id,
          huCodigo: box.codigo,
          tipoHu: 'CAJA',
          skuId: box.lote?.skuId || line?.skuId || '',
          skuCodigo: box.skuCodigo || 'SKU',
          skuDescripcion: box.skuDescripcion || line?.sku?.descripcion || 'Caja de producto',
          cantidad: box.cantidad,
          lote: box.loteTexto || 'S/L',
          fechaVencimiento: box.fechaVencimiento
            ? new Date(box.fechaVencimiento).toISOString().split('T')[0]
            : null,
          ubicacionActual: box.ubicacionActual || 'REC-01',
          reacondicionada: box.reacondicionada,
          clienteId: receipt.clienteId,
          skuCategoria: line?.sku?.categoria,
          skuTemperatura: line?.sku?.temperaturaRequerida,
        });
      });
    } else {
      // Fallback si no hay HUs generadas aún: por partida de recepción
      receipt.lineas.forEach((l) => {
        itemsToProcess.push({
          huId: null,
          huCodigo: `PARTIDA-${l.sku?.codigo}`,
          tipoHu: 'PARTIDA',
          skuId: l.skuId,
          skuCodigo: l.sku?.codigo || 'SKU',
          skuDescripcion: l.sku?.descripcion || 'Partida de recibo',
          cantidad: l.cantidadRecibida || l.cantidadEsperada || 0,
          lote: l.loteAsignado || 'S/L',
          fechaVencimiento: l.fechaVencimiento
            ? new Date(l.fechaVencimiento).toISOString().split('T')[0]
            : null,
          ubicacionActual: 'REC-01',
          reacondicionada: false,
          clienteId: receipt.clienteId,
          skuCategoria: l.sku?.categoria,
          skuTemperatura: l.sku?.temperaturaRequerida,
        });
      });
    }

    // Regla de rotación según giro y configuración del cliente
    const reglaRotacion = receipt.cliente?.reglaInventario || (receipt.cliente?.requiereCaducidad ? 'FEFO' : 'FIFO');

    let totalDiagnostics: DiscardDiagnostics | null = null;

    const suggestions = itemsToProcess.map((item) => {
      const now = new Date();
      const expired = isExpired(item.fechaVencimiento, now, true);
      if (expired) {
        const canonicalExpiredMsg = 'MERCANCÍA VENCIDA — Putaway comercial no permitido. La unidad requiere disposición operativa conforme al flujo de calidad/no conforme.';
        return {
          ...item,
          reglaRotacion,
          esVencido: true,
          esElegiblePutawayComercial: false,
          matchScore: 0,
          matchReason: canonicalExpiredMsg,
          razonesFavorables: [],
          advertencias: [canonicalExpiredMsg],
          suggestedLocation: null,
          alternatives: [],
        };
      }

      // 1. Filtrar candidatos obligatorios (capacidad física + zona + compatibilidad de producto)
      const { candidates, diagnostics } = this.filterCandidates(allLocations, item.cantidad, receipt.cliente, item);
      if (!totalDiagnostics) totalDiagnostics = diagnostics;

      // 2. Evaluar y rankear candidatos
      const rankedCandidates = this.rankCandidatesForItem(candidates, item, receipt.cliente);

      const topCandidate = rankedCandidates[0] || null;
      const alternatives = rankedCandidates.slice(1, 4); // Top 3 alternativas
      const hasValidCandidate = !!topCandidate;

      const canonicalNoCandidateMsg = 'No existe una ubicación compatible con capacidad suficiente.';

      return {
        ...item,
        reglaRotacion,
        matchScore: hasValidCandidate ? topCandidate.score : 0,
        matchReason: hasValidCandidate ? topCandidate.matchReason : canonicalNoCandidateMsg,
        razonesFavorables: topCandidate?.razonesFavorables ?? [],
        advertencias: hasValidCandidate
          ? topCandidate.advertencias
          : [canonicalNoCandidateMsg, ...(diagnostics.motivoAgotamiento ? [diagnostics.motivoAgotamiento] : [])],
        suggestedLocation: topCandidate
          ? {
              id: topCandidate.id,
              codigo: topCandidate.codigo,
              pasillo: topCandidate.pasillo,
              rack: topCandidate.rack,
              nivel: topCandidate.nivel,
              tipoNivel: topCandidate.tipoNivel,
              zonaNombre: topCandidate.zonaNombre,
              score: topCandidate.score,
              capacidadLibre: topCandidate.capacidadDisponibleUnidades,
              capacidadDisponibleUnidades: topCandidate.capacidadDisponibleUnidades,
              capacidadDisponibleBultos: topCandidate.capacidadDisponibleBultos,
              ocupacionUnidadesActual: topCandidate.ocupacionUnidadesActual,
              ocupacionBultosActual: topCandidate.ocupacionBultosActual,
              unidadesDespuesDeAlojar: topCandidate.unidadesDespuesDeAlojar,
              capacidadRestanteDespues: topCandidate.capacidadRestanteDespues,
              bultosDespuesDeAlojar: topCandidate.bultosDespuesDeAlojar,
              capacidadBultosRestanteDespues: topCandidate.capacidadBultosRestanteDespues,
              razonesFavorables: topCandidate.razonesFavorables,
              advertencias: topCandidate.advertencias,
            }
          : null,
        alternativeLocations: alternatives.map((alt) => ({
          id: alt.id,
          codigo: alt.codigo,
          pasillo: alt.pasillo,
          rack: alt.rack,
          nivel: alt.nivel,
          tipoNivel: alt.tipoNivel,
          zonaNombre: alt.zonaNombre,
          score: alt.score,
          capacidadLibre: alt.capacidadDisponibleUnidades,
          capacidadDisponibleUnidades: alt.capacidadDisponibleUnidades,
          capacidadDisponibleBultos: alt.capacidadDisponibleBultos,
          ocupacionUnidadesActual: alt.ocupacionUnidadesActual,
          ocupacionBultosActual: alt.ocupacionBultosActual,
          unidadesDespuesDeAlojar: alt.unidadesDespuesDeAlojar,
          capacidadRestanteDespues: alt.capacidadRestanteDespues,
          bultosDespuesDeAlojar: alt.bultosDespuesDeAlojar,
          capacidadBultosRestanteDespues: alt.capacidadBultosRestanteDespues,
          razonesFavorables: alt.razonesFavorables,
          advertencias: alt.advertencias,
        })),
      };
    });

    return {
      success: true,
      canProceed,
      lockMessage,
      etiquetasEstado: receipt.etiquetasEstado || 'PENDIENTE',
      receipt: {
        id: receipt.id,
        codigo: receipt.codigo,
        cliente: receipt.cliente?.nombreComercial || receipt.cliente?.razonSocial,
        clienteId: receipt.clienteId,
        giro: receipt.cliente?.giro || '3PL',
        reglaRotacion,
        facturaRespaldo: receipt.facturaRespaldo || receipt.ocReferencia,
        totalItems: itemsToProcess.length,
        totalUnidades: itemsToProcess.reduce((sum, i) => sum + (i.cantidad || 0), 0),
      },
      diagnostics: totalDiagnostics,
      suggestions,
    };
  }

  /**
   * Bloqueo pesimista determinista (HandlingUnit -> Location) para prevenir carreras y deadlocks (Regla 2 y 9)
   * Ordena alfabéticamente los IDs para garantizar que todas las transacciones concurrentes adquieran
   * los candados en el mismo orden exacto.
   */
  async acquirePessimisticLocks(
    tx: any,
    huIds: string[],
    locationIds: string[],
  ): Promise<void> {
    const sortedHuIds = [...new Set(huIds.filter(Boolean))].sort();
    const sortedLocIds = [...new Set(locationIds.filter(Boolean))].sort();

    // Configurar lock_timeout local a nivel de transacción (5000ms) para evitar esperas indefinidas (Regla 4)
    try {
      if (typeof tx.$executeRaw === 'function') {
        await tx.$executeRaw`SET LOCAL lock_timeout = '5000ms'`;
      } else if (typeof tx.$executeRawUnsafe === 'function') {
        await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '5000ms'");
      }
    } catch {
      // Fallback transparente en entornos mock o SQLite/tests
    }

    // 1. Bloquear HandlingUnits en orden determinista estricto mediante $queryRaw parametrizado (Regla 2 y 3)
    for (const huId of sortedHuIds) {
      if (typeof tx.$queryRaw === 'function') {
        await tx.$queryRaw`SELECT id FROM "HandlingUnit" WHERE id = ${huId} FOR UPDATE`;
      } else if (typeof tx.$queryRawUnsafe === 'function') {
        await tx.$queryRawUnsafe('SELECT id FROM "HandlingUnit" WHERE id = $1 FOR UPDATE', huId);
      }
    }

    // 2. Bloquear Locations en orden determinista estricto mediante $queryRaw parametrizado (Regla 2 y 3)
    for (const locId of sortedLocIds) {
      if (typeof tx.$queryRaw === 'function') {
        await tx.$queryRaw`SELECT id FROM "Location" WHERE id = ${locId} FOR UPDATE`;
      } else if (typeof tx.$queryRawUnsafe === 'function') {
        await tx.$queryRawUnsafe('SELECT id FROM "Location" WHERE id = $1 FOR UPDATE', locId);
      }
    }
  }

  /**
   * Ejecutor con reintento automático para deadlocks y timeouts de concurrencia en PostgreSQL (Regla 10)
   * Máximo 2 reintentos con backoff exponencial y jitter.
   * Si se agotan los reintentos, genera HTTP 409 Conflict con mensaje operativo claro.
   */
  async executeWithDeadlockRetry<T>(
    operation: (attempt: number) => Promise<T>,
    context: { hu?: string; location?: string; opName?: string } = {},
    maxRetries = 2,
  ): Promise<T> {
    let attempt = 0;
    while (true) {
      try {
        return await operation(attempt);
      } catch (error: any) {
        attempt++;
        const isDeadlock =
          error?.code === '40P01' ||
          error?.message?.includes('deadlock detected') ||
          error?.message?.includes('40P01');
        const isLockTimeout =
          error?.code === '55P03' ||
          error?.code === '57014' ||
          error?.message?.includes('lock timeout') ||
          error?.message?.includes('55P03');

        // Registro de log seguro sin credenciales ni info sensible (Regla 10)
        const timestamp = new Date().toISOString();
        const huLog = context.hu || 'N/A';
        const locLog = context.location || 'N/A';
        const opName = context.opName || 'Putaway';
        const motivo = isDeadlock
          ? 'PostgreSQL Deadlock (40P01)'
          : isLockTimeout
          ? 'PostgreSQL Lock Timeout (55P03)'
          : (error?.message || 'Error transaccional');

        if ((isDeadlock || isLockTimeout) && attempt <= maxRetries) {
          const backoffMs = 50 * attempt + Math.floor(Math.random() * 50);
          console.warn(
            `[Putaway Concurrency Retry] Reintento controlado por contención | HU: ${huLog} | Location: ${locLog} | Operación: ${opName} | Motivo: ${motivo} | Intento: ${attempt}/${maxRetries} | Backoff: ${backoffMs}ms | Timestamp: ${timestamp}`
          );
          await new Promise(res => setTimeout(res, backoffMs));
          continue;
        }

        // Si ya es una excepción operativa HTTP (ej. 409 Conflict, 400 Bad Request, etc.), propagarla directamente
        if (error instanceof HttpException) {
          throw error;
        }

        if (isDeadlock || isLockTimeout) {
          console.error(
            `[Putaway Concurrency Deadlock] Reintentos agotados | HU: ${huLog} | Location: ${locLog} | Operación: ${opName} | Motivo: ${motivo} | Intentos: ${attempt} | Timestamp: ${timestamp}`
          );
          throw new HttpException(
            {
              statusCode: HttpStatus.CONFLICT,
              message: 'Conflicto de concurrencia: Los recursos de almacenamiento están siendo modificados por otra transacción. Por favor reintente la operación.',
              error: 'Conflict',
            },
            HttpStatus.CONFLICT,
          );
        }

        throw error;
      }
    }
  }

  /**
   * Revalidación estricta de una ubicación antes de confirmar el Putaway (Regla 1, 3, 4 y 12)
   * Vuelve a evaluar en tiempo real dentro de la transacción si la ubicación física destino sigue
   * siendo válida, activa, almacenable y con capacidad suficiente en piezas y bultos.
   */
  async revalidateLocationForPutaway(
    locationIdOrCode: string,
    huCantidad: number,
    tx?: any,
    options?: {
      huBultos?: number;
      client?: any;
      item?: PutawayItemInput;
    },
  ): Promise<{ valid: boolean; error?: string; location?: any }> {
    const db = tx || this.prisma;
    const loc = await db.location.findFirst({
      where: {
        OR: [{ id: locationIdOrCode }, { codigo: locationIdOrCode }],
      },
      include: {
        zona: true,
        lotes: {
          where: {
            OR: [
              { cantidadDisponible: { gt: 0 } },
              { cantidadBloqueada: { gt: 0 } },
            ],
          },
        },
      },
    });

    if (!loc) {
      return {
        valid: false,
        error: `La ubicación "${locationIdOrCode}" no existe en el catálogo de almacén.`,
      };
    }

    // 0. Precedencia operativa: Si la mercancía está vencida, rechazar alojamiento comercial
    if (options?.item && isExpired(options.item.fechaVencimiento, new Date(), true)) {
      return {
        valid: false,
        error: 'MERCANCÍA VENCIDA — Putaway comercial no permitido. La unidad requiere disposición operativa conforme al flujo de calidad/no conforme.',
      };
    }

    // 1. Clasificación física
    const classification = this.classifyLocation(loc);
    if (!classification.esAlmacenable || classification.categoriaUbicacion !== 'FISICA_ALMACENABLE') {
      return {
        valid: false,
        error: `La ubicación ${loc.codigo} es de tipo ${classification.categoriaDescripcion} y no admite almacenamiento de mercancía comercial.`,
      };
    }

    // 2. Activa y no bloqueada
    if (!loc.activo) {
      return {
        valid: false,
        error: `La ubicación ${loc.codigo} se encuentra inactiva. Solicite una nueva ubicación.`,
      };
    }

    if (loc.estado === 'BLOQUEADO') {
      return {
        valid: false,
        error: `La ubicación ${loc.codigo} se encuentra bloqueada operativamente. Solicite una nueva ubicación.`,
      };
    }

    // 3. Conteo de bultos actuales en tiempo real dentro de la transacción
    const activeHusCount = await db.handlingUnit.count({
      where: {
        OR: [{ ubicacionActual: loc.codigo }, { ubicacionActual: loc.id }],
        estadoHu: { notIn: ['INACTIVO', 'DESPACHADO'] },
      },
    });

    const capUnits = (loc as any).capacidadUnits || 100;
    const hasConfiguredCapBultos =
      typeof (loc as any).capacidadBultos === 'number' && (loc as any).capacidadBultos > 0;
    const capBultos: number | null = hasConfiguredCapBultos ? (loc as any).capacidadBultos : null;

    const sumDisp = loc.lotes.reduce((sum: number, l: any) => sum + (l.cantidadDisponible || 0), 0);
    const sumBloq = loc.lotes.reduce((sum: number, l: any) => sum + (l.cantidadBloqueada || 0), 0);
    const ocupUnidades = sumDisp + sumBloq;
    const ocupBultos = activeHusCount;

    const capDispUnidades = Math.max(0, capUnits - ocupUnidades);
    const capDispBultos = hasConfiguredCapBultos && capBultos !== null
      ? Math.max(0, capBultos - ocupBultos)
      : null;

    // 4. Verificación de sobrecapacidad actual
    if (ocupUnidades > capUnits || (hasConfiguredCapBultos && capBultos !== null && ocupBultos > capBultos)) {
      return {
        valid: false,
        error: `La ubicación ${loc.codigo} cambió desde que fue sugerida y se encuentra en sobrecapacidad (${ocupUnidades}/${capUnits} piezas${hasConfiguredCapBultos ? `, ${ocupBultos}/${capBultos} bultos` : ''}). Solicite una nueva ubicación.`,
      };
    }

    // 5. Verificación de capacidad restante en piezas (Mensaje operativo canónico de Regla 7)
    if (capDispUnidades < huCantidad) {
      return {
        valid: false,
        error: `La ubicación ${loc.codigo} cambió desde que fue sugerida y ya no tiene capacidad suficiente. Solicite una nueva ubicación.`,
      };
    }

    // 6. Verificación de capacidad restante en bultos (SOLO si existe configuración física real en BD)
    const requiredBultos = options?.huBultos || 1;
    if (hasConfiguredCapBultos && capDispBultos !== null && capDispBultos < requiredBultos) {
      return {
        valid: false,
        error: `La ubicación ${loc.codigo} cambió desde que fue sugerida y ya no tiene espacio para bultos adicionales (${ocupBultos}/${capBultos} bultos ocupados). Solicite una nueva ubicación.`,
      };
    }

    // 7. Compatibilidad producto-zona dentro de la transacción (si se suministra item)
    if (options?.item) {
      const compat = this.evaluateProductZoneCompatibility(options.item, loc, options.client);
      if (compat.status === 'INCOMPATIBLE') {
        return {
          valid: false,
          error: `La ubicación ${loc.codigo} en zona ${loc.zona?.nombre || loc.zona?.codigo} es incompatible con el producto: ${compat.motivo}. Solicite una nueva ubicación.`,
        };
      }
      if (compat.status === 'NO_CONFIGURADO' && compat.esCritica) {
        return {
          valid: false,
          error: `La ubicación ${loc.codigo} en zona ${loc.zona?.nombre || loc.zona?.codigo} carece de matriz configurada para categoría crítica (${options.item.skuCategoria || 'sensible'}): ${compat.motivo}. No se admite compatibilidad implícita.`,
        };
      }
    }

    return {
      valid: true,
      location: {
        ...loc,
        capacidadDisponibleUnidades: capDispUnidades,
        capacidadDisponibleBultos: capDispBultos,
        ocupacionUnidades: ocupUnidades,
        ocupacionBultos: ocupBultos,
      },
    };
  }

  /**
   * Recalcula canónicamente el estado físico de una ubicación tras cualquier mutación de inventario.
   * Regla 9 (Etapa 5A.1):
   * - Deriva ocupacionUnidades de LotInventory (disponible + bloqueada).
   * - Deriva ocupacionBultos de HandlingUnit activas.
   * - Si ocupación física es 0 y 0 bultos -> LIBRE.
   * - Si ocupación excede capacidad configurada -> SOBRECAPACIDAD.
   * - Si ocupación alcanza capacidad -> LLENO.
   * - Si tiene existencia pero menor a capacidad -> PARCIAL (u OCUPADO).
   * - Respeta estrictamente si la posición se encuentra BLOQUEADA.
   * - NO muta el contador legado Location.ocupacion.
   */
  async recalculateLocationState(
    tx: any,
    locationId: string,
  ): Promise<{
    id: string;
    codigo: string;
    estadoAnterior: string;
    nuevoEstado: string;
    ocupacionUnidades: number;
    ocupacionBultos: number;
    capacidadUnits: number;
    capacidadBultos: number | null;
  }> {
    const loc = await tx.location.findUnique({
      where: { id: locationId },
      include: { lotes: true },
    });

    if (!loc) {
      throw new Error(`Ubicación con ID ${locationId} no encontrada para recalcular estado`);
    }

    const classification = this.classifyLocation(loc);

    // Si no es física almacenable (ej. REC-01, DEV-01, STAGING), su estado operativo no se altera como rack comercial
    if (!classification.esAlmacenable) {
      return {
        id: loc.id,
        codigo: loc.codigo,
        estadoAnterior: loc.estado,
        nuevoEstado: loc.estado,
        ocupacionUnidades: 0,
        ocupacionBultos: 0,
        capacidadUnits: loc.capacidadUnits || 100,
        capacidadBultos: null,
      };
    }

    // Ocupación canónica de unidades derivada estrictamente de LotInventory
    const ocupacionUnidades = (loc.lotes || []).reduce(
      (sum: number, l: any) => sum + (l.cantidadDisponible || 0) + (l.cantidadBloqueada || 0),
      0,
    );

    // Ocupación canónica de bultos derivada estrictamente de HandlingUnit activas
    let ocupacionBultos = 0;
    if (typeof tx.handlingUnit?.count === 'function') {
      ocupacionBultos = await tx.handlingUnit.count({
        where: {
          ubicacionActual: loc.codigo,
          estadoHu: 'ACTIVO',
        },
      });
    }

    const capUnits = loc.capacidadUnits || 100;
    const hasConfiguredCapBultos = typeof loc.capacidadBultos === 'number' && loc.capacidadBultos > 0;
    const capBultos: number | null = hasConfiguredCapBultos ? loc.capacidadBultos : null;

    // Si la ubicación está BLOQUEADA administrativamente por un supervisor, respetamos el bloqueo
    if (loc.estado === 'BLOQUEADO') {
      return {
        id: loc.id,
        codigo: loc.codigo,
        estadoAnterior: loc.estado,
        nuevoEstado: 'BLOQUEADO',
        ocupacionUnidades,
        ocupacionBultos,
        capacidadUnits: capUnits,
        capacidadBultos: capBultos,
      };
    }

    let nuevoEstado = 'LIBRE';
    if (ocupacionUnidades === 0 && ocupacionBultos === 0) {
      nuevoEstado = 'LIBRE';
    } else if (ocupacionUnidades > capUnits || (hasConfiguredCapBultos && capBultos !== null && ocupacionBultos > capBultos)) {
      nuevoEstado = 'SOBRECAPACIDAD';
    } else if (ocupacionUnidades >= capUnits || (hasConfiguredCapBultos && capBultos !== null && ocupacionBultos >= capBultos)) {
      nuevoEstado = 'LLENO';
    } else {
      nuevoEstado = 'PARCIAL';
    }

    if (loc.estado !== nuevoEstado) {
      await tx.location.update({
        where: { id: loc.id },
        data: {
          estado: nuevoEstado,
          // NO mutar Location.ocupacion
        },
      });
    }

    return {
      id: loc.id,
      codigo: loc.codigo,
      estadoAnterior: loc.estado,
      nuevoEstado,
      ocupacionUnidades,
      ocupacionBultos,
      capacidadUnits: capUnits,
      capacidadBultos: capBultos,
    };
  }

  /**
   * Protocolo común reutilizable de mutación física con bloqueo pesimista determinista
   * HandlingUnit -> Location, reintento controlado ante deadlocks y recálculo canónico de estado.
   * Regla 1 (Etapa 5A.1)
   */
  async executePhysicalMovementProtocol<T>(
    prismaClient: any,
    options: {
      huIds?: string[];
      locationIds?: string[];
      opName?: string;
      maxRetries?: number;
      recalculateLocationsOnCommit?: boolean;
    },
    action: (tx: any) => Promise<T>,
  ): Promise<T> {
    const huIds = options.huIds || [];
    const locationIds = options.locationIds || [];
    const opName = options.opName || 'PhysicalMovement';
    const maxRetries = options.maxRetries ?? 2;

    return await this.executeWithDeadlockRetry(
      async () => {
        return await prismaClient.$transaction(
          async (tx: any) => {
            // 1. Bloqueo determinista HandlingUnit -> Location con lock_timeout = 5000ms
            await this.acquirePessimisticLocks(tx, huIds, locationIds);

            // 2. Ejecutar acción de mutación
            const result = await action(tx);

            // 3. Recalcular estado canónico de ubicaciones afectadas
            if (options.recalculateLocationsOnCommit !== false && locationIds.length > 0) {
              const uniqueLocIds = [...new Set(locationIds.filter(Boolean))];
              for (const locId of uniqueLocIds) {
                await this.recalculateLocationState(tx, locId);
              }
            }

            return result;
          },
          { maxWait: 10000, timeout: 25000 },
        );
      },
      { opName },
      maxRetries,
    );
  }
}
