const { analyze, assertPost, handleError, handleOptions, sendJson } = require("./_openai");

module.exports = async function handler(req, res) {
  if (handleOptions(req, res)) return;

  try {
    assertPost(req);
    const result = await analyze(req.body || {});
    sendJson(res, 200, result);
  } catch (error) {
    handleError(res, error);
  }
};
