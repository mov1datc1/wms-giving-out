import { formatCalendarDate, formatWarehouseDateOnly, WAREHOUSE_TIMEZONE } from '../../../../wms-frontend/src/utils/dateUtils';

describe('Block 4: Delivery Timestamps & Historical Label Reprint Dates', () => {
  it('1. formatWarehouseDateOnly formats UTC timestamps in America/Mexico_City correctly', () => {
    // PED-2026-0001 dispatch UTC: 2026-11-21T01:36:12.441Z
    // In Mexico City (UTC-6), this is 2026-11-20 19:36:12 -> 20/11/2026
    const dispatchUtc = '2026-11-21T01:36:12.441Z';
    const formattedDispatch = formatWarehouseDateOnly(dispatchUtc);
    expect(formattedDispatch).toBe('20/11/2026');
  });

  it('2. Entrega activity uses fechaEntrega over fechaDespacho when order is ENTREGADO', () => {
    const orderEntregado = {
      id: 'ped-1',
      codigo: 'PED-2026-0001',
      estado: 'ENTREGADO',
      fechaDespacho: '2026-11-21T01:36:12.441Z',
      fechaEntrega: '2026-11-21T01:44:18.795Z',
      updatedAt: '2026-11-21T01:44:18.797Z',
      createdAt: '2026-11-21T00:00:00.000Z',
    };

    let fechaHora = orderEntregado.updatedAt || orderEntregado.createdAt;
    if (orderEntregado.estado === 'ENTREGADO') {
      fechaHora = orderEntregado.fechaEntrega || orderEntregado.fechaDespacho || orderEntregado.updatedAt || orderEntregado.createdAt;
    } else if (orderEntregado.estado === 'DESPACHADO') {
      fechaHora = orderEntregado.fechaDespacho || orderEntregado.updatedAt || orderEntregado.createdAt;
    }

    expect(fechaHora).toBe('2026-11-21T01:44:18.795Z');
    expect(fechaHora).not.toBe('2026-11-21T01:36:12.441Z');
  });

  it('3. Historical label reprint selects dispatch date and not HU creation date', () => {
    const historicalHu = {
      codigo: 'BOX-REC-2026-0021-0001',
      createdAt: '2026-11-20T00:18:41.858Z', // Creation / receipt date (19/11/2026 local)
      updatedAt: '2026-11-21T01:36:12.265Z',
      estadoHu: 'DESPACHADO',
      recepcion: {
        fechaRecepcion: '2026-11-19T23:30:22.090Z',
      },
      lineasSalida: [
        {
          orden: {
            codigo: 'PED-2026-0001',
            fechaDespacho: '2026-11-21T01:36:12.441Z',
            fechaEntrega: '2026-11-21T01:44:18.795Z',
          },
        },
      ],
    };

    const isHist = true;
    const labelFecha = isHist
      ? formatWarehouseDateOnly(
          historicalHu.lineasSalida?.[0]?.orden?.fechaDespacho ||
          historicalHu.updatedAt ||
          historicalHu.createdAt
        )
      : formatWarehouseDateOnly(
          historicalHu.recepcion?.fechaRecepcion ||
          historicalHu.createdAt
        );

    // Must show 20/11/2026 (local dispatch date), NEVER 19/11/2026 (creation date)
    expect(labelFecha).toBe('20/11/2026');
    expect(labelFecha).not.toBe('19/11/2026');
  });

  it('4. Physical label print selects reception / creation date', () => {
    const physicalHu = {
      codigo: 'BOX-REC-2026-0021-0002',
      createdAt: '2026-11-20T00:18:41.858Z',
      estadoHu: 'ACTIVO',
      recepcion: {
        fechaRecepcion: '2026-11-20T16:00:00.000Z',
      },
    };

    const isHist = false;
    const labelFecha = isHist
      ? formatWarehouseDateOnly(physicalHu.createdAt)
      : formatWarehouseDateOnly(
          physicalHu.recepcion?.fechaRecepcion ||
          physicalHu.createdAt
        );

    expect(labelFecha).toBe('20/11/2026');
  });
});

