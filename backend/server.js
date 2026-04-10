require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { embedText } = require("./rag/embed");
const { chunkText } = require("./rag/chunker");
const { load, save, addDocument, removeDocument, search } = require("./rag/store");
const { initFirebase, getDb, requireAuth, requireAdmin } = require("./firebase-admin");

initFirebase();

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({
  dest: "uploads/",
  limits: { fileSize: 20 * 1024 * 1024 },
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Vector store (local JSON)
let store = load();
console.log(`Vector store loaded: ${store.documents.length} docs, ${store.chunks.length} chunks`);

// ── Chatbot settings helpers ──────────────────────────────────────────
const DEFAULT_BOT_SETTINGS = {
  model: "gemini-1.5-flash",
  systemPrompt: "You are a helpful assistant. Only answer based on the provided knowledge base.",
};

async function loadBotSettings() {
  const db = getDb();
  if (!db) return DEFAULT_BOT_SETTINGS;
  try {
    const snap = await db.collection("settings").doc("chatbot").get();
    if (snap.exists) return { ...DEFAULT_BOT_SETTINGS, ...snap.data() };
  } catch {}
  return DEFAULT_BOT_SETTINGS;
}

// ── User Chat ─────────────────────────────────────────────────────────
app.post("/api/chat", requireAuth, async (req, res) => {
  const { message, history = [] } = req.body;
  if (!message) return res.status(400).json({ error: "message is required" });

  const { model, systemPrompt } = await loadBotSettings();

  // KB retrieval
  if (store.chunks.length === 0) {
    return res.json({
      reply: "The knowledge base is empty. Please ask your administrator to upload documents.",
    });
  }

  let contextText = "";
  try {
    const queryEmbedding = await embedText(message);
    const hits = search(store, queryEmbedding, 5, 0.40);
    if (hits.length === 0) {
      return res.json({
        reply: "I'm sorry, I don't have information about that in my knowledge base.",
      });
    }
    contextText = hits.map((h) => `[Source: ${h.docName}]\n${h.text}`).join("\n\n---\n\n");
  } catch (err) {
    console.error("RAG error:", err.message);
    return res.status(500).json({ error: "Failed to search knowledge base" });
  }

  const fullSystem =
    `${systemPrompt}\n\n` +
    `IMPORTANT: You must ONLY answer from the context below. ` +
    `If the question is not covered, say: "I'm sorry, I don't have information about that in my knowledge base."\n\n` +
    `<context>\n${contextText}\n</context>`;

  try {
    const geminiHistory = history
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.text }],
      }));

    const geminiModel = genAI.getGenerativeModel({
      model,
      systemInstruction: fullSystem,
      generationConfig: { temperature: 0.4 },
    });
    const chat = geminiModel.startChat({ history: geminiHistory });
    const result = await chat.sendMessage(message);
    res.json({ reply: result.response.text() });
  } catch (err) {
    console.error("Gemini chat error:", err.message);
    res.status(500).json({ error: "Failed to get response" });
  }
});

// ── Title generation ──────────────────────────────────────────────────
app.post("/api/title", requireAuth, async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: "message is required" });
  try {
    const m = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const chat = m.startChat({ history: [] });
    const result = await chat.sendMessage(
      `Generate a concise 4-6 word title for a conversation that starts with this message. ` +
      `Reply with ONLY the title, no quotes or punctuation at the end:\n\n"${message}"`
    );
    res.json({ title: result.response.text().trim() });
  } catch (err) {
    console.error("Title error:", err.message);
    res.status(500).json({ error: "Failed to generate title" });
  }
});

// ── Admin: Chatbot Settings ───────────────────────────────────────────
app.get("/api/admin/settings", requireAdmin, async (req, res) => {
  const settings = await loadBotSettings();
  res.json(settings);
});

