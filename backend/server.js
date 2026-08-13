require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { tokenize } = require("./rag/embed");
const { chunkText } = require("./rag/chunker");
const { load, save, addDocument, removeDocument, search } = require("./rag/store");
const db = require("./db");
const { hashPassword, checkPassword, signToken, requireAuth, requireAdmin } = require("./auth");

const app = express();
app.use(cors());
app.use(express.json());

// Ensure uploads directory exists before multer tries to write to it
fs.mkdirSync("uploads", { recursive: true });
const upload = multer({ dest: "uploads/", limits: { fileSize: 20 * 1024 * 1024 } });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);


let store = load();
// Drop documents whose chunks were discarded (old float-array embeddings from before BM25 migration)
const validDocIds = new Set(store.chunks.map((c) => c.docId));
const staleIds = store.documents.filter((d) => !validDocIds.has(d.id)).map((d) => d.id);
if (staleIds.length) {
  const { removeDocument } = require("./rag/store");
  for (const id of staleIds) removeDocument(store, id);
  console.log(`Cleaned up ${staleIds.length} stale document(s) with no valid chunks`);
}
console.log(`Vector store: ${store.documents.length} docs, ${store.chunks.length} chunks`);

function uid() { return crypto.randomUUID(); }

// ── Bot settings helpers ──────────────────────────────────────────────
const DEFAULT_BOT = {
  // AI
  model: "gemini-3-flash-preview",
  systemPrompt: "You are a friendly and supportive fitness assistant designed specifically for older adults. You provide safe, practical guidance on exercise, physical activity, balance, flexibility, nutrition, and healthy ageing. Always use clear, simple language. Encourage users to stay active while reminding them to consult their doctor or physiotherapist before starting new exercises, especially if they have health conditions.",
  style: "balanced",   // precise | balanced | creative
  // RAG
  ragTopK: 5,
  ragMinScore: 0,
  refusalMessage: "I'm sorry, I don't have information about that in my knowledge base.",
  // Knowledge source weights (0-100, independent)
  ragWeight: 100,   // use knowledge base documents
  ownKnowledgeWeight: 0,     // allow AI own training knowledge
  webSearchWeight: 0,     // enable live web search (Google Search grounding)
  // Appearance
  theme: "dark",
  // TTS (ElevenLabs)
  ttsEnabled: true,
  ttsVoiceId: "21m00Tcm4TlvDq8ikWAM",
  ttsModelId: "eleven_turbo_v2_5",
  ttsStability: 0.5,
  ttsSimilarity: 0.75,
};

function getBotSettings() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'chatbot'").get();
  if (!row) return DEFAULT_BOT;
  try {
    const saved = JSON.parse(row.value);
    // Gemma 3 is not available on the standard API key; fall back to default
    if (saved.model && /^gemma-3/.test(saved.model)) saved.model = DEFAULT_BOT.model;
    // ElevenLabs retired these TTS models -- every synthesis call using them
    // 400s, silently breaking voice for everyone until an admin notices.
    if (saved.ttsModelId && ["eleven_monolingual_v1", "eleven_multilingual_v1"].includes(saved.ttsModelId)) {
      saved.ttsModelId = DEFAULT_BOT.ttsModelId;
    }
    return { ...DEFAULT_BOT, ...saved };
  } catch { return DEFAULT_BOT; }
}

function setBotSettings(data) {
  const current = getBotSettings();
  const updated = { ...current, ...data };
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('chatbot', ?)").run(
    JSON.stringify(updated)
  );
}

// ══════════════════════════════════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════════════════════════════════

app.post("/api/auth/signup", (req, res) => {
  const { email, password, name, role } = req.body;
  if (!email || !password || !name) return res.status(400).json({ error: "email, password and name are required" });
  if (!["user", "admin"].includes(role)) return res.status(400).json({ error: "role must be user or admin" });
  if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });

  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email.toLowerCase());
  if (existing) return res.status(409).json({ error: "An account with this email already exists" });

  const user = {
    id: uid(),
    email: email.toLowerCase(),
    name: name.trim(),
    role,
    password_hash: hashPassword(password),
    login_count: 0,
    last_login: null,
    note: "",
    created_at: Date.now(),
  };

  db.prepare(
    "INSERT INTO users (id, email, name, role, password_hash, login_count, last_login, note, created_at) VALUES (?,?,?,?,?,?,?,?,?)"
  ).run(user.id, user.email, user.name, user.role, user.password_hash, 0, null, "", user.created_at);

  const token = signToken(user);
  res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
});

app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "email and password are required" });

  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email.toLowerCase());
  if (!user || !checkPassword(password, user.password_hash)) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  db.prepare("UPDATE users SET login_count = login_count + 1, last_login = ? WHERE id = ?")
    .run(Date.now(), user.id);

  const token = signToken(user);
  res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
});

app.get("/api/auth/me", requireAuth, (req, res) => {
  const user = db.prepare("SELECT id, email, name, role FROM users WHERE id = ?").get(req.user.uid);
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json({ user });
});

