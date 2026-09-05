#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -s "$HOME/.nvm/nvm.sh" ]]; then
  # shellcheck disable=SC1090
  . "$HOME/.nvm/nvm.sh"
  nvm use >/dev/null 2>&1 || true
fi

pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; exit 1; }

API="${API:-http://localhost:3001}"

# shellcheck source=lib/test-shopper.sh
source "$(dirname "$0")/lib/test-shopper.sh"
SHOPPER_H=(-H "X-Shopper-Id: shopper-ai-test-tab")

health="$(curl -sf "$API/health" 2>/dev/null || echo '{}')"
echo "$health" | grep -q '"voiceAi":true' || fail "API missing voiceAi (stale server?) — run: ./scripts/stop.sh && ./scripts/start.sh"
echo "$health" | grep -q '"mcp":true' || fail "API missing mcp feature flag"
pass "API health includes voiceAi + mcp"

status="$(curl -sf "$API/api/ai/status")"
echo "$status" | grep -q '"allowedTools"' || fail "ai status allowedTools"
echo "$status" | grep -q 'searchProducts' || fail "ai status lists searchProducts"
echo "$status" | grep -q '"externalLlmKeyRequired":false' || fail "status should not require external LLM key"
pass "GET /api/ai/status"

code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/api/ai/tools/notAllowed" -H 'Content-Type: application/json' -d '{}')"
[ "$code" = "400" ] || fail "reject disallowed tool (got $code)"
pass "reject disallowed AI tool"

svc_bad="$(curl -sf -X POST "$API/api/ai/tools/checkServiceability" -H 'Content-Type: application/json' -d '{"pin":"12"}')"
echo "$svc_bad" | grep -q '"code":"INVALID_PIN"' || fail "checkServiceability recoverable invalid PIN"
pass "checkServiceability recoverable invalid PIN"

search="$(curl -sf -X POST "$API/api/ai/tools/searchProducts" -H 'Content-Type: application/json' -d '{"query":"noise cancelling headphones"}')"
echo "$search" | grep -q 'elec-headphones-sony' || fail "search finds Sony headphones"
pass "searchProducts tool"

tv_search="$(curl -sf -X POST "$API/api/ai/tools/searchProducts" -H 'Content-Type: application/json' -d '{"query":"smart tv"}')"
echo "$tv_search" | grep -q '"defaultVariantPrice":32999' || fail "search exposes default variant price for Samsung TV"
echo "$tv_search" | grep -q '"basePrice"' && fail "search must not expose misleading basePrice"
pass "searchProducts exposes authoritative default variant price"

product="$(curl -sf -X POST "$API/api/ai/tools/getProduct" -H 'Content-Type: application/json' -d '{"productId":"elec-headphones-sony"}')"
echo "$product" | grep -q '"brand":"Sony"' || fail "getProduct Sony"
pass "getProduct tool"

price="$(curl -sf -X POST "$API/api/ai/tools/getCurrentPrice" -H 'Content-Type: application/json' -d '{"productId":"elec-headphones-sony","variantId":"v-black"}')"
echo "$price" | grep -q '"price":26990' || fail "getCurrentPrice Sony black"
pass "getCurrentPrice tool"

compare="$(curl -sf -X POST "$API/api/ai/tools/compareProducts" -H 'Content-Type: application/json' -d '{"productIds":["elec-headphones-sony","elec-tv-samsung-55"]}')"
echo "$compare" | grep -q 'elec-headphones-sony' || fail "compare includes Sony"
pass "compareProducts tool"

compare_one="$(curl -sf -X POST "$API/api/ai/tools/compareProducts" -H 'Content-Type: application/json' -d '{"productIds":["elec-headphones-sony"]}')"
echo "$compare_one" | grep -q '"code":"INSUFFICIENT_PRODUCTS"' || fail "compareProducts returns recoverable insufficient-products result"
pass "compareProducts recoverable insufficient-products result"

search_empty="$(curl -sf -X POST "$API/api/ai/tools/searchProducts" -H 'Content-Type: application/json' -d '{}')"
echo "$search_empty" | grep -q '"code":"MISSING_SEARCH_QUERY"' || fail "searchProducts returns recoverable missing-query result"
pass "searchProducts recoverable missing-query result"

svc="$(curl -sf -X POST "$API/api/ai/tools/checkServiceability" -H 'Content-Type: application/json' -d '{"pin":"201014"}')"
echo "$svc" | grep -q 'serviceable\|available\|deliver' || fail "serviceability message"
pass "checkServiceability tool"

