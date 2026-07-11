#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/deploy/.env}"
UPSTREAM_REF="${UPSTREAM_REF:-ebd8ae2}"
DATE_TAG="$(date +%Y%m%d)"
CUSTOM_SHA="$(git -C "$ROOT_DIR" rev-parse --short=8 HEAD)"
CUSTOM_FULL_SHA="$(git -C "$ROOT_DIR" rev-parse HEAD)"
IMAGE="${PETERAI_CANVAS_IMAGE:-peterai-canvas:${DATE_TAG}-upstream-${UPSTREAM_REF}-${CUSTOM_SHA}}"

if [[ -n "$(git -C "$ROOT_DIR" status --porcelain)" ]]; then
  echo "Refusing to publish a source tree with uncommitted changes" >&2
  exit 1
fi

docker build --build-arg "PETER_SOURCE_REF=$CUSTOM_FULL_SHA" -t "$IMAGE" "$ROOT_DIR"
install -m 600 /dev/null "$ENV_FILE.tmp"
printf 'PETERAI_CANVAS_IMAGE=%s\n' "$IMAGE" > "$ENV_FILE.tmp"
if [[ -f "$ENV_FILE" ]]; then
  grep -Ev '^PETERAI_CANVAS_IMAGE=' "$ENV_FILE" >> "$ENV_FILE.tmp" || true
fi
mv "$ENV_FILE.tmp" "$ENV_FILE"
docker compose -f "$ROOT_DIR/docker-compose.yml" --env-file "$ENV_FILE" up -d --force-recreate
VERIFY_PUBLIC="${VERIFY_PUBLIC:-0}" VERIFY_MENU="${VERIFY_MENU:-0}" "$ROOT_DIR/deploy/verify-production.sh"
echo "published $IMAGE"
