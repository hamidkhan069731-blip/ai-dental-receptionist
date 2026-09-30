# AI Dental Receptionist — Smile Dental Clinic

A production-architected AI voice/chat receptionist for a dental clinic. Patients talk (or type) to
**Dr. Clinic AI Receptionist**, which checks real doctor availability and books, cancels, or reschedules
appointments through a real backend — no invented data, no fake responses.

---

## 1. What's actually real here vs. what needs your keys

Everything is wired to a **real backend**: a real database, real REST API, real appointment/availability
engine with double-booking prevention, real Anthropic tool-calling, real auth. Nothing is mocked at the
data layer. Two integration points need your own credentials to go fully live:

| Piece | Default (works out of the box) | Production option |
|---|---|---|
| AI brain | Disabled with a friendly "unavailable" message until you set `AI_API_KEY` | Anthropic API (`AI_API_KEY` in `.env`) |
| Speech-to-text / Text-to-speech | Browser's built-in Web Speech API (free, zero setup, works in Chrome/Edge) | Any provider (Deepgram, ElevenLabs, Twilio, etc.) — see §7 |
| Database | SQLite file, zero setup | PostgreSQL — see §8 |
| SMS / WhatsApp | Logged only (no credentials configured) | Twilio / WhatsApp Business API — see §6 |
| Email | Logged only | Any transactional email API — see §6 |

The **booking logic itself** (availability calculation, slot locking, double-booking prevention,
cancel/reschedule) is fully real and fully tested regardless of which providers you plug in.

---

## 2. Project structure

```
/backend
  /src
    /db            Database connection + schema migration + seed data
    /services      Business logic: patients, doctors, appointments, clinic settings
    /ai            System prompt, tool definitions, tool-calling agent loop
    /notifications NotificationService abstraction (email/SMS/WhatsApp)
    /routes        Express route handlers (thin — call services)
    /middleware    Auth (JWT), error handling, rate limiting
    /utils         Availability engine, validation, .ics generator
  /tests           Jest test suite
/frontend
  index.html       Patient-facing clinic website + voice/chat widget
  /assets          CSS + JS for the patient site and widget
  /admin           Admin dashboard (separate HTML/JS/CSS)
/database
  schema.sql       PostgreSQL DDL reference for production
```

Business logic lives entirely in `backend/src/services` and `backend/src/utils` — routes are thin
wrappers, and the AI tool layer (`backend/src/ai/tools.js`) calls the exact same service functions the
REST API uses, so voice, chat, and direct API callers all go through one real code path.

---

## 3. Quick start (development)

Requires Node.js 18+.

```bash
cd backend
cp .env.example .env        # already done for you in this delivery
npm install
npm run setup                # runs migration + seeds demo data
npm run dev                  # starts the server with auto-reload
```

Then open:
- Patient site: **http://localhost:4000/**
- Admin dashboard: **http://localhost:4000/admin**
  - Login: `admin@smiledental.example` / `Admin@123`

The AI receptionist will respond with a graceful "trouble connecting" message until you add a real
`AI_API_KEY` to `.env` (see §5). Everything else — browsing services/doctors, the admin dashboard,
booking via the REST API directly — works immediately.

### Running without `npm run dev`
```bash
npm start
```

### Re-seeding demo data at any time
```bash
npm run seed
```
This is idempotent — it clears and recreates demo doctors, services, FAQs, and a sample patient/appointment.
It does **not** touch admin users' passwords beyond the one demo admin account.

---

## 4. Testing

```bash
cd backend
npm test
```

33 tests cover: slot generation (working hours, holidays, past dates, malformed input), double-booking
prevention, cancel/reschedule (including the rollback path when a reschedule target is already taken),
patient validation, JWT auth (login, protected routes, missing/invalid tokens), and the API layer via
`supertest`. Tests run against a dedicated `data/test.db` file, never your dev/demo database.

---

## 5. Connecting the real AI (Anthropic or Groq)

The app supports two providers out of the box, switched with one variable — `AI_PROVIDER` — in
`backend/.env`. Both run the exact same real tool-calling loop against the exact same 12 tools and the
same live database; nothing else in the app changes.

### Option A — Anthropic (default)
1. Get an API key from the Anthropic Console.
2. In `backend/.env`:
   ```
   AI_PROVIDER=anthropic
   AI_API_KEY=sk-ant-...
   AI_MODEL=claude-sonnet-4-6
   ```

