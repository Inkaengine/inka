/**
 * Canonical shapes exchanged over the Hydra bridge.
 *
 * These are the CMS-neutral types every adapter must produce. They are
 * deliberately free of Plone-isms (`@id`, `UID`, `@components`): translating
 * to whatever the Volto admin currently consumes is `plonify()`'s job on the
 * admin side, not the adapter's.
 *
 * Types only — this package has no runtime and no build step.
 */

export type Capability =
  | 'content'
  | 'search-fulltext'
  | 'search-filter'
  | 'vocabulary'
  | 'schema'
  | 'asset'
  /** Has lifecycle states and transitions at all. */
  | 'state'
  /** Supports per-document principal grants (Plone yes, Strapi no). */
  | 'per-content-permissions'
  /** Supports inherit-from-parent / break-inheritance. Plone-only in practice. */
  | 'hierarchical-permissions'
  | 'versioning'
  | 'sharing'
  | 'comments'
  /**
   * A document can be kept OUT of navigation without being unpublished.
   *
   * A different claim from any workflow state: the document stays readable by
   * anyone who has its address, it is simply not listed. Plone spells it
   * `exclude_from_nav` on the document; Drupal disables the menu link.
   */
  | 'navigation-exclusion'
  /**
   * A document can be called something else in the menu — "About" in the nav,
   * "About our organisation" as the heading.
   *
   * Drupal has this natively, because its menu link is a separate object with
   * its own title. Plone 6 has no equivalent: @navigation returns the
   * document's own title and nothing else.
   */
  | 'navigation-title';

export type Intent =
  | 'content.get'
  | 'content.create'
  | 'content.update'
  | 'content.delete'
  | 'content.order'
  | 'content.move'
  | 'types.list'
  | 'types.getSchema'
  | 'search'
  | 'navigation.get'
  | 'breadcrumbs.get'
  | 'tree.list'
  | 'vocabulary.get'
  | 'asset.upload'
  | 'asset.imageUrl'
  | 'auth.whoami'
  /**
   * End the session. The credential lives in the adapter, so signing out is
   * the adapter's job — and it has to mean the same thing on every CMS: reads
   * fail as UNAUTHORIZED afterwards rather than succeeding or coming back
   * empty. Cached reads go too: they were fetched as somebody.
   *
   * Idempotent. A second click must not raise something different.
   */
  | 'auth.logout'
  /**
   * Turn a stable document id into something renderable, and back. Links
   * between documents MUST be stored by id, never by path: a path changes when
   * the target is renamed or moved and every link to it dies silently. Plone
   * solved this with resolveuid; WordPress has no native equivalent, so its
   * adapter has to supply one.
   */
  | 'reference.resolve'
  /**
   * Listings. `querystring.getIndexes` describes what can be queried and how;
   * `querystringSearch` runs one. Together they are the second highest volume
   * call in a normal editing session after schema, because every listing,
   * search and teaser block consults them.
   */
  | 'querystring.getIndexes'
  | 'querystringSearch'
  /** Lifecycle position, available transitions and effective permissions. */
  /**
   * Keep a document out of the menu, or call it something else there.
   *
   * Separate from state on purpose: an excluded document is still readable by
   * anyone holding its address. Only adapters advertising
   * `navigation-exclusion` / `navigation-title` implement them.
   */
  | 'navigation.setExcluded'
  | 'navigation.setTitle'
  | 'state.get'
  /**
   * Every transition's form, fetched once when the state menu opens.
   *
   * Deliberately not part of `state.get`: Plone's `@actions` maps to that
   * intent and the admin requests it on every content view, so schemas riding
   * along would make the common path pay for the rare one. All transitions
   * come back together rather than one per click because the expensive part —
   * the current grants — is shared between them.
   */
  | 'state.getForms'
  | 'state.transition'
  | 'http';

export interface Document {
  /** Opaque CMS id (Plone UID, WP post id, Drupal uuid) — always a string. */
  id: string;
  /** CMS-relative path, leading slash, never an absolute URL. */
  path: string;
  type: string;
  title: string;
  language?: string;
  blocks: Record<string, unknown>;
  blocksLayout: { items: string[] };
  fields: Record<string, unknown>;
  /** Canonical workflow state, mapped by the adapter from its CMS's names. */
  state?: string;
  /** Escape hatch for adapter-internal use. Never read by the admin. */
  _adapter?: { raw: unknown };
}

export interface Schema {
  fieldsets: Array<{ id: string; title: string; fields: string[] }>;
  properties: Record<string, unknown>;
  required: string[];
}

/**
 * What a transition asks for before it fires, keyed by transition id.
 *
 * There is no separate permissions concept: who may do what is fields in this
 * schema like any other, one per role — `title: 'Editors'`,
 * `description: 'Will be able to update when published'` — over the
 * `principals` vocabulary. A CMS with nothing to ask returns an empty schema
 * and the dialog is a sentence and a confirm.
 *
 * Two reserved ids beyond the adapter's own transitions:
 *  - `access` — change who can see this WITHOUT moving state.
 *  - `inherit` — a boolean field, where `hierarchical-permissions` is
 *    advertised.
 *
 * Per object and per user, not per type: which roles exist is site config, and
 * what a role MEANS depends on the state being moved into, which is what the
 * field descriptions say.
 */
export interface TransitionForms {
  [transitionId: string]: {
    schema: Schema;
    /** Current values — grants as they stand, defaults for everything else. */
    data: Record<string, unknown>;
  };
}

export interface User {
  id: string;
  username: string;
  fullname?: string;
  email?: string;
  roles: string[];
}

export interface SearchResult {
  items: Document[];
  total: number;
  batching?: { next?: string; prev?: string };
}