// Trusted-device login for the companion mHealth app: it already knows who
// the user is (its own local account), so instead of showing our login
// form again it calls this with a shared device secret to get a real JWT.
// No password involved — the secret only proves the request came from our
// own app, not from an arbitrary browser.
app.post("/api/auth/device-login", (req, res) => {
  if (!process.env.DEVICE_SSO_SECRET) {
    return res.status(503).json({ error: "Device SSO not configured" });
  }
  const { deviceSecret, email, name } = req.body;
  if (deviceSecret !== process.env.DEVICE_SSO_SECRET) {
    return res.status(401).json({ error: "Invalid device credential" });
  }
  if (!email || !name) return res.status(400).json({ error: "email and name are required" });

  let user = db.prepare("SELECT * FROM users WHERE email = ?").get(email.toLowerCase());
  if (!user) {
    user = {
      id: uid(),
      email: email.toLowerCase(),
      name: name.trim(),
      role: "user",
      // Random, never handed out — this account is only ever reached via
      // the device-login handshake above, not the password login form.
      password_hash: hashPassword(crypto.randomUUID()),
      login_count: 0,
      last_login: null,
      note: "Provisioned via mHealth app device SSO",
      created_at: Date.now(),
    };
    db.prepare(
      "INSERT INTO users (id, email, name, role, password_hash, login_count, last_login, note, created_at) VALUES (?,?,?,?,?,?,?,?,?)"
    ).run(user.id, user.email, user.name, user.role, user.password_hash, 0, null, user.note, user.created_at);
  }

  db.prepare("UPDATE users SET login_count = login_count + 1, last_login = ? WHERE id = ?")
    .run(Date.now(), user.id);

  const token = signToken(user);
  res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
});

// ══════════════════════════════════════════════════════════════════════
// CONVERSATIONS
// ══════════════════════════════════════════════════════════════════════

app.get("/api/conversations", requireAuth, (req, res) => {
  const rows = db.prepare(
    "SELECT id, title, created_at, updated_at FROM conversations WHERE user_id = ? ORDER BY updated_at DESC"
  ).all(req.user.uid);
  res.json({ conversations: rows });
});

app.post("/api/conversations", requireAuth, (req, res) => {
  const now = Date.now();
  const conv = { id: uid(), user_id: req.user.uid, title: "New Chat", created_at: now, updated_at: now };
  db.prepare("INSERT INTO conversations (id, user_id, title, created_at, updated_at) VALUES (?,?,?,?,?)")
    .run(conv.id, conv.user_id, conv.title, conv.created_at, conv.updated_at);
  res.json(conv);
});

app.patch("/api/conversations/:id", requireAuth, (req, res) => {
  const { title } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: "title is required" });
  const info = db.prepare(
    "UPDATE conversations SET title = ? WHERE id = ? AND user_id = ?"
  ).run(title.trim(), req.params.id, req.user.uid);
  if (!info.changes) return res.status(404).json({ error: "Conversation not found" });
  res.json({ message: "Renamed" });
});

app.delete("/api/conversations/:id", requireAuth, (req, res) => {
  db.prepare("DELETE FROM conversations WHERE id = ? AND user_id = ?")
    .run(req.params.id, req.user.uid);
  res.json({ message: "Deleted" });
});

app.get("/api/conversations/:id/messages", requireAuth, (req, res) => {
  // Confirm the conversation belongs to this user
  const conv = db.prepare("SELECT id FROM conversations WHERE id = ? AND user_id = ?")
    .get(req.params.id, req.user.uid);
  if (!conv) return res.status(404).json({ error: "Conversation not found" });

  const rows = db.prepare(
    "SELECT id, role, text, timestamp, refs FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC"
  ).all(req.params.id);
  const msgs = rows.map((m) => ({ ...m, refs: m.refs ? JSON.parse(m.refs) : [] }));
  res.json({ messages: msgs });
});

// ══════════════════════════════════════════════════════════════════════
// USER PROFILE
// ══════════════════════════════════════════════════════════════════════

function getUserProfile(uid) {
  const row = db.prepare("SELECT profile FROM users WHERE id = ?").get(uid);
  try { return JSON.parse(row?.profile || "{}"); } catch { return {}; }
}

function setUserProfile(userId, profile) {
  db.prepare("UPDATE users SET profile = ? WHERE id = ?").run(JSON.stringify(profile), userId);
}

app.get("/api/user/profile", requireAuth, (req, res) => {
  const profile = getUserProfile(req.user.uid);
  const { googleFitTokens: _tokens, ...safe } = profile;
  res.json({ profile: safe });
});

app.put("/api/user/profile", requireAuth, (req, res) => {
  const ALLOWED = [
    "age", "gender", "height", "weight", "conditions", "medications", "goals", "allergies", "notes",
    // Per-user AI agent persona, set via the mHealth app's Settings > AI
    // Agent screen -- aiVoiceId is an ElevenLabs voice_id, not a display name.
    "aiName", "aiPersonality", "aiVoiceId",
  ];
  const profile = getUserProfile(req.user.uid);
  for (const k of ALLOWED) {
    if (req.body[k] !== undefined) {
      const v = String(req.body[k]).trim();
      if (v) profile[k] = v; else delete profile[k];
    }
  }
  setUserProfile(req.user.uid, profile);
  const { googleFitTokens: _tokens, ...safe } = profile;
  res.json({ profile: safe });
});

// Pushed from the mHealth mobile app -- its on-device Health Connect /
// HealthKit data and recent workout log, which (unlike Google Fit) this
// server can't reach on its own since it's local to the phone. Only sent
// when the user has "Share with paired coaches" enabled in the app.
app.put("/api/user/health-sync", requireAuth, (req, res) => {
  const { steps, activeCalories, latestHeartRate, restingHeartRate, sleepHoursLastNight, recentSessions } = req.body;
  const profile = getUserProfile(req.user.uid);

  profile.deviceHealth = {
    steps: Number.isFinite(steps) ? steps : undefined,
    activeCalories: Number.isFinite(activeCalories) ? activeCalories : undefined,
    latestHeartRate: Number.isFinite(latestHeartRate) ? latestHeartRate : undefined,
    restingHeartRate: Number.isFinite(restingHeartRate) ? restingHeartRate : undefined,
    sleepHoursLastNight: Number.isFinite(sleepHoursLastNight) ? sleepHoursLastNight : undefined,
    fetchedAt: Date.now(),
  };

  if (Array.isArray(recentSessions)) {
    profile.recentSessions = recentSessions.slice(0, 10).map((s) => ({
      name: typeof s.name === "string" ? s.name.slice(0, 80) : "Session",
      elapsedMin: Number.isFinite(s.elapsedMin) ? s.elapsedMin : 0,
      kcal: Number.isFinite(s.kcal) ? s.kcal : 0,
      savedAt: Number.isFinite(s.savedAt) ? s.savedAt : Date.now(),
    }));
  }

  setUserProfile(req.user.uid, profile);
  res.json({ message: "Synced" });
});