### Option B — Groq
Groq's API is OpenAI-compatible, so the backend talks to it via the official `openai` npm package
pointed at Groq's base URL (`https://api.groq.com/openai/v1`) — see `backend/src/ai/agent.js`.
1. Get a free API key at **https://console.groq.com/keys**.
2. In `backend/.env`:
   ```
   AI_PROVIDER=groq
   GROQ_API_KEY=gsk_...
   GROQ_MODEL=llama-3.3-70b-versatile
   ```
   (`llama-3.3-70b-versatile` supports tool calling and is a solid default; any current Groq
   tool-calling-capable model works.)

Restart the server after changing either. The AI receptionist is now live.

The agent loop (`backend/src/ai/agent.js`) sends the conversation plus **all 12 tool definitions**
(`backend/src/ai/tools.js`) to Claude on every turn. When Claude calls a tool, the backend executes it
against the real database and feeds the result back — up to 6 tool round-trips per turn as a safety
valve against runaway loops. Every tool call, booking, cancellation, reschedule, and human handoff is
written to `audit_logs` and visible in the admin dashboard's Conversation Logs page.

The system prompt (`backend/src/ai/systemPrompt.js`) is **rebuilt from the live database on every
session** — clinic name, address, hours, and FAQs are injected fresh, so the AI is structurally
prevented from drifting out of sync with what's actually configured in the admin panel.

---

## 6. Connecting notifications (email / SMS / WhatsApp)

`backend/src/notifications/NotificationService.js` is a single abstraction with `sendEmail`, `sendSMS`,
and `sendWhatsApp`. Right now, calling any of them **logs the attempt to the `notifications` table**
(visible via the API) and prints to the console — nothing fails, nothing pretends to have sent something
it didn't.

To go live:
- **Email**: set `EMAIL_API_KEY` and wire your provider's SDK call inside `sendEmail()`.
- **WhatsApp**: set `WHATSAPP_API_KEY` and `WHATSAPP_PHONE_ID`, then wire the WhatsApp Business API call
  inside `sendWhatsApp()`. No other code changes — `book_appointment`'s confirmation flow already calls
  through this service.
- **SMS**: same pattern inside `sendSMS()`.

---

## 7. Connecting a production voice provider

The default voice pipeline runs entirely in the browser:

```
Microphone → Web Speech API (STT) → /api/ai/message → Claude + tools → Web Speech Synthesis (TTS)
```

This is a genuine STT→LLM→tools→TTS pipeline — it just uses the browser's free, built-in engine instead
of a paid vendor, so the app works with zero voice-provider setup. Latency is low because turns are
short and the tool-calling loop talks directly to your own database (no external API round-trip for
availability data).

To swap in a dedicated provider (Deepgram, ElevenLabs, Twilio Voice, etc.) for lower-latency streaming
or better multilingual accuracy:
1. Set `VOICE_PROVIDER`, `STT_API_KEY`, `TTS_API_KEY` in `.env`.
2. Replace the `startRecognition`/`stopRecognition` and `speak` functions in
   `frontend/assets/js/main.js` with calls to that provider's SDK (typically a WebSocket for streaming
   STT and a fetch/stream for TTS audio playback).
3. No backend changes needed — `/api/ai/message` already accepts plain text turns regardless of how the
   text was produced.

---

## 8. Migrating to PostgreSQL

The app ships on SQLite (`better-sqlite3`) for zero-setup local development. `database/schema.sql` is a
field-for-field Postgres translation of `backend/src/db/schema.js`, including an extra unique index that
enforces double-booking prevention at the database level (belt-and-suspenders alongside the application
transaction in `appointmentService.bookAppointment`).

To migrate:
1. Provision a Postgres database and run `database/schema.sql` against it.
2. Set `DATABASE_URL=postgres://user:pass@host:5432/dbname` in `.env`.
3. Replace `backend/src/db/index.js` with a `pg`-based adapter exporting the same `get`/`all`/`run`/
   `transaction` functions used throughout `services/` — no other file needs to change, since all
   queries are plain parameterized SQL compatible with both engines.
4. Re-run `npm run seed` against the new database.

---

## 9. Security notes

- Passwords are hashed with bcrypt; admin routes require a valid JWT (`requireAuth`), and mutating admin
  routes additionally require the `admin` role (`requireRole('admin')`).
