# Architecture Documentation

Read `docs/architecture.md` for the iframe ↔ admin bridge: Slate transforms, selection sync, and the chrome pattern. The chrome pattern is non-negotiable — selection outlines, toolbars, drag handles, edge handles, etc. are rendered in the admin (React) so frontend CSS/JS can't interfere; the iframe only measures rects and captures pointer events through invisible elements layered under the admin's visuals.

## Template merging - every container is expanded, frontend AND admin

Read `docs/architecture.md` ("Merging templates: every container is expanded, by whoever renders") and `docs/frontend-guide/templates.md` ("Expand every container") BEFORE changing anything that merges templates, renders containers, or walks a page's blocks.

- The merge (`expandTemplates`/`expandTemplatesSync`) has no schema: it fills the regions of a template it APPLIES, never a template placed inside a plain container.
- Every renderer re-enters every container's children with the shared `templateState`: each frontend (the contract), AND the admin (`mergeTemplatesIntoPage` → `expandContainers`), because the admin merges the templates it edits itself.
- Never remove the admin's re-entry as "redundant", and never render a container's children without passing them through the merge. A template can be anywhere a block can.
- Test new template behaviour with the template placed at the top level AND inside a container.

## Template membership - one rule for add, paste and move

Read `docs/architecture.md` ("Template membership") BEFORE changing how a placed block gets its `templateId` / `templateInstanceId` / `slotId` / `fixed` / `readOnly`.

- Every author placement — add, paste, move (drag and drop, cut and paste) — goes through ONE function, `applyMembershipWhereLanded` (blockSync.js), via `settleBlockStructure` after the insert. `insertBlockInContainer` only inserts; never stamp membership in a second place.
- A block from another template lands as one with no template; the add rules for where it landed decide. A slot is invented only when no slot faces the gap.
- Its descendants take its membership AND its `slotId`, except a nested template instance (a snippet), which keeps its own.
- When the docs and the code disagree, stop and ask which is current. Never pick one silently.

## Frontends render every onEditChange - no echo checks of their own

The bridge drops echoes, comparing against its own copy of the page, which includes text typed into the frontend. A frontend's copy never gets that typing back, so a frontend comparing against its own data mistakes real changes (e.g. "Reset changes" after typing) for echoes and leaves stale text on screen. See `docs/frontend-guide/live-preview.md` ("Setting Up the Bridge").

## Block Access - NEVER use formData.blocks[blockId] directly

Blocks can be nested inside container blocks (columns, accordions, etc.), so they may NOT be at `formData.blocks[blockId]`. A block inside a column might be at `formData.blocks.columns-1.column_items.col-1.blocks.text-1`.

**Always use:**
```javascript
import { getBlockById, updateBlockById } from '../../utils/blockPath';

const block = getBlockById(formData, blockPathMap, blockId);
const newFormData = updateBlockById(formData, blockPathMap, blockId, updatedBlock);
```

**Never use:**
```javascript
// WRONG - will silently return undefined for nested blocks
const block = formData.blocks[blockId];
const block = properties?.blocks?.[blockId];
```

The `blockPathMap` tracks where every block lives in the nested structure. If a block isn't in the map, `getBlockById` returns `undefined` and `updateBlockById` throws - this is intentional to surface bugs immediately rather than silently failing.

# Running Playwright Tests

## Prerequisites

**Build dependencies once before first test run:**
```bash
pnpm build:deps
```

This builds `@plone/registry` and `@plone/components`. Only needed once unless you modify those packages.

## Running Tests

### Integration Tests

Playwright automatically starts the Volto server and waits for compilation before running tests.

```bash
pnpm test:e2e               # Run all integration tests (~48s+)
pnpm test:e2e:headed        # Run with visible browser
pnpm test:e2e:ui            # Run in UI mode
pnpm test:e2e:debug         # Run in debug mode
```

### Run specific tests
```bash
pnpm exec playwright test tests-playwright/integration/block-selection.spec.ts
pnpm exec playwright test tests-playwright/integration/sidebar-forms.spec.ts:14
```

### View test report
```bash
pnpm exec playwright show-report
```

## Test Architecture

The Playwright tests use:
- **Mock API server** (`tests-playwright/fixtures/mock-api-server.cjs`) - Serves both mock Plone API and test frontend on port 8888
- **Test frontend** (`tests-playwright/fixtures/test-frontend/`) - Simple HTML/JS frontend that loads the real Hydra bridge
- **Real Hydra bridge** (`packages/hydra-js/hydra.js`) - Production bridge code for iframe-Admin UI communication
- **Admin UI** - Runs on port 3001 (auto-started by Playwright via `webServer` config)

