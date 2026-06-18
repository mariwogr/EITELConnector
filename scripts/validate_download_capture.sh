#!/usr/bin/env sh
set -eu

GATEWAY_URL="${GATEWAY_URL:-http://localhost:12000}"
CONNECTOR_PATH="${CONNECTOR_PATH:-}"
if [ -z "${LOCAL_ASSETS_AUTH_TOKEN:-}" ] && [ -f .env ]; then
  LOCAL_ASSETS_AUTH_TOKEN="$(sed -n 's/^LOCAL_ASSETS_AUTH_TOKEN=//p' .env | tail -n 1)"
fi
TOKEN="${LOCAL_ASSETS_AUTH_TOKEN:-CHANGE_ME_LOCAL_ASSET_TOKEN}"

ok() {
  printf '[OK] %s\n' "$1"
}

fail() {
  printf '[FAIL] %s\n' "$1" >&2
  exit 1
}

ingest_once() {
  curl -fsS \
    -H "x-api-key: $TOKEN" \
    -H "x-contract-id: $contract_id" \
    -H "x-asset-id: $asset_id" \
    -H "x-transfer-id: $transfer_id" \
    -H "content-type: application/json" \
    --data "$payload" \
    "$GATEWAY_URL$CONNECTOR_PATH/download-sink/ingest?contractId=$contract_id&assetId=$asset_id&transferId=$transfer_id" >/dev/null
}

command -v curl >/dev/null 2>&1 || fail "curl is not available"

payload='{"message":"TOPIC Connector validation payload"}'
contract_id="validation-contract"
asset_id="validation-asset"
transfer_id="validation-transfer"

attempts="${RETRY_ATTEMPTS:-30}"
delay="${RETRY_DELAY_SECONDS:-2}"
i=1
while [ "$i" -le "$attempts" ]; do
  if ingest_once; then
    break
  fi
  sleep "$delay"
  i=$((i + 1))
done

[ "$i" -le "$attempts" ] || fail "download-sink ingest failed"

records=""
i=1
while [ "$i" -le "$attempts" ]; do
  if records="$(curl -fsS -H "x-api-key: $TOKEN" "$GATEWAY_URL$CONNECTOR_PATH/download-sink/records")"; then
    break
  fi
  sleep "$delay"
  i=$((i + 1))
done

[ -n "$records" ] || fail "download-sink records endpoint failed"

printf '%s' "$records" | grep "$contract_id" >/dev/null \
  || fail "download-sink record was not listed"

ok "download-sink record listed"