pay="$(curl -sf -X POST "$API/api/ai/tools/getPaymentOptions" -H 'Content-Type: application/json' -d '{}')"
echo "$pay" | grep -q 'options' || fail "payment options payload"
pass "getPaymentOptions tool"

cart="$(curl -sf -X POST "${SHOPPER_H[@]}" "$API/api/ai/tools/addToCart" -H 'Content-Type: application/json' -d '{"productId":"elec-tv-samsung-55","variantId":"v-55","quantity":1,"context":{"shopperUserId":"shopper-ai-test-tab"}}')"
echo "$cart" | grep -q '"success":true' || fail "addToCart success"
pass "addToCart tool"

remove="$(curl -sf -X POST "${SHOPPER_H[@]}" "$API/api/ai/tools/removeFromCart" -H 'Content-Type: application/json' -d '{"productId":"elec-tv-samsung-55","context":{"shopperUserId":"shopper-ai-test-tab"}}')"
echo "$remove" | grep -q '"success":true' || fail "removeFromCart success"
pass "removeFromCart tool"

curl -sf -X POST "${SHOPPER_H[@]}" "$API/api/ai/tools/addToCart" -H 'Content-Type: application/json' \
  -d '{"productId":"elec-tv-samsung-55","variantId":"v-43","quantity":1,"context":{"shopperUserId":"shopper-ai-test-tab"}}' >/dev/null
curl -sf -X POST "${SHOPPER_H[@]}" "$API/api/ai/tools/addToCart" -H 'Content-Type: application/json' \
  -d '{"productId":"elec-headphones-sony","variantId":"v-black","quantity":1,"context":{"shopperUserId":"shopper-ai-test-tab"}}' >/dev/null
checkout_missing="$(curl -sf -X POST "${SHOPPER_H[@]}" "$API/api/ai/tools/checkout" -H 'Content-Type: application/json' \
  -d '{"context":{"shopperUserId":"shopper-ai-test-tab"}}')"
echo "$checkout_missing" | grep -q '"code":"MISSING_PAYMENT_METHOD"' || fail "checkout without payment returns recoverable result"
cart_after="$(curl -sf -X POST "${SHOPPER_H[@]}" "$API/api/ai/tools/getCart" -H 'Content-Type: application/json' \
  -d '{"context":{"shopperUserId":"shopper-ai-test-tab"}}')"
echo "$cart_after" | grep -q '"itemCount":2' || fail "getCart still works after recoverable checkout error"
pass "checkout recoverable missing payment and next tool call succeeds"

code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/api/ai/session/start" -H 'Content-Type: application/json' -d '{"surface":"storefront","shopperUserId":"shopper-ai-test-tab","shopperRtcUid":234567890}')"
if [ "$code" = "200" ]; then
  pass "POST /api/ai/session/start (MCP configured)"
  start="$(curl -sf -X POST "$API/api/ai/session/start" -H 'Content-Type: application/json' -d '{"surface":"storefront","shopperUserId":"shopper-ai-test-tab","shopperRtcUid":234567890}')"
  session_id="$(echo "$start" | sed -n 's/.*"sessionId":"\([^"]*\)".*/\1/p')"
  [ -n "$session_id" ] || fail "voice session start returned no sessionId"
  activate="$(curl -sf -X POST "$API/api/ai/session/activate" -H 'Content-Type: application/json' -d "{\"sessionId\":\"$session_id\",\"shopperUserId\":\"shopper-ai-test-tab\"}")"
  echo "$activate" | grep -q '"activated":true' || fail "session activate"
  pass "POST /api/ai/session/activate"
  curl -sf -X POST "$API/api/ai/session/stop" -H 'Content-Type: application/json' -d "{\"sessionId\":\"$session_id\",\"shopperUserId\":\"shopper-ai-test-tab\"}" >/dev/null || fail "stop voice session"
  pass "POST /api/ai/session/stop"
else
  [ "$code" = "503" ] || fail "session/start without MCP config should return 503 (got $code)"
  pass "POST /api/ai/session/start requires MCP endpoint (503 when missing)"
fi

node ./scripts/test-mcp-commerce.js || fail "MCP commerce protocol tests"
pass "MCP protocol commerce tools"

echo "Phase 5 acceptance complete (managed LLM + MCP architecture)."
