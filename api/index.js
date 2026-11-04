// Vercel adapter. The application itself remains a regular Node HTTP handler,
// so the same code can run locally, on a VPS, or behind a serverless function.
module.exports = require('../server').requestHandler;
