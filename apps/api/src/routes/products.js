'use strict';

const express = require('express');
const catalogService = require('../services/catalogService');
const discountService = require('../services/discountService');

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

    const { variantId, originatingLiveSessionId, liveSessionId } = req.query;
    const sessionId = originatingLiveSessionId || liveSessionId;
    if (sessionId) {
      const variant =
        catalogService.resolveVariant(product, variantId) ||
        catalogService.pickDefaultVariant(product);
      if (variant) {
        const livePricing = discountService.evaluateLineItem({
          unitPrice: variant.price,
          quantity: 1,
          productId: product.id,
          originatingLiveSessionId: String(sessionId),
        });
        res.json({
          ...product,
          livePricing: {
            variantId: variant.id,
            ...livePricing,
          },
        });
        return;
      }
    }

    res.json(product);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
