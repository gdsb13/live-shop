#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; exit 1; }

API="${API:-http://localhost:3001}"
WEB="${WEB:-http://localhost:3000}"

curl -sf "$API/health" >/dev/null || fail "API health"
pass "API health"

products="$(curl -sf "$API/api/products")"
echo "$products" | grep -q Electronics || fail "products list"
pass "GET /api/products"

curl -sf "$API/api/products?category=Electronics" | grep -q elec-tv-samsung-55 || fail "electronics filter"
pass "category filter"

curl -sf "$API/api/products?search=television" | grep -q elec-tv-samsung-55 || fail "search"
pass "search"

curl -sf "$API/api/products/elec-tv-samsung-55" | grep -q '"name"' || fail "product detail"
pass "product detail"

curl -sf "$API/api/serviceability?pin=201014" | grep -q '"serviceable":true' || fail "serviceable pin"
pass "serviceability ok"

curl -sf "$API/api/serviceability?pin=999999" | grep -q '"serviceable":false' || fail "unserviceable pin"
pass "serviceability blocked"

curl -sf "$API/api/payment-options" | grep -q upi || fail "payment options"
pass "payment options"

cart="$(curl -sf -X POST "$API/api/cart/items" -H 'Content-Type: application/json' -d '{"productId":"elec-tv-samsung-55","variantId":"v-55","quantity":2}')"
item_id="$(echo "$cart" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).items[0].id))")"
echo "$cart" | grep -q '"subtotal":85998' || fail "add to cart subtotal"
pass "add to cart"

cart="$(curl -sf -X PATCH "$API/api/cart/items/$item_id" -H 'Content-Type: application/json' -d '{"quantity":3}')"
echo "$cart" | grep -q '"subtotal":128997' || fail "update quantity"
pass "update cart quantity"

order="$(curl -sf -X POST "$API/api/checkout" -H 'Content-Type: application/json' -d '{"paymentMethod":"upi","deliveryPin":"201014"}')"
echo "$order" | grep -q '"status":"confirmed"' || fail "checkout"
pass "mock checkout"

curl -sf "$API/api/cart" | grep -q '"itemCount":0' || fail "cart cleared"
pass "cart cleared after checkout"

curl -sf "$WEB" -o /dev/null || fail "web home"
pass "web home"

echo "Phase 2 API acceptance complete."
