import React, { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "../context/AuthContext";
import Message from "../components/Message";

const TTS_DEFAULTS = {
  ttsEnabled: false, ttsVoiceId: "21m00Tcm4TlvDq8ikWAM",
  ttsModelId: "eleven_turbo_v2_5", ttsStability: 0.5, ttsSimilarity: 0.75,
};

const DAY = 86_400_000;

function groupConvs(convs) {
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const ts = t.getTime();
  const g = { Today: [], Yesterday: [], "This week": [], Older: [] };
  for (const c of convs) {
    const u = c.updated_at || 0;
    if      (u >= ts)           g.Today.push(c);
    else if (u >= ts - DAY)     g.Yesterday.push(c);
    else if (u >= ts - 7 * DAY) g["This week"].push(c);
    else                        g.Older.push(c);
  }
  return Object.entries(g).filter(([, list]) => list.length > 0);
}

function getInitials(name) {
  if (!name) return "U";
  const parts = name.trim().split(/\s+/);
  return parts.length > 1
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : parts[0][0].toUpperCase();
}

function modelLabel(id) {
  if (!id) return "";
  // "gemini-2.5-flash" → "Gemini 2.5 Flash"
  return id.replace("gemini-", "Gemini ").replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const SUGGESTIONS = [
  "What topics can you help with?",
  "Summarize the key points",
  "Explain in simple terms",
  "Give me an overview",
];

export default function ChatPage() {
  const { user, logout, getToken } = useAuth();

  const [conversations, setConversations] = useState([]);
  const [activeId, setActiveId]           = useState(null);
  const [messages, setMessages]           = useState([]);
  const [input, setInput]                 = useState("");
  const [loading, setLoading]             = useState(false);
  const [sidebarOpen, setSidebarOpen]     = useState(true);
  const [speakingId, setSpeakingId]       = useState(null);
  const [editingId, setEditingId]         = useState(null);
  const [editTitle, setEditTitle]         = useState("");
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [ttsSettings, setTtsSettings]    = useState(TTS_DEFAULTS);
  const [instanceName, setInstanceName]  = useState("Chatbot");
  const [botSettings, setBotSettings]    = useState({ model: null, style: null });
  const [showScrollBtn, setShowScrollBtn]= useState(false);

  const audioRef    = useRef(null);
  const bottomRef   = useRef(null);
  const textareaRef = useRef(null);

  // ── API helper ────────────────────────────────────────────────────────
  const apiFetch = useCallback(async (url, opts = {}) => {
    const token = getToken();
    const res = await fetch(url, {
      ...opts,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...opts.headers },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Request failed");
    return data;
  }, [getToken]);

  // ── Bootstrap: settings + instance name ──────────────────────────────
  useEffect(() => {
    apiFetch("/api/settings")
      .then((data) => {
        if (data.theme) document.documentElement.setAttribute("data-theme", data.theme);
        setTtsSettings({
          ttsEnabled:   data.ttsEnabled   ?? false,
          ttsVoiceId:   data.ttsVoiceId   ?? TTS_DEFAULTS.ttsVoiceId,
          ttsModelId:   data.ttsModelId   ?? TTS_DEFAULTS.ttsModelId,
          ttsStability: data.ttsStability ?? TTS_DEFAULTS.ttsStability,
          ttsSimilarity:data.ttsSimilarity ?? TTS_DEFAULTS.ttsSimilarity,
        });
        setBotSettings({ model: data.model, style: data.style });
      })
      .catch(() => {});
    apiFetch("/api/instance")
      .then((d) => { if (d.name) setInstanceName(d.name); })
      .catch(() => {});
  }, [apiFetch]);

  // ── Conversations ─────────────────────────────────────────────────────
  useEffect(() => {
    apiFetch("/api/conversations")
      .then((d) => setConversations(d.conversations))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (conversations.length > 0 && !activeId) setActiveId(conversations[0].id);
  }, [conversations]);

  useEffect(() => {
    setMessages([]);
    if (!activeId) return;
    apiFetch(`/api/conversations/${activeId}/messages`)
      .then((d) => setMessages(d.messages))
      .catch(() => {});
  }, [activeId]);

  // ── Audio stop on conversation switch ────────────────────────────────
  useEffect(() => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    setSpeakingId(null);
  }, [activeId]);

  // ── Scroll to bottom on new messages ─────────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    setShowScrollBtn(false);
  }, [messages, loading]);

  // ── Textarea auto-resize ──────────────────────────────────────────────
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }, [input]);

  function handleScroll(e) {
    const el = e.currentTarget;
    setShowScrollBtn(el.scrollHeight - el.scrollTop - el.clientHeight > 120);
  }

  // ── Conversation CRUD ─────────────────────────────────────────────────
  async function newConversation() {
    try {
      const conv = await apiFetch("/api/conversations", { method: "POST" });
      setConversations((p) => [conv, ...p]);
      setActiveId(conv.id);
      setMessages([]);
    } catch {}
  }

  async function deleteConversation(id) {
    try {
      await apiFetch(`/api/conversations/${id}`, { method: "DELETE" });
      setConversations((p) => p.filter((c) => c.id !== id));
      if (activeId === id) { setActiveId(null); setMessages([]); }
    } catch {}
    setConfirmDelete(null);
  }

  async function saveRename(id) {
    if (editTitle.trim()) {
      try {
        await apiFetch(`/api/conversations/${id}`, {
          method: "PATCH",
          body: JSON.stringify({ title: editTitle.trim() }),
        });
        setConversations((p) => p.map((c) => (c.id === id ? { ...c, title: editTitle.trim() } : c)));
      } catch {}
    }
    setEditingId(null); setEditTitle("");
  }

  // ── Send message ──────────────────────────────────────────────────────
  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || loading || !activeId) return;
    setInput(""); setLoading(true);
    const isFirst = messages.length === 0;
    const tempId  = `temp-${Date.now()}`;
    setMessages((p) => [...p, { id: tempId, role: "user", text, timestamp: Date.now() }]);

    try {
      const data = await apiFetch("/api/chat", {
        method: "POST",
        body: JSON.stringify({ conversationId: activeId, message: text, history: messages.slice(-10) }),
      });
      setMessages((p) => [
        ...p.filter((m) => m.id !== tempId),
        { id: data.userMsgId, role: "user", text, timestamp: Date.now() },
        { id: data.botMsgId, role: "assistant", text: data.reply, timestamp: Date.now() },
      ]);
      setConversations((p) =>
        p.map((c) => (c.id === activeId ? { ...c, updated_at: Date.now() } : c))
      );
      if (isFirst) {
        apiFetch("/api/title", {
          method: "POST",
          body: JSON.stringify({ message: text, conversationId: activeId }),
        })
          .then((d) => {
            if (d.title)
              setConversations((p) => p.map((c) => (c.id === activeId ? { ...c, title: d.title } : c)));
          })
          .catch(() => {});
      }
    } catch (err) {
      setMessages((p) => [
        ...p.filter((m) => m.id !== tempId),
        { id: `err-${Date.now()}`, role: "assistant", text: `⚠️ ${err.message}`, timestamp: Date.now() },
      ]);
    } finally {
      setLoading(false);
      textareaRef.current?.focus();
    }
  }, [input, loading, activeId, messages, apiFetch]);

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  // ── TTS ───────────────────────────────────────────────────────────────
  const handleSpeak = useCallback(async (text, msgId) => {
    if (audioRef.current) {
      audioRef.current.pause(); audioRef.current = null;
      if (speakingId === msgId) { setSpeakingId(null); return; }
    }
    setSpeakingId(msgId);
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          voiceId:        ttsSettings.ttsVoiceId,
          modelId:        ttsSettings.ttsModelId,
          stability:      ttsSettings.ttsStability,
          similarityBoost:ttsSettings.ttsSimilarity,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.play();
      audio.onended = () => { URL.revokeObjectURL(url); setSpeakingId(null); audioRef.current = null; };
    } catch (err) {
      console.error("TTS:", err.message); setSpeakingId(null);
    }
  }, [speakingId, ttsSettings]);

  // ── Clear chat ────────────────────────────────────────────────────────
  async function clearChat() {
    if (!activeId) return;
    const conv = conversations.find((c) => c.id === activeId);
    try {
      await apiFetch(`/api/conversations/${activeId}`, { method: "DELETE" });
      const newConv = await apiFetch("/api/conversations", { method: "POST" });
      if (conv) {
        await apiFetch(`/api/conversations/${newConv.id}`, {
          method: "PATCH", body: JSON.stringify({ title: conv.title }),
        });
        newConv.title = conv.title;
      }
      setConversations((p) => [newConv, ...p.filter((c) => c.id !== activeId)]);
      setActiveId(newConv.id); setMessages([]);
    } catch {}
  }

  const isEmpty       = messages.length === 0;
  const grouped       = groupConvs(conversations);
  const userInitials  = getInitials(user?.name);
  const activeTitle   = conversations.find((c) => c.id === activeId)?.title;

  return (
    <div className="app">

      {/* ── Sidebar ────────────────────────────────────────────────────── */}
      <aside className={`sidebar${sidebarOpen ? "" : " closed"}`}>

        {/* Header */}
        <div className="sidebar-top">
          <div className="sidebar-brand">
            <span className="brand-symbol">✦</span>
            <span className="brand-name">{instanceName}</span>
          </div>
          <button className="icon-btn sidebar-toggle" onClick={() => setSidebarOpen(false)} title="Collapse">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor">
              <path fillRule="evenodd" d="M11.354 1.646a.5.5 0 0 1 0 .708L5.707 8l5.647 5.646a.5.5 0 0 1-.708.708l-6-6a.5.5 0 0 1 0-.708l6-6a.5.5 0 0 1 .708 0z"/>
            </svg>
          </button>
        </div>

        {/* New Chat */}
        <div className="sidebar-new-chat">
          <button className="new-chat-full-btn" onClick={newConversation}>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 4a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3v3a.5.5 0 0 1-1 0v-3h-3a.5.5 0 0 1 0-1h3v-3A.5.5 0 0 1 8 4z"/>
            </svg>
            New Chat
          </button>
        </div>

        {/* Conversation list grouped by date */}
        <div className="conv-list">
          {grouped.length === 0 && <p className="conv-empty">No conversations yet</p>}
          {grouped.map(([label, convs]) => (
            <div key={label} className="conv-group">
              <div className="group-label">{label}</div>
              {convs.map((conv) => (
                <div
                  key={conv.id}
                  className={`conv-item${conv.id === activeId ? " active" : ""}`}
                  onClick={() => { if (editingId !== conv.id && !confirmDelete) setActiveId(conv.id); }}
                >
                  {editingId === conv.id ? (
                    <input
                      className="rename-input"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      onBlur={() => saveRename(conv.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveRename(conv.id);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      autoFocus
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span className="conv-title">{conv.title}</span>
                  )}
                  <div className="conv-actions" onClick={(e) => e.stopPropagation()}>
                    <button className="icon-btn" title="Rename"
                      onClick={() => { setEditingId(conv.id); setEditTitle(conv.title); }}>
                      <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M12.854.146a.5.5 0 0 0-.707 0L10.5 1.793 14.207 5.5l1.647-1.646a.5.5 0 0 0 0-.708l-3-3zm.646 6.061L9.793 2.5 3.293 9H3.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.207l6.5-6.5zm-7.468 7.468A.5.5 0 0 1 6 13.5V13h-.5a.5.5 0 0 1-.5-.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.5-.5V10h-.5a.499.499 0 0 1-.175-.032l-.179.178a.5.5 0 0 0-.11.168l-2 5a.5.5 0 0 0 .65.65l5-2a.5.5 0 0 0 .168-.11l.178-.178z"/>
                      </svg>
                    </button>
                    <button className="icon-btn danger" title="Delete"
                      onClick={() => setConfirmDelete(conv.id)}>
                      <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/>
                        <path fillRule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/>
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* User footer */}
        <div className="sidebar-bottom">
          <div className="sidebar-user-row">
            <div className="user-avatar">{userInitials}</div>
            <div className="user-info">
              <span className="user-name">{user?.name ?? user?.email}</span>
              <span className="user-email">{user?.email}</span>
            </div>
            <button className="icon-btn" onClick={logout} title="Sign out">
              <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor">
                <path fillRule="evenodd" d="M10 12.5a.5.5 0 0 1-.5.5h-8a.5.5 0 0 1-.5-.5v-9a.5.5 0 0 1 .5-.5h8a.5.5 0 0 1 .5.5v2a.5.5 0 0 0 1 0v-2A1.5 1.5 0 0 0 9.5 2h-8A1.5 1.5 0 0 0 0 3.5v9A1.5 1.5 0 0 0 1.5 14h8a1.5 1.5 0 0 0 1.5-1.5v-2a.5.5 0 0 0-1 0v2z"/>
                <path fillRule="evenodd" d="M15.854 8.354a.5.5 0 0 0 0-.708l-3-3a.5.5 0 0 0-.708.708L14.293 7.5H5.5a.5.5 0 0 0 0 1h8.793l-2.147 2.146a.5.5 0 0 0 .708.708l3-3z"/>
              </svg>
            </button>
          </div>
        </div>
      </aside>

      {/* ── Main chat ──────────────────────────────────────────────────── */}
      <div className="chat">

        {/* Topbar */}
        <div className="chat-topbar">
          {!sidebarOpen && (
            <button className="icon-btn sidebar-toggle" onClick={() => setSidebarOpen(true)} title="Open sidebar">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path fillRule="evenodd" d="M2.5 12a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5zm0-4a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5zm0-4a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5z"/>
              </svg>
            </button>
          )}

          <span className="chat-title">
            {activeTitle ?? (activeId ? "New Chat" : instanceName)}
          </span>

          <div className="topbar-badges">
            {botSettings.model && <span className="model-badge">{modelLabel(botSettings.model)}</span>}
            {botSettings.style && <span className="style-badge">{botSettings.style}</span>}
          </div>

          {activeId && messages.length > 0 && (
            <button className="icon-btn" onClick={clearChat} title="Clear chat">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                <path d="M2.5 1a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1H3v9a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V4h.5a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H10a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1H2.5zm3 4a.5.5 0 0 1 .5.5v7a.5.5 0 0 1-1 0v-7a.5.5 0 0 1 .5-.5zM8 5a.5.5 0 0 1 .5.5v7a.5.5 0 0 1-1 0v-7A.5.5 0 0 1 8 5zm3 .5v7a.5.5 0 0 1-1 0v-7a.5.5 0 0 1 1 0z"/>
              </svg>
            </button>
          )}
        </div>

        {/* Messages */}
        <div className="chat-messages" onScroll={handleScroll}>
          {!activeId ? (
            <div className="empty-state">
              <div className="empty-logo">✦</div>
              <h2>Welcome back, {user?.name?.split(" ")[0] ?? "there"}!</h2>
              <p>Select a conversation or start a new one.</p>
              <button className="new-chat-cta" onClick={newConversation}>
                <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 4a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3v3a.5.5 0 0 1-1 0v-3h-3a.5.5 0 0 1 0-1h3v-3A.5.5 0 0 1 8 4z"/>
                </svg>
                Start new chat
              </button>
            </div>
          ) : isEmpty ? (
            <div className="empty-state">
              <div className="empty-logo">✦</div>
              <h2>How can I help?</h2>
              <p>Ask me anything from the knowledge base.</p>
              <div className="suggestion-chips">
                {SUGGESTIONS.map((s) => (
                  <button key={s} className="suggestion-chip" onClick={() => setInput(s)}>{s}</button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((msg) => (
              <Message
                key={msg.id}
                role={msg.role}
                text={msg.text}
                msgId={msg.id}
                timestamp={msg.timestamp}
                userInitials={userInitials}
                onSpeak={ttsSettings.ttsEnabled ? handleSpeak : null}
                isSpeaking={speakingId === msg.id}
              />
            ))
          )}

          {loading && (
            <div className="message-row assistant">
              <div className="avatar assistant-avatar">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09z"/>
                </svg>
              </div>
              <div className="bubble typing"><span /><span /><span /></div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Scroll-to-bottom button */}
        {showScrollBtn && (
          <button
            className="scroll-bottom-btn"
            onClick={() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); setShowScrollBtn(false); }}
            title="Scroll to latest"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path fillRule="evenodd" d="M8 4a.5.5 0 0 1 .5.5v5.793l2.146-2.147a.5.5 0 0 1 .708.708l-3 3a.5.5 0 0 1-.708 0l-3-3a.5.5 0 1 1 .708-.708L7.5 10.293V4.5A.5.5 0 0 1 8 4z"/>
            </svg>
          </button>
        )}

        {/* Input */}
        <div className="chat-input-area">
          <div className="input-box">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={activeId ? "Ask anything…" : "Start a new conversation first"}
              rows={1}
              disabled={loading || !activeId}
            />
            <button
              className="send-btn"
              onClick={sendMessage}
              disabled={loading || !input.trim() || !activeId}
              title="Send (Enter)"
            >
              {loading ? (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <circle cx="8" cy="8" r="6" opacity=".2"/>
                  <path d="M8 2a6 6 0 0 1 6 6" className="send-loading-arc"/>
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
                </svg>
              )}
            </button>
          </div>
          <p className="disclaimer">Answers are based solely on the knowledge base · Shift+Enter for new line</p>
        </div>
      </div>

      {/* Delete confirmation modal */}
      {confirmDelete && (
        <div className="modal-overlay" onClick={() => setConfirmDelete(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Delete conversation?</h3>
            <p>This action cannot be undone.</p>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button className="btn-danger" onClick={() => deleteConversation(confirmDelete)}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
