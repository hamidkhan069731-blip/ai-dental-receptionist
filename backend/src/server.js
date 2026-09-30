const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const config = require('./config');
const { migrate } = require('./db/schema');
const { apiLimiter } = require('./middleware/rateLimiter');
const { errorHandler, notFound } = require('./middleware/errorHandler');

// Ensure schema exists on boot (idempotent — safe to run every start).
migrate();

const app = express();

app.use(helmet({ contentSecurityPolicy: false })); // CSP relaxed for the bundled static frontend; tighten in production behind a real CDN/CSP.
app.use(cors({ origin: config.corsOrigin, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use('/api', apiLimiter);

// ---- API routes ----
app.use('/api/clinic', require('./routes/clinic'));
app.use('/api/doctors', require('./routes/doctors'));
app.use('/api/services', require('./routes/services'));
app.use('/api/patients', require('./routes/patients'));
app.use('/api/appointments', require('./routes/appointments'));
app.use('/api/ai', require('./routes/ai'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/notifications', require('./routes/notifications'));

app.get('/api/health', (req, res) => res.json({ ok: true, env: config.env, time: new Date().toISOString() }));

// ---- Static frontend (patient website + admin dashboard) ----
const frontendDir = path.resolve(__dirname, '../../frontend');
app.use(express.static(frontendDir));
app.use('/admin', express.static(path.join(frontendDir, 'admin')));

app.get('/admin', (req, res) => res.sendFile(path.join(frontendDir, 'admin', 'index.html')));
app.get('/', (req, res) => res.sendFile(path.join(frontendDir, 'index.html')));

app.use('/api', notFound);
app.use(errorHandler);

// Only bind a port when this file is run directly (`node src/server.js`
// or `npm start`). When required by the test suite via supertest, the
// app is exercised in-process without listening on a real socket, so
// parallel test files never collide over the same port.
if (require.main === module) {
  app.listen(config.port, () => {
    console.log(`✔ AI Dental Receptionist backend running on http://localhost:${config.port}`);
    console.log(`  Patient site:  http://localhost:${config.port}/`);
    console.log(`  Admin panel:   http://localhost:${config.port}/admin`);
    if (!config.ai.apiKey) {
      console.warn('  ⚠ AI_API_KEY is not set — the AI receptionist will return a friendly "unavailable" message until configured.');
    }
  });
}

module.exports = app;
