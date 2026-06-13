#!/usr/bin/env sh
set -eu

GATEWAY_URL="${GATEWAY_URL:-http://localhost:12000}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yaml}"
ENV_FILE="${ENV_FILE:-.env}"

ok() {
  printf '[OK] %s\n' "$1"
}

fail() {
  printf '[FAIL] %s\n' "$1" >&2
  exit 1
}

command -v docker >/dev/null 2>&1 || fail "docker is not available"
command -v curl >/dev/null 2>&1 || fail "curl is not available"

curl -fsS "$GATEWAY_URL/health" >/dev/null || fail "gateway health endpoint is not reachable at $GATEWAY_URL/health"
ok "Gateway reachable"

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps >/dev/null || fail "docker compose stack is not available"
ok "Docker Compose stack visible"

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T conectoruc3m curl -fsS http://localhost:11000/api/check/health >/dev/null \
  || fail "EDC runtime health endpoint is not reachable"
ok "EDC runtime healthy"

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T conectoruc3m-local-assets \
  python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8081/v1/config', timeout=5).read()" >/dev/null \
  || fail "local-assets config endpoint is not reachable"
ok "local-assets reachable"
