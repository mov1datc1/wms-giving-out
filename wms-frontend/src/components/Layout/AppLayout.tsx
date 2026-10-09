import { Outlet, Navigate } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { useAuth } from '../../contexts/AuthContext';

export function AppLayout() {
  const { user } = useAuth();

  // Bloqueo estricto: usuarios depositantes no pueden ver ni acceder a las vistas del personal de Giving Out
  if (user?.clienteId) {
    return <Navigate to="/portal" replace />;
  }

  return (
    <div className="app-layout">
      <Sidebar />
      <div className="app-main">
        <TopBar />
        <div className="app-content">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
