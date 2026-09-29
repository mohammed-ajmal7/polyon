#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${POLYON_BASE_URL:-http://localhost:3000}"
COOKIE_JAR="${TMPDIR:-/tmp}/polyon-release-smoke.cookies"
rm -f "$COOKIE_JAR"

echo "== POLYON runtime smoke test =="
echo "Base URL: $BASE_URL"

echo "[1/6] Liveness"
live_code="$(curl -sS -o /tmp/polyon-live.json -w '%{http_code}' "$BASE_URL/api/health/live")"
test "$live_code" = "200"

echo "[2/6] Auth status"
auth_json="$(curl -sS "$BASE_URL/api/auth")"
printf '%s' "$auth_json" | grep -Eq '"enabled"\s*:\s*(true|false)'

if [ -n "${POLYON_API_TOKEN:-}" ]; then
  echo "[3/6] Unauthenticated request is rejected"
  unauth_code="$(curl -sS -o /tmp/polyon-unauth.json -w '%{http_code}' "$BASE_URL/api/approvals")"
  test "$unauth_code" = "401"

  echo "[4/6] Authenticate and validate readiness"
  curl -sS -f -c "$COOKIE_JAR" \
    -H "Origin: $BASE_URL" \
    -H "Content-Type: application/json" \
    -d "{\"token\":\"$POLYON_API_TOKEN\"}" \
    "$BASE_URL/api/auth" >/tmp/polyon-auth.json
  ready_code="$(curl -sS -o /tmp/polyon-ready.json -w '%{http_code}' -b "$COOKIE_JAR" "$BASE_URL/api/health/ready")"
  test "$ready_code" = "200"

  echo "[5/6] Authenticated approvals read"
  curl -sS -f -b "$COOKIE_JAR" "$BASE_URL/api/approvals" >/tmp/polyon-approvals.json

  echo "[6/6] Execution remains safely disabled"
  execute_code="$(curl -sS -o /tmp/polyon-execute.json -w '%{http_code}' \
    -b "$COOKIE_JAR" \
    -H "Origin: $BASE_URL" \
    -H "Content-Type: application/json" \
    -d '{"mode":"Direct","command":"POLYON release smoke test"}' \
    "$BASE_URL/api/execute")"
  test "$execute_code" = "503"
else
  echo "[3/6] Readiness"
  ready_code="$(curl -sS -o /tmp/polyon-ready.json -w '%{http_code}' "$BASE_URL/api/health/ready")"
  test "$ready_code" = "200"

  echo "[4/6] Authentication disabled for this local smoke test"
  curl -sS -f "$BASE_URL/api/approvals" >/tmp/polyon-approvals.json

  echo "[5/6] Command ingress accepts a safe non-executing smoke message"
  curl -sS -f \
    -H "Origin: $BASE_URL" \
    -H "Content-Type: application/json" \
    -d '{"mode":"Direct","command":"POLYON release smoke test"}' \
    "$BASE_URL/api/command" >/tmp/polyon-command.json

  echo "[6/6] Execution remains safely disabled"
  execute_code="$(curl -sS -o /tmp/polyon-execute.json -w '%{http_code}' \
    -H "Origin: $BASE_URL" \
    -H "Content-Type: application/json" \
    -d '{"mode":"Direct","command":"POLYON release smoke test"}' \
    "$BASE_URL/api/execute")"
  test "$execute_code" = "503"
fi

echo
echo "Runtime smoke checks passed."
