/**
 * Fetch the WordPress plugins the contract suite mounts into Playground.
 *
 * NOT committed and NOT installed at boot.
 *
 * Playground's own `installPlugin` blueprint step downloads from wordpress.org
 * while WordPress is starting, and when that download fails it fails SILENTLY:
 * the server comes up healthy with the plugin simply absent. Three separate
 * probes concluded things about WordPress from an endpoint that had never been
 * installed. Fetching here instead puts the failure where it belongs — in a
 * command that exits non-zero — and keeps wordpress.org off the test path.
 *
 * The directory is gitignored and regenerated, matching how the repo treats
 * other large generated assets.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const DEST = 'tests-adapters/fixtures/wp-plugins';

/**
 * WPGraphQL, because core WordPress cannot serve navigation to a visitor.
 * /wp/v2/menus and /wp/v2/menu-items both answer 401 to an anonymous client, so
 * a headless frontend has no public menu to read; WPGraphQL exposes a located
 * menu, plus nodeByUri for path -> content routing.
 */
const PLUGINS = [
  {
    slug: 'wp-graphql',
    url: 'https://downloads.wordpress.org/plugin/wp-graphql.latest-stable.zip',
  },
  /**
   * Polylang, because core WordPress holds one language and the contract's
   * translation group needs a CMS that keeps one post per language and relates
   * them. Polylang exposes the language LIST over REST but not a post's own
   * language or its group, which is what the companion plugin adds.
   */
  {
    slug: 'polylang',
    url: 'https://downloads.wordpress.org/plugin/polylang.latest-stable.zip',
  },
  /**
   * The bridge between the two. WPGraphQL knows nothing about Polylang, and
   * Polylang re-keys menu locations per language, so on their own WPGraphQL can
   * no longer resolve a menu's locations and tells an anonymous caller the site
   * has no menus. This extension makes menu items filterable by language and
   * location, and adds `language`/`translations` fields.
   *
   * NOT on wordpress.org, and published with no built release asset, so this is
   * the source zipball — which unpacks to a version-stamped directory and
   * carries its committed vendor/, so it needs no composer install.
   */
  {
    slug: 'wp-graphql-polylang',
    url: 'https://codeload.github.com/valu-digital/wp-graphql-polylang/zip/refs/tags/v0.7.1',
    unpacksAs: 'wp-graphql-polylang-0.7.1',
  },
];

mkdirSync(DEST, { recursive: true });

for (const { slug, url, unpacksAs } of PLUGINS) {
  const target = join(DEST, slug);
  if (existsSync(target)) {
    console.log(`${slug}: already present`);
    continue;
  }
  const zip = join(DEST, `${slug}.zip`);
  console.log(`${slug}: downloading`);
  // curl, not fetch: node's Happy Eyeballs makes plain fetch hang here unless
  // the caller remembers NODE_OPTIONS=--no-network-family-autoselection.
  // --fail so a 404 or a proxy error page is an error, not a corrupt zip.
  execFileSync('curl', ['-sSL', '--fail', '-o', zip, url], { stdio: 'inherit' });
  execFileSync('unzip', ['-q', '-o', zip, '-d', DEST], { stdio: 'inherit' });
  rmSync(zip);
  // A GitHub zipball unpacks to a version-stamped directory; WordPress needs the
  // plugin at its own slug.
  if (unpacksAs) {
    renameSync(join(DEST, unpacksAs), target);
  }
  if (!existsSync(target)) {
    throw new Error(`${url} did not unpack to ${target}`);
  }
  console.log(`${slug}: ready`);
}
