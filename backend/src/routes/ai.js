const express = require('express');
const router = express.Router();
const agent = require('../ai/agent');
const { toolDefinitions, executeTool } = require('../ai/tools');
const asyncHandler = require('../utils/asyncHandler');
const { ValidationError } = require('../utils/validation');

// Start a new voice or chat session.
router.post('/session', asyncHandler(async (req, res) => {
  const { channel, language } = req.body;
  if (!['voice', 'chat'].includes(channel)) {
    throw new ValidationError('channel must be "voice" or "chat".', 'channel');
  }
  const session = agent.createSession({ channel, language });
  res.status(201).json(session);
}));

// Send one patient message, get the AI's reply (after any real tool calls).
router.post('/message', asyncHandler(async (req, res) => {
  const { session_id, message } = req.body;
  if (!session_id) throw new ValidationError('session_id is required.', 'session_id');
  if (!message || typeof message !== 'string') throw new ValidationError('message is required.', 'message');

  const result = await agent.converse(session_id, message);
  res.json(result);
}));

// Direct tool invocation endpoint (used for admin testing / debugging
// the tool layer independently of the LLM loop).
router.post('/tool', asyncHandler(async (req, res) => {
  const { name, input } = req.body;
  const valid = toolDefinitions.some((t) => t.name === name);
  if (!valid) throw new ValidationError(`Unknown tool: ${name}`, 'name');
  const result = executeTool(name, input || {}, req.body.session_id || null);
  res.json(result);
}));

module.exports = router;
