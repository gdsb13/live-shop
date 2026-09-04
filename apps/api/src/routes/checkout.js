'use strict';

const express = require('express');
const checkoutService = require('../services/checkoutService');
const shopperContext = require('../services/shopperContext');

const router = express.Router();

router.post('/', (req, res, next) => {
  try {
    const shopperId = shopperContext.fromRequest(req);
    const { paymentMethod, deliveryPin } = req.body || {};
    const order = checkoutService.checkout({ paymentMethod, deliveryPin, shopperId });
    res.status(201).json(order);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
