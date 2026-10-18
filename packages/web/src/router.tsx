import { Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/AppShell';
import { RequireAuth, RequireGuest } from '@/components/RequireAuth';
import { DashboardPage } from '@/pages/DashboardPage';
import { IncidentsPage } from '@/pages/IncidentsPage';
import { LoginPage } from '@/pages/LoginPage';
import { MonitorDetailPage } from '@/pages/MonitorDetailPage';
import { MonitorEditPage } from '@/pages/MonitorEditPage';
import { MonitorNewPage } from '@/pages/MonitorNewPage';
import { MonitorsPage } from '@/pages/MonitorsPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { RegisterPage } from '@/pages/RegisterPage';

/** Route table. Authentication is enforced once, at the layout boundary. */
export function AppRoutes() {
  return (
    <Routes>
      <Route element={<RequireGuest />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
      </Route>

      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route index element={<DashboardPage />} />
          <Route path="monitors" element={<MonitorsPage />} />
          <Route path="monitors/new" element={<MonitorNewPage />} />
          <Route path="monitors/:id" element={<MonitorDetailPage />} />
          <Route path="monitors/:id/edit" element={<MonitorEditPage />} />
          <Route path="incidents" element={<IncidentsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
