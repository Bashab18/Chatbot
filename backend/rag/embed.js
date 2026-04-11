const { GoogleGenerativeAI } = require("@google/generative-ai");

let client;
function getClient() {
  if (!client) client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  return client;
}

async function embedText(text) {
  const model = getClient().getGenerativeModel({ model: "embedding-001" });
  const result = await model.embedContent(text);
  return result.embedding.values;
}

module.exports = { embedText };
