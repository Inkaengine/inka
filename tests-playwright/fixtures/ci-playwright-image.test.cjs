/**
 * The CI browser jobs run in Playwright's image, whose baked-in browsers are
 * the ones THAT Playwright version drives. If @playwright/test moves on and the
 * image tag doesn't, every browser test asks for browsers the image hasn't got.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');

test("the CI Playwright image matches @playwright/test's version", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const version = (pkg.devDependencies?.['@playwright/test'] ?? pkg.dependencies?.['@playwright/test'])?.replace(/^[^\d]*/, '');
  assert.ok(version, 'package.json declares @playwright/test');
  const workflow = fs.readFileSync(path.join(ROOT, '.github/workflows/test.yaml'), 'utf8');
  const tags = [...workflow.matchAll(/mcr\.microsoft\.com\/playwright:v([\d.]+)/g)].map((m) => m[1]);
  assert.ok(tags.length > 0, 'the browser jobs run in the Playwright image');
  for (const tag of tags) assert.equal(tag, version, `image v${tag} vs @playwright/test ${version}`);
});

// A step's stdout closes when the step ends (in a container, the `docker exec`
// returns), so a server backgrounded with `&` that still logs to it dies of
// EPIPE on its next line — every test after that is "connection refused".
test('steps that background a server send its output to a file first', () => {
  const workflow = fs.readFileSync(path.join(ROOT, '.github/workflows/test.yaml'), 'utf8');
  const steps = workflow.split(/\n(?=\s+- name: )/);
  const backgrounding = steps.filter((step) => /&\s*$/m.test(step));
  assert.ok(backgrounding.length > 0, 'some step starts servers in the background');
  for (const step of backgrounding) {
    const name = step.match(/- name: (.*)/)[1];
    const lines = step.split('\n');
    const redirect = lines.findIndex((line) => /^\s*exec >\s*\S+ 2>&1\s*$/.test(line));
    const firstBackground = lines.findIndex((line) => /&\s*$/.test(line));
    assert.ok(redirect !== -1 && redirect < firstBackground, `"${name}" redirects output before its first \`&\``);
  }
});

// Firefox won't launch as root with a $HOME owned by someone else, and the
// image's /github/home belongs to pwuser: every Firefox test fails to launch.
test('jobs in the Playwright image set HOME to root\'s own', () => {
  const workflow = fs.readFileSync(path.join(ROOT, '.github/workflows/test.yaml'), 'utf8');
  const jobs = workflow.split(/\n(?=  [\w-]+:\n)/).filter((job) => job.includes('mcr.microsoft.com/playwright'));
  assert.ok(jobs.length > 0, 'some job runs in the Playwright image');
  for (const job of jobs) {
    const name = job.match(/^\s*([\w-]+):/)[1];
    assert.match(job, /\n    env:\n(      .*\n)*      HOME: \/root\n/, `${name} sets HOME: /root`);
  }
});

// An example installed without a lockfile resolves fresh on every run, so CI
// picks up whatever npm published a moment ago: hydra-vue-f7 resolved a
// browserslist dependency seconds after its release, before the tarball reached
// the CDN, and the job failed on a 404 that had nothing to do with the change.
test('every example CI installs has a committed lockfile and installs frozen', () => {
  const workflow = fs.readFileSync(path.join(ROOT, '.github/workflows/test.yaml'), 'utf8');
  const installs = [...workflow.matchAll(/cd (\S+) && pnpm install([^\n&]*)/g)];
  assert.ok(installs.length > 0, 'the workflow installs some examples');
  for (const [, dir, flags] of installs) {
    assert.ok(fs.existsSync(path.join(ROOT, dir, 'pnpm-lock.yaml')), `${dir} has a pnpm-lock.yaml`);
    assert.match(flags, /--frozen-lockfile/, `${dir} installs with --frozen-lockfile`);
  }
});
