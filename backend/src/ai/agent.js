const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai');
const { v4: uuid } = require('uuid');
const config = require('../config');
const db = require('../db');
const { buildSystemPrompt } = require('./systemPrompt');
const { toolDefinitions, executeTool, toOpenAITools } = require('./tools');

const FRIENDLY_FAILURE = "Sorry, I'm having trouble connecting right now. Please try again or contact the clinic directly.";

// ---- Provider clients -------------------------------------------------

let anthropicClient = null;
function getAnthropicClient() {
  if (!config.ai.apiKey) {
    throw Object.assign(new Error('AI_API_KEY is not configured.'), { code: 'AI_NOT_CONFIGURED', statusCode: 503 });
  }
  if (!anthropicClient) anthropicClient = new Anthropic({ apiKey: config.ai.apiKey });
  return anthropicClient;
}

let groqClient = null;
function getGroqClient() {
  if (!config.ai.groqApiKey) {
    throw Object.assign(new Error('GROQ_API_KEY is not configured.'), { code: 'AI_NOT_CONFIGURED', statusCode: 503 });
  }
  if (!groqClient) {
    // Groq's API is OpenAI-compatible, so the official `openai` SDK
    // works unmodified — only the baseURL and key differ.
    groqClient = new OpenAI({ apiKey: config.ai.groqApiKey, baseURL: 'https://api.groq.com/openai/v1' });
  }
  return groqClient;
}

// ---- Session / message persistence (shared by both providers) --------

function createSession({ channel, language }) {
  const id = uuid();
  db.run(
    `INSERT INTO conversation_sessions (id, channel, language, status) VALUES (?, ?, ?, 'active')`,
    [id, channel, language || 'en']
  );
  return { id, channel, language: language || 'en' };
}

function getSessionHistory(sessionId) {
  return db.all(
    `SELECT role, content, tool_name FROM conversation_messages WHERE session_id = ? ORDER BY created_at`,
    [sessionId]
  );
}

function saveMessage(sessionId, role, content, toolName = null) {
  db.run(
    `INSERT INTO conversation_messages (id, session_id, role, content, tool_name) VALUES (?, ?, ?, ?, ?)`,
    [uuid(), sessionId, role, typeof content === 'string' ? content : JSON.stringify(content), toolName]
  );
}

function safeParse(content) {
  if (typeof content !== 'string') return content;
  try {
    return JSON.parse(content);
  } catch {
    return content;
  }
}

/**
 * Runs one turn of the conversation. Dispatches to the configured
 * provider (AI_PROVIDER=anthropic|groq) — both real, both doing real
 * tool-calling against the live database. Call sites (routes/ai.js)
 * never need to know which provider is active.
 */
async function converse(sessionId, userMessage) {
  const session = db.get('SELECT * FROM conversation_sessions WHERE id = ?', [sessionId]);
  if (!session) throw Object.assign(new Error('Session not found.'), { statusCode: 404 });

  saveMessage(sessionId, 'user', userMessage);

  const history = getSessionHistory(sessionId).filter((m) => m.role === 'user' || m.role === 'assistant');
  const system = buildSystemPrompt();

  const result =
    config.ai.provider === 'groq'
      ? await converseGroq(sessionId, system, history)
      : await converseAnthropic(sessionId, system, history);

  db.run(`UPDATE conversation_sessions SET updated_at = datetime('now') WHERE id = ?`, [sessionId]);
  return { ...result, sessionId };
}

// ---- Anthropic tool-calling loop --------------------------------------

async function converseAnthropic(sessionId, system, history) {
  const anthropic = getAnthropicClient();
  // Anthropic's own message content blocks were saved as-is by a
  // previous turn (see the assistant push below) — reload them
  // unchanged; plain user string turns are fine too.
  const messages = history.map((m) => ({ role: m.role, content: safeParse(m.content) }));

  let loopGuard = 0;
  let finalText = '';
  let toolEvents = [];

  while (loopGuard < 6) {
    loopGuard += 1;

    let response;
    try {
      response = await anthropic.messages.create({
        model: config.ai.model,
        max_tokens: 1024,
        system,
        tools: toolDefinitions,
        messages,
      });
    } catch (err) {
      console.error('[ai-agent] Anthropic API call failed:', err.message);
      throw Object.assign(new Error(FRIENDLY_FAILURE), { code: 'AI_UPSTREAM_FAILURE', statusCode: 503 });
    }

    const toolUses = response.content.filter((b) => b.type === 'tool_use');
    const textBlocks = response.content.filter((b) => b.type === 'text');
    finalText = textBlocks.map((b) => b.text).join('\n').trim();

    messages.push({ role: 'assistant', content: response.content });
    saveMessage(sessionId, 'assistant', response.content);

    if (toolUses.length === 0 || response.stop_reason !== 'tool_use') break;

    const toolResults = [];
    for (const call of toolUses) {
      let result;
      try {
        result = executeTool(call.name, call.input, sessionId);
      } catch (err) {
        result = { error: err.message || 'Tool execution failed.' };
      }
      toolEvents.push({ name: call.name, input: call.input, result });
      toolResults.push({ type: 'tool_result', tool_use_id: call.id, content: JSON.stringify(result) });
      saveMessage(sessionId, 'tool', { name: call.name, input: call.input, result }, call.name);
    }
    messages.push({ role: 'user', content: toolResults });
  }

  if (!finalText) finalText = FRIENDLY_FAILURE;
  return { text: finalText, toolEvents };
}

// ---- Groq (OpenAI-compatible) tool-calling loop ------------------------

async function converseGroq(sessionId, system, history) {
  const groq = getGroqClient();
  const tools = toOpenAITools();

  // User turns were saved as plain strings; assistant turns were saved
  // as the full OpenAI message object (role/content/tool_calls) — reload
  // each in its native shape rather than re-wrapping it.
  const messages = [
    { role: 'system', content: system },
    ...history.map((m) => (m.role === 'assistant' ? safeParse(m.content) : { role: 'user', content: m.content })),
  ];

  let loopGuard = 0;
  let finalText = '';
  let toolEvents = [];

  while (loopGuard < 6) {
    loopGuard += 1;

    let response;
    try {
      response = await groq.chat.completions.create({
        model: config.ai.groqModel,
        max_tokens: 1024,
        messages,
        tools,
        tool_choice: 'auto',
      });
    } catch (err) {
      console.error('[ai-agent] Groq API call failed:', err.message);
      throw Object.assign(new Error(FRIENDLY_FAILURE), { code: 'AI_UPSTREAM_FAILURE', statusCode: 503 });
    }

    const choice = response.choices[0];
    const msg = choice.message;
    finalText = (msg.content || '').trim();

    messages.push(msg);
    saveMessage(sessionId, 'assistant', msg);

    const calls = msg.tool_calls || [];
    if (calls.length === 0 || choice.finish_reason !== 'tool_calls') break;

    for (const call of calls) {
      let input = {};
      try {
        input = JSON.parse(call.function.arguments || '{}');
      } catch {
        input = {};
      }
      let result;
      try {
        result = executeTool(call.function.name, input, sessionId);
      } catch (err) {
        result = { error: err.message || 'Tool execution failed.' };
      }
      toolEvents.push({ name: call.function.name, input, result });
      const toolMsg = { role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) };
      messages.push(toolMsg);
      saveMessage(sessionId, 'tool', toolMsg, call.function.name);
    }
  }

  if (!finalText) finalText = FRIENDLY_FAILURE;
  return { text: finalText, toolEvents };
}

module.exports = { createSession, converse, getSessionHistory };
