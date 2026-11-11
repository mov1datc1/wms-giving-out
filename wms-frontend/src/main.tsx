import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { AppLayout } from './components/Layout/AppLayout';
import { PortalLayout } from './components/Layout/PortalLayout';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Inventory } from './pages/Inventory';
import { Receiving } from './pages/Receiving';
import { Picking } from './pages/Picking';
import { Dispatch } from './pages/Dispatch';
import { Locations } from './pages/Locations';
import { MasterData } from './pages/MasterData';
import { AdminPanel } from './pages/AdminPanel';
import { LabelPreview } from './pages/LabelPreview';
import { Clients } from './pages/Clients';
import { EndCustomers } from './pages/EndCustomers';
import { Suppliers } from './pages/Suppliers';
import { CycleCount } from './pages/CycleCount';
import { Package } from 'lucide-react';
import { Alerts } from './pages/Alerts';
import { Traceability } from './pages/Traceability';
import { PortalDashboard } from './pages/portal/PortalDashboard';
import { PortalInventory } from './pages/portal/PortalInventory';
import { PortalOrders } from './pages/portal/PortalOrders';
import { PortalNewOrder } from './pages/portal/PortalNewOrder';
import './index.css';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        minHeight: '100vh', background: '#F8FAFC', color: '#0F172A',
        fontFamily: 'var(--font-family)',
      }}>
        <div style={{ textAlign: 'center' }}>
          <Package size={36} color="#0D9488" style={{ marginBottom: 12, display: 'inline-block' }} />
          <div>Verificando sesión...</div>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}

/** Ruta protegida para módulo de administración (requiere permiso 'admin' o Super Admin) */
function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user, hasPermission, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (user.clienteId) return <Navigate to="/portal" replace />;
  if (!user.isSuperAdmin && !hasPermission('admin')) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

/** Guardia de ruta por módulo y separación Staff vs Portal Depositante */
function ModuleRoute({
  modulos,
  allowPortal = false,
  children,
}: {
  modulos: string | string[];
  allowPortal?: boolean;
  children: React.ReactNode;
}) {
  const { user, hasPermission, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;

  if (user.clienteId && !allowPortal) {
    return <Navigate to="/portal" replace />;
  }

  const requiredModules = Array.isArray(modulos) ? modulos : [modulos];
  if (!user.isSuperAdmin && !requiredModules.some(m => hasPermission(m))) {
    return <Navigate to={user.clienteId ? '/portal' : '/'} replace />;
  }

  return <>{children}</>;
}

/** Auto-redirect depositor users to portal */
function SmartRedirect() {
  const { user } = useAuth();
  if (user?.clienteId) return <Navigate to="/portal" replace />;
  return <Dashboard />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />

          {/* === PORTAL (Depositor Users) === */}
          <Route element={
            <ProtectedRoute>
              <PortalLayout />
            </ProtectedRoute>
          }>
            <Route path="/portal" element={<ModuleRoute modulos="dashboard" allowPortal><PortalDashboard /></ModuleRoute>} />
            <Route path="/portal/inventario" element={<ModuleRoute modulos="inventario" allowPortal><PortalInventory /></ModuleRoute>} />
            <Route path="/portal/pedidos" element={<ModuleRoute modulos="despacho" allowPortal><PortalOrders /></ModuleRoute>} />
            <Route path="/portal/nuevo-pedido" element={<ModuleRoute modulos="despacho" allowPortal><PortalNewOrder /></ModuleRoute>} />
          </Route>

          {/* === MAIN WMS (Giving Out Staff) === */}
          <Route element={
            <ProtectedRoute>
              <AppLayout />
            </ProtectedRoute>
          }>
            <Route path="/" element={<SmartRedirect />} />
            <Route path="/inventario" element={<ModuleRoute modulos="inventario"><Inventory /></ModuleRoute>} />
            <Route path="/recepcion" element={<ModuleRoute modulos="recepcion"><Receiving /></ModuleRoute>} />
            <Route path="/picking" element={<ModuleRoute modulos="picking"><Picking /></ModuleRoute>} />
            <Route path="/despacho" element={<ModuleRoute modulos="despacho"><Dispatch /></ModuleRoute>} />
            <Route path="/ubicaciones" element={<ModuleRoute modulos="ubicaciones"><Locations /></ModuleRoute>} />
            <Route path="/maestros" element={<ModuleRoute modulos="maestros"><MasterData /></ModuleRoute>} />
            <Route path="/admin" element={
              <AdminRoute>
                <AdminPanel />
              </AdminRoute>
            } />
            <Route path="/etiquetado" element={<ModuleRoute modulos="etiquetado"><LabelPreview /></ModuleRoute>} />
            <Route path="/depositantes" element={<ModuleRoute modulos="depositantes"><Clients /></ModuleRoute>} />
            <Route path="/clientes-finales" element={<ModuleRoute modulos="clientes-finales"><EndCustomers /></ModuleRoute>} />
            <Route path="/proveedores" element={<ModuleRoute modulos={['proveedores', 'maestros']}><Suppliers /></ModuleRoute>} />
            <Route path="/conteo-ciclico" element={<ModuleRoute modulos="conteo-ciclico"><CycleCount /></ModuleRoute>} />
            <Route path="/alertas" element={<ModuleRoute modulos="alertas"><Alerts /></ModuleRoute>} />
            <Route path="/trazabilidad" element={<ModuleRoute modulos="trazabilidad"><Traceability /></ModuleRoute>} />
            {/* Legacy redirect */}
            <Route path="/clientes" element={<ModuleRoute modulos="depositantes"><Navigate to="/depositantes" replace /></ModuleRoute>} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
);
