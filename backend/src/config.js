require('dotenv').config();

function required(name, fallback = undefined) {
  const val = process.env[name] ?? fallback;
  return val;
}

module.exports = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '4000', 10),
  corsOrigin: process.env.CORS_ORIGIN || '*',

  databaseUrl: required('DATABASE_URL', './data/clinic.db'),

  jwtSecret: required('JWT_SECRET', 'dev-only-insecure-secret-change-me'),
  jwtExpiresIn: required('JWT_EXPIRES_IN', '8h'),

  ai: {
    // 'anthropic' (default) or 'groq'. Groq is OpenAI-API-compatible,
    // so it's used via the `openai` SDK pointed at Groq's base URL.
    provider: (process.env.AI_PROVIDER || 'anthropic').toLowerCase(),
    apiKey: process.env.AI_API_KEY || '',
    model: process.env.AI_MODEL || 'claude-sonnet-4-6',
    groqApiKey: process.env.GROQ_API_KEY || '',
    groqModel: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
  },

  voice: {
    provider: process.env.VOICE_PROVIDER || 'browser',
    sttApiKey: process.env.STT_API_KEY || '',
    ttsApiKey: process.env.TTS_API_KEY || '',
    providerApiKey: process.env.VOICE_PROVIDER_API_KEY || '',
  },

  notifications: {
    emailApiKey: process.env.EMAIL_API_KEY || '',
    emailFrom: process.env.EMAIL_FROM || 'appointments@example.com',
    whatsappApiKey: process.env.WHATSAPP_API_KEY || '',
    whatsappPhoneId: process.env.WHATSAPP_PHONE_ID || '',
  },

  googleCalendar: {
    clientId: process.env.GOOGLE_CALENDAR_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET || '',
  },

  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
    max: parseInt(process.env.RATE_LIMIT_MAX || '60', 10),
  },
};
