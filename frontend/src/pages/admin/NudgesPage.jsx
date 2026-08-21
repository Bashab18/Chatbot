import React, { useState, useEffect } from "react";
import { useAuth } from "../../context/AuthContext";

function timeAgo(ts) {
  if (!ts) return "—";
  const diff  = Date.now() - ts;
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins < 1)   return "Just now";
  if (mins < 60)  return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 30)  return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

// Sends notifications/nudges to the mHealth mobile app. This server can't
// push to a phone directly -- the app polls for pending nudges (on
// launch/resume and periodically while open) and shows them as local
// notifications, so delivery isn't instant.
export default function NudgesPage() {
  const { getToken } = useAuth();
  const [users, setUsers]     = useState([]);
  const [nudges, setNudges]   = useState([]);
  const [loading, setLoading] = useState(true);

  const [recipient, setRecipient] = useState("all");
  const [title, setTitle]         = useState("");
  const [body, setBody]           = useState("");
  const [sending, setSending]     = useState(false);
  const [message, setMessage]     = useState(null);
  const [checking, setChecking]   = useState(false);

  async function apiFetch(url, opts = {}) {
    const res = await fetch(url, {
      ...opts,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}`, ...opts.headers },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  async function load() {
    try {
      const [u, n] = await Promise.all([
        apiFetch("/api/admin/users"),
        apiFetch("/api/admin/nudges"),
      ]);
      setUsers((u.users ?? []).filter((x) => x.role !== "admin"));
      setNudges(n.nudges ?? []);
    } catch (err) {
      setMessage({ type: "error", text: err.message });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleSend(e) {
    e.preventDefault();
    if (!title.trim() || !body.trim()) return;
    setSending(true); setMessage(null);
    try {
      const data = await apiFetch("/api/admin/nudges", {
        method: "POST",
        body: JSON.stringify({ userId: recipient === "all" ? null : recipient, title: title.trim(), body: body.trim() }),
      });
      setMessage({ type: "success", text: `Sent to ${data.recipientCount} user${data.recipientCount === 1 ? "" : "s"}. They'll see it next time the app checks in.` });
      setTitle(""); setBody("");
      const n = await apiFetch("/api/admin/nudges");
      setNudges(n.nudges ?? []);
      setTimeout(() => setMessage((m) => (m?.type === "success" ? null : m)), 5000);
    } catch (err) {
      setMessage({ type: "error", text: err.message });
    } finally {
      setSending(false);
    }
  }

  const charsLeft = 500 - body.length;

  async function handleRunAutoCheck() {
    setChecking(true); setMessage(null);
    try {
      const data = await apiFetch("/api/admin/nudges/run-auto-check", { method: "POST" });
      setMessage({
        type: "success",
        text: data.sent > 0
          ? `CIRA sent ${data.sent} proactive nudge${data.sent === 1 ? "" : "s"} to inactive users.`
          : "Checked — no one currently qualifies (either everyone's active, or already nudged within the last day).",
      });
      const n = await apiFetch("/api/admin/nudges");
      setNudges(n.nudges ?? []);
      setTimeout(() => setMessage((m) => (m?.type === "success" ? null : m)), 6000);
    } catch (err) {
      setMessage({ type: "error", text: err.message });
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1>Nudges</h1>
        <p>Send a notification to the mHealth app. Delivered next time that phone checks in — not instant.</p>
      </div>

      {message && <div className={`admin-alert admin-alert-${message.type}`}>{message.text}</div>}

      <div className="settings-card">
        <h2 className="settings-section-title">Proactive nudges</h2>
        <p className="slider-hint">
          CIRA checks every few hours for users with no logged workout in 2+ days and, if it hasn't already
          nudged them in the last day, drafts and sends an encouraging reminder on its own — no admin needed.
          Use this to trigger a check right now instead of waiting for the timer.
        </p>
        <div className="settings-actions">
          <button className="btn-secondary" type="button" onClick={handleRunAutoCheck} disabled={checking}>
            {checking ? "Checking…" : "Run check now"}
          </button>
        </div>
      </div>

      <div className="settings-card">
        <h2 className="settings-section-title">Compose</h2>
        <form onSubmit={handleSend} className="settings-form" style={{ gap: 14 }}>
          <div className="tts-field">
            <label className="tts-field-label">Send to</label>
            <select className="settings-select" value={recipient} onChange={(e) => setRecipient(e.target.value)}>
              <option value="all">All users ({users.length})</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.name || u.email} — {u.email}</option>
              ))}
            </select>
          </div>

          <div className="tts-field">
            <label className="tts-field-label">Title</label>
            <input
              className="refusal-input"
              type="text"
              value={title}
              maxLength={100}
              placeholder="e.g. Time for your evening walk!"
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="tts-field">
            <label className="tts-field-label">Message</label>
            <textarea
              className="persona-textarea"
              rows={3}
              value={body}
              maxLength={500}
              placeholder="e.g. You're 2,000 steps from your goal today — a quick walk would do it!"
              onChange={(e) => setBody(e.target.value)}
            />
            <p className="slider-hint" style={{ textAlign: "right" }}>{charsLeft} characters left</p>
          </div>

          <div className="settings-actions">
            <button className="btn-primary" type="submit" disabled={sending || !title.trim() || !body.trim()}>
              {sending ? "Sending…" : "Send Nudge"}
            </button>
          </div>
        </form>
      </div>

      <div className="settings-card" style={{ marginTop: 22 }}>
        <h2 className="settings-section-title">Recent Nudges</h2>
        {loading ? (
          <p className="slider-hint">Loading…</p>
        ) : nudges.length === 0 ? (
          <p className="slider-hint">No nudges sent yet.</p>
        ) : (
          <div className="users-table-wrapper">
            <table className="users-table">
              <thead>
                <tr>
                  <th>To</th>
                  <th>Title</th>
                  <th>Source</th>
                  <th>Sent</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {nudges.map((n) => (
                  <tr key={n.id}>
                    <td>
                      <div className="user-cell">
                        <div className="user-avatar-sm">{n.user_name?.[0]?.toUpperCase() ?? "?"}</div>
                        <div>
                          <span className="user-cell-name">{n.user_name ?? "—"}</span>
                          <span className="user-cell-email">{n.user_email}</span>
                        </div>
                      </div>
                    </td>
                    <td>{n.title}</td>
                    <td>{n.created_by === "cira-auto" ? "🤖 CIRA (auto)" : "Admin"}</td>
                    <td><span className="table-date">{timeAgo(n.created_at)}</span></td>
                    <td>
                      {n.delivered_at ? (
                        <span className="admin-alert admin-alert-success" style={{ display: "inline-block", padding: "2px 8px", margin: 0, fontSize: 12 }}>
                          Delivered {timeAgo(n.delivered_at)}
                        </span>
                      ) : (
                        <span className="admin-alert admin-alert-info" style={{ display: "inline-block", padding: "2px 8px", margin: 0, fontSize: 12 }}>
                          Pending
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
