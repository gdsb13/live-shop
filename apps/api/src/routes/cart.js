'use strict';

const express = require('express');
const cartService = require('../services/cartService');

const router = express.Router();

router.get('/', (_req, res, next) => {
  try {
    res.json(cartService.getCart());
  } catch (err) {
    next(err);
  }
});

router.post('/items', (req, res, next) => {
  try {
    const { productId, variantId, quantity } = req.body || {};
    if (!productId || !variantId) {
      res.status(400).json({ error: 'productId and variantId are required' });
      return;
    }
    const cart = cartService.addItem({ productId, variantId, quantity });
    res.status(201).json(cart);
  } catch (err) {
    next(err);
  }
});

router.patch('/items/:itemId', (req, res, next) => {
  try {
    const { quantity } = req.body || {};
    if (quantity === undefined) {
      res.status(400).json({ error: 'quantity is required' });
      return;
    }
    const cart = cartService.updateItem(req.params.itemId, { quantity });
    res.json(cart);
  } catch (err) {
    next(err);
  }
});

router.delete('/items/:itemId', (req, res, next) => {
  try {
    const cart = cartService.removeItem(req.params.itemId);
    res.json(cart);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
