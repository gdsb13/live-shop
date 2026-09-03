'use strict';

const express = require('express');
const agoraService = require('../services/agoraService');
const hostClaimService = require('../services/hostClaimService');

const router = express.Router();

router.get('/status', (_req, res, next) => {
  try {
    res.json(agoraService.getPublicConfig());
  } catch (err) {
    next(err);
  }
});

router.get('/host-status/:sessionId', (req, res, next) => {
  try {
    res.json(hostClaimService.getStatus(req.params.sessionId));
  } catch (err) {
    next(err);
  }
});

router.post('/host-claim', (req, res, next) => {
  try {
    const { liveSessionId, userId } = req.body || {};
    const payload = hostClaimService.claimHost(liveSessionId, userId);
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

router.post('/host-heartbeat', (req, res, next) => {
  try {
    const { liveSessionId, userId } = req.body || {};
    const payload = hostClaimService.heartbeat(liveSessionId, userId);
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

router.post('/host-release', (req, res, next) => {
  try {
    const { liveSessionId, userId } = req.body || {};
    const payload = hostClaimService.releaseHost(liveSessionId, userId);
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

router.post('/rtc-token', (req, res, next) => {
  try {
    const { liveSessionId, userId, role } = req.body || {};
    const payload = agoraService.issueRtcToken({ liveSessionId, userId, role });
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

router.post('/rtm-token', (req, res, next) => {
  try {
    const { liveSessionId, userId } = req.body || {};
    const payload = agoraService.issueRtmToken({ liveSessionId, userId });
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
