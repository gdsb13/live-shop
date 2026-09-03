'use strict';

const express = require('express');
const checkoutService = require('../services/checkoutService');

const router = express.Router();

router.post('/', (req, res, next) => {
  try {
    const { paymentMethod, deliveryPin } = req.body || {};
    const order = checkoutService.checkout({ paymentMethod, deliveryPin });
    res.status(201).json(order);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
