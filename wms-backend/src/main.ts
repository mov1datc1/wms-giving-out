import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      if (!origin) return callback(null, true);
      if (origin.includes('localhost')) return callback(null, true);
      if (origin.endsWith('.vercel.app')) return callback(null, true);
      const allowedDomains = (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean);
      if (allowedDomains.includes(origin)) return callback(null, true);
      callback(null, true);
    },
    credentials: true,
  });

  // Swagger
  const config = new DocumentBuilder()
    .setTitle('Giving Out WMS — API')
    .setDescription('Sistema de Gestión de Almacén Multi-Cliente · NestJS + Prisma + Supabase')
    .setVersion('1.0')
    .addTag('Auth', 'Autenticación y usuarios')
    .addTag('Clients', 'Gestión de clientes multi-tenant')
    .addTag('Master Data', 'Catálogos: SKUs, Proveedores, Ubicaciones, Almacenes')
    .addTag('Inventory', 'Inventario por HU, lote, SKU, cliente')
    .addTag('Operations', 'Recepción, Picking, Despacho, Movimientos')
    .addTag('Commercial', 'Cotizaciones, Reservas')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  console.log(`\n📦 Giving Out WMS Backend corriendo en: http://localhost:${port}`);
  console.log(`📄 Swagger API Docs: http://localhost:${port}/api/docs\n`);
}
bootstrap();
