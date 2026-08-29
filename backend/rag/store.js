const db = require("../db");

// Precomputes what search() used to rebuild from scratch on every single
// chat message: each chunk's own term-frequency map (never changes once a
// chunk is stored) and the corpus-wide document-frequency map + average
// chunk length (only change when a document is added/removed). Call this
// once whenever store.chunks changes -- never from inside search() itself.
function _buildTf(tokens) {
  const tf = new Map();
  for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
  return tf;
}

function _recomputeCorpusStats(store) {
  const N = store.chunks.length;
  store.avgLen = N === 0 ? 0 : store.chunks.reduce((s, c) => s + (c.tokens.length || 1), 0) / N;
  const df = new Map();
  for (const chunk of store.chunks) {
    for (const term of new Set(chunk.tokens)) {
      df.set(term, (df.get(term) || 0) + 1);
    }
  }
  store.df = df;
}

// ── Load in-memory store from SQLite on startup ───────────────────────────
function load() {
  try {
    const documents = db.prepare(
      "SELECT id, name, chunk_count AS chunkCount, added_at AS addedAt FROM kb_documents"
    ).all();

    const chunks = db.prepare(
      "SELECT doc_id AS docId, doc_name AS docName, text, embedding FROM kb_chunks"
    ).all().map((c) => {
      const parsed = JSON.parse(c.embedding);
      // Discard old float-array embeddings from before the BM25 migration
      if (!Array.isArray(parsed) || (parsed.length > 0 && typeof parsed[0] !== "string")) {
        return null;
      }
      return { docId: c.docId, docName: c.docName, text: c.text, tokens: parsed, tf: _buildTf(parsed) };
    }).filter(Boolean);

    const store = { documents, chunks };
    _recomputeCorpusStats(store);
    return store;
  } catch (e) {
    console.error("Store load error:", e.message);
    return { documents: [], chunks: [], avgLen: 0, df: new Map() };
  }
}

// No-op: all writes happen directly in addDocument / removeDocument
function save() {}

// ── Add (or replace) a document ───────────────────────────────────────────
function addDocument(store, { id, name, chunks }) {
  removeDocument(store, id);

  db.transaction(() => {
    db.prepare(
      "INSERT INTO kb_documents (id, name, chunk_count, added_at) VALUES (?, ?, ?, ?)"
    ).run(id, name, chunks.length, Date.now());

    const ins = db.prepare(
      "INSERT INTO kb_chunks (doc_id, doc_name, text, embedding) VALUES (?, ?, ?, ?)"
    );
    // Store tokens (string array) in the embedding column
    for (const c of chunks) ins.run(id, name, c.text, JSON.stringify(c.tokens));
  })();

  store.documents.push({ id, name, chunkCount: chunks.length, addedAt: Date.now() });
  for (const c of chunks) {
    store.chunks.push({ docId: id, docName: name, text: c.text, tokens: c.tokens, tf: _buildTf(c.tokens) });
  }
  _recomputeCorpusStats(store);
}

// ── Remove a document ─────────────────────────────────────────────────────
function removeDocument(store, id) {
  db.prepare("DELETE FROM kb_documents WHERE id = ?").run(id);
  store.documents = store.documents.filter((d) => d.id !== id);
  store.chunks    = store.chunks.filter((c) => c.docId !== id);
  _recomputeCorpusStats(store);
}

// ── BM25 keyword search ───────────────────────────────────────────────────
const K1 = 1.5;
const B  = 0.75;

function search(store, queryTokens, topK = 4, minScore = 0) {
  if (!store.chunks.length || !queryTokens.length) return [];

  // avgLen/df are corpus-wide stats and each chunk's own tf map is fixed
  // once stored -- all precomputed by _recomputeCorpusStats/_buildTf in
  // load()/addDocument()/removeDocument() rather than rebuilt here, since
  // this function runs once per chat message while those only run on a KB
  // write. Previously this rebuilt all of that (an O(total corpus tokens)
  // scan) on every single message regardless of query.
  const N      = store.chunks.length;
  const avgLen = store.avgLen || 1;
  const df     = store.df;

  const uniqueQuery = [...new Set(queryTokens)];

  return store.chunks
    .map((chunk) => {
      const tf  = chunk.tf;
      const len = chunk.tokens.length || 1;

      let score = 0;
      for (const term of uniqueQuery) {
        const tfVal = tf.get(term) || 0;
        if (!tfVal) continue;
        const dfVal = df.get(term) || 0;
        const idf   = Math.log((N - dfVal + 0.5) / (dfVal + 0.5) + 1);
        const norm  = (tfVal * (K1 + 1)) / (tfVal + K1 * (1 - B + B * len / avgLen));
        score      += idf * norm;
      }
      return { text: chunk.text, docName: chunk.docName, score };
    })
    .filter((r) => r.score > minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

module.exports = { load, save, addDocument, removeDocument, search };
