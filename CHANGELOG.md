# 📋 Changelog — Giving Out WMS

Todos los cambios notables y versiones del proyecto **Giving Out WMS (3PL Operador Logístico)** están documentados en este archivo.

El formato sigue las directrices de [Keep a Changelog](https://keepachangelog.com/es-ES/1.0.0/) y se adhiere a [Semantic Versioning](https://semver.org/lang/es/).

## [1.9.14] — 2026-10-09

### 🚀 Certificación E2E de REC-2026-0006, Blindaje de fechaCierre e Idempotencia, y Promoción a main

- **1. Auditoría Directa en BD y Persistencia Formal de `fechaCierre` (`operations.controller.ts`, `Receiving.tsx`):**
  - Se auditó y certificó directamente en base de datos PostgreSQL la persistencia obligatoria del timestamp de cierre para recepciones finalizadas: `REC-2026-0006` con `fechaCierre = 2026-10-09T15:18:44.919Z` (exacto a `09/10/2026 09:18:44` local), `estado = 'CERRADA'`, `bloqueado = true` y bitácora de auditoría inmutable `CERRAR_RECEPCION`.
  - En `computeReceiptStage` (`Receiving.tsx:2521`), se reforzó la condición como regla general: `const isClosed = r.estado === 'CERRADA' || r.estado === 'CERRADO' || Boolean(r.fechaCierre);`. Toda recepción con fecha de cierre queda automáticamente catalogada como cerrada (`isClosed: true`), asignada a la pestaña "Cerradas" y excluida de "Por Cerrar".
- **2. Candado Total de Idempotencia en Cierre Oficial (`operations.controller.ts`):**
  - La verificación inicial de `closeReceipt` comprueba defensivamente `if (receipt.estado === 'CERRADA' || receipt.estado === 'CERRADO' || receipt.fechaCierre)`. Ante llamadas repetidas o reintentos en red, responde inmediatamente `idempotent: true` devolviendo el registro existente, sin recalcular inventarios, sin mutar fechas y sin duplicar movimientos ni bitácoras de auditoría.
- **3. Cero Fechas Ficticias en Reporte Oficial con Anexos (`ReceiptReportModal.tsx`):**
  - El modal de reporte de cierre formatea con fidelidad estricta el timestamp persistido en `receipt.fechaCierre` (o en su defecto `auditCierre.createdAt`), soportando las acciones de auditoría `CIERRE_RECEPCION` y `CERRAR_RECEPCION`. Erradica cualquier timestamp sintético o visual no respaldado en BD.
- **4. Culminación Exitosa de la Prueba E2E Completa (REC-2026-0006):**
  - Flujo de 6 Fases completado al 100%: Previo → Rampa (12 bultos, 1 con daño exterior) → Calidad (10 pz rescatadas en `BOX-REC-2026-0006-0002` + 2 pz merma en `HU-NC-REC-2026-0006-MERMA-01` segregadas en DEV-01) → Doble Etiquetado (12 HUs activas `0002..0013` en Tarima Master `PLT-REC-2026-0006-01`, caja histórica `0001-DANO` saldo 0 fuera de stock) → Putaway con Escaneo Dual en 12 racks de Alimentos B → Inventario (210 pzas comerciales conformes + 2 pzas merma bloqueadas) → Cierre Oficial → Reporte y Acta de Finiquito. Balance perfecto: 212 esperadas = 210 conformes + 2 merma, 0 faltantes.
- **5. Promoción Oficial de dev a main:**
  - Integración mediante fast-forward limpio de `dev` a `main` (commit base de código `0099ad6`).
  - Verificación de compilación limpia al 100% (0 errores) tanto en frontend (`tsc -b && vite build`) como en backend (`prisma generate && nest build`).
  - Sincronización completa de los repositorios locales y remotos (`origin/dev` y `origin/main`).

## [1.9.13] — 2026-10-09

### 🔍 Corrección General de Resumen Putaway, Idempotencia de Escaneo Dual y Desglose de HUs en Almacén

- **1. Erradicación del Falso Faltante de 20 Piezas en Resumen Putaway (`PutawayModal.tsx`):**
  - Causa raíz: operador falsy `|| 20` (`{completedSummary.piezasFaltantes || 20}`) evaluaba el valor legítimo de 0 faltantes a 20. Reemplazado por nullish coalescing `(completedSummary.piezasFaltantes ?? 0)` y `(completedSummary.piezasMerma ?? 0)`.
- **2. Desglose Preciso de HUs en Dossier de Almacén (`Receiving.tsx`):**
  - Desacople transparente entre cajas operativas activas en racks (12), HUs históricas inactivas (1 con saldo 0) y HUs segregadas de merma (1 en DEV-01 con 2 piezas bloqueadas). Contador de pestaña generalizado: `Cajas en Almacén (12 activas · 1 hist. · 1 merma DEV-01)`.
- **3. Candado de Idempotencia y Bloqueo de Reconfirmación en Putaway (`PutawayModal.tsx`, `operations.controller.ts`):**
  - En la interfaz de Escaneo Dual, toda caja ya confirmada conmuta a botón inactivo "Caja ya Confirmada", imposibilitando una segunda confirmación accidental. Reubicaciones requieren pulsar explícitamente "Reiniciar a Pendiente".
  - En backend (`confirmPutawayItem` y transacción de `confirmPutaway`), verificación previa de auditoría y movimientos para evitar duplicación de `InventoryMovement`, `AuditLog` u ocupación de ubicaciones.
- **4. Ajuste Semántico de Daño/Merma (`PutawayModal.tsx`, `operations.controller.ts`):**
  - Sustitución del texto confuso "1 caja dañada en Calidad" por "1 caja dañada histórica/inactiva (saldo 0)", preservando de forma independiente "2 piezas de merma en DEV-01".
- **5. Aislamiento Absoluto de Recepciones:**
  - Auditoría confirmada de cálculos, reportes y endpoints resueltos estrictamente mediante identificadores formales (`receiptId`, `huId`, `lotId`, `receiptLineId`) sin mezclas por SKU, lote o rack compartido.
- **6. Auditoría Directa en BD de REC-2026-0006:**
  - 0 faltantes, 210 piezas comerciales conformes, 2 piezas de merma en DEV-01, 12 HUs activas en racks, 1 Tarima Master, 1 HU dañada histórica inactiva saldo 0, cero movimientos duplicados, `fechaCierre = null`.
- **7. Clasificación Formal y Semántica de No Conformidades en Anexo A (`ReceiptReportModal.tsx`, `operations.controller.ts`):**
  - Erradicación del falso estatus comercial "ACTIVA PARCIAL" en HUs no disponibles o ubicadas en almacén virtual (`DEV-01`).
  - Matriz de estatus según condición y disponibilidad física: `ACTIVA / EN RACK` (comercial estándar), `ACTIVA PARCIAL` (comercial disponible), `HISTÓRICA / INACTIVA` (saldo 0), `BLOQUEADA · MERMA DEV-01` (merma dictaminada), `BLOQUEADA · CUARENTENA` (retención de calidad), `BLOQUEADA · SEGREGADA` (almacenes virtuales).
  - Encabezado de Anexo A con desglose íntegro por tipo de HU (`12 cajas activas en racks · 1 HU histórica dañada/inactiva · 1 HU de merma bloqueada en DEV-01`) y total histórico registrado (14 HUs) sin contar merma como caja comercial operativa.

## [1.9.12] — 2026-10-09

### 🛡️ Blindaje de Concurrencia, Idempotencia de Cierre y Corrección de Conteo de Cajas Dañadas Históricas

Commits en `dev`: `9821217`, `ed42594`, `1c279a7`. `main` sin cambios (`35ec587`).

- **1. Dictamen de Calidad Transaccional y Atómico (`9821217`):**
  - La resolución del dictamen de Calidad (`operations.controller.ts`) se ejecuta en una única transacción: creación de HU reacondicionada, segregación de merma e inactivación de la caja dañada original ocurren todas o ninguna.
  - Correlativo `INSP-` protegido con constraint único + captura `P2002` + recálculo + reintento.

- **2. Protección General de Correlativos ante Concurrencia Real (`ed42594`):**
  - Nuevo helper reutilizable `withConcurrencyRetry` en `wms-backend/src/common/concurrency.util.ts`: detecta colisiones de llave única (`P2002` / `23505` / `duplicate key`) y reintenta con backoff + jitter (5 intentos por defecto).
  - Los correlativos `REC-`, `PLT-`, `HU-`/`BOX-`, `PED-`, `CC-` y `ACTA-NC-` pasan de `count()+1` a `maxSeq+1` dentro del helper, evitando tanto la reutilización de folios tras borrados como la colisión de dos operaciones simultáneas.

- **3. Cierre Oficial Idempotente (`ed42594`):**
  - Un segundo `closeReceipt` (doble clic, timeout o reintento) sobre una recepción ya cerrada devuelve el cierre existente en lugar de un error 403, sin duplicar movimientos ni auditoría.
  - Ajustes de estados operativos en `inventory.controller.ts`, `Receiving.tsx`, `Inventory.tsx`, `QualityInspectionModal.tsx`, `ReceiptReportModal.tsx` y `DualLabelModal.tsx`.

- **4. Conteo Correcto de Cajas Dañadas Históricas en Doble Etiquetado (`1c279a7`):**
  - **Problema:** en REC-2026-0006 el modal mostraba "2 Dañada histórica / inactiva fuera de la tarima" y "(2 histórica en Calidad)", cuando solo existe 1 caja dañada (`BOX-REC-2026-0006-0001-DANO`). La HU de merma `HU-NC-REC-2026-0006-MERMA-01` (tipo `CAJA`, con `motivoDano` heredado) se contaba como segunda caja.
  - **Corrección general en `DualLabelModal.tsx`:**
    * `isHuMerma(hu)`: identifica HUs de merma (`HU-NC-`, `MERMA`, `DEV-01`, `estadoCalidad === 'MERMA'`, o `BLOQUEADO` con `cajaOrigenId`).
    * `isHuOriginalDamaged(hu)`: cuenta solo cajas de origen (`!cajaOrigenId`) inactivas o dañadas, excluyendo merma.
    * `isHuDamaged(hu)` excluye merma; las HUs de merma no aparecen en la pestaña de cajas.
    * `piezasMerma` se calcula aparte (en piezas) y nunca se usa como contador de cajas.
    * Textos con singular/plural: "1 caja dañada histórica / inactiva fuera de la tarima", "(1 histórica en Calidad)", "2 piezas de merma (en DEV-01)", "(2 pzas merma DEV-01)".
  - **Backend (`operations.controller.ts`):** el resumen de putaway (`cajasDanadasFueraStock`) excluye la merma de DEV-01. La validación de cajas activas del putaway no cambia.
  - Corrección solo de presentación/cálculo: sin cambios de datos en BD, sin generar etiquetas y sin avanzar REC-2026-0006 (sigue en `EN_PROCESO_CONTEO`, Calidad `COMPLETADA`, Etiquetas `PENDIENTE`).

## [1.9.11] — 2026-10-07

### 🏷️ Corrección Estructural de Etapa 4 (Etiquetas/Doble Etiquetado), Generador General de Correlativos HU y Normalización Oficial

- **1. Corrección Estructural en Cálculo Físico de Doble Etiquetado (`DualLabelModal.tsx`):**
  - Se erradicó la omisión de cajas sanas conciliadas en andén cuando existen HUs reacondicionadas de Control de Calidad (ej. en VAL1 con 4 cajas sanas + 1 reacondicionada de 10 piezas = 5 conformes).
  - El desglose físico por partida ahora se construye formalmente a partir de la conciliación persistida en `ReceiptLine` (`cantidadRecibida`, `cantidadDanada`) contrastada con las HUs activas preexistentes de Calidad.
  - Distinción estricta de los 4 estados físicos por partida:
    * *Cajas sanas nuevas por materializar:* calculadas como `Math.max(0, cajasSanasAnden - cajasSanasExistentes)`.
    * *HUs conformes/reacondicionadas de Calidad:* stock activo preexistente que conserva su ID y código único (`BOX-...-0002`).
    * *HUs dañadas originales:* registros históricos/inactivos (`estadoHu: 'INACTIVO'`) que no generan stock operativo ni etiqueta de tarima.
    * *Cajas faltantes confirmadas:* no generan HU ni etiqueta física (evitando bultos fantasmas).
  - Eliminado el prefijo negativo en la columna "Cajas faltantes": ahora muestra el valor absoluto positivo `1 (Sin etiqueta)` en lugar de `-1 (Sin etiqueta)`.
  - El texto de instrucción superior ahora es reactivo a `isCalidadCompletada`: explica que las HUs dañadas históricas no generan etiqueta operativa y que las HUs reacondicionadas conservan su identidad en la tarima.
  - El badge de Rampa y el botón de acción reflejan fielmente las cajas nuevas a crear versus el total físico activo: ej. `Generar Doble Etiquetado (13 Cajas Nuevas · 14 Físicas Activas)`.

- **2. Blindaje de Backend e Idempotencia en Generación (`operations.controller.ts`):**
  - Eliminada la sobreescritura destructiva que ejecutaba `ReceiptLine.update({ cantidadRecibida: cajasConformes * piezasPorCaja })`, protegiendo la integridad de las cantidades recibidas reales (ej. 58 piezas con empaque de 12).
  - Se eliminó la creación de cajas dañadas artificiales en la Tarima Master; las mermas de Calidad permanecen segregadas fuera de la tarima operativa.
  - Generación de 1 Tarima Master (`PLT-REC-...-01`) vinculando todas las cajas hijas conformes (`parentHuId = pallet.id`).
  - Total idempotencia: reintentar la generación cuando las tarimas ya existen retorna las HUs y la tarima existentes (`yaGeneradas: true`) sin duplicar registros.
  - Cero disponibilidad comercial de inventario en racks antes de Putaway (ubicación fija en `RAMPA_RECEPCION`).

- **3. Corrección General de la Regla de Correlativos para Handling Units:**
  - Corregida la expresión regular `/BOX-[^-]+-(\d+)/i` que capturaba erróneamente el año del folio (ej. `2026` de `REC-2026-0012`) generando correlativos anómalos `2027..2039`.
  - Implementada extracción estricta basada en el prefijo de la recepción (`prefix = BOX-${receipt.codigo}-`), garantizando para todas las recepciones actuales y futuras la secuencia oficial continua `0001`, `0002`, `0003`, ..., `0015`.

- **4. Normalización Transaccional de REC-2026-0012 al Estándar Oficial:**
  - Renumeradas transaccionalmente las 13 HUs nuevas generadas hacia el rango oficial `BOX-REC-2026-0012-0003` hasta `BOX-REC-2026-0012-0015`.
  - Preservados 100% intactos los IDs internos de BD, relaciones a `ReceiptLine`, cantidades, lotes, fechas de vencimiento y pertenencia a `PLT-REC-2026-0012-01`.
  - Preservadas intactas `BOX-REC-2026-0012-0001-DANO` (inactiva) y `BOX-REC-2026-0012-0002` (reacondicionada, 10 pzas).
  - Registrado evento formal de auditoría en `AuditLog` (`NORMALIZACION_CORRELATIVOS_HU`).
  - Validación completa de los 9 puntos de integridad: 14 cajas activas en tarima (198 pzas), 1 dañada histórica, rango 0002..0015 sin duplicados, distribución exacta (5 VAL2 / 5 VAL1 / 4 VAL3), 0 racks y reintento 100% idempotente.

## [1.9.10] — 2026-10-07

### ⚖️ Remediación General de Balances Recepción → Calidad, Desacoplamiento de Andén y Cuadre de Expediente

- **1. Erradicación del Falso Faltante de 208 Piezas en Expediente:**
  - En `Receiving.tsx`, se corrigió la lógica de agregación del expediente que convertía automáticamente las partidas no contadas en "faltantes confirmados" tras el dictamen parcial de una caja dañada.
  - Se desacoplaron matemáticamente los 5 estados del balance:
    * *Conteo Exterior en Rampa:* 15 bultos declarados, 14 recibidos, 1 bulto con daño exterior, 1 bulto faltante en descarga.
    * *Dictamen de Calidad Parcial:* 12 piezas inspeccionadas (10 rescatadas en caja reacondicionada + 2 piezas de merma dictaminada).
    * *Mercancía en Andén Pendiente de Clasificación:* 208 piezas correspondientes a los 13 bultos sanos recibidos aún no abiertos ni contados por partida. Se muestran explícitamente como "Pendiente de conteo en andén", nunca como 0 ni como faltantes confirmados.
    * *Faltantes Confirmados:* 0 piezas (los faltantes solo se confirman al conciliar formalmente cada partida o al sellar el cierre).
    * *Disponibilidad de Inventario:* 0 piezas disponibles para pedidos comerciales o picking antes del guardado y confirmación física en racks (Putaway).
- **2. Siguiente Acción Coherente en el Expediente:**
  - En `computeReceiptStage`, cuando la inspección de calidad de cajas dañadas está completada pero restan partidas sin clasificar en andén, la tarjeta de siguiente acción guía al operador a: `Clasificar y verificar mercancía en andén` con el botón `Verificar Partidas en Andén` (que dirige a la pestaña "Partidas y Balance"), evitando saltar indebidamente a etiquetas o cierre.
- **3. Denominación Oficial de Merma Dictaminada:**
  - En backend, `QualityInspectionModal.tsx`, `Receiving.tsx`, `DualLabelModal.tsx` y `ReceiptReportModal.tsx`, se separó formalmente la merma técnica de la destrucción física, utilizando el concepto oficial `Merma Dictaminada`.
- **4. Estandarización de Cajas Rescatadas y Formato de Reportes:**
  - Cajas parciales rearmadas muestran el identificador unificado `Parcial: 10 de 12 piezas · Reacondicionada` en encabezados, tablas de resumen y etiquetas.
  - Tabla del reporte oficial de calidad calibrada con anchos de columna estrictos (`20%`, `12%`, `11%`, `6%`, `6%`, `6%`, `18%`, `21%`), saltos de línea forzados (`word-break: break-word`) y alineación superior para erradicar cualquier encimamiento de texto o códigos tanto en visualización de pantalla como en impresión PDF Carta.
- **5. Control de Costeo 3PL sin Cargos Inventados:**
  - En `QualityInspectionModal.tsx`, las horas de maquila inicializan estrictamente en `0.0` y la tarifa por hora lee la tarifa configurada del cliente (o `0.0` por defecto), asegurando que pruebas o inspecciones estándar no generen cobros ficticios.
- **6. Blindaje de Botones y Prevención de Duplicados:**
  - Se diferenciaron con precisión los botones de acción: `Dictaminar Solo Esta Caja` (unitario) y `Confirmar Dictamen y Armar Cajas Conformes` (lote completo), ambos blindados con bloqueo de reintentos (`disabled={submitting}`).
- **7. Preservación Intacta de Registros de Producción:**
  - Verificados e intactos en Supabase PostgreSQL: `REC-2026-0012` (AlimNorte, 14 recibidos, 1 dañado, dictamen `INSP-2026-0023` con 10 rescatadas y 2 merma, `BOX-REC-2026-0012-0001-DANO` inactiva, `BOX-REC-2026-0012-0002` activa con 10 pzas), `REC-2026-0009` (COMPLETO), `REC-2026-0011` (CERRADA) y `PED-2026-0007` (DISPATCHED).
- **8. Suite de Pruebas Aisladas al 100%:**
  - Ejecutada exitosamente en `scratch/test-isolated-calidad-matrix.js` con las 6 pruebas de la matriz validadas.

## [1.9.9] — 2026-10-06

### 🔬 Rediseño Estructural del Flujo Rampa → Calidad, Identificación Operativa de Bultos Dañados y Estandarización de UI

- **1. Desacoplamiento del Conteo Exterior y Eliminación de HUs Ficticias en Rampa:**
  - En `operations.controller.ts` (`POST /receipts/:id/rampa-arribo`), el registro de llegada a andén captura estrictamente el conteo físico global (`bultosDeclarados`, `bultosRecibidos`, `bultosDanados`, `diferenciaBultos`), sin inventar SKUs, lotes ni Unidades de Manejo (`HandlingUnit`) ficticias para bultos con daño o faltantes.
  - La mercancía con daño exterior permanece en estado pendiente de clasificación física y no se confunde con merma definitiva antes de contar con un dictamen técnico formal.
- **2. Nuevo Paso Operativo: Identificación Física de Bulto con Daño Exterior:**
  - Implementado DTO `IdentifyDamagedBoxDto` en `previo.dto.ts`.
  - Creado endpoint `POST /receipts/:id/identify-damaged-box` en `operations.controller.ts` que permite al personal de almacén inspeccionar físicamente la caja con daño exterior, vincularla con su partida correspondiente (`ReceiptLine`: SKU, lote, caducidad, capacidad de empaque) y registrar el motivo visible de daño.
  - Genera una `HandlingUnit` con `tipoHu: 'CAJA'`, `estadoHu: 'RETENIDA'`, `ubicacionActual: 'AREA_CALIDAD'` y código correlativo seguro (ej. `HU-BX-0012-01-DANO`).
  - Actualiza el saldo en la partida (`cantidadDanada`) y establece la recepción en `inspeccionCalidadEstado = 'EN_PROCESO'`.
- **3. Consulta Dinámica y Persistencia en el Módulo de Calidad:**
  - En `GET /receipts/:id/inspection-pending`, se calculan dinámicamente:
    * `bultosDanadosDeclarados`: Bultos reportados con daño en Rampa.
    * `totalPendingBoxes`: Cajas físicas identificadas en estado `RETENIDA` en `AREA_CALIDAD`.
    * `processedBoxesCount`: Cajas dañadas originales que ya han sido dictaminadas (excluyendo cajas nuevas rearmadas).
    * `unidentifiedDamagedCount`: Bultos dañados pendientes de clasificación física.
    * `lineasDisponibles`: Catálogo de partidas con SKUs, lotes esperados, caducidades y capacidades por caja.
  - El modal de Calidad (`QualityInspectionModal.tsx`) muestra el bloque reactivo **"Identificación Física de Bultos con Daño Exterior"** siempre que existan bultos declarados en rampa pendientes de vinculación.
  - Persistencia garantizada: Una caja retenida no desaparece de Calidad por recargar la página, cambiar de pestaña, abrir modales o generar etiquetas; permanece visible hasta contar con un dictamen persistido en base de datos.
- **4. Dictámenes Unitarios, Parciales y Trazabilidad Integral:**
  - En `POST /receipts/:id/inspection/execute`, se añadió soporte para dictaminar cajas individuales o por lotes parciales mediante la acción "Dictaminar Solo Esta Caja".
  - Validación matemática estricta: `piezasRescatadas + piezasMerma === piezasTotales`.
  - La caja dañada original se desactiva (`estadoHu: 'INACTIVO'`, `reacondicionada: true`), se crean las nuevas cajas conformes vinculadas vía `cajaOrigenId`, y se registran asientos formales de kárdex en `InventoryMovement` (`MERMA_DESTRUCTIVA` y `REACONDICIONAMIENTO_MAQUILA`).
  - El previo permanece en `EN_PROCESO` mientras existan cajas retenidas o bultos sin clasificar; avanza a `COMPLETADA` únicamente cuando la totalidad de las unidades ha sido dictaminada.
- **5. Deduplicación en Etiquetado:**
  - En `POST /receipts/:id/generate-labels`, se descuentan las piezas de cajas retenidas identificadas para evitar duplicación de unidades de manejo al generar tarimas y cajas conformes en etapas posteriores.
- **6. Limpieza y Profesionalización de la UI para Presentación Ejecutiva:**
  - En `QualityInspectionModal.tsx`, se erradicó la leyenda `Fase 2 (Sin emojis, trazabilidad completa)` sustituyéndola por: `Control de Calidad Giving Out WMS · Inspección Técnica y Trazabilidad Integral`.
  - En `PutawayModal.tsx`, se sustituyeron referencias informales como `Regla Operativa de Alejandra`, `Fase 4 · Putaway` y `Candado de Seguridad: Fase 3 Requerida` por terminología corporativa estándar: `Protocolo de Flujo Operativo y Trazabilidad (Giving Out WMS)`, `Putaway / Ubicación` y `Candado Operativo: Etiquetado Requerido Antes de Ubicar`.
  - En `DualLabelModal.tsx` y `Receiving.tsx`, se normalizaron los textos descriptivos y marcadores de tablas a estándares ejecutivos limpios.
- **7. Suite de Pruebas Aisladas (100% Exitosa):**
  - Implementada y ejecutada en `scratch/test-isolated-calidad-matrix.js`:
    * *Prueba 1 (Sin daño):* Flujo limpio sin retención ni bultos pendientes.
    * *Prueba 2 (1 caja dañada):* Identificación -> HU `RETENIDA` en `AREA_CALIDAD` -> Dictamen -> Rescate/Merma en kárdex -> `COMPLETADA`.
    * *Prueba 3 (Varias cajas y dictamen parcial):* Dictamen unitario de Caja 1 -> estado `EN_PROCESO` -> Recarga y persistencia de Caja 2 -> Dictamen de Caja 2 -> `COMPLETADA`.
    * *Prueba 4 (Multi-SKU y lotes distintos):* Vinculación y dictamen multi-partida con balance exacto.
    * *Prueba 5 (Faltante + Daño simultáneos):* Sin generación de HUs para faltantes; solo el daño físico pasa a identificación y dictamen.
    * *Prueba 6 (Invariantes históricas):* `REC-2026-0009` y `REC-2026-0011` intactas; `REC-2026-0012` preservada en `EN_PROCESO_CONTEO`, calidad `PENDIENTE` sin dictamen automático ni HUs falsas.

## [1.9.8] — 2026-10-05

### 🖨️ Corrección Integral de Impresión con Anexos, Paginación Real en Navegador y Ajustes de Formato

- **1. Desacoplamiento de Impresión mediante Portal (`createPortal`) y Paginación Completa:**
  - En `ReceiptReportModal.tsx`, se migró el renderizado del modal a `createPortal(modalContent, document.body)`.
  - Bajo `@media print`, se oculta de raíz el árbol `#root` de React (`body > #root { display: none !important; }`), erradicando las restricciones de `overflow-y: auto`, `max-height: 94vh` y contenedores con scroll que forzaban a los navegadores basados en Chromium/WebKit a recortar la impresión a 1 sola página.
  - Reglas de salto de página estrictas: `.report-main-page { page-break-after: always; }` y `.annex-page { page-break-before: always; }`, permitiendo que el reporte principal y cada anexo activo se impriman en hojas Carta continuas sin desbordes ni filas cortadas.
- **2. Ajuste de Anchos y Prevención de Truncamiento:**
  - Campos de transporte, placas de unidad (`TEST-001`), operador y responsable de cierre configurados con saltos de línea permitidos (`word-break: break-word`) y anchos proporcionales.
  - Tabla del Anexo A reestructurada con `table-layout: fixed; width: 100%` y anchos porcentuales estrictos, garantizando que código HU, condición, SKU, saldos y estatus se muestren sin desborde horizontal.
- **3. Formato Limpio de Impresión:**
  - Eliminadas sombras (`box-shadow: none`), bordes de ventana y fondos grises en medios impresos.
  - Encabezados de tabla contrastados (`#0F172A`, `#1E293B`, `#334155`), tipografía unificada y márgenes uniformes de 10mm.
- **4. Numeración Dinámica Real y Selección de Anexos:**
  - El botón "Reporte Principal (1 pág)" fue renombrado a **"Reporte principal"**.
  - Numeración reactiva calculada según los anexos efectivamente seleccionados: `Hoja X de Y` (1 de 1 para Principal solo; 1 de 4, 2 de 4, 3 de 4, 4 de 4 con todos los anexos; y 1 de 3, 2 de 3, 3 de 3 al desmarcar el Anexo B).
- **5. Merma Dictaminada vs Destrucción:**
  - En el Anexo B, se sustituyó "Destrucción registrada" por **"Merma dictaminada (2 piezas no aptas por daño físico)"**, reflejando la realidad operativa sin afirmar destrucciones no certificadas.
- **6. Caja Histórica Inactiva por Reacondicionamiento:**
  - Sustituida la etiqueta "1 inactiva/merma" por **"1 caja histórica inactiva por reacondicionamiento (10 rescatadas, 2 merma)"**, reflejando que de las 12 piezas originales se rescataron 10 y 2 fueron merma.
- **7. Cantidades Históricas vs Saldo Actual en Anexo A:**
  - Las cajas despachadas muestran de forma explícita: `0 pz en almacén (Salida: 12 pz despachadas en PED-2026-0007)` y estatus textual `DESPACHADA (Salida)`, sin depender únicamente del color.
  - Se mantiene la distinción entre contenido original del bulto y existencia física en almacén.
- **8. Verificación de Origen de Datos:**
  - Factura y OC: Si no se capturó orden de compra o es idéntica a la factura, se despliega `—` sin sustituirla.
  - Horas maquila: Despliega "No registrado" cuando el valor es 0 o nulo.
  - Responsable del cierre: Despliega el nombre real `Jonathan Palacios`, con correo `admin@givingout.mx` como dato secundario.
  - Firma de cierre: Se presenta la acreditación del finiquito operativo de sistema sin clonar la firma de rampa del chofer.
- **9. Verificación en Aplicación Real con Navegador Edge:**
  - Se ejecutaron pruebas reales sobre la interfaz web con Microsoft Edge automatizado disparando los botones oficiales:
    * `C:\Users\Mariana\Downloads\Reporte_Cierre_REC-2026-0011_Principal_App.pdf` (1 página)
    * `C:\Users\Mariana\Downloads\Reporte_Cierre_REC-2026-0011_Con_Anexos_App.pdf` (4 páginas completas)
    * `C:\Users\Mariana\Downloads\Reporte_Cierre_REC-2026-0011_Anexos_A_y_C_App.pdf` (3 páginas, excluyendo Anexo B)
    * `C:\Users\Mariana\Downloads\Reporte_Cierre_REC-2026-0009_Principal_App.pdf` (1 página, sin cruce de datos)
    * `C:\Users\Mariana\Downloads\Reporte_Cierre_REC-2026-0003_Textil_App.pdf` (1 página, formato textil multirrenglón)

## [1.9.7] — 2026-10-05

### 📄 Rediseño de Alta Densidad del Reporte de Recepción (Hoja Carta) y Separación de Anexos

- **1. Rediseño Ejecutivo del Reporte Principal (1 Hoja Carta):**
  - En `ReceiptReportModal.tsx`, se reestructuró la plantilla hacia un diseño corporativo limpio de alta densidad inspirado en la referencia operativa de Alejandra:
    * Fondo blanco (`#FFFFFF`), texto negro de alto contraste (`#111827`), líneas divisorias delgadas (`1px solid #D1D5DB`) y encabezados sutiles (`#F8FAFC`).
    * Erradicadas las tarjetas de colores saturados, textos técnicos redundantes y elementos decorativos innecesarios. Cero emojis genéricos.
    * Para recepciones estándar como `REC-2026-0011` (3 partidas), el acta de cierre principal cabe holgadamente en **1 sola página Carta** con tipografía nítida y legible.
    * Para recepciones con múltiples partidas, el flujo permite saltos de página naturales con encabezados de tabla repetidos (`thead { display: table-header-group }`) sin cortar columnas ni firmas.

- **2. Separación Jerárquica de Anexos Opcionales:**
  - El **Reporte Principal** se enfoca exclusivamente en el acta legal de finiquito e ingreso a inventario al momento del cierre.
  - Se estructuraron tres **Anexos Opcionales** separados mediante saltos de página forzados:
    * **Anexo A:** Manifiesto detallado de Cajas y Tarimas (HUs) con trazabilidad de empaque y ubicación.
    * **Anexo B:** Bitácora técnica de inspección y rescate de calidad (`INSP-2026-0002`).
    * **Anexo C:** Trazabilidad de salidas posteriores (`PED-2026-0007`) y balance de existencia física actual en racks (con fecha/hora de consulta).
  - Controles en pantalla: Selector de vista (*Reporte Principal* vs *Con Anexos*) y botones independientes de impresión (*Imprimir Principal (1 pág)* e *Imprimir con Anexos*).

- **3. Corrección del Conteo y Descripción de la Tarima Master:**
  - Corregida la descripción que indicaba erróneamente "15 cajas recibidas en andén".
  - En `ReceiptReportModal.tsx` y `Receiving.tsx`, se aclara explícitamente:
    * **Bultos recibidos en andén:** 14 bultos.
    * **Cajas resultantes conformes al cierre:** 14 cajas.
    * **Registros históricos de cajas:** 15 (14 activas/despachadas + 1 inactiva de reacondicionamiento).
    * **Cajas actualmente en almacén:** 11 activas en racks (3 despachadas).
  - La tarima master (`PLT-REC-2026-0011-01`) se tipifica como contenedor logístico y no duplica las piezas de sus cajas contenidas.

- **4. Folio Legible en Cajas Reacondicionadas (Erradicación de UUIDs):**
  - En `operations.controller.ts` y en los componentes visuales, el campo `cajaOrigenId` se enriquece relacionalmente con `cajaOrigenCodigo`.
  - La caja rescatada `BOX-REC-2026-0011-0015` muestra de forma legible su origen: `Rescate de BOX-REC-2026-0011-0005-DANO` en lugar del identificador UUID técnico.

- **5. Claridad Terminológica en Rampa:**
  - Se modificó la etiqueta de rampa a **"Bultos sin daño exterior"** (13 bultos), eliminando la confusión con las 14 cajas conformes resultantes al cierre tras el rescate técnico.

- **6. Firmas y Responsabilidades Reales:**
  - Acreditación formal de cada evento:
    * **Chofer:** Acredita exclusivamente la entrega física y el estado exterior en rampa.
    * **Calidad:** Si existe firma manuscrita/digital se despliega; si solo existe el dictamen en base de datos, se presenta formalmente como `DICTAMEN TÉCNICO REGISTRADO (Folio INSP-...)` sin inventar firmas simuladas.
    * **Almacén:** Acredita la conformidad del finiquito y el ingreso formal a inventario WMS.

- **7. Generación de Muestras PDF Verificadas:**
  - Generados mediante renderizado headless de alta precisión:
    * `Reporte_Cierre_REC-2026-0011_Principal.pdf` (Exactamente 1 página Carta).
    * `Reporte_Cierre_REC-2026-0011_Con_Anexos.pdf` (3 páginas completas con encabezados repetidos).
    * `Reporte_Cierre_REC-2026-0009_Principal.pdf` (1 página Carta sin discrepancias).
    * `Reporte_Devolucion_Muestra.pdf` (1 página Carta con datos de sucursal, motivo y guía).
    * `Reporte_MultiPagina_Textil_REC-2026-0003.pdf` (Recepción con 9 partidas textiles).

## [1.9.6] — 2026-10-05

### 🏆 Corrección Integral de Integridad de Reportes, Balances Históricos, Caja Cerrada y Formato Giving Out

- **1. Erradicación Total de Cruce de Datos entre Recepciones:**
  - En `ReceiptReportModal.tsx` y `operations.controller.ts`, se eliminaron todos los fallbacks numéricos y literales quemados (`44`, `42`, `2`, `PLT-REC-2026-0009-01`, `INSP-2026-0001`, `BOX-REC-2026-0009-0002-DANO`, etc.).
  - Los datos desplegados pertenecen estrictamente al `receiptId` y depositante consultados.
  - Bultos y piezas faltantes se calculan y muestran con exactitud (p. ej. Arroz: 20 piezas faltantes / 1 bulto faltante físico en rampa).
  - El estatus de conciliación solo muestra *"Conciliado 100%"* si no existen diferencias; de lo contrario muestra *"Finiquitado con Reservas"*.

- **2. Desacoplamiento de Balance Histórico de Cierre vs Existencia Actual en Racks:**
  - Se separaron claramente en el reporte y en la vista operativa:
    * **Balance Histórico al Cierre:** 220 esperadas = 200 recibidas en andén + 20 faltantes; 200 recibidas = 198 conformes + 2 merma; 198 conformes = 154 actuales en racks + 44 despachadas en pedidos posteriores (`PED-2026-0007`).
    * **Existencia Actual en Racks:** Tarjeta diferenciada con fecha/hora de consulta, detallando 154 piezas en 11 cajas activas vs 44 piezas en 3 cajas despachadas.
  - La tarima master (`PLT-REC-2026-0011-01`) se tipifica como contenedor y no se duplican sus piezas con las cajas contenidas.

- **3. Formato Unificado Giving Out y Adaptación Automática:**
  - Erradicada cualquier mención o logotipo de PROVA y el selector de plantillas; identidad exclusiva de Giving Out WMS.
  - El reporte detecta automáticamente el `tipoRecepcion` (`NORMAL` vs `DEVOLUCION`): en devoluciones se despliegan dinámicamente los campos de sucursal/origen, motivo y guía de retorno; en recepciones normales se mantiene la estructura estándar. Sin toggle manual en el visor.

- **4. Trazabilidad de Firmas, Fechas y Responsabilidad:**
  - La firma de rampa acredita únicamente la entrega física del chofer y revisión exterior de bultos; no se transfiere indebidamente al dictamen de calidad.
  - Firma de calidad solo se presenta si existió inspección técnica registrada.
  - Fechas operativas diferenciadas (arribo, liberación de rampa, inspección y cierre). Fechas de caducidad formateadas en fecha calendario sin desfases de huso horario.
  - Clasificación de *"Faltante en recepción"* sin imputar culpa arbitraria al proveedor.

- **5. Cajas Parciales, Rescate y Registros Históricos:**
  - Factor de empaque dinámico: `BOX-REC-2026-0011-0015` obtiene la capacidad desde el SKU (`sku.capacidadEmpaque` = 12), mostrando *"Parcial: 10 de 12 piezas · Reacondicionada"*, sin valores fijos en el código.
  - Caja dañada original (`BOX-REC-2026-0011-0005-DANO`): saldo actual 0 pz, histórico 12 pz (10 rescatadas, 2 merma), inactiva, clasificada como *"Dañado / Retenido Andén (Histórico)"* y etiqueta *"COLOCADA (Histórico)"*.
  - En resúmenes y tooltips se aclara que los 15 registros corresponden a 11 activos, 3 despachados y 1 histórico de reacondicionamiento.

- **6. Blindaje de Regla de Caja Cerrada en Backend:**
  - Para clientes con política `CAJA_CERRADA` (p. ej. AlimNorte), la disponibilidad distingue 154 piezas físicas libres vs 144 piezas elegibles para pedidos de caja cerrada (excluyendo la parcial de 10 pz).
  - En `createOrder`, la validación de inventario opera de forma transaccional atómica: si un pedido exige romper cajas cerradas o no alcanza unidades en cajas estándar, se rechaza de inmediato con error descriptivo y rollback total (0 reservas huérfanas).
  - Permite cajas reacondicionadas siempre que cumplan con la capacidad estándar completa.

- **7. Pulido Visual y Multi-página en Reportes:**
  - Encabezados de tabla con sticky headers e identificación de fila fija.
  - Grid de etapas operativas con ancho responsivo (`minmax(170px, 1fr)`) y auto-wrap, erradicando textos cortados.
  - Estilos de impresión `@media print` para saltos de página limpios y sin firmas recortadas.
  - Erradicación total de emojis genéricos y diálogos `window.alert` en favor de componentes SVG vectoriales de Lucide React.

- **8. Preservación Estricta de Datos:**
  - Registros `REC-2026-0009`, `REC-2026-0011` y `PED-2026-0007` preservados intactos con toda su integridad referencial, HUs y auditorías.
  - Suite de validación exhaustiva automatizada: **70/70 pruebas superadas al 100%**.

## [1.9.5] — 2026-10-03

### 🎯 Corrección de Filtrado Reactivo por Etapas Operativas en Recepción

- **Desacoplamiento del Buscador de Texto e Integración de Etapas:**
  - En `Receiving.tsx`, se eliminó la condición residual de estatus del helper de búsqueda por texto (`filtered = receipts.filter(...)`) que comparaba de forma obsoleta `rMeta.key === filterEstado`. Dicha condición vaciaba la lista antes de que las recepciones llegaran a la tabla cuando se seleccionaba cualquier etapa operativa.
  - `stageFiltered` ahora filtra reactivamente y sin interferencias según la etapa calculada de las 6 fases del WMS:
    * `Todas`: 11 recepciones totales.
    * `Rampa`: 6 recepciones en andén pendientes de acta y liberación de chofer.
    * `Calidad`: Recepciones retenidas por daño exterior con inspección técnica pendiente.
    * `Etiquetas`: Recepciones pendientes de confirmación de etiquetas HU y tarima QR Master.
    * `Ubicación`: Recepciones pendientes de putaway en racks.
    * `Por cerrar`: 1 recepción alojada y lista para finiquito (`REC-2026-0009`).
    * `Cerradas`: 4 recepciones finiquitadas e inmutables (`REC-2026-0011`, `REC-2026-0004`, `REC-2026-0003`, etc.).
- **Sincronización Contextual de Contadores con Depositante:**
  - Los chips de etapas (`countsByStage`) se calculan sobre la base del depositante seleccionado en el dropdown (`filterCliente ? receipts.filter(...) : receipts`), garantizando que los conteos visibles en los botones coincidan siempre con las filas de la tabla.
- **Validación con API y Compilación:**
  - Comprobado contra la API local de backend (`GET /api/receipts`) con concordancia exacta en todos los filtros.
  - Compilación limpia de TypeScript y Vite con código de salida 0 (`npm run build`).

## [1.9.4] — 2026-10-03

### 🛡️ Cierre Integral y Genérico de las 9 Correcciones de Recepción e Inventario

- **1. Inventario → HUs: Consistencia de Encabezado, Filtros, Filas y Pie:**
  - Corregido predicado `isHuActive` para reconocer `estadoHu: 'ACTIVO'` (valor devuelto por Prisma en PostgreSQL).
  - Los contadores de las pestañas/filtros (`Todas`, `Activas en Racks`, `Despachadas`, `Dañadas / Inactivas`) se calculan sobre el subconjunto filtrado por depositante y búsqueda (`clientAndSearchHus`), erradicando contadores globales no contextualizados.
  - Subtítulo y pie calculan con precisión matemática: 11 activas (154 pzas), 3 despachadas (44 pzas históricas) y 1 dañada inactiva (0 saldo actual, 12 originales).
  - Búsqueda en backend `GET /api/inventory/handling-units?search=...` y frontend filtran congruentemente por código HU, texto de lote y SKU.
- **2. Presentación Rigurosa de Cantidades Históricas vs Saldo Actual:**
  - Registros de base de datos preservados sin mutaciones artificiales.
  - Cajas inactivas o de merma (`0005-DANO`) presentan `0 pzas` de saldo actual y aclaran `Orig: 12 pz (10 rescatadas)`.
  - Cajas despachadas presentan `0 en rack` y aclaran `Salida: 44 pz (Despacho registrado)`.
  - Columna de ubicación distingue claramente racks activos de ubicaciones históricas (`RAMPA_RECEPCION (Histórico)` y `Salida (era ...)`).
- **3. Rescate y Condición de Empaque Relacional:**
  - Corregida la auto-referencia: `0005-DANO` ya no indica "Rescate de 0005-DANO"; ahora indica `Rescate en BOX-...-0015`.
  - La caja resultante `BOX-...-0015` muestra dinámicamente `Parcial / Reacondicionada` con `Parcial (10 de 12)` y relación al folio original mediante `cajaOrigenId`.
  - Estado de etiqueta evaluado estrictamente por HU (`No requerida` en cajas inactivas o de merma; no hereda ciegamente el estado general de la recepción).
- **4. Disponibilidad Física vs Elegible (Política de Caja Cerrada en Backend):**
  - Implementada lógica de asignación y consulta de lotes en backend (`getLots`, `suggestOrderAllocation` y `prepareOrder`):
    * Existencia física: 154 piezas.
    * Stock reservado: 0 piezas.
    * Stock libre: 154 piezas.
    * Cantidad elegible: 144 piezas (10 cajas cerradas completas de 12/20 pzas), deduciendo automáticamente las 10 piezas de la caja parcial/reacondicionada para clientes con política `CAJA_CERRADA`.
    * Candado de backend en `prepareOrder`: rechaza asignación de cajas parciales si el depositante opera bajo caja cerrada.
- **5. Tarima Master: Desacoplamiento Histórico y Distribución Física:**
  - Expediente presenta con total transparencia:
    * Composición al cierre: 14 cajas recibidas en andén.
    * Distribución física actual: 11 activas en racks, 3 despachadas, 1 inactiva.
    * Andén de arribo histórico (`REC-01 (Rampa) (Histórico)`).
    * Identificador `PLT-REC-2026-0011-01` preservado intacto.
- **6. Desglose Estricto de Partidas por SKU y Lote:**
  - El desglose de racks en partidas y balance se filtra obligatoriamente por SKU y Lote (`line.loteAsignado || line.loteEsperado`), evitando contaminación cruzada entre lotes de un mismo SKU.
  - Para `E2E-3009-ACE-A`: Desglose exacto en `B01-R02-N1: 22 pz · B01-R03-N1: 12 pz` (34 pzas restantes; 24 despachadas), sin mezclar ubicaciones de `ACE-B`.
- **7. Ajustes de Navegación y Usabilidad en Recepción:**
  - Clic en fila abre el expediente con protección integral contra propagación de botones, links, inputs y selecciones de texto.
  - Botón "Abrir Recepción" / "Ver Expediente" visible y explícito con `e.stopPropagation()`.
  - Unificado botón superior a `Nuevo Previo (ASN / Excel)`, eliminando botones duplicados.
  - Añadida columna e insignia compacta de etapa por fila para identificar de inmediato: Rampa, Calidad, Etiquetas, Ubicación, Por cerrar o Concluida.
  - Conservado filtro de acceso rápido "Por cerrar".
  - Fijadas columnas de Folio y Código HU al realizar scroll horizontal.
  - Erradicados emojis genéricos restantes (`📦`, `📍`) reemplazados por iconos SVG Lucide (`Package`, `MapPin`).
- **8. Terminología Unificada y Fechas Exactas:**
  - Caducidades exactas verificadas: Aceite A (`30/06/2027`), Aceite B (`31/12/2027`), Arroz A (`30/06/2028`).
  - Terminología consistente: `{uniqueLotCodes} lotes distintos (en {filteredLots.length} registros por ubicación)` y "cajas / unidades de manejo" en pie de tabla.
- **9. Validación Genérica y Blindaje de Datos de Prueba:**
  - Creada suite automatizada `scratch/verify-all-9-points.js` que audita directamente la API.
  - Datos de referencia `REC-2026-0009`, `REC-2026-0011` y `PED-2026-0007` preservados intactos.
  - Frontend y backend compilan con 0 errores de TypeScript y Vite.

## [1.9.3] — 2026-10-03

### 🔧 Remediación Post-Entrega de Revisión Manual (9 Puntos Críticos)

- **1. Ubicaciones Dinámicas en Expediente:**
  - Enriquecido endpoint `GET /api/receipts` para retornar handling units con ubicación real y estado.
  - Eliminado mockup estático que mostraba todas las cajas en `B01-R01-N1`. Las cajas se leen dinámicamente de BD: `BOX-REC-2026-0011-0002` en `B01-R02-N1`, `0003` en `B01-R03-N1`, `0015` en `B01-R02-N1`.
  - La tabla de partidas desglosa los racks activos reales y etiqueta `Andén inicial: REC-01` como histórico.
- **2. Identificador Maestro de Tarima y Catálogo de Producto:**
  - Corregido código de tarima a `PLT-REC-2026-0011-01` (confirmado en BD).
  - Reemplazados los textos genéricos "Aceite A", "Aceite B" y "Arroz A" por SKU (`ACE-OLI-1L`, `ARR-BLA-1K`), descripciones oficiales del catálogo y códigos de lote reales (`E2E-3009-...`).
- **3. Fechas de Caducidad Exactas en Inventario:**
  - Erradicado el uso residual de `new Date().toLocaleDateString('es-MX')` en `Inventory.tsx` y `PortalInventory.tsx`.
  - Fechas de lotes se presentan exactas sin desfase de medianoche UTC a UTC-6: `30/06/2027`, `31/12/2027` y `30/06/2028` en inventario, HUs, portal y CSV.
- **4. Segregación de HUs y Stock Físico Actual:**
  - Desglose riguroso en `Inventory.tsx`: 11 cajas activas (154 piezas), 3 despachadas (44 piezas históricas) y 1 dañada inactiva (0 piezas saldo actual).
  - Al buscar `BOX-REC-2026-0011` en "Todas", el subtítulo indica claramente el stock físico actual en racks (154 pzas) sin sumar mercancía ya despachada ni la caja dañada original con su rescate.
  - Filtro "Activas en Racks" conserva 11 cajas y 154 piezas.
  - Contadores diferencian `{uniqueLotCodes} lotes distintos · {filteredLots.length} registros por ubicación`.
- **5. Trazabilidad de Caja Dañada y Rescate:**
  - Trazabilidad explícita: 12 piezas originales en `BOX-REC-2026-0011-0005-DANO` → 10 piezas rescatadas en `BOX-REC-2026-0011-0015` + 2 piezas de merma en QA.
  - `0005-DANO` se muestra con saldo actual de 0 piezas (Orig: 12 pz) e inactiva.
  - `0015` muestra distintivo `Parcial / Reacondicionada` con condición Conforme.
  - Separación de columnas: Estado Operativo, Condición de Calidad y Condición de Empaque.
- **6. Balance Histórico y Política de Caja Cerrada (AlimNorte):**
  - Mantenido cuadre: 220 esperadas, 200 recibidas, 198 conformes al cierre, 2 merma, 20 faltantes, 44 salida posterior, 154 existencia en racks.
  - Etiquetado "14 cajas conformes al cierre" (11 activas + 3 despachadas).
  - KPI de **Disponibilidad Elegible: 144 piezas (10 cajas cerradas)** para pedidos estándar, excluyendo automáticamente la caja parcial `0015` (10 pzas) conforme a la política del depositante.
  - Columna Faltante por partida (Arroz muestra 20 piezas en ámbar).
  - En listado se explicita "200 recibidas / 220 esperadas".
- **7. Pulido de Experiencia en Listado de Recepción:**
  - Sustituido emoji de edificio por icono SVG `<Building2 size={13} />`.
  - Columnas fijas (sticky): Folio/Depositante a la izquierda y Acción a la derecha para mantener identidad y botones visibles en tablas anchas.
  - Añadido botón de filtro rápido `Por cerrar` (`POR_CERRAR`).
  - Unificado botón superior a `<Plus /> Nuevo Previo (ASN / Excel)`.
  - Eliminado clic accidental en la fila; apertura exclusiva mediante botón de acción (`Ver Expediente` para cerradas, `Abrir Recepción` para operativas).
- **8. Simplificación del Expediente y Agrupación Documental:**
  - Sección consolidada `[ Documentos y Etiquetas ]` agrupando Acta de Rampa, Dictamen Técnico, Reporte Oficial de Cierre y Reimpresión Térmica.
  - Eliminados botones duplicados en la tarjeta de cierre.
  - Lenguaje operativo directo ("11 cajas activas" en lugar de "11 handling units (activo)").
- **9. Archivos de Prueba Separados en Downloads:**
  - Verificada pertenencia de `GAL-CHO-1K` al catálogo de AlimNorte.
  - Generados 3 archivos en `C:\Users\Mariana\Downloads\` (y copia en `docs/`):
    * `Previo_Valido_GivingOut_2026.xlsx` (`ACE-OLI-1L` y `ARR-BLA-1K`).
    * `Previo_Invalido_SKU_Inexistente.xlsx` (`SKU-INEXISTENTE-999`).
    * `Previo_Invalido_SKU_Ajeno.xlsx` (`CAM-BLA-M`, perteneciente a Fashion Forward).
  - Ambos archivos inválidos provocan rechazo atómico HTTP 400 sin escrituras parciales en base de datos.

## [1.9.2] — 2026-10-03

### 🏆 Remediación Integral de las 6 Fases Operativas, Rediseño Unificado de Recepción y Blindaje de Trazabilidad (42 Puntos)

#### 🏛️ 1. Rediseño Unificado de Recepción y Expediente de Consulta Inmutable (UX-01 a UX-04)
- **Vista de Entrada Única:** Sustitución de listas con acordeones desplegados redundantes por un listado ejecutivo con selector de depositante, folios, facturas, badges de etapa y botón contextual `[ Abrir Recepción → ]` o `[ Abrir Expediente → ]`.
- **Expediente Dedicado:** Encabezado fijo `REC-2026-0011 · AlimNorte · FAC-E2E-20260930-01`, barra lineal de 6 etapas de progreso y tarjeta contextual "¿Qué sigue?" con explicación clara de la acción pendiente.
- **Modo Consulta Inmutable:** Las recepciones cerradas operan en modo expediente sin formularios de captura ni botones para registrar nuevos movimientos. Bloqueo en backend de putaway (HTTP 400) y de edición de partidas (HTTP 403) sobre recepciones cerradas.
- **Agrupación Documental:** Pestaña "Documentos Oficiales" unificando Acta de Rampa, Dictamen Técnico de Calidad y Reporte de Cierre con sellos de tiempo independientes y alcance legal delimitado.
- **Eliminación de Controles Obsoletos:** Retirada la barra lateral flotante duplicada ("SUGERENCIAS AI") con datos artificiales, integrando las sugerencias operativas de alojamiento en la pestaña correspondiente.

#### 🛡️ 2. Integridad de Inventario, Lotes y Escaneos Físicos (U-01 a U-08, P-01, P-02)
- **Escaneo Vacío Bloqueado en Putaway (U-01):** Erradicado el autocompletado silencioso de códigos vacíos en frontend y backend. Se exige lectura real de HU y ubicación; simulador 🧪 explícito y restringido para auditorías.
- **Motor de Sugerencias de Alojamiento FEFO (U-02):** Evaluación de vida útil residual basada en caducidad y rotación con justificaciones operativas claras (e.g. ergonomía N1 para productos próximos a vencer).
- **Detalle Interactivo de Ubicaciones (U-06):** Endpoint `GET /api/locations/:id` y modal detallado en `Locations.tsx` que desglosa existencias por SKU, lote, cliente, físico, reservado y disponible con lista de HUs reales.
- **Regla de Caja Cerrada (P-02):** Exclusión de cajas parciales (como HU `BOX-REC-2026-0011-0015` de 10 piezas rescatadas) en pedidos estándar de depositantes con política de caja cerrada.
- **Blindaje de Reservas Multílote (P-01):** Transacciones atómicas de asignación con rollback automático ante inconsistencias, eliminando fallbacks con `Math.max(0)`.

#### 🚚 3. Despacho, Manifiesto, Kárdex y Portal Depositante (S-05 a S-11)
- **Corrección de Mapeo de Transporte (S-05):** Mapeo estricto de `vehiculoPlaca: 'TEST-001'` y chofer `Juan Manuel Prueba`. Reparación auditada en base de datos para `PED-2026-0007` en `AuditLog`. Eliminados sellos y fleteras ficticios por defecto.
- **Desglose Operativo del Manifiesto (S-07):** Endpoint `GET /orders/:id/dispatch-manifest` explota asignaciones en renglones operativos claros (Aceite 12 B01 HU 0001, Aceite 12 B02 HU 0004, Arroz 20 B02 HU 0011 = 44 piezas). Reglas `@media print` evitan recortes de fondos y partición de firmas.
- **Portal Depositante Post-Salida (S-08):** Eliminado badge erróneo de "Stock Reservado" en pedidos despachados; saldo reservado en 0 y distinción entre pedidos activos y pedidos con reserva real.
- **Consulta Histórica de HUs Despachadas (S-09):** Soporte en `GET /inventory/handling-units` y filtro en UI para consultar unidades despachadas y su rack de origen.
- **Trazabilidad Kárdex (S-10):** Desglose detallado de movimientos de salida con lote, HU, ubicación y referencia documental.

#### 🌐 4. Mejoras Transversales, Fechas y Erradicación de Emojis/Diálogos Nativos (T-01 a T-03, UX-03)
- **Fechas de Calendario Exactas (T-01):** Utilidad centralizada `dateUtils.ts` (`formatCalendarDate`) eliminando el desfase de zona horaria de -1 día (30/06/2027, 31/12/2027, 30/06/2028 y cita 02/10/2026 se muestran exactos).
- **Erradicación de Emojis e Iconografía Vectorial:** Sustitución completa de emojis genéricos por iconos SVG de Lucide React en portal depositante, kárdex, badges y prioridades.
- **Erradicación de Diálogos Nativos:** Sustitución de `alert()` y `confirm()` en `Clients.tsx`, `LabelPreview.tsx` y `CycleCount.tsx` por modales y banners corporativos.
- **Etiquetas Térmicas Industriales (E-03, E-04):** Estilos `@page` de 100x50 mm y 100x150 mm sin racks provisionales impresos y con indicación de caja parcial reacondicionada.
- **Archivos de Prueba Aislados (T-03):** Generados `Previo_Valido_GivingOut_2026.xlsx` y `Previo_Invalido_GivingOut_2026.xlsx` en `Downloads` con factura nueva `FAC-E2E-20261005-01` preservando intactos los datos de referencia `REC-2026-0009`, `REC-2026-0011` y `PED-2026-0007`.

---



### 🛡️ Blindaje de Reanudación de Picking (Fase 6), Persistencia Atómica por Parada Específica, Bloqueo de HU Duplicadas y Rediseño de Diálogos Corporativos

#### 🔍 1. Diagnóstico y Causa Raíz de Desalineación en Terminal Móvil
- **Desacople en Base de Datos y Reconstrucción Secuencial:**
  - En pedidos con un mismo SKU y lote dividido entre dos o más ubicaciones físicas (e.g. partida `ACE-OLI-1L` de `PED-2026-0007` con 12 piezas en `B01-R01-N1` y 12 piezas en `B02-R01-N1`), el arreglo `asignacionesJson` guardaba las asignaciones en un orden distinto al recorrido físico (e.g. `B02` en índice 0 y `B01` en índice 1).
  - Al completar el escaneo de la primera caja en `B01-R01-N1` (`BOX-REC-2026-0011-0001`), el endpoint `recordPick` actualizaba `cantidadPickeada = 12` en la cabecera de la línea, pero omitía actualizar el avance por objeto individual dentro de `asignacionesJson`.
  - Al cerrar y reabrir la terminal, la función `openTerminal` distribuía ingenuamente los 12 recolectados de forma secuencial en el arreglo (`forEach`), imputando los 12 al índice 0 (`B02-R01-N1`) y dejando el índice 1 (`B01-R01-N1`) en 0. Al aplicar el ordenamiento alfabético de racks (`localeCompare`), la pantalla mostraba la parada `B01-R01-N1` en cero y atribuía el avance al rack incorrecto `B02-R01-N1`.
- **Desincronización en Listado de Fondo:**
  - Al pausar o cerrar la terminal, el componente ejecutaba únicamente `setActiveOrder(null)` sin disparar `loadData()`, requiriendo pulsar "Actualizar" manualmente para refrescar las tarjetas de conteo.

#### 🛠️ 2. Persistencia Atómica por Parada Específica y Manejo Granular de HUs (`operations.controller.ts`)
- **Imputación Específica por Asignación:**
  - `POST /api/orders/:id/record-pick` ampliado para aceptar `taskUbicacionCodigo`, `taskLotId`, `taskCantidadPickeada`, `boxCode`/`cajaEscaneada` y `asignacionesActualizadas`.
  - Cada elemento del arreglo `asignacionesJson` almacena ahora su propio estado atómico: `{ cantidad, cantidadPickeada, cajasEscaneadas: [...], completo: boolean, fechaPicking, surtidor }`.
  - La imputación localiza la parada por coincidencia estricta de rack y lote, independizándola del orden interno del arreglo o de reordenamientos de ruta.
- **Bloqueo Global de Escaneo Duplicado de la Misma HU:**
  - En `validatePickingScan`, la validación de duplicados revisa exhaustivamente todo el pedido en base de datos (`orden.lineas.cajaEscaneada` y `asignacionesJson.cajasEscaneadas`).
  - Si una caja ya fue registrada previamente en cualquier parada o reanudación del pedido, se bloquea con rechazo explícito (`valid: false`), impidiendo dobles conteos por reintentos o reconexiones.
- **Guarda Cruzada (Cross-Rack Box Rejection):**
  - Estando posicionado en un rack asignado, el escaneo de cajas pertenecientes a otra ubicación física es bloqueado de inmediato, evitando mezclas involuntarias entre pasillos.

#### 📱 3. Terminal de Picking Reactiva y Determinista (`Picking.tsx`)
- **Reconstrucción Inmune a Ordenamiento:**
  - `openTerminal()` inicializa cada tarea leyendo directamente `alloc.cantidadPickeada` y `alloc.cajasEscaneadas`.
  - Posicionamiento automático en la primera parada incompleta (`firstPendingIdx`), enfocando directamente la parada activa pendiente al reanudar (`B02-R01-N1`).
- **Actualización Automática al Pausar o Cerrar:**
  - Se introdujo `closeTerminal()` que invoca `await loadData()` al cerrar la modal, manteniendo el listado de pedidos sincronizado en tiempo real.
  - Sincronización optimista en memoria al recolectar cada caja (`setOrders`), asegurando respuesta visual instantánea.

#### 🎨 4. Erradicación Integral de Diálogos Nativos y Emojis Genéricos (`Picking.tsx`)
- Sustitución completa de `window.alert`, `window.confirm` y `window.prompt` por modales integradas al diseño corporativo de Giving Out WMS:
  - **Modal de Toma de Pedido (`takeoverDialog`):** Confirmación para reasignación de surtidor en pedidos previamente tomados.
  - **Modal de Ajuste por Excepción (`adjustmentModal`):** Captura de cantidad ajustada con **motivo obligatorio (mínimo 5 caracteres)**, generando bitácora auditada en base de datos (`AuditLog` con acción `AJUSTE_EXCEPCION_PICKING`).
- Cero emojis genéricos; iconografía 100% vectorial con Lucide React.

#### 📊 5. Certificación E2E y Preservación Estricta de PED-2026-0007
- **Suite Automatizada con Datos Aislados (`test-suite-isolated-phase6-resumption.js`):**
  - Validación con cliente, SKUs, ubicaciones y lotes temporales independientes: **64 de 64 pruebas aprobadas (100%)**.
- **Preservación Intacta de PED-2026-0007:**
  - Estatus: `EN_PICKING`, Surtidor: `admin@givingout.com`.
  - Avance: exactamente `12/44` piezas recolectadas (27%), `1/3` paradas completadas.
  - Parada 1 (`B01-R01-N1`): Aceite `E2E-3009-ACE-A`: **12/12 piezas [COMPLETA]** (Caja `BOX-REC-2026-0011-0001`).
  - Parada 2 (`B02-R01-N1`): Arroz `E2E-3009-ARR-A`: **0/20 piezas [PENDIENTE]** (Parada activa al abrir la terminal).
  - Parada 3 (`B02-R01-N1`): Aceite `E2E-3009-ACE-A`: **0/12 piezas [PENDIENTE]**.
  - Reservas E2E intactas: 198 piezas físicas, 44 reservadas, 154 disponibles libres.
  - Bitácora de auditoría registrada: `RECONCILIACION_ASIGNACION_PICKING`.

---

## [1.9.0] — 2026-09-30

### 🚀 Implementación Integral de las Fases 5 y 6, Doble Validación en Picking, Despacho Legal con Firmas, Blindaje del Importador Excel y Documentación Oficial

#### 📦 1. Fase 5: Ciclo de Pedido, Soft Reservation Inmediata y Panel de Preparación FEFO/FIFO (`Dispatch.tsx`, `OrderPreparationModal.tsx` & `operations.controller.ts`)
- **Creación de Pedidos Retail / Depositante:** Soporte para pedidos destinados a clientes finales (e.g. *Walmart México CEDIS San Martín Obispo*) con captura de fecha compromiso, línea fletera y desglose de SKUs.
- **Soft Reservation Inmediata:** Al registrar la orden, el inventario libre (`cantidadDisponible`) en `LotInventory` se descuenta al instante (e.g. de 400 a 300 piezas), incrementando `cantidadReservada` y protegiendo la operación contra sobreventas concurrentes, manteniendo el stock físico en racks intacto (400 piezas).
- **Panel de Preparación para Supervisión (Alejandra):** Modal interactivo con motor de asignación asistida por algoritmo **FEFO** (prioridad a fechas de vencimiento próximas) o **FIFO**, y asignación manual granular con soporte de división de partidas (*split*) entre múltiples lotes y racks.
- **Flujo de Estados:** Transición auditada de `SOLICITADO` -> `APROBADO` -> `EN_PICKING`, registrando identificador del supervisor (`preparadoPor`) y marca temporal en base de datos.
- **Suite Automatizada:** Certificación E2E mediante `test-task-phase5-reservation-allocation.js` con **10 de 10 pruebas aprobadas (100%)**.

#### 📱 2. Fase 6: Terminal de Picking con Doble Validación por Escaneo y Despacho Físico (`Picking.tsx`, `DispatchManifestModal.tsx` & `operations.controller.ts`)
- **Regla Estricta: Un Pedido por Surtidor:** El primer operador que toma la orden sella su identificador en `SalesOrder.surtidor`. Si un segundo operador intenta acceder simultáneamente, el sistema bloquea la acción notificando la concurrencia y ofreciendo reasignación controlada.
- **Doble Validación Óptica por Escaneo Láser:**
  - *Validación 1 (Ubicación física):* Escaneo obligatorio del código de barras del rack (`B01-R01-N1`). Si el operador escanea un rack distinto al asignado, el sistema bloquea el conteo con alerta visual roja.
  - *Validación 2 (Caja física):* Escaneo individual del código Code-128 de la unidad de manejo (`HU-REC-XXXX-BOX-YYY`).
  - *Bloqueo contra cajas erróneas o duplicadas:* Endpoint `POST /api/orders/:id/validate-scan` rechaza bultos ya despachados, de otro producto o de lote no conforme (`valid: false`).
- **Consolidación Automática y Zona de Staging:** Al completar el surtido al 100%, la orden pasa a estado `CONSOLIDADO`, desvinculando digitalmente la mercancía del rack y trasladándola a la bahía de salida (*Staging* de rampa).
- **Manifiesto de Embarque y Acuse Formal de Salida:** Modal `DispatchManifestModal.tsx` con captura de transportista, chofer, placas del tracto/remolque, precinto fiscal de seguridad y **firmas digitales en canvas táctil** del despachador y chofer.
- **Descuento Físico Real y Cuadratura Contable:**
  - Al despachar (`POST /api/orders/:id/dispatch`), el stock físico en racks se reduce de 400 a 300 y la reserva se consume a 0.
  - **Fórmula de disponibilidad no redundante:** Se calcula `Físico (300) - Reservado (0) = 300`, garantizando que la disponibilidad no se descuente dos veces.
  - **Liberación Condicional de Racks:** La ubicación física sólo pasa a estado `LIBRE` si la suma de existencias de todos los productos y lotes en la posición llega a 0; si conserva stock de otro lote, permanece en `OCUPADA`.
  - Actualización de cajas a estado `DESPACHADO`, registro en `InventoryMovement` (`SALIDA_ALMACEN`) y bitácora en `AuditLog`.
- **Suite Automatizada:** Certificación E2E mediante `test-task-phase6-picking-dispatch.js` con **10 de 10 pruebas aprobadas (100%)**.

#### 🛡️ 3. Blindaje del Importador de Excel y Prevención de Guardado Parcial (`Receiving.tsx` & `operations.controller.ts`)
- **Bloqueo Estricto por Códigos Inexistentes en Catálogo:**
  - *En Backend (`POST /api/receipts/previo`):* Si el archivo contiene códigos de producto no registrados (`skusInexistentes.length > 0`), el controlador aborta inmediatamente respondiendo con `HTTP 400 Bad Request` (`codigo: 'SKUS_INEXISTENTES_DETECTADOS'`), impidiendo terminantemente la creación parcial de previos o registros incompletos.
  - *En Frontend (`Receiving.tsx`):* El motor de análisis en cliente detecta códigos sin coincidencia, muestra la tarjeta roja de alerta (*"No Registrados: X"*), resalta la fila en la tabla de previsualización con la insignia roja `[X] No Existe en Catálogo` y bloquea el botón de envío con mensaje de seguridad.
- **Integridad Matemática en Importación de Unidades y Empaques:**
  - La columna `Cantidad a recibir` de la plantilla oficial importa **piezas totales** (`uomBase = 'PZA'`).
  - El sistema calcula de forma unívoca los bultos/cajas esperadas dividiendo las piezas entre `capacidadEmpaque` del catálogo (12 piezas/caja para aceite y 20 piezas/caja para arroz).
  - Previene interpretaciones erróneas donde una caja se tome como 1 pieza o se multiplique dos veces en rampa.
- **Archivos de Prueba Generados en Descargas:**
  - `Prueba_Integral_AlimNorte.xlsx` (17,760 bytes): 15 cajas, 220 piezas, 3 partidas (`ACE-OLI-1L` lote A y B, y `ARR-BLA-1K`) con factura `FAC-E2E-20260930-01`.
  - `Prueba_Bloqueo_SKU_AlimNorte.xlsx` (17,774 bytes): Factura `FAC-E2E-20260930-INV` con `SKU-NO-EXISTE-E2E` para certificar el bloqueo estricto en pruebas manuales.
  - Verificado con test dry-run sin alterar inventario ni crear recepciones (0 previos creados, preservando intacto el histórico `REC-2026-0009`).

#### 📄 4. Suite Documental Oficial en PDF de Alta Resolución (ReportLab)
- **Manual Operativo Integral de las Seis Fases (`Manual_Operativo_6_Fases_Giving_Out_WMS.pdf`, 6 Páginas):**
  - Condensa roles, pantallas, botones, requisitos, flujo de estados, impacto en inventario, documentos emitidos, bitácora de auditoría, respuesta analítica a los 8 puntos críticos de negocio y guía de certificación E2E.
- **Documento 1: Resumen Operativo de las Seis Fases y Reglas de Negocio (`Resumen_Operativo_6_Fases_Giving_Out.pdf`, 4 Páginas):**
  - Fichas técnicas de las fases 1 a 6 y matemática de inventario acordada con Alejandra y Jonathan.
- **Documento 2: Guía de Certificación Manual E2E — Previo REC-2026-0010 (`Guia_Manual_E2E_Prueba_REC-2026-0010.pdf`, 3 Páginas):**
  - Protocolo paso a paso desde cero con nuevo folio `REC-2026-0010`, cubriendo el Happy Path y los 7 escenarios de error obligatorios (faltante en rampa, daño exterior con rescate parcial de piezas, reimpresión sin duplicidad, bloqueo anti-sobreventas, bloqueo de concurrencia y doble validación por escaneo).
- **Archivos exportados:** Guardados en `C:\Users\Mariana\Downloads`, en `docs/` y en el repositorio de artefactos.

#### 🎨 5. Políticas de Calidad y Cero Emojis Genéricos
- Cero emojis genéricos en código, vistas, modales y reportes (iconografía profesional 100% SVG con `lucide-react`).
- Compilación limpia: Backend NestJS (0 errores) y Frontend Vite (0 errores).

---

## [1.8.4] — 2026-09-29

### 📊 Auditoría Integral, Reconciliación Físico-Analítica y Rediseño del Reporte Oficial de Recepción (`ReceiptReportModal.tsx` & `operations.controller.ts`)

#### 🔍 Diagnóstico y Requerimientos de Corrección Operativa
1. **Confusión Crítica entre Bultos/Cajas y Piezas de Venta:**
   - La versión previa presentaba ambigüedad en los totales al colapsar las unidades de venta con las cajas físicas, llegando a mostrar erróneamente *"42 cajas máster"* en lugar de 3 cajas contenedoras con 42 piezas conformes.
2. **Atribución Injusta de Faltante al Transportista:**
   - En una de las vistas, las 2 piezas dañadas durante el flete se presentaban como faltante de transporte (`2 Faltantes`), cuando el transportista entregó físicamente la totalidad de las 44 piezas requeridas (3 bultos completos).
3. **Ausencia de Columnas Críticas en el Detalle por SKU:**
   - El desglose analítico carecía de una separación estricta entre mercancía retenida en cuarentena (pendiente de dictamen técnico) y merma destructiva definitiva, faltando columnas clave para auditoría fiscal y de depositante.
4. **Riesgo de Duplicación en Rescate de Mercancía:**
   - Al reflejar el rescate de las 10 piezas de aceite recuperadas de la caja dañada (`BOX-REC-2026-0009-0002-DANO`), existía el riesgo de sumarlas doblemente al stock general disponible.
5. **Mezcla entre Acta de Descarga en Rampa e Inspección Interna:**
   - El acta de rampa y el informe técnico de calidad aparecían mezclados, atribuyendo al chofer la validación técnica interna de producto e indicando indebidamente *"Entregó de conformidad"* a pesar de que el acta registraba reservas por 1 bulto con daño exterior.
6. **Discrepancia de Marcas y Campos Ajenos (Referencia PROVA):**
   - El reporte heredaba campos ficticios basados en formatos de devolución de PROVA (e.g., *"Sucursal N1050001"*, *"Folio 18966"* o *"Bandeja azul"*), en lugar de reflejar la identidad nativa de Giving Out WMS y datos 100% reales.

---

#### 🛠️ Correcciones Implementadas
1. **Separación Estricta entre Bultos Físicos y Unidades de Venta (Requisito 1):**
   - **Nivel 1 (Balance de Bultos / Embalajes):** 3 Cajas máster descargadas en 1 tarima pallet máster (`PLT-REC-2026-0009-01`). Almacenadas en racks: 3 cajas activas (`BOX-0001`, `BOX-0003`, `BOX-0004`). Faltante de bultos: 0 cajas.
   - **Nivel 2 (Balance de Piezas / Unidades de Venta):** 44 piezas esperadas, 44 piezas recibidas físicamente. Tras inspección técnica: **42 conformes disponibles en racks** y **2 piezas de merma**. Se erradicó terminantemente cualquier leyenda de *"42 cajas máster"*.
2. **Conciliación Total de Vistas y 0 Faltantes de Transporte (Requisito 2):**
   - El balance de transporte certifica **0 Faltantes de Transporte**. Las 2 piezas no conformes corresponden exclusivamente a merma destructiva dictaminada en inspección de calidad sobre el SKU `ACE-OLI-1L`. Ambas vistas concilian con 0 discrepancias de entrega.
3. **Detalle Analítico por SKU con las 10 Columnas Obligatorias (Requisito 3):**
   - Matriz analítica estructurada con:
     1. `SKU` (`ARR-BLA-1K`, `ACE-OLI-1L`)
     2. `Descripción` (`Arroz Blanco Grano Largo 1Kg`, `Aceite de Oliva Extra Virgen 1L`)
     3. `Lote` (`LOT-PRUEBA-ARROZ-02`, `LOT-PRUEBA-OLIVA-01`)
     4. `Caducidad` (`2029-06-30`, `2028-12-31`)
     5. `Esperadas` (20 / 24, Total: 44)
     6. `Recibidas` (20 / 24, Total: 44)
     7. `Conformes` (20 / 22, Total: 42)
     8. `Retenidas / Cuarentena` (0 / 0, Total: 0)
     9. `Merma Definitiva` (0 / 2, Total: 2)
     10. `Faltantes` (0 / 0, Total: 0)
4. **Trazabilidad de Rescate sin Duplicidad (Requisito 4):**
   - De la caja dañada `BOX-REC-2026-0009-0002-DANO` (12 piezas de aceite):
     - **10 piezas rescatadas al 100%:** reempacadas en nueva caja máster `BOX-REC-2026-0009-0004` (alojada en rack `B01-R03-N1`).
     - **2 piezas de merma destructiva:** enviadas al almacén virtual `MERMA-01`.
     - **Cláusula de Conciliación Inmutable:** Se estipula que las 10 piezas ya forman parte de las 22 conformes del SKU y de las 42 conformes totales disponibles en racks; no se duplican ni se suman doblemente al stock.
5. **Segregación Documental entre Acta de Rampa e Informe de Calidad (Requisito 5):**
   - **Sección I (Acta de Entrega en Rampa):** Certifica la descarga exterior de 3 bultos con badge `ENTREGADO CON RESERVAS EN RAMPA (1 Bulto Dañado)`.
   - Se eliminó cualquier etiqueta de "Entregó de conformidad".
   - Deslinde legal explícito: la firma del chofer únicamente valida el conteo exterior de bultos y reservas físicas, quedando sujeta a la revisión interna posterior.
6. **Responsables Reales, Firmas Táctiles en Canvas y Trazabilidad Temporal Local (Requisito 6):**
   - Operador transportista: `Juan Carlos Prueba` (Transportes Prueba, Placas `TEST-888-MX`, Camión 3.5 Ton). Liberación en rampa: `29/09/2026 02:18:00`.
   - Receptor en rampa: `Jonathan Palacios`.
   - Inspector de calidad y putaway: `Jonathan Palacios` (Folio `INSP-2026-0001`, Inspección: `29/09/2026 13:25:36`, Alojamiento en racks: `29/09/2026 17:34:11` / `23:34:11`).
   - Emisión del reporte: Fecha y hora local actual (`es-MX`).
   - Se recuperaron y renderizan las firmas táctiles reales en Base64 capturadas en el canvas durante el acuse de rampa. Se erradicó el uso de usuarios inventados o "Sistema".
7. **Marca Institucional Giving Out WMS y Embalajes Reales (Requisito 7):**
   - Giving Out WMS 360° (*Operador Logístico 3PL · Almacenamiento & Distribución*) establecido como marca predeterminada, con embalajes industriales reales (`Caja máster`, `Tarima Pallet Master`) y folio de transporte `REC-2026-0009`.
8. **Selector de Triple Vista en Pantalla y Soporte de Impresión Integral:**
   - Selector en barra superior:
     - `Vista 1: Bultos y Racks`: Manifiesto de bultos 1:1 y sus posiciones activas en racks (`B01-R01-N1`, `B01-R02-N1`, `B01-R03-N1`).
     - `Vista 2: Detalle SKU`: Desglose analítico de 10 columnas por producto.
     - `Ambas Vistas (Vista Consolidada)`: Despliega ambas vistas consecutivas para revisión simultánea e impresión en un solo documento oficial.
   - Formato de impresión y exportación PDF optimizado para hoja carta vertical (*Letter Portrait*), aislado, con código de barras Code-128, firmas y aviso legal.
9. **Resiliencia en Endpoints de Backend (`operations.controller.ts`):**
   - Se actualizaron los endpoints `GET /api/receipts/:id/report`, `GET /api/receipts/:id/acuse-rampa`, `GET /api/receipts/:id/labels`, y `GET /api/receipts/:id/inspection/report` para admitir indistintamente tanto el UUID interno como el código de folio (`REC-2026-0009`) con condición `OR: [{ id: receiptId }, { codigo: receiptId }]`.

---

#### 🧪 Verificación Realizada
- **Compilación de Producción:** `npm run build` en `wms-frontend` (`tsc -b && vite build`) completado con código 0 y 0 errores.
- **Endpoints de Backend:** Verificados con respuesta HTTP 200 en `/report`, `/acuse-rampa`, `/inspection/report` y `/labels`.
- **Conciliación de Datos:**
  - `totalEsperado: 44`, `totalRecibido: 44`, `totalConforme: 42`, `totalMerma: 2`, `totalFaltante: 0`.
  - `bultosDeclarados: 3`, `bultosRecibidos: 3`, `bultosDanados: 1`, `diferenciaBultos: 0`.
  - 3 Cajas físicas activas en racks y 1 tarima pallet master asignada.

---

## [1.8.3] — 2026-09-29

### 🖨️ Rediseño de Impresión Térmica Industrial, Formatos Físicos y Control Secuencial Estricto de Doble Etiquetado (`DualLabelModal.tsx` & `operations.controller.ts`)

#### 🔍 Diagnóstico y Causa Raíz
1. **Recorte Físico y Compresión en Etiquetas de Caja (100×50 mm):**
   - El diseño anterior dividía la etiqueta de 100×50 mm en dos columnas estrechas (~45 mm cada una). La columna izquierda comprimía 6 renglones de metadatos (descripción, lote, caducidad, factura, tarima matriz y aviso de inspección) provocando que con `overflow: hidden` se truncaran la fecha de caducidad y el pie.
   - En la columna derecha, el código de barras Code-128 para identificadores de 27 caracteres como `BOX-REC-2026-0009-0002-DANO` se configuraba con `width: 1.4` (módulo de 1.4 px), generando un ancho de ~130 mm en una caja de `max-width: 48mm`. El navegador comprimía severamente las barras o las recortaba, haciéndolas ilegibles para lectores ópticos y desbordando la página.
2. **Deficiencia de Formato en Tarima Master (100×150 mm vs 100×50 mm):**
   - La tarima master se imprimía bajo la misma regla CSS `@page { size: 100mm 50mm; }` que las cajas, truncando el manifiesto logístico. Carecía de tabla de desglose real por SKU/lote (esta tarima contiene `ACE-OLI-1L` y `ARR-BLA-1K` con dos lotes diferenciados) y no especificaba el balance de cajas conformes (2) vs retenidas por daño exterior (1).
3. **Violación de Secuencia Operativa (Impresión vs Colocación):**
   - Al pulsar cualquier botón de imprimir, el frontend invocaba inmediatamente `POST /api/receipts/:id/labels/print`, cambiando el estado a `IMPRESAS` antes de que el operador viera o confirmara las etiquetas físicas en su equipo.
   - La sección *«Confirmar Colocación Física»* aparecía habilitada desde el estado `GENERADAS`, permitiendo registrar la colocación en andén sin haber emitido las etiquetas. Tampoco existía validación en el controlador de backend para impedirlo.

---

#### 🛠️ Correcciones Implementadas
1. **Rediseño Industrial de Etiquetas de Caja (100 mm × 50 mm):**
   - **Distribución Horizontal Apilada:** Se erradicó la división en dos columnas estrechas. Los metadatos aprovechan los 94 mm de ancho útil:
     - Encabezado: `GIVING OUT • ETIQUETA DE CAJA ÚNICA`, previo `REC-2026-0009` y factura `FAC-PRUEBA-FASE1-001`.
     - Identidad: SKU destacado (`11pt` negrita), empaque (`12 PZAS / CAJA` o `20 PZAS / CAJA`), ID único de caja y tarima matriz (`PLT-REC-2026-0009-01`).
     - Descripción completa de producto en renglón completo sin truncamiento (`Aceite de Oliva Extra Virgen 1L` / `Arroz Blanco Grano Largo 1Kg`).
     - Metadatos transversales: Lote, Caducidad (`2028-12-31`, `2029-06-30`) y Condición física.
     - Código de barras Code-128 ancho completo centrado: configurado con `width: 0.95`, `height: 25`, `displayValue: true`, `fontSize: 8.5`, fuente monospace negrita y márgenes de zona silenciosa. Escaneable sin cortes.
     - Pie logístico sin rack fijo: *“CONTROL UNITARIO DE TRAZABILIDAD • SIN POSICIÓN RACK PERMANENTE HASTA PUTAWAY”*.
2. **Etiqueta Especial para Caja con Daño Exterior (`BOX-REC-2026-0009-0002-DANO`):**
   - **Borde Doble Grueso de Alto Contraste (`border: 3.5px double #000`):** Reconocible al instante en impresoras térmicas monocromáticas de blanco y negro puro.
   - **Banner Superior Invertido (Fondo Negro / Letra Blanca):**
     *“⚠️ DAÑO EXTERIOR — RETENIDA PARA INSPECCIÓN / RESCATE”* con subtítulo *“NO REPRESENTA MERMA DEFINITIVA • NO DISPONIBLE PARA VENTA”*.
   - **Datos Completos y Trazabilidad:** Conserva su ID único `BOX-REC-2026-0009-0002-DANO`, SKU `ACE-OLI-1L`, lote `LOT-PRUEBA-OLIVA-01`, caducidad `2028-12-31`, 12 piezas, previo y factura.
   - **Pie de Retención Preventiva:** *“MERCANCÍA RETENIDA • PENDIENTE DE DICTAMEN DE CALIDAD • NO UBICAR EN RACK GENERAL”*.
3. **Etiqueta Master de Tarima (100 mm × 150 mm / 4" × 6"):**
   - Depositante oficial: `AlimNorte`, ID de tarima: `PLT-REC-2026-0009-01`, previo `REC-2026-0009`, factura `FAC-PRUEBA-FASE1-001`, rampa `Rampa 1`.
   - Balance físico destacado: `TOTAL: 3 CAJAS FÍSICAS (44 Piezas) • [✓ 2 CAJAS CONFORMES] • [⚠️ 1 CAJA RETENIDA POR DAÑO EXTERIOR]`.
   - **Manifiesto Real de Contenido por SKU / Lote:** Tabla estructurada que desglosa de manera fidedigna los 2 SKUs y 2 lotes reales:
     - `ACE-OLI-1L` | `LOT-PRUEBA-OLIVA-01` | Cad `2028-12-31` | 1 Conf + 1 Daño | 2 cajas (24 pz).
     - `ARR-BLA-1K` | `LOT-PRUEBA-ARROZ-02` | Cad `2029-06-30` | 1 Conforme | 1 caja (20 pz).
     - Erradicación de cualquier lote único ficticio para la tarima mixta.
   - Código QR 2D con zona silenciosa (`margin: 2`, `32×32 mm`), decodificable con JSON del manifiesto completo.
   - Banner de advertencia por segregación de caja dañada en andén y pie sin asignación de rack fija.
4. **Tiradas de Impresión Separadas por Tipo de Papel:**
   - La barra de acciones ofrece ahora 3 botones con especificación explícita de tamaño físico:
     - `🏷️ Imprimir Cajas (100×50 mm) [3]`
     - `📦 Imprimir Tarima (100×150 mm) [1]`
     - `🖨️ Lote Completo (4)`
   - Reglas CSS `@page` dinámicas: `@page { size: 100mm 50mm; margin: 0; }` para cajas y `@page { size: 100mm 150mm; margin: 0; }` para tarimas, evitando desconfiguraciones del rollo térmico.
   - Barra superior en pantalla (`.no-print`) con botones para disparar el diálogo del sistema o cerrar la ventana.
5. **Control Secuencial Estricto (Impresión vs Colocación):**
   - **Distinción entre Solicitud y Confirmación:** Al abrir la ventana de impresión, NO se llama a la API ni se avanza a `IMPRESAS`. Se presenta una tarjeta interactiva en el modal:
     *“Confirmación de Emisión Física del Operador: Se abrió la ventana de impresión térmica. Compruebe físicamente en su equipo que las etiquetas salieron legibles, completas y sin códigos cortados.”*
     Con opciones para confirmar, reabrir o descartar.
   - **Bloqueo de Colocación Física:**
     - En Frontend: Mientras el ciclo esté en `GENERADAS`, la sección de colocación física se muestra bloqueada con icono de reloj y mensaje explicativo: *“Paso 3 Bloqueado: Imprima y confirme las etiquetas físicas (Paso 2) antes de registrar la colocación.”*
     - En Backend (`operations.controller.ts`): En el endpoint `POST /api/receipts/:id/labels/confirm-placement`, se añadió validación que arroja HTTP 400 (`BadRequestException`) si `etiquetasEstado !== 'IMPRESAS' && etiquetasEstado !== 'COLOCADAS'`.
   - **Cero Activación de Stock:** Ni la impresión ni la confirmación de colocación activan stock disponible para venta ni alteran la ubicación física (`RAMPA_RECEPCION`).
6. **Diagnóstico y Restablecimiento de Base de Datos para REC-2026-0009:**
   - Se diagnosticó que en la prueba previa del usuario, al abrir la impresión, el sistema anterior había registrado automáticamente el estado `IMPRESAS`.
   - Se ejecutó script de restablecimiento (`scratch/reset-labels-state.js`) devolviendo limpiamente el folio `REC-2026-0009` y sus 4 HUs al estado `GENERADAS` (`estadoEtiqueta: 'GENERADA'`, `etiquetaImpresa: false`).
   - Se preservaron íntegramente los folios y UUIDs (`deb1808b...`, `03ce5145...`, `26f72234...`, `3d309e7f...`), sin duplicación de bultos ni avance de etapas.

---

#### 🧪 Verificación Realizada
- **Verificación de Decodificación de Códigos:**
  - Code-128 con `JsBarcode` (versión binaria completa): `BOX-REC-2026-0009-0001`, `BOX-REC-2026-0009-0002-DANO`, `BOX-REC-2026-0009-0003` validados con longitud binaria de 266 a 332 bits, renderizados a ancho completo con `width: 0.95`.
  - QR Code 2D con `qrcode`: Payload JSON del manifiesto decodificado y validado con los 2 SKUs y lotes reales.
- **Compilación de Producción:** `npm run build` en `wms-frontend` (`tsc -b && vite build`) completado con código 0 y 0 errores de tipado.
- **Compilación Backend:** NestJS dev server activo en modo watch con 0 errores (`Found 0 errors. Watching for file changes`).
- **Estado Actual de BD:** `REC-2026-0009` en `etiquetasEstado: 'GENERADAS'`, listo para repetir la prueba manual del usuario.

---

## [1.8.2] — 2026-09-29

### 🏷️ Corrección y Sincronización Integral de Doble Etiquetado (`DualLabelModal.tsx` & `operations.controller.ts`)

#### 🔍 Diagnóstico y Causa Raíz
1. **Desajuste de Nomenclatura en la Respuesta de API vs Frontend:**
   - En el backend (`getReceiptLabels` y `generateLabels`), cada tarima se enriquecía con la propiedad `cajas: cajasHijas` (en español), mientras que en el frontend `DualLabelModal.tsx` se leía `p.boxes` (en inglés). Por ello, `allBoxes` quedaba vacío (`[]`), y al pulsar *«Ver 3 Cajas Contenidas»*, `filteredBoxes` resultaba vacío mostrando *“No hay cajas disponibles para el filtro seleccionado”*.
   - El backend devolvía los SKUs agrupados en `skusDesglose: Record<string, ...>`, mientras que la tarjeta de tarima esperaba `plt.skus` como array de strings, resultando en `SKUs en Pallet: N/A`.
   - Los contadores de cajas y tarimas en la raíz se enviaban como `totales: { cajas, pallets, unidades }`, pero el frontend leía `labelsData?.totalBoxes` y `labelsData?.totalPallets`, provocando que las pestañas y el botón de impresión mostrasen `0 Cajas` y `0 Tarimas` y se deshabilitara la acción de impresión.
2. **Defecto del Cero Inicial en Campos de Desglose:**
   - Los campos de desglose de partidas físicas usaban `type="number"` con `parseInt(e.target.value) || 0`, lo que impedía borrar el cero inicial y convertía la pulsación de `1` en `01`.
3. **Persistencia del Desglose Físico al Cerrar/Reabrir el Modal:**
   - Al cerrar y reabrir el modal, `DualLabelModal.tsx` recalculaba el desglose desde `receipt.lineas` en lugar de sincronizar las cajas físicas ya generadas y clasificadas en la base de datos (conforme vs dañada).

#### 🛠️ Correcciones Implementadas
1. **Normalización y Enriquecimiento de API (`operations.controller.ts`):**
   - Se enriquecieron tanto la respuesta de consulta (`GET /api/receipts/:id/labels`) como la generación idempotente (`POST /api/receipts/:id/generate-labels`) con soporte bilingüe y propiedades consolidadas:
     - `pallets[i].boxes` y `pallets[i].cajas` (con las cajas hijas vinculadas por `parentHuId`).
     - `pallets[i].skus` (array con los códigos de SKU contenidos, e.g. `['ACE-OLI-1L', 'ARR-BLA-1K']`).
     - `totalBoxes` y `totalPallets` expuestos en la raíz y en el objeto `totales`.
     - `boxes` y `cajas` expuestos en la raíz de la respuesta.
2. **Resiliencia de Filtrado y Contadores en Frontend (`DualLabelModal.tsx`):**
   - Construcción defensiva de `allBoxes`: extrae cajas de `p.boxes || p.cajas` de cada tarima y tiene fallback a `labelsData.cajas || labelsData.boxes`.
   - Lectura segura de contadores: `totalBoxesCount` y `totalPalletsCount` unifican `labelsData?.totalBoxes`, `labelsData?.totales?.cajas` y `allBoxes.length`.
   - La tarjeta de Tarima Master ahora proyecta `SKUs en Pallet: ACE-OLI-1L, ARR-BLA-1K` evaluando tanto `plt.skus` como `Object.keys(plt.skusDesglose)`.
   - El botón *«Ver 3 Cajas Contenidas»* activa el filtro de tarima matriz y despliega de inmediato la tabla con las 3 cajas asociadas:
     - `BOX-REC-2026-0009-0001`: Aceite de Oliva 1L, Lote `LOT-PRUEBA-OLIVA-01`, Caducidad `2028-12-31`, 12 piezas, Condición Conforme.
     - `BOX-REC-2026-0009-0002-DANO`: Aceite de Oliva 1L, Lote `LOT-PRUEBA-OLIVA-01`, Caducidad `2028-12-31`, 12 piezas, Condición Daño Exterior (retenida en empaque, pendiente de inspección y rescate técnico en Fase 2, sin merma definitiva ni disponibilidad para venta).
     - `BOX-REC-2026-0009-0003`: Arroz Blanco 1Kg, Lote `LOT-PRUEBA-ARROZ-02`, Caducidad `2029-06-30`, 20 piezas, Condición Conforme.
3. **Solución a la Edición Numérica (Cero Inicial):**
   - Sustitución de `type="number"` por `type="text"` con `inputMode="numeric"`, `onFocus={(e) => e.target.select()}`, `handleBreakdownInputChange` y `handleBreakdownInputBlur`. El usuario puede seleccionar o borrar el cero de inmediato y escribir cantidades limpiamente sin que se forme `01`.
4. **Sincronización Permanente al Reabrir el Modal:**
   - En `fetchLabels`, si ya existen cajas generadas en base de datos para el previo, se sincroniza automáticamente el estado de `breakdown` contando las cajas conformes y dañadas reales por partida, manteniendo intacta la clasificación (Aceite: 1 conf + 1 dañ; Arroz: 1 conf + 0 dañ; Total 3 físico, Cuadrado con Acta de Rampa).
5. **Protección de Mercancía Dañada y Tarima Master:**
   - La caja averiada mantiene su `estadoHu = 'DAÑADO'`. Al ingresar al inventario queda asignada a `CUARENTENA` con `cantidadBloqueada: 12` y `cantidadDisponible: 0`. Ningún movimiento o reubicación de la tarima padre altera el estatus de la caja dañada ni libera unidades vendibles.
   - Preservación estricta de registros: se respetaron íntegramente los folios y UUIDs existentes (`deb1808b...`, `03ce5145...`, `26f72234...`, `3d309e7f...`) sin duplicar tarimas ni cajas en reintentos.

#### 🧪 Verificación Realizada
- **Suite Automatizada (`scratch/test-double-label-verification.js`):**
  - Consulta `GET /api/receipts/:id/labels`: validado status 200, 3 cajas en raíz y en tarima, 1 tarima, array de SKUs `['ACE-OLI-1L', 'ARR-BLA-1K']`, caja dañada identificada con 12 piezas y `estadoHu: 'DAÑADO'`.
  - Idempotencia `POST /api/receipts/:id/generate-labels`: validado `yaGeneradas: true`, preservación estricta de IDs existentes sin duplicación.
- **Compilaciones Limpias:** `npm run build` en `wms-frontend` (código 0, 0 errores) y `wms-backend` (código 0, 0 errores).
- **Servidores Locales en Vivo:** Backend activo en `http://localhost:3001` y Frontend activo en `http://localhost:5173`.

---

## [1.8.1] — 2026-09-29

### 🚚 Corrección de Integridad de Datos en Acta Oficial de Entrada en Rampa (`RampDocumentModal.tsx` & `operations.controller.ts`)

#### 🔍 Diagnóstico y Causa Raíz
- **Desalineación de Esquema entre Backend y Frontend:** El endpoint `GET /api/receipts/:id/acuse-rampa` devolvía claves canónicas (`cliente: "AlimNorte"`, `transporte.linea`, `transporte.chofer`, `transporte.unidad`, `conteoExterior.declarados`, `firmas.chofer`, `firmas.leyendaChofer`, `avisoLegal`), mientras que el componente `RampDocumentModal.tsx` intentaba leer propiedades anidadas incompatibles (`data.cliente.nombreComercial`, `transporte.lineaTransporte`, `conteoRampa.bultosDeclarados`, `firmas.firmaChofer`, `estadoRampa.leyendaLegal`).
- **Consecuencias Detectadas en Prueba Manual (REC-2026-0009):** Varios campos aparecían vacíos, el depositante se mostraba genérico como *"Cliente"*, el balance de bultos caía al fallback `0/0/0` con falso *"Faltante"*, las firmas guardadas aparecían como *"Sin firma digital"*, la cláusula de deslinde estaba en blanco, y las etiquetas de auditoría no recuperaban los valores previos ni rectificados.

#### 🛠️ Correcciones Implementadas
1. **Enriquecimiento y Alias de Compatibilidad en Backend (`operations.controller.ts`):**
   - Provisión simultánea de nombres canónicos y alias (`cliente`, `clienteNombre`, `clienteObj`; `linea` y `lineaTransporte`; `chofer` y `nombreChofer`; `unidad` y `capacidadCarga`; `conteoExterior` y `conteoRampa`; `firmas.chofer` y `firmas.firmaChofer`; `avisoLegal` y `alcanceActa`).
   - Conservación íntegra de la condición `CON_RESERVAS` y leyenda legal del transportista ante presencia de bultos con daño exterior, aun cuando la diferencia cuantitativa neta sea 0.
2. **Proyección Documental Exhaustiva en Frontend (`RampDocumentModal.tsx`):**
   - **Datos Generales:** Mapeo directo y visible de AlimNorte, Transportes Prueba, Juan Carlos Prueba, placas TEST-888-MX, capacidad CAMION 3.5 TON, Rampa 1 y receptor Jonathan Palacios.
   - **Balance Físico de Bultos:** Despliegue fidedigno de 3 declarados, 3 recibidos, 1 con daño exterior y diferencia 0 (`0 · Cuadrado con Daño`). Preservación del banner destacado de condición `CON RESERVAS` por daño físico en descarga. Erradicación de conversión de datos ausentes en ceros ficticios.
   - **Firmas Digitales y Leyendas:** Renderizado nítido de las 2 firmas en Base64 (`img`), sello legal dinámico del transportista (*«Entregó con reservas y discrepancias asentadas»*), sello del receptor (*«Recibió en andén y atestiguó conteo exterior»*) y nota textual de observaciones de rampa (*“Se recibieron 3 cajas en total; 1 presenta daño exterior en empaque”*).
   - **Alcance Legal del Acta:** Inclusión de la sección formal *«Alcance del Acta & Dictamen Posterior (Revisión Exterior en Rampa)»* que estipula formalmente que el documento ampara únicamente el conteo físico exterior para la liberación del transporte, quedando sujeto a la inspección interna a detalle pieza por pieza, verificación de lotes, caducidades y dictamen de calidad posterior.
   - **Fechas e Historial de Auditoría:** Identificación clara y por separado de la *Fecha y Hora de Liberación en Rampa* (fecha real guardada) y la *Fecha de Emisión / Impresión*. Reconstrucción de la bitácora de rectificaciones recuperando `valoresAnteriores` y `valoresNuevos` reales por evento sin etiquetas vacías ni datos inventados.
   - **Formato y Hoja Carta:** Eliminación del desbordamiento horizontal (`overflow-x: hidden`, `minmax(0, 1fr)` en grids, `table-layout: fixed`), diseño responsivo en vista previa (840px) y calibración para impresión en hoja Carta portrait (`@page { size: letter portrait; margin: 8mm 10mm; }`).
   - **Control Defensivo de Carga:** Si la llamada al API falla o responde con error, el modal despliega una tarjeta de error descriptiva con botón de reintento y bloquea la opción de impresión para evitar emitir actas incompletas.

#### 🧪 Certificación Automatizada de Regresión
- **Suite Oficial (`test-regression-acuse-rampa.js`):** **28 de 28 pruebas aprobadas al 100% (0 fallidas)** validando la integridad de datos guardados en Supabase PostgreSQL vs proyección en el acuse de rampa.
- **Compilaciones:** `wms-frontend` (`built in 38.67s`, 0 errores) y `wms-backend` (0 errores).

---

## [1.8.0] — 2026-09-28

### 🚚 Fase 1: Acta de Entrada en Rampa, Doble Etiquetado Giving Out y Blindaje de Conectividad

#### 📝 Pilar 1: Acta de Entrada en Rampa & Liberación de Chofer Exprés (`RampArrivalModal.tsx` & `RampDocumentModal.tsx`)
- **Captura de Balance Físico de Bultos en Rampa:**
  - Balance en tiempo real: *Bultos Declarados*, *Bultos Recibidos* y *Bultos con Daño Exterior*.
  - Fórmula estricta de variación: `recibidos - declarados`.
  - Validación rigurosa: los bultos con daño exterior son un subconjunto menor o igual a los recibidos; cantidades obligatorias enteras y no negativas.
- **Solución al Cero Inicial en Campos de Captura:**
  - Sustitución de inputs numéricos rígidos por manejo reactivo con `handleBultosChange` (`type="text"` con `inputMode="numeric"`), permitiendo vaciar el campo mientras se edita sin que se anteponga un cero (`01`, `02`).
- **Firmas Digitales Vectorizadas & Resiliencia de Guardado:**
  - Captura dual de firmas mediante canvas táctil/mouse para Chofer de la unidad y Receptor de andén.
  - Sello legal dinámico del transportista: conmuta automáticamente entre *«Entregó carga conforme (revisión exterior)»* y *«Entregó con reservas y discrepancias asentadas»* ante cualquier diferencia o daño.
  - Incorporado `AbortController` con timeout de 20s para erradicar bloqueos de UI en *"Procesando..."*. En caso de error o lentitud de red, se muestra mensaje claro y **se preservan intactos el 100% de los datos y firmas capturados** para reintentar con 1 clic.
  - Conmutación automática del modal a estado local reactivo (`activeReceipt`), desplegando la insignia *«Chofer Liberado ✓»* y acceso directo a *«Abrir Acta Imprimible»*.
- **Historial Inmutable de Auditoría & Modo Corrección Posterior:**
  - Si un folio liberado requiere rectificación física o documental, el sistema exige justificación obligatoria (`motivoCorreccion >= 5 chars`) y archiva la versión anterior en `historialCorreccionesRampa` con fecha, usuario y valores previos sin sobrescritura destructiva.
- **Acta Oficial Imprimible de Rampa (`RampDocumentModal.tsx`):**
  - Generación de acuse formal con código de barras Code-128 del folio de transporte, resumen de bultos, sellos, firmas digitales renderizadas y aviso legal de revisión exterior.

#### 🏷️ Pilar 3: Doble Etiquetado Industrial Giving Out (`DualLabelModal.tsx` & `operations.controller.ts`)
- **Generación Idempotente de 2 Niveles:**
  - **Tarima Master (HandlingUnit tipo PALLET):** Código único con código QR 2D que consolida desglose de cajas, SKUs, factura de respaldo y lotes.
  - **Cajas Únicas (HandlingUnit tipo CAJA):** Código de barras Code-128 individual con ID irrepetible, SKU, descripción, lote, fecha de vencimiento y factura, **sin quemar ubicación física de rack en la etiqueta** para permitir putaway dinámico posterior.
- **Flujo de Impresión y Confirmación en Andén:**
  - Registro de auditoría para primera emisión y reimpresión controlada (`POST /api/receipts/:id/labels/print`).
  - Botón de confirmación de pegado físico en andén (`POST /api/receipts/:id/labels/confirm-placement`), que actualiza el estado a `COLOCADAS` y habilita el candado operativo para la Fase 4 (Putaway).

#### 🛡️ Blindaje de Infraestructura, PostgreSQL y Express (`wms-backend`)
- **Resiliencia de Pool PostgreSQL en Supabase (`prisma.service.ts`):**
  - Configuración optimizada de `pg.Pool` con límites (`max: 10`, `idleTimeoutMillis: 30000`, `connectionTimeoutMillis: 10000`) y manejador de eventos `pool.on('error')` para erradicar caídas `DriverAdapterError: ConnectionClosed` ocasionadas por desconexión de sockets TCP inactivos en Supabase.
- **Límite de Payload en Express (`main.ts`):**
  - Configuración de parser JSON y URL-encoded a **10 MB** (`json({ limit: '10mb' })`), evitando errores `413 Payload Too Large` y cuelgues al transmitir firmas Base64 de alta resolución.
- **Sincronización de Compilación NestJS (`nest-cli.json`):**
  - Declaración explícita de `entryFile: "src/main"` para erradicar errores `MODULE_NOT_FOUND: Cannot find module dist/main` al recompilar en watch mode (`npm run start:dev`).

#### 🧪 Validación Integral de Prueba (Folio `REC-2026-0009`)
- Previo cargado exitosamente desde `Plantilla_Previo_Prueba_Fase1_GivingOut.xlsx` con cliente *AlimNorte* y factura `FAC-PRUEBA-FASE1-001`.
- Escenario auditado: 3 bultos declarados, 3 recibidos en total, 1 con daño exterior (Diferencia = 0, Estado de carga: `CON_RESERVAS`, leyenda: «Entregó con reservas y discrepancias asentadas»).
- Preservación íntegra de 2 entradas de auditoría en la base de datos Supabase.

---

## [1.7.0] — 2026-09-23

### 🎨 Unificación Estética Minimalista, Panel IA Colapsable y Hoja de Ruta Operativa 3PL

#### ⚪ Unificación Visual Blanco y Gris (Estilo Inventario)
- **TopBar (`TopBar.tsx`):**
  - Fondo blanco `#FFFFFF`, borde inferior `#E2E8F0`, tipografía `#0F172A`, badges de estatus del sistema y contador numérico interactivo refinados en alto contraste.
- **Módulo de Recepción (`Receiving.tsx`):**
  - Erradicación de fondos oscuros (`#0B0F17`, `#0F172A`, `#1E293B`) y transición completa al diseño unificado: tarjetas `#FFFFFF`, fondo de página `#F8FAFC`, bordes suaves `#E2E8F0`, y acentos esmeralda/teal (`#059669` / `#0D9488`).
  - Tabla de partidas y conteo a ciegas con filas alternadas, inputs de captura claros y badges de variación legibles.
- **Depositantes / Clientes (`Clients.tsx`):**
  - Métricas KPI, tabla ejecutiva de depositantes, selector de giros comerciales y modales de alta/edición adaptados a la paleta unificada.
- **Modal de Desvío a Almacén Virtual (`DivertToVirtualModal.tsx`):**
  - Estilizado en blanco y gris con insignias específicas para Merma (ámbar) y Excedentes (violeta).
- **Estilos Globales (`index.css` & `main.tsx`):**
  - Limpieza de selectores oscuros forzados y armonización del viewport general en `#F8FAFC`.

#### 🤖 Panel Lateral de Sugerencias IA Colapsable (`Receiving.tsx`)
- **Control Interactivo de Visualización:**
  - Incorporado botón de minimizado/expandido en la cabecera del panel de Sugerencias de Ubicación (Putaway).
  - Persistencia del estado colapsado en `localStorage` (`receiving_sidebar_collapsed`) para respetar la preferencia del usuario entre sesiones.

#### 🌐 Red, Caché y Portabilidad (`vite.config.ts` & `index.html`)
- **Soporte Host Multi-Interfaz:**
  - Configurado Vite para enlazar en `0.0.0.0` y puerto estricto `5173`, permitiendo acceso transparente tanto vía `localhost` como `127.0.0.1`.
- **Desregistro Automático de Service Workers:**
  - Inyección de script de saneamiento en `index.html` para purgar service workers y cachés residuales de proyectos locales anteriores en el mismo puerto.

#### 📑 Transcripción Oficial de Reunión Ejecutiva y Especificación 3PL
- **Procesamiento de Audio con IA (Whisper):**
  - Transcripción íntegra de la sesión oficial de Google Meet (51 minutos 39 segundos) entre Alejandra (cliente) y Jonathan (dirección técnica).
  - Generación de documento PDF ejecutivo de 14 páginas guardado en `C:\Users\Mariana\Downloads\Transcripcion_Reunion_Giving_Out.pdf`.
- **Estructuración de los 6 Pilares Operativos Giving Out:**
  - *Pilar 1:* Recepción en rampa y descarga con acta de chofer exprés.
  - *Pilar 2:* Inspección interna y módulo de reacondicionamiento/maquila/rescate hacia previo original.
  - *Pilar 3:* Doble etiquetado (Pallet Master con QR vs Cajas individuales sin ubicación quemada).
  - *Pilar 4:* Putaway con confirmación por escaneo y transición de stock a "Disponible".
  - *Pilar 5:* Ciclo de pedido con reserva inmediata (disponible vs físico) y panel supervisor.
  - *Pilar 6:* Surtido/picking en terminal móvil con doble validación de escaneo.

---

## [1.6.1] — 2026-09-19

### 🎯 Estabilización E2E, Plantillas Inteligentes y Corrección de Filtros en Almacén Virtual

#### 📊 Corrección de Filtro y Métricas en Almacén Virtual de Cuarentena (`Inventory.tsx` & `inventory.controller.ts`)
- **Resolución de Filtrado de Merma (`GET /api/inventory/virtual-warehouse`):**
  - Corrección de la condición de búsqueda en base de datos: el backend ahora clasifica y recupera lotes no solo por texto en notas, sino prioritariamente por códigos de ubicación física asignados (`DEV-01`, `NC-MERMA-01` vs `NC-EXCESO-01`) y tipo de ubicación (`DEVOLUCION`).
  - Incorporadas insignias numéricas reactivas en las pestañas de filtro: `Todos (25)`, `Merma / Dañado (20)` y `Sobrante / Exceso (5)`.
  - Tarjetas de KPIs superiores (`TOTAL UNIDADES EN CUARENTENA`, `MERMA / DAÑO FÍSICO`, `EXCEDENTES NO AMPARADOS`) fijadas para mantener la visibilidad del resumen global independientemente del filtro activo.

#### 📑 Descarga Inteligente de Plantillas Excel con SKUs Reales (`Receiving.tsx`)
- **Generación Dinámica de Archivo Previo por Depositante:**
  - El botón "Descargar Plantilla" ahora detecta al cliente seleccionado y genera al vuelo un archivo Excel estructurado (`.xlsx`) precargado con el catálogo real de SKUs, descripciones y unidades de medida (UOM) de dicho cliente en Supabase.
  - Formato estandarizado con columnas exactas para conteo ciego, lote y caducidad, optimizando el tiempo de captura para los supervisores en andén.

#### 🛡️ Candados de Cierre y Reporte Ejecutivo con Variación (`ReceiptReportModal.tsx` & `Receiving.tsx`)
- **Columna de Variación y Excedentes en Reporte SKU:**
  - Desglose visual de diferencias (Factura vs Físico Recibido) con marcadores de color por partida.
  - Bloqueo de auto-llenado duplicado en recepciones que ya se encuentran al 100% recibidas o cerradas.
  - Mapeo unificado de payloads (`partidas` e `items`) en el modal de desvío a cuarentena (`DivertToVirtualModal`).

#### ⚡ Optimización de Conexión a Base de Datos (Supabase Transaction Pooler)
- Migración de cadena de conexión en backend al puerto `6543` (`?pgbouncer=true`), erradicando límites de conexiones simultáneas en sesión y garantizando alta disponibilidad concurrente.

---

## [1.6.0] — 2026-09-19

### 🚀 Sprint #1 — Módulo de Depositantes y Giros Comerciales (6 Subtareas Culminadas al 100%)

#### 🏛️ Subtarea 1: Modelado Relacional en Supabase con Campos Fiscales, Contacto y Giros
- **Esquema Relacional en Prisma (`schema.prisma` & Supabase PostgreSQL):**
  - Incorporados campos fiscales y de contacto extendidos en el modelo `Client`: `regimenFiscal`, `codigoPostal`, `pais`, `cfdiDefault` y `sitioWeb`.
  - Catálogo ampliado y normalizado de giros comerciales: `ROPA`, `COMIDA` (Alimentos y Bebidas), `FARMACEUTICO`, `MAQUILA`, `ELECTRONICA`, `COSMETICOS`, `GENERAL`.
  - Auto-migración DDL en `PrismaService.ensureSchemaColumns()` con `ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS ...`.

#### ⚙️ Subtarea 2: CRUD Robusto en Backend (`clients.controller.ts` & `client.dto.ts`)
- **Endpoints de Administración Completa:**
  - `GET /api/clients`: Listado multi-criterio con búsqueda rápida, filtros por giro y estatus activo/inactivo, e inclusión de conteo consolidado de SKUs, lotes, órdenes y recepciones.
  - `GET /api/clients/:id`: Detalle integral del cliente con desglose de reglas operativas heredables y kárdex.
  - `POST /api/clients`: Alta transaccional defensiva con DTO validado (`CreateClientDto`), unicidad obligatoria de código y RFC, y retorno tipado OpenAPI.
  - `PUT /api/clients/:id`: Actualización de parámetros comerciales y fiscales.
  - `DELETE /api/clients/:id`: Desactivación lógica segura (`activo: false`) que resguarda el inventario en racks y las recepciones históricas.

#### 🛡️ Subtarea 3: Formulario Frontend de Alta/Edición con Bloqueo de Campos según Perfil RBAC (`Clients.tsx`)
- **Experiencia de Usuario 3PL de Alta Fidelidad en Dark Theme:**
  - Formulario estructurado en 3 secciones operativas: *Identificación & Datos Fiscales SAT*, *Reglas Operativas Fijas 3PL* y *Contacto Operativo & Enlace Digital*.
  - **Candado Visual RBAC por Perfil de Usuario:** Si el usuario activo tiene rol de `Operador`, `Operario` o `Almacenista`, todos los campos de reglas operativas (`requiereLote`, `requiereCaducidad`, `reglaInventario`, `uomPrincipal`, `manejoInventario`, `giro`) se presentan deshabilitados en modo lectura con insignias `<Lock size={12} color="#EF4444" />` y un banner formal de advertencia de seguridad.
  - Modal de confirmación para baja lógica de depositante con advertencia de conservación de kárdex.

#### 📦 Subtarea 4: Catálogo Configurable de Reglas Operativas 3PL Heredables por Giro
- **Motor Canónico de Auto-Asignación de Reglas (`getDefaultRulesForGiro`):**
  - `COMIDA / ALIMENTOS`: Exigencia sanitaria estricta (NOM-251 / COFEPRIS) con `requiereLote: true`, `requiereCaducidad: true` y rotación `FEFO`.
  - `FARMACEUTICO`: `requiereLote: true`, `requiereCaducidad: true` y rotación `FEFO`.
  - `MAQUILA`: Trazabilidad de partes y ensambles con `requiereLote: true`, `requiereCaducidad: false` y rotación `FIFO`.
  - `ELECTRONICA`: `requiereLote: true`, `requiereSerie: true` y rotación `FIFO`.
  - `ROPA / GENERAL`: Rotación estándar `FIFO` sin restricciones de vencimiento.
  - Endpoint público `@Get('api/clients/catalogos/giros')` para consumo dinámico en interfaces de usuario.

#### 🔒 Subtarea 5: Guardián en Servidor contra Mutación de Reglas por Operarios
- **Protección Inflexible en API Backend:**
  - Verificación en `PUT /api/clients/:id` y `PUT /api/clients/:id/config`: Si el token JWT o el encabezado `x-user-role` pertenece a un `Operador`, cualquier intento de mutar reglas fijas es denegado con `403 Forbidden` (`OPERARIO_NO_AUTORIZADO_PARA_MODIFICAR_REGLAS_FIJAS`).
  - Registro inmutable en `AuditLog` con acción `VIOLACION_REGLAS_RECHAZADA` ante intentos de elusión en andén.
  - Protección en endpoints de recibo: el backend toma como verdad absoluta la regla fijada en el `Client`, impidiendo que el operador desactive lote o caducidad en piso.

#### 🧪 Subtarea 6: Suite Oficial Automatizada de Pruebas (`test-task-clients-sprint1.js`)
- **Certificación de 20/20 Pruebas Aprobadas (100% PASS):**
  - Cobertura integral de catálogo de giros, restricciones de campos requeridos (`codigo`, `nombreComercial`, `razonSocial`, `giro`), unicidad de código/RFC, persistencia en Supabase, candado RBAC contra operarios, baja lógica y consultas.

---

## [1.5.0] — 2026-09-18

### 🚀 Sprint #3 — Manejo de No Conformidades, Desvío a Almacén Virtual de Merma/Cuarentena, Candado de Cierre de Discrepancias y Sistema de Impresión Térmica

#### 🛡️ Tarea 5: Manejo de No Conformidades y Desvío Atómico a Almacén Virtual (`inventory.controller.ts`)
- **Desvío Transaccional a Almacén Virtual (`POST /api/inventory/virtual-warehouse/divert`):**
  - Creación y verificación en base de datos de almacén virtual (`ALM-VIRTUAL-01`, tipo `VIRTUAL`) y ubicación virtual (`VIR-REC-01`, tipo `VIRTUAL`).
  - Segregación estricta de inventario: creación/actualización en `LotInventory` con estado `CUARENTENA`, clasificación `tipoAlmacen: 'MERMA_CUARENTENA'` y candado de venta `bloqueadoParaVenta: true`.
  - Generación automática de Unidad de Manejo (`HandlingUnit`) con código `HU-QUAR-[uuid]` para rastreo e identificación física en jaula o tarima de merma.
  - Registro de asiento inmutable de auditoría en `InventoryMovement` (`tipoMovimiento: 'DESVIO_VIRTUAL'`, referenciado a `documentoOrigen: receipt.codigo`).
  - Timeout transaccional de PostgreSQL/Supabase calibrado a 45 segundos (`maxWait: 15s`, `timeout: 45s`) para erradicar fallos de concurrencia bajo latencia de red.
  - **Suite de Pruebas Automatizadas:** `test-task-virtual-warehouse.js` con **19/19 pruebas aprobadas (100% PASS)**.

#### 🔒 Candado Anti-Negligencia en Cierre de Recepción (`operations.controller.ts` & `Receiving.tsx`)
- **Bloqueo Estricto ante Discrepancias no Justificadas (`POST /api/receipts/:id/close-with-discrepancies`):**
  - Comparativa de cuadre físico: $(\text{Conforme} + \text{Dañado}) \text{ vs } \text{Esperado}$. Si la diferencia neta es distinta de cero o hay producto dañado, el cierre se bloquea con código `400 Bad Request` (`DISCREPANCIAS_NO_JUSTIFICADAS`).
  - Catálogo formal de motivos 3PL: `FALTANTE_PROVEEDOR`, `DANO_TRANSPORTE`, `SOBRANTE_BONIFICACION`, `RECHAZADO_EN_ANDEN`, `CUARENTENA_CALIDAD`, `DIFERENCIA_DOCUMENTAL`, `OTRO_JUSTIFICADO`.
  - Guardián Anti-Bypass en `PATCH /api/receipts/:id/status` para evitar saltarse la validación modificando el estatus directamente a `CERRADA`.
  - Sellado de partidas en estado `DISCREPANCIA` con nota legal inmutable `[DISCREPANCIA_RESUELTA]`.
  - Modal interactivo de alta densidad en frontend con soporte de homologación masiva en 1 clic (`⚡ Aplicar a Todas`) y botón dinámicamente bloqueado (`🔒 Cierre Bloqueado`).
  - **Suite de Pruebas Automatizadas:** `test-task5-closing-lock.js` con **11/11 pruebas aprobadas (100% PASS)**.

#### 🖨️ Sistema Industrial de Impresión Térmica de Etiquetas de Cuarentena (`DivertToVirtualModal.tsx` & `index.css`)
- **Desacoplamiento 100% Offline de Impresión:**
  - Erradicación de dependencias externas a CDNs que provocaban bloqueos de CSP y páginas en blanco en ventanas `about:blank`.
  - Generación directa de códigos de barras Code-128 como SVG vectorial nativo pre-renderizado e inyectado limpiamente en un iframe de impresión aislado.
  - Reparación de `@media print` en `index.css`: supresión del ocultamiento global `body * { visibility: hidden }` y eliminación del `@page` restrictivo de 4x2 pulgadas.
  - Doble modalidad: `[ Imprimir Etiqueta ]` (modal con preview Dark Theme) y `[ Imprimir Rápido (Ctrl+P) ]` (disparo instantáneo a la cola de la impresora).
  - Cumplimiento riguroso de diseño: **CERO EMOJIS GENÉRICOS**, utilizando exclusivamente iconos vectoriales SVG de Lucide React.

#### 🧹 Depuración, Purga de Base de Datos y Optimización de Carga
- **Purga de Previos de Prueba:** Eliminación completa de los 9 previos generados durante las pruebas automatizadas (`TEST-REC-*`, `REC-2026-0003` a `REC-2026-0010`) y sus líneas.
- **Preservación Inmaculada de Datos Históricos:** Conservación intacta del previo original de inicio `REC-2026-0001` (Fashion Forward S.A. de C.V.) como registro histórico.
- **Limpieza de Lotes Residuales:** Eliminación de lotes de prueba temporales (`LOTE-TEST-*` y `LOT-E2E-*`).
- **Erradicación del Parpadeo de Cero en Recepción (`Receiving.tsx`):**
  - Desacoplamiento de `loadData()` para no esperar en `Promise.all` por catálogos secundarios, cargando la lista de previos de forma inmediata.
  - Indicador visual de sincronización en tiempo real (`RefreshCw` animado con mensaje) cuando `loading: true`, eliminando el falso estado de "0 previos registrados".

---

## [1.4.0] — 2026-09-17

### 🚀 Sprint #3 — Recepciones Físicas en Andén, Conciliación E2E y Trazabilidad Sanitaria

#### 📊 Tareas 1 y 2: Planilla Matricial Masiva por Factura Completa y Tira Ejecutiva de KPIs
- **Planilla Matricial por Factura Completa (`Receiving.tsx` & `operations.controller.ts`):**
  - Implementación de la planilla matricial masiva que permite capturar físicamente todas las partidas de una factura en una única pantalla de alta densidad operativa.
  - Conteo Ciego configurable (`Modo Conteo Ciego`): oculta cantidades esperadas para obligar auditorías físicas reales en andén sin sesgo de operador.
  - Botón de autollenado rápido `[ Recibir 100% Conforme ]` y botón de reseteo `[ Limpiar Planilla ]`.
  - Configuración rápida de ubicaciones por defecto para Conforme (`REC-01`) y No Conforme (`DEV-01` / `MERMA-01`).
- **Motor Reactivo de Variaciones y Tira Ejecutiva de 4 KPIs en Tiempo Real:**
  - 4 KPIs dinámicos calculados al instante mientras el usuario teclea:
    1. *Factura Esperada* (Total piezas esperadas o badge "Oculto en Modo Ciego").
    2. *Conforme a Recibir* (Piezas aptas para inventario con barra porcentual de avance).
    3. *Merma / Dañado* (Piezas no conformes con cálculo automático de % de merma).
    4. *Balance de Cuadre WMS* (Variación neta con alertas de faltantes/sobrantes y desglose de partidas exactas, con merma y pendientes).
  - Acentos visuales en borde izquierdo de cada fila (`#10B981` exacto, `#EF4444` merma, `#F59E0B` faltante, `#38BDF8` sobrante).
  - Timeout del cliente HTTP ampliado a 45 segundos para soportar facturas masivas de más de 100 líneas sin interrupciones de red.

#### ⚖️ Tarea 3: Pruebas de Conciliación entre Cantidad Esperada en Previo vs. Cantidad Física Capturada
- **Motor Matemático de Conciliación Industrial (`test-reconciliation.js`):**
  - Fórmulas oficiales de Fill Rate de proveedor ($\frac{\text{Conforme}}{\text{Esperada}} \times 100$) y Tasa de Merma ($\frac{\text{Dañada}}{\text{Físico Total}} \times 100$).
  - 6 estados operacionales estandarizados: `EXACTO` (100% conforme), `CUADRADO_CON_MERMA`, `FALTANTE`, `SOBRANTE`, `PENDIENTE`, y `CIEGO`.
- **Suite de Pruebas Automatizadas Certificada al 100%:**
  - Archivo ejecutable `wms-backend/test-reconciliation.js` con 20/20 pruebas aprobadas (100% PASS).
  - Cobertura total de pruebas unitarias puras y pruebas de integración transaccional atómica contra Supabase PostgreSQL (HandlingUnit, LotInventory, InventoryMovement).

#### 🛡️ Tarea 4: Captura Obligatoria de Lote y Fecha de Caducidad por Giro de Negocio (NOM-251 / COFEPRIS / FDA)
- **Reglas Sanitarias y Detección Automática Multi-Capa en Backend (`operations.controller.ts`):**
  - Detección automática del giro de negocio del cliente depositante (`COMIDA`, `FARMACEUTICO`).
  - Requisito obligatorio de `lote` y `fechaVencimiento` si el giro es regulado o si el cliente/SKU tiene activas las banderas `requiereLote` / `requiereCaducidad`.
  - Rechazo con `400 Bad Request` y código estructurado `LOTE_OBLIGATORIO_POR_GIRO` ante lotes vacíos o compuestos únicamente por espacios en blanco.
  - Rechazo con `400 Bad Request` y código estructurado `CADUCIDAD_OBLIGATORIA_POR_GIRO` ante fechas omitidas.
  - **Persistencia Dual Integral en Base de Datos:** Lote y Caducidad sellados permanentemente tanto en `LotInventory` (`LIBERADO` / `CUARENTENA`) como en `ReceiptLine` (`loteAsignado`, `fechaVencimiento`), persistiendo al refrescar o consultar la recepción.
  - **Enriquecimiento del Reporte de Entrada (`GET /api/receipts/:id/report`):** Incluye `loteAsignado`, `loteEsperado` y `fechaVencimiento` en el desglose oficial de partidas.
  - **Carga Dual Inteligente con Detección de Trazabilidad:** Extracción y mapeo automático de columnas de lote (`lote`, `lot`, `batch`) y caducidad (`caducidad`, `vencimiento`, `expiry`) tanto en hojas Excel como en partidas manuales y en `addReceiptLine` / `updateReceiptLine`.
  - **Etiquetado Térmico para Racks y Montacargas (`ReceiptPrintModal.tsx`):** Plantillas industriales calibradas en 50x25mm y 100x50mm imprimiendo `LOTE` y `CAD` bajo el código de barras para control FEFO en almacén físico.
  - **Reporte Oficial 1:1 PROVA (`ReceiptReportModal.tsx`):** Nuevas columnas `LOTE` y `CADUCIDAD` integradas en la vista de *Detalle por SKU* con tipografía monoespaciada y badges coloreados para firma de conformidad.
  - **Catálogo de Datos Maestros (`MasterData.tsx`):** Nueva columna `Trazabilidad` en la tabla de SKUs con insignias de `LOTE` y `CADUCIDAD` para identificar visualmente productos perecederos.
  - **Lógica Inteligente de Autollenado (`handleAutoFillConforme`):** Detección de previos previamente recibidos para autocompletar la totalidad esperada de la factura sin generar bloqueos en ceros.
- **Suite de Pruebas Automatizadas de Trazabilidad (`test-lote-caducidad.js`):**
  - Archivo ejecutable `wms-backend/test-lote-caducidad.js` con 10/10 pruebas aprobadas (100% PASS).
  - Validación integral con clientes temporales perecederos, farmacéuticos y textiles, con persistencia en Supabase y limpieza garantizada.

## [1.3.0] — 2026-09-14

### 🚀 Sprint #2 — Recepciones Previas (ASN): Tareas 2, 3, 4, 5 y 6 (Culminadas al 100%)

#### 📦 Tarea 2: Endpoint Dual de Ingesta para Creación y Carga de Previos (`POST /api/receipts/previo`)
- **Ingesta Dual en Servidor (`operations.controller.ts` & `upload-previo.dto.ts`):**
  - Soporte de ingesta vía formulario manual (`application/json`) y archivo Excel (`multipart/form-data`) con `FileInterceptor('file')`.
  - Parseo en memoria de libros de trabajo `.xlsx` y `.xls` mediante la librería `xlsx`, sin almacenar archivos temporales en disco.
  - Normalización inteligente de encabezados de columna con tolerancia a variantes (`factura`, `oc`, `invoice`, `documento`; `ean`, `codigo`, `sku`, `material`; `cantidad a recibir`, `cantidad`, `qty`, `piezas`).
  - Auto-detección algorítmica del cliente depositante por votación cruzada de SKUs cuando el archivo no incluye `clienteId`.
- **Integración en Frontend (`Receiving.tsx`):**
  - Modal interactivo de carga con zona de arrastrar y soltar (drag & drop), selección de hojas y previsualización de partidas parseadas.
  - Formulario dinámico para captura manual multi-partida con validación inmediata.

#### 🔒 Tarea 3: Candado Operativo de Integridad y Desbloqueo Supervisado
- **Candado de Bloqueo de Edición (`POST /api/receipts/:id/lock`):**
  - Al confirmar el arribo del transporte a andén, se activa `bloqueado: true`, resguardando el previo contra modificaciones para asegurar la validez del conteo a ciegas.
  - Guardián en backend: toda mutación (`PUT /api/receipts/:id`, `POST /api/receipts/:id/lines`, `DELETE /api/receipts/:id`, `PUT /receipt-lines/:id`) sobre un previo bloqueado es rechazada con código `403 Forbidden`.
- **Desbloqueo Controlado por Supervisor (`POST /api/receipts/:id/unlock`):**
  - Exigencia obligatoria de justificación (`motivo`) para registro en la bitácora inmutable `AuditLog`.
  - **Bloqueo Definitivo Inmutable:** Si la recepción se encuentra en estatus `CERRADA`, el sistema deniega permanentemente cualquier intento de desbloqueo, garantizando el cumplimiento de auditoría WMS.
- **UI en Frontend:**
  - Indicadores visuales de candado cerrado (dorado) / abierto (verde) con iconos vectoriales Lucide.
  - Bloqueo de edición en tabla y partidas cuando el candado está activo, con modal de autorización para supervisor.

#### 🛡️ Tarea 4: Validación Automática Cruzada de SKUs contra Catálogo del Depositante
- **Validación Multi-Capa en Backend y Base de Datos:**
  - **Carga de Excel:** Análisis fila por fila detectando productos pertenecientes a otros clientes (`skusAjenos`) y códigos no registrados (`skusInexistentes`). Si ningún SKU pertenece al cliente, se rechaza la solicitud.
  - **Formulario Manual y Endpoints:** Verificación estricta en `POST /receipts`, `POST /receipts/previo`, `POST /receipts/:id/lines` y `POST /reception` de que `sku.clienteId === receipt.clienteId`.
- **Experiencia de Usuario en Handheld y Escritorio (`Receiving.tsx`):**
  - **Zebra Handheld Scanner:** Al escanear con la terminal en andén un código de barras de otro cliente depositante, el sistema bloquea el ingreso físico y despliega una tarjeta de alerta de alto contraste.
  - Tarjetas de advertencia ejecutivas en Dark Theme con indicación clara del cliente propietario original (`"Pertenece a Fashion Forward"`).

#### 🏷️ Tarea 5: Estandarización de 3 Estatus Operacionales del Previo
- **Trío Oficial de Banderas Operativas:**
  1. `PENDIENTE_ARRIBO` (Pendiente de Arribo 🟡): Previo registrado en espera del arribo de la unidad de transporte.
  2. `EN_PROCESO_CONTEO` (En Proceso de Conteo 🔵): Unidad en bahía de descarga, candado activo, conteo físico y escaneo con handheld. Incluye indicador visual con punto pulsante de actividad en vivo.
  3. `CERRADA` (Cerrada 🟢): Recepción finalizada, reporte de discrepancias generado e inventario sellado inmutablemente.
- **Componentes en Frontend (`Receiving.tsx`):**
  - Función centralizada `getEstadoMeta` con badges y colores de alta visibilidad.
  - Barra superior de botones píldora para filtrado rápido con contador en tiempo real por cada estatus.
  - Stepper visual interactivo de 3 etapas en la cabecera expandida (`[ 1. Pendiente de Arribo ] ──▶ [ 2. En Proceso de Conteo ] ──▶ [ 3. Cerrada ]`) con botones de acción directa (`[ Iniciar Conteo en Andén ]` y `[ Finalizar y Cerrar Recepción ]`).
- **Automatización en Backend:**
  - Transición automática a `EN_PROCESO_CONTEO` al confirmar arribo (`/lock`) o al registrar el primer escaneo/conteo físico (`/reception`).
  - Nuevo endpoint `PATCH /api/receipts/:id/status` para transiciones supervisadas con bitácora de auditoría.
  - Filtro tolerante en `GET /api/receipts?estado=...` que agrupa estados legados.

#### 📄 Tarea 6: Documentación OpenAPI / Swagger 3.0 y Validación de Respuestas de Error ante Datos Incompletos
- **Documentación Interactiva Swagger / OpenAPI:**
  - Swagger UI activo en vivo en `http://localhost:3001/api/docs` y especificación JSON en `http://localhost:3001/api/docs-json`.
  - 7 endpoints de recepciones previas catalogados con descripciones técnicas, parámetros de ruta, query params y códigos de respuesta (`200`, `201`, `400`, `403`, `404`, `500`).
  - DTOs enriquecidos con decoradores `@ApiProperty`, ejemplos reales y validaciones de tipos en `previo.dto.ts` y `upload-previo.dto.ts`.
- **Respuestas de Error Estructuradas (`400 Bad Request` y `403 Forbidden`):**
  - Validación rigurosa eliminando errores no controlados (500) ante datos faltantes:
    - Cuerpo vacío (`{}`) ➔ `CLIENTE_ID_REQUERIDO`.
    - Documento de respaldo ausente ➔ `DOCUMENTO_REFERENCIA_REQUERIDO`.
    - Lista de partidas vacía (`lineas: []`) ➔ `LINEAS_PREVIO_REQUERIDAS`.
    - Cantidad esperada $\le 0$ ➔ `CANTIDAD_ESPERADA_INVALIDA` con número de partida.
    - Partida sin producto ➔ `SKU_ID_REQUERIDO`.
    - Ingesta dual sin archivo ni partidas ➔ `ORIGEN_DATOS_PREVIO_VACIO`.
    - Desbloqueo sin justificación ➔ `MOTIVO_DESBLOQUEO_REQUERIDO`.
    - Desbloqueo de recepción cerrada ➔ `RECEPCION_CERRADA_INMUTABLE` (`403 Forbidden`).
    - Estatus operacional no válido ➔ `ESTADO_INVALIDO`.
  - Formato uniforme conforme a RFC-7807 (`{ statusCode, message, error, detalles }`).
- **Especificación Técnica Oficial**:
  - Redactada en `docs/api_previo_specification.md` detallando la matriz de errores, DTOs y ejemplos de consumo.
- **Suite de Pruebas de Validación en Vivo (`wms-backend/test-validation.js`):**
  - Suite automatizada de 12 pruebas defensivas ejecutada con 100% de éxito (0 fallas), validando Swagger UI, OpenAPI JSON, rechazos HTTP 400 (`CLIENTE_ID_REQUERIDO`, `DOCUMENTO_REFERENCIA_REQUERIDO`, `LINEAS_PREVIO_REQUERIDAS`, `CANTIDAD_ESPERADA_INVALIDA`, `ORIGEN_DATOS_PREVIO_VACIO`, `MOTIVO_DESBLOQUEO_REQUERIDO`, `ESTADO_INVALIDO`).
  - Verificación exitosa en vivo directamente desde la consola del navegador del frontend.
- **Corrección en Notificaciones TopBar (`TopBar.tsx`):**
  - Corregido llamado a endpoint de órdenes de venta de `/api/sales-orders` a `/api/orders`, eliminando alerta HTTP 404 en consola.

---

## [1.4.0] — 2026-09-15

### 🚀 Sprint #3 — Validación Física por Factura Completa y Manejo de No Conformidades

#### 📊 Tarea 1: Interfaz y API de Conteo de Recepción por Factura Completa (Planilla Matricial)
- **Planilla Matricial de Conteo en Frontend (`Receiving.tsx`):**
  - Eliminado el paradigma de captura lenta línea por línea: ahora se procesa la factura completa en una sola cuadrícula de alta densidad.
  - **Modo Conteo Ciego (Blind Count Mode):**
    - Interruptor de seguridad (`Eye` / `EyeOff`) que enmascara las cantidades esperadas y las variaciones bajo un badge confidencial `🔒 Ciego (Oculto)`.
    - Garantiza auditorías imparciales en andén sin sesgo del personal operativo.
  - **Botón Rápido "⚡ Recibir 100% Conforme":**
    - Prellenado automático en 1 clic de todas las partidas restantes como conformes (`cantidadConforme = restante`, `cantidadDanada = 0`).
  - **Controles de Alta Densidad y Ergonomía:**
    - Botones de incremento/decremento rápido `[-]` y `[+]` por celda.
    - Auto-selección de texto al hacer foco para escaneo o tecleo rápido.
    - Captura simultánea de Lote y Fecha de Caducidad por partida para clientes con trazabilidad obligatoria.
    - Selectores rápidos de ubicación por defecto: Zona Conforme (`REC-01`) y No Conforme (`DEV-01`).
    - Barra inferior flotante con resumen dinámico en tiempo real (Total Partidas, Esperadas, Conformes, Dañadas, Variación neta) y botón de guardado en lote.
- **Endpoint Atómico de Recepción en Lote (`POST /api/receipts/:id/batch-reception`):**
  - **DTO Tipado y Swagger (`previo.dto.ts`):** `BatchReceptionDto` y `BatchReceptionLineItemDto` integrados a la especificación OpenAPI 3.0 interactiva (`/api/docs`).
  - **Transacción Atómica Prisma (`$transaction`):**
    - Procesa todas las partidas de la factura en una única operación relacional de base de datos.
    - Segregación estricta de inventario: partidas conformes se crean en `LotInventory` con estado `LIBERADO` y partidas dañadas con estado `CUARENTENA`.
    - Creación automática de bultos/pallets (`HandlingUnit`) y movimientos de trazabilidad (`InventoryMovement` tipo `ENTRADA`).
    - Actualización de ocupación en ubicaciones físicas de andén (`Location.ocupacion`).
    - Transición automática del previo al estatus operativo `EN_PROCESO_CONTEO` y activación del candado de andén (`bloqueado: true`).
    - Registro inmutable en `AuditLog` con desglose de partidas recibidas y usuario auditor.
  - **Validaciones Defensivas Robustas:**
    - Validación inmediata previa a consultas DB: usuario capturista obligatorio, partidas no vacías, al menos una cantidad mayor a 0 (`400 Bad Request`).
    - Verificación de existencia del previo (`404 Not Found`).
    - Candado de inmutabilidad: rechazo categórico de recepciones en estado `CERRADA` (`403 Forbidden`).
    - Validación de pertenencia de SKUs al catálogo del depositante (`400 Bad Request`).
- **Verificación Automatizada:**
  - Suite de pruebas automatizadas `test-task1-matrix.js` con 7/7 casos de prueba aprobados (100% éxito).
  - Compilación de TypeScript y bundle de producción Vite validados con 0 errores (`built in 43.98s`).

#### 📈 Tarea 2: Lógica de Detección de Variaciones en Tiempo Real (Faltantes, Sobrantes y Dañado)
- **Motor Matemático de Conciliación en Tiempo Real (`Receiving.tsx`):**
  - Implementación reactiva que recalcula discrepancias con cada pulsación de tecla o clic en `[+]` / `[-]` tanto a nivel de partida como para la factura completa.
  - Ecuación operativa WMS: `Variación Neta = (Cantidad Conforme + Cantidad Dañada) - Cantidad Esperada`.
  - **Clasificación en 4 Niveles de Severidad con Badges Vectoriales (Cero Emojis Genéricos):**
    - `✓ Exacto (100%)`: Partida recibida íntegra sin faltantes ni mermas (`#34D399` / `#10B981`).
    - `⚠️ Cuadrado con Merma`: El total de piezas coincide con factura pero existen piezas rotas/inutilizables desviadas a cuarentena (`#F87171` / `#EF4444`).
    - `📉 Faltante: -X pzas`: El proveedor no surtió el pedido completo (`#FBBF24` / `#F59E0B`), con desglose adicional de merma si aplica.
    - `📈 Sobrante: +X pzas`: Excedente físico no facturado (`#38BDF8` / `#0284C7`), con desglose adicional de merma si aplica.
  - **Indicador de Acento Lateral por Fila (`borderLeft`):**
    - Borde sutil de 3px a la izquierda de cada fila que permite al supervisor escanear de un vistazo 50 partidas: verde para exacto, ámbar para faltante, azul para excedente y rojo para merma.
- **Tira Ejecutiva Superior de 4 KPIs en Tiempo Real (Executive KPI Strip):**
  - Integrada en la cabecera expandida arriba de la barra de controles de la planilla matricial:
    1. **Factura Esperada:** Total de piezas declaradas en el previo ASN y conteo de partidas. Enmascarado en modo ciego.
    2. **Conforme Recibido:** Total de piezas físicamente aptas para venta + **% de cumplimiento de factura** con barra de progreso dinámica.
    3. **Discrepancia Neta:** Semáforo ejecutivo que indica `0 pzas (Cuadrada)` en verde, `-X pzas (Faltante)` en ámbar, o `+X pzas (Excedente)` en azul.
    4. **Merma / Dañado:** Conteo de piezas dañadas + **% de tasa de merma del embarque** y alerta visual de desvío a cuarentena.
- **Soporte Transparente de Modo Conteo Ciego:**
  - Enmascaramiento confidencial de KPIs de factura y variaciones bajo la insignia `🔒 Ciego (Oculto)` para auditorías imparciales sin sesgo del personal.
- **Validación Automatizada:**
  - Suite de pruebas `test-task2-variations.js` ejecutada con 10/10 casos aprobados al 100% de éxito.
  - Compilación Vite y TypeScript verificadas con 0 errores (`built in 6.74s`).

---

## [1.4.0-planning] — 2026-09-14

### 📋 Mapeo y Planificación: Sprint #3 — Validación Física por Factura Completa y Manejo de No Conformidades
- **Objetivo:** Permitir la captura ciega o global del producto recibido contra el previo.
- **Subtareas Planificadas (2 / 6 Completadas):**
  1. [x] Crear interfaz de conteo de recepción por factura completa (no línea por línea) para captura de cantidades reales.
  2. [x] Implementar lógica de detección de variaciones: cálculo automático de faltantes, sobrantes y producto dañado.
  3. [ ] Desarrollar subflujo para desviar producto dañado o en exceso a almacén virtual de "No Conforme / Merma".
  4. [ ] Bloquear el cierre de recepción si existen discrepancias sin justificación o clasificación de estatus.
  5. [ ] Implementar captura obligatoria de lote y fecha de caducidad si el giro del cliente lo exige.
  6. [ ] Ejecutar pruebas de conciliación entre cantidad esperada en previo vs. cantidad física capturada.
- **Plan de Implementación:** Documentado en `implementation_plan.md`.

---

## [1.2.5] — 2026-09-14

### 🚀 Sprint #2 — Tarea 1: Modelo de Datos `recepciones_previas` (Culminada)
- **Modelo Relacional en Prisma & Supabase PostgreSQL (`schema.prisma`):**
  - **Cliente (`clienteId`):** Relación íntegra de clave foránea hacia la tabla `Client` (depositante dueño de la carga).
  - **Factura de Respaldo (`facturaRespaldo`):** Persistencia oficial del folio o documento comercial/fiscal que ampara legalmente el ingreso, sincronizado con `ocReferencia`.
  - **Tipo de Importación (`tipoImportacion`):** Clasificación aduanal y operativa (`DEFINITIVA`, `TEMPORAL`, `TRANSITO`, `DEPOSITO_FISCAL`, `VIRTUAL`, `NO_APLICA`) combinada con el origen (`NACIONAL` / `IMPORTACION`).
  - **Lista de SKUs Esperados (`lineas: ReceiptLine[]`):** Colección relacional por producto (`skuId` ➔ `SkuMaster`), cantidad esperada programada (`cantidadEsperada`), tipo de contenedor (`tipoContenedor`), UOM (`uom`), valor factura (`precioUnitario`), lote esperado (`loteEsperado`), folio y sucursal.
  - **Atributos de Control y Candado Operativo:** Incorporación preventiva de `bloqueado`, `bloqueadoPor` y `fechaBloqueo` para la Tarea 3, así como metadatos de transporte (`folioTransporte`, `capacidadCarga`, `fechaTransporte`, `fechaArriboEstimada`).
- **DTO Oficial y Swagger (`CreateReceiptPrevioDto` & `PrevioLineItemDto`):**
  - Contrato formal tipado en `wms-backend/src/modules/operations/dto/previo.dto.ts` con decoradores `@ApiProperty` y documentación OpenAPI interactiva.
- **Normalización en Controlador Backend (`operations.controller.ts`):**
  - Manejo inteligente en `POST /api/receipts` y `PUT /api/receipts/:id` para normalizar facturas, tipos de importación y mapear la lista de SKUs esperados con auditoría completa.
- **Integración y Experiencia de Usuario en Frontend (`Receiving.tsx`):**
  - Formulario de captura de previos con campo explícito de *Factura de Respaldo* y selector de *Tipo de Importación*.
  - Modal de edición rápida (`⚙️`) actualizado con ambos campos.
  - Tabla principal de recepciones con despliegue visible de la *Factura de Respaldo* y badge dinámico de *Tipo de Importación* (`🚢 DEFINITIVA`).
  - Cabecera expandida del previo con metadatos completos y desglose de SKUs esperados.

---

## [1.2.4] — 2026-09-11

### 🚀 Novedades y Características Principales (Features)
- **Reporte Oficial 1:1 de Recepción y Devoluciones (Estilo PROVA 3PL) (`ReceiptReportModal.tsx` & `Receiving.tsx`):**
  - Réplica exacta 1:1 del formato oficial de operación logística en andén de **PROVA (Procesos de Valor Agregado)**.
  - **Membrete Corporativo Dual:** Logotipo oficial vectorial de PROVA con imagotipo y cintillo *"PROCESOS DE VALOR AGREGADO"*, alternable con el logo institucional de **Giving Out WMS 360+**.
  - **Código de Barras Code-128 con `JsBarcode`:** Generación vectorial nítida del `FOLIO TRANSPORTE` (ej. `23120690080`) directamente escaneable con terminales Zebra TC22 y lectores láser en bahía.
  - **Metadatos Oficiales de Transporte en Andén:** Despliegue de Fecha de Transporte, Folio de Transporte, Fecha/Hora de Confirmación (`2023-12-07 07:25:53`), Línea transportista (`TEMPAQ`), Capacidad de carga (`CAMION 3.5 TONELADA`), Placas (`7851ZP`) y Chofer auditado (`BRYAN CID ANGELES`).
  - **Tabla Principal de Manifiesto / Bultos:** Columnas oficiales `FOLIO`, `SUCURSAL` (`N1050001`, `N3040001`, `N1210001`), `TIPO` (`Caja devolucion`, `Bandeja azul`, `Caja máster`, `Tarima`), `PREVIO`, `CAJAS` y `DIFERENCIA`.
  - **Cuadro Resumen de Totales Agrupados:** Tabla inferior derecha con desglose automático por tipo de contenedor y cálculo de Gran Total de bultos físicos.
  - **Doble Vista de Auditoría:** Alternancia instantánea entre la vista de *Manifiesto de Bultos (1:1 PROVA)* para transportistas y la vista de *Detalle por SKU* con EAN-13, descripción, conformes y mermas para el cliente depositante.
  - **Firmas de Validez Legal:** Casilleros formales para el *Operador Transportista ("Entregó de conformidad")* y *Supervisor de Almacén CEDIS ("Recibió y validó físicamente")*.
  - **Exportación Limpia:** Impresión directa a PDF en hoja carta portrait calibrada sin páginas en blanco y función de compartir resumen ejecutivo por WhatsApp.
- **Blindaje de Modalidad y Consistencia Operativa:**
  - Integración de **Modalidad Dual** (`Recepción Normal` vs `Devolución`) con badges visuales distintivos (`📦 Normal` en verde y `🔄 Devolución` en rojo) en la tabla principal de recepciones.
  - El Reporte Oficial hereda fijamente la verdad del previo registrado (`Modalidad Oficial: 🔄 DEVOLUCIÓN` o `📦 RECEPCIÓN NORMAL`), impidiendo la alteración accidental o falseamiento del documento.
  - Posibilidad de rectificar el tipo de operación ante errores humanos desde el modal de edición de metadatos de previo (`⚙️`).
  - Selector de modalidad integrado en el formulario de alta de nuevo previo (`[☁️ Cargar Previo (ASN)]`).
- **Planificación y Análisis Técnico del Sprint #2 ("Carga de Previos y Documentos de Entrada"):**
  - Mapeo y arquitectura de los 6 entregables del checklist oficial:
    1. Modelo de datos relacional de recepciones previas.
    2. Endpoint robusto de previo (manual y archivo Excel).
    3. Vista de captura con candado de bloqueo de edición tras confirmar arribo a andén.
    4. Validación automática de SKUs cruzada con el catálogo del depositante.
    5. Estatus oficiales de recepción: *Pendiente de Arribo*, *En Proceso de Conteo* y *Cerrada*.
    6. Documentación Swagger y validaciones de API ante datos incompletos.

---

## [1.2.3] — 2026-08-26

### 🚀 Novedades y Características Principales (Features)
- **Campana de Notificaciones Interactiva en TopBar (`TopBar.tsx`):**
  - Badge numérico acumulado de notificaciones no leídas (`10`, `3`, `99+`).
  - Panel desplegable flotante animado para consulta rápida de **Nuevos Pedidos de Despacho**, **Alertas de Inventario** y **Conteos Cíclicos**.
  - Redirección automática al módulo correspondiente al hacer clic en la notificación (`/despacho`, `/alertas`, `/conteo-ciclico`, etc.).
  - Botón de descarte individual (`❌`) para eliminar notificaciones irrelevantes sin salir de la vista actual.
  - Botones globales para **"Marcar todas como leídas"** (`CheckCheck`) y **"Limpiar todas"** (`Trash2`).
- **Filtrado Dinámico por Zona, Ubicación y SKU en Conteos Cíclicos (`CycleCount.tsx` & `operations.controller.ts`):**
  - Despliegue de selectores dinámicos al programar un conteo cíclico (Zonas reales con conteo de ubicaciones, posiciones exactas del almacén o SKUs específicos).
  - Filtrado en backend (`@Post('cycle-counts')`) para incluir en la orden de conteo únicamente el stock real de la Zona/Ubicación elegida.
  - Banner explicativo dinámico en pantalla antes de confirmar la creación del conteo.
- **Eliminación y Gestión de Conteos Cíclicos (`DELETE /api/cycle-counts/:id`):**
  - Endpoint `DELETE /cycle-counts/:id` en backend NestJS para borrado seguro en cascada de líneas y orden de conteo.
  - Botón de **Eliminar (🗑️)** incorporado en las tarjetas de la lista y en la barra de revisión del conteo para eliminar conteos vacíos o no requeridos.
- **Reemplazo Total de Alertas Nativas del Navegador (`alert` / `confirm`):**
  - Modal interactiva personalizada para la finalización de conteos cíclicos con resumen de impacto en 3 métricas en tiempo real (Líneas, Diferencias, Unidades a Ajustar).
  - Sustitución de alertas genéricas del navegador por banners de advertencia integrados en `ReceiptPrintModal.tsx` y `CycleCount.tsx`.
- **Manejador de Errores de Red en Español:**
  - Captura y traducción automática del error nativo `Failed to fetch` a mensajes comprensibles en español (*"❌ No se pudo conectar con el servidor backend..."*).

---

## [1.2.2] — 2026-08-18

### 🚀 Novedades y Características Principales (Features)
- **Generación Automática de Códigos de Barras EAN-13 (`POST /api/receipts/:id/generate-barcodes`):**
  - Botón rápido **"⚡ Generar Códigos EAN-13"** a nivel de previo y por línea para asignar automáticamente códigos EAN-13 (estándar GS1 México con prefijo `750` y dígito de control verificador) a todos los productos/SKUs del previo que carezcan de código de barras.
  - Actualización inmediata en base de datos (`SkuMaster.codigoBarras`) y refresco instantáneo de la tabla sin recargar la página.
- **Modal PRO de Impresión de Etiquetas Térmicas (`ReceiptPrintModal`):**
  - Impresión masiva o individual de etiquetas para preparación previa a la descarga física.
  - Modos de impresión seleccionables:
    - **Por Pieza / SKU:** 1 etiqueta por cada unidad esperada para etiquetar prendas individuales.
    - **Por Caja / Empaque:** Cálculo automático de etiquetas según `capacidadEmpaque`.
    - **Por Pallet / Tarima:** Etiqueta maestra con resumen de bultos y previo.
  - Formatos de salida configurables:
    - **50 x 25 mm:** Etiqueta térmica para prendas de ropa, textil y retail.
    - **100 x 50 mm (4x2"):** Etiqueta térmica estándar para cajas, bultos y tarimas.
  - Vista previa en tiempo real renderizada mediante `JsBarcode` (SVG de alta fidelidad).
  - Impresión directa con hojas de estilo `@media print` optimizadas para impresoras térmicas (Zebra, Brother, Epson).
- **Escaneo Rápido con Handheld Zebra TC22:**
  - Barra de búsqueda y escaneo directo en el detalle del previo: al escanear con la terminal Zebra TC22 un código EAN o SKU, el sistema localiza la línea, abre el formulario de ingreso dual y preselecciona la ubicación física sugerida por el motor putaway.
- **Asignación y Confirmación de Ubicaciones Físicas en Etiquetas:**
  - Integración del catálogo de ubicaciones en el modal de impresión para que el supervisor asigne o modifique la ubicación física destino (`A01-R01-N1`, etc.) por cada SKU antes de mandar a imprimir.
  - Impresión visible de la **Ubicación Destino** en el cuerpo de las etiquetas térmicas (50x25mm y 100x50mm) para guiar directamente al operador en la colocación física durante el escaneo con handheld.
- **Diálogo PRO de Confirmación de Impresión (Protección de Insumos Térmicos):**
  - Pantalla interactiva previa al envío a la impresora con resumen de total de etiquetas, tipo de rollo térmico, desglose de SKUs y ubicaciones confirmadas, previniendo el desperdicio accidental de papel y cinta térmica.
- **Botón de Etiqueta de Prueba (1 ud) / Calibración Térmica:**
  - Botón rápido **"🧪 Imprimir 1 Etiqueta de Prueba"** accesible tanto en la barra de vista previa, por línea de producto y en el diálogo de confirmación. Permite mandar una sola etiqueta a la impresora Zebra/Brother para validar alineación, contraste y legibilidad con el lector láser de la handheld antes de imprimir tirajes de cientos de etiquetas.
- **Corrección de Transparencia y Z-Index en `LocationSelect`:**
  - Fondo blanco 100% opaco (`#ffffff`) y elevación de `z-index` a 99,999 para eliminar cualquier sangrado visual de las tablas de fondo al desplegar el buscador de ubicaciones.
- **Registro de Auditoría de Impresión (`POST /api/print-log`):**
  - Trazabilidad de quién, cuándo y cuántas etiquetas se mandaron a imprimir por previo.

---

## [1.2.1] — 2026-08-14

### 🚀 Novedades y Características Principales (Features)
- **Mejora del Parser de Previo de Recibo (Excel):**
  - Soporte nativo para la estructura de plantilla oficial del operador: `factura`, `Ean`, `Cantidad a recibir`.
  - Normalización inteligente de encabezados (`factura`/`oc`, `Ean`/`codigo`/`sku`, `Cantidad a recibir`/`cantidad`).
  - Búsqueda y validación dual de SKUs: compara tanto por `codigo` interno como por `codigoBarras` (EAN-13) del cliente depositante.
  - Auto-detección y llenado automático del campo `ocReferencia` a partir de la columna `factura`.
- **Previsualización & Validación en Tiempo Real en Modal:**
  - Métricas instantáneas de líneas leídas, SKUs válidos coincidentes y alertas con listado de códigos no registrados.
  - Mini-tabla interactiva con las líneas detectadas antes de confirmar la creación del previo.
  - Botón para **Descargar Plantilla Oficial (.xlsx)** directamente desde el modal.
- **Motor Inteligente de Asignación de Ubicaciones (Putaway Engine & Layout):**
  - Algoritmo automático basado en el layout del almacén, categoría del SKU (Textil/Prendas en `ALM-A`, Alimentos en `ALM-B`, Cuarentena en `DEVOLUCION`/`DEV`), regla de rotación del depositante (`FIFO` en Nivel 1 suelo para picking rápido vs `FEFO`), consolidación con SKUs existentes y cálculo dinámico de espacio disponible.
  - Pre-selección y auto-asignación automática de la ubicación óptima al abrir la línea de ingreso tanto para **Zona Conforme** como para **Zona No Conforme / Cuarentena**.
- **Componente PRO de Selección de Ubicaciones (`LocationSelect`):**
  - Reemplazo total del `<select>` genérico nativo por un selector empresarial interactivo con tarjeta visual de ubicación, badge de zona, barra de capacidad y tag `⭐ Sugerencia IA/Layout`.
  - Buscador integrado en tiempo real (por pasillo, rack, nivel, zona o código) y pestañas de filtrado (`⭐ Sugeridas`, `📍 Misma Zona`, `🟢 100% Libres`, `📦 Todas`).
  - Control manual total para que el operador pueda cambiar o anular la sugerencia fácilmente si así lo desea.

---

## [1.2.0] — 2026-06-09

### 🚀 Novedades y Características Principales (Features)
- **Recepción Dual (Conforme / No Conforme):**
  - Segmentación automática del inventario recibido en dos estados de calidad:
    - **Zona Conforme:** Lotes con estado `LIBERADO` asignados a ubicaciones estándar de almacenamiento (ej. `ALM-A`).
    - **Zona No Conforme / Cuarentena:** Lotes con estado `BLOQUEADO` asignados automáticamente a ubicaciones de cuarentena o retención.
  - Asignación inteligente y sugerencia de ubicaciones libres según capacidad (`Location.capacidadUnits` / `ocupacion`).
- **Previo de Recibo (Carga masiva vía Excel):**
  - Módulo en frontend para importar archivos `.xlsx` usando la librería `xlsx`.
  - Mapeo automático de columnas `Codigo` y `Cantidad` cruzado con el catálogo de SKUs del depositante seleccionado.
  - Registro de metadatos de transporte: `origen` (Nacional / Importación), `lineaTransporte`, `placa`, `nombreChofer` y persistencia de `archivoPrevioUrl`.
- **Gestión Avanzada de Pallets y Handling Units (HU):**
  - Soporte de configuración de pallets (`HandlingUnit`) para seguimiento de bultos/pallets completos en la recepción y almacenamiento.

### 🐛 Correcciones (Bug Fixes)
- `44a71ea` - **fix:** Corrección de importación de `React` faltante en `wms-frontend/src/pages/Receiving.tsx`.
- `cd65a42` - **fix:** Resolución de errores de tipado TypeScript en los arreglos y listas de recepción (`reception arrays`).

### 📦 Commits en esta versión
- `44a71ea` (2026-06-09) `fix: add React import to Receiving.tsx`
- `cd65a42` (2026-06-09) `fix: typing errors on reception arrays`
- `18bd510` (2026-06-09) `feat: integracion de recepcion dual y configuracion de pallets`

---

## [1.1.0] — 2026-05-20

### 🚀 Novedades y Características Principales (Features)
- **Portal de Depositantes (`/portal`):**
  - Nueva interfaz exclusiva y aislada para clientes depositantes del 3PL:
    - `PortalLayout.tsx`: Shell de navegación independiente adaptado al depositante.
    - `PortalDashboard.tsx`: Métricas clave, volumen de inventario y pedidos en curso del cliente.
    - `PortalInventory.tsx`: Consulta en tiempo real de existencias y lotes propios.
    - `PortalOrders.tsx`: Historial y seguimiento de órdenes solicitadas.
    - `PortalNewOrder.tsx`: Formulario de solicitud de pedidos de salida hacia sus clientes finales.
  - Enrutamiento inteligente (`SmartRedirect`): Redirección automática de usuarios depositantes (`user.clienteId`) a `/portal` al iniciar sesión.
- **Módulo de Clientes Finales (End Customers / Ship-To):**
  - Nuevo modelo `EndCustomer` asociado al depositante (`clienteId` + `codigo` único).
  - Gestión completa de destinos de entrega finales (ej. Sanborns Reforma, Liverpool Santa Fe) con direcciones de entrega, contactos e instrucciones especiales de descarga.
  - Nueva página administrativa `EndCustomers.tsx` y controlador `end-customers.controller.ts`.
- **Flujo de Aprobación de Pedidos 3PL:**
  - Los pedidos creados por depositantes ingresan en estado `SOLICITADO` / `PENDIENTE_APROBACION`.
  - El operador de Giving Out revisa, aprueba (`APROBADO`) o rechaza con motivo (`motivoRechazo`) antes de pasar a Picking.
  - Nuevo modelo de auditoría `OrderApproval` para trazabilidad de quién aprobó y cuándo.
- **Jerarquía de Unidades de Medida (UOM Conversions):**
  - Nuevo modelo `UomConversion` para soportar jerarquías: `MASTER` → `CAJA` → `INNER` → `PZA` con factor de conversión y código de barras por nivel de empaque.
  - Controlador `uom.controller.ts` para endpoints de conversión.
- **Mejoras en Picking y Despacho:**
  - Asociación de pedidos al cliente final (`endCustomerId`).
  - Soporte de paqueterías (`DHL`, `FEDEX`, `ESTAFETA`, etc.), número de guía y adjuntos de guía (`guiaUrl`).
  - Registro de eventos de tracking (`DispatchTracking`) con firma digital y geolocalización.

### 🐛 Correcciones (Bug Fixes)
- `6413d98` - **fix:** Manejo robusto de errores por código de cliente duplicado en la creación de depositantes (`clients.controller.ts`).

### 📦 Commits en esta versión
- `6413d98` (2026-05-20) `fix: handle duplicate code error on client creation`
- `fcbd805` (2026-05-20) `feat: implement client portal (depositantes) and end-customers module`

---

## [1.0.1] — 2026-04-14

### 🐛 Correcciones (Bug Fixes) & Deploy
- `1c234dc` - **fix:** Actualización de `DEPLOY_GUIDE.md` para incluir `--include=dev` en el comando de build de Render (`npm install --include=dev && npx prisma generate && npm run build`), resolviendo fallos en la compilación de NestJS al requerir dependencias de desarrollo (`@nestjs/cli`, `typescript`).

### 📦 Commits en esta versión
- `1c234dc` (2026-04-14) `fix: update deploy guide - include devDependencies in Render build command`

---

## [1.0.0] — 2026-04-13

### 🎉 Lanzamiento Inicial (Initial Release)
- **Sistema WMS 360+ Completo para Operador 3PL Giving Out:**
  - **Backend (NestJS + Prisma + Supabase PostgreSQL):**
    - 16 modelos relacionales principales.
    - Más de 55 endpoints REST con documentación interactiva Swagger en `/api/docs`.
    - Módulos: `auth`, `users`, `clients`, `master-data`, `inventory`, `operations`.
    - Servicio de correo SMTP (`email.service.ts`) para notificaciones operativas.
    - Autenticación JWT con RBAC granular (10 roles con permisos por módulo y acción).
  - **Frontend (React + Vite + TypeScript):**
    - 15 páginas administrativas responsive con diseño moderno y soporte para escáneres handheld.
    - Dashboard con métricas operativas en tiempo real.
    - Gestión de Almacenes, Zonas y Ubicaciones (`Locations.tsx`).
    - Catálogo Maestro de SKUs (`MasterData.tsx`) con soporte multi-industria (Ropa y Alimentos).
    - Recepción con asignación automática de ubicaciones (`Receiving.tsx`).
    - Inventario por Lotes y Handling Units con soporte FEFO/FIFO (`Inventory.tsx`).
    - Picking y Despacho con liberación automática de ubicaciones (`Picking.tsx`, `Dispatch.tsx`).
    - Módulo de Conteo Cíclico optimizado para Zebra TC22 (`CycleCount.tsx`).
    - Motor de Alertas Inteligentes con auto-detección y asignación de tareas (`Alerts.tsx`).
    - Línea de tiempo de Trazabilidad Completa (`Traceability.tsx`).
    - Previsualización e Impresión de Etiquetas térmicas (`LabelPreview.tsx`).
    - Panel de Administración y Configuración del Sistema (`AdminPanel.tsx`).
  - **Documentación:**
    - `docs/WMS_DOCUMENTACION_V1.md`: Manual técnico y funcional exhaustivo.
    - `docs/INTEGRACION_CONTPAQI_NUBE.md`: Especificación de arquitectura para sincronización futura con CONTPAQi Nube.
    - `docs/DEPLOY_GUIDE.md`: Guía paso a paso para despliegue en Render y Vercel.

### 📦 Commits en esta versión
- `7ff5471` (2026-04-13) `feat: Giving Out WMS v1.0.0 — Full warehouse management system`
