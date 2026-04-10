import React, { useState, useEffect } from "react";
import { useAuth } from "../../context/AuthContext";

const MODELS = [
  { value: "gemini-2.5-pro",        label: "Gemini 2.5 Pro",       tag: "Best" },
  { value: "gemini-2.5-flash",      label: "Gemini 2.5 Flash",     tag: "Fast" },
  { value: "gemini-2.0-flash",      label: "Gemini 2.0 Flash",     tag: "" },
  { value: "gemini-2.0-flash-lite", label: "Gemini 2.0 Flash Lite", tag: "Lite" },
  { value: "gemini-1.5-pro",        label: "Gemini 1.5 Pro",       tag: "" },
  { value: "gemini-1.5-flash",      label: "Gemini 1.5 Flash",     tag: "" },
  { value: "gemini-1.5-flash-8b",   label: "Gemini 1.5 Flash-8B",  tag: "Small" },
];

export default function SettingsPage() {
  const { getToken } = useAuth();
  const [settings, setSettings]   = useState({ model: "gemini-1.5-flash", systemPrompt: "" });
  const [saving, setSaving]       = useState(false);
  const [loading, setLoading]     = useState(true);
  const [message, setMessage]     = useState(null);

  useEffect(() => {
    async function load() {
      try {
        const token = await getToken();
        const res = await fetch("/api/admin/settings", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        setSettings({ model: data.model ?? "gemini-1.5-flash", systemPrompt: data.systemPrompt ?? "" });
      } catch {}
      setLoading(false);
    }
    load();
  }, [getToken]);

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const token = await getToken();
      const res = await fetch("/api/admin/settings", {
        method:  "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body:    JSON.stringify(settings),
      });
      if (!res.ok) throw new Error("Save failed");
      setMessage({ type: "success", text: "Settings saved successfully." });
    } catch (err) {
      setMessage({ type: "error", text: err.message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1>Bot Settings</h1>
        <p>Configure the chatbot persona and model</p>
      </div>

      {message && (
        <div className={`admin-alert admin-alert-${message.type}`}>{message.text}</div>
      )}

      {loading ? (
        <div className="admin-loading"><div className="auth-spinner" /></div>
      ) : (
        <form className="settings-form" onSubmit={save}>
          <div className="settings-card">
            <h2 className="settings-section-title">Model</h2>
            <p className="settings-desc">Choose the Gemini model used to generate responses.</p>
            <div className="model-grid">
              {MODELS.map((m) => (
                <label
                  key={m.value}
                  className={`model-card${settings.model === m.value ? " selected" : ""}`}
                >
                  <input
                    type="radio"
                    name="model"
                    value={m.value}
                    checked={settings.model === m.value}
                    onChange={(e) => setSettings((p) => ({ ...p, model: e.target.value }))}
                  />
                  <span className="model-name">{m.label}</span>
                  {m.tag && <span className="model-tag">{m.tag}</span>}
                </label>
              ))}
            </div>
          </div>

          <div className="settings-card">
            <h2 className="settings-section-title">Chatbot Persona</h2>
            <p className="settings-desc">
              Describe the bot's personality, tone, and any domain-specific instructions.
              The knowledge-base constraint is always enforced automatically.
            </p>
            <textarea
              className="persona-textarea"
              value={settings.systemPrompt}
              onChange={(e) => setSettings((p) => ({ ...p, systemPrompt: e.target.value }))}
              placeholder="e.g. You are a friendly support assistant for Acme Corp. Always be concise and helpful."
              rows={6}
            />
          </div>

          <div className="settings-actions">
            <button className="btn-primary" type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save Settings"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
