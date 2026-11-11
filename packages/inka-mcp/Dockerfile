# The hosted Inka MCP server (http.mjs), as one bundled file (bundle.mjs) on
# Playwright's image, which brings Node and the Chromium its admin pages run
# in. Build after bundling, from this folder:
#
#   node packages/inka-mcp/bundle.mjs
#   docker build packages/inka-mcp
#
# Configuration is the environment http.mjs documents; INKA_MCP_SECRET is a
# secret, never baked in.
FROM mcr.microsoft.com/playwright:v1.61.0-noble
WORKDIR /app
# What the bundle leaves external: Playwright's library, at the version of the
# image's browser, and the Sentry SDK (SENTRY_DSN; unset reports nothing, and
# http.mjs then never imports it).
RUN corepack enable && pnpm init >/dev/null && pnpm add playwright@1.61.0 @sentry/node@10.78.0
COPY dist/inka-mcp-http.mjs ./
ENV NODE_ENV=production
CMD ["node", "inka-mcp-http.mjs"]
