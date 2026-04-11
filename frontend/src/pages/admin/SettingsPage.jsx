import React, { useState, useEffect } from "react";
import { useAuth } from "../../context/AuthContext";

const MODELS = [
  { value: "gemini-2.5-pro",        label: "Gemini 2.5 Pro",        tag: "Best" },
  { value: "gemini-2.5-flash",      label: "Gemini 2.5 Flash",      tag: "Fast" },
  { value: "gemini-2.0-flash",      label: "Gemini 2.0 Flash",      tag: "" },
  { value: "gemini-2.0-flash-lite", label: "Gemini 2.0 Flash Lite", tag: "Lite" },
  { value: "gemini-1.5-pro",        label: "Gemini 1.5 Pro",        tag: "" },
  { value: "gemini-1.5-flash",      label: "Gemini 1.5 Flash",      tag: "" },
  { value: "gemini-1.5-flash-8b",   label: "Gemini 1.5 Flash-8B",   tag: "Small" },
];

const STYLES = [
  { value: "precise",  label: "Precise",  desc: "Factual, low creativity",   temp: "0.2" },
  { value: "balanced", label: "Balanced", desc: "Default, general purpose",  temp: "0.7" },
  { value: "creative", label: "Creative", desc: "More varied, expressive",   temp: "1.2" },
];

const DEFAULTS = {
  model:          "gemini-1.5-flash",
  systemPrompt:   "",
  style:          "balanced",
  ragTopK:        5,
  ragMinScore:    0.40,
  refusalMessage: "I'm sorry, I don't have information about that in my knowledge base.",
};

function SliderField({ label, hint, min, max, step, value, onChange, format }) {
  return (
    <div className="slider-field">
      <div className="slider-header">
        <span className="slider-label">{label}</span>
        <span className="slider-value">{format ? format(value) : value}</span>
      </div>
      {hint && <p className="slider-hint">{hint}</p>}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="slider-input"
      />
      <div className="slider-ticks">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const { getToken } = useAuth();
  const [settings, setSettings] = useState(DEFAULTS);
  const [saving, setSaving]     = useState(false);
  const [loading, setLoading]   = useState(true);
  const [message, setMessage]   = useState(null);

  const set = (key) => (val) => setSettings((p) => ({ ...p, [key]: val }));

  useEffect(() => {
    async function load() {
      try {
        const token = getToken();
        const res  = await fetch("/api/admin/settings", { headers: { Authorization: `Bearer ${token}` } });
        const data = await res.json();
        setSettings({ ...DEFAULTS, ...data });
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
      const token = getToken();
      const res = await fetch("/api/admin/settings", {
        method:  "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body:    JSON.stringify(settings),
      });
      if (!res.ok) throw new Error("Save failed");
      setMessage({ type: "success", text: "Settings saved successfully." });
      setTimeout(() => setMessage(null), 3000);
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
        <p>Configure the chatbot model, behaviour, and knowledge base retrieval</p>
      </div>

      {message && <div className={`admin-alert admin-alert-${message.type}`}>{message.text}</div>}

      {loading ? (
        <div className="admin-loading"><div className="auth-spinner" /></div>
      ) : (
        <form className="settings-form" onSubmit={save}>

          {/* ── Model ─────────────────────────────────────── */}
          <div className="settings-card">
            <h2 className="settings-section-title">Model</h2>
            <p className="settings-desc">Gemini model used to generate responses.</p>
            <div className="model-grid">
              {MODELS.map((m) => (
                <label key={m.value} className={`model-card${settings.model === m.value ? " selected" : ""}`}>
                  <input type="radio" name="model" value={m.value}
                    checked={settings.model === m.value}
                    onChange={(e) => set("model")(e.target.value)} />
                  <span className="model-name">{m.label}</span>
                  {m.tag && <span className="model-tag">{m.tag}</span>}
                </label>
              ))}
            </div>
          </div>

          {/* ── Response Style ────────────────────────────── */}
          <div className="settings-card">
            <h2 className="settings-section-title">Response Style</h2>
            <p className="settings-desc">Controls how creative or factual the AI's answers are.</p>
            <div className="style-grid">
              {STYLES.map((s) => (
                <label key={s.value} className={`style-card${settings.style === s.value ? " selected" : ""}`}>
                  <input type="radio" name="style" value={s.value}
                    checked={settings.style === s.value}
                    onChange={(e) => set("style")(e.target.value)} />
                  <div className="style-card-body">
                    <span className="style-name">{s.label}</span>
                    <span className="style-desc">{s.desc}</span>
                    <span className="style-temp">temp {s.temp}</span>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* ── Persona ───────────────────────────────────── */}
          <div className="settings-card">
            <h2 className="settings-section-title">Chatbot Persona</h2>
            <p className="settings-desc">
              Describe the bot's personality, tone, and domain instructions.
              The knowledge-base constraint is always enforced automatically.
            </p>
            <textarea
              className="persona-textarea"
              value={settings.systemPrompt}
              onChange={(e) => set("systemPrompt")(e.target.value)}
              placeholder="e.g. You are a friendly support assistant for Acme Corp. Always be concise and professional."
              rows={5}
            />
          </div>

          {/* ── Retrieval ─────────────────────────────────── */}
          <div className="settings-card">
            <h2 className="settings-section-title">Knowledge Base Retrieval</h2>
            <p className="settings-desc">
              Tune how the bot searches the knowledge base when answering questions.
            </p>
            <div className="sliders-group">
              <SliderField
                label="Results (Top K)"
                hint="Number of document chunks retrieved per query."
                min={1} max={10} step={1}
                value={settings.ragTopK}
                onChange={set("ragTopK")}
              />
              <SliderField
                label="Minimum Match Score"
                hint="Chunks below this similarity threshold are ignored. Higher = stricter."
                min={0.1} max={0.9} step={0.05}
                value={settings.ragMinScore}
                onChange={set("ragMinScore")}
                format={(v) => v.toFixed(2)}
              />
            </div>
          </div>

          {/* ── Refusal message ───────────────────────────── */}
          <div className="settings-card">
            <h2 className="settings-section-title">Out-of-Scope Response</h2>
            <p className="settings-desc">
              Message shown when a question has no matching content in the knowledge base.
            </p>
            <input
              className="refusal-input"
              type="text"
              value={settings.refusalMessage}
              onChange={(e) => set("refusalMessage")(e.target.value)}
              placeholder="I'm sorry, I don't have information about that in my knowledge base."
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
