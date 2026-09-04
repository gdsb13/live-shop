#!/usr/bin/env bash
API=http://localhost:3001
cart=$(curl -sf -X POST "$API/api/cart/items" -H 'Content-Type: application/json' -d '{"productId":"elec-tv-samsung-55","variantId":"v-55","quantity":2}')
echo "CART=$cart"
echo "$cart" | grep -q '"subtotal":85998' && echo SUBTOTAL_OK || echo SUBTOTAL_FAIL
