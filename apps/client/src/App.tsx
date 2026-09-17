import { BrowserRouter, Routes, Route, Navigate, Link } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { PreferencesProvider, usePreferences } from './contexts/PreferencesContext';
import LoginPage from './pages/LoginPage';
import SettingsPage from './pages/SettingsPage';
import DashboardPage from './pages/DashboardPage';
import SetupPage from './pages/SetupPage';
import DocsPage from './pages/DocsPage';

import { Settings, LogOut, LayoutDashboard, Book } from 'lucide-react';
import appVersion from 'virtual:app-version';
import './styles/index.css';
import React, { useEffect, useState } from 'react';
import AIAssistant from './components/AIAssistant';
import API_URL from './config/api';

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return <div className="min-h-screen bg-[var(--color-bg)] flex items-center justify-center text-emerald-500">Loading...</div>;
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" />;
};

// Checks if setup is required
const SetupCheck: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [loading, setLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);

  useEffect(() => {
    let mounted = true;
    const timer = setTimeout(() => {
      if (mounted) setLoading(false);
    }, 2000);

    fetch(`${API_URL}/api/setup-status`)
      .then(res => res.json())
      .then(data => {
        if (!mounted) return;
        if (!data.initialized) {
          setNeedsSetup(true);
        }
        setLoading(false);
        clearTimeout(timer);
      })
      .catch(() => {
        if (mounted) setLoading(false);
        clearTimeout(timer);
      });

    return () => {
      mounted = false;
      clearTimeout(timer);
    };
  }, []);

  if (loading) return null; // Or spinner
  if (needsSetup) return <Navigate to="/setup" />;

  return <>{children}</>;
};

const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { logout, user } = useAuth();
  const { enableAI } = usePreferences();
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  return (
    <div className="h-screen flex flex-col bg-[var(--color-bg)] text-[var(--color-text)] overflow-hidden">
      {/* Theme tokens, not fixed colours. Every string in this bar used to be
          a hardcoded light-on-dark value, so in the LIGHT theme the header
          rendered near-invisibly: "PIPELINE" measured 1.0:1 against its own
          background - literally the same colour - and "User:" 1.5:1. Tokens
          flip with the theme; text-white does not. */}
      <nav className="flex-none border-b border-[var(--color-text-muted)]/20 bg-[var(--color-surface)] p-4 flex justify-between items-center z-10">
        <div className="flex items-center gap-6">
          <h1 className="text-xl font-bold">
            <span className="text-[var(--color-primary)]">EZ</span>
            <span className="text-[var(--color-text)]">PIPELINE</span>
          </h1>
          <div className="flex gap-4 text-sm font-medium text-[var(--color-text-muted)]">
            <Link to="/" className="hover:text-[var(--color-text)] flex items-center gap-2"><LayoutDashboard size={16} /> Dashboard</Link>
            <Link to="/docs" className="hover:text-[var(--color-text)] flex items-center gap-2"><Book size={16} /> Docs</Link>
            <Link to="/settings" className="hover:text-[var(--color-text)] flex items-center gap-2"><Settings size={16} /> Settings</Link>
          </div>
        </div>
        {/* ── THE BUILD STAMP ──────────────────────────────────────────────
            Under the sign out button, small, and deliberately dull. It is not
            a feature: it is the answer to "is this page running the change I
            just made", which took most of an evening to establish once by
            other means.

            ── WHY IT HANGS OFF THE LEFT EDGE AND NOT THE RIGHT ─────────────

            It was right-aligned first, under the sign-out icon, and that can
            never read as aligned: the icon is a glyph inside a button with
            padding around it, so the version lines up with the BUTTON's edge
            while the eye compares it to the GLYPH. It looks off by exactly
            that padding wherever it is nudged to.

            "User:" has no padding to be wrong about. A shared left edge with
            it is an alignment that can be seen to be true, which is the only
            kind worth having for something this small. */}
        <div className="grid justify-items-start gap-0.5">
          <div className="flex items-center gap-4">
            <span className="text-sm text-[var(--color-text-muted)]">User: {user}</span>
            <button onClick={() => setShowLogoutConfirm(true)} className="text-[var(--color-text-muted)] hover:text-red-400">
              <LogOut size={18} />
            </button>
          </div>
          <span
            className="text-[10px] leading-none font-mono text-[var(--color-text-muted)] opacity-60 -mt-0.5"
            title={`${appVersion.version} on ${appVersion.branch}, commit ${appVersion.commit}. The number rises every time the code moves, so if it has not changed since a push, this page is not running it.`}
          >
            {appVersion.version}
          </span>
        </div>
      </nav>

      {/* Scrollable Main Content */}
      <main className="flex-1 overflow-y-auto relative scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">
        {children}
      </main>
      {enableAI && <AIAssistant />}

      {/* Logout Confirmation Modal */}
      {showLogoutConfirm && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] flex items-center justify-center">
          <div className="bg-slate-900 border border-slate-700 p-6 rounded-lg shadow-xl max-w-sm w-full">
            <h3 className="text-lg font-bold text-white mb-2">Sign Out</h3>
            <p className="text-slate-400 mb-6">Are you sure you want to sign out?</p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowLogoutConfirm(false)}
                className="px-4 py-2 text-slate-300 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowLogoutConfirm(false);
                  logout();
                }}
                className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import { ConfirmationProvider } from './contexts/ConfirmationContext';
import { ToastProvider } from './contexts/ToastContext';

// ... (existing imports)

function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <PreferencesProvider>
            <ToastProvider>
              <ConfirmationProvider>
                <Routes>
                  <Route path="/login" element={<LoginPage />} />
                  <Route path="/setup" element={<SetupPage />} />
                  <Route path="/" element={
                    <SetupCheck>
                      <ProtectedRoute>
                        <Layout>
                          <DashboardPage />
                        </Layout>
                      </ProtectedRoute>
                    </SetupCheck>
                  } />
                  <Route path="/settings/*" element={
                    <SetupCheck>
                      <ProtectedRoute>
                        <Layout>
                          <SettingsPage />
                        </Layout>
                      </ProtectedRoute>
                    </SetupCheck>
                  } />
                  <Route path="/docs/*" element={
                    <SetupCheck>
                      <ProtectedRoute>
                        <Layout>
                          <DocsPage />
                        </Layout>
                      </ProtectedRoute>
                    </SetupCheck>
                  } />
                  <Route path="/docs/:sectionId" element={
                    <SetupCheck>
                      <ProtectedRoute>
                        <Layout>
                          <DocsPage />
                        </Layout>
                      </ProtectedRoute>
                    </SetupCheck>
                  } />
                  <Route path="*" element={<Navigate to="/" replace />} />
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
