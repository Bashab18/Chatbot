import React, { useState, useEffect, useCallback } from "react";
import Sidebar from "./components/Sidebar";
import Chat from "./components/Chat";
import "./App.css";

const STORAGE_KEY = "gemini_chatbot_v1";

function generateId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function createConversation() {
  return { id: generateId(), title: "New Chat", messages: [], createdAt: Date.now() };
}

export default function App() {
  const [conversations, setConversations] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return [createConversation()];
  });

  const [activeId, setActiveId] = useState(() => conversations[0].id);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
  }, [conversations]);

  const activeConversation = conversations.find((c) => c.id === activeId);

  const handleNew = useCallback(() => {
    const conv = createConversation();
    setConversations((prev) => [conv, ...prev]);
    setActiveId(conv.id);
  }, []);

  const handleDelete = useCallback(
    (id) => {
      fetch(`/api/chat/${id}`, { method: "DELETE" }).catch(() => {});
      setConversations((prev) => {
        const filtered = prev.filter((c) => c.id !== id);
        if (filtered.length === 0) {
          const fresh = createConversation();
          setActiveId(fresh.id);
          return [fresh];
        }
        if (id === activeId) setActiveId(filtered[0].id);
        return filtered;
      });
    },
    [activeId]
  );

  const handleRename = useCallback((id, title) => {
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, title } : c))
    );
  }, []);

  const updateConversation = useCallback((id, updater) => {
    setConversations((prev) => prev.map((c) => (c.id === id ? updater(c) : c)));
  }, []);

  return (
    <div className={`app${sidebarOpen ? "" : " sidebar-closed"}`}>
      <Sidebar
        conversations={conversations}
        activeId={activeId}
        onSelect={setActiveId}
        onNew={handleNew}
        onDelete={handleDelete}
        onRename={handleRename}
        open={sidebarOpen}
        onToggle={() => setSidebarOpen((v) => !v)}
      />
      <main className="main">
        {activeConversation && (
          <Chat
            key={activeId}
            conversation={activeConversation}
            onUpdate={updateConversation}
            onToggleSidebar={() => setSidebarOpen((v) => !v)}
            sidebarOpen={sidebarOpen}
          />
        )}
      </main>
    </div>
  );
}