// ══════════════════════════════════════════════════════════════════════
// AI MEMORY
// ══════════════════════════════════════════════════════════════════════

function getMemories(userId) {
  const row = db.prepare("SELECT memories FROM users WHERE id = ?").get(userId);
  try { return JSON.parse(row?.memories || "[]"); } catch { return []; }
}

function saveMemories(userId, memories) {
  db.prepare("UPDATE users SET memories = ? WHERE id = ?").run(JSON.stringify(memories), userId);
}

// GET /api/user/memories
app.get("/api/user/memories", requireAuth, (req, res) => {
  res.json({ memories: getMemories(req.user.uid) });
});

// DELETE /api/user/memories/:id
app.delete("/api/user/memories/:id", requireAuth, (req, res) => {
  const memories = getMemories(req.user.uid).filter((m) => m.id !== req.params.id);
  saveMemories(req.user.uid, memories);
  res.json({ memories });
});

// POST /api/user/memories/extract  — analyse recent chat history with Gemini
app.post("/api/user/memories/extract", requireAuth, async (req, res) => {
  try {
    // Collect up to 150 recent messages from all of the user's conversations
    const rows = db.prepare(`
      SELECT m.role, m.text
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE c.user_id = ?
      ORDER BY m.timestamp DESC
      LIMIT 150
    `).all(req.user.uid);

    if (rows.length === 0) {
      return res.json({ memories: getMemories(req.user.uid), extracted: 0 });
    }

    // Reverse so chronological order; cap transcript at 6000 chars to stay
    // within token limits (trim from the oldest end, keep most recent context)
    const fullTranscript = rows.reverse()
      .map((r) => `${r.role === "user" ? "User" : "Assistant"}: ${r.text}`)
      .join("\n");
    const transcript = fullTranscript.length > 6000
      ? "...[earlier messages omitted]...\n" + fullTranscript.slice(-6000)
      : fullTranscript;

    const extractionPrompt = `You are analysing a fitness chatbot conversation to extract personalised facts about the user.

Extract ONLY concrete facts about the user that would help a fitness assistant personalise future responses:
- Health conditions, injuries, limitations, or pain points
- Exercise preferences, routines, or activities they enjoy or avoid
- Dietary preferences, restrictions, or habits
- Personal goals or motivations
- Progress or milestones they mentioned
- Lifestyle details (sleep, stress, work schedule, equipment available)

Rules:
- Each fact must be a short standalone sentence (max 15 words)
- Only facts ABOUT the user — not generic advice the assistant gave
- Ignore greetings, thanks, or small talk
- Return at most 12 facts
- Return an empty array if no relevant facts exist
- Output: a JSON array of strings ONLY, e.g. ["fact one", "fact two"]

Conversation:
${transcript}`;

    const { model: botModel } = getBotSettings();
    // Gemma models don't support structured output — always use a Gemini model
    const safeModel = botModel.startsWith("gemma-") ? "gemini-1.5-flash" : botModel;

    // Force valid JSON output so we never get markdown fences or prose
    const aiModel = genAI.getGenerativeModel({
      model: safeModel,
      generationConfig: { responseMimeType: "application/json" },
    });

    const result = await aiModel.generateContent(extractionPrompt);
    const raw = result.response.text().trim();

    // Parse with multiple fallback strategies
    let extracted = null;

    // Strategy 1 — direct parse (works when responseMimeType forces clean JSON)
    try { extracted = JSON.parse(raw); } catch { /* try next */ }

    // Strategy 2 — strip markdown fences then parse
    if (extracted === null) {
      const stripped = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
      try { extracted = JSON.parse(stripped); } catch { /* try next */ }
    }

    // Strategy 3 — find the first JSON array anywhere in the text
    if (extracted === null) {
      const match = raw.match(/\[[\s\S]*?\]/);
      if (match) try { extracted = JSON.parse(match[0]); } catch { /* fall through */ }
    }

    // If model returned {"facts":[...]} or similar object, unwrap it
    if (extracted !== null && !Array.isArray(extracted)) {
      extracted = extracted.facts || extracted.memories || extracted.items
        || extracted.results || Object.values(extracted).find(Array.isArray)
        || [];
    }

    if (!Array.isArray(extracted)) {
      return res.status(500).json({ error: "Could not parse AI response. Please try again." });
    }

    // Merge with existing memories — skip near-duplicates (same first 40 chars)
    const existing = getMemories(req.user.uid);
    const existingKeys = new Set(existing.map((m) => m.text.slice(0, 40).toLowerCase()));
    const newMemories = extracted
      .filter((t) => typeof t === "string" && t.trim().length > 0)
      .filter((t) => !existingKeys.has(t.trim().slice(0, 40).toLowerCase()))
      .map((t) => ({ id: uid(), text: t.trim(), source: "auto", createdAt: Date.now() }));

    const merged = [...existing, ...newMemories];
    saveMemories(req.user.uid, merged);
    res.json({ memories: merged, extracted: newMemories.length });
  } catch (err) {
    console.error("Memory extraction error:", err.message);
    res.status(500).json({ error: err.message || "Memory extraction failed" });
  }
});

