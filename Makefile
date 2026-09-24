### Defensive settings for make:
#     https://tech.davis-hansson.com/p/make/
SHELL:=bash
.ONESHELL:
.SHELLFLAGS:=-eu -o pipefail -c
.SILENT:
.DELETE_ON_ERROR:
MAKEFLAGS+=--warn-undefined-variables
MAKEFLAGS+=--no-builtin-rules

CURRENT_DIR:=$(shell dirname $(realpath $(lastword $(MAKEFILE_LIST))))

# Recipe snippets for reuse

# We like colors
# From: https://coderwall.com/p/izxssa/colored-makefile-for-golang-projects
RED=`tput setaf 1`
GREEN=`tput setaf 2`
RESET=`tput sgr0`
YELLOW=`tput setaf 3`

PLONE_VERSION=6
DOCKER_IMAGE=plone/server-dev:${PLONE_VERSION}
DOCKER_IMAGE_ACCEPTANCE=plone/server-acceptance:${PLONE_VERSION}

ADDON_NAME='volto-hydra'

.PHONY: help
help: ## Show this help
	@echo -e "$$(grep -hE '^\S+:.*##' $(MAKEFILE_LIST) | sed -e 's/:.*##\s*/:/' -e 's/^\(.\+\):\(.*\)/\\x1b[36m\1\\x1b[m:\2/' | column -c2 -t -s :)"

# Dev Helpers

.PHONY: install
install: ## Installs the add-on in a development environment
	pnpm dlx mrs-developer missdev --no-config --fetch-https
	pnpm i
	# lightningcss-cli ships a placeholder text file as its `lightningcss`
	# binary; its postinstall.js is meant to replace that with the real native
	# binary. With pnpm's non-hoisted layout the postinstall's
	# `require.resolve('lightningcss-cli-<platform>')` can't resolve at the time
	# pnpm runs it, so it silently leaves the placeholder and @plone/components'
	# `build:css` (via `pnpm build:deps`) then dies with "This: command not
	# found". `pnpm rebuild` doesn't retry it. Run the postinstall directly from
	# the package dir (where the platform pkg IS resolvable) to land the binary.
	PI="$$(node -e "console.log(require.resolve('lightningcss-cli/postinstall.js'))")"; \
	  (cd "$$(dirname "$$PI")" && node postinstall.js)

.PHONY: start
start: ## Starts Volto, allowing reloading of the add-on during development
	pnpm start

.PHONY: build
build: ## Build a production bundle for distribution of the project with the add-on
	pnpm build

.PHONY: i18n
i18n: ## Sync i18n
	pnpm --filter $(ADDON_NAME) i18n

.PHONY: format
format: ## Format codebase
	pnpm lint:fix
	pnpm prettier:fix
	pnpm stylelint:fix

.PHONY: lint
lint: ## Lint, or catch and remove problems, in code base
	pnpm lint
	pnpm prettier
	pnpm stylelint

.PHONY: release
release: ## Release the add-on on npmjs.org
	pnpm release

.PHONY: release-dry-run
release-dry-run: ## Dry-run the release of the add-on on npmjs.org
	pnpm release

.PHONY: test
test: ## Run unit tests
	pnpm test

.PHONY: test-ci
ci-test: ## Run unit tests in CI
	CI=1 RAZZLE_JEST_CONFIG=$(CURRENT_DIR)/jest-addon.config.js pnpm --filter @plone/volto test -- --passWithNoTests

.PHONY: backend-docker-start
backend-docker-start:	## Starts a Docker-based backend for development
	@echo "$(GREEN)==> Start Docker-based Plone Backend$(RESET)"
	docker run -it --rm --name=backend -p 8080:8080 -e SITE=Plone -e CORS_ALLOW_ORIGIN='*' $(DOCKER_IMAGE)

.PHONY: backend-start
backend-start: ## Starts the Plone backend with the templates addon mounted (see backend/)
	@echo "$(GREEN)==> Start Plone backend with the Inka templates addon$(RESET)"
	docker compose -f backend/docker-compose.yml up

.PHONY: backend-stop
backend-stop: ## Stops the addon backend
	docker compose -f backend/docker-compose.yml down

.PHONY: backend-clean
backend-clean: ## Stops the addon backend and DELETES its database (fresh site next start)
	@echo "$(RED)==> Removing the backend database — content will be lost$(RESET)"
	docker compose -f backend/docker-compose.yml down
	# Only the database: `down -v` would also drop the pip cache, and the next start would
	# re-download ~200 packages for nothing.
	docker volume rm -f backend_inka-plone-data

.PHONY: backend-seed
backend-seed: ## Loads the shared template fixtures into the addon backend (run on a fresh site)
	@echo "$(GREEN)==> Seed the Plone backend with the shared template fixtures$(RESET)"
	bash backend/seed.sh

.PHONY: test-conformance
test-conformance: ## Diff the mock API against a real Plone (needs backend-start: @templates needs the addon)
	@echo "$(GREEN)==> Diff mock API against real Plone$(RESET)"
	HYDRA_MOCK_API_PORT=$${HYDRA_MOCK_API_PORT:-8888} \
		pnpm exec playwright test --config=playwright-conformance.config.ts

## Storybook
.PHONY: storybook-start
storybook-start: ## Start Storybook server on port 6006
	@echo "$(GREEN)==> Start Storybook$(RESET)"
	pnpm run storybook

