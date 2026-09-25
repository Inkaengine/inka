#!/bin/bash
set -e
set -o pipefail

# Warm the API before prerendering. The deployed Plone is a single
# small auto-suspending instance; a cold one answers the heavy
# expand query slowly enough that the SSG's inner template-load
# timeout fires and 500s pages. Poll the exact query shape the
# prerender uses until it returns 200 + valid JSON quickly a few
# times. Non-fatal: warn and proceed if it never warms (the build's
# own failOnError guard still catches a genuinely broken SSG).
API_BASE="${NUXT_TEST_BACKEND:-https://hydra-api.pretagov.com}/++api++"
EXPAND="expand=breadcrumbs,navroot,navigation,templates&expand.navigation.depth=2"
echo "=== Warming API: ${API_BASE} ==="
warm_ok() {
  local out code secs
  out=$(curl -s -o /tmp/warm.json -w '%{http_code} %{time_total}' \
    -H 'Accept: application/json' --max-time 30 \
    "${API_BASE}${1}?${EXPAND}" 2>/dev/null) || return 1
  code=${out%% *}; secs=${out##* }
  [ "$code" = "200" ] && grep -q '"@id"' /tmp/warm.json 2>/dev/null && [ "${secs%%.*}" -lt 5 ]
}
STABLE=0
for i in $(seq 1 60); do
  if warm_ok "" && warm_ok "/docs/examples"; then
    STABLE=$((STABLE + 1))
    echo "  warm ${STABLE}/3"
    [ "$STABLE" -ge 3 ] && { echo "API warm."; break; }
  else
    STABLE=0
  fi
  [ "$i" -eq 60 ] && echo "WARNING: API never warmed after ~10min — building anyway"
  sleep 10
done

echo "=== Building prod (SSG) ==="
# NUXT_PRERENDER_STRICT=1 flips nuxt.config's failOnError on for the DEPLOY only: the
# prerender aborts on the FIRST error — page OR IPX image route — and prints the real
# error (message + stack), which a bare "[500]" never showed. A broken image (or page)
# must fail the deploy, not ship a site with missing images. set -o pipefail (top) makes
# the non-zero `generate` exit propagate through the `tee`.
NUXT_PRERENDER_STRICT=1 pnpm run generate 2>&1 | tee nuxt-generate.log
# Backstop: refuse to ship if the prerender logged a Server Error ([500]) OR a filesystem
# write error (ENOTDIR/EEXIST). failOnError only catches prerender FETCH errors; a write
# collision — e.g. a Plone Image id ending in .jpg rendered both bare (a FILE) and via
# image_scales `<id>/@@images/image-1800.jpeg` (a DIRECTORY) → `ENOTDIR mkdir <id>/@@images`
# — is logged as ERROR but `nuxt generate` still exits 0, silently dropping that image.
if grep -qE '\[500\]|ENOTDIR|EEXIST' nuxt-generate.log; then
  echo >&2
  echo "ERROR: prerender produced a Server Error or dropped an image (write collision) — refusing to ship a broken site:" >&2
  grep -B2 -E -- '\[500\]|ENOTDIR|EEXIST' nuxt-generate.log >&2
  rm -f nuxt-generate.log
  exit 1
fi
rm -f nuxt-generate.log

# Backstop 2 — inspect the BAKED OUTPUT, not just the log. A forced-layout
# template that fails to load renders a GRACEFUL 500 error component, which nitro
# bakes as a normal (200) route — so failOnError and the [500] log grep above
# miss it, and a broken homepage ships and gets CDN-cached for its TTL. Checked on
# the PROD SSG output only (before the client-only edit SPA is built into /edit/).
# NB: an unrendered `{{data?.title}}` is NOT a valid signal — that's the
# editable-metadata h1, which stays a template in a perfectly good view/SSG render.
#
# Match the FULL runtime error signature ("... not found in pre-loaded templates.
# Available: <keys>", helpers/index.js), NOT the bare phrase: the templates
# documentation page (docs/templates.md) legitimately quotes the message —
# `Template "…" not found in pre-loaded templates` — as prose, and the bare-phrase
# grep false-positived on it and refused to ship a perfectly good build. The real
# error always appends ". Available:"; the docs prose never does (it closes the
# <code> and ends the sentence right after "templates").
if grep -rlF 'not found in pre-loaded templates. Available:' .output/public --include='*.html' > /tmp/badpages 2>/dev/null && [ -s /tmp/badpages ]; then
  echo >&2
  echo "ERROR: a prerendered page rendered a 'not found in pre-loaded templates' error (a forced-layout template failed to load) — refusing to ship a broken site:" >&2
  head -10 /tmp/badpages >&2
  rm -f /tmp/badpages
  exit 1
fi
rm -f /tmp/badpages

mv .output .output-prod

# Clean Nuxt build cache to avoid SSG state leaking into SPA build
rm -rf .nuxt

echo "=== Building edit (SPA) ==="
NUXT_EDIT_BASE_URL=/edit/ pnpm run edit

# Move entire edit output into prod's /edit/ subdirectory
mv .output/public .output-prod/public/edit

# Use combined output
rm -rf .output
mv .output-prod .output

echo "=== Build complete ==="
echo "  /        → prod (SSG)"
echo "  /edit/   → edit (SPA)"
