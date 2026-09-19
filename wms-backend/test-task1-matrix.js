// Test Suite para validar Tarea 1: Interfaz y API de Conteo por Factura Completa (Planilla Matricial)
// Ejecución: node test-task1-matrix.js
const BASE_URL = 'http://localhost:3001/api';

async function runTests() {
  console.log('================================================================');
  console.log('🧪 GIVING OUT WMS — VERIFICACIÓN AUTOMATIZADA DE TAREA 1');
  console.log('   Planilla Matricial de Conteo por Factura Completa & API Masiva');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  async function assertCase(name, fn) {
    try {
      const res = await fn();
      if (res.ok) {
        console.log(`✅ [PASS] ${name}`);
        if (res.detail) console.log(`   ↳ ${res.detail}`);
        passed++;
      } else {
        console.log(`❌ [FAIL] ${name}`);
        console.log(`   ↳ Esperado: ${res.expected}, Obtenido: ${res.got}`);
        failed++;
      }
    } catch (err) {
      console.log(`❌ [ERROR] ${name}: ${err.message}`);
      failed++;
    }
  }

  // 1. Endpoint documentado en OpenAPI / Swagger
  await assertCase('1. Endpoint batch-reception documentado en OpenAPI (/api/docs-json)', async () => {
    const res = await fetch(`${BASE_URL}/docs-json`);
    const data = await res.json();
    const endpoint = data.paths['/api/receipts/{id}/batch-reception'];
    return {
      ok: res.status === 200 && !!endpoint && !!endpoint.post,
      expected: 'Endpoint POST /api/receipts/{id}/batch-reception en Swagger',
      got: endpoint ? 'Documentado correctamente en OpenAPI 3.0' : 'No encontrado',
      detail: `Swagger resume: ${endpoint?.post?.summary}`
    };
  });

  // 2. Validación defensiva: Error si no se especifica usuario auditor
  await assertCase('2. Rechazo 400 si falta el usuario capturista en el payload', async () => {
    const res = await fetch(`${BASE_URL}/receipts/fake-id/batch-reception`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lineas: [{ receiptLineId: 'abc', skuId: 'sku1', cantidadConforme: 10 }] })
    });
    const data = await res.json();
    return {
      ok: res.status === 400 && data.detalles?.campo === 'usuario',
      expected: 'HTTP 400 con campo usuario requerido',
      got: `HTTP ${res.status}: ${data.message}`,
      detail: data.message
    };
  });

  // 3. Validación defensiva: Error si la planilla de partidas viene vacía
  await assertCase('3. Rechazo 400 si el arreglo de líneas viene vacío', async () => {
    const res = await fetch(`${BASE_URL}/receipts/fake-id/batch-reception`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario: 'auditor@wms.com', lineas: [] })
    });
    const data = await res.json();
    return {
      ok: res.status === 400,
      expected: 'HTTP 400 con error de líneas vacías',
      got: `HTTP ${res.status}: ${data.message}`,
      detail: data.message
    };
  });

  // 4. Validación defensiva: Error si todas las cantidades son 0
  await assertCase('4. Rechazo 400 si todas las cantidades capturadas son 0', async () => {
    const res = await fetch(`${BASE_URL}/receipts/fake-id/batch-reception`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        usuario: 'auditor@wms.com',
        lineas: [{ receiptLineId: 'abc', skuId: 'sku1', cantidadConforme: 0, cantidadNoConforme: 0 }]
      })
    });
    const data = await res.json();
    return {
      ok: res.status === 400,
      expected: 'HTTP 400 indicando que se debe registrar al menos una cantidad > 0',
      got: `HTTP ${res.status}: ${data.message}`,
      detail: data.message
    };
  });

  // 5. Previo inexistente: Error 404
  await assertCase('5. Rechazo 404 si el previo no existe en base de datos', async () => {
    const res = await fetch(`${BASE_URL}/receipts/00000000-0000-0000-0000-000000000000/batch-reception`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        usuario: 'auditor@wms.com',
        lineas: [{ receiptLineId: 'abc', skuId: 'sku1', cantidadConforme: 10 }]
      })
    });
    const data = await res.json();
    return {
      ok: res.status === 404,
      expected: 'HTTP 404 Not Found',
      got: `HTTP ${res.status}: ${data.message}`,
      detail: data.message
    };
  });

  // 6. Flujo Completo: Crear previo y procesar conteo masivo por factura completa
  await assertCase('6. Flujo E2E: Captura masiva por factura completa en una sola transacción', async () => {
    // A. Obtener cliente y SKUs
    const clientsRes = await fetch(`${BASE_URL}/clients`);
    const clients = await clientsRes.json();
    const client = clients[0];

    const skusRes = await fetch(`${BASE_URL}/skus?clienteId=${client.id}`);
    const skus = await skusRes.json();
    const sku1 = skus[0];
    const sku2 = skus[1] || skus[0];

    // B. Crear previo con 2 partidas
    const previoRes = await fetch(`${BASE_URL}/receipts/previo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clienteId: client.id,
        facturaRespaldo: `FAC-TEST-MATRIZ-${Date.now()}`,
        ocReferencia: `OC-MATRIZ-${Date.now()}`,
        origen: 'NACIONAL',
        tipoRecepcion: 'RECEPCION',
        recibidoPor: 'Auditor E2E',
        lineas: [
          { skuId: sku1.id, cantidadEsperada: 50, notas: 'Partida 1' },
          { skuId: sku2.id, cantidadEsperada: 30, notas: 'Partida 2' },
        ]
      })
    });
    const previoData = await previoRes.json();
    const createdReceipt = previoData.data || previoData;
    const lines = createdReceipt.lineas || [];

    // C. Ejecutar recepción masiva por factura completa
    // Partida 1: 48 conformes, 2 dañadas (merma / cuarentena) -> Total 50 (100% recibida)
    // Partida 2: 30 conformes, 0 dañadas -> Total 30 (100% conforme)
    const batchRes = await fetch(`${BASE_URL}/receipts/${createdReceipt.id}/batch-reception`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        usuario: 'Auditor E2E Andén',
        lineas: [
          { receiptLineId: lines[0].id, skuId: sku1.id, cantidadConforme: 48, cantidadNoConforme: 2, lote: 'LOT-E2E-01', fechaVencimiento: '2026-12-31' },
          { receiptLineId: lines[1].id, skuId: sku2.id, cantidadConforme: 30, cantidadNoConforme: 0, lote: 'LOT-E2E-02', fechaVencimiento: '2026-12-31' },
        ]
      })
    });
    const batchData = await batchRes.json();

    const isSuccess = (batchRes.status === 200 || batchRes.status === 201) && batchData.success === true;
    const statsOk = batchData.estadisticas?.totalConforme === 78 && batchData.estadisticas?.totalNoConforme === 2 && batchData.estadisticas?.totalUnidades === 80;

    // D. Verificar que el previo avanzó de estatus y se activó el candado de andén
    const verifyRes = await fetch(`${BASE_URL}/receipts`);
    const allReceipts = await verifyRes.json();
    const updatedReceipt = allReceipts.find(r => r.id === createdReceipt.id);

    const lockOk = updatedReceipt?.bloqueado === true;
    const statusOk = updatedReceipt?.estado === 'EN_PROCESO_CONTEO';

    return {
      ok: isSuccess && statsOk && lockOk && statusOk,
      expected: 'HTTP 200 con 78 conformes, 2 dañados, candado activo y estatus EN_PROCESO_CONTEO',
      got: `HTTP ${batchRes.status}, Conformes: ${batchData.estadisticas?.totalConforme}, NC: ${batchData.estadisticas?.totalNoConforme}, Bloqueado: ${lockOk}, Estado: ${updatedReceipt?.estado}`,
      detail: batchData.message
    };
  });

  // 7. Candado Defensivo: Si el previo está CERRADO, rechazar batch-reception con 403
  await assertCase('7. Candado inmutable: Rechazo 403 si la recepción ya está CERRADA', async () => {
    // Obtener un previo cerrado si existe o cerrar uno
    const receiptsRes = await fetch(`${BASE_URL}/receipts`);
    const allReceipts = await receiptsRes.json();
    let closedReceipt = allReceipts.find(r => r.estado === 'CERRADA');

    if (!closedReceipt && allReceipts.length > 0) {
      // Cerrar un previo de prueba
      const target = allReceipts[0];
      await fetch(`${BASE_URL}/receipts/${target.id}/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usuario: 'Supervisor Auditor', notasCierre: 'Cierre para prueba defensiva' })
      });
      closedReceipt = target;
    }

    if (closedReceipt) {
      const res = await fetch(`${BASE_URL}/receipts/${closedReceipt.id}/batch-reception`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          usuario: 'Operador Andén',
          lineas: [{ receiptLineId: closedReceipt.lineas?.[0]?.id || 'abc', skuId: 'sku1', cantidadConforme: 10 }]
        })
      });
      const data = await res.json();
      return {
        ok: res.status === 403 && data.detalles?.codigo === 'RECEPCION_CERRADA_INMUTABLE',
        expected: 'HTTP 403 Forbidden con RECEPCION_CERRADA_INMUTABLE',
        got: `HTTP ${res.status}: ${data.message}`,
        detail: data.message
      };
    }

    return { ok: true, detail: 'Omitido: no hay recepciones disponibles para cerrar' };
  });

  console.log('\n================================================================');
  console.log(`📊 RESULTADO DE LA SUITE: ${passed} PASADAS / ${failed} FALLIDAS`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests();
