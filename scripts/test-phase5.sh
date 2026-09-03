#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; exit 1; }

API="${API:-http://localhost:3001}"

health="$(curl -sf "$API/health" 2>/dev/null || echo '{}')"
echo "$health" | grep -q '"voiceAi":true' || fail "API missing voiceAi (stale server?) — run: ./scripts/stop.sh && ./scripts/start.sh"
pass "API health includes voiceAi feature"

status="$(curl -sf "$API/api/ai/status")"
echo "$status" | grep -q '"allowedTools"' || fail "ai status allowedTools"
echo "$status" | grep -q 'searchProducts' || fail "ai status lists searchProducts"
pass "GET /api/ai/status"

# Reject disallowed tool name
code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/api/ai/tools/notAllowed" -H 'Content-Type: application/json' -d '{}')"
[ "$code" = "400" ] || fail "reject disallowed tool (got $code)"
pass "reject disallowed AI tool"

# Validation: invalid PIN
code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/api/ai/tools/checkServiceability" -H 'Content-Type: application/json' -d '{"pin":"12"}')"
[ "$code" = "400" ] || fail "reject invalid PIN (got $code)"
pass "validate checkServiceability PIN"

# searchProducts tool
search="$(curl -sf -X POST "$API/api/ai/tools/searchProducts" -H 'Content-Type: application/json' -d '{"query":"noise cancelling headphones"}')"
echo "$search" | grep -q 'elec-headphones-sony' || fail "search finds Sony headphones"
pass "searchProducts tool"

# getProduct tool
product="$(curl -sf -X POST "$API/api/ai/tools/getProduct" -H 'Content-Type: application/json' -d '{"productId":"elec-headphones-sony"}')"
echo "$product" | grep -q '"brand":"Sony"' || fail "getProduct Sony"
pass "getProduct tool"

# getCurrentPrice tool
price="$(curl -sf -X POST "$API/api/ai/tools/getCurrentPrice" -H 'Content-Type: application/json' -d '{"productId":"elec-headphones-sony","variantId":"v-black"}')"
echo "$price" | grep -q '"price":26990' || fail "getCurrentPrice Sony black"
pass "getCurrentPrice tool"

# compareProducts tool
compare="$(curl -sf -X POST "$API/api/ai/tools/compareProducts" -H 'Content-Type: application/json' -d '{"productIds":["elec-headphones-sony","elec-tv-samsung-55"]}')"
echo "$compare" | grep -q 'elec-headphones-sony' || fail "compare includes Sony"
echo "$compare" | grep -q 'elec-tv-samsung-55' || fail "compare includes Samsung TV"
pass "compareProducts tool"

# serviceability tool
svc="$(curl -sf -X POST "$API/api/ai/tools/checkServiceability" -H 'Content-Type: application/json' -d '{"pin":"201014"}')"
echo "$svc" | grep -q 'serviceable\|available\|deliver' || fail "serviceability message"
pass "checkServiceability tool"

# payment options tool
pay="$(curl -sf -X POST "$API/api/ai/tools/getPaymentOptions" -H 'Content-Type: application/json' -d '{}')"
echo "$pay" | grep -q 'options' || fail "payment options payload"
pass "getPaymentOptions tool"

# addToCart tool uses commerce service
cart="$(curl -sf -X POST "$API/api/ai/tools/addToCart" -H 'Content-Type: application/json' -d '{"productId":"elec-tv-samsung-55","variantId":"v-55","quantity":1}')"
echo "$cart" | grep -q '"success":true' || fail "addToCart success"
echo "$cart" | grep -q 'elec-tv-samsung-55' || fail "addToCart contains product"
pass "addToCart tool"

# Local voice session + deterministic turn (mock LLM routing)
start="$(curl -sf -X POST "$API/api/ai/session/start" -H 'Content-Type: application/json' -d '{"surface":"storefront","shopperUserId":"shopper-ai-test-tab"}')"
session_id="$(echo "$start" | sed -n 's/.*"sessionId":"\([^"]*\)".*/\1/p')"
[ -n "$session_id" ] || fail "voice session start"
echo "$start" | grep -q '"mode":"local"' || fail "local mode without AI_PUBLIC_BASE_URL"
pass "POST /api/ai/session/start local mode"

turn="$(curl -sf -X POST "$API/api/ai/local/turn" -H 'Content-Type: application/json' -d "{\"sessionId\":\"$session_id\",\"text\":\"Add the Sony headphones to my cart\"}")"
echo "$turn" | grep -q 'cart' || fail "local turn add to cart reply"
echo "$turn" | grep -q '"cartUpdated":true' || fail "local turn cartUpdated"
pass "POST /api/ai/local/turn add-to-cart journey"

curl -sf -X POST "$API/api/ai/session/stop" -H 'Content-Type: application/json' -d "{\"sessionId\":\"$session_id\",\"shopperUserId\":\"shopper-ai-test-tab\"}" >/dev/null || fail "stop voice session"
pass "POST /api/ai/session/stop"

# Custom LLM proxy auth
code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/api/ai/llm/ai-shopper-ai-test-tab/chat/completions" -H 'Content-Type: application/json' -d '{"messages":[{"role":"user","content":"hello"}]}')"
[ "$code" = "401" ] || fail "llm proxy requires auth (got $code)"
pass "custom LLM proxy auth"

echo "Phase 5 acceptance complete (deterministic AI tools + local voice turn)."
