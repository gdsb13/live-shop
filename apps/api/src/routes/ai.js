'use strict';

const express = require('express');
const aiService = require('../services/aiService');
const { executeTool } = require('../services/aiToolService');
const { ALLOWED_TOOL_NAMES } = require('../services/aiToolDefinitions');
const { getMcpEndpoint } = require('../mcp/mcpConfig');

const router = express.Router();

router.get('/status', (_req, res) => {
  res.json({
    configured: Boolean(process.env.AGORA_APP_ID && process.env.AGORA_APP_CERTIFICATE),
    publicBaseConfigured: Boolean(aiService.publicApiBase()),
    mcpEndpoint: getMcpEndpoint() || null,
    managedLlmModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    externalLlmKeyRequired: false,
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

router.post('/session/activate', async (req, res, next) => {
  try {
    const { sessionId, shopperUserId } = req.body || {};
    const payload = await aiService.activateVoiceSession(sessionId, shopperUserId);
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

// Direct tool invocation for deterministic tests and debugging.
router.post('/tools/:toolName', (req, res, next) => {
  try {
    const toolName = req.params.toolName;
    const bodyContext = (req.body && req.body.context) || {};
    const sessionContext = {
      ...bodyContext,
      shopperUserId:
        req.headers['x-shopper-id'] ||
        req.headers['X-Shopper-Id'] ||
        bodyContext.shopperUserId ||
        null,
    };
    const result = executeTool(toolName, req.body || {}, sessionContext);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
