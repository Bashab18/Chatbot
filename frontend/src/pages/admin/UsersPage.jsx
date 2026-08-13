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

function formatDateTime(ts) {
  return new Date(ts).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
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

function SectionTitle({ children }) {
  return <h3 className="settings-section-title" style={{ marginTop: 18, marginBottom: 6 }}>{children}</h3>;
}

function StatCard({ value, label }) {
  return (
    <div className="fit-data-card">
      <div>
        <div className="fit-metric-value">{value}</div>
        <div className="fit-metric-label">{label}</div>
      </div>
    </div>
  );
}

const ROLE_BADGE = { admin: "Admin", user: "User" };

// Full per-user detail -- account/engagement stats, profile fields the user
// filled in, their AI persona (with the voice resolved to a readable name),
// AI-learned memories, chat activity, and (if shared) the on-device health
// snapshot / recent workouts synced from the companion mHealth app.
function UserDetailModal({ userId, onClose, getToken }) {
  const [data, setData]     = useState(null);
  const [error, setError]   = useState("");
  const [voices, setVoices] = useState([]);

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
    fetch("/api/tts/voices")
      .then((r) => r.json())
      .then((d) => { if (!cancelled && d.voices) setVoices(d.voices); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [userId, getToken]);

  const p    = data?.profile || {};
  const u    = data?.user || {};
  const mem  = data?.memories || [];
  const act  = data?.activity;
  const dh   = p.deviceHealth;
  const fit  = p.fitnessSnapshot;
  const hasPersonal = p.age || p.gender || p.height || p.weight || p.conditions || p.medications || p.allergies || p.goals || p.notes;
  const hasPersona  = p.aiName || p.aiPersonality || p.aiVoiceId;
  const voiceName   = p.aiVoiceId ? voices.find((v) => v.voice_id === p.aiVoiceId)?.name : null;

  const workoutTotals = p.recentSessions?.length
    ? p.recentSessions.reduce((a, s) => ({ min: a.min + (s.elapsedMin || 0), kcal: a.kcal + (s.kcal || 0) }), { min: 0, kcal: 0 })
    : null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560, width: "92%", maxHeight: "85vh", overflowY: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div>
            <h2 className="profile-section-title" style={{ marginBottom: 2 }}>{u.name || "User"}</h2>
            <p className="profile-section-desc" style={{ margin: 0 }}>{u.email}</p>
          </div>
          {u.role && <span className="model-tag">{ROLE_BADGE[u.role] ?? u.role}</span>}
        </div>

        {error && <p className="profile-error">⚠ {error}</p>}
        {!data && !error && <p className="slider-hint" style={{ marginTop: 16 }}>Loading…</p>}

        {data && (
          <>
            <SectionTitle>Account</SectionTitle>
            <div className="fit-data-grid">
              <StatCard value={act?.conversationCount ?? 0} label="Conversations" />
              <StatCard value={act?.messageCount ?? 0} label="Messages sent" />
              <StatCard value={u.login_count ?? 0} label="Logins" />
            </div>
            <Row label="Joined" value={formatDate(u.created_at)} />
            <Row label="Last login" value={timeAgo(u.last_login)} />
            {u.note && <Row label="Admin note" value={u.note} />}

            <SectionTitle>Personal Information</SectionTitle>
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

            <SectionTitle>AI Persona</SectionTitle>
            {hasPersona ? (
              <>
                <Row label="Name" value={p.aiName} />
                <Row label="Personality" value={p.aiPersonality} />
                <Row label="Voice" value={voiceName || p.aiVoiceId} />
              </>
            ) : <p className="slider-hint">Using instance defaults.</p>}

            <SectionTitle>AI Memory</SectionTitle>
            {mem.length > 0 ? (
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {mem.map((m) => (
                  <li key={m.id} style={{ padding: "3px 0" }}>
                    {m.text}
                    <span style={{ opacity: 0.5, fontSize: 12 }}> — {m.source === "auto" ? "learned" : "manual"}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="slider-hint">No facts learned yet.</p>}

            <SectionTitle>Phone Health Data</SectionTitle>
            {dh ? (
              <>
                <div className="fit-data-grid">
                  {dh.steps != null && <StatCard value={dh.steps.toLocaleString()} label="Steps" />}
                  {dh.activeCalories != null && <StatCard value={dh.activeCalories} label="Active kcal" />}
                  {dh.latestHeartRate != null && <StatCard value={`${dh.latestHeartRate} bpm`} label="Latest HR" />}
                  {dh.restingHeartRate != null && <StatCard value={`${dh.restingHeartRate} bpm`} label="Resting HR" />}
                  {dh.sleepHoursLastNight != null && <StatCard value={`${dh.sleepHoursLastNight} h`} label="Sleep last night" />}
                </div>
                {dh.fetchedAt && <p className="fit-fetched-at">Last synced: {formatDateTime(dh.fetchedAt)}</p>}
              </>
            ) : <p className="slider-hint">Not shared -- user hasn't enabled "Share with paired coaches" in the mHealth app.</p>}

            {p.recentSessions?.length > 0 && (
              <>
                <SectionTitle>Recent Workouts (from phone)</SectionTitle>
                {workoutTotals && (
                  <div className="fit-data-grid" style={{ marginBottom: 8 }}>
                    <StatCard value={p.recentSessions.length} label="Logged" />
                    <StatCard value={`${workoutTotals.min} min`} label="Total time" />
                    <StatCard value={`${workoutTotals.kcal} kcal`} label="Total burned" />
                  </div>
                )}
                {p.recentSessions.map((s, i) => (
                  <Row key={i} label={s.name} value={`${s.elapsedMin} min · ${s.kcal} kcal · ${new Date(s.savedAt).toLocaleDateString()}`} />
                ))}
              </>
            )}

            {fit && (
              <>
                <SectionTitle>Google Fit</SectionTitle>
                <div className="fit-data-grid">
                  {fit.todaySteps != null && <StatCard value={fit.todaySteps.toLocaleString()} label="Steps today" />}
                  {fit.avgHeartRate != null && <StatCard value={`${fit.avgHeartRate} bpm`} label="Avg HR (7d)" />}
                  {fit.weight != null && <StatCard value={`${fit.weight} kg`} label="Weight" />}
                </div>
              </>
            )}

            <SectionTitle>Recent Conversations</SectionTitle>
            {act?.recentConversations?.length > 0 ? (
              act.recentConversations.map((c) => (
                <Row key={c.id} label={c.title} value={timeAgo(c.updated_at)} />
              ))
            ) : <p className="slider-hint">No conversations yet.</p>}
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
