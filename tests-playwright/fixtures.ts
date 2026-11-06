/**
 * Playwright test fixtures: everything a spec needs from the harness.
 *
 * All test files should import `test` and `expect` from this file instead of
 * directly from @playwright/test — and `URLS`/`PORTS` from here too, rather
 * than from ports.ts.
 *
 * Usage in test files:
 *   import { test, expect, URLS } from '../fixtures';
 *   // or
 *   import { test, expect } from '../../fixtures';
 *
 * A test is HANDED its urls — `async ({ page, urls })` — see `withAddresses`
 * in @inka/testing/playwright/fixtures.
 *
 * `URLS`/`PORTS` are also exported, for the places a fixture cannot reach: a
 * constant built once above the tests, a `test.use()`, a cookie name holding a
 * port number. Those are module scope, and a fixture only exists inside a test
 * body. Inside a test, take the fixture.
 *
 * ports-are-not-hardcoded.test.ts holds the rule: a spec that imports the
 * ports module directly fails. That is the door the numbers came back through
 * before — a suite that decided its own ports, with its own `const PORT`.
 */
import { withAddresses, expect } from '@inka/testing/playwright/fixtures';
import { PORTS, URLS } from './ports';

export { PORTS, URLS };

const test = withAddresses(URLS, PORTS);

export { test, expect };
