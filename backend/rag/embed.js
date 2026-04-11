const { GoogleGenerativeAI } = require("@google/generative-ai");

let client;
function getClient() {
  if (!client) client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  return client;
}

// Single text → embedding (used for query at chat time)
async function embedText(text) {
  const model = getClient().getGenerativeModel({ model: "embedding-001" });
  const result = await model.embedContent(text);
  return result.embedding.values;
}

// Batch embed — one API call for all chunks (avoids per-chunk latency / timeouts)
const BATCH_SIZE = 100; // API limit per batchEmbedContents call
async function embedBatch(texts) {
  if (texts.length === 0) return [];
  const model = getClient().getGenerativeModel({ model: "embedding-001" });
  const allEmbeddings = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const slice = texts.slice(i, i + BATCH_SIZE);
    const { embeddings } = await model.batchEmbedContents({
      requests: slice.map((text) => ({ content: { parts: [{ text }] } })),
    });
    for (const e of embeddings) allEmbeddings.push(e.values);
  }
  return allEmbeddings;
}

module.exports = { embedText, embedBatch };