/**
 * A stored pointer from one document to another.
 *
 * `id` is the contract; `path` and `url` are conveniences valid only at the
 * moment of resolution and must never be persisted in their place.
 */
export interface Reference {
  id: string;
  path: string;
  url: string;
  title: string;
}

/**
 * One queryable field, and what may be done with it.
 *
 * Index NAMES are CMS-specific (Plone portal_type, WordPress post_type), the
 * same way content type names are — callers discover them here rather than
 * hardcoding. Operations are canonical so the query builder is CMS-neutral.
 */
export interface QueryIndex {
  title: string;
  description?: string;
  group?: string;
  enabled: boolean;
  sortable: boolean;
  /** Canonical operation ids this index supports, e.g. 'selection.any'. */
  operations: string[];
  /** Selectable values, when the index is an enumeration. */
  values?: Record<string, { title: string }>;
}

/** One criterion: index, operation, value. */
export interface QueryCriterion {
  i: string;
  o: string;
  v?: unknown;
}

export interface Vocabulary {
  items: Array<{ token: string; title: string }>;
  total: number;
}

/**
 * Workflow and sharing unified.
 *
 * Plone keeps them as separate UIs, but they answer one question: who can do
 * what, when. Modelling them separately would force every adapter to invent a
 * mapping twice, and most CMSes do not have two concepts to map. Each CMS
 * lights up the parts it supports; capabilities gate the rest.
 */
export interface PermissionsAndState {
  /** Lifecycle position. Always present. */
  state: { name: string; label: string };
  /**
   * Transitions available to the current user right now. The state menu
   * renders from this — there is no separate workflow concept.
   *
   * The adapter decides what belongs here, so working-copy entries (Plone's
   * check out / check in) are transitions like any other: checking out a copy
   * IS a state change. Cheap by design — ids and labels only. What each one
   * asks for before it fires comes from `state.getForms` when the menu opens.
   *
   * A transition whose `targetState` equals the current state is a no-op; use
   * the reserved `access` form to change who can see this without moving.
   */
  transitions: Array<{
    id: string;
    label: string;
    /**
     * Optional because one of the three cannot answer it. Plone's `@workflow`
     * returns each transition as `{@id, title}` and nothing else — the
     * destination state is in the workflow definition, which is not over REST.
     * WordPress and Drupal both know theirs.
     *
     * Where it is absent the menu shows the transition's own label rather than
     * grouping by destination, which is what Plone's own UI does today.
     */
    targetState?: string;
    /**
     * True when taking this moves the editing session somewhere else, and
     * `state.transition` answers `{ redirect }` rather than null.
     *
     * Checking out a working copy is the case that needs it: the copy lives at
     * a different path, and staying put would show the published version while
     * the draft sat elsewhere unedited. The dialog says so before committing,
     * because being relocated is not something to discover afterwards.
     */
    relocates?: boolean;
  }>;
  /** What the current user may do. UI gates visible/enabled controls on this. */
  effective: {
    canEdit: boolean;
    canPublish: boolean;
    canDelete: boolean;
    canShare: boolean;
    canComment: boolean;
  };
  /**
   * Toolbar entries this CMS wants to answer for itself.
   *
   * `effective` above says what the user MAY do; this says where doing it
   * happens when the CMS would rather show its own screen than have Volto
   * reimplement one. Three uses, all from the same list:
   *
   *  - REPLACE a built-in: give the entry the id Volto already knows (`edit`,
   *    `sharing`, `history`) and it takes over that button's destination.
   *  - ADD one Volto has no concept of: any other id.
   *  - HIDE either: `permitted: false`. The admin gates on this, so an adapter
   *    can withhold its own entries and Volto's alike.
   *
   * Optional and empty by default: a CMS that is happy with Volto's own
   * screens says nothing and nothing changes.
   */
  actions?: Array<{
    /** Matches a Volto action id to replace it; anything else is a new entry. */
    id: string;
    title: string;
    /**
     * Where it goes. Absent means Volto's own screen for that id — which is
     * how an adapter permits or hides a built-in without redirecting it.
     */
    url?: string;
    /** Withheld entries are not rendered. Defaults to true. */
    permitted?: boolean;
    /**
     * How a `url` opens. Defaults to 'window'.
     *
     * 'iframe' is opt-in because the CMS decides, not us: admin pages
     * routinely send X-Frame-Options: SAMEORIGIN or frame-ancestors 'self'
     * — WordPress does, which is why signing in had to be a popup — and in
     * Hydra the admin is never on the CMS's origin. There is no way to ask
     * in advance whether framing will be refused; you find out when the frame
     * comes back blank. So an adapter opts in only for a CMS it knows allows
     * it, and everything else opens where it will actually work.
     */
    target?: 'window' | 'iframe';
    /** Which toolbar grouping it belongs to. Defaults to 'object'. */
    /**
     * Which of Volto's toolbar groups this belongs to.
     *
     * `object-buttons` is where Volto looks for the entries it treats as
     * optional per site rather than per user — URL aliases and content rules.
     * They are off unless something declares them, which is the right default:
     * Plone has both, Drupal has aliases but no rules, and vanilla WordPress
     * has neither. A CMS turns on what it actually has instead of the admin
     * guessing from a capability that would have to mean two things.
     */
    category?: 'object' | 'object-buttons' | 'site' | 'user';
  }>;
}

export interface AdapterContext {
  cmsBaseUrl: string;
  emit(event: 'auth-required' | 'auth-state', payload: unknown): void;
}

export interface HydraAdapter {
  name: string;
  capabilities: Capability[];
  init(ctx: AdapterContext): Promise<void>;
  whoami(): Promise<User | null>;
  getAdminUrl(panel: string): string | null;
  dispatch(intent: Intent, args: unknown): Promise<unknown>;
}
