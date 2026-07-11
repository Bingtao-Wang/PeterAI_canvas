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

echo "== query-string log redaction =="
query_probe="peter-query-probe-$$"
curl -fsS -o /dev/null "http://127.0.0.1:13000/canvas?token=$query_probe"
if docker logs --since 10s peterai-canvas 2>&1 | grep -q "$query_probe"; then
  echo "Canvas access log exposed a query string" >&2
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
responses_create="$(curl -sS -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:13000/peter-api/v1/responses)"
[[ "$responses_create" == "401" ]]
image_create="$(curl -sS -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:13000/peter-api/v1/images/generations)"
[[ "$image_create" == "401" ]]
audio_create="$(curl -sS -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:13000/peter-api/v1/audio/speech)"
[[ "$audio_create" == "401" ]]
seedance_create="$(curl -sS -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:13000/peter-api/v1/contents/generations/tasks)"
[[ "$seedance_create" == "401" ]]
seedance_status="$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:13000/peter-api/v1/contents/generations/tasks/peter-probe)"
[[ "$seedance_status" == "401" ]]

echo "== exact source commit =="
EXPECTED_SOURCE_REF="${EXPECTED_SOURCE_REF:-$(git -C "$ROOT_DIR" rev-parse HEAD)}"
docker exec peterai-canvas sh -lc "grep -R -q 'PeterAI_canvas/tree/$EXPECTED_SOURCE_REF' /usr/share/nginx/html"

if [[ "${VERIFY_PUBLIC:-0}" == "1" ]]; then
  echo "== public canvas =="
  curl -fsS --max-time 15 "$CANVAS_BASE_URL/healthz"
fi

if [[ "${VERIFY_MENU:-0}" == "1" ]]; then
  echo "== Sub2API custom menu =="
  settings_json="$(curl -fsS --max-time 15 "$SUB2API_BASE_URL/api/v1/settings/public")"
  jq -e --arg id "$CANVAS_MENU_ID" \
    'any(.data.custom_menu_items[]; .id == $id and .url == "https://canvas.peterai.cc.cd/canvas?mode=recent")' \
    >/dev/null <<<"$settings_json"
  if [[ "${VERIFY_AVAILABLE_CHANNELS:-0}" == "1" ]]; then
    jq -e '.data.available_channels_enabled == true' >/dev/null <<<"$settings_json"
  fi
  curl -fsS --max-time 15 "$SUB2API_BASE_URL/custom/$CANVAS_MENU_ID" \
    | grep -q 'canvas\.peterai\.cc\.cd/canvas'
fi

echo "PeterAI Canvas verification passed"
