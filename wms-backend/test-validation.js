// Test Suite para validar Tarea 6: Esquema Swagger y Validaciones de Datos Incompletos
// Ejecución: node test-validation.js
const BASE_URL = 'http://localhost:3001/api';

async function runTests() {
  console.log('================================================================');
  console.log('🧪 GIVING OUT WMS — VERIFICACIÓN DE TAREA 6');
  console.log('   Documentar Esquema OpenAPI y Validar Respuestas de Error');
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

  // 1. Swagger UI HTML
  await assertCase('1. Interfaz Swagger UI activa (GET /api/docs)', async () => {
    const res = await fetch('http://localhost:3001/api/docs');
    return {
      ok: res.status === 200,
      expected: 'HTTP 200',
      got: `HTTP ${res.status}`,
      detail: `Swagger UI disponible en navegador en http://localhost:3001/api/docs`
    };
  });

  // 2. Swagger OpenAPI JSON
  await assertCase('2. Esquema OpenAPI 3.0 exportable (GET /api/docs-json)', async () => {
    const res = await fetch('http://localhost:3001/api/docs-json');
    const data = await res.json();
    const hasReceipts = !!data.paths['/api/receipts'];
    const hasPrevio = !!data.paths['/api/receipts/previo'];
    return {
      ok: res.status === 200 && hasReceipts && hasPrevio,
      expected: 'HTTP 200 con rutas /receipts y /receipts/previo',
      got: `HTTP ${res.status} (Rutas presentes: receipts=${hasReceipts}, previo=${hasPrevio})`,
      detail: `Total de endpoints documentados: ${Object.keys(data.paths).length} rutas`
    };
  });

  // Obtener un cliente real de la BD
  let validClientId = null;
  try {
    const clientsRes = await fetch(`${BASE_URL}/clients`);
    const clients = await clientsRes.json();
    if (Array.isArray(clients) && clients.length > 0) {
      validClientId = clients[0].id;
    }
  } catch (e) {}

  // 3. Payload vacío
  await assertCase('3. Validación: Cuerpo de solicitud vacío ({})', async () => {
    const res = await fetch(`${BASE_URL}/receipts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    const json = await res.json();
    const isExpected = res.status === 400 && json.detalles?.codigo === 'CLIENTE_ID_REQUERIDO';
    return {
      ok: isExpected,
      expected: 'HTTP 400 (CLIENTE_ID_REQUERIDO)',
      got: `HTTP ${res.status} (${json.detalles?.codigo || json.message})`,
      detail: `Código recibido: ${json.detalles?.codigo} — Mensaje: "${json.message}"`
    };
  });

  // 4. Cliente depositante vacío
  await assertCase('4. Validación: clienteId vacío ("")', async () => {
    const res = await fetch(`${BASE_URL}/receipts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clienteId: '   ' })
    });
    const json = await res.json();
    const isExpected = res.status === 400 && json.detalles?.codigo === 'CLIENTE_ID_REQUERIDO';
    return {
      ok: isExpected,
      expected: 'HTTP 400 (CLIENTE_ID_REQUERIDO)',
      got: `HTTP ${res.status} (${json.detalles?.codigo})`,
      detail: `Código recibido: ${json.detalles?.codigo} — Campo: ${json.detalles?.campo}`
    };
  });

  // 5. Cliente inexistente en catálogo
  await assertCase('5. Validación: clienteId inexistente (UUID falso)', async () => {
    const res = await fetch(`${BASE_URL}/receipts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clienteId: '00000000-0000-0000-0000-000000000000',
        facturaRespaldo: 'FAC-TEST',
        lineas: [{ skuId: '00000000-0000-0000-0000-000000000001', cantidadEsperada: 10 }]
      })
    });
    const json = await res.json();
    const isExpected = res.status === 404 && json.detalles?.codigo === 'CLIENTE_NO_ENCONTRADO';
    return {
      ok: isExpected,
      expected: 'HTTP 404 (CLIENTE_NO_ENCONTRADO)',
      got: `HTTP ${res.status} (${json.detalles?.codigo})`,
      detail: `Código recibido: ${json.detalles?.codigo} — Mensaje: "${json.message}"`
    };
  });

  if (validClientId) {
    // 6. Sin documento de referencia
    await assertCase('6. Validación: Sin factura ni orden de compra', async () => {
      const res = await fetch(`${BASE_URL}/receipts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clienteId: validClientId,
          facturaRespaldo: '',
          ocReferencia: '',
          lineas: [{ skuId: 'test', cantidadEsperada: 10 }]
        })
      });
      const json = await res.json();
      const isExpected = res.status === 400 && json.detalles?.codigo === 'DOCUMENTO_REFERENCIA_REQUERIDO';
      return {
        ok: isExpected,
        expected: 'HTTP 400 (DOCUMENTO_REFERENCIA_REQUERIDO)',
        got: `HTTP ${res.status} (${json.detalles?.codigo})`,
        detail: `Código recibido: ${json.detalles?.codigo} — Mensaje: "${json.message}"`
      };
    });

    // 7. Partidas vacías (lineas: [])
    await assertCase('7. Validación: Lista de partidas vacía (lineas: [])', async () => {
      const res = await fetch(`${BASE_URL}/receipts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clienteId: validClientId,
          facturaRespaldo: 'FAC-2026-TEST',
          lineas: []
        })
      });
      const json = await res.json();
      const isExpected = res.status === 400 && json.detalles?.codigo === 'LINEAS_PREVIO_REQUERIDAS';
      return {
        ok: isExpected,
        expected: 'HTTP 400 (LINEAS_PREVIO_REQUERIDAS)',
        got: `HTTP ${res.status} (${json.detalles?.codigo})`,
        detail: `Código recibido: ${json.detalles?.codigo} — Mensaje: "${json.message}"`
      };
    });

    // 8. Partida sin skuId
    await assertCase('8. Validación: Partida sin skuId', async () => {
      const res = await fetch(`${BASE_URL}/receipts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clienteId: validClientId,
          facturaRespaldo: 'FAC-2026-TEST',
          lineas: [{ skuId: '', cantidadEsperada: 10 }]
        })
      });
      const json = await res.json();
      const isExpected = res.status === 400 && json.detalles?.codigo === 'SKU_ID_REQUERIDO';
      return {
        ok: isExpected,
        expected: 'HTTP 400 (SKU_ID_REQUERIDO)',
        got: `HTTP ${res.status} (${json.detalles?.codigo})`,
        detail: `Código recibido: ${json.detalles?.codigo} — Posición: ${json.detalles?.posicion}`
      };
    });

    // 9. Cantidad esperada <= 0 o no numérica
    await assertCase('9. Validación: Cantidad esperada <= 0 (cantidadEsperada: 0)', async () => {
      const res = await fetch(`${BASE_URL}/receipts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clienteId: validClientId,
          facturaRespaldo: 'FAC-2026-TEST',
          lineas: [{ skuId: 'sku-valido', cantidadEsperada: 0 }]
        })
      });
      const json = await res.json();
      const isExpected = res.status === 400 && json.detalles?.codigo === 'CANTIDAD_ESPERADA_INVALIDA';
      return {
        ok: isExpected,
        expected: 'HTTP 400 (CANTIDAD_ESPERADA_INVALIDA)',
        got: `HTTP ${res.status} (${json.detalles?.codigo})`,
        detail: `Código recibido: ${json.detalles?.codigo} — Posición: ${json.detalles?.posicion}, Valor: ${json.detalles?.valor}`
      };
    });
  }

  // 10. Carga dual sin archivo ni líneas manuales
  await assertCase('10. Validación: Carga dual vacía (POST /api/receipts/previo)', async () => {
    const res = await fetch(`${BASE_URL}/receipts/previo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    const json = await res.json();
    const isExpected = res.status === 400 && json.detalles?.codigo === 'ORIGEN_DATOS_PREVIO_VACIO';
    return {
      ok: isExpected,
      expected: 'HTTP 400 (ORIGEN_DATOS_PREVIO_VACIO)',
      got: `HTTP ${res.status} (${json.detalles?.codigo})`,
      detail: `Código recibido: ${json.detalles?.codigo} — Mensaje: "${json.message}"`
    };
  });

  // Obtener una recepción real de la BD si existe
  let validReceiptId = null;
  try {
    const receiptsRes = await fetch(`${BASE_URL}/receipts`);
    const recs = await receiptsRes.json();
    if (Array.isArray(recs) && recs.length > 0) {
      // Buscar una recepción que no esté cerrada
      const openRec = recs.find(r => r.estado !== 'CERRADA') || recs[0];
      validReceiptId = openRec.id;
    }
  } catch (e) {}

  // 11. Desbloqueo sin motivo
  await assertCase('11. Validación: Desbloqueo de previo sin motivo (POST /unlock)', async () => {
    const targetId = validReceiptId || '00000000-0000-0000-0000-000000000000';
    const res = await fetch(`${BASE_URL}/receipts/${targetId}/unlock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ motivo: '   ' })
    });
    const json = await res.json();
    // Si la recepción existe, devuelve 400 MOTIVO_DESBLOQUEO_REQUERIDO. Si no existe, valida 404 RECEPCION_NO_ENCONTRADA
    const isExpected = (res.status === 400 && json.detalles?.codigo === 'MOTIVO_DESBLOQUEO_REQUERIDO') ||
                       (!validReceiptId && res.status === 404 && json.detalles?.codigo === 'RECEPCION_NO_ENCONTRADA');
    return {
      ok: isExpected,
      expected: 'HTTP 400 (MOTIVO_DESBLOQUEO_REQUERIDO)',
      got: `HTTP ${res.status} (${json.detalles?.codigo})`,
      detail: `Código recibido: ${json.detalles?.codigo} — Mensaje: "${json.message}"`
    };
  });

  // 12. Cambio de estatus con estado inválido
  await assertCase('12. Validación: Transición a estatus inválido (PATCH /status)', async () => {
    const targetId = validReceiptId || '00000000-0000-0000-0000-000000000000';
    const res = await fetch(`${BASE_URL}/receipts/${targetId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ estado: 'ESTADO_INEXISTENTE' })
    });
    const json = await res.json();
    const isExpected = (res.status === 400 && json.detalles?.codigo === 'ESTADO_INVALIDO') ||
                       (!validReceiptId && res.status === 404 && json.detalles?.codigo === 'RECEPCION_NO_ENCONTRADA');
    return {
      ok: isExpected,
      expected: 'HTTP 400 (ESTADO_INVALIDO)',
      got: `HTTP ${res.status} (${json.detalles?.codigo})`,
      detail: `Código recibido: ${json.detalles?.codigo} — Mensaje: "${json.message}"`
    };
  });

  console.log('\n================================================================');
  console.log(`📊 RESULTADO FINAL: ${passed} pasadas, ${failed} fallidas (Total: ${passed + failed})`);
  console.log('================================================================');
}

runTests();
