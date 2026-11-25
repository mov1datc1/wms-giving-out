export const PORTAL_POLL_INTERVAL_MS = 30_000;
export const PORTAL_FOCUS_THROTTLE_MS = 3_000;

export type PortalOrderBadgeClass = 'info' | 'warning' | 'success' | 'danger' | 'default';

export type PortalOrderIconKey =
  | 'clock'
  | 'thumbsUp'
  | 'scanLine'
  | 'package'
  | 'truck'
  | 'checkCircle'
  | 'thumbsDown'
  | 'none';

export type PortalOrderFilter = 'all' | 'active' | 'delivered' | 'rejected';

export interface PortalOrderStatusMeta {
  cls: PortalOrderBadgeClass;
  iconKey: PortalOrderIconKey;
  label: string;
  desc: string;
  step: number;
  hasReservedStock: boolean;
  isDispatched: boolean;
  isTerminalNegative: boolean;
}

export const PORTAL_TIMELINE_STEPS = [
  { num: 1, key: 'SOLICITADO', label: 'Solicitado', iconKey: 'clock' as PortalOrderIconKey },
  { num: 2, key: 'APROBADO', label: 'Aprobado', iconKey: 'thumbsUp' as PortalOrderIconKey },
  { num: 3, key: 'PREPARANDO', label: 'Preparando', iconKey: 'scanLine' as PortalOrderIconKey },
  { num: 4, key: 'LISTO', label: 'Listo', iconKey: 'package' as PortalOrderIconKey },
  { num: 5, key: 'ENVIADO', label: 'Enviado', iconKey: 'truck' as PortalOrderIconKey },
  { num: 6, key: 'ENTREGADO', label: 'Entregado', iconKey: 'checkCircle' as PortalOrderIconKey },
] as const;

export const PORTAL_ACTIVE_STATUSES = [
  'SOLICITADO',
  'PENDIENTE_APROBACION',
  'APROBADO',
  'EN_PREPARACION',
  'EN_PICKING',
  'CONSOLIDADO',
  'DESPACHADO',
] as const;

export const PORTAL_RESERVED_STATUSES = [
  'SOLICITADO',
  'PENDIENTE_APROBACION',
  'APROBADO',
  'EN_PREPARACION',
  'EN_PICKING',
  'CONSOLIDADO',
] as const;

export const PORTAL_NEGATIVE_STATUSES = ['RECHAZADO', 'CANCELADO'] as const;

const STATUS_META_MAP: Record<string, PortalOrderStatusMeta> = {
  SOLICITADO: {
    cls: 'info',
    iconKey: 'clock',
    label: 'Solicitado',
    desc: 'Pedido recibido con stock reservado. Pendiente de validación.',
    step: 1,
    hasReservedStock: true,
    isDispatched: false,
    isTerminalNegative: false,
  },
  PENDIENTE_APROBACION: {
    cls: 'warning',
    iconKey: 'clock',
    label: 'En Revisión',
    desc: 'Giving Out está validando tu pedido',
    step: 1,
    hasReservedStock: true,
    isDispatched: false,
    isTerminalNegative: false,
  },
  APROBADO: {
    cls: 'success',
    iconKey: 'thumbsUp',
    label: 'Aprobado',
    desc: 'Pedido aprobado. En cola para recolección y preparación en almacén.',
    step: 2,
    hasReservedStock: true,
    isDispatched: false,
    isTerminalNegative: false,
  },
  EN_PREPARACION: {
    cls: 'warning',
    iconKey: 'scanLine',
    label: 'En Preparación',
    desc: 'Tu pedido está en preparación en almacén',
    step: 3,
    hasReservedStock: true,
    isDispatched: false,
    isTerminalNegative: false,
  },
  EN_PICKING: {
    cls: 'warning',
    iconKey: 'scanLine',
    label: 'En Preparación',
    desc: 'Tu pedido está siendo recolectado en racks',
    step: 3,
    hasReservedStock: true,
    isDispatched: false,
    isTerminalNegative: false,
  },
  CONSOLIDADO: {
    cls: 'info',
    iconKey: 'package',
    label: 'Listo para Envío',
    desc: 'Tu pedido está embalado y etiquetado para el transporte',
    step: 4,
    hasReservedStock: true,
    isDispatched: false,
    isTerminalNegative: false,
  },
  DESPACHADO: {
    cls: 'warning',
    iconKey: 'truck',
    label: 'En Tránsito',
    desc: 'Tu pedido fue despachado y va en camino',
    step: 5,
    hasReservedStock: false,
    isDispatched: true,
    isTerminalNegative: false,
  },
  ENTREGADO: {
    cls: 'success',
    iconKey: 'checkCircle',
    label: 'Entregado',
    desc: 'Tu pedido fue recibido de conformidad en destino',
    step: 6,
    hasReservedStock: false,
    isDispatched: true,
    isTerminalNegative: false,
  },
  RECHAZADO: {
    cls: 'danger',
    iconKey: 'thumbsDown',
    label: 'Rechazado',
    desc: 'Tu pedido fue cancelado o rechazado (stock liberado)',
    step: 0,
    hasReservedStock: false,
    isDispatched: false,
    isTerminalNegative: true,
  },
  CANCELADO: {
    cls: 'default',
    iconKey: 'thumbsDown',
    label: 'Cancelado',
    desc: 'Tu pedido fue cancelado (stock liberado)',
    step: 0,
    hasReservedStock: false,
    isDispatched: false,
    isTerminalNegative: true,
  },
};

