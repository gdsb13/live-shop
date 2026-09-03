'use strict';

const express = require('express');
const chatRelayService = require('../services/chatRelayService');

const router = express.Router();

router.get('/:sessionId', (req, res, next) => {
  try {
    const messages = chatRelayService.listMessages(req.params.sessionId);
    res.json({ messages });
  } catch (err) {
    next(err);
  }
});

router.post('/:sessionId', (req, res, next) => {
  try {
    const { sender, text } = req.body || {};
    const message = chatRelayService.postMessage(req.params.sessionId, { sender, text });
    res.status(201).json(message);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
