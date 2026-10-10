#!/usr/bin/env bash
#
# Run the app against the deployed backend.
#
#   ./scripts/live.sh
#
# Opens an SSH tunnel to the server and starts Expo pointed down it, so the
# app talks to the real database, the real queue and the real mailbox while
# the code stays on this machine.
#
# A tunnel rather than a public port, because the server has no certificate
# yet. Over plain HTTP on a public address the sign in code and the session
# cookie would cross the network in the clear; over loopback they do not
# leave the machine. When there is a domain and a certificate, drop this and
# point EXPO_PUBLIC_API_URL at it instead.

set -euo pipefail

HOST="${NIMA_HOST:-liban@156.67.25.84}"
PORT="${NIMA_PORT:-3340}"

if command -v ss >/dev/null 2>&1 && ss -ltn 2>/dev/null | grep -q ":${PORT} "; then
  echo "Something already holds port ${PORT}. Close it, or set NIMA_PORT."
  exit 1
fi

echo "Opening a tunnel to ${HOST}"
ssh -o ExitOnForwardFailure=yes -N -L "${PORT}:127.0.0.1:${PORT}" "${HOST}" &
tunnel=$!
trap 'kill "${tunnel}" 2>/dev/null || true' EXIT

for _ in $(seq 1 30); do
  if curl -fsS -m 2 "http://localhost:${PORT}/health" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! curl -fsS -m 3 "http://localhost:${PORT}/health" >/dev/null 2>&1; then
  echo "The tunnel opened but the API did not answer. Check it is running on the server."
  exit 1
fi

echo "Live backend reachable at http://localhost:${PORT}"
echo

cd "$(dirname "$0")/.."
EXPO_PUBLIC_API_URL="http://localhost:${PORT}" pnpm --filter @nima/app dev
