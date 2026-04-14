# 🚀 Guía de Deploy — Giving Out WMS

**Backend:** Render (Node.js)  
**Frontend:** Vercel (Static/Vite)  
**Base de datos:** Supabase PostgreSQL (ya configurada)

---

## Paso 1: Deploy del Backend en Render

### 1.1 Crear el servicio

1. Ir a [dashboard.render.com](https://dashboard.render.com)
2. Click **"New +"** → **"Web Service"**
3. Conectar el repo: `github.com/mov1datc1/wms-giving-out`
4. Configurar así:

| Campo | Valor |
|-------|-------|
| **Name** | `wms-giving-out-api` |
| **Branch** | `dev` |
| **Root Directory** | `wms-backend` |
| **Runtime** | `Node` |
| **Build Command** | `npm install --include=dev && npx prisma generate && npm run build` |
| **Start Command** | `node dist/src/main.js` |
| **Instance Type** | Free (o Starter $7/mes para evitar sleep) |

### 1.2 Configurar Variables de Entorno

En Render → tu servicio → **Environment** → **Add Environment Variable**:

```
DATABASE_URL        = postgresql://postgres.sseegcltnozurxxieavj:8KXzwQ7JjVb5%40%409@aws-1-us-east-1.pooler.supabase.com:5432/postgres
DIRECT_URL          = postgresql://postgres.sseegcltnozurxxieavj:8KXzwQ7JjVb5%40%409@aws-1-us-east-1.pooler.supabase.com:5432/postgres
JWT_SECRET          = giving-out-wms-secret-2026-movida-tci
JWT_EXPIRES_IN      = 24h
PORT                = 3001
NODE_ENV            = production
ALLOWED_ORIGINS     = https://wms-giving-out.vercel.app
```

> ⚠️ **Nota:** Si tu dominio en Vercel es diferente (ej: `wms-giving-out-abc.vercel.app`), actualiza `ALLOWED_ORIGINS` después del paso 2.

### 1.3 Verificar el Deploy

Una vez que Render termine el build (~2-4 min):

1. Render te dará una URL tipo: `https://wms-giving-out-api.onrender.com`
2. Abre en el navegador: `https://wms-giving-out-api.onrender.com/health`
   - Deberías ver: `{"status":"ok"}`
3. Swagger docs: `https://wms-giving-out-api.onrender.com/api/docs`

**Copia la URL del backend** — la necesitas para el paso 2.

---

## Paso 2: Deploy del Frontend en Vercel

### 2.1 Crear el proyecto

1. Ir a [vercel.com/dashboard](https://vercel.com/dashboard)
2. Click **"Add New..."** → **"Project"**
3. Importar repo: `github.com/mov1datc1/wms-giving-out`
4. Configurar así:

| Campo | Valor |
|-------|-------|
| **Project Name** | `wms-giving-out` |
| **Framework Preset** | `Vite` |
| **Root Directory** | `wms-frontend` ← Click "Edit" para cambiar |
| **Build Command** | `npm run build` |
| **Output Directory** | `dist` |

### 2.2 Configurar Variable de Entorno

En la misma pantalla de setup, agregar:

```
VITE_API_URL = https://wms-giving-out-api.onrender.com/api
```

> ⚠️ Usa la URL real que Render te dio en el paso 1.3. No olvides el `/api` al final.

### 2.3 Hacer Deploy

1. Click **"Deploy"**
2. Esperar ~1-2 min
3. Vercel te dará una URL tipo: `https://wms-giving-out.vercel.app`
4. Abre la URL — deberías ver la pantalla de login 🎉

---

## Paso 3: Actualizar CORS en Render

Ahora que tienes la URL real de Vercel:

1. Ir a Render → tu servicio → **Environment**
2. Editar `ALLOWED_ORIGINS`:

```
ALLOWED_ORIGINS = https://wms-giving-out.vercel.app
```

Si tienes un dominio custom, agrégalo separado por coma:
```
ALLOWED_ORIGINS = https://wms-giving-out.vercel.app,https://wms.givingout.mx
```

3. Render hará re-deploy automáticamente

---

## Paso 4: Seed de datos iniciales (una sola vez)

Si la base de datos está vacía, necesitas ejecutar el seed. Desde tu máquina local:

```bash
cd wms-giving-out/wms-backend
npm run db:seed
```

Esto crea:
- Usuario admin: `admin@givingout.com` / `admin123`
- Almacén, zonas, ubicaciones
- Clientes y proveedores de ejemplo
- Roles y permisos

> **Nota:** El seed se conecta a Supabase directamente via tu `.env` local. Solo se ejecuta una vez.

---

## Paso 5: Verificación Final

### Checklist

- [ ] `https://TU-RENDER-URL/health` → `{"status":"ok"}`
- [ ] `https://TU-RENDER-URL/api/docs` → Swagger UI carga
- [ ] `https://TU-VERCEL-URL` → Pantalla de login carga
- [ ] Login con `admin@givingout.com` / `admin123` → Dashboard
- [ ] Navegar a Inventario → Datos visibles
- [ ] Navegar a Alertas → "Escanear Inventario" funciona
- [ ] Admin → Correo SMTP → Datos cargados

---

## Configuración de Dominio Custom (Opcional)

### En Vercel (Frontend)
1. Ir a tu proyecto → **Settings** → **Domains**
2. Agregar: `wms.givingout.mx` (o el dominio que quieras)
3. Vercel te dará los registros DNS (CNAME o A record)
4. Configurar en tu proveedor de DNS

### En Render (Backend)
1. Ir a tu servicio → **Settings** → **Custom Domains**
2. Agregar: `api-wms.givingout.mx`
3. Configurar DNS según instrucciones de Render
4. Actualizar `VITE_API_URL` en Vercel con el nuevo dominio

---

## Troubleshooting del Deploy

### ❌ Render: Build falla con "prisma generate"
Verifica que el **Root Directory** sea `wms-backend` y el build command incluya `npx prisma generate`.

### ❌ Render: "P1001: Can't reach database"
- La IP de Render puede no estar en la allowlist de Supabase
- Ir a Supabase → Settings → Database → Deshabilitar IP restrictions temporalmente
- O agregar las IPs de Render a la allowlist

### ❌ Vercel: Pantalla blanca
- Verificar que `VITE_API_URL` esté configurado
- Verificar que el **Root Directory** sea `wms-frontend`
- Ir a Vercel → Deployments → ver logs del build

### ❌ Frontend no conecta con Backend (CORS)
- Verificar `ALLOWED_ORIGINS` en Render incluye la URL exacta de Vercel
- **Sin barra final:** `https://wms-giving-out.vercel.app` ✅
- **Con barra final:** `https://wms-giving-out.vercel.app/` ❌

### ❌ Render: El servicio se duerme (plan Free)
En plan Free, Render duerme el servicio después de 15 min sin tráfico. El primer request después de dormir tarda ~30-60 seg.
- **Solución de producción:** Upgrade a plan Starter ($7/mes)
- **Solución temporal:** Usar un servicio como UptimeRobot para hacer ping cada 14 min al endpoint `/health`

### ❌ Login falla después del deploy
Ejecutar el seed desde local:
```bash
cd wms-backend && npm run db:seed
```

---

## Resumen de URLs

| Servicio | URL |
|----------|-----|
| Frontend | `https://wms-giving-out.vercel.app` |
| Backend API | `https://wms-giving-out-api.onrender.com/api` |
| Swagger Docs | `https://wms-giving-out-api.onrender.com/api/docs` |
| Health Check | `https://wms-giving-out-api.onrender.com/health` |
| Base de Datos | Supabase Dashboard |

---

*Guía creada por MOVIDA TCI — Giving Out WMS v1.0*
