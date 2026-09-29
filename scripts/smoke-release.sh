#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${POLYON_BASE_URL:-http://localhost:3000}"
COOKIE_JAR="${TMPDIR:-/tmp}/polyon-release-smoke.cookies"
rm -f "$COOKIE_JAR"

fail() {
  echo "FAILED: $1" >&2
  exit 1
}

# expect_code <actual> <expected> <response file> <hint>
expect_code() {
  if [ "$1" != "$2" ]; then
    echo "FAILED: expected HTTP $2, got HTTP $1." >&2
    [ -f "$3" ] && echo "Response: $(head -c 300 "$3")" >&2
    echo "Hint: $4" >&2
    exit 1
  fi
}

echo "== POLYON runtime smoke test =="
echo "Base URL: $BASE_URL"

echo "[1/6] Liveness"
live_code="$(curl -sS -o /tmp/polyon-live.json -w '%{http_code}' "$BASE_URL/api/health/live")" ||
  fail "could not reach $BASE_URL. Is POLYON running?"
expect_code "$live_code" "200" /tmp/polyon-live.json "the runtime is not alive; check the service logs."

echo "[2/6] Auth status"
auth_json="$(curl -sS "$BASE_URL/api/auth")"
printf '%s' "$auth_json" | grep -Eq '"enabled"\s*:\s*(true|false)' ||
  fail "unexpected /api/auth response: $auth_json"

if [ -z "${POLYON_API_TOKEN:-}" ] && printf '%s' "$auth_json" | grep -Eq '"enabled"\s*:\s*true'; then
  fail "authentication is enabled on the server but POLYON_API_TOKEN is not set in this shell."
fi

execution_disabled_hint="execution is enabled. Set POLYON_EXECUTION_ENABLED=false for the release smoke test and restart POLYON."

if [ -n "${POLYON_API_TOKEN:-}" ]; then
  echo "[3/6] Unauthenticated request is rejected"
  unauth_code="$(curl -sS -o /tmp/polyon-unauth.json -w '%{http_code}' "$BASE_URL/api/approvals")"
  expect_code "$unauth_code" "401" /tmp/polyon-unauth.json \
    "POLYON_API_TOKEN is set here, but the server does not require authentication."

  echo "[4/6] Authenticate and validate readiness"
  curl -sS -f -c "$COOKIE_JAR" \
    -H "Origin: $BASE_URL" \
    -H "Content-Type: application/json" \
    -d "{\"token\":\"$POLYON_API_TOKEN\"}" \
    "$BASE_URL/api/auth" >/tmp/polyon-auth.json ||
    fail "login was rejected. Check that POLYON_API_TOKEN matches the server configuration."
  ready_code="$(curl -sS -o /tmp/polyon-ready.json -w '%{http_code}' -b "$COOKIE_JAR" "$BASE_URL/api/health/ready")"
  expect_code "$ready_code" "200" /tmp/polyon-ready.json "readiness failed; check the server configuration."

  echo "[5/6] Authenticated approvals read"
  curl -sS -f -b "$COOKIE_JAR" "$BASE_URL/api/approvals" >/tmp/polyon-approvals.json ||
    fail "authenticated approvals read failed."

  echo "[6/6] Execution remains safely disabled"
  execute_code="$(curl -sS -o /tmp/polyon-execute.json -w '%{http_code}' \
    -b "$COOKIE_JAR" \
    -H "Origin: $BASE_URL" \
    -H "Content-Type: application/json" \
    -d '{"mode":"Direct","command":"POLYON release smoke test"}' \
    "$BASE_URL/api/execute")"
  expect_code "$execute_code" "503" /tmp/polyon-execute.json "$execution_disabled_hint"
else
  echo "[3/6] Readiness"
  ready_code="$(curl -sS -o /tmp/polyon-ready.json -w '%{http_code}' "$BASE_URL/api/health/ready")"
  expect_code "$ready_code" "200" /tmp/polyon-ready.json "readiness failed; check the server configuration."

  echo "[4/6] Authentication disabled for this local smoke test"
  curl -sS -f "$BASE_URL/api/approvals" >/tmp/polyon-approvals.json ||
    fail "approvals read failed."

  echo "[5/6] Command ingress accepts a safe non-executing smoke message"
  curl -sS -f \
    -H "Origin: $BASE_URL" \
    -H "Content-Type: application/json" \
    -d '{"mode":"Direct","command":"POLYON release smoke test"}' \
    "$BASE_URL/api/command" >/tmp/polyon-command.json ||
    fail "command ingress rejected the smoke message."

  echo "[6/6] Execution remains safely disabled"
  execute_code="$(curl -sS -o /tmp/polyon-execute.json -w '%{http_code}' \
    -H "Origin: $BASE_URL" \
    -H "Content-Type: application/json" \
    -d '{"mode":"Direct","command":"POLYON release smoke test"}' \
    "$BASE_URL/api/execute")"
  expect_code "$execute_code" "503" /tmp/polyon-execute.json "$execution_disabled_hint"
fi

echo
echo "Runtime smoke checks passed."
