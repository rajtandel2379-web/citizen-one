// Vercel adapter. The application itself remains a regular Node HTTP handler,
// so the same code can run locally, on a VPS, or behind a serverless function.
const { requestHandler, initDbPromise } = require('../server');

module.exports = async (req, res) => {
  await initDbPromise;
  return requestHandler(req, res);
};
