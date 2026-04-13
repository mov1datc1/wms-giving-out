import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as any);

async function main() {
  console.log('📦 Inyectando datos operativos demo...\n');

  // Get existing data
  const clients = await prisma.client.findMany();
  const skus = await prisma.skuMaster.findMany({ include: { cliente: true } });
  const locations = await prisma.location.findMany({ include: { zona: true } });
  const warehouse = await prisma.warehouse.findFirst();

  if (!warehouse || clients.length === 0 || skus.length === 0) {
    console.error('❌ Ejecuta primero el seed base (npx prisma db seed)');
    return;
  }

  const clienteRopa = clients.find(c => c.giro === 'ROPA')!;
  const clienteComida = clients.find(c => c.giro === 'COMIDA')!;
  const skusRopa = skus.filter(s => s.clienteId === clienteRopa.id);
  const skusComida = skus.filter(s => s.clienteId === clienteComida.id);
  const locsA = locations.filter(l => l.zonaId && l.pasillo.startsWith('A'));
  const locsB = locations.filter(l => l.zonaId && l.pasillo.startsWith('B'));
  const locsRec = locations.filter(l => l.tipoUbicacion === 'RECIBO');
  const locsStg = locations.filter(l => l.tipoUbicacion === 'STAGING');

  // ============ SUPPLIERS ============
  const suppliers = await prisma.supplier.findMany();

  // ============ LOTES + HUs (ROPA) ============
  console.log('  👕 Creando inventario de ropa...');
  const ropaCantidades = [120, 85, 60, 45, 90, 72, 55, 30, 25, 40];
  const lotesRopa: any[] = [];
  for (let i = 0; i < skusRopa.length; i++) {
    const sku = skusRopa[i];
    const loc = locsA[i % locsA.length];
    const lot = await prisma.lotInventory.create({
      data: {
        skuId: sku.id, clienteId: clienteRopa.id,
        lote: `LR-2026-${String(i + 1).padStart(3, '0')}`,
        estadoCalidad: 'LIBERADO',
        cantidadDisponible: ropaCantidades[i],
        cantidadReservada: i < 3 ? Math.floor(ropaCantidades[i] * 0.1) : 0,
        ubicacionId: loc.id,
        proveedorNombre: suppliers[i % suppliers.length]?.nombre || 'Proveedor Genérico',
      },
    });
    lotesRopa.push(lot);

    // Create HU
    await prisma.handlingUnit.create({
      data: {
        codigo: `HU-2026-${String(i + 1).padStart(5, '0')}`,
        tipoHu: 'CAJA', lotId: lot.id, clienteId: clienteRopa.id,
        cantidad: ropaCantidades[i], uom: 'PZA', ubicacionActual: loc.id,
        etiquetaImpresa: i < 5,
      },
    });

    // Update location
    await prisma.location.update({
      where: { id: loc.id },
      data: { ocupacion: 1, estado: 'OCUPADO' },
    });

    // Inventory movement
    await prisma.inventoryMovement.create({
      data: {
        tipoMovimiento: 'ENTRADA', almacenId: warehouse.id,
        skuId: sku.id, clienteId: clienteRopa.id, lotId: lot.id,
        toLocationId: loc.id, cantidad: ropaCantidades[i],
        usuario: 'admin@givingout.com',
        motivo: `Recepción inicial — ${sku.descripcion}`,
        fechaHora: new Date(Date.now() - (10 - i) * 24 * 3600 * 1000),
      },
    });
  }

  // ============ LOTES + HUs (COMIDA — con lotes y caducidad) ============
  console.log('  🍪 Creando inventario de comida...');
  const comidaCantidades = [200, 150, 300, 80, 240, 180, 160, 400];
  const lotesComida: any[] = [];
  for (let i = 0; i < skusComida.length; i++) {
    const sku = skusComida[i];
    const loc = locsB[i % locsB.length];
    const monthsToExpiry = 3 + (i * 2);
    const lot = await prisma.lotInventory.create({
      data: {
        skuId: sku.id, clienteId: clienteComida.id,
        lote: `LC-2026-${String(100 + i).padStart(3, '0')}`,
        fechaVencimiento: new Date(Date.now() + monthsToExpiry * 30 * 24 * 3600 * 1000),
        fechaProduccion: new Date(Date.now() - 30 * 24 * 3600 * 1000),
        estadoCalidad: 'LIBERADO',
        cantidadDisponible: comidaCantidades[i],
        cantidadReservada: i < 2 ? 20 : 0,
        ubicacionId: loc.id,
        proveedorNombre: suppliers[1]?.nombre || 'Alimentos del Centro',
      },
    });
    lotesComida.push(lot);

    await prisma.handlingUnit.create({
      data: {
        codigo: `HU-2026-${String(20 + i).padStart(5, '0')}`,
        tipoHu: i < 4 ? 'CAJA' : 'PALLET', lotId: lot.id, clienteId: clienteComida.id,
        cantidad: comidaCantidades[i], uom: 'PZA', ubicacionActual: loc.id,
        pesoKg: comidaCantidades[i] * (sku.pesoKg || 0.5),
        etiquetaImpresa: true,
      },
    });

    await prisma.location.update({
      where: { id: loc.id },
      data: { ocupacion: { increment: 1 }, estado: 'OCUPADO' },
    });

    await prisma.inventoryMovement.create({
      data: {
        tipoMovimiento: 'ENTRADA', almacenId: warehouse.id,
        skuId: sku.id, clienteId: clienteComida.id, lotId: lot.id,
        toLocationId: loc.id, cantidad: comidaCantidades[i],
        usuario: 'admin@givingout.com',
        motivo: `Recepción lote ${lot.lote} — ${sku.descripcion}`,
        fechaHora: new Date(Date.now() - (8 - i) * 24 * 3600 * 1000),
      },
    });
  }

  // ============ RECEPCIONES ============
  console.log('  📥 Creando recepciones...');
  const recepciones = [
    {
      clienteId: clienteRopa.id, proveedorId: suppliers[0]?.id, proveedorNombre: suppliers[0]?.nombre || 'Textiles del Valle',
      estado: 'COMPLETO', ocReferencia: 'OC-ROPA-2026-001', recibidoPor: 'recepcion@givingout.com',
      fechaRecepcion: new Date(Date.now() - 7 * 24 * 3600 * 1000),
      lineas: skusRopa.slice(0, 4).map((sku, i) => ({
        skuId: sku.id, cantidadEsperada: ropaCantidades[i], cantidadRecibida: ropaCantidades[i], estado: 'COMPLETO',
      })),
    },
    {
      clienteId: clienteComida.id, proveedorId: suppliers[1]?.id, proveedorNombre: suppliers[1]?.nombre || 'Alimentos del Centro',
      estado: 'COMPLETO', ocReferencia: 'OC-COMIDA-2026-001', recibidoPor: 'recepcion@givingout.com',
      fechaRecepcion: new Date(Date.now() - 5 * 24 * 3600 * 1000),
      lineas: skusComida.slice(0, 5).map((sku, i) => ({
        skuId: sku.id, cantidadEsperada: comidaCantidades[i], cantidadRecibida: comidaCantidades[i], estado: 'COMPLETO',
      })),
    },
    {
      clienteId: clienteRopa.id, proveedorNombre: 'Importadora de Moda',
      estado: 'EN_PROCESO', ocReferencia: 'OC-ROPA-2026-002', recibidoPor: 'recepcion@givingout.com',
      fechaRecepcion: new Date(),
      lineas: skusRopa.slice(5, 8).map((sku, i) => ({
        skuId: sku.id, cantidadEsperada: 100, cantidadRecibida: i === 0 ? 100 : 0, estado: i === 0 ? 'COMPLETO' : 'PENDIENTE',
      })),
    },
    {
      clienteId: clienteComida.id, proveedorNombre: 'Alimentos del Centro',
      estado: 'PENDIENTE', ocReferencia: 'OC-COMIDA-2026-002',
      fechaRecepcion: new Date(Date.now() + 2 * 24 * 3600 * 1000),
      lineas: skusComida.slice(3, 7).map((sku) => ({
        skuId: sku.id, cantidadEsperada: 150, cantidadRecibida: 0, estado: 'PENDIENTE',
      })),
    },
  ];

  for (let i = 0; i < recepciones.length; i++) {
    const { lineas, ...recData } = recepciones[i];
    await prisma.receipt.create({
      data: {
        codigo: `REC-2026-${String(i + 1).padStart(4, '0')}`,
        ...recData,
        lineas: { create: lineas },
      },
    });
  }

  // ============ ÓRDENES DE SALIDA ============
  console.log('  📤 Creando órdenes de salida...');
  const ordenes = [
    {
      clienteId: clienteRopa.id, destinatario: 'Tienda Centro CDMX',
      direccionEntrega: 'Av. Madero 56, Centro, CDMX', prioridad: 2,
      estado: 'DESPACHADO', fechaDespacho: new Date(Date.now() - 3 * 24 * 3600 * 1000),
      despachador: 'admin@givingout.com', vehiculoPlaca: 'ABC-123',
      fechaCompromiso: new Date(Date.now() - 2 * 24 * 3600 * 1000),
      lineas: [
        { skuId: skusRopa[0].id, cantidadSolicitada: 24, cantidadAsignada: 24 },
        { skuId: skusRopa[1].id, cantidadSolicitada: 12, cantidadAsignada: 12 },
      ],
    },
    {
      clienteId: clienteComida.id, destinatario: 'CEDIS Norte Naucalpan',
      direccionEntrega: 'Parque Industrial Norte Km 5, Naucalpan', prioridad: 1,
      estado: 'EN_PICKING',
      fechaCompromiso: new Date(Date.now() + 1 * 24 * 3600 * 1000),
      lineas: [
        { skuId: skusComida[0].id, cantidadSolicitada: 48, cantidadAsignada: 0 },
        { skuId: skusComida[2].id, cantidadSolicitada: 60, cantidadAsignada: 0 },
        { skuId: skusComida[4].id, cantidadSolicitada: 24, cantidadAsignada: 0 },
      ],
    },
    {
      clienteId: clienteRopa.id, destinatario: 'Tienda Polanco CDMX',
      direccionEntrega: 'Av. Masaryk 201, Polanco, CDMX', prioridad: 3,
      estado: 'PENDIENTE',
      fechaCompromiso: new Date(Date.now() + 3 * 24 * 3600 * 1000),
      lineas: [
        { skuId: skusRopa[3].id, cantidadSolicitada: 30, cantidadAsignada: 0 },
        { skuId: skusRopa[7].id, cantidadSolicitada: 15, cantidadAsignada: 0 },
      ],
    },
    {
      clienteId: clienteComida.id, destinatario: 'Sucursal Toluca',
      direccionEntrega: 'Blvd. Toluca 890, Naucalpan', prioridad: 2,
      estado: 'CONFIRMADO',
      fechaCompromiso: new Date(Date.now() + 2 * 24 * 3600 * 1000),
      lineas: [
        { skuId: skusComida[1].id, cantidadSolicitada: 40, cantidadAsignada: 0 },
        { skuId: skusComida[5].id, cantidadSolicitada: 36, cantidadAsignada: 0 },
      ],
    },
    {
      clienteId: clienteRopa.id, destinatario: 'Marketplace MercadoLibre',
      direccionEntrega: 'CEDIS MeLi, Cuautitlán Izcalli', prioridad: 3,
      estado: 'PENDIENTE',
      fechaCompromiso: new Date(Date.now() + 5 * 24 * 3600 * 1000),
      lineas: [
        { skuId: skusRopa[0].id, cantidadSolicitada: 50, cantidadAsignada: 0 },
        { skuId: skusRopa[2].id, cantidadSolicitada: 50, cantidadAsignada: 0 },
        { skuId: skusRopa[4].id, cantidadSolicitada: 30, cantidadAsignada: 0 },
      ],
    },
  ];

  for (let i = 0; i < ordenes.length; i++) {
    const { lineas, ...ordData } = ordenes[i];
    await prisma.salesOrder.create({
      data: {
        codigo: `PED-2026-${String(i + 1).padStart(4, '0')}`,
        ...ordData,
        lineas: { create: lineas },
      },
    });
  }

  // ============ ALERTAS ============
  console.log('  🚨 Creando alertas...');
  await prisma.alert.createMany({
    data: [
      { tipo: 'STOCK_BAJO', prioridad: 'ALTA', titulo: 'Stock bajo: Chamarra Cuero L', detalle: 'Solo 25 unidades disponibles (mínimo sugerido: 50)', clienteId: clienteRopa.id },
      { tipo: 'PEDIDO_ATRASADO', prioridad: 'CRITICA', titulo: 'Pedido PED-2026-0002 urgente', detalle: 'Prioridad 1 — entrega mañana, aún en picking', clienteId: clienteComida.id },
      { tipo: 'RESERVA_VENCIDA', prioridad: 'MEDIA', titulo: 'Reserva expirada sin confirmar', detalle: 'Cliente Fashion Forward tiene reservas sin confirmar desde hace 5 días' },
      { tipo: 'UBICACION_SATURADA', prioridad: 'BAJA', titulo: 'Zona B cerca de capacidad', detalle: 'Zona B (Comida) al 85% de ocupación' },
    ],
  });

  // ============ MOVIMIENTOS ADICIONALES (Trasiego) ============
  console.log('  🔄 Creando movimientos de trasiego...');
  if (lotesRopa.length >= 2 && locsA.length >= 4) {
    await prisma.inventoryMovement.create({
      data: {
        tipoMovimiento: 'TRASIEGO', almacenId: warehouse.id,
        skuId: skusRopa[0].id, clienteId: clienteRopa.id, lotId: lotesRopa[0].id,
        fromLocationId: locsA[0].id, toLocationId: locsA[3].id,
        cantidad: 20, usuario: 'supervisor@givingout.com',
        motivo: 'Reorganización zona A — acercar a picking',
        fechaHora: new Date(Date.now() - 2 * 24 * 3600 * 1000),
      },
    });
  }

  // Salida movement for dispatched order
  await prisma.inventoryMovement.create({
    data: {
      tipoMovimiento: 'SALIDA', almacenId: warehouse.id,
      skuId: skusRopa[0].id, clienteId: clienteRopa.id,
      cantidad: 24, usuario: 'admin@givingout.com',
      motivo: 'Despacho PED-2026-0001 → Tienda Centro CDMX',
      fechaHora: new Date(Date.now() - 3 * 24 * 3600 * 1000),
    },
  });

  console.log('\n✅ Datos operativos inyectados exitosamente');
  console.log(`   📦 ${lotesRopa.length + lotesComida.length} lotes con inventario`);
  console.log(`   🏷️  ${lotesRopa.length + lotesComida.length} handling units`);
  console.log(`   📥 ${recepciones.length} recepciones`);
  console.log(`   📤 ${ordenes.length} órdenes de salida`);
  console.log(`   🚨 4 alertas activas`);
  console.log(`   🔄 ${10 + 8 + 2} movimientos de inventario\n`);
}

main()
  .catch(console.error)
  .finally(() => { prisma.$disconnect(); pool.end(); });
