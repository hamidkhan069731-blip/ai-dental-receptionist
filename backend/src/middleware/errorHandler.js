const { ValidationError } = require('../utils/validation');

// Maps known internal error codes to safe, patient-facing messages.
// Technical details are logged server-side but never sent to the client.
function errorHandler(err, req, res, next) {
  console.error('[error]', err.name || 'Error', '-', err.message);
  if (err.stack && process.env.NODE_ENV !== 'production') {
    console.error(err.stack);
  }

  if (err instanceof ValidationError || err.name === 'ValidationError') {
    return res.status(err.statusCode || 400).json({ error: err.message, field: err.field, code: err.code });
  }

  if (err.code === 'AI_NOT_CONFIGURED') {
    return res.status(503).json({
      error: "Sorry, I'm having trouble connecting right now. Please try again or contact the clinic directly.",
      code: 'AI_NOT_CONFIGURED',
    });
  }

  if (err.statusCode) {
    return res.status(err.statusCode).json({ error: err.message });
  }

  // Unknown/unexpected error — never leak internals to the patient.
  return res.status(500).json({ error: 'Something went wrong. Please try again shortly.' });
}

function notFound(req, res) {
  res.status(404).json({ error: 'Not found.' });
}

module.exports = { errorHandler, notFound };
