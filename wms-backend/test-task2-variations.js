// Test Suite Automatizada para validar Sprint #3 — Tarea 2:
// Motor de Detección de Variaciones en Tiempo Real (Faltantes, Sobrantes y Dañado)
// Ejecución: node test-task2-variations.js

function calculateLineVariation(esperada, conforme, danada, isBlind = false) {
  const fisicoTotal = conforme + danada;
  const variacionNeta = fisicoTotal - esperada;

  if (isBlind) {
    return { status: 'CIEGO', label: 'Ciego (Oculto)', fisicoTotal, isBlind: true };
  }

  if (fisicoTotal === 0) {
    return { status: 'PENDIENTE', label: 'Pendiente', fisicoTotal, variacionNeta: -esperada };
  }

  if (variacionNeta === 0 && danada === 0) {
    return { status: 'EXACTO', label: 'Exacto (100%)', fisicoTotal, variacionNeta: 0, danada: 0 };
  }

  if (variacionNeta === 0 && danada > 0) {
    return { status: 'CUADRADO_CON_MERMA', label: `Merma: ${danada} pzas`, fisicoTotal, variacionNeta: 0, danada, conforme };
  }

  if (variacionNeta < 0) {
    return { status: 'FALTANTE', label: `Faltante: ${variacionNeta} pzas`, fisicoTotal, variacionNeta, danada };
  }

  return { status: 'SOBRANTE', label: `Sobrante: +${variacionNeta} pzas`, fisicoTotal, variacionNeta, danada };
}

function calculateInvoiceKPIs(lineas, isBlind = false) {
  let totalEsperado = 0;
  let totalConforme = 0;
  let totalDanado = 0;
  let lineasConDiscrepancia = 0;
  let lineasConMerma = 0;
  let lineasExactas = 0;
  let lineasPendientes = 0;

  lineas.forEach(l => {
    const esp = l.cantidadEsperada || 0;
    const conf = l.cantidadConforme || 0;
    const dan = l.cantidadDanada || 0;
    const fis = conf + dan;
    const diff = fis - esp;

    totalEsperado += esp;
    totalConforme += conf;
    totalDanado += dan;

    if (fis === 0 && esp > 0) {
      lineasPendientes++;
    } else if (diff === 0 && dan === 0) {
      lineasExactas++;
    } else {
      if (diff !== 0) lineasConDiscrepancia++;
      if (dan > 0) lineasConMerma++;
    }
  });

  const totalFisico = totalConforme + totalDanado;
  const variacionNeta = totalFisico - totalEsperado;
  const pctCumplimiento = totalEsperado > 0 ? Math.min(100, Math.round((totalConforme / totalEsperado) * 100)) : 0;
  const pctMerma = totalFisico > 0 ? parseFloat(((totalDanado / totalFisico) * 100).toFixed(1)) : 0.0;

  return {
    totalEsperado,
    totalConforme,
    totalDanado,
    totalFisico,
    variacionNeta,
    pctCumplimiento,
    pctMerma,
    lineasConDiscrepancia,
    lineasConMerma,
    lineasExactas,
    lineasPendientes,
    isBlind
  };
}

console.log('================================================================');
console.log('🧪 GIVING OUT WMS — VALIDACIÓN MATEMÁTICA DE SPRINT #3 TAREA 2');
console.log('   Motor de Detección de Variaciones en Tiempo Real');
console.log('================================================================\n');

let passed = 0;
let failed = 0;

function assertTest(name, condition, details) {
  if (condition) {
    console.log(`✅ [PASS] ${name}`);
    if (details) console.log(`   ↳ ${details}`);
    passed++;
  } else {
    console.log(`❌ [FAIL] ${name}`);
    if (details) console.log(`   ↳ Detalle: ${details}`);
    failed++;
  }
}

// Caso 1: Línea 100% exacta
const r1 = calculateLineVariation(100, 100, 0);
assertTest('1. Detección de línea Exacta (100 conformes / 100 esperadas)', 
  r1.status === 'EXACTO' && r1.variacionNeta === 0, 
  r1.label
);

