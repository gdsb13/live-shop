'use strict';

const express = require('express');
const cartService = require('../services/cartService');
const shopperContext = require('../services/shopperContext');

const router = express.Router();

router.get('/', (req, res, next) => {
  try {
    const shopperId = shopperContext.fromRequest(req);
    res.json(cartService.getCart(shopperId));
  } catch (err) {
    next(err);
  }
});

router.post('/items', (req, res, next) => {
  try {
    const shopperId = shopperContext.fromRequest(req);
    const { productId, variantId, quantity, originatingLiveSessionId, liveSessionId } =
      req.body || {};
    if (!productId || !variantId) {
      res.status(400).json({ error: 'productId and variantId are required' });
      return;
    }
    const cart = cartService.addItem(shopperId, {
      productId,
      variantId,
      quantity,
      originatingLiveSessionId: originatingLiveSessionId || liveSessionId || null,
    });
    res.status(201).json(cart);
  } catch (err) {
    next(err);
  }
});

router.patch('/items/:itemId', (req, res, next) => {
  try {
    const shopperId = shopperContext.fromRequest(req);
    const { quantity } = req.body || {};
    if (quantity === undefined) {
      res.status(400).json({ error: 'quantity is required' });
      return;
    }
    const cart = cartService.updateItem(shopperId, req.params.itemId, { quantity });
    res.json(cart);
  } catch (err) {
    next(err);
  }
});

router.delete('/items/:itemId', (req, res, next) => {
  try {
    const shopperId = shopperContext.fromRequest(req);
    const cart = cartService.removeItem(shopperId, req.params.itemId);
    res.json(cart);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