export function getPortalOrderStatusMeta(estado: string): PortalOrderStatusMeta {
  const normalized = String(estado || '').trim().toUpperCase();
  return (
    STATUS_META_MAP[normalized] || {
      cls: 'default',
      iconKey: 'none',
      label: estado,
      desc: '',
      step: 0,
      hasReservedStock: false,
      isDispatched: false,
      isTerminalNegative: false,
    }
  );
}

export interface PortalTimelineStepState {
  num: number;
  key: string;
  label: string;
  iconKey: PortalOrderIconKey;
  status: 'completed' | 'active' | 'pending';
  connectorActive: boolean;
}

export interface PortalTimelineView {
  visible: boolean;
  currentStep: number;
  activeLabel: string | null;
  steps: PortalTimelineStepState[];
}

export function getPortalTimelineState(estado: string): PortalTimelineView {
  const meta = getPortalOrderStatusMeta(estado);
  const currentStep = meta.step;
  const visible = currentStep > 0;

  const steps: PortalTimelineStepState[] = PORTAL_TIMELINE_STEPS.map((s) => ({
    num: s.num,
    key: s.key,
    label: s.label,
    iconKey: s.iconKey,
    status: !visible
      ? 'pending'
      : s.num < currentStep
        ? 'completed'
        : s.num === currentStep
          ? 'active'
          : 'pending',
    connectorActive: visible && s.num < currentStep,
  }));

  const activeStep = steps.find((s) => s.status === 'active') || null;
  return {
    visible,
    currentStep,
    activeLabel: activeStep ? activeStep.label : null,
    steps,
  };
}

export function getPortalLineAssignedQty(
  orderEstado: string,
  line: { cantidadAsignada?: number | null; cantidadSolicitada?: number | null },
): number {
  const normalized = String(orderEstado || '').trim().toUpperCase();
  if ((PORTAL_NEGATIVE_STATUSES as readonly string[]).includes(normalized)) {
    return 0;
  }
  const assigned = Number(line?.cantidadAsignada ?? 0);
  if (!Number.isFinite(assigned) || assigned <= 0) {
    return 0;
  }
  return assigned;
}

export function getPortalRejectionBanner(order: {
  estado?: string | null;
  motivoRechazo?: string | null;
}): { visible: boolean; label: string; reason: string } {
  const normalized = String(order?.estado || '').trim().toUpperCase();
  const reason = String(order?.motivoRechazo || '').trim();
  if ((normalized === 'RECHAZADO' || normalized === 'CANCELADO') && reason.length > 0) {
    return {
      visible: true,
      label: normalized === 'CANCELADO' ? 'Motivo de cancelación' : 'Motivo de rechazo',
      reason,
    };
  }
  return { visible: false, label: '', reason: '' };
}

export function filterPortalOrders<T extends { estado?: string | null }>(
  orders: T[],
  filter: PortalOrderFilter | string,
): T[] {
  return orders.filter((o) => {
    const est = String(o.estado || '').trim().toUpperCase();
    if (filter === 'all') return true;
    if (filter === 'active') return (PORTAL_ACTIVE_STATUSES as readonly string[]).includes(est);
    if (filter === 'delivered') return est === 'ENTREGADO';
    if (filter === 'rejected') return (PORTAL_NEGATIVE_STATUSES as readonly string[]).includes(est);
    return true;
  });
}

export function getPortalOrderCounts(orders: Array<{ estado?: string | null }>) {
  let activeCount = 0;
  let reservedCount = 0;
  let deliveredCount = 0;
  let transitCount = 0;
  let rejectedCount = 0;

  for (const o of orders) {
    const est = String(o.estado || '').trim().toUpperCase();
    if ((PORTAL_ACTIVE_STATUSES as readonly string[]).includes(est)) activeCount++;
    if ((PORTAL_RESERVED_STATUSES as readonly string[]).includes(est)) reservedCount++;
    if (est === 'ENTREGADO') deliveredCount++;
    if (est === 'DESPACHADO') transitCount++;
    if ((PORTAL_NEGATIVE_STATUSES as readonly string[]).includes(est)) rejectedCount++;
  }

  return {
    total: orders.length,
    activeCount,
    reservedCount,
    deliveredCount,
    transitCount,
    rejectedCount,
  };
}

export function getPortalDashboardBadgeClass(estado: string): PortalOrderBadgeClass {
  const normalized = String(estado || '').trim().toUpperCase();
  if (normalized === 'DESPACHADO') return 'success';
  return getPortalOrderStatusMeta(normalized).cls;
}

