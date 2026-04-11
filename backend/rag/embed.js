/**
 * Tokenizer for BM25 keyword search.
 * Replaces the old Gemini embedding API — no external calls needed.
 */

const STOPWORDS = new Set([
  "a","an","the","and","or","but","in","on","at","to","for","of","with",
  "by","from","is","are","was","were","be","been","being","have","has",
  "had","do","does","did","will","would","could","should","may","might",
  "shall","can","not","no","nor","so","yet","both","either","neither",
  "each","every","all","some","any","few","more","most","other","such",
  "only","own","same","than","too","very","just","because","as","until",
  "while","although","though","if","then","else","when","where","who",
  "what","which","this","that","these","those","it","its","he","she",
  "they","we","you","i","me","him","her","us","them","their","our","my",
  "your","his","into","about","up","out","over","after","before","also",
]);

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

module.exports = { tokenize };