// ══════════════════════════════════════════════════════════════════════
// GOOGLE FIT INTEGRATION
// ══════════════════════════════════════════════════════════════════════

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const FITNESS_API_URL = "https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate";
const FITNESS_SCOPES = [
  "https://www.googleapis.com/auth/fitness.activity.read",
  "https://www.googleapis.com/auth/fitness.body.read",
  "https://www.googleapis.com/auth/fitness.heart_rate.read",
].join(" ");

async function refreshFitnessToken(tokens) {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    refresh_token: tokens.refresh_token,
    grant_type: "refresh_token",
  });
  const r = await fetch(GOOGLE_TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: params.toString() });
  const data = await r.json();
  if (data.error) throw new Error(`Token refresh: ${data.error_description || data.error}`);
  return { ...tokens, access_token: data.access_token, expires_at: Date.now() + data.expires_in * 1000 };
}

async function getValidFitnessToken(tokens) {
  if (tokens.expires_at && Date.now() < tokens.expires_at - 60_000) return tokens;
  return refreshFitnessToken(tokens);
}

async function fetchFitnessData(accessToken) {
  const now = Date.now();
  const sevenDaysAgo = now - 7 * 86_400_000;
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);

  const body = {
    aggregateBy: [
      { dataTypeName: "com.google.step_count.delta" },
      { dataTypeName: "com.google.heart_rate.bpm" },
      { dataTypeName: "com.google.weight" },
    ],
    bucketByTime: { durationMillis: 86_400_000 },
    startTimeMillis: sevenDaysAgo,
    endTimeMillis: now,
  };

  const r = await fetch(FITNESS_API_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e?.error?.message || `Fitness API ${r.status}`);
  }

  const data = await r.json();
  let todaySteps = 0; const heartRates = []; let weight = null;

  for (const bucket of (data.bucket || [])) {
    const bucketStart = parseInt(bucket.startTimeMillis, 10);
    const isToday = bucketStart >= startOfDay.getTime();
    for (const dataset of (bucket.dataset || [])) {
      for (const point of (dataset.point || [])) {
        const id = dataset.dataSourceId || "";
        if (id.includes("step_count") && isToday) todaySteps += (point.value?.[0]?.intVal || 0);
        if (id.includes("heart_rate")) { const hr = point.value?.[0]?.fpVal; if (hr) heartRates.push(hr); }
        if (id.includes("weight")) { const w = point.value?.[0]?.fpVal; if (w) weight = w; }
      }
    }
  }

  const avgHeartRate = heartRates.length ? Math.round(heartRates.reduce((a, b) => a + b, 0) / heartRates.length) : null;
  return { todaySteps, avgHeartRate, weight: weight ? parseFloat(weight.toFixed(1)) : null };
}

// ── Fitness routes ────────────────────────────────────────────────────

app.get("/api/fitness/auth-url", requireAuth, (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_REDIRECT_URI) {
    return res.status(503).json({ error: "Google Fit not configured (set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI)" });
  }
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: process.env.GOOGLE_REDIRECT_URI,
    response_type: "code",
    scope: FITNESS_SCOPES,
    access_type: "offline",
    prompt: "consent",
    state: Buffer.from(req.user.uid).toString("base64"),
  });
  res.json({ url: `${GOOGLE_AUTH_URL}?${params}` });
});

app.get("/api/fitness/callback", async (req, res) => {
  const { code, state, error } = req.query;
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";

  if (error) return res.redirect(`${frontendUrl}/profile?fit_error=${encodeURIComponent(error)}`);
  if (!code || !state) return res.redirect(`${frontendUrl}/profile?fit_error=missing_code`);

  let userId;
  try { userId = Buffer.from(state, "base64").toString("utf8"); } catch {
    return res.redirect(`${frontendUrl}/profile?fit_error=invalid_state`);
  }

  try {
    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: process.env.GOOGLE_REDIRECT_URI,
      code,
      grant_type: "authorization_code",
    });
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: params.toString() });
    const tokenData = await tokenRes.json();
    if (tokenData.error) throw new Error(tokenData.error_description || tokenData.error);

    const tokens = {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_at: Date.now() + tokenData.expires_in * 1000,
    };

    const profile = getUserProfile(userId);
    profile.googleFitTokens = tokens;
    try {
      profile.fitnessSnapshot = await fetchFitnessData(tokens.access_token);
      profile.fitnessFetchedAt = Date.now();
    } catch (e) { console.warn("Initial fitness fetch failed:", e.message); }

    setUserProfile(userId, profile);
    res.redirect(`${frontendUrl}/profile?fit_connected=1`);
  } catch (err) {
    console.error("Fitness callback error:", err.message);
    res.redirect(`${frontendUrl}/profile?fit_error=${encodeURIComponent(err.message)}`);
  }
});

app.get("/api/fitness/status", requireAuth, (req, res) => {
  const profile = getUserProfile(req.user.uid);
  const connected = !!(profile.googleFitTokens?.refresh_token);
  res.json({ connected, snapshot: profile.fitnessSnapshot || null, fetchedAt: profile.fitnessFetchedAt || null });
});

