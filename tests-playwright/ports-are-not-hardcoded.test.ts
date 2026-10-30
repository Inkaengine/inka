/**
 * No code names a port, and nothing supplies a default for one.
 *
 * `ports.ts` already removed the defaults from itself: every port must be given
 * as HYDRA_<NAME>_PORT and a missing one is a hard failure. That rule held
 * where it was read and nowhere else — a comment binds whoever opens the file,
 * and the suites, configs and fixture servers that never import `ports.ts`
 * carried on with `8888`. They were corrected by hand more than once, and came
 * back, because nothing FAILED when one existed.
 *
 * That is the shape worth understanding: a default is invisible on the machine
 * where it happens to be right. `envPort('HYDRA_MOCK_API_PORT', 8888)` reads
 * the environment AND works without it, so every run passes and the only
 * person who finds out is whoever overrides the port — which is the one path
 * no test exercises. Hence both rules below. A literal is caught, and so is a
 * fallback, which is the version that hides.
 *
 * Comments and strings are told apart properly (see `code()`), because most
 * mentions of a port in this repo are prose — a docstring showing a usage
 * example, a note about Plone's VHM paths — and a guard that cried about those
 * would be turned off within a week.
 *
 * Fixture CONTENT is out of scope, as `ports.ts` says: the `@id`s and image
 * urls saved inside tests-playwright/fixtures/content/**\/data.json are a
 * storage convention, not an address anything binds. They are data files, so
 * they are not scanned at all.
 *
 * To add an exception, put it in ALLOWED with the reason. The point is not to
 * forbid a port appearing in a string: it is that doing so has to be a sentence
 * someone wrote down, rather than a plausible-looking default the next reader
 * copies.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO = path.resolve(__dirname, '..');

/**
 * Ours to hold to this rule.
 *
 * package.json and the framework file types come from the guard this replaces
 * (tests-playwright/fixtures/test-ports-not-hardcoded.test.cjs), which caught a
 * real class of bug there: a frontend's own `dev:test` script listening on a
 * literal while the harness waited on its configured port — astro served 3009
 * and nothing was there to answer.
 */
const SCANNED = /\.(ts|tsx|js|jsx|cjs|mjs|vue|svelte|astro)$|(^|\/)package\.json$/;

const SKIPPED = [
  // The Volto fork. Upstream's code, upstream's ports.
  'core/',
  // Inherited with the Volto project template in 2024 and never ours; nothing
  // in package.json or the workflows runs it.
  'cypress/',
  'cypress.config.js',
];

/**
 * Real, but not an address. Each says why, so a reader can check it.
 */
const ALLOWED: Record<string, string> = {
  // The origin baked into saved fixture content, which the mock serves and
  // rewrites. A storage convention — the same one ports.ts puts out of scope
  // for the data files — and this is where it is declared once in code.
  'tests-playwright/fixtures/mock-plone-api.cjs':
    'FIXTURE_ORIGIN: the origin stored IN fixture content, not a port anything binds',
  'tests-playwright/api/fixture-origin.spec.ts':
    'asserts that stored origin never reaches a response; the literal is the thing under test',
  'tests-playwright/fixtures/test-frontend/renderer.js':
    'strips the stored fixture origin from urls it renders',

  // Unit tests whose SUBJECT is a URL. The literals are inputs and expected
  // outputs, not servers: no port is bound and none is read from the
  // environment, so pinning them is what makes the assertion readable.
  'packages/volto-hydra/src/utils/iframeUrl.test.js':
    'URL composition cases: frontend urls in, proxy/canvas urls out',
  'packages/volto-hydra/src/utils/linkItem.test.js':
    'link normalisation cases',
  'packages/volto-hydra/src/utils/mergeTemplates.unlabelled-definition.test.js':
    'template merge cases that carry absolute urls',
  'packages/volto-hydra/src/components/Widgets/VocabularySelectWidget.test.js':
    'vocabulary term urls as the widget receives them',
  'tests-playwright/fixtures/nuxt-starter-config.test.cjs':
    'pins the env it passes IN, to assert what nuxt.config derives from it',

  // Not ours to choose. The health check must agree with the port RAZZLE is
  // serving on, and when PORT is unset that is razzle's own default — so
  // reading it with razzle's default is the accurate thing, and requiring
  // HYDRA_PORT_BASE here would break plain `pnpm start`, which is not a test
  // run. Hardcoding 3001 instead was the bug: /health answered 503 forever on
  // any non-default-port run, timing out Playwright's readiness gate.
  // This file. Its cases ARE port literals — `const PORT = 8899`, `|| 8888` —
  // and a guard cannot be its own counter-example without them.
  'tests-playwright/ports-are-not-hardcoded.test.ts':
    'the cases this guard is built from, including the ones it must reject',

  'packages/volto-hydra/razzle.extend.js':
    "mirrors razzle's own default for PORT, which this health check has to match",
};

/**
 * The file with comments and string bodies blanked out, so a match is code.
 *
 * Hand-written rather than regexed because `//` appears inside every URL in
 * the repo: `http://localhost` is not the start of a comment. Strings are
 * blanked rather than dropped so that line numbers and offsets still line up
 * with the original — but a port inside a string IS an address we care about,
 * so string contents are kept, and only comments go.
 */
