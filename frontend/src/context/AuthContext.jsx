import React, { createContext, useContext, useEffect, useState } from "react";

const AuthContext = createContext(null);

const TOKEN_KEY = "chatbot_token";

// Safely parse JSON; throws a clean error if server is down / returning HTML
async function parseJSON(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    // Server returned non-JSON (HTML error page, 502, sleeping service, etc.)
    throw new Error(
      res.status >= 500
        ? "Server error — please try again in a moment"
        : res.status === 0 || text === ""
        ? "Could not reach the server"
        : "Unexpected server response — please try again"
    );
  }
}

export function AuthProvider({ children }) {
  const [user, setUser]     = useState(null);   // { id, email, name, role }
  const [loading, setLoading] = useState(true);

  // On mount: adopt an SSO token handed to us via ?ssoToken=... (the
  // companion mHealth app opens us with this after its own device-login
  // handshake), then validate whatever token we end up with in storage.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ssoToken = params.get("ssoToken");
    if (ssoToken) {
      localStorage.setItem(TOKEN_KEY, ssoToken);
      params.delete("ssoToken");
      const rest = params.toString();
      window.history.replaceState({}, "", window.location.pathname + (rest ? `?${rest}` : "") + window.location.hash);
    }

    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) { setLoading(false); return; }
    fetch("/api/auth/me", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => setUser(data.user))
      .catch(() => localStorage.removeItem(TOKEN_KEY))
      .finally(() => setLoading(false));
  }, []);

  async function signup(email, password, name, role) {
    const res  = await fetch("/api/auth/signup", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ email, password, name, role }),
    });
    const data = await parseJSON(res);
    if (!res.ok) throw new Error(data.error);
    localStorage.setItem(TOKEN_KEY, data.token);
    setUser(data.user);
    return data.user;
  }

  async function login(email, password) {
    const res  = await fetch("/api/auth/login", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ email, password }),
    });
    const data = await parseJSON(res);
    if (!res.ok) throw new Error(data.error);
    localStorage.setItem(TOKEN_KEY, data.token);
    setUser(data.user);
    return data.user;
  }

  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    setUser(null);
  }

  function getToken() {
    return localStorage.getItem(TOKEN_KEY);
  }

  return (
    <AuthContext.Provider value={{ user, loading, signup, login, logout, getToken }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
