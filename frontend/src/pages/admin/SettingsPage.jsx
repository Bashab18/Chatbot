import React, { useState, useEffect, useRef } from "react";
import { useAuth } from "../../context/AuthContext";

const MODEL_GROUPS = [
  {
    gen: "Gemini 2.5",
    models: [
      { id: "gemini-2.5-pro",        label: "2.5 Pro",       desc: "Most intelligent — deep reasoning & thinking",   tag: "Smartest" },
      { id: "gemini-2.5-flash",      label: "2.5 Flash",     desc: "Adaptive thinking, best price-performance",      tag: "Recommended" },
    ],
  },
  {
    gen: "Gemini 2.0",
    models: [
      { id: "gemini-2.0-flash",      label: "2.0 Flash",     desc: "Next-gen multimodal speed and capability" },
      { id: "gemini-2.0-flash-lite", label: "2.0 Flash-Lite",desc: "Most cost-efficient 2.0 model",                  tag: "Lightest" },
    ],
  },
  {
    gen: "Gemini 1.5",
    models: [
      { id: "gemini-1.5-pro",        label: "1.5 Pro",       desc: "Complex reasoning with 1M token context window" },
      { id: "gemini-1.5-flash",      label: "1.5 Flash",     desc: "Balanced speed and quality",                     tag: "Default" },
      { id: "gemini-1.5-flash-8b",   label: "1.5 Flash-8B",  desc: "Fastest and most compact",                       tag: "Fastest" },
    ],
  },
];

const STYLES = [
  { value: "precise",  label: "Precise",  desc: "Factual, direct",        temp: "0.2" },
  { value: "balanced", label: "Balanced", desc: "Default, general use",   temp: "0.7" },
  { value: "creative", label: "Creative", desc: "Expressive, varied",     temp: "1.2" },
];

const TTS_MODELS = [
  { id: "eleven_turbo_v2_5",      label: "Turbo v2.5",       desc: "Lowest latency · great quality" },
  { id: "eleven_turbo_v2",        label: "Turbo v2",          desc: "Low latency · solid quality" },
  { id: "eleven_multilingual_v2", label: "Multilingual v2",   desc: "Highest quality · 29 languages" },
  { id: "eleven_monolingual_v1",  label: "Monolingual v1",    desc: "Original English model" },
];

const DEFAULTS = {
  model:              "gemini-1.5-flash",
  systemPrompt:       "",
  style:              "balanced",
  ragTopK:            5,
  ragMinScore:        0,
  refusalMessage:     "I'm sorry, I don't have information about that in my knowledge base.",
  ragWeight:          100,
  ownKnowledgeWeight: 0,
  webSearchWeight:    0,
  theme:              "dark",
  ttsEnabled:         true,
  ttsVoiceId:         "21m00Tcm4TlvDq8ikWAM",
  ttsModelId:         "eleven_turbo_v2_5",
  ttsStability:       0.5,
  ttsSimilarity:      0.75,
};

function Card({ title, desc, children }) {
  return (
    <div className="settings-card">
      <h2 className="settings-section-title">{title}</h2>
      {desc && <p className="settings-desc">{desc}</p>}
      {children}
    </div>
  );
}

function SliderRow({ label, hint, min, max, step, value, onChange, format }) {
  return (
    <div className="slider-field">
      <div className="slider-header">
        <span className="slider-label">{label}</span>
        <span className="slider-value">{format ? format(value) : value}</span>
      </div>
      {hint && <p className="slider-hint">{hint}</p>}
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))} className="slider-input" />
      <div className="slider-ticks"><span>{min}</span><span>{max}</span></div>
    </div>
  );
}

