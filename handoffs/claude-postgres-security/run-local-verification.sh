#!/usr/bin/env bash
set -Eeuo pipefail

# Reproduce CI's PostgreSQL 16 verification without installing Postgres or
# Node on the host. This script NEVER accepts a database URL: its target is the
# disposable container it creates below, and npm run verify:all is left
# unchanged so local and CI behavior cannot drift.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

if ! command -v docker >/dev/null 2>&1; then
  echo "error: Docker is required" >&2
  exit 2
fi

if [[ "${ALLOW_DIRTY:-0}" != "1" ]] && [[ -n "$(git status --porcelain)" ]]; then
  echo "error: working tree is dirty; commit/stash changes or set ALLOW_DIRTY=1" >&2
  exit 2
fi

if docker ps --format '{{.Ports}}' | grep -qE '(^|:)55432->'; then
  echo "error: Docker port 55432 is already in use" >&2
  exit 2
fi

suffix="$$-$(date +%s)"
postgres_container="amg-postgres-verify-${suffix}"
node_modules_volume="amg-postgres-node-modules-${suffix}"

cleanup() {
  docker rm -f "$postgres_container" >/dev/null 2>&1 || true
  docker volume rm -f "$node_modules_volume" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

echo "Starting disposable PostgreSQL 16 container..."
docker run -d --name "$postgres_container" \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_HOST_AUTH_METHOD=trust \
  -p 127.0.0.1:55432:5432 \
  postgres:16 >/dev/null

for attempt in $(seq 1 60); do
  if docker exec "$postgres_container" pg_isready -U postgres >/dev/null 2>&1; then
    break
  fi
  if [[ "$attempt" == "60" ]]; then
    echo "error: PostgreSQL did not become ready within 120 seconds" >&2
    docker logs "$postgres_container" >&2 || true
    exit 1
  fi
  sleep 2
done

docker volume create "$node_modules_volume" >/dev/null

echo "Running npm ci and the complete migration/RLS verification suite..."
docker run --rm --network host \
  -e CI=1 \
  -v "$ROOT:/workspace" \
  -v "$node_modules_volume:/workspace/node_modules" \
  -w /workspace \
  node:22-bookworm \
  bash -ceu '
    apt-get update -qq
    apt-get install -y -qq --no-install-recommends postgresql-client >/dev/null
    npm ci
    npm run verify:all
  '

echo "PostgreSQL migration and security verification passed."
