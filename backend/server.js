require("dotenv").config();
const express   = require("express");
const cors      = require("cors");
const multer    = require("multer");
const path      = require("path");
const fs        = require("fs");
const crypto    = require("crypto");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { embedText }     = require("./rag/embed");
const { chunkText }     = require("./rag/chunker");
const { load, save, addDocument, removeDocument, search } = require("./rag/store");
const db        = require("./db");
const { hashPassword, checkPassword, signToken, requireAuth, requireAdmin } = require("./auth");

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ dest: "uploads/", limits: { fileSize: 20 * 1024 * 1024 } });
const genAI  = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

let store = load();
console.log(`Vector store: ${store.documents.length} docs, ${store.chunks.length} chunks`);

function uid() { return crypto.randomUUID(); }

// ── Bot settings helpers ──────────────────────────────────────────────
const DEFAULT_BOT = { model: "gemini-1.5-flash", systemPrompt: "You are a helpful assistant." };

function getBotSettings() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'chatbot'").get();
  if (!row) return DEFAULT_BOT;
  try { return { ...DEFAULT_BOT, ...JSON.parse(row.value) }; } catch { return DEFAULT_BOT; }
}

function setBotSettings(data) {
  const current = getBotSettings();
  const updated  = { ...current, ...data };
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
    id:            uid(),
    email:         email.toLowerCase(),
    name:          name.trim(),
    role,
    password_hash: hashPassword(password),
    login_count:   0,
    last_login:    null,
    note:          "",
    created_at:    Date.now(),
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
  const now  = Date.now();
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

  const msgs = db.prepare(
    "SELECT id, role, text, timestamp FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC"
  ).all(req.params.id);
  res.json({ messages: msgs });
});

// ══════════════════════════════════════════════════════════════════════
// CHAT (KB-only AI)
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

  const { model, systemPrompt } = getBotSettings();

  // KB retrieval
  if (store.chunks.length === 0) {
    const reply = "The knowledge base is empty. Please ask your administrator to upload documents.";
    const botMsgId = uid();
    db.prepare("INSERT INTO messages (id, conversation_id, role, text, timestamp) VALUES (?,?,?,?,?)")
      .run(botMsgId, conversationId, "assistant", reply, Date.now());
    return res.json({ userMsgId, botMsgId, reply });
  }

  let contextText = "";
  try {
    const queryEmbedding = await embedText(message);
    const hits = search(store, queryEmbedding, 5, 0.40);
    if (hits.length === 0) {
      const reply = "I'm sorry, I don't have information about that in my knowledge base.";
      const botMsgId = uid();
      db.prepare("INSERT INTO messages (id, conversation_id, role, text, timestamp) VALUES (?,?,?,?,?)")
        .run(botMsgId, conversationId, "assistant", reply, Date.now());
      return res.json({ userMsgId, botMsgId, reply });
    }
    contextText = hits.map((h) => `[Source: ${h.docName}]\n${h.text}`).join("\n\n---\n\n");
  } catch (err) {
    console.error("RAG error:", err.message);
    return res.status(500).json({ error: "Failed to search knowledge base" });
  }

  const fullSystem =
    `${systemPrompt}\n\n` +
    `IMPORTANT: Only answer from the context below. If not covered, respond: "I'm sorry, I don't have information about that in my knowledge base."\n\n` +
    `<context>\n${contextText}\n</context>`;

  try {
    const geminiHistory = history.slice(-10).map((m) => ({
      role:  m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.text }],
    }));
    const geminiModel = genAI.getGenerativeModel({
      model,
      systemInstruction: fullSystem,
      generationConfig:  { temperature: 0.4 },
    });
    const chat   = geminiModel.startChat({ history: geminiHistory });
    const result = await chat.sendMessage(message);
    const reply  = result.response.text();

    const botMsgId = uid();
    db.prepare("INSERT INTO messages (id, conversation_id, role, text, timestamp) VALUES (?,?,?,?,?)")
      .run(botMsgId, conversationId, "assistant", reply, Date.now());
    db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(Date.now(), conversationId);

    res.json({ userMsgId, botMsgId, reply });
  } catch (err) {
    console.error("Gemini error:", err.message);
    // Still save an error message
    const errMsg   = `⚠️ ${err.message}`;
    const botMsgId = uid();
    db.prepare("INSERT INTO messages (id, conversation_id, role, text, timestamp) VALUES (?,?,?,?,?)")
      .run(botMsgId, conversationId, "assistant", errMsg, Date.now());
    res.json({ userMsgId, botMsgId, reply: errMsg });
  }
});

