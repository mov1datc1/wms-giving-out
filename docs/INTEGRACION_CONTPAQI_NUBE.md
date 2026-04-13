# 📘 Guía de Integración: WMS Giving Out ↔ CONTPAQi Nube

**Versión:** 1.0  
**Fecha:** Abril 2026  
**Autor:** MOVIDA TCI  
**Proyecto:** Giving Out WMS — Fase 3

---

## 1. Resumen

Este documento detalla los requisitos técnicos, pasos de configuración y consideraciones para integrar el WMS Giving Out con **CONTPAQi Nube** (versión cloud). La integración permitirá la sincronización bidireccional de catálogos (productos, clientes, proveedores), documentos (facturas, remisiones) y existencias de inventario.

> **Importante:** Esta guía aplica exclusivamente para **CONTPAQi Nube** (productos cloud como Contabiliza, Comercial Start). Para clientes con la versión de escritorio (Comercial Premium), consultar la sección 7 de este documento.

---

## 2. Prerrequisitos

### 2.1 Del lado del cliente
- [ ] Licencia activa de **CONTPAQi Nube** (Contabiliza o Comercial Start)
- [ ] Acceso como administrador al portal de CONTPAQi Nube
- [ ] RFC registrado y activo en la plataforma

### 2.2 Del lado del desarrollo
- [ ] Cuenta registrada en el Portal de Developers: [developers.contpaqinube.com](https://developers.contpaqinube.com)
- [ ] Suscripción aprobada al producto API deseado (Catálogos, Documentos)
- [ ] Llaves de API obtenidas (primaria y secundaria)

### 2.3 Infraestructura
- [ ] WMS Backend desplegado (NestJS en Render o similar)
- [ ] Base de datos PostgreSQL accesible (Supabase)
- [ ] Modelo `IntegrationConfig` y `SyncLog` en schema.prisma (ya implementados)

---

## 3. Registro en el Portal de Developers

### Paso 1: Crear Cuenta
1. Ir a [developers.contpaqinube.com/signup](https://developers.contpaqinube.com/signup)
2. Registrarse con correo corporativo
3. Verificar email

### Paso 2: Explorar APIs Disponibles
1. Navegar a [developers.contpaqinube.com/apis](https://developers.contpaqinube.com/apis)
2. Identificar las APIs relevantes:
   - **Catálogos** (Clientes, Productos, Proveedores)
   - **Documentos** (Facturas, Remisiones, Notas de Crédito)
   - **Existencias/Inventarios** (verificar disponibilidad)
   - **Timbra v3** (CFDI — si se requiere facturación directa)

### Paso 3: Suscribirse a Productos
1. Ir a [developers.contpaqinube.com/products](https://developers.contpaqinube.com/products)
2. Seleccionar el producto API deseado
3. Solicitar suscripción (requiere aprobación de un administrador CONTPAQi)

### Paso 4: Obtener Credenciales
Una vez aprobada la suscripción:
1. Ir al perfil de desarrollador
2. Copiar las llaves:
   - **Primary Key** → Para producción
   - **Secondary Key** → Para desarrollo/sandbox

---

## 4. Autenticación de la API

La API de CONTPAQi Nube utiliza autenticación por headers HTTP:

```
HTTP Headers requeridos:
  License-Code: <código-de-licencia-del-cliente>
  Subscription-Key: <llave-de-suscripción-del-developer>
  Content-Type: application/json
```

### Ejemplo de petición (curl):
```bash
curl -X GET "https://api.contpaqinube.com/v1/catalogos/productos" \
  -H "License-Code: LIC-XXXXXX" \
  -H "Subscription-Key: sk_dev_XXXXX" \
  -H "Content-Type: application/json"
```

### Ejemplo de petición (NestJS):
```typescript
// src/modules/integration/contpaqi.service.ts
import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';

@Injectable()
export class ContpaqiService {
  constructor(
    private http: HttpService,
    private prisma: PrismaService,
  ) {}

  private async getHeaders() {
    const config = await this.prisma.integrationConfig.findFirst({
      where: { provider: 'contpaqi_nube' },
    });
    return {
      'License-Code': config?.clientId || '',
      'Subscription-Key': config?.apiKey || '',
      'Content-Type': 'application/json',
    };
  }

  async getProductos() {
    const headers = await this.getHeaders();
    const { data } = await this.http.axiosRef.get(
      `${config.apiUrl}/catalogos/productos`,
      { headers },
    );
    return data;
  }
}
```

---

## 5. Entidades a Sincronizar

### 5.1 Catálogos (Sincronización Bidireccional)

| Entidad CONTPAQi | Modelo WMS | Dirección | Frecuencia |
|---|---|---|---|
| Productos | `SkuMaster` | CONTPAQi → WMS | Cada 30 min |
| Clientes | `Client` | CONTPAQi → WMS | Cada 30 min |
| Proveedores | `Supplier` | CONTPAQi → WMS | Cada 30 min |
| Almacenes | `Warehouse` | CONTPAQi ↔ WMS | Diaria |

### 5.2 Documentos (Sincronización por Evento)

| Documento CONTPAQi | Acción WMS | Dirección |
|---|---|---|
| Factura / Remisión | Crear `SalesOrder` | CONTPAQi → WMS |
| Orden de Compra | Crear `Receipt` | CONTPAQi → WMS |
| Nota de Crédito | Registrar devolución | CONTPAQi → WMS |
| Despacho confirmado | Actualizar documento | WMS → CONTPAQi |

### 5.3 Existencias

| Dato | Modelo WMS | Dirección |
|---|---|---|
| Stock disponible | `LotInventory.cantidadDisponible` | Bidireccional |
| Movimientos de almacén | `InventoryMovement` | WMS → CONTPAQi |

---

## 6. Configuración en el WMS

### 6.1 Modelo de Base de Datos (Ya implementado)

```prisma
model IntegrationConfig {
  id              String    @id @default(uuid())
  provider        String    @unique @default("contpaqi_nube")
  apiUrl          String?        // URL base de la API
  apiKey          String?        // Subscription-Key
  clientId        String?        // License-Code
  clientSecret    String?        // (reservado)
  environment     String    @default("sandbox")  // sandbox | production
  isActive        Boolean   @default(false)
  lastTestedAt    DateTime?
  lastTestResult  String?
  updatedBy       String?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
}

model SyncLog {
  id              String   @id @default(uuid())
  tipo            String   // INBOUND, OUTBOUND
  entidad         String   // PRODUCTO, CLIENTE, PROVEEDOR, DOCUMENTO
  registros       Int      @default(0)
  estado          String   // SUCCESS, ERROR, PARTIAL
  detalle         String?
  usuario         String?
  duracionMs      Int?
  createdAt       DateTime @default(now())
}
```

### 6.2 Variables de Entorno Adicionales

```env
# CONTPAQi Nube Integration (Fase 3)
CONTPAQI_API_URL=https://api.contpaqinube.com/v1
CONTPAQI_LICENSE_CODE=LIC-XXXXXX
CONTPAQI_SUBSCRIPTION_KEY=sk_dev_XXXXX
CONTPAQI_ENVIRONMENT=sandbox
CONTPAQI_SYNC_INTERVAL_MINUTES=30
```

### 6.3 Panel de Administración

El WMS ya incluye la infraestructura para configurar la integración desde el panel de admin:
- Ruta: `/admin` → Tab "Configuración"
- Modelo: `IntegrationConfig`
- Endpoints:
  - `GET /api/admin/settings` — Obtener configuración actual
  - `PUT /api/admin/settings` — Guardar cambios

---

## 7. Alternativa: Clientes con CONTPAQi Desktop

Para clientes que **no pueden o no quieren migrar** a la versión cloud, existe una solución de terceros:

### AR Software — CONTPAQi Comercial API

| Atributo | Detalle |
|---|---|
| Proveedor | AR Software |
| Repo | github.com/AndresRamos/ARSoftware.Contpaqi.Comercial.Api |
| Tipo | API REST wrapper sobre SDK Desktop |
| Costo | $720 USD / año / RFC |
| Requisito | Servicio sincronizador corriendo en red local del servidor Comercial Premium |
| Funcionalidad | CRUD catálogos, documentos, existencias vía REST |

### Proceso de la alternativa Desktop:
```
┌──────────────┐  REST/JSON  ┌──────────────┐  SDK COM  ┌──────────────────┐
│  WMS Backend │ ◄──────────│ AR Software  │ ◄────────│ CONTPAQi Comercial│
│  (Render)    │            │ API Wrapper  │          │ Premium (Windows) │
└──────────────┘            │ (On-Premise) │          └──────────────────┘
                            └──────────────┘
```

**Recomendación:** Siempre sugerir la migración a CONTPAQi Nube como primera opción.

---

## 8. Migración Desktop → Nube

### Herramienta Oficial: "Migrador de Empresas"

1. Descargar el **Migrador de Empresas** desde el portal de CONTPAQi
2. Instalar en la PC donde corre Comercial Premium
3. Seleccionar la empresa a migrar
4. El migrador extrae datos de la BD local y los sube a la plataforma Nube
5. Verificar datos en CONTPAQi Nube
6. Activar integración API en WMS

### Referencia de Precios CONTPAQi Nube

| Plan | Precio Anual (MXN) | Usuarios | Ideal para |
|---|---|---|---|
| Inicial | ~$4,000 | 1 | Microempresa |
| Empresarial | ~$12,000 | 3 | PyME |
| Corporativo | ~$19,000+ | 5+ | Empresa mediana |
| Escritorio Virtual | $2,000-10,000/mes | Variable | Quien no quiere migrar |
| Usuario adicional | ~$1,880/año | +1 | Escalabilidad |

---

## 9. Pruebas y Validación

### 9.1 Checklist de Validación
- [ ] Registrarse en el Portal de Developers
- [ ] Obtener llaves Sandbox
- [ ] Probar endpoint de catálogos (GET productos)
- [ ] Verificar estructura JSON de respuesta
- [ ] Mapear campos CONTPAQi → campos WMS (SkuMaster)
- [ ] Probar escritura (POST producto)
- [ ] Probar flujo completo: Crear producto → Consultar existencia → Registrar movimiento

### 9.2 Manejo de Errores

La API utiliza códigos HTTP estándar y errores según **RFC 7807**:

```json
{
  "type": "https://tools.ietf.org/html/rfc7807",
  "title": "Recurso no encontrado",
  "status": 404,
  "detail": "El producto con código XYZ no existe",
  "instance": "/catalogos/productos/XYZ"
}
```

---

## 10. Timeline Estimado

| Fase | Duración | Entregable |
|---|---|---|
| Registro + Validación API | 1-2 semanas | Documentación de endpoints reales |
| Desarrollo Sync Service | 2-3 semanas | Módulo de sincronización funcional |
| Testing con datos reales | 1-2 semanas | Reportes de sync exitosos |
| Go-Live integración | 1 semana | Producción |
| **Total** | **5-8 semanas** | **WMS + ERP integrado** |

---

## 11. Contacto y Soporte

- **Portal CONTPAQi:** [contpaqi.com](https://www.contpaqi.com)
- **Portal Developers:** [developers.contpaqinube.com](https://developers.contpaqinube.com)
- **Soporte técnico API:** A través del portal de developers (ticket system)
- **Distribuidores autorizados:** Consultar en el sitio oficial de CONTPAQi

---

*Documento generado por MOVIDA TCI para el proyecto WMS Giving Out.*
