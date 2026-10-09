/**
 * Giving Out WMS — Date & Timezone Utilities
 * Resuelve T-01: Desfase de fechas de calendario (YYYY-MM-DD) vs timestamps UTC.
 * Garantiza que 2027-06-30 se muestre exactamente como 30/06/2027 sin retroceder 1 día por timezone local.
 */

export function formatCalendarDate(
  dateInput: string | Date | null | undefined,
  fallback = 'N/A'
): string {
  if (!dateInput) return fallback;

  try {
    let dateStr = '';
    if (typeof dateInput === 'string') {
      dateStr = dateInput.trim();
    } else if (dateInput instanceof Date) {
      dateStr = dateInput.toISOString();
    } else {
      dateStr = String(dateInput);
    }

    // Si viene en formato ISO (ej. 2027-06-30T00:00:00.000Z o 2027-06-30)
    const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      const [, year, month, day] = match;
      return `${day}/${month}/${year}`;
    }

    // Fallback con timeZone UTC para evitar que reste horas al estar a medianoche
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return fallback;
    return d.toLocaleDateString('es-MX', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch {
    return fallback;
  }
}

export function formatCalendarDateShort(
  dateInput: string | Date | null | undefined,
  fallback = 'N/A'
): string {
  if (!dateInput) return fallback;
  try {
    let dateStr = '';
    if (typeof dateInput === 'string') {
      dateStr = dateInput.trim();
    } else if (dateInput instanceof Date) {
      dateStr = dateInput.toISOString();
    } else {
      dateStr = String(dateInput);
    }

    const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      const [, year, month, day] = match;
      const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
      const mIdx = parseInt(month, 10) - 1;
      return `${parseInt(day, 10)} ${meses[mIdx] || month} ${year}`;
    }

    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return fallback;
    return d.toLocaleDateString('es-MX', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return fallback;
  }
}

export const WAREHOUSE_TIMEZONE = 'America/Mexico_City';

export interface FormatWarehouseDateTimeOptions {
  includeSeconds?: boolean;
  separator?: string; // Por defecto ' · '
  suffix?: string;    // Por defecto ' hrs'
  timeZone?: string;  // Por defecto 'America/Mexico_City'
}

/**
 * Convierte timestamps UTC de auditoría y base de datos a la zona horaria operativa del almacén.
 * Evita doble conversión y desfases de huso horario sin recurrir a restas manuales hardcodeadas.
 */
export function formatWarehouseDateTime(
  dateInput: string | Date | null | undefined,
  options?: FormatWarehouseDateTimeOptions,
  fallback = '—'
): string {
  if (!dateInput) return fallback;
  try {
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return String(dateInput);
    const timeZone = options?.timeZone || WAREHOUSE_TIMEZONE;
    const includeSeconds = options?.includeSeconds ?? true;
    const separator = options?.separator ?? ' · ';
    const suffix = options?.suffix ?? ' hrs';

    const dtf = new Intl.DateTimeFormat('es-MX', {
      timeZone,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: includeSeconds ? '2-digit' : undefined,
      hour12: false,
    });

    const parts = dtf.formatToParts(d);
    const getPart = (type: string) => parts.find(p => p.type === type)?.value || '';
    const day = getPart('day');
    const month = getPart('month');
    const year = getPart('year');
    const hour = getPart('hour');
    const minute = getPart('minute');
    const second = getPart('second');

    const timeStr = includeSeconds && second ? `${hour}:${minute}:${second}` : `${hour}:${minute}`;
    return `${day}/${month}/${year}${separator}${timeStr}${suffix}`;
  } catch {
    return String(dateInput);
  }
}

/**
 * Formateador unificado para líneas de tiempo, kárdex y bitácoras de auditoría:
 * Retorna exactamente: "DD/MM/YYYY · HH:mm:ss hrs" en zona horaria America/Mexico_City.
 */
export function formatTimelineDateTime(
  dateInput: string | Date | null | undefined,
  fallback = '—'
): string {
  return formatWarehouseDateTime(dateInput, { includeSeconds: true, separator: ' · ', suffix: ' hrs' }, fallback);
}

/**
 * Formateador estándar para actas, documentos y reportes ejecutivos:
 * Retorna: "DD/MM/YYYY · HH:mm:ss hrs" en zona horaria America/Mexico_City.
 */
export function formatDateTime(
  dateInput: string | Date | null | undefined,
  fallback = 'N/A',
  options?: FormatWarehouseDateTimeOptions
): string {
  return formatWarehouseDateTime(
    dateInput,
    {
      includeSeconds: options?.includeSeconds ?? true,
      separator: options?.separator ?? ' · ',
      suffix: options?.suffix ?? ' hrs',
      timeZone: options?.timeZone || WAREHOUSE_TIMEZONE,
    },
    fallback
  );
}

export function isCalendarDateExpired(dateInput: string | Date | null | undefined): boolean {
  if (!dateInput) return false;
  try {
    let dateStr = '';
    if (typeof dateInput === 'string') {
      dateStr = dateInput.trim();
    } else if (dateInput instanceof Date) {
      dateStr = dateInput.toISOString();
    }

    const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      const [, y, m, d] = match;
      // Fin del día de la fecha de caducidad en UTC
      const expiry = new Date(Date.UTC(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10), 23, 59, 59, 999));
      return expiry.getTime() < Date.now();
    }

    const d = new Date(dateInput);
    return !isNaN(d.getTime()) && d.getTime() < Date.now();
  } catch {
    return false;
  }
}