// ── Auto-title ────────────────────────────────────────────────────────
app.post("/api/title", requireAuth, async (req, res) => {
  const { message, conversationId } = req.body;
  if (!message) return res.status(400).json({ error: "message is required" });
  try {
    const m    = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
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
  const users    = db.prepare("SELECT login_count, last_login FROM users WHERE role = 'user'").all();
  const total    = users.length;
  const totalLog = users.reduce((s, u) => s + (u.login_count || 0), 0);
  const avgLog   = total ? (totalLog / total).toFixed(1) : 0;
  const lastLog  = users.map((u) => u.last_login || 0).filter(Boolean);
  res.json({
    totalUsers:      total,
    kbDocs:          store.documents.length,
    avgLogins:       parseFloat(avgLog),
    mostRecentLogin: lastLog.length ? Math.max(...lastLog) : null,
  });
});

app.get("/api/admin/recent-chats", requireAdmin, (req, res) => {
  const rows = db.prepare(
    "SELECT id, title, updated_at FROM conversations ORDER BY updated_at DESC LIMIT 10"
  ).all();
  res.json({ chats: rows });
});

app.get("/api/admin/settings", requireAdmin, (req, res) => {
  res.json(getBotSettings());
});

app.put("/api/admin/settings", requireAdmin, (req, res) => {
  const { model, systemPrompt } = req.body;
  setBotSettings({ ...(model && { model }), ...(systemPrompt !== undefined && { systemPrompt }) });
  res.json({ message: "Settings saved" });
});

app.get("/api/admin/users", requireAdmin, (req, res) => {
  const users = db.prepare(
    "SELECT id, email, name, role, login_count, last_login, note, created_at FROM users WHERE role != 'admin'"
  ).all();
  res.json({ users });
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
  const msgs = db.prepare(
    "SELECT id, role, text, timestamp FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC"
  ).all(req.params.id);
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
    const data   = await pdfParse(buffer);
    return data.text;
  }
  return fs.readFileSync(filePath, "utf8");
}

async function indexDocument(id, name, text) {
  const rawChunks = chunkText(text);
  if (rawChunks.length === 0) throw new Error("No extractable text found");
  console.log(`Indexing "${name}": ${rawChunks.length} chunks…`);
  const chunks = [];
  for (const t of rawChunks) {
    const embedding = await embedText(t);
    chunks.push({ text: t, embedding });
  }
  addDocument(store, { id, name, chunks });
  save(store);
  console.log(`Done indexing "${name}"`);
}

app.post("/api/documents", requireAdmin, upload.array("files", 20), async (req, res) => {
  const files = req.files;
  if (!files || files.length === 0) return res.status(400).json({ error: "No files uploaded" });
  const results = [];
  for (const file of files) {
    const { originalname, path: filePath } = file;
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    try {
      const text = await extractText(filePath, originalname);
      await indexDocument(id, originalname, text);
      results.push({ id, name: originalname, ok: true });
    } catch (err) {
      console.error(`Indexing error for ${originalname}:`, err.message);
      results.push({ name: originalname, ok: false, error: err.message });
    } finally {
      fs.unlink(filePath, () => {});
    }
  }
  res.json({ results });
});

app.post("/api/documents/text", requireAdmin, async (req, res) => {
  const { name, content } = req.body;
  if (!name || !content) return res.status(400).json({ error: "name and content are required" });
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  try {
    await indexDocument(id, name, content);
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
    const r    = await fetch(`${XI_BASE}/voices`, { headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY } });
    const data = await r.json();
    res.json({ voices: (data.voices || []).map((v) => ({ voice_id: v.voice_id, name: v.name, category: v.category })) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/tts", async (req, res) => {
  if (!process.env.ELEVENLABS_API_KEY) return res.status(400).json({ error: "ELEVENLABS_API_KEY not set" });
  const { text, voiceId = "21m00Tcm4TlvDq8ikWAM", modelId = "eleven_turbo_v2_5", stability = 0.5, similarityBoost = 0.75 } = req.body;
  if (!text) return res.status(400).json({ error: "text is required" });
  try {
    const r = await fetch(`${XI_BASE}/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
      method:  "POST",
      headers: xiHeaders(),
      body:    JSON.stringify({ text, model_id: modelId, voice_settings: { stability, similarity_boost: similarityBoost } }),
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

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Backend running on http://localhost:${PORT}`));
