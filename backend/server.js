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
  model: "gemini-3.5-flash",
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
    // Model IDs not usable with this API key/account tier (verified against
    // live generateContent calls, not just the ListModels catalog -- some
    // listed models 404 with "no longer available to new users") -- fall
    // back rather than breaking every chat message until an admin notices.
    if (saved.model && [
      "gemini-3-pro-preview", "gemini-2.0-flash", "gemini-2.0-flash-lite",
      "gemini-1.5-flash", "gemini-1.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite",
    ].includes(saved.model)) {
      saved.model = DEFAULT_BOT.model;
    }
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
    // Agent screen -- aiVoiceId is an ElevenLabs voice_id, not a display
    // name; aiAvatar is one of the app's emoji avatar options, rendered in
    // place of the generic sparkle icon (see Message.jsx).
    "aiName", "aiPersonality", "aiVoiceId", "aiAvatar",
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

// Pushed from the mHealth mobile app -- its full on-device Health Connect /
// HealthKit snapshot (steps, heart rate incl. resting/peak/HRV, sleep incl.
// stage breakdown, heart-rate-zone minutes), recent workout log, connected
// devices, workout plans (built-in + custom), earned achievements, active
// challenges, and favorited exercises -- none of which this server can see
// on its own since it's local to the phone/its SQLite db. Only sent when
// the user has "Share with paired coaches" enabled in the app. Everything
// here also feeds the /api/chat system-prompt context below, so CIRA can
// actually reference it in conversation, not just display it in the admin
// panel.
app.put("/api/user/health-sync", requireAuth, (req, res) => {
  const {
    steps, activeCalories, latestHeartRate, restingHeartRate, peakHeartRate, hrvMs,
    sleepHoursLastNight, deepSleepHours, remSleepHours, lightSleepHours, heartZoneMinutes,
    recentSessions, connectedDevices, workoutPlans, achievements, challenges, favoriteExercises,
    exerciseLibrary,
  } = req.body;
  const profile = getUserProfile(req.user.uid);

  const num = (v) => (Number.isFinite(v) ? v : undefined);
  const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : undefined);

  profile.deviceHealth = {
    steps: num(steps),
    activeCalories: num(activeCalories),
    latestHeartRate: num(latestHeartRate),
    restingHeartRate: num(restingHeartRate),
    peakHeartRate: num(peakHeartRate),
    hrvMs: num(hrvMs),
    sleepHoursLastNight: num(sleepHoursLastNight),
    deepSleepHours: num(deepSleepHours),
    remSleepHours: num(remSleepHours),
    lightSleepHours: num(lightSleepHours),
    heartZoneMinutes: (heartZoneMinutes && typeof heartZoneMinutes === "object" && !Array.isArray(heartZoneMinutes))
      ? heartZoneMinutes
      : undefined,
    fetchedAt: Date.now(),
  };

  if (Array.isArray(recentSessions)) {
    profile.recentSessions = recentSessions
      .filter((s) => s && typeof s === "object")
      .slice(0, 10)
      .map((s) => ({
        name: str(s.name, 80) || "Session",
        kind: str(s.kind, 20),
        type: str(s.type, 20),
        elapsedMin: num(s.elapsedMin) ?? 0,
        kcal: num(s.kcal) ?? 0,
        savedAt: num(s.savedAt) ?? Date.now(),
        hr: num(s.hr),
        distanceKm: num(s.distanceKm),
        steps: num(s.steps),
        pace: str(s.pace, 20),
        sets: num(s.sets),
        feel: num(s.feel),
        notes: str(s.notes, 300),
        completed: num(s.completed),
        total: num(s.total),
      }));
  }

  if (Array.isArray(connectedDevices)) {
    profile.connectedDevices = connectedDevices
      .filter((d) => d && typeof d === "object")
      .slice(0, 20)
      .map((d) => ({ name: str(d.name, 60) || "Device", kind: str(d.kind, 30) }));
  }

  if (Array.isArray(workoutPlans)) {
    profile.workoutPlans = workoutPlans
      .filter((p) => p && typeof p === "object")
      .slice(0, 30)
      .map((p) => ({
        name: str(p.name, 80) || "Plan",
        durationMin: num(p.durationMin),
        exerciseCount: num(p.exerciseCount) ?? 0,
        tags: Array.isArray(p.tags) ? p.tags.filter((t) => typeof t === "string").slice(0, 5).map((t) => t.slice(0, 30)) : [],
        target: str(p.target, 30),
        isCustom: !!p.isCustom,
      }));
  }

  if (Array.isArray(achievements)) {
    profile.achievements = achievements
      .filter((a) => a && typeof a === "object")
      .slice(0, 50)
      .map((a) => ({ label: str(a.label, 60) || "Achievement", desc: str(a.desc, 200) }));
  }

  if (Array.isArray(challenges)) {
    profile.challenges = challenges
      .filter((c) => c && typeof c === "object")
      .slice(0, 30)
      .map((c) => ({
        name: str(c.name, 80) || "Challenge",
        current: num(c.current) ?? 0,
        goal: num(c.goal) ?? 0,
        unit: str(c.unit, 20),
        state: str(c.state, 20),
      }));
  }

  if (Array.isArray(favoriteExercises)) {
    profile.favoriteExercises = favoriteExercises
      .filter((f) => typeof f === "string")
      .slice(0, 40)
      .map((f) => f.slice(0, 80));
  }

  // The app's full exercise library (name/category/muscles/equipment/
  // difficulty) -- sent once per chat-open, not just favorites/recent, so
  // CIRA can recommend or discuss any exercise the app actually has, not
  // only ones the user already logged. Capped generously since this is a
  // fixed catalog, not user-generated content.
  if (Array.isArray(exerciseLibrary)) {
    profile.exerciseLibrary = exerciseLibrary
      .filter((e) => e && typeof e === "object")
      .slice(0, 200)
      .map((e) => ({
        name: str(e.name, 80) || "Exercise",
        category: str(e.category, 30),
        muscles: Array.isArray(e.muscles) ? e.muscles.filter((m) => typeof m === "string").slice(0, 6).map((m) => m.slice(0, 40)) : [],
        equipment: Array.isArray(e.equipment) ? e.equipment.filter((eq) => typeof eq === "string").slice(0, 6).map((eq) => eq.slice(0, 40)) : [],
        difficulty: str(e.difficulty, 20),
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
    // Gemma models don't support structured output — always use a Gemini
    // model. Uses Google's "-latest" alias (not a pinned version) so this
    // internal fallback doesn't quietly rot the way a pinned ID did before.
    const safeModel = botModel.startsWith("gemma-") ? "gemini-flash-lite-latest" : botModel;

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
    const {
      steps, activeCalories, latestHeartRate, restingHeartRate, peakHeartRate, hrvMs,
      sleepHoursLastNight, deepSleepHours, remSleepHours, lightSleepHours, heartZoneMinutes,
    } = userProfile.deviceHealth;
    const deviceLines = [
      steps && `Steps today: ${steps.toLocaleString()}`,
      activeCalories && `Active calories today: ${activeCalories}`,
      latestHeartRate && `Latest heart rate: ${latestHeartRate} bpm`,
      restingHeartRate && `Resting heart rate: ${restingHeartRate} bpm`,
      peakHeartRate && `Peak heart rate: ${peakHeartRate} bpm`,
      hrvMs && `Heart rate variability: ${hrvMs} ms`,
      sleepHoursLastNight && `Sleep last night: ${sleepHoursLastNight} h`,
      (deepSleepHours || remSleepHours || lightSleepHours) &&
        `Sleep stages: ${[deepSleepHours && `${deepSleepHours}h deep`, remSleepHours && `${remSleepHours}h REM`, lightSleepHours && `${lightSleepHours}h light`].filter(Boolean).join(", ")}`,
      heartZoneMinutes && Object.keys(heartZoneMinutes).length > 0 &&
        `Heart-rate zone minutes today: ${Object.entries(heartZoneMinutes).map(([zone, min]) => `${zone} ${min}m`).join(", ")}`,
    ].filter(Boolean);
    if (deviceLines.length > 0) profileSection += `\n\nRecent Health Data (from phone):\n${deviceLines.map((l) => `- ${l}`).join("\n")}`;
  }

  if (userProfile.recentSessions?.length > 0) {
    const sessionLines = userProfile.recentSessions.slice(0, 5).map((s) => {
      const bits = [`${s.elapsedMin} min`, `${s.kcal} kcal`];
      if (s.distanceKm) bits.push(`${s.distanceKm} km`);
      if (s.steps) bits.push(`${s.steps} steps`);
      if (s.pace) bits.push(s.pace);
      if (s.sets) bits.push(`${s.sets} sets`);
      if (s.hr) bits.push(`${s.hr} bpm`);
      if (s.completed != null && s.total != null) bits.push(`${s.completed}/${s.total} completed`);
      if (s.feel) bits.push(`felt ${s.feel}/5`);
      const line = `${s.name} — ${bits.join(", ")} (${new Date(s.savedAt).toLocaleDateString()})`;
      return s.notes ? `${line} — note: "${s.notes}"` : line;
    });
    profileSection += `\n\nRecent Workouts (from phone):\n${sessionLines.map((l) => `- ${l}`).join("\n")}`;
  }

  if (userProfile.connectedDevices?.length > 0) {
    const deviceNames = userProfile.connectedDevices.map((d) => d.kind ? `${d.name} (${d.kind})` : d.name);
    profileSection += `\n\nConnected Devices:\n${deviceNames.map((l) => `- ${l}`).join("\n")}`;
  }

  if (userProfile.workoutPlans?.length > 0) {
    const planLines = userProfile.workoutPlans.map((p) => {
      const bits = [`${p.exerciseCount} exercises`];
      if (p.durationMin) bits.push(`${p.durationMin} min`);
      if (p.target) bits.push(p.target);
      if (p.tags?.length > 0) bits.push(p.tags.join("/"));
      if (p.isCustom) bits.push("custom");
      return `${p.name} — ${bits.join(", ")}`;
    });
    profileSection += `\n\nWorkout Plans (from phone):\n${planLines.map((l) => `- ${l}`).join("\n")}`;
  }

  if (userProfile.achievements?.length > 0) {
    const achLines = userProfile.achievements.map((a) => (a.desc ? `${a.label} — ${a.desc}` : a.label));
    profileSection += `\n\nEarned Achievements (from phone):\n${achLines.map((l) => `- ${l}`).join("\n")}`;
  }

  if (userProfile.challenges?.length > 0) {
    const chLines = userProfile.challenges.map((c) => {
      const bits = [`${c.current}/${c.goal}${c.unit ? " " + c.unit : ""}`];
      if (c.state && c.state !== "active") bits.push(c.state);
      return `${c.name} — ${bits.join(", ")}`;
    });
    profileSection += `\n\nActive Challenges (from phone):\n${chLines.map((l) => `- ${l}`).join("\n")}`;
  }

  if (userProfile.favoriteExercises?.length > 0) {
    profileSection += `\n\nFavorited Exercises (from phone):\n${userProfile.favoriteExercises.map((f) => `- ${f}`).join("\n")}`;
  }

  // The app's exercise library -- lets CIRA recommend/discuss specific
  // exercises by exact name instead of only generic advice. Kept compact
  // (one line each) since this can run to 100+ entries.
  if (userProfile.exerciseLibrary?.length > 0) {
    const exLines = userProfile.exerciseLibrary.map((e) => {
      const bits = [e.category, e.difficulty].filter(Boolean);
      if (e.muscles?.length > 0) bits.push(e.muscles.join("/"));
      if (e.equipment?.length > 0) bits.push(`equipment: ${e.equipment.join("/")}`);
      return bits.length > 0 ? `${e.name} (${bits.join(", ")})` : e.name;
    });
    profileSection += `\n\nExercise Library (from phone -- ${exLines.length} exercises available in the app):\n${exLines.map((l) => `- ${l}`).join("\n")}`;
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
    const m = genAI.getGenerativeModel({ model: "gemini-flash-lite-latest" });
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

// Full per-user detail for the admin Users page -- profile fields the user
// filled in, their AI persona, phone health data + recent workouts (if
// shared via the mHealth app's "Share with paired coaches" setting), any
// Google Fit data, AI-learned memories, and a chat activity summary.
app.get("/api/admin/users/:id", requireAdmin, (req, res) => {
  const row = db.prepare(
    "SELECT id, email, name, role, login_count, last_login, note, created_at, profile FROM users WHERE id = ?"
  ).get(req.params.id);
  if (!row) return res.status(404).json({ error: "User not found" });
  let parsed = {};
  try { parsed = JSON.parse(row.profile || "{}"); } catch { /* corrupt/empty -- treat as no profile */ }
  const { googleFitTokens: _tokens, ...profile } = parsed;
  const { profile: _raw, ...user } = row;

  const memories = getMemories(req.params.id);

  const conversationCount = db.prepare(
    "SELECT COUNT(*) AS c FROM conversations WHERE user_id = ?"
  ).get(req.params.id).c;
  const messageCount = db.prepare(
    "SELECT COUNT(*) AS c FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.user_id = ?"
  ).get(req.params.id).c;
  const recentConversations = db.prepare(
    "SELECT id, title, created_at, updated_at FROM conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 5"
  ).all(req.params.id);

  res.json({
    user,
    profile,
    memories,
    activity: { conversationCount, messageCount, recentConversations },
  });
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
// NUDGES -- admin-authored notifications for the mHealth mobile app.
// This server has no way to push to a phone that isn't listening, so the
// app polls GET /api/user/nudges/pending (on launch/resume and
// periodically while open) and shows whatever it finds as a local
// notification. "Send to all" fans out to one row per recipient up front
// so each user's delivery status is tracked independently.
// ══════════════════════════════════════════════════════════════════════

app.post("/api/admin/nudges", requireAdmin, (req, res) => {
  const { userId, title, body } = req.body;
  const titleStr = typeof title === "string" ? title.trim() : "";
  const bodyStr = typeof body === "string" ? body.trim() : "";
  if (!titleStr || !bodyStr) return res.status(400).json({ error: "title and body are required" });
  if (titleStr.length > 100) return res.status(400).json({ error: "title must be 100 characters or fewer" });
  if (bodyStr.length > 500) return res.status(400).json({ error: "body must be 500 characters or fewer" });

  let recipientIds;
  if (userId) {
    const target = db.prepare("SELECT id FROM users WHERE id = ? AND role != 'admin'").get(userId);
    if (!target) return res.status(404).json({ error: "User not found" });
    recipientIds = [target.id];
  } else {
    recipientIds = db.prepare("SELECT id FROM users WHERE role != 'admin'").all().map((u) => u.id);
  }
  if (recipientIds.length === 0) return res.status(400).json({ error: "No recipients" });

  const now = Date.now();
  const insert = db.prepare(
    "INSERT INTO nudges (id, user_id, title, body, created_at, created_by) VALUES (?,?,?,?,?,?)"
  );
  const insertMany = db.transaction((ids) => {
    for (const id of ids) insert.run(uid(), id, titleStr, bodyStr, now, req.user.uid);
  });
  insertMany(recipientIds);

  res.json({ message: "Sent", recipientCount: recipientIds.length });
});

app.get("/api/admin/nudges", requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT n.id, n.title, n.body, n.created_at, n.delivered_at, n.created_by, u.name AS user_name, u.email AS user_email
    FROM nudges n JOIN users u ON u.id = n.user_id
    ORDER BY n.created_at DESC
    LIMIT 200
  `).all();
  res.json({ nudges: rows });
});

app.delete("/api/admin/nudges/:id", requireAdmin, (req, res) => {
  db.prepare("DELETE FROM nudges WHERE id = ? AND delivered_at IS NULL").run(req.params.id);
  res.json({ message: "Deleted" });
});

// Called by the mHealth app -- returns this user's undelivered nudges and
// marks them delivered in the same request (fetch = acknowledge).
app.get("/api/user/nudges/pending", requireAuth, (req, res) => {
  const rows = db.prepare(
    "SELECT id, title, body, created_at FROM nudges WHERE user_id = ? AND delivered_at IS NULL ORDER BY created_at ASC"
  ).all(req.user.uid);
  if (rows.length > 0) {
    const now = Date.now();
    const markDelivered = db.prepare("UPDATE nudges SET delivered_at = ? WHERE id = ?");
    const markMany = db.transaction((ns) => { for (const n of ns) markDelivered.run(now, n.id); });
    markMany(rows);
  }
  res.json({ nudges: rows });
});

// ══════════════════════════════════════════════════════════════════════
// PROACTIVE NUDGES -- CIRA decides on its own, no admin/chat prompt
// needed. Runs on a timer inside this same long-running process (see
// setInterval below) rather than a separate Render cron job, since the
// nudges/users tables live in this service's own SQLite file on its
// attached disk that a separate scheduled service wouldn't have access
// to. Currently flags one thing: no workout session logged in
// INACTIVITY_THRESHOLD_MS, computed from the session timestamps already
// pushed via health-sync -- the only activity signal reliably available
// with a real timestamp. Skips users who've never synced session data
// (health-sync is opt-in via the app's "Share with paired coaches"
// toggle, so an empty list means either they're opted out or genuinely
// have no history to reason about either way), and enforces a per-user
// cooldown so the same gap doesn't re-nudge every time the timer fires.
// ══════════════════════════════════════════════════════════════════════

const INACTIVITY_THRESHOLD_MS = 48 * 60 * 60 * 1000; // 2 days since last logged session
const NUDGE_COOLDOWN_MS = 20 * 60 * 60 * 1000; // ~once/day, with slack for check cadence
const NUDGE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // re-scan 4x/day

async function draftInactivityNudge(user, daysSince) {
  const firstName = (user.name || "there").split(" ")[0];
  const profile = getUserProfile(user.id);
  let persona = "";
  if (profile.aiName) persona += `You are named "${profile.aiName}". `;
  if (profile.aiPersonality) persona += `Adopt a ${profile.aiPersonality.toLowerCase()} personality. `;

  const prompt =
    `${persona}You are a fitness companion app writing a short push notification to gently nudge ` +
    `${firstName} back to activity -- it has been ${daysSince} day${daysSince === 1 ? "" : "s"} since ` +
    `their last logged workout. Write ONE encouraging, non-guilt-tripping notification. ` +
    `Reply as exactly two lines with no other text:\n` +
    `Line 1: a short title (max 8 words, no quotes, no emoji)\n` +
    `Line 2: a short body (max 20 words, no quotes)`;

  const m = genAI.getGenerativeModel({ model: "gemini-flash-lite-latest" });
  const result = await m.generateContent(prompt);
  const lines = result.response.text().trim().split("\n").map((l) => l.trim()).filter(Boolean);
  const title = (lines[0] || `Missing you, ${firstName}!`).slice(0, 100);
  const body = (lines[1] || "It's been a couple of days -- ready for a quick session today?").slice(0, 500);
  return { title, body };
}

async function checkAndSendProactiveNudges() {
  const users = db.prepare("SELECT id, name, email, profile FROM users WHERE role != 'admin'").all();
  const now = Date.now();
  let sent = 0;

  for (const row of users) {
    let profile;
    try { profile = JSON.parse(row.profile || "{}"); } catch { profile = {}; }

    const sessions = Array.isArray(profile.recentSessions) ? profile.recentSessions : [];
    if (sessions.length === 0) continue; // opted out, or nothing synced to reason about yet

    const lastSessionAt = Math.max(...sessions.map((s) => s.savedAt || 0));
    if (now - lastSessionAt < INACTIVITY_THRESHOLD_MS) continue; // still active, nothing to flag

    const recentAutoNudge = db.prepare(
      "SELECT created_at FROM nudges WHERE user_id = ? AND created_by = 'cira-auto' ORDER BY created_at DESC LIMIT 1"
    ).get(row.id);
    if (recentAutoNudge && now - recentAutoNudge.created_at < NUDGE_COOLDOWN_MS) continue; // already nudged recently

    const daysSince = Math.floor((now - lastSessionAt) / (24 * 60 * 60 * 1000));
    try {
      const { title, body } = await draftInactivityNudge(row, daysSince);
      db.prepare(
        "INSERT INTO nudges (id, user_id, title, body, created_at, created_by) VALUES (?,?,?,?,?,?)"
      ).run(uid(), row.id, title, body, now, "cira-auto");
      sent++;
      console.log(`[proactive-nudge] sent to ${row.email}: "${title}"`);
    } catch (err) {
      console.error(`[proactive-nudge] failed for ${row.email}:`, err.message);
    }
  }
  console.log(`[proactive-nudge] check complete: ${sent} sent, ${users.length} users scanned`);
  return sent;
}

// Manual trigger so an admin (or this file's own author, while testing)
// can run the check immediately instead of waiting for the timer.
app.post("/api/admin/nudges/run-auto-check", requireAdmin, async (req, res) => {
  try {
    const sent = await checkAndSendProactiveNudges();
    res.json({ message: "Checked", sent });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Give the server a moment to finish starting up, then check periodically.
setTimeout(() => {
  checkAndSendProactiveNudges().catch((err) => console.error("[proactive-nudge] check failed:", err.message));
  setInterval(() => {
    checkAndSendProactiveNudges().catch((err) => console.error("[proactive-nudge] check failed:", err.message));
  }, NUDGE_CHECK_INTERVAL_MS);
}, 2 * 60 * 1000);

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
