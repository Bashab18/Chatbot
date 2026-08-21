import React, { useState } from "react";
import ReactMarkdown from "react-markdown";

function formatTime(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function CopyCodeBtn({ code }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }
  return (
    <button className="code-copy-btn" onClick={copy}>
      {copied ? (
        <>
          <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
            <path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0z"/>
          </svg>
          Copied!
        </>
      ) : (
        <>
          <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
            <path d="M4 1.5H3a2 2 0 0 0-2 2V14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V3.5a2 2 0 0 0-2-2h-1v1h1a1 1 0 0 1 1 1V14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1h1v-1z"/>
            <path d="M9.5 1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-3a.5.5 0 0 1-.5-.5v-1a.5.5 0 0 1 .5-.5h3zm-3-1A1.5 1.5 0 0 0 5 1.5v1A1.5 1.5 0 0 0 6.5 4h3A1.5 1.5 0 0 0 11 2.5v-1A1.5 1.5 0 0 0 9.5 0h-3z"/>
          </svg>
          Copy
        </>
      )}
    </button>
  );
}

export default function Message({ role, text, msgId, timestamp, userInitials, assistantAvatar, onSpeak, isSpeaking, refs }) {
  const [copied, setCopied] = useState(false);

  function copyText() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className={`message-row ${role}`}>

      {/* Avatar */}
      <div className={`avatar ${role}-avatar`}>
        {role === "user" ? (
          userInitials ?? "U"
        ) : assistantAvatar ? (
          /* User's chosen avatar, set via the mHealth app's Settings > AI Agent */
          <span className="avatar-emoji">{assistantAvatar}</span>
        ) : (
          /* Sparkle icon fallback for assistant */
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
            <path d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09zM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456z"/>
          </svg>
        )}
      </div>

      {/* Content */}
      <div className="message-content">
        <div className="bubble">
          {role === "assistant" ? (
            <ReactMarkdown
              components={{
                code({ inline, className, children, ...props }) {
                  const lang = (className || "").replace("language-", "");
                  if (inline) {
                    return <code className="inline-code" {...props}>{children}</code>;
                  }
                  return (
                    <div className="code-block-wrapper">
                      <div className="code-block-header">
                        <span className="code-block-lang">{lang || "code"}</span>
                        <CopyCodeBtn code={String(children).replace(/\n$/, "")} />
                      </div>
                      <pre className="code-block">
                        <code {...props}>{children}</code>
                      </pre>
                    </div>
                  );
                },
              }}
            >
              {text}
            </ReactMarkdown>
          ) : (
            <p>{text}</p>
          )}
        </div>

        {/* Sources / references */}
        {role === "assistant" && refs && refs.length > 0 && (
          <details className="msg-refs">
            <summary className="msg-refs-toggle">
              <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
                <path d="M1 2.5A1.5 1.5 0 0 1 2.5 1h3A1.5 1.5 0 0 1 7 2.5v3A1.5 1.5 0 0 1 5.5 7h-3A1.5 1.5 0 0 1 1 5.5v-3zm8 0A1.5 1.5 0 0 1 10.5 1h3A1.5 1.5 0 0 1 15 2.5v3A1.5 1.5 0 0 1 13.5 7h-3A1.5 1.5 0 0 1 9 5.5v-3zm-8 8A1.5 1.5 0 0 1 2.5 9h3A1.5 1.5 0 0 1 7 10.5v3A1.5 1.5 0 0 1 5.5 15h-3A1.5 1.5 0 0 1 1 13.5v-3zm8 0A1.5 1.5 0 0 1 10.5 9h3a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5h-3A1.5 1.5 0 0 1 9 13.5v-3z"/>
              </svg>
              Sources ({refs.length})
            </summary>
            <div className="msg-refs-list">
              {refs.map((r, i) => (
                <div key={i} className={`msg-ref-item${r.type === "web" ? " web" : ""}`}>
                  <span className="msg-ref-name">
                    {r.type === "web" ? (
                      <a href={r.text} target="_blank" rel="noopener noreferrer">{r.name}</a>
                    ) : r.name}
                  </span>
                  {r.type !== "web" && r.text && (
                    <p className="msg-ref-excerpt">{r.text}</p>
                  )}
                </div>
              ))}
            </div>
          </details>
        )}

        {/* Footer: actions + timestamp */}
        <div className="msg-footer">
          {role === "assistant" && (
            <div className="msg-actions">
              <button className="msg-action-btn" onClick={copyText} title="Copy response">
                {copied ? (
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0z"/>
                  </svg>
                ) : (
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M4 1.5H3a2 2 0 0 0-2 2V14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V3.5a2 2 0 0 0-2-2h-1v1h1a1 1 0 0 1 1 1V14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1h1v-1z"/>
                    <path d="M9.5 1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-3a.5.5 0 0 1-.5-.5v-1a.5.5 0 0 1 .5-.5h3zm-3-1A1.5 1.5 0 0 0 5 1.5v1A1.5 1.5 0 0 0 6.5 4h3A1.5 1.5 0 0 0 11 2.5v-1A1.5 1.5 0 0 0 9.5 0h-3z"/>
                  </svg>
                )}
                {copied ? "Copied!" : "Copy"}
              </button>

              {onSpeak && (
                <button
                  className={`msg-action-btn${isSpeaking ? " speaking" : ""}`}
                  onClick={() => onSpeak(text, msgId)}
                  title={isSpeaking ? "Stop" : "Read aloud"}
                >
                  {isSpeaking ? (
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M5 3.5h6A1.5 1.5 0 0 1 12.5 5v6a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 11V5A1.5 1.5 0 0 1 5 3.5z"/>
                    </svg>
                  ) : (
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M11.536 14.01A8.473 8.473 0 0 0 14.026 8a8.473 8.473 0 0 0-2.49-6.01l-.708.707A7.476 7.476 0 0 1 13.025 8c0 2.071-.84 3.946-2.197 5.303l.708.707z"/>
                      <path d="M10.121 12.596A6.48 6.48 0 0 0 12.025 8a6.48 6.48 0 0 0-1.904-4.596l-.707.707A5.483 5.483 0 0 1 11.025 8a5.483 5.483 0 0 1-1.611 3.889l.707.707z"/>
                      <path d="M8.707 11.182A4.486 4.486 0 0 0 10.025 8a4.486 4.486 0 0 0-1.318-3.182L8 5.525A3.489 3.489 0 0 1 9.025 8 3.49 3.49 0 0 1 8 10.475l.707.707zM6.717 3.55A.5.5 0 0 1 7 4v8a.5.5 0 0 1-.812.39L3.825 10.5H1.5A.5.5 0 0 1 1 10V6a.5.5 0 0 1 .5-.5h2.325l2.363-1.89a.5.5 0 0 1 .529-.06z"/>
                    </svg>
                  )}
                  {isSpeaking ? "Stop" : "Speak"}
                </button>
              )}
            </div>
          )}
          {timestamp && <span className="msg-time">{formatTime(timestamp)}</span>}
        </div>
      </div>
    </div>
  );
}
