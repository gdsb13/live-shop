#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; exit 1; }

API="${API:-http://localhost:3001}"
WEB="${WEB:-http://localhost:3000}"

# shellcheck source=lib/test-shopper.sh
source "$(dirname "$0")/lib/test-shopper.sh"
SHOPPER_H=(-H "X-Shopper-Id: ${SHOPPER_DEFAULT}")

curl -sf "$API/health" >/dev/null || fail "API health"
pass "API health"

# Phase 2 regression: storefront APIs still work
curl -sf "$API/api/products" | grep -q Electronics || fail "products list"
pass "GET /api/products (regression)"

# Live sessions list (may reflect prior test mutations)
list="$(curl -sf "$API/api/live-sessions")"
echo "$list" | grep -q '"id":"live-tech-tuesday"' || fail "tech tuesday in session list"
echo "$list" | grep -q '"status":"ENDED"' || fail "ended session in list"
pass "GET /api/live-sessions grouped list"

# Session detail
detail="$(curl -sf "$API/api/live-sessions/live-tech-tuesday")"
echo "$detail" | grep -q '"featuredProduct"' || fail "session detail with featured product"
echo "$detail" | grep -q elec-tv-samsung-55 || fail "session products enriched"
pass "GET /api/live-sessions/:id"

if echo "$detail" | grep -q '"status":"SCHEDULED"'; then
  cart="$(curl -sf -X POST "${SHOPPER_H[@]}" "$API/api/cart/items" -H 'Content-Type: application/json' -d '{"productId":"elec-tv-samsung-55","variantId":"v-55","quantity":1,"originatingLiveSessionId":"live-tech-tuesday"}')"
  echo "$cart" | grep -q '"discountEligible":false' || fail "no discount while session SCHEDULED"
  pass "no live discount before host broadcast"

  started="$(curl -sf -X POST "$API/api/live-sessions/live-tech-tuesday/start")"
  echo "$started" | grep -q '"status":"LIVE"' || fail "start scheduled session"
  echo "$started" | grep -q '"startedAt"' || fail "startedAt set"
  pass "POST /api/live-sessions/:id/start"
elif echo "$detail" | grep -q '"status":"LIVE"'; then
  pass "tech tuesday already LIVE (prior mutations)"
elif echo "$detail" | grep -q '"status":"ENDED"'; then
  pass "tech tuesday already ENDED (prior mutations)"
else
  fail "tech tuesday must be SCHEDULED, LIVE, or ENDED for lifecycle tests"
fi

# Invalid start on LIVE session
code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/api/live-sessions/live-tech-tuesday/start")"
[ "$code" = "400" ] || fail "reject start on LIVE session (got $code)"
pass "invalid start transition rejected"

# Start another scheduled session for lifecycle tests
beauty="$(curl -sf "$API/api/live-sessions/live-beauty-hour")"
if echo "$beauty" | grep -q '"status":"SCHEDULED"'; then
  started="$(curl -sf -X POST "$API/api/live-sessions/live-beauty-hour/start")"
  echo "$started" | grep -q '"status":"LIVE"' || fail "start beauty session"
  pass "POST /api/live-sessions/:id/start (beauty)"
elif echo "$beauty" | grep -q '"status":"LIVE"'; then
  pass "beauty hour already LIVE (prior mutations)"
elif echo "$beauty" | grep -q '"status":"ENDED"'; then
  pass "beauty hour already ENDED (prior mutations)"
else
  fail "beauty hour must be SCHEDULED, LIVE, or ENDED for lifecycle tests"
fi

beauty="$(curl -sf "$API/api/live-sessions/live-beauty-hour")"
if echo "$beauty" | grep -q '"status":"LIVE"'; then
  # Change featured product
  featured="$(curl -sf -X PATCH "$API/api/live-sessions/live-beauty-hour/featured-product" -H 'Content-Type: application/json' -d '{"productId":"cosmetics-serum-mamaearth"}')"
  echo "$featured" | grep -q cosmetics-serum-mamaearth || fail "featured product changed"
  pass "PATCH /api/live-sessions/:id/featured-product"

  # Reject featured product not in session
  code="$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "$API/api/live-sessions/live-beauty-hour/featured-product" -H 'Content-Type: application/json' -d '{"productId":"elec-tv-samsung-55"}')"
  [ "$code" = "400" ] || fail "reject foreign product (got $code)"
  pass "reject product not in session"
else
  pass "skip featured-product PATCH (beauty hour not LIVE)"
fi

# End session (if still LIVE from this or prior tests)
beauty="$(curl -sf "$API/api/live-sessions/live-beauty-hour")"
if echo "$beauty" | grep -q '"status":"LIVE"'; then
  ended="$(curl -sf -X POST "$API/api/live-sessions/live-beauty-hour/end")"
  echo "$ended" | grep -q '"status":"ENDED"' || fail "end live session"
  echo "$ended" | grep -q '"endedAt"' || fail "endedAt set"
  pass "POST /api/live-sessions/:id/end"
else
  pass "beauty hour already ENDED (prior mutations)"
fi

# Invalid end on ENDED session
code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/api/live-sessions/live-beauty-hour/end")"
[ "$code" = "400" ] || fail "reject end on ENDED session (got $code)"
pass "invalid end transition rejected"

# Reject featured product change when not LIVE
code="$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "$API/api/live-sessions/live-beauty-hour/featured-product" -H 'Content-Type: application/json' -d '{"productId":"cosmetics-lipstick-lakme"}')"
[ "$code" = "400" ] || fail "reject feature when ENDED (got $code)"
pass "reject featured product when not LIVE"

# Web pages
curl -sf "$WEB" -o /dev/null || fail "web home"
pass "web home"

curl -sf "$WEB/live" -o /dev/null || fail "live discovery page"
pass "web /live"

curl -sf "$WEB/live/live-tech-tuesday" -o /dev/null || fail "live session page"
pass "web /live/[sessionId]"

curl -sf "$WEB/host" -o /dev/null || fail "host page"
pass "web /host"

echo "Phase 3 acceptance complete."
