import React, { useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";

function timeAgo(ts) {
  if (!ts) return "Never";
  const diff  = Date.now() - ts;
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins < 1)   return "Just now";
  if (mins < 60)  return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

export default function DashboardPage() {
  const { getToken } = useAuth();
  const [stats, setStats]       = useState(null);
  const [activity, setActivity] = useState([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    async function load() {
      const token = getToken();
      const headers = { Authorization: `Bearer ${token}` };
      try {
        const [statsRes, chatsRes] = await Promise.all([
          fetch("/api/admin/stats",        { headers }),
          fetch("/api/admin/recent-chats", { headers }),
        ]);
        setStats(await statsRes.json());
        const chatData = await chatsRes.json();
        setActivity(chatData.chats ?? []);
      } catch {}
      setLoading(false);
    }
    load();
  }, [getToken]);

  const icons = {
    users: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
        <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>
      </svg>
    ),
    docs: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
        <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/>
      </svg>
    ),
    logins: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
        <path d="M11 7L9.6 8.4l2.6 2.6H2v2h10.2l-2.6 2.6L11 17l5-5-5-5zm9 12h-8v2h8c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-8v2h8v14z"/>
      </svg>
    ),
    clock: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
        <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7z"/>
      </svg>
    ),
  };

  const cards = stats
    ? [
        { label: "Total Users",  value: stats.totalUsers,               color: "accent", icon: icons.users },
        { label: "KB Documents", value: stats.kbDocs,                   color: "green",  icon: icons.docs  },
        { label: "Avg Logins",   value: stats.avgLogins,                color: "mauve",  icon: icons.logins },
        { label: "Last Login",   value: timeAgo(stats.mostRecentLogin), color: "peach",  icon: icons.clock, small: true },
      ]
    : [];

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1>Dashboard</h1>
        <p>System overview for your CIRA health assistant</p>
      </div>

      {loading ? (
        <div className="admin-loading"><div className="auth-spinner" /></div>
      ) : (
        <div className="stats-grid">
          {cards.map((c) => (
            <div key={c.label} className={`stat-card stat-${c.color}`}>
              <div className="stat-icon-wrap">{c.icon}</div>
              <div className="stat-body">
                <span className={`stat-value${c.small ? " stat-value-sm" : ""}`}>{c.value}</span>
                <span className="stat-label">{c.label}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="admin-section">
        <h2 className="section-title">Recent Activity</h2>
        {activity.length === 0 ? (
          <p className="admin-empty">No conversations yet.</p>
        ) : (
          <div className="activity-list">
            {activity.map((chat) => (
              <div key={chat.id} className="activity-item">
                <div className="activity-dot" />
                <div className="activity-body">
                  <span className="activity-title">{chat.title}</span>
                  <span className="activity-time">{timeAgo(chat.updated_at)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
