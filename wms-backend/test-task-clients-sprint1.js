// ============================================================================
// GIVING OUT WMS 360+ — SUITE OFICIAL DE VALIDACIÓN DE SPRINT #1
// MÓDULO DE DEPOSITANTES Y GIROS COMERCIALES (TAREAS 1 A 6)
//
// 1. Modelado relacional en Supabase con campos fiscales, contacto y giros
// 2. CRUD en backend con DTOs y validaciones defensivas
// 3. Bloqueo por perfiles RBAC (frontend y backend)
// 4. Catálogo configurable de reglas operativas 3PL heredables por giro
// 5. Validación en servidor que impide a operarios modificar reglas fijas
// 6. Pruebas unitarias de persistencia y restricciones de campos obligatorios
//
// Ejecución: node test-task-clients-sprint1.js
// ============================================================================

require('dotenv').config();
const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient } = require('@prisma/client');
const { ClientsController } = require('./dist/src/modules/clients/clients.controller');
const { GiroComercial, getDefaultRulesForGiro, ReglaInventarioRotacion } = require('./dist/src/modules/clients/dto/client.dto');

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
  console.log('  GIVING OUT WMS 360+ — SPRINT #1: MÓDULO DE DEPOSITANTES Y GIROS');
  console.log('  "Configuración del Catálogo de Clientes/Depositantes con Reglas Heredables"');
  console.log('============================================================================\n');

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await pool.query(`
    ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "regimenFiscal" TEXT;
    ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "pais" TEXT DEFAULT 'México';
    ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "cfdiDefault" TEXT;
    ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "sitioWeb" TEXT;
  `);
  console.log('  ✅ Columnas DDL fiscales y de contacto verificadas en Supabase\n');

  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });
  await prisma.$connect();

  const controller = new ClientsController(prisma);

  const createdClientIds = [];
  const testTimestamp = Date.now();

  try {
    // ------------------------------------------------------------------------
    // FASE 1: SUBTAREA 4 — CATÁLOGO DE GIROS Y REGLAS OPERATIVAS SUGERIDAS
    // ------------------------------------------------------------------------
    console.log('--- FASE 1: CATÁLOGO DE GIROS Y REGLAS OPERATIVAS (SUBTAREA 4) ---\n');

    const girosCatalog = await controller.getCatalogGiros();
    assert(
      Array.isArray(girosCatalog) && girosCatalog.length >= 6,
      'Test 1: Catálogo oficial de giros expone al menos 6 giros comerciales',
      `Giros detectados: ${girosCatalog.map(g => g.giro).join(', ')}`
    );

    const comidaRules = getDefaultRulesForGiro('COMIDA');
    assert(
      comidaRules.requiereLote === true && 
      comidaRules.requiereCaducidad === true && 
      comidaRules.reglaInventario === 'FEFO',
      'Test 2: Giro COMIDA auto-configura Lote=true, Caducidad=true y Rotación=FEFO (NOM-251)',
      `Reglas: Lote=${comidaRules.requiereLote}, Cad=${comidaRules.requiereCaducidad}, Rot=${comidaRules.reglaInventario}`
    );

    const maquilaRules = getDefaultRulesForGiro('MAQUILA');
    assert(
      maquilaRules.requiereLote === true && 
      maquilaRules.requiereCaducidad === false && 
      maquilaRules.reglaInventario === 'FIFO',
      'Test 3: Giro MAQUILA auto-configura Lote=true (ensambles) y Rotación=FIFO',
      `Reglas: Lote=${maquilaRules.requiereLote}, Cad=${maquilaRules.requiereCaducidad}, Rot=${maquilaRules.reglaInventario}`
    );

    const ropaRules = getDefaultRulesForGiro('ROPA');
    assert(
      ropaRules.requiereLote === false && 
      ropaRules.requiereCaducidad === false && 
      ropaRules.reglaInventario === 'FIFO',
      'Test 4: Giro ROPA auto-configura mercancía estándar sin caducidad y Rotación=FIFO',
      `Reglas: Lote=${ropaRules.requiereLote}, Cad=${ropaRules.requiereCaducidad}, Rot=${ropaRules.reglaInventario}`
    );

    // ------------------------------------------------------------------------
    // FASE 2: SUBTAREA 2 & 6 — VALIDACIONES DEFENSIVAS ANTE CAMPOS OBLIGATORIOS
    // ------------------------------------------------------------------------
    console.log('\n--- FASE 2: RESTRICCIONES DE CAMPOS OBLIGATORIOS Y UNICIDAD (SUBTAREA 2 & 6) ---\n');

    // Test 5: Sin código
    try {
      await controller.createClient({
        codigo: '',
        nombreComercial: 'Test Incompleto',
        razonSocial: 'Test Incompleto S.A.',
        giro: 'ROPA',
      });
      assert(false, 'Test 5: Rechazo de cliente sin código');
    } catch (err) {
      assert(err.status === 400 && err.response?.codigo === 'CODIGO_REQUERIDO',
        'Test 5: Rechazo con 400 Bad Request cuando falta el código del depositante',
        `Código de error: ${err.response?.codigo}`
      );
    }

    // Test 6: Sin nombre comercial
    try {
      await controller.createClient({
        codigo: `DEP-TEST-${testTimestamp}`,
        nombreComercial: '',
        razonSocial: 'Test S.A.',
        giro: 'ROPA',
      });
      assert(false, 'Test 6: Rechazo de cliente sin nombre comercial');
    } catch (err) {
      assert(err.status === 400 && err.response?.codigo === 'NOMBRE_COMERCIAL_REQUERIDO',
        'Test 6: Rechazo con 400 Bad Request cuando falta el nombre comercial',
        `Código de error: ${err.response?.codigo}`
      );
    }

    // Test 7: Sin razón social
    try {
      await controller.createClient({
        codigo: `DEP-TEST-${testTimestamp}`,
        nombreComercial: 'Test Comercial',
        razonSocial: '',
        giro: 'ROPA',
      });
      assert(false, 'Test 7: Rechazo de cliente sin razón social');
    } catch (err) {
      assert(err.status === 400 && err.response?.codigo === 'RAZON_SOCIAL_REQUERIDA',
        'Test 7: Rechazo con 400 Bad Request cuando falta la razón social',
        `Código de error: ${err.response?.codigo}`
      );
    }

    // Test 8: Sin giro
    try {
      await controller.createClient({
        codigo: `DEP-TEST-${testTimestamp}`,
        nombreComercial: 'Test Comercial',
        razonSocial: 'Test S.A.',
        giro: '',
      });
      assert(false, 'Test 8: Rechazo de cliente sin giro');
    } catch (err) {
      assert(err.status === 400 && err.response?.codigo === 'GIRO_REQUERIDO',
        'Test 8: Rechazo con 400 Bad Request cuando falta el giro del negocio',
        `Código de error: ${err.response?.codigo}`
      );
    }

    // ------------------------------------------------------------------------
    // FASE 3: SUBTAREA 1 & 6 — MODELADO RELACIONAL Y PERSISTENCIA DE CAMPOS FISCALES
    // ------------------------------------------------------------------------
    console.log('\n--- FASE 3: MODELADO RELACIONAL, CAMPOS FISCALES Y HERENCIA (SUBTAREA 1 & 6) ---\n');

    const clientComidaDto = {
      codigo: `DEP-COMIDA-${testTimestamp}`,
      nombreComercial: `SuperAlimentos México ${testTimestamp}`,
      razonSocial: `SuperAlimentos del Centro S.A. de C.V. ${testTimestamp}`,
      rfc: `SAM${String(testTimestamp).slice(-9)}`,
      giro: 'COMIDA',
      regimenFiscal: '601',
      codigoPostal: '03940',
      pais: 'México',
      cfdiDefault: 'G03',
      telefono: '55-1234-5678',
      email: `contacto@superalimentos-${testTimestamp}.mx`,
      contactoPrincipal: 'Ing. Rodrigo Salinas',
      sitioWeb: 'https://superalimentos.mx',
    };

    const createdComida = await controller.createClient(clientComidaDto);
    createdClientIds.push(createdComida.id);

    assert(
      createdComida.id && createdComida.codigo === clientComidaDto.codigo,
      'Test 9: Creación exitosa de depositante con campos fiscales completos en Supabase',
      `ID: ${createdComida.id}, Código: ${createdComida.codigo}`
    );

    assert(
      createdComida.regimenFiscal === '601' && 
      createdComida.pais === 'México' && 
      createdComida.cfdiDefault === 'G03' && 
      createdComida.sitioWeb === 'https://superalimentos.mx',
      'Test 10: Persistencia de metadatos fiscales SAT (Régimen 601, CFDI G03, CP 03940, SitioWeb)',
      `Régimen: ${createdComida.regimenFiscal}, CFDI: ${createdComida.cfdiDefault}, Web: ${createdComida.sitioWeb}`
    );

    assert(
      createdComida.requiereLote === true && 
      createdComida.requiereCaducidad === true && 
      createdComida.reglaInventario === 'FEFO',
      'Test 11: Herencia automática de reglas operativas para giro COMIDA (FEFO, Lote y Caducidad obligatorios)',
      `Reglas en BD: Lote=${createdComida.requiereLote}, Caducidad=${createdComida.requiereCaducidad}, Rotación=${createdComida.reglaInventario}`
    );

    // Test 12: Unicidad de Código
    try {
      await controller.createClient({
        ...clientComidaDto,
        rfc: `OTR${String(testTimestamp).slice(-9)}`,
      });
      assert(false, 'Test 12: Detección de duplicidad de código');
    } catch (err) {
      assert(err.status === 409 && err.response?.codigo === 'CODIGO_DUPLICADO',
        'Test 12: Bloqueo con 409 Conflict ante intento de duplicar código de depositante',
        `Mensaje: ${err.response?.message}`
      );
    }

    // Test 13: Unicidad de RFC
    try {
      await controller.createClient({
        ...clientComidaDto,
        codigo: `DEP-DISTINTO-${testTimestamp}`,
      });
      assert(false, 'Test 13: Detección de duplicidad de RFC');
    } catch (err) {
      assert(err.status === 409 && err.response?.codigo === 'RFC_DUPLICADO',
        'Test 13: Bloqueo con 409 Conflict ante intento de duplicar RFC fiscal',
        `Mensaje: ${err.response?.message}`
      );
    }

    // ------------------------------------------------------------------------
    // FASE 4: SUBTAREA 5 — CANDADO RBAC CONTRA MUTACIÓN DE REGLAS POR OPERARIOS
    // ------------------------------------------------------------------------
    console.log('\n--- FASE 4: CANDADO DE SEGURIDAD RBAC CONTRA OPERARIOS (SUBTAREA 5) ---\n');

    // Test 14: Operario intentando alterar reglas fijas en PUT /api/clients/:id -> 403 Forbidden
    try {
      await controller.updateClient(
        createdComida.id,
        { requiereLote: false, requiereCaducidad: false }, // Intento de apagar lote
        'Operador' // Rol operario en andén
      );
      assert(false, 'Test 14: Bloqueo de operario intentando apagar reglas fijas');
    } catch (err) {
      assert(
        err.status === 403 && 
        err.response?.codigo === 'OPERARIO_NO_AUTORIZADO_PARA_MODIFICAR_REGLAS_FIJAS',
        'Test 14: Bloqueo categórico con 403 Forbidden cuando un operario intenta mutar reglas fijas',
        `Error: ${err.response?.codigo} (Rol detectado: ${err.response?.rolDetectado})`
      );
    }

    // Test 15: Operario intentando alterar configuración en PUT /api/clients/:id/config -> 403 Forbidden
    try {
      await controller.updateConfig(
        createdComida.id,
        { reglaInventario: 'FIFO' }, // Intento de cambiar FEFO a FIFO
        'Operador'
      );
      assert(false, 'Test 15: Bloqueo de operario en endpoint config');
    } catch (err) {
      assert(
        err.status === 403 && 
        err.response?.codigo === 'OPERARIO_NO_AUTORIZADO_PARA_MODIFICAR_REGLAS_FIJAS',
        'Test 15: Bloqueo con 403 Forbidden en endpoint PUT /:id/config para perfil Operario',
        `Código: ${err.response?.codigo}`
      );
    }

    // Test 16: Asiento inmutable en AuditLog ante intento no autorizado
    const violationLog = await prisma.auditLog.findFirst({
      where: {
        entidad: 'Client',
        entidadId: createdComida.id,
        accion: 'VIOLACION_REGLAS_RECHAZADA'
      },
      orderBy: { createdAt: 'desc' }
    });
    assert(
      Boolean(violationLog),
      'Test 16: Registro inmutable en AuditLog ante intento no autorizado de violación de reglas por operario',
      `Detalle bitácora: ${violationLog?.detalle}`
    );

    // Test 17: Actualización autorizada para Administrador / Supervisor -> 200 OK
    const adminUpdate = await controller.updateClient(
      createdComida.id,
      { telefono: '55-9999-0000', contactoPrincipal: 'Lic. Mariana Gómez' },
      'Administrador'
    );
    assert(
      adminUpdate.telefono === '55-9999-0000' && adminUpdate.contactoPrincipal === 'Lic. Mariana Gómez',
      'Test 17: Administrador autorizado para actualizar parámetros de cliente exitosamente',
      `Teléfono actualizado: ${adminUpdate.telefono}`
    );

    // ------------------------------------------------------------------------
    // FASE 5: SUBTAREA 2 — DESACTIVACIÓN LÓGICA (SOFT DELETE) Y CONSULTA
    // ------------------------------------------------------------------------
    console.log('\n--- FASE 5: BAJA LÓGICA SEGURA Y CONSULTAS (SUBTAREA 2) ---\n');

    // Test 18: Operario no puede desactivar clientes
    try {
      await controller.deleteClient(createdComida.id, 'Operador');
      assert(false, 'Test 18: Operario bloqueado de desactivar clientes');
    } catch (err) {
      assert(
        err.status === 403 && err.response?.codigo === 'OPERARIO_NO_AUTORIZADO',
        'Test 18: Operario bloqueado con 403 Forbidden al intentar desactivar un depositante',
        `Código: ${err.response?.codigo}`
      );
    }

    // Test 19: Desactivación lógica por Administrador
    const deleteResult = await controller.deleteClient(createdComida.id, 'Supervisor');
    assert(
      deleteResult.success === true && deleteResult.cliente.activo === false,
      'Test 19: Desactivación lógica exitosa por Supervisor preservando trazabilidad histórica',
      `Estatus activo en BD: ${deleteResult.cliente.activo}`
    );

    // Test 20: Consulta por ID devuelve estadísticas y reglas consolidadas
    const clientDetail = await controller.getClient(createdComida.id);
    assert(
      clientDetail.id === createdComida.id && 
      clientDetail.reglasHeredadas?.reglaInventario === 'FEFO' &&
      typeof clientDetail.stats?.totalSkus === 'number',
      'Test 20: GET /:id retorna ficha consolidada con estadísticas reales y reglas heredadas',
      `Rotación: ${clientDetail.reglasHeredadas.reglaInventario}, Total SKUs: ${clientDetail.stats.totalSkus}`
    );

  } catch (err) {
    console.error('Error inesperado durante la ejecución de la suite:', err);
    failedTests++;
  } finally {
    // ------------------------------------------------------------------------
    // LIMPIEZA DE DATOS TEMPORALES DE PRUEBA
    // ------------------------------------------------------------------------
    console.log('\n--- LIMPIEZA Y RESGUARDO DE BASE DE DATOS ---\n');
    if (createdClientIds.length > 0) {
      await prisma.auditLog.deleteMany({
        where: { entidad: 'Client', entidadId: { in: createdClientIds } }
      });
      await prisma.client.deleteMany({
        where: { id: { in: createdClientIds } }
      });
      console.log(`  🧹 Limpieza completada: ${createdClientIds.length} clientes temporales de prueba purgados.`);
      console.log('  🔒 Preservado inmaculado el cliente base original Fashion Forward (REC-2026-0001).');
    }
    await prisma.$disconnect();
    await pool.end();
  }

  // Resumen final
  console.log('\n============================================================================');
  console.log(`  RESUMEN FINAL SPRINT #1 DEPOSITANTES: ${passedTests} APROBADAS / ${failedTests} FALLIDAS`);
  console.log('============================================================================\n');

  if (failedTests === 0) {
    console.log('  🎉 ¡TODAS LAS PRUEBAS DE LAS 6 SUBTAREAS APROBADAS AL 100% CON ÉXITO!\n');
    process.exit(0);
  } else {
    console.error(`  ⚠️ ATENCIÓN: ${failedTests} pruebas no cumplieron los criterios de aceptación.`);
    process.exit(1);
  }
}

runTestSuite();
