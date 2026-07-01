const { assertApiKey, assertPost, handleError, handleOptions, sendJson, transcribe } = require("./_openai");

module.exports = async function handler(req, res) {
  if (handleOptions(req, res)) return;

  try {
    assertPost(req);
    assertApiKey();
    const result = await transcribe(req.body || {});
    sendJson(res, 200, result);
  } catch (error) {
    handleError(res, error);
  }
};
