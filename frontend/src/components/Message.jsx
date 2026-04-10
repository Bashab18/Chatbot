import React, { useState } from "react";
import ReactMarkdown from "react-markdown";

export default function Message({ role, text, msgId, onSpeak, isSpeaking }) {
  const [copied, setCopied] = useState(false);

  const copyToClipboard = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className={`message-row ${role}`}>
      <div className={`avatar ${role}-avatar`}>{role === "user" ? "U" : "G"}</div>
      <div className="message-content">
        <div className="bubble">
          {role === "assistant" ? (
            <ReactMarkdown
              components={{
                code({ inline, className, children, ...props }) {
                  return inline ? (
                    <code className="inline-code" {...props}>{children}</code>
                  ) : (
                    <div className="code-block-wrapper">
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

        {role === "assistant" && (
          <div className="msg-actions">
            {/* Copy */}
            <button className="copy-btn" onClick={copyToClipboard} title="Copy">
              {copied ? (
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0z"/>
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M4 1.5H3a2 2 0 0 0-2 2V14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V3.5a2 2 0 0 0-2-2h-1v1h1a1 1 0 0 1 1 1V14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1h1v-1z"/>
                  <path d="M9.5 1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-3a.5.5 0 0 1-.5-.5v-1a.5.5 0 0 1 .5-.5h3zm-3-1A1.5 1.5 0 0 0 5 1.5v1A1.5 1.5 0 0 0 6.5 4h3A1.5 1.5 0 0 0 11 2.5v-1A1.5 1.5 0 0 0 9.5 0h-3z"/>
                </svg>
              )}
              <span>{copied ? "Copied!" : "Copy"}</span>
            </button>

            {/* Speak */}
            {onSpeak && (
              <button
                className={`copy-btn speak-btn${isSpeaking ? " speaking" : ""}`}
                onClick={() => onSpeak(text, msgId)}
                title={isSpeaking ? "Stop" : "Read aloud"}
              >
                {isSpeaking ? (
                  /* Stop icon */
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M5 3.5h6A1.5 1.5 0 0 1 12.5 5v6a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 11V5A1.5 1.5 0 0 1 5 3.5z"/>
                  </svg>
                ) : (
                  /* Speaker icon */
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M11.536 14.01A8.473 8.473 0 0 0 14.026 8a8.473 8.473 0 0 0-2.49-6.01l-.708.707A7.476 7.476 0 0 1 13.025 8c0 2.071-.84 3.946-2.197 5.303l.708.707z"/>
                    <path d="M10.121 12.596A6.48 6.48 0 0 0 12.025 8a6.48 6.48 0 0 0-1.904-4.596l-.707.707A5.483 5.483 0 0 1 11.025 8a5.483 5.483 0 0 1-1.611 3.889l.707.707z"/>
                    <path d="M8.707 11.182A4.486 4.486 0 0 0 10.025 8a4.486 4.486 0 0 0-1.318-3.182L8 5.525A3.489 3.489 0 0 1 9.025 8 3.49 3.49 0 0 1 8 10.475l.707.707zM6.717 3.55A.5.5 0 0 1 7 4v8a.5.5 0 0 1-.812.39L3.825 10.5H1.5A.5.5 0 0 1 1 10V6a.5.5 0 0 1 .5-.5h2.325l2.363-1.89a.5.5 0 0 1 .529-.06z"/>
                  </svg>
                )}
                <span>{isSpeaking ? "Stop" : "Speak"}</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