export function code(source: string): string {
  let out = '';
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source[i];
    const next = source[i + 1];
    // A string: copy it through, honouring escapes, so its contents are still
    // scanned (an address lives in a string) and its `//` is not a comment.
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      out += c;
      i += 1;
      while (i < n) {
        if (source[i] === '\\') {
          out += source.slice(i, i + 2);
          i += 2;
          continue;
        }
        out += source[i];
        if (source[i] === quote) {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    if (c === '/' && next === '/') {
      while (i < n && source[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) {
        // Keep newlines so reported line numbers stay true.
        if (source[i] === '\n') out += '\n';
        i += 1;
      }
      i += 2;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/** An address: a host with a port on it. */
const ADDRESS = /(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{4,5})/g;

/**
 * Told to listen somewhere on the command line, which is how a frontend's own
 * start script disagreed with the harness that was waiting for it.
 */
const LISTEN_FLAG = /(?:--port[ =]|--inspect-port[ =]|\s-p\s+)(\d{4,5})\b/g;

/**
 * The three ways a port gets a value in code, each matched on the NAME being
 * given one rather than on "the line mentions a port" — which flagged
 * `isProportionate({ actualWidth: 2400 })`, because `isProportionate` contains
 * the letters of `port`. A guard with false positives gets deleted.
 */
const DEFAULTS: Array<[RegExp, string]> = [
  // process.env.HYDRA_MOCK_API_PORT || 8888
  [
    /process\.env(?:\.|\[')([A-Za-z_]*PORT[A-Za-z_]*)(?:'\])?\s*(?:\|\||\?\?)\s*['"`]?(\d{2,5})/,
    'an environment read with a fallback',
  ],
  // envPort('HYDRA_MOCK_API_PORT', 8888)
  [
    /[A-Za-z_]*[Pp]ort\s*\(\s*['"][^'"]+['"]\s*,\s*['"`]?(\d{2,5})/,
    'a port helper called with a default',
  ],
  // const PORT = 8899   /   port: 3000
  // The name must START where a name can: `support`, `transport`, `report`
  // all contain `port` and none of them is one.
  [
    /(?:^|[^A-Za-z0-9_])(?:(?:[A-Z][A-Z0-9_]*_)?PORT[A-Z0-9_]*|[Pp]ort)\s*[:=]\s*(\d{4,5})\b/,
    'a port written straight into a constant',
  ],
];

function offenders(): string[] {
  const files = execFileSync('git', ['ls-files'], {
    cwd: REPO,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\n')
    .filter((f) => f && SCANNED.test(f))
    .filter((f) => !SKIPPED.some((s) => f.startsWith(s)))
    .filter((f) => !(f in ALLOWED));

  const found: string[] = [];
  for (const file of files) {
    const source = readFileSync(path.join(REPO, file), 'utf8');
    const scanned = code(source);
    const lines = scanned.split('\n');
    lines.forEach((line, index) => {
      const where = `${file}:${index + 1}`;
      // An example's own `dev`/`start` script runs it for a developer against a
      // real admin, not a test server, so only its test scripts are held to
      // this. Carried over from the guard this replaces.
      const script = /^\s*"([^"]+)":/.exec(line);
      if (file.endsWith('package.json') && (!script || !/test/.test(script[1]))) {
        return;
      }
      for (const match of line.matchAll(ADDRESS)) {
        found.push(`${where} binds or fetches a hardcoded port: ${match[0]}`);
      }
      for (const match of line.matchAll(LISTEN_FLAG)) {
        found.push(
          `${where} tells a server to listen on ${match[1]}: ` +
            `the harness waits on the configured port, so a literal here ` +
            `serves where nothing is listening`,
        );
      }
      for (const [pattern, what] of DEFAULTS) {
        const hit = pattern.exec(line);
        if (hit) {
          const value = hit[hit.length - 1];
          found.push(
            `${where} gives a port a value in code (${value}) — ${what}: ` +
              `a port with a default is a port nobody has to set`,
          );
          break;
        }
      }
    });
  }
  return found;
}

describe('no code names a port, and nothing defaults one', () => {
  it('every port comes from the environment, with no fallback', () => {
    expect(
      offenders(),
      'Read the port from ports.ts (or, in a test, take the url from the ' +
        'fixtures base) so a missing one FAILS instead of quietly using the ' +
        "number that happens to work on this machine. If the literal isn't an " +
        'address — a usage example, a stored fixture origin, a URL under test ' +
        '— add the file to ALLOWED in this test with the reason.',
    ).toEqual([]);
  });

  /** The tokenizer is the part that decides whether this guard is bearable. */
  it('reads code, not prose', () => {
    expect(code('// see http://localhost:8888\nconst a = 1;').trim()).toBe(
      'const a = 1;',
    );
    expect(code('/* http://localhost:8888 */ const b = 2;').trim()).toBe(
      'const b = 2;',
    );
    // A url in a string is an address, and its // is not a comment.
    expect(code("const u = 'http://localhost:8888';")).toContain('8888');
    // Line numbers survive a block comment, or the report points nowhere.
    expect(code('/*\n\n*/\nconst c = 3;').split('\n').length).toBe(4);
  });

  /**
   * The rules match the NAME being given a value. Checked here because the
   * first version matched any line containing the letters `port`, which
   * flagged `isProportionate({ actualWidth: 2400 })` — and a guard that
   * reports things that are not ports is a guard someone switches off.
   */
  it('knows a port from a word that merely contains one', () => {
    const hits = (line: string) =>
      DEFAULTS.some(([pattern]) => pattern.test(line));

    expect(hits("const PORT = 8899;")).toBe(true);
    expect(hits("const STRAPI_PORT = 1337;")).toBe(true);
    expect(hits("port: 3000,")).toBe(true);
    expect(hits("process.env.HYDRA_MOCK_API_PORT || 8888")).toBe(true);
    expect(hits("envPort('HYDRA_MOCK_API_PORT', 8888)")).toBe(true);

    expect(hits('isProportionate({ actualWidth: 2400, boxWidth: 179 })')).toBe(
      false,
    );
    expect(hits('const supportLevel = 2400;')).toBe(false);
    expect(hits('const transport = 8888;')).toBe(false);
    expect(hits('timeout: 30000,')).toBe(false);
  });
});
