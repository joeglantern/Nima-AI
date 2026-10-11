#!/usr/bin/env bash
#
# Put the deployed API on the internet, over https, with no domain.
#
#   ./scripts/live-url.sh            start or restart the tunnel, print the URL
#   ./scripts/live-url.sh --show     just print the current URL
#
# Runs on the server, in the checkout. It starts the `tunnel` service, waits
# for Cloudflare to hand it an address, writes that address into .env.prod
# wherever the API needs to know its own public URL, and recreates the api
# and worker so they pick it up. The URL changes every time the tunnel
# restarts, which is why this is a script and not a one off edit.
#
# Everything else about the deployment is untouched: ports stay on loopback,
# the other projects on this host are not involved.

set -euo pipefail

cd "$(dirname "$0")/.."

COMPOSE=(docker compose -f infra/docker-compose.prod.yml --env-file .env.prod)

current_url() {
  "${COMPOSE[@]}" --profile tunnel logs --no-log-prefix tunnel 2>/dev/null \
    | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -1 || true
}

if [[ "${1:-}" == "--show" ]]; then
  current_url
  exit 0
fi

echo "Starting the tunnel"
"${COMPOSE[@]}" --profile tunnel up -d tunnel

url=""
for _ in $(seq 1 60); do
  url="$(current_url)"
  [[ -n "$url" ]] && break
  sleep 1
done

if [[ -z "$url" ]]; then
  echo "Cloudflare did not hand out an address within a minute. Logs:"
  "${COMPOSE[@]}" --profile tunnel logs --tail 30 tunnel
  exit 1
fi

echo "Public address: $url"

# Set or replace one KEY=value line.
set_env() {
  local key="$1" value="$2"
  if grep -qE "^${key}=" .env.prod; then
    sed -i -E "s#^${key}=.*#${key}=${value}#" .env.prod
  else
    printf '%s=%s\n' "$key" "$value" >> .env.prod
  fi
}

set_env API_URL "$url"
set_env BETTER_AUTH_URL "$url"
set_env S3_PUBLIC_URL "$url/v1/media"
# The bucket is on loopback, so the API serves media and takes uploads.
set_env MEDIA_DELIVERY proxy
# Expo Go signs in from an exp:// origin. Only while testing through it.
set_env TRUST_EXPO_GO true

# Browsers on the public address, the local web dev server, and the app.
origins="$url,http://localhost:8081,http://localhost:19006,nima://"
set_env WEB_ORIGINS "$origins"

echo "Restarting api and worker with the new address"
"${COMPOSE[@]}" up -d --no-deps api worker

for _ in $(seq 1 60); do
  if curl -fsS -m 3 "$url/health" >/dev/null 2>&1; then
    echo
    echo "Live at $url"
    echo "$url" > .live-url
    exit 0
  fi
  sleep 2
done

echo "The tunnel is up but $url/health did not answer. Check: ${COMPOSE[*]} logs api"
exit 1
