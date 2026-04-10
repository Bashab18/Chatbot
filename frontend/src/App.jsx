import React, { useState, useCallback } from "react";
import Chat from "./components/Chat";

function generateSessionId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export default function App() {
  const [sessionId] = useState(generateSessionId);

  const clearChat = useCallback(() => {
    fetch(`/api/chat/${sessionId}`, { method: "DELETE" }).catch(() => {});
  }, [sessionId]);

  return (
    <div className="app">
      <header className="app-header">
        <h1>Gemini Chatbot</h1>
        <button className="clear-btn" onClick={clearChat}>
          New Chat
        </button>
      </header>
      <Chat sessionId={sessionId} />
    </div>
  );
}
