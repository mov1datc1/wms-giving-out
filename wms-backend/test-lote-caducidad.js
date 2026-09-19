// ============================================================================
// GIVING OUT WMS 360+ — SUITE OFICIAL DE VALIDACIÓN DE LOTE Y CADUCIDAD
// SPRINT #3 — Tarea 4: "Implementar captura obligatoria de lote y fecha de caducidad si el giro del cliente lo exige"
//
// Normativa y Estándares: COFEPRIS / FDA / NOM-251-SSA1-2009 / WMS Industrial
// Ejecución: node test-lote-caducidad.js
// ============================================================================

require('dotenv').config();
const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient } = require('@prisma/client');

const API_BASE_URL = process.env.API_URL || 'http://localhost:3001/api';

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
  console.log('  GIVING OUT WMS 360+ — SPRINT #3 TAREA 4: TEST SUITE LOTE Y CADUCIDAD');
  console.log('  Normativas: NOM-251 / COFEPRIS / FDA / Trazabilidad por Giro de Negocio');
  console.log('============================================================================\n');

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  // Variables para limpieza garantizada
  const createdReceiptIds = [];
  const createdClientIds = [];
  const createdSkuIds = [];

  try {
    // 0. Preparar datos base
    const warehouse = await prisma.warehouse.findFirst();
    const locRec = await prisma.location.findFirst({
      where: { OR: [{ codigo: 'REC-01' }, { tipoUbicacion: 'RECIBO' }] }
    });
    const locDev = await prisma.location.findFirst({
      where: { OR: [{ codigo: 'DEV-01' }, { codigo: 'MERMA-01' }, { tipoUbicacion: 'DEVOLUCION' }] }
    });

    if (!locRec) throw new Error('No se encontró ubicación de recibo en BD');

    const timestamp = Date.now();

    // 1. Crear Cliente con Giro "COMIDA" (Alimentos perecederos)
    const clientComida = await prisma.client.create({
      data: {
        codigo: `CLI-COM-${timestamp}`,
        razonSocial: `ALIMENTOS Y PERECEDEROS S.A. ${timestamp}`,
        nombreComercial: `NutriFood MX ${timestamp}`,
        rfc: `NUT${String(timestamp).slice(-9)}`,
        giro: 'COMIDA',
        requiereLote: false, // Probaremos que el GIRO 'COMIDA' lo hace OBLIGATORIO automáticamente
        requiereCaducidad: false,
      }
    });
    createdClientIds.push(clientComida.id);

    const skuComida = await prisma.skuMaster.create({
      data: {
        clienteId: clientComida.id,
        codigo: `ALM-LECHE-${timestamp}`,
        descripcion: 'Leche Entera Ultrapasteurizada 1L',
        categoria: 'Alimentos',
        requiereLote: false,
        requiereCaducidad: false,
      }
    });
    createdSkuIds.push(skuComida.id);

    // 2. Crear Cliente con Giro "FARMACEUTICO" (Medicamentos controlados)
    const clientFarma = await prisma.client.create({
      data: {
        codigo: `CLI-PHA-${timestamp}`,
        razonSocial: `LABORATORIOS FARMACEUTICOS S.A. ${timestamp}`,
        nombreComercial: `PharmaCare Labs ${timestamp}`,
        rfc: `PHA${String(timestamp).slice(-9)}`,
        giro: 'FARMACEUTICO',
        requiereLote: false,
        requiereCaducidad: false,
      }
    });
    createdClientIds.push(clientFarma.id);

    const skuFarma = await prisma.skuMaster.create({
      data: {
        clienteId: clientFarma.id,
        codigo: `MED-AMOX-${timestamp}`,
        descripcion: 'Amoxicilina 500mg Capsulas 12s',
        categoria: 'Medicamentos',
        requiereLote: false,
        requiereCaducidad: false,
      }
    });
    createdSkuIds.push(skuFarma.id);

    // 3. Crear Cliente con Giro "ROPA" (Textil no perecedero)
    const clientRopa = await prisma.client.create({
      data: {
        codigo: `CLI-ROP-${timestamp}`,
        razonSocial: `FASHION TEXTIL S.A. ${timestamp}`,
        nombreComercial: `Fashion Trend ${timestamp}`,
        rfc: `FAS${String(timestamp).slice(-9)}`,
        giro: 'ROPA',
        requiereLote: false,
        requiereCaducidad: false,
      }
    });
    createdClientIds.push(clientRopa.id);

    const skuRopa = await prisma.skuMaster.create({
      data: {
        clienteId: clientRopa.id,
        codigo: `ROP-PANT-${timestamp}`,
        descripcion: 'Pantalón Denim Jeans Azul 32',
        categoria: 'Textil',
        requiereLote: false,
        requiereCaducidad: false,
      }
    });
    createdSkuIds.push(skuRopa.id);

    // Fechas de prueba
    const pastDate = '2020-01-15'; // Caducado hace años
    const futureDate = '2028-12-31'; // Futuro seguro

    console.log('--- FASE 1: VALIDACIONES EN BATCH RECEPTION (PLANILLA MATRICIAL) ---\n');

    // Previo A: Giro COMIDA
    const receiptComida = await prisma.receipt.create({
      data: {
        codigo: `REC-COM-${timestamp}`,
        clienteId: clientComida.id,
        facturaRespaldo: `FAC-COM-${timestamp}`,
        tipoRecepcion: 'RECEPCION',
        origen: 'NACIONAL',
        lineas: {
          create: [{ skuId: skuComida.id, cantidadEsperada: 100, notas: 'Partida Perecedera' }]
        }
      },
      include: { lineas: true }
    });
    createdReceiptIds.push(receiptComida.id);
    const lineComida = receiptComida.lineas[0];

    // TEST 1: Giro COMIDA sin Lote -> 400 Bad Request
    {
      const res = await fetch(`${API_BASE_URL}/receipts/${receiptComida.id}/batch-reception`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          usuario: 'Auditor Calidad',
          almacenId: warehouse?.id,
          ubicacionConformeId: locRec.id,
          lineas: [{
            receiptLineId: lineComida.id,
            cantidadConforme: 50,
            cantidadNoConforme: 0,
            lote: '', // OMISIÓN DE LOTE
            fechaVencimiento: futureDate,
          }]
        })
      });
      const data = await res.json();
      assert(
        res.status === 400 && (data.message?.includes('LOTE') || data.detalles?.codigo === 'LOTE_OBLIGATORIO_POR_GIRO'),
        'Test 1: Rechazo de recepción si el giro es COMIDA y falta el LOTE',
        `Status: ${res.status}, Mensaje: "${data.message}"`
      );
    }

    // TEST 2: Giro COMIDA con Lote compuesto sólo por espacios -> 400 Bad Request
    {
      const res = await fetch(`${API_BASE_URL}/receipts/${receiptComida.id}/batch-reception`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          usuario: 'Auditor Calidad',
          almacenId: warehouse?.id,
          ubicacionConformeId: locRec.id,
          lineas: [{
            receiptLineId: lineComida.id,
            cantidadConforme: 50,
            cantidadNoConforme: 0,
            lote: '     ', // LOTE EN BLANCO
            fechaVencimiento: futureDate,
          }]
        })
      });
      const data = await res.json();
      assert(
        res.status === 400 && data.message?.includes('LOTE'),
        'Test 2: Rechazo de lote compuesto únicamente de espacios en blanco',
        `Status: ${res.status}, Mensaje: "${data.message}"`
      );
    }

    // TEST 3: Giro COMIDA sin Fecha de Caducidad -> 400 Bad Request
    {
      const res = await fetch(`${API_BASE_URL}/receipts/${receiptComida.id}/batch-reception`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          usuario: 'Auditor Calidad',
          almacenId: warehouse?.id,
          ubicacionConformeId: locRec.id,
          lineas: [{
            receiptLineId: lineComida.id,
            cantidadConforme: 50,
            cantidadNoConforme: 0,
            lote: 'LOT-ALM-2026-X',
            fechaVencimiento: '', // OMISIÓN DE CADUCIDAD
          }]
        })
      });
      const data = await res.json();
      assert(
        res.status === 400 && (data.message?.includes('CADUCIDAD') || data.detalles?.codigo === 'CADUCIDAD_OBLIGATORIA_POR_GIRO'),
        'Test 3: Rechazo de recepción si el giro es COMIDA y falta la FECHA DE CADUCIDAD',
        `Status: ${res.status}, Mensaje: "${data.message}"`
      );
    }

    // TEST 4: Giro COMIDA con Fecha Inválida -> 400 Bad Request
    {
      const res = await fetch(`${API_BASE_URL}/receipts/${receiptComida.id}/batch-reception`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          usuario: 'Auditor Calidad',
          almacenId: warehouse?.id,
          ubicacionConformeId: locRec.id,
          lineas: [{
            receiptLineId: lineComida.id,
            cantidadConforme: 50,
            cantidadNoConforme: 0,
            lote: 'LOT-ALM-2026-X',
            fechaVencimiento: 'fecha-no-valida-9999', // FECHA INVÁLIDA
          }]
        })
      });
      const data = await res.json();
      assert(
        res.status === 400 && data.detalles?.codigo === 'FECHA_CADUCIDAD_INVALIDA',
        'Test 4: Rechazo si el formato de la fecha de caducidad es inválido',
        `Status: ${res.status}, Mensaje: "${data.message}"`
      );
    }

    // TEST 5: Giro COMIDA con Fecha de Caducidad Vencida (Ayer / Pasada) -> Rechazo Sanitario Inocuidad 400
    {
      const res = await fetch(`${API_BASE_URL}/receipts/${receiptComida.id}/batch-reception`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          usuario: 'Auditor Calidad',
          almacenId: warehouse?.id,
          ubicacionConformeId: locRec.id,
          lineas: [{
            receiptLineId: lineComida.id,
            cantidadConforme: 50,
            cantidadNoConforme: 0,
            lote: 'LOT-ALM-2026-X',
            fechaVencimiento: pastDate, // PRODUCTO YA VENCIDO
          }]
        })
      });
      const data = await res.json();
      assert(
        res.status === 400 && data.detalles?.codigo === 'PRODUCTO_CADUCADO_RECHAZADO',
        'Test 5: Rechazo Sanitario Inocuidad (NOM-251 / COFEPRIS) si el producto ya está caducado',
        `Status: ${res.status}, Mensaje: "${data.message}"`
      );
    }

    // TEST 6: Giro COMIDA con Lote y Fecha Futura Válidos -> 200 OK y Persistencia en DB
    {
      const validLote = `LOT-MILK-${timestamp}`;
      const res = await fetch(`${API_BASE_URL}/receipts/${receiptComida.id}/batch-reception`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          usuario: 'Auditor Calidad',
          almacenId: warehouse?.id,
          ubicacionConformeId: locRec.id,
          lineas: [{
            receiptLineId: lineComida.id,
            cantidadConforme: 80,
            cantidadNoConforme: 0,
            lote: validLote,
            fechaVencimiento: futureDate,
          }]
        })
      });
      const data = await res.json();
      
      // Verificar en BD la persistencia de LotInventory y ReceiptLine
      const createdLot = await prisma.lotInventory.findFirst({
        where: { skuId: skuComida.id, lote: validLote }
      });
      const verifiedLine = await prisma.receiptLine.findUnique({
        where: { id: lineComida.id }
      });

      assert(
        res.status === 200 && data.success === true && createdLot && createdLot.cantidadDisponible === 80 && verifiedLine.loteAsignado === validLote && verifiedLine.fechaVencimiento !== null,
        'Test 6: Aceptación exitosa de Giro COMIDA con Lote y Caducidad válidos y persistencia en DB (LotInventory + ReceiptLine)',
        `Status: ${res.status}, Lot en BD ID: ${createdLot?.id}, Lote: ${createdLot?.lote}, Line fechaVencimiento: ${verifiedLine?.fechaVencimiento?.toISOString().slice(0, 10)}`
      );
    }

    console.log('\n--- FASE 2: VALIDACIONES EN GIRO FARMACEUTICO Y ROPA (NO REGULADO) ---\n');

    // Previo B: Giro FARMACEUTICO
    const receiptFarma = await prisma.receipt.create({
      data: {
        codigo: `REC-PHA-${timestamp}`,
        clienteId: clientFarma.id,
        facturaRespaldo: `FAC-PHA-${timestamp}`,
        tipoRecepcion: 'RECEPCION',
        origen: 'NACIONAL',
        lineas: {
          create: [{ skuId: skuFarma.id, cantidadEsperada: 200, notas: 'Fármacos controlados' }]
        }
      },
      include: { lineas: true }
    });
    createdReceiptIds.push(receiptFarma.id);
    const lineFarma = receiptFarma.lineas[0];

    // TEST 7: Giro FARMACÉUTICO con producto caducado -> Rechazo Sanitario 400
    {
      const res = await fetch(`${API_BASE_URL}/receipts/${receiptFarma.id}/batch-reception`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          usuario: 'Farmacéutico Responsable',
          almacenId: warehouse?.id,
          ubicacionConformeId: locRec.id,
          lineas: [{
            receiptLineId: lineFarma.id,
            cantidadConforme: 100,
            cantidadNoConforme: 0,
            lote: `LOT-FAR-${timestamp}`,
            fechaVencimiento: pastDate, // Caducado
          }]
        })
      });
      const data = await res.json();
      assert(
        res.status === 400 && data.detalles?.codigo === 'PRODUCTO_CADUCADO_RECHAZADO',
        'Test 7: Rechazo Sanitario en Giro FARMACÉUTICO ante medicamento con caducidad vencida',
        `Status: ${res.status}, Código: ${data.detalles?.codigo}`
      );
    }

    // TEST 8: Giro FARMACÉUTICO con Lote y Caducidad vigentes -> Aceptación 200 OK
    {
      const validFarmaLot = `LOT-AMOX-${timestamp}`;
      const res = await fetch(`${API_BASE_URL}/receipts/${receiptFarma.id}/batch-reception`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          usuario: 'Farmacéutico Responsable',
          almacenId: warehouse?.id,
          ubicacionConformeId: locRec.id,
          lineas: [{
            receiptLineId: lineFarma.id,
            cantidadConforme: 150,
            cantidadNoConforme: 10,
            ubicacionNoConformeId: locDev?.id || locRec.id,
            lote: validFarmaLot,
            fechaVencimiento: futureDate,
          }]
        })
      });
      const data = await res.json();
      assert(
        res.status === 200 && data.success === true,
        'Test 8: Aceptación exitosa de Giro FARMACÉUTICO con Lote y Caducidad vigentes',
        `Status: ${res.status}, Mensaje: "${data.message}"`
      );
    }

    // Previo C: Giro ROPA (Textil no perecedero)
    const receiptRopa = await prisma.receipt.create({
      data: {
        codigo: `REC-ROP-${timestamp}`,
        clienteId: clientRopa.id,
        facturaRespaldo: `FAC-ROP-${timestamp}`,
        tipoRecepcion: 'RECEPCION',
        origen: 'NACIONAL',
        lineas: {
          create: [{ skuId: skuRopa.id, cantidadEsperada: 50, notas: 'Prendas de vestir' }]
        }
      },
      include: { lineas: true }
    });
    createdReceiptIds.push(receiptRopa.id);
    const lineRopa = receiptRopa.lineas[0];

    // TEST 9: Giro ROPA sin Lote y sin Caducidad -> Aceptado (No bloquea giros no regulados)
    {
      const res = await fetch(`${API_BASE_URL}/receipts/${receiptRopa.id}/batch-reception`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          usuario: 'Operador Textil',
          almacenId: warehouse?.id,
          ubicacionConformeId: locRec.id,
          lineas: [{
            receiptLineId: lineRopa.id,
            cantidadConforme: 50,
            cantidadNoConforme: 0,
            lote: '', // Omitido legítimamente
            fechaVencimiento: '', // Omitido legítimamente
          }]
        })
      });
      const data = await res.json();
      assert(
        res.status === 200 && data.success === true,
        'Test 9: Giro ROPA (no perecedero) fluye sin obligar lote ni caducidad (Sin falsos positivos)',
        `Status: ${res.status}, Mensaje: "${data.message}"`
      );
    }

    console.log('\n--- FASE 3: VALIDACIÓN EN ENDPOINT UNITARIO / HANDHELD (POST /api/reception) ---\n');

    // TEST 10: Endpoint Unitario con Giro COMIDA y fecha caducada -> Rechazo Sanitario 400
    {
      const res = await fetch(`${API_BASE_URL}/reception`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          skuId: skuComida.id,
          clienteId: clientComida.id,
          almacenId: warehouse?.id,
          cantidadConforme: 10,
          cantidadNoConforme: 0,
          ubicacionConformeId: locRec.id,
          tipoHu: 'CAJA',
          usuario: 'Operador Handheld Zebra',
          lote: `LOT-UNIT-${timestamp}`,
          fechaVencimiento: pastDate, // Caducado
        })
      });
      const data = await res.json();
      assert(
        res.status === 400 && data.detalles?.codigo === 'PRODUCTO_CADUCADO_RECHAZADO',
        'Test 10: Endpoint Unitario Handheld rechaza producto caducado con código PRODUCTO_CADUCADO_RECHAZADO',
        `Status: ${res.status}, Mensaje: "${data.message}"`
      );
    }

  } catch (error) {
    console.error('\n\x1b[31mError fatal durante la ejecución de las pruebas:\x1b[0m', error);
  } finally {
    // Limpieza integral de registros creados durante el test
    console.log('\n--- LIMPIEZA DE DATOS TEMPORALES DE PRUEBA ---');
    try {
      if (createdReceiptIds.length > 0) {
        // Eliminar HUs y Lots creados
        const lots = await prisma.lotInventory.findMany({
          where: { skuId: { in: createdSkuIds } }
        });
        const lotIds = lots.map(l => l.id);

        await prisma.inventoryMovement.deleteMany({ where: { lotId: { in: lotIds } } });
        await prisma.handlingUnit.deleteMany({ where: { lotId: { in: lotIds } } });
        await prisma.lotInventory.deleteMany({ where: { id: { in: lotIds } } });
        await prisma.receiptLine.deleteMany({ where: { recepcionId: { in: createdReceiptIds } } });
        await prisma.receipt.deleteMany({ where: { id: { in: createdReceiptIds } } });
        console.log(`  ✔ Eliminados ${createdReceiptIds.length} recibos de prueba y sus movimientos.`);
      }

      if (createdSkuIds.length > 0) {
        await prisma.skuMaster.deleteMany({ where: { id: { in: createdSkuIds } } });
        console.log(`  ✔ Eliminados ${createdSkuIds.length} SKUs temporales.`);
      }

      if (createdClientIds.length > 0) {
        await prisma.client.deleteMany({ where: { id: { in: createdClientIds } } });
        console.log(`  ✔ Eliminados ${createdClientIds.length} Clientes temporales.`);
      }
    } catch (cleanErr) {
      console.warn('  ⚠️ Advertencia en limpieza:', cleanErr.message);
    }

    await prisma.$disconnect();
    await pool.end();

    console.log('\n============================================================================');
    console.log(`  RESUMEN FINAL DE PRUEBAS: ${passedTests}/${passedTests + failedTests} APROBADAS`);
    if (failedTests === 0) {
      console.log('  \x1b[32m✔ TODAS LAS PRUEBAS DE LOTE Y CADUCIDAD PASARON CON 100% DE ÉXITO\x1b[0m');
    } else {
      console.log(`  \x1b[31m✖ SE DETECTARON ${failedTests} FALLOS EN LA SUITE\x1b[0m`);
    }
    console.log('============================================================================\n');
  }
}

runTestSuite();
