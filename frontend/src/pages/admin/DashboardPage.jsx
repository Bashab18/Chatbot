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

  const cards = stats
    ? [
        { label: "Total Users",  value: stats.totalUsers,           color: "accent", icon: "👥" },
        { label: "KB Documents", value: stats.kbDocs,               color: "green",  icon: "📄" },
        { label: "Avg Logins",   value: stats.avgLogins,            color: "mauve",  icon: "🔐" },
        { label: "Last Login",   value: timeAgo(stats.mostRecentLogin), color: "peach", icon: "🕐", small: true },
      ]
    : [];

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1>Dashboard</h1>
        <p>Overview of your chatbot system</p>
      </div>

      {loading ? (
        <div className="admin-loading"><div className="auth-spinner" /></div>
      ) : (
        <div className="stats-grid">
          {cards.map((c) => (
            <div key={c.label} className={`stat-card stat-${c.color}`}>
              <div className="stat-icon">{c.icon}</div>
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
