import React, { useState, useEffect, useRef } from "react";
import { useAuth } from "../../context/AuthContext";

export default function KnowledgePage() {
  const { getToken } = useAuth();
  const [documents, setDocuments]   = useState([]);
  const [uploading, setUploading]   = useState(false);
  const [dragOver, setDragOver]     = useState(false);
  const [message, setMessage]       = useState(null); // { type: 'success'|'error', text }
  const [confirmDel, setConfirmDel] = useState(null);
  const fileInputRef = useRef(null);

  async function loadDocs() {
    try {
      const token = getToken();
      const res = await fetch("/api/documents", { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      setDocuments(data.documents ?? []);
    } catch {}
  }

  useEffect(() => { loadDocs(); }, []);

  function showMsg(type, text) {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 4000);
  }

  async function uploadFiles(files) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setMessage(null);
    const fd = new FormData();
    for (const f of files) fd.append("files", f);
    try {
      const token = getToken();
      const res = await fetch("/api/documents", {
        method:  "POST",
        headers: { Authorization: `Bearer ${token}` },
        body:    fd,
      });
      const data = await res.json();
      const ok  = (data.results ?? []).filter((r) => r.ok);
      const bad = (data.results ?? []).filter((r) => !r.ok);
      if (ok.length)  showMsg("success", `${ok.length} file${ok.length > 1 ? "s" : ""} indexed successfully.`);
      if (bad.length) showMsg("error", `Failed: ${bad.map((r) => r.name).join(", ")}`);
      await loadDocs();
    } catch (err) {
      showMsg("error", err.message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function deleteDoc(id) {
    try {
      const token = getToken();
      await fetch(`/api/documents/${id}`, {
        method:  "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      await loadDocs();
      showMsg("success", "Document removed.");
    } catch (err) {
      showMsg("error", err.message);
    }
    setConfirmDel(null);
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    uploadFiles(Array.from(e.dataTransfer.files));
  }

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1>Knowledge Base</h1>
        <p>Upload documents for the chatbot to answer from</p>
      </div>

      {message && (
        <div className={`admin-alert admin-alert-${message.type}`}>{message.text}</div>
      )}

      {/* Drop zone */}
      <div
        className={`drop-zone${dragOver ? " drag-over" : ""}${uploading ? " uploading" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => !uploading && fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.txt,.md"
          style={{ display: "none" }}
          onChange={(e) => uploadFiles(Array.from(e.target.files))}
        />
        {uploading ? (
          <>
            <div className="auth-spinner" />
            <p>Indexing documents…</p>
          </>
        ) : (
          <>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor" className="drop-icon">
              <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM14 13v4h-4v-4H7l5-5 5 5h-3z"/>
            </svg>
            <p><strong>Drop PDF / TXT / MD files here</strong></p>
            <p className="drop-hint">or click to browse · multiple files supported</p>
          </>
        )}
      </div>

      {/* Document list */}
      <div className="admin-section">
        <h2 className="section-title">
          Indexed Documents
          <span className="count-badge">{documents.length}</span>
        </h2>

        {documents.length === 0 ? (
          <div className="admin-empty-card">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor">
              <path d="M9 4.5v15l3-3 3 3v-15h2v15l-5 5-5-5V4.5z" opacity=".3"/>
              <path d="M7 4h14v2H7V4zm0 4h14v2H7V8zm0 4h14v2H7v-2zm-4-8h2v2H3V4zm0 4h2v2H3V8zm0 4h2v2H3v-2z"/>
            </svg>
            <p>No documents indexed yet. Upload files above.</p>
          </div>
        ) : (
          <div className="doc-list">
            {documents.map((doc) => (
              <div key={doc.id} className="doc-item">
                <div className="doc-icon">
                  <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M9.293 0H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V4.707A1 1 0 0 0 13.707 4L10 .293A1 1 0 0 0 9.293 0zM9.5 3.5v-2l3 3h-2a1 1 0 0 1-1-1z"/>
                  </svg>
                </div>
                <div className="doc-info">
                  <span className="doc-name">{doc.name}</span>
                  <span className="doc-meta">{doc.chunks} chunks</span>
                </div>
                <button
                  className="icon-btn danger-btn"
                  title="Remove"
                  onClick={() => setConfirmDel(doc.id)}
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/>
                    <path fillRule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/>
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Confirm delete */}
      {confirmDel && (
        <div className="modal-overlay" onClick={() => setConfirmDel(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Remove document?</h3>
            <p>The document will be removed from the knowledge base. This cannot be undone.</p>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setConfirmDel(null)}>Cancel</button>
              <button className="btn-danger" onClick={() => deleteDoc(confirmDel)}>Remove</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
