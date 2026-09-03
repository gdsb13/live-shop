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

# Phase 3 regression
curl -sf "$API/api/live-sessions" | grep -q '"status":"LIVE"' || fail "live sessions"
pass "GET /api/live-sessions (regression)"

# RTC token: audience on LIVE session
rtc="$(curl -sf -X POST "$API/api/agora/rtc-token" -H 'Content-Type: application/json' -d '{"liveSessionId":"live-tech-tuesday","userId":"viewer-test123","role":"audience"}')"
echo "$rtc" | grep -q '"channelName":"live-live-tech-tuesday"' || fail "rtc channel name"
echo "$rtc" | grep -q '"token":"' || fail "rtc token present"
echo "$rtc" | grep -q '"appId":"' || fail "rtc appId present"
echo "$rtc" | grep -q 'AGORA_APP_CERTIFICATE' && fail "certificate leaked" || true
pass "POST /api/agora/rtc-token audience"

# Host RTC token claims broadcast slot; second host rejected
host_rtc="$(curl -sf -X POST "$API/api/agora/rtc-token" -H 'Content-Type: application/json' -d '{"liveSessionId":"live-tech-tuesday","userId":"host-live-tech-tuesday-tab1","role":"host"}')"
echo "$host_rtc" | grep -q '"role":"host"' || fail "host rtc role"
code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/api/agora/rtc-token" -H 'Content-Type: application/json' -d '{"liveSessionId":"live-tech-tuesday","userId":"host-live-tech-tuesday-tab2","role":"host"}')"
[ "$code" = "409" ] || fail "reject second host token (got $code)"
curl -sf -X POST "$API/api/agora/host-release" -H 'Content-Type: application/json' \
  -d '{"liveSessionId":"live-tech-tuesday","userId":"host-live-tech-tuesday-tab1"}' >/dev/null \
  || fail "host release"
pass "host rtc-token claim + single-host enforcement"

# Reject host token for viewer user id
code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/api/agora/rtc-token" -H 'Content-Type: application/json' -d '{"liveSessionId":"live-tech-tuesday","userId":"viewer-bad","role":"host"}')"
[ "$code" = "403" ] || fail "reject host role for viewer id (got $code)"
pass "reject unauthorized host role"

# Reject RTC on SCHEDULED session
code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/api/agora/rtc-token" -H 'Content-Type: application/json' -d '{"liveSessionId":"live-beauty-hour","userId":"viewer-test123","role":"audience"}')"
[ "$code" = "400" ] || fail "reject rtc on scheduled session (got $code)"
pass "reject rtc when not LIVE"

# RTM token on LIVE session
rtm="$(curl -sf -X POST "$API/api/agora/rtm-token" -H 'Content-Type: application/json' -d '{"liveSessionId":"live-tech-tuesday","userId":"viewer-test123"}')"
echo "$rtm" | grep -q '"chatChannelName":"live-chat-live-tech-tuesday"' || fail "rtm chat channel"
echo "$rtm" | grep -q '"token":"' || fail "rtm token present"
echo "$rtm" | grep -q '"signalingArea":"' || fail "rtm signaling area"
pass "POST /api/agora/rtm-token"

# Session relay chat (server-side fallback / acceptance tests only; UI uses RTC data stream)
chat="$(curl -sf -X POST "$API/api/chat/live-tech-tuesday" -H 'Content-Type: application/json' -d '{"sender":"TestGuest","text":"hello from test"}')"
echo "$chat" | grep -q '"text":"hello from test"' || fail "chat relay post"
curl -sf "$API/api/chat/live-tech-tuesday" | grep -q 'hello from test' || fail "chat relay list"
pass "session relay chat POST/GET"

curl -sf "$WEB/api/chat/live-tech-tuesday" | grep -q '"messages"' || fail "web proxy chat GET"
pass "web proxy GET /api/chat/:sessionId"

# Reject RTM on ENDED session
code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/api/agora/rtm-token" -H 'Content-Type: application/json' -d '{"liveSessionId":"live-running-gear","userId":"viewer-test123"}')"
[ "$code" = "400" ] || fail "reject rtm on ended session (got $code)"
pass "reject rtm when not LIVE"

# Commerce regression
curl -sf "$API/api/products" | grep -q Electronics || fail "products"
pass "GET /api/products (regression)"

# Web pages
curl -sf "$WEB" -o /dev/null || fail "web home"
pass "web home"

curl -sf "$WEB/live/live-tech-tuesday" -o /dev/null || fail "live session page"
pass "web /live/[sessionId]"

curl -sf "$WEB/host" -o /dev/null || fail "host page"
pass "web /host"

echo "Phase 4 acceptance complete (backend/security + page smoke)."
