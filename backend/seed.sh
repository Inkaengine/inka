#!/usr/bin/env bash
# Load the shared template fixtures — and the docs site built on them — into the dev Plone
# backend, so it serves what the production backend does.
#
# The layouts the example frontends force on every page (site-footer, event-view,
# newsitem-view, context-navigation-layout) live in tests-playwright/fixtures/site-root as
# MARKDOWN, which Plone cannot import. The mock API decodes it, so this boots the mock on
# a spare port, has it `@export` a plone.exportimport distribution, and hands that to
# Plone's own `@import` — the same templates the test suites use, in a real Plone.
#
# The docs come too: the home page links into /docs, and an SSG build fails on every link
# to a page the backend does not have. Their screenshots are generated at deploy time and
# not in git, so blobs missing from a checkout are skipped (allowMissingBlobs).
#
# Run against a FRESH site (make backend-clean && make backend-start): the import creates
# content at fixed paths and uids.
#
#   PLONE_URL         default http://localhost:8080/Plone
#   PLONE_USER/_PASSWORD  default admin / admin (the dev image's)
#   SEED_MOCK_PORT    default 18899 — kept off the test suites' 8888 so both can run
set -euo pipefail

PLONE_URL="${PLONE_URL:-http://localhost:8080/Plone}"
PLONE_USER="${PLONE_USER:-admin}"
PLONE_PASSWORD="${PLONE_PASSWORD:-admin}"
SEED_MOCK_PORT="${SEED_MOCK_PORT:-18899}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
MOCK_PID=""

cleanup() {
  [ -n "$MOCK_PID" ] && kill "$MOCK_PID" 2>/dev/null || true
  rm -rf "$WORK"
}
trap cleanup EXIT

# JSON field from stdin — node rather than python3, which this repo already requires.
json_field() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const v=JSON.parse(s)['$1'];console.log(v===undefined?'':typeof v==='string'?v:JSON.stringify(v))})"; }

echo "==> Checking Plone at $PLONE_URL"
if ! curl -sf -o /dev/null -H 'Accept: application/json' "$PLONE_URL/++api++/"; then
  echo "Plone is not answering at $PLONE_URL — start it with: make backend-start" >&2
  exit 1
fi
TOKEN="$(curl -sf -X POST "$PLONE_URL/++api++/@login" \
  -H 'Accept: application/json' -H 'Content-Type: application/json' \
  -d "{\"login\":\"$PLONE_USER\",\"password\":\"$PLONE_PASSWORD\"}" | json_field token)"
[ -n "$TOKEN" ] || { echo "Login to Plone as $PLONE_USER failed" >&2; exit 1; }

if curl -sf -o /dev/null -H 'Accept: application/json' -H "Authorization: Bearer $TOKEN" \
  "$PLONE_URL/++api++/templates/site-footer"; then
  echo "Plone already has /templates/site-footer — it looks seeded already." >&2
  echo "For a fresh copy: make backend-clean && make backend-start && make backend-seed" >&2
  exit 1
fi

echo "==> Exporting the shared fixtures + docs from the mock API (port $SEED_MOCK_PORT)"
PORT="$SEED_MOCK_PORT" CONTENT_MOUNTS="/docs:docs,/:tests-playwright/fixtures/site-root" \
  node "$ROOT/tests-playwright/fixtures/mock-api-server.cjs" > "$WORK/mock.log" 2>&1 &
MOCK_PID=$!
for _ in $(seq 1 60); do
  curl -sf -o /dev/null "http://localhost:$SEED_MOCK_PORT/health" && break
  kill -0 "$MOCK_PID" 2>/dev/null || { echo "Mock API exited:" >&2; tail -20 "$WORK/mock.log" >&2; exit 1; }
  sleep 1
done
curl -sf -X POST "http://localhost:$SEED_MOCK_PORT/++api++/@export" \
  -H 'Content-Type: application/json' -d '{"format":"json","allowMissingBlobs":true}' \
  -o "$WORK/content.zip"

echo "==> Importing into Plone"
REPORT="$(curl -sf -X POST "$PLONE_URL/++api++/@import" \
  -H 'Accept: application/json' -H "Authorization: Bearer $TOKEN" \
  -F "file=@$WORK/content.zip;type=application/zip")"
[ "$(echo "$REPORT" | json_field status)" = "success" ] || { echo "Import failed: $REPORT" >&2; exit 1; }
echo "$REPORT" | json_field report | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>JSON.parse(s).forEach(l=>console.log('   '+l)))"
echo "==> Done. Templates: $PLONE_URL/++api++/templates"
