import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import LoginPage     from "./pages/LoginPage";
import ChatPage      from "./pages/ChatPage";
import ProfilePage   from "./pages/ProfilePage";
import AdminLayout   from "./pages/admin/AdminLayout";
import DashboardPage from "./pages/admin/DashboardPage";
import KnowledgePage from "./pages/admin/KnowledgePage";
import SettingsPage  from "./pages/admin/SettingsPage";
import UsersPage     from "./pages/admin/UsersPage";
import ChatHistoryPage from "./pages/admin/ChatHistoryPage";
import NudgesPage    from "./pages/admin/NudgesPage";
import "./App.css";

function ProtectedRoute({ children, requireRole }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="auth-loading">
        <div className="auth-spinner" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  if (requireRole && user.role !== requireRole) {
    return <Navigate to={user.role === "admin" ? "/admin" : "/chat"} replace />;
  }

  return children;
}

function RootRedirect() {
  const { user, loading } = useAuth();
  if (loading) return <div className="auth-loading"><div className="auth-spinner" /></div>;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={user.role === "admin" ? "/admin" : "/chat"} replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Public */}
          <Route path="/login" element={<LoginPage />} />

          {/* Root redirect */}
          <Route path="/" element={<RootRedirect />} />

          {/* User chat */}
          <Route
            path="/chat"
            element={
              <ProtectedRoute requireRole="user">
                <ChatPage />
              </ProtectedRoute>
            }
          />

          {/* User profile */}
          <Route
            path="/profile"
            element={
              <ProtectedRoute requireRole="user">
                <ProfilePage />
              </ProtectedRoute>
            }
          />

          {/* Admin panel */}
          <Route
            path="/admin"
            element={
              <ProtectedRoute requireRole="admin">
                <AdminLayout />
              </ProtectedRoute>
            }
          >
            <Route index              element={<DashboardPage />} />
            <Route path="knowledge"   element={<KnowledgePage />} />
            <Route path="settings"    element={<SettingsPage />} />
            <Route path="users"       element={<UsersPage />} />
            <Route path="nudges"      element={<NudgesPage />} />
            <Route path="history"     element={<ChatHistoryPage />} />
          </Route>

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
