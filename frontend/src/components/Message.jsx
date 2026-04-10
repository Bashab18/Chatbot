import React from "react";
import ReactMarkdown from "react-markdown";

export default function Message({ role, text }) {
  return (
    <div className={`message ${role}`}>
      <div className="bubble">
        {role === "assistant" ? (
          <ReactMarkdown>{text}</ReactMarkdown>
        ) : (
          <p>{text}</p>
        )}
      </div>
    </div>
  );
}
