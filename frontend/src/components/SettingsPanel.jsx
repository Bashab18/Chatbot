import React from "react";

const MODELS = [
  { id: "gemini-1.5-flash", label: "Gemini 1.5 Flash", desc: "Fast & efficient — great for most tasks" },
  { id: "gemini-1.5-pro",   label: "Gemini 1.5 Pro",   desc: "Most capable — better reasoning & longer context" },
  { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash",  desc: "Next-gen speed with improved quality" },
];

const STYLES = [
  { id: "precise",  label: "Precise",  desc: "Factual, direct, low creativity",  temp: "0.2" },
  { id: "balanced", label: "Balanced", desc: "Default mix of accuracy and flair", temp: "0.7" },
  { id: "creative", label: "Creative", desc: "Expressive, varied, imaginative",   temp: "1.2" },
];

function Section({ title, children }) {
  return (
    <div className="settings-section">
      <div className="settings-section-title">{title}</div>
      {children}
    </div>
  );
}

function RadioCard({ checked, onChange, label, desc, badge }) {
  return (
    <label className={`radio-card${checked ? " selected" : ""}`}>
      <input type="radio" checked={checked} onChange={onChange} />
      <div className="radio-card-body">
        <span className="radio-card-label">{label}</span>
        {badge && <span className="radio-badge">{badge}</span>}
        <span className="radio-card-desc">{desc}</span>
      </div>
      <div className={`radio-dot${checked ? " checked" : ""}`} />
    </label>
  );
}

export default function SettingsPanel({ settings, onChange, onClose }) {
  const set = (key, value) => onChange({ ...settings, [key]: value });

  return (
    <div className="settings-panel">
      {/* Header */}
      <div className="settings-header">
        <div className="settings-title">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 4.754a3.246 3.246 0 1 0 0 6.492 3.246 3.246 0 0 0 0-6.492zM5.754 8a2.246 2.246 0 1 1 4.492 0 2.246 2.246 0 0 1-4.492 0z"/>
            <path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 0 1-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 0 1-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 0 1 .52 1.255l-.16.292c-.892 1.64.901 3.434 2.541 2.54l.292-.159a.873.873 0 0 1 1.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 0 1 1.255-.52l.292.16c1.64.892 3.433-.902 2.54-2.541l-.159-.292a.873.873 0 0 1 .52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 0 1-.52-1.255l.16-.292c.892-1.64-.901-3.433-2.541-2.54l-.292.159a.873.873 0 0 1-1.255-.52l-.094-.319zm-2.633.283c.246-.835 1.428-.835 1.674 0l.094.319a1.873 1.873 0 0 0 2.693 1.115l.291-.16c.764-.415 1.6.42 1.184 1.185l-.159.292a1.873 1.873 0 0 0 1.116 2.692l.318.094c.835.246.835 1.428 0 1.674l-.319.094a1.873 1.873 0 0 0-1.115 2.693l.16.291c.415.764-.42 1.6-1.185 1.184l-.291-.159a1.873 1.873 0 0 0-2.693 1.116l-.094.318c-.246.835-1.428.835-1.674 0l-.094-.319a1.873 1.873 0 0 0-2.692-1.115l-.292.16c-.764.415-1.6-.42-1.184-1.185l.159-.291A1.873 1.873 0 0 0 1.945 8.93l-.319-.094c-.835-.246-.835-1.428 0-1.674l.319-.094A1.873 1.873 0 0 0 3.06 4.375l-.16-.292c-.415-.764.42-1.6 1.185-1.184l.292.159a1.873 1.873 0 0 0 2.692-1.115l.094-.319z"/>
          </svg>
          Settings
        </div>
        <button className="icon-btn" onClick={onClose} title="Close">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8 2.146 2.854z"/>
          </svg>
        </button>
      </div>

      <div className="settings-body">
        {/* Model */}
        <Section title="Model">
          <div className="radio-card-group">
            {MODELS.map((m) => (
              <RadioCard
                key={m.id}
                checked={settings.model === m.id}
                onChange={() => set("model", m.id)}
                label={m.label}
                desc={m.desc}
              />
            ))}
          </div>
          <p className="settings-hint">
            Changing model starts a fresh session for new conversations.
          </p>
        </Section>

        {/* System Prompt */}
        <Section title="System Prompt">
          <textarea
            className="settings-textarea"
            rows={4}
            placeholder="E.g. You are a helpful assistant that always responds in bullet points…"
            value={settings.systemPrompt}
            onChange={(e) => set("systemPrompt", e.target.value)}
          />
          <p className="settings-hint">
            Instructions applied to every new conversation. Start a new chat to activate.
          </p>
        </Section>

        {/* Response Style */}
        <Section title="Response Style">
          <div className="radio-card-group">
            {STYLES.map((s) => (
              <RadioCard
                key={s.id}
                checked={settings.style === s.id}
                onChange={() => set("style", s.id)}
                label={s.label}
                desc={s.desc}
                badge={`temp ${s.temp}`}
              />
            ))}
          </div>
        </Section>

        {/* RAG Settings */}
        <Section title="Knowledge Base (RAG)">
          <div className="settings-row">
            <label className="settings-label">
              Results per query
              <span className="settings-value">{settings.ragTopK}</span>
            </label>
            <input
              type="range" min={1} max={8} step={1}
              value={settings.ragTopK}
              onChange={(e) => set("ragTopK", Number(e.target.value))}
              className="settings-range"
            />
            <div className="range-labels"><span>1</span><span>8</span></div>
          </div>
          <div className="settings-row">
            <label className="settings-label">
              Similarity threshold
              <span className="settings-value">{settings.ragMinScore.toFixed(2)}</span>
            </label>
            <input
              type="range" min={0.2} max={0.8} step={0.05}
              value={settings.ragMinScore}
              onChange={(e) => set("ragMinScore", Number(e.target.value))}
              className="settings-range"
            />
            <div className="range-labels"><span>0.20 (broad)</span><span>0.80 (strict)</span></div>
          </div>
        </Section>

        {/* Appearance */}
        <Section title="Appearance">
          <div className="theme-toggle-row">
            <span>Theme</span>
            <button
              className={`theme-toggle${settings.theme === "light" ? " light" : ""}`}
              onClick={() => set("theme", settings.theme === "dark" ? "light" : "dark")}
            >
              <span className="theme-icon">🌙</span>
              <div className="theme-knob" />
              <span className="theme-icon">☀️</span>
            </button>
          </div>
        </Section>
      </div>
    </div>
  );
}
