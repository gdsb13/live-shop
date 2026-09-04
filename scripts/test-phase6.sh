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

# Phase 6 mutates session lifecycle; fixture sessions must match seed (SCHEDULED).
for sid in live-tech-tuesday live-beauty-hour live-home-essentials; do
  detail="$(curl -sf "$API/api/live-sessions/$sid")"
  echo "$detail" | grep -q '"status":"SCHEDULED"' || fail "$sid must be SCHEDULED at Phase 6 start (run ./scripts/start.sh)"
done
pass "fixture live sessions are SCHEDULED (fresh API state)"

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
    fail "$session_id is ENDED — restart API before Phase 6 tests"
  fi
}

empty_cart "$SHOPPER_DEFAULT"
pass "cart cleared for Phase 6A tests"

# A. storefront add -> 0% discount
cart="$(curl -sf -X POST "${SHOPPER_H[@]}" "$API/api/cart/items" -H 'Content-Type: application/json' -d '{"productId":"elec-tv-samsung-55","variantId":"v-55","quantity":1}')"
echo "$cart" | grep -q '"discountEligible":false' || fail "storefront item not discount eligible"
echo "$cart" | grep -q '"subtotal":42999' || fail "storefront subtotal without discount"
pass "A storefront add has 0% discount"

empty_cart "$SHOPPER_DEFAULT"

# B. generic storefront Voice AI/MCP add -> 0%
ai_cart="$(curl -sf -X POST "${SHOPPER_H[@]}" "$API/api/ai/tools/addToCart" -H 'Content-Type: application/json' -d '{"productId":"elec-headphones-sony","variantId":"v-black","quantity":1,"context":{"surface":"storefront","shopperUserId":"'"$SHOPPER_DEFAULT"'"}}')"
echo "$ai_cart" | grep -q '"discountEligible":false' || fail "storefront AI add not discount eligible"
echo "$ai_cart" | grep -q '"subtotal":26990' || fail "storefront AI subtotal without discount"
pass "B generic storefront Voice AI add has 0% discount"

empty_cart "$SHOPPER_DEFAULT"

# SCHEDULED session (host has not started broadcast) -> 0% regardless of scheduledAt
cart="$(curl -sf -X POST "${SHOPPER_H[@]}" "$API/api/cart/items" -H 'Content-Type: application/json' -d '{"productId":"cosmetics-lipstick-lakme","variantId":"v-berry","quantity":1,"originatingLiveSessionId":"live-beauty-hour"}')"
echo "$cart" | grep -q '"discountEligible":false' || fail "SCHEDULED session must not be discount eligible"
pass "SCHEDULED session (not started) has 0% discount"

empty_cart "$SHOPPER_DEFAULT"

ensure_live_session "live-tech-tuesday"

# C. eligible non-featured session product added from LIVE session -> 20%
cart="$(curl -sf -X POST "${SHOPPER_H[@]}" "$API/api/cart/items" -H 'Content-Type: application/json' -d '{"productId":"elec-headphones-sony","variantId":"v-black","quantity":1,"originatingLiveSessionId":"live-tech-tuesday"}')"
echo "$cart" | grep -q '"discountEligible":true' || fail "live session add not discount eligible"
echo "$cart" | grep -q '"discountPercent":20' || fail "live session discount percent"
echo "$cart" | grep -q '"discountAmount":5398' || fail "live session discount amount"
echo "$cart" | grep -q '"subtotal":21592' || fail "live session discounted subtotal"
echo "$cart" | grep -q '"originatingLiveSessionId":"live-tech-tuesday"' || fail "originating session preserved"
pass "C eligible non-featured LIVE session product has 20% discount"

empty_cart "$SHOPPER_DEFAULT"

# D. same eligible product added by Voice AI from LIVE context -> 20%
ai_live="$(curl -sf -X POST "${SHOPPER_H[@]}" "$API/api/ai/tools/addToCart" -H 'Content-Type: application/json' -d '{"productId":"elec-headphones-sony","variantId":"v-black","quantity":1,"context":{"surface":"live","liveSessionId":"live-tech-tuesday","shopperUserId":"'"$SHOPPER_DEFAULT"'"}}')"
echo "$ai_live" | grep -q '"discountEligible":true' || fail "live AI add not discount eligible"
echo "$ai_live" | grep -q '"subtotal":21592' || fail "live AI discounted subtotal"
pass "D Voice AI LIVE context add has 20% discount"

empty_cart "$SHOPPER_DEFAULT"