app.post("/api/fitness/refresh", requireAuth, async (req, res) => {
  const profile = getUserProfile(req.user.uid);
  if (!profile.googleFitTokens?.refresh_token) return res.status(400).json({ error: "Google Fit not connected" });
  try {
    const tokens = await getValidFitnessToken(profile.googleFitTokens);
    const fresh = await refreshFitnessToken(tokens);
    const fitData = await fetchFitnessData(fresh.access_token);
    profile.googleFitTokens = fresh;
    profile.fitnessSnapshot = fitData;
    profile.fitnessFetchedAt = Date.now();
    setUserProfile(req.user.uid, profile);
    res.json({ snapshot: fitData, fetchedAt: profile.fitnessFetchedAt });
  } catch (err) {
    console.error("Fitness refresh error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/fitness/disconnect", requireAuth, (req, res) => {
  const profile = getUserProfile(req.user.uid);
  delete profile.googleFitTokens;
  delete profile.fitnessSnapshot;
  delete profile.fitnessFetchedAt;
  setUserProfile(req.user.uid, profile);
  res.json({ message: "Disconnected" });
});

// ══════════════════════════════════════════════════════════════════════
// CHAT
// ══════════════════════════════════════════════════════════════════════

app.post("/api/chat", requireAuth, async (req, res) => {
  const { conversationId, message, history = [] } = req.body;
  if (!conversationId || !message) return res.status(400).json({ error: "conversationId and message are required" });

  // Verify ownership
  const conv = db.prepare("SELECT id FROM conversations WHERE id = ? AND user_id = ?")
    .get(conversationId, req.user.uid);
  if (!conv) return res.status(404).json({ error: "Conversation not found" });

  // Save user message
  const userMsgId = uid();
  const now = Date.now();
  db.prepare("INSERT INTO messages (id, conversation_id, role, text, timestamp) VALUES (?,?,?,?,?)")
    .run(userMsgId, conversationId, "user", message, now);
  db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(now, conversationId);

  const { model, systemPrompt, style, ragTopK, ragMinScore, refusalMessage,
    ragWeight, ownKnowledgeWeight, webSearchWeight } = getBotSettings();
  const STYLE_TEMP = { precise: 0.2, balanced: 0.7, creative: 1.2 };
  const temperature = STYLE_TEMP[style] ?? 0.7;

  const useRAG = ragWeight > 0;
  const useOwnKnow = ownKnowledgeWeight > 0;
  const useWebSearch = webSearchWeight > 0;
  const strictKBOnly = useRAG && !useOwnKnow && !useWebSearch;

  // ── User profile context ──────────────────────────────────────────
  const userProfile = getUserProfile(req.user.uid);
  const profileLines = [
    userProfile.age && `Age: ${userProfile.age}`,
    userProfile.gender && `Gender: ${userProfile.gender}`,
    userProfile.height && `Height: ${userProfile.height}`,
    userProfile.weight && `Weight: ${userProfile.weight}`,
    userProfile.conditions && `Medical conditions: ${userProfile.conditions}`,
    userProfile.medications && `Current medications: ${userProfile.medications}`,
    userProfile.goals && `Health goals: ${userProfile.goals}`,
    userProfile.allergies && `Allergies: ${userProfile.allergies}`,
    userProfile.notes && `Additional notes: ${userProfile.notes}`,
  ].filter(Boolean);

  let profileSection = "";
  if (profileLines.length > 0) profileSection += `\n\nUser Profile:\n${profileLines.map((l) => `- ${l}`).join("\n")}`;

  // Inject AI memories
  const userMemories = getMemories(req.user.uid);
  if (userMemories.length > 0) {
    profileSection += `\n\nAI Memory (facts learned from past conversations):\n${userMemories.map((m) => `- ${m.text}`).join("\n")}`;
  }

  if (userProfile.fitnessSnapshot) {
    const { todaySteps, avgHeartRate, weight } = userProfile.fitnessSnapshot;
    const fitLines = [
      todaySteps && `Steps today: ${todaySteps.toLocaleString()}`,
      avgHeartRate && `Avg heart rate (7 d): ${avgHeartRate} bpm`,
      weight && `Weight: ${weight} kg`,
    ].filter(Boolean);
    if (fitLines.length > 0) profileSection += `\n\nRecent Fitness Data (Google Fit):\n${fitLines.map((l) => `- ${l}`).join("\n")}`;
  }

  // Synced from the mHealth app's on-device Health Connect / HealthKit data
  // (see PUT /api/user/health-sync) -- only present if the user opted in.
  if (userProfile.deviceHealth) {
    const { steps, activeCalories, latestHeartRate, restingHeartRate, sleepHoursLastNight } = userProfile.deviceHealth;
    const deviceLines = [
      steps && `Steps today: ${steps.toLocaleString()}`,
      activeCalories && `Active calories today: ${activeCalories}`,
      latestHeartRate && `Latest heart rate: ${latestHeartRate} bpm`,
      restingHeartRate && `Resting heart rate: ${restingHeartRate} bpm`,
      sleepHoursLastNight && `Sleep last night: ${sleepHoursLastNight} h`,
    ].filter(Boolean);
    if (deviceLines.length > 0) profileSection += `\n\nRecent Health Data (from phone):\n${deviceLines.map((l) => `- ${l}`).join("\n")}`;
  }

  if (userProfile.recentSessions?.length > 0) {
    const sessionLines = userProfile.recentSessions
      .slice(0, 5)
      .map((s) => `${s.name} — ${s.elapsedMin} min, ${s.kcal} kcal (${new Date(s.savedAt).toLocaleDateString()})`);
    profileSection += `\n\nRecent Workouts (from phone):\n${sessionLines.map((l) => `- ${l}`).join("\n")}`;
  }

  // ── KB retrieval ──────────────────────────────────────────────────
  let hits = [], refs = [];

  if (useRAG && store.chunks.length > 0) {
    const queryTokens = tokenize(message);
    hits = search(store, queryTokens, ragTopK, ragMinScore);
    refs = hits.map((h) => ({ name: h.docName, text: h.text.slice(0, 300) }));
  }

  // ── Early exits (strict KB-only with no results) ──────────────────
  // Skip early exits if the user has a profile — Gemini should always be able
  // to personalise responses using profile/memory context even when the KB is empty.
  const hasProfileContext = profileSection.trim().length > 0;

  if (strictKBOnly && store.chunks.length === 0 && !hasProfileContext) {
    const reply = "The knowledge base is empty. Please ask your administrator to upload documents.";
    const botMsgId = uid();
    db.prepare("INSERT INTO messages (id, conversation_id, role, text, timestamp) VALUES (?,?,?,?,?)").run(botMsgId, conversationId, "assistant", reply, Date.now());
    return res.json({ userMsgId, botMsgId, reply, refs: [] });
  }
  if (strictKBOnly && hits.length === 0 && !hasProfileContext) {
    const reply = refusalMessage;
    const botMsgId = uid();
    db.prepare("INSERT INTO messages (id, conversation_id, role, text, timestamp) VALUES (?,?,?,?,?)").run(botMsgId, conversationId, "assistant", reply, Date.now());
    return res.json({ userMsgId, botMsgId, reply, refs: [] });
  }

  // ── Build system prompt ───────────────────────────────────────────
  // Per-user persona overrides (name/personality), set via the mHealth
  // app's AI Agent settings and synced through PUT /api/user/profile --
  // takes priority over the admin's instance-wide persona below.
  let personaPrefix = "";
  if (userProfile.aiName) {
    personaPrefix += `You are named "${userProfile.aiName}". Introduce yourself by this name and refer to yourself by it throughout the conversation.\n`;
  }
  if (userProfile.aiPersonality) {
    personaPrefix += `Adopt a ${userProfile.aiPersonality.toLowerCase()} personality in how you communicate.\n`;
  }
  if (personaPrefix) personaPrefix += "\n";

  let fullSystem = personaPrefix + systemPrompt + profileSection;

  if (hits.length > 0) {
    const contextText = hits.map((h) => `[Source: ${h.docName}]\n${h.text}`).join("\n\n---\n\n");
    if (strictKBOnly) {
      fullSystem += `\n\nIMPORTANT: Only answer from the context below. If the question is not covered respond exactly: "${refusalMessage}"\n\n<context>\n${contextText}\n</context>`;
    } else {
      fullSystem += `\n\nUse the following knowledge base context when relevant:\n\n<context>\n${contextText}\n</context>`;
    }
  }

  // ── Call Gemini ───────────────────────────────────────────────────
  try {
    const isGemma = model.startsWith("gemma-");

    const geminiHistory = history.slice(-10).map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.text }],
    }));

    // Gemma models don't support systemInstruction — prepend as a
    // user/model exchange at the start of the history instead
    const historyWithSystem = isGemma && fullSystem
      ? [
        { role: "user",  parts: [{ text: fullSystem }] },
        { role: "model", parts: [{ text: "Understood. I will follow those instructions." }] },
        ...geminiHistory,
      ]
      : geminiHistory;

    const modelConfig = {
      model,
      generationConfig: { temperature },
    };
    if (!isGemma) modelConfig.systemInstruction = fullSystem;
    if (useWebSearch) modelConfig.tools = [{ googleSearch: {} }];

    const geminiModel = genAI.getGenerativeModel(modelConfig);
    const chat   = geminiModel.startChat({ history: historyWithSystem });
    const result = await chat.sendMessage(message);
    const reply  = result.response.text();

    // Extract web grounding sources
    if (useWebSearch) {
      const candidates = result.response.candidates || [];
      const gm = candidates[0]?.groundingMetadata;
      if (gm?.groundingChunks) {
        for (const chunk of gm.groundingChunks) {
          if (chunk.web?.uri) refs.push({ name: chunk.web.title || chunk.web.uri, text: chunk.web.uri, type: "web" });
        }
      }
    }

    const botMsgId = uid();
    const refsJson = refs.length > 0 ? JSON.stringify(refs) : null;
    db.prepare("INSERT INTO messages (id, conversation_id, role, text, timestamp, refs) VALUES (?,?,?,?,?,?)")
      .run(botMsgId, conversationId, "assistant", reply, Date.now(), refsJson);
    db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(Date.now(), conversationId);

    res.json({ userMsgId, botMsgId, reply, refs });
  } catch (err) {
    console.error("Gemini error:", err.message);
    let errMsg;
    if (err.message.includes("404") || err.message.toLowerCase().includes("not found")) {
      errMsg = `⚠️ Model "${model}" is not available with your API key. Please choose a different model in Admin → Bot Settings.`;
    } else {
      errMsg = `⚠️ ${err.message}`;
    }
    const botMsgId = uid();
    db.prepare("INSERT INTO messages (id, conversation_id, role, text, timestamp) VALUES (?,?,?,?,?)")
      .run(botMsgId, conversationId, "assistant", errMsg, Date.now());
    res.json({ userMsgId, botMsgId, reply: errMsg, refs: [] });
  }
});

