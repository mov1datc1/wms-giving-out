# 📦 Giving Out WMS — Documentación Técnica v1.0

**Versión:** 1.0.0  
**Fecha:** Abril 2026  
**Desarrollado por:** MOVIDA TCI  
**Cliente:** Giving Out — Almacén 3PL, Tepotzotlán, Estado de México

---

## Tabla de Contenidos

1. [Descripción General](#1-descripción-general)
2. [Stack Tecnológico](#2-stack-tecnológico)
3. [Arquitectura del Sistema](#3-arquitectura-del-sistema)
4. [Infraestructura y Despliegue](#4-infraestructura-y-despliegue)
5. [Variables de Entorno](#5-variables-de-entorno)
6. [Modelo de Datos](#6-modelo-de-datos)
7. [API REST — Endpoints](#7-api-rest--endpoints)
8. [Módulos del Sistema](#8-módulos-del-sistema)
9. [Sistema de Autenticación](#9-sistema-de-autenticación)
10. [Notificaciones por Email](#10-notificaciones-por-email)
11. [Integraciones Externas](#11-integraciones-externas)
12. [Instalación y Desarrollo Local](#12-instalación-y-desarrollo-local)
13. [Troubleshooting](#13-troubleshooting)
14. [Roadmap](#14-roadmap)

---

## 1. Descripción General

Giving Out WMS es un **Sistema de Gestión de Almacén (Warehouse Management System)** diseñado para operaciones 3PL (Third-Party Logistics) en un almacén de ~150m² que maneja mercancía de múltiples clientes con diferentes naturalezas de producto (ropa y alimentos).

### Características Clave
- **Multi-cliente:** Inventario segregado por cliente con trazabilidad independiente
- **Multi-producto:** Soporte para ropa (2-3K SKUs, tallas, colores) y alimentos (lotes, fechas de vencimiento, FEFO)
- **Control de ubicaciones:** Rack-pasillo-nivel con gestión de capacidad
- **Trazabilidad completa:** Línea de tiempo de todo movimiento de inventario
- **Alertas inteligentes:** Detección automática de stock bajo, vencimientos, pedidos atrasados
- **Gestión de tareas:** Asignación de tareas desde alertas con notificación por email
- **Conteo cíclico:** Con soporte para dispositivos Zebra TC22 (barcode scanning)
- **Mobile-First:** Diseño responsive optimizado para handheld scanners

### Usuarios del Sistema
| Rol | Permisos Principales |
|---|---|
| Super Admin | Acceso total, configuración |
| Gerente Operaciones | Recepción, inventario, picking, despacho |
| Operador Recepción | Recepción, escaneo, etiquetado |
| Operador Picking | Surtido, empaque, staging |
| Supervisor Almacén | Tareas, discrepancias, movimientos |
| ATC / Comercial | Stock, cotización, pedidos |
| Cliente Portal | Su inventario, pedidos, reportes |

---

## 2. Stack Tecnológico

### Backend
| Tecnología | Versión | Uso |
|---|---|---|
| **NestJS** | 11.x | Framework backend (TypeScript) |
| **Prisma ORM** | 7.x | ORM y migraciones de base de datos |
| **PostgreSQL** | 15+ | Base de datos relacional (via Supabase) |
| **Swagger/OpenAPI** | 11.x | Documentación automática de API |
| **JWT** | 11.x | Autenticación basada en tokens |
| **bcrypt** | 6.x | Hashing de contraseñas |
| **Nodemailer** | 8.x | Envío de correos SMTP |
| **@nestjs/schedule** | 6.x | Tareas programadas (cron jobs) |
| **Axios** | 1.x | HTTP client para integraciones |

### Frontend
| Tecnología | Versión | Uso |
|---|---|---|
| **React** | 18.x | Biblioteca UI |
| **Vite** | 5.x | Build tool y dev server |
| **TypeScript** | 5.x | Tipado estático |
| **React Router** | 7.x | Navegación SPA |
| **Recharts** | 3.x | Gráficos y KPIs |
| **Lucide React** | 1.x | Iconografía |
| **JsBarcode** | 3.x | Generación de códigos de barras |
| **QRCode** | 1.x | Generación de códigos QR |

### Infraestructura
| Servicio | Proveedor | Propósito |
|---|---|---|
| **Base de datos** | Supabase (PostgreSQL) | Persistencia de datos |
| **Backend Hosting** | Render (futuro) | API REST |
| **Frontend Hosting** | Vercel (futuro) | SPA React |
| **Email** | mail.movidatci.com | Notificaciones SMTP |

---

## 3. Arquitectura del Sistema

```
┌─────────────────────────────────────────────────────────────┐
│                     INTERNET / CLIENTE                      │
└─────────┬───────────────────────────────────┬───────────────┘
          │                                   │
          ▼                                   ▼
┌──────────────────┐                ┌──────────────────┐
│ Frontend (React) │                │ Zebra TC22       │
│ Vercel / SPA     │                │ PWA Browser      │
│ Port: 5173 (dev) │                │ Barcode Scanner  │
└────────┬─────────┘                └───────┬──────────┘
         │ REST/JSON                        │ REST/JSON
         ▼                                  ▼
┌──────────────────────────────────────────────────────┐
│                 NestJS Backend API                    │
│                 Port: 3001 (dev)                      │
│                                                       │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌─────────┐ │
│  │ Auth     │ │ Master   │ │ Inventory│ │ Operat. │ │
│  │ Module   │ │ Data     │ │ Module   │ │ Module  │ │
│  └──────────┘ └──────────┘ └──────────┘ └─────────┘ │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐             │
│  │ Clients  │ │ Users    │ │ Email    │             │
│  │ Module   │ │ Admin    │ │ Service  │             │
│  └──────────┘ └──────────┘ └──────────┘             │
│                                                       │
│  ┌─────────────────────────────────────────────────┐ │
│  │            Prisma ORM + PrismaService           │ │
│  └──────────────────────┬──────────────────────────┘ │
└─────────────────────────┼────────────────────────────┘
                          │ SQL (SSL)
                          ▼
              ┌──────────────────────┐
              │  Supabase PostgreSQL │
              │  AWS us-east-1       │
              │  (Pooler IPv4)       │
              └──────────────────────┘
```

### Estructura del Proyecto

```
wms-giving-out/
├── wms-backend/
│   ├── prisma/
│   │   ├── schema.prisma          # 16 modelos, 727 líneas
│   │   └── seed.ts                # Datos iniciales
│   ├── src/
│   │   ├── main.ts                # Bootstrap + Swagger + CORS
│   │   ├── app.module.ts          # Módulo raíz
│   │   ├── prisma.service.ts      # Prisma client singleton
│   │   ├── email.service.ts       # Servicio de email SMTP
│   │   └── modules/
│   │       ├── auth/              # Login, JWT, OTP
│   │       ├── clients/           # CRUD multi-tenant clientes
│   │       ├── inventory/         # Lotes, HUs, movimientos
│   │       ├── master-data/       # SKUs, proveedores, ubicaciones, alertas, tareas, settings
│   │       ├── operations/        # Recepción, picking, despacho, conteo cíclico
│   │       └── users/             # Administración de usuarios y roles
│   ├── .env                       # Variables de entorno
│   └── package.json
├── wms-frontend/
│   ├── src/
│   │   ├── main.tsx               # Entry point + Router
│   │   ├── index.css              # Design system (58KB)
│   │   ├── config/api.ts          # API URL configuration
│   │   ├── contexts/AuthContext.tsx# Auth state management
│   │   ├── components/
│   │   │   └── Layout.tsx         # Sidebar + Header + Main
│   │   └── pages/                 # 15 páginas
│   │       ├── Login.tsx
│   │       ├── Dashboard.tsx
│   │       ├── Clients.tsx
│   │       ├── Suppliers.tsx
│   │       ├── Receiving.tsx
│   │       ├── Inventory.tsx
│   │       ├── Locations.tsx
│   │       ├── Picking.tsx
│   │       ├── Dispatch.tsx
│   │       ├── CycleCount.tsx
│   │       ├── Alerts.tsx
│   │       ├── Traceability.tsx
│   │       ├── LabelPreview.tsx
│   │       ├── MasterData.tsx
│   │       └── AdminPanel.tsx
│   └── package.json
└── docs/
    ├── WMS_DOCUMENTACION_V1.md    # 📌 Este documento
    └── INTEGRACION_CONTPAQI_NUBE.md
```

---

## 4. Infraestructura y Despliegue

### Desarrollo Local

| Componente | URL | Puerto |
|---|---|---|
| Frontend (Vite) | http://localhost:5173 | 5173 |
| Backend (NestJS) | http://localhost:3001 | 3001 |
| Swagger API Docs | http://localhost:3001/api/docs | 3001 |
| Base de Datos | Supabase Cloud (AWS us-east-1) | 5432 |

### Producción (Próximo Deploy)

| Componente | Plataforma | URL (planificado) |
|---|---|---|
| Frontend | Vercel | wms-giving-out.vercel.app |
| Backend | Render | wms-giving-out-api.onrender.com |
| Base de Datos | Supabase | sseegcltnozurxxieavj.supabase.co |
| Email SMTP | mail.movidatci.com | Puerto 465 (SSL) |

### Requisitos del Servidor
- **Node.js:** 20+ LTS
- **npm:** 10+
- **PostgreSQL:** 15+ (provisto por Supabase)

---

## 5. Variables de Entorno

### Backend (`wms-backend/.env`)

```env
# ═══════════════════════════════════════
# BASE DE DATOS — Supabase PostgreSQL
# ═══════════════════════════════════════
DATABASE_URL="postgresql://user:pass@pooler.supabase.com:5432/postgres"
DIRECT_URL="postgresql://user:pass@pooler.supabase.com:5432/postgres"

# ═══════════════════════════════════════
# AUTENTICACIÓN
# ═══════════════════════════════════════
JWT_SECRET="<clave-secreta-segura>"
JWT_EXPIRES_IN="24h"

# ═══════════════════════════════════════
# SERVIDOR
# ═══════════════════════════════════════
PORT=3001
NODE_ENV="development"    # development | production

# ═══════════════════════════════════════
# CORS
# ═══════════════════════════════════════
ALLOWED_ORIGINS="http://localhost:5173,https://wms-giving-out.vercel.app"

# ═══════════════════════════════════════
# SUPABASE (opcional, para storage)
# ═══════════════════════════════════════
SUPABASE_URL="https://xxx.supabase.co"
SUPABASE_ANON_KEY="sb_publishable_xxx"
```

### Frontend (`wms-frontend/.env`)

```env
VITE_API_URL=http://localhost:3001/api
```

### Configuraciones en Base de Datos (SystemSetting)

| Clave | Valor | Categoría | Descripción |
|---|---|---|---|
| `email.smtp_host` | mail.movidatci.com | email | Servidor SMTP |
| `email.smtp_port` | 465 | email | Puerto (465=SSL, 587=TLS) |
| `email.smtp_user` | wms@movidatci.com | email | Usuario SMTP |
| `email.smtp_pass` | ••••••• | email | Contraseña SMTP |
| `email.from_name` | Giving Out WMS | email | Nombre del remitente |

---

## 6. Modelo de Datos

### Diagrama de Entidades (16 modelos)

```
ALMACÉN                    INVENTARIO                OPERACIONES
─────────                  ──────────                ───────────
Warehouse ──── Zone        SkuMaster ──── LotInventory    Receipt ──── ReceiptLine
     └──── Location        HandlingUnit                   SalesOrder ── SalesOrderLine
                           InventoryMovement                   └── DispatchTracking
                           TraceabilityLink

COMERCIAL                  CONTEO CÍCLICO            ALERTAS / TAREAS
─────────                  ──────────────            ────────────────
Client ──── ClientContact  CycleCount ── CycleCountLine   Alert ──── Task
     └──── ClientAddress
Supplier                   AUDITORÍA                 AUTH / RBAC
SalesQuote ── QuoteLine    ──────────               ─────────
Reservation ── ReservLine  AuditLog                  User ──── Role ── RolePermission
                           PrintLog                  OtpCode
                                                    PlatformSettings

INTEGRACIÓN               CONFIG
───────────               ──────
IntegrationConfig         SystemSetting
SyncLog
```

### Modelos Principales

| # | Modelo | Tabla | Registros Clave |
|---|---|---|---|
| 0 | `Warehouse` | Almacenes | código, nombre, metros², zonas |
| 1 | `Zone` | Zonas lógicas | tipo (RECIBO, ALMACEN, PICKING...), temperatura |
| 2 | `Location` | Ubicaciones físicas | pasillo-rack-nivel, capacidad, ocupación, estado |
| 3 | `Client` | Clientes 3PL | RFC, giro, requisitos (lote/serie/caducidad) |
| 4 | `Supplier` | Proveedores | código, RFC, contacto |
| 5 | `SkuMaster` | Catálogo de productos | por cliente, categoría, talla, color, barcode, stock min/max |
| 6 | `LotInventory` | Inventario por lote | SKU + lote + ubicación, cantidades (disponible/reservada/bloqueada) |
| 7 | `HandlingUnit` | Unidades de manejo | tipo (PALLET, CAJA, BULTO), HU anidados |
| 8 | `InventoryMovement` | Movimientos | tipo (ENTRADA, SALIDA, TRASIEGO, AJUSTE), trazabilidad |
| 9 | `Receipt` / `ReceiptLine` | Recepciones | proveedor, líneas con cantidades esperadas/recibidas |
| 10 | `SalesOrder` / `SalesOrderLine` | Pedidos de salida | estado, picking, despacho, tracking |
| 11 | `CycleCount` / `CycleCountLine` | Conteos cíclicos | programados, ejecutados, discrepancias, ajustes |
| 12 | `Alert` | Alertas | tipo, prioridad, auto-generadas |
| 13 | `Task` | Tareas | área, asignado, estado, vinculada a alerta |
| 14 | `User` / `Role` / `RolePermission` | Auth y RBAC | roles granulares, permisos por módulo+acción |
| 15 | `IntegrationConfig` / `SyncLog` | Integración ERP | config CONTPAQi, historial de sync |
| 16 | `SystemSetting` | Configuración KV | SMTP, parámetros del sistema |

---

## 7. API REST — Endpoints

**Base URL (dev):** `http://localhost:3001`  
**Swagger UI:** `http://localhost:3001/api/docs`  
**Autenticación:** Bearer Token (JWT) en header `Authorization`

### 7.1 Autenticación

| Método | Endpoint | Descripción |
|---|---|---|
| `POST` | `/api/auth/login` | Login con email + password → JWT |
| `GET` | `/api/auth/me` | Obtener usuario autenticado |
| `POST` | `/api/auth/otp/request` | Solicitar código OTP por email |
| `POST` | `/api/auth/otp/verify` | Verificar código OTP |

### 7.2 Administración

| Método | Endpoint | Descripción |
|---|---|---|
| `GET` | `/api/admin/users` | Listar usuarios |
| `POST` | `/api/admin/users` | Crear usuario |
| `PUT` | `/api/admin/users/{id}` | Editar usuario |
| `DELETE` | `/api/admin/users/{id}` | Eliminar usuario |
| `GET` | `/api/admin/roles` | Listar roles |
| `POST` | `/api/admin/roles` | Crear rol |
| `PUT` | `/api/admin/roles/{id}/permisos` | Editar permisos del rol |
| `GET` | `/api/admin/settings` | Obtener configuración de plataforma |
| `PUT` | `/api/admin/settings` | Guardar configuración |
| `GET` | `/api/admin/audit-log` | Log de auditoría |

### 7.3 Clientes

| Método | Endpoint | Descripción |
|---|---|---|
| `GET` | `/api/clients` | Listar clientes |
| `POST` | `/api/clients` | Crear cliente |
| `GET` | `/api/clients/{id}` | Detalle de cliente |
| `PUT` | `/api/clients/{id}` | Editar cliente |
| `POST` | `/api/clients/{id}/contacts` | Agregar contacto |
| `POST` | `/api/clients/{id}/addresses` | Agregar dirección |
| `GET` | `/api/clients/{id}/inventory` | Inventario del cliente |

### 7.4 Catálogos (Master Data)

| Método | Endpoint | Descripción |
|---|---|---|
| `GET` | `/api/skus` | Listar SKUs (filtro: `?clienteId=`) |
| `POST` | `/api/skus` | Crear SKU |
| `PUT` | `/api/skus/{id}` | Editar SKU |
| `GET` | `/api/suppliers` | Listar proveedores |
| `POST` | `/api/suppliers` | Crear proveedor |
| `PUT` | `/api/suppliers/{id}` | Editar proveedor |
| `GET` | `/api/warehouses` | Listar almacenes |
| `POST` | `/api/warehouses` | Crear almacén |
| `GET` | `/api/zones` | Listar zonas |
| `POST` | `/api/zones` | Crear zona |
| `GET` | `/api/locations` | Listar ubicaciones |
| `POST` | `/api/locations` | Crear ubicación |
| `PUT` | `/api/locations/{id}` | Editar ubicación |

### 7.5 Inventario

| Método | Endpoint | Descripción |
|---|---|---|
| `GET` | `/api/inventory/lots` | Listar lotes con stock |
| `GET` | `/api/inventory/handling-units` | Listar unidades de manejo |
| `GET` | `/api/inventory/summary` | Resumen de inventario |
| `GET` | `/api/inventory/movements` | Historial de movimientos |

### 7.6 Operaciones

| Método | Endpoint | Descripción |
|---|---|---|
| `GET` | `/api/receipts` | Listar recepciones |
| `POST` | `/api/receipts` | Crear recepción |
| `POST` | `/api/reception` | Procesar recepción (crea lotes, HUs, movimientos, actualiza ubicaciones) |
| `GET` | `/api/orders` | Listar pedidos |
| `POST` | `/api/orders` | Crear pedido de salida |
| `PUT` | `/api/orders/{id}/status` | Cambiar estado de pedido |
| `POST` | `/api/orders/{id}/dispatch` | Despachar pedido (libera ubicaciones, actualiza stock) |
| `POST` | `/api/movements` | Registrar movimiento manual |
| `GET` | `/api/traceability` | Línea de tiempo de trazabilidad |
| `GET` | `/api/cycle-counts` | Listar conteos cíclicos |
| `POST` | `/api/cycle-counts` | Programar conteo cíclico |
| `PUT` | `/api/cycle-counts/{id}/count` | Registrar conteo (barcode scan) |
| `POST` | `/api/cycle-counts/{id}/finalize` | Finalizar conteo (ajustar stock real) |

### 7.7 Alertas y Tareas

| Método | Endpoint | Descripción |
|---|---|---|
| `GET` | `/api/alerts` | Listar alertas (`?todas=true` para incluir resueltas) |
| `POST` | `/api/alerts` | Crear alerta manual |
| `POST` | `/api/alerts/generate` | Escanear inventario y generar alertas automáticas |
| `PUT` | `/api/alerts/{id}/resolve` | Marcar alerta como resuelta |
| `GET` | `/api/tasks` | Listar tareas |
| `POST` | `/api/tasks` | Crear tarea (con envío de email opcional) |
| `PUT` | `/api/tasks/{id}/status` | Actualizar estado de tarea |

### 7.8 Configuración del Sistema

| Método | Endpoint | Descripción |
|---|---|---|
| `GET` | `/api/settings` | Obtener configuraciones (`?category=email`) |
| `PUT` | `/api/settings` | Guardar configuraciones (batch) |
| `POST` | `/api/settings/test-email` | Probar conexión SMTP |

### 7.9 Dashboard

| Método | Endpoint | Descripción |
|---|---|---|
| `GET` | `/api/dashboard/stats` | KPIs y métricas del dashboard |
| `GET` | `/health` | Health check del servidor |

---

## 8. Módulos del Sistema

### 8.1 Dashboard
- KPIs en tiempo real: SKUs activos, lotes registrados, pedidos pendientes, alertas críticas
- Gráficos de distribución de inventario por zona
- Actividad reciente de movimientos

### 8.2 Clientes
- CRUD completo con contactos y direcciones de entrega
- Configuración por cliente: requiere lote, requiere serie, requiere caducidad
- Vista de inventario segregado por cliente

### 8.3 Proveedores
- Catálogo de proveedores con datos fiscales
- Vinculación automática en recepción de mercancía

### 8.4 Recepción (Inbound)
- Formulario completo: proveedor, cliente, líneas de producto
- Selección de proveedor de lista registrada
- Asignación automática de ubicaciones (basado en espacio, reglas, disponibilidad)
- Switch "sin vencimiento" para mercancía no perecedera (ej: ropa)
- Al procesar: crea lotes, handling units, movimientos de inventario, actualiza ocupación

### 8.5 Inventario
- Vista consolidada por lote con filtros avanzados
- Estado de calidad: LIBERADO / CUARENTENA / BLOQUEADO
- Exportación a CSV
- Scroll horizontal para tablas extensas

### 8.6 Ubicaciones
- Grid visual de pasillo-rack-nivel
- Estado: LIBRE / OCUPADO / BLOQUEADO
- Indicador de ocupación (% de capacidad)

### 8.7 Picking / Surtido
- Lista de pedidos pendientes de surtir
- Asignación de lotes y HUs a líneas de pedido
- Cambio de estado: PENDIENTE → EN_PICKING → CONSOLIDADO

### 8.8 Despacho
- Confirmación de salida con datos de vehículo, placa, despachador
- Tracking events: SALIDA_ALMACEN → EN_RUTA → ENTREGADO
- Al despachar: decrementa stock, libera ubicaciones

### 8.9 Conteo Cíclico
- Programación de conteos por SKU, ubicación o lote
- Clasificación ABC
- Escaneo con dispositivos Zebra TC22 (barcode input)
- Detección de discrepancias con porcentaje
- Finalización: ajusta stock real automáticamente

### 8.10 Alertas Inteligentes
- Generación automática al escanear inventario:
  - `STOCK_BAJO` — stock debajo del mínimo
  - `VENCIMIENTO_PROXIMO` — lotes a punto de vencer
  - `PEDIDO_ATRASADO` — pedidos fuera de fecha compromiso
  - `SIN_MOVIMIENTO` — inventario estancado
  - `UBICACION_SATURADA` — ubicaciones al límite
- Resolución manual con registro de usuario
- Programación de tareas desde alertas

### 8.11 Gestión de Tareas
- Creación desde alertas con auto-sugerencia de área y prioridad
- Áreas: Compras, Despacho, Inventario, Calidad, Almacén
- Prioridades: Baja → Media → Alta → Urgente
- Asignación de responsable con email
- Notificación automática por correo electrónico
- Vista expandible en cada alerta

### 8.12 Trazabilidad
- Línea de tiempo cronológica de todos los movimientos
- Agrupación por día con iconos por tipo de movimiento
- Filtros por tipo, cliente y búsqueda de texto
- Métricas de resumen (unidades ingresadas / despachadas)

### 8.13 Etiquetado
- Generación de etiquetas con código de barras (JsBarcode)
- Generación de códigos QR
- Formatos: HU, SKU, Ubicación, Pallet, Recepción
- Optimizado para impresoras Zebra

### 8.14 Panel de Administración
- **Usuarios:** CRUD con roles y estados
- **Roles:** 10 roles predefinidos con permisos granulares
- **Configuración:** Parámetros del sistema (key-value)
- **Correo SMTP:** Configuración centralizada de email con test de conexión

---

## 9. Sistema de Autenticación

### Flujo de Login y Guardia Global JWT/RBAC
```
1. POST /api/auth/login { email, password }
2. Backend: bcrypt.compare(password, user.passwordHash)
3. Respuesta: { token: JWT, user: { id, email, nombre, rol, permisos, permisosDetalle } }
4. Frontend: Bearer token en header Authorization (AuthContext + ModuleRoute por módulo/acción)
5. WmsAuthGuard (APP_GUARD): valida JWT Bearer contra User.activo y RolePermission en PostgreSQL (@Public / @RequireAccess), ignora headers x-user-role y aísla clienteId para Portal
6. Token expira en 24h (configurable via JWT_EXPIRES_IN)
```

### Credenciales por Defecto (Desarrollo)
```
Email:    admin@givingout.com
Password: admin123
Rol:      Super Admin
```

### OTP (Two-Factor - Preparado)
- Modelo `OtpCode` en base de datos
- Endpoints de solicitar y verificar OTP
- Integración con email para envío de código

---

## 10. Notificaciones por Email

### Configuración SMTP
- **Servidor:** mail.movidatci.com
- **Puerto:** 465 (SSL)
- **Usuario:** wms@movidatci.com
- **Administrable desde:** Panel Admin → Tab "Correo SMTP"
- **Almacenamiento:** Tabla `SystemSetting` (categoría: email)

### Emails que envía el sistema
| Evento | Template | Contenido |
|---|---|---|
| Tarea asignada | HTML profesional | Detalle de tarea, alerta origen, prioridad, fecha límite |
| OTP (futuro) | Código de verificación | Código de 6 dígitos |

### Servicio
- Archivo: `src/email.service.ts`
- Clase: `EmailService`
- Método: `sendTaskNotification(task)` — formato HTML con branding
- Método: `testConnection()` — verificar conectividad SMTP

---

## 11. Integraciones Externas

### Estado Actual
| Integración | Estado | Detalle |
|---|---|---|
| **CONTPAQi Nube** | 🟡 Preparado | Modelos `IntegrationConfig` y `SyncLog` en BD. Ver doc: `INTEGRACION_CONTPAQI_NUBE.md` |
| **Email SMTP** | ✅ Activo | Nodemailer con config en BD |
| **Supabase Storage** | 🟡 Preparado | Keys configuradas, sin uso actual |
| **Zebra TC22** | ✅ Activo | Input de barcode via navegador web |

### API Swagger
El backend genera documentación automática OpenAPI/Swagger accesible en:
```
http://localhost:3001/api/docs
```

---

## 12. Instalación y Desarrollo Local

### Requisitos Previos
- Node.js 20+
- npm 10+
- Git

### Clonar e Instalar

```bash
git clone <repo-url> wms-giving-out
cd wms-giving-out

# Backend
cd wms-backend
npm install
cp .env.example .env   # Configurar variables
npx prisma generate
npx prisma db push
npm run db:seed         # Datos iniciales

# Frontend
cd ../wms-frontend
npm install
```

### Ejecutar en Desarrollo

```bash
# Terminal 1 — Backend
cd wms-backend
npm run start:dev       # Hot reload en http://localhost:3001

# Terminal 2 — Frontend
cd wms-frontend
npm run dev             # Vite en http://localhost:5173
```

### Comandos Útiles

```bash
# Base de datos
npx prisma studio          # GUI de base de datos
npx prisma db push          # Sincronizar schema → BD
npx prisma generate         # Regenerar Prisma Client
npm run db:seed             # Poblar datos iniciales
npm run db:reset            # Reset completo + seed

# Build
npx nest build              # Build backend (TypeScript → JavaScript)
npm run build               # Build frontend (Vite → dist/)

# Producción
node dist/src/main.js       # Ejecutar backend compilado
npm run preview             # Preview frontend compilado
```

---

## 13. Troubleshooting

### ❌ Error: "Cannot find module @prisma/client"
```bash
cd wms-backend
npx prisma generate
```

### ❌ Error: "P1001: Can't reach database server"
- Verificar que `DATABASE_URL` en `.env` sea correcta
- Verificar conexión a internet (Supabase es remoto)
- Intentar con `DIRECT_URL` en lugar de pooler

### ❌ Error: "Port 3001 already in use"
```bash
lsof -ti :3001 | xargs kill -9
```

### ❌ El frontend no conecta con el backend
- Verificar que backend esté corriendo en puerto 3001
- Verificar `VITE_API_URL` en `.env` del frontend
- Verificar CORS en `main.ts` (acepta localhost por defecto)

### ❌ Prisma types desactualizados (IDE muestra errores)
```bash
cd wms-backend
npx prisma generate
# Reiniciar el IDE / TypeScript server
```

### ❌ Email no se envía
- Ir a Admin → Correo SMTP → "Probar Conexión"
- Verificar credenciales en tabla `SystemSetting`
- Verificar que el puerto 465 no esté bloqueado por firewall
- En desarrollo local, firewalls pueden bloquear conexiones SMTP

### ❌ Login falla con "Invalid credentials"
- Verificar que el seed haya corrido: `npm run db:seed`
- Credenciales default: `admin@givingout.com` / `admin123`
- Verificar que el hash bcrypt sea compatible con la versión instalada

### ❌ Las alertas no se generan
- Ir a Alertas → "Escanear Inventario"
- El sistema necesita datos de inventario (lotes con stock bajo, vencimientos próximos) para generar alertas
- Si no hay datos, crear recepciones primero

### ❌ Build falla con TypeScript errors
```bash
# Backend
cd wms-backend
npx prisma generate    # Primero regenerar Prisma
npx nest build         # Luego compilar

# Frontend
cd wms-frontend
npx tsc --noEmit       # Verificar errores de tipo
npm run build          # Build completo
```

---

## 14. Roadmap

### ✅ v1.0 — Fase 1: Core WMS
- [x] Autenticación JWT + RBAC
- [x] Multi-tenant (clientes con inventario segregado)
- [x] Recepción con auto-putaway
- [x] Inventario por lote con FEFO
- [x] Picking y despacho con liberación de ubicaciones
- [x] Conteo cíclico con barcode scanning
- [x] Alertas inteligentes con gestión de tareas
- [x] Notificaciones por email
- [x] Trazabilidad completa
- [x] Dashboard con KPIs
- [x] Panel de administración

---

## 15. Actualización Arquitectural y Operativa — Fase 3 (Layout Físico Real y Cierre E2E)

**Estado:** Certificada en integración E2E (`2026-11-11`) y promovida a `dev` para QA integral.

### 15.1 Layout Físico Oficial del Almacén (`G0001`–`G0045`)
- **45 Posiciones Físicas Operativas (`TARIMA_PISO`):**
  - **35 posiciones en Área Interior:** `G0001`–`G0035`.
  - **10 posiciones en Exterior Techado:** `G0036`–`G0045`.
- **Posiciones Designadas PNC (`G0036`, `G0041`, `G0042`):** Reservadas inicialmente para Producto No Conforme / Merma, excluidas del Putaway comercial y con mutabilidad bidireccional Comercial $\leftrightarrow$ PNC protegida mediante `PATCH /api/locations/:id/pnc-designation` (validación estricta de saldo/HUs, JWT + RBAC nivel supervisor y asiento en `AuditLog`).
- **6 Áreas Especiales Activas:** `REC-01`, `REC-02` (`RECIBO`), `STG-01`, `STG-02` (`STAGING`), `DEV-01` (`PISO`) y `NC-EXCESO-01` (`CUARENTENA`).
- **48 Racks Históricos (`Axx/Bxx`):** Desactivados (`activo = false`) y aislados exclusivamente en la pestaña histórica de `/locations` (`Locations.tsx`) para preservar trazabilidad sin interferir con Putaway, Picking o disponibilidad comercial.

### 15.2 Regla Física de Capacidad y Jerarquía de Handling Units
- **Capacidad Canónica (`1 posición física = 1 tarima`):** Toda posición `Gxxxx` tiene capacidad física estricta `capacidadBultos = 1`.
- **Tarima Master (`PALLET` / `TARIMA`) como Contenedor Logístico Padre:** Agrupa cajas hijas (`CAJA`) mediante `parentHuId` (`PLT-...` $\rightarrow$ `BOX-...`).
  - `PutawayEngineService` (`putaway-engine.service.ts`) reconoce consolidación sobre la misma Tarima Master (`isSamePalletConsolidation`) y excluye ubicaciones PNC.
  - En UI (`locationHuDisplay.ts`, `Locations.tsx`, `PutawayModal.tsx`), las Tarimas Master se muestran como contenedor logístico (`Contenedor de N cajas`) y **no** suman unidades al stock físico ni generan falsas alertas de discrepancia frente a `LotInventory`.

### 15.3 Hardening End-to-End de Recepción, Calidad, Etiquetado, Putaway y Cierre
- **Trazabilidad Obligatoria Lote / Caducidad (`inventory-operational-state.util.ts`):** `resolveTraceabilityRequirements`, `isMissingLotValue`, `parseStrictCalendarDate` y `validateMandatoryLotAndExpiry` bloquean faltantes de lote o centinelas inválidos, formatos de fecha erróneos y producto caducado (`exp <= hoy`) en previo, conciliación, etiquetado, Putaway y cierre.
- **Control en Rampa y Etiquetado (`Receiving.tsx`, `RampArrivalModal.tsx`, `DualLabelModal.tsx`):** Validación explícita sin sello por defecto (`INTACTO`, `ROTO`, `SIN_SELLO`, `NO_APLICA`), firmas legales y reflejo exacto del andén asignado (`Andén 01`, vía `receipt.andenAsignado`) en etiquetas térmicas.
- **Calidad Conforme vs. Rescate Real (`operations.controller.ts`, `qualityReportClassification.ts`, `ReceiptReportModal.tsx`, `QualityInspectionModal.tsx`):**
  - Las liberaciones 100% conformes en andén registran `totalPiezasRescatadas = 0` y `totalPiezasInspeccionadas = conformes`.
  - Reporte Principal, Firma 2 y Anexo B distinguen *Liberación Técnica de Calidad en Andén (`LIBERADO / CONFORME`)* de *Inspección / Reacondicionamiento por Daño*, conservando compatibilidad histórica sin alterar datos en BD.
- **Cierre Atómico e Idempotente (`POST /api/receipts/:id/close`) y `AuditLog`:** Bloquea cierre si faltan etapas (conteo, calidad, etiquetas), HUs comerciales, `LotInventory` balanceado, ubicación almacenable, lote/caducidad vigentes o clasificación de discrepancias; mantiene idempotencia sobre stock/movimientos y genera el asiento `CERRAR_RECEPCION` en `AuditLog`.

### 15.4 Inventario, Ubicaciones y Trazabilidad / Kárdex
- **Renderizado Calendar-Day (`dateUtils.ts`, `traceabilityDisplay.ts`, `Traceability.tsx`, `PutawayModal.tsx`):** Todas las vistas críticas (`Inventario`, `Ubicaciones`, `Picking`/`OrderPreparationModal`, `Reportes`, `Putaway` y `Trazabilidad` + CSV) formatean fechas de caducidad como día calendario (`2027-06-30` $\rightarrow$ `30/06/2027`), eliminando desfases `-1` día por huso UTC local.
- **Terminología `posición física` vs `rack` Histórico (`inventory.controller.ts`, `operations.controller.ts`, `traceabilityDisplay.ts`):** `GET /api/inventory/movements` incluye `tipoUbicacion`; los nuevos movimientos usan `formatDestinationLocationPhrase` (`en posición física <CODIGO>` en `TARIMA_PISO` vs `a rack <CODIGO>` en `ESTANTERIA`/`RACK`), mientras la UI formatea descripciones históricas heredadas sin mutar registros inmutables de `InventoryMovement`.

### 15.5 Validación Automatizada, Evidencia E2E y Baseline Pre-QA
- **Suites Jest Backend (`5/5 suites`, `32/32 tests PASS`):** `putaway-engine.service.spec.ts`, `receipt-closure.spec.ts`, `quality-inspection.spec.ts`, `location-hu-display.spec.ts` y `traceability-display.spec.ts`.
- **Certificación E2E (`REC-2026-0020`):** Ciclo completo `Previo → Rampa → Calidad → Etiquetas → Putaway → Cierre` (`estado = CERRADA`, `24/24/24`, `0` merma, `0` faltante, lote `LOT-QA-E2E-001`, caducidad `2027-06-30`, `1` Tarima Master + `2` cajas x `12 PZA` en `G0001` `1/1`, `LotInventory = 24 PZA LIBERADO`, `InventoryMovement = 2 TRASIEGOS REC-01 → G0001`). Control `REC-2026-0019` intacto en `PENDIENTE_ARRIBO` (`18` esperadas / `0` recibidas).
- **Respaldo Recomendado Pre-QA:** Antes de ejecutar pruebas destructivas o funcionales de la etapa de **QA integral del sistema en `dev`**, tomar un snapshot completo de la base de datos como baseline estable de cierre de Fase 3.

---

## 16. Actualización Bloque 1 RC — Auth/RBAC Global, Dashboard Real y Catálogos 3PL

**Estado:** Aprobado en QA Bloque 1 (`0 BLOQUEANTES`, `0 ALTOS`) e integrado en `dev` (`main` intacta sin deploy).

### 16.1 Seguridad Transversal JWT/RBAC y Aislamiento Multi-Tenant
- **`WmsAuthGuard` (`APP_GUARD`), `@Public()` y `@RequireAccess()` (`auth.decorators.ts`, `wms-auth.guard.ts`):** Protección obligatoria en `AdminController`, `ClientsController`, `EndCustomersController`, `MasterDataController`, `InventoryController`, `OperationsController` y `UomController`. Cualquier petición sin Bearer JWT, con `'demo-token'`, JWT inválido o usuario inactivo recibe `401 Unauthorized`; permisos insuficientes o acceso Portal prohibido devuelven `403 Forbidden`.
- **Anti-Spoofing (`x-user-role`):** `ClientsController` (`resolveVerifiedActor`) y `WmsAuthGuard` ignoran por completo `x-user-role`; se eliminó el switch `"Probar como Operario"` en `Clients.tsx`.
- **Multi-Tenancy Portal (`req.user.clienteId`):** Aislamiento obligatorio de `clienteId` en `ClientsController`, `EndCustomersController`, `MasterDataController` (`GET /api/skus`), `InventoryController` (`lots`, `handling-units`, `summary`, `movements`, `consolidated`) y `OperationsController` (`orders`, `orders/:id`, `createOrder`, `dashboard/stats`), junto con cierre del bypass sin auth en `finalizeCycleCount`.
- **Frontend (`AuthContext.tsx`, `main.tsx`, `Sidebar.tsx`, `TopBar.tsx`, `ReceiptReportModal.tsx`):** `GET /api/auth/me` retorna `permisosDetalle` (`modulo:accion`); `ModuleRoute` bloquea navegación directa no autorizada en SPA; `Proveedores` usa `['proveedores', 'maestros']` en lugar de `'depositantes'`; `TopBar` usa `<button class="topbar-user">` y `ReceiptReportModal.tsx` envía `Authorization: Bearer`.

### 16.2 Dashboard Ejecutivo WMS Real (`Dashboard.tsx`)
- Eliminados valores/textos hardcodeados (`239`, `72`, `274`, `66.7%`, `48 Racks`, `'1 en picking (100 pza)'`, `'REC-01'`, `'Alejandra'`) usando coalescencia `?? 0` y fetch por permisos.
- Conteo físico de piso calculado sobre posiciones activas (`l.activo !== false`): **45 posiciones** (`42` comerciales + `3` PNC; baseline `1/45` = `2.2%`, `44` libres, `24 PZA` vendibles, `0 Órdenes`).

### 16.3 Catálogos 3PL (`Clients`, `EndCustomers`, `Suppliers`)
- **Depositantes:** Campos fiscales independientes (`direccionFiscal`, `ciudad`, `estado`) y cálculo real de `totalTarimas` (`parentHuId || id`) excluyendo cajas hijas.
- **Clientes Finales y Proveedores:** Eliminación total de fallbacks demo (`demoClients`, `demoEndCustomers`, `demoSuppliers`), DTO whitelist, validación `P2002 -> 409 Conflict`, filtros de estado (`?activo=true|false|all`), edición, baja lógica (`DELETE`), reactivación (`PUT :id/reactivate`) y trazabilidad en `AuditLog`.

### 16.4 Validación Automatizada, Deudas Aceptadas y Siguiente Bloque
- **Pruebas:** `7/7 suites Jest` (**46/46 tests PASS**, incluyendo `wms-auth-rbac.spec.ts` y `block1-catalogs.spec.ts`), `npx nest build` PASS, `tsc -b && vite build` PASS, `git diff --check` PASS y Chrome headless E2E PASS (`0 consoleErrors`, `0 pageExceptions`, `0 unexpectedHttpErrors`).
- **Deudas No Bloqueantes Aceptadas:** `POST /api/auth/otp/request` sin envío SMTP (`WARNING` en Módulo A) y `3` registros previos `CLI-TEST-PUTAWAY-*` conservados como deuda de limpieza.
- **Siguiente Fase:** **BLOQUE 2 — REGRESIÓN OPERATIVA INBOUND POST-RBAC** (Recepción, Etiquetado, Inventario, Ubicaciones y Trazabilidad sobre `REC-2026-0020` / `G0001`), seguido de **BLOQUE 3 — PICKING + RESERVA + DESPACHO E2E**.

---

## 17. Actualización Bloque 2 RC — Regresión e Higiene Operativa Inbound Post-RBAC

**Estado:** Certificado **PASS** en Bloque 2 (**F**, **G**, **H**, **K**, **L**, **P** · `0 BLOQUEANTES`, `0 ALTOS`, `0 MEDIOS`) e integrado en `dev` (`main` intacta sin deploy).

### 17.1 Correcciones de Backend y Endpoints (`MasterDataController`, `OperationsController`)
- **Ubicaciones `bultosPorCliente` (`master-data.controller.ts`):** `GET /api/locations` agrupa HUs activas del depositante por contenedor físico raíz `(hu.parentHuId || hu.id)` mediante `distinctPalletsByLocAndClient` (`Set<string>`), reportando `1` tarima/bulto físico para `AlimNorte` en `G0001` en vez de `3`.
- **Acuse de Rampa Homologado (`operations.controller.ts`):** `GET /api/receipts/:id/acuse-rampa` acepta UUID y código folio `REC-XXXX` (`findFirst` con `OR: [{ id }, { codigo }]`), manteniendo protección `@RequireAccess` (`401`/`403`) y `404` ante inexistentes.

### 17.2 Higiene Frontend, Compatibilidad Legacy y RBAC UI
- **Compatibilidad de Zonas Legacy y `activo = false` (`locationHuDisplay.ts`, `Locations.tsx`, `TransferModal.tsx`):**
  - Se excluyen ubicaciones históricas inactivas (`activo = false`), `PNC` y no almacenables; `zonaAsignadaId` legacy sin ubicaciones operativas activas (`ALM-A` / `ALM-B`) deja de inflar disponibilidad falsa (`12 celdas` eliminadas; `41 celdas` comerciales disponibles para `AlimNorte`) y permite operar trasiegos en `G0001–G0045`.
  - Se muestran métricas contextuales coherentes (`1 tarima / bulto físico`) y se remueve `demoLocations`.
- **Etiquetado y Tarima Master (`LabelPreview.tsx`, `DualLabelModal.tsx`, `ReceiptPrintModal.tsx`, `PutawayModal.tsx`):**
  - Eliminados `fullDemoLabels`, `defaultClients`, `'Fashion Forward'`, `'PED-2026-0008'`, `'A01-R01-N1'`, `'A01-R02-N1'`, preferencia `'ALM-A'`, `'Jonathan Palacios'` y timestamps fijos; implementados estados reales de loading, vacío y error.
  - `PLT-REC-2026-0020-01` se muestra como `Tarima Master` (`1 tarima`, `Contenedor de 2 cajas`, `SKU contenido: ACE-OLI-1L`), nunca como `SKU-N/A` / `2 PZA`.
  - `DualLabelModal` normaliza caducidades mediante `formatCalendarDate` (`2027-06-30` → `30/06/2027`).
- **Recepción e Inventario (`Receiving.tsx`, `Inventory.tsx`):**
  - Removido `demoReceipts`, fallbacks de prueba (`'Juan Manuel Prueba'`, `'TEST-001'`, `'Transportes Prueba E2E'`, `'Jonathan Palacios'`) y corregida advertencia React `validateDOMNesting` dentro de `<tbody>`.
  - `Inventory.tsx` oculta el botón `"Acciones"` y sus modales operativos cuando `!hasActionPermission('inventario', 'editar') && !hasActionPermission('inventario', 'ajustar')`, manteniendo alineación UI-backend (`Operador Recepción` conserva `Detalle` sin ver acciones rechazadas con `403`).

### 17.3 Validación, Deuda de Datos y Continuación
- **Pruebas:** **`8/8 suites Jest` (`52/52 tests PASS`)**, `npx nest build` PASS, `tsc -b && vite build` PASS, `git diff --check` PASS, Chrome Headless (`0 pageExceptions`, `0 httpErrors`, `0 validateDOMNesting`) y `9` smoke tests HTTP PASS.
- **Deuda de Datos Documentada (sin mutación BD):** `AlimNorte.zonaAsignadaId -> ALM-B histórica` y `Fashion Forward.zonaAsignadaId -> ALM-A histórica` (evaluar limpieza a `NULL` antes de Go-Live si esos racks no volverán a utilizarse).
- **Punto de Reanudación:** **BLOQUE 3 — PICKING + RESERVA + DESPACHO E2E**.

---

## 18. Actualización Bloque 3 RC — Picking, Reserva Atómica, Staging y Despacho E2E

**Estado:** Validado funcional y técnicamente en Bloque 3A (salida parcial `12 PZA`) y Bloque 3B (salida final `12 PZA`) sobre `fix/rc-block3-picking-dispatch-e2e` (`0 BLOQUEANTES`, `0 ALTOS`, `0 MEDIOS`), pendiente de checkpoint final, commit y promoción a `dev`.

### 18.1 Flujo Operativo Certificado (`Pedido → Reserva → Preparación/Aprobación → Picking → Staging → Despacho`)
1. **Creación de Orden y Reserva Atómica (`POST /api/orders`):**
   - Ejecutada en `$transaction` bloqueando filas de `LotInventory` con `SELECT ... FOR UPDATE`.
   - Fuerza estado inicial `SOLICITADO`, rechaza alteración de `estado` vía payload, deriva `solicitadoPor` desde `req.user` y aplica validación estricta de caja cerrada (`409 Conflict` ante cantidades no cerradas, p. ej. `1` o `13 PZA`).
2. **Preparación y Aprobación Integrada (`POST /api/orders/:id/prepare`):**
   - Flujo canónico activo en `Dispatch.tsx` / `OrderPreparationModal.tsx`: restringido por RBAC a Supervisor/Admin (`editar`/`aprobar`), acepta `SOLICITADO`, preserva la reserva de `12 PZA`, marca `aprobado = true`, `fechaAprobacion`, `aprobadoPor = actor`, promueve a `EN_PICKING` y crea exactamente un registro `OrderApproval` (`estado: 'APROBADO'`) cuando `!order.aprobado` (`/approve` permanece disponible como ruta API opcional de pre-aprobación sin duplicar registros).
   - `PUT /api/orders/:id/status` bloquea bypass directo a `DESPACHADO` (`409 Conflict`), y `rejectOrder` libera reservas y retorna inventario/cajas desde Staging al origen dentro de transacción.
3. **Picking, Consolidación en Staging y Control de Contenedores (`start-picking`, `validate-scan`, `record-pick`, `transferHuToStaging`):**
   - `hu-classification.util.ts` y `picking-validation.util.ts` excluyen Tarima Master (`PALLET` / `TARIMA` / `PLT-*`) de sugerencias FEFO/FIFO, validaciones de escaneo y movimientos como producto.
   - El surtido traslada físicamente la caja (`BOX-*`) desde `Gxxxx` hacia `STG-01` generando movimiento `TRASIEGO` en Kárdex y promoviendo la orden a `CONSOLIDADO`.
   - Reintento idempotente sobre orden `CONSOLIDADO` retorna `{ idempotent: true }`; intento posterior al despacho retorna `409 ESTADO_NO_APTO_PARA_PICKING`.
4. **Despacho Final Atómico (`POST /api/orders/:id/dispatch`):**
   - Exige orden `CONSOLIDADO`, deduce saldo reservado y físico en `STG-01`, registra `DispatchTracking` (`SALIDA_ALMACEN`), movimiento `SALIDA_PEDIDO` (`STG-01 → cliente`), cambia `estado = DESPACHADO` / `estadoEntrega = EN_RUTA` y soporta reintentos idempotentes (`alreadyDispatched: true, idempotent: true`).

### 18.2 Comportamiento Canónico de Tarima Master (`PLT-*`), Salida Parcial y Vaciado Total
- **Semántica canónica (`cantidad` en `PALLET`):** Representa el número de cajas hijas activas contenidas (`operations.controller.ts` — `generateLabels`). Antes de Bloque 3B se armonizó de forma controlada `PLT-REC-2026-0020-01.cantidad` de `2 → 1` para reflejar su única hija activa restante (`BOX-REC-2026-0020-0002`).
- **Prevención de Tarima Fantasma (`syncParentPalletContainers` & `filterEffectiveActiveHus`):**
  - En salida parcial (`BOX-0001` despachada, `BOX-0002` activa en `G0001`): la tarima padre pasa a `cantidad = 1`, `estadoHu = ACTIVO` en `G0001`.
  - Al retirar la última caja activa hacia `STG-01` durante picking: `syncParentPalletContainers` traslada el contenedor lógico a `STG-01` y recalcula de inmediato `G0001` a `LIBRE` (`0 bultos`, `0 PZA`).
  - Al despachar la última caja: `syncParentPalletContainers` actualiza la tarima padre a `cantidad = 0`, `estadoHu = 'DESPACHADO'` (conservando trazabilidad documental de `REC-2026-0020`) y `filterEffectiveActiveHus` garantiza `0` ocupación fantasma en `putaway-engine.service.ts`, `master-data.controller.ts` y `clients.controller.ts`.
- **Fechas y terminología:** `order-sla.util.ts` asegura formato calendar-day exacto (`30/06/2027` y fecha compromiso `15/11/2026`); se eliminó el alias redundante `rackOrigen` en la API y UI del manifiesto en favor de nombres neutrales (`ubicacion` / `ubicacionOrigen`), y tanto Picking/Despacho como Manifiesto utilizan nomenclatura `"posición física Gxxxx"` en UI.

### 18.3 Resultados E2E Certificados (`PED-QA-E2E-OUT-001` y `PED-QA-E2E-OUT-002`) y Estado Final
* **`PED-QA-E2E-OUT-001` (Bloque 3A — Salida Parcial `12 PZA`):** `DESPACHADO` / `EN_RUTA`, caja `BOX-REC-2026-0020-0001 DESPACHADO`, manifiesto `MAN-PED-QA-E2E-OUT-001` (`Carlos Méndez`, `NLX-4821`, `SEAL-QA-3A-001`), conservando `OrderApproval = 0` histórico previo al ajuste de `prepareOrder`.
* **`PED-QA-E2E-OUT-002` (Bloque 3B — Salida Final `12 PZA`):** `DESPACHADO` / `EN_RUTA`, caja `BOX-REC-2026-0020-0002 DESPACHADO`, `OrderApproval = 1` (`APROBADO`, `supervisor@givingout.com`), manifiesto `MAN-PED-QA-E2E-OUT-002` (`Roberto Sánchez`, `NLY-7734`, `SEAL-QA-3B-002`).
* **Estado Final Post-3B (`G0001`, `STG-01`, Inventario y Kárdex):**
  - **Inventario:** `24` recibidas − `12` (`PED-001`) − `12` (`PED-002`) = **`0 PZA` físicas / `0` vendibles / `0` reservadas / `0` bloqueadas / `0` tránsito** (`LotInventory` en `0/0/0`; Dashboard y Portal AlimNorte en `0`).
  - **Ubicaciones:** `G0001 = LIBRE` (`estadoCapacidad: LIBRE`, `ocupacionBultos = 0`, `capacidadDisponibleBultos = 1`, `stockFisicoPiezas = 0`, `bultosPorCliente = {}`), **`45/45` posiciones `Gxxxx` en `LIBRE`** en Plano 2D; `STG-01 = LIBRE` (`0 PZA`, `0` HUs activas, `0` reservas).
  - **HUs:** `BOX-0001 DESPACHADO`, `BOX-0002 DESPACHADO`, `PLT-REC-2026-0020-01 DESPACHADO (cantidad = 0)`.
  - **Kárdex (`InventoryMovement`):** Exactamente **`6` movimientos** (`2` `TRASIEGO` inbound `REC-01 → G0001`, `1` `TRASIEGO` 3A `G0001 → STG-01`, `1` `SALIDA_PEDIDO` 3A, `1` `TRASIEGO` 3B `G0001 → STG-01`, `1` `SALIDA_PEDIDO` 3B; `0` de Tarima Master).
  - **Validación:** Jest **`9/9 suites` (`61/61 tests PASS`)**, `npx nest build` PASS, `tsc -b && vite build` PASS, `git diff --check` PASS, Chrome Headless `0 consoleErrors / 0 pageExceptions / 0 httpErrors`.

---

## 19. Actualización Bloque 4 RC — Confirmación de Entrega E2E y Cierre de Ciclo Logístico

**Estado:** Certificado al 100% en base de datos real y frontend sobre `fix/rc-block4-delivery-e2e` (`0 BLOQUEANTES`, `0 ALTOS`, `0 MEDIOS`).

### 19.1 Flujo Operativo y Hardening de Entrega (`confirmDelivery`)
1. **Transición Canónica a `ENTREGADO` (`POST /api/orders/:id/confirm-delivery`):**
   - Transacción atómica `$transaction` con bloqueo de fila `SELECT ... FOR UPDATE` sobre `SalesOrder`.
   - Exige que la orden esté previamente despachada (`estado === 'DESPACHADO'` y `estadoEntrega === 'EN_RUTA'`) y con registro existente en `DispatchTracking` (`409 Conflict` si no cumple).
   - Promueve la orden a `estado = 'ENTREGADO'` y `estadoEntrega = 'ENTREGADO'`, registrando `fechaEntrega` inmutable y notas.
   - Sincroniza `DispatchTracking.estado = 'ENTREGADO'`, completando la trazabilidad de última milla.
2. **Actor Autenticado vs Receptor:**
   - La identidad del operador responsable se extrae estrictamente desde el JWT verificado en `req.user` (`getRequestActor(req, 'Despachador')`), bloqueando inyecciones en payload.
   - Soporta `recibidoPor` / `nombreReceptor` para asentar formalmente al receptor en destino (`Walmart México (CEDIS San Martín)` -> `RESPONSABLE QA CEDIS`).
3. **Idempotencia y Auditoría:**
   - Si la orden ya fue entregada, retorna HTTP 200 `{ alreadyDelivered: true, idempotent: true }` sin alterar `fechaEntrega` ni duplicar logs.
   - Genera exactamente un registro de auditoría `ENTREGA_CONFIRMADA` en `AuditLog`.
4. **Preservación de Invariantes de Almacén:**
   - La entrega ocurre fuera del almacén físico: **no genera movimientos en Kárdex** (`InventoryMovement` = 6 movimientos exactos).
   - No modifica `LotInventory`, reservas, bloqueos ni ubicaciones físicas.

### 19.2 Resultados E2E Certificados en Operación Real
* **`PED-QA-E2E-OUT-001` (Entregado):** `ENTREGADO / ENTREGADO`, receptor `RESPONSABLE QA CEDIS`, fecha de entrega `2026-11-13T17:09:41.316Z`, `DispatchTracking = ENTREGADO`.
* **`PED-QA-E2E-OUT-002` (Control Negativo):** Conservado estrictamente en `DESPACHADO / EN_RUTA` (`fechaEntrega: null`, `recibidoPor: null`).
* **Invariantes del Almacén Central (WH-001):**
  - `LotInventory`: 0 PZA físico, 0 vendible, 0 reservado, 0 bloqueado.
  - Ubicaciones `G0001` y `STG-01`: `LIBRE` (0/1 tarimas ocupadas).
  - Plano 2D: 45/45 posiciones físicas oficiales `Gxxxx` libres.
  - Kárdex: 6 movimientos exactos.
* **Seguridad & Multi-Tenant:**
  - Picking 403, Recepción 403, Portal 403, anti-spoofing `x-user-role` 403.
  - Portal AlimNorte visualiza sus órdenes (`PED-001` entregado, `PED-002` en ruta).
  - Portal Fashion Forward no visualiza órdenes ajenas (0 pedidos).
* **Validación Integral:**
  - Jest backend `block4-delivery.spec.ts`: **18/18 tests PASS**.
  - Suite completa backend: **10/10 suites, 79/79 tests PASS**.
  - Chrome Headless: **22/22 checks PASS, 0 console errors, 0 page exceptions, 0 HTTP errors**.
  - Builds: `nest build PASS`, `vite build PASS`, `git diff --check PASS`.

---

### 🔜 v1.1 — Fase 2: PWA + Mobile
- [ ] Service Worker para modo offline
- [ ] Cache de datos críticos en dispositivo
- [ ] Optimización para Zebra TC22
- [ ] Install prompt (Add to Home Screen)

### 🔜 v2.0 — Fase 3: Integración CONTPAQi Nube
- [ ] Registro en Portal de Developers
- [ ] SyncService bidireccional (Catálogos + Documentos)
- [ ] Cron job de sincronización cada 30 min
- [ ] Panel de configuración de integración
- [ ] Dashboard de estado de sincronización

### 🔮 Futuro
- [ ] Portal de cliente (login segregado, ver su inventario)
- [ ] Reportes automáticos por email (diario/semanal)
- [ ] Facturación integrada (CFDI + Timbrado)
- [ ] App nativa con React Native (si se requiere)
- [ ] Multi-almacén (si el cliente escala)

---

## Contacto

**MOVIDA TCI**  
Desarrollo: wms@movidatci.com  
Proyecto: Giving Out WMS  
Ubicación del almacén: Tepotzotlán, Estado de México  
Área: ~150 m²  

---

*Documentación generada automáticamente a partir del código fuente del proyecto WMS Giving Out v1.0.0*
