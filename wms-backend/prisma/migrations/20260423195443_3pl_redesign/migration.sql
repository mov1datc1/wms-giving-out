/*
  Warnings:

  - You are about to drop the column `condicionesComerciales` on the `Client` table. All the data in the column will be lost.
  - You are about to drop the column `descuentoPorcentaje` on the `Client` table. All the data in the column will be lost.
  - You are about to drop the column `tipoCliente` on the `Client` table. All the data in the column will be lost.
  - You are about to drop the column `cotizacionId` on the `SalesOrder` table. All the data in the column will be lost.
  - You are about to drop the column `destinatario` on the `SalesOrder` table. All the data in the column will be lost.
  - You are about to drop the column `direccionEntrega` on the `SalesOrder` table. All the data in the column will be lost.
  - You are about to drop the column `reservaId` on the `SalesOrder` table. All the data in the column will be lost.
  - You are about to drop the column `precioReferencia` on the `SkuMaster` table. All the data in the column will be lost.
  - You are about to drop the `Reservation` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ReservationLine` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `SalesQuote` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `SalesQuoteLine` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "Reservation" DROP CONSTRAINT "Reservation_clienteId_fkey";

-- DropForeignKey
ALTER TABLE "ReservationLine" DROP CONSTRAINT "ReservationLine_reservaId_fkey";

-- DropForeignKey
ALTER TABLE "ReservationLine" DROP CONSTRAINT "ReservationLine_skuId_fkey";

-- DropForeignKey
ALTER TABLE "SalesQuote" DROP CONSTRAINT "SalesQuote_clienteId_fkey";

-- DropForeignKey
ALTER TABLE "SalesQuoteLine" DROP CONSTRAINT "SalesQuoteLine_cotizacionId_fkey";

-- DropForeignKey
ALTER TABLE "SalesQuoteLine" DROP CONSTRAINT "SalesQuoteLine_skuId_fkey";

-- AlterTable
ALTER TABLE "Client" DROP COLUMN "condicionesComerciales",
DROP COLUMN "descuentoPorcentaje",
DROP COLUMN "tipoCliente",
ADD COLUMN     "colorPortal" TEXT DEFAULT '#2563EB',
ADD COLUMN     "escaneoIndividual" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "logoUrl" TEXT,
ADD COLUMN     "manejoInventario" TEXT NOT NULL DEFAULT 'PIEZA',
ADD COLUMN     "reglaInventario" TEXT NOT NULL DEFAULT 'FIFO',
ADD COLUMN     "requiereAprobacion" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "uomPrincipal" TEXT NOT NULL DEFAULT 'PZA',
ADD COLUMN     "zonaAsignadaId" TEXT;

-- AlterTable
ALTER TABLE "SalesOrder" DROP COLUMN "cotizacionId",
DROP COLUMN "destinatario",
DROP COLUMN "direccionEntrega",
DROP COLUMN "reservaId",
ADD COLUMN     "aprobado" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "aprobadoPor" TEXT,
ADD COLUMN     "costoEnvio" DOUBLE PRECISION,
ADD COLUMN     "endCustomerId" TEXT,
ADD COLUMN     "fechaAprobacion" TIMESTAMP(3),
ADD COLUMN     "guiaUrl" TEXT,
ADD COLUMN     "motivoRechazo" TEXT,
ADD COLUMN     "numeroGuia" TEXT,
ADD COLUMN     "paqueteria" TEXT,
ADD COLUMN     "solicitadoPor" TEXT,
ADD COLUMN     "tipoTransporte" TEXT,
ALTER COLUMN "estado" SET DEFAULT 'SOLICITADO';

-- AlterTable
ALTER TABLE "SkuMaster" DROP COLUMN "precioReferencia";

-- DropTable
DROP TABLE "Reservation";

-- DropTable
DROP TABLE "ReservationLine";

-- DropTable
DROP TABLE "SalesQuote";

-- DropTable
DROP TABLE "SalesQuoteLine";

-- CreateTable
CREATE TABLE "EndCustomer" (
    "id" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "razonSocial" TEXT,
    "rfc" TEXT,
    "contacto" TEXT,
    "telefono" TEXT,
    "email" TEXT,
    "calle" TEXT,
    "colonia" TEXT,
    "ciudad" TEXT,
    "estado" TEXT,
    "codigoPostal" TEXT,
    "referencia" TEXT,
    "instruccionesEntrega" TEXT,
    "requiereFactura" BOOLEAN NOT NULL DEFAULT false,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EndCustomer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UomConversion" (
    "id" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "uomOrigen" TEXT NOT NULL,
    "uomDestino" TEXT NOT NULL,
    "factorConversion" DOUBLE PRECISION NOT NULL,
    "codigoBarras" TEXT,
    "descripcion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UomConversion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderApproval" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "estado" TEXT NOT NULL,
    "aprobadoPor" TEXT,
    "motivo" TEXT,
    "notas" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "descripcion" TEXT,
    "area" TEXT NOT NULL,
    "asignadoA" TEXT,
    "asignadoNombre" TEXT,
    "prioridad" TEXT NOT NULL DEFAULT 'MEDIA',
    "estado" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "fechaLimite" TIMESTAMP(3),
    "completadaEn" TIMESTAMP(3),
    "completadaPor" TEXT,
    "notas" TEXT,
    "alertaId" TEXT,
    "creadoPor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemSetting" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'general',
    "label" TEXT,
    "encrypted" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EndCustomer_clienteId_idx" ON "EndCustomer"("clienteId");

-- CreateIndex
CREATE UNIQUE INDEX "EndCustomer_clienteId_codigo_key" ON "EndCustomer"("clienteId", "codigo");

-- CreateIndex
CREATE INDEX "UomConversion_skuId_idx" ON "UomConversion"("skuId");

-- CreateIndex
CREATE UNIQUE INDEX "UomConversion_skuId_uomOrigen_uomDestino_key" ON "UomConversion"("skuId", "uomOrigen", "uomDestino");

-- CreateIndex
CREATE UNIQUE INDEX "SystemSetting_key_key" ON "SystemSetting"("key");

-- AddForeignKey
ALTER TABLE "EndCustomer" ADD CONSTRAINT "EndCustomer_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_endCustomerId_fkey" FOREIGN KEY ("endCustomerId") REFERENCES "EndCustomer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UomConversion" ADD CONSTRAINT "UomConversion_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "SkuMaster"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderApproval" ADD CONSTRAINT "OrderApproval_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "SalesOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_alertaId_fkey" FOREIGN KEY ("alertaId") REFERENCES "Alert"("id") ON DELETE SET NULL ON UPDATE CASCADE;