### Automatic Server Management

Playwright's `webServer` configuration (`playwright.config.ts`):
- Auto-starts Volto if not running (or reuses existing server)
- Polls `/health` endpoint until webpack compilation completes
- Tests only start after compilation succeeds
- If compilation fails, tests fail with error details

The health endpoint (`core/packages/volto/razzle.config.js`) returns:
- HTTP 503 "Compiling..." - webpack is compiling
- HTTP 500 + error - compilation failed
- HTTP 200 "OK" - ready for testing

## Key Test Files

- `tests-playwright/integration/block-selection.spec.ts` - Tests clicking blocks in iframe selects them
- `tests-playwright/integration/sidebar-forms.spec.ts` - Tests sidebar form fields appear correctly
- `tests-playwright/integration/quanta-toolbar.spec.ts` - Tests Quanta toolbar appears on block selection
- `tests-playwright/integration/inline-editing.spec.ts` - Tests inline editing functionality
- `tests-playwright/integration/drag-and-drop.spec.ts` - Tests block reordering via drag and drop

## Test Helpers

List all AdminUIHelper methods:
```bash
grep -E '^\s+(async\s+)?[a-zA-Z_]+\(' tests-playwright/helpers/AdminUIHelper.ts | grep -v 'if\s*(' | grep -v 'for\s*(' | sed 's/^\s*//' | awk -F'(' '{print $1}' | sed 's/async //' | sort -u
```

## Manual Development Server

To manually start the servers for development/testing:

```bash
# Terminal 1: Start mock API server (port 8888)
pnpm start:mock-api

# Terminal 2: Start Volto Hydra (port 3001 SSR, port 3002 webpack)
pnpm start:test

# Terminal 3 (optional): Start Nuxt frontend for Nuxt tests (port 3003)
pnpm start:nuxt:test
```

Then access: http://localhost:3001/test-page/edit

**Port summary:**

- **8888**: Mock API + test frontend (HTML/JS)
- **3001**: Volto SSR server (navigate here)
- **3002**: Webpack dev server (health check here)
- **3003**: Nuxt frontend (for Nuxt-specific tests)

## Development Workflow

### After Making Changes to Code

**For changes in `packages/volto-hydra/`:**

If you have Volto running manually:
1. Make your code changes
2. Volto auto-reloads via HMR (1-3 seconds)
3. Run tests (Playwright will wait for compilation)

If Volto is not running:
1. Just run tests - Playwright will start Volto and wait for compilation

**For changes to `packages/hydra-js/hydra.js`:**
- No Volto recompilation needed (loaded directly by frontend)
- Just run tests

### Monitoring Compilation

To manually check compilation status when Volto is running:

```bash
# Check health endpoint
curl http://localhost:3001/health

# Returns:
# - "Compiling..." (HTTP 503) - still compiling
# - "Compilation error: ..." (HTTP 500) - compilation failed
# - "OK" (HTTP 200) - ready
```

## Troubleshooting

### Module Not Found Errors

If you see errors like `Module not found: Can't resolve '@plone/components'`:

```bash
pnpm build:deps
```

This builds the workspace dependencies that Volto imports.

### Port Already in Use

If port 3001 is already in use:

```bash
lsof -ti:3001 | xargs kill -9
```

### Tests Running Against Old Code

If tests seem to be running against stale code:
1. Check that HMR completed: `curl http://localhost:3001/health` should return "OK"
2. If manually running Volto, check logs for compilation errors
3. Restart Volto if needed

### General Cleanup

```bash
# Kill any lingering test processes
pkill -f "playwright test"

# Kill processes on test ports
lsof -ti:8888,3001,3002 2>/dev/null | xargs kill -9 2>/dev/null
```

## Notes

- only git commit when I ask you to
- **NEVER** skip a test without explicit permission from the user
- Playwright's `webServer.reuseExistingServer: true` means it will use a manually-started Volto server if available
- The test setup skips `build:deps` to avoid parcel segfault in non-interactive shells
- **NEVER** kill all node processes haphazardly. check if you really need to kill a process as some tests reload
- to check volto is compiling use http://localhost:3002/health
- custom schemas are registered in the renderer.js on init.
- hydra.js adds nodeIds into slate JSON data, but `data-block-uid` and slate node `data-node-id` attributes are the renderer's responsibility to add to the rendered HTML when in edit mode