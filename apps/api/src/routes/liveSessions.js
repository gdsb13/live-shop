'use strict';

const express = require('express');
const liveSessionService = require('../services/liveSessionService');
const cartService = require('../services/cartService');
const chatRelayService = require('../services/chatRelayService');

const router = express.Router();

router.post('/_test/reset', (_req, res) => {
  if (process.env.ALLOW_TEST_RESET !== '1') {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  liveSessionService.resetSessionsToSeed();
  cartService.resetAllCarts();
  res.json({ ok: true });
});

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

// Same-origin replay stream (proxies demo/recording URL with Range support for HTML5 video).
router.get('/:id/recording', async (req, res, next) => {
  try {
    const session = liveSessionService.getRawSessionById(req.params.id);
    if (!session?.recordingUrl) {
      res.status(404).json({ error: 'Recording not found' });
      return;
    }

    const upstreamHeaders = {};
    if (req.headers.range) {
      upstreamHeaders.Range = req.headers.range;
    }

    const upstream = await fetch(session.recordingUrl, { headers: upstreamHeaders });
    if (!upstream.ok && upstream.status !== 206) {
      res.status(502).json({ error: 'Could not fetch recording asset' });
      return;
    }

    res.status(upstream.status);
    for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
      const value = upstream.headers.get(name);
      if (value) res.setHeader(name, value);
    }
    if (!res.getHeader('content-type')) {
      res.setHeader('Content-Type', 'video/mp4');
    }

    if (!upstream.body) {
      res.end();
      return;
    }

    const { Readable } = require('stream');
    const { pipeline } = require('stream/promises');
    await pipeline(Readable.fromWeb(upstream.body), res);
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