// ── Auto-title ────────────────────────────────────────────────────────
app.post("/api/title", requireAuth, async (req, res) => {
  const { message, conversationId } = req.body;
  if (!message) return res.status(400).json({ error: "message is required" });
  try {
    const m = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const chat = m.startChat({ history: [] });
    const result = await chat.sendMessage(
      `Generate a concise 4-6 word title for a conversation that starts with this message. ` +
      `Reply with ONLY the title, no quotes or punctuation at the end:\n\n"${message}"`
    );
    const title = result.response.text().trim();
    if (conversationId) {
      db.prepare("UPDATE conversations SET title = ? WHERE id = ? AND user_id = ?")
        .run(title, conversationId, req.user.uid);
    }
    res.json({ title });
  } catch (err) {
    console.error("Title error:", err.message);
    res.status(500).json({ error: "Failed to generate title" });
  }
});

// ══════════════════════════════════════════════════════════════════════
// ADMIN
// ══════════════════════════════════════════════════════════════════════

app.get("/api/admin/stats", requireAdmin, (req, res) => {
  const users = db.prepare("SELECT login_count, last_login FROM users WHERE role = 'user'").all();
  const total = users.length;
  const totalLog = users.reduce((s, u) => s + (u.login_count || 0), 0);
  const avgLog = total ? (totalLog / total).toFixed(1) : 0;
  const lastLog = users.map((u) => u.last_login || 0).filter(Boolean);
  res.json({
    totalUsers: total,
    kbDocs: store.documents.length,
    avgLogins: parseFloat(avgLog),
    mostRecentLogin: lastLog.length ? Math.max(...lastLog) : null,
  });
});

