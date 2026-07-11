#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/deploy/.env}"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  source "$ENV_FILE"
  set +a
fi

CANVAS_BASE_URL="${CANVAS_BASE_URL:-https://canvas.peterai.cc.cd}"
SUB2API_BASE_URL="${SUB2API_BASE_URL:-https://api.peterai.cc.cd}"
CANVAS_MENU_ID="${CANVAS_MENU_ID:-51be877493a8929d}"

echo "== local health =="
curl -fsS --retry 12 --retry-connrefused --retry-delay 1 --max-time 10 http://127.0.0.1:13000/healthz

echo "== local security headers =="
headers="$(mktemp)"
trap 'rm -f "$headers"' EXIT
curl -fsS -D "$headers" -o /dev/null http://127.0.0.1:13000/
grep -qi '^Content-Security-Policy:.*frame-ancestors.*api\.peterai\.cc\.cd' "$headers"
grep -qi '^Referrer-Policy: no-referrer' "$headers"
if grep -qi '^X-Frame-Options:.*SAMEORIGIN' "$headers"; then
  echo "Canvas must remain embeddable across PeterAI origins" >&2
  exit 1
fi

echo "== proxy allowlist =="
status="$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:13000/peter-api/api/v1/auth/me)"
[[ "$status" == "401" ]]
blocked="$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:13000/peter-api/api/v1/admin/users)"
[[ "$blocked" == "404" ]]
wrong_method="$(curl -sS -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:13000/peter-api/api/v1/auth/me)"
[[ "$wrong_method" == "405" ]]
video_create="$(curl -sS -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:13000/peter-api/v1/videos)"
[[ "$video_create" == "401" ]]

if [[ "${VERIFY_PUBLIC:-0}" == "1" ]]; then
  echo "== public canvas =="
  curl -fsS --max-time 15 "$CANVAS_BASE_URL/healthz"
fi

if [[ "${VERIFY_MENU:-0}" == "1" ]]; then
  echo "== Sub2API custom menu =="
  curl -fsS --max-time 15 "$SUB2API_BASE_URL/api/v1/settings/public" \
    | jq -e --arg id "$CANVAS_MENU_ID" '.data.custom_menu_items[] | select(.id == $id and .url == "https://canvas.peterai.cc.cd/canvas?mode=recent")' >/dev/null
  curl -fsS --max-time 15 "$SUB2API_BASE_URL/custom/$CANVAS_MENU_ID" \
    | grep -q 'canvas\.peterai\.cc\.cd/canvas'
fi

echo "PeterAI Canvas verification passed"
