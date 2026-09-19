// ============================================================================
// GIVING OUT WMS 360+ — SUITE OFICIAL DE VALIDACIÓN DE TAREA 5 (SPRINT #3)
// "Bloquear el cierre de recepción si existen discrepancias sin justificación o clasificación de estatus"
//
// Ejecución: node test-task5-closing-lock.js
// ============================================================================

require('dotenv').config();
const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient } = require('@prisma/client');

const API_BASE_URL = process.env.API_URL || 'http://127.0.0.1:3001/api';

// --- UTILITARIOS DE REPORTE Y ASSERTIONS ---
let passedTests = 0;
let failedTests = 0;
const results = [];

function assert(condition, testName, details = '') {
  if (condition) {
    passedTests++;
    results.push({ name: testName, passed: true, details });
    console.log(`  \x1b[32m✔ PASS\x1b[0m — ${testName}`);
    if (details) console.log(`         \x1b[90m${details}\x1b[0m`);
  } else {
    failedTests++;
    results.push({ name: testName, passed: false, details });
    console.log(`  \x1b[31m✖ FAIL\x1b[0m — ${testName}`);
    if (details) console.log(`         \x1b[31m${details}\x1b[0m`);
  }
}

async function runTestSuite() {
  console.log('\n============================================================================');
  console.log('  GIVING OUT WMS 360+ — SPRINT #3 TAREA 5: TEST SUITE CANDADO DE CIERRE');
  console.log('  "Bloquear el cierre si existen discrepancias sin justificación o estatus"');
  console.log('============================================================================\n');

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  const createdReceiptIds = [];
  const createdClientIds = [];
  const createdSkuIds = [];

  try {
    // 0. Preparar cliente y SKU de prueba
    const testClient = await prisma.client.create({
      data: {
        codigo: `CLI-TASK5-${Date.now()}`,
        razonSocial: 'Cliente de Prueba Task 5 Auditoría',
        nombreComercial: 'Task 5 Test Client',
        giro: 'GENERAL',
        activo: true,
      },
    });
    createdClientIds.push(testClient.id);

    const testSkuA = await prisma.skuMaster.create({
      data: {
        codigo: `SKU-T5-A-${Date.now()}`,
        descripcion: 'Playera Dry-Fit Azul M',
        clienteId: testClient.id,
        categoria: 'ROPA',
        uomBase: 'PZA',
        activo: true,
      },
    });
    createdSkuIds.push(testSkuA.id);

    const testSkuB = await prisma.skuMaster.create({
      data: {
        codigo: `SKU-T5-B-${Date.now()}`,
        descripcion: 'Pantalón Cargo Negro 32',
        clienteId: testClient.id,
        categoria: 'ROPA',
        uomBase: 'PZA',
        activo: true,
      },
    });
    createdSkuIds.push(testSkuB.id);

    // ------------------------------------------------------------------------
    // TEST 1: Intentar cerrar recepción con faltante físico (-20 pzas) sin justificación ni clasificación
    // ------------------------------------------------------------------------
    console.log('\x1b[36m▶ TEST 1: Candado de Cierre ante Faltante sin Justificación (-20 pzas)\x1b[0m');
    const receipt1 = await prisma.receipt.create({
      data: {
        codigo: `REC-T5-FALT-${Date.now()}`,
        clienteId: testClient.id,
        facturaRespaldo: 'FAC-T5-001',
        ocReferencia: 'OC-T5-001',
        estado: 'EN_PROCESO_CONTEO',
        lineas: {
          create: [
            {
              skuId: testSkuA.id,
              cantidadEsperada: 100,
              cantidadRecibida: 80, // Faltan 20
              cantidadDanada: 0,
              estado: 'PARCIAL',
            },
          ],
        },
      },
      include: { lineas: true },
    });
    createdReceiptIds.push(receipt1.id);

    const res1 = await fetch(`${API_BASE_URL}/receipts/${receipt1.id}/close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        usuario: 'Supervisor Auditor Andén',
        notasCierre: 'Intento de cierre con faltante no justificado',
      }),
    });

    const body1 = await res1.json();
    assert(
      res1.status === 400 && body1?.detalles?.codigo === 'CIERRE_BLOQUEADO_POR_DISCREPANCIA',
      'Test 1: Backend bloquea cierre con 400 Bad Request cuando hay faltante sin justificación',
      `HTTP Status: ${res1.status}, Código de error: ${body1?.detalles?.codigo}, Msg: ${body1?.message?.slice(0, 75)}...`
    );

    // ------------------------------------------------------------------------
    // TEST 2: Intentar cerrar enviando clasificación pero dejando justificación en blanco
    // ------------------------------------------------------------------------
    console.log('\n\x1b[36m▶ TEST 2: Rechazo cuando falta la justificación textual del motivo\x1b[0m');
    const res2 = await fetch(`${API_BASE_URL}/receipts/${receipt1.id}/close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        usuario: 'Supervisor Auditor Andén',
        discrepancias: [
          {
            lineId: receipt1.lineas[0].id,
            clasificacion: 'FALTANTE_PROVEEDOR',
            justificacion: '   ', // Espacios en blanco vacíos
          },
        ],
      }),
    });
    const body2 = await res2.json();
    assert(
      res2.status === 400 && body2?.detalles?.codigo === 'CIERRE_BLOQUEADO_POR_DISCREPANCIA',
      'Test 2: Rechaza cierre cuando la justificación está vacía o con puros espacios',
      `HTTP Status: ${res2.status}, Código: ${body2?.detalles?.codigo}`
    );

    // ------------------------------------------------------------------------
    // TEST 3: Intentar cerrar enviando justificación pero sin clasificación de estatus
    // ------------------------------------------------------------------------
    console.log('\n\x1b[36m▶ TEST 3: Rechazo cuando falta la clasificación de estatus de la no conformidad\x1b[0m');
    const res3 = await fetch(`${API_BASE_URL}/receipts/${receipt1.id}/close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        usuario: 'Supervisor Auditor Andén',
        discrepancias: [
          {
            lineId: receipt1.lineas[0].id,
            clasificacion: '',
            justificacion: 'Llegaron 20 piezas menos en la caja',
          },
        ],
      }),
    });
    const body3 = await res3.json();
    assert(
      res3.status === 400 && body3?.detalles?.codigo === 'CIERRE_BLOQUEADO_POR_DISCREPANCIA',
      'Test 3: Rechaza cierre cuando la clasificación de estatus no está asignada',
      `HTTP Status: ${res3.status}, Código: ${body3?.detalles?.codigo}`
    );

    // ------------------------------------------------------------------------
    // TEST 4: Bloqueo de cierre ante piezas dañadas/merma sin clasificación
    // ------------------------------------------------------------------------
    console.log('\n\x1b[36m▶ TEST 4: Bloqueo de Cierre ante Merma / Daño sin Justificar (Total Cuadrado pero con Daño)\x1b[0m');
    const receipt2 = await prisma.receipt.create({
      data: {
        codigo: `REC-T5-MERMA-${Date.now()}`,
        clienteId: testClient.id,
        facturaRespaldo: 'FAC-T5-002',
        ocReferencia: 'OC-T5-002',
        estado: 'EN_PROCESO_CONTEO',
        lineas: {
          create: [
            {
              skuId: testSkuB.id,
              cantidadEsperada: 50,
              cantidadRecibida: 45,
              cantidadDanada: 5, // 5 piezas dañadas a cuarentena
              estado: 'PARCIAL',
            },
          ],
        },
      },
      include: { lineas: true },
    });
    createdReceiptIds.push(receipt2.id);

    const res4 = await fetch(`${API_BASE_URL}/receipts/${receipt2.id}/close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        usuario: 'Supervisor Auditor Andén',
      }),
    });
    const body4 = await res4.json();
    assert(
      res4.status === 400 && body4?.detalles?.codigo === 'CIERRE_BLOQUEADO_POR_DISCREPANCIA',
      'Test 4: Bloquea cierre ante merma/daño no clasificado (5 pzas dañadas)',
      `HTTP Status: ${res4.status}, Código: ${body4?.detalles?.codigo}`
    );

    // ------------------------------------------------------------------------
    // TEST 5: Candado Anti-Bypass — Rechazo de Cierre vía PATCH /receipts/:id/status
    // ------------------------------------------------------------------------
    console.log('\n\x1b[36m▶ TEST 5: Candado Anti-Bypass en PATCH /receipts/:id/status { estado: "CERRADA" }\x1b[0m');
    const res5 = await fetch(`${API_BASE_URL}/receipts/${receipt1.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        estado: 'CERRADA',
        usuario: 'Hacker/Operador sin Justificar',
      }),
    });
    const body5 = await res5.json();
    assert(
      res5.status === 400 && body5?.detalles?.codigo === 'CIERRE_BLOQUEADO_POR_DISCREPANCIA',
      'Test 5: El candado bloquea intentos de cerrar vía status si hay discrepancias pendientes',
      `HTTP Status: ${res5.status}, Código: ${body5?.detalles?.codigo}`
    );

    // ------------------------------------------------------------------------
    // TEST 6: Recepción 100% Cuadrada y Conforme (Sin Discrepancias) Fluye Directo
    // ------------------------------------------------------------------------
    console.log('\n\x1b[36m▶ TEST 6: Cierre Exitoso Inmediato de Recepción 100% Cuadrada\x1b[0m');
    const receiptClean = await prisma.receipt.create({
      data: {
        codigo: `REC-T5-CLEAN-${Date.now()}`,
        clienteId: testClient.id,
        facturaRespaldo: 'FAC-T5-CLEAN-001',
        estado: 'EN_PROCESO_CONTEO',
        lineas: {
          create: [
            {
              skuId: testSkuA.id,
              cantidadEsperada: 60,
              cantidadRecibida: 60,
              cantidadDanada: 0,
              estado: 'COMPLETO',
            },
          ],
        },
      },
      include: { lineas: true },
    });
    createdReceiptIds.push(receiptClean.id);

    const res6 = await fetch(`${API_BASE_URL}/receipts/${receiptClean.id}/close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        usuario: 'Supervisor Auditor Calificado',
        notasCierre: 'Recepción 100% cuadrada sin discrepancias físicas',
      }),
    });
    const body6 = await res6.json();
    assert(
      [200, 201].includes(res6.status) && body6?.success === true && body6?.receipt?.estado === 'CERRADA',
      'Test 6: Recepción 100% cuadrada cierra exitosamente con HTTP 200/201 OK',
      `HTTP Status: ${res6.status}, Estado: ${body6?.receipt?.estado}, Bloqueado: ${body6?.receipt?.bloqueado}`
    );

    // ------------------------------------------------------------------------
    // TEST 7: Desbloqueo y Cierre Exitoso con Discrepancia Justificada y Clasificada
    // ------------------------------------------------------------------------
    console.log('\n\x1b[36m▶ TEST 7: Desbloqueo y Cierre Exitoso con Discrepancias Justificadas por Línea\x1b[0m');
    const res7 = await fetch(`${API_BASE_URL}/receipts/${receipt1.id}/close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        usuario: 'Supervisor Auditor Calificado',
        notasCierre: 'Cierre con faltante justificado por proveedor',
        discrepancias: [
          {
            lineId: receipt1.lineas[0].id,
            clasificacion: 'FALTANTE_PROVEEDOR',
            justificacion: 'Faltante de origen confirmado por transportista; factura incompleta de origen.',
          },
        ],
      }),
    });
    const body7 = await res7.json();
    assert(
      [200, 201].includes(res7.status) && body7?.success === true && body7?.discrepanciasResueltas === 1,
      'Test 7: Cierre autorizado exitosamente al proveer clasificación y justificación formal',
      `HTTP Status: ${res7.status}, Discrepancias Resueltas: ${body7?.discrepanciasResueltas}, Estatus: ${body7?.receipt?.estado}`
    );

    // Verificar en BD que la partida quedó con estado DISCREPANCIA y notas con la resolución
    const updatedLine1 = await prisma.receiptLine.findUnique({ where: { id: receipt1.lineas[0].id } });
    assert(
      updatedLine1?.estado === 'DISCREPANCIA' && updatedLine1?.notas?.includes('[DISCREPANCIA_RESUELTA]'),
      'Test 7 (BD): Partida actualizada a estado DISCREPANCIA con sello de resolución en notas',
      `Notas en BD: ${updatedLine1?.notas}`
    );

    // ------------------------------------------------------------------------
    // TEST 8: Cierre Exitoso usando Clasificación y Justificación Global
    // ------------------------------------------------------------------------
    console.log('\n\x1b[36m▶ TEST 8: Cierre Exitoso con Clasificación y Justificación Global\x1b[0m');
    const res8 = await fetch(`${API_BASE_URL}/receipts/${receipt2.id}/close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        usuario: 'Supervisor Auditor Calificado',
        clasificacionGlobal: 'DANO_TRANSPORTE',
        justificacionGlobal: '5 piezas dañadas por aplastamiento de tarima en maniobra de transporte',
      }),
    });
    const body8 = await res8.json();
    assert(
      [200, 201].includes(res8.status) && body8?.success === true && body8?.discrepanciasResueltas === 1,
      'Test 8: Cierre autorizado exitosamente utilizando resolución global homologada',
      `HTTP Status: ${res8.status}, Discrepancias Resueltas: ${body8?.discrepanciasResueltas}, Mensaje: ${body8?.message}`
    );

    // ------------------------------------------------------------------------
    // TEST 9: Inmutabilidad — Rechazo de Cierre sobre Recepción ya CERRADA
    // ------------------------------------------------------------------------
    console.log('\n\x1b[36m▶ TEST 9: Candado Inmutable — Rechazo de Cierre sobre Recepción ya CERRADA\x1b[0m');
    const res9 = await fetch(`${API_BASE_URL}/receipts/${receiptClean.id}/close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        usuario: 'Otro Supervisor',
      }),
    });
    const body9 = await res9.json();
    assert(
      res9.status === 403 && body9?.detalles?.codigo === 'RECEPCION_YA_CERRADA',
      'Test 9: Rechaza con 403 Forbidden cualquier intento de re-cerrar una recepción ya CERRADA',
      `HTTP Status: ${res9.status}, Código: ${body9?.detalles?.codigo}`
    );

    // ------------------------------------------------------------------------
    // TEST 10: Auditoría Legal en AuditLog
    // ------------------------------------------------------------------------
    console.log('\n\x1b[36m▶ TEST 10: Asiento Legal en AuditLog con Justificaciones Registradas\x1b[0m');
    const auditEntries = await prisma.auditLog.findMany({
      where: {
        entidadId: { in: [receipt1.id, receipt2.id, receiptClean.id] },
        accion: 'CERRAR_RECEPCION',
      },
    });
    assert(
      auditEntries.length >= 3,
      'Test 10: Las 3 recepciones cerradas tienen su asiento legal en AuditLog con detalle de resolución',
      `Registros en AuditLog encontrados: ${auditEntries.length}`
    );

  } catch (err) {
    console.error('\x1b[31mError fatal en la ejecución de la suite:\x1b[0m', err);
    failedTests++;
  } finally {
    // Limpieza de datos de prueba
    try {
      if (createdReceiptIds.length > 0) {
        await prisma.inventoryMovement.deleteMany({ where: { receipt: { id: { in: createdReceiptIds } } } }).catch(() => {});
        await prisma.receiptLine.deleteMany({ where: { recepcionId: { in: createdReceiptIds } } }).catch(() => {});
        await prisma.auditLog.deleteMany({ where: { entidadId: { in: createdReceiptIds } } }).catch(() => {});
        await prisma.receipt.deleteMany({ where: { id: { in: createdReceiptIds } } }).catch(() => {});
      }
      if (createdSkuIds.length > 0) {
        await prisma.skuMaster.deleteMany({ where: { id: { in: createdSkuIds } } }).catch(() => {});
      }
      if (createdClientIds.length > 0) {
        await prisma.client.deleteMany({ where: { id: { in: createdClientIds } } }).catch(() => {});
      }
      await prisma.$disconnect();
      await pool.end();
    } catch (cleanErr) {
      console.error('Error durante la limpieza de BD:', cleanErr.message);
    }
  }

  // --- REPORTE FINAL ---
  console.log('\n============================================================================');
  console.log(`  RESUMEN FINAL SPRINT #3 TAREA 5: ${passedTests} APROBADAS / ${failedTests} FALLIDAS`);
  if (failedTests === 0) {
    console.log('  \x1b[32m✔ 100% PASS — CANDADO DE CIERRE AUDITADO Y CERTIFICADO EXITOSAMENTE\x1b[0m');
  } else {
    console.log('  \x1b[31m✖ ERROR — ALGUNAS PRUEBAS FALLARON\x1b[0m');
  }
  console.log('============================================================================\n');
  process.exit(failedTests === 0 ? 0 : 1);
}

runTestSuite();
