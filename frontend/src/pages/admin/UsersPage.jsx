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

function Row({ label, value }) {
  if (value === undefined || value === null || value === "") return null;
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "7px 0", borderBottom: "1px solid rgba(128,128,128,0.15)" }}>
      <span style={{ opacity: 0.65 }}>{label}</span>
      <span style={{ textAlign: "right" }}>{value}</span>
    </div>
  );
}

// Full per-user detail -- profile fields the user filled in, their AI
// persona, and (if shared) the on-device health snapshot and recent
// workouts synced from the companion mHealth app.
function UserDetailModal({ userId, onClose, getToken }) {
  const [data, setData]   = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/admin/users/${userId}`, { headers: { Authorization: `Bearer ${getToken()}` } })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.error) throw new Error(d.error);
        setData(d);
      })
      .catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [userId, getToken]);

  const p   = data?.profile || {};
  const dh  = p.deviceHealth;
  const fit = p.fitnessSnapshot;
  const hasPersonal = p.age || p.gender || p.height || p.weight || p.conditions || p.medications || p.allergies || p.goals || p.notes;
  const hasPersona  = p.aiName || p.aiPersonality || p.aiVoiceId;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520, width: "92%", maxHeight: "85vh", overflowY: "auto" }}>
        <h2 className="profile-section-title">{data?.user?.name || "User"}</h2>
        <p className="profile-section-desc" style={{ marginBottom: 16 }}>{data?.user?.email}</p>

        {error && <p className="profile-error">⚠ {error}</p>}
        {!data && !error && <p className="slider-hint">Loading…</p>}

        {data && (
          <>
            <h3 className="settings-section-title">Personal Information</h3>
            {hasPersonal ? (
              <>
                <Row label="Age" value={p.age} />
                <Row label="Gender" value={p.gender} />
                <Row label="Height" value={p.height} />
                <Row label="Weight" value={p.weight} />
                <Row label="Conditions" value={p.conditions} />
                <Row label="Medications" value={p.medications} />
                <Row label="Allergies" value={p.allergies} />
                <Row label="Goals" value={p.goals} />
                <Row label="Notes" value={p.notes} />
              </>
            ) : <p className="slider-hint">Not shared.</p>}

            <h3 className="settings-section-title" style={{ marginTop: 16 }}>AI Persona</h3>
            {hasPersona ? (
              <>
                <Row label="Name" value={p.aiName} />
                <Row label="Personality" value={p.aiPersonality} />
                <Row label="Voice ID" value={p.aiVoiceId} />
              </>
            ) : <p className="slider-hint">Using instance defaults.</p>}

            <h3 className="settings-section-title" style={{ marginTop: 16 }}>Phone Health Data</h3>
            {dh ? (
              <>
                <Row label="Steps" value={dh.steps?.toLocaleString()} />
                <Row label="Active calories" value={dh.activeCalories} />
                <Row label="Latest heart rate" value={dh.latestHeartRate && `${dh.latestHeartRate} bpm`} />
                <Row label="Resting heart rate" value={dh.restingHeartRate && `${dh.restingHeartRate} bpm`} />
                <Row label="Sleep last night" value={dh.sleepHoursLastNight && `${dh.sleepHoursLastNight} h`} />
                <Row label="Synced" value={dh.fetchedAt && new Date(dh.fetchedAt).toLocaleString()} />
              </>
            ) : <p className="slider-hint">Not shared -- user hasn't enabled "Share with paired coaches" in the mHealth app.</p>}

            {p.recentSessions?.length > 0 && (
              <>
                <h3 className="settings-section-title" style={{ marginTop: 16 }}>Recent Workouts (from phone)</h3>
                {p.recentSessions.map((s, i) => (
                  <Row key={i} label={s.name} value={`${s.elapsedMin} min · ${s.kcal} kcal · ${new Date(s.savedAt).toLocaleDateString()}`} />
                ))}
              </>
            )}

            {fit && (
              <>
                <h3 className="settings-section-title" style={{ marginTop: 16 }}>Google Fit</h3>
                <Row label="Steps today" value={fit.todaySteps?.toLocaleString()} />
                <Row label="Avg heart rate (7d)" value={fit.avgHeartRate && `${fit.avgHeartRate} bpm`} />
                <Row label="Weight" value={fit.weight && `${fit.weight} kg`} />
              </>
            )}
          </>
        )}

        <div className="modal-actions" style={{ marginTop: 20 }}>
          <button className="btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

export default function UsersPage() {
  const { getToken } = useAuth();
  const [users, setUsers]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [editNote, setEditNote]   = useState({}); // uid → note text
  const [saving, setSaving]       = useState({}); // uid → bool
  const [message, setMessage]     = useState(null);
  const [detailUserId, setDetailUserId] = useState(null);

  async function loadUsers() {
    try {
      const token = getToken();
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
      const token = getToken();
      await fetch(`/api/admin/users/${uid}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ note: editNote[uid] ?? "" }),
      });
      setUsers((prev) => prev.map((u) => u.id === uid ? { ...u, note: editNote[uid] ?? "" } : u));
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
        <p>Manage all registered users — click a user to view their profile, AI persona, and any phone health data they've shared</p>
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
                <tr key={u.id}>
                  <td>
                    <div
                      className="user-cell"
                      style={{ cursor: "pointer" }}
                      onClick={() => setDetailUserId(u.id)}
                      title="View details"
                    >
                      <div className="user-avatar-sm">{u.name?.[0]?.toUpperCase() ?? "?"}</div>
                      <div>
                        <span className="user-cell-name">{u.name ?? "—"}</span>
                        <span className="user-cell-email">{u.email}</span>
                      </div>
                    </div>
                  </td>
                  <td><span className="table-date">{formatDate(u.created_at)}</span></td>
                  <td><span className="table-date">{timeAgo(u.last_login)}</span></td>
                  <td><span className="login-count">{u.login_count ?? 0}</span></td>
                  <td>
                    <input
                      className="note-input"
                      placeholder="Add a note…"
                      value={editNote[u.id] ?? u.note ?? ""}
                      onChange={(e) => setEditNote((p) => ({ ...p, [u.id]: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === "Enter") saveNote(u.id); }}
                    />
                  </td>
                  <td>
                    <button
                      className="btn-save-note"
                      disabled={saving[u.id]}
                      onClick={() => saveNote(u.id)}
                    >
                      {saving[u.id] ? "…" : "Save"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {detailUserId && (
        <UserDetailModal
          userId={detailUserId}
          onClose={() => setDetailUserId(null)}
          getToken={getToken}
        />
      )}
    </div>
  );
}
