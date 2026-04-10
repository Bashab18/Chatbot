import React, { useEffect, useState } from "react";
import { collection, onSnapshot, orderBy, query, limit } from "firebase/firestore";
import { db } from "../../firebase";
import { useAuth } from "../../context/AuthContext";

function timeAgo(ts) {
  if (!ts) return "Never";
  const diff = Date.now() - ts;
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
  const [stats, setStats] = useState(null);
  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchStats() {
      try {
        const token = await getToken();
        const res = await fetch("/api/admin/stats", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        setStats(data);
      } catch (err) {
        console.error("Stats error:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchStats();
  }, [getToken]);

  // Recent activity: listen to latest chats in Firestore
  useEffect(() => {
    const q = query(collection(db, "chats"), orderBy("updatedAt", "desc"), limit(10));
    return onSnapshot(q, (snap) => {
      setActivity(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
  }, []);

  const cards = stats
    ? [
        { label: "Total Users", value: stats.totalUsers, color: "accent",  icon: "👥" },
        { label: "KB Documents", value: stats.kbDocs,   color: "green",  icon: "📄" },
        { label: "Avg Logins",   value: stats.avgLogins, color: "mauve",  icon: "🔐" },
        {
          label:   "Last Login",
          value:   timeAgo(stats.mostRecentLogin),
          color:   "peach",
          icon:    "🕐",
          small:   true,
        },
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
                  <span className="activity-time">{timeAgo(chat.updatedAt)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
