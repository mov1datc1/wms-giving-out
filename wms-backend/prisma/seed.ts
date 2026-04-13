import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as bcrypt from 'bcrypt';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as any);

async function main() {
  console.log('🌱 Seeding Giving Out WMS...\n');

  // ======================== ROLES ========================
  const roles = await Promise.all([
    prisma.role.create({ data: { nombre: 'Super Admin', descripcion: 'Acceso total al sistema', nivel: 1 } }),
    prisma.role.create({ data: { nombre: 'Dirección', descripcion: 'KPIs, dashboards, auditoría', nivel: 2 } }),
    prisma.role.create({ data: { nombre: 'Gerente Operaciones', descripcion: 'Control operativo completo', nivel: 3 } }),
    prisma.role.create({ data: { nombre: 'Supervisor Almacén', descripcion: 'Tareas, discrepancias, reimpresiones', nivel: 4 } }),
    prisma.role.create({ data: { nombre: 'Operador Recepción', descripcion: 'Recibir, escanear, etiquetar', nivel: 5 } }),
    prisma.role.create({ data: { nombre: 'Operador Picking', descripcion: 'Surtido, empaque, staging', nivel: 5 } }),
    prisma.role.create({ data: { nombre: 'Comercial', descripcion: 'Stock, cotización, pedidos', nivel: 6 } }),
    prisma.role.create({ data: { nombre: 'Compras', descripcion: 'Stock neto, sugeridos, OC', nivel: 6 } }),
    prisma.role.create({ data: { nombre: 'Cliente Portal', descripcion: 'Vista limitada a su inventario', nivel: 10 } }),
  ]);

  const [superAdmin, direccion, gerente, supervisor, opRecep, opPicking, comercial, compras, clientePortal] = roles;

  // ======================== PERMISSIONS ========================
  const allModules = ['dashboard', 'inventario', 'ubicaciones', 'recepcion', 'picking', 'despacho', 'clientes', 'maestros', 'etiquetado', 'trazabilidad', 'conteo-ciclico', 'comercial', 'alertas', 'admin'];
  const allActions = ['ver', 'crear', 'editar', 'aprobar', 'imprimir', 'cancelar', 'ajustar', 'exportar'];

  // Super Admin: everything
  for (const modulo of allModules) {
    for (const accion of allActions) {
      await prisma.rolePermission.create({ data: { rolId: superAdmin.id, modulo, accion } });
    }
  }

  // Dirección: view only
  for (const modulo of ['dashboard', 'inventario', 'clientes', 'alertas', 'trazabilidad']) {
    await prisma.rolePermission.create({ data: { rolId: direccion.id, modulo, accion: 'ver' } });
    await prisma.rolePermission.create({ data: { rolId: direccion.id, modulo, accion: 'exportar' } });
  }

  // Gerente: most operational
  for (const modulo of ['dashboard', 'inventario', 'ubicaciones', 'recepcion', 'picking', 'despacho', 'clientes', 'maestros', 'conteo-ciclico', 'alertas', 'trazabilidad', 'etiquetado']) {
    for (const accion of ['ver', 'crear', 'editar', 'aprobar', 'imprimir', 'exportar']) {
      await prisma.rolePermission.create({ data: { rolId: gerente.id, modulo, accion } });
    }
  }

  // Supervisor: operational without admin
  for (const modulo of ['dashboard', 'inventario', 'ubicaciones', 'recepcion', 'picking', 'despacho', 'etiquetado', 'conteo-ciclico', 'alertas']) {
    for (const accion of ['ver', 'crear', 'editar', 'imprimir']) {
      await prisma.rolePermission.create({ data: { rolId: supervisor.id, modulo, accion } });
    }
  }

  // Operador Recepción
  for (const modulo of ['recepcion', 'inventario', 'etiquetado']) {
    for (const accion of ['ver', 'crear', 'imprimir']) {
      await prisma.rolePermission.create({ data: { rolId: opRecep.id, modulo, accion } });
    }
  }
  await prisma.rolePermission.create({ data: { rolId: opRecep.id, modulo: 'dashboard', accion: 'ver' } });

  // Operador Picking
  for (const modulo of ['picking', 'despacho', 'inventario']) {
    for (const accion of ['ver', 'crear']) {
      await prisma.rolePermission.create({ data: { rolId: opPicking.id, modulo, accion } });
    }
  }
  await prisma.rolePermission.create({ data: { rolId: opPicking.id, modulo: 'dashboard', accion: 'ver' } });

  // Comercial
  for (const modulo of ['dashboard', 'inventario', 'clientes', 'comercial']) {
    for (const accion of ['ver', 'crear']) {
      await prisma.rolePermission.create({ data: { rolId: comercial.id, modulo, accion } });
    }
  }

  // Cliente Portal
  for (const modulo of ['dashboard', 'inventario']) {
    await prisma.rolePermission.create({ data: { rolId: clientePortal.id, modulo, accion: 'ver' } });
  }

  // ======================== USERS ========================
  const hash = await bcrypt.hash('admin123', 10);
  await prisma.user.create({ data: { email: 'admin@givingout.com', nombre: 'Administrador', passwordHash: hash, rolId: superAdmin.id } });
  await prisma.user.create({ data: { email: 'gerente@givingout.com', nombre: 'Carlos Mendoza', passwordHash: hash, rolId: gerente.id } });
  await prisma.user.create({ data: { email: 'supervisor@givingout.com', nombre: 'Ana García', passwordHash: hash, rolId: supervisor.id } });
  await prisma.user.create({ data: { email: 'recepcion@givingout.com', nombre: 'Juan Pérez', passwordHash: hash, rolId: opRecep.id } });
  await prisma.user.create({ data: { email: 'picking@givingout.com', nombre: 'María López', passwordHash: hash, rolId: opPicking.id } });

  // ======================== WAREHOUSE ========================
  const warehouse = await prisma.warehouse.create({
    data: { codigo: 'ALM-TEPOZ', nombre: 'Almacén Tepotzotlán', direccion: 'Tepotzotlán, Estado de México', ciudad: 'Tepotzotlán', metrosCuadrados: 150 },
  });

  // ======================== ZONES ========================
  const zoneRecibo = await prisma.zone.create({ data: { codigo: 'RECIBO', nombre: 'Zona de Recibo', almacenId: warehouse.id, tipoZona: 'RECIBO' } });
  const zoneAlmA = await prisma.zone.create({ data: { codigo: 'ALM-A', nombre: 'Almacenamiento A (Ropa)', almacenId: warehouse.id, tipoZona: 'ALMACENAMIENTO' } });
  const zoneAlmB = await prisma.zone.create({ data: { codigo: 'ALM-B', nombre: 'Almacenamiento B (Comida)', almacenId: warehouse.id, tipoZona: 'ALMACENAMIENTO' } });
  const zoneStaging = await prisma.zone.create({ data: { codigo: 'STAGING', nombre: 'Zona de Staging/Salida', almacenId: warehouse.id, tipoZona: 'STAGING' } });

  // ======================== LOCATIONS ========================
  const locations: any[] = [];
  // Zone A (Ropa): 3 pasillos x 4 racks x 3 niveles
  for (let p = 1; p <= 3; p++) {
    for (let r = 1; r <= 4; r++) {
      for (let n = 1; n <= 3; n++) {
        locations.push({
          codigo: `A${String(p).padStart(2, '0')}-R${String(r).padStart(2, '0')}-N${n}`,
          almacenId: warehouse.id, zonaId: zoneAlmA.id,
          pasillo: `A${String(p).padStart(2, '0')}`, rack: `R${String(r).padStart(2, '0')}`, nivel: `N${n}`,
          tipoUbicacion: 'ESTANTERIA', temperatura: 'AMBIENTE', capacidadUnits: 50,
        });
      }
    }
  }
  // Zone B (Comida): 2 pasillos x 3 racks x 2 niveles
  for (let p = 1; p <= 2; p++) {
    for (let r = 1; r <= 3; r++) {
      for (let n = 1; n <= 2; n++) {
        locations.push({
          codigo: `B${String(p).padStart(2, '0')}-R${String(r).padStart(2, '0')}-N${n}`,
          almacenId: warehouse.id, zonaId: zoneAlmB.id,
          pasillo: `B${String(p).padStart(2, '0')}`, rack: `R${String(r).padStart(2, '0')}`, nivel: `N${n}`,
          tipoUbicacion: 'ESTANTERIA', temperatura: 'AMBIENTE', capacidadUnits: 40,
        });
      }
    }
  }
  // Recibo and Staging
  locations.push({ codigo: 'REC-01', almacenId: warehouse.id, zonaId: zoneRecibo.id, pasillo: 'REC', rack: '01', nivel: 'P', tipoUbicacion: 'RECIBO', capacidadUnits: 200 });
  locations.push({ codigo: 'REC-02', almacenId: warehouse.id, zonaId: zoneRecibo.id, pasillo: 'REC', rack: '02', nivel: 'P', tipoUbicacion: 'RECIBO', capacidadUnits: 200 });
  locations.push({ codigo: 'STG-01', almacenId: warehouse.id, zonaId: zoneStaging.id, pasillo: 'STG', rack: '01', nivel: 'P', tipoUbicacion: 'STAGING', capacidadUnits: 300 });
  locations.push({ codigo: 'STG-02', almacenId: warehouse.id, zonaId: zoneStaging.id, pasillo: 'STG', rack: '02', nivel: 'P', tipoUbicacion: 'STAGING', capacidadUnits: 300 });

  for (const loc of locations) {
    await prisma.location.create({ data: loc });
  }

  // ======================== CLIENTS ========================
  const clienteRopa = await prisma.client.create({
    data: {
      codigo: 'ROPA-01', razonSocial: 'Fashion Forward S.A. de C.V.', nombreComercial: 'Fashion Forward',
      rfc: 'FFA210315XX1', giro: 'ROPA', tipoCliente: 'ALMACENAJE',
      direccionFiscal: 'Av. Insurgentes Sur 1234, CDMX', ciudad: 'CDMX', estado: 'CDMX',
      telefono: '55-1234-5678', email: 'logistica@fashionforward.mx',
      contactoPrincipal: 'Laura Martínez', requiereLote: false, requiereSerie: false, requiereCaducidad: false,
      contactos: {
        create: [
          { nombre: 'Laura Martínez', cargo: 'Gerente Logística', telefono: '55-1234-5678', email: 'laura@fashionforward.mx', esPrincipal: true },
          { nombre: 'Roberto Sánchez', cargo: 'Coordinador Almacén', telefono: '55-8765-4321', email: 'roberto@fashionforward.mx' },
        ],
      },
      direccionesEntrega: {
        create: [
          { alias: 'Tienda Centro', calle: 'Av. Madero 56', colonia: 'Centro', ciudad: 'CDMX', cp: '06000', esDefault: true },
          { alias: 'Tienda Polanco', calle: 'Av. Masaryk 201', colonia: 'Polanco', ciudad: 'CDMX', cp: '11560' },
        ],
      },
    },
  });

  const clienteComida = await prisma.client.create({
    data: {
      codigo: 'COMIDA-01', razonSocial: 'Distribuidora Alimentaria del Norte S.A. de C.V.', nombreComercial: 'AlimNorte',
      rfc: 'DAN190820YY2', giro: 'COMIDA', tipoCliente: 'ALMACENAJE',
      direccionFiscal: 'Blvd. Toluca 890, Naucalpan', ciudad: 'Naucalpan', estado: 'Estado de México',
      telefono: '55-9876-5432', email: 'almacen@alimnorte.mx',
      contactoPrincipal: 'Pedro Ramírez', requiereLote: true, requiereSerie: false, requiereCaducidad: true,
      contactos: {
        create: [
          { nombre: 'Pedro Ramírez', cargo: 'Director Operaciones', telefono: '55-9876-5432', email: 'pedro@alimnorte.mx', esPrincipal: true },
        ],
      },
      direccionesEntrega: {
        create: [
          { alias: 'CEDIS Norte', calle: 'Parque Industrial Norte Km 5', colonia: 'Zona Industrial', ciudad: 'Naucalpan', cp: '53370', esDefault: true },
        ],
      },
    },
  });

  // ======================== SUPPLIERS ========================
  await prisma.supplier.create({ data: { codigo: 'PROV-001', nombre: 'Textiles del Valle', telefono: '55-1111-2222', email: 'ventas@textilesdelvalle.mx' } });
  await prisma.supplier.create({ data: { codigo: 'PROV-002', nombre: 'Alimentos del Centro', telefono: '55-3333-4444', email: 'pedidos@alimcentro.mx' } });
  await prisma.supplier.create({ data: { codigo: 'PROV-003', nombre: 'Importadora de Moda', telefono: '55-5555-6666', email: 'compras@importamoda.mx' } });

  // ======================== SKUs (Ropa) ========================
  const ropaSkus = [
    { codigo: 'CAM-BLA-S', descripcion: 'Camiseta Básica Blanca', categoria: 'PRENDA', subcategoria: 'CAMISETA', marca: 'BasicWear', color: 'Blanco', talla: 'S', capacidadEmpaque: 12, descripcionEmpaque: 'Caja x12' },
    { codigo: 'CAM-BLA-M', descripcion: 'Camiseta Básica Blanca', categoria: 'PRENDA', subcategoria: 'CAMISETA', marca: 'BasicWear', color: 'Blanco', talla: 'M', capacidadEmpaque: 12, descripcionEmpaque: 'Caja x12' },
    { codigo: 'CAM-BLA-L', descripcion: 'Camiseta Básica Blanca', categoria: 'PRENDA', subcategoria: 'CAMISETA', marca: 'BasicWear', color: 'Blanco', talla: 'L', capacidadEmpaque: 12, descripcionEmpaque: 'Caja x12' },
    { codigo: 'CAM-NEG-M', descripcion: 'Camiseta Básica Negra', categoria: 'PRENDA', subcategoria: 'CAMISETA', marca: 'BasicWear', color: 'Negro', talla: 'M', capacidadEmpaque: 12, descripcionEmpaque: 'Caja x12' },
    { codigo: 'PAN-JEA-28', descripcion: 'Pantalón Jeans Clásico', categoria: 'PRENDA', subcategoria: 'PANTALON', marca: 'DenimCo', color: 'Azul', talla: '28', capacidadEmpaque: 6, descripcionEmpaque: 'Paquete x6' },
    { codigo: 'PAN-JEA-30', descripcion: 'Pantalón Jeans Clásico', categoria: 'PRENDA', subcategoria: 'PANTALON', marca: 'DenimCo', color: 'Azul', talla: '30', capacidadEmpaque: 6, descripcionEmpaque: 'Paquete x6' },
    { codigo: 'PAN-JEA-32', descripcion: 'Pantalón Jeans Clásico', categoria: 'PRENDA', subcategoria: 'PANTALON', marca: 'DenimCo', color: 'Azul', talla: '32', capacidadEmpaque: 6, descripcionEmpaque: 'Paquete x6' },
    { codigo: 'VES-FLO-M', descripcion: 'Vestido Floral Verano', categoria: 'PRENDA', subcategoria: 'VESTIDO', marca: 'FloralChic', color: 'Multicolor', talla: 'M', capacidadEmpaque: 8, descripcionEmpaque: 'Caja x8' },
    { codigo: 'CHA-CUE-L', descripcion: 'Chamarra de Cuero Sintético', categoria: 'PRENDA', subcategoria: 'CHAMARRA', marca: 'UrbanEdge', color: 'Negro', talla: 'L', capacidadEmpaque: 4, descripcionEmpaque: 'Caja x4' },
    { codigo: 'SUD-GRI-XL', descripcion: 'Sudadera con Capucha', categoria: 'PRENDA', subcategoria: 'SUDADERA', marca: 'ComfortPlus', color: 'Gris', talla: 'XL', capacidadEmpaque: 10, descripcionEmpaque: 'Caja x10' },
  ];

  for (const sku of ropaSkus) {
    await prisma.skuMaster.create({ data: { ...sku, clienteId: clienteRopa.id, uomBase: 'PZA' } });
  }

  // ======================== SKUs (Comida) ========================
  const comidaSkus = [
    { codigo: 'GAL-CHO-1K', descripcion: 'Galletas de Chocolate 1Kg', categoria: 'ALIMENTO', subcategoria: 'SNACK', marca: 'CrunchTime', capacidadEmpaque: 24, descripcionEmpaque: 'Caja x24', requiereLote: true, requiereCaducidad: true },
    { codigo: 'CER-AVE-500', descripcion: 'Cereal de Avena 500g', categoria: 'ALIMENTO', subcategoria: 'CEREAL', marca: 'NutriGrain', capacidadEmpaque: 20, descripcionEmpaque: 'Caja x20', requiereLote: true, requiereCaducidad: true },
    { codigo: 'SAL-TOM-350', descripcion: 'Salsa de Tomate 350ml', categoria: 'ALIMENTO', subcategoria: 'CONDIMENTO', marca: 'SaborCasa', capacidadEmpaque: 30, descripcionEmpaque: 'Caja x30', requiereLote: true, requiereCaducidad: true },
    { codigo: 'ACE-OLI-1L', descripcion: 'Aceite de Oliva Extra Virgen 1L', categoria: 'ALIMENTO', subcategoria: 'ACEITE', marca: 'OlivGold', capacidadEmpaque: 12, descripcionEmpaque: 'Caja x12', requiereLote: true, requiereCaducidad: true },
    { codigo: 'PAS-INT-500', descripcion: 'Pasta Integral 500g', categoria: 'ALIMENTO', subcategoria: 'PASTA', marca: 'VitaPasta', capacidadEmpaque: 24, descripcionEmpaque: 'Caja x24', requiereLote: true, requiereCaducidad: true },
    { codigo: 'ARR-BLA-1K', descripcion: 'Arroz Blanco Grano Largo 1Kg', categoria: 'ALIMENTO', subcategoria: 'GRANO', marca: 'GranoFino', capacidadEmpaque: 20, descripcionEmpaque: 'Bulto x20', requiereLote: true, requiereCaducidad: true },
    { codigo: 'FRI-NOR-800', descripcion: 'Frijoles Negros Orgánicos 800g', categoria: 'ALIMENTO', subcategoria: 'LEGUMINOSA', marca: 'CampoVerde', capacidadEmpaque: 24, descripcionEmpaque: 'Caja x24', requiereLote: true, requiereCaducidad: true },
    { codigo: 'ATU-ACE-170', descripcion: 'Atún en Aceite 170g', categoria: 'ALIMENTO', subcategoria: 'ENLATADO', marca: 'MarAzul', capacidadEmpaque: 48, descripcionEmpaque: 'Caja x48', requiereLote: true, requiereCaducidad: true },
  ];

  for (const sku of comidaSkus) {
    await prisma.skuMaster.create({ data: { ...sku, clienteId: clienteComida.id, uomBase: 'PZA' } });
  }

  // ======================== PLATFORM SETTINGS ========================
  await prisma.platformSettings.create({
    data: { nombre: 'Giving Out WMS', subtitulo: 'Sistema de Gestión de Almacén', colorPrimario: '#2563EB', colorSecundario: '#7C3AED' },
  });

  console.log('✅ Seed completado exitosamente');
  console.log(`   📦 ${locations.length} ubicaciones`);
  console.log(`   👥 2 clientes (Ropa + Comida)`);
  console.log(`   📋 ${ropaSkus.length + comidaSkus.length} SKUs`);
  console.log(`   👤 5 usuarios (password: admin123)`);
  console.log(`   🔐 ${roles.length} roles\n`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
