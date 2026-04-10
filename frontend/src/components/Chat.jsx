import React, { useState, useRef, useEffect, useCallback } from "react";
import Message from "./Message";

export default function Chat({ conversation, onUpdate, onToggleSidebar, sidebarOpen, docCount, settings }) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);

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
    "gemini-1.5-flash": "Flash",
    "gemini-1.5-pro":   "Pro",
    "gemini-2.0-flash": "2.0",
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
            <div className="gemini-logo">✦</div>
            <h2>How can I help you today?</h2>
            <p>Gemini {modelLabel} · {settings?.style ?? "balanced"} mode{docCount > 0 ? ` · ${docCount} doc${docCount > 1 ? "s" : ""} loaded` : ""}</p>
          </div>
        )}

        {conversation.messages.map((msg, i) => (
          <Message key={i} role={msg.role} text={msg.text} />
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
            placeholder="Ask Gemini anything… (Shift+Enter for new line)"
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
        <p className="disclaimer">Gemini can make mistakes. Verify important info.</p>
      </div>
    </div>
  );
}
