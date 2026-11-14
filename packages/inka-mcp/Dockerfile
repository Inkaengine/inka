# The hosted Inka MCP server image, built by Inka AND by every consumer.
#
# Consumers used to hand-roll this, the way they hand-rolled the admin image
# before docker/admin.Dockerfile: two of them held byte-identical copies, and
# the drift had already started -- one installed the Sentry SDK the bundle
# needs and the other did not, so setting SENTRY_DSN there would have crashed
# the server on its first import.
#
# Build it from Inka, after bundling:
#
#   node packages/inka-mcp/bundle.mjs
#   docker build packages/inka-mcp
#
# Or from a consumer repo, whose context is its own root and whose bundle is
# its own entry (http.mjs: "a deployment with an entry of its own"):
#
#   [build]
#     dockerfile = "hydra/packages/inka-mcp/Dockerfile"
#     [build.args]
#       BUNDLE = "mcp/bundle/inka-mcp.mjs"
#       PLAYWRIGHT = "1.61.0"
#
#   fly deploy -c fly.mcp.toml \
#     --ignorefile hydra/packages/inka-mcp/Dockerfile.dockerignore
#
# Configuration is the environment http.mjs documents; INKA_MCP_SECRET is a
# secret, never baked in.

# The Playwright version the image's browser is, which must be the version the
# bundle's `playwright` import resolves to. A consumer reads it from this
# package's own dependencies rather than repeating it:
#   MCP_PLAYWRIGHT = $(shell node -p "require('./inka/packages/inka-mcp/package.json').dependencies.playwright")
ARG PLAYWRIGHT=1.61.0
FROM mcr.microsoft.com/playwright:v${PLAYWRIGHT}-noble
ARG PLAYWRIGHT

# The Sentry SDK version. Pinned here, not in each consumer: it has to match
# what bundle.mjs leaves external, and bundle.test asserts the Dockerfile
# installs every external -- which only guards anything while this is the one
# Dockerfile they all use.
ARG SENTRY=@sentry/node@10.78.0

WORKDIR /app
# What the bundle leaves external: Playwright's library, at the version of the
# image's browser, and the Sentry SDK (SENTRY_DSN; unset reports nothing, and
# http.mjs then never imports it).
RUN corepack enable && pnpm init >/dev/null && pnpm add playwright@${PLAYWRIGHT} ${SENTRY}

# The bundled server. Inka's own is dist/inka-mcp-http.mjs; a consumer bundles
# its own entry somewhere else and says so. Either way it is run as server.mjs,
# so CMD does not depend on who built it.
ARG BUNDLE=dist/inka-mcp-http.mjs
COPY ${BUNDLE} ./server.mjs
ENV NODE_ENV=production
CMD ["node", "server.mjs"]
