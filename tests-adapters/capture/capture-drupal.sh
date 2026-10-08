#!/usr/bin/env bash
# Capture the Drupal mock's fixtures from a real Drupal.
#
# The mock replays what a real Drupal actually returned. It is never
# hand-written: JSON:API responses are deeply nested with `included`
# relationships, and that normalisation is exactly where a Drupal adapter is
# most likely to be wrong. A mock built from our beliefs would agree with our
# bugs.
#
# Re-run this whenever Drupal changes, and diff the result.
#
#   Requires: a running Docker daemon.
#   Usage:    tests-adapters/capture/capture-drupal.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$HERE/../fixtures/drupal"
NAME=hydra-drupal-capture
PORT=8791
BASE="http://127.0.0.1:${PORT}"

command -v docker >/dev/null || { echo "docker not found"; exit 1; }
docker info >/dev/null 2>&1 || { echo "docker daemon is not running"; exit 1; }

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

echo "==> starting drupal:11 on ${PORT}"
docker run -d --name "$NAME" -p "${PORT}:80" drupal:11 >/dev/null

echo "==> waiting for it to answer"
for _ in $(seq 1 120); do
  if curl -sf -o /dev/null "${BASE}/"; then break; fi
  sleep 2
done

# Site install, JSON:API, and the two config-created fields Hydra needs:
#
#   field_hydra_blocks  string_long     — Drupal core has no JSON field type,
#                                         so blocks live in a long string.
#   (hierarchy)                         — comes from MENU LINKS, not a parent
#                                         field: Drupal nodes are flat, and
#                                         menus are how Drupal sites actually
#                                         express structure. Content with no
#                                         menu link is reachable through a
#                                         virtual folder in the contents view
#                                         rather than being invisible.
# Everything below was learned by doing; the official image is barer than it
# looks. Each step exists because its absence produced a real failure:
#
#   - drupal:11 ships NO drush            -> composer require
#   - and NO database                     -> sqlite, and the URL needs a host
#                                            segment (driver://host/database)
#   - vendor/bin/drush is a SHELL wrapper -> never invoke it through php
#   - drush must be told the docroot      -> --root=/opt/drupal/web
#   - Drupal 11's standard profile ships
#     NO content types at all             -> apply the core recipes
#   - JSON:API is READ-ONLY by default    -> every write would 405
#   - field:create takes positional
#     entityType and bundle, not --bundle
echo "==> installing drush (composer; slowest step)"
docker exec "$NAME" bash -lc '
  set -e
  cd /opt/drupal
  composer require drush/drush --no-interaction --no-progress
' >/dev/null

echo "==> installing site on sqlite"
docker exec "$NAME" bash -lc '
  set -e
  cd /opt/drupal
  chmod -R 777 web/sites/default
  vendor/bin/drush --root=/opt/drupal/web site:install standard \
    --db-url=sqlite://localhost/sites/default/files/.ht.sqlite \
    --account-name=admin --account-pass=admin --site-name=HydraCapture --yes
  chmod -R 777 web/sites/default
' >/dev/null

echo "==> content types, jsonapi, and the blocks field"
docker exec "$NAME" bash -lc '
  set -e
  cd /opt/drupal/web
  D="../vendor/bin/drush --root=/opt/drupal/web"
  $D recipe core/recipes/page_content_type
  $D recipe core/recipes/article_content_type
  $D en jsonapi basic_auth menu_link_content --yes
  $D config:set jsonapi.settings read_only 0 --yes
  $D field:create node page --field-name=field_hydra_blocks \
    --field-label="Hydra blocks" --field-type=string_long \
    --field-widget=string_textarea --is-required=0 --cardinality=1 --yes
  $D cr
' >/dev/null

echo "==> seeding a node so captured shapes are not empty"
curl -sf -u admin:admin -X POST "${BASE}/jsonapi/node/page" \
  -H 'Content-Type: application/vnd.api+json' \
  -H 'Accept: application/vnd.api+json' \
  -d '{"data":{"type":"node--page","attributes":{"title":"About","field_hydra_blocks":"{\"v\":1,\"blocks\":{\"b1\":{\"@type\":\"slate\"}}}","path":{"alias":"/about"}}}}' \
  >/dev/null

mkdir -p "$OUT"

echo "==> capturing"
capture() { # capture <name> <path>
  curl -sf -u admin:admin -H 'Accept: application/vnd.api+json' \
    "${BASE}${2}" -o "${OUT}/${1}.json" \
    && echo "    ${1}" \
    || echo "    ${1} FAILED (${2})"
}

capture root                /jsonapi
capture node-page           /jsonapi/node/page
capture node-page-included  '/jsonapi/node/page?include=uid&page[limit]=1'
capture menu-links          /jsonapi/menu_link_content/menu_link_content
capture taxonomy-vocab      /jsonapi/taxonomy_vocabulary/taxonomy_vocabulary
capture taxonomy-tags       /jsonapi/taxonomy_term/tags
capture users               /jsonapi/user/user
capture field-config        /jsonapi/field_config/field_config
capture content-types       /jsonapi/node_type/node_type

echo "==> captured into $(cd "$OUT" && pwd)"
echo "    These are the mock's source of truth. Review the diff before committing."
