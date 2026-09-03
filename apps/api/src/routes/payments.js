'use strict';

const express = require('express');
const paymentOptionsService = require('../services/paymentOptionsService');

const router = express.Router();

router.get('/', (_req, res) => {
  res.json(paymentOptionsService.listPaymentOptions());
});

module.exports = router;
