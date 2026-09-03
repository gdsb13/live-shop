'use strict';

const express = require('express');
const serviceabilityService = require('../services/serviceabilityService');

const router = express.Router();

router.get('/', (req, res, next) => {
  try {
    const { pin } = req.query;
    if (!pin) {
      res.status(400).json({ error: 'pin query parameter is required' });
      return;
    }
    const result = serviceabilityService.checkServiceability(pin);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
