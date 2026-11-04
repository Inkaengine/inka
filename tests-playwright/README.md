# Volto Hydra E2E Test Suite (Playwright)

End-to-end tests for Volto Hydra using **Playwright Test** and **TypeScript**.

## Overview

This test suite validates the Volto Hydra admin UI editing functionality with a **mocked Plone REST API backend**. Tests are written in TypeScript using Playwright Test's modern testing framework.

### Architecture

- **Real Volto Admin UI** - Tests interact with the actual Volto interface
- **Mock Plone API** - Express server providing minimal REST API endpoints
- **TypeScript** - Type-safe test code with excellent IDE support
- **Playwright Test** - Modern E2E testing framework with built-in fixtures

## Quick Start

### 1. Install Dependencies

```bash
pnpm install
```

This installs:
- `@playwright/test` - Playwright Test framework
- `express` - Mock API server
- `typescript` - TypeScript compiler
- Other dev dependencies

### 2. Install Playwright Browsers

```bash
pnpm exec playwright install chromium
```

### 3. Run Tests

```bash
# Run all tests (headless)
pnpm test:e2e

# Run with visible browser
pnpm test:e2e:headed

# Run in UI mode (interactive)
pnpm test:e2e:ui

# Debug mode (step through)
pnpm test:e2e:debug
```

## Recommended Development Workflow

**Problem**: Volto's webpack compilation takes 5+ minutes on first run, causing tests to timeout.

**Solution**: Keep the dev server running and reuse it for all test runs.

### Step 1: Start the Servers (First Time Only)

**Terminal 1** - Start Mock API:
```bash
node packages/mock-api/mock-api-server.cjs
```

**Terminal 2** - Start Volto Dev Server:
```bash
RAZZLE_API_PATH=http://localhost:8888 pnpm start
```

Wait for webpack to compile and see "🎭 Volto started at 0.0.0.0:3000 🚀" (takes ~1-5 minutes).

### Step 2: Run Tests (Instant!)

**Terminal 3** - Run Tests:
```bash
pnpm test:e2e
```

Playwright will detect the running servers and reuse them (thanks to `reuseExistingServer: true` in config).

### Step 3: Develop & Debug

1. Run tests → find a bug
2. Fix the bug in volto-hydra code
3. Webpack auto-recompiles (5-30 seconds)
4. Run tests again (instant!)

**Tips**:
- Keep Terminal 1 & 2 running in the background
- Only restart if you change dependencies or get weird errors
- Webpack watches for file changes and recompiles automatically

## How It Works

### Automatic vs Manual Server Management

