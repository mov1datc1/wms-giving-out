# 📋 Changelog — Giving Out WMS

Todos los cambios notables y versiones del proyecto **Giving Out WMS (3PL Operador Logístico)** están documentados en este archivo.

El formato sigue las directrices de [Keep a Changelog](https://keepachangelog.com/es-ES/1.0.0/) y se adhiere a [Semantic Versioning](https://semver.org/lang/es/).

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
