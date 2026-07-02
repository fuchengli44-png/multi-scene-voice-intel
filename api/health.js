const { handleOptions, sendJson } = require("./_openai");

module.exports = async function handler(req, res) {
  if (handleOptions(req, res)) return;
  sendJson(res, 200, {
    ok: true,
    hasApiKey: Boolean(process.env.OPENAI_API_KEY),
    hasOpenAIKey: Boolean(process.env.OPENAI_API_KEY),
    hasDeepSeekKey: Boolean(process.env.DEEPSEEK_API_KEY),
    hasGroqKey: Boolean(process.env.GROQ_API_KEY)
  });
};