function TTSSection({ s, set }) {
  const [voices, setVoices]         = useState([]);
  const [loadingVoices, setLoading] = useState(false);
  const [voiceError, setVoiceError] = useState("");
  const [testState, setTestState]   = useState("idle"); // "idle" | "loading" | "playing"
  const [testError, setTestError]   = useState("");
  const testAudioRef                = useRef(null);
  const { getToken } = useAuth();

  useEffect(() => {
    if (!s.ttsEnabled) return;
    setLoading(true); setVoiceError("");
    fetch("/api/tts/voices", { headers: { Authorization: `Bearer ${getToken()}` } })
      .then((r) => r.json())
      .then((d) => { if (d.error) throw new Error(d.error); setVoices(d.voices || []); })
      .catch((e) => setVoiceError(e.message))
      .finally(() => setLoading(false));
  }, [s.ttsEnabled]);

  async function handleTest() {
    // If audio is playing, stop it
    if (testAudioRef.current) {
      testAudioRef.current.pause();
      testAudioRef.current = null;
      setTestState("idle");
      return;
    }
    if (testState === "loading") return;
    setTestState("loading");
    setTestError("");
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: "Hello! This is a voice preview. How does this sound to you?",
          voiceId:        s.ttsVoiceId,
          modelId:        s.ttsModelId,
          stability:      s.ttsStability,
          similarityBoost:s.ttsSimilarity,
        }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || `TTS error ${res.status}`);
      }
      const blob  = await res.blob();
      const url   = URL.createObjectURL(blob);
      const audio = new Audio(url);
      testAudioRef.current = audio;
      setTestState("playing");
      audio.play();
      audio.onended = () => {
        URL.revokeObjectURL(url);
        testAudioRef.current = null;
        setTestState("idle");
      };
    } catch (err) {
      setTestError(err.message);
      setTestState("idle");
    }
  }

  return (
    <div className="tts-section">
      {/* Enable toggle */}
      <div className="toggle-row">
        <div>
          <div className="toggle-label">Enable Voice</div>
          <div className="toggle-hint">Read assistant responses aloud via ElevenLabs</div>
        </div>
        <button
          type="button"
          className={`tts-switch${s.ttsEnabled ? " on" : ""}`}
          onClick={() => set("ttsEnabled", !s.ttsEnabled)}
        >
          <div className="tts-knob" />
        </button>
      </div>

      {s.ttsEnabled && (
        <div className="tts-fields">
          {/* Voice */}
          <div className="tts-field">
            <label className="tts-field-label">Voice</label>
            {voiceError ? (
              <p className="tts-error">⚠ {voiceError} — check ELEVENLABS_API_KEY in backend .env</p>
            ) : loadingVoices ? (
              <p className="slider-hint">Loading voices…</p>
            ) : (
              <select className="settings-select" value={s.ttsVoiceId}
                onChange={(e) => set("ttsVoiceId", e.target.value)}>
                {voices.map((v) => (
                  <option key={v.voice_id} value={v.voice_id}>
                    {v.name}{v.labels?.accent ? ` · ${v.labels.accent}` : ""}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* TTS Model */}
          <div className="tts-field">
            <label className="tts-field-label">Model</label>
            <select className="settings-select" value={s.ttsModelId}
              onChange={(e) => set("ttsModelId", e.target.value)}>
              {TTS_MODELS.map((m) => (
                <option key={m.id} value={m.id}>{m.label} — {m.desc}</option>
              ))}
            </select>
          </div>

          {/* Sliders */}
          <SliderRow label="Stability" min={0} max={1} step={0.05}
            value={s.ttsStability} onChange={(v) => set("ttsStability", v)}
            format={(v) => v.toFixed(2)}
            hint="Higher = more consistent voice. Lower = more expressive." />
          <SliderRow label="Clarity / Similarity Boost" min={0} max={1} step={0.05}
            value={s.ttsSimilarity} onChange={(v) => set("ttsSimilarity", v)}
            format={(v) => v.toFixed(2)}
            hint="How closely the AI matches the original voice." />

          {/* Test Voice */}
          <div className="tts-test-row">
            <button
              type="button"
              className={`tts-test-btn${testState !== "idle" ? " active" : ""}`}
              onClick={handleTest}
              disabled={testState === "loading"}
            >
              {testState === "loading" ? (
                <><span className="tts-test-spinner" />Loading…</>
              ) : testState === "playing" ? (
                <>
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                    <rect x="3" y="3" width="4" height="10" rx="1"/>
                    <rect x="9" y="3" width="4" height="10" rx="1"/>
                  </svg>
                  Stop
                </>
              ) : (
                <>
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M10.804 8 5 4.633v6.734L10.804 8zm.792-.696a.802.802 0 0 1 0 1.392l-6.363 3.692C4.713 12.69 4 12.345 4 11.692V4.308c0-.653.713-.998 1.233-.696l6.363 3.692z"/>
                  </svg>
                  Test Voice
                </>
              )}
            </button>
            {testError && <span className="tts-test-error">⚠ {testError}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

export default function SettingsPage() {
  const { getToken } = useAuth();
  const [s, setS]       = useState(DEFAULTS);
  const [saving, setSaving]   = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);

  const set = (key, val) => setS((p) => ({ ...p, [key]: val }));

  useEffect(() => {
    async function load() {
      try {
        const token = getToken();
        const res  = await fetch("/api/admin/settings", { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) throw new Error(`Failed to load settings (${res.status})`);
        const data = await res.json();
        setS({ ...DEFAULTS, ...data });
      } catch (err) {
        setMessage({ type: "error", text: `Could not load settings: ${err.message}` });
      }
      setLoading(false);
    }
    load();
  }, []);

  async function save(e) {
    e.preventDefault();
    setSaving(true); setMessage(null);
    try {
      const token = getToken();
      const res  = await fetch("/api/admin/settings", {
        method:  "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body:    JSON.stringify(s),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Save failed");
      // Sync state from what the server actually persisted
      if (json.settings) setS({ ...DEFAULTS, ...json.settings });
      setMessage({ type: "success", text: "Settings saved." });
      setTimeout(() => setMessage(null), 3000);
    } catch (err) {
      setMessage({ type: "error", text: err.message });
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="admin-page"><div className="admin-loading"><div className="auth-spinner" /></div></div>;

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1>Bot Settings</h1>
        <p>Configure model, behaviour, retrieval, voice, and appearance</p>
      </div>

      {message && <div className={`admin-alert admin-alert-${message.type}`}>{message.text}</div>}

      <form className="settings-form" onSubmit={save}>

        {/* ── Model ───────────────────────────────────────── */}
        <Card title="Model" desc="Gemini model used to generate all responses.">
          {MODEL_GROUPS.map((group) => (
            <div key={group.gen} className="model-group-section">
              <div className="model-group-label">{group.gen}</div>
              <div className="model-grid">
                {group.models.map((m) => (
                  <label key={m.id} className={`model-card${s.model === m.id ? " selected" : ""}`}>
                    <input type="radio" name="model" value={m.id}
                      checked={s.model === m.id}
                      onChange={(e) => set("model", e.target.value)} />
                    <div className="model-card-body">
                      <span className="model-name">{m.label}</span>
                      {m.tag && <span className="model-tag">{m.tag}</span>}
                      <span className="model-desc">{m.desc}</span>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </Card>

        {/* ── Response Style ───────────────────────────────── */}
        <Card title="Response Style" desc="Controls how creative or factual the AI's answers are.">
          <div className="style-grid">
            {STYLES.map((st) => (
              <label key={st.value} className={`style-card${s.style === st.value ? " selected" : ""}`}>
                <input type="radio" name="style" value={st.value}
                  checked={s.style === st.value}
                  onChange={(e) => set("style", e.target.value)} />
                <div className="style-card-body">
                  <span className="style-name">{st.label}</span>
                  <span className="style-desc">{st.desc}</span>
                  <span className="style-temp">temp {st.temp}</span>
                </div>
              </label>
            ))}
          </div>
        </Card>

        {/* ── Persona ─────────────────────────────────────── */}
        <Card title="CIRA Persona"
          desc="Personality, tone, and domain instructions. The KB-only constraint is always enforced automatically.">
          <textarea className="persona-textarea" rows={5} value={s.systemPrompt}
            onChange={(e) => set("systemPrompt", e.target.value)}
            placeholder="e.g. You are a friendly support assistant for Acme Corp. Always be concise and professional." />
        </Card>

        {/* ── RAG ─────────────────────────────────────────── */}
        <Card title="Knowledge Base Retrieval" desc="Tune how the bot searches documents when answering.">
          <div className="sliders-group">
            <SliderRow label="Results (Top K)" min={1} max={10} step={1}
              value={s.ragTopK} onChange={(v) => set("ragTopK", v)}
              hint="Number of document chunks retrieved per query." />
            <SliderRow label="Minimum Match Score" min={0.10} max={0.90} step={0.05}
              value={s.ragMinScore} onChange={(v) => set("ragMinScore", v)}
              format={(v) => v.toFixed(2)}
              hint="Chunks below this similarity score are ignored. Higher = stricter." />
          </div>
        </Card>

        {/* ── Knowledge Sources ───────────────────────────── */}
        <Card title="Knowledge Sources"
          desc="Control which sources the bot draws on when answering. Each slider is independent — set to 0 to disable that source.">
          <div className="sliders-group">
            <SliderRow label="Knowledge Base" min={0} max={100} step={5}
              value={s.ragWeight ?? 100} onChange={(v) => set("ragWeight", v)}
              format={(v) => `${v}%`}
              hint="Use indexed documents from the knowledge base. Disable to skip KB lookup entirely." />
            <SliderRow label="AI Own Knowledge" min={0} max={100} step={5}
              value={s.ownKnowledgeWeight ?? 0} onChange={(v) => set("ownKnowledgeWeight", v)}
              format={(v) => `${v}%`}
              hint="Allow the AI to draw on its own training data. When disabled with KB-only, non-matching queries get the refusal message." />
            <SliderRow label="Live Web Search" min={0} max={100} step={5}
              value={s.webSearchWeight ?? 0} onChange={(v) => set("webSearchWeight", v)}
              format={(v) => `${v}%`}
              hint="Enable Google Search grounding for real-time web results. Recommended with Gemini 2.0+ models." />
          </div>
        </Card>

        {/* ── Refusal message ─────────────────────────────── */}
        <Card title="Out-of-Scope Response"
          desc="Shown when a question has no matching content in the knowledge base.">
          <input className="refusal-input" type="text" value={s.refusalMessage}
            onChange={(e) => set("refusalMessage", e.target.value)}
            placeholder="I'm sorry, I don't have information about that in my knowledge base." />
        </Card>

        {/* ── TTS ─────────────────────────────────────────── */}
        <Card title="Voice (ElevenLabs)" desc="Text-to-speech settings applied to all user chat sessions.">
          <TTSSection s={s} set={set} />
        </Card>

        {/* ── Theme ───────────────────────────────────────── */}
        <Card title="Appearance" desc="Default theme for all chat sessions.">
          <div className="theme-row">
            <div className="theme-options">
              {["dark", "light"].map((t) => (
                <button key={t} type="button"
                  className={`theme-option-btn${s.theme === t ? " selected" : ""}`}
                  onClick={() => set("theme", t)}>
                  <span className="theme-option-icon">{t === "dark" ? "🌙" : "☀️"}</span>
                  <span>{t.charAt(0).toUpperCase() + t.slice(1)}</span>
                </button>
              ))}
            </div>
          </div>
        </Card>

        <div className="settings-actions">
          <button className="btn-primary" type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save Settings"}
          </button>
        </div>
      </form>
    </div>
  );
}
