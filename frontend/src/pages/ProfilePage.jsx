import React, { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const FIELDS = [
  { key: "age",         label: "Age",                  placeholder: "e.g. 35",                   type: "text" },
  { key: "gender",      label: "Gender",                placeholder: "e.g. Male / Female / Other", type: "text" },
  { key: "height",      label: "Height",                placeholder: "e.g. 175 cm or 5'9\"",       type: "text" },
  { key: "weight",      label: "Weight",                placeholder: "e.g. 72 kg or 158 lbs",      type: "text" },
  { key: "conditions",  label: "Medical Conditions",    placeholder: "e.g. Diabetes, Hypertension", type: "text" },
  { key: "medications", label: "Current Medications",   placeholder: "e.g. Metformin 500 mg",       type: "text" },
  { key: "allergies",   label: "Allergies",             placeholder: "e.g. Penicillin, Peanuts",    type: "text" },
  { key: "goals",       label: "Health Goals",          placeholder: "e.g. Lose weight, manage stress", type: "text" },
];

function formatAge(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

export default function ProfilePage() {
  const { user, getToken } = useAuth();
  const navigate           = useNavigate();
  const [params]           = useSearchParams();

  const [profile, setProfile]           = useState({});
  const [saving, setSaving]             = useState(false);
  const [loadMsg, setLoadMsg]           = useState("");
  const [saveMsg, setSaveMsg]           = useState(null);

  // AI Memory state
  const [memories, setMemories]           = useState([]);
  const [memLoading, setMemLoading]       = useState(true);
  const [memExtracting, setMemExtracting] = useState(false);
  const [memMsg, setMemMsg]               = useState(null);

  // Google Fit state
  const [fitConnected, setFitConnected] = useState(false);
  const [fitSnapshot, setFitSnapshot]   = useState(null);
  const [fitFetchedAt, setFitFetchedAt] = useState(null);
  const [fitLoading, setFitLoading]     = useState(false);
  const [fitMsg, setFitMsg]             = useState(null);
  const [fitConfigured, setFitConfigured] = useState(true);

  // Safe JSON fetch — reads body as text first so HTML error pages don't blow up
  async function apiFetch(url, opts = {}) {
    const r    = await fetch(url, {
      ...opts,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}`, ...opts.headers },
    });
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch {
      throw new Error(
        r.status >= 500 ? "Server error — please try again in a moment"
          : "Unexpected server response"
      );
    }
    if (!r.ok) throw new Error(data?.error || `Request failed (${r.status})`);
    return data;
  }

  // ── Load profile + memories ─────────────────────────────────────────
  useEffect(() => {
    apiFetch("/api/user/profile")
      .then((d) => { if (d.profile) setProfile(d.profile); })
      .catch(() => setLoadMsg("Could not load profile."));

    apiFetch("/api/user/memories")
      .then((d) => { setMemories(d.memories || []); })
      .catch(() => setMemMsg({ type: "error", text: "Could not load memories." }))
      .finally(() => setMemLoading(false));

    apiFetch("/api/fitness/status")
      .then((d) => {
        setFitConnected(d.connected);
        setFitSnapshot(d.snapshot);
        setFitFetchedAt(d.fetchedAt);
      })
      .catch(() => {});
  }, []);

  // ── Handle OAuth return params ──────────────────────────────────────
  useEffect(() => {
    const connected = params.get("fit_connected");
    const fitErr    = params.get("fit_error");
    if (connected) {
      setFitMsg({ type: "success", text: "Google Fit connected successfully!" });
      apiFetch("/api/fitness/status")
        .then((d) => { setFitConnected(d.connected); setFitSnapshot(d.snapshot); setFitFetchedAt(d.fetchedAt); })
        .catch(() => {});
    }
    if (fitErr) setFitMsg({ type: "error", text: `Google Fit error: ${fitErr}` });
  }, []);

  // ── Save profile ────────────────────────────────────────────────────
  async function handleSave(e) {
    e.preventDefault();
    setSaving(true); setSaveMsg(null);
    try {
      const data = await apiFetch("/api/user/profile", { method: "PUT", body: JSON.stringify(profile) });
      setProfile(data.profile);
      setSaveMsg({ type: "success", text: "Profile saved." });
      setTimeout(() => setSaveMsg(null), 3000);
    } catch (err) {
      setSaveMsg({ type: "error", text: err.message });
    } finally {
      setSaving(false);
    }
  }

  // ── AI Memory: extract from chat history ───────────────────────────
  async function handleExtractMemories() {
    setMemExtracting(true); setMemMsg(null);
    try {
      const data = await apiFetch("/api/user/memories/extract", { method: "POST" });
      setMemories(data.memories || []);
      if (data.extracted === 0) {
        setMemMsg({ type: "info", text: "No new facts found in recent chats. Try chatting more first!" });
      } else {
        setMemMsg({ type: "success", text: `${data.extracted} new memory${data.extracted === 1 ? "" : "s"} added from your chat history.` });
      }
      setTimeout(() => setMemMsg(null), 4000);
    } catch (err) {
      setMemMsg({ type: "error", text: err.message });
    } finally {
      setMemExtracting(false);
    }
  }

  // ── AI Memory: delete one ───────────────────────────────────────────
  async function handleDeleteMemory(id) {
    try {
      const data = await apiFetch(`/api/user/memories/${id}`, { method: "DELETE" });
      setMemories(data.memories || []);
    } catch (err) {
      setMemMsg({ type: "error", text: err.message });
    }
  }

  // ── Google Fit: connect ─────────────────────────────────────────────
  async function handleFitConnect() {
    setFitLoading(true); setFitMsg(null);
    try {
      const data = await apiFetch("/api/fitness/auth-url");
      window.location.href = data.url;
    } catch (err) {
      if (err.message.includes("not configured")) {
        setFitConfigured(false);
        // Yellow warning box already explains — no red alert needed
      } else {
        setFitMsg({ type: "error", text: err.message });
      }
      setFitLoading(false);
    }
  }

  // ── Google Fit: refresh data ────────────────────────────────────────
  async function handleFitRefresh() {
    setFitLoading(true); setFitMsg(null);
    try {
      const data = await apiFetch("/api/fitness/refresh", { method: "POST" });
      setFitSnapshot(data.snapshot);
      setFitFetchedAt(data.fetchedAt);
      setFitMsg({ type: "success", text: "Fitness data refreshed." });
      setTimeout(() => setFitMsg(null), 3000);
    } catch (err) {
      setFitMsg({ type: "error", text: err.message });
    } finally {
      setFitLoading(false);
    }
  }

  // ── Google Fit: disconnect ──────────────────────────────────────────
  async function handleFitDisconnect() {
    setFitLoading(true); setFitMsg(null);
    try {
      await apiFetch("/api/fitness/disconnect", { method: "DELETE" });
      setFitConnected(false); setFitSnapshot(null); setFitFetchedAt(null);
      setFitMsg({ type: "success", text: "Google Fit disconnected." });
      setTimeout(() => setFitMsg(null), 3000);
    } catch (err) {
      setFitMsg({ type: "error", text: err.message });
    } finally {
      setFitLoading(false);
    }
  }

  const initials = user?.name
    ? user.name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase()
    : "U";

  return (
    <div className="profile-page">
      {/* Header */}
      <div className="profile-header">
        <button className="profile-back-btn" onClick={() => navigate("/chat")} title="Back to chat">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path fillRule="evenodd" d="M11.354 1.646a.5.5 0 0 1 0 .708L5.707 8l5.647 5.646a.5.5 0 0 1-.708.708l-6-6a.5.5 0 0 1 0-.708l6-6a.5.5 0 0 1 .708 0z"/>
          </svg>
          Back
        </button>
        <div className="profile-title-group">
          <div className="profile-avatar-lg">{initials}</div>
          <div>
            <h1 className="profile-name">{user?.name}</h1>
            <p className="profile-email">{user?.email}</p>
          </div>
        </div>
      </div>

      <div className="profile-body">

        {/* ── Personal Information ──────────────────────────────────── */}
        <section className="profile-card">
          <h2 className="profile-section-title">Personal Information</h2>
          <p className="profile-section-desc">
            This information is sent to the AI with every message to personalise responses.
          </p>
          {loadMsg && <p className="profile-error">{loadMsg}</p>}

          <form onSubmit={handleSave} className="profile-form">
            <div className="profile-fields-grid">
              {FIELDS.map(({ key, label, placeholder, type }) => (
                <div key={key} className="profile-field">
                  <label className="profile-field-label">{label}</label>
                  <input
                    className="profile-field-input"
                    type={type}
                    placeholder={placeholder}
                    value={profile[key] || ""}
                    onChange={(e) => setProfile((p) => ({ ...p, [key]: e.target.value }))}
                  />
                </div>
              ))}
            </div>

            <div className="profile-notes-field">
              <label className="profile-field-label">Additional Notes</label>
              <p className="profile-notes-hint">
                Anything else you'd like the assistant to know — lifestyle, preferences, recent injuries, etc.
              </p>
              <textarea
                className="profile-notes-input"
                rows={4}
                placeholder="e.g. I recently had knee surgery and should avoid high-impact exercises. I prefer morning workouts and follow a vegetarian diet."
                value={profile.notes || ""}
                onChange={(e) => setProfile((p) => ({ ...p, notes: e.target.value }))}
              />
            </div>

            {saveMsg && (
              <div className={`profile-alert profile-alert-${saveMsg.type}`}>{saveMsg.text}</div>
            )}

            <div className="profile-actions">
              <button className="btn-primary" type="submit" disabled={saving}>
                {saving ? "Saving…" : "Save Profile"}
              </button>
            </div>
          </form>
        </section>

        {/* ── AI Memory ────────────────────────────────────────────── */}
        <section className="profile-card">
          <div className="mem-header">
            <div>
              <h2 className="profile-section-title">AI Memory</h2>
              <p className="profile-section-desc">
                Facts the AI has learned about you from past conversations. These are sent with every message to personalise responses.
              </p>
            </div>
            <button
              className="mem-extract-btn"
              type="button"
              onClick={handleExtractMemories}
              disabled={memExtracting}
            >
              {memExtracting ? (
                <>
                  <span className="mem-spinner" />
                  Analysing…
                </>
              ) : (
                <>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm1 17.93V18a1 1 0 0 0-2 0v1.93A8 8 0 0 1 4.07 13H6a1 1 0 0 0 0-2H4.07A8 8 0 0 1 11 4.07V6a1 1 0 0 0 2 0V4.07A8 8 0 0 1 19.93 11H18a1 1 0 0 0 0 2h1.93A8 8 0 0 1 13 19.93z"/>
                  </svg>
                  Extract from Chats
                </>
              )}
            </button>
          </div>

          {memMsg && (
            <div className={`profile-alert profile-alert-${memMsg.type === "info" ? "info" : memMsg.type}`}>
              {memMsg.text}
            </div>
          )}

          {memLoading ? (
            <div className="mem-loading">
              <span className="mem-spinner" />
              <span>Loading memories…</span>
            </div>
          ) : memories.length === 0 ? (
            <div className="mem-empty">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor" opacity=".25">
                <path d="M13 2.05v2.02c3.95.49 7 3.85 7 7.93 0 3.21-1.81 6-4.72 7.28L13 17v5h5l-1.22-1.22C19.91 19.07 22 15.76 22 12c0-5.18-3.95-9.45-9-9.95zM11 2.05C5.95 2.55 2 6.82 2 12c0 3.76 2.09 7.07 5.22 8.78L6 22h5v-5l-2.28 2.28C6.81 18 5 15.21 5 12c0-4.08 3.05-7.44 7-7.93V2.05z"/>
              </svg>
              <p>No memories yet. Click <strong>Extract from Chats</strong> to analyse your conversation history.</p>
            </div>
          ) : (
            <ul className="mem-list">
              {memories.map((m, i) => (
                <li key={m.id || i} className="mem-item">
                  <div className="mem-item-left">
                    <span className={`mem-source-badge${m.source === "auto" ? " auto" : " manual"}`}>
                      {m.source === "auto" ? "AI" : "You"}
                    </span>
                    <span className="mem-text">{m.text}</span>
                  </div>
                  <button
                    className="mem-delete-btn"
                    type="button"
                    title="Forget this memory"
                    onClick={() => handleDeleteMemory(m.id)}
                  >
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8 2.146 2.854z"/>
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {memories.length > 0 && (
            <p className="mem-count-hint">
              {memories.length} memor{memories.length === 1 ? "y" : "ies"} — included in every AI response
            </p>
          )}
        </section>

        {/* ── Google Fit ────────────────────────────────────────────── */}
        <section className="profile-card">
          <h2 className="profile-section-title">Google Fit</h2>
          <p className="profile-section-desc">
            Connect your Google Fit account to include today's steps, heart rate, and weight in the AI context.
          </p>

          {fitMsg && (
            <div className={`profile-alert profile-alert-${fitMsg.type}`}>{fitMsg.text}</div>
          )}

          {!fitConfigured && (
            <p className="profile-warn">
              Google Fit is not configured on the server. The administrator needs to set{" "}
              <code>GOOGLE_CLIENT_ID</code>, <code>GOOGLE_CLIENT_SECRET</code>, and{" "}
              <code>GOOGLE_REDIRECT_URI</code> environment variables.
            </p>
          )}

          {fitConnected ? (
            <div className="fit-connected">
              <div className="fit-status-badge">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0z"/>
                </svg>
                Connected to Google Fit
              </div>

              {fitSnapshot && (
                <div className="fit-data-grid">
                  {fitSnapshot.todaySteps != null && (
                    <div className="fit-data-card">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M13.49 5.48c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm-3.6 13.9 1-4.4 2.1 2v6h2v-7.5l-2.1-2 .6-3c1.3 1.5 3.3 2.5 5.5 2.5v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1l-5.2 2.2v4.7h2v-3.4l1.8-.7-1.6 8.1-4.9-1-.4 2 7 1.4z"/>
                      </svg>
                      <div>
                        <div className="fit-metric-value">{fitSnapshot.todaySteps.toLocaleString()}</div>
                        <div className="fit-metric-label">Steps today</div>
                      </div>
                    </div>
                  )}
                  {fitSnapshot.avgHeartRate != null && (
                    <div className="fit-data-card">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                      </svg>
                      <div>
                        <div className="fit-metric-value">{fitSnapshot.avgHeartRate} <span className="fit-metric-unit">bpm</span></div>
                        <div className="fit-metric-label">Avg heart rate (7 d)</div>
                      </div>
                    </div>
                  )}
                  {fitSnapshot.weight != null && (
                    <div className="fit-data-card">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 3C8.59 3 5.69 4.59 4 7.07L2.69 6.25 2 7.43l1.3.82C3.11 9 3 9.99 3 11H1v2h2c0 1.01.11 2 .3 2.75L2 16.57l.69 1.18 1.31-.82C5.69 19.41 8.59 21 12 21s6.31-1.59 8-4.07l1.3.82.69-1.18-1.3-.82c.19-.75.3-1.74.3-2.75H23v-2h-2c0-1.01-.11-2-.3-2.75l1.3-.82-.69-1.18-1.31.82C18.31 4.59 15.41 3 12 3zm0 2c2.67 0 5.07 1.19 6.66 3.06l-1.43.9A5.973 5.973 0 0 0 12 7a5.97 5.97 0 0 0-5.23 2.96l-1.43-.9C6.93 7.19 9.33 5 12 5zm0 14c-2.67 0-5.07-1.19-6.66-3.06l1.43-.9A5.97 5.97 0 0 0 12 17a5.97 5.97 0 0 0 5.23-2.96l1.43.9C17.07 16.81 14.67 19 12 19zm0-10a4 4 0 0 1 0 8 4 4 0 0 1 0-8z"/>
                      </svg>
                      <div>
                        <div className="fit-metric-value">{fitSnapshot.weight} <span className="fit-metric-unit">kg</span></div>
                        <div className="fit-metric-label">Weight</div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {fitFetchedAt && (
                <p className="fit-fetched-at">Last updated: {formatAge(fitFetchedAt)}</p>
              )}

              <div className="fit-actions">
                <button className="btn-secondary" onClick={handleFitRefresh} disabled={fitLoading}>
                  {fitLoading ? "Refreshing…" : "Refresh Data"}
                </button>
                <button className="btn-danger-outline" onClick={handleFitDisconnect} disabled={fitLoading}>
                  Disconnect
                </button>
              </div>
            </div>
          ) : (
            <button
              className="fit-connect-btn"
              onClick={handleFitConnect}
              disabled={fitLoading || !fitConfigured}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/>
              </svg>
              {fitLoading ? "Connecting…" : "Connect Google Fit"}
            </button>
          )}
        </section>

      </div>
    </div>
  );
}
