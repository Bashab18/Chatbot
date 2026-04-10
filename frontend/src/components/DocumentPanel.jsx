import React, { useState, useEffect, useRef } from "react";

function formatDate(ts) {
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function DocumentPanel({ onClose, onDocsChange }) {
  const [documents, setDocuments] = useState([]);
  const [tab, setTab] = useState("file");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState("");
  const [textName, setTextName] = useState("");
  const [textContent, setTextContent] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    fetchDocs();
  }, []);

  const fetchDocs = async () => {
    try {
      const res = await fetch("/api/documents");
      const data = await res.json();
      setDocuments(data.documents || []);
      onDocsChange?.(data.documents?.length ?? 0);
    } catch {}
  };

  const handleFile = async (file) => {
    if (!file) return;
    const allowed = [".txt", ".pdf", ".md"];
    const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
    if (!allowed.includes(ext)) {
      alert("Only .txt, .pdf, and .md files are supported.");
      return;
    }

    setUploading(true);
    setUploadProgress(`Uploading "${file.name}"…`);
    const formData = new FormData();
    formData.append("file", file);

    try {
      setUploadProgress("Generating embeddings…");
      const res = await fetch("/api/documents", { method: "POST", body: formData });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setUploadProgress("");
      await fetchDocs();
    } catch (err) {
      setUploadProgress("");
      alert("Upload failed: " + err.message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const handleTextUpload = async () => {
    if (!textName.trim() || !textContent.trim()) return;
    setUploading(true);
    setUploadProgress("Generating embeddings…");
    try {
      const res = await fetch("/api/documents/text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: textName.trim(), content: textContent }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setTextName("");
      setTextContent("");
      await fetchDocs();
    } catch (err) {
      alert("Failed: " + err.message);
    } finally {
      setUploading(false);
      setUploadProgress("");
    }
  };

  const deleteDoc = async (id) => {
    if (!window.confirm("Remove this document from the knowledge base?")) return;
    try {
      await fetch(`/api/documents/${id}`, { method: "DELETE" });
      const updated = documents.filter((d) => d.id !== id);
      setDocuments(updated);
      onDocsChange?.(updated.length);
    } catch {}
  };

  return (
    <div className="doc-panel">
      {/* Header */}
      <div className="doc-panel-header">
        <div className="doc-panel-title">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style={{ flexShrink: 0 }}>
            <path d="M9.293 0H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V4.707A1 1 0 0 0 13.707 4L10 .293A1 1 0 0 0 9.293 0zM9.5 3.5v-2l3 3h-2a1 1 0 0 1-1-1zM4.5 9a.5.5 0 0 1 0-1h7a.5.5 0 0 1 0 1h-7zM4 10.5a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7a.5.5 0 0 1-.5-.5zm.5 2.5a.5.5 0 0 1 0-1h4a.5.5 0 0 1 0 1h-4z"/>
          </svg>
          <span>Knowledge Base</span>
        </div>
        <button className="icon-btn" onClick={onClose} title="Close">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8 2.146 2.854z"/>
          </svg>
        </button>
      </div>

      {/* Tabs */}
      <div className="doc-tabs">
        <button className={tab === "file" ? "active" : ""} onClick={() => setTab("file")}>
          Upload File
        </button>
        <button className={tab === "text" ? "active" : ""} onClick={() => setTab("text")}>
          Paste Text
        </button>
      </div>

      {/* File upload */}
      {tab === "file" && (
        <div
          className={`drop-zone${dragOver ? " drag-over" : ""}${uploading ? " disabled" : ""}`}
          onClick={() => !uploading && fileRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (!uploading) handleFile(e.dataTransfer.files[0]);
          }}
        >
          <input
            ref={fileRef}
            type="file"
            accept=".txt,.pdf,.md"
            style={{ display: "none" }}
            onChange={(e) => handleFile(e.target.files[0])}
          />
          {uploading ? (
            <>
              <div className="spinner" />
              <span className="drop-hint">{uploadProgress}</span>
            </>
          ) : (
            <>
              <svg width="28" height="28" viewBox="0 0 16 16" fill="currentColor" style={{ opacity: 0.4 }}>
                <path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z"/>
                <path d="M7.646 1.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1-.708.708L8.5 2.707V11.5a.5.5 0 0 1-1 0V2.707L5.354 4.854a.5.5 0 1 1-.708-.708l3-3z"/>
              </svg>
              <span className="drop-hint">
                <strong>Click or drag & drop</strong>
                <br />.txt · .pdf · .md (max 20 MB)
              </span>
            </>
          )}
        </div>
      )}

      {/* Paste text */}
      {tab === "text" && (
        <div className="text-form">
          <input
            className="text-form-input"
            placeholder="Document name"
            value={textName}
            onChange={(e) => setTextName(e.target.value)}
            disabled={uploading}
          />
          <textarea
            className="text-form-area"
            placeholder="Paste your content here…"
            value={textContent}
            onChange={(e) => setTextContent(e.target.value)}
            rows={7}
            disabled={uploading}
          />
          <button
            className="index-btn"
            onClick={handleTextUpload}
            disabled={uploading || !textName.trim() || !textContent.trim()}
          >
            {uploading ? (
              <><div className="spinner sm" /> {uploadProgress}</>
            ) : (
              "Index Text"
            )}
          </button>
        </div>
      )}

      {/* Document list */}
      <div className="doc-list">
        <div className="doc-list-title">
          Indexed Documents
          <span className="doc-count">{documents.length}</span>
        </div>

        {documents.length === 0 ? (
          <div className="doc-empty">No documents indexed yet</div>
        ) : (
          documents.map((doc) => (
            <div key={doc.id} className="doc-item">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style={{ flexShrink: 0, opacity: 0.5 }}>
                <path d="M9.293 0H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V4.707A1 1 0 0 0 13.707 4L10 .293A1 1 0 0 0 9.293 0zM9.5 3.5v-2l3 3h-2a1 1 0 0 1-1-1z"/>
              </svg>
              <div className="doc-info">
                <span className="doc-name">{doc.name}</span>
                <span className="doc-meta">
                  {doc.chunkCount} chunks · {formatDate(doc.addedAt)}
                </span>
              </div>
              <button
                className="icon-btn danger"
                onClick={() => deleteDoc(doc.id)}
                title="Remove"
              >
                <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/>
                  <path fillRule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/>
                </svg>
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
