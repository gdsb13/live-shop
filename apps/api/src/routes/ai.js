'use strict';

const express = require('express');
const aiService = require('../services/aiService');
const aiLlmProxy = require('../services/aiLlmProxy');
const { runMockAgentTurn } = require('../services/aiLlmProxy');
const { executeTool } = require('../services/aiToolService');
const { ALLOWED_TOOL_NAMES } = require('../services/aiToolDefinitions');

const router = express.Router();

router.get('/status', (_req, res) => {
  res.json({
    configured: Boolean(process.env.AGORA_APP_ID && process.env.AGORA_APP_CERTIFICATE),
    publicBaseConfigured: Boolean(aiService.publicApiBase()),
    mode: aiService.publicApiBase() ? 'agora' : 'local-fallback',
    allowedTools: [...ALLOWED_TOOL_NAMES],
  });
});

router.post('/session/start', async (req, res, next) => {
  try {
    const payload = await aiService.startVoiceSession(req.body || {});
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

router.post('/session/stop', async (req, res, next) => {
  try {
    const { sessionId, shopperUserId } = req.body || {};
    const payload = await aiService.stopVoiceSession(sessionId, shopperUserId);
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

router.get('/session/:sessionId', (req, res, next) => {
  try {
    const payload = aiService.getVoiceSession(req.params.sessionId);
    if (!payload) {
      res.status(404).json({ error: 'Voice AI session not found' });
      return;
    }
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

router.post('/local/turn', (req, res, next) => {
  try {
    const { sessionId, text } = req.body || {};
    const payload = aiService.runLocalTurn(sessionId, text);
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

// OpenAI-compatible endpoint Agora Conversational AI calls for commerce tool reasoning.
router.post('/llm/:channel/chat/completions', async (req, res, next) => {
  try {
    const sessionContext = aiService.attachSessionContextByChannel(req.params.channel);
    req.aiSessionContext = sessionContext || { surface: 'storefront', lastProductIds: [] };

    if (sessionContext) {
      const lastMessage =
        req.body &&
        Array.isArray(req.body.messages) &&
        req.body.messages.length > 0
          ? req.body.messages[req.body.messages.length - 1]
          : null;
      const userText = String((lastMessage && lastMessage.content) || '');
      if (userText) {
        sessionContext.transcripts.push({
          role: 'user',
          text: userText,
          ts: new Date().toISOString(),
        });
      }
    }

    await aiLlmProxy.handleChatCompletions(req, res);

    if (sessionContext && req.aiTurnMeta) {
      const reply = req.aiTurnMeta.reply;
      if (reply) {
        sessionContext.transcripts.push({
          role: 'assistant',
          text: reply,
          ts: new Date().toISOString(),
        });
      }
      aiService.updateSessionFromLlmTurn(req.params.channel, req.aiTurnMeta);
    }
  } catch (err) {
    next(err);
  }
});

router.post('/tools/:toolName', (req, res, next) => {
  try {
    const toolName = req.params.toolName;
    const result = executeTool(toolName, req.body || {}, (req.body && req.body.context) || {});
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/tools/turn', (req, res, next) => {
  try {
    const { text, context } = req.body || {};
    const turn = runMockAgentTurn([{ role: 'user', content: text }], context || {});
    res.json(turn);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
