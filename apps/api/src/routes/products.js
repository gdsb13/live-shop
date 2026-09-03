'use strict';

const express = require('express');
const catalogService = require('../services/catalogService');

const router = express.Router();

router.get('/', (req, res, next) => {
  try {
    const { category, search } = req.query;
    const products = catalogService.listProducts({ category, search });
    res.json({
      categories: catalogService.CATEGORIES,
      count: products.length,
      products,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', (req, res, next) => {
  try {
    const product = catalogService.getProductById(req.params.id);
    if (!product) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }
    res.json(product);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
