#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; exit 1; }

API="${API:-http://localhost:3001}"

# shellcheck source=lib/test-shopper.sh
source "$(dirname "$0")/lib/test-shopper.sh"
SHOPPER_H=(-H "X-Shopper-Id: ${SHOPPER_DEFAULT}")
SHOPPER_A_H=(-H "X-Shopper-Id: ${SHOPPER_A}")
SHOPPER_B_H=(-H "X-Shopper-Id: ${SHOPPER_B}")

curl -sf "$API/health" >/dev/null || fail "API health"
pass "API health"

curl -sf -X POST "$API/api/live-sessions/_test/reset" >/dev/null || fail "reset fixture state"
pass "fixture reset"

empty_cart() {
  local shopper="${1:-$SHOPPER_DEFAULT}"
  local cart items item_id
  cart="$(curl -sf -H "X-Shopper-Id: $shopper" "$API/api/cart")"
  items="$(node -e "console.log(JSON.parse(process.argv[1]).items.length)" "$cart")"
  while [ "${items:-0}" -gt 0 ]; do
    item_id="$(node -e "console.log(JSON.parse(process.argv[1]).items[0].id)" "$cart")"
    cart="$(curl -sf -X DELETE -H "X-Shopper-Id: $shopper" "$API/api/cart/items/$item_id")"
    items="$(node -e "console.log(JSON.parse(process.argv[1]).items.length)" "$cart")"
  done
}

ensure_live_session() {
  local session_id="$1"
  local detail
  detail="$(curl -sf "$API/api/live-sessions/$session_id")"
  if echo "$detail" | grep -q '"status":"SCHEDULED"'; then
    curl -sf -X POST "$API/api/live-sessions/$session_id/start" >/dev/null
  elif echo "$detail" | grep -q '"status":"ENDED"'; then
    fail "$session_id is ENDED — reset API before live discount regression"
  fi
}

empty_cart "$SHOPPER_DEFAULT"
empty_cart "$SHOPPER_A"
empty_cart "$SHOPPER_B"

RECORDED_ID="live-running-gear"

# A. ENDED recorded session exposes recording metadata/URL
detail="$(curl -sf "$API/api/live-sessions/$RECORDED_ID")"
echo "$detail" | grep -q '"status":"ENDED"' || fail "recorded session is ENDED"
echo "$detail" | grep -q '"/replay/demo.mp4"' || fail "recordingUrl present on ENDED session"

WEB="${WEB:-http://localhost:3000}"
demo_code="$(curl -s -o /dev/null -w '%{http_code}' "$WEB/replay/demo.mp4")"
[ "$demo_code" = "200" ] || fail "local demo replay asset (got $demo_code)"
pass "A ENDED session exposes recordingUrl + local demo asset"

# B. replay path must not use LIVE RTC viewer path (audience token rejected when ENDED)
code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/api/agora/rtc-token" \
  -H 'Content-Type: application/json' \
  -d '{"liveSessionId":"'"$RECORDED_ID"'","userId":"viewer-replay-test","role":"audience"}')"
[ "$code" = "400" ] || fail "audience RTC rejected on ENDED session (got $code)"
pass "B replay does not use LIVE RTC viewer path"

# C. recorded session retains associated product context
echo "$detail" | grep -q 'apparel-shoes-nike' || fail "session products enriched"
echo "$detail" | grep -q '"featuredProduct"' || fail "featured product on recorded session"
pass "C replay retains associated product context"

# D. recorded-session AI context (surface recorded + liveSessionId)
price_ctx="$(curl -sf -X POST "${SHOPPER_H[@]}" "$API/api/ai/tools/getCurrentPrice" -H 'Content-Type: application/json' \
  -d '{"productId":"apparel-shoes-nike","variantId":"v-uk9","context":{"surface":"recorded","liveSessionId":"'"$RECORDED_ID"'","shopperUserId":"'"$SHOPPER_DEFAULT"'"}}')"
echo "$price_ctx" | grep -q '"productId":"apparel-shoes-nike"' || fail "recorded AI price context"
pass "D recorded-session AI receives commerce context"

# E. recorded-session AI can invoke normal commerce tools
search="$(curl -sf -X POST "${SHOPPER_H[@]}" "$API/api/ai/tools/searchProducts" -H 'Content-Type: application/json' \
  -d '{"query":"shoes","context":{"surface":"recorded","liveSessionId":"'"$RECORDED_ID"'","shopperUserId":"'"$SHOPPER_DEFAULT"'"}}')"
echo "$search" | grep -q '"count":' || fail "recorded AI searchProducts"
svc="$(curl -sf -X POST "${SHOPPER_H[@]}" "$API/api/ai/tools/checkServiceability" -H 'Content-Type: application/json' \
  -d '{"pin":"201010","context":{"surface":"recorded","liveSessionId":"'"$RECORDED_ID"'","shopperUserId":"'"$SHOPPER_DEFAULT"'"}}')"