app.get("/api/admin/recent-chats", requireAdmin, (req, res) => {
  const rows = db.prepare(
    "SELECT id, title, updated_at FROM conversations ORDER BY updated_at DESC LIMIT 10"
  ).all();
  res.json({ chats: rows });
});

// Public read-only settings used by the chat UI (theme, TTS defaults, etc.)
app.get("/api/settings", requireAuth, (req, res) => {
  const { model, style, theme, ttsEnabled, ttsVoiceId, ttsModelId, ttsStability, ttsSimilarity,
    ragWeight, ownKnowledgeWeight, webSearchWeight } = getBotSettings();
  res.json({
    model, style, theme, ttsEnabled, ttsVoiceId, ttsModelId, ttsStability, ttsSimilarity,
    ragWeight, ownKnowledgeWeight, webSearchWeight
  });
});

app.get("/api/admin/settings", requireAdmin, (req, res) => {
  res.json(getBotSettings());
});

app.put("/api/admin/settings", requireAdmin, (req, res) => {
  const b = req.body;
  const updates = {};

  // String fields
  for (const k of ["model", "systemPrompt", "style", "refusalMessage", "theme", "ttsVoiceId", "ttsModelId"]) {
    if (b[k] !== undefined) updates[k] = String(b[k]);
  }
  // Numeric fields
  for (const k of ["ragTopK", "ragMinScore", "ttsStability", "ttsSimilarity", "ragWeight", "ownKnowledgeWeight", "webSearchWeight"]) {
    if (b[k] !== undefined) {
      const n = parseFloat(b[k]);
      if (!isNaN(n)) updates[k] = n;
    }
  }
  // Boolean fields
  if (b.ttsEnabled !== undefined) {
    updates.ttsEnabled = b.ttsEnabled === true || b.ttsEnabled === "true";
  }

  try {
    setBotSettings(updates);
    const saved = getBotSettings();
    console.log("[settings] saved ttsEnabled=%s voiceId=%s", saved.ttsEnabled, saved.ttsVoiceId);
    res.json({ message: "Settings saved", settings: saved });
  } catch (err) {
    console.error("[settings] save error:", err.message);
    res.status(500).json({ error: "Failed to save settings: " + err.message });
  }
});

app.get("/api/admin/users", requireAdmin, (req, res) => {
  const users = db.prepare(
    "SELECT id, email, name, role, login_count, last_login, note, created_at FROM users WHERE role != 'admin'"
  ).all();
  res.json({ users });
});

// Full per-user detail for the admin Users page -- includes profile fields
// the user has filled in, their AI persona, and (if they opted in via the
// mHealth app's "Share with paired coaches" setting) the on-device Health
// Connect/HealthKit snapshot, recent workouts, and any Google Fit data.
app.get("/api/admin/users/:id", requireAdmin, (req, res) => {
  const row = db.prepare(
    "SELECT id, email, name, role, login_count, last_login, note, created_at, profile FROM users WHERE id = ?"
  ).get(req.params.id);
  if (!row) return res.status(404).json({ error: "User not found" });
  let parsed = {};
  try { parsed = JSON.parse(row.profile || "{}"); } catch { /* corrupt/empty -- treat as no profile */ }
  const { googleFitTokens: _tokens, ...profile } = parsed;
  const { profile: _raw, ...user } = row;
  res.json({ user, profile });
});

app.patch("/api/admin/users/:id", requireAdmin, (req, res) => {
  const { note } = req.body;
  if (note === undefined) return res.status(400).json({ error: "note is required" });
  db.prepare("UPDATE users SET note = ? WHERE id = ?").run(note, req.params.id);
  res.json({ message: "Updated" });
});

// Admin: all conversations (for chat history viewer)
app.get("/api/admin/conversations", requireAdmin, (req, res) => {
  const { userId } = req.query;
  const rows = userId
    ? db.prepare("SELECT id, title, updated_at FROM conversations WHERE user_id = ? ORDER BY updated_at DESC").all(userId)
    : db.prepare("SELECT id, title, updated_at FROM conversations ORDER BY updated_at DESC").all();
  res.json({ conversations: rows });
});

app.get("/api/admin/conversations/:id/messages", requireAdmin, (req, res) => {
  const rows = db.prepare(
    "SELECT id, role, text, timestamp, refs FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC"
  ).all(req.params.id);
  const msgs = rows.map((m) => ({ ...m, refs: m.refs ? JSON.parse(m.refs) : [] }));
  res.json({ messages: msgs });
});

// ══════════════════════════════════════════════════════════════════════
// KNOWLEDGE BASE (admin only)
// ══════════════════════════════════════════════════════════════════════

app.get("/api/documents", requireAdmin, (req, res) => {
  res.json({ documents: store.documents });
});

