const db = require("../db");

// ── Load in-memory store from SQLite on startup ───────────────────────────
function load() {
  try {
    const documents = db.prepare(
      "SELECT id, name, chunk_count AS chunkCount, added_at AS addedAt FROM kb_documents"
    ).all();

    const chunks = db.prepare(
      "SELECT doc_id AS docId, doc_name AS docName, text, embedding FROM kb_chunks"
    ).all().map((c) => ({ ...c, embedding: JSON.parse(c.embedding) }));

    return { documents, chunks };
  } catch (e) {
    console.error("Vector store load error:", e.message);
    return { documents: [], chunks: [] };
  }
}

// No-op: all writes now happen directly in addDocument / removeDocument
function save() {}

// ── Cosine similarity ─────────────────────────────────────────────────────
function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

// ── Add (or replace) a document ───────────────────────────────────────────
function addDocument(store, { id, name, chunks }) {
  removeDocument(store, id); // remove old version if re-indexing same id

  // Persist to SQLite in a single transaction for speed
  db.transaction(() => {
    db.prepare(
      "INSERT INTO kb_documents (id, name, chunk_count, added_at) VALUES (?, ?, ?, ?)"
    ).run(id, name, chunks.length, Date.now());

    const ins = db.prepare(
      "INSERT INTO kb_chunks (doc_id, doc_name, text, embedding) VALUES (?, ?, ?, ?)"
    );
    for (const c of chunks) ins.run(id, name, c.text, JSON.stringify(c.embedding));
  })();

  // Mirror in in-memory store for fast cosine search
  store.documents.push({ id, name, chunkCount: chunks.length, addedAt: Date.now() });
  for (const c of chunks) {
    store.chunks.push({ docId: id, docName: name, text: c.text, embedding: c.embedding });
  }
}

// ── Remove a document ─────────────────────────────────────────────────────
function removeDocument(store, id) {
  // CASCADE on kb_chunks removes all associated chunks automatically
  db.prepare("DELETE FROM kb_documents WHERE id = ?").run(id);

  store.documents = store.documents.filter((d) => d.id !== id);
  store.chunks    = store.chunks.filter((c) => c.docId !== id);
}

// ── Semantic search ───────────────────────────────────────────────────────
function search(store, queryEmbedding, topK = 4, minScore = 0.20) {
  if (!store.chunks.length) return [];
  return store.chunks
    .map((chunk) => ({
      text:    chunk.text,
      docName: chunk.docName,
      score:   cosine(queryEmbedding, chunk.embedding),
    }))
    .filter((r) => r.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

module.exports = { load, save, addDocument, removeDocument, search };
