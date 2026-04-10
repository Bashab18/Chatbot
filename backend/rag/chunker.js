/**
 * Split text into overlapping word-count chunks.
 * chunkWords: target words per chunk
 * overlapWords: words shared between adjacent chunks
 */
function chunkText(text, chunkWords = 400, overlapWords = 60) {
  const cleaned = text
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const words = cleaned.split(/\s+/).filter(Boolean);
  const chunks = [];
  let i = 0;

  while (i < words.length) {
    const end = Math.min(i + chunkWords, words.length);
    const chunk = words.slice(i, end).join(" ");
    if (chunk.length > 40) chunks.push(chunk);
    if (end === words.length) break;
    i += chunkWords - overlapWords;
  }

  return chunks;
}

module.exports = { chunkText };
