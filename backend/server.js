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

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({
  dest: "uploads/",
  limits: { fileSize: 20 * 1024 * 1024 },
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Vector store
let store = load();
console.log(`Vector store loaded: ${store.documents.length} docs, ${store.chunks.length} chunks`);

// Chat sessions keyed by "sessionId:modelName"
const sessions = {};

const STYLE_TEMP = { precise: 0.2, balanced: 0.7, creative: 1.2 };

// ── Chat ──────────────────────────────────────────────────────────────
app.post("/api/chat", async (req, res) => {
  const {
    message,
    sessionId,
    model: modelName = "gemini-1.5-flash",
    systemPrompt = "",
    style = "balanced",
    ragTopK = 4,
    ragMinScore = 0.45,
  } = req.body;

  if (!message || !sessionId) {
    return res.status(400).json({ error: "message and sessionId are required" });
  }

  const temperature = STYLE_TEMP[style] ?? 0.7;
  const sessionKey = `${sessionId}:${modelName}`;

  if (!sessions[sessionKey]) {
    const m = genAI.getGenerativeModel({
      model: modelName,
      ...(systemPrompt ? { systemInstruction: systemPrompt } : {}),
      generationConfig: { temperature },
    });
    sessions[sessionKey] = m.startChat({ history: [] });
  }

  // RAG retrieval
  let contextualMessage = message;
  if (store.chunks.length > 0) {
    try {
      const queryEmbedding = await embedText(message);
      const hits = search(store, queryEmbedding, ragTopK, ragMinScore);
      if (hits.length > 0) {
        const context = hits
          .map((h) => `[Source: ${h.docName}]\n${h.text}`)
          .join("\n\n---\n\n");
        contextualMessage =
          `You have access to the following context from the user's knowledge base. ` +
          `Use it if relevant; otherwise rely on your general knowledge.\n\n` +
          `<context>\n${context}\n</context>\n\nUser question: ${message}`;
      }
    } catch (err) {
      console.error("RAG retrieval error:", err.message);
    }
  }

  try {
    const result = await sessions[sessionKey].sendMessage(contextualMessage);
    res.json({ reply: result.response.text() });
  } catch (err) {
    console.error("Gemini chat error:", err.message);
    res.status(500).json({ error: "Failed to get response from Gemini" });
  }
});

// ── Title generation ──────────────────────────────────────────────────
app.post("/api/title", async (req, res) => {
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

// ── Session management ────────────────────────────────────────────────
app.delete("/api/chat/:sessionId", (req, res) => {
  const prefix = req.params.sessionId + ":";
  for (const key of Object.keys(sessions)) {
    if (key.startsWith(prefix)) delete sessions[key];
  }
  res.json({ message: "Session cleared" });
});

// ── Documents ─────────────────────────────────────────────────────────
app.get("/api/documents", (req, res) => {
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

app.post("/api/documents", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  const { originalname, path: filePath } = req.file;
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  try {
    const text = await extractText(filePath, originalname);
    await indexDocument(id, originalname, text);
    res.json({ id, name: originalname, message: "Document indexed" });
  } catch (err) {
    console.error("File indexing error:", err.message);
    res.status(500).json({ error: err.message });
  } finally {
    fs.unlink(filePath, () => {});
  }
});

app.post("/api/documents/text", async (req, res) => {
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

app.delete("/api/documents/:id", (req, res) => {
  removeDocument(store, req.params.id);
  save(store);
  res.json({ message: "Document removed" });
});

// ── Health ────────────────────────────────────────────────────────────
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", docs: store.documents.length, chunks: store.chunks.length });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Backend running on http://localhost:${PORT}`));