async function extractText(filePath, originalname) {
  const ext = path.extname(originalname).toLowerCase();
  if (ext === ".pdf") {
    const pdfParse = require("pdf-parse");
    const buffer = fs.readFileSync(filePath);
    let data;
    try {
      data = await pdfParse(buffer);
    } catch (err) {
      throw new Error(`PDF parse failed: ${err.message}`);
    }
    const text = (data.text || "").trim();
    if (!text) throw new Error("PDF has no extractable text — it may be a scanned image. Try copy-pasting the text using the text input instead.");
    return text;
  }
  return fs.readFileSync(filePath, "utf8");
}

function indexDocument(id, name, text) {
  const rawChunks = chunkText(text);
  if (rawChunks.length === 0) throw new Error("No text content found in file");
  console.log(`Indexing "${name}": ${rawChunks.length} chunks`);
  const chunks = rawChunks.map((t) => ({ text: t, tokens: tokenize(t) }));
  addDocument(store, { id, name, chunks });
  console.log(`Done: "${name}" (${chunks.length} chunks, ${chunks.reduce((s, c) => s + c.tokens.length, 0)} tokens)`);
}

// Handle multer errors (file too large, etc.) and return JSON instead of HTML
function uploadMiddleware(req, res, next) {
  upload.array("files", 20)(req, res, (err) => {
    if (!err) return next();
    const msg = err.code === "LIMIT_FILE_SIZE"
      ? `File too large (max 20 MB)`
      : err.message || "Upload error";
    res.status(400).json({ error: msg });
  });
}

app.post("/api/documents", requireAdmin, uploadMiddleware, async (req, res) => {
  const files = req.files;
  if (!files || files.length === 0) return res.status(400).json({ error: "No files uploaded" });
  const results = [];
  for (const file of files) {
    const { originalname, path: filePath } = file;
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    try {
      const text = await extractText(filePath, originalname);
      indexDocument(id, originalname, text);
      results.push({ id, name: originalname, ok: true });
    } catch (err) {
      console.error(`[upload] ${originalname}:`, err.message);
      results.push({ name: originalname, ok: false, error: err.message });
    } finally {
      fs.unlink(filePath, () => { });
    }
  }
  res.json({ results });
});

app.post("/api/documents/text", requireAdmin, async (req, res) => {
  const { name, content } = req.body;
  if (!name || !content) return res.status(400).json({ error: "name and content are required" });
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  try {
    indexDocument(id, name, content);
    res.json({ id, name, message: "Text indexed" });
  } catch (err) {
    console.error("Text indexing error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/documents/:id", requireAdmin, (req, res) => {
  removeDocument(store, req.params.id);
  save(store);
  res.json({ message: "Document removed" });
});

// ══════════════════════════════════════════════════════════════════════
// TTS
// ══════════════════════════════════════════════════════════════════════

const XI_BASE = "https://api.elevenlabs.io/v1";
const xiHeaders = () => ({ "xi-api-key": process.env.ELEVENLABS_API_KEY, "Content-Type": "application/json" });

app.get("/api/tts/voices", async (req, res) => {
  if (!process.env.ELEVENLABS_API_KEY) return res.status(400).json({ error: "ELEVENLABS_API_KEY not set" });
  try {
    const r = await fetch(`${XI_BASE}/voices`, { headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY } });
    const data = await r.json();
    res.json({ voices: (data.voices || []).map((v) => ({ voice_id: v.voice_id, name: v.name, category: v.category, labels: v.labels || {} })) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

function stripMarkdownForSpeech(text) {
  return text
    .replace(/#{1,6}\s/g, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/^[-•*]\s/gm, '')
    .replace(/^\d+\.\s/gm, '')
    .replace(/`{1,3}[^`]*`{1,3}/g, '')
    .replace(/\|/g, '')
    .replace(/\n{2,}/g, ' ')
    .trim();
}

app.post("/api/tts", async (req, res) => {
  if (!process.env.ELEVENLABS_API_KEY) return res.status(400).json({ error: "ELEVENLABS_API_KEY not set" });
  const { text, voiceId = "21m00Tcm4TlvDq8ikWAM", modelId = "eleven_turbo_v2_5", stability = 0.5, similarityBoost = 0.75 } = req.body;
  if (!text) return res.status(400).json({ error: "text is required" });
  const cleanText = stripMarkdownForSpeech(text); try {
    const r = await fetch(`${XI_BASE}/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: xiHeaders(),
      body: JSON.stringify({ text: cleanText, model_id: modelId, voice_settings: { stability, similarity_boost: similarityBoost } }),
    });
    if (!r.ok) { const e = await r.json().catch(() => ({})); return res.status(r.status).json({ error: e?.detail?.message || `ElevenLabs ${r.status}` }); }
    const buf = await r.arrayBuffer();
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Length", buf.byteLength);
    res.send(Buffer.from(buf));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Health ────────────────────────────────────────────────────────────
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", docs: store.documents.length, chunks: store.chunks.length });
});

// ── Instance info (name shown in admin UI) ────────────────────────────
app.get("/api/instance", (req, res) => {
  res.json({ name: process.env.INSTANCE_NAME || "CIRA" });
});

// ── Serve frontend build (self-contained mode) ────────────────────────
const FRONTEND_BUILD = path.join(__dirname, "../frontend/build");
if (fs.existsSync(FRONTEND_BUILD)) {
  app.use(express.static(FRONTEND_BUILD));
  app.get("*", (_req, res) => res.sendFile(path.join(FRONTEND_BUILD, "index.html")));
}

const PORT = process.env.PORT || 5000;
const INSTANCE_NAME = process.env.INSTANCE_NAME || "Chatbot";
app.listen(PORT, () =>
  console.log(`[${INSTANCE_NAME}] running on http://localhost:${PORT}`)
);
