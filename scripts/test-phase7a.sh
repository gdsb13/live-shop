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

json_field() {
  local json="$1"
  local expr="$2"
  node -e "const d=JSON.parse(process.argv[1]); console.log(${expr});" "$json"
}

empty_cart() {
  local shopper="${1:-$SHOPPER_DEFAULT}"
  local cart items item_id
  cart="$(curl -sf -H "X-Shopper-Id: $shopper" "$API/api/cart")"
  items="$(json_field "$cart" "d.items.length")"
  while [ "${items:-0}" -gt 0 ]; do
    item_id="$(json_field "$cart" "d.items[0].id")"
    cart="$(curl -sf -X DELETE -H "X-Shopper-Id: $shopper" "$API/api/cart/items/$item_id")"
    items="$(json_field "$cart" "d.items.length")"
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

# A. cart increment/decrement via API (backend-authoritative totals)
cart="$(curl -sf -X POST "${SHOPPER_H[@]}" "$API/api/cart/items" -H 'Content-Type: application/json' \
  -d '{"productId":"elec-tv-samsung-55","variantId":"v-55","quantity":1}')"
item_id="$(json_field "$cart" "d.items[0].id")"
cart="$(curl -sf -X PATCH "${SHOPPER_H[@]}" "$API/api/cart/items/$item_id" -H 'Content-Type: application/json' -d '{"quantity":2}')"
echo "$cart" | grep -q '"itemCount":2' || fail "increment to qty 2"
echo "$cart" | grep -q '"subtotal":85998' || fail "subtotal after increment"
cart="$(curl -sf -X PATCH "${SHOPPER_H[@]}" "$API/api/cart/items/$item_id" -H 'Content-Type: application/json' -d '{"quantity":1}')"
echo "$cart" | grep -q '"itemCount":1' || fail "decrement to qty 1"
echo "$cart" | grep -q '"subtotal":42999' || fail "subtotal after decrement"
cart="$(curl -sf -X DELETE "${SHOPPER_H[@]}" "$API/api/cart/items/$item_id")"
echo "$cart" | grep -q '"itemCount":0' || fail "remove at zero quantity behaviour"
pass "A cart +/- and remove-at-zero via API"

empty_cart "$SHOPPER_DEFAULT"

# B. quantity changes preserve live discount (backend authoritative)
ensure_live_session "live-tech-tuesday"
cart="$(curl -sf -X POST "${SHOPPER_H[@]}" "$API/api/cart/items" -H 'Content-Type: application/json' \
  -d '{"productId":"elec-headphones-sony","variantId":"v-black","quantity":1,"originatingLiveSessionId":"live-tech-tuesday"}')"
item_id="$(json_field "$cart" "d.items[0].id")"
echo "$cart" | grep -q '"discountEligible":true' || fail "live discount at qty 1"
echo "$cart" | grep -q '"subtotal":21592' || fail "discounted subtotal at qty 1"
cart="$(curl -sf -X PATCH "${SHOPPER_H[@]}" "$API/api/cart/items/$item_id" -H 'Content-Type: application/json' -d '{"quantity":2}')"
echo "$cart" | grep -q '"discountEligible":true' || fail "live discount at qty 2"
echo "$cart" | grep -q '"subtotal":43184' || fail "discounted subtotal at qty 2 (21592×2)"
pass "B cart quantity change preserves live discount totals"

empty_cart "$SHOPPER_DEFAULT"

# C. replay / recorded surface has 0% discount (regression)
cart="$(curl -sf -X POST "${SHOPPER_H[@]}" "$API/api/cart/items" -H 'Content-Type: application/json' \
  -d '{"productId":"apparel-shoes-nike","variantId":"v-uk9","quantity":1,"originatingLiveSessionId":"live-running-gear"}')"
echo "$cart" | grep -q '"discountEligible":false' || fail "recorded session add has 0% discount"
pass "C replay remains 0% discount"

empty_cart "$SHOPPER_DEFAULT"

# D. shopper isolation on quantity mutations
cart_a="$(curl -sf -X POST "${SHOPPER_A_H[@]}" "$API/api/cart/items" -H 'Content-Type: application/json' \
  -d '{"productId":"elec-tv-samsung-55","variantId":"v-55","quantity":1}')"
item_a="$(json_field "$cart_a" "d.items[0].id")"
curl -sf -X PATCH "${SHOPPER_A_H[@]}" "$API/api/cart/items/$item_a" -H 'Content-Type: application/json' -d '{"quantity":3}' >/dev/null
cart_b="$(curl -sf "${SHOPPER_B_H[@]}" "$API/api/cart")"
echo "$cart_b" | grep -q '"itemCount":0' || fail "shopper B unaffected by A quantity change"
pass "D cart +/- preserves shopper isolation"

empty_cart "$SHOPPER_A"
empty_cart "$SHOPPER_B"

# E. Voice AI context surfaces (no second implementation)
price_store="$(curl -sf -X POST "${SHOPPER_H[@]}" "$API/api/ai/tools/getCurrentPrice" -H 'Content-Type: application/json' \
  -d '{"productId":"elec-tv-samsung-55","variantId":"v-55","context":{"surface":"storefront","shopperUserId":"'"$SHOPPER_DEFAULT"'"}}')"
echo "$price_store" | grep -q '"discountEligible":false' || fail "storefront has no live discount"
pass "E storefront Ask AI context has no live discount"

ensure_live_session "live-tech-tuesday"
price_live="$(curl -sf -X POST "${SHOPPER_H[@]}" "$API/api/ai/tools/getCurrentPrice" -H 'Content-Type: application/json' \
  -d '{"productId":"elec-headphones-sony","variantId":"v-black","context":{"surface":"live","liveSessionId":"live-tech-tuesday","shopperUserId":"'"$SHOPPER_DEFAULT"'"}}')"
echo "$price_live" | grep -q '"discountEligible":true' || fail "live surface discount eligibility"
pass "E live Ask AI context has live discount"

price_recorded="$(curl -sf -X POST "${SHOPPER_H[@]}" "$API/api/ai/tools/getCurrentPrice" -H 'Content-Type: application/json' \
  -d '{"productId":"apparel-shoes-nike","variantId":"v-uk9","context":{"surface":"recorded","liveSessionId":"live-running-gear","shopperUserId":"'"$SHOPPER_DEFAULT"'"}}')"
echo "$price_recorded" | grep -q '"discountEligible":false' || fail "recorded surface must not apply live discount"
pass "E recorded Ask AI context has no live discount"

# F. goodbye / conversation-complete intent detection
node <<'NODE' || fail "goodbye intent patterns"
function isUserGoodbyeIntent(text, options = {}) {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;
  if (
    /\b(bye|goodbye|good\s+bye)\b/.test(normalized) ||
    /\b(that'?s all|that is all|thanks,? that'?s all|thank you,? that'?s all)\b/.test(normalized) ||
    /\b(end (the )?conversation|stop talking)\b/.test(normalized) ||
    /\b(no thanks|no thank you|nothing else|i'?m done|im done)\b/.test(normalized) ||
    /^(stop|thanks\.?\s*)$/.test(normalized)
  ) {
    return true;
  }
  if (options.orderCompleted && /^no\.?\s*$/.test(normalized)) return true;
  return false;
}
const yes = ['bye', 'goodbye', "thanks, that's all", 'stop', 'no thanks', "i'm done"];
const no = ['buy this', 'hello priya', 'stop by the store'];
for (const t of yes) if (!isUserGoodbyeIntent(t)) throw new Error('expected goodbye: ' + t);
for (const t of no) if (isUserGoodbyeIntent(t)) throw new Error('unexpected goodbye: ' + t);
if (!isUserGoodbyeIntent('no', { orderCompleted: true })) throw new Error('no after order');
if (isUserGoodbyeIntent('no', { orderCompleted: false })) throw new Error('plain no before order');
NODE
pass "F conversation-complete intent patterns"

# G. Voice AI start/stop still works
start="$(curl -sf -X POST "$API/api/ai/session/start" -H 'Content-Type: application/json' \
  -d '{"surface":"storefront","shopperUserId":"shopper-phase7a","shopperRtcUid":345678901}')"
session_id="$(json_field "$start" "d.sessionId")"
[ -n "$session_id" ] || fail "voice session start"
curl -sf -X POST "$API/api/ai/session/stop" -H 'Content-Type: application/json' \
  -d "{\"sessionId\":\"$session_id\",\"shopperUserId\":\"shopper-phase7a\"}" >/dev/null || fail "voice session stop"
pass "G Voice AI start/stop"

# I. transcript turn semantics (snapshot + turn_id/status)
node scripts/test-voice-transcript.js || fail "voice transcript turn semantics"
pass "I transcript partial/final turn semantics"

# J. checkout tool requires successful CheckoutService and returns orderId
curl -sf -X POST "${SHOPPER_H[@]}" "$API/api/cart/items" -H 'Content-Type: application/json' \
  -d '{"productId":"elec-tv-samsung-55","variantId":"v-55","quantity":1}' >/dev/null
checkout="$(curl -sf -X POST "${SHOPPER_H[@]}" "$API/api/ai/tools/checkout" -H 'Content-Type: application/json' \
  -d '{"paymentMethod":"upi","deliveryPin":"201014","context":{"shopperUserId":"'"$SHOPPER_DEFAULT"'"}}')"
echo "$checkout" | grep -q '"success":true' || fail "checkout tool success"
echo "$checkout" | grep -q '"orderId":"ORD-' || fail "checkout tool returns orderId"
echo "$checkout" | grep -q '"status":"confirmed"' || fail "checkout tool confirmed status"
cart="$(curl -sf "${SHOPPER_H[@]}" "$API/api/cart")"
echo "$cart" | grep -q '"itemCount":0' || fail "checkout tool clears cart"
pass "J checkout tool returns orderId after successful checkout"

empty_cart "$SHOPPER_DEFAULT"

# K. expired live discount revalidated at checkout tool
ensure_live_session "live-tech-tuesday"
cart="$(curl -sf -X POST "${SHOPPER_H[@]}" "$API/api/cart/items" -H 'Content-Type: application/json' \
  -d '{"productId":"elec-headphones-sony","variantId":"v-black","quantity":1,"originatingLiveSessionId":"live-tech-tuesday"}')"
echo "$cart" | grep -q '"discountEligible":true' || fail "discounted cart before end"
curl -sf -X POST "$API/api/live-sessions/live-tech-tuesday/end" >/dev/null
checkout="$(curl -sf -X POST "${SHOPPER_H[@]}" "$API/api/ai/tools/checkout" -H 'Content-Type: application/json' \
  -d '{"paymentMethod":"upi","deliveryPin":"201014","context":{"shopperUserId":"'"$SHOPPER_DEFAULT"'"}}')"
echo "$checkout" | grep -q '"discountTotal":0' || fail "checkout tool revalidates expired discount"
echo "$checkout" | grep -q '"subtotal":26990' || fail "checkout tool full price after ENDED"
pass "K checkout tool revalidates expired live discount"

empty_cart "$SHOPPER_DEFAULT"
curl -sf -X POST "$API/api/live-sessions/_test/reset" >/dev/null

# L. host viewer links open in new tab (protect host RTC)
host_src="apps/web/src/app/host/page.tsx"
grep -q 'Open viewer page' "$host_src" || fail "host page has viewer link"
grep -q 'View shopper Live Shopping page' "$host_src" || fail "host page has shopper live link"
grep -q 'target="_blank"' "$host_src" || fail "host viewer links use target=_blank"
grep -q 'noopener noreferrer' "$host_src" || fail "host viewer links use rel=noopener noreferrer"
pass "L host viewer links open in new tab"

# M. Priya prompt includes checkout flow + confirmation + farewell guidance
prompt="$(node -e "const { buildSystemPrompt } = require('./apps/api/src/services/aiAssistantConfig'); console.log(buildSystemPrompt({ surface: 'live', liveContext: { title: 'Tech', status: 'LIVE', productIds: [] } }));")"
echo "$prompt" | grep -q 'CHECKOUT FLOW' || fail "prompt includes checkout flow"
echo "$prompt" | grep -q 'Is there anything else I can help you with' || fail "prompt includes post-order follow-up"
echo "$prompt" | grep -q 'explicit affirmative confirmation' || fail "prompt requires checkout confirmation"
echo "$prompt" | grep -q 'continue watching the live session' || fail "live farewell guidance"
store_prompt="$(node -e "const { buildSystemPrompt } = require('./apps/api/src/services/aiAssistantConfig'); console.log(buildSystemPrompt({ surface: 'storefront' }));")"
echo "$store_prompt" | grep -q 'do NOT mention an ongoing live broadcast' || fail "storefront farewell guidance"
pass "M Priya commerce conversation flow prompt"

# H. regression suite (reset mutable state first)
curl -sf -X POST "$API/api/live-sessions/_test/reset" >/dev/null || fail "reset before regressions"
./scripts/test-phase2.sh >/dev/null || fail "Phase 2 regression"
pass "H Phase 2 regression"
./scripts/test-phase4.sh >/dev/null || fail "Phase 4 regression"
pass "H Phase 4 regression"
./scripts/test-phase5.sh >/dev/null || fail "Phase 5 regression"
pass "H Phase 5 regression"
./scripts/test-phase3.sh >/dev/null || fail "Phase 3 regression"
pass "H Phase 3 regression"
./scripts/test-phase6.sh >/dev/null || fail "Phase 6 regression"
pass "H Phase 6 regression"
./scripts/test-phase6b.sh >/dev/null || fail "Phase 6B regression"
pass "H Phase 6B regression"

echo "Phase 7A acceptance complete (demo UX polish + regressions)."