- All input is validated server-side (`backend/src/utils/validation.js`) — dates, times, phone numbers,
  emails — before touching the database.
- Rate limiting is applied to all `/api` routes (`express-rate-limit`, configurable via `.env`).
- `helmet` sets standard security headers; CORS is restricted to `CORS_ORIGIN`.
- All SQL is parameterized (no string concatenation) — no SQL injection surface.
- Technical error details are logged server-side only; patients only ever see the safe, generic message
  defined in `backend/src/middleware/errorHandler.js`.
- **Never commit `.env`.** `.env.example` contains only placeholders.

---

## 10. Deployment

### Backend
Any Node.js host (Render, Railway, Fly.io, a VPS with PM2, etc.) works. Steps:
```bash
npm ci --omit=dev
npm run migrate     # or run database/schema.sql against Postgres
npm run seed         # optional — only for demo data
NODE_ENV=production npm start
```
Set all `.env` values as real environment variables on the host — do not ship a `.env` file to
production.

### Frontend
The Express server already serves `/frontend` as static files (including `/admin`), so **no separate
frontend deployment is required** — deploying the backend deploys the whole app. If you prefer a
separate static host (Vercel/Netlify) for the patient site, point it at `/frontend` and set
`CORS_ORIGIN` on the backend to that domain.

### Domain & HTTPS
Put the Node process behind a reverse proxy (Nginx, Caddy, or your host's built-in TLS termination) for
HTTPS. Microphone access in the voice widget requires a secure context (HTTPS or `localhost`) — it will
not work over plain HTTP on a real domain.

### Environment variables in production
At minimum: `NODE_ENV=production`, `DATABASE_URL`, `JWT_SECRET` (long random string, not the dev
default), `AI_API_KEY`, `CORS_ORIGIN` (your real domain).

---

## 11. Demo credentials

- Admin dashboard: `admin@smiledental.example` / `Admin@123` — **change this immediately in any real
  deployment.**
- Demo doctors: Dr Ahmed Khan (General Dentist), Dr Sara Ali (Orthodontist).
- Demo patient: Ali Khan, `+923001234567`, with one sample confirmed appointment.

## 12. Full API reference

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/clinic` | – | Clinic info + FAQs |
| GET | `/api/doctors` | – | List doctors |
| GET | `/api/doctors/:id` | – | Doctor detail |
| GET | `/api/doctors/:id/schedule` | – | Weekly working windows |
| GET | `/api/doctors/:id/availability?date=` | – | Real open slots for a date |
| GET | `/api/services` | – | List services |
| POST | `/api/patients` | – | Create/update patient by phone |
| GET | `/api/patients/lookup?phone=` | – | Find patient by phone |
| GET | `/api/appointments` | – | List appointments (filters: date, doctor_id, status) |
| GET | `/api/appointments/:id` | – | Appointment detail |
| GET | `/api/appointments/:id/ics` | – | Download .ics calendar file |
| POST | `/api/appointments` | – | Book an appointment |
| PATCH | `/api/appointments/:id` | – | Cancel or reschedule |
| DELETE | `/api/appointments/:id` | – | Cancel (alias) |
| POST | `/api/ai/session` | – | Start a voice/chat session |
| POST | `/api/ai/message` | – | Send a turn, get AI reply + tool events |
| POST | `/api/ai/tool` | – | Direct tool invocation (debugging) |
| POST | `/api/notifications` | – | Manually trigger a notification |
| POST | `/api/admin/login` | – | Admin login |
| GET | `/api/admin/dashboard` | JWT | Dashboard stats |
| GET/POST/PATCH/DELETE | `/api/admin/doctors...` | JWT | Doctor management |
| PUT | `/api/admin/doctors/:id/schedule` | JWT (admin) | Set weekly schedule |
| POST | `/api/admin/doctors/:id/holidays` | JWT (admin) | Add a holiday |
| GET/POST/PATCH | `/api/admin/services...` | JWT | Service management |
| GET/POST | `/api/admin/faqs` | JWT | FAQ management |
| GET/PUT | `/api/admin/settings...` | JWT | Clinic settings |
| GET | `/api/admin/conversations` | JWT | Conversation session logs |
| GET | `/api/admin/conversations/:id/messages` | JWT | Full transcript of a session |
