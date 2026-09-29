#!/usr/bin/env bash
set -euo pipefail

echo "== POLYON manual release verification =="

echo "[1/8] Install"
pnpm install --frozen-lockfile

echo "[2/8] Typecheck"
pnpm typecheck

echo "[3/8] Tests"
pnpm test

echo "[4/8] Lint"
pnpm lint

echo "[5/8] Format check"
pnpm format:check

echo "[6/8] Production build"
pnpm build

echo "[7/8] Docker image build"
docker build --file apps/web/Dockerfile --tag polyon:release .

echo "[8/8] Docker Compose validation"
if [ ! -f apps/web/.env ]; then
  echo "apps/web/.env is missing. Copy apps/web/.env.example to apps/web/.env, configure it for the intended deployment, then rerun this script."
  exit 1
fi
docker compose config --quiet

echo
echo "Automated local checks completed successfully."
echo "Run the operational smoke checks in docs/RELEASE-CHECKLIST.md before tagging the release."