app.put("/api/admin/settings", requireAdmin, async (req, res) => {
  const { model, systemPrompt } = req.body;
  const db = getDb();
  if (!db) return res.status(503).json({ error: "Firestore not configured" });
  const updates = {};
  if (model !== undefined) updates.model = model;
  if (systemPrompt !== undefined) updates.systemPrompt = systemPrompt;
  try {
    await db.collection("settings").doc("chatbot").set(updates, { merge: true });
    res.json({ message: "Settings saved" });
  } catch (err) {
    console.error("Settings save error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Admin: Users ──────────────────────────────────────────────────────
app.get("/api/admin/users", requireAdmin, async (req, res) => {
  const db = getDb();
  if (!db) return res.status(503).json({ error: "Firestore not configured" });
  try {
    const snap = await db.collection("users").get();
    const users = snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
    res.json({ users });
  } catch (err) {
    console.error("List users error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.patch("/api/admin/users/:uid", requireAdmin, async (req, res) => {
  const db = getDb();
  if (!db) return res.status(503).json({ error: "Firestore not configured" });
  const { note, role } = req.body;
  const updates = {};
  if (note !== undefined) updates.note = note;
  if (role !== undefined) updates.role = role;
  try {
    await db.collection("users").doc(req.params.uid).update(updates);
    res.json({ message: "User updated" });
  } catch (err) {
    console.error("Update user error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Admin: Dashboard Stats ────────────────────────────────────────────
app.get("/api/admin/stats", requireAdmin, async (req, res) => {
  const db = getDb();
  if (!db) return res.status(503).json({ error: "Firestore not configured" });
  try {
    const usersSnap = await db.collection("users").get();
    const users = usersSnap.docs.map((d) => d.data());
    const nonAdmins = users.filter((u) => u.role !== "admin");
    const totalLogins = nonAdmins.reduce((sum, u) => sum + (u.loginCount || 0), 0);
    const avgLogins = nonAdmins.length ? (totalLogins / nonAdmins.length).toFixed(1) : 0;
    const lastLoginTimes = nonAdmins.map((u) => u.lastLogin || 0).filter(Boolean);
    const mostRecentLogin = lastLoginTimes.length ? Math.max(...lastLoginTimes) : null;

    res.json({
      totalUsers: nonAdmins.length,
      kbDocs: store.documents.length,
      avgLogins: parseFloat(avgLogins),
      mostRecentLogin,
    });
  } catch (err) {
    console.error("Stats error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Admin: Chat History ───────────────────────────────────────────────
app.get("/api/admin/chats/:uid", requireAdmin, async (req, res) => {
  const db = getDb();
  if (!db) return res.status(503).json({ error: "Firestore not configured" });
  try {
    const snap = await db
      .collection("chats")
      .where("userId", "==", req.params.uid)
      .orderBy("updatedAt", "desc")
      .get();
    const chats = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    res.json({ chats });
  } catch (err) {
    console.error("Chat history error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/admin/chats/:uid/:chatId/messages", requireAdmin, async (req, res) => {
  const db = getDb();
  if (!db) return res.status(503).json({ error: "Firestore not configured" });
  try {
    const snap = await db
      .collection("chats")
      .doc(req.params.chatId)
      .collection("messages")
      .orderBy("timestamp", "asc")
      .get();
    const messages = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    res.json({ messages });
  } catch (err) {
    console.error("Messages error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Knowledge Base (admin only) ───────────────────────────────────────
app.get("/api/documents", requireAdmin, (req, res) => {
  res.json({ documents: store.documents });
});

async function extractText(filePath, originalname) {
  const ext = path.extname(originalname).toLowerCase();
  if (ext === ".pdf") {
    const pdfParse = require("pdf-parse");
    const buffer = fs.readFileSync(filePath);
    const data = await pdfParse(buffer);
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
      console.error(`File indexing error for ${originalname}:`, err.message);
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

// ── ElevenLabs TTS ───────────────────────────────────────────────────
const XI_BASE = "https://api.elevenlabs.io/v1";

function xiHeaders() {
  return {
    "xi-api-key": process.env.ELEVENLABS_API_KEY,
    "Content-Type": "application/json",
  };
}

app.get("/api/tts/voices", async (req, res) => {
  if (!process.env.ELEVENLABS_API_KEY)
    return res.status(400).json({ error: "ELEVENLABS_API_KEY not configured" });
  try {
    const response = await fetch(`${XI_BASE}/voices`, {
      headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY },
    });
    if (!response.ok) throw new Error(`ElevenLabs API error: ${response.status}`);
    const data = await response.json();
    const voices = (data.voices || []).map((v) => ({
      voice_id: v.voice_id,
      name: v.name,
      category: v.category,
      labels: v.labels,
      preview_url: v.preview_url,
    }));
    res.json({ voices });
  } catch (err) {
    console.error("ElevenLabs voices error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/tts", async (req, res) => {
  if (!process.env.ELEVENLABS_API_KEY)
    return res.status(400).json({ error: "ELEVENLABS_API_KEY not configured" });
  const {
    text,
    voiceId = "21m00Tcm4TlvDq8ikWAM",
    modelId = "eleven_turbo_v2_5",
    stability = 0.5,
    similarityBoost = 0.75,
    style = 0,
    speakerBoost = true,
  } = req.body;
  if (!text) return res.status(400).json({ error: "text is required" });

  try {
    const response = await fetch(
      `${XI_BASE}/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: xiHeaders(),
        body: JSON.stringify({
          text,
          model_id: modelId,
          voice_settings: { stability, similarity_boost: similarityBoost, style, use_speaker_boost: speakerBoost },
        }),
      }
    );
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(response.status).json({
        error: err?.detail?.message || `ElevenLabs error ${response.status}`,
      });
    }
    const buffer = await response.arrayBuffer();
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Length", buffer.byteLength);
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error("TTS error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Health ────────────────────────────────────────────────────────────
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", docs: store.documents.length, chunks: store.chunks.length });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Backend running on http://localhost:${PORT}`));
