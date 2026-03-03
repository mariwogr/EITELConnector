#!/usr/bin/env sh
set -eu

: "${NEXT_PUBLIC_MANAGEMENT_API_URL:=/api/management}"
: "${NEXT_PUBLIC_MANAGEMENT_API_AUTH_KEY:=change-me}"
: "${NEXT_PUBLIC_CONNECTOR_NAME:=EITEL-EDC}"

envsubst '${NEXT_PUBLIC_MANAGEMENT_API_URL} ${NEXT_PUBLIC_MANAGEMENT_API_AUTH_KEY} ${NEXT_PUBLIC_CONNECTOR_NAME}' \
  < /usr/share/nginx/html/config.template.js \
  > /usr/share/nginx/html/config.js
