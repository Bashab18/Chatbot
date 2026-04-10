import React, { useState, useEffect, useRef } from "react";
import { useAuth } from "../../context/AuthContext";
import Message from "../../components/Message";

function timeAgo(ts) {
  if (!ts) return "";
  const diff  = Date.now() - ts;
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins < 1)   return "Just now";
  if (mins < 60)  return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 30)  return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

export default function ChatHistoryPage() {
  const { getToken } = useAuth();
  const [users, setUsers]           = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [chats, setChats]           = useState([]);
  const [selectedChat, setSelectedChat] = useState(null);
  const [messages, setMessages]     = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const bottomRef = useRef(null);

  // Load users
  useEffect(() => {
    const token = getToken();
    fetch("/api/admin/users", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => setUsers((d.users ?? []).filter((u) => u.role !== "admin")))
      .catch(() => {})
      .finally(() => setLoadingUsers(false));
  }, [getToken]);

  // Load chats for selected user
  useEffect(() => {
    setChats([]);
    setSelectedChat(null);
    setMessages([]);
    if (!selectedUser) return;
    const token = getToken();
    fetch(`/api/admin/conversations?userId=${selectedUser.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((d) => setChats(d.conversations ?? []))
      .catch(() => {});
  }, [selectedUser, getToken]);

  // Load messages for selected chat
  useEffect(() => {
    setMessages([]);
    if (!selectedChat) return;
    const token = getToken();
    fetch(`/api/admin/conversations/${selectedChat}/messages`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((d) => setMessages(d.messages ?? []))
      .catch(() => {});
  }, [selectedChat, getToken]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className="admin-page history-page">
      <div className="admin-page-header">
        <h1>Chat History</h1>
        <p>Browse conversations of any user</p>
      </div>

      <div className="history-layout">
        {/* User list */}
        <div className="history-users">
          <h3 className="history-panel-title">Users</h3>
          {loadingUsers ? (
            <div className="admin-loading"><div className="auth-spinner" /></div>
          ) : users.length === 0 ? (
            <p className="admin-empty" style={{ padding: "12px" }}>No users yet.</p>
          ) : (
            users.map((u) => (
              <button
                key={u.id}
                className={`history-user-item${selectedUser?.id === u.id ? " active" : ""}`}
                onClick={() => setSelectedUser(u)}
              >
                <div className="user-avatar-sm">{u.name?.[0]?.toUpperCase() ?? "?"}</div>
                <div className="history-user-info">
                  <span className="user-cell-name">{u.name ?? "Unknown"}</span>
                  <span className="user-cell-email">{u.email}</span>
                </div>
              </button>
            ))
          )}
        </div>

        {/* Chat list */}
        <div className="history-chats">
          <h3 className="history-panel-title">
            {selectedUser ? `${selectedUser.name}'s chats` : "Select a user"}
          </h3>
          {!selectedUser ? (
            <p className="admin-empty" style={{ padding: "12px" }}>Select a user to see their chats.</p>
          ) : chats.length === 0 ? (
            <p className="admin-empty" style={{ padding: "12px" }}>No conversations found.</p>
          ) : (
            chats.map((chat) => (
              <button
                key={chat.id}
                className={`history-chat-item${selectedChat === chat.id ? " active" : ""}`}
                onClick={() => setSelectedChat(chat.id)}
              >
                <span className="history-chat-title">{chat.title}</span>
                <span className="history-chat-time">{timeAgo(chat.updated_at)}</span>
              </button>
            ))
          )}
        </div>

        {/* Messages */}
        <div className="history-messages">
          {!selectedChat ? (
            <div className="history-placeholder">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="currentColor" opacity=".2">
                <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
              </svg>
              <p>Select a conversation to view messages</p>
            </div>
          ) : messages.length === 0 ? (
            <div className="history-placeholder"><p>No messages in this conversation.</p></div>
          ) : (
            <div className="history-msg-list">
              {messages.map((msg, i) => (
                <Message key={msg.id ?? i} role={msg.role} text={msg.text} msgId={msg.id ?? i} />
              ))}
              <div ref={bottomRef} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
