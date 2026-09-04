'use strict';

const fs = require('fs');
const path = require('path');

const productsPath = path.join(__dirname, '../data/products.json');
const products = JSON.parse(fs.readFileSync(productsPath, 'utf8'));

const CATEGORIES = [...new Set(products.map((p) => p.category))].sort();

const SEARCH_STOPWORDS = new Set([
  'a', 'an', 'the', 'any', 'are', 'is', 'am', 'in', 'on', 'at', 'to', 'for', 'of', 'or', 'and',
  'your', 'my', 'me', 'you', 'i', 'if', 'there', 'can', 'could', 'please', 'tell', 'show', 'find',
  'get', 'have', 'has', 'do', 'does', 'did', 'available', 'stock', 'want', 'looking', 'need',
  'buy', 'some', 'with', 'from', 'that', 'this', 'what', 'which', 'about', 'them', 'they',
  'we', 'us', 'it', 'its', 'also', 'just', 'one', 'ones',
]);

function normalizeSearchText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\w\s'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stemToken(token) {
  if (token.length <= 3) return token;
  if (token.endsWith('ies') && token.length > 4) return `${token.slice(0, -3)}y`;
  if (/(?:ses|xes|zes|ches|shes)$/.test(token) && token.length > 4) return token.slice(0, -2);
  if (token.endsWith('es') && token.length > 4) return token.slice(0, -2);
  if (token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
  return token;
}

function tokenMatchesHaystack(haystack, token) {
  const stem = stemToken(token);
  return haystack.includes(token) || haystack.includes(stem);
}

function contentTokens(query) {
  return normalizeSearchText(query)
    .split(/\s+/)
    .filter((token) => token.length > 1 && !SEARCH_STOPWORDS.has(token));
}

function productHaystack(product) {
  return [
    product.name,
    product.brand,
    product.description,
    product.category,
    product.id,
    ...(product.keywords || []),
    ...(product.features || []),
    ...Object.values(product.specifications || {}),
  ]
    .join(' ')
    .toLowerCase();
}

function listProducts({ category, search } = {}) {
  let result = products;

  if (category) {
    const normalized = category.trim().toLowerCase();
    const exact = result.filter((p) => p.category.toLowerCase() === normalized);
    if (exact.length > 0) {
      result = exact;
    } else {
      const fuzzy = result.filter(
        (p) =>
          p.category.toLowerCase().includes(normalized) ||
          normalized.includes(p.category.toLowerCase()),
      );
      if (fuzzy.length > 0) {
        result = fuzzy;
      }
    }
  }

  if (search) {
    const q = normalizeSearchText(search);
    const tokens = contentTokens(q);
    result = result
      .map((product) => {
        const haystack = productHaystack(product);
        let score = 0;
        if (q && haystack.includes(q)) score += 10;
        for (const token of tokens) {
          if (tokenMatchesHaystack(haystack, token)) score += 1;
        }
        return { product, score };
      })
      .filter((entry) => (tokens.length === 0 ? Boolean(q) && entry.score > 0 : entry.score > 0))
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.product);
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

function pickDefaultVariant(product) {
  if (!product || !Array.isArray(product.variants) || product.variants.length === 0) {
    return null;
  }
  return product.variants.find((variant) => variant.inStock) || product.variants[0];
}

// Match variant id, display name, sku, or partial name hints from voice/LLM input.
function resolveVariant(product, variantHint) {
  if (!product || !Array.isArray(product.variants) || product.variants.length === 0) {
    return null;
  }

  const hint = String(variantHint || '').trim();
  if (!hint) {
    return pickDefaultVariant(product);
  }

  const exact = product.variants.find((variant) => variant.id === hint);
  if (exact) return exact;

  const lower = hint.toLowerCase();
  const byId = product.variants.find((variant) => variant.id.toLowerCase() === lower);
  if (byId) return byId;

  const byName = product.variants.find((variant) => variant.name.toLowerCase() === lower);
  if (byName) return byName;

  const bySku = product.variants.find(
    (variant) => String(variant.sku || '').toLowerCase() === lower,
  );
  if (bySku) return bySku;

  const byPartialName = product.variants.find(
    (variant) =>
      variant.name.toLowerCase().includes(lower) || lower.includes(variant.name.toLowerCase()),
  );
  if (byPartialName) return byPartialName;

  return null;
}

function summarizeProduct(product) {
  return {
    id: product.id,
    name: product.name,
    category: product.category,
    brand: product.brand,
    description: product.description,
    keywords: product.keywords || [],
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
  pickDefaultVariant,
  resolveVariant,
  summarizeProduct,
  getProductsForComparison,
};
