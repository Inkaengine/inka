# The Volto admin (editor shell) image, built by every Inka consumer.
#
# Consumers used to hand-roll this. The copies drifted apart -- 42 to 75 lines,
# ~90 changed lines against each other -- while sharing one spine, and a mistake
# in one was invisible from the others until it broke a deploy.
#
# THE ONE RULE: there is exactly one `pnpm install`, and nothing re-resolves the
# workspace after it.
#
# The copy that broke added two plugins with `pnpm add -w` AFTER a frozen
# install. That second resolution pass left two webpack instances in the tree
# (`webpack@5.105.4_esbuild@0.25.12` and `...esbuild@0.28.0`), so razzle
# registered MiniCssExtractPlugin in the one it resolves while the loader that
# ran belonged to the other. The build died on:
#
#     Error: You forgot to add 'mini-css-extract-plugin' plugin
#
# which is not a missing plugin but two of them. Note the install tree
# legitimately holds four webpack instances and four esbuilds; razzle is
# coherent WITHIN one pass, so the fix is the single pass, not deduping
# versions. Two attempts to dedupe (pin esbuild, force one mini-css copy) were
# each falsified by a build before the real cause was found.
#
# Usage from a consumer repo, whose build context is the repo root:
#
#   [build]
#     dockerfile = "hydra/docker/admin.Dockerfile"
#     [build.args]
#       INKA_PATH = "hydra"
#       VOLTO_PLUGINS = "@plone-collective/volto-authomatic @plone-collective/volto-sentry"
#
#   fly deploy -c fly.admin.toml --ignorefile hydra/docker/admin.Dockerfile.dockerignore

ARG NODE_VERSION=24.22.1

FROM node:${NODE_VERSION}-slim AS base
# Where the Inka checkout sits in the consumer's build context. Consumers vendor
# it at different paths: hydra/, inka/, frontend/inka/, frontend/hydra/.
ARG INKA_PATH=hydra
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
COPY ${INKA_PATH}/ /app
RUN npm install -g corepack && corepack cache clean && corepack enable
WORKDIR /app

FROM base AS build
WORKDIR /app

# Plugins Inka declares, which this site wants switched on. Enabling is a
# volto.config.js edit and touches no dependency graph, so it is safe by
# construction.
ARG VOLTO_PLUGINS=""
# Plugins Inka does NOT declare -- a per-client SSO variant, say. These are
# written into package.json BEFORE the install, so there is still exactly one
# resolution pass. The cost is that the install cannot be --frozen-lockfile,
# because package.json then names deps the lockfile has never seen: resolution
# may drift between builds of the same commit. Empty (the default) keeps the
# frozen, reproducible path.
ARG EXTRA_PLUGINS=""

# mrs-developer clones the Volto monorepo into core/ before pnpm install can
# resolve the `workspace:*` packages (@plone/volto, @plone/razzle*) that live
# there. Volto 19 only publishes some of its forks to npm.
RUN apt-get -y update && apt-get -y install git make

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm dlx mrs-developer missdev --no-config --fetch-https \
 && if [ -n "$EXTRA_PLUGINS" ]; then \
      echo "EXTRA_PLUGINS set -- installing unfrozen (see the note above)"; \
      node docker/add-plugins.cjs "$EXTRA_PLUGINS" && pnpm install --no-frozen-lockfile; \
    else \
      pnpm install --frozen-lockfile; \
    fi

# @plone/registry + @plone/components must be BUILT, not just linked: razzle.config
# requires their dist/ output (create-addons-loader.cjs and friends).
RUN pnpm run build:deps

# Config only. Runs after the install on purpose -- it cannot affect the graph.
RUN node docker/enable-plugins.cjs "$VOLTO_PLUGINS $EXTRA_PLUGINS"

RUN pnpm run build


# The dependencies the RUNTIME needs, which are not the ones the build needed.
# `start:prod` runs the prebuilt build/server.js: razzle leaves some modules
# external, so the server still resolves from node_modules, but nothing there
# needs a devDependency. Carrying the build stage's tree instead shipped the
# whole toolchain -- razzle, webpack, the test runners -- in the served image.
#
# THE ONE RULE applies here too, per stage: one install, nothing re-resolving
# after it. EXTRA_PLUGINS goes into package.json BEFORE this install for the
# same reason it does in the build stage. Addons themselves are plain
# `dependencies`, so --prod keeps them.
FROM base AS prod-deps
ARG VOLTO_PLUGINS=""
ARG EXTRA_PLUGINS=""
RUN apt-get -y update && apt-get -y install git make
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm dlx mrs-developer missdev --no-config --fetch-https \
 && if [ -n "$EXTRA_PLUGINS" ]; then \
      echo "EXTRA_PLUGINS set -- installing unfrozen (see the note above)"; \
      node docker/add-plugins.cjs "$EXTRA_PLUGINS" && pnpm install --prod --no-frozen-lockfile; \
    else \
      pnpm install --prod --frozen-lockfile; \
    fi

FROM base
# Runtime deps from prod-deps, the BUILT Volto packages and razzle output from
# build. The @plone/* workspace packages resolve through symlinks into
# core/packages, which must be the BUILT copies (dist/) -- prod-deps clones
# core but never runs build:deps, so taking core/packages from there would
# leave a server importing packages with no dist.
COPY --from=prod-deps /app/node_modules /app/node_modules
COPY --from=build /app/core/packages /app/core/packages
COPY --from=build /app/build /app/build
# The config the build was MADE from. `FROM base` re-copies the pristine
# volto.config.js out of the context, so without this the image contradicts
# itself: razzle has baked the enabled addons into build/, while the config
# sitting beside it still names none of them. Nothing at runtime reads it --
# `start:prod` runs the prebuilt build/server.js -- so this is about an image
# that states what it is, for whoever reads it next and for CI to assert.
#
# The glob is deliberate: volto.config.base.js exists only when something was
# enabled, and a COPY naming a missing file fails the build. Verified both ways.
COPY --from=build /app/volto.config*.js /app/
CMD ["pnpm", "start:prod"]
