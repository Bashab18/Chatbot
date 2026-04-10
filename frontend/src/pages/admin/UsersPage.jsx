import React, { useState, useEffect } from "react";
import { useAuth } from "../../context/AuthContext";

function timeAgo(ts) {
  if (!ts) return "—";
  const diff  = Date.now() - ts;
  const days  = Math.floor(diff / 86400000);
  const hours = Math.floor(diff / 3600000);
  const mins  = Math.floor(diff / 60000);
  if (mins < 1)   return "Just now";
  if (mins < 60)  return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 30)  return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

function formatDate(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default function UsersPage() {
  const { getToken } = useAuth();
  const [users, setUsers]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [editNote, setEditNote]   = useState({}); // uid → note text
  const [saving, setSaving]       = useState({}); // uid → bool
  const [message, setMessage]     = useState(null);

  async function loadUsers() {
    try {
      const token = await getToken();
      const res = await fetch("/api/admin/users", { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      setUsers((data.users ?? []).filter((u) => u.role !== "admin"));
    } catch (err) {
      console.error("Load users error:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadUsers(); }, []);

  async function saveNote(uid) {
    setSaving((p) => ({ ...p, [uid]: true }));
    try {
      const token = await getToken();
      await fetch(`/api/admin/users/${uid}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ note: editNote[uid] ?? "" }),
      });
      setUsers((prev) => prev.map((u) => u.uid === uid ? { ...u, note: editNote[uid] ?? "" } : u));
      setMessage({ type: "success", text: "Note saved." });
      setTimeout(() => setMessage(null), 3000);
    } catch (err) {
      setMessage({ type: "error", text: err.message });
    } finally {
      setSaving((p) => ({ ...p, [uid]: false }));
    }
  }

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1>Users</h1>
        <p>Manage all registered users</p>
      </div>

      {message && (
        <div className={`admin-alert admin-alert-${message.type}`}>{message.text}</div>
      )}

      {loading ? (
        <div className="admin-loading"><div className="auth-spinner" /></div>
      ) : users.length === 0 ? (
        <div className="admin-empty-card">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor">
            <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>
          </svg>
          <p>No users registered yet.</p>
        </div>
      ) : (
        <div className="users-table-wrapper">
          <table className="users-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Joined</th>
                <th>Last Login</th>
                <th>Logins</th>
                <th>Admin Note</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.uid}>
                  <td>
                    <div className="user-cell">
                      <div className="user-avatar-sm">{u.displayName?.[0]?.toUpperCase() ?? "?"}</div>
                      <div>
                        <span className="user-cell-name">{u.displayName ?? "—"}</span>
                        <span className="user-cell-email">{u.email}</span>
                      </div>
                    </div>
                  </td>
                  <td><span className="table-date">{formatDate(u.createdAt)}</span></td>
                  <td><span className="table-date">{timeAgo(u.lastLogin)}</span></td>
                  <td><span className="login-count">{u.loginCount ?? 0}</span></td>
                  <td>
                    <input
                      className="note-input"
                      placeholder="Add a note…"
                      value={editNote[u.uid] ?? u.note ?? ""}
                      onChange={(e) => setEditNote((p) => ({ ...p, [u.uid]: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === "Enter") saveNote(u.uid); }}
                    />
                  </td>
                  <td>
                    <button
                      className="btn-save-note"
                      disabled={saving[u.uid]}
                      onClick={() => saveNote(u.uid)}
                    >
                      {saving[u.uid] ? "…" : "Save"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
