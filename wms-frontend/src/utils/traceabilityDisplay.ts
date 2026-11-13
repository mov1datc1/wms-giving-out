import { formatCalendarDate } from './dateUtils';

export interface MovementLocationRef {
  codigo?: string | null;
  tipoUbicacion?: string | null;
}

export interface MovementDisplayInput {
  motivo?: string | null;
  toLocation?: MovementLocationRef | null;
}

/**
 * Formatea una fecha de caducidad como calendar-day (DD/MM/YYYY) sin conversión UTC -> local,
 * evitando desfases de -1 día en husos horarios negativos (ej. 2027-06-30 -> 30/06/2027).
 */
export function formatMovementExpiryDate(
  fechaVencimiento: string | Date | null | undefined,
  fallback = 'N/A',
): string {
  return formatCalendarDate(fechaVencimiento, fallback);
}

/**
 * Determina si una ubicación destino corresponde a una estantería/rack multinivel histórico
 * (Axx/Bxx o tipoUbicacion ESTANTERIA/RACK), distinguiéndola de posiciones en piso (TARIMA_PISO).
 */
export function isHistoricalRackLocation(loc?: MovementLocationRef | null): boolean {
  const codigo = String(loc?.codigo || '').trim().toUpperCase();
  const tipo = String(loc?.tipoUbicacion || '').toUpperCase().trim();

  if (tipo === 'TARIMA_PISO' || tipo === 'PISO' || tipo === 'PNC' || tipo === 'DEVOLUCION' || tipo === 'RECIBO' || tipo === 'STAGING') {
    return false;
  }
  if (/^G\d+/i.test(codigo)) {
    return false;
  }
  if (tipo === 'ESTANTERIA' || tipo === 'RACK') {
    return true;
  }
  return /^[AB]\d{2}-R\d{2}-N\d+/i.test(codigo);
}

/**
 * Normaliza en UI la redacción de presentación de un motivo histórico de movimiento sin alterar
 * el registro inmutable almacenado en BD: cuando el destino no es un rack histórico multinivel,
 * reemplaza frases heredadas "... a rack <CODIGO>" por "... en posición física <CODIGO>".
 */
export function formatMovementMotivoDisplay(
  movement: MovementDisplayInput | null | undefined,
): string {
  const raw = String(movement?.motivo || '').trim();
  if (!raw) return '';

  if (isHistoricalRackLocation(movement?.toLocation)) {
    return raw;
  }

  let normalized = raw
    .replace(/\bconfirmado\s+a\s+rack\s+([A-Za-z0-9_-]+)/gi, 'confirmado en posición física $1')
    .replace(/\bPutaway\s+a\s+rack\s+([A-Za-z0-9_-]+)/gi, 'Putaway en posición física $1')
    .replace(/\bAlojado\s+desde\s+([^\s]+)\s+a\s+rack\s+([A-Za-z0-9_-]+)/gi, 'Alojado desde $1 en posición física $2')
    .replace(/\b(?:a|al|en)\s+rack\s+(G\d{4})\b/gi, 'en posición física $1')
    .replace(/\brack\s+(G\d{4})\b/gi, 'posición física $1');

  const destCode = String(movement?.toLocation?.codigo || '').trim();
  if (destCode && normalized === raw) {
    const escapedCode = destCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    normalized = normalized.replace(
      new RegExp(`\\ba\\s+rack\\s+${escapedCode}\\b`, 'gi'),
      `en posición física ${destCode}`,
    );
  }

  return normalized;
}