.PHONY: storybook-build
storybook-build: ## Build Storybook
	@echo "$(GREEN)==> Build Storybook$(RESET)"
	mkdir -p $(CURRENT_DIR)/.storybook-build
	pnpm run build-storybook -o $(CURRENT_DIR)/.storybook-build

## Acceptance
.PHONY: acceptance-frontend-dev-start
acceptance-frontend-dev-start: ## Start acceptance frontend in development mode
	RAZZLE_API_PATH=http://127.0.0.1:55001/plone pnpm start

.PHONY: acceptance-frontend-prod-start
acceptance-frontend-prod-start: ## Start acceptance frontend in production mode
	RAZZLE_API_PATH=http://127.0.0.1:55001/plone pnpm build && pnpm start:prod

.PHONY: acceptance-backend-start
acceptance-backend-start: ## Start backend acceptance server
	docker run -it --rm -p 55001:55001 $(DOCKER_IMAGE_ACCEPTANCE)

.PHONY: ci-acceptance-backend-start
ci-acceptance-backend-start: ## Start backend acceptance server in headless mode for CI
	docker run -i --rm -p 55001:55001 $(DOCKER_IMAGE_ACCEPTANCE)

.PHONY: acceptance-test
acceptance-test: ## Start Cypress in interactive mode
	pnpm --filter @plone/volto exec cypress open --config-file $(CURRENT_DIR)/cypress.config.js --config specPattern=$(CURRENT_DIR)'/cypress/tests/**/*.{js,jsx,ts,tsx}'

.PHONY: ci-acceptance-test
ci-acceptance-test: ## Run cypress tests in headless mode for CI
	pnpm --filter @plone/volto exec cypress run --config-file $(CURRENT_DIR)/cypress.config.js --config specPattern=$(CURRENT_DIR)'/cypress/tests/**/*.{js,jsx,ts,tsx}'

################
### EXAMPLES ###
################

# Next.js
.PHONY: example-nextjs-admin
example-nextjs-admin: ## Starts Volto, allowing reloading of the add-on during development
	RAZZLE_DEFAULT_IFRAME_URL=http://localhost:3002 pnpm start

.PHONY: example-nextjs-frontend
example-nextjs-frontend: ## Starts nextjs example frontend
	pnpm example:nextjs

# Nuxt
.PHONY: example-nextjs-admin
example-nuxt-admin:
	RAZZLE_DEFAULT_IFRAME_URL=http://localhost:3002 pnpm start

.PHONY: example-nuxt-frontend
example-nuxt-frontend: ## Starts nuxt example frontend
	cd examples/nuxt-blog-starter && npm install && npm run dev

######################
### DOCUMENTATION ###
######################

.PHONY: docs-install
docs-install: ## Install documentation dependencies
	@echo "$(GREEN)==> Installing documentation dependencies$(RESET)"
	pip install -r docs/requirements.txt

.PHONY: docs
docs: ## Build HTML documentation
	@echo "$(GREEN)==> Building documentation$(RESET)"
	$(MAKE) -C docs html

.PHONY: docs-clean
docs-clean: ## Clean documentation build
	@echo "$(GREEN)==> Cleaning documentation build$(RESET)"
	$(MAKE) -C docs clean

.PHONY: docs-live
docs-live: ## Start live-reloading documentation server
	@echo "$(GREEN)==> Starting live documentation server$(RESET)"
	$(MAKE) -C docs livehtml

##########################
### HYDRA E2E / BRIDGE ###
##########################

# Test-infrastructure ports have NO defaults (see tests-playwright/ports.ts —
# defaults let one checkout hijack another's servers). This target IS the
# canonical block; keep it aligned with .github/workflows/test.yaml. Override on
# the command line if a second checkout collides, e.g.
#   make hydra-test HYDRA_MOCK_API_PORT=18888 ARGS="..."
export HYDRA_MOCK_API_PORT ?= 8888
export HYDRA_TEST_FRONTEND_PORT ?= 8889
export HYDRA_MOCK_PARENT_PORT ?= 8891
export HYDRA_VOLTO_SSR_PORT ?= 3001
export HYDRA_VOLTO_WEBPACK_PORT ?= 3002
export HYDRA_NUXT_PORT ?= 3003
export HYDRA_REACT_DOC_PORT ?= 3004
export HYDRA_VUE_DOC_PORT ?= 3005
export HYDRA_SVELTE_DOC_PORT ?= 3006
export HYDRA_NEXTJS_PORT ?= 3007
export HYDRA_F7_PORT ?= 3008
export HYDRA_ASTRO_DOC_PORT ?= 3009
export HYDRA_VANILLA_DOC_PORT ?= 3010
export HYDRA_SVELTE_QS_PORT ?= 3011
export HYDRA_ASTRO_QS_PORT ?= 3012

.PHONY: hydra-test
hydra-test: ## Run bridge/e2e tests. Playwright's webServer starts the mock API, Volto, and each frontend with the CORRECT env (NEXT_PUBLIC_BACKEND_BASE_URL=mock, ports) — never start them by hand. ARGS="tests-playwright/bridge/block-sanity.spec.ts --project=nuxt -g gridBlock"
	pnpm exec playwright test $(ARGS)
