'use strict';

const express = require('express');
const liveSessionService = require('../services/liveSessionService');
const chatRelayService = require('../services/chatRelayService');

const router = express.Router();

router.get('/', (_req, res, next) => {
  try {
    const sessions = liveSessionService.listSessions();
    res.json({
      count: sessions.length,
      live: sessions.filter((s) => s.status === 'LIVE'),
      scheduled: sessions.filter((s) => s.status === 'SCHEDULED'),
      ended: sessions.filter((s) => s.status === 'ENDED'),
      sessions,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/chat/messages', (req, res, next) => {
  try {
    const messages = chatRelayService.listMessages(req.params.id);
    res.json({ messages });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/chat/messages', (req, res, next) => {
  try {
    const { sender, text } = req.body || {};
    const message = chatRelayService.postMessage(req.params.id, { sender, text });
    res.status(201).json(message);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', (req, res, next) => {
  try {
    const session = liveSessionService.getSessionById(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Live session not found' });
      return;
    }
    res.json(session);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/start', (req, res, next) => {
  try {
    const session = liveSessionService.startSession(req.params.id);
    res.json(session);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/end', (req, res, next) => {
  try {
    const session = liveSessionService.endSession(req.params.id);
    res.json(session);
  } catch (err) {
    next(err);
  }
});

router.patch('/:id/featured-product', (req, res, next) => {
  try {
    const { productId } = req.body || {};
    if (!productId) {
      res.status(400).json({ error: 'productId is required' });
      return;
    }
    const session = liveSessionService.setFeaturedProduct(req.params.id, productId);
    res.json(session);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