# E. product not belonging to that live session -> 0%
cart="$(curl -sf -X POST "${SHOPPER_H[@]}" "$API/api/cart/items" -H 'Content-Type: application/json' -d '{"productId":"cosmetics-lipstick-lakme","variantId":"v-berry","quantity":1,"originatingLiveSessionId":"live-tech-tuesday"}')"
echo "$cart" | grep -q '"discountEligible":false' || fail "foreign product should not be discount eligible"
pass "E product outside session has 0% discount"

empty_cart "$SHOPPER_DEFAULT"

# F. ENDED/recorded session -> 0%
cart="$(curl -sf -X POST "${SHOPPER_H[@]}" "$API/api/cart/items" -H 'Content-Type: application/json' -d '{"productId":"apparel-shoes-nike","variantId":"v-uk9","quantity":1,"originatingLiveSessionId":"live-running-gear"}')"
echo "$cart" | grep -q '"discountEligible":false' || fail "ended session should not be discount eligible"
pass "F ENDED recorded session add has 0% discount"

empty_cart "$SHOPPER_DEFAULT"

# G. item added while LIVE loses discount after host ends session (same cart line, no remove/re-add)
ensure_live_session "live-home-essentials"
cart="$(curl -sf -X POST "${SHOPPER_H[@]}" "$API/api/cart/items" -H 'Content-Type: application/json' -d '{"productId":"home-kettle-prestige","variantId":"v-steel","quantity":1,"originatingLiveSessionId":"live-home-essentials"}')"
echo "$cart" | grep -q '"discountEligible":true' || fail "item should be discount eligible while LIVE"
echo "$cart" | grep -q '"subtotal":1199' || fail "discounted subtotal while LIVE"
ended="$(curl -sf -X POST "$API/api/live-sessions/live-home-essentials/end")"
echo "$ended" | grep -q '"status":"ENDED"' || fail "session should be ENDED after host ends broadcast"
cart="$(curl -sf "${SHOPPER_H[@]}" "$API/api/cart")"
echo "$cart" | grep -q '"discountEligible":false' || fail "discount should be removed after session ends"
echo "$cart" | grep -q '"discountAmount":0' || fail "discount amount should reset to 0"
echo "$cart" | grep -q '"subtotal":1499' || fail "cart GET should show full price after ENDED"
order="$(curl -sf -X POST "${SHOPPER_H[@]}" "$API/api/checkout" -H 'Content-Type: application/json' -d '{"paymentMethod":"upi","deliveryPin":"201014"}')"
echo "$order" | grep -q '"subtotal":1499' || fail "checkout must revalidate full price after ENDED"
echo "$order" | grep -q '"discountAmount":0' || fail "checkout must not apply live discount after ENDED"
pass "G LIVE -> ENDED removes discount on cart refresh and checkout"

empty_cart "$SHOPPER_DEFAULT"

# H. checkout total uses current server-authoritative discounted amount
ensure_live_session "live-tech-tuesday"
cart="$(curl -sf -X POST "${SHOPPER_H[@]}" "$API/api/cart/items" -H 'Content-Type: application/json' -d '{"productId":"elec-tv-samsung-55","variantId":"v-55","quantity":1,"originatingLiveSessionId":"live-tech-tuesday"}')"
echo "$cart" | grep -q '"subtotal":34399' || fail "discounted cart subtotal before checkout"
order="$(curl -sf -X POST "${SHOPPER_H[@]}" "$API/api/checkout" -H 'Content-Type: application/json' -d '{"paymentMethod":"upi","deliveryPin":"201014"}')"
echo "$order" | grep -q '"subtotal":34399' || fail "checkout subtotal should use discounted amount"
echo "$order" | grep -q '"discountAmount":8600' || fail "checkout item discount amount"
pass "H checkout uses authoritative discounted total"

empty_cart "$SHOPPER_DEFAULT"

# I. existing cart behaviour still works
cart="$(curl -sf -X POST "${SHOPPER_H[@]}" "$API/api/cart/items" -H 'Content-Type: application/json' -d '{"productId":"elec-tv-samsung-55","variantId":"v-55","quantity":2}')"
item_id="$(json_field "$cart" "d.items[0].id")"
cart="$(curl -sf -X PATCH "${SHOPPER_H[@]}" "$API/api/cart/items/$item_id" -H 'Content-Type: application/json' -d '{"quantity":3}')"
echo "$cart" | grep -q '"subtotal":128997' || fail "cart quantity update regression"
curl -sf -X POST "${SHOPPER_H[@]}" "$API/api/checkout" -H 'Content-Type: application/json' -d '{"paymentMethod":"upi","deliveryPin":"201014"}' >/dev/null
pass "I existing cart update/checkout behaviour still works"

empty_cart "$SHOPPER_A"
empty_cart "$SHOPPER_B"