**Automatic Mode** (default when servers aren't running):
- Run `pnpm test:e2e` without starting servers first
- Playwright automatically starts both servers
- **First run**: Takes 5+ minutes for webpack compilation
- **Subsequent runs**: Still slow if servers were stopped

**Manual Mode** (recommended for development):
- Start servers manually (see "Recommended Development Workflow" above)
- Playwright detects running servers and reuses them
- **First run**: 5 minutes for webpack (while servers start)
- **Subsequent runs**: Instant! (servers keep running)

### Automatic Server Management

When servers aren't already running, Playwright automatically starts both servers before tests:

1. **Mock Plone API** (`http://localhost:8888`)
   - Serves mock content, schemas, and authentication
   - Loads data from `packages/mock-api/api/`

2. **Volto Admin UI** (`http://localhost:3001`)
   - Configured to use mock API via `RAZZLE_API_PATH`
   - Real Volto interface for testing

Both servers shut down automatically after tests complete.

### Test Execution Flow

```
┌─────────────────┐
│ Start Mock API  │ (port 8888)
└────────┬────────┘
         │
┌────────▼────────┐
│ Start Volto UI  │ (port 3001, points to mock API)
└────────┬────────┘
         │
┌────────▼────────┐
│  Run Tests      │ (interact with Volto UI)
└────────┬────────┘
         │
┌────────▼────────┐
│ Shut down       │ (cleanup)
└─────────────────┘
```

## Writing Tests

### Basic Test Structure

```typescript
import { test, expect } from '@playwright/test';
import { AdminUIHelper } from '../helpers/AdminUIHelper';

test('my test description', async ({ page }) => {
  const helper = new AdminUIHelper(page);

  // Login
  await helper.login();

  // Navigate to edit page
  await helper.navigateToEdit('/test-page');

  // Interact with blocks
  await helper.clickBlockInIframe('block-1-uuid');

  // Make assertions
  const sidebarOpen = await helper.isSidebarOpen();
  expect(sidebarOpen).toBe(true);
});
```

### AdminUIHelper API

The `AdminUIHelper` class provides high-level methods for interacting with Volto:

#### Navigation & Authentication
```typescript
await helper.login('admin', 'admin');
await helper.navigateToEdit('/my-page');
await helper.waitForIframeReady();
```

#### Block Interaction
```typescript
// Click a block
await helper.clickBlockInIframe('block-uuid');

// Edit block text
await helper.editBlockTextInIframe('block-uuid', 'New text');

// Get block text
const text = await helper.getBlockTextInIframe('block-uuid');

// Check if selected (returns { ok: boolean, reason?: string })
const result = await helper.isBlockSelectedInIframe('block-uuid');
if (!result.ok) console.log('Not selected:', result.reason);

// Count blocks
const count = await helper.getBlockCountInIframe();
```

#### Sidebar & UI
```typescript
// Check sidebar state
const isOpen = await helper.isSidebarOpen();
await helper.waitForSidebarOpen();

// Get block type being edited
const blockType = await helper.getSidebarBlockType();
```

#### Toolbar
```typescript
// Check toolbar visibility
const visible = await helper.isBlockToolbarVisible();

// Get toolbar buttons
const buttons = await helper.getToolbarButtons();

// Click a toolbar button
await helper.clickToolbarButton('Delete');
```

#### Saving
```typescript
await helper.saveContent();
```

### Direct Page Access

You can also use Playwright's Page API directly:

```typescript
test('custom interaction', async ({ page }) => {
  // Use page methods directly
  await page.goto('http://localhost:3001');
  await page.click('button.custom-button');

  // Or combine with helper
  const helper = new AdminUIHelper(page);
  await helper.login();
});
```

## Test Organization

```
tests-playwright/
├── fixtures/
│   ├── content/                 # Test content, mounted at /_test_data
│   ├── site-root/               # The test site root, mounted at /
│   └── test-frontend/           # The test frontend
├── helpers/
│   └── AdminUIHelper.ts         # The harness's AdminUIHelper, defaulting to /_test_data
├── frontends.ts                 # The frontends the suites drive, and block-sanity's scope
├── integration/
│   ├── block-selection.spec.ts  # Block selection tests
│   └── inline-editing.spec.ts   # Inline editing tests
├── playwright.config.ts          # Playwright configuration
├── tsconfig.json                # TypeScript config
└── README.md                    # This file
```

The mock API server itself is `packages/mock-api/` (`mock-api-server.cjs`,
with its content-type schemas in `api/`). The harness these suites are built
on — AdminUIHelper and the other Playwright helpers, block discovery, the
sanity suites, the coverage reporter, mock-parent.html and the port block — is
`packages/testing/` (`@inka/testing`), which other frontends' suites use too.

## Mock API Endpoints

The Express mock server implements:

### Essential Endpoints
- `POST /@login` - Returns mock JWT token
- `GET /{path}` - Returns content from fixtures
- `PATCH /{path}` - Updates content in memory
- `GET /@types/{type}` - Returns content type schema

### Optional Endpoints
- `GET /{path}/@breadcrumbs` - Returns breadcrumb trail
- `POST /{path}/@lock` - Returns mock lock response

### Adding Mock Data

Edit `tests-playwright/fixtures/api/content.json`:

```json
{
  "@id": "http://localhost:8888/test-page",
  "@type": "Document",
  "title": "Test Page",
  "blocks": {
    "uuid-1": {
      "@type": "slate",
      "value": [...]
    }
  },
  "blocks_layout": {
    "items": ["uuid-1"]
  }
}
```

The mock server automatically loads this on startup.

## Debugging

### Visual Debugging

```bash
# See browser while tests run
pnpm test:e2e:headed

# Interactive UI mode
pnpm test:e2e:ui
```

### Debug Mode

```bash
# Step through tests
pnpm test:e2e:debug
```

### Playwright Inspector

Tests will pause and open Playwright Inspector. You can:
- Step through each action
- Inspect selectors
- Edit and re-run actions
- View console logs

### Screenshots & Videos

Failed tests automatically capture:
- **Screenshots** - Saved to `test-results/`
- **Videos** - Saved to `test-results/`
- **Traces** - Full execution trace for debugging

View traces:
```bash
npx playwright show-trace test-results/trace.zip
```

## Configuration

### playwright.config.ts

Key settings:

```typescript
{
  testDir: './tests-playwright',
  timeout: 30000,
  use: {
    baseURL: 'http://localhost:3001',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: [
    { command: 'node packages/mock-api/mock-api-server.cjs', port: 8888 },
    { command: 'RAZZLE_API_PATH=http://localhost:8888 pnpm start', port: 3001 },
  ],
}
```

### Environment Variables

- `CI=1` - Enables CI mode (no parallel tests, more retries)
- `DEBUG=1` - Enables mock server logging
- `RAZZLE_API_PATH` - Points Volto to mock API

## CI/CD Integration

### GitHub Actions Example

```yaml
name: E2E Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - uses: pnpm/action-setup@v2
        with:
          version: 9.1.1

      - uses: actions/setup-node@v3
        with:
          node-version: '18'
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install

      - name: Install Playwright browsers
        run: pnpm exec playwright install --with-deps chromium

      - name: Run E2E tests
        run: pnpm test:e2e

      - uses: actions/upload-artifact@v3
        if: always()
        with:
          name: playwright-report
          path: playwright-report/
```

## Troubleshooting

### Tests Timeout

Increase timeout in `playwright.config.ts`:
```typescript
timeout: 60 * 1000, // 60 seconds
```

### Servers Don't Start

Check ports are available:
```bash
lsof -i :8888  # Mock API
lsof -i :3001  # Volto
```

Kill existing processes if needed:
```bash
kill -9 <PID>
```

### Mock API 404 Errors

Verify fixture file exists:
```bash
cat tests-playwright/fixtures/api/content.json
```

Check mock server is loading it:
```bash
DEBUG=1 node packages/mock-api/mock-api-server.cjs
```

### Volto Can't Connect to Mock API

Check CORS headers in mock server (`mock-api-server.cjs`):
```javascript
app.use(cors()); // Should be present
```

### Tests Are Flaky

1. Add explicit waits:
```typescript
await page.waitForSelector('#element', { state: 'visible' });
```

2. Disable parallelization:
```typescript
// playwright.config.ts
workers: 1,
```

3. Increase timeouts in helper methods

## Best Practices

### 1. Use Descriptive Test Names

```typescript
// Good
test('clicking Slate block opens sidebar with text editing options', ...)

// Bad
test('test1', ...)
```

### 2. Use Helper Methods

```typescript
// Good
await helper.clickBlockInIframe('block-id');

// Less good
await page.frameLocator('#previewIframe')
  .locator('[data-block-uid="block-id"]')
  .click();
```

### 3. Make Independent Tests

```typescript
// Each test should login and navigate
test('my test', async ({ page }) => {
  const helper = new AdminUIHelper(page);
  await helper.login(); // Don't rely on previous test state
  await helper.navigateToEdit('/test-page');
  // ...
});
```

### 4. Clean Up After Tests

Playwright automatically:
- Closes pages/browsers
- Resets state between tests
- Shuts down servers

No manual cleanup needed!

### 5. Use TypeScript Types

```typescript
// Helper methods are fully typed
const blockType: string | null = await helper.getSidebarBlockType();
```

## Future Enhancements

- [ ] Add tests for block drag & drop reordering
- [ ] Add tests for different block types (Video, Maps, etc.)
- [ ] Add tests for workflow transitions
- [ ] Add visual regression testing with `@playwright/test` snapshots
- [ ] Add performance benchmarks
- [ ] Add accessibility testing with `@axe-core/playwright`

## Resources

- [Playwright Test Documentation](https://playwright.dev/docs/intro)
- [Volto Documentation](https://6.docs.plone.org/volto/)
- [Volto Hydra README](../README.md)
- [Mock API Documentation](./PLONE_API_MOCKING.md)

## Contributing

When adding new tests:

1. Write tests in TypeScript
2. Use the `AdminUIHelper` for common operations
3. Add descriptive test names and comments
4. Ensure tests are independent
5. Update this README if adding new helpers or patterns