echo "$svc" | grep -q '"serviceable":' || fail "recorded AI checkServiceability"
pass "E recorded-session AI invokes commerce tools"

# F. add-to-cart from replay receives NO live discount (UI + AI paths)
cart_ui="$(curl -sf -X POST "${SHOPPER_H[@]}" "$API/api/cart/items" -H 'Content-Type: application/json' \
  -d '{"productId":"apparel-shoes-nike","variantId":"v-uk9","quantity":1,"originatingLiveSessionId":"'"$RECORDED_ID"'"}')"
echo "$cart_ui" | grep -q '"discountEligible":false' || fail "UI replay add must not be discount eligible"
echo "$cart_ui" | grep -q '"subtotal":3995' || fail "UI replay add full price subtotal"

ai_add="$(curl -sf -X POST "${SHOPPER_H[@]}" "$API/api/ai/tools/addToCart" -H 'Content-Type: application/json' \
  -d '{"productId":"lifestyle-band-mi","variantId":"v-graphite","quantity":1,"context":{"surface":"recorded","liveSessionId":"'"$RECORDED_ID"'","shopperUserId":"'"$SHOPPER_DEFAULT"'"}}')"
echo "$ai_add" | grep -q '"success":true' || fail "recorded AI addToCart"
echo "$ai_add" | grep -q '"discountEligible":false' || fail "recorded AI addToCart no live discount"
pass "F replay add-to-cart has no live discount"

# G. checkout receives no expired live discount
order="$(curl -sf -X POST "${SHOPPER_H[@]}" "$API/api/checkout" -H 'Content-Type: application/json' \
  -d '{"paymentMethod":"upi","deliveryPin":"201014"}')"
echo "$order" | grep -q '"discountAmount":0' || fail "checkout no live discount on replay cart"
pass "G checkout has no expired live discount"

empty_cart "$SHOPPER_DEFAULT"

# H. existing LIVE-session 20% discount still works
ensure_live_session "live-tech-tuesday"
live_cart="$(curl -sf -X POST "${SHOPPER_H[@]}" "$API/api/cart/items" -H 'Content-Type: application/json' \
  -d '{"productId":"elec-headphones-sony","variantId":"v-black","quantity":1,"originatingLiveSessionId":"live-tech-tuesday"}')"
echo "$live_cart" | grep -q '"discountEligible":true' || fail "LIVE discount regression"
echo "$live_cart" | grep -q '"subtotal":21592' || fail "LIVE discounted subtotal regression"
pass "H LIVE-session 20% discount still works"

empty_cart "$SHOPPER_DEFAULT"

# K. host-ended session receives POC demo recordingUrl for replay
curl -sf -X POST "$API/api/live-sessions/_test/reset" >/dev/null
curl -sf -X POST "$API/api/live-sessions/live-tech-tuesday/start" >/dev/null
ended="$(curl -sf -X POST "$API/api/live-sessions/live-tech-tuesday/end")"
echo "$ended" | grep -q '"status":"ENDED"' || fail "host end session"
echo "$ended" | grep -q '"/replay/demo.mp4"' || fail "host-ended session must get demo recordingUrl"
pass "K host-ended session exposes replay recordingUrl"

curl -sf -X POST "$API/api/live-sessions/_test/reset" >/dev/null

# I. storefront behaviour unchanged
curl -sf "$API/api/products" | grep -q Electronics || fail "storefront products"
store_cart="$(curl -sf -X POST "${SHOPPER_H[@]}" "$API/api/cart/items" -H 'Content-Type: application/json' \
  -d '{"productId":"elec-tv-samsung-55","variantId":"v-55","quantity":1}')"
echo "$store_cart" | grep -q '"discountEligible":false' || fail "storefront no discount"
pass "I storefront behaviour unchanged"

empty_cart "$SHOPPER_DEFAULT"

# J. shopper cart isolation remains intact
curl -sf -X POST "${SHOPPER_A_H[@]}" "$API/api/cart/items" -H 'Content-Type: application/json' \
  -d '{"productId":"apparel-shoes-nike","variantId":"v-uk9","quantity":1}' >/dev/null
cart_b="$(curl -sf "${SHOPPER_B_H[@]}" "$API/api/cart")"
echo "$cart_b" | grep -q '"itemCount":0' || fail "shopper B cart isolated during replay phase"
pass "J shopper cart isolation intact"

empty_cart "$SHOPPER_A"
empty_cart "$SHOPPER_B"
empty_cart "$SHOPPER_DEFAULT"

echo "Phase 6B acceptance complete (recorded replay + Voice AI without live discount)."
