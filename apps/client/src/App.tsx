import React, { lazy, Suspense, useEffect, useState } from 'react';
import { api } from './lib/api';
import { BrowserRouter, Routes, Route, Navigate, Outlet, useParams } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { PreferencesProvider } from './contexts/PreferencesContext';
import { ConfirmationProvider } from './contexts/ConfirmationContext';
import { ToastProvider } from './contexts/ToastContext';
import { LiveProvider } from './contexts/LiveContext';
import { ShellRoot } from './components/shell/AppShell';
import { BootSplash, NotFound } from './components/shell/states';
import LoginPage from './pages/LoginPage';
import SetupPage from './pages/SetupPage';
import OverviewPage from './pages/OverviewPage';
import PipelinesPage from './pages/PipelinesPage';
import PipelinePage from './pages/PipelinePage';
import RunsPage from './pages/RunsPage';
import RunPage from './pages/RunPage';
import MorePage from './pages/MorePage';
import GroupPage from './pages/GroupPage';
import './styles/index.css';
import { desktopMac } from './lib/desktop';
import { DesktopTitleBar } from './components/shell/Desktop';

// Big and visited less often: loaded when first opened.
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const AdminPage = lazy(() => import('./pages/AdminPage'));
const ImportPage = lazy(() => import('./pages/ImportPage'));
const SelfHostPage = lazy(() => import('./pages/SelfHostPage'));
const DocsPage = lazy(() => import('./pages/DocsPage'));
// The component kit, for checking primitives against the design sheet. Never in a production bundle.
const DevKit = import.meta.env.DEV ? lazy(() => import('./pages/DevKit')) : null;

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return <BootSplash label="Signing in…" />;
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" />;
};

/** Sends a fresh instance to /setup. Waits at most 2s for the answer. */
const SetupCheck: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [loading, setLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);

  useEffect(() => {
    let mounted = true;
    const timer = setTimeout(() => mounted && setLoading(false), 2000);
    // An admin who closed the tab mid-setup is sent back to it: only an admin
    // is told the step, so anyone else just sees "initialized".
    api<{ initialized: boolean; done?: boolean; step?: number }>('/setup/state')
      .then((data) => {
        if (!mounted) return;
        if (!data.initialized || (data.step !== undefined && !data.done)) setNeedsSetup(true);
        setLoading(false);
      })
      .catch(() => mounted && setLoading(false))
      .finally(() => clearTimeout(timer));
    return () => {
      mounted = false;
      clearTimeout(timer);
    };
  }, []);

  if (loading) return <BootSplash />;
  if (needsSetup) return <Navigate to="/setup" />;
  return <>{children}</>;
};

/** v1 linked runs as /builds/:id. */
function LegacyBuild() {
  const { id } = useParams();
  return <Navigate to={`/runs/${id}`} replace />;
}

function Shell() {
  return (
    <SetupCheck>
      <ProtectedRoute>
        <LiveProvider>
          <ShellRoot>
            <Suspense fallback={null}>
              <Outlet />
            </Suspense>
          </ShellRoot>
        </LiveProvider>
      </ProtectedRoute>
    </SetupCheck>
  );
}

function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <PreferencesProvider>
            <ToastProvider>
              <ConfirmationProvider>
                {desktopMac && <DesktopTitleBar />}
                <Routes>
                  <Route path="/login" element={<LoginPage />} />
                  <Route path="/setup" element={<SetupPage />} />
                  <Route path="/selfhost/:id?" element={<SetupCheck><ProtectedRoute><Suspense fallback={<BootSplash label="Opening the wizard…" />}><SelfHostPage /></Suspense></ProtectedRoute></SetupCheck>} />
                  {DevKit && <Route path="/dev/kit" element={<Suspense fallback={null}><LiveProvider><DevKit /></LiveProvider></Suspense>} />}
                  <Route element={<Shell />}>
                    <Route index element={<OverviewPage />} />
                    <Route path="pipelines" element={<PipelinesPage />} />
                    <Route path="pipelines/:id/:tab?" element={<PipelinePage />} />
                    <Route path="groups/*" element={<GroupPage />} />
                    <Route path="runs" element={<RunsPage />} />
                    <Route path="runs/:buildId" element={<RunPage />} />
                    <Route path="builds/:id" element={<LegacyBuild />} />
                    <Route path="settings/:section?" element={<SettingsPage />} />
                    <Route path="admin/:section?" element={<AdminPage />} />
                    <Route path="import" element={<ImportPage />} />
                    <Route path="docs/*" element={<DocsPage />} />
                    <Route path="more" element={<MorePage />} />
                    <Route path="*" element={<NotFound />} />
                  </Route>
                </Routes>
              </ConfirmationProvider>
            </ToastProvider>
          </PreferencesProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}

export default App;
