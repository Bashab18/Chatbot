require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
app.use(cors());
app.use(express.json());

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// Per-session chat histories
const sessions = {};

// Send a message in a conversation
app.post("/api/chat", async (req, res) => {
  const { message, sessionId } = req.body;
  if (!message || !sessionId) {
    return res.status(400).json({ error: "message and sessionId are required" });
  }

  if (!sessions[sessionId]) {
    sessions[sessionId] = model.startChat({ history: [] });
  }

  try {
    const result = await sessions[sessionId].sendMessage(message);
    res.json({ reply: result.response.text() });
  } catch (err) {
    console.error("Gemini chat error:", err.message);
    res.status(500).json({ error: "Failed to get response from Gemini" });
  }
});

// Generate a short title from the first user message
app.post("/api/title", async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: "message is required" });

  try {
    const chat = model.startChat({ history: [] });
    const result = await chat.sendMessage(
      `Generate a concise 4-6 word title for a conversation that starts with this message. Reply with ONLY the title, no quotes or punctuation at the end:\n\n"${message}"`
    );
    res.json({ title: result.response.text().trim() });
  } catch (err) {
    console.error("Gemini title error:", err.message);
    res.status(500).json({ error: "Failed to generate title" });
  }
});

// Clear a session
app.delete("/api/chat/:sessionId", (req, res) => {
  delete sessions[req.params.sessionId];
  res.json({ message: "Session cleared" });
});

// Health check
app.get("/api/health", (req, res) => res.json({ status: "ok" }));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Backend running on http://localhost:${PORT}`));
