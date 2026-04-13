import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { AppLayout } from './components/Layout/AppLayout';
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
import { Suppliers } from './pages/Suppliers';
import { CycleCount } from './pages/CycleCount';
import { Alerts } from './pages/Alerts';
import { Traceability } from './pages/Traceability';
import './index.css';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        minHeight: '100vh', background: '#0f172a', color: 'white',
        fontFamily: 'var(--font-family)',
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>📦</div>
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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={
            <ProtectedRoute>
              <AppLayout />
            </ProtectedRoute>
          }>
            <Route path="/" element={<Dashboard />} />
            <Route path="/inventario" element={<Inventory />} />
            <Route path="/recepcion" element={<Receiving />} />
            <Route path="/picking" element={<Picking />} />
            <Route path="/despacho" element={<Dispatch />} />
            <Route path="/ubicaciones" element={<Locations />} />
            <Route path="/maestros" element={<MasterData />} />
            <Route path="/admin" element={<AdminPanel />} />
            <Route path="/etiquetado" element={<LabelPreview />} />
            <Route path="/clientes" element={<Clients />} />
            <Route path="/proveedores" element={<Suppliers />} />
            <Route path="/conteo-ciclico" element={<CycleCount />} />
            <Route path="/alertas" element={<Alerts />} />
            <Route path="/trazabilidad" element={<Traceability />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
);
