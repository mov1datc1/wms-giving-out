# Especificación Técnica de la API de Recepciones Previas (ASN)

**Giving Out WMS · Módulo de Operaciones de Entrada**  
**Versión:** 1.0 (Sprint #2 - Tarea 6)  
**URL Base:** `http://localhost:3001/api`  
**Documentación Swagger UI:** `http://localhost:3001/api/docs`  
**Especificación OpenAPI JSON:** `http://localhost:3001/api/docs-json`  

---

## 1. Resumen de Arquitectura y Seguridad

La API de recepciones previas (*Advance Shipping Notice - ASN*) del Giving Out WMS administra el ciclo de vida documental y físico del arribo de mercancías al Centro de Distribución (CEDIS).  
Está construida bajo **NestJS** y **Prisma ORM**, persistida en **Supabase PostgreSQL** y documentada mediante **OpenAPI / Swagger 3.0**.

### Principios Operacionales:
1. **Multi-Depositante Estricto:** Toda recepción previa pertenece a un único depositante (`clienteId`). Se valida cruzadamente contra catálogo maestro que ningún SKU pertenezca a un cliente ajeno.
2. **Candado Operativo de Integridad (Tarea 3):** Una vez confirmada la llegada del camión a bahía (`bloqueado: true`), la edición de cantidades y partidas queda sellada. El desbloqueo es privilegio exclusivo de supervisor con justificación inmutable registrada en auditoría.
3. **Inmutabilidad de Cierre (Tarea 5):** Las recepciones en estado `CERRADA` no admiten desbloqueo ni mutaciones bajo ninguna circunstancia.
4. **Validación Exhaustiva de Datos Incompletos (Tarea 6):** Cualquier solicitud que omita depositante, partidas, documento de respaldo o presente cantidades $\le 0$ es rechazada inmediatamente con código HTTP `400 Bad Request` y un desglose estructurado del error.

---

## 2. Catálogo de Endpoints

| Método | Endpoint | Resumen | Códigos de Estado |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/receipts` | Listar recepciones previas con filtros | `200`, `500` |
| `POST` | `/api/receipts` | Crear previo vía JSON (Tarea 1) | `201`, `400`, `404`, `500` |
| `POST` | `/api/receipts/previo` | Dual Ingest: Carga Excel o Formulario Manual (Tarea 2) | `201`, `400`, `404`, `500` |
| `POST` | `/api/receipts/:id/lock` | Confirmar arribo y activar candado operativo (Tarea 3) | `200`, `400`, `403`, `404` |
| `POST` | `/api/receipts/:id/unlock` | Desbloquear previo por supervisor con justificación | `200`, `400`, `403`, `404` |
| `POST` | `/api/receipts/:id/lines` | Agregar partida individual de SKU al previo abierto | `201`, `400`, `403`, `404` |
| `PATCH` | `/api/receipts/:id/status` | Transicionar estatus operacional (`PENDIENTE_ARRIBO`, etc.) | `200`, `400`, `403`, `404` |
| `POST` | `/api/receipts/:id/close` | Finalizar y cerrar recepción de factura completa | `200`, `400`, `404` |
| `GET` | `/api/receipts/:id/report` | Reporte final de discrepancias y cumplimiento | `200`, `404` |

---

## 3. Esquemas de Datos (DTOs)

### 3.1. `CreateReceiptPrevioDto`
```typescript
{
  clienteId: string;            // Requerido (UUID)
  facturaRespaldo: string;      // Requerido (o ocReferencia)
  ocReferencia?: string;        // Opcional
  tipoImportacion?: string;     // 'DEFINITIVA' | 'TEMPORAL' | 'NO_APLICA'
  origen?: string;              // 'NACIONAL' | 'IMPORTACION'
  tipoRecepcion?: string;       // 'NORMAL' | 'DEVOLUCION' | 'TRANSFERENCIA'
  proveedorId?: string;         // Opcional
  proveedorNombre?: string;     // Opcional
  folioTransporte?: string;     // Opcional
  lineaTransporte?: string;     // Opcional
  capacidadCarga?: string;      // Opcional
  placa?: string;               // Opcional
  nombreChofer?: string;        // Opcional
  fechaArriboEstimada?: string; // Opcional (ISO-8601)
  notas?: string;               // Opcional
  lineas: PrevioLineItemDto[];  // Requerido (Mínimo 1 partida)
}
```

### 3.2. `PrevioLineItemDto`
```typescript
{
  skuId: string;                // Requerido (UUID)
  cantidadEsperada: number;     // Requerido (Número > 0)
  folio?: string;               // Opcional
  sucursal?: string;            // Opcional
  tipoContenedor?: string;      // Opcional (Default: 'Caja máster')
  uom?: string;                 // Opcional (Default: 'PZA')
  precioUnitario?: number;      // Opcional
  loteEsperado?: string;        // Opcional
  notas?: string;               // Opcional
}
```

### 3.3. `UpdateReceiptStatusDto`
```typescript
{
  estado: string;               // Requerido ('PENDIENTE_ARRIBO' | 'EN_PROCESO_CONTEO' | 'CERRADA')
  usuario?: string;             // Opcional
  motivo?: string;              // Opcional
}
```

### 3.4. `UnlockReceiptDto`
```typescript
{
  usuario?: string;             // Opcional
  motivo: string;               // Requerido (Justificación para bitácora de auditoría)
}
```

---

## 4. Matriz de Errores y Validaciones (RFC-7807)

Todas las respuestas de error siguen el estándar:

```json
{
  "statusCode": 400,
  "message": "Datos incompletos: Se requiere el identificador único del cliente depositante (clienteId).",
  "error": "Bad Request",
  "detalles": {
    "codigo": "CLIENTE_ID_REQUERIDO",
    "campo": "clienteId"
  }
}
```

### Tabla de Códigos de Error Específicos:

| Código de Error | HTTP Status | Causa |
| :--- | :--- | :--- |
| `CUERPO_PETICION_VACIO` | `400 Bad Request` | El payload enviado en la solicitud no contiene un objeto válido. |
| `CLIENTE_ID_REQUERIDO` | `400 Bad Request` | `clienteId` ausente o cadena vacía. |
| `CLIENTE_NO_ENCONTRADO` | `404 Not Found` | El `clienteId` no existe en la base de datos de clientes. |
| `DOCUMENTO_REFERENCIA_REQUERIDO` | `400 Bad Request` | No se proporcionó ni `facturaRespaldo` ni `ocReferencia`. |
| `LINEAS_PREVIO_REQUERIDAS` | `400 Bad Request` | La lista `lineas` está ausente o es un arreglo vacío `[]`. |
| `SKU_ID_REQUERIDO` | `400 Bad Request` | Una de las partidas no contiene el campo `skuId`. |
| `CANTIDAD_ESPERADA_INVALIDA` | `400 Bad Request` | La cantidad esperada es $\le 0$, `NaN` o no numérica. |
| `ORIGEN_DATOS_PREVIO_VACIO` | `400 Bad Request` | No se adjuntó archivo Excel ni lista manual de partidas. |
| `EXCEL_SIN_HOJAS` | `400 Bad Request` | El archivo Excel no contiene hojas de cálculo válidas. |
| `EXCEL_VACIO` | `400 Bad Request` | El archivo Excel no contiene filas de datos. |
| `SKUS_AJENOS_DETECTADOS` | `400 Bad Request` | Uno o más SKUs pertenecen a un depositante distinto. |
| `SKUS_INEXISTENTES` | `400 Bad Request` | Los códigos de producto no existen en el catálogo maestro. |
| `SIN_LINEAS_VALIDAS` | `400 Bad Request` | Todos los códigos del archivo o formulario fueron descartados por no pertenecer al catálogo. |
| `PREVIO_BLOQUEADO` | `403 Forbidden` | Intento de agregar o modificar partidas en un previo con candado activo. |
| `RECEPCION_CERRADA` | `403 Forbidden` | Intento de bloquear o alterar una recepción que ya fue finiquitada. |
| `RECEPCION_CERRADA_INMUTABLE` | `403 Forbidden` | Intento de desbloquear una recepción histórica cerrada. |
| `MOTIVO_DESBLOQUEO_REQUERIDO` | `400 Bad Request` | Se intentó desbloquear el previo sin proporcionar justificación. |
| `ESTADO_REQUERIDO` | `400 Bad Request` | `estado` ausente al actualizar estatus operacional. |
| `ESTADO_INVALIDO` | `400 Bad Request` | El estado enviado no pertenece a la terna oficial de banderas. |
| `USUARIO_CIERRE_REQUERIDO` | `400 Bad Request` | Cierre de recepción sin especificar usuario auditor responsable. |
| `RECEPCION_NO_ENCONTRADA` | `404 Not Found` | El ID de recepción previa no existe en la base de datos. |

---

## 5. Ejemplos de Peticiones y Respuestas

### 5.1. Solicitud exitosa (`POST /api/receipts`)
```bash
curl -X POST http://localhost:3001/api/receipts \
  -H "Content-Type: application/json" \
  -d '{
    "clienteId": "ba453845-913f-47c8-b08e-b3f30874722f",
    "facturaRespaldo": "FAC-2026-9001",
    "ocReferencia": "OC-4450",
    "lineas": [
      {
        "skuId": "34914c69-23c3-4d22-b91c-bf1b149b1a50",
        "cantidadEsperada": 100,
        "tipoContenedor": "Caja máster"
      }
    ]
  }'
```

### 5.2. Respuesta ante datos incompletos (`HTTP 400`)
```json
{
  "statusCode": 400,
  "message": "Datos incompletos o inválidos: La cantidad esperada en la partida #1 debe ser un número mayor a 0 (recibido: 0).",
  "error": "Bad Request",
  "detalles": {
    "codigo": "CANTIDAD_ESPERADA_INVALIDA",
    "posicion": 1,
    "valor": 0
  }
}
```

### 5.3. Respuesta ante intento de desbloqueo de recepción cerrada (`HTTP 403`)
```json
{
  "statusCode": 403,
  "message": "Operación no permitida: La recepción está CERRADA y finiquitada en inventario. Por políticas de auditoría WMS y control de inventario, ni el administrador puede alterar ni desbloquear una recepción histórica cerrada.",
  "error": "Forbidden",
  "detalles": {
    "codigo": "RECEPCION_CERRADA_INMUTABLE"
  }
}
```
