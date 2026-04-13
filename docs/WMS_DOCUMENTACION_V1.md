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

### Flujo de Login
```
1. POST /api/auth/login { email, password }
2. Backend: bcrypt.compare(password, user.passwordHash)
3. Respuesta: { token: JWT, user: { id, email, nombre, rol } }
4. Frontend: Bearer token en header Authorization
5. Token expira en 24h (configurable via JWT_EXPIRES_IN)
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

### ✅ v1.0 — Fase 1: Core WMS (Actual)
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
