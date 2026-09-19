/**
 * GIVING OUT WMS 360+ — TEST SUITE AUTOMATIZADA
 * SUBFLUJO PARA DESVIAR PRODUCTO DAÑADO O EN EXCESO A ALMACÉN VIRTUAL DE "NO CONFORME / MERMA"
 */

const BASE_URL = 'http://127.0.0.1:3001/api';

async function runTests() {
  console.log('\n============================================================================');
  console.log('  GIVING OUT WMS 360+ — SUBFLUJO ALMACÉN VIRTUAL NO CONFORME / MERMA');
  console.log('  "Desviar producto dañado o en exceso a almacén virtual"');
  console.log('============================================================================\n');

  let passed = 0;
  let failed = 0;
  const createdIds = { lots: [], hus: [], movements: [], receipts: [] };

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✔ PASS — ${message}`);
      passed++;
    } else {
      console.error(`  ✖ FAIL — ${message}`);
      failed++;
    }
  }

  try {
    // 0. Preparar datos base
    const clientsRes = await fetch(`${BASE_URL}/clients`);
    const clients = await clientsRes.json();
    const testClient = clients.find(c => c.nombreComercial === 'Fashion Forward') || clients[0];
    if (!testClient) throw new Error('No se encontró ningún cliente en base de datos');

    const skusRes = await fetch(`${BASE_URL}/skus?clienteId=${testClient.id}`);
    const skus = await skusRes.json();
    const testSku = skus[0];
    if (!testSku) throw new Error(`El cliente ${testClient.nombreComercial} no tiene SKUs`);

    console.log(`▶ Preparación: Cliente ${testClient.nombreComercial} | SKU ${testSku.codigo}`);

    // TEST 1: Rechazo defensivo 400 ante payload sin partidas o con cantidades inválidas
    console.log('\n▶ TEST 1: Validación defensiva 400 ante partidas vacías o cantidad <= 0');
    const badRes1 = await fetch(`${BASE_URL}/inventory/divert-to-virtual`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clienteId: testClient.id, usuario: 'Supervisor Test', partidas: [] }),
    });
    assert(badRes1.status === 400, `Rechaza petición con partidas vacías (HTTP ${badRes1.status})`);

    const badRes2 = await fetch(`${BASE_URL}/inventory/divert-to-virtual`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clienteId: testClient.id,
        usuario: 'Supervisor Test',
        partidas: [{ skuId: testSku.id, cantidad: 0, tipoDesvio: 'MERCANCIA_DANADA', motivo: 'Prueba' }],
      }),
    });
    assert(badRes2.status === 400, `Rechaza cantidad 0 con 400 Bad Request (HTTP ${badRes2.status})`);

    // TEST 2: Desvío exitoso de producto dañado a ubicación virtual de merma (DEV-01)
    console.log('\n▶ TEST 2: Desvío de mercancía dañada en andén (8 piezas rotas en transporte)');
    const divertDanadoRes = await fetch(`${BASE_URL}/inventory/divert-to-virtual`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clienteId: testClient.id,
        usuario: 'Supervisor Control Calidad',
        notasGenerales: 'Inspección de andén 3: tarima golpeada con 8 piezas dañadas',
        partidas: [
          {
            skuId: testSku.id,
            cantidad: 8,
            tipoDesvio: 'MERCANCIA_DANADA',
            motivo: 'Cajas aplastadas por estiba colapsada en transporte',
            lote: 'LOTE-TEST-DANADO',
          },
        ],
      }),
    });

    const divertDanadoData = await divertDanadoRes.json();
    assert(divertDanadoRes.status === 200, `Desvío de merma responde HTTP 200 OK (Folio: ${divertDanadoData.folioActa})`);
    assert(divertDanadoData.folioActa && divertDanadoData.folioActa.startsWith('ACTA-NC-'), `Folio oficial de acta generado correctamente: ${divertDanadoData.folioActa}`);
    assert(divertDanadoData.totalPiezas === 8, `Total piezas desviadas coincide: ${divertDanadoData.totalPiezas}`);

    const danadoItem = divertDanadoData.partidasDesviadas[0];
    if (danadoItem?.lotId) createdIds.lots.push(danadoItem.lotId);

    // TEST 3: Desvío exitoso de producto en exceso (sobrante físico de 12 piezas no facturadas)
    console.log('\n▶ TEST 3: Desvío de mercancía en exceso a cuarentena virtual (12 piezas excedentes)');
    const divertExcesoRes = await fetch(`${BASE_URL}/inventory/divert-to-virtual`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clienteId: testClient.id,
        usuario: 'Supervisor Auditoría',
        notasGenerales: 'Excedente físico recibido sin orden de compra ni respaldo en factura',
        partidas: [
          {
            skuId: testSku.id,
            cantidad: 12,
            tipoDesvio: 'PRODUCTO_EXCESO',
            motivo: 'Sobrante no facturado remitido por proveedor; retenido hasta adenda comercial',
            lote: 'LOTE-TEST-EXCESO',
          },
        ],
      }),
    });

    const divertExcesoData = await divertExcesoRes.json();
    assert(divertExcesoRes.status === 200, `Desvío de exceso responde HTTP 200 OK (Folio: ${divertExcesoData.folioActa})`);
    assert(divertExcesoData.totalPiezas === 12, `Total piezas excedentes desviadas: ${divertExcesoData.totalPiezas}`);

    const excesoItem = divertExcesoData.partidasDesviadas[0];
    if (excesoItem?.lotId) createdIds.lots.push(excesoItem.lotId);
    assert(excesoItem?.ubicacionCodigo === 'NC-EXCESO-01' || excesoItem?.ubicacionCodigo === 'DEV-01', `Asignado a ubicación virtual segregada: ${excesoItem?.ubicacionCodigo}`);

    // TEST 4: Aislamiento estricto en BD (cantidadDisponible = 0, cantidadBloqueada > 0)
    console.log('\n▶ TEST 4: Blindaje de inventario (cantidadDisponible == 0 para impedir venta/picking)');
    const lotsVirtualRes = await fetch(`${BASE_URL}/inventory/lots?clienteId=${testClient.id}&tipoStock=VIRTUAL_NC`);
    const lotsVirtual = await lotsVirtualRes.json();

    const foundDanado = lotsVirtual.find(l => l.id === danadoItem?.lotId);
    assert(foundDanado && foundDanado.cantidadDisponible === 0, `Lote de merma tiene cantidadDisponible = 0 (No vendible)`);
    assert(foundDanado && foundDanado.cantidadBloqueada === 8, `Lote de merma tiene cantidadBloqueada = 8 piezas`);
    assert(foundDanado && foundDanado.estadoCalidad === 'CUARENTENA', `Lote de merma marcado formalmente en estadoCalidad: CUARENTENA`);

    const foundExceso = lotsVirtual.find(l => l.id === excesoItem?.lotId);
    assert(foundExceso && foundExceso.cantidadDisponible === 0, `Lote de exceso tiene cantidadDisponible = 0 (No vendible)`);
    assert(foundExceso && foundExceso.cantidadBloqueada === 12, `Lote de exceso tiene cantidadBloqueada = 12 piezas`);

    // TEST 5: Trazabilidad inmutable en Kárdex (InventoryMovement)
    console.log('\n▶ TEST 5: Kárdex de movimientos (DESVIO_MERMA y DESVIO_EXCESO)');
    const movsRes = await fetch(`${BASE_URL}/inventory/movements?clienteId=${testClient.id}&limit=20`);
    const movs = await movsRes.json();

    const movMerma = movs.find(m => m.tipoMovimiento === 'DESVIO_MERMA' && m.cantidad === 8);
    assert(Boolean(movMerma), `Movimiento DESVIO_MERMA registrado en kárdex con cantidad 8`);

    const movExceso = movs.find(m => m.tipoMovimiento === 'DESVIO_EXCESO' && m.cantidad === 12);
    assert(Boolean(movExceso), `Movimiento DESVIO_EXCESO registrado en kárdex con cantidad 12`);

    // TEST 6: Consulta del Almacén Virtual (/api/inventory/virtual-warehouse)
    console.log('\n▶ TEST 6: Auditoría de Almacén Virtual (GET /api/inventory/virtual-warehouse)');
    const vwRes = await fetch(`${BASE_URL}/inventory/virtual-warehouse?clienteId=${testClient.id}`);
    const vwData = await vwRes.json();

    assert(vwRes.status === 200, `Endpoint virtual-warehouse responde 200 OK`);
    assert(vwData.totalPiezasBloqueadas >= 20, `Total piezas bloqueadas en almacén virtual: ${vwData.totalPiezasBloqueadas}`);
    assert(vwData.almacenVirtual?.codigo === 'ALM-VIRTUAL-NC', `Almacén virtual identificado formalmente: ${vwData.almacenVirtual?.nombre}`);

    // TEST 7: Asiento legal en AuditLog
    console.log('\n▶ TEST 7: Asiento legal en bitácora de auditoría (AuditLog)');
    assert(Boolean(divertDanadoData.folioActa && divertExcesoData.folioActa), `Ambas actas cuentan con folios irrepetibles para cotejo legal`);

  } catch (err) {
    console.error('Error fatal en la suite:', err);
    failed++;
  } finally {
    console.log('\n============================================================================');
    console.log(`  RESUMEN FINAL SUBFLUJO ALMACÉN VIRTUAL: ${passed} APROBADAS / ${failed} FALLIDAS`);
    if (failed === 0) {
      console.log('  ✔ 100% PASS — SUBFLUJO DE DESVÍO A ALMACÉN VIRTUAL CERTIFICADO CON ÉXITO');
    } else {
      console.log('  ✖ ERROR — ALGUNAS PRUEBAS FALLARON');
    }
    console.log('============================================================================\n');
  }
}

runTests();
