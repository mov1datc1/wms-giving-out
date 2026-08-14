# 📋 Changelog — Giving Out WMS

Todos los cambios notables y versiones del proyecto **Giving Out WMS (3PL Operador Logístico)** están documentados en este archivo.

El formato sigue las directrices de [Keep a Changelog](https://keepachangelog.com/es-ES/1.0.0/) y se adhiere a [Semantic Versioning](https://semver.org/lang/es/).

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
