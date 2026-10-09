import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('error', (err) => {
  console.warn('⚠️ Supabase PG pool connection error (auto-reconnecting):', err.message);
});

const adapter = new PrismaPg(pool);

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({ adapter } as any);
  }

  async onModuleInit() {
    await this.$connect();
    console.log('✅ Prisma connected to Supabase PostgreSQL');
    await this.ensureSchemaColumns();
  }

  private static schemaMigrated = false;

  private async ensureSchemaColumns() {
    if (PrismaService.schemaMigrated) return;
    PrismaService.schemaMigrated = true;
    try {
      const sqls = [
        `ALTER TABLE "Receipt" ADD COLUMN IF NOT EXISTS "cerradoPor" TEXT;`,
        `ALTER TABLE "Receipt" ADD COLUMN IF NOT EXISTS "fechaCierre" TIMESTAMP(3);`,
        `ALTER TABLE "SalesOrder" ADD COLUMN IF NOT EXISTS "almacenOrigenId" TEXT;`,
        `ALTER TABLE "SalesOrder" ADD COLUMN IF NOT EXISTS "horaCompromiso" TEXT;`,
        `ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "uomPrincipal" TEXT DEFAULT 'PZA';`,
        `ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "manejoInventario" TEXT DEFAULT 'PIEZA';`,
        `ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "reglaInventario" TEXT DEFAULT 'FIFO';`,
        `ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "escaneoIndividual" BOOLEAN DEFAULT false;`,
        `ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "requiereAprobacion" BOOLEAN DEFAULT true;`,
        `ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "requiereLote" BOOLEAN DEFAULT false;`,
        `ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "requiereSerie" BOOLEAN DEFAULT false;`,
        `ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "requiereCaducidad" BOOLEAN DEFAULT false;`,
        `ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "zonaAsignadaId" TEXT;`,
        `ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "colorPortal" TEXT DEFAULT '#2563EB';`,
        `ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "logoUrl" TEXT;`,
        `ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "regimenFiscal" TEXT;`,
        `ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "pais" TEXT DEFAULT 'México';`,
        `ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "cfdiDefault" TEXT;`,
        `ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "sitioWeb" TEXT;`,
        // === FASE 1: Acta de Entrada en Rampa & Doble Etiquetado Giving Out ===
        `ALTER TABLE "Receipt" ADD COLUMN IF NOT EXISTS "bultosDeclarados" INTEGER;`,
        `ALTER TABLE "Receipt" ADD COLUMN IF NOT EXISTS "bultosRecibidos" INTEGER;`,
        `ALTER TABLE "Receipt" ADD COLUMN IF NOT EXISTS "bultosDanados" INTEGER;`,
        `ALTER TABLE "Receipt" ADD COLUMN IF NOT EXISTS "diferenciaBultos" INTEGER;`,
        `ALTER TABLE "Receipt" ADD COLUMN IF NOT EXISTS "observacionesRampa" TEXT;`,
        `ALTER TABLE "Receipt" ADD COLUMN IF NOT EXISTS "andenAsignado" TEXT;`,
        `ALTER TABLE "Receipt" ADD COLUMN IF NOT EXISTS "firmaChofer" TEXT;`,
        `ALTER TABLE "Receipt" ADD COLUMN IF NOT EXISTS "firmaReceptor" TEXT;`,
        `ALTER TABLE "Receipt" ADD COLUMN IF NOT EXISTS "nombreReceptor" TEXT;`,
        `ALTER TABLE "Receipt" ADD COLUMN IF NOT EXISTS "fechaLiberacionChofer" TIMESTAMP(3);`,
        `ALTER TABLE "Receipt" ADD COLUMN IF NOT EXISTS "historialCorreccionesRampa" TEXT;`,
        `ALTER TABLE "Receipt" ADD COLUMN IF NOT EXISTS "etiquetasEstado" TEXT DEFAULT 'PENDIENTE';`,
        `ALTER TABLE "Receipt" ADD COLUMN IF NOT EXISTS "etiquetasColocadasPor" TEXT;`,
        `ALTER TABLE "Receipt" ADD COLUMN IF NOT EXISTS "fechaColocacionEtiquetas" TIMESTAMP(3);`,
        `ALTER TABLE "HandlingUnit" ADD COLUMN IF NOT EXISTS "receiptId" TEXT;`,
        `ALTER TABLE "HandlingUnit" ADD COLUMN IF NOT EXISTS "receiptLineId" TEXT;`,
        `ALTER TABLE "HandlingUnit" ADD COLUMN IF NOT EXISTS "estadoEtiqueta" TEXT DEFAULT 'GENERADA';`,
        `ALTER TABLE "HandlingUnit" ADD COLUMN IF NOT EXISTS "loteTexto" TEXT;`,
        `ALTER TABLE "HandlingUnit" ADD COLUMN IF NOT EXISTS "fechaVencimiento" TIMESTAMP(3);`,
        `ALTER TABLE "HandlingUnit" ADD COLUMN IF NOT EXISTS "skuCodigo" TEXT;`,
        `ALTER TABLE "HandlingUnit" ADD COLUMN IF NOT EXISTS "skuDescripcion" TEXT;`,
        `ALTER TABLE "HandlingUnit" ADD COLUMN IF NOT EXISTS "facturaRespaldo" TEXT;`,
        `ALTER TABLE "HandlingUnit" ADD COLUMN IF NOT EXISTS "piezasPorCaja" INTEGER;`,
        `ALTER TABLE "HandlingUnit" ALTER COLUMN "lotId" DROP NOT NULL;`,
        // === FASE 2: Inspección y Reacondicionamiento (Maquila/Rescate) ===
        `ALTER TABLE "Receipt" ADD COLUMN IF NOT EXISTS "inspeccionCalidadEstado" TEXT DEFAULT 'PENDIENTE';`,
        `ALTER TABLE "HandlingUnit" ADD COLUMN IF NOT EXISTS "reacondicionada" BOOLEAN DEFAULT false;`,
        `ALTER TABLE "HandlingUnit" ADD COLUMN IF NOT EXISTS "cajaOrigenId" TEXT;`,
        `ALTER TABLE "HandlingUnit" ADD COLUMN IF NOT EXISTS "inspeccionId" TEXT;`,
        `ALTER TABLE "HandlingUnit" ADD COLUMN IF NOT EXISTS "motivoDano" TEXT;`,
        `CREATE TABLE IF NOT EXISTS "QualityInspection" (
          "id" TEXT PRIMARY KEY,
          "folio" TEXT UNIQUE NOT NULL,
          "receiptId" TEXT NOT NULL,
          "clienteId" TEXT NOT NULL,
          "fechaInspeccion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "inspectorNombre" TEXT NOT NULL,
          "estado" TEXT NOT NULL DEFAULT 'COMPLETADA',
          "totalCajasInspeccionadas" INTEGER NOT NULL DEFAULT 0,
          "totalPiezasInspeccionadas" INTEGER NOT NULL DEFAULT 0,
          "totalPiezasRescatadas" INTEGER NOT NULL DEFAULT 0,
          "totalPiezasMerma" INTEGER NOT NULL DEFAULT 0,
          "totalCajasNuevasArmadas" INTEGER NOT NULL DEFAULT 0,
          "horasMaquila" DOUBLE PRECISION DEFAULT 0,
          "tarifaMaquilaPorHora" DOUBLE PRECISION DEFAULT 0,
          "costoTotalMaquila" DOUBLE PRECISION DEFAULT 0,
          "observaciones" TEXT,
          "detallesJson" TEXT,
          "firmadoPor" TEXT,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        );`,
        `CREATE INDEX IF NOT EXISTS "QualityInspection_receiptId_idx" ON "QualityInspection"("receiptId");`,
        `CREATE INDEX IF NOT EXISTS "QualityInspection_clienteId_idx" ON "QualityInspection"("clienteId");`,
        // === FASE 5: Ciclo de Pedido, Reserva y Asignación de Lotes ===
        `ALTER TABLE "SalesOrder" ADD COLUMN IF NOT EXISTS "preparadoPor" TEXT;`,
        `ALTER TABLE "SalesOrder" ADD COLUMN IF NOT EXISTS "fechaPreparacion" TIMESTAMP(3);`,
        `ALTER TABLE "SalesOrder" ADD COLUMN IF NOT EXISTS "asignacionModo" TEXT DEFAULT 'AUTO_FEFO';`,
        `ALTER TABLE "SalesOrderLine" ADD COLUMN IF NOT EXISTS "loteAsignado" TEXT;`,
        `ALTER TABLE "SalesOrderLine" ADD COLUMN IF NOT EXISTS "ubicacionAsignada" TEXT;`,
        `ALTER TABLE "SalesOrderLine" ADD COLUMN IF NOT EXISTS "asignacionesJson" TEXT;`,
        // === FASE 6: Surtido (Picking) Doble Escaneo y Manifiesto de Despacho ===
        `ALTER TABLE "SalesOrder" ADD COLUMN IF NOT EXISTS "surtidor" TEXT;`,
        `ALTER TABLE "SalesOrder" ADD COLUMN IF NOT EXISTS "fechaInicioPicking" TIMESTAMP(3);`,
        `ALTER TABLE "SalesOrder" ADD COLUMN IF NOT EXISTS "fechaFinPicking" TIMESTAMP(3);`,
        `ALTER TABLE "SalesOrder" ADD COLUMN IF NOT EXISTS "choferNombre" TEXT;`,
        `ALTER TABLE "SalesOrder" ADD COLUMN IF NOT EXISTS "choferLicencia" TEXT;`,
        `ALTER TABLE "SalesOrder" ADD COLUMN IF NOT EXISTS "fletera" TEXT;`,
        `ALTER TABLE "SalesOrder" ADD COLUMN IF NOT EXISTS "selloSeguridad" TEXT;`,
        `ALTER TABLE "SalesOrder" ADD COLUMN IF NOT EXISTS "firmaDespachador" TEXT;`,
        `ALTER TABLE "SalesOrder" ADD COLUMN IF NOT EXISTS "firmaChofer" TEXT;`,
        `ALTER TABLE "SalesOrder" ADD COLUMN IF NOT EXISTS "folioManifiesto" TEXT;`,
        `ALTER TABLE "SalesOrderLine" ADD COLUMN IF NOT EXISTS "cantidadPickeada" DOUBLE PRECISION DEFAULT 0;`,
        `ALTER TABLE "SalesOrderLine" ADD COLUMN IF NOT EXISTS "ubicacionEscaneada" TEXT;`,
        `ALTER TABLE "SalesOrderLine" ADD COLUMN IF NOT EXISTS "cajaEscaneada" TEXT;`,
        `ALTER TABLE "SalesOrderLine" ADD COLUMN IF NOT EXISTS "pickingCompletado" BOOLEAN DEFAULT false;`,
        `ALTER TABLE "SalesOrderLine" ADD COLUMN IF NOT EXISTS "fechaPicking" TIMESTAMP(3);`,
        // === CANDADO DE INTEGRIDAD DE RESERVAS (Anti-negativos) ===
        `DO $$ BEGIN
           IF NOT EXISTS (
             SELECT 1 FROM pg_constraint WHERE conname = 'chk_lot_reserva_non_negative'
           ) THEN
             ALTER TABLE "LotInventory" ADD CONSTRAINT "chk_lot_reserva_non_negative" CHECK ("cantidadReservada" >= 0);
           END IF;
         END $$;`,
      ];

      for (const sql of sqls) {
        await this.$executeRawUnsafe(sql);
      }
      console.log('✅ Supabase DDL Auto-Migration: Schema columns verified');
    } catch (err) {
      console.error('⚠️ Supabase DDL Auto-Migration warning:', err);
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
    await pool.end();
  }
}
