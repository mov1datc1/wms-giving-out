import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
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

  private async ensureSchemaColumns() {
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
