'use strict';

const fs = require('fs');
const path = require('path');

const productsPath = path.join(__dirname, '../data/products.json');
const products = JSON.parse(fs.readFileSync(productsPath, 'utf8'));

const CATEGORIES = [...new Set(products.map((p) => p.category))].sort();

function listProducts({ category, search } = {}) {
  let result = products;

  if (category) {
    const normalized = category.trim().toLowerCase();
    result = result.filter((p) => p.category.toLowerCase() === normalized);
  }

  if (search) {
    const q = search.trim().toLowerCase();
    result = result.filter((p) => {
      const haystack = [
        p.name,
        p.brand,
        p.description,
        p.category,
        ...(p.features || []),
        ...Object.values(p.specifications || {}),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }

  return result.map(summarizeProduct);
}

function getProductById(id) {
  return products.find((p) => p.id === id) || null;
}

function getVariant(product, variantId) {
  if (!product || !variantId) return null;
  return product.variants.find((v) => v.id === variantId) || null;
}

function summarizeProduct(product) {
  return {
    id: product.id,
    name: product.name,
    category: product.category,
    brand: product.brand,
    description: product.description,
    basePrice: product.basePrice,
    image: product.images[0],
    rating: product.rating,
    inStock: product.inStock,
    variantCount: product.variants.length,
    priceFrom: Math.min(...product.variants.map((v) => v.price)),
  };
}

function getProductsForComparison(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  return ids
    .map((id) => getProductById(id))
    .filter(Boolean)
    .map((product) => ({
      id: product.id,
      name: product.name,
      category: product.category,
      brand: product.brand,
      basePrice: product.basePrice,
      rating: product.rating,
      specifications: product.specifications,
      features: product.features,
      variants: product.variants,
    }));
}

module.exports = {
  CATEGORIES,
  listProducts,
  getProductById,
  getVariant,
  summarizeProduct,
  getProductsForComparison,
};
