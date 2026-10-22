/**
 * ============================================================================
 * UTILIDAD CENTRAL DE SEGUIMIENTO DE SLA Y CITA DE ENTREGA (GIVING OUT WMS)
 * ============================================================================
 * Provee la lógica canónica y uniforme para detectar órdenes con citas de entrega
 * vencidas frente a la fecha operativa actual, generando señales visuales
 * informativas sin mutar la base de datos ni cancelar operaciones físicas.
 */

export interface OrderSlaStatus {
  isVencida: boolean;
  diasAtraso: number;
  badgeTexto: string;
  alertaTerminal: string;
  alertaDetallada: string;
}

const ESTADOS_FINALES = new Set([
  'CONSOLIDADO',
  'DESPACHADO',
  'ENTREGADO',
  'CANCELADO',
  'RECHAZADO',
]);

/**
 * Evalúa si una orden tiene su cita de entrega comprometida vencida.
 *
 * @param fechaCompromiso Fecha límite de entrega
 * @param horaCompromiso Hora comprometida (opcional, ej. "09:00")
 * @param estado Estado actual de la orden
 * @param currentDate Fecha de corte (por defecto hoy)
 */
export function checkCitaVencida(
  fechaCompromiso: string | Date | null | undefined,
  horaCompromiso?: string | null,
  estado?: string | null,
  currentDate: Date = new Date(),
): OrderSlaStatus {
  if (!fechaCompromiso) {
    return {
      isVencida: false,
      diasAtraso: 0,
      badgeTexto: '',
      alertaTerminal: '',
      alertaDetallada: '',
    };
  }

  // Si la orden ya llegó a un estado final, la cita ya no cuenta como atraso activo
  const estUpper = (estado || '').trim().toUpperCase();
  if (ESTADOS_FINALES.has(estUpper)) {
    return {
      isVencida: false,
      diasAtraso: 0,
      badgeTexto: '',
      alertaTerminal: '',
      alertaDetallada: '',
    };
  }

  const dComp = new Date(fechaCompromiso);
  if (isNaN(dComp.getTime())) {
    return {
      isVencida: false,
      diasAtraso: 0,
      badgeTexto: '',
      alertaTerminal: '',
      alertaDetallada: '',
    };
  }

  // Normalizar a día calendario YYYY-MM-DD
  const compDay = new Date(dComp.getFullYear(), dComp.getMonth(), dComp.getDate()).getTime();
  const todayDay = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate()).getTime();

  const diffMs = todayDay - compDay;
  const diasAtraso = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diasAtraso <= 0) {
    // Si es hoy, verificar si la hora compromiso ya expiró
    if (diasAtraso === 0 && horaCompromiso && horaCompromiso.includes(':')) {
      const [hh, mm] = horaCompromiso.split(':').map(Number);
      const nowH = currentDate.getHours();
      const nowM = currentDate.getMinutes();
      if (nowH > hh || (nowH === hh && nowM > (mm || 0))) {
        return {
          isVencida: true,
          diasAtraso: 0,
          badgeTexto: 'CITA VENCIDA · hoy',
          alertaTerminal: 'Pedido prioritario por atraso logístico',
          alertaDetallada: `Ventana de cita vencida hoy a las ${horaCompromiso} hrs. Prioridad alta de despacho.`,
        };
      }
    }

    return {
      isVencida: false,
      diasAtraso: 0,
      badgeTexto: '',
      alertaTerminal: '',
      alertaDetallada: '',
    };
  }

  const textoDias = diasAtraso === 1 ? 'hace 1 día' : `hace ${diasAtraso} días`;

  return {
    isVencida: true,
    diasAtraso,
    badgeTexto: `CITA VENCIDA · ${textoDias}`,
    alertaTerminal: 'Pedido prioritario por atraso logístico',
    alertaDetallada: `Pedido prioritario por atraso logístico (Cita vencida ${textoDias})`,
  };
}
