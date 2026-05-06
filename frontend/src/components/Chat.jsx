import React, { useState, useRef, useEffect, useCallback } from "react";
import Message from "./Message";

export default function Chat({ conversation, onUpdate, onToggleSidebar, sidebarOpen, docCount, settings }) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [speakingId, setSpeakingId] = useState(null);
  const audioRef = useRef(null);
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);

  // Stop audio when conversation changes
  useEffect(() => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    setSpeakingId(null);
  }, [conversation.id]);

  const handleSpeak = useCallback(async (text, msgId) => {
    // Toggle off if same message is playing
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
      if (speakingId === msgId) { setSpeakingId(null); return; }
    }

    setSpeakingId(msgId);
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          voiceId:        settings?.ttsVoiceId      ?? "21m00Tcm4TlvDq8ikWAM",
          modelId:        settings?.ttsModelId      ?? "eleven_turbo_v2_5",
          stability:      settings?.ttsStability    ?? 0.5,
          similarityBoost: settings?.ttsSimilarity  ?? 0.75,
        }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.play();
      audio.onended = () => { URL.revokeObjectURL(url); setSpeakingId(null); audioRef.current = null; };
    } catch (err) {
      console.error("TTS error:", err.message);
      setSpeakingId(null);
    }
  }, [settings, speakingId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversation.messages, loading]);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }, [input]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    const isFirstMessage = conversation.messages.length === 0;

    onUpdate(conversation.id, (conv) => ({
      ...conv,
      messages: [...conv.messages, { role: "user", text }],
    }));
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message:      text,
          sessionId:    conversation.id,
          model:        settings?.model        ?? "gemini-1.5-flash",
          systemPrompt: settings?.systemPrompt ?? "",
          style:        settings?.style        ?? "balanced",
          ragTopK:      settings?.ragTopK      ?? 4,
          ragMinScore:  settings?.ragMinScore  ?? 0.45,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      onUpdate(conversation.id, (conv) => ({
        ...conv,
        messages: [...conv.messages, { role: "assistant", text: data.reply }],
      }));

      // Auto-generate title from first message
      if (isFirstMessage) {
        fetch("/api/title", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text }),
        })
          .then((r) => r.json())
          .then((d) => {
            if (d.title) {
              onUpdate(conversation.id, (conv) => ({ ...conv, title: d.title }));
            }
          })
          .catch(() => {});
      }
    } catch (err) {
      onUpdate(conversation.id, (conv) => ({
        ...conv,
        messages: [...conv.messages, { role: "assistant", text: `⚠️ ${err.message}` }],
      }));
    } finally {
      setLoading(false);
      textareaRef.current?.focus();
    }
  }, [input, loading, conversation, onUpdate, settings]);

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const isEmpty = conversation.messages.length === 0;

  const modelLabel = {
    "gemini-3.1-pro-preview":        "3.1 Pro",
    "gemini-3.1-flash-lite-preview":  "3.1 Flash Lite",
    "gemini-3-pro-preview":          "3 Pro",
    "gemini-3-flash-preview":        "3 Flash",
    "gemini-2.5-pro":                "2.5 Pro",
    "gemini-2.5-flash":              "2.5 Flash",
    "gemini-2.5-flash-lite":         "2.5 Flash Lite",
    "gemini-2.0-flash":              "2.0 Flash",
    "gemini-2.0-flash-lite":         "2.0 Lite",
    "gemma-4-31b-it":                "Gemma 4 31B",
    "gemma-4-26b-a4b-it":            "Gemma 4 26B",
  }[settings?.model] ?? settings?.model;

  return (
    <div className="chat">
      {/* Topbar */}
      <div className="chat-topbar">
        {!sidebarOpen && (
          <button className="icon-btn" onClick={onToggleSidebar} title="Open sidebar">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path fillRule="evenodd" d="M2.5 12a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5zm0-4a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5zm0-4a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5z"/>
            </svg>
          </button>
        )}
        <span className="chat-title">{conversation.title}</span>

        <div className="topbar-badges">
          <span className="model-badge">{modelLabel}</span>
          {settings?.style && settings.style !== "balanced" && (
            <span className="style-badge">{settings.style}</span>
          )}
          {docCount > 0 && (
            <span className="rag-badge" title={`${docCount} document${docCount > 1 ? "s" : ""} in knowledge base`}>
              <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
                <path d="M9.293 0H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V4.707A1 1 0 0 0 13.707 4L10 .293A1 1 0 0 0 9.293 0zM9.5 3.5v-2l3 3h-2a1 1 0 0 1-1-1z"/>
              </svg>
              {docCount} doc{docCount > 1 ? "s" : ""}
            </span>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="chat-messages">
        {isEmpty && (
          <div className="empty-state">
            <div className="empty-logo">✦</div>
            <div className="empty-wellness-badge">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
              </svg>
              Health &amp; Wellness Assistant
            </div>
            <h2>How can I help you today?</h2>
            <p>Ask me anything about fitness, nutrition, medications, or managing your health goals.</p>
            <div className="suggestion-chips">
              {[
                "What exercises are safe for my age?",
                "Help me understand my medications",
                "Create a gentle walking plan for me",
                "What foods help reduce inflammation?",
              ].map((s) => (
                <button key={s} className="suggestion-chip" onClick={() => setInput(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {conversation.messages.map((msg, i) => (
          <Message
            key={i}
            role={msg.role}
            text={msg.text}
            msgId={i}
            onSpeak={settings?.ttsEnabled ? handleSpeak : null}
            isSpeaking={speakingId === i}
          />
        ))}

        {loading && (
          <div className="message-row assistant">
            <div className="avatar assistant-avatar">G</div>
            <div className="bubble typing"><span /><span /><span /></div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="chat-input-area">
        <div className="input-box">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your health, fitness, or wellness… (Shift+Enter for new line)"
            rows={1}
            disabled={loading}
          />
          <button
            className="send-btn"
            onClick={sendMessage}
            disabled={loading || !input.trim()}
            title="Send"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
            </svg>
          </button>
        </div>
        <p className="disclaimer">For general wellness guidance only — always consult your healthcare provider for medical decisions.</p>
      </div>
    </div>
  );
}
