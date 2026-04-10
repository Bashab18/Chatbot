import React, { useState, useEffect, useCallback } from "react";
import Sidebar from "./components/Sidebar";
import Chat from "./components/Chat";
import DocumentPanel from "./components/DocumentPanel";
import SettingsPanel from "./components/SettingsPanel";
import "./App.css";

const CONV_KEY     = "gemini_chatbot_v1";
const SETTINGS_KEY = "gemini_settings_v1";

const DEFAULT_SETTINGS = {
  model:        "gemini-1.5-flash",
  systemPrompt: "",
  style:        "balanced",
  theme:        "dark",
  ragTopK:      4,
  ragMinScore:  0.45,
};

function generateId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
function createConversation() {
  return { id: generateId(), title: "New Chat", messages: [], createdAt: Date.now() };
}

export default function App() {
  const [conversations, setConversations] = useState(() => {
    try {
      const s = localStorage.getItem(CONV_KEY);
      if (s) { const p = JSON.parse(s); if (Array.isArray(p) && p.length) return p; }
    } catch {}
    return [createConversation()];
  });

  const [activeId, setActiveId] = useState(() => conversations[0].id);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activePanel, setActivePanel] = useState(null); // null | "docs" | "settings"
  const [docCount, setDocCount] = useState(0);

  const [settings, setSettings] = useState(() => {
    try {
      const s = localStorage.getItem(SETTINGS_KEY);
      if (s) return { ...DEFAULT_SETTINGS, ...JSON.parse(s) };
    } catch {}
    return DEFAULT_SETTINGS;
  });

  // Apply theme to document
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", settings.theme);
  }, [settings.theme]);

  // Persist settings
  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [settings]);

  // Persist conversations
  useEffect(() => {
    localStorage.setItem(CONV_KEY, JSON.stringify(conversations));
  }, [conversations]);

  // Initial doc count
  useEffect(() => {
    fetch("/api/documents")
      .then((r) => r.json())
      .then((d) => setDocCount(d.documents?.length ?? 0))
      .catch(() => {});
  }, []);

  const activeConversation = conversations.find((c) => c.id === activeId);

  const handleNew = useCallback(() => {
    const conv = createConversation();
    setConversations((p) => [conv, ...p]);
    setActiveId(conv.id);
    setActivePanel(null);
  }, []);

  const handleDelete = useCallback((id) => {
    fetch(`/api/chat/${id}`, { method: "DELETE" }).catch(() => {});
    setConversations((prev) => {
      const filtered = prev.filter((c) => c.id !== id);
      if (!filtered.length) {
        const fresh = createConversation();
        setActiveId(fresh.id);
        return [fresh];
      }
      if (id === activeId) setActiveId(filtered[0].id);
      return filtered;
    });
  }, [activeId]);

  const handleRename = useCallback((id, title) => {
    setConversations((p) => p.map((c) => (c.id === id ? { ...c, title } : c)));
  }, []);

  const updateConversation = useCallback((id, updater) => {
    setConversations((p) => p.map((c) => (c.id === id ? updater(c) : c)));
  }, []);

  const togglePanel = (name) => setActivePanel((p) => (p === name ? null : name));

  return (
    <div className="app">
      <Sidebar
        conversations={conversations}
        activeId={activeId}
        onSelect={(id) => { setActiveId(id); setActivePanel(null); }}
        onNew={handleNew}
        onDelete={handleDelete}
        onRename={handleRename}
        open={sidebarOpen}
        onToggle={() => setSidebarOpen((v) => !v)}
        docCount={docCount}
        onOpenDocs={() => togglePanel("docs")}
        onOpenSettings={() => togglePanel("settings")}
        activePanel={activePanel}
      />

      <main className="main">
        {activePanel === "docs" && (
          <DocumentPanel
            onClose={() => setActivePanel(null)}
            onDocsChange={setDocCount}
          />
        )}
        {activePanel === "settings" && (
          <SettingsPanel
            settings={settings}
            onChange={setSettings}
            onClose={() => setActivePanel(null)}
          />
        )}
        {!activePanel && activeConversation && (
          <Chat
            key={activeId}
            conversation={activeConversation}
            onUpdate={updateConversation}
            onToggleSidebar={() => setSidebarOpen((v) => !v)}
            sidebarOpen={sidebarOpen}
            docCount={docCount}
            settings={settings}
          />
        )}
      </main>
    </div>
  );
}
