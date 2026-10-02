import type { HydraAdapter } from '@volto-hydra/hydra-types';

/**
 * A conformance target is one CMS the contract suite can run against.
 *
 * Every target seeds itself from the same tests-adapters/fixtures/seed.json,
 * so the suite's assertions refer to the seed rather than to per-CMS literals.
 * If an assertion needs a CMS-specific value to pass, the abstraction has
 * leaked and that is the finding.
 */
export interface Target {
  name: string;
  /** Capabilities the suite may exercise. Anything absent must reject. */
  capabilities: string[];
  /**
   * Canonical seed type -> this CMS's real type name (Plone 'Document',
   * WP 'post', Drupal 'page'). Assertions compare against this rather than
   * hardcoding a portal type.
   */
  types: Record<string, string>;
  /** Canonical seed vocabulary name -> this CMS's vocabulary identifier. */
  vocabularies: Record<string, string>;
  /**
   * How many terms this target actually seeded. The contract cares that the
   * adapter reports the FULL size rather than the page size, and that
   * filtering happens server-side — not that every CMS can be loaded with the
   * same number of terms. WordPress seeds via one PHP pass and lands wherever
   * PHP's execution limits allow.
   */
  vocabularySize: number;
  /**
   * A named image scale this CMS actually produces. Plone ships preview/large;
   * WordPress ships thumbnail/medium/large. The contract cares that a named
   * scale resolves to a fetchable image, not that every CMS agrees on names.
   */
  imageScale: string;
  /**
   * Canonical role -> this CMS's query index name. Plone calls the type index
   * portal_type, WordPress post_type; callers discover the name rather than
   * hardcoding one CMS's vocabulary.
   */
  queryIndexes: {
    type: string;
    path: string;
    title: string;
    state: string;
    /** Whatever this CMS calls "last edited": modified, changed, … */
    modified: string;
  };
  /** Boot the backing CMS (or mock) and seed it. */
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Reset content to the seed state between test files. */
  seed(): Promise<void>;
  /**
   * Put the adapter into a state where the CMS rejects it as unauthenticated,
   * so the 401 path can be exercised for real rather than with a stub. The
   * callback receives every event the adapter emits while expired.
   */
  expireSession(onEvent: (event: string, payload: unknown) => void): Promise<void>;
  /**
   * Fetch a CMS URL with the current session's credentials. Asset URLs are
   * only meaningful to a caller that is authenticated the way the adapter is,
   * so assertions about them must not fetch anonymously.
   */
  fetchAsSession(url: string): Promise<Response>;
  adapter: HydraAdapter;
}

/**
 * Explicit registry rather than a computed import: vite cannot statically
 * analyse `import(`./${name}.ts`)` against its own directory, and an unknown
 * TARGET should fail with a list of what exists rather than a module-not-found.
 */
const TARGETS: Record<string, () => Promise<{ default: Target }>> = {
  plone: () => import('./plone'),
  wordpress: () => import('./wordpress'),
  drupal: () => import('./drupal'),
};

export async function resolveTarget(): Promise<Target> {
  const name = process.env.TARGET ?? 'plone';
  const load = TARGETS[name];
  if (!load) {
    throw new Error(
      `Unknown TARGET '${name}'. Available: ${Object.keys(TARGETS).join(', ')}`,
    );
  }
  const mod = await load();
  const target = mod.default;

  // Seeding rewrites the CMS behind the adapter's back — new documents, new
  // ids — so anything the adapter read before it is now about content that no
  // longer exists. Without this the suite tests a cache that was never told,
  // and the first symptom is a 404 for an id from the previous test's fixture.
  //
  // This is the same condition as another user editing in production: the
  // adapter caches until IT writes, and an out-of-band change has to announce
  // itself. Here the harness is that other writer.
  if (!seedInvalidatesReads.has(target)) {
    seedInvalidatesReads.add(target);
    const seed = target.seed.bind(target);
    target.seed = async () => {
      await seed();
      target.adapter.invalidateReads();
    };
  }

  return target;
}

/**
 * resolveTarget() is called per spec file (and again at module scope for
 * capability gating) but returns one shared target, so the wrapper has to be
 * applied exactly once or seeding would nest it deeper on every call.
 */
const seedInvalidatesReads = new WeakSet<Target>();