// Caso 2: Línea con faltante de proveedor
const r2 = calculateLineVariation(100, 80, 0);
assertTest('2. Detección de línea con Faltante (-20 piezas)', 
  r2.status === 'FALTANTE' && r2.variacionNeta === -20, 
  r2.label
);

// Caso 3: Línea con excedente / sobrante
const r3 = calculateLineVariation(50, 60, 0);
assertTest('3. Detección de línea con Sobrante (+10 piezas)', 
  r3.status === 'SOBRANTE' && r3.variacionNeta === 10, 
  r3.label
);

// Caso 4: Línea cuadrada pero con piezas dañadas / merma
const r4 = calculateLineVariation(100, 95, 5);
assertTest('4. Detección de Cuadrado con Merma (95 conf + 5 dañadas = 100 fis)', 
  r4.status === 'CUADRADO_CON_MERMA' && r4.danada === 5 && r4.variacionNeta === 0, 
  `${r4.label} (${r4.conforme} conformes)`
);

// Caso 5: Línea con faltante Y daño simultáneo
const r5 = calculateLineVariation(100, 85, 5);
assertTest('5. Detección compuesta de Faltante (-10) y Merma (+5 dañadas)', 
  r5.status === 'FALTANTE' && r5.variacionNeta === -10 && r5.danada === 5, 
  `${r5.label} (+${r5.danada} dañadas)`
);

// Caso 6: Modo Conteo Ciego activo
const r6 = calculateLineVariation(100, 100, 0, true);
assertTest('6. Enmascaramiento de variación bajo Modo Conteo Ciego', 
  r6.status === 'CIEGO' && r6.isBlind === true, 
  r6.label
);

// Caso 7: Conciliación Global de Factura (4 KPIs)
const invoiceLines = [
  { cantidadEsperada: 100, cantidadConforme: 100, cantidadDanada: 0 }, // Exacto
  { cantidadEsperada: 50,  cantidadConforme: 40,  cantidadDanada: 0 }, // Faltante 10
  { cantidadEsperada: 80,  cantidadConforme: 90,  cantidadDanada: 0 }, // Sobrante 10
  { cantidadEsperada: 20,  cantidadConforme: 18,  cantidadDanada: 2 }, // 2 merma
];

const kpi = calculateInvoiceKPIs(invoiceLines);
assertTest('7. KPI Factura Esperada coincide (250 pzas totales)', 
  kpi.totalEsperado === 250, 
  `${kpi.totalEsperado} pzas esperadas`
);

assertTest('8. KPI Conforme Recibido & % Cumplimiento (248 pzas = 99%)', 
  kpi.totalConforme === 248 && kpi.pctCumplimiento === 99, 
  `${kpi.totalConforme} pzas (${kpi.pctCumplimiento}% cumplimiento)`
);

assertTest('9. KPI Discrepancia Neta global (+0 pzas netas)', 
  kpi.variacionNeta === 0 && kpi.totalFisico === 250, 
  `Variación Neta: ${kpi.variacionNeta} (Físico: ${kpi.totalFisico} vs Esperado: ${kpi.totalEsperado})`
);

assertTest('10. KPI Merma / Dañado detectado (2 pzas = 0.8% merma)', 
  kpi.totalDanado === 2 && kpi.pctMerma === 0.8, 
  `${kpi.totalDanado} pzas merma (${kpi.pctMerma}% del embarque)`
);

console.log('\n----------------------------------------------------------------');
console.log(`TOTAL CASOS AUDITADOS: ${passed + failed}`);
console.log(`APROBADOS: ${passed} | FALLIDOS: ${failed}`);
console.log('----------------------------------------------------------------');

if (failed === 0) {
  console.log('🏆 100% DE PRUEBAS MATEMÁTICAS APROBADAS PARA TAREA 2');
  process.exit(0);
} else {
  console.error('⚠️ ALGUNAS PRUEBAS FALLARON');
  process.exit(1);
}