# K. per-shopper cart isolation
cart_a="$(curl -sf -X POST "${SHOPPER_A_H[@]}" "$API/api/cart/items" -H 'Content-Type: application/json' -d '{"productId":"elec-tv-samsung-55","variantId":"v-55","quantity":2}')"
echo "$cart_a" | grep -q '"itemCount":2' || fail "shopper A cart should have items"
cart_b="$(curl -sf "${SHOPPER_B_H[@]}" "$API/api/cart")"
echo "$cart_b" | grep -q '"itemCount":0' || fail "shopper B cart should start empty"
pass "K shopper A cart != shopper B cart"

curl -sf -X PATCH "${SHOPPER_A_H[@]}" "$API/api/cart/items/$(json_field "$cart_a" "d.items[0].id")" \
  -H 'Content-Type: application/json' -d '{"quantity":3}' >/dev/null
cart_b="$(curl -sf "${SHOPPER_B_H[@]}" "$API/api/cart")"
echo "$cart_b" | grep -q '"itemCount":0' || fail "shopper A mutation must not affect shopper B"
pass "K shopper A mutation does not affect shopper B"

ensure_live_session "live-tech-tuesday"
ai_a="$(curl -sf -X POST "${SHOPPER_A_H[@]}" "$API/api/ai/tools/addToCart" -H 'Content-Type: application/json' \
  -d '{"productId":"elec-headphones-sony","variantId":"v-black","quantity":1,"context":{"surface":"live","liveSessionId":"live-tech-tuesday","shopperUserId":"'"$SHOPPER_A"'"}}')"
echo "$ai_a" | grep -q '"discountEligible":true' || fail "shopper A live AI discount"
cart_b="$(curl -sf "${SHOPPER_B_H[@]}" "$API/api/cart")"
echo "$cart_b" | grep -q '"itemCount":0' || fail "Voice AI for A must not mutate B cart"
pass "K Voice AI for shopper A mutates only A cart with live discount"

cart_a2="$(curl -sf "${SHOPPER_A_H[@]}" "$API/api/cart")"
echo "$cart_a2" | grep -q '"itemCount":4' || fail "shopper A retains prior + AI items (3 TV + 1 headphones)"
pass "K same shopper retains cart across mutations"

# Parallel LIVE sessions: discount follows originating session, not any LIVE session
ensure_live_session "live-beauty-hour"
cart_a="$(curl -sf -X POST "${SHOPPER_A_H[@]}" "$API/api/cart/items" -H 'Content-Type: application/json' \
  -d '{"productId":"elec-headphones-sony","variantId":"v-black","quantity":1,"originatingLiveSessionId":"live-tech-tuesday"}')"
echo "$cart_a" | grep -q '"discountEligible":true' || fail "discount while originating session LIVE"
curl -sf -X POST "$API/api/live-sessions/live-tech-tuesday/end" >/dev/null
cart_a="$(curl -sf "${SHOPPER_A_H[@]}" "$API/api/cart")"
echo "$cart_a" | grep -q '"discountEligible":false' || fail "ended originating session removes discount"
# 3× TV (128997) + 2× headphones full price (53980) — discount follows originating session only
echo "$cart_a" | grep -q '"subtotal":182977' || fail "full price after originating session ends (TV + headphones)"
beauty="$(curl -sf "$API/api/live-sessions/live-beauty-hour")"
echo "$beauty" | grep -q '"status":"LIVE"' || fail "other parallel session still LIVE"
pass "K parallel LIVE: discount tied to originating session only"

# End any LIVE session left from isolation tests so downstream regressions see stable states
for sid in live-beauty-hour; do
  detail="$(curl -sf "$API/api/live-sessions/$sid")"
  if echo "$detail" | grep -q '"status":"LIVE"'; then
    curl -sf -X POST "$API/api/live-sessions/$sid/end" >/dev/null
  fi
done

empty_cart "$SHOPPER_A"
empty_cart "$SHOPPER_B"
empty_cart "$SHOPPER_DEFAULT"

# J. regression hooks for earlier phases (reset mutable POC state first)
curl -sf -X POST "$API/api/live-sessions/_test/reset" >/dev/null || fail "reset fixture sessions for regressions"
pass "J fixture sessions + carts reset to seed"

./scripts/test-phase2.sh >/dev/null || fail "Phase 2 regression"
pass "J Phase 2 regression"

./scripts/test-phase4.sh >/dev/null || fail "Phase 4 regression"
pass "J Phase 4 regression"

./scripts/test-phase5.sh >/dev/null || fail "Phase 5 regression"
pass "J Phase 5 regression"

./scripts/test-phase3.sh >/dev/null || fail "Phase 3 regression"
pass "J Phase 3 regression"

echo "Phase 6A acceptance complete (server-authoritative LIVE discount + per-shopper carts)."
