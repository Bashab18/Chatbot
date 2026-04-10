const fs = require("fs");
const path = require("path");

const DATA_FILE = path.join(__dirname, "../data/vectors.json");

function load() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    }
  } catch (e) {
    console.error("Vector store load error:", e.message);
  }
  return { documents: [], chunks: [] };
}

function save(store) {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(store));
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

function addDocument(store, { id, name, chunks }) {
  // Remove old version if re-uploading same-named doc
  store.documents = store.documents.filter((d) => d.id !== id);
  store.chunks = store.chunks.filter((c) => c.docId !== id);

  store.documents.push({
    id,
    name,
    chunkCount: chunks.length,
    addedAt: Date.now(),
  });

  for (const chunk of chunks) {
    store.chunks.push({
      docId: id,
      docName: name,
      text: chunk.text,
      embedding: chunk.embedding,
    });
  }
}

function removeDocument(store, id) {
  store.documents = store.documents.filter((d) => d.id !== id);
  store.chunks = store.chunks.filter((c) => c.docId !== id);
}

function search(store, queryEmbedding, topK = 4, minScore = 0.45) {
  if (!store.chunks.length) return [];
  return store.chunks
    .map((chunk) => ({
      text: chunk.text,
      docName: chunk.docName,
      score: cosine(queryEmbedding, chunk.embedding),
    }))
    .filter((r) => r.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

module.exports = { load, save, addDocument, removeDocument, search };
