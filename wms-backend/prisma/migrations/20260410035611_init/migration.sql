-- CreateTable
CREATE TABLE "Warehouse" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "direccion" TEXT,
    "ciudad" TEXT,
    "metrosCuadrados" DOUBLE PRECISION,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Warehouse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Zone" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "almacenId" TEXT NOT NULL,
    "tipoZona" TEXT NOT NULL,
    "temperatura" TEXT NOT NULL DEFAULT 'AMBIENTE',
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Zone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "almacenId" TEXT NOT NULL,
    "zonaId" TEXT,
    "pasillo" TEXT NOT NULL,
    "rack" TEXT NOT NULL,
    "nivel" TEXT NOT NULL,
    "posicion" TEXT NOT NULL DEFAULT '01',
    "tipoUbicacion" TEXT NOT NULL,
    "temperatura" TEXT NOT NULL DEFAULT 'AMBIENTE',
    "capacidadKg" DOUBLE PRECISION,
    "capacidadVolM3" DOUBLE PRECISION,
    "capacidadUnits" INTEGER NOT NULL DEFAULT 100,
    "ocupacion" INTEGER NOT NULL DEFAULT 0,
    "estado" TEXT NOT NULL DEFAULT 'LIBRE',
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "razonSocial" TEXT NOT NULL,
    "nombreComercial" TEXT NOT NULL,
    "rfc" TEXT,
    "tipoCliente" TEXT NOT NULL DEFAULT 'ALMACENAJE',
    "giro" TEXT,
    "direccionFiscal" TEXT,
    "ciudad" TEXT,
    "estado" TEXT,
    "codigoPostal" TEXT,
    "telefono" TEXT,
    "email" TEXT,
    "contactoPrincipal" TEXT,
    "condicionesComerciales" TEXT,
    "descuentoPorcentaje" DOUBLE PRECISION DEFAULT 0,
    "requiereLote" BOOLEAN NOT NULL DEFAULT false,
    "requiereSerie" BOOLEAN NOT NULL DEFAULT false,
    "requiereCaducidad" BOOLEAN NOT NULL DEFAULT false,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientContact" (
    "id" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "cargo" TEXT,
    "telefono" TEXT,
    "email" TEXT,
    "esPrincipal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientAddress" (
    "id" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "calle" TEXT NOT NULL,
    "colonia" TEXT,
    "ciudad" TEXT,
    "estado" TEXT,
    "cp" TEXT,
    "referencia" TEXT,
    "esDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientAddress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "rfc" TEXT,
    "telefono" TEXT,
    "email" TEXT,
    "direccion" TEXT,
    "contacto" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SkuMaster" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "descripcionCorta" TEXT,
    "categoria" TEXT NOT NULL,
    "subcategoria" TEXT,
    "marca" TEXT,
    "modelo" TEXT,
    "color" TEXT,
    "talla" TEXT,
    "uomBase" TEXT NOT NULL DEFAULT 'PZA',
    "pesoKg" DOUBLE PRECISION,
    "volumenM3" DOUBLE PRECISION,
    "codigoBarras" TEXT,
    "requiereLote" BOOLEAN NOT NULL DEFAULT false,
    "requiereSerie" BOOLEAN NOT NULL DEFAULT false,
    "requiereCaducidad" BOOLEAN NOT NULL DEFAULT false,
    "capacidadEmpaque" INTEGER,
    "descripcionEmpaque" TEXT,
    "precioReferencia" DOUBLE PRECISION,
    "stockMinimo" INTEGER,
    "stockMaximo" INTEGER,
    "puntoReorden" INTEGER,
    "temperaturaRequerida" TEXT NOT NULL DEFAULT 'AMBIENTE',
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SkuMaster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LotInventory" (
    "id" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "lote" TEXT,
    "serie" TEXT,
    "fechaVencimiento" TIMESTAMP(3),
    "fechaProduccion" TIMESTAMP(3),
    "proveedorNombre" TEXT,
    "estadoCalidad" TEXT NOT NULL DEFAULT 'LIBERADO',
    "cantidadDisponible" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cantidadReservada" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cantidadBloqueada" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ubicacionId" TEXT,
    "notas" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LotInventory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HandlingUnit" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "tipoHu" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "cantidad" DOUBLE PRECISION NOT NULL,
    "uom" TEXT NOT NULL,
    "ubicacionActual" TEXT NOT NULL,
    "estadoHu" TEXT NOT NULL DEFAULT 'ACTIVO',
    "parentHuId" TEXT,
    "pesoKg" DOUBLE PRECISION,
    "etiquetaImpresa" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HandlingUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryMovement" (
    "id" TEXT NOT NULL,
    "fechaHora" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tipoMovimiento" TEXT NOT NULL,
    "almacenId" TEXT,
    "skuId" TEXT NOT NULL,
    "clienteId" TEXT,
    "lotId" TEXT,
    "huId" TEXT,
    "fromLocationId" TEXT,
    "toLocationId" TEXT,
    "cantidad" DOUBLE PRECISION NOT NULL,
    "usuario" TEXT NOT NULL,
    "motivo" TEXT,
    "documentoOrigen" TEXT,

    CONSTRAINT "InventoryMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Receipt" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "proveedorId" TEXT,
    "proveedorNombre" TEXT,
    "fechaRecepcion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "estado" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "tipoRecepcion" TEXT NOT NULL DEFAULT 'NORMAL',
    "ocReferencia" TEXT,
    "notas" TEXT,
    "evidenciaUrl" TEXT,
    "recibidoPor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceiptLine" (
    "id" TEXT NOT NULL,
    "recepcionId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "cantidadEsperada" DOUBLE PRECISION,
    "cantidadRecibida" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cantidadDanada" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "estado" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "loteAsignado" TEXT,
    "serieAsignada" TEXT,
    "fechaVencimiento" TIMESTAMP(3),
    "ubicacionId" TEXT,
    "notas" TEXT,

    CONSTRAINT "ReceiptLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesOrder" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "destinatario" TEXT,
    "direccionEntrega" TEXT,
    "prioridad" INTEGER NOT NULL DEFAULT 3,
    "fechaCompromiso" TIMESTAMP(3) NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "reservaId" TEXT,
    "cotizacionId" TEXT,
    "despachador" TEXT,
    "fechaDespacho" TIMESTAMP(3),
    "vehiculoPlaca" TEXT,
    "estadoEntrega" TEXT,
    "fechaEntrega" TIMESTAMP(3),
    "firmaReceptor" TEXT,
    "nombreReceptor" TEXT,
    "notasEntrega" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesOrderLine" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "cantidadSolicitada" DOUBLE PRECISION NOT NULL,
    "cantidadAsignada" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lotId" TEXT,
    "huId" TEXT,

    CONSTRAINT "SalesOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DispatchTracking" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "estado" TEXT NOT NULL,
    "usuario" TEXT NOT NULL,
    "notas" TEXT,
    "latitud" DOUBLE PRECISION,
    "longitud" DOUBLE PRECISION,
    "firmaBase64" TEXT,
    "nombreFirmante" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DispatchTracking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesQuote" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "destinatario" TEXT,
    "estado" TEXT NOT NULL DEFAULT 'BORRADOR',
    "validezDias" INTEGER NOT NULL DEFAULT 15,
    "fechaVencimiento" TIMESTAMP(3),
    "notas" TEXT,
    "creadoPor" TEXT,
    "total" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesQuote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesQuoteLine" (
    "id" TEXT NOT NULL,
    "cotizacionId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "cantidad" DOUBLE PRECISION NOT NULL,
    "precioUnitario" DOUBLE PRECISION,
    "subtotal" DOUBLE PRECISION,

    CONSTRAINT "SalesQuoteLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reservation" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'DRAFT',
    "fechaExpiracion" TIMESTAMP(3),
    "notas" TEXT,
    "creadoPor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Reservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReservationLine" (
    "id" TEXT NOT NULL,
    "reservaId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "cantidadReservada" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "ReservationLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TraceabilityLink" (
    "id" TEXT NOT NULL,
    "documentoEntrada" TEXT,
    "documentoSalida" TEXT,
    "skuId" TEXT NOT NULL,
    "lotId" TEXT,
    "clienteId" TEXT,
    "cantidad" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TraceabilityLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CycleCount" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "tipo" TEXT NOT NULL DEFAULT 'SKU',
    "clasificacion" TEXT NOT NULL DEFAULT 'A',
    "estado" TEXT NOT NULL DEFAULT 'PROGRAMADO',
    "fechaProgramada" TIMESTAMP(3) NOT NULL,
    "fechaInicio" TIMESTAMP(3),
    "fechaCierre" TIMESTAMP(3),
    "almacenId" TEXT,
    "asignadoA" TEXT,
    "notas" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CycleCount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CycleCountLine" (
    "id" TEXT NOT NULL,
    "cycleCountId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "ubicacionId" TEXT,
    "lote" TEXT,
    "cantidadSistema" DOUBLE PRECISION NOT NULL,
    "cantidadFisica" DOUBLE PRECISION,
    "discrepancia" DOUBLE PRECISION,
    "porcentajeDisc" DOUBLE PRECISION,
    "estado" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "contadoPor" TEXT,
    "contadoEn" TIMESTAMP(3),
    "notas" TEXT,

    CONSTRAINT "CycleCountLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "usuario" TEXT NOT NULL,
    "accion" TEXT NOT NULL,
    "entidad" TEXT NOT NULL,
    "entidadId" TEXT,
    "detalle" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrintLog" (
    "id" TEXT NOT NULL,
    "usuario" TEXT NOT NULL,
    "tipoEtiqueta" TEXT NOT NULL,
    "referencia" TEXT NOT NULL,
    "reimpresion" BOOLEAN NOT NULL DEFAULT false,
    "motivo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrintLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "rolId" TEXT,
    "almacenId" TEXT,
    "clienteId" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "nivel" INTEGER NOT NULL DEFAULT 5,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "id" TEXT NOT NULL,
    "rolId" TEXT NOT NULL,
    "modulo" TEXT NOT NULL,
    "accion" TEXT NOT NULL DEFAULT 'ver',

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OtpCode" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OtpCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformSettings" (
    "id" TEXT NOT NULL,
    "logoUrl" TEXT,
    "nombre" TEXT NOT NULL DEFAULT 'Giving Out WMS',
    "subtitulo" TEXT NOT NULL DEFAULT 'Sistema de Gestión de Almacén',
    "colorPrimario" TEXT DEFAULT '#2563EB',
    "colorSecundario" TEXT DEFAULT '#7C3AED',

    CONSTRAINT "PlatformSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "prioridad" TEXT NOT NULL DEFAULT 'MEDIA',
    "titulo" TEXT NOT NULL,
    "detalle" TEXT,
    "entidad" TEXT,
    "entidadId" TEXT,
    "clienteId" TEXT,
    "resuelta" BOOLEAN NOT NULL DEFAULT false,
    "resueltaPor" TEXT,
    "resueltaEn" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationConfig" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'contpaqi_nube',
    "apiUrl" TEXT,
    "apiKey" TEXT,
    "clientId" TEXT,
    "clientSecret" TEXT,
    "environment" TEXT NOT NULL DEFAULT 'sandbox',
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "lastTestedAt" TIMESTAMP(3),
    "lastTestResult" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncLog" (
    "id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "entidad" TEXT NOT NULL,
    "registros" INTEGER NOT NULL DEFAULT 0,
    "estado" TEXT NOT NULL,
    "detalle" TEXT,
    "usuario" TEXT,
    "duracionMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Warehouse_codigo_key" ON "Warehouse"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "Zone_codigo_key" ON "Zone"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "Location_codigo_key" ON "Location"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "Client_codigo_key" ON "Client"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_codigo_key" ON "Supplier"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "SkuMaster_codigo_key" ON "SkuMaster"("codigo");

-- CreateIndex
CREATE INDEX "SkuMaster_clienteId_idx" ON "SkuMaster"("clienteId");

-- CreateIndex
CREATE INDEX "SkuMaster_codigo_idx" ON "SkuMaster"("codigo");

-- CreateIndex
CREATE INDEX "SkuMaster_categoria_idx" ON "SkuMaster"("categoria");

-- CreateIndex
CREATE INDEX "LotInventory_clienteId_idx" ON "LotInventory"("clienteId");

-- CreateIndex
CREATE INDEX "LotInventory_skuId_idx" ON "LotInventory"("skuId");

-- CreateIndex
CREATE UNIQUE INDEX "HandlingUnit_codigo_key" ON "HandlingUnit"("codigo");

-- CreateIndex
CREATE INDEX "HandlingUnit_clienteId_idx" ON "HandlingUnit"("clienteId");

-- CreateIndex
CREATE INDEX "HandlingUnit_codigo_idx" ON "HandlingUnit"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_codigo_key" ON "Receipt"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "SalesOrder_codigo_key" ON "SalesOrder"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "SalesQuote_codigo_key" ON "SalesQuote"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "Reservation_codigo_key" ON "Reservation"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "CycleCount_codigo_key" ON "CycleCount"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Role_nombre_key" ON "Role"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "RolePermission_rolId_modulo_accion_key" ON "RolePermission"("rolId", "modulo", "accion");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationConfig_provider_key" ON "IntegrationConfig"("provider");

-- AddForeignKey
ALTER TABLE "Zone" ADD CONSTRAINT "Zone_almacenId_fkey" FOREIGN KEY ("almacenId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_almacenId_fkey" FOREIGN KEY ("almacenId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_zonaId_fkey" FOREIGN KEY ("zonaId") REFERENCES "Zone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientContact" ADD CONSTRAINT "ClientContact_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientAddress" ADD CONSTRAINT "ClientAddress_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkuMaster" ADD CONSTRAINT "SkuMaster_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LotInventory" ADD CONSTRAINT "LotInventory_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "SkuMaster"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LotInventory" ADD CONSTRAINT "LotInventory_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LotInventory" ADD CONSTRAINT "LotInventory_ubicacionId_fkey" FOREIGN KEY ("ubicacionId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandlingUnit" ADD CONSTRAINT "HandlingUnit_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "LotInventory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandlingUnit" ADD CONSTRAINT "HandlingUnit_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_almacenId_fkey" FOREIGN KEY ("almacenId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "SkuMaster"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "LotInventory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_huId_fkey" FOREIGN KEY ("huId") REFERENCES "HandlingUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_fromLocationId_fkey" FOREIGN KEY ("fromLocationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_toLocationId_fkey" FOREIGN KEY ("toLocationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptLine" ADD CONSTRAINT "ReceiptLine_recepcionId_fkey" FOREIGN KEY ("recepcionId") REFERENCES "Receipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptLine" ADD CONSTRAINT "ReceiptLine_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "SkuMaster"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrderLine" ADD CONSTRAINT "SalesOrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "SalesOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrderLine" ADD CONSTRAINT "SalesOrderLine_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "SkuMaster"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrderLine" ADD CONSTRAINT "SalesOrderLine_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "LotInventory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrderLine" ADD CONSTRAINT "SalesOrderLine_huId_fkey" FOREIGN KEY ("huId") REFERENCES "HandlingUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchTracking" ADD CONSTRAINT "DispatchTracking_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "SalesOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesQuote" ADD CONSTRAINT "SalesQuote_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesQuoteLine" ADD CONSTRAINT "SalesQuoteLine_cotizacionId_fkey" FOREIGN KEY ("cotizacionId") REFERENCES "SalesQuote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesQuoteLine" ADD CONSTRAINT "SalesQuoteLine_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "SkuMaster"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationLine" ADD CONSTRAINT "ReservationLine_reservaId_fkey" FOREIGN KEY ("reservaId") REFERENCES "Reservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationLine" ADD CONSTRAINT "ReservationLine_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "SkuMaster"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TraceabilityLink" ADD CONSTRAINT "TraceabilityLink_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "SkuMaster"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TraceabilityLink" ADD CONSTRAINT "TraceabilityLink_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "LotInventory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CycleCountLine" ADD CONSTRAINT "CycleCountLine_cycleCountId_fkey" FOREIGN KEY ("cycleCountId") REFERENCES "CycleCount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CycleCountLine" ADD CONSTRAINT "CycleCountLine_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "SkuMaster"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_rolId_fkey" FOREIGN KEY ("rolId") REFERENCES "Role"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_rolId_fkey" FOREIGN KEY ("rolId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;
